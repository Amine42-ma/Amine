import { TICK_MS, SNAPSHOT_MS } from '../shared/constants.js';
import { COMMODITY_IDS } from '../shared/commodities.js';
import { EVENT_BY_ID } from '../shared/events.js';
import { ACHIEVEMENT_BY_ID } from '../shared/achievements.js';
import { round2 } from '../shared/util.js';
import type { GameState } from './game/state.js';
import type { Hub } from './net.js';
import { stepEconomy, worldAverage } from './sim/economy.js';
import { stepProduction } from './sim/production.js';
import { stepConvoys } from './sim/convoys.js';
import { stepAi } from './sim/ai.js';
import { stepEvents } from './sim/events.js';
import { runPayroll, stepBank } from './sim/bank.js';
import { payDividends, stepExchange } from './sim/stocks.js';
import { rollSeason, shouldRollSeason } from './sim/seasons.js';
import { expireContracts } from './sim/contracts.js';
import { pruneAlliances } from './sim/alliances.js';
import { checkAchievements } from './game/achievements.js';
import {
  buildCompanies, buildEvents, buildLeaderboard, buildOrders, buildSeason,
} from './game/views.js';

/**
 * The world clock. Everything the simulation does is driven from here, keyed off
 * wall-clock deltas so the world keeps its own time even if a tick runs late.
 */

export interface LoopHandles {
  stop(): void;
}

export function startLoop(state: GameState, hub: Hub, onSave: () => void): LoopHandles {
  let lastPriceBroadcast = 0;
  let lastLeaderboard = 0;
  let lastProfitWindow = Date.now();
  let lastSave = Date.now();
  const previousAverages = new Map<string, number>();

  const tick = setInterval(() => {
    const now = Date.now();
    // Clamp the delta so a paused process does not fast-forward the economy wildly.
    const dt = Math.min(now - state.lastTick, 5 * 60_000);
    state.lastTick = now;
    if (dt <= 0) return;

    const { started, ended } = stepEvents(state, now, Math.random);
    stepEconomy(state, dt);
    stepProduction(state, dt);
    stepConvoys(state, dt);
    stepAi(state, dt);
    stepBank(state, dt);
    stepExchange(state, dt);

    for (const ev of started) {
      const def = EVENT_BY_ID[ev.defId];
      if (!def) continue;
      const where = ev.region ? ` — ${ev.region}` : '';
      hub.systemChat(`${def.icon} ${def.ar}${where}: ${def.ar_desc}`);
    }
    if (started.length > 0 || ended.length > 0) {
      hub.broadcast({ t: 'events', active: buildEvents(state) });
    }

    expireContracts(state, now);
    pruneAlliances(state);

    const payroll = runPayroll(state, now);
    for (const result of payroll) {
      if (result.defaulted) {
        hub.sendToPlayer(result.playerId, {
          t: 'toast', level: 'bad',
          ar: 'لم تستطع دفع الرواتب! غادر نصف موظفيك وتوقفت مبانيك.',
          en: 'You missed payroll! Half your staff walked out and your buildings idled.',
        });
      } else if (result.cost > 0) {
        hub.sendToPlayer(result.playerId, {
          t: 'toast', level: 'info',
          ar: `تم دفع الرواتب: ${result.cost} ذهب.`,
          en: `Payroll paid: ${result.cost} gold.`,
        });
      }
    }

    // Close the accounting window once a minute: that number values companies.
    if (now - lastProfitWindow >= 60_000) {
      lastProfitWindow = now;
      for (const p of state.players.values()) {
        p.lastProfit = p.windowRevenue - p.windowCost;
        p.windowRevenue = 0;
        p.windowCost = 0;
      }
      payDividends(state);
      hub.broadcast({ t: 'exchange', companies: buildCompanies(state), orders: buildOrders(state) });
    }

    for (const playerId of hub.onlinePlayerIds()) {
      const player = state.players.get(playerId);
      if (!player) continue;
      for (const id of checkAchievements(state, player)) {
        hub.sendToPlayer(playerId, { t: 'achievement', id });
        const def = ACHIEVEMENT_BY_ID[id];
        if (def) hub.systemChat(`${def.icon} ${player.name} حقق إنجاز «${def.ar}»`);
      }
    }

    if (now - lastPriceBroadcast >= 15_000) {
      lastPriceBroadcast = now;
      const movers = COMMODITY_IDS.map((id) => {
        const avg = worldAverage(state, id);
        const prev = previousAverages.get(id) ?? avg;
        previousAverages.set(id, avg);
        return { id, change: round2(prev > 0 ? (avg - prev) / prev : 0) };
      })
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
        .slice(0, 8);
      hub.broadcast({ t: 'prices', index: round2(state.priceIndex), movers });
      hub.pushSelfAll();
    }

    if (now - lastLeaderboard >= 20_000) {
      lastLeaderboard = now;
      hub.broadcast({ t: 'leaderboard', rows: buildLeaderboard(state) });
    }

    if (shouldRollSeason(state, now)) {
      rollSeason(state, now);
      hub.broadcast({ t: 'season', season: buildSeason(state), reset: true });
      hub.pushSelfAll();
      onSave();
    }

    if (now - lastSave >= 30_000) {
      lastSave = now;
      onSave();
    }
  }, TICK_MS);

  const snapshots = setInterval(() => hub.pushSnapshots(), SNAPSHOT_MS);

  return {
    stop() {
      clearInterval(tick);
      clearInterval(snapshots);
    },
  };
}
