// ============================================================
//  عالم اللعبة — تحميل الخريطة، تحليلها (ارتفاعات/ماء/حدود)،
//  توليد الخريطة المصغّرة وتوزيع الصناديق تلقائياً
// ============================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clamp } from '../core/util.js';

const loader = new GLTFLoader();

export function loadGLB(url, onProgress) {
  return new Promise((res, rej) => {
    loader.load(url, res, (e) => {
      if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
    }, rej);
  });
}

/** يجهّز نموذج الخريطة: توسيط + ظلال + قياس */
export function prepMap(root, targetSize = 0) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  let s = 1;
  if (targetSize > 0) {
    s = targetSize / Math.max(size.x, size.z);
    root.scale.multiplyScalar(s);
  }
  root.position.sub(center.multiplyScalar(s));
  root.position.y = -box.min.y * s;   // قاعدة الخريطة عند y=0
  root.updateMatrixWorld(true);

  const box2 = new THREE.Box3().setFromObject(root);
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      o.frustumCulled = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        m.side = THREE.FrontSide;
        if (m.map) m.map.anisotropy = 4;
      }
    }
  });
  return { box: box2, size: box2.getSize(new THREE.Vector3()), center: box2.getCenter(new THREE.Vector3()) };
}

const isWaterMat = (m) => !!m && /water|ocean|sea\b|river|lake/i.test(m.name || '');

// ------------------------------------------------------------
//  تحليل الخريطة بالـ GPU: 3 تمريرات من الأعلى
// ------------------------------------------------------------
/**
 * شادر تقشير الطبقات: يرسم أعلى سطح لم تلتقطه الطبقة السابقة،
 * ويسجّل معه اتجاه الوجه (أعلى = دخول مادة، أسفل = خروج منها).
 * بهذا نعيد بناء أعمدة «مادة/هواء» فنعرف أرضية كل غرفة وأين الجدران.
 */
