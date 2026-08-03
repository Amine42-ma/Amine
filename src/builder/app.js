// ============================================================
//  هيكل المحرّر — الشريط العلوي، المراحل، التراجع، التصدير
// ============================================================
import { el, $, toast, confirmBox } from '../core/util.js';
import { store, P } from '../core/store.js';
import { loadAllAssets, fetchBundled, getAsset } from '../core/assets.js';
import * as A from '../core/audio.js';
import { mountStage1 } from './stage1.js';
import { mountStage2 } from './stage2.js';
import { mountStage3 } from './stage3.js';
import { mountStage4 } from './stage4.js';

const STAGES = [
  { n: 1, name: 'أزرار التحكم', emo: '🎮', mount: mountStage1 },
  { n: 2, name: 'الخريطة والمسارات', emo: '🗺️', mount: mountStage2 },
  { n: 3, name: 'القائمة الرئيسية', emo: '🏠', mount: mountStage3 },
  { n: 4, name: 'التصدير', emo: '📦', mount: mountStage4 },
];

// أصول مرفقة بجانب الصفحة (وضع المحرّر من المستودع)
const BUNDLED = [
  { id: 'bundled_map', url: 'assets/map_island.glb', name: 'خريطة الجزيرة', kind: 'glb', field: 'assetId' },
  { id: 'bundled_ship', url: 'assets/spaceship.glb', name: 'الطائرة', kind: 'glb', field: 'shipAssetId' },
  { id: 'bundled_crate', url: 'assets/crate_military.glb', name: 'الصندوق العسكري', kind: 'glb', field: 'crateAssetId' },
];

// نماذج الأسلحة المرفقة — تُربط بتعريفات الأسلحة بمعرّفها الثابت
const BUNDLED_WEAPONS = [
  { id: 'bundled_w_shotgun', url: 'assets/wpn_shotgun.glb', name: 'بندقية خرطوش' },
  { id: 'bundled_w_pistol', url: 'assets/wpn_pistol.glb', name: 'مسدس' },
  { id: 'bundled_w_ak47', url: 'assets/wpn_ak47.glb', name: 'AK-47' },
  { id: 'bundled_w_m4', url: 'assets/wpn_m4.glb', name: 'M4' },
  { id: 'bundled_w_sniper', url: 'assets/wpn_sniper.glb', name: 'بندقية قنص' },
  { id: 'bundled_w_rpg', url: 'assets/wpn_rpg7.glb', name: 'قاذف RPG-7' },
];

export class BuilderApp {
  constructor(root) {
    this.root = root;
    this.current = null;
  }

  async boot(loader) {
    loader?.('تحميل المشروع…', 0.1);
    store.load();
    await loadAllAssets();

    // حمّل الأصول المرفقة إن كانت متاحة (أول تشغيل)
    loader?.('تحضير الأصول…', 0.3);
    for (const b of BUNDLED) {
      const cur = P().map[b.field];
      if (cur && getAsset(cur)) continue;
      try {
        await fetchBundled(b.url, b.name, b.kind, b.id);
        P().map[b.field] = b.id;
        store.save();
      } catch (e) {
        console.warn('bundled asset missing:', b.url);
      }
    }

    for (const w of BUNDLED_WEAPONS) {
      if (getAsset(w.id)) continue;
      try { await fetchBundled(w.url, w.name, 'glb', w.id); }
      catch (e) { console.warn('weapon asset missing:', w.url); }
    }
    A.applySettings(P().match);
    loader?.('بناء الواجهة…', 0.8);
    this.render();
    loader?.('جاهز', 1);
  }

  render() {
    this.root.innerHTML = '';
    this.root.append(el('div', { class: 'scene-bg' }));

    // ---------- الشريط العلوي ----------
    this.tabsHost = el('div', { class: 'stages' });
    const bar = el('div', { id: 'topbar' },
      el('div', { class: 'logo no-mobile' }, '👑 بطل رويال'),
      this.tabsHost,
      el('button', { class: 'btn sm ghost', title: 'تراجع (Ctrl+Z)', onclick: () => this.undo() }, '↶'),
      el('button', { class: 'btn sm ghost', title: 'إعادة (Ctrl+Y)', onclick: () => this.redo() }, '↷'),
      el('button', { class: 'btn sm ghost', title: 'إعادة ضبط المشروع', onclick: () => this.resetAll() }, '🗑️'));
    this.root.append(bar);

    // ---------- منطقة العمل ----------
    this.view = el('div', { id: 'stageview' });
    this.side = el('div', { id: 'side' });
    this.root.append(el('div', { id: 'work' }, this.view, this.side));

    this.buildTabs();
    this.goto(P().stage || 1, true);

    addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'z') { e.preventDefault(); this.undo(); }
      if (e.key === 'y' || (e.key === 'Z' && e.shiftKey)) { e.preventDefault(); this.redo(); }
    });
  }

  buildTabs() {
    this.tabsHost.innerHTML = '';
    for (const s of STAGES) {
      const cur = P().stage === s.n;
      const done = (P().maxStage || 1) > s.n;
      const t = el('div', { class: 'stage-tab' + (cur ? ' on' : '') + (done ? ' done' : ''),
        onclick: () => this.goto(s.n) },
        el('span', { class: 'n' }, done && !cur ? '✓' : s.n),
        el('span', {}, s.emo + ' ' + s.name));
      this.tabsHost.append(t);
    }
  }

  goto(n, silent) {
    if (this.current?.unmount) { try { this.current.unmount(); } catch (e) { console.error(e); } }
    this.view.innerHTML = '';
    this.side.innerHTML = '';
    store.gotoStage(n);
    this.buildTabs();
    const st = STAGES.find((s) => s.n === n) || STAGES[0];
    const ctx = {
      app: this,
      goto: (x) => this.goto(x),
      refresh: () => this.goto(n, true),
      toast,
    };
    try {
      this.current = st.mount(this.view, this.side, ctx) || {};
    } catch (e) {
      console.error(e);
      this.view.append(el('div', { style: { padding: '30px', color: '#ff8a8a' } }, 'خطأ في المرحلة: ' + e.message));
    }
    if (!silent) A.sfx.click();
  }

  undo() {
    const r = store.undo();
    if (!r) return toast('لا يوجد ما يمكن التراجع عنه');
    toast('↶ تراجع: ' + (typeof r === 'string' ? r : ''), 'ok');
    this.goto(P().stage, true);
  }
  redo() {
    const r = store.redo();
    if (!r) return toast('لا يوجد ما يمكن إعادته');
    toast('↷ إعادة: ' + (typeof r === 'string' ? r : ''), 'ok');
    this.goto(P().stage, true);
  }
  async resetAll() {
    if (!(await confirmBox('إعادة ضبط', 'سيتم مسح كل الترتيبات والعودة للإعدادات الافتراضية. متأكد؟', 'مسح الكل'))) return;
    store.reset();
    location.reload();
  }
}
