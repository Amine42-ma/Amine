'use strict';
/**
 * ============================================================================
 *  Dino Royale Evolution - GAME SERVER
 * ============================================================================
 *  A single Node process serves:
 *    - the client (one self-contained index.html) over HTTP
 *    - the realtime game + social protocol over WebSocket at /ws
 *
 *  Run with:   npm start        (no dependencies to install)
 *  Configure:  PORT, HOST, DATA_DIR, MAX_CONNECTIONS_PER_IP
 * ============================================================================
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { WSServer } = require('./lib/ws.js');
const { Store } = require('./lib/store.js');
const { Accounts } = require('./lib/accounts.js');
const { Social } = require('./lib/social.js');
const { VoiceHub } = require('./lib/voice.js');
const { MatchMaker } = require('./lib/matchmaking.js');
const Content = require('./lib/content.js');
const Protocol = require('./lib/protocol.js');
const WorldGen = require('./lib/worldgen.js');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const CLIENT_ROOT = path.join(__dirname, '..');
const MAX_CONN_PER_IP = Number(process.env.MAX_CONNECTIONS_PER_IP || 12);
const JSON_RATE_MAX = 60; // control messages per second per connection

// ---------------------------------------------------------------------------
//  Wiring
// ---------------------------------------------------------------------------
const store = new Store(DATA_DIR);
const accounts = new Accounts(store);

/** userId -> Set<WSConnection> */
const connectionsByUser = new Map();
/** ip -> count */
const connectionsByIp = new Map();

function push(userId, msg) {
  const set = connectionsByUser.get(userId);
  if (!set || set.size === 0) return false;
  let delivered = false;
  for (const conn of set) delivered = conn.send(msg) || delivered;
  return delivered;
}

function firstConnection(userId) {
  const set = connectionsByUser.get(userId);
  if (!set) return null;
  for (const conn of set) return conn;
  return null;
}

const social = new Social(accounts, push);
social.connectionsOf = firstConnection;

const voice = new VoiceHub(push);

const matchmaker = new MatchMaker({
  accounts,
  social,
  voice,
  onMatchEnd: handleMatchResults,
});
matchmaker.start();

// ---------------------------------------------------------------------------
//  Progression on match completion
// ---------------------------------------------------------------------------
function handleMatchResults(match, results) {
  for (const row of results.players) {
    const user = accounts.users.get(row.userId);
    if (!user) continue;
    const applied = accounts.applyMatchResult(user, row);
    if (user.clanId) social.addClanXp(user.clanId, Math.round(applied.xp * 0.25));

    push(user.id, {
      t: 'match.rewards',
      matchId: match.id,
      placement: row.placement,
      kills: row.kills,
      damage: row.damage,
      xp: applied.xp,
      coins: applied.coins,
      levelUp: applied.levelInfo.levelUp ? applied.levelInfo : null,
      unlocked: applied.unlocked.map((a) => ({ key: a.key, name: a.name, desc: a.desc, xp: a.xp, coins: a.coins, icon: a.icon })),
      profile: accounts.selfProfile(user),
      results,
    });
  }
  store.scheduleFlush();
}

