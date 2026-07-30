# Empire of Merchants — إمبراطورية التجار

A persistent, 2D top-down, online trading MMO. Every player starts with a wooden
cart and a handful of gold. Nobody starts with a shop. The goal is not combat —
it is to build the largest trading empire in the world.

**Every price in the game is made by players.** There is no free money and no
authored price list: each settlement holds a *stock* of every good, and its price
is a function of how far that stock sits from local demand. Production, convoys,
NPC merchants, world events and your own trades all move stock — and prices
follow.

```
npm install
npm run build
npm start          # → http://localhost:8080
```

The world runs 24/7, saves itself every 30 seconds, and survives restarts.

---

## Contents

- [Playing](#playing)
- [How the economy works](#how-the-economy-works)
- [Systems](#systems)
- [Architecture](#architecture)
- [Development](#development)
- [Tuning the balance](#tuning-the-balance)
- [Configuration](#configuration)

---

## Playing

Open the page, pick a merchant name and a password, and you are in the world.

| Action | Control |
| --- | --- |
| Travel | Click the map, or `W`/`A`/`S`/`D` (arrow keys work too) |
| Zoom | Mouse wheel |
| Market / Build / Empire | `M` / `B` / `E`, or the dock at the bottom |
| Chat | `Enter` |
| Close a panel | `Esc` |

You must physically stand in a settlement to trade there or build there. The
minimap is a planning tool — clicking it pans the camera, it does not move you.

The interface is Arabic-first and right-to-left, with an English toggle (🌐 in
the top bar).

### The first twenty minutes

1. Walk into the nearest settlement and open the **market**.
2. Look for goods marked ▼ — they are cheap *here* relative to the rest of the
   world. The panel previews the true average price and total for the quantity
   you type, including the price impact of your own order.
3. Buy a cartload, check the **Atlas** for a nearby settlement, and sell where
   the same good shows ▲.
4. Repeat. Each run erodes that route's margin, so rotate between routes.
5. Around 8,000–10,000 gold, buy your first **small shop**, stock it, and it
   starts earning while you are away.
6. From there: warehouses, convoy routes that run themselves, factories,
   a company on the stock exchange, ports, ships, and eventually a global
   corporation.

---

## How the economy works

This is the part worth understanding, because everything else is built on it.

### Prices come from stock, not from a table

Each settlement holds a stock of every commodity, and an **anchor** — the stock
level at which the good sells for exactly its world base price:

```
price = basePrice × clamp((anchor / stock) ^ k, 0.5, 2.5) × eventEffects × worldIndex
```

`k` is per-commodity: diamonds swing harder than salt.

### Why towns differ

A settlement produces goods according to the terrain around it (mountains give
iron and coal, grassland gives wheat and cotton, water gives fish) and consumes
according to its population and type. The rest of the world trades with it in
proportion to how far its price has drifted from base — expensive towns attract
imports, glutted towns export. Solving for balance:

```
equilibrium ratio = 1 + (consumption − production) / ((consumption + production) × WORLD_TRADE_RATE)
```

A town producing twice what it eats settles *below* base price. A town producing
none settles *above*. **That gap between towns is the entire reason to move
goods**, and it is emergent from terrain rather than hand-authored.

### Your orders move the market

A large order walks up the price curve slice by slice, so the price for one unit
is not the price for two hundred. The market panel previews the executed average
and total using [the exact same curve the server executes against](shared/pricing.ts),
so the number you see before clicking is the number you get.

Market **depth** is deliberately separated from the price anchor. Cities are deep
— a 60-unit cart moves them 3–5% and they recover within a minute. Hamlets are
thin and feel every crate. A truck (420 units) or a ship (2,600) needs a real
city to absorb it.

### Nothing runs away

- Prices are railed to 0.5×–2.5× of base.
- Off-map trade flow pushes any drifting market back toward equilibrium.
- ~48 NPC merchants hunt arbitrage exactly as you do, which quietly drains
  overpriced cities and refills starved ones — and competes with you for the
  good routes.

---

## Systems

| System | What it does |
| --- | --- |
| **World** | 320×320 tiles generated deterministically from a seed: forest, mountain, desert, grassland, sea, roads. 12 cities, 8 ports, 16 villages and 4 islands across 9 named regions. |
| **Trading** | Buy and sell in any settlement you are standing in. Spread, tariffs and price impact all apply. |
| **Production** | Extractors (mines, farms, fisheries, oil rigs) pull raw goods out of the land. Factories convert them: iron + coal → steel, cotton → cloth, cloth + leather → clothes, oil → fuel, steel + fuel + electronics → cars. |
| **Retail** | Shops sell stock to NPC customers at a markup you set. Every shop in a settlement competes for one finite customer pool — undercutting a rival's markup genuinely takes their sales. |
| **Convoys** | Assign a vehicle to a route and it buys, travels, sells and returns on its own, paying fuel and wages. This is how an empire earns while you sleep. |
| **Transport** | Cart → wagon → truck → ship → train → plane. Faster and larger costs more per tile. Ships and planes cross water; islands need them. |
| **Workers** | Labourers, drivers, managers, accountants, guards and junior traders. Each draws a salary every minute and boosts one axis. Miss payroll and half of them walk out. |
| **Bank** | Deposits earn interest, loans accrue it, and a credit score built from clean repayment sets your borrowing limit. |
| **Exchange** | Take a company public, float a percentage, and trade shares through a real limit-order book. Share prices track company earnings; shareholders receive dividends. |
| **World events** | Storms, droughts, fires, earthquakes, plagues, festivals, oil shocks, trade wars, crashes and booms — each reshapes supply, demand and travel in a region or worldwide, visibly (rain, embers, confetti, screen tint). |
| **Skills** | Negotiation, management, marketing, investment, shipping and international trade, levelled by doing the thing they govern. Effects saturate rather than running away. |
| **Achievements** | 17 permanent badges, from *First Deal* to *Economy Emperor*, each worth prestige that survives season resets. |
| **Seasons** | Every 90 days the economy resets so newcomers can compete. Gold, property and companies are wiped; achievements, prestige and skills persist, plus prestige earned from the empire you built. |

---

## Architecture

```
shared/     Types, game data and formulas used by BOTH sides of the wire
  pricing.ts      the price curve — server executes it, client previews it
  commodities.ts  21 goods: base price, weight, volatility, tier
  buildings.ts    extractors, factories, shops, logistics + recipes
  constants.ts    every tuning knob, documented

server/     Authoritative simulation. Clients never compute game state.
  world/generate.ts   deterministic terrain, settlements, roads, islands
  sim/economy.ts      supply/demand pricing, trade execution
  sim/production.ts   factories and competing retail
  sim/convoys.ts      automated trade routes
  sim/ai.ts           NPC arbitrage merchants
  sim/bank.ts         loans, interest, payroll, net worth
  sim/stocks.ts       order book and company valuation
  sim/events.ts       world events
  sim/seasons.ts      the 90-day reset
  game/commands.ts    every action a player can take, validated
  game/views.ts       what each client is allowed to see
  loop.ts             the world clock
  persistence.ts      atomic JSON snapshots

client/     Canvas renderer + UI. No image assets: tiles are drawn procedurally.
  render/     tile atlas, camera, scene, minimap
  ui/panels/  market, build, empire, convoys, fleet, staff, bank,
              exchange, skills, achievements, ranking, atlas
```

**Server-authoritative.** Movement is predicted on the client and reconciled
against the server, which rejects impossible speeds and refuses to walk a cart
into the sea. Every trade, purchase and order is validated server-side.

**Area of interest.** Each client is sent only the players and convoys within 45
tiles, at 10 Hz.

**Persistence.** The world saves atomically every 30 seconds and on shutdown.
Terrain is *not* stored — it is regenerated from the seed, so snapshots stay
small.

---

## Development

```
npm run dev          # rebuild client on change + run the server
npm run build        # compile server and bundle client
npm run typecheck    # both tsconfigs, no emit
npm test             # build, then run the unit suite
```

Helper scripts:

```
node scripts/devserver.mjs start|stop|restart|status   # pidfile-managed server
node scripts/smoke.mjs                                 # full end-to-end play-through
node scripts/balance.mjs                               # economy dispersion report
node scripts/impact.mjs                                # price impact + recovery probe
```

`scripts/smoke.mjs` drives a real WebSocket client through the loop a new player
actually plays — register, travel, scout an arbitrage route, work it until the
margin is gone, rotate to a fresh one, then build, staff and stock a shop and
verify it earns.

---

## Tuning the balance

Every knob lives in [`shared/constants.ts`](shared/constants.ts) with a comment
explaining what it trades off. The three that matter most:

| Constant | Effect |
| --- | --- |
| `WORLD_TRADE_RATE` | How hard off-map trade pulls a market back to base price. **Lower = more price dispersion between towns = more arbitrage.** |
| `MIN_MARKET_DEPTH` | Floor on units held at equilibrium. **Higher = your orders move prices less.** Applied to stock, not the anchor — a scarce good sits far below its anchor, so flooring the anchor would leave the shelf empty anyway. |
| `ECONOMY_SCALE` | Overall throughput. **Higher = drained routes refill faster**, since restoring flow is proportional to throughput. |

After changing any of them, re-measure rather than guess:

```
npm run build && node scripts/devserver.mjs restart
node scripts/balance.mjs     # dispersion, viable routes, new-player earnings
node scripts/impact.mjs      # how far one cartload moves a market, and recovery
```

---

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP + WebSocket port |
| `HOST` | `0.0.0.0` | Bind address |
| `EOM_SEED` | hash of the game name | World seed — change it for a different map |
| `EOM_DATA_DIR` | `./data` | Where `world.json` is written |

`GET /api/health` reports seed, season, population, building and convoy counts,
active events and the global price index.
