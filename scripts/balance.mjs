/**
 * Economy probe: connects as a throwaway player, pulls every market, and reports
 * price dispersion and the best arbitrage routes. Used to sanity-check tuning.
 */
import { WebSocket } from 'ws';
import { COMMODITIES } from '../dist/shared/commodities.js';
import { curveExponent, estimateTrade } from '../dist/shared/pricing.js';
import { STARTING_GOLD, STARTING_CAPACITY, BASE_SPEED } from '../dist/shared/constants.js';

const url = process.argv[2] ?? 'ws://localhost:8099/ws';
const ws = new WebSocket(url);
const markets = new Map();
let world = null;

const send = (m) => ws.send(JSON.stringify(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.t === 'authOk') world = msg.world;
  if (msg.t === 'market') markets.set(msg.market.settlementId, msg.market);
});

ws.on('open', async () => {
  send({ t: 'auth', name: `probe${Math.floor(Math.random() * 1e6)}`, password: 'probe1234', mode: 'register' });
  while (!world) await sleep(50);

  for (const s of world.settlements) send({ t: 'requestMarket', settlementId: s.id });
  await sleep(1500);

  const byId = new Map(world.settlements.map((s) => [s.id, s]));
  const commodities = markets.values().next().value.quotes.map((q) => q.id);

  console.log(`\nmarkets sampled: ${markets.size}/${world.settlements.length}\n`);
  console.log('commodity      min buy   max sell   best margin   %spread');
  console.log('─'.repeat(64));

  const routes = [];
  for (const id of commodities) {
    let minBuy = Infinity, minAt = null, maxSell = -Infinity, maxAt = null;
    for (const [sid, m] of markets) {
      const q = m.quotes.find((x) => x.id === id);
      if (!q) continue;
      if (q.buy < minBuy) { minBuy = q.buy; minAt = sid; }
      if (q.sell > maxSell) { maxSell = q.sell; maxAt = sid; }
    }
    const margin = maxSell - minBuy;
    const pct = (margin / minBuy) * 100;
    console.log(
      `${id.padEnd(14)} ${minBuy.toFixed(1).padStart(7)} ${maxSell.toFixed(1).padStart(10)} ` +
      `${margin.toFixed(1).padStart(13)} ${pct.toFixed(0).padStart(8)}%`,
    );
    if (margin > 0 && minAt && maxAt && minAt !== maxAt) {
      const a = byId.get(minAt), b = byId.get(maxAt);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      routes.push({ id, margin, pct, d, from: a.name_en, to: b.name_en });
    }
  }

  console.log('\ntop routes by margin per tile travelled:');
  console.log('─'.repeat(64));
  routes
    .map((r) => ({ ...r, score: r.margin / r.d }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .forEach((r) => {
      console.log(
        `  ${r.id.padEnd(12)} ${r.from} → ${r.to} · ${r.d.toFixed(0)} tiles · ` +
        `${r.margin.toFixed(1)}/unit (${r.pct.toFixed(0)}%)`,
      );
    });

  // What a brand-new player can actually earn: limited by starting gold, cart
  // capacity in *weight*, and the price impact of their own order.
  console.log('\nnew-player reality check (1200 gold, 60 cargo units, 2.8 tiles/s on foot):');
  console.log('─'.repeat(64));

  const realistic = [];
  for (const [aId, aMarket] of markets) {
    for (const [bId, bMarket] of markets) {
      if (aId === bId) continue;
      const a = byId.get(aId);
      const b = byId.get(bId);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 60) continue; // a new player is not crossing the map on foot

      for (const here of aMarket.quotes) {
        const there = bMarket.quotes.find((q) => q.id === here.id);
        if (!there) continue;
        const weight = COMMODITIES[here.id].weight;
        const units = Math.min(
          Math.floor(STARTING_GOLD / Math.max(1, here.buy)),
          Math.floor(STARTING_CAPACITY / weight),
        );
        if (units < 1) continue;

        const k = curveExponent(here.id);
        const cost = estimateTrade(here.buy, here.stock, here.baseline, units, 'buy', k);
        const revenue = estimateTrade(there.sell, there.stock, there.baseline, units, 'sell', k);
        const profit = revenue.total - cost.total;
        if (profit <= 0) continue;

        const seconds = (d * 2) / BASE_SPEED;
        realistic.push({ id: here.id, from: a.name_en, to: b.name_en, d, units, profit, perHour: (profit / seconds) * 3600 });
      }
    }
  }

  realistic.sort((x, y) => y.perHour - x.perHour);
  realistic.slice(0, 6).forEach((r) => {
    console.log(
      `  ${r.id.padEnd(12)} ${r.units.toString().padStart(3)}u  ${r.from} → ${r.to} ` +
      `(${r.d.toFixed(0)}t) · ${r.profit.toFixed(0)}/trip · ${(r.perHour / 1000).toFixed(1)}K/hr`,
    );
  });
  if (realistic.length > 0) {
    const median = realistic[Math.floor(realistic.length / 2)];
    console.log(
      `\n  ${realistic.length} viable short routes · best ${(realistic[0].perHour / 1000).toFixed(1)}K/hr · ` +
      `median ${(median.perHour / 1000).toFixed(1)}K/hr`,
    );
    console.log(
      `  → first small shop (6,000 + plot) is roughly ` +
      `${(7800 / realistic[Math.floor(realistic.length / 8)].perHour * 60).toFixed(0)} minutes of good trading\n`,
    );
  }
  ws.close();
  process.exit(0);
});

ws.on('error', (e) => { console.error(e.message); process.exit(1); });
