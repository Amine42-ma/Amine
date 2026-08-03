// ============================================================
//  الشخصية — كبسولة بعينين، تصميم كرتوني احترافي + حركة سلسة
// ============================================================
import * as THREE from 'three';
import { clamp, lerp, smooth } from '../core/util.js';

// ---------- خامات مساعدة ----------
function gradTex(a, b, c) {
  const cv = document.createElement('canvas');
  cv.width = 8; cv.height = 128;
  const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, a); gr.addColorStop(0.55, b); gr.addColorStop(1, c || b);
  g.fillStyle = gr; g.fillRect(0, 0, 8, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function blobShadowTex() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, 'rgba(0,0,0,.6)');
  gr.addColorStop(0.55, 'rgba(0,0,0,.28)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}
let _blobTex = null;
const blobTex = () => (_blobTex ||= blobShadowTex());

export function nameTag(text, color = '#ffffff') {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.font = 'bold 34px Tajawal, Segoe UI, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,.85)';
  g.strokeText(text, 128, 34);
  g.fillStyle = color; g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(2.2, 0.55, 1);
  s.renderOrder = 900;
  return s;
}

// ============================================================
export class Character {
  constructor(opts = {}) {
    const o = this.opts = Object.assign({
      body: '#ffc21a', belly: '#fff3c4', eye: '#101018', outline: '#2a1c00',
      height: 1.0, width: 1.0, eyeSize: 1.0, outlineOn: true, lod: false,
    }, opts);
    const D = o.lod ? 0.5 : 1;                       // تفاصيل أقل للروبوتات البعيدة
    const seg = (a, b) => [Math.max(4, Math.round(a * D)), Math.max(6, Math.round(b * D))];

    this.group = new THREE.Group();
    this.root = new THREE.Group();       // الدوران الأفقي فقط (yaw)
    this.tilt = new THREE.Group();       // الميل الأمامي/الجانبي — منفصل كي لا يشوّه الدوران
    this.root.add(this.tilt);
    this.group.add(this.root);

    const R = 0.36 * o.width;
    const L = 0.80 * o.height;
    this.R = R; this.L = L;
    this.totalH = L + R * 2;

    const bodyCol = new THREE.Color(o.body);
    const light = bodyCol.clone().offsetHSL(0, 0.05, 0.16);
    const dark = bodyCol.clone().offsetHSL(0, 0.03, -0.14);

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: gradTex('#' + light.getHexString(), '#' + bodyCol.getHexString(), '#' + dark.getHexString()),
      roughness: 0.48, metalness: 0.04,
      emissive: bodyCol.clone().multiplyScalar(0.06),
    });
    this.bodyMat = mat;

    const geo = new THREE.CapsuleGeometry(R, L, ...seg(10, 26));
    this.body = new THREE.Mesh(geo, mat);
    this.body.castShadow = true; this.body.receiveShadow = true;
    this.body.position.y = R + L / 2;
    this.tilt.add(this.body);

    // مخطّط خارجي (Inverted hull) — مظهر كرتوني
    if (o.outlineOn) {
      const om = new THREE.MeshBasicMaterial({ color: o.outline, side: THREE.BackSide });
      this.outline = new THREE.Mesh(geo, om);
      this.outline.scale.setScalar(1.055);
      this.outline.position.copy(this.body.position);
      this.tilt.add(this.outline);
    }

    // شريط صدر أنيق بدل البطن البارز — مظهر أنظف وأكثر احترافية
    const bandGeo = new THREE.CylinderGeometry(R * 1.015, R * 1.015, L * 0.30, ...seg(26, 1), true);
    const bandMat = new THREE.MeshStandardMaterial({
      color: o.belly, roughness: 0.42, metalness: 0.06, side: THREE.DoubleSide,
    });
    this.belly = new THREE.Mesh(bandGeo, bandMat);
    this.belly.position.set(0, R + L * 0.30, 0);
    this.tilt.add(this.belly);
    this.bellyMat = bandMat;
    // خطّ إضاءة خفيف على الصدر
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x101018, roughness: 0.18, metalness: 0.5,
      emissive: new THREE.Color(o.belly).multiplyScalar(0.25),
    });
    const visor = new THREE.Mesh(new THREE.SphereGeometry(R * 0.99, ...seg(24, 14),
      0, Math.PI * 2, Math.PI * 0.30, Math.PI * 0.16), visorMat);
    visor.position.set(0, R + L * 0.80, 0);
    visor.scale.set(1, 1.1, 0.92);
    this.tilt.add(visor);
    this.visor = visor;

    // العينان
    this.eyes = new THREE.Group();
    this.eyes.position.set(0, R + L * 0.82, R * 0.30);
    this.tilt.add(this.eyes);
    const es = 0.155 * o.eyeSize * o.width;
    const sclera = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.22, metalness: 0 });
    const pupilM = new THREE.MeshStandardMaterial({ color: o.eye, roughness: 0.16, metalness: 0 });
    const glintM = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.eyeL = new THREE.Group(); this.eyeR = new THREE.Group();
    for (const [g, sx] of [[this.eyeL, -1], [this.eyeR, 1]]) {
      const w = new THREE.Mesh(new THREE.SphereGeometry(es, ...seg(18, 14)), sclera);
      w.scale.set(1, 1.16, 0.78);
      g.add(w);
      const p = new THREE.Mesh(new THREE.SphereGeometry(es * 0.55, ...seg(14, 12)), pupilM);
      p.position.set(0, 0, es * 0.55);
      p.scale.set(1, 1.12, 0.7);
      g.add(p);
      const gl = new THREE.Mesh(new THREE.SphereGeometry(es * 0.17, 8, 8), glintM);
      gl.position.set(-es * 0.22 * sx, es * 0.4, es * 0.82);
      g.add(gl);
      g.position.set(sx * es * 1.18, 0, R * 0.62);
      g.userData.pupil = p;
      this.eyes.add(g);
    }
    this.eyeGeoScale = 1;

    // قدمان
    const footMat = new THREE.MeshStandardMaterial({ color: dark.getHex(), roughness: 0.6 });
    const footGeo = new THREE.SphereGeometry(R * 0.34, ...seg(14, 10));
    this.footL = new THREE.Mesh(footGeo, footMat);
    this.footR = new THREE.Mesh(footGeo, footMat);
    for (const f of [this.footL, this.footR]) {
      f.scale.set(1, 0.62, 1.45); f.castShadow = !o.lod; this.tilt.add(f);
    }
    this.footL.position.set(-R * 0.46, R * 0.22, 0);
    this.footR.position.set(R * 0.46, R * 0.22, 0);

    // ظل ناعم
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(R * 3.1, R * 3.1),
      new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false, opacity: 0.75 })
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.03;
    this.blob.renderOrder = 2;
    this.group.add(this.blob);

    // نقاط تعليق الإكسسوارات
    this.mounts = {
      head: new THREE.Group(),
      face: new THREE.Group(),
      body: new THREE.Group(),
      hand: new THREE.Group(),
      back: new THREE.Group(),
    };
    this.mounts.head.position.set(0, R + L + R * 0.72, 0);
    this.mounts.face.position.set(0, R + L * 0.82, R * 0.84);
    this.mounts.body.position.set(0, R + L * 0.36, R * 0.78);
    this.mounts.hand.position.set(R * 1.05, R + L * 0.5, R * 0.35);
    this.mounts.back.position.set(0, R + L * 0.55, -R * 0.86);
    for (const k in this.mounts) this.tilt.add(this.mounts[k]);

    // حالة الحركة
    this.st = {
      speed: 0, t: 0, bob: 0, lean: 0, squash: 1, blink: 0, nextBlink: 2 + Math.random() * 4,
      grounded: true, crouch: 0, aim: 0, yaw: 0, yawV: 0, look: new THREE.Vector2(),
    };
  }

  /** يضع نقشاً مرسوماً يدوياً فوق لون الجسم */
  setDecal(imgOrNull) {
    if (this._decal) { this.tilt.remove(this._decal); this._decal.geometry.dispose(); this._decal = null; }
    if (!imgOrNull) return;
    const tex = imgOrNull instanceof THREE.Texture ? imgOrNull : new THREE.Texture(imgOrNull);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const geo = new THREE.CapsuleGeometry(this.R * 1.012, this.L, 8, 24);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: tex, transparent: true, roughness: 0.5, metalness: 0,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
    }));
    m.position.copy(this.body.position);
    this._decal = m;
    this.tilt.add(m);
  }

  setColors(c) {
    const o = Object.assign(this.opts, c);
    const bodyCol = new THREE.Color(o.body);
    const light = bodyCol.clone().offsetHSL(0, 0.05, 0.16);
    const dark = bodyCol.clone().offsetHSL(0, 0.03, -0.14);
    this.bodyMat.map?.dispose();
    this.bodyMat.map = gradTex('#' + light.getHexString(), '#' + bodyCol.getHexString(), '#' + dark.getHexString());
    this.bodyMat.emissive.copy(bodyCol).multiplyScalar(0.06);
    this.bodyMat.needsUpdate = true;
    this.bellyMat.color.set(o.belly);
    if (this.visor) this.visor.material.emissive.set(o.belly).multiplyScalar(0.25);
    this.footL.material.color.copy(dark);
    if (this.outline) this.outline.material.color.set(o.outline);
    for (const g of [this.eyeL, this.eyeR]) g.userData.pupil.material.color.set(o.eye);
  }

  /** يضيف نموذجاً خارجياً (نظارات/قبعة…) */
  attach(obj, slot = 'head', tr = {}) {
    const m = this.mounts[slot] || this.mounts.head;
    obj.position.set(tr.px || 0, tr.py || 0, tr.pz || 0);
    obj.rotation.set(tr.rx || 0, tr.ry || 0, tr.rz || 0);
    obj.scale.setScalar(tr.scale || 1);
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    m.add(obj);
    return obj;
  }
  clearAttachments() {
    for (const k in this.mounts) {
      const m = this.mounts[k];
      while (m.children.length) m.remove(m.children[0]);
    }
  }

  /** يحدّث الأنيميشن الإجرائي */
  update(dt, s = {}) {
    const st = this.st;
    st.t += dt;
    const spd = s.speed ?? 0;
    st.speed = smooth(st.speed, spd, 12, dt);
    st.grounded = s.grounded !== false;
    st.crouch = smooth(st.crouch, s.crouch ? 1 : 0, 14, dt);
    st.aim = smooth(st.aim, s.aim ? 1 : 0, 12, dt);

    // دوران سلس نحو اتجاه الحركة
    if (s.yaw !== undefined && Number.isFinite(s.yaw)) {
      let d = s.yaw - st.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const k = s.turnSnap ? 40 : (s.aim ? 22 : 13);
      st.yawV = d * k;
      st.yaw += st.yawV * dt;
    }
    this.root.rotation.y = st.yaw;

    const run = clamp(st.speed / 7, 0, 1.4);
    const cyc = st.t * (5.4 + run * 6.5);

    // نطّ وانضغاط
    const air = st.grounded ? 0 : 1;
    const bob = st.grounded ? Math.abs(Math.sin(cyc)) * 0.055 * run : 0;
    const squash = st.grounded
      ? 1 + Math.sin(cyc * 2) * 0.045 * run - st.crouch * 0.3
      : lerp(1, 1.1, clamp((s.vy || 0) / 12, -0.6, 0.6) * 0.5 + 0.5);

    this.body.position.y = this.R + this.L / 2 + bob - st.crouch * this.R * 0.42;
    this.body.scale.set(
      smooth(this.body.scale.x, 2 - squash, 16, dt),
      smooth(this.body.scale.y, squash, 16, dt),
      smooth(this.body.scale.z, 2 - squash, 16, dt)
    );
    if (this._decal) { this._decal.position.copy(this.body.position); this._decal.scale.copy(this.body.scale); }
    if (this.outline) {
      this.outline.position.copy(this.body.position);
      this.outline.scale.copy(this.body.scale).multiplyScalar(1.055);
    }
    this.belly.position.y = this.R + this.L * 0.30 + bob * 0.8 - st.crouch * this.R * 0.42;
    if (this.visor) this.visor.position.y = this.R + this.L * 0.80 + bob * 1.05 - st.crouch * this.R * 0.5;
    this.eyes.position.y = this.R + this.L * 0.82 + bob * 1.1 - st.crouch * this.R * 0.5;

    // ميل للأمام حسب السرعة + انحناء جانبي عند الالتفاف
    const lean = clamp(run * 0.16 + air * 0.06, 0, 0.3);
    const side = clamp(-st.yawV * 0.035, -0.24, 0.24);
    this.tilt.rotation.x = smooth(this.tilt.rotation.x, lean, 9, dt);
    this.tilt.rotation.z = smooth(this.tilt.rotation.z, side, 9, dt);

    // القدمان تتبعان اتجاه الحركة الحقيقي حتى لو كان الجذع ينظر لجهة أخرى
    if (s.moveYaw !== undefined && Number.isFinite(s.moveYaw)) {
      let fd = s.moveYaw - st.yaw;
      while (fd > Math.PI) fd -= Math.PI * 2;
      while (fd < -Math.PI) fd += Math.PI * 2;
      st.legYaw = smooth(st.legYaw || 0, clamp(fd, -1.05, 1.05), 12, dt);
    } else st.legYaw = smooth(st.legYaw || 0, 0, 10, dt);
    this.footL.rotation.y = this.footR.rotation.y = st.legYaw;
    const sw = st.grounded ? Math.sin(cyc) * 0.3 * run : 0.12;
    const lift = st.grounded ? Math.max(0, Math.sin(cyc)) * 0.16 * run : 0.1;
    const lc = Math.cos(st.legYaw || 0), ls = Math.sin(st.legYaw || 0);
    const place = (f, sx, sz, ly) => {
      const ox = sx * this.R * 0.46, oz = sz;
      f.position.set(ox * lc + oz * ls, ly, -ox * ls + oz * lc);
    };
    place(this.footL, -1, sw, this.R * 0.22 + lift - st.crouch * .1);
    place(this.footR, 1, -sw, this.R * 0.22 + Math.max(0, -Math.sin(cyc)) * 0.16 * run - st.crouch * .1);

    // الرمش
    st.blink -= dt;
    if (st.blink <= 0) {
      st.nextBlink -= dt;
      if (st.nextBlink <= 0) { st.blink = 0.13; st.nextBlink = 2.4 + Math.random() * 4.2; }
    }
    const open = st.blink > 0 ? clamp(Math.abs(st.blink - 0.065) / 0.065, 0.08, 1) : 1;
    this.eyeL.scale.y = this.eyeR.scale.y = smooth(this.eyeL.scale.y, open, 30, dt);

    // اتجاه البؤبؤ
    if (s.look) {
      st.look.lerp(s.look, 1 - Math.exp(-10 * dt));
      for (const g of [this.eyeL, this.eyeR]) {
        const p = g.userData.pupil;
        p.position.x = st.look.x * 0.05;
        p.position.y = st.look.y * 0.05;
      }
    }

    // نقاط التعليق تتبع الجسم
    this.mounts.head.position.y = this.R + this.L + this.R * 0.72 + bob - st.crouch * this.R * 0.5;
    this.mounts.face.position.y = this.eyes.position.y;
    this.mounts.body.position.y = this.belly.position.y;
    this.mounts.hand.position.y = this.R + this.L * 0.5 + bob;
    this.mounts.back.position.y = this.R + this.L * 0.55 + bob;

    // الظل
    if (s.groundY !== undefined) {
      this.blob.position.y = s.groundY - this.group.position.y + 0.05;
      const hAir = clamp((this.group.position.y - s.groundY) / 12, 0, 1);
      this.blob.material.opacity = 0.75 * (1 - hAir * 0.75);
      this.blob.scale.setScalar(1 + hAir * 1.1);
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        const m = Array.isArray(o.material) ? o.material : [o.material];
        m.forEach((x) => { x?.map?.dispose?.(); x?.dispose?.(); });
      }
    });
  }
}