const peelMat = new THREE.ShaderMaterial({
  uniforms: {
    uMin: { value: 0 }, uMax: { value: 1 },
    uPrev: { value: null }, uHasPrev: { value: 0 }, uRes: { value: 1024 },
  },
  vertexShader: `
    varying vec3 vW;
    void main(){
      vec4 wp = modelMatrix * vec4(position,1.0);
      vW = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: `
    uniform float uMin,uMax,uHasPrev,uRes;
    uniform sampler2D uPrev;
    varying vec3 vW;
    void main(){
      if (uHasPrev > 0.5) {
        vec4 p = texture2D(uPrev, gl_FragCoord.xy / uRes);
        if (p.a > 0.5) {
          float ph = uMin + ((p.r*255.0*256.0 + p.g*255.0)/65535.0)*(uMax-uMin);
          if (vW.y > ph - 0.03) discard;      // هذه الطبقة أُخذت سابقاً
        }
      }
      float t = clamp((vW.y-uMin)/max(uMax-uMin,0.0001),0.0,1.0);
      float e = t*65535.0;
      float hi = floor(e/256.0);
      float lo = floor(e - hi*256.0);
      gl_FragColor = vec4(hi/255.0, lo/255.0, gl_FrontFacing ? 1.0 : 0.0, 1.0);
    }`,
  side: THREE.DoubleSide,
});

const heightMat = new THREE.ShaderMaterial({
  uniforms: { uMin: { value: 0 }, uMax: { value: 1 } },
  vertexShader: `
    varying float vY;
    void main(){
      vec4 wp = modelMatrix * vec4(position,1.0);
      vY = wp.y;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: `
    uniform float uMin,uMax; varying float vY;
    void main(){
      float t = clamp((vY-uMin)/max(uMax-uMin,0.0001),0.0,1.0);
      float e = t*65535.0;
      float hi = floor(e/256.0);
      float lo = floor(e - hi*256.0);
      gl_FragColor = vec4(hi/255.0, lo/255.0, 0.0, 1.0);
    }`,
  side: THREE.DoubleSide,
});

const ANALYSIS_CACHE = new Map();

/** تحليل مع ذاكرة مؤقتة مشتركة بين المحرّر واللعبة في نفس الجلسة */
export async function analyzeMapCached(renderer, mapRoot, key, opts = {}) {
  if (key && ANALYSIS_CACHE.has(key)) return ANALYSIS_CACHE.get(key);
  const an = await analyzeMap(renderer, mapRoot, opts);
  if (key) ANALYSIS_CACHE.set(key, an);
  return an;
}
export function clearAnalysisCache() { ANALYSIS_CACHE.clear(); }

export async function analyzeMap(renderer, mapRoot, { res = 1024, onStep } = {}) {
  const step = (t, p) => onStep && onStep(t, p);
  mapRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mapRoot);
  const min = box.min, max = box.max;
  const sx = max.x - min.x, sz = max.z - min.z;
  const span = Math.max(sx, sz) * 1.002;
  const cx = (min.x + max.x) / 2, cz = (min.z + max.z) / 2;

  const cam = new THREE.OrthographicCamera(-span / 2, span / 2, span / 2, -span / 2, 0.1, (max.y - min.y) + 400);
  cam.position.set(cx, max.y + 100, cz);
  cam.up.set(0, 0, -1);
  cam.lookAt(cx, min.y, cz);
  cam.updateMatrixWorld(true);

  const scene = new THREE.Scene();
  scene.add(mapRoot);
  const prevAutoClear = renderer.autoClear;
  const prevTarget = renderer.getRenderTarget();
  const prevShadow = renderer.shadowMap.enabled;
  const prevTone = renderer.toneMapping;
  renderer.shadowMap.enabled = false;
  renderer.toneMapping = THREE.NoToneMapping;

  const rt = new THREE.WebGLRenderTarget(res, res, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
    colorSpace: THREE.NoColorSpace, depthBuffer: true,
  });
  const px = new Uint8Array(res * res * 4);

  // ---------- تمريرة 1: الارتفاعات ----------
  step('قياس الارتفاعات', 0.1);
  heightMat.uniforms.uMin.value = min.y;
  heightMat.uniforms.uMax.value = max.y;
  scene.overrideMaterial = heightMat;
  scene.background = null;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  renderer.render(scene, cam);
  renderer.readRenderTargetPixels(rt, 0, 0, res, res, px);

  const H = new Float32Array(res * res);
  const M = new Uint8Array(res * res);      // 0=فارغ 1=يابسة 2=ماء
  const yr = max.y - min.y;
  for (let i = 0; i < res * res; i++) {
    const a = px[i * 4 + 3];
    if (a < 8) { H[i] = min.y; M[i] = 0; continue; }
    const t = (px[i * 4] * 256 + px[i * 4 + 1]) / 65535;
    H[i] = min.y + t * yr;
    M[i] = 1;
  }

  // ---------- تمريرات التقشير: إعادة بناء أعمدة المادة/الهواء ----------
  step('كشف المباني والأرضيات', 0.2);
  const LAYERS = 8;
  const PLAYER_H = 1.7;
  const layH = [], layF = [];
  let prevRT = null;
  const peelRTs = [];
  peelMat.uniforms.uMin.value = min.y;
  peelMat.uniforms.uMax.value = max.y;
  peelMat.uniforms.uRes.value = res;
  scene.overrideMaterial = peelMat;
  for (let L = 0; L < LAYERS; L++) {
    const trt = new THREE.WebGLRenderTarget(res, res, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
      colorSpace: THREE.NoColorSpace, depthBuffer: true,
    });
    peelMat.uniforms.uPrev.value = prevRT ? prevRT.texture : null;
    peelMat.uniforms.uHasPrev.value = L === 0 ? 0 : 1;
    renderer.setRenderTarget(trt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(scene, cam);
    const buf = new Uint8Array(res * res * 4);
    renderer.readRenderTargetPixels(trt, 0, 0, res, res, buf);
    const hArr = new Float32Array(res * res);
    const fArr = new Uint8Array(res * res);
    let any = 0;
    for (let i = 0; i < res * res; i++) {
      if (buf[i * 4 + 3] < 8) { fArr[i] = 2; continue; }        // 2 = لا يوجد سطح
      hArr[i] = min.y + ((buf[i * 4] * 256 + buf[i * 4 + 1]) / 65535) * (max.y - min.y);
      fArr[i] = buf[i * 4 + 2] > 127 ? 1 : 0;                    // 1 = وجه علوي
      any++;
    }
    layH.push(hArr); layF.push(fArr);
    peelRTs.push(trt);
    prevRT = trt;
    if (!any) break;
    step('كشف المباني والأرضيات', 0.2 + (L / LAYERS) * 0.12);
  }
  scene.overrideMaterial = null;
  // أعد الهدف إلى مخزن التحليل قبل التمريرات التالية، وإلا رسمت في المكان الخطأ
  renderer.setRenderTarget(rt);
  for (const t of peelRTs) t.dispose();

  // ---------- تمريرة 2: قناع الماء ----------
  step('كشف البحر', 0.35);
  const swap = [];
  const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  mapRoot.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const w = mats.some(isWaterMat);
    swap.push([o, o.material]);
    o.material = w ? white : black;
  });
  scene.overrideMaterial = null;
  renderer.clear(true, true, true);
  renderer.render(scene, cam);
  renderer.readRenderTargetPixels(rt, 0, 0, res, res, px);
  for (let i = 0; i < res * res; i++) if (M[i] === 1 && px[i * 4] > 140) M[i] = 2;
  for (const [o, m] of swap) o.material = m;

  // ---------- تمريرة 3: صورة الخريطة المصغّرة ----------
  step('رسم الخريطة المصغّرة', 0.6);
  const amb = new THREE.AmbientLight(0xffffff, 2.1);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x6a5a8a, 1.4);
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(0.6, 1, 0.35).multiplyScalar(span);
  scene.add(amb, hemi, dir);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x0a1c33, 1);
  renderer.clear(true, true, true);
  renderer.render(scene, cam);
  const cpx = new Uint8Array(res * res * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, res, res, cpx);
  scene.remove(amb, hemi, dir);

  // إعادة الحالة
  scene.overrideMaterial = null;
  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAutoClear;
  renderer.shadowMap.enabled = prevShadow;
  renderer.toneMapping = prevTone;
  rt.dispose();
  scene.remove(mapRoot);

  // readRenderTargetPixels يعيد الصفوف من الأسفل — نقلبها
  const color = new Uint8ClampedArray(res * res * 4);
  for (let y = 0; y < res; y++) {
    const src = (res - 1 - y) * res * 4;
    color.set(cpx.subarray(src, src + res * 4), y * res * 4);
  }
  const H2 = new Float32Array(res * res), M2 = new Uint8Array(res * res);
  for (let y = 0; y < res; y++) {
    const s = (res - 1 - y) * res, d = y * res;
    H2.set(H.subarray(s, s + res), d);
    M2.set(M.subarray(s, s + res), d);
  }

  step('تحليل الأرض', 0.85);

  // من أعمدة المادة/الهواء: أدنى سطح يمكن الوقوف عليه + هل هو داخل مبنى
  const nL = layH.length;
  const floorH = new Float32Array(res * res);
  const indoorM = new Uint8Array(res * res);
  const blockM = new Uint8Array(res * res);
  for (let i = 0; i < res * res; i++) {
    // اجمع أسطح هذا العمود مرتّبة من الأعلى للأسفل
    let best = null, bestCeil = 0;
    let airTop = Infinity;          // ارتفاع بداية الهواء القادم من الأعلى
    let haveAny = false;
    for (let L = 0; L < nL; L++) {
      const f = layF[L][i];
      if (f === 2) continue;
      haveAny = true;
      const h = layH[L][i];
      if (f === 0) {
        airTop = h;                 // وجه سفلي: هنا يبدأ الهواء نزولاً
      } else {
        // وجه علوي: سطح صلب — هل فوقه هواء كافٍ؟
        const gap = airTop - h;
        if (gap >= PLAYER_H) { best = h; bestCeil = airTop; }
        airTop = -Infinity;         // دخلنا مادة
      }
    }
    if (!haveAny) { floorH[i] = min.y; blockM[i] = 0; continue; }
    if (best === null) {
      // عمود مصمت بلا مكان للوقوف = جدار/صخرة
      blockM[i] = 1;
      floorH[i] = layH[0][i];
    } else {
      floorH[i] = best;
      indoorM[i] = bestCeil < Infinity && bestCeil - best < 9 ? 1 : 0;
    }
  }
  // اقلب الصفوف كما نفعل مع بقية المصفوفات
  const floorF = new Float32Array(res * res);
  const indoorF = new Uint8Array(res * res);
  const blockF = new Uint8Array(res * res);
  for (let y = 0; y < res; y++) {
    const sIdx = (res - 1 - y) * res, d = y * res;
    floorF.set(floorH.subarray(sIdx, sIdx + res), d);
    indoorF.set(indoorM.subarray(sIdx, sIdx + res), d);
    blockF.set(blockM.subarray(sIdx, sIdx + res), d);
  }

  const an = {
    res, span,
    minX: cx - span / 2, minZ: cz - span / 2,
    maxX: cx + span / 2, maxZ: cz + span / 2,
    yMin: min.y, yMax: max.y,
    height: H2, mask: M2, color,
    roof: H2,                 // أعلى سطح (للخريطة المصغّرة)
    floor: floorF,            // أرضية المشي: تدخل المباني بدل تسلّق السطوح
    indoor: indoorF,          // 1 = تحت سقف
    blocked: blockF,          // 1 = عمود مصمت (جدار)
    box: { min: [min.x, min.y, min.z], max: [max.x, max.y, max.z] },
  };
  computeDerived(an);
  step('تم', 1);
  return an;
}

