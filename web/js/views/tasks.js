// Aufgaben & Dispatch + Checklisten/Rundgänge
// · Desktop (Management): Board nach Status + Checklisten-Tab mit Readiness
// · Tablet (Lead): Aufgaben-Inbox der eigenen Maze + Rundgänge
// · Phone (Actor): kompaktes „Meine Aufgaben“-Widget
import { h, ic, badge, bar, panel } from '../core/dom.js';
import { get, post, patch, act } from '../core/api.js';
import { on } from '../core/store.js';
import { sheet, toast } from '../core/ui.js';

const T_PRIO = { hoch: 'err', normal: 'plain', niedrig: 'info' };
const T_STATUS = {
  offen: ['plain', 'Offen'], angenommen: ['info', 'Angenommen'], in_arbeit: ['info', 'In Arbeit'],
  blockiert: ['err', 'Blockiert'], erledigt: ['ok', 'Erledigt'], 'bestätigt': ['ok', 'Bestätigt ✓'],
};
const COLUMNS = [
  ['offen', 'Offen', ['offen']],
  ['arbeit', 'In Arbeit', ['angenommen', 'in_arbeit']],
  ['blockiert', 'Blockiert', ['blockiert']],
  ['fertig', 'Erledigt', ['erledigt', 'bestätigt']],
];

let tab = 'aufgaben';
let mazeFilter = '';
let onlyCritical = false;

// ───────── Desktop: Board + Checklisten ─────────
export async function tasksView({ onCleanup, refresh }) {
  onCleanup(on(['tasks', 'checklists', 'mazes'], refresh));
  const mazes = await get('/api/mazes');

  const tabRow = h('div', { class: 'row', style: { gap: '6px' } },
    h('span', { class: 'chip' + (tab === 'aufgaben' ? ' active' : ''), onclick: () => { tab = 'aufgaben'; refresh(); } }, ic('list', 13), 'Aufgaben'),
    h('span', { class: 'chip' + (tab === 'checklisten' ? ' active' : ''), onclick: () => { tab = 'checklisten'; refresh(); } }, ic('check', 13), 'Checklisten & Rundgänge'));

  const body = tab === 'aufgaben' ? await boardTab(mazes, refresh) : await checklistTab(mazes, refresh);
  return h('div', { class: 'col', style: { gap: '12px', flex: 1, minHeight: 0 } },
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } }, tabRow, body.header),
    body.el);
}

async function boardTab(mazes, refresh) {
  const all = await get(`/api/tasks${onlyCritical ? '?critical=1' : ''}`);
  const list = mazeFilter ? all.filter((t) => t.mazeId === mazeFilter) : all;

  const header = h('div', { class: 'row grow', style: { gap: '8px', flexWrap: 'wrap' } },
    h('span', { class: 'chip' + (mazeFilter === '' ? ' active' : ''), onclick: () => { mazeFilter = ''; refresh(); } }, 'Alle'),
    ...mazes.map((m) => h('span', {
      class: 'chip' + (mazeFilter === m.id ? ' active' : ''),
      onclick: () => { mazeFilter = mazeFilter === m.id ? '' : m.id; refresh(); },
    }, m.short)),
    h('span', { class: 'chip' + (onlyCritical ? ' active' : ''), onclick: () => { onlyCritical = !onlyCritical; refresh(); } }, ic('alert', 12), 'Nur kritisch'),
    h('div', { style: { flex: 1 } }),
    h('button', { class: 'btn sm orange', onclick: () => taskSheet(null, mazes, refresh) }, ic('plus', 14), 'Aufgabe'));

  const card = (t) => h('div', {
    class: 'card pad col role-card', style: { gap: '6px', padding: '11px 12px' },
    onclick: () => taskDetailSheet(t, mazes, refresh),
  },
    h('div', { class: 'row', style: { gap: '6px', alignItems: 'flex-start' } },
      h('span', { class: 'grow', style: { fontSize: '13px', fontWeight: 700, lineHeight: 1.3 } },
        t.critical ? '⚠️ ' : '', t.title),
      t.prio !== 'normal' && badge(T_PRIO[t.prio], t.prio === 'hoch' ? 'Hoch' : 'Niedrig', { dot: t.prio === 'hoch' })),
    h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
      t.maze && badge('plain', t.maze),
      t.assignee && h('span', { class: 'sub', style: { fontWeight: 600 } }, `→ ${t.assignee}`),
      t.deadline && h('span', { class: 'sub' + (t.overdue ? ' danger-text' : ''), style: { fontWeight: 700 } },
        `${t.overdue ? '⏰ überfällig · ' : 'bis '}${t.deadline}`),
      t.status === 'blockiert' && t.note && h('span', { class: 'sub danger-text' }, `„${t.note.slice(0, 40)}…“`.replace('…“', t.note.length > 40 ? '…“' : '“'))));

  const el = h('div', { class: 'row grow', style: { gap: '12px', alignItems: 'stretch', overflow: 'auto', minHeight: 0 } },
    ...COLUMNS.map(([key, label, stati]) => {
      const items = list.filter((t) => stati.includes(t.status));
      return h('div', { class: 'panel', style: { width: '290px', flex: '1 1 240px', minWidth: '240px', display: 'flex' } },
        h('div', { class: 'panel-h' },
          h('span', { class: 't' }, label),
          badge(key === 'blockiert' && items.length ? 'err' : 'plain', String(items.length))),
        h('div', { class: 'panel-b scroll', style: { gap: '8px', background: 'var(--bg-muted)', borderRadius: '0 0 8px 8px' } },
          items.length === 0 ? h('div', { class: 'empty-hint' }, '—') : items.map(card)));
    }));
  return { header, el };
}

