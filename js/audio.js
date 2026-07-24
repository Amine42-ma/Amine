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

  swing() { this.noise(0.14, 0.25, 2600); this.tone(320, 0.12, 'triangle', 0.12, null, 620); }

  hit(power = 1) {
    const p = Utils.clamp(power, 0.4, 2.2);
    this.noise(0.16, 0.5 * p, 900 + 300 * p);
    this.tone(140 - 20 * p, 0.18, 'square', 0.28 * p, null, 60);
  }

  clang() { this.tone(880, 0.16, 'square', 0.2, null, 500); this.tone(1320, 0.12, 'triangle', 0.12); this.noise(0.06, 0.2, 4000); }

  jump() { this.tone(300, 0.16, 'sine', 0.2, null, 620); }

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

  /* ---- Simple looping music bed (arpeggio + bass) ---- */
  startMusic() {
    if (!this.enabled || !this.ctx || this._musicTimer) return;
    const scale = [220, 261.63, 293.66, 329.63, 392, 440, 523.25];
    const bass = [55, 55, 82.4, 65.4];
    this._musicStep = 0;
    const stepTime = 0.22;
    const loop = () => {
      if (!this.musicEnabled) return;
      const s = this._musicStep;
      const note = scale[(s * 2) % scale.length];
      this.tone(note, 0.2, 'triangle', 0.10, this.musicGain);
      if (s % 2 === 0) this.tone(note * 2, 0.14, 'sine', 0.05, this.musicGain);
      if (s % 4 === 0) this.tone(bass[(s / 4) % bass.length | 0], 0.4, 'sawtooth', 0.08, this.musicGain);
      this._musicStep++;
    };
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
