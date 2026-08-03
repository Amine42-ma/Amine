// فحص برمجي لطبقة اللعب الجديدة (أسلحة، منظور، حقيبة، علامة، حدود)
import { chromium } from 'playwright';
const URL = 'http://127.0.0.1:8099/index.html';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ok = [], bad = [];
const check = (n, c, x = '') => (c ? ok : bad).push(n + (x ? ' → ' + x : ''));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 40; i++) { await page.waitForTimeout(1000); if (await page.evaluate(() => !!window.__royal)) break; }

await page.evaluate(() => window.__royal.goto(4));
await page.waitForTimeout(1500);
await page.locator('button', { hasText: 'تجربة اللعبة الآن' }).first().click();
await page.waitForTimeout(4000);
await page.locator('#lobby .lb-el[data-kind="play"]').first().click();
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(2000);
  if (await page.evaluate(() => !!(window.__game && window.__game.hud))) break;
}
if (!(await page.evaluate(() => !!(window.__game && window.__game.hud)))) {
  const msg = await page.evaluate(() => document.querySelector('#loader .sub')?.textContent || '(بلا رسالة)');
  console.log('❌ اللعبة لم تبدأ: ' + msg);
  console.log('أخطاء: ' + errors.join(' | '));
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(4000);

// ---- الطائرة: الكاميرا تتحرّك بالسحب ----
let r = await page.evaluate(() => {
  const g = window.__game;
  const y0 = g.flyYaw;
  g.hud.input.look.x = 220; g.hud.input.look.y = 40;
  g.applyLook(0.016, { yawKey: 'flyYaw', pitchKey: 'flyPitch', minP: -0.25, maxP: 1.25 });
  return { phase: g.phase, moved: Math.abs(g.flyYaw - y0) > 0.1, pitch: +g.flyPitch.toFixed(2) };
});
check('الطائرة: الكاميرا تدور بالسحب', r.moved, `الطور=${r.phase}`);

// ---- الهبوط ----
await page.evaluate(() => {
  const g = window.__game;
  g.jumpOut(); g.deployChute();
  const c = g.crates[0];
  g.pos.set(c.x + 3, g.groundY(c.x + 3, c.z), c.z);
  g.vel.set(0, 0, 0);
  g.land();
});
await page.waitForTimeout(2500);

r = await page.evaluate(() => {
  const g = window.__game;
  return { phase: g.phase, hasInv: !!g.inv, gun: g.inv?.gun?.def?.name || null,
           slots: g.inv?.slots.map((s) => s?.def?.short || null),
           ammoBoxOn: document.getElementById('ammobox')?.classList.contains('on'),
           handGun: !!g.handGun && g.handGun.children.length > 0,
           fpsGun: !!g.fpsGun && g.fpsGun.children.length > 0 };
});
check('حقيبة وأسلحة مهيّأة', r.hasInv && !!r.gun, `سلاح البداية=${r.gun}`);
check('بطاقة الذخيرة ظاهرة', r.ammoBoxOn === true);
check('نموذج السلاح في اليد وفي المنظور الأول', r.handGun && r.fpsGun);

// ---- تبديل المنظور ----
r = await page.evaluate(() => {
  const g = window.__game;
  const before = g.view;
  g.toggleView();
  const mid = { view: g.view, bodyHidden: g.player.tilt.visible };
  g.updGunVisibility();
  const vis = { hand: g.handGun.visible, fps: g.fpsGun.visible };
  g.toggleView();
  return { before, mid, vis, after: g.view };
});
check('تبديل المنظور يعمل', r.before === 'tps' && r.mid.view === 'fps' && r.after === 'tps');
check('المنظور الأول: يُخفي الجسم ويُظهر السلاح', r.vis.fps === true && r.vis.hand === false);

// ---- فتح صندوق + التقاط سلاح ----
r = await page.evaluate(async () => {
  const g = window.__game;
  const c = g.crates[0];
  g.pos.set(c.x + 1.5, g.groundY(c.x + 1.5, c.z), c.z);
  g.hud.input.pressed.open = true;
  g.updInteract(0.016);
  await new Promise((s) => setTimeout(s, 300));
  const lootN = g.loot.length;
  // التقط كل الغنائم
  let picked = 0;
  for (let i = 0; i < 12 && g.loot.length; i++) {
    const l = g.loot[0];
    g.pos.set(l.mesh.position.x, g.pos.y, l.mesh.position.z);
    g.take(l); picked++;
  }
  return { lootN, picked, slots: g.inv.slots.map((s) => s?.def?.short || null),
           reserve: { ...g.inv.reserve }, items: { ...g.inv.items } };
});
check('الصندوق يُسقط غنائم', r.lootN >= 3, `عدد=${r.lootN}`);
check('التقاط الأسلحة والذخيرة', r.picked > 0 && r.slots.filter(Boolean).length >= 1,
  `خانات=${JSON.stringify(r.slots)} ذخيرة=${JSON.stringify(r.reserve)}`);

// ---- إطلاق النار + الذخيرة ----
r = await page.evaluate(() => {
  const g = window.__game;
  const gun = g.inv.gun;
  const m0 = gun.mag;
  g.hud.input.shoot = true;
  for (let i = 0; i < 30; i++) { g.fireCd = 0; g.updShoot(0.016); }
  g.hud.input.shoot = false;
  const m1 = g.inv.gun.mag;
  const res0 = g.inv.reserve[gun.def.ammo];
  g.hud.input.pressed.reload = true;
  g.updShoot(0.016);
  g.reloading = 0.001; g.updShoot(0.016);
  return { m0, m1, fired: m0 - m1, magAfter: g.inv.gun.mag, res0, res1: g.inv.reserve[gun.def.ammo] };
});
check('إطلاق النار يستهلك الذخيرة', r.fired > 0, `${r.m0} → ${r.m1}`);
check('إعادة التعبئة من المخزون', r.magAfter > r.m1, `مخزن=${r.magAfter} احتياطي=${r.res0}→${r.res1}`);

// ---- الحقيبة ----
r = await page.evaluate(() => {
  const g = window.__game;
  g.toggleBag();
  const on = document.getElementById('bagpanel').classList.contains('on');
  const rows = document.querySelectorAll('#bagpanel .bag-row').length;
  g.toggleBag();
  return { on, rows, off: !document.getElementById('bagpanel').classList.contains('on') };
});
check('الحقيبة تفتح وتُغلق', r.on && r.off, `صفوف=${r.rows}`);

// ---- تبديل السلاح ----
r = await page.evaluate(() => {
  const g = window.__game;
  const a0 = g.inv.active;
  g.hud.input.pressed.swap = true;
  g.updShoot(0.016);
  return { a0, a1: g.inv.active, two: g.inv.slots.filter(Boolean).length };
});
check('تبديل الخانتين', r.two < 2 || r.a0 !== r.a1, `خانات مشغولة=${r.two}`);

// ---- الحدّ الصلب: لا خروج من الجزيرة ولا الماء ----
r = await page.evaluate(() => {
  const g = window.__game;
  let escaped = 0, wet = 0;
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * 6.28, d = g.an.span * 0.9;
    g.pos.set(g.zone.cx + Math.cos(a) * d, 0, g.zone.cz + Math.sin(a) * d);
    g.clampToIsland();
    if (!g.Q.isLand(g.pos.x, g.pos.z)) wet++;
    const V = g.an.view;
    if (Math.abs(g.pos.x - (V.x0 + V.size / 2)) > V.size || Math.abs(g.pos.z - (V.z0 + V.size / 2)) > V.size) escaped++;
  }
  return { escaped, wet };
});
check('يستحيل الخروج من الجزيرة', r.escaped === 0, `هروب=${r.escaped}`);
check('يستحيل الوقوف في الماء', r.wet === 0, `في الماء=${r.wet}`);

