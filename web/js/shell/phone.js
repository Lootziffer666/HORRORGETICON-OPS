// Phone-Shell (Scare Actor) — Mockups actor.jsx + catering.jsx (Wallet):
// Start (Schichtkarte, Schnellaktionen, Durchsagen) · Karte · Chat · Marken · Profil.
import { h, ic, ghostMark, badge, av, mount } from '../core/dom.js';
import { get, post, act } from '../core/api.js';
import { on, store } from '../core/store.js';
import { guardedView, toast, sheet } from '../core/ui.js';
import { shiftProgress, minSince } from '../core/fmt.js';
import { logout, switchRole } from '../app.js';
import { mazeMapEl, mazeLegend, incidentSheet, feedList, lateSheet, ACTOR_STATUS_META, PHASE_META } from '../views/shared.js';
import { chatView } from '../views/chat.js';
import { walletView } from '../views/wallet.js';
import { profileView } from '../views/profile.js';
import { myTasksWidget } from '../views/tasks.js';

const NAV = [
  ['start', 'Start', 'home'], ['karte', 'Karte', 'map'], ['chat', 'Chat', 'chat'],
  ['marken', 'Marken', 'qr'], ['profil', 'Profil', 'user'],
];
let tab = 'start';
let routeFn = null;
export function phoneGo(t) { tab = t; routeFn?.(); }

export function renderPhone(root) {
  const body = h('div', { class: 'm-body' });
  const head = h('div');
  const navEl = h('div', { class: 'm-nav' });
  let guard = null;
  const cleanups = [];
  let unreadChat = 0;
  let dndActive = false;

  const drawNav = () => {
    navEl.replaceChildren(...NAV.map(([id, label, icon]) => h('div', {
      class: 'it' + (tab === id ? ' on' : ''),
      onclick: () => { tab = id; route(); },
      style: { position: 'relative' },
    }, ic(icon, 20), h('span', {}, label),
      id === 'chat' && unreadChat > 0 ? h('span', { class: 'unread-dot', style: { position: 'absolute', top: '0', right: '14%' } }, unreadChat) : null)));
  };

  const drawHead = (badgeEl) => {
    mount(head, h('div', { class: 'm-head' },
      ghostMark(36),
      h('div', { class: 'col grow', style: { gap: 0 } },
        h('span', { style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '15.5px', lineHeight: 1.2 } }, store.me.person.name),
        h('span', { class: 'sub' }, roleLine())),
      dndActive ? badge('warn', 'DND') : '',
      badgeEl || ''));
  };

  const route = () => {
    drawNav();
    guard?.stop();
    for (const fn of cleanups.splice(0)) fn();
    const ctx = { params: new URLSearchParams(), onCleanup: (fn) => cleanups.push(fn), refresh: () => guard.refresh(), phone: true };
    const views = {
      start: () => actorHome(ctx, drawHead),
      karte: () => actorMap(ctx, drawHead),
      chat: () => chatView({ ...ctx, phone: true }),
      marken: () => walletView(ctx),
      profil: () => profileView(ctx),
    };
    guard = guardedView(body, views[tab]);
  };

  const refreshUnread = async () => {
    try {
      const channels = await get('/api/chat/channels');
      unreadChat = channels.reduce((s, c) => s + (c.unread || 0), 0);
      drawNav();
    } catch { /* Komfort */ }
  };
  cleanupsGlobal.push(on('chat', refreshUnread));
  refreshUnread();

  const refreshDnd = async () => {
    try {
      const s = await get('/api/dnd/status');
      const changed = dndActive !== s.active;
      dndActive = s.active;
      if (changed) drawHead();
    } catch { /* Komfort */ }
  };
  cleanupsGlobal.push(on('dnd', refreshDnd));
  refreshDnd();

  routeFn = route;
  mount(root, h('div', { class: 'theme phone-app' }, head, body, navEl));
  drawHead();
  route();
}
const cleanupsGlobal = [];

function roleLine() {
  const pos = null; // wird im Home-View präzisiert
  return store.me.role === 'springer' ? 'Springer · flexibel' : `Scare Actor`;
}