// ---------- مظلّة الهبوط ----------
export function buildChute(color = '#ffc21a') {
  const g = new THREE.Group();
  // قبّة بشرائح ملوّنة كما في الألعاب الاحترافية
  const seg = 16;
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(1.7, seg, 14, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: .62, metalness: .02 })
  );
  const cols = [];
  const base = new THREE.Color(color);
  for (let i = 0; i < seg; i++) cols.push(i % 2 ? base : base.clone().offsetHSL(0, 0, -0.22));
  canopy.geometry = canopy.geometry.toNonIndexed();
  const pos = canopy.geometry.attributes.position;
  const carr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const k = Math.floor(((a + Math.PI) / (Math.PI * 2)) * seg) % seg;
    const c = cols[k];
    carr[i * 3] = c.r; carr[i * 3 + 1] = c.g; carr[i * 3 + 2] = c.b;
  }
  canopy.geometry.setAttribute('color', new THREE.BufferAttribute(carr, 3));
  canopy.material.vertexColors = true;
  canopy.scale.set(1, 0.58, 1);
  canopy.position.y = 2.45;
  canopy.castShadow = true;
  g.add(canopy);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x1b1b22 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(Math.cos(a) * 1.62, 2.42, Math.sin(a) * 1.62),
      new THREE.Vector3(0, 0.95, 0),
    ]);
    g.add(new THREE.Line(geo, lineMat));
  }
  g.userData.canopy = canopy;
  return g;
}
