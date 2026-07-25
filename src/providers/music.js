// Procedural score + ambience. No samples, no API — the whole soundtrack is
// synthesised by ffmpeg from a per-mood chord, a slow swell, a gentle pulse at
// the mood tempo, reverb, tone-shaping and a filtered-noise ambience bed. This
// is what lets a film "sound" its emotion offline.

import { ffmpeg } from '../render/ffmpeg.js';
import { resolveMood } from '../util/palette.js';

// Third/fifth intervals (in semitones) per scale flavour.
const SCALES = {
  minor: [3, 7, 10],
  major: [4, 7, 11],
  phrygian: [1, 7, 8],
  lydian: [4, 7, 11],
  dorian: [3, 7, 9],
};

const semis = (root, s) => root * Math.pow(2, s / 12);

const AMBIENCE = { bleak: 0.06, noir: 0.07, tense: 0.05, serene: 0.05, epic: 0.045 };

export async function generateScore(moodKey, duration, outPath) {
  const mood = resolveMood(moodKey);
  const m = mood.music || { root: 196, scale: 'minor', tempo: 66, drone: true };
  const D = Math.max(4, Math.round(duration) + 2);

  const f0 = m.root;
  const ints = SCALES[m.scale] || SCALES.minor;
  const f1 = semis(f0, ints[0]);
  const f2 = semis(f0, ints[1]);
  const fb = f0 / 2; // bass an octave down
  const bps = (m.tempo || 66) / 60 / 2; // half-time pulse
  const P = '3.14159265';

  // Slow swell × gentle tempo pulse over a three-note pad plus a breathing bass.
  const swell = `(0.62+0.38*sin(2*${P}*0.045*t))`;
  const pulse = m.drone ? `(0.82+0.18*sin(2*${P}*${bps.toFixed(4)}*t))` : `(0.68+0.32*sin(2*${P}*${bps.toFixed(4)}*t))`;
  const pad = `(0.20*sin(2*${P}*${f0.toFixed(3)}*t)+0.16*sin(2*${P}*${f1.toFixed(3)}*t)+0.15*sin(2*${P}*${f2.toFixed(3)}*t))`;
  const bass = `0.18*sin(2*${P}*${fb.toFixed(3)}*t)*(0.5+0.5*sin(2*${P}*0.06*t))`;
  const expr = `0.5*(${swell}*${pulse}*${pad}+${bass})`;

  const amb = AMBIENCE[moodKey] ?? 0.03;
  const fadeOutStart = Math.max(0, D - 3).toFixed(2);

  const filter =
    `aevalsrc=${expr}:s=44100:d=${D}[mus];` +
    `anoisesrc=color=brown:amplitude=${amb}:duration=${D}:sample_rate=44100[nz];` +
    `[nz]lowpass=f=520,volume=0.6[amb];` +
    `[mus]aecho=0.8:0.9:900|1600:0.3|0.2,lowpass=f=2800,highpass=f=55[musf];` +
    `[musf][amb]amix=inputs=2:weights=1 0.55:duration=longest:normalize=0,` +
    `afade=t=in:d=2,afade=t=out:st=${fadeOutStart}:d=3,` +
    `alimiter=limit=0.95,aformat=channel_layouts=stereo[a]`;

  await ffmpeg([
    '-filter_complex', filter,
    '-map', '[a]', '-t', String(D),
    '-c:a', 'aac', '-b:a', '192k', outPath,
  ]);

  return { path: outPath, duration: D };
}
