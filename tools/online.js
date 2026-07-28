#!/usr/bin/env node
/**
 * =============================================================================
 *  DINO ROYALE EVOLUTION - one-click online launcher
 * =============================================================================
 *
 *  Starts the game server and opens a Cloudflare Quick Tunnel in front of it,
 *  then prints the public https link. Anyone in the world can open that link
 *  on a phone or a computer and play together.
 *
 *  Why a tunnel rather than a host: the game is fully server-authoritative, so
 *  it needs a long-lived Node process holding WebSocket connections. Free
 *  static hosts (Netlify, GitHub Pages, Vercel) cannot do that at all, and the
 *  free tiers that can now generally want a payment card. A Quick Tunnel needs
 *  no account, no card and no configuration - and the machine running it is
 *  almost certainly faster than a free instance anyway.
 *
 *  The trade-off, stated plainly: the link lives only as long as this window
 *  stays open, and the address changes every time you restart.
 *
 *  Usage:  node tools/online.js  [--port 8080]  [--local]
 *          --local   skip the tunnel and print the LAN address only
 * =============================================================================
 */

'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');

const ROOT = path.resolve(__dirname, '..');
const BIN_DIR = path.join(ROOT, '.cloudflared');

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = parseInt(argValue('--port', process.env.PORT || '8080'), 10);
const LOCAL_ONLY = args.includes('--local');

/* ------------------------------------------------------------------ output */

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', red: '\x1b[31m',
};
const say = (msg = '') => process.stdout.write(`${msg}\n`);
const step = (msg) => say(`${C.cyan}::${C.reset} ${msg}`);
const warn = (msg) => say(`${C.yellow}!!${C.reset} ${msg}`);
const fail = (msg) => say(`${C.red}xx${C.reset} ${msg}`);

/** Draws a box around the link so it cannot be missed in a wall of logs. */
function banner(lines) {
  const width = Math.max(...lines.map((l) => stripAnsi(l).length)) + 4;
  const bar = '═'.repeat(width);
  say('');
  say(`${C.green}╔${bar}╗${C.reset}`);
  for (const line of lines) {
    const pad = ' '.repeat(width - stripAnsi(line).length - 4);
    say(`${C.green}║${C.reset}  ${line}${pad}  ${C.green}║${C.reset}`);
  }
  say(`${C.green}╚${bar}╝${C.reset}`);
  say('');
}
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

/* ------------------------------------------------------- cloudflared binary */

/** Release asset for this machine, or null when Cloudflare ships none. */
function assetName() {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'amd64' : null;
  if (!arch) return null;
  if (process.platform === 'win32') return { file: `cloudflared-windows-${arch}.exe`, archive: false };
  if (process.platform === 'darwin') return { file: `cloudflared-darwin-${arch}.tgz`, archive: true };
  if (process.platform === 'linux') return { file: `cloudflared-linux-${arch}`, archive: false };
  return null;
}

/**
 * Downloads a URL to disk. curl is tried first because it is present
 * everywhere that matters (Windows 10+, macOS, most Linux) and it honours the
 * proxy environment variables that node:https ignores; node:https is the
 * fallback for the machines that have no curl.
 */
function download(url, dest) {
  const curl = spawnSync('curl', ['-fL', '--progress-bar', '--retry', '3', '-o', dest, url],
    { stdio: ['ignore', 'ignore', 'inherit'] });
  if (curl.status === 0) return Promise.resolve();
  if (curl.error && curl.error.code !== 'ENOENT') return Promise.reject(curl.error);

  return new Promise((resolve, reject) => {
    const get = (u, depth = 0) => {
      if (depth > 6) return reject(new Error('too many redirects'));
      https.get(u, { headers: { 'user-agent': 'dino-royale-launcher' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return get(new URL(res.headers.location, u).toString(), depth + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve()));
        out.on('error', reject);
      }).on('error', reject);
    };
    get(url);
  });
}

