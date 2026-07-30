/**
 * Development runner: compiles the server, rebuilds the client on every change,
 * and restarts the server whenever server or shared code is recompiled.
 *
 *   npm run dev
 */
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, opts = {}) {
  return spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
}

function runOnce(command, args) {
  return new Promise((resolve, reject) => {
    const child = run(command, args, { cwd: root });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

console.log('[dev] building…');
await runOnce('npx', ['tsc', '-p', 'tsconfig.server.json']);
await runOnce('node', ['scripts/build-client.mjs']);

// esbuild watches the client itself and writes straight into public/.
const clientWatcher = run('node', [path.join(root, 'scripts/build-client.mjs'), '--watch'], { cwd: root });

let server = null;
let restartTimer = null;

function startServer() {
  server = run('node', [path.join(root, 'dist/server/index.js')], { cwd: root });
  server.on('exit', (code, signal) => {
    if (signal !== 'SIGTERM') console.log(`[dev] server exited (${code ?? signal})`);
  });
}

async function rebuildAndRestart() {
  console.log('[dev] server change detected, rebuilding…');
  try {
    await runOnce('npx', ['tsc', '-p', 'tsconfig.server.json']);
  } catch (err) {
    console.error('[dev] build failed, keeping the old server alive:', err.message);
    return;
  }
  if (server) {
    server.kill('SIGTERM');
    // Give the world a moment to write its save before the new process claims the port.
    await new Promise((r) => setTimeout(r, 900));
  }
  startServer();
}

startServer();

for (const dir of ['server', 'shared']) {
  watch(path.join(root, dir), { recursive: true }, (_event, file) => {
    if (!file || !file.endsWith('.ts')) return;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(rebuildAndRestart, 250);
  });
}

console.log('[dev] watching server/, shared/ and client/ — press Ctrl+C to stop\n');

const shutdown = () => {
  clientWatcher.kill();
  server?.kill('SIGTERM');
  setTimeout(() => process.exit(0), 400);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
