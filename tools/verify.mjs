// فحص برمجي شامل بلا لقطات شاشة
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

// PNG صغير 8×8 أصفر — نحاكي رفع أيقونة من الهاتف
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAKklEQVR42mP8z8BQz0AEYBxVSF' +
  'ohAGVUCFqhAGFUCFqhAGFUCFqhAGFUCAAA//8DAJ8gA8Fs0oYBAAAAAElFTkSuQmCC', 'base64');

const ok = [];
const bad = [];
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ' → ' + extra : ''));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1000);
  if (await page.evaluate(() => !!window.__royal)) break;
}
if (!(await page.evaluate(() => !!window.__royal))) {
  const msg = await page.evaluate(() => document.querySelector('#loader .sub')?.textContent || '(بلا رسالة)');
  console.log('❌ المحرّر لم يُقلع: ' + msg);
  console.log('أخطاء: ' + errors.join(' | '));
  await browser.close();
  process.exit(1);
}

// ---------- المرحلة 1 ----------
await page.evaluate(() => window.__royal.goto(1));
await page.waitForTimeout(1200);
let r = await page.evaluate(() => ({
  widgets: document.querySelectorAll('#stageview .hw').length,
  stats: document.querySelectorAll('#stageview .hw.sq').length,
  shapes: [...document.querySelectorAll('#stageview .hw')].map((n) => n.className.match(/shape-(\w+)/)?.[1]),
  hasShapePicker: !!document.querySelector('#side .tool'),
}));
check('س1: أزرار الأفعال فقط (15)', r.widgets === 15, `عدد=${r.widgets}`);
check('س1: العدّادات ليست هنا', !r.shapes.includes(undefined));

// اختر زراً ثم بدّل شكله
await page.locator('#side .li').first().click();
await page.waitForTimeout(400);
const shapeBtns = await page.locator('#side .tool').count();
check('س1: منتقي الأشكال ظاهر', shapeBtns >= 5, `أشكال=${shapeBtns}`);
await page.locator('#side .tool').nth(2).click();   // سداسي
await page.waitForTimeout(500);
r = await page.evaluate(() => JSON.parse(localStorage.getItem('royal-builder-project-v1')).controls.layout[0].shape);
check('س1: تغيير الشكل يُحفظ', r === 'hex', 'shape=' + r);

// ---- رفع أيقونة من الجهاز للزر المحدّد ----
{
  const fcP = page.waitForEvent('filechooser', { timeout: 15000 });
  await page.locator('#side button', { hasText: 'رفع صورة' }).first().click();
  const fc = await fcP;
  await fc.setFiles({ name: 'my-icon.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForTimeout(1500);
  const iconOk = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('royal-builder-project-v1'));
    const c = d.controls.layout[0];
    const img = document.querySelector('#stageview .hw .body img');
    return { hasId: !!c.icon, rendered: !!img && img.src.startsWith('blob:') };
  });
  check('س1: رفع أيقونة من الجهاز', iconOk.hasId && iconOk.rendered, JSON.stringify(iconOk));
}

// ---------- المرحلة 2 ----------
await page.evaluate(() => window.__royal.goto(2));
for (let i = 0; i < 80; i++) {
  await page.waitForTimeout(2000);
  if (await page.evaluate(() => !!document.querySelector('.toolbar-float button'))) break;
}
await page.waitForTimeout(2500);
r = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('royal-builder-project-v1'));
  return { crates: d.map.crates.length, bnd: d.map.boundary.poly.length,
           zone: d.map.zone, flightMode: d.map.flight.mode, stats: d.controls.stats.length };
});
check('س2: صناديق موزّعة', r.crates > 20, `عدد=${r.crates}`);
check('س2: حدود مولّدة', r.bnd > 10, `نقاط=${r.bnd}`);
check('س2: الزون مفعّل افتراضياً', r.zone?.enabled === true);
check('س2: مسار الطائرة تلقائي', r.flightMode === 'auto');
check('س2: العدّادات هنا (6)', r.stats === 6, `عدد=${r.stats}`);

// أداة ترتيب الواجهة
await page.locator('.toolbar-float button', { hasText: 'ترتيب الواجهة' }).click();
await page.waitForTimeout(800);
const hudCount = await page.evaluate(() =>
  [...document.querySelectorAll('#stageview .hw')].filter((n) => n.offsetParent).length);
check('س2: ودجات الواجهة قابلة للسحب', hudCount === 6, `عدد=${hudCount}`);

