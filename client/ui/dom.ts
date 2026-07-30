/** Minimal DOM helpers — enough structure to keep panel code declarative. */

type Attrs = Record<string, string | number | boolean | ((ev: Event) => void) | undefined>;
type Child = Node | string | number | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      node.className = String(value);
    } else if (key === 'value' && node instanceof HTMLInputElement) {
      node.value = String(value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function clear(node: HTMLElement) {
  node.replaceChildren();
}

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

/** A standard list row: icon + title/subtitle + trailing controls. */
export function row(opts: {
  icon?: string;
  title: Child[];
  sub?: Child[];
  trailing?: Child[];
  onClick?: () => void;
}): HTMLElement {
  const grow = el('div', { class: 'grow' },
    el('div', { class: 'name' }, ...opts.title),
    opts.sub && opts.sub.length > 0 ? el('div', { class: 'sub' }, ...opts.sub) : null,
  );
  return el('div',
    { class: 'row', ...(opts.onClick ? { onclick: opts.onClick } : {}) },
    opts.icon ? el('span', { style: 'font-size:20px' }, opts.icon) : null,
    grow,
    ...(opts.trailing ?? []),
  );
}

export function sectionTitle(text: string): HTMLElement {
  return el('div', { class: 'section-title' }, text);
}

export function empty(text: string): HTMLElement {
  return el('div', { class: 'empty' }, text);
}

export function bar(fraction: number, gold = false): HTMLElement {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return el('div', { class: `bar${gold ? ' gold' : ''}` }, el('i', { style: `width:${pct.toFixed(1)}%` }));
}

export function pill(text: string, tone: '' | 'good' | 'bad' | 'warn' = ''): HTMLElement {
  return el('span', { class: `pill ${tone}`.trim() }, text);
}

/** A number input paired with quick-fill buttons. */
export function qtyInput(value: number, max?: number): HTMLInputElement {
  return el('input', {
    class: 'qty',
    type: 'number',
    min: '1',
    ...(max !== undefined ? { max: String(Math.max(1, Math.floor(max))) } : {}),
    value: String(value),
  }) as HTMLInputElement;
}

/** Draws a sparkline of a price history into an inline SVG-free canvas. */
export function sparkline(values: number[], color = '#5b9dff'): HTMLCanvasElement {
  const canvas = el('canvas', { class: 'spark' });
  const width = 240;
  const height = 34;
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(2, 2);
  if (values.length < 2) return canvas;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1e-6, max - min);
  const step = width / (values.length - 1);

  ctx.beginPath();
  values.forEach((v, i) => {
    const x = i * step;
    const y = height - 3 - ((v - min) / span) * (height - 8);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, 0, 0, height);
  fill.addColorStop(0, `${color}44`);
  fill.addColorStop(1, `${color}00`);
  ctx.fillStyle = fill;
  ctx.fill();
  return canvas;
}
