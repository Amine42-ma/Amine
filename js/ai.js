/* =========================================================================
 * ai.js — Opponent AI controller
 * A simple but effective finite-state fighter AI: it closes distance,
 * spaces itself to weapon reach, attacks in bursts, retreats and blocks
 * when the player is attacking, and occasionally jumps. Difficulty scales
 * reaction time, aggression and block chance.
 * ========================================================================= */
'use strict';

class AIController {
  constructor(self, target, difficulty = 'normal', arena = {}) {
    this.self = self;
    this.target = target;
    this.platforms = arena.platforms || [];   // for ledge / void awareness
    this.hazard = arena.hazard || null;
    this.setDifficulty(difficulty);
    this.decisionTimer = 0;
    this.state = 'approach';
    this.jumpTimer = Utils.randInt(60, 180);
    this.attackHold = 0;
    this.blockTimer = 0;
  }

  /** Is there solid ground to stand on near world-x, a bit below the feet? */
  _groundAt(x, footY) {
    for (const p of this.platforms) {
      if (x >= p.x - 6 && x <= p.x + p.w + 6 && p.y >= footY - 30 && p.y <= footY + 200) return true;
    }
    return false;
  }

  /** Over lava? treat as no-go too. */
  _dangerAt(x, footY) {
    if (this.hazard && this.hazard.type === 'lava' && footY > this.hazard.y - 40) return true;
    return false;
  }

  /** The platform the AI is currently standing on (or null). */
  _standingPlatform(x, footY) {
    for (const p of this.platforms) {
      if (x >= p.x - 6 && x <= p.x + p.w + 6 && Math.abs(footY - p.y) < 60) return p;
    }
    return null;
  }

  /** Is there any platform somewhere below (x, y) to land on? */
  _groundBelow(x, y) {
    for (const p of this.platforms) {
      if (x >= p.x - 8 && x <= p.x + p.w + 8 && p.y >= y - 10 && p.y <= y + 420) return true;
    }
    return false;
  }

  /** X of the nearest platform (at or below y) the AI can steer toward. */
  _nearestGroundX(x, y) {
    let best = null, bd = Infinity;
    for (const p of this.platforms) {
      if (p.y < y - 60) continue;                 // ignore platforms well above
      const cx = Utils.clamp(x, p.x + 14, p.x + p.w - 14);
      const d = Math.abs(cx - x) + Math.max(0, p.y - y) * 0.25;
      if (d < bd) { bd = d; best = cx; }
    }
    return best;
  }

  setDifficulty(d) {
    this.difficulty = d;
    const table = {
      easy:   { react: 26, aggression: 0.4, block: 0.15, spacing: 1.15, jump: 0.15 },
      normal: { react: 16, aggression: 0.62, block: 0.35, spacing: 1.0, jump: 0.28 },
      hard:   { react: 9,  aggression: 0.82, block: 0.55, spacing: 0.92, jump: 0.4 },
      insane: { react: 4,  aggression: 0.95, block: 0.72, spacing: 0.88, jump: 0.5 },
    };
    this.cfg = table[d] || table.normal;
  }

