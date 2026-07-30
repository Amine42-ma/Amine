import { store } from '../store.js';
import type { Camera } from './camera.js';

/**
 * The strategic view: a cached bitmap of the whole world with live overlays for
 * settlements, the player, and the camera viewport.
 */

const TERRAIN_COLORS = [
  '#1d4f7c', // water
  '#d8c18a', // sand
  '#4a7c3f', // grass
  '#2f5c33', // forest
  '#c8a35d', // desert
  '#6b6b70', // mountain
  '#9b7f56', // road
];

let baseLayer: HTMLCanvasElement | null = null;
let builtFor: Uint8Array | null = null;

/** Renders the terrain once into an offscreen bitmap; overlays are drawn live. */
function buildBaseLayer(tiles: Uint8Array, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(w, h);

  for (let i = 0; i < tiles.length; i++) {
    const hex = TERRAIN_COLORS[tiles[i]] ?? '#000000';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const o = i * 4;
    image.data[o] = r;
    image.data[o + 1] = g;
    image.data[o + 2] = b;
    image.data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function drawMinimap(canvas: HTMLCanvasElement, camera: Camera) {
  const { tiles, world, self } = store;
  const ctx = canvas.getContext('2d');
  if (!ctx || !tiles || !world) return;

  if (!baseLayer || builtFor !== tiles) {
    baseLayer = buildBaseLayer(tiles, world.width, world.height);
    builtFor = tiles;
  }

  const size = canvas.width;
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(baseLayer, 0, 0, size, size);

  const k = size / world.width;

  // Settlements: bigger dot for bigger places, gold ring for the ones you own in.
  for (const s of store.settlements) {
    const x = s.x * k;
    const y = s.y * k;
    const r = s.kind === 'city' ? 3 : s.kind === 'port' ? 2.5 : 1.8;
    ctx.fillStyle =
      s.kind === 'city' ? '#f6c445'
      : s.kind === 'port' ? '#5b9dff'
      : s.kind === 'island' ? '#a78bfa'
      : '#c9f0c4';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  if (self) {
    for (const b of self.buildings) {
      const s = store.settlements.find((x) => x.id === b.settlementId);
      if (!s) continue;
      ctx.strokeStyle = 'rgba(246,196,69,0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(s.x * k, s.y * k, 4.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Camera viewport rectangle.
  const halfW = camera.viewW / (2 * camera.scale);
  const halfH = camera.viewH / (2 * camera.scale);
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = 1;
  ctx.strokeRect((camera.x - halfW) * k, (camera.y - halfH) * k, halfW * 2 * k, halfH * 2 * k);

  if (self) {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(self.x * k, self.y * k, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/** Converts a click on the minimap into world coordinates. */
export function minimapToWorld(canvas: HTMLCanvasElement, ev: MouseEvent): [number, number] | null {
  const world = store.world;
  if (!world) return null;
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * world.width;
  const y = ((ev.clientY - rect.top) / rect.height) * world.height;
  return [x, y];
}
