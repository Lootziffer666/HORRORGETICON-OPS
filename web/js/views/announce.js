// Management · Durchsagen — Verlauf mit Lesebestätigungen + Composer +
// Live-Feed mit Entscheidungslog (dokumentierte Leitstand-Entscheidungen)
import { h, ic, badge, panel } from '../core/dom.js';
import { get, post, act } from '../core/api.js';
import { on, store } from '../core/store.js';
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
      h('button', { class: 'btn sm quiet right', onclick: () => lageSheet(refresh) }, ic('alert', 14), 'Lagestatus'),
      h('button', { class: 'btn sm orange', onclick: () => announceSheet({}) }, ic('mega', 14), 'Neue Durchsage')],
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


// Live-Lagestatus setzen/aufheben — erscheint als Banner auf JEDEM Gerät.
const LAGE_TEMPLATES = [
  { label: 'Wetter-Stopp', level: 'stop', text: 'Wetter-Stopp — bitte geschützt/in Position bleiben und auf Freigabe warten.' },
  { label: 'Start verzögert', level: 'warnung', text: 'Start verzögert sich. Bleibt bereit — neue Zielzeit folgt.' },
  { label: 'Hoher Andrang', level: 'warnung', text: 'Hoher Andrang — Wellen enger getaktet. Bleibt auf Position.' },
  { label: 'Kurze Unterbrechung', level: 'warnung', text: 'Kurze Unterbrechung. Position halten, nächste Info folgt.' },
  { label: 'Info', level: 'info', text: '' },
];

function lageSheet(refresh) {
  const cur = store.settings?.lage || null;
  let level = cur?.level || 'warnung';
  const text = h('textarea', { rows: 2, placeholder: 'Was ist los? Kurz und klar — die ganze Crew sieht das oben am Bildschirm.' }, cur?.text || '');
  const nextInfo = h('input', { placeholder: 'z. B. 18:00', value: cur?.nextInfoAt || '', inputmode: 'numeric', style: { width: '90px' } });

  const seg = h('div', { class: 'seg' });
  const drawSeg = () => seg.replaceChildren(...[['info', 'Info'], ['warnung', 'Warnung'], ['stop', 'STOP']].map(([v, l]) =>
    h('span', { class: level === v ? 'on' : '', onclick: () => { level = v; drawSeg(); } }, l)));
  drawSeg();

  const chips = h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
    ...LAGE_TEMPLATES.map((t) => h('span', {
      class: 'chip', onclick: () => { text.value = t.text; level = t.level; drawSeg(); },
    }, t.label)));

  sheet({
    title: 'Lagestatus', icon: 'alert', tone: 'warn', center: true,
    sub: 'Dauerhaftes Banner auf allen Geräten — ideal bei Wetter, Verzögerung, Andrang.',
    content: (close) => h('div', { class: 'col', style: { gap: '12px' } },
      cur && h('div', { class: 'card pad', style: { background: 'var(--bg-muted)', boxShadow: 'none' } },
        h('span', { class: 'sub' }, `Aktiv seit ${cur.time}: „${cur.text}"${cur.nextInfoAt ? ` · nächste Info ${cur.nextInfoAt}` : ''}`)),
      h('label', { class: 'fld' }, 'Schnellauswahl', chips),
      h('label', { class: 'fld' }, 'Text', h('div', { class: 'inp area' }, text)),
      h('div', { class: 'row', style: { gap: '14px', flexWrap: 'wrap' } },
        h('label', { class: 'fld' }, 'Stufe', seg),
        h('label', { class: 'fld' }, 'Nächste Info um', h('div', { class: 'inp sm' }, nextInfo))),
      h('div', { class: 'row', style: { gap: '8px', justifyContent: 'flex-end' } },
        cur && h('button', {
          class: 'btn quiet danger-text', onclick: () => act(async () => {
            await post('/api/settings/lage', { clear: true });
            toast('Lagestatus aufgehoben — Normalbetrieb', 'ok'); close(); refresh && refresh();
          }),
        }, ic('x', 15), 'Aufheben'),
        h('button', { class: 'btn quiet', onclick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn orange', onclick: () => {
            if (!text.value.trim()) { toast('Bitte kurz beschreiben, was los ist', 'err'); return; }
            act(async () => {
              await post('/api/settings/lage', { text: text.value.trim(), level, nextInfoAt: nextInfo.value.trim() || undefined });
              toast('Lagestatus gesetzt — für alle sichtbar', 'ok'); close(); refresh && refresh();
            });
          },
        }, ic('check', 15), 'Setzen')))
    ,
  });
}
