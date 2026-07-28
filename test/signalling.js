#!/usr/bin/env node
'use strict';
/**
 * ============================================================================
 *  Dino Royale Evolution - SIGNALLING SUITE
 * ============================================================================
 *  Exercises client/signal.js against a real MQTT broker rather than a mock,
 *  because the thing most likely to break is the framing itself.
 *
 *  This is the layer that lets two browsers find each other when there is no
 *  game server at all. Nothing about gameplay travels over it - only the
 *  handshakes that set up a direct connection - but if it is wrong, nobody
 *  can reach anybody, so it gets its own suite.
 * ============================================================================
 */

const { TestBroker } = require('./mqtt-broker.js');
const Signal = require('../client/signal.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function group(name) {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

(async () => {
  console.log('\n\x1b[1mSignalling (MQTT over WebSocket)\x1b[0m');

  const PORT = 18700 + Math.floor(Math.random() * 200);
  const broker = new TestBroker();
  await broker.listen(PORT);
  const URL = `ws://127.0.0.1:${PORT}/mqtt`;
  const open = [];
  const mk = async (id, brokers = [URL]) => {
    const s = new Signal({ brokers, selfId: id });
    await s.connect();
    open.push(s);
    return s;
  };

  // -------------------------------------------------------------- framing --
  group('Packet framing');

  const { encodeLength, decodeLength } = Signal._internals;
  let lenOk = true;
  let lenDetail = '';
  for (const n of [0, 1, 127, 128, 16383, 16384, 2097151, 2097152, 268435455]) {
    const enc = encodeLength(n);
    const dec = decodeLength(Uint8Array.from([0, ...enc]), 1);
    if (!dec || dec.value !== n || dec.size !== enc.length) {
      lenOk = false;
      lenDetail = `n=${n} -> ${JSON.stringify(dec)}`;
      break;
    }
  }
  check('variable-length integers round-trip across every byte boundary', lenOk, lenDetail);
  check('a fifth continuation byte is rejected as malformed',
    decodeLength(Uint8Array.from([0, 0x80, 0x80, 0x80, 0x80, 0x01]), 1) === null);
  check('a truncated length field asks for more bytes rather than guessing',
    decodeLength(Uint8Array.from([0, 0x80]), 1) === null);

  // ---------------------------------------------------------- room routing --
  group('Room routing');

  const alpha = await mk('alpha');
  const bravo = await mk('bravo');
  check('peers complete the MQTT handshake', alpha.client.connected && bravo.client.connected);

  const aGot = [];
  const bGot = [];
  alpha.onRoomMessage = (m) => aGot.push(m);
  bravo.onRoomMessage = (m) => bGot.push(m);
  alpha.joinRoom('ROOM1');
  bravo.joinRoom('ROOM1');
  await sleep(200);

  bravo.sendRoom({ t: 'hello', payload: 'x'.repeat(600) });
  await sleep(250);
  check('a room message reaches the other peer', aGot.length === 1 && aGot[0].t === 'hello');
  check('a payload larger than one length byte survives framing', aGot[0]?.payload?.length === 600);
  check('the sender does not receive its own message back', bGot.length === 0, `got ${bGot.length}`);

  aGot.length = 0;
  bravo.sendRoom({ t: 'direct', to: 'alpha' });
  bravo.sendRoom({ t: 'elsewhere', to: 'carol' });
  await sleep(250);
  check('addressed messages are filtered by recipient',
    aGot.length === 1 && aGot[0].t === 'direct', JSON.stringify(aGot.map((m) => m.t)));

  const carol = await mk('carol');
  const cGot = [];
  carol.onRoomMessage = (m) => cGot.push(m);
  carol.joinRoom('ROOM2');
  await sleep(200);
  aGot.length = 0;
  bravo.sendRoom({ t: 'room1only' });
  await sleep(250);
  check('a peer in a different room hears nothing', cGot.length === 0 && aGot.length === 1);

  alpha.leaveRoom();
  await sleep(200);
  aGot.length = 0;
  bravo.sendRoom({ t: 'afterleave' });
  await sleep(250);
  check('leaving a room stops delivery', aGot.length === 0, `got ${aGot.length}`);

  // ------------------------------------------------------ room discovery ---
  group('Room discovery');

  // The listing is retained by the broker, so a browser that opens long after
  // the room did still finds it without the host having to be mid-announce.
  const host = await mk('host');
  host.subscribeLobby();
  host.publishListing('ABC123', {
    t: 'room.open', code: 'ABC123', mode: 'squad', players: 1, max: 48, at: Date.now(),
  });
  await sleep(250);

  const late = await mk('late');
  const lateSeen = [];
  late.onLobbyMessage = (m) => lateSeen.push(m);
  late.subscribeLobby();
  await sleep(400);
  check('a browser opening later immediately sees an already-open room',
    lateSeen.some((m) => m.t === 'room.open' && m.code === 'ABC123'), JSON.stringify(lateSeen));

  host.publishListing('ABC123', null);
  await sleep(300);
  check('withdrawing a room notifies everyone listening',
    lateSeen.some((m) => m.t === 'room.closed' && m.code === 'ABC123'));

  const later = await mk('later');
  const laterSeen = [];
  later.onLobbyMessage = (m) => laterSeen.push(m);
  later.subscribeLobby();
  await sleep(400);
  check('a withdrawn room is never advertised again',
    !laterSeen.some((m) => m.t === 'room.open'), JSON.stringify(laterSeen));

  // ----------------------------------------------------------- failover ----
  group('Broker failover');

  const failover = new Signal({
    brokers: ['ws://127.0.0.1:1/mqtt', 'ws://127.0.0.1:2/mqtt', URL],
    selfId: 'failover',
  });
  const chosen = await failover.connect();
  open.push(failover);
  check('dead brokers are skipped and a live one is used', chosen === URL, String(chosen));

  let threw = false;
  try {
    await new Signal({ brokers: ['ws://127.0.0.1:1/mqtt'], selfId: 'dead' }).connect();
  } catch {
    threw = true;
  }
  check('a total outage reports an error instead of hanging forever', threw);

  check('the shipped broker list is public infrastructure needing no account',
    Signal.DEFAULT_BROKERS.length >= 3 && Signal.DEFAULT_BROKERS.every((u) => u.startsWith('wss://')),
    Signal.DEFAULT_BROKERS.join(', '));

  for (const s of open) s.close();
  await sleep(200);
  broker.close();

  console.log('');
  if (failed === 0) {
    console.log(`\x1b[32m\x1b[1m  ${passed} signalling checks passed\x1b[0m\n`);
    process.exit(0);
  }
  console.log(`\x1b[31m\x1b[1m  ${failed} failed, ${passed} passed\x1b[0m`);
  for (const f of failures) console.log(`\x1b[31m  ${f}\x1b[0m`);
  console.log('');
  process.exit(1);
})().catch((err) => {
  console.error('\x1b[31mSignalling suite crashed\x1b[0m');
  console.error(err.stack || err.message);
  process.exit(2);
});
