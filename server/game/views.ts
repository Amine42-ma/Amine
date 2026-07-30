import { BUILDINGS } from '../../shared/buildings.js';
import { COMMODITIES, COMMODITY_IDS, cargoUsed, type CommodityId } from '../../shared/commodities.js';
import { WORKER_IDS } from '../../shared/staff.js';
import { SKILL_IDS, xpForLevel } from '../../shared/skills.js';
import { AOI_RADIUS } from '../../shared/constants.js';
import { dist, round2 } from '../../shared/util.js';
import type {
  ActiveEventView, CompanyView, ConvoyView, LeaderboardRow, MarketView,
  OrderView, OwnedBuildingView, PlayerSelf, PresencePlayer, SeasonView,
  SettlementView, SkillView, WorldMeta,
} from '../../shared/protocol.js';
import type { GameState, Player } from './state.js';
import { carryCapacity } from './player.js';
import { quote } from '../sim/economy.js';
import { creditLimit, netWorth, outstandingDebt } from '../sim/bank.js';
import { plotPriceFor, totalAssigned } from './rules.js';

export function buildSettlementViews(state: GameState): SettlementView[] {
  return state.map.settlements.map((s) => ({
    id: s.id,
    name_ar: s.name_ar,
    name_en: s.name_en,
    kind: s.kind,
    x: s.x,
    y: s.y,
    region: s.region,
    population: s.population,
    plots: s.plots,
    plotsUsed: s.occupied.length,
    plotPrice: plotPriceFor(s.plots, s.occupied.length, s.kind),
  }));
}

export function buildWorldMeta(state: GameState): WorldMeta {
  return {
    seed: state.seed,
    width: state.map.width,
    height: state.map.height,
    settlements: buildSettlementViews(state),
    regions: state.map.regions,
  };
}

export function buildMarketView(state: GameState, settlementId: string, player: Player | null): MarketView {
  const market = state.markets.get(settlementId);
  if (!market) return { settlementId, quotes: [], tariff: 0 };

  const quotes = COMMODITY_IDS.map((id) => {
    const g = market.goods[id];
    const q = quote(state, market, id, player);
    return {
      id,
      buy: round2(q.buy),
      sell: round2(q.sell),
      stock: Math.round(g.stock),
      baseline: Math.round(g.anchor),
      trend: round2(q.mid / COMMODITIES[id].basePrice),
    };
  });
  return { settlementId, quotes, tariff: round2(market.tariff) };
}

function buildingViews(state: GameState, p: Player): OwnedBuildingView[] {
  const out: OwnedBuildingView[] = [];
  for (const bid of p.buildings) {
    const b = state.buildings.get(bid);
    if (!b) continue;
    out.push({
      id: b.id,
      defId: b.defId,
      settlementId: b.settlementId,
      storage: roundMap(b.storage),
      workers: { ...b.workers },
      active: b.active,
      progress: progressOf(b.defId, b.cycleMs),
      retailMarkup: round2(b.retailMarkup),
      lastRevenue: Math.round(b.lastRevenue),
      totalRevenue: Math.round(b.totalRevenue),
    });
  }
  return out;
}

function progressOf(defId: string, cycleMs: number): number {
  const seconds = BUILDINGS[defId]?.recipe?.seconds;
  if (!seconds) return 0;
  return Math.min(1, cycleMs / (seconds * 1000));
}

function roundMap(m: Partial<Record<CommodityId, number>>): Partial<Record<CommodityId, number>> {
  const out: Partial<Record<CommodityId, number>> = {};
  for (const key of Object.keys(m)) {
    const id = key as CommodityId;
    const v = m[id] ?? 0;
    if (v > 0.001) out[id] = round2(v);
  }
  return out;
}

export function convoyView(c: {
  id: string; vehicleId: ConvoyView['vehicleId']; fromId: string; toId: string;
  commodity: CommodityId; quantity: number; phase: string; progress: number;
  x: number; y: number; lastProfit: number; totalProfit: number; active: boolean;
  autoRepeat: boolean; stallReason: string | null;
}): ConvoyView {
  return {
    id: c.id,
    vehicleId: c.vehicleId,
    fromId: c.fromId,
    toId: c.toId,
    commodity: c.commodity,
    quantity: c.quantity,
    phase: c.stallReason ? `stalled:${c.stallReason}` : c.phase,
    progress: round2(c.progress),
    x: round2(c.x),
    y: round2(c.y),
    lastProfit: Math.round(c.lastProfit),
    totalProfit: Math.round(c.totalProfit),
    active: c.active,
    autoRepeat: c.autoRepeat,
  };
}

