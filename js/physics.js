/* =========================================================================
 * physics.js — Verlet integration physics engine
 * Particles (point masses) connected by distance constraints, with world
 * collision against static rectangular platforms. This is the backbone of
 * the ragdoll stickman characters.
 * ========================================================================= */
'use strict';

/**
 * A single point mass integrated with Verlet integration.
 * Velocity is implicit (current - previous position).
 */
class Particle {
  constructor(x, y, radius = 6, mass = 1) {
    this.x = x; this.y = y;
    this.px = x; this.py = y;      // previous position
    this.ax = 0; this.ay = 0;      // accumulated acceleration
    this.radius = radius;
    this.mass = mass;
    this.invMass = mass > 0 ? 1 / mass : 0;
    this.pinned = false;
    this.onGround = false;
    this.friction = 0.99;          // air/velocity damping
    this.groundFriction = 0.72;    // horizontal damping while touching ground
    this.bounce = 0.15;
  }

  /** Apply a force (scaled by inverse mass) */
  applyForce(fx, fy) {
    this.ax += fx * this.invMass;
    this.ay += fy * this.invMass;
  }

  /** Instantly nudge velocity by adjusting previous position */
  applyImpulse(ix, iy) {
    this.px -= ix;
    this.py -= iy;
  }

  get vx() { return this.x - this.px; }
  get vy() { return this.y - this.py; }
  get speed() { return Math.hypot(this.x - this.px, this.y - this.py); }

  integrate(dt, gravity) {
    if (this.pinned) { this.ax = 0; this.ay = 0; return; }
    this.ay += gravity;
    const damp = this.onGround ? this.groundFriction : this.friction;
    let vx = (this.x - this.px) * (this.onGround ? damp : this.friction);
    let vy = (this.y - this.py) * this.friction;
    this.px = this.x;
    this.py = this.y;
    this.x += vx + this.ax * dt * dt;
    this.y += vy + this.ay * dt * dt;
    this.ax = 0; this.ay = 0;
    this.onGround = false;
  }
}

/**
 * A distance constraint (stick) that keeps two particles a fixed length apart.
 */
class Constraint {
  constructor(a, b, stiffness = 1, length = null) {
    this.a = a;
    this.b = b;
    this.stiffness = stiffness;
    this.length = length ?? Math.hypot(b.x - a.x, b.y - a.y);
    this.tearFactor = Infinity; // constraints don't tear by default
    this.broken = false;
  }

  solve() {
    if (this.broken) return;
    const a = this.a, b = this.b;
    let dx = b.x - a.x, dy = b.y - a.y;
    let d = Math.hypot(dx, dy) || 1e-6;
    const diff = (d - this.length) / d;
    if (Math.abs(diff) * this.length > this.length * this.tearFactor) {
      this.broken = true;
      return;
    }
    const sc = this.stiffness * 0.5;
    const totalInv = a.invMass + b.invMass || 1;
    const offx = dx * diff * sc;
    const offy = dy * diff * sc;
    const wa = a.invMass / totalInv;
    const wb = b.invMass / totalInv;
    if (!a.pinned) { a.x += offx * (wa * 2); a.y += offy * (wa * 2); }
    if (!b.pinned) { b.x -= offx * (wb * 2); b.y -= offy * (wb * 2); }
  }
}

/**
 * An angular constraint that softly pulls a joint (a-b-c) toward a rest angle.
 * Gives limbs "muscle" so the ragdoll can stand and pose instead of collapsing.
 */
class AngleConstraint {
  constructor(a, b, c, restAngle, stiffness = 0.08) {
    this.a = a; this.b = b; this.c = c; // b is the pivot
    this.restAngle = restAngle;
    this.stiffness = stiffness;
    this.enabled = true;
    this.target = restAngle;
  }

  solve() {
    if (!this.enabled) return;
    const { a, b, c } = this;
    const a1 = Math.atan2(a.y - b.y, a.x - b.x);
    const a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let diff = a2 - a1;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    let err = this.target - diff;
    while (err < -Math.PI) err += Math.PI * 2;
    while (err > Math.PI) err -= Math.PI * 2;
    const rot = err * this.stiffness;
    // Rotate c around b by +rot, and a around b by -rot (softly)
    rotateAround(c, b, rot * 0.5);
    rotateAround(a, b, -rot * 0.5);
  }
}

