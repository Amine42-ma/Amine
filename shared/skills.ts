/**
 * Six skills, each levelled by doing the thing it governs. XP requirements grow
 * geometrically so a level-20 negotiator is a serious investment.
 */

export type SkillId = 'negotiation' | 'management' | 'marketing' | 'investment' | 'shipping' | 'trade';

export interface SkillDef {
  id: SkillId;
  ar: string;
  en: string;
  icon: string;
  /** Per-level effect magnitude, applied with diminishing returns. */
  perLevel: number;
  ar_effect: string;
  en_effect: string;
}

export const MAX_SKILL_LEVEL = 30;

export const SKILLS: Record<SkillId, SkillDef> = {
  negotiation: {
    id: 'negotiation', ar: 'التفاوض', en: 'Negotiation', icon: '🗣️', perLevel: 0.012,
    ar_effect: 'يقلّل فارق السعر في الأسواق',
    en_effect: 'Shrinks the market buy/sell spread',
  },
  management: {
    id: 'management', ar: 'الإدارة', en: 'Management', icon: '📋', perLevel: 0.011,
    ar_effect: 'يخفّض الرواتب وتكاليف التشغيل',
    en_effect: 'Cuts salaries and building upkeep',
  },
  marketing: {
    id: 'marketing', ar: 'التسويق', en: 'Marketing', icon: '📣', perLevel: 0.02,
    ar_effect: 'يزيد سرعة مبيعات متاجرك',
    en_effect: 'Raises how fast your shops sell stock',
  },
  investment: {
    id: 'investment', ar: 'الاستثمار', en: 'Investment', icon: '📈', perLevel: 0.015,
    ar_effect: 'يزيد عوائد البنك والأسهم',
    en_effect: 'Improves bank and equity returns',
  },
  shipping: {
    id: 'shipping', ar: 'الشحن', en: 'Shipping', icon: '🚛', perLevel: 0.016,
    ar_effect: 'يزيد سرعة القوافل وسعة الحمولة',
    en_effect: 'Boosts convoy speed and cargo capacity',
  },
  trade: {
    id: 'trade', ar: 'التجارة الدولية', en: 'International Trade', icon: '🌍', perLevel: 0.014,
    ar_effect: 'يخفّض الرسوم الجمركية في المدن البعيدة',
    en_effect: 'Reduces tariffs in distant cities and ports',
  },
};

export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];

/** Total XP required to reach a given level. */
export function xpForLevel(level: number): number {
  return Math.round(120 * Math.pow(level, 1.85));
}

export function levelFromXp(xp: number): number {
  let level = 0;
  while (level < MAX_SKILL_LEVEL && xp >= xpForLevel(level + 1)) level++;
  return level;
}

/**
 * Skill effects saturate: each level adds `perLevel` of the *remaining* headroom,
 * so early levels feel great and level 30 is strong but not game-breaking.
 */
export function skillFactor(level: number, perLevel: number): number {
  return 1 - Math.pow(1 - perLevel, level);
}
