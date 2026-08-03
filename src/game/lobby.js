// ============================================================
//  القائمة الرئيسية (بأسلوب براول ستارز) — تُستخدم في المحرّر
//  وفي اللعبة المُصدَّرة
// ============================================================
import * as THREE from 'three';
import { el, clamp, uid, toast, promptBox, confirmBox, pickFile, slider, colorRow } from '../core/util.js';
import { assetURL, importFile } from '../core/assets.js';
import { LOBBY_DEFS, MODES, currentHero, heroUnlocked, defHero } from '../core/store.js';
import { Character } from './character.js';
import { loadGLB } from './world.js';
import * as A from '../core/audio.js';

// ------------------------------------------------------------
//  معاينة الشخصية ثلاثية الأبعاد
// ------------------------------------------------------------
export class CharacterPreview {
  constructor(container, charCfg) {
    this.cfg = charCfg;
    this.canvas = el('canvas', { class: 'char3d' });
    container.append(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);

    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(3, 6, 5); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1; key.shadow.camera.far = 22;
    key.shadow.camera.left = -4; key.shadow.camera.right = 4;
    key.shadow.camera.top = 5; key.shadow.camera.bottom = -2;
    const rim = new THREE.DirectionalLight(0x8ab4ff, 2.0);
    rim.position.set(-4, 3, -4);
    const fill = new THREE.HemisphereLight(0xc9a6ff, 0x2a1a4a, 1.5);
    this.scene.add(key, rim, fill);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(1.7, 44),
      new THREE.MeshStandardMaterial({ color: 0x241552, roughness: .95, transparent: true, opacity: .38 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.char = new Character(charCfg);
    this.scene.add(this.char.group);
    this.t = 0;
    this.spin = 0;
    this.freeSpin = false;
    this.drag = 0;
    this.attachIds = new Set();
    this.reloadAttachments();
    this.applyDecal();

    let down = false, lx = 0;
    this.canvas.style.pointerEvents = 'auto';
    this.canvas.addEventListener('pointerdown', (e) => { down = true; lx = e.clientX; this.freeSpin = true; this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => { if (down) { this.spin += (e.clientX - lx) * 0.01; lx = e.clientX; this.drag = 1.4; } });
    this.canvas.addEventListener('pointerup', () => (down = false));
    this.canvas.addEventListener('pointercancel', () => (down = false));

    this.loop = this.loop.bind(this);
    this._raf = requestAnimationFrame(this.loop);
  }

  applyDecal() {
    const id = this.cfg.decal;
    if (!id) { this.char.setDecal(null); return; }
    const url = assetURL(id);
    if (!url) { this.char.setDecal(null); return; }
    const img = new Image();
    img.onload = () => this.char.setDecal(img);
    img.src = url;
  }

  async reloadAttachments() {
    this.char.clearAttachments();
    for (const at of this.cfg.attachments || []) {
      if (!at.visible || !at.assetId) continue;
      const url = assetURL(at.assetId);
      if (!url) continue;
      try {
        const g = await loadGLB(url);
        // توحيد الحجم
        const bb = new THREE.Box3().setFromObject(g.scene);
        const sz = bb.getSize(new THREE.Vector3());
        const k = 0.55 / Math.max(sz.x, sz.y, sz.z || 1);
        const holder = new THREE.Group();
        g.scene.scale.setScalar(k);
        g.scene.position.sub(bb.getCenter(new THREE.Vector3()).multiplyScalar(k));
        holder.add(g.scene);
        this.char.attach(holder, at.slot, at);
      } catch (e) { console.warn('attach fail', e); }
    }
  }

  refreshColors() { this.char.setColors(this.cfg); }

  /** يعيد بناء الشخصية بالكامل (أبعاد + إكسسوارات) */
  setHero(cfg) { this.cfg = cfg; this.refreshAll(); }

  refreshAll() {
    const spin = this.spin;
    this.scene.remove(this.char.group);
    this.char.dispose();
    this.char = new Character(this.cfg);
    this.scene.add(this.char.group);
    this.spin = spin;
    this.reloadAttachments();
    this.applyDecal();
  }

  loop() {
    if (this.dead) return;
    this._raf = requestAnimationFrame(this.loop);
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    if (this.canvas.width !== w * this.renderer.getPixelRatio()) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    const dt = 1 / 60;
    this.t += dt;
    this.drag = Math.max(0, this.drag - dt);
    // تمايل لطيف يُبقي الوجه نحو الكاميرا، ودوران حر بعد السحب
    const yaw = this.freeSpin ? this.spin : this.spin + Math.sin(this.t * 0.45) * 0.55;
    this.char.st.yaw = yaw;
    this.char.root.rotation.y = yaw;
    this.char.update(dt, { speed: 0, grounded: true, groundY: 0, look: new THREE.Vector2(0, 0) });
    this.char.group.position.y = Math.sin(this.t * 1.5) * 0.045;
    const d = 4.6;
    this.camera.position.set(0, this.char.totalH * 0.62 + 0.5, d);
    this.camera.lookAt(0, this.char.totalH * 0.5, 0);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.dead = true;
    cancelAnimationFrame(this._raf);
    this.char.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

// ------------------------------------------------------------
//  رسم القائمة
// ------------------------------------------------------------
export function tileFor(b, editable) {
  const icon = b.icon && assetURL(b.icon)
    ? el('span', { class: 'ico' }, el('img', { src: assetURL(b.icon), alt: '' }))
    : el('span', { class: 'ico' }, b.emoji || '⭐');
  const t = el('div', { class: 'bs-tile' }, icon, b.label ? el('span', { class: 'lbl' }, b.label) : null,
    b.badge ? el('span', { class: 'badge' }, b.badge) : null);
  const c = new THREE.Color(b.color || '#ffc21a');
  const d = c.clone().offsetHSL(0, 0, -0.22);
  t.style.background = `linear-gradient(180deg,#${c.getHexString()},#${d.getHexString()})`;
  t.style.color = c.getHSL({}).l > 0.62 ? '#2a1c00' : '#fff';
  return t;
}

export class Lobby {
  constructor(container, P, { editable = false, onAction, onChange } = {}) {
    this.P = P;
    this.editable = editable;
    this.onAction = onAction;
    this.onChange = onChange;
    this.node = el('div', { id: 'lobby' });
    container.append(this.node);
    this.selected = null;
    this.render();
    // ResizeObserver أدقّ من حدث resize: يلتقط دوران الشاشة وظهور/اختفاء أشرطة المتصفح
    this._ro = new ResizeObserver(() => this.relayout());
    this._ro.observe(this.node);
    this._rs = () => requestAnimationFrame(() => this.relayout());
    addEventListener('resize', this._rs);
    addEventListener('orientationchange', this._rs);
  }

  render() {
    const P = this.P, L = P.lobby;
    this.node.innerHTML = '';

    // خلفية
    this._els = new Map();
    const bg = el('div', { class: 'lb-bg' });
    const url = L.bgAssetId && assetURL(L.bgAssetId);
    if (url) bg.style.backgroundImage = `url(${url})`;
    else bg.style.background =
      `radial-gradient(1100px 700px at 60% 10%, ${L.bgColorA} 0%, transparent 62%),
       linear-gradient(170deg, ${L.bgColorA} 0%, ${L.bgColorB} 100%)`;
    this.node.append(bg);

    // شخصية ثلاثية الأبعاد في المنتصف
    const stage3d = el('div', {
      style: { position: 'absolute', left: '50%', top: '50%', width: '46%', height: '86%',
               transform: 'translate(-50%,-50%)', pointerEvents: 'none' },
    });
    this.node.append(stage3d);
    this.preview?.dispose();
    this.preview = new CharacterPreview(stage3d, currentHero(P));

    // شريط اللاعب العلوي + اختيار النمط
    this.node.append(this.header());
    this.node.append(this.modeBar());

    // الأزرار
    for (const b of L.buttons) {
      if (!b.visible && !this.editable) continue;
      const w = el('div', { class: 'lb-el', data: { uid: b.uid, kind: b.kind } }, tileFor(b, this.editable));
      w.style.opacity = b.visible ? '1' : '.4';
      (this._els ||= new Map()).set(b, w);
      this.place(w, b);
      if (!this.editable) {
        w.addEventListener('click', () => { A.sfx.click(); this.onAction && this.onAction(b); });
      }
      this.node.append(w);
    }
    this.buttonsHost = this.node;
  }

  /**
   * الموضع بنسبة الشاشة (يحافظ على التصاق الأزرار بالحواف)،
   * والحجم يُحسب في CSS من «صندوق تصميم 16:9» عبر vw/vh —
   * فلا يحتاج أي معالج تغيير حجم ولا يمكن أن يتأخّر عن الشاشة.
   */
  place(w, b) {
    w.style.left = b.x * 100 + '%';
    w.style.top = b.y * 100 + '%';
    w.style.setProperty('--w', b.w);
    w.style.setProperty('--h', b.h);
    w.style.transform = 'translate(-50%,-50%)';
  }

  relayout() { for (const [b, w] of this._els || []) this.place(w, b); }

  /** شريط اختيار نمط المباراة (فردي/ثنائي/رباعي) فوق زر اللعب */
  modeBar() {
    const P = this.P;
    const play = P.lobby.buttons.find((b) => b.kind === 'play' && b.visible);
    const bar = el('div', { class: 'mode-bar' });
    if (play) {
      bar.style.left = play.x * 100 + '%';
      bar.style.top = `calc(${play.y * 100}% - 4.6em)`;
    } else { bar.style.left = '85%'; bar.style.top = '72%'; }
    for (const k in MODES) {
      const m = MODES[k];
      const b = el('div', { class: 'mode-chip' + (P.match.mode === k ? ' on' : '') },
        el('span', {}, m.emo), el('b', {}, m.label));
      b.onclick = () => {
        P.match.mode = k;
        A.sfx.click();
        this.onChange && this.onChange();
        this.node.replaceChild(this.modeBar(), bar);
      };
      bar.append(b);
    }
    return bar;
  }

  header() {
    const p = this.P.player;
    const box = el('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none' } });
    const cur = (emo, v, col) => el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(8,4,24,.72)',
        border: '1.5px solid rgba(255,255,255,.2)', borderRadius: '11px', padding: '3px 10px',
        fontWeight: '900', fontSize: 'clamp(11px,1.5vw,15px)' },
    }, el('span', { style: { fontSize: '1.1em' } }, emo), el('span', { style: { color: col } }, v));

    box.append(el('div', {
      style: { position: 'absolute', top: '2%', left: '1.5%', display: 'flex', gap: '7px', alignItems: 'center' },
    },
      el('div', {
        style: { display: 'flex', alignItems: 'center', gap: '7px', background: 'rgba(8,4,24,.72)',
          border: '1.5px solid rgba(255,255,255,.2)', borderRadius: '12px', padding: '4px 11px' },
      },
        el('span', { style: { fontSize: 'clamp(15px,2vw,20px)' } }, '🙂'),
        el('b', { style: { fontSize: 'clamp(11px,1.5vw,15px)' } }, p.name)),
      cur('🏆', p.trophies, '#ffc21a')));

    box.append(el('div', {
      style: { position: 'absolute', top: '2%', right: '1.5%', display: 'flex', gap: '7px' },
    }, cur('⚡', 25535, '#ff6bd6'), cur('🪙', p.coins, '#ffc21a'), cur('💎', p.gems, '#39e07b')));

    // شريط الخبرة
    box.append(el('div', {
      style: { position: 'absolute', bottom: '2%', left: '1.5%', width: 'clamp(120px,18%,220px)' },
    },
      el('div', { style: { fontSize: 'clamp(9px,1.2vw,12px)', fontWeight: '900', marginBottom: '3px' } },
        `XP ${p.xp}/${p.xpMax}`),
      el('div', { style: { height: '10px', borderRadius: '10px', background: 'rgba(0,0,0,.55)', overflow: 'hidden',
        border: '1.5px solid rgba(255,255,255,.22)' } },
        el('i', { style: { display: 'block', height: '100%', width: (p.xp / p.xpMax) * 100 + '%',
          background: 'linear-gradient(90deg,#25d3ff,#ffc21a)' } }))));
    return box;
  }

