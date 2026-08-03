// ============================================================
//  محرك الصوت — كل الأصوات مُولَّدة برمجياً (لا ملفات خارجية)
//  يشمل صوت محركات الطائرة المستمر
// ============================================================

let ctx = null, master = null, sfxBus = null, musBus = null;
let started = false;
export const state = { sfx: true, music: true, engine: true };

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.8; sfxBus.connect(master);
  musBus = ctx.createGain(); musBus.gain.value = 0.22; musBus.connect(master);
  return ctx;
}

export function unlock() {
  ensure();
  if (ctx && ctx.state === 'suspended') ctx.resume();
  started = true;
}
export function setVolumes({ sfx, music }) {
  ensure();
  if (sfx !== undefined && sfxBus) sfxBus.gain.value = sfx;
  if (music !== undefined && musBus) musBus.gain.value = music;
}

// ---------- مولّدات أساسية ----------
function noiseBuffer(sec = 1) {
  const n = Math.floor(ctx.sampleRate * sec);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
let _noise = null;
const NOISE = () => (_noise ||= noiseBuffer(2));

function env(node, t0, a, d, peak = 1) {
  const g = node.gain;
  g.cancelScheduledValues(t0);
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
  g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
}

function tone({ freq = 440, type = 'sine', a = 0.005, d = 0.2, gain = 0.3, slideTo = null, at = 0, bus }) {
  if (!ensure() || !state.sfx) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 1), t + a + d);
  const g = ctx.createGain(); env(g, t, a, d, gain);
  o.connect(g); g.connect(bus || sfxBus);
  o.start(t); o.stop(t + a + d + 0.05);
}

function noise({ a = 0.005, d = 0.15, gain = 0.3, hp = 300, lp = 6000, at = 0, q = 1 }) {
  if (!ensure() || !state.sfx) return;
  const t = ctx.currentTime + at;
  const s = ctx.createBufferSource(); s.buffer = NOISE(); s.loop = true;
  const f1 = ctx.createBiquadFilter(); f1.type = 'highpass'; f1.frequency.value = hp; f1.Q.value = q;
  const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = lp;
  const g = ctx.createGain(); env(g, t, a, d, gain);
  s.connect(f1); f1.connect(f2); f2.connect(g); g.connect(sfxBus);
  s.start(t); s.stop(t + a + d + 0.05);
}

// ---------- مكتبة الأصوات ----------
export const sfx = {
  click()   { tone({ freq: 660, type: 'square', a: .004, d: .06, gain: .12 });
              tone({ freq: 990, type: 'square', a: .004, d: .05, gain: .06, at: .03 }); },
  back()    { tone({ freq: 420, type: 'square', a: .004, d: .08, gain: .1, slideTo: 260 }); },
  ui_ok()   { tone({ freq: 620, type: 'triangle', a: .01, d: .12, gain: .18 });
              tone({ freq: 930, type: 'triangle', a: .01, d: .16, gain: .14, at: .08 }); },
  ui_err()  { tone({ freq: 200, type: 'sawtooth', a: .01, d: .22, gain: .16, slideTo: 120 }); },
  shoot()   { noise({ a: .002, d: .07, gain: .32, hp: 700, lp: 9000 });
              tone({ freq: 190, type: 'square', a: .002, d: .1, gain: .28, slideTo: 60 }); },
  hit()     { noise({ a: .001, d: .05, gain: .25, hp: 1600, lp: 12000 });
              tone({ freq: 1400, type: 'sine', a: .002, d: .06, gain: .12 }); },
  hurt()    { tone({ freq: 260, type: 'sawtooth', a: .005, d: .3, gain: .22, slideTo: 90 });
              noise({ a: .002, d: .2, gain: .16, hp: 200, lp: 2200 }); },
  jump()    { tone({ freq: 320, type: 'sine', a: .006, d: .16, gain: .22, slideTo: 720 }); },
  land()    { noise({ a: .002, d: .11, gain: .22, hp: 120, lp: 1500 });
              tone({ freq: 110, type: 'sine', a: .004, d: .14, gain: .2, slideTo: 60 }); },
  step()    { noise({ a: .002, d: .05, gain: .075, hp: 400, lp: 2600 }); },
  crate()   { tone({ freq: 150, type: 'sawtooth', a: .01, d: .5, gain: .2, slideTo: 420 });
              noise({ a: .02, d: .55, gain: .14, hp: 260, lp: 3400 });
              tone({ freq: 880, type: 'triangle', a: .01, d: .3, gain: .16, at: .38 });
              tone({ freq: 1320, type: 'triangle', a: .01, d: .4, gain: .13, at: .5 }); },
  pickup()  { tone({ freq: 700, type: 'triangle', a: .005, d: .1, gain: .2 });
              tone({ freq: 1050, type: 'triangle', a: .005, d: .14, gain: .17, at: .07 });
              tone({ freq: 1400, type: 'triangle', a: .005, d: .18, gain: .12, at: .14 }); },
  kill()    { tone({ freq: 520, type: 'square', a: .006, d: .12, gain: .2 });
              tone({ freq: 780, type: 'square', a: .006, d: .16, gain: .16, at: .09 });
              tone({ freq: 1040, type: 'square', a: .006, d: .3, gain: .13, at: .19 }); },
  chute()   { noise({ a: .12, d: .8, gain: .3, hp: 200, lp: 2400 }); },
  whoosh()  { noise({ a: .08, d: .45, gain: .22, hp: 300, lp: 5200 }); },
  win()     { [523, 659, 784, 1046].forEach((f, i) =>
                tone({ freq: f, type: 'triangle', a: .01, d: .5, gain: .2, at: i * .13 })); },
  lose()    { [400, 340, 280, 200].forEach((f, i) =>
                tone({ freq: f, type: 'sawtooth', a: .01, d: .45, gain: .16, at: i * .16 })); },
  siren()   { tone({ freq: 700, type: 'sawtooth', a: .05, d: .5, gain: .1, slideTo: 400 }); },
};

