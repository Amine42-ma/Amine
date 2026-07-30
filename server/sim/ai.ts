import { COMMODITIES, COMMODITY_IDS, type CommodityId } from '../../shared/commodities.js';
import { BUILDINGS } from '../../shared/buildings.js';
import { clamp, dist, mulberry32, newId, pick } from '../../shared/util.js';
import type { GameState, NpcBrain, Player } from '../game/state.js';
import { executeTrade, quote } from './economy.js';
import { makePlayer } from '../game/player.js';

/**
 * NPC merchants are the economy's shock absorbers. They hunt arbitrage the same
 * way a player does, which means they quietly drain overpriced cities and refill
 * starved ones — and they compete with you for the good routes.
 */

export const NPC_COUNT = 48;

const NPC_FIRST = ['حسن', 'زياد', 'مروان', 'سلمى', 'نور', 'فارس', 'ريم', 'أنس', 'ليان', 'بشير',
  'Kaito', 'Dmitri', 'Elena', 'Marco', 'Sofia', 'Rashid', 'Tariq', 'Yara', 'Omar', 'Layla'];
const NPC_LAST = ['التاجر', 'البحري', 'القافلة', 'الأمين', 'الجريء',
  'Trader', 'Voss', 'Rossi', 'Kane', 'Sable'];

export function spawnNpcs(state: GameState, count = NPC_COUNT) {
  const rng = mulberry32(state.seed ^ 0x5eed);
  for (let i = 0; i < count; i++) {
    const s = pick(rng, state.map.settlements);
    const name = `${pick(rng, NPC_FIRST)} ${pick(rng, NPC_LAST)}`;
    const p = makePlayer(newId('npc'), `${name} #${i + 1}`, s.x, s.y);
    p.isNpc = true;
    p.gold = 8_000 + rng() * 90_000;
    p.vehicle = rng() > 0.7 ? 'wagon' : 'cart';
    p.npc = {
      goal: 'idle',
      targetId: null,
      commodity: null,
      cooldown: 0,
      homeRegion: s.region,
      aggression: 0.4 + rng() * 0.9,
    };
    state.players.set(p.id, p);
  }
}

interface RouteIdea {
  fromId: string;
  toId: string;
  commodity: CommodityId;
  marginPerUnit: number;
  score: number;
}

/** Samples a handful of routes rather than scanning every pair; cheap and good enough. */
function findRoute(state: GameState, npc: Player, rng: () => number): RouteIdea | null {
  const settlements = state.map.settlements;
  let best: RouteIdea | null = null;

  for (let attempt = 0; attempt < 10; attempt++) {
    const a = pick(rng, settlements);
    const b = pick(rng, settlements);
    if (a.id === b.id) continue;
    const ma = state.markets.get(a.id);
    const mb = state.markets.get(b.id);
    if (!ma || !mb) continue;

    const id = pick(rng, COMMODITY_IDS);
    const buy = quote(state, ma, id, npc).buy;
    const sell = quote(state, mb, id, npc).sell;
    const margin = sell - buy;
    if (margin <= 0) continue;
    if (ma.goods[id].stock < 40) continue;

    const distance = Math.max(4, dist(a.x, a.y, b.x, b.y) + dist(npc.x, npc.y, a.x, a.y));
    // Margin per unit weight per tile travelled: the merchant's actual return on effort.
    const score = (margin / COMMODITIES[id].weight) / distance;
    if (!best || score > best.score) {
      best = { fromId: a.id, toId: b.id, commodity: id, marginPerUnit: margin, score };
    }
  }
  return best;
}

function moveToward(npc: Player, tx: number, ty: number, dtMs: number): boolean {
  const speed = 3.4 * (npc.vehicle === 'wagon' ? 1.3 : 1);
  const step = speed * (dtMs / 1000);
  const dx = tx - npc.x;
  const dy = ty - npc.y;
  const d = Math.hypot(dx, dy);
  if (d <= step) {
    npc.x = tx;
    npc.y = ty;
    return true;
  }
  npc.x += (dx / d) * step;
  npc.y += (dy / d) * step;
  return false;
}

