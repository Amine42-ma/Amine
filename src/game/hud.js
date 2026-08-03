// ============================================================
//  واجهة اللعب (HUD) + الإدخال (لمس + لوحة مفاتيح)
// ============================================================
import { el, clamp, onDrag } from '../core/util.js';
import { assetURL } from '../core/assets.js';
import { CONTROL_DEFS, STAT_DEFS } from '../core/store.js';

const REF_H = 720;
const AMMO_LABEL = { ar: '🟩 ذخيرة 5.56', smg: '🟨 ذخيرة 9مم', sg: '🟥 خرطوش', sr: '🟦 ذخيرة 7.62' };
const ITEM_LABEL = { heal: '❤️ عدّة إسعاف', shield: '🛡️ درع', boost: '⚡ مُعزّز' };

export class HUD {
  constructor(root, project, { onBigMap } = {}) {
    this.P = project;
    this.onBigMap = onBigMap;
    this.node = el('div', { id: 'hud' });
    root.append(this.node);

    this.input = {
      move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, aiming: false,
      shoot: false, run: false, crouch: false, scope: false,
      pressed: {},           // نبضات لمرة واحدة
      look: { x: 0, y: 0 },  // تراكم حركة الكاميرا، يُستهلك كل إطار
    };
    this.widgets = {};
    this.stats = {};
    this.buildLookPad();
    this.buildStatic();
    this.build();

    this._kd = (e) => this.key(e, true);
    this._ku = (e) => this.key(e, false);
    addEventListener('keydown', this._kd);
    addEventListener('keyup', this._ku);
    this._rs = () => this.layout();
    addEventListener('resize', this._rs);
  }

