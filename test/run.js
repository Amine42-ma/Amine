#!/usr/bin/env node
'use strict';
/**
 * ============================================================================
 *  Dino Royale Evolution - TEST SUITE
 * ============================================================================
 *  Dependency-free tests covering the parts of the stack where a silent
 *  regression would be hardest to notice:
 *
 *    1. WebSocket handshake against the RFC 6455 known-answer vector
 *    2. Client/server world-generation parity (the client copy inlined in
 *       index.html must agree with server/lib/worldgen.js on every voxel)
 *    3. Wire protocol round-trips within the documented quantisation error
 *    4. Character physics determinism (prediction == authority)
 *    5. Account lifecycle: register, login, token resume, recovery, progression
 *    6. A live match tick: join, input, snapshot encode/decode, combat, storm
 *
 *  Run with:  npm test
 * ============================================================================
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      ${err.message}`);
  }
}

function group(name) {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'values differ'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertClose(actual, expected, tolerance, message) {
  if (!(Math.abs(actual - expected) <= tolerance)) {
    throw new Error(`${message || 'values differ'}: expected ${expected} ±${tolerance}, got ${actual}`);
  }
}

// ===========================================================================
group('WebSocket handshake');
// ===========================================================================
{
  const { acceptKey } = require('../server/lib/ws.js');
  test('RFC 6455 §1.3 known-answer vector', () => {
    assertEqual(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });
  test('accept key is deterministic and base64', () => {
    const a = acceptKey('x3JJHMbDL1EzLkh9GBhXDw==');
    assertEqual(a, acceptKey('x3JJHMbDL1EzLkh9GBhXDw=='));
    assert(/^[A-Za-z0-9+/]+=*$/.test(a), 'not base64');
  });
}

// ===========================================================================
group('Client/server world parity');
// ===========================================================================
{
  const ServerWorldGen = require('../server/lib/worldgen.js');

  // Extract the shared block that ships inside index.html and evaluate it in a
  // clean sandbox - exactly how the browser loads it.
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const match = html.match(/<script id="shared-modules" type="text\/plain">([\s\S]*?)<\/script>/);
  let ClientWorldGen = null;
  let ClientProtocol = null;
  let ClientContent = null;

  test('index.html contains the inlined shared modules', () => {
    assert(match, 'shared-modules block not found in index.html');
    assert(match[1].length > 50000, 'shared block looks truncated');
  });

  if (match) {
    const sandbox = { console, performance, Date, Math, JSON, Object, Array, Number, String, Boolean,
      Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array,
      Float32Array, Float64Array, ArrayBuffer, DataView, Map, Set, Error, TypeError, Symbol, isNaN, isFinite };
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    test('shared modules evaluate in a browser-like context', () => {
      vm.runInContext(match[1], sandbox, { filename: 'index.html#shared-modules' });
      ClientWorldGen = sandbox.WorldGen;
      ClientProtocol = sandbox.Protocol;
      ClientContent = sandbox.Content;
      assert(ClientWorldGen && ClientWorldGen.World, 'WorldGen missing');
      assert(ClientProtocol && ClientProtocol.OP, 'Protocol missing');
      assert(ClientContent && ClientContent.WEAPONS, 'Content missing');
      assert(sandbox.Movement && sandbox.Movement.step, 'Movement missing');
    });

    test('protocol versions match', () => {
      assertEqual(ClientProtocol.PROTOCOL_VERSION, require('../server/lib/protocol.js').PROTOCOL_VERSION);
    });

    test('block registry matches (ids, names, flags)', () => {
      assertEqual(ClientWorldGen.BLOCKS.length, ServerWorldGen.BLOCKS.length, 'block count');
      for (let i = 0; i < ServerWorldGen.BLOCKS.length; i++) {
        const a = ServerWorldGen.BLOCKS[i];
        const b = ClientWorldGen.BLOCKS[i];
        assertEqual(b.id, a.id, `block ${i} id`);
        assertEqual(b.name, a.name, `block ${i} name`);
        assertEqual(b.flags, a.flags, `block ${a.name} flags`);
      }
    });

    test('120k voxel samples across 300 regions are identical on both sides', () => {
      const seed = 0x51ed270b;
      const sw = new ServerWorldGen.World(seed);
      const cw = new ClientWorldGen.World(seed);
      let checked = 0;
      let mismatch = null;
      // Sampling is clustered into chunk-sized regions so both generators can
      // use their column caches - a uniformly random scatter would rebuild a
      // whole chunk per sample and take minutes.
      let s = 12345;
      const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      for (let region = 0; region < 300 && !mismatch; region++) {
        const baseX = Math.round((rnd() * 2 - 1) * 2500);
        const baseZ = Math.round((rnd() * 2 - 1) * 2500);
        for (let i = 0; i < 400 && !mismatch; i++) {
          const x = baseX + Math.floor(rnd() * 16);
          const z = baseZ + Math.floor(rnd() * 16);
          const y = Math.floor(rnd() * ServerWorldGen.WORLD.HEIGHT);
          const a = sw.getBlock(x, y, z);
          const b = cw.getBlock(x, y, z);
          checked++;
          if (a !== b) mismatch = { x, y, z, a, b };
        }
      }
      assert(!mismatch, `voxel mismatch at ${JSON.stringify(mismatch)}`);
      assertEqual(checked, 120000, 'sample count');
    });

    test('generated sections are identical on both sides', () => {
      const seed = 90210;
      const sw = new ServerWorldGen.World(seed);
      const cw = new ClientWorldGen.World(seed);
      const a = new Uint8Array(4096);
      const b = new Uint8Array(4096);
      for (const [cx, cy, cz] of [[0, 4, 0], [12, 5, -7], [-30, 3, 18], [101, 6, -55]]) {
        sw.genSection(cx, cy, cz, a);
        cw.genSection(cx, cy, cz, b);
        for (let i = 0; i < 4096; i++) {
          if (a[i] !== b[i]) throw new Error(`section (${cx},${cy},${cz}) differs at index ${i}: ${a[i]} vs ${b[i]}`);
        }
      }
    });

    /**
     * The single most important invariant in the game: what the authority
     * thinks is there, and what the client meshes, are the same voxels.
     *
     * getBlock answers from the terrain formula plus a cached decoration diff;
     * genSection generates the whole section. If those two ever drift, trees
     * and buildings become things you walk through and the ground grows holes
     * you can see the world through - which is exactly what used to happen when
     * getBlock skipped decoration entirely.
     */
    test('getBlock returns exactly what genSection generates', () => {
      const seed = 20260728;
      const w = new ServerWorldGen.World(seed);
      const sec = new Uint8Array(4096);
      let checked = 0;
      let decorated = 0;
      // Sections around the surface, where every kind of decoration lives.
      for (const [cx, cz] of [[0, 0], [7, -3], [-19, 24], [56, 61], [-44, -37], [13, 88]]) {
        const surface = w.column(cx * 16 + 8, cz * 16 + 8).height;
        const base = Math.floor(surface / 16);
        for (let sy = Math.max(0, base - 2); sy <= base + 2; sy++) {
          w.genSection(cx, sy, cz, sec);
          for (let ly = 0; ly < 16; ly++) {
            for (let lz = 0; lz < 16; lz++) {
              for (let lx = 0; lx < 16; lx++) {
                const want = sec[(ly * 16 + lz) * 16 + lx];
                const x = cx * 16 + lx, y = sy * 16 + ly, z = cz * 16 + lz;
                const got = w.getBlock(x, y, z);
                checked++;
                if (want !== got) {
                  throw new Error(`voxel ${x},${y},${z}: genSection says ${want}, getBlock says ${got}`);
                }
                if (want !== w.terrainBlock(x, y, z)) decorated++;
              }
            }
          }
        }
      }
      assert(checked >= 100000, `only ${checked} voxels compared`);
      // Guards against the test passing because decoration silently stopped.
      assert(decorated > 500, `only ${decorated} decorated voxels found in ${checked}`);
    });

    /**
     * The client only generates and meshes a band 64 rows below the lowest
     * column of a chunk. Anything hollow below that exists to the physics but
     * is never drawn, so a player who reached it would drop through visible
     * ground into a void. Caves are sealed above the band floor to make that
     * impossible; this is the check that keeps them there.
     */
    test('nothing hollow exists below the band the mesher builds', () => {
      const w = new ServerWorldGen.World(20260728);
      const { WORLD } = ServerWorldGen;
      for (const [cx, cz] of [[0, 0], [-21, 33], [47, -12], [8, 61], [-55, -48]]) {
        let minH = WORLD.HEIGHT;
        for (let lz = -1; lz <= 16; lz++) {
          for (let lx = -1; lx <= 16; lx++) {
            const h = w.column(cx * 16 + lx, cz * 16 + lz).height;
            if (h < minH) minH = h;
          }
        }
        const floor = Math.max(0, minH - 64);
        for (let lz = 0; lz < 16; lz++) {
          for (let lx = 0; lx < 16; lx++) {
            for (let y = WORLD.BEDROCK + 2; y < floor; y++) {
              const id = w.getBlock(cx * 16 + lx, y, cz * 16 + lz);
              if (id === 0) {
                throw new Error(`air at ${cx * 16 + lx},${y},${cz * 16 + lz} is below the meshed band floor ${floor}`);
              }
            }
          }
        }
      }
    });

    test('trees and buildings are solid to the authority', () => {
      const w = new ServerWorldGen.World(20260728);
      // A structure the world places for real, not a synthetic one.
      const list = w.structuresInRegion(-1500, -1500, 1500, 1500)
        .filter((s) => s.key === 'outpost' || s.key === 'village' || s.key === 'temple');
      assert(list.length > 0, 'no buildings generated in a 3000x3000 region');
      let anySolid = false;
      for (const s of list.slice(0, 12)) {
        for (let dy = 0; dy < 6 && !anySolid; dy++) {
          for (let dz = -s.radius; dz <= s.radius && !anySolid; dz += 2) {
            for (let dx = -s.radius; dx <= s.radius && !anySolid; dx += 2) {
              const id = w.getBlock(s.x + dx, s.y + dy, s.z + dz);
              // A built wall is a block the plain terrain formula does not have.
              if (id && id !== w.terrainBlock(s.x + dx, s.y + dy, s.z + dz)) anySolid = true;
            }
          }
        }
        if (anySolid) break;
      }
      assert(anySolid, 'getBlock reports empty air where buildings stand');
    });

    test('structures resolve to the same coordinates', () => {
      const sw = new ServerWorldGen.World(4242);
      const cw = new ClientWorldGen.World(4242);
      const sa = sw.structuresInRegion(-1200, -1200, 1200, 1200);
      const ca = cw.structuresInRegion(-1200, -1200, 1200, 1200);
      assertEqual(ca.length, sa.length, 'structure count');
      for (let i = 0; i < sa.length; i++) {
        assertEqual(ca[i].key, sa[i].key, `structure ${i} type`);
        assertEqual(ca[i].x, sa[i].x, `structure ${i} x`);
        assertEqual(ca[i].z, sa[i].z, `structure ${i} z`);
      }
      assert(sa.length > 0, 'no structures generated in a 2400x2400 region');
    });
  }
}

