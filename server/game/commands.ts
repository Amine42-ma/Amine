import { BUILDINGS } from '../../shared/buildings.js';
import { COMMODITIES, type CommodityId } from '../../shared/commodities.js';
import { VEHICLES, type VehicleId } from '../../shared/vehicles.js';
import { WORKERS, type WorkerId } from '../../shared/staff.js';
import { MAX_CHAT_LEN, CHAT_HISTORY, INCORPORATION_COST, BASE_SPEED } from '../../shared/constants.js';
import type { ClientMessage, ServerMessage } from '../../shared/protocol.js';
import { clamp, dist, newId } from '../../shared/util.js';
import type { GameState, Player } from './state.js';
import { settlementById } from './state.js';
import { carryCapacity, cargoLoad, playerSpeed } from './player.js';
import { executeTrade, quote } from '../sim/economy.js';
import { addXp, convoySlots, BUILDING_STORAGE } from '../sim/production.js';
import { convoyCapacity } from '../sim/convoys.js';
import { creditLimit, netWorth, repayLoan, takeLoan } from '../sim/bank.js';
import { cancelOrder, createCompany, placeOrder } from '../sim/stocks.js';
import { acceptContract, cancelContract, createContract } from '../sim/contracts.js';
import { createAlliance, joinAlliance, leaveAlliance } from '../sim/alliances.js';
import { grant } from './achievements.js';
import { plotPriceFor, totalAssigned } from './rules.js';
import { buildMarketView } from './views.js';

export interface Session {
  lastMoveAt: number;
  lastChatAt: number;
}

export interface CommandCtx {
  state: GameState;
  player: Player;
  session: Session;
  reply: (msg: ServerMessage) => void;
  broadcastChat: () => void;
}

const INTERACT_RANGE = 12;

function toast(ctx: CommandCtx, level: 'info' | 'good' | 'warn' | 'bad', ar: string, en: string) {
  ctx.reply({ t: 'toast', level, ar, en });
}

function nearSettlement(ctx: CommandCtx, settlementId: string) {
  const s = settlementById(ctx.state, settlementId);
  if (!s) return null;
  if (dist(ctx.player.x, ctx.player.y, s.x, s.y) > INTERACT_RANGE) return null;
  return s;
}

function markVisited(player: Player, settlementId: string) {
  if (!player.visited.includes(settlementId)) player.visited.push(settlementId);
}

/** Buildings and vehicles are gated on net worth so progression stays paced. */
function meetsGate(state: GameState, player: Player, required: number | undefined): boolean {
  if (!required) return true;
  return netWorth(state, player) >= required;
}

/* ------------------------------------------------------------------ movement */

function handleMove(ctx: CommandCtx, x: number, y: number) {
  const { state, player, session } = ctx;
  const now = Date.now();
  const dt = Math.min(1.5, Math.max(0.016, (now - session.lastMoveAt) / 1000));
  session.lastMoveAt = now;

  const tx = clamp(x, 0, state.map.width - 1);
  const ty = clamp(y, 0, state.map.height - 1);
  const maxStep = playerSpeed(player) * BASE_SPEED * dt + 1.5;
  const d = dist(player.x, player.y, tx, ty);

  let nx = tx;
  let ny = ty;
  if (d > maxStep) {
    // Rubber-band rather than reject, so honest lag spikes do not feel broken.
    const k = maxStep / d;
    nx = player.x + (tx - player.x) * k;
    ny = player.y + (ty - player.y) * k;
  }

  const tile = state.map.tiles[Math.round(ny) * state.map.width + Math.round(nx)];
  const canSail = player.vehicle === 'ship' || player.vehicle === 'plane';
  if (tile === 0 && !canSail) return;

  player.x = nx;
  player.y = ny;

  for (const s of state.map.settlements) {
    if (dist(nx, ny, s.x, s.y) <= INTERACT_RANGE) markVisited(player, s.id);
  }
}

/* --------------------------------------------------------------------- trade */