// ---------------------------------------------------------------------------
//  Static file serving (the client is a single HTML file)
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const ALLOWED_STATIC = new Set(['/', '/index.html', '/favicon.ico', '/README.md', '/LICENSE']);

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === '/health') {
    return sendJson(res, 200, {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      ...matchmaker.serverStats(),
      voice: voice.stats(),
      users: accounts.users.count(),
      memoryMB: Math.round(process.memoryUsage().heapUsed / 1048576),
    });
  }

  if (pathname === '/api/stats') {
    return sendJson(res, 200, {
      players: matchmaker.metrics.players,
      matches: matchmaker.matches.size,
      lobbies: matchmaker.publicLobbies(),
      registered: accounts.users.count(),
      clans: accounts.clans.count(),
      protocol: Protocol.PROTOCOL_VERSION,
    });
  }

  if (pathname === '/api/leaderboard') {
    const board = url.searchParams.get('board') || 'level';
    return sendJson(res, 200, { board, entries: accounts.leaderboard(board, 100) });
  }

  if (!ALLOWED_STATIC.has(pathname)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.join(CLIENT_ROOT, pathname);
  if (!filePath.startsWith(CLIENT_ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(data);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const httpServer = http.createServer(serveStatic);
const wss = new WSServer(httpServer, { path: '/ws', heartbeatMs: 15000 });

// ---------------------------------------------------------------------------
//  Connection handling
// ---------------------------------------------------------------------------
wss.on('connection', (conn) => {
  const ip = conn.remoteAddress;
  const count = (connectionsByIp.get(ip) || 0) + 1;
  connectionsByIp.set(ip, count);
  if (count > MAX_CONN_PER_IP) {
    conn.send({ t: 'error', code: 'rate', message: 'Too many connections from this address.' });
    conn.close(1013, 'too many connections');
    return;
  }

  conn.data.jsonTimes = [];
  conn.send({
    t: 'hello',
    protocol: Protocol.PROTOCOL_VERSION,
    serverTime: Date.now(),
    tickRate: Protocol.TICK_RATE,
    snapshotRate: Protocol.SNAPSHOT_RATE,
    modes: Content.MODES,
    online: matchmaker.metrics.players,
    world: { radius: WorldGen.WORLD.RADIUS, height: WorldGen.WORLD.HEIGHT, seaLevel: WorldGen.WORLD.SEA_LEVEL },
  });

  conn.on('json', (msg) => {
    if (!rateOk(conn)) {
      conn.send({ t: 'error', code: 'rate', message: 'Slow down.' });
      return;
    }
    try {
      handleControl(conn, msg);
    } catch (err) {
      console.error('[ws] control handler error:', err);
      conn.send({ t: 'error', code: 'internal', message: 'Something went wrong handling that request.' });
    }
  });

  conn.on('binary', (buf) => {
    const player = conn.data.player;
    const match = conn.data.match;
    if (!player || !match) return;
    try {
      match.handleBinary(player, buf);
    } catch (err) {
      console.error('[ws] binary handler error:', err);
    }
  });

  conn.on('close', () => {
    const c = (connectionsByIp.get(ip) || 1) - 1;
    if (c <= 0) connectionsByIp.delete(ip);
    else connectionsByIp.set(ip, c);

    const user = conn.user;
    if (!user) return;
    const set = connectionsByUser.get(user.id);
    if (set) {
      set.delete(conn);
      if (set.size === 0) connectionsByUser.delete(user.id);
    }
    social.offline(user.id, conn.id);
    voice.leaveRoom(user.id);

    const match = conn.data.match;
    if (match) {
      // Keep the body in the world briefly so a reconnect can resume it.
      match.removePlayer(user.id, false);
    }
  });
});

function rateOk(conn) {
  const now = Date.now();
  const times = conn.data.jsonTimes;
  while (times.length && now - times[0] > 1000) times.shift();
  if (times.length >= JSON_RATE_MAX) return false;
  times.push(now);
  return true;
}

// ---------------------------------------------------------------------------
//  Control-plane router
// ---------------------------------------------------------------------------
function requireAuth(conn) {
  if (!conn.user) {
    conn.send({ t: 'error', code: 'auth', message: 'Sign in first.' });
    return null;
  }
  const user = accounts.users.get(conn.user.id);
  if (!user) {
    conn.send({ t: 'error', code: 'auth', message: 'Account not found.' });
    return null;
  }
  conn.user = user;
  return user;
}

function bindSession(conn, user, token) {
  conn.user = user;
  conn.data.token = token;
  let set = connectionsByUser.get(user.id);
  if (!set) {
    set = new Set();
    connectionsByUser.set(user.id, set);
  }
  set.add(conn);
  social.online(user.id, conn.id);

  conn.send({
    t: 'auth.ok',
    token,
    profile: accounts.selfProfile(user),
    content: clientContent(),
  });
  social.pushFriends(user.id);
  const party = social.getParty(user.id);
  if (party) social.pushParty(party);
  if (user.clanId) {
    const clan = accounts.clans.get(user.clanId);
    if (clan) social.pushClan(clan);
  }

  // Resume an in-progress match after a reload / network drop.
  const match = matchmaker.matchOf(user.id);
  if (match) {
    const player = match.reconnect(user.id, user, conn);
    if (player) {
      conn.data.match = match;
      conn.data.player = player;
      social.setStatus(user.id, 'in-match', match.id);
      voice.joinRoom(user.id, match.id, 'match', match.mode.voice);
      conn.send({ t: 'match.resumed', matchId: match.id, state: match.state });
    }
  }
  conn.send({ t: 'chat.history', channel: 'global:lobby', messages: social.history('global:lobby') });
}

function clientContent() {
  return {
    rarity: Content.RARITY,
    weapons: Content.WEAPONS,
    ammo: Content.AMMO_TYPES,
    items: Content.ITEMS,
    dinos: Content.DINOS,
    modes: Content.MODES,
    skins: Content.SKINS,
    emotes: Content.EMOTES,
    trails: Content.TRAILS,
    banners: Content.BANNERS,
    pings: Content.PINGS,
    achievements: Content.ACHIEVEMENTS,
  };
}

function handleControl(conn, msg) {
  const t = msg && msg.t;
  if (typeof t !== 'string') return;

  switch (t) {
    // ---------------------------------------------------------------- auth
    case 'auth.register': {
      const result = accounts.register({ name: msg.name, email: msg.email, password: msg.password }, conn.remoteAddress);
      if (result.error) return conn.send({ t: 'auth.error', message: result.error });
      bindSession(conn, result.user, result.token);
      conn.send({
        t: 'auth.recoveryCode',
        code: result.recoveryCode,
        message: 'Store this recovery key somewhere safe. It restores your account if you lose your password.',
      });
      return;
    }
    case 'auth.login': {
      const result = accounts.login({ login: msg.login, password: msg.password }, conn.remoteAddress);
      if (result.error) return conn.send({ t: 'auth.error', message: result.error });
      bindSession(conn, result.user, result.token);
      return;
    }
    case 'auth.token': {
      const result = accounts.loginWithToken(msg.token);
      if (result.error) return conn.send({ t: 'auth.error', message: result.error, expired: true });
      bindSession(conn, result.user, result.token);
      return;
    }
    case 'auth.logout': {
      const user = conn.user;
      if (user) {
        accounts.logout(conn.data.token);
        matchmaker.dequeue(user.id);
        matchmaker.leaveMatch(user.id);
        social.leaveParty(user.id, true);
        social.offline(user.id, conn.id);
        voice.cleanupUser(user.id);
        const set = connectionsByUser.get(user.id);
        if (set) {
          set.delete(conn);
          if (!set.size) connectionsByUser.delete(user.id);
        }
        conn.user = null;
        conn.data.match = null;
        conn.data.player = null;
      }
      return conn.send({ t: 'auth.loggedOut' });
    }
    case 'auth.recover': {
      const result = accounts.requestRecovery(msg.email, conn.remoteAddress);
      if (result.error) return conn.send({ t: 'auth.error', message: result.error });
      return conn.send({
        t: 'auth.recoverSent',
        // No mail transport is configured in this build, so the challenge is
        // returned directly. Swap this for an SMTP send in production.
        code: result.code || null,
        delivered: result.delivered,
        message: result.delivered
          ? 'Recovery code issued. It expires in 30 minutes.'
          : 'If that address is registered, a recovery code has been issued.',
      });
    }
    case 'auth.recoverConfirm': {
      const result = accounts.confirmRecovery({ email: msg.email, code: msg.code, newPassword: msg.password });
      if (result.error) return conn.send({ t: 'auth.error', message: result.error });
      bindSession(conn, result.user, result.token);
      if (result.recoveryCode) conn.send({ t: 'auth.recoveryCode', code: result.recoveryCode });
      return;
    }
    case 'auth.changePassword': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = accounts.changePassword(user, msg.current, msg.password);
      return conn.send(result.error ? { t: 'error', code: 'password', message: result.error } : { t: 'ok', action: 'password' });
    }

    // ------------------------------------------------------------- profile
    case 'profile.get': {
      const user = requireAuth(conn);
      if (!user) return;
      return conn.send({ t: 'profile', profile: accounts.selfProfile(user) });
    }
    case 'profile.view': {
      const user = requireAuth(conn);
      if (!user) return;
      const target = accounts.users.get(msg.id) || accounts.users.by('nameLower', String(msg.name || ''));
      if (!target) return conn.send({ t: 'error', code: 'notfound', message: 'Player not found.' });
      return conn.send({ t: 'profile.view', profile: accounts.publicProfile(target) });
    }
    case 'profile.rename': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = accounts.changeName(user, msg.name);
      if (result.error) return conn.send({ t: 'error', code: 'rename', message: result.error });
      social.broadcastPresence(user.id);
      return conn.send({ t: 'profile', profile: accounts.selfProfile(user), notice: `Name changed${result.cost ? ` (-${result.cost} coins)` : ''}.` });
    }
    case 'profile.avatar': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = accounts.updateAvatar(user, msg.avatar);
      if (result.error) return conn.send({ t: 'error', code: 'avatar', message: result.error });
      return conn.send({ t: 'profile', profile: accounts.selfProfile(user) });
    }
    case 'profile.cosmetics': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = accounts.updateCosmetics(user, msg.cosmetics);
      if (result.error) return conn.send({ t: 'error', code: 'cosmetics', message: result.error });
      return conn.send({ t: 'profile', profile: accounts.selfProfile(user) });
    }
    case 'profile.settings': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = accounts.updateSettings(user, msg.settings);
      if (result.error) return conn.send({ t: 'error', code: 'settings', message: result.error });
      return conn.send({ t: 'settings', settings: result.settings });
    }
    case 'store.buy': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = accounts.purchase(user, msg.category, msg.key);
      if (result.error) return conn.send({ t: 'error', code: 'store', message: result.error });
      return conn.send({ t: 'profile', profile: accounts.selfProfile(user), notice: 'Unlocked.' });
    }

    // ------------------------------------------------------------- friends
    case 'friends.list': {
      const user = requireAuth(conn);
      if (!user) return;
      return social.pushFriends(user.id);
    }
    case 'friends.request': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = social.requestFriend(user, msg.name);
      return conn.send(result.error ? { t: 'error', code: 'friends', message: result.error } : { t: 'ok', action: 'friend.request' });
    }
    case 'friends.accept': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = social.acceptFriend(user, msg.id);
      return conn.send(result.error ? { t: 'error', code: 'friends', message: result.error } : { t: 'ok', action: 'friend.accept' });
    }
    case 'friends.decline': {
      const user = requireAuth(conn);
      if (!user) return;
      return void social.declineFriend(user, msg.id);
    }
    case 'friends.remove': {
      const user = requireAuth(conn);
      if (!user) return;
      return void social.removeFriend(user, msg.id);
    }
    case 'friends.block': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = social.blockPlayer(user, msg.id);
      return conn.send(result.error ? { t: 'error', code: 'friends', message: result.error } : { t: 'ok', action: 'block' });
    }
    case 'friends.unblock': {
      const user = requireAuth(conn);
      if (!user) return;
      return void social.unblockPlayer(user, msg.id);
    }
    case 'friends.join': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = social.joinFriend(user, msg.id);
      if (result.error && result.matchId) {
        const joined = matchmaker.joinFriendMatch(user, msg.id);
        if (joined.error) return conn.send({ t: 'error', code: 'join', message: joined.error });
        return;
      }
      if (result.error) return conn.send({ t: 'error', code: 'join', message: result.error });
      if (result.message) conn.send({ t: 'notice', message: result.message });
      return;
    }

    // --------------------------------------------------------------- party
    case 'party.create': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = social.createParty(user);
      return conn.send({ t: 'party.state', party: result.party });
    }
    case 'party.invite': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = social.inviteToParty(user, msg.name);
      return conn.send(result.error ? { t: 'error', code: 'party', message: result.error } : { t: 'ok', action: 'party.invite', notice: `Invite sent to ${result.invited}.` });
    }
    case 'party.accept': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = social.acceptPartyInvite(user, msg.inviteId);
      return conn.send(result.error ? { t: 'error', code: 'party', message: result.error } : { t: 'ok', action: 'party.accept' });
    }
    case 'party.decline': {
      const user = requireAuth(conn);
      if (!user) return;
      return void social.declinePartyInvite(user, msg.inviteId);
    }
    case 'party.joinCode': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = social.joinPartyByCode(user, msg.code);
      return conn.send(result.error ? { t: 'error', code: 'party', message: result.error } : { t: 'ok', action: 'party.join' });
    }
    case 'party.leave': {
      const user = requireAuth(conn);
      if (!user) return;
      return void social.leaveParty(user.id);
    }
    case 'party.kick': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = social.kickFromParty(user, msg.id);
      return conn.send(result.error ? { t: 'error', code: 'party', message: result.error } : { t: 'ok', action: 'party.kick' });
    }
    case 'party.promote': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = social.promoteLeader(user, msg.id);
      return conn.send(result.error ? { t: 'error', code: 'party', message: result.error } : { t: 'ok', action: 'party.promote' });
    }
    case 'party.ready': {
      const user = requireAuth(conn);
      if (!user) return;
      return void social.setReady(user, msg.ready);
    }
    case 'party.mode': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = social.setPartyMode(user, msg.mode);
      return conn.send(result.error ? { t: 'error', code: 'party', message: result.error } : { t: 'ok', action: 'party.mode' });
    }

    // ---------------------------------------------------------------- clan
    case 'clan.create': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = social.createClan(user, msg);
      return conn.send(result.error ? { t: 'error', code: 'clan', message: result.error } : { t: 'clan.state', clan: result.clan });
    }
    case 'clan.join': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = social.joinClan(user, msg.id);
      return conn.send(result.error ? { t: 'error', code: 'clan', message: result.error } : { t: 'ok', action: 'clan.join', pending: !!result.pending });
    }
    case 'clan.leave': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = social.leaveClan(user);
      return conn.send(result.error ? { t: 'error', code: 'clan', message: result.error } : { t: 'ok', action: 'clan.leave' });
    }
    case 'clan.kick': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = social.kickFromClan(user, msg.id);
      return conn.send(result.error ? { t: 'error', code: 'clan', message: result.error } : { t: 'ok', action: 'clan.kick' });
    }
    case 'clan.role': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = social.setClanRole(user, msg.id, msg.role);
      return conn.send(result.error ? { t: 'error', code: 'clan', message: result.error } : { t: 'ok', action: 'clan.role' });
    }
    case 'clan.application': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = social.approveApplication(user, msg.id, !!msg.approve);
      return conn.send(result.error ? { t: 'error', code: 'clan', message: result.error } : { t: 'ok', action: 'clan.application' });
    }
    case 'clan.search': {
      const user = requireAuth(conn);
      if (!user) return;
      return conn.send({ t: 'clan.results', results: social.searchClans(msg.query) });
    }

    // -------------------------------------------------------- leaderboards
    case 'leaderboard.get': {
      const user = requireAuth(conn);
      if (!user) return;
      const board = String(msg.board || 'level');
      const scope = msg.scope === 'friends' ? 'friends' : msg.scope === 'clans' ? 'clans' : 'global';
      let entries;
      if (scope === 'friends') entries = accounts.friendsLeaderboard(user, board);
      else if (scope === 'clans') entries = accounts.clanLeaderboard();
      else entries = accounts.leaderboard(board);
      return conn.send({ t: 'leaderboard', board, scope, entries });
    }

    // ---------------------------------------------------------------- chat
    case 'chat.send': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = social.sendChat(user, msg);
      if (result.deferred) {
        const match = conn.data.match;
        if (match && conn.data.player) match.chat(conn.data.player, result.scope, result.text);
        return;
      }
      if (result.error) return conn.send({ t: 'error', code: 'chat', message: result.error });
      return;
    }
    case 'chat.history': {
      const user = requireAuth(conn);
      if (!user) return;
      const channel = String(msg.channel || 'global:lobby');
      // Only channels the user belongs to may be read back.
      const [scope, id] = channel.split(':');
      const allowed =
        scope === 'global' ||
        (scope === 'party' && social.getParty(user.id)?.id === id) ||
        (scope === 'clan' && user.clanId === id) ||
        (scope === 'dm' && id.split('|').includes(user.id));
      if (!allowed) return conn.send({ t: 'error', code: 'chat', message: 'No access to that channel.' });
      return conn.send({ t: 'chat.history', channel, messages: social.history(channel) });
    }

    // -------------------------------------------------------- matchmaking
    case 'match.random':
    case 'match.queue': {
      const user = requireAuth(conn);
      if (!user) return;
      const party = social.getParty(user.id);
      const mode = msg.mode || party?.mode || 'solo';
      const result = matchmaker.enqueue(user, mode);
      return conn.send(result.error ? { t: 'error', code: 'queue', message: result.error } : { t: 'ok', action: 'queue', mode });
    }
    case 'match.cancel': {
      const user = requireAuth(conn);
      if (!user) return;
      matchmaker.dequeue(user.id);
      return;
    }
    case 'match.createRoom': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = matchmaker.createRoom(user, { mode: msg.mode || 'custom', settings: msg.settings || {} });
      return conn.send(result.error ? { t: 'error', code: 'room', message: result.error } : { t: 'room.created', matchId: result.matchId, code: result.code });
    }
    case 'match.joinCode': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = matchmaker.joinByCode(user, msg.code);
      return conn.send(result.error ? { t: 'error', code: 'room', message: result.error } : { t: 'ok', action: 'room.join' });
    }
    case 'match.startRoom': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = matchmaker.startPrivate(user, msg.matchId);
      return conn.send(result.error ? { t: 'error', code: 'room', message: result.error } : { t: 'ok', action: 'room.start' });
    }
    case 'match.leave': {
      const user = requireAuth(conn);
      if (!user) return;
      matchmaker.leaveMatch(user.id);
      conn.data.match = null;
      conn.data.player = null;
      return conn.send({ t: 'match.left' });
    }
    case 'match.ready': {
      // Client finished generating terrain around its spawn and is ready for
      // the full state + snapshots.
      const user = requireAuth(conn);
      if (!user) return;
      const match = matchmaker.matchOf(user.id);
      if (!match) return conn.send({ t: 'error', code: 'match', message: 'You are not in a match.' });
      const player = match.players.get(user.id);
      if (!player) return;
      player.conn = conn;
      player.connected = true;
      conn.data.match = match;
      conn.data.player = player;
      voice.joinRoom(user.id, match.id, 'match', match.mode.voice);
      match.sendFullState(player);
      return;
    }
    case 'match.lobbies': {
      requireAuth(conn);
      return conn.send({ t: 'match.lobbies', lobbies: matchmaker.publicLobbies() });
    }

    // --------------------------------------------------------------- voice
    case 'voice.enable': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = voice.setMicEnabled(user.id, msg.enabled);
      // Remember the permission decision so we never ask twice.
      accounts.updateSettings(user, { micEnabled: !!msg.enabled });
      return conn.send({ t: 'voice.status', ...result });
    }
    case 'voice.mute': {
      const user = requireAuth(conn);
      if (!user) return;
      return conn.send({ t: 'voice.status', ...voice.setSelfMute(user.id, msg.muted) });
    }
    case 'voice.deafen': {
      const user = requireAuth(conn);
      if (!user) return;
      return conn.send({ t: 'voice.status', ...voice.setDeafened(user.id, msg.deafened) });
    }
    case 'voice.mutePlayer': {
      const user = requireAuth(conn);
      if (!user) return;
      return conn.send({ t: 'voice.mutes', ...voice.mutePlayer(user.id, msg.id, msg.muted) });
    }
    case 'voice.speaking': {
      const user = requireAuth(conn);
      if (!user) return;
      voice.setSpeaking(user.id, !!msg.speaking);
      const player = conn.data.player;
      if (player) player.speaking = !!msg.speaking;
      return;
    }
    case 'voice.signal': {
      const user = requireAuth(conn);
      if (!user) return;
      const result = voice.relay(user, msg);
      if (result.error) return conn.send({ t: 'error', code: 'voice', message: result.error });
      return;
    }
    case 'voice.join': {
      const user = requireAuth(conn);
      if (!user) return;
      const party = social.getParty(user.id);
      const match = matchmaker.matchOf(user.id);
      if (match) {
        voice.joinRoom(user.id, match.id, 'match', match.mode.voice);
        const player = match.players.get(user.id);
        if (player) voice.publishPeers(user.id, match.voicePeersFor(player), match.mode.voice);
      } else if (party) {
        voice.joinRoom(user.id, `party:${party.id}`, 'party', 'team');
        const peers = party.members
          .filter((m) => m.id !== user.id)
          .map((m) => ({ userId: m.id, name: accounts.users.get(m.id)?.name || '', channel: 'party' }));
        voice.publishPeers(user.id, peers, 'party');
      }
      return;
    }
    case 'voice.leave': {
      const user = requireAuth(conn);
      if (!user) return;
      voice.leaveRoom(user.id);
      return;
    }

    // --------------------------------------------------------------- misc
    case 'ping': {
      return conn.send({ t: 'pong', clientTime: msg.time, serverTime: Date.now() });
    }
    case 'stats': {
      return conn.send({ t: 'stats', ...matchmaker.serverStats(), voice: voice.stats() });
    }
    default:
      conn.send({ t: 'error', code: 'unknown', message: `Unknown request: ${t}` });
  }
}

