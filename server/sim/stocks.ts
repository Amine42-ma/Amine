import { INCORPORATION_COST, TOTAL_SHARES } from '../../shared/constants.js';
import { SKILLS, skillFactor } from '../../shared/skills.js';
import { clamp, newId, round2 } from '../../shared/util.js';
import type { Company, GameState, Order, Player } from '../game/state.js';
import { netWorth } from './bank.js';
import { addXp } from './production.js';

/**
 * A tiny but genuine exchange: limit orders in a book, price discovery by
 * matching, and a fundamentals anchor so a company's worth tracks its profits.
 */

export interface TradeFill {
  buyerId: string;
  sellerId: string;
  companyId: string;
  price: number;
  quantity: number;
}

export function createCompany(
  state: GameState,
  owner: Player,
  name: string,
  floatPercent: number,
  ipoPrice: number,
): { ok: boolean; reason?: string; company?: Company } {
  if (owner.companyId) return { ok: false, reason: 'already' };
  const trimmed = name.trim().slice(0, 28);
  if (trimmed.length < 3) return { ok: false, reason: 'name' };
  for (const c of state.companies.values()) {
    if (c.name.toLowerCase() === trimmed.toLowerCase()) return { ok: false, reason: 'taken' };
  }
  if (owner.gold < INCORPORATION_COST) return { ok: false, reason: 'funds' };
  const price = round2(clamp(ipoPrice, 1, 1_000_000));
  const float = clamp(Math.floor((floatPercent / 100) * TOTAL_SHARES), 0, Math.floor(TOTAL_SHARES * 0.49));

  owner.gold -= INCORPORATION_COST;
  const company: Company = {
    id: newId('co'),
    name: trimmed,
    ownerId: owner.id,
    sharePrice: price,
    sharesOutstanding: TOTAL_SHARES,
    sharesFloating: 0,
    lastProfit: 0,
    valuation: price * TOTAL_SHARES,
    history: [price],
    createdAt: Date.now(),
  };
  state.companies.set(company.id, company);
  owner.companyId = company.id;
  owner.shares[company.id] = TOTAL_SHARES;

  if (float > 0) {
    placeOrder(state, owner, company.id, 'sell', price, float);
  }
  addXp(owner, 'investment', 400);
  return { ok: true, company };
}

function sharesHeld(p: Player, companyId: string): number {
  return p.shares[companyId] ?? 0;
}

/** Shares already committed to resting sell orders, so they cannot be double-sold. */
function reservedShares(state: GameState, playerId: string, companyId: string): number {
  let n = 0;
  for (const o of state.orders.values()) {
    if (o.playerId === playerId && o.companyId === companyId && o.side === 'sell') n += o.quantity;
  }
  return n;
}

function reservedGold(state: GameState, playerId: string): number {
  let n = 0;
  for (const o of state.orders.values()) {
    if (o.playerId === playerId && o.side === 'buy') n += o.quantity * o.price;
  }
  return n;
}

