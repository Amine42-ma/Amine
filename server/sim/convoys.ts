import { VEHICLES } from '../../shared/vehicles.js';
import { COMMODITIES } from '../../shared/commodities.js';
import { SKILLS, skillFactor } from '../../shared/skills.js';
import { staffBonus } from '../../shared/staff.js';
import { clamp, dist, lerp } from '../../shared/util.js';
import type { Convoy, GameState, Player } from '../game/state.js';
import { executeTrade } from './economy.js';
import { modifiersFor } from './events.js';
import { addXp } from './production.js';

/**
 * Convoys are the game's idle engine: you set a route once and it keeps buying
 * low and selling high while you are offline, paying wages and fuel as it goes.
 */

function legEndpoints(state: GameState, c: Convoy) {
  const from = state.map.settlements.find((s) => s.id === c.fromId);
  const to = state.map.settlements.find((s) => s.id === c.toId);
  return { from, to };
}

export function convoySpeed(state: GameState, c: Convoy, owner: Player | undefined): number {
  const def = VEHICLES[c.vehicleId];
  const { from, to } = legEndpoints(state, c);
  const region = (c.phase === 'return' ? from : to)?.region ?? null;
  const mods = modifiersFor(state, region);
  const skill = owner ? skillFactor(owner.skills.shipping.level, SKILLS.shipping.perLevel) : 0;
  const drivers = owner ? staffBonus(owner.staff.driver ?? 0, 0.06) : 0;
  return (def.speed * (1 + skill + drivers)) / Math.max(0.5, mods.travelMul);
}

export function convoyCapacity(state: GameState, vehicleId: keyof typeof VEHICLES, owner: Player): number {
  const skill = skillFactor(owner.skills.shipping.level, SKILLS.shipping.perLevel);
  return Math.floor(VEHICLES[vehicleId].capacity * (1 + skill * 0.8));
}

function routeDistance(state: GameState, c: Convoy): number {
  const { from, to } = legEndpoints(state, c);
  if (!from || !to) return 1;
  return Math.max(1, dist(from.x, from.y, to.x, to.y));
}

function stall(c: Convoy, reason: string) {
  c.stallReason = reason;
  c.phase = 'loading';
  c.progress = 0;
}

function stepOne(state: GameState, c: Convoy, dtMs: number) {
  if (!c.active) return;
  const owner = state.players.get(c.ownerId);
  if (!owner) return;
  const { from, to } = legEndpoints(state, c);
  if (!from || !to) { c.active = false; return; }

  const fromMarket = state.markets.get(c.fromId);
  const toMarket = state.markets.get(c.toId);
  if (!fromMarket || !toMarket) { c.active = false; return; }

  const def = VEHICLES[c.vehicleId];
  const distance = routeDistance(state, c);

  switch (c.phase) {
    case 'loading': {
      const capacity = convoyCapacity(state, c.vehicleId, owner);
      const perUnit = COMMODITIES[c.commodity].weight;
      const units = Math.min(c.quantity, Math.floor(capacity / perUnit));
      if (units <= 0) { stall(c, 'capacity'); c.active = false; return; }

      const probe = executeTrade(state, fromMarket, c.commodity, units, 'buy', owner);
      if (probe.filled < units * 0.5) {
        // Undo the partial purchase: the city simply did not have the goods.
        fromMarket.goods[c.commodity].stock += probe.filled;
        stall(c, 'no_stock');
        return;
      }
      if (probe.total > owner.gold) {
        fromMarket.goods[c.commodity].stock += probe.filled;
        stall(c, 'no_funds');
        return;
      }

      owner.gold -= probe.total;
      owner.windowCost += probe.total;
      c.costBasis = probe.total;
      c.carrying = probe.filled;
      c.stallReason = null;
      c.phase = 'outbound';
      c.progress = 0;
      owner.tradeVolume[c.commodity] = (owner.tradeVolume[c.commodity] ?? 0) + probe.filled;
      state.worldVolume[c.commodity] = (state.worldVolume[c.commodity] ?? 0) + probe.filled;
      break;
    }

    case 'outbound':
    case 'return': {
      const speed = convoySpeed(state, c, owner);
      c.progress += (speed * (dtMs / 1000)) / distance;

      const a = c.phase === 'outbound' ? from : to;
      const b = c.phase === 'outbound' ? to : from;
      c.x = lerp(a.x, b.x, clamp(c.progress, 0, 1));
      c.y = lerp(a.y, b.y, clamp(c.progress, 0, 1));

      if (c.progress >= 1) {
        c.progress = 0;
        const travelCost = def.costPerTile * distance;
        owner.gold -= travelCost;
        owner.windowCost += travelCost;

        if (c.phase === 'outbound') {
          applyRoadRisk(state, c, owner, b.region);
          c.phase = 'unloading';
        } else {
          c.phase = c.autoRepeat ? 'loading' : 'loading';
          if (!c.autoRepeat) c.active = false;
        }
      }
      break;
    }

    case 'unloading': {
      const sale = executeTrade(state, toMarket, c.commodity, c.carrying, 'sell', owner);
      owner.gold += sale.total;
      owner.windowRevenue += sale.total;
      const profit = sale.total - c.costBasis - def.costPerTile * distance;
      c.lastProfit = profit;
      c.totalProfit += profit;
      c.carrying = 0;
      c.costBasis = 0;
      c.phase = 'return';
      c.progress = 0;
      owner.tradeVolume[c.commodity] = (owner.tradeVolume[c.commodity] ?? 0) + sale.filled;
      state.worldVolume[c.commodity] = (state.worldVolume[c.commodity] ?? 0) + sale.filled;
      addXp(owner, 'shipping', Math.max(0, profit) / 400 + 2);
      addXp(owner, 'trade', Math.max(0, profit) / 900);
      break;
    }
  }
}

/** Storms and earthquakes eat cargo; guards cut the loss. */
function applyRoadRisk(state: GameState, c: Convoy, owner: Player, region: string) {
  const mods = modifiersFor(state, region);
  if (mods.risk <= 0 || c.carrying <= 0) return;
  const guards = staffBonus(owner.staff.guard ?? 0, 0.09);
  const chance = mods.risk * (1 - guards);
  if (Math.random() < chance) {
    const lost = c.carrying * (0.2 + Math.random() * 0.4);
    c.carrying -= lost;
    c.costBasis *= c.carrying / Math.max(0.0001, c.carrying + lost);
  }
}

export function stepConvoys(state: GameState, dtMs: number) {
  for (const c of state.convoys.values()) {
    // A stalled convoy retries on the next tick rather than dying outright.
    stepOne(state, c, dtMs);
  }
}
