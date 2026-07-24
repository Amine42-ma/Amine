/* =========================================================================
 * stickman.js — The ragdoll fighter
 * A Verlet-based stickman with an active balance controller (so it stands
 * and walks instead of collapsing), a driven weapon arm for attacking, hit
 * detection against the opponent, health, stun, block and death (limp
 * ragdoll). Rendered as a stylised stick figure with a held weapon.
 * ========================================================================= */
'use strict';

class Stickman {
  constructor(world, opts) {
    this.world = world;
    this.opts = opts;
    this.color = opts.color || '#2b6bff';
    this.outline = opts.outline || '#0e2f8a';
    this.name = opts.name || 'Fighter';
    this.facing = opts.facing || 1;
    this.weapon = getWeapon(opts.weaponId || 'sword');
    this.fx = opts.fx;         // particle system
    this.audio = opts.audio;
    this.id = opts.id || 0;

    this.maxHealth = 100;
    this.health = 100;
    this.alive = true;
    this.stun = 0;             // frames of lost control after heavy hit
    this.attackTimer = 0;      // >0 while an attack swing is active
    this.attackCooldown = 0;
    this.attackDir = 0;        // -1 up-swing / 1 down-swing alternation
    this.blocking = false;
    this.wantAttack = false;
    this.hitFlash = 0;
    this.control = { move: 0, jump: false, attack: false, block: false, down: false };
    this._lastGrounded = false;
    this._jumpLock = 0;
    this._hitParticles = new Map(); // opponent particle -> cooldown frames
    this.deathTimer = 0;

    this.build(opts.x, opts.y);
  }

  /* ----- Construction ----- */
  build(x, y) {
    const P = (px, py, r, m) => this.world.addParticle(new Particle(px, py, r, m));
    // Torso
    this.head = P(x, y - 92, 15, 1.2);
    this.chest = P(x, y - 54, 8, 1.4);
    this.pelvis = P(x, y - 12, 8, 1.6);
    // Arms (A = right side, B = left side)
    this.elbowA = P(x + 16, y - 40, 6, 0.6);
    this.handA = P(x + 26, y - 18, 7, 0.6);
    this.elbowB = P(x - 16, y - 40, 6, 0.6);
    this.handB = P(x - 26, y - 18, 7, 0.6);
    // Legs
    this.kneeA = P(x + 9, y + 16, 6, 0.8);
    this.footA = P(x + 11, y + 46, 7, 0.9);
    this.kneeB = P(x - 9, y + 16, 6, 0.8);
    this.footB = P(x - 11, y + 46, 7, 0.9);

    this.all = [this.head, this.chest, this.pelvis, this.elbowA, this.handA,
      this.elbowB, this.handB, this.kneeA, this.footA, this.kneeB, this.footB];

    const C = (a, b, stiff) => this.world.addConstraint(new Constraint(a, b, stiff));
    // Spine
    C(this.head, this.chest, 1);
    C(this.chest, this.pelvis, 1);
    this.spineBrace = C(this.head, this.pelvis, 0.6); // keeps torso rigid
    // Arms
    this.armLenA1 = C(this.chest, this.elbowA, 0.9).length;
    this.armLenA2 = C(this.elbowA, this.handA, 0.9).length;
    C(this.chest, this.elbowB, 0.9);
    C(this.elbowB, this.handB, 0.9);
    // Legs
    C(this.pelvis, this.kneeA, 1);
    C(this.kneeA, this.footA, 1);
    C(this.pelvis, this.kneeB, 1);
    C(this.kneeB, this.footB, 1);

    // Remember rest lengths for pose targets
    this.torsoLen = Utils.dist(this.chest.x, this.chest.y, this.pelvis.x, this.pelvis.y);
    this.neckLen = Utils.dist(this.head.x, this.head.y, this.chest.x, this.chest.y);
    this.legLen = 58;
    this.standHeight = 52;   // how high the pelvis is held above the feet when standing
    this.armReach = 44;

    // give the whole body a slight tag so hit-detection can skip self
    this.all.forEach((p) => (p.owner = this));
  }

  /* ----- Queries ----- */
  get x() { return this.pelvis.x; }
  get y() { return this.pelvis.y; }
  get centerX() { return (this.chest.x + this.pelvis.x) / 2; }
  get centerY() { return (this.chest.y + this.pelvis.y) / 2; }

  isGrounded() { return this.footA.onGround || this.footB.onGround; }

