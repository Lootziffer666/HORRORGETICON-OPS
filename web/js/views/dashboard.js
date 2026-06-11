// Management · Dashboard — KPIs, „Meldungen — jetzt entscheiden“,
// Pausen-Anfragen, Offene Positionen, Maze-Status (Mockup MgmtDashboard).
import { h, ic, badge, bar, panel } from '../core/dom.js';
import { get, patch, act } from '../core/api.js';
import { on, store } from '../core/store.js';
import { prioTone, prioLabel, kpi, breakRequestCard } from './shared.js';
import { sheet } from '../core/ui.js';

export async function dashboardView({ onCleanup, refresh }) {
  const [ov, incidents, breaks, issues, readiness] = await Promise.all([
    get('/api/live/overview'),
    get('/api/incidents?status=offen'),
    get('/api/breaks?status=offen'),
    get('/api/assignments/issues'),
    get('/api/checklists/readiness').catch(() => null),
  ]);
  onCleanup(on(['live', 'breaks', 'incidents', 'mazes', 'checklists', 'settings'], refresh));

  const k = ov.kpi;
  const openCritical = incidents.filter((i) => i.status === 'offen' || i.status === 'in_arbeit').slice(0, 4);
  const phase = store.settings?.phase || 'live';
  // „Sind wir bereit?“ — vor Showstart prominent (horrops_fullstack.md)
  const readyRow = phase !== 'live' && phase !== 'abschluss' && readiness && readiness.some((r) => r.listen > 0) &&
    h('div', { class: 'card pad row', style: { gap: '8px', flexWrap: 'wrap', borderColor: readiness.every((r) => r.bereit || !r.listen) ? 'var(--color-success)' : 'var(--color-warning)' } },
      h('span', { style: { fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: '14px' } }, 'Sind wir bereit?'),
      ...readiness.map((r) => badge(r.bereit ? 'ok' : r.listen ? 'err' : 'plain',
        `${r.maze}${r.bereit ? ' ✓' : r.listen ? `: ${r.pflichtOffen} Pflicht offen` : ': keine Rundgänge'}`, { dot: r.listen > 0 })),
      h('span', { class: 'link right', onclick: () => { location.hash = '#/aufgaben'; } }, 'Zu den Rundgängen'));

  return h('div', { class: 'col', style: { gap: '14px', flex: 1, minHeight: 0 } },
    readyRow,
    h('div', { class: 'kpis', style: { gridTemplateColumns: 'repeat(4, 1fr)' } },
      kpi(String(k.anwesend), 'Anwesend (Crew)', { text: k.fehlen > 0 ? `${k.fehlen} fehlen${k.unverknuepft ? ` · ${k.unverknuepft} unverknüpft` : ''}` : 'alle da 🎉', tone: k.fehlen > 0 ? 'var(--color-error)' : 'var(--color-success)' }, { suffix: `/ ${k.crewGesamt}` }),
      kpi(String(k.positionenBesetzt), 'Positionen besetzt', { text: `${k.positionenGesamt - k.positionenBesetzt} offen — ${issues.open.length} ohne Zuteilung`, tone: '#b8901c' }, { suffix: `/ ${k.positionenGesamt}` }),
      kpi(String(k.aktivePausen), 'Aktive Pausen', `${k.offenePausen} Anfragen warten`),
      kpi(String(k.offeneMeldungen), 'Offene Meldungen', { text: k.hochPrio ? `${k.hochPrio} × Priorität hoch` : 'keine hohe Priorität', tone: k.hochPrio ? 'var(--color-error)' : undefined }, { tone: k.offeneMeldungen ? 'var(--color-error)' : undefined, alert: k.hochPrio > 0 })),

    h('div', { class: 'cols-dash' },
      panel([ic('alert', 16, { color: 'var(--color-error)' }), h('span', { class: 't' }, 'Meldungen — jetzt entscheiden'),
        h('span', { class: 'link', onclick: () => { location.hash = '#/meldungen'; } }, `Alle ${incidents.length}`)],
        openCritical.length === 0 ? h('div', { class: 'empty-hint' }, 'Nichts offen — ruhige Lage. 🦇')
          : openCritical.map((m) => h('div', { class: 'prow', style: { alignItems: 'flex-start', gap: '10px' } },
            badge(prioTone[m.prio], prioLabel[m.prio], { dot: true }),
            h('div', { class: 'col grow', style: { gap: '1px' } },
              h('span', { class: 'nm', style: { fontSize: '13px' } }, m.text),
              h('span', { class: 'mt' }, `${m.time} · ${m.by}${m.ort ? ' · ' + m.ort : ''}${m.overdue ? ' · ' : ''}`,
                m.overdue && h('b', { class: 'danger-text' }, `SLA +${Math.abs(m.slaLeftMin)} min`))),
            h('button', {
              class: 'btn sm quiet',
              onclick: () => decideSheet(m, refresh),
            }, m.status === 'offen' ? 'Entscheiden' : 'Öffnen'))),
        { bodyStyle: { gap: 0, paddingTop: '2px' } }),

      panel([ic('pause', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Pausen-Anfragen'),
        breaks.length ? badge('warn', String(breaks.length)) : badge('ok', '0')],
        breaks.length === 0 ? h('div', { class: 'empty-hint' }, 'Keine offenen Anfragen.')
          : breaks.slice(0, 4).map((b, i) => h('div', { class: 'col', style: { gap: '8px', paddingTop: i ? '10px' : 0, borderTop: i ? '1px solid var(--border-muted)' : 'none' } },
            breakRequestCard(b, { compact: true, onDone: refresh }))),
        { scroll: true }),

      h('div', { class: 'col', style: { gap: '14px', minHeight: 0 } },
        panel([ic('pin', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Offene Positionen'),
          issues.open.length ? badge('err', String(issues.open.length)) : badge('ok', '0')],
          issues.open.length === 0 ? h('div', { class: 'empty-hint' }, 'Alles besetzt.')
            : issues.open.slice(0, 4).map((o) => h('div', { class: 'prow', style: { gap: '10px' } },
              h('div', { class: 'col grow', style: { gap: 0 } },
                h('span', { class: 'nm', style: { fontSize: '13px' } }, `${o.code} ${o.name ? `„${o.name}“` : ''}`,
                  h('span', { class: 'muted', style: { fontWeight: 600 } }, ` · ${o.maze}`)),
                h('span', { class: 'mt' }, o.desc || '')),
              h('button', { class: 'btn sm quiet', onclick: () => { location.hash = '#/mazes'; } }, 'Besetzen'))),
          { bodyStyle: { gap: 0, paddingTop: '2px' } }),
        panel([ic('door', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Maze-Status')],
          ov.mazes.map((m) => h('div', { class: 'row', style: { gap: '10px' } },
            h('span', { style: { fontSize: '12.5px', fontWeight: 700, width: '86px' } }, m.name),
            bar(m.total ? (m.besetzt / m.total) * 100 : 0, m.status === 'err' ? 'err' : m.status === 'warn' ? 'warn' : 'ok'),
            h('span', { class: 'num', style: { fontSize: '12px', width: '40px', textAlign: 'right' } }, `${m.besetzt}/${m.total}`))),
          { grow: true, bodyStyle: { gap: '9px', paddingTop: '10px' } }))));
}

function decideSheet(m, refresh) {
  sheet({
    title: m.text, icon: 'alert', tone: prioTone[m.prio] === 'err' ? 'err' : 'warn', center: true,
    sub: `${m.time} · ${m.by}${m.ort ? ' · ' + m.ort : ''} · ${prioLabel[m.prio]}`,
    content: (close) => h('div', { class: 'row', style: { gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' } },
      h('button', {
        class: 'btn', onclick: async () => {
          await act(() => patch(`/api/incidents/${m.id}`, { status: 'in_arbeit' }), 'Übernommen');
          close(); refresh();
        },
      }, ic('check', 15), 'Übernehmen'),
      h('button', {
        class: 'btn', style: { background: 'var(--color-success)', color: '#fff' },
        onclick: async () => {
          await act(() => patch(`/api/incidents/${m.id}`, { status: 'erledigt' }), 'Erledigt');
          close(); refresh();
        },
      }, ic('check', 15), 'Erledigt'),
      h('button', { class: 'btn quiet', onclick: close }, 'Schließen')),
  });
}
