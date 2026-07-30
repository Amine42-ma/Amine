import { WORLD_W, WORLD_H } from '../../shared/constants.js';
import type { Terrain, SettlementKind } from '../../shared/protocol.js';
import { mulberry32, clamp, dist } from '../../shared/util.js';

export interface Settlement {
  id: string;
  name_ar: string;
  name_en: string;
  kind: SettlementKind;
  x: number;
  y: number;
  region: string;
  population: number;
  plots: number;
  /** Building ids occupying plots, in purchase order. */
  occupied: string[];
}

export interface WorldMap {
  seed: number;
  width: number;
  height: number;
  /** Row-major terrain grid. */
  tiles: Uint8Array;
  settlements: Settlement[];
  regions: string[];
}

export const TERRAIN_ORDER: Terrain[] = ['water', 'sand', 'grass', 'forest', 'desert', 'mountain', 'road'];
const T = Object.fromEntries(TERRAIN_ORDER.map((t, i) => [t, i])) as Record<Terrain, number>;

const REGION_NAMES = [
  'الشمال الغربي', 'الشمال', 'الشمال الشرقي',
  'الغرب', 'الوسط', 'الشرق',
  'الجنوب الغربي', 'الجنوب', 'الجنوب الشرقي',
];

const CITY_NAMES: [string, string][] = [
  ['قرطاج', 'Carthage'], ['سمرقند', 'Samarkand'], ['الإسكندرية', 'Alexandria'],
  ['طنجة', 'Tangier'], ['بغداد', 'Baghdad'], ['أصفهان', 'Isfahan'],
  ['دمشق', 'Damascus'], ['غرناطة', 'Granada'], ['تدمر', 'Palmyra'],
  ['البصرة', 'Basra'], ['فاس', 'Fez'], ['حلب', 'Aleppo'],
  ['عدن', 'Aden'], ['مسقط', 'Muscat'], ['بخارى', 'Bukhara'],
  ['القيروان', 'Kairouan'], ['شيراز', 'Shiraz'], ['صنعاء', 'Sanaa'],
];

const VILLAGE_NAMES: [string, string][] = [
  ['وادي النخيل', 'Palm Valley'], ['عين الغزال', 'Gazelle Spring'], ['تل الرمال', 'Sand Hill'],
  ['مرج الزيتون', 'Olive Meadow'], ['بئر السلام', 'Peace Well'], ['قرية الشمس', 'Sun Village'],
  ['ظل الجبل', 'Mountain Shade'], ['سهل القمح', 'Wheat Plain'], ['غابة الأرز', 'Cedar Wood'],
  ['حقول الفضة', 'Silver Fields'], ['نبع البلور', 'Crystal Spring'], ['رمال الذهب', 'Golden Sands'],
];

const PORT_NAMES: [string, string][] = [
  ['ميناء اللؤلؤ', 'Pearl Harbour'], ['مرسى الفجر', 'Dawn Marina'], ['خليج التجار', 'Merchant Bay'],
  ['ميناء الملح', 'Salt Port'], ['رأس المرجان', 'Coral Cape'], ['مرفأ الرياح', 'Windward Quay'],
];

const ISLAND_NAMES: [string, string][] = [
  ['جزيرة الزمرد', 'Emerald Isle'], ['جزيرة العاصفة', 'Storm Isle'],
  ['جزيرة الكنز', 'Treasure Isle'], ['جزيرة المرجان', 'Coral Isle'],
];

