/** Arabic-first UI strings, with an English mirror behind the language toggle. */

export type Lang = 'ar' | 'en';

type Dict = Record<string, [string, string]>;

const STRINGS: Dict = {
  pitch: [
    'ابدأ بعربة خشبية وحفنة من الذهب، وانتهِ بإمبراطورية تملك المصانع والموانئ والأساطيل. الأسعار يصنعها اللاعبون، لا اللعبة.',
    'Start with a wooden cart and a handful of gold. End owning the factories, the ports and the fleets. Every price here is made by players, not by the game.',
  ],
  merchantName: ['اسم التاجر', 'Merchant name'],
  password: ['كلمة المرور', 'Password'],
  startEmpire: ['ابدأ إمبراطوريتك', 'Start your empire'],
  signIn: ['تسجيل الدخول', 'Sign in'],

  gold: ['ذهب', 'GOLD'],
  netWorth: ['الثروة', 'NET WORTH'],
  cargo: ['الحمولة', 'CARGO'],
  bank: ['البنك', 'BANK'],
  season: ['الموسم', 'SEASON'],

  chatPlaceholder: ['اكتب رسالة… (اضغط Enter)', 'Say something… (press Enter)'],

  market: ['السوق', 'Market'],
  build: ['البناء', 'Build'],
  empire: ['الإمبراطورية', 'Empire'],
  convoys: ['القوافل', 'Convoys'],
  fleet: ['الأسطول', 'Fleet'],
  staff: ['الموظفون', 'Staff'],
  bankPanel: ['البنك', 'Bank'],
  exchange: ['البورصة', 'Exchange'],
  skills: ['المهارات', 'Skills'],
  achievements: ['الإنجازات', 'Achievements'],
  ranking: ['التصنيف', 'Ranking'],
  atlas: ['الأطلس', 'Atlas'],

  buy: ['شراء', 'Buy'],
  sell: ['بيع', 'Sell'],
  price: ['السعر', 'Price'],
  stock: ['المخزون', 'Stock'],
  quantity: ['الكمية', 'Qty'],
  all: ['الكل', 'All'],
  cancel: ['إلغاء', 'Cancel'],
  confirm: ['تأكيد', 'Confirm'],
  close: ['إغلاق', 'Close'],

  notInSettlement: [
    'اقترب من قرية أو مدينة لفتح سوقها.',
    'Walk up to a settlement to open its market.',
  ],
  travelHint: [
    'انقر على الخريطة للتحرك، أو استخدم WASD / الأسهم.',
    'Click the map to travel, or use WASD / arrow keys.',
  ],
  needsShip: [
    'الماء يقطع الطريق — تحتاج سفينة للوصول إلى هناك.',
    'Water blocks the way — you need a ship to reach that.',
  ],
  seaOnly: ['بحري', 'By sea'],
  tariff: ['الرسوم الجمركية', 'Tariff'],
  youCarry: ['تحمل', 'You carry'],

  plots: ['الأراضي', 'Plots'],
  plotPrice: ['سعر الأرض', 'Plot price'],
  upkeep: ['التشغيل', 'Upkeep'],
  jobs: ['الوظائف', 'Jobs'],
  needsWorth: ['يتطلب ثروة', 'Requires net worth'],
  buyBuilding: ['شراء', 'Purchase'],
  sellBuilding: ['بيع المبنى', 'Sell building'],
  noPlots: ['لا توجد أراضٍ متاحة', 'No plots available'],

  production: ['الإنتاج', 'Production'],
  storage: ['المخزن', 'Storage'],
  markup: ['هامش الربح', 'Markup'],
  revenue: ['الإيراد', 'Revenue'],
  loadIn: ['تحميل', 'Load'],
  takeOut: ['سحب', 'Take'],
  paused: ['متوقف', 'Paused'],
  running: ['يعمل', 'Running'],
  assign: ['تعيين', 'Assign'],

  route: ['المسار', 'Route'],
  from: ['من', 'From'],
  to: ['إلى', 'To'],
  vehicle: ['المركبة', 'Vehicle'],
  repeat: ['تكرار تلقائي', 'Auto-repeat'],
  launch: ['إطلاق القافلة', 'Launch convoy'],
  profitPerRun: ['ربح آخر رحلة', 'Last run profit'],
  totalProfit: ['إجمالي الربح', 'Total profit'],
  slotsUsed: ['الخطوط المستخدمة', 'Routes used'],

  hire: ['توظيف', 'Hire'],
  fire: ['تسريح', 'Dismiss'],
  salary: ['الراتب', 'Salary'],
  employed: ['موظف', 'Employed'],
  idle: ['بلا مهمة', 'Idle'],
  payroll: ['الرواتب القادمة', 'Next payroll'],

  deposit: ['إيداع', 'Deposit'],
  withdraw: ['سحب', 'Withdraw'],
  loan: ['قرض', 'Loan'],
  repay: ['سداد', 'Repay'],
  creditScore: ['التقييم الائتماني', 'Credit score'],
  creditLimit: ['حد الائتمان', 'Credit limit'],
  canBorrow: ['المتاح للاقتراض', 'Available to borrow'],
  borrowMax: ['اقترض الحد الأقصى', 'Borrow max'],
  owed: ['المستحق', 'Owed'],
  interest: ['الفائدة', 'Interest'],
  takeLoan: ['اقتراض', 'Borrow'],

  incorporate: ['تأسيس شركة', 'Incorporate'],
  companyName: ['اسم الشركة', 'Company name'],
  floatPercent: ['نسبة الطرح %', 'Float %'],
  ipoPrice: ['سعر السهم', 'Share price'],
  shares: ['الأسهم', 'Shares'],
  valuation: ['القيمة السوقية', 'Valuation'],
  orderBook: ['سجل الأوامر', 'Order book'],
  placeBuy: ['أمر شراء', 'Bid'],
  placeSell: ['أمر بيع', 'Ask'],
  yourHoldings: ['محفظتك', 'Your holdings'],
  noCompanies: ['لا توجد شركات مدرجة بعد. كن الأول.', 'No companies listed yet. Be the first.'],

  level: ['المستوى', 'Level'],
  prestige: ['الهيبة', 'Prestige'],
  locked: ['مقفل', 'Locked'],
  unlocked: ['مفتوح', 'Earned'],

  worldEvents: ['الأحداث العالمية', 'World events'],
  noEvents: ['العالم هادئ… في الوقت الحالي.', 'The world is calm… for now.'],
  seasonEnds: ['ينتهي الموسم خلال', 'Season ends in'],
  seasonReset: [
    'بدأ موسم جديد! أُعيد ضبط الاقتصاد، وبقيت إنجازاتك وهيبتك.',
    'A new season has begun! The economy reset — your achievements and prestige remain.',
  ],

  errShortName: ['الاسم قصير جداً.', 'That name is too short.'],
  errShortPassword: ['كلمة المرور قصيرة جداً (٤ أحرف على الأقل).', 'Password too short (4 characters minimum).'],
  errNameTaken: ['هذا الاسم مستخدم بالفعل.', 'That name is already taken.'],
  errBadCredentials: ['اسم أو كلمة مرور غير صحيحة.', 'Wrong name or password.'],
  errBadToken: ['انتهت الجلسة، سجّل الدخول من جديد.', 'Session expired — please sign in again.'],
  disconnected: ['انقطع الاتصال… جارٍ إعادة المحاولة.', 'Connection lost… reconnecting.'],

  yourEmpire: ['ممتلكاتك', 'Your holdings'],
  nothingYet: ['لم تشترِ أي مبنى بعد.', 'You do not own any buildings yet.'],
  visitToTrade: ['المدن التي زرتها', 'Settlements visited'],
  population: ['السكان', 'Population'],
  region: ['المنطقة', 'Region'],
  distance: ['المسافة', 'Distance'],
  owned: ['تملك', 'Owned'],
  current: ['الحالية', 'Active'],
  equip: ['استخدام', 'Drive'],
  capacity: ['السعة', 'Capacity'],
  speed: ['السرعة', 'Speed'],
  costPerTile: ['تكلفة/مربع', 'Cost/tile'],
};

