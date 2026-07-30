import type {
  ActiveEventView, ChatMessage, CompanyView, ConvoyView, LeaderboardRow,
  MarketView, OrderView, PlayerSelf, PresencePlayer, SeasonView, SettlementView, WorldMeta,
} from '../shared/protocol.js';
import type { CommodityId } from '../shared/commodities.js';

/**
 * A single mutable snapshot of everything the client knows. Renderers read it
 * every frame; panels re-render when `bump` fires for their key.
 */
export interface Store {
  connected: boolean;
  playerId: string | null;
  world: WorldMeta | null;
  tiles: Uint8Array | null;
  self: PlayerSelf | null;
  season: SeasonView | null;
  settlements: SettlementView[];
  others: PresencePlayer[];
  convoys: ConvoyView[];
  market: MarketView | null;
  companies: CompanyView[];
  orders: OrderView[];
  events: ActiveEventView[];
  leaderboard: LeaderboardRow[];
  chat: ChatMessage[];
  priceIndex: number;
  movers: { id: CommodityId; change: number }[];
  /** Server clock offset so countdowns stay honest across machines. */
  clockSkew: number;
  /** Interpolation targets for smooth remote-player movement. */
  lerp: Map<string, { x: number; y: number; tx: number; ty: number }>;
}

export const store: Store = {
  connected: false,
  playerId: null,
  world: null,
  tiles: null,
  self: null,
  season: null,
  settlements: [],
  others: [],
  convoys: [],
  market: null,
  companies: [],
  orders: [],
  events: [],
  leaderboard: [],
  chat: [],
  priceIndex: 1,
  movers: [],
  clockSkew: 0,
  lerp: new Map(),
};

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

export function on(key: string, fn: Listener): () => void {
  let set = listeners.get(key);
  if (!set) { set = new Set(); listeners.set(key, set); }
  set.add(fn);
  return () => set!.delete(fn);
}

export function bump(key: string) {
  const set = listeners.get(key);
  if (!set) return;
  for (const fn of set) {
    try {
      fn();
    } catch (err) {
      console.error(`[store] listener for "${key}" threw`, err);
    }
  }
}

export function serverNow(): number {
  return Date.now() + store.clockSkew;
}

export function settlementAt(id: string): SettlementView | undefined {
  return store.settlements.find((s) => s.id === id);
}

/** The settlement the player is standing in, if any. */
export function currentSettlement(): SettlementView | undefined {
  const self = store.self;
  if (!self) return undefined;
  let best: SettlementView | undefined;
  let bestD = 12;
  for (const s of store.settlements) {
    const d = Math.hypot(s.x - self.x, s.y - self.y);
    if (d <= bestD) { bestD = d; best = s; }
  }
  return best;
}
