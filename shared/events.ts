import type { CommodityId } from './commodities.js';

/**
 * World events are the weather system of the economy. Each one either chokes
 * supply, floods it, or shifts demand — and every player feels it in the prices.
 */

export type EventScope = 'global' | 'region';

export interface WorldEventDef {
  id: string;
  ar: string;
  en: string;
  icon: string;
  ar_desc: string;
  en_desc: string;
  scope: EventScope;
  /** Relative likelihood of being rolled. */
  weight: number;
  minMinutes: number;
  maxMinutes: number;
  /** Multiplies the local stock regeneration of these goods. <1 chokes supply. */
  supply?: Partial<Record<CommodityId, number>>;
  /** Multiplies local consumption (demand) of these goods. */
  demand?: Partial<Record<CommodityId, number>>;
  /** Multiplies every price in scope; used by crises and booms. */
  priceMul?: number;
  /** Multiplies convoy travel time in scope. */
  travelMul?: number;
  /** Chance per convoy leg of losing part of the cargo. */
  riskPerLeg?: number;
}

export const WORLD_EVENTS: WorldEventDef[] = [
  {
    id: 'storm', ar: 'عاصفة', en: 'Storm', icon: '🌪️', scope: 'region', weight: 14,
    minMinutes: 8, maxMinutes: 25,
    ar_desc: 'عاصفة تعطّل الموانئ وتبطئ القوافل.',
    en_desc: 'A storm batters the ports and slows every convoy.',
    supply: { fish: 0.25, wood: 0.6 }, travelMul: 1.7, riskPerLeg: 0.09,
  },
  {
    id: 'drought', ar: 'جفاف', en: 'Drought', icon: '☀️', scope: 'region', weight: 12,
    minMinutes: 20, maxMinutes: 60,
    ar_desc: 'الجفاف يقضي على المحاصيل ويرفع أسعار الغذاء.',
    en_desc: 'Crops wither; food prices climb across the region.',
    supply: { wheat: 0.2, cotton: 0.35, sugar: 0.3, livestock: 0.6 },
    demand: { wheat: 1.4, fish: 1.3 },
  },
  {
    id: 'fire', ar: 'حريق', en: 'Great Fire', icon: '🔥', scope: 'region', weight: 11,
    minMinutes: 6, maxMinutes: 18,
    ar_desc: 'حريق يلتهم المخازن ويشعل الطلب على مواد البناء.',
    en_desc: 'Fire guts the warehouses and demand for materials spikes.',
    supply: { wood: 0.3, cloth: 0.5, clothes: 0.6 },
    demand: { wood: 1.8, steel: 1.5, medicine: 1.4 },
  },
  {
    id: 'earthquake', ar: 'زلزال', en: 'Earthquake', icon: '🌋', scope: 'region', weight: 8,
    minMinutes: 12, maxMinutes: 35,
    ar_desc: 'زلزال يغلق المناجم ويقطع الطرق.',
    en_desc: 'Mines collapse and the roads are cut.',
    supply: { iron: 0.25, coal: 0.25, gold: 0.4, diamond: 0.4 },
    demand: { medicine: 1.9, steel: 1.6 }, travelMul: 1.5, riskPerLeg: 0.06,
  },
  {
    id: 'crisis', ar: 'أزمة اقتصادية', en: 'Economic Crisis', icon: '📉', scope: 'global', weight: 6,
    minMinutes: 25, maxMinutes: 70,
    ar_desc: 'انهيار عالمي: كل الأسعار تهبط والاستهلاك يتوقف.',
    en_desc: 'A worldwide crash: prices sink and consumption stalls.',
    priceMul: 0.66, demand: { cars: 0.4, jewelry: 0.35, electronics: 0.55, clothes: 0.7 },
  },
  {
    id: 'boom', ar: 'ازدهار عالمي', en: 'Global Boom', icon: '🚀', scope: 'global', weight: 6,
    minMinutes: 20, maxMinutes: 55,
    ar_desc: 'ازدهار اقتصادي: الطلب يرتفع على كل شيء.',
    en_desc: 'Money is cheap and everybody is buying.',
    priceMul: 1.28, demand: { cars: 1.6, jewelry: 1.7, electronics: 1.5, clothes: 1.3 },
  },
  {
    id: 'new_mine', ar: 'اكتشاف منجم', en: 'New Mine Discovered', icon: '⛏️', scope: 'region', weight: 10,
    minMinutes: 25, maxMinutes: 80,
    ar_desc: 'منجم جديد يغرق السوق بالمعادن ويهبط بأسعارها.',
    en_desc: 'A rich new seam floods the market with ore.',
    supply: { iron: 2.4, coal: 2.2, gold: 1.9, diamond: 1.6 },
  },
  {
    id: 'plague', ar: 'وباء', en: 'Plague', icon: '🦠', scope: 'region', weight: 7,
    minMinutes: 30, maxMinutes: 90,
    ar_desc: 'وباء يشلّ العمالة ويرفع أسعار الأدوية إلى السماء.',
    en_desc: 'Labour collapses and medicine becomes priceless.',
    supply: { medicine: 0.3, livestock: 0.5, fish: 0.6 },
    demand: { medicine: 3.2, salt: 1.5 }, travelMul: 1.3,
  },
  {
    id: 'festival', ar: 'مهرجان عالمي', en: 'World Festival', icon: '🎉', scope: 'region', weight: 13,
    minMinutes: 10, maxMinutes: 30,
    ar_desc: 'مهرجان ضخم: الجميع يشتري الملابس والمجوهرات والطعام.',
    en_desc: 'A huge festival: clothes, jewelry and food fly off the shelves.',
    demand: { clothes: 2.2, jewelry: 2.4, sugar: 1.9, fish: 1.5, wheat: 1.4 },
  },
  {
    id: 'oil_shock', ar: 'صدمة نفطية', en: 'Oil Shock', icon: '🛢️', scope: 'global', weight: 7,
    minMinutes: 18, maxMinutes: 50,
    ar_desc: 'انقطاع الإمداد يرفع النفط والوقود بشدة ويغلي تكاليف الشحن.',
    en_desc: 'Supply is cut; oil and fuel spike and shipping costs bite.',
    supply: { oil: 0.25, fuel: 0.35 }, demand: { oil: 1.8, fuel: 1.9 }, travelMul: 1.25,
  },
  {
    id: 'trade_war', ar: 'حرب تجارية', en: 'Trade War', icon: '⚔️', scope: 'region', weight: 9,
    minMinutes: 20, maxMinutes: 60,
    ar_desc: 'رسوم جمركية ثقيلة تخنق التجارة في المنطقة.',
    en_desc: 'Heavy tariffs choke trade through the region.',
    priceMul: 1.15, travelMul: 1.4, demand: { electronics: 0.7, cars: 0.6 },
  },
  {
    id: 'bumper_harvest', ar: 'موسم وفير', en: 'Bumper Harvest', icon: '🌾', scope: 'region', weight: 12,
    minMinutes: 15, maxMinutes: 45,
    ar_desc: 'حصاد استثنائي يغرق الأسواق بالقمح والقطن.',
    en_desc: 'An exceptional harvest floods the markets with grain.',
    supply: { wheat: 2.8, cotton: 2.2, sugar: 2.0 },
  },
];

export const EVENT_BY_ID: Record<string, WorldEventDef> = Object.fromEntries(
  WORLD_EVENTS.map((e) => [e.id, e]),
);