function stepOne(state: GameState, npc: Player, dtMs: number, rng: () => number) {
  const brain = npc.npc;
  if (!brain) return;
  brain.cooldown -= dtMs;

  switch (brain.goal) {
    case 'idle': {
      if (brain.cooldown > 0) return;
      const idea = findRoute(state, npc, rng);
      if (!idea) { brain.cooldown = 4000 + rng() * 6000; return; }
      brain.goal = 'travel_buy';
      brain.targetId = idea.fromId;
      brain.commodity = idea.commodity;
      // Remember where to sell by stashing it on the second slot.
      (brain as NpcBrain & { sellAt?: string }).sellAt = idea.toId;
      break;
    }

    case 'travel_buy': {
      const target = state.map.settlements.find((s) => s.id === brain.targetId);
      if (!target || !brain.commodity) { brain.goal = 'idle'; return; }
      if (!moveToward(npc, target.x, target.y, dtMs)) return;

      const market = state.markets.get(target.id);
      if (!market) { brain.goal = 'idle'; return; }
      const id = brain.commodity;
      const unitCost = quote(state, market, id, npc).buy;
      const budget = npc.gold * clamp(0.35 * brain.aggression, 0.1, 0.65);
      const units = Math.floor(Math.min(budget / Math.max(1, unitCost), 240 / COMMODITIES[id].weight));
      if (units < 1) { brain.goal = 'idle'; brain.cooldown = 5000; return; }

      const result = executeTrade(state, market, id, units, 'buy', npc);
      npc.gold -= result.total;
      npc.inventory[id] = (npc.inventory[id] ?? 0) + result.filled;
      state.worldVolume[id] = (state.worldVolume[id] ?? 0) + result.filled;
      brain.goal = 'travel_sell';
      brain.targetId = (brain as NpcBrain & { sellAt?: string }).sellAt ?? null;
      break;
    }

    case 'travel_sell': {
      const target = state.map.settlements.find((s) => s.id === brain.targetId);
      if (!target || !brain.commodity) { brain.goal = 'idle'; return; }
      if (!moveToward(npc, target.x, target.y, dtMs)) return;

      const market = state.markets.get(target.id);
      const id = brain.commodity;
      const held = npc.inventory[id] ?? 0;
      if (market && held > 0) {
        const result = executeTrade(state, market, id, held, 'sell', npc);
        npc.gold += result.total;
        delete npc.inventory[id];
        state.worldVolume[id] = (state.worldVolume[id] ?? 0) + result.filled;
      }
      brain.goal = 'idle';
      brain.cooldown = 2000 + rng() * 6000;
      maybeDoBusiness(state, npc, rng);
      break;
    }
  }
}

/** Wealthy NPCs open factories; broke ones liquidate. Both move world supply. */
function maybeDoBusiness(state: GameState, npc: Player, rng: () => number) {
  if (rng() > 0.06) return;

  if (npc.gold > 120_000 && npc.buildings.length < 4) {
    const affordable = Object.values(BUILDINGS).filter(
      (d) => d.cost < npc.gold * 0.5 && d.kind !== 'shop' && !d.requiresNetWorth,
    );
    if (affordable.length === 0) return;
    const def = pick(rng, affordable);
    const s = state.map.settlements.find((x) => x.id === nearestSettlementId(state, npc));
    if (!s || s.occupied.length >= s.plots) return;
    const id = newId('b');
    state.buildings.set(id, {
      id, defId: def.id, ownerId: npc.id, settlementId: s.id,
      storage: {}, workers: { laborer: 3 }, active: true, cycleMs: 0,
      retailMarkup: 0.18, lastRevenue: 0, totalRevenue: 0, builtAt: Date.now(),
    });
    npc.buildings.push(id);
    s.occupied.push(id);
    npc.gold -= def.cost;
  } else if (npc.gold < 3_000 && npc.buildings.length > 0) {
    const id = npc.buildings.pop()!;
    const b = state.buildings.get(id);
    if (b) {
      const def = BUILDINGS[b.defId];
      npc.gold += (def?.cost ?? 0) * 0.5;
      const s = state.map.settlements.find((x) => x.id === b.settlementId);
      if (s) s.occupied = s.occupied.filter((o) => o !== id);
      state.buildings.delete(id);
    }
  }
}

function nearestSettlementId(state: GameState, p: Player): string {
  let bestId = state.map.settlements[0].id;
  let bestD = Infinity;
  for (const s of state.map.settlements) {
    const d = dist(p.x, p.y, s.x, s.y);
    if (d < bestD) { bestD = d; bestId = s.id; }
  }
  return bestId;
}

/** NPC factories dump their output into the local market instead of hoarding it. */
function flushNpcStorage(state: GameState) {
  for (const b of state.buildings.values()) {
    const owner = state.players.get(b.ownerId);
    if (!owner?.isNpc) continue;
    const market = state.markets.get(b.settlementId);
    if (!market) continue;
    for (const key of Object.keys(b.storage)) {
      const id = key as CommodityId;
      const held = b.storage[id] ?? 0;
      if (held < 10) continue;
      const result = executeTrade(state, market, id, held, 'sell', owner);
      owner.gold += result.total;
      b.storage[id] = 0;
    }
    // Keep NPC factories fed so they keep converting raw goods into finished ones.
    const def = BUILDINGS[b.defId];
    if (def?.recipe) {
      for (const [k, need] of Object.entries(def.recipe.inputs)) {
        const id = k as CommodityId;
        if ((b.storage[id] ?? 0) >= (need as number) * 8) continue;
        const want = (need as number) * 20;
        const cost = quote(state, market, id, owner).buy * want;
        if (owner.gold < cost) continue;
        const bought = executeTrade(state, market, id, want, 'buy', owner);
        owner.gold -= bought.total;
        b.storage[id] = (b.storage[id] ?? 0) + bought.filled;
      }
    }
  }
}

let flushAccumulator = 0;

export function stepAi(state: GameState, dtMs: number) {
  const rng = Math.random;
  for (const p of state.players.values()) {
    if (p.isNpc) stepOne(state, p, dtMs, rng);
  }
  flushAccumulator += dtMs;
  if (flushAccumulator >= 15_000) {
    flushAccumulator = 0;
    flushNpcStorage(state);
  }
}

