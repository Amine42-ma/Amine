import { EventEmitter } from 'node:events';
import { nanoid } from 'nanoid';

// Simple in-memory job registry. Each job carries its spec, a rolling list of
// progress events, the produced plan, and the final result. An EventEmitter per
// job powers Server-Sent-Events streaming to the browser.

const jobs = new Map();

export function createJob(spec) {
  const id = nanoid(10);
  const job = {
    id,
    spec,
    status: 'queued', // queued | running | done | error
    createdAt: Date.now(),
    progress: 0, // 0..100
    stage: 'queued',
    events: [],
    plan: null,
    result: null,
    error: null,
    bus: new EventEmitter(),
  };
  job.bus.setMaxListeners(50);
  jobs.set(id, job);
  return job;
}

export function getJob(id) {
  return jobs.get(id);
}

export function emit(job, patch) {
  Object.assign(job, patch);
  const evt = {
    t: Date.now(),
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    message: patch.message || '',
  };
  job.events.push(evt);
  if (job.events.length > 400) job.events.shift();
  job.bus.emit('update', evt);
}

// Public snapshot (excludes the bus).
export function snapshot(job) {
  const { bus, ...rest } = job;
  return rest;
}

// Housekeeping: drop jobs older than 6h so memory stays bounded.
export function sweep() {
  const cutoff = Date.now() - 6 * 3600 * 1000;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}
setInterval(sweep, 30 * 60 * 1000).unref?.();