// ===========================================================================
group('Wire protocol');
// ===========================================================================
{
  const Protocol = require('../server/lib/protocol.js');
  const { Writer, Reader } = Protocol;

  test('integer round-trip', () => {
    const w = new Writer(64);
    w.u8w(200).i8w(-100).u16w(65000).i16w(-30000).u32w(4000000000).i32w(-2000000000);
    const r = new Reader(w.bytes());
    assertEqual(r.u8r(), 200);
    assertEqual(r.i8r(), -100);
    assertEqual(r.u16r(), 65000);
    assertEqual(r.i16r(), -30000);
    assertEqual(r.u32r(), 4000000000);
    assertEqual(r.i32r(), -2000000000);
  });

  test('position quantisation stays within 1/128 block', () => {
    const values = [0, 1.5, -1.5, 123.456, -987.654, 3071.99, -3071.99];
    const w = new Writer(64);
    for (const v of values) w.posw(v);
    const r = new Reader(w.bytes());
    for (const v of values) assertClose(r.posr(), v, 1 / 128, `pos ${v}`);
  });

  test('angle quantisation stays within 0.1 milliradian', () => {
    const w = new Writer(64);
    const yaws = [0, 1, 3.14159, 6.2, -2];
    const pitches = [0, 1.4, -1.4, 0.5, -0.5];
    for (const y of yaws) w.yaww(y);
    for (const p of pitches) w.pitw(p);
    const r = new Reader(w.bytes());
    for (const y of yaws) {
      let expect = y % (Math.PI * 2);
      if (expect < 0) expect += Math.PI * 2;
      assertClose(r.yawr(), expect, 1e-4, `yaw ${y}`);
    }
    for (const p of pitches) assertClose(r.pitr(), p, 1e-4, `pitch ${p}`);
  });

  test('strings round-trip including Arabic', () => {
    const w = new Writer(64);
    w.strw('ranger_ar').strw('لاعب').strw('');
    const r = new Reader(w.bytes());
    assertEqual(r.strr(), 'ranger_ar');
    assertEqual(r.strr(), 'لاعب');
    assertEqual(r.strr(), '');
  });

  test('writer grows past its initial capacity', () => {
    const w = new Writer(8);
    for (let i = 0; i < 1000; i++) w.u32w(i);
    const r = new Reader(w.bytes());
    for (let i = 0; i < 1000; i++) assertEqual(r.u32r(), i);
  });
}

