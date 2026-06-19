// Desktop-Shell (Management) — Mockup MgmtShell: Sidebar, Topbar, Inhalt.
// Navigation in Gruppen; Zähler an Pausen/Meldungen laufen live mit.
import { h, ic, ghostMark, av, badge, mount } from '../core/dom.js';
import { on, store, emit } from '../core/store.js';
import { get } from '../core/api.js';
import { guardedView } from '../core/ui.js';
import { hhmm } from '../core/fmt.js';
import { logout, switchRole } from '../app.js';
import { announceSheet, phaseSheet, PHASE_META } from '../views/shared.js';
import { tasksView } from '../views/tasks.js';

import { dashboardView } from '../views/dashboard.js';
import { livemapView } from '../views/livemap.js';
import { attendanceView } from '../views/attendance.js';
import { peopleView } from '../views/people.js';
import { mazesView } from '../views/mazes.js';
import { breaksView } from '../views/breaks.js';
import { incidentsView } from '../views/incidents.js';
import { announceView } from '../views/announce.js';
import { chatView } from '../views/chat.js';
import { kidsdayView } from '../views/kidsday.js';
import { timelineView } from '../views/timeline.js';
import { cateringMgmtView } from '../views/catering_mgmt.js';
import { carpoolView } from '../views/carpool.js';
import { scheduleView } from '../views/schedule.js';
import { reportsView } from '../views/reports.js';
import { dbadminView } from '../views/dbadmin.js';
import { modulesView } from '../views/modules.js';
import { backupsView } from '../views/backups.js';
import { settingsView } from '../views/settings.js';

const NAV = [
  { sec: 'Leitstand' },
  { id: 'dash', label: 'Dashboard', icon: 'grid', view: dashboardView },
  { id: 'map', label: 'Live-Karte', icon: 'map', view: livemapView },
  { id: 'anwesenheit', label: 'Anwesenheit', icon: 'check', view: attendanceView },
  { id: 'aufgaben', label: 'Aufgaben', icon: 'list', view: tasksView, cnt: 'tasks' },
  { id: 'pausen', label: 'Pausen', icon: 'pause', view: breaksView, cnt: 'breaks' },
  { id: 'meldungen', label: 'Meldungen', icon: 'alert', view: incidentsView, cnt: 'incidents' },
  { id: 'durchsagen', label: 'Durchsagen', icon: 'mega', view: announceView },
  { id: 'chat', label: 'Chat', icon: 'chat', view: chatView, cnt: 'chat' },
  { id: 'kidsday', label: 'Kids Day', icon: 'users', view: kidsdayView },
  { id: 'timeline', label: 'Ablaufplan', icon: 'cal', view: timelineView },
  { sec: 'Planung' },
  { id: 'personen', label: 'Personen', icon: 'users', view: peopleView },
  { id: 'mazes', label: 'Mazes & Zuteilung', icon: 'door', view: mazesView },
  { id: 'catering', label: 'Catering', icon: 'cup', view: cateringMgmtView },
  { id: 'fahrgruppen', label: 'Fahrgruppen', icon: 'car', view: carpoolView },
  { id: 'zeitplan', label: 'Zeitplan', icon: 'cal', view: scheduleView },
  { id: 'berichte', label: 'Berichte', icon: 'chart', view: reportsView },
  { sec: 'System' },
  { id: 'db', label: 'Datenbank', icon: 'db', view: dbadminView },
  { id: 'module', label: 'Module', icon: 'puzzle', view: modulesView },
  { id: 'backups', label: 'Backups', icon: 'save', view: backupsView },
  { id: 'einstellungen', label: 'Einstellungen', icon: 'gear', view: settingsView },
];

