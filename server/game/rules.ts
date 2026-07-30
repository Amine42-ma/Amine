import type { WorkerId } from '../../shared/staff.js';
import type { GameState, Player } from './state.js';

/** Shared rules that both the command layer and the view layer need. */

/** Plot prices rise steeply as a settlement fills up — prime land is finite. */
export function plotPriceFor(plots: number, used: number, kind: string): number {
  const base = kind === 'city' ? 4_000 : kind === 'port' ? 3_200 : kind === 'island' ? 5_000 : 1_800;
  const scarcity = Math.pow(1 / Math.max(0.06, 1 - used / plots), 1.35);
  return Math.round(base * scarcity);
}

/**
 * Where a new (or newly reset) merchant starts. Never an island: a starting cart
 * cannot cross water, so an island spawn would strand the player permanently.
 */
export function startingSettlement(state: GameState) {
  const mainland = state.map.settlements.filter((s) => s.kind !== 'island');
  const pool = mainland.length > 0 ? mainland : state.map.settlements;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** How many of a worker type the player has already posted to buildings. */
export function totalAssigned(state: GameState, player: Player, worker: WorkerId): number {
  let n = 0;
  for (const bid of player.buildings) {
    const b = state.buildings.get(bid);
    if (b) n += b.workers[worker] ?? 0;
  }
  return n;
}
