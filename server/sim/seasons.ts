import { SEASON_MS, STARTING_GOLD, PAYROLL_INTERVAL_MS } from '../../shared/constants.js';
import { newId } from '../../shared/util.js';
import type { GameState } from '../game/state.js';
import { createMarket } from './economy.js';
import { netWorth } from './bank.js';
import { grant } from '../game/achievements.js';
import { spawnNpcs, NPC_COUNT } from './ai.js';
import { startingSettlement } from '../game/rules.js';

/**
 * A season is a full economic reset. Gold, property and companies are wiped so
 * newcomers can compete, while achievements, prestige and skill levels persist —
 * the things a player earned by playing well, rather than by playing early.
 */

export function shouldRollSeason(state: GameState, now = Date.now()): boolean {
  return now >= state.season.endsAt;
}

export function rollSeason(state: GameState, now = Date.now()) {
  // The season's champion earns the emperor badge before anything is wiped.
  let bestId: string | null = null;
  let bestWorth = -1;
  for (const p of state.players.values()) {
    if (p.isNpc) continue;
    const worth = netWorth(state, p);
    if (worth > bestWorth) { bestWorth = worth; bestId = p.id; }
  }
  if (bestId) {
    const champ = state.players.get(bestId);
    if (champ) grant(champ, 'economy_emperor');
  }

  // Prestige is the permanent record of how big an empire got.
  for (const p of state.players.values()) {
    if (p.isNpc) continue;
    p.prestige += Math.floor(Math.sqrt(Math.max(0, netWorth(state, p))) / 40);
  }

  state.buildings.clear();
  state.convoys.clear();
  state.companies.clear();
  state.orders.clear();
  state.events.length = 0;
  state.priceIndex = 1;
  state.worldVolume = {};

  for (const s of state.map.settlements) s.occupied = [];

  // NPCs are respawned fresh so the new season starts with a clean field.
  for (const [id, p] of [...state.players.entries()]) {
    if (p.isNpc) state.players.delete(id);
  }

  for (const p of state.players.values()) {
    const start = startingSettlement(state);
    p.gold = STARTING_GOLD;
    p.bank = 0;
    p.creditScore = 600;
    p.inventory = {};
    p.staff = {};
    p.buildings = [];
    p.convoys = [];
    p.loans = [];
    p.companyId = null;
    p.shares = {};
    p.fleet = { cart: 1 };
    p.vehicle = 'cart';
    p.tradeVolume = {};
    p.windowRevenue = 0;
    p.windowCost = 0;
    p.lastProfit = 0;
    p.visited = [];
    p.x = start.x;
    p.y = start.y;
    p.nextPayrollAt = now + PAYROLL_INTERVAL_MS;
    p.lastPayrollCost = 0;
  }

  state.markets.clear();
  for (const s of state.map.settlements) state.markets.set(s.id, createMarket(state, s));

  spawnNpcs(state, NPC_COUNT);

  state.season = { index: state.season.index + 1, startedAt: now, endsAt: now + SEASON_MS };
  state.chat.push({
    id: newId('m'),
    from: 'العالم',
    text: `بدأ الموسم ${state.season.index}! تمت إعادة ضبط الاقتصاد، والإنجازات محفوظة.`,
    at: now,
    channel: 'system',
  });
}
