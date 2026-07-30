import {
  COMMODITIES, COMMODITY_IDS, type CommodityId,
} from '../../shared/commodities.js';
import {
  MIN_PRICE_RATIO, MAX_PRICE_RATIO,
  WORLD_TRADE_RATE, ANCHOR_MINUTES, MIN_MARKET_DEPTH, ECONOMY_SCALE, BASE_SPREAD,
} from '../../shared/constants.js';
import { SKILLS, skillFactor } from '../../shared/skills.js';
import { staffBonus } from '../../shared/staff.js';
import { clamp, dist } from '../../shared/util.js';
import { curveExponent, priceFactor, slicesFor } from '../../shared/pricing.js';
import type { GameState, Market, MarketStock, Player } from '../game/state.js';
import type { Settlement } from '../world/generate.js';
import { modifiersFor, type EventModifiers } from './events.js';

/**
 * Prices are never authored: each settlement holds a *stock* of every good and
 * the price is a function of how far that stock sits from the local baseline.
 * Everything else in the game — production, convoys, NPCs, world events — moves
 * stock, and prices follow.
 */

/** Which goods a settlement produces natively, given its terrain and kind. */
function nativeProfile(s: Settlement, terrainAround: Record<string, number>): Partial<Record<CommodityId, number>> {
  const p: Partial<Record<CommodityId, number>> = {};
  const add = (id: CommodityId, amount: number) => { p[id] = (p[id] ?? 0) + amount; };

  const forest = terrainAround.forest ?? 0;
  const mountain = terrainAround.mountain ?? 0;
  const desert = terrainAround.desert ?? 0;
  const grass = terrainAround.grass ?? 0;
  const water = terrainAround.water ?? 0;

  // Coefficients are deliberately generous: a region that has the terrain for a
  // good must run a real surplus, or its price never falls below the world base
  // and there is nothing to arbitrage.
  add('wood', 1 + forest * 22);
  add('iron', mountain * 14);
  add('coal', mountain * 16);
  add('gold', mountain * 1.5);
  add('diamond', mountain * 0.85 + desert * 0.5);
  add('salt', desert * 13);
  add('oil', desert * 4.4 + water * 1.9);
  add('wheat', grass * 20);
  add('cotton', grass * 9);
  add('sugar', grass * 6.5 + forest * 4);
  add('livestock', grass * 5);
  add('fish', water * 19);

  if (s.kind === 'city') {
    // Cities are where refining happens, so they trickle out finished goods.
    add('steel', 3.2); add('cloth', 3.0); add('leather', 1.9);
    add('clothes', 1.2); add('medicine', 0.9); add('fuel', 1.1);
    add('electronics', 0.45); add('jewelry', 0.14); add('cars', 0.1);
  } else if (s.kind === 'port') {
    add('fish', 14); add('salt', 6); add('cloth', 1.4); add('fuel', 0.9);
  } else if (s.kind === 'island') {
    add('sugar', 9); add('fish', 16); add('diamond', 0.35);
  }
  return p;
}

const mixCache = new Map<string, Record<string, number>>();

/** Cached terrain mix around a settlement; drives both prices and extractor yields. */
export function settlementTerrain(state: GameState, s: Settlement): Record<string, number> {
  const key = `${state.seed}:${s.id}`;
  let cached = mixCache.get(key);
  if (!cached) {
    cached = terrainMix(state, s);
    mixCache.set(key, cached);
  }
  return cached;
}

/** Samples terrain in a radius around a settlement to work out what it can produce. */
function terrainMix(state: GameState, s: Settlement, radius = 14): Record<string, number> {
  const { tiles, width, height } = state.map;
  const names = ['water', 'sand', 'grass', 'forest', 'desert', 'mountain', 'road'];
  const counts: Record<string, number> = {};
  let total = 0;
  for (let dy = -radius; dy <= radius; dy += 2) {
    for (let dx = -radius; dx <= radius; dx += 2) {
      const x = s.x + dx;
      const y = s.y + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (dx * dx + dy * dy > radius * radius) continue;
      const name = names[tiles[y * width + x]];
      counts[name] = (counts[name] ?? 0) + 1;
      total++;
    }
  }
  if (total > 0) for (const k of Object.keys(counts)) counts[k] /= total;
  return counts;
}

