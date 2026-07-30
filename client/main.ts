import type { ServerMessage } from '../shared/protocol.js';
import { clamp, lerp } from '../shared/util.js';
import { BASE_SPEED } from '../shared/constants.js';
import { VEHICLES } from '../shared/vehicles.js';
import { store, bump, on } from './store.js';
import { connect, send, onMessage, loadTiles } from './net.js';
import { initLang, applyStaticStrings, toggleLang, t, getLang } from './i18n.js';
import { Camera } from './render/camera.js';
import { drawScene, settlementAtScreen } from './render/scene.js';
import { drawMinimap, minimapToWorld } from './render/minimap.js';
import { $ } from './ui/dom.js';
import { initHud, toast, achievementToast, hint } from './ui/hud.js';
import { initPanels, openPanel, renderActive } from './ui/panels/index.js';
import type { SettlementView } from '../shared/protocol.js';

/**
 * Client entry point: owns the render loop, input handling, and the mapping from
 * server messages into the store. Movement is predicted locally and reconciled
 * against the server's authoritative position.
 */

const canvas = $<HTMLCanvasElement>('stage');
const ctx = canvas.getContext('2d')!;
const camera = new Camera(window.innerWidth, window.innerHeight);

let hoverSettlement: SettlementView | null = null;
/** Local prediction of where we are, sent up ~15×/s and corrected by the server. */
const predicted = { x: 0, y: 0, ready: false };
let travelTarget: { x: number; y: number } | null = null;
const keys = new Set<string>();

/* ------------------------------------------------------------------ canvas */

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  camera.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

/* ------------------------------------------------------------------- input */

window.addEventListener('keydown', (ev) => {
  const target = ev.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
    return;
  }
  keys.add(ev.key.toLowerCase());
  // Keyboard steering cancels a click-to-travel order.
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(ev.key.toLowerCase())) {
    travelTarget = null;
    ev.preventDefault();
  }
  if (ev.key === 'Enter') $<HTMLInputElement>('chat-input').focus();
  if (ev.key.toLowerCase() === 'm') openPanel('market');
  if (ev.key.toLowerCase() === 'b') openPanel('build');
  if (ev.key.toLowerCase() === 'e') openPanel('empire');
});
window.addEventListener('keyup', (ev) => keys.delete(ev.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

canvas.addEventListener('pointermove', (ev) => {
  hoverSettlement = settlementAtScreen(camera, ev.clientX, ev.clientY);
  canvas.style.cursor = hoverSettlement ? 'pointer' : 'crosshair';
});

canvas.addEventListener('pointerdown', (ev) => {
  if (!store.self) return;
  const target = settlementAtScreen(camera, ev.clientX, ev.clientY);
  const [wx, wy] = camera.screenToWorld(ev.clientX, ev.clientY);
  travelTarget = target ? { x: target.x, y: target.y } : { x: wx, y: wy };
});

canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  camera.nudgeZoom(ev.deltaY);
}, { passive: false });

const minimap = $<HTMLCanvasElement>('minimap');
minimap.addEventListener('click', (ev) => {
  const point = minimapToWorld(minimap, ev);
  // The minimap is a planning tool: clicking it pans the camera, not the player.
  if (point) { camera.x = point[0]; camera.y = point[1]; }
});

/* ----------------------------------------------------------------- movement */

function stepMovement(dt: number) {
  const self = store.self;
  if (!self) return;
  if (!predicted.ready) {
    predicted.x = self.x;
    predicted.y = self.y;
    predicted.ready = true;
  }

  const speed = BASE_SPEED * VEHICLES[self.vehicle].personalSpeedMul;
  let dx = 0;
  let dy = 0;

  if (keys.has('w') || keys.has('arrowup')) dy -= 1;
  if (keys.has('s') || keys.has('arrowdown')) dy += 1;
  if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
  if (keys.has('d') || keys.has('arrowright')) dx += 1;

  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy);
    predicted.x += (dx / len) * speed * dt;
    predicted.y += (dy / len) * speed * dt;
  } else if (travelTarget) {
    const tx = travelTarget.x - predicted.x;
    const ty = travelTarget.y - predicted.y;
    const d = Math.hypot(tx, ty);
    if (d < 0.4) {
      travelTarget = null;
    } else {
      const step = Math.min(speed * dt, d);
      predicted.x += (tx / d) * step;
      predicted.y += (ty / d) * step;
    }
  }

  const world = store.world;
  if (world) {
    predicted.x = clamp(predicted.x, 0, world.width - 1);
    predicted.y = clamp(predicted.y, 0, world.height - 1);
  }

  // Reconcile: if the server disagrees badly (blocked water, anti-cheat clamp),
  // ease back to its position rather than snapping.
  const drift = Math.hypot(self.x - predicted.x, self.y - predicted.y);
  if (drift > 6) {
    predicted.x = self.x;
    predicted.y = self.y;
    travelTarget = null;
  } else if (drift > 0.6) {
    predicted.x = lerp(predicted.x, self.x, 0.12);
    predicted.y = lerp(predicted.y, self.y, 0.12);
  }

  self.x = predicted.x;
  self.y = predicted.y;
}

let lastSent = 0;
function sendMovement(now: number) {
  if (!store.self || now - lastSent < 66) return;
  lastSent = now;
  send({ t: 'move', x: predicted.x, y: predicted.y });
}

/* ------------------------------------------------------------- render loop */

let lastFrame = performance.now();
let minimapAccumulator = 0;