export function buildSelf(state: GameState, p: Player): PlayerSelf {
  const skills: SkillView[] = SKILL_IDS.map((id) => ({
    id,
    level: p.skills[id].level,
    xp: Math.round(p.skills[id].xp),
    nextXp: xpForLevel(p.skills[id].level + 1),
  }));

  const unassigned: PlayerSelf['unassignedStaff'] = {};
  for (const w of WORKER_IDS) {
    const owned = p.staff[w] ?? 0;
    if (owned > 0) unassigned[w] = owned - totalAssigned(state, p, w);
  }

  const convoys: ConvoyView[] = [];
  for (const cid of p.convoys) {
    const c = state.convoys.get(cid);
    if (c) convoys.push(convoyView(c));
  }

  return {
    id: p.id,
    name: p.name,
    x: round2(p.x),
    y: round2(p.y),
    // Floored, never rounded: rounding up by half a gold makes the UI show
    // exactly enough for a purchase the server then refuses.
    gold: Math.floor(p.gold),
    bank: Math.floor(p.bank),
    netWorth: Math.round(netWorth(state, p)),
    prestige: p.prestige,
    creditScore: Math.round(p.creditScore),
    creditLimit: creditLimit(state, p),
    debt: Math.ceil(outstandingDebt(p)),
    vehicle: p.vehicle,
    fleet: { ...p.fleet },
    inventory: {
      items: roundMap(p.inventory),
      used: cargoUsed(p.inventory),
      capacity: carryCapacity(state, p),
    },
    skills,
    buildings: buildingViews(state, p),
    convoys,
    loans: p.loans.map((l) => ({
      id: l.id,
      principal: Math.round(l.principal),
      owed: Math.round(l.owed),
      apr: round2(l.apr),
      takenAt: l.takenAt,
    })),
    staff: { ...p.staff },
    unassignedStaff: unassigned,
    achievements: p.achievements.slice(),
    shares: { ...p.shares },
    companyId: p.companyId,
    visitedSettlements: p.visited.slice(),
    payrollDue: p.nextPayrollAt,
    lastPayrollCost: Math.round(p.lastPayrollCost),
  };
}

/** Only players and convoys inside the viewer's area of interest are sent. */
export function buildPresence(state: GameState, viewer: Player): {
  players: PresencePlayer[];
  convoys: ConvoyView[];
} {
  const players: PresencePlayer[] = [];
  for (const p of state.players.values()) {
    if (p.id === viewer.id) continue;
    if (dist(p.x, p.y, viewer.x, viewer.y) > AOI_RADIUS) continue;
    players.push({
      id: p.id,
      name: p.name,
      x: round2(p.x),
      y: round2(p.y),
      vehicle: p.vehicle,
      netWorth: 0,
      isNpc: p.isNpc,
    });
  }

  const convoys: ConvoyView[] = [];
  for (const c of state.convoys.values()) {
    if (c.ownerId !== viewer.id && dist(c.x, c.y, viewer.x, viewer.y) > AOI_RADIUS) continue;
    convoys.push(convoyView(c));
  }

  return { players, convoys };
}

export function buildCompanies(state: GameState): CompanyView[] {
  const out: CompanyView[] = [];
  for (const co of state.companies.values()) {
    const owner = state.players.get(co.ownerId);
    out.push({
      id: co.id,
      name: co.name,
      ownerId: co.ownerId,
      ownerName: owner?.name ?? '—',
      sharePrice: round2(co.sharePrice),
      sharesOutstanding: co.sharesOutstanding,
      sharesFloating: co.sharesFloating,
      valuation: Math.round(co.valuation),
      lastProfit: Math.round(co.lastProfit),
      history: co.history.slice(-60),
    });
  }
  return out.sort((a, b) => b.valuation - a.valuation);
}

export function buildOrders(state: GameState): OrderView[] {
  const out: OrderView[] = [];
  for (const o of state.orders.values()) {
    out.push({
      id: o.id,
      companyId: o.companyId,
      side: o.side,
      price: round2(o.price),
      quantity: o.quantity,
      playerId: o.playerId,
      playerName: state.players.get(o.playerId)?.name ?? '—',
    });
  }
  return out;
}

export function buildLeaderboard(state: GameState, limit = 20): LeaderboardRow[] {
  const rows: LeaderboardRow[] = [];
  for (const p of state.players.values()) {
    const company = p.companyId ? state.companies.get(p.companyId) : null;
    rows.push({
      id: p.id,
      name: p.name,
      netWorth: Math.round(netWorth(state, p)),
      isNpc: p.isNpc,
      companyName: company?.name,
    });
  }
  return rows.sort((a, b) => b.netWorth - a.netWorth).slice(0, limit);
}

export function buildEvents(state: GameState): ActiveEventView[] {
  return state.events.map((e) => ({
    id: e.id,
    defId: e.defId,
    region: e.region,
    startedAt: e.startedAt,
    endsAt: e.endsAt,
  }));
}

export function buildSeason(state: GameState): SeasonView {
  return { index: state.season.index, startedAt: state.season.startedAt, endsAt: state.season.endsAt };
}
