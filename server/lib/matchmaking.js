'use strict';
/**
 * ============================================================================
 *  Dino Royale Evolution - MATCHMAKING & MATCH REGISTRY
 * ============================================================================
 *  Owns every live Match instance and the fixed-step simulation loop that
 *  drives them.
 *
 *  Random Match behaviour (the headline requirement):
 *    1. look for a *live lobby with real players* in the requested mode that
 *       still has room for the whole party and is inside the skill window
 *    2. if none exists, open a brand new lobby and publish it so later
 *       searchers land in it
 *    3. lobbies auto-start once the minimum player count is met, and the
 *       countdown shortens as the lobby fills
 *
 *  Parties always travel together: they are queued as one ticket and placed on
 *  the same team.
 * ============================================================================
 */

const crypto = require('node:crypto');
const { Match } = require('./match.js');
const Content = require('./content.js');
const Protocol = require('./protocol.js');

const TICK_MS = Protocol.TICK_MS;
const SNAPSHOT_EVERY = Math.max(1, Math.round(Protocol.TICK_RATE / Protocol.SNAPSHOT_RATE));

const LOBBY_MIN_WAIT_MS = 12000; // never start instantly - let others arrive
const LOBBY_MAX_WAIT_MS = 75000; // hard cap so nobody waits forever
const EMPTY_MATCH_GRACE_MS = 45000;

function newMatchId() {
  return `m_${crypto.randomBytes(8).toString('base64url')}`;
}

function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

class MatchMaker {
  /**
   * @param {object} deps {accounts, social, voice, log}
   */
  constructor(deps) {
    this.accounts = deps.accounts;
    this.social = deps.social;
    this.voice = deps.voice;
    this.onMatchEnd = deps.onMatchEnd || (() => {});

    /** matchId -> Match */
    this.matches = new Map();
    /** code -> matchId (private rooms) */
    this.codes = new Map();
    /** ticket queue per mode */
    this.queues = new Map();
    for (const mode of Content.MODES) this.queues.set(mode.key, []);

    this.tickAccumulator = 0;
    this.lastTick = Date.now();
    this.frame = 0;
    this.running = false;
    this.metrics = { tickMs: 0, matches: 0, players: 0, overruns: 0, errors: 0 };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTick = Date.now();
    const loop = () => {
      if (!this.running) return;
      const now = Date.now();
      let delta = now - this.lastTick;
      this.lastTick = now;
      // Never simulate more than 250 ms of backlog in one pass, otherwise a
      // stalled event loop would cascade into a physics explosion.
      if (delta > 250) {
        this.metrics.overruns++;
        delta = 250;
      }
      this.tickAccumulator += delta;

      const t0 = process.hrtime.bigint();
      try {
        while (this.tickAccumulator >= TICK_MS) {
          this.tickAccumulator -= TICK_MS;
          this.step(TICK_MS / 1000);
        }
      } catch (err) {
        // A fault in one match must never stop the world for everyone else:
        // log it, drop the backlog, and keep ticking.
        this.metrics.errors++;
        this.tickAccumulator = 0;
        console.error('[matchmaker] tick failed:', err && err.stack ? err.stack : err);
      }
      const t1 = process.hrtime.bigint();
      this.metrics.tickMs = Number(t1 - t0) / 1e6;

      const drift = Date.now() - now;
      setTimeout(loop, Math.max(1, TICK_MS - drift));
    };
    setTimeout(loop, TICK_MS);
    console.log(`[matchmaker] simulation loop running at ${Protocol.TICK_RATE} Hz`);
  }

  stop() {
    this.running = false;
  }

  step(dt) {
    this.frame++;
    let playerCount = 0;

    for (const [id, match] of this.matches) {
      try {
        match.update(dt);
        match.sendEdits();
        match.sendEvents();
        if (this.frame % SNAPSHOT_EVERY === 0) match.sendSnapshots();
      } catch (err) {
        this.metrics.errors++;
        console.error(`[matchmaker] match ${id} tick failed:`, err && err.stack ? err.stack : err);
      }
      playerCount += match.players.size;

      if (match.state === 'lobby') this._updateLobbyTimer(match);
      if (match.state === 'ended' && Date.now() - match.endedAt > 20000) {
        this._closeMatch(match, 'finished');
      } else if (match.players.size === 0 && Date.now() - match.lastActivity > EMPTY_MATCH_GRACE_MS) {
        this._closeMatch(match, 'empty');
      }
    }

    this.metrics.matches = this.matches.size;
    this.metrics.players = playerCount;

    // Matchmaking passes are cheap; run them a few times a second.
    if (this.frame % 10 === 0) this._processQueues();
  }

