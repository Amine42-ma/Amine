import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { hashString } from '../shared/util.js';
import { Hub } from './net.js';
import { startLoop } from './loop.js';
import { loadState, saveState } from './persistence.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const publicDir = path.join(root, 'public');
const dataDir = process.env.EOM_DATA_DIR ?? path.join(root, 'data');

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const SEED = process.env.EOM_SEED ? Number(process.env.EOM_SEED) : hashString('empire-of-merchants');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function main() {
  const state = await loadState({ dir: dataDir, seed: SEED });
  const hub = new Hub(state);

  let saving = false;
  const persist = () => {
    if (saving) return;
    saving = true;
    saveState(state, { dir: dataDir, seed: SEED })
      .catch((err) => console.error('[persistence] save failed:', err))
      .finally(() => { saving = false; });
  };

  const server = createServer((req, res) => handleHttp(req, res, state));
  const wss = new WebSocketServer({ server, path: '/ws' });
  hub.attach(wss);

  const loop = startLoop(state, hub, persist);

  server.listen(PORT, HOST, () => {
    console.log(`\n  ⚖️  Empire of Merchants`);
    console.log(`  ──────────────────────────────────────`);
    console.log(`  world seed   : ${state.seed}`);
    console.log(`  settlements  : ${state.map.settlements.length}`);
    console.log(`  season       : ${state.season.index}`);
    console.log(`  listening on : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}\n`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n[server] ${signal} received, saving world...`);
    loop.stop();
    try {
      await saveState(state, { dir: dataDir, seed: SEED });
      console.log('[server] world saved.');
    } catch (err) {
      console.error('[server] save on shutdown failed:', err);
    }
    wss.close();
    server.close(() => process.exit(0));
    // Never hang forever on a stuck socket.
    setTimeout(() => process.exit(0), 3000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

function handleHttp(req: IncomingMessage, res: ServerResponse, state: Awaited<ReturnType<typeof loadState>>) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname === '/api/tiles') {
    // The terrain grid is a raw byte per tile; far cheaper than JSON.
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'cache-control': 'public, max-age=3600',
      'x-world-width': String(state.map.width),
      'x-world-height': String(state.map.height),
    });
    res.end(Buffer.from(state.map.tiles));
    return;
  }

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      seed: state.seed,
      season: state.season.index,
      players: state.players.size,
      buildings: state.buildings.size,
      convoys: state.convoys.size,
      events: state.events.map((e) => e.defId),
      priceIndex: state.priceIndex,
    }));
    return;
  }

  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  // Resolve inside publicDir only; anything escaping it is a traversal attempt.
  const filePath = path.join(publicDir, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(publicDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }

  res.writeHead(200, {
    'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
    'cache-control': filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=300',
  });
  createReadStream(filePath).pipe(res);
}

main().catch((err) => {
  console.error('[server] fatal:', err);
  process.exit(1);
});
