// Renders a stickman shot: draws every animation frame with the pure-JS
// rasterizer and streams them as rawvideo into ffmpeg to produce a silent
// clip (audio/subtitles are added later by the shared assembler).

import { spawn } from 'node:child_process';
import { FFMPEG } from '../render/ffmpeg.js';
import { buildBackdrop, drawFigure, drawRain, drawStars, skeletonMaxY } from './scene.js';
import { buildSkeleton } from './figure.js';

const FPS = 24;

function lerp(a, b, t) { return a + (b - a) * t; }

// spec: { action, actors:[...] }
// opts: { width, height, moodKey, duration, outPath, fadeIn, fadeOut }
export function renderStickmanShot(spec, opts) {
  const { width, height, moodKey, duration, outPath, fadeIn = false, fadeOut = false } = opts;
  const N = Math.max(1, Math.round(duration * FPS));
  const scale = (height / 720) * 1.35;
  const jumpUnit = height / 720;

  const backdrop = buildBackdrop(width, height, moodKey);
  const { groundY, rain, stars } = backdrop;

  const ff = spawn(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${width}x${height}`, '-framerate', String(FPS),
    '-i', 'pipe:0',
    '-t', duration.toFixed(3), '-r', String(FPS),
    '-vf', 'format=yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-an',
    outPath,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  let err = '';
  ff.stderr.on('data', (d) => { err += d.toString(); if (err.length > 6000) err = err.slice(-6000); });

  const done = new Promise((resolve, reject) => {
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve({ path: outPath, duration }) : reject(new Error(`stickman ffmpeg ${code}: ${err.slice(-300)}`))));
  });

  (async () => {
    for (let i = 0; i < N; i++) {
      const t = i / FPS;
      const progress = N > 1 ? i / (N - 1) : 0;
      const frame = backdrop.frame.clone();

      if (stars.length) drawStars(frame, stars, t);
      if (rain) drawRain(frame, t, groundY);

      for (const actor of spec.actors) {
        const x = lerp(actor.x0 * width, actor.x1 * width, progress);
        let phase = (t * (actor.speed || 1) + (actor.phaseShift || 0)) % 1;
        if (actor.once) phase = Math.min(1, progress); // one-shot poses (fall)
        const skel = buildSkeleton(actor.pose, phase, actor.facing);
        let oy = groundY - skeletonMaxY(skel) * scale;
        if (actor.jump) oy -= Math.abs(Math.sin(Math.PI * progress * actor.jump)) * 90 * jumpUnit;
        drawFigure(frame, skel, x, oy, scale, actor.color);
      }

      // Scene-edge fades to black.
      let fa = 0;
      if (fadeIn && t < 0.5) fa = Math.max(fa, 1 - t / 0.5);
      if (fadeOut && t > duration - 0.5) fa = Math.max(fa, (t - (duration - 0.5)) / 0.5);
      if (fa > 0) frame.fillRect(0, 0, width, height, [0, 0, 0], Math.min(1, fa));

      if (!ff.stdin.write(frame.buf)) {
        await new Promise((res) => ff.stdin.once('drain', res));
      }
    }
    ff.stdin.end();
  })().catch((e) => ff.destroy(e));

  return done;
}

export { FPS as STICK_FPS };
