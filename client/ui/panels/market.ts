import { COMMODITIES, type CommodityId } from '../../../shared/commodities.js';
import { curveExponent, estimateTrade } from '../../../shared/pricing.js';
import { fmtGold } from '../../../shared/util.js';
import { store, currentSettlement } from '../../store.js';
import { send } from '../../net.js';
import { t, name, settlementName } from '../../i18n.js';
import { el, row, sectionTitle, empty, pill } from '../dom.js';

/**
 * The trading screen. Prices here are live: every purchase walks up the local
 * price curve, so the quantity you pick changes what you pay.
 */

let filter: 'all' | 'profit' | 'carrying' = 'all';

export function renderMarket(body: HTMLElement) {
  const here = currentSettlement();
  if (!here) {
    body.appendChild(empty(t('notInSettlement')));
    return;
  }

  const market = store.market;
  if (!market || market.settlementId !== here.id) {
    send({ t: 'requestMarket', settlementId: here.id });
    body.appendChild(empty('…'));
    return;
  }

  const self = store.self;
  const space = self ? self.inventory.capacity - self.inventory.used : 0;

  body.appendChild(el('div', { class: 'row' },
    el('div', { class: 'grow' },
      el('div', { class: 'name' }, `${settlementName(here)}`),
      el('div', { class: 'sub' },
        `${t('tariff')}: ${(market.tariff * 100).toFixed(0)}%  ·  `,
        `${t('cargo')}: ${Math.round(space)} ${t('capacity')}`,
      ),
    ),
  ));

  body.appendChild(el('div', { class: 'grid-2', style: 'margin-bottom:10px' },
    filterButton('all', t('all')),
    filterButton('carrying', t('youCarry')),
  ));

  const quotes = market.quotes.filter((q) => {
    if (filter === 'carrying') return (self?.inventory.items[q.id] ?? 0) > 0;
    return true;
  });

  if (quotes.length === 0) {
    body.appendChild(empty(t('nothingYet')));
    return;
  }

  body.appendChild(sectionTitle(t('market')));

  for (const quote of quotes) {
    const good = COMMODITIES[quote.id];
    const held = self?.inventory.items[quote.id] ?? 0;
    // trend is the local price versus the world base — the arbitrage signal.
    const cheap = quote.trend < 0.95;
    const dear = quote.trend > 1.05;

    const qtyBox = el('input', {
      class: 'qty', type: 'number', min: '1', value: '10',
    }) as HTMLInputElement;

    // The headline price is for one unit; a real order walks the curve. Show the
    // actual average and total so nobody is surprised by their own trade.
    const preview = el('div', { class: 'sub', style: 'margin-top:4px' });
    const exponent = curveExponent(quote.id);

    const updatePreview = () => {
      const quantity = Math.max(1, Math.floor(Number(qtyBox.value) || 0));
      const buy = estimateTrade(quote.buy, quote.stock, quote.baseline, quantity, 'buy', exponent);
      const sell = estimateTrade(quote.sell, quote.stock, quote.baseline, quantity, 'sell', exponent);
      const slip = buy.average > 0 ? (buy.average - quote.buy) / quote.buy : 0;
      const parts: Node[] = [
        el('span', {},
          `${t('buy')} ${fmtGold(buy.total)} (⌀${buy.average.toFixed(1)})  ·  `,
          `${t('sell')} ${fmtGold(sell.total)} (⌀${sell.average.toFixed(1)})`,
        ),
      ];
      // Flag the slippage whenever the order is big enough to move the price.
      if (Math.abs(slip) > 0.03) {
        parts.push(el('span', { style: 'color:var(--warn)' }, `  ±${Math.abs(slip * 100).toFixed(0)}%`));
      }
      preview.replaceChildren(...parts);
    };
    qtyBox.addEventListener('input', updatePreview);
    updatePreview();

    const trade = (side: 'buy' | 'sell') => {
      const quantity = Math.max(1, Math.floor(Number(qtyBox.value) || 0));
      send({ t: 'trade', settlementId: here.id, commodity: quote.id, quantity, side });
    };

    const maxBuy = () => {
      if (!self) return;
      // Solve for the largest order the wallet can actually cover, accounting
      // for the fact that each extra unit costs more than the last.
      const bySpace = Math.floor(space / good.weight);
      let best = 0;
      let lo = 1;
      let hi = Math.max(1, bySpace);
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const cost = estimateTrade(quote.buy, quote.stock, quote.baseline, mid, 'buy', exponent).total;
        if (cost <= self.gold) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      qtyBox.value = String(Math.max(1, best));
      updatePreview();
    };

    body.appendChild(row({
      icon: good.icon,
      title: [
        name(good),
        held > 0 ? pill(`×${Math.round(held)}`, 'good') : null,
        el('span', {
          class: `trend ${cheap ? 'cheap' : dear ? 'dear' : ''}`.trim(),
          title: `${(quote.trend * 100).toFixed(0)}% ${t('price')}`,
        }, cheap ? ' ▼' : dear ? ' ▲' : ' ▬'),
      ],
      sub: [
        `${t('buy')} ${quote.buy.toFixed(1)}  ·  ${t('sell')} ${quote.sell.toFixed(1)}  ·  `,
        `${t('stock')} ${fmtGold(quote.stock)}`,
        preview,
      ],
      trailing: [
        el('div', { style: 'display:flex;flex-direction:column;gap:4px;align-items:flex-end' },
          el('div', { style: 'display:flex;gap:4px;align-items:center' },
            qtyBox,
            el('button', { class: 'btn btn-sm', onclick: maxBuy, title: t('all') }, '⤒'),
          ),
          el('div', { style: 'display:flex;gap:4px' },
            el('button', { class: 'btn btn-sm btn-buy', onclick: () => trade('buy') }, t('buy')),
            el('button', {
              class: 'btn btn-sm btn-sell',
              onclick: () => trade('sell'),
              ...(held <= 0 ? { disabled: true } : {}),
            }, t('sell')),
          ),
        ),
      ],
    }));
  }
}

function filterButton(key: typeof filter, label: string) {
  return el('button', {
    class: `btn btn-sm${filter === key ? ' btn-primary' : ''}`,
    onclick: () => {
      filter = key;
      void import('./index.js').then((m) => m.renderActive());
    },
  }, label);
}

export function cargoOf(id: CommodityId): number {
  return store.self?.inventory.items[id] ?? 0;
}
