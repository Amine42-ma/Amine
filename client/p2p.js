/**
 * =============================================================================
 *  PEER-TO-PEER TRANSPORT - play with no server at all
 * =============================================================================
 *
 *  Topology is a star, not a mesh. Whoever opens the room becomes the host and
 *  runs the same authoritative Match simulation the dedicated server runs;
 *  everyone else connects to that one peer and sends intent exactly as they
 *  would to a server. This is deliberate:
 *
 *    - the game already assumes one authority, so nothing above this layer
 *      has to change - the HUD, prediction, reconciliation and rendering all
 *      keep working untouched
 *    - a mesh would need every player to agree on the simulation, which is a
 *      far harder problem and a much easier one to desync
 *    - N players cost N connections instead of N²
 *
 *  What this costs, stated plainly: the host's browser is the referee, so a
 *  determined host can cheat in a way that a dedicated server would prevent.
 *  Every *other* player is still fully validated - they cannot fly, shoot
 *  through walls or spawn loot. For a room you share with friends that trade
 *  is usually worth it; for a public competitive match it is not, which is
 *  why the dedicated server mode still exists.
 *
 *  The signalling broker only ever carries connection handshakes. Once the
 *  data channel is open, gameplay traffic is direct between browsers.
 * =============================================================================
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./signal.js'));
  } else {
    root.P2P = factory(root.Signal);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Signal) {
  'use strict';

  /**
   * Public STUN servers, used only to discover each peer's own public address.
   * They see an address and nothing else - no game data passes through them.
   * Several are listed so one being unreachable does not block a connection.
   */
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.nextcloud.com:443' },
  ];

  const TICK_MS = 1000 / 30;
  const SNAPSHOT_EVERY = 2;              // 30 Hz sim, 15 Hz snapshots
  const LOBBY_ANNOUNCE_MS = 2000;
  const ROOM_SCAN_MS = 2500;
  const PEER_TIMEOUT_MS = 20000;

  /**
   * The host's clock lives in a worker, not in setTimeout.
   *
   * Browsers throttle timers hard in a tab that is not in front - down to
   * once a second, and after a few minutes far less than that. For an
   * ordinary page that is a battery saving; for the peer running the match it
   * would freeze the game for everyone the instant the host checked a message
   * or turned their phone off. Timers inside a worker are not throttled that
   * way, so the worker does nothing but keep time and the simulation still
   * runs on the main thread where the rest of the state lives.
   */
  const CLOCK_WORKER_SRC = `
    let handle = null;
    onmessage = (e) => {
      clearInterval(handle);
      handle = null;
      if (e.data && e.data.ms > 0) handle = setInterval(() => postMessage(0), e.data.ms);
    };
  `;

  /** Room codes people have to read aloud, so no 0/O or 1/I. */
  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function randomCode(len = 6) {
    const buf = new Uint8Array(len);
    globalThis.crypto.getRandomValues(buf);
    let out = '';
    for (const b of buf) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    return out;
  }

  function randomId(len = 10) {
    const buf = new Uint8Array(len);
    globalThis.crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, len);
  }

  /* ------------------------------------------------------------- emitter -- */

  /**
   * Deliberately not the page's Emitter class: the shared block is evaluated
   * before the main script defines it, so this file cannot see it at load
   * time. It is small enough that duplicating it beats the coupling.
   */
  class Bus {
    constructor() { this._h = new Map(); }
    on(evt, fn) {
      if (!this._h.has(evt)) this._h.set(evt, new Set());
      this._h.get(evt).add(fn);
      return () => this.off(evt, fn);
    }
    off(evt, fn) { this._h.get(evt)?.delete(fn); }
    emit(evt, ...args) {
      const set = this._h.get(evt);
      if (!set) return;
      for (const fn of Array.from(set)) {
        try { fn(...args); } catch (err) { console.error(`[p2p] handler "${evt}" failed`, err); }
      }
    }
  }

  /* ----------------------------------------------------------- peer link -- */

  /**
   * One WebRTC connection. The joiner always creates the offer so the host
   * never has to know a peer exists before hearing from it.
   */
  class PeerLink extends Bus {
    constructor({ signal, selfId, peerId, initiator }) {
      super();
      this.signal = signal;
      this.selfId = selfId;
      this.peerId = peerId;
      this.initiator = initiator;
      this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      this.channel = null;
      this.open = false;
      this.closed = false;
      this.lastSeen = Date.now();

      this.pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          this.signal.sendRoom({ t: 'ice', to: this.peerId, candidate: ev.candidate.toJSON() });
        }
      };
      this.pc.onconnectionstatechange = () => {
        const s = this.pc.connectionState;
        if (s === 'failed' || s === 'closed') this.close('connection ' + s);
        // 'disconnected' is often transient - ICE recovers on its own, so it
        // is not treated as fatal here.
      };

      if (initiator) {
        this._wire(this.pc.createDataChannel('game', { ordered: true }));
      } else {
        this.pc.ondatachannel = (ev) => this._wire(ev.channel);
      }
    }

    _wire(channel) {
      this.channel = channel;
      channel.binaryType = 'arraybuffer';
      channel.onopen = () => {
        this.open = true;
        this.lastSeen = Date.now();
        this.emit('open');
      };
      channel.onclose = () => this.close('channel closed');
      channel.onmessage = (ev) => {
        this.lastSeen = Date.now();
        if (typeof ev.data === 'string') {
          let msg;
          try { msg = JSON.parse(ev.data); } catch { return; }
          this.emit('json', msg);
        } else {
          this.emit('binary', new Uint8Array(ev.data));
        }
      };
    }

    async createOffer() {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.signal.sendRoom({ t: 'offer', to: this.peerId, sdp: this.pc.localDescription.toJSON() });
    }

    async acceptOffer(sdp) {
      await this.pc.setRemoteDescription(sdp);
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.signal.sendRoom({ t: 'answer', to: this.peerId, sdp: this.pc.localDescription.toJSON() });
    }

    async acceptAnswer(sdp) {
      // A duplicate answer arrives if the joiner retried; ignore it rather
      // than throwing an InvalidStateError out of a signalling handler.
      if (this.pc.signalingState === 'stable') return;
      await this.pc.setRemoteDescription(sdp);
    }

    async addCandidate(candidate) {
      try { await this.pc.addIceCandidate(candidate); } catch { /* pre-SDP candidate */ }
    }

    sendJson(obj) {
      if (this.channel?.readyState === 'open') {
        try { this.channel.send(JSON.stringify(obj)); } catch { /* buffer full */ }
      }
    }

    sendBinary(bytes) {
      if (this.channel?.readyState === 'open') {
        try {
          // Always hand WebRTC a plain ArrayBuffer slice: a Node Buffer view
          // would send the whole underlying pool.
          const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
          this.channel.send(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
        } catch { /* buffer full */ }
      }
    }

    close(reason = 'closed') {
      if (this.closed) return;
      this.closed = true;
      this.open = false;
      try { this.channel?.close(); } catch { /* already gone */ }
      try { this.pc.close(); } catch { /* already gone */ }
      this.emit('close', reason);
    }
  }

  /* ------------------------------------------------------------ the host -- */

  /**
   * Runs the authoritative simulation in this browser and speaks to every
   * other peer. Mirrors the small slice of the dedicated server's routing
   * that a match actually needs.
   */
  class Host {
    constructor({ net, mode, privateRoom, code, seed }) {
      this.net = net;
      this.MatchSim = globalThis.MatchSim;
      this.Content = globalThis.Content;
      this.code = code;
      this.private = !!privateRoom;
      this.peers = new Map();          // peerId -> {link, userId}
      this.timer = null;
      this.clock = null;
      this.frame = 0;
      this.announceAt = 0;
      this.closed = false;

      this.match = new this.MatchSim.Match({
        id: `p2p_${randomId(8)}`,
        mode,
        seed: seed == null ? (globalThis.crypto.getRandomValues(new Uint32Array(1))[0] >>> 0) : seed >>> 0,
        private: this.private,
        code,
        hostId: net.selfId,
      });
    }

    get mode() { return this.match.mode; }

    start() {
      let last = performance.now();
      const tick = () => {
        if (this.closed) return;
        const now = performance.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        this.frame++;
        try {
          this.match.update(dt);
          this.match.sendEdits();
          this.match.sendEvents();
          if (this.frame % SNAPSHOT_EVERY === 0) this.match.sendSnapshots();
          this._lobbyTimer();
          this._reapPeers();
        } catch (err) {
          // One bad tick must never kill the loop - that would freeze the
          // match for everyone with no way back.
          console.error('[p2p host] tick failed', err);
        }
        if (Date.now() > this.announceAt) this._announce();
      };
      this._tick = tick;

      try {
        const url = URL.createObjectURL(new Blob([CLOCK_WORKER_SRC], { type: 'text/javascript' }));
        this.clock = new Worker(url);
        URL.revokeObjectURL(url);
        this.clock.onmessage = tick;
        this.clock.postMessage({ ms: TICK_MS });
      } catch {
        // No workers available: fall back to a timer and accept that the host
        // has to keep the tab in front.
        const loop = () => {
          if (this.closed) return;
          tick();
          this.timer = setTimeout(loop, TICK_MS);
        };
        this.timer = setTimeout(loop, TICK_MS);
      }
    }

    /**
     * Publishes the room so random matchmaking can find it. The listing is
     * retained by the broker, so a browser that opens later sees it at once
     * rather than having to be listening at the moment an announce goes out.
     * It is withdrawn as soon as the room stops accepting people.
     */
    _announce() {
      this.announceAt = Date.now() + LOBBY_ANNOUNCE_MS;
      const open = !this.private
        && this.match.state === 'lobby'
        && this.match.players.size < this.match.mode.maxPlayers;

      if (!open) {
        if (this._listed) {
          this.net.signal.publishListing(this.code, null);
          this._listed = false;
        }
        return;
      }

      const listing = {
        t: 'room.open',
        code: this.code,
        mode: this.match.modeKey,
        players: this.match.players.size,
        max: this.match.mode.maxPlayers,
        at: Date.now(),
      };
      this.net.signal.publishListing(this.code, listing);
      // Also sent on the shared channel so anyone mid-scan hears immediately.
      this.net.signal.sendLobby(listing);
      this._listed = true;
    }

    _lobbyTimer() {
      const m = this.match;
      if (m.state !== 'lobby') return;
      const count = m.players.size;
      // A peer-to-peer room is opened *for* other people, so it never starts
      // itself with one player in it however long they wait - that would end
      // the room before a friend following a link could ever arrive. The host
      // still has an explicit "start now" button for playing alone.
      const needed = Math.max(2, m.mode.minToStart);
      if (count < needed) {
        if (m.lobbyDeadline) {
          m.lobbyDeadline = 0;
          m.broadcastJson({ t: 'match.countdown', endsAt: 0, seconds: 0 });
        }
        return;
      }
      if (!m.lobbyDeadline) {
        m.lobbyOpenedAt = m.lobbyOpenedAt || Date.now();
        m.lobbyDeadline = Date.now() + 12000;
        m.broadcastJson({ t: 'match.countdown', endsAt: m.lobbyDeadline, seconds: 12 });
      }
      if (count >= m.mode.maxPlayers * 0.98) m.lobbyDeadline = Math.min(m.lobbyDeadline, Date.now() + 3000);
      if (Date.now() >= m.lobbyDeadline) m.start();
    }

    /** Drops peers whose channel died without a close event reaching us. */
    _reapPeers() {
      const now = Date.now();
      for (const [peerId, peer] of this.peers) {
        if (peer.link.closed || now - peer.link.lastSeen > PEER_TIMEOUT_MS) {
          this.removePeer(peerId, 'timeout');
        }
      }
    }

    /** Wraps a peer link in the tiny surface Match expects of a connection. */
    connFor(link) {
      return {
        send: (obj) => link.sendJson(obj),
        sendBinary: (buf) => link.sendBinary(buf),
      };
    }

    addPeer(peerId, link, profile) {
      const user = {
        id: profile.id || peerId,
        name: String(profile.name || 'Player').slice(0, 24),
        level: profile.level || 1,
        avatar: profile.avatar || null,
        cosmetics: profile.cosmetics || {},
      };
      const player = this.match.addPlayer(user, this.connFor(link), {});
      if (!player) {
        link.sendJson({ t: 'error', code: 'room', message: 'This room is full.' });
        return null;
      }
      player.connected = true;
      this.peers.set(peerId, { link, userId: user.id, player });
      // Tell the newcomer what it just joined, in the same shape the
      // dedicated server uses, so its UI takes the identical path.
      link.sendJson({
        t: 'match.found',
        matchId: this.match.id,
        mode: this.match.modeKey,
        seed: this.match.seed,
        code: this.code,
        arena: this.match.arena,
        teamId: player.teamId,
        host: false,
        state: this.match.state,
      });
      this._broadcastRoster();
      this._announce();          // the listing's player count just changed
      return player;
    }

    removePeer(peerId, reason) {
      const peer = this.peers.get(peerId);
      if (!peer) return;
      this.peers.delete(peerId);
      try { peer.link.close(reason); } catch { /* already gone */ }
      try { this.match.removePlayer(peer.userId, false); } catch { /* already gone */ }
      this._broadcastRoster();
    }

    _broadcastRoster() {
      const roster = [...this.match.players.values()].map((p) => ({
        id: p.userId, name: p.name, level: p.level || 1, teamId: p.teamId,
      }));
      const msg = { t: 'room.roster', code: this.code, mode: this.match.modeKey, players: roster,
                    max: this.match.mode.maxPlayers, host: this.net.selfId, state: this.match.state };
      this.match.broadcastJson(msg);
      this.net._deliverLocal(msg);
    }

    /** Delivers to one player by user id, whoever is hosting included. */
    _sendToUser(userId, msg) {
      if (userId === this.net.selfId) return this.net._deliverLocal(msg);
      for (const peer of this.peers.values()) {
        if (peer.userId === userId) return peer.link.sendJson(msg);
      }
    }

    /**
     * Voice is peer-to-peer already; the authority's only job is to say who
     * is allowed to hear whom and to carry the WebRTC handshake between them.
     * That is exactly what the dedicated server does, so the same rules apply
     * here - a squad channel still cannot be joined by the other team.
     */
    _publishVoicePeers(userId) {
      const player = this.match.players.get(userId);
      if (!player) return;
      const peers = this.match.voicePeersFor(player).map((p) => ({
        userId: p.userId,
        entityId: p.entityId ?? null,
        name: this.match.players.get(p.userId)?.name ?? null,
        channel: p.channel || this.match.mode.voice,
        muted: false,
        // Deterministic tie-break so two peers never offer simultaneously.
        initiator: userId < p.userId,
      }));
      this._sendToUser(userId, { t: 'voice.peers', channel: this.match.mode.voice, peers });
    }

    /** Control messages from a peer (or from the host's own client). */
    handleJson(peerId, msg, link) {
      const peer = this.peers.get(peerId);
      const player = peer ? peer.player : this.match.players.get(this.net.selfId);
      const reply = (obj) => (link ? link.sendJson(obj) : this.net._deliverLocal(obj));

      switch (msg.t) {
        case 'ping':
          return reply({ t: 'pong', clientTime: msg.time, serverTime: Date.now() });

        case 'match.ready': {
          if (!player) return;
          player.connected = true;
          this.match.sendFullState(player);
          return;
        }

        case 'match.start':
        case 'match.startRoom': {
          // Only the person who opened the room may force an early start.
          if ((peer ? peer.userId : this.net.selfId) !== this.net.selfId) {
            return reply({ t: 'error', code: 'room', message: 'Only the host can start the match.' });
          }
          if (this.match.state === 'lobby' && this.match.players.size >= 1) this.match.start();
          return;
        }

        case 'match.leave': {
          if (peerId) this.removePeer(peerId, 'left');
          return reply({ t: 'match.left' });
        }

        case 'match.chat':
        case 'chat.match': {
          if (player) this.match.chat(player, msg.scope || 'all', msg.text);
          return;
        }

        // ---- voice -------------------------------------------------------
        case 'voice.join': {
          const uid = peer ? peer.userId : this.net.selfId;
          this._publishVoicePeers(uid);
          // Everyone already in the channel needs to learn about the arrival,
          // otherwise only the newcomer would try to connect.
          for (const other of this.match.players.keys()) {
            if (other !== uid) this._publishVoicePeers(other);
          }
          return;
        }

        case 'voice.signal': {
          const uid = peer ? peer.userId : this.net.selfId;
          if (!msg.to) return;
          // Refuse to carry a handshake to somebody the sender is not
          // entitled to hear - the same check the server makes.
          const sender = this.match.players.get(uid);
          if (!sender) return;
          const allowed = this.match.voicePeersFor(sender).some((p) => p.userId === msg.to);
          if (!allowed) return;
          this._sendToUser(msg.to, { t: 'voice.signal', from: uid, kind: msg.kind, data: msg.data });
          return;
        }

        case 'voice.enable':
          return reply({ t: 'voice.status', micEnabled: !!msg.enabled });
        case 'voice.mute':
          return reply({ t: 'voice.status', muted: !!msg.muted });
        case 'voice.deafen':
          return reply({ t: 'voice.status', deafened: !!msg.deafened });

        case 'voice.speaking': {
          const uid = peer ? peer.userId : this.net.selfId;
          const sender = this.match.players.get(uid);
          if (!sender) return;
          for (const p of this.match.voicePeersFor(sender)) {
            this._sendToUser(p.userId, { t: 'voice.speaking', userId: uid, speaking: !!msg.speaking });
          }
          return;
        }

        case 'voice.leave':
          return;

        default:
          return;
      }
    }

    close() {
      this.closed = true;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      if (this.clock) { try { this.clock.terminate(); } catch { /* gone */ } this.clock = null; }
      // Withdraw the listing, or the room would be advertised forever after
      // the host has gone and every joiner would time out against a ghost.
      if (this._listed) {
        try { this.net.signal.publishListing(this.code, null); } catch { /* signal already closed */ }
        this._listed = false;
      }
      for (const [peerId] of this.peers) this.removePeer(peerId, 'host left');
    }
  }

  /* ------------------------------------------------------------- P2PNet -- */

  /**
   * Presents the same surface as the WebSocket NetClient so the rest of the
   * game cannot tell which one it is talking to.
   */
  class P2PNet extends Bus {
    constructor(profile = {}) {
      super();
      this.profile = profile;
      this.selfId = profile.id || randomId(10);
      this.signal = null;
      this.host = null;              // set when we are the authority
      this.link = null;              // set when we are a guest
      this.pending = new Map();      // peerId -> PeerLink awaiting handshake

      // NetClient-compatible fields.
      this.connected = false;
      this.authed = true;            // no accounts stand between you and a room
      this.protocol = globalThis.Protocol?.PROTOCOL_VERSION || 0;
      this.ping = 0;
      this.serverTimeOffset = 0;
      this.serverInfo = null;
      this.room = null;
      this.isHost = false;
      // Voice uses this to break WebRTC offer collisions deterministically,
      // and the reconnect button clears the attempt counter, so both fields
      // have to exist here as well as on the WebSocket client.
      this.userId = this.selfId;
      this.reconnectAttempt = 0;

      this._pingTimer = null;
      this._scanning = null;
    }

    /* ---------------------------------------------------------- lifecycle */

    /** Opens the signalling connection. Rejects if no broker is reachable. */
    async connect() {
      if (this.signal) return;
      this.signal = new Signal({ selfId: this.selfId });
      await this.signal.connect();
      this.signal.subscribeLobby();
      this.signal.onRoomMessage = (msg) => this._onSignal(msg);
      this.signal.onLobbyMessage = (msg) => this._onLobby(msg);
      this.connected = true;
      this.serverInfo = { t: 'hello', protocol: this.protocol, mode: 'p2p', broker: this.signal.broker };
      this.emit('open');
      this.emit('hello', this.serverInfo);
      this._startPing();
    }

    /** Opens a room and becomes its authority. */
    async createRoom({ mode = 'solo', privateRoom = false, seed = null } = {}) {
      await this.connect();
      this.leaveRoom();
      const code = randomCode();
      this.room = code;
      this.isHost = true;
      this.signal.joinRoom(code);
      this.host = new Host({ net: this, mode, privateRoom, code, seed });
      // The host is a player too, wired straight into the match with no
      // network hop - the loopback keeps one code path for everyone.
      this.host.match.addPlayer(
        { id: this.selfId, name: this.profile.name || 'Host', level: this.profile.level || 1,
          avatar: this.profile.avatar || null, cosmetics: this.profile.cosmetics || {} },
        { send: (obj) => this._deliverLocal(obj), sendBinary: (buf) => this._deliverLocalBinary(buf) },
        {},
      );
      const me = this.host.match.players.get(this.selfId);
      if (me) me.connected = true;
      this.host.start();
      this.host._announce();
      this.emit('room.created', { code, mode, host: true });
      // `state` matters: without it the client treats the room as a match
      // already in progress and starts generating the world immediately,
      // dropping the host in alone before anyone has had a chance to join.
      this.emit('match.found', {
        matchId: this.host.match.id, mode, seed: this.host.match.seed,
        code, host: true, arena: this.host.match.arena, state: 'lobby',
        teamId: this.host.match.players.get(this.selfId)?.teamId ?? 1,
      });
      return code;
    }

    /** Joins an existing room by code. Resolves once the channel is open. */
    joinRoom(code, timeoutMs = 20000) {
      return this.connect().then(() => new Promise((resolve, reject) => {
        this.leaveRoom();
        code = String(code || '').trim().toUpperCase();
        if (!code) return reject(new Error('empty room code'));

        this.room = code;
        this.isHost = false;
        this.signal.joinRoom(code);

        let settled = false;
        const done = (err, val) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          clearInterval(retry);
          err ? reject(err) : resolve(val);
        };
        const timer = setTimeout(
          () => done(new Error('no host answered - the room may be closed')), timeoutMs);

        this._joinResolve = () => done(null, code);

        // The host may still be connecting to the broker, so the hello is
        // repeated rather than sent once and hoped for.
        const announce = () => this.signal.sendRoom({ t: 'join', profile: this._publicProfile() });
        announce();
        const retry = setInterval(announce, 1500);
        this._joinRetry = retry;
      }));
    }

    /**
     * Finds any open public room and joins it; opens one when nothing is
     * listening. This is the "random match" button.
     */
    async quickMatch({ mode = 'solo' } = {}) {
      await this.connect();
      const found = await this.scanRooms(ROOM_SCAN_MS, mode);
      for (const room of found) {
        try {
          await this.joinRoom(room.code, 8000);
          return { code: room.code, host: false };
        } catch { /* it filled up or vanished; try the next */ }
      }
      const code = await this.createRoom({ mode });
      return { code, host: true };
    }

    /** Listens on the lobby channel and returns the rooms heard from. */
    scanRooms(ms = ROOM_SCAN_MS, mode = null) {
      return this.connect().then(() => new Promise((resolve) => {
        const rooms = new Map();
        this._scanning = (msg) => {
          if (msg.t === 'room.closed') { rooms.delete(msg.code); return; }
          if (msg.t !== 'room.open' || !msg.code) return;
          if (mode && msg.mode !== mode) return;
          if (msg.players >= msg.max) return;
          // A retained listing outlives a host that crashed without
          // withdrawing it, so anything stale is not worth trying.
          if (msg.at && Date.now() - msg.at > 60000) return;
          rooms.set(msg.code, msg);
        };
        this.signal.sendLobby({ t: 'room.who', mode });
        setTimeout(() => {
          this._scanning = null;
          resolve([...rooms.values()].sort((a, b) => b.players - a.players));
        }, ms);
      }));
    }

    leaveRoom() {
      if (this._joinRetry) { clearInterval(this._joinRetry); this._joinRetry = null; }
      for (const link of this.pending.values()) link.close('left room');
      this.pending.clear();
      if (this.host) { this.host.close(); this.host = null; }
      if (this.link) { this.link.close('left room'); this.link = null; }
      if (this.room) this.signal?.leaveRoom();
      this.room = null;
      this.isHost = false;
    }

    close() {
      this._stopPing();
      this.leaveRoom();
      this.signal?.close();
      this.signal = null;
      this.connected = false;
      this.emit('close', { code: 1000 });
    }

    /* ------------------------------------------------------------ sending */

    /** Same signature as NetClient.send - a JSON control message. */
    send(obj) {
      if (this.isHost) {
        if (this.host) this.host.handleJson(null, obj, null);
        return;
      }
      this.link?.sendJson(obj);
    }

    /** Same signature as NetClient.sendBinary - a Protocol.Writer. */
    sendBinary(writer) {
      const bytes = writer.bytes ? writer.bytes() : writer;
      if (this.isHost) {
        const player = this.host?.match.players.get(this.selfId);
        if (player && this.host) {
          try {
            this.host.match.handleBinary(player, bytes);
          } catch (err) {
            console.error('[p2p host] local input failed', err);
          }
        }
        return;
      }
      this.link?.sendBinary(bytes);
    }

    /**
     * The authority's clock. Interpolation, lag compensation and the storm
     * timer are all expressed against it, so this has to exist on any
     * transport - when we are the host the offset is simply zero.
     */
    serverNow() { return Date.now() + this.serverTimeOffset; }

    /* --------------------------------------------------- inbound delivery */

    /** Routes a message the host produced for its own local player. */
    _deliverLocal(msg) {
      this._handleJson(msg);
    }

    _deliverLocalBinary(buf) {
      this.emit('binary', buf instanceof Uint8Array ? buf : new Uint8Array(buf));
    }

    _handleJson(msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'pong') {
        const rtt = Date.now() - msg.clientTime;
        this.ping = Math.round(this.ping * 0.7 + rtt * 0.3);
        this.serverTimeOffset = msg.serverTime + rtt / 2 - Date.now();
        return;
      }
      this.emit(msg.t, msg);
      this.emit('message', msg);
    }

    /* -------------------------------------------------------- signalling */

    _publicProfile() {
      return {
        id: this.selfId,
        name: this.profile.name || 'Player',
        level: this.profile.level || 1,
        avatar: this.profile.avatar || null,
        cosmetics: this.profile.cosmetics || {},
      };
    }

    _onLobby(msg) {
      if (this._scanning) this._scanning(msg);
      // Someone is looking for rooms and we have one open: answer at once
      // rather than making them wait for the next periodic announce.
      if (msg.t === 'room.who' && this.host) this.host._announce();
    }

    async _onSignal(msg) {
      const from = msg.from;
      if (!from || from === this.selfId) return;

      try {
        // ---- host side -----------------------------------------------------
        if (this.isHost && this.host) {
          if (msg.t === 'join') {
            // The welcome is what tells the joiner which peer to offer to, so
            // it is sent even on a repeat - the joiner retries precisely
            // because it has not heard one yet.
            this.signal.sendRoom({ t: 'welcome', to: from });
            if (this.host.peers.has(from) || this.pending.has(from)) return;
            const link = this._newLink(from, false);
            link.__profile = msg.profile || {};
            this.pending.set(from, link);
            return;
          }
          if (msg.t === 'offer') {
            let link = this.pending.get(from);
            if (!link) {
              link = this._newLink(from, false);
              this.pending.set(from, link);
            }
            link.__profile = link.__profile || msg.profile || {};
            await link.acceptOffer(msg.sdp);
            return;
          }
        }

        // ---- guest side ----------------------------------------------------
        if (!this.isHost) {
          if (msg.t === 'welcome' && !this.link && !this.pending.has(from)) {
            // The host acknowledged us; open the connection towards it.
            const link = this._newLink(from, true);
            this.pending.set(from, link);
            await link.createOffer();
            return;
          }
          if (msg.t === 'answer') {
            const link = this.pending.get(from);
            if (link) await link.acceptAnswer(msg.sdp);
            return;
          }
        }

        // ---- both sides ----------------------------------------------------
        if (msg.t === 'ice') {
          const link = this.pending.get(from)
            || this.host?.peers.get(from)?.link
            || (this.link?.peerId === from ? this.link : null);
          if (link) await link.addCandidate(msg.candidate);
        }
      } catch (err) {
        console.error('[p2p] signalling failed', msg.t, err);
      }
    }

    _newLink(peerId, initiator) {
      const link = new PeerLink({ signal: this.signal, selfId: this.selfId, peerId, initiator });

      link.on('open', () => {
        this.pending.delete(peerId);
        if (this.isHost && this.host) {
          this.host.addPeer(peerId, link, link.__profile || {});
        } else {
          this.link = link;
          if (this._joinRetry) { clearInterval(this._joinRetry); this._joinRetry = null; }
          link.sendJson({ t: 'hello', profile: this._publicProfile() });
          this._joinResolve?.();
          this._joinResolve = null;
          this.emit('room.joined', { code: this.room });
        }
      });

      link.on('json', (msg) => {
        if (this.isHost && this.host) this.host.handleJson(peerId, msg, link);
        else this._handleJson(msg);
      });

      link.on('binary', (bytes) => {
        if (this.isHost && this.host) {
          const peer = this.host.peers.get(peerId);
          if (!peer) return;
          try {
            this.host.match.handleBinary(peer.player, bytes);
          } catch (err) {
            console.error('[p2p host] bad packet from peer', err);
          }
        } else {
          this.emit('binary', bytes);
        }
      });

      link.on('close', () => {
        this.pending.delete(peerId);
        if (this.isHost && this.host) {
          this.host.removePeer(peerId, 'disconnected');
        } else if (this.link === link) {
          this.link = null;
          // Losing the host ends the match for a guest; there is no other
          // authority to fall back to.
          this.emit('host.lost', { code: this.room });
          this.emit('close', { code: 1006, reason: 'host disconnected' });
        }
      });

      return link;
    }

    /* ------------------------------------------------------------- timing */

    _startPing() {
      this._stopPing();
      this._pingTimer = setInterval(() => {
        if (this.isHost) { this.ping = 0; return; }
        if (this.link?.open) this.link.sendJson({ t: 'ping', time: Date.now() });
      }, 2000);
    }

    _stopPing() {
      if (this._pingTimer) clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }

  return { P2PNet, PeerLink, Host, randomCode, randomId, ICE_SERVERS };
});
