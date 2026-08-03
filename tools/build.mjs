#!/usr/bin/env node
// Builds the whole project into ONE self-contained index.html
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');

const result = await esbuild.build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: !dev,
  sourcemap: false,
  legalComments: 'none',
  write: false,
  logLevel: 'info',
});

const js = result.outputFiles[0].text;
const css = fs.readFileSync(path.join(root, 'src/style.css'), 'utf8');

// A tiny loader that fetches the bundled assets next to the file when running
// from the repo (builder mode). The exported game embeds them instead.
const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="theme-color" content="#120b2e">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%91%91%3C/text%3E%3C/svg%3E">
<title>بطل رويال — Royal Builder</title>
</head>
<body>
<style id="royal-css">${css}</style>
<div id="app"></div>
<script id="royal-payload" type="application/json">null</script>
<script id="royal-engine">${js}</script>
</body>
</html>
`;

fs.writeFileSync(path.join(root, 'index.html'), html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`\n→ index.html  ${kb} KB  (js ${(Buffer.byteLength(js) / 1024).toFixed(0)} KB, css ${(Buffer.byteLength(css) / 1024).toFixed(0)} KB)`);
