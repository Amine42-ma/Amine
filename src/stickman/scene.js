// Stickman scene backdrops and figure drawing. Backdrops are mood-driven
// (sky, ground, sun/moon, mountains/city/hills, stars) and are drawn once per
// shot; figures and weather are drawn per frame on a copy.

import { Frame, rgb, mix, clamp } from '../render/raster.js';
import { resolveMood } from '../util/palette.js';

const darken = (c, t) => mix(c, [0, 0, 0], t);
const lighten = (c, t) => mix(c, [255, 255, 255], t);

// Which environment suits a mood.
export function settingFor(moodKey) {
  return ({
    epic: 'mountains', noir: 'city', tense: 'city', wonder: 'stars',
    serene: 'hills', hopeful: 'hills', romantic: 'hills', bleak: 'rain',
  })[moodKey] || 'hills';
}

export function buildBackdrop(width, height, moodKey) {
  const mood = resolveMood(moodKey);
  const setting = settingFor(moodKey);
  const f = new Frame(width, height);
  const groundY = Math.round(height * 0.8);

  const sky = rgb(mood.sky);
  const accent = rgb(mood.accent);
  const horizon = lighten(mix(sky, accent, 0.55), 0.05);
  const ground = darken(rgb(mood.ground), 0.15);
  const silo = darken(ground, 0.45);

  // Sky gradient down to the horizon, then ground band.
  f.gradientV(darken(sky, 0.1), horizon);
  f.fillRect(0, groundY, width, height, ground);

  const warm = ['hopeful', 'epic', 'romantic'].includes(moodKey);
  const stars = [];

  if (setting === 'stars') {
    for (let i = 0; i < Math.round(width / 12); i++) {
      const x = Math.random() * width;
      const y = Math.random() * groundY * 0.9;
      const r = Math.random() * 1.4 + 0.6;
      stars.push({ x, y, r, tw: Math.random() * Math.PI * 2 });
      f.fillCircle(x, y, r, [235, 240, 255], 0.8);
    }
  }

  // Sun or moon.
  const orbX = width * (warm ? 0.74 : 0.26);
  const orbY = height * 0.24;
  const orbR = height * (warm ? 0.075 : 0.06);
  const orbCol = warm ? lighten(accent, 0.35) : [225, 230, 240];
  for (let g = 6; g >= 1; g--) f.fillCircle(orbX, orbY, orbR * (1 + g * 0.5), orbCol, 0.04);
  f.fillCircle(orbX, orbY, orbR, orbCol, 0.95);
  if (!warm && setting !== 'stars') {
    f.fillCircle(orbX + orbR * 0.35, orbY - orbR * 0.25, orbR * 0.9, mix(orbCol, sky, 0.5), 0.5); // crescent
  }

  // Background silhouettes.
  if (setting === 'mountains') {
    for (let i = 0; i < 5; i++) {
      const bx = (i / 4) * width;
      const bw = width * 0.34;
      const bh = height * (0.28 + 0.14 * Math.random());
      f.fillPolygon([[bx - bw, groundY], [bx, groundY - bh], [bx + bw, groundY]], darken(silo, i % 2 ? 0.1 : 0));
    }
  } else if (setting === 'city') {
    let x = -20;
    while (x < width) {
      const bw = 40 + Math.random() * 90;
      const bh = height * (0.12 + Math.random() * 0.34);
      const col = darken(silo, Math.random() * 0.2);
      f.fillRect(x, groundY - bh, x + bw, groundY, col);
      for (let wy = groundY - bh + 12; wy < groundY - 10; wy += 22) {
        for (let wx = x + 8; wx < x + bw - 8; wx += 18) {
          if (Math.random() > 0.45) f.fillRect(wx, wy, wx + 7, wy + 10, lighten(accent, 0.3), 0.7);
        }
      }
      x += bw + 6;
    }
  } else if (setting === 'hills' || setting === 'rain') {
    for (let i = 0; i < 3; i++) {
      const hy = groundY - height * (0.06 + i * 0.03);
      const amp = height * 0.05;
      const pts = [[0, groundY]];
      for (let x = 0; x <= width; x += 40) pts.push([x, hy + Math.sin(x / 120 + i) * amp]);
      pts.push([width, groundY]);
      f.fillPolygon(pts, darken(silo, 0.15 - i * 0.05));
    }
  }

  // Horizon glow line.
  f.fillRect(0, groundY - 1, width, groundY + 1, lighten(horizon, 0.1), 0.35);

  return { frame: f, groundY, setting, rain: setting === 'rain', stars, mood: moodKey };
}

// Draw a posed skeleton at world origin (ox, oy) with a uniform scale.
export function drawFigure(frame, skel, ox, oy, scale, color, alpha = 1) {
  for (const [p, q, t] of skel.bones) {
    frame.capsule(ox + p.x * scale, oy + p.y * scale, ox + q.x * scale, oy + q.y * scale, Math.max(2, t * scale), color, alpha);
  }
  frame.fillCircle(ox + skel.head.x * scale, oy + skel.head.y * scale, skel.head.r * scale, color, alpha);
}

// Lowest local Y in the skeleton, so feet can be planted on the ground.
export function skeletonMaxY(skel) {
  let m = -Infinity;
  for (const [p, q] of skel.bones) m = Math.max(m, p.y, q.y);
  return m;
}

// Dynamic weather / twinkle overlays drawn per frame.
export function drawRain(frame, t, groundY) {
  const n = Math.round(frame.w / 6);
  const col = [180, 200, 220];
  for (let i = 0; i < n; i++) {
    const seed = i * 97.13;
    const x = (seed * 13 + t * 900) % frame.w;
    const y = ((seed * 57 + t * 1400) % (groundY + 40));
    frame.capsule(x, y, x - 4, y + 16, 1.6, col, 0.28);
  }
}

export function drawStars(frame, stars, t) {
  for (const s of stars) {
    const a = 0.5 + 0.5 * Math.sin(t * 2 + s.tw);
    frame.fillCircle(s.x, s.y, s.r, [235, 240, 255], a * 0.8);
  }
}
