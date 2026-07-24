/* =========================================================================
 * weapons.js — Weapon catalogue and detailed rendering
 * Each weapon defines reach, damage, weight, swing style, a glow/trail colour
 * and a custom draw routine. Weapons are held in the stickman's hand and
 * rotate with the forearm; the "blade" segment is used for hit detection.
 * All art is procedural (gradients, glows, highlights) — no image assets.
 * ========================================================================= */
'use strict';

/* Small drawing helpers shared by weapon renderers */
const WGfx = {
  roundedBlade(ctx, x0, len, halfW, tipLen, grad) {
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x0, -halfW);
    ctx.lineTo(len - tipLen, -halfW);
    ctx.quadraticCurveTo(len, -halfW * 0.6, len, 0);
    ctx.quadraticCurveTo(len, halfW * 0.6, len - tipLen, halfW);
    ctx.lineTo(x0, halfW);
    ctx.closePath();
    ctx.fill();
  },
  edge(ctx, x0, len, y, color, w = 1.4) {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(len - 4, y); ctx.stroke();
  },
  wrap(ctx, x0, x1, base, wrapCol) {
    ctx.strokeStyle = base; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x1, 0); ctx.stroke();
    ctx.strokeStyle = wrapCol; ctx.lineWidth = 2;
    for (let x = x0 + 3; x < x1; x += 5) {
      ctx.beginPath(); ctx.moveTo(x, -4.5); ctx.lineTo(x + 2.5, 4.5); ctx.stroke();
    }
  },
};