export function createMarket(state: GameState, s: Settlement): Market {
  const mix = settlementTerrain(state, s);
  const native = nativeProfile(s, mix);
  const popScale = s.population / 8000;

  const goods = {} as Record<CommodityId, MarketStock>;
  for (const id of COMMODITY_IDS) {
    const def = COMMODITIES[id];
    // Production scales with the same factor as demand, so the price a region
    // settles at depends only on its surplus ratio, not on the world's size.
    const production = (native[id] ?? 0) * ECONOMY_SCALE * popScale;
    // Everyone eats; only wealthy places buy jewelry.
    const appetite =
      def.category === 'food' ? 6.5
      : def.category === 'raw' ? 3.0
      : def.category === 'refined' ? 2.2
      : def.category === 'industrial' ? 1.6
      : 0.22;
    const tierDamp = 1 / (1 + def.tier * 0.6);
    const consumption = Math.max(
      0.05,
      appetite * ECONOMY_SCALE * tierDamp * popScale * (s.kind === 'city' ? 1.4 : 1),
    );
    const k = curveExponent(id);
    const ratio = equilibriumRatio(production, consumption);
    // Raise the anchor until the *equilibrium stock* clears the depth floor.
    // Scarce goods sit far below their anchor, so flooring the anchor alone
    // would leave them with almost nothing on the shelf.
    const anchor = Math.max(
      consumption * ANCHOR_MINUTES,
      MIN_MARKET_DEPTH * Math.pow(ratio, 1 / k),
    );

    goods[id] = {
      // Start each market already at its equilibrium so prices are dispersed
      // from the very first tick instead of converging out of a flat start.
      stock: equilibriumStock(anchor, production, consumption, k),
      anchor,
      consumption,
      production,
      lastPrice: def.basePrice,
    };
    goods[id].lastPrice = def.basePrice * priceRatio(goods[id], id);
  }

  const tariff = s.kind === 'city' ? 0.05 : s.kind === 'port' ? 0.03 : s.kind === 'island' ? 0.08 : 0.02;
  return { settlementId: s.id, goods, tariff };
}

/** Price as a multiple of the world base price, from stock alone. */
function priceRatio(g: MarketStock, id: CommodityId): number {
  return priceFactor(g.anchor, g.stock, curveExponent(id));
}

/**
 * The price a settlement settles at once local production, local consumption and
 * off-map trade balance. A place that produces twice what it eats lands well
 * below the world base price; one that produces none lands well above. That gap
 * between towns is the entire reason to move goods.
 */
export function equilibriumRatio(production: number, consumption: number): number {
  const throughput = Math.max(0.0001, consumption + production);
  return clamp(
    1 + (consumption - production) / (throughput * WORLD_TRADE_RATE),
    MIN_PRICE_RATIO,
    MAX_PRICE_RATIO,
  );
}

/** The stock level corresponding to that equilibrium price. */
function equilibriumStock(anchor: number, production: number, consumption: number, k: number): number {
  return Math.max(1, anchor * Math.pow(equilibriumRatio(production, consumption), -1 / k));
}

/** The unmodified mid price of one unit at the market's current stock level. */
export function midPrice(g: MarketStock, id: CommodityId, mods: EventModifiers, priceIndex: number): number {
  const def = COMMODITIES[id];
  // Demand pressure from events shows up in price directly, not just in stock drain.
  const demandMul = mods.demand[id] ?? 1;
  return def.basePrice * priceRatio(g, id) * mods.priceMul * priceIndex * Math.pow(demandMul, 0.45);
}

/** Effective spread for a player, tightened by negotiation skill and junior traders. */
export function spreadFor(player: Player | null): number {
  if (!player) return BASE_SPREAD;
  const skill = skillFactor(player.skills.negotiation.level, SKILLS.negotiation.perLevel);
  const staff = staffBonus(player.staff.trader ?? 0, 0.02);
  return BASE_SPREAD * clamp(1 - skill - staff, 0.25, 1);
}

/** Import duty after the international-trade skill discount. */
export function tariffFor(market: Market, player: Player | null, s: Settlement): number {
  if (!player) return market.tariff;
  const skill = skillFactor(player.skills.trade.level, SKILLS.trade.perLevel);
  // Distance from a player's own territory is what tariffs really punish.
  const far = clamp(dist(player.x, player.y, s.x, s.y) / 200, 0, 1);
  return market.tariff * (1 + far * 0.6) * clamp(1 - skill, 0.2, 1);
}

