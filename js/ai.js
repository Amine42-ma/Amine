/* =========================================================================
 * ai.js — Opponent AI controller
 * A simple but effective finite-state fighter AI: it closes distance,
 * spaces itself to weapon reach, attacks in bursts, retreats and blocks
 * when the player is attacking, and occasionally jumps. Difficulty scales
 * reaction time, aggression and block chance.
 * ========================================================================= */
'use strict';

class AIController {
  constructor(self, target, difficulty = 'normal') {
    this.self = self;
    this.target = target;
    this.setDifficulty(difficulty);
    this.decisionTimer = 0;
    this.state = 'approach';
    this.jumpTimer = Utils.randInt(60, 180);
    this.attackHold = 0;
    this.blockTimer = 0;
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
    const control = { move: 0, jump: false, attack: false, block: false };
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

    // Jump occasionally, or to chase a jumping/elevated target
    this.jumpTimer--;
    if (this.jumpTimer <= 0) {
      this.jumpTimer = Utils.randInt(70, 200);
      if (Math.random() < this.cfg.jump) control.jump = true;
    }
    if (dy < -70 && dist < reach + 60 && Math.random() < 0.06) control.jump = true;

    // Don't walk off ledges into the void hazard (very rough edge-avoidance)
    self.setControl(control);
  }
}
