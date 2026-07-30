import type { CommodityId } from './commodities.js';

/**
 * Buildings are the backbone of an empire: extractors pull raw goods out of the
 * land, factories refine them, shops convert stock into passive revenue, and
 * logistics buildings raise your carrying and routing limits.
 */

export type BuildingKind = 'extractor' | 'factory' | 'shop' | 'logistics';

export interface Recipe {
  inputs: Partial<Record<CommodityId, number>>;
  outputs: Partial<Record<CommodityId, number>>;
  /** Seconds for one production cycle at zero staffing. */
  seconds: number;
}

export interface BuildingDef {
  id: string;
  ar: string;
  en: string;
  icon: string;
  kind: BuildingKind;
  cost: number;
  /** Gold charged every payroll interval just to keep the doors open. */
  upkeep: number;
  /** Which terrain the plot must sit on, if restricted. */
  terrain?: ('grass' | 'forest' | 'mountain' | 'desert' | 'water' | 'road' | 'sand')[];
  recipe?: Recipe;
  /** Shops only: retail markup over the local market price. */
  markup?: number;
  /** Shops only: base units sold per minute before marketing bonuses. */
  salesRate?: number;
  /** Logistics only: extra cargo capacity / convoy slots granted. */
  capacity?: number;
  convoySlots?: number;
  /** Employees the building can usefully hold. */
  jobs: number;
  /** Net-worth requirement before it can be bought, gating the progression. */
  requiresNetWorth?: number;
  description_ar: string;
  description_en: string;
}