function handleTrade(ctx: CommandCtx, settlementId: string, id: CommodityId, qty: number, side: 'buy' | 'sell') {
  const { state, player } = ctx;
  if (!COMMODITIES[id]) return;
  const quantity = Math.floor(qty);
  if (!(quantity > 0)) return;

  const s = nearSettlement(ctx, settlementId);
  if (!s) return toast(ctx, 'warn', 'يجب أن تكون داخل المدينة للتداول.', 'You must be inside the settlement to trade.');
  const market = state.markets.get(settlementId);
  if (!market) return;

  if (side === 'buy') {
    const unit = quote(state, market, id, player).buy;
    const space = carryCapacity(state, player) - cargoLoad(player);
    const byCapacity = Math.floor(space / COMMODITIES[id].weight);
    const byGold = Math.floor(player.gold / Math.max(0.01, unit));
    const affordable = Math.min(quantity, byCapacity, byGold);
    if (affordable <= 0) {
      return toast(ctx, 'warn',
        byCapacity <= 0 ? 'لا توجد مساحة كافية في عربتك.' : 'لا تملك ذهباً كافياً.',
        byCapacity <= 0 ? 'Not enough cargo space.' : 'Not enough gold.');
    }

    const result = executeTrade(state, market, id, affordable, 'buy', player);
    if (result.filled <= 0) return toast(ctx, 'warn', 'لا يوجد مخزون كافٍ.', 'The market is out of stock.');
    player.gold -= result.total;
    player.inventory[id] = (player.inventory[id] ?? 0) + result.filled;
    player.windowCost += result.total;
    player.tradeVolume[id] = (player.tradeVolume[id] ?? 0) + result.filled;
    state.worldVolume[id] = (state.worldVolume[id] ?? 0) + result.filled;
    addXp(player, 'negotiation', result.total / 500);
    toast(ctx, 'good',
      `اشتريت ${Math.round(result.filled)} ${COMMODITIES[id].ar} بسعر ${result.average.toFixed(1)}`,
      `Bought ${Math.round(result.filled)} ${COMMODITIES[id].en} at ${result.average.toFixed(1)}`);
  } else {
    const held = player.inventory[id] ?? 0;
    const sellable = Math.min(quantity, Math.floor(held));
    if (sellable <= 0) return toast(ctx, 'warn', 'لا تملك هذه السلعة.', 'You do not carry that good.');

    const result = executeTrade(state, market, id, sellable, 'sell', player);
    player.gold += result.total;
    player.inventory[id] = held - result.filled;
    if ((player.inventory[id] ?? 0) <= 0.001) delete player.inventory[id];
    player.windowRevenue += result.total;
    player.tradeVolume[id] = (player.tradeVolume[id] ?? 0) + result.filled;
    state.worldVolume[id] = (state.worldVolume[id] ?? 0) + result.filled;
    addXp(player, 'negotiation', result.total / 400);
    grant(player, 'first_trade');
    toast(ctx, 'good',
      `بعت ${Math.round(result.filled)} ${COMMODITIES[id].ar} بسعر ${result.average.toFixed(1)}`,
      `Sold ${Math.round(result.filled)} ${COMMODITIES[id].en} at ${result.average.toFixed(1)}`);
  }

  ctx.reply({ t: 'market', market: buildMarketView(state, settlementId, player) });
}

/* ----------------------------------------------------------------- buildings */

