// ============================================================
//  الأسلحة والحقيبة — نظام على غرار ببجي:
//  خانتان للسلاح، ذخيرة لكل نوع، التقاط ورمي، وحقيبة لترتيب الموارد
// ============================================================
import * as THREE from 'three';
import { uid, clamp, rnd, pick } from '../core/util.js';

export const AMMO_KINDS = {
  ar:  { label: 'ذخيرة 5.56', color: '#39e07b', emo: '🟩' },
  smg: { label: 'ذخيرة 9مم',  color: '#ffc21a', emo: '🟨' },
  sg:  { label: 'خرطوش',      color: '#ff4d5e', emo: '🟥' },
  sr:  { label: 'ذخيرة 7.62', color: '#25d3ff', emo: '🟦' },
};

/** أسلحة افتراضية — نماذجها مبنية برمجياً حتى ترفع ملفاتك */
export function defaultWeapons() {
  const W = (o) => ({
    id: uid('w'), assetId: null, icon: null, scale: 1,
    hold: { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 },
    fps:  { px: 0.26, py: -0.24, pz: -0.52, rx: 0, ry: 0, rz: 0 },
    ...o,
  });
  return [
    W({ name: 'رشاش هجومي', short: 'AR', kind: 'ar', ammo: 'ar', emo: '🔫',
        damage: 26, rpm: 640, mag: 30, reload: 2.1, spread: 0.024, adsSpread: 0.005,
        range: 240, recoil: 0.9, auto: true }),
    W({ name: 'رشاش خفيف', short: 'SMG', kind: 'smg', ammo: 'smg', emo: '🔫',
        damage: 19, rpm: 900, mag: 35, reload: 1.8, spread: 0.036, adsSpread: 0.011,
        range: 130, recoil: 0.6, auto: true }),
    W({ name: 'بندقية قنص', short: 'SR', kind: 'sniper', ammo: 'sr', emo: '🎯',
        damage: 88, rpm: 55, mag: 5, reload: 3.0, spread: 0.014, adsSpread: 0.0008,
        range: 480, recoil: 2.6, auto: false, scoped: true }),
    W({ name: 'بندقية خرطوش', short: 'SG', kind: 'shotgun', ammo: 'sg', emo: '💥',
        damage: 14, pellets: 8, rpm: 90, mag: 6, reload: 2.6, spread: 0.075, adsSpread: 0.05,
        range: 55, recoil: 2.0, auto: false }),
    W({ name: 'مسدس', short: 'PT', kind: 'pistol', ammo: 'smg', emo: '🔫',
        damage: 22, rpm: 320, mag: 12, reload: 1.5, spread: 0.03, adsSpread: 0.01,
        range: 90, recoil: 0.7, auto: false }),
  ];
}

