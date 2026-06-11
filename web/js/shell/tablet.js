// Tablet-Shell (Maze Lead) — adaptives Split-Layout (Mockup lead-tablet.jsx):
// Links Team + Pausen, rechts Live-Karte + Vorfälle. Tabs: Team/Karte · Meldungen · Chat · Mehr.
import { h, ic, ghostMark, badge, mount } from '../core/dom.js';
import { get, post, patch as apiPatch, act } from '../core/api.js';
import { on, store } from '../core/store.js';
import { guardedView } from '../core/ui.js';
import { hhmm, minSince } from '../core/fmt.js';
import { logout, switchRole } from '../app.js';
import { mazeMapEl, mazeLegend, breakRequestCard, announceSheet, statusBadge, prioTone, prioLabel, phaseBadge, ACTOR_STATUS_META } from '../views/shared.js';
import { chatView } from '../views/chat.js';
import { incidentsView } from '../views/incidents.js';
import { breaksView } from '../views/breaks.js';
import { leadTasksView, checklistRow, checklistSheet } from '../views/tasks.js';

export function renderTablet(root) {
  const body = h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } });
  const liveClock = h('span', { class: 'live-dot' }, h('i'), `LIVE · ${hhmm(Date.now())}`);
  setInterval(() => { liveClock.lastChild.textContent = `LIVE · ${hhmm(Date.now())}`; }, 15000);
  // Phase nur zeigen, wenn nicht „live“ (live steckt schon in der Live-Uhr)
  const phaseEl = h('span');
  const drawPhase = () => {
    const phase = store.settings?.phase || 'vorbereitung';
    mount(phaseEl, phase === 'live' ? '' : phaseBadge(phase));
  };
  drawPhase();
  on('settings', drawPhase);

  // „Meine“ Maze früh auflösen (für Aufgaben-Inbox & Durchsagen)
  get('/api/mazes').then((mazes) => {
    const mine = mazes.find((m) => m.lead === store.me.person.name);
    if (mine) myMazeId = mine.id;
  }).catch(() => { /* Lage-View löst nach */ });

  const badges = h('div', { class: 'row', style: { gap: '8px' } });
  const tabs = [
    ['lage', 'Lage', 'users'], ['aufgaben', 'Aufgaben', 'list'], ['meldungen', 'Meldungen', 'alert'],
    ['pausen', 'Pausen', 'pause'], ['chat', 'Chat', 'chat'], ['mehr', 'Mehr', 'doc'],
  ];
  let active = 'lage';
  const tabRow = h('div', { class: 'row', style: { gap: '6px' } });

  const drawTabs = () => {
    tabRow.replaceChildren(...tabs.map(([id, label, icon]) =>
      h('span', { class: 'chip' + (active === id ? ' active' : ''), onclick: () => { active = id; route(); } },
        ic(icon, 13), label)));
  };

  let guard = null;
  const cleanups = [];
  const route = () => {
    drawTabs();
    guard?.stop();
    for (const fn of cleanups.splice(0)) fn();
    const ctx = { params: new URLSearchParams(), onCleanup: (fn) => cleanups.push(fn), refresh: () => guard.refresh() };
    const views = {
      lage: () => leadLageView(ctx, badges),
      aufgaben: () => leadTasksView(ctx, myMazeId),
      meldungen: () => incidentsView(ctx),
      pausen: () => breaksView(ctx),
      chat: () => chatView(ctx),
      mehr: () => leadMehrView(ctx),
    };
    guard = guardedView(body, views[active]);
  };

  mount(root, h('div', { class: 'theme app-frame' },
    h('div', { class: 'row', style: { padding: '10px 18px', gap: '12px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-default)', flex: 'none', flexWrap: 'wrap' } },
      ghostMark(34),
      h('div', { class: 'col', style: { gap: 0 } },
        h('span', { style: { fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: '17px' } }, 'Maze-Leitung'),
        h('span', { class: 'sub' }, `Maze Lead · ${store.me.person.name}`)),
      liveClock, phaseEl, badges,
      h('div', { style: { flex: 1 } }),
      tabRow,
      h('button', { class: 'btn danger sm', style: { padding: '9px 14px' }, onclick: () => announceSheet({ mazeId: myMazeId, level: 'notfall' }) }, ic('mega', 15), 'Warnung an Maze'),
      h('span', { style: { cursor: 'pointer', color: 'var(--fg-muted)' }, title: 'Rolle wechseln', onclick: switchRole }, ic('user', 18)),
      h('span', { style: { cursor: 'pointer', color: 'var(--fg-muted)' }, title: 'Abmelden', onclick: logout }, ic('out', 18))),
    h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '0' } }, body)));
  route();
}

