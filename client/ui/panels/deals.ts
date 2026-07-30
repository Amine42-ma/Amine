import { COMMODITIES, type CommodityId } from '../../../shared/commodities.js';
import { fmtGold, fmtDuration } from '../../../shared/util.js';
import { store, serverNow } from '../../store.js';
import { send } from '../../net.js';
import { t, name, getLang } from '../../i18n.js';
import { el, row, sectionTitle, empty, pill } from '../dom.js';

/**
 * Player-to-player deals and trading blocs. Contracts escrow whatever the poster
 * puts up, so the two sides never have to be in the same place — and there is no
 * house spread, which is the whole reason to deal directly instead of through a
 * city market.
 */

const CONTRACT_TTL_MS = 45 * 60_000;

export function renderDeals(body: HTMLElement) {
  const self = store.self;
  if (!self) return;

  body.appendChild(contractForm());
  body.appendChild(sectionTitle(t('openDeals')));

  if (store.contracts.length === 0) {
    body.appendChild(empty(t('noDeals')));
  } else {
    for (const contract of store.contracts) {
      const good = COMMODITIES[contract.commodity];
      const mine = contract.ownerId === self.id;
      const perUnit = contract.price / Math.max(1, contract.quantity);
      const expires = contract.createdAt + CONTRACT_TTL_MS - serverNow();

      body.appendChild(row({
        icon: good.icon,
        title: [
          // A "sell" contract is something you can buy, so label it from the
          // reader's point of view rather than the poster's.
          contract.side === 'sell' ? pill(t('forSale'), 'good') : pill(t('wanted'), 'warn'),
          ` ${contract.quantity} × ${name(good)}`,
          mine ? pill(t('yours')) : null,
        ],
        sub: [
          `${fmtGold(contract.price)}  (${perUnit.toFixed(1)} / ${t('unit')})  ·  `,
          `${contract.ownerName}`,
          contract.ownerAlliance ? ` [${contract.ownerAlliance}]` : '',
          `  ·  ${fmtDuration(Math.max(0, expires))}`,
        ],
        trailing: [
          mine
            ? el('button', {
                class: 'btn btn-sm btn-sell',
                onclick: () => send({ t: 'contractCancel', contractId: contract.id }),
              }, t('cancel'))
            : el('button', {
                class: 'btn btn-sm btn-primary',
                onclick: () => send({ t: 'contractAccept', contractId: contract.id }),
              }, t('accept')),
        ],
      }));
    }
  }

  renderAlliances(body);
}

function contractForm(): HTMLElement {
  const self = store.self!;

  const sideSel = el('select', {}) as HTMLSelectElement;
  sideSel.appendChild(el('option', { value: 'sell' }, t('iAmSelling')));
  sideSel.appendChild(el('option', { value: 'buy' }, t('iAmBuying')));

  const goodSel = el('select', {}) as HTMLSelectElement;
  for (const [id, good] of Object.entries(COMMODITIES)) {
    const held = Math.floor(self.inventory.items[id as CommodityId] ?? 0);
    goodSel.appendChild(el('option', { value: id }, `${good.icon} ${name(good)}${held > 0 ? ` (${held})` : ''}`));
  }

  const qty = el('input', { type: 'number', min: '1', value: '10' }) as HTMLInputElement;
  const price = el('input', { type: 'number', min: '1', value: '500' }) as HTMLInputElement;

  return el('div', { style: 'margin-bottom:12px' },
    el('div', { class: 'grid-2' },
      el('div', { class: 'field' }, el('label', {}, t('dealSide')), sideSel),
      el('div', { class: 'field' }, el('label', {}, t('market')), goodSel),
    ),
    el('div', { class: 'grid-2' },
      el('div', { class: 'field' }, el('label', {}, t('quantity')), qty),
      el('div', { class: 'field' }, el('label', {}, t('totalPrice')), price),
    ),
    el('div', { class: 'sub', style: 'margin-bottom:8px' }, t('escrowNote')),
    el('button', {
      class: 'btn btn-primary',
      style: 'width:100%',
      onclick: () => send({
        t: 'contractCreate',
        side: sideSel.value as 'sell' | 'buy',
        commodity: goodSel.value as CommodityId,
        quantity: Math.max(1, Math.floor(Number(qty.value) || 0)),
        price: Math.max(1, Math.floor(Number(price.value) || 0)),
      }),
    }, t('postDeal')),
  );
}

function renderAlliances(body: HTMLElement) {
  const self = store.self!;
  body.appendChild(sectionTitle(t('alliances')));

  if (self.allianceName) {
    body.appendChild(row({
      icon: '🤝',
      title: [self.allianceName, pill(t('yourAlliance'), 'good')],
      trailing: [
        el('button', {
          class: 'btn btn-sm btn-sell',
          onclick: () => send({ t: 'allianceLeave' }),
        }, t('leaveAlliance')),
      ],
    }));
  } else {
    const nameInput = el('input', { type: 'text', maxlength: '24' }) as HTMLInputElement;
    body.appendChild(el('div', { style: 'display:flex;gap:6px;margin-bottom:8px' },
      nameInput,
      el('button', {
        class: 'btn btn-sm btn-primary',
        onclick: () => send({ t: 'allianceCreate', name: nameInput.value }),
      }, t('foundAlliance')),
    ));
    nameInput.placeholder = t('allianceName');
  }

  if (store.alliances.length === 0) {
    body.appendChild(el('div', { class: 'sub', style: 'padding:4px 2px' },
      getLang() === 'ar'
        ? 'لا توجد تحالفات بعد. أسّس واحداً واجمع تجّاراً حولك.'
        : 'No alliances yet. Found one and gather merchants around you.',
    ));
    return;
  }

  store.alliances.forEach((alliance, index) => {
    const isMine = alliance.id === self.allianceId;
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🤝';
    body.appendChild(row({
      icon: medal,
      title: [alliance.name, isMine ? pill(t('yours'), 'good') : null],
      sub: [`${alliance.founderName}  ·  ${alliance.members} ${t('members')}`],
      trailing: [
        el('div', { style: 'display:flex;gap:5px;align-items:center' },
          el('div', { class: 'num' }, fmtGold(alliance.netWorth)),
          !self.allianceId
            ? el('button', {
                class: 'btn btn-sm',
                onclick: () => send({ t: 'allianceJoin', allianceId: alliance.id }),
              }, t('joinAlliance'))
            : null,
        ),
      ],
    }));
  });
}
