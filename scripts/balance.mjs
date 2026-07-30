/**
 * Economy probe: connects as a throwaway player, pulls every market, and reports
 * price dispersion and the best arbitrage routes. Used to sanity-check tuning.
 */
import { WebSocket } from 'ws';

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

  // A concrete first-hour estimate for a brand-new player.
  const cartCapacity = 60;
  const best = routes.map((r) => ({ ...r, score: r.margin / r.d })).sort((a, b) => b.score - a.score)[0];
  if (best) {
    const perTrip = best.margin * cartCapacity;
    const tripSeconds = (best.d * 2) / 4.2;
    console.log(
      `\nnew player estimate: best route earns ~${perTrip.toFixed(0)} gold per round trip ` +
      `(${(tripSeconds / 60).toFixed(1)} min) → ~${((perTrip / tripSeconds) * 3600).toFixed(0)} gold/hour on foot\n`,
    );
  }
  ws.close();
  process.exit(0);
});

ws.on('error', (e) => { console.error(e.message); process.exit(1); });
