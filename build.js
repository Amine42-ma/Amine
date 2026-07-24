#!/usr/bin/env node
/* =========================================================================
 * build.js — Bundle the modular game into ONE self-contained HTML file.
 * Inlines css/style.css and every js/*.js into index.html and writes
 * dist/stickman-duel.html — a single file you can open or share directly.
 *
 * Note: online play still loads the Trystero P2P library from a CDN at
 * runtime (that part inherently needs the internet), everything else is
 * fully embedded and works offline.
 *
 * Usage:  node build.js
 * ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const readFile = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let html = readFile('index.html');

// 1) Inline the stylesheet
const css = readFile('css/style.css');
html = html.replace(
  /<link rel="stylesheet" href="css\/style\.css"\s*\/?>/,
  `<style>\n${css}\n</style>`
);

// 2) Inline every local script, preserving order and separate scopes
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (m, src) => {
  const code = readFile(src);
  return `<script>\n${code}\n</script>`;
});

// 3) Add a small build banner comment
const banner = `<!-- Stickman Duel — single-file build (${new Date().toISOString().slice(0, 10)}). ` +
  `Self-contained; online play loads a P2P library from a CDN at runtime. -->\n`;
html = html.replace(/<!DOCTYPE html>/i, `<!DOCTYPE html>\n${banner}`);

const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'stickman-duel.html');
fs.writeFileSync(outFile, html, 'utf8');

const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
console.log(`✔ Built ${path.relative(ROOT, outFile)} (${kb} KB)`);

// Sanity checks
const problems = [];
if (/<link rel="stylesheet"/.test(html)) problems.push('stylesheet link not inlined');
if (/<script src="js\//.test(html)) problems.push('a js script was not inlined');
if (!/class Game/.test(html)) problems.push('game code missing');
if (problems.length) { console.error('✖ ' + problems.join('; ')); process.exit(1); }
console.log('✔ All CSS and JS inlined, no external local references remain.');