// ───────── Aufgabe anlegen / Detail ─────────
export function taskSheet(task, mazes, refresh, { fixedMazeId = null } = {}) {
  const isNew = !task;
  const title = h('input', { value: task?.title || '', placeholder: 'Was ist zu tun?' });
  const desc = h('textarea', { rows: 2, placeholder: 'Details, Material, Ort … (optional)' }, task?.desc || '');
  const deadline = h('input', { type: 'time', value: task?.deadline || '' });
  let prio = task?.prio || 'normal', critical = task?.critical || false;
  let mazeId = fixedMazeId ?? (task?.mazeId || null), phase = task?.phase || null;

  sheet({
    title: isNew ? 'Aufgabe erstellen' : 'Aufgabe bearbeiten', icon: 'list', tone: 'info', center: true,
    content: (close) => {
      const prioRow = h('div', { class: 'seg' });
      const drawPrio = () => prioRow.replaceChildren(...[['hoch', 'Hoch'], ['normal', 'Normal'], ['niedrig', 'Niedrig']].map(([v, l]) =>
        h('span', { class: prio === v ? 'on' : '', onclick: () => { prio = v; drawPrio(); } }, l)));
      drawPrio();
      const mazeRow = h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } });
      const drawMaze = () => mazeRow.replaceChildren(
        h('span', { class: 'chip' + (!mazeId ? ' active' : ''), onclick: fixedMazeId ? null : () => { mazeId = null; drawMaze(); } }, 'Gelände'),
        ...mazes.map((m) => h('span', {
          class: 'chip' + (mazeId === m.id ? ' active' : ''),
          onclick: fixedMazeId ? null : () => { mazeId = m.id; drawMaze(); },
        }, m.name)));
      drawMaze();
      const phaseRow = h('div', { class: 'row', style: { gap: '6px' } });
      const drawPhase = () => phaseRow.replaceChildren(...[[null, 'Egal'], ['aufbau', 'Aufbau'], ['live', 'Live'], ['abschluss', 'Abschluss']].map(([v, l]) =>
        h('span', { class: 'chip' + (phase === v ? ' active' : ''), onclick: () => { phase = v; drawPhase(); } }, l)));
      drawPhase();
      const critChip = h('span', {
        class: 'chip' + (critical ? ' active' : ''),
        onclick: () => { critical = !critical; critChip.classList.toggle('active', critical); },
      }, ic('alert', 12), 'Kritisch (Feed-Meldung)');

      return h('div', { class: 'col', style: { gap: '12px' } },
        h('label', { class: 'fld' }, 'Titel', h('div', { class: 'inp' }, title)),
        h('label', { class: 'fld' }, 'Beschreibung', h('div', { class: 'inp area' }, desc)),
        h('label', { class: 'fld' }, 'Bereich', mazeRow),
        h('div', { class: 'grid2' },
          h('label', { class: 'fld' }, 'Priorität', prioRow),
          h('label', { class: 'fld' }, 'Frist (optional)', h('div', { class: 'inp' }, deadline))),
        h('div', { class: 'row', style: { gap: '8px' } }, h('label', { class: 'fld' }, 'Phase', phaseRow), critChip),
        h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px' } },
          h('button', { class: 'btn quiet', onclick: close }, 'Abbrechen'),
          h('button', {
            class: 'btn orange',
            onclick: () => {
              if (!title.value.trim()) { toast('Titel fehlt', 'err'); return; }
              const body = { title: title.value.trim(), desc: desc.value, prio, critical, mazeId, deadline: deadline.value || null, phase };
              act(async () => {
                if (isNew) await post('/api/tasks', body);
                else await patch(`/api/tasks/${task.id}`, body);
                close(); refresh();
              }, isNew ? 'Aufgabe erstellt' : 'Gespeichert');
            },
          }, ic('check', 15), isNew ? 'Erstellen' : 'Speichern')));
    },
  });
}