/** Returns a path to a runnable cloudflared, downloading it once if needed. */
async function ensureCloudflared() {
  const asset = assetName();
  if (!asset) throw new Error(`no cloudflared build for ${process.platform}/${process.arch}`);

  const exe = path.join(BIN_DIR, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (fs.existsSync(exe)) return exe;

  // Already installed system-wide? Then use that and download nothing.
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['cloudflared'],
    { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout.trim()) return probe.stdout.trim().split(/\r?\n/)[0];

  fs.mkdirSync(BIN_DIR, { recursive: true });
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset.file}`;
  step(`downloading the tunnel tool, once only (~35 MB)…`);
  say(`${C.dim}   ${url}${C.reset}`);

  const tmp = path.join(BIN_DIR, asset.file);
  await download(url, tmp);

  if (asset.archive) {
    spawnSync('tar', ['-xzf', tmp, '-C', BIN_DIR], { stdio: 'inherit' });
    fs.rmSync(tmp, { force: true });
  } else if (tmp !== exe) {
    fs.renameSync(tmp, exe);
  }
  if (process.platform !== 'win32') fs.chmodSync(exe, 0o755);
  return exe;
}

/* --------------------------------------------------------------- addresses */

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

/* ------------------------------------------------------------------- main */

const children = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  say('');
  step('shutting down…');
  for (const child of children) {
    try { child.kill(); } catch { /* already gone */ }
  }
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function main() {
  say('');
  say(`${C.bold}  DINO ROYALE EVOLUTION — online launcher${C.reset}`);
  say(`${C.dim}  ────────────────────────────────────────${C.reset}`);

  // ---- 1. the game server -------------------------------------------------
  step(`starting the game server on port ${PORT}…`);
  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '0.0.0.0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(server);
  server.stdout.on('data', (d) => process.stdout.write(`${C.dim}${d}${C.reset}`));
  server.stderr.on('data', (d) => process.stderr.write(`${C.dim}${d}${C.reset}`));
  server.on('exit', (code) => {
    if (!shuttingDown) {
      fail(`the game server stopped unexpectedly (exit ${code}).`);
      shutdown(1);
    }
  });

  await waitForServer(PORT, 20000);

  const lan = lanAddress();

  if (LOCAL_ONLY) {
    banner([
      `${C.bold}The game is running on this computer.${C.reset}`,
      '',
      `On this machine   ${C.cyan}http://localhost:${PORT}${C.reset}`,
      lan ? `Same Wi-Fi        ${C.cyan}http://${lan}:${PORT}${C.reset}` : '',
      '',
      `${C.dim}Keep this window open. Ctrl+C stops the game.${C.reset}`,
    ].filter((l) => l !== ''));
    return;
  }

  // ---- 2. the public tunnel ----------------------------------------------
  let exe;
  try {
    exe = await ensureCloudflared();
  } catch (err) {
    warn(`could not set up the tunnel: ${err.message}`);
    warn('falling back to local play only.');
    banner([
      `${C.bold}The game is running, but only on this network.${C.reset}`,
      '',
      `On this machine   ${C.cyan}http://localhost:${PORT}${C.reset}`,
      lan ? `Same Wi-Fi        ${C.cyan}http://${lan}:${PORT}${C.reset}` : '',
    ].filter((l) => l !== ''));
    return;
  }

  step('opening a public tunnel…');
  const tunnel = spawn(exe, [
    'tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(tunnel);

  let announced = false;
  const scan = (buf) => {
    const text = buf.toString();
    const match = text.match(/https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i);
    if (match && !announced) {
      announced = true;
      banner([
        `${C.bold}Send this link to your friends:${C.reset}`,
        '',
        `   ${C.bold}${C.cyan}${match[0]}${C.reset}`,
        '',
        'It works on any phone or computer, anywhere.',
        lan ? `${C.dim}On this Wi-Fi you can also use http://${lan}:${PORT}${C.reset}` : '',
        '',
        `${C.dim}Keep this window open while you play.${C.reset}`,
        `${C.dim}The link changes every time you restart. Ctrl+C stops the game.${C.reset}`,
      ].filter((l) => l !== ''));
    }
    // cloudflared is chatty; only surface real problems once the link is up.
    if (!announced || /ERR|error/i.test(text)) {
      for (const line of text.split('\n')) {
        if (line.trim() && !/^\s*$/.test(line)) process.stdout.write(`${C.dim}   ${line.trim()}\n${C.reset}`);
      }
    }
  };
  tunnel.stdout.on('data', scan);
  tunnel.stderr.on('data', scan);
  tunnel.on('exit', (code) => {
    if (shuttingDown) return;
    if (announced) {
      // The link was live and the tunnel dropped: it can come back on its own,
      // so say what happened without tearing the game down.
      fail(`the tunnel dropped (exit ${code}). The game is still running locally.`);
      return;
    }
    // It never came up at all. Some networks block Cloudflare outright, so
    // explain it and hand back the addresses that do work.
    fail(`the tunnel could not start (exit ${code}).`);
    warn('this usually means the network blocks Cloudflare - a company, school');
    warn('or public Wi-Fi connection. The game itself is fine and still running:');
    banner([
      `${C.bold}Playable on this network only.${C.reset}`,
      '',
      `On this machine   ${C.cyan}http://localhost:${PORT}${C.reset}`,
      lan ? `Same Wi-Fi        ${C.cyan}http://${lan}:${PORT}${C.reset}` : '',
      '',
      `${C.dim}To play with people elsewhere, try another network or host the${C.reset}`,
      `${C.dim}server online - see README.md.${C.reset}`,
    ].filter((l) => l !== ''));
  });

  setTimeout(() => {
    if (!announced && !tunnel.exitCode) {
      warn('the tunnel is taking a while - check your internet connection.');
    }
  }, 25000);
}

/** Polls the health endpoint so the tunnel never points at a dead port. */
function waitForServer(port, timeoutMs) {
  const http = require('node:http');
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 1500 }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() > deadline) return reject(new Error('the game server did not start in time'));
      setTimeout(attempt, 400);
    };
    attempt();
  });
}

main().catch((err) => {
  fail(err.message);
  shutdown(1);
});