function handleBuildingBuy(ctx: CommandCtx, settlementId: string, defId: string) {
  const { state, player } = ctx;
  const def = BUILDINGS[defId];
  if (!def) return;
  const s = nearSettlement(ctx, settlementId);
  if (!s) return toast(ctx, 'warn', 'يجب أن تكون في المدينة للبناء.', 'You must be at the settlement to build.');
  if (s.occupied.length >= s.plots) return toast(ctx, 'warn', 'لا توجد أراضٍ متاحة هنا.', 'No plots left here.');
  if (!meetsGate(state, player, def.requiresNetWorth)) {
    return toast(ctx, 'warn', 'ثروتك غير كافية لهذا الاستثمار.', 'Your net worth is too low for this investment.');
  }

  const plotPrice = plotPriceFor(s.plots, s.occupied.length, s.kind);
  const total = def.cost + plotPrice;
  if (player.gold < total) return toast(ctx, 'warn', 'لا تملك ذهباً كافياً.', 'Not enough gold.');

  // Terrain-restricted buildings need the right land nearby, not just any plot.
  if (def.terrain && !hasTerrainNearby(state, s.x, s.y, def.terrain)) {
    return toast(ctx, 'warn', 'الأرض هنا غير مناسبة لهذا المبنى.', 'The land here cannot support this building.');
  }

  player.gold -= total;
  const id = newId('b');
  state.buildings.set(id, {
    id, defId, ownerId: player.id, settlementId,
    storage: {}, workers: {}, active: true, cycleMs: 0,
    retailMarkup: def.markup ?? 0.18, lastRevenue: 0, totalRevenue: 0, builtAt: Date.now(),
  });
  player.buildings.push(id);
  s.occupied.push(id);
  addXp(player, 'management', 250);
  toast(ctx, 'good', `تم شراء ${def.ar} في ${s.name_ar}.`, `Bought ${def.en} in ${s.name_en}.`);
}

function hasTerrainNearby(state: GameState, x: number, y: number, kinds: string[]): boolean {
  const names = ['water', 'sand', 'grass', 'forest', 'desert', 'mountain', 'road'];
  const wanted = new Set(kinds);
  const r = 16;
  for (let dy = -r; dy <= r; dy += 2) {
    for (let dx = -r; dx <= r; dx += 2) {
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= state.map.width || py >= state.map.height) continue;
      if (wanted.has(names[state.map.tiles[py * state.map.width + px]])) return true;
    }
  }
  return false;
}

function handleBuildingSell(ctx: CommandCtx, buildingId: string) {
  const { state, player } = ctx;
  const b = state.buildings.get(buildingId);
  if (!b || b.ownerId !== player.id) return;
  const def = BUILDINGS[b.defId];
  const refund = Math.round((def?.cost ?? 0) * 0.6);

  // Stock inside the building is liquidated into the local market with it.
  const market = state.markets.get(b.settlementId);
  let goodsValue = 0;
  if (market) {
    for (const key of Object.keys(b.storage)) {
      const id = key as CommodityId;
      const held = b.storage[id] ?? 0;
      if (held <= 0) continue;
      const result = executeTrade(state, market, id, held, 'sell', player);
      goodsValue += result.total;
    }
  }

  player.gold += refund + goodsValue;
  player.buildings = player.buildings.filter((x) => x !== buildingId);
  state.buildings.delete(buildingId);
  const s = settlementById(state, b.settlementId);
  if (s) s.occupied = s.occupied.filter((x) => x !== buildingId);
  toast(ctx, 'info', `تم بيع ${def?.ar ?? 'المبنى'} مقابل ${Math.round(refund + goodsValue)}.`,
    `Sold ${def?.en ?? 'building'} for ${Math.round(refund + goodsValue)}.`);
}

