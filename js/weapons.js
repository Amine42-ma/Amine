/* =========================================================================
 * weapons.js — Weapon catalogue and rendering
 * Each weapon defines its reach, damage, weight, swing style and a custom
 * draw routine. Weapons are held in the stickman's hand and rotate with the
 * forearm; the "blade" segment is used for hit detection.
 * ========================================================================= */
'use strict';

/**
 * Weapon definitions.
 *  id        unique key
 *  name      display name (Arabic + English)
 *  reach     length from grip to tip (px)
 *  damage    base damage per solid hit
 *  weight    affects swing speed & knockback (1 = light)
 *  speed     swing speed multiplier
 *  bladeFrom fraction along the shaft where the damaging edge begins (0..1)
 *  draw(ctx, len, thick, hurt) renders the weapon along +X from origin (grip)
 */
const WEAPONS = [
  {
    id: 'sword', name: 'سيف • Sword', reach: 92, damage: 11, weight: 1.0, speed: 1.15,
    bladeFrom: 0.18, color: '#dfe7f5',
    draw(ctx, len) {
      const gripLen = len * 0.16;
      // handle
      ctx.strokeStyle = '#5b3a1e'; ctx.lineWidth = 8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-gripLen, 0); ctx.lineTo(0, 0); ctx.stroke();
      // guard
      ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(0, 10); ctx.stroke();
      // blade
      const grad = ctx.createLinearGradient(0, 0, len, 0);
      grad.addColorStop(0, '#f4f8ff'); grad.addColorStop(1, '#9fb3d0');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(2, -5); ctx.lineTo(len - 10, -4);
      ctx.lineTo(len, 0); ctx.lineTo(len - 10, 4); ctx.lineTo(2, 5);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(len - 6, 0); ctx.stroke();
    },
  },
  {
    id: 'chainsaw', name: 'منشار • Chainsaw', reach: 100, damage: 8, weight: 1.4, speed: 0.95,
    bladeFrom: 0.22, color: '#ff6a00', continuous: true, dps: 0.9,
    draw(ctx, len, thick, hurt, time = 0) {
      // body
      ctx.fillStyle = '#e2e2e6';
      ctx.beginPath(); ctx.roundRect(-14, -10, 30, 20, 6); ctx.fill();
      ctx.fillStyle = '#ff6a00';
      ctx.beginPath(); ctx.roundRect(-10, -7, 16, 14, 4); ctx.fill();
      // guide bar
      const bar = len - 12;
      ctx.fillStyle = '#c9ccd6';
      ctx.beginPath();
      ctx.moveTo(14, -7); ctx.lineTo(bar, -4); ctx.arc(bar, 0, 4, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(14, 7); ctx.closePath(); ctx.fill();
      // moving teeth
      ctx.fillStyle = '#8a8d96';
      const teeth = 12;
      for (let i = 0; i < teeth; i++) {
        const t = ((i / teeth) + (time * 0.4 % 1)) % 1;
        const x = 14 + t * (bar - 14);
        ctx.beginPath();
        ctx.moveTo(x, -9); ctx.lineTo(x + 4, -12); ctx.lineTo(x + 6, -9); ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x, 9); ctx.lineTo(x + 4, 12); ctx.lineTo(x + 6, 9); ctx.closePath(); ctx.fill();
      }
    },
  },
  {
    id: 'staff', name: 'عصا • Staff', reach: 118, damage: 9, weight: 1.1, speed: 1.05,
    bladeFrom: 0.0, color: '#8b3a1f',
    draw(ctx, len) {
      const grad = ctx.createLinearGradient(0, 0, len, 0);
      grad.addColorStop(0, '#6b2c14'); grad.addColorStop(1, '#a4522a');
      ctx.strokeStyle = grad; ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(len - 8, 0); ctx.stroke();
      // gold cap
      ctx.fillStyle = '#f2c14e';
      ctx.beginPath(); ctx.arc(len - 4, 0, 8, 0, Utils.TAU); ctx.fill();
      ctx.fillStyle = '#e0a92e';
      ctx.beginPath(); ctx.arc(-16, 0, 6, 0, Utils.TAU); ctx.fill();
    },
  },
  {
    id: 'hammer', name: 'مطرقة • Hammer', reach: 96, damage: 16, weight: 1.9, speed: 0.78,
    bladeFrom: 0.72, color: '#9aa0ad',
    draw(ctx, len) {
      ctx.strokeStyle = '#5b3a1e'; ctx.lineWidth = 8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(len - 18, 0); ctx.stroke();
      const grad = ctx.createLinearGradient(len - 22, -22, len, 22);
      grad.addColorStop(0, '#cfd4dd'); grad.addColorStop(1, '#7c828e');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.roundRect(len - 24, -20, 26, 40, 5); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.roundRect(len - 20, -16, 6, 32, 3); ctx.fill();
    },
  },
  {
    id: 'spear', name: 'رمح • Spear', reach: 140, damage: 12, weight: 1.2, speed: 1.0,
    bladeFrom: 0.82, color: '#d9dee8',
    draw(ctx, len) {
      ctx.strokeStyle = '#7a4a24'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(len - 18, 0); ctx.stroke();
      const grad = ctx.createLinearGradient(len - 20, 0, len, 0);
      grad.addColorStop(0, '#f0f4fb'); grad.addColorStop(1, '#aeb8ca');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(len - 20, -7); ctx.lineTo(len, 0); ctx.lineTo(len - 20, 7);
      ctx.lineTo(len - 14, 0); ctx.closePath(); ctx.fill();
    },
  },
  {
    id: 'axe', name: 'فأس • Axe', reach: 94, damage: 15, weight: 1.7, speed: 0.85,
    bladeFrom: 0.7, color: '#c0c6d1',
    draw(ctx, len) {
      ctx.strokeStyle = '#5b3a1e'; ctx.lineWidth = 8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(len - 6, 0); ctx.stroke();
      const grad = ctx.createLinearGradient(len - 26, 0, len, 0);
      grad.addColorStop(0, '#eef1f6'); grad.addColorStop(1, '#8b93a1');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(len - 26, -6);
      ctx.quadraticCurveTo(len + 4, -24, len + 2, -2);
      ctx.quadraticCurveTo(len + 4, 24, len - 26, 6);
      ctx.closePath(); ctx.fill();
    },
  },
  {
    id: 'katana', name: 'كاتانا • Katana', reach: 108, damage: 12, weight: 0.9, speed: 1.3,
    bladeFrom: 0.16, color: '#e9edf5',
    draw(ctx, len) {
      ctx.strokeStyle = '#1c1c22'; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(0, 0); ctx.stroke();
      ctx.fillStyle = '#2a2a33';
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, Utils.TAU); ctx.fill();
      // curved blade
      ctx.strokeStyle = '#eef3fb'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(4, 0);
      ctx.quadraticCurveTo(len * 0.6, -8, len, -14);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(140,200,255,0.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(4, -1);
      ctx.quadraticCurveTo(len * 0.6, -9, len, -15);
      ctx.stroke();
    },
  },
  {
    id: 'dual', name: 'خنجران • Daggers', reach: 62, damage: 7, weight: 0.6, speed: 1.6,
    bladeFrom: 0.3, color: '#dfe7f5', fast: true,
    draw(ctx, len) {
      ctx.strokeStyle = '#3a2416'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(0, 0); ctx.stroke();
      const grad = ctx.createLinearGradient(0, 0, len, 0);
      grad.addColorStop(0, '#f4f8ff'); grad.addColorStop(1, '#9fb3d0');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, -4); ctx.lineTo(len - 6, -3); ctx.lineTo(len, 0);
      ctx.lineTo(len - 6, 3); ctx.lineTo(0, 4); ctx.closePath(); ctx.fill();
    },
  },
];

const WEAPONS_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));
function getWeapon(id) { return WEAPONS_BY_ID[id] || WEAPONS[0]; }
