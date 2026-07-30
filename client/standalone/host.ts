import type { ClientMessage, ServerMessage } from '../../shared/protocol.js';
import { TICK_MS, SNAPSHOT_MS } from '../../shared/constants.js';
import { COMMODITY_IDS } from '../../shared/commodities.js';
import { EVENT_BY_ID } from '../../shared/events.js';
import { ACHIEVEMENT_BY_ID } from '../../shared/achievements.js';
import { hashString, newId, round2 } from '../../shared/util.js';

import type { GameState, Player } from '../../server/game/state.js';
import { findPlayerByName } from '../../server/game/state.js';
import { createFreshState } from '../../server/game/bootstrap.js';
import { makePlayer } from '../../server/game/player.js';
import { startingSettlement } from '../../server/game/rules.js';
import { handleCommand, type Session } from '../../server/game/commands.js';
import { checkAchievements } from '../../server/game/achievements.js';
import {
  buildAlliances, buildCompanies, buildContracts, buildEvents, buildLeaderboard,
  buildOrders, buildPresence, buildSeason, buildSelf, buildSettlementViews, buildWorldMeta,
} from '../../server/game/views.js';

import { stepEconomy, worldAverage } from '../../server/sim/economy.js';
import { stepProduction } from '../../server/sim/production.js';
import { stepConvoys } from '../../server/sim/convoys.js';
import { stepAi } from '../../server/sim/ai.js';
import { stepEvents } from '../../server/sim/events.js';
import { runPayroll, stepBank } from '../../server/sim/bank.js';
import { payDividends, stepExchange } from '../../server/sim/stocks.js';
import { rollSeason, shouldRollSeason } from '../../server/sim/seasons.js';
import { expireContracts } from '../../server/sim/contracts.js';
import { pruneAlliances } from '../../server/sim/alliances.js';

import { loadSnapshot, saveSnapshot } from './storage.js';

/**
 * The whole world, running inside the page.
 *
 * This is the same simulation the dedicated server runs — identical modules,
 * identical protocol — with the WebSocket replaced by a direct function call.
 * That keeps the single-file build honest: it is the real game, not a cut-down
 * imitation of it, and the NPC merchants supply the rival traders.
 */

const DEFAULT_SEED = hashString('empire-of-merchants');

export class LocalHost {
  private state: GameState;
  private playerId: string | null = null;
  private session: Session = { lastMoveAt: Date.now(), lastChatAt: 0 };
  private listeners = new Set<(msg: ServerMessage) => void>();
  private timers: number[] = [];

  private lastPriceBroadcast = 0;
  private lastLeaderboard = 0;
  private lastProfitWindow = Date.now();
  private lastSave = Date.now();
  private previousAverages = new Map<string, number>();

  constructor(seed = DEFAULT_SEED) {
    this.state = loadSnapshot(seed) ?? createFreshState(seed);
  }