function handleBuildingTransfer(ctx: CommandCtx, buildingId: string, id: CommodityId, qty: number, dir: 'in' | 'out') {
  const { state, player } = ctx;
  const b = state.buildings.get(buildingId);
  if (!b || b.ownerId !== player.id || !COMMODITIES[id]) return;
  const s = settlementById(state, b.settlementId);
  if (!s || dist(player.x, player.y, s.x, s.y) > INTERACT_RANGE) {
    return toast(ctx, 'warn', 'يجب أن تكون عند المبنى لنقل البضائع.', 'You must be at the building to move goods.');
  }
  const quantity = Math.floor(qty);
  if (!(quantity > 0)) return;

  if (dir === 'in') {
    const held = Math.floor(player.inventory[id] ?? 0);
    let used = 0;
    for (const v of Object.values(b.storage)) used += v ?? 0;
    const room = Math.floor(BUILDING_STORAGE - used);
    const move = Math.min(quantity, held, room);
    if (move <= 0) return toast(ctx, 'warn', 'المخزن ممتلئ أو لا تملك البضاعة.', 'Storage is full or you lack the goods.');
    player.inventory[id] = held - move;
    if ((player.inventory[id] ?? 0) <= 0) delete player.inventory[id];
    b.storage[id] = (b.storage[id] ?? 0) + move;
  } else {
    const held = Math.floor(b.storage[id] ?? 0);
    const space = carryCapacity(state, player) - cargoLoad(player);
    const move = Math.min(quantity, held, Math.floor(space / COMMODITIES[id].weight));
    if (move <= 0) return toast(ctx, 'warn', 'لا توجد مساحة في عربتك.', 'No room in your cart.');
    b.storage[id] = held - move;
    if ((b.storage[id] ?? 0) <= 0) delete b.storage[id];
    player.inventory[id] = (player.inventory[id] ?? 0) + move;
  }
}

function handleBuildingStaff(ctx: CommandCtx, buildingId: string, worker: WorkerId, delta: number) {
  const { state, player } = ctx;
  const b = state.buildings.get(buildingId);
  if (!b || b.ownerId !== player.id || !WORKERS[worker]) return;
  const def = BUILDINGS[b.defId];
  const step = Math.trunc(delta);
  if (step === 0) return;

  const assignedHere = b.workers[worker] ?? 0;
  if (step > 0) {
    const assignedTotal = totalAssigned(state, player, worker);
    const free = (player.staff[worker] ?? 0) - assignedTotal;
    const jobsLeft = (def?.jobs ?? 0) - Object.values(b.workers).reduce((a, v) => a + (v ?? 0), 0);
    const add = Math.min(step, free, jobsLeft);
    if (add <= 0) {
      return toast(ctx, 'warn', 'لا يوجد موظفون متاحون أو لا توجد وظائف شاغرة.', 'No free staff, or no open jobs here.');
    }
    b.workers[worker] = assignedHere + add;
  } else {
    b.workers[worker] = Math.max(0, assignedHere + step);
    if ((b.workers[worker] ?? 0) === 0) delete b.workers[worker];
  }
}

/* ------------------------------------------------------------------ vehicles */

function handleVehicleBuy(ctx: CommandCtx, vehicleId: VehicleId) {
  const { state, player } = ctx;
  const def = VEHICLES[vehicleId];
  if (!def) return;
  if (!meetsGate(state, player, def.requiresNetWorth)) {
    return toast(ctx, 'warn', 'ثروتك غير كافية لشراء هذه المركبة.', 'Your net worth is too low for this vehicle.');
  }
  if (player.gold < def.cost) return toast(ctx, 'warn', 'لا تملك ذهباً كافياً.', 'Not enough gold.');
  player.gold -= def.cost;
  player.fleet[vehicleId] = (player.fleet[vehicleId] ?? 0) + 1;
  toast(ctx, 'good', `تم شراء ${def.ar}.`, `Bought a ${def.en}.`);
}

function handleVehicleEquip(ctx: CommandCtx, vehicleId: VehicleId) {
  const { state, player } = ctx;
  if (!VEHICLES[vehicleId] || (player.fleet[vehicleId] ?? 0) <= 0) return;
  // Downsizing must not make cargo vanish into thin air.
  const prospective = VEHICLES[vehicleId].capacity;
  if (cargoLoad(player) > prospective) {
    return toast(ctx, 'warn', 'حمولتك أكبر من سعة هذه المركبة.', 'Your cargo exceeds that vehicle’s capacity.');
  }
  player.vehicle = vehicleId;
  void state;
}

/* ------------------------------------------------------------------- convoys */

