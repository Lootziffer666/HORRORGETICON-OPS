// Management · Einstellungen — Event, Schichtfenster, Catering-Budgets,
// Fahrgruppen-Parameter, eigene Orte, Darstellung (Dark Mode)
import { h, ic, badge, panel } from '../core/dom.js';
import { get, patch, post, del, act } from '../core/api.js';
import { on, store } from '../core/store.js';
import { toast } from '../core/ui.js';

export async function settingsView({ onCleanup, refresh }) {
  const [s, orte] = await Promise.all([get('/api/settings'), get('/api/settings/orte')]);
  onCleanup(on(['settings'], refresh));

  const f = {
    eventName: h('input', { value: s.eventName || '' }),
    nightLabel: h('input', { value: s.nightLabel || '' }),
    eventDate: h('input', { type: 'date', value: s.eventDate || '' }),
    shiftStart: h('input', { type: 'time', value: s.shiftStart || '18:00' }),
    shiftEnd: h('input', { type: 'time', value: s.shiftEnd || '01:00' }),
    drinksBudget: h('input', { type: 'number', value: s.catering?.drinksBudget ?? 240 }),
    mealsBudget: h('input', { type: 'number', value: s.catering?.mealsBudget ?? 60 }),
    drinksDefault: h('input', { type: 'number', value: s.catering?.drinksDefault ?? 3 }),
    mealsDefault: h('input', { type: 'number', value: s.catering?.mealsDefault ?? 1 }),
    ausgabeBis: h('input', { type: 'time', value: s.catering?.ausgabeBis || '23:00' }),
    tolMin: h('input', { type: 'number', value: s.carpool?.tolMinDefault ?? 20 }),
    maxUmweg: h('input', { type: 'number', value: s.carpool?.maxUmwegKm ?? 25 }),
  };
  const fld = (label, input) => h('label', { class: 'fld' }, label, h('div', { class: 'inp' }, input));

  const save = () => act(async () => {
    await patch('/api/settings', {
      eventName: f.eventName.value, nightLabel: f.nightLabel.value, eventDate: f.eventDate.value,
      shiftStart: f.shiftStart.value, shiftEnd: f.shiftEnd.value,
      catering: {
        drinksBudget: Number(f.drinksBudget.value), mealsBudget: Number(f.mealsBudget.value),
        drinksDefault: Number(f.drinksDefault.value), mealsDefault: Number(f.mealsDefault.value),
        ausgabeBis: f.ausgabeBis.value,
      },
      carpool: { tolMinDefault: Number(f.tolMin.value), maxUmwegKm: Number(f.maxUmweg.value) },
    });
  }, 'Einstellungen gespeichert');

  const dark = document.documentElement.dataset.theme === 'dark';

  return h('div', { class: 'col scroll-y', style: { gap: '14px', flex: 1, maxWidth: '860px' } },
    panel([ic('cal', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Event')],
      h('div', { class: 'col', style: { gap: '12px' } },
        h('div', { class: 'grid2' }, fld('Event-Name', f.eventName), fld('Nacht-Label (Topbar)', f.nightLabel)),
        h('div', { class: 'grid3' }, fld('Datum', f.eventDate), fld('Schichtbeginn', f.shiftStart), fld('Schichtende', f.shiftEnd)))),
    panel([ic('cup', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Catering')],
      h('div', { class: 'col', style: { gap: '12px' } },
        h('div', { class: 'grid2' }, fld('Getränke-Budget (Nacht)', f.drinksBudget), fld('Essen-Budget (Nacht)', f.mealsBudget)),
        h('div', { class: 'grid3' }, fld('Standard Getränke/Person', f.drinksDefault), fld('Standard Essen/Person', f.mealsDefault), fld('Essens-Ausgabe bis', f.ausgabeBis)))),
    panel([ic('car', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Fahrgruppen')],
      h('div', { class: 'grid2' }, fld('Zeit-Toleranz Fahrer (min)', f.tolMin), fld('max. Umweg (km)', f.maxUmweg))),
    panel([ic('pin', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Eigene Orte (Fahrgruppen-Matching)'),
      h('button', { class: 'btn sm quiet right', onclick: () => addOrt(refresh) }, ic('plus', 13), 'Ort')],
      orte.length === 0 ? h('span', { class: 'sub' }, 'Keine eigenen Orte — die eingebaute Liste rund ums Gelände greift.')
        : h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
          orte.map((o) => h('span', { class: 'chip' }, `${o.name}`,
            h('span', { style: { cursor: 'pointer', marginLeft: '4px' }, onclick: () => act(async () => { await del(`/api/settings/orte/${o.id}`); refresh(); }) }, '✕'))))),
    panel([ic('eye', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Darstellung')],
      h('div', { class: 'row', style: { gap: '8px' } },
        h('span', { class: 'chip' + (dark ? '' : ' active'), onclick: () => setTheme(null) }, '☀️ Hell'),
        h('span', { class: 'chip' + (dark ? ' active' : ''), onclick: () => setTheme('dark') }, '🌙 Dunkel (Backstage)'),
        h('span', { class: 'sub' }, 'Dunkel schont die Augen im Leitstand bei Nacht.'))),
    h('div', { class: 'row' },
      h('div', { style: { flex: 1 } }),
      h('button', { class: 'btn orange', onclick: save }, ic('check', 15), 'Speichern')));
}

function setTheme(v) {
  if (v) document.documentElement.dataset.theme = v;
  else delete document.documentElement.dataset.theme;
  localStorage.setItem('hgo.theme', v || '');
  toast('Darstellung umgestellt — Einstellung bleibt auf diesem Gerät', 'ok');
}

function addOrt(refresh) {
  const name = prompt('Ortsname:');
  if (!name) return;
  const lat = Number(prompt('Breitengrad (z. B. 51.51):'));
  const lon = Number(prompt('Längengrad (z. B. 9.49):'));
  act(async () => { await post('/api/settings/orte', { name, lat, lon }); refresh(); }, 'Ort angelegt');
}