// ---------- المرحلة 3 ----------
await page.evaluate(() => window.__royal.goto(3));
await page.waitForTimeout(4000);
r = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('royal-builder-project-v1'));
  return { heroes: d.lobby.heroes.length, sel: !!d.lobby.selectedHero,
           locks: d.lobby.heroes.map((h) => h.unlockTrophies),
           side: d.lobby.friendsSide, noChar: d.lobby.character === undefined };
});
check('س3: قائمة أبطال', r.heroes >= 5, `عدد=${r.heroes}`);
check('س3: بطل مُختار', r.sel);
check('س3: أقفال كؤوس متدرّجة', r.locks[0] === 0 && r.locks[r.locks.length - 1] > 0, JSON.stringify(r.locks));
check('س3: جهة الأصدقاء محفوظة', !!r.side, r.side);
check('س3: لا بقايا الشخصية القديمة', r.noChar);

// ---------- اللعب ----------
await page.evaluate(() => window.__royal.goto(4));
await page.waitForTimeout(1200);
await page.locator('button', { hasText: 'تجربة اللعبة الآن' }).first().click();
await page.waitForTimeout(4000);
const heroTiles = await page.evaluate(async () => {
  document.querySelector('#lobby .lb-el[data-kind="brawlers"]').click();
  await new Promise((r) => setTimeout(r, 700));
  const cards = [...document.querySelectorAll('.hero-card')];
  return { n: cards.length, locked: cards.filter((c) => c.classList.contains('locked')).length,
           tr: window.__game ? 0 : JSON.parse(localStorage.getItem('royal-builder-project-v1')).player.trophies };
});
check('لعبة: شبكة الأبطال تفتح', heroTiles.n >= 5, `بطاقات=${heroTiles.n}`);
check('لعبة: أبطال مقفلة تظهر مقفلة', heroTiles.locked >= 1,
  `مقفل=${heroTiles.locked} من ${heroTiles.n} (كؤوس اللاعب ${heroTiles.tr})`);
await page.evaluate(() => document.querySelector('.panel-sheet .ph .btn')?.click());
await page.waitForTimeout(600);

await page.locator('#lobby .lb-el[data-kind="play"]').first().click();
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(2000);
  if (await page.evaluate(() => !!window.__game)) break;
}
await page.waitForTimeout(3000);
r = await page.evaluate(() => {
  const g = window.__game;
  return { phase: g.phase, dropFrom: +g.dropFrom.toFixed(3), dropTo: +g.dropTo.toFixed(3),
           pathPts: g.path.length, zone: !!g.zone, zr: Math.round(g.zone.r),
           zphases: g.zone.phases, crates: g.crates.length };
});
check('لعبة: مسار من 3 نقاط + امتداد', r.pathPts === 3, `نقاط=${r.pathPts}`);
check('لعبة: نافذة قفز محدودة', r.dropTo > r.dropFrom && r.dropTo - r.dropFrom < 0.95,
  `${r.dropFrom}..${r.dropTo}`);
check('لعبة: الزون مبني', r.zone, `نق=${r.zr} مراحل=${r.zphases}`);

// نافذة القفز كلها فوق اليابسة؟
const landCheck = await page.evaluate(() => {
  const g = window.__game;
  let all = true, n = 0;
  for (let f = g.dropFrom; f <= g.dropTo; f += 0.02) {
    const p = g.pathAt(f);
    n++;
    if (!g.Q.isLand(p.x, p.z)) all = false;
  }
  return { all, n };
});
check('لعبة: كل نافذة القفز فوق اليابسة', landCheck.all, `عيّنات=${landCheck.n}`);

// اهبط من نقاط مختلفة وتأكّد أن الهبوط دائماً على اليابسة
const drops = await page.evaluate(() => {
  const g = window.__game;
  const out = [];
  for (let i = 0; i < 25; i++) {
    const f = g.dropFrom + Math.random() * (g.dropTo - g.dropFrom);
    const p = g.pathAt(f);
    const L = g.Q.nearestLand(p.x, p.z, 6);
    out.push({ land: g.Q.isLand(L.x, L.z), moved: L.moved });
  }
  return { all: out.every((o) => o.land), moved: out.filter((o) => o.moved).length, n: out.length };
});
check('لعبة: نقاط الهبوط كلها يابسة', drops.all, `${drops.n} عيّنة، صُحّح ${drops.moved}`);

// تعدّد المسارات: كل مباراة في مكان مختلف
const variety = await page.evaluate(() => {
  const g = window.__game;
  const mod = g.__world || null;
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    g.beginFlight();
    seen.add(Math.round(g.path[1].x / 25) + ',' + Math.round(g.path[1].z / 25));
  }
  return seen.size;
});
check('لعبة: المسار يتغيّر كل مباراة', variety >= 8, `${variety}/12 مواقع مختلفة`);

