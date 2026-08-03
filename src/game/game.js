// ============================================================
//  محرّك اللعب — الطيران، القفز، القتال، الصناديق، الحدود
// ============================================================
import * as THREE from 'three';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { el, clamp, lerp, smooth, rnd, rndi, pick, uid } from '../core/util.js';
import { assetURL, getAsset } from '../core/assets.js';
import * as A from '../core/audio.js';
import {
  loadGLB, prepMap, analyzeMapCached, makeQuery, minimapCanvas, autoBoundary,
  autoCrates, spawnPoints, buildSky, buildOcean, pointInPoly, closestOnPoly,
  autoFlightPath, mapView,
} from './world.js';
import { currentHero } from '../core/store.js';
import { Character, buildChute, nameTag } from './character.js';
import { HUD, Minimap } from './hud.js';

const BOT_NAMES = ['Ya™Zide', '水||Sw4th', 'Amine', 'Nova', 'Kito', 'Ryu', 'Zara', 'Milo', 'Ghost', 'Blaze',
  'Sora', 'Rex', 'Neo', 'Vex', 'Juno', 'Kai', 'Lynx', 'Ozz', 'Pixel', 'Quin', 'Raze', 'Sage', 'Tank',
  'Ultra', 'Volt', 'Wisp', 'Xeno', 'Yuki', 'Zed', 'Astra'];
const BOT_COLORS = ['#ff4d5e', '#25d3ff', '#39e07b', '#c56bff', '#ff8a1e', '#f5f5f5', '#8b5cf6', '#14b8a6'];

export class Game {
  constructor(root, project, { onExit, onRestart, preview = false } = {}) {
    this.root = root;
    this.P = project;
    this.onExit = onExit;
    this.onRestart = onRestart;
    this.preview = preview;
    this.clock = new THREE.Clock();
    this.phase = 'loading';
    this.disposed = false;
    this.tmp = { v1: new THREE.Vector3(), v2: new THREE.Vector3(), q: new THREE.Quaternion() };
  }

  // ---------------------------------------------------------
  async start(onProgress = () => {}) {
    const P = this.P;
    this.node = el('div', { id: 'gameroot' });
    this.canvas = el('canvas', { id: 'gl' });
    this.node.append(this.canvas);
    this.root.append(this.node);

    // ---- عارض ----
    const q = P.match.quality;
    const dpr = q === 'low' ? 1 : q === 'high' ? Math.min(devicePixelRatio, 2)
      : Math.min(devicePixelRatio, innerWidth < 900 ? 1.5 : 1.8);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: q !== 'low', powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = q !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.35, 4200);

    // ---- تحميل النماذج ----
    onProgress(0.03, 'تحميل الخريطة…');
    const mapURL = assetURL(P.map.assetId);
    if (!mapURL) throw new Error('لم يتم اختيار ملف الخريطة');
    const mapG = await loadGLB(mapURL, (p) => onProgress(0.03 + p * 0.42, 'تحميل الخريطة…'));
    this.mapRoot = mapG.scene;
    prepMap(this.mapRoot);
    this.scene.add(this.mapRoot);

    onProgress(0.48, 'تحميل الطائرة…');
    if (P.map.shipAssetId) {
      const g = await loadGLB(assetURL(P.map.shipAssetId));
      this.shipModel = g.scene;
    }
    onProgress(0.56, 'تحميل الصناديق…');
    if (P.map.crateAssetId) {
      const g = await loadGLB(assetURL(P.map.crateAssetId));
      this.crateModel = g.scene;
      this.crateClips = g.animations || [];
    }

    // ---- تحليل الخريطة ----
    onProgress(0.62, 'تحليل التضاريس…');
    const anRes = q === 'low' ? 512 : 1024;
    this.an = await analyzeMapCached(this.renderer, this.mapRoot, P.map.assetId + ':' + anRes, {
      res: anRes,
      onStep: (t, p) => onProgress(0.62 + p * 0.2, t),
    });
    this.scene.add(this.mapRoot);
    this.Q = makeQuery(this.an);
    this.mapCanvas = minimapCanvas(this.an);

    // ---- السماء والبحر ----
    onProgress(0.84, 'بناء العالم…');
    this.env = buildSky(this.scene, { dayTime: P.match.dayTime, fog: P.match.fog });
    this.ocean = buildOcean(this.an.waterY + 0.15, Math.max(this.an.span * 6, 6000));
    this.scene.add(this.ocean);

    // ---- الحدود ----
    this.boundary = (P.map.boundary.mode === 'manual' && P.map.boundary.poly?.length > 2)
      ? P.map.boundary.poly
      : autoBoundary(this.an, { inset: 6 });
    this.buildWall();

    // ---- الصناديق ----
    this.crates = (P.map.crates?.length ? P.map.crates : autoCrates(this.an, { count: 46 }))
      .map((c) => ({ ...c, opened: false }));
    this.buildCrates();

    // ---- اللاعب والروبوتات ----
    onProgress(0.92, 'تجهيز اللاعبين…');
    this.buildPlayer();
    this.buildBots();
    this.buildEffects();
    this.buildZone();

    // ---- الواجهة ----
    this.hud = new HUD(this.node, P, { onBigMap: () => this.toggleBigMap() });
    const mmCfg = P.controls.stats.find((s) => s.id === 'minimap');
    // استعادة موضع/حجم الخريطة المصغّرة الذي اختاره اللاعب سابقاً
    try {
      const sv = JSON.parse(localStorage.getItem('royal-minimap') || 'null');
      if (sv) Object.assign(mmCfg, sv);
    } catch (e) { /* تجاهل */ }
    this.mm = new Minimap(mmCfg, this.an, this.mapCanvas, { onExpand: () => this.toggleBigMap() });
    this.mm.onMove = () => {
      try {
        localStorage.setItem('royal-minimap',
          JSON.stringify({ x: mmCfg.x, y: mmCfg.y, size: mmCfg.size, zoom: mmCfg.zoom }));
      } catch (e) { /* تجاهل */ }
    };
    this.mm.boundary = this.boundary;
    this.hud.attachMinimap(this.mm);
    this.bigmap = el('div', { id: 'bigmap' }, el('canvas'));
    this.bigmap.addEventListener('pointerdown', () => this.toggleBigMap());
    this.node.append(this.bigmap);

    this.stats = { kills: 0, alive: P.match.bots + 1, rank: P.match.bots + 1, hp: 100, maxHp: 100,
                   shield: 0, ammo: 30, maxAmmo: 30 };
    this.hud.setHP(100);
    this.hud.setStat('kills', 0);
    this.hud.setStat('alive', this.stats.alive);
    this.hud.setStat('rank', '#' + this.stats.rank);

    this._rs = () => this.resize();
    addEventListener('resize', this._rs);
    this.resize();