  /** Front / back hand depend on facing so the weapon is always held forward */
  get frontHand() { return this.facing >= 0 ? this.handA : this.handB; }
  get frontElbow() { return this.facing >= 0 ? this.elbowA : this.elbowB; }
  get backHand() { return this.facing >= 0 ? this.handB : this.handA; }
  get backElbow() { return this.facing >= 0 ? this.elbowB : this.elbowA; }

  setControl(c) { this.control = Object.assign(this.control, c); }

  /* ----- Combat ----- */
  attack() {
    if (!this.alive || this.attackCooldown > 0 || this.stun > 0) return;
    const spd = this.weapon.speed;
    this.attackTimer = Math.round(20 / spd);
    this.attackDuration = this.attackTimer;
    this.attackCooldown = Math.round((this.weapon.fast ? 14 : 26) / spd);
    this.attackDir *= -1; // alternate overhead / uppercut for variety
    if (this.audio) this.audio.swing();
    this._hitParticles.clear();
  }

  takeHit(dmg, dirX, dirY, power, attacker) {
    if (!this.alive) return 0;
    let dealt = dmg;
    // Blocking reduces damage & knockback when facing the attacker
    if (this.blocking && (attacker ? Math.sign(attacker.x - this.x) === this.facing : true)) {
      dealt *= 0.22;
      if (this.audio) this.audio.clang();
      if (this.fx) this.fx.sparks(this.frontHand.x, this.frontHand.y, 8);
    } else {
      if (this.audio) this.audio.hit(power);
      if (this.fx) {
        this.fx.blood(this.centerX, this.centerY, Math.atan2(dirY, dirX), 10 + power * 6, this.color);
        this.fx.shock(this.centerX, this.centerY, '#fff');
      }
    }
    this.health = Utils.clamp(this.health - dealt, 0, this.maxHealth);
    this.hitFlash = 8;
    if (dealt > 6) this.stun = Math.min(30, Math.round(dealt * 1.6));
    // knockback
    const kb = power * (this.blocking ? 3 : 9) + dealt * 0.4;
    const impulse = (p, s) => p.applyImpulse(-dirX * kb * s, -dirY * kb * s - kb * 0.15 * s);
    impulse(this.chest, 1); impulse(this.pelvis, 0.8); impulse(this.head, 0.6);
    if (this.health <= 0) this.die();
    return dealt;
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.deathTimer = 1;
    this.control.move = 0;
    if (this.audio) this.audio.death();
    if (this.fx) {
      this.fx.blood(this.centerX, this.centerY, -Math.PI / 2, 30, this.color);
      this.fx.shock(this.centerX, this.centerY, this.color);
    }
    // go limp: relax spine brace so the body folds naturally
    this.spineBrace.stiffness = 0.05;
  }

  fallOut() {
    // fell into the void / off stage
    if (!this.alive) return;
    this.health = 0;
    this.die();
  }

  /* ----- Weapon geometry for hit detection & drawing ----- */
  getWeaponSegment() {
    const hand = this.frontHand;
    const elbow = this.frontElbow;
    // weapon points along the forearm direction
    let dx = hand.x - elbow.x, dy = hand.y - elbow.y;
    let len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const reach = this.weapon.reach;
    const tipX = hand.x + dx * reach;
    const tipY = hand.y + dy * reach;
    const bladeStartT = this.weapon.bladeFrom;
    const bsX = hand.x + dx * reach * bladeStartT;
    const bsY = hand.y + dy * reach * bladeStartT;
    const speed = Math.hypot(hand.vx, hand.vy);
    return { gripX: hand.x, gripY: hand.y, dx, dy, tipX, tipY, bsX, bsY, speed, len: reach };
  }

  /** All limb segments of THIS fighter (used as targets for opponent's weapon) */
  limbSegments() {
    return [
      [this.head, this.chest], [this.chest, this.pelvis],
      [this.chest, this.frontElbow], [this.frontElbow, this.frontHand],
      [this.chest, this.backElbow], [this.backElbow, this.backHand],
      [this.pelvis, this.kneeA], [this.kneeA, this.footA],
      [this.pelvis, this.kneeB], [this.kneeB, this.footB],
    ];
  }

