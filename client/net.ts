import type { ClientMessage, ServerMessage } from '../shared/protocol.js';
import { store, bump } from './store.js';

/**
 * WebSocket transport with automatic reconnect and token-based resume, so a
 * dropped connection puts the player straight back into the same empire.
 */

let socket: WebSocket | null = null;
let reconnectDelay = 800;
let intentionalClose = false;

type Handler = (msg: ServerMessage) => void;
const handlers = new Set<Handler>();

export function onMessage(fn: Handler): () => void {
  handlers.add(fn);
  return () => handlers.delete(fn);
}

export function send(msg: ClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export function connect() {
  intentionalClose = false;
  socket = new WebSocket(wsUrl());

  socket.addEventListener('open', () => {
    reconnectDelay = 800;
    store.connected = true;
    bump('connection');
    const token = localStorage.getItem('eom.token');
    if (token) send({ t: 'resume', token });
    else bump('needAuth');
    // A periodic ping keeps the clock offset accurate and the socket warm.
    schedulePing();
  });

  socket.addEventListener('message', (ev) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(ev.data as string) as ServerMessage;
    } catch {
      return;
    }
    for (const fn of handlers) {
      try {
        fn(msg);
      } catch (err) {
        console.error('[net] handler failed for', msg.t, err);
      }
    }
  });

  socket.addEventListener('close', () => {
    store.connected = false;
    bump('connection');
    if (intentionalClose) return;
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.7, 12_000);
  });

  socket.addEventListener('error', () => socket?.close());
}

export function disconnect() {
  intentionalClose = true;
  socket?.close();
}

let pingTimer: number | undefined;
function schedulePing() {
  clearInterval(pingTimer);
  pingTimer = window.setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) send({ t: 'ping', at: Date.now() });
  }, 10_000);
}

/** Fetches the raw terrain grid once per session. */
export async function loadTiles(): Promise<Uint8Array> {
  const res = await fetch('/api/tiles');
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}
