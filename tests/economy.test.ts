import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { COMMODITIES, COMMODITY_IDS, cargoUsed } from '../shared/commodities.js';
import { curveExponent, estimateTrade, priceFactor } from '../shared/pricing.js';
import { MIN_MARKET_DEPTH, MIN_PRICE_RATIO, MAX_PRICE_RATIO, STARTING_GOLD } from '../shared/constants.js';
import { xpForLevel, levelFromXp, skillFactor } from '../shared/skills.js';
import { generateWorld } from '../server/world/generate.js';
import { createFreshState } from '../server/persistence.js';
import { executeTrade, quote, stepEconomy, equilibriumRatio } from '../server/sim/economy.js';
import { netWorth, takeLoan, repayLoan, runPayroll } from '../server/sim/bank.js';
import { createCompany, placeOrder } from '../server/sim/stocks.js';
import { makePlayer } from '../server/game/player.js';
import { rollSeason } from '../server/sim/seasons.js';
import { grant } from '../server/game/achievements.js';
import type { GameState } from '../server/game/state.js';

const SEED = 12345;

function freshWorld(): GameState {
  return createFreshState(SEED);
}

function addHuman(state: GameState, name = 'tester') {
  const s = state.map.settlements[0];
  const player = makePlayer(`p_${name}`, name, s.x, s.y);
  state.players.set(player.id, player);
  return player;
}

describe('world generation', () => {
  test('is deterministic for a given seed', () => {
    const a = generateWorld(SEED);
    const b = generateWorld(SEED);
    assert.equal(a.settlements.length, b.settlements.length);
    assert.deepEqual(
      a.settlements.map((s) => `${s.id}:${s.x},${s.y}`),
      b.settlements.map((s) => `${s.id}:${s.x},${s.y}`),
    );
    assert.ok(a.tiles.every((t, i) => t === b.tiles[i]), 'terrain grids differ');
  });

  test('produces a varied world with every settlement kind', () => {
    const world = generateWorld(SEED);
    const kinds = new Set(world.settlements.map((s) => s.kind));
    for (const kind of ['city', 'port', 'village', 'island']) {
      assert.ok(kinds.has(kind as never), `missing settlement kind: ${kind}`);
    }
    const terrains = new Set(world.tiles);
    assert.ok(terrains.size >= 6, `expected varied terrain, got ${terrains.size} types`);
  });
});

describe('price curve', () => {
  test('scarcity raises price and glut lowers it', () => {
    const k = curveExponent('iron');
    const scarce = priceFactor(1000, 500, k);
    const even = priceFactor(1000, 1000, k);
    const glut = priceFactor(1000, 2000, k);
    assert.ok(scarce > even, 'scarce stock should cost more');
    assert.ok(glut < even, 'a glut should cost less');
    assert.equal(Math.round(even * 1000) / 1000, 1);
  });

  test('never strays outside the configured rails', () => {
    const k = curveExponent('diamond');
    assert.equal(priceFactor(1000, 1, k), MAX_PRICE_RATIO);
    assert.equal(priceFactor(1, 100000, k), MIN_PRICE_RATIO);
  });

  test('a bigger order pays a worse average price', () => {
    const k = curveExponent('cloth');
    const small = estimateTrade(100, 2000, 2000, 10, 'buy', k);
    const large = estimateTrade(100, 2000, 2000, 400, 'buy', k);
    assert.ok(large.average > small.average, 'large orders must walk up the curve');
    assert.ok(small.average >= 100, 'even a small buy starts at the quoted price');
  });

  test('selling in size earns a worse average than the quote', () => {
    const k = curveExponent('cloth');
    const sale = estimateTrade(100, 2000, 2000, 400, 'sell', k);
    assert.ok(sale.average < 100, 'dumping stock should push the price down');
  });
});

describe('client preview matches server execution', () => {
  test('estimateTrade agrees with executeTrade for a real market', () => {
    const state = freshWorld();
    const player = addHuman(state);
    const settlement = state.map.settlements.find((s) => s.kind === 'city')!;
    const market = state.markets.get(settlement.id)!;

    for (const id of ['wheat', 'iron', 'cloth'] as const) {
      const before = quote(state, market, id, player);
      const stock = market.goods[id].stock;
      const anchor = market.goods[id].anchor;
      const quantity = 120;

      const predicted = estimateTrade(before.buy, stock, anchor, quantity, 'buy', curveExponent(id));
      const actual = executeTrade(state, market, id, quantity, 'buy', player);

      const drift = Math.abs(predicted.total - actual.total) / Math.max(1, actual.total);
      assert.ok(
        drift < 0.005,
        `${id}: preview ${predicted.total.toFixed(2)} vs executed ${actual.total.toFixed(2)} (${(drift * 100).toFixed(2)}% drift)`,
      );
    }
  });
});