  /** Resolve weapon hits against an opponent. Called by the game each frame. */
  resolveHitsOn(opponent) {
    if (!this.alive || this.attackTimer <= 0) return;
    const w = this.getWeaponSegment();
    const cont = this.weapon.continuous;
    const minSpeed = cont ? 0.5 : 3.2;
    if (w.speed < minSpeed && !cont) return;

    for (const [a, b] of opponent.limbSegments()) {
      const seg = Utils.segmentToSegment(w.bsX, w.bsY, w.tipX, w.tipY, a.x, a.y, b.x, b.y);
      const threshold = 14;
      if (seg.dist < threshold) {
        // per-limb cooldown so a single swing doesn't multi-hit each frame
        const key = a;
        const cd = this._hitParticles.get(key) || 0;
        if (cd > 0) continue;
        const power = cont
          ? 0.6 + w.speed * 0.05
          : Utils.clamp(w.speed / 9, 0.5, 2.2);
        let dmg = this.weapon.damage * (cont ? (this.weapon.dps || 0.9) : (0.7 + power * 0.6));
        const dirX = w.dx, dirY = w.dy;
        const dealt = opponent.takeHit(dmg, dirX, dirY, power, this);
        if (dealt > 0 && this.fx) {
          this.fx.damageText(seg.qx, seg.qy - 10, dealt,
            opponent.blocking ? '#8ce0ff' : '#ffe36e');
          if (!cont) this.fx.sparks(seg.qx, seg.qy, 6);
        }
        this._hitParticles.set(key, cont ? 8 : 999); // one hit per swing (or ticking for chainsaw)
        if (!cont) break; // one target per swing for non-continuous
      }
    }
  }

  /* ----- Per-frame control & balance ----- */
  update(opponent) {
    // tick timers
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.stun > 0) this.stun--;
    if (this.hitFlash > 0) this.hitFlash--;
    if (this._jumpLock > 0) this._jumpLock--;
    for (const [k, v] of this._hitParticles) {
      if (v < 999) { const nv = v - 1; if (nv <= 0) this._hitParticles.delete(k); else this._hitParticles.set(k, nv); }
    }

    if (!this.alive) { this.updateDead(); return; }

    // Face the opponent automatically
    if (opponent && opponent.alive) {
      const dir = Math.sign(opponent.centerX - this.centerX) || this.facing;
      this.facing = dir;
    }

    const canAct = this.stun <= 0;
    this.blocking = canAct && this.control.block && this.isGrounded();

    // Movement
    const grounded = this.isGrounded();
    const moveInput = canAct && !this.blocking ? this.control.move : 0;
    const speed = grounded ? 0.9 : 0.42;
    if (moveInput !== 0) {
      const push = moveInput * speed;
      this.pelvis.applyForce(push * 6, 0);
      this.chest.applyForce(push * 3, 0);
      // step legs
      this.footA.applyForce(push * 3, 0);
      this.footB.applyForce(push * 3, 0);
    }

    // Jump
    if (canAct && this.control.jump && grounded && this._jumpLock <= 0) {
      const j = -12.5;
      this.pelvis.applyImpulse(0, j);
      this.chest.applyImpulse(0, j * 0.7);
      this.footA.applyImpulse(0, j * 0.3);
      this.footB.applyImpulse(0, j * 0.3);
      this._jumpLock = 18;
      if (this.audio) this.audio.jump();
      if (this.fx) this.fx.dust(this.pelvis.x, this.footA.y + 6, 0, 6);
    }

    // Landing dust / sfx
    if (grounded && !this._lastGrounded) {
      if (this.audio) this.audio.land();
      if (this.fx) this.fx.dust(this.pelvis.x, Math.max(this.footA.y, this.footB.y) + 4, 0, 5);
    }
    this._lastGrounded = grounded;

    // Attack trigger (edge handled by game via wantAttack)
    if (canAct && this.control.attack && !this.blocking) {
      this.attack();
      this.control.attack = false; // consume; game re-sets on hold if desired
    }

