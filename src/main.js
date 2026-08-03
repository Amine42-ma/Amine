// ============================================================
//  نقطة الدخول — تحدّد الوضع: محرّر أم لعبة مُصدَّرة
// ============================================================
import { el, b64ToAb } from './core/util.js';
import { hydrateFromPayload, setEmbeddedMode } from './core/assets.js';
import { store } from './core/store.js';
import { BuilderApp } from './builder/app.js';
import { launchRuntime, loadPrefs } from './runtime.js';
import * as A from './core/audio.js';

function loaderUI(title, sub) {
  const n = el('div', { id: 'loader' },
    el('div', { class: 'box' },
      el('div', { class: 'ttl' }, title),
      el('div', { class: 'sub' }, sub || ''),
      el('div', { class: 'bar' }, el('i'))));
  document.body.append(n);
  return {
    set(t, p) {
      if (t) n.querySelector('.sub').textContent = t;
      if (p !== undefined) n.querySelector('.bar>i').style.width = (p * 100) + '%';
    },
    fail(msg) {
      n.querySelector('.sub').textContent = msg;
      n.querySelector('.sub').style.color = '#ff8a95';
    },
    done() { n.style.transition = 'opacity .35s'; n.style.opacity = '0'; setTimeout(() => n.remove(), 380); },
  };
}

async function main() {
  const app = document.getElementById('app') || document.body;
  let payload = null;
  const gzTag = document.getElementById('royal-payload-gz');
  try {
    if (gzTag) {
      if (typeof DecompressionStream !== 'function') {
        throw new Error('متصفحك لا يدعم فكّ ضغط gzip — استخدم متصفحاً أحدث');
      }
      const bytes = b64ToAb(gzTag.textContent.trim());
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      payload = JSON.parse(await new Response(stream).text());
    } else {
      const raw = document.getElementById('royal-payload')?.textContent?.trim();
      if (raw && raw !== 'null') payload = JSON.parse(raw);
    }
  } catch (e) {
    console.error('payload load failed', e);
    if (gzTag) {
      const ld = loaderUI('👑 بطل رويال', '');
      ld.fail('تعذّر فتح اللعبة: ' + e.message);
      return;
    }
  }

  // ---------------- وضع اللعبة المُصدَّرة ----------------
  if (payload && payload.mode === 'game') {
    const ld = loaderUI('👑 ' + (payload.project?.meta?.name || 'بطل رويال'), 'فك ضغط الأصول…');
    try {
      setEmbeddedMode(true);
      ld.set('تحميل الأصول (' + payload.assets.length + ')…', 0.2);
      await new Promise((r) => setTimeout(r, 30));
      hydrateFromPayload(payload.assets);
      ld.set('بدء اللعبة…', 0.7);
      loadPrefs(payload.project);
      store.data = payload.project;
      A.applySettings(payload.project.match);
      await launchRuntime(app, payload.project, {});
      ld.set('جاهز', 1);
      ld.done();
    } catch (e) {
      console.error(e);
      ld.fail('خطأ: ' + e.message);
    }
    return;
  }

  // ---------------- وضع المحرّر ----------------
  const ld = loaderUI('👑 بطل رويال — محرّك الألعاب', 'تشغيل…');
  try {
    const b = new BuilderApp(app);
    await b.boot((t, p) => ld.set(t, p));
    window.__royal = b;
    ld.done();
  } catch (e) {
    console.error(e);
    ld.fail('خطأ: ' + e.message);
  }
}

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', main);
else main();
