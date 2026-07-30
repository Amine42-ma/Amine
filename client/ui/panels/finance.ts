import { INCORPORATION_COST, TOTAL_SHARES } from '../../../shared/constants.js';
import { fmtGold } from '../../../shared/util.js';
import { store } from '../../store.js';
import { send } from '../../net.js';
import { t, getLang } from '../../i18n.js';
import { el, row, sectionTitle, empty, pill, bar, sparkline } from '../dom.js';

/** Bank and stock exchange: the two places where money makes money. */

/* -------------------------------------------------------------------- bank */

export function renderBank(body: HTMLElement) {
  const self = store.self;
  if (!self) return;

  const debt = self.loans.reduce((sum, l) => sum + l.owed, 0);

  body.appendChild(el('div', { class: 'row' },
    el('div', { class: 'grow' },
      el('div', { class: 'name' }, `🏦 ${fmtGold(self.bank)}`),
      el('div', { class: 'sub' },
        `${t('creditScore')}: ${self.creditScore}  ·  ${t('owed')}: ${fmtGold(debt)}`,
      ),
      bar(self.creditScore / 900, true),
    ),
  ));

  const amount = el('input', { type: 'number', min: '1', value: '1000' }) as HTMLInputElement;
  const value = () => Math.max(1, Math.floor(Number(amount.value) || 0));

  body.appendChild(el('div', { class: 'field' },
    el('label', {}, t('quantity')),
    amount,
  ));
  body.appendChild(el('div', { class: 'grid-2', style: 'margin-bottom:14px' },
    el('button', { class: 'btn', onclick: () => send({ t: 'bankDeposit', amount: value() }) }, `⬇ ${t('deposit')}`),
    el('button', { class: 'btn', onclick: () => send({ t: 'bankWithdraw', amount: value() }) }, `⬆ ${t('withdraw')}`),
  ));

  body.appendChild(sectionTitle(t('loan')));
  body.appendChild(el('button', {
    class: 'btn btn-primary',
    style: 'width:100%;margin-bottom:10px',
    onclick: () => send({ t: 'loanTake', amount: value() }),
  }, `${t('takeLoan')} ${fmtGold(value())}`));

  if (self.loans.length === 0) {
    body.appendChild(el('div', { class: 'sub', style: 'text-align:center' },
      getLang() === 'ar'
        ? 'القروض تُسرّع التوسع، لكن الفائدة تتراكم كل ثانية.'
        : 'Loans accelerate expansion, but interest accrues every second.',
    ));
    return;
  }

  for (const loan of self.loans) {
    body.appendChild(row({
      icon: '📜',
      title: [fmtGold(loan.owed), pill(`${(loan.apr * 100).toFixed(1)}% APR`, 'warn')],
      sub: [`${t('loan')}: ${fmtGold(loan.principal)}`],
      trailing: [
        el('button', {
          class: 'btn btn-sm btn-primary',
          onclick: () => send({ t: 'loanRepay', loanId: loan.id, amount: Math.ceil(loan.owed) }),
        }, t('repay')),
      ],
    }));
  }
}

/* ---------------------------------------------------------------- exchange */

