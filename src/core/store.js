// ============================================================
//  حالة المشروع + تراجع/إعادة + حفظ تلقائي في المتصفح
// ============================================================
import { clone, uid } from './util.js';

const LS_KEY = 'royal-builder-project-v1';
export const PROJECT_VERSION = 3;

export const CONTROL_DEFS = {
  move:   { label: 'التحرك (عصا)',  emo: '🕹️', kind: 'stick' },
  aim:    { label: 'التصويب (عصا)', emo: '🎯', kind: 'stick' },
  shoot:  { label: 'الضرب',         emo: '🔫', kind: 'btn' },
  jump:   { label: 'القفز',         emo: '⬆️', kind: 'btn' },
  run:    { label: 'الجري',         emo: '🏃', kind: 'btn' },
  crouch: { label: 'الانخفاض',      emo: '⬇️', kind: 'btn' },
  open:   { label: 'فتح الصناديق',  emo: '📦', kind: 'btn' },
  pickup: { label: 'التقاط الأشياء', emo: '✋', kind: 'btn' },
  reload: { label: 'إعادة التعبئة', emo: '🔄', kind: 'btn' },
  emote:  { label: 'تعبير',         emo: '😀', kind: 'btn' },
};

export const STAT_DEFS = {
  kills:   { label: 'عدّاد القتلى', emo: '💀' },
  rank:    { label: 'الترتيب',      emo: '🏆' },
  alive:   { label: 'الباقون',      emo: '👥' },
  hp:      { label: 'شريط الصحة',   emo: '❤️' },
  minimap: { label: 'الخريطة المصغّرة', emo: '🗺️' },
};

export const LOBBY_DEFS = {
  play:     { label: 'اللعب',       emo: '▶️', color: '#ffc21a' },
  shop:     { label: 'المتجر',      emo: '🛒', color: '#ff8a1e' },
  brawlers: { label: 'الأبطال',     emo: '🦸', color: '#c56bff' },
  friends:  { label: 'الأصدقاء',    emo: '👥', color: '#25d3ff' },
  club:     { label: 'الاتحاد',     emo: '🛡️', color: '#ff4d5e' },
  news:     { label: 'الأخبار',     emo: '📰', color: '#39e07b' },
  settings: { label: 'الإعدادات',   emo: '⚙️', color: '#8b7fc0' },
  quests:   { label: 'المهام',      emo: '📋', color: '#25d3ff' },
  skins:    { label: 'الأزياء',     emo: '👕', color: '#c56bff' },
  custom:   { label: 'زر مخصص',     emo: '⭐', color: '#ffc21a' },
};

function defControls() {
  const L = [];
  const add = (id, x, y, size, shape = 'round') =>
    L.push({ id, x, y, size, shape, icon: null, emoji: CONTROL_DEFS[id].emo,
             opacity: 0.92, visible: true, color: '#ffffff' });
  add('move', 0.135, 0.735, 150);
  add('aim', 0.875, 0.735, 132);
  add('shoot', 0.735, 0.79, 92);
  add('jump', 0.945, 0.50, 72);
  add('run', 0.815, 0.475, 66);
  add('crouch', 0.70, 0.55, 66);
  add('open', 0.60, 0.80, 66, 'sq');
  add('pickup', 0.505, 0.80, 66, 'sq');
  add('reload', 0.60, 0.63, 60);
  add('emote', 0.06, 0.42, 56);
  L.find((c) => c.id === 'emote').visible = false;
  return L;
}

function defStats() {
  return [
    { id: 'kills',   x: 0.50, y: 0.055, size: 1.0, visible: true, emoji: '💀', icon: null },
    { id: 'rank',    x: 0.615, y: 0.055, size: 1.0, visible: true, emoji: '🏆', icon: null },
    { id: 'alive',   x: 0.385, y: 0.055, size: 1.0, visible: true, emoji: '👥', icon: null },
    { id: 'hp',      x: 0.50, y: 0.935, size: 1.0, visible: true, emoji: '❤️', icon: null },
    { id: 'minimap', x: 0.075, y: 0.16, size: 155, visible: true, emoji: '🗺️', icon: null, zoom: 1 },
  ];
}

function defLobby() {
  const B = [];
  const add = (kind, x, y, w, h, extra = {}) =>
    B.push({ uid: uid('lb'), kind, label: LOBBY_DEFS[kind].label, x, y, w, h,
             icon: null, emoji: LOBBY_DEFS[kind].emo, color: LOBBY_DEFS[kind].color,
             visible: true, badge: '', ...extra });
  add('play', 0.845, 0.845, 0.26, 0.13);
  add('shop', 0.075, 0.30, 0.115, 0.15);
  add('brawlers', 0.075, 0.47, 0.115, 0.15, { badge: '7' });
  add('quests', 0.075, 0.86, 0.10, 0.13);
  add('skins', 0.19, 0.86, 0.10, 0.13);
  add('news', 0.945, 0.17, 0.085, 0.13, { badge: '1' });
  add('friends', 0.945, 0.33, 0.085, 0.13);
  add('club', 0.945, 0.49, 0.085, 0.13);
  add('settings', 0.945, 0.65, 0.085, 0.13);
  return B;
}

