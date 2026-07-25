// Skeletal stick figure with a parametric pose library. A pose is a function of
// a phase (0..1) returning joint angles; buildSkeleton turns those into world-
// drawable bones + head. All angles are measured from straight-down, positive
// swinging in the facing direction.

const M = {
  headR: 15, neck: 62, headGap: 7,
  upperArm: 30, foreArm: 28,
  thigh: 36, shin: 34, foot: 14,
};

function extend(o, angle, len, facing) {
  return { x: o.x + Math.sin(angle) * len * facing, y: o.y + Math.cos(angle) * len };
}

// Default (relaxed) angle set; poses override what they need.
function base() {
  return {
    lean: 0, bob: 0, rot: 0,
    armL: { sh: 0.13, el: 0.12 }, armR: { sh: 0.13, el: 0.12 },
    legL: { hip: 0.08, knee: 0.02 }, legR: { hip: -0.08, knee: 0.02 },
  };
}

// ---- Pose library ----------------------------------------------------------
export const POSES = {
  idle(p) {
    const a = base();
    a.bob = Math.sin(p * Math.PI * 2) * 1.5;
    a.armL.sh = 0.14 + 0.04 * Math.sin(p * Math.PI * 2);
    a.armR.sh = 0.14 - 0.04 * Math.sin(p * Math.PI * 2);
    return a;
  },
  walk(p) {
    const a = base();
    const s = Math.sin(p * Math.PI * 2);
    a.legL.hip = 0.5 * s;
    a.legR.hip = -0.5 * s;
    a.legL.knee = 0.35 + 0.35 * Math.max(0, Math.sin(p * Math.PI * 2 + Math.PI));
    a.legR.knee = 0.35 + 0.35 * Math.max(0, Math.sin(p * Math.PI * 2));
    a.armL.sh = -0.45 * s; a.armL.el = 0.25;
    a.armR.sh = 0.45 * s; a.armR.el = 0.25;
    a.bob = -Math.abs(s) * 3;
    a.lean = 0.09;
    return a;
  },
  run(p) {
    const a = base();
    const s = Math.sin(p * Math.PI * 2);
    a.legL.hip = 0.85 * s; a.legR.hip = -0.85 * s;
    a.legL.knee = 0.5 + 0.5 * Math.max(0, Math.sin(p * Math.PI * 2 + Math.PI));
    a.legR.knee = 0.5 + 0.5 * Math.max(0, Math.sin(p * Math.PI * 2));
    a.armL.sh = -0.8 * s; a.armL.el = 0.9;
    a.armR.sh = 0.8 * s; a.armR.el = 0.9;
    a.bob = -Math.abs(s) * 5;
    a.lean = 0.38;
    return a;
  },
  jump() {
    const a = base();
    a.armL.sh = -1.3; a.armR.sh = -1.3; a.armL.el = 0.2; a.armR.el = 0.2;
    a.legL.hip = 0.25; a.legR.hip = -0.25; a.legL.knee = 0.7; a.legR.knee = 0.7;
    return a;
  },
  punch(p) {
    const a = base();
    const ext = Math.sin(Math.PI * Math.min(1, p * 1.0));
    a.armR.sh = 0.3 + 1.15 * ext; a.armR.el = 0.5 * (1 - ext);
    a.armL.sh = 0.6; a.armL.el = 1.3;
    a.legL.hip = 0.35; a.legR.hip = -0.35; a.legL.knee = 0.25; a.legR.knee = 0.15;
    a.lean = 0.18;
    return a;
  },
  fall(p) {
    const a = base();
    const e = p * p * (3 - 2 * p); // smoothstep
    a.rot = (Math.PI / 2) * e;
    a.bob = 24 * e;
    const s = Math.sin(p * Math.PI * 6);
    a.armL.sh = -0.6 + 0.7 * s; a.armR.sh = -0.6 - 0.7 * s;
    a.legL.knee = 0.4 + 0.3 * e; a.legR.knee = 0.5 + 0.3 * e;
    return a;
  },
  wave(p) {
    const a = base();
    a.armR.sh = -1.55; a.armR.el = 0.3 + 0.35 * Math.sin(p * Math.PI * 4);
    a.armL.sh = 0.15;
    return a;
  },
  dance(p) {
    const a = base();
    const s = Math.sin(p * Math.PI * 2);
    a.armL.sh = -1.35 * (0.5 + 0.5 * s);
    a.armR.sh = -1.35 * (0.5 - 0.5 * s);
    a.armL.el = 0.3; a.armR.el = 0.3;
    a.lean = 0.16 * s;
    a.legL.knee = 0.2 + 0.2 * Math.abs(s);
    a.legR.knee = 0.2 + 0.2 * Math.abs(Math.cos(p * Math.PI * 2));
    a.bob = -Math.abs(s) * 4;
    return a;
  },
  sit() {
    const a = base();
    a.bob = 34;
    a.legL.hip = 1.15; a.legR.hip = 0.95; a.legL.knee = 1.25; a.legR.knee = 1.25;
    a.armL.sh = 0.35; a.armR.sh = 0.35; a.armL.el = 0.4; a.armR.el = 0.4;
    return a;
  },
  celebrate(p) {
    const a = base();
    a.armL.sh = -1.45; a.armR.sh = -1.45; a.armL.el = 0.15; a.armR.el = 0.15;
    a.bob = -Math.abs(Math.sin(p * Math.PI * 2)) * 8;
    a.legL.hip = 0.2; a.legR.hip = -0.2;
    return a;
  },
};