  _updateLobbyTimer(match) {
    const now = Date.now();
    const count = match.players.size;
    const mode = match.mode;

    if (count < mode.minToStart) {
      if (match.lobbyDeadline) {
        match.lobbyDeadline = 0;
        match.broadcastJson({ t: 'match.countdown', endsAt: 0, seconds: 0 });
      }
      return;
    }

    if (!match.lobbyDeadline) {
      match.lobbyOpenedAt = match.lobbyOpenedAt || now;
      match.lobbyDeadline = now + LOBBY_MIN_WAIT_MS;
      match.broadcastJson({ t: 'match.countdown', endsAt: match.lobbyDeadline, seconds: Math.round(LOBBY_MIN_WAIT_MS / 1000) });
    }

    // Full lobbies launch immediately; the countdown tightens as it fills.
    const fillRatio = count / mode.maxPlayers;
    if (fillRatio >= 0.98) {
      match.lobbyDeadline = Math.min(match.lobbyDeadline, now + 3000);
    } else if (fillRatio > 0.4) {
      match.lobbyDeadline = Math.min(match.lobbyDeadline, now + 8000);
    }
    if (match.lobbyOpenedAt && now - match.lobbyOpenedAt > LOBBY_MAX_WAIT_MS) {
      match.lobbyDeadline = Math.min(match.lobbyDeadline, now + 1500);
    }

    if (now >= match.lobbyDeadline) {
      match.start();
      this._announceLobbyChange(match);
    }
  }

  // ==========================================================================
  //  Match creation / discovery
  // ==========================================================================
  createMatch({ mode = 'solo', privateRoom = false, hostId = null, seed = null, code = null } = {}) {
    const id = newMatchId();
    const match = new Match({
      id,
      mode,
      seed: seed == null ? crypto.randomBytes(4).readUInt32LE(0) : seed >>> 0,
      private: privateRoom,
      code: privateRoom ? code || generateRoomCode() : null,
      hostId,
    });
    this.matches.set(id, match);
    if (match.code) this.codes.set(match.code, id);
    console.log(`[matchmaker] opened ${privateRoom ? 'private' : 'public'} ${mode} lobby ${id}${match.code ? ` code=${match.code}` : ''}`);
    return match;
  }

  _closeMatch(match, reason) {
    if (match.state !== 'ended') match.end(reason);
    // Report results once so progression is awarded exactly a single time.
    if (match.results && !match._resultsReported) {
      match._resultsReported = true;
      try {
        this.onMatchEnd(match, match.results);
      } catch (err) {
        console.error('[matchmaker] result handler failed:', err);
      }
    }
    for (const p of match.players.values()) {
      if (p.conn) p.conn.match = null;
      this.social.setStatus(p.userId, 'online', null);
    }
    this.matches.delete(match.id);
    if (match.code) this.codes.delete(match.code);
    this.voice.destroyRoom(match.id);
    console.log(`[matchmaker] closed lobby ${match.id} (${reason})`);
  }

  /**
   * Finds the best joinable public lobby for a ticket, preferring lobbies that
   * already contain real players so groups converge instead of fragmenting.
   */
  findJoinableMatch(modeKey, partySize, skill) {
    let best = null;
    let bestScore = -Infinity;
    for (const match of this.matches.values()) {
      if (match.private) continue;
      if (match.modeKey !== modeKey) continue;
      if (match.state !== 'lobby' && !(match.state === 'dropping' && match.mode.fill)) continue;
      const room = match.mode.maxPlayers - match.players.size;
      if (room < partySize) continue;
      // Teams must have space for the whole party.
      if (match.mode.teamSize > 1 && partySize > 1) {
        const openSeats = this._openTeamSeats(match);
        if (openSeats < partySize) continue;
      }

      // Prefer: lobbies with humans, close to launching, similar skill.
      const humans = match.players.size;
      const skillGap = Math.abs((match.avgSkill || skill) - skill);
      let score = humans * 12 - skillGap * 0.4;
      if (match.lobbyDeadline) score += 25;
      if (humans === 0) score -= 40;
      if (score > bestScore) {
        bestScore = score;
        best = match;
      }
    }
    return best;
  }