const WEAPONS = [
  {
    id: 'sword', name: 'سيف • Sword', reach: 96, damage: 11, weight: 1.0, speed: 1.15,
    bladeFrom: 0.16, color: '#e8f0ff', glow: '#bcd4ff', trail: 'rgba(190,215,255,0.5)',
    draw(ctx, len) {
      const gripLen = len * 0.15;
      // pommel + handle wrap
      ctx.fillStyle = '#d4af37';
      ctx.beginPath(); ctx.arc(-gripLen - 4, 0, 5, 0, Utils.TAU); ctx.fill();
      WGfx.wrap(ctx, -gripLen, -2, '#3a2416', '#5c3a20');
      // cross guard
      const gg = ctx.createLinearGradient(0, -12, 0, 12);
      gg.addColorStop(0, '#f6d976'); gg.addColorStop(0.5, '#d4af37'); gg.addColorStop(1, '#8a6d1e');
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.roundRect(-4, -13, 9, 26, 4); ctx.fill();
      // blade
      const grad = ctx.createLinearGradient(0, -6, 0, 6);
      grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.5, '#cfd9ec'); grad.addColorStop(1, '#8fa1c0');
      WGfx.roundedBlade(ctx, 4, len, 5.5, 16, grad);
      WGfx.edge(ctx, 8, len, 0, 'rgba(255,255,255,0.85)', 1.6);
      // fuller shadow line
      WGfx.edge(ctx, 10, len - 6, -1.6, 'rgba(90,110,140,0.5)', 1);
    },
  },
  {
    id: 'greatsword', name: 'سيف عظيم • Greatsword', reach: 128, damage: 18, weight: 2.1, speed: 0.72,
    bladeFrom: 0.14, color: '#eef2fa', glow: '#9fb6e0', trail: 'rgba(160,190,240,0.45)',
    draw(ctx, len) {
      WGfx.wrap(ctx, -22, -2, '#241a12', '#4a3320');
      ctx.fillStyle = '#c0c6d1';
      ctx.beginPath(); ctx.roundRect(-6, -16, 11, 32, 5); ctx.fill();
      ctx.fillStyle = '#8a94a6';
      ctx.beginPath(); ctx.arc(-24, 0, 6, 0, Utils.TAU); ctx.fill();
      const grad = ctx.createLinearGradient(0, -9, 0, 9);
      grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.5, '#c4cede'); grad.addColorStop(1, '#7e8da6');
      WGfx.roundedBlade(ctx, 5, len, 9, 26, grad);
      WGfx.edge(ctx, 10, len, 0, 'rgba(255,255,255,0.8)', 2);
    },
  },
  {
    id: 'chainsaw', name: 'منشار • Chainsaw', reach: 104, damage: 8, weight: 1.4, speed: 0.95,
    bladeFrom: 0.24, color: '#ff7a1f', glow: '#ff9a3a', trail: 'rgba(255,140,40,0.4)',
    continuous: true, dps: 0.95,
    draw(ctx, len, thick, hurt, time = 0) {
      // engine body
      const bg = ctx.createLinearGradient(0, -12, 0, 12);
      bg.addColorStop(0, '#ff8a2a'); bg.addColorStop(1, '#c9500a');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.roundRect(-16, -12, 34, 24, 7); ctx.fill();
      ctx.fillStyle = '#2b2b30';
      ctx.beginPath(); ctx.roundRect(-11, -8, 15, 16, 4); ctx.fill();
      ctx.fillStyle = '#cfd2da';
      ctx.beginPath(); ctx.arc(-4, 0, 4, 0, Utils.TAU); ctx.fill();
      // guide bar
      const bar = len - 10;
      const barGrad = ctx.createLinearGradient(0, -6, 0, 6);
      barGrad.addColorStop(0, '#e9ecf2'); barGrad.addColorStop(1, '#aab0bd');
      ctx.fillStyle = barGrad;
      ctx.beginPath();
      ctx.moveTo(16, -7); ctx.lineTo(bar, -5); ctx.arc(bar, 0, 5, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(16, 7); ctx.closePath(); ctx.fill();
      // moving teeth (animated)
      ctx.fillStyle = hurt ? '#fff2c0' : '#6a6d76';
      const teeth = 14;
      for (let i = 0; i < teeth; i++) {
        const t = ((i / teeth) + (time * 0.5 % 1)) % 1;
        const x = 16 + t * (bar - 16);
        ctx.beginPath(); ctx.moveTo(x, -10); ctx.lineTo(x + 4, -13); ctx.lineTo(x + 6, -10); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x, 10); ctx.lineTo(x + 4, 13); ctx.lineTo(x + 6, 10); ctx.closePath(); ctx.fill();
      }
    },
  },
  {
    id: 'staff', name: 'عصا • Staff', reach: 120, damage: 9, weight: 1.1, speed: 1.05,
    bladeFrom: 0.0, color: '#a4522a', glow: '#f2c14e', trail: 'rgba(242,193,78,0.4)',
    draw(ctx, len) {
      const grad = ctx.createLinearGradient(0, -4, 0, 4);
      grad.addColorStop(0, '#c26a34'); grad.addColorStop(1, '#6b2c14');
      ctx.strokeStyle = grad; ctx.lineWidth = 8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(len - 8, 0); ctx.stroke();
      // gold caps with gem
      for (const cx of [-18, len - 4]) {
        const cg = ctx.createRadialGradient(cx - 2, -2, 1, cx, 0, 9);
        cg.addColorStop(0, '#ffe9a8'); cg.addColorStop(1, '#c9971f');
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.arc(cx, 0, 8, 0, Utils.TAU); ctx.fill();
      }
      ctx.fillStyle = '#6be0ff';
      ctx.beginPath(); ctx.arc(len - 4, 0, 3, 0, Utils.TAU); ctx.fill();
    },
  },
  {
    id: 'hammer', name: 'مطرقة • Hammer', reach: 100, damage: 16, weight: 1.9, speed: 0.78,
    bladeFrom: 0.72, color: '#9aa0ad', glow: '#c9cdd6', trail: 'rgba(180,185,195,0.4)',
    draw(ctx, len) {
      WGfx.wrap(ctx, -16, len - 20, '#3a2416', '#5c3a20');
      const hg = ctx.createLinearGradient(len - 26, -22, len, 22);
      hg.addColorStop(0, '#e2e6ee'); hg.addColorStop(0.5, '#aab0bd'); hg.addColorStop(1, '#6a707d');
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.roundRect(len - 26, -22, 30, 44, 6); ctx.fill();
      // rivets + highlight
      ctx.fillStyle = '#4a4f59';
      for (const ry of [-14, 0, 14]) { ctx.beginPath(); ctx.arc(len - 20, ry, 2.2, 0, Utils.TAU); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.roundRect(len - 22, -18, 6, 36, 3); ctx.fill();
    },
  },
  {
    id: 'mace', name: 'كرة شوكية • Flail', reach: 96, damage: 15, weight: 1.8, speed: 0.82,
    bladeFrom: 0.7, color: '#9aa0ad', glow: '#d0d5de', trail: 'rgba(180,185,195,0.4)',
    draw(ctx, len) {
      // chain
      ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(len - 20, 0); ctx.stroke();
      ctx.strokeStyle = '#9aa0ad'; ctx.lineWidth = 3;
      for (let x = len - 44; x < len - 20; x += 7) {
        ctx.beginPath(); ctx.arc(x, 0, 3.5, 0, Utils.TAU); ctx.stroke();
      }
      // spiked ball
      const bx = len - 8;
      const bg = ctx.createRadialGradient(bx - 4, -4, 2, bx, 0, 16);
      bg.addColorStop(0, '#c9cdd6'); bg.addColorStop(1, '#565b66');
      ctx.fillStyle = '#8a909c';
      for (let a = 0; a < Utils.TAU; a += Utils.TAU / 8) {
        ctx.beginPath();
        ctx.moveTo(bx + Math.cos(a - 0.2) * 9, Math.sin(a - 0.2) * 9);
        ctx.lineTo(bx + Math.cos(a) * 18, Math.sin(a) * 18);
        ctx.lineTo(bx + Math.cos(a + 0.2) * 9, Math.sin(a + 0.2) * 9);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(bx, 0, 11, 0, Utils.TAU); ctx.fill();
    },
  },
  {
    id: 'spear', name: 'رمح • Spear', reach: 148, damage: 12, weight: 1.2, speed: 1.0,
    bladeFrom: 0.82, color: '#d9dee8', glow: '#e6ebf4', trail: 'rgba(210,220,235,0.4)',
    draw(ctx, len) {
      const sg = ctx.createLinearGradient(0, -3, 0, 3);
      sg.addColorStop(0, '#9a5f30'); sg.addColorStop(1, '#5f3a1c');
      ctx.strokeStyle = sg; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(len - 22, 0); ctx.stroke();
      ctx.fillStyle = '#c9971f';
      ctx.beginPath(); ctx.roundRect(len - 26, -4, 8, 8, 2); ctx.fill();
      const grad = ctx.createLinearGradient(0, -7, 0, 7);
      grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.5, '#c9d3e2'); grad.addColorStop(1, '#8894a8');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(len - 22, -8); ctx.lineTo(len, 0); ctx.lineTo(len - 22, 8);
      ctx.lineTo(len - 15, 0); ctx.closePath(); ctx.fill();
    },
  },
  {
    id: 'trident', name: 'رمح ثلاثي • Trident', reach: 140, damage: 13, weight: 1.4, speed: 0.94,
    bladeFrom: 0.8, color: '#8ce0ff', glow: '#8ce0ff', trail: 'rgba(140,224,255,0.4)',
    draw(ctx, len) {
      const sg = ctx.createLinearGradient(0, -3, 0, 3);
      sg.addColorStop(0, '#2aa9c9'); sg.addColorStop(1, '#12657a');
      ctx.strokeStyle = sg; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(len - 18, 0); ctx.stroke();
      ctx.strokeStyle = '#cfeeff'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      // three prongs
      const b = len - 18;
      ctx.beginPath(); ctx.moveTo(b, 0); ctx.lineTo(len, 0); ctx.stroke();
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(b, s * 8); ctx.lineTo(len - 4, s * 10); ctx.lineTo(len, s * 4);
        ctx.stroke();
      }
    },
  },
  {
    id: 'axe', name: 'فأس • Axe', reach: 98, damage: 15, weight: 1.7, speed: 0.85,
    bladeFrom: 0.66, color: '#c0c6d1', glow: '#d6dbe4', trail: 'rgba(190,200,215,0.4)',
    draw(ctx, len) {
      WGfx.wrap(ctx, -14, len - 6, '#3a2416', '#5c3a20');
      const grad = ctx.createLinearGradient(len - 28, 0, len + 4, 0);
      grad.addColorStop(0, '#f2f5fa'); grad.addColorStop(1, '#7c8492');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(len - 28, -7);
      ctx.quadraticCurveTo(len + 8, -26, len + 3, -2);
      ctx.quadraticCurveTo(len + 8, 26, len - 28, 7);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(len - 4, -20); ctx.quadraticCurveTo(len + 6, 0, len - 4, 20); ctx.stroke();
    },
  },
  {
    id: 'scythe', name: 'منجل • Scythe', reach: 132, damage: 14, weight: 1.5, speed: 0.9,
    bladeFrom: 0.6, color: '#dfe7f5', glow: '#b7f5c9', trail: 'rgba(150,240,180,0.4)',
    draw(ctx, len) {
      const sg = ctx.createLinearGradient(0, -3, 0, 3);
      sg.addColorStop(0, '#2a2a33'); sg.addColorStop(1, '#111117');
      ctx.strokeStyle = sg; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(len - 6, 0); ctx.stroke();
      // curved blade at the tip
      ctx.strokeStyle = '#e9f5ee'; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(len - 6, 0);
      ctx.quadraticCurveTo(len + 6, -26, len - 30, -40);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(150,255,190,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(len - 6, -2);
      ctx.quadraticCurveTo(len + 4, -26, len - 30, -40);
      ctx.stroke();
    },
  },
  {
    id: 'katana', name: 'كاتانا • Katana', reach: 112, damage: 12, weight: 0.9, speed: 1.3,
    bladeFrom: 0.14, color: '#eef3fb', glow: '#9fe0ff', trail: 'rgba(140,200,255,0.5)',
    draw(ctx, len) {
      WGfx.wrap(ctx, -22, -2, '#1c1c22', '#c0392b');
      ctx.fillStyle = '#2a2a33';
      ctx.beginPath(); ctx.arc(2, 0, 7, 0, Utils.TAU); ctx.fill();
      ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(2, 0, 7, 0, Utils.TAU); ctx.stroke();
      // curved blade
      const bg = ctx.createLinearGradient(0, -6, 0, 4);
      bg.addColorStop(0, '#ffffff'); bg.addColorStop(1, '#c6d6ee');
      ctx.strokeStyle = bg; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(6, 0); ctx.quadraticCurveTo(len * 0.6, -8, len, -16); ctx.stroke();
      ctx.strokeStyle = 'rgba(150,210,255,0.75)'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(6, -1.5); ctx.quadraticCurveTo(len * 0.6, -9.5, len, -17); ctx.stroke();
    },
  },
  {
    id: 'lightsaber', name: 'سيف طاقة • Energy Blade', reach: 116, damage: 13, weight: 0.7, speed: 1.35,
    bladeFrom: 0.14, color: '#61f0ff', glow: '#61f0ff', trail: 'rgba(97,240,255,0.6)', energy: true,
    draw(ctx, len, thick, hurt, time = 0) {
      // hilt
      const hg = ctx.createLinearGradient(-16, 0, 4, 0);
      hg.addColorStop(0, '#7a808c'); hg.addColorStop(1, '#c9cdd6');
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.roundRect(-16, -4.5, 22, 9, 3); ctx.fill();
      ctx.fillStyle = '#e11d48';
      ctx.beginPath(); ctx.arc(-8, 0, 2, 0, Utils.TAU); ctx.fill();
      // energy blade with glow
      const pulse = 1 + Math.sin(time * 0.6) * 0.06;
      ctx.save();
      ctx.shadowBlur = 18; ctx.shadowColor = '#61f0ff';
      ctx.strokeStyle = 'rgba(97,240,255,0.55)'; ctx.lineWidth = 12 * pulse; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(len, 0); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#eafcff'; ctx.lineWidth = 4.5 * pulse;
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(len, 0); ctx.stroke();
      ctx.restore();
    },
  },
  {
    id: 'daggers', name: 'خنجران • Daggers', reach: 66, damage: 7, weight: 0.6, speed: 1.65,
    bladeFrom: 0.3, color: '#dfe7f5', glow: '#cfe0ff', trail: 'rgba(200,220,255,0.4)', fast: true,
    draw(ctx, len) {
      WGfx.wrap(ctx, -12, 0, '#2a1a10', '#4a3320');
      ctx.fillStyle = '#8a6d1e';
      ctx.beginPath(); ctx.roundRect(-2, -7, 5, 14, 2); ctx.fill();
      const grad = ctx.createLinearGradient(0, -4, 0, 4);
      grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#9fb3d0');
      WGfx.roundedBlade(ctx, 3, len, 4, 10, grad);
      WGfx.edge(ctx, 6, len, 0, 'rgba(255,255,255,0.8)', 1.2);
    },
  },
  {
    id: 'bat', name: 'مضرب مسامير • Nail Bat', reach: 100, damage: 12, weight: 1.5, speed: 0.95,
    bladeFrom: 0.5, color: '#b5763a', glow: '#d0925a', trail: 'rgba(200,140,80,0.4)',
    draw(ctx, len) {
      const bg = ctx.createLinearGradient(0, -6, 0, 6);
      bg.addColorStop(0, '#c98a4a'); bg.addColorStop(1, '#7a4a24');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(-14, -3); ctx.lineTo(len - 6, -9);
      ctx.quadraticCurveTo(len + 2, 0, len - 6, 9);
      ctx.lineTo(-14, 3); ctx.closePath(); ctx.fill();
      // nails
      ctx.fillStyle = '#cfd2da';
      for (let i = 0; i < 5; i++) {
        const x = len * 0.5 + i * ((len * 0.45) / 5);
        for (const s of [-1, 1]) {
          const y = s * (6 + i * 0.4);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 3, y + s * 6); ctx.lineTo(x + 5, y); ctx.closePath(); ctx.fill();
        }
      }
    },
  },
];

const WEAPONS_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));
function getWeapon(id) { return WEAPONS_BY_ID[id] || WEAPONS[0]; }
