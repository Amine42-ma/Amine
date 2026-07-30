import { store, on } from '../../store.js';
import { t } from '../../i18n.js';
import { $, clear } from '../dom.js';
import { renderMarket } from './market.js';
import { renderBuild } from './build.js';
import { renderEmpire, renderConvoys, renderFleet, renderStaff } from './empire.js';
import { renderBank, renderExchange } from './finance.js';
import { renderSkills, renderAchievements, renderRanking, renderAtlas } from './progress.js';

/** The dock's panel registry: one entry per screen the player can open. */

export interface PanelDef {
  id: string;
  icon: string;
  labelKey: string;
  render: (body: HTMLElement) => void;
}

export const PANELS: PanelDef[] = [
  { id: 'market', icon: '📊', labelKey: 'market', render: renderMarket },
  { id: 'build', icon: '🏗️', labelKey: 'build', render: renderBuild },
  { id: 'empire', icon: '🏭', labelKey: 'empire', render: renderEmpire },
  { id: 'convoys', icon: '🚚', labelKey: 'convoys', render: renderConvoys },
  { id: 'fleet', icon: '⚓', labelKey: 'fleet', render: renderFleet },
  { id: 'staff', icon: '🧑‍💼', labelKey: 'staff', render: renderStaff },
  { id: 'bank', icon: '🏦', labelKey: 'bankPanel', render: renderBank },
  { id: 'exchange', icon: '📈', labelKey: 'exchange', render: renderExchange },
  { id: 'skills', icon: '🎯', labelKey: 'skills', render: renderSkills },
  { id: 'achievements', icon: '🏆', labelKey: 'achievements', render: renderAchievements },
  { id: 'ranking', icon: '👑', labelKey: 'ranking', render: renderRanking },
  { id: 'atlas', icon: '🗺️', labelKey: 'atlas', render: renderAtlas },
];

let current: string | null = null;

export function activePanel(): string | null {
  return current;
}

export function openPanel(id: string) {
  if (current === id) return closePanel();
  current = id;
  $('panel').classList.remove('hidden');
  renderActive();
  void import('../hud.js').then((m) => m.syncDock());
}

export function closePanel() {
  current = null;
  $('panel').classList.add('hidden');
  void import('../hud.js').then((m) => m.syncDock());
}

/** Re-renders whichever panel is open; cheap enough to call on every update. */
export function renderActive() {
  if (!current) return;
  const def = PANELS.find((p) => p.id === current);
  if (!def) return;

  const body = $('panel-body');
  // Preserve scroll position so a server tick does not yank the list around.
  const scroll = body.scrollTop;
  $('panel-title').textContent = `${def.icon}  ${t(def.labelKey)}`;
  clear(body);
  try {
    def.render(body);
  } catch (err) {
    console.error(`[panel] ${def.id} failed to render`, err);
  }
  body.scrollTop = scroll;
}

export function initPanels() {
  $('panel-close').addEventListener('click', closePanel);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closePanel();
  });

  // Any state the panels read can trigger a re-render.
  for (const key of ['self', 'market', 'exchange', 'leaderboard', 'settlements', 'events', 'lang']) {
    on(key, () => {
      if (!store.self) return;
      renderActive();
    });
  }
}