/** ميزات مشتقّة: مستوى الماء، الميل، بُعد الشاطئ */
function computeDerived(an) {
  const { res, height, mask } = an;
  // مستوى الماء = متوسط ارتفاع خلايا الماء (أو أدنى ارتفاع يابسة)
  let ws = 0, wc = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] === 2) { ws += height[i]; wc++; }
  an.waterY = wc > 40 ? ws / wc : an.yMin + (an.yMax - an.yMin) * 0.08;

  // الميل (تدرّج الارتفاع)
  const slope = new Float32Array(res * res);
  const cell = an.span / res;
  for (let y = 1; y < res - 1; y++)
    for (let x = 1; x < res - 1; x++) {
      const i = y * res + x;
      if (mask[i] !== 1) { slope[i] = 9; continue; }
      const dx = (height[i + 1] - height[i - 1]) / (2 * cell);
      const dz = (height[i + res] - height[i - res]) / (2 * cell);
      slope[i] = Math.hypot(dx, dz);
    }
  an.slope = slope;

  // اليابسة الصالحة للمشي
  const land = new Uint8Array(res * res);
  for (let i = 0; i < res * res; i++)
    land[i] = mask[i] === 1 && height[i] > an.waterY + 0.25 ? 1 : 0;

  // أكبر مكوّن متصل = الجزيرة
  const comp = new Int32Array(res * res).fill(-1);
  let best = -1, bestN = 0, cid = 0;
  const stack = new Int32Array(res * res);
  for (let s = 0; s < res * res; s++) {
    if (!land[s] || comp[s] >= 0) continue;
    let sp = 0, n = 0;
    stack[sp++] = s; comp[s] = cid;
    while (sp) {
      const i = stack[--sp]; n++;
      const x = i % res, y = (i / res) | 0;
      if (x > 0 && land[i - 1] && comp[i - 1] < 0) { comp[i - 1] = cid; stack[sp++] = i - 1; }
      if (x < res - 1 && land[i + 1] && comp[i + 1] < 0) { comp[i + 1] = cid; stack[sp++] = i + 1; }
      if (y > 0 && land[i - res] && comp[i - res] < 0) { comp[i - res] = cid; stack[sp++] = i - res; }
      if (y < res - 1 && land[i + res] && comp[i + res] < 0) { comp[i + res] = cid; stack[sp++] = i + res; }
    }
    if (n > bestN) { bestN = n; best = cid; }
    cid++;
  }
  const island = new Uint8Array(res * res);
  for (let i = 0; i < res * res; i++) island[i] = comp[i] === best ? 1 : 0;
  an.island = island;
  an.islandCells = bestN;

  // مسافة تقريبية إلى حافة اليابسة (بالخلايا) — Chamfer distance
  const D = new Float32Array(res * res).fill(1e9);
  for (let i = 0; i < res * res; i++) if (!island[i]) D[i] = 0;
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const i = y * res + x; if (D[i] === 0) continue;
    let v = D[i];
    if (x > 0) v = Math.min(v, D[i - 1] + 1);
    if (y > 0) v = Math.min(v, D[i - res] + 1);
    if (x > 0 && y > 0) v = Math.min(v, D[i - res - 1] + 1.414);
    if (x < res - 1 && y > 0) v = Math.min(v, D[i - res + 1] + 1.414);
    D[i] = v;
  }
  for (let y = res - 1; y >= 0; y--) for (let x = res - 1; x >= 0; x--) {
    const i = y * res + x; if (D[i] === 0) continue;
    let v = D[i];
    if (x < res - 1) v = Math.min(v, D[i + 1] + 1);
    if (y < res - 1) v = Math.min(v, D[i + res] + 1);
    if (x < res - 1 && y < res - 1) v = Math.min(v, D[i + res + 1] + 1.414);
    if (x > 0 && y < res - 1) v = Math.min(v, D[i + res - 1] + 1.414);
    D[i] = v;
  }
  an.edgeDist = D;

  // أقرب خلية يابسة لكل خلية — تمنع الهبوط في البحر
  const NL = new Int32Array(res * res).fill(-1);
  const ND = new Float32Array(res * res).fill(1e9);
  for (let i = 0; i < res * res; i++) if (island[i]) { NL[i] = i; ND[i] = 0; }
  const relax = (i, j, w) => {
    if (NL[j] >= 0 && ND[j] + w < ND[i]) { ND[i] = ND[j] + w; NL[i] = NL[j]; }
  };
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const i = y * res + x;
    if (x > 0) relax(i, i - 1, 1);
    if (y > 0) relax(i, i - res, 1);
    if (x > 0 && y > 0) relax(i, i - res - 1, 1.414);
    if (x < res - 1 && y > 0) relax(i, i - res + 1, 1.414);
  }
  for (let y = res - 1; y >= 0; y--) for (let x = res - 1; x >= 0; x--) {
    const i = y * res + x;
    if (x < res - 1) relax(i, i + 1, 1);
    if (y < res - 1) relax(i, i + res, 1);
    if (x < res - 1 && y < res - 1) relax(i, i + res + 1, 1.414);
    if (x > 0 && y < res - 1) relax(i, i + res - 1, 1.414);
  }
  an.nearLand = NL;

  // نافذة عرض مربّعة متمركزة على الجزيرة (النموذج قد يحوي بحراً شاسعاً)
  let cx0 = res, cx1 = 0, cz0 = res, cz1 = 0, any = false;
  for (let i = 0; i < res * res; i++) {
    if (!island[i]) continue;
    any = true;
    const x = i % res, y = (i / res) | 0;
    if (x < cx0) cx0 = x; if (x > cx1) cx1 = x;
    if (y < cz0) cz0 = y; if (y > cz1) cz1 = y;
  }
  const W = an.maxX - an.minX, H = an.maxZ - an.minZ;
  if (!any) { cx0 = cz0 = 0; cx1 = cz1 = res - 1; }
  let vx0 = an.minX + (cx0 / (res - 1)) * W, vx1 = an.minX + (cx1 / (res - 1)) * W;
  let vz0 = an.minZ + (cz0 / (res - 1)) * H, vz1 = an.minZ + (cz1 / (res - 1)) * H;
  const vcx = (vx0 + vx1) / 2, vcz = (vz0 + vz1) / 2;
  const vs = Math.max(vx1 - vx0, vz1 - vz0) * 1.08;
  an.view = { x0: vcx - vs / 2, z0: vcz - vs / 2, size: vs, cx: vcx, cz: vcz };
}

