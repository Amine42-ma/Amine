/* =========================================================================
 * utils.js — Math helpers, 2D vector, RNG and small utilities
 * Stickman Duel — a professional 2D physics fighting game
 * ========================================================================= */
'use strict';

const Utils = (() => {
  const TAU = Math.PI * 2;

  /** Clamp value between min and max */
  const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

  /** Linear interpolation */
  const lerp = (a, b, t) => a + (b - a) * t;

  /** Map a value from one range to another */
  const map = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);

  /** Random float in [min, max) */
  const rand = (min = 0, max = 1) => min + Math.random() * (max - min);

  /** Random integer in [min, max] */
  const randInt = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

  /** Pick a random element from an array */
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  /** Random sign (-1 or 1) */
  const randSign = () => (Math.random() < 0.5 ? -1 : 1);

  /** Distance between two points */
  const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

  /** Squared distance (cheap) */
  const distSq = (x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1;
    return dx * dx + dy * dy;
  };

  /** Shortest signed difference between two angles */
  const angleDiff = (a, b) => {
    let d = (b - a) % TAU;
    if (d < -Math.PI) d += TAU;
    if (d > Math.PI) d -= TAU;
    return d;
  };

  /**
   * Distance from a point to a line segment, plus the closest point.
   * Used for weapon/limb collision detection.
   */
  const pointToSegment = (px, py, ax, ay, bx, by) => {
    const abx = bx - ax, aby = by - ay;
    const apx = px - ax, apy = py - ay;
    const abLenSq = abx * abx + aby * aby || 1e-6;
    let t = (apx * abx + apy * aby) / abLenSq;
    t = clamp(t, 0, 1);
    const cx = ax + abx * t, cy = ay + aby * t;
    return { dist: Math.hypot(px - cx, py - cy), x: cx, y: cy, t };
  };

  /**
   * Shortest distance between two line segments (weapon vs limb).
   * Returns distance and the closest points on each segment.
   */
  const segmentToSegment = (a1x, a1y, a2x, a2y, b1x, b1y, b2x, b2y) => {
    // Test all endpoint-to-segment combos (good enough for thin sticks)
    const c1 = pointToSegment(a1x, a1y, b1x, b1y, b2x, b2y);
    const c2 = pointToSegment(a2x, a2y, b1x, b1y, b2x, b2y);
    const c3 = pointToSegment(b1x, b1y, a1x, a1y, a2x, a2y);
    const c4 = pointToSegment(b2x, b2y, a1x, a1y, a2x, a2y);
    let best = { dist: c1.dist, px: a1x, py: a1y, qx: c1.x, qy: c1.y };
    if (c2.dist < best.dist) best = { dist: c2.dist, px: a2x, py: a2y, qx: c2.x, qy: c2.y };
    if (c3.dist < best.dist) best = { dist: c3.dist, px: c3.x, py: c3.y, qx: b1x, qy: b1y };
    if (c4.dist < best.dist) best = { dist: c4.dist, px: c4.x, py: c4.y, qx: b2x, qy: b2y };
    return best;
  };

  /** Simple event emitter mixin */
  class Emitter {
    constructor() { this._handlers = {}; }
    on(ev, fn) { (this._handlers[ev] ||= []).push(fn); return this; }
    off(ev, fn) {
      if (!this._handlers[ev]) return;
      this._handlers[ev] = this._handlers[ev].filter((h) => h !== fn);
    }
    emit(ev, ...args) {
      (this._handlers[ev] || []).forEach((h) => h(...args));
    }
  }

  return {
    TAU, clamp, lerp, map, rand, randInt, pick, randSign,
    dist, distSq, angleDiff, pointToSegment, segmentToSegment, Emitter,
  };
})();
