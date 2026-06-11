// Management · Catering — Marken & Kontingente (Mockup MgmtCatering):
// KPIs, Guthaben pro Person, Kontingent zuweisen, Stationen, letzte Einlösungen.
import { h, ic, badge, av, panel } from '../core/dom.js';
import { get, post, act, download } from '../core/api.js';
import { on, store } from '../core/store.js';
import { kpi } from './shared.js';
import { sheet, toast } from '../core/ui.js';

let mazeFilter = '';

export async function cateringMgmtView({ onCleanup, refresh }) {
  const [ov, mazes] = await Promise.all([get('/api/catering/overview'), get('/api/mazes')]);
  onCleanup(on(['catering'], refresh));
  const k = ov.kpi;
  const rows = mazeFilter ? ov.rows.filter((r) => r.einsatz.startsWith(mazeFilter)) : ov.rows;

  return h('div', { class: 'col', style: { gap: '14px', flex: 1, minHeight: 0 } },
    h('div', { class: 'kpis', style: { gridTemplateColumns: 'repeat(4, 1fr)' } },
      kpi(String(k.drinksUsed), 'Getränkemarken eingelöst', `${k.drinksTotal ? Math.round((k.drinksUsed / k.drinksTotal) * 100) : 0} % des Kontingents${k.drinksBudget ? ` · Budget ${k.drinksBudget}` : ''}`, { suffix: `/ ${k.drinksTotal}` }),
      kpi(String(k.mealsUsed), 'Essensmarken eingelöst', `Ausgabe bis ${store.settings?.catering?.ausgabeBis || '23:00'}`, { suffix: `/ ${k.mealsTotal}` }),
      kpi(String(k.stationsOnline), 'Stationen aktiv', { text: ov.stations.filter((s) => s.online).map((s) => s.name.replace('Station ', '')).join(' · ') || 'keine online', tone: k.stationsOnline ? 'var(--color-success)' : 'var(--color-error)' }, { suffix: `/ ${k.stationsGesamt}` }),
      kpi(String(k.abgelehnt), 'Abgelehnte Codes', { text: 'bereits benutzt — kein Verlust', tone: 'var(--color-error)' }, { tone: k.abgelehnt ? 'var(--color-error)' : undefined })),

    h('div', { class: 'cols-2' },
      panel([ic('users', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Guthaben pro Person'),
        h('span', { class: 'chip right', onclick: () => { mazeFilter = ''; refresh(); } }, ic('filter', 13), mazeFilter || 'Maze: Alle'),
        ...mazes.map((m) => h('span', { class: 'chip' + (mazeFilter === m.name ? ' active' : ''), onclick: () => { mazeFilter = mazeFilter === m.name ? '' : m.name; refresh(); } }, m.short))],
        h('div', { class: 'tbl-wrap' },
          h('table', { class: 'tbl' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Person'), h('th', {}, 'Einsatz'), h('th', {}, 'Getränke (Rest)'), h('th', {}, 'Essen (Rest)'), h('th', {}, 'Zuletzt eingelöst'), h('th', {}, ''))),
            h('tbody', {}, rows.map((r) => {
              const dRest = r.drinks.total - r.drinks.used, mRest = r.meals.total - r.meals.used;
              return h('tr', {},
                h('td', { class: 'b' }, r.name),
                h('td', {}, r.einsatz),
                h('td', {}, dRest === 0 ? badge('warn', `${dRest} / ${r.drinks.total} · leer`) : h('span', { class: 'num' }, `${dRest} / ${r.drinks.total}`)),
                h('td', {}, h('span', { class: 'num' }, `${mRest} / ${r.meals.total}`)),
                h('td', { class: 'muted' }, r.zuletzt || '—'),
                h('td', {}, h('button', {
                  class: 'btn sm quiet',
                  onclick: () => act(async () => {
                    await post('/api/catering/quota', { scope: { type: 'person', personId: r.personId }, drinks: 1, meals: 0 });
                    refresh();
                  }, `+1 Getränk für ${r.name}`),
                }, 'Aufladen')));
            })))),
        { scroll: true, bodyStyle: { padding: 0 } }),

      h('div', { class: 'col', style: { gap: '14px', minHeight: 0 } },
        quotaPanel(mazes, refresh),
        panel([ic('qr', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Stationen'),
          h('button', { class: 'btn sm quiet right', onclick: () => stationSheet(refresh) }, ic('plus', 13))],
          ov.stations.map((s) => h('div', { class: 'prow', style: { gap: '10px' } },
            h('span', { style: { width: '34px', height: '34px', borderRadius: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-muted)', color: 'var(--fg-secondary)' } }, ic('cup', 17)),
            h('div', { class: 'col grow', style: { gap: 0 } },
              h('span', { class: 'nm', style: { fontSize: '13px' } }, s.name),
              h('span', { class: 'mt' }, s.online ? `${s.operator} · ${s.place}` : 'nicht besetzt')),
            badge(s.online ? 'ok' : 'plain', s.online ? `${s.einloesungen} Einlösungen` : 'offline', { dot: s.online }))),
          { bodyStyle: { gap: 0, paddingTop: '2px' } }),
        panel([ic('clock', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Letzte Einlösungen'),
          h('button', { class: 'btn sm quiet right', onclick: () => download('/api/csv/export/catering') }, ic('download', 13), 'CSV')],
          ov.letzte.slice(0, 8).map((r) => h('div', { class: 'prow', style: { gap: '10px' } },
            h('span', { class: 'f-time', style: { width: '38px', fontSize: '11px', color: 'var(--fg-muted)' } }, r.time),
            av(r.personName),
            h('div', { class: 'col grow', style: { gap: 0 } },
              h('span', { class: 'nm', style: { fontSize: '13px' } }, r.personName),
              h('span', { class: 'mt' }, r.einsatz || r.stationName)),
            badge('plain', [r.drinks ? `${r.drinks} Getränk${r.drinks > 1 ? 'e' : ''}` : null, r.meals ? `${r.meals} Essen` : null].filter(Boolean).join(' · ')))),
          { grow: true, scroll: true, bodyStyle: { gap: 0, paddingTop: '2px' } }))));
}

function quotaPanel(mazes, refresh) {
  let scope = { type: 'all' };
  const drinks = h('input', { type: 'number', value: store.settings?.catering?.drinksDefault ?? 3, min: 0, style: { width: '60px', textAlign: 'center' } });
  const meals = h('input', { type: 'number', value: store.settings?.catering?.mealsDefault ?? 1, min: 0, style: { width: '60px', textAlign: 'center' } });
  const scopeRow = h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } });
  const drawScope = () => scopeRow.replaceChildren(
    h('span', { class: 'chip' + (scope.type === 'all' ? ' active' : ''), onclick: () => { scope = { type: 'all' }; drawScope(); } }, 'Gesamte Crew'),
    ...mazes.map((m) => h('span', {
      class: 'chip' + (scope.type === 'maze' && scope.mazeId === m.id ? ' active' : ''),
      onclick: () => { scope = { type: 'maze', mazeId: m.id }; drawScope(); },
    }, m.name)));
  drawScope();
  return panel([ic('plus', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Kontingent zuweisen')],
    h('div', { class: 'col', style: { gap: '12px' } },
      h('label', { class: 'fld' }, 'Empfänger', scopeRow),
      h('div', { class: 'row', style: { gap: '12px' } },
        h('label', { class: 'fld grow' }, 'Getränkemarken',
          h('div', { class: 'inp', style: { justifyContent: 'space-between' } }, ic('cup', 16, { color: 'var(--fg-muted)' }), drinks, h('span', { class: 'sub' }, 'pro Person'))),
        h('label', { class: 'fld grow' }, 'Essensmarken',
          h('div', { class: 'inp', style: { justifyContent: 'space-between' } }, ic('door', 16, { color: 'var(--fg-muted)' }), meals, h('span', { class: 'sub' }, 'pro Person')))),
      h('div', { class: 'row', style: { gap: '8px' } },
        h('span', { class: 'sub grow' }, `Gilt für: ${store.settings?.nightLabel || 'heute'} · zusätzlich zum bestehenden Guthaben`),
        h('button', {
          class: 'btn sm',
          onclick: () => act(async () => {
            const r = await post('/api/catering/quota', { scope, drinks: Number(drinks.value), meals: Number(meals.value) });
            toast(`Kontingent an ${r.personen} Personen verteilt`, 'ok');
            refresh();
          }),
        }, 'Zuweisen'))));
}

function stationSheet(refresh) {
  const name = h('input', { placeholder: 'z. B. Station West' });
  const place = h('input', { placeholder: 'Standort' });
  sheet({
    title: 'Station anlegen', icon: 'cup', tone: 'ok', center: true,
    content: (close) => h('div', { class: 'col', style: { gap: '12px' } },
      h('label', { class: 'fld' }, 'Name', h('div', { class: 'inp' }, name)),
      h('label', { class: 'fld' }, 'Ort', h('div', { class: 'inp' }, place)),
      h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px' } },
        h('button', { class: 'btn quiet', onclick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn orange',
          onclick: () => act(async () => { await post('/api/catering/stations', { name: name.value.trim(), place: place.value.trim() }); close(); refresh(); }, 'Station angelegt'),
        }, 'Anlegen'))),
  });
}