/** Smooth value noise: a coarse random lattice, bilinearly interpolated, octaved. */
function noiseField(rng: () => number, w: number, h: number, cells: number, octaves: number): Float32Array {
  const out = new Float32Array(w * h);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const gw = Math.max(2, Math.floor(cells * Math.pow(2, o))) + 1;
    const gh = gw;
    const grid = new Float32Array(gw * gh);
    for (let i = 0; i < grid.length; i++) grid[i] = rng();
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * (gh - 1);
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const y1 = Math.min(gh - 1, y0 + 1);
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * (gw - 1);
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const x1 = Math.min(gw - 1, x0 + 1);
        const a = grid[y0 * gw + x0] * (1 - tx) + grid[y0 * gw + x1] * tx;
        const b = grid[y1 * gw + x0] * (1 - tx) + grid[y1 * gw + x1] * tx;
        // Smoothstep on the vertical blend keeps the coastline from looking gridded.
        const s = ty * ty * (3 - 2 * ty);
        out[y * w + x] += (a * (1 - s) + b * s) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function regionOf(x: number, y: number): string {
  const col = clamp(Math.floor((x / WORLD_W) * 3), 0, 2);
  const row = clamp(Math.floor((y / WORLD_H) * 3), 0, 2);
  return REGION_NAMES[row * 3 + col];
}

export function generateWorld(seed: number): WorldMap {
  const rng = mulberry32(seed);
  const w = WORLD_W;
  const h = WORLD_H;

  const elevation = noiseField(rng, w, h, 3, 5);
  const moisture = noiseField(rng, w, h, 4, 4);
  const heat = noiseField(rng, w, h, 2, 3);

  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // Pull elevation down near the map border so the continent is ringed by sea.
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y) / 26;
      const e = elevation[i] * clamp(edge, 0, 1) * 1.15;
      const m = moisture[i];
      const t = heat[i];

      let terrain: number;
      if (e < 0.32) terrain = T.water;
      else if (e < 0.36) terrain = T.sand;
      else if (e > 0.7) terrain = T.mountain;
      else if (t > 0.62 && m < 0.42) terrain = T.desert;
      else if (m > 0.58) terrain = T.forest;
      else terrain = T.grass;
      tiles[i] = terrain;
    }
  }

  const settlements: Settlement[] = [];
  const isWater = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h || tiles[y * w + x] === T.water;

  const nearWater = (x: number, y: number, r: number) => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) if (isWater(x + dx, y + dy)) return true;
    return false;
  };

  const farEnough = (x: number, y: number, min: number) =>
    settlements.every((s) => dist(s.x, s.y, x, y) >= min);

  function place(
    kind: SettlementKind,
    names: [string, string][],
    count: number,
    minSpacing: number,
    accept: (x: number, y: number) => boolean,
  ) {
    let placed = 0;
    let guard = 0;
    while (placed < count && guard < 40000) {
      guard++;
      const x = Math.floor(rng() * w);
      const y = Math.floor(rng() * h);
      if (!accept(x, y) || !farEnough(x, y, minSpacing)) continue;
      const [ar, en] = names[placed % names.length];
      const suffix = placed >= names.length ? ` ${Math.floor(placed / names.length) + 1}` : '';
      const population =
        kind === 'city' ? 6000 + Math.floor(rng() * 14000)
        : kind === 'port' ? 3500 + Math.floor(rng() * 6000)
        : kind === 'island' ? 1200 + Math.floor(rng() * 2500)
        : 800 + Math.floor(rng() * 2200);
      settlements.push({
        id: `s${settlements.length}`,
        name_ar: ar + suffix,
        name_en: en + suffix,
        kind,
        x,
        y,
        region: regionOf(x, y),
        population,
        plots: kind === 'city' ? 26 : kind === 'port' ? 18 : kind === 'island' ? 10 : 12,
        occupied: [],
      });
      placed++;
    }
  }

  const landAt = (x: number, y: number) => {
    const t = tiles[y * w + x];
    return t === T.grass || t === T.forest || t === T.desert;
  };

  // Islands are carved rather than discovered. Relying on the noise to throw up
  // isolated landmasses means some seeds have none at all, and sea trade is a
  // designed feature — it should exist in every world.
  const islands = carveIslands(tiles, w, h, rng, 4);
  islands.forEach((centre, index) => {
    const [ar, en] = ISLAND_NAMES[index % ISLAND_NAMES.length];
    const suffix = index >= ISLAND_NAMES.length ? ` ${Math.floor(index / ISLAND_NAMES.length) + 1}` : '';
    settlements.push({
      id: `s${settlements.length}`,
      name_ar: ar + suffix,
      name_en: en + suffix,
      kind: 'island',
      x: centre.x,
      y: centre.y,
      region: regionOf(centre.x, centre.y),
      population: 1200 + Math.floor(rng() * 2500),
      plots: 10,
      occupied: [],
    });
  });

  place('city', CITY_NAMES, 12, 34, (x, y) => landAt(x, y) && !nearWater(x, y, 2));
  place('port', PORT_NAMES, 8, 24, (x, y) => landAt(x, y) && nearWater(x, y, 2));
  place('village', VILLAGE_NAMES, 16, 18, (x, y) => landAt(x, y));

  carveRoads(tiles, w, settlements);

  return { seed, width: w, height: h, tiles, settlements, regions: REGION_NAMES.slice() };
}

