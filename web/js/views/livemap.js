// Management · Live-Karte — Gelände-Zonen + Maze-Detail (Mockup MgmtMap)
import { h, ic, badge, panel } from '../core/dom.js';
import { get } from '../core/api.js';
import { on } from '../core/store.js';
import { siteMapEl, mazeMapEl, mazeLegend, statusBadge } from './shared.js';

let selectedMazeId = null;

export async function livemapView({ onCleanup, refresh }) {
  const ov = await get('/api/live/overview');
  onCleanup(on(['live', 'incidents', 'breaks', 'mazes'], refresh));

  if (!selectedMazeId || !ov.mazes.some((m) => m.id === selectedMazeId)) {
    const warn = ov.mazes.find((m) => m.status !== 'ok');
    selectedMazeId = (warn || ov.mazes[0])?.id || null;
  }
  const sel = ov.mazes.find((m) => m.id === selectedMazeId);
  const detail = sel ? await get(`/api/live/maze/${sel.id}`) : null;

  const side = panel(
    [ic('door', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, `${sel?.name || '—'} — Detail`),
      sel && badge(sel.status === 'ok' ? 'ok' : sel.status, sel.status === 'ok' ? 'Ruhig' : sel.status === 'warn' ? 'Beobachten' : 'Kritisch', { dot: true })],
    !detail ? h('div', { class: 'empty-hint' }, 'Maze wählen')
      : h('div', { class: 'col', style: { gap: 0 } },
        detail.lead && h('div', { class: 'prow', style: { gap: '8px', padding: '7px 0' } },
          ic('users', 15, { color: 'var(--fg-muted)' }),
          h('span', { class: 'mt' }, `Lead: ${detail.lead}`)),
        ...detail.positions.map((p) => h('div', { class: 'prow', style: { gap: '8px', padding: '7px 0' } },
          h('div', { class: 'col grow', style: { gap: 0 } },
            h('span', { class: 'nm', style: { fontSize: '12.5px' } }, `${p.code} ${p.name || ''}`),
            h('span', { class: 'mt' }, p.person?.name || '—')),
          statusBadge(p.status)))),
    { scroll: true, bodyStyle: { gap: 0, paddingTop: '2px' } });
  side.classList.add('side');

  return h('div', { class: 'col', style: { gap: '12px', flex: 1, minHeight: 0 } },
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      h('span', { class: 'sub', style: { fontWeight: 700 } }, `Stand ${ov.time} · ${ov.kpi.anwesend}/${ov.kpi.crewGesamt} anwesend · ${ov.kpi.offeneMeldungen} offene Meldungen`),
      h('div', { style: { flex: 1 } }),
      h('span', { class: 'legend', style: { gap: '12px' } },
        h('span', {}, h('i', { style: { background: 'var(--color-success)' } }), 'Ruhig'),
        h('span', {}, h('i', { style: { background: 'var(--color-warning)' } }), 'Beobachten'),
        h('span', {}, h('i', { style: { background: 'var(--color-error)' } }), 'Kritisch'))),
    h('div', { class: 'cols-map' },
      h('div', { class: 'col grow', style: { gap: '10px', minHeight: 0 } },
        siteMapEl(ov, { activeId: selectedMazeId, onZone: (m) => { selectedMazeId = m.id; refresh(); } }),
        detail && h('div', { class: 'col', style: { gap: '8px' } },
          h('div', { class: 'row' },
            h('span', { class: 'overline' }, `Maze-Karte · ${detail.name}`),
            h('div', { style: { flex: 1 } }),
            mazeLegend()),
          mazeMapEl(detail, { height: 260 }))),
      side));
}
