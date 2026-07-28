#!/usr/bin/env node
'use strict';
/**
 * ============================================================================
 *  Dino Royale Evolution - MULTIPLAYER INTEGRATION TEST
 * ============================================================================
 *  Boots a real server on a scratch port and drives two independent clients
 *  through the complete online path, speaking the actual wire protocol:
 *
 *      register -> random match -> lobby fills -> match auto-starts
 *      -> full state -> inputs -> snapshots -> world edits -> chat
 *      -> party + friends + voice signalling -> results
 *
 *  Nothing is stubbed: the clients use Node's built-in WebSocket and the same
 *  Protocol module the browser uses.
 *
 *  Run with:  node test/integration.js
 * ============================================================================
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const Protocol = require('../server/lib/protocol.js');
const { Writer, Reader, OP, IN } = Protocol;

const PORT = 8121 + Math.floor(Math.random() * 200);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dre-integration-'));

let passed = 0;
let failed = 0;
const results = [];

function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`); }
  results.push({ name, ok: !!cond, detail });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await sleep(60);
  }
  console.log(`      (timed out waiting for ${label || 'condition'})`);
  return false;
}

/* ---------------------------------------------------------------- client -- */
class TestClient {
  constructor(name) {
    this.name = name;
    this.ws = null;
    this.messages = [];
    this.byType = new Map();
    this.profile = null;
    this.token = null;
    this.matchId = null;
    this.seed = 0;
    this.entityId = 0;
    this.teamId = 0;
    this.snapshots = 0;
    this.edits = [];
    this.events = [];
    this.self = null;
    this.others = new Map();
    this.dinos = 0;
    this.loot = 0;
    this.zone = null;
    this.inventory = null;
    this.aliveCount = 0;
    this.seq = 0;
    this.lastAck = 0;
    this.chat = [];
    this.voicePeers = [];
    this.rewards = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error(`${this.name} socket error`));
      this.ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          const msg = JSON.parse(ev.data);
          this.messages.push(msg);
          this.byType.set(msg.t, msg);
          this._onJson(msg);
        } else {
          this._onBinary(new Uint8Array(ev.data));
        }
      };
    });
  }

  _onJson(msg) {
    switch (msg.t) {
      case 'auth.ok':
        this.profile = msg.profile;
        this.token = msg.token;
        break;
      case 'match.found':
        this.matchId = msg.matchId;
        this.seed = msg.seed;
        this.teamId = msg.teamId;
        this.arena = msg.arena;
        break;
      case 'match.full':
        this.entityId = msg.entityId;
        this.teamId = msg.teamId;
        this.fullState = msg;
        break;
      case 'match.inventory':
        this.inventory = msg;
        break;
      case 'chat.msg':
        this.chat.push(msg.msg);
        break;
      case 'voice.peers':
        this.voicePeers = msg.peers;
        break;
      case 'match.rewards':
        this.rewards = msg;
        break;
    }
  }

  _onBinary(data) {
    const r = new Reader(data);
    const op = r.u8r();
    if (op === OP.S_SNAPSHOT) {
      this.snapshots++;
      r.u32r(); r.u32r();
      this.lastAck = r.u32r();
      const x = r.posr(), y = r.posr(), z = r.posr();
      r.velr(); r.velr(); r.velr();
      const moveState = r.u8r();
      const health = r.u8r();
      const shield = r.u8r();
      r.normr(); r.normr(); r.u8r(); r.normr();
      this.self = { x, y, z, moveState, health, shield };

      const players = r.u16r();
      this.others.clear();
      for (let i = 0; i < players; i++) {
        const id = r.u16r();
        const px = r.posr(), py = r.posr(), pz = r.posr();
        r.yawr(); r.pitr(); r.velr(); r.velr(); r.velr();
        r.u8r();
        const hp = r.u8r();
        const team = r.u8r();
        r.u8r(); r.u16r(); r.normr();
        this.others.set(id, { x: px, y: py, z: pz, hp, team });
      }
      const dinoCount = r.u16r();
      this.dinos = dinoCount;
      this.maxDinos = Math.max(this.maxDinos || 0, dinoCount);
      for (let i = 0; i < dinoCount; i++) {
        r.u16r(); r.u8r(); r.posr(); r.posr(); r.posr(); r.yawr(); r.u8r(); r.normr();
      }
      const lootCount = r.u16r();
      this.loot = lootCount;
      this.maxLoot = Math.max(this.maxLoot || 0, lootCount);
      for (let i = 0; i < lootCount; i++) {
        this.lastLootId = r.u16r();
        r.u8r(); r.strr(); r.u8r(); r.u16r(); r.posr(); r.posr(); r.posr();
      }
      const projCount = r.u16r();
      for (let i = 0; i < projCount; i++) { r.u16r(); r.u8r(); r.posr(); r.posr(); r.posr(); r.velr(); r.velr(); r.velr(); }
      this.zone = { cx: r.f32r(), cz: r.f32r(), radius: r.f32r(), tcx: r.f32r(), tcz: r.f32r(), tradius: r.f32r(), shrinking: r.u8r() };
      this.aliveCount = r.u16r();
      this.aliveTeams = r.u8r();
      this.plane = { x: r.f32r(), z: r.f32r(), active: r.u8r() === 1 };
    } else if (op === OP.S_EDITS) {
      const count = r.u16r();
      for (let i = 0; i < count; i++) {
        this.edits.push({ x: r.i32r(), y: r.i16r(), z: r.i32r(), id: r.u16r() });
      }
    } else if (op === OP.S_EVENTS) {
      const count = r.u16r();
      for (let i = 0; i < count; i++) {
        this.events.push({ type: r.u8r(), entityId: r.u16r(), x: r.f32r(), y: r.f32r(), z: r.f32r(), a: r.u16r(), b: r.u16r() });
      }
    }
  }

  send(obj) { this.ws.send(JSON.stringify(obj)); }
  sendBin(w) { this.ws.send(w.bytes()); }

  input(keys, yaw = 0, pitch = 0) {
    this.seq++;
    const w = new Writer(32);
    w.u8w(OP.C_INPUT).u8w(1).u32w(this.seq).u16w(keys).yaww(yaw).pitw(pitch).u8w(33);
    this.sendBin(w);
  }

  fire(origin, dir) {
    const w = new Writer(48);
    w.u8w(OP.C_FIRE).u32w(this.seq);
    w.f32w(origin.x); w.f32w(origin.y); w.f32w(origin.z);
    w.f32w(dir.x); w.f32w(dir.y); w.f32w(dir.z);
    w.f64w(Date.now());
    this.sendBin(w);
  }

  build(action, x, y, z, blockId) {
    const w = new Writer(24);
    w.u8w(OP.C_BUILD).u8w(action).i32w(x).i16w(y).i32w(z).u16w(blockId);
    this.sendBin(w);
  }

  close() { try { this.ws.close(); } catch { /* already closed */ } }
}

