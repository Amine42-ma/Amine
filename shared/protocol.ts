import type { CommodityId } from './commodities.js';
import type { VehicleId } from './vehicles.js';
import type { WorkerId } from './staff.js';
import type { SkillId } from './skills.js';

/** ------------------------------------------------------------------ shapes */

export type Terrain = 'water' | 'sand' | 'grass' | 'forest' | 'desert' | 'mountain' | 'road';

export type SettlementKind = 'village' | 'city' | 'port' | 'island';

export interface SettlementView {
  id: string;
  name_ar: string;
  name_en: string;
  kind: SettlementKind;
  x: number;
  y: number;
  region: string;
  population: number;
  /** Number of buildable plots and how many are already taken. */
  plots: number;
  plotsUsed: number;
  plotPrice: number;
}

export interface MarketQuote {
  id: CommodityId;
  /** What the city charges you to buy one unit. */
  buy: number;
  /** What the city pays you for one unit. */
  sell: number;
  stock: number;
  baseline: number;
  /** Ratio versus the world base price, for the up/down arrow in the UI. */
  trend: number;
}

export interface MarketView {
  settlementId: string;
  quotes: MarketQuote[];
  tariff: number;
}

export interface InventoryView {
  items: Partial<Record<CommodityId, number>>;
  used: number;
  capacity: number;
}

export interface OwnedBuildingView {
  id: string;
  defId: string;
  settlementId: string;
  /** Input/output buffer held on-site. */
  storage: Partial<Record<CommodityId, number>>;
  workers: Partial<Record<WorkerId, number>>;
  active: boolean;
  /** 0..1 progress of the current production cycle. */
  progress: number;
  /** Shops: goods listed for retail and the price multiplier the owner set. */
  retailMarkup?: number;
  lastRevenue: number;
  totalRevenue: number;
}

export interface ConvoyView {
  id: string;
  vehicleId: VehicleId;
  fromId: string;
  toId: string;
  commodity: CommodityId;
  quantity: number;
  /** 'buying' | 'outbound' | 'selling' | 'return' */
  phase: string;
  /** 0..1 along the current leg. */
  progress: number;
  x: number;
  y: number;
  lastProfit: number;
  totalProfit: number;
  active: boolean;
  autoRepeat: boolean;
}

export interface LoanView {
  id: string;
  principal: number;
  owed: number;
  apr: number;
  takenAt: number;
}

export interface CompanyView {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  sharePrice: number;
  sharesOutstanding: number;
  sharesFloating: number;
  valuation: number;
  /** Profit over the last accounting window. */
  lastProfit: number;
  history: number[];
}

export interface OrderView {
  id: string;
  companyId: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  playerId: string;
  playerName: string;
}

export interface ActiveEventView {
  id: string;
  defId: string;
  region: string | null;
  startedAt: number;
  endsAt: number;
}

export interface ContractView {
  id: string;
  side: 'sell' | 'buy';
  commodity: CommodityId;
  quantity: number;
  /** Total gold for the whole lot, not per unit. */
  price: number;
  ownerId: string;
  ownerName: string;
  ownerAlliance: string | null;
  createdAt: number;
}

export interface AllianceView {
  id: string;
  name: string;
  founderName: string;
  members: number;
  netWorth: number;
}

export interface SkillView {
  id: SkillId;
  level: number;
  xp: number;
  nextXp: number;
}

export interface PlayerSelf {
  id: string;
  name: string;
  x: number;
  y: number;
  gold: number;
  bank: number;
  netWorth: number;
  prestige: number;
  creditScore: number;
  /** Total borrowing capacity, and how much of it is already drawn. */
  creditLimit: number;
  debt: number;
  vehicle: VehicleId;
  fleet: Partial<Record<VehicleId, number>>;
  inventory: InventoryView;
  skills: SkillView[];
  buildings: OwnedBuildingView[];
  convoys: ConvoyView[];
  loans: LoanView[];
  staff: Partial<Record<WorkerId, number>>;
  unassignedStaff: Partial<Record<WorkerId, number>>;
  achievements: string[];
  shares: Record<string, number>;
  companyId: string | null;
  visitedSettlements: string[];
  allianceId: string | null;
  allianceName: string | null;
  payrollDue: number;
  lastPayrollCost: number;
}