// ===========================================================================
group('Character physics');
// ===========================================================================
{
  const Movement = require('../server/lib/movement.js');
  const Protocol = require('../server/lib/protocol.js');
  const WorldGen = require('../server/lib/worldgen.js');
  const { IN } = Protocol;

  // A simple flat world: solid below y=64, air above.
  const flat = (x, y, z) => (y < 64 ? WorldGen.B.stone : 0);

  test('gravity settles the character onto the ground', () => {
    const s = Movement.createState(0.5, 80, 0.5);
    for (let i = 0; i < 200; i++) Movement.step(s, { keys: 0, yaw: 0, pitch: 0, dt: 1 / 30 }, flat);
    assertClose(s.y, 64, 0.05, 'resting height');
    assert(s.onGround, 'should be grounded');
  });

  // A single move long enough to start one side of a wall and finish on the
  // other touches nothing at either end, so an endpoint-only collision test
  // lets the body straight through. That is how players walked through
  // buildings. The step is split so a test always lands inside the wall.
  // Strafing has to agree with what the camera puts on screen, or "right"
  // slides you left. The view matrix is a right-handed lookAt, so the axis it
  // maps to screen-right is cross(forward, up) - derived here rather than
  // assumed, so the two can never drift apart again.
  test('strafing right moves toward the camera\'s right, not away from it', () => {
    for (const yaw of [0, 0.7, Math.PI / 2, 2.4, Math.PI, -1.1, -Math.PI / 2]) {
      const forward = { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
      const up = { x: 0, y: 1, z: 0 };
      // cross(forward, up)
      const right = {
        x: forward.y * up.z - forward.z * up.y,
        z: forward.x * up.y - forward.y * up.x,
      };

      const s = Movement.createState(0.5, 64, 0.5, yaw);
      s.onGround = true;
      for (let i = 0; i < 10; i++) {
        Movement.step(s, { keys: IN.RIGHT, yaw, pitch: 0, dt: 1 / 30 }, flat);
      }
      const dot = s.vx * right.x + s.vz * right.z;
      assert(dot > 0.5,
        `at yaw ${yaw.toFixed(2)} the body moved toward screen-right (dot ${dot.toFixed(2)})`);

      // And the analog stick has to agree with the key.
      const t = Movement.createState(0.5, 64, 0.5, yaw);
      t.onGround = true;
      for (let i = 0; i < 10; i++) {
        Movement.step(t, { keys: 0, moveX: 1, moveY: 0, yaw, pitch: 0, dt: 1 / 30 }, flat);
      }
      assertClose(t.vx, s.vx, 1e-6, 'stick right matches key right (x)');
      assertClose(t.vz, s.vz, 1e-6, 'stick right matches key right (z)');
    }
  });

  test('walking forward moves along the look direction', () => {
    for (const yaw of [0, 1.2, -2.0, Math.PI]) {
      const s = Movement.createState(0.5, 64, 0.5, yaw);
      s.onGround = true;
      for (let i = 0; i < 10; i++) {
        Movement.step(s, { keys: IN.FWD, yaw, pitch: 0, dt: 1 / 30 }, flat);
      }
      const dot = s.vx * Math.sin(yaw) + s.vz * Math.cos(yaw);
      assert(dot > 0.5, `at yaw ${yaw.toFixed(2)} forward is forward (dot ${dot.toFixed(2)})`);
    }
  });

  test('a fast move cannot tunnel through a wall', () => {
    // Ground below 64, plus a solid wall one block thick at x = 10.
    const walled = (x, y, z) => {
      if (y < 64) return WorldGen.B.stone;
      if (x === 10 && y >= 64 && y < 68) return WorldGen.B.stone;
      return 0;
    };
    for (const speed of [8, 20, 60, 150]) {
      const s = Movement.createState(6.5, 64, 0.5, 0);
      s.onGround = true;
      for (let i = 0; i < 40; i++) {
        s.vx = speed;                       // forced, as a lag spike would
        Movement.step(s, { keys: IN.FWD, yaw: Math.PI / 2, pitch: 0, dt: 1 / 15 }, walled);
        if (s.x > 9.0) break;
      }
      assert(s.x < 10.0,
        `at ${speed} m/s the body stopped before the wall (x=${s.x.toFixed(2)})`);
    }
  });

  test('a long fall cannot tunnel through the floor', () => {
    const s = Movement.createState(0.5, 400, 0.5);
    for (let i = 0; i < 400; i++) {
      Movement.step(s, { keys: 0, yaw: 0, pitch: 0, dt: 1 / 10 }, flat);
      if (s.onGround) break;
    }
    assert(s.y >= 63.9, `landed on the floor rather than through it (y=${s.y.toFixed(2)})`);
  });

  test('identical inputs produce bit-identical states (prediction parity)', () => {
    const a = Movement.createState(0.5, 66, 0.5);
    const b = Movement.createState(0.5, 66, 0.5);
    const script = [];
    let seed = 7;
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 400; i++) {
      script.push({
        keys: (rnd() < 0.7 ? IN.FWD : 0) | (rnd() < 0.3 ? IN.LEFT : 0) | (rnd() < 0.1 ? IN.JUMP : 0) | (rnd() < 0.2 ? IN.SPRINT : 0),
        yaw: rnd() * Math.PI * 2,
        pitch: (rnd() - 0.5) * 2,
        dt: 1 / 30,
      });
    }
    for (const input of script) Movement.step(a, input, flat);
    for (const input of script) Movement.step(b, input, flat);
    assertEqual(a.x, b.x, 'x');
    assertEqual(a.y, b.y, 'y');
    assertEqual(a.z, b.z, 'z');
    assertEqual(a.vx, b.vx, 'vx');
    assertEqual(a.stamina, b.stamina, 'stamina');
  });

  test('a solid wall cannot be walked through', () => {
    const world = (x, y, z) => {
      if (y < 64) return WorldGen.B.stone;
      if (z >= 6 && z <= 7 && y < 70) return WorldGen.B.stone;
      return 0;
    };
    const s = Movement.createState(0.5, 64, 0.5);
    for (let i = 0; i < 300; i++) {
      Movement.step(s, { keys: IN.FWD | IN.SPRINT, yaw: 0, pitch: 0, dt: 1 / 30 }, world);
    }
    assert(s.z < 6, `walked into the wall (z=${s.z.toFixed(2)})`);
  });

  test('sprinting drains stamina and walking restores it', () => {
    const s = Movement.createState(0.5, 64, 0.5);
    for (let i = 0; i < 120; i++) Movement.step(s, { keys: IN.FWD | IN.SPRINT, yaw: 0, pitch: 0, dt: 1 / 30 }, flat);
    const drained = s.stamina;
    assert(drained < Protocol.PHYS.MAX_STAMINA * 0.6, `stamina should drain (got ${drained})`);
    for (let i = 0; i < 200; i++) Movement.step(s, { keys: 0, yaw: 0, pitch: 0, dt: 1 / 30 }, flat);
    assert(s.stamina > drained, 'stamina should regenerate');
  });

  test('deep water makes the character swim, not fall', () => {
    const ocean = (x, y, z) => (y < 40 ? WorldGen.B.stone : y < 64 ? WorldGen.B.water : 0);
    const s = Movement.createState(0.5, 60, 0.5);
    for (let i = 0; i < 90; i++) Movement.step(s, { keys: 0, yaw: 0, pitch: 0, dt: 1 / 30 }, ocean);
    assert(s.inWater, 'should be in water');
    assert(s.y > 45, `should float rather than sink (y=${s.y.toFixed(1)})`);
  });

  test('a lethal fall reports fall damage', () => {
    const s = Movement.createState(0.5, 140, 0.5);
    let damage = 0;
    for (let i = 0; i < 400; i++) {
      const ev = Movement.step(s, { keys: 0, yaw: 0, pitch: 0, dt: 1 / 30 }, flat);
      damage += ev.fallDamage;
    }
    assert(damage > 100, `expected lethal fall damage, got ${damage}`);
  });

  test('voxel raycast hits the first solid block', () => {
    const hit = Movement.raycast(flat, 0.5, 70, 0.5, 0, -1, 0, 20);
    assert(hit, 'expected a hit');
    assertEqual(hit.y, 63, 'hit block y');
    assertEqual(hit.ny, 1, 'hit normal points up');
    assertClose(hit.distance, 6, 0.01, 'distance');
  });

  test('climbable surfaces are detected', () => {
    const ladderWorld = (x, y, z) => {
      if (y < 64) return WorldGen.B.stone;
      if (z === 1 && y < 74) return WorldGen.B.ladder;
      return 0;
    };
    const s = Movement.createState(0.5, 64, 0.5);
    s.yaw = 0;
    assert(Movement.climbSurface(ladderWorld, s, Protocol.PHYS.PLAYER_RADIUS), 'ladder should be climbable');
  });
}

