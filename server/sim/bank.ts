import {
  DEPOSIT_APR, LOAN_APR, CREDIT_BASE_LIMIT, PAYROLL_INTERVAL_MS,
} from '../../shared/constants.js';
import { BUILDINGS } from '../../shared/buildings.js';
import { VEHICLES } from '../../shared/vehicles.js';
import type { CommodityId } from '../../shared/commodities.js';
import { WORKERS, staffBonus, type WorkerId } from '../../shared/staff.js';
import { SKILLS, skillFactor } from '../../shared/skills.js';
import { clamp, newId } from '../../shared/util.js';
import type { GameState, Player } from '../game/state.js';
import { worldAverage } from './economy.js';

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** Everything a player owns, valued in gold. This is the score that matters. */
export function netWorth(state: GameState, p: Player): number {
  let total = p.gold + p.bank;

  for (const key of Object.keys(p.inventory)) {
    const id = key as CommodityId;
    total += (p.inventory[id] ?? 0) * worldAverage(state, id);
  }

  for (const bid of p.buildings) {
    const b = state.buildings.get(bid);
    if (!b) continue;
    const def = BUILDINGS[b.defId];
    if (def) total += def.cost * 0.7;
    for (const key of Object.keys(b.storage)) {
      const id = key as CommodityId;
      total += (b.storage[id] ?? 0) * worldAverage(state, id);
    }
  }

  for (const key of Object.keys(p.fleet)) {
    const vid = key as keyof typeof VEHICLES;
    total += (p.fleet[vid] ?? 0) * VEHICLES[vid].cost * 0.7;
  }

  for (const [companyId, shares] of Object.entries(p.shares)) {
    const co = state.companies.get(companyId);
    if (co) total += shares * co.sharePrice;
  }

  for (const loan of p.loans) total -= loan.owed;

  return Math.max(0, total);
}

/** Borrowing power scales with assets and repayment history. */
export function creditLimit(state: GameState, p: Player): number {
  const worth = netWorth(state, p);
  const scoreMul = clamp(p.creditScore / 600, 0.35, 2.2);
  return Math.floor((CREDIT_BASE_LIMIT + worth * 0.55) * scoreMul);
}

export function outstandingDebt(p: Player): number {
  return p.loans.reduce((sum, l) => sum + l.owed, 0);
}

export function effectiveLoanApr(p: Player): number {
  const accountants = staffBonus(p.staff.accountant ?? 0, 0.03);
  const invest = skillFactor(p.skills.investment.level, SKILLS.investment.perLevel) * 0.4;
  const scoreDiscount = clamp((p.creditScore - 600) / 2000, -0.06, 0.06);
  return Math.max(0.04, LOAN_APR * (1 - accountants - invest) - scoreDiscount);
}

export function effectiveDepositApr(p: Player): number {
  const accountants = staffBonus(p.staff.accountant ?? 0, 0.02);
  const invest = skillFactor(p.skills.investment.level, SKILLS.investment.perLevel);
  return DEPOSIT_APR * (1 + accountants + invest);
}

export function takeLoan(state: GameState, p: Player, amount: number): { ok: boolean; reason?: string } {
  const amt = Math.floor(amount);
  if (!(amt > 0)) return { ok: false, reason: 'amount' };
  const limit = creditLimit(state, p);
  if (outstandingDebt(p) + amt > limit) return { ok: false, reason: 'limit' };
  p.loans.push({
    id: newId('loan'),
    principal: amt,
    owed: amt,
    apr: effectiveLoanApr(p),
    takenAt: Date.now(),
  });
  p.gold += amt;
  return { ok: true };
}

export function repayLoan(p: Player, loanId: string, amount: number): { ok: boolean; cleared: boolean } {
  const loan = p.loans.find((l) => l.id === loanId);
  if (!loan) return { ok: false, cleared: false };
  const pay = Math.min(Math.floor(amount), loan.owed, Math.floor(p.gold));
  if (pay <= 0) return { ok: false, cleared: false };
  p.gold -= pay;
  loan.owed -= pay;
  if (loan.owed <= 0.5) {
    p.loans = p.loans.filter((l) => l.id !== loanId);
    // Clean repayment is the single biggest driver of credit score.
    p.creditScore = clamp(p.creditScore + 45, 300, 900);
    return { ok: true, cleared: true };
  }
  p.creditScore = clamp(p.creditScore + 2, 300, 900);
  return { ok: true, cleared: false };
}

/** Accrues interest on both sides of the ledger. */
export function stepBank(state: GameState, dtMs: number) {
  const yearFraction = dtMs / YEAR_MS;
  for (const p of state.players.values()) {
    if (p.isNpc) continue;
    if (p.bank > 0) {
      const gain = p.bank * effectiveDepositApr(p) * yearFraction;
      p.bank += gain;
      p.windowRevenue += gain;
    }
    for (const loan of p.loans) {
      const interest = loan.owed * loan.apr * yearFraction;
      loan.owed += interest;
      p.windowCost += interest;
    }
  }
}

export interface PayrollResult {
  playerId: string;
  cost: number;
  /** True when the player could not cover wages and staff walked out. */
  defaulted: boolean;
}

/** Wages + building upkeep, charged on a fixed interval. */
export function runPayroll(state: GameState, now: number): PayrollResult[] {
  const results: PayrollResult[] = [];
  for (const p of state.players.values()) {
    if (p.isNpc) continue;
    if (now < p.nextPayrollAt) continue;
    p.nextPayrollAt = now + PAYROLL_INTERVAL_MS;

    const mgmt = skillFactor(p.skills.management.level, SKILLS.management.perLevel);
    const managers = staffBonus(p.staff.manager ?? 0, 0.04);
    const discount = clamp(1 - mgmt - managers, 0.3, 1);

    let cost = 0;
    for (const key of Object.keys(p.staff)) {
      const id = key as WorkerId;
      cost += (p.staff[id] ?? 0) * WORKERS[id].salary;
    }
    for (const bid of p.buildings) {
      const b = state.buildings.get(bid);
      if (!b || !b.active) continue;
      cost += BUILDINGS[b.defId]?.upkeep ?? 0;
    }
    cost = Math.round(cost * discount);
    p.lastPayrollCost = cost;
    if (cost <= 0) continue;

    let defaulted = false;
    if (p.gold >= cost) {
      p.gold -= cost;
    } else if (p.gold + p.bank >= cost) {
      const fromBank = cost - p.gold;
      p.gold = 0;
      p.bank -= fromBank;
    } else {
      // Missed payroll: staff quit, credit takes a hit, buildings idle.
      defaulted = true;
      p.gold = 0;
      p.bank = 0;
      p.creditScore = clamp(p.creditScore - 60, 300, 900);
      for (const key of Object.keys(p.staff)) {
        const id = key as WorkerId;
        p.staff[id] = Math.floor((p.staff[id] ?? 0) * 0.5);
      }
      for (const bid of p.buildings) {
        const b = state.buildings.get(bid);
        if (b) b.active = false;
      }
    }
    p.windowCost += cost;
    results.push({ playerId: p.id, cost, defaulted });
  }
  return results;
}


