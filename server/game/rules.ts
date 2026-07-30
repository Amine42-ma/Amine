import type { WorkerId } from '../../shared/staff.js';
import type { GameState, Player } from './state.js';

/** Shared rules that both the command layer and the view layer need. */

/** Plot prices rise steeply as a settlement fills up — prime land is finite. */
export function plotPriceFor(plots: number, used: number, kind: string): number {
  const base = kind === 'city' ? 4_000 : kind === 'port' ? 3_200 : kind === 'island' ? 5_000 : 1_800;
  const scarcity = Math.pow(1 / Math.max(0.06, 1 - used / plots), 1.35);
  return Math.round(base * scarcity);
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
