// ============================================================
//  المرحلة 2 — محرّر الخريطة: المسارات، الصناديق، الحدود
// ============================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { el, clamp, toast, pickFile, slider, confirmBox, promptBox, uid, onDrag,
         toggleRow } from '../core/util.js';
import { store, P, STAT_DEFS } from '../core/store.js';
import { importFile, assetURL, getAsset } from '../core/assets.js';
import {
  loadGLB, prepMap, analyzeMapCached, makeQuery, minimapCanvas, autoBoundary, autoCrates,
  buildSky, buildOcean,
} from '../game/world.js';

let CACHE = { key: null, an: null, canvas: null };

export function mountStage2(view, side, ctx) {
  const M = () => P().map;
  let an = null, Q = null, mapCanvas = null;
  let tool = 'pan';
  let activePath = null;
  let sel = null;          // {type:'crate'|'node', ...}
  let dead = false;

  // ---------------- تخطيط ----------------
  const glHost = el('div', { style: { position: 'absolute', inset: '0' } });
  const canvas2d = el('canvas', { class: 'map2d' });
  const info = el('div', { class: 'mapinfo' });
  const bar = el('div', { class: 'toolbar-float' });
  view.append(glHost, canvas2d, bar, info);

  // طبقة ترتيب عناصر واجهة اللعب فوق الخريطة
  const hudLayer = el('div', { style: { position: 'absolute', inset: '0', display: 'none', zIndex: '8' } });
  view.append(hudLayer);
  let selStat = null;
  const hudNodes = new Map();

  function statPreview(c) {
    if (c.id === 'kills') return '💀 3';
    if (c.id === 'rank') return '🏆 #7';
    if (c.id === 'alive') return '👥 12';
    if (c.id === 'hp') return '❤️ 100 / 100';
    if (c.id === 'zone') return '⏱️ 0:45';
    return c.id;
  }

  function buildHudLayer() {
    for (const [, n] of hudNodes) n.remove();
    hudNodes.clear();
    for (const c of P().controls.stats) {
      const isMap = c.id === 'minimap';
      const body = el('div', { class: 'body' }, isMap
        ? el('div', { style: { width: '100%', height: '100%', display: 'grid', placeItems: 'center',
            fontSize: '22px', background: 'rgba(6,17,31,.75)' } }, '🗺️')
        : el('span', { class: 'txt' }, statPreview(c)));
      const hnd = el('div', { class: 'hnd' });
      const tag = el('div', { class: 'tag' }, STAT_DEFS[c.id]?.label || c.id);
      const n = el('div', { class: 'hw sq' }, body, hnd, tag);
      n.addEventListener('pointerdown', () => { selStat = c; layoutHud(); buildSide(); });
      onDrag(n, {
        start: (_, st) => { st.x = c.x; st.y = c.y; selStat = c; buildSide(); },
        move: (d, st) => {
          const r = hudLayer.getBoundingClientRect();
          c.x = clamp(st.x + d.dx / r.width, 0.02, 0.98);
          c.y = clamp(st.y + d.dy / r.height, 0.02, 0.98);
          store.live(() => {}); layoutHud();
        },
        end: () => store.snap('تحريك عنصر الواجهة'),
      });
      onDrag(hnd, {
        start: (_, st) => { st.v = c.size; selStat = c; },
        move: (d, st) => {
          const k = (-d.dx + d.dy);
          c.size = isMap ? clamp(st.v + k * 0.6, 80, 460) : clamp(st.v + k * 0.006, 0.5, 2.6);
          store.live(() => {}); layoutHud(); buildSide();
        },
        end: () => store.snap('حجم عنصر الواجهة'),
      });
      hudNodes.set(c, n);
      hudLayer.append(n);
    }
    layoutHud();
  }

  function layoutHud() {
    const r = hudLayer.getBoundingClientRect();
    if (!r.width) return;
    const k = clamp(r.height / 720, 0.7, 1.6);
    for (const [c, n] of hudNodes) {
      const isMap = c.id === 'minimap';
      const w = isMap ? c.size * k : 130 * (c.size || 1);
      const h = isMap ? c.size * k : 36 * (c.size || 1);
      n.style.width = w + 'px';
      n.style.height = h + 'px';
      n.style.left = c.x * r.width - w / 2 + 'px';
      n.style.top = c.y * r.height - h / 2 + 'px';
      n.style.opacity = c.visible ? 1 : 0.3;
      n.classList.toggle('sel', selStat === c);
    }
  }

  const loading = el('div', { style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center',
    background: 'rgba(6,3,20,.92)', zIndex: 20, textAlign: 'center' } },
    el('div', { style: { width: 'min(380px,80%)' } },
      el('div', { class: 'ld-title', style: { fontSize: '17px', fontWeight: '900', marginBottom: '10px' } }, 'تحليل الخريطة…'),
      el('div', { class: 'bar' }, el('i')),
      el('div', { class: 'hint', style: { marginTop: '9px' } }, 'يُنفَّذ مرة واحدة ثم يُحفظ')));
  view.append(loading);
  const setLoad = (t, p) => {
    const bar = loading.querySelector('.bar>i');
    const ttl = loading.querySelector('.ld-title');
    if (bar) bar.style.width = (p * 100) + '%';
    if (ttl) ttl.textContent = t;
  };

  // ---------------- مشهد ثلاثي الأبعاد ----------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  glHost.append(renderer.domElement);
  Object.assign(renderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(52, 1, 1, 9000);
  const controls = new OrbitControls(cam, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;
  let mapRoot = null, cratesGroup = null, pathGroup = null, wallMesh = null;

  // ---------------- 2D ----------------
  const V = { ox: 0, oy: 0, s: 1, user: false };
  const g2 = canvas2d.getContext('2d');
  const VW = () => an.view || { x0: an.minX, z0: an.minZ, size: an.maxX - an.minX };
  const w2s = (x, z) => [(x - VW().x0) * V.s + V.ox, (z - VW().z0) * V.s + V.oy];
  const s2w = (px, py) => [(px - V.ox) / V.s + VW().x0, (py - V.oy) / V.s + VW().z0];

  let mode2d = true;

  // =========================================================
  async function boot() {
    const id = M().assetId;
    if (!id || !getAsset(id)) {
      loading.innerHTML = '';
      loading.append(el('div', { style: { textAlign: 'center', padding: '20px' } },
        el('div', { style: { fontSize: '17px', fontWeight: '900', marginBottom: '12px' } }, '📁 لم يتم اختيار خريطة'),
        el('button', { class: 'btn y', onclick: () => pickMap() }, 'اختر ملف GLB للخريطة')));
      return;
    }
    setLoad('تحميل نموذج الخريطة…', 0.05);
    const gl = await loadGLB(assetURL(id), (p) => setLoad('تحميل نموذج الخريطة…', 0.05 + p * 0.45));
    if (dead) return;
    mapRoot = gl.scene;
    prepMap(mapRoot);
    scene.add(mapRoot);

    const key = id + ':1024';
    if (CACHE.key === key && CACHE.an) { an = CACHE.an; mapCanvas = CACHE.canvas; setLoad('من الذاكرة', 1); }
    else {
      an = await analyzeMapCached(renderer, mapRoot, key, { res: 1024, onStep: (t, p) => setLoad(t, 0.5 + p * 0.45) });
      if (dead) return;
      scene.add(mapRoot);
      mapCanvas = minimapCanvas(an);
      CACHE = { key, an, canvas: mapCanvas };
    }
    Q = makeQuery(an);

    buildSky(scene, { dayTime: P().match.dayTime, fog: 0.15 });
    scene.add(buildOcean(an.waterY + 0.15, an.span * 6));

    // حدود افتراضية
    if (!M().boundary.poly?.length) {
      store.live((d) => {
        d.map.boundary.poly = autoBoundary(an, { inset: 6 });
        d.map.boundary.mode = 'auto';
      });
    }
    // صناديق افتراضية
    if (!M().crates?.length) {
      store.live((d) => { d.map.crates = autoCrates(an, { count: 46 }); });
      toast('تم توزيع 46 صندوقاً تلقائياً على الجزيرة', 'ok');
    }

    cam.position.set(an.minX + (an.maxX - an.minX) * 0.5, an.yMax + an.span * 0.55, an.maxZ + an.span * 0.15);
    controls.target.set((an.minX + an.maxX) / 2, an.yMin, (an.minZ + an.maxZ) / 2);
    controls.update();

    build3D();
    fitView();
    loading.remove();
    buildBar();
    buildSide();
    draw();
    tick();
  }

  async function pickMap() {
    const f = await pickFile('.glb,.gltf,model/gltf-binary');
    if (!f) return;
    const a = await importFile(f, 'glb');
    store.edit('تغيير الخريطة', (d) => {
      d.map.assetId = a.id;
      d.map.crates = []; d.map.boundary.poly = []; d.map.paths = [];
    });
    ctx.refresh();
  }

  // ---------------- بناء عناصر 3D ----------------
  function build3D() {
    if (cratesGroup) scene.remove(cratesGroup);
    cratesGroup = new THREE.Group();
    const geo = new THREE.BoxGeometry(2.6, 1.8, 1.8);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8ad04a, emissive: 0x1a3a08, roughness: .6 });
    for (const c of M().crates) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(c.x, Q.heightAt(c.x, c.z) + 0.9, c.z);
      m.rotation.y = c.ry || 0;
      m.castShadow = true;
      m.userData.crate = c;
      cratesGroup.add(m);
    }
    scene.add(cratesGroup);

    if (pathGroup) scene.remove(pathGroup);
    pathGroup = new THREE.Group();
    for (const p of M().paths) {
      if (p.points.length < 2) continue;
      const pts = p.points.map((q) => new THREE.Vector3(q.x, an.yMax + M().flight.altitude, q.z));
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      pathGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: p.color || '#ffffff' })));
      const s = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 10),
        new THREE.MeshBasicMaterial({ color: p.color || '#ffffff' }));
      s.position.copy(pts[0]); pathGroup.add(s);
    }
    scene.add(pathGroup);

    if (wallMesh) scene.remove(wallMesh);
    const poly = M().boundary.poly;
    if (poly?.length > 2) {
      const pos = [];
      const h = 90, y0 = an.waterY - 3;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        pos.push(a.x, y0, a.z, b.x, y0, b.z, b.x, y0 + h, b.z);
        pos.push(a.x, y0, a.z, b.x, y0 + h, b.z, a.x, y0 + h, a.z);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      wallMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: 0x4ab8ff, transparent: true, opacity: .16, side: THREE.DoubleSide, depthWrite: false }));
      wallMesh.frustumCulled = false;
      scene.add(wallMesh);
    }
  }

  // ---------------- شريط الأدوات ----------------
  function buildBar() {
    bar.innerHTML = '';
    const t = (id, emo, label) => el('button', {
      class: 'btn sm ' + (tool === id ? 'c' : 'ghost'),
      onclick: () => {
        tool = id;
        if (id !== 'path') activePath = null;
        hudLayer.style.display = id === 'hud' ? '' : 'none';
        if (id === 'hud') { buildHudLayer(); }
        buildBar(); buildSide(); draw();
      },
      title: label,
    }, emo + ' ' + label);
    if (mode2d) {
      bar.append(
        t('pan', '✋', 'تحريك'),
        t('path', '✈️', 'رسم المسار'),
        t('crate', '📦', 'الصناديق'),
        t('bound', '🚧', 'الحدود'),
        t('erase', '🧽', 'مسح'),
        t('hud', '🧭', 'ترتيب الواجهة'));
    }
    if (mode2d) bar.append(el('button', { class: 'btn sm ghost', title: 'ملاءمة العرض',
      onclick: () => { V.user = false; fitView(); draw(); } }, '⤢ ملاءمة'));
    bar.append(el('button', { class: 'btn sm ' + (mode2d ? 'ghost' : 'y'), onclick: () => {
      mode2d = !mode2d;
      canvas2d.style.display = mode2d ? '' : 'none';
      buildBar(); buildSide(); resize();
    } }, mode2d ? '🧊 عرض ثلاثي الأبعاد' : '🗺️ الخريطة ثنائية الأبعاد'));
  }

  // ---------------- اللوحة الجانبية ----------------
  const head = el('div', { class: 'side-head' }, '🗺️ الخطوة 2: الخريطة والعدّادات');
  const sbody = el('div', { class: 'side-body' });
  const foot = el('div', { class: 'side-foot' },
    el('button', { class: 'btn ghost sm', onclick: () => ctx.goto(1) }, '→ السابق'),
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn y', onclick: () => ctx.goto(3) }, 'التالي: القائمة ←'));
  side.append(head, sbody, foot);

  function buildSide() {
    if (!an) { sbody.innerHTML = '<div class="hint">في انتظار تحليل الخريطة…</div>'; return; }
    sbody.innerHTML = '';

    // ملفات
    const sf = el('div', { class: 'sec' }, el('h4', {}, 'ملفات النماذج'));
    const fileRow = (label, field, accept) => {
      const a = getAsset(M()[field]);
      return el('div', { class: 'li' },
        el('div', { class: 'ic' }, '🧊'),
        el('div', { class: 'nm' }, label + ': ' + (a ? a.name : 'غير محدّد')),
        el('button', { class: 'btn sm ghost', onclick: async () => {
          const f = await pickFile(accept);
          if (!f) return;
          const im = await importFile(f, 'glb');
          store.edit('تغيير ' + label, (d) => {
            d.map[field] = im.id;
            if (field === 'assetId') { d.map.crates = []; d.map.boundary.poly = []; d.map.paths = []; }
          });
          ctx.refresh();
        } }, '📂'));
    };
    sf.append(el('div', { class: 'list' },
      fileRow('الخريطة', 'assetId', '.glb,.gltf'),
      fileRow('الطائرة', 'shipAssetId', '.glb,.gltf'),
      fileRow('الصندوق', 'crateAssetId', '.glb,.gltf')));
    sbody.append(sf);

    // ---- المسارات ----
    const sp = el('div', { class: 'sec' }, el('h4', {}, '✈️ مسارات الطيران'));
    sp.append(el('div', { class: 'hint', style: { marginBottom: '8px' } },
      'اختر أداة «رسم المسار» ثم اضغط على الخريطة نقطة بعد نقطة. اضغط «إنهاء» لحفظ الخط. عند بدء المباراة يُختار خط عشوائي، وقد يبدأ من بدايته أو نهايته.'));
    const pl = el('div', { class: 'list' });
    M().paths.forEach((p, i) => {
      pl.append(el('div', { class: 'li' + (activePath === p ? ' on' : '') },
        el('div', { class: 'ic', style: { background: p.color } }, ''),
        el('div', { class: 'nm', onclick: () => { activePath = p; tool = 'path'; buildBar(); buildSide(); draw(); } },
          p.name + ` (${p.points.length} نقطة)`),
        el('span', { class: 'x', onclick: () => {
          store.edit('حذف مسار', (d) => { d.map.paths.splice(i, 1); });
          activePath = null; build3D(); buildSide(); draw();
        } }, '✕')));
    });
    if (!M().paths.length) pl.append(el('div', { class: 'hint' }, 'لا توجد مسارات — سيُستخدم خط عشوائي.'));
    sp.append(pl);
    sp.append(el('div', { class: 'row', style: { marginTop: '8px' } },
      el('button', { class: 'btn g sm', onclick: () => {
        const p = { id: uid('pt'), name: 'مسار ' + (M().paths.length + 1), points: [],
          color: ['#ffc21a', '#25d3ff', '#39e07b', '#ff4d5e', '#c56bff'][M().paths.length % 5] };
        store.edit('مسار جديد', (d) => { d.map.paths.push(p); });
        activePath = p; tool = 'path'; mode2d = true; canvas2d.style.display = '';
        buildBar(); buildSide(); draw();
      } }, '＋ مسار جديد'),
      activePath ? el('button', { class: 'btn y sm', onclick: () => {
        if (activePath.points.length < 2) {
          store.edit('حذف مسار فارغ', (d) => { d.map.paths = d.map.paths.filter((x) => x !== activePath); });
        }
        activePath = null; build3D(); buildSide(); draw();
      } }, '✓ إنهاء') : null,
      activePath && activePath.points.length ? el('button', { class: 'btn ghost sm', onclick: () => {
        store.edit('تراجع نقطة', () => { activePath.points.pop(); });
        buildSide(); draw();
      } }, '↶ نقطة') : null));
    sbody.append(sp);

    // ---- الطيران ----
    const sfl = el('div', { class: 'sec' }, el('h4', {}, '🛫 مسار الطائرة'));
    sfl.append(el('div', { class: 'row', style: { marginBottom: '8px' } },
      el('button', { class: 'btn sm ' + (M().flight.mode === 'auto' ? 'c' : 'ghost'), onclick: () => {
        store.edit('مسار تلقائي', (d) => { d.map.flight.mode = 'auto'; }); buildSide();
      } }, '✨ تلقائي'),
      el('button', { class: 'btn sm ' + (M().flight.mode === 'manual' ? 'c' : 'ghost'), onclick: () => {
        store.edit('مسار يدوي', (d) => { d.map.flight.mode = 'manual'; }); buildSide();
      } }, '✏️ يدوي')));
    sfl.append(el('div', { class: 'hint', style: { marginBottom: '8px' } },
      M().flight.mode === 'auto'
        ? 'المحرّك يولّد مساراً جديداً من 3 نقاط في كل مباراة — في مكان مختلف كل مرة، '
          + 'ولا يفتح نافذة القفز إلا فوق اليابسة، فيستحيل السقوط في البحر.'
        : 'يُختار أحد مساراتك عشوائياً وقد يبدأ من أي طرف. نافذة القفز تُحسب تلقائياً '
          + 'على الجزء المارّ فوق اليابسة فقط.'));
    sfl.append(slider({ label: 'ارتفاع الطيران', min: 60, max: 420, value: M().flight.altitude, unit: 'م',
      onInput: (v) => { store.live((d) => { d.map.flight.altitude = v; }); build3D(); } }));
    sfl.append(slider({ label: 'سرعة الطائرة', min: 40, max: 260, value: M().flight.speed, unit: '',
      onInput: (v) => { store.live((d) => { d.map.flight.speed = v; }); } }));
    sfl.append(slider({ label: 'ابتعاد نافظة القفز عن الشاطئ', min: 4, max: 40,
      value: M().flight.landMargin, unit: 'خ',
      onInput: (v) => { store.live((d) => { d.map.flight.landMargin = v; }); } }));
    sbody.append(sfl);

    // ---- الزون ----
    const Z = M().zone;
    const sz = el('div', { class: 'sec' }, el('h4', {}, '🌀 الزون المتقلّص'));
    sz.append(toggleRow('تفعيل الزون', Z.enabled, (v) => {
      store.edit('الزون', (d) => { d.map.zone.enabled = v; }); buildSide();
    }));
    if (Z.enabled) {
      sz.append(el('div', { class: 'hint', style: { marginBottom: '8px' } },
        'دائرة تنكمش على مراحل وتتحرّك إلى مكان جديد كل مرة، ومن يبقى خارجها يتأذّى. '
        + `الوقت الكلّي التقريبي: ${Math.round((Z.firstDelay + Z.phases * (Z.holdTime + Z.shrinkTime)) / 60)} دقيقة.`));
      sz.append(slider({ label: 'عدد المراحل', min: 2, max: 12, value: Z.phases,
        onInput: (v) => { store.live((d) => { d.map.zone.phases = v; }); } }));
      sz.append(slider({ label: 'انتظار قبل كل تقلّص', min: 10, max: 120, value: Z.holdTime, unit: 'ث',
        onInput: (v) => { store.live((d) => { d.map.zone.holdTime = v; }); } }));
      sz.append(slider({ label: 'مدّة التقلّص', min: 8, max: 90, value: Z.shrinkTime, unit: 'ث',
        onInput: (v) => { store.live((d) => { d.map.zone.shrinkTime = v; }); } }));
      sz.append(slider({ label: 'تأخير أول دائرة', min: 0, max: 120, value: Z.firstDelay, unit: 'ث',
        onInput: (v) => { store.live((d) => { d.map.zone.firstDelay = v; }); } }));
      sz.append(slider({ label: 'الضرر الابتدائي/ثانية', min: 1, max: 20, value: Z.damageStart,
        onInput: (v) => { store.live((d) => { d.map.zone.damageStart = v; }); } }));
      sz.append(slider({ label: 'زيادة الضرر كل مرحلة', min: 0, max: 20, value: Z.damageStep,
        onInput: (v) => { store.live((d) => { d.map.zone.damageStep = v; }); } }));
    }
    sbody.append(sz);

    // ---- عناصر واجهة اللعب ----
    const sh = el('div', { class: 'sec' }, el('h4', {}, '🧭 عدّادات وواجهة اللعب'));
    sh.append(el('div', { class: 'hint', style: { marginBottom: '8px' } },
      'اضغط أداة «ترتيب الواجهة» ثم اسحب الخريطة المصغّرة وعدّاد القتلى وعدد الباقين '
      + 'والترتيب ومؤقّت الزون إلى المكان المناسب.'));
    const shl = el('div', { class: 'list' });
    for (const c of P().controls.stats) {
      shl.append(el('div', { class: 'li' + (selStat === c ? ' on' : ''), onclick: () => {
        selStat = c;
        if (tool !== 'hud') { tool = 'hud'; hudLayer.style.display = ''; buildHudLayer(); buildBar(); }
        layoutHud(); buildSide();
      } },
        el('div', { class: 'ic' }, STAT_DEFS[c.id]?.emo || '•'),
        el('div', { class: 'nm' }, STAT_DEFS[c.id]?.label || c.id),
        el('span', { class: 'x', onclick: (e) => {
          e.stopPropagation();
          store.edit('إظهار/إخفاء', () => { c.visible = !c.visible; });
          layoutHud(); buildSide();
        } }, c.visible ? '👁️' : '🚫')));
    }
    sh.append(shl);
    if (selStat) {
      const isMap = selStat.id === 'minimap';
      sh.append(el('div', { class: 'sep' }));
      sh.append(slider({ label: 'حجم ' + (STAT_DEFS[selStat.id]?.label || ''),
        min: isMap ? 80 : 0.5, max: isMap ? 460 : 2.6, step: isMap ? 1 : 0.05,
        value: selStat.size,
        onInput: (v) => { store.live(() => { selStat.size = v; }); layoutHud(); } }));
      if (isMap) {
        sh.append(slider({ label: 'تقريب الخريطة', min: 0.6, max: 6, step: 0.1, value: selStat.zoom || 1,
          onInput: (v) => { store.live(() => { selStat.zoom = v; }); } }));
      }
      sh.append(el('div', { class: 'row' },
        el('button', { class: 'btn c sm', onclick: async () => {
          const f = await pickFile('image/*');
          if (!f) return;
          const a = await importFile(f, 'image');
          store.edit('أيقونة عنصر الواجهة', () => { selStat.icon = a.id; });
          buildHudLayer(); buildSide();
        } }, '🖼️ أيقونة'),
        selStat.icon ? el('button', { class: 'btn r sm', onclick: () => {
          store.edit('حذف أيقونة', () => { selStat.icon = null; });
          buildHudLayer(); buildSide();
        } }, '✕') : null));
    }
    sbody.append(sh);

    // ---- الصناديق ----
    const sc = el('div', { class: 'sec' }, el('h4', {}, '📦 الصناديق (' + M().crates.length + ')'));
    sc.append(el('div', { class: 'hint', style: { marginBottom: '8px' } },
      'التوزيع التلقائي يضع الصناديق على أرض مستوية قرب المباني والمعالم، بعيداً عن البحر وبتباعد منتظم. يمكنك تحريك أي صندوق بالسحب أو إضافة/حذف يدوياً.'));
    sc.append(el('div', { class: 'grid2' },
      el('button', { class: 'btn c sm', onclick: () => {
        store.edit('توزيع تلقائي', (d) => { d.map.crates = autoCrates(an, { count: d.map.crates.length || 46 }); });
        build3D(); buildSide(); draw(); toast('تم إعادة التوزيع', 'ok');
      } }, '✨ توزيع تلقائي'),
      el('button', { class: 'btn ghost sm', onclick: async () => {
        const n = await promptBox('عدد الصناديق', 'كم صندوقاً تريد؟', String(M().crates.length || 46));
        if (!n) return;
        store.edit('عدد الصناديق', (d) => { d.map.crates = autoCrates(an, { count: clamp(+n || 46, 1, 400) }); });
        build3D(); buildSide(); draw();
      } }, '🔢 تحديد العدد'),
      el('button', { class: 'btn ghost sm', onclick: () => {
        tool = 'crate'; mode2d = true; canvas2d.style.display = ''; buildBar(); buildSide();
        toast('اضغط على الخريطة لإضافة صندوق');
      } }, '＋ إضافة يدوي'),
      el('button', { class: 'btn r sm', onclick: async () => {
        if (!(await confirmBox('حذف الصناديق', 'حذف كل الصناديق؟', 'حذف'))) return;
        store.edit('حذف الصناديق', (d) => { d.map.crates = []; });
        build3D(); buildSide(); draw();
      } }, '🗑️ حذف الكل')));
    sbody.append(sc);

    // ---- الحدود ----
    const sb = el('div', { class: 'sec' }, el('h4', {}, '🚧 حدود المعركة'));
    sb.append(el('div', { class: 'hint', style: { marginBottom: '8px' } },
      'الحدود تمنع الوصول إلى البحر. الوضع التلقائي يستخرج شكل الجزيرة من النموذج، ويمكنك رسمها يدوياً نقطة بنقطة.'));
    sb.append(el('div', { class: 'grid2' },
      el('button', { class: 'btn c sm', onclick: () => {
        store.edit('حدود تلقائية', (d) => {
          d.map.boundary.poly = autoBoundary(an, { inset: 6 });
          d.map.boundary.mode = 'auto';
        });
        build3D(); buildSide(); draw(); toast('تم توليد الحدود', 'ok');
      } }, '✨ تلقائي'),
      el('button', { class: 'btn ghost sm', onclick: () => {
        tool = 'bound'; mode2d = true; canvas2d.style.display = '';
        store.edit('رسم حدود يدوي', (d) => { d.map.boundary.mode = 'manual'; d.map.boundary.poly = []; });
        buildBar(); buildSide(); draw();
        toast('اضغط على الخريطة لرسم الحدود نقطة بنقطة');
      } }, '✏️ رسم يدوي')));
    sb.append(slider({ label: 'تقليص الحدود عن الشاطئ', min: 0, max: 30, value: 6,
      onInput: (v) => {
        store.live((d) => { d.map.boundary.poly = autoBoundary(an, { inset: v }); d.map.boundary.mode = 'auto'; });
        build3D(); draw();
      } }));
    sbody.append(sb);

    // ---- الخصوم ----
    const sm = el('div', { class: 'sec' }, el('h4', {}, '👥 المباراة'));
    sm.append(slider({ label: 'عدد الخصوم', min: 1, max: 60, value: P().match.bots,
      onInput: (v) => store.live((d) => { d.match.bots = v; }) }));
    sm.append(slider({ label: 'مهارة الخصوم', min: 0.1, max: 1, step: 0.05, value: P().match.botSkill,
      onInput: (v) => store.live((d) => { d.match.botSkill = v; }) }));
    sm.append(slider({ label: 'وقت النهار', min: 0, max: 1, step: 0.02, value: P().match.dayTime,
      onInput: (v) => store.live((d) => { d.match.dayTime = v; }) }));
    sbody.append(sm);

    // معلومات
    sbody.append(el('div', { class: 'hint' },
      `مساحة الخريطة ≈ ${Math.round(an.span)}×${Math.round(an.span)} متر • مستوى البحر ${an.waterY.toFixed(1)} • خلايا اليابسة ${an.islandCells.toLocaleString('ar-EG')}`));
  }

  // =========================================================
  //  رسم الخريطة ثنائية الأبعاد
  // =========================================================
  function fitView() {
    const w = canvas2d.clientWidth, h = canvas2d.clientHeight;
    const span = VW().size;
    V.s = Math.min(w, h) / span * 0.94;
    V.ox = (w - span * V.s) / 2;
    V.oy = (h - span * V.s) / 2;
  }

  function draw() {
    if (!an || !mapCanvas) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = canvas2d.clientWidth, h = canvas2d.clientHeight;
    if (canvas2d.width !== w * dpr) { canvas2d.width = w * dpr; canvas2d.height = h * dpr; }
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    g2.clearRect(0, 0, w, h);
    g2.fillStyle = '#05030f'; g2.fillRect(0, 0, w, h);

    const sw = VW().size * V.s;
    g2.imageSmoothingEnabled = true;
    g2.drawImage(mapCanvas, V.ox, V.oy, sw, sw);

    // الحدود
    const poly = M().boundary.poly;
    if (poly?.length > 1) {
      g2.strokeStyle = tool === 'bound' ? '#ffc21a' : 'rgba(255,70,90,.95)';
      g2.lineWidth = 2.5;
      g2.beginPath();
      poly.forEach((p, i) => { const [a, b] = w2s(p.x, p.z); i ? g2.lineTo(a, b) : g2.moveTo(a, b); });
      if (M().boundary.mode !== 'manual' || tool !== 'bound') g2.closePath();
      g2.stroke();
      g2.fillStyle = 'rgba(255,70,90,.07)'; g2.fill();
      if (tool === 'bound') {
        g2.fillStyle = '#ffc21a';
        for (const p of poly) { const [a, b] = w2s(p.x, p.z); g2.beginPath(); g2.arc(a, b, 4, 0, 7); g2.fill(); }
      }
    }

    // الصناديق
    for (const c of M().crates) {
      const [a, b] = w2s(c.x, c.z);
      if (a < -10 || b < -10 || a > w + 10 || b > h + 10) continue;
      const on = sel?.crate === c;
      const r = clamp(V.s * 1.6, 2.4, 8);
      g2.fillStyle = on ? '#ffffff' : '#ffc21a';
      g2.strokeStyle = '#3a2400'; g2.lineWidth = 1.2;
      g2.beginPath(); g2.rect(a - r, b - r, r * 2, r * 2); g2.fill(); g2.stroke();
    }

    // المسارات
    for (const p of M().paths) {
      if (!p.points.length) continue;
      const isA = p === activePath;
      g2.strokeStyle = p.color; g2.lineWidth = isA ? 3.4 : 2.4;
      g2.setLineDash(isA ? [] : [8, 6]);
      g2.beginPath();
      p.points.forEach((q, i) => { const [a, b] = w2s(q.x, q.z); i ? g2.lineTo(a, b) : g2.moveTo(a, b); });
      g2.stroke(); g2.setLineDash([]);
      p.points.forEach((q, i) => {
        const [a, b] = w2s(q.x, q.z);
        g2.fillStyle = i === 0 ? '#39e07b' : (i === p.points.length - 1 ? '#ff4d5e' : p.color);
        g2.beginPath(); g2.arc(a, b, isA ? 6 : 4, 0, 7); g2.fill();
        g2.strokeStyle = '#00000088'; g2.lineWidth = 1.5; g2.stroke();
      });
      // سهم الاتجاه
      if (p.points.length > 1) {
        const q0 = p.points[p.points.length - 2], q1 = p.points[p.points.length - 1];
        const [x0, y0] = w2s(q0.x, q0.z), [x1, y1] = w2s(q1.x, q1.z);
        const ang = Math.atan2(y1 - y0, x1 - x0);
        g2.save(); g2.translate(x1, y1); g2.rotate(ang);
        g2.fillStyle = p.color; g2.beginPath();
        g2.moveTo(10, 0); g2.lineTo(-4, 5); g2.lineTo(-4, -5); g2.closePath(); g2.fill();
        g2.restore();
      }
    }

    // خط المعاينة
    if (tool === 'path' && activePath && lastMouse && activePath.points.length) {
      const q = activePath.points[activePath.points.length - 1];
      const [a, b] = w2s(q.x, q.z);
      g2.strokeStyle = activePath.color + '99'; g2.lineWidth = 2; g2.setLineDash([5, 5]);
      g2.beginPath(); g2.moveTo(a, b); g2.lineTo(lastMouse[0], lastMouse[1]); g2.stroke(); g2.setLineDash([]);
    }

    info.innerHTML = {
      pan: '✋ اسحب للتحريك • عجلة الفأرة للتكبير',
      path: '✈️ اضغط لإضافة نقطة للمسار • 🟢 البداية 🔴 النهاية',
      crate: '📦 اضغط لإضافة صندوق • اسحب صندوقاً لتحريكه',
      bound: '🚧 اضغط لرسم نقاط الحدود بالترتيب',
      erase: '🧽 اضغط على صندوق أو نقطة لحذفها',
    }[tool] + `<br>عدد الصناديق: ${M().crates.length} • المسارات: ${M().paths.length}`;
  }

  // =========================================================
  //  تفاعل الخريطة ثنائية الأبعاد
  // =========================================================
  let lastMouse = null, dragging = null, moved = 0;

  canvas2d.addEventListener('wheel', (e) => {
    if (!an) return;
    e.preventDefault();
    const r = canvas2d.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const [wx, wz] = s2w(mx, my);
    V.user = true;
    V.s = clamp(V.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.05, 40);
    V.ox = mx - (wx - an.minX) * V.s;
    V.oy = my - (wz - an.minZ) * V.s;
    draw();
  }, { passive: false });

  canvas2d.addEventListener('pointerdown', (e) => {
    if (!an) return;
    canvas2d.setPointerCapture(e.pointerId);
    const r = canvas2d.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    moved = 0;
    const [wx, wz] = s2w(mx, my);

    if (tool === 'crate') {
      const hit = M().crates.find((c) => {
        const [a, b] = w2s(c.x, c.z);
        return Math.abs(a - mx) < 8 && Math.abs(b - my) < 8;
      });
      if (hit) { dragging = { kind: 'crate', c: hit }; sel = { crate: hit }; draw(); return; }
    }
    if (tool === 'bound' && M().boundary.mode === 'manual') {
      const poly = M().boundary.poly;
      const hit = poly.findIndex((p) => {
        const [a, b] = w2s(p.x, p.z);
        return Math.abs(a - mx) < 8 && Math.abs(b - my) < 8;
      });
      if (hit >= 0) { dragging = { kind: 'bnode', i: hit }; return; }
    }
    dragging = { kind: 'pan', ox: V.ox, oy: V.oy, mx, my };
  });

  canvas2d.addEventListener('pointermove', (e) => {
    if (!an) return;
    const r = canvas2d.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    lastMouse = [mx, my];
    if (!dragging) { if (tool === 'path' && activePath) draw(); return; }
    moved += Math.abs(e.movementX) + Math.abs(e.movementY);
    const [wx, wz] = s2w(mx, my);
    if (dragging.kind === 'pan') {
      V.user = true;
      V.ox = dragging.ox + (mx - dragging.mx);
      V.oy = dragging.oy + (my - dragging.my);
    } else if (dragging.kind === 'crate') {
      dragging.c.x = wx; dragging.c.z = wz;
      dragging.c.y = Q.heightAt(wx, wz);
      store.live(() => {});
    } else if (dragging.kind === 'bnode') {
      const p = M().boundary.poly[dragging.i];
      p.x = wx; p.z = wz;
      store.live(() => {});
    }
    draw();
  });

  canvas2d.addEventListener('pointerup', (e) => {
    if (!an) return;
    const wasDrag = dragging;
    dragging = null;
    const r = canvas2d.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const [wx, wz] = s2w(mx, my);

    if (wasDrag?.kind === 'crate') { store.snap('تحريك صندوق'); build3D(); return; }
    if (wasDrag?.kind === 'bnode') { store.snap('تحريك نقطة حدود'); build3D(); return; }
    if (moved > 6) return;   // كان سحباً وليس نقرة

    if (tool === 'path') {
      let p = activePath;
      if (!p) {
        p = { id: uid('pt'), name: 'مسار ' + (M().paths.length + 1), points: [],
          color: ['#ffc21a', '#25d3ff', '#39e07b', '#ff4d5e', '#c56bff'][M().paths.length % 5] };
        store.edit('مسار جديد', (d) => { d.map.paths.push(p); });
        activePath = p;
      }
      store.edit('نقطة مسار', () => { p.points.push({ x: wx, z: wz }); });
      build3D(); buildSide(); draw();
    } else if (tool === 'crate') {
      store.edit('إضافة صندوق', (d) => {
        d.map.crates.push({ id: uid('cr'), x: wx, y: Q.heightAt(wx, wz), z: wz,
          ry: Math.random() * 6.28, scale: 1 });
      });
      build3D(); buildSide(); draw();
    } else if (tool === 'bound') {
      store.edit('نقطة حدود', (d) => {
        d.map.boundary.mode = 'manual';
        d.map.boundary.poly.push({ x: wx, z: wz });
      });
      build3D(); buildSide(); draw();
    } else if (tool === 'erase') {
      const ci = M().crates.findIndex((c) => {
        const [a, b] = w2s(c.x, c.z);
        return Math.abs(a - mx) < 9 && Math.abs(b - my) < 9;
      });
      if (ci >= 0) {
        store.edit('حذف صندوق', (d) => { d.map.crates.splice(ci, 1); });
        build3D(); buildSide(); draw(); return;
      }
      for (const p of M().paths) {
        const pi = p.points.findIndex((q) => {
          const [a, b] = w2s(q.x, q.z);
          return Math.abs(a - mx) < 9 && Math.abs(b - my) < 9;
        });
        if (pi >= 0) {
          store.edit('حذف نقطة مسار', () => { p.points.splice(pi, 1); });
          build3D(); buildSide(); draw(); return;
        }
      }
      const bi = M().boundary.poly.findIndex((q) => {
        const [a, b] = w2s(q.x, q.z);
        return Math.abs(a - mx) < 9 && Math.abs(b - my) < 9;
      });
      if (bi >= 0) {
        store.edit('حذف نقطة حدود', (d) => { d.map.boundary.poly.splice(bi, 1); });
        build3D(); buildSide(); draw();
      }
    }
  });

  // =========================================================
  function resize() {
    const w = view.clientWidth, h = view.clientHeight;
    renderer.setSize(w, h, false);
    cam.aspect = w / h; cam.updateProjectionMatrix();
    if (an) { if (!V.user) fitView(); draw(); }
    layoutHud();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(view);

  function tick() {
    if (dead) return;
    requestAnimationFrame(tick);
    if (!mode2d) { controls.update(); renderer.render(scene, cam); }
  }

  canvas2d.style.display = '';
  boot().catch((e) => {
    console.error(e);
    loading.innerHTML = '<div style="padding:20px;color:#ff9aa2;text-align:center">خطأ: ' + e.message + '</div>';
  });

  return {
    unmount() {
      dead = true;
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
}