function handleConvoyCreate(
  ctx: CommandCtx,
  vehicleId: VehicleId,
  fromId: string,
  toId: string,
  commodity: CommodityId,
  quantity: number,
  autoRepeat: boolean,
) {
  const { state, player } = ctx;
  if (!VEHICLES[vehicleId] || !COMMODITIES[commodity]) return;
  if (fromId === toId) return;
  const from = settlementById(state, fromId);
  const to = settlementById(state, toId);
  if (!from || !to) return;
  if (!player.visited.includes(fromId) || !player.visited.includes(toId)) {
    return toast(ctx, 'warn', 'يجب أن تزور المدينتين أولاً.', 'You must have visited both settlements.');
  }

  const owned = player.fleet[vehicleId] ?? 0;
  const inUse = [...state.convoys.values()].filter(
    (c) => c.ownerId === player.id && c.vehicleId === vehicleId && c.active,
  ).length;
  if (inUse >= owned) return toast(ctx, 'warn', 'كل مركباتك من هذا النوع مشغولة.', 'All vehicles of that type are busy.');
  if (player.convoys.length >= convoySlots(state, player)) {
    return toast(ctx, 'warn', 'لا توجد خطوط قوافل متاحة. ابنِ مرآباً.', 'No convoy slots left — build a depot.');
  }

  const def = VEHICLES[vehicleId];
  const seaRoute = from.kind === 'port' || from.kind === 'island' || to.kind === 'port' || to.kind === 'island';
  if (def.travel === 'sea' && !seaRoute) {
    return toast(ctx, 'warn', 'السفن تعمل بين الموانئ والجزر فقط.', 'Ships only sail between ports and islands.');
  }

  const capacity = convoyCapacity(vehicleId, player);
  const maxUnits = Math.floor(capacity / COMMODITIES[commodity].weight);
  const qty = clamp(Math.floor(quantity), 1, Math.max(1, maxUnits));

  const id = newId('c');
  state.convoys.set(id, {
    id, ownerId: player.id, vehicleId, fromId, toId, commodity,
    quantity: qty, phase: 'loading', progress: 0, x: from.x, y: from.y,
    costBasis: 0, carrying: 0, lastProfit: 0, totalProfit: 0,
    autoRepeat, active: true, stallReason: null,
  });
  player.convoys.push(id);
  addXp(player, 'shipping', 120);
  toast(ctx, 'good',
    `انطلقت قافلة ${COMMODITIES[commodity].ar} من ${from.name_ar} إلى ${to.name_ar}.`,
    `Convoy of ${COMMODITIES[commodity].en} launched: ${from.name_en} → ${to.name_en}.`);
}

function handleConvoyCancel(ctx: CommandCtx, convoyId: string) {
  const { state, player } = ctx;
  const c = state.convoys.get(convoyId);
  if (!c || c.ownerId !== player.id) return;
  // Refund the cargo it is currently carrying at cost, minus a cancellation fee.
  if (c.carrying > 0) player.gold += c.costBasis * 0.8;
  state.convoys.delete(convoyId);
  player.convoys = player.convoys.filter((x) => x !== convoyId);
}

/* --------------------------------------------------------------------- staff */

function handleStaffHire(ctx: CommandCtx, worker: WorkerId, count: number) {
  const { player } = ctx;
  const def = WORKERS[worker];
  if (!def) return;
  const n = clamp(Math.floor(count), 1, 50);
  // One payroll period paid up front as a signing cost.
  const upfront = def.salary * n;
  if (player.gold < upfront) return toast(ctx, 'warn', 'لا تملك ذهباً كافياً للتوظيف.', 'Not enough gold to hire.');
  player.gold -= upfront;
  player.staff[worker] = (player.staff[worker] ?? 0) + n;
  toast(ctx, 'good', `تم توظيف ${n} ${def.ar}.`, `Hired ${n} × ${def.en}.`);
}

