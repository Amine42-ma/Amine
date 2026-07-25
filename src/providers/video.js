// Video provider dispatch. The offline "cinematic" engine always works and
// needs no keys. When FAL_KEY or REPLICATE_API_TOKEN is set, real photoreal
// text-to-video generation is used instead, per shot, with an automatic
// fallback to the cinematic engine if a remote generation fails.

import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from '../config.js';
import { log } from '../util/log.js';
import { renderShotClip, resolutionFor } from '../render/cinematic.js';
import { renderStickmanShot } from '../stickman/render.js';
import { ffmpeg } from '../render/ffmpeg.js';

export function activeVideoProvider() {
  if (config.video.provider === 'cinematic') return 'cinematic';
  if (config.video.provider === 'fal' || (config.video.provider === 'auto' && config.video.falKey)) return 'fal';
  if (config.video.provider === 'replicate' || (config.video.provider === 'auto' && config.video.replicateKey)) return 'replicate';
  return 'cinematic';
}

// Render a single shot to `outPath`. `sceneMood` overrides the plan mood.
export async function generateShot(shot, ctx) {
  const [width, height] = resolutionFor(ctx.aspect, ctx.quality);
  const moodKey = shot.mood || ctx.mood;

  // Stickman is a fully offline animation style — bypass video providers.
  if (ctx.style === 'stickman' && ctx.stick) {
    return renderStickmanShot(ctx.stick, {
      width, height, moodKey, duration: shot.duration,
      outPath: ctx.outPath, fadeIn: ctx.fadeIn, fadeOut: ctx.fadeOut,
    });
  }

  const provider = activeVideoProvider();
  const opts = { moodKey, width, height, outPath: ctx.outPath, fadeIn: ctx.fadeIn, fadeOut: ctx.fadeOut };

  if (provider === 'cinematic') {
    return renderShotClip(shot, opts);
  }

  try {
    let srcUrl;
    if (provider === 'fal') srcUrl = await falVideo(shot, width, height);
    else srcUrl = await replicateVideo(shot, width, height);
    await downloadAndConform(srcUrl, shot, opts);
    return { path: ctx.outPath, duration: shot.duration, source: provider };
  } catch (e) {
    log.warn(`video provider '${provider}' failed for a shot, using cinematic engine:`, e.message);
    return renderShotClip(shot, opts);
  }
}

// ---- fal.ai adapter --------------------------------------------------------
async function falVideo(shot, width, height) {
  const res = await fetch(`https://fal.run/${config.video.falModel}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Key ${config.video.falKey}` },
    body: JSON.stringify({
      prompt: shot.description,
      aspect_ratio: width >= height ? '16:9' : '9:16',
      num_frames: Math.round(shot.duration * 24),
    }),
  });
  if (!res.ok) throw new Error(`fal ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const url = data?.video?.url || data?.video_url || data?.output?.[0];
  if (!url) throw new Error('fal returned no video url');
  return url;
}

// ---- Replicate adapter -----------------------------------------------------
async function replicateVideo(shot, width, height) {
  if (!config.video.replicateModel) throw new Error('REPLICATE_VIDEO_MODEL not set');
  const create = await fetch(`https://api.replicate.com/v1/models/${config.video.replicateModel}/predictions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.video.replicateKey}`, Prefer: 'wait' },
    body: JSON.stringify({ input: { prompt: shot.description, aspect_ratio: width >= height ? '16:9' : '9:16' } }),
  });
  if (!create.ok) throw new Error(`replicate ${create.status}: ${(await create.text()).slice(0, 200)}`);
  const data = await create.json();
  const url = Array.isArray(data.output) ? data.output[0] : data.output;
  if (!url) throw new Error('replicate returned no output');
  return url;
}

// Download a remote clip and conform it to the target frame/size/fps/duration
// so it concatenates cleanly with everything else.
async function downloadAndConform(url, shot, opts) {
  const tmp = opts.outPath + '.src';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  await fs.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
  const fade = [];
  if (opts.fadeIn) fade.push('fade=t=in:st=0:d=0.5');
  if (opts.fadeOut) fade.push(`fade=t=out:st=${(shot.duration - 0.5).toFixed(3)}:d=0.5`);
  const vf = [`scale=${opts.width}:${opts.height}:force_original_aspect_ratio=increase`,
    `crop=${opts.width}:${opts.height}`, 'setsar=1', ...fade, 'format=yuv420p'].join(',');
  await ffmpeg(['-i', tmp, '-t', String(shot.duration), '-vf', vf, '-r', '24',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-an', opts.outPath]);
  await fs.rm(tmp, { force: true });
}
