import { chromium } from 'playwright';

const OUT = '/tmp/claude-0/-home-user-Amine/84094227-c093-5942-9ac4-953d7d2ce549/scratchpad';
const URL = 'http://127.0.0.1:8099/index.html';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);

// jump straight to export stage and hit "play"
await page.evaluate(() => window.__royal.goto(4));
await page.waitForTimeout(1200);
await page.locator('button', { hasText: 'تجربة اللعبة الآن' }).first().click();
await page.waitForTimeout(4000);
await page.screenshot({ path: `${OUT}/g0_lobby.png` });
await page.locator('#lobby .lb-el[data-kind="play"]').first().click();
console.log('launching game…');

// wait for loader to finish
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(2000);
  const st = await page.evaluate(() => {
    const l = document.querySelector('#loader .sub');
    const g = document.querySelector('#gameroot');
    return { sub: l?.textContent || null, hasGame: !!g, bar: document.querySelector('#loader .bar>i')?.style.width };
  });
  if (i % 5 === 0) console.log(' ', i * 2 + 's', JSON.stringify(st));
  if (st.hasGame && !st.sub) break;
  if (st.hasGame && st.bar === '100%') break;
}
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/g1_flight.png` });
console.log('shot flight');

// jump out (drive directly: swiftshader runs at ~2fps so sim-time crawls)
console.log('state', JSON.stringify(await page.evaluate(() => ({
  phase: window.__game.phase, flightT: +window.__game.flightT.toFixed(2),
  dur: +window.__game.flightDur.toFixed(2), span: Math.round(window.__game.an.span),
  crates: window.__game.crates.length, bnd: window.__game.boundary.length,
  bots: window.__game.bots.length, water: +window.__game.an.waterY.toFixed(2),
}))));
await page.evaluate(() => window.__game.jumpOut());
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/g2_freefall.png` });
console.log('shot freefall');
await page.evaluate(() => window.__game.deployChute());
await page.waitForTimeout(4000);
await page.screenshot({ path: `${OUT}/g3_chute.png` });

// teleport to the ground near a crate and land
await page.evaluate(() => {
  const g = window.__game;
  const c = g.crates[0];
  g.pos.set(c.x + 3, g.groundY(c.x + 3, c.z) + 1, c.z);
  g.vel.set(0, 0, 0);
  g.land();
});
await page.waitForTimeout(4000);
await page.screenshot({ path: `${OUT}/g4_ground.png` });
console.log('shot ground');

// open a crate + shoot
await page.evaluate(() => { window.__game.hud.input.pressed.open = true; });
await page.waitForTimeout(3000);
await page.evaluate(() => { window.__game.hud.input.shoot = true; });
await page.waitForTimeout(2000);
await page.evaluate(() => { window.__game.hud.input.shoot = false; });
await page.screenshot({ path: `${OUT}/g5_moved.png` });
console.log('ground state', JSON.stringify(await page.evaluate(() => ({
  phase: window.__game.phase, hp: window.__game.stats.hp, ammo: window.__game.stats.ammo,
  opened: window.__game.crates.filter((c) => c.opened).length,
  loot: window.__game.loot.length,
  y: +window.__game.pos.y.toFixed(2),
  inside: window.__game.boundary.length > 2,
}))));

// open big map
await page.evaluate(() => window.__game.toggleBigMap());
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/g6_bigmap.png` });

console.log('\n=== errors ===');
console.log([...new Set(errors)].slice(0, 20).join('\n---\n') || '(none)');
await browser.close();