export async function taskDetailSheet(t, mazes, refresh, { lead = false } = {}) {
  const people = await get('/api/live/overview').then((o) => o.people).catch(() => []);
  const setStatus = (status, note) => act(async () => {
    await patch(`/api/tasks/${t.id}`, { status, ...(note !== undefined ? { note } : {}) });
    refresh();
  }, `Status: ${T_STATUS[status][1]}`);

  sheet({
    title: t.title, icon: t.critical ? 'alert' : 'list', tone: t.critical ? 'warn' : 'info', center: true,
    sub: [t.maze, t.assignee ? `→ ${t.assignee}` : 'niemand zugewiesen', t.deadline ? `bis ${t.deadline}${t.overdue ? ' (überfällig!)' : ''}` : null, `von ${t.createdBy}`].filter(Boolean).join(' · '),
    content: (close) => {
      const blockNote = h('input', { placeholder: 'Was blockiert? (Pflicht)' });
      const assignSel = h('select', {},
        h('option', { value: '' }, '— Person wählen —'),
        ...people.filter((p) => !t.mazeId || p.mazeId === t.mazeId || lead === false)
          .map((p) => h('option', { value: p.id, selected: false }, `${p.name}${p.position ? ` (${p.position})` : ''}`)));
      return h('div', { class: 'col', style: { gap: '12px' } },
        t.desc && h('span', { style: { fontSize: '13px', lineHeight: 1.45 } }, t.desc),
        h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
          badge(...T_STATUS[t.status]),
          t.prio !== 'normal' && badge(T_PRIO[t.prio], `Prio ${t.prio}`),
          t.note && badge('warn', `„${t.note.slice(0, 60)}“`)),
        h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
          (t.status === 'offen' || t.status === 'blockiert') && h('button', { class: 'btn sm', onclick: () => { setStatus('angenommen'); close(); } }, ic('check', 13), 'Annehmen'),
          (t.status === 'angenommen' || t.status === 'offen') && h('button', { class: 'btn sm quiet', onclick: () => { setStatus('in_arbeit'); close(); } }, 'In Arbeit'),
          (t.status !== 'erledigt' && t.status !== 'bestätigt') && h('button', {
            class: 'btn sm', style: { background: 'var(--color-success)', color: '#fff' },
            onclick: () => { setStatus('erledigt'); close(); },
          }, ic('check', 13), 'Erledigt'),
          t.status === 'erledigt' && h('button', { class: 'btn sm', onclick: () => { setStatus('bestätigt'); close(); } }, '✓✓ Abnehmen')),
        (t.status !== 'erledigt' && t.status !== 'bestätigt') && h('div', { class: 'row', style: { gap: '8px' } },
          h('div', { class: 'inp sm grow' }, blockNote),
          h('button', {
            class: 'btn sm quiet danger-text',
            onclick: () => {
              if (!blockNote.value.trim()) { toast('Bitte kurz begründen', 'err'); return; }
              setStatus('blockiert', blockNote.value.trim()); close();
            },
          }, '🧱 Blockiert')),
        h('div', { class: 'sep' }),
        h('div', { class: 'row', style: { gap: '8px' } },
          h('div', { class: 'inp sm grow' }, assignSel),
          h('button', {
            class: 'btn sm',
            onclick: () => {
              if (!assignSel.value) { toast('Person wählen', 'err'); return; }
              act(async () => { await post(`/api/tasks/${t.id}/assign`, { assigneeId: assignSel.value }); close(); refresh(); }, 'Zugewiesen');
            },
          }, ic('users', 13), lead ? 'Delegieren' : 'Zuweisen'),
          !lead && h('button', { class: 'btn sm quiet', onclick: () => { close(); taskSheet(t, mazes, refresh); } }, ic('gear', 13), 'Bearbeiten')),
        (t.history || []).length > 1 && h('div', { class: 'col', style: { gap: '2px' } },
          h('span', { class: 'overline' }, 'Verlauf'),
          ...t.history.slice(-5).reverse().map((e) => h('span', { class: 'sub' }, `${e.time} · ${e.who} · ${e.action}`))));
    },
  });
}

