// ============================================================
//  حالة المشروع + تراجع/إعادة + حفظ تلقائي في المتصفح
// ============================================================
import { clone, uid } from './util.js';
import { defaultWeapons } from '../game/weapons.js';

const LS_KEY = 'royal-builder-project-v1';
export const PROJECT_VERSION = 4;

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
  view:   { label: 'تبديل المنظور',  emo: '👁️', kind: 'btn' },
  swap:   { label: 'تبديل السلاح',   emo: '🔁', kind: 'btn' },
  bag:    { label: 'الحقيبة',        emo: '🎒', kind: 'btn' },
  drop:   { label: 'رمي السلاح',     emo: '🗑️', kind: 'btn' },
  scope:  { label: 'التقريب',        emo: '🔭', kind: 'btn' },
};

export const MODES = {
  solo:   { label: 'فردي',  emo: '👤', size: 1 },
  duo:    { label: 'ثنائي', emo: '👥', size: 2 },
  squad:  { label: 'رباعي', emo: '👨‍👩‍👧‍👦', size: 4 },
};

export const SHAPES = {
  round:  { label: 'دائري',  emo: '⭕' },
  sq:     { label: 'مربّع',  emo: '🟦' },
  hex:    { label: 'سداسي',  emo: '⬡' },
  diamond:{ label: 'معيّن',   emo: '🔶' },
  shield: { label: 'درع',    emo: '🛡️' },
};

export const STAT_DEFS = {
  kills:   { label: 'عدّاد القتلى', emo: '💀' },
  rank:    { label: 'الترتيب',      emo: '🏆' },
  alive:   { label: 'الباقون',      emo: '👥' },
  hp:      { label: 'شريط الصحة',   emo: '❤️' },
  minimap: { label: 'الخريطة المصغّرة', emo: '🗺️' },
  zone:    { label: 'مؤقّت الزون',   emo: '⏱️' },
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
  add('view', 0.955, 0.10, 52, 'sq');
  add('swap', 0.60, 0.905, 60, 'sq');
  add('bag', 0.505, 0.905, 60, 'sq');
  add('drop', 0.415, 0.905, 54, 'sq');
  add('scope', 0.815, 0.315, 58);
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
    { id: 'zone',    x: 0.075, y: 0.34, size: 1.0, visible: true, emoji: '⏱️', icon: null },
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

export function defHero(over = {}) {
  return {
    id: uid('hero'), name: 'بطل جديد', unlockTrophies: 0,
    body: '#ffc21a', belly: '#fff3c4', eye: '#101018', outline: '#2a1c00',
    height: 1.0, width: 1.0, eyeSize: 1.0,
    attachments: [],   // [{id,assetId,name,slot,px,py,pz,rx,ry,rz,scale,visible}]
    icon: null,
    ...over,
  };
}

function defHeroes() {
  return [
    defHero({ name: 'شيلي', unlockTrophies: 0, body: '#ffc21a', belly: '#fff3c4', outline: '#2a1c00' }),
    defHero({ name: 'نيتا', unlockTrophies: 500, body: '#39e07b', belly: '#e8ffef', outline: '#0d3a1e' }),
    defHero({ name: 'كولت', unlockTrophies: 1500, body: '#25d3ff', belly: '#e6faff', outline: '#062c3a' }),
    defHero({ name: 'إل بريمو', unlockTrophies: 3000, body: '#ff4d5e', belly: '#ffe6e8', outline: '#3d0a11' }),
    defHero({ name: 'سبايك', unlockTrophies: 6000, body: '#c56bff', belly: '#f4e6ff', outline: '#2a0d40' }),
    defHero({ name: 'كرو', unlockTrophies: 10000, body: '#1f2a3a', belly: '#9fb4c9', outline: '#05080d' }),
  ];
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
      // mode:'auto' = المحرّك يولّد مساراً جديداً كل مباراة (3 نقاط) لا يمرّ إلا فوق اليابسة
      flight: { mode: 'auto', altitude: 190, speed: 105, points: 3, landMargin: 12 },
      zone: {
        enabled: true,
        phases: 7,          // عدد مراحل التقلّص
        holdTime: 45,       // ثوانٍ قبل بدء كل تقلّص
        shrinkTime: 35,     // ثوانٍ للتقلّص نفسه
        firstDelay: 25,     // تأخير أول دائرة بعد الهبوط
        startFactor: 1.0,   // نصف القطر الابتدائي (من نصف قطر الجزيرة)
        finalFactor: 0.05,  // نصف القطر النهائي
        damageStart: 2,     // ضرر/ثانية في المرحلة الأولى
        damageStep: 3,      // زيادة الضرر كل مرحلة
        color: '#25d3ff',
      },
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
      friendsSide: 'right',      // جهة لوحة الأصدقاء: يمين/يسار
      heroes: defHeroes(),       // كل بطل: ألوان + إكسسوارات + كؤوس الفتح
      selectedHero: null,        // يُضبط على أول بطل عند التحميل (انظر normalize)
    },

    weapons: defaultWeapons(),

    match: {
      view: 'tps',            // tps | fps
      mode: 'solo',           // solo | duo | squad (الديو والسكواد للأون لاين فقط)
      online: false,          // true = ضد لاعبين حقيقيين، false = تدريب ضد الروبوتات
      netTransport: 'auto',   // auto | p2p | local
      netBroker: '',          // وسيط مخصّص (اتركه فارغاً للوسيط العام)
      netWait: 25,            // ثوانٍ انتظار اللاعبين قبل البدء
      netMinPlayers: 2,
      lookSens: 1.0,          // حساسية تحريك الكاميرا
      aimAssist: 0.7,         // قوة تسهيل التصويب على الهاتف
      autoFire: false,        // إطلاق تلقائي عند وجود عدو في المرمى
      bots: 24, botSkill: 0.55, matchName: 'ساحة العراك',
      dayTime: 0.42, fog: 0.55, quality: 'auto',
      music: true, sfx: true, engineSfx: true,
    },
  };
}