  dispose() {
    this._ro?.disconnect();
    removeEventListener('resize', this._rs);
    removeEventListener('orientationchange', this._rs);
    this.preview?.dispose();
    this.node.remove();
  }
}

// ------------------------------------------------------------
//  لوحات جانبية (أصدقاء / متجر / إعدادات / أبطال)
// ------------------------------------------------------------
export function sheet(title, buildBody, onClose, side = 'right') {
  const s = el('div', { class: 'panel-sheet ' + (side === 'left' ? 'from-left' : 'from-right') });
  const body = el('div', { class: 'pb' });
  s.append(
    el('div', { class: 'ph' },
      el('h3', {}, title),
      el('button', { class: 'btn sm ghost', onclick: () => close() }, '✕')),
    body);
  document.body.append(s);
  requestAnimationFrame(() => s.classList.add('on'));
  const close = () => { s.classList.remove('on'); setTimeout(() => { s.remove(); onClose && onClose(); }, 260); };
  buildBody(body, close);
  return { node: s, body, close };
}

export function friendsPanel(P, onChange) {
  return sheet('👥 الأصدقاء', (body) => {
    const render = () => {
      body.innerHTML = '';
      const add = el('div', { class: 'row', style: { marginBottom: '12px' } },
        el('input', { type: 'text', placeholder: 'اسم اللاعب أو الوسم #',
          style: { flex: 1, background: 'rgba(0,0,0,.35)', border: '1px solid var(--line)',
            borderRadius: '10px', padding: '9px 12px', outline: 'none' } }),
        el('button', { class: 'btn g sm', onclick: (e) => {
          const inp = e.target.parentNode.querySelector('input');
          const v = inp.value.trim();
          if (!v) return;
          P.lobby.friends.push({ id: uid('f'), name: v, tag: '#' + Math.random().toString(36).slice(2, 6).toUpperCase(), online: Math.random() > .45 });
          inp.value = '';
          onChange && onChange();
          A.sfx.ui_ok();
          render();
        } }, '＋ إضافة'));
      body.append(add);

      const on = P.lobby.friends.filter((f) => f.online);
      const off = P.lobby.friends.filter((f) => !f.online);
      const grp = (t, arr, empty) => {
        body.append(el('div', { style: { fontSize: '13px', fontWeight: '900', color: 'var(--acc)', margin: '12px 0 7px' } }, t));
        if (!arr.length) { body.append(el('div', { class: 'hint' }, empty)); return; }
        for (const f of arr) {
          body.append(el('div', { class: 'friend' },
            el('div', { class: 'av' }, '🙂'),
            el('div', { class: 'nm' }, el('b', {}, f.name), el('s', {}, f.tag + ' • ' + (f.online ? 'متصل الآن' : 'غير متوفّر'))),
            el('div', { class: 'dot ' + (f.online ? 'on' : '') }),
            el('button', { class: 'btn sm ghost', onclick: () => {
              f.online = !f.online; onChange && onChange(); render();
            } }, f.online ? 'دعوة' : '—'),
            el('button', { class: 'btn sm r', onclick: async () => {
              if (!(await confirmBox('حذف صديق', `حذف ${f.name} من قائمتك؟`, 'حذف'))) return;
              P.lobby.friends.splice(P.lobby.friends.indexOf(f), 1);
              onChange && onChange(); render();
            } }, '✕')));
        }
      };
      grp('متصلون الآن (' + on.length + ')', on, 'لا يوجد أصدقاء متصلون.');
      grp('غير متوفّرين (' + off.length + ')', off, 'لا أحد هنا.');
    };
    render();
  }, null, P.lobby.friendsSide || 'right');
}