function rotateAround(p, o, ang) {
  if (p.pinned) return;
  const s = Math.sin(ang), cs = Math.cos(ang);
  const dx = p.x - o.x, dy = p.y - o.y;
  p.x = o.x + dx * cs - dy * s;
  p.y = o.y + dx * s + dy * cs;
}

/**
 * The physics world: integrates all particles, solves constraints, and
 * resolves collisions with static platforms and world bounds.
 */
class PhysicsWorld {
  constructor(opts = {}) {
    this.gravity = opts.gravity ?? 0.55;
    this.iterations = opts.iterations ?? 6;
    this.particles = [];
    this.constraints = [];
    this.angleConstraints = [];
    this.platforms = [];        // {x,y,w,h}
    this.bounds = opts.bounds ?? { x: 0, y: 0, w: 1600, h: 900 };
    this.killY = opts.killY ?? 3000;
  }

  addParticle(p) { this.particles.push(p); return p; }
  addConstraint(c) { this.constraints.push(c); return c; }
  addAngle(c) { this.angleConstraints.push(c); return c; }

  removeParticles(list) {
    const set = new Set(list);
    this.particles = this.particles.filter((p) => !set.has(p));
    this.constraints = this.constraints.filter((c) => !set.has(c.a) && !set.has(c.b));
    this.angleConstraints = this.angleConstraints.filter(
      (c) => !set.has(c.a) && !set.has(c.b) && !set.has(c.c)
    );
  }

  step(dt = 1) {
    // Integrate
    for (const p of this.particles) p.integrate(dt, this.gravity);

    // Solve constraints iteratively for stability
    for (let it = 0; it < this.iterations; it++) {
      for (const c of this.constraints) c.solve();
      for (const c of this.angleConstraints) c.solve();
      for (const p of this.particles) this.collide(p);
    }
  }

  /** Resolve a particle against platforms and world side walls.
   *  Robust against deep penetration (zero-normal degeneracy) and against
   *  tunnelling through the top surface at speed (swept landing check). */
  collide(p) {
    if (p.pinned) return;
    const r = p.radius;

    // World side walls
    if (p.x - r < this.bounds.x) { p.x = this.bounds.x + r; p.px = p.x + p.vx * 0.3; }
    if (p.x + r > this.bounds.x + this.bounds.w) {
      p.x = this.bounds.x + this.bounds.w - r; p.px = p.x + p.vx * 0.3;
    }

    for (const plat of this.platforms) {
      const top = plat.y, bottom = plat.y + plat.h;
      const left = plat.x, right = plat.x + plat.w;
      const withinX = p.x > left - 2 && p.x < right + 2;

      // 1) Swept landing on the TOP surface — catches fast downward movement
      //    that would otherwise tunnel straight through a thin platform.
      if (withinX && p.py <= top + 1 && p.y + r >= top && p.vy >= -0.001) {
        p.y = top - r;
        if (p.vy > 0) p.py = p.y + p.vy * p.bounce;
        p.onGround = true;
        continue;
      }

      // 2) Deep penetration (particle centre inside the box) → push out the
      //    nearest face. Handles the zero-normal degenerate case.
      const insideX = p.x > left && p.x < right;
      const insideY = p.y > top && p.y < bottom;
      if (insideX && insideY) {
        const toL = p.x - left, toR = right - p.x;
        const toT = p.y - top, toB = bottom - p.y;
        const m = Math.min(toL, toR, toT, toB);
        if (m === toT) { p.y = top - r; p.onGround = true; if (p.vy > 0) p.py = p.y + p.vy * p.bounce; }
        else if (m === toB) { p.y = bottom + r; if (p.vy < 0) p.py = p.y; }
        else if (m === toL) { p.x = left - r; }
        else { p.x = right + r; }
        continue;
      }

      // 3) Circle vs nearest edge / corner
      const nearestX = Utils.clamp(p.x, left, right);
      const nearestY = Utils.clamp(p.y, top, bottom);
      const dx = p.x - nearestX, dy = p.y - nearestY;
      const dsq = dx * dx + dy * dy;
      if (dsq < r * r) {
        const d = Math.sqrt(dsq) || 1e-6;
        const nx = dx / d, ny = dy / d;
        const overlap = r - d;
        p.x += nx * overlap;
        p.y += ny * overlap;
        if (ny < -0.5) {
          p.onGround = true;
          if (p.vy > 0) p.py = p.y + p.vy * p.bounce;
        }
      }
    }
  }
}
