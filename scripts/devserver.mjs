/**
 * Small process manager for local testing: start/stop/restart the built server
 * with a pidfile, so test runs never have to guess which node process to kill.
 *
 *   node scripts/devserver.mjs start|stop|restart|status
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, openSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runDir = process.env.EOM_RUN_DIR ?? path.join(root, '.run');
const pidFile = path.join(runDir, 'server.pid');
const logFile = path.join(runDir, 'server.log');

function ensureRunDir() {
  if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true });
}

function readPid() {
  if (!existsSync(pidFile)) return null;
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  if (!Number.isFinite(pid)) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function stop() {
  const pid = readPid();
  if (!pid) {
    console.log('server not running');
    if (existsSync(pidFile)) unlinkSync(pidFile);
    return;
  }
  process.kill(pid, 'SIGTERM');
  console.log(`stopped pid ${pid}`);
  if (existsSync(pidFile)) unlinkSync(pidFile);
}

function start() {
  if (readPid()) {
    console.log('server already running');
    return;
  }
  ensureRunDir();
  const out = openSync(logFile, 'a');
  const child = spawn(process.execPath, [path.join(root, 'dist/server/index.js')], {
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env,
  });
  child.unref();
  writeFileSync(pidFile, String(child.pid));
  console.log(`started pid ${child.pid} (log: ${logFile})`);
}

const cmd = process.argv[2] ?? 'status';
if (cmd === 'start') start();
else if (cmd === 'stop') stop();
else if (cmd === 'restart') { stop(); setTimeout(start, 800); }
else console.log(readPid() ? `running pid ${readPid()}` : 'not running');
