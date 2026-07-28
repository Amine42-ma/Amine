'use strict';
/**
 * ============================================================================
 *  Dino Royale Evolution - AUTHORITATIVE MATCH SIMULATION
 * ============================================================================
 *  The server owns every gameplay decision. Clients send *intent only*
 *  (button bits, look angles, requested actions); they never send positions,
 *  hits, kills, loot or block changes.
 *
 *  Per tick (30 Hz):
 *    1. drain queued inputs and step each player through the shared physics
 *    2. resolve queued actions (fire / build / loot / heal / revive)
 *    3. step projectiles, saurian AI, loot, storm
 *    4. apply environmental damage
 *    5. emit a delta snapshot to each player (interest-managed)
 *
 *  Anti-cheat measures implemented here:
 *    - input rate + magnitude clamps, duplicate/old sequence rejection
 *    - server-side physics: speed/teleport/fly are impossible to request
 *    - fire-rate, ammo, reload and reach validated per weapon
 *    - lag compensation bounded to 260 ms of rewind history
 *    - build/break validated for reach, budget, and world bounds
 * ============================================================================
 */

/*
 * Wrapped the same way as the other shared modules so one file can be the
 * authority in both places it runs: a Node server, and - when players connect
 * directly to each other with no server at all - the browser of whoever is
 * hosting the room. The simulation is identical either way; only the
 * transport underneath it changes.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./worldgen.js'), require('./protocol.js'),
      require('./movement.js'), require('./content.js'));
  } else {
    root.MatchSim = factory(root.WorldGen, root.Protocol, root.Movement, root.Content);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (WorldGen, Protocol, Movement, Content) {

/**
 * Short unguessable id. Browsers and Node both expose WebCrypto, so this
 * needs no platform-specific branch - and base64url keeps it safe to drop
 * into a URL or a JSON key.
 */