  // ---------- طبقة النظر الحر (تدوير الكاميرا بالسحب في أي مكان) ----------
  buildLookPad() {
    const pad = el('div', { id: 'lookpad' });
    this.node.append(pad);
    this.lookPad = pad;
    const active = new Map();

    pad.addEventListener('pointerdown', (e) => {
      pad.setPointerCapture(e.pointerId);
      active.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 });
      // على الحاسوب: قفل المؤشّر لتحكّم كامل مثل ألعاب FPS
      if (e.pointerType === 'mouse' && this.wantPointerLock && !document.pointerLockElement) {
        pad.requestPointerLock?.();
      }
    });
    pad.addEventListener('pointermove', (e) => {
      const a = active.get(e.pointerId);
      if (!a) return;
      const dx = e.clientX - a.x, dy = e.clientY - a.y;
      a.moved += Math.abs(dx) + Math.abs(dy);
      a.x = e.clientX; a.y = e.clientY;
      this.input.look.x += dx;
      this.input.look.y += dy;
    });
    const end = (e) => {
      const a = active.get(e.pointerId);
      active.delete(e.pointerId);
      // نقرة قصيرة بلا سحب = إطلاق سريع (مثل ببجي)
      if (a && a.moved < 9 && performance.now() - a.t < 260) this.input.pressed.tapFire = true;
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);

    // قفل المؤشّر على الحاسوب
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== pad) return;
      this.input.look.x += e.movementX;
      this.input.look.y += e.movementY;
    });
  }

  /** يقرأ حركة الكاميرا المتراكمة ويصفّرها */
  takeLook() {
    const l = this.input.look;
    const out = { x: l.x, y: l.y };
    l.x = 0; l.y = 0;
    return out;
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
    this.hitm = el('div', { id: 'hitmark' }, el('i'), el('i'), el('i'), el('i'));
    this.ammoBox = el('div', { id: 'ammobox' },
      el('div', { class: 'slots' },
        el('b', { class: 'slot on', data: { i: '0' } }, '1'),
        el('b', { class: 'slot', data: { i: '1' } }, '2')),
      el('div', { class: 'wname' }, 'بلا سلاح'),
      el('div', { class: 'wammo' }, el('span', { class: 'mag' }, '0'), ' / ',
        el('span', { class: 'res' }, '0')));
    this.bag = el('div', { id: 'bagpanel' });
    this.wp = el('div', { id: 'waypoint' }, el('b', {}, '📍'), el('span', {}, ''));
    this.scopeEl = el('div', { id: 'scope' },
      el('i', { class: 'ring' }), el('i', { class: 'v' }), el('i', { class: 'h' }),
      el('span', { class: 'zx' }, ''));
    this.node.append(this.cross, this.hitm, this.flash, this.oob, this.prompt, this.killfeed,
      this.dropinfo, this.hp, this.ammoBox, this.wp, this.scopeEl, this.bag, this.endcard);
    for (const b of this.ammoBox.querySelectorAll('.slot')) {
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.input.pressed['slot' + (+b.dataset.i + 1)] = true;
      });
    }
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
    const node = el('div', { class: 'gw shape-' + (c.shape || 'round'), data: { id: c.id } }, body);
    const set = (v) => {
      node.classList.toggle('press', v);
      if (c.id === 'shoot') this.input.shoot = v;
      else if (c.id === 'run') this.input.run = v;
      else if (c.id === 'crouch') this.input.crouch = v;
      else if (c.id === 'scope') this.input.scope = v;
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
      case 'KeyV': if (down) this.input.pressed.view = true; break;
      case 'KeyQ': if (down) this.input.pressed.swap = true; break;
      case 'Tab': if (down) { this.input.pressed.bag = true; e.preventDefault(); } break;
      case 'KeyG': if (down) this.input.pressed.drop = true; break;
      case 'Digit1': if (down) this.input.pressed.slot1 = true; break;
      case 'Digit2': if (down) this.input.pressed.slot2 = true; break;
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

  setHP(v, max = 100, shield = 0) {
    const p = clamp(v / max, 0, 1);
    const bar = this.hp.querySelector('i');
    bar.style.width = p * 100 + '%';
    bar.style.background = p > .55 ? 'linear-gradient(180deg,#5cff8d,#12a84a)'
      : p > .25 ? 'linear-gradient(180deg,#ffd35c,#c98800)'
      : 'linear-gradient(180deg,#ff6b7b,#b8202f)';
    let sh = this.hp.querySelector('u');
    if (!sh) { sh = el('u'); this.hp.append(sh); }
    sh.style.width = clamp(shield / 100, 0, 1) * 100 + '%';
    this.hp.querySelector('span').textContent =
      Math.max(0, Math.ceil(v)) + ' / ' + max + (shield > 0 ? '  🛡️' + Math.ceil(shield) : '');
  }

  /** بطاقة السلاح والذخيرة */
  setAmmo(h) {
    if (!h) return;
    this.ammoBox.querySelector('.wname').textContent = (h.emo || '') + ' ' + h.name;
    this.ammoBox.querySelector('.mag').textContent = h.mag;
    this.ammoBox.querySelector('.res').textContent = h.res;
    this.ammoBox.classList.toggle('empty', h.mag === 0);
  }
  setSlots(slots, active) {
    const b = this.ammoBox.querySelectorAll('.slot');
    slots.forEach((sl, i) => {
      b[i].classList.toggle('on', i === active);
      b[i].classList.toggle('has', !!sl);
      b[i].textContent = sl ? (sl.def.short || String(i + 1)) : String(i + 1);
    });
  }

  /** بوصلة الوجهة: المسافة والاتجاه بالنسبة لنظر اللاعب */
  setWaypoint(dist, ang) {
    if (dist == null) { this.wp.classList.remove('on'); return; }
    this.wp.classList.add('on');
    this.wp.querySelector('span').textContent = Math.round(dist) + 'م';
    this.wp.querySelector('b').style.transform = `rotate(${ang}rad)`;
  }

  /** منظار القنص: 0 = مغلق، غير ذلك = قوّة التقريب */
  setScope(zoom) {
    const on = zoom > 0;
    if (on === this._scopeOn) return;
    this._scopeOn = on;
    this.scopeEl.classList.toggle('on', on);
    this.cross.classList.toggle('hidden-by-scope', on);
    if (on) this.scopeEl.querySelector('.zx').textContent = zoom + '×';
  }

  hitMark() {
    this.hitm.classList.add('on');
    clearTimeout(this._hm);
    this._hm = setTimeout(() => this.hitm.classList.remove('on'), 160);
  }

  // ---------- الحقيبة ----------
  openBag(inv, cb) {
    this.bagCb = cb;
    this.bag.classList.add('on');
    const render = () => {
      this.bag.innerHTML = '';
      const head = el('div', { class: 'bag-head' },
        el('h3', {}, '🎒 الحقيبة'),
        el('button', { class: 'btn sm r', onclick: () => { this.closeBag(); cb.onClose && cb.onClose(); } }, '✕'));
      this.bag.append(head);

      const secW = el('div', { class: 'bag-sec' }, el('h4', {}, 'الأسلحة'));
      inv.slots.forEach((sl, i) => {
        secW.append(el('div', { class: 'bag-row' + (i === inv.active ? ' on' : '') },
          el('b', {}, 'الخانة ' + (i + 1)),
          el('span', { class: 'f' }, sl ? `${sl.def.emo} ${sl.def.name}  ${sl.mag}/${sl.def.mag}` : '— فارغة —'),
          sl ? el('button', { class: 'btn sm c', onclick: () => { cb.onSelect(i); render(); } }, 'استخدام') : null,
          sl ? el('button', { class: 'btn sm r', onclick: () => { cb.onDropWeapon(i); render(); } }, 'رمي') : null));
      });
      this.bag.append(secW);

      const secA = el('div', { class: 'bag-sec' }, el('h4', {}, 'الذخيرة'));
      for (const k in inv.reserve) {
        const n = inv.reserve[k] || 0;
        secA.append(el('div', { class: 'bag-row' },
          el('b', {}, AMMO_LABEL[k] || k),
          el('span', { class: 'f' }, String(n)),
          n > 0 ? el('button', { class: 'btn sm r', onclick: () => { cb.onDropAmmo(k); render(); } }, 'رمي 30') : null));
      }
      this.bag.append(secA);

      const secI = el('div', { class: 'bag-sec' }, el('h4', {}, 'الأدوات'));
      for (const k in inv.items) {
        const n = inv.items[k] || 0;
        secI.append(el('div', { class: 'bag-row' },
          el('b', {}, ITEM_LABEL[k] || k),
          el('span', { class: 'f' }, String(n)),
          n > 0 ? el('button', { class: 'btn sm g', onclick: () => { cb.onUse(k); render(); } }, 'استخدام') : null,
          n > 0 ? el('button', { class: 'btn sm r', onclick: () => { cb.onDropItem(k); render(); } }, 'رمي') : null));
      }
      this.bag.append(secI);
    };
    render();
  }
  closeBag() { this.bag.classList.remove('on'); this.bag.innerHTML = ''; }
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
    this.ammoBox.classList.toggle('on', on);
    for (const id of ['shoot', 'run', 'crouch', 'open', 'pickup', 'reload', 'aim', 'emote',
                      'swap', 'bag', 'drop', 'scope']) {
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
    // الزون
    if (this.zone) {
      const Z = this.zone;
      const sc = (w / 2) / view;
      const [zx, zy] = toPx(Z.cx, Z.cz);
      g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 2.4 * (w / 200);
      g.beginPath(); g.arc(zx, zy, Z.r * sc, 0, 7); g.stroke();
      if (!Z.done) {
        const [tx, ty] = toPx(Z.tx, Z.tz);
        g.strokeStyle = Z.cfg.color || '#25d3ff'; g.lineWidth = 2 * (w / 200);
        g.setLineDash([5 * (w / 200), 5 * (w / 200)]);
        g.beginPath(); g.arc(tx, ty, Z.tr * sc, 0, 7); g.stroke();
        g.setLineDash([]);
      }
    }
    // علامة الوجهة
    if (this.waypoint) {
      const [wx, wy] = toPx(this.waypoint.x, this.waypoint.z);
      const cx2 = clamp(wx, 6, w - 6), cy2 = clamp(wy, 6, h - 6);
      g.fillStyle = '#ff4d5e'; g.strokeStyle = '#fff'; g.lineWidth = 1.6 * (w / 200);
      g.beginPath(); g.arc(cx2, cy2, 4.5 * (w / 200), 0, 7); g.fill(); g.stroke();
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
