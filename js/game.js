/* =========================================================================
 * game.js — Game orchestration
 * State machine (menu → setup → countdown → playing → round/match over),
 * dynamic camera, arena rendering, HUD, round & match logic, and the main
 * fixed-timestep loop. Ties together physics, stickmen, AI, input, audio,
 * particles and the UI screens.
 * ========================================================================= */
'use strict';

class Game {
  constructor() {
    this.canvas = document.getElementById('stage');
    this.ctx = this.canvas.getContext('2d');
    this.audio = new AudioManager();
    this.fx = new ParticleSystem();
    this.input = new InputManager();
    this.state = 'menu';
    this.time = 0;
    this._acc = 0;
    this._last = 0;
    this.slowmo = 0;         // hitstop / slow-motion frames
    this.shake = 0;

    // Match configuration (defaults)
    this.config = {
      mode: '1p',            // '1p' | '2p'
      difficulty: 'normal',
      p1Weapon: 'sword',
      p2Weapon: 'katana',
      p1Color: '#2b6bff',
      p2Color: '#ff3b57',
      map: 'temple',
      rounds: 3,             // best-of
      timeLimit: 60,         // seconds per round
    };

    this.camera = { x: STAGE_W / 2, y: STAGE_H / 2, scale: 1, tx: STAGE_W / 2, ty: STAGE_H / 2, tscale: 1 };
    this.scores = [0, 0];
    this.round = 0;
    this.roundTime = 0;
    this.countdown = 0;

    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();

    this.buildSetupUI();
    this.bindUI();
    this.input.bindTouch(document);
    this.input.onPause(() => this.togglePause());

    this.showScreen('menu');
    requestAnimationFrame((t) => this.loop(t));
  }

