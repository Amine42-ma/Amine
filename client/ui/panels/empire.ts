import { BUILDINGS } from '../../../shared/buildings.js';
import { COMMODITIES, type CommodityId } from '../../../shared/commodities.js';
import { VEHICLES, VEHICLE_IDS, type VehicleId } from '../../../shared/vehicles.js';
import { WORKERS, WORKER_IDS, type WorkerId } from '../../../shared/staff.js';
import { fmtGold, fmtDuration } from '../../../shared/util.js';
import { store, currentSettlement, serverNow, settlementAt } from '../../store.js';
import { send } from '../../net.js';
import { t, name, effect, settlementName, getLang } from '../../i18n.js';
import { el, row, sectionTitle, empty, pill, bar } from '../dom.js';
import { recipeText } from './build.js';

/** Buildings, convoy routes, fleet and payroll — the operations side of the game. */

/* ------------------------------------------------------------------ empire */

export function renderEmpire(body: HTMLElement) {
  const self = store.self;
  if (!self) return;

  if (self.buildings.length === 0) {
    body.appendChild(empty(t('nothingYet')));
    return;
  }

  const here = currentSettlement();
  const bySettlement = new Map<string, typeof self.buildings>();
  for (const b of self.buildings) {
    const list = bySettlement.get(b.settlementId);
    if (list) list.push(b);
    else bySettlement.set(b.settlementId, [b]);
  }

  for (const [settlementId, buildings] of bySettlement) {
    const s = settlementAt(settlementId);
    body.appendChild(sectionTitle(s ? settlementName(s) : settlementId));

    for (const b of buildings) {
      const def = BUILDINGS[b.defId];
      if (!def) continue;
      const onSite = here?.id === settlementId;

      const card = el('div', { class: 'row', style: 'flex-direction:column;align-items:stretch;gap:8px' });

      card.appendChild(el('div', { style: 'display:flex;align-items:center;gap:10px' },
        el('span', { style: 'font-size:20px' }, def.icon),
        el('div', { class: 'grow' },
          el('div', { class: 'name' }, name(def), b.active ? pill(t('running'), 'good') : pill(t('paused'), 'warn')),
          el('div', { class: 'sub' },
            def.recipe ? recipeText(def) : `${t('revenue')}: ${fmtGold(b.totalRevenue)}`,
          ),
        ),
        el('button', {
          class: 'btn btn-sm',
          onclick: () => send({ t: 'buildingToggle', buildingId: b.id, active: !b.active }),
        }, b.active ? '⏸' : '▶'),
        el('button', {
          class: 'btn btn-sm btn-sell',
          onclick: () => send({ t: 'buildingSell', buildingId: b.id }),
          title: t('sellBuilding'),
        }, '✕'),
      ));

      if (def.recipe) card.appendChild(bar(b.progress));

      // Storage contents, with load/unload controls when standing on site.
      const items = Object.entries(b.storage).filter(([, qty]) => (qty ?? 0) > 0.01);
      card.appendChild(el('div', { class: 'sub' },
        items.length > 0
          ? items.map(([id, qty]) => `${COMMODITIES[id as CommodityId].icon}${Math.round(qty ?? 0)}`).join('  ')
          : `${t('storage')}: —`,
      ));

      if (def.kind === 'shop') {
        const markup = el('input', {
          type: 'range', min: '0', max: '120', value: String(Math.round(b.retailMarkup! * 100)),
        }) as HTMLInputElement;
        const readout = el('span', { class: 'num' }, `${Math.round(b.retailMarkup! * 100)}%`);
        markup.addEventListener('input', () => { readout.textContent = `${markup.value}%`; });
        markup.addEventListener('change', () => {
          send({ t: 'buildingMarkup', buildingId: b.id, markup: Number(markup.value) / 100 });
        });
        card.appendChild(el('div', {},
          el('div', { class: 'sub' }, `${t('markup')} `, readout,
            `  ·  ${t('revenue')}/min ${fmtGold(b.lastRevenue * 60)}`),
          markup,
        ));
      }

      if (onSite) card.appendChild(transferControls(b.id, b.storage));
      card.appendChild(staffControls(b.id, def.jobs, b.workers));

      body.appendChild(card);
    }
  }
}

