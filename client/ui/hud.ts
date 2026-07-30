import { COMMODITIES } from '../../shared/commodities.js';
import { EVENT_BY_ID } from '../../shared/events.js';
import { ACHIEVEMENT_BY_ID } from '../../shared/achievements.js';
import { fmtGold, fmtDuration } from '../../shared/util.js';
import { store, on, bump, serverNow, currentSettlement } from '../store.js';
import { send } from '../net.js';
import { t, name, describe, settlementName, getLang } from '../i18n.js';
import { $, el, clear } from './dom.js';
import { openPanel, PANELS, activePanel } from './panels/index.js';

/** Everything permanently on screen: stats, events, dock, chat and toasts. */

export function initHud() {
  buildDock();
  wireChat();

  on('self', renderStats);
  on('season', renderStats);
  on('events', renderEvents);
  on('prices', renderTicker);
  on('chat', renderChat);
  on('self', renderNearby);
  on('settlements', renderNearby);

  // The season countdown ticks locally between server updates.
  setInterval(() => {
    renderStats();
    renderEvents();
  }, 1000);

  $('btn-lang').addEventListener('click', () => {
    import('../i18n.js').then((m) => {
      m.toggleLang();
      buildDock();
      renderStats();
      renderEvents();
      renderTicker();
      renderChat();
      renderNearby();
      bump('lang');
    });
  });
}

/* -------------------------------------------------------------------- dock */

function buildDock() {
  const dock = $('dock');
  clear(dock);
  for (const panel of PANELS) {
    const button = el('button', {
      onclick: () => openPanel(panel.id),
      title: t(panel.labelKey),
    }, el('span', {}, panel.icon), el('em', { style: 'font-style:normal' }, t(panel.labelKey)));
    button.dataset.panel = panel.id;
    dock.appendChild(button);
  }
  syncDock();
}

export function syncDock() {
  const active = activePanel();
  document.querySelectorAll<HTMLElement>('#dock button').forEach((button) => {
    button.classList.toggle('active', button.dataset.panel === active);
  });
}

/* ------------------------------------------------------------------- stats */

function renderStats() {
  const self = store.self;
  if (!self) return;
  $('stat-gold').textContent = fmtGold(self.gold);
  $('stat-worth').textContent = fmtGold(self.netWorth);
  $('stat-cargo').textContent = `${Math.round(self.inventory.used)}/${self.inventory.capacity}`;
  $('stat-bank').textContent = fmtGold(self.bank);

  const season = store.season;
  if (season) {
    const left = Math.max(0, season.endsAt - serverNow());
    $('stat-season').textContent = `${season.index} · ${fmtDuration(left)}`;
  }

  // Cargo turns amber when the cart is nearly full — a nudge to go sell.
  const cargoStat = $('stat-cargo');
  const ratio = self.inventory.capacity > 0 ? self.inventory.used / self.inventory.capacity : 0;
  cargoStat.style.color = ratio > 0.92 ? 'var(--warn)' : '';
}

/* ------------------------------------------------------------------ events */

function renderEvents() {
  const strip = $('events-strip');
  clear(strip);
  const now = serverNow();
  const here = currentSettlement();

  for (const active of store.events) {
    const def = EVENT_BY_ID[active.defId];
    if (!def) continue;
    const global = active.region === null;
    // Regional events only matter where you are standing; dim the rest.
    const relevant = global || active.region === here?.region;
    const chip = el('div',
      { class: `event-chip${global ? ' global' : ''}`, style: relevant ? '' : 'opacity:.45', title: describe(def) },
      el('span', {}, def.icon),
      el('span', {}, name(def)),
      active.region ? el('small', {}, ` · ${active.region}`) : null,
      el('small', {}, ` ${fmtDuration(Math.max(0, active.endsAt - now))}`),
    );
    strip.appendChild(chip);
  }
}

/* ------------------------------------------------------------------ ticker */

function renderTicker() {
  const ticker = $('ticker');
  clear(ticker);
  for (const mover of store.movers.slice(0, 6)) {
    const good = COMMODITIES[mover.id];
    if (!good) continue;
    const up = mover.change >= 0;
    ticker.appendChild(el('span', { class: up ? 'up' : 'down' },
      `${good.icon} ${name(good)} ${up ? '▲' : '▼'}${Math.abs(mover.change * 100).toFixed(1)}%`,
    ));
  }
}

/* -------------------------------------------------------------------- chat */

function wireChat() {
  const input = $<HTMLInputElement>('chat-input');
  input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    const text = input.value.trim();
    if (text) send({ t: 'chat', text });
    input.value = '';
    input.blur();
  });
}

function renderChat() {
  const log = $('chat-log');
  clear(log);
  for (const msg of store.chat.slice(-24)) {
    log.appendChild(el('div', { class: msg.channel === 'system' ? 'system' : '' },
      el('b', {}, `${msg.from}: `),
      msg.text,
    ));
  }
  log.scrollTop = log.scrollHeight;
}

/* ------------------------------------------------------------------ nearby */

function renderNearby() {
  const wrap = $('nearby');
  clear(wrap);
  const here = currentSettlement();
  if (!here) {
    wrap.appendChild(el('div', { class: 'nearby-card' },
      el('h3', {}, '🧭 ', t('travelHint')),
      el('p', {}, t('notInSettlement')),
    ));
    return;
  }

  const kindIcon = here.kind === 'city' ? '🏛️' : here.kind === 'port' ? '⚓' : here.kind === 'island' ? '🏝️' : '🏘️';
  wrap.appendChild(el('div', { class: 'nearby-card' },
    el('h3', {}, `${kindIcon} `, settlementName(here)),
    el('p', {},
      `${t('population')}: ${here.population.toLocaleString(getLang() === 'ar' ? 'ar-EG' : 'en-US')}`,
      el('br'),
      `${t('region')}: ${here.region}`,
      el('br'),
      `${t('plots')}: ${here.plots - here.plotsUsed}/${here.plots}`,
    ),
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => openPanel('market') }, `📊 ${t('market')}`),
    el('button', { class: 'btn btn-sm', onclick: () => openPanel('build') }, `🏗️ ${t('build')}`),
  ));
}

/* ------------------------------------------------------------------ toasts */

export function toast(text: string, level: 'info' | 'good' | 'warn' | 'bad' = 'info', extraClass = '') {
  const wrap = $('toasts');
  const node = el('div', { class: `toast ${level} ${extraClass}`.trim() }, text);
  wrap.appendChild(node);
  // Cap the stack so a burst of payroll messages cannot bury the screen.
  while (wrap.children.length > 5) wrap.removeChild(wrap.firstChild!);
  setTimeout(() => {
    node.classList.add('fade');
    setTimeout(() => node.remove(), 420);
  }, 4200);
}

export function achievementToast(id: string) {
  const def = ACHIEVEMENT_BY_ID[id];
  if (!def) return;
  toast(`${def.icon}  ${name(def)} — +${def.prestige} ${t('prestige')}`, 'good', 'toast-achievement');
}

let hintTimer: number | undefined;
export function hint(text: string) {
  const node = $('hint');
  node.textContent = text;
  node.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => node.classList.remove('show'), 2600);
}

export { renderStats, renderNearby, renderChat, renderEvents, renderTicker };