// ───────── Start ─────────
async function actorHome({ onCleanup, refresh }, drawHead) {
  const [ov, feed, myBreaks, anns] = await Promise.all([
    get('/api/live/overview'), get('/api/feed?limit=20'),
    get('/api/breaks/mine'), get('/api/announcements?mine=1'),
  ]);
  onCleanup(on(['live', 'breaks', 'feed', 'announce'], refresh));

  const meRow = ov.people.find((p) => p.id === store.me.person.id);
  const checkedIn = meRow && meRow.status !== 'out';
  const myBreak = myBreaks.find((b) => ['offen', 'genehmigt', 'läuft'].includes(b.status));
  drawHead(badge(checkedIn ? 'ok' : 'plain', checkedIn ? 'Eingecheckt' : 'Nicht eingecheckt', { dot: checkedIn }));

  // ungelesene Notfall-Durchsagen nachholen (z. B. nach App-Neustart)
  const unreadAlarm = anns.find((a) => a.requiresAck && !a.gelesen);
  if (unreadAlarm) {
    const { emit } = await import('../core/store.js');
    emit('alarm', { announcementId: unreadAlarm.id, text: unreadAlarm.text, level: unreadAlarm.level, by: unreadAlarm.byName, time: unreadAlarm.time });
  }

  const s = store.settings || { shiftStart: '18:00', shiftEnd: '01:00' };
  const phase = s.phase || 'live';
  const prog = shiftProgress(s.shiftStart, s.shiftEnd);

  // Detail-Status-Chips (horrops_fullstack.md: ActorStatusPanel)
  const statusChips = checkedIn && phase !== 'abschluss' && h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
    ...[['da', 'Bereit'], ['maske', 'Maske'], ['backstage', 'Backstage'], ['position', 'Auf Position']].map(([v, l]) =>
      h('span', {
        class: 'chip' + (meRow?.actorStatus === v ? ' active' : ''),
        onclick: () => act(async () => { await post('/api/live/status', { status: v }); refresh(); }, `Status: ${ACTOR_STATUS_META[v].label}`),
      }, ic(ACTOR_STATUS_META[v].icon, 12), ` ${l}`)));

  const checkoutBtn = h('button', {
    class: 'btn lg ' + (phase === 'abschluss' ? 'orange' : 'outline'),
    onclick: () => act(async () => { await post('/api/live/checkout'); refresh(); }, 'Ausgecheckt — gute Heimfahrt!'),
  }, ic('out', 17), 'Check-out');
  const checkinBtn = h('button', {
    class: 'btn lg orange',
    onclick: () => act(async () => { await post('/api/live/checkin'); refresh(); }, 'Eingecheckt — viel Erfolg!'),
  }, ic('check', 17), 'Jetzt einchecken');

  const headBlock = h('div', { class: 'row' },
    h('div', { class: 'col grow', style: { gap: '2px' } },
      h('span', { class: 'overline' }, phase === 'abschluss' ? 'Das war die Horrornacht' : phase === 'live' ? 'Deine Schicht heute' : `${PHASE_META[phase].label} · Schichtstart ${s.shiftStart}`),
      h('span', { style: { fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: '20px' } },
        phase === 'abschluss' ? 'Danke für heute Nacht! 🎃'
          : meRow?.maze ? `${meRow.maze} · ${meRow.position}${meRow.positionName ? ` „${meRow.positionName}“` : ''}` : 'Noch keine Position zugeteilt')),
    h('span', { class: 'av lg navy', style: { borderRadius: '12px' } }, ic(phase === 'abschluss' ? 'check' : 'pin', 20)));

  let shiftCard;
  if (phase === 'abschluss') {
    // Wrap-up (ActorPostShowInfo): Abschluss-Hinweise + Check-out im Fokus
    shiftCard = h('div', { class: 'card pad col', style: { gap: '12px', padding: '16px' } },
      headBlock,
      h('span', { class: 'sub', style: { fontSize: '13px', lineHeight: 1.45 } },
        'Requisiten sichern, Fundsachen abgeben, dann ab nach Hause. Deine Fahrgruppe findest du im Profil — Rückfahrt-Infos kommen über den Chat.'),
      checkedIn ? checkoutBtn : badge('ok', 'Ausgecheckt — gute Heimfahrt!', { dot: true }));
  } else if (phase !== 'live') {
    // Vorbereitung/Aufbau: kein Schichtfortschritt, dafür Aufbau-Kontext
    shiftCard = h('div', { class: 'card pad col', style: { gap: '12px', padding: '16px' } },
      headBlock,
      h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
        badge(PHASE_META[phase].tone, PHASE_META[phase].label, { dot: true }),
        meRow?.late && badge('warn', `⏰ Verspätung gemeldet: +${meRow.late.etaMin} min`),
        meRow?.selfCreated && badge('warn', 'Profil unverknüpft!', { dot: true })),
      statusChips,
      checkedIn ? checkoutBtn : checkinBtn,
      !checkedIn && h('button', { class: 'btn lg quiet', onclick: () => lateSheet(refresh) }, ic('clock', 17), 'Ich verspäte mich'));
  } else {
    shiftCard = h('div', { class: 'card pad col', style: { gap: '12px', padding: '16px' } },
      headBlock,
      h('div', { class: 'row', style: { gap: '10px' } },
        h('span', { class: 'num', style: { fontSize: '14px' } }, `${s.shiftStart} – ${s.shiftEnd}`),
        h('div', { class: 'bar' }, h('i', { class: 'navy', style: { width: prog.pct + '%' } })),
        h('span', { class: 'sub', style: { fontWeight: 700 } }, `noch ${prog.left}`)),
      h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
        myBreak ? badge(myBreak.status === 'läuft' ? 'info' : 'warn',
          myBreak.status === 'läuft' ? `Pause läuft · seit ${minSince(myBreak.startedAt)} min`
            : myBreak.status === 'genehmigt' ? 'Pause freigegeben — starte, wenn abgelöst' : 'Pause angefragt — wartet', { dot: true })
          : badge('info', 'Nächste Pause auf Anfrage', { dot: true }),
        meRow?.late && badge('warn', `⏰ +${meRow.late.etaMin} min gemeldet`),
        meRow?.selfCreated && badge('warn', 'Profil unverknüpft!', { dot: true })),
      statusChips,
      checkedIn ? checkoutBtn : h('div', { class: 'col', style: { gap: '8px' } },
        checkinBtn,
        h('button', { class: 'btn quiet', onclick: () => lateSheet(refresh) }, ic('clock', 16), 'Ich verspäte mich')));
  }

  const qa = (cls, icon, label, onclick, disabled = false) => h('button', { class: 'qa', onclick, disabled },
    h('span', { class: `ic-ring ${cls}` }, ic(icon, 19)), label);

  const quick = h('div', { class: 'qa-grid' },
    qa('info', 'pause', myBreak ? 'Pause angefragt …' : 'Pause anfragen', () => breakSheet(myBreak, refresh), false),
    qa('ok', 'cup', 'Getränk anfordern', () => act(async () => {
      await post('/api/incidents', { kind: 'getraenk', prio: 'niedrig', text: 'Getränk angefordert' });
    }, 'Getränk angefordert — kommt zur Position')),
    qa('err', 'alert', 'Warnung melden', () => incidentSheet({ onDone: refresh })),
    qa('warn', 'map', 'Maze-Karte', () => phoneGo('karte')));

  const tasksWidget = await myTasksWidget(refresh).catch(() => null);
  onCleanup(on(['tasks'], refresh));

  return h('div', { class: 'col', style: { gap: '12px', minHeight: 0, flex: 1 } },
    shiftCard,
    h('span', { class: 'overline' }, 'Schnellaktionen'),
    quick,
    tasksWidget,
    h('div', { class: 'panel grow', style: { minHeight: '140px', overflow: 'hidden', display: 'flex' } },
      h('div', { class: 'panel-h' }, ic('mega', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Durchsagen & Feed')),
      h('div', { class: 'panel-b scroll', style: { gap: 0, paddingTop: '4px' } },
        feedList(feed.filter((f) => !f.mazeId || f.mazeId === meRow?.mazeId), { limit: 20 }))));
}

function breakSheet(existing, refresh) {
  if (existing) {
    // laufende/wartende Pause verwalten
    sheet({
      title: existing.status === 'läuft' ? 'Pause läuft' : existing.status === 'genehmigt' ? 'Pause ist freigegeben' : 'Pause angefragt',
      icon: 'pause', tone: 'info',
      sub: existing.status === 'offen' ? `Wartet seit ${existing.wartetSeitMin} min auf Freigabe` : null,
      content: (close) => h('div', { class: 'col', style: { gap: '10px' } },
        existing.status === 'genehmigt' && h('button', {
          class: 'btn lg orange',
          onclick: () => act(async () => { await post(`/api/breaks/${existing.id}/start`); close(); refresh(); }, 'Gute Pause!'),
        }, ic('pause', 17), 'Pause jetzt starten'),
        existing.status === 'läuft' && h('button', {
          class: 'btn lg',
          onclick: () => act(async () => { await post(`/api/breaks/${existing.id}/end`); close(); refresh(); }, 'Willkommen zurück!'),
        }, ic('check', 17), 'Ich bin zurück auf Position'),
        h('button', { class: 'btn quiet', onclick: close }, 'Schließen')),
    });
    return;
  }
  const note = h('textarea', { rows: 2, placeholder: 'Brauche 10 Minuten, Stimme ist durch … (optional)' });
  sheet({
    title: 'Pause anfragen', icon: 'pause', tone: 'info',
    sub: 'Geht an deinen Maze Lead — Springer übernimmt, wenn verfügbar',
    content: (close) => h('div', { class: 'col', style: { gap: '12px' } },
      h('label', { class: 'fld' }, 'Nachricht an den Lead', h('div', { class: 'inp area' }, note)),
      h('button', {
        class: 'btn lg orange',
        onclick: () => act(async () => {
          await post('/api/breaks/request', { note: note.value.trim() });
          close(); refresh();
        }, 'Anfrage ist raus — du bekommst Bescheid'),
      }, ic('send', 17), 'Anfrage senden')),
  });
}

// ───────── Karte ─────────
async function actorMap({ onCleanup, refresh }, drawHead) {
  const ov = await get('/api/live/overview');
  const meRow = ov.people.find((p) => p.id === store.me.person.id);
  const mazeId = meRow?.mazeId || ov.mazes[0]?.id;
  if (!mazeId) {
    drawHead();
    return h('div', { class: 'empty-hint card' }, 'Noch keiner Maze zugeteilt — das Management teilt dich ein, danach erscheint hier deine Karte.');
  }
  const detail = await get(`/api/live/maze/${mazeId}`);
  onCleanup(on(['live', 'mazes', 'incidents'], refresh));
  const besetzt = detail.positions.filter((p) => p.status !== 'leer' && p.status !== 'out').length;
  drawHead(badge('ok', `${besetzt}/${detail.positions.length} besetzt`, { dot: true }));

  const myPos = detail.positions.find((p) => p.person?.id === store.me.person.id);
  const neighbors = (() => {
    if (!myPos) return null;
    const idx = detail.positions.findIndex((p) => p === myPos);
    return [detail.positions[idx - 1], detail.positions[idx + 1]]
      .filter((p) => p?.person).map((p) => `${p.person.name.split(' ')[0]} (${p.code})`).join(' · ');
  })();

  return h('div', { class: 'col', style: { gap: '10px', flex: 1, minHeight: 0 } },
    mazeMapEl(detail, { meId: store.me.person.id, height: 340 }),
    mazeLegend(true),
    myPos && h('div', { class: 'card pad row', style: { gap: '12px', padding: '14px' } },
      h('span', { class: 'av lg', style: { background: 'var(--color-secondary)', color: '#fff', borderRadius: '12px' } }, ic('pin', 20)),
      h('div', { class: 'col grow', style: { gap: '2px' } },
        h('span', { style: { fontSize: '14.5px', fontWeight: 800, fontFamily: 'var(--font-display)' } },
          `${myPos.code} ${myPos.name ? `„${myPos.name}“` : ''} — Deine Position`),
        h('span', { class: 'sub' }, myPos.desc || 'Scare-Punkt')),
      h('button', {
        class: 'btn sm quiet', title: 'Position bestätigen',
        onclick: () => act(async () => { await post('/api/live/confirm-position'); }, 'Position bestätigt ✓'),
      }, ic('check', 14))),
    h('div', { class: 'panel', style: { flex: 'none' } },
      h('div', { class: 'panel-b', style: { gap: '8px', padding: '11px 14px' } },
        neighbors && h('div', { class: 'row' },
          ic('users', 16, { color: 'var(--fg-muted)' }),
          h('span', { style: { fontSize: '13px', fontWeight: 600 } }, `Nachbarn: ${neighbors}`)),
        detail.lead && h('div', { class: 'row' },
          ic('radio', 16, { color: 'var(--fg-muted)' }),
          h('span', { style: { fontSize: '13px', fontWeight: 600 } }, `Lead in der Nähe: ${detail.lead}`)))),
    h('button', { class: 'btn lg quiet', onclick: () => incidentSheet({ onDone: refresh }) },
      ic('alert', 17), 'Problem an dieser Position melden'));
}

export { breakSheet };