// ------------------------------------------------------------
//  نموذج برمجي بسيط لكل نوع سلاح (يُستبدل بملف GLB عند رفعه)
// ------------------------------------------------------------
const MATS = {};
function mat(color, rough = 0.55, metal = 0.65) {
  const k = color + rough + metal;
  return (MATS[k] ||= new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
}
const box = (w, h, d, m, x = 0, y = 0, z = 0) => {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  b.castShadow = true;
  return b;
};

export function buildWeaponMesh(def) {
  const g = new THREE.Group();
  const body = mat('#2a2f38', 0.5, 0.7);
  const dark = mat('#14171d', 0.6, 0.5);
  const grip = mat('#3a2a1c', 0.85, 0.05);
  const accent = mat('#c9a227', 0.35, 0.9);

  switch (def.kind) {
    case 'sniper':
      g.add(box(0.07, 0.09, 1.35, body, 0, 0, -0.15));
      g.add(box(0.05, 0.05, 0.55, dark, 0, 0.005, -0.95));       // السبطانة
      g.add(box(0.09, 0.13, 0.30, grip, 0, -0.10, 0.22));         // القبضة
      g.add(box(0.10, 0.10, 0.34, grip, 0, -0.02, 0.48));         // الأخمص
      g.add(box(0.06, 0.09, 0.34, dark, 0, 0.12, -0.20));         // المنظار
      g.add(box(0.05, 0.05, 0.06, accent, 0, 0.12, -0.38));
      break;
    case 'shotgun':
      g.add(box(0.09, 0.10, 1.00, body, 0, 0, -0.05));
      g.add(box(0.07, 0.07, 0.42, dark, 0, -0.06, -0.55));
      g.add(box(0.09, 0.13, 0.26, grip, 0, -0.11, 0.24));
      g.add(box(0.10, 0.09, 0.30, grip, 0, -0.01, 0.46));
      break;
    case 'pistol':
      g.add(box(0.06, 0.10, 0.30, body, 0, 0.03, -0.06));
      g.add(box(0.06, 0.17, 0.09, grip, 0, -0.10, 0.06));
      g.add(box(0.03, 0.03, 0.10, dark, 0, 0.03, -0.24));
      break;
    case 'smg':
      g.add(box(0.07, 0.11, 0.62, body, 0, 0, -0.02));
      g.add(box(0.05, 0.05, 0.22, dark, 0, 0.01, -0.42));
      g.add(box(0.07, 0.15, 0.10, grip, 0, -0.12, 0.10));
      g.add(box(0.06, 0.20, 0.09, dark, 0, -0.16, -0.06));        // المخزن
      g.add(box(0.05, 0.06, 0.26, dark, 0, 0.02, 0.30));
      break;
    default: // ar
      g.add(box(0.07, 0.12, 0.95, body, 0, 0, -0.06));
      g.add(box(0.05, 0.05, 0.34, dark, 0, 0.01, -0.62));
      g.add(box(0.08, 0.14, 0.11, grip, 0, -0.12, 0.14));
      g.add(box(0.07, 0.24, 0.10, dark, 0, -0.18, -0.08));
      g.add(box(0.09, 0.10, 0.30, grip, 0, -0.02, 0.36));
      g.add(box(0.04, 0.04, 0.16, accent, 0, 0.09, -0.16));
      break;
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/** نقطة خروج الطلقة بالنسبة للسلاح */
export function muzzleOf(def) {
  const z = def.kind === 'sniper' ? -1.25 : def.kind === 'pistol' ? -0.3
    : def.kind === 'smg' ? -0.55 : def.kind === 'shotgun' ? -0.8 : -0.82;
  return new THREE.Vector3(0, 0.02, z);
}

// ------------------------------------------------------------
//  الحقيبة
// ------------------------------------------------------------
export class Inventory {
  constructor(defs) {
    this.defs = defs;
    this.slots = [null, null];          // {def, mag}
    this.active = 0;
    this.reserve = { ar: 0, smg: 0, sg: 0, sr: 0 };
    this.items = { heal: 0, shield: 0, boost: 0 };
    this.capacity = { heal: 6, shield: 6, boost: 4 };
  }

  get gun() { return this.slots[this.active]; }
  get other() { return this.slots[1 - this.active]; }
  get hasGun() { return !!this.gun; }

  emptySlot() { return this.slots[0] ? (this.slots[1] ? -1 : 1) : 0; }

  /** يضيف سلاحاً — يعود {slot, replaced} */
  addWeapon(def) {
    const inst = { def, mag: def.mag };
    const e = this.emptySlot();
    if (e >= 0) { this.slots[e] = inst; this.active = e; return { slot: e, replaced: null }; }
    const old = this.slots[this.active];
    this.slots[this.active] = inst;
    return { slot: this.active, replaced: old };
  }

  dropActive() {
    const g = this.slots[this.active];
    if (!g) return null;
    this.slots[this.active] = null;
    if (!this.slots[this.active] && this.slots[1 - this.active]) this.active = 1 - this.active;
    return g;
  }

  swap() {
    if (!this.slots[0] && !this.slots[1]) return false;
    this.active = 1 - this.active;
    if (!this.slots[this.active]) this.active = 1 - this.active;
    return true;
  }
  select(i) {
    if (this.slots[i]) { this.active = i; return true; }
    return false;
  }

  addAmmo(kind, n) {
    this.reserve[kind] = clamp((this.reserve[kind] || 0) + n, 0, 300);
  }
  addItem(kind, n = 1) {
    this.items[kind] = clamp((this.items[kind] || 0) + n, 0, this.capacity[kind] || 9);
  }
  dropItem(kind) {
    if ((this.items[kind] || 0) <= 0) return false;
    this.items[kind]--;
    return true;
  }
  dropAmmo(kind, n = 30) {
    const have = this.reserve[kind] || 0;
    if (have <= 0) return 0;
    const d = Math.min(have, n);
    this.reserve[kind] = have - d;
    return d;
  }

  /** يعيد التعبئة من المخزون */
  reload() {
    const g = this.gun;
    if (!g) return 0;
    const need = g.def.mag - g.mag;
    if (need <= 0) return 0;
    const have = this.reserve[g.def.ammo] || 0;
    const take = Math.min(need, have);
    if (take <= 0) return 0;
    g.mag += take;
    this.reserve[g.def.ammo] = have - take;
    return take;
  }

  /** حالة العرض في الواجهة */
  hud() {
    const g = this.gun;
    if (!g) return { name: 'بلا سلاح', mag: 0, res: 0, emo: '✋', short: '—' };
    return {
      name: g.def.name, short: g.def.short, emo: g.def.emo,
      mag: g.mag, res: this.reserve[g.def.ammo] || 0,
      icon: g.def.icon,
    };
  }
}

/** توزيع غنيمة صندوق: سلاح + ذخيرة + أدوات */
export function crateLoot(defs) {
  const out = [];
  const w = pick(defs);
  out.push({ t: 'weapon', def: w });
  out.push({ t: 'ammo', kind: w.ammo, n: w.mag * (w.kind === 'sniper' ? 3 : 2) });
  if (Math.random() < 0.75) out.push({ t: 'ammo', kind: pick(Object.keys(AMMO_KINDS)), n: 30 });
  if (Math.random() < 0.6) out.push({ t: 'item', kind: 'heal', n: 1 });
  if (Math.random() < 0.5) out.push({ t: 'item', kind: 'shield', n: 1 });
  if (Math.random() < 0.25) out.push({ t: 'item', kind: 'boost', n: 1 });
  return out;
}
