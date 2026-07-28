'use strict';
/**
 * ============================================================================
 *  Dino Royale Evolution - SHARED CHARACTER PHYSICS
 * ============================================================================
 *  One implementation, two callers:
 *    - the server runs it as the authority for every player every tick
 *    - the client runs it to predict the local player, then reconciles
 *
 *  Because both sides execute identical float math on identical inputs, a
 *  correctly-predicted frame reconciles to zero error and the player never
 *  sees a rubber-band.
 *
 *  Movement features: walk / run / sprint / crouch / prone / slide / jump /
 *  coyote-time / jump buffering / step-up / vault / mantle / ladder + vine
 *  climbing / swimming / diving / buoyancy / stamina / oxygen / lean /
 *  fall damage / ice friction / parachute descent.
 * ============================================================================
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./protocol.js'), require('./worldgen.js'));
  } else {
    root.Movement = factory(root.Protocol, root.WorldGen);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Protocol, WorldGen) {
  const { PHYS, IN, MOVE } = Protocol;
  const { B, isSolid, isLiquid, isClimbable, FLAGS, F } = WorldGen;

  const EPS = 1e-4;

  /** Fresh authoritative character state. */
  function createState(x, y, z, yaw = 0) {
    return {
      x,
      y,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw,
      pitch: 0,
      onGround: false,
      inWater: false,
      submerged: false,
      feetInLava: false,
      crouching: false,
      prone: false,
      sliding: false,
      slideTime: 0,
      slideCooldown: 0,
      climbing: false,
      vaulting: false,
      vaultTime: 0,
      vaultFrom: null,
      vaultTo: null,
      parachute: false,
      lean: 0,
      stamina: PHYS.MAX_STAMINA,
      oxygen: PHYS.OXYGEN_MAX,
      hasRebreather: false,
      hasClaws: false,
      height: PHYS.PLAYER_HEIGHT,
      eye: PHYS.EYE_HEIGHT,
      moveState: MOVE.IDLE,
      fallStartY: y,
      falling: false,
      jumpBuffer: 0,
      coyote: 0,
      landImpact: 0,
      stepSmooth: 0,
      speedMult: 1,
      lastFallDamage: 0,
      distanceMoved: 0,
      bobPhase: 0,
      alive: true,
      downed: false,
    };
  }

  function createInput() {
    return { seq: 0, dt: 1 / 30, keys: 0, yaw: 0, pitch: 0 };
  }

  // ---------------------------------------------------------------------------
  // Voxel helpers - `q(x,y,z)` returns a block id.
  // ---------------------------------------------------------------------------
  function solidAt(q, x, y, z) {
    const id = q(Math.floor(x), Math.floor(y), Math.floor(z));
    return isSolid(id) && !isLiquid(id);
  }

  function liquidAt(q, x, y, z) {
    return isLiquid(q(Math.floor(x), Math.floor(y), Math.floor(z)));
  }

  function blockAt(q, x, y, z) {
    return q(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  /** Any solid voxel overlapping the capsule AABB at (x,y,z)? */
  function collides(q, x, y, z, height, radius) {
    const r = radius;
    const x0 = Math.floor(x - r);
    const x1 = Math.floor(x + r);
    const z0 = Math.floor(z - r);
    const z1 = Math.floor(z + r);
    const y0 = Math.floor(y + EPS);
    const y1 = Math.floor(y + height - EPS);
    for (let by = y0; by <= y1; by++) {
      for (let bz = z0; bz <= z1; bz++) {
        for (let bx = x0; bx <= x1; bx++) {
          const id = q(bx, by, bz);
          if (isSolid(id) && !isLiquid(id)) return true;
        }
      }
    }
    return false;
  }

  /** Fraction of the body submerged in liquid (0..1). */
  function submersion(q, x, y, z, height, radius) {
    let hits = 0;
    const samples = 5;
    for (let i = 0; i < samples; i++) {
      const sy = y + (height * i) / (samples - 1 || 1);
      if (liquidAt(q, x, sy, z)) hits++;
    }
    return hits / samples;
  }

  function isIce(q, x, y, z) {
    const id = q(Math.floor(x), Math.floor(y - 0.1), Math.floor(z));
    return id === B.ice || id === B.packed_ice;
  }

  /** Is there a climbable surface (ladder, vine, or - with claws - any wall)? */
  function climbSurface(q, s, radius) {
    const probes = [
      [radius + 0.22, 0],
      [-radius - 0.22, 0],
      [0, radius + 0.22],
      [0, -radius - 0.22],
    ];
    for (const [dx, dz] of probes) {
      for (const dy of [0.4, 1.1]) {
        const id = blockAt(q, s.x + dx, s.y + dy, s.z + dz);
        if (isClimbable(id)) return true;
        if (s.hasClaws && isSolid(id) && !isLiquid(id)) return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Swept AABB resolution, axis by axis, with automatic step-up.
  // ---------------------------------------------------------------------------
  function moveAxis(q, s, dx, dy, dz, height, radius) {
    let hitX = false;
    let hitY = false;
    let hitZ = false;

    // --- Y
    if (dy !== 0) {
      const ny = s.y + dy;
      if (collides(q, s.x, ny, s.z, height, radius)) {
        // Binary search to the contact point keeps the body flush with the
        // surface instead of leaving a visible gap.
        let lo = 0;
        let hi = dy;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          if (collides(q, s.x, s.y + mid, s.z, height, radius)) hi = mid;
          else lo = mid;
        }
        s.y += lo;
        hitY = true;
      } else {
        s.y = ny;
      }
    }

    // --- X
    if (dx !== 0) {
      const nx = s.x + dx;
      if (collides(q, nx, s.y, s.z, height, radius)) {
        // Try stepping up over a low obstacle (stairs, ledges, roots).
        const stepY = s.y + PHYS.STEP_HEIGHT;
        if (s.onGround && !collides(q, nx, stepY, s.z, height, radius) && !collides(q, s.x, stepY, s.z, height, radius)) {
          // Settle back down onto the step surface.
          let sy = stepY;
          for (let i = 0; i < 10; i++) {
            const test = sy - PHYS.STEP_HEIGHT / 10;
            if (collides(q, nx, test, s.z, height, radius)) break;
            sy = test;
          }
          s.stepSmooth += sy - s.y;
          s.y = sy;
          s.x = nx;
        } else {
          let lo = 0;
          let hi = dx;
          for (let i = 0; i < 12; i++) {
            const mid = (lo + hi) / 2;
            if (collides(q, s.x + mid, s.y, s.z, height, radius)) hi = mid;
            else lo = mid;
          }
          s.x += lo;
          hitX = true;
        }
      } else {
        s.x = nx;
      }
    }

    // --- Z
    if (dz !== 0) {
      const nz = s.z + dz;
      if (collides(q, s.x, s.y, nz, height, radius)) {
        const stepY = s.y + PHYS.STEP_HEIGHT;
        if (s.onGround && !collides(q, s.x, stepY, nz, height, radius) && !collides(q, s.x, stepY, s.z, height, radius)) {
          let sy = stepY;
          for (let i = 0; i < 10; i++) {
            const test = sy - PHYS.STEP_HEIGHT / 10;
            if (collides(q, s.x, test, nz, height, radius)) break;
            sy = test;
          }
          s.stepSmooth += sy - s.y;
          s.y = sy;
          s.z = nz;
        } else {
          let lo = 0;
          let hi = dz;
          for (let i = 0; i < 12; i++) {
            const mid = (lo + hi) / 2;
            if (collides(q, s.x, s.y, s.z + mid, height, radius)) hi = mid;
            else lo = mid;
          }
          s.z += lo;
          hitZ = true;
        }
      } else {
        s.z = nz;
      }
    }

    return { hitX, hitY, hitZ };
  }

  /**
   * Detects a vaultable ledge directly ahead: a waist-to-chest high obstacle
   * with clear space on top. Returns the landing point or null.
   */
  function findVault(q, s, radius, height) {
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    const reach = radius + 0.75;
    const tx = s.x + fx * reach;
    const tz = s.z + fz * reach;

    // The obstacle must be present at knee/waist height...
    let obstacleTop = -1;
    for (let h = 0.3; h <= PHYS.VAULT_HEIGHT + 0.35; h += 0.25) {
      if (solidAt(q, tx, s.y + h, tz)) obstacleTop = Math.max(obstacleTop, Math.floor(s.y + h) + 1);
    }
    if (obstacleTop < 0) return null;
    const rise = obstacleTop - s.y;
    if (rise < PHYS.STEP_HEIGHT || rise > PHYS.VAULT_HEIGHT + 0.4) return null;

    // ...and the destination must be clear for the full body.
    const landX = s.x + fx * (reach + 0.55);
    const landZ = s.z + fz * (reach + 0.55);
    if (collides(q, landX, obstacleTop + 0.05, landZ, height, radius)) return null;
    if (!solidAt(q, landX, obstacleTop - 0.5, landZ) && !solidAt(q, tx, obstacleTop - 0.5, tz)) return null;

    return { x: landX, y: obstacleTop + 0.02, z: landZ };
  }

  /**
   * Advance one player by one tick.
   *
   * @param {object} s      character state (mutated)
   * @param {object} input  {keys, yaw, pitch, dt}
   * @param {Function} q    (x,y,z) => blockId
   * @param {object} opts   {noclip, spectator, canMove, speedMult}
   * @returns {object} events produced this tick (landing, splash, vault, ...)
   */
  function step(s, input, q, opts = {}) {
    const dt = Math.max(0.001, Math.min(0.1, input.dt || 1 / 30));
    const keys = input.keys | 0;
    const events = { landed: 0, splash: false, vaulted: false, fallDamage: 0, footstep: false, drowning: 0, lavaDamage: 0 };

    s.yaw = input.yaw;
    s.pitch = input.pitch;

    if (!s.alive) {
      s.moveState = MOVE.DEAD;
      return events;
    }

    const wantFwd = (keys & IN.FWD) !== 0;
    const wantBack = (keys & IN.BACK) !== 0;
    const wantLeft = (keys & IN.LEFT) !== 0;
    const wantRight = (keys & IN.RIGHT) !== 0;
    const wantJump = (keys & IN.JUMP) !== 0;
    const wantSprint = (keys & IN.SPRINT) !== 0;
    const wantCrouch = (keys & IN.CROUCH) !== 0;
    const wantSlide = (keys & IN.SLIDE) !== 0;
    const wantProne = (keys & IN.PRONE) !== 0;
    const wantClimb = (keys & IN.CLIMB) !== 0;
    const wantSwimUp = (keys & IN.SWIM_UP) !== 0;
    const aiming = (keys & IN.AIM) !== 0;

    // -- lean ----------------------------------------------------------------
    const leanTarget = (keys & IN.LEAN_L ? -1 : 0) + (keys & IN.LEAN_R ? 1 : 0);
    s.lean += (leanTarget - s.lean) * Math.min(1, dt * 10);

    // -- posture -------------------------------------------------------------
    const radius = PHYS.PLAYER_RADIUS;
    const standHeight = PHYS.PLAYER_HEIGHT;
    const crouchHeight = PHYS.CROUCH_HEIGHT;
    const proneHeight = PHYS.PRONE_HEIGHT;

    let desiredHeight = standHeight;
    if (s.downed) desiredHeight = proneHeight;
    else if (wantProne) desiredHeight = proneHeight;
    else if (wantCrouch || s.sliding) desiredHeight = crouchHeight;

    // Cannot stand up under a ceiling.
    if (desiredHeight > s.height && collides(q, s.x, s.y, s.z, desiredHeight, radius)) {
      desiredHeight = s.height;
    }
    s.height += (desiredHeight - s.height) * Math.min(1, dt * 12);
    s.crouching = s.height < standHeight - 0.15;
    s.prone = s.height < crouchHeight - 0.15;

    const eyeTarget = s.prone ? PHYS.EYE_PRONE : s.crouching ? PHYS.EYE_CROUCH : PHYS.EYE_HEIGHT;
    s.eye += (eyeTarget - s.eye) * Math.min(1, dt * 12);

    // -- environment ---------------------------------------------------------
    const sub = submersion(q, s.x, s.y, s.z, s.height, radius);
    const wasInWater = s.inWater;
    s.inWater = sub > 0.15;
    s.submerged = sub > 0.85;
    const headBlock = blockAt(q, s.x, s.y + s.eye, s.z);
    s.feetInLava = blockAt(q, s.x, s.y + 0.1, s.z) === B.lava;
    if (headBlock === B.lava) s.feetInLava = true;
    if (s.feetInLava) events.lavaDamage = PHYS.LAVA_DPS * dt;

    if (s.inWater && !wasInWater && (s.vy < -6 || Math.abs(s.vx) + Math.abs(s.vz) > 6)) events.splash = true;

    // -- oxygen --------------------------------------------------------------
    if (s.submerged && !s.hasRebreather) {
      s.oxygen -= dt;
      if (s.oxygen < 0) {
        s.oxygen = 0;
        events.drowning = PHYS.DROWN_DPS * dt;
      }
    } else {
      s.oxygen = Math.min(PHYS.OXYGEN_MAX, s.oxygen + PHYS.OXYGEN_REGEN * dt);
    }

    // -- vault in progress ---------------------------------------------------
    if (s.vaulting) {
      s.vaultTime += dt;
      const t = Math.min(1, s.vaultTime / PHYS.VAULT_TIME);
      // Ease-out arc so the mantle reads as a deliberate animation.
      const e = 1 - Math.pow(1 - t, 3);
      s.x = s.vaultFrom.x + (s.vaultTo.x - s.vaultFrom.x) * e;
      s.z = s.vaultFrom.z + (s.vaultTo.z - s.vaultFrom.z) * e;
      s.y = s.vaultFrom.y + (s.vaultTo.y - s.vaultFrom.y) * Math.sin(e * Math.PI * 0.5);
      s.vx = s.vy = s.vz = 0;
      s.moveState = MOVE.VAULT;
      if (t >= 1) {
        s.vaulting = false;
        s.onGround = true;
        s.fallStartY = s.y;
      }
      return events;
    }

    // -- movement basis ------------------------------------------------------
    const sinY = Math.sin(s.yaw);
    const cosY = Math.cos(s.yaw);
    let inX = (wantRight ? 1 : 0) - (wantLeft ? 1 : 0);
    let inZ = (wantFwd ? 1 : 0) - (wantBack ? 1 : 0);
    // An analog stick (touch or gamepad) overrides the digital keys, giving
    // 360-degree movement and speed proportional to how far it is pushed.
    // Both sides receive the same quantised values, so prediction still
    // reconciles exactly.
    if (input.moveX !== undefined && (Math.abs(input.moveX) > 0.04 || Math.abs(input.moveY) > 0.04)) {
      inX = input.moveX;
      inZ = input.moveY;
    }
    const inLen = Math.hypot(inX, inZ);
    if (inLen > 1) {
      inX /= inLen;
      inZ /= inLen;
    }
    // yaw 0 faces +Z; right vector is (cos, -sin) in the XZ plane.
    const wishX = inZ * sinY + inX * cosY;
    const wishZ = inZ * cosY - inX * sinY;
    const hasInput = inLen > 0.01;
    // How hard the stick is pushed, used to scale the target speed.
    const inputMagnitude = Math.min(1, inLen);

    // -- climbing ------------------------------------------------------------
    const nearClimb = climbSurface(q, s, radius);
    s.climbing = nearClimb && !s.inWater && (wantClimb || wantJump || (hasInput && !s.onGround));

    if (s.climbing) {
      const climbSpeed = PHYS.CLIMB_SPEED * (s.hasClaws ? 1.35 : 1);
      s.vy = (wantJump ? 1 : wantCrouch ? -1 : inZ > 0.1 ? 0.8 : inZ < -0.1 ? -0.8 : 0) * climbSpeed;
      s.vx *= 0.55;
      s.vz *= 0.55;
      s.stamina = Math.max(0, s.stamina - dt * 5);
      if (s.stamina <= 0) s.climbing = false;
      s.moveState = MOVE.CLIMB;
      // Mantle over the top when the surface ends.
      if (s.vy > 0 && !climbSurface(q, { ...s, y: s.y + 1.2 }, radius)) {
        const vault = findVault(q, s, radius, s.height);
        if (vault) {
          s.vaulting = true;
          s.vaultTime = 0;
          s.vaultFrom = { x: s.x, y: s.y, z: s.z };
          s.vaultTo = vault;
          events.vaulted = true;
          return events;
        }
      }
    }

    // -- speed selection -----------------------------------------------------
    let maxSpeed;
    if (s.downed) maxSpeed = PHYS.PRONE_SPEED;
    else if (s.inWater) maxSpeed = s.submerged ? PHYS.DIVE_SPEED : PHYS.SWIM_SPEED;
    else if (s.prone) maxSpeed = PHYS.PRONE_SPEED;
    else if (s.sliding) maxSpeed = PHYS.SPRINT_SPEED;
    else if (s.crouching) maxSpeed = PHYS.CROUCH_SPEED;
    else if (wantSprint && inZ > 0.3 && s.stamina > 1 && !aiming) maxSpeed = PHYS.SPRINT_SPEED;
    else if (aiming) maxSpeed = PHYS.WALK_SPEED;
    else maxSpeed = PHYS.RUN_SPEED;
    maxSpeed *= s.speedMult * (opts.speedMult || 1);

    const sprinting = maxSpeed >= PHYS.SPRINT_SPEED - 0.01 && !s.sliding && hasInput && s.onGround && !s.inWater;

    // -- stamina -------------------------------------------------------------
    if (sprinting) {
      s.stamina = Math.max(0, s.stamina - PHYS.STAMINA_SPRINT * dt);
      if (s.stamina <= 0) maxSpeed = PHYS.RUN_SPEED;
    } else if (s.inWater && hasInput) {
      s.stamina = Math.max(0, s.stamina - PHYS.STAMINA_SWIM * dt);
    } else if (!s.climbing) {
      s.stamina = Math.min(PHYS.MAX_STAMINA, s.stamina + PHYS.STAMINA_REGEN * dt);
    }

    // -- slide ---------------------------------------------------------------
    s.slideCooldown = Math.max(0, s.slideCooldown - dt);
    const speedNow = Math.hypot(s.vx, s.vz);
    if (!s.sliding && wantSlide && s.onGround && !s.inWater && speedNow > PHYS.SLIDE_MIN_SPEED && s.slideCooldown <= 0 && s.stamina > 8) {
      s.sliding = true;
      s.slideTime = 0;
      s.stamina -= 8;
      const len = speedNow || 1;
      s.vx += (s.vx / len) * PHYS.SLIDE_IMPULSE;
      s.vz += (s.vz / len) * PHYS.SLIDE_IMPULSE;
    }
    if (s.sliding) {
      s.slideTime += dt;
      const slope = solidAt(q, s.x, s.y - 0.6, s.z) ? 0 : 0;
      const decay = Math.exp(-PHYS.SLIDE_FRICTION * dt * (1 + slope));
      s.vx *= decay;
      s.vz *= decay;
      if (s.slideTime > PHYS.SLIDE_MAX_TIME || Math.hypot(s.vx, s.vz) < 1.6 || !s.onGround || s.inWater || !wantSlide) {
        s.sliding = false;
        s.slideCooldown = 0.45;
      }
    }

    // -- acceleration --------------------------------------------------------
    if (s.inWater) {
      const accel = 26;
      s.vx += wishX * maxSpeed * accel * dt * 0.05;
      s.vz += wishZ * maxSpeed * accel * dt * 0.05;
      const drag = Math.exp(-PHYS.WATER_FRICTION * dt);
      s.vx *= drag;
      s.vz *= drag;
      s.vy *= Math.exp(-PHYS.WATER_FRICTION * 0.7 * dt);

      // Vertical: pitch-driven diving, explicit ascend, and buoyancy.
      if (wantSwimUp || wantJump) s.vy += PHYS.SWIM_UP_VELOCITY * dt * 6;
      else if (wantCrouch) s.vy -= PHYS.SWIM_UP_VELOCITY * dt * 6;
      else if (hasInput && s.submerged) s.vy += -Math.sin(s.pitch) * maxSpeed * dt * 6 * inZ;

      if (sub > 0.6) {
        const buoy = (sub - 0.55) * PHYS.BUOYANCY;
        s.vy += buoy * dt;
      }
      s.vy -= PHYS.WATER_GRAVITY * dt;
      s.vy = Math.max(-PHYS.WATER_TERMINAL, Math.min(PHYS.WATER_TERMINAL, s.vy));
      s.moveState = s.submerged ? MOVE.DIVE : MOVE.SWIM;
      s.onGround = false;
      s.parachute = false;
    } else if (!s.climbing) {
      const onIce = s.onGround && isIce(q, s.x, s.y, s.z);
      const accel = s.onGround ? (s.sliding ? 6 : PHYS.GROUND_ACCEL) : PHYS.AIR_ACCEL;
      const control = s.onGround ? 1 : PHYS.AIR_CONTROL;

      if (hasInput && !s.sliding) {
        const targetX = wishX * maxSpeed * inputMagnitude;
        const targetZ = wishZ * maxSpeed * inputMagnitude;
        s.vx += (targetX - s.vx) * Math.min(1, accel * control * dt * 0.16);
        s.vz += (targetZ - s.vz) * Math.min(1, accel * control * dt * 0.16);
      } else if (s.onGround && !s.sliding) {
        const friction = onIce ? PHYS.ICE_FRICTION : PHYS.FRICTION;
        const decay = Math.exp(-friction * dt);
        s.vx *= decay;
        s.vz *= decay;
      }

      // Clamp horizontal speed (sliding is allowed to exceed it briefly).
      const hs = Math.hypot(s.vx, s.vz);
      const cap = s.sliding ? PHYS.SPRINT_SPEED * 1.6 : maxSpeed;
      if (hs > cap) {
        const k = cap / hs;
        s.vx *= k;
        s.vz *= k;
      }

      // Gravity / parachute
      if (s.parachute) {
        s.vy = Math.max(s.vy - PHYS.GRAVITY * dt * 0.15, -PHYS.PARACHUTE_FALL);
        // A deployed canopy cancels the accumulated fall, otherwise every
        // landing after a high drop would be lethal.
        s.fallStartY = s.y;
        const cap2 = PHYS.PARACHUTE_SPEED;
        const hs2 = Math.hypot(s.vx, s.vz);
        if (hs2 > cap2) {
          s.vx *= cap2 / hs2;
          s.vz *= cap2 / hs2;
        }
        s.moveState = MOVE.PARACHUTE;
      } else {
        s.vy -= PHYS.GRAVITY * dt;
        if (s.vy < -PHYS.TERMINAL_VELOCITY) s.vy = -PHYS.TERMINAL_VELOCITY;
      }
    }

    // -- jump (with coyote time + input buffering) ---------------------------
    s.coyote = s.onGround ? 0.12 : Math.max(0, s.coyote - dt);
    s.jumpBuffer = wantJump ? 0.16 : Math.max(0, s.jumpBuffer - dt);

    if (s.jumpBuffer > 0 && (s.onGround || s.coyote > 0) && !s.inWater && !s.climbing && !s.downed && s.stamina >= PHYS.STAMINA_JUMP) {
      // A ledge ahead is mantled instead of jumped.
      const vault = findVault(q, s, radius, s.height);
      if (vault && hasInput) {
        s.vaulting = true;
        s.vaultTime = 0;
        s.vaultFrom = { x: s.x, y: s.y, z: s.z };
        s.vaultTo = vault;
        s.jumpBuffer = 0;
        s.coyote = 0;
        events.vaulted = true;
        return events;
      }
      s.vy = PHYS.JUMP_VELOCITY * (s.crouching ? 0.82 : 1);
      s.onGround = false;
      s.coyote = 0;
      s.jumpBuffer = 0;
      s.sliding = false;
      s.stamina -= PHYS.STAMINA_JUMP;
      s.falling = true;
      s.fallStartY = s.y;
      s.moveState = MOVE.JUMP;
    }

    // -- integrate + collide -------------------------------------------------
    const wasOnGround = s.onGround;
    const prevX = s.x;
    const prevZ = s.z;
    const hit = moveAxis(q, s, s.vx * dt, s.vy * dt, s.vz * dt, s.height, radius);

    if (hit.hitX) s.vx = 0;
    if (hit.hitZ) s.vz = 0;

    if (hit.hitY) {
      if (s.vy < 0) {
        s.onGround = true;
        if (s.falling) {
          const fallDist = s.fallStartY - s.y;
          if (fallDist > PHYS.FALL_SAFE && !s.inWater) {
            const over = fallDist - PHYS.FALL_SAFE;
            events.fallDamage = Math.min(100, over * PHYS.FALL_DAMAGE_PER_M);
            if (fallDist >= PHYS.FALL_LETHAL) events.fallDamage = 1000;
          }
          events.landed = Math.max(0, s.fallStartY - s.y);
          s.landImpact = Math.min(1, events.landed / 8);
          s.falling = false;
          s.parachute = false;
        }
      }
      s.vy = 0;
    } else {
      // Ground probe keeps `onGround` stable on slopes and block seams.
      const grounded = collides(q, s.x, s.y - 0.06, s.z, 0.05, radius) && s.vy <= 0.001;
      s.onGround = grounded && !s.inWater;
      if (!s.onGround && !s.inWater && !s.climbing) {
        if (!s.falling && s.vy < -0.4) {
          s.falling = true;
          s.fallStartY = s.y;
        }
      }
    }

    if (s.onGround) {
      s.falling = false;
      s.fallStartY = s.y;
    }

    // -- move state + travel accounting --------------------------------------
    const dxm = s.x - prevX;
    const dzm = s.z - prevZ;
    const moved = Math.hypot(dxm, dzm);
    s.distanceMoved += moved;
    const hSpeed = Math.hypot(s.vx, s.vz);

    if (!s.inWater && !s.climbing && !s.vaulting) {
      if (s.downed) s.moveState = MOVE.DOWNED;
      else if (s.sliding) s.moveState = MOVE.SLIDE;
      else if (!s.onGround) s.moveState = s.parachute ? MOVE.PARACHUTE : s.vy > 0.5 ? MOVE.JUMP : MOVE.FALL;
      else if (s.crouching) s.moveState = hSpeed > 0.4 ? MOVE.CROUCH : MOVE.CROUCH;
      else if (hSpeed > PHYS.RUN_SPEED + 0.3) s.moveState = MOVE.SPRINT;
      else if (hSpeed > PHYS.WALK_SPEED + 0.2) s.moveState = MOVE.RUN;
      else if (hSpeed > 0.35) s.moveState = MOVE.WALK;
      else s.moveState = MOVE.IDLE;
    }

    // Footstep cadence is derived from distance so it stays in sync with the
    // animation regardless of frame rate.
    if (s.onGround && hSpeed > 0.6) {
      const stride = s.crouching ? 1.5 : hSpeed > PHYS.RUN_SPEED ? 2.35 : 1.9;
      s.bobPhase += moved / stride;
      if (s.bobPhase >= 1) {
        s.bobPhase -= 1;
        events.footstep = true;
      }
    }

    // Smooth the step-up offset out over time (camera only, not physics).
    s.stepSmooth *= Math.exp(-14 * dt);

    return events;
  }

  /** Eye position including lean offset - used for raycasts and rendering. */
  function eyePosition(s, out) {
    const o = out || { x: 0, y: 0, z: 0 };
    const leanOff = s.lean * PHYS.LEAN_OFFSET;
    o.x = s.x + Math.cos(s.yaw) * leanOff;
    o.y = s.y + s.eye - Math.abs(s.lean) * 0.08;
    o.z = s.z - Math.sin(s.yaw) * leanOff;
    return o;
  }

  /** Forward unit vector from yaw/pitch. */
  function lookVector(yaw, pitch, out) {
    const o = out || { x: 0, y: 0, z: 0 };
    const cp = Math.cos(pitch);
    o.x = Math.sin(yaw) * cp;
    o.y = Math.sin(pitch);
    o.z = Math.cos(yaw) * cp;
    return o;
  }

  /**
   * DDA voxel raycast. Returns {hit, x,y,z, nx,ny,nz, block, distance} or null.
   */
  function raycast(q, ox, oy, oz, dx, dy, dz, maxDist, opts = {}) {
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;

    let x = Math.floor(ox);
    let y = Math.floor(oy);
    let z = Math.floor(oz);

    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;

    const tDeltaX = Math.abs(1 / (dx || 1e-9));
    const tDeltaY = Math.abs(1 / (dy || 1e-9));
    const tDeltaZ = Math.abs(1 / (dz || 1e-9));

    let tMaxX = ((dx > 0 ? x + 1 - ox : ox - x) || 1e-9) * tDeltaX;
    let tMaxY = ((dy > 0 ? y + 1 - oy : oy - y) || 1e-9) * tDeltaY;
    let tMaxZ = ((dz > 0 ? z + 1 - oz : oz - z) || 1e-9) * tDeltaZ;

    let nx = 0;
    let ny = 0;
    let nz = 0;
    let t = 0;
    const wantLiquid = !!opts.hitLiquid;
    const wantFoliage = !!opts.hitFoliage;

    for (let i = 0; i < 4096 && t <= maxDist; i++) {
      const id = q(x, y, z);
      if (id) {
        const solid = isSolid(id) && !isLiquid(id);
        const liquid = isLiquid(id);
        const foliage = (FLAGS[id] & F.FOLIAGE) !== 0;
        if ((solid && !foliage) || (liquid && wantLiquid) || (foliage && wantFoliage)) {
          return {
            hit: true,
            x,
            y,
            z,
            nx,
            ny,
            nz,
            block: id,
            distance: t,
            px: ox + dx * t,
            py: oy + dy * t,
            pz: oz + dz * t,
          };
        }
      }
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          x += stepX;
          t = tMaxX;
          tMaxX += tDeltaX;
          nx = -stepX;
          ny = 0;
          nz = 0;
        } else {
          z += stepZ;
          t = tMaxZ;
          tMaxZ += tDeltaZ;
          nx = 0;
          ny = 0;
          nz = -stepZ;
        }
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        nx = 0;
        ny = -stepY;
        nz = 0;
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        nx = 0;
        ny = 0;
        nz = -stepZ;
      }
    }
    return null;
  }

  /** Ray vs axis-aligned box (used for hit detection against player capsules). */
  function rayBox(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
    let tmin = -Infinity;
    let tmax = Infinity;
    const inv = [1 / (dx || 1e-9), 1 / (dy || 1e-9), 1 / (dz || 1e-9)];
    const o = [ox, oy, oz];
    const lo = [minX, minY, minZ];
    const hi = [maxX, maxY, maxZ];
    for (let i = 0; i < 3; i++) {
      let t1 = (lo[i] - o[i]) * inv[i];
      let t2 = (hi[i] - o[i]) * inv[i];
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
    return tmax < 0 ? -1 : tmin < 0 ? 0 : tmin;
  }

  return {
    createState,
    createInput,
    step,
    collides,
    solidAt,
    liquidAt,
    submersion,
    findVault,
    eyePosition,
    lookVector,
    raycast,
    rayBox,
    climbSurface,
  };
});