export function shopPanel(P, onChange, editable) {
  return sheet('🛒 المتجر', (body) => {
    const render = () => {
      body.innerHTML = '';
      for (const it of P.lobby.shop) {
        const th = it.icon && assetURL(it.icon)
          ? el('div', { class: 'th' }, el('img', { src: assetURL(it.icon) }))
          : el('div', { class: 'th' }, it.emoji || '🎁');
        body.append(el('div', { class: 'shop-item' }, th,
          el('div', { style: { flex: 1 } },
            el('b', { style: { display: 'block', fontSize: '14.5px' } }, it.name),
            el('span', { style: { fontSize: '12px', color: 'var(--ink-3)' } }, '💎 ' + it.price)),
          el('button', { class: 'btn y sm', onclick: () => { A.sfx.ui_ok(); toast('تم الشراء (تجريبي)', 'ok'); } }, 'شراء'),
          editable ? el('button', { class: 'btn sm r', onclick: () => {
            P.lobby.shop.splice(P.lobby.shop.indexOf(it), 1); onChange && onChange(); render();
          } }, '✕') : null));
      }
      if (editable) {
        body.append(el('button', { class: 'btn g', style: { width: '100%', marginTop: '8px' }, onclick: async () => {
          const n = await promptBox('عنصر جديد', 'اسم العنصر');
          if (!n) return;
          P.lobby.shop.push({ id: uid('s'), name: n, price: 50, emoji: '🎁', icon: null });
          onChange && onChange(); render();
        } }, '＋ إضافة عنصر'));
      }
    };
    render();
  });
}

