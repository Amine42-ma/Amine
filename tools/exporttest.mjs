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
const gs = await page2.evaluate(() => ({
  phase: window.__game.phase, crates: window.__game.crates.length,
  bnd: window.__game.boundary.length, bots: window.__game.bots.length,
  span: Math.round(window.__game.an.span),
}));
console.log('exported game state:', JSON.stringify(gs));

console.log('\n=== builder errors ===\n' + ([...new Set(errors)].join('\n') || '(none)'));
console.log('=== exported errors ===\n' + ([...new Set(err2)].join('\n') || '(none)'));
await browser.close();
