import path from 'node:path';
import { config } from '../config.js';
import { log } from '../util/log.js';
import { emit } from './jobs.js';
import { ensureDir, writeJSON } from '../util/fsx.js';
import { generatePlan } from '../screenplay/generate.js';
import { renderFilm } from '../render/assemble.js';

// Run the full pipeline for a job: brief → production plan → film.
export async function runPipeline(job) {
  const dir = await ensureDir(path.join(config.paths.storage, job.id));
  try {
    emit(job, { status: 'running', stage: 'writing', progress: 3, message: 'قراءة الوصف وبناء الرؤية الإخراجية' });

    // 1) Production plan (the "understanding" step).
    const plan = await generatePlan(job.spec, (note) => emit(job, { message: note }));
    job.plan = plan;
    await writeJSON(path.join(dir, 'plan.json'), plan);
    emit(job, {
      stage: 'planned',
      progress: 12,
      message: `«${plan.title}» — ${plan.scenes.length} مشاهد، ${plan.totalDuration}ث (المحرك: ${plan.engine === 'claude' ? 'Claude' : 'الكاتب الداخلي'})`,
    });

    // 2) Render the film.
    const result = await renderFilm(plan, job.spec, { dir, aspect: plan.aspect, quality: job.spec.quality, mood: plan.mood, style: job.spec.style }, (stage, frac, message) => {
      emit(job, { stage, progress: Math.round(12 + frac * 86), message });
    });

    job.result = {
      ...result,
      videoUrl: `/api/jobs/${job.id}/film`,
      planUrl: `/api/jobs/${job.id}/plan`,
    };
    emit(job, { status: 'done', stage: 'done', progress: 100, message: 'اكتمل الفيلم' });
    log.ok(`job ${job.id} done: ${result.fileName} (${result.duration}s)`);
  } catch (e) {
    log.err(`job ${job.id} failed:`, e.message);
    emit(job, { status: 'error', stage: 'error', progress: job.progress, message: 'حدث خطأ أثناء الإنتاج', });
    job.error = e.message;
  }
}