export function settingsPanel(P, onChange) {
  return sheet('⚙️ الإعدادات', (body) => {
    const row = (label, node) => el('div', { class: 'row', style: { marginBottom: '12px' } },
      el('label', { style: { flex: 1, fontWeight: '800', fontSize: '13px' } }, label), node);
    const tog = (key, obj) => {
      const b = el('button', { class: 'btn sm ' + (obj[key] ? 'g' : 'ghost') },
        obj[key] ? 'مُفعّل' : 'مُعطّل');
      b.onclick = () => {
        obj[key] = !obj[key];
        b.className = 'btn sm ' + (obj[key] ? 'g' : 'ghost');
        b.textContent = obj[key] ? 'مُفعّل' : 'مُعطّل';
        A.applySettings(P.match); onChange && onChange();
      };
      return b;
    };
    body.append(
      row('المؤثرات الصوتية', tog('sfx', P.match)),
      row('الموسيقى', tog('music', P.match)),
      row('صوت محركات الطائرة', tog('engineSfx', P.match)),
      el('div', { class: 'sep' }),
      row('عدد الخصوم', el('input', { type: 'number', min: 1, max: 60, value: P.match.bots,
        style: { width: '90px', background: 'rgba(0,0,0,.35)', border: '1px solid var(--line)',
          borderRadius: '9px', padding: '7px' },
        onchange: (e) => { P.match.bots = clamp(+e.target.value || 24, 1, 60); onChange && onChange(); } })),
      row('مستوى الرسوميات', (() => {
        const s = el('select', { style: { background: 'rgba(0,0,0,.35)', border: '1px solid var(--line)',
          borderRadius: '9px', padding: '7px' },
          onchange: (e) => { P.match.quality = e.target.value; onChange && onChange(); } });
        for (const [v, t] of [['low', 'منخفض'], ['auto', 'تلقائي'], ['high', 'عالٍ']])
          s.append(el('option', { value: v, selected: P.match.quality === v }, t));
        return s;
      })()),
      el('div', { class: 'hint', style: { marginTop: '14px' } },
        'تُحفظ الإعدادات تلقائياً في هذا المتصفح.'));
  });
}