// ---------------------------------------------------------------
class Store {
  constructor() {
    this.data = normalize(defaultProject());
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
      this.data = normalize(migrate(d));
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
    this.data = normalize(defaultProject());
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

/** يضمن اتساق الحقول المشتقّة */
export function normalize(p) {
  if (!p.lobby.heroes?.length) p.lobby.heroes = defHeroes();
  if (!p.lobby.heroes.find((h) => h.id === p.lobby.selectedHero)) {
    p.lobby.selectedHero = p.lobby.heroes[0].id;
  }
  return p;
}

/** البطل المُختار حالياً (مع حماية من الحذف) */
export function currentHero(p) {
  const H = p.lobby.heroes || [];
  if (!H.length) { H.push(defHero()); }
  return H.find((h) => h.id === p.lobby.selectedHero) || H[0];
}

/** هل فُتح هذا البطل بعدد كؤوس اللاعب؟ */
export const heroUnlocked = (p, h) => (p.player.trophies || 0) >= (h.unlockTrophies || 0);

function migrate(d) {
  const def = defaultProject();
  const out = { ...def, ...d };
  out.controls = { ...def.controls, ...(d.controls || {}) };
  out.map = { ...def.map, ...(d.map || {}) };
  out.map.boundary = { ...def.map.boundary, ...(d.map?.boundary || {}) };
  out.map.flight = { ...def.map.flight, ...(d.map?.flight || {}) };
  out.map.zone = { ...def.map.zone, ...(d.map?.zone || {}) };
  out.lobby = { ...def.lobby, ...(d.lobby || {}) };
  // ترقية المشاريع القديمة: الشخصية الواحدة تصبح أول بطل
  if (!Array.isArray(out.lobby.heroes) || !out.lobby.heroes.length) {
    out.lobby.heroes = def.lobby.heroes;
    if (d.lobby?.character) {
      Object.assign(out.lobby.heroes[0], d.lobby.character, { unlockTrophies: 0 });
    }
  }
  delete out.lobby.character;
  for (const h of out.lobby.heroes) {
    if (!h.id) h.id = uid('hero');
    if (!Array.isArray(h.attachments)) h.attachments = [];
    if (typeof h.unlockTrophies !== 'number') h.unlockTrophies = 0;
  }
  if (!out.lobby.heroes.find((h) => h.id === out.lobby.selectedHero)) {
    out.lobby.selectedHero = out.lobby.heroes[0].id;
  }
  if (out.lobby.friendsSide !== 'left') out.lobby.friendsSide = 'right';
  out.match = { ...def.match, ...(d.match || {}) };
  if (!Array.isArray(out.weapons) || !out.weapons.length) out.weapons = def.weapons;
  for (const w of out.weapons) {
    if (!w.hold) w.hold = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 };
    if (!w.fps) w.fps = { px: 0.26, py: -0.24, pz: -0.52, rx: 0, ry: 0, rz: 0 };
    if (!w.scale) w.scale = 1;
  }
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