// ---------------------------------------------------------------------------
//  Periodic voice peer refresh (proximity channels change as players move)
// ---------------------------------------------------------------------------
setInterval(() => {
  for (const match of matchmaker.matches.values()) {
    if (match.state === 'lobby' || match.state === 'ended') continue;
    for (const player of match.players.values()) {
      if (!player.connected) continue;
      const peers = match.voicePeersFor(player).map((p) => ({
        ...p,
        name: match.players.get(p.userId)?.name || '',
      }));
      voice.publishPeers(player.userId, peers, match.mode.voice);
    }
  }
}, 2500).unref?.();

// Party voice rooms in the lobby.
setInterval(() => {
  for (const party of social.parties.values()) {
    if (party.matchId) continue;
    for (const m of party.members) {
      const state = voice.stateOf(m.id);
      if (state.roomId !== `party:${party.id}`) continue;
      const peers = party.members
        .filter((o) => o.id !== m.id)
        .map((o) => ({ userId: o.id, name: accounts.users.get(o.id)?.name || '', channel: 'party' }));
      voice.publishPeers(m.id, peers, 'party');
    }
  }
}, 4000).unref?.();

// ---------------------------------------------------------------------------
//  Lifecycle
// ---------------------------------------------------------------------------
httpServer.listen(PORT, HOST, () => {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  console.log('');
  console.log('  ██ DINO ROYALE EVOLUTION - server online');
  console.log(`     protocol v${Protocol.PROTOCOL_VERSION}   tick ${Protocol.TICK_RATE} Hz   snapshots ${Protocol.SNAPSHOT_RATE} Hz`);
  console.log(`     local   http://localhost:${PORT}`);
  for (const a of addrs) console.log(`     network http://${a}:${PORT}`);
  console.log(`     data    ${DATA_DIR}`);
  console.log('');
});

function shutdown(signal) {
  console.log(`\n[server] ${signal} received, shutting down...`);
  matchmaker.stop();
  wss.shutdown();
  store.flushSync();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref?.();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('[server] uncaught exception:', err);
  store.flushSync();
});
process.on('unhandledRejection', (err) => {
  console.error('[server] unhandled rejection:', err);
});

// Periodic persistence heartbeat.
setInterval(() => store.flush().catch(() => {}), 30000).unref?.();

module.exports = { httpServer, wss, accounts, social, matchmaker, voice, store };