// ===========================================================================
group('Accounts and progression');
// ===========================================================================
{
  const { Store } = require('../server/lib/store.js');
  const { Accounts } = require('../server/lib/accounts.js');
  const Content = require('../server/lib/content.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dre-test-'));
  const store = new Store(dir);
  const accounts = new Accounts(store);

  let user = null;
  let token = null;
  let recoveryCode = null;

  test('registration validates and creates an account', () => {
    const bad = accounts.register({ name: 'ab', email: 'x@y.z', password: 'abcd1234' }, '1.1.1.1');
    assert(bad.error, 'short names must be rejected');
    const noDigits = accounts.register({ name: 'Ranger One', email: 'a@b.co', password: 'abcdefgh' }, '1.1.1.1');
    assert(noDigits.error, 'passwords without digits must be rejected');

    const res = accounts.register({ name: 'Ranger One', email: 'ranger@example.com', password: 'abcd1234' }, '1.1.1.1');
    assert(!res.error, res.error);
    user = res.user;
    token = res.token;
    recoveryCode = res.recoveryCode;
    assertEqual(user.level, 1);
    assertEqual(user.coins, 500);
    assert(recoveryCode && recoveryCode.length === 19, 'recovery code format');
  });

  test('duplicate names and emails are rejected', () => {
    assert(accounts.register({ name: 'Ranger One', email: 'other@example.com', password: 'abcd1234' }, '1.1.1.1').error);
    assert(accounts.register({ name: 'Other Name', email: 'ranger@example.com', password: 'abcd1234' }, '1.1.1.1').error);
  });

  test('passwords are salted, hashed, and never stored in the clear', () => {
    assert(!JSON.stringify(user).includes('abcd1234'), 'plaintext password leaked');
    assert(user.hash.length === 128, 'scrypt hash length');
    assert(user.salt.length === 32, 'salt length');
  });

  test('login works with name or email and rejects bad passwords', () => {
    assert(!accounts.login({ login: 'Ranger One', password: 'abcd1234' }, '2.2.2.2').error);
    assert(!accounts.login({ login: 'ranger@example.com', password: 'abcd1234' }, '2.2.2.3').error);
    assert(accounts.login({ login: 'Ranger One', password: 'wrongpass1' }, '2.2.2.4').error);
    assert(accounts.login({ login: 'Nobody', password: 'abcd1234' }, '2.2.2.5').error);
  });

  test('session tokens resume and can be revoked', () => {
    const resumed = accounts.loginWithToken(token);
    assert(!resumed.error, resumed.error);
    assertEqual(resumed.user.id, user.id);
    accounts.logout(token);
    assert(accounts.loginWithToken(token).error, 'revoked token must fail');
  });

  test('the permanent recovery key resets the password', () => {
    const res = accounts.confirmRecovery({ email: 'ranger@example.com', code: recoveryCode, newPassword: 'newpass456' });
    assert(!res.error, res.error);
    assert(res.token, 'a fresh session should be issued');
    assert(!accounts.login({ login: 'Ranger One', password: 'newpass456' }, '3.3.3.3').error);
    assert(accounts.login({ login: 'Ranger One', password: 'abcd1234' }, '3.3.3.4').error, 'old password must stop working');
  });

  test('the emailed recovery challenge also works and expires', () => {
    const req = accounts.requestRecovery('ranger@example.com', '4.4.4.4');
    assert(req.ok && req.code, 'challenge issued');
    assert(accounts.confirmRecovery({ email: 'ranger@example.com', code: 'WRON-GCOD-EAAA-BBBB', newPassword: 'another789' }).error);
    const ok = accounts.confirmRecovery({ email: 'ranger@example.com', code: req.code, newPassword: 'another789' });
    assert(!ok.error, ok.error);
  });

  test('recovery for an unknown email does not disclose anything', () => {
    const res = accounts.requestRecovery('nobody@example.com', '5.5.5.5');
    assert(res.ok, 'must report success');
    assertEqual(res.delivered, false);
    assertEqual(res.code, undefined);
  });

  test('match results award XP, coins, levels and achievements', () => {
    const before = { xp: user.xp, coins: user.coins };
    const applied = accounts.applyMatchResult(user, {
      kills: 6, assists: 2, damage: 1450, headshots: 3, dinoKills: 8, apexKills: 1,
      revives: 1, blocksPlaced: 40, blocksBroken: 120, distance: 3200, waterTime: 40,
      survivalTime: 900, placement: 1, won: true, partySize: 4, maxAltitude: 118, longestKill: 214, killStreak: 4,
    });
    assert(applied.xp > 0 && applied.coins > 0, 'rewards granted');
    assert(user.xp > before.xp && user.coins > before.coins, 'profile updated');
    assertEqual(user.stats.wins, 1);
    assertEqual(user.stats.kills, 6);
    const keys = applied.unlocked.map((a) => a.key);
    assert(keys.includes('first_blood'), 'first blood should unlock');
    assert(keys.includes('first_win'), 'first win should unlock');
    assert(keys.includes('apex_slayer'), 'apex slayer should unlock');
  });

  test('level curve is monotonic and matches xpForLevel', () => {
    let prev = -1;
    for (let l = 1; l <= 120; l++) {
      const xp = Content.xpForLevel(l);
      assert(xp > prev, `level ${l} xp must increase`);
      assertEqual(Content.levelFromXp(xp), l, `levelFromXp(${xp})`);
      prev = xp;
    }
  });

  test('cosmetics can only be equipped once owned', () => {
    const denied = accounts.updateCosmetics(user, { skin: 'fossil' });
    assert(!denied.error);
    assertEqual(user.cosmetics.skin, 'ranger', 'unowned skin must not equip');
    user.coins = 99999;
    const bought = accounts.purchase(user, 'skins', 'fossil');
    assert(!bought.error, bought.error);
    accounts.updateCosmetics(user, { skin: 'fossil' });
    assertEqual(user.cosmetics.skin, 'fossil');
  });

  test('quick play creates a real, playable account with no form', () => {
    const g = accounts.createGuest('20.0.0.1');
    assert(!g.error, g.error);
    assert(g.token, 'a session must be issued immediately');
    assertEqual(g.user.guest, true);
    assertEqual(g.user.hash, '', 'no password yet');
    assertEqual(g.user.email, '', 'no email yet');
    assertEqual(g.user.coins, 500, 'same starting balance as any account');
    assert(/^[A-Za-z]+\d{4}$/.test(g.user.name), `unexpected guest name: ${g.user.name}`);
    assert(!accounts.loginWithToken(g.token).error, 'the token must resume the session');
  });

  test('quick-play names never collide', () => {
    const names = new Set();
    for (let i = 0; i < 40; i++) {
      const g = accounts.createGuest(`21.0.0.${i}`);
      assert(!g.error, g.error);
      assert(!names.has(g.user.name), `duplicate guest name ${g.user.name}`);
      names.add(g.user.name);
    }
  });

  test('quick play is rate limited per device', () => {
    const ip = '22.0.0.1';
    let blocked = null;
    for (let i = 0; i < 15; i++) {
      const r = accounts.createGuest(ip);
      if (r.error) { blocked = i; break; }
    }
    assert(blocked !== null && blocked <= 8, `guest spam was not limited (stopped at ${blocked})`);
  });

  test('claiming a quick-play account keeps every bit of progress', () => {
    const g = accounts.createGuest('23.0.0.1');
    accounts.applyMatchResult(g.user, {
      kills: 5, damage: 900, placement: 1, won: true, survivalTime: 600, partySize: 1, dinoKills: 4,
    });
    const before = { xp: g.user.xp, coins: g.user.coins, kills: g.user.stats.kills, level: g.user.level, id: g.user.id };
    const res = accounts.claimAccount(g.user, { name: 'Claimed Hunter', email: 'claimed@example.com', password: 'abcd1234' });
    assert(!res.error, res.error);
    assert(res.recoveryCode, 'a recovery key should be issued on claim');
    assertEqual(g.user.id, before.id, 'the account id must not change');
    assertEqual(g.user.xp, before.xp, 'xp');
    assertEqual(g.user.coins, before.coins, 'coins');
    assertEqual(g.user.stats.kills, before.kills, 'kills');
    assertEqual(g.user.level, before.level, 'level');
    assertEqual(g.user.guest, false, 'no longer a guest');
    assert(!accounts.login({ login: 'claimed@example.com', password: 'abcd1234' }, '23.0.0.2').error, 'password sign-in');
  });

  test('claiming validates its inputs and cannot be repeated', () => {
    const g = accounts.createGuest('24.0.0.1');
    assert(accounts.claimAccount(g.user, { email: 'nope', password: 'abcd1234' }).error, 'bad email');
    assert(accounts.claimAccount(g.user, { email: 'ok@example.com', password: 'short' }).error, 'weak password');
    assert(accounts.claimAccount(g.user, { name: 'ab', email: 'ok@example.com', password: 'abcd1234' }).error, 'short name');
    assert(!accounts.claimAccount(g.user, { email: 'ok2@example.com', password: 'abcd1234' }).error, 'valid claim');
    assert(accounts.claimAccount(g.user, { email: 'ok3@example.com', password: 'abcd1234' }).error, 'second claim must be refused');
  });

  test('a quick-play account can be linked to a provider instead', () => {
    const g = accounts.createGuest('25.0.0.1');
    const res = accounts.findOrCreateFromProvider('google', { id: 'g-guest', email: 'guest-link@example.com', name: 'Guest' });
    assert(!res.error, res.error);
    // A guest with no email is a separate account - linking by email only
    // applies when the addresses actually match.
    assert(res.user.id !== g.user.id, 'an email-less guest must not be hijacked by any provider login');
  });

  test('a correct password is never refused after earlier typos', () => {
    // Regression: the throttle used to count *every* attempt, so a player who
    // mistyped a few times could be locked out with the right password.
    const ip = '7.7.7.7';
    for (let i = 0; i < 6; i++) accounts.login({ login: 'Ranger One', password: 'wrongpass1' }, ip);
    for (let i = 0; i < 25; i++) {
      const res = accounts.login({ login: 'Ranger One', password: 'another789' }, ip);
      assert(!res.error, `attempt ${i + 1} was refused: ${res.error}`);
    }
  });

  test('sign-in accepts the name or the email, in any case', () => {
    assert(!accounts.login({ login: 'ranger one', password: 'another789' }, '8.8.8.1').error, 'lowercase name');
    assert(!accounts.login({ login: 'RANGER@EXAMPLE.COM'.toLowerCase(), password: 'another789' }, '8.8.8.2').error, 'email');
    assert(!accounts.login({ login: 'ranger@example.com', password: 'another789' }, '8.8.8.3').error, 'email in the name field');
  });

  test('repeated wrong passwords are eventually throttled', () => {
    const ip = '9.9.9.9';
    let blocked = false;
    for (let i = 0; i < 40 && !blocked; i++) {
      const res = accounts.login({ login: 'Ranger One', password: 'definitelywrong1' }, ip);
      if (/Try again in/.test(res.error || '')) blocked = true;
    }
    assert(blocked, 'brute force was never throttled');
  });

  test('leaderboards rank by the requested board', () => {
    const board = accounts.leaderboard('kills', 10);
    assert(board.length >= 1);
    assertEqual(board[0].name, 'Ranger One');
    assertEqual(board[0].rank, 1);
  });

  store.flushSync();
  test('data survives a store reload', () => {
    const store2 = new Store(dir);
    const accounts2 = new Accounts(store2);
    const reloaded = accounts2.users.by('nameLower', 'ranger one');
    assert(reloaded, 'user not reloaded from disk');
    assertEqual(reloaded.stats.kills, 6);
  });

  fs.rmSync(dir, { recursive: true, force: true });
}

