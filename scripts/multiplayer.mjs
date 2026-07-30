/**
 * Two-client integration test for the multiplayer surface: direct contracts,
 * alliances, presence and world chat. Verifies that two separate connections
 * actually see and affect each other.
 *
 *   node scripts/multiplayer.mjs [ws://host/ws]
 */
import { WebSocket } from 'ws';

const url = process.argv[2] ?? 'ws://localhost:8099/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function check(label, condition, detail = '') {
  if (condition) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label} ${detail}`); }
}

/** A minimal scripted client. */
function makeClient(name) {
  const ws = new WebSocket(url);
  const state = { name, ws, inbox: [], self: null, world: null, contracts: [], alliances: [] };

  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    state.inbox.push(msg);
    if (state.inbox.length > 300) state.inbox.splice(0, 150);
    if (msg.t === 'self') state.self = msg.self;
    if (msg.t === 'authOk') state.world = msg.world;
    if (msg.t === 'contracts') { state.contracts = msg.contracts; state.alliances = msg.alliances; }
    if (msg.t === 'toast' && msg.level !== 'info') console.log(`    · [${name}] ${msg.level}: ${msg.en}`);
  });

  state.send = (m) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
  state.ready = new Promise((resolve) => {
    ws.on('open', () => {
      state.send({ t: 'auth', name, password: 'multitest', mode: 'register' });
      const poll = setInterval(() => {
        if (state.self && state.world) { clearInterval(poll); resolve(); }
      }, 40);
    });
  });
  return state;
}

/** Walks a client to a settlement so it can trade for goods. */
async function travelTo(client, target) {
  let guard = 0;
  while (Math.hypot(target.x - client.self.x, target.y - client.self.y) > 4 && guard++ < 900) {
    const dx = target.x - client.self.x;
    const dy = target.y - client.self.y;
    const d = Math.hypot(dx, dy) || 1;
    client.self.x += (dx / d) * 0.24;
    client.self.y += (dy / d) * 0.24;
    client.send({ t: 'move', x: client.self.x, y: client.self.y });
    await sleep(80);
  }
}

async function main() {
  const stamp = Math.floor(Math.random() * 1e5);
  const alice = makeClient(`alice${stamp}`);
  const bob = makeClient(`bob${stamp}`);
  console.log(`\nEmpire of Merchants — multiplayer test (${alice.name} / ${bob.name})\n`);

  await Promise.all([alice.ready, bob.ready]);
  check('both clients authenticated', !!alice.self && !!bob.self);

  // Alice buys goods so she has something to sell directly to Bob.
  const home = [...alice.world.settlements]
    .filter((s) => s.kind !== 'island')
    .sort((a, b) => Math.hypot(a.x - alice.self.x, a.y - alice.self.y) - Math.hypot(b.x - alice.self.x, b.y - alice.self.y))[0];
  console.log(`  ${alice.name} travelling to ${home.name_en}…`);
  await travelTo(alice, home);

  alice.send({ t: 'requestMarket', settlementId: home.id });
  await sleep(500);
  const market = alice.inbox.reverse().find((m) => m.t === 'market')?.market;
  alice.inbox.reverse();
  const cheap = [...market.quotes].sort((a, b) => a.buy - b.buy)[0];

  alice.send({ t: 'trade', settlementId: home.id, commodity: cheap.id, quantity: 30, side: 'buy' });
  await sleep(600);
  const held = Math.floor(alice.self.inventory.items[cheap.id] ?? 0);
  check('seller acquired goods to offer', held > 0, JSON.stringify(alice.self.inventory.items));

  /* ------------------------------------------------------------- contracts */

  const askingPrice = 400;
  const aliceGoldBefore = alice.self.gold;
  const bobGoldBefore = bob.self.gold;

  alice.send({ t: 'contractCreate', side: 'sell', commodity: cheap.id, quantity: held, price: askingPrice });
  await sleep(700);

  check('the seller escrowed the goods', (alice.self.inventory.items[cheap.id] ?? 0) < 1,
    JSON.stringify(alice.self.inventory.items));
  check('the contract is visible to the other player', bob.contracts.length > 0,
    `bob sees ${bob.contracts.length} contracts`);

  const offer = bob.contracts.find((c) => c.ownerName === alice.name);
  check('the contract is attributed to its poster', !!offer, JSON.stringify(bob.contracts[0] ?? {}));

  if (offer) {
    bob.send({ t: 'contractAccept', contractId: offer.id });
    await sleep(800);
    // Nudge both sides so we read fresh state.
    alice.send({ t: 'ping', at: Date.now() });
    bob.send({ t: 'requestContracts' });
    await sleep(600);

    check('the buyer received the goods',
      Math.floor(bob.self.inventory.items[cheap.id] ?? 0) === held,
      `bob holds ${bob.self.inventory.items[cheap.id] ?? 0} of ${held}`);
    check('the buyer paid', bob.self.gold <= bobGoldBefore - askingPrice,
      `${bobGoldBefore} → ${bob.self.gold}`);
    check('the seller was paid', alice.self.gold > aliceGoldBefore - askingPrice,
      `${aliceGoldBefore} → ${alice.self.gold}`);
    check('the contract left the board', !bob.contracts.some((c) => c.id === offer.id));
  }

  /* ------------------------------------------------------------- alliances */

  alice.send({ t: 'allianceCreate', name: `Bloc ${stamp}` });
  await sleep(600);
  check('alliance founded', alice.self.allianceName === `Bloc ${stamp}`,
    `allianceName=${alice.self.allianceName}`);
  check('the alliance is visible to other players', bob.alliances.some((a) => a.name === `Bloc ${stamp}`),
    JSON.stringify(bob.alliances));

  const bloc = bob.alliances.find((a) => a.name === `Bloc ${stamp}`);
  if (bloc) {
    bob.send({ t: 'allianceJoin', allianceId: bloc.id });
    await sleep(600);
    check('the second player joined', bob.self.allianceName === `Bloc ${stamp}`,
      `allianceName=${bob.self.allianceName}`);
    const updated = bob.alliances.find((a) => a.id === bloc.id);
    check('membership count updated for everyone', (updated?.members ?? 0) === 2,
      `members=${updated?.members}`);

    bob.send({ t: 'allianceLeave' });
    await sleep(600);
    check('leaving works', bob.self.allianceName === null, `allianceName=${bob.self.allianceName}`);
  }

  /* ------------------------------------------------------------------ chat */

  bob.inbox.length = 0;
  alice.send({ t: 'chat', text: `hello from ${alice.name}` });
  await sleep(600);
  const chat = [...bob.inbox].reverse().find((m) => m.t === 'chat');
  check('world chat reaches other players',
    !!chat?.messages.some((m) => m.text.includes(alice.name) && m.from === alice.name),
    JSON.stringify(chat?.messages.slice(-2) ?? []));

  console.log(`\n${failures === 0 ? '✅ all multiplayer checks passed' : `❌ ${failures} check(s) failed`}\n`);
  alice.ws.close();
  bob.ws.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