/**
 * Stamps small landmasses into open ocean and returns their centres. The
 * clearance requirement relaxes on each pass so that even a seed whose ocean is
 * cramped still gets its islands.
 */
function carveIslands(
  tiles: Uint8Array,
  w: number,
  h: number,
  rng: () => number,
  count: number,
): { x: number; y: number }[] {
  const centres: { x: number; y: number }[] = [];

  const openSea = (x: number, y: number, clearance: number) => {
    for (let dy = -clearance; dy <= clearance; dy += 2) {
      for (let dx = -clearance; dx <= clearance; dx += 2) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return false;
        if (tiles[ny * w + nx] !== T.water) return false;
      }
    }
    return true;
  };

  // On land-heavy seeds the only open water is the ocean ringing the map, so the
  // search must reach the border — and settle for tighter and tighter clearance.
  for (const clearance of [12, 10, 8, 6, 5, 4]) {
    const spacing = Math.max(22, clearance * 3);
    let guard = 0;
    while (centres.length < count && guard++ < 20000) {
      const x = 7 + Math.floor(rng() * (w - 14));
      const y = 7 + Math.floor(rng() * (h - 14));
      if (!openSea(x, y, clearance)) continue;
      if (centres.some((c) => dist(c.x, c.y, x, y) < spacing)) continue;

      // Never stamp more land than the clearance we verified.
      const radius = Math.min(4 + Math.floor(rng() * 2), clearance - 1);
      for (let dy = -radius - 1; dy <= radius + 1; dy++) {
        for (let dx = -radius - 1; dx <= radius + 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const d = Math.hypot(dx, dy);
          if (d <= radius - 1) tiles[ny * w + nx] = rng() > 0.6 ? T.forest : T.grass;
          else if (d <= radius + 0.5) tiles[ny * w + nx] = T.sand;
        }
      }
      centres.push({ x, y });
    }
    if (centres.length >= count) break;
  }
  return centres;
}

/** Connects each settlement to its two nearest land neighbours with a road. */
function carveRoads(tiles: Uint8Array, w: number, settlements: Settlement[]) {
  const land = settlements.filter((s) => s.kind !== 'island');
  const drawn = new Set<string>();
  for (const a of land) {
    const nearest = land
      .filter((b) => b.id !== a.id)
      .sort((p, q) => dist(a.x, a.y, p.x, p.y) - dist(a.x, a.y, q.x, q.y))
      .slice(0, 2);
    for (const b of nearest) {
      const key = [a.id, b.id].sort().join('-');
      if (drawn.has(key)) continue;
      drawn.add(key);
      let x = a.x;
      let y = a.y;
      let guard = 0;
      while ((x !== b.x || y !== b.y) && guard++ < 2000) {
        const dx = Math.sign(b.x - x);
        const dy = Math.sign(b.y - y);
        // Step on the longer axis first so roads read as gentle diagonals.
        if (Math.abs(b.x - x) > Math.abs(b.y - y)) x += dx;
        else if (b.y !== y) y += dy;
        else x += dx;
        const i = y * w + x;
        if (tiles[i] !== 0) tiles[i] = T.road;
      }
    }
  }
}