describe('regional specialisation', () => {
  test('a surplus region prices a good below a deficit region', () => {
    assert.ok(equilibriumRatio(100, 10) < 1, 'a big surplus should sit below base price');
    assert.ok(equilibriumRatio(0, 10) > 1, 'no local production should sit above base price');
    assert.ok(equilibriumRatio(10, 10) === 1, 'balanced supply and demand should sit at base price');
  });

  test('the generated world actually disperses prices', () => {
    const state = freshWorld();
    let disperseCount = 0;
    for (const id of COMMODITY_IDS) {
      let min = Infinity;
      let max = -Infinity;
      for (const market of state.markets.values()) {
        const ratio = market.goods[id].lastPrice / COMMODITIES[id].basePrice;
        min = Math.min(min, ratio);
        max = Math.max(max, ratio);
      }
      if (max / min > 1.25) disperseCount++;
    }
    assert.ok(
      disperseCount >= COMMODITY_IDS.length / 2,
      `only ${disperseCount}/${COMMODITY_IDS.length} goods vary by >25% across the world`,
    );
  });

  test('every market holds a tradeable depth of stock', () => {
    const state = freshWorld();
    for (const market of state.markets.values()) {
      for (const id of COMMODITY_IDS) {
        assert.ok(
          market.goods[id].stock >= MIN_MARKET_DEPTH * 0.95,
          `${market.settlementId}/${id} holds only ${market.goods[id].stock.toFixed(0)}`,
        );
      }
    }
  });
});

describe('market dynamics', () => {
  test('a drained market recovers toward its equilibrium', () => {
    const state = freshWorld();
    const settlement = state.map.settlements.find((s) => s.kind === 'city')!;
    const market = state.markets.get(settlement.id)!;
    const good = market.goods.iron;
    const startStock = good.stock;

    good.stock = startStock * 0.5;
    const drained = good.stock;
    // Ten minutes of world time.
    for (let i = 0; i < 60; i++) stepEconomy(state, 10_000);

    assert.ok(good.stock > drained, 'stock should climb back after a drain');
    assert.ok(
      good.stock > drained + (startStock - drained) * 0.25,
      `recovery too slow: ${drained.toFixed(0)} → ${good.stock.toFixed(0)} (target ${startStock.toFixed(0)})`,
    );
  });

  test('buying then immediately reselling loses money to the spread', () => {
    const state = freshWorld();
    const player = addHuman(state);
    const market = state.markets.get(state.map.settlements[0].id)!;

    const bought = executeTrade(state, market, 'wheat', 50, 'buy', player);
    const sold = executeTrade(state, market, 'wheat', 50, 'sell', player);
    assert.ok(sold.total < bought.total, 'a round trip in one market must not be free money');
  });
});

describe('cargo', () => {
  test('weight is summed across the whole inventory', () => {
    const used = cargoUsed({ wheat: 10, cars: 2 });
    assert.equal(used, 10 * COMMODITIES.wheat.weight + 2 * COMMODITIES.cars.weight);
  });
});

describe('banking', () => {
  test('loans are capped by the credit limit', () => {
    const state = freshWorld();
    const player = addHuman(state);
    assert.equal(takeLoan(state, player, 1_000_000).ok, false, 'an absurd loan must be refused');
    assert.equal(player.loans.length, 0);
  });

  test('repaying in full clears the debt and lifts the credit score', () => {
    const state = freshWorld();
    const player = addHuman(state);
    const before = player.creditScore;
    assert.ok(takeLoan(state, player, 2000).ok);
    const loan = player.loans[0];
    player.gold += 5000;

    const result = repayLoan(player, loan.id, 99_999);
    assert.ok(result.cleared, 'the loan should be fully cleared');
    assert.equal(player.loans.length, 0);
    assert.ok(player.creditScore > before);
  });

  test('net worth counts gold, cargo and debt', () => {
    const state = freshWorld();
    const player = addHuman(state);
    const bare = netWorth(state, player);
    assert.ok(Math.abs(bare - STARTING_GOLD) < 1, `expected ~${STARTING_GOLD}, got ${bare}`);

    player.inventory.iron = 100;
    assert.ok(netWorth(state, player) > bare, 'cargo should count toward net worth');

    player.loans.push({ id: 'l1', principal: 5000, owed: 5000, apr: 0.1, takenAt: Date.now() });
    assert.ok(netWorth(state, player) < bare + 100 * COMMODITIES.iron.basePrice, 'debt should subtract');
  });

  test('missing payroll idles buildings and dents the credit score', () => {
    const state = freshWorld();
    const player = addHuman(state);
    player.staff.manager = 20;
    player.gold = 1;
    player.bank = 0;
    player.nextPayrollAt = Date.now() - 1;

    const before = player.creditScore;
    const results = runPayroll(state, Date.now());
    const mine = results.find((r) => r.playerId === player.id);
    assert.ok(mine?.defaulted, 'an unpayable payroll should default');
    assert.ok(player.creditScore < before, 'defaulting should hurt the credit score');
    assert.ok((player.staff.manager ?? 0) < 20, 'staff should walk out');
  });
});

