/** Permanent badges. They survive season resets, unlike gold and property. */

export interface AchievementDef {
  id: string;
  ar: string;
  en: string;
  icon: string;
  ar_desc: string;
  en_desc: string;
  /** Prestige points awarded, which carry across seasons. */
  prestige: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_trade',     ar: 'أول صفقة',        en: 'First Deal',        icon: '🤝', prestige: 1,   ar_desc: 'أتمم أول عملية بيع.',                    en_desc: 'Complete your first sale.' },
  { id: 'first_10k',       ar: 'أول عشرة آلاف',   en: 'First 10K',         icon: '💰', prestige: 2,   ar_desc: 'اجمع ثروة قدرها 10,000 ذهب.',            en_desc: 'Reach a net worth of 10,000 gold.' },
  { id: 'first_shop',      ar: 'أول متجر',        en: 'First Shop',        icon: '🏪', prestige: 3,   ar_desc: 'امتلك أول متجر لك.',                      en_desc: 'Own your first shop.' },
  { id: 'first_factory',   ar: 'أول مصنع',        en: 'First Factory',     icon: '🏭', prestige: 5,   ar_desc: 'امتلك أول مصنع لك.',                      en_desc: 'Own your first factory.' },
  { id: 'first_convoy',    ar: 'أول قافلة',       en: 'First Convoy',      icon: '🚚', prestige: 4,   ar_desc: 'شغّل أول خط قوافل آلي.',                  en_desc: 'Run your first automated convoy route.' },
  { id: 'first_million',   ar: 'أول مليون',       en: 'First Million',     icon: '🥇', prestige: 12,  ar_desc: 'اجمع ثروة قدرها 1,000,000 ذهب.',          en_desc: 'Reach a net worth of 1,000,000 gold.' },
  { id: 'incorporated',    ar: 'تأسيس شركة',      en: 'Incorporated',      icon: '📜', prestige: 8,   ar_desc: 'أسّس شركة مساهمة في البورصة.',           en_desc: 'Take a company public on the exchange.' },
  { id: 'shareholder',     ar: 'مستثمر',          en: 'Shareholder',       icon: '📈', prestige: 5,   ar_desc: 'اشترِ أسهماً في شركة لاعب آخر.',          en_desc: 'Buy shares in another player’s company.' },
  { id: 'banker',          ar: 'صديق البنك',      en: 'Bank’s Friend', icon: '🏦', prestige: 4,  ar_desc: 'سدّد قرضاً كاملاً.',                      en_desc: 'Fully repay a bank loan.' },
  { id: 'biggest_fleet',   ar: 'أكبر أسطول',      en: 'Biggest Fleet',     icon: '⚓', prestige: 15,  ar_desc: 'امتلك عشر مركبات شحن أو أكثر.',           en_desc: 'Own ten or more cargo vehicles.' },
  { id: 'industrialist',   ar: 'صناعي',           en: 'Industrialist',     icon: '⚙️', prestige: 14,  ar_desc: 'امتلك خمسة مصانع.',                       en_desc: 'Own five factories.' },
  { id: 'monopolist',      ar: 'احتكار',          en: 'Monopolist',        icon: '🎩', prestige: 20,  ar_desc: 'سيطر على 40% من تجارة سلعة واحدة.',       en_desc: 'Control 40% of world trade in one good.' },
  { id: 'biggest_company', ar: 'أكبر شركة',       en: 'Biggest Company',   icon: '🏛️', prestige: 22, ar_desc: 'كن صاحب أعلى شركة قيمة في البورصة.',      en_desc: 'Hold the highest-valued company on the exchange.' },
  { id: 'trade_king',      ar: 'ملك التجارة',     en: 'Trade King',        icon: '👑', prestige: 30,  ar_desc: 'اجمع ثروة قدرها 50 مليون ذهب.',           en_desc: 'Reach a net worth of 50,000,000 gold.' },
  { id: 'economy_emperor', ar: 'إمبراطور الاقتصاد', en: 'Economy Emperor', icon: '🌟', prestige: 60,  ar_desc: 'كن الأول في التصنيف العالمي في نهاية موسم.', en_desc: 'Finish a season ranked first in the world.' },
  { id: 'globetrotter',    ar: 'جوّاب آفاق',      en: 'Globetrotter',      icon: '🗺️', prestige: 6,   ar_desc: 'تاجر في عشر مدن مختلفة.',                 en_desc: 'Trade in ten different settlements.' },
  { id: 'survivor',        ar: 'ناجٍ',            en: 'Survivor',          icon: '🌪️', prestige: 7,   ar_desc: 'حقّق ربحاً أثناء أزمة اقتصادية عالمية.',  en_desc: 'Turn a profit during a global economic crisis.' },
];

export const ACHIEVEMENT_BY_ID: Record<string, AchievementDef> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a]),
);
