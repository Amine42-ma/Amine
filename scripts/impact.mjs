/**
 * Diagnostic: how far does one cart-load move a market, and how fast does the
 * market recover? Prints stock, anchor and price before a trade, immediately
 * after, and again after a recovery window.
 *
 *   node scripts/impact.mjs [ws://host/ws] [seconds]
 */
import { WebSocket } from 'ws';
import { COMMODITIES } from '../dist/shared/commodities.js';

const url = process.argv[2] ?? 'ws://localhost:8099/ws';
const recoverySeconds = Number(process.argv[3] ?? 60);

const ws = new WebSocket(url);
const markets = new Map();
let world = null;
let self = null;

const send = (m) => ws.send(JSON.stringify(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.t === 'authOk') world = msg.world;
  if (msg.t === 'self') self = msg.self;
  if (msg.t === 'market') markets.set(msg.market.settlementId, msg.market);
});

async function quoteFor(settlementId, commodity) {
  send({ t: 'requestMarket', settlementId });
  await sleep(350);
  return markets.get(settlementId).quotes.find((q) => q.id === commodity);
}

ws.on('open', async () => {
  send({ t: 'auth', name: `impact${Math.floor(Math.random() * 1e6)}`, password: 'impact12', mode: 'register' });
  while (!world || !self) await sleep(50);

  // Teleport-free: pick whichever settlement we spawned nearest and walk in.
  const target = [...world.settlements]
    .sort((a, b) => Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y))[0];

  let guard = 0;
  while (Math.hypot(target.x - self.x, target.y - self.y) > 4 && guard++ < 900) {
    const dx = target.x - self.x;
    const dy = target.y - self.y;
    const d = Math.hypot(dx, dy) || 1;
    self.x += (dx / d) * 0.24;
    self.y += (dy / d) * 0.24;
    send({ t: 'move', x: self.x, y: self.y });
    await sleep(80);
  }

  console.log(`\nmarket: ${target.name_en} (${target.kind}, pop ${target.population})\n`);
  console.log('good        stock  anchor    buy    sell   |  after buy 60      |  after ' + recoverySeconds + 's');
  console.log('─'.repeat(96));

  // Give ourselves the capital to actually move a market.
  send({ t: 'loanTake', amount: 4000 });
  await sleep(500);

  for (const id of ['wheat', 'cotton', 'cloth', 'iron']) {
    const before = await quoteFor(target.id, id);
    const units = Math.min(60, Math.floor(2000 / Math.max(1, before.buy)));
    if (units < 5) continue;

    send({ t: 'trade', settlementId: target.id, commodity: id, quantity: units, side: 'buy' });
    await sleep(500);
    const after = await quoteFor(target.id, id);

    // Dump it straight back so the next commodity starts from a clean slate,
    // then wait and see how far the market has healed.
    send({ t: 'trade', settlementId: target.id, commodity: id, quantity: units, side: 'sell' });
    await sleep(500);

    process.stdout.write(
      `${COMMODITIES[id].en.padEnd(10)} ${String(before.stock).padStart(6)} ${String(before.baseline).padStart(7)} ` +
      `${before.buy.toFixed(1).padStart(6)} ${before.sell.toFixed(1).padStart(7)}   |  ` +
      `stock ${String(after.stock).padStart(5)} buy ${after.buy.toFixed(1).padStart(6)} ` +
      `(${(((after.buy - before.buy) / before.buy) * 100).toFixed(0)}%)`,
    );

    await sleep(recoverySeconds * 1000);
    const healed = await quoteFor(target.id, id);
    console.log(
      `  |  stock ${String(healed.stock).padStart(5)} buy ${healed.buy.toFixed(1).padStart(6)} ` +
      `(${(((healed.buy - before.buy) / before.buy) * 100).toFixed(0)}% vs start)`,
    );
  }

  console.log('');
  ws.close();
  process.exit(0);
});

ws.on('error', (e) => { console.error(e.message); process.exit(1); });
