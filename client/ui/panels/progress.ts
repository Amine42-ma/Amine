import { SKILLS } from '../../../shared/skills.js';
import { ACHIEVEMENTS } from '../../../shared/achievements.js';
import { EVENT_BY_ID } from '../../../shared/events.js';
import { fmtGold, fmtDuration, dist } from '../../../shared/util.js';
import { store, serverNow, currentSettlement } from '../../store.js';
import { t, name, describe, effect, settlementName, getLang } from '../../i18n.js';
import { el, row, sectionTitle, empty, pill, bar } from '../dom.js';

/** Progression and world-information screens. */

/* ------------------------------------------------------------------ skills */

export function renderSkills(body: HTMLElement) {
  const self = store.self;
  if (!self) return;

  body.appendChild(el('div', { class: 'row' },
    el('div', { class: 'grow' },
      el('div', { class: 'name' }, `⭐ ${t('prestige')}: ${self.prestige}`),
      el('div', { class: 'sub' },
        getLang() === 'ar'
          ? 'الهيبة والإنجازات تبقى بعد نهاية الموسم.'
          : 'Prestige and achievements survive the season reset.',
      ),
    ),
  ));

  for (const skill of self.skills) {
    const def = SKILLS[skill.id];
    const previous = skill.level > 0 ? Math.round(120 * Math.pow(skill.level, 1.85)) : 0;
    const span = Math.max(1, skill.nextXp - previous);
    const progress = (skill.xp - previous) / span;

    body.appendChild(el('div', { class: 'row', style: 'flex-direction:column;align-items:stretch;gap:5px' },
      el('div', { style: 'display:flex;align-items:center;gap:10px' },
        el('span', { style: 'font-size:20px' }, def.icon),
        el('div', { class: 'grow' },
          el('div', { class: 'name' }, name(def), pill(`${t('level')} ${skill.level}`, 'good')),
          el('div', { class: 'sub' }, effect(def)),
        ),
        el('div', { class: 'num' }, `${skill.xp}/${skill.nextXp}`),
      ),
      bar(progress),
    ));
  }
}

/* ------------------------------------------------------------ achievements */

export function renderAchievements(body: HTMLElement) {
  const self = store.self;
  if (!self) return;

  const earned = new Set(self.achievements);
  body.appendChild(el('div', { class: 'row' },
    el('div', { class: 'grow' },
      el('div', { class: 'name' }, `🏆 ${earned.size}/${ACHIEVEMENTS.length}`),
      el('div', { class: 'sub' }, `⭐ ${t('prestige')}: ${self.prestige}`),
    ),
  ));

  for (const def of ACHIEVEMENTS) {
    const done = earned.has(def.id);
    body.appendChild(row({
      icon: done ? def.icon : '🔒',
      title: [
        el('span', { style: done ? '' : 'opacity:.55' }, name(def)),
        done ? pill(`+${def.prestige}`, 'good') : pill(t('locked')),
      ],
      sub: [el('span', { style: done ? '' : 'opacity:.55' }, describe(def))],
    }));
  }
}

/* ---------------------------------------------------------------- ranking */

export function renderRanking(body: HTMLElement) {
  const self = store.self;
  if (store.leaderboard.length === 0) {
    body.appendChild(empty('…'));
    return;
  }

  const season = store.season;
  if (season) {
    body.appendChild(el('div', { class: 'row' },
      el('div', { class: 'grow' },
        el('div', { class: 'name' }, `🗓️ ${t('season')} ${season.index}`),
        el('div', { class: 'sub' },
          `${t('seasonEnds')} ${fmtDuration(Math.max(0, season.endsAt - serverNow()))}`,
        ),
      ),
    ));
  }

  store.leaderboard.forEach((entry, index) => {
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}`;
    const isSelf = entry.id === self?.id;
    body.appendChild(row({
      icon: medal,
      title: [
        el('span', { style: isSelf ? 'color:var(--gold);font-weight:700' : '' }, entry.name),
        entry.isNpc ? pill('NPC') : null,
        entry.companyName ? pill(entry.companyName) : null,
      ],
      trailing: [el('div', { class: 'num' }, fmtGold(entry.netWorth))],
    }));
  });
}

/* ------------------------------------------------------------------ atlas */

export function renderAtlas(body: HTMLElement) {
  const self = store.self;
  if (!self) return;

  body.appendChild(sectionTitle(t('worldEvents')));
  if (store.events.length === 0) {
    body.appendChild(el('div', { class: 'sub', style: 'padding:4px 2px' }, t('noEvents')));
  } else {
    for (const active of store.events) {
      const def = EVENT_BY_ID[active.defId];
      if (!def) continue;
      body.appendChild(row({
        icon: def.icon,
        title: [name(def), active.region ? pill(active.region) : pill('🌍', 'bad')],
        sub: [describe(def), el('br'), fmtDuration(Math.max(0, active.endsAt - serverNow()))],
      }));
    }
  }

  body.appendChild(sectionTitle(t('visitToTrade')));
  const here = currentSettlement();
  const visited = new Set(self.visitedSettlements);

  const sorted = [...store.settlements].sort(
    (a, b) => dist(self.x, self.y, a.x, a.y) - dist(self.x, self.y, b.x, b.y),
  );

  for (const s of sorted) {
    const d = dist(self.x, self.y, s.x, s.y);
    const seen = visited.has(s.id);
    const kindIcon = s.kind === 'city' ? '🏛️' : s.kind === 'port' ? '⚓' : s.kind === 'island' ? '🏝️' : '🏘️';
    const owned = self.buildings.filter((b) => b.settlementId === s.id).length;

    // Islands are unreachable without a ship; say so before someone walks there.
    const hasSeaVehicle = (self.fleet.ship ?? 0) > 0 || (self.fleet.plane ?? 0) > 0;
    const seaOnly = s.kind === 'island' && !hasSeaVehicle;

    body.appendChild(row({
      icon: kindIcon,
      title: [
        el('span', { style: seen ? '' : 'opacity:.5' }, settlementName(s)),
        here?.id === s.id ? pill(t('current'), 'good') : null,
        seaOnly ? pill(`🚢 ${t('seaOnly')}`, 'warn') : null,
        owned > 0 ? pill(`🏭${owned}`, 'good') : null,
      ],
      sub: [
        `${s.region}  ·  ${t('population')} ${fmtGold(s.population)}  ·  `,
        `${t('plots')} ${s.plots - s.plotsUsed}/${s.plots}`,
      ],
      trailing: [el('div', { class: 'num' }, `${Math.round(d)}`)],
    }));
  }
}