  update() {
    const self = this.self, target = this.target;
    const control = { move: 0, jump: false, attack: false, block: false, dash: false };
    if (!self.alive) { self.setControl(control); return; }

    if (!target.alive) {
      // victory idle: stop moving
      self.setControl(control);
      return;
    }

    const dx = target.centerX - self.centerX;
    const dy = target.centerY - self.centerY;
    const dist = Math.hypot(dx, dy);
    const reach = (self.weapon.reach + self.armReach) * this.cfg.spacing;
    const dir = Math.sign(dx) || 1;

    // Periodic re-decision (reaction time)
    this.decisionTimer--;
    if (this.decisionTimer <= 0) {
      this.decisionTimer = this.cfg.react + Utils.randInt(-3, 6);
      // React to the player's incoming attack → maybe block or dodge
      if (target.attackTimer > 0 && dist < reach + 40) {
        if (Math.random() < this.cfg.block) { this.state = 'block'; this.blockTimer = Utils.randInt(12, 26); }
        else if (Math.random() < 0.4) { this.state = 'retreat'; this.blockTimer = Utils.randInt(10, 20); }
        else this.state = 'attack';
      } else if (dist > reach + 30) {
        this.state = 'approach';
      } else if (dist < reach - 55) {
        this.state = Math.random() < 0.5 ? 'retreat' : 'attack';
      } else {
        // in the pocket → attack if aggressive
        this.state = Math.random() < this.cfg.aggression ? 'attack' : 'space';
      }
    }

    // Execute current state
    switch (this.state) {
      case 'approach':
        control.move = dir;
        // dash to close a big gap quickly
        if (dist > reach + 220 && self.dashCooldown <= 0 && Math.random() < this.cfg.aggression * 0.1) control.dash = true;
        break;
      case 'retreat':
        control.move = -dir;
        if (this.blockTimer-- <= 0) this.state = 'approach';
        break;
      case 'space':
        control.move = dist < reach - 30 ? -dir * 0.6 : dir * 0.6;
        break;
      case 'block':
        control.block = true;
        control.move = -dir * 0.3;
        if (this.blockTimer-- <= 0) this.state = 'approach';
        break;
      case 'attack':
        if (dist < reach + 20) {
          if (self.attackCooldown <= 0) { control.attack = true; }
          // small step-in
          control.move = dist > reach - 20 ? dir * 0.5 : 0;
        } else {
          control.move = dir;
        }
        if (this.attackHold-- <= 0) { this.attackHold = Utils.randInt(6, 16); }
        break;
    }

    const footY = self.isGrounded() ? Math.max(self.footA.y, self.footB.y) : self.pelvis.y + 46;
    const midPlatform = this._groundAt(self.pelvis.x - 55, footY) && this._groundAt(self.pelvis.x + 55, footY);

    // Random / chase jumps — only when safely mid-platform (never near an edge)
    this.jumpTimer--;
    if (this.jumpTimer <= 0) {
      this.jumpTimer = Utils.randInt(90, 220);
      if (midPlatform && Math.random() < this.cfg.jump) control.jump = true;
    }
    if (dy < -70 && dist < reach + 60 && midPlatform && Math.random() < 0.06) control.jump = true;

    // ---- Spatial safety: never ring itself out --------------------------
    // Crossing gaps with ragdoll jumps is unreliable, so the AI parks at a
    // safe distance from any gap edge (a fixed hold point, NOT the very edge)
    // and lets the double-jumping player come to it. Parking with a dead-zone
    // avoids the edge oscillation that used to fling it into the void.
    const grounded = self.isGrounded();
    // Hard spatial leash (guarantee): while near a platform, forbid the body
    // from crossing a safe margin toward any gap. Uses platform proximity (via
    // footY) rather than the flickering grounded flag, so it stays active during
    // the micro-airborne frames at an edge. The stickman enforces it (and drops
    // it during stun so the player can still ring-out the CPU).
    {
      const plat0 = this._standingPlatform(self.pelvis.x, footY);
      if (plat0) {
        const M = 32;
        self.leashMin = (!this._groundAt(plat0.x - 30, footY) || this._dangerAt(plat0.x - 30, footY)) ? plat0.x + M : -Infinity;
        self.leashMax = (!this._groundAt(plat0.x + plat0.w + 30, footY) || this._dangerAt(plat0.x + plat0.w + 30, footY)) ? plat0.x + plat0.w - M : Infinity;
      } else {
        self.leashMin = -Infinity; self.leashMax = Infinity;
      }
    }

    if (grounded) {
      const plat = this._standingPlatform(self.pelvis.x, footY);
      if (plat) {
        const MARGIN = 70, SLOW = 170;
        const leftGap = !this._groundAt(plat.x - 30, footY) || this._dangerAt(plat.x - 30, footY);
        const rightGap = !this._groundAt(plat.x + plat.w + 30, footY) || this._dangerAt(plat.x + plat.w + 30, footY);
        const safeMin = leftGap ? plat.x + MARGIN : -1e9;
        const safeMax = rightGap ? plat.x + plat.w - MARGIN : 1e9;
        // Decelerate smoothly as we near a gap edge so we arrive with ~no
        // momentum and never overshoot into the void.
        if (control.move < 0) {
          const room = self.pelvis.x - safeMin;            // distance we may still move left
          if (room < SLOW) { control.move = room <= 2 ? 0 : -Math.max(0.12, room / SLOW); control.jump = false; }
          if (self.pelvis.x < safeMin) control.move = 0.5; // gently recover if pushed past
        }
        if (control.move > 0) {
          const room = safeMax - self.pelvis.x;
          if (room < SLOW) { control.move = room <= 2 ? 0 : Math.max(0.12, room / SLOW); control.jump = false; }
          if (self.pelvis.x > safeMax) control.move = -0.5;
        }
      }
    } else if (!this._groundBelow(self.pelvis.x, self.pelvis.y)) {
      // Airborne over a void → steer back toward the nearest safe ground.
      const gx = this._nearestGroundX(self.pelvis.x, self.pelvis.y);
      if (gx != null) control.move = Math.sign(gx - self.pelvis.x);
      control.jump = false; control.dash = false;
    }

    self.setControl(control);
  }
}
