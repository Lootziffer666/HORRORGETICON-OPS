// Management · Anwesenheit — wer ist da, wer fehlt, wer ist stumm;
// Fremd-Check-in für vergessene Handys; Hinweis auf unverknüpfte Profile.
import { h, ic, badge, av } from '../core/dom.js';
import { get, post, act } from '../core/api.js';
import { on } from '../core/store.js';
import { ago } from '../core/fmt.js';
import { statusBadge, ACTOR_STATUS_META } from './shared.js';

let filter = 'alle';

export async function attendanceView({ onCleanup, refresh }) {
  const ov = await get('/api/live/overview');
  onCleanup(on(['live', 'people'], refresh));

  const groups = {
    alle: () => true,
    da: (r) => r.status !== 'out',
    fehlt: (r) => r.status === 'out',
    pause: (r) => r.status === 'pause',
    stumm: (r) => r.status === 'stumm',
    unverknuepft: (r) => r.selfCreated,
  };
  const rows = ov.people.filter(groups[filter] || groups.alle)
    .sort((a, b) => (a.status === 'out' ? 0 : 1) - (b.status === 'out' ? 0 : 1) || a.name.localeCompare(b.name, 'de'));

  const chips = [['alle', `Alle (${ov.people.length})`], ['da', `Anwesend (${ov.people.filter(groups.da).length})`],
    ['fehlt', `Fehlen (${ov.people.filter(groups.fehlt).length})`], ['pause', `Pause (${ov.people.filter(groups.pause).length})`],
    ['stumm', `Verbindung? (${ov.people.filter(groups.stumm).length})`],
    ['unverknuepft', `Unverknüpft (${ov.people.filter(groups.unverknuepft).length})`]];

  return h('div', { class: 'col', style: { gap: '12px', flex: 1, minHeight: 0 } },
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      ...chips.map(([id, label]) => h('span', {
        class: 'chip' + (filter === id ? ' active' : ''),
        onclick: () => { filter = id; refresh(); },
      }, label)),
      h('div', { style: { flex: 1 } }),
      h('span', { class: 'sub', style: { fontWeight: 700 } }, `Schichtfenster ${ovShift()}`)),
    h('div', { class: 'panel grow', style: { overflow: 'hidden', display: 'flex' } },
      h('div', { class: 'tbl-wrap' },
        h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Person'), h('th', {}, 'Einsatz'), h('th', {}, 'Status'),
            h('th', {}, 'Seit'), h('th', {}, 'Zuletzt gesehen'), h('th', {}, 'Akku'), h('th', {}, ''))),
          h('tbody', {}, rows.map((r) => h('tr', {},
            h('td', { class: 'b' }, h('div', { class: 'row', style: { gap: '8px' } },
              av(r.name), h('div', { class: 'col', style: { gap: 0 } },
                h('span', {}, r.name),
                r.selfCreated && h('span', { class: 'sub', style: { color: '#b8901c' } }, '⚠ Profil unverknüpft')))),
            h('td', {}, r.maze ? `${r.maze} · ${r.position}` : (r.roles || []).join(', ')),
            h('td', {}, h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
              statusBadge(r.status),
              r.actorStatus && r.actorStatus !== 'da' && r.status !== 'out' &&
                badge('plain', ACTOR_STATUS_META[r.actorStatus]?.label || r.actorStatus),
              r.late && badge('warn', `⏰ +${r.late.etaMin} min`, { dot: true }))),
            h('td', { class: 'num' }, r.since ? new Date(r.since).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '—'),
            h('td', { class: 'muted' }, r.status === 'out' ? '—' : ago(r.lastSeen)),
            h('td', { class: 'num' }, r.battery != null && r.status !== 'out' ? `${r.battery}%` : '—'),
            h('td', {}, r.status === 'out'
              ? h('button', {
                class: 'btn sm quiet',
                onclick: () => act(async () => { await post('/api/live/checkin', { personId: r.id }); refresh(); }, `${r.name} eingecheckt`),
              }, 'Einchecken')
              : h('button', {
                class: 'btn sm quiet',
                onclick: () => act(async () => { await post('/api/live/checkout', { personId: r.id }); refresh(); }, `${r.name} ausgecheckt`),
              }, 'Auschecken'))))))),
    ),
    h('span', { class: 'sub' }, `${rows.length} von ${ov.people.length} · Stand ${ov.time} · „Verbindung?“ = 90 s kein Lebenszeichen vom Gerät`));
}

import { store } from '../core/store.js';
function ovShift() {
  const s = store.settings;
  return s ? `${s.shiftStart} – ${s.shiftEnd}` : '18:00 – 01:00';
}