export interface PresencePlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  vehicle: VehicleId;
  netWorth: number;
  isNpc: boolean;
}

export interface LeaderboardRow {
  id: string;
  name: string;
  netWorth: number;
  isNpc: boolean;
  companyName?: string;
  allianceName?: string;
}

export interface ChatMessage {
  id: string;
  from: string;
  text: string;
  at: number;
  channel: 'world' | 'system';
}

export interface SeasonView {
  index: number;
  startedAt: number;
  endsAt: number;
}

export interface WorldMeta {
  seed: number;
  width: number;
  height: number;
  settlements: SettlementView[];
  regions: string[];
}

/** ---------------------------------------------------------- client → server */

export type ClientMessage =
  | { t: 'auth'; name: string; password: string; mode: 'login' | 'register' }
  | { t: 'resume'; token: string }
  | { t: 'move'; x: number; y: number }
  | { t: 'trade'; settlementId: string; commodity: CommodityId; quantity: number; side: 'buy' | 'sell' }
  | { t: 'buildingBuy'; settlementId: string; defId: string }
  | { t: 'buildingSell'; buildingId: string }
  | { t: 'buildingToggle'; buildingId: string; active: boolean }
  | { t: 'buildingTransfer'; buildingId: string; commodity: CommodityId; quantity: number; dir: 'in' | 'out' }
  | { t: 'buildingStaff'; buildingId: string; worker: WorkerId; delta: number }
  | { t: 'buildingMarkup'; buildingId: string; markup: number }
  | { t: 'vehicleBuy'; vehicleId: VehicleId }
  | { t: 'vehicleEquip'; vehicleId: VehicleId }
  | { t: 'convoyCreate'; vehicleId: VehicleId; fromId: string; toId: string; commodity: CommodityId; quantity: number; autoRepeat: boolean }
  | { t: 'convoyCancel'; convoyId: string }
  | { t: 'staffHire'; worker: WorkerId; count: number }
  | { t: 'staffFire'; worker: WorkerId; count: number }
  | { t: 'bankDeposit'; amount: number }
  | { t: 'bankWithdraw'; amount: number }
  | { t: 'loanTake'; amount: number }
  | { t: 'loanRepay'; loanId: string; amount: number }
  | { t: 'companyCreate'; name: string; floatPercent: number; ipoPrice: number }
  | { t: 'orderPlace'; companyId: string; side: 'buy' | 'sell'; price: number; quantity: number }
  | { t: 'orderCancel'; orderId: string }
  | { t: 'chat'; text: string }
  | { t: 'contractCreate'; side: 'sell' | 'buy'; commodity: CommodityId; quantity: number; price: number }
  | { t: 'contractAccept'; contractId: string }
  | { t: 'contractCancel'; contractId: string }
  | { t: 'allianceCreate'; name: string }
  | { t: 'allianceJoin'; allianceId: string }
  | { t: 'allianceLeave' }
  | { t: 'requestContracts' }
  | { t: 'requestMarket'; settlementId: string }
  | { t: 'requestExchange' }
  | { t: 'ping'; at: number };

/** ---------------------------------------------------------- server → client */

export type ServerMessage =
  | { t: 'authOk'; token: string; playerId: string; world: WorldMeta; season: SeasonView; now: number }
  | { t: 'authError'; reason: string }
  | { t: 'self'; self: PlayerSelf }
  | { t: 'presence'; players: PresencePlayer[]; convoys: ConvoyView[] }
  | { t: 'market'; market: MarketView }
  | { t: 'prices'; index: number; movers: { id: CommodityId; change: number }[] }
  | { t: 'exchange'; companies: CompanyView[]; orders: OrderView[] }
  | { t: 'events'; active: ActiveEventView[] }
  | { t: 'leaderboard'; rows: LeaderboardRow[] }
  | { t: 'chat'; messages: ChatMessage[] }
  | { t: 'toast'; level: 'info' | 'good' | 'warn' | 'bad'; ar: string; en: string }
  | { t: 'achievement'; id: string }
  | { t: 'season'; season: SeasonView; reset: boolean }
  | { t: 'settlements'; settlements: SettlementView[] }
  | { t: 'contracts'; contracts: ContractView[]; alliances: AllianceView[] }
  | { t: 'pong'; at: number; now: number };
