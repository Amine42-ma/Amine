/** Tunable constants shared by the simulation and the client's predictions. */

export const TILE_SIZE = 32;
export const WORLD_W = 320;
export const WORLD_H = 320;

/** Server simulation cadence. */
export const TICK_MS = 1000;
/** How often movement/presence snapshots go out to each client. */
export const SNAPSHOT_MS = 100;
/** Radius (in tiles) of the area-of-interest around a player for presence updates. */
export const AOI_RADIUS = 45;

/** Base travel speed in tiles per second, before vehicle and skill modifiers. */
export const BASE_SPEED = 2.8;

export const STARTING_GOLD = 1200;
export const STARTING_CAPACITY = 60;

/** A season lasts 90 real days, as designed. */
export const SEASON_DAYS = 90;
export const SEASON_MS = SEASON_DAYS * 24 * 60 * 60 * 1000;

/** Economy tuning. */
export const PRICE_ELASTICITY = 0.85;
/**
 * Hard rails on how far a local price may stray from the world base. Without
 * them a thinly-stocked village can be drained by one caravan and swing 16x,
 * which turns arbitrage into a money printer.
 */
export const MIN_PRICE_RATIO = 0.5;
export const MAX_PRICE_RATIO = 2.5;
/**
 * The rest of the world trades with each settlement in proportion to how far its
 * price has drifted from the global base: expensive towns attract imports, glutted
 * ones export. This is what gives every settlement a *different* equilibrium price
 * instead of every market converging on the same number.
 */
export const WORLD_TRADE_RATE = 0.1;
/** Stock at which a good sells for exactly its base price, as a multiple of demand. */
export const ANCHOR_MINUTES = 30;
/** Merchant spread: the gap between a city's buy and sell price, before negotiation. */
export const BASE_SPREAD = 0.09;

/** Bank tuning (annualised rates, applied per-tick pro rata). */
export const DEPOSIT_APR = 0.04;
export const LOAN_APR = 0.18;
export const CREDIT_BASE_LIMIT = 3500;

/** Company / stock market tuning. */
export const INCORPORATION_COST = 25_000;
export const TOTAL_SHARES = 1000;

/** Salaries are charged every payroll interval. */
export const PAYROLL_INTERVAL_MS = 60_000;

/** Maximum number of live world events at once. */
export const MAX_ACTIVE_EVENTS = 4;

export const MAX_CHAT_LEN = 240;
export const CHAT_HISTORY = 60;