// ------------------------------------------------------------
//  الأبطال — شبكة اختيار + قفل بالكؤوس + إضافة أبطال ونماذج
// ------------------------------------------------------------
export function heroesPanel(P, onChange, refresh, { editable = true } = {}) {
  return sheet('🦸 الأبطال', (body) => {
    const touch = () => { onChange && onChange(); refresh && refresh(); };
    const render = () => {
      body.innerHTML = '';
      body.append(el('div', { class: 'hint', style: { marginBottom: '10px' } },
        `كؤوسك: ${P.player.trophies} 🏆 — كل بطل يُفتح عند عدد كؤوس معيّن. ` +
        'الأبطال أزياء فقط، لا قدرات خاصة.'));

      const grid = el('div', { class: 'hero-grid' });
      for (const h of P.lobby.heroes) {
        const open = heroUnlocked(P, h);
        const sel = h.id === P.lobby.selectedHero;
        const face = h.icon && assetURL(h.icon)
          ? el('img', { src: assetURL(h.icon), alt: '' })
          : el('div', { class: 'hero-face', style: { background: h.body } },
              el('i', { style: { background: h.eye } }), el('i', { style: { background: h.eye } }));
        const card = el('div', { class: 'hero-card' + (sel ? ' on' : '') + (open ? '' : ' locked') },
          el('div', { class: 'hero-th' }, face,
            open ? null : el('div', { class: 'hero-lock' }, '🔒')),
          el('div', { class: 'hero-nm' }, h.name),
          el('div', { class: 'hero-tr' }, open ? (sel ? '✓ مُختار' : 'جاهز') : `🏆 ${h.unlockTrophies}`));
        card.onclick = () => {
          if (!open) { toast(`تحتاج ${h.unlockTrophies} كأساً لفتح ${h.name}`, 'err'); A.sfx.ui_err(); return; }
          P.lobby.selectedHero = h.id;
          A.sfx.ui_ok();
          touch(); render();
        };
        if (editable) {
          card.append(el('button', { class: 'hero-edit', onclick: (e) => {
            e.stopPropagation();
            heroEditor(P, h, onChange, refresh, render);
          } }, '✎'));
        }
        grid.append(card);
      }
      body.append(grid);

      if (editable) {
        body.append(el('button', { class: 'btn g', style: { width: '100%', marginTop: '12px' }, onclick: () => {
          const h = defHero({ name: 'بطل ' + (P.lobby.heroes.length + 1),
            unlockTrophies: P.lobby.heroes.length * 500 });
          P.lobby.heroes.push(h);
          touch(); render();
          heroEditor(P, h, onChange, refresh, render);
        } }, '＋ إضافة بطل'));
      }
    };
    render();
  });
}

