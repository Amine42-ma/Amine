import { COMMODITIES, type CommodityId } from '../../shared/commodities.js';
import { newId } from '../../shared/util.js';
import type { Contract, GameState, Player } from '../game/state.js';
import { carryCapacity, cargoLoad } from '../game/player.js';
import { addXp } from './production.js';

/**
 * Direct player-to-player deals. A contract escrows whatever the poster is
 * putting up — goods for a sale, gold for a purchase — so the other side can
 * accept from anywhere in the world and neither party can renege or duplicate.
 *
 * There is no house spread here: the whole point is that two merchants can cut
 * the market out and split the margin between themselves.
 */

export const MAX_CONTRACTS_PER_PLAYER = 8;
/** Contracts expire so the board does not silently fill with stale offers. */
export const CONTRACT_TTL_MS = 45 * 60_000;

export type ContractError =
  | 'commodity' | 'quantity' | 'price' | 'goods' | 'funds' | 'limit' | 'missing' | 'own' | 'capacity';

export function createContract(
  state: GameState,
  owner: Player,
  side: 'sell' | 'buy',
  commodity: CommodityId,
  quantity: number,
  price: number,
): { ok: boolean; reason?: ContractError } {
  if (!COMMODITIES[commodity]) return { ok: false, reason: 'commodity' };
  const qty = Math.floor(quantity);
  const total = Math.floor(price);
  if (!(qty > 0)) return { ok: false, reason: 'quantity' };
  if (!(total > 0)) return { ok: false, reason: 'price' };

  const mine = [...state.contracts.values()].filter((c) => c.ownerId === owner.id).length;
  if (mine >= MAX_CONTRACTS_PER_PLAYER) return { ok: false, reason: 'limit' };

  if (side === 'sell') {
    if (Math.floor(owner.inventory[commodity] ?? 0) < qty) return { ok: false, reason: 'goods' };
    owner.inventory[commodity] = (owner.inventory[commodity] ?? 0) - qty;
    if ((owner.inventory[commodity] ?? 0) <= 0.001) delete owner.inventory[commodity];
  } else {
    if (owner.gold < total) return { ok: false, reason: 'funds' };
    owner.gold -= total;
  }

  const contract: Contract = {
    id: newId('k'),
    ownerId: owner.id,
    side,
    commodity,
    quantity: qty,
    price: total,
    createdAt: Date.now(),
  };
  state.contracts.set(contract.id, contract);
  return { ok: true };
}

/** Returns the escrow to the poster. */
export function cancelContract(state: GameState, player: Player, contractId: string): boolean {
  const contract = state.contracts.get(contractId);
  if (!contract || contract.ownerId !== player.id) return false;
  refund(state, contract);
  state.contracts.delete(contractId);
  return true;
}

function refund(state: GameState, contract: Contract) {
  const owner = state.players.get(contract.ownerId);
  if (!owner) return;
  if (contract.side === 'sell') {
    owner.inventory[contract.commodity] = (owner.inventory[contract.commodity] ?? 0) + contract.quantity;
  } else {
    owner.gold += contract.price;
  }
}

export function acceptContract(
  state: GameState,
  taker: Player,
  contractId: string,
): { ok: boolean; reason?: ContractError } {
  const contract = state.contracts.get(contractId);
  if (!contract) return { ok: false, reason: 'missing' };
  if (contract.ownerId === taker.id) return { ok: false, reason: 'own' };
  const owner = state.players.get(contract.ownerId);
  if (!owner) {
    state.contracts.delete(contractId);
    return { ok: false, reason: 'missing' };
  }

  const weight = COMMODITIES[contract.commodity].weight;

  if (contract.side === 'sell') {
    // The poster escrowed goods; the taker pays gold and receives them.
    if (taker.gold < contract.price) return { ok: false, reason: 'funds' };
    const room = carryCapacity(state, taker) - cargoLoad(taker);
    if (room < contract.quantity * weight) return { ok: false, reason: 'capacity' };

    taker.gold -= contract.price;
    owner.gold += contract.price;
    taker.inventory[contract.commodity] = (taker.inventory[contract.commodity] ?? 0) + contract.quantity;
  } else {
    // The poster escrowed gold; the taker delivers goods and is paid.
    if (Math.floor(taker.inventory[contract.commodity] ?? 0) < contract.quantity) {
      return { ok: false, reason: 'goods' };
    }
    const room = carryCapacity(state, owner) - cargoLoad(owner);
    if (room < contract.quantity * weight) return { ok: false, reason: 'capacity' };

    taker.inventory[contract.commodity] = (taker.inventory[contract.commodity] ?? 0) - contract.quantity;
    if ((taker.inventory[contract.commodity] ?? 0) <= 0.001) delete taker.inventory[contract.commodity];
    owner.inventory[contract.commodity] = (owner.inventory[contract.commodity] ?? 0) + contract.quantity;
    taker.gold += contract.price;
  }

  state.contracts.delete(contractId);

  // Both sides moved real volume, and both learned something about negotiating.
  const volume = contract.quantity;
  for (const party of [owner, taker]) {
    party.tradeVolume[contract.commodity] = (party.tradeVolume[contract.commodity] ?? 0) + volume;
    addXp(party, 'negotiation', contract.price / 600);
  }
  state.worldVolume[contract.commodity] = (state.worldVolume[contract.commodity] ?? 0) + volume;

  // The seller books revenue, the buyer books cost, so company valuations move.
  if (contract.side === 'sell') {
    owner.windowRevenue += contract.price;
    taker.windowCost += contract.price;
  } else {
    taker.windowRevenue += contract.price;
    owner.windowCost += contract.price;
  }

  return { ok: true };
}

/** Drops expired contracts, returning each poster's escrow. */
export function expireContracts(state: GameState, now: number) {
  for (const [id, contract] of state.contracts) {
    if (now - contract.createdAt < CONTRACT_TTL_MS) continue;
    refund(state, contract);
    state.contracts.delete(id);
  }
}