let myMazeId = null;

// ── Lage: Split Team | Karte (Mockup) ──
async function leadLageView({ onCleanup, refresh }, badgesEl) {
  const ov = await get('/api/live/overview');
  // „Meine“ Maze: wo ich Lead bin, sonst wo ich zugeteilt bin, sonst die erste
  const mazes = await get('/api/mazes');
  const mine = mazes.find((m) => m.lead === store.me.person.name)
    || ov.mazes.find((m) => ov.people.some((p) => p.id === store.me.person.id && p.mazeId === m.id))
    || ov.mazes[0];
  myMazeId = mine?.id || null;
  const detail = mine ? await get(`/api/live/maze/${mine.id}`) : null;
  const breaks = await get(`/api/breaks?status=offen${mine ? `&maze=${mine.id}` : ''}`);
  const incidents = (await get('/api/incidents?status=offen')).filter((i) => !mine || i.mazeId === mine.id);
  onCleanup(on(['live', 'breaks', 'incidents', 'mazes'], refresh));

  const team = ov.people.filter((p) => p.mazeId === mine?.id);
  const inPause = team.filter((t) => t.status === 'pause').length;
  const offen = detail ? detail.positions.filter((p) => p.status === 'leer').length : 0;

  badgesEl.replaceChildren(...[
    badge('ok', `${team.filter((t) => t.status !== 'out').length}/${detail?.positions.length || 0} besetzt`, { dot: true }),
    incidents.length ? badge('err', `${incidents.length} Vorfall${incidents.length > 1 ? 'e' : ''}`, { dot: true }) : null,
  ].filter(Boolean));

  const kpis = h('div', { class: 'row', style: { gap: '10px' } },
    ...[[`${team.filter((t) => t.status !== 'out').length}/${detail?.positions.length || 0}`, 'besetzt', ''],
      [String(inPause), 'in Pause', ''], [String(breaks.length), 'Anfragen', breaks.length ? 'warn' : ''],
      [String(incidents.length), 'Vorfälle', incidents.length ? 'err' : '']].map(([v, l, tone]) =>
      h('div', { class: 'card pad col grow', style: { gap: '1px', padding: '9px 10px', alignItems: 'center' } },
        h('span', { class: 'num', style: { fontSize: '18px', color: tone === 'err' ? 'var(--color-error)' : tone === 'warn' ? '#b8901c' : 'var(--fg-primary)' } }, v),
        h('span', { class: 'sub', style: { fontSize: '10.5px', fontWeight: 700 } }, l))));

  return h('div', { class: 'lead-split' },
    h('div', { class: 'col', style: { gap: '12px', minHeight: 0 } },
      kpis,
      h('div', { class: 'panel', style: { flex: 'none' } },
        h('div', { class: 'panel-h' }, ic('pause', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Pausen-Anfragen'),
          badge(breaks.length ? 'warn' : 'ok', breaks.length ? `${breaks.length} wartet` : 'keine')),
        h('div', { class: 'panel-b', style: { gap: '10px' } },
          breaks.length === 0 ? h('span', { class: 'sub' }, 'Gerade keine Anfragen aus deiner Maze.')
            : breaks.map((b) => breakRequestCard(b, { compact: true, onDone: refresh })))),
      h('div', { class: 'panel grow', style: { minHeight: 0, overflow: 'hidden', display: 'flex' } },
        h('div', { class: 'panel-h' }, ic('users', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Team heute'),
          h('span', { class: 'link' }, `Alle ${team.length}`)),
        h('div', { class: 'panel-b scroll', style: { gap: 0, paddingTop: '2px' } },
          team.map((m) => h('div', { class: 'prow', style: { padding: '7.5px 0' } },
            h('span', { class: 'av' }, m.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()),
            h('div', { class: 'col grow', style: { gap: 0 } },
              h('span', { class: 'nm', style: { fontSize: '13px' } }, m.name),
              h('span', { class: 'mt' }, [`${m.position} · ${m.positionName || ''}`,
                m.actorStatus && m.actorStatus !== 'da' ? ACTOR_STATUS_META[m.actorStatus]?.label : null].filter(Boolean).join(' · '))),
            m.late && badge('warn', `⏰ +${m.late.etaMin} min`),
            statusBadge(m.status)))))),
    h('div', { class: 'col', style: { gap: '12px', minHeight: 0 } },
      detail ? mazeMapEl(detail, { grow: true }) : h('div', { class: 'empty-hint card grow' }, 'Keine Maze zugeordnet'),
      mazeLegend(),
      ...incidents.slice(0, 2).map((inc) => h('div', { class: 'panel', style: { borderColor: 'var(--color-error)', boxShadow: '0 0 0 1px var(--color-error), var(--shadow-1)', flex: 'none' } },
        h('div', { class: 'panel-h' },
          ic('alert', 16, { color: 'var(--color-error)' }),
          h('span', { class: 't' }, `Vorfall · ${inc.ort || mine?.name || ''}`),
          badge(prioTone[inc.prio], `${prioLabel[inc.prio]} · ${inc.time}`, { dot: true })),
        h('div', { class: 'panel-b', style: { gap: '10px', flexDirection: 'row', alignItems: 'center' } },
          h('span', { class: 'grow', style: { fontSize: '13px', lineHeight: 1.4 } }, inc.text),
          h('button', {
            class: 'btn sm quiet', style: { flex: 'none' },
            onclick: () => act(() => apiPatch(`/api/incidents/${inc.id}`, { status: 'in_arbeit', assignee: store.me.person.id }).then(refresh), 'Übernommen'),
          }, ic('check', 14), 'Übernehmen')))),
      offen > 0 && detail && (() => {
        const pos = detail.positions.find((p) => p.status === 'leer');
        return h('div', { class: 'card pad row', style: { gap: '10px', padding: '12px', flex: 'none' } },
          h('span', { class: 'av lg', style: { background: 'transparent', border: '2px dashed var(--fg-muted)', color: 'var(--fg-muted)', borderRadius: '12px' } }, pos.code),
          h('div', { class: 'col grow', style: { gap: '1px' } },
            h('span', { style: { fontSize: '13px', fontWeight: 700 } }, `${pos.code} ${pos.name ? `„${pos.name}“` : ''} unbesetzt`),
            h('span', { class: 'sub' }, `${offen} offene Position${offen > 1 ? 'en' : ''} in deiner Maze`)),
          h('button', { class: 'btn sm', onclick: () => besetzen(pos, refresh) }, 'Besetzen'));
      })()));
}

async function besetzen(pos, refresh) {
  const { sheet } = await import('../core/ui.js');
  const { av } = await import('../core/dom.js');
  const issues = await get('/api/assignments/issues');
  sheet({
    title: `${pos.code} besetzen`, icon: 'pin', tone: 'info', center: true,
    sub: 'Freie Personen (nicht zugeteilt, eingecheckt zuerst)',
    content: (close) => h('div', { class: 'col', style: { gap: 0, maxHeight: '50vh', overflow: 'auto' } },
      issues.unassigned.length === 0 ? h('div', { class: 'empty-hint' }, 'Niemand frei.')
        : issues.unassigned.map((p) => h('div', {
          class: 'prow click',
          onclick: () => act(async () => { await post(`/api/positions/${pos.id}/assign`, { personId: p.id }); close(); refresh(); }, `${p.name} → ${pos.code}`),
        }, av(p.name), h('span', { class: 'nm grow' }, p.name), ic('chev', 14)))),
  });
}

// ── Mehr: Rundgänge + Übergabeprotokoll + Pausenplan ──
async function leadMehrView({ onCleanup, refresh }) {
  const [plan, checklists] = await Promise.all([
    get('/api/schedule/breakplan'),
    get(`/api/checklists${myMazeId ? `?maze=${myMazeId}` : ''}`),
  ]);
  onCleanup(on(['checklists'], refresh));
  return h('div', { class: 'col scroll-y', style: { gap: '14px', padding: '14px' } },
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      h('button', { class: 'btn sm orange', onclick: () => announceSheet({ mazeId: myMazeId }) }, ic('mega', 14), 'Durchsage an meine Maze'),
      h('button', { class: 'btn sm quiet', onclick: switchRole }, ic('user', 14), 'Rolle wechseln'),
      h('button', { class: 'btn sm quiet', onclick: logout }, ic('out', 14), 'Abmelden')),

    h('div', { class: 'panel' },
      h('div', { class: 'panel-h' }, ic('check', 16, { color: 'var(--fg-muted)' }),
        h('span', { class: 't' }, 'Rundgänge & Checklisten'),
        checklists.some((c) => c.mandatoryOpen > 0)
          ? badge('warn', `${checklists.reduce((s, c) => s + c.mandatoryOpen, 0)} Pflicht offen`)
          : badge('ok', 'bereit ✓', { dot: true })),
      h('div', { class: 'panel-b', style: { gap: '12px' } },
        checklists.length === 0 ? h('span', { class: 'sub' }, 'Keine Rundgänge für deine Maze — das Management legt sie unter Aufgaben → Checklisten an.')
          : checklists.map((c) => checklistRow(c, refresh)))),

    h('div', { class: 'panel' },
      h('div', { class: 'panel-h' }, ic('doc', 16, { color: 'var(--fg-muted)' }),
        h('span', { class: 't' }, 'Übergabe & Nachbericht'),
        h('button', { class: 'btn sm quiet right', onclick: () => window.print() }, ic('doc', 13), 'Drucken')),
      h('div', { class: 'panel-b' }, await handoverBlock())),

    h('div', { class: 'panel' },
      h('div', { class: 'panel-h' }, ic('pause', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Pausenplan-Vorschlag'), h('span', { class: 'sub right' }, plan.hinweis)),
      h('div', { class: 'panel-b', style: { gap: '12px' } },
        plan.plan.map((m) => h('div', { class: 'col', style: { gap: '6px' } },
          h('span', { class: 'overline' }, m.maze),
          h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
            m.slots.map((s) => h('span', { class: 'chip', title: s.person }, h('b', {}, s.position), ` ${s.von}–${s.bis}`))))))));
}

async function handoverBlock() {
  const d = await get(`/api/reports/handover${myMazeId ? `?maze=${myMazeId}` : ''}`);
  const sec = (label, items, render) => h('div', { class: 'col', style: { gap: '3px' } },
    h('span', { class: 'overline' }, `${label} (${items.length})`),
    items.length === 0 ? h('span', { class: 'sub' }, '— nichts offen')
      : items.slice(0, 8).map((x) => h('span', { style: { fontSize: '13px' } }, render(x))));
  return h('div', { class: 'col', style: { gap: '12px' } },
    h('span', { class: 'sub' }, `Stand ${d.stand}${d.maze ? ` · ${d.maze}` : ' · gesamtes Gelände'} — alles, was die nächste Schicht wissen muss:`),
    sec('Offene Aufgaben', d.offeneAufgaben, (t) => `${t.critical ? '⚠️ ' : '• '}${t.title}${t.status === 'blockiert' ? ` — BLOCKIERT: „${t.note || ''}“` : ''}${t.assignee ? ` (→ ${t.assignee})` : ''}`),
    sec('Offene Vorfälle', d.offeneVorfaelle, (i) => `• ${i.time} ${i.text}${i.ort ? ` (${i.ort})` : ''}`),
    sec('Checklisten', d.checklisten, (c) => `• ${c.title}: ${c.done}/${c.total}${c.pflichtOffen ? ` — ${c.pflichtOffen} Pflicht offen!` : ' ✓'}`),
    sec('Laufende Pausen', d.laufendePausen, (b) => `• ${b.person} (seit ${b.seitMin} min)`),
    sec('Unbesetzte Positionen', d.unbesetztePositionen, (p) => `• ${p.code} ${p.name ? `„${p.name}“` : ''}${p.maze ? ` · ${p.maze}` : ''}`),
    sec('Letzte Entscheidungen', d.entscheidungen, (e) => `${e.time} · ${e.text.replace('📌 Entscheidung: ', '')}`));
}