function randomId(bytes = 6) {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const { WORLD, B, isSolid, isLiquid, isBreakable, BIOME_INFO } = WorldGen;
const { OP, EV, EF, IN, MOVE, PHYS, COMBAT, ZONE, Writer, Reader, TICK_RATE } = Protocol;

/** Shortest signed angle between two headings. */
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

const MAX_EDITS = 60000; // per match, guards memory
const HISTORY_TICKS = Math.ceil((COMBAT.MAX_LAG_COMPENSATION_MS / 1000) * TICK_RATE) + 2;
const INTEREST_RADIUS = 220; // metres of entity replication
const DINO_BUDGET = 130;
const LOOT_BUDGET = 1500;

let nextEntityId = 1;
function newEntityId() {
  nextEntityId = (nextEntityId + 1) & 0xffff;
  if (nextEntityId === 0) nextEntityId = 1;
  return nextEntityId;
}

function packKey(x, y, z) {
  // x,z in [-32768, 32767], y in [0,255]
  return ((x + 32768) * 65536 + (z + 32768)) * 256 + y;
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function dist2(ax, ay, az, bx, by, bz) {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}

// ============================================================================
//  Deterministic per-match RNG (so replays / server restarts are reproducible)
// ============================================================================
class Rng {
  constructor(seed) {
    this.s = seed >>> 0 || 1;
  }
  next() {
    // xorshift32
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return x / 4294967296;
  }
  range(a, b) {
    return a + this.next() * (b - a);
  }
  int(a, b) {
    return Math.floor(this.range(a, b + 1));
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  weighted(entries) {
    let total = 0;
    for (const e of entries) total += e.weight;
    let r = this.next() * total;
    for (const e of entries) {
      r -= e.weight;
      if (r <= 0) return e;
    }
    return entries[entries.length - 1];
  }
}

// ============================================================================
//  Inventory
// ============================================================================
function createInventory() {
  return {
    weapons: [null, null, null], // primary, secondary, melee
    slot: 2,
    ammo: { light: 0, medium: 0, heavy: 0, shell: 0, dart: 0, bolt: 0, rocket: 0 },
    items: {}, // itemKey -> count
    gear: {}, // gearKey -> true
    materials: { wood: 0, stone: 0, metal: 0 },
    buildSlot: 'wood',
  };
}

function weaponInstance(def, rarity = 0) {
  const r = Content.RARITY[rarity] || Content.RARITY[0];
  return {
    id: def.id,
    key: def.key,
    rarity,
    ammoInMag: def.mag,
    damage: +(def.damage * r.mult).toFixed(2),
    lastFire: 0,
    reloading: 0,
    burstLeft: 0,
    heat: 0,
  };
}

// ============================================================================
//  Match
// ============================================================================
class Match {
  constructor(opts) {
    this.id = opts.id;
    this.mode = Content.MODE_BY_KEY[opts.mode] || Content.MODE_BY_KEY.solo;
    this.modeKey = this.mode.key;
    this.seed = opts.seed >>> 0;
    this.code = opts.code || null;
    this.private = !!opts.private;
    this.hostId = opts.hostId || null;
    this.region = opts.region || 'auto';
    this.createdAt = Date.now();

    this.world = new WorldGen.World(this.seed);
    this.rng = new Rng(this.seed ^ 0x9e3779b9);

    /** packed voxel key -> blockId (player + system edits only) */
    this.edits = new Map();
    /** edits produced this tick, broadcast as a delta */
    this.pendingEdits = [];

    this.players = new Map(); // userId -> player
    this.byEntityId = new Map(); // entityId -> player
    this.dinos = new Map();
    this.loot = new Map();
    this.projectiles = new Map();
    this.markers = [];
    this.events = [];
    this.teams = new Map(); // teamId -> {id, members:Set, alive, place}

    this.state = 'lobby'; // lobby | dropping | active | ended
    this.tick = 0;
    this.startedAt = 0;
    this.endedAt = 0;
    this.lobbyDeadline = 0;
    this.aliveCount = 0;
    this.placementCursor = 0;
    this.results = null;

    // Storm / zone
    this.zone = {
      phase: -1,
      cx: 0,
      cz: 0,
      radius: WORLD.RADIUS * 0.62,
      targetCx: 0,
      targetCz: 0,
      targetRadius: WORLD.RADIUS * 0.62,
      nextEventAt: 0,
      shrinking: false,
      dps: 0,
    };

    // Drop plane
    this.plane = { x: 0, z: 0, dx: 0, dz: 0, y: 210, active: false };

    this._chooseArena();
    this._blockCache = new Map();
    this._blockCacheHits = 0;

    this.getBlock = (x, y, z) => this.blockAt(x, y, z);

    this.stats = { ticks: 0, snapshotBytes: 0, peakPlayers: 0 };
    this.lastActivity = Date.now();
  }

  // -- arena selection -------------------------------------------------------
  /**
   * Picks a landmass centre with enough dry land for the play space, so a
   * match never starts over open ocean.
   */
  _chooseArena() {
    let best = null;
    for (let attempt = 0; attempt < 220; attempt++) {
      const a = this.rng.next() * Math.PI * 2;
      const r = Math.sqrt(this.rng.next()) * WORLD.RADIUS * 0.55;
      const cx = Math.round(Math.cos(a) * r);
      const cz = Math.round(Math.sin(a) * r);
      let land = 0;
      const samples = 24;
      for (let i = 0; i < samples; i++) {
        const sa = (i / samples) * Math.PI * 2;
        for (const sr of [180, 420, 700]) {
          const x = Math.round(cx + Math.cos(sa) * sr);
          const z = Math.round(cz + Math.sin(sa) * sr);
          if (this.world.column(x, z).height > WORLD.SEA_LEVEL + 1) land++;
        }
      }
      const score = land;
      if (!best || score > best.score) best = { cx, cz, score };
      if (score >= samples * 3 * 0.8) break;
    }
    this.arena = { cx: best.cx, cz: best.cz, radius: 900 };
    this.zone.cx = this.zone.targetCx = best.cx;
    this.zone.cz = this.zone.targetCz = best.cz;
    this.zone.radius = this.zone.targetRadius = this.arena.radius;

    // Flight path across the arena at a random bearing.
    const bearing = this.rng.next() * Math.PI * 2;
    this.plane.dx = Math.cos(bearing);
    this.plane.dz = Math.sin(bearing);
    this.plane.x = this.arena.cx - this.plane.dx * (this.arena.radius + 380);
    this.plane.z = this.arena.cz - this.plane.dz * (this.arena.radius + 380);

    this.landmarks = this.world
      .structuresInRegion(
        this.arena.cx - this.arena.radius,
        this.arena.cz - this.arena.radius,
        this.arena.cx + this.arena.radius,
        this.arena.cz + this.arena.radius,
      )
      .map((s) => ({ key: s.key, name: s.name, x: s.x, z: s.z, y: s.y, radius: s.radius, loot: s.loot, type: s.type }));
  }

  // -- voxel access ----------------------------------------------------------
  blockAt(x, y, z) {
    if (y < 0 || y >= WORLD.HEIGHT) return 0;
    const key = packKey(x, y, z);
    const edited = this.edits.get(key);
    if (edited !== undefined) return edited;
    return this.world.getBlock(x, y, z);
  }

  setBlock(x, y, z, id, source) {
    if (y < 1 || y >= WORLD.HEIGHT) return false;
    if (this.edits.size >= MAX_EDITS && !this.edits.has(packKey(x, y, z))) return false;
    const key = packKey(x, y, z);
    const natural = this.world.getBlock(x, y, z);
    if (id === natural) this.edits.delete(key);
    else this.edits.set(key, id);
    this.pendingEdits.push({ x, y, z, id });
    if (this.pendingEdits.length > 4000) this.pendingEdits.splice(0, this.pendingEdits.length - 4000);
    return true;
  }

  // ==========================================================================
  //  Player lifecycle
  // ==========================================================================
  addPlayer(user, conn, opts = {}) {
    if (this.players.has(user.id)) {
      const existing = this.players.get(user.id);
      existing.conn = conn;
      existing.connected = true;
      existing.disconnectedAt = 0;
      return existing;
    }
    if (this.state === 'ended') return null;
    if (this.players.size >= this.mode.maxPlayers) return null;

    const teamId = opts.teamId != null ? opts.teamId : this._assignTeam(opts.partyId);
    const spawn = this._lobbySpawn();

    const player = {
      userId: user.id,
      name: user.name,
      level: user.level,
      entityId: newEntityId(),
      conn,
      connected: true,
      disconnectedAt: 0,
      teamId,
      partyId: opts.partyId || null,
      skin: user.cosmetics?.skin || 'ranger',
      trail: user.cosmetics?.trail || 'none',
      avatar: user.avatar,

      s: Movement.createState(spawn.x, spawn.y, spawn.z, this.rng.next() * Math.PI * 2),
      health: COMBAT.MAX_HEALTH,
      shield: 0,
      downed: false,
      downedTimer: 0,
      alive: true,
      spectating: null,
      revivingBy: null,
      reviveProgress: 0,

      inv: createInventory(),
      useAction: null, // {item, endsAt}
      lastFireTick: -999,
      lastMeleeTick: -999,
      reloadEndsAt: 0,
      switchEndsAt: 0,

      // networking
      lastSeq: 0,
      lastKeys: 0,
      inPlane: false,
      dropped: false,
      inputQueue: [],
      history: [], // rewind buffer for lag compensation
      lastSnapshotTick: 0,
      ping: 0,
      clockOffset: 0,
      inputBudget: 0,
      lastInputAt: Date.now(),

      // scoring
      kills: 0,
      assists: 0,
      damage: 0,
      headshots: 0,
      dinoKills: 0,
      apexKills: 0,
      tranquilised: 0,
      revives: 0,
      blocksPlaced: 0,
      blocksBroken: 0,
      vaults: 0,
      distance: 0,
      waterTime: 0,
      maxAltitude: spawn.y,
      longestKill: 0,
      killStreak: 0,
      bestStreak: 0,
      placement: 0,
      landmarksVisited: new Set(),
      recentDamagers: new Map(), // userId -> {amount, at}
      joinedAt: Date.now(),
      deathAt: 0,
      voiceMuted: false,
      mutedBy: new Set(),
      speaking: false,
    };

    this._giveStartingKit(player);
    this.players.set(user.id, player);
    this.byEntityId.set(player.entityId, player);

    let team = this.teams.get(teamId);
    if (!team) {
      team = { id: teamId, members: new Set(), alive: true, place: 0 };
      this.teams.set(teamId, team);
    }
    team.members.add(user.id);

    this.aliveCount = this._countAlive();
    this.stats.peakPlayers = Math.max(this.stats.peakPlayers, this.players.size);
    this.lastActivity = Date.now();
    return player;
  }

  _assignTeam(partyId) {
    if (partyId) {
      for (const p of this.players.values()) {
        if (p.partyId === partyId) {
          const team = this.teams.get(p.teamId);
          if (team && team.members.size < this.mode.teamSize) return p.teamId;
        }
      }
    }
    if (this.mode.teamSize === 1) {
      let id = 1;
      while (this.teams.has(id)) id++;
      return id;
    }
    // Fill partially-populated teams first, then open a new one.
    for (const [id, team] of this.teams) {
      if (team.members.size < this.mode.teamSize) return id;
    }
    let id = 1;
    while (this.teams.has(id)) id++;
    return id;
  }

  _lobbySpawn() {
    const a = this.rng.next() * Math.PI * 2;
    const r = 30 + this.rng.next() * 40;
    const x = Math.round(this.arena.cx + Math.cos(a) * r);
    const z = Math.round(this.arena.cz + Math.sin(a) * r);
    const spawn = this.world.safeSpawn(x, z);
    return spawn;
  }

  _giveStartingKit(player) {
    const inv = player.inv;
    inv.weapons[2] = weaponInstance(Content.WEAPON_BY_KEY.fists, 0);
    inv.slot = 2;
    inv.materials.wood = 40;
    inv.items.bandage = 2;
    if (this.modeKey === 'apex_hunt') {
      inv.weapons[0] = weaponInstance(Content.WEAPON_BY_KEY.ranger_ar, 0);
      inv.ammo.medium = 90;
      inv.slot = 0;
    }
  }

  removePlayer(userId, hard = false) {
    const player = this.players.get(userId);
    if (!player) return;
    if (!hard && this.state === 'active' && player.alive) {
      // Soft drop: keep the body in the world so a reconnect can resume it.
      player.connected = false;
      player.disconnectedAt = Date.now();
      player.conn = null;
      return;
    }
    if (player.alive) this._eliminate(player, null, 'left');
    this.players.delete(userId);
    this.byEntityId.delete(player.entityId);
    const team = this.teams.get(player.teamId);
    if (team) {
      team.members.delete(userId);
      if (team.members.size === 0) this.teams.delete(player.teamId);
    }
    this.lastActivity = Date.now();
  }

  reconnect(userId, user, conn) {
    const player = this.players.get(userId);
    if (!player) return null;
    player.conn = conn;
    player.connected = true;
    player.disconnectedAt = 0;
    player.name = user.name;
    this.sendFullState(player);
    return player;
  }

  _countAlive() {
    let n = 0;
    for (const p of this.players.values()) if (p.alive) n++;
    return n;
  }

  aliveTeams() {
    let n = 0;
    for (const t of this.teams.values()) if (t.alive) n++;
    return n;
  }

  teammatesOf(player) {
    const team = this.teams.get(player.teamId);
    if (!team) return [];
    const out = [];
    for (const id of team.members) {
      const p = this.players.get(id);
      if (p && p !== player) out.push(p);
    }
    return out;
  }

  // ==========================================================================
  //  Lifecycle
  // ==========================================================================
  canStart() {
    if (this.state !== 'lobby') return false;
    const ready = this.players.size;
    return ready >= this.mode.minToStart;
  }

  beginCountdown(seconds) {
    if (this.state !== 'lobby') return;
    this.lobbyDeadline = Date.now() + seconds * 1000;
    this.broadcastJson({ t: 'match.countdown', endsAt: this.lobbyDeadline, seconds });
  }

  start() {
    if (this.state !== 'lobby') return;
    this.state = 'dropping';
    this.startedAt = Date.now();
    this.plane.active = true;
    this.plane.x = this.arena.cx - this.plane.dx * (this.arena.radius + 380);
    this.plane.z = this.arena.cz - this.plane.dz * (this.arena.radius + 380);

    // Everyone boards the dropship above the flight path.
    for (const p of this.players.values()) {
      p.s.x = this.plane.x;
      p.s.y = this.plane.y;
      p.s.z = this.plane.z;
      p.s.vx = p.s.vy = p.s.vz = 0;
      p.s.parachute = false;
      p.inPlane = true;
      p.dropped = false;
    }

    this.zone.phase = -1;
    this.zone.nextEventAt = Date.now() + 45000;
    this._spawnInitialLoot();
    this._spawnInitialDinos();

    this.broadcastJson({
      t: 'match.start',
      at: this.startedAt,
      plane: { x: this.plane.x, z: this.plane.z, dx: this.plane.dx, dz: this.plane.dz, y: this.plane.y },
      arena: this.arena,
    });
  }

  end(reason = 'complete') {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.endedAt = Date.now();

    // Assign placements to whoever is still standing.
    const remaining = [];
    for (const t of this.teams.values()) if (t.alive) remaining.push(t);
    for (const t of remaining) {
      t.place = 1;
      for (const id of t.members) {
        const p = this.players.get(id);
        if (p) p.placement = 1;
      }
    }

    this.results = this.buildResults();
    this.broadcastJson({ t: 'match.end', reason, results: this.results });
  }

  buildResults() {
    const rows = [];
    for (const p of this.players.values()) {
      rows.push({
        userId: p.userId,
        name: p.name,
        teamId: p.teamId,
        placement: p.placement || this.teams.get(p.teamId)?.place || 0,
        kills: p.kills,
        assists: p.assists,
        damage: Math.round(p.damage),
        headshots: p.headshots,
        dinoKills: p.dinoKills,
        apexKills: p.apexKills,
        tranquilised: p.tranquilised,
        revives: p.revives,
        blocksPlaced: p.blocksPlaced,
        blocksBroken: p.blocksBroken,
        distance: Math.round(p.distance),
        waterTime: Math.round(p.waterTime),
        maxAltitude: Math.round(p.maxAltitude),
        longestKill: Math.round(p.longestKill),
        killStreak: p.bestStreak,
        landmarks: p.landmarksVisited.size,
        vaults: p.vaults,
        survivalTime: Math.round(((p.deathAt || this.endedAt) - this.startedAt) / 1000),
        died: !p.alive,
        won: (p.placement || this.teams.get(p.teamId)?.place || 0) === 1,
        partySize: this.teams.get(p.teamId)?.members.size || 1,
      });
    }
    rows.sort((a, b) => (a.placement || 999) - (b.placement || 999) || b.kills - a.kills);
    return {
      matchId: this.id,
      mode: this.modeKey,
      duration: Math.round((this.endedAt - this.startedAt) / 1000),
      players: rows,
      winnerTeam: rows.find((r) => r.placement === 1)?.teamId ?? null,
    };
  }

  // ==========================================================================
  //  Loot + creatures
  // ==========================================================================
  _spawnInitialLoot() {
    // Landmarks get the richer loot but only a share of the budget - the rest
    // is reserved for field spawns so players who drop away from a named
    // location are not left empty handed.
    const landmarkBudget = Math.floor(LOOT_BUDGET * 0.55);

    // Landmark loot: density proportional to the structure's risk rating.
    for (const lm of this.landmarks) {
      if (this.loot.size >= landmarkBudget) break;
      const count = Math.round(lm.loot * 5);
      for (let i = 0; i < count; i++) {
        if (this.loot.size >= landmarkBudget) break;
        const a = this.rng.next() * Math.PI * 2;
        const r = this.rng.next() * lm.radius;
        const x = Math.round(lm.x + Math.cos(a) * r);
        const z = Math.round(lm.z + Math.sin(a) * r);
        const y = this._groundY(x, z);
        if (y == null) continue;
        this._spawnLootPile(x + 0.5, y, z + 0.5, lm.key === 'vault' ? 'supply_case' : 'crate', Math.min(3, Math.floor(lm.loot)));
      }
    }
    // Scattered field loot inside the arena.
    const scatter = 640;
    for (let i = 0; i < scatter; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const r = Math.sqrt(this.rng.next()) * this.arena.radius;
      const x = Math.round(this.arena.cx + Math.cos(a) * r);
      const z = Math.round(this.arena.cz + Math.sin(a) * r);
      const y = this._groundY(x, z);
      if (y == null) continue;
      this._spawnLootPile(x + 0.5, y, z + 0.5, 'ground', 0);
    }
  }

  _groundY(x, z) {
    const col = this.world.column(x, z);
    if (col.height <= WORLD.SEA_LEVEL) return null;
    return col.height + 1;
  }

  _spawnLootPile(x, y, z, table, bias) {
    if (this.loot.size >= LOOT_BUDGET) return;
    const t = Content.LOOT_TABLES[table] || Content.LOOT_TABLES.ground;
    const rolls = this.rng.int(t.rolls[0], t.rolls[1]);
    for (let i = 0; i < rolls; i++) {
      const item = this._rollLoot(t, bias);
      if (!item) continue;
      const jx = x + this.rng.range(-0.8, 0.8);
      const jz = z + this.rng.range(-0.8, 0.8);
      this._createLoot(jx, y, jz, item);
    }
  }

  _rollLoot(table, bias = 0) {
    const roll = this.rng.next();
    if (roll < table.weapons * 0.34) {
      const pool = Content.WEAPONS.filter((w) => w.lootWeight);
      const picked = this.rng.weighted(pool.map((w) => ({ weight: w.lootWeight, w })));
      const rarity = this._rollRarity(table.rarityBias + bias);
      return { kind: 'weapon', key: picked.w.key, rarity };
    }
    if (roll < table.weapons * 0.34 + table.items * 0.36) {
      const pool = Content.ITEMS.filter((it) => it.lootWeight);
      const picked = this.rng.weighted(pool.map((it) => ({ weight: it.lootWeight, it })));
      const count = picked.it.type === 'material' ? 50 : this.rng.int(1, Math.min(3, picked.it.stack));
      return { kind: 'item', key: picked.it.key, count };
    }
    const ammo = this.rng.pick(Content.AMMO_TYPES);
    return { kind: 'ammo', key: ammo.key, count: ammo.stack * this.rng.int(1, 2) };
  }

  _rollRarity(bias = 0) {
    const entries = Content.RARITY.map((r) => ({
      weight: r.weight * Math.pow(1.55, Math.min(4, Math.max(0, bias)) * (r.id / 2)),
      r,
    }));
    return this.rng.weighted(entries).r.id;
  }

  _createLoot(x, y, z, item) {
    const id = newEntityId();
    const loot = { id, x, y, z, ...item, spawnedAt: Date.now() };
    this.loot.set(id, loot);
    return loot;
  }

  _spawnInitialDinos() {
    // Enough saurians that a player almost always has one within earshot, but
    // bounded so AI cost stays predictable.
    const target = Math.min(DINO_BUDGET, 72 + this.players.size * 2);
    for (let i = 0; i < target; i++) this._spawnDino();
  }

  _spawnDino(forcedKey) {
    if (this.dinos.size >= DINO_BUDGET) return null;
    for (let attempt = 0; attempt < 24; attempt++) {
      const a = this.rng.next() * Math.PI * 2;
      const r = Math.sqrt(this.rng.next()) * this.arena.radius * 1.05;
      const x = Math.round(this.arena.cx + Math.cos(a) * r);
      const z = Math.round(this.arena.cz + Math.sin(a) * r);
      const col = this.world.column(x, z);
      const biomeKey = BIOME_INFO[col.biome].key;

      let candidates = Content.DINOS.filter((d) => d.biomes.includes(biomeKey));
      if (forcedKey) candidates = Content.DINOS.filter((d) => d.key === forcedKey);
      if (!candidates.length) continue;

      const def = this.rng.pick(candidates);
      const aquatic = !!def.aquatic;
      if (aquatic && col.height > WORLD.SEA_LEVEL - 3) continue;
      if (!aquatic && col.height <= WORLD.SEA_LEVEL) continue;

      const y = aquatic ? WORLD.SEA_LEVEL - 3 - this.rng.next() * 8 : col.height + 1;
      const packSize = def.pack > 1 ? this.rng.int(1, def.pack) : 1;
      let first = null;
      for (let k = 0; k < packSize && this.dinos.size < DINO_BUDGET; k++) {
        const d = this._createDino(def, x + this.rng.range(-4, 4), y, z + this.rng.range(-4, 4));
        if (!first) first = d;
      }
      return first;
    }
    return null;
  }

  _createDino(def, x, y, z) {
    const id = newEntityId();
    const dino = {
      id,
      typeId: def.id,
      key: def.key,
      def,
      x,
      y,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: this.rng.next() * Math.PI * 2,
      targetYaw: 0,
      hp: def.hp,
      maxHp: def.hp,
      state: Content.DINO_STATE.WANDER,
      stateTime: 0,
      targetId: null,
      lastAttack: 0,
      sedation: 0,
      homeX: x,
      homeZ: z,
      wanderX: x,
      wanderZ: z,
      alerted: 0,
      onGround: false,
      lure: null,
      anim: 0,
    };
    this.dinos.set(id, dino);
    return dino;
  }

  // ==========================================================================
  //  Client -> server messages
  // ==========================================================================
  handleBinary(player, data) {
    if (!player || !this.players.has(player.userId)) return;
    const r = new Reader(data);
    if (r.remaining < 1) return;
    const op = r.u8r();
    player.lastInputAt = Date.now();
    this.lastActivity = Date.now();

    switch (op) {
      case OP.C_INPUT:
        this._recvInput(player, r);
        break;
      case OP.C_FIRE:
        this._recvFire(player, r);
        break;
      case OP.C_MELEE:
        this._recvMelee(player, r);
        break;
      case OP.C_BUILD:
        this._recvBuild(player, r);
        break;
      case OP.C_MARK:
        this._recvMark(player, r);
        break;
      case OP.C_EMOTE:
        this._recvEmote(player, r);
        break;
      case OP.C_RELOAD:
        this._recvReload(player);
        break;
      case OP.C_SWAP:
        this._recvSwap(player, r);
        break;
      case OP.C_USE_ITEM:
        this._recvUseItem(player, r);
        break;
      case OP.C_LOOT:
        this._recvLoot(player, r);
        break;
      case OP.C_DROP:
        this._recvDrop(player, r);
        break;
      case OP.C_REVIVE:
        this._recvRevive(player, r);
        break;
      case OP.C_INTERACT:
        this._recvInteract(player, r);
        break;
      case OP.C_TIME_SYNC: {
        const clientTime = r.f64r();
        const w = new Writer(32);
        w.u8w(OP.S_TIME_SYNC).f64w(clientTime).f64w(Date.now()).u32w(this.tick);
        this._sendBinary(player, w);
        break;
      }
      default:
        break;
    }
  }

  _recvInput(player, r) {
    // Rate guard: a client may not queue more than ~4 ticks of input per tick.
    if (player.inputQueue.length > 24) return;
    const count = r.u8r();
    if (count > Protocol.MAX_INPUTS_PER_PACKET) return;
    for (let i = 0; i < count; i++) {
      if (r.remaining < 13) break;
      const seq = r.u32r();
      const keys = r.u16r();
      const yaw = r.yawr();
      const pitch = r.pitr();
      const dtMs = r.u8r();
      // Analog stick, clamped to the unit disc so a crafted packet cannot
      // request more than full speed.
      let moveX = r.i8r() / 127;
      let moveY = r.i8r() / 127;
      const mag = Math.hypot(moveX, moveY);
      if (mag > 1) { moveX /= mag; moveY /= mag; }
      if (seq <= player.lastSeq) continue; // stale or duplicate
      const dt = clamp(dtMs / 1000, 0.004, 0.1);
      player.inputQueue.push({ seq, keys, yaw, pitch, dt, moveX, moveY });
    }
    // Keep the queue ordered even if packets arrive out of order.
    player.inputQueue.sort((a, b) => a.seq - b.seq);
  }

  _recvFire(player, r) {
    const seq = r.u32r();
    let ox = r.f32r();
    let oy = r.f32r();
    let oz = r.f32r();
    const dx = r.f32r();
    const dy = r.f32r();
    const dz = r.f32r();
    const clientTime = r.f64r();
    if (!player.alive || player.downed) return;

    const weapon = player.inv.weapons[player.inv.slot];
    if (!weapon) return;
    const def = Content.WEAPON_BY_ID[weapon.id];
    if (!def || def.fireMode === 'melee') return;

    const now = Date.now();
    const minInterval = 60000 / def.rpm;
    // 12% tolerance absorbs timer jitter without allowing rapid-fire scripts.
    if (now - weapon.lastFire < minInterval * 0.88) return;
    if (player.reloadEndsAt > now || player.switchEndsAt > now) return;
    if (weapon.ammoInMag <= 0) {
      this._pushEvent(EV.RELOAD, { entityId: player.entityId, empty: 1 });
      return;
    }

    weapon.lastFire = now;
    weapon.ammoInMag--;

    // The client's reported ray origin must be near the authoritative eye.
    const eye = Movement.eyePosition(player.s);
    if (dist2(ox, oy, oz, eye.x, eye.y, eye.z) > 2.25) {
      ox = eye.x;
      oy = eye.y;
      oz = eye.z;
    }
    const len = Math.hypot(dx, dy, dz) || 1;
    const ndx = dx / len;
    const ndy = dy / len;
    const ndz = dz / len;

    // Server-side spread using the server's own RNG so clients cannot
    // predict or remove it.
    const aiming = (player.lastKeys & Protocol.IN.AIM) !== 0;
    const moving = Math.hypot(player.s.vx, player.s.vz) > 1.5;
    let spreadDeg = aiming ? (def.adsSpread ?? def.spread * 0.3) : def.spread;
    if (moving) spreadDeg *= 1.6;
    if (!player.s.onGround) spreadDeg *= 2.0;
    if (player.s.crouching) spreadDeg *= 0.7;

    const pellets = def.pellets || 1;
    const rewindMs = clamp(Date.now() - clientTime + player.ping / 2, 0, COMBAT.MAX_LAG_COMPENSATION_MS);

    this._pushEvent(EV.SHOT, {
      entityId: player.entityId,
      weaponId: def.id,
      x: ox,
      y: oy,
      z: oz,
      dx: ndx,
      dy: ndy,
      dz: ndz,
    });

    if (def.bulletSpeed && def.bulletSpeed < 300 && (def.class === 'explosive' || def.ammo === 'bolt' || def.ammo === 'dart')) {
      this._spawnProjectile(player, def, weapon, ox, oy, oz, ndx, ndy, ndz);
      return;
    }

    for (let i = 0; i < pellets; i++) {
      const [sx, sy, sz] = this._applySpread(ndx, ndy, ndz, spreadDeg);
      this._hitscan(player, def, weapon, ox, oy, oz, sx, sy, sz, rewindMs);
    }
  }

  _applySpread(dx, dy, dz, spreadDeg) {
    if (spreadDeg <= 0) return [dx, dy, dz];
    const rad = (spreadDeg * Math.PI) / 180;
    const a = this.rng.next() * Math.PI * 2;
    const m = Math.sqrt(this.rng.next()) * rad;
    // Build an orthonormal basis around the aim direction.
    let ux = 0;
    let uy = 1;
    let uz = 0;
    if (Math.abs(dy) > 0.95) {
      ux = 1;
      uy = 0;
    }
    let rx = uy * dz - uz * dy;
    let ry = uz * dx - ux * dz;
    let rz = ux * dy - uy * dx;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl;
    ry /= rl;
    rz /= rl;
    const bx = dy * rz - dz * ry;
    const by = dz * rx - dx * rz;
    const bz = dx * ry - dy * rx;
    const ox = Math.cos(a) * Math.sin(m);
    const oy = Math.sin(a) * Math.sin(m);
    const c = Math.cos(m);
    const nx = dx * c + rx * ox + bx * oy;
    const ny = dy * c + ry * ox + by * oy;
    const nz = dz * c + rz * ox + bz * oy;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }

  /** Rewind other entities, trace, apply damage. */
  _hitscan(shooter, def, weapon, ox, oy, oz, dx, dy, dz, rewindMs) {
    const maxDist = def.range;
    const voxelHit = Movement.raycast(this.getBlock, ox, oy, oz, dx, dy, dz, maxDist);
    let closest = voxelHit ? voxelHit.distance : maxDist;
    let target = null;
    let targetPart = 'body';

    const rewindTicks = Math.round((rewindMs / 1000) * TICK_RATE);

    for (const other of this.players.values()) {
      if (other === shooter || !other.alive) continue;
      if (other.teamId === shooter.teamId && this.mode.teamSize > 1) continue;
      const past = this._rewindPlayer(other, rewindTicks);
      const hb = this._hitboxes(past, other);
      for (const box of hb) {
        const t = Movement.rayBox(ox, oy, oz, dx, dy, dz, box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ);
        if (t >= 0 && t < closest) {
          closest = t;
          target = other;
          targetPart = box.part;
        }
      }
    }

    for (const dino of this.dinos.values()) {
      if (dino.state === Content.DINO_STATE.DEAD) continue;
      const size = dino.def.size;
      const t = Movement.rayBox(
        ox,
        oy,
        oz,
        dx,
        dy,
        dz,
        dino.x - size[0] / 2,
        dino.y,
        dino.z - size[2] / 2,
        dino.x + size[0] / 2,
        dino.y + size[1],
        dino.z + size[2] / 2,
      );
      if (t >= 0 && t < closest) {
        closest = t;
        target = dino;
        targetPart = 'body';
      }
    }

    if (target && target.def) {
      // Saurian
      const dmg = weapon.damage * (def.tranq ? 0.4 : 1);
      this._damageDino(target, dmg, shooter, def);
      this._pushEvent(EV.HIT, {
        x: ox + dx * closest,
        y: oy + dy * closest,
        z: oz + dz * closest,
        kind: 1,
        entityId: shooter.entityId,
      });
      return;
    }

    if (target) {
      const mult = targetPart === 'head' ? COMBAT.HEADSHOT_MULT : targetPart === 'limb' ? COMBAT.LIMB_MULT : 1;
      const falloff = clamp(1 - (closest / def.range) * 0.35, 0.55, 1);
      const dmg = weapon.damage * mult * falloff;
      if (targetPart === 'head') shooter.headshots++;
      this._damagePlayer(target, dmg, shooter, { part: targetPart, distance: closest, weapon: def.key });
      this._pushEvent(EV.HIT, {
        x: ox + dx * closest,
        y: oy + dy * closest,
        z: oz + dz * closest,
        kind: targetPart === 'head' ? 2 : 0,
        entityId: shooter.entityId,
      });
      return;
    }

    if (voxelHit) {
      this._pushEvent(EV.HIT, {
        x: voxelHit.px,
        y: voxelHit.py,
        z: voxelHit.pz,
        kind: 3,
        entityId: shooter.entityId,
        block: voxelHit.block,
      });
      // Bullets chip destructible cover.
      if (isBreakable(voxelHit.block)) {
        const hardness = WorldGen.HARDNESS[voxelHit.block] || 1;
        if (weapon.damage / (hardness * 22) > this.rng.next()) {
          this._breakBlock(voxelHit.x, voxelHit.y, voxelHit.z, shooter, false);
        }
      }
    }
  }

  _hitboxes(state, player) {
    const h = state.height ?? PHYS.PLAYER_HEIGHT;
    const r = PHYS.PLAYER_RADIUS;
    const x = state.x;
    const y = state.y;
    const z = state.z;
    const headTop = y + h;
    const headBottom = y + h * 0.86;
    return [
      { part: 'head', minX: x - r * 0.72, minY: headBottom, minZ: z - r * 0.72, maxX: x + r * 0.72, maxY: headTop, maxZ: z + r * 0.72 },
      { part: 'body', minX: x - r, minY: y + h * 0.42, minZ: z - r, maxX: x + r, maxY: headBottom, maxZ: z + r },
      { part: 'limb', minX: x - r * 1.15, minY: y, minZ: z - r * 1.15, maxX: x + r * 1.15, maxY: y + h * 0.42, maxZ: z + r * 1.15 },
    ];
  }

  _rewindPlayer(player, ticks) {
    if (ticks <= 0 || player.history.length === 0) return player.s;
    const idx = Math.max(0, player.history.length - 1 - ticks);
    return player.history[idx] || player.s;
  }

  _spawnProjectile(shooter, def, weapon, x, y, z, dx, dy, dz) {
    const id = newEntityId();
    this.projectiles.set(id, {
      id,
      ownerId: shooter.userId,
      ownerEntity: shooter.entityId,
      teamId: shooter.teamId,
      weaponId: def.id,
      key: def.key,
      x,
      y,
      z,
      vx: dx * def.bulletSpeed,
      vy: dy * def.bulletSpeed,
      vz: dz * def.bulletSpeed,
      gravity: def.gravity || 0,
      damage: weapon.damage,
      splash: def.splash || 0,
      tranq: def.tranq || 0,
      life: 6,
    });
  }

  _recvMelee(player, r) {
    if (!player.alive || player.downed) return;
    const weapon = player.inv.weapons[player.inv.slot] || player.inv.weapons[2];
    const def = Content.WEAPON_BY_ID[weapon.id];
    const now = Date.now();
    const minInterval = 60000 / def.rpm;
    if (now - (weapon.lastFire || 0) < minInterval * 0.85) return;
    weapon.lastFire = now;

    const eye = Movement.eyePosition(player.s);
    const dir = Movement.lookVector(player.s.yaw, player.s.pitch);
    const range = def.range || 2.6;

    // Melee also mines blocks (with a pick multiplier).
    const voxel = Movement.raycast(this.getBlock, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, range);
    let bestT = voxel ? voxel.distance : range;
    let victim = null;
    for (const other of this.players.values()) {
      if (other === player || !other.alive) continue;
      if (other.teamId === player.teamId && this.mode.teamSize > 1) continue;
      for (const box of this._hitboxes(other.s, other)) {
        const t = Movement.rayBox(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ);
        if (t >= 0 && t < bestT) {
          bestT = t;
          victim = { player: other, part: box.part };
        }
      }
    }
    let dinoVictim = null;
    for (const dino of this.dinos.values()) {
      if (dino.state === Content.DINO_STATE.DEAD) continue;
      const s = dino.def.size;
      const t = Movement.rayBox(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, dino.x - s[0] / 2, dino.y, dino.z - s[2] / 2, dino.x + s[0] / 2, dino.y + s[1], dino.z + s[2] / 2);
      if (t >= 0 && t < bestT) {
        bestT = t;
        dinoVictim = dino;
        victim = null;
      }
    }

    if (victim) {
      const mult = victim.part === 'head' ? COMBAT.HEADSHOT_MULT * 0.8 : 1;
      this._damagePlayer(victim.player, weapon.damage * mult, player, { part: victim.part, distance: bestT, weapon: def.key });
      this._pushEvent(EV.HIT, { x: eye.x + dir.x * bestT, y: eye.y + dir.y * bestT, z: eye.z + dir.z * bestT, kind: 0, entityId: player.entityId });
    } else if (dinoVictim) {
      this._damageDino(dinoVictim, weapon.damage, player, def);
      this._pushEvent(EV.HIT, { x: eye.x + dir.x * bestT, y: eye.y + dir.y * bestT, z: eye.z + dir.z * bestT, kind: 1, entityId: player.entityId });
    } else if (voxel) {
      this._breakBlock(voxel.x, voxel.y, voxel.z, player, true, def.harvest || 1);
    }
  }

  _recvBuild(player, r) {
    const action = r.u8r(); // 0 = break, 1 = place
    const x = r.i32r();
    const y = r.i16r();
    const z = r.i32r();
    const blockId = r.u16r();
    if (!player.alive || player.downed) return;
    if (this.state !== 'active' && this.state !== 'dropping') return;

    const eye = Movement.eyePosition(player.s);
    const reach = 6.0;
    if (dist2(eye.x, eye.y, eye.z, x + 0.5, y + 0.5, z + 0.5) > reach * reach) return;

    if (action === 0) {
      this._breakBlock(x, y, z, player, true);
      return;
    }

    // --- placement
    const buildable = { build_wood: 'wood', build_stone: 'stone', build_metal: 'metal', build_ramp: 'wood', ladder: 'wood', torch: 'wood' };
    const name = WorldGen.BLOCKS[blockId]?.name;
    const matKey = buildable[name];
    if (!matKey) return;
    const cost = name === 'torch' ? 2 : name === 'ladder' ? 3 : 10;
    if (player.inv.materials[matKey] < cost) return;
    if (isSolid(this.blockAt(x, y, z))) return;

    // Cannot build inside a player.
    for (const other of this.players.values()) {
      if (!other.alive) continue;
      if (
        x + 1 > other.s.x - PHYS.PLAYER_RADIUS &&
        x < other.s.x + PHYS.PLAYER_RADIUS &&
        z + 1 > other.s.z - PHYS.PLAYER_RADIUS &&
        z < other.s.z + PHYS.PLAYER_RADIUS &&
        y + 1 > other.s.y &&
        y < other.s.y + other.s.height
      ) {
        return;
      }
    }

    player.inv.materials[matKey] -= cost;
    this.setBlock(x, y, z, blockId, player);
    player.blocksPlaced++;
    this._pushEvent(EV.BLOCK_PLACE, { x, y, z, block: blockId, entityId: player.entityId });
    this._sendInventory(player);
  }

  _breakBlock(x, y, z, player, giveMaterials, harvestMult = 1) {
    const id = this.blockAt(x, y, z);
    if (!id || !isBreakable(id)) return false;
    if (y <= WORLD.BEDROCK) return false;
    this.setBlock(x, y, z, 0, player);
    if (player) player.blocksBroken++;
    this._pushEvent(EV.BLOCK_BREAK, { x, y, z, block: id, entityId: player ? player.entityId : 0 });

    if (player && giveMaterials) {
      const name = WorldGen.BLOCKS[id].name;
      const inv = player.inv;
      const gain = Math.round(6 * harvestMult);
      if (name.startsWith('log_') || name === 'planks' || name === 'build_wood') inv.materials.wood = Math.min(400, inv.materials.wood + gain * 2);
      else if (name.includes('stone') || name === 'granite' || name === 'basalt' || name === 'obsidian' || name === 'sandstone' || name === 'concrete') {
        inv.materials.stone = Math.min(400, inv.materials.stone + gain);
      } else if (name.startsWith('metal') || name.startsWith('ore_') || name === 'build_metal') {
        inv.materials.metal = Math.min(300, inv.materials.metal + Math.max(2, Math.round(gain * 0.6)));
      } else if (name === 'dirt' || name === 'grass' || name === 'sand' || name === 'clay' || name === 'mud') {
        inv.materials.wood = Math.min(400, inv.materials.wood + 1);
      }

      // Containers drop loot instead of materials.
      if (id === B.crate || id === B.supply_case || id === B.nest_egg) {
        const table = id === B.supply_case ? 'supply_case' : id === B.nest_egg ? 'nest_egg' : 'crate';
        this._spawnLootPile(x + 0.5, y, z + 0.5, table, id === B.supply_case ? 2 : 0);
        if (id === B.supply_case) player.vaults++;
      }
      this._sendInventory(player);
    }
    return true;
  }

  _recvReload(player) {
    const weapon = player.inv.weapons[player.inv.slot];
    if (!weapon) return;
    const def = Content.WEAPON_BY_ID[weapon.id];
    if (!def.mag || weapon.ammoInMag >= def.mag) return;
    const reserve = player.inv.ammo[def.ammo] || 0;
    if (reserve <= 0) return;
    const now = Date.now();
    if (player.reloadEndsAt > now) return;
    player.reloadEndsAt = now + def.reload * 1000;
    player.reloadWeapon = weapon;
    this._pushEvent(EV.RELOAD, { entityId: player.entityId, weaponId: def.id });
  }

  _finishReload(player) {
    const weapon = player.reloadWeapon;
    if (!weapon) return;
    const def = Content.WEAPON_BY_ID[weapon.id];
    const need = def.mag - weapon.ammoInMag;
    const take = Math.min(need, player.inv.ammo[def.ammo] || 0);
    weapon.ammoInMag += take;
    player.inv.ammo[def.ammo] -= take;
    player.reloadWeapon = null;
    this._sendInventory(player);
  }

  _recvSwap(player, r) {
    const slot = r.u8r();
    if (slot > 2) return;
    if (!player.inv.weapons[slot]) return;
    player.inv.slot = slot;
    player.switchEndsAt = Date.now() + 350;
    player.reloadEndsAt = 0;
    player.reloadWeapon = null;
    this._sendInventory(player);
  }

  _recvUseItem(player, r) {
    const keyLen = r.u8r();
    let key = '';
    for (let i = 0; i < keyLen; i++) key += String.fromCharCode(r.u8r());
    if (!player.alive) return;
    const item = Content.ITEM_BY_KEY[key];
    if (!item) return;
    const have = player.inv.items[key] || 0;
    if (have <= 0) return;
    if (player.useAction) return;

    if (item.type === 'heal' && player.health >= COMBAT.MAX_HEALTH) return;
    if (item.type === 'shield' && player.shield >= COMBAT.MAX_SHIELD) return;

    if (item.type === 'throw') {
      this._throwItem(player, item);
      player.inv.items[key] = have - 1;
      this._sendInventory(player);
      return;
    }
    if (item.type === 'gear') {
      player.inv.gear[item.gear] = true;
      player.s.hasRebreather = !!player.inv.gear.oxygen;
      player.s.hasClaws = !!player.inv.gear.climb;
      player.inv.items[key] = have - 1;
      this._sendInventory(player);
      return;
    }
    player.useAction = { key, item, endsAt: Date.now() + item.time * 1000 };
    this._sendInventory(player);
  }

  _throwItem(player, item) {
    const eye = Movement.eyePosition(player.s);
    const dir = Movement.lookVector(player.s.yaw, player.s.pitch);
    const id = newEntityId();
    this.projectiles.set(id, {
      id,
      ownerId: player.userId,
      ownerEntity: player.entityId,
      teamId: player.teamId,
      key: item.key,
      thrown: true,
      x: eye.x,
      y: eye.y,
      z: eye.z,
      vx: dir.x * 22 + player.s.vx,
      vy: dir.y * 22 + 3 + player.s.vy,
      vz: dir.z * 22 + player.s.vz,
      gravity: PHYS.GRAVITY,
      damage: item.damage || 0,
      splash: item.splash || 0,
      smoke: item.smoke || 0,
      lure: item.lure || 0,
      supply: !!item.supply,
      fuse: item.fuse || 2.5,
      life: 12,
    });
  }

  _recvLoot(player, r) {
    const entityId = r.u16r();
    const loot = this.loot.get(entityId);
    if (!loot || !player.alive) return;
    if (dist2(player.s.x, player.s.y, player.s.z, loot.x, loot.y, loot.z) > 16) return;
    if (!this._giveLoot(player, loot)) return;
    this.loot.delete(entityId);
    this._pushEvent(EV.PICKUP, { entityId: player.entityId, lootId: entityId });
    this._sendInventory(player);
  }

  _giveLoot(player, loot) {
    const inv = player.inv;
    if (loot.kind === 'weapon') {
      const def = Content.WEAPON_BY_KEY[loot.key];
      if (!def) return false;
      const slot = def.slot === 'primary' ? 0 : def.slot === 'secondary' ? 1 : 2;
      const existing = inv.weapons[slot];
      if (existing && existing.key === def.key && existing.rarity >= loot.rarity) {
        // Same or better already held - convert to ammo instead of refusing.
        if (def.ammo) inv.ammo[def.ammo] = Math.min(this._ammoMax(def.ammo), (inv.ammo[def.ammo] || 0) + 10);
        return true;
      }
      if (existing) this._createLoot(player.s.x, player.s.y, player.s.z, { kind: 'weapon', key: existing.key, rarity: existing.rarity });
      inv.weapons[slot] = weaponInstance(def, loot.rarity);
      inv.slot = slot;
      player.switchEndsAt = Date.now() + 300;
      return true;
    }
    if (loot.kind === 'ammo') {
      const max = this._ammoMax(loot.key);
      inv.ammo[loot.key] = Math.min(max, (inv.ammo[loot.key] || 0) + loot.count);
      return true;
    }
    if (loot.kind === 'item') {
      const item = Content.ITEM_BY_KEY[loot.key];
      if (!item) return false;
      if (item.type === 'material') {
        const target = item.key === 'mat_wood' ? 'wood' : item.key === 'mat_stone' ? 'stone' : 'metal';
        inv.materials[target] = Math.min(400, inv.materials[target] + loot.count);
        return true;
      }
      const have = inv.items[loot.key] || 0;
      if (have >= item.stack) return false;
      inv.items[loot.key] = Math.min(item.stack, have + loot.count);
      return true;
    }
    return false;
  }

  _ammoMax(key) {
    return Content.AMMO_TYPES.find((a) => a.key === key)?.max || 200;
  }

  _recvDrop(player, r) {
    const kind = r.u8r(); // 0 weapon slot, 1 item
    if (kind === 0) {
      const slot = r.u8r();
      if (slot > 1) return;
      const w = player.inv.weapons[slot];
      if (!w) return;
      player.inv.weapons[slot] = null;
      if (player.inv.slot === slot) player.inv.slot = 2;
      this._createLoot(player.s.x, player.s.y + 0.4, player.s.z, { kind: 'weapon', key: w.key, rarity: w.rarity });
    } else {
      const keyLen = r.u8r();
      let key = '';
      for (let i = 0; i < keyLen; i++) key += String.fromCharCode(r.u8r());
      const have = player.inv.items[key] || 0;
      if (have <= 0) return;
      player.inv.items[key] = have - 1;
      this._createLoot(player.s.x, player.s.y + 0.4, player.s.z, { kind: 'item', key, count: 1 });
    }
    this._sendInventory(player);
  }

  _recvRevive(player, r) {
    const entityId = r.u16r();
    const target = this.byEntityId.get(entityId);
    if (!target || !target.downed || target.teamId !== player.teamId) return;
    if (dist2(player.s.x, player.s.y, player.s.z, target.s.x, target.s.y, target.s.z) > COMBAT.REVIVE_RANGE * COMBAT.REVIVE_RANGE) return;
    target.revivingBy = player.userId;
  }

  _recvInteract(player, r) {
    const entityId = r.u16r();
    const kind = r.u8r();
    if (kind === 0) {
      // Toggle parachute during the drop phase.
      if (!player.s.onGround && !player.inPlane) {
        player.s.parachute = !player.s.parachute;
      }
    } else if (kind === 1 && player.inPlane) {
      // Leave the dropship.
      player.inPlane = false;
      player.dropped = true;
      player.s.vy = -2;
      player.s.parachute = false;
    }
  }

  _recvMark(player, r) {
    const type = r.u8r();
    const x = r.f32r();
    const y = r.f32r();
    const z = r.f32r();
    if (!player.alive) return;
    if (this.markers.length > 60) this.markers.shift();
    const marker = {
      id: newEntityId(),
      type: clamp(type, 0, Content.PINGS.length - 1),
      x,
      y,
      z,
      teamId: player.teamId,
      by: player.entityId,
      byName: player.name,
      at: Date.now(),
      expires: Date.now() + 22000,
    };
    this.markers.push(marker);
    this._pushEvent(EV.MARK, { x, y, z, type: marker.type, entityId: player.entityId, teamId: player.teamId });
    for (const mate of [player, ...this.teammatesOf(player)]) {
      this._sendJson(mate, { t: 'match.mark', marker });
    }
  }

  _recvEmote(player, r) {
    const id = r.u8r();
    if (!player.alive) return;
    this._pushEvent(EV.EMOTE, { entityId: player.entityId, emote: id });
  }

  // ==========================================================================
  //  Damage + death
  // ==========================================================================
  _damagePlayer(target, amount, attacker, meta = {}) {
    if (!target.alive || amount <= 0) return 0;
    if (this.state === 'lobby') return 0;

    let remaining = amount;
    if (!target.downed && target.shield > 0) {
      const absorbed = Math.min(target.shield, remaining);
      target.shield -= absorbed;
      remaining -= absorbed;
    }

    if (target.downed) {
      // Downed players take direct health damage at a reduced rate.
      remaining *= 0.7;
    }

    target.health -= remaining;
    if (attacker) {
      attacker.damage += amount;
      target.recentDamagers.set(attacker.userId, { amount: (target.recentDamagers.get(attacker.userId)?.amount || 0) + amount, at: Date.now() });
    }

    this._pushEvent(EV.DAMAGE_TAKEN, {
      entityId: target.entityId,
      by: attacker ? attacker.entityId : 0,
      amount: Math.round(amount),
      part: meta.part === 'head' ? 2 : meta.part === 'limb' ? 1 : 0,
    });

    if (attacker && attacker.conn) {
      this._sendJson(attacker, {
        t: 'match.hitmarker',
        amount: Math.round(amount),
        part: meta.part || 'body',
        target: target.entityId,
        lethal: target.health <= 0,
      });
    }

    if (target.health <= 0) {
      const canBeDowned = this.mode.teamSize > 1 && !target.downed && this.teammatesOf(target).some((m) => m.alive && !m.downed);
      if (canBeDowned) {
        this._downPlayer(target, attacker);
      } else {
        this._eliminate(target, attacker, meta.weapon || 'unknown', meta.distance || 0);
      }
    }
    return amount;
  }

  _downPlayer(target, attacker) {
    target.downed = true;
    target.health = COMBAT.DOWNED_HEALTH * 0.5;
    target.shield = 0;
    target.s.downed = true;
    target.downedTimer = 0;
    target.useAction = null;
    this._pushEvent(EV.DOWNED, { entityId: target.entityId, by: attacker ? attacker.entityId : 0 });
    this.broadcastJson({
      t: 'match.feed',
      kind: 'downed',
      victim: target.name,
      victimTeam: target.teamId,
      attacker: attacker ? attacker.name : null,
      attackerTeam: attacker ? attacker.teamId : null,
    });
  }

  _eliminate(victim, killer, weaponKey = 'unknown', distance = 0) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.downed = false;
    victim.s.alive = false;
    victim.health = 0;
    victim.shield = 0;
    victim.deathAt = Date.now();
    victim.killStreak = 0;
    victim.useAction = null;

    // Drop everything the victim carried.
    for (let i = 0; i < 2; i++) {
      const w = victim.inv.weapons[i];
      if (w) this._createLoot(victim.s.x + (i ? 0.6 : -0.6), victim.s.y + 0.3, victim.s.z, { kind: 'weapon', key: w.key, rarity: w.rarity });
    }
    for (const [key, count] of Object.entries(victim.inv.items)) {
      if (count > 0) this._createLoot(victim.s.x + this.rng.range(-0.8, 0.8), victim.s.y + 0.3, victim.s.z + this.rng.range(-0.8, 0.8), { kind: 'item', key, count });
    }
    for (const [key, count] of Object.entries(victim.inv.ammo)) {
      if (count > 0) this._createLoot(victim.s.x + this.rng.range(-1, 1), victim.s.y + 0.3, victim.s.z + this.rng.range(-1, 1), { kind: 'ammo', key, count });
    }

    if (killer && killer !== victim) {
      killer.kills++;
      killer.killStreak++;
      killer.bestStreak = Math.max(killer.bestStreak, killer.killStreak);
      killer.longestKill = Math.max(killer.longestKill, distance);
      // Assists for anyone who dealt damage in the last 12 seconds.
      const now = Date.now();
      for (const [uid, rec] of victim.recentDamagers) {
        if (uid === killer.userId) continue;
        if (now - rec.at < 12000 && rec.amount >= 20) {
          const assister = this.players.get(uid);
          if (assister) assister.assists++;
        }
      }
    }

    this._pushEvent(EV.KILL, { entityId: victim.entityId, by: killer ? killer.entityId : 0 });
    this.broadcastJson({
      t: 'match.feed',
      kind: 'kill',
      victim: victim.name,
      victimTeam: victim.teamId,
      attacker: killer ? killer.name : null,
      attackerTeam: killer ? killer.teamId : null,
      weapon: weaponKey,
      distance: Math.round(distance),
      headshot: false,
    });

    this._checkTeamElimination(victim);
    this.aliveCount = this._countAlive();

    // Spectate a surviving teammate when possible.
    const mates = this.teammatesOf(victim).filter((m) => m.alive);
    victim.spectating = mates.length ? mates[0].entityId : null;
    this._sendJson(victim, {
      t: 'match.died',
      by: killer ? killer.name : null,
      spectating: victim.spectating,
      placement: victim.placement,
    });

    this._maybeFinish();
  }

  _checkTeamElimination(victim) {
    const team = this.teams.get(victim.teamId);
    if (!team) return;
    let anyAlive = false;
    for (const id of team.members) {
      const p = this.players.get(id);
      if (p && p.alive) {
        anyAlive = true;
        break;
      }
    }
    if (!anyAlive && team.alive) {
      team.alive = false;
      const place = this.aliveTeams() + 1;
      team.place = place;
      for (const id of team.members) {
        const p = this.players.get(id);
        if (p) p.placement = place;
      }
      this.broadcastJson({ t: 'match.teamOut', teamId: team.id, place, teamsLeft: this.aliveTeams() });
    }
  }

  _maybeFinish() {
    if (this.state !== 'active' && this.state !== 'dropping') return;
    if (this.modeKey === 'apex_hunt') {
      if (this._countAlive() === 0) this.end('wiped');
      return;
    }
    if (this.aliveTeams() <= 1 && this.players.size > 1) this.end('victory');
    else if (this._countAlive() === 0) this.end('empty');
  }

  _damageDino(dino, amount, attacker, weaponDef) {
    if (dino.state === Content.DINO_STATE.DEAD) return;
    const armor = dino.def.armor || 0;
    const applied = amount * (1 - armor);
    if (weaponDef && weaponDef.tranq) {
      dino.sedation += weaponDef.tranq;
      if (dino.sedation >= dino.maxHp * 0.9) {
        dino.state = Content.DINO_STATE.STUNNED;
        dino.stateTime = 0;
        if (attacker) attacker.tranquilised++;
      }
    }
    dino.hp -= applied;
    dino.alerted = 8;
    if (attacker) {
      dino.targetId = attacker.entityId;
      if (dino.state !== Content.DINO_STATE.STUNNED) dino.state = Content.DINO_STATE.CHASE;
      dino.stateTime = 0;
    }
    if (dino.hp <= 0) {
      dino.hp = 0;
      dino.state = Content.DINO_STATE.DEAD;
      dino.stateTime = 0;
      if (attacker) {
        attacker.dinoKills++;
        if (dino.def.boss) attacker.apexKills++;
      }
      // Carcasses leave usable resources.
      this._spawnLootPile(dino.x, dino.y + 0.4, dino.z, dino.def.boss ? 'supply_case' : 'nest_egg', dino.def.boss ? 3 : 1);
      this._pushEvent(EV.KILL, { entityId: dino.id, by: attacker ? attacker.entityId : 0, dino: 1 });
    }
  }

  // ==========================================================================
  //  Simulation tick
  // ==========================================================================
  update(dt) {
    this.tick++;
    this.stats.ticks++;

    switch (this.state) {
      case 'lobby':
        this._updateLobby();
        break;
      case 'dropping':
        this._updatePlane(dt);
      // falls through - dropping shares the active simulation
      case 'active':
        // Bots write their intent first so it is consumed by the very same
        // simulation pass that handles everyone else's.
        this._updateBots(dt);
        this._updatePlayers(dt);
        this._updateProjectiles(dt);
        this._updateDinos(dt);
        this._updateZone(dt);
        this._updateLoot(dt);
        break;
      case 'ended':
        break;
    }

    if (this.state === 'dropping' && Date.now() - this.startedAt > 45000) {
      this.state = 'active';
      this.plane.active = false;
      this.broadcastJson({ t: 'match.phase', phase: 'active' });
    }
  }

  _updateLobby() {
    if (this.lobbyDeadline && Date.now() >= this.lobbyDeadline && this.canStart()) this.start();
  }

  // ==========================================================================
  //  Bots
  //  ------------------------------------------------------------------------
  //  A battle royale with nobody else in it is not a battle royale, and the
  //  first player to open a room is always alone. Bots fill the lobby.
  //
  //  They are ordinary players. Rather than being moved around by special
  //  cases, each one writes into the same input queue a human's keyboard
  //  fills, so they run through identical physics, collision, storm damage
  //  and elimination logic. A bot cannot walk through a wall or outrun a
  //  human for the same reason a cheating client cannot.
  // ==========================================================================

  /** Difficulty shapes reaction time, accuracy and engagement range. */
  static get BOT_SKILLS() {
    return {
      easy:   { react: 0.85, spread: 0.16, range: 42, aimSpeed: 2.2, fireRate: 0.55, wander: 0.5 },
      normal: { react: 0.45, spread: 0.075, range: 62, aimSpeed: 4.5, fireRate: 0.85, wander: 0.32 },
      hard:   { react: 0.22, spread: 0.032, range: 82, aimSpeed: 7.5, fireRate: 1.0, wander: 0.18 },
    };
  }

  static get BOT_NAMES() {
    return [
      'رابتور', 'مخلب', 'ناب', 'ظل', 'صقر', 'رعد', 'نيزك', 'إعصار', 'صخر', 'جمرة',
      'وميض', 'خنجر', 'شبح', 'قاطع', 'حارس', 'نمر', 'عاصف', 'جبل', 'سهم', 'درع',
    ];
  }

  /**
   * Fills the match up to `count` extra participants.
   * Returns the bots actually added.
   */
  addBots(count, skill = 'normal') {
    const added = [];
    const names = Match.BOT_NAMES;
    for (let i = 0; i < count; i++) {
      if (this.players.size >= this.mode.maxPlayers) break;
      const n = this.botCount = (this.botCount || 0) + 1;
      const user = {
        id: `bot_${this.id}_${n}`,
        name: `${names[(n - 1) % names.length]}_${100 + ((n * 37) % 900)}`,
        level: 1 + Math.floor(this.rng.next() * 40),
        avatar: null,
        cosmetics: { skin: 'ranger', trail: 'none' },
      };
      // conn is null: nothing is ever sent to a bot, and every send path
      // already checks for it.
      const player = this.addPlayer(user, null, {});
      if (!player) break;
      player.isBot = true;
      player.connected = true;
      player.bot = {
        skill: Match.BOT_SKILLS[skill] ? skill : 'normal',
        target: null,
        nextThink: 0,
        wanderAngle: this.rng.next() * Math.PI * 2,
        fireCooldown: 0,
        yaw: player.s.yaw,
        pitch: 0,
        seq: 0,
      };
      added.push(player);
    }
    return added;
  }

  get botsPresent() {
    for (const p of this.players.values()) if (p.isBot) return true;
    return false;
  }

  /**
   * Produces one tick of intent per bot. Called before player simulation so
   * the inputs are consumed in the very same pass as everyone else's.
   */
  _updateBots(dt) {
    if (this.state !== 'active' && this.state !== 'dropping') return;
    const now = Date.now();

    for (const bot of this.players.values()) {
      if (!bot.isBot || !bot.alive) continue;
      const b = bot.bot;
      const s = bot.s;

      // --- leave the dropship ------------------------------------------
      if (bot.inPlane) {
        // Spread the jumps out so they do not all land on one spot.
        if (!b.dropAt) b.dropAt = now + 2000 + this.rng.next() * 30000;
        if (now >= b.dropAt) { bot.inPlane = false; bot.dropped = true; }
        continue;
      }

      const skill = Match.BOT_SKILLS[b.skill];

      // --- pick something to shoot at ----------------------------------
      if (now >= b.nextThink) {
        b.nextThink = now + skill.react * 1000 * (0.7 + this.rng.next() * 0.6);
        b.target = null;
        let best = skill.range * skill.range;
        for (const other of this.players.values()) {
          if (other === bot || !other.alive || other.inPlane) continue;
          if (other.teamId === bot.teamId) continue;
          const d2 = dist2(other.s.x, other.s.y, other.s.z, s.x, s.y, s.z);
          if (d2 < best) { best = d2; b.target = other; }
        }
      }
      const target = b.target && b.target.alive && !b.target.inPlane ? b.target : null;

      // --- decide where to go ------------------------------------------
      // Staying inside the closing circle always wins: a bot that stands in
      // the storm trading shots simply dies to it, which reads as broken.
      const zoneDx = this.zone.cx - s.x;
      const zoneDz = this.zone.cz - s.z;
      const zoneDist = Math.hypot(zoneDx, zoneDz);
      const mustRun = zoneDist > this.zone.radius * 0.72;

      let wishYaw;
      if (mustRun) {
        wishYaw = Math.atan2(zoneDx, zoneDz);
      } else if (target) {
        wishYaw = Math.atan2(target.s.x - s.x, target.s.z - s.z);
      } else {
        b.wanderAngle += (this.rng.next() - 0.5) * skill.wander;
        wishYaw = b.wanderAngle;
      }

      // --- aim ----------------------------------------------------------
      let wantPitch = 0;
      if (target) {
        const dx = target.s.x - s.x, dy = (target.s.y + 1.5) - (s.y + 1.6), dz = target.s.z - s.z;
        const flat = Math.hypot(dx, dz);
        wantPitch = -Math.atan2(dy, flat);
        wishYaw = Math.atan2(dx, dz);
        // Imperfect aim, scaled by skill, so bots miss like people do.
        wishYaw += (this.rng.next() - 0.5) * skill.spread;
        wantPitch += (this.rng.next() - 0.5) * skill.spread;
      }

      const turn = Math.min(1, skill.aimSpeed * dt);
      b.yaw += wrapAngle(wishYaw - b.yaw) * turn;
      b.pitch += (wantPitch - b.pitch) * turn;
      b.pitch = clamp(b.pitch, -1.5, 1.5);

      // --- movement keys -------------------------------------------------
      let keys = IN.FWD;
      if (mustRun || (target && Math.sqrt(dist2(target.s.x, target.s.y, target.s.z, s.x, s.y, s.z)) > 14)) {
        keys |= IN.SPRINT;
      }
      // Strafe around a target rather than walking straight at it.
      if (target && !mustRun) keys |= (this.tick + bot.entityId) % 120 < 60 ? IN.LEFT : IN.RIGHT;
      // Hop when blocked: the shared physics stops flat against a wall, and
      // this is enough to clear most terrain lips without pathfinding.
      if (s.onGround && Math.hypot(s.vx, s.vz) < 1.2 && !target) keys |= IN.JUMP;
      if (s.inWater) keys |= IN.SWIM_UP;

      bot.inputQueue.push({
        seq: ++b.seq,
        keys,
        yaw: b.yaw,
        pitch: b.pitch,
        dt: Math.min(0.1, dt),
        moveX: 0,
        moveY: 0,
      });

      // --- shooting -------------------------------------------------------
      b.fireCooldown -= dt;
      if (target && b.fireCooldown <= 0 && !bot.downed) {
        const weapon = bot.inv.weapons[bot.inv.slot];
        const def = weapon ? Content.WEAPON_BY_ID[weapon.id] : null;
        if (def && def.fireMode !== 'melee') {
          b.fireCooldown = (60 / (def.rpm || 300)) / Math.max(0.2, skill.fireRate);
          this._botShoot(bot, target, def, skill);
        } else {
          b.fireCooldown = 0.6;
          const d = Math.sqrt(dist2(target.s.x, target.s.y, target.s.z, s.x, s.y, s.z));
          if (d < 3.2) this._damagePlayer(target, 24, bot, { weapon: 'melee', distance: d });
        }
      }
    }
  }

  /**
   * A bot's shot. Deliberately not routed through the network fire handler:
   * that one exists to validate an untrusted claim from a client, and a bot
   * has no client. The outcome is resolved here with the same weapon data,
   * the same line of sight test and the same damage entry point.
   */
  _botShoot(bot, target, def, skill) {
    const s = bot.s;
    const ox = s.x, oy = s.y + 1.6, oz = s.z;
    const tx = target.s.x, ty = target.s.y + 1.1, tz = target.s.z;
    let dx = tx - ox, dy = ty - oy, dz = tz - oz;
    const dist = Math.hypot(dx, dy, dz) || 1;
    dx /= dist; dy /= dist; dz /= dist;

    const range = def.range || 100;
    if (dist > range) return;

    // Everyone hears and sees the shot, whether or not it lands.
    this._pushEvent(EV.SHOT, {
      entityId: bot.entityId, weaponId: def.id,
      x: ox, y: oy, z: oz, dx, dy, dz,
    });

    // Terrain between us? Then the shot hits the wall, as it should - the
    // same raycast the client-authored fire path uses.
    const voxelHit = Movement.raycast(this.getBlock, ox, oy, oz, dx, dy, dz, Math.min(dist, range));
    if (voxelHit && voxelHit.distance < dist - 0.6) return;

    // Skill decides whether the shot lands, so a weak bot genuinely misses.
    if (this.rng.next() < skill.spread * 2.2) return;

    const falloff = def.falloff ? Math.max(0.45, 1 - (dist / range) * def.falloff) : 1;
    this._damagePlayer(target, (def.damage || 18) * falloff, bot,
      { part: 'body', distance: dist, weapon: def.key });
  }

  _updatePlane(dt) {
    const speed = 62;
    this.plane.x += this.plane.dx * speed * dt;
    this.plane.z += this.plane.dz * speed * dt;
    for (const p of this.players.values()) {
      if (p.inPlane) {
        p.s.x = this.plane.x;
        p.s.y = this.plane.y;
        p.s.z = this.plane.z;
        p.s.vx = p.s.vy = p.s.vz = 0;
      }
    }
    // Auto-eject anyone still aboard once the dropship has crossed the arena
    // and is heading back out. Distance alone is not enough: the flight starts
    // well outside the circle, so the projection along the heading is what
    // tells us the plane is past the drop zone.
    const along = (this.plane.x - this.arena.cx) * this.plane.dx + (this.plane.z - this.arena.cz) * this.plane.dz;
    if (along > this.arena.radius * 0.92) {
      for (const p of this.players.values()) {
        if (p.inPlane) {
          p.inPlane = false;
          p.dropped = true;
          p.s.parachute = true;
        }
      }
    }
  }

  _updatePlayers(dt) {
    const now = Date.now();
    for (const player of this.players.values()) {
      // --- disconnect cleanup
      if (!player.connected && player.disconnectedAt && now - player.disconnectedAt > 120000) {
        if (player.alive) this._eliminate(player, null, 'disconnect');
        continue;
      }
      if (!player.alive) continue;

      // --- automatic parachute deployment
      // Free-falling from the dropship is lethal, so the rig opens itself once
      // the player is close to the ground. Deploying manually earlier gives a
      // slower, more controllable descent - that is the skill expression.
      if (!player.inPlane && player.dropped && !player.s.parachute && !player.s.onGround && !player.s.inWater) {
        const groundY = this.world.column(Math.floor(player.s.x), Math.floor(player.s.z)).height;
        const above = player.s.y - Math.max(groundY, WORLD.SEA_LEVEL);
        if (above < 60 && player.s.vy < -12) player.s.parachute = true;
      }

      // --- drain inputs (bounded work per tick)
      let processed = 0;
      const maxPerTick = 5;
      while (player.inputQueue.length && processed < maxPerTick) {
        const input = player.inputQueue.shift();
        player.lastSeq = input.seq;
        player.lastKeys = input.keys;
        if (player.inPlane) continue;
        if (player.useAction || player.downed) {
          // Movement is heavily restricted while using an item or downed.
          input.keys &= ~(Protocol.IN.SPRINT | Protocol.IN.JUMP | Protocol.IN.SLIDE);
        }
        const before = { x: player.s.x, y: player.s.y, z: player.s.z };
        const ev = Movement.step(player.s, input, this.getBlock, {});
        processed++;

        player.distance += Math.hypot(player.s.x - before.x, player.s.z - before.z);
        if (player.s.y > player.maxAltitude) player.maxAltitude = player.s.y;
        if (player.s.inWater) player.waterTime += input.dt;
        if (ev.vaulted) player.vaults++;
        if (ev.fallDamage > 0) this._damagePlayer(player, ev.fallDamage, null, { weapon: 'fall' });
        if (ev.drowning > 0) this._damagePlayer(player, ev.drowning, null, { weapon: 'drown' });
        if (ev.lavaDamage > 0) this._damagePlayer(player, ev.lavaDamage, null, { weapon: 'lava' });
        if (ev.footstep) {
          this._pushEvent(EV.FOOTSTEP, {
            entityId: player.entityId,
            x: player.s.x,
            y: player.s.y,
            z: player.s.z,
            surface: this.blockAt(Math.floor(player.s.x), Math.floor(player.s.y - 0.2), Math.floor(player.s.z)),
          });
        }
        if (ev.splash) this._pushEvent(EV.SPLASH, { x: player.s.x, y: player.s.y, z: player.s.z });
        if (ev.landed > 2.5) this._pushEvent(EV.LAND, { entityId: player.entityId, force: Math.min(255, Math.round(ev.landed * 8)) });
      }

      // --- unstick safety
      // A player can end up embedded in geometry: parachuting into a tree
      // canopy, a teammate building around them, or an explosion collapsing
      // terrain onto them. Left alone they would be trapped for the rest of
      // the match, so lift them to the nearest free space.
      if (!player.inPlane && Movement.collides(this.getBlock, player.s.x, player.s.y, player.s.z, player.s.height, PHYS.PLAYER_RADIUS)) {
        player.stuckTicks = (player.stuckTicks || 0) + 1;
        if (player.stuckTicks > 15) {
          for (let lift = 1; lift <= 6; lift++) {
            const y = player.s.y + lift;
            if (y >= WORLD.HEIGHT) break;
            if (!Movement.collides(this.getBlock, player.s.x, y, player.s.z, player.s.height, PHYS.PLAYER_RADIUS)) {
              player.s.y = y;
              player.s.vy = 0;
              break;
            }
          }
          player.stuckTicks = 0;
        }
      } else {
        player.stuckTicks = 0;
      }

      // Keep a rewind buffer for lag compensation.
      player.history.push({
        x: player.s.x,
        y: player.s.y,
        z: player.s.z,
        height: player.s.height,
        tick: this.tick,
      });
      if (player.history.length > HISTORY_TICKS) player.history.shift();

      // --- reload / item use completion
      if (player.reloadEndsAt && now >= player.reloadEndsAt) {
        player.reloadEndsAt = 0;
        this._finishReload(player);
      }
      if (player.useAction && now >= player.useAction.endsAt) {
        this._completeUse(player);
      }

      // --- downed bleed-out and revives
      if (player.downed) {
        player.downedTimer += dt;
        player.health -= COMBAT.DOWNED_BLEED_DPS * dt;
        if (player.revivingBy) {
          const medic = this.players.get(player.revivingBy);
          const inRange =
            medic &&
            medic.alive &&
            !medic.downed &&
            dist2(medic.s.x, medic.s.y, medic.s.z, player.s.x, player.s.y, player.s.z) <= COMBAT.REVIVE_RANGE * COMBAT.REVIVE_RANGE;
          if (inRange) {
            player.reviveProgress += dt;
            if (player.reviveProgress >= COMBAT.REVIVE_TIME) {
              player.downed = false;
              player.s.downed = false;
              player.health = 45;
              player.reviveProgress = 0;
              player.revivingBy = null;
              medic.revives++;
              this._pushEvent(EV.REVIVED, { entityId: player.entityId, by: medic.entityId });
            }
          } else {
            player.revivingBy = null;
            player.reviveProgress = Math.max(0, player.reviveProgress - dt * 0.5);
          }
        } else if (player.reviveProgress > 0) {
          player.reviveProgress = Math.max(0, player.reviveProgress - dt * 0.5);
        }
        if (player.health <= 0) {
          const lastAttacker = this._lastAttacker(player);
          this._eliminate(player, lastAttacker, 'bleedout');
        }
      }

      // --- landmark discovery
      for (const lm of this.landmarks) {
        if (player.landmarksVisited.has(lm.key)) continue;
        const dx = player.s.x - lm.x;
        const dz = player.s.z - lm.z;
        if (dx * dx + dz * dz < lm.radius * lm.radius) player.landmarksVisited.add(lm.key);
      }

      // --- automatic loot magnet for adjacent piles
      if (this.tick % 6 === 0) this._autoPickup(player);
    }
  }

  _lastAttacker(player) {
    let best = null;
    let bestAt = 0;
    for (const [uid, rec] of player.recentDamagers) {
      if (rec.at > bestAt) {
        bestAt = rec.at;
        best = this.players.get(uid) || null;
      }
    }
    return best;
  }

  _completeUse(player) {
    const { item, key } = player.useAction;
    player.useAction = null;
    const have = player.inv.items[key] || 0;
    if (have <= 0) return;
    player.inv.items[key] = have - 1;
    if (item.type === 'heal') {
      player.health = Math.min(COMBAT.MAX_HEALTH, player.health + item.amount);
      this._pushEvent(EV.HEAL, { entityId: player.entityId, amount: item.amount, kind: 0 });
    } else if (item.type === 'shield') {
      player.shield = Math.min(COMBAT.MAX_SHIELD, player.shield + item.amount);
      this._pushEvent(EV.HEAL, { entityId: player.entityId, amount: item.amount, kind: 1 });
    } else if (item.type === 'buff') {
      player.s.speedMult = 1.18;
      player.buffUntil = Date.now() + item.dur * 1000;
      player.s.stamina = PHYS.MAX_STAMINA;
    }
    this._sendInventory(player);
  }

  _autoPickup(player) {
    let picked = 0;
    for (const [id, loot] of this.loot) {
      if (loot.kind === 'weapon') continue; // weapons require an explicit action
      const d2 = dist2(player.s.x, player.s.y, player.s.z, loot.x, loot.y, loot.z);
      if (d2 > 2.4 * 2.4) continue;
      if (this._giveLoot(player, loot)) {
        this.loot.delete(id);
        this._pushEvent(EV.PICKUP, { entityId: player.entityId, lootId: id });
        picked++;
        if (picked >= 3) break;
      }
    }
    if (picked) this._sendInventory(player);
  }

  _updateProjectiles(dt) {
    for (const [id, p] of this.projectiles) {
      p.life -= dt;
      if (p.life <= 0) {
        this.projectiles.delete(id);
        continue;
      }
      if (p.fuse != null) {
        p.fuse -= dt;
        if (p.fuse <= 0) {
          this._detonate(p);
          this.projectiles.delete(id);
          continue;
        }
      }

      const steps = Math.max(1, Math.ceil((Math.hypot(p.vx, p.vy, p.vz) * dt) / 0.6));
      const sdt = dt / steps;
      let consumed = false;
      for (let i = 0; i < steps; i++) {
        p.vy -= p.gravity * sdt;
        const nx = p.x + p.vx * sdt;
        const ny = p.y + p.vy * sdt;
        const nz = p.z + p.vz * sdt;

        // Voxel collision
        const id2 = this.blockAt(Math.floor(nx), Math.floor(ny), Math.floor(nz));
        if (isSolid(id2) && !isLiquid(id2)) {
          if (p.thrown) {
            // Grenades bounce and keep their fuse running.
            p.vx *= -0.36;
            p.vy *= -0.36;
            p.vz *= -0.36;
            p.x += p.vx * sdt;
            p.y += Math.abs(p.vy) * sdt * 0.2 + 0.02;
            p.z += p.vz * sdt;
            break;
          }
          this._detonate(p, nx, ny, nz);
          this.projectiles.delete(id);
          consumed = true;
          break;
        }

        // Entity collision
        let hit = null;
        for (const other of this.players.values()) {
          if (!other.alive || other.userId === p.ownerId) continue;
          if (other.teamId === p.teamId && this.mode.teamSize > 1) continue;
          const t = Movement.rayBox(
            p.x,
            p.y,
            p.z,
            nx - p.x,
            ny - p.y,
            nz - p.z,
            other.s.x - PHYS.PLAYER_RADIUS,
            other.s.y,
            other.s.z - PHYS.PLAYER_RADIUS,
            other.s.x + PHYS.PLAYER_RADIUS,
            other.s.y + other.s.height,
            other.s.z + PHYS.PLAYER_RADIUS,
          );
          if (t >= 0 && t <= 1) {
            hit = other;
            break;
          }
        }
        if (!hit) {
          for (const dino of this.dinos.values()) {
            if (dino.state === Content.DINO_STATE.DEAD) continue;
            const s = dino.def.size;
            const t = Movement.rayBox(p.x, p.y, p.z, nx - p.x, ny - p.y, nz - p.z, dino.x - s[0] / 2, dino.y, dino.z - s[2] / 2, dino.x + s[0] / 2, dino.y + s[1], dino.z + s[2] / 2);
            if (t >= 0 && t <= 1) {
              hit = dino;
              break;
            }
          }
        }
        if (hit) {
          this._detonate(p, nx, ny, nz, hit);
          this.projectiles.delete(id);
          consumed = true;
          break;
        }

        p.x = nx;
        p.y = ny;
        p.z = nz;
      }
      if (consumed) continue;
      if (p.y < 0 || p.y > WORLD.HEIGHT) this.projectiles.delete(id);
    }
  }

  _detonate(p, x = p.x, y = p.y, z = p.z, directHit = null) {
    const owner = this.players.get(p.ownerId);

    if (p.supply) {
      this._callSupplyDrop(x, z);
      return;
    }
    if (p.smoke) {
      this._pushEvent(EV.EXPLOSION, { x, y, z, radius: p.smoke, kind: 1 });
      return;
    }
    if (p.lure) {
      this._pushEvent(EV.EXPLOSION, { x, y, z, radius: 3, kind: 2 });
      for (const dino of this.dinos.values()) {
        if (dist2(dino.x, dino.y, dino.z, x, y, z) < p.lure * p.lure) {
          dino.lure = { x, y, z, until: Date.now() + 20000 };
          dino.state = Content.DINO_STATE.CHASE;
          dino.targetId = null;
        }
      }
      return;
    }

    if (directHit && !p.splash) {
      if (directHit.def) this._damageDino(directHit, p.damage, owner, { tranq: p.tranq });
      else this._damagePlayer(directHit, p.damage, owner, { part: 'body', weapon: p.key });
      return;
    }

    if (p.splash > 0) {
      this._pushEvent(EV.EXPLOSION, { x, y, z, radius: p.splash, kind: 0 });
      for (const other of this.players.values()) {
        if (!other.alive) continue;
        const d = Math.sqrt(dist2(other.s.x, other.s.y + other.s.height * 0.5, other.s.z, x, y, z));
        if (d > p.splash) continue;
        // Blast is blocked by terrain.
        const dx = x - other.s.x;
        const dy = y - (other.s.y + other.s.height * 0.5);
        const dz = z - other.s.z;
        const los = Movement.raycast(this.getBlock, other.s.x, other.s.y + other.s.height * 0.5, other.s.z, dx, dy, dz, d - 0.4);
        if (los) continue;
        const falloff = 1 - d / p.splash;
        this._damagePlayer(other, p.damage * falloff * falloff, owner, { part: 'body', weapon: p.key });
      }
      for (const dino of this.dinos.values()) {
        if (dino.state === Content.DINO_STATE.DEAD) continue;
        const d = Math.sqrt(dist2(dino.x, dino.y + dino.def.size[1] * 0.5, dino.z, x, y, z));
        if (d > p.splash) continue;
        const falloff = 1 - d / p.splash;
        this._damageDino(dino, p.damage * falloff * falloff, owner, null);
      }
      // Terrain deformation.
      const r = Math.ceil(p.splash * 0.55);
      const bx = Math.floor(x);
      const by = Math.floor(y);
      const bz = Math.floor(z);
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy + dz * dz > r * r) continue;
            const id = this.blockAt(bx + dx, by + dy, bz + dz);
            if (!id || !isBreakable(id)) continue;
            const hardness = WorldGen.HARDNESS[id] || 1;
            if (hardness > 4.5) continue;
            this.setBlock(bx + dx, by + dy, bz + dz, 0, owner);
          }
        }
      }
    } else if (p.damage) {
      if (directHit) {
        if (directHit.def) this._damageDino(directHit, p.damage, owner, { tranq: p.tranq });
        else this._damagePlayer(directHit, p.damage, owner, { part: 'body', weapon: p.key });
      }
    }
  }

  _callSupplyDrop(x, z) {
    const y = this._groundY(Math.round(x), Math.round(z));
    if (y == null) return;
    this._spawnLootPile(x, y, z, 'drop', 3);
    this.setBlock(Math.round(x), y, Math.round(z), B.supply_case, null);
    this._pushEvent(EV.SUPPLY_DROP, { x, y, z });
    this.broadcastJson({ t: 'match.supply', x: Math.round(x), y, z: Math.round(z) });
  }

  // -- saurian AI ------------------------------------------------------------
  _updateDinos(dt) {
    const now = Date.now();
    for (const [id, dino] of this.dinos) {
      const def = dino.def;
      dino.stateTime += dt;
      dino.anim += dt;

      if (dino.state === Content.DINO_STATE.DEAD) {
        if (dino.stateTime > 25) this.dinos.delete(id);
        continue;
      }
      if (dino.sedation > 0) dino.sedation = Math.max(0, dino.sedation - dt * 4);
      if (dino.state === Content.DINO_STATE.STUNNED) {
        if (dino.stateTime > 14 || dino.sedation <= 0) {
          dino.state = Content.DINO_STATE.WANDER;
          dino.stateTime = 0;
        }
        continue;
      }

      // Only simulate creatures near a player; the rest idle cheaply.
      let nearest = null;
      let nearestD2 = Infinity;
      for (const p of this.players.values()) {
        if (!p.alive || p.inPlane) continue;
        const d2 = dist2(p.s.x, p.s.y, p.s.z, dino.x, dino.y, dino.z);
        if (d2 < nearestD2) {
          nearestD2 = d2;
          nearest = p;
        }
      }
      if (!nearest || nearestD2 > 260 * 260) continue;

      const nearestD = Math.sqrt(nearestD2);
      const canSee = nearestD < def.sight && this._hasLineOfSight(dino, nearest);
      const heard = nearestD < def.hearing && Math.hypot(nearest.s.vx, nearest.s.vz) > 4.5;

      // --- state transitions
      switch (dino.state) {
        case Content.DINO_STATE.IDLE:
        case Content.DINO_STATE.WANDER:
        case Content.DINO_STATE.EAT:
          if ((canSee || heard) && this.rng.next() < def.aggression) {
            dino.state = Content.DINO_STATE.ALERT;
            dino.stateTime = 0;
            dino.targetId = nearest.entityId;
            this._pushEvent(EV.DINO_ROAR, { entityId: dino.id, x: dino.x, y: dino.y, z: dino.z, type: def.id });
          } else if (dino.stateTime > 5 + this.rng.next() * 6) {
            dino.state = Content.DINO_STATE.WANDER;
            dino.stateTime = 0;
            const a = this.rng.next() * Math.PI * 2;
            const r = 8 + this.rng.next() * 26;
            dino.wanderX = dino.homeX + Math.cos(a) * r;
            dino.wanderZ = dino.homeZ + Math.sin(a) * r;
          }
          break;
        case Content.DINO_STATE.ALERT:
          if (dino.stateTime > 1.1) {
            dino.state = def.aggression > 0.4 ? Content.DINO_STATE.CHASE : Content.DINO_STATE.FLEE;
            dino.stateTime = 0;
          }
          break;
        case Content.DINO_STATE.CHASE: {
          const target = dino.targetId ? this.byEntityId.get(dino.targetId) : null;
          if (!target || !target.alive) {
            dino.targetId = nearest && canSee ? nearest.entityId : null;
            if (!dino.targetId && !dino.lure) {
              dino.state = Content.DINO_STATE.WANDER;
              dino.stateTime = 0;
            }
          } else {
            const d = Math.sqrt(dist2(target.s.x, target.s.y, target.s.z, dino.x, dino.y, dino.z));
            if (d < def.attackRange) {
              dino.state = Content.DINO_STATE.ATTACK;
              dino.stateTime = 0;
            } else if (d > def.sight * 1.6 || dino.stateTime > 26) {
              dino.state = Content.DINO_STATE.WANDER;
              dino.stateTime = 0;
              dino.targetId = null;
            }
          }
          break;
        }
        case Content.DINO_STATE.ATTACK: {
          const target = dino.targetId ? this.byEntityId.get(dino.targetId) : null;
          if (!target || !target.alive) {
            dino.state = Content.DINO_STATE.WANDER;
            dino.stateTime = 0;
            break;
          }
          const d = Math.sqrt(dist2(target.s.x, target.s.y, target.s.z, dino.x, dino.y, dino.z));
          if (d > def.attackRange * 1.35) {
            dino.state = Content.DINO_STATE.CHASE;
            dino.stateTime = 0;
          } else if (now - dino.lastAttack > def.attackCd * 1000) {
            dino.lastAttack = now;
            this._damagePlayer(target, def.damage, null, { weapon: def.key, part: 'body' });
            this._pushEvent(EV.DINO_ATTACK, { entityId: dino.id, target: target.entityId });
          }
          break;
        }
        case Content.DINO_STATE.FLEE:
          if (dino.stateTime > 6) {
            dino.state = Content.DINO_STATE.WANDER;
            dino.stateTime = 0;
          }
          break;
      }

      // --- steering
      let tx = dino.wanderX;
      let tz = dino.wanderZ;
      let speed = def.speed * 0.45;

      if (dino.lure && dino.lure.until > now) {
        tx = dino.lure.x;
        tz = dino.lure.z;
        speed = def.speed;
      } else if (dino.state === Content.DINO_STATE.CHASE || dino.state === Content.DINO_STATE.ATTACK) {
        const target = dino.targetId ? this.byEntityId.get(dino.targetId) : nearest;
        if (target) {
          tx = target.s.x;
          tz = target.s.z;
          speed = dino.state === Content.DINO_STATE.ATTACK ? def.speed * 0.3 : def.sprint;
        }
      } else if (dino.state === Content.DINO_STATE.FLEE && nearest) {
        tx = dino.x + (dino.x - nearest.s.x);
        tz = dino.z + (dino.z - nearest.s.z);
        speed = def.sprint;
      } else if (dino.state === Content.DINO_STATE.ALERT) {
        speed = 0;
      }

      const dx = tx - dino.x;
      const dz = tz - dino.z;
      const dl = Math.hypot(dx, dz);
      if (dl > 0.4 && speed > 0) {
        dino.targetYaw = Math.atan2(dx, dz);
        let diff = dino.targetYaw - dino.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        dino.yaw += clamp(diff, -def.turn * dt, def.turn * dt);

        const mvx = Math.sin(dino.yaw) * speed;
        const mvz = Math.cos(dino.yaw) * speed;
        this._moveDino(dino, mvx * dt, mvz * dt, dt);
      }

      // Vertical motion: flyers cruise, swimmers stay submerged, others fall.
      if (def.flying) {
        const groundY = this.world.column(Math.floor(dino.x), Math.floor(dino.z)).height;
        const cruise = groundY + 22 + Math.sin(dino.anim * 0.4) * 5;
        dino.y += clamp(cruise - dino.y, -6 * dt, 6 * dt);
      } else if (def.aquatic) {
        const target = Math.min(WORLD.SEA_LEVEL - 2, dino.y);
        dino.y += clamp(target - dino.y, -4 * dt, 4 * dt);
        if (!isLiquid(this.blockAt(Math.floor(dino.x), Math.floor(dino.y), Math.floor(dino.z)))) dino.y -= 3 * dt;
      } else {
        // Ground snap + gravity.
        const feet = Math.floor(dino.y);
        let groundY = null;
        for (let dy = 2; dy >= -3; dy--) {
          const id2 = this.blockAt(Math.floor(dino.x), feet + dy, Math.floor(dino.z));
          if (isSolid(id2) && !isLiquid(id2)) {
            groundY = feet + dy + 1;
            break;
          }
        }
        if (groundY != null && Math.abs(groundY - dino.y) < 3.2) {
          dino.y += clamp(groundY - dino.y, -10 * dt, 6 * dt);
          dino.vy = 0;
          dino.onGround = true;
        } else {
          dino.vy -= PHYS.GRAVITY * dt;
          dino.y += dino.vy * dt;
          dino.onGround = false;
          if (dino.y < 1) {
            dino.y = this.world.column(Math.floor(dino.x), Math.floor(dino.z)).height + 1;
            dino.vy = 0;
          }
        }
      }
    }

    // Repopulate over time so the arena never empties out.
    if (this.tick % 90 === 0 && this.dinos.size < DINO_BUDGET * 0.7 && this.state === 'active') {
      this._spawnDino();
    }
  }

  _moveDino(dino, dx, dz, dt) {
    const size = dino.def.size;
    const r = size[0] * 0.5;
    const nx = dino.x + dx;
    const nz = dino.z + dz;
    const canX = !this._dinoBlocked(nx, dino.y, dino.z, r, size[1]);
    const canZ = !this._dinoBlocked(dino.x, dino.y, nz, r, size[1]);
    if (canX) dino.x = nx;
    if (canZ) dino.z = nz;
    if (!canX && !canZ) {
      // Blocked: pick a new wander target rather than grinding into a wall.
      const a = this.rng.next() * Math.PI * 2;
      dino.wanderX = dino.x + Math.cos(a) * 14;
      dino.wanderZ = dino.z + Math.sin(a) * 14;
    }
  }

  _dinoBlocked(x, y, z, radius, height) {
    if (this.blockAt(Math.floor(x), Math.floor(y + 1.2), Math.floor(z))) {
      const id = this.blockAt(Math.floor(x), Math.floor(y + 1.2), Math.floor(z));
      if (isSolid(id) && !isLiquid(id)) return true;
    }
    const id2 = this.blockAt(Math.floor(x + radius), Math.floor(y + 0.6), Math.floor(z + radius));
    const id3 = this.blockAt(Math.floor(x - radius), Math.floor(y + 0.6), Math.floor(z - radius));
    return (isSolid(id2) && !isLiquid(id2)) || (isSolid(id3) && !isLiquid(id3));
  }

  _hasLineOfSight(dino, player) {
    const ox = dino.x;
    const oy = dino.y + dino.def.size[1] * 0.8;
    const oz = dino.z;
    const dx = player.s.x - ox;
    const dy = player.s.y + player.s.eye - oy;
    const dz = player.s.z - oz;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1) return true;
    const hit = Movement.raycast(this.getBlock, ox, oy, oz, dx, dy, dz, d - 0.6);
    return !hit;
  }

  // -- storm -----------------------------------------------------------------
  _updateZone(dt) {
    if (this.state !== 'active' && this.state !== 'dropping') return;
    const now = Date.now();
    const z = this.zone;

    if (now >= z.nextEventAt) {
      if (!z.shrinking) {
        const next = z.phase + 1;
        if (next < ZONE.PHASES.length) {
          const phase = ZONE.PHASES[next];
          z.phase = next;
          z.shrinking = true;
          z.shrinkStart = now;
          z.shrinkEnd = now + phase.shrink;
          z.startRadius = z.radius;
          z.startCx = z.cx;
          z.startCz = z.cz;
          z.targetRadius = z.radius * phase.factor;
          // Offset the next circle inside the current one.
          const a = this.rng.next() * Math.PI * 2;
          const maxOff = Math.max(0, z.radius - z.targetRadius) * 0.72;
          const off = this.rng.next() * maxOff;
          z.targetCx = z.cx + Math.cos(a) * off;
          z.targetCz = z.cz + Math.sin(a) * off;
          z.dps = phase.dps;
          z.nextEventAt = z.shrinkEnd;
          this.broadcastJson({
            t: 'match.zone',
            phase: next,
            shrinking: true,
            from: { cx: z.cx, cz: z.cz, r: z.radius },
            to: { cx: z.targetCx, cz: z.targetCz, r: z.targetRadius },
            startsAt: now,
            endsAt: z.shrinkEnd,
            dps: z.dps,
          });
          this._pushEvent(EV.ZONE_WARN, { phase: next });
        }
      } else {
        z.shrinking = false;
        z.cx = z.targetCx;
        z.cz = z.targetCz;
        z.radius = z.targetRadius;
        const nextPhase = ZONE.PHASES[Math.min(z.phase + 1, ZONE.PHASES.length - 1)];
        z.nextEventAt = now + nextPhase.wait;
        this.broadcastJson({
          t: 'match.zone',
          phase: z.phase,
          shrinking: false,
          from: { cx: z.cx, cz: z.cz, r: z.radius },
          to: { cx: z.cx, cz: z.cz, r: z.radius },
          nextAt: z.nextEventAt,
          dps: z.dps,
        });
        if (z.radius <= 1) this.end('zone');
      }
    }

    if (z.shrinking) {
      const t = clamp((now - z.shrinkStart) / (z.shrinkEnd - z.shrinkStart), 0, 1);
      z.cx = z.startCx + (z.targetCx - z.startCx) * t;
      z.cz = z.startCz + (z.targetCz - z.startCz) * t;
      z.radius = z.startRadius + (z.targetRadius - z.startRadius) * t;
    }

    // Storm damage
    if (z.dps > 0 && this.tick % 15 === 0) {
      const interval = 15 / TICK_RATE;
      for (const p of this.players.values()) {
        if (!p.alive || p.inPlane) continue;
        const d = Math.hypot(p.s.x - z.cx, p.s.z - z.cz);
        if (d > z.radius) {
          this._damagePlayer(p, z.dps * interval, null, { weapon: 'storm' });
          this._pushEvent(EV.STORM_TICK, { entityId: p.entityId });
        }
      }
    }
  }

  _updateLoot() {
    // Loot that ends up outside the final circles is culled to save bandwidth.
    if (this.tick % 300 !== 0) return;
    const limit = this.zone.radius + 220;
    for (const [id, loot] of this.loot) {
      if (Math.hypot(loot.x - this.zone.cx, loot.z - this.zone.cz) > limit) this.loot.delete(id);
    }
  }

  // ==========================================================================
  //  Snapshots
  // ==========================================================================
  buildSnapshotFor(player) {
    const w = new Writer(4096);
    w.u8w(OP.S_SNAPSHOT);
    w.u32w(this.tick);
    w.u32w(Date.now() & 0xffffffff);
    w.u32w(player.lastSeq);

    // --- self (authoritative correction target)
    const s = player.s;
    w.posw(s.x).posw(s.y).posw(s.z);
    w.velw(s.vx).velw(s.vy).velw(s.vz);
    w.u8w(s.moveState);
    w.u8w(Math.round(clamp(player.health, 0, 255)));
    w.u8w(Math.round(clamp(player.shield, 0, 255)));
    w.normw(clamp(s.stamina / PHYS.MAX_STAMINA, 0, 1));
    w.normw(clamp(s.oxygen / PHYS.OXYGEN_MAX, 0, 1));
    let selfFlags = 0;
    if (s.onGround) selfFlags |= 1;
    if (s.inWater) selfFlags |= 2;
    if (s.crouching) selfFlags |= 4;
    if (s.sliding) selfFlags |= 8;
    if (s.climbing) selfFlags |= 16;
    if (s.parachute) selfFlags |= 32;
    if (player.downed) selfFlags |= 64;
    if (player.inPlane) selfFlags |= 128;
    w.u8w(selfFlags);
    w.normw(clamp(player.reviveProgress / COMBAT.REVIVE_TIME, 0, 1));

    // --- other players within interest radius
    const others = [];
    for (const other of this.players.values()) {
      if (other === player) continue;
      const d2 = dist2(other.s.x, other.s.y, other.s.z, s.x, s.y, s.z);
      const teammate = other.teamId === player.teamId;
      if (!teammate && d2 > INTEREST_RADIUS * INTEREST_RADIUS) continue;
      others.push(other);
    }
    w.u16w(others.length);
    for (const other of others) {
      w.u16w(other.entityId);
      w.posw(other.s.x).posw(other.s.y).posw(other.s.z);
      w.yaww(other.s.yaw);
      w.pitw(other.s.pitch);
      w.velw(other.s.vx).velw(other.s.vy).velw(other.s.vz);
      w.u8w(other.s.moveState);
      w.u8w(other.alive ? Math.round(clamp(other.health, 0, 255)) : 0);
      w.u8w(other.teamId & 0xff);
      w.u8w(other.inv.weapons[other.inv.slot]?.id ?? 0);
      let flags = 0;
      if (other.s.crouching) flags |= EF.CROUCHED;
      if (other.lastKeys & Protocol.IN.AIM) flags |= EF.AIMING;
      if (other.s.inWater) flags |= EF.IN_WATER;
      if (other.downed) flags |= EF.DOWNED;
      if (!other.alive) flags |= EF.DEAD;
      if (other.s.moveState === MOVE.SPRINT) flags |= EF.SPRINTING;
      if (other.s.lean < -0.3) flags |= EF.LEAN_L;
      if (other.s.lean > 0.3) flags |= EF.LEAN_R;
      if (other.shield > 0) flags |= EF.SHIELDED;
      if (other.reloadEndsAt > Date.now()) flags |= EF.RELOADING;
      if (other.s.parachute) flags |= EF.PARACHUTE;
      if (other.teamId === player.teamId) flags |= EF.TEAMMATE;
      if (other.speaking) flags |= EF.SPEAKING;
      if (other.s.climbing) flags |= EF.CLIMBING;
      w.u16w(flags);
      w.normw(clamp(other.s.height / PHYS.PLAYER_HEIGHT, 0, 1));
    }

    // --- saurians
    const dinos = [];
    for (const d of this.dinos.values()) {
      if (dist2(d.x, d.y, d.z, s.x, s.y, s.z) > INTEREST_RADIUS * INTEREST_RADIUS) continue;
      dinos.push(d);
    }
    w.u16w(dinos.length);
    for (const d of dinos) {
      w.u16w(d.id);
      w.u8w(d.typeId);
      w.posw(d.x).posw(d.y).posw(d.z);
      w.yaww(d.yaw);
      w.u8w(d.state);
      w.normw(clamp(d.hp / d.maxHp, 0, 1));
    }

    // --- loot
    const loots = [];
    for (const l of this.loot.values()) {
      if (dist2(l.x, l.y, l.z, s.x, s.y, s.z) > 90 * 90) continue;
      loots.push(l);
      if (loots.length >= 220) break;
    }
    w.u16w(loots.length);
    for (const l of loots) {
      w.u16w(l.id);
      w.u8w(l.kind === 'weapon' ? 0 : l.kind === 'ammo' ? 1 : 2);
      w.strw(l.key);
      w.u8w(l.rarity || 0);
      w.u16w(Math.min(65535, l.count || 1));
      w.posw(l.x).posw(l.y).posw(l.z);
    }

    // --- projectiles
    const projs = [];
    for (const p of this.projectiles.values()) {
      if (dist2(p.x, p.y, p.z, s.x, s.y, s.z) > 160 * 160) continue;
      projs.push(p);
    }
    w.u16w(projs.length);
    for (const p of projs) {
      w.u16w(p.id);
      w.u8w(p.thrown ? 1 : 0);
      w.posw(p.x).posw(p.y).posw(p.z);
      w.velw(clamp(p.vx, -128, 127)).velw(clamp(p.vy, -128, 127)).velw(clamp(p.vz, -128, 127));
    }

    // --- zone + match meta
    w.f32w(this.zone.cx);
    w.f32w(this.zone.cz);
    w.f32w(this.zone.radius);
    w.f32w(this.zone.targetCx);
    w.f32w(this.zone.targetCz);
    w.f32w(this.zone.targetRadius);
    w.u8w(this.zone.shrinking ? 1 : 0);
    w.u16w(this.aliveCount);
    w.u8w(Math.min(255, this.aliveTeams()));
    w.f32w(this.plane.active ? this.plane.x : 0);
    w.f32w(this.plane.active ? this.plane.z : 0);
    w.u8w(this.plane.active ? 1 : 0);

    return w;
  }

  sendSnapshots() {
    for (const player of this.players.values()) {
      if (!player.conn || !player.connected) continue;
      const w = this.buildSnapshotFor(player);
      this.stats.snapshotBytes += w.off;
      this._sendBinary(player, w);
    }
  }

  sendEdits() {
    if (!this.pendingEdits.length) return;
    const w = new Writer(8 + this.pendingEdits.length * 11);
    w.u8w(OP.S_EDITS);
    w.u16w(Math.min(65535, this.pendingEdits.length));
    for (const e of this.pendingEdits) {
      w.i32w(e.x).i16w(e.y).i32w(e.z).u16w(e.id);
    }
    const buf = w.toBuffer();
    for (const player of this.players.values()) {
      if (player.conn && player.connected) player.conn.sendBinary(buf);
    }
    this.pendingEdits.length = 0;
  }

  sendEvents() {
    if (!this.events.length) return;
    const w = new Writer(1024);
    w.u8w(OP.S_EVENTS);
    w.u16w(this.events.length);
    for (const e of this.events) {
      w.u8w(e.type);
      w.u16w(e.entityId || 0);
      w.f32w(e.x || 0);
      w.f32w(e.y || 0);
      w.f32w(e.z || 0);
      w.u16w(e.a || 0);
      w.u16w(e.b || 0);
    }
    const buf = w.toBuffer();
    for (const player of this.players.values()) {
      if (player.conn && player.connected) player.conn.sendBinary(buf);
    }
    this.events.length = 0;
  }

  _pushEvent(type, data) {
    // Events are compacted into a fixed 17-byte record.
    let a = 0;
    let b = 0;
    switch (type) {
      case EV.HIT:
        a = data.kind || 0;
        b = data.block || 0;
        break;
      case EV.KILL:
        a = data.by || 0;
        b = data.dino || 0;
        break;
      case EV.SHOT:
        a = data.weaponId || 0;
        b = Math.round(((data.dx || 0) * 0.5 + 0.5) * 255) | (Math.round(((data.dy || 0) * 0.5 + 0.5) * 255) << 8);
        break;
      case EV.BLOCK_BREAK:
      case EV.BLOCK_PLACE:
        a = data.block || 0;
        break;
      case EV.EXPLOSION:
        a = Math.round((data.radius || 0) * 16);
        b = data.kind || 0;
        break;
      case EV.DAMAGE_TAKEN:
        a = data.amount || 0;
        b = (data.by || 0) & 0xffff;
        break;
      case EV.HEAL:
        a = data.amount || 0;
        b = data.kind || 0;
        break;
      case EV.EMOTE:
        a = data.emote || 0;
        break;
      case EV.MARK:
        a = data.type || 0;
        b = data.teamId || 0;
        break;
      case EV.FOOTSTEP:
        a = data.surface || 0;
        break;
      case EV.LAND:
        a = data.force || 0;
        break;
      case EV.DINO_ROAR:
      case EV.DINO_ATTACK:
        a = data.type || 0;
        b = data.target || 0;
        break;
      case EV.RELOAD:
        a = data.weaponId || 0;
        b = data.empty || 0;
        break;
      case EV.DOWNED:
      case EV.REVIVED:
        a = data.by || 0;
        break;
      case EV.ZONE_WARN:
        a = data.phase || 0;
        break;
      default:
        break;
    }
    this.events.push({ type, entityId: data.entityId || 0, x: data.x || 0, y: data.y || 0, z: data.z || 0, a, b });
    if (this.events.length > 400) this.events.shift();
  }

  sendFullState(player) {
    this._sendJson(player, {
      t: 'match.full',
      matchId: this.id,
      mode: this.modeKey,
      seed: this.seed,
      state: this.state,
      tick: this.tick,
      arena: this.arena,
      landmarks: this.landmarks,
      teamId: player.teamId,
      entityId: player.entityId,
      voice: this.mode.voice,
      players: Array.from(this.players.values()).map((p) => ({
        entityId: p.entityId,
        userId: p.userId,
        name: p.name,
        teamId: p.teamId,
        skin: p.skin,
        trail: p.trail,
        level: p.level,
        alive: p.alive,
      })),
      edits: Array.from(this.edits.entries()).slice(0, 20000).map(([k, v]) => {
        const y = k % 256;
        const rest = (k - y) / 256;
        const z = (rest % 65536) - 32768;
        const x = (rest - (rest % 65536)) / 65536 - 32768;
        return [x, y, z, v];
      }),
      zone: this.zone,
      plane: this.plane,
    });
    this._sendInventory(player);
  }

  _sendInventory(player) {
    if (!player.conn) return;
    const inv = player.inv;
    this._sendJson(player, {
      t: 'match.inventory',
      slot: inv.slot,
      weapons: inv.weapons.map((w) =>
        w
          ? {
              id: w.id,
              key: w.key,
              rarity: w.rarity,
              ammoInMag: w.ammoInMag,
              mag: Content.WEAPON_BY_ID[w.id].mag,
              damage: w.damage,
            }
          : null,
      ),
      ammo: inv.ammo,
      items: inv.items,
      gear: inv.gear,
      materials: inv.materials,
      buildSlot: inv.buildSlot,
      health: Math.round(player.health),
      shield: Math.round(player.shield),
      useAction: player.useAction ? { key: player.useAction.key, endsAt: player.useAction.endsAt } : null,
      reloadEndsAt: player.reloadEndsAt,
    });
  }

  // ==========================================================================
  //  Messaging helpers
  // ==========================================================================
  _sendJson(player, obj) {
    if (player.conn && player.connected) player.conn.send(obj);
  }

  _sendBinary(player, writer) {
    if (player.conn && player.connected) player.conn.sendBinary(writer.toBuffer());
  }

  broadcastJson(obj, exceptUserId) {
    for (const p of this.players.values()) {
      if (p.userId === exceptUserId) continue;
      this._sendJson(p, obj);
    }
  }

  /** In-match chat with team / all scoping decided by the server. */
  chat(player, scope, text) {
    const clean = String(text || '').slice(0, 240).trim();
    if (!clean) return;
    const msg = {
      id: randomId(6),
      scope,
      from: player.userId,
      fromName: player.name,
      teamId: player.teamId,
      text: clean,
      at: Date.now(),
    };
    const targets = scope === 'team' ? [player, ...this.teammatesOf(player)] : Array.from(this.players.values());
    for (const p of targets) this._sendJson(p, { t: 'chat.msg', msg });
  }

  /**
   * Which voice channel should this player hear? Server decides so clients
   * cannot subscribe to an enemy team's audio.
   */
  voicePeersFor(player) {
    const mode = this.mode.voice;
    const peers = [];
    if (mode === 'team' || (mode === 'proximity' && this.mode.teamSize > 1)) {
      for (const mate of this.teammatesOf(player)) {
        if (mate.connected) peers.push({ userId: mate.userId, entityId: mate.entityId, channel: 'team' });
      }
    }
    if (mode === 'all') {
      for (const other of this.players.values()) {
        if (other === player || !other.connected) continue;
        peers.push({ userId: other.userId, entityId: other.entityId, channel: 'all' });
      }
    }
    if (mode === 'proximity') {
      for (const other of this.players.values()) {
        if (other === player || !other.connected) continue;
        if (peers.some((p) => p.userId === other.userId)) continue;
        const d2 = dist2(other.s.x, other.s.y, other.s.z, player.s.x, player.s.y, player.s.z);
        if (d2 < 42 * 42) peers.push({ userId: other.userId, entityId: other.entityId, channel: 'proximity' });
      }
    }
    return peers;
  }

  summary() {
    return {
      id: this.id,
      mode: this.modeKey,
      state: this.state,
      players: this.players.size,
      maxPlayers: this.mode.maxPlayers,
      alive: this.aliveCount,
      teams: this.aliveTeams(),
      private: this.private,
      code: this.private ? this.code : null,
      startedAt: this.startedAt,
      seed: this.seed,
    };
  }
}

return { Match, Rng, createInventory, weaponInstance, randomId };

});
