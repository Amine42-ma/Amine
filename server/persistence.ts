import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { SEASON_MS } from '../shared/constants.js';
import type { GameState } from './game/state.js';
import { generateWorld } from './world/generate.js';
import { createMarket } from './sim/economy.js';
import { spawnNpcs } from './sim/ai.js';

/**
 * The world is a single JSON document written atomically. Terrain is not saved —
 * it is regenerated from the seed, which keeps snapshots small and fast.
 */

const SAVE_VERSION = 1;

export interface SaveOptions {
  dir: string;
  seed: number;
}

function savePath(dir: string) {
  return path.join(dir, 'world.json');
}

/** Maps serialise as arrays of entries; Uint8Array terrain is dropped entirely. */
function serialize(state: GameState) {
  return {
    version: SAVE_VERSION,
    seed: state.seed,
    savedAt: Date.now(),
    season: state.season,
    priceIndex: state.priceIndex,
    nextEventAt: state.nextEventAt,
    worldVolume: state.worldVolume,
    events: state.events,
    chat: state.chat,
    occupancy: state.map.settlements.map((s) => [s.id, s.occupied] as const),
    players: [...state.players.values()].filter((p) => !p.isNpc),
    buildings: [...state.buildings.values()].filter((b) => {
      const owner = state.players.get(b.ownerId);
      return owner !== undefined && !owner.isNpc;
    }),
    convoys: [...state.convoys.values()].filter((c) => {
      const owner = state.players.get(c.ownerId);
      return owner !== undefined && !owner.isNpc;
    }),
    companies: [...state.companies.values()],
    orders: [...state.orders.values()],
    contracts: [...state.contracts.values()],
    alliances: [...state.alliances.values()],
    markets: [...state.markets.values()].map((m) => ({
      settlementId: m.settlementId,
      tariff: m.tariff,
      // Only stock levels vary at runtime; baselines are derived from terrain.
      stock: Object.fromEntries(Object.entries(m.goods).map(([k, v]) => [k, Math.round(v.stock * 10) / 10])),
      lastPrice: Object.fromEntries(Object.entries(m.goods).map(([k, v]) => [k, Math.round(v.lastPrice * 100) / 100])),
    })),
  };
}

export async function saveState(state: GameState, opts: SaveOptions): Promise<void> {
  await mkdir(opts.dir, { recursive: true });
  const target = savePath(opts.dir);
  const tmp = `${target}.tmp`;
  await writeFile(tmp, JSON.stringify(serialize(state)), 'utf8');
  // Rename is atomic on POSIX, so a crash mid-write cannot corrupt the save.
  await rename(tmp, target);
}

/** Builds a brand-new world from a seed. */
export function createFreshState(seed: number): GameState {
  const map = generateWorld(seed);
  const now = Date.now();
  const state: GameState = {
    version: SAVE_VERSION,
    seed,
    map,
    players: new Map(),
    buildings: new Map(),
    convoys: new Map(),
    markets: new Map(),
    companies: new Map(),
    orders: new Map(),
    contracts: new Map(),
    alliances: new Map(),
    events: [],
    season: { index: 1, startedAt: now, endsAt: now + SEASON_MS },
    chat: [],
    priceIndex: 1,
    lastTick: now,
    nextEventAt: now + 90_000,
    worldVolume: {},
  };
  for (const s of map.settlements) state.markets.set(s.id, createMarket(state, s));
  spawnNpcs(state);
  return state;
}

export async function loadState(opts: SaveOptions): Promise<GameState> {
  const target = savePath(opts.dir);
  if (!existsSync(target)) return createFreshState(opts.seed);

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(target, 'utf8'));
  } catch (err) {
    console.error('[persistence] save file unreadable, starting fresh:', err);
    return createFreshState(opts.seed);
  }

  const data = raw as ReturnType<typeof serialize>;
  if (!data || data.version !== SAVE_VERSION) {
    console.warn('[persistence] save version mismatch, starting fresh');
    return createFreshState(opts.seed);
  }

  const state = createFreshState(data.seed ?? opts.seed);
  state.season = data.season ?? state.season;
  state.priceIndex = data.priceIndex ?? 1;
  state.nextEventAt = data.nextEventAt ?? Date.now() + 90_000;
  state.worldVolume = data.worldVolume ?? {};
  state.events = data.events ?? [];
  state.chat = data.chat ?? [];

  // NPCs from the fresh build stay; saved human players are layered on top.
  for (const p of data.players ?? []) state.players.set(p.id, p);
  for (const b of data.buildings ?? []) state.buildings.set(b.id, b);
  for (const c of data.convoys ?? []) state.convoys.set(c.id, c);
  for (const co of data.companies ?? []) state.companies.set(co.id, co);
  for (const o of data.orders ?? []) state.orders.set(o.id, o);
  for (const c of data.contracts ?? []) state.contracts.set(c.id, c);
  for (const a of data.alliances ?? []) state.alliances.set(a.id, a);

  for (const [id, occupied] of data.occupancy ?? []) {
    const s = state.map.settlements.find((x) => x.id === id);
    // Drop plots whose building no longer exists, so counts cannot drift.
    if (s) s.occupied = occupied.filter((bid) => state.buildings.has(bid));
  }

  for (const m of data.markets ?? []) {
    const market = state.markets.get(m.settlementId);
    if (!market) continue;
    market.tariff = m.tariff;
    for (const [k, v] of Object.entries(m.stock ?? {})) {
      const good = market.goods[k as keyof typeof market.goods];
      if (good) good.stock = v as number;
    }
    for (const [k, v] of Object.entries(m.lastPrice ?? {})) {
      const good = market.goods[k as keyof typeof market.goods];
      if (good) good.lastPrice = v as number;
    }
  }

  state.lastTick = Date.now();
  console.log(
    `[persistence] loaded world seed=${state.seed} players=${data.players?.length ?? 0} ` +
    `buildings=${state.buildings.size} season=${state.season.index}`,
  );
  return state;
}
