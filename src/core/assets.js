// ============================================================
//  مخزن الأصول — IndexedDB (GLB / صور / أصوات)
//  يعمل في وضعين: المحرر (IndexedDB) والمُصدَّر (ذاكرة من الحمولة)
// ============================================================
import { uid, abToB64, b64ToAb } from './util.js';

const DB_NAME = 'royal-builder';
const DB_VER = 1;
const STORE = 'assets';

let _db = null;
const mem = new Map();     // id -> {id,name,kind,mime,buf,url}
let embedded = false;      // true عندما تعمل اللعبة المُصدَّرة

export function setEmbeddedMode(v) { embedded = v; }

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB_NAME, DB_VER);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    rq.onsuccess = () => { _db = rq.result; res(_db); };
    rq.onerror = () => rej(rq.error);
  });
}

function tx(mode = 'readonly') {
  return openDB().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

/** خزّن أصلاً جديداً. buf = ArrayBuffer */
export async function putAsset({ id, name, kind, mime, buf }) {
  id = id || uid('as');
  const rec = { id, name, kind, mime: mime || 'application/octet-stream', buf, size: buf.byteLength };
  mem.set(id, { ...rec, url: null });
  if (!embedded) {
    try {
      const st = await tx('readwrite');
      await new Promise((res, rej) => {
        const r = st.put(rec);
        r.onsuccess = res;
        r.onerror = () => rej(r.error);
      });
    } catch (e) { console.warn('IDB put failed', e); }
  }
  return id;
}

export async function loadAllAssets() {
  if (embedded) return [...mem.values()];
  try {
    const st = await tx();
    const all = await new Promise((res, rej) => {
      const r = st.getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
    for (const a of all) mem.set(a.id, { ...a, url: null });
    return all;
  } catch (e) { console.warn('IDB read failed', e); return []; }
}

export async function delAsset(id) {
  const a = mem.get(id);
  if (a?.url) URL.revokeObjectURL(a.url);
  mem.delete(id);
  if (embedded) return;
  try {
    const st = await tx('readwrite');
    st.delete(id);
  } catch (e) { /* ignore */ }
}

export function getAsset(id) { return id ? mem.get(id) || null : null; }
export function listAssets(kind) {
  const a = [...mem.values()];
  return kind ? a.filter((x) => x.kind === kind) : a;
}

/** رابط blob صالح للاستخدام في <img> أو GLTFLoader */
export function assetURL(id) {
  const a = mem.get(id);
  if (!a) return null;
  if (!a.url) a.url = URL.createObjectURL(new Blob([a.buf], { type: a.mime }));
  return a.url;
}

/** يُحمِّل الحمولة المضمّنة في الملف المُصدَّر */
export function hydrateFromPayload(assets) {
  embedded = true;
  for (const a of assets) {
    mem.set(a.id, { id: a.id, name: a.name, kind: a.kind, mime: a.mime, buf: b64ToAb(a.b64), url: null, size: 0 });
  }
}

/** يُجهّز الأصول للتصدير كـ base64 */
export function exportAssets(idsUsed) {
  const out = [];
  for (const a of mem.values()) {
    if (idsUsed && !idsUsed.has(a.id)) continue;
    out.push({ id: a.id, name: a.name, kind: a.kind, mime: a.mime, b64: abToB64(a.buf) });
  }
  return out;
}

export function totalAssetBytes(idsUsed) {
  let n = 0;
  for (const a of mem.values()) {
    if (idsUsed && !idsUsed.has(a.id)) continue;
    n += a.buf.byteLength;
  }
  return n;
}

/** استيراد ملف من المستخدم */
export async function importFile(file, kind) {
  const buf = await file.arrayBuffer();
  const k = kind || (/\.(glb|gltf)$/i.test(file.name) ? 'glb'
    : /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name) ? 'image'
    : /\.(mp3|ogg|wav|m4a)$/i.test(file.name) ? 'audio' : 'bin');
  const mime = file.type || (k === 'glb' ? 'model/gltf-binary' : 'application/octet-stream');
  const id = await putAsset({ name: file.name, kind: k, mime, buf });
  return { id, kind: k, name: file.name, size: buf.byteLength };
}

/** يجلب أصلاً مرفقاً بجانب الصفحة (وضع المحرر فقط) */
export async function fetchBundled(url, name, kind, fixedId) {
  if (mem.has(fixedId)) return fixedId;
  const r = await fetch(url);
  if (!r.ok) throw new Error('تعذّر جلب ' + url);
  const buf = await r.arrayBuffer();
  return putAsset({ id: fixedId, name, kind, mime: kind === 'glb' ? 'model/gltf-binary' : 'application/octet-stream', buf });
}