// ---------- صوت محرّكات الطائرة (مستمر) ----------
class EngineSound {
  constructor() { this.on = false; this.nodes = null; }
  start() {
    if (!ensure() || this.on || !state.engine || !state.sfx) return;
    this.on = true;
    const t = ctx.currentTime;
    const out = ctx.createGain(); out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.42, t + 1.6);
    out.connect(sfxBus);

    // هدير منخفض (توافقيات)
    const oscs = [];
    [[44, 'sawtooth', .5], [88, 'square', .25], [132, 'sawtooth', .16], [31, 'sine', .5]]
      .forEach(([f, ty, g]) => {
        const o = ctx.createOscillator(); o.type = ty; o.frequency.value = f;
        const gg = ctx.createGain(); gg.gain.value = g;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
        o.connect(gg); gg.connect(lp); lp.connect(out); o.start(t);
        oscs.push({ o, base: f });
      });

    // ضجيج الدفع
    const ns = ctx.createBufferSource(); ns.buffer = NOISE(); ns.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 620; bp.Q.value = .7;
    const ng = ctx.createGain(); ng.gain.value = .3;
    ns.connect(bp); bp.connect(ng); ng.connect(out); ns.start(t);

    // نبض الشفرات
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 11;
    const lg = ctx.createGain(); lg.gain.value = .1;
    lfo.connect(lg); lg.connect(out.gain); lfo.start(t);

    this.nodes = { out, oscs, ns, lfo, bp, ng };
  }
  /** throttle 0..1 و pitch (دوبلر) */
  set(throttle = 1, pitch = 1) {
    if (!this.on || !this.nodes) return;
    const t = ctx.currentTime;
    for (const { o, base } of this.nodes.oscs)
      o.frequency.setTargetAtTime(base * pitch * (0.7 + 0.5 * throttle), t, 0.12);
    this.nodes.bp.frequency.setTargetAtTime(420 + 700 * throttle, t, 0.15);
    this.nodes.ng.gain.setTargetAtTime(0.14 + 0.3 * throttle, t, 0.15);
  }
  volume(v) {
    if (!this.on || !this.nodes) return;
    this.nodes.out.gain.setTargetAtTime(Math.max(v, 0.0001), ctx.currentTime, 0.25);
  }
  stop() {
    if (!this.on || !this.nodes) return;
    const { out, oscs, ns, lfo } = this.nodes;
    const t = ctx.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(Math.max(out.gain.value, .0002), t);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    setTimeout(() => {
      try { oscs.forEach(({ o }) => o.stop()); ns.stop(); lfo.stop(); } catch (e) {}
    }, 1200);
    this.on = false; this.nodes = null;
  }
}
export const engineSound = new EngineSound();

// ---------- رياح السقوط الحر ----------
class WindSound {
  constructor() { this.on = false; }
  start() {
    if (!ensure() || this.on || !state.sfx) return;
    this.on = true;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = NOISE(); s.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = .5;
    const g = ctx.createGain(); g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(.3, t + .8);
    s.connect(bp); bp.connect(g); g.connect(sfxBus); s.start(t);
    this.n = { s, g, bp };
  }
  set(intensity) {
    if (!this.on) return;
    const t = ctx.currentTime;
    this.n.g.gain.setTargetAtTime(0.06 + 0.34 * intensity, t, .2);
    this.n.bp.frequency.setTargetAtTime(500 + 1400 * intensity, t, .2);
  }
  stop() {
    if (!this.on) return;
    const t = ctx.currentTime;
    this.n.g.gain.cancelScheduledValues(t);
    this.n.g.gain.setValueAtTime(Math.max(this.n.g.gain.value, .0002), t);
    this.n.g.gain.exponentialRampToValueAtTime(.0001, t + .6);
    const s = this.n.s;
    setTimeout(() => { try { s.stop(); } catch (e) {} }, 800);
    this.on = false;
  }
}
export const windSound = new WindSound();

// ---------- موسيقى القائمة ----------
let musTimer = null, musStep = 0;
const SCALE = [0, 3, 5, 7, 10, 12, 15, 12, 10, 7, 5, 3];
export function startMusic() {
  if (!ensure() || musTimer || !state.music) return;
  const root = 174.61;
  const beat = () => {
    const t = ctx.currentTime;
    const n = SCALE[musStep % SCALE.length];
    const f = root * Math.pow(2, n / 12);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const g = ctx.createGain(); env(g, t, .02, .5, .16);
    const dl = ctx.createDelay(); dl.delayTime.value = .28;
    const fb = ctx.createGain(); fb.gain.value = .32;
    o.connect(g); g.connect(musBus); g.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(musBus);
    o.start(t); o.stop(t + .6);
    if (musStep % 4 === 0) {
      const b = ctx.createOscillator(); b.type = 'sine'; b.frequency.value = root / 2;
      const bg = ctx.createGain(); env(bg, t, .01, .38, .3);
      b.connect(bg); bg.connect(musBus); b.start(t); b.stop(t + .5);
    }
    musStep++;
  };
  beat();
  musTimer = setInterval(beat, 340);
}
export function stopMusic() { clearInterval(musTimer); musTimer = null; }

export function applySettings(m) {
  state.sfx = m.sfx !== false;
  state.music = m.music !== false;
  state.engine = m.engineSfx !== false;
  if (!state.music) stopMusic();
}