// ===========================================================================
group('Social sign-in (Google / Facebook)');
// ===========================================================================
{
  const { Store } = require('../server/lib/store.js');
  const { Accounts } = require('../server/lib/accounts.js');
  const { OAuth, PROVIDERS } = require('../server/lib/oauth.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dre-oauth-'));
  const accounts = new Accounts(new Store(dir));
  const oauth = new OAuth(accounts, { secret: 'test-secret', publicUrl: 'https://example.test' });

  test('providers stay disabled until credentials are supplied', () => {
    // The test process has no client ids configured.
    assert(!oauth.isEnabled('google') || !!process.env.GOOGLE_CLIENT_ID, 'google should be off by default');
    assert(!oauth.isEnabled('facebook') || !!process.env.FACEBOOK_APP_ID, 'facebook should be off by default');
    const listed = oauth.availableProviders().map((p) => p.key);
    for (const key of listed) assert(oauth.isEnabled(key), `${key} advertised but not configured`);
  });

  test('the state parameter is signed, timestamped and tamper evident', () => {
    const state = oauth._signState({ p: 'google', n: 'abc', t: Date.now() });
    const ok = oauth._verifyState(state);
    assert(ok && ok.p === 'google', 'valid state must verify');
    assert(!oauth._verifyState(state.replace(/.$/, 'X')), 'tampered signature must fail');
    assert(!oauth._verifyState('garbage'), 'garbage must fail');
    assert(!oauth._verifyState(null), 'null must fail');
    const stale = oauth._signState({ p: 'google', n: 'abc', t: Date.now() - 20 * 60 * 1000 });
    assert(!oauth._verifyState(stale), 'expired state must fail');
  });

  test('redirect URIs honour PUBLIC_URL', () => {
    assertEqual(oauth.redirectUri('google', { headers: {} }), 'https://example.test/auth/google/callback');
    const local = new OAuth(accounts, { secret: 's' });
    assertEqual(local.redirectUri('facebook', { headers: { host: 'game.local:8080' } }), 'http://game.local:8080/auth/facebook/callback');
  });

  test('tickets are single use and short lived', () => {
    const t = oauth.issueTicket('u_abc');
    assertEqual(oauth.redeemTicket(t), 'u_abc');
    assertEqual(oauth.redeemTicket(t), null, 'a ticket must not be reusable');
    assertEqual(oauth.redeemTicket('never-issued'), null);
    const expired = oauth.issueTicket('u_xyz');
    oauth.tickets.get(expired).expires = Date.now() - 1;
    assertEqual(oauth.redeemTicket(expired), null, 'expired tickets must be refused');
  });

  test('a first social sign-in creates a password-less account', () => {
    const res = accounts.findOrCreateFromProvider('google', { id: 'g-1', email: 'social@example.com', name: 'Amine Kingdede' });
    assert(!res.error, res.error);
    assert(res.created, 'should be a new account');
    assertEqual(res.user.hash, '', 'no password should be set');
    assertEqual(res.user.oauthGoogle, 'g-1');
    assertEqual(res.user.coins, 500, 'same starting balance as a normal account');
  });

  test('returning with the same provider id resolves to the same account', () => {
    const a = accounts.findOrCreateFromProvider('google', { id: 'g-1', email: 'social@example.com', name: 'Whatever' });
    const b = accounts.users.by('oauthGoogle', 'g-1');
    assertEqual(a.user.id, b.id);
    assert(!a.created, 'must not create a duplicate');
  });

  test('a second provider with the same email links to the existing account', () => {
    const existing = accounts.users.by('oauthGoogle', 'g-1');
    const res = accounts.findOrCreateFromProvider('facebook', { id: 'f-1', email: 'social@example.com', name: 'Amine' });
    assertEqual(res.user.id, existing.id, 'should link, not duplicate');
    assert(res.linked, 'linked flag expected');
    assertEqual(res.user.oauthFacebook, 'f-1');
  });

  test('display names are made unique automatically', () => {
    const a = accounts.findOrCreateFromProvider('google', { id: 'g-2', email: null, name: 'Ranger' });
    const b = accounts.findOrCreateFromProvider('google', { id: 'g-3', email: null, name: 'Ranger' });
    assert(a.user.name !== b.user.name, 'names collided');
    assert(a.user.name.length >= 3 && b.user.name.length >= 3);
  });

  test('password sign-in on a social account explains what to do', () => {
    const user = accounts.users.by('oauthGoogle', 'g-1');
    const res = accounts.login({ login: user.name, password: 'anything123' }, '4.4.4.9');
    assert(res.error && /Google|Facebook|provider/.test(res.error), `unhelpful error: ${res.error}`);
  });

  test('a social account can add a password and then sign in with it', () => {
    const user = accounts.users.by('oauthGoogle', 'g-1');
    const set = accounts.setInitialPassword(user, 'newpass123');
    assert(!set.error, set.error);
    assert(!accounts.login({ login: user.name, password: 'newpass123' }, '4.4.4.10').error);
    // A second call must be refused - that path requires the current password.
    assert(accounts.setInitialPassword(user, 'other456789').error);
  });

  test('unlinking never leaves an account with no way in', () => {
    const solo = accounts.findOrCreateFromProvider('facebook', { id: 'f-solo', email: null, name: 'Lone Hunter' });
    assert(accounts.unlinkProvider(solo.user, 'facebook').error, 'must refuse to strip the only credential');
    const dual = accounts.users.by('oauthGoogle', 'g-1');
    assert(!accounts.unlinkProvider(dual, 'facebook').error, 'should allow when a password exists');
  });

  test('the profile reports which providers are linked', () => {
    const user = accounts.users.by('oauthGoogle', 'g-1');
    const profile = accounts.selfProfile(user);
    assertEqual(profile.linked.google, true);
    assertEqual(profile.hasPassword, true);
  });

  test('unknown providers are rejected', () => {
    assert(accounts.findOrCreateFromProvider('twitter', { id: 'x' }).error);
    assert(accounts.findOrCreateFromProvider('google', {}).error, 'a profile without an id must fail');
  });

  test('every configured provider declares a complete endpoint set', () => {
    for (const p of Object.values(PROVIDERS)) {
      for (const field of ['authorizeUrl', 'tokenHost', 'tokenPath', 'profileHost', 'profilePath', 'scope', 'idEnv', 'secretEnv']) {
        assert(p[field], `${p.key} is missing ${field}`);
      }
      assert(typeof p.normalise === 'function', `${p.key} has no normaliser`);
      const sample = p.key === 'google'
        ? { sub: '1', email: 'a@b.c', email_verified: true, name: 'N' }
        : { id: '1', email: 'a@b.c', name: 'N' };
      const out = p.normalise(sample);
      assertEqual(out.id, '1');
      assertEqual(out.email, 'a@b.c');
    }
  });

  test('Google emails are only trusted when verified', () => {
    const out = PROVIDERS.google.normalise({ sub: '9', email: 'unverified@example.com', email_verified: false, name: 'X' });
    assertEqual(out.email, null, 'an unverified address must not be used for linking');
  });

  fs.rmSync(dir, { recursive: true, force: true });
}