export function renderDesktop(root) {
  const navEl = h('nav');
  const body = h('div', { class: 'dt-body' });
  const title = h('h1', {}, '');

  // Eine phasenbewusste Live-Anzeige: zeigt Phase + Uhrzeit, Klick wechselt die Phase
  const liveClock = h('span', {
    class: 'live-dot', style: { cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none' },
    title: 'Event-Phase wechseln',
  }, h('i'), '');
  const drawPhase = () => {
    const phase = store.settings?.phase || 'vorbereitung';
    const m = PHASE_META[phase];
    liveClock.lastChild.textContent = `${phase === 'live' ? 'LIVE' : m.label.toUpperCase()} · ${hhmm(Date.now())}`;
    liveClock.firstChild.style.background = phase === 'live' ? 'var(--color-success)' : phase === 'abschluss' ? 'var(--color-warning)' : 'var(--fg-muted)';
    liveClock.style.color = phase === 'live' ? 'var(--color-success)' : phase === 'abschluss' ? '#b8901c' : 'var(--fg-muted)';
  };
  drawPhase();
  setInterval(drawPhase, 15000);
  liveClock.addEventListener('click', () => phaseSheet(store.settings?.phase || 'vorbereitung', drawPhase));

  const search = h('input', { placeholder: 'Person, Maze, Position …', style: { fontSize: '12.5px' } });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && search.value.trim()) {
      location.hash = `#/personen?q=${encodeURIComponent(search.value.trim())}`;
    }
  });

  const shell = h('div', { class: 'theme app-frame' },
    h('div', { class: 'dt', style: { height: '100%' } },
      h('aside', { class: 'dt-side' },
        h('div', { class: 's-head' },
          ghostMark(30, 8),
          h('div', { class: 'col', style: { gap: 0 } },
            h('span', { class: 'wordmark', html: 'Horrorgeticon&nbsp;<em>Ops</em>' }),
            h('span', { style: { fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' } }, 'Leitstand'))),
        navEl,
        h('div', { class: 's-foot' },
          av(store.me.person.name, { tone: 'navy' }),
          h('div', { class: 'col grow', style: { gap: 0 } },
            h('span', { class: 'who' }, store.me.person.name),
            h('span', { class: 'role', style: { cursor: 'pointer' }, onclick: switchRole }, 'Event-Leitung · Rolle wechseln')),
          h('span', { style: { cursor: 'pointer' }, onclick: logout, title: 'Abmelden' }, ic('out', 16, { color: 'rgba(255,255,255,0.55)' })))),
      h('div', { class: 'dt-main' },
        h('div', { class: 'dt-top' },
          title,
          badge('plain', [ic('cal', 13), ` ${store.settings?.nightLabel || 'Horrornacht'}`], { style: { fontSize: '11.5px' } }),
          liveClock,
          h('div', { style: { flex: 1 } }),
          h('div', { class: 'inp', style: { padding: '7px 12px', width: '220px' } }, ic('search', 15, { color: 'var(--fg-muted)' }), search),
          h('button', { class: 'btn orange sm', style: { padding: '8px 14px' }, onclick: () => announceSheet({}) }, ic('mega', 15), 'Durchsage')),
        body)));

  const counters = { breaks: 0, incidents: 0, chat: 0, tasks: 0 };
  let active = null;
  let currentGuard = null;
  let cleanupFns = [];

  const drawNav = () => {
    navEl.replaceChildren(...NAV.map((item) => {
      if (item.sec) return h('div', { class: 'nav-sec' }, item.sec);
      const cnt = item.cnt ? counters[item.cnt] : 0;
      return h('div', {
        class: 'nav-it' + (active === item.id ? ' on' : ''),
        onclick: () => { location.hash = `#/${item.id}`; },
      }, ic(item.icon, 17), h('span', {}, item.label), cnt > 0 ? h('span', { class: 'cnt' }, cnt > 99 ? '99+' : cnt) : null);
    }));
  };

  const refreshCounters = async () => {
    try {
      const [breaks, incidents, channels, board] = await Promise.all([
        get('/api/breaks?status=offen'), get('/api/incidents?status=offen'), get('/api/chat/channels'),
        get('/api/tasks/board').catch(() => null),
      ]);
      counters.breaks = breaks.length;
      counters.incidents = incidents.length;
      counters.chat = channels.reduce((s, c) => s + (c.unread || 0), 0);
      counters.tasks = board ? board.byStatus.offen + board.blockiert : 0;
      drawNav();
    } catch { /* Zähler sind Komfort */ }
  };

  const route = () => {
    const hash = (location.hash || '#/dash').slice(2);
    const [id, queryStr] = hash.split('?');
    const item = NAV.find((n) => n.id === id) || NAV[1];
    active = item.id;
    title.textContent = item.label;
    document.title = `${item.label} — Horrorgeticon Ops`;
    drawNav();
    currentGuard?.stop();
    for (const fn of cleanupFns.splice(0)) fn();
    const params = new URLSearchParams(queryStr || '');
    currentGuard = guardedView(body, () => item.view({
      params,
      onCleanup: (fn) => cleanupFns.push(fn),
      refresh: () => currentGuard.refresh(),
    }));
  };

  window.addEventListener('hashchange', route);
  on(['breaks', 'incidents', 'chat', 'tasks'], refreshCounters);
  on('shell.refresh', () => { drawNav(); drawPhase(); });
  refreshCounters();
  if (!location.hash) location.hash = '#/dash';
  mount(root, shell);
  route();
}
