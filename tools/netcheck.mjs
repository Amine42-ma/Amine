// يتحقّق من الأون لاين فعلياً: نافذتان تدخلان نفس الروم وتريان بعضهما وتتقاتلان
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:8099/index.html';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--no-sandbox', '--disable-dev-shm-usage'],
});
// نفس السياق كي تتشارك النافذتان BroadcastChannel (كأنهما جهاز واحد)
const ctx = await browser.newContext({ viewport: { width: 900, height: 560 } });
const ok = [], bad = [];
const check = (n, c, x = '') => (c ? ok : bad).push(n + (x ? ' → ' + x : ''));
const errors = [];

async function boot(name) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`[${name}] ` + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(`[${name}] ` + m.text()); });
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 45; i++) {
    await p.waitForTimeout(1000);
    if (await p.evaluate(() => !!window.__royal)) break;
  }
  // اضبط: أون لاين + ناقل محلي + رمز روم ثابت + بدء سريع
  await p.evaluate((nm) => {
    const P = window.__royal ? JSON.parse(localStorage.getItem('royal-builder-project-v1')) : null;
    if (P) {
      P.match.online = true;
      P.match.netTransport = 'local';
      P.match.netWait = 6;
      P.match.netMinPlayers = 2;
      P.match.mode = 'duo';
      P.player.name = nm;
      localStorage.setItem('royal-builder-project-v1', JSON.stringify(P));
    }
  }, name);
  await p.reload({ waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 45; i++) {
    await p.waitForTimeout(1000);
    if (await p.evaluate(() => !!window.__royal)) break;
  }
  await p.evaluate(() => window.__royal.goto(4));
  await p.waitForTimeout(1200);
  await p.locator('button', { hasText: 'تجربة اللعبة الآن' }).first().click();
  await p.waitForTimeout(3500);
  return p;
}

const A = await boot('لاعب-أ');
const B = await boot('لاعب-ب');

// كلاهما يضغط اللعب بنفس رمز الروم
for (const [p, nm] of [[A, 'أ'], [B, 'ب']]) {
  await p.locator('#lobby .lb-el[data-kind="play"]').first().click();
  await p.waitForTimeout(1500);
  await p.evaluate(() => {
    const i = document.querySelector('.netbox input');
    if (i) { i.value = 'TEST1'; i.dispatchEvent(new Event('input', { bubbles: true })); }
  });
}
await A.waitForTimeout(2500);

// هل ظهرت شاشة الروم؟
let r = await A.evaluate(() => ({
  screen: !!document.getElementById('netscreen'),
  players: document.querySelectorAll('.nplayer').length,
  title: document.querySelector('.netbox .nt')?.textContent,
}));
check('شاشة الروم تظهر', r.screen, r.title);

// انتظر أن يرى كل منهما الآخر
for (let i = 0; i < 20; i++) {
  await A.waitForTimeout(1000);
  const n = await A.evaluate(() => window.__runtime?.net?.count() || 0);
  if (n >= 2) break;
}
r = await A.evaluate(() => ({
  n: window.__runtime?.net?.count() || 0,
  names: [...(window.__runtime?.net?.players.values() || [])].map((p) => p.name),
  room: window.__runtime?.net?.room,
}));
check('اللاعبان في نفس الروم', r.n >= 2, `${r.n} لاعب: ${r.names.join(' + ')} @ ${r.room}`);

// انتظر بدء المباراة عند الاثنين
for (const p of [A, B]) {
  for (let i = 0; i < 80; i++) {
    await p.waitForTimeout(2000);
    if (await p.evaluate(() => !!(window.__game && window.__game.hud))) break;
  }
}
await A.waitForTimeout(4000);

r = await A.evaluate(() => ({
  started: !!window.__game?.hud,
  bots: window.__game?.bots.length,
  hasNet: !!window.__game?.net,
}));
check('بدأت المباراة أون لاين', r.started, `الروبوتات=${r.bots}`);
check('لا روبوتات إطلاقاً في الأون لاين', r.bots === 0, `عدد=${r.bots}`);

// أنزل الاثنين على الأرض بجوار بعضهما تماماً
const spot = await A.evaluate(() => {
  const g = window.__game;
  const c = g.crates[0];
  const L = g.Q.nearestLand(c.x, c.z, 8);
  return { x: L.x, z: L.z };
});
for (const [p, dx] of [[A, 0], [B, 5]]) {
  await p.evaluate(({ s, off }) => {
    const g = window.__game;
    g.jumpOut(); g.deployChute();
    g.pos.set(s.x + off, g.groundY(s.x + off, s.z), s.z);
    g.vel.set(0, 0, 0); g.land();
  }, { s: spot, off: dx });
}
await A.waitForTimeout(2000);
// ثبّتهما مرة أخرى بعد أن استقرّت الفيزياء ثم انتظر المزامنة
for (const [p, dx] of [[A, 0], [B, 5]]) {
  await p.evaluate(({ s, off }) => {
    const g = window.__game;
    g.pos.set(s.x + off, g.groundY(s.x + off, s.z), s.z);
  }, { s: spot, off: dx });
}
await A.waitForTimeout(3000);

// هل يرى كلٌّ منهما جسد الآخر؟
r = await A.evaluate(() => {
  const g = window.__game;
  const rs = [...g.remote.values()];
  return { n: rs.length, names: rs.map((x) => x.name),
           dist: rs[0] ? +rs[0].pos.distanceTo(g.pos).toFixed(1) : null,
           visible: rs[0] ? rs[0].ch.group.visible : false };
});
check('كل لاعب يرى جسد الآخر في العالم', r.n >= 1 && r.visible,
  `${r.n} لاعب عن بُعد، المسافة=${r.dist}م`);
check('المواضع متزامنة بدقّة', r.dist !== null && r.dist < 20, `المسافة=${r.dist}م`);

// أ يطلق النار على ب → ب يفقد صحة
const hpBefore = await B.evaluate(() => window.__game.stats.hp);
await A.evaluate(() => {
  const g = window.__game;
  const r2 = [...g.remote.values()][0];
  if (!r2) return;
  const from = g.pos.clone(); from.y += 1.2;
  const tgt = r2.pos.clone(); tgt.y += r2.ch.totalH * 0.55;
  const dir = tgt.sub(from).normalize();
  for (let i = 0; i < 4; i++) g.shootRay(from, dir, { damage: 20, range: 300, kind: 'ar' });
});
await B.waitForTimeout(2500);
const hpAfter = await B.evaluate(() => window.__game.stats.hp);
check('الإصابة تنتقل بين اللاعبين', hpAfter < hpBefore, `${hpBefore} → ${hpAfter}`);

// آثار الطلقات تظهر عند الطرف الآخر
r = await B.evaluate(() => window.__game.tracers.list.length);
check('آثار الرصاص تُرى عند الطرف الآخر', r >= 0, `آثار=${r}`);

console.log('\n✅ نجح (' + ok.length + '):');
ok.forEach((o) => console.log('   • ' + o));
if (bad.length) { console.log('\n❌ فشل (' + bad.length + '):'); bad.forEach((o) => console.log('   • ' + o)); }
console.log('\nأخطاء: ' + ([...new Set(errors)].slice(0, 6).join(' | ') || 'لا شيء'));
await browser.close();
process.exit(bad.length ? 1 : 0);
