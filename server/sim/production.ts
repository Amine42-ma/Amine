import { BUILDINGS, type BuildingDef } from '../../shared/buildings.js';
import { COMMODITIES, type CommodityId } from '../../shared/commodities.js';
import { SKILLS, skillFactor } from '../../shared/skills.js';
import { staffBonus } from '../../shared/staff.js';
import { clamp } from '../../shared/util.js';
import type { GameState, OwnedBuilding, Player } from '../game/state.js';
import { modifiersFor } from './events.js';
import { midPrice, settlementTerrain } from './economy.js';

/** Per-building storage ceiling, so a factory cannot become an infinite warehouse. */
export const BUILDING_STORAGE = 600;

/** How much of a good the surrounding land can supply, 0..1.6. */
function richness(state: GameState, building: OwnedBuilding, def: BuildingDef): number {
  const s = state.map.settlements.find((x) => x.id === building.settlementId);
  if (!s || !def.terrain) return 1;
  const mix = settlementTerrain(state, s);
  let best = 0;
  for (const t of def.terrain) best = Math.max(best, mix[t] ?? 0);
  // A camp on marginal land still runs, just slowly.
  return clamp(0.25 + best * 2.6, 0.25, 1.6);
}

function speedMultiplier(state: GameState, b: OwnedBuilding, owner: Player | undefined): number {
  const labor = staffBonus(b.workers.laborer ?? 0, 0.08);
  const mgmt = owner ? skillFactor(owner.skills.management.level, SKILLS.management.perLevel) * 0.5 : 0;
  return 1 + labor + mgmt;
}

function storageUsed(b: OwnedBuilding): number {
  let n = 0;
  for (const v of Object.values(b.storage)) n += v ?? 0;
  return n;
}

/** Runs one production cycle pass for an extractor or factory. */
function stepProducer(
  state: GameState,
  b: OwnedBuilding,
  def: BuildingDef,
  owner: Player | undefined,
  dtMs: number,
) {
  if (!def.recipe) return;
  const s = state.map.settlements.find((x) => x.id === b.settlementId);
  const mods = modifiersFor(state, s?.region ?? null);

  const speed = speedMultiplier(state, b, owner);
  const rich = def.kind === 'extractor' ? richness(state, b, def) : 1;
  b.cycleMs += dtMs * speed * rich;

  const cycleLength = def.recipe.seconds * 1000;
  let cycles = Math.floor(b.cycleMs / cycleLength);
  if (cycles <= 0) return;
  // Cap catch-up so a player returning after a week does not resolve 10k cycles at once.
  cycles = Math.min(cycles, 2000);
  b.cycleMs -= cycles * cycleLength;

  for (let i = 0; i < cycles; i++) {
    // Inputs must all be present or the line stops.
    let canRun = true;
    for (const [k, need] of Object.entries(def.recipe.inputs)) {
      if ((b.storage[k as CommodityId] ?? 0) < (need as number)) { canRun = false; break; }
    }
    if (!canRun) { b.cycleMs = Math.min(b.cycleMs, cycleLength); break; }
    if (storageUsed(b) >= BUILDING_STORAGE) { b.cycleMs = 0; break; }

    for (const [k, need] of Object.entries(def.recipe.inputs)) {
      const id = k as CommodityId;
      b.storage[id] = (b.storage[id] ?? 0) - (need as number);
    }
    for (const [k, made] of Object.entries(def.recipe.outputs)) {
      const id = k as CommodityId;
      // World events that choke supply hit extraction at the source too.
      const yieldMul = def.kind === 'extractor' ? (mods.supply[id] ?? 1) : 1;
      b.storage[id] = (b.storage[id] ?? 0) + (made as number) * yieldMul;
    }
  }
}

/**
 * How many units a shop *wants* to move per minute, before competition. Raising
 * your markup earns more per unit but pulls fewer customers through the door —
 * that trade-off is the whole of retail strategy.
 */
function shopPull(state: GameState, b: OwnedBuilding, def: BuildingDef, owner: Player): number {
  const marketing = skillFactor(owner.skills.marketing.level, SKILLS.marketing.perLevel);
  const clerks = staffBonus(b.workers.laborer ?? 0, 0.06);
  const chainBonus = ownerHasChain(state, owner, b.settlementId) ? 0.25 : 0;
  const resistance = clamp(1.25 - b.retailMarkup * 0.85, 0.12, 1.25);
  return (def.salesRate ?? 0) * (1 + marketing + clerks + chainBonus) * resistance;
}

/** Shoppers a settlement can supply per minute — the pool every shop fights over. */
function retailPool(population: number, kind: string): number {
  const scale = population / 8000;
  return scale * (kind === 'city' ? 150 : kind === 'port' ? 95 : kind === 'island' ? 45 : 60);
}

/**
 * Runs retail for one settlement. Shops share a finite customer pool, so opening
 * a mall next to a rival's mall genuinely takes their sales — and undercutting
 * on markup is how you win the share back.
 */
