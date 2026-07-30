import type { GameState } from '../../server/game/state.js';
import { createFreshState, SAVE_VERSION } from '../../server/game/bootstrap.js';

/**
 * Browser-side persistence for the single-file build. Same idea as the server's
 * JSON snapshot: terrain is regenerated from the seed rather than stored, so a
 * whole world fits comfortably in localStorage.
 */

const KEY = 'eom.world';

interface Snapshot {
  version: number;
  seed: number;
  savedAt: number;
  season: GameState['season'];
  priceIndex: number;
  nextEventAt: number;
  worldVolume: GameState['worldVolume'];
  events: GameState['events'];
  chat: GameState['chat'];
  occupancy: [string, string[]][];
  players: unknown[];
  buildings: unknown[];
  convoys: unknown[];
  companies: unknown[];
  orders: unknown[];
  contracts: unknown[];
  alliances: unknown[];
  markets: { settlementId: string; tariff: number; stock: Record<string, number> }[];
}

export function saveSnapshot(state: GameState) {
  const snapshot: Snapshot = {
    version: SAVE_VERSION,
    seed: state.seed,
    savedAt: Date.now(),
    season: state.season,
    priceIndex: state.priceIndex,
    nextEventAt: state.nextEventAt,
    worldVolume: state.worldVolume,
    events: state.events,
    chat: state.chat.slice(-40),
    occupancy: state.map.settlements.map((s) => [s.id, s.occupied]),
    // NPCs are respawned from the seed, so only real players need storing.
    players: [...state.players.values()].filter((p) => !p.isNpc),
    buildings: [...state.buildings.values()].filter((b) => !state.players.get(b.ownerId)?.isNpc),
    convoys: [...state.convoys.values()].filter((c) => !state.players.get(c.ownerId)?.isNpc),
    companies: [...state.companies.values()],
    orders: [...state.orders.values()],
    contracts: [...state.contracts.values()],
    alliances: [...state.alliances.values()],
    markets: [...state.markets.values()].map((m) => ({
      settlementId: m.settlementId,
      tariff: m.tariff,
      stock: Object.fromEntries(
        Object.entries(m.goods).map(([k, v]) => [k, Math.round(v.stock * 10) / 10]),
      ),
    })),
  };

  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch (err) {
    // A full or disabled localStorage must not interrupt play.
    console.warn('[storage] could not save the world', err);
  }
}

export function loadSnapshot(seed: number): GameState | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let data: Snapshot;
  try {
    data = JSON.parse(raw) as Snapshot;
  } catch {
    console.warn('[storage] saved world unreadable, starting fresh');
    return null;
  }
  if (!data || data.version !== SAVE_VERSION) return null;

  const state = createFreshState(data.seed ?? seed);
  state.season = data.season ?? state.season;
  state.priceIndex = data.priceIndex ?? 1;
  state.nextEventAt = data.nextEventAt ?? Date.now() + 90_000;
  state.worldVolume = data.worldVolume ?? {};
  state.events = data.events ?? [];
  state.chat = data.chat ?? [];

  for (const p of data.players ?? []) state.players.set((p as { id: string }).id, p as never);
  for (const b of data.buildings ?? []) state.buildings.set((b as { id: string }).id, b as never);
  for (const c of data.convoys ?? []) state.convoys.set((c as { id: string }).id, c as never);
  for (const co of data.companies ?? []) state.companies.set((co as { id: string }).id, co as never);
  for (const o of data.orders ?? []) state.orders.set((o as { id: string }).id, o as never);
  for (const k of data.contracts ?? []) state.contracts.set((k as { id: string }).id, k as never);
  for (const a of data.alliances ?? []) state.alliances.set((a as { id: string }).id, a as never);

  for (const [id, occupied] of data.occupancy ?? []) {
    const s = state.map.settlements.find((x) => x.id === id);
    if (s) s.occupied = occupied.filter((bid) => state.buildings.has(bid));
  }

  for (const m of data.markets ?? []) {
    const market = state.markets.get(m.settlementId);
    if (!market) continue;
    market.tariff = m.tariff;
    for (const [k, v] of Object.entries(m.stock ?? {})) {
      const good = market.goods[k as keyof typeof market.goods];
      if (good) good.stock = v;
    }
  }

  state.lastTick = Date.now();
  return state;
}

export function clearSnapshot() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing we can do, and nothing that should break play */
  }
}
