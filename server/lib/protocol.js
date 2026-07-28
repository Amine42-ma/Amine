'use strict';
/**
 * ============================================================================
 *  Dino Royale Evolution - SHARED WIRE PROTOCOL
 * ============================================================================
 *  Embedded verbatim in the client and required by the server.
 *
 *  Two channels share one WebSocket:
 *    - TEXT frames  : JSON control plane (auth, social, party, matchmaking,
 *                     chat, voice signalling). Low rate, human readable.
 *    - BINARY frames: match plane (input, snapshots, edits, events). High
 *                     rate, hand-packed and quantised.
 *
 *  Quantisation contract (must match on both ends):
 *    position  : 1/128 block, int32          -> +-16777 blocks, 7.8mm precision
 *    velocity  : 1/256 block/s, int16        -> +-128 b/s
 *    angle yaw : uint16 over [0, 2pi)
 *    angle pit : int16 over [-pi/2, pi/2]
 *    normalised: uint8 over [0,1]
 * ============================================================================
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Protocol = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PROTOCOL_VERSION = 8;

  // --- binary opcodes --------------------------------------------------------
  const OP = {
    // client -> server
    C_INPUT: 0x01,
    C_FIRE: 0x02,
    C_BUILD: 0x03,
    C_MARK: 0x04,
    C_EMOTE: 0x05,
    C_INTERACT: 0x06,
    C_MELEE: 0x07,
    C_RELOAD: 0x08,
    C_SWAP: 0x09,
    C_USE_ITEM: 0x0a,
    C_TIME_SYNC: 0x0b,
    C_LOOT: 0x0c,
    C_DROP: 0x0d,
    C_REVIVE: 0x0e,

    // server -> client
    S_SNAPSHOT: 0x81,
    S_EDITS: 0x82,
    S_EVENTS: 0x83,
    S_MATCH_STATE: 0x84,
    S_TIME_SYNC: 0x85,
    S_SPAWN: 0x86,
    S_INVENTORY: 0x87,
    S_FULL_STATE: 0x88,
  };

  // --- event ids (inside S_EVENTS) ------------------------------------------
  const EV = {
    HIT: 1,
    KILL: 2,
    SHOT: 3,
    BLOCK_BREAK: 4,
    BLOCK_PLACE: 5,
    EXPLOSION: 6,
    PICKUP: 7,
    DINO_ROAR: 8,
    DINO_ATTACK: 9,
    FOOTSTEP: 10,
    DAMAGE_TAKEN: 11,
    HEAL: 12,
    MARK: 13,
    EMOTE: 14,
    RELOAD: 15,
    DOWNED: 16,
    REVIVED: 17,
    SUPPLY_DROP: 18,
    ZONE_WARN: 19,
    LEVEL_UP: 20,
    STORM_TICK: 21,
    SPLASH: 22,
    LAND: 23,
  };

  // --- input bit flags -------------------------------------------------------
  const IN = {
    FWD: 1 << 0,
    BACK: 1 << 1,
    LEFT: 1 << 2,
    RIGHT: 1 << 3,
    JUMP: 1 << 4,
    SPRINT: 1 << 5,
    CROUCH: 1 << 6,
    SLIDE: 1 << 7,
    LEAN_L: 1 << 8,
    LEAN_R: 1 << 9,
    AIM: 1 << 10,
    FIRE: 1 << 11,
    USE: 1 << 12,
    CLIMB: 1 << 13,
    SWIM_UP: 1 << 14,
    PRONE: 1 << 15,
  };

  // --- player movement states (server authoritative) -------------------------
  const MOVE = {
    IDLE: 0,
    WALK: 1,
    RUN: 2,
    SPRINT: 3,
    CROUCH: 4,
    SLIDE: 5,
    JUMP: 6,
    FALL: 7,
    CLIMB: 8,
    SWIM: 9,
    DIVE: 10,
    VAULT: 11,
    LAND: 12,
    DOWNED: 13,
    DEAD: 14,
    PARACHUTE: 15,
  };

  // --- entity flags in snapshots --------------------------------------------
  const EF = {
    CROUCHED: 1 << 0,
    AIMING: 1 << 1,
    FIRING: 1 << 2,
    IN_WATER: 1 << 3,
    DOWNED: 1 << 4,
    DEAD: 1 << 5,
    SPRINTING: 1 << 6,
    LEAN_L: 1 << 7,
    LEAN_R: 1 << 8,
    SHIELDED: 1 << 9,
    RELOADING: 1 << 10,
    PARACHUTE: 1 << 11,
    TEAMMATE: 1 << 12,
    SPEAKING: 1 << 13,
    CLIMBING: 1 << 14,
    EMOTING: 1 << 15,
  };

  // --- growable little-endian writer ----------------------------------------
  class Writer {
    constructor(size = 1024) {
      this.buf = new ArrayBuffer(size);
      this.view = new DataView(this.buf);
      this.u8 = new Uint8Array(this.buf);
      this.off = 0;
    }
    _need(n) {
      if (this.off + n <= this.buf.byteLength) return;
      let cap = this.buf.byteLength * 2;
      while (cap < this.off + n) cap *= 2;
      const nbuf = new ArrayBuffer(cap);
      new Uint8Array(nbuf).set(this.u8);
      this.buf = nbuf;
      this.view = new DataView(nbuf);
      this.u8 = new Uint8Array(nbuf);
    }
    u8w(v) {
      this._need(1);
      this.view.setUint8(this.off, v & 0xff);
      this.off += 1;
      return this;
    }
    i8w(v) {
      this._need(1);
      this.view.setInt8(this.off, v | 0);
      this.off += 1;
      return this;
    }
    u16w(v) {
      this._need(2);
      this.view.setUint16(this.off, v & 0xffff, true);
      this.off += 2;
      return this;
    }
    i16w(v) {
      this._need(2);
      this.view.setInt16(this.off, v | 0, true);
      this.off += 2;
      return this;
    }
    u32w(v) {
      this._need(4);
      this.view.setUint32(this.off, v >>> 0, true);
      this.off += 4;
      return this;
    }
    i32w(v) {
      this._need(4);
      this.view.setInt32(this.off, v | 0, true);
      this.off += 4;
      return this;
    }
    f32w(v) {
      this._need(4);
      this.view.setFloat32(this.off, v, true);
      this.off += 4;
      return this;
    }
    f64w(v) {
      this._need(8);
      this.view.setFloat64(this.off, v, true);
      this.off += 8;
      return this;
    }
    strw(s) {
      const str = String(s == null ? '' : s);
      const bytes = utf8Encode(str);
      this.u16w(bytes.length);
      this._need(bytes.length);
      this.u8.set(bytes, this.off);
      this.off += bytes.length;
      return this;
    }
    // quantised helpers
    posw(v) {
      return this.i32w(Math.round(v * 128));
    }
    velw(v) {
      return this.i16w(Math.max(-32768, Math.min(32767, Math.round(v * 256))));
    }
    yaww(v) {
      let a = v % (Math.PI * 2);
      if (a < 0) a += Math.PI * 2;
      return this.u16w(Math.round((a / (Math.PI * 2)) * 65535));
    }
    pitw(v) {
      const c = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, v));
      return this.i16w(Math.round((c / (Math.PI / 2)) * 32767));
    }
    normw(v) {
      return this.u8w(Math.max(0, Math.min(255, Math.round(v * 255))));
    }
    bytes() {
      return new Uint8Array(this.buf, 0, this.off);
    }
    /** Node Buffer view without copying (server side). */
    toBuffer() {
      if (typeof Buffer !== 'undefined') return Buffer.from(this.buf, 0, this.off);
      return this.bytes();
    }
  }

  class Reader {
    constructor(data) {
      if (data instanceof ArrayBuffer) {
        this.view = new DataView(data);
        this.u8 = new Uint8Array(data);
      } else {
        this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        this.u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      }
      this.off = 0;
      this.len = this.view.byteLength;
    }
    get remaining() {
      return this.len - this.off;
    }
    u8r() {
      return this.view.getUint8(this.off++);
    }
    i8r() {
      return this.view.getInt8(this.off++);
    }
    u16r() {
      const v = this.view.getUint16(this.off, true);
      this.off += 2;
      return v;
    }
    i16r() {
      const v = this.view.getInt16(this.off, true);
      this.off += 2;
      return v;
    }
    u32r() {
      const v = this.view.getUint32(this.off, true);
      this.off += 4;
      return v;
    }
    i32r() {
      const v = this.view.getInt32(this.off, true);
      this.off += 4;
      return v;
    }
    f32r() {
      const v = this.view.getFloat32(this.off, true);
      this.off += 4;
      return v;
    }
    f64r() {
      const v = this.view.getFloat64(this.off, true);
      this.off += 8;
      return v;
    }
    strr() {
      const n = this.u16r();
      const bytes = this.u8.subarray(this.off, this.off + n);
      this.off += n;
      return utf8Decode(bytes);
    }
    posr() {
      return this.i32r() / 128;
    }
    velr() {
      return this.i16r() / 256;
    }
    yawr() {
      return (this.u16r() / 65535) * Math.PI * 2;
    }
    pitr() {
      return (this.i16r() / 32767) * (Math.PI / 2);
    }
    normr() {
      return this.u8r() / 255;
    }
  }

  // --- utf8 (works in both Node and the browser without TextEncoder deps) ----
  function utf8Encode(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    return new Uint8Array(Buffer.from(str, 'utf8'));
  }
  function utf8Decode(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
    return Buffer.from(bytes).toString('utf8');
  }

  // --- gameplay tuning shared by prediction + authority ----------------------
  const TICK_RATE = 30; // server simulation ticks per second
  const TICK_MS = 1000 / TICK_RATE;
  const SNAPSHOT_RATE = 15; // snapshots per second
  const INTERP_DELAY_MS = 110; // client render lag for remote entities
  const MAX_INPUTS_PER_PACKET = 6; // redundancy against packet loss

  const PHYS = {
    GRAVITY: 26.0,
    WATER_GRAVITY: 5.0,
    TERMINAL_VELOCITY: 68.0,
    WATER_TERMINAL: 8.0,
    WALK_SPEED: 4.4,
    RUN_SPEED: 5.6,
    SPRINT_SPEED: 8.2,
    CROUCH_SPEED: 2.1,
    PRONE_SPEED: 1.1,
    SWIM_SPEED: 3.6,
    DIVE_SPEED: 4.2,
    CLIMB_SPEED: 3.0,
    AIR_CONTROL: 0.32,
    GROUND_ACCEL: 62.0,
    AIR_ACCEL: 18.0,
    FRICTION: 11.0,
    WATER_FRICTION: 4.0,
    ICE_FRICTION: 1.6,
    JUMP_VELOCITY: 8.6,
    SWIM_UP_VELOCITY: 4.4,
    SLIDE_IMPULSE: 3.4,
    SLIDE_FRICTION: 2.6,
    SLIDE_MIN_SPEED: 3.0,
    SLIDE_MAX_TIME: 1.15,
    STEP_HEIGHT: 0.62,
    VAULT_HEIGHT: 1.35,
    VAULT_TIME: 0.42,
    PLAYER_RADIUS: 0.34,
    PLAYER_HEIGHT: 1.82,
    CROUCH_HEIGHT: 1.12,
    PRONE_HEIGHT: 0.62,
    EYE_HEIGHT: 1.66,
    EYE_CROUCH: 0.98,
    EYE_PRONE: 0.42,
    FALL_SAFE: 4.2, // metres of fall before damage
    FALL_DAMAGE_PER_M: 7.5,
    FALL_LETHAL: 22.0,
    BUOYANCY: 12.0,
    MAX_STAMINA: 100,
    STAMINA_SPRINT: 12.5, // per second
    STAMINA_REGEN: 16.0,
    STAMINA_JUMP: 6,
    STAMINA_SWIM: 5,
    OXYGEN_MAX: 22, // seconds underwater without gear
    OXYGEN_REGEN: 8,
    DROWN_DPS: 6,
    LAVA_DPS: 34,
    PARACHUTE_FALL: 9.5,
    PARACHUTE_SPEED: 14.0,
    FREEFALL_SPEED: 46.0,
    LEAN_ANGLE: 0.36,
    LEAN_OFFSET: 0.42,
  };

  const COMBAT = {
    MAX_LAG_COMPENSATION_MS: 260,
    HEADSHOT_MULT: 2.1,
    LIMB_MULT: 0.82,
    MAX_SHIELD: 100,
    MAX_HEALTH: 100,
    DOWNED_HEALTH: 100,
    DOWNED_BLEED_DPS: 3.2,
    REVIVE_TIME: 6.0,
    REVIVE_RANGE: 2.6,
  };

  const ZONE = {
    PHASES: [
      // {waitMs, shrinkMs, radiusFactor, dps}
      { wait: 105000, shrink: 90000, factor: 0.62, dps: 1.0 },
      { wait: 80000, shrink: 80000, factor: 0.60, dps: 2.0 },
      { wait: 70000, shrink: 70000, factor: 0.58, dps: 4.0 },
      { wait: 60000, shrink: 60000, factor: 0.56, dps: 7.0 },
      { wait: 50000, shrink: 50000, factor: 0.54, dps: 10.0 },
      { wait: 40000, shrink: 45000, factor: 0.50, dps: 14.0 },
      { wait: 30000, shrink: 40000, factor: 0.40, dps: 20.0 },
      { wait: 25000, shrink: 35000, factor: 0.0, dps: 26.0 },
    ],
  };

  return {
    PROTOCOL_VERSION,
    OP,
    EV,
    IN,
    MOVE,
    EF,
    Writer,
    Reader,
    TICK_RATE,
    TICK_MS,
    SNAPSHOT_RATE,
    INTERP_DELAY_MS,
    MAX_INPUTS_PER_PACKET,
    PHYS,
    COMBAT,
    ZONE,
  };
});
