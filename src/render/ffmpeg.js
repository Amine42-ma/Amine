import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { log } from '../util/log.js';

export const FFMPEG = ffmpegPath;

// Run ffmpeg with the given argument array. Resolves on exit 0, rejects with
// the tail of stderr otherwise. Set opts.quiet to keep stderr silent.
export function ffmpeg(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (d) => {
      err += d.toString();
      if (err.length > 8000) err = err.slice(-8000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      if (!opts.quiet) log.err('ffmpeg failed:', args.join(' '));
      reject(new Error(`ffmpeg exited ${code}: ${err.trim().split('\n').slice(-6).join(' | ')}`));
    });
  });
}

// Escape a filesystem path for use inside an ffmpeg filtergraph value.
export function filterPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}