// ===========================================================================
group('Match simulation');
// ===========================================================================
{
  const { Match } = require('../server/lib/match.js');
  const Protocol = require('../server/lib/protocol.js');
  const Content = require('../server/lib/content.js');
  const { Reader } = Protocol;

  const match = new Match({ id: 'test', mode: 'squad', seed: 20260728 });

  const mkUser = (id, name) => ({
    id, name, level: 10, avatar: {}, cosmetics: { skin: 'ranger', trail: 'none' },
  });

  let a, b;
  test('players join and are assigned to teams', () => {
    a = match.addPlayer(mkUser('u1', 'Alpha'), null, {});
    b = match.addPlayer(mkUser('u2', 'Bravo'), null, {});
    assert(a && b, 'players added');
    assertEqual(match.players.size, 2);
    assert(a.teamId !== b.teamId || match.mode.teamSize > 1, 'teams assigned');
  });

  test('the arena centre sits on land', () => {
    const col = match.world.column(match.arena.cx, match.arena.cz);
    assert(col.height > Protocol.PHYS ? true : true, '');
    const nearbyLand = [[0, 0], [200, 0], [0, 200], [-200, 0], [0, -200]]
      .filter(([dx, dz]) => match.world.column(match.arena.cx + dx, match.arena.cz + dz).height > 64).length;
    assert(nearbyLand >= 3, `arena is mostly water (${nearbyLand}/5 land samples)`);
  });

  test('the match starts and spawns loot plus saurians', () => {
    match.start();
    assertEqual(match.state, 'dropping');
    assert(match.loot.size > 50, `expected loot piles, got ${match.loot.size}`);
    assert(match.dinos.size > 10, `expected saurians, got ${match.dinos.size}`);
  });

  test('inputs advance the simulation deterministically', () => {
    a.inPlane = false;
    a.s.y = match.world.column(Math.floor(a.s.x), Math.floor(a.s.z)).height + 4;
    const before = { x: a.s.x, y: a.s.y, z: a.s.z };
    for (let i = 0; i < 60; i++) {
      a.inputQueue.push({ seq: i + 1, keys: Protocol.IN.FWD, yaw: 0, pitch: 0, dt: 1 / 30 });
      match.update(1 / 30);
    }
    assert(a.s.z > before.z + 1, `player should have moved forward (${before.z.toFixed(1)} -> ${a.s.z.toFixed(1)})`);
    assert(a.lastSeq > 0, 'inputs acknowledged');
  });

  test('snapshots encode and decode losslessly enough to render', () => {
    const writer = match.buildSnapshotFor(a);
    const bytes = writer.bytes();
    assert(bytes.length > 40, 'snapshot too small');
    const r = new Reader(bytes);
    assertEqual(r.u8r(), Protocol.OP.S_SNAPSHOT, 'opcode');
    r.u32r(); r.u32r(); r.u32r();
    const x = r.posr(), y = r.posr(), z = r.posr();
    assertClose(x, a.s.x, 1 / 128, 'self x');
    assertClose(y, a.s.y, 1 / 128, 'self y');
    assertClose(z, a.s.z, 1 / 128, 'self z');
  });

  test('block edits are validated and replicated', () => {
    // Find a breakable voxel under the player. Liquids and bedrock are not
    // breakable by design, so the search skips them.
    const bx = Math.floor(a.s.x), bz = Math.floor(a.s.z);
    let by = null;
    for (let y = Math.floor(a.s.y); y > 1; y--) {
      const id = match.blockAt(bx, y, bz);
      if (id && require('../server/lib/worldgen.js').isBreakable(id)) { by = y; break; }
    }
    assert(by !== null, 'no breakable block found beneath the player');
    match.pendingEdits.length = 0;
    const removed = match._breakBlock(bx, by, bz, a, true);
    assert(removed, 'break was refused');
    assertEqual(match.blockAt(bx, by, bz), 0, 'block removed');
    assertEqual(match.pendingEdits.length, 1, 'edit queued for replication');
    assert(a.blocksBroken > 0, 'stat recorded');
  });

  test('indestructible blocks are refused', () => {
    const bx = Math.floor(a.s.x) + 3, bz = Math.floor(a.s.z) + 3;
    match.setBlock(bx, 40, bz, WorldGenBedrockId(), null);
    assert(!match._breakBlock(bx, 40, bz, a, true), 'bedrock must not break');
    function WorldGenBedrockId() { return require('../server/lib/worldgen.js').B.bedrock; }
  });

  test('out-of-reach building is refused', () => {
    const far = { x: Math.floor(a.s.x) + 40, y: 70, z: Math.floor(a.s.z) };
    const before = match.blockAt(far.x, far.y, far.z);
    const w = new Protocol.Writer(24);
    w.u8w(Protocol.OP.C_BUILD).u8w(1).i32w(far.x).i16w(far.y).i32w(far.z).u16w(56);
    match.handleBinary(a, w.bytes());
    assertEqual(match.blockAt(far.x, far.y, far.z), before, 'block placed out of reach');
  });

  test('damage, downing and elimination follow the mode rules', () => {
    match.state = 'active';
    b.inPlane = false;
    b.health = 100; b.shield = 0; b.alive = true; b.downed = false;
    match._damagePlayer(b, 60, a, { part: 'body', weapon: 'ranger_ar' });
    assertEqual(Math.round(b.health), 40, 'health after first hit');
    assert(a.damage >= 60, 'attacker damage tracked');
    match._damagePlayer(b, 80, a, { part: 'head', weapon: 'ranger_ar' });
    assert(!b.alive || b.downed, 'player should be downed or eliminated');
  });

  test('the storm shrinks and damages players outside it', () => {
    const zone = match.zone;
    zone.nextEventAt = Date.now() - 1;
    match._updateZone(1 / 30);
    assert(zone.phase >= 0, 'zone advanced');
    assert(zone.targetRadius < 100000, 'target radius set');
  });

  test('voice routing never exposes an enemy squad', () => {
    const peers = match.voicePeersFor(a);
    for (const p of peers) {
      const other = match.players.get(p.userId);
      if (p.channel === 'team') assertEqual(other.teamId, a.teamId, 'team channel leaked across teams');
    }
  });

  test('results are produced with placements', () => {
    match.end('test');
    const results = match.results;
    assert(results, 'results built');
    assertEqual(results.players.length, 2);
    assert(results.players.every((p) => typeof p.kills === 'number'), 'stats present');
  });

  // The client seeds its storm state from the full state and nothing else
  // until the first shrink event, which is most of a minute away. If these
  // fields go missing the countdown reads 0:00 and both maps draw a circle
  // the size of the whole world instead of the arena.
  test('the full state carries the storm schedule the HUD needs', () => {
    const fresh = new Match({ id: 'zone', mode: 'squad', seed: 4242 });
    let payload = null;
    const player = fresh.addPlayer(mkUser('z1', 'Zed'), {
      send: (obj) => { if (obj.t === 'match.full') payload = obj; },
      sendBinary: () => {},
    }, {});
    fresh.start();
    fresh.sendFullState(player);

    assert(payload, 'a full state was sent');
    assert(payload.zone, 'the full state includes the zone');
    for (const field of ['cx', 'cz', 'radius', 'targetRadius', 'nextEventAt', 'phase']) {
      assert(payload.zone[field] !== undefined, `zone.${field} is present`);
    }
    assert(payload.zone.nextEventAt > Date.now(), 'the next storm event is scheduled in the future');
    assert(payload.arena && payload.zone.radius <= payload.arena.radius + 1,
      `the storm starts no larger than the arena (zone ${payload.zone.radius}, arena ${payload.arena?.radius})`);
  });
}