function transferControls(buildingId: string, storage: Partial<Record<CommodityId, number>>) {
  const self = store.self!;
  const carried = Object.keys(self.inventory.items) as CommodityId[];
  const stored = (Object.keys(storage) as CommodityId[]).filter((id) => (storage[id] ?? 0) > 0.01);
  const options = [...new Set([...carried, ...stored])];

  if (options.length === 0) return el('div', { class: 'sub' }, '—');

  const select = el('select', {}) as HTMLSelectElement;
  for (const id of options) {
    const good = COMMODITIES[id];
    const held = Math.round(self.inventory.items[id] ?? 0);
    const inside = Math.round(storage[id] ?? 0);
    select.appendChild(el('option', { value: id }, `${good.icon} ${name(good)} — ${held} / ${inside}`));
  }
  const qty = el('input', { class: 'qty', type: 'number', min: '1', value: '50' }) as HTMLInputElement;

  const move = (dir: 'in' | 'out') => {
    send({
      t: 'buildingTransfer',
      buildingId,
      commodity: select.value as CommodityId,
      quantity: Math.max(1, Math.floor(Number(qty.value) || 0)),
      dir,
    });
  };

  return el('div', { style: 'display:flex;gap:6px;align-items:center' },
    select, qty,
    el('button', { class: 'btn btn-sm btn-buy', onclick: () => move('in') }, t('loadIn')),
    el('button', { class: 'btn btn-sm', onclick: () => move('out') }, t('takeOut')),
  );
}

function staffControls(buildingId: string, jobs: number, workers: Partial<Record<WorkerId, number>>) {
  const self = store.self!;
  const used = Object.values(workers).reduce((a, v) => a + (v ?? 0), 0);
  const wrap = el('div', { style: 'display:flex;flex-wrap:wrap;gap:5px;align-items:center' },
    el('span', { class: 'sub' }, `${t('jobs')} ${used}/${jobs}`),
  );

  for (const id of WORKER_IDS) {
    const free = self.unassignedStaff[id] ?? 0;
    const here = workers[id] ?? 0;
    if (free <= 0 && here <= 0) continue;
    wrap.appendChild(el('span', { style: 'display:inline-flex;gap:3px;align-items:center' },
      el('button', {
        class: 'btn btn-sm',
        onclick: () => send({ t: 'buildingStaff', buildingId, worker: id, delta: -1 }),
        ...(here <= 0 ? { disabled: true } : {}),
      }, '−'),
      el('span', { class: 'sub' }, `${WORKERS[id].icon}${here}`),
      el('button', {
        class: 'btn btn-sm',
        onclick: () => send({ t: 'buildingStaff', buildingId, worker: id, delta: 1 }),
        ...(free <= 0 || used >= jobs ? { disabled: true } : {}),
      }, '+'),
    ));
  }
  return wrap;
}

/* ----------------------------------------------------------------- convoys */

export function renderConvoys(body: HTMLElement) {
  const self = store.self;
  if (!self) return;

  body.appendChild(sectionTitle(t('route')));
  body.appendChild(convoyForm());

  if (self.convoys.length === 0) {
    body.appendChild(empty(t('nothingYet')));
    return;
  }

  body.appendChild(sectionTitle(`${t('convoys')} — ${self.convoys.length}`));
  for (const convoy of self.convoys) {
    const from = settlementAt(convoy.fromId);
    const to = settlementAt(convoy.toId);
    const good = COMMODITIES[convoy.commodity];
    const stalled = convoy.phase.startsWith('stalled');

    body.appendChild(el('div', { class: 'row', style: 'flex-direction:column;align-items:stretch;gap:6px' },
      el('div', { style: 'display:flex;align-items:center;gap:10px' },
        el('span', { style: 'font-size:20px' }, VEHICLES[convoy.vehicleId].icon),
        el('div', { class: 'grow' },
          el('div', { class: 'name' },
            `${from ? settlementName(from) : '?'} → ${to ? settlementName(to) : '?'}`,
            stalled ? pill(stallLabel(convoy.phase), 'bad') : pill(phaseLabel(convoy.phase), 'good'),
          ),
          el('div', { class: 'sub' },
            `${good.icon} ${name(good)} ×${convoy.quantity}  ·  `,
            `${t('profitPerRun')}: `,
            el('b', { style: `color:${convoy.lastProfit >= 0 ? 'var(--good)' : 'var(--bad)'}` },
              fmtGold(convoy.lastProfit)),
            `  ·  ${t('totalProfit')}: ${fmtGold(convoy.totalProfit)}`,
          ),
        ),
        el('button', {
          class: 'btn btn-sm btn-sell',
          onclick: () => send({ t: 'convoyCancel', convoyId: convoy.id }),
        }, '✕'),
      ),
      bar(convoy.progress, true),
    ));
  }
}

