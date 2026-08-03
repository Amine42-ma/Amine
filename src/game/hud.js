// ============================================================
//  واجهة اللعب (HUD) + الإدخال (لمس + لوحة مفاتيح)
// ============================================================
import { el, clamp, onDrag } from '../core/util.js';
import { assetURL } from '../core/assets.js';
import { CONTROL_DEFS, STAT_DEFS } from '../core/store.js';

const REF_H = 720;

export class HUD {
  constructor(root, project, { onBigMap } = {}) {
    this.P = project;
    this.onBigMap = onBigMap;
    this.node = el('div', { id: 'hud' });
    root.append(this.node);

    this.input = {
      move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, aiming: false,
      shoot: false, run: false, crouch: false,
      pressed: {},           // نبضات لمرة واحدة
      lookDelta: { x: 0, y: 0 },
    };
    this.widgets = {};
    this.stats = {};
    this.buildStatic();
    this.build();

    this._kd = (e) => this.key(e, true);
    this._ku = (e) => this.key(e, false);
    addEventListener('keydown', this._kd);
    addEventListener('keyup', this._ku);
    this._rs = () => this.layout();
    addEventListener('resize', this._rs);
  }

  // ---------- عناصر ثابتة ----------
  buildStatic() {
    this.cross = el('div', { class: 'crosshair' }, el('i'), el('i'), el('i'), el('i'));
    this.flash = el('div', { id: 'dmgflash' });
    this.oob = el('div', { id: 'oob' });
    this.prompt = el('div', { id: 'prompt' });
    this.killfeed = el('div', { id: 'killfeed' });
    this.dropinfo = el('div', { class: 'dropinfo' });
    this.hp = el('div', { id: 'hpbar' }, el('i'), el('span'));
    this.endcard = el('div', { id: 'endcard' });
    this.node.append(this.cross, this.flash, this.oob, this.prompt, this.killfeed, this.dropinfo, this.hp, this.endcard);
  }

  // ---------- أدوات التحكم ----------
  build() {
    const P = this.P;
    for (const c of P.controls.layout) {
      const def = CONTROL_DEFS[c.id];
      if (!def) continue;
      const w = def.kind === 'stick' ? this.makeStick(c) : this.makeBtn(c);
      this.widgets[c.id] = w;
      this.node.append(w.node);
    }
    for (const s of P.controls.stats) {
      if (s.id === 'minimap') continue;
      if (s.id === 'hp') { this.stats.hp = { cfg: s, node: this.hp }; continue; }
      const node = el('div', { class: 'hud-stat' },
        el('span', { class: 'e' }, s.emoji || STAT_DEFS[s.id]?.emo || '•'),
        el('span', { class: 'v' }, '0'));
      this.stats[s.id] = { cfg: s, node, val: node.querySelector('.v'), icon: node.querySelector('.e') };
      this.node.append(node);
    }
    this.layout();
  }

  iconFor(c) {
    if (c.icon) {
      const u = assetURL(c.icon);
      if (u) return el('img', { src: u, alt: '' });
    }
    return el('span', { class: 'emo' }, c.emoji || '•');
  }

  makeBtn(c) {
    const body = el('div', { class: 'body' }, this.iconFor(c));
    const node = el('div', { class: 'gw ' + (c.shape === 'sq' ? 'sq' : ''), data: { id: c.id } }, body);
    const set = (v) => {
      node.classList.toggle('press', v);
      if (c.id === 'shoot') this.input.shoot = v;
      else if (c.id === 'run') this.input.run = v;
      else if (c.id === 'crouch') this.input.crouch = v;
      if (v) this.input.pressed[c.id] = true;
    };
    node.addEventListener('pointerdown', (e) => { e.preventDefault(); node.setPointerCapture(e.pointerId); set(true); });
    const up = () => set(false);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('pointerleave', (e) => { if (e.buttons === 0) set(false); });
    return { node, cfg: c, body, setIcon: () => { body.replaceChildren(this.iconFor(c)); } };
  }

