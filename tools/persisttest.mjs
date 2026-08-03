import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto('http://127.0.0.1:8099/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
await page.evaluate(() => window.__royal.goto(2));
for (let i = 0; i < 100; i++) {
  await page.waitForTimeout(2000);
  const ok = await page.evaluate(() => !!document.querySelector('.toolbar-float button'));
  if (ok) { console.log('stage2 ready after', (i+1)*2, 's'); break; }
}
await page.waitForTimeout(2500);
console.log('saved project:', await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('royal-builder-project-v1'));
  return JSON.stringify({ stage: d.stage, crates: d.map.crates.length, bnd: d.map.boundary.poly.length, paths: d.map.paths.length });
}));
// draw a flight path via the 2D canvas
await page.locator('.toolbar-float button', { hasText: 'رسم المسار' }).click();
const box = await page.locator('canvas.map2d').boundingBox();
for (const [fx,fy] of [[0.25,0.25],[0.5,0.45],[0.75,0.72]]) {
  await page.mouse.click(box.x + box.width*fx, box.y + box.height*fy);
  await page.waitForTimeout(400);
}
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/claude-0/-home-user-Amine/84094227-c093-5942-9ac4-953d7d2ce549/scratchpad/s2_path.png' });
console.log('after drawing path:', await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('royal-builder-project-v1'));
  return JSON.stringify({ paths: d.map.paths.length, pts: d.map.paths[0]?.points.length });
}));
// reload and check we return to stage 2 with everything intact
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
console.log('after reload:', await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('royal-builder-project-v1'));
  return JSON.stringify({ stage: d.stage, crates: d.map.crates.length, paths: d.map.paths.length,
    tabOn: document.querySelector('.stage-tab.on')?.textContent.trim() });
}));
await browser.close();