let current: Lang = 'ar';

export function setLang(lang: Lang) {
  current = lang;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  localStorage.setItem('eom.lang', lang);
  applyStaticStrings();
}

export function getLang(): Lang {
  return current;
}

export function toggleLang() {
  setLang(current === 'ar' ? 'en' : 'ar');
}

/** Looks up a UI string in the active language. */
export function t(key: string): string {
  const entry = STRINGS[key];
  if (!entry) return key;
  return current === 'ar' ? entry[0] : entry[1];
}

/** Picks the right field off a bilingual game object such as a commodity. */
export function name(obj: { ar: string; en: string }): string {
  return current === 'ar' ? obj.ar : obj.en;
}

export function settlementName(s: { name_ar: string; name_en: string }): string {
  return current === 'ar' ? s.name_ar : s.name_en;
}

export function describe(obj: { description_ar?: string; description_en?: string; ar_desc?: string; en_desc?: string }): string {
  if (current === 'ar') return obj.description_ar ?? obj.ar_desc ?? '';
  return obj.description_en ?? obj.en_desc ?? '';
}

export function effect(obj: { ar_effect: string; en_effect: string }): string {
  return current === 'ar' ? obj.ar_effect : obj.en_effect;
}

/** Rewrites every element tagged with data-i18n / data-i18n-ph. */
export function applyStaticStrings() {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n!);
  });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh!);
  });
}

export function initLang() {
  const saved = localStorage.getItem('eom.lang');
  setLang(saved === 'en' ? 'en' : 'ar');
}