function handleStaffFire(ctx: CommandCtx, worker: WorkerId, count: number) {
  const { state, player } = ctx;
  const have = player.staff[worker] ?? 0;
  const n = clamp(Math.floor(count), 1, have);
  if (n <= 0) return;
  const assigned = totalAssigned(state, player, worker);
  const free = have - assigned;
  if (n > free) return toast(ctx, 'warn', 'أعفِ الموظفين من مبانيهم أولاً.', 'Unassign them from buildings first.');
  player.staff[worker] = have - n;
  if ((player.staff[worker] ?? 0) <= 0) delete player.staff[worker];
}

/* ---------------------------------------------------------------------- bank */

function handleBank(ctx: CommandCtx, msg: Extract<ClientMessage, { t: 'bankDeposit' | 'bankWithdraw' }>) {
  const { player } = ctx;
  const amount = Math.floor(msg.amount);
  if (!(amount > 0)) return;
  if (msg.t === 'bankDeposit') {
    const move = Math.min(amount, Math.floor(player.gold));
    if (move <= 0) return;
    player.gold -= move;
    player.bank += move;
  } else {
    const move = Math.min(amount, Math.floor(player.bank));
    if (move <= 0) return;
    player.bank -= move;
    player.gold += move;
  }
}

/* ---------------------------------------------------------------- the market */

function handleCompanyCreate(ctx: CommandCtx, name: string, floatPercent: number, ipoPrice: number) {
  const { state, player } = ctx;
  if (netWorth(state, player) < INCORPORATION_COST * 2) {
    return toast(ctx, 'warn', 'تحتاج ثروة أكبر لتأسيس شركة.', 'You need a larger net worth to incorporate.');
  }
  const result = createCompany(state, player, name, floatPercent, ipoPrice);
  if (!result.ok) {
    const reasons: Record<string, [string, string]> = {
      already: ['لديك شركة بالفعل.', 'You already own a company.'],
      name: ['الاسم قصير جداً.', 'That name is too short.'],
      taken: ['الاسم مستخدم.', 'That name is taken.'],
      funds: [`تحتاج ${INCORPORATION_COST} ذهب.`, `You need ${INCORPORATION_COST} gold.`],
    };
    const [ar, en] = reasons[result.reason ?? 'name'] ?? reasons.name;
    return toast(ctx, 'warn', ar, en);
  }
  toast(ctx, 'good', `تم إدراج ${result.company!.name} في البورصة.`, `${result.company!.name} is listed on the exchange.`);
}

function handleOrderPlace(ctx: CommandCtx, companyId: string, side: 'buy' | 'sell', price: number, quantity: number) {
  const { state, player } = ctx;
  const result = placeOrder(state, player, companyId, side, price, quantity);
  if (!result.ok) {
    const reasons: Record<string, [string, string]> = {
      company: ['شركة غير موجودة.', 'No such company.'],
      shares: ['لا تملك أسهماً كافية.', 'You do not hold enough shares.'],
      funds: ['لا تملك ذهباً كافياً.', 'Not enough gold.'],
      quantity: ['كمية غير صالحة.', 'Invalid quantity.'],
    };
    const [ar, en] = reasons[result.reason ?? 'quantity'] ?? reasons.quantity;
    return toast(ctx, 'warn', ar, en);
  }
  if (result.fills.length > 0) {
    const total = result.fills.reduce((sum, f) => sum + f.quantity, 0);
    toast(ctx, 'good', `تم تنفيذ ${total} سهم.`, `Filled ${total} shares.`);
  } else {
    toast(ctx, 'info', 'تم وضع الأمر في السجل.', 'Order resting in the book.');
  }
}

/* ----------------------------------------------------------------- contracts */

