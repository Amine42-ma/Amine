/**
 * End-to-end smoke test: drives a real WebSocket client through the core loop —
 * register, travel, trade, build, hire, bank, incorporate — and asserts the
 * server's replies make sense. Run with: node scripts/smoke.mjs [url]
 */
import { WebSocket } from 'ws';

const url = process.argv[2] ?? 'ws://localhost:8099/ws';
const ws = new WebSocket(url);

const inbox = [];
let self = null;
let world = null;
let market = null;
let failures = 0;

const send = (msg) => ws.send(JSON.stringify(msg));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label} ${detail}`);
  }
}

async function waitFor(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = inbox.find(predicate);
    if (hit) return hit;
    await sleep(50);
  }
  return null;
}

ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  inbox.push(msg);
  if (msg.t === 'self') self = msg.self;
  if (msg.t === 'authOk') world = msg.world;
  if (msg.t === 'market') market = msg.market;
  if (msg.t === 'toast') console.log(`    · toast[${msg.level}] ${msg.en}`);
});

ws.on('open', async () => {
  const name = `smoke${Math.floor(Math.random() * 1e6)}`;
  console.log(`\nEmpire of Merchants — smoke test as ${name}\n`);

  send({ t: 'auth', name, password: 'testing123', mode: 'register' });
  const ok = await waitFor((m) => m.t === 'authOk');
  check('registration succeeds', !!ok);
  check('world metadata delivered', !!world && world.settlements.length > 10, `settlements=${world?.settlements?.length}`);
  check('starting gold granted', self && self.gold > 0, `gold=${self?.gold}`);

  // Walk to the nearest settlement in small steps, like the real client does.
  const target = world.settlements
    .map((s) => ({ s, d: Math.hypot(s.x - self.x, s.y - self.y) }))
    .sort((a, b) => a.d - b.d)[0].s;
  console.log(`\n  travelling to ${target.name_en} (${target.x},${target.y})\n`);

  let guard = 0;
  while (Math.hypot(target.x - self.x, target.y - self.y) > 3 && guard++ < 400) {
    const dx = target.x - self.x;
    const dy = target.y - self.y;
    const d = Math.hypot(dx, dy) || 1;
    const step = Math.min(2.5, d);
    send({ t: 'move', x: self.x + (dx / d) * step, y: self.y + (dy / d) * step });
    await sleep(60);
    send({ t: 'ping', at: Date.now() });
    await sleep(20);
    const latest = [...inbox].reverse().find((m) => m.t === 'self');
    if (latest) self = latest.self;
    // The server only resends self on non-move commands, so nudge it.
    if (guard % 5 === 0) send({ t: 'requestMarket', settlementId: target.id });
    await sleep(20);
    const s = [...inbox].reverse().find((m) => m.t === 'self');
    if (s) self = s.self;
  }
  check('player reached the settlement', Math.hypot(target.x - self.x, target.y - self.y) <= 12,
    `distance=${Math.hypot(target.x - self.x, target.y - self.y).toFixed(1)}`);

  inbox.length = 0;
  send({ t: 'requestMarket', settlementId: target.id });
  await waitFor((m) => m.t === 'market');
  check('market quotes returned', market && market.quotes.length > 15, `quotes=${market?.quotes?.length}`);
  const cheapest = [...market.quotes].sort((a, b) => a.buy - b.buy)[0];
  check('prices are positive', cheapest.buy > 0 && cheapest.sell > 0, JSON.stringify(cheapest));
  check('buy price exceeds sell price (spread)', cheapest.buy > cheapest.sell);

  // Buy, then immediately sell back: the spread means we must end up poorer.
  const goldBefore = self.gold;
  inbox.length = 0;
  send({ t: 'trade', settlementId: target.id, commodity: cheapest.id, quantity: 10, side: 'buy' });
  await waitFor((m) => m.t === 'self');
  self = [...inbox].reverse().find((m) => m.t === 'self').self;
  check('goods arrived in cargo', (self.inventory.items[cheapest.id] ?? 0) > 0,
    JSON.stringify(self.inventory.items));
  check('gold was spent', self.gold < goldBefore, `${goldBefore} → ${self.gold}`);

  inbox.length = 0;
  send({ t: 'trade', settlementId: target.id, commodity: cheapest.id, quantity: 10, side: 'sell' });
  await waitFor((m) => m.t === 'self');
  self = [...inbox].reverse().find((m) => m.t === 'self').self;
  check('round trip loses money to the spread', self.gold < goldBefore, `${goldBefore} → ${self.gold}`);
  check('first_trade achievement granted', self.achievements.includes('first_trade'),
    JSON.stringify(self.achievements));

  // Bank: deposit, borrow, repay.
  inbox.length = 0;
  send({ t: 'bankDeposit', amount: 100 });
  await waitFor((m) => m.t === 'self');
  self = [...inbox].reverse().find((m) => m.t === 'self').self;
  check('deposit moved gold into the bank', self.bank >= 100, `bank=${self.bank}`);

  inbox.length = 0;
  send({ t: 'loanTake', amount: 2000 });
  await waitFor((m) => m.t === 'self');
  self = [...inbox].reverse().find((m) => m.t === 'self').self;
  check('loan issued', self.loans.length === 1 && self.loans[0].owed >= 2000, JSON.stringify(self.loans));

  inbox.length = 0;
  send({ t: 'loanRepay', loanId: self.loans[0].id, amount: 99999 });
  await waitFor((m) => m.t === 'self');
  self = [...inbox].reverse().find((m) => m.t === 'self').self;
  check('loan repaid in full', self.loans.length === 0, JSON.stringify(self.loans));
  check('credit score improved', self.creditScore > 600, `score=${self.creditScore}`);

  // Hire staff, then build something and staff it.
  inbox.length = 0;
  send({ t: 'staffHire', worker: 'laborer', count: 2 });
  await waitFor((m) => m.t === 'self');
  self = [...inbox].reverse().find((m) => m.t === 'self').self;
  check('staff hired', (self.staff.laborer ?? 0) === 2, JSON.stringify(self.staff));

  inbox.length = 0;
  send({ t: 'loanTake', amount: 9000 });
  await waitFor((m) => m.t === 'self');
  send({ t: 'buildingBuy', settlementId: target.id, defId: 'small_shop' });
  await sleep(300);
  self = [...inbox].reverse().find((m) => m.t === 'self').self;
  check('shop purchased', self.buildings.some((b) => b.defId === 'small_shop'),
    JSON.stringify(self.buildings.map((b) => b.defId)));
  check('first_shop achievement granted', self.achievements.includes('first_shop'));

  const shop = self.buildings.find((b) => b.defId === 'small_shop');
  if (shop) {
    inbox.length = 0;
    send({ t: 'buildingStaff', buildingId: shop.id, worker: 'laborer', delta: 2 });
    await waitFor((m) => m.t === 'self');
    self = [...inbox].reverse().find((m) => m.t === 'self').self;
    const staffed = self.buildings.find((b) => b.id === shop.id);
    check('workers assigned to the shop', (staffed?.workers.laborer ?? 0) === 2, JSON.stringify(staffed?.workers));

    // Stock the shop and confirm it earns while we wait.
    inbox.length = 0;
    send({ t: 'trade', settlementId: target.id, commodity: cheapest.id, quantity: 40, side: 'buy' });
    await waitFor((m) => m.t === 'self');
    send({ t: 'buildingTransfer', buildingId: shop.id, commodity: cheapest.id, quantity: 40, dir: 'in' });
    await sleep(400);
    self = [...inbox].reverse().find((m) => m.t === 'self').self;
    const stocked = self.buildings.find((b) => b.id === shop.id);
    check('goods transferred into the shop', (stocked?.storage[cheapest.id] ?? 0) > 0,
      JSON.stringify(stocked?.storage));

    const goldPreSales = self.gold;
    console.log('\n  waiting 6s for retail sales to accrue...\n');
    await sleep(6000);
    inbox.length = 0;
    send({ t: 'ping', at: Date.now() });
    send({ t: 'requestMarket', settlementId: target.id });
    await waitFor((m) => m.t === 'self', 4000);
    const after = [...inbox].reverse().find((m) => m.t === 'self');
    if (after) self = after.self;
    check('shop generated retail revenue', self.gold > goldPreSales, `${goldPreSales} → ${self.gold}`);
  }

  // Convoys need two visited settlements; visiting is proximity based, so use
  // the route the player has actually seen.
  if (self.visitedSettlements.length >= 2) {
    inbox.length = 0;
    const [a, b] = self.visitedSettlements;
    send({ t: 'convoyCreate', vehicleId: 'cart', fromId: a, toId: b, commodity: 'wheat', quantity: 20, autoRepeat: true });
    await waitFor((m) => m.t === 'self');
    self = [...inbox].reverse().find((m) => m.t === 'self').self;
    check('convoy route created', self.convoys.length === 1, JSON.stringify(self.convoys.map((c) => c.phase)));
  } else {
    console.log('  · only one settlement visited, skipping convoy check');
  }

  // Exchange.
  inbox.length = 0;
  send({ t: 'requestExchange' });
  const exchange = await waitFor((m) => m.t === 'exchange');
  check('exchange snapshot returned', !!exchange, JSON.stringify(exchange ?? {}).slice(0, 80));

  // World simulation is actually running.
  const health = await fetch(url.replace('ws://', 'http://').replace('/ws', '/api/health')).then((r) => r.json());
  check('server reports live NPC population', health.players > 40, `players=${health.players}`);
  check('price index is sane', health.priceIndex > 0.5 && health.priceIndex < 1.8, `index=${health.priceIndex}`);

  console.log(`\n${failures === 0 ? '✅ all smoke checks passed' : `❌ ${failures} check(s) failed`}\n`);
  ws.close();
  process.exit(failures === 0 ? 0 : 1);
});

ws.on('error', (err) => {
  console.error('socket error:', err.message);
  process.exit(1);
});
