/** Employees. Each one draws a salary every payroll interval and boosts one axis. */

export type WorkerId = 'laborer' | 'driver' | 'manager' | 'accountant' | 'guard' | 'trader';

export interface WorkerDef {
  id: WorkerId;
  ar: string;
  en: string;
  icon: string;
  /** Gold per payroll interval. */
  salary: number;
  ar_effect: string;
  en_effect: string;
}

export const WORKERS: Record<WorkerId, WorkerDef> = {
  laborer: {
    id: 'laborer', ar: 'عامل', en: 'Laborer', icon: '👷', salary: 90,
    ar_effect: '+8% سرعة إنتاج لكل مبنى مأهول',
    en_effect: '+8% production speed per staffed building',
  },
  driver: {
    id: 'driver', ar: 'سائق', en: 'Driver', icon: '🧑‍✈️', salary: 140,
    ar_effect: '+6% سرعة القوافل',
    en_effect: '+6% convoy speed',
  },
  manager: {
    id: 'manager', ar: 'مدير', en: 'Manager', icon: '🧑‍💼', salary: 320,
    ar_effect: '-4% تكاليف التشغيل',
    en_effect: '-4% operating upkeep',
  },
  accountant: {
    id: 'accountant', ar: 'محاسب', en: 'Accountant', icon: '🧮', salary: 280,
    ar_effect: '-3% فائدة القروض و+2% عائد الودائع',
    en_effect: '-3% loan interest, +2% deposit yield',
  },
  guard: {
    id: 'guard', ar: 'حارس', en: 'Guard', icon: '🛡️', salary: 190,
    ar_effect: '-9% خسائر القوافل من الأحداث',
    en_effect: '-9% convoy losses from world events',
  },
  trader: {
    id: 'trader', ar: 'تاجر مساعد', en: 'Junior Trader', icon: '🤝', salary: 240,
    ar_effect: '-2% فارق السعر عند البيع والشراء',
    en_effect: '-2% market spread on buy and sell',
  },
};

export const WORKER_IDS = Object.keys(WORKERS) as WorkerId[];

/** Diminishing returns keep a thousand laborers from breaking the sim. */
export function staffBonus(count: number, perUnit: number): number {
  if (count <= 0) return 0;
  return 1 - Math.pow(1 - perUnit, Math.min(count, 60));
}
