// ============================================================
//  أدوات عامة — DOM / رياضيات / حوارات
// ============================================================

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const k in props) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'data' && typeof v === 'object') for (const d in v) n.dataset[d] = v[d];
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(9)) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (cur, tgt, lambda, dt) => lerp(cur, tgt, 1 - Math.exp(-lambda * dt));
export const rnd = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const rndi = (a, b) => Math.floor(rnd(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9);
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;

export function fmtBytes(b) {
  if (b < 1024) return b + ' ب';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' كب';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' مب';
  return (b / 1073741824).toFixed(2) + ' جب';
}

// ---------------- toasts ----------------
let toastHost;
export function toast(msg, kind = '') {
  if (!toastHost) {
    toastHost = el('div', { id: 'toasts' });
    document.body.append(toastHost);
  }
  const t = el('div', { class: 'toast ' + kind }, msg);
  toastHost.append(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s,transform .3s';
    t.style.opacity = '0';
    t.style.transform = 'translateY(14px)';
    setTimeout(() => t.remove(), 320);
  }, 2400);
}

// ---------------- modal ----------------
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const bd = el('div', { class: 'modal-bd' });
  const box = el('div', { class: 'modal', style: wide ? { width: 'min(880px,100%)' } : {} });
  const close = () => {
    bd.remove();
    onClose && onClose();
  };
  box.append(el('h3', {}, title));
  const content = el('div');
  if (typeof body === 'string') content.innerHTML = body;
  else if (body) content.append(body);
  box.append(content);
  const foot = el('div', { class: 'foot' });
  for (const a of actions) {
    foot.append(
      el(
        'button',
        {
          class: 'btn ' + (a.cls || 'ghost'),
          onclick: () => {
            if (a.run) { if (a.run(close) === false) return; }
            if (a.keep !== true) close();
          },
        },
        a.label
      )
    );
  }
  if (actions.length) box.append(foot);
  bd.append(box);
  bd.addEventListener('pointerdown', (e) => { if (e.target === bd) close(); });
  document.body.append(bd);
  return { close, box, content };
}

export function confirmBox(title, msg, okLabel = 'تأكيد') {
  return new Promise((res) => {
    modal({
      title,
      body: el('p', { class: 'hint', style: { fontSize: '14px' } }, msg),
      actions: [
        { label: okLabel, cls: 'r', run: () => res(true) },
        { label: 'إلغاء', cls: 'ghost', run: () => res(false) },
      ],
      onClose: () => res(false),
    });
  });
}

export function promptBox(title, label, value = '', okLabel = 'حفظ') {
  return new Promise((res) => {
    const inp = el('input', { type: 'text', value });
    const f = el('div', { class: 'field' }, el('label', {}, label), inp);
    const m = modal({
      title,
      body: f,
      actions: [
        { label: okLabel, cls: 'y', run: () => res(inp.value.trim() || null) },
        { label: 'إلغاء', cls: 'ghost', run: () => res(null) },
      ],
      onClose: () => res(null),
    });
    setTimeout(() => inp.focus(), 60);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { res(inp.value.trim() || null); m.close(); }
    });
  });
}

// ---------------- pointer drag helper ----------------
export function onDrag(node, { start, move, end, stopProp = true } = {}) {
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button > 1) return;
    if (stopProp) e.stopPropagation();
    e.preventDefault();
    node.setPointerCapture?.(e.pointerId);
    const s = { x: e.clientX, y: e.clientY, e };
    let last = s;
    const ctx = {};
    start && start(s, ctx);
    const mv = (ev) => {
      const d = { x: ev.clientX, y: ev.clientY, dx: ev.clientX - s.x, dy: ev.clientY - s.y,
                  mx: ev.clientX - last.x, my: ev.clientY - last.y, e: ev };
      last = { x: ev.clientX, y: ev.clientY };
      move && move(d, ctx);
    };
    const up = (ev) => {
      node.removeEventListener('pointermove', mv);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      end && end({ x: ev.clientX, y: ev.clientY, dx: ev.clientX - s.x, dy: ev.clientY - s.y }, ctx);
    };
    node.addEventListener('pointermove', mv);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
  });
}

// ---------------- file pickers ----------------
export function pickFile(accept = '*/*', multiple = false) {
  return new Promise((res) => {
    const i = el('input', { type: 'file', accept, multiple: multiple || null,
      style: { position: 'fixed', left: '-9999px' } });
    document.body.append(i);
    i.addEventListener('change', () => {
      const f = multiple ? [...i.files] : i.files[0] || null;
      i.remove();
      res(f);
    });
    i.click();
  });
}

export const readAsDataURL = (f) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(f);
  });

export const readAsArrayBuffer = (f) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsArrayBuffer(f);
  });

export function download(name, blobOrString, mime = 'text/html;charset=utf-8') {
  const blob = blobOrString instanceof Blob ? blobOrString : new Blob([blobOrString], { type: mime });
  const u = URL.createObjectURL(blob);
  const a = el('a', { href: u, download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(u); }, 4000);
}

// base64 <-> ArrayBuffer (chunked, safe for large files)
export function abToB64(buf) {
  const bytes = new Uint8Array(buf);
  let out = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(out);
}
export function b64ToAb(b64) {
  const bin = atob(b64);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a.buffer;
}

// deep clone that survives structuredClone absence
export const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

// ---------------- simple UI builders ----------------
export function slider({ label, min, max, step = 1, value, unit = '', onInput }) {
  const out = el('b', { style: { color: 'var(--acc)', minWidth: '46px', textAlign: 'left' } },
    (+value).toFixed(step < 1 ? 2 : 0) + unit);
  const r = el('input', { type: 'range', min, max, step, value,
    oninput: (e) => { const v = +e.target.value; out.textContent = v.toFixed(step < 1 ? 2 : 0) + unit; onInput(v); } });
  return el('div', { class: 'field' },
    el('div', { class: 'row' }, el('label', { style: { flex: 1 } }, label), out), r);
}

export function colorRow(label, value, onInput) {
  const c = el('input', { type: 'color', value, oninput: (e) => onInput(e.target.value) });
  return el('div', { class: 'row', style: { marginBottom: '10px' } },
    el('label', { style: { flex: 1, fontSize: '12.5px', fontWeight: 800, color: 'var(--ink-2)' } }, label), c);
}

export function toggleRow(label, value, onChange) {
  const box = el('div', {
    style: {
      width: '46px', height: '26px', borderRadius: '13px', flex: 'none', cursor: 'pointer',
      background: value ? 'linear-gradient(90deg,var(--gr),var(--gr-d))' : 'rgba(0,0,0,.45)',
      border: '1px solid var(--line)', position: 'relative', transition: '.15s',
    },
  });
  const knob = el('i', {
    style: {
      position: 'absolute', top: '2px', width: '20px', height: '20px', borderRadius: '50%',
      background: '#fff', transition: '.15s', right: value ? '2px' : '24px', boxShadow: '0 2px 5px rgba(0,0,0,.5)',
    },
  });
  box.append(knob);
  box.addEventListener('click', () => {
    value = !value;
    box.style.background = value ? 'linear-gradient(90deg,var(--gr),var(--gr-d))' : 'rgba(0,0,0,.45)';
    knob.style.right = value ? '2px' : '24px';
    onChange(value);
  });
  return el('div', { class: 'row', style: { marginBottom: '10px' } },
    el('label', { style: { flex: 1, fontSize: '12.5px', fontWeight: 800, color: 'var(--ink-2)' } }, label), box);
}