export function defaultProject() {
  return {
    version: PROJECT_VERSION,
    stage: 1,
    maxStage: 1,
    meta: { name: 'بطل رويال', created: Date.now(), updated: Date.now() },
    player: { name: 'اللاعب', trophies: 6392, coins: 2588, gems: 45, level: 11, xp: 595, xpMax: 2800 },

    controls: { layout: defControls(), stats: defStats(), scale: 1, opacity: 0.92 },

    map: {
      assetId: null,           // GLB الخريطة
      shipAssetId: null,       // الطائرة/السفينة
      crateAssetId: null,      // الصندوق
      worldScale: 1,
      paths: [],               // [{id,name,points:[{x,z}],color}]
      crates: [],              // [{id,x,y,z,ry,scale}]
      boundary: { mode: 'auto', poly: [] },
      flight: { altitude: 190, speed: 105, minDropTime: 0.12, maxDropTime: 0.88 },
      analysisKey: null,       // مفتاح كاش التحليل
    },

    lobby: {
      bgAssetId: null,
      bgColorA: '#3b1e86',
      bgColorB: '#0b0524',
      buttons: defLobby(),
      friends: [
        { id: uid('f'), name: '水||Sw4th', tag: '#8QY2', online: true },
        { id: uid('f'), name: 'Ya™Zide', tag: '#PL92', online: true },
        { id: uid('f'), name: 'Amine', tag: '#0KK1', online: false },
      ],
      shop: [
        { id: uid('s'), name: 'صندوق نودلز النانو', price: 30, emoji: '🍜', icon: null },
        { id: uid('s'), name: 'حزمة جواهر', price: 45, emoji: '💎', icon: null },
        { id: uid('s'), name: 'زي أسطوري', price: 199, emoji: '👑', icon: null },
      ],
      character: {
        body: '#ffc21a', belly: '#fff3c4', eye: '#101018', outline: '#2a1c00',
        height: 1.0, width: 1.0, eyeSize: 1.0,
        attachments: [],   // [{id,assetId,name,slot,px,py,pz,rx,ry,rz,scale,visible}]
      },
      characters: [],      // شخصيات محفوظة
    },

    match: {
      bots: 24, botSkill: 0.55, matchName: 'ساحة العراك',
      dayTime: 0.42, fog: 0.55, quality: 'auto',
      music: true, sfx: true, engineSfx: true,
    },
  };
}

// ---------------------------------------------------------------
class Store {
  constructor() {
    this.data = defaultProject();
    this.undoStack = [];
    this.redoStack = [];
    this.subs = new Set();
    this._saveT = 0;
  }

  load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return false;
      this.data = migrate(d);
      return true;
    } catch (e) { console.warn('load failed', e); return false; }
  }

  save() {
    this.data.meta.updated = Date.now();
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify(this.data)); }
      catch (e) { console.warn('save failed', e); }
    }, 220);
  }

  reset() {
    this.data = defaultProject();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.save();
    this.emit();
  }

  /** لقطة قبل تعديل — للتراجع */
  snap(label = '') {
    this.undoStack.push({ label, json: JSON.stringify(this.data) });
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo() {
    if (!this.undoStack.length) return false;
    const s = this.undoStack.pop();
    this.redoStack.push({ label: s.label, json: JSON.stringify(this.data) });
    this.data = JSON.parse(s.json);
    this.save(); this.emit();
    return s.label || true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    const s = this.redoStack.pop();
    this.undoStack.push({ label: s.label, json: JSON.stringify(this.data) });
    this.data = JSON.parse(s.json);
    this.save(); this.emit();
    return s.label || true;
  }

  /** تعديل + حفظ + إشعار */
  edit(label, fn) {
    this.snap(label);
    fn(this.data);
    this.save();
    this.emit();
  }

  /** تعديل مستمر (سحب) بدون إغراق مكدس التراجع */
  live(fn) { fn(this.data); this.save(); }

  sub(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  emit() { for (const f of this.subs) { try { f(this.data); } catch (e) { console.error(e); } } }

  gotoStage(n) {
    this.data.stage = n;
    this.data.maxStage = Math.max(this.data.maxStage || 1, n);
    this.save(); this.emit();
  }
}

function migrate(d) {
  const def = defaultProject();
  const out = { ...def, ...d };
  out.controls = { ...def.controls, ...(d.controls || {}) };
  out.map = { ...def.map, ...(d.map || {}) };
  out.map.boundary = { ...def.map.boundary, ...(d.map?.boundary || {}) };
  out.map.flight = { ...def.map.flight, ...(d.map?.flight || {}) };
  out.lobby = { ...def.lobby, ...(d.lobby || {}) };
  out.lobby.character = { ...def.lobby.character, ...(d.lobby?.character || {}) };
  out.match = { ...def.match, ...(d.match || {}) };
  out.player = { ...def.player, ...(d.player || {}) };
  // تأكّد من وجود كل أزرار التحكم والإحصاءات
  const have = new Set((out.controls.layout || []).map((c) => c.id));
  for (const c of def.controls.layout) if (!have.has(c.id)) out.controls.layout.push(c);
  const haveS = new Set((out.controls.stats || []).map((c) => c.id));
  for (const c of def.controls.stats) if (!haveS.has(c.id)) out.controls.stats.push(c);
  out.version = PROJECT_VERSION;
  return out;
}

export const store = new Store();
export const P = () => store.data;
export { clone };