/** نافذة عرض الخريطة (مربّعة، متمركزة على الجزيرة) */
export const mapView = (an) => an.view || { x0: an.minX, z0: an.minZ, size: an.maxX - an.minX };

// ------------------------------------------------------------
//  استعلامات
// ------------------------------------------------------------
export function makeQuery(an) {
  const { res, island, slope, edgeDist } = an;
  const height = an.floor || an.height;          // نمشي على الأرضية الحقيقية
  const w = an.maxX - an.minX, h = an.maxZ - an.minZ;
  const toU = (x) => ((x - an.minX) / w) * (res - 1);
  const toV = (z) => ((z - an.minZ) / h) * (res - 1);

  function heightAt(x, z) {
    const u = clamp(toU(x), 0, res - 1.001), v = clamp(toV(z), 0, res - 1.001);
    const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
    const i = y0 * res + x0;
    const a = height[i], b = height[i + 1], c = height[i + res], d = height[i + res + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  function cellAt(x, z) {
    const u = Math.round(clamp(toU(x), 0, res - 1)), v = Math.round(clamp(toV(z), 0, res - 1));
    return v * res + u;
  }
  const W2 = an.maxX - an.minX, H2 = an.maxZ - an.minZ;
  /** أقرب نقطة يابسة آمنة لأي إحداثي */
  function nearestLand(x, z, inset = 0) {
    const i = cellAt(x, z);
    if (island[i] === 1 && (!inset || edgeDist[i] >= inset)) return { x, z, moved: false };
    let j = an.nearLand ? an.nearLand[i] : -1;
    if (j < 0) j = i;
    // ادفع للداخل قليلاً لتفادي حافة الشاطئ
    if (inset) {
      let best = j, bestD = edgeDist[j];
      const R = Math.ceil(inset) + 2;
      const cx = j % res, cy = (j / res) | 0;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= res || ny >= res) continue;
        const k = ny * res + nx;
        if (island[k] === 1 && edgeDist[k] > bestD) { bestD = edgeDist[k]; best = k; }
      }
      j = best;
    }
    return {
      x: an.minX + ((j % res) / (res - 1)) * W2,
      z: an.minZ + (((j / res) | 0) / (res - 1)) * H2,
      moved: true,
    };
  }

  const blocked = an.blocked, indoor = an.indoor, roofA = an.roof;
  const roofAt = (x, z) => {
    if (!roofA) return heightAt(x, z);
    const u = clamp(toU(x), 0, res - 1.001), v = clamp(toV(z), 0, res - 1.001);
    const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
    const i = y0 * res + x0;
    const a = roofA[i], b = roofA[i + 1], c = roofA[i + res], d = roofA[i + res + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
  /**
   * السطح الذي يقف عليه شيء موجود عند ارتفاع y:
   * إن كان قريباً من السقف يقف عليه، وإلا فعلى أرضية الطابق الأول —
   * فيدخل المنازل من الأبواب بدل تسلّق سطوحها.
   */
  function groundFor(x, z, y) {
    const f = heightAt(x, z);
    const r = roofAt(x, z);
    if (r - f < 1.2) return r;                 // لا فراغ: سطح واحد
    // لا تُعتبر «فوق السطح» إلا إن كنتَ فعلاً عنده — فلا صعود عرَضي للمباني
    return y > r - 0.5 ? r : f;
  }

  return {
    an, toU, toV, heightAt, cellAt, nearestLand, roofAt, groundFor,
    /** جدار مصمت لا يمكن اجتيازه */
    isBlocked: (x, z) => (blocked ? blocked[cellAt(x, z)] === 1 : false),
    isIndoor: (x, z) => (indoor ? indoor[cellAt(x, z)] === 1 : false),
    isLand: (x, z) => island[cellAt(x, z)] === 1,
    slopeAt: (x, z) => slope[cellAt(x, z)],
    edgeAt: (x, z) => edgeDist[cellAt(x, z)],
    cellSize: an.span / res,
    worldOf: (i) => ({
      x: an.minX + ((i % res) / (res - 1)) * w,
      z: an.minZ + (((i / res) | 0) / (res - 1)) * h,
    }),
  };
}

// ------------------------------------------------------------
//  صورة الخريطة المصغّرة
// ------------------------------------------------------------
export function minimapCanvas(an, { showWater = true } = {}) {
  const res = an.res;
  const v = mapView(an);
  const c = document.createElement('canvas');
  c.width = c.height = res;
  const g = c.getContext('2d');
  const out = new ImageData(res, res);
  const d = out.data, src = an.color, mask = an.mask;
  const W = an.maxX - an.minX, H = an.maxZ - an.minZ;
  for (let y = 0; y < res; y++) {
    const wz = v.z0 + ((y + 0.5) / res) * v.size;
    const gy = Math.round(((wz - an.minZ) / H) * (res - 1));
    for (let x = 0; x < res; x++) {
      const wx = v.x0 + ((x + 0.5) / res) * v.size;
      const gx = Math.round(((wx - an.minX) / W) * (res - 1));
      const o = (y * res + x) * 4;
      d[o + 3] = 255;
      if (gx < 0 || gy < 0 || gx >= res || gy >= res) {
        d[o] = 12; d[o + 1] = 32; d[o + 2] = 62; continue;
      }
      const i = gy * res + gx;
      if (mask[i] === 0) { d[o] = 12; d[o + 1] = 32; d[o + 2] = 62; continue; }
      if (showWater && mask[i] === 2) {
        d[o] = (src[i * 4] * .3 + 16) | 0;
        d[o + 1] = (src[i * 4 + 1] * .45 + 62) | 0;
        d[o + 2] = (src[i * 4 + 2] * .55 + 112) | 0;
        continue;
      }
      d[o] = src[i * 4]; d[o + 1] = src[i * 4 + 1]; d[o + 2] = src[i * 4 + 2];
    }
  }
  g.putImageData(out, 0, 0);
  return c;
}

// ------------------------------------------------------------
//  حدود الخريطة تلقائياً (مضلّع حول الجزيرة)
// ------------------------------------------------------------
export function autoBoundary(an, { inset = 6, maxPoints = 90 } = {}) {
  const { res, island } = an;
  // 1) هيكل مُقلَّص: الخلايا التي تبعد أكثر من inset عن الحافة
  const solid = new Uint8Array(res * res);
  for (let i = 0; i < res * res; i++) solid[i] = island[i] && an.edgeDist[i] >= inset ? 1 : 0;

  // 2) تتبّع الكفاف (Moore neighborhood) من أول خلية
  let start = -1;
  for (let i = 0; i < res * res && start < 0; i++) if (solid[i]) start = i;
  if (start < 0) return [];
  const at = (x, y) => (x < 0 || y < 0 || x >= res || y >= res ? 0 : solid[y * res + x]);
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  let cx = start % res, cy = (start / res) | 0, d = 0;
  const pts = [];
  const first = [cx, cy];
  let guard = res * res * 4;
  do {
    pts.push([cx, cy]);
    let found = false;
    for (let k = 0; k < 8; k++) {
      const nd = (d + 6 + k) % 8;
      const nx = cx + dirs[nd][0], ny = cy + dirs[nd][1];
      if (at(nx, ny)) { cx = nx; cy = ny; d = nd; found = true; break; }
    }
    if (!found) break;
  } while ((cx !== first[0] || cy !== first[1]) && --guard > 0);

  // 3) تبسيط دوجلاس-بويكر
  let simp = rdp(pts, 2.2);
  while (simp.length > maxPoints) simp = rdp(simp, 3.5 + simp.length / maxPoints);

  const w = an.maxX - an.minX, h = an.maxZ - an.minZ;
  return simp.map(([x, y]) => ({
    x: an.minX + (x / (res - 1)) * w,
    z: an.minZ + (y / (res - 1)) * h,
  }));
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let mi = -1, md = 0;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const dist = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (dist > md) { md = dist; mi = i; }
    }
    if (md > eps && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function closestOnPoly(x, z, poly) {
  let bx = x, bz = z, bd = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j].x, az = poly[j].z, cx = poly[i].x, cz = poly[i].z;
    const dx = cx - ax, dz = cz - az;
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    t = clamp(t, 0, 1);
    const px = ax + t * dx, pz = az + t * dz;
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < bd) { bd = d; bx = px; bz = pz; }
  }
  return { x: bx, z: bz, dist: Math.sqrt(bd) };
}

