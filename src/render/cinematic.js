// Offline cinematic renderer. Turns a single shot (from the production plan)
// into a silent, moody, moving video clip using nothing but ffmpeg filters.
// This is what makes the studio produce a real, watchable film with zero API
// keys — animated mood gradients, virtual camera moves, film grain, vignette
// and a per-mood colour grade.

import path from 'node:path';
import { ffmpeg } from './ffmpeg.js';
import { resolveMood } from '../util/palette.js';

const FPS = 24;
const OVERSCAN = 1.35; // base canvas is larger than the frame so the camera can move

// Resolution table: [width, height] per aspect + quality.
export function resolutionFor(aspect = '16:9', quality = 'hd') {
  const table = {
    '16:9': { draft: [1280, 720], hd: [1920, 1080], '4k': [3840, 2160] },
    '9:16': { draft: [720, 1280], hd: [1080, 1920], '4k': [2160, 3840] },
    '2.39:1': { draft: [1280, 536], hd: [1920, 804], '4k': [3840, 1608] },
  };
  const row = table[aspect] || table['16:9'];
  return row[quality] || row.hd;
}

const SAT = {
  bleak: 0.78, noir: 0.7, serene: 0.92, tense: 0.9,
  hopeful: 1.12, romantic: 1.14, wonder: 1.08, epic: 1.05,
};

// Rec.709 saturation as a colorchannelmixer matrix. Done in RGB (native to
// colorchannelmixer) — on this ffmpeg build the `eq` filter's YUV round-trip
// corrupts colours when grading the near-black base, so we avoid it entirely.
function satMatrix(s) {
  const lr = 0.2126, lg = 0.7152, lb = 0.0722;
  const f = (n) => n.toFixed(4);
  return (
    `colorchannelmixer=` +
    `rr=${f((1 - s) * lr + s)}:rg=${f((1 - s) * lg)}:rb=${f((1 - s) * lb)}:` +
    `gr=${f((1 - s) * lr)}:gg=${f((1 - s) * lg + s)}:gb=${f((1 - s) * lb)}:` +
    `br=${f((1 - s) * lr)}:bg=${f((1 - s) * lg)}:bb=${f((1 - s) * lb + s)}`
  );
}

// Build a `zoompan` expression performing the virtual camera move over the
// oversized base canvas. zoompan (unlike crop) evaluates zoom/x/y per output
// frame, so real zooms and pans are possible. `on` is the output-frame index,
// `zoom` the current zoom factor, iw/ih the input (canvas), ow/oh the frame.
function cameraZoompan(camera, d, width, height) {
  const N = Math.max(1, Math.round(d * FPS));
  const p = `on/${N}`; // 0..1 progress
  const t = `on/${FPS}`; // seconds
  const cx = '(iw*zoom-ow)/2';
  const cy = '(ih*zoom-oh)/2';
  let z, x, y;
  switch (camera) {
    case 'push-in': z = `1.0+0.18*${p}`; x = cx; y = cy; break;
    case 'pull-out': z = `1.18-0.18*${p}`; x = cx; y = cy; break;
    case 'pan-right': z = '1.06'; x = `(iw*zoom-ow)*${p}`; y = cy; break;
    case 'pan-left': z = '1.06'; x = `(iw*zoom-ow)*(1-${p})`; y = cy; break;
    case 'tilt-up': z = '1.06'; x = cx; y = `(ih*zoom-oh)*(1-${p})`; break;
    case 'tilt-down': z = '1.06'; x = cx; y = `(ih*zoom-oh)*${p}`; break;
    case 'crane': z = `1.0+0.12*${p}`; x = cx; y = `(ih*zoom-oh)*(1-${p})`; break;
    case 'handheld':
      z = '1.08';
      x = `${cx}+(ow*0.03)*sin(2*3.14159*1.1*${t})`;
      y = `${cy}+(oh*0.03)*cos(2*3.14159*0.85*${t})`;
      break;
    default: // static — slow imperceptible drift
      z = '1.05';
      x = `${cx}+(ow*0.02)*sin(2*3.14159*0.1*${t})`;
      y = cy;
  }
  return `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${width}x${height}:fps=${FPS}`;
}

// Render one shot to `outPath`. Returns { path, duration }.
export async function renderShotClip(shot, opts) {
  const { moodKey, width, height, outPath, fadeIn = false, fadeOut = false } = opts;
  const mood = resolveMood(moodKey);
  const d = Math.max(1.5, shot.duration || 4);

  const CW = Math.round((width * OVERSCAN) / 2) * 2;
  const CH = Math.round((height * OVERSCAN) / 2) * 2;

  const [gr, gg, gb] = mood.grade;
  const sat = SAT[mood.key] ?? 0.95;
  const sigma = Math.max(12, Math.round(CH / 32));
  const grain = Math.min(12, Math.max(3, Math.round(mood.grain * 55)));
  const vigAngle = (0.35 + 0.55 * mood.vignette).toFixed(3);

  // Two animated gradient sources: a vertical sky→ground base and a soft radial
  // "light pool" that we screen on top for depth.
  const base = `gradients=s=${CW}x${CH}:c0=0x${mood.sky}:c1=0x${mood.ground}` +
    `:x0=0:y0=0:x1=0:y1=${CH}:nb_colors=2:type=linear:duration=${d.toFixed(3)}:speed=0.006:r=${FPS}`;
  const glow = `gradients=s=${CW}x${CH}:c0=0x${mood.accent}:c1=0x000000` +
    `:x0=${Math.round(CW * 0.5)}:y0=${Math.round(CH * 0.38)}:x1=${CW}:y1=${CH}` +
    `:nb_colors=2:type=radial:duration=${d.toFixed(3)}:speed=0.018:r=${FPS}`;

  const fadeParts = [];
  if (fadeIn) fadeParts.push(`fade=t=in:st=0:d=0.5`);
  if (fadeOut) fadeParts.push(`fade=t=out:st=${(d - 0.5).toFixed(3)}:d=0.5`);
  const fadeChain = fadeParts.length ? ',' + fadeParts.join(',') : '';

  // Composite in raw RGB first, then grade the composite (saturation → per-
  // channel grade → S-curve contrast), then move the camera, add grain,
  // soften, vignette and fades.
  const grade =
    `${satMatrix(sat)},` +
    `colorchannelmixer=rr=${gr}:gg=${gg}:bb=${gb},` +
    `curves=all='0/0 0.28/0.22 0.72/0.84 1/1'`;

  const filter =
    `[0:v]format=rgb24[base];` +
    `[1:v]format=rgb24,gblur=sigma=${sigma}[glow];` +
    `[base][glow]blend=all_mode=screen:all_opacity=0.5[lit];` +
    `[lit]${grade}[graded];` +
    `[graded]${cameraZoompan(shot.camera, d, width, height)},setsar=1[cam];` +
    `[cam]noise=alls=${grain}:allf=t,gblur=sigma=0.5,vignette=angle=${vigAngle}${fadeChain},format=yuv420p[v]`;

  await ffmpeg([
    '-f', 'lavfi', '-i', base,
    '-f', 'lavfi', '-i', glow,
    '-filter_complex', filter,
    '-map', '[v]',
    '-t', d.toFixed(3),
    '-r', String(FPS),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    outPath,
  ]);

  return { path: outPath, duration: d };
}

export { FPS };
