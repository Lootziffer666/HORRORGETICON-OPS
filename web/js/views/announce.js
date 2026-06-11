// Management · Durchsagen — Verlauf mit Lesebestätigungen + Composer +
// Live-Feed mit Entscheidungslog (dokumentierte Leitstand-Entscheidungen)
import { h, ic, badge, panel } from '../core/dom.js';
import { get, post, act } from '../core/api.js';
import { on } from '../core/store.js';
import { announceSheet, feedList } from './shared.js';
import { sheet, toast } from '../core/ui.js';

const lvlTone = { info: 'info', wichtig: 'warn', notfall: 'err' };
const lvlLabel = { info: 'Info', wichtig: 'Wichtig', notfall: 'NOTFALL' };

let feedKind = '';

export async function announceView({ onCleanup, refresh }) {
  const [anns, feed] = await Promise.all([
    get('/api/announcements'),
    get(`/api/feed?limit=60${feedKind ? `&kind=${feedKind}` : ''}`),
  ]);
  onCleanup(on(['announce', 'feed'], refresh));

  // Entscheidungslog: kurze Eingabe direkt über dem Feed
  const decisionInput = h('input', { placeholder: 'Entscheidung dokumentieren … (z. B. „Keller bleibt offen, Security postiert“)' });
  const logDecision = () => {
    const text = decisionInput.value.trim();
    if (!text) { toast('Kurz beschreiben, was entschieden wurde', 'err'); return; }
    act(async () => { await post('/api/feed/decision', { text }); decisionInput.value = ''; refresh(); }, 'Im Entscheidungslog notiert 📌');
  };
  decisionInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') logDecision(); });

  return h('div', { class: 'cols-2' },
    panel([ic('mega', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Durchsagen'),
      h('button', { class: 'btn sm orange right', onclick: () => announceSheet({}) }, ic('mega', 14), 'Neue Durchsage')],
      anns.length === 0 ? h('div', { class: 'empty-hint' }, 'Noch keine Durchsagen.')
        : anns.map((a) => h('div', { class: 'prow click', style: { gap: '10px', alignItems: 'flex-start' }, onclick: () => readsSheet(a) },
          h('span', { class: 'f-time', style: { width: '38px', paddingTop: '3px' } }, a.time),
          badge(lvlTone[a.level], lvlLabel[a.level], { dot: true }),
          h('div', { class: 'col grow', style: { gap: '1px' } },
            h('span', { class: 'f-txt' }, a.text),
            h('span', { class: 'f-meta' }, `${a.byName} · ${a.scopeLabel}${a.requiresAck ? ' · mit Lesebestätigung' : ''}`)),
          a.requiresAck && h('button', { class: 'btn sm quiet', onclick: (e) => { e.stopPropagation(); readsSheet(a); } }, ic('eye', 13), 'Wer hat gelesen?'))),
      { scroll: true, bodyStyle: { gap: 0, paddingTop: '2px' } }),
    panel([ic('radio', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Live-Feed & Entscheidungslog'),
      h('span', {
        class: 'chip right' + (feedKind === 'entscheidung' ? ' active' : ''), style: { fontSize: '11px' },
        onclick: () => { feedKind = feedKind === 'entscheidung' ? '' : 'entscheidung'; refresh(); },
      }, '📌 Nur Entscheidungen')],
      h('div', { class: 'col grow', style: { gap: '10px', minHeight: 0 } },
        h('div', { class: 'row', style: { gap: '8px', flex: 'none' } },
          h('div', { class: 'inp sm grow' }, decisionInput),
          h('button', { class: 'btn sm', onclick: logDecision }, '📌 Notieren')),
        h('div', { class: 'scroll-y grow' }, feedList(feed, { limit: 60 }))),
      { scroll: false, bodyStyle: { paddingTop: '10px', minHeight: 0 } }));
}

async function readsSheet(a) {
  let data = null;
  try { data = await get(`/api/announcements/${a.id}/reads`); } catch { /* z. B. ohne Ack */ }
  sheet({
    title: 'Lesebestätigungen', icon: 'eye', tone: 'info', center: true,
    sub: `„${a.text.slice(0, 80)}${a.text.length > 80 ? '…' : ''}“ · ${a.scopeLabel}`,
    content: (close) => !data
      ? h('div', { class: 'empty-hint' }, 'Für diese Durchsage werden keine Bestätigungen erfasst.')
      : h('div', { class: 'col', style: { gap: '12px' } },
        h('div', { class: 'row', style: { gap: '10px' } },
          badge('ok', `${data.gelesen.length} gelesen`, { dot: true }),
          badge(data.offen.length ? 'warn' : 'ok', `${data.offen.length} offen`, { dot: true }),
          h('span', { class: 'sub' }, `${data.quote} % erreicht`)),
        h('div', { class: 'grid2', style: { maxHeight: '40vh', overflow: 'auto' } },
          h('div', { class: 'col', style: { gap: '4px' } },
            h('span', { class: 'overline' }, 'Gelesen'),
            ...data.gelesen.map((r) => h('span', { style: { fontSize: '13px' } }, `✓ ${r.name}`))),
          h('div', { class: 'col', style: { gap: '4px' } },
            h('span', { class: 'overline' }, 'Noch offen'),
            ...data.offen.map((r) => h('span', { style: { fontSize: '13px', color: 'var(--fg-muted)' } }, r.name)))),
        h('button', { class: 'btn quiet', onclick: close }, 'Schließen')),
  });
}
