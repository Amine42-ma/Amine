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

/** الأسلحة الافتراضية — تستخدم النماذج المرفقة، وتوجَّه تلقائياً في اليد */
export function defaultWeapons() {
  const W = (o) => ({
    id: uid('w'), assetId: null, icon: null, scale: 1,
    hold: { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 },
    fps:  { px: 0.24, py: -0.20, pz: -0.42, rx: 0, ry: 0, rz: 0 },
    len: 1.0, adsFov: 42, zoom: 1,
    ...o,
  });
  return [
    W({ id: 'w_shotgun', name: 'بندقية خرطوش', short: 'SG', kind: 'shotgun', ammo: 'sg', emo: '💥',
        assetId: 'bundled_w_shotgun', len: 1.05,
        damage: 13, pellets: 9, rpm: 78, mag: 6, reload: 2.7, spread: 0.085, adsSpread: 0.055,
        range: 48, recoil: 2.4, auto: false, adsFov: 52 }),
    W({ id: 'w_pistol', name: 'مسدس', short: 'PT', kind: 'pistol', ammo: 'smg', emo: '🔫',
        assetId: 'bundled_w_pistol', len: 0.34,
        damage: 24, rpm: 340, mag: 12, reload: 1.5, spread: 0.028, adsSpread: 0.009,
        range: 95, recoil: 0.8, auto: false, adsFov: 50,
        fps: { px: 0.19, py: -0.19, pz: -0.34, rx: 0, ry: 0, rz: 0 } }),
    W({ id: 'w_ak47', name: 'AK-47', short: 'AK', kind: 'ar', ammo: 'ar', emo: '🔫',
        assetId: 'bundled_w_ak47', len: 1.0,
        damage: 30, rpm: 600, mag: 30, reload: 2.3, spread: 0.030, adsSpread: 0.007,
        range: 250, recoil: 1.5, auto: true, adsFov: 44 }),
    W({ id: 'w_m4', name: 'M4', short: 'M4', kind: 'ar', ammo: 'ar', emo: '🔫',
        assetId: 'bundled_w_m4', len: 0.98,
        damage: 25, rpm: 720, mag: 30, reload: 2.1, spread: 0.022, adsSpread: 0.0045,
        range: 260, recoil: 0.85, auto: true, adsFov: 42 }),
    W({ id: 'w_sniper', name: 'بندقية قنص', short: 'SR', kind: 'sniper', ammo: 'sr', emo: '🎯',
        assetId: 'bundled_w_sniper', len: 1.25,
        damage: 92, rpm: 48, mag: 5, reload: 3.2, spread: 0.016, adsSpread: 0.0006,
        range: 520, recoil: 3.0, auto: false, scoped: true, adsFov: 14, zoom: 4,
        fps: { px: 0.20, py: -0.20, pz: -0.55, rx: 0, ry: 0, rz: 0 } }),
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

/**
 * يوجّه أي نموذج سلاح تلقائياً: الفوهة نحو -Z، القبضة للأسفل،
 * الحجم موحّد، ونقطة المسك عند مبدأ الإحداثيات — فيلتصق باليد كما ينبغي
 * مهما كان اتجاه النموذج الأصلي.
 */
export function autoOrientWeapon(obj, targetLen = 1.0) {
  obj.updateMatrixWorld(true);
  const pts = [];
  const v = new THREE.Vector3();
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pa = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pa.count / 2500));
    for (let i = 0; i < pa.count; i += step) {
      v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld);
      pts.push(v.x, v.y, v.z);
    }
  });
  const holder = new THREE.Group();
  if (pts.length < 9) { holder.add(obj); return holder; }

  const n = pts.length / 3;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) {
    const q = pts[i * 3 + a];
    if (q < mn[a]) mn[a] = q;
    if (q > mx[a]) mx[a] = q;
  }
  const size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];

  // 1) المحور الطولي = الأكبر، ومحور الأعلى = الثاني
  const order = [0, 1, 2].sort((a, b) => size[b] - size[a]);
  const L = order[0], U = order[1];

  // 2) الفوهة = الطرف الأنحف على المحور الطولي
  const NB = 16, thick = new Float32Array(NB), cnt = new Float32Array(NB);
  const rest = [0, 1, 2].filter((a) => a !== L);
  const bmin = [Infinity, Infinity], bmax = [-Infinity, -Infinity];
  const perBin = Array.from({ length: NB }, () => [Infinity, -Infinity, Infinity, -Infinity]);
  for (let i = 0; i < n; i++) {
    const t = (pts[i * 3 + L] - mn[L]) / (size[L] || 1);
    const b = Math.min(NB - 1, Math.max(0, Math.floor(t * NB)));
    const p0 = pts[i * 3 + rest[0]], p1 = pts[i * 3 + rest[1]];
    const e = perBin[b];
    if (p0 < e[0]) e[0] = p0; if (p0 > e[1]) e[1] = p0;
    if (p1 < e[2]) e[2] = p1; if (p1 > e[3]) e[3] = p1;
    cnt[b]++;
  }
  for (let b = 0; b < NB; b++) {
    const e = perBin[b];
    thick[b] = cnt[b] > 2 ? ((e[1] - e[0]) + (e[3] - e[2])) / 2 : NaN;
  }
  const avg = (from, to) => {
    let s2 = 0, c = 0;
    for (let b = from; b < to; b++) if (!Number.isNaN(thick[b])) { s2 += thick[b]; c++; }
    return c ? s2 / c : 0;
  };
  const muzzleAtMin = avg(0, 4) < avg(NB - 4, NB);

  // 3) القبضة = الجهة الأبعد عن الوسيط على محور الأعلى (نتوء غير متماثل)
  const ups = new Float32Array(n);
  for (let i = 0; i < n; i++) ups[i] = pts[i * 3 + U];
  const sorted = Float32Array.from(ups).sort();
  const med = sorted[(n / 2) | 0];
  const gripAtMin = (med - mn[U]) > (mx[U] - med);

  // 4) ابنِ أساساً: a = اتجاه الفوهة، b = الأعلى
  const ax = [0, 0, 0]; ax[L] = muzzleAtMin ? -1 : 1;
  const bx = [0, 0, 0]; bx[U] = gripAtMin ? 1 : -1;
  const A = new THREE.Vector3(...ax);
  const B = new THREE.Vector3(...bx);
  const Z = A.clone().multiplyScalar(-1);          // +Z المحلي ← عكس الفوهة
  const X = new THREE.Vector3().crossVectors(B, Z).normalize();
  const Y = new THREE.Vector3().crossVectors(Z, X).normalize();
  const S = new THREE.Matrix4().makeBasis(X, Y, Z);
  const R = S.clone().invert();

  const inner = new THREE.Group();
  inner.quaternion.setFromRotationMatrix(R);
  inner.add(obj);
  holder.add(inner);

  // 5) وحّد الطول ثم اجعل نقطة المسك عند المركز
  holder.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(holder);
  const bs = bb.getSize(new THREE.Vector3());
  const k = targetLen / Math.max(bs.z, 0.0001);
  inner.scale.setScalar(k);
  holder.updateMatrixWorld(true);

  const bb2 = new THREE.Box3().setFromObject(holder);
  // المسك: ثلث خلفي، أسفل قليلاً من مركز الجسم
  const grip = new THREE.Vector3(
    (bb2.min.x + bb2.max.x) / 2,
    bb2.min.y + (bb2.max.y - bb2.min.y) * 0.62,
    bb2.min.z + (bb2.max.z - bb2.min.z) * 0.74
  );
  inner.position.sub(grip);
  holder.userData.length = bb2.max.z - bb2.min.z;
  return holder;
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
