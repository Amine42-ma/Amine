import { config } from '../config.js';
import { log } from '../util/log.js';
import { MOODS, DEFAULT_MOOD } from '../util/palette.js';
import { buildSystemPrompt, buildUserPrompt } from './prompt.js';

// ---------------------------------------------------------------------------
// Public entry: produce a normalised production plan from a spec.
// Uses Claude when an API key is configured, otherwise the offline writer.
// ---------------------------------------------------------------------------
export async function generatePlan(spec, onNote = () => {}) {
  let plan;
  if (config.anthropic.apiKey) {
    try {
      onNote('يكتب Claude السيناريو الإنتاجي…');
      plan = await callClaude(spec);
      plan.__engine = 'claude';
    } catch (e) {
      log.warn('Claude script failed, falling back to offline writer:', e.message);
      onNote('تعذّر الاتصال بـ Claude، سيُستخدم الكاتب الداخلي…');
      plan = offlineWriter(spec);
      plan.__engine = 'offline';
    }
  } else {
    onNote('توليد السيناريو عبر الكاتب الداخلي…');
    plan = offlineWriter(spec);
    plan.__engine = 'offline';
  }
  return normalisePlan(plan, spec);
}

// ---------------------------------------------------------------------------
// Claude backend
// ---------------------------------------------------------------------------
async function callClaude(spec) {
  const res = await fetch(`${config.anthropic.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.anthropic.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.anthropic.model,
      max_tokens: 4000,
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: buildUserPrompt(spec) }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = (data.content || []).map((b) => b.text || '').join('');
  return extractJSON(text);
}

function extractJSON(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON object in model output');
  return JSON.parse(text.slice(start, end + 1));
}

// ---------------------------------------------------------------------------
// Offline writer — deterministic, no network. Produces a coherent atmospheric
// short film whose mood, captions and narration reflect the brief so the film
// feels personal even without any API keys.
// ---------------------------------------------------------------------------
const AR = /[؀-ۿ]/;

const MOOD_KEYWORDS = {
  bleak: ['بؤس', 'كآبة', 'كئيب', 'حزن', 'حزين', 'يأس', 'وحدة', 'وحيد', 'مطر', 'رمادي', 'بارد', 'دموع', 'خسارة', 'فقدان', 'misery', 'bleak', 'sad', 'grief', 'despair', 'lonely', 'rain', 'grey', 'gray', 'cold', 'depress', 'loss', 'tears'],
  tense: ['توتر', 'خوف', 'مطاردة', 'هروب', 'تشويق', 'رعب', 'خطر', 'قلق', 'صراخ', 'tension', 'fear', 'chase', 'escape', 'thriller', 'horror', 'danger', 'panic', 'suspense'],
  hopeful: ['أمل', 'دفء', 'بداية', 'نور', 'حلم', 'شروق', 'نجاح', 'عودة', 'hope', 'hopeful', 'warm', 'dawn', 'dream', 'light', 'new beginning', 'sunrise', 'recovery'],
  wonder: ['دهشة', 'سحر', 'فضاء', 'نجوم', 'خيال', 'كون', 'عجيب', 'سماء', 'wonder', 'magic', 'space', 'stars', 'fantasy', 'cosmic', 'galaxy', 'awe', 'sky'],
  epic: ['ملحمة', 'ملحمي', 'معركة', 'بطل', 'حرب', 'عظيم', 'مملكة', 'أسطورة', 'جيش', 'epic', 'battle', 'hero', 'war', 'kingdom', 'legend', 'army', 'throne'],
  romantic: ['حب', 'رومانسي', 'عشق', 'قلب', 'قبلة', 'حبيب', 'حبيبة', 'love', 'romance', 'romantic', 'heart', 'kiss', 'lovers'],
  serene: ['هدوء', 'سكينة', 'طبيعة', 'بحر', 'سلام', 'تأمل', 'صفاء', 'calm', 'serene', 'nature', 'sea', 'ocean', 'peace', 'meditation', 'quiet'],
  noir: ['غموض', 'جريمة', 'محقق', 'ليل', 'مدينة', 'سر', 'قاتل', 'noir', 'crime', 'detective', 'mystery', 'city', 'murder', 'secret', 'shadow'],
};

function inferMood(text) {
  const low = text.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const [mood, words] of Object.entries(MOOD_KEYWORDS)) {
    let score = 0;
    for (const w of words) if (low.includes(w.toLowerCase())) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = mood;
    }
  }
  return best || DEFAULT_MOOD;
}

function splitSentences(text) {
  return text
    .split(/[.،؛!؟?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

// Visual vocabulary per mood, used to build photoreal shot descriptions.
const VISUALS = {
  bleak: {
    place: 'a rain-soaked empty street at night, wet asphalt reflecting cold sodium streetlights',
    subject: 'a solitary figure in a long coat, shoulders hunched against the drizzle',
    light: 'cold blue moonlight, heavy overcast, faint amber streetlamps',
  },
  tense: {
    place: 'a narrow concrete corridor lit by flickering fluorescents',
    subject: 'a person glancing back over their shoulder, breath quick',
    light: 'harsh top light, deep pooling shadows, red exit-sign glow',
  },
  hopeful: {
    place: 'a wide field at dawn, tall grass catching the first golden light',
    subject: 'a person walking toward the rising sun, silhouette warm-rimmed',
    light: 'soft golden-hour backlight, warm haze, long gentle shadows',
  },
  wonder: {
    place: 'a vast starfield above snow-capped mountains, aurora shimmering',
    subject: 'a small figure gazing upward at an impossible sky',
    light: 'cool starlight, teal and violet aurora glow, faint bioluminescence',
  },
  epic: {
    place: 'a windswept ridge overlooking a valley of banners and smoke',
    subject: 'a lone warrior standing against the wind, cloak snapping',
    light: 'dramatic side light through dust, burnt-orange sky, god-rays',
  },
  romantic: {
    place: 'a warm café terrace at dusk, string lights glowing',
    subject: 'two people leaning close across a small table',
    light: 'soft warm practical lights, gentle bokeh, rose dusk sky',
  },
  serene: {
    place: 'a still lake at first light, mist drifting over glassy water',
    subject: 'a lone rowboat resting near the reeds',
    light: 'soft diffused dawn light, pale teal water, gentle mist',
  },
  noir: {
    place: 'a rain-streaked office window overlooking a neon city at midnight',
    subject: 'a silhouette behind venetian blinds, cigarette smoke curling',
    light: 'hard key light, venetian-blind shadows, cold neon spill',
  },
};

const CAMERAS = ['static', 'push-in', 'pan-right', 'tilt-up', 'pull-out', 'handheld', 'pan-left', 'crane'];
const SHOT_TYPES = ['wide', 'medium', 'close', 'aerial', 'medium', 'close', 'wide', 'extreme-close'];

// Narration templates per mood, in Arabic and English.
const NARRATION = {
  bleak: {
    ar: ['في المدينة التي نسيها الضوء، كان كلُّ شيءٍ يبدو أثقل من المطر.', 'لم يكن هناك من ينتظر، ولا صوتٌ يكسر الصمت.', 'وحين خفتت آخر خطوة، بقيت الوحدة وحدها.'],
    en: ['In the city the light forgot, everything felt heavier than the rain.', 'No one was waiting, no sound broke the silence.', 'And when the last footstep faded, only the loneliness remained.'],
  },
  tense: {
    ar: ['كان القلب يدقُّ أسرع من الخطى.', 'خلف كل باب، احتمالٌ لا يُطاق.', 'ثانيةٌ واحدة تفصل بين النجاة والنهاية.'],
    en: ['The heart beat faster than the footsteps.', 'Behind every door, an unbearable possibility.', 'A single second stood between escape and the end.'],
  },
  hopeful: {
    ar: ['مع أول ضوءٍ، بدا أن العالم يتنفس من جديد.', 'كل خطوةٍ نحو الشمس كانت وعدًا.', 'وهناك، عند الأفق، بدأ كلُّ شيء.'],
    en: ['With the first light, the world seemed to breathe again.', 'Every step toward the sun was a promise.', 'And there, at the horizon, everything began.'],
  },
  wonder: {
    ar: ['تحت سماءٍ لا تُصدَّق، بدا الإنسان صغيرًا وعظيمًا في آنٍ.', 'كأن النجوم تهمس بأسرارٍ أقدم من الزمن.', 'وفي تلك اللحظة، اتسع الكون قليلًا.'],
    en: ['Beneath an impossible sky, we felt small and vast at once.', 'As if the stars whispered secrets older than time.', 'And in that moment, the universe grew a little wider.'],
  },
  epic: {
    ar: ['على الحافة حيث ينتهي كلُّ شيء، وقف وحيدًا.', 'الريح تحمل أسماء من سبقوه.', 'واليوم، يُكتب اسمٌ آخر.'],
    en: ['On the edge where all things end, he stood alone.', 'The wind carried the names of those before him.', 'And today, another name is written.'],
  },
  romantic: {
    ar: ['بين ضوءين خافتين، وُلد شيءٌ لا يُقال.', 'الصمت كان أبلغ من كل الكلمات.', 'وبقيت اللحظة، دافئةً، إلى الأبد.'],
    en: ['Between two dim lights, something unspoken was born.', 'The silence said more than any words.', 'And the moment stayed, warm, forever.'],
  },
  serene: {
    ar: ['كان الصباح يتنفس ببطء فوق الماء.', 'لا شيء يستعجل، ولا شيء ينقص.', 'مجرد سكونٍ، صافٍ كالضوء.'],
    en: ['Morning breathed slowly over the water.', 'Nothing rushed, nothing was missing.', 'Only a stillness, clear as light.'],
  },
  noir: {
    ar: ['في مدينةٍ لا تنام، كلُّ ضوءٍ يخفي ظلًّا.', 'الحقيقة، كالمطر، تجد طريقها دائمًا.', 'وبعض الأسرار تُدفن مرتين.'],
    en: ['In a city that never sleeps, every light hides a shadow.', 'The truth, like the rain, always finds its way.', 'And some secrets are buried twice.'],
  },
};

function offlineWriter(spec) {
  const brief = spec.brief || '';
  const lang = spec.language || (AR.test(brief) ? 'ar' : 'en');
  const mood = spec.mood && MOODS[spec.mood] ? spec.mood : inferMood(brief);
  const v = VISUALS[mood] || VISUALS[DEFAULT_MOOD];
  const target = clamp(spec.duration || 60, 12, 240);

  const sentences = splitSentences(brief);
  const nScenes = clamp(Math.round(target / 15), 3, 6);

  // Distribute the user's own sentences across scenes as captions.
  const captionPool = sentences.length ? sentences : [brief];

  const beats = ['ESTABLISH', 'DEVELOP', 'TURN', 'RISE', 'CLIMAX', 'RESOLVE'];
  const scenes = [];
  const perScene = target / nScenes;

  for (let i = 0; i < nScenes; i++) {
    const beat = beats[Math.round((i / Math.max(1, nScenes - 1)) * (beats.length - 1))];
    const nShots = clamp(Math.round(perScene / 5), 1, 3);
    const shots = [];
    for (let s = 0; s < nShots; s++) {
      const idx = i * 3 + s;
      const st = SHOT_TYPES[idx % SHOT_TYPES.length];
      const cam = CAMERAS[idx % CAMERAS.length];
      const dur = round1(perScene / nShots);
      const scenePart = s === 0 ? v.place : v.subject;
      shots.push({
        duration: dur,
        shotType: st,
        camera: cam,
        description: `${st} shot, ${cam} camera move. ${cap(scenePart)}. ${v.light}. Shot on 35mm film, shallow depth of field, cinematic colour grade, volumetric atmosphere, ultra-detailed, photoreal.`,
        light: v.light,
        caption: s === 0 ? captionPool[i % captionPool.length] || '' : '',
      });
    }
    scenes.push({
      heading: `${beat} — ${v.place.split(',')[0].toUpperCase()}`,
      summary: sentences[i] || `${beat} beat rendered in a ${mood} register.`,
      mood,
      shots,
    });
  }

  const narrLines = (NARRATION[mood] || NARRATION[DEFAULT_MOOD])[lang === 'ar' ? 'ar' : 'en'];
  const narration = scenes.map((_, i) => ({
    sceneIndex: i,
    text: sentences[i] || narrLines[i % narrLines.length],
  }));

  const title =
    firstTitle(brief, lang) ||
    (lang === 'ar' ? MOODS[mood].ar : mood.charAt(0).toUpperCase() + mood.slice(1));

  return {
    title,
    logline: sentences[0] || brief.slice(0, 120),
    language: lang,
    mood,
    aspect: spec.aspect || '16:9',
    genre: spec.genre || mood,
    scenes,
    narration,
    dialogue: [],
    sound: {
      score: `${mood} score built from a ${MOODS[mood]?.music?.scale || 'minor'} palette`,
      sfx: sfxFor(mood),
    },
  };
}

function sfxFor(mood) {
  const map = {
    bleak: ['distant thunder', 'dripping water', 'a lone dog barking'],
    tense: ['a heartbeat', 'a slamming door', 'rising drone'],
    hopeful: ['birdsong at dawn', 'a soft breeze', 'distant bells'],
    wonder: ['shimmering chimes', 'a low cosmic hum', 'wind over snow'],
    epic: ['war drums', 'a horn call', 'howling wind'],
    romantic: ['soft café murmur', 'a gentle piano', 'evening crickets'],
    serene: ['lapping water', 'reeds in the wind', 'a distant loon'],
    noir: ['rain on glass', 'a jazz trumpet', 'a ticking clock'],
  };
  return map[mood] || map.bleak;
}

function firstTitle(brief, lang) {
  const first = splitSentences(brief)[0] || '';
  if (!first) return '';
  const words = first.split(/\s+/).slice(0, 6).join(' ');
  return words;
}

// ---------------------------------------------------------------------------
// Normalisation — guarantees a renderable plan regardless of source.
// ---------------------------------------------------------------------------
function normalisePlan(plan, spec) {
  const mood = plan.mood && MOODS[plan.mood] ? plan.mood : inferMood(spec.brief || plan.logline || '');
  const language = plan.language || (AR.test((spec.brief || '') + (plan.title || '')) ? 'ar' : 'en');
  const aspect = ['16:9', '9:16', '2.39:1'].includes(plan.aspect) ? plan.aspect : spec.aspect || '16:9';

  const scenes = (Array.isArray(plan.scenes) ? plan.scenes : []).map((sc, i) => {
    const shots = (Array.isArray(sc.shots) ? sc.shots : []).map((sh) => ({
      duration: clamp(Number(sh.duration) || 4, 2, 10),
      shotType: sh.shotType || 'medium',
      camera: sh.camera || 'static',
      description: String(sh.description || sc.summary || 'cinematic establishing shot').slice(0, 700),
      light: sh.light || '',
      caption: (sh.caption || '').toString().slice(0, 220),
    }));
    if (!shots.length) {
      shots.push({ duration: 4, shotType: 'wide', camera: 'push-in', description: sc.summary || 'cinematic shot', light: '', caption: '' });
    }
    return {
      index: i,
      heading: sc.heading || `SCENE ${i + 1}`,
      summary: sc.summary || '',
      mood: sc.mood && MOODS[sc.mood] ? sc.mood : mood,
      shots,
    };
  });

  if (!scenes.length) {
    // Last-resort single scene so the pipeline never renders nothing.
    scenes.push({
      index: 0,
      heading: 'SCENE 1',
      summary: plan.logline || '',
      mood,
      shots: [{ duration: 5, shotType: 'wide', camera: 'push-in', description: plan.logline || 'cinematic shot', light: '', caption: plan.logline || '' }],
    });
  }

  const totalDuration = round1(
    scenes.reduce((a, sc) => a + sc.shots.reduce((b, sh) => b + sh.duration, 0), 0)
  );

  return {
    title: plan.title || 'Untitled',
    logline: plan.logline || '',
    language,
    mood,
    aspect,
    genre: plan.genre || mood,
    scenes,
    narration: Array.isArray(plan.narration) ? plan.narration : [],
    dialogue: Array.isArray(plan.dialogue) ? plan.dialogue : [],
    sound: plan.sound && typeof plan.sound === 'object' ? plan.sound : { score: '', sfx: [] },
    totalDuration,
    engine: plan.__engine || 'offline',
  };
}

// ---- small helpers ---------------------------------------------------------
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
