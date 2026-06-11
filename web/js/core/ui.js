// UI-Bausteine: Toasts, Modals/Sheets, Bestätigung, Modul-Aus-Fallback
import { h, ic, mount } from './dom.js';

let toastWrap = null;
export function toast(msg, tone = '') {
  if (!toastWrap) { toastWrap = h('div', { class: 'toasts' }); document.body.appendChild(toastWrap); }
  const t = h('div', { class: `toast ${tone}` }, msg);
  toastWrap.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, tone === 'err' ? 5000 : 2800);
}

// Sheet (mobil unten) bzw. zentriertes Modal (Desktop): schließt über X/Scrim/Esc
export function sheet({ title, sub, icon, tone = 'info', center = false, content, dark = false }) {
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const toneBg = { info: 'var(--color-info-light)', err: 'var(--color-error-light)', ok: 'var(--color-success-light)', warn: 'var(--color-warning-light)' }[tone];
  const toneFg = { info: 'var(--color-info)', err: 'var(--color-error)', ok: 'var(--color-success)', warn: '#b8901c' }[tone];
  const body = h('div', { class: 'sheet', 'data-theme': dark ? 'dark' : null, style: { background: 'var(--bg-surface)' } },
    !center && h('span', { class: 'grab' }),
    h('div', { class: 'row', style: { gap: '10px' } },
      icon && h('span', { style: { width: '38px', height: '38px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: toneBg, color: toneFg, flex: 'none' } }, ic(icon, 19)),
      h('div', { class: 'col grow', style: { gap: '1px' } },
        h('span', { style: { fontFamily: 'var(--font-display)', fontWeight: '900', fontSize: '18px' } }, title),
        sub && h('span', { class: 'sub' }, sub)),
      h('span', { class: 'x', onclick: close }, ic('x', 18))),
    content(close));
  const ov = h('div', { class: 'ov' + (center ? ' center' : ''), onclick: (e) => { if (e.target === ov) close(); } }, body);
  document.body.appendChild(ov);
  return { close, el: ov };
}

export function confirmDialog(title, text, { danger = false, okLabel = 'Ja, weiter' } = {}) {
  return new Promise((resolve) => {
    const s = sheet({
      title, sub: text, icon: danger ? 'alert' : 'check', tone: danger ? 'err' : 'info', center: true,
      content: (close) => h('div', { class: 'row', style: { gap: '10px', justifyContent: 'flex-end' } },
        h('button', { class: 'btn quiet', onclick: () => { close(); resolve(false); } }, 'Abbrechen'),
        h('button', { class: `btn ${danger ? 'danger' : ''}`, onclick: () => { close(); resolve(true); } }, okLabel)),
    });
    s.el.addEventListener('click', (e) => { if (e.target === s.el) resolve(false); });
  });
}

// Fallback-Karte, wenn ein Modul deaktiviert ist (Client bleibt benutzbar)
export function moduleOffCard(moduleName, retry) {
  return h('div', { class: 'mod-off card' },
    h('span', { class: 'ic-ring' }, ic('puzzle', 24)),
    h('span', { style: { fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: '16px' } },
      `Modul „${moduleName}“ ist gerade deaktiviert`),
    h('span', { class: 'sub', style: { maxWidth: '380px' } },
      'Der Rest der Plattform läuft normal weiter. Das Management kann das Modul unter System → Module wieder aktivieren oder austauschen.'),
    retry && h('button', { class: 'btn sm quiet', onclick: retry }, ic('refresh', 14), 'Erneut versuchen'));
}

export function errorCard(message, retry) {
  return h('div', { class: 'mod-off card' },
    h('span', { class: 'ic-ring', style: { background: 'var(--color-error-light)', color: 'var(--color-error)' } }, ic('alert', 24)),
    h('span', { style: { fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: '16px' } }, 'Hier hakt es gerade'),
    h('span', { class: 'sub', style: { maxWidth: '380px' } }, message),
    retry && h('button', { class: 'btn sm quiet', onclick: retry }, ic('refresh', 14), 'Erneut versuchen'));
}

export function spinner() { return h('div', { style: { display: 'flex', justifyContent: 'center', padding: '30px' } }, h('div', { class: 'spin' })); }

// Einheitlicher View-Wrapper: lädt async, fängt Fehler/Modul-Aus ab
export function guardedView(container, loader) {
  let alive = true;
  const run = async () => {
    mount(container, spinner());
    try {
      const view = await loader();
      if (alive) mount(container, view);
    } catch (e) {
      if (!alive) return;
      if (e.moduleDisabled) mount(container, moduleOffCard(e.module || '?', run));
      else mount(container, errorCard(e.message, run));
    }
  };
  run();
  return { refresh: run, stop: () => { alive = false; } };
}