  makeStick(c) {
    const knob = el('div', { class: 'knob' });
    const node = el('div', { class: 'stick', data: { id: c.id } }, knob);
    const target = c.id === 'move' ? this.input.move : this.input.aim;
    let active = false, id = -1;
    const reset = () => {
      active = false; id = -1;
      knob.style.transform = 'translate(0,0)';
      target.x = 0; target.y = 0;
      if (c.id === 'aim') { this.input.aiming = false; this.cross.classList.remove('on'); }
    };
    const move = (e) => {
      if (!active || e.pointerId !== id) return;
      const r = node.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const max = r.width * 0.36;
      const d = Math.hypot(dx, dy);
      if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      target.x = dx / max; target.y = dy / max;
      if (c.id === 'aim' && Math.hypot(target.x, target.y) > 0.16) {
        this.input.aiming = true; this.cross.classList.add('on');
      }
    };
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault(); active = true; id = e.pointerId;
      node.setPointerCapture(e.pointerId);
      if (c.id === 'aim') { this.input.aiming = true; this.cross.classList.add('on'); }
      move(e);
    });
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', reset);
    node.addEventListener('pointercancel', reset);
    return { node, cfg: c, reset };
  }

  // ---------- الخريطة المصغّرة ----------
  attachMinimap(mm) {
    this.minimap = mm;
    this.node.append(mm.node);
    this.layout();
  }

  // ---------- التخطيط ----------
  layout() {
    const W = this.node.clientWidth || innerWidth;
    const H = this.node.clientHeight || innerHeight;
    const k = (H / REF_H) * (this.P.controls.scale || 1);
    this.scaleK = k;
    for (const id in this.widgets) {
      const { node, cfg } = this.widgets[id];
      const s = cfg.size * k;
      node.style.width = node.style.height = s + 'px';
      node.style.left = cfg.x * W - s / 2 + 'px';
      node.style.top = cfg.y * H - s / 2 + 'px';
      node.style.opacity = cfg.opacity ?? 0.92;
      node.classList.toggle('hidden', !cfg.visible);
    }
    for (const id in this.stats) {
      const { node, cfg } = this.stats[id];
      node.style.display = cfg.visible ? '' : 'none';
      if (id === 'hp') {
        node.style.left = cfg.x * W - (node.offsetWidth || 200) / 2 + 'px';
        node.style.top = cfg.y * H - 11 + 'px';
        node.style.transform = `scale(${cfg.size || 1})`;
      } else {
        node.style.transform = `translate(-50%,-50%) scale(${(cfg.size || 1) * clamp(k, .7, 1.5)})`;
        node.style.left = cfg.x * W + 'px';
        node.style.top = cfg.y * H + 'px';
      }
    }
    if (this.minimap) this.minimap.layout(W, H, k);
  }

  // ---------- الإدخال بلوحة المفاتيح ----------
  key(e, down) {
    const m = this.input.move;
    const set = (k, v) => { this.input[k] = v; if (v) this.input.pressed[k] = true; };
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': m.y = down ? -1 : (this.keys?.s ? 1 : 0); this.keys = { ...this.keys, w: down }; break;
      case 'KeyS': case 'ArrowDown': m.y = down ? 1 : (this.keys?.w ? -1 : 0); this.keys = { ...this.keys, s: down }; break;
      case 'KeyA': case 'ArrowLeft': m.x = down ? -1 : (this.keys?.d ? 1 : 0); this.keys = { ...this.keys, a: down }; break;
      case 'KeyD': case 'ArrowRight': m.x = down ? 1 : (this.keys?.a ? -1 : 0); this.keys = { ...this.keys, d: down }; break;
      case 'Space': if (down) this.input.pressed.jump = true; e.preventDefault(); break;
      case 'ShiftLeft': case 'ShiftRight': set('run', down); break;
      case 'KeyC': case 'ControlLeft': set('crouch', down); break;
      case 'KeyF': if (down) this.input.pressed.open = true; break;
      case 'KeyE': if (down) this.input.pressed.pickup = true; break;
      case 'KeyR': if (down) this.input.pressed.reload = true; break;
      case 'KeyM': if (down) this.onBigMap && this.onBigMap(); break;
      default: return;
    }
  }

  /** يُستهلك مرة واحدة في كل إطار */
  consume(name) {
    if (this.input.pressed[name]) { this.input.pressed[name] = false; return true; }
    return false;
  }

  // ---------- تحديثات العرض ----------
  setStat(id, v) { const s = this.stats[id]; if (s?.val) s.val.textContent = v; }
  setHP(v, max = 100) {
    const p = clamp(v / max, 0, 1);
    const bar = this.hp.querySelector('i');
    bar.style.width = p * 100 + '%';
    bar.style.background = p > .55 ? 'linear-gradient(180deg,#5cff8d,#12a84a)'
      : p > .25 ? 'linear-gradient(180deg,#ffd35c,#c98800)'
      : 'linear-gradient(180deg,#ff6b7b,#b8202f)';
    this.hp.querySelector('span').textContent = Math.max(0, Math.ceil(v)) + ' / ' + max;
  }
  damage() {
    this.flash.style.opacity = '.85';
    setTimeout(() => (this.flash.style.opacity = '0'), 120);
  }
  showPrompt(txt) {
    if (txt) { this.prompt.textContent = txt; this.prompt.classList.add('on'); }
    else this.prompt.classList.remove('on');
  }
  showOOB(txt) {
    if (txt) { this.oob.innerHTML = txt; this.oob.classList.add('on'); }
    else this.oob.classList.remove('on');
  }
  showDrop(txt) {
    if (txt) { this.dropinfo.innerHTML = txt; this.dropinfo.classList.add('on'); }
    else this.dropinfo.classList.remove('on');
  }
  feed(txt) {
    const n = el('div', { class: 'kf' }, txt);
    this.killfeed.prepend(n);
    setTimeout(() => n.remove(), 4200);
    while (this.killfeed.children.length > 5) this.killfeed.lastChild.remove();
  }
  setCombatVisible(on) {
    for (const id of ['shoot', 'run', 'crouch', 'open', 'pickup', 'reload', 'aim', 'emote']) {
      const w = this.widgets[id];
      if (!w) continue;
      const want = on && w.cfg.visible;
      w.node.style.display = want ? '' : 'none';
    }
  }
  end(html) { this.endcard.innerHTML = ''; this.endcard.append(html); this.endcard.classList.add('on'); }

  dispose() {
    removeEventListener('keydown', this._kd);
    removeEventListener('keyup', this._ku);
    removeEventListener('resize', this._rs);
    this.node.remove();
  }
}