// ---- علامة الوجهة ----
r = await page.evaluate(() => {
  const g = window.__game;
  g.toggleBigMap();
  const cv = g.bigmap.querySelector('canvas');
  const rect = cv.getBoundingClientRect();
  const okSet = g.setWaypoint(rect.width / 2, rect.height / 2);
  g.updMinimap();
  const on = document.getElementById('waypoint').classList.contains('on');
  g.toggleBigMap();
  return { okSet, on, wp: !!g.waypoint };
});
check('وضع علامة وجهة على الخريطة', r.okSet && r.wp && r.on);

// ---- أزرار نهاية المباراة ----
r = await page.evaluate(() => {
  const g = window.__game;
  g.endMatch(false);
  const card = document.getElementById('endcard');
  const btns = card.querySelectorAll('button');
  const cs = getComputedStyle(card);
  return { on: card.classList.contains('on'), n: btns.length, pe: cs.pointerEvents };
});
check('بطاقة النهاية تظهر وأزرارها قابلة للضغط', r.on && r.n >= 2 && r.pe !== 'none',
  `أزرار=${r.n} pointer-events=${r.pe}`);

// اضغط «القائمة» فعلياً
await page.locator('#endcard button', { hasText: 'القائمة' }).click();
await page.waitForTimeout(2500);
r = await page.evaluate(() => document.querySelectorAll('#lobby .lb-el').length);
check('زر «القائمة» يعيدك للقائمة فعلاً', r >= 5, `أزرار القائمة=${r}`);

console.log('\n✅ نجح (' + ok.length + '):');
ok.forEach((o) => console.log('   • ' + o));
if (bad.length) { console.log('\n❌ فشل (' + bad.length + '):'); bad.forEach((o) => console.log('   • ' + o)); }
console.log('\nأخطاء: ' + ([...new Set(errors)].slice(0, 8).join(' | ') || 'لا شيء'));
await browser.close();
process.exit(bad.length ? 1 : 0);
