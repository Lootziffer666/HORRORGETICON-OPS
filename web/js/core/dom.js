// DOM-Helfer + Icon-Satz + gemeinsame Bausteine (aus dem Design-Prototyp portiert)

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, kids) {
  for (const c of kids) {
    if (c === null || c === undefined || c === false || c === '') continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export const frag = (...kids) => { const f = document.createDocumentFragment(); append(f, kids); return f; };
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function mount(el, ...kids) { clear(el); append(el, kids); return el; }

// ───────── Icons (identisch zum Prototyp) ─────────
const PATHS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14"/><path d="M15 6v14"/>',
  pin: '<path d="M12 21s-7-5.5-7-11a7 7 0 0114 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  bell: '<path d="M18 9a6 6 0 10-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9z"/><path d="M10 19.5a2.2 2.2 0 004 0"/>',
  mega: '<path d="M3 11v3l13 4V7L3 11z"/><path d="M16 7l4-2v14l-4-2"/><path d="M7 14.5V19l3 1v-4.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 010 6.4"/><path d="M18.5 14.7c2 .8 3 2.4 3 4.3"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  x: '<path d="M5 5l14 14M19 5L5 19"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
  cup: '<path d="M5 8h12v6a5 5 0 01-5 5h-2a5 5 0 01-5-5V8z"/><path d="M17 9h1.5a2.5 2.5 0 010 5H17"/><path d="M8 4.5v1M11 3.5v2M14 4.5v1"/>',
  alert: '<path d="M12 3L2 20h20L12 3z"/><path d="M12 10v4.5"/><path d="M12 17.4v.2"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6l8-3z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5l1.2 2.8 3-.6 1 2.9 3 .4-.7 3 2.4 1.9-1.8 2.5 1 2.8-2.8 1.2-.3 3-3-.2-1.6 2.6L12 22l-2.4-1.8-2.8 1-1.2-2.8-3-.3.2-3-2.6-1.6L2 12"/>',
  out: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  back: '<path d="M15 19l-7-7 7-7"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-8M21 20H3"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M7.5 16.5a6.4 6.4 0 010-9M16.5 7.5a6.4 6.4 0 010 9"/><path d="M4.6 19.4a10.5 10.5 0 010-14.8M19.4 4.6a10.5 10.5 0 010 14.8"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  doc: '<path d="M6 2h8l4 4v16H6V2z"/><path d="M14 2v4h4"/><path d="M9 12h6M9 16h6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  walk: '<circle cx="13" cy="4.5" r="2"/><path d="M10 21l2-6-2-2 1-5 3 1 2.5 3"/><path d="M8 12l2-4.5"/><path d="M14 15l2.5 6"/>',
  door: '<path d="M4 21h16"/><path d="M6 21V4h9v17"/><path d="M12.5 12h.01"/><path d="M15 7h3v14"/>',
  qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14h1v1h-1zM14 20h1v1h-1zM18 18h3v3h-3z"/>',
  chat: '<path d="M21 11.5c0 4.1-4 7.5-9 7.5-1 0-2-.13-2.9-.38L4 20l1.3-3.1C3.9 15.6 3 13.6 3 11.5 3 7.4 7 4 12 4s9 3.4 9 7.5z"/>',
  car: '<path d="M5 16l1.5-5.5A2 2 0 018.4 9h7.2a2 2 0 011.9 1.5L19 16"/><rect x="4" y="16" width="16" height="4" rx="1.2"/><circle cx="7.5" cy="20" r="1.4"/><circle cx="16.5" cy="20" r="1.4"/>',
  db: '<ellipse cx="12" cy="5.5" rx="8" ry="2.8"/><path d="M4 5.5v13c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-13"/><path d="M4 12c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8"/>',
  save: '<path d="M5 3h12l4 4v14H5V3z"/><path d="M8 3v5h8V3"/><rect x="8" y="13" width="8" height="6"/>',
  puzzle: '<path d="M10 3h4v3.5a1.8 1.8 0 103.5 0H21v4h-3.5a1.8 1.8 0 100 3.5H21V21h-4v-3.5a1.8 1.8 0 10-3.5 0V21H10v-4.5a1.8 1.8 0 10-3.5 0H3v-4h3.5a1.8 1.8 0 100-3.5H3V3h7z"/>',
  refresh: '<path d="M21 12a9 9 0 11-2.6-6.4"/><path d="M21 3v6h-6"/>',
  download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/>',
  upload: '<path d="M12 21V9"/><path d="M7 14l5-5 5 5"/><path d="M4 3h16"/>',
  link: '<path d="M10 13a5 5 0 007.1 0l3-3a5 5 0 00-7.1-7.1L11.5 4.4"/><path d="M14 11a5 5 0 00-7.1 0l-3 3a5 5 0 007.1 7.1l1.5-1.5"/>',
  battery: '<rect x="2" y="8" width="17" height="8" rx="2"/><path d="M21 11v2"/>',
  camera: '<path d="M4 8h3l2-2.5h6L17 8h3v12H4V8z"/><circle cx="12" cy="13.5" r="3.4"/>',
};

export function ic(name, size = 18, style = null) {
  const span = h('span', { class: 'ic', style: { width: size + 'px', height: size + 'px', ...(style || {}) } });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || PATHS.alert}</svg>`;
  return span;
}

// ───────── Marken-Bausteine ─────────
export function ghostMark(size = 34, radius = 9) {
  const s = h('span', { class: 'mark', style: { width: size + 'px', height: size + 'px', borderRadius: radius + 'px' } });
  s.innerHTML = `<svg width="${size * 0.62}" height="${size * 0.62}" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2.5c-4.2 0-7.2 3.2-7.2 7.4v9.8c0 .9 1 1.4 1.7.9l1.6-1.2 1.9 1.6c.4.3 1 .3 1.4 0L12 19.7l1.6 1.3c.4.3 1 .3 1.4 0l1.9-1.6 1.6 1.2c.7.5 1.7 0 1.7-.9V9.9c0-4.2-3-7.4-7.2-7.4z"/>
    <circle cx="9.3" cy="10" r="1.4" fill="#0D2847"/><circle cx="14.7" cy="10" r="1.4" fill="#0D2847"/></svg>`;
  return s;
}

export const wordmark = (fontSize = 15) =>
  h('span', { class: 'wordmark', style: { fontSize: fontSize + 'px' }, html: 'Horrorgeticon&nbsp;<em>Ops</em>' });

export function badge(tone, text, { dot = false, style = null } = {}) {
  return h('span', { class: `badge ${tone || 'plain'}`, style }, dot && h('span', { class: 'dot' }), text);
}

export function av(name, { tone = '', size = '' } = {}) {
  const ini = String(name || '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  return h('span', { class: `av ${tone} ${size}` }, ini);
}

export function bar(pct, tone = '') {
  return h('div', { class: 'bar' }, h('i', { class: tone, style: { width: Math.max(0, Math.min(100, pct)) + '%' } }));
}

export function panel(headKids, bodyKids, opts = {}) {
  return h('div', { class: 'panel' + (opts.grow ? ' grow' : ''), style: opts.style },
    h('div', { class: 'panel-h' }, headKids),
    h('div', { class: 'panel-b' + (opts.scroll ? ' scroll' : ''), style: opts.bodyStyle }, bodyKids));
}

export const statusTone = { aktiv: 'ok', pause: 'info', vorfall: 'err', stumm: 'warn', out: 'plain', leer: 'plain' };
export const statusLabel = { aktiv: 'Aktiv', pause: 'Pause', vorfall: 'Vorfall', stumm: 'Verbindung?', out: 'Nicht da', leer: 'Unbesetzt' };
