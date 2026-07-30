import { SEASON_MS } from '../../shared/constants.js';
import type { GameState } from './state.js';
import { generateWorld } from '../world/generate.js';
import { createMarket } from '../sim/economy.js';
import { spawnNpcs } from '../sim/ai.js';

/** Save-format version. Bumped whenever the snapshot shape changes. */
export const SAVE_VERSION = 1;

/**
 * Builds a brand-new world from a seed. Deliberately free of Node imports so the
 * single-file browser build can stand up its own world with the same code the
 * dedicated server uses.
 */
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
