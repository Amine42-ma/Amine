/** Transport tiers. Faster tiers cost more up front and burn more per trip. */

export type VehicleId = 'cart' | 'wagon' | 'truck' | 'ship' | 'train' | 'plane';

export interface VehicleDef {
  id: VehicleId;
  ar: string;
  en: string;
  icon: string;
  cost: number;
  /** Cargo units carried. */
  capacity: number;
  /** Tiles per second when travelling a route. */
  speed: number;
  /** Gold burned per tile travelled. */
  costPerTile: number;
  /** Ships and planes ignore land; trains need roads. */
  travel: 'land' | 'sea' | 'air' | 'rail';
  requiresNetWorth?: number;
  /** Set on the vehicle the player physically drives around the map. */
  personalSpeedMul: number;
}

export const VEHICLES: Record<VehicleId, VehicleDef> = {
  cart:  { id: 'cart',  ar: 'عربة خشبية', en: 'Wooden Cart', icon: '🛒', cost: 0,          capacity: 30,    speed: 2.2, costPerTile: 0.05, travel: 'land', personalSpeedMul: 1.0 },
  wagon: { id: 'wagon', ar: 'عربة كبيرة',  en: 'Horse Wagon', icon: '🐎', cost: 9_500,     capacity: 110,   speed: 3.1, costPerTile: 0.12, travel: 'land', personalSpeedMul: 1.25 },
  truck: { id: 'truck', ar: 'شاحنة',      en: 'Truck',       icon: '🚚', cost: 62_000,    capacity: 420,   speed: 5.0, costPerTile: 0.55, travel: 'land', requiresNetWorth: 90_000,    personalSpeedMul: 1.7 },
  ship:  { id: 'ship',  ar: 'سفينة',      en: 'Cargo Ship',  icon: '🚢', cost: 340_000,   capacity: 2_600, speed: 3.6, costPerTile: 1.10, travel: 'sea',  requiresNetWorth: 520_000,   personalSpeedMul: 1.4 },
  train: { id: 'train', ar: 'قطار',       en: 'Freight Train', icon: '🚆', cost: 780_000, capacity: 5_200, speed: 7.5, costPerTile: 2.20, travel: 'rail', requiresNetWorth: 1_300_000, personalSpeedMul: 2.0 },
  plane: { id: 'plane', ar: 'طائرة شحن',  en: 'Cargo Plane', icon: '✈️', cost: 2_400_000, capacity: 1_400, speed: 16.0, costPerTile: 9.50, travel: 'air', requiresNetWorth: 4_000_000, personalSpeedMul: 3.2 },
};

export const VEHICLE_IDS = Object.keys(VEHICLES) as VehicleId[];
