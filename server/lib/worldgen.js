'use strict';
/**
 * ============================================================================
 *  Dino Royale Evolution - SHARED DETERMINISTIC WORLD GENERATOR
 * ============================================================================
 *  This exact source is embedded in the client (index.html) and required by
 *  the authoritative server. Both sides therefore generate an identical world
 *  from a single 32-bit seed, which means:
 *
 *    - The server never has to stream terrain (no loading screens, tiny
 *      bandwidth); it only replicates *deltas* (blocks players build/destroy).
 *    - The server can still authoritatively collide, raycast and path-find,
 *      because it can materialise any voxel on demand.
 *
 *  Everything here must stay pure + integer-deterministic. No Math.random,
 *  no Date, no floating point accumulation across chunks.
 *
 *  test/run.js verifies the client copy and this copy agree on 200k samples.
 * ============================================================================
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorldGen = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // ---------------------------------------------------------------------------
  // World constants
  // ---------------------------------------------------------------------------
  const WORLD = {
    HEIGHT: 192, // vertical voxel range [0, 192)
    SEA_LEVEL: 64,
    LAVA_LEVEL: 10,
    BEDROCK: 2,
    CHUNK: 16, // horizontal chunk footprint
    SECTION: 16, // vertical section height
    RADIUS: 3072, // playable half-extent in blocks -> 6144 x 6144 world
    CLOUD_LEVEL: 150,
  };
  WORLD.SECTIONS = WORLD.HEIGHT / WORLD.SECTION;

  // ---------------------------------------------------------------------------
  // Block registry. Ids are protocol-stable: append only, never reorder.
  // flags: 1 solid, 2 transparent, 4 liquid, 8 foliage(cross-mesh), 16 emissive,
  //        32 climbable, 64 destructible-by-players, 128 loot-container
  // ---------------------------------------------------------------------------
  const F = {
    SOLID: 1,
    TRANSPARENT: 2,
    LIQUID: 4,
    FOLIAGE: 8,
    EMISSIVE: 16,
    CLIMB: 32,
    BREAK: 64,
    CONTAINER: 128,
  };

  const BLOCKS = [
    // id, name, flags, hardness, [texture indices per face or single]
    { id: 0, name: 'air', flags: F.TRANSPARENT, hardness: 0 },
    { id: 1, name: 'bedrock', flags: F.SOLID, hardness: -1 },
    { id: 2, name: 'stone', flags: F.SOLID | F.BREAK, hardness: 2.2 },
    { id: 3, name: 'granite', flags: F.SOLID | F.BREAK, hardness: 2.6 },
    { id: 4, name: 'basalt', flags: F.SOLID | F.BREAK, hardness: 3.0 },
    { id: 5, name: 'dirt', flags: F.SOLID | F.BREAK, hardness: 0.9 },
    { id: 6, name: 'grass', flags: F.SOLID | F.BREAK, hardness: 1.0 },
    { id: 7, name: 'sand', flags: F.SOLID | F.BREAK, hardness: 0.7 },
    { id: 8, name: 'sandstone', flags: F.SOLID | F.BREAK, hardness: 1.9 },
    { id: 9, name: 'clay', flags: F.SOLID | F.BREAK, hardness: 1.1 },
    { id: 10, name: 'gravel', flags: F.SOLID | F.BREAK, hardness: 0.8 },
    { id: 11, name: 'snow', flags: F.SOLID | F.BREAK, hardness: 0.5 },
    { id: 12, name: 'ice', flags: F.SOLID | F.BREAK, hardness: 1.2 },
    { id: 13, name: 'packed_ice', flags: F.SOLID | F.BREAK, hardness: 1.8 },
    { id: 14, name: 'mud', flags: F.SOLID | F.BREAK, hardness: 0.8 },
    { id: 15, name: 'moss_stone', flags: F.SOLID | F.BREAK, hardness: 2.2 },
    { id: 16, name: 'water', flags: F.LIQUID | F.TRANSPARENT, hardness: 0 },
    { id: 17, name: 'lava', flags: F.LIQUID | F.TRANSPARENT | F.EMISSIVE, hardness: 0 },
    { id: 18, name: 'log_oak', flags: F.SOLID | F.BREAK | F.CLIMB, hardness: 1.6 },
    { id: 19, name: 'log_pine', flags: F.SOLID | F.BREAK | F.CLIMB, hardness: 1.6 },
    { id: 20, name: 'log_palm', flags: F.SOLID | F.BREAK | F.CLIMB, hardness: 1.4 },
    { id: 21, name: 'log_dead', flags: F.SOLID | F.BREAK | F.CLIMB, hardness: 1.3 },
    { id: 22, name: 'leaves_oak', flags: F.SOLID | F.BREAK | F.TRANSPARENT, hardness: 0.3 },
    { id: 23, name: 'leaves_pine', flags: F.SOLID | F.BREAK | F.TRANSPARENT, hardness: 0.3 },
    { id: 24, name: 'leaves_palm', flags: F.SOLID | F.BREAK | F.TRANSPARENT, hardness: 0.3 },
    { id: 25, name: 'leaves_jungle', flags: F.SOLID | F.BREAK | F.TRANSPARENT, hardness: 0.3 },
    { id: 26, name: 'planks', flags: F.SOLID | F.BREAK, hardness: 1.5 },
    { id: 27, name: 'stone_brick', flags: F.SOLID | F.BREAK, hardness: 2.8 },
    { id: 28, name: 'ancient_brick', flags: F.SOLID | F.BREAK, hardness: 4.0 },
    { id: 29, name: 'ancient_carved', flags: F.SOLID | F.BREAK, hardness: 4.0 },
    { id: 30, name: 'metal_panel', flags: F.SOLID | F.BREAK, hardness: 3.6 },
    { id: 31, name: 'metal_rust', flags: F.SOLID | F.BREAK, hardness: 3.2 },
    { id: 32, name: 'concrete', flags: F.SOLID | F.BREAK, hardness: 3.0 },
    { id: 33, name: 'glass', flags: F.SOLID | F.BREAK | F.TRANSPARENT, hardness: 0.4 },
    { id: 34, name: 'ore_iron', flags: F.SOLID | F.BREAK, hardness: 3.0 },
    { id: 35, name: 'ore_gold', flags: F.SOLID | F.BREAK, hardness: 3.2 },
    { id: 36, name: 'ore_crystal', flags: F.SOLID | F.BREAK | F.EMISSIVE, hardness: 3.6 },
    { id: 37, name: 'ore_amber', flags: F.SOLID | F.BREAK | F.EMISSIVE, hardness: 2.8 },
    { id: 38, name: 'ore_fossil', flags: F.SOLID | F.BREAK, hardness: 2.4 },
    { id: 39, name: 'obsidian', flags: F.SOLID | F.BREAK, hardness: 6.0 },
    { id: 40, name: 'magma', flags: F.SOLID | F.BREAK | F.EMISSIVE, hardness: 2.0 },
    { id: 41, name: 'ash', flags: F.SOLID | F.BREAK, hardness: 0.6 },
    { id: 42, name: 'grass_tuft', flags: F.FOLIAGE | F.TRANSPARENT, hardness: 0.05 },
    { id: 43, name: 'fern', flags: F.FOLIAGE | F.TRANSPARENT, hardness: 0.05 },
    { id: 44, name: 'flower_red', flags: F.FOLIAGE | F.TRANSPARENT, hardness: 0.05 },
    { id: 45, name: 'flower_blue', flags: F.FOLIAGE | F.TRANSPARENT, hardness: 0.05 },
    { id: 46, name: 'cactus', flags: F.SOLID | F.BREAK, hardness: 0.6 },
    { id: 47, name: 'dead_bush', flags: F.FOLIAGE | F.TRANSPARENT, hardness: 0.05 },
    { id: 48, name: 'reed', flags: F.FOLIAGE | F.TRANSPARENT, hardness: 0.05 },
    { id: 49, name: 'vine', flags: F.FOLIAGE | F.TRANSPARENT | F.CLIMB, hardness: 0.1 },
    { id: 50, name: 'mushroom_glow', flags: F.FOLIAGE | F.TRANSPARENT | F.EMISSIVE, hardness: 0.05 },
    { id: 51, name: 'coral', flags: F.SOLID | F.BREAK | F.EMISSIVE, hardness: 0.4 },
    { id: 52, name: 'crate', flags: F.SOLID | F.BREAK | F.CONTAINER, hardness: 0.8 },
    { id: 53, name: 'supply_case', flags: F.SOLID | F.BREAK | F.CONTAINER | F.EMISSIVE, hardness: 1.0 },
    { id: 54, name: 'ladder', flags: F.TRANSPARENT | F.CLIMB, hardness: 0.4 },
    { id: 55, name: 'torch', flags: F.FOLIAGE | F.TRANSPARENT | F.EMISSIVE, hardness: 0.05 },
    { id: 56, name: 'build_wood', flags: F.SOLID | F.BREAK, hardness: 1.4 },
    { id: 57, name: 'build_stone', flags: F.SOLID | F.BREAK, hardness: 2.6 },
    { id: 58, name: 'build_metal', flags: F.SOLID | F.BREAK, hardness: 4.2 },
    { id: 59, name: 'build_ramp', flags: F.SOLID | F.BREAK, hardness: 1.4 },
    { id: 60, name: 'nest_egg', flags: F.SOLID | F.BREAK | F.CONTAINER, hardness: 0.9 },
  ];

  const BLOCK_BY_NAME = Object.create(null);
  for (const b of BLOCKS) BLOCK_BY_NAME[b.name] = b.id;
  const B = BLOCK_BY_NAME;

  const FLAGS = new Uint8Array(256);
  const HARDNESS = new Float32Array(256);
  for (const b of BLOCKS) {
    FLAGS[b.id] = b.flags;
    HARDNESS[b.id] = b.hardness;
  }

  const isSolid = (id) => (FLAGS[id] & F.SOLID) !== 0;
  const isLiquid = (id) => (FLAGS[id] & F.LIQUID) !== 0;
  const isOpaque = (id) => (FLAGS[id] & F.SOLID) !== 0 && (FLAGS[id] & F.TRANSPARENT) === 0;
  const isFoliage = (id) => (FLAGS[id] & F.FOLIAGE) !== 0;
  const isClimbable = (id) => (FLAGS[id] & F.CLIMB) !== 0;
  const isBreakable = (id) => (FLAGS[id] & F.BREAK) !== 0;
  const isEmissive = (id) => (FLAGS[id] & F.EMISSIVE) !== 0;

  // ---------------------------------------------------------------------------
  // Biome registry
  // ---------------------------------------------------------------------------
  const BIOME = {
    OCEAN: 0,
    BEACH: 1,
    PLAINS: 2,
    FOREST: 3,
    JUNGLE: 4,
    TAIGA: 5,
    SNOW: 6,
    DESERT: 7,
    SAVANNA: 8,
    SWAMP: 9,
    MOUNTAIN: 10,
    VOLCANO: 11,
    RIVER: 12,
    ISLAND: 13,
    BADLANDS: 14,
    GLACIER: 15,
  };

  const BIOME_INFO = [
    { id: 0, key: 'ocean', name: 'Abyssal Shelf', temp: 0.5, fog: [0.42, 0.62, 0.78], grass: [0.25, 0.55, 0.45] },
    { id: 1, key: 'beach', name: 'Amber Shore', temp: 0.7, fog: [0.78, 0.82, 0.86], grass: [0.55, 0.72, 0.38] },
    { id: 2, key: 'plains', name: 'Verdant Flats', temp: 0.6, fog: [0.72, 0.80, 0.88], grass: [0.44, 0.72, 0.32] },
    { id: 3, key: 'forest', name: 'Ironbark Forest', temp: 0.55, fog: [0.62, 0.74, 0.78], grass: [0.30, 0.62, 0.28] },
    { id: 4, key: 'jungle', name: 'Fossil Jungle', temp: 0.8, fog: [0.55, 0.72, 0.60], grass: [0.22, 0.66, 0.24] },
    { id: 5, key: 'taiga', name: 'Frostpine Taiga', temp: 0.25, fog: [0.68, 0.76, 0.84], grass: [0.32, 0.55, 0.38] },
    { id: 6, key: 'snow', name: 'Whiteout Tundra', temp: 0.05, fog: [0.86, 0.90, 0.96], grass: [0.55, 0.66, 0.60] },
    { id: 7, key: 'desert', name: 'Scorched Expanse', temp: 0.95, fog: [0.92, 0.84, 0.68], grass: [0.72, 0.68, 0.34] },
    { id: 8, key: 'savanna', name: 'Bone Savanna', temp: 0.85, fog: [0.86, 0.82, 0.66], grass: [0.66, 0.68, 0.30] },
    { id: 9, key: 'swamp', name: 'Mirefen Marsh', temp: 0.65, fog: [0.44, 0.52, 0.42], grass: [0.34, 0.50, 0.26] },
    { id: 10, key: 'mountain', name: 'Titan Ridge', temp: 0.2, fog: [0.74, 0.80, 0.90], grass: [0.42, 0.58, 0.40] },
    { id: 11, key: 'volcano', name: 'Emberfall Caldera', temp: 1.0, fog: [0.40, 0.28, 0.26], grass: [0.42, 0.36, 0.26] },
    { id: 12, key: 'river', name: 'Serpent River', temp: 0.6, fog: [0.66, 0.76, 0.82], grass: [0.40, 0.70, 0.34] },
    { id: 13, key: 'island', name: 'Drift Isles', temp: 0.75, fog: [0.70, 0.82, 0.88], grass: [0.42, 0.74, 0.36] },
    { id: 14, key: 'badlands', name: 'Rustcanyon', temp: 0.9, fog: [0.84, 0.66, 0.50], grass: [0.62, 0.52, 0.28] },
    { id: 15, key: 'glacier', name: 'Glacier Maw', temp: 0.0, fog: [0.82, 0.90, 0.98], grass: [0.60, 0.72, 0.74] },
  ];

  // ---------------------------------------------------------------------------
  // Structures
  // ---------------------------------------------------------------------------
  const STRUCT = {
    NONE: 0,
    TEMPLE: 1,
    OUTPOST: 2,
    VILLAGE: 3,
    MINE: 4,
    VAULT: 5, // secret treasure area
    NEST: 6, // dino nest
    RIG: 7, // abandoned coastal rig
  };

  const STRUCT_INFO = [
    { id: 0, key: 'none', name: '' },
    { id: 1, key: 'temple', name: 'Sunken Temple', grid: 320, loot: 3.0, radius: 26 },
    { id: 2, key: 'outpost', name: 'Abandoned Outpost', grid: 224, loot: 1.8, radius: 20 },
    { id: 3, key: 'village', name: 'Ruined Village', grid: 288, loot: 1.4, radius: 30 },
    { id: 4, key: 'mine', name: 'Deep Mine', grid: 256, loot: 2.2, radius: 18 },
    { id: 5, key: 'vault', name: 'Hidden Vault', grid: 512, loot: 5.0, radius: 14 },
    { id: 6, key: 'nest', name: 'Saurian Nest', grid: 192, loot: 2.6, radius: 16 },
    { id: 7, key: 'rig', name: 'Derelict Rig', grid: 384, loot: 2.4, radius: 22 },
  ];

  // ---------------------------------------------------------------------------
  // Integer hash + noise primitives (branch-free, allocation-free)
  // ---------------------------------------------------------------------------
  function hash3i(seed, x, y, z) {
    let h = seed | 0;
    h = (Math.imul(h ^ (x | 0), 0x27d4eb2d) + 0x165667b1) | 0;
    h = (Math.imul(h ^ (y | 0), 0x85ebca6b) + 0x9e3779b9) | 0;
    h = (Math.imul(h ^ (z | 0), 0xc2b2ae35) + 0x27d4eb2f) | 0;
    h ^= h >>> 15;
    h = Math.imul(h, 0x2545f491);
    h ^= h >>> 13;
    return h >>> 0;
  }

  function hash2i(seed, x, y) {
    return hash3i(seed, x, y, 0x9e37);
  }

  /** Uniform float in [0,1) from an integer coordinate hash. */
  function rand2(seed, x, y) {
    return hash2i(seed, x, y) / 4294967296;
  }
  function rand3(seed, x, y, z) {
    return hash3i(seed, x, y, z) / 4294967296;
  }

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;

  /** 2D value noise in [-1,1]. */
  function noise2(seed, x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = fade(xf);
    const v = fade(yf);
    const a = rand2(seed, xi, yi);
    const b = rand2(seed, xi + 1, yi);
    const c = rand2(seed, xi, yi + 1);
    const d = rand2(seed, xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
  }

  /** 3D value noise in [-1,1]. */
  function noise3(seed, x, y, z) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);
    const c000 = rand3(seed, xi, yi, zi);
    const c100 = rand3(seed, xi + 1, yi, zi);
    const c010 = rand3(seed, xi, yi + 1, zi);
    const c110 = rand3(seed, xi + 1, yi + 1, zi);
    const c001 = rand3(seed, xi, yi, zi + 1);
    const c101 = rand3(seed, xi + 1, yi, zi + 1);
    const c011 = rand3(seed, xi, yi + 1, zi + 1);
    const c111 = rand3(seed, xi + 1, yi + 1, zi + 1);
    const x00 = lerp(c000, c100, u);
    const x10 = lerp(c010, c110, u);
    const x01 = lerp(c001, c101, u);
    const x11 = lerp(c011, c111, u);
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 2 - 1;
  }

  function fbm2(seed, x, y, octaves, lacunarity, gain) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise2(seed + i * 1013, x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  function fbm3(seed, x, y, z, octaves, lacunarity, gain) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise3(seed + i * 7919, x * freq, y * freq, z * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged multifractal - produces sharp mountain crests and river valleys. */
  function ridged2(seed, x, y, octaves, lacunarity, gain) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(noise2(seed + i * 6151, x * freq, y * freq));
      sum += n * n * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  const smoothstep = (e0, e1, x) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------------------------------------------------------------------------
  // Generator
  // ---------------------------------------------------------------------------
  class World {
    constructor(seed) {
      this.seed = seed | 0;
      this.s = {
        cont: this.seed ^ 0x1a2b3c4d,
        mount: this.seed ^ 0x51ed270b,
        hill: this.seed ^ 0x2f8e4c11,
        temp: this.seed ^ 0x77aa33bb,
        hum: this.seed ^ 0x0badf00d,
        river: this.seed ^ 0x5c0ffee1,
        cave: this.seed ^ 0x3141592b,
        ore: this.seed ^ 0x27182818,
        tree: this.seed ^ 0x16180339,
        struct: this.seed ^ 0x6f2ec3d5,
        warp: this.seed ^ 0x4d2a9e77,
        detail: this.seed ^ 0x11235813,
      };
      // Column cache: key = (cx<<16)^cz  ->  Int32Array columns of a chunk.
      this._colCache = new Map();
      this._colCacheOrder = [];
      this._colCacheMax = 4096;
    }

    // -- climate ------------------------------------------------------------
    temperatureAt(x, z) {
      // Gain 1.9 stretches the value-noise FBM (which naturally clusters near
      // its mean) across the full 0..1 climate range.
      const base = clamp(fbm2(this.s.temp, x * 0.0016, z * 0.0016, 4, 2.0, 0.5) * 1.9 * 0.5 + 0.5, 0, 1);
      // Latitude band gives coherent polar / equatorial structure.
      const lat = Math.cos((z / WORLD.RADIUS) * Math.PI) * 0.5 + 0.5;
      return clamp(base * 0.5 + lat * 0.5, 0, 1);
    }

    humidityAt(x, z) {
      const base = clamp(fbm2(this.s.hum, x * 0.0019, z * 0.0019, 4, 2.0, 0.5) * 2.0 * 0.5 + 0.5, 0, 1);
      // Coastal proximity raises humidity, so rainforest hugs the shoreline and
      // deserts form in the continental interior.
      const inland = smoothstep(0.0, 0.55, this.continentAt(x, z));
      return clamp(base * 0.78 + (1 - inland) * 0.22, 0, 1);
    }

    continentAt(x, z) {
      const wx = x + noise2(this.s.warp, x * 0.0007, z * 0.0007) * 220;
      const wz = z + noise2(this.s.warp + 991, x * 0.0007, z * 0.0007) * 220;
      // Amplified + biased so the disc reads as a continent with inland seas
      // rather than an archipelago; measured land fraction ~0.68.
      let c = fbm2(this.s.cont, wx * 0.00082, wz * 0.00082, 6, 2.05, 0.52) * 2.1 + 0.30;
      // Soft radial falloff keeps the playable disc surrounded by ocean.
      const d = Math.sqrt(x * x + z * z) / WORLD.RADIUS;
      c -= smoothstep(0.74, 1.06, d) * 2.6;
      return c;
    }

    riverAt(x, z) {
      const wx = x * 0.00055 + noise2(this.s.warp + 17, x * 0.0016, z * 0.0016) * 0.22;
      const wz = z * 0.00055 + noise2(this.s.warp + 53, x * 0.0016, z * 0.0016) * 0.22;
      const r = ridged2(this.s.river, wx, wz, 3, 2.1, 0.5);
      // Crest of the ridged field (near 1) becomes the river channel.
      return smoothstep(0.86, 0.995, r);
    }

    /**
     * Terrain height (integer, top solid block Y) plus climate/biome data.
     * Returns a packed object; hot paths use columnRaw().
     */
    columnRaw(x, z) {
      const cont = this.continentAt(x, z);
      const temp = this.temperatureAt(x, z);
      const hum = this.humidityAt(x, z);
      const river = this.riverAt(x, z);

      // Land mass shaping ---------------------------------------------------
      const landness = smoothstep(-0.06, 0.12, cont);
      const oceanDepth = smoothstep(0.12, -0.55, cont); // 0 near coast .. 1 deep

      const hills = fbm2(this.s.hill, x * 0.0075, z * 0.0075, 4, 2.1, 0.5);
      const hillAmp = 9 + 14 * smoothstep(0.1, 0.7, hum);

      // Mountain mask carves distinct ranges rather than uniform bumpiness.
      const mountMask = smoothstep(0.18, 0.62, fbm2(this.s.mount + 7, x * 0.00085, z * 0.00085, 3, 2.0, 0.55) * 0.5 + 0.5);
      const ridge = ridged2(this.s.mount, x * 0.0026, z * 0.0026, 5, 2.15, 0.5);
      const mountains = Math.pow(ridge, 1.6) * mountMask * 84;

      const plateau = smoothstep(0.55, 0.85, fbm2(this.s.detail + 31, x * 0.0012, z * 0.0012, 3, 2, 0.5) * 0.5 + 0.5);

      let h = WORLD.SEA_LEVEL;
      h += landness * (12 + hills * hillAmp + mountains);
      h -= oceanDepth * 34;
      h += plateau * landness * 12;

      // Rivers cut down toward (slightly below) sea level.
      const riverCut = river * landness * (1 - smoothstep(0.35, 0.85, mountMask * ridge));
      h = lerp(h, WORLD.SEA_LEVEL - 3.2, riverCut * 0.92);

      // Volcanic cones: rare, very tall, always basalt/magma.
      const volcMask = smoothstep(0.78, 0.93, fbm2(this.s.mount + 401, x * 0.00065, z * 0.00065, 3, 2, 0.5) * 0.5 + 0.5);
      let volc = 0;
      if (volcMask > 0) {
        const cone = ridged2(this.s.mount + 977, x * 0.0018, z * 0.0018, 3, 2, 0.5);
        volc = volcMask * Math.pow(cone, 2.0) * 96;
        h += volc;
        // Crater
        const craterN = fbm2(this.s.mount + 1237, x * 0.004, z * 0.004, 2, 2, 0.5);
        if (volc > 62) h -= (volc - 62) * (0.9 + craterN * 0.25);
      }

      const height = Math.max(WORLD.BEDROCK + 1, Math.min(WORLD.HEIGHT - 12, Math.round(h)));

      return {
        height,
        cont,
        temp,
        hum,
        river: riverCut,
        landness,
        mountain: mountMask * ridge,
        volcanic: volcMask * (volc > 20 ? 1 : volc / 20),
        oceanDepth,
      };
    }

    /**
     * Whittaker-style classification: elevation gates first (water, shore,
     * alpine), then a temperature x humidity matrix for the land bands.
     */
    biomeAt(x, z, col) {
      const c = col || this.columnRaw(x, z);
      const h = c.height;
      const sea = WORLD.SEA_LEVEL;
      const t = c.temp;
      const hum = c.hum;

      // --- elevation gates
      if (c.volcanic > 0.5 && h > sea + 6) return BIOME.VOLCANO;
      if (h <= sea - 5) return BIOME.OCEAN;
      if (c.river > 0.3 && h <= sea + 3) return BIOME.RIVER;
      if (h <= sea + 2) return t < 0.16 ? BIOME.GLACIER : BIOME.BEACH;
      if (c.landness < 0.5 && h < sea + 20) return BIOME.ISLAND;
      if (h > sea + 66 || c.mountain > 0.66) return t < 0.34 ? BIOME.SNOW : BIOME.MOUNTAIN;

      // --- climate matrix
      if (t < 0.16) return BIOME.SNOW;
      if (t < 0.34) return hum > 0.42 ? BIOME.TAIGA : BIOME.SNOW;

      if (t > 0.74) {
        if (hum < 0.30) return BIOME.DESERT;
        if (hum < 0.48) return c.mountain > 0.30 ? BIOME.BADLANDS : BIOME.SAVANNA;
        if (hum < 0.70) return BIOME.FOREST;
        return h < sea + 12 && hum > 0.82 ? BIOME.SWAMP : BIOME.JUNGLE;
      }

      // temperate band
      if (hum < 0.26) return BIOME.SAVANNA;
      if (hum < 0.46) return BIOME.PLAINS;
      if (hum < 0.74) return BIOME.FOREST;
      return h < sea + 10 ? BIOME.SWAMP : BIOME.JUNGLE;
    }

    /** Cached per-column data: {height, biome}. */
    column(x, z) {
      const cx = x >> 4;
      const cz = z >> 4;
      const key = ((cx & 0xffff) << 16) | (cz & 0xffff);
      let chunkCols = this._colCache.get(key);
      if (!chunkCols) {
        chunkCols = { h: new Int16Array(256), b: new Uint8Array(256), r: new Uint8Array(256), built: false };
        this._colCache.set(key, chunkCols);
        this._colCacheOrder.push(key);
        if (this._colCacheOrder.length > this._colCacheMax) {
          const drop = this._colCacheOrder.shift();
          this._colCache.delete(drop);
        }
      }
      const lx = x - (cx << 4);
      const lz = z - (cz << 4);
      const i = lz * 16 + lx;
      if (!chunkCols.built) {
        const bx = cx << 4;
        const bz = cz << 4;
        for (let j = 0; j < 256; j++) {
          const wx = bx + (j & 15);
          const wz = bz + (j >> 4);
          const raw = this.columnRaw(wx, wz);
          chunkCols.h[j] = raw.height;
          chunkCols.b[j] = this.biomeAt(wx, wz, raw);
          chunkCols.r[j] = Math.round(clamp(raw.river, 0, 1) * 255);
        }
        chunkCols.built = true;
      }
      return { height: chunkCols.h[i], biome: chunkCols.b[i], river: chunkCols.r[i] / 255 };
    }

    heightAt(x, z) {
      return this.column(x, z).height;
    }

    // -- caves ---------------------------------------------------------------
    caveAt(x, y, z) {
      if (y <= WORLD.BEDROCK + 1) return false;
      // Two offset ridged fields intersect into tunnel networks.
      const a = fbm3(this.s.cave, x * 0.019, y * 0.034, z * 0.019, 3, 2.0, 0.5);
      const b = fbm3(this.s.cave + 4441, x * 0.019, y * 0.034, z * 0.019, 3, 2.0, 0.5);
      const t = 0.055 + 0.02 * Math.sin(y * 0.05);
      if (a * a + b * b < t * t) return true;
      // Large caverns deeper down.
      if (y < 44) {
        const c = fbm3(this.s.cave + 9091, x * 0.011, y * 0.018, z * 0.011, 3, 2.0, 0.55);
        const bias = smoothstep(44, 14, y) * 0.16;
        if (c > 0.42 - bias) return true;
      }
      return false;
    }

    // -- structures ----------------------------------------------------------
    /**
     * Deterministic structure lookup on a coarse grid. Returns
     * {type, cx, cz, y, radius, seed} or null.
     */
    structureNear(x, z) {
      for (let si = 1; si < STRUCT_INFO.length; si++) {
        const info = STRUCT_INFO[si];
        const g = info.grid;
        const gx = Math.floor(x / g);
        const gz = Math.floor(z / g);
        for (let ox = -1; ox <= 1; ox++) {
          for (let oz = -1; oz <= 1; oz++) {
            const s = this.structureAt(si, gx + ox, gz + oz);
            if (!s) continue;
            const dx = x - s.x;
            const dz = z - s.z;
            if (dx * dx + dz * dz <= s.radius * s.radius) return s;
          }
        }
      }
      return null;
    }

    structureAt(type, gx, gz) {
      const info = STRUCT_INFO[type];
      const h = hash3i(this.s.struct + type * 7717, gx, gz, type);
      // Density: not every cell hosts a structure.
      const density = type === STRUCT.VAULT ? 0.34 : type === STRUCT.NEST ? 0.62 : 0.5;
      if ((h & 0xffff) / 65536 > density) return null;
      const jx = ((h >>> 16) & 0xff) / 255;
      const jz = ((h >>> 24) & 0xff) / 255;
      const x = Math.round((gx + 0.15 + jx * 0.7) * info.grid);
      const z = Math.round((gz + 0.15 + jz * 0.7) * info.grid);

      // Reject placements whose terrain does not suit the structure.
      const col = this.columnRaw(x, z);
      const biome = this.biomeAt(x, z, col);
      if (!this._structureFits(type, biome, col)) return null;

      return {
        type,
        key: info.key,
        name: info.name,
        x,
        z,
        y: col.height,
        radius: info.radius,
        loot: info.loot,
        seed: h,
        biome,
      };
    }

    _structureFits(type, biome, col) {
      const h = col.height;
      switch (type) {
        case STRUCT.TEMPLE:
          return h > WORLD.SEA_LEVEL + 3 && (biome === BIOME.JUNGLE || biome === BIOME.DESERT || biome === BIOME.SAVANNA || biome === BIOME.FOREST);
        case STRUCT.OUTPOST:
          return h > WORLD.SEA_LEVEL + 4 && col.mountain < 0.7;
        case STRUCT.VILLAGE:
          return h > WORLD.SEA_LEVEL + 3 && h < WORLD.SEA_LEVEL + 40 && col.river < 0.4;
        case STRUCT.MINE:
          return h > WORLD.SEA_LEVEL + 6 && col.mountain > 0.28;
        case STRUCT.VAULT:
          return h > WORLD.SEA_LEVEL + 2;
        case STRUCT.NEST:
          return h > WORLD.SEA_LEVEL + 2 && col.river < 0.3;
        case STRUCT.RIG:
          return h < WORLD.SEA_LEVEL - 2;
        default:
          return false;
      }
    }

    /** All structures overlapping a chunk-sized region (for POI labels/minimap). */
    structuresInRegion(x0, z0, x1, z1) {
      const out = [];
      for (let si = 1; si < STRUCT_INFO.length; si++) {
        const g = STRUCT_INFO[si].grid;
        const gx0 = Math.floor(x0 / g) - 1;
        const gx1 = Math.floor(x1 / g) + 1;
        const gz0 = Math.floor(z0 / g) - 1;
        const gz1 = Math.floor(z1 / g) + 1;
        for (let gx = gx0; gx <= gx1; gx++) {
          for (let gz = gz0; gz <= gz1; gz++) {
            const s = this.structureAt(si, gx, gz);
            if (s) out.push(s);
          }
        }
      }
      return out;
    }

    // -- surface material selection -----------------------------------------
    surfaceBlock(biome, y, depth, temp) {
      // depth = distance below the column top (0 = top block)
      switch (biome) {
        case BIOME.OCEAN:
          return depth === 0 ? B.gravel : depth < 4 ? B.sand : B.stone;
        case BIOME.BEACH:
        case BIOME.ISLAND:
          return depth < 4 ? B.sand : depth < 8 ? B.sandstone : B.stone;
        case BIOME.DESERT:
          return depth < 5 ? B.sand : depth < 12 ? B.sandstone : B.stone;
        case BIOME.BADLANDS:
          return depth === 0 ? B.clay : depth < 6 ? B.sandstone : B.granite;
        case BIOME.SNOW:
          return depth === 0 ? B.snow : depth < 3 ? B.dirt : depth < 6 ? B.stone : B.granite;
        case BIOME.GLACIER:
          return depth === 0 ? B.ice : depth < 6 ? B.packed_ice : B.stone;
        case BIOME.SWAMP:
          return depth === 0 ? B.grass : depth < 4 ? B.mud : B.clay;
        case BIOME.VOLCANO:
          return depth === 0 ? (y > WORLD.SEA_LEVEL + 60 ? B.magma : B.ash) : depth < 8 ? B.basalt : B.obsidian;
        case BIOME.MOUNTAIN:
          return depth === 0 ? (temp < 0.3 ? B.snow : B.stone) : depth < 5 ? B.stone : B.granite;
        case BIOME.RIVER:
          return depth < 3 ? B.gravel : B.stone;
        case BIOME.TAIGA:
          return depth === 0 ? B.grass : depth < 4 ? B.dirt : B.stone;
        case BIOME.JUNGLE:
          return depth === 0 ? B.grass : depth < 6 ? B.dirt : B.moss_stone;
        default:
          return depth === 0 ? B.grass : depth < 4 ? B.dirt : B.stone;
      }
    }

    oreAt(x, y, z) {
      if (y > WORLD.SEA_LEVEL + 6) return 0;
      const n = rand3(this.s.ore, x, y, z);
      const deep = smoothstep(60, 8, y);
      if (n < 0.0016 + deep * 0.0026) {
        const pick = rand3(this.s.ore + 99, x, y, z);
        if (y < 20 && pick > 0.86) return B.ore_crystal;
        if (pick > 0.94) return B.ore_gold;
        if (pick > 0.72) return B.ore_amber;
        if (pick > 0.55) return B.ore_fossil;
        return B.ore_iron;
      }
      return 0;
    }

    /**
     * Authoritative single-voxel query. Used by the server for collision,
     * raycasts and AI. The client uses genSection() for meshing instead.
     */
    getBlock(x, y, z) {
      if (y < 0 || y >= WORLD.HEIGHT) return 0;
      if (y <= WORLD.BEDROCK) return B.bedrock;

      const col = this.column(x, z);
      const h = col.height;
      const biome = col.biome;

      if (y > h) {
        if (y <= WORLD.SEA_LEVEL) return B.water;
        if (biome === BIOME.VOLCANO && y <= WORLD.LAVA_LEVEL + 6 && y <= h + 2) return B.lava;
        return 0;
      }

      // Caves are carved above lava level only, so the world floor stays sealed.
      if (y < h && y > WORLD.BEDROCK + 1 && this.caveAt(x, y, z)) {
        if (y <= WORLD.LAVA_LEVEL) return B.lava;
        return 0;
      }

      const depth = h - y;
      const ore = depth > 3 ? this.oreAt(x, y, z) : 0;
      if (ore) return ore;

      const temp = biome === BIOME.SNOW || biome === BIOME.GLACIER ? 0.1 : 0.6;
      return this.surfaceBlock(biome, y, depth, temp);
    }

    /**
     * Generate a full 16x16x16 section into `out` (Uint8Array(4096)).
     * Layout: index = (y*16 + z)*16 + x  (matches the client mesher).
     * Returns true when the section contains at least one non-air voxel.
     */
    genSection(scx, scy, scz, out) {
      const bx = scx << 4;
      const by = scy << 4;
      const bz = scz << 4;
      let any = false;

      if (by >= WORLD.HEIGHT) {
        out.fill(0);
        return false;
      }

      // Per-column prepass keeps the inner loop free of noise evaluations.
      const heights = new Int16Array(256);
      const biomes = new Uint8Array(256);
      for (let lz = 0; lz < 16; lz++) {
        for (let lx = 0; lx < 16; lx++) {
          const c = this.column(bx + lx, bz + lz);
          heights[lz * 16 + lx] = c.height;
          biomes[lz * 16 + lx] = c.biome;
        }
      }

      out.fill(0);

      for (let ly = 0; ly < 16; ly++) {
        const wy = by + ly;
        if (wy >= WORLD.HEIGHT) break;
        for (let lz = 0; lz < 16; lz++) {
          const wz = bz + lz;
          for (let lx = 0; lx < 16; lx++) {
            const ci = lz * 16 + lx;
            const h = heights[ci];
            const biome = biomes[ci];
            const wx = bx + lx;
            let id = 0;

            if (wy <= WORLD.BEDROCK) {
              id = B.bedrock;
            } else if (wy > h) {
              if (wy <= WORLD.SEA_LEVEL) id = B.water;
              else if (biome === BIOME.VOLCANO && wy <= WORLD.LAVA_LEVEL + 6 && wy <= h + 2) id = B.lava;
              else id = 0;
            } else if (wy < h && this.caveAt(wx, wy, wz)) {
              id = wy <= WORLD.LAVA_LEVEL ? B.lava : 0;
            } else {
              const depth = h - wy;
              const ore = depth > 3 ? this.oreAt(wx, wy, wz) : 0;
              if (ore) id = ore;
              else id = this.surfaceBlock(biome, wy, depth, biome === BIOME.SNOW || biome === BIOME.GLACIER ? 0.1 : 0.6);
            }

            if (id) {
              out[(ly * 16 + lz) * 16 + lx] = id;
              any = true;
            }
          }
        }
      }

      // Decoration pass (trees, plants, structures) writes into this section
      // and may reach in from neighbouring columns.
      if (this.decorateSection(scx, scy, scz, out, heights, biomes)) any = true;
      return any;
    }

    /**
     * Vegetation + structures. Everything is derived from a coordinate hash so
     * neighbouring sections agree on overlapping features without any shared
     * state.
     */
    decorateSection(scx, scy, scz, out, heights, biomes) {
      const bx = scx << 4;
      const by = scy << 4;
      const bz = scz << 4;
      let any = false;

      const put = (wx, wy, wz, id, overwrite) => {
        const lx = wx - bx;
        const ly = wy - by;
        const lz = wz - bz;
        if (lx < 0 || lx > 15 || ly < 0 || ly > 15 || lz < 0 || lz > 15) return;
        const i = (ly * 16 + lz) * 16 + lx;
        if (!overwrite && out[i] !== 0) return;
        out[i] = id;
        any = true;
      };

      // -- vegetation: scan a margin around the section so tall trees whose
      //    trunks sit outside still contribute canopy voxels.
      const M = 8;
      for (let wz = bz - M; wz < bz + 16 + M; wz++) {
        for (let wx = bx - M; wx < bx + 16 + M; wx++) {
          const inSection = wx >= bx && wx < bx + 16 && wz >= bz && wz < bz + 16;
          const ci = inSection ? (wz - bz) * 16 + (wx - bx) : -1;
          const col = ci >= 0 ? { height: heights[ci], biome: biomes[ci] } : this.column(wx, wz);
          const h = col.height;
          if (h <= WORLD.SEA_LEVEL - 1) {
            if (inSection) this._decorateUnderwater(wx, wz, h, col.biome, put);
            continue;
          }
          // Trees are sparse; the hash gate rejects most columns immediately.
          const tr = rand2(this.s.tree, wx, wz);
          const density = this._treeDensity(col.biome);
          if (tr < density && this._treeWins(wx, wz, tr, density)) {
            this._buildTree(wx, h + 1, wz, col.biome, put, by);
          } else if (inSection) {
            this._decorateGround(wx, wz, h, col.biome, put);
          }
        }
      }

      // -- structures
      const sList = this.structuresInRegion(bx - 40, bz - 40, bx + 56, bz + 56);
      for (const s of sList) {
        if (by > s.y + 46 || by + 16 < s.y - 30) continue;
        this._buildStructure(s, put, bx, by, bz);
        any = true;
      }

      return any;
    }

    /**
     * Keeps trees apart.
     *
     * A plain probability gate lets two trees land on neighbouring columns, and
     * since a canopy is several blocks across, a forest came out as one solid
     * wall of leaves with no room to walk or see between the trunks. A column
     * only grows a tree if it holds the lowest hash in its neighbourhood, which
     * enforces a minimum spacing while keeping the natural clumping - some
     * clearings, some denser stands - rather than a grid.
     *
     * Cost is bounded: this only runs for the few percent of columns that pass
     * the density gate at all.
     */
    _treeWins(wx, wz, tr, density) {
      // Canopies are 7 blocks across, so trunks need real distance or the
      // crowns still fuse into one roof.
      const R = 4;
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx === 0 && dz === 0) continue;
          const other = rand2(this.s.tree, wx + dx, wz + dz);
          // Only competitors that would themselves become trees matter.
          if (other < density && other < tr) return false;
        }
      }
      return true;
    }

    _treeDensity(biome) {
      switch (biome) {
        case BIOME.FOREST:
          return 0.055;
        case BIOME.JUNGLE:
          return 0.075;
        case BIOME.TAIGA:
          return 0.05;
        case BIOME.SNOW:
          return 0.012;
        case BIOME.PLAINS:
          return 0.006;
        case BIOME.SAVANNA:
          return 0.009;
        case BIOME.SWAMP:
          return 0.03;
        case BIOME.BEACH:
        case BIOME.ISLAND:
          return 0.018;
        case BIOME.DESERT:
          return 0.004;
        case BIOME.MOUNTAIN:
          return 0.01;
        default:
          return 0.0;
      }
    }

    _decorateGround(wx, wz, h, biome, put) {
      const r = rand2(this.s.tree + 5501, wx, wz);
      const y = h + 1;
      switch (biome) {
        case BIOME.PLAINS:
        case BIOME.FOREST:
        case BIOME.RIVER:
          if (r < 0.30) put(wx, y, wz, B.grass_tuft, false);
          else if (r < 0.335) put(wx, y, wz, B.flower_red, false);
          else if (r < 0.36) put(wx, y, wz, B.flower_blue, false);
          break;
        case BIOME.JUNGLE:
          if (r < 0.42) put(wx, y, wz, B.fern, false);
          else if (r < 0.46) put(wx, y, wz, B.grass_tuft, false);
          else if (r < 0.47) put(wx, y, wz, B.mushroom_glow, false);
          break;
        case BIOME.SWAMP:
          if (r < 0.22) put(wx, y, wz, B.reed, false);
          else if (r < 0.30) put(wx, y, wz, B.fern, false);
          else if (r < 0.315) put(wx, y, wz, B.mushroom_glow, false);
          break;
        case BIOME.DESERT:
        case BIOME.BADLANDS:
          if (r < 0.012) {
            const ch = 2 + ((hash2i(this.s.tree, wx, wz) >>> 3) % 3);
            for (let i = 0; i < ch; i++) put(wx, y + i, wz, B.cactus, false);
          } else if (r < 0.05) put(wx, y, wz, B.dead_bush, false);
          break;
        case BIOME.SAVANNA:
          if (r < 0.20) put(wx, y, wz, B.grass_tuft, false);
          else if (r < 0.22) put(wx, y, wz, B.dead_bush, false);
          break;
        case BIOME.TAIGA:
          if (r < 0.14) put(wx, y, wz, B.fern, false);
          break;
        case BIOME.SNOW:
        case BIOME.GLACIER:
          break;
        case BIOME.VOLCANO:
          if (r < 0.02) put(wx, y, wz, B.magma, false);
          break;
        default:
          if (r < 0.12) put(wx, y, wz, B.grass_tuft, false);
      }
    }

    _decorateUnderwater(wx, wz, h, biome, put) {
      if (h < WORLD.SEA_LEVEL - 26 || h >= WORLD.SEA_LEVEL) return;
      const r = rand2(this.s.tree + 8123, wx, wz);
      if (r < 0.035) put(wx, h + 1, wz, B.coral, false);
      else if (r < 0.08) put(wx, h + 1, wz, B.reed, false);
    }

    /** Voxel tree builder - shape depends on biome. */
    _buildTree(wx, wy, wz, biome, put, sectionBaseY) {
      const hs = hash3i(this.s.tree + 313, wx, wz, biome);
      const rnd = (n) => ((hs >>> n) & 0xff) / 255;

      let trunk = B.log_oak;
      let leaf = B.leaves_oak;
      let height = 5 + Math.floor(rnd(3) * 4);
      let shape = 'round';

      switch (biome) {
        case BIOME.TAIGA:
        case BIOME.SNOW:
          trunk = B.log_pine;
          leaf = B.leaves_pine;
          height = 8 + Math.floor(rnd(5) * 7);
          shape = 'cone';
          break;
        case BIOME.JUNGLE:
          trunk = B.log_oak;
          leaf = B.leaves_jungle;
          height = 11 + Math.floor(rnd(7) * 10);
          shape = 'canopy';
          break;
        case BIOME.BEACH:
        case BIOME.ISLAND:
          trunk = B.log_palm;
          leaf = B.leaves_palm;
          height = 7 + Math.floor(rnd(4) * 5);
          shape = 'palm';
          break;
        case BIOME.SWAMP:
          trunk = B.log_dead;
          leaf = B.leaves_oak;
          height = 6 + Math.floor(rnd(4) * 4);
          shape = 'droop';
          break;
        case BIOME.SAVANNA:
          trunk = B.log_oak;
          leaf = B.leaves_oak;
          height = 6 + Math.floor(rnd(4) * 3);
          shape = 'flat';
          break;
        case BIOME.DESERT:
          trunk = B.log_dead;
          leaf = 0;
          height = 4 + Math.floor(rnd(4) * 3);
          shape = 'dead';
          break;
        case BIOME.MOUNTAIN:
          trunk = B.log_pine;
          leaf = B.leaves_pine;
          height = 6 + Math.floor(rnd(4) * 5);
          shape = 'cone';
          break;
      }

      // Trunk
      for (let i = 0; i < height; i++) {
        put(wx, wy + i, wz, trunk, true);
        if (shape === 'palm' && i > height - 4) {
          // gentle lean
          const lean = ((hs >> 11) & 1) ? 1 : -1;
          if (i === height - 1) put(wx + lean, wy + i, wz, trunk, true);
        }
      }
      if (!leaf) return;

      const top = wy + height;
      if (shape === 'cone') {
        let r = 3;
        for (let y = top - 1; y >= wy + 2; y -= 1) {
          const rr = Math.max(1, Math.round(r * (0.35 + 0.65 * ((top - y) / height))));
          for (let dz = -rr; dz <= rr; dz++) {
            for (let dx = -rr; dx <= rr; dx++) {
              if (dx * dx + dz * dz > rr * rr + 1) continue;
              if (dx === 0 && dz === 0 && y < top - 1) continue;
              put(wx + dx, y, wz + dz, leaf, false);
            }
          }
        }
        put(wx, top, wz, leaf, false);
      } else if (shape === 'canopy') {
        const r = 4;
        for (let dy = -2; dy <= 2; dy++) {
          const rr = r - Math.abs(dy);
          for (let dz = -rr; dz <= rr; dz++) {
            for (let dx = -rr; dx <= rr; dx++) {
              if (dx * dx + dz * dz > rr * rr) continue;
              put(wx + dx, top + dy, wz + dz, leaf, false);
            }
          }
        }
        // hanging vines
        for (let k = 0; k < 6; k++) {
          const a = ((hs >>> (k * 3)) & 7) - 3;
          const b = ((hs >>> (k * 3 + 5)) & 7) - 3;
          const len = 2 + (((hs >>> k) & 3) | 0);
          for (let v = 0; v < len; v++) put(wx + a, top - 3 - v, wz + b, B.vine, false);
        }
      } else if (shape === 'palm') {
        for (let dz = -3; dz <= 3; dz++) {
          for (let dx = -3; dx <= 3; dx++) {
            const d = Math.abs(dx) + Math.abs(dz);
            if (d > 3 || d === 0) continue;
            const drop = d >= 3 ? -1 : 0;
            put(wx + dx, top + drop, wz + dz, leaf, false);
          }
        }
        put(wx, top, wz, leaf, false);
      } else if (shape === 'flat') {
        for (let dz = -3; dz <= 3; dz++) {
          for (let dx = -3; dx <= 3; dx++) {
            if (dx * dx + dz * dz > 10) continue;
            put(wx + dx, top, wz + dz, leaf, false);
            if (dx * dx + dz * dz < 5) put(wx + dx, top + 1, wz + dz, leaf, false);
          }
        }
      } else if (shape === 'droop') {
        for (let dz = -3; dz <= 3; dz++) {
          for (let dx = -3; dx <= 3; dx++) {
            if (dx * dx + dz * dz > 9) continue;
            put(wx + dx, top - 1, wz + dz, leaf, false);
            if (dx * dx + dz * dz > 4) put(wx + dx, top - 2, wz + dz, B.vine, false);
          }
        }
        put(wx, top, wz, leaf, false);
      } else if (shape === 'dead') {
        put(wx + 1, top - 1, wz, trunk, false);
        put(wx - 1, top - 2, wz, trunk, false);
      } else {
        // round
        for (let dy = -2; dy <= 1; dy++) {
          const rr = dy === 1 ? 1 : dy === -2 ? 2 : 3;
          for (let dz = -rr; dz <= rr; dz++) {
            for (let dx = -rr; dx <= rr; dx++) {
              if (dx * dx + dz * dz > rr * rr + 1) continue;
              put(wx + dx, top + dy, wz + dz, leaf, false);
            }
          }
        }
      }
    }

    /**
     * Structures are described procedurally rather than as stored prefabs, so
     * every temple/outpost/village in the world has an original layout derived
     * from its own hash.
     */
    _buildStructure(s, put, bx, by, bz) {
      const h = s.seed;
      const rnd = (n) => ((hash3i(h, n, 0, 0) >>> 8) & 0xffff) / 65536;

      switch (s.type) {
        case STRUCT.TEMPLE:
          this._buildTemple(s, put, rnd);
          break;
        case STRUCT.OUTPOST:
          this._buildOutpost(s, put, rnd);
          break;
        case STRUCT.VILLAGE:
          this._buildVillage(s, put, rnd);
          break;
        case STRUCT.MINE:
          this._buildMine(s, put, rnd);
          break;
        case STRUCT.VAULT:
          this._buildVault(s, put, rnd);
          break;
        case STRUCT.NEST:
          this._buildNest(s, put, rnd);
          break;
        case STRUCT.RIG:
          this._buildRig(s, put, rnd);
          break;
      }
    }

    _buildTemple(s, put, rnd) {
      const base = s.y - 1;
      const size = 9 + Math.floor(rnd(1) * 5);
      const steps = 5 + Math.floor(rnd(2) * 3);
      // Stepped pyramid
      for (let step = 0; step < steps; step++) {
        const r = size - step * 2;
        if (r < 1) break;
        const y = base + step * 2;
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            const edge = Math.abs(dx) === r || Math.abs(dz) === r;
            const mat = edge && ((dx + dz + step) & 3) === 0 ? B.ancient_carved : B.ancient_brick;
            put(s.x + dx, y, s.z + dz, mat, true);
            put(s.x + dx, y + 1, s.z + dz, edge ? mat : 0, true);
          }
        }
      }
      // Inner chamber with loot
      const cy = base + 1;
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          for (let dy = 0; dy < 4; dy++) put(s.x + dx, cy + dy, s.z + dz, 0, true);
        }
      }
      put(s.x, cy, s.z, B.supply_case, true);
      put(s.x + 2, cy, s.z + 2, B.crate, true);
      put(s.x - 2, cy, s.z - 2, B.crate, true);
      put(s.x + 2, cy, s.z - 2, B.ore_amber, true);
      put(s.x - 2, cy + 3, s.z + 2, B.torch, true);
      // Entrance corridor on a hashed side
      const side = Math.floor(rnd(3) * 4);
      for (let i = 3; i <= size + 1; i++) {
        const dx = side === 0 ? i : side === 1 ? -i : 0;
        const dz = side === 2 ? i : side === 3 ? -i : 0;
        for (let dy = 0; dy < 3; dy++) put(s.x + dx, cy + dy, s.z + dz, 0, true);
      }
    }

    _buildOutpost(s, put, rnd) {
      const base = s.y;
      const w = 6 + Math.floor(rnd(1) * 4);
      const d = 6 + Math.floor(rnd(2) * 4);
      const height = 4 + Math.floor(rnd(3) * 3);
      for (let dz = -d; dz <= d; dz++) {
        for (let dx = -w; dx <= w; dx++) {
          put(s.x + dx, base - 1, s.z + dz, B.concrete, true);
          const wall = Math.abs(dx) === w || Math.abs(dz) === d;
          for (let dy = 0; dy < height; dy++) {
            if (wall) {
              const windowRow = dy === 2 && ((dx + dz) & 3) === 0;
              put(s.x + dx, base + dy, s.z + dz, windowRow ? B.glass : ((dx + dz + dy) & 7) === 0 ? B.metal_rust : B.metal_panel, true);
            } else {
              put(s.x + dx, base + dy, s.z + dz, 0, true);
            }
          }
          if (!wall) put(s.x + dx, base + height, s.z + dz, B.metal_panel, true);
        }
      }
      // Door
      put(s.x, base, s.z + d, 0, true);
      put(s.x, base + 1, s.z + d, 0, true);
      // Interior loot + light
      put(s.x - w + 2, base, s.z - d + 2, B.crate, true);
      put(s.x + w - 2, base, s.z + d - 2, B.crate, true);
      put(s.x, base, s.z, B.supply_case, true);
      put(s.x, base + height - 1, s.z, B.torch, true);
      // Watchtower
      if (rnd(4) > 0.45) {
        const tx = s.x + w - 1;
        const tz = s.z - d + 1;
        for (let dy = 0; dy < height + 6; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              const wall = Math.abs(dx) === 1 || Math.abs(dz) === 1;
              put(tx + dx, base + dy, tz + dz, wall ? B.metal_panel : 0, true);
            }
          }
        }
        put(tx, base + height + 5, tz, B.supply_case, true);
      }
    }

    _buildVillage(s, put, rnd) {
      const count = 4 + Math.floor(rnd(1) * 5);
      for (let i = 0; i < count; i++) {
        const a = rnd(10 + i) * Math.PI * 2;
        const dist = 8 + rnd(20 + i) * 18;
        const hx = Math.round(s.x + Math.cos(a) * dist);
        const hz = Math.round(s.z + Math.sin(a) * dist);
        const hy = this.column(hx, hz).height + 1;
        const w = 3 + Math.floor(rnd(30 + i) * 3);
        const hh = 4;
        const ruined = rnd(40 + i) > 0.35;
        for (let dz = -w; dz <= w; dz++) {
          for (let dx = -w; dx <= w; dx++) {
            put(hx + dx, hy - 1, hz + dz, B.planks, true);
            const wall = Math.abs(dx) === w || Math.abs(dz) === w;
            for (let dy = 0; dy < hh; dy++) {
              if (!wall) {
                put(hx + dx, hy + dy, hz + dz, 0, true);
                continue;
              }
              // Ruined walls lose their upper courses in a hashed pattern.
              if (ruined && dy > 1 && ((hash3i(s.seed, hx + dx, hy + dy, hz + dz) >>> 9) & 3) === 0) {
                put(hx + dx, hy + dy, hz + dz, 0, true);
              } else {
                put(hx + dx, hy + dy, hz + dz, dy === 0 ? B.stone_brick : B.planks, true);
              }
            }
            if (!ruined) put(hx + dx, hy + hh, hz + dz, B.planks, true);
          }
        }
        put(hx, hy, hz + w, 0, true);
        put(hx, hy + 1, hz + w, 0, true);
        if (rnd(50 + i) > 0.4) put(hx, hy, hz, B.crate, true);
        put(hx - w + 1, hy + hh - 1, hz - w + 1, B.torch, true);
      }
      // Central well
      const wy = s.y;
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
          put(s.x + dx, wy, s.z + dz, edge ? B.stone_brick : B.water, true);
          if (!edge) for (let dy = 1; dy < 5; dy++) put(s.x + dx, wy - dy, s.z + dz, B.water, true);
        }
      }
    }

    _buildMine(s, put, rnd) {
      const base = s.y;
      // Entrance frame
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          for (let dy = 0; dy < 4; dy++) {
            const shell = Math.abs(dx) === 3 || Math.abs(dz) === 3 || dy === 3;
            put(s.x + dx, base + dy, s.z + dz, shell ? B.planks : 0, true);
          }
        }
      }
      put(s.x, base, s.z + 3, 0, true);
      put(s.x, base + 1, s.z + 3, 0, true);
      // Descending shaft with supports and ore veins
      const depth = 26 + Math.floor(rnd(1) * 22);
      let mx = s.x;
      let mz = s.z;
      for (let i = 0; i < depth; i++) {
        const y = base - i;
        if (y < WORLD.BEDROCK + 2) break;
        if (i % 6 === 0) {
          mx += Math.round(rnd(60 + i) * 2 - 1);
          mz += Math.round(rnd(70 + i) * 2 - 1);
        }
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            put(mx + dx, y, mz + dz, 0, true);
          }
        }
        if (i % 4 === 0) {
          put(mx - 2, y, mz - 2, B.log_oak, true);
          put(mx + 2, y, mz + 2, B.log_oak, true);
          put(mx, y + 1, mz, B.torch, true);
        }
        if (i % 7 === 3) {
          put(mx + 2, y, mz, B.ore_iron, true);
          put(mx - 2, y, mz, i > depth * 0.6 ? B.ore_crystal : B.ore_gold, true);
        }
        if (i === depth - 1) {
          put(mx, y, mz, B.supply_case, true);
          put(mx + 1, y, mz + 1, B.crate, true);
        }
      }
    }

    _buildVault(s, put, rnd) {
      // Buried treasure room - no surface footprint beyond a subtle marker.
      const cy = s.y - 12 - Math.floor(rnd(1) * 8);
      const r = 5;
      for (let dy = 0; dy < 6; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            const shell = Math.abs(dx) === r || Math.abs(dz) === r || dy === 0 || dy === 5;
            put(s.x + dx, cy + dy, s.z + dz, shell ? B.ancient_brick : 0, true);
          }
        }
      }
      put(s.x, cy + 1, s.z, B.supply_case, true);
      put(s.x + 2, cy + 1, s.z + 2, B.supply_case, true);
      put(s.x - 2, cy + 1, s.z - 2, B.ore_crystal, true);
      put(s.x + 2, cy + 1, s.z - 2, B.crate, true);
      put(s.x - 2, cy + 1, s.z + 2, B.crate, true);
      put(s.x, cy + 4, s.z, B.torch, true);
      // Vertical access shaft hidden under a single carved block.
      for (let y = cy + 5; y <= s.y; y++) put(s.x, y, s.z, y === s.y ? B.ancient_carved : B.ladder, true);
    }

    _buildNest(s, put, rnd) {
      const base = s.y;
      const r = 6 + Math.floor(rnd(1) * 3);
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d > r) continue;
          const rim = d > r - 1.6;
          put(s.x + dx, base, s.z + dz, rim ? B.mud : B.sand, true);
          if (rim) put(s.x + dx, base + 1, s.z + dz, B.mud, true);
          else put(s.x + dx, base + 1, s.z + dz, 0, true);
        }
      }
      const eggs = 3 + Math.floor(rnd(2) * 4);
      for (let i = 0; i < eggs; i++) {
        const a = rnd(80 + i) * Math.PI * 2;
        const d = rnd(90 + i) * (r - 2);
        put(Math.round(s.x + Math.cos(a) * d), base + 1, Math.round(s.z + Math.sin(a) * d), B.nest_egg, true);
      }
      put(s.x, base + 1, s.z, B.crate, true);
    }

    _buildRig(s, put, rnd) {
      const deck = WORLD.SEA_LEVEL + 6 + Math.floor(rnd(1) * 4);
      const w = 7;
      // Legs
      for (const [lx, lz] of [
        [-w, -w],
        [w, -w],
        [-w, w],
        [w, w],
      ]) {
        for (let y = s.y; y <= deck; y++) {
          put(s.x + lx, y, s.z + lz, B.metal_rust, true);
          put(s.x + lx + (lx > 0 ? -1 : 1), y, s.z + lz, y % 5 === 0 ? B.metal_rust : 0, true);
        }
      }
      // Deck
      for (let dz = -w; dz <= w; dz++) {
        for (let dx = -w; dx <= w; dx++) {
          put(s.x + dx, deck, s.z + dz, ((dx + dz) & 5) === 0 ? B.metal_rust : B.metal_panel, true);
          const rail = Math.abs(dx) === w || Math.abs(dz) === w;
          if (rail) put(s.x + dx, deck + 1, s.z + dz, B.metal_rust, true);
        }
      }
      // Cabin
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          for (let dy = 1; dy <= 4; dy++) {
            const shell = Math.abs(dx) === 3 || Math.abs(dz) === 3 || dy === 4;
            put(s.x + dx, deck + dy, s.z + dz, shell ? (dy === 2 ? B.glass : B.metal_panel) : 0, true);
          }
        }
      }
      put(s.x, deck + 1, s.z + 3, 0, true);
      put(s.x, deck + 2, s.z + 3, 0, true);
      put(s.x, deck + 1, s.z, B.supply_case, true);
      put(s.x + 2, deck + 1, s.z - 2, B.crate, true);
      put(s.x, deck + 3, s.z, B.torch, true);
    }

    /**
     * Finds a safe spawn/landing position near (x,z): first solid ground above
     * sea level with 3 blocks of headroom.
     */
    safeSpawn(x, z) {
      const col = this.column(x, z);
      let y = Math.max(col.height + 1, WORLD.SEA_LEVEL + 1);
      for (let i = 0; i < 24; i++) {
        const feet = this.getBlock(x, y, z);
        const head = this.getBlock(x, y + 1, z);
        const ground = this.getBlock(x, y - 1, z);
        if (!isSolid(feet) && !isSolid(head) && isSolid(ground)) return { x: x + 0.5, y, z: z + 0.5 };
        y++;
      }
      return { x: x + 0.5, y: Math.max(col.height + 1, WORLD.SEA_LEVEL + 2), z: z + 0.5 };
    }
  }

  return {
    WORLD,
    BLOCKS,
    BLOCK_BY_NAME,
    B,
    F,
    FLAGS,
    HARDNESS,
    BIOME,
    BIOME_INFO,
    STRUCT,
    STRUCT_INFO,
    World,
    isSolid,
    isLiquid,
    isOpaque,
    isFoliage,
    isClimbable,
    isBreakable,
    isEmissive,
    hash2i,
    hash3i,
    rand2,
    rand3,
    noise2,
    noise3,
    fbm2,
    fbm3,
    ridged2,
    smoothstep,
    clamp,
    lerp,
  };
});
