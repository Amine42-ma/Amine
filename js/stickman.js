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
    this.isLocal = false;      // true for the human player on this device (for the tag)
    this.leashMin = -Infinity; // AI-only spatial guard to prevent self ring-out
    this.leashMax = Infinity;
    this.control = { move: 0, jump: false, attack: false, block: false, dash: false };
    this._lastGrounded = false;
    this._jumpLock = 0;
    this._jumpHeld = false;
    this.maxJumps = 2;         // ground jump + one air (double) jump
    this.jumpsLeft = 2;
    this.dashCooldown = 0;
    this.knockdownTimer = 0;   // brief stagger/recovery after a heavy hit
    this.special = 0;          // rage meter 0..1
    this.rageActive = false;
    this.rageTimer = 0;
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
    this.special = Utils.clamp(this.special + dealt * 0.008, 0, 1); // build meter when hurt
    if (dealt > 6 && !this.rageActive) this.stun = Math.min(30, Math.round(dealt * 1.6));
    // Heavy unblocked hits make the fighter stagger — balance goes floppy for a
    // moment so it dips/reels and rights itself gradually (not an instant snap).
    if (!this.blocking && dealt > 9 && !this.rageActive) {
      this.knockdownTimer = Math.min(42, 16 + Math.round(dealt));
    }
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
        if (this.rageActive) dmg *= 1.6;               // rage boosts damage
        const dirX = w.dx, dirY = w.dy;
        const dealt = opponent.takeHit(dmg, dirX, dirY, power * (this.rageActive ? 1.3 : 1), this);
        if (dealt > 0) {
          this.special = Utils.clamp(this.special + dealt * 0.011, 0, 1); // build meter on hits dealt
          if (this.fx) {
            this.fx.damageText(seg.qx, seg.qy - 10, dealt,
              opponent.blocking ? '#8ce0ff' : (this.rageActive ? '#ff5a6e' : '#ffe36e'));
            if (!cont) this.fx.sparks(seg.qx, seg.qy, this.rageActive ? 12 : 6);
          }
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
    if (this.dashCooldown > 0) this.dashCooldown--;
    if (this.knockdownTimer > 0) this.knockdownTimer--;
    for (const [k, v] of this._hitParticles) {
      if (v < 999) { const nv = v - 1; if (nv <= 0) this._hitParticles.delete(k); else this._hitParticles.set(k, nv); }
    }

    // Rage / special meter
    if (this.rageActive) {
      this.rageTimer--;
      if (this.rageTimer <= 0) { this.rageActive = false; this.special = 0; }
    } else if (this.special >= 1) {
      // auto-activate rage mode when the meter fills — a comeback boost
      this.rageActive = true;
      this.rageTimer = 300; // ~5s
      if (this.audio) this.audio.win();
      if (this.fx) { this.fx.shock(this.centerX, this.centerY, this.color); this.fx.sparks(this.centerX, this.centerY, 16); }
    }

    if (!this.alive) { this.updateDead(); return; }

    // Face the opponent automatically — with hysteresis so the weapon arm
    // doesn't flip (and jitter) when the two fighters are close together.
    if (opponent && opponent.alive) {
      const dx = opponent.centerX - this.centerX;
      if (Math.abs(dx) > 30) this.facing = Math.sign(dx);
    }

    const canAct = this.stun <= 0;
    this.blocking = canAct && this.control.block && this.isGrounded();

    // Movement — force based so the whole body (incl. feet) moves together.
    const grounded = this.isGrounded();
    const rageMul = this.rageActive ? 1.3 : 1;
    const moveInput = canAct && !this.blocking ? this.control.move : 0;
    this._moveInput = moveInput;
    const speed = (grounded ? 0.55 : 0.3) * rageMul;
    if (moveInput !== 0) {
      // Snappy reversal: cancel opposing momentum instantly so turning around
      // feels tight rather than slippery.
      if (grounded) {
        for (const p of [this.pelvis, this.chest]) {
          const vx = p.x - p.px;
          if (Math.sign(vx) === -Math.sign(moveInput) && Math.abs(vx) > 0.4) p.px = p.x;
        }
      }
      const push = moveInput * speed;
      this.pelvis.applyForce(push * 7, 0);
      this.chest.applyForce(push * 3, 0);
      this.footA.applyForce(push * 3, 0);
      this.footB.applyForce(push * 3, 0);
      // Cap horizontal cruise speed so movement stays controllable
      const maxV = 4.6 * rageMul;
      for (const p of [this.pelvis, this.chest, this.footA, this.footB]) {
        const vx = p.x - p.px;
        if (Math.abs(vx) > maxV) p.px = p.x - Math.sign(vx) * maxV;
      }
      this._anchorX = null;
    } else if (grounded && canAct && !this.rageActive) {
      // Idle position anchor: cancels ANY self-drift (arm pull, leg bias, …)
      // by gently pulling the body back to where it stopped, without adding
      // velocity, plus a strong horizontal-velocity damp.
      if (this._anchorX == null) this._anchorX = this.pelvis.x;
      const corr = (this._anchorX - this.pelvis.x) * 0.2;
      this.pelvis.x += corr; this.pelvis.px += corr;
      const vx = this.pelvis.x - this.pelvis.px;
      this.pelvis.px = this.pelvis.x - vx * 0.5;
    } else {
      this._anchorX = null;
    }

    // Reset jumps once actually settled on the ground
    if (grounded && this._jumpLock <= 0) this.jumpsLeft = this.maxJumps;

    // Jump — rising edge, with double jump in the air
    const jumpPressed = canAct && this.control.jump && !this._jumpHeld;
    if (jumpPressed && this.jumpsLeft > 0 && this._jumpLock <= 0) {
      const airJump = !grounded && this.jumpsLeft < this.maxJumps;
      const j = airJump ? -12 : -12.8;
      this.pelvis.applyImpulse(0, j);
      this.chest.applyImpulse(0, j * 0.7);
      this.footA.applyImpulse(0, j * 0.3);
      this.footB.applyImpulse(0, j * 0.3);
      this.jumpsLeft--;
      this._jumpLock = 10;
      if (this.audio) this.audio.jump();
      if (this.fx) {
        this.fx.dust(this.pelvis.x, this.footA.y + 6, 0, 6);
        if (airJump) this.fx.shock(this.pelvis.x, this.footA.y + 10, '#ffffff');
      }
    }
    this._jumpHeld = this.control.jump;

    // Dash — quick horizontal burst
    if (canAct && this.control.dash && this.dashCooldown <= 0) {
      const dir = moveInput !== 0 ? Math.sign(moveInput) : this.facing;
      const power = 20 * (this.rageActive ? 1.2 : 1);
      this.pelvis.applyImpulse(dir * power, -2);
      this.chest.applyImpulse(dir * power * 0.8, -1);
      this.footA.applyImpulse(dir * power * 0.6, 0);
      this.footB.applyImpulse(dir * power * 0.6, 0);
      this.dashCooldown = 42;
      this.facing = dir;
      if (this.audio) this.audio.swing();
      if (this.fx) {
        this.fx.dust(this.pelvis.x - dir * 12, this.pelvis.y + 20, dir > 0 ? Math.PI : 0, 8);
        this.fx.shock(this.centerX, this.centerY, this.color);
      }
      this.control.dash = false;
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
    // Safety damp: kill any residual horizontal drift of the feet when idle
    if (grounded && moveInput === 0 && canAct) {
      for (const p of [this.footA, this.footB]) {
        const vx = p.x - p.px; p.px = p.x - vx * 0.4;
      }
    }
    // Spatial leash (AI): hard-clamp the core AND feet to a safe x-range so the
    // CPU can never walk itself off a ledge — even during the micro-airborne
    // frames near an edge. Based on platform proximity (set by the AI), not the
    // flickering grounded flag. Dropped during stun so the player can still
    // knock it out of the ring.
    if (this.stun <= 0 && (this.leashMin > -Infinity || this.leashMax < Infinity)) {
      const clamp = (p) => {
        if (p.x < this.leashMin) { const d = this.leashMin - p.x; p.x += d; p.px += d; if (p.x - p.px < 0) p.px = p.x; }
        else if (p.x > this.leashMax) { const d = this.leashMax - p.x; p.x += d; p.px += d; if (p.x - p.px > 0) p.px = p.x; }
      };
      clamp(this.pelvis); clamp(this.chest); clamp(this.footA); clamp(this.footB);
    }
    this.clampVelocities();
  }

  updateDead() {
    this.deathTimer++;
    // no active control — the ragdoll just falls with gravity/constraints
    this.clampVelocities();
  }

  /** Active balance: keep the torso upright above the pelvis */
  balance(grounded) {
    // gentler correction so the fighter rises and rights itself gradually
    // instead of snapping upright the instant it touches down; while staggered
    // from a heavy hit the correction is weaker still, so it reels and recovers.
    const stagger = this.knockdownTimer > 0 ? 0.35 : 1;
    const strength = (grounded ? 0.1 : 0.045) * stagger;
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

  /** Drive the weapon arm (front) for idle guard and attack swing.
   *  The elbow and hand are placed at their EXACT rest lengths from the chest
   *  along the aim direction, so the arm constraints stay satisfied and never
   *  pull the torso sideways (this is what previously made the body drift). */
  poseArms() {
    const chest = this.chest;
    const f = this.facing;
    const l1 = this.armLenA1, l2 = this.armLenA2;

    // ----- Front (weapon) arm -----
    let aim;
    if (this.attackTimer > 0) {
      const t = 1 - this.attackTimer / this.attackDuration; // 0..1 through swing
      if (this.attackDir >= 0) aim = Utils.lerp(-2.3, 0.6, t);   // overhead chop
      else aim = Utils.lerp(1.4, -1.2, t);                       // uppercut
      this.attackTimer--;
    } else if (this.blocking) {
      aim = -0.55; // hold weapon up defensively
    } else {
      aim = -0.15 + Math.sin(performance.now() * 0.0035 + this.id) * 0.06; // relaxed guard
    }
    const dir = f >= 0 ? aim : Math.PI - aim;
    const ex = chest.x + Math.cos(dir) * l1;
    const ey = chest.y + Math.sin(dir) * l1;
    const hx = ex + Math.cos(dir) * l2;
    const hy = ey + Math.sin(dir) * l2;
    const k = this.attackTimer > 0 ? 0.85 : 0.5;
    const hand = this.frontHand, elbow = this.frontElbow;
    elbow.x += (ex - elbow.x) * k; elbow.y += (ey - elbow.y) * k;
    hand.x += (hx - hand.x) * k; hand.y += (hy - hand.y) * k;

    // ----- Back arm: relaxed guard pose (also at rest length) -----
    const bDir = f >= 0 ? Math.PI - 0.5 : 0.5;
    const bh = this.backHand, be = this.backElbow;
    const bex = chest.x + Math.cos(bDir) * l1;
    const bey = chest.y + Math.sin(bDir) * l1 + 6;
    be.x += (bex - be.x) * 0.35; be.y += (bey - be.y) * 0.35;
    bh.x += ((bex + Math.cos(bDir) * l2) - bh.x) * 0.35;
    bh.y += ((bey + Math.sin(bDir) * l2) - bh.y) * 0.35;
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

    const stance = 10;                     // tighter stance → less splayed, more planted
    const phase = performance.now() * 0.014;
    const moving = moveInput !== 0;
    const walk = moving ? Math.sin(phase) * 8 : 0;
    const lift = moving ? Math.max(0, -Math.cos(phase)) * 8 : 0;

    // Hold the pelvis at standing height above the lowest foot.
    // Shift BOTH y and py so we reposition without injecting upward velocity —
    // otherwise the body micro-hops, loses ground contact and drifts.
    const footY = Math.max(this.footA.y, this.footB.y);
    const targetPelvisY = footY - this.standHeight;
    if (this.pelvis.y > targetPelvisY) {
      // rise gradually; even slower while staggered so the fighter dips first
      const rise = this.knockdownTimer > 0 ? 0.08 : 0.18;
      const corr = (targetPelvisY - this.pelvis.y) * rise;
      this.pelvis.y += corr;
      this.pelvis.py += corr;
    }

    const footTargetY = this.pelvis.y + this.standHeight;
    const kx = moving ? 0.3 : 0.18;   // feet keep up with the pelvis when walking
    // Foot A (front-ish) — steps forward on one half of the cycle
    const taX = this.pelvis.x + stance + walk;
    this.footA.x += (taX - this.footA.x) * kx;
    this.footA.y += (footTargetY - lift - this.footA.y) * 0.10;
    // Foot B — opposite phase
    const tbX = this.pelvis.x - stance - walk;
    this.footB.x += (tbX - this.footB.x) * kx;
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
    const limbW = 13;

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

    // rage aura when the special meter is charged/active
    if (this.rageActive || (this.special >= 1 && this.alive)) {
      const t = this.rageActive ? 1 : 0.6;
      ctx.save();
      ctx.shadowBlur = 26; ctx.shadowColor = this.color;
      ctx.globalAlpha = 0.35 + Math.sin(time * 0.3) * 0.1;
      ctx.strokeStyle = this.color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(this.centerX, this.centerY, 44 * t, 0, Utils.TAU); ctx.stroke();
      ctx.restore();
    }

    // hit-flash glow
    if (flash) { ctx.shadowBlur = 16; ctx.shadowColor = '#ffffff'; }

    // back arm (drawn first, behind body)
    this.limb(ctx, this.chest, this.backElbow, this.backHand, bodyColor, limbW - 2);

    // legs
    this.limb(ctx, this.pelvis, this.kneeB, this.footB, bodyColor, limbW);
    this.limb(ctx, this.pelvis, this.kneeA, this.footA, bodyColor, limbW);

    // torso
    this.bone(ctx, this.chest, this.pelvis, bodyColor, limbW + 3);
    // neck
    this.bone(ctx, this.head, this.chest, bodyColor, limbW - 1);

    // head
    this.drawHead(ctx, bodyColor);

    // front (weapon) arm + weapon
    this.limb(ctx, this.chest, this.frontElbow, this.frontHand, bodyColor, limbW);
    ctx.shadowBlur = 0;
    this.drawWeapon(ctx, time);

    ctx.restore();

    // player indicator floating above the head
    if (this.alive) this.drawIndicator(ctx, time);
  }

  /** A bobbing chevron above the head so it's clear which fighter is which.
   *  The local player's tag is brighter and labelled. */
  drawIndicator(ctx, time) {
    const bob = Math.sin(time * 0.12 + this.id) * 3;
    const x = this.head.x;
    const y = this.head.y - this.head.radius - 18 + bob;
    ctx.save();
    ctx.shadowBlur = 8; ctx.shadowColor = this.color;
    // downward chevron
    ctx.fillStyle = this.color;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 9, y - 6); ctx.lineTo(x + 9, y - 6); ctx.lineTo(x, y + 5);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    if (this.isLocal) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.font = '900 12px Arial';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3;
      ctx.strokeText('أنت', x, y - 10);
      ctx.fillText('أنت', x, y - 10);
    }
    ctx.restore();
  }

  /** Two-point limb (torso / neck) with outline, fill and centre sheen */
  bone(ctx, a, b, color, width) {
    ctx.strokeStyle = this.outline; ctx.lineWidth = width + 4;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = width * 0.34;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  /** Three-point limb (arm / leg) with outline, fill, sheen and a cap */
  limb(ctx, a, b, c, color, width) {
    const path = () => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.stroke(); };
    ctx.strokeStyle = this.outline; ctx.lineWidth = width + 5; path();
    ctx.strokeStyle = color; ctx.lineWidth = width; path();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = width * 0.32; path();
    // hand/foot cap with outline
    ctx.fillStyle = this.outline;
    ctx.beginPath(); ctx.arc(c.x, c.y, width * 0.5 + 1.5, 0, Utils.TAU); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(c.x, c.y, width * 0.5, 0, Utils.TAU); ctx.fill();
  }

  drawHead(ctx, color) {
    const h = this.head;
    const ang = Math.atan2(this.chest.y - h.y, this.chest.x - h.x) + Math.PI / 2;
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(ang);
    // head outline + fill + top sheen
    ctx.fillStyle = this.outline;
    ctx.beginPath(); ctx.arc(0, 0, h.radius + 2, 0, Utils.TAU); ctx.fill();
    const hg = ctx.createRadialGradient(-4, -5, 2, 0, 0, h.radius);
    hg.addColorStop(0, this._lighten(color)); hg.addColorStop(1, color);
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(0, 0, h.radius, 0, Utils.TAU); ctx.fill();

    const attacking = this.attackTimer > 0;
    const angry = attacking || this.rageActive;
    if (this.alive) {
      // Two human-like eyes sitting in the UPPER part of the head (not centred),
      // both looking toward the facing direction.
      const f = this.facing;
      const eyeY = -4.5;            // upper third of the head
      const shift = f * 2.2;        // bias the pair toward the way we're facing
      const pupilCol = this.rageActive ? '#e11d48' : '#141414';
      for (const ox of [-4.6, 4.4]) {
        const ex = ox + shift;
        // white
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(ex, eyeY, 3.5, 4.3, 0, 0, Utils.TAU); ctx.fill();
        // pupil looking toward facing
        ctx.fillStyle = pupilCol;
        ctx.beginPath(); ctx.arc(ex + f * 1.5, eyeY + 0.8, angry ? 2.2 : 1.9, 0, Utils.TAU); ctx.fill();
        // tiny catch-light
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.arc(ex + f * 1.0, eyeY - 0.4, 0.7, 0, Utils.TAU); ctx.fill();
      }
      // eyebrows: neutral when calm, angled down-in when attacking / raging
      ctx.strokeStyle = '#141414'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        const bx = side * 4.6 + shift;
        ctx.beginPath();
        if (angry) { ctx.moveTo(bx - side * 3.4, eyeY - 6.5); ctx.lineTo(bx + side * 2.6, eyeY - 4); }
        else { ctx.moveTo(bx - 3, eyeY - 7); ctx.lineTo(bx + 3, eyeY - 7.4); }
        ctx.stroke();
      }
      // mouth: small line, gritted when attacking
      ctx.strokeStyle = 'rgba(20,20,20,0.7)'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (angry) { ctx.moveTo(shift - 3, 7); ctx.lineTo(shift + 3, 7); ctx.moveTo(shift - 2, 5.5); ctx.lineTo(shift - 2, 8.5); ctx.moveTo(shift + 1, 5.5); ctx.lineTo(shift + 1, 8.5); }
      else { ctx.moveTo(shift - 2.5 + f, 7); ctx.lineTo(shift + 3.5 + f, 6.2); }
      ctx.stroke();
    } else {
      // X-eyes when knocked out
      ctx.strokeStyle = '#141414'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      for (const sx of [-4.5, 4.5]) {
        ctx.beginPath();
        ctx.moveTo(sx - 2.6, -6); ctx.lineTo(sx + 2.6, -1);
        ctx.moveTo(sx + 2.6, -6); ctx.lineTo(sx - 2.6, -1);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(20,20,20,0.6)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(0, 8, 2.5, Math.PI, Utils.TAU); ctx.stroke(); // sad mouth
    }
    ctx.restore();
  }

  _lighten(hex) {
    if (hex[0] !== '#') return hex;
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h, 16);
    const r = Math.min(255, ((n >> 16) & 255) + 60);
    const g = Math.min(255, ((n >> 8) & 255) + 60);
    const b = Math.min(255, (n & 255) + 60);
    return `rgb(${r},${g},${b})`;
  }

  drawWeapon(ctx, time) {
    if (!this.alive && this.deathTimer > 40) return; // dropped after a moment
    const hand = this.frontHand, elbow = this.frontElbow;
    const ang = Math.atan2(hand.y - elbow.y, hand.x - elbow.x);

    // coloured swing trail
    if (this.attackTimer > 0 && !this.weapon.continuous) {
      ctx.save();
      ctx.translate(hand.x, hand.y); ctx.rotate(ang);
      const r = this.weapon.reach;
      const grad = ctx.createLinearGradient(0, 0, r, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, this.weapon.trail || 'rgba(255,255,255,0.4)');
      ctx.strokeStyle = grad; ctx.lineWidth = r * 0.55; ctx.lineCap = 'round';
      ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.72, -0.75, 0.5); ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(hand.x, hand.y);
    ctx.rotate(ang);
    if (this.weapon.glow && (this.weapon.energy || this.attackTimer > 0)) {
      ctx.shadowBlur = this.weapon.energy ? 16 : 9;
      ctx.shadowColor = this.weapon.glow;
    } else {
      // dark drop shadow so the weapon reads clearly against any background
      ctx.shadowBlur = 5; ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowOffsetX = 1.5; ctx.shadowOffsetY = 2.5;
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
