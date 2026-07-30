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
 *
 * It is expressed as a fraction of the good's local throughput per minute, per
 * unit of price deviation — deliberately independent of market depth below, so
 * that making markets deeper does not quietly flatten every price in the world.
 */
export const WORLD_TRADE_RATE = 1.8;

/**
 * Overall size of every settlement's trade, in units per minute. This is what
 * makes a drained market refill in minutes rather than hours: restoring flow is
 * proportional to throughput, so a world that trades briskly also heals briskly.
 */
export const ECONOMY_SCALE = 20;

/**
 * Stock at which a good sells for exactly its base price, expressed as minutes
 * of local demand. Together with MIN_MARKET_DEPTH this sets only how hard a
 * single order pushes the price, not where the price settles.
 */
export const ANCHOR_MINUTES = 20;
/**
 * Floor on how many units a settlement actually holds at equilibrium. Applied to
 * *stock*, not to the anchor: an expensive town is expensive precisely because
 * its stock sits far below its anchor, so flooring the anchor leaves the real
 * inventory paper-thin and one cartload still swings the price by half.
 *
 * Cities exceed this floor through sheer demand, so a cart barely moves them
 * while a hamlet feels every crate — which is the intended gradient.
 */
export const MIN_MARKET_DEPTH = 600;
/**
 * Merchant spread: the gap between a city's buy and sell price, before the
 * negotiation skill narrows it. Doubled on a round trip, so this is the single
 * biggest tax on trading — keep it low enough that ordinary routes clear it.
 */
export const BASE_SPREAD = 0.06;

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