function handleContractCreate(
  ctx: CommandCtx,
  side: 'sell' | 'buy',
  commodity: CommodityId,
  quantity: number,
  price: number,
) {
  const result = createContract(ctx.state, ctx.player, side, commodity, quantity, price);
  if (result.ok) {
    const good = COMMODITIES[commodity];
    return toast(ctx, 'good',
      `تم نشر عقد ${side === 'sell' ? 'بيع' : 'شراء'} ${quantity} ${good.ar} مقابل ${price}.`,
      `Posted a contract to ${side} ${quantity} ${good.en} for ${price}.`);
  }
  const reasons: Record<string, [string, string]> = {
    goods: ['لا تملك هذه البضاعة.', 'You do not hold those goods.'],
    funds: ['لا تملك ذهباً كافياً للضمان.', 'Not enough gold to escrow.'],
    limit: ['وصلت إلى الحد الأقصى من العقود.', 'You have too many open contracts.'],
    quantity: ['كمية غير صالحة.', 'Invalid quantity.'],
    price: ['سعر غير صالح.', 'Invalid price.'],
    commodity: ['سلعة غير معروفة.', 'Unknown commodity.'],
  };
  const [ar, en] = reasons[result.reason ?? 'quantity'] ?? reasons.quantity;
  toast(ctx, 'warn', ar, en);
}

function handleContractAccept(ctx: CommandCtx, contractId: string) {
  const contract = ctx.state.contracts.get(contractId);
  const result = acceptContract(ctx.state, ctx.player, contractId);
  if (result.ok && contract) {
    const good = COMMODITIES[contract.commodity];
    const counterparty = ctx.state.players.get(contract.ownerId);
    toast(ctx, 'good',
      `تمت الصفقة: ${contract.quantity} ${good.ar} مع ${counterparty?.name ?? '—'}.`,
      `Deal closed: ${contract.quantity} ${good.en} with ${counterparty?.name ?? '—'}.`);
    return;
  }
  const reasons: Record<string, [string, string]> = {
    missing: ['لم يعد العقد متاحاً.', 'That contract is gone.'],
    own: ['لا يمكنك قبول عقدك.', 'You cannot accept your own contract.'],
    funds: ['لا تملك ذهباً كافياً.', 'Not enough gold.'],
    goods: ['لا تملك البضاعة المطلوبة.', 'You do not have the goods.'],
    capacity: ['لا توجد مساحة كافية في العربة.', 'Not enough cargo space.'],
  };
  const [ar, en] = reasons[result.reason ?? 'missing'] ?? reasons.missing;
  toast(ctx, 'warn', ar, en);
}

/* ----------------------------------------------------------------- alliances */

function handleAllianceCreate(ctx: CommandCtx, name: string) {
  const result = createAlliance(ctx.state, ctx.player, name);
  if (result.ok) {
    return toast(ctx, 'good', `تأسّس تحالف «${result.alliance!.name}».`, `Alliance "${result.alliance!.name}" founded.`);
  }
  const reasons: Record<string, [string, string]> = {
    already: ['أنت في تحالف بالفعل.', 'You are already in an alliance.'],
    name: ['الاسم قصير جداً.', 'That name is too short.'],
    taken: ['الاسم مستخدم.', 'That name is taken.'],
  };
  const [ar, en] = reasons[result.reason ?? 'name'] ?? reasons.name;
  toast(ctx, 'warn', ar, en);
}

function handleAllianceJoin(ctx: CommandCtx, allianceId: string) {
  const result = joinAlliance(ctx.state, ctx.player, allianceId);
  if (result.ok) {
    return toast(ctx, 'good', `انضممت إلى «${result.alliance!.name}».`, `You joined "${result.alliance!.name}".`);
  }
  const reasons: Record<string, [string, string]> = {
    already: ['أنت في تحالف بالفعل.', 'You are already in an alliance.'],
    missing: ['التحالف غير موجود.', 'No such alliance.'],
    full: ['التحالف ممتلئ.', 'That alliance is full.'],
  };
  const [ar, en] = reasons[result.reason ?? 'missing'] ?? reasons.missing;
  toast(ctx, 'warn', ar, en);
}

/* ---------------------------------------------------------------------- chat */

function handleChat(ctx: CommandCtx, text: string) {
  const { state, player, session } = ctx;
  const now = Date.now();
  if (now - session.lastChatAt < 700) return;
  session.lastChatAt = now;
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LEN);
  if (!clean) return;
  state.chat.push({ id: newId('m'), from: player.name, text: clean, at: now, channel: 'world' });
  while (state.chat.length > CHAT_HISTORY) state.chat.shift();
  ctx.broadcastChat();
}