// ============================================================
//  ودجت الخريطة المصغّرة (قابلة للتحريك/التكبير/التصغير)
// ============================================================
export class Minimap {
  constructor(cfg, analysis, mapCanvas, { onExpand } = {}) {
    this.cfg = cfg;
    this.an = analysis;
    this.src = mapCanvas;
    this.zoom = cfg.zoom || 1;
    this.node = el('div', { id: 'minimap' });
    this.cv = el('canvas');
    this.node.append(this.cv);
    const btns = el('div', { class: 'mm-btns' },
      el('b', { title: 'تكبير', onclick: (e) => { e.stopPropagation(); this.setZoom(this.zoom * 1.35); } }, '+'),
      el('b', { title: 'تصغير', onclick: (e) => { e.stopPropagation(); this.setZoom(this.zoom / 1.35); } }, '−'),
      el('b', { title: 'الخريطة الكاملة', onclick: (e) => { e.stopPropagation(); onExpand && onExpand(); } }, '⛶'));
    this.node.append(btns);
    const grip = el('div', { class: 'mm-grip' });
    this.node.append(grip);
    this.ctx = this.cv.getContext('2d');
    this.markers = [];
    this.path = null;
    this.boundary = null;

    // تحريك
    onDrag(this.node, {
      start: (_, c) => { c.x0 = this.cfg.x; c.y0 = this.cfg.y; },
      move: (d, c) => {
        this.cfg.x = clamp(c.x0 + d.dx / innerWidth, 0.02, 0.98);
        this.cfg.y = clamp(c.y0 + d.dy / innerHeight, 0.02, 0.98);
        this.layout(innerWidth, innerHeight, this.k || 1);
        this.onMove && this.onMove();
      },
    });
    // تغيير الحجم
    onDrag(grip, {
      start: (_, c) => { c.s0 = this.cfg.size; },
      move: (d, c) => {
        this.cfg.size = clamp(c.s0 + (d.dx * -1 + d.dy) * 0.7, 80, 460);
        this.layout(innerWidth, innerHeight, this.k || 1);
        this.onMove && this.onMove();
      },
    });
  }
  setZoom(z) { this.zoom = clamp(z, 0.6, 6); this.cfg.zoom = this.zoom; }
  layout(W, H, k) {
    this.k = k;
    const s = this.cfg.size * clamp(k, 0.75, 1.6);
    this.node.style.width = this.node.style.height = s + 'px';
    this.node.style.left = clamp(this.cfg.x * W - s / 2, 2, W - s - 2) + 'px';
    this.node.style.top = clamp(this.cfg.y * H - s / 2, 2, H - s - 2) + 'px';
    this.node.style.display = this.cfg.visible ? '' : 'none';
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.cv.width = s * dpr; this.cv.height = s * dpr;
  }
  /** يرسم الخريطة متمركزة على اللاعب */
  draw(px, pz, yaw, others = []) {
    const an = this.an, g = this.ctx;
    if (!g || !this.src) return;
    const w = this.cv.width, h = this.cv.height;
    const V = an.view || { x0: an.minX, z0: an.minZ, size: an.maxX - an.minX };
    const world = V.size;
    const view = world / this.zoom / 2.2;      // نصف قطر العرض بالوحدات
    g.clearRect(0, 0, w, h);
    g.save();
    // اقتطاع من صورة الخريطة
    const sx = ((px - V.x0) / world) * this.src.width;
    const sy = ((pz - V.z0) / world) * this.src.height;
    const sw = (view * 2 / world) * this.src.width;
    g.imageSmoothingEnabled = true;
    g.fillStyle = '#06111f'; g.fillRect(0, 0, w, h);
    g.drawImage(this.src, sx - sw / 2, sy - sw / 2, sw, sw, 0, 0, w, h);

    const toPx = (x, z) => [((x - px) / view) * (w / 2) + w / 2, ((z - pz) / view) * (h / 2) + h / 2];

    // الحدود
    if (this.boundary?.length > 2) {
      g.strokeStyle = 'rgba(255,60,80,.95)'; g.lineWidth = 2.5 * (w / 200);
      g.beginPath();
      this.boundary.forEach((p, i) => { const [a, b] = toPx(p.x, p.z); i ? g.lineTo(a, b) : g.moveTo(a, b); });
      g.closePath(); g.stroke();
    }
    // مسار الطيران
    if (this.path?.length > 1) {
      g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2 * (w / 200);
      g.setLineDash([7 * (w / 200), 6 * (w / 200)]);
      g.beginPath();
      this.path.forEach((p, i) => { const [a, b] = toPx(p.x, p.z); i ? g.lineTo(a, b) : g.moveTo(a, b); });
      g.stroke(); g.setLineDash([]);
    }
    // العلامات
    for (const m of others) {
      const [a, b] = toPx(m.x, m.z);
      if (a < -20 || b < -20 || a > w + 20 || b > h + 20) continue;
      g.fillStyle = m.color || '#ff4d5e';
      g.beginPath(); g.arc(a, b, (m.r || 3) * (w / 200), 0, 7); g.fill();
    }
    // اللاعب
    const cx = w / 2, cy = h / 2, r = 7 * (w / 200);
    g.save(); g.translate(cx, cy); g.rotate(yaw);
    g.fillStyle = '#ffc21a'; g.strokeStyle = '#3a2400'; g.lineWidth = 2 * (w / 200);
    g.beginPath(); g.moveTo(0, -r * 1.4); g.lineTo(r, r); g.lineTo(0, r * 0.4); g.lineTo(-r, r);
    g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.restore();
  }
}