  _openTeamSeats(match) {
    // Largest number of free seats available on any single team.
    let best = 0;
    const teamSize = match.mode.teamSize;
    const counts = new Map();
    for (const p of match.players.values()) counts.set(p.teamId, (counts.get(p.teamId) || 0) + 1);
    for (const n of counts.values()) best = Math.max(best, teamSize - n);
    // A brand new team can always be opened while the lobby has capacity.
    if (match.players.size + teamSize <= match.mode.maxPlayers) best = Math.max(best, teamSize);
    return best;
  }

  // ==========================================================================
  //  Queue tickets
  // ==========================================================================
  /**
   * @param {object} user  requesting user (party leader if a party exists)
   * @param {string} modeKey
   * @returns {{ok:boolean, error?:string, ticket?:object}}
   */
  enqueue(user, modeKey) {
    const mode = Content.MODE_BY_KEY[modeKey];
    if (!mode) return { error: 'Unknown game mode.' };
    if (mode.key === 'custom') return { error: 'Private matches use room codes.' };

    const party = this.social.getParty(user.id);
    let members = [user.id];
    if (party) {
      if (party.leaderId !== user.id) return { error: 'Only the party leader can search for a match.' };
      members = party.members.map((m) => m.id);
      if (members.length > mode.teamSize && mode.teamSize > 0) {
        return { error: `${mode.name} allows up to ${mode.teamSize} players per team.` };
      }
    }

    for (const q of this.queues.values()) {
      const idx = q.findIndex((t) => t.members.includes(user.id));
      if (idx >= 0) q.splice(idx, 1);
    }

    const ticket = {
      id: `t_${crypto.randomBytes(6).toString('base64url')}`,
      leaderId: user.id,
      members,
      partyId: party ? party.id : null,
      mode: modeKey,
      skill: this._skillOf(members),
      queuedAt: Date.now(),
    };
    this.queues.get(modeKey).push(ticket);
    if (party) party.queueId = ticket.id;

    for (const id of members) {
      this.social.setStatus(id, 'queued');
      this.social.push(id, { t: 'queue.joined', ticket: { id: ticket.id, mode: modeKey, at: ticket.queuedAt, size: members.length } });
    }
    // Try to place immediately rather than waiting for the next pass.
    this._processQueues();
    return { ok: true, ticket };
  }

  dequeue(userId) {
    for (const [modeKey, q] of this.queues) {
      const idx = q.findIndex((t) => t.members.includes(userId));
      if (idx >= 0) {
        const [ticket] = q.splice(idx, 1);
        for (const id of ticket.members) {
          this.social.setStatus(id, 'online');
          this.social.push(id, { t: 'queue.left' });
        }
        const party = ticket.partyId ? this.social.parties.get(ticket.partyId) : null;
        if (party) party.queueId = null;
        return { ok: true, mode: modeKey };
      }
    }
    return { ok: true };
  }

  _skillOf(memberIds) {
    let total = 0;
    let n = 0;
    for (const id of memberIds) {
      const u = this.accounts.users.get(id);
      if (!u) continue;
      const s = u.stats;
      // A blended rating: level, K/D and win rate, normalised to ~0..100.
      const kd = s.kills / Math.max(1, s.deaths);
      const wr = s.wins / Math.max(1, s.matches);
      total += Math.min(100, u.level * 1.2 + kd * 14 + wr * 60);
      n++;
    }
    return n ? total / n : 20;
  }

  _processQueues() {
    for (const [modeKey, queue] of this.queues) {
      if (!queue.length) continue;
      const mode = Content.MODE_BY_KEY[modeKey];

      for (let i = 0; i < queue.length; i++) {
        const ticket = queue[i];
        const waited = Date.now() - ticket.queuedAt;
        // The skill window widens the longer a ticket waits.
        const window = 12 + Math.min(120, waited / 1000) * 1.6;

        let match = this.findJoinableMatch(modeKey, ticket.members.length, ticket.skill);
        if (match && match.avgSkill != null && Math.abs(match.avgSkill - ticket.skill) > window) match = null;

        if (!match) {
          // Nothing suitable exists yet -> open a fresh lobby that later
          // searchers will find and join.
          match = this.createMatch({ mode: modeKey, privateRoom: false });
        }

        const placed = this._placeTicket(ticket, match);
        if (placed) {
          queue.splice(i, 1);
          i--;
        }
      }
    }
  }

