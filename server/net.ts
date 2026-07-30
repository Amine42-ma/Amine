import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '../shared/protocol.js';
import { newId } from '../shared/util.js';
import type { GameState, Player } from './game/state.js';
import { findPlayerByName, findPlayerByToken } from './game/state.js';
import { hashPassword, makePlayer, newToken, verifyPassword } from './game/player.js';
import { handleCommand, type Session } from './game/commands.js';
import { startingSettlement } from './game/rules.js';
import {
  buildAlliances, buildCompanies, buildContracts, buildEvents, buildLeaderboard,
  buildOrders, buildPresence, buildSeason, buildSelf, buildSettlementViews, buildWorldMeta,
} from './game/views.js';

export interface Client {
  id: string;
  socket: WebSocket;
  playerId: string | null;
  session: Session;
  alive: boolean;
  /** Set while the socket is authenticating, to reject command spam. */
  authed: boolean;
}

const MAX_NAME = 18;

export class Hub {
  readonly clients = new Map<string, Client>();

  constructor(private readonly state: GameState) {}

  attach(wss: WebSocketServer) {
    wss.on('connection', (socket) => this.onConnection(socket));
    // Half-open sockets are dropped by a heartbeat rather than lingering forever.
    setInterval(() => {
      for (const client of this.clients.values()) {
        if (!client.alive) {
          client.socket.terminate();
          continue;
        }
        client.alive = false;
        try { client.socket.ping(); } catch { /* socket already gone */ }
      }
    }, 30_000).unref();
  }