function phaseLabel(phase: string): string {
  const map: Record<string, [string, string]> = {
    loading: ['تحميل', 'Loading'],
    outbound: ['في الطريق', 'Outbound'],
    unloading: ['تفريغ', 'Unloading'],
    return: ['عودة', 'Returning'],
  };
  const entry = map[phase] ?? [phase, phase];
  return getLang() === 'ar' ? entry[0] : entry[1];
}

function stallLabel(phase: string): string {
  const reason = phase.split(':')[1] ?? '';
  const map: Record<string, [string, string]> = {
    no_funds: ['لا يوجد ذهب', 'No funds'],
    no_stock: ['لا يوجد مخزون', 'No stock'],
    capacity: ['السعة', 'Capacity'],
  };
  const entry = map[reason] ?? ['متوقف', 'Stalled'];
  return getLang() === 'ar' ? entry[0] : entry[1];
}

function convoyForm(): HTMLElement {
  const self = store.self!;
  const visited = self.visitedSettlements
    .map((id) => settlementAt(id))
    .filter((s): s is NonNullable<typeof s> => !!s);

  if (visited.length < 2) {
    return el('div', { class: 'empty' },
      getLang() === 'ar'
        ? 'زر مدينتين على الأقل لفتح خطوط القوافل.'
        : 'Visit at least two settlements to unlock convoy routes.',
    );
  }

  const fromSel = el('select', {}) as HTMLSelectElement;
  const toSel = el('select', {}) as HTMLSelectElement;
  for (const s of visited) {
    fromSel.appendChild(el('option', { value: s.id }, settlementName(s)));
    toSel.appendChild(el('option', { value: s.id }, settlementName(s)));
  }
  toSel.selectedIndex = Math.min(1, visited.length - 1);

  const goodSel = el('select', {}) as HTMLSelectElement;
  for (const [id, good] of Object.entries(COMMODITIES)) {
    goodSel.appendChild(el('option', { value: id }, `${good.icon} ${name(good)}`));
  }

  const vehicleSel = el('select', {}) as HTMLSelectElement;
  for (const id of VEHICLE_IDS) {
    const owned = self.fleet[id] ?? 0;
    if (owned <= 0) continue;
    vehicleSel.appendChild(el('option', { value: id }, `${VEHICLES[id].icon} ${name(VEHICLES[id])} (${owned})`));
  }

  const qty = el('input', { class: 'qty', type: 'number', min: '1', value: '50' }) as HTMLInputElement;
  const repeat = el('input', { type: 'checkbox', checked: true }) as HTMLInputElement;

  return el('div', { style: 'margin-bottom:10px' },
    el('div', { class: 'grid-2' },
      el('div', { class: 'field' }, el('label', {}, t('from')), fromSel),
      el('div', { class: 'field' }, el('label', {}, t('to')), toSel),
    ),
    el('div', { class: 'grid-2' },
      el('div', { class: 'field' }, el('label', {}, t('market')), goodSel),
      el('div', { class: 'field' }, el('label', {}, t('vehicle')), vehicleSel),
    ),
    el('div', { style: 'display:flex;gap:8px;align-items:center' },
      el('label', { class: 'sub', style: 'display:flex;gap:5px;align-items:center' }, repeat, t('repeat')),
      qty,
      el('button', {
        class: 'btn btn-primary btn-sm grow',
        onclick: () => {
          if (!vehicleSel.value) return;
          send({
            t: 'convoyCreate',
            vehicleId: vehicleSel.value as VehicleId,
            fromId: fromSel.value,
            toId: toSel.value,
            commodity: goodSel.value as CommodityId,
            quantity: Math.max(1, Math.floor(Number(qty.value) || 0)),
            autoRepeat: repeat.checked,
          });
        },
      }, t('launch')),
    ),
  );
}