export function placeOrder(
  state: GameState,
  player: Player,
  companyId: string,
  side: 'buy' | 'sell',
  price: number,
  quantity: number,
): { ok: boolean; reason?: string; fills: TradeFill[] } {
  const company = state.companies.get(companyId);
  if (!company) return { ok: false, reason: 'company', fills: [] };
  let qty = Math.floor(quantity);
  const px = round2(clamp(price, 0.5, 5_000_000));
  if (qty <= 0) return { ok: false, reason: 'quantity', fills: [] };

  if (side === 'sell') {
    const available = sharesHeld(player, companyId) - reservedShares(state, player.id, companyId);
    if (available < qty) return { ok: false, reason: 'shares', fills: [] };
  } else {
    const available = player.gold - reservedGold(state, player.id);
    if (available < qty * px) return { ok: false, reason: 'funds', fills: [] };
  }

  const fills: TradeFill[] = [];
  // Match against the best resting orders on the opposite side.
  const opposite = [...state.orders.values()]
    .filter((o) => o.companyId === companyId && o.side !== side && o.playerId !== player.id)
    .sort((a, b) => (side === 'buy' ? a.price - b.price : b.price - a.price));

  for (const resting of opposite) {
    if (qty <= 0) break;
    if (side === 'buy' ? resting.price > px : resting.price < px) break;

    const counter = state.players.get(resting.playerId);
    if (!counter) { state.orders.delete(resting.id); continue; }

    const take = Math.min(qty, resting.quantity);
    const tradePrice = resting.price;
    const value = take * tradePrice;

    const buyer = side === 'buy' ? player : counter;
    const seller = side === 'buy' ? counter : player;
    if (buyer.gold < value) break;
    if (sharesHeld(seller, companyId) < take) { state.orders.delete(resting.id); continue; }

    buyer.gold -= value;
    seller.gold += value;
    buyer.shares[companyId] = sharesHeld(buyer, companyId) + take;
    seller.shares[companyId] = sharesHeld(seller, companyId) - take;
    if (seller.shares[companyId] <= 0) delete seller.shares[companyId];

    resting.quantity -= take;
    if (resting.quantity <= 0) state.orders.delete(resting.id);
    qty -= take;

    company.sharePrice = tradePrice;
    company.sharesFloating = company.sharesOutstanding - sharesHeld(
      state.players.get(company.ownerId) ?? buyer, companyId,
    );
    fills.push({ buyerId: buyer.id, sellerId: seller.id, companyId, price: tradePrice, quantity: take });
    addXp(buyer, 'investment', value / 900);
    addXp(seller, 'investment', value / 1200);
  }

  if (qty > 0) {
    const order: Order = {
      id: newId('ord'),
      companyId,
      side,
      price: px,
      quantity: qty,
      playerId: player.id,
      placedAt: Date.now(),
    };
    state.orders.set(order.id, order);
  }
  return { ok: true, fills };
}

export function cancelOrder(state: GameState, player: Player, orderId: string): boolean {
  const order = state.orders.get(orderId);
  if (!order || order.playerId !== player.id) return false;
  state.orders.delete(orderId);
  return true;
}

/**
 * Re-anchors every company to its fundamentals. Share price drifts toward the
 * owner's earnings-based valuation, so profitable empires get expensive.
 */
export function stepExchange(state: GameState, dtMs: number) {
  const pull = clamp(dtMs / 60_000, 0, 1) * 0.25;
  for (const co of state.companies.values()) {
    const owner = state.players.get(co.ownerId);
    if (!owner) continue;

    const worth = netWorth(state, owner);
    // Classic earnings multiple plus book value, both smoothed.
    const earnings = Math.max(0, owner.lastProfit) * 90;
    const fundamentals = Math.max(1, worth * 0.45 + earnings);
    co.valuation = co.valuation * (1 - pull) + fundamentals * pull;

    const fair = co.valuation / co.sharesOutstanding;
    const noise = 1 + (Math.random() - 0.5) * 0.02;
    co.sharePrice = clamp(co.sharePrice * (1 - pull * 0.6) + fair * pull * 0.6, 0.5, 5_000_000) * noise;
    co.lastProfit = owner.lastProfit;

    const ownerShares = owner.shares[co.id] ?? 0;
    co.sharesFloating = co.sharesOutstanding - ownerShares;

    co.history.push(round2(co.sharePrice));
    if (co.history.length > 90) co.history.shift();
  }
}

/** Dividend-style payout: shareholders earn a cut of company profit. */
export function payDividends(state: GameState) {
  for (const co of state.companies.values()) {
    if (co.lastProfit <= 0 || co.sharesFloating <= 0) continue;
    const pool = co.lastProfit * 0.12;
    const perShare = pool / co.sharesOutstanding;
    for (const p of state.players.values()) {
      const held = p.shares[co.id] ?? 0;
      if (held <= 0 || p.id === co.ownerId) continue;
      const bonus = 1 + skillFactor(p.skills.investment.level, SKILLS.investment.perLevel) * 0.5;
      p.gold += perShare * held * bonus;
    }
  }
}