// ------------------------------------------------------------
//  توزيع الصناديق تلقائياً — "ترتيب احترافي"
//  المعايير: أرض مستوية + بعيدة عن البحر + قرب المباني/التضاريس
//  المميّزة + تباعد منتظم + تغطية كل مناطق الجزيرة
// ------------------------------------------------------------
export function autoCrates(an, { count = 46, minGapWorld = 26, edgeMin = 10, indoorBias = 2.4 } = {}) {
  const { res, island, slope, edgeDist, color } = an;
  const height = an.floor || an.height;
  const indoor = an.indoor;
  const cell = an.span / res;
  const gap = Math.max(3, minGapWorld / cell);

  // نتيجة الجاذبية لكل خليّة
  const score = new Float32Array(res * res);
  const R = 5;
  for (let y = R; y < res - R; y++) {
    for (let x = R; x < res - R; x++) {
      const i = y * res + x;
      if (!island[i] || edgeDist[i] < edgeMin) continue;
      const sl = slope[i];
      if (sl > 0.5) continue;                       // ميل حاد → غير مناسب
      // تباين الارتفاع حول الخلية = وجود مبانٍ/صخور مثيرة
      let mn = 1e9, mx = -1e9;
      for (let k = -R; k <= R; k += 2)
        for (let j = -R; j <= R; j += 2) {
          const h = height[i + k * res + j];
          if (h < mn) mn = h; if (h > mx) mx = h;
        }
      const variety = clamp((mx - mn) / 9, 0, 1);
      const flat = 1 - clamp(sl / 0.5, 0, 1);
      const safe = clamp(edgeDist[i] / 42, 0, 1);
      // سطوع اللون: نتجنّب الأسطح شديدة الظلمة (داخل المباني)
      const lum = (color[i * 4] + color[i * 4 + 1] + color[i * 4 + 2]) / 765;
      const open = clamp((lum - 0.09) / 0.3, 0, 1);
      const inside = indoor && indoor[i] ? indoorBias : 0;   // الأفضلية للصناديق داخل المنازل
      score[i] = flat * 1.25 + variety * 1.5 + safe * 0.7 + open * 0.5 + inside;
    }
  }

  // ترتيب المرشّحين ثم اختيار جشِع مع قيد التباعد
  const cand = [];
  for (let i = 0; i < res * res; i++) if (score[i] > 1.15) cand.push(i);
  cand.sort((a, b) => score[b] - score[a]);

  const chosen = [];
  const g2 = gap * gap;
  const fits = (x, y, g) => {
    for (const c of chosen) {
      const dx = c.cx - x, dy = c.cy - y;
      if (dx * dx + dy * dy < g) return false;
    }
    return true;
  };
  // ثلثان داخل المباني وثلث في العراء — مزيج طبيعي كما في الألعاب
  const wantIn = indoor ? Math.round(count * 0.62) : 0;
  const inList = indoor ? cand.filter((i) => indoor[i]) : [];
  const outList = cand.filter((i) => !indoor || !indoor[i]);
  const take = (list, limit) => {
    for (const i of list) {
      if (chosen.length >= limit) break;
      const x = i % res, y = (i / res) | 0;
      if (fits(x, y, g2)) chosen.push({ cx: x, cy: y, i });
    }
  };
  take(inList, wantIn);
  take(outList, count);
  take(cand, count);

  // تمريرة ثانية بتباعد أقل لملء النقص
  if (chosen.length < count) {
    const g3 = (gap * 0.62) ** 2;
    for (const i of cand) {
      if (chosen.length >= count) break;
      const x = i % res, y = (i / res) | 0;
      let ok = true;
      for (const c of chosen) {
        const dx = c.cx - x, dy = c.cy - y;
        if (dx * dx + dy * dy < g3) { ok = false; break; }
      }
      if (ok) chosen.push({ cx: x, cy: y, i });
    }
  }

  const w = an.maxX - an.minX, h = an.maxZ - an.minZ;
  return chosen.map((c, n) => ({
    id: 'cr_' + n.toString(36) + Math.random().toString(36).slice(2, 5),
    x: an.minX + (c.cx / (res - 1)) * w,
    y: height[c.i],
    z: an.minZ + (c.cy / (res - 1)) * h,
    ry: Math.random() * Math.PI * 2,
    scale: 1,
  }));
}