export function renderExchange(body: HTMLElement) {
  const self = store.self;
  if (!self) return;

  if (!self.companyId) body.appendChild(incorporateForm());

  const holdings = Object.entries(self.shares).filter(([, qty]) => qty > 0);
  if (holdings.length > 0) {
    body.appendChild(sectionTitle(t('yourHoldings')));
    for (const [companyId, qty] of holdings) {
      const co = store.companies.find((c) => c.id === companyId);
      if (!co) continue;
      body.appendChild(row({
        icon: '📄',
        title: [co.name, pill(`×${qty}`, 'good')],
        sub: [`${fmtGold(qty * co.sharePrice)}  ·  ${co.sharePrice.toFixed(2)} / ${t('shares')}`],
      }));
    }
  }

  body.appendChild(sectionTitle(t('exchange')));
  if (store.companies.length === 0) {
    body.appendChild(empty(t('noCompanies')));
    return;
  }

  for (const co of store.companies) {
    const mine = co.ownerId === self.id;
    const held = self.shares[co.id] ?? 0;
    const change = co.history.length > 1
      ? (co.sharePrice - co.history[0]) / Math.max(0.01, co.history[0])
      : 0;

    const card = el('div', { class: 'row', style: 'flex-direction:column;align-items:stretch;gap:7px' });
    card.appendChild(el('div', { style: 'display:flex;align-items:center;gap:10px' },
      el('div', { class: 'grow' },
        el('div', { class: 'name' }, co.name, mine ? pill(t('owned'), 'good') : null),
        el('div', { class: 'sub' },
          `${co.ownerName}  ·  ${t('valuation')} ${fmtGold(co.valuation)}  ·  `,
          `${t('shares')} ${co.sharesFloating}/${co.sharesOutstanding}`,
        ),
      ),
      el('div', { style: 'text-align:end' },
        el('div', { class: 'num', style: 'font-size:15px' }, co.sharePrice.toFixed(2)),
        el('div', {
          class: 'sub',
          style: `color:${change >= 0 ? 'var(--good)' : 'var(--bad)'}`,
        }, `${change >= 0 ? '▲' : '▼'}${Math.abs(change * 100).toFixed(1)}%`),
      ),
    ));

    card.appendChild(sparkline(co.history, change >= 0 ? '#4ade80' : '#f87171'));

    const price = el('input', {
      class: 'qty', type: 'number', step: '0.5', value: co.sharePrice.toFixed(2),
    }) as HTMLInputElement;
    const qty = el('input', { class: 'qty', type: 'number', min: '1', value: '10' }) as HTMLInputElement;

    const order = (side: 'buy' | 'sell') => send({
      t: 'orderPlace',
      companyId: co.id,
      side,
      price: Number(price.value) || co.sharePrice,
      quantity: Math.max(1, Math.floor(Number(qty.value) || 0)),
    });

    card.appendChild(el('div', { style: 'display:flex;gap:5px;align-items:center;flex-wrap:wrap' },
      el('span', { class: 'sub' }, t('price')), price,
      el('span', { class: 'sub' }, t('quantity')), qty,
      el('button', { class: 'btn btn-sm btn-buy', onclick: () => order('buy') }, t('placeBuy')),
      el('button', {
        class: 'btn btn-sm btn-sell',
        ...(held <= 0 ? { disabled: true } : {}),
        onclick: () => order('sell'),
      }, t('placeSell')),
    ));

    const book = store.orders.filter((o) => o.companyId === co.id);
    if (book.length > 0) {
      const bids = book.filter((o) => o.side === 'buy').sort((a, b) => b.price - a.price).slice(0, 3);
      const asks = book.filter((o) => o.side === 'sell').sort((a, b) => a.price - b.price).slice(0, 3);
      card.appendChild(el('div', { class: 'sub' },
        `${t('orderBook')}: `,
        ...bids.map((o) => el('span', { style: 'color:var(--good);margin-inline-end:8px' },
          `${o.quantity}@${o.price.toFixed(1)}`)),
        ...asks.map((o) => el('span', { style: 'color:var(--bad);margin-inline-end:8px' },
          `${o.quantity}@${o.price.toFixed(1)}`)),
      ));
      // Your own resting orders can be pulled back off the book.
      const own = book.filter((o) => o.playerId === self.id);
      if (own.length > 0) {
        card.appendChild(el('div', { style: 'display:flex;gap:5px;flex-wrap:wrap' },
          ...own.map((o) => el('button', {
            class: 'btn btn-sm',
            onclick: () => send({ t: 'orderCancel', orderId: o.id }),
          }, `${t('cancel')} ${o.side === 'buy' ? '▲' : '▼'}${o.quantity}@${o.price.toFixed(1)}`)),
        ));
      }
    }

    body.appendChild(card);
  }
}

function incorporateForm(): HTMLElement {
  const self = store.self!;
  const nameInput = el('input', { type: 'text', maxlength: '28' }) as HTMLInputElement;
  const floatInput = el('input', { type: 'number', min: '0', max: '49', value: '25' }) as HTMLInputElement;
  const priceInput = el('input', { type: 'number', min: '1', value: '100' }) as HTMLInputElement;
  const affordable = self.gold >= INCORPORATION_COST;

  return el('div', { style: 'margin-bottom:12px' },
    el('div', { class: 'section-title' }, `${t('incorporate')} — ${fmtGold(INCORPORATION_COST)}`),
    el('div', { class: 'field' }, el('label', {}, t('companyName')), nameInput),
    el('div', { class: 'grid-2' },
      el('div', { class: 'field' }, el('label', {}, t('floatPercent')), floatInput),
      el('div', { class: 'field' }, el('label', {}, t('ipoPrice')), priceInput),
    ),
    el('div', { class: 'sub', style: 'margin-bottom:8px' },
      getLang() === 'ar'
        ? `تُصدر ${TOTAL_SHARES} سهم. النسبة المطروحة تُعرض للبيع فوراً في السوق.`
        : `Issues ${TOTAL_SHARES} shares. The float is listed for sale immediately.`,
    ),
    el('button', {
      class: 'btn btn-primary',
      style: 'width:100%',
      ...(affordable ? {} : { disabled: true }),
      onclick: () => send({
        t: 'companyCreate',
        name: nameInput.value,
        floatPercent: Number(floatInput.value) || 0,
        ipoPrice: Number(priceInput.value) || 100,
      }),
    }, t('incorporate')),
  );
}
