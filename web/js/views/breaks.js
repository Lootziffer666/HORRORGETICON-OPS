// Management/Lead · Pausen — offene Anfragen mit Freigabe, laufende Pausen
// mit Rückkehr-Knopf, Verlauf, Springer-Liste, Pausenplan-Link.
import { h, ic, badge, av, panel } from '../core/dom.js';
import { get, post, act } from '../core/api.js';
import { on } from '../core/store.js';
import { minSince } from '../core/fmt.js';
import { breakRequestCard } from './shared.js';

export async function breaksView({ onCleanup, refresh }) {
  const [open, running, done, springer] = await Promise.all([
    get('/api/breaks?status=offen'),
    get('/api/breaks?status=läuft'),
    get('/api/breaks?status=beendet'),
    get('/api/breaks/springer'),
  ]);
  onCleanup(on(['breaks', 'live'], refresh));

  return h('div', { class: 'col', style: { gap: '14px', flex: 1, minHeight: 0 } },
    h('div', { class: 'cols-dash', style: { gridTemplateColumns: '1.2fr 1fr 1fr' } },
      panel([ic('pause', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Anfragen'),
        badge(open.length ? 'warn' : 'ok', `${open.length} ${open.length === 1 ? 'wartet' : 'warten'}`)],
        open.length === 0 ? h('div', { class: 'empty-hint' }, 'Keine offenen Anfragen.')
          : open.map((b, i) => h('div', { class: 'col', style: { gap: '8px', paddingTop: i ? '12px' : 0, borderTop: i ? '1px solid var(--border-muted)' : 'none' } },
            breakRequestCard(b, { onDone: refresh }))),
        { scroll: true }),

      panel([ic('clock', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Gerade in Pause'), badge('info', String(running.length))],
        running.length === 0 ? h('div', { class: 'empty-hint' }, 'Niemand in Pause.')
          : running.map((b) => h('div', { class: 'prow', style: { gap: '10px' } },
            av(b.person),
            h('div', { class: 'col grow', style: { gap: 0 } },
              h('span', { class: 'nm' }, `${b.person}${b.position ? ' · ' + b.position : ''}`),
              h('span', { class: 'mt' }, `seit ${minSince(b.startedAt)} min · geplant ${b.durationMin} min${b.springerId ? ' · Springer eingesprungen' : ''}`)),
            h('button', {
              class: 'btn sm quiet',
              onclick: () => act(async () => { await post(`/api/breaks/${b.id}/end`); refresh(); }, `${b.person} ist zurück`),
            }, 'Zurück')),
          ),
        { scroll: true, bodyStyle: { gap: 0, paddingTop: '2px' } }),

      h('div', { class: 'col', style: { gap: '14px', minHeight: 0 } },
        panel([ic('users', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Springer')],
          springer.length === 0 ? h('div', { class: 'empty-hint' }, 'Keine Springer angelegt.')
            : springer.map((s) => h('div', { class: 'prow', style: { gap: '10px' } },
              av(s.name),
              h('span', { class: 'nm grow' }, s.name),
              badge(s.frei ? 'ok' : 'plain', s.frei ? 'Frei' : s.status === 'out' ? 'Nicht da' : 'Im Einsatz', { dot: s.frei }))),
          { bodyStyle: { gap: 0, paddingTop: '2px' } }),
        panel([ic('cal', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Verlauf heute'), badge('plain', String(done.length))],
          done.slice(0, 12).map((b) => h('div', { class: 'prow', style: { gap: '10px', padding: '7px 0' } },
            h('span', { class: 'f-time', style: { width: '38px', fontSize: '11px', color: 'var(--fg-muted)' } }, b.time),
            h('div', { class: 'col grow', style: { gap: 0 } },
              h('span', { class: 'nm', style: { fontSize: '12.5px' } }, b.person),
              h('span', { class: 'mt' }, `${b.startedAt && b.endedAt ? Math.round((b.endedAt - b.startedAt) / 60000) + ' min' : '—'}${b.approvedBy ? ' · ' + b.approvedBy : ''}`)))),
          { grow: true, scroll: true, bodyStyle: { gap: 0, paddingTop: '2px' } }))));
}
