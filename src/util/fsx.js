import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function ensureDirSync(dir) {
  fssync.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function writeJSON(file, obj) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(obj, null, 2), 'utf8');
}

export async function readJSON(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

export async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
