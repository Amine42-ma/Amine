/**
 * End-to-end smoke test. Drives a real WebSocket client through the loop a new
 * player actually plays: register, travel, find an arbitrage route, run it for
 * profit, then build and staff a shop and check it earns.
 *
 *   node scripts/smoke.mjs [ws://host/ws]
 */
import { WebSocket } from 'ws';
import { COMMODITIES } from '../dist/shared/commodities.js';
import { curveExponent, estimateTrade } from '../dist/shared/pricing.js';
import { BUILDINGS } from '../dist/shared/buildings.js';

const SMALL_SHOP_COST = BUILDINGS.small_shop.cost;

const url = process.argv[2] ?? 'ws://localhost:8099/ws';
const httpBase = url.replace(/^ws/, 'http').replace(/\/ws$/, '');

const ws = new WebSocket(url);
const inbox = [];
let self = null;
let world = null;
const markets = new Map();
let failures = 0;

const send = (msg) => ws.send(JSON.stringify(msg));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function check(label, condition, detail = '') {
  if (condition) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label} ${detail}`); }
}

async function waitFor(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = inbox.find(predicate);
    if (hit) return hit;
    await sleep(40);
  }
  return null;
}

ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  inbox.push(msg);
  if (inbox.length > 400) inbox.splice(0, 200);
  if (msg.t === 'self') self = msg.self;
  if (msg.t === 'authOk') world = msg.world;
  if (msg.t === 'market') markets.set(msg.market.settlementId, msg.market);
  if (msg.t === 'toast' && msg.level !== 'info') console.log(`    · ${msg.level}: ${msg.en}`);
});

/** Walks to a settlement the same way the browser client does: small steps. */
async function travelTo(target) {
  let guard = 0;
  while (dist(self, target) > 4 && guard++ < 900) {
    const dx = target.x - self.x;
    const dy = target.y - self.y;
    const d = Math.hypot(dx, dy) || 1;
    // 2.8 tiles/s is the server's speed cap; stay under it.
    const step = Math.min(0.24, d);
    self.x += (dx / d) * step;
    self.y += (dy / d) * step;
    send({ t: 'move', x: self.x, y: self.y });
    await sleep(80);
  }
  send({ t: 'requestMarket', settlementId: target.id });
  await sleep(250);
  return dist(self, target);
}

/** Achievements are granted on the next world tick, not synchronously. */
async function waitForAchievement(id, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (inbox.some((m) => m.t === 'achievement' && m.id === id)) return true;
    const latest = [...inbox].reverse().find((m) => m.t === 'self');
    if (latest?.self.achievements.includes(id)) return true;
    await sleep(150);
  }
  return false;
}

/**
 * Picks the best route out of `from`, scored the way the in-game preview scores
 * it: on the executed average price for a load this player can actually afford
 * and carry, not the headline single-unit quote.
 */
function scoutRoute(from, candidates) {
  const source = markets.get(from.id);
  if (!source) return null;
  let best = null;

  for (const s of candidates) {
    const away = markets.get(s.id);
    if (!away || s.id === from.id) continue;
    for (const here of source.quotes) {
      const there = away.quotes.find((q) => q.id === here.id);
      if (!there) continue;
      const units = Math.min(
        Math.floor(self.gold / Math.max(1, here.buy)),
        Math.floor(self.inventory.capacity / COMMODITIES[here.id].weight),
      );
      // Skip goods this purse cannot buy even one of.
      if (units < 1) continue;

      const k = curveExponent(here.id);
      const cost = estimateTrade(here.buy, here.stock, here.baseline, units, 'buy', k);
      const revenue = estimateTrade(there.sell, there.stock, there.baseline, units, 'sell', k);
      const profit = revenue.total - cost.total;
      if (profit <= 0) continue;

      // Profit per tile walked — a merchant's real return on effort.
      const score = profit / Math.max(1, dist(from, s));
      if (!best || score > best.score) {
        best = {
          from, to: s, id: here.id, units, profit, score,
          buy: cost.average, sell: revenue.average,
        };
      }
    }
  }
  return best;
}

/** Buys at the route's source, walks to its destination and sells. */
async function runRoute(route) {
  const goldBefore = self.gold;
  if (dist(self, route.from) > 5) await travelTo(route.from);

  send({ t: 'requestMarket', settlementId: route.from.id });
  send({ t: 'requestMarket', settlementId: route.to.id });
  await sleep(400);

  const quote = markets.get(route.from.id).quotes.find((q) => q.id === route.id);
  const destQuote = markets.get(route.to.id).quotes.find((q) => q.id === route.id);
  const units = Math.min(
    Math.floor(self.gold / Math.max(1, quote.buy)),
    Math.floor(self.inventory.capacity / COMMODITIES[route.id].weight),
  );
  if (units < 1) return { units: 0, profit: 0, exhausted: true };

  // A real player reads the profit preview before committing. If earlier trades
  // have already closed the gap, the route is done.
  const k = curveExponent(route.id);
  const projected =
    estimateTrade(destQuote.sell, destQuote.stock, destQuote.baseline, units, 'sell', k).total -
    estimateTrade(quote.buy, quote.stock, quote.baseline, units, 'buy', k).total;
  if (projected <= 0) return { units, profit: 0, exhausted: true };

  inbox.length = 0;
  send({ t: 'trade', settlementId: route.from.id, commodity: route.id, quantity: units, side: 'buy' });
  await waitFor((m) => m.t === 'self');
  self = [...inbox].reverse().find((m) => m.t === 'self').self;
  const loaded = self.inventory.items[route.id] ?? 0;

  await travelTo(route.to);
  inbox.length = 0;
  send({ t: 'trade', settlementId: route.to.id, commodity: route.id, quantity: 1e6, side: 'sell' });
  await waitFor((m) => m.t === 'self');
  self = [...inbox].reverse().find((m) => m.t === 'self').self;

  return { units, loaded, profit: self.gold - goldBefore, exhausted: false, goldBefore };
}

async function refreshSelf() {
  inbox.length = 0;
  send({ t: 'requestMarket', settlementId: world.settlements[0].id });
  await waitFor((m) => m.t === 'self', 3000);
  const latest = [...inbox].reverse().find((m) => m.t === 'self');
  if (latest) self = latest.self;
  return self;
}

ws.on('open', async () => {
  const name = `smoke${Math.floor(Math.random() * 1e6)}`;
  console.log(`\nEmpire of Merchants — smoke test as ${name}\n`);

  send({ t: 'auth', name, password: 'testing123', mode: 'register' });
  const ok = await waitFor((m) => m.t === 'authOk');
  check('registration succeeds', !!ok);
  check('world metadata delivered', !!world && world.settlements.length > 10,
    `settlements=${world?.settlements?.length}`);
  check('starting gold granted', self && self.gold > 0, `gold=${self?.gold}`);
  if (!ok) { ws.close(); process.exit(1); }

  /* ------------------------------------------------------------- travel */

  const byDistance = [...world.settlements].sort((a, b) => dist(self, a) - dist(self, b));
  const home = byDistance.find((s) => s.kind !== 'island') ?? byDistance[0];
  console.log(`\n  travelling to ${home.name_en}…`);
  const arrived = await travelTo(home);
  check('player reached the first settlement', arrived <= 12, `distance=${arrived.toFixed(1)}`);

  const market = markets.get(home.id);
  check('market quotes returned', market && market.quotes.length > 15, `quotes=${market?.quotes?.length}`);
  const cheapest = [...market.quotes].sort((a, b) => a.buy - b.buy)[0];
  check('prices are positive', cheapest.buy > 0 && cheapest.sell > 0, JSON.stringify(cheapest));
  check('buy price exceeds sell price (spread)', cheapest.buy > cheapest.sell);
  check('prices differ from the flat base price', market.quotes.some((q) => Math.abs(q.trend - 1) > 0.08),
    `trends=${market.quotes.slice(0, 5).map((q) => q.trend).join(',')}`);

  /* -------------------------------------------------- find an arbitrage */

  // Scout a realistic search radius — the Atlas panel lists every settlement
  // with its distance, so a player would not stop at the nearest two.
  // Islands need a ship; on foot they are not candidate destinations.
  const neighbours = byDistance.filter((s) => s.kind !== 'island').slice(1, 9);
  for (const s of neighbours) send({ t: 'requestMarket', settlementId: s.id });
  await sleep(900);

  const best = scoutRoute(home, neighbours);
  check('a profitable route exists between nearby settlements', !!best,
    'no positive-margin pair found among the eight nearest settlements');

  if (best) {
    console.log(
      `\n  route: ${best.id} — buy ${best.buy.toFixed(1)} in ${home.name_en}, ` +
      `sell ${best.sell.toFixed(1)} in ${best.to.name_en}\n`,
    );

    const startingGold = self.gold;
    const sameRouteMargins = [];
    let routesUsed = 0;
    let route = best;

    // Trade the way a player does: work a route until its margin is gone, then
    // scout a fresh one. Repeating one route should pay less each pass, but the
    // world should keep offering new ones.
    for (let trip = 1; trip <= 10; trip++) {
      const result = await runRoute(route);

      // A good merchant leaves a route while it is still worth something rather
      // than grinding it flat, so treat a collapsed margin as exhausted too.
      const spent = sameRouteMargins.length > 0
        && result.profit / Math.max(1, result.units) < sameRouteMargins[0] * 0.4;

      if (result.exhausted || spent) {
        if (spent && !result.exhausted) {
          if (routesUsed === 0) sameRouteMargins.push(result.profit / result.units);
          console.log(
            `    trip ${trip} (${route.id}): ${result.goldBefore.toFixed(0)} → ${self.gold.toFixed(0)} ` +
            `(+${result.profit.toFixed(0)}, margin spent)`,
          );
        }
        const next = scoutRoute(
          world.settlements.find((s) => dist(self, s) < 12) ?? route.to,
          neighbours,
        );
        if (!next) { console.log('    no route left nearby, stopping'); break; }
        routesUsed++;
        route = next;
        console.log(`    → switching to ${next.id}: ${next.from.name_en} → ${next.to.name_en}`);
        continue;
      }

      if (trip === 1) {
        check('goods loaded into the cart', result.loaded > 0, `loaded=${result.loaded}`);
        check('cargo never exceeds capacity', self.inventory.used <= self.inventory.capacity + 0.01,
          `used=${self.inventory.used}/${self.inventory.capacity}`);
        check('gold was spent then recovered', result.goldBefore !== self.gold);
      }

      // Per *unit*, so a growing bankroll buying bigger loads does not disguise
      // the margin shrinking.
      if (routesUsed === 0) sameRouteMargins.push(result.profit / result.units);
      console.log(
        `    trip ${trip} (${route.id}): ${result.goldBefore.toFixed(0)} → ${self.gold.toFixed(0)} ` +
        `(${result.profit >= 0 ? '+' : ''}${result.profit.toFixed(0)} on ${result.units}u = ` +
        `${(result.profit / result.units).toFixed(2)}/unit)`,
      );

      if (self.gold > 12_000) break;
    }

    check('every committed run turned a profit', sameRouteMargins.length > 0 && sameRouteMargins.every((m) => m > 0),
      `per-unit margins=${sameRouteMargins.map((m) => m.toFixed(2)).join(', ')}`);
    check('working one route erodes its per-unit margin',
      sameRouteMargins.length < 2 || sameRouteMargins.at(-1) < sameRouteMargins[0],
      `first=${sameRouteMargins[0]?.toFixed(2)} last=${sameRouteMargins.at(-1)?.toFixed(2)}`);
    check('the world keeps offering fresh routes', routesUsed > 0 || self.gold > startingGold * 3,
      `routes switched=${routesUsed}, gold ${startingGold.toFixed(0)} → ${self.gold.toFixed(0)}`);
    check('trading builds real capital', self.gold > startingGold * 2,
      `${startingGold.toFixed(0)} → ${self.gold.toFixed(0)}`);
    check('first_trade achievement granted', self.achievements.includes('first_trade'));
  }

  /* --------------------------------------------------------------- bank */

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

  /* -------------------------------------------------------------- staff */

  inbox.length = 0;
  send({ t: 'staffHire', worker: 'laborer', count: 2 });
  await waitFor((m) => m.t === 'self');
  self = [...inbox].reverse().find((m) => m.t === 'self').self;
  check('staff hired', (self.staff.laborer ?? 0) === 2, JSON.stringify(self.staff));

  /* --------------------------------------------------------------- shop */

  // Land is far cheaper in a village than in a capital, so a first shop goes up
  // in the cheapest town the player has actually seen — then walk there.
  const at = self.visitedSettlements
    .map((id) => world.settlements.find((s) => s.id === id))
    .filter((s) => s && s.kind !== 'island' && s.plotsUsed < s.plots)
    .sort((a, b) => a.plotPrice - b.plotPrice)[0]
    ?? home;
  console.log(`\n  building in ${at.name_en} (plot ${at.plotPrice})…\n`);
  await travelTo(at);
  const shopCost = SMALL_SHOP_COST + at.plotPrice;

  // Borrow the shortfall, which is exactly what the bank is for. Several more
  // trading runs would also get there; a loan keeps the smoke test quick.
  const RESERVE = 2500; // working capital to stock the shop with afterwards
  if (self.gold < shopCost + RESERVE) {
    const headroom = Math.max(0, self.creditLimit - self.debt);
    const want = Math.min(Math.ceil(shopCost + RESERVE - self.gold), headroom);
    if (want > 0) {
      inbox.length = 0;
      send({ t: 'loanTake', amount: want });
      await waitFor((m) => m.t === 'self');
      self = [...inbox].reverse().find((m) => m.t === 'self').self;
    }
  }
  check('bank credit covers the first shop', self.gold >= shopCost,
    `gold=${self.gold.toFixed(0)} needed=${shopCost}`);

  inbox.length = 0;
  send({ t: 'buildingBuy', settlementId: at.id, defId: 'small_shop' });
  await sleep(400);
  self = [...inbox].reverse().find((m) => m.t === 'self')?.self ?? self;
  const shop = self.buildings.find((b) => b.defId === 'small_shop');
  check('shop purchased', !!shop,
    `gold=${self.gold.toFixed(0)} needed=${shopCost} at=${at.name_en} buildings=${self.buildings.length}`);
  check('first_shop achievement granted', await waitForAchievement('first_shop'));

  if (shop) {
    inbox.length = 0;
    send({ t: 'buildingStaff', buildingId: shop.id, worker: 'laborer', delta: 2 });
    await waitFor((m) => m.t === 'self');
    self = [...inbox].reverse().find((m) => m.t === 'self').self;
    const staffed = self.buildings.find((b) => b.id === shop.id);
    check('workers assigned to the shop', (staffed?.workers.laborer ?? 0) === 2, JSON.stringify(staffed?.workers));

    // Stock it with the cheapest local good, borrowing working capital first.
    const headroom = Math.max(0, self.creditLimit - self.debt);
    if (headroom > 0 && self.gold < 2000) {
      inbox.length = 0;
      send({ t: 'loanTake', amount: Math.min(4000, headroom) });
      await waitFor((m) => m.t === 'self');
      self = [...inbox].reverse().find((m) => m.t === 'self').self;
    }

    send({ t: 'requestMarket', settlementId: at.id });
    await sleep(300);
    const local = markets.get(at.id);
    const stockable = [...local.quotes].sort((a, b) => a.trend - b.trend)[0];
    const units = Math.max(1, Math.floor((self.gold * 0.7) / Math.max(1, stockable.buy)));

    inbox.length = 0;
    send({ t: 'trade', settlementId: at.id, commodity: stockable.id, quantity: units, side: 'buy' });
    await waitFor((m) => m.t === 'self');
    self = [...inbox].reverse().find((m) => m.t === 'self').self;
    const carried = Math.floor(self.inventory.items[stockable.id] ?? 0);
    check('stock bought for the shop', carried > 0,
      `gold=${self.gold.toFixed(0)} wanted=${units} of ${stockable.id} @${stockable.buy}`);

    send({ t: 'buildingTransfer', buildingId: shop.id, commodity: stockable.id, quantity: carried, dir: 'in' });
    await sleep(500);
    self = [...inbox].reverse().find((m) => m.t === 'self').self;
    const stocked = self.buildings.find((b) => b.id === shop.id);
    check('goods transferred into the shop', (stocked?.storage[stockable.id] ?? 0) > 0,
      JSON.stringify(stocked?.storage));

    const goldPreSales = self.gold;
    console.log('\n  waiting 8s for retail sales to accrue…\n');
    await sleep(8000);
    await refreshSelf();
    check('shop generated retail revenue', self.gold > goldPreSales,
      `${goldPreSales.toFixed(0)} → ${self.gold.toFixed(0)}`);
  }

  /* ------------------------------------------------------------ convoys */

  if (self.visitedSettlements.length >= 2) {
    inbox.length = 0;
    const [a, b] = self.visitedSettlements;
    send({ t: 'convoyCreate', vehicleId: 'cart', fromId: a, toId: b, commodity: 'wheat', quantity: 20, autoRepeat: true });
    await waitFor((m) => m.t === 'self');
    self = [...inbox].reverse().find((m) => m.t === 'self').self;
    check('convoy route created', self.convoys.length === 1,
      JSON.stringify(self.convoys.map((c) => c.phase)));
    check('first_convoy achievement granted', await waitForAchievement('first_convoy'));
  } else {
    check('visited at least two settlements', false, `visited=${self.visitedSettlements.length}`);
  }

  /* ----------------------------------------------------------- exchange */

  inbox.length = 0;
  send({ t: 'requestExchange' });
  const exchange = await waitFor((m) => m.t === 'exchange');
  check('exchange snapshot returned', !!exchange);

  const health = await fetch(`${httpBase}/api/health`).then((r) => r.json());
  check('server reports live NPC population', health.players > 40, `players=${health.players}`);
  check('price index is sane', health.priceIndex > 0.5 && health.priceIndex < 1.8, `index=${health.priceIndex}`);
  check('world simulation is running buildings', health.buildings > 0, `buildings=${health.buildings}`);

  console.log(`\n${failures === 0 ? '✅ all smoke checks passed' : `❌ ${failures} check(s) failed`}\n`);
  ws.close();
  process.exit(failures === 0 ? 0 : 1);
});

ws.on('error', (err) => {
  console.error('socket error:', err.message);
  process.exit(1);
});