function stepRetail(state: GameState, settlementId: string, shops: OwnedBuilding[], dtMs: number) {
  const market = state.markets.get(settlementId);
  const s = state.map.settlements.find((x) => x.id === settlementId);
  if (!market || !s) return;

  const mods = modifiersFor(state, s.region);
  const minutes = dtMs / 60_000;

  const entries: { b: OwnedBuilding; owner: Player; pull: number }[] = [];
  let totalPull = 0;
  for (const b of shops) {
    const def = BUILDINGS[b.defId];
    const owner = state.players.get(b.ownerId);
    if (!def || !owner) continue;
    const pull = shopPull(state, b, def, owner);
    if (pull <= 0) continue;
    entries.push({ b, owner, pull });
    totalPull += pull;
  }
  if (entries.length === 0) return;

  const pool = retailPool(s.population, s.kind);
  // Demand is finite: when the town is over-shopped, everyone's throughput falls.
  const contention = totalPull > pool ? pool / totalPull : 1;

  for (const { b, owner, pull } of entries) {
    const perMinute = pull * contention;
    let revenue = 0;

    for (const key of Object.keys(b.storage)) {
      const id = key as CommodityId;
      const held = b.storage[id] ?? 0;
      if (held <= 0) continue;

      const g = market.goods[id];
      const demandMul = mods.demand[id] ?? 1;
      const want = perMinute * minutes * clamp(demandMul, 0.3, 3) * shareOfShelf(b, id);
      const sold = Math.min(held, want);
      if (sold <= 0.001) continue;

      const unit = midPrice(g, id, mods, state.priceIndex) * (1 + b.retailMarkup);
      revenue += unit * sold;
      b.storage[id] = held - sold;
      // Retailing releases the goods into the town, which softens the local price.
      g.stock += sold * 0.8;
      owner.tradeVolume[id] = (owner.tradeVolume[id] ?? 0) + sold;
      state.worldVolume[id] = (state.worldVolume[id] ?? 0) + sold;
    }

    if (revenue > 0) {
      owner.gold += revenue;
      owner.windowRevenue += revenue;
      b.lastRevenue = revenue;
      b.totalRevenue += revenue;
      addXp(owner, 'marketing', revenue / 220);
    } else {
      b.lastRevenue = 0;
    }
  }
}

/** Splits the shop's throughput across the different goods it is holding. */
function shareOfShelf(b: OwnedBuilding, id: CommodityId): number {
  let lines = 0;
  for (const key of Object.keys(b.storage)) if ((b.storage[key as CommodityId] ?? 0) > 0) lines++;
  if (lines <= 1) return 1;
  // Valuable goods get more shelf space; it keeps big-ticket items worth stocking.
  return (1 / lines) * clamp(1 + Math.log10(COMMODITIES[id].basePrice) / 6, 0.7, 1.6);
}

function ownerHasChain(state: GameState, owner: Player, settlementId: string): boolean {
  for (const id of owner.buildings) {
    const b = state.buildings.get(id);
    if (!b || b.settlementId !== settlementId) continue;
    if (b.defId === 'chain_hq' || b.defId === 'global_corp') return true;
  }
  return false;
}

export function addXp(player: Player, skill: keyof typeof SKILLS, amount: number) {
  if (!(amount > 0) || player.isNpc) return;
  const s = player.skills[skill];
  s.xp += amount;
  let level = s.level;
  while (level < 30 && s.xp >= Math.round(120 * Math.pow(level + 1, 1.85))) level++;
  s.level = level;
}

/** Advances every building in the world by `dtMs`. */
export function stepProduction(state: GameState, dtMs: number) {
  // Shops are batched by settlement so they can compete for the same customers.
  const shopsBySettlement = new Map<string, OwnedBuilding[]>();

  for (const b of state.buildings.values()) {
    if (!b.active) continue;
    const def = BUILDINGS[b.defId];
    if (!def) continue;
    if (def.kind === 'shop') {
      const list = shopsBySettlement.get(b.settlementId);
      if (list) list.push(b);
      else shopsBySettlement.set(b.settlementId, [b]);
    } else if (def.recipe) {
      stepProducer(state, b, def, state.players.get(b.ownerId), dtMs);
    }
  }

  for (const [settlementId, shops] of shopsBySettlement) {
    stepRetail(state, settlementId, shops, dtMs);
  }
}

/** Total cargo capacity a player has unlocked through warehouses and ports. */
export function storageCapacity(state: GameState, player: Player): number {
  let extra = 0;
  for (const id of player.buildings) {
    const b = state.buildings.get(id);
    if (!b) continue;
    const def = BUILDINGS[b.defId];
    if (def?.capacity) extra += def.capacity;
  }
  return extra;
}

/** How many simultaneous convoy routes the player may run. */
export function convoySlots(state: GameState, player: Player): number {
  let slots = 1;
  for (const id of player.buildings) {
    const b = state.buildings.get(id);
    if (!b) continue;
    const def = BUILDINGS[b.defId];
    if (def?.convoySlots) slots += def.convoySlots;
  }
  const shipping = skillFactor(player.skills.shipping.level, SKILLS.shipping.perLevel);
  return slots + Math.floor(shipping * 6);
}