/** محرّر بطل واحد: الاسم، الكؤوس، الألوان، النماذج ثلاثية الأبعاد */
export function heroEditor(P, h, onChange, refresh, reRender) {
  return sheet('✎ ' + h.name, (body, close) => {
    const touch = () => {
      if (P.lobby.selectedHero === h.id) refresh && refresh();
      onChange && onChange();
    };
    const render = () => {
      body.innerHTML = '';
      const nameI = el('input', { type: 'text', value: h.name,
        oninput: (e) => { h.name = e.target.value; onChange && onChange(); } });
      body.append(el('div', { class: 'field' }, el('label', {}, 'اسم البطل'), nameI));
      const trI = el('input', { type: 'number', min: 0, step: 100, value: h.unlockTrophies,
        oninput: (e) => { h.unlockTrophies = Math.max(0, +e.target.value || 0); onChange && onChange(); } });
      body.append(el('div', { class: 'field' },
        el('label', {}, 'الكؤوس المطلوبة لفتحه 🏆'), trI));

      body.append(el('div', { class: 'sep' }));
      body.append(
        colorRow('لون الجسم', h.body, (v) => { h.body = v; touch(); }),
        colorRow('لون البطن', h.belly, (v) => { h.belly = v; touch(); }),
        colorRow('لون العين', h.eye, (v) => { h.eye = v; touch(); }),
        colorRow('الحد الخارجي', h.outline, (v) => { h.outline = v; touch(); }),
        slider({ label: 'الطول', min: .6, max: 1.6, step: .02, value: h.height,
          onInput: (v) => { h.height = v; touch(); } }),
        slider({ label: 'العرض', min: .6, max: 1.5, step: .02, value: h.width,
          onInput: (v) => { h.width = v; touch(); } }),
        slider({ label: 'حجم العينين', min: .5, max: 1.8, step: .02, value: h.eyeSize,
          onInput: (v) => { h.eyeSize = v; touch(); } }));

      body.append(el('div', { class: 'sep' }));
      body.append(el('div', { style: { fontSize: '13px', fontWeight: '900', color: 'var(--acc)', marginBottom: '8px' } },
        'النماذج ثلاثية الأبعاد (نظارات، قبعة، سلاح…)'));
      for (const at of h.attachments) {
        body.append(el('div', { class: 'friend' },
          el('div', { class: 'av' }, '🕶️'),
          el('div', { class: 'nm' }, el('b', {}, at.name || 'إكسسوار'),
            el('s', {}, { face: 'الوجه', head: 'الرأس', body: 'الجسم', hand: 'اليد', back: 'الظهر' }[at.slot] || at.slot)),
          el('button', { class: 'btn sm ghost', onclick: () => { attachEditor(at, touch); } }, '⚙️'),
          el('button', { class: 'btn sm ' + (at.visible ? 'g' : 'ghost'), onclick: () => {
            at.visible = !at.visible; touch(); render();
          } }, at.visible ? 'مُرتدى' : 'مخفي'),
          el('button', { class: 'btn sm r', onclick: () => {
            h.attachments.splice(h.attachments.indexOf(at), 1); touch(); render();
          } }, '✕')));
      }
      if (!h.attachments.length) body.append(el('div', { class: 'hint' }, 'لا توجد نماذج بعد.'));

      body.append(el('button', { class: 'btn c', style: { width: '100%', marginTop: '10px' }, onclick: async () => {
        const f = await pickFile('.glb,.gltf');
        if (!f) return;
        const a = await importFile(f, 'glb');
        const at = { id: uid('at'), assetId: a.id, name: f.name.replace(/\.(glb|gltf)$/i, ''),
          slot: 'face', px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, scale: 1, visible: true };
        h.attachments.push(at);
        touch(); render(); attachEditor(at, touch);
      } }, '＋ نموذج GLB من جهازك'));

      body.append(el('button', { class: 'btn c', style: { width: '100%', marginTop: '8px' }, onclick: async () => {
        const f = await pickFile('image/*');
        if (!f) return;
        const a = await importFile(f, 'image');
        h.icon = a.id; onChange && onChange(); render(); reRender && reRender();
      } }, '🖼️ صورة البطل في القائمة'));
      body.append(el('button', { class: 'btn y', style: { width: '100%', marginTop: '8px' }, onclick: () => {
        paintPanel(P, h, onChange, refresh);
      } }, '🖌️ ارسم على الشخصية (علم، خطوط، أي شيء)'));

      body.append(el('div', { class: 'sep' }));
      body.append(el('button', { class: 'btn r', style: { width: '100%' }, onclick: async () => {
        if (P.lobby.heroes.length <= 1) return toast('لا يمكن حذف آخر بطل', 'err');
        if (!(await confirmBox('حذف بطل', `حذف «${h.name}»؟`, 'حذف'))) return;
        P.lobby.heroes.splice(P.lobby.heroes.indexOf(h), 1);
        if (P.lobby.selectedHero === h.id) P.lobby.selectedHero = P.lobby.heroes[0].id;
        onChange && onChange(); refresh && refresh(); reRender && reRender();
        close();
      } }, '🗑️ حذف هذا البطل'));
    };
    render();
  }, () => reRender && reRender(), P.lobby.friendsSide === 'left' ? 'right' : 'left');
}

