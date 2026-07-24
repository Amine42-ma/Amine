/* =========================================================================
 * input.js — Keyboard + touch input
 * Player 1: WASD + (J attack / K block)   or on-screen touch controls
 * Player 2: Arrow keys + (, attack / . block)
 * Touch: virtual joystick (move) and Jump / Attack / Block buttons.
 * ========================================================================= */
'use strict';

class InputManager {
  constructor() {
    this.keys = new Set();
    this.touch = { move: 0, jump: false, attack: false, block: false, dash: false };
    this._bindKeyboard();
    this._pauseCb = null;
  }

  onPause(cb) { this._pauseCb = cb; }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.keys.add(k);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      if (k === 'Escape' || k === 'p') this._pauseCb && this._pauseCb();
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.keys.delete(k);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Wire up on-screen touch controls (mobile) */
  bindTouch(root) {
    const joyBase = root.querySelector('#joyBase');
    const joyStick = root.querySelector('#joyStick');
    const btnJump = root.querySelector('#btnJump');
    const btnAttack = root.querySelector('#btnAttack');
    const btnBlock = root.querySelector('#btnBlock');
    const btnDash = root.querySelector('#btnDash');
    if (!joyBase) return;
    const vibrate = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

    let joyId = null, cx = 0, cy = 0, radius = 60;

    const startJoy = (id, x, y) => {
      const rect = joyBase.getBoundingClientRect();
      cx = rect.left + rect.width / 2;
      cy = rect.top + rect.height / 2;
      radius = rect.width / 2;
      joyId = id;
      moveJoy(x, y);
    };
    const moveJoy = (x, y) => {
      let dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);
      const clamped = Math.min(d, radius);
      const ang = Math.atan2(dy, dx);
      const sx = Math.cos(ang) * clamped, sy = Math.sin(ang) * clamped;
      joyStick.style.transform = `translate(${sx}px, ${sy}px)`;
      this.touch.move = Utils.clamp(dx / radius, -1, 1);
      if (dy < -radius * 0.5) this.touch.jump = true; else this.touch.jump = false;
    };
    const endJoy = () => {
      joyId = null;
      joyStick.style.transform = 'translate(0,0)';
      this.touch.move = 0; this.touch.jump = false;
    };

    joyBase.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      startJoy(t.identifier, t.clientX, t.clientY);
    }, { passive: false });
    window.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) if (t.identifier === joyId) moveJoy(t.clientX, t.clientY);
    }, { passive: false });
    window.addEventListener('touchend', (e) => {
      for (const t of e.changedTouches) if (t.identifier === joyId) endJoy();
    });
    // Mouse fallback for joystick (desktop testing)
    joyBase.addEventListener('mousedown', (e) => { startJoy('mouse', e.clientX, e.clientY); });
    window.addEventListener('mousemove', (e) => { if (joyId === 'mouse') moveJoy(e.clientX, e.clientY); });
    window.addEventListener('mouseup', () => { if (joyId === 'mouse') endJoy(); });

    const hold = (el, prop, buzz = 10) => {
      if (!el) return;
      const on = (e) => { e.preventDefault(); this.touch[prop] = true; el.classList.add('pressed'); vibrate(buzz); };
      const off = (e) => { e.preventDefault(); this.touch[prop] = false; el.classList.remove('pressed'); };
      el.addEventListener('touchstart', on, { passive: false });
      el.addEventListener('touchend', off, { passive: false });
      el.addEventListener('touchcancel', off, { passive: false });
      el.addEventListener('mousedown', on);
      el.addEventListener('mouseup', off);
      el.addEventListener('mouseleave', off);
    };
    hold(btnJump, 'jump', 8);
    hold(btnAttack, 'attack', 12);
    hold(btnBlock, 'block', 6);
    hold(btnDash, 'dash', 14);
  }

  has(...ks) { return ks.some((k) => this.keys.has(k)); }

  /** Player 1 control state (keyboard OR touch merged) */
  p1() {
    let move = 0;
    if (this.has('a', 'A')) move -= 1;
    if (this.has('d', 'D')) move += 1;
    move += this.touch.move;
    return {
      move: Utils.clamp(move, -1, 1),
      jump: this.has('w', 'W') || this.touch.jump,
      attack: this.has('j', 'J', ' ', 'f', 'F') || this.touch.attack,
      block: this.has('k', 'K', 's', 'S') || this.touch.block,
      dash: this.has('l', 'L', 'q', 'Q') || this.touch.dash,
    };
  }

  /** Player 2 control state (keyboard only) */
  p2() {
    let move = 0;
    if (this.has('ArrowLeft')) move -= 1;
    if (this.has('ArrowRight')) move += 1;
    return {
      move,
      jump: this.has('ArrowUp'),
      attack: this.has('Enter', '.', '0'),
      block: this.has('ArrowDown'),
      dash: this.has('/', 'Shift', ','),
    };
  }
}
