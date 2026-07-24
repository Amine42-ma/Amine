/* =========================================================================
 * audio.js — Procedural sound engine (Web Audio API)
 * All sounds are synthesized at runtime — no external asset files needed.
 * Includes SFX (hit, swing, jump, death, UI) and a looping music bed.
 * ========================================================================= */
'use strict';

class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.enabled = true;
    this.musicEnabled = true;
    this._musicTimer = null;
    this._musicStep = 0;
  }

  /** Lazily create the AudioContext (must follow a user gesture). */
  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.8;
      this.sfxGain.connect(this.master);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.25;
      this.musicGain.connect(this.master);
    } catch (e) {
      this.enabled = false;
      console.warn('Audio unavailable', e);
    }
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  _now() { return this.ctx.currentTime; }

  /** Basic oscillator tone with ADSR-ish envelope */
  tone(freq, dur, type = 'sine', vol = 0.5, dest = null, slideTo = null) {
    if (!this.enabled || !this.ctx) return;
    const t = this._now();
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(dest || this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Noise burst (used for impacts / hits) */
  noise(dur, vol = 0.5, filterFreq = 1200, dest = null) {
    if (!this.enabled || !this.ctx) return;
    const t = this._now();
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter); filter.connect(g); g.connect(dest || this.sfxGain);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /* ---- Named sound effects ---- */

  // whoosh: a filtered noise sweep + airy tone
  swing() {
    this.noise(0.12, 0.22, 3200);
    this.noise(0.08, 0.16, 1400);
    this.tone(360, 0.11, 'triangle', 0.1, null, 700);
  }

  // meaty impact: punchy low thump + transient crack, scaled by power
  hit(power = 1) {
    const p = Utils.clamp(power, 0.4, 2.2);
    this.noise(0.05, 0.55 * p, 5200);              // sharp transient crack
    this.noise(0.18, 0.4 * p, 800 + 200 * p);      // body
    this.tone(150 - 24 * p, 0.2, 'sine', 0.4 * p, null, 48);   // punchy thump
    this.tone(90, 0.12, 'square', 0.18 * p, null, 55);
  }

  // metallic parry: two detuned rings + a bright ping
  clang() {
    this.tone(1200, 0.18, 'square', 0.16, null, 620);
    this.tone(1840, 0.16, 'triangle', 0.12, null, 900);
    this.tone(2600, 0.1, 'sine', 0.08);
    this.noise(0.05, 0.22, 6000);
  }

  jump() { this.tone(300, 0.16, 'sine', 0.2, null, 640); this.noise(0.05, 0.08, 2000); }

  land() { this.noise(0.1, 0.2, 500); }

  death() {
    this.tone(200, 0.5, 'sawtooth', 0.35, null, 40);
    this.noise(0.5, 0.35, 700);
  }

  hurt() { this.tone(420, 0.12, 'square', 0.18, null, 200); }

  pickup() { this.tone(660, 0.08, 'triangle', 0.25); this.tone(990, 0.1, 'triangle', 0.22); }

  uiClick() { this.tone(520, 0.06, 'square', 0.18, null, 700); }
  uiHover() { this.tone(700, 0.04, 'sine', 0.08); }

  win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 'triangle', 0.3), i * 130)); }
  lose() { [392, 349, 294, 233].forEach((f, i) => setTimeout(() => this.tone(f, 0.35, 'sawtooth', 0.25), i * 150)); }
  countdown(final = false) { this.tone(final ? 880 : 520, final ? 0.35 : 0.16, 'triangle', 0.3, null, final ? 1200 : 520); }

  /* ---- Percussion (routed through the music bus) ---- */
  kick(dest) {
    if (!this.ctx) return;
    const t = this._now();
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.14);
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g); g.connect(dest || this.musicGain);
    o.start(t); o.stop(t + 0.2);
  }
  hat(dest, open = false) { this.noise(open ? 0.08 : 0.03, 0.12, 9000, dest || this.musicGain); }
  snare(dest) {
    this.noise(0.13, 0.28, 3200, dest || this.musicGain);
    this.tone(210, 0.12, 'triangle', 0.12, dest || this.musicGain, 150);
  }

  /* ---- Layered looping music: pads + bass + arpeggio + drums ---- */
  startMusic() {
    if (!this.enabled || !this.ctx || this._musicTimer) return;
    // 8-bar A-minor journey (Am–F–C–G ×2 with a lead melody) for more interest
    const chords = [
      { bass: 55.00, notes: [220.00, 261.63, 329.63] }, // Am
      { bass: 43.65, notes: [174.61, 220.00, 261.63] }, // F
      { bass: 65.41, notes: [261.63, 329.63, 392.00] }, // C
      { bass: 49.00, notes: [196.00, 246.94, 293.66] }, // G
    ];
    const arpPat = [0, 2, 1, 2, 0, 1, 2, 1];
    // Lead melody: [step, chord-tone index, octave] played over each bar (bars 4-7)
    const leadBars = [
      [[0, 2, 2], [4, 1, 2], [6, 2, 2], [10, 0, 3], [12, 1, 2]],
      [[0, 1, 2], [3, 2, 2], [8, 0, 2], [12, 2, 2], [14, 1, 3]],
      [[0, 0, 3], [4, 2, 2], [6, 1, 2], [10, 2, 2], [12, 0, 3]],
      [[2, 2, 2], [6, 1, 2], [8, 2, 2], [11, 0, 3], [14, 2, 2]],
    ];
    this._musicStep = 0;
    const bpm = 106;
    const stepTime = 60 / bpm / 4; // 16th notes
    const loop = () => {
      if (!this.musicEnabled) return;
      const s = this._musicStep;
      const barAbs = Math.floor(s / 16) % 8;      // 0..7 over the 8-bar loop
      const bar = barAbs % 4;
      const step = s % 16;
      const chord = chords[bar];
      const pad = this.musicGain;
      const secondHalf = barAbs >= 4;             // lead only in the second half

      if (step === 0) {
        chord.notes.forEach((f) => this.tone(f, 1.9, 'sine', 0.045, pad));
        this.tone(chord.notes[0] * 2, 1.9, 'triangle', 0.02, pad);
      }
      // Bassline
      if (step % 4 === 0) this.tone(chord.bass, 0.42, 'sawtooth', 0.11, pad, chord.bass * 0.99);
      if (step % 4 === 2) this.tone(chord.bass * 2, 0.2, 'square', 0.05, pad);
      // Arpeggio
      if (step % 2 === 0) this.tone(chord.notes[arpPat[(step / 2) % arpPat.length]] * 2, 0.22, 'triangle', 0.06, pad);
      // Lead melody (second half of the loop) — a bright square line
      if (secondHalf) {
        for (const [ls, idx, oct] of leadBars[bar]) {
          if (ls === step) this.tone(chord.notes[idx] * (oct === 3 ? 4 : 2), 0.2, 'square', 0.05, pad, undefined);
        }
      }
      // Drums (fuller groove in the second half)
      if (step === 0 || step === 8 || step === 6) this.kick(pad);
      if (step === 4 || step === 12) this.snare(pad);
      if (secondHalf && step === 14) this.snare(pad);       // fill
      if (step % 2 === 0) this.hat(pad, step % 8 === 6);

      this._musicStep++;
    };
    loop();
    this._musicTimer = setInterval(loop, stepTime * 1000);
  }

  stopMusic() {
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
  }

  setMuted(muted) {
    this.enabled = !muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.9;
  }

  toggleMusic(on) {
    this.musicEnabled = on;
    if (on) this.startMusic(); else this.stopMusic();
  }
}
