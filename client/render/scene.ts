import { TILE_SIZE } from '../../shared/constants.js';
import { VEHICLES } from '../../shared/vehicles.js';
import { COMMODITIES } from '../../shared/commodities.js';
import { EVENT_BY_ID } from '../../shared/events.js';
import { clamp } from '../../shared/util.js';
import { store, currentSettlement } from '../store.js';
import { settlementName, getLang } from '../i18n.js';
import { Camera } from './camera.js';
import { tileAtlas, variantFor } from './atlas.js';
import type { SettlementView } from '../../shared/protocol.js';

/** Draws the whole world every frame: terrain, towns, traffic and weather. */

const SETTLEMENT_STYLE: Record<string, { icon: string; ring: string; scale: number }> = {
  city: { icon: '🏛️', ring: '#f6c445', scale: 1.25 },
  port: { icon: '⚓', ring: '#5b9dff', scale: 1.1 },
  village: { icon: '🏘️', ring: '#8fd694', scale: 0.92 },
  island: { icon: '🏝️', ring: '#a78bfa', scale: 1.0 },
};

export interface SceneDeps {
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  /** Wall-clock seconds since boot, for animation phase. */
  time: number;
  hoverSettlement: SettlementView | null;
}

export function drawScene({ ctx, camera, time, hoverSettlement }: SceneDeps) {
  const { world, tiles } = store;
  ctx.clearRect(0, 0, camera.viewW, camera.viewH);
  if (!world || !tiles) {
    drawLoading(ctx, camera);
    return;
  }

  drawTerrain(ctx, camera, tiles, world.width, world.height);
  drawRouteLines(ctx, camera);
  drawSettlements(ctx, camera, time, hoverSettlement);
  drawConvoys(ctx, camera, time);
  drawOtherPlayers(ctx, camera, time);
  drawSelf(ctx, camera, time);
  drawWeather(ctx, camera, time);
  drawEdgeVignette(ctx, camera);
}

function drawLoading(ctx: CanvasRenderingContext2D, camera: Camera) {
  ctx.fillStyle = '#0b1018';
  ctx.fillRect(0, 0, camera.viewW, camera.viewH);
  ctx.fillStyle = '#5b6b88';
  ctx.font = '16px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('…', camera.viewW / 2, camera.viewH / 2);
}

const ROAD = 6;
let roadBase: Uint8Array | null = null;

/**
 * Road tiles overwrite whatever terrain they were carved through, so we recover
 * a plausible ground type by voting among nearby non-road tiles. Roads can then
 * be drawn as a path *on top of* real terrain instead of as brown squares.
 */
function ensureRoadBase(tiles: Uint8Array, w: number, h: number): Uint8Array {
  if (roadBase && roadBase.length === tiles.length) return roadBase;
  const out = new Uint8Array(tiles.length);
  const counts = new Int32Array(7);

  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== ROAD) { out[i] = tiles[i]; continue; }
    counts.fill(0);
    const x = i % w;
    const y = (i / w) | 0;
    for (let dy = -2; dy <= 2; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        const terrain = tiles[ny * w + nx];
        if (terrain !== ROAD) counts[terrain]++;
      }
    }
    let best = 2;
    let bestCount = -1;
    for (let k = 0; k < 7; k++) if (counts[k] > bestCount) { bestCount = counts[k]; best = k; }
    out[i] = best;
  }
  roadBase = out;
  return out;
}

function drawTerrain(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  tiles: Uint8Array,
  worldW: number,
  worldH: number,
) {
  const atlas = tileAtlas();
  const base = ensureRoadBase(tiles, worldW, worldH);
  const { x0, x1, y0, y1 } = camera.visibleTiles(worldW, worldH);
  const scale = camera.scale;
  // Rounding up by a pixel avoids hairline seams between neighbouring tiles.
  const size = Math.ceil(scale) + 1;

  ctx.fillStyle = '#08111c';
  ctx.fillRect(0, 0, camera.viewW, camera.viewH);
  ctx.imageSmoothingEnabled = false;

  const roads: [number, number, number, number][] = [];

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const index = y * worldW + x;
      const terrain = tiles[index];
      const v = variantFor(x, y);
      const [sx, sy] = camera.worldToScreen(x, y);
      ctx.drawImage(
        atlas,
        v * TILE_SIZE, (terrain === ROAD ? base[index] : terrain) * TILE_SIZE, TILE_SIZE, TILE_SIZE,
        Math.floor(sx), Math.floor(sy), size, size,
      );
      if (terrain === ROAD) roads.push([x, y, sx, sy]);
    }
  }
  ctx.imageSmoothingEnabled = true;

  if (roads.length > 0) drawRoads(ctx, tiles, worldW, worldH, roads, scale);
}

