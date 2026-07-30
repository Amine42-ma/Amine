import { BUILDINGS, type BuildingDef } from '../../../shared/buildings.js';
import { COMMODITIES, type CommodityId } from '../../../shared/commodities.js';
import { fmtGold } from '../../../shared/util.js';
import { store, currentSettlement } from '../../store.js';
import { send } from '../../net.js';
import { t, name, describe, settlementName } from '../../i18n.js';
import { el, row, sectionTitle, empty, pill } from '../dom.js';

/** The construction catalogue for whichever settlement the player is standing in. */

const GROUPS: { key: BuildingDef['kind']; ar: string; en: string; icon: string }[] = [
  { key: 'extractor', ar: 'الاستخراج', en: 'Extraction', icon: '⛏️' },
  { key: 'factory', ar: 'التصنيع', en: 'Manufacturing', icon: '🏭' },
  { key: 'shop', ar: 'المتاجر', en: 'Retail', icon: '🏪' },
  { key: 'logistics', ar: 'اللوجستيات', en: 'Logistics', icon: '📦' },
];

export function renderBuild(body: HTMLElement) {
  const here = currentSettlement();
  const self = store.self;
  if (!here || !self) {
    body.appendChild(empty(t('notInSettlement')));
    return;
  }

  const free = here.plots - here.plotsUsed;
  body.appendChild(el('div', { class: 'row' },
    el('div', { class: 'grow' },
      el('div', { class: 'name' }, settlementName(here)),
      el('div', { class: 'sub' },
        `${t('plots')}: ${free}/${here.plots}  ·  ${t('plotPrice')}: ${fmtGold(here.plotPrice)}`,
      ),
    ),
    free > 0 ? pill(`${free}`, 'good') : pill(t('noPlots'), 'bad'),
  ));

  for (const group of GROUPS) {
    const defs = Object.values(BUILDINGS).filter((d) => d.kind === group.key);
    if (defs.length === 0) continue;
    body.appendChild(sectionTitle(`${group.icon}  ${t('build') === 'Build' ? group.en : group.ar}`));

    for (const def of defs) {
      const total = def.cost + here.plotPrice;
      const gated = def.requiresNetWorth !== undefined && self.netWorth < def.requiresNetWorth;
      const affordable = self.gold >= total;
      const blocked = gated || !affordable || free <= 0;

      body.appendChild(row({
        icon: def.icon,
        title: [
          name(def),
          gated ? pill(`${t('needsWorth')} ${fmtGold(def.requiresNetWorth!)}`, 'warn') : null,
        ],
        sub: [
          describe(def),
          el('br'),
          `${t('upkeep')} ${fmtGold(def.upkeep)}/min · ${t('jobs')} ${def.jobs}`,
          def.recipe ? el('br') : null,
          def.recipe ? recipeText(def) : null,
          def.salesRate ? el('br') : null,
          def.salesRate ? `${def.salesRate}/min · ${t('markup')} ${Math.round((def.markup ?? 0) * 100)}%` : null,
        ],
        trailing: [
          el('div', { style: 'display:flex;flex-direction:column;gap:5px;align-items:flex-end' },
            el('div', { class: 'num', style: affordable ? '' : 'color:var(--bad)' }, fmtGold(total)),
            el('button', {
              class: 'btn btn-sm btn-primary',
              ...(blocked ? { disabled: true } : {}),
              onclick: () => send({ t: 'buildingBuy', settlementId: here.id, defId: def.id }),
            }, t('buyBuilding')),
          ),
        ],
      }));
    }
  }
}

/** Renders "2 iron + 1 coal → 1 steel · 35s" for a factory recipe. */
export function recipeText(def: BuildingDef): string {
  if (!def.recipe) return '';
  const side = (map: Partial<Record<CommodityId, number>>) =>
    Object.entries(map)
      .map(([id, qty]) => `${qty}${COMMODITIES[id as CommodityId].icon}`)
      .join(' + ');
  const inputs = side(def.recipe.inputs);
  const outputs = side(def.recipe.outputs);
  return `${inputs ? `${inputs} → ` : ''}${outputs} · ${def.recipe.seconds}s`;
}