    this.balance(grounded);
    this.poseArms();
    this.poseLegs(moveInput, grounded);
    this.clampVelocities();
  }

  updateDead() {
    this.deathTimer++;
    // no active control — the ragdoll just falls with gravity/constraints
    this.clampVelocities();
  }

  /** Active balance: keep the torso upright above the pelvis */
  balance(grounded) {
    const strength = grounded ? 0.16 : 0.06;
    // rotate chest & head around pelvis toward vertical
    const cur = Math.atan2(this.chest.y - this.pelvis.y, this.chest.x - this.pelvis.x);
    const target = -Math.PI / 2; // straight up
    let err = Utils.angleDiff(cur, target);
    rotateAround(this.chest, this.pelvis, err * strength);
    rotateAround(this.head, this.pelvis, err * strength * 0.9);
    // gentle lift so the body doesn't sag when standing
    if (grounded) {
      this.chest.applyForce(0, -this.world.gravity * this.chest.mass * 0.6);
      this.head.applyForce(0, -this.world.gravity * this.head.mass * 0.6);
    }
  }

  /** Drive the weapon arm (front) for idle guard and attack swing */
  poseArms() {
    const chest = this.chest;
    const f = this.facing;

    // ----- Front (weapon) arm -----
    let aim;
    if (this.attackTimer > 0) {
      const t = 1 - this.attackTimer / this.attackDuration; // 0..1 through swing
      // Overhead chop or uppercut depending on attackDir
      if (this.attackDir >= 0) {
        aim = Utils.lerp(-2.4, 0.5, t); // from raised-back to down-forward
      } else {
        aim = Utils.lerp(1.4, -1.2, t); // uppercut
      }
      this.attackTimer--;
    } else if (this.blocking) {
      aim = -0.3; // hold weapon up defensively
    } else {
      aim = -0.35 + Math.sin(performance.now() * 0.004 + this.id) * 0.08; // idle sway
    }
    const worldAim = f >= 0 ? aim : Math.PI - aim;
    const reach = this.armReach;
    const tHandX = chest.x + Math.cos(worldAim) * reach;
    const tHandY = chest.y + Math.sin(worldAim) * reach + 6;
    const tElbowX = chest.x + Math.cos(worldAim) * reach * 0.5;
    const tElbowY = chest.y + Math.sin(worldAim) * reach * 0.5 + 4;
    const k = this.attackTimer > 0 ? 0.55 : 0.28;
    const hand = this.frontHand, elbow = this.frontElbow;
    hand.x += (tHandX - hand.x) * k; hand.y += (tHandY - hand.y) * k;
    elbow.x += (tElbowX - elbow.x) * k * 0.8; elbow.y += (tElbowY - elbow.y) * k * 0.8;

    // ----- Back arm: relaxed guard pose -----
    const bAim = f >= 0 ? Math.PI - 0.6 : 0.6;
    const bh = this.backHand, be = this.backElbow;
    const bhx = chest.x + Math.cos(bAim) * reach * 0.9;
    const bhy = chest.y + Math.sin(bAim) * reach * 0.9 + 12;
    bh.x += (bhx - bh.x) * 0.12; bh.y += (bhy - bh.y) * 0.12;
    be.x += ((chest.x + Math.cos(bAim) * reach * 0.5) - be.x) * 0.1;
    be.y += ((chest.y + Math.sin(bAim) * reach * 0.5 + 6) - be.y) * 0.1;
  }

  /** Active standing / walking controller: holds the pelvis up over the feet
   *  (so the knees don't buckle) and drives a simple two-step walk cycle. */
  poseLegs(moveInput, grounded) {
    if (!grounded) {
      // In the air: tuck legs toward the pelvis so they don't dangle awkwardly
      const tuck = (foot, side) => {
        foot.x += (this.pelvis.x + side * 8 - foot.x) * 0.06;
        foot.y += (this.pelvis.y + 30 - foot.y) * 0.06;
      };
      tuck(this.footA, 1); tuck(this.footB, -1);
      return;
    }

    const stance = 13;
    const phase = performance.now() * 0.013;
    const moving = moveInput !== 0;
    const walk = moving ? Math.sin(phase) * 11 : 0;
    const lift = moving ? Math.max(0, -Math.cos(phase)) * 10 : 0;

    // Hold the pelvis at standing height above the lowest foot
    const footY = Math.max(this.footA.y, this.footB.y);
    const targetPelvisY = footY - this.standHeight;
    if (this.pelvis.y > targetPelvisY) {
      this.pelvis.y += (targetPelvisY - this.pelvis.y) * 0.28;
    }

    const footTargetY = this.pelvis.y + this.standHeight;
    // Foot A (front-ish) — steps forward on one half of the cycle
    const taX = this.pelvis.x + stance + walk;
    this.footA.x += (taX - this.footA.x) * 0.14;
    this.footA.y += (footTargetY - lift - this.footA.y) * 0.10;
    // Foot B — opposite phase
    const tbX = this.pelvis.x - stance - walk;
    this.footB.x += (tbX - this.footB.x) * 0.14;
    this.footB.y += (footTargetY - (moving ? Math.max(0, Math.cos(phase)) * 10 : 0) - this.footB.y) * 0.10;

    // Keep knees between pelvis and feet, bent slightly toward facing
    const bendKnee = (knee, foot, side) => {
      const mx = (this.pelvis.x + foot.x) / 2 + this.facing * 5 + side * 3;
      const my = (this.pelvis.y + foot.y) / 2 + 3;
      knee.x += (mx - knee.x) * 0.3;
      knee.y += (my - knee.y) * 0.3;
    };
    bendKnee(this.kneeA, this.footA, 1);
    bendKnee(this.kneeB, this.footB, -1);
  }

  clampVelocities() {
    const max = 24;
    for (const p of this.all) {
      let vx = p.x - p.px, vy = p.y - p.py;
      const s = Math.hypot(vx, vy);
      if (s > max) {
        vx = (vx / s) * max; vy = (vy / s) * max;
        p.px = p.x - vx; p.py = p.y - vy;
      }
    }
  }

  /* ----- Rendering ----- */
  render(ctx, time) {
    const flash = this.hitFlash > 0 && this.hitFlash % 2 === 0;
    const bodyColor = flash ? '#ffffff' : this.color;
    const limbW = 12;

    // shadow
    const groundY = Math.max(this.footA.y, this.footB.y) + 8;
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(this.pelvis.x, groundY, 34, 8, 0, 0, Utils.TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // back arm (drawn first, behind body)
    this.limb(ctx, this.chest, this.backElbow, this.backHand, bodyColor, limbW - 2);

    // legs
    this.limb(ctx, this.pelvis, this.kneeB, this.footB, bodyColor, limbW);
    this.limb(ctx, this.pelvis, this.kneeA, this.footA, bodyColor, limbW);

    // torso
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = limbW + 3;
    ctx.beginPath();
    ctx.moveTo(this.chest.x, this.chest.y);
    ctx.lineTo(this.pelvis.x, this.pelvis.y);
    ctx.stroke();

    // neck
    ctx.lineWidth = limbW - 1;
    ctx.beginPath();
    ctx.moveTo(this.head.x, this.head.y);
    ctx.lineTo(this.chest.x, this.chest.y);
    ctx.stroke();

    // head
    this.drawHead(ctx, bodyColor);

    // front (weapon) arm + weapon
    this.limb(ctx, this.chest, this.frontElbow, this.frontHand, bodyColor, limbW);
    this.drawWeapon(ctx, time);

    ctx.restore();
  }

  limb(ctx, a, b, c, color, width) {
    // outline
    ctx.strokeStyle = this.outline;
    ctx.lineWidth = width + 4;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y);
    ctx.stroke();
    // fill
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y);
    ctx.stroke();
    // hand/foot cap
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(c.x, c.y, width * 0.5, 0, Utils.TAU); ctx.fill();
  }

  drawHead(ctx, color) {
    const h = this.head;
    const ang = Math.atan2(this.chest.y - h.y, this.chest.x - h.x) + Math.PI / 2;
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(ang);
    // head outline + fill
    ctx.fillStyle = this.outline;
    ctx.beginPath(); ctx.arc(0, 0, h.radius + 2, 0, Utils.TAU); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(0, 0, h.radius, 0, Utils.TAU); ctx.fill();
    // eyes (looking toward facing)
    if (this.alive) {
      const ex = this.facing * 4;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ex, -2, 3.4, 0, Utils.TAU); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(ex + this.facing * 1.2, -2, 1.7, 0, Utils.TAU); ctx.fill();
    } else {
      // X eyes when dead
      ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
      for (const sx of [-4, 4]) {
        ctx.beginPath();
        ctx.moveTo(sx - 2.5, -4); ctx.lineTo(sx + 2.5, 0);
        ctx.moveTo(sx + 2.5, -4); ctx.lineTo(sx - 2.5, 0);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawWeapon(ctx, time) {
    if (!this.alive && this.deathTimer > 40) return; // dropped after a moment
    const hand = this.frontHand, elbow = this.frontElbow;
    const ang = Math.atan2(hand.y - elbow.y, hand.x - elbow.x);
    ctx.save();
    ctx.translate(hand.x, hand.y);
    ctx.rotate(ang);
    // swing trail
    if (this.attackTimer > 0 && !this.weapon.continuous) {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = this.weapon.color || '#fff';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 0, this.weapon.reach * 0.8, -0.6, 0.6);
      ctx.stroke();
      ctx.restore();
    }
    this.weapon.draw(ctx, this.weapon.reach, 8, this.attackTimer > 0, time * 0.06);
    ctx.restore();
  }

  /** Debug helper (not used in normal play) */
  drawDebug(ctx) {
    ctx.fillStyle = 'rgba(255,255,0,0.6)';
    for (const p of this.all) {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Utils.TAU); ctx.fill();
    }
  }
}
