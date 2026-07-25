// Mood → cinematic colour language. Each mood maps to a set of hex colours the
// cinematic renderer uses for gradients, grade and light, plus musical hints
// (scale + tempo) used by the procedural score. This is what lets the film
// "feel" misery, tension, wonder, etc. from the description alone.

export const MOODS = {
  bleak: {
    ar: 'بؤس/كآبة',
    grade: [0.82, 0.9, 1.05], // rgb multipliers (cold, desaturated)
    sky: '0e1622',
    ground: '05080d',
    accent: '2b3a4a',
    fog: '9fb3c8',
    grain: 0.16,
    vignette: 0.75,
    music: { root: 196.0, scale: 'minor', tempo: 60, timbre: 'sine', drone: true },
  },
  tense: {
    ar: 'توتر/تشويق',
    grade: [1.02, 0.94, 0.92],
    sky: '1a0e12',
    ground: '0a0406',
    accent: '5a1f2a',
    fog: 'd08a7a',
    grain: 0.14,
    vignette: 0.8,
    music: { root: 220.0, scale: 'phrygian', tempo: 78, timbre: 'triangle', drone: true },
  },
  hopeful: {
    ar: 'أمل/دفء',
    grade: [1.08, 1.02, 0.9],
    sky: '2a2140',
    ground: '3a2a1e',
    accent: 'e0a25a',
    fog: 'ffd9a0',
    grain: 0.08,
    vignette: 0.55,
    music: { root: 261.63, scale: 'major', tempo: 84, timbre: 'sine', drone: false },
  },
  wonder: {
    ar: 'دهشة/سحر',
    grade: [0.95, 1.0, 1.12],
    sky: '141a3a',
    ground: '0a0f24',
    accent: '5a6ad0',
    fog: 'a0c0ff',
    grain: 0.07,
    vignette: 0.5,
    music: { root: 293.66, scale: 'lydian', tempo: 72, timbre: 'sine', drone: false },
  },
  epic: {
    ar: 'ملحمي/مهيب',
    grade: [1.05, 1.0, 0.98],
    sky: '241a12',
    ground: '0e0906',
    accent: 'c07a30',
    fog: 'ffcaa0',
    grain: 0.1,
    vignette: 0.65,
    music: { root: 174.61, scale: 'dorian', tempo: 90, timbre: 'triangle', drone: true },
  },
  romantic: {
    ar: 'رومانسي',
    grade: [1.06, 0.98, 1.0],
    sky: '2e1626',
    ground: '160a12',
    accent: 'd06a8a',
    fog: 'ffb0c8',
    grain: 0.09,
    vignette: 0.6,
    music: { root: 246.94, scale: 'major', tempo: 68, timbre: 'sine', drone: false },
  },
  serene: {
    ar: 'هدوء/سكينة',
    grade: [0.98, 1.04, 1.02],
    sky: '10202a',
    ground: '081418',
    accent: '4a9a8a',
    fog: 'a0e0d0',
    grain: 0.06,
    vignette: 0.45,
    music: { root: 220.0, scale: 'major', tempo: 60, timbre: 'sine', drone: false },
  },
  noir: {
    ar: 'نوار/غموض',
    grade: [0.9, 0.92, 0.98],
    sky: '0a0a0f',
    ground: '020203',
    accent: '3a3a4a',
    fog: 'b0b0c0',
    grain: 0.2,
    vignette: 0.85,
    music: { root: 155.56, scale: 'minor', tempo: 66, timbre: 'triangle', drone: true },
  },
};

export const DEFAULT_MOOD = 'bleak';

export function resolveMood(name) {
  if (name && MOODS[name]) return { key: name, ...MOODS[name] };
  return { key: DEFAULT_MOOD, ...MOODS[DEFAULT_MOOD] };
}

export function moodList() {
  return Object.entries(MOODS).map(([key, m]) => ({ key, ar: m.ar }));
}

// Convert "rrggbb" to a normalised {r,g,b} in 0..1.
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}
