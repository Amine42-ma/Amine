import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = '/tmp/claude-0/-home-user-Amine/84094227-c093-5942-9ac4-953d7d2ce549/scratchpad';
const URL = 'http://127.0.0.1:8099/index.html';
const EXPORTED = OUT + '/exported-game.html';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('[builder] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('[builder] ' + m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);

// visit stage 2 so crates/boundary get generated and stored in the project
await page.evaluate(() => window.__royal.goto(2));
console.log('analysing map in builder…');
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(2000);
  const done = await page.evaluate(() => !!document.querySelector('.toolbar-float button'));
  if (done) { await page.waitForTimeout(2500); break; }   // امنح الحفظ المؤجَّل وقته
}
const proj = await page.evaluate(() => ({
  crates: window.__royal ? JSON.parse(localStorage.getItem('royal-builder-project-v1')).map.crates.length : -1,
  bnd: JSON.parse(localStorage.getItem('royal-builder-project-v1')).map.boundary.poly.length,
}));
console.log('project after stage2:', JSON.stringify(proj));

// export
await page.evaluate(() => window.__royal.goto(4));
await page.waitForTimeout(1500);
const dlP = page.waitForEvent('download', { timeout: 240000 });
await page.locator('button', { hasText: 'تنزيل ملف HTML واحد' }).first().click();
console.log('exporting…');
const dl = await dlP;
await dl.saveAs(EXPORTED);
const size = fs.statSync(EXPORTED).size;
console.log('exported file:', (size / 1048576).toFixed(1), 'MB ->', EXPORTED);

// sanity check the HTML structure
const head = fs.readFileSync(EXPORTED, { encoding: 'utf8', flag: 'r' }).slice(0, 400);
console.log('starts with doctype:', head.startsWith('<!doctype html>'));

await page.close();

// ---- load the exported file standalone (file:// — no server, fully offline) ----
const page2 = await ctx.newPage();
const err2 = [];
page2.on('pageerror', (e) => err2.push('[exported] ' + e.message));
page2.on('console', (m) => { if (m.type() === 'error') err2.push('[exported] ' + m.text()); });
page2.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) console.log('  ⚠ external request:', r.url()); });

await page2.goto('file://' + EXPORTED, { waitUntil: 'domcontentloaded', timeout: 180000 });
console.log('loading exported game…');
for (let i = 0; i < 60; i++) {
  await page2.waitForTimeout(2000);
  const ok = await page2.evaluate(() => !!document.querySelector('#lobby .lb-el[data-kind="play"]'));
  if (ok) { console.log('  lobby ready after', (i + 1) * 2, 's'); break; }
}
await page2.waitForTimeout(3000);
await page2.screenshot({ path: `${OUT}/e1_exported_lobby.png` });

await page2.locator('#lobby .lb-el[data-kind="play"]').first().click();
for (let i = 0; i < 90; i++) {
  await page2.waitForTimeout(2000);
  const st = await page2.evaluate(() => window.__game ? { phase: window.__game.phase } : null);
  if (st) { console.log('  game phase:', st.phase); break; }
}
await page2.waitForTimeout(6000);
await page2.screenshot({ path: `${OUT}/e2_exported_flight.png` });
const gs = await page2.evaluate(() => {
  const g = window.__game;
  return {
    phase: g.phase, crates: g.crates.length, bnd: g.boundary.length, bots: g.bots.length,
    span: Math.round(g.an.span),
    pathPts: g.path.length, dropWindow: [+g.dropFrom.toFixed(2), +g.dropTo.toFixed(2)],
    zone: g.zone ? { r: Math.round(g.zone.r), phases: g.zone.phases, on: g.zone.cfg.enabled } : null,
    heroes: g.P.lobby.heroes.length,
    weapons: g.wdefs.length,
    weaponModels: g.wdefs.filter((w) => {
      const m = g.wmeshCache.get(w.id);
      // النموذج الحقيقي له عدة أجزاء وأسماء من الملف؛ البرمجي مجرد صناديق
      return !!w.assetId && !!m;
    }).length,
    thumbs: Object.values(g.wthumbs || {}).filter((u) => u && u.length > 500).length,
    assetsPresent: g.wdefs.filter((w) => w.assetId && !!g.__assetURL(w.assetId)).length,
    dropAllLand: (() => {
      for (let i = 0; i < 30; i++) {
        const f = g.dropFrom + Math.random() * (g.dropTo - g.dropFrom);
        const p = g.pathAt(f);
        if (!g.Q.isLand(p.x, p.z)) return false;
      }
      return true;
    })(),
  };
});
console.log('exported game state:', JSON.stringify(gs));
if (!gs.dropAllLand) { console.log('❌ نافذة القفز تمرّ فوق الماء في الملف المُصدَّر'); }
if (gs.assetsPresent < gs.weapons) {
  console.log(`❌ نماذج الأسلحة ناقصة في الملف المُصدَّر: ${gs.assetsPresent}/${gs.weapons}`);
} else { console.log(`✅ كل نماذج الأسلحة مضمّنة: ${gs.assetsPresent}/${gs.weapons}`); }
if (gs.thumbs < gs.weapons) console.log(`❌ صور الشريط ناقصة: ${gs.thumbs}/${gs.weapons}`);
else console.log(`✅ صور شريط الأسلحة: ${gs.thumbs}/${gs.weapons}`);
if (!gs.zone?.on) { console.log('❌ الزون غير مفعّل في الملف المُصدَّر'); }
if (gs.heroes < 5) { console.log('❌ الأبطال ناقصون في الملف المُصدَّر'); }

console.log('\n=== builder errors ===\n' + ([...new Set(errors)].join('\n') || '(none)'));
console.log('=== exported errors ===\n' + ([...new Set(err2)].join('\n') || '(none)'));
await browser.close();
