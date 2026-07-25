// Ensures the Arabic TTF fonts libass needs are present in assets/fonts.
// The fonts are committed to the repo, so normally this just confirms them.
// If they are missing, it regenerates them from the @fontsource woff2 files
// (dev dependency) using fonttools if available.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fontsDir = path.join(root, 'assets', 'fonts');
const required = ['Amiri-Arabic-Bold.ttf', 'Amiri-Arabic.ttf', 'Cairo-Arabic.ttf', 'Cairo-Arabic-Regular.ttf'];

fs.mkdirSync(fontsDir, { recursive: true });
const missing = required.filter((f) => !fs.existsSync(path.join(fontsDir, f)));

if (!missing.length) {
  console.log('✓ Arabic fonts present:', required.join(', '));
  process.exit(0);
}

console.log('! Missing fonts:', missing.join(', '));
console.log('  Attempting to regenerate from @fontsource woff2 via fonttools…');

const jobs = [
  ['node_modules/@fontsource/cairo/files/cairo-arabic-600-normal.woff2', 'assets/fonts/Cairo-Arabic.ttf'],
  ['node_modules/@fontsource/cairo/files/cairo-arabic-400-normal.woff2', 'assets/fonts/Cairo-Arabic-Regular.ttf'],
  ['node_modules/@fontsource/amiri/files/amiri-arabic-700-normal.woff2', 'assets/fonts/Amiri-Arabic-Bold.ttf'],
  ['node_modules/@fontsource/amiri/files/amiri-arabic-400-normal.woff2', 'assets/fonts/Amiri-Arabic.ttf'],
];

const py = jobs
  .map(([src, dst]) => `f=TTFont(${JSON.stringify(path.join(root, src))});f.flavor=None;f.save(${JSON.stringify(path.join(root, dst))})`)
  .join('\n');

try {
  execFileSync('python3', ['-c', `from fontTools.ttLib import TTFont\n${py}`], { stdio: 'inherit' });
  console.log('✓ Fonts regenerated.');
} catch (e) {
  console.error('✗ Could not regenerate fonts automatically.');
  console.error('  Install the dev deps and fonttools, then re-run:');
  console.error('    npm install && pip install fonttools brotli && npm run setup');
  process.exit(1);
}
