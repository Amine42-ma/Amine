import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { STARTING_GOLD, STARTING_CAPACITY, PAYROLL_INTERVAL_MS } from '../../shared/constants.js';
import { SKILL_IDS, type SkillId } from '../../shared/skills.js';
import { VEHICLES } from '../../shared/vehicles.js';
import { cargoUsed } from '../../shared/commodities.js';
import { SKILLS, skillFactor } from '../../shared/skills.js';
import type { GameState, Player, Skill } from './state.js';
import { storageCapacity } from '../sim/production.js';

export function makePlayer(id: string, name: string, x: number, y: number): Player {
  const skills = {} as Record<SkillId, Skill>;
  for (const s of SKILL_IDS) skills[s] = { xp: 0, level: 0 };

  return {
    id,
    name,
    lowerName: name.trim().toLowerCase(),
    isNpc: false,
    x,
    y,
    gold: STARTING_GOLD,
    bank: 0,
    creditScore: 600,
    prestige: 0,
    vehicle: 'cart',
    fleet: { cart: 1 },
    inventory: {},
    skills,
    staff: {},
    buildings: [],
    convoys: [],
    loans: [],
    companyId: null,
    allianceId: null,
    shares: {},
    achievements: [],
    visited: [],
    windowRevenue: 0,
    windowCost: 0,
    lastProfit: 0,
    createdAt: Date.now(),
    lastSeen: Date.now(),
    nextPayrollAt: Date.now() + PAYROLL_INTERVAL_MS,
    lastPayrollCost: 0,
    tradeVolume: {},
  };
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const attempt = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return attempt.length === expected.length && timingSafeEqual(attempt, expected);
}

export function newToken(): string {
  return randomBytes(24).toString('hex');
}

/** Cargo the player can carry: their vehicle plus every warehouse they own. */
export function carryCapacity(state: GameState, p: Player): number {
  const vehicle = VEHICLES[p.vehicle];
  const skill = skillFactor(p.skills.shipping.level, SKILLS.shipping.perLevel);
  const base = Math.max(STARTING_CAPACITY, vehicle.capacity);
  return Math.floor(base * (1 + skill * 0.6) + storageCapacity(state, p));
}

export function cargoLoad(p: Player): number {
  return cargoUsed(p.inventory);
}

export function freeCapacity(state: GameState, p: Player): number {
  return Math.max(0, carryCapacity(state, p) - cargoLoad(p));
}

/** Personal travel speed, in tiles per second. */
export function playerSpeed(p: Player): number {
  const shipping = skillFactor(p.skills.shipping.level, SKILLS.shipping.perLevel);
  return VEHICLES[p.vehicle].personalSpeedMul * (1 + shipping * 0.35);
}
