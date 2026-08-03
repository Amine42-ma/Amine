// ============================================================
//  المرحلة 4 — التجربة والتصدير إلى ملف HTML واحد
// ============================================================
import { el, toast, fmtBytes, download, modal, abToB64, toggleRow } from '../core/util.js';
import { store, P } from '../core/store.js';
import { getAsset, listAssets, totalAssetBytes } from '../core/assets.js';
import { launchRuntime } from '../runtime.js';

/** كل الأصول المستخدمة فعلياً في المشروع */
export function usedAssetIds(p = P()) {
  const s = new Set();
  const add = (x) => x && s.add(x);
  add(p.map.assetId); add(p.map.shipAssetId); add(p.map.crateAssetId);
  for (const c of p.controls.layout) add(c.icon);
  for (const c of p.controls.stats) add(c.icon);
  add(p.lobby.bgAssetId);
  for (const b of p.lobby.buttons) add(b.icon);
  for (const it of p.lobby.shop) add(it.icon);
  for (const h of p.lobby.heroes || []) {
    add(h.icon);
    for (const a of h.attachments || []) add(a.assetId);
  }
  return s;
}

export function mountStage4(view, side, ctx) {
  const box = el('div', {
    style: { position: 'absolute', inset: '0', overflowY: 'auto', padding: '26px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' },
  });
  view.append(box);

  const used = usedAssetIds();
  const bytes = totalAssetBytes(used);
  const gzipSupported = typeof CompressionStream === 'function';
  let gzipOn = gzipSupported;

  const card = el('div', { class: 'card', style: { padding: '24px', width: 'min(680px,100%)' } },
    el('div', { style: { fontSize: '22px', fontWeight: '900', marginBottom: '6px' } }, '📦 تصدير اللعبة'),
    el('div', { class: 'hint', style: { marginBottom: '16px' } },
      'يتم توليد ملف HTML واحد يحتوي على المحرّك والخريطة والنماذج والأصوات والإعدادات. يعمل بلا إنترنت بمجرد فتحه في المتصفح.'));

  const rows = el('div', { style: { display: 'grid', gap: '8px', marginBottom: '16px' } });
  const row = (k, v) => el('div', { class: 'row', style: { justifyContent: 'space-between',
    padding: '9px 12px', background: 'rgba(255,255,255,.05)', borderRadius: '10px', fontSize: '13.5px' } },
    el('span', {}, k), el('b', { style: { color: 'var(--acc)' } }, v));
  const M = P().map;
  rows.append(
    row('الخريطة', getAsset(M.assetId)?.name || '— غير محددة —'),
    row('الطائرة', getAsset(M.shipAssetId)?.name || '— بدون —'),
    row('الصندوق', getAsset(M.crateAssetId)?.name || '— بدون —'),
    row('الصناديق الموزّعة', M.crates.length),
    row('مسارات الطيران', M.paths.length || 'عشوائي'),
    row('نقاط الحدود', M.boundary.poly?.length || 0),
    row('أزرار التحكم الظاهرة', P().controls.layout.filter((c) => c.visible).length),
    row('أزرار القائمة', P().lobby.buttons.filter((b) => b.visible).length),
    row('الأصدقاء', P().lobby.friends.length),
    row('الأبطال', (P().lobby.heroes || []).length),
    row('نماذج الأبطال',
      (P().lobby.heroes || []).reduce((n, h) => n + (h.attachments || []).length, 0)),
    row('الزون', P().map.zone?.enabled ? `${P().map.zone.phases} مراحل` : 'مُعطّل'),
    row('مسار الطائرة', P().map.flight.mode === 'manual' ? 'يدوي' : 'تلقائي (يتغيّر كل مباراة)'),
    row('عدد الخصوم', P().match.bots),
    row('حجم الأصول', fmtBytes(bytes)),
    row('الحجم المتوقع للملف',
      fmtBytes(gzipOn ? bytes * 0.62 + 900 * 1024 : bytes * 1.37 + 900 * 1024)));
  card.append(rows);
  const sizeRow = rows.lastChild.querySelector('b');
  if (gzipSupported) {
    card.append(toggleRow('ضغط الملف بلا فقدان جودة (gzip)', gzipOn, (v) => {
      gzipOn = v;
      sizeRow.textContent = fmtBytes(v ? bytes * 0.62 + 900 * 1024 : bytes * 1.37 + 900 * 1024);
    }));
    card.append(el('div', { class: 'hint', style: { marginBottom: '14px' } },
      'الضغط لا يمسّ النماذج ولا الصور — البيانات نفسها بالضبط، تُفكّ داخل المتصفح عند الفتح. ' +
      'أطفئه فقط إن أردت فتح اللعبة في متصفح قديم جداً.'));
  }

  card.append(el('div', { class: 'row wrap', style: { gap: '10px' } },
    el('button', { class: 'btn g xl', onclick: () => test() }, '▶️ تجربة اللعبة الآن'),
    el('button', { class: 'btn y xl', onclick: () => doExport() }, '⬇️ تنزيل ملف HTML واحد')));

  card.append(el('div', { class: 'sep' }));
  card.append(el('div', { class: 'hint' },
    '💡 نصيحة: الملف كبير لأن نماذج GLB مُضمّنة داخله. افتحه من الحاسوب مباشرة أو ارفعه لأي استضافة ثابتة. ' +
    'كل تقدّمك في المحرّر محفوظ في هذا المتصفح، ويمكنك العودة لأي مرحلة وتعديلها ثم إعادة التصدير.'));
  box.append(card);

  // بطاقة الحفظ
  box.append(el('div', { class: 'card', style: { padding: '18px', width: 'min(680px,100%)' } },
    el('div', { style: { fontWeight: '900', marginBottom: '8px' } }, '💾 مشروعك'),
    el('div', { class: 'row wrap', style: { gap: '8px' } },
      el('button', { class: 'btn ghost sm', onclick: () => {
        download('royal-project.json', JSON.stringify(P(), null, 2), 'application/json');
        toast('تم حفظ ملف الإعدادات', 'ok');
      } }, '⬇️ تصدير الإعدادات (JSON)'),
      el('button', { class: 'btn ghost sm', onclick: () => importProject() }, '⬆️ استيراد إعدادات'))));

  // ---------------- تجربة ----------------
  function test() {
    const host = el('div', { style: { position: 'fixed', inset: '0', zIndex: '500', background: '#000' } });
    document.body.append(host);
    const back = el('button', {
      class: 'btn r sm',
      style: { position: 'fixed', top: '10px', left: '10px', zIndex: '600' },
      onclick: () => { app?.dispose(); host.remove(); },
    }, '✕ خروج');
    document.body.append(back);
    let app = null;
    launchRuntime(host, P(), { onExit: () => { app?.dispose(); host.remove(); back.remove(); } })
      .then((a) => { app = a; })
      .catch((e) => { console.error(e); toast('خطأ: ' + e.message, 'err'); host.remove(); back.remove(); });
    const obs = new MutationObserver(() => { if (!document.body.contains(host)) { back.remove(); obs.disconnect(); } });
    obs.observe(document.body, { childList: true });
  }

  // ---------------- التصدير ----------------
  async function doExport() {
    const engine = document.getElementById('royal-engine')?.textContent;
    const css = document.getElementById('royal-css')?.textContent;
    if (!engine) return toast('تعذّر العثور على المحرّك داخل الصفحة', 'err');

    const m = modal({
      title: '📦 جارٍ التصدير…',
      body: el('div', {},
        el('div', { class: 'bar' }, el('i')),
        el('div', { class: 'hint', id: 'expmsg', style: { marginTop: '10px' } }, 'تحضير…')),
      actions: [],
    });
    const bar = m.content.querySelector('.bar>i');
    const msg = m.content.querySelector('#expmsg');
    const yield_ = () => new Promise((r) => setTimeout(r, 12));

    try {
      const proj = JSON.parse(JSON.stringify(P()));
      proj.stage = 1;
      const ids = usedAssetIds(proj);
      const assets = listAssets().filter((a) => ids.has(a.id));

      const parts = [];
      parts.push(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="theme-color" content="#120b2e">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%91%91%3C/text%3E%3C/svg%3E">
<title>${escapeHtml(proj.meta.name || 'بطل رويال')}</title>
</head>
<body>
<style id="royal-css">${css}</style>
<div id="app"></div>
<script id="royal-payload" type="application/json">`);

      parts.push('{"mode":"game","project":');
      parts.push(safeJSON(proj));
      parts.push(',"assets":[');
      for (let i = 0; i < assets.length; i++) {
        const a = assets[i];
        msg.textContent = `ترميز «${a.name}» (${i + 1}/${assets.length})…`;
        bar.style.width = (8 + (i / Math.max(assets.length, 1)) * 78) + '%';
        await yield_();
        if (i) parts.push(',');
        parts.push('{"id":' + safeJSON(a.id) + ',"name":' + safeJSON(a.name) +
          ',"kind":' + safeJSON(a.kind) + ',"mime":' + safeJSON(a.mime) + ',"b64":"');
        parts.push(abToB64(a.buf));
        parts.push('"}');
      }
      parts.push(']}');

      // ---- ضغط الحمولة بلا أي فقدان للجودة (gzip) ----
      const canGzip = typeof CompressionStream === 'function' && gzipOn;
      let payloadTag;
      if (canGzip) {
        msg.textContent = 'ضغط الحمولة (بلا فقدان جودة)…';
        bar.style.width = '86%';
        await yield_();
        const raw = new Blob(parts.slice(1));          // كل شيء عدا ترويسة HTML
        const gz = await new Response(
          raw.stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
        msg.textContent = 'ترميز الحمولة المضغوطة…';
        bar.style.width = '90%';
        await yield_();
        payloadTag = ['<script id="royal-payload-gz" type="text/plain">', abToB64(gz)];
        parts.length = 1;                              // أبقِ الترويسة فقط
        parts[0] = parts[0].replace('<script id="royal-payload" type="application/json">', '');
        parts.push(...payloadTag);
      }
      parts.push('<\/script>\n<script id="royal-engine">');
      parts.push(engine);
      parts.push('<\/script>\n</body>\n</html>\n');

      msg.textContent = 'تجهيز الملف…';
      bar.style.width = '94%';
      await yield_();
      const blob = new Blob(parts, { type: 'text/html;charset=utf-8' });
      bar.style.width = '100%';
      msg.textContent = 'الحجم النهائي: ' + fmtBytes(blob.size);
      await yield_();
      download((proj.meta.name || 'royal-game').replace(/\s+/g, '-') + '.html', blob);
      setTimeout(() => m.close(), 900);
      toast('تم إنشاء الملف (' + fmtBytes(blob.size) + ')', 'ok');
    } catch (e) {
      console.error(e);
      msg.textContent = 'خطأ: ' + e.message;
      toast('فشل التصدير: ' + e.message, 'err');
    }
  }

  function importProject() {
    const i = el('input', { type: 'file', accept: '.json', style: { display: 'none' } });
    document.body.append(i);
    i.onchange = async () => {
      const f = i.files[0]; i.remove();
      if (!f) return;
      try {
        const d = JSON.parse(await f.text());
        store.edit('استيراد إعدادات', (cur) => { Object.assign(cur, d); });
        toast('تم الاستيراد', 'ok');
        ctx.refresh();
      } catch (e) { toast('ملف غير صالح', 'err'); }
    };
    i.click();
  }

  // ---------------- الجانب ----------------
  side.append(
    el('div', { class: 'side-head' }, '📦 التصدير'),
    el('div', { class: 'side-body' },
      el('div', { class: 'sec' }, el('h4', {}, 'إعدادات اللعبة النهائية'),
        toggleRow('المؤثرات الصوتية', P().match.sfx, (v) => store.live((d) => { d.match.sfx = v; })),
        toggleRow('الموسيقى', P().match.music, (v) => store.live((d) => { d.match.music = v; })),
        toggleRow('صوت محركات الطائرة', P().match.engineSfx, (v) => store.live((d) => { d.match.engineSfx = v; })),
        el('div', { class: 'field' }, el('label', {}, 'مستوى الرسوميات الافتراضي'),
          (() => {
            const s = el('select', { onchange: (e) => store.live((d) => { d.match.quality = e.target.value; }) });
            for (const [v, t] of [['low', 'منخفض (أجهزة ضعيفة)'], ['auto', 'تلقائي'], ['high', 'عالٍ']])
              s.append(el('option', { value: v, selected: P().match.quality === v }, t));
            return s;
          })()),
        el('div', { class: 'field' }, el('label', {}, 'اسم اللعبة'),
          el('input', { type: 'text', value: P().meta.name, oninput: (e) => store.live((d) => { d.meta.name = e.target.value; }) }))),
      el('div', { class: 'sec' }, el('h4', {}, 'مراحل المشروع'),
        el('div', { class: 'list' },
          el('div', { class: 'li', onclick: () => ctx.goto(1) }, el('div', { class: 'ic' }, '🎮'), el('div', { class: 'nm' }, 'أزرار التحكم')),
          el('div', { class: 'li', onclick: () => ctx.goto(2) }, el('div', { class: 'ic' }, '🗺️'), el('div', { class: 'nm' }, 'الخريطة والمسارات')),
          el('div', { class: 'li', onclick: () => ctx.goto(3) }, el('div', { class: 'ic' }, '🏠'), el('div', { class: 'nm' }, 'القائمة الرئيسية'))))),
    el('div', { class: 'side-foot' },
      el('button', { class: 'btn ghost sm', onclick: () => ctx.goto(3) }, '→ السابق'),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn y', onclick: () => doExport() }, '⬇️ تنزيل')));

  return { unmount() {} };
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const safeJSON = (o) => JSON.stringify(o)
  .replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');