export function poseNames() {
  return Object.keys(POSES);
}

// Build world-space drawables from a pose. facing: +1 (right) or -1 (left).
export function buildSkeleton(poseName, phase, facing = 1) {
  const a = (POSES[poseName] || POSES.idle)(phase);
  const hip = { x: 0, y: a.bob };

  // Spine + head follow the lean.
  const neck = { x: hip.x + Math.sin(a.lean) * M.neck * facing, y: hip.y - Math.cos(a.lean) * M.neck };
  const headC = {
    x: neck.x + Math.sin(a.lean) * (M.headR + M.headGap) * facing,
    y: neck.y - Math.cos(a.lean) * (M.headR + M.headGap),
  };

  // Arms from the neck/shoulder anchor (limb angles are relative to the lean).
  const elbowL = extend(neck, a.lean + a.armL.sh, M.upperArm, facing);
  const handL = extend(elbowL, a.lean + a.armL.sh + a.armL.el, M.foreArm, facing);
  const elbowR = extend(neck, a.lean + a.armR.sh, M.upperArm, facing);
  const handR = extend(elbowR, a.lean + a.armR.sh + a.armR.el, M.foreArm, facing);

  // Legs from the hip.
  const kneeL = extend(hip, a.legL.hip, M.thigh, facing);
  const footL = extend(kneeL, a.legL.hip + a.legL.knee, M.shin, facing);
  const kneeR = extend(hip, a.legR.hip, M.thigh, facing);
  const footR = extend(kneeR, a.legR.hip + a.legR.knee, M.shin, facing);
  const toeL = extend(footL, Math.PI / 2, M.foot, facing);
  const toeR = extend(footR, Math.PI / 2, M.foot, facing);

  let bones = [
    [hip, neck, 9],
    [neck, elbowL, 6], [elbowL, handL, 5],
    [neck, elbowR, 6], [elbowR, handR, 5],
    [hip, kneeL, 7], [kneeL, footL, 6], [footL, toeL, 5],
    [hip, kneeR, 7], [kneeR, footR, 6], [footR, toeR, 5],
  ];
  let head = { x: headC.x, y: headC.y, r: M.headR };
  const hands = [handL, handR];

  // Whole-body rotation (falling) around the hip.
  if (a.rot) {
    const cos = Math.cos(a.rot * facing), sin = Math.sin(a.rot * facing);
    const rot = (pt) => ({ x: (pt.x - hip.x) * cos - (pt.y - hip.y) * sin + hip.x, y: (pt.x - hip.x) * sin + (pt.y - hip.y) * cos + hip.y });
    bones = bones.map(([p, q, t]) => [rot(p), rot(q), t]);
    head = { ...rot(head), r: head.r };
    hands[0] = rot(hands[0]); hands[1] = rot(hands[1]);
  }

  return { hip, bones, head, hands };
}

export const METRICS = M;
