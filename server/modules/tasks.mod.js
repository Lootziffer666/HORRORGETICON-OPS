// Modul: Aufgaben & Dispatch (horrops_fullstack.md: Task-/Dispatch-System)
// Leitstand erstellt und verteilt Aufgaben (an Maze, Lead oder Person),
// Leads nehmen an / delegieren / melden Blocker, Actors haken ihre ab.
// Status: offen → angenommen → in_arbeit → erledigt → bestätigt (+ blockiert)
import { bad, need, notFound, id, now, hhmm } from '../kernel/util.js';

const STATI = ['offen', 'angenommen', 'in_arbeit', 'blockiert', 'erledigt', 'bestätigt'];
const PRIOS = ['hoch', 'normal', 'niedrig'];
const PHASES = ['aufbau', 'live', 'abschluss'];

function isOps(ctx) {
  const roles = new Set([ctx.session.role, ...(ctx.person.roles || [])]);
  return roles.has('management') || roles.has('lead');
}

function deadlineTs(deadline) {
  if (!deadline || !/^\d{2}:\d{2}$/.test(deadline)) return null;
  const [h, m] = deadline.split(':').map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0);
  let ts = d.getTime();
  // Eventnacht läuft über Mitternacht: Zeiten < 12 h in der Vergangenheit → morgen
  if (ts < Date.now() - 12 * 3600e3) ts += 24 * 3600e3;
  return ts;
}

