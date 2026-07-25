import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { config, capabilities } from './src/config.js';
import { log } from './src/util/log.js';
import { ensureDirSync } from './src/util/fsx.js';
import { moodList } from './src/util/palette.js';
import { createJob, getJob, snapshot } from './src/pipeline/jobs.js';
import { runPipeline } from './src/pipeline/orchestrator.js';

ensureDirSync(config.paths.storage);

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(config.paths.public));
app.use('/fonts', express.static(config.paths.fonts));

// ---- Capabilities / options ------------------------------------------------
app.get('/api/capabilities', (req, res) => {
  res.json({
    capabilities,
    moods: moodList(),
    styles: [
      { key: 'cinematic', ar: 'سينمائي (أجواء)' },
      { key: 'stickman', ar: 'رسوم Stickman متحركة' },
    ],
    aspects: ['16:9', '9:16', '2.39:1'],
    qualities: [
      { key: 'draft', ar: 'مسودة سريعة (720p)' },
      { key: 'hd', ar: 'عالية الدقة (1080p)' },
      { key: '4k', ar: 'فائقة (4K)' },
    ],
    scriptEngine: config.anthropic.apiKey ? 'claude' : 'offline',
  });
});

// ---- Create a film job -----------------------------------------------------
app.post('/api/jobs', (req, res) => {
  const b = req.body || {};
  const brief = String(b.brief || '').trim();
  if (brief.length < 3) return res.status(400).json({ error: 'الوصف قصير جدًا' });

  const spec = {
    brief: brief.slice(0, 6000),
    mood: typeof b.mood === 'string' ? b.mood : '',
    language: typeof b.language === 'string' ? b.language : '',
    aspect: ['16:9', '9:16', '2.39:1'].includes(b.aspect) ? b.aspect : '16:9',
    duration: clampNum(b.duration, 12, 180, 60),
    quality: ['draft', 'hd', '4k'].includes(b.quality) ? b.quality : 'hd',
    style: b.style === 'stickman' ? 'stickman' : 'cinematic',
    genre: typeof b.genre === 'string' ? b.genre.slice(0, 60) : '',
  };

  const job = createJob(spec);
  res.status(202).json({ id: job.id, spec });
  // Fire and forget — progress is streamed over SSE.
  runPipeline(job);
});

// ---- Job status snapshot ---------------------------------------------------
app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  res.json(snapshot(job));
});

// ---- Live progress via Server-Sent-Events ---------------------------------
app.get('/api/jobs/:id/events', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).end();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (evt) => res.write(`data: ${JSON.stringify(evt)}\n\n`);
  // Replay current state immediately.
  send({ status: job.status, stage: job.stage, progress: job.progress, message: 'متصل' });
  if (job.status === 'done' || job.status === 'error') {
    send({ status: job.status, stage: job.stage, progress: job.progress, done: true, result: job.result, error: job.error, plan: planSummary(job.plan) });
    return res.end();
  }
  const onUpdate = (evt) => {
    send(evt);
    if (evt.status === 'done' || evt.status === 'error') {
      send({ done: true, result: job.result, error: job.error, plan: planSummary(job.plan) });
      res.end();
    }
  };
  job.bus.on('update', onUpdate);
  req.on('close', () => job.bus.off('update', onUpdate));
});

// ---- Production plan (JSON) -------------------------------------------------
app.get('/api/jobs/:id/plan', (req, res) => {
  const job = getJob(req.params.id);
  if (!job || !job.plan) return res.status(404).json({ error: 'not ready' });
  res.json(job.plan);
});

// ---- Stream / download the finished film ----------------------------------
app.get('/api/jobs/:id/film', (req, res) => {
  const job = getJob(req.params.id);
  if (!job || !job.result) return res.status(404).json({ error: 'not ready' });
  const file = job.result.videoPath;
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'file missing' });
  const stat = fs.statSync(file);
  const range = req.headers.range;
  res.setHeader('Content-Type', 'video/mp4');
  if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="${job.result.fileName}"`);
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Accept-Ranges', 'bytes');
    fs.createReadStream(file).pipe(res);
  }
});

function planSummary(plan) {
  if (!plan) return null;
  return {
    title: plan.title, logline: plan.logline, mood: plan.mood, language: plan.language,
    aspect: plan.aspect, genre: plan.genre, totalDuration: plan.totalDuration, engine: plan.engine,
    scenes: plan.scenes.map((s) => ({ heading: s.heading, summary: s.summary, mood: s.mood, shots: s.shots.length })),
    sound: plan.sound,
  };
}

function clampNum(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

app.listen(config.port, () => {
  log.ok(`AI Film Studio على http://localhost:${config.port}`);
  log.info(`المحرّكات — نص: ${capabilities.script} | فيديو: ${capabilities.video} | صوت: ${capabilities.voice} | موسيقى: ${capabilities.music}`);
});
