import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Bundles the entire game — world generation, economy, NPC merchants, renderer
 * and UI — into one self-contained HTML file that runs offline from the local
 * filesystem. No server, no network, no external assets.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'dist', 'empire-of-merchants.html');

const result = await build({
  entryPoints: [path.join(root, 'client/standalone/main.ts')],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  minify: true,
  write: false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
});

const script = result.outputFiles[0].text;
const css = await readFile(path.join(root, 'client/style.css'), 'utf8');
const template = await readFile(path.join(root, 'client/index.html'), 'utf8');

// Strip the external <link>/<script> tags and inline their contents instead.
const body = template
  .replace(/<link rel="stylesheet"[^>]*>\s*/, '')
  .replace(/<script type="module"[^>]*><\/script>\s*/, '')
  .replace(/<\/head>/, `<style>\n${css}\n</style>\n</head>`)
  .replace(
    /<\/body>/,
    // Escaping the closing-tag sequence keeps a literal "</script>" inside the
    // bundle from ending the script element early.
    `<script>\n${script.replace(/<\/script>/gi, '<\\/script>')}\n</script>\n</body>`,
  )
  .replace(
    /<title>.*?<\/title>/,
    '<title>Empire of Merchants — إمبراطورية التجار</title>',
  );

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, body, 'utf8');

const kb = (Buffer.byteLength(body, 'utf8') / 1024).toFixed(0);
console.log(`[standalone] ${path.relative(root, outFile)}  (${kb} KB, self-contained)`);
