/* =========================================================================
 * particles.js — Lightweight particle system for visual juice
 * Blood splatter, weapon sparks, dust clouds, floating damage numbers,
 * and celebratory confetti. Purely visual, no gameplay effect.
 * ========================================================================= */
'use strict';

class ParticleSystem {
  constructor() {
    this.particles = [];
    this.texts = [];
  }

  clear() { this.particles.length = 0; this.texts.length = 0; }

  spawn(opts) {
    this.particles.push(Object.assign({
      x: 0, y: 0, vx: 0, vy: 0, life: 1, maxLife: 1,
      size: 4, color: '#fff', gravity: 0.2, shrink: true, drag: 0.98,
      shape: 'circle', rot: 0, spin: 0, glow: false,
    }, opts));
  }

  /** Blood burst from an impact point */
  blood(x, y, dir = 0, amount = 14, color = '#e02b3c') {
    for (let i = 0; i < amount; i++) {
      const a = dir + Utils.rand(-1, 1);
      const sp = Utils.rand(2, 9);
      this.spawn({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1,
        life: Utils.rand(24, 46), maxLife: 46,
        size: Utils.rand(2.5, 6), color, gravity: 0.35, drag: 0.97,
      });
    }
  }

  /** Metallic sparks when weapons clash */
  sparks(x, y, amount = 10) {
    for (let i = 0; i < amount; i++) {
      const a = Utils.rand(0, Utils.TAU);
      const sp = Utils.rand(3, 8);
      this.spawn({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: Utils.rand(10, 22), maxLife: 22,
        size: Utils.rand(1.5, 3.5), color: Utils.pick(['#fff6c0', '#ffd23f', '#ff8a00']),
        gravity: 0.1, drag: 0.9, glow: true,
      });
    }
  }

  /** Dust puff (landing, running) */
  dust(x, y, dir = 0, amount = 6) {
    for (let i = 0; i < amount; i++) {
      this.spawn({
        x, y, vx: Math.cos(dir) * Utils.rand(0.5, 2) + Utils.rand(-1, 1),
        vy: Utils.rand(-2, -0.3),
        life: Utils.rand(16, 30), maxLife: 30,
        size: Utils.rand(4, 9), color: 'rgba(210,210,225,0.55)',
        gravity: -0.02, drag: 0.92,
      });
    }
  }

  /** Impact ring / shockwave */
  shock(x, y, color = '#ffffff') {
    this.spawn({
      x, y, vx: 0, vy: 0, life: 16, maxLife: 16, size: 6,
      color, gravity: 0, shape: 'ring', shrink: false, glow: true,
    });
  }

  confetti(x, y) {
    const colors = ['#ff4d6d', '#ffd23f', '#4dd4ff', '#6bff8e', '#c77dff', '#ff8a00'];
    for (let i = 0; i < 26; i++) {
      const a = Utils.rand(-Math.PI * 0.85, -Math.PI * 0.15);
      const sp = Utils.rand(6, 15);
      this.spawn({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: Utils.rand(50, 90), maxLife: 90,
        size: Utils.rand(4, 8), color: Utils.pick(colors),
        gravity: 0.28, drag: 0.99, shape: 'rect',
        rot: Utils.rand(0, Utils.TAU), spin: Utils.rand(-0.3, 0.3),
      });
    }
  }

  /** Floating damage number */
  damageText(x, y, value, color = '#fff') {
    this.texts.push({
      x, y, vy: -1.4, life: 44, maxLife: 44,
      text: Math.round(value).toString(), color, size: 26 + Math.min(20, value),
    });
  }

  update() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.vx *= p.drag; p.vy *= p.drag;
      p.vy += p.gravity;
      p.x += p.vx; p.y += p.vy;
      p.rot += p.spin;
      if (p.shape === 'ring') p.size += 4;
      p.life--;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.y += t.vy; t.vy *= 0.94; t.life--;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
  }

  render(ctx) {
    ctx.save();
    for (const p of this.particles) {
      const alpha = Utils.clamp(p.life / p.maxLife, 0, 1);
      const size = p.shrink ? p.size * alpha : p.size;
      ctx.globalAlpha = alpha;
      if (p.glow) { ctx.shadowBlur = 12; ctx.shadowColor = p.color; }
      else ctx.shadowBlur = 0;
      ctx.fillStyle = p.color;
      if (p.shape === 'ring') {
        ctx.globalAlpha = alpha * 0.7;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3 * alpha + 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Utils.TAU);
        ctx.stroke();
      } else if (p.shape === 'rect') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-size / 2, -size / 2, size, size * 0.6);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Utils.TAU);
        ctx.fill();
      }
    }
    ctx.shadowBlur = 0;
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      const alpha = Utils.clamp(t.life / t.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.font = `900 ${t.size}px Arial, sans-serif`;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();
  }
}
