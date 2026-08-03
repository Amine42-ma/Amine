import { chromium } from 'playwright';

const OUT = '/tmp/claude-0/-home-user-Amine/84094227-c093-5942-9ac4-953d7d2ce549/scratchpad';
const URL = 'http://127.0.0.1:8099/index.html';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
const errors = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${t}`);
});
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded' });

async function shot(name, ms = 1500) {
  await page.waitForTimeout(ms);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
}

// Stage 1
await page.waitForTimeout(5000);
await shot('s1_controls', 500);

// Stage 2 (map)
await page.evaluate(() => window.__royal.goto(2));
console.log('waiting for map analysis…');
await page.waitForTimeout(45000);
await shot('s2_map2d', 500);

// switch to 3D
const btn3d = page.locator('.toolbar-float button', { hasText: 'ثلاثي' });
if (await btn3d.count()) { await btn3d.first().click(); await shot('s2_map3d', 3000); }

// Stage 3
await page.evaluate(() => window.__royal.goto(3));
await shot('s3_lobby', 4000);

// Stage 4
await page.evaluate(() => window.__royal.goto(4));
await shot('s4_export', 1500);

console.log('\n=== console issues ===');
console.log([...new Set(errors)].slice(0, 40).join('\n') || '(none)');
await browser.close();