/* ------------------------------------------------------------------ main -- */
(async () => {
  console.log(`\n\x1b[1mMultiplayer integration (port ${PORT})\x1b[0m`);

  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR, HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const serverLog = [];
  server.stdout.on('data', (d) => serverLog.push(d.toString()));
  server.stderr.on('data', (d) => serverLog.push('ERR ' + d.toString()));

  const cleanup = () => {
    server.kill('SIGTERM');
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  };

  try {
    const up = await waitFor(() => serverLog.join('').includes('server online'), 15000, 'server startup');
    check('server boots', up);
    if (!up) throw new Error('server did not start');
    await sleep(400);

    // ------------------------------------------------------------ accounts
    const suffix = Math.floor(Math.random() * 1e6);
    const alpha = new TestClient('Alpha');
    const bravo = new TestClient('Bravo');
    await alpha.connect();
    await bravo.connect();
    check('both clients connect', alpha.ws.readyState === 1 && bravo.ws.readyState === 1);

    await waitFor(() => alpha.byType.has('hello') && bravo.byType.has('hello'), 5000, 'hello');
    check('server sends hello with protocol version', alpha.byType.get('hello')?.protocol === Protocol.PROTOCOL_VERSION);

    // Quick play must work end to end before anything else: it is the path
    // most players take on their very first launch.
    const guest = new TestClient('Guest');
    await guest.connect();
    await waitFor(() => guest.byType.has('hello'), 5000, 'guest hello');
    guest.send({ t: 'auth.guest' });
    const guestIn = await waitFor(() => guest.profile, 10000, 'quick play');
    check('quick play signs in with a single request, no form', guestIn);
    check('the quick-play account is playable immediately', !!guest.profile?.guest && guest.profile.level === 1);
    guest.close();

    alpha.send({ t: 'auth.register', name: `AlphaHunter${suffix}`, email: `alpha${suffix}@example.com`, password: 'abcd1234' });
    bravo.send({ t: 'auth.register', name: `BravoHunter${suffix}`, email: `bravo${suffix}@example.com`, password: 'abcd1234' });
    const authed = await waitFor(() => alpha.profile && bravo.profile, 15000, 'registration');
    check('both accounts register and authenticate', authed);
    check('a recovery key is issued at sign-up', !!alpha.byType.get('auth.recoveryCode')?.code);
    check('starting profile is level 1 with 500 coins', alpha.profile?.level === 1 && alpha.profile?.coins === 500);

    // ------------------------------------------------------------- friends
    alpha.send({ t: 'friends.request', name: `BravoHunter${suffix}` });
    const gotRequest = await waitFor(() => bravo.byType.has('friend.request'), 6000, 'friend request');
    check('friend request is delivered', gotRequest);
    bravo.send({ t: 'friends.accept', id: alpha.profile.id });
    const accepted = await waitFor(() => alpha.byType.has('friend.accepted'), 6000, 'friend accept');
    check('friend request can be accepted', accepted);

    // --------------------------------------------------------------- party
    alpha.send({ t: 'party.create' });
    await waitFor(() => alpha.byType.has('party.state'), 5000, 'party');
    const party = alpha.byType.get('party.state')?.party;
    check('party is created with a join code', !!party?.code && party.code.length === 6);
    check('party leader is the creator', party?.leaderId === alpha.profile.id);

    // --------------------------------------------------------------- chat
    alpha.send({ t: 'chat.send', scope: 'global', text: 'مرحباً بالجميع' });
    const chatOk = await waitFor(() => bravo.chat.some((m) => m.text === 'مرحباً بالجميع'), 6000, 'global chat');
    check('global chat delivers Arabic text intact', chatOk);

    // -------------------------------------------------------- matchmaking
    // Leave the party so both queue as solos into the same lobby.
    alpha.send({ t: 'party.leave' });
    await sleep(300);
    alpha.send({ t: 'match.random', mode: 'squad' });
    await sleep(600);
    bravo.send({ t: 'match.random', mode: 'squad' });

    const matched = await waitFor(() => alpha.matchId && bravo.matchId, 15000, 'matchmaking');
    check('both players are matched', matched);
    check('random match puts real players in the SAME lobby', alpha.matchId === bravo.matchId,
      `${alpha.matchId} vs ${bravo.matchId}`);
    check('match.found carries the shared world seed', alpha.seed === bravo.seed && alpha.seed !== 0);
    check('match.found carries the arena centre', !!alpha.arena && typeof alpha.arena.cx === 'number');

    alpha.send({ t: 'match.ready' });
    bravo.send({ t: 'match.ready' });
    const full = await waitFor(() => alpha.fullState && bravo.fullState, 10000, 'full state');
    check('full match state is delivered', full);
    check('landmarks are published for the minimap', (alpha.fullState?.landmarks?.length || 0) > 0);
    check('starting inventory is delivered', !!alpha.inventory && Array.isArray(alpha.inventory.weapons));

    // ------------------------------------------------------ auto-start
    const started = await waitFor(() => alpha.byType.has('match.start') && bravo.byType.has('match.start'), 40000, 'match start');
    check('lobby auto-starts once the minimum player count is met', started);
    check('both clients receive snapshots', alpha.snapshots > 3 && bravo.snapshots > 3,
      `alpha=${alpha.snapshots} bravo=${bravo.snapshots}`);

    // ---------------------------------------------------- leaving the plane
    // Wait until the dropship is over the play area, exactly as a player would.
    const overArena = await waitFor(() => alpha.plane && alpha.plane.active &&
      Math.hypot(alpha.plane.x - alpha.arena.cx, alpha.plane.z - alpha.arena.cz) < 260, 40000, 'dropship over arena');
    check('the dropship flies across the arena', overArena,
      alpha.plane ? `dist=${Math.round(Math.hypot(alpha.plane.x - alpha.arena.cx, alpha.plane.z - alpha.arena.cz))}` : 'no plane data');

    const leavePlane = new Writer(8);
    leavePlane.u8w(OP.C_INTERACT).u16w(0).u8w(1);
    alpha.sendBin(leavePlane);
    bravo.sendBin(leavePlane);

    // Ride the drop down. Keep feeding neutral input so the server keeps
    // simulating both characters while they descend.
    const landed = await waitFor(() => {
      alpha.input(0, 0, 0);
      bravo.input(0, 0, 0);
      return alpha.self && bravo.self && alpha.self.moveState !== Protocol.MOVE.PARACHUTE
        && alpha.self.moveState !== Protocol.MOVE.FALL && alpha.self.y < 140;
    }, 45000, 'landing');
    check('players survive the drop and land', landed && alpha.self.health > 0,
      `hp=${alpha.self?.health} y=${alpha.self?.y?.toFixed(1)} state=${alpha.self?.moveState}`);

    // --------------------------------------------------------------- input
    // Landing spots are random, so a single heading can end up facing a cliff
    // or a tree trunk. Try a few bearings before concluding the player is not
    // being simulated.
    const startPos = alpha.self ? { ...alpha.self } : null;
    let travelled = 0;
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const from = { ...alpha.self };
      for (let i = 0; i < 45; i++) {
        alpha.input(IN.FWD | IN.SPRINT, yaw, 0);
        bravo.input(IN.FWD, yaw + Math.PI / 2, 0);
        await sleep(33);
      }
      await sleep(400);
      travelled = Math.max(travelled, Math.hypot(alpha.self.x - from.x, alpha.self.z - from.z));
      if (travelled > 1) break;
    }
    check('server acknowledges input sequence numbers', alpha.lastAck > 0, `ack=${alpha.lastAck}`);
    check('authoritative movement advances the player', travelled > 1,
      `moved ${travelled.toFixed(2)} m from ${startPos ? `${startPos.x.toFixed(0)},${startPos.z.toFixed(0)}` : '?'}`);

    check('world contains saurians near the players',
      (alpha.maxDinos || 0) + (bravo.maxDinos || 0) > 0,
      `alpha=${alpha.maxDinos || 0} bravo=${bravo.maxDinos || 0}`);
    check('loot is replicated within interest range',
      (alpha.maxLoot || 0) + (bravo.maxLoot || 0) > 0,
      `alpha=${alpha.maxLoot || 0} bravo=${bravo.maxLoot || 0}`);
    check('storm circle is replicated', !!alpha.zone && alpha.zone.radius > 0);
    check('alive counter is replicated', alpha.aliveCount >= 1, `alive=${alpha.aliveCount}`);

    // ---------------------------------------------------------- world edits
    alpha.edits.length = 0;
    bravo.edits.length = 0;
    const px = Math.round(alpha.self.x);
    const pz = Math.round(alpha.self.z);
    // Sweep a small column around the feet; liquids and bedrock are refused by
    // design, so several candidates are attempted.
    for (let dy = 1; dy <= 3; dy++) {
      for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) {
        alpha.build(0, px + ox, Math.floor(alpha.self.y) - dy, pz + oz, 0);
      }
    }
    const edited = await waitFor(() => alpha.edits.length > 0, 6000, 'block edits');
    check('breaking a block produces a replicated edit', edited, `${alpha.edits.length} edits`);
    check('the other player receives the same edit', bravo.edits.length > 0, `${bravo.edits.length} edits`);

    // --------------------------------------------------------------- combat
    const evBefore = alpha.events.length;
    alpha.fire({ x: alpha.self.x, y: alpha.self.y + 1.6, z: alpha.self.z }, { x: 0, y: -0.2, z: 1 });
    await sleep(700);
    check('firing produces world events', alpha.events.length > evBefore || bravo.events.length > 0);

    // -------------------------------------------------------- in-match chat
    bravo.chat.length = 0;
    alpha.send({ t: 'chat.send', scope: 'match', text: 'contact north' });
    const matchChat = await waitFor(() => bravo.chat.some((m) => m.text === 'contact north'), 5000, 'match chat');
    check('in-match chat reaches the other player', matchChat);

    // ---------------------------------------------------------------- voice
    alpha.send({ t: 'voice.enable', enabled: true });
    bravo.send({ t: 'voice.enable', enabled: true });
    alpha.send({ t: 'voice.join' });
    bravo.send({ t: 'voice.join' });
    const voiceOk = await waitFor(() => alpha.voicePeers.length > 0 || bravo.voicePeers.length > 0, 8000, 'voice peers');
    check('voice peer lists are published by the server', voiceOk,
      `alpha=${alpha.voicePeers.length} bravo=${bravo.voicePeers.length}`);
    if (alpha.voicePeers.length) {
      check('exactly one side is elected WebRTC initiator', alpha.voicePeers[0].initiator !== bravo.voicePeers[0]?.initiator);
    } else {
      check('exactly one side is elected WebRTC initiator', false, 'no peers published');
    }
    // A peer we share no channel with must be refused.
    alpha.send({ t: 'voice.signal', to: 'u_does_not_exist', kind: 'offer', data: { type: 'offer', sdp: 'x' } });
    await sleep(400);
    const refused = alpha.messages.some((m) => m.t === 'error' && m.code === 'voice');
    check('signalling to an unauthorised peer is refused', refused);

    // ------------------------------------------------------------- cheating
    // A build request far out of reach must be ignored.
    const before = alpha.edits.length;
    alpha.build(1, px + 60, 70, pz + 60, 56);
    await sleep(600);
    check('out-of-reach building is rejected by the server', alpha.edits.length === before);

    // Flooding inputs must not crash or desync the server.
    for (let i = 0; i < 400; i++) alpha.input(IN.FWD | IN.JUMP, Math.random() * 6, 0);
    await sleep(1000);
    check('input flooding is absorbed without dropping the client', alpha.ws.readyState === 1 && alpha.snapshots > 5);

    // ------------------------------------------------------------ leaderboard
    alpha.send({ t: 'leaderboard.get', board: 'level', scope: 'global' });
    const lb = await waitFor(() => alpha.byType.has('leaderboard'), 5000, 'leaderboard');
    check('leaderboard responds', lb);

    // ------------------------------------------------------------- teardown
    bravo.send({ t: 'match.leave' });
    await sleep(1200);
    check('a player can leave a live match', bravo.byType.has('match.left'));

    alpha.close();
    bravo.close();
    await sleep(500);
    check('server stays healthy after clients disconnect', server.exitCode === null);
  } catch (err) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m unexpected failure: ${err.message}`);
    console.log(err.stack);
  } finally {
    cleanup();
  }

  if (failed > 0) {
    const errs = serverLog.join('').split('\n').filter((l) => /error|failed|Error/i.test(l)).slice(0, 30);
    if (errs.length) {
      console.log('\n\x1b[33mserver diagnostics:\x1b[0m');
      for (const l of errs) console.log('  ' + l);
    }
  }

  console.log('');
  if (failed === 0) {
    console.log(`\x1b[32m\x1b[1m  ${passed} integration checks passed\x1b[0m\n`);
    process.exit(0);
  } else {
    console.log(`\x1b[31m\x1b[1m  ${failed} failed, ${passed} passed\x1b[0m\n`);
    process.exit(1);
  }
})();