export const BUILDINGS: Record<string, BuildingDef> = {
  /* ---------------------------------------------------------------- extractors */
  lumber_camp: {
    id: 'lumber_camp', ar: 'مخيم الحطابين', en: 'Lumber Camp', icon: '🪓', kind: 'extractor',
    cost: 3_200, upkeep: 60, terrain: ['forest'], jobs: 4,
    recipe: { inputs: {}, outputs: { wood: 12 }, seconds: 60 },
    description_ar: 'ينتج الخشب من الغابات.', description_en: 'Harvests wood from forest tiles.',
  },
  farm: {
    id: 'farm', ar: 'مزرعة', en: 'Farm', icon: '🚜', kind: 'extractor',
    cost: 4_000, upkeep: 80, terrain: ['grass'], jobs: 5,
    recipe: { inputs: {}, outputs: { wheat: 14, cotton: 5 }, seconds: 60 },
    description_ar: 'تنتج القمح والقطن.', description_en: 'Produces wheat and cotton.',
  },
  ranch: {
    id: 'ranch', ar: 'مرعى', en: 'Ranch', icon: '🐑', kind: 'extractor',
    cost: 6_500, upkeep: 130, terrain: ['grass'], jobs: 5,
    recipe: { inputs: { wheat: 6 }, outputs: { livestock: 4 }, seconds: 75 },
    description_ar: 'يحوّل القمح إلى ماشية.', description_en: 'Turns wheat into livestock.',
  },
  plantation: {
    id: 'plantation', ar: 'مزرعة قصب', en: 'Plantation', icon: '🌿', kind: 'extractor',
    cost: 5_400, upkeep: 100, terrain: ['grass', 'forest'], jobs: 5,
    recipe: { inputs: {}, outputs: { sugar: 10 }, seconds: 60 },
    description_ar: 'تنتج السكر.', description_en: 'Produces sugar.',
  },
  iron_mine: {
    id: 'iron_mine', ar: 'منجم حديد', en: 'Iron Mine', icon: '⛏️', kind: 'extractor',
    cost: 9_000, upkeep: 190, terrain: ['mountain'], jobs: 8,
    recipe: { inputs: {}, outputs: { iron: 9 }, seconds: 60 },
    description_ar: 'يستخرج الحديد من الجبال.', description_en: 'Extracts iron from mountains.',
  },
  coal_mine: {
    id: 'coal_mine', ar: 'منجم فحم', en: 'Coal Mine', icon: '⛏️', kind: 'extractor',
    cost: 7_800, upkeep: 165, terrain: ['mountain'], jobs: 8,
    recipe: { inputs: {}, outputs: { coal: 12 }, seconds: 60 },
    description_ar: 'يستخرج الفحم.', description_en: 'Extracts coal.',
  },
  gold_mine: {
    id: 'gold_mine', ar: 'منجم ذهب', en: 'Gold Mine', icon: '🏔️', kind: 'extractor',
    cost: 42_000, upkeep: 780, terrain: ['mountain'], jobs: 10, requiresNetWorth: 60_000,
    recipe: { inputs: {}, outputs: { gold: 3 }, seconds: 90 },
    description_ar: 'يستخرج الذهب الخام.', description_en: 'Extracts raw gold.',
  },
  diamond_mine: {
    id: 'diamond_mine', ar: 'منجم ألماس', en: 'Diamond Mine', icon: '💎', kind: 'extractor',
    cost: 165_000, upkeep: 2_600, terrain: ['mountain', 'desert'], jobs: 12, requiresNetWorth: 300_000,
    recipe: { inputs: {}, outputs: { diamond: 1 }, seconds: 120 },
    description_ar: 'أغلى منجم في اللعبة.', description_en: 'The most valuable mine in the world.',
  },
  salt_flat: {
    id: 'salt_flat', ar: 'ملاحة', en: 'Salt Flat', icon: '🏜️', kind: 'extractor',
    cost: 4_600, upkeep: 85, terrain: ['desert'], jobs: 4,
    recipe: { inputs: {}, outputs: { salt: 11 }, seconds: 60 },
    description_ar: 'تنتج الملح من الصحراء.', description_en: 'Harvests salt from desert flats.',
  },
  oil_rig: {
    id: 'oil_rig', ar: 'حفّار نفط', en: 'Oil Rig', icon: '🛢️', kind: 'extractor',
    cost: 78_000, upkeep: 1_450, terrain: ['desert', 'water'], jobs: 10, requiresNetWorth: 120_000,
    recipe: { inputs: {}, outputs: { oil: 8 }, seconds: 75 },
    description_ar: 'يستخرج النفط الخام.', description_en: 'Pumps crude oil.',
  },
  fishery: {
    id: 'fishery', ar: 'مصيدة أسماك', en: 'Fishery', icon: '🎣', kind: 'extractor',
    cost: 5_200, upkeep: 95, terrain: ['water'], jobs: 5,
    recipe: { inputs: {}, outputs: { fish: 11 }, seconds: 60 },
    description_ar: 'تصطاد الأسماك من البحر.', description_en: 'Catches fish at sea.',
  },

  /* ------------------------------------------------------------------ factories */
  smelter: {
    id: 'smelter', ar: 'مصهر', en: 'Smelter', icon: '🔥', kind: 'factory',
    cost: 22_000, upkeep: 420, jobs: 8,
    recipe: { inputs: { iron: 2, coal: 1 }, outputs: { steel: 1 }, seconds: 35 },
    description_ar: 'حديد + فحم = فولاذ.', description_en: 'Iron + coal = steel.',
  },
  textile_mill: {
    id: 'textile_mill', ar: 'مصنع نسيج', en: 'Textile Mill', icon: '🧶', kind: 'factory',
    cost: 15_000, upkeep: 300, jobs: 7,
    recipe: { inputs: { cotton: 2 }, outputs: { cloth: 1 }, seconds: 30 },
    description_ar: 'قطن = قماش.', description_en: 'Cotton = cloth.',
  },
  tannery: {
    id: 'tannery', ar: 'مدبغة', en: 'Tannery', icon: '🐂', kind: 'factory',
    cost: 19_000, upkeep: 360, jobs: 6,
    recipe: { inputs: { livestock: 2, salt: 1 }, outputs: { leather: 3 }, seconds: 45 },
    description_ar: 'ماشية + ملح = جلود.', description_en: 'Livestock + salt = leather.',
  },
  garment_factory: {
    id: 'garment_factory', ar: 'مصنع ملابس', en: 'Garment Factory', icon: '🧥', kind: 'factory',
    cost: 46_000, upkeep: 880, jobs: 12, requiresNetWorth: 70_000,
    recipe: { inputs: { cloth: 2, leather: 1 }, outputs: { clothes: 2 }, seconds: 50 },
    description_ar: 'قماش + جلد = ملابس.', description_en: 'Cloth + leather = clothes.',
  },
  refinery: {
    id: 'refinery', ar: 'مصفاة', en: 'Refinery', icon: '🏭', kind: 'factory',
    cost: 96_000, upkeep: 1_900, jobs: 14, requiresNetWorth: 150_000,
    recipe: { inputs: { oil: 2 }, outputs: { fuel: 1 }, seconds: 40 },
    description_ar: 'نفط = وقود.', description_en: 'Oil = fuel.',
  },
  pharma_lab: {
    id: 'pharma_lab', ar: 'مختبر أدوية', en: 'Pharma Lab', icon: '⚗️', kind: 'factory',
    cost: 88_000, upkeep: 1_750, jobs: 10, requiresNetWorth: 140_000,
    recipe: { inputs: { sugar: 2, salt: 1, cotton: 1 }, outputs: { medicine: 1 }, seconds: 55 },
    description_ar: 'سكر + ملح + قطن = أدوية.', description_en: 'Sugar + salt + cotton = medicine.',
  },
  electronics_plant: {
    id: 'electronics_plant', ar: 'مصنع إلكترونيات', en: 'Electronics Plant', icon: '🔌', kind: 'factory',
    cost: 210_000, upkeep: 4_200, jobs: 18, requiresNetWorth: 400_000,
    recipe: { inputs: { gold: 1, steel: 2 }, outputs: { electronics: 2 }, seconds: 60 },
    description_ar: 'ذهب + فولاذ = إلكترونيات.', description_en: 'Gold + steel = electronics.',
  },
  jeweler: {
    id: 'jeweler', ar: 'ورشة مجوهرات', en: 'Jeweler', icon: '💍', kind: 'factory',
    cost: 260_000, upkeep: 4_800, jobs: 8, requiresNetWorth: 500_000,
    recipe: { inputs: { gold: 2, diamond: 1 }, outputs: { jewelry: 1 }, seconds: 70 },
    description_ar: 'ذهب + ألماس = مجوهرات.', description_en: 'Gold + diamond = jewelry.',
  },
  auto_plant: {
    id: 'auto_plant', ar: 'مصنع سيارات', en: 'Auto Plant', icon: '🏗️', kind: 'factory',
    cost: 620_000, upkeep: 11_500, jobs: 30, requiresNetWorth: 1_200_000,
    recipe: { inputs: { steel: 3, fuel: 2, electronics: 1 }, outputs: { cars: 1 }, seconds: 90 },
    description_ar: 'فولاذ + وقود + إلكترونيات = سيارات.', description_en: 'Steel + fuel + electronics = cars.',
  },

  /* ---------------------------------------------------------------------- shops */
  small_shop: {
    // The first rung of the ladder: cheap enough that a merchant who has run a
    // few good routes can reach it, since it is what turns active trading into
    // income that keeps arriving while you are offline.
    id: 'small_shop', ar: 'متجر صغير', en: 'Small Shop', icon: '🏪', kind: 'shop',
    cost: 4_500, upkeep: 45, jobs: 2, markup: 0.35, salesRate: 6,
    description_ar: 'أول خطوة نحو الإمبراطورية.', description_en: 'The first step of an empire.',
  },
  medium_shop: {
    id: 'medium_shop', ar: 'متجر متوسط', en: 'Medium Shop', icon: '🏬', kind: 'shop',
    cost: 34_000, upkeep: 260, jobs: 6, markup: 0.4, salesRate: 20, requiresNetWorth: 55_000,
    description_ar: 'مبيعات أعلى وهامش أفضل.', description_en: 'Higher throughput, better margin.',
  },
  mall: {
    id: 'mall', ar: 'مول تجاري', en: 'Shopping Mall', icon: '🛍️', kind: 'shop',
    cost: 190_000, upkeep: 1_400, jobs: 20, markup: 0.45, salesRate: 60, requiresNetWorth: 320_000,
    description_ar: 'يجذب حشود المتسوقين.', description_en: 'Pulls in crowds of shoppers.',
  },
  chain_hq: {
    id: 'chain_hq', ar: 'سلسلة متاجر', en: 'Retail Chain HQ', icon: '🏢', kind: 'shop',
    cost: 740_000, upkeep: 5_200, jobs: 40, markup: 0.5, salesRate: 160, requiresNetWorth: 1_400_000,
    description_ar: 'يرفع مبيعات كل متاجرك في نفس المدينة.', description_en: 'Boosts every shop you own in the same city.',
  },
  global_corp: {
    id: 'global_corp', ar: 'شركة عالمية', en: 'Global Corporation', icon: '🌐', kind: 'shop',
    cost: 3_100_000, upkeep: 19_000, jobs: 90, markup: 0.55, salesRate: 420, requiresNetWorth: 6_000_000,
    description_ar: 'قمة الهرم التجاري.', description_en: 'The summit of commerce.',
  },

  /* ------------------------------------------------------------------ logistics */
  warehouse: {
    id: 'warehouse', ar: 'مستودع', en: 'Warehouse', icon: '📦', kind: 'logistics',
    cost: 12_000, upkeep: 190, jobs: 3, capacity: 400,
    description_ar: 'يخزن بضاعتك داخل المدينة.', description_en: 'Stores goods inside a city.',
  },
  depot: {
    id: 'depot', ar: 'مرآب قوافل', en: 'Convoy Depot', icon: '🚏', kind: 'logistics',
    cost: 28_000, upkeep: 480, jobs: 4, convoySlots: 2, requiresNetWorth: 45_000,
    description_ar: 'يمنحك خطوط قوافل إضافية.', description_en: 'Grants additional convoy routes.',
  },
  port: {
    id: 'port', ar: 'ميناء', en: 'Port', icon: '⚓', kind: 'logistics',
    cost: 260_000, upkeep: 4_600, jobs: 22, convoySlots: 3, capacity: 900,
    terrain: ['water'], requiresNetWorth: 450_000,
    description_ar: 'يفتح التجارة البحرية الدولية.', description_en: 'Unlocks international sea trade.',
  },
};

export const BUILDING_IDS = Object.keys(BUILDINGS);

export function building(id: string): BuildingDef | undefined {
  return BUILDINGS[id];
}