// ------------------------------------------------------------
//  توليد مسار الطائرة تلقائياً — 3 نقاط، مختلف كل مباراة،
//  ويضمن أن نافذة القفز كلها فوق اليابسة (لا سقوط في البحر)
// ------------------------------------------------------------
export function autoFlightPath(an, { margin = 12, tries = 60 } = {}) {
  const { res, island, edgeDist } = an;
  const V = mapView(an);
  const cx = V.x0 + V.size / 2, cz = V.z0 + V.size / 2;
  const R = V.size * 0.5;

  const cellOf = (x, z) => {
    const u = Math.round(clamp(((x - an.minX) / (an.maxX - an.minX)) * (res - 1), 0, res - 1));
    const v = Math.round(clamp(((z - an.minZ) / (an.maxZ - an.minZ)) * (res - 1), 0, res - 1));
    return v * res + u;
  };
  const good = (x, z) => {
    const i = cellOf(x, z);
    return island[i] === 1 && edgeDist[i] >= margin;
  };

  let best = null, bestScore = -1;
  for (let t = 0; t < tries; t++) {
    // وتر عشوائي يعبر الجزيرة: زاوية عشوائية + إزاحة عن المركز
    const ang = Math.random() * Math.PI * 2;
    const off = (Math.random() * 2 - 1) * R * 0.42;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const nx = -dz, nz = dx;                       // العمودي
    const ox = cx + nx * off, oz = cz + nz * off;
    const L = R * 1.9;
    const a = { x: ox - dx * L, z: oz - dz * L };
    const b = { x: ox + dx * L, z: oz + dz * L };

    // امسح الخط وابحث عن أطول قطعة متصلة فوق يابسة صالحة
    const N = 220;
    let run = 0, runStart = -1, bestRun = 0, bs = -1, be = -1;
    for (let i = 0; i <= N; i++) {
      const f = i / N;
      const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
      if (good(x, z)) {
        if (run === 0) runStart = i;
        run++;
        if (run > bestRun) { bestRun = run; bs = runStart; be = i; }
      } else run = 0;
    }
    if (bestRun < N * 0.16) continue;              // لا يعبر الجزيرة بما يكفي

    // درجة: طول العبور + ابتعاد عن المسارات المتكرّرة
    const score = bestRun + Math.random() * 12;
    if (score > bestScore) {
      bestScore = score;
      const fs = bs / N, fe = be / N;
      const px = (f) => ({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f });
      // 3 نقاط: الدخول، منتصف العبور (مع انحراف بسيط)، الخروج
      const mid = px((fs + fe) / 2);
      const jx = (Math.random() * 2 - 1) * R * 0.10, jz = (Math.random() * 2 - 1) * R * 0.10;
      const midJ = good(mid.x + jx, mid.z + jz) ? { x: mid.x + jx, z: mid.z + jz } : mid;
      best = {
        points: [px(-0.12), midJ, px(1.12)],
        // نافذة القفز بالنسبة لطول المسار الكامل (من -0.12 إلى 1.12)
        dropFrom: (fs + 0.12) / 1.24,
        dropTo: (fe + 0.12) / 1.24,
      };
    }
  }

  if (!best) {
    // احتياط: خط عبر مركز الجزيرة
    const ang = Math.random() * Math.PI * 2;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    best = {
      points: [{ x: cx - dx * R * 1.6, z: cz - dz * R * 1.6 }, { x: cx, z: cz },
               { x: cx + dx * R * 1.6, z: cz + dz * R * 1.6 }],
      dropFrom: 0.32, dropTo: 0.68,
    };
  }
  // هامش أمان داخل النافذة
  const w = best.dropTo - best.dropFrom;
  best.dropFrom += w * 0.10;
  best.dropTo -= w * 0.10;
  return best;
}