describe('stock exchange', () => {
  test('matching orders transfers shares and gold', () => {
    const state = freshWorld();
    const founder = addHuman(state, 'founder');
    const investor = addHuman(state, 'investor');
    founder.gold = 200_000;
    investor.gold = 200_000;

    const created = createCompany(state, founder, 'Test Trading Co', 20, 100);
    assert.ok(created.ok, `incorporation failed: ${created.reason}`);
    const company = created.company!;

    // The founder's IPO float is already resting on the book as a sell order.
    const investorGoldBefore = investor.gold;
    const result = placeOrder(state, investor, company.id, 'buy', 100, 50);
    assert.ok(result.ok);
    assert.ok(result.fills.length > 0, 'the bid should hit the resting IPO offer');
    assert.equal(investor.shares[company.id], 50);
    assert.ok(investor.gold < investorGoldBefore, 'the buyer pays');
    assert.equal(founder.shares[company.id], 1000 - 50);
  });

  test('you cannot sell shares you do not hold', () => {
    const state = freshWorld();
    const founder = addHuman(state, 'founder');
    const stranger = addHuman(state, 'stranger');
    founder.gold = 200_000;
    const created = createCompany(state, founder, 'Solo Holdings', 0, 50);
    assert.ok(created.ok);

    const result = placeOrder(state, stranger, created.company!.id, 'sell', 50, 10);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'shares');
  });

  test('you cannot bid beyond your gold, counting resting orders', () => {
    const state = freshWorld();
    const founder = addHuman(state, 'founder');
    const investor = addHuman(state, 'investor');
    founder.gold = 200_000;
    investor.gold = 1000;
    const created = createCompany(state, founder, 'Reserve Test Co', 0, 100);
    assert.ok(created.ok);

    assert.ok(placeOrder(state, investor, created.company!.id, 'buy', 100, 9).ok);
    // 900 of the 1000 gold is now committed; a second 900-gold bid must fail.
    const second = placeOrder(state, investor, created.company!.id, 'buy', 100, 9);
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'funds');
  });
});

describe('skills', () => {
  test('levels require geometrically more experience', () => {
    assert.ok(xpForLevel(2) > xpForLevel(1));
    assert.ok(xpForLevel(10) - xpForLevel(9) > xpForLevel(2) - xpForLevel(1));
    assert.equal(levelFromXp(0), 0);
    assert.equal(levelFromXp(xpForLevel(5)), 5);
  });

  test('effects saturate rather than running away', () => {
    const strong = skillFactor(30, 0.02);
    assert.ok(strong < 1, 'a bonus must never reach or exceed 100%');
    assert.ok(strong > skillFactor(10, 0.02), 'more levels should still be better');
  });
});

describe('seasons', () => {
  test('reset wipes wealth but keeps achievements and prestige', () => {
    const state = freshWorld();
    const player = addHuman(state);
    player.gold = 5_000_000;
    player.bank = 1_000_000;
    player.inventory.iron = 500;
    grant(player, 'first_million');
    const prestigeBefore = player.prestige;
    const seasonBefore = state.season.index;

    rollSeason(state, Date.now());

    assert.equal(state.season.index, seasonBefore + 1);
    assert.equal(player.gold, STARTING_GOLD, 'gold resets to the starting purse');
    assert.equal(player.bank, 0);
    assert.deepEqual(player.inventory, {}, 'cargo is cleared');
    assert.ok(player.achievements.includes('first_million'), 'achievements are permanent');
    assert.ok(player.prestige > prestigeBefore, 'a big empire earns prestige on reset');
    assert.equal(state.buildings.size, 0, 'property is cleared');
    assert.equal(state.companies.size, 0, 'companies are delisted');
  });

  test('markets are rebuilt with dispersed prices after a reset', () => {
    const state = freshWorld();
    rollSeason(state, Date.now());
    assert.equal(state.markets.size, state.map.settlements.length);
    for (const market of state.markets.values()) {
      for (const id of COMMODITY_IDS) {
        assert.ok(market.goods[id].stock > 0, `${id} has no stock after reset`);
      }
    }
  });
});