  /* =====================================================================
   * Canvas sizing
   * ===================================================================== */
  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewW = w;
    this.viewH = h;
  }

  /* =====================================================================
   * UI construction & binding
   * ===================================================================== */
  buildSetupUI() {
    // Weapon pickers for both players
    this._buildWeaponPicker('p1WeaponList', 'p1Weapon');
    this._buildWeaponPicker('p2WeaponList', 'p2Weapon');
    this._buildMapPicker();
  }

  _buildWeaponPicker(containerId, cfgKey) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    WEAPONS.forEach((w) => {
      const btn = document.createElement('button');
      btn.className = 'pick weapon-pick';
      btn.dataset.id = w.id;
      const cnv = document.createElement('canvas');
      cnv.width = 96; cnv.height = 52;
      this._drawWeaponIcon(cnv, w);
      const label = document.createElement('span');
      label.textContent = w.name;
      btn.appendChild(cnv); btn.appendChild(label);
      btn.addEventListener('click', () => {
        this.config[cfgKey] = w.id;
        el.querySelectorAll('.pick').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.audio.uiClick();
      });
      if (this.config[cfgKey] === w.id) btn.classList.add('active');
      el.appendChild(btn);
    });
  }

  _drawWeaponIcon(cnv, w) {
    const c = cnv.getContext('2d');
    c.clearRect(0, 0, cnv.width, cnv.height);
    c.save();
    c.translate(14, cnv.height / 2);
    const scale = Math.min(1, 74 / w.reach);
    c.scale(scale, scale);
    // little grip dot
    c.fillStyle = '#cbd5e1';
    c.beginPath(); c.arc(0, 0, 5, 0, Utils.TAU); c.fill();
    w.draw(c, w.reach, 8, false, 0);
    c.restore();
  }

  _buildMapPicker() {
    const el = document.getElementById('mapList');
    if (!el) return;
    el.innerHTML = '';
    MAPS.forEach((m) => {
      const btn = document.createElement('button');
      btn.className = 'pick map-pick';
      btn.dataset.id = m.id;
      const cnv = document.createElement('canvas');
      cnv.width = 128; cnv.height = 72;
      this._drawMapThumb(cnv, m);
      const label = document.createElement('span');
      label.textContent = m.name;
      btn.appendChild(cnv); btn.appendChild(label);
      btn.addEventListener('click', () => {
        this.config.map = m.id;
        el.querySelectorAll('.pick').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.audio.uiClick();
      });
      if (this.config.map === m.id) btn.classList.add('active');
      el.appendChild(btn);
    });
  }

  _drawMapThumb(cnv, m) {
    const c = cnv.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, cnv.height);
    m.sky.forEach((col, i) => g.addColorStop(i / (m.sky.length - 1), col));
    c.fillStyle = g; c.fillRect(0, 0, cnv.width, cnv.height);
    const sx = cnv.width / STAGE_W, sy = cnv.height / STAGE_H;
    c.fillStyle = 'rgba(255,255,255,0.85)';
    m.platforms.forEach((p) => c.fillRect(p.x * sx, p.y * sy, p.w * sx, Math.max(2, p.h * sy)));
    if (m.hazard && m.hazard.type === 'lava') {
      c.fillStyle = 'rgba(255,80,20,0.6)';
      c.fillRect(0, m.hazard.y * sy, cnv.width, cnv.height - m.hazard.y * sy);
    }
  }

  bindUI() {
    const click = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => { this.audio.init(); this.audio.resume(); this.audio.uiClick(); fn(); });
    };

    click('btnPlay1p', () => { this.config.mode = '1p'; this.openSetup(); });
    click('btnPlay2p', () => { this.config.mode = '2p'; this.openSetup(); });
    click('btnHowto', () => this.showScreen('howto'));
    click('btnHowtoBack', () => this.showScreen('menu'));
    click('btnSetupBack', () => this.showScreen('menu'));
    click('btnStart', () => this.startMatch());

    click('btnPauseResume', () => this.togglePause());
    click('btnPauseRestart', () => { this.hideScreen('pause'); this.startMatch(); });
    click('btnPauseMenu', () => { this.state = 'menu'; this.hideScreen('pause'); this.showScreen('menu'); this.audio.stopMusic(); });
    click('btnPauseBtn', () => this.togglePause());

    click('btnResultRematch', () => { this.hideScreen('result'); this.startMatch(); });
    click('btnResultMenu', () => { this.state = 'menu'; this.hideScreen('result'); this.showScreen('menu'); this.audio.stopMusic(); });

    // Segmented option groups (difficulty, rounds)
    this._bindSegment('difficultyGroup', (v) => (this.config.difficulty = v));
    this._bindSegment('roundsGroup', (v) => (this.config.rounds = parseInt(v, 10)));

    // Color swatches
    this._bindColors('p1Colors', 'p1Color');
    this._bindColors('p2Colors', 'p2Color');

    // Audio toggles
    const sfxT = document.getElementById('toggleSfx');
    const musT = document.getElementById('toggleMusic');
    if (sfxT) sfxT.addEventListener('change', () => this.audio.setMuted(!sfxT.checked));
    if (musT) musT.addEventListener('change', () => this.audio.toggleMusic(musT.checked));
  }

  _bindSegment(groupId, fn) {
    const el = document.getElementById(groupId);
    if (!el) return;
    el.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        el.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        fn(b.dataset.value);
        this.audio.uiClick();
      });
    });
  }

  _bindColors(groupId, cfgKey) {
    const el = document.getElementById(groupId);
    if (!el) return;
    el.querySelectorAll('button').forEach((b) => {
      b.style.background = b.dataset.color;
      b.addEventListener('click', () => {
        el.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        this.config[cfgKey] = b.dataset.color;
        this.audio.uiClick();
      });
      if (b.dataset.color === this.config[cfgKey]) b.classList.add('active');
    });
  }

  openSetup() {
    // Toggle 1p-only controls (difficulty) & second-player labels
    const diffWrap = document.getElementById('difficultyWrap');
    if (diffWrap) diffWrap.style.display = this.config.mode === '1p' ? '' : 'none';
    const p2title = document.getElementById('p2Title');
    if (p2title) p2title.textContent = this.config.mode === '1p' ? 'الخصم (كمبيوتر) • CPU' : 'اللاعب 2 • Player 2';
    this.showScreen('setup');
  }

  showScreen(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
    const el = document.getElementById('screen' + name.charAt(0).toUpperCase() + name.slice(1));
    if (el) el.classList.remove('hidden');
    const overlay = document.getElementById('overlay');
    if (overlay) overlay.classList.toggle('active', name !== 'playing');
    // Toggle touch controls, HUD and pause button visibility
    const showMatchUI = name === 'playing';
    document.getElementById('hud').classList.toggle('hidden', !showMatchUI);
    document.getElementById('touchControls').classList.toggle('hidden', !showMatchUI);
    document.getElementById('btnPauseBtn').classList.toggle('hidden', !showMatchUI);
  }

  hideScreen(name) {
    const el = document.getElementById('screen' + name.charAt(0).toUpperCase() + name.slice(1));
    if (el) el.classList.add('hidden');
  }

  /* =====================================================================
   * Match / round lifecycle
   * ===================================================================== */
  startMatch() {
    this.audio.init(); this.audio.resume();
    const musT = document.getElementById('toggleMusic');
    if (!musT || musT.checked) this.audio.toggleMusic(true);
    this.scores = [0, 0];
    this.round = 0;
    document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
    document.getElementById('overlay').classList.remove('active');
    this.startRound();
  }

  startRound() {
    this.round++;
    this.map = getMap(this.config.map);
    this.world = new PhysicsWorld({
      gravity: 0.62, iterations: 7,
      bounds: { x: 0, y: -400, w: STAGE_W, h: STAGE_H + 400 },
    });
    this.world.platforms = this.map.platforms.map((p) => ({ ...p }));
    this.fx.clear();

    const s = this.map.spawns;
    this.f1 = new Stickman(this.world, {
      x: s[0].x, y: s[0].y, id: 0, facing: 1,
      color: this.config.p1Color, outline: this._darken(this.config.p1Color),
      weaponId: this.config.p1Weapon, name: 'P1', fx: this.fx, audio: this.audio,
    });
    this.f2 = new Stickman(this.world, {
      x: s[1].x, y: s[1].y, id: 1, facing: -1,
      color: this.config.p2Color, outline: this._darken(this.config.p2Color),
      weaponId: this.config.p2Weapon, name: this.config.mode === '1p' ? 'CPU' : 'P2',
      fx: this.fx, audio: this.audio,
    });

    this.ai = this.config.mode === '1p' ? new AIController(this.f2, this.f1, this.config.difficulty) : null;

    this.roundTime = this.config.timeLimit;
    this.countdown = 3.0;
    this.state = 'countdown';
    this._countShown = -1;
    this.camera.scale = this.camera.tscale = this._fullStageScale();
    this.camera.x = this.camera.tx = STAGE_W / 2;
    this.camera.y = this.camera.ty = STAGE_H / 2;

    this.updateHUD();
    this.showScreen('playing');
    document.getElementById('roundBanner').textContent = `الجولة ${this.round} • ROUND ${this.round}`;
  }

  endRound(winner) {
    if (this.state === 'roundover') return;
    this.state = 'roundover';
    if (winner === 0) this.scores[0]++;
    else if (winner === 1) this.scores[1]++;
    this.slowmo = 60;
    this.shake = 14;
    this.updateHUD();
    const needed = Math.ceil(this.config.rounds / 2);
    const matchOver = this.scores[0] >= needed || this.scores[1] >= needed;
    setTimeout(() => {
      if (matchOver) this.endMatch();
      else if (this.state === 'roundover') this.startRound();
    }, 2200);
  }

  endMatch() {
    this.state = 'matchover';
    const p1Won = this.scores[0] > this.scores[1];
    const title = document.getElementById('resultTitle');
    const sub = document.getElementById('resultSub');
    if (this.config.mode === '1p') {
      title.textContent = p1Won ? 'انتصار! • VICTORY' : 'هزيمة • DEFEAT';
      title.className = 'result-title ' + (p1Won ? 'win' : 'lose');
    } else {
      title.textContent = p1Won ? 'فاز اللاعب 1 • PLAYER 1 WINS' : 'فاز اللاعب 2 • PLAYER 2 WINS';
      title.className = 'result-title ' + (p1Won ? 'win' : 'lose2');
    }
    sub.textContent = `النتيجة ${this.scores[0]} - ${this.scores[1]}`;
    if (p1Won) { this.audio.win(); this.fx.confetti(this.viewW / 2, this.viewH * 0.3); }
    else this.config.mode === '1p' ? this.audio.lose() : this.audio.win();
    document.getElementById('screenResult').classList.remove('hidden');
    document.getElementById('overlay').classList.add('active');
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      document.getElementById('screenPause').classList.remove('hidden');
      document.getElementById('overlay').classList.add('active');
      this.audio.uiClick();
    } else if (this.state === 'paused') {
      this.state = 'playing';
      document.getElementById('screenPause').classList.add('hidden');
      document.getElementById('overlay').classList.remove('active');
    }
  }

  /* =====================================================================
   * Update
   * ===================================================================== */
  update(dt) {
    this.time += dt;

    if (this.state === 'countdown') {
      this.countdown -= dt / 60;
      const n = Math.ceil(this.countdown);
      if (n !== this._countShown && n > 0) {
        this._countShown = n;
        this.audio.countdown(false);
      }
      this.updateCamera();
      // let bodies settle physically during countdown
      // control/pose FIRST, then integrate + collide so collision has final say
      this.f1.update(this.f2);
      this.f2.update(this.f1);
      this.world.step(1);
      if (this.countdown <= 0) {
        this.state = 'playing';
        this.audio.countdown(true);
      }
      return;
    }

    if (this.state !== 'playing' && this.state !== 'roundover') return;

    // slow-motion after a KO
    let steps = 1;
    if (this.slowmo > 0) { this.slowmo--; if (this.slowmo % 3 !== 0) { this.updateCamera(); this.fx.update(); return; } }

    if (this.state === 'playing') {
      // Controls
      this.f1.setControl(this.input.p1());
      if (this.config.mode === '2p') this.f2.setControl(this.input.p2());
      else this.ai.update();

      // Round timer
      this.roundTime -= dt / 60;
      if (this.roundTime <= 0) {
        this.roundTime = 0;
        this._timeoutResolve();
      }
    }

    // Fighters control/pose FIRST, then integrate + collide (collision wins,
    // so limbs can never be left buried in / below a platform).
    this.f1.update(this.f2);
    this.f2.update(this.f1);
    this.world.step(1);

    // Combat resolution (both directions)
    if (this.state === 'playing') {
      const prevH1 = this.f1.health, prevH2 = this.f2.health;
      this.f1.resolveHitsOn(this.f2);
      this.f2.resolveHitsOn(this.f1);
      const maxDelta = Math.max(prevH1 - this.f1.health, prevH2 - this.f2.health);
      if (maxDelta > 0) {
        this.shake = Math.max(this.shake, 4 + maxDelta * 0.5);
        if (maxDelta > 9) this.slowmo = Math.max(this.slowmo, 5); // brief hitstop on heavy blows
      }

      // Hazards / falling out
      this._checkHazards(this.f1);
      this._checkHazards(this.f2);

      // Win check
      if (!this.f1.alive || !this.f2.alive) {
        const winner = !this.f1.alive && !this.f2.alive ? -1 : (this.f1.alive ? 0 : 1);
        this.slowmo = 50;
        this.shake = 16;
        this.endRound(winner);
      }
    }

    this.fx.update();
    this.updateCamera();
    this.updateHUD();
    if (this.shake > 0) this.shake *= 0.88;
  }

  _timeoutResolve() {
    if (this.f1.health === this.f2.health) { this.endRound(-1); }
    else this.endRound(this.f1.health > this.f2.health ? 0 : 1);
  }

  _checkHazards(f) {
    if (!f.alive) return;
    const haz = this.map.hazard;
    // fell below the stage
    if (f.pelvis.y > STAGE_H + 260) { f.fallOut(); return; }
    if (haz && haz.type === 'lava') {
      // touching the lava surface deals damage over time
      const feetY = Math.max(f.footA.y, f.footB.y);
      if (feetY > haz.y - 6) {
        f.health = Utils.clamp(f.health - (haz.dps || 0.5), 0, f.maxHealth);
        f.hitFlash = 4;
        if (this.time % 8 < 1) this.fx.blood(f.footA.x, haz.y, -Math.PI / 2, 4, '#ff7a1f');
        if (f.health <= 0) f.die();
      }
    }
  }

  /* =====================================================================
   * Camera
   * ===================================================================== */
  _fullStageScale() {
    return Math.max(this.viewW / STAGE_W, this.viewH / STAGE_H);
  }

  updateCamera() {
    const a = this.f1, b = this.f2;
    const minX = Math.min(a.centerX, b.centerX), maxX = Math.max(a.centerX, b.centerX);
    const minY = Math.min(a.head.y, b.head.y), maxY = Math.max(a.footA.y, b.footA.y);
    const pad = 260;
    let vw = (maxX - minX) + pad * 2;
    let vh = (maxY - minY) + pad * 2;
    const aspect = this.viewW / this.viewH;
    if (vw / vh < aspect) vw = vh * aspect; else vh = vw / aspect;
    let scale = this.viewW / vw;
    const minScale = this._fullStageScale() * 0.98;
    const maxScale = Math.max(minScale * 1.9, this.viewH / 620);
    scale = Utils.clamp(scale, minScale, maxScale);
    let cx = (minX + maxX) / 2;
    let cy = (minY + maxY) / 2;
    // clamp camera so we mostly stay within the stage
    const halfW = this.viewW / scale / 2, halfH = this.viewH / scale / 2;
    cx = Utils.clamp(cx, halfW, STAGE_W - halfW);
    cy = Utils.clamp(cy, halfH, STAGE_H - halfH + 120);
    if (STAGE_W < halfW * 2) cx = STAGE_W / 2;
    if (STAGE_H < halfH * 2) cy = STAGE_H / 2;
    // smooth
    this.camera.tx = cx; this.camera.ty = cy; this.camera.tscale = scale;
    const sm = 0.1;
    this.camera.x += (this.camera.tx - this.camera.x) * sm;
    this.camera.y += (this.camera.ty - this.camera.y) * sm;
    this.camera.scale += (this.camera.tscale - this.camera.scale) * sm;
  }

  applyCamera(ctx) {
    let sx = 0, sy = 0;
    if (this.shake > 0.5) {
      sx = Utils.rand(-this.shake, this.shake);
      sy = Utils.rand(-this.shake, this.shake);
    }
    ctx.translate(this.viewW / 2 + sx, this.viewH / 2 + sy);
    ctx.scale(this.camera.scale, this.camera.scale);
    ctx.translate(-this.camera.x, -this.camera.y);
  }

  /* =====================================================================
   * Render
   * ===================================================================== */
  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.viewW, this.viewH);
    if (!this.map) { this._renderMenuBg(ctx); return; }

    ctx.save();
    this.applyCamera(ctx);

    this.renderArena(ctx);
    // fighters (draw the losing/dead one behind)
    const order = [this.f1, this.f2].sort((p, q) => (p.alive === q.alive ? 0 : p.alive ? 1 : -1));
    order.forEach((f) => f.render(ctx, this.time));
    this.fx.render(ctx);

    ctx.restore();

    // world-space UI drawn in screen space
    this.renderOverlayText(ctx);
  }

  renderArena(ctx) {
    const m = this.map;
    // sky gradient
    const g = ctx.createLinearGradient(0, 0, 0, STAGE_H);
    m.sky.forEach((c, i) => g.addColorStop(i / (m.sky.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(-200, -400, STAGE_W + 400, STAGE_H + 600);

    // background portal / theme flourish
    this._renderThemeBg(ctx, m);

    // hazards
    if (m.hazard && m.hazard.type === 'lava') this._renderLava(ctx, m.hazard);

    // platforms
    for (const p of m.platforms) this._renderPlatform(ctx, p, m);
  }

  _renderThemeBg(ctx, m) {
    ctx.save();
    // glowing portal ring centered on stage
    const cx = STAGE_W / 2, cy = STAGE_H * 0.42;
    const r = 230;
    const grad = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.82, this._hexA(m.accent, 0.0));
    grad.addColorStop(0.92, this._hexA(m.accent, 0.55));
    grad.addColorStop(1, this._hexA(m.accent, 0));
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Utils.TAU); ctx.fill();
    ctx.strokeStyle = this._hexA(m.accent, 0.5);
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Utils.TAU); ctx.stroke();

    // floating theme motes
    ctx.fillStyle = this._hexA(m.accent, 0.25);
    for (let i = 0; i < 26; i++) {
      const x = (i * 137.5 + this.time * (0.3 + (i % 3) * 0.2)) % STAGE_W;
      const y = (i * 83.1 + Math.sin(this.time * 0.02 + i) * 20) % STAGE_H;
      ctx.beginPath(); ctx.arc(x, y, 2 + (i % 3), 0, Utils.TAU); ctx.fill();
    }
    ctx.restore();
  }

  _renderLava(ctx, haz) {
    const g = ctx.createLinearGradient(0, haz.y, 0, STAGE_H + 200);
    g.addColorStop(0, '#ffb347'); g.addColorStop(0.3, '#ff5a1f'); g.addColorStop(1, '#7a1500');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-200, haz.y);
    for (let x = -200; x <= STAGE_W + 200; x += 40) {
      ctx.lineTo(x, haz.y + Math.sin(x * 0.02 + this.time * 0.05) * 8);
    }
    ctx.lineTo(STAGE_W + 200, STAGE_H + 300);
    ctx.lineTo(-200, STAGE_H + 300);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,220,120,0.5)';
    for (let i = 0; i < 8; i++) {
      const x = (i * 210 + this.time * 0.6) % STAGE_W;
      const y = haz.y - (Math.sin(this.time * 0.03 + i) * 30 + 20);
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Utils.TAU); ctx.fill();
    }
  }

  _renderPlatform(ctx, p, m) {
    ctx.save();
    // body
    const g = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
    g.addColorStop(0, this._shade(m.accent, -0.1));
    g.addColorStop(1, this._shade(m.accent, -0.55));
    ctx.fillStyle = g;
    this._roundRect(ctx, p.x, p.y, p.w, p.h, 8);
    ctx.fill();
    // top highlight
    ctx.fillStyle = this._shade(m.accent, 0.25);
    this._roundRect(ctx, p.x, p.y, p.w, Math.min(10, p.h * 0.4), 8);
    ctx.fill();
    ctx.restore();
  }

  renderOverlayText(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    if (this.state === 'countdown') {
      const n = Math.ceil(this.countdown);
      const frac = this.countdown - Math.floor(this.countdown);
      const scale = 1 + (1 - frac) * 0.6;
      ctx.globalAlpha = Utils.clamp(frac + 0.2, 0, 1);
      ctx.font = `900 ${120 * scale}px Arial`;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 8;
      const txt = n > 0 ? n.toString() : 'اقتل! FIGHT!';
      ctx.strokeText(txt, this.viewW / 2, this.viewH / 2);
      ctx.fillText(txt, this.viewW / 2, this.viewH / 2);
    }
    if (this.state === 'roundover') {
      ctx.globalAlpha = 0.9;
      ctx.font = '900 64px Arial';
      const w = !this.f1.alive && !this.f2.alive ? 'تعادل • DRAW'
        : (this.f1.alive ? (this.config.mode === '1p' ? 'أحسنت! • K.O.' : 'اللاعب 1 • P1 K.O.')
          : (this.config.mode === '1p' ? 'K.O.!' : 'اللاعب 2 • P2 K.O.'));
      ctx.fillStyle = '#ffe36e';
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 8;
      ctx.strokeText(w, this.viewW / 2, this.viewH * 0.32);
      ctx.fillText(w, this.viewW / 2, this.viewH * 0.32);
    }
    ctx.restore();
  }

  _renderMenuBg(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, this.viewH);
    g.addColorStop(0, '#1a1030'); g.addColorStop(1, '#3a1b52');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
  }

  /* =====================================================================
   * HUD
   * ===================================================================== */
  updateHUD() {
    const setW = (id, v) => { const e = document.getElementById(id); if (e) e.style.width = Utils.clamp(v, 0, 100) + '%'; };
    setW('p1HealthFill', (this.f1.health / this.f1.maxHealth) * 100);
    setW('p2HealthFill', (this.f2.health / this.f2.maxHealth) * 100);
    const t = document.getElementById('matchTimer');
    if (t) t.textContent = Math.ceil(this.roundTime);
    this._renderPips('p1Pips', this.scores[0]);
    this._renderPips('p2Pips', this.scores[1]);
    const n1 = document.getElementById('p1Name'), n2 = document.getElementById('p2Name');
    if (n1) n1.textContent = 'لاعب 1';
    if (n2) n2.textContent = this.config.mode === '1p' ? 'كمبيوتر' : 'لاعب 2';
    const w1 = document.getElementById('p1WeaponName'), w2 = document.getElementById('p2WeaponName');
    if (w1) w1.textContent = getWeapon(this.config.p1Weapon).name.split('•')[0].trim();
    if (w2) w2.textContent = getWeapon(this.config.p2Weapon).name.split('•')[0].trim();
  }

  _renderPips(id, score) {
    const el = document.getElementById(id);
    if (!el) return;
    const needed = Math.ceil(this.config.rounds / 2);
    if (el.children.length !== needed) {
      el.innerHTML = '';
      for (let i = 0; i < needed; i++) { const d = document.createElement('span'); d.className = 'pip'; el.appendChild(d); }
    }
    [...el.children].forEach((c, i) => c.classList.toggle('filled', i < score));
  }

  /* =====================================================================
   * Main loop (fixed timestep physics, variable render)
   * ===================================================================== */
  loop(t) {
    const dtMs = Math.min(50, t - (this._last || t));
    this._last = t;
    this._acc += dtMs;
    const stepMs = 1000 / 60;
    let iterations = 0;
    while (this._acc >= stepMs && iterations < 5) {
      if (this.state !== 'paused' && this.state !== 'menu' && this.state !== 'setup' &&
          this.state !== 'matchover' && this.state !== 'howto') {
        this.update(1);
      }
      this._acc -= stepMs;
      iterations++;
    }
    this.render();
    requestAnimationFrame((tt) => this.loop(tt));
  }

  /* =====================================================================
   * Small helpers
   * ===================================================================== */
  _darken(hex) { return this._shade(hex, -0.4); }

  _shade(hex, amt) {
    const c = this._hex2rgb(hex);
    const f = amt < 0 ? 0 : 255;
    const p = Math.abs(amt);
    const r = Math.round((f - c.r) * p) + c.r;
    const g = Math.round((f - c.g) * p) + c.g;
    const b = Math.round((f - c.b) * p) + c.b;
    return `rgb(${r},${g},${b})`;
  }

  _hexA(hex, a) {
    const c = this._hex2rgb(hex);
    return `rgba(${c.r},${c.g},${c.b},${a})`;
  }

  _hex2rgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((x) => x + x).join('');
    const n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  _roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

window.addEventListener('DOMContentLoaded', () => { window.GAME = new Game(); });
