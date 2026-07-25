// Final assembly: render each shot, build title/end cards, concatenate,
// synthesise the score, place any narration, time the subtitles and mux the
// finished film (with grade already baked into the clips).

import fs from 'node:fs/promises';
import path from 'node:path';
import { ffmpeg, filterPath } from './ffmpeg.js';
import { resolutionFor } from './cinematic.js';
import { generateShot, activeVideoProvider } from '../providers/video.js';
import { generateScore } from '../providers/music.js';
import { synthesizeNarration, activeVoiceProvider } from '../providers/voice.js';
import { writeAss } from './subtitles.js';
import { stickSpecForShot } from '../stickman/director.js';
import { config } from '../config.js';
import { ensureDir } from '../util/fsx.js';

const TITLE_DUR = 3.6;
const END_DUR = 4.2;

export async function renderFilm(plan, spec, ctx, onStage = () => {}) {
  const dir = ctx.dir;
  const style = ctx.style === 'stickman' ? 'stickman' : 'cinematic';
  const clipsDir = await ensureDir(path.join(dir, 'clips'));
  const [width, height] = resolutionFor(plan.aspect, ctx.quality);

  // Flatten shots and compute the render plan (with scene-level fades).
  const shotJobs = [];
  plan.scenes.forEach((scene, si) => {
    scene.shots.forEach((shot, sj) => {
      shotJobs.push({
        shot: { ...shot, mood: scene.mood || plan.mood },
        sceneIndex: si,
        fadeIn: sj === 0,
        fadeOut: sj === scene.shots.length - 1,
        stick: style === 'stickman' ? stickSpecForShot(scene, shot, plan, 'shot', si) : null,
      });
    });
  });

  const cardCtx = (extra) => ({ aspect: plan.aspect, quality: ctx.quality, mood: plan.mood, style, ...extra });

  // ---- 1) Title card + all shots + end card -----------------------------
  const clips = [];
  const titlePath = path.join(clipsDir, 'card_title.mp4');
  await generateShot(
    { duration: TITLE_DUR, camera: 'push-in', mood: plan.mood, description: 'title card' },
    cardCtx({ outPath: titlePath, fadeIn: true, fadeOut: false, stick: style === 'stickman' ? stickSpecForShot(null, {}, plan, 'title') : null })
  );
  clips.push({ path: titlePath, duration: TITLE_DUR, kind: 'title' });
  onStage('shots', 0.05, 'أُنشئت بطاقة العنوان');

  for (let i = 0; i < shotJobs.length; i++) {
    const job = shotJobs[i];
    const out = path.join(clipsDir, `shot_${String(i).padStart(3, '0')}.mp4`);
    await generateShot(job.shot, cardCtx({ outPath: out, fadeIn: job.fadeIn, fadeOut: job.fadeOut, stick: job.stick }));
    clips.push({ path: out, duration: job.shot.duration, kind: 'shot', sceneIndex: job.sceneIndex });
    onStage('shots', 0.05 + 0.65 * ((i + 1) / shotJobs.length), `لقطة ${i + 1}/${shotJobs.length}`);
  }

  const endPath = path.join(clipsDir, 'card_end.mp4');
  await generateShot(
    { duration: END_DUR, camera: 'pull-out', mood: plan.mood, description: 'end card' },
    cardCtx({ outPath: endPath, fadeIn: false, fadeOut: true, stick: style === 'stickman' ? stickSpecForShot(null, {}, plan, 'end') : null })
  );
  clips.push({ path: endPath, duration: END_DUR, kind: 'end' });

  // ---- 2) Timeline ------------------------------------------------------
  let cursor = 0;
  const timeline = { title: null, scenes: {}, end: null };
  for (const clip of clips) {
    const start = cursor;
    const end = cursor + clip.duration;
    if (clip.kind === 'title') timeline.title = { start, end };
    else if (clip.kind === 'end') timeline.end = { start, end };
    else {
      const s = (timeline.scenes[clip.sceneIndex] ||= { start, end, index: clip.sceneIndex });
      s.start = Math.min(s.start, start);
      s.end = Math.max(s.end, end);
    }
    cursor = end;
  }
  const total = cursor;

  // ---- 3) Concatenate video (streams share codec/params → stream copy) ---
  onStage('assemble', 0.72, 'دمج اللقطات في مونتاج واحد');
  const listFile = path.join(dir, 'concat.txt');
  await fs.writeFile(listFile, clips.map((c) => `file '${c.path.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
  const silentVideo = path.join(dir, 'video_silent.mp4');
  try {
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', silentVideo]);
  } catch {
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', silentVideo]);
  }

  // ---- 4) Score + narration --------------------------------------------
  onStage('audio', 0.8, 'تأليف الموسيقى والمؤثرات');
  const scorePath = path.join(dir, 'score.m4a');
  await generateScore(plan.mood, total, scorePath);

  const voClips = await synthesizeNarration(plan, { dir });
  const audioPath = path.join(dir, 'audio.m4a');
  await buildAudio({ total, scorePath, voClips, timeline, outPath: audioPath });

  // ---- 5) Subtitles -----------------------------------------------------
  const assPath = path.join(dir, 'subs.ass');
  const events = buildSubtitleEvents(plan, timeline, { hasVoice: voClips.length > 0 });
  await writeAss(assPath, events, { width, height });

  // ---- 6) Final mux: burn subtitles + mix audio ------------------------
  onStage('finalize', 0.9, 'المعالجة النهائية والإخراج');
  const outName = safeName(plan.title) + '.mp4';
  const finalPath = path.join(dir, outName);
  const subFilter = `subtitles=filename=${filterPath(assPath)}:fontsdir=${filterPath(config.paths.fonts)}`;
  await ffmpeg([
    '-i', silentVideo, '-i', audioPath,
    '-filter_complex', `[0:v]${subFilter}[v]`,
    '-map', '[v]', '-map', '1:a',
    '-t', total.toFixed(2),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    finalPath,
  ]);

  return {
    videoPath: finalPath,
    fileName: outName,
    duration: Number(total.toFixed(1)),
    width, height,
    style,
    providers: {
      script: plan.engine,
      video: style === 'stickman' ? 'stickman' : activeVideoProvider(),
      voice: activeVoiceProvider(),
      music: 'procedural',
    },
  };
}

// Mix score with any narration placed at scene starts (score ducked when VO).
async function buildAudio({ total, scorePath, voClips, timeline, outPath }) {
  if (!voClips.length) {
    await ffmpeg(['-i', scorePath, '-t', total.toFixed(2), '-c:a', 'aac', '-b:a', '192k', outPath]);
    return;
  }
  const inputs = ['-i', scorePath];
  voClips.forEach((v) => inputs.push('-i', v.path));
  const parts = [`[0:a]volume=0.5[bed]`];
  const mixLabels = ['[bed]'];
  voClips.forEach((v, idx) => {
    const start = timeline.scenes[v.sceneIndex]?.start ?? 0;
    const delayMs = Math.round((start + 0.4) * 1000);
    parts.push(`[${idx + 1}:a]adelay=${delayMs}|${delayMs},volume=1.6[vo${idx}]`);
    mixLabels.push(`[vo${idx}]`);
  });
  parts.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=longest:normalize=0,alimiter=limit=0.95[a]`);
  await ffmpeg([...inputs, '-filter_complex', parts.join(';'), '-map', '[a]', '-t', total.toFixed(2), '-c:a', 'aac', '-b:a', '192k', outPath]);
}

function buildSubtitleEvents(plan, timeline, opts) {
  const events = [];
  const lang = plan.language;

  if (timeline.title) {
    events.push({ start: timeline.title.start + 0.3, end: timeline.title.end - 0.2, text: plan.title, style: 'Title' });
    if (plan.logline) {
      events.push({ start: timeline.title.start + 0.6, end: timeline.title.end - 0.2, text: plan.logline, style: 'Caption' });
    }
  }

  for (const scene of plan.scenes) {
    const win = timeline.scenes[scene.index];
    if (!win) continue;
    let lines = plan.narration.filter((n) => (n.sceneIndex ?? -1) === scene.index).map((n) => n.text).filter(Boolean);
    if (!lines.length) {
      const cap = scene.shots.map((s) => s.caption).find(Boolean);
      if (cap) lines = [cap];
    }
    if (!lines.length) continue;
    const span = Math.max(1, win.end - win.start - 0.4);
    const slot = span / lines.length;
    lines.forEach((text, i) => {
      const start = win.start + 0.2 + i * slot;
      events.push({ start, end: start + slot - 0.1, text, style: 'Caption' });
    });
  }

  if (timeline.end) {
    events.push({ start: timeline.end.start + 0.4, end: timeline.end.end - 0.3, text: lang === 'ar' ? 'النهاية' : 'THE END', style: 'Title' });
    events.push({ start: timeline.end.start + 0.8, end: timeline.end.end - 0.3, text: lang === 'ar' ? 'أُنتج بواسطة استوديو الأفلام الذكي' : 'Made with AI Film Studio', style: 'Credit' });
  }
  return events;
}

function safeName(title) {
  const base = (title || 'film').replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '_').slice(0, 40);
  return base || 'film';
}