  _placeTicket(ticket, match) {
    const users = ticket.members.map((id) => this.accounts.users.get(id)).filter(Boolean);
    if (!users.length) return true; // drop dead tickets

    // Every member must still be connected.
    const connections = [];
    for (const u of users) {
      const conn = this.social.connectionsOf ? this.social.connectionsOf(u.id) : null;
      connections.push({ user: u, conn });
    }

    let teamId = null;
    for (const { user, conn } of connections) {
      const player = match.addPlayer(user, conn || null, { partyId: ticket.partyId, teamId });
      if (!player) return false;
      if (teamId == null) teamId = player.teamId;
      this.social.setStatus(user.id, 'in-match', match.id);
    }

    // Recompute the lobby's average skill for future matchmaking passes.
    let skillTotal = 0;
    let n = 0;
    for (const p of match.players.values()) {
      const u = this.accounts.users.get(p.userId);
      if (u) {
        skillTotal += this._skillOf([u.id]);
        n++;
      }
    }
    match.avgSkill = n ? skillTotal / n : ticket.skill;

    const party = ticket.partyId ? this.social.parties.get(ticket.partyId) : null;
    if (party) {
      party.queueId = null;
      party.matchId = match.id;
    }

    for (const { user } of connections) {
      this.social.push(user.id, {
        t: 'match.found',
        matchId: match.id,
        mode: match.modeKey,
        seed: match.seed,
        arena: match.arena,
        state: match.state,
        players: match.players.size,
        maxPlayers: match.mode.maxPlayers,
        teamId,
        code: match.code,
      });
    }
    this._announceLobbyChange(match);
    return true;
  }

  _announceLobbyChange(match) {
    match.broadcastJson({
      t: 'match.lobby',
      matchId: match.id,
      state: match.state,
      players: match.players.size,
      maxPlayers: match.mode.maxPlayers,
      countdownEndsAt: match.lobbyDeadline || 0,
      roster: Array.from(match.players.values()).map((p) => ({
        userId: p.userId,
        entityId: p.entityId,
        name: p.name,
        teamId: p.teamId,
        level: p.level,
        skin: p.skin,
        connected: p.connected,
      })),
    });
  }

  // ==========================================================================
  //  Private rooms
  // ==========================================================================
  createRoom(user, { mode = 'custom', settings = {} } = {}) {
    const party = this.social.getParty(user.id);
    if (party && party.leaderId !== user.id) return { error: 'Only the party leader can open a room.' };

    const match = this.createMatch({ mode, privateRoom: true, hostId: user.id });
    if (settings.seed != null) match.seed = settings.seed >>> 0;

    const members = party ? party.members.map((m) => m.id) : [user.id];
    let teamId = null;
    for (const id of members) {
      const u = this.accounts.users.get(id);
      if (!u) continue;
      const conn = this.social.connectionsOf ? this.social.connectionsOf(id) : null;
      const player = match.addPlayer(u, conn, { partyId: party ? party.id : null, teamId });
      if (player && teamId == null) teamId = player.teamId;
      this.social.setStatus(id, 'in-match', match.id);
      this.social.push(id, {
        t: 'match.found',
        matchId: match.id,
        mode: match.modeKey,
        seed: match.seed,
        arena: match.arena,
        state: match.state,
        code: match.code,
        private: true,
        host: match.hostId === id,
        players: match.players.size,
        maxPlayers: match.mode.maxPlayers,
      });
    }
    this._announceLobbyChange(match);
    return { ok: true, matchId: match.id, code: match.code };
  }