  onMessage(fn: (msg: ServerMessage) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(msg: ServerMessage) {
    for (const fn of this.listeners) {
      try {
        fn(msg);
      } catch (err) {
        console.error('[host] listener failed for', msg.t, err);
      }
    }
  }

  /** Entry point for everything the UI does — mirrors the server's router. */
  send(msg: ClientMessage) {
    try {
      this.route(msg);
    } catch (err) {
      console.error('[host] command failed', msg.t, err);
    }
  }

  private route(msg: ClientMessage) {
    if (msg.t === 'auth') return this.handleAuth(msg.name);
    if (msg.t === 'resume') return this.handleResume();

    const player = this.playerId ? this.state.players.get(this.playerId) : null;
    if (!player) return;

    if (msg.t === 'requestContracts') {
      return this.emit({
        t: 'contracts',
        contracts: buildContracts(this.state),
        alliances: buildAlliances(this.state),
      });
    }
    if (msg.t === 'requestExchange') {
      return this.emit({
        t: 'exchange',
        companies: buildCompanies(this.state),
        orders: buildOrders(this.state),
      });
    }

    handleCommand(
      {
        state: this.state,
        player,
        session: this.session,
        reply: (out) => this.emit(out),
        broadcastChat: () => this.emit({ t: 'chat', messages: this.state.chat.slice(-40) }),
      },
      msg,
    );

    if (msg.t !== 'move' && msg.t !== 'ping') this.emit({ t: 'self', self: buildSelf(this.state, player) });
    if (msg.t === 'orderPlace' || msg.t === 'orderCancel' || msg.t === 'companyCreate') {
      this.emit({ t: 'exchange', companies: buildCompanies(this.state), orders: buildOrders(this.state) });
    }
    if (msg.t.startsWith('contract') || msg.t.startsWith('alliance')) {
      this.emit({
        t: 'contracts',
        contracts: buildContracts(this.state),
        alliances: buildAlliances(this.state),
      });
    }
    if (msg.t === 'buildingBuy' || msg.t === 'buildingSell') {
      this.emit({ t: 'settlements', settlements: buildSettlementViews(this.state) });
    }
  }

  /**
   * Offline play has no accounts to protect, so the name simply picks which
   * merchant you are: an existing one is resumed, a new one is created.
   */
  private handleAuth(rawName: string) {
    const name = String(rawName ?? '').trim().slice(0, 18);
    if (name.length < 2) return this.emit({ t: 'authError', reason: 'short_name' });

    const existing = findPlayerByName(this.state, name);
    if (existing && !existing.isNpc) return this.completeAuth(existing);

    const start = startingSettlement(this.state);
    const player = makePlayer(newId('p'), name, start.x, start.y);
    player.token = 'local';
    player.visited.push(start.id);
    this.state.players.set(player.id, player);
    this.completeAuth(player);
    this.systemChat(`انضم ${player.name} إلى العالم.`);
  }

  private handleResume() {
    // Whoever was playing last in this browser.
    for (const p of this.state.players.values()) {
      if (!p.isNpc) return this.completeAuth(p);
    }
    this.emit({ t: 'authError', reason: 'bad_token' });
  }

  private completeAuth(player: Player) {
    this.playerId = player.id;
    this.session.lastMoveAt = Date.now();
    player.lastSeen = Date.now();

    this.emit({
      t: 'authOk',
      token: 'local',
      playerId: player.id,
      world: buildWorldMeta(this.state),
      season: buildSeason(this.state),
      now: Date.now(),
    });
    this.emit({ t: 'self', self: buildSelf(this.state, player) });
    this.emit({ t: 'events', active: buildEvents(this.state) });
    this.emit({ t: 'leaderboard', rows: buildLeaderboard(this.state) });
    this.emit({ t: 'chat', messages: this.state.chat.slice(-40) });
    this.emit({ t: 'exchange', companies: buildCompanies(this.state), orders: buildOrders(this.state) });
    this.emit({
      t: 'contracts',
      contracts: buildContracts(this.state),
      alliances: buildAlliances(this.state),
    });
  }

  private systemChat(text: string) {
    this.state.chat.push({ id: newId('m'), from: 'العالم', text, at: Date.now(), channel: 'system' });
    while (this.state.chat.length > 60) this.state.chat.shift();
    this.emit({ t: 'chat', messages: this.state.chat.slice(-40) });
  }

  /** Starts the world clock. Identical cadence to the dedicated server. */
  start() {
    this.timers.push(window.setInterval(() => this.tick(), TICK_MS));
    this.timers.push(window.setInterval(() => this.pushSnapshot(), SNAPSHOT_MS));
    // A last save on the way out means closing the tab does not lose progress.
    window.addEventListener('beforeunload', () => this.save());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.save();
    });
  }

  stop() {
    for (const id of this.timers) window.clearInterval(id);
    this.timers = [];
  }

  private save() {
    saveSnapshot(this.state);
  }

  private pushSnapshot() {
    const player = this.playerId ? this.state.players.get(this.playerId) : null;
    if (!player) return;
    const presence = buildPresence(this.state, player);
    this.emit({ t: 'presence', players: presence.players, convoys: presence.convoys });
  }

  private tick() {
    const state = this.state;
    const now = Date.now();
    // Background tabs throttle timers, so the delta can be large; the same clamp
    // the server uses keeps a long pause from fast-forwarding the economy.
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
      this.systemChat(`${def.icon} ${def.ar}${ev.region ? ` — ${ev.region}` : ''}: ${def.ar_desc}`);
    }
    if (started.length > 0 || ended.length > 0) {
      this.emit({ t: 'events', active: buildEvents(state) });
    }

    expireContracts(state, now);
    pruneAlliances(state);

    for (const result of runPayroll(state, now)) {
      if (result.playerId !== this.playerId) continue;
      this.emit(result.defaulted
        ? {
            t: 'toast', level: 'bad',
            ar: 'لم تستطع دفع الرواتب! غادر نصف موظفيك وتوقفت مبانيك.',
            en: 'You missed payroll! Half your staff walked out and your buildings idled.',
          }
        : {
            t: 'toast', level: 'info',
            ar: `تم دفع الرواتب: ${result.cost} ذهب.`,
            en: `Payroll paid: ${result.cost} gold.`,
          });
    }

    if (now - this.lastProfitWindow >= 60_000) {
      this.lastProfitWindow = now;
      for (const p of state.players.values()) {
        p.lastProfit = p.windowRevenue - p.windowCost;
        p.windowRevenue = 0;
        p.windowCost = 0;
      }
      payDividends(state);
      this.emit({ t: 'exchange', companies: buildCompanies(state), orders: buildOrders(state) });
    }

    const player = this.playerId ? state.players.get(this.playerId) : null;
    if (player) {
      for (const id of checkAchievements(state, player)) {
        this.emit({ t: 'achievement', id });
        const def = ACHIEVEMENT_BY_ID[id];
        if (def) this.systemChat(`${def.icon} ${player.name} حقق إنجاز «${def.ar}»`);
      }
    }

    if (now - this.lastPriceBroadcast >= 15_000) {
      this.lastPriceBroadcast = now;
      const movers = COMMODITY_IDS.map((id) => {
        const avg = worldAverage(state, id);
        const prev = this.previousAverages.get(id) ?? avg;
        this.previousAverages.set(id, avg);
        return { id, change: round2(prev > 0 ? (avg - prev) / prev : 0) };
      })
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
        .slice(0, 8);
      this.emit({ t: 'prices', index: round2(state.priceIndex), movers });
      if (player) this.emit({ t: 'self', self: buildSelf(state, player) });
    }

    if (now - this.lastLeaderboard >= 20_000) {
      this.lastLeaderboard = now;
      this.emit({ t: 'leaderboard', rows: buildLeaderboard(state) });
    }

    if (shouldRollSeason(state, now)) {
      rollSeason(state, now);
      this.emit({ t: 'season', season: buildSeason(state), reset: true });
      if (player) this.emit({ t: 'self', self: buildSelf(state, player) });
      this.save();
    }

    if (now - this.lastSave >= 30_000) {
      this.lastSave = now;
      this.save();
    }
  }

  /** The terrain grid, for the renderer. */
  tiles(): Uint8Array {
    return this.state.map.tiles;
  }

  /** Throws the current world away and starts a new one. */
  reset(seed = DEFAULT_SEED) {
    this.stop();
    this.state = createFreshState(seed);
    this.playerId = null;
    saveSnapshot(this.state);
  }
}