function frame(now: number) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  stepMovement(dt);
  sendMovement(now);

  // Smooth other players toward their last reported position.
  for (const [, entry] of store.lerp) {
    entry.x = lerp(entry.x, entry.tx, 1 - Math.pow(0.0001, dt));
    entry.y = lerp(entry.y, entry.ty, 1 - Math.pow(0.0001, dt));
  }

  const self = store.self;
  const world = store.world;
  if (self && world) camera.follow(self.x, self.y, dt, world.width, world.height);

  drawScene({ ctx, camera, time: now / 1000, hoverSettlement });

  minimapAccumulator += dt;
  if (minimapAccumulator > 0.2) {
    minimapAccumulator = 0;
    drawMinimap(minimap, camera);
  }

  requestAnimationFrame(frame);
}

/* --------------------------------------------------------------- messaging */

onMessage((msg: ServerMessage) => {
  switch (msg.t) {
    case 'authOk': {
      localStorage.setItem('eom.token', msg.token);
      store.playerId = msg.playerId;
      store.world = msg.world;
      store.settlements = msg.world.settlements;
      store.season = msg.season;
      store.clockSkew = msg.now - Date.now();
      $('gate').classList.add('hidden');
      $('hud').classList.remove('hidden');
      predicted.ready = false;
      bump('settlements');
      bump('season');
      hint(t('travelHint'));
      break;
    }

    case 'authError': {
      const map: Record<string, string> = {
        short_name: 'errShortName',
        short_password: 'errShortPassword',
        name_taken: 'errNameTaken',
        bad_credentials: 'errBadCredentials',
        bad_token: 'errBadToken',
      };
      if (msg.reason === 'bad_token') {
        // A stale token just means "log in again", not an error worth shouting.
        localStorage.removeItem('eom.token');
        $('gate').classList.remove('hidden');
        $('hud').classList.add('hidden');
      }
      $('gate-error').textContent = t(map[msg.reason] ?? 'errBadCredentials');
      break;
    }

    case 'self': {
      // The authoritative position stays on the message; stepMovement reconciles
      // our prediction against it rather than snapping the camera every update.
      store.self = msg.self;
      if (!predicted.ready) {
        predicted.x = msg.self.x;
        predicted.y = msg.self.y;
        predicted.ready = true;
      }
      bump('self');
      break;
    }

    case 'presence': {
      store.others = msg.players;
      store.convoys = msg.convoys;
      const seen = new Set<string>();
      for (const p of msg.players) {
        seen.add(p.id);
        const entry = store.lerp.get(p.id);
        if (entry) { entry.tx = p.x; entry.ty = p.y; }
        else store.lerp.set(p.id, { x: p.x, y: p.y, tx: p.x, ty: p.y });
      }
      for (const id of [...store.lerp.keys()]) if (!seen.has(id)) store.lerp.delete(id);
      break;
    }

    case 'market': store.market = msg.market; bump('market'); break;
    case 'settlements': store.settlements = msg.settlements; bump('settlements'); break;
    case 'exchange':
      store.companies = msg.companies;
      store.orders = msg.orders;
      bump('exchange');
      break;
    case 'events': store.events = msg.active ?? []; bump('events'); break;
    case 'leaderboard': store.leaderboard = msg.rows; bump('leaderboard'); break;
    case 'chat': store.chat = msg.messages; bump('chat'); break;
    case 'prices':
      store.priceIndex = msg.index;
      store.movers = msg.movers;
      bump('prices');
      break;
    case 'toast': toast(getLang() === 'ar' ? msg.ar : msg.en, msg.level); break;
    case 'achievement': achievementToast(msg.id); break;
    case 'season':
      store.season = msg.season;
      bump('season');
      if (msg.reset) toast(t('seasonReset'), 'good');
      break;
    case 'pong':
      store.clockSkew = msg.now - Date.now();
      break;
    default:
      break;
  }
});

// The server names the active event set; the strip needs a redraw either way.
on('events', () => renderActive());

/* -------------------------------------------------------------------- gate */

function initGate() {
  const nameInput = $<HTMLInputElement>('gate-name');
  const passInput = $<HTMLInputElement>('gate-pass');
  const error = $('gate-error');

  const submit = (mode: 'login' | 'register') => {
    error.textContent = '';
    const name = nameInput.value.trim();
    const password = passInput.value;
    if (name.length < 2) { error.textContent = t('errShortName'); return; }
    if (password.length < 4) { error.textContent = t('errShortPassword'); return; }
    send({ t: 'auth', name, password, mode });
  };

  $('gate-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    submit('register');
  });
  $('gate-login').addEventListener('click', () => submit('login'));
  $('gate-lang').addEventListener('click', () => toggleLang());

  const saved = localStorage.getItem('eom.name');
  if (saved) nameInput.value = saved;
  nameInput.addEventListener('change', () => localStorage.setItem('eom.name', nameInput.value.trim()));

  on('needAuth', () => {
    $('gate').classList.remove('hidden');
    $('hud').classList.add('hidden');
  });
  on('connection', () => {
    if (!store.connected) toast(t('disconnected'), 'warn');
  });
}

/* ------------------------------------------------------------------- boot */

async function boot() {
  initLang();
  applyStaticStrings();
  initGate();
  initHud();
  initPanels();
  connect();

  try {
    store.tiles = await loadTiles();
  } catch (err) {
    console.error('[boot] failed to load terrain', err);
  }

  requestAnimationFrame(frame);
}

void boot();