/** الرسم اليدوي على الكبسولة — فرشاة، ألوان، تراجع، مسح */
export function paintPanel(P, hero, onChange, refresh) {
  return sheet('🖌️ الرسم على الشخصية', (body) => {
    const W = 512, H = 256;
    const cv = el('canvas', { width: W, height: H, class: 'paint-cv' });
    const g = cv.getContext('2d');
    g.clearRect(0, 0, W, H);
    const undoStack = [];
    const pushUndo = () => {
      undoStack.push(g.getImageData(0, 0, W, H));
      if (undoStack.length > 30) undoStack.shift();
    };

    // ابدأ من النقش الحالي إن وُجد
    if (hero.decal && assetURL(hero.decal)) {
      const im = new Image();
      im.onload = () => g.drawImage(im, 0, 0, W, H);
      im.src = assetURL(hero.decal);
    }

    let color = '#c1272d', size = 14, erase = false, drawing = false, last = null;
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
    };
    const stroke = (a, b) => {
      g.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
      g.strokeStyle = color; g.lineWidth = size; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId); pushUndo();
      drawing = true; last = pos(e); stroke(last, last);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p2 = pos(e); stroke(last, p2); last = p2;
    });
    const stop = () => { drawing = false; };
    cv.addEventListener('pointerup', stop);
    cv.addEventListener('pointercancel', stop);

    body.append(el('div', { class: 'hint', style: { marginBottom: '8px' } },
      'ارسم بإصبعك أو بالفأرة. الجزء الأيسر من اللوحة يلتف حول الجسم — جرّب واحفظ لترى النتيجة مباشرة.'));
    body.append(cv);

    const colors = ['#c1272d', '#006233', '#ffffff', '#000000', '#ffc21a', '#25d3ff',
                    '#39e07b', '#c56bff', '#ff8a1e', '#8b5a2b'];
    const pal = el('div', { class: 'paint-pal' });
    for (const c of colors) {
      const sw = el('i', { style: { background: c } });
      sw.onclick = () => { color = c; erase = false; [...pal.children].forEach((x) => x.classList.remove('on')); sw.classList.add('on'); };
      pal.append(sw);
    }
    pal.firstChild.classList.add('on');
    body.append(pal);
    body.append(el('div', { class: 'row', style: { margin: '8px 0' } },
      el('label', { style: { fontSize: '12.5px', fontWeight: 800 } }, 'لون حر'),
      el('input', { type: 'color', value: color, oninput: (e) => { color = e.target.value; erase = false; } })));
    body.append(slider({ label: 'حجم الفرشاة', min: 2, max: 48, value: size,
      onInput: (v) => { size = v; } }));

    body.append(el('div', { class: 'grid2', style: { marginTop: '8px' } },
      el('button', { class: 'btn ghost sm', onclick: () => { erase = !erase; toast(erase ? 'ممحاة' : 'قلم'); } }, '🧽 ممحاة/قلم'),
      el('button', { class: 'btn ghost sm', onclick: () => {
        const d = undoStack.pop(); if (d) g.putImageData(d, 0, 0);
      } }, '↶ تراجع'),
      el('button', { class: 'btn r sm', onclick: () => { pushUndo(); g.clearRect(0, 0, W, H); } }, '🗑️ مسح الكل'),
      el('button', { class: 'btn y sm', onclick: async () => {
        const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
        const buf = await blob.arrayBuffer();
        const { putAsset } = await import('../core/assets.js');
        hero.decal = await putAsset({ name: 'رسم-' + hero.name + '.png', kind: 'image',
          mime: 'image/png', buf });
        onChange && onChange();
        refresh && refresh();
        toast('تم الحفظ على الشخصية', 'ok');
      } }, '💾 حفظ على الشخصية')));

    if (hero.decal) {
      body.append(el('button', { class: 'btn r', style: { width: '100%', marginTop: '8px' }, onclick: () => {
        hero.decal = null; onChange && onChange(); refresh && refresh(); toast('أُزيل الرسم');
      } }, '✕ إزالة الرسم'));
    }
  }, null, 'left');
}