/** Batches every visible road tile into one path: a disc plus stubs to neighbours. */
function drawRoads(
  ctx: CanvasRenderingContext2D,
  tiles: Uint8Array,
  worldW: number,
  worldH: number,
  roads: [number, number, number, number][],
  scale: number,
) {
  const isRoad = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < worldW && y < worldH && tiles[y * worldW + x] === ROAD;

  const half = scale / 2;

  // Two passes: a wide soft shoulder, then the packed-dirt track on top.
  for (const pass of [
    { width: scale * 0.78, radius: scale * 0.39, color: 'rgba(60, 45, 28, 0.30)' },
    { width: scale * 0.56, radius: scale * 0.28, color: '#a5865c' },
  ]) {
    ctx.beginPath();
    for (const [x, y, sx, sy] of roads) {
      const cx = sx + half;
      const cy = sy + half;
      ctx.moveTo(cx + pass.radius, cy);
      ctx.arc(cx, cy, pass.radius, 0, Math.PI * 2);
      // Stubs reach a full tile so adjacent discs merge into a continuous track.
      if (isRoad(x + 1, y)) ctx.rect(cx, cy - pass.width / 2, scale, pass.width);
      if (isRoad(x - 1, y)) ctx.rect(cx - scale, cy - pass.width / 2, scale, pass.width);
      if (isRoad(x, y + 1)) ctx.rect(cx - pass.width / 2, cy, pass.width, scale);
      if (isRoad(x, y - 1)) ctx.rect(cx - pass.width / 2, cy - scale, pass.width, scale);
    }
    ctx.fillStyle = pass.color;
    ctx.fill();
  }
}

