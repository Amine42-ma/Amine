/* =========================================================================
 * maps.js — Arena definitions
 * Each arena provides layered sky colours, a set of solid platforms (with a
 * visual style), spawn points, an accent colour, decoration hints and an
 * optional hazard. Rendering (parallax + themed decor) lives in game.js.
 * Coordinates are in world units on a 1600 x 900 stage.
 * ========================================================================= */
'use strict';

const STAGE_W = 1600;
const STAGE_H = 900;

const MAPS = [
  {
    id: 'temple', name: 'المعبد • Temple',
    sky: ['#241146', '#4a2c6b', '#8a3d7a'], accent: '#ffb703', theme: 'temple',
    platformStyle: 'stone',
    platforms: [
      { x: 120, y: 640, w: 620, h: 44 },
      { x: 860, y: 640, w: 620, h: 44 },
      { x: 500, y: 420, w: 600, h: 36 },
      { x: 180, y: 300, w: 220, h: 34 },
      { x: 1200, y: 300, w: 220, h: 34 },
    ],
    spawns: [{ x: 320, y: 560 }, { x: 1280, y: 560 }],
    hazard: { type: 'void', y: 1050 },
    decor: { pillars: true, torches: true, portal: true },
  },
  {
    id: 'sky', name: 'الجزر الطائرة • Sky Isles',
    sky: ['#0a3a6a', '#2a86c9', '#9fdcff'], accent: '#8ce0ff', theme: 'sky',
    platformStyle: 'cloud',
    platforms: [
      { x: 200, y: 700, w: 360, h: 40 },
      { x: 1040, y: 700, w: 360, h: 40 },
      { x: 620, y: 560, w: 360, h: 36 },
      { x: 120, y: 430, w: 200, h: 34 },
      { x: 1280, y: 430, w: 200, h: 34 },
      { x: 700, y: 320, w: 200, h: 32 },
    ],
    spawns: [{ x: 360, y: 620 }, { x: 1240, y: 620 }],
    hazard: { type: 'void', y: 1050 },
    decor: { clouds: true, sun: true, birds: true },
  },
  {
    id: 'lava', name: 'كهف الحمم • Lava Cave',
    sky: ['#1a0808', '#3a0f0a', '#7a1e0e'], accent: '#ff5a1f', theme: 'lava',
    platformStyle: 'obsidian',
    platforms: [
      { x: 100, y: 600, w: 420, h: 44 },
      { x: 1080, y: 600, w: 420, h: 44 },
      { x: 560, y: 470, w: 480, h: 36 },
      { x: 300, y: 340, w: 200, h: 32 },
      { x: 1100, y: 340, w: 200, h: 32 },
    ],
    spawns: [{ x: 300, y: 520 }, { x: 1300, y: 520 }],
    hazard: { type: 'lava', y: 820, dps: 0.7 },
    decor: { stalactites: true, embers: true, glow: true },
  },
  {
    id: 'dojo', name: 'الدوجو • Dojo',
    sky: ['#14232e', '#1f3a4a', '#3a6073'], accent: '#ff4d6d', theme: 'dojo',
    platformStyle: 'wood',
    platforms: [
      { x: 80, y: 660, w: 1440, h: 48 },
      { x: 340, y: 470, w: 260, h: 32 },
      { x: 1000, y: 470, w: 260, h: 32 },
      { x: 660, y: 330, w: 280, h: 30 },
    ],
    spawns: [{ x: 320, y: 580 }, { x: 1280, y: 580 }],
    hazard: null,
    decor: { lanterns: true, banners: true, moon: true, mountains: true },
  },
  {
    id: 'towers', name: 'الأبراج • Night Towers',
    sky: ['#0a0a1e', '#1c1c46', '#3a2a6b'], accent: '#c77dff', theme: 'towers',
    platformStyle: 'brick',
    platforms: [
      { x: 120, y: 720, w: 240, h: 180 },
      { x: 500, y: 600, w: 200, h: 300 },
      { x: 900, y: 600, w: 200, h: 300 },
      { x: 1240, y: 720, w: 240, h: 180 },
      { x: 680, y: 400, w: 240, h: 30 },
    ],
    spawns: [{ x: 220, y: 640 }, { x: 1360, y: 640 }],
    hazard: { type: 'void', y: 1050 },
    decor: { city: true, moon: true, stars: true, rain: true },
  },
  {
    id: 'arena', name: 'حلبة الأبطال • Grand Arena',
    sky: ['#2a1a0a', '#6b3a1a', '#c98a3a'], accent: '#ffd23f', theme: 'arena',
    platformStyle: 'stone',
    platforms: [
      { x: 120, y: 680, w: 1360, h: 60 },
      { x: 300, y: 520, w: 220, h: 30 },
      { x: 1080, y: 520, w: 220, h: 30 },
      { x: 640, y: 420, w: 320, h: 30 },
    ],
    spawns: [{ x: 360, y: 600 }, { x: 1240, y: 600 }],
    hazard: null,
    decor: { crowd: true, pillars: true, sun: true },
  },
  {
    id: 'space', name: 'محطة الفضاء • Space Station',
    sky: ['#04040f', '#0a0a2a', '#141440'], accent: '#61f0ff', theme: 'space',
    platformStyle: 'tech',
    platforms: [
      { x: 160, y: 700, w: 380, h: 40 },
      { x: 1060, y: 700, w: 380, h: 40 },
      { x: 620, y: 540, w: 360, h: 34 },
      { x: 200, y: 400, w: 220, h: 30 },
      { x: 1180, y: 400, w: 220, h: 30 },
    ],
    spawns: [{ x: 340, y: 620 }, { x: 1260, y: 620 }],
    hazard: { type: 'void', y: 1050 },
    decor: { stars: true, planet: true, grid: true },
  },
];

const MAPS_BY_ID = Object.fromEntries(MAPS.map((m) => [m.id, m]));
function getMap(id) { return MAPS_BY_ID[id] || MAPS[0]; }