  private onConnection(socket: WebSocket) {
    const client: Client = {
      id: newId('cl'),
      socket,
      playerId: null,
      session: { lastMoveAt: Date.now(), lastChatAt: 0 },
      alive: true,
      authed: false,
    };
    this.clients.set(client.id, client);

    socket.on('pong', () => { client.alive = true; });
    socket.on('close', () => { this.clients.delete(client.id); });
    socket.on('error', () => { this.clients.delete(client.id); });

    socket.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return;
      }
      try {
        this.onMessage(client, msg);
      } catch (err) {
        // One bad command must never take the world down.
        console.error('[net] command failed', msg?.t, err);
      }
    });
  }

  private onMessage(client: Client, msg: ClientMessage) {
    if (msg.t === 'auth') return this.handleAuth(client, msg.name, msg.password, msg.mode);
    if (msg.t === 'resume') return this.handleResume(client, msg.token);

    if (!client.authed || !client.playerId) return;
    const player = this.state.players.get(client.playerId);
    if (!player) return;

    if (msg.t === 'requestContracts') {
      this.send(client, {
        t: 'contracts',
        contracts: buildContracts(this.state),
        alliances: buildAlliances(this.state),
      });
      return;
    }

    if (msg.t === 'requestExchange') {
      this.send(client, { t: 'exchange', companies: buildCompanies(this.state), orders: buildOrders(this.state) });
      return;
    }

    handleCommand(
      {
        state: this.state,
        player,
        session: client.session,
        reply: (out) => this.send(client, out),
        broadcastChat: () => this.broadcastChat(),
      },
      msg,
    );

    // Actions that change wealth should show up immediately, not on the next tick.
    if (msg.t !== 'move' && msg.t !== 'ping') this.send(client, { t: 'self', self: buildSelf(this.state, player) });
    if (isExchangeAction(msg)) {
      this.broadcast({ t: 'exchange', companies: buildCompanies(this.state), orders: buildOrders(this.state) });
    }
    if (isDealAction(msg)) {
      this.broadcast({
        t: 'contracts',
        contracts: buildContracts(this.state),
        alliances: buildAlliances(this.state),
      });
    }
    if (isWorldAction(msg)) {
      this.broadcast({ t: 'settlements', settlements: buildSettlementViews(this.state) });
    }
  }

  private handleAuth(client: Client, rawName: string, password: string, mode: 'login' | 'register') {
    const name = String(rawName ?? '').trim().slice(0, MAX_NAME);
    const pass = String(password ?? '');
    if (name.length < 2) return this.send(client, { t: 'authError', reason: 'short_name' });
    if (pass.length < 4) return this.send(client, { t: 'authError', reason: 'short_password' });

    const existing = findPlayerByName(this.state, name);

    if (mode === 'register') {
      if (existing) return this.send(client, { t: 'authError', reason: 'name_taken' });
      const start = startingSettlement(this.state);
      const player = makePlayer(newId('p'), name, start.x, start.y);
      player.auth = hashPassword(pass);
      player.token = newToken();
      player.visited.push(start.id);
      this.state.players.set(player.id, player);
      this.completeAuth(client, player);
      this.systemChat(`انضم ${player.name} إلى العالم.`);
      return;
    }

    if (!existing || !existing.auth || !verifyPassword(pass, existing.auth)) {
      return this.send(client, { t: 'authError', reason: 'bad_credentials' });
    }
    existing.token = newToken();
    this.completeAuth(client, existing);
  }

  private handleResume(client: Client, token: string) {
    const player = findPlayerByToken(this.state, String(token ?? ''));
    if (!player) return this.send(client, { t: 'authError', reason: 'bad_token' });
    this.completeAuth(client, player);
  }

  private completeAuth(client: Client, player: Player) {
    // A second login for the same account replaces the first, rather than desyncing.
    for (const other of this.clients.values()) {
      if (other.id !== client.id && other.playerId === player.id) {
        this.send(other, { t: 'toast', level: 'warn', ar: 'تم تسجيل الدخول من جهاز آخر.', en: 'Signed in from another device.' });
        other.socket.close();
      }
    }

    client.playerId = player.id;
    client.authed = true;
    client.session.lastMoveAt = Date.now();
    player.lastSeen = Date.now();

    this.send(client, {
      t: 'authOk',
      token: player.token!,
      playerId: player.id,
      world: buildWorldMeta(this.state),
      season: buildSeason(this.state),
      now: Date.now(),
    });
    this.send(client, { t: 'self', self: buildSelf(this.state, player) });
    this.send(client, { t: 'events', active: buildEvents(this.state) });
    this.send(client, { t: 'leaderboard', rows: buildLeaderboard(this.state) });
    this.send(client, { t: 'chat', messages: this.state.chat.slice(-40) });
    this.send(client, { t: 'exchange', companies: buildCompanies(this.state), orders: buildOrders(this.state) });
    this.send(client, {
      t: 'contracts',
      contracts: buildContracts(this.state),
      alliances: buildAlliances(this.state),
    });
  }

  send(client: Client, msg: ServerMessage) {
    if (client.socket.readyState !== WebSocket.OPEN) return;
    client.socket.send(JSON.stringify(msg));
  }

  sendToPlayer(playerId: string, msg: ServerMessage) {
    for (const client of this.clients.values()) {
      if (client.playerId === playerId) this.send(client, msg);
    }
  }

  broadcast(msg: ServerMessage) {
    const payload = JSON.stringify(msg);
    for (const client of this.clients.values()) {
      if (!client.authed) continue;
      if (client.socket.readyState === WebSocket.OPEN) client.socket.send(payload);
    }
  }

  broadcastChat() {
    this.broadcast({ t: 'chat', messages: this.state.chat.slice(-40) });
  }

  systemChat(text: string) {
    this.state.chat.push({ id: newId('m'), from: 'العالم', text, at: Date.now(), channel: 'system' });
    while (this.state.chat.length > 60) this.state.chat.shift();
    this.broadcastChat();
  }

  /** Per-client presence snapshot, scoped to each viewer's area of interest. */
  pushSnapshots() {
    for (const client of this.clients.values()) {
      if (!client.authed || !client.playerId) continue;
      const player = this.state.players.get(client.playerId);
      if (!player) continue;
      const presence = buildPresence(this.state, player);
      this.send(client, { t: 'presence', players: presence.players, convoys: presence.convoys });
    }
  }

  pushSelfAll() {
    for (const client of this.clients.values()) {
      if (!client.authed || !client.playerId) continue;
      const player = this.state.players.get(client.playerId);
      if (player) this.send(client, { t: 'self', self: buildSelf(this.state, player) });
    }
  }

  onlinePlayerIds(): string[] {
    const ids: string[] = [];
    for (const client of this.clients.values()) if (client.playerId) ids.push(client.playerId);
    return ids;
  }
}

function isExchangeAction(msg: ClientMessage): boolean {
  return msg.t === 'orderPlace' || msg.t === 'orderCancel' || msg.t === 'companyCreate';
}

function isDealAction(msg: ClientMessage): boolean {
  return msg.t === 'contractCreate' || msg.t === 'contractAccept' || msg.t === 'contractCancel'
    || msg.t === 'allianceCreate' || msg.t === 'allianceJoin' || msg.t === 'allianceLeave';
}

function isWorldAction(msg: ClientMessage): boolean {
  return msg.t === 'buildingBuy' || msg.t === 'buildingSell';
}
