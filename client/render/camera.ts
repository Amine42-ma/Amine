import { TILE_SIZE } from '../../shared/constants.js';
import { clamp, lerp } from '../../shared/util.js';

/** A follow camera in world (tile) coordinates, with smoothing and zoom. */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  private targetZoom = 1;

  constructor(public viewW: number, public viewH: number) {}

  resize(w: number, h: number) {
    this.viewW = w;
    this.viewH = h;
  }

  follow(tx: number, ty: number, dt: number, worldW: number, worldH: number) {
    // Critically-damped-ish smoothing: snappy but never jittery.
    const k = 1 - Math.pow(0.0016, dt);
    this.x = lerp(this.x, tx, k);
    this.y = lerp(this.y, ty, k);
    this.zoom = lerp(this.zoom, this.targetZoom, 1 - Math.pow(0.004, dt));

    const halfW = this.viewW / (2 * TILE_SIZE * this.zoom);
    const halfH = this.viewH / (2 * TILE_SIZE * this.zoom);
    // Only clamp when the world is bigger than the viewport on that axis.
    if (worldW > halfW * 2) this.x = clamp(this.x, halfW, worldW - halfW);
    if (worldH > halfH * 2) this.y = clamp(this.y, halfH, worldH - halfH);
  }

  nudgeZoom(delta: number) {
    this.targetZoom = clamp(this.targetZoom * (delta > 0 ? 0.88 : 1.14), 0.55, 2.4);
  }

  setZoom(z: number) {
    this.targetZoom = clamp(z, 0.55, 2.4);
  }

  get scale(): number {
    return TILE_SIZE * this.zoom;
  }

  worldToScreen(wx: number, wy: number): [number, number] {
    return [
      (wx - this.x) * this.scale + this.viewW / 2,
      (wy - this.y) * this.scale + this.viewH / 2,
    ];
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    return [
      (sx - this.viewW / 2) / this.scale + this.x,
      (sy - this.viewH / 2) / this.scale + this.y,
    ];
  }

  /** Inclusive tile bounds currently on screen, padded by one tile. */
  visibleTiles(worldW: number, worldH: number) {
    const halfW = this.viewW / (2 * this.scale) + 1;
    const halfH = this.viewH / (2 * this.scale) + 1;
    return {
      x0: Math.max(0, Math.floor(this.x - halfW)),
      x1: Math.min(worldW - 1, Math.ceil(this.x + halfW)),
      y0: Math.max(0, Math.floor(this.y - halfH)),
      y1: Math.min(worldH - 1, Math.ceil(this.y + halfH)),
    };
  }
}