export default {
  name: 'tasks',
  title: 'Aufgaben & Dispatch',
  version: '1.0.0',
  description: 'Aufgaben erstellen, an Mazes/Personen verteilen, annehmen, delegieren, Blocker melden.',

  routes({ get, post, patch }, { db, bus, feed }) {
    const enrich = (t) => ({
      ...t,
      maze: t.mazeId ? db.get('mazes', t.mazeId)?.name || null : null,
      assignee: t.assigneeId ? db.get('people', t.assigneeId)?.name || null : null,
      overdue: t.status !== 'erledigt' && t.status !== 'bestätigt' &&
        t.deadline != null && (deadlineTs(t.deadline) ?? Infinity) < now(),
    });

    const log = (t, who, action) => {
      const history = [...(t.history || []), { t: now(), time: hhmm(), who, action }].slice(-30);
      return db.patch('tasks', t.id, { history });
    };

    get('/api/tasks', async (ctx) => {
      let list = db.all('tasks');
      const st = ctx.query.get('status');
      if (st === 'aktiv') list = list.filter((t) => t.status !== 'erledigt' && t.status !== 'bestätigt');
      else if (st) list = list.filter((t) => t.status === st);
      const mazeId = ctx.query.get('maze');
      if (mazeId) list = list.filter((t) => t.mazeId === mazeId);
      if (ctx.query.get('mine') === '1') {
        list = list.filter((t) => t.assigneeId === ctx.person.id);
      }
      if (ctx.query.get('critical') === '1') list = list.filter((t) => t.critical);
      return list.sort((a, b) =>
        Number(b.critical) - Number(a.critical) ||
        PRIOS.indexOf(a.prio) - PRIOS.indexOf(b.prio) ||
        (deadlineTs(a.deadline) ?? Infinity) - (deadlineTs(b.deadline) ?? Infinity) ||
        b.t - a.t).map(enrich);
    });

    // Leitstand-Board: Zähler je Status/Maze + Brennpunkte
    get('/api/tasks/board', async () => {
      const all = db.all('tasks');
      const byStatus = Object.fromEntries(STATI.map((s) => [s, all.filter((t) => t.status === s).length]));
      const aktiv = all.filter((t) => t.status !== 'erledigt' && t.status !== 'bestätigt');
      return {
        byStatus,
        aktiv: aktiv.length,
        kritischOffen: aktiv.filter((t) => t.critical).length,
        blockiert: byStatus['blockiert'],
        ueberfaellig: aktiv.filter((t) => t.deadline && (deadlineTs(t.deadline) ?? Infinity) < now()).length,
        jeMaze: db.all('mazes').map((m) => ({
          mazeId: m.id, maze: m.name,
          offen: aktiv.filter((t) => t.mazeId === m.id).length,
        })),
      };
    }, { roles: ['management', 'lead'] });

    post('/api/tasks', async (ctx) => {
      if (!isOps(ctx)) bad('Nur Lead/Management erstellen Aufgaben');
      const prio = ctx.body.prio || 'normal';
      if (!PRIOS.includes(prio)) bad('Priorität: hoch, normal oder niedrig');
      if (ctx.body.phase && !PHASES.includes(ctx.body.phase)) bad('Phase: aufbau, live oder abschluss');
      if (ctx.body.mazeId && !db.get('mazes', ctx.body.mazeId)) notFound('Maze nicht gefunden');
      if (ctx.body.assigneeId && !db.get('people', ctx.body.assigneeId)) notFound('Person nicht gefunden');
      const t = {
        id: id('t'), t: now(), time: hhmm(),
        title: need(ctx.body, 'title').slice(0, 160),
        desc: (ctx.body.desc || '').slice(0, 600),
        prio, critical: !!ctx.body.critical,
        status: 'offen',
        mazeId: ctx.body.mazeId || null,
        assigneeId: ctx.body.assigneeId || null,
        deadline: ctx.body.deadline || null,
        phase: ctx.body.phase || null,
        createdBy: ctx.person.name, note: null,
        history: [{ t: now(), time: hhmm(), who: ctx.person.name, action: 'erstellt' }],
      };
      db.put('tasks', t.id, t);
      if (t.critical) {
        feed(`📋 Kritische Aufgabe: ${t.title}${t.mazeId ? ` (${db.get('mazes', t.mazeId)?.name})` : ''}`,
          { kind: 'aufgabe', level: 'warn', by: ctx.person.name, mazeId: t.mazeId });
      }
      bus.publish('task.changed', enrich(t));
      return enrich(t);
    });

    // Dispatch / Delegation: an Person und/oder Maze hängen
    post('/api/tasks/:id/assign', async (ctx) => {
      if (!isOps(ctx)) bad('Nur Lead/Management verteilen Aufgaben');
      const t = db.get('tasks', ctx.params.id) || notFound('Aufgabe nicht gefunden');
      const upd = {};
      if (ctx.body.assigneeId !== undefined) {
        if (ctx.body.assigneeId && !db.get('people', ctx.body.assigneeId)) notFound('Person nicht gefunden');
        upd.assigneeId = ctx.body.assigneeId || null;
      }
      if (ctx.body.mazeId !== undefined) {
        if (ctx.body.mazeId && !db.get('mazes', ctx.body.mazeId)) notFound('Maze nicht gefunden');
        upd.mazeId = ctx.body.mazeId || null;
      }
      // Neuzuweisung einer blockierten/erledigten Aufgabe öffnet sie wieder
      if (upd.assigneeId && (t.status === 'blockiert' || t.status === 'offen')) upd.status = 'angenommen';
      db.patch('tasks', t.id, upd);
      const who = upd.assigneeId ? db.get('people', upd.assigneeId)?.name : null;
      log(db.get('tasks', t.id), ctx.person.name, who ? `→ ${who}` : 'umverteilt');
      bus.publish('task.changed', enrich(db.get('tasks', t.id)));
      return enrich(db.get('tasks', t.id));
    });

    patch('/api/tasks/:id', async (ctx) => {
      const t = db.get('tasks', ctx.params.id) || notFound('Aufgabe nicht gefunden');
      const upd = {};

      if (ctx.body.status) {
        if (!STATI.includes(ctx.body.status)) bad('Unbekannter Status');
        // Rechte: Zugewiesene dürfen ihren Status pflegen, Ops alles;
        // „bestätigt“ (Abnahme) nur Lead/Management.
        const own = t.assigneeId === ctx.person.id;
        if (!own && !isOps(ctx)) bad('Nur zugewiesene Person oder Lead/Management');
        if (ctx.body.status === 'bestätigt' && !isOps(ctx)) bad('Abnahme nur durch Lead/Management');
        if (ctx.body.status === 'blockiert' && !String(ctx.body.note || '').trim()) {
          bad('Blocker brauchen eine kurze Begründung (note)');
        }
        upd.status = ctx.body.status;
        if (ctx.body.status === 'erledigt') upd.doneAt = now();
        if (ctx.body.note !== undefined) upd.note = String(ctx.body.note).slice(0, 300);
        // Selbst-Annahme ohne Zuweisung: wer anpackt, übernimmt
        if (!t.assigneeId && (ctx.body.status === 'angenommen' || ctx.body.status === 'in_arbeit')) {
          upd.assigneeId = ctx.person.id;
        }
      }
      if (isOps(ctx)) {
        for (const k of ['title', 'desc', 'deadline', 'phase']) if (ctx.body[k] !== undefined) upd[k] = ctx.body[k];
        if (ctx.body.prio) { if (!PRIOS.includes(ctx.body.prio)) bad('Unbekannte Priorität'); upd.prio = ctx.body.prio; }
        if (ctx.body.critical !== undefined) upd.critical = !!ctx.body.critical;
      }
      if (!Object.keys(upd).length) bad('Nichts zu ändern');

      db.patch('tasks', t.id, upd);
      log(db.get('tasks', t.id), ctx.person.name, upd.status ? upd.status : 'bearbeitet');
      const e = enrich(db.get('tasks', t.id));
      if (upd.status === 'blockiert') {
        feed(`🧱 Aufgabe blockiert: ${t.title} — „${upd.note || ''}“ (${ctx.person.name})`,
          { kind: 'aufgabe', level: t.critical ? 'err' : 'warn', mazeId: t.mazeId });
      } else if (upd.status === 'erledigt' && t.critical) {
        feed(`✔️ Kritische Aufgabe erledigt: ${t.title} (${ctx.person.name})`, { kind: 'aufgabe', mazeId: t.mazeId });
      }
      bus.publish('task.changed', e);
      return e;
    });
  },
};
