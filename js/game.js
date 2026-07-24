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
    this._lastWinner = null;

    // Online multiplayer
    this.net = new NetworkManager();
    this.online = null;               // { role:'host'|'guest', remoteInput, lastSnap }
    this.onlineLoadout = { color: '#2b6bff', weaponId: 'sword' };
    this.remoteLoadout = { color: '#ff3b57', weaponId: 'katana' };
    this._wireNet();

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
    click('btnPlayOnline', () => this.openOnline());
    click('btnHowto', () => this.showScreen('howto'));
    click('btnHowtoBack', () => this.showScreen('menu'));
    click('btnSetupBack', () => this.showScreen('menu'));
    click('btnStart', () => this.startMatch());

    // Online screen
    click('btnNetCreate', () => this.netCreate());
    click('btnNetJoin', () => this.netJoin());
    click('btnNetQuick', () => this.netQuick());
    click('btnNetStart', () => this.netStart());
    click('btnNetBack', () => { this.net.leave(); this.online = null; this.showScreen('menu'); });

    click('btnPauseResume', () => this.togglePause());
    click('btnPauseRestart', () => { this.hideScreen('pause'); this.startMatch(); });
    click('btnPauseMenu', () => { this.state = 'menu'; this.hideScreen('pause'); this.showScreen('menu'); this.audio.stopMusic(); });
    click('btnPauseBtn', () => this.togglePause());

    click('btnResultRematch', () => this._onRematch());
    click('btnResultMenu', () => {
      if (this.online) { this.net.leave(); this.online = null; }
      this.state = 'menu'; this.hideScreen('result'); this.showScreen('menu'); this.audio.stopMusic();
    });

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

    // mark which fighter the human on this device controls (for the "أنت" tag)
    if (this.online) {
      this.f1.isLocal = this.online.role === 'host';
      this.f2.isLocal = this.online.role === 'guest';
    } else {
      this.f1.isLocal = this.config.mode === '1p';
      this.f2.isLocal = false;
    }

    // pickups (health / weapon crates)
    this.pickups = [];
    this._pickupTimer = 360;

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
    this._lastWinner = winner;
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

    // Online: host announces the result; both show their own perspective
    if (this.online) {
      if (this.online.role === 'host') {
        this.net.sendMeta({ type: 'matchend', scores: this.scores.slice(), p1Won });
      }
      this._showOnlineResult({ scores: this.scores.slice(), p1Won });
      return;
    }

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
    if (this.online) return; // no pausing in online matches
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
   * Online multiplayer
   * ===================================================================== */
  _wireNet() {
    this.net.on('peerjoin', () => this._onPeerJoin());
    this.net.on('peerleave', () => this._onPeerLeave());
    this.net.on('input', (d) => { if (this.online && this.online.role === 'host') this.online.remoteInput = d; });
    this.net.on('state', (d) => { if (this.online && this.online.role === 'guest') this.online.lastSnap = d; });
    this.net.on('meta', (d) => this._onMeta(d));
  }

  _setNetStatus(msg, showStart = false) {
    const s = document.getElementById('netStatus');
    if (s) s.textContent = msg;
    const btn = document.getElementById('btnNetStart');
    if (btn) btn.style.display = showStart ? '' : 'none';
  }

  openOnline() {
    // sync loadout from current config
    this.onlineLoadout = { color: this.config.p1Color, weaponId: this.config.p1Weapon };
    this._buildOnlineLoadout();
    const codeBox = document.getElementById('netCodeBox');
    if (codeBox) codeBox.textContent = '----';
    this._setNetStatus('اختر لونك وسلاحك، ثم أنشئ غرفة أو انضم.', false);
    this.showScreen('online');
  }

  _buildOnlineLoadout() {
    // colour swatches
    const colEl = document.getElementById('netColors');
    if (colEl && !colEl._built) {
      ['#2b6bff', '#ff3b57', '#22c55e', '#f59e0b', '#a855f7', '#14b8a6'].forEach((c) => {
        const b = document.createElement('button'); b.style.background = c; b.dataset.color = c;
        b.addEventListener('click', () => {
          this.onlineLoadout.color = c;
          colEl.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
          b.classList.add('active'); this.audio.uiClick();
        });
        colEl.appendChild(b);
      });
      colEl._built = true;
    }
    if (colEl) colEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.color === this.onlineLoadout.color));
    // weapon list
    const wEl = document.getElementById('netWeapons');
    if (wEl && !wEl._built) {
      WEAPONS.forEach((w) => {
        const btn = document.createElement('button'); btn.className = 'pick'; btn.dataset.id = w.id;
        const cnv = document.createElement('canvas'); cnv.width = 88; cnv.height = 46;
        this._drawWeaponIcon(cnv, w);
        const label = document.createElement('span'); label.textContent = w.name.split('•')[0].trim();
        btn.appendChild(cnv); btn.appendChild(label);
        btn.addEventListener('click', () => {
          this.onlineLoadout.weaponId = w.id;
          wEl.querySelectorAll('.pick').forEach((x) => x.classList.remove('active'));
          btn.classList.add('active'); this.audio.uiClick();
        });
        wEl.appendChild(btn);
      });
      wEl._built = true;
    }
    if (wEl) wEl.querySelectorAll('.pick').forEach((b) => b.classList.toggle('active', b.dataset.id === this.onlineLoadout.weaponId));
  }

  async netCreate() {
    this.audio.init(); this.audio.resume();
    this._setNetStatus('جارٍ إنشاء الغرفة...', false);
    try {
      const code = await this.net.host();
      const codeBox = document.getElementById('netCodeBox');
      if (codeBox) codeBox.textContent = code;
      this._setNetStatus('شارك الرقم مع صديقك وانتظر انضمامه...', false);
    } catch (e) {
      this._setNetStatus('تعذّر الاتصال بخادم المطابقة. تأكد من الإنترنت وحاول مجددًا.', false);
    }
  }

  async netJoin() {
    this.audio.init(); this.audio.resume();
    const inp = document.getElementById('netCodeInput');
    const code = inp ? inp.value.trim() : '';
    if (!/^\d{3,6}$/.test(code)) { this._setNetStatus('أدخل رقم غرفة صحيحًا (٣-٦ أرقام).', false); return; }
    this._setNetStatus('جارٍ الاتصال بالغرفة ' + code + '...', false);
    try {
      await this.net.join(code);
      // if no peer within a while, hint
      setTimeout(() => { if (!this.net.connected) this._setNetStatus('لم يتم العثور على الغرفة بعد... تأكد من الرقم.', false); }, 6000);
    } catch (e) {
      this._setNetStatus('تعذّر الاتصال. تأكد من الإنترنت.', false);
    }
  }

  async netQuick() {
    this.audio.init(); this.audio.resume();
    this._setNetStatus('جارٍ البحث عن لاعب متصل...', false);
    try {
      await this.net.quick();
      setTimeout(() => { if (!this.net.connected) this._setNetStatus('لا يوجد لاعبون الآن... انتظر أو ادعُ صديقًا برقم غرفة.', false); }, 8000);
    } catch (e) {
      this._setNetStatus('تعذّر الاتصال بخادم المطابقة.', false);
    }
  }

  _onPeerJoin() {
    // exchange loadout
    this.net.sendMeta({ type: 'hello', loadout: this.onlineLoadout });
    if (this.net.role === 'host') {
      this._setNetStatus('انضم صديقك! اضغط "ابدأ" لبدء المباراة.', true);
    } else if (this.net.role === 'guest') {
      this._setNetStatus('تم الاتصال! في انتظار أن يبدأ المضيف...', false);
    } else {
      // quick match: role resolves shortly
      setTimeout(() => {
        if (this.net.role === 'host') this._setNetStatus('تم العثور على خصم! اضغط "ابدأ".', true);
        else this._setNetStatus('تم العثور على خصم! في انتظار المضيف...', false);
      }, 300);
    }
    this.audio.pickup();
  }

  _onPeerLeave() {
    if (this.online) {
      this._setNetStatus('انقطع اتصال الخصم.', false);
      this.endMatchOnlineDisconnect();
    } else {
      this._setNetStatus('غادر الخصم الغرفة.', false);
    }
  }

  _onMeta(d) {
    if (!d || !d.type) return;
    if (d.type === 'hello') {
      this.remoteLoadout = d.loadout || this.remoteLoadout;
    } else if (d.type === 'start') {
      this._startOnlineMatch('guest', d);
    } else if (d.type === 'matchend') {
      this._showOnlineResult(d);
    } else if (d.type === 'rematch') {
      // guest requested a rematch → host restarts
      if (this.net.role === 'host' && this.net.connected) this.netStart();
    }
  }

  _onRematch() {
    if (this.online) {
      if (this.online.role === 'host') {
        this.hideScreen('result'); this.netStart();
      } else {
        // ask the host to restart
        this.net.sendMeta({ type: 'rematch' });
        const sub = document.getElementById('resultSub');
        if (sub) sub.textContent = 'بانتظار موافقة المضيف على الإعادة...';
      }
      return;
    }
    this.hideScreen('result'); this.startMatch();
  }

  netStart() {
    if (this.net.role !== 'host') return;
    const startData = {
      type: 'start',
      map: this.config.map,
      rounds: this.config.rounds,
      host: this.onlineLoadout,
      guest: this.remoteLoadout,
    };
    this.net.sendMeta(startData);
    this._startOnlineMatch('host', startData);
  }

  _startOnlineMatch(role, data) {
    const host = data.host, guest = data.guest;
    this.config.mode = 'online';
    this.config.map = data.map || 'temple';
    this.config.rounds = data.rounds || 3;
    this.config.p1Color = host.color; this.config.p1Weapon = host.weaponId;
    this.config.p2Color = guest.color; this.config.p2Weapon = guest.weaponId;
    this.online = { role, remoteInput: {}, lastSnap: null };
    document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
    document.getElementById('overlay').classList.remove('active');
    this.audio.init(); this.audio.resume();
    const musT = document.getElementById('toggleMusic');
    if (!musT || musT.checked) this.audio.toggleMusic(true);
    this.scores = [0, 0];
    this.round = 0;
    this.startRound();
  }

  endMatchOnlineDisconnect() {
    if (!this.online) return;
    this.state = 'matchover';
    const title = document.getElementById('resultTitle');
    const sub = document.getElementById('resultSub');
    if (title) { title.textContent = 'انقطع الاتصال • DISCONNECTED'; title.className = 'result-title lose'; }
    if (sub) sub.textContent = 'غادر الخصم';
    document.getElementById('screenResult').classList.remove('hidden');
    document.getElementById('overlay').classList.add('active');
    this.online = null;
    this.net.leave();
  }

  _showOnlineResult(d) {
    this.state = 'matchover';
    const iAmHost = this.online && this.online.role === 'host';
    const iWon = iAmHost ? d.p1Won : !d.p1Won;
    const title = document.getElementById('resultTitle');
    const sub = document.getElementById('resultSub');
    if (title) {
      title.textContent = iWon ? 'انتصار! • VICTORY' : 'هزيمة • DEFEAT';
      title.className = 'result-title ' + (iWon ? 'win' : 'lose');
    }
    if (sub) sub.textContent = `النتيجة ${d.scores[0]} - ${d.scores[1]}`;
    if (iWon) { this.audio.win(); this.fx.confetti(this.viewW / 2, this.viewH * 0.3); } else this.audio.lose();
    document.getElementById('screenResult').classList.remove('hidden');
    document.getElementById('overlay').classList.add('active');
  }

  /* ---- Snapshot pack (host) / apply (guest) ---- */
  _packSnapshot() {
    const packF = (f) => ({
      p: f.all.flatMap((pt) => [Math.round(pt.x), Math.round(pt.y)]),
      h: Math.round(f.health), sp: +f.special.toFixed(2), al: f.alive ? 1 : 0,
      fc: f.facing, at: f.attackTimer, rg: f.rageActive ? 1 : 0, wp: f.weapon.id,
    });
    return {
      st: this.state === 'countdown' ? 0 : (this.state === 'roundover' ? 2 : 1),
      cd: +this.countdown.toFixed(2), rt: Math.round(this.roundTime),
      sc: this.scores.slice(), rnd: this.round,
      f1: packF(this.f1), f2: packF(this.f2),
      pk: (this.pickups || []).map((p) => [Math.round(p.x), Math.round(p.y), p.type === 'health' ? 0 : 1, p.weaponId || '']),
    };
  }

  _applySnapshot(s) {
    if (!this.f1 || !this.f2) return;
    const applyF = (f, d) => {
      for (let i = 0; i < f.all.length; i++) {
        const pt = f.all[i];
        pt.px = pt.x; pt.py = pt.y;
        pt.x = d.p[i * 2]; pt.y = d.p[i * 2 + 1];
      }
      f.health = d.h; f.special = d.sp; f.alive = !!d.al; f.facing = d.fc;
      f.attackTimer = d.at; f.rageActive = !!d.rg;
      if (d.wp && f.weapon.id !== d.wp) f.weapon = getWeapon(d.wp);
    };
    applyF(this.f1, s.f1); applyF(this.f2, s.f2);
    this.scores = s.sc; this.round = s.rnd; this.roundTime = s.rt;
    this.state = s.st === 0 ? 'countdown' : (s.st === 2 ? 'roundover' : 'playing');
    this.countdown = s.cd;
    this.pickups = s.pk.map((a) => ({ x: a[0], y: a[1], type: a[2] === 0 ? 'health' : 'weapon', weaponId: a[3], bob: this.time * 0.06, life: 999 }));
  }

  _updateGuest(dt) {
    this.time += 0; // time already advanced by caller
    if (this.state === 'playing' || this.state === 'countdown') {
      this.net.sendInput(this.input.p1());
    }
    if (this.online.lastSnap) this._applySnapshot(this.online.lastSnap);
    this.fx.update();
    this.updateCamera();
    this.updateHUD();
    if (this.shake > 0) this.shake *= 0.88;
  }

  /* =====================================================================
   * Update
   * ===================================================================== */
  update(dt) {
    this.time += dt;

    // Online GUEST: no local simulation — just send input & apply snapshots
    if (this.online && this.online.role === 'guest') { this._updateGuest(dt); return; }

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
      if (this.online && this.online.role === 'host') this.net.sendState(this._packSnapshot());
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
      if (this.online && this.online.role === 'host') this.f2.setControl(this.online.remoteInput || {});
      else if (this.config.mode === '2p') this.f2.setControl(this.input.p2());
      else if (this.ai) this.ai.update();

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

      // Pickups
      this._updatePickups();

      // Win check
      if (!this.f1.alive || !this.f2.alive) {
        const winner = !this.f1.alive && !this.f2.alive ? -1 : (this.f1.alive ? 0 : 1);
        this.slowmo = 50;
        this.shake = 16;
        this.endRound(winner);
      }
    }

    // Host streams the authoritative world to the guest
    if (this.online && this.online.role === 'host') this.net.sendState(this._packSnapshot());

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
   * Pickups (health / weapon crates)
   * ===================================================================== */
  _updatePickups() {
    this._pickupTimer--;
    if (this._pickupTimer <= 0 && this.pickups.length < 2) {
      this._spawnPickup();
      this._pickupTimer = Utils.randInt(480, 780); // 8–13s
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.bob += 0.06; p.life--;
      if (p.life <= 0) { this.pickups.splice(i, 1); continue; }
      for (const f of [this.f1, this.f2]) {
        if (!f.alive) continue;
        if (Utils.dist(p.x, p.y, f.centerX, f.centerY) < 42) {
          this._collectPickup(p, f);
          this.pickups.splice(i, 1);
          break;
        }
      }
    }
  }

  _spawnPickup() {
    const plat = Utils.pick(this.map.platforms);
    const x = plat.x + Utils.rand(50, Math.max(60, plat.w - 50));
    const y = plat.y - 40;
    const type = Math.random() < 0.55 ? 'health' : 'weapon';
    const weaponId = type === 'weapon' ? Utils.pick(WEAPONS).id : null;
    this.pickups.push({ x, y, type, weaponId, bob: Math.random() * Utils.TAU, life: 780 });
    if (this.audio) this.audio.uiHover();
    this.fx.shock(x, y, type === 'health' ? '#6bff8e' : '#ffd23f');
  }

  _collectPickup(p, f) {
    if (this.audio) this.audio.pickup();
    if (p.type === 'health') {
      const before = f.health;
      f.health = Utils.clamp(f.health + 35, 0, f.maxHealth);
      this.fx.floatText(f.centerX, f.centerY - 44, '+' + Math.round(f.health - before), '#6bff8e', 28);
      for (let k = 0; k < 12; k++) this.fx.spawn({
        x: f.centerX, y: f.centerY, vx: Utils.rand(-3, 3), vy: Utils.rand(-6, -1),
        life: 34, maxLife: 34, size: 5, color: '#6bff8e', gravity: 0.2, glow: true,
      });
    } else {
      f.weapon = getWeapon(p.weaponId);
      this.fx.sparks(f.centerX, f.centerY, 16);
      this.fx.floatText(f.centerX, f.centerY - 44, getWeapon(p.weaponId).name.split('•')[0].trim(), '#ffe36e', 24);
    }
  }

  _renderPickups(ctx) {
    if (!this.pickups) return;
    for (const p of this.pickups) {
      const y = p.y + Math.sin(p.bob) * 6;
      const col = p.type === 'health' ? '#6bff8e' : '#ffd23f';
      ctx.save();
      // floating ring
      ctx.strokeStyle = this._hexA(col, 0.5); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, y, 23, 0, Utils.TAU); ctx.stroke();
      ctx.shadowBlur = 16; ctx.shadowColor = col;
      if (p.type === 'health') {
        ctx.fillStyle = '#12321f';
        this._roundRect(ctx, p.x - 16, y - 16, 32, 32, 9); ctx.fill();
        ctx.fillStyle = col;
        ctx.fillRect(p.x - 3.5, y - 10, 7, 20); ctx.fillRect(p.x - 10, y - 3.5, 20, 7);
      } else {
        ctx.fillStyle = '#3a2e10';
        this._roundRect(ctx, p.x - 17, y - 17, 34, 34, 7); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.save();
        const w = getWeapon(p.weaponId);
        const s = Math.min(0.85, 26 / w.reach);
        ctx.translate(p.x - 11, y); ctx.scale(s, s);
        w.draw(ctx, w.reach, 6, false, this.time * 0.06);
        ctx.restore();
      }
      ctx.restore();
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
    this._renderPickups(ctx);
    // fighters (draw the losing/dead one behind)
    const order = [this.f1, this.f2].sort((p, q) => (p.alive === q.alive ? 0 : p.alive ? 1 : -1));
    order.forEach((f) => f.render(ctx, this.time));
    this.fx.render(ctx);

    ctx.restore();

    // screen-space vignette for depth
    this._renderVignette(ctx);

    // world-space UI drawn in screen space
    this.renderOverlayText(ctx);
  }

  _renderVignette(ctx) {
    const g = ctx.createRadialGradient(
      this.viewW / 2, this.viewH / 2, this.viewH * 0.35,
      this.viewW / 2, this.viewH / 2, this.viewH * 0.85);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
  }

  renderArena(ctx) {
    const m = this.map;
    // sky gradient (extends well beyond stage for camera movement)
    const g = ctx.createLinearGradient(0, -200, 0, STAGE_H);
    m.sky.forEach((c, i) => g.addColorStop(i / (m.sky.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(-400, -600, STAGE_W + 800, STAGE_H + 800);

    // parallax offset from camera
    const par = this.camera.x - STAGE_W / 2;

    // themed background decorations (far → near)
    this._renderDecor(ctx, m, par);

    // hazards
    if (m.hazard && m.hazard.type === 'lava') this._renderLava(ctx, m.hazard);

    // platforms
    for (const p of m.platforms) this._renderPlatform(ctx, p, m);

    // soft ground fog / vignette bottom
    const fog = ctx.createLinearGradient(0, STAGE_H - 200, 0, STAGE_H + 200);
    fog.addColorStop(0, 'rgba(0,0,0,0)');
    fog.addColorStop(1, this._hexA(this._shade(m.sky[0], -0.5), 0.6));
    ctx.fillStyle = fog;
    ctx.fillRect(-400, STAGE_H - 200, STAGE_W + 800, 500);
  }

  /* Deterministic PRNG so decorations don't flicker frame-to-frame */
  _rng(seed) {
    let t = seed + 0x6d2b79f5;
    return () => {
      t += 0x6d2b79f5;
      let x = Math.imul(t ^ (t >>> 15), 1 | t);
      x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  _renderDecor(ctx, m, par) {
    const d = m.decor || {};
    const T = this.time;
    const P = (base, depth) => base + par * (1 - depth); // parallax x

    // ---- Sky bodies ----
    if (d.sun) {
      const sx = P(1250, 0.15), sy = 170;
      const sg = ctx.createRadialGradient(sx, sy, 20, sx, sy, 160);
      sg.addColorStop(0, 'rgba(255,240,190,0.95)');
      sg.addColorStop(0.3, this._hexA(m.accent, 0.5));
      sg.addColorStop(1, this._hexA(m.accent, 0));
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, 160, 0, Utils.TAU); ctx.fill();
      ctx.fillStyle = '#fff6d8'; ctx.beginPath(); ctx.arc(sx, sy, 52, 0, Utils.TAU); ctx.fill();
    }
    if (d.moon) {
      const mx = P(1240, 0.15), my = 150;
      const mg = ctx.createRadialGradient(mx, my, 10, mx, my, 120);
      mg.addColorStop(0, 'rgba(230,240,255,0.6)'); mg.addColorStop(1, 'rgba(230,240,255,0)');
      ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, 120, 0, Utils.TAU); ctx.fill();
      ctx.fillStyle = '#e9eefc'; ctx.beginPath(); ctx.arc(mx, my, 48, 0, Utils.TAU); ctx.fill();
      ctx.fillStyle = 'rgba(180,195,225,0.5)';
      ctx.beginPath(); ctx.arc(mx - 14, my - 10, 8, 0, Utils.TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(mx + 16, my + 8, 6, 0, Utils.TAU); ctx.fill();
    }
    if (d.stars) {
      const rng = this._rng(7);
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 90; i++) {
        const x = P(rng() * (STAGE_W + 200) - 100, 0.05);
        const y = rng() * STAGE_H * 0.7;
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(T * 0.03 + i));
        ctx.globalAlpha = tw; ctx.beginPath();
        ctx.arc(x, y, rng() * 1.6 + 0.6, 0, Utils.TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (d.planet) {
      const px = P(360, 0.1), py = 230;
      const pg = ctx.createRadialGradient(px - 20, py - 20, 10, px, py, 90);
      pg.addColorStop(0, '#7ad7ff'); pg.addColorStop(0.6, '#3a7fd6'); pg.addColorStop(1, '#16305a');
      ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(px, py, 90, 0, Utils.TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(160,230,255,0.5)'; ctx.lineWidth = 6;
      ctx.save(); ctx.translate(px, py); ctx.rotate(-0.4);
      ctx.beginPath(); ctx.ellipse(0, 0, 140, 34, 0, 0, Utils.TAU); ctx.stroke(); ctx.restore();
    }
    if (d.grid) {
      ctx.strokeStyle = this._hexA(m.accent, 0.12); ctx.lineWidth = 1.5;
      for (let x = 0; x <= STAGE_W; x += 80) { ctx.beginPath(); ctx.moveTo(P(x, 0.2), 0); ctx.lineTo(P(x, 0.2), STAGE_H); ctx.stroke(); }
    }

    // ---- Mid layers ----
    if (d.mountains) {
      ctx.fillStyle = this._hexA(this._shade(m.sky[1], -0.3), 0.8);
      for (let i = 0; i < 5; i++) {
        const bx = P(i * 380 - 100, 0.35);
        ctx.beginPath(); ctx.moveTo(bx, STAGE_H); ctx.lineTo(bx + 200, 380); ctx.lineTo(bx + 400, STAGE_H); ctx.closePath(); ctx.fill();
      }
    }
    if (d.city) {
      const rng = this._rng(3);
      for (let layer = 0; layer < 2; layer++) {
        const depth = 0.3 + layer * 0.15;
        ctx.fillStyle = this._hexA(this._shade(m.sky[1], layer === 0 ? -0.4 : -0.2), 0.9);
        for (let i = 0; i < 14; i++) {
          const bw = 60 + rng() * 70;
          const bh = 120 + rng() * 320;
          const bx = P(i * 130 - 60 + layer * 40, depth);
          ctx.fillRect(bx, STAGE_H - bh, bw, bh);
          // windows
          ctx.fillStyle = this._hexA(m.accent, 0.5);
          for (let wy = STAGE_H - bh + 16; wy < STAGE_H - 20; wy += 26) {
            for (let wx = bx + 10; wx < bx + bw - 10; wx += 20) {
              if (rng() > 0.5) ctx.fillRect(wx, wy, 7, 10);
            }
          }
          ctx.fillStyle = this._hexA(this._shade(m.sky[1], layer === 0 ? -0.4 : -0.2), 0.9);
        }
      }
    }
    if (d.crowd) {
      // arena stands with a pixelated crowd
      ctx.fillStyle = this._shade(m.sky[0], -0.3);
      ctx.fillRect(-400, STAGE_H - 340, STAGE_W + 800, 140);
      const rng = this._rng(11);
      for (let i = 0; i < 140; i++) {
        ctx.fillStyle = `hsl(${(rng() * 360) | 0} 50% ${40 + rng() * 30}%)`;
        const x = P(-100 + i * 13, 0.5);
        const y = STAGE_H - 320 + (i % 4) * 26 + Math.sin(T * 0.1 + i) * 2;
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Utils.TAU); ctx.fill();
      }
    }

    // ---- Portal ring (temple) ----
    if (d.portal) {
      const cx = STAGE_W / 2, cy = STAGE_H * 0.4, r = 235;
      const grad = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.85, this._hexA(m.accent, 0));
      grad.addColorStop(0.94, this._hexA(m.accent, 0.55));
      grad.addColorStop(1, this._hexA(m.accent, 0));
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Utils.TAU); ctx.fill();
      ctx.strokeStyle = this._hexA(m.accent, 0.55); ctx.lineWidth = 10;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Utils.TAU); ctx.stroke();
      ctx.strokeStyle = this._hexA('#ffffff', 0.25); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, r - 14 + Math.sin(T * 0.05) * 4, T * 0.02, T * 0.02 + 4); ctx.stroke();
    }
    if (d.pillars) {
      ctx.fillStyle = this._hexA(this._shade(m.sky[2], -0.2), 0.85);
      for (const bx of [180, 1360]) {
        const x = P(bx, 0.4);
        ctx.fillRect(x - 34, 120, 68, STAGE_H);
        ctx.fillStyle = this._hexA(m.accent, 0.25);
        ctx.fillRect(x - 40, 110, 80, 20);
        ctx.fillStyle = this._hexA(this._shade(m.sky[2], -0.2), 0.85);
      }
    }

    // ---- Foreground animated bits ----
    if (d.clouds) {
      const rng = this._rng(5);
      for (let i = 0; i < 7; i++) {
        const cw = 120 + rng() * 160;
        const cx = ((rng() * (STAGE_W + 400) + T * (0.15 + rng() * 0.15)) % (STAGE_W + 500)) - 250;
        const cy = 100 + rng() * 320;
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        this._cloud(ctx, P(cx, 0.25), cy, cw);
      }
    }
    if (d.torches) {
      for (const bx of [200, 1340]) {
        const x = P(bx, 0.4), y = 200;
        const fl = 10 + Math.sin(T * 0.4 + bx) * 4;
        const fg = ctx.createRadialGradient(x, y, 2, x, y, 40 + fl);
        fg.addColorStop(0, 'rgba(255,220,120,0.9)'); fg.addColorStop(1, 'rgba(255,120,20,0)');
        ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(x, y, 40 + fl, 0, Utils.TAU); ctx.fill();
      }
    }
    if (d.lanterns) {
      for (let i = 0; i < 5; i++) {
        const x = P(200 + i * 300, 0.3), y = 130 + Math.sin(T * 0.03 + i) * 10;
        ctx.fillStyle = 'rgba(255,90,110,0.9)';
        ctx.beginPath(); ctx.ellipse(x, y, 18, 24, 0, 0, Utils.TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,200,120,0.6)';
        ctx.beginPath(); ctx.arc(x, y, 8, 0, Utils.TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,90,110,0.4)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, y - 24); ctx.stroke();
      }
    }
    if (d.banners) {
      for (const bx of [520, 1080]) {
        const x = P(bx, 0.45);
        ctx.fillStyle = this._hexA(m.accent, 0.8);
        ctx.beginPath(); ctx.moveTo(x - 26, 100); ctx.lineTo(x + 26, 100);
        ctx.lineTo(x + 26, 300); ctx.lineTo(x, 280); ctx.lineTo(x - 26, 300); ctx.closePath(); ctx.fill();
      }
    }
    if (d.stalactites) {
      ctx.fillStyle = this._shade(m.sky[1], -0.2);
      const rng = this._rng(9);
      for (let i = 0; i < 16; i++) {
        const x = P(i * 110 + rng() * 40, 0.4);
        const h = 60 + rng() * 90;
        ctx.beginPath(); ctx.moveTo(x - 22, -50); ctx.lineTo(x + 22, -50); ctx.lineTo(x, h); ctx.closePath(); ctx.fill();
      }
    }
    if (d.embers) {
      ctx.fillStyle = 'rgba(255,150,40,0.8)';
      for (let i = 0; i < 30; i++) {
        const x = (i * 97 + T * 0.6) % STAGE_W;
        const y = STAGE_H - ((T * (0.5 + (i % 3) * 0.3) + i * 60) % STAGE_H);
        ctx.globalAlpha = Utils.clamp(y / STAGE_H, 0, 1) * 0.8;
        ctx.beginPath(); ctx.arc(P(x, 0.6), y, 2 + (i % 2), 0, Utils.TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (d.rain) {
      ctx.strokeStyle = 'rgba(150,180,220,0.35)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 60; i++) {
        const x = ((i * 61 + T * 6) % (STAGE_W + 100)) - 50;
        const y = (i * 53 + T * 12) % STAGE_H;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 16); ctx.stroke();
      }
    }
    if (d.birds) {
      ctx.strokeStyle = 'rgba(40,50,70,0.5)'; ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const x = ((T * (0.6 + i * 0.1) + i * 300) % (STAGE_W + 200)) - 100;
        const y = 120 + i * 40 + Math.sin(T * 0.08 + i) * 12;
        const f = Math.sin(T * 0.3 + i) * 6;
        ctx.beginPath(); ctx.moveTo(x - 10, y + f); ctx.lineTo(x, y); ctx.lineTo(x + 10, y + f); ctx.stroke();
      }
    }
  }

  _cloud(ctx, x, y, w) {
    ctx.beginPath();
    ctx.arc(x, y, w * 0.28, 0, Utils.TAU);
    ctx.arc(x + w * 0.26, y - w * 0.08, w * 0.22, 0, Utils.TAU);
    ctx.arc(x + w * 0.5, y, w * 0.26, 0, Utils.TAU);
    ctx.arc(x + w * 0.25, y + w * 0.06, w * 0.3, 0, Utils.TAU);
    ctx.fill();
  }

  _renderLava(ctx, haz) {
    const g = ctx.createLinearGradient(0, haz.y - 20, 0, STAGE_H + 200);
    g.addColorStop(0, '#ffd27a'); g.addColorStop(0.2, '#ff7a1f'); g.addColorStop(0.6, '#e02b0a'); g.addColorStop(1, '#5a1000');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-400, haz.y);
    for (let x = -400; x <= STAGE_W + 400; x += 30) {
      ctx.lineTo(x, haz.y + Math.sin(x * 0.02 + this.time * 0.06) * 9);
    }
    ctx.lineTo(STAGE_W + 400, STAGE_H + 300);
    ctx.lineTo(-400, STAGE_H + 300);
    ctx.closePath(); ctx.fill();
    // glow line
    ctx.strokeStyle = 'rgba(255,220,140,0.7)'; ctx.lineWidth = 4;
    ctx.beginPath();
    for (let x = -400; x <= STAGE_W + 400; x += 30) {
      const y = haz.y + Math.sin(x * 0.02 + this.time * 0.06) * 9;
      x === -400 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    // bubbles
    ctx.fillStyle = 'rgba(255,230,150,0.6)';
    for (let i = 0; i < 10; i++) {
      const x = (i * 170 + this.time * 0.5) % STAGE_W;
      const y = haz.y + 30 + Math.sin(this.time * 0.04 + i) * 20;
      ctx.beginPath(); ctx.arc(x, y, 3 + (i % 3), 0, Utils.TAU); ctx.fill();
    }
  }

  _renderPlatform(ctx, p, m) {
    ctx.save();
    const style = m.platformStyle || 'stone';
    const base = { stone: '#8a8f9c', cloud: '#eef4ff', wood: '#8a5a2b', obsidian: '#2a2430',
      brick: '#6b4a5a', tech: '#39506e', }[style] || this._shade(m.accent, -0.2);

    if (style === 'cloud') {
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      this._cloud(ctx, p.x, p.y + p.h * 0.5, p.w);
      ctx.fillStyle = 'rgba(210,225,250,0.9)';
      ctx.beginPath(); ctx.ellipse(p.x + p.w / 2, p.y + p.h, p.w / 2, p.h * 0.6, 0, 0, Math.PI); ctx.fill();
      ctx.restore(); return;
    }

    // drop shadow under the platform for separation from the background
    ctx.save();
    ctx.shadowBlur = 14; ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowOffsetY = 6;
    // body with vertical shading (brighter for clarity)
    const g = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
    g.addColorStop(0, this._shade(base, 0.28));
    g.addColorStop(0.14, this._shade(base, 0.08));
    g.addColorStop(1, this._shade(base, -0.48));
    ctx.fillStyle = g;
    this._roundRect(ctx, p.x, p.y, p.w, p.h, 9);
    ctx.fill();
    ctx.restore();

    // crisp bright top lip so the standable surface reads clearly
    ctx.fillStyle = style === 'tech' ? m.accent : this._shade(base, 0.5);
    this._roundRect(ctx, p.x, p.y, p.w, 7, 9);
    ctx.fill();

    // subtle bright outline
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 2;
    this._roundRect(ctx, p.x + 1, p.y + 1, p.w - 2, p.h - 2, 8);
    ctx.stroke();

    // texture per style
    ctx.save();
    this._roundRect(ctx, p.x, p.y, p.w, p.h, 9); ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 2;
    if (style === 'stone' || style === 'brick') {
      const bw = style === 'brick' ? 46 : 70, bh = style === 'brick' ? 22 : 999;
      for (let y = p.y + 14; y < p.y + p.h; y += bh) {
        ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(p.x + p.w, y); ctx.stroke();
      }
      for (let row = 0, y = p.y + 7; y < p.y + p.h; y += 22, row++) {
        for (let x = p.x + (row % 2 ? bw / 2 : 0); x < p.x + p.w; x += bw) {
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 22); ctx.stroke();
        }
      }
    } else if (style === 'wood') {
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      for (let x = p.x + 30; x < p.x + p.w; x += 46) {
        ctx.beginPath(); ctx.moveTo(x, p.y); ctx.lineTo(x, p.y + p.h); ctx.stroke();
      }
    } else if (style === 'tech') {
      ctx.strokeStyle = this._hexA(m.accent, 0.4);
      for (let x = p.x + 20; x < p.x + p.w; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, p.y + 10); ctx.lineTo(x, p.y + p.h); ctx.stroke();
      }
      ctx.fillStyle = this._hexA(m.accent, 0.6);
      for (let x = p.x + 16; x < p.x + p.w; x += 60) ctx.fillRect(x, p.y + p.h - 10, 10, 4);
    } else if (style === 'obsidian') {
      ctx.strokeStyle = this._hexA('#ff6a2a', 0.4);
      for (let x = p.x + 24; x < p.x + p.w; x += 60) {
        ctx.beginPath(); ctx.moveTo(x, p.y); ctx.lineTo(x + 12, p.y + p.h); ctx.stroke();
      }
    }
    ctx.restore();
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
    setW('p1SpecialFill', this.f1.special * 100);
    setW('p2SpecialFill', this.f2.special * 100);
    const se1 = document.getElementById('p1Special'), se2 = document.getElementById('p2Special');
    if (se1) se1.classList.toggle('rage', this.f1.rageActive);
    if (se2) se2.classList.toggle('rage', this.f2.rageActive);
    const t = document.getElementById('matchTimer');
    if (t) t.textContent = Math.ceil(this.roundTime);
    this._renderPips('p1Pips', this.scores[0]);
    this._renderPips('p2Pips', this.scores[1]);
    const n1 = document.getElementById('p1Name'), n2 = document.getElementById('p2Name');
    const youIsP1 = !this.online || this.online.role === 'host';
    if (n1) n1.textContent = 'لاعب 1' + (this.online && youIsP1 ? ' (أنت)' : '');
    if (n2) n2.textContent = this.config.mode === '1p' ? 'كمبيوتر' : ('لاعب 2' + (this.online && !youIsP1 ? ' (أنت)' : ''));
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
          this.state !== 'matchover' && this.state !== 'howto' && this.state !== 'online') {
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