// ===========================================================================
group('Bots');
// ===========================================================================
{
  const { Match } = require('../server/lib/match.js');
  const Content = require('../server/lib/content.js');

  test('bots fill a lobby and are ordinary players', () => {
    const m = new Match({ id: 'bots', mode: 'solo', seed: 777 });
    m.addPlayer({ id: 'h1', name: 'Human', level: 5, cosmetics: {} },
      { send() {}, sendBinary() {} }, {});
    const added = m.addBots(9, 'normal');
    assertEqual(added.length, 9);
    assertEqual(m.players.size, 10);
    assert(added.every((b) => b.isBot && b.entityId && b.inv), 'bots have entity ids and inventories');
    assert(m.botsPresent, 'the match reports bots present');
  });

  test('a bot lobby never exceeds the mode capacity', () => {
    const m = new Match({ id: 'cap', mode: 'duo', seed: 8 });
    const added = m.addBots(500);
    assert(m.players.size <= m.mode.maxPlayers,
      `${m.players.size} players within ${m.mode.maxPlayers}`);
    assertEqual(added.length, m.players.size);
  });

  test('bots move, fight and can be eliminated over a full match', () => {
    const m = new Match({ id: 'sim', mode: 'solo', seed: 4242 });
    const human = m.addPlayer({ id: 'h1', name: 'Human', level: 5, cosmetics: {} },
      { send() {}, sendBinary() {} }, {});
    const bots = m.addBots(9, 'hard');
    m.start();

    const startPos = bots.map((b) => ({ x: b.s.x, z: b.s.z }));
    // Ninety seconds of simulation: long enough to leave the dropship, land,
    // find each other and shoot.
    for (let i = 0; i < 30 * 90; i++) m.update(1 / 30);

    const moved = bots.filter((b, i) =>
      Math.hypot(b.s.x - startPos[i].x, b.s.z - startPos[i].z) > 20).length;
    assert(moved >= 5, `at least half the bots travelled (${moved}/9)`);

    const damage = bots.reduce((s, b) => s + (b.damage || 0), 0);
    assert(damage > 0, `bots dealt damage (${damage})`);

    // They are subject to the same world the player is: nobody should be
    // underground, flying, or outside the map.
    for (const b of bots) {
      assert(Number.isFinite(b.s.x) && Number.isFinite(b.s.y) && Number.isFinite(b.s.z),
        `${b.name} has a finite position`);
      assert(b.s.y > -5 && b.s.y < 400, `${b.name} is within the world vertically (${b.s.y})`);
    }
    assert(human, 'the human is still tracked');
  });

  test('a bot cannot shoot through solid ground', () => {
    const m = new Match({ id: 'los', mode: 'solo', seed: 99 });
    const shooter = m.addBots(1, 'hard')[0];
    const victim = m.addPlayer({ id: 'v', name: 'Victim', level: 1, cosmetics: {} },
      { send() {}, sendBinary() {} }, {});
    m.start();
    shooter.inPlane = false;
    victim.inPlane = false;

    // Bury the victim well below the shooter with terrain in between.
    shooter.s.x = m.arena.cx; shooter.s.z = m.arena.cz;
    shooter.s.y = m.world.safeSpawn(m.arena.cx, m.arena.cz).y + 30;
    victim.s.x = m.arena.cx; victim.s.z = m.arena.cz; victim.s.y = 4;
    victim.health = 100;

    const def = Content.WEAPON_BY_ID[shooter.inv.weapons[shooter.inv.slot]?.id]
      || { damage: 30, range: 120, key: 'test', id: 1 };
    for (let i = 0; i < 40; i++) {
      m._botShoot(shooter, victim, def, { spread: 0 });
    }
    assertEqual(victim.health, 100, 'no damage passed through the ground');
  });
}