/** نقاط ظهور اللاعبين/الروبوتات */
export function spawnPoints(an, n = 40) {
  const { res, island, slope, edgeDist } = an;
  const height = an.floor || an.height;
  const out = [];
  const w = an.maxX - an.minX, h = an.maxZ - an.minZ;
  let guard = 0;
  while (out.length < n && guard++ < n * 400) {
    const i = (Math.random() * res * res) | 0;
    if (!island[i] || edgeDist[i] < 14 || slope[i] > 0.4) continue;
    out.push({
      x: an.minX + ((i % res) / (res - 1)) * w,
      y: height[i],
      z: an.minZ + (((i / res) | 0) / (res - 1)) * h,
    });
  }
  return out;
}

// ------------------------------------------------------------
//  السماء والإضاءة
// ------------------------------------------------------------
export function buildSky(scene, { dayTime = 0.42, fog = 0.55, radius = 3000 } = {}) {
  const top = new THREE.Color().setHSL(0.60, 0.62, 0.14 + 0.4 * dayTime);
  const bot = new THREE.Color().setHSL(0.09 + 0.03 * dayTime, 0.68, 0.42 + 0.3 * dayTime);
  const geo = new THREE.SphereGeometry(radius, 32, 20);
  const mat = new THREE.ShaderMaterial({
    uniforms: { top: { value: top }, bot: { value: bot }, off: { value: 0.06 }, exp: { value: 0.7 } },
    vertexShader: `varying vec3 vW; void main(){ vW = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `
      uniform vec3 top,bot; uniform float off,exp; varying vec3 vW;
      void main(){
        float hgt = normalize(vW+vec3(0.0,off,0.0)).y;
        float t = pow(max(hgt,0.0), exp);
        vec3 c = mix(bot, top, t);
        c += vec3(0.03,0.02,0.05)*(1.0-t);
        gl_FragColor = vec4(c,1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  scene.add(sky);

  const fogCol = bot.clone().lerp(top, 0.45);
  scene.fog = new THREE.FogExp2(fogCol.getHex(), 0.00022 + fog * 0.0009);

  const sun = new THREE.DirectionalLight(0xfff2d8, 2.5);
  const ang = Math.PI * (0.18 + dayTime * 0.5);
  sun.position.set(Math.cos(ang) * 800, Math.sin(ang) * 900 + 120, 420);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 900;
  const S = 130;
  sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
  sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0009;
  sun.shadow.normalBias = 0.55;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(top.getHex(), 0x4a3a68, 1.15);
  scene.add(hemi);
  const amb = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(amb);

  return { sky, sun, hemi, amb, fogCol };
}

/** بحر لا نهائي بسيط حول الجزيرة */
export function buildOcean(y, size = 6000) {
  const geo = new THREE.PlaneGeometry(size, size, 64, 64);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      t: { value: 0 },
      cA: { value: new THREE.Color(0x06294f) },     // العميق
      cB: { value: new THREE.Color(0x1c93c9) },     // الضحل
      cS: { value: new THREE.Color(0x9fe4ff) },     // انعكاس السماء
      uCam: { value: new THREE.Vector3() },
    },
    vertexShader: `
      varying vec2 vUv; varying vec3 vW;
      void main(){
        vUv = uv*40.0;
        vec4 wp = modelMatrix*vec4(position,1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix*viewMatrix*wp;
      }`,
    fragmentShader: `
      uniform float t; uniform vec3 cA,cB,cS; uniform vec3 uCam;
      varying vec2 vUv; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      float fbm(vec2 p){
        float v=0.0, a=0.5;
        for(int i=0;i<4;i++){ v+=a*n(p); p*=2.02; a*=0.5; }
        return v;
      }
      void main(){
        vec2 q = vUv;
        float w1 = fbm(q*1.3 + vec2(t*0.045, t*0.028));
        float w2 = fbm(q*3.4 - vec2(t*0.075, t*0.05));
        float w  = w1*0.65 + w2*0.35;

        // ميل السطح التقريبي لإضاءة لامعة
        float e = 0.55;
        float dx = fbm((q+vec2(e,0.0))*1.3 + vec2(t*0.045,t*0.028)) - w1;
        float dz = fbm((q+vec2(0.0,e))*1.3 + vec2(t*0.045,t*0.028)) - w1;
        vec3 nrm = normalize(vec3(-dx*3.0, 1.0, -dz*3.0));

        vec3 V = normalize(uCam - vW);
        float fres = pow(1.0 - max(dot(nrm, V), 0.0), 3.0);

        // عمق: قريب من الكاميرا أفتح، بعيد أعمق
        float dist = length(vW.xz - uCam.xz);
        float deep = smoothstep(60.0, 900.0, dist);
        vec3 c = mix(cB, cA, deep);
        c = mix(c, cS, fres*0.55);

        // لمعان الشمس
        vec3 L = normalize(vec3(0.55, 0.72, 0.42));
        float spec = pow(max(dot(reflect(-L, nrm), V), 0.0), 90.0);
        c += vec3(1.0,0.97,0.9) * spec * 0.9;

        // زبد على قمم الموج
        float foam = smoothstep(0.72, 0.88, w);
        c = mix(c, vec3(0.92,0.97,1.0), foam*0.35);

        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.renderOrder = -1;
  m.material.depthWrite = true;
  m.material.polygonOffset = true;      // يمنع تداخل البحر مع رمل الشاطئ
  m.material.polygonOffsetFactor = 2;
  m.material.polygonOffsetUnits = 4;
  return m;
}
