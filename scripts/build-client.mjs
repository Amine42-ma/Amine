import { build, context } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

/** Static assets are hand-written; only the TS entry point needs bundling. */
async function copyStatic() {
  await mkdir(path.join(root, 'public'), { recursive: true });
  for (const file of ['index.html', 'style.css']) {
    await cp(path.join(root, 'client', file), path.join(root, 'public', file));
  }
}

const options = {
  entryPoints: [path.join(root, 'client/main.ts')],
  outfile: path.join(root, 'public/bundle.js'),
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  minify: !watch,
  sourcemap: true,
  logLevel: 'info',
};

await copyStatic();

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('[client] watching for changes...');
} else {
  await build(options);
  console.log('[client] bundle written to public/bundle.js');
}