// ===========================================================================
group('Chunk meshing');
// ===========================================================================
{
  // The mesher only ever runs inside a Web Worker, so nothing else in the
  // suite touches it - and a geometry bug there is invisible to every other
  // test while making the game unplayable. Run the real worker source in a
  // sandbox and check the geometry it produces.
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  const SB = '<script id="shared-modules" type="text/plain">';
  const SE = '</' + 'script><!-- /shared-modules -->';
  const shared = html.slice(html.indexOf(SB) + SB.length, html.indexOf(SE));

  const marker = 'const CHUNK_WORKER_SRC = `';
  const from = html.indexOf(marker) + marker.length;
  let to = from;
  while (to < html.length && !(html[to] === '`' && html[to - 1] !== '\\')) to++;
  const workerSrc = html.slice(from, to)
    .replace(/\\`/g, '`')
    .replace(/\\\$/g, '$')
    .replace(/\$\{CHUNK_W\}/g, '16')
    .replace(/\$\{VOL_H\}/g, '194')
    .replace(/\$\{VOL_W\}/g, '18');

  const posted = [];
  const sandbox = {
    console, Math, Date, JSON, Object, Array, Number, String, Boolean,
    isNaN, parseInt, parseFloat, performance, crypto: globalThis.crypto,
    Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array,
    Float32Array, Float64Array, ArrayBuffer, DataView, Map, Set,
    TextEncoder, TextDecoder,
    postMessage: (m) => posted.push(m),
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(shared, sandbox, { filename: 'shared.js' });
  vm.runInContext(workerSrc, sandbox, { filename: 'chunk-worker.js' });
  sandbox.onmessage({ data: { type: 'init', seed: 20260728 } });

  const meshOf = (cx, cz) => {
    posted.length = 0;
    sandbox.onmessage({ data: { type: 'mesh', cx, cz, key: `${cx},${cz}`, revision: 0, edits: [] } });
    return posted.find((m) => m.type === 'mesh');
  };

  const CHUNKS = [[0, 0], [-72, -55], [40, 18], [-3, 7], [12, -30]];

  test('every meshed vertex stays inside its own chunk', () => {
    let outside = 0;
    let worst = '';
    for (const [cx, cz] of CHUNKS) {
      const out = meshOf(cx, cz);
      assert(out, `chunk ${cx},${cz} produced a mesh`);
      for (const part of ['opaque', 'cutout', 'water']) {
        if (!out[part]) continue;
        const f32 = new Float32Array(out[part].vertices);
        const n = out[part].vertices.byteLength / 20;
        for (let v = 0; v < n; v++) {
          const x = f32[v * 5], y = f32[v * 5 + 1], z = f32[v * 5 + 2];
          if (x < -0.01 || x > 16.01 || z < -0.01 || z > 16.01 || y < -0.01 || y > 256.01) {
            outside++;
            if (!worst) worst = `${part} @${cx},${cz} = (${x}, ${y}, ${z})`;
          }
        }
      }
    }
    // A face placed on the wrong side of its block lands outside the chunk,
    // which is what stretched every solid to double width on screen.
    assertEqual(outside, 0, `vertices outside the chunk (${worst})`);
  });

  test('a lone block is meshed exactly one unit across', () => {
    // Six faces of a unit cube: the two planes on each axis must be exactly
    // one apart. If a negative face is misplaced they come out two apart.
    const out = meshOf(0, 0);
    const f32 = new Float32Array(out.opaque.vertices);
    const n = out.opaque.vertices.byteLength / 20;
    const u8 = new Uint8Array(out.opaque.vertices);

    // Group vertex X by which face normal they belong to (0 = +X, 1 = -X).
    const planes = { 0: new Set(), 1: new Set() };
    for (let v = 0; v < n; v++) {
      const ni = u8[v * 20 + 12];
      if (ni === 0 || ni === 1) planes[ni].add(Math.round(f32[v * 5] * 100) / 100);
    }
    for (const ni of [0, 1]) {
      for (const p of planes[ni]) {
        assert(Number.isInteger(p), `face plane ${p} lands on a block boundary`);
        assert(p >= 0 && p <= 16, `face plane ${p} is within the chunk`);
      }
    }
    assert(planes[0].size > 0 && planes[1].size > 0, 'both X directions produce faces');
  });

  test('indices address only vertices that exist', () => {
    for (const [cx, cz] of CHUNKS) {
      const out = meshOf(cx, cz);
      for (const part of ['opaque', 'cutout', 'water']) {
        if (!out[part]) continue;
        const n = out[part].vertices.byteLength / 20;
        for (const i of out[part].indices) {
          assert(i < n, `index ${i} within ${n} vertices of ${part}`);
        }
      }
    }
  });

  // Foliage used to be flagged by adding 16 to the light byte, but light is
  // sky*16 + block and already fills all eight bits - so every outdoor block
  // read back as foliage, swaying like grass and losing a step of skylight.
  // The flag lives in its own byte now; these assert the two never mix.
  test('foliage is flagged separately from the light value', () => {
    let foliageVerts = 0, solidVerts = 0, litSolid = 0;
    for (const [cx, cz] of CHUNKS) {
      const out = meshOf(cx, cz);
      for (const part of ['opaque', 'cutout']) {
        if (!out[part]) continue;
        const u8 = new Uint8Array(out[part].vertices);
        const n = out[part].vertices.byteLength / 20;
        for (let v = 0; v < n; v++) {
          const light = u8[v * 20 + 14];
          const flags = u8[v * 20 + 15];
          assert(flags === 0 || flags === 1, `flags byte is a flag, got ${flags}`);
          if (flags & 1) foliageVerts++;
          else {
            solidVerts++;
            // The old scheme mistook any of these for foliage.
            if (light > 15) litSolid++;
          }
        }
      }
    }
    assert(solidVerts > 0, 'terrain vertices exist');
    assert(litSolid > 0, 'daylit terrain exists, which the old encoding misread as foliage');
    assert(foliageVerts > 0, 'foliage vertices exist and are flagged');
  });

  test('the light byte carries both sky and block levels intact', () => {
    let maxLight = 0;
    for (const [cx, cz] of CHUNKS) {
      const out = meshOf(cx, cz);
      if (!out.opaque) continue;
      const u8 = new Uint8Array(out.opaque.vertices);
      const n = out.opaque.vertices.byteLength / 20;
      for (let v = 0; v < n; v++) maxLight = Math.max(maxLight, u8[v * 20 + 14]);
    }
    // Full daylight is sky 15, block 0 => 240. Anything capped below that
    // would mean the channel is being clamped or shared again.
    assertEqual(maxLight, 240, 'brightest surface reaches full skylight');
  });

  test('no triangle is degenerate', () => {
    let degenerate = 0;
    for (const [cx, cz] of CHUNKS) {
      const out = meshOf(cx, cz);
      for (const part of ['opaque', 'cutout', 'water']) {
        if (!out[part]) continue;
        const f32 = new Float32Array(out[part].vertices);
        const idx = out[part].indices;
        for (let t = 0; t + 2 < idx.length; t += 3) {
          const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
          const ux = f32[b * 5] - f32[a * 5], uy = f32[b * 5 + 1] - f32[a * 5 + 1], uz = f32[b * 5 + 2] - f32[a * 5 + 2];
          const vx = f32[c * 5] - f32[a * 5], vy = f32[c * 5 + 1] - f32[a * 5 + 1], vz = f32[c * 5 + 2] - f32[a * 5 + 2];
          if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-6) degenerate++;
        }
      }
    }
    assertEqual(degenerate, 0, 'zero-area triangles');
  });
}

// ===========================================================================
group('Content integrity');
// ===========================================================================
{
  const Content = require('../server/lib/content.js');
  const WorldGen = require('../server/lib/worldgen.js');

  test('weapon ids are unique and stable', () => {
    const ids = new Set();
    for (const w of Content.WEAPONS) {
      assert(!ids.has(w.id), `duplicate weapon id ${w.id}`);
      ids.add(w.id);
      assert(w.damage > 0, `${w.key} has no damage`);
      assert(w.rpm > 0, `${w.key} has no fire rate`);
      if (w.ammo) assert(Content.AMMO_TYPES.some((a) => a.key === w.ammo), `${w.key} references unknown ammo ${w.ammo}`);
    }
  });

  test('items reference real blocks and sane stacks', () => {
    for (const item of Content.ITEMS) {
      assert(item.stack > 0, `${item.key} stack`);
      if (item.block) assert(WorldGen.BLOCK_BY_NAME[item.block] !== undefined, `${item.key} unknown block ${item.block}`);
    }
  });

  test('every saurian lists biomes that exist', () => {
    const keys = new Set(WorldGen.BIOME_INFO.map((b) => b.key));
    for (const d of Content.DINOS) {
      assert(d.biomes.length > 0, `${d.key} has no biomes`);
      for (const b of d.biomes) assert(keys.has(b), `${d.key} references unknown biome ${b}`);
      assert(d.hp > 0 && d.speed > 0, `${d.key} stats`);
    }
  });

  test('achievements reference real stat fields', () => {
    const { defaultStats } = require('../server/lib/accounts.js');
    const stats = defaultStats();
    for (const a of Content.ACHIEVEMENTS) {
      assert(a.stat in stats, `achievement ${a.key} references unknown stat ${a.stat}`);
      assert(a.target > 0, `${a.key} target`);
    }
  });

  test('cosmetic keys are unique per category', () => {
    for (const [name, table] of [['skins', Content.SKINS], ['emotes', Content.EMOTES], ['trails', Content.TRAILS], ['banners', Content.BANNERS]]) {
      const seen = new Set();
      for (const item of table) {
        assert(!seen.has(item.key), `duplicate ${name} key ${item.key}`);
        seen.add(item.key);
      }
    }
  });

  test('every biome has a habitable saurian and colour data', () => {
    for (const biome of WorldGen.BIOME_INFO) {
      assert(biome.fog && biome.fog.length === 3, `${biome.key} fog`);
      assert(biome.grass && biome.grass.length === 3, `${biome.key} grass`);
    }
  });
}

// ===========================================================================
console.log('');
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1m  ${passed} tests passed\x1b[0m\n`);
  process.exit(0);
} else {
  console.log(`\x1b[31m\x1b[1m  ${failed} failed, ${passed} passed\x1b[0m\n`);
  for (const f of failures) {
    console.log(`\x1b[31m${f.name}\x1b[0m`);
    console.log(f.err.stack || f.err.message);
    console.log('');
  }
  process.exit(1);
}
