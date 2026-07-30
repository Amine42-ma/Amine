import { TILE_SIZE } from '../../shared/constants.js';
import { mulberry32 } from '../../shared/util.js';

/**
 * Every tile sprite is drawn procedurally at boot into one offscreen atlas, so
 * the game ships with zero image assets and still gets varied, textured terrain.
 * Rendering then costs one drawImage per visible tile.
 */

export const VARIANTS = 8;

const PALETTE: Record<number, { base: string; shade: string; light: string }> = {
  0: { base: '#1d4f7c', shade: '#153c60', light: '#2f6fa5' }, // water
  1: { base: '#d8c18a', shade: '#c2a874', light: '#ecd9a8' }, // sand
  2: { base: '#4a7c3f', shade: '#3d6935', light: '#5e9450' }, // grass
  3: { base: '#2f5c33', shade: '#24482a', light: '#3d7340' }, // forest
  4: { base: '#c8a35d', shade: '#b08d4c', light: '#dfbc78' }, // desert
  5: { base: '#6b6b70', shade: '#55555a', light: '#8b8b92' }, // mountain
  6: { base: '#9b7f56', shade: '#836a47', light: '#b39468' }, // road
};

let atlas: HTMLCanvasElement | null = null;

export function tileAtlas(): HTMLCanvasElement {
  if (atlas) return atlas;
  const size = TILE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size * VARIANTS;
  canvas.height = size * 7;
  const ctx = canvas.getContext('2d')!;

  for (let terrain = 0; terrain < 7; terrain++) {
    for (let v = 0; v < VARIANTS; v++) {
      ctx.save();
      ctx.translate(v * size, terrain * size);
      ctx.beginPath();
      ctx.rect(0, 0, size, size);
      ctx.clip();
      drawTile(ctx, terrain, v, size);
      ctx.restore();
    }
  }
  atlas = canvas;
  return canvas;
}

function drawTile(ctx: CanvasRenderingContext2D, terrain: number, variant: number, size: number) {
  const pal = PALETTE[terrain];
  const rng = mulberry32(terrain * 7919 + variant * 104729 + 17);

  ctx.fillStyle = pal.base;
  ctx.fillRect(0, 0, size, size);

  // Each variant sits at a slightly different brightness. Without this, large
  // stretches of one terrain read as an obviously tiled pattern.
  const jitter = (variant / (VARIANTS - 1) - 0.5) * 0.05;
  ctx.fillStyle = jitter > 0 ? `rgba(255,255,255,${jitter})` : `rgba(0,0,0,${-jitter})`;
  ctx.fillRect(0, 0, size, size);

  // A light speckle pass gives every tile some grain instead of flat colour.
  const speckles = terrain === 0 ? 10 : 26;
  for (let i = 0; i < speckles; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 0.6 + rng() * 1.7;
    ctx.fillStyle = rng() > 0.5 ? pal.light : pal.shade;
    ctx.globalAlpha = 0.16 + rng() * 0.2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  switch (terrain) {
    case 0: { // water — soft horizontal wave crests
      ctx.strokeStyle = 'rgba(190, 225, 255, 0.22)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) {
        const y = 5 + i * 10 + rng() * 4;
        ctx.beginPath();
        ctx.moveTo(-2, y);
        for (let x = 0; x <= size + 2; x += 4) {
          ctx.lineTo(x, y + Math.sin((x / size) * Math.PI * 2 + i) * 1.6);
        }
        ctx.stroke();
      }
      break;
    }
    case 2: { // grass — small tufts
      ctx.strokeStyle = 'rgba(140, 200, 120, 0.5)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) {
        const x = rng() * size;
        const y = rng() * size;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rng() - 0.5) * 3, y - 3 - rng() * 2);
        ctx.stroke();
      }
      break;
    }
    case 3: { // forest — clustered canopies with a trunk hint
      for (let i = 0; i < 4; i++) {
        const x = 5 + rng() * (size - 10);
        const y = 6 + rng() * (size - 12);
        const r = 4 + rng() * 3;
        ctx.fillStyle = 'rgba(20, 45, 24, 0.55)';
        ctx.beginPath();
        ctx.arc(x + 1, y + 2, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = i % 2 ? '#3f7d43' : '#4c8f4a';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 4: { // desert — dune ridges
      ctx.strokeStyle = 'rgba(255, 240, 200, 0.3)';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) {
        const y = 6 + i * 9 + rng() * 3;
        ctx.beginPath();
        ctx.moveTo(0, y + 3);
        ctx.quadraticCurveTo(size / 2, y - 3, size, y + 3);
        ctx.stroke();
      }
      break;
    }
    case 5: { // mountain — faceted rock
      for (let i = 0; i < 3; i++) {
        const x = 4 + rng() * (size - 8);
        const y = 6 + rng() * (size - 10);
        const w = 6 + rng() * 8;
        const h = 5 + rng() * 8;
        ctx.fillStyle = 'rgba(40, 40, 46, 0.5)';
        ctx.beginPath();
        ctx.moveTo(x - w / 2, y + h / 2);
        ctx.lineTo(x, y - h / 2);
        ctx.lineTo(x + w / 2, y + h / 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#9a9aa2';
        ctx.beginPath();
        ctx.moveTo(x - w / 2 + 1, y + h / 2 - 1);
        ctx.lineTo(x, y - h / 2 + 1);
        ctx.lineTo(x + 1, y + h / 2 - 1);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 6: { // road — worn cobbles
      ctx.fillStyle = 'rgba(70, 55, 36, 0.35)';
      for (let i = 0; i < 9; i++) {
        const x = rng() * size;
        const y = rng() * size;
        ctx.fillRect(x, y, 3 + rng() * 3, 2 + rng() * 2);
      }
      break;
    }
    default:
      break;
  }
}

/** Deterministic variant per world position, so terrain never shimmers. */
export function variantFor(x: number, y: number): number {
  return (((x * 73856093) ^ (y * 19349663)) >>> 0) % VARIANTS;
}
