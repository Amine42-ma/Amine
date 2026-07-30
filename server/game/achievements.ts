import { ACHIEVEMENT_BY_ID } from '../../shared/achievements.js';
import { BUILDINGS } from '../../shared/buildings.js';
import { COMMODITY_IDS } from '../../shared/commodities.js';
import type { GameState, Player } from './state.js';
import { netWorth } from '../sim/bank.js';
import { isCrisisActive } from '../sim/events.js';

/** Grants an achievement once, awarding its prestige. Returns true if newly earned. */
export function grant(player: Player, id: string): boolean {
  if (player.isNpc) return false;
  if (player.achievements.includes(id)) return false;
  const def = ACHIEVEMENT_BY_ID[id];
  if (!def) return false;
  player.achievements.push(id);
  player.prestige += def.prestige;
  return true;
}

function countBuildings(state: GameState, p: Player, kind: string): number {
  let n = 0;
  for (const bid of p.buildings) {
    const b = state.buildings.get(bid);
    if (b && BUILDINGS[b.defId]?.kind === kind) n++;
  }
  return n;
}

function fleetSize(p: Player): number {
  let n = 0;
  for (const v of Object.values(p.fleet)) n += v ?? 0;
  return n;
}

/** Re-evaluates every condition-based achievement for one player. */
export function checkAchievements(state: GameState, p: Player): string[] {
  if (p.isNpc) return [];
  const earned: string[] = [];
  const worth = netWorth(state, p);

  const add = (id: string, condition: boolean) => {
    if (condition && grant(p, id)) earned.push(id);
  };

  add('first_10k', worth >= 10_000);
  add('first_million', worth >= 1_000_000);
  add('trade_king', worth >= 50_000_000);
  add('first_shop', countBuildings(state, p, 'shop') >= 1);
  add('first_factory', countBuildings(state, p, 'factory') >= 1);
  add('industrialist', countBuildings(state, p, 'factory') >= 5);
  add('first_convoy', p.convoys.length >= 1);
  add('biggest_fleet', fleetSize(p) >= 10);
  add('incorporated', p.companyId !== null);
  add('shareholder', Object.keys(p.shares).some((id) => state.companies.get(id)?.ownerId !== p.id));
  add('globetrotter', p.visited.length >= 10);

  // Monopoly: 40% of all world volume in a single good.
  for (const id of COMMODITY_IDS) {
    const world = state.worldVolume[id] ?? 0;
    const mine = p.tradeVolume[id] ?? 0;
    if (world > 4000 && mine / world >= 0.4) {
      add('monopolist', true);
      break;
    }
  }

  if (p.companyId) {
    const mine = state.companies.get(p.companyId);
    if (mine) {
      let top = true;
      for (const co of state.companies.values()) {
        if (co.id !== mine.id && co.valuation > mine.valuation) { top = false; break; }
      }
      add('biggest_company', top && state.companies.size >= 2);
    }
  }

  add('survivor', isCrisisActive(state) && p.lastProfit > 0);

  return earned;
}
