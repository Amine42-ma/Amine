// ============================================================
//  المرحلة 3 — محرّر القائمة الرئيسية (بأسلوب براول ستارز)
// ============================================================
import { el, clamp, onDrag, toast, pickFile, slider, colorRow, toggleRow,
         confirmBox, promptBox, uid, modal } from '../core/util.js';
import { store, P, LOBBY_DEFS, currentHero, heroUnlocked, defHero } from '../core/store.js';
import { importFile, assetURL } from '../core/assets.js';
import { CharacterPreview, tileFor, friendsPanel, shopPanel, settingsPanel,
         heroesPanel, heroEditor } from '../game/lobby.js';

export function mountStage3(view, side, ctx) {
  const L = () => P().lobby;
  let sel = null;
  let preview = null;

  // ---------------- معاينة ----------------
  const wrap = el('div', { class: 'device-wrap' });
  const device = el('div', { class: 'device' });
  const screen = el('div', { class: 'screen lobby-stage' });
  device.append(screen);
  wrap.append(device);
  view.append(wrap);
  view.append(el('div', { class: 'mapinfo' }, 'اسحب أي زر لتغيير مكانه • المقبض الأصفر لتغيير الحجم'));

  const bgNode = el('div', { class: 'lobby-bg' });
  const charHost = el('div', {
    style: { position: 'absolute', left: '50%', top: '52%', width: '44%', height: '80%',
      transform: 'translate(-50%,-50%)' },
  });
  screen.append(bgNode, charHost);

  function applyBG() {
    const url = L().bgAssetId && assetURL(L().bgAssetId);
    if (url) { bgNode.style.backgroundImage = `url(${url})`; bgNode.style.background = ''; bgNode.style.backgroundImage = `url(${url})`; bgNode.style.backgroundSize = 'cover'; bgNode.style.backgroundPosition = 'center'; }
    else {
      bgNode.style.backgroundImage = 'none';
      bgNode.style.background =
        `radial-gradient(1100px 700px at 60% 10%, ${L().bgColorA} 0%, transparent 62%),
         linear-gradient(170deg, ${L().bgColorA} 0%, ${L().bgColorB} 100%)`;
    }
  }

  // ---------------- الأزرار ----------------
  const nodes = new Map();
  function buildButtons() {
    for (const [, n] of nodes) n.remove();
    nodes.clear();
    for (const b of L().buttons) {
      const w = el('div', { class: 'lb-el' }, tileFor(b));
      const hnd = el('div', { class: 'hnd' });
      w.append(hnd);
      w.style.opacity = b.visible ? '1' : '.42';
      place(w, b);
      w.addEventListener('pointerdown', () => select(b));
      onDrag(w, {
        start: (_, s) => { s.x = b.x; s.y = b.y; select(b); },
        move: (d, s) => {
          const r = screen.getBoundingClientRect();
          b.x = clamp(s.x + d.dx / r.width, 0.02, 0.98);
          b.y = clamp(s.y + d.dy / r.height, 0.02, 0.98);
          store.live(() => {}); place(w, b);
        },
        end: () => store.snap('تحريك زر'),
      });
      onDrag(hnd, {
        start: (_, s) => { s.w = b.w; s.h = b.h; select(b); },
        move: (d, s) => {
          const r = screen.getBoundingClientRect();
          const k = (-d.dx + d.dy) / r.width;
          b.w = clamp(s.w + k, 0.04, 0.6);
          b.h = clamp(s.h + k * (r.width / r.height), 0.04, 0.7);
          store.live(() => {}); place(w, b);
        },
        end: () => { store.snap('تغيير حجم زر'); buildSide(); },
      });
      nodes.set(b, w);
      screen.append(w);
    }
    highlight();
  }
  // معاينة المحرّر دائماً 16:9، فالنِسَب المئوية تطابق صندوق التصميم تماماً
  function place(w, b) {
    w.style.left = b.x * 100 + '%';
    w.style.top = b.y * 100 + '%';
    w.style.width = b.w * 100 + '%';
    w.style.height = b.h * 100 + '%';
    w.style.transform = 'translate(-50%,-50%)';
  }
  function highlight() {
    for (const [b, n] of nodes) n.classList.toggle('sel', b === sel);
  }
  function select(b) { sel = b; highlight(); buildSide(); }

  function fit() {
    const pad = 26;
    const W = view.clientWidth - pad * 2, H = view.clientHeight - pad * 2;
    const ar = 16 / 9;
    let w = W, h = w / ar;
    if (h > H) { h = H; w = h * ar; }
    device.style.width = w + 'px';
    device.style.height = h + 'px';
    for (const [b, n] of nodes) place(n, b);
  }

  // ---------------- اللوحة الجانبية ----------------
  const head = el('div', { class: 'side-head' }, '🏠 القائمة الرئيسية');
  const sbody = el('div', { class: 'side-body' });
  const foot = el('div', { class: 'side-foot' },
    el('button', { class: 'btn ghost sm', onclick: () => ctx.goto(2) }, '→ السابق'),
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn y', onclick: () => ctx.goto(4) }, 'التالي: التصدير ←'));
  side.append(head, sbody, foot);

  function buildSide() {
    sbody.innerHTML = '';

    // ---- الخلفية ----
    const sbg = el('div', { class: 'sec' }, el('h4', {}, '🖼️ الخلفية'));
    sbg.append(el('div', { class: 'row', style: { marginBottom: '10px' } },
      el('button', { class: 'btn c sm', onclick: async () => {
        const f = await pickFile('image/*');
        if (!f) return;
        const a = await importFile(f, 'image');
        store.edit('تغيير الخلفية', (d) => { d.lobby.bgAssetId = a.id; });
        applyBG(); buildSide(); toast('تم تغيير الخلفية', 'ok');
      } }, '📂 رفع صورة'),
      L().bgAssetId ? el('button', { class: 'btn r sm', onclick: () => {
        store.edit('إزالة الخلفية', (d) => { d.lobby.bgAssetId = null; });
        applyBG(); buildSide();
      } }, '✕ إزالة') : null));
    if (!L().bgAssetId) {
      sbg.append(colorRow('اللون العلوي', L().bgColorA, (v) => {
        store.live((d) => { d.lobby.bgColorA = v; }); applyBG();
      }));
      sbg.append(colorRow('اللون السفلي', L().bgColorB, (v) => {
        store.live((d) => { d.lobby.bgColorB = v; }); applyBG();
      }));
    }
    sbody.append(sbg);

    // ---- الأزرار ----
    const sb = el('div', { class: 'sec' }, el('h4', {}, '🔘 أزرار القائمة'));
    const list = el('div', { class: 'list' });
    for (const b of L().buttons) {
      const ic = el('div', { class: 'ic' });
      ic.append(b.icon && assetURL(b.icon) ? el('img', { src: assetURL(b.icon) }) : document.createTextNode(b.emoji || '⭐'));
      list.append(el('div', { class: 'li' + (sel === b ? ' on' : ''), onclick: () => select(b) },
        ic, el('div', { class: 'nm' }, b.label),
        el('span', { class: 'x', onclick: (e) => {
          e.stopPropagation();
          store.edit('إظهار/إخفاء', () => { b.visible = !b.visible; });
          buildButtons(); buildSide();
        } }, b.visible ? '👁️' : '🚫')));
    }
    sb.append(list);
    sb.append(el('button', { class: 'btn g sm', style: { width: '100%', marginTop: '8px' }, onclick: () => {
      const b = { uid: uid('lb'), kind: 'custom', label: 'زر جديد', x: .5, y: .5, w: .1, h: .14,
        icon: null, emoji: '⭐', color: '#ffc21a', visible: true, badge: '' };
      store.edit('زر جديد', (d) => { d.lobby.buttons.push(b); });
      sel = b; buildButtons(); buildSide();
    } }, '＋ زر مخصص'));
    sbody.append(sb);

    // ---- خصائص الزر ----
    if (sel) {
      const s = el('div', { class: 'sec' }, el('h4', {}, '⚙️ ' + sel.label));
      const nameI = el('input', { type: 'text', value: sel.label, oninput: (e) => {
        store.live(() => { sel.label = e.target.value; }); buildButtons();
      } });
      s.append(el('div', { class: 'field' }, el('label', {}, 'النص'), nameI));
      const badgeI = el('input', { type: 'text', value: sel.badge || '', placeholder: 'مثال: جديد / 7',
        oninput: (e) => { store.live(() => { sel.badge = e.target.value; }); buildButtons(); } });
      s.append(el('div', { class: 'field' }, el('label', {}, 'شارة صغيرة'), badgeI));
      s.append(colorRow('اللون', sel.color, (v) => { store.live(() => { sel.color = v; }); buildButtons(); }));

      const kindSel = el('select', { onchange: (e) => {
        store.edit('نوع الزر', () => {
          sel.kind = e.target.value;
          const d = LOBBY_DEFS[sel.kind];
          if (d) { sel.emoji = d.emo; if (sel.label === 'زر جديد') sel.label = d.label; }
        });
        buildButtons(); buildSide();
      } });
      for (const k in LOBBY_DEFS)
        kindSel.append(el('option', { value: k, selected: sel.kind === k }, LOBBY_DEFS[k].label));
      s.append(el('div', { class: 'field' }, el('label', {}, 'الوظيفة عند الضغط'), kindSel));

      s.append(el('div', { class: 'row' },
        el('button', { class: 'btn c sm', onclick: async () => {
          const f = await pickFile('image/*');
          if (!f) return;
          const a = await importFile(f, 'image');
          store.edit('أيقونة الزر', () => { sel.icon = a.id; });
          buildButtons(); buildSide();
        } }, '🖼️ أيقونة'),
        sel.icon ? el('button', { class: 'btn r sm', onclick: () => {
          store.edit('حذف أيقونة', () => { sel.icon = null; });
          buildButtons(); buildSide();
        } }, '✕') : null,
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn r sm', onclick: async () => {
          if (!(await confirmBox('حذف الزر', `حذف «${sel.label}»؟`, 'حذف'))) return;
          store.edit('حذف زر', (d) => { d.lobby.buttons = d.lobby.buttons.filter((x) => x !== sel); });
          sel = null; buildButtons(); buildSide();
        } }, '🗑️')));

      const emos = ['▶️','🛒','🦸','👥','🛡️','📰','⚙️','📋','👕','⭐','🎁','🏆','💎','🔥','🎮','🗺️','📦','🎯'];
      const g = el('div', { class: 'grid3', style: { marginTop: '10px' } });
      for (const e of emos)
        g.append(el('div', { class: 'tool' + (sel.emoji === e && !sel.icon ? ' on' : ''), onclick: () => {
          store.edit('رمز الزر', () => { sel.emoji = e; sel.icon = null; });
          buildButtons(); buildSide();
        } }, el('span', { class: 'e' }, e)));
      s.append(g);
      sbody.append(s);
    }

    // ---- الأبطال ----
    const sc = el('div', { class: 'sec' }, el('h4', {}, '🦸 الأبطال'));
    sc.append(el('div', { class: 'hint', style: { marginBottom: '8px' } },
      'كل بطل زيّ فقط بلا قدرات. حدّد لكل بطل عدد الكؤوس التي تفتحه، وألوانه، ' +
      'وألصق عليه نماذج GLB من جهازك (نظارات، قبعة، سلاح…).'));
    const hl = el('div', { class: 'list' });
    for (const h of L().heroes) {
      const on = h.id === L().selectedHero;
      const face = h.icon && assetURL(h.icon)
        ? el('img', { src: assetURL(h.icon) })
        : el('span', { style: { color: h.body, fontSize: '18px' } }, '●');
      hl.append(el('div', { class: 'li' + (on ? ' on' : '') },
        el('div', { class: 'ic' }, face),
        el('div', { class: 'nm', onclick: () => {
          store.edit('اختيار بطل', (d) => { d.lobby.selectedHero = h.id; });
          remakePreview(); buildSide();
        } }, `${h.name} — 🏆 ${h.unlockTrophies}`),
        el('span', { class: 'x', onclick: (e) => {
          e.stopPropagation();
          heroEditor(P(), h, () => store.save(), () => remakePreview(), () => buildSide());
        } }, '✎')));
    }
    sc.append(hl);
    sc.append(el('div', { class: 'grid2', style: { marginTop: '8px' } },
      el('button', { class: 'btn g sm', onclick: () => {
        const h = defHero({ name: 'بطل ' + (L().heroes.length + 1),
          unlockTrophies: L().heroes.length * 500 });
        store.edit('إضافة بطل', (d) => { d.lobby.heroes.push(h); });
        buildSide();
        heroEditor(P(), h, () => store.save(), () => remakePreview(), () => buildSide());
      } }, '＋ إضافة بطل'),
      el('button', { class: 'btn ghost sm', onclick: () => {
        heroesPanel(P(), () => store.save(), () => remakePreview());
      } }, '👁️ معاينة الشبكة')));
    sbody.append(sc);

    // ---- الأصدقاء والمتجر ----
    const sf = el('div', { class: 'sec' }, el('h4', {}, '🗂️ اللوحات'));
    sf.append(el('div', { class: 'row', style: { marginBottom: '10px' } },
      el('label', { style: { flex: 1, fontSize: '12.5px', fontWeight: 800, color: 'var(--ink-2)' } },
        'جهة لوحة الأصدقاء'),
      el('button', { class: 'btn sm ' + (L().friendsSide === 'right' ? 'c' : 'ghost'), onclick: () => {
        store.edit('جهة الأصدقاء', (d) => { d.lobby.friendsSide = 'right'; }); buildSide();
      } }, 'يمين'),
      el('button', { class: 'btn sm ' + (L().friendsSide === 'left' ? 'c' : 'ghost'), onclick: () => {
        store.edit('جهة الأصدقاء', (d) => { d.lobby.friendsSide = 'left'; }); buildSide();
      } }, 'يسار')));
    sf.append(el('div', { class: 'grid2' },
      el('button', { class: 'btn ghost sm', onclick: () => friendsPanel(P(), () => store.save()) }, '👥 الأصدقاء'),
      el('button', { class: 'btn ghost sm', onclick: () => shopPanel(P(), () => store.save(), true) }, '🛒 المتجر'),
      el('button', { class: 'btn ghost sm', onclick: () => settingsPanel(P(), () => store.save()) }, '⚙️ الإعدادات'),
      el('button', { class: 'btn ghost sm', onclick: () => editPlayer() }, '🙂 بيانات اللاعب')));
    sbody.append(sf);
  }

  function editAttachment(at) {
    const C = L().character;
    const box = el('div');
    const slotSel = el('select', { onchange: (e) => {
      store.live(() => { at.slot = e.target.value; }); preview?.reloadAttachments();
    } });
    for (const [v, t] of [['face', 'الوجه (نظارات)'], ['head', 'الرأس (قبعة)'], ['body', 'الجسم'],
                          ['hand', 'اليد (سلاح)'], ['back', 'الظهر']])
      slotSel.append(el('option', { value: v, selected: at.slot === v }, t));
    box.append(el('div', { class: 'field' }, el('label', {}, 'مكان التثبيت'), slotSel));
    const S = (label, key, min, max, step) => slider({ label, min, max, step, value: at[key],
      onInput: (v) => { store.live(() => { at[key] = v; }); preview?.reloadAttachments(); } });
    box.append(S('الحجم', 'scale', .1, 4, .02));
    box.append(S('الإزاحة ↔', 'px', -1.5, 1.5, .01));
    box.append(S('الإزاحة ↕', 'py', -1.5, 1.5, .01));
    box.append(S('الإزاحة ⤢', 'pz', -1.5, 1.5, .01));
    box.append(S('دوران X', 'rx', -3.2, 3.2, .02));
    box.append(S('دوران Y', 'ry', -3.2, 3.2, .02));
    box.append(S('دوران Z', 'rz', -3.2, 3.2, .02));
    box.append(toggleRow('ظاهر', at.visible, (v) => {
      store.live(() => { at.visible = v; }); preview?.reloadAttachments();
    }));
    modal({ title: '🕶️ ' + (at.name || 'إكسسوار'), body: box,
      actions: [{ label: 'تم', cls: 'y', run: () => { store.snap('تعديل إكسسوار'); buildSide(); } }] });
  }

  function editPlayer() {
    const p = P().player;
    const box = el('div');
    const f = (label, key, type = 'text') => {
      const i = el('input', { type, value: p[key], oninput: (e) => {
        store.live(() => { p[key] = type === 'number' ? +e.target.value : e.target.value; });
      } });
      return el('div', { class: 'field' }, el('label', {}, label), i);
    };
    box.append(f('اسم اللاعب', 'name'), f('الكؤوس', 'trophies', 'number'),
      f('العملات', 'coins', 'number'), f('الجواهر', 'gems', 'number'));
    modal({ title: '🙂 بيانات اللاعب', body: box,
      actions: [{ label: 'حفظ', cls: 'y', run: () => { store.snap('بيانات اللاعب'); buildButtons(); } }] });
  }

  function remakePreview() {
    preview?.dispose();
    preview = new CharacterPreview(charHost, currentHero(P()));
  }

  applyBG();
  buildButtons();
  buildSide();
  fit();
  remakePreview();
  const ro = new ResizeObserver(fit);
  ro.observe(view);

  return { unmount() { ro.disconnect(); preview?.dispose(); } };
}
