// ============================================================
//  المرحلة 1 — ترتيب أزرار التحكم والواجهة قبل اللعب
// ============================================================
import { el, clamp, onDrag, toast, pickFile, slider, toggleRow } from '../core/util.js';
import { store, P, CONTROL_DEFS, STAT_DEFS, defaultProject } from '../core/store.js';
import { importFile, assetURL } from '../core/assets.js';

export function mountStage1(view, side, ctx) {
  let sel = null;

  // ---------------- معاينة الجهاز ----------------
  const wrap = el('div', { class: 'device-wrap' });
  const device = el('div', { class: 'device' });
  const screen = el('div', { class: 'screen' });
  device.append(screen);
  wrap.append(device);
  view.append(wrap);
  view.append(el('div', { class: 'mapinfo' },
    'اسحب أي زر لتغيير مكانه • اسحب المقبض الأصفر لتغيير الحجم'));

  // خلفية تحاكي مشهد اللعب
  screen.style.background =
    `radial-gradient(700px 380px at 50% 20%, #6fa8dc22, transparent 70%),
     linear-gradient(180deg,#5fa8d3 0%,#a8d5a2 46%,#6b8f4e 47%,#3f5c34 100%)`;
  const deco = el('div', { style: { position: 'absolute', inset: '0', opacity: '.5',
    background: 'radial-gradient(circle at 30% 66%, #2c4a22 0 6%, transparent 7%),' +
                'radial-gradient(circle at 62% 74%, #2c4a22 0 4%, transparent 5%),' +
                'radial-gradient(circle at 80% 62%, #6b7a4e 0 3%, transparent 4%)' } });
  screen.append(deco);
  const ghost = el('div', { style: { position: 'absolute', left: '50%', top: '56%', width: '7%', height: '20%',
    transform: 'translate(-50%,-50%)', borderRadius: '50% 50% 45% 45%', background: 'linear-gradient(180deg,#ffd94a,#e0a000)',
    boxShadow: '0 8px 20px rgba(0,0,0,.4)' } });
  screen.append(ghost);

  function fit() {
    const pad = 26;
    const W = view.clientWidth - pad * 2, H = view.clientHeight - pad * 2;
    const ar = 16 / 9;
    let w = W, h = w / ar;
    if (h > H) { h = H; w = h * ar; }
    device.style.width = w + 'px';
    device.style.height = h + 'px';
    layout();
  }

  // ---------------- الودجت ----------------
  const nodes = new Map();

  function iconOf(c) {
    if (c.icon && assetURL(c.icon)) return el('img', { src: assetURL(c.icon), alt: '' });
    return el('span', { class: 'emo' }, c.emoji || '•');
  }

  function makeNode(c, isStat) {
    const body = el('div', { class: 'body' },
      isStat ? el('span', { class: 'txt' }, statPreview(c)) : iconOf(c));
    const hnd = el('div', { class: 'hnd' });
    const tag = el('div', { class: 'tag' }, (isStat ? STAT_DEFS[c.id] : CONTROL_DEFS[c.id])?.label || c.id);
    const n = el('div', { class: 'hw' + (c.shape === 'sq' || isStat ? ' sq' : '') }, body, hnd, tag);
    n.addEventListener('pointerdown', () => select(c, isStat));

    onDrag(n, {
      start: (_, s) => { s.x = c.x; s.y = c.y; select(c, isStat); },
      move: (d, s) => {
        const r = screen.getBoundingClientRect();
        c.x = clamp(s.x + d.dx / r.width, 0.02, 0.98);
        c.y = clamp(s.y + d.dy / r.height, 0.02, 0.98);
        store.live(() => {});
        layout();
      },
      end: () => store.snap('تحريك ' + (CONTROL_DEFS[c.id]?.label || c.id)),
    });
    onDrag(hnd, {
      start: (_, s) => { s.v = isStat && c.id !== 'minimap' ? c.size : c.size; select(c, isStat); },
      move: (d, s) => {
        const k = (-d.dx + d.dy) * (isStat && c.id !== 'minimap' ? 0.006 : 0.55);
        c.size = isStat && c.id !== 'minimap'
          ? clamp(s.v + k, 0.5, 2.4)
          : clamp(s.v + k, 34, 340);
        store.live(() => {});
        layout(); buildSide();
      },
      end: () => store.snap('تغيير حجم'),
    });
    return { node: n, body, cfg: c, isStat };
  }

  function statPreview(c) {
    if (c.id === 'kills') return '💀 3';
    if (c.id === 'rank') return '🏆 #7';
    if (c.id === 'alive') return '👥 12';
    if (c.id === 'hp') return '❤️ 100/100';
    if (c.id === 'minimap') return '🗺️';
    return c.id;
  }

  function build() {
    for (const [, v] of nodes) v.node.remove();
    nodes.clear();
    for (const c of P().controls.layout) {
      const n = makeNode(c, false);
      nodes.set(c, n); screen.append(n.node);
    }
    for (const s of P().controls.stats) {
      const n = makeNode(s, true);
      nodes.set(s, n); screen.append(n.node);
    }
    layout();
  }

  function layout() {
    const r = screen.getBoundingClientRect();
    const k = r.height / 720 * (P().controls.scale || 1);
    for (const [c, v] of nodes) {
      const size = v.isStat && c.id !== 'minimap' ? 108 * (c.size || 1) : c.size * k;
      const hh = v.isStat && c.id !== 'minimap' ? 34 * (c.size || 1) : size;
      v.node.style.width = size + 'px';
      v.node.style.height = hh + 'px';
      v.node.style.left = c.x * r.width - size / 2 + 'px';
      v.node.style.top = c.y * r.height - hh / 2 + 'px';
      v.node.style.opacity = c.visible ? (c.opacity ?? 0.92) : 0.25;
      v.node.classList.toggle('sel', sel === c);
    }
  }

  function select(c, isStat) {
    sel = c;
    layout();
    buildSide();
  }

  // ---------------- اللوحة الجانبية ----------------
  const head = el('div', { class: 'side-head' }, '🎮 أزرار التحكم');
  const body = el('div', { class: 'side-body' });
  const foot = el('div', { class: 'side-foot' },
    el('button', { class: 'btn ghost sm', onclick: () => { resetLayout(); } }, '↺ افتراضي'),
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn y', onclick: () => ctx.goto(2) }, 'التالي: الخريطة ←'));
  side.append(head, body, foot);

  function buildSide() {
    body.innerHTML = '';

    // ---- قائمة الأزرار ----
    const s1 = el('div', { class: 'sec' }, el('h4', {}, 'الأزرار'));
    const list = el('div', { class: 'list' });
    for (const c of P().controls.layout) {
      const def = CONTROL_DEFS[c.id];
      const ic = el('div', { class: 'ic' });
      ic.append(c.icon && assetURL(c.icon) ? el('img', { src: assetURL(c.icon) }) : document.createTextNode(c.emoji || '•'));
      const li = el('div', { class: 'li' + (sel === c ? ' on' : '') },
        ic, el('div', { class: 'nm' }, def.label),
        el('span', { class: 'x', onclick: (e) => {
          e.stopPropagation();
          store.edit('إظهار/إخفاء', () => { c.visible = !c.visible; });
          layout(); buildSide();
        } }, c.visible ? '👁️' : '🚫'));
      li.onclick = () => select(c, false);
      list.append(li);
    }
    s1.append(list);
    body.append(s1);

    // ---- الإحصاءات ----
    const s2 = el('div', { class: 'sec' }, el('h4', {}, 'واجهة المعلومات'));
    const list2 = el('div', { class: 'list' });
    for (const c of P().controls.stats) {
      const li = el('div', { class: 'li' + (sel === c ? ' on' : '') },
        el('div', { class: 'ic' }, STAT_DEFS[c.id]?.emo || '•'),
        el('div', { class: 'nm' }, STAT_DEFS[c.id]?.label || c.id),
        el('span', { class: 'x', onclick: (e) => {
          e.stopPropagation();
          store.edit('إظهار/إخفاء', () => { c.visible = !c.visible; });
          layout(); buildSide();
        } }, c.visible ? '👁️' : '🚫'));
      li.onclick = () => select(c, true);
      list2.append(li);
    }
    s2.append(list2);
    body.append(s2);

    // ---- خصائص المحدّد ----
    if (sel) {
      const isStat = !!STAT_DEFS[sel.id] && !CONTROL_DEFS[sel.id];
      const def = isStat ? STAT_DEFS[sel.id] : CONTROL_DEFS[sel.id];
      const s3 = el('div', { class: 'sec' }, el('h4', {}, '⚙️ ' + (def?.label || sel.id)));

      if (!isStat || sel.id === 'minimap') {
        s3.append(slider({ label: 'الحجم', min: isStat ? 80 : 34, max: isStat ? 400 : 340, value: sel.size,
          onInput: (v) => { store.live(() => { sel.size = v; }); layout(); } }));
      } else {
        s3.append(slider({ label: 'الحجم', min: 0.5, max: 2.4, step: 0.05, value: sel.size || 1,
          onInput: (v) => { store.live(() => { sel.size = v; }); layout(); } }));
      }
      if (!isStat) {
        s3.append(slider({ label: 'الشفافية', min: 0.2, max: 1, step: 0.02, value: sel.opacity ?? .92,
          onInput: (v) => { store.live(() => { sel.opacity = v; }); layout(); } }));
        s3.append(el('div', { class: 'row', style: { marginBottom: '10px' } },
          el('label', { style: { flex: 1, fontSize: '12.5px', fontWeight: 800, color: 'var(--ink-2)' } }, 'الشكل'),
          el('button', { class: 'btn sm ' + (sel.shape !== 'sq' ? 'c' : 'ghost'), onclick: () => {
            store.edit('شكل الزر', () => { sel.shape = 'round'; }); build(); buildSide();
          } }, '⭕'),
          el('button', { class: 'btn sm ' + (sel.shape === 'sq' ? 'c' : 'ghost'), onclick: () => {
            store.edit('شكل الزر', () => { sel.shape = 'sq'; }); build(); buildSide();
          } }, '⬛')));
      }
      s3.append(toggleRow('ظاهر أثناء اللعب', sel.visible, (v) => {
        store.edit('إظهار/إخفاء', () => { sel.visible = v; }); layout(); buildSide();
      }));

      // الأيقونة
      s3.append(el('div', { class: 'sep' }));
      s3.append(el('div', { class: 'hint', style: { marginBottom: '8px' } },
        'ارفع صورة لتكون أيقونة الزر (PNG شفاف يعطي أفضل نتيجة).'));
      const iconRow = el('div', { class: 'row' },
        el('button', { class: 'btn c sm', onclick: async () => {
          const f = await pickFile('image/*');
          if (!f) return;
          const a = await importFile(f, 'image');
          store.edit('تغيير أيقونة', () => { sel.icon = a.id; });
          build(); buildSide(); toast('تم تعيين الأيقونة', 'ok');
        } }, '🖼️ رفع صورة'),
        sel.icon ? el('button', { class: 'btn r sm', onclick: () => {
          store.edit('حذف أيقونة', () => { sel.icon = null; });
          build(); buildSide();
        } }, '✕ إزالة') : null);
      s3.append(iconRow);

      if (!isStat) {
        const emos = ['🕹️','🎯','🔫','⬆️','🏃','⬇️','📦','✋','🔄','😀','💥','🛡️','⚡','🔥','👊','🧨','🪂','🔭'];
        const g = el('div', { class: 'grid3', style: { marginTop: '10px' } });
        for (const e of emos) {
          g.append(el('div', { class: 'tool' + (sel.emoji === e && !sel.icon ? ' on' : ''), onclick: () => {
            store.edit('تغيير رمز', () => { sel.emoji = e; sel.icon = null; });
            build(); buildSide();
          } }, el('span', { class: 'e' }, e)));
        }
        s3.append(el('div', { class: 'hint', style: { margin: '10px 0 6px' } }, 'أو اختر رمزاً جاهزاً:'), g);
      }
      body.append(s3);
    } else {
      body.append(el('div', { class: 'hint', style: { padding: '10px 0' } },
        'اختر زراً من القائمة أو من المعاينة لتعديل حجمه وأيقونته ومكانه.'));
    }

    // ---- إعدادات عامة ----
    const s4 = el('div', { class: 'sec' }, el('h4', {}, 'إعدادات عامة'));
    s4.append(slider({ label: 'تكبير كل الأزرار', min: 0.6, max: 1.8, step: 0.05, value: P().controls.scale || 1,
      onInput: (v) => { store.live((d) => { d.controls.scale = v; }); layout(); } }));
    body.append(s4);
  }

  function resetLayout() {
    store.edit('إعادة ترتيب افتراضي', (d) => { d.controls = defaultProject().controls; });
    sel = null;
    build(); buildSide();
    toast('تمت الاستعادة', 'ok');
  }

  build();
  buildSide();
  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(view);

  return { unmount() { ro.disconnect(); } };
}
