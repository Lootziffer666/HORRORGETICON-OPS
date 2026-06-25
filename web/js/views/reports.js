// Management · Berichte — Nacht-Auswertung + Saison-Historie + Exporte
import { h, ic, badge, bar, panel } from '../core/dom.js';
import { get, download, getToken } from '../core/api.js';
import { on } from '../core/store.js';
import { kpi } from './shared.js';

export async function reportsView({ onCleanup, refresh }) {
  const [r, season] = await Promise.all([get('/api/reports/overview'), get('/api/reports/season')]);
  onCleanup(on(['live', 'incidents', 'catering', 'carpool'], refresh));

  const num = (v) => v == null ? '—' : String(v).replace('.', ',');

  return h('div', { class: 'col scroll-y', style: { gap: '14px', flex: 1 } },
    h('div', { class: 'kpis', style: { gridTemplateColumns: 'repeat(4, 1fr)' } },
      kpi(`${r.anwesenheit.quote}%`, 'Anwesenheit', `${r.anwesenheit.anwesend}/${r.anwesenheit.crew} · ${r.anwesenheit.unentschuldigt} unentschuldigt`),
      kpi(num(r.meldungen.mittlereReaktionMin), 'Ø Reaktion (min)', `${r.meldungen.gesamt} Meldungen · ${r.meldungen.offen} offen`),
      kpi(String(r.catering.einloesungen), 'Catering-Einlösungen', `${r.catering.drinks} Getränke · ${r.catering.meals} Essen · ${r.catering.abgelehnt} abgelehnt`),
      kpi(`${r.fahrgruppen.sitzauslastung}%`, 'Fahrgruppen-Auslastung', `${r.fahrgruppen.gruppen} Gruppen · ${r.fahrgruppen.mitfahrer} Mitfahrer · ${r.fahrgruppen.fix} fix`)),

    h('div', { class: 'grid2' },
      panel([ic('alert', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Meldungen nach Maze')],
        r.meldungen.nachMaze.map((m) => h('div', { class: 'row', style: { gap: '10px' } },
          h('span', { style: { fontSize: '12.5px', fontWeight: 700, width: '110px' } }, m.maze),
          bar(r.meldungen.nachMaze[0]?.n ? (m.n / r.meldungen.nachMaze[0].n) * 100 : 0, m.n > 3 ? 'warn' : 'navy'),
          h('span', { class: 'num', style: { width: '26px', textAlign: 'right', fontSize: '12px' } }, m.n))),
        { bodyStyle: { gap: '9px' } }),
      panel([ic('pause', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Pausen')],
        h('div', { class: 'col', style: { gap: '8px', fontSize: '13px' } },
          h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Pausen gesamt'), h('b', {}, r.pausen.gesamt)),
          h('div', { class: 'row' }, h('span', { class: 'grow' }, 'davon beendet'), h('b', {}, r.pausen.beendet)),
          h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Ø Wartezeit bis Freigabe'), h('b', {}, `${num(r.pausen.mittlereWartezeitMin)} min`))))),

    h('div', { class: 'grid2' },
      panel([ic('cal', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Saison-Historie'),
        h('span', { class: 'sub right' }, 'Erfahrung summiert sich')],
        h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Saison'), h('th', {}, 'Personen'), h('th', {}, 'Aktiv'))),
          h('tbody', {}, season.seasons.map((s) => h('tr', {},
            h('td', { class: 'b' }, s.season), h('td', {}, s.personen), h('td', {}, s.aktiv))))),
        { bodyStyle: { padding: 0 } }),
      panel([ic('door', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Mazes (Saison)')],
        h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Maze'), h('th', {}, 'Positionen'), h('th', {}, 'Meldungen'))),
          h('tbody', {}, season.mazes.map((m) => h('tr', {},
            h('td', { class: 'b' }, m.name), h('td', {}, m.positionen), h('td', {}, m.meldungen))))),
        { bodyStyle: { padding: 0 } })),

    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      h('span', { class: 'overline' }, 'Exporte:'),
      ...[['personen', 'Personen'], ['zuteilung', 'Zuteilung'], ['catering', 'Catering'], ['meldungen', 'Meldungen'], ['fahrgruppen', 'Fahrgruppen']]
        .map(([k, l]) => h('button', { class: 'btn sm quiet', onclick: () => download(`/api/csv/export/${k}`) }, ic('download', 13), l))),

    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      h('span', { class: 'overline' }, 'Event-Timeline exportieren:'),
      h('button', { class: 'btn sm quiet', onclick: () => { const t = getToken(); window.open(`/api/reports/timeline/export?token=${encodeURIComponent(t)}`); } }, ic('print', 13), 'HTML/Drucken'),
      h('button', { class: 'btn sm quiet', onclick: () => download('/api/reports/timeline/csv') }, ic('download', 13), 'CSV')),

    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
      h('span', { class: 'overline' }, 'Sicherheitsnetz:'),
      h('button', { class: 'btn sm orange', onclick: () => { const t = getToken(); window.open(`/api/reports/fallback?token=${encodeURIComponent(t)}`); } }, ic('print', 13), 'Notfall-Paket (drucken)'),
      h('span', { class: 'sub' }, 'Teilnehmer, Zuteilung, Kontakte & Incident-Zettel — vor dem Event ausdrucken.')));
}
