// Tiny dependency-free 2D rasterizer. Draws into an RGB framebuffer (Buffer of
// w*h*3 bytes) with alpha blending and light anti-aliasing on round shapes.
// Enough to draw stickman films: gradient skies, ground, sun, silhouettes,
// and skeletal figures built from capsules and circles.

export class Frame {
  constructor(width, height) {
    this.w = width;
    this.h = height;
    this.buf = Buffer.alloc(width * height * 3);
  }

  // Copy this frame (used to stamp a fresh backdrop each animation frame).
  clone() {
    const f = new Frame(this.w, this.h);
    this.buf.copy(f.buf);
    return f;
  }

  // Blend a colour {r,g,b} at integer (x,y) with coverage a in 0..1.
  blend(x, y, r, g, b, a) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    const ia = 1 - a;
    this.buf[i] = this.buf[i] * ia + r * a;
    this.buf[i + 1] = this.buf[i + 1] * ia + g * a;
    this.buf[i + 2] = this.buf[i + 2] * ia + b * a;
  }

  // Vertical gradient fill (top → bottom) as the base sky.
  gradientV(top, bottom) {
    for (let y = 0; y < this.h; y++) {
      const t = y / (this.h - 1);
      const r = top[0] + (bottom[0] - top[0]) * t;
      const g = top[1] + (bottom[1] - top[1]) * t;
      const b = top[2] + (bottom[2] - top[2]) * t;
      let i = y * this.w * 3;
      for (let x = 0; x < this.w; x++) {
        this.buf[i++] = r;
        this.buf[i++] = g;
        this.buf[i++] = b;
      }
    }
  }

  fillRect(x0, y0, x1, y1, [r, g, b], a = 1) {
    const xa = Math.max(0, Math.floor(Math.min(x0, x1)));
    const xb = Math.min(this.w, Math.ceil(Math.max(x0, x1)));
    const ya = Math.max(0, Math.floor(Math.min(y0, y1)));
    const yb = Math.min(this.h, Math.ceil(Math.max(y0, y1)));
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) this.blend(x, y, r, g, b, a);
  }

  // Filled circle with ~1px anti-aliased edge.
  fillCircle(cx, cy, rad, [r, g, b], a = 1) {
    if (rad <= 0) return;
    const x0 = Math.max(0, Math.floor(cx - rad - 1));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + rad + 1));
    const y0 = Math.max(0, Math.floor(cy - rad - 1));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + rad + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const cov = clamp(rad + 0.5 - d, 0, 1);
        if (cov > 0) this.blend(x, y, r, g, b, cov * a);
      }
    }
  }

  // Capsule: a thick line with round caps (a limb/bone).
  capsule(x0, y0, x1, y1, thick, color, a = 1) {
    const rad = thick / 2;
    const minx = Math.max(0, Math.floor(Math.min(x0, x1) - rad - 1));
    const maxx = Math.min(this.w - 1, Math.ceil(Math.max(x0, x1) + rad + 1));
    const miny = Math.max(0, Math.floor(Math.min(y0, y1) - rad - 1));
    const maxy = Math.min(this.h - 1, Math.ceil(Math.max(y0, y1) + rad + 1));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1;
    const [r, g, b] = color;
    for (let y = miny; y <= maxy; y++) {
      for (let x = minx; x <= maxx; x++) {
        const px = x + 0.5 - x0;
        const py = y + 0.5 - y0;
        let t = (px * dx + py * dy) / len2;
        t = clamp(t, 0, 1);
        const d = Math.hypot(px - dx * t, py - dy * t);
        const cov = clamp(rad + 0.5 - d, 0, 1);
        if (cov > 0) this.blend(x, y, r, g, b, cov * a);
      }
    }
  }

  // Filled convex/simple polygon via scanline (points: [[x,y],...]).
  fillPolygon(points, [r, g, b], a = 1) {
    let miny = Infinity, maxy = -Infinity;
    for (const p of points) { miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]); }
    miny = Math.max(0, Math.floor(miny));
    maxy = Math.min(this.h - 1, Math.ceil(maxy));
    const n = points.length;
    for (let y = miny; y <= maxy; y++) {
      const yc = y + 0.5;
      const xs = [];
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = points[i][1], yj = points[j][1];
        if ((yi > yc) !== (yj > yc)) {
          const xi = points[i][0], xj = points[j][0];
          xs.push(xi + ((yc - yi) / (yj - yi)) * (xj - xi));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.floor(xs[k]));
        const xb = Math.min(this.w - 1, Math.ceil(xs[k + 1]));
        for (let x = xa; x <= xb; x++) this.blend(x, y, r, g, b, a);
      }
    }
  }
}

export function clamp(n, lo, hi) {
  return n < lo ? lo : n > hi ? hi : n;
}

// Parse "rrggbb" → [r,g,b].
export function rgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Mix two [r,g,b] colours by t.
export function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
