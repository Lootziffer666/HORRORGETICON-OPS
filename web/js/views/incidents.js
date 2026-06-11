// Management · Meldungen & Warnungen — Filter, Tabelle, Statuswechsel,
// Ø-Reaktionszeit, Export (Mockup MgmtIncidents).
import { h, ic, badge } from '../core/dom.js';
import { get, patch, act, download } from '../core/api.js';
import { on, store } from '../core/store.js';
import { prioTone, prioLabel, incStatusTone, incStatusLabel, kindLabel, incidentSheet } from './shared.js';

let flt = 'offen';

export async function incidentsView({ onCleanup, refresh }) {
  const [all, stats] = await Promise.all([get('/api/incidents'), get('/api/incidents/stats')]);
  onCleanup(on(['incidents'], refresh));

  const filters = {
    alle: () => true,
    offen: (i) => i.status !== 'erledigt',
    hoch: (i) => i.prio === 'hoch',
    technik: (i) => i.kind === 'technik',
    gast: (i) => i.kind === 'gast',
    notfall: (i) => i.kind === 'notfall',
  };
  const rows = all.filter(filters[flt] || filters.alle);
  const chipDefs = [
    ['alle', `Alle (${all.length})`], ['offen', `Offen (${all.filter(filters.offen).length})`],
    ['hoch', `Hoch (${all.filter(filters.hoch).length})`], ['technik', 'Technik'], ['gast', 'Gast'], ['notfall', 'Notfall'],
  ];

  const action = (i) => {
    if (i.status === 'erledigt') return h('span', { class: 'sub' }, '—');
    return h('div', { class: 'row', style: { gap: '6px' } },
      i.status === 'offen' && h('button', {
        class: 'btn sm quiet',
        onclick: () => act(() => patch(`/api/incidents/${i.id}`, { status: 'in_arbeit', assignee: store.me.person.id }).then(refresh), 'Übernommen'),
      }, 'Übernehmen'),
      h('button', {
        class: 'btn sm',
        onclick: () => act(() => patch(`/api/incidents/${i.id}`, { status: 'erledigt' }).then(refresh), 'Erledigt'),
      }, ic('check', 13)));
  };

  return h('div', { class: 'col', style: { gap: '12px', flex: 1, minHeight: 0 } },
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      ...chipDefs.map(([id, l]) => h('span', {
        class: 'chip' + (flt === id ? ' active' : ''), onclick: () => { flt = id; refresh(); },
      }, l)),
      h('div', { style: { flex: 1 } }),
      h('span', { class: 'sub', style: { fontWeight: 700 } },
        stats.mittlereReaktionMin != null ? `Ø Reaktionszeit heute: ${String(stats.mittlereReaktionMin).replace('.', ',')} min` : 'noch keine Reaktionszeiten'),
      h('button', { class: 'btn sm', style: { padding: '8px 14px' }, onclick: () => incidentSheet({ onDone: refresh }) }, ic('plus', 15), 'Meldung erfassen')),

    h('div', { class: 'panel grow', style: { overflow: 'hidden', display: 'flex' } },
      h('div', { class: 'tbl-wrap' },
        h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Zeit'), h('th', {}, 'Priorität'), h('th', {}, 'Meldung'), h('th', {}, 'Art'),
            h('th', {}, 'Ort'), h('th', {}, 'Gemeldet von'), h('th', {}, 'Status'), h('th', {}, ''))),
          h('tbody', {},
            rows.length === 0 ? h('tr', {}, h('td', { colspan: '8' }, h('div', { class: 'empty-hint' }, 'Nichts gefunden — gute Nachrichten.')))
              : rows.map((i) => h('tr', { style: i.prio === 'hoch' && i.status === 'offen' ? { background: 'var(--color-error-light)' } : null },
                h('td', { class: 'num' }, i.time),
                h('td', {}, badge(prioTone[i.prio], prioLabel[i.prio], { dot: true })),
                h('td', { class: 'b wrap', style: { minWidth: '230px' } }, i.text),
                h('td', {}, kindLabel[i.kind] || i.kind),
                h('td', {}, i.ort || '—'),
                h('td', {}, i.by),
                h('td', {}, badge(incStatusTone[i.status], incStatusLabel[i.status])),
                h('td', {}, action(i))))))),
    ),
    h('div', { class: 'row', style: { gap: '8px' } },
      h('span', { class: 'sub' }, `${rows.length} von ${all.length} Meldungen · ${store.settings?.nightLabel || ''}`),
      h('div', { style: { flex: 1 } }),
      h('button', { class: 'btn sm quiet', onclick: () => download('/api/csv/export/meldungen') }, ic('doc', 14), 'Als Bericht exportieren')));
}
