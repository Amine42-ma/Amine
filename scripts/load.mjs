/**
 * Load probe: connects N clients that move and trade continuously, then reports
 * server responsiveness. Use it to check the tick loop keeps up as the world
 * fills with players.
 *
 *   node scripts/load.mjs [clients] [seconds] [ws://host/ws]
 */
import { WebSocket } from 'ws';

const clientCount = Number(process.argv[2] ?? 25);
const seconds = Number(process.argv[3] ?? 20);
const url = process.argv[4] ?? 'ws://localhost:8099/ws';
const httpBase = url.replace(/^ws/, 'http').replace(/\/ws$/, '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const latencies = [];
let messages = 0;
let errors = 0;

function spawnClient(index) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let self = null;
    let world = null;
    let timer = null;

    const send = (m) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

    ws.on('message', (raw) => {
      messages++;
      const msg = JSON.parse(String(raw));
      if (msg.t === 'authOk') world = msg.world;
      if (msg.t === 'self') self = msg.self;
      if (msg.t === 'pong') latencies.push(Date.now() - msg.at);
    });

    ws.on('error', () => { errors++; });
    ws.on('open', () => {
      send({ t: 'auth', name: `load${index}_${Math.floor(Math.random() * 1e5)}`, password: 'loadtest', mode: 'register' });

      // Each client walks toward a random settlement and pings for latency.
      timer = setInterval(() => {
        if (!self || !world) return;
        const target = world.settlements[index % world.settlements.length];
        const dx = target.x - self.x;
        const dy = target.y - self.y;
        const d = Math.hypot(dx, dy) || 1;
        self.x += (dx / d) * 0.2;
        self.y += (dy / d) * 0.2;
        send({ t: 'move', x: self.x, y: self.y });
        if (Math.random() < 0.15) send({ t: 'ping', at: Date.now() });
        if (Math.random() < 0.05) send({ t: 'requestMarket', settlementId: target.id });
      }, 80);
    });

    setTimeout(() => {
      clearInterval(timer);
      ws.close();
      resolve();
    }, seconds * 1000);
  });
}

console.log(`\nspawning ${clientCount} clients for ${seconds}s against ${url}\n`);
const before = await fetch(`${httpBase}/api/health`).then((r) => r.json());

const started = Date.now();
await Promise.all(Array.from({ length: clientCount }, (_, i) => spawnClient(i)));
const elapsed = (Date.now() - started) / 1000;

const after = await fetch(`${httpBase}/api/health`).then((r) => r.json());
latencies.sort((a, b) => a - b);
const pct = (p) => latencies[Math.floor(latencies.length * p)] ?? 0;

console.log(`clients        : ${clientCount}`);
console.log(`socket errors  : ${errors}`);
console.log(`messages in    : ${messages} (${(messages / elapsed).toFixed(0)}/s)`);
console.log(`round-trip p50 : ${pct(0.5)}ms`);
console.log(`round-trip p95 : ${pct(0.95)}ms`);
console.log(`round-trip max : ${latencies.at(-1) ?? 0}ms`);
console.log(`players        : ${before.players} → ${after.players}`);
console.log(`price index    : ${before.priceIndex.toFixed(4)} → ${after.priceIndex.toFixed(4)}`);
console.log(
  `\n${pct(0.95) < 250 && errors === 0 ? '✅ server kept up' : '⚠️  server struggled'}\n`,
);
process.exit(0);