// ───────── Lead: Aufgaben-Inbox (Tablet) ─────────
export async function leadTasksView({ onCleanup, refresh }, myMazeId) {
  onCleanup(on(['tasks'], refresh));
  const all = await get('/api/tasks?status=aktiv');
  const mazes = await get('/api/mazes');
  const mine = all.filter((t) => !myMazeId || t.mazeId === myMazeId || (!t.mazeId && !t.assigneeId));
  const inbox = mine.filter((t) => t.status === 'offen');
  const laufend = mine.filter((t) => t.status !== 'offen');

  const row = (t) => h('div', { class: 'prow click', style: { gap: '10px' }, onclick: () => taskDetailSheet(t, mazes, refresh, { lead: true }) },
    h('span', { class: 'av', style: { borderRadius: '10px', background: t.critical ? 'var(--color-error-light)' : undefined, color: t.critical ? 'var(--color-error)' : undefined } }, ic(t.critical ? 'alert' : 'list', 15)),
    h('div', { class: 'col grow', style: { gap: 0 } },
      h('span', { class: 'nm', style: { fontSize: '13px' } }, t.title),
      h('span', { class: 'mt' }, [t.assignee ? `→ ${t.assignee}` : null, t.deadline ? `bis ${t.deadline}` : null, t.note ? `„${t.note.slice(0, 36)}“` : null].filter(Boolean).join(' · ') || t.maze || 'Gelände')),
    t.overdue ? badge('err', '⏰ überfällig', { dot: true }) : badge(...T_STATUS[t.status]));

  return h('div', { class: 'col scroll-y', style: { gap: '14px', padding: '14px' } },
    panel([ic('list', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Eingehend vom Leitstand'),
      badge(inbox.length ? 'warn' : 'ok', String(inbox.length)),
      h('button', { class: 'btn sm orange right', onclick: () => taskSheet(null, mazes, refresh, { fixedMazeId: myMazeId }) }, ic('plus', 13), 'Aufgabe')],
      inbox.length === 0 ? h('div', { class: 'empty-hint' }, 'Nichts Neues — gut so.') : inbox.map(row),
      { bodyStyle: { gap: 0, paddingTop: '2px' } }),
    panel([ic('clock', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Laufend / blockiert'), badge('plain', String(laufend.length))],
      laufend.length === 0 ? h('div', { class: 'empty-hint' }, 'Nichts in Arbeit.') : laufend.map(row),
      { bodyStyle: { gap: 0, paddingTop: '2px' } }));
}

// ───────── Actor: „Meine Aufgaben“-Widget (Phone) ─────────
export async function myTasksWidget(refresh) {
  const mine = await get('/api/tasks?mine=1&status=aktiv').catch(() => []);
  if (!mine.length) return null;
  return h('div', { class: 'panel', style: { flex: 'none' } },
    h('div', { class: 'panel-h' }, ic('list', 16, { color: 'var(--fg-muted)' }),
      h('span', { class: 't' }, 'Meine Aufgaben'), badge(mine.some((t) => t.critical) ? 'warn' : 'plain', String(mine.length))),
    h('div', { class: 'panel-b', style: { gap: 0, paddingTop: '2px' } },
      mine.slice(0, 4).map((t) => h('div', { class: 'prow', style: { gap: '10px' } },
        h('button', {
          class: 'btn sm quiet', style: { width: '38px', minHeight: '38px', padding: 0 },
          title: 'Erledigt',
          onclick: () => act(async () => { await patch(`/api/tasks/${t.id}`, { status: 'erledigt' }); refresh(); }, 'Erledigt ✓'),
        }, ic('check', 15)),
        h('div', { class: 'col grow', style: { gap: 0 } },
          h('span', { class: 'nm', style: { fontSize: '13px' } }, t.critical ? '⚠️ ' : '', t.title),
          h('span', { class: 'mt' }, [t.maze, t.deadline ? `bis ${t.deadline}` : null].filter(Boolean).join(' · '))),
        h('button', {
          class: 'btn sm quiet danger-text', title: 'Blockiert melden',
          onclick: () => {
            const note = prompt('Was blockiert dich?');
            if (note?.trim()) act(async () => { await patch(`/api/tasks/${t.id}`, { status: 'blockiert', note: note.trim() }); refresh(); }, 'Blocker gemeldet');
          },
        }, '🧱')))));
}

// ───────── Checklisten ─────────
async function checklistTab(mazes, refresh) {
  const [lists, readiness] = await Promise.all([get('/api/checklists'), get('/api/checklists/readiness')]);

  const header = h('div', { class: 'row grow', style: { gap: '8px' } },
    h('div', { style: { flex: 1 } }),
    h('button', { class: 'btn sm orange', onclick: () => newChecklistSheet(mazes, refresh) }, ic('plus', 14), 'Rundgang anlegen'));

  const readyRow = h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
    h('span', { class: 'overline' }, 'Sind wir bereit?'),
    ...readiness.map((r) => badge(r.bereit ? 'ok' : (r.listen ? 'err' : 'plain'),
      `${r.maze}: ${r.bereit ? 'bereit ✓' : r.listen ? `${r.pflichtOffen} Pflicht offen` : 'keine Listen'}`, { dot: r.listen > 0 })));

  const byMaze = {};
  for (const c of lists) (byMaze[c.maze || 'Gelände'] ||= []).push(c);

  const el = h('div', { class: 'col scroll-y', style: { gap: '14px', flex: 1 } },
    readyRow,
    h('div', { class: 'grid3' },
      ...Object.entries(byMaze).map(([mazeName, ls]) => h('div', { class: 'card pad col', style: { gap: '10px' } },
        h('span', { style: { fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: '14px' } }, mazeName),
        ...ls.map((c) => checklistRow(c, refresh))))),
    lists.length === 0 && h('div', { class: 'empty-hint card' }, 'Noch keine Rundgänge — oben anlegen (Vorlagen eingebaut).'));
  return { header, el };
}

export function checklistRow(c, refresh) {
  return h('div', { class: 'col', style: { gap: '4px', cursor: 'pointer' }, onclick: () => checklistSheet(c.id, refresh) },
    h('div', { class: 'row', style: { gap: '8px' } },
      h('span', { class: 'grow', style: { fontSize: '13px', fontWeight: 600 } }, c.title),
      c.complete ? badge('ok', '✓', { dot: false })
        : c.mandatoryOpen > 0 ? badge('warn', `${c.mandatoryOpen} Pflicht`) : badge('plain', `${c.done}/${c.total}`)),
    h('div', { class: 'row', style: { gap: '8px' } },
      bar(c.total ? (c.done / c.total) * 100 : 0, c.complete ? 'ok' : c.mandatoryOpen ? 'warn' : 'navy'),
      h('span', { class: 'sub', style: { width: '42px', textAlign: 'right' } }, `${c.done}/${c.total}`)));
}

export async function checklistSheet(checklistId, refresh) {
  const lists = await get('/api/checklists');
  const c = lists.find((x) => x.id === checklistId);
  if (!c) { toast('Checkliste nicht gefunden', 'err'); return; }
  sheet({
    title: c.title, icon: 'check', tone: c.complete ? 'ok' : 'info', center: true,
    sub: `${c.maze} · ${c.done}/${c.total} erledigt${c.mandatoryOpen ? ` · ${c.mandatoryOpen} Pflichtpunkt(e) offen` : c.complete ? ' · abgeschlossen ✓' : ''}`,
    content: (close) => h('div', { class: 'col', style: { gap: '4px', maxHeight: '60vh', overflow: 'auto' } },
      ...c.items.map((i) => h('div', {
        class: 'prow click', style: { gap: '10px' },
        onclick: () => act(async () => {
          await post(`/api/checklists/${c.id}/toggle`, { itemId: i.id });
          close(); checklistSheet(checklistId, refresh); refresh();
        }),
      },
        h('span', {
          class: 'av', style: {
            borderRadius: '8px',
            background: i.done ? 'var(--color-success-light)' : 'var(--bg-muted)',
            color: i.done ? 'var(--color-success)' : 'var(--fg-muted)',
          },
        }, ic(i.done ? 'check' : 'minus', 15)),
        h('div', { class: 'col grow', style: { gap: 0 } },
          h('span', { class: 'nm', style: { fontSize: '13px', textDecoration: i.done ? 'line-through' : 'none', opacity: i.done ? 0.7 : 1 } }, i.text),
          h('span', { class: 'mt' }, i.done ? `✓ ${i.doneBy}` : i.mandatory ? 'Pflichtpunkt' : 'optional')),
        i.mandatory && !i.done && badge('warn', 'Pflicht')))),
  });
}

function newChecklistSheet(mazes, refresh) {
  let type = 'sicherheit', mazeId = mazes[0]?.id || null;
  get('/api/checklists/templates').then((templates) => {
    sheet({
      title: 'Rundgang anlegen', icon: 'check', tone: 'info', center: true,
      sub: 'Vorlagen mit Pflichtpunkten sind eingebaut — Punkte später per DB-Pflege anpassbar.',
      content: (close) => {
        const typeRow = h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } });
        const preview = h('div', { class: 'col', style: { gap: '2px' } });
        const drawType = () => {
          typeRow.replaceChildren(...templates.map((t) =>
            h('span', { class: 'chip' + (type === t.type ? ' active' : ''), onclick: () => { type = t.type; drawType(); } }, t.label)));
          const tpl = templates.find((t) => t.type === type);
          preview.replaceChildren(h('span', { class: 'overline' }, 'Punkte'),
            ...tpl.items.map((i) => h('span', { class: 'sub' }, `${i.mandatory ? '• [Pflicht] ' : '• '}${i.text}`)));
        };
        const mazeRow = h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } });
        const drawMaze = () => mazeRow.replaceChildren(
          h('span', { class: 'chip' + (!mazeId ? ' active' : ''), onclick: () => { mazeId = null; drawMaze(); } }, 'Gelände'),
          ...mazes.map((m) => h('span', { class: 'chip' + (mazeId === m.id ? ' active' : ''), onclick: () => { mazeId = m.id; drawMaze(); } }, m.name)));
        drawType(); drawMaze();
        return h('div', { class: 'col', style: { gap: '12px' } },
          h('label', { class: 'fld' }, 'Typ', typeRow),
          h('label', { class: 'fld' }, 'Bereich', mazeRow),
          preview,
          h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px' } },
            h('button', { class: 'btn quiet', onclick: close }, 'Abbrechen'),
            h('button', {
              class: 'btn orange',
              onclick: () => act(async () => { await post('/api/checklists', { type, mazeId }); close(); refresh(); }, 'Rundgang angelegt'),
            }, ic('check', 15), 'Anlegen')));
      },
    });
  });
}
