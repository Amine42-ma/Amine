/**
 * Every tradeable good in the world. `basePrice` anchors the supply/demand curve,
 * `weight` is how much cargo space one unit consumes, and `tier` drives which
 * settlements stock the good natively.
 */

export type CommodityId =
  | 'wood' | 'iron' | 'gold' | 'coal' | 'diamond' | 'oil'
  | 'wheat' | 'sugar' | 'salt' | 'fish' | 'livestock' | 'cotton'
  | 'steel' | 'cloth' | 'leather' | 'clothes' | 'fuel'
  | 'medicine' | 'electronics' | 'cars' | 'jewelry';

export type CommodityCategory = 'raw' | 'food' | 'refined' | 'luxury' | 'industrial';

export interface Commodity {
  id: CommodityId;
  ar: string;
  en: string;
  icon: string;
  category: CommodityCategory;
  /** Reference price in gold at equilibrium supply. */
  basePrice: number;
  /** Cargo units consumed per item. */
  weight: number;
  /** 0 = gathered from the land, 1..3 = increasingly processed. */
  tier: 0 | 1 | 2 | 3;
  /** How sharply price reacts to scarcity; luxuries swing harder. */
  volatility: number;
  color: string;
}

export const COMMODITIES: Record<CommodityId, Commodity> = {
  wood:        { id: 'wood',        ar: 'خشب',        en: 'Wood',        icon: '🪵', category: 'raw',        basePrice: 8,     weight: 1.0, tier: 0, volatility: 0.8, color: '#8b5a2b' },
  iron:        { id: 'iron',        ar: 'حديد',       en: 'Iron',        icon: '⛓️', category: 'raw',        basePrice: 18,    weight: 1.4, tier: 0, volatility: 1.0, color: '#9aa5b1' },
  coal:        { id: 'coal',        ar: 'فحم',        en: 'Coal',        icon: '🪨', category: 'raw',        basePrice: 12,    weight: 1.2, tier: 0, volatility: 1.0, color: '#4b5563' },
  gold:        { id: 'gold',        ar: 'ذهب',        en: 'Gold Ore',    icon: '🟡', category: 'luxury',     basePrice: 140,   weight: 1.6, tier: 0, volatility: 1.3, color: '#f5c518' },
  diamond:     { id: 'diamond',     ar: 'ألماس',      en: 'Diamond',     icon: '💎', category: 'luxury',     basePrice: 620,   weight: 0.4, tier: 0, volatility: 1.7, color: '#7dd3fc' },
  oil:         { id: 'oil',         ar: 'نفط',        en: 'Crude Oil',   icon: '🛢️', category: 'raw',        basePrice: 45,    weight: 1.5, tier: 0, volatility: 1.5, color: '#1f2937' },
  wheat:       { id: 'wheat',       ar: 'قمح',        en: 'Wheat',       icon: '🌾', category: 'food',       basePrice: 6,     weight: 1.0, tier: 0, volatility: 1.1, color: '#eab308' },
  sugar:       { id: 'sugar',       ar: 'سكر',        en: 'Sugar',       icon: '🍬', category: 'food',       basePrice: 11,    weight: 1.0, tier: 0, volatility: 1.1, color: '#fbcfe8' },
  salt:        { id: 'salt',        ar: 'ملح',        en: 'Salt',        icon: '🧂', category: 'food',       basePrice: 9,     weight: 0.9, tier: 0, volatility: 0.9, color: '#e5e7eb' },
  fish:        { id: 'fish',        ar: 'أسماك',      en: 'Fish',        icon: '🐟', category: 'food',       basePrice: 14,    weight: 1.1, tier: 0, volatility: 1.4, color: '#38bdf8' },
  livestock:   { id: 'livestock',   ar: 'ماشية',      en: 'Livestock',   icon: '🐄', category: 'food',       basePrice: 34,    weight: 3.0, tier: 0, volatility: 1.0, color: '#c084fc' },
  cotton:      { id: 'cotton',      ar: 'قطن',        en: 'Cotton',      icon: '🌱', category: 'raw',        basePrice: 16,    weight: 1.0, tier: 0, volatility: 1.0, color: '#f9fafb' },

  steel:       { id: 'steel',       ar: 'فولاذ',      en: 'Steel',       icon: '🔩', category: 'industrial', basePrice: 78,    weight: 1.6, tier: 1, volatility: 1.0, color: '#94a3b8' },
  cloth:       { id: 'cloth',       ar: 'قماش',       en: 'Cloth',       icon: '🧵', category: 'refined',    basePrice: 42,    weight: 0.9, tier: 1, volatility: 0.9, color: '#fda4af' },
  leather:     { id: 'leather',     ar: 'جلود',       en: 'Leather',     icon: '🥾', category: 'refined',    basePrice: 88,    weight: 1.3, tier: 1, volatility: 1.0, color: '#a16207' },
  fuel:        { id: 'fuel',        ar: 'وقود',       en: 'Fuel',        icon: '⛽', category: 'industrial', basePrice: 112,   weight: 1.2, tier: 1, volatility: 1.5, color: '#f97316' },

  clothes:     { id: 'clothes',     ar: 'ملابس',      en: 'Clothes',     icon: '👕', category: 'refined',    basePrice: 235,   weight: 1.0, tier: 2, volatility: 0.9, color: '#22d3ee' },
  medicine:    { id: 'medicine',    ar: 'أدوية',      en: 'Medicine',    icon: '💊', category: 'refined',    basePrice: 190,   weight: 0.6, tier: 2, volatility: 1.6, color: '#34d399' },
  electronics: { id: 'electronics', ar: 'إلكترونيات', en: 'Electronics', icon: '📱', category: 'industrial', basePrice: 430,   weight: 0.8, tier: 2, volatility: 1.2, color: '#818cf8' },
  jewelry:     { id: 'jewelry',     ar: 'مجوهرات',    en: 'Jewelry',     icon: '💍', category: 'luxury',     basePrice: 1450,  weight: 0.3, tier: 2, volatility: 1.6, color: '#fcd34d' },
  cars:        { id: 'cars',        ar: 'سيارات',     en: 'Cars',        icon: '🚗', category: 'industrial', basePrice: 1180,  weight: 6.0, tier: 3, volatility: 1.1, color: '#ef4444' },
};

export const COMMODITY_IDS = Object.keys(COMMODITIES) as CommodityId[];

export function commodity(id: CommodityId): Commodity {
  return COMMODITIES[id];
}

/** Cargo space consumed by a whole inventory map. */
export function cargoUsed(inv: Partial<Record<CommodityId, number>>): number {
  let total = 0;
  for (const id of COMMODITY_IDS) {
    const qty = inv[id];
    if (qty) total += qty * COMMODITIES[id].weight;
  }
  return Math.round(total * 100) / 100;
}
