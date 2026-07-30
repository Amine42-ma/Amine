import { PRICE_ELASTICITY, MIN_PRICE_RATIO, MAX_PRICE_RATIO } from './constants.js';
import { COMMODITIES, type CommodityId } from './commodities.js';
import { clamp } from './util.js';

/**
 * The price curve, shared verbatim by the server (which executes trades) and the
 * client (which previews them). A large order walks up the curve slice by slice,
 * so the price you see for one unit is not the price you pay for two hundred —
 * and the client must be able to say so honestly before you click.
 */

export function curveExponent(id: CommodityId): number {
  return PRICE_ELASTICITY * COMMODITIES[id].volatility;
}

/** Price multiplier at a given stock level, relative to the demand anchor. */
export function priceFactor(anchor: number, stock: number, exponent: number): number {
  return clamp(Math.pow(anchor / Math.max(1, stock), exponent), MIN_PRICE_RATIO, MAX_PRICE_RATIO);
}

/** How finely an order is split when walking the curve. */
export function slicesFor(quantity: number): number {
  return clamp(Math.ceil(quantity / 5), 1, 24);
}

export interface TradeEstimate {
  total: number;
  filled: number;
  average: number;
}

/**
 * Estimates what an order actually costs or earns, given the price of one unit
 * right now. Because every other multiplier (events, tariffs, the global index)
 * is already baked into `unitNow`, walking the curve only needs the *ratio*
 * between the price at the new stock level and the price at the current one.
 */
export function estimateTrade(
  unitNow: number,
  stock: number,
  anchor: number,
  quantity: number,
  side: 'buy' | 'sell',
  exponent: number,
): TradeEstimate {
  const slices = slicesFor(quantity);
  const per = quantity / slices;
  const factorNow = priceFactor(anchor, stock, exponent);

  let live = stock;
  let total = 0;
  let filled = 0;

  for (let i = 0; i < slices; i++) {
    if (side === 'buy' && live - per < 1) break;
    total += unitNow * (priceFactor(anchor, live, exponent) / factorNow) * per;
    filled += per;
    live = Math.max(1, live + (side === 'buy' ? -per : per));
  }

  return { total, filled, average: filled > 0 ? total / filled : 0 };
}