/* ------------------------------------------------------------------- fleet */

export function renderFleet(body: HTMLElement) {
  const self = store.self;
  if (!self) return;

  for (const id of VEHICLE_IDS) {
    const def = VEHICLES[id];
    const owned = self.fleet[id] ?? 0;
    const gated = def.requiresNetWorth !== undefined && self.netWorth < def.requiresNetWorth;
    const active = self.vehicle === id;

    body.appendChild(row({
      icon: def.icon,
      title: [
        name(def),
        active ? pill(t('current'), 'good') : null,
        owned > 0 ? pill(`${t('owned')} ${owned}`) : null,
        gated ? pill(`${t('needsWorth')} ${fmtGold(def.requiresNetWorth!)}`, 'warn') : null,
      ],
      sub: [
        `${t('capacity')} ${def.capacity}  ·  ${t('speed')} ${def.speed}  ·  ${t('costPerTile')} ${def.costPerTile}`,
      ],
      trailing: [
        el('div', { style: 'display:flex;flex-direction:column;gap:5px;align-items:flex-end' },
          el('div', { class: 'num' }, def.cost > 0 ? fmtGold(def.cost) : '—'),
          el('div', { style: 'display:flex;gap:4px' },
            owned > 0 && !active
              ? el('button', {
                  class: 'btn btn-sm',
                  onclick: () => send({ t: 'vehicleEquip', vehicleId: id }),
                }, t('equip'))
              : null,
            def.cost > 0
              ? el('button', {
                  class: 'btn btn-sm btn-primary',
                  ...(gated || self.gold < def.cost ? { disabled: true } : {}),
                  onclick: () => send({ t: 'vehicleBuy', vehicleId: id }),
                }, t('buy'))
              : null,
          ),
        ),
      ],
    }));
  }
}

/* ------------------------------------------------------------------- staff */

export function renderStaff(body: HTMLElement) {
  const self = store.self;
  if (!self) return;

  const due = Math.max(0, self.payrollDue - serverNow());
  body.appendChild(el('div', { class: 'row' },
    el('div', { class: 'grow' },
      el('div', { class: 'name' }, `${t('payroll')}: ${fmtDuration(due)}`),
      el('div', { class: 'sub' }, `${t('salary')}: ${fmtGold(self.lastPayrollCost)} / min`),
    ),
  ));

  for (const id of WORKER_IDS) {
    const def = WORKERS[id];
    const owned = self.staff[id] ?? 0;
    const free = self.unassignedStaff[id] ?? 0;

    const count = el('input', { class: 'qty', type: 'number', min: '1', value: '1' }) as HTMLInputElement;
    const n = () => Math.max(1, Math.floor(Number(count.value) || 1));

    body.appendChild(row({
      icon: def.icon,
      title: [name(def), owned > 0 ? pill(`${owned}`, 'good') : null, free > 0 ? pill(`${free} ${t('idle')}`) : null],
      sub: [effect(def), el('br'), `${t('salary')}: ${fmtGold(def.salary)}/min`],
      trailing: [
        el('div', { style: 'display:flex;gap:4px;align-items:center' },
          count,
          el('button', {
            class: 'btn btn-sm btn-buy',
            onclick: () => send({ t: 'staffHire', worker: id, count: n() }),
          }, t('hire')),
          el('button', {
            class: 'btn btn-sm btn-sell',
            ...(free <= 0 ? { disabled: true } : {}),
            onclick: () => send({ t: 'staffFire', worker: id, count: n() }),
          }, t('fire')),
        ),
      ],
    }));
  }

  body.appendChild(sectionTitle(t('empire')));
  body.appendChild(el('div', { class: 'sub', style: 'line-height:1.8' },
    getLang() === 'ar'
      ? 'عيّن العمال في مبانيك من لوحة الإمبراطورية لتسريع الإنتاج.'
      : 'Assign workers to buildings from the Empire panel to speed up production.',
  ));
}