  joinByCode(user, rawCode) {
    const code = String(rawCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) return { error: 'Room codes are 6 characters.' };
    const matchId = this.codes.get(code);
    if (!matchId) return { error: 'No room found for that code.' };
    const match = this.matches.get(matchId);
    if (!match) return { error: 'That room has closed.' };
    if (match.state === 'ended') return { error: 'That match has ended.' };
    if (match.players.size >= match.mode.maxPlayers) return { error: 'That room is full.' };

    const party = this.social.getParty(user.id);
    const members = party && party.leaderId === user.id ? party.members.map((m) => m.id) : [user.id];
    if (match.players.size + members.length > match.mode.maxPlayers) return { error: 'Not enough room for your whole party.' };

    let teamId = null;
    for (const id of members) {
      const u = this.accounts.users.get(id);
      if (!u) continue;
      const conn = this.social.connectionsOf ? this.social.connectionsOf(id) : null;
      const player = match.addPlayer(u, conn, { partyId: party ? party.id : null, teamId });
      if (!player) continue;
      if (teamId == null) teamId = player.teamId;
      this.social.setStatus(id, 'in-match', match.id);
      this.social.push(id, {
        t: 'match.found',
        matchId: match.id,
        mode: match.modeKey,
        seed: match.seed,
        arena: match.arena,
        state: match.state,
        code: match.code,
        private: match.private,
        players: match.players.size,
        maxPlayers: match.mode.maxPlayers,
        teamId,
      });
    }
    this._announceLobbyChange(match);
    return { ok: true, matchId: match.id };
  }

  /** Join whichever match a friend is currently playing (if it accepts joins). */
  joinFriendMatch(user, friendId) {
    const presence = this.social.presence.get(friendId);
    if (!presence || !presence.matchId) return { error: 'That friend is not in a match.' };
    const match = this.matches.get(presence.matchId);
    if (!match) return { error: 'That match has ended.' };
    if (match.state !== 'lobby' && !match.mode.fill) return { error: 'That match is already underway.' };
    if (match.players.size >= match.mode.maxPlayers) return { error: 'That match is full.' };

    const friendPlayer = match.players.get(friendId);
    const teamId = friendPlayer && match.mode.teamSize > 1 ? friendPlayer.teamId : null;
    const teamFull = teamId != null && (match.teams.get(teamId)?.members.size || 0) >= match.mode.teamSize;

    const conn = this.social.connectionsOf ? this.social.connectionsOf(user.id) : null;
    const player = match.addPlayer(user, conn, { teamId: teamFull ? null : teamId });
    if (!player) return { error: 'Could not join that match.' };
    this.social.setStatus(user.id, 'in-match', match.id);
    this.social.push(user.id, {
      t: 'match.found',
      matchId: match.id,
      mode: match.modeKey,
      seed: match.seed,
      state: match.state,
      teamId: player.teamId,
      players: match.players.size,
      maxPlayers: match.mode.maxPlayers,
    });
    this._announceLobbyChange(match);
    return { ok: true, matchId: match.id };
  }

  startPrivate(user, matchId) {
    const match = this.matches.get(matchId);
    if (!match) return { error: 'That room no longer exists.' };
    if (match.hostId !== user.id) return { error: 'Only the host can start the match.' };
    if (match.state !== 'lobby') return { error: 'The match has already started.' };
    if (match.players.size < 1) return { error: 'Nobody is in the room.' };
    match.start();
    this._announceLobbyChange(match);
    return { ok: true };
  }

  leaveMatch(userId) {
    for (const match of this.matches.values()) {
      if (match.players.has(userId)) {
        match.removePlayer(userId, true);
        this.social.setStatus(userId, 'online', null);
        this.voice.leaveRoom(userId);
        this._announceLobbyChange(match);
        return { ok: true, matchId: match.id };
      }
    }
    return { ok: true };
  }

  matchOf(userId) {
    for (const match of this.matches.values()) {
      if (match.players.has(userId)) return match;
    }
    return null;
  }

  publicLobbies() {
    const out = [];
    for (const m of this.matches.values()) {
      if (m.private || m.state === 'ended') continue;
      out.push(m.summary());
    }
    return out.sort((a, b) => b.players - a.players).slice(0, 40);
  }

  serverStats() {
    let queued = 0;
    for (const q of this.queues.values()) for (const t of q) queued += t.members.length;
    return {
      matches: this.matches.size,
      players: this.metrics.players,
      queued,
      tickMs: +this.metrics.tickMs.toFixed(2),
      overruns: this.metrics.overruns,
      lobbies: this.publicLobbies().length,
    };
  }
}

module.exports = { MatchMaker, generateRoomCode };
