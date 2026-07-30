import type { CommodityId } from '../../shared/commodities.js';
import type { VehicleId } from '../../shared/vehicles.js';
import type { WorkerId } from '../../shared/staff.js';
import type { SkillId } from '../../shared/skills.js';
import type { WorldMap } from '../world/generate.js';

/** The authoritative, serialisable shape of the whole world. */

export interface MarketStock {
  stock: number;
  /**
   * The stock level at which this good sells for exactly its world base price.
   * Derived from local demand only, so two settlements with the same population
   * share an anchor — and any difference in their *stock* is a difference in price.
   */
  anchor: number;
  /** Units the settlement consumes per minute at equilibrium. */
  consumption: number;
  /** Units the settlement produces natively per minute. */
  production: number;
  /** Smoothed record of what the good has been trading at, for charts. */
  lastPrice: number;
}

export interface Market {
  settlementId: string;
  goods: Record<CommodityId, MarketStock>;
  /** Import duty applied to purchases, before the trade skill discount. */
  tariff: number;
}

export interface OwnedBuilding {
  id: string;
  defId: string;
  ownerId: string;
  settlementId: string;
  storage: Partial<Record<CommodityId, number>>;
  workers: Partial<Record<WorkerId, number>>;
  active: boolean;
  /** Milliseconds accumulated toward the current production cycle. */
  cycleMs: number;
  retailMarkup: number;
  lastRevenue: number;
  totalRevenue: number;
  builtAt: number;
}

export type ConvoyPhase = 'loading' | 'outbound' | 'unloading' | 'return';

export interface Convoy {
  id: string;
  ownerId: string;
  vehicleId: VehicleId;
  fromId: string;
  toId: string;
  commodity: CommodityId;
  quantity: number;
  phase: ConvoyPhase;
  /** 0..1 along the current leg. */
  progress: number;
  x: number;
  y: number;
  /** Gold spent buying the current cargo, so profit is measurable. */
  costBasis: number;
  carrying: number;
  lastProfit: number;
  totalProfit: number;
  autoRepeat: boolean;
  active: boolean;
  /** Set when the convoy stalls (no funds, no goods) so the UI can explain why. */
  stallReason: string | null;
}

export interface Loan {
  id: string;
  principal: number;
  owed: number;
  apr: number;
  takenAt: number;
}

export interface Skill {
  xp: number;
  level: number;
}

export interface Player {
  id: string;
  name: string;
  lowerName: string;
  /** scrypt hash + salt, colon separated. Absent for NPCs. */
  auth?: string;
  token?: string;
  isNpc: boolean;

  x: number;
  y: number;
  gold: number;
  bank: number;
  creditScore: number;
  prestige: number;

  vehicle: VehicleId;
  fleet: Partial<Record<VehicleId, number>>;
  inventory: Partial<Record<CommodityId, number>>;

  skills: Record<SkillId, Skill>;
  staff: Partial<Record<WorkerId, number>>;

  buildings: string[];
  convoys: string[];
  loans: Loan[];

  companyId: string | null;
  shares: Record<string, number>;

  achievements: string[];
  visited: string[];

  /** Rolling accounting window used by the exchange to value the company. */
  windowRevenue: number;
  windowCost: number;
  lastProfit: number;

  createdAt: number;
  lastSeen: number;
  nextPayrollAt: number;
  lastPayrollCost: number;
  /** Units of each good this player has moved, for monopoly detection. */
  tradeVolume: Partial<Record<CommodityId, number>>;

  /** NPC-only scratch space. */
  npc?: NpcBrain;
}

export interface NpcBrain {
  goal: 'idle' | 'travel_buy' | 'travel_sell';
  targetId: string | null;
  commodity: CommodityId | null;
  cooldown: number;
  homeRegion: string;
  aggression: number;
}

export interface Company {
  id: string;
  name: string;
  ownerId: string;
  sharePrice: number;
  sharesOutstanding: number;
  /** Shares held by anyone other than the founder. */
  sharesFloating: number;
  /** Cash the company raised at IPO and from share sales, paid to the owner. */
  lastProfit: number;
  valuation: number;
  history: number[];
  createdAt: number;
}

export interface Order {
  id: string;
  companyId: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  playerId: string;
  placedAt: number;
}

export interface ActiveEvent {
  id: string;
  defId: string;
  region: string | null;
  startedAt: number;
  endsAt: number;
}

export interface Season {
  index: number;
  startedAt: number;
  endsAt: number;
}

export interface ChatEntry {
  id: string;
  from: string;
  text: string;
  at: number;
  channel: 'world' | 'system';
}

export interface GameState {
  version: number;
  seed: number;
  map: WorldMap;
  players: Map<string, Player>;
  buildings: Map<string, OwnedBuilding>;
  convoys: Map<string, Convoy>;
  markets: Map<string, Market>;
  companies: Map<string, Company>;
  orders: Map<string, Order>;
  events: ActiveEvent[];
  season: Season;
  chat: ChatEntry[];
  /** Global price index, 1.0 = launch-day prices. */
  priceIndex: number;
  /** Wall-clock ms of the last simulation tick. */
  lastTick: number;
  nextEventAt: number;
  /** Rolling per-commodity world trade volume, used for monopoly checks. */
  worldVolume: Partial<Record<CommodityId, number>>;
}

export function findPlayerByName(state: GameState, name: string): Player | undefined {
  const lower = name.trim().toLowerCase();
  for (const p of state.players.values()) if (p.lowerName === lower) return p;
  return undefined;
}

export function findPlayerByToken(state: GameState, token: string): Player | undefined {
  for (const p of state.players.values()) if (p.token && p.token === token) return p;
  return undefined;
}

export function settlementById(state: GameState, id: string) {
  return state.map.settlements.find((s) => s.id === id);
}