/** ضبط موضع وحجم نموذج مثبّت */
export function attachEditor(at, touch) {
  return sheet('⚙️ ' + (at.name || 'إكسسوار'), (body) => {
    const slotSel = el('select', {
      style: { background: 'rgba(0,0,0,.35)', border: '1px solid var(--line)',
        borderRadius: '9px', padding: '8px', width: '100%' },
      onchange: (e) => { at.slot = e.target.value; touch(); },
    });
    for (const [v, t] of [['face', 'الوجه (نظارات)'], ['head', 'الرأس (قبعة)'], ['body', 'الجسم'],
                          ['hand', 'اليد (سلاح)'], ['back', 'الظهر']])
      slotSel.append(el('option', { value: v, selected: at.slot === v }, t));
    body.append(el('div', { class: 'field' }, el('label', {}, 'مكان التثبيت'), slotSel));
    for (const [label, key, mn, mx, st] of [
      ['الحجم', 'scale', .05, 5, .01],
      ['إزاحة ↔', 'px', -2, 2, .01], ['إزاحة ↕', 'py', -2, 2, .01], ['إزاحة ⤢', 'pz', -2, 2, .01],
      ['دوران X', 'rx', -3.2, 3.2, .02], ['دوران Y', 'ry', -3.2, 3.2, .02], ['دوران Z', 'rz', -3.2, 3.2, .02]])
      body.append(slider({ label, min: mn, max: mx, step: st, value: at[key],
        onInput: (v) => { at[key] = v; touch(); } }));
  }, null, 'right');
}