/* -------------------------------------------------------------------- router */

export function handleCommand(ctx: CommandCtx, msg: ClientMessage) {
  const { state, player } = ctx;
  player.lastSeen = Date.now();

  switch (msg.t) {
    case 'move': handleMove(ctx, msg.x, msg.y); break;
    case 'trade': handleTrade(ctx, msg.settlementId, msg.commodity, msg.quantity, msg.side); break;
    case 'buildingBuy': handleBuildingBuy(ctx, msg.settlementId, msg.defId); break;
    case 'buildingSell': handleBuildingSell(ctx, msg.buildingId); break;
    case 'buildingToggle': {
      const b = state.buildings.get(msg.buildingId);
      if (b && b.ownerId === player.id) b.active = !!msg.active;
      break;
    }
    case 'buildingTransfer': handleBuildingTransfer(ctx, msg.buildingId, msg.commodity, msg.quantity, msg.dir); break;
    case 'buildingStaff': handleBuildingStaff(ctx, msg.buildingId, msg.worker, msg.delta); break;
    case 'buildingMarkup': {
      const b = state.buildings.get(msg.buildingId);
      if (b && b.ownerId === player.id) b.retailMarkup = clamp(msg.markup, 0, 1.2);
      break;
    }
    case 'vehicleBuy': handleVehicleBuy(ctx, msg.vehicleId); break;
    case 'vehicleEquip': handleVehicleEquip(ctx, msg.vehicleId); break;
    case 'convoyCreate':
      handleConvoyCreate(ctx, msg.vehicleId, msg.fromId, msg.toId, msg.commodity, msg.quantity, msg.autoRepeat);
      break;
    case 'convoyCancel': handleConvoyCancel(ctx, msg.convoyId); break;
    case 'staffHire': handleStaffHire(ctx, msg.worker, msg.count); break;
    case 'staffFire': handleStaffFire(ctx, msg.worker, msg.count); break;
    case 'bankDeposit':
    case 'bankWithdraw': handleBank(ctx, msg); break;
    case 'loanTake': {
      const result = takeLoan(state, player, msg.amount);
      if (!result.ok) {
        toast(ctx, 'warn',
          `تجاوزت حد الائتمان (${Math.round(creditLimit(state, player))}).`,
          `Over your credit limit (${Math.round(creditLimit(state, player))}).`);
      }
      break;
    }
    case 'loanRepay': {
      const result = repayLoan(player, msg.loanId, msg.amount);
      if (result.cleared) {
        grant(player, 'banker');
        toast(ctx, 'good', 'تم سداد القرض بالكامل.', 'Loan fully repaid.');
      }
      break;
    }
    case 'companyCreate': handleCompanyCreate(ctx, msg.name, msg.floatPercent, msg.ipoPrice); break;
    case 'orderPlace': handleOrderPlace(ctx, msg.companyId, msg.side, msg.price, msg.quantity); break;
    case 'orderCancel': cancelOrder(state, player, msg.orderId); break;
    case 'chat': handleChat(ctx, msg.text); break;
    case 'contractCreate':
      handleContractCreate(ctx, msg.side, msg.commodity, msg.quantity, msg.price);
      break;
    case 'contractAccept': handleContractAccept(ctx, msg.contractId); break;
    case 'contractCancel': cancelContract(state, player, msg.contractId); break;
    case 'allianceCreate': handleAllianceCreate(ctx, msg.name); break;
    case 'allianceJoin': handleAllianceJoin(ctx, msg.allianceId); break;
    case 'allianceLeave': leaveAlliance(state, player); break;
    case 'requestMarket':
      ctx.reply({ t: 'market', market: buildMarketView(state, msg.settlementId, player) });
      break;
    case 'ping': ctx.reply({ t: 'pong', at: msg.at, now: Date.now() }); break;
    default: break;
  }
}