/** Faint lines for the player's own convoy routes, so logistics are legible. */
function drawRouteLines(ctx: CanvasRenderingContext2D, camera: Camera) {
  const self = store.self;
  if (!self || self.convoys.length === 0) return;
  ctx.save();
  ctx.setLineDash([7, 8]);
  ctx.lineWidth = 1.6;
  for (const convoy of self.convoys) {
    const from = store.settlements.find((s) => s.id === convoy.fromId);
    const to = store.settlements.find((s) => s.id === convoy.toId);
    if (!from || !to) continue;
    const [ax, ay] = camera.worldToScreen(from.x, from.y);
    const [bx, by] = camera.worldToScreen(to.x, to.y);
    ctx.strokeStyle = convoy.phase.startsWith('stalled') ? 'rgba(248,113,113,0.5)' : 'rgba(246,196,69,0.4)';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSettlements(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  time: number,
  hover: SettlementView | null,
) {
  const scale = camera.scale;
  const here = currentSettlement();

  for (const s of store.settlements) {
    const [sx, sy] = camera.worldToScreen(s.x, s.y);
    if (sx < -180 || sy < -180 || sx > camera.viewW + 180 || sy > camera.viewH + 180) continue;

    const style = SETTLEMENT_STYLE[s.kind] ?? SETTLEMENT_STYLE.village;
    const r = scale * 1.5 * style.scale;
    const isHere = here?.id === s.id;
    const isHover = hover?.id === s.id;

    // Ground footprint.
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + r * 0.5, r * 1.15, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // The "you can trade here" ring pulses gently.
    if (isHere || isHover) {
      const pulse = 1 + Math.sin(time * 3) * 0.06;
      ctx.strokeStyle = isHere ? 'rgba(246,196,69,0.85)' : 'rgba(255,255,255,0.4)';
      ctx.lineWidth = isHere ? 2.4 : 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, r * 1.55 * pulse, 0, Math.PI * 2);
      ctx.stroke();
    }

    drawTown(ctx, sx, sy, r, style.ring, s.kind);

    if (scale > 14) {
      const label = settlementName(s);
      ctx.font = `600 ${Math.min(15, 10 + scale * 0.14)}px system-ui, 'Noto Sans Arabic', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const ly = sy + r + 6;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(label, sx, ly);
      ctx.fillStyle = isHere ? '#ffd97a' : '#eaf0ff';
      ctx.fillText(label, sx, ly);

      if (s.plotsUsed > 0 && scale > 20) {
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(200,215,245,0.65)';
        ctx.fillText(`${s.plotsUsed}/${s.plots}`, sx, ly + 15);
      }
    }
  }
}

/** A tiny stylised town: a cluster of roofs sized by settlement kind. */
function drawTown(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, ring: string, kind: string) {
  const w = r * 1.5;
  const h = r * 1.15;

  ctx.fillStyle = '#3a3226';
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h * 0.35, w, h * 0.78, 3);
  ctx.fill();

  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - 2, y - h * 0.35);
  ctx.lineTo(x, y - h * 0.95);
  ctx.lineTo(x + w / 2 + 2, y - h * 0.35);
  ctx.closePath();
  ctx.fill();

  // Windows read as a town rather than a shed once we are zoomed in enough.
  if (r > 16) {
    ctx.fillStyle = 'rgba(255, 226, 150, 0.85)';
    const cols = kind === 'city' ? 3 : 2;
    for (let i = 0; i < cols; i++) {
      const wx = x - w / 4 + (i * w) / (cols + 0.5);
      ctx.fillRect(wx, y - h * 0.15, r * 0.16, r * 0.2);
    }
  }
}

function drawConvoys(ctx: CanvasRenderingContext2D, camera: Camera, time: number) {
  const scale = camera.scale;
  for (const convoy of store.convoys) {
    const [sx, sy] = camera.worldToScreen(convoy.x, convoy.y);
    if (sx < -60 || sy < -60 || sx > camera.viewW + 60 || sy > camera.viewH + 60) continue;
    const mine = store.self?.convoys.some((c) => c.id === convoy.id) ?? false;
    const bob = Math.sin(time * 5 + convoy.x) * scale * 0.05;

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + scale * 0.35, scale * 0.42, scale * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = `${Math.max(13, scale * 0.72)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(VEHICLES[convoy.vehicleId].icon, sx, sy + bob);

    if (mine && scale > 16) {
      const good = COMMODITIES[convoy.commodity];
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(`${good.icon}${Math.round(convoy.quantity)}`, sx, sy - scale * 0.7);
    }
  }
}

function drawOtherPlayers(ctx: CanvasRenderingContext2D, camera: Camera, time: number) {
  const scale = camera.scale;
  for (const p of store.others) {
    const smooth = store.lerp.get(p.id);
    const px = smooth ? smooth.x : p.x;
    const py = smooth ? smooth.y : p.y;
    const [sx, sy] = camera.worldToScreen(px, py);
    if (sx < -60 || sy < -60 || sx > camera.viewW + 60 || sy > camera.viewH + 60) continue;
    drawMerchant(ctx, sx, sy, scale, p.vehicle, time, p.isNpc ? '#9aa8c4' : '#7dd3fc', p.name, p.isNpc);
  }
}

function drawSelf(ctx: CanvasRenderingContext2D, camera: Camera, time: number) {
  const self = store.self;
  if (!self) return;
  const [sx, sy] = camera.worldToScreen(self.x, self.y);
  drawMerchant(ctx, sx, sy, camera.scale, self.vehicle, time, '#f6c445', self.name, false, true);
}

function drawMerchant(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  vehicle: keyof typeof VEHICLES,
  time: number,
  color: string,
  label: string,
  isNpc: boolean,
  isSelf = false,
) {
  const bob = Math.sin(time * 6 + x * 0.02) * scale * 0.045;

  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(x, y + scale * 0.34, scale * 0.36, scale * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

  if (isSelf) {
    // A soft halo keeps the player findable in a crowded market square.
    const glow = ctx.createRadialGradient(x, y, 0, x, y, scale * 1.3);
    glow.addColorStop(0, 'rgba(246,196,69,0.30)');
    glow.addColorStop(1, 'rgba(246,196,69,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, scale * 1.3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.font = `${Math.max(14, scale * 0.8)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = isNpc ? 0.85 : 1;
  ctx.fillText(VEHICLES[vehicle].icon, x, y + bob);
  ctx.globalAlpha = 1;

  if (scale > 15) {
    ctx.font = `${isSelf ? '700 ' : ''}11px system-ui, 'Noto Sans Arabic', sans-serif`;
    ctx.textBaseline = 'bottom';
    const ly = y - scale * 0.55;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(label, x, ly);
    ctx.fillStyle = color;
    ctx.fillText(label, x, ly);
  }
}

/**
 * Active world events tint the screen and drop particles, so a storm or a crisis
 * is something you can see rather than something buried in a menu.
 */
function drawWeather(ctx: CanvasRenderingContext2D, camera: Camera, time: number) {
  if (store.events.length === 0) return;
  const here = currentSettlement();
  const region = here?.region ?? null;

  for (const active of store.events) {
    if (active.region !== null && active.region !== region) continue;
    const def = EVENT_BY_ID[active.defId];
    if (!def) continue;

    switch (def.id) {
      case 'storm':
        tint(ctx, camera, 'rgba(30,44,70,0.34)');
        rain(ctx, camera, time, 260, 'rgba(180,205,255,0.5)', 15);
        break;
      case 'drought':
        tint(ctx, camera, 'rgba(190,140,50,0.16)');
        break;
      case 'fire':
        tint(ctx, camera, 'rgba(160,50,20,0.18)');
        embers(ctx, camera, time);
        break;
      case 'earthquake': {
        // A subtle screen shake sells the tremor without breaking aim.
        const shake = Math.sin(time * 40) * 2.2;
        ctx.save();
        ctx.translate(shake, Math.cos(time * 33) * 1.6);
        ctx.restore();
        tint(ctx, camera, 'rgba(90,60,40,0.16)');
        break;
      }
      case 'crisis':
        tint(ctx, camera, 'rgba(20,25,45,0.3)');
        break;
      case 'plague':
        tint(ctx, camera, 'rgba(50,90,60,0.2)');
        break;
      case 'festival':
        confetti(ctx, camera, time);
        break;
      case 'boom':
        tint(ctx, camera, 'rgba(246,196,69,0.08)');
        break;
      default:
        break;
    }
  }
}

function tint(ctx: CanvasRenderingContext2D, camera: Camera, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, camera.viewW, camera.viewH);
}

function rain(
  ctx: CanvasRenderingContext2D, camera: Camera, time: number,
  count: number, color: string, len: number,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const seed = i * 97.13;
    const x = (seed * 31 + time * 220) % (camera.viewW + 120) - 60;
    const y = (seed * 57 + time * 900) % (camera.viewH + 60);
    ctx.moveTo(x, y);
    ctx.lineTo(x - 5, y + len);
  }
  ctx.stroke();
}

function embers(ctx: CanvasRenderingContext2D, camera: Camera, time: number) {
  for (let i = 0; i < 40; i++) {
    const seed = i * 61.7;
    const x = (seed * 47 + Math.sin(time + i) * 30) % camera.viewW;
    const y = camera.viewH - ((seed * 23 + time * 90) % (camera.viewH + 100));
    ctx.fillStyle = `rgba(255,${140 + (i % 60)},60,${0.35 + (i % 5) * 0.08})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.4 + (i % 3) * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function confetti(ctx: CanvasRenderingContext2D, camera: Camera, time: number) {
  const colors = ['#f6c445', '#5b9dff', '#f87171', '#4ade80', '#a78bfa'];
  for (let i = 0; i < 60; i++) {
    const seed = i * 43.9;
    const x = (seed * 71 + Math.sin(time * 1.5 + i) * 40) % camera.viewW;
    const y = (seed * 37 + time * 130) % (camera.viewH + 40);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(time * 2 + i);
    ctx.fillStyle = colors[i % colors.length];
    ctx.globalAlpha = 0.75;
    ctx.fillRect(-2.5, -1.5, 5, 3);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawEdgeVignette(ctx: CanvasRenderingContext2D, camera: Camera) {
  const g = ctx.createRadialGradient(
    camera.viewW / 2, camera.viewH / 2, Math.min(camera.viewW, camera.viewH) * 0.42,
    camera.viewW / 2, camera.viewH / 2, Math.max(camera.viewW, camera.viewH) * 0.78,
  );
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, camera.viewW, camera.viewH);
}

/** Finds the settlement under a screen point, for hover and click-to-inspect. */
export function settlementAtScreen(camera: Camera, sx: number, sy: number): SettlementView | null {
  let best: SettlementView | null = null;
  let bestD = camera.scale * 1.9;
  for (const s of store.settlements) {
    const [x, y] = camera.worldToScreen(s.x, s.y);
    const d = Math.hypot(x - sx, y - sy);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

export function localeDigits(n: number): string {
  return getLang() === 'ar' ? n.toLocaleString('ar-EG') : n.toLocaleString('en-US');
}

export { clamp };