export interface Quote {
  buy: number;
  sell: number;
  mid: number;
}

export function quote(
  state: GameState,
  market: Market,
  id: CommodityId,
  player: Player | null,
): Quote {
  const s = state.map.settlements.find((x) => x.id === market.settlementId)!;
  const mods = modifiersFor(state, s.region);
  const mid = midPrice(market.goods[id], id, mods, state.priceIndex);
  const spread = spreadFor(player);
  const tariff = tariffFor(market, player, s);
  return {
    mid,
    buy: mid * (1 + spread + tariff),
    sell: mid * (1 - spread),
  };
}

/**
 * Walks the price curve in slices so a large order pays progressively worse
 * prices — this is what makes cornering a market expensive and arbitrage finite.
 */
export function executeTrade(
  state: GameState,
  market: Market,
  id: CommodityId,
  quantity: number,
  side: 'buy' | 'sell',
  player: Player | null,
): { total: number; average: number; filled: number } {
  const g = market.goods[id];
  const s = state.map.settlements.find((x) => x.id === market.settlementId)!;
  const mods = modifiersFor(state, s.region);
  const spread = spreadFor(player);
  const tariff = side === 'buy' ? tariffFor(market, player, s) : 0;

  // Identical slicing to shared/pricing.ts, so the client's preview of this
  // order and the server's execution of it cannot drift apart.
  const slices = slicesFor(quantity);
  const per = quantity / slices;
  let total = 0;
  let filled = 0;

  for (let i = 0; i < slices; i++) {
    if (side === 'buy' && g.stock - per < 1) break;
    const mid = midPrice(g, id, mods, state.priceIndex);
    const unit = side === 'buy' ? mid * (1 + spread + tariff) : mid * (1 - spread);
    total += unit * per;
    filled += per;
    g.stock = Math.max(1, g.stock + (side === 'buy' ? -per : per));
  }

  if (filled > 0) g.lastPrice = total / filled;
  return { total, average: filled > 0 ? total / filled : 0, filled };
}

/**
 * One economic tick: settlements produce and consume, stocks drift back toward
 * their baseline, and the global price index breathes.
 */
export function stepEconomy(state: GameState, dtMs: number) {
  const minutes = dtMs / 60_000;
  for (const s of state.map.settlements) {
    const market = state.markets.get(s.id);
    if (!market) continue;
    const mods = modifiersFor(state, s.region);

    for (const id of COMMODITY_IDS) {
      const g = market.goods[id];
      const supplyMul = mods.supply[id] ?? 1;
      const demandMul = mods.demand[id] ?? 1;

      const produced = g.production * supplyMul * minutes;
      // Consumption tapers when shelves are empty — you cannot eat what is not there.
      const scarcity = clamp(g.stock / Math.max(1, g.anchor * 0.35), 0, 1);
      const consumed = g.consumption * demandMul * minutes * scarcity;

      // Caravans from off-map: they arrive where prices are high and leave where
      // they are low, which is what stops any single market running away forever.
      // Scaled by throughput rather than depth, so deep markets stay just as
      // price-responsive as thin ones.
      const throughput = g.consumption + g.production;
      const flow = throughput * WORLD_TRADE_RATE * (priceRatio(g, id) - 1) * minutes;

      g.stock = clamp(g.stock + produced - consumed + flow, 1, g.anchor * 12);
    }
  }

  // The price index drifts gently and mean-reverts to 1, so seasons stay comparable.
  const drift = (Math.random() - 0.5) * 0.0009 * minutes * 60;
  state.priceIndex = clamp(state.priceIndex + drift + (1 - state.priceIndex) * 0.002 * minutes * 60, 0.6, 1.7);
}

/** Average price of a good across every market — used for the world price ticker. */
export function worldAverage(state: GameState, id: CommodityId): number {
  let sum = 0;
  let n = 0;
  for (const m of state.markets.values()) {
    sum += m.goods[id].lastPrice;
    n++;
  }
  return n > 0 ? sum / n : COMMODITIES[id].basePrice;
}
