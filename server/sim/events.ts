import { WORLD_EVENTS, EVENT_BY_ID, type WorldEventDef } from '../../shared/events.js';
import type { CommodityId } from '../../shared/commodities.js';
import { MAX_ACTIVE_EVENTS } from '../../shared/constants.js';
import { newId, pick } from '../../shared/util.js';
import type { GameState, ActiveEvent } from '../game/state.js';

export interface EventModifiers {
  supply: Partial<Record<CommodityId, number>>;
  demand: Partial<Record<CommodityId, number>>;
  priceMul: number;
  travelMul: number;
  risk: number;
}

const NEUTRAL: EventModifiers = { supply: {}, demand: {}, priceMul: 1, travelMul: 1, risk: 0 };

/**
 * Collapses every event touching `region` into a single set of multipliers.
 * Global events apply everywhere; regional ones only where they landed.
 */
export function modifiersFor(state: GameState, region: string | null): EventModifiers {
  if (state.events.length === 0) return NEUTRAL;
  const mods: EventModifiers = { supply: {}, demand: {}, priceMul: 1, travelMul: 1, risk: 0 };
  let touched = false;

  for (const active of state.events) {
    if (active.region !== null && active.region !== region) continue;
    const def = EVENT_BY_ID[active.defId];
    if (!def) continue;
    touched = true;
    if (def.supply) {
      for (const [k, v] of Object.entries(def.supply)) {
        const id = k as CommodityId;
        mods.supply[id] = (mods.supply[id] ?? 1) * (v as number);
      }
    }
    if (def.demand) {
      for (const [k, v] of Object.entries(def.demand)) {
        const id = k as CommodityId;
        mods.demand[id] = (mods.demand[id] ?? 1) * (v as number);
      }
    }
    if (def.priceMul) mods.priceMul *= def.priceMul;
    if (def.travelMul) mods.travelMul *= def.travelMul;
    if (def.riskPerLeg) mods.risk = Math.max(mods.risk, def.riskPerLeg);
  }
  return touched ? mods : NEUTRAL;
}

export function isCrisisActive(state: GameState): boolean {
  return state.events.some((e) => e.defId === 'crisis');
}

function weightedEvent(rng: () => number): WorldEventDef {
  const total = WORLD_EVENTS.reduce((sum, e) => sum + e.weight, 0);
  let roll = rng() * total;
  for (const e of WORLD_EVENTS) {
    roll -= e.weight;
    if (roll <= 0) return e;
  }
  return WORLD_EVENTS[0];
}

/** Expires finished events and occasionally rolls a new one. Returns what changed. */
export function stepEvents(
  state: GameState,
  now: number,
  rng: () => number,
): { started: ActiveEvent[]; ended: ActiveEvent[] } {
  const ended: ActiveEvent[] = [];
  for (let i = state.events.length - 1; i >= 0; i--) {
    if (state.events[i].endsAt <= now) ended.push(...state.events.splice(i, 1));
  }

  const started: ActiveEvent[] = [];
  if (now >= state.nextEventAt && state.events.length < MAX_ACTIVE_EVENTS) {
    const def = weightedEvent(rng);
    // Never run two copies of the same event at once — it doubles the multipliers.
    if (!state.events.some((e) => e.defId === def.id)) {
      const minutes = def.minMinutes + rng() * (def.maxMinutes - def.minMinutes);
      const active: ActiveEvent = {
        id: newId('ev'),
        defId: def.id,
        region: def.scope === 'global' ? null : pick(rng, state.map.regions),
        startedAt: now,
        endsAt: now + minutes * 60_000,
      };
      state.events.push(active);
      started.push(active);
    }
    // Next roll lands somewhere between 3 and 11 minutes out.
    state.nextEventAt = now + (180 + rng() * 480) * 1000;
  }

  return { started, ended };
}
