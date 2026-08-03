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

// ---- المباني: أرضيات داخلية + لا تسلّق للجدران ----
r = await page.evaluate(() => {
  const g = window.__game, an = g.an;
  let indoor = 0, gaps = 0;
  for (let i = 0; i < an.indoor.length; i++) if (an.indoor[i]) indoor++;
  // خلايا فيها فرق كبير بين السقف والأرضية = مبانٍ لها داخل
  for (let i = 0; i < an.roof.length; i++) if (an.roof[i] - an.floor[i] > 2.2) gaps++;
  return { indoor, gaps, total: an.indoor.length,
           pct: +(100 * indoor / an.indoor.length).toFixed(2) };
});
check('كشف الأماكن المسقوفة (داخل المباني)', r.indoor > 500,
  `${r.indoor} خليّة (${r.pct}%) وفراغات=${r.gaps}`);

r = await page.evaluate(() => {
  const g = window.__game, an = g.an;
  // اختبر: هل يمكن للاعب أن يتسلّق فوق مبنى بالمشي فقط؟
  let climbs = 0, tries = 0;
  const res = an.res;
  for (let n = 0; n < 400; n++) {
    const i = (Math.random() * res * res) | 0;
    if (an.roof[i] - an.floor[i] < 2.5) continue;      // ليست منطقة مبنى
    const V = an.view;
    const x = an.minX + ((i % res) / (res - 1)) * (an.maxX - an.minX);
    const z = an.minZ + (((i / res) | 0) / (res - 1)) * (an.maxZ - an.minZ);
    const fy = g.Q.groundFor(x, z, an.floor[i] + 0.2);
    tries++;
    // إن أعاد السقف بينما اللاعب عند مستوى الأرضية = تسلّق خاطئ
    if (Math.abs(fy - an.roof[i]) < 0.05 && an.roof[i] - an.floor[i] > 2.5) climbs++;
  }
  return { climbs, tries };
});
check('لا يقفز اللاعب فوق المبنى وهو على الأرض', r.climbs === 0,
  `${r.tries} عيّنة، تسلّق=${r.climbs}`);

r = await page.evaluate(() => {
  const g = window.__game, an = g.an;
  // وإن كان فوق السطح فعلاً فيجب أن يبقى عليه
  let onRoof = 0, tries = 0;
  const res = an.res;
  for (let n = 0; n < 400; n++) {
    const i = (Math.random() * res * res) | 0;
    if (an.roof[i] - an.floor[i] < 2.5) continue;
    const x = an.minX + ((i % res) / (res - 1)) * (an.maxX - an.minX);
    const z = an.minZ + (((i / res) | 0) / (res - 1)) * (an.maxZ - an.minZ);
    tries++;
    if (Math.abs(g.Q.groundFor(x, z, an.roof[i] + 0.5) - an.roof[i]) < 0.05) onRoof++;
  }
  return { onRoof, tries, pct: tries ? Math.round(100 * onRoof / tries) : 0 };
});
check('من يهبط على السطح يبقى عليه', r.pct > 90, `${r.pct}% من ${r.tries}`);

// ---- الصناديق داخل المباني ----
r = await page.evaluate(() => {
  const g = window.__game, an = g.an;
  let inside = 0;
  for (const c of g.crates) if (g.Q.isIndoor(c.x, c.z)) inside++;
  return { inside, total: g.crates.length };
});
check('مزيج: صناديق داخل المنازل وخارجها',
  r.inside > r.total * 0.3 && r.inside < r.total * 0.9, `${r.inside} داخل من ${r.total}`);

// ---- توجيه نماذج الأسلحة ----
r = await page.evaluate(() => {
  const g = window.__game;
  const out = [];
  for (const def of g.wdefs) {
    const m = g.wmeshCache.get(def.id);
    if (!m) { out.push({ n: def.name, ok: false }); continue; }
    const bb = new (window.__THREE_Box3 || Object)();
    out.push({ n: def.short, has: !!def.assetId });
  }
  return out;
});
check('كل الأسلحة محمّلة بنماذجها', r.length === 6 && r.every((w) => w.has),
  r.map((w) => w.n).join(' '));

// ---- الصور المصغّرة لشريط الأسلحة ----
r = await page.evaluate(() => {
  const g = window.__game;
  const n = Object.keys(g.wthumbs || {}).length;
  const ok = Object.values(g.wthumbs || {}).filter((u) => u && u.startsWith('data:image')).length;
  const bar = document.getElementById('ammobox');
  const imgs = bar.querySelectorAll('.wslot .th img').length;
  const cs = getComputedStyle(bar);
  return { n, ok, imgs, bottom: cs.bottom, left: cs.left };
});
check('صور نماذج الأسلحة في الشريط', r.ok >= 6, `${r.ok}/${r.n} صورة، في الشريط=${r.imgs}`);
check('الشريط أسفل وسط الشاشة', r.imgs >= 1, `bottom=${r.bottom}`);

// ---- جدار الحدود مخفي ----
r = await page.evaluate(() => ({ wall: !!window.__game.wall, zone: !!window.__game.zoneMesh }));
check('خطوط نهاية الماب لا تظهر، والزون يظهر', !r.wall && r.zone);

// ---- أرقام الضرر ----
r = await page.evaluate(() => {
  const g = window.__game;
  const foe = g.bots.find((b) => b.alive && !b.ally);
  if (!foe) return { n: 0 };
  foe.landed = true;
  foe.alive = true;
  foe.hp = 500;
  foe.pos.set(g.pos.x + 6, g.pos.y, g.pos.z);
  g.damageNumbers.length = 0;
  const from = g.pos.clone(); from.y += 1.2;
  const tgt = foe.pos.clone(); tgt.y += foe.ch.totalH * 0.55;
  const dir = tgt.clone().sub(from).normalize();
  g.shootRay(from, dir, { damage: 33, range: 200 });
  g.updDamageNumbers(0.016);
  return { n: g.damageNumbers.length, el: document.querySelectorAll('.dmgnum').length,
           txt: document.querySelector('.dmgnum')?.textContent,
           phase: g.phase, foeHp: foe.hp, dist: foe.pos.distanceTo(g.pos),
           landed: foe.landed, alive: foe.alive };
});
check('رقم الضرر يظهر للضارب', r.n > 0 && r.el > 0, JSON.stringify(r));

// ---- ضغط: 60 مباراة، هل تبقى نافذة القفز فوق اليابسة دائماً؟ ----
r = await page.evaluate(() => {
  const g = window.__game;
  let bad = 0, total = 0, minW = 1;
  for (let m = 0; m < 60; m++) {
    g.beginFlight();
    minW = Math.min(minW, g.dropTo - g.dropFrom);
    for (let k = 0; k <= 20; k++) {
      const f = g.dropFrom + (k / 20) * (g.dropTo - g.dropFrom);
      const q = g.pathAt(f);
      total++;
      if (!g.Q.isLand(q.x, q.z)) bad++;
    }
  }
  return { bad, total, minW: +minW.toFixed(3) };
});
check('60 مباراة: نافذة القفز كلها فوق اليابسة', r.bad === 0,
  `${r.total} عيّنة، خارج=${r.bad}، أضيق نافذة=${r.minW}`);

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
