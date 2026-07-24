/* =========================================================================
 * maps.js — Arena definitions
 * Each arena provides a background palette, a set of solid platforms, spawn
 * points for both fighters, and optional hazards (lava / spikes / void).
 * Coordinates are in world units on a 1600 x 900 stage.
 * ========================================================================= */
'use strict';

const STAGE_W = 1600;
const STAGE_H = 900;

const MAPS = [
  {
    id: 'temple', name: 'المعبد • Temple',
    sky: ['#2b1a4a', '#4a2c6b', '#7a3d7a'],
    accent: '#ffb703', theme: 'temple',
    platforms: [
      { x: 120, y: 640, w: 620, h: 40 },
      { x: 860, y: 640, w: 620, h: 40 },
      { x: 500, y: 420, w: 600, h: 34 },
      { x: 180, y: 300, w: 220, h: 28 },
      { x: 1200, y: 300, w: 220, h: 28 },
    ],
    spawns: [{ x: 320, y: 560 }, { x: 1280, y: 560 }],
    hazard: { type: 'void', y: 1050 },
  },
  {
    id: 'sky', name: 'الجزر الطائرة • Sky Isles',
    sky: ['#0a4a7a', '#2a86c9', '#8fd7ff'],
    accent: '#8ce0ff', theme: 'sky',
    platforms: [
      { x: 200, y: 700, w: 360, h: 40 },
      { x: 1040, y: 700, w: 360, h: 40 },
      { x: 620, y: 560, w: 360, h: 34 },
      { x: 120, y: 430, w: 200, h: 28 },
      { x: 1280, y: 430, w: 200, h: 28 },
      { x: 700, y: 300, w: 200, h: 26 },
    ],
    spawns: [{ x: 360, y: 620 }, { x: 1240, y: 620 }],
    hazard: { type: 'void', y: 1050 },
  },
  {
    id: 'lava', name: 'كهف الحمم • Lava Cave',
    sky: ['#1a0808', '#3a0f0a', '#6b1a0e'],
    accent: '#ff5a1f', theme: 'lava',
    platforms: [
      { x: 100, y: 600, w: 420, h: 40 },
      { x: 1080, y: 600, w: 420, h: 40 },
      { x: 560, y: 470, w: 480, h: 34 },
      { x: 300, y: 340, w: 200, h: 26 },
      { x: 1100, y: 340, w: 200, h: 26 },
    ],
    spawns: [{ x: 300, y: 520 }, { x: 1300, y: 520 }],
    hazard: { type: 'lava', y: 820, dps: 0.6 },
  },
  {
    id: 'dojo', name: 'الدوجو • Dojo',
    sky: ['#14232e', '#1f3a4a', '#356073'],
    accent: '#ff4d6d', theme: 'dojo',
    platforms: [
      { x: 80, y: 660, w: 1440, h: 46 },   // full floor
      { x: 340, y: 470, w: 260, h: 30 },
      { x: 1000, y: 470, w: 260, h: 30 },
      { x: 660, y: 330, w: 280, h: 28 },
    ],
    spawns: [{ x: 320, y: 580 }, { x: 1280, y: 580 }],
    hazard: null,
  },
  {
    id: 'towers', name: 'الأبراج • Towers',
    sky: ['#101024', '#1c1c46', '#3a2a6b'],
    accent: '#c77dff', theme: 'towers',
    platforms: [
      { x: 120, y: 720, w: 240, h: 180 },
      { x: 500, y: 600, w: 200, h: 300 },
      { x: 900, y: 600, w: 200, h: 300 },
      { x: 1240, y: 720, w: 240, h: 180 },
      { x: 680, y: 400, w: 240, h: 28 },
    ],
    spawns: [{ x: 220, y: 640 }, { x: 1360, y: 640 }],
    hazard: { type: 'void', y: 1050 },
  },
];

const MAPS_BY_ID = Object.fromEntries(MAPS.map((m) => [m.id, m]));
function getMap(id) { return MAPS_BY_ID[id] || MAPS[0]; }