    onProgress(1, 'انطلق!');
    this.beginFlight();
    this.loop();
  }

  resize() {
    if (!this.renderer) return;
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.hud?.layout();
  }

  // =========================================================
  //  بناء العناصر
  // =========================================================
  buildWall() {
    if (!this.boundary || this.boundary.length < 3) return;
    const pts = this.boundary;
    const h = 140;
    const pos = [], uv = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const y0 = this.an.waterY - 4;
      pos.push(a.x, y0, a.z, b.x, y0, b.z, b.x, y0 + h, b.z);
      pos.push(a.x, y0, a.z, b.x, y0 + h, b.z, a.x, y0 + h, a.z);
      const l = Math.hypot(b.x - a.x, b.z - a.z) / 14;
      uv.push(0, 0, l, 0, l, 1, 0, 0, l, 1, 0, 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 }, c: { value: new THREE.Color(0x4ab8ff) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `
        uniform float t; uniform vec3 c; varying vec2 vUv;
        void main(){
          float gx = smoothstep(.96,1.0,abs(sin(vUv.x*9.4)));
          float gy = smoothstep(.94,1.0,abs(sin((vUv.y*7.0)-t*.6)));
          float edge = smoothstep(1.0,.55,vUv.y);
          float a = (gx*.5+gy*.45+.09)*edge;
          gl_FragColor = vec4(c*(1.0+gy*1.6), a*.55);
        }`,
      transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    this.wall = new THREE.Mesh(g, m);
    this.wall.frustumCulled = false;
    this.scene.add(this.wall);
  }

  buildCrates() {
    // أبعاد البديل تُشتقّ من النموذج الحقيقي ليتطابق الشكل عن بُعد
    let CW = 2.6, CH = 1.5, CD = 1.6;
    this.crateK = 1;
    if (this.crateModel) {
      const bb = new THREE.Box3().setFromObject(this.crateModel);
      const sz = bb.getSize(new THREE.Vector3());
      this.crateK = 3.0 / Math.max(sz.x, sz.y, sz.z);
      this.crateBB = bb;
      CW = sz.x * this.crateK; CH = sz.y * this.crateK; CD = sz.z * this.crateK;
    }
    this.crateDims = { w: CW, h: CH, d: CD };
    // بديل منخفض التفاصيل لكل الصناديق
    const box = new THREE.BoxGeometry(CW, CH * 0.86, CD);
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a5a3c, roughness: .82, metalness: .12 });
    this.crateProxy = new THREE.InstancedMesh(box, mat, Math.max(this.crates.length, 1));
    this.crateProxy.castShadow = true; this.crateProxy.receiveShadow = true;
    this.crateProxy.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const lidG = new THREE.BoxGeometry(CW * 1.04, CH * 0.16, CD * 1.05);
    const lidM = new THREE.MeshStandardMaterial({ color: 0x6a7a4c, roughness: .8 });
    this.crateLid = new THREE.InstancedMesh(lidG, lidM, Math.max(this.crates.length, 1));
    this.crateLid.castShadow = true;
    const mtx = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);

    this.crates.forEach((c, i) => {
      c.y = this.Q.heightAt(c.x, c.z);
      qt.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.ry || 0);
      const sk = c.scale || 1;
      mtx.compose(new THREE.Vector3(c.x, c.y + CH * 0.43 * sk, c.z), qt, sc.setScalar(sk));
      this.crateProxy.setMatrixAt(i, mtx);
      mtx.compose(new THREE.Vector3(c.x, c.y + CH * 0.92 * sk, c.z), qt, sc.setScalar(sk));
      this.crateLid.setMatrixAt(i, mtx);
      c.lidT = 0;
    });
    this.crateProxy.instanceMatrix.needsUpdate = true;
    this.crateLid.instanceMatrix.needsUpdate = true;
    this.scene.add(this.crateProxy, this.crateLid);

    // مجموعة تفاصيل عالية قريبة من اللاعب
    this.detailPool = [];
    if (this.crateModel) {
      const src = this.crateModel;
      const bb = this.crateBB;
      const k = this.crateK;
      for (let i = 0; i < 3; i++) {
        const c = skClone(src);
        const holder = new THREE.Group();
        c.scale.setScalar(k);
        c.position.y = -bb.min.y * k;
        c.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        holder.add(c);
        holder.visible = false;
        const mixer = new THREE.AnimationMixer(c);
        const action = this.crateClips?.[0] ? mixer.clipAction(this.crateClips[0]) : null;
        if (action) { action.clampWhenFinished = true; action.loop = THREE.LoopOnce; }
        this.scene.add(holder);
        this.detailPool.push({ holder, mixer, action, crate: null });
      }
    }
  }

  buildPlayer() {
    const cc = currentHero(this.P);
    this.player = new Character({ ...cc, outlineOn: this.P.match.quality !== 'low' });
    this.scene.add(this.player.group);
    // الإكسسوارات
    for (const at of cc.attachments || []) {
      if (!at.visible || !at.assetId) continue;
      const url = assetURL(at.assetId);
      if (!url) continue;
      loadGLB(url).then((g) => {
        if (this.disposed) return;
        this.player.attach(g.scene, at.slot, at);
      }).catch(() => {});
    }
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0.18;
    this.camDist = 7.2;
    this.camPos = new THREE.Vector3();
    this.grounded = false;
    this.chute = buildChute(cc.body);
    this.chute.visible = false;
    this.player.group.add(this.chute);
  }

  buildBots() {
    this.bots = [];
    const n = this.P.match.bots;
    const spawns = spawnPoints(this.an, n + 6);
    for (let i = 0; i < n; i++) {
      const col = pick(BOT_COLORS);
      const ch = new Character({
        body: col, belly: '#ffffff', eye: '#101018',
        outline: '#1a1226', outlineOn: false, lod: true,
      });
      const s = spawns[i % spawns.length];
      const b = {
        id: uid('bot'), ch, name: BOT_NAMES[i % BOT_NAMES.length] + (i > 29 ? i : ''),
        pos: new THREE.Vector3(s.x, s.y, s.z), vel: new THREE.Vector3(),
        hp: 100, alive: true, yaw: rnd(0, 6.28), target: null,
        state: 'idle', t: rnd(0, 3), fire: 0, speed: 0, landed: false, dropDelay: rnd(0.5, 9),
      };
      ch.group.position.copy(b.pos);
      ch.group.visible = false;
      const tag = nameTag(b.name, col);
      tag.position.y = ch.totalH + 0.55;
      ch.group.add(tag);
      b.tag = tag;
      this.scene.add(ch.group);
      this.bots.push(b);
    }
  }

  // =========================================================
  //  الزون المتقلّص
  // =========================================================
  buildZone() {
    const cfg = this.P.map.zone || {};
    const V = mapView(this.an);
    const R = V.size * 0.5;
    this.zone = {
      cfg,
      cx: V.x0 + V.size / 2, cz: V.z0 + V.size / 2,
      r: R * (cfg.startFactor ?? 1),
      fromR: R * (cfg.startFactor ?? 1), fromX: 0, fromZ: 0,
      tx: 0, tz: 0, tr: 0,
      phase: 0, phases: Math.max(1, cfg.phases || 7),
      state: 'hold', timer: cfg.firstDelay ?? 25, total: cfg.firstDelay ?? 25,
      islandR: R, done: false,
    };
    this.zone.tx = this.zone.cx; this.zone.tz = this.zone.cz; this.zone.tr = this.zone.r;
    this.planNextZone();

    if (!cfg.enabled) return;
    // جدار مرئي: أسطوانة مفتوحة تدور ببطء
    const geo = new THREE.CylinderGeometry(1, 1, 1, 72, 1, true);
    const mat = new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 }, c: { value: new THREE.Color(cfg.color || '#25d3ff') } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `
        uniform float t; uniform vec3 c; varying vec2 vUv;
        void main(){
          float bars = smoothstep(.86,1.0,abs(sin(vUv.x*160.0 + t*0.6)));
          float rise = smoothstep(.9,1.0,abs(sin(vUv.y*10.0 - t*1.4)));
          float fade = smoothstep(1.0,.15,vUv.y);
          float a = (bars*.55 + rise*.35 + .12) * fade;
          gl_FragColor = vec4(c*(1.0+rise*1.8), a*.62);
        }`,
      transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    this.zoneMesh = new THREE.Mesh(geo, mat);
    this.zoneMesh.frustumCulled = false;
    this.scene.add(this.zoneMesh);
  }

  planNextZone() {
    const z = this.zone;
    if (z.phase >= z.phases) { z.done = true; return; }
    const cfg = z.cfg;
    const s = cfg.startFactor ?? 1, e = cfg.finalFactor ?? 0.05;
    const f = (z.phase + 1) / z.phases;
    const nr = z.islandR * (s * Math.pow(e / s, f));
    // مركز جديد عشوائي بحيث تبقى الدائرة الجديدة داخل الحالية تماماً
    const maxOff = Math.max(0, z.r - nr);
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * maxOff;
    let nx = z.cx + Math.cos(a) * d, nz = z.cz + Math.sin(a) * d;
    // فضّل مركزاً على اليابسة حتى لا تنتهي المباراة في البحر
    if (this.Q && !this.Q.isLand(nx, nz)) {
      const p = this.Q.nearestLand(nx, nz, 6);
      const ddx = p.x - z.cx, ddz = p.z - z.cz;
      const dd = Math.hypot(ddx, ddz);
      if (dd <= maxOff) { nx = p.x; nz = p.z; }
    }
    z.fromX = z.cx; z.fromZ = z.cz; z.fromR = z.r;
    z.tx = nx; z.tz = nz; z.tr = nr;
  }

  updZone(dt) {
    const z = this.zone;
    if (!z || !z.cfg.enabled || this.phase !== 'ground') return;
    z.timer -= dt;
    if (z.state === 'hold') {
      if (z.timer <= 0) {
        if (z.done) { z.timer = 9999; return; }
        z.state = 'shrink';
        z.total = z.timer = z.cfg.shrinkTime ?? 35;
      }
    } else {
      const k = 1 - Math.max(0, z.timer) / Math.max(z.total, 0.001);
      const e = k * k * (3 - 2 * k);                       // تنعيم
      z.cx = lerp(z.fromX, z.tx, e);
      z.cz = lerp(z.fromZ, z.tz, e);
      z.r = lerp(z.fromR, z.tr, e);
      if (z.timer <= 0) {
        z.cx = z.tx; z.cz = z.tz; z.r = z.tr;
        z.phase++;
        z.state = 'hold';
        z.total = z.timer = z.cfg.holdTime ?? 45;
        this.planNextZone();
        this.hud.feed(`⏱️ الزون يتقلّص — المرحلة ${z.phase}/${z.phases}`);
        A.sfx.siren();
      }
    }
    if (this.zoneMesh) {
      this.zoneMesh.position.set(z.cx, this.an.yMin + 100, z.cz);
      this.zoneMesh.scale.set(z.r, 260, z.r);
      this.zoneMesh.material.uniforms.t.value = this.clock.elapsedTime;
    }
    // ضرر خارج الزون
    const d = Math.hypot(this.pos.x - z.cx, this.pos.z - z.cz);
    this.outZone = d > z.r;
    if (this.outZone) {
      const dps = (z.cfg.damageStart ?? 2) + z.phase * (z.cfg.damageStep ?? 3);
      this.damage(dps * dt, 'الزون');
    }
    // مؤقّت الواجهة
    const secs = Math.max(0, Math.ceil(z.timer));
    const mm = Math.floor(secs / 60), ss = secs % 60;
    this.hud.setStat('zone', z.done ? '—' : `${mm}:${String(ss).padStart(2, '0')}`);
    const st = this.hud.stats.zone;
    if (st?.icon) st.icon.textContent = z.state === 'shrink' ? '🌀' : '⏱️';
  }

  buildEffects() {
    // آثار الطلقات
    const g = new THREE.BufferGeometry();
    const N = 40;
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 6), 3));
    this.tracers = { geo: g, list: [], max: N };
    this.tracerMesh = new THREE.LineSegments(g,
      new THREE.LineBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: .9 }));
    this.tracerMesh.frustumCulled = false;
    this.scene.add(this.tracerMesh);

    // وميض الفوهة
    this.flash = new THREE.PointLight(0xffcc66, 0, 14);
    this.scene.add(this.flash);

    // الغنائم
    this.loot = [];
    this.lootGeo = new THREE.IcosahedronGeometry(0.42, 0);
    this.lootMats = {
      hp: new THREE.MeshStandardMaterial({ color: 0x39e07b, emissive: 0x0d5c2c, roughness: .3 }),
      shield: new THREE.MeshStandardMaterial({ color: 0x25d3ff, emissive: 0x0a4e66, roughness: .3 }),
      ammo: new THREE.MeshStandardMaterial({ color: 0xffc21a, emissive: 0x6b4d00, roughness: .3 }),
    };
  }

  // =========================================================
  //  الطيران والهبوط
  // =========================================================
  beginFlight() {
    const P = this.P;
    const fl = P.map.flight;
    let path, dropFrom = 0.15, dropTo = 0.85;

    if (fl.mode === 'manual' && P.map.paths?.length) {
      // مسار رسمه المستخدم يدوياً
      path = pick(P.map.paths).points.slice();
      if (Math.random() < 0.5) path.reverse();
      const ext = (p0, p1, d) => {
        const l = Math.hypot(p0.x - p1.x, p0.z - p1.z) || 1;
        return { x: p0.x + ((p0.x - p1.x) / l) * d, z: p0.z + ((p0.z - p1.z) / l) * d };
      };
      path.unshift(ext(path[0], path[1], this.an.span * 0.3));
      path.push(ext(path[path.length - 1], path[path.length - 2], this.an.span * 0.3));
      const w = this.landWindow(path);
      dropFrom = w.from; dropTo = w.to;
    } else {
      // المحرّك يولّد مساراً جديداً كل مباراة — 3 نقاط، لا يعبر إلا فوق اليابسة
      const g = autoFlightPath(this.an, { margin: fl.landMargin ?? 12 });
      path = g.points.slice();
      dropFrom = g.dropFrom; dropTo = g.dropTo;
      if (Math.random() < 0.5) {                 // يبدأ من أي طرف
        path.reverse();
        const a = 1 - dropTo, b = 1 - dropFrom;
        dropFrom = a; dropTo = b;
      }
    }
    this.dropFrom = clamp(dropFrom, 0.02, 0.94);
    this.dropTo = clamp(Math.max(dropTo, dropFrom + 0.05), 0.06, 0.96);

    this.path = path;
    this.pathLen = [];
    let tot = 0;
    for (let i = 1; i < path.length; i++) {
      tot += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
      this.pathLen.push(tot);
    }
    this.pathTotal = tot;
    this.flightT = 0;
    this.flightDur = tot / P.map.flight.speed;
    this.altitude = P.map.flight.altitude;
    if (this.mm) this.mm.path = path;

    // الطائرة
    if (this.shipModel && !this.ship) {
      this.ship = new THREE.Group();
      const bb = new THREE.Box3().setFromObject(this.shipModel);
      const sz = bb.getSize(new THREE.Vector3());
      const k = 34 / Math.max(sz.x, sz.z);
      this.shipModel.scale.setScalar(k);
      this.shipModel.position.sub(bb.getCenter(new THREE.Vector3()).multiplyScalar(k));
      this.shipModel.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
      this.ship.add(this.shipModel);
      this.scene.add(this.ship);
      // ضوء المحركات
      const gl = new THREE.PointLight(0x66ccff, 6, 40);
      gl.position.set(0, 0, -14);
      this.ship.add(gl);
      this.shipGlow = gl;
    }

    this.phase = 'flight';
    this.player.group.visible = true;
    this.hud.setCombatVisible(false);
    for (const b of this.bots) b.ch.group.visible = false;
    A.unlock();
    if (this.P.match.engineSfx) { A.engineSound.start(); A.engineSound.set(1, 1); }
    this.hud.showDrop('اضغط <b style="color:var(--acc)">القفز</b> للنزول من الطائرة');
  }

  /** أطول قطعة من المسار تمرّ فوق يابسة صالحة → نافذة قفز آمنة */
  landWindow(path) {
    const N = 200;
    const seg = [];
    let tot = 0;
    for (let i = 1; i < path.length; i++)
      tot += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    const at = (f) => {
      let d = f * tot, i = 0;
      while (i < path.length - 2) {
        const l = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);
        if (d <= l) break;
        d -= l; i++;
      }
      const a = path[i], b = path[i + 1] || a;
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const k = clamp(d / l, 0, 1);
      return { x: lerp(a.x, b.x, k), z: lerp(a.z, b.z, k) };
    };
    let run = 0, start = -1, bestRun = 0, bs = 0, be = N;
    for (let i = 0; i <= N; i++) {
      const p = at(i / N);
      const ok = this.Q.isLand(p.x, p.z) && this.Q.edgeAt(p.x, p.z) >= 10;
      if (ok) {
        if (run === 0) start = i;
        run++;
        if (run > bestRun) { bestRun = run; bs = start; be = i; }
      } else run = 0;
    }
    if (bestRun < 6) return { from: 0.3, to: 0.7 };
    const w = (be - bs) / N;
    return { from: bs / N + w * 0.1, to: be / N - w * 0.1 };
  }

  pathAt(t) {
    const d = clamp(t, 0, 1) * this.pathTotal;
    let i = 0;
    while (i < this.pathLen.length - 1 && this.pathLen[i] < d) i++;
    const prev = i === 0 ? 0 : this.pathLen[i - 1];
    const seg = this.pathLen[i] - prev || 1;
    const f = clamp((d - prev) / seg, 0, 1);
    const a = this.path[i], b = this.path[i + 1] || a;
    return { x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f),
             dx: b.x - a.x, dz: b.z - a.z };
  }

  jumpOut() {
    if (this.phase !== 'flight') return;
    this.phase = 'freefall';
    const p = this.pathAt(this.flightT / this.flightDur);
    this.pos.set(p.x, this.groundY(p.x, p.z) + this.altitude, p.z);
    this.vel.set(this.shipDir?.x * 6 || 0, -2, this.shipDir?.z * 6 || 0);
    this.player.group.visible = true;
    this.player.group.position.copy(this.pos);
    this.hud.showDrop(null);
    this.hud.setCombatVisible(false);
    A.engineSound.volume(0.12);
    A.windSound.start();
    A.sfx.whoosh();
    // هبوط الروبوتات
    for (const b of this.bots) b.dropAt = this.flightT / this.flightDur + rnd(-0.12, 0.2);
  }

  deployChute() {
    if (this.phase !== 'freefall') return;
    this.phase = 'chute';
    this.chute.visible = true;
    this.chute.scale.setScalar(0.1);
    A.sfx.chute();
  }

  land() {
    this.phase = 'ground';
    this.chute.visible = false;
    this.hud.showDrop(null);
    this.hud.setCombatVisible(true);
    A.engineSound.stop();
    A.windSound.stop();
    A.sfx.land();
    for (const b of this.bots) { b.ch.group.visible = true; b.landed = true; }
  }

  groundY(x, z) { return this.Q.heightAt(x, z); }

  // =========================================================
  //  الحلقة الرئيسية
  // =========================================================
  loop = () => {
    if (this.disposed) return;
    this._raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    try { this.update(dt); } catch (e) { console.error(e); }
    this.renderer.render(this.scene, this.camera);
  };

  update(dt) {
    const t = this.clock.elapsedTime;
    if (this.wall) this.wall.material.uniforms.t.value = t;
    if (this.ocean) this.ocean.material.uniforms.t.value = t;

    switch (this.phase) {
      case 'flight': this.updFlight(dt); break;
      case 'freefall': case 'chute': this.updDrop(dt); break;
      case 'ground': this.updGround(dt); break;
      case 'end': this.updEnd(dt); break;
    }

    this.updZone(dt);
    this.updBots(dt);
    this.updCrates(dt);
    this.updLoot(dt);
    this.updTracers(dt);
    this.updSun();
    this.updMinimap();
    if (this.flash.intensity > 0) this.flash.intensity = Math.max(0, this.flash.intensity - dt * 60);
  }

  // ---------------- طيران ----------------
  updFlight(dt) {
    this.flightT += dt;
    const f = clamp(this.flightT / this.flightDur, 0, 1);
    const p = this.pathAt(f);
    const dl = Math.hypot(p.dx, p.dz) || 1;
    this.shipDir = { x: p.dx / dl, z: p.dz / dl };
    const y = this.an.yMax + this.altitude;

    if (this.ship) {
      this.ship.position.set(p.x, y, p.z);
      this.ship.rotation.y = Math.atan2(p.dx, p.dz);
      this.ship.rotation.z = Math.sin(this.clock.elapsedTime * 0.6) * 0.05;
      if (this.shipGlow) this.shipGlow.intensity = 5 + Math.sin(this.clock.elapsedTime * 9) * 1.6;
    }
    this.pos.set(p.x, y - 3, p.z);
    this.player.group.position.copy(this.pos);
    this.player.group.rotation.y = this.ship ? this.ship.rotation.y : 0;
    this.player.update(dt, { speed: 0, grounded: false, groundY: y - 3 });

    // كاميرا سينمائية حول الطائرة
    const a = this.clock.elapsedTime * 0.22;
    this.camera.position.set(p.x + Math.cos(a) * 34, y + 11, p.z + Math.sin(a) * 34);
    this.camera.lookAt(p.x, y - 2, p.z);

    A.engineSound.set(1, 1 + Math.sin(this.clock.elapsedTime * .5) * .03);

    const canJump = f >= this.dropFrom;
    if (canJump) {
      const left = Math.max(0, Math.round((this.dropTo - f) / (this.dropTo - this.dropFrom) * 100));
      this.hud.showDrop(
        `اضغط <b style="color:var(--acc)">القفز</b> للنزول &nbsp;•&nbsp; نافذة الهبوط ${left}%`);
      if (this.hud.consume('jump')) this.jumpOut();
    } else {
      this.hud.showDrop('الطائرة تقترب من الجزيرة…');
    }
    if (f >= this.dropTo) this.jumpOut();     // قفز إجباري قبل مغادرة اليابسة
    this.hud.consume('jump');
  }

  // ---------------- سقوط حر / مظلة ----------------
  updDrop(dt) {
    const chute = this.phase === 'chute';
    const inp = this.hud.input;
    const acc = chute ? 16 : 26;
    // التوجيه بالكاميرا
    const mx = inp.move.x, my = inp.move.y;
    const cy = this.yaw;
    const fx = -Math.sin(cy), fz = -Math.cos(cy);
    const rx = Math.cos(cy), rz = -Math.sin(cy);
    this.vel.x += (fx * -my + rx * mx) * acc * dt;
    this.vel.z += (fz * -my + rz * mx) * acc * dt;
    const drag = chute ? 2.6 : 1.1;
    this.vel.x -= this.vel.x * drag * dt;
    this.vel.z -= this.vel.z * drag * dt;
    const maxTerm = chute ? -11 : -58;
    this.vel.y = smooth(this.vel.y, maxTerm, chute ? 4.5 : 1.4, dt);

    // توجيه تلقائي نحو اليابسة — يستحيل الهبوط في البحر
    const safe = this.Q.nearestLand(this.pos.x, this.pos.z, 8);
    if (safe.moved) {
      const sx = safe.x - this.pos.x, sz = safe.z - this.pos.z;
      const sd = Math.hypot(sx, sz) || 1;
      const pull = chute ? 34 : 16;
      this.vel.x += (sx / sd) * pull * dt;
      this.vel.z += (sz / sd) * pull * dt;
      this.hud.showOOB('🌊 توجيه تلقائي نحو اليابسة');
    } else if (this._oobShown) this.hud.showOOB(null);
    this._oobShown = safe.moved;

    this.pos.addScaledVector(this.vel, dt);
    const overSea = !this.Q.isLand(this.pos.x, this.pos.z);
    const gy = overSea ? this.an.waterY - 60 : this.groundY(this.pos.x, this.pos.z);
    const alt = this.pos.y - gy;

    A.windSound.set(clamp(Math.abs(this.vel.y) / 55, 0, 1));

    if (!chute && (alt < 46 || this.hud.consume('jump'))) this.deployChute();
    if (chute) this.chute.scale.setScalar(smooth(this.chute.scale.x, 1, 8, dt));

    if (alt <= 0.05) {
      // ضمان نهائي: انقل إلى أقرب يابسة آمنة قبل ملامسة الأرض
      const L = this.Q.nearestLand(this.pos.x, this.pos.z, 6);
      this.pos.x = L.x; this.pos.z = L.z;
      this.pos.y = this.groundY(L.x, L.z);
      this.vel.set(0, 0, 0);
      this.hud.showOOB(null);
      this.land();
    } else this.player.group.position.copy(this.pos);

    this.hud.showDrop(`الارتفاع <b style="color:var(--acc)">${Math.max(0, alt).toFixed(0)}م</b>` +
      (chute ? '' : ' — اضغط القفز لفتح المظلة'));

    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.4) this.player.st.yaw = Math.atan2(this.vel.x, this.vel.z);
    this.player.root.rotation.y = this.player.st.yaw;
    this.player.update(dt, { speed: 0, grounded: false, vy: this.vel.y, groundY: gy });

    // كاميرا
    this.updCamera(dt, chute ? 9 : 12, 3.2);
    if (this.phase === 'ground') this.hud.showDrop(null);
  }

  // ---------------- على الأرض ----------------
  updGround(dt) {
    const inp = this.hud.input;
    const P = this.P;

    // دوران الكاميرا بعصا التصويب
    if (Math.abs(inp.aim.x) > 0.05 || Math.abs(inp.aim.y) > 0.05) {
      this.yaw -= inp.aim.x * 2.6 * dt;
      this.pitch = clamp(this.pitch + inp.aim.y * 1.5 * dt, -0.5, 0.85);
    }

    const run = inp.run;
    const crouch = inp.crouch;
    const base = crouch ? 2.6 : run ? 9.4 : 5.6;
    const mx = inp.move.x, my = inp.move.y;
    const mag = clamp(Math.hypot(mx, my), 0, 1);

    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let wx = fx * -my + rx * mx, wz = fz * -my + rz * mx;
    const wl = Math.hypot(wx, wz) || 1;
    wx /= wl; wz /= wl;

    const want = { x: wx * base * mag, z: wz * base * mag };
    const acc = this.grounded ? 22 : 6;
    this.vel.x = smooth(this.vel.x, want.x, acc, dt);
    this.vel.z = smooth(this.vel.z, want.z, acc, dt);

    // قفز
    if (this.hud.consume('jump') && this.grounded) {
      this.vel.y = 9.2; this.grounded = false; A.sfx.jump();
    }
    this.vel.y -= 26 * dt;

    // حركة مع فحص المنحدرات
    const step = 0.75;
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    const curG = this.groundY(this.pos.x, this.pos.z);
    let gx = this.groundY(nx, this.pos.z), gz = this.groundY(this.pos.x, nz);
    if (gx - curG <= step) this.pos.x = nx; else this.vel.x *= -0.15;
    if (gz - curG <= step) this.pos.z = nz; else this.vel.z *= -0.15;

    this.pos.y += this.vel.y * dt;
    const gy = this.groundY(this.pos.x, this.pos.z);
    if (this.pos.y <= gy) {
      if (!this.grounded && this.vel.y < -12) A.sfx.land();
      this.pos.y = gy; this.vel.y = 0; this.grounded = true;
    } else if (this.pos.y > gy + 0.12) this.grounded = false;

    // خطوات
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this._stepT = (this._stepT || 0) + sp * dt;
    if (this.grounded && this._stepT > 2.1) { this._stepT = 0; A.sfx.step(); }

    this.player.group.position.copy(this.pos);
    const yawTarget = sp > 0.3 ? Math.atan2(this.vel.x, this.vel.z) : (inp.aiming ? this.yaw + Math.PI : undefined);
    this.player.update(dt, {
      speed: sp, grounded: this.grounded, crouch, aim: inp.aiming, vy: this.vel.y,
      yaw: yawTarget, groundY: gy, look: new THREE.Vector2(0, 0),
    });

    // الحدود
    this.checkBounds(dt);
    // إطلاق النار
    this.updShoot(dt);
    // التفاعل
    this.updInteract(dt);

    this.updCamera(dt, this.camDist * (inp.aiming ? 0.72 : 1) * (run ? 1.12 : 1), inp.aiming ? 1.7 : 2.1);

    // FOV ديناميكي
    const wantFov = 62 + (run ? 7 : 0) - (inp.aiming ? 9 : 0);
    if (Math.abs(this.camera.fov - wantFov) > 0.05) {
      this.camera.fov = smooth(this.camera.fov, wantFov, 7, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  updCamera(dt, dist, height) {
    const look = this.tmp.v1.copy(this.pos);
    look.y += this.player.totalH * 0.72 + height * 0.4;
    const dir = this.tmp.v2.set(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch) + 0.28,
      Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();
    const want = look.clone().addScaledVector(dir, dist);
    // لا تدخل الكاميرا تحت الأرض
    const g = this.groundY(want.x, want.z) + 1.6;
    if (want.y < g) want.y = g;
    this.camPos.lerp(want, 1 - Math.exp(-11 * dt));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(look);
  }

  checkBounds(dt) {
    if (!this.boundary?.length) return;
    const inside = pointInPoly(this.pos.x, this.pos.z, this.boundary);
    const wet = this.pos.y < this.an.waterY + 0.4;
    if (this.outZone && inside && !wet) {
      const z = this.zone;
      const d = Math.hypot(this.pos.x - z.cx, this.pos.z - z.cz) - z.r;
      this.hud.showOOB('🌀 خارج الزون!<br><small>اتجه للمركز — ' + Math.max(0, d).toFixed(0) + 'م</small>');
      return;
    }
    if (!inside || wet) {
      const c = closestOnPoly(this.pos.x, this.pos.z, this.boundary);
      this.hud.showOOB('⚠️ خارج حدود المعركة<br><small>عُد إلى الجزيرة — المسافة ' + c.dist.toFixed(0) + 'م</small>');
      this.damage(16 * dt, 'الحدود');
      // دفعة لطيفة للداخل
      const dx = c.x - this.pos.x, dz = c.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      this.vel.x += (dx / d) * 26 * dt;
      this.vel.z += (dz / d) * 26 * dt;
      this._oobT = (this._oobT || 0) + dt;
      if (this._oobT > 1) { this._oobT = 0; A.sfx.siren(); }
    } else this.hud.showOOB(null);
  }

  // ---------------- القتال ----------------
  updShoot(dt) {
    this.fireCd = Math.max(0, (this.fireCd || 0) - dt);
    const inp = this.hud.input;
    if (this.hud.consume('reload') || (this.stats.ammo <= 0 && !this.reloading)) {
      this.reloading = 0.9; this.hud.showPrompt('إعادة التعبئة…');
    }
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.stats.ammo = this.stats.maxAmmo; this.reloading = 0; this.hud.showPrompt(null);
      }
      return;
    }
    if (!inp.shoot || this.fireCd > 0 || this.stats.ammo <= 0) return;
    this.fireCd = 0.11;
    this.stats.ammo--;
    A.sfx.shoot();

    const from = this.pos.clone();
    from.y += this.player.totalH * 0.72;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const spread = inp.aiming ? 0.012 : 0.042;
    dir.x += rnd(-spread, spread); dir.y += rnd(-spread, spread); dir.z += rnd(-spread, spread);
    dir.normalize();

    this.flash.position.copy(from).addScaledVector(dir, 1.2);
    this.flash.intensity = 18;

    // إصابة أقرب روبوت
    let hit = null, hd = 260;
    const v = new THREE.Vector3();
    for (const b of this.bots) {
      if (!b.alive || !b.landed) continue;
      v.copy(b.pos).sub(from);
      v.y += b.ch.totalH * 0.55;
      const along = v.dot(dir);
      if (along < 0.6 || along > hd) continue;
      const perp = v.clone().addScaledVector(dir, -along).length();
      if (perp < 0.95) { hit = b; hd = along; }
    }
    const end = from.clone().addScaledVector(dir, hit ? hd : 190);
    this.addTracer(from.clone().addScaledVector(dir, 1.4), end);
    if (hit) {
      A.sfx.hit();
      hit.hp -= 26;
      hit.aggro = this.pos.clone();
      if (hit.hp <= 0) this.killBot(hit, true);
    }
  }

  killBot(b, byPlayer) {
    b.alive = false;
    b.ch.group.visible = false;
    this.stats.alive--;
    if (byPlayer) {
      this.stats.kills++;
      A.sfx.kill();
      this.hud.setStat('kills', this.stats.kills);
      this.hud.feed(`☠️ أسقطتَ <b>${b.name}</b>`);
    } else {
      this.hud.feed(`☠️ ${b.name} خرج من اللعبة`);
    }
    this.stats.rank = this.stats.alive;
    this.hud.setStat('alive', this.stats.alive);
    this.hud.setStat('rank', '#' + this.stats.rank);
    if (this.stats.alive <= 1) this.endMatch(true);
  }

  damage(v, src) {
    if (this.phase === 'end') return;
    if (this.stats.shield > 0) {
      const a = Math.min(this.stats.shield, v);
      this.stats.shield -= a; v -= a;
    }
    if (v <= 0) { this.hud.setHP(this.stats.hp); return; }
    this.stats.hp -= v;
    this.hud.setHP(this.stats.hp);
    if (v > 2) { this.hud.damage(); A.sfx.hurt(); }
    if (this.stats.hp <= 0) { this.stats.hp = 0; this.endMatch(false); }
  }

  // ---------------- الصناديق والتفاعل ----------------
  updCrates(dt) {
    if (this.phase === 'loading') return;
    // ربط نماذج التفاصيل بأقرب الصناديق
    if (this.detailPool.length) {
      const near = this.crates
        .map((c, i) => ({ c, i, d: (c.x - this.pos.x) ** 2 + (c.z - this.pos.z) ** 2 }))
        .filter((o) => o.d < 55 * 55)
        .sort((a, b) => a.d - b.d)
        .slice(0, this.detailPool.length);
      const used = new Set();
      for (const d of this.detailPool) {
        if (d.crate && !near.find((n) => n.c === d.crate)) { d.crate = null; d.holder.visible = false; }
        if (d.crate) used.add(d.crate);
      }
      for (const n of near) {
        if (used.has(n.c)) continue;
        const free = this.detailPool.find((d) => !d.crate);
        if (!free) break;
        free.crate = n.c; used.add(n.c);
        free.holder.visible = true;
        free.holder.position.set(n.c.x, n.c.y, n.c.z);
        free.holder.rotation.y = n.c.ry || 0;
        free.holder.scale.setScalar(n.c.scale || 1);
        free.mixer.stopAllAction();
        if (free.action) {
          free.action.reset();
          if (n.c.opened) { free.action.play(); free.action.time = free.action.getClip().duration; free.mixer.update(0); }
        }
      }
      for (const d of this.detailPool) if (d.mixer) d.mixer.update(dt);
    }
    // إخفاء البديل عند وجود التفاصيل
    const mtx = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3();
    let dirty = false;
    this.crates.forEach((c, i) => {
      const detailed = this.detailPool.some((d) => d.crate === c);
      const targetLid = c.opened ? 1 : 0;
      if (Math.abs(c.lidT - targetLid) > 0.001) {
        c.lidT = smooth(c.lidT, targetLid, 6, dt); dirty = true;
      }
      const s = detailed ? 0.0001 : (c.scale || 1);
      const CH2 = this.crateDims.h;
      qt.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.ry || 0);
      mtx.compose(new THREE.Vector3(c.x, c.y + CH2 * 0.43 * s, c.z), qt, sc.setScalar(s));
      this.crateProxy.setMatrixAt(i, mtx);
      const lift = c.lidT * CH2 * 0.8;
      qt.setFromEuler(new THREE.Euler(c.lidT * -0.9, c.ry || 0, 0));
      mtx.compose(new THREE.Vector3(c.x, c.y + CH2 * 0.92 * s + lift, c.z - c.lidT * this.crateDims.d * 0.35), qt, sc.setScalar(s));
      this.crateLid.setMatrixAt(i, mtx);
      if (detailed) dirty = true;
    });
    if (dirty || this._crateDirty !== false) {
      this.crateProxy.instanceMatrix.needsUpdate = true;
      this.crateLid.instanceMatrix.needsUpdate = true;
      this._crateDirty = false;
    }
  }

  updInteract(dt) {
    let best = null, bd = 4.2 * 4.2;
    for (const c of this.crates) {
      if (c.opened) continue;
      const d = (c.x - this.pos.x) ** 2 + (c.z - this.pos.z) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    let lootNear = null, ld = 2.6 * 2.6;
    for (const l of this.loot) {
      const d = l.mesh.position.distanceToSquared(this.pos);
      if (d < ld) { ld = d; lootNear = l; }
    }
    this.nearCrate = best;
    if (best) this.hud.showPrompt('📦 اضغط زر «فتح الصناديق»');
    else if (lootNear) this.hud.showPrompt('✋ اضغط زر «التقاط الأشياء»');
    else if (!this.reloading) this.hud.showPrompt(null);

    if (this.hud.consume('open') && best) {
      best.opened = true;
      this._crateDirty = true;
      A.sfx.crate();
      const d = this.detailPool.find((x) => x.crate === best);
      if (d?.action) { d.action.reset(); d.action.play(); }
      const n = rndi(2, 3);
      for (let i = 0; i < n; i++) this.spawnLoot(best.x + rnd(-1.6, 1.6), best.y + 1.2, best.z + rnd(-1.6, 1.6));
      this.hud.feed('📦 صندوق مفتوح');
    }
    if (this.hud.consume('pickup') && lootNear) this.take(lootNear);
  }

  spawnLoot(x, y, z, kind) {
    kind = kind || pick(['hp', 'shield', 'ammo', 'ammo']);
    const m = new THREE.Mesh(this.lootGeo, this.lootMats[kind]);
    m.position.set(x, y, z);
    m.castShadow = true;
    const light = new THREE.PointLight(this.lootMats[kind].color.getHex(), 2.4, 6);
    m.add(light);
    this.scene.add(m);
    this.loot.push({ mesh: m, kind, t: rnd(0, 6.28), vy: 2.4, ground: this.groundY(x, z) + 0.6 });
    while (this.loot.length > 26) {
      const old = this.loot.shift();
      this.scene.remove(old.mesh);
    }
  }

  take(l) {
    A.sfx.pickup();
    if (l.kind === 'hp') { this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + 35); this.hud.setHP(this.stats.hp); this.hud.feed('❤️ +35 صحة'); }
    if (l.kind === 'shield') { this.stats.shield = Math.min(100, this.stats.shield + 40); this.hud.feed('🛡️ +40 درع'); }
    if (l.kind === 'ammo') { this.stats.ammo = this.stats.maxAmmo; this.hud.feed('🔫 ذخيرة ممتلئة'); }
    this.scene.remove(l.mesh);
    this.loot.splice(this.loot.indexOf(l), 1);
  }

  updLoot(dt) {
    for (const l of this.loot) {
      l.t += dt;
      if (l.mesh.position.y > l.ground) { l.vy -= 22 * dt; l.mesh.position.y += l.vy * dt; }
      else l.mesh.position.y = l.ground + Math.sin(l.t * 2.4) * 0.16;
      l.mesh.rotation.y += dt * 1.7;
      l.mesh.rotation.x += dt * 0.8;
    }
  }

  // ---------------- الروبوتات ----------------
  updBots(dt) {
    if (this.phase === 'loading') return;
    const pj = this.phase === 'ground';
    let aliveN = 1;
    for (const b of this.bots) {
      if (!b.alive) continue;
      aliveN++;
      if (!b.landed) {
        if (this.phase === 'flight') continue;
        b.landDelay = (b.landDelay ?? rnd(0.5, 5));
        b.landDelay -= dt;
        if (b.landDelay <= 0) { b.landed = true; b.ch.group.visible = true; }
        continue;
      }
      b.t += dt;
      const dp = b.pos.distanceTo(this.pos);
      const canSee = pj && dp < 62;

      if (canSee || (b.aggro && b.t - (b.aggroT || 0) < 6)) {
        if (canSee) { b.aggro = this.pos; b.aggroT = b.t; }
        b.state = 'fight';
      } else if (!b.target || b.t > (b.retarget || 0)) {
        b.state = 'roam';
        const a = rnd(0, 6.28), r = rnd(18, 70);
        let tx = b.pos.x + Math.cos(a) * r, tz = b.pos.z + Math.sin(a) * r;
        // ابقَ داخل الزون
        const Z = this.zone;
        if (Z && Z.cfg.enabled) {
          const dz = Math.hypot(b.pos.x - Z.cx, b.pos.z - Z.cz);
          if (dz > Z.r * 0.82) {
            const k = rnd(0.15, 0.7);
            tx = lerp(b.pos.x, Z.cx, k); tz = lerp(b.pos.z, Z.cz, k);
          } else if (Math.hypot(tx - Z.cx, tz - Z.cz) > Z.r * 0.9) {
            tx = lerp(tx, Z.cx, 0.6); tz = lerp(tz, Z.cz, 0.6);
          }
        }
        if (this.boundary && !pointInPoly(tx, tz, this.boundary)) {
          const c = closestOnPoly(tx, tz, this.boundary);
          tx = lerp(tx, c.x, 1.15); tz = lerp(tz, c.z, 1.15);
        }
        b.target = new THREE.Vector3(tx, 0, tz);
        b.retarget = b.t + rnd(4, 11);
      }

      let tx, tz, spd;
      if (b.state === 'fight') {
        const keep = 22;
        const dir = this.tmp.v1.copy(this.pos).sub(b.pos);
        const d = dir.length() || 1;
        dir.multiplyScalar(1 / d);
        const sign = d > keep ? 1 : -1;
        tx = b.pos.x + dir.x * sign * 12 + Math.cos(b.t * 1.3) * 6;
        tz = b.pos.z + dir.z * sign * 12 + Math.sin(b.t * 1.3) * 6;
        spd = 7;
        // إطلاق النار
        b.fire -= dt;
        if (b.fire <= 0 && d < 58) {
          b.fire = rnd(0.35, 1.1) / (0.4 + this.P.match.botSkill);
          const from = b.pos.clone(); from.y += b.ch.totalH * 0.7;
          const to = this.pos.clone(); to.y += this.player.totalH * 0.6;
          this.addTracer(from, to);
          if (Math.random() < this.P.match.botSkill * clamp(1 - d / 70, 0.15, 1)) this.damage(rnd(4, 9), b.name);
        }
      } else {
        tx = b.target.x; tz = b.target.z; spd = 4.4;
        if (Math.hypot(tx - b.pos.x, tz - b.pos.z) < 3) b.retarget = 0;
      }

      const dx = tx - b.pos.x, dz = tz - b.pos.z;
      const dl = Math.hypot(dx, dz) || 1;
      const wx = (dx / dl) * spd, wz = (dz / dl) * spd;
      b.vel.x = smooth(b.vel.x, wx, 8, dt);
      b.vel.z = smooth(b.vel.z, wz, 8, dt);
      const cg = this.groundY(b.pos.x, b.pos.z);
      const nx = b.pos.x + b.vel.x * dt, nz = b.pos.z + b.vel.z * dt;
      if (this.groundY(nx, b.pos.z) - cg <= 0.8) b.pos.x = nx; else b.vel.x *= -0.4;
      if (this.groundY(b.pos.x, nz) - cg <= 0.8) b.pos.z = nz; else b.vel.z *= -0.4;
      b.pos.y = this.groundY(b.pos.x, b.pos.z);

      const s = Math.hypot(b.vel.x, b.vel.z);
      b.ch.group.position.copy(b.pos);
      b.ch.update(dt, {
        speed: s, grounded: true, groundY: b.pos.y,
        yaw: s > 0.4 ? Math.atan2(b.vel.x, b.vel.z) : undefined,
      });
      // إظهار الاسم عن قرب فقط
      b.tag.visible = dp < 70;
      // إخفاء البعيدين لتحسين الأداء
      b.ch.group.visible = dp < 240;
    }

    // ضرر الزون على الروبوتات خارجه
    const Z = this.zone;
    if (pj && Z && Z.cfg.enabled) {
      const dps = (Z.cfg.damageStart ?? 2) + Z.phase * (Z.cfg.damageStep ?? 3);
      for (const b of this.bots) {
        if (!b.alive || !b.landed) continue;
        if (Math.hypot(b.pos.x - Z.cx, b.pos.z - Z.cz) > Z.r) {
          b.hp -= dps * dt;
          if (b.hp <= 0) this.killBot(b, false);
        }
      }
    }

    // إسقاط تدريجي للروبوتات البعيدة (لتقدّم الترتيب)
    if (pj) {
      this._elimT = (this._elimT || 0) + dt;
      if (this._elimT > rnd(7, 16) && this.stats.alive > 2) {
        this._elimT = 0;
        const far = this.bots.filter((b) => b.alive && b.pos.distanceTo(this.pos) > 110);
        if (far.length) this.killBot(pick(far), false);
      }
    }
  }

  // ---------------- آثار الطلقات ----------------
  addTracer(a, b) {
    this.tracers.list.push({ a: a.clone(), b: b.clone(), t: 0.09 });
    if (this.tracers.list.length > this.tracers.max) this.tracers.list.shift();
  }
  updTracers(dt) {
    const arr = this.tracers.geo.attributes.position.array;
    let n = 0;
    for (let i = this.tracers.list.length - 1; i >= 0; i--) {
      const t = this.tracers.list[i];
      t.t -= dt;
      if (t.t <= 0) { this.tracers.list.splice(i, 1); continue; }
      if (n < this.tracers.max) {
        arr[n * 6] = t.a.x; arr[n * 6 + 1] = t.a.y; arr[n * 6 + 2] = t.a.z;
        arr[n * 6 + 3] = t.b.x; arr[n * 6 + 4] = t.b.y; arr[n * 6 + 5] = t.b.z;
        n++;
      }
    }
    for (let i = n; i < this.tracers.max; i++) for (let k = 0; k < 6; k++) arr[i * 6 + k] = 0;
    this.tracers.geo.attributes.position.needsUpdate = true;
    this.tracers.geo.setDrawRange(0, n * 2);
  }

  updSun() {
    const s = this.env?.sun;
    if (!s) return;
    s.target.position.copy(this.pos);
    s.position.copy(this.pos).add(this._sunOff ||= new THREE.Vector3(120, 260, 90));
    s.target.updateMatrixWorld();
  }

  updMinimap() {
    if (!this.mm) return;
    const others = [];
    for (const b of this.bots) {
      if (!b.alive || !b.landed) continue;
      const d = b.pos.distanceTo(this.pos);
      if (d < 130) others.push({ x: b.pos.x, z: b.pos.z, color: '#ff4d5e', r: 3 });
    }
    for (const c of this.crates) {
      if (c.opened) continue;
      if (Math.abs(c.x - this.pos.x) + Math.abs(c.z - this.pos.z) < 190)
        others.push({ x: c.x, z: c.z, color: '#ffc21a', r: 2.2 });
    }
    this.mm.zone = this.zone && this.zone.cfg.enabled ? this.zone : null;
    this.mm.draw(this.pos.x, this.pos.z, this.yaw, others);
    if (this.bigmap.classList.contains('on')) this.drawBigMap();
  }

  toggleBigMap() {
    const on = this.bigmap.classList.toggle('on');
    if (on) this.drawBigMap();
  }
  drawBigMap() {
    const cv = this.bigmap.querySelector('canvas');
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (cv.width !== innerWidth * dpr) { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; }
    const g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    g.fillStyle = '#05030f'; g.fillRect(0, 0, W, H);
    const s = Math.min(W, H) * 0.92;
    const ox = (W - s) / 2, oy = (H - s) / 2;
    g.drawImage(this.mapCanvas, ox, oy, s, s);
    const an = this.an;
    const V = an.view || { x0: an.minX, z0: an.minZ, size: an.maxX - an.minX };
    const to = (x, z) => [ox + ((x - V.x0) / V.size) * s, oy + ((z - V.z0) / V.size) * s];
    if (this.boundary?.length > 2) {
      g.strokeStyle = 'rgba(255,70,90,.95)'; g.lineWidth = 3; g.beginPath();
      this.boundary.forEach((p, i) => { const [a, b] = to(p.x, p.z); i ? g.lineTo(a, b) : g.moveTo(a, b); });
      g.closePath(); g.stroke();
    }
    if (this.path?.length > 1) {
      g.strokeStyle = '#fff'; g.lineWidth = 3; g.setLineDash([10, 8]); g.beginPath();
      this.path.forEach((p, i) => { const [a, b] = to(p.x, p.z); i ? g.lineTo(a, b) : g.moveTo(a, b); });
      g.stroke(); g.setLineDash([]);
    }
    for (const c of this.crates) {
      if (c.opened) continue;
      const [a, b] = to(c.x, c.z);
      g.fillStyle = '#ffc21a'; g.fillRect(a - 3, b - 3, 6, 6);
    }
    const z = this.zone;
    if (z && z.cfg.enabled) {
      const scale = s / V.size;
      const [zx, zy] = to(z.cx, z.cz);
      g.strokeStyle = '#ffffff'; g.lineWidth = 3;
      g.beginPath(); g.arc(zx, zy, z.r * scale, 0, 7); g.stroke();
      if (!z.done) {
        const [tx, ty] = to(z.tx, z.tz);
        g.strokeStyle = z.cfg.color || '#25d3ff'; g.lineWidth = 3;
        g.setLineDash([8, 7]);
        g.beginPath(); g.arc(tx, ty, z.tr * scale, 0, 7); g.stroke();
        g.setLineDash([]);
      }
    }
    const [px, pz] = to(this.pos.x, this.pos.z);
    g.fillStyle = '#25d3ff'; g.strokeStyle = '#001b26'; g.lineWidth = 3;
    g.beginPath(); g.arc(px, pz, 9, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold ' + Math.round(16 * dpr) + 'px Tajawal, sans-serif';
    g.textAlign = 'center';
    g.fillText('اضغط في أي مكان للإغلاق', W / 2, oy + s + 26 * dpr);
  }

  // ---------------- النهاية ----------------
  endMatch(win) {
    if (this.phase === 'end') return;
    this.phase = 'end';
    A.engineSound.stop(); A.windSound.stop();
    win ? A.sfx.win() : A.sfx.lose();
    this.hud.setCombatVisible(false);
    this.hud.showPrompt(null); this.hud.showOOB(null);
    const box = el('div', { class: 'box' },
      el('div', { class: 'big' }, win ? '👑 النصر!' : '☠️ نهاية اللعبة'),
      el('div', { style: { fontSize: '16px', color: 'var(--ink-2)', marginBottom: '4px' } },
        `الترتيب #${this.stats.rank} من ${this.P.match.bots + 1}`),
      el('div', { style: { fontSize: '15px', marginBottom: '18px' } },
        `عدد الإسقاطات: ${this.stats.kills} 💀`),
      el('div', { class: 'row', style: { justifyContent: 'center', gap: '10px' } },
        el('button', { class: 'btn y', onclick: () => (this.onRestart ? this.onRestart() : location.reload()) },
          '🔁 مباراة جديدة'),
        el('button', { class: 'btn ghost', onclick: () => this.onExit && this.onExit() }, '🏠 القائمة')));
    this.hud.end(box);
  }
  updEnd(dt) {
    const a = this.clock.elapsedTime * 0.25;
    const c = this.pos.clone(); c.y += 3;
    this.camera.position.set(c.x + Math.cos(a) * 11, c.y + 5, c.z + Math.sin(a) * 11);
    this.camera.lookAt(c);
    this.player.update(dt, { speed: 0, grounded: true, groundY: this.pos.y });
  }

  // ---------------- تنظيف ----------------
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this._raf);
    removeEventListener('resize', this._rs);
    A.engineSound.stop(); A.windSound.stop();
    this.hud?.dispose();
    this.scene?.traverse((o) => {
      if (o.isMesh || o.isLine || o.isPoints) {
        o.geometry?.dispose?.();
        const m = Array.isArray(o.material) ? o.material : [o.material];
        m.forEach((x) => x?.dispose?.());
      }
    });
    this.renderer?.dispose();
    this.node?.remove();
  }
}