// تقلّص الزون
const zoneRun = await page.evaluate(async () => {
  const g = window.__game;
  g.phase = 'ground';
  // ضع اللاعب في مركز الزون حتى لا يموت من ضرر الخارج أثناء الاختبار
  g.pos.set(g.zone.cx, g.groundY(g.zone.cx, g.zone.cz), g.zone.cz);
  g.stats.hp = 1e6; g.stats.maxHp = 1e6;
  const r0 = g.zone.r;
  const c0 = { x: g.zone.cx, z: g.zone.cz };
  for (let i = 0; i < 4000; i++) {
    g.updZone(0.05);
    g.pos.set(g.zone.cx, g.pos.y, g.zone.cz);   // ابقَ في المركز
  }
  const c = g.zone.cfg;
  let t = 200, ph = 0;
  t -= c.firstDelay;
  while (t >= c.shrinkTime && ph < c.phases) { t -= c.shrinkTime; ph++; t -= c.holdTime; }
  return { r0: Math.round(r0), r1: Math.round(g.zone.r), phase: g.zone.phase, expect: ph,
           moved: Math.round(Math.hypot(g.zone.cx - c0.x, g.zone.cz - c0.z)) };
});
// الجدول: firstDelay + phases×(hold+shrink) = 25 + 7×80 = 585ث. بعد 200ث نتوقّع مرحلتين.
check('لعبة: مراحل الزون تتقدّم بالجدول', zoneRun.phase === zoneRun.expect,
  `مراحل=${zoneRun.phase} المتوقّع=${zoneRun.expect}`);
check('لعبة: الزون يتقلّص فعلاً', zoneRun.r1 < zoneRun.r0 * 0.5,
  `${zoneRun.r0}م → ${zoneRun.r1}م، مراحل=${zoneRun.phase}، تحرّك ${zoneRun.moved}م`);
check('لعبة: مركز الزون يتحرّك', zoneRun.moved > 5, `${zoneRun.moved}م`);

// ---------- الأيقونة المرفوعة تُضمَّن في التصدير ----------
const embed = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('royal-builder-project-v1'));
  const id = d.controls.layout[0].icon;
  return { id, inUse: !!id };
});
check('تصدير: الأيقونة المرفوعة مسجّلة في المشروع', embed.inUse, embed.id || '—');

// ---------- التأقلم مع أي مقاس (نعود للقائمة أولاً) ----------
await page.evaluate(() => window.__runtime.showLobby());
await page.waitForTimeout(2500);
const lobbyBack = await page.evaluate(() => document.querySelectorAll('#lobby .lb-el').length);
check('العودة للقائمة بعد المباراة', lobbyBack >= 5, `أزرار=${lobbyBack}`);

for (const [w, h, name] of [[390, 844, 'جوال طولي'], [844, 390, 'جوال عرضي'],
                            [2560, 1080, 'شاشة عريضة جداً'], [1024, 1366, 'لوح طولي']]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(1500);
  const fit = await page.evaluate(() => {
    const els = [...document.querySelectorAll('#lobby .lb-el')];
    let outside = 0, tiny = 0, ratios = [];
    for (const e of els) {
      const r = e.getBoundingClientRect();
      if (r.left < -2 || r.top < -2 || r.right > innerWidth + 2 || r.bottom > innerHeight + 2) outside++;
      if (r.width < 14 || r.height < 14) tiny++;
      ratios.push(r.width / Math.max(r.height, 1));
    }
    const c = document.querySelector('#lobby .char3d');
    return { n: els.length, outside, tiny,
             maxRatio: +Math.max(...ratios).toFixed(2), minRatio: +Math.min(...ratios).toFixed(2),
             canvas: c ? c.clientWidth > 40 && c.clientHeight > 40 : false };
  });
  check(`تأقلم ${name} (${w}×${h}): كل الأزرار داخل الشاشة`, fit.outside === 0, `خارج=${fit.outside}`);
  check(`تأقلم ${name}: أحجام معقولة`,
    fit.n >= 5 && fit.tiny === 0 && fit.maxRatio < 6 && fit.minRatio > 0.15,
    `${fit.n} أزرار، نسب ${fit.minRatio}..${fit.maxRatio}`);
  check(`تأقلم ${name}: معاينة البطل ظاهرة`, fit.canvas);
}
await page.setViewportSize({ width: 1280, height: 720 });

console.log('\n✅ نجح (' + ok.length + '):');
ok.forEach((o) => console.log('   • ' + o));
if (bad.length) {
  console.log('\n❌ فشل (' + bad.length + '):');
  bad.forEach((o) => console.log('   • ' + o));
}
console.log('\nأخطاء الكونسول: ' + ([...new Set(errors)].join(' | ') || 'لا شيء'));
await browser.close();
process.exit(bad.length ? 1 : 0);
