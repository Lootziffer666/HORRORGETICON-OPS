// Modul: Berichte & Auswertungen
// Saison-Report („Erfahrung soll sich summieren“ — Pitch), Nacht-Auswertung,
// Anwesenheit, Catering-Verbrauch, Fahrgruppen-Quote.
import { presenceStatus } from './live.mod.js';

export default {
  name: 'reports',
  title: 'Berichte',
  version: '1.0.0',
  description: 'Auswertungen über Anwesenheit, Meldungen, Catering und Fahrgruppen.',

  routes({ get }, { db }) {
    get('/api/reports/overview', async () => {
      const crew = db.find('people', (p) => p.status === 'aktiv');
      const anwesend = crew.filter((p) => presenceStatus(db, p.id) !== 'out');
      const incidents = db.all('incidents');
      const done = incidents.filter((i) => i.reactionSec != null);
      const reds = db.all('redemptions');
      const groups = db.find('carpoolGroups', (g) => g.status === 'fix' || g.status === 'angefragt');
      const breaks = db.all('breaks');

      return {
        anwesenheit: {
          crew: crew.length, anwesend: anwesend.length,
          quote: crew.length ? Math.round((anwesend.length / crew.length) * 100) : 0,
          unentschuldigt: crew.filter((p) => {
            const pr = db.get('presence', p.id);
            return (!pr || pr.state !== 'in') && db.one('positions', (x) => x.assignedPersonId === p.id);
          }).length,
        },
        meldungen: {
          gesamt: incidents.length,
          offen: incidents.filter((i) => i.status !== 'erledigt').length,
          mittlereReaktionMin: done.length ? Math.round(done.reduce((s, i) => s + i.reactionSec, 0) / done.length / 6) / 10 : null,
          nachMaze: db.all('mazes').map((m) => ({
            maze: m.name, n: incidents.filter((i) => i.mazeId === m.id).length,
          })).sort((a, b) => b.n - a.n),
        },
        pausen: {
          gesamt: breaks.length,
          beendet: breaks.filter((b) => b.status === 'beendet').length,
          mittlereWartezeitMin: (() => {
            const w = breaks.filter((b) => b.startedAt && b.requestedAt);
            return w.length ? Math.round(w.reduce((s, b) => s + (b.startedAt - b.requestedAt), 0) / w.length / 6000) / 10 : null;
          })(),
        },
        catering: {
          drinks: reds.reduce((s, r) => s + r.drinks, 0),
          meals: reds.reduce((s, r) => s + r.meals, 0),
          einloesungen: reds.length,
          abgelehnt: db.count('rejections'),
        },
        fahrgruppen: {
          gruppen: groups.length,
          fix: groups.filter((g) => g.status === 'fix').length,
          mitfahrer: groups.reduce((s, g) => s + g.riderIds.length, 0),
          sitzauslastung: (() => {
            const seats = groups.reduce((s, g) => s + g.seats, 0);
            const used = groups.reduce((s, g) => s + g.riderIds.length, 0);
            return seats ? Math.round((used / seats) * 100) : 0;
          })(),
        },
      };
    }, { roles: ['management'] });

    // Übergabeprotokoll (horrops_fullstack.md: HandoverSummary) — alles, was
    // die nächste Schicht / der Nachbericht wissen muss, in einer Antwort.
    get('/api/reports/handover', async (ctx) => {
      const mazeId = ctx.query.get('maze') || null;
      const inMaze = (x) => !mazeId || x.mazeId === mazeId;
      const posIds = new Set(db.find('positions', (p) => !mazeId || p.mazeId === mazeId).map((p) => p.id));

      const tasks = db.find('tasks', (t) => inMaze(t) && t.status !== 'erledigt' && t.status !== 'bestätigt')
        .map((t) => ({ id: t.id, title: t.title, status: t.status, prio: t.prio, critical: t.critical, note: t.note, assignee: t.assigneeId ? db.get('people', t.assigneeId)?.name : null }));
      const incidents = db.find('incidents', (i) => inMaze(i) && i.status !== 'erledigt')
        .map((i) => ({ id: i.id, time: i.time, text: i.text, prio: i.prio, status: i.status, ort: i.ort }));
      const checklists = db.find('checklists', (c) => inMaze(c)).map((c) => ({
        id: c.id, title: c.title, type: c.type,
        done: c.items.filter((x) => x.done).length, total: c.items.length,
        pflichtOffen: c.items.filter((x) => x.mandatory && !x.done).length,
      }));
      const breaks = db.find('breaks', (b) => b.status === 'läuft')
        .filter((b) => {
          const pos = db.one('positions', (x) => x.assignedPersonId === b.personId);
          return !mazeId || pos?.mazeId === mazeId;
        })
        .map((b) => ({ person: db.get('people', b.personId)?.name || '?', seitMin: Math.round((Date.now() - (b.startedAt || b.requestedAt)) / 60000) }));
      const openPositions = db.find('positions', (p) => posIds.has(p.id) && !p.assignedPersonId)
        .map((p) => ({ code: p.code, name: p.name, maze: db.get('mazes', p.mazeId)?.name }));
      const decisions = db.find('feed', (f) => f.kind === 'entscheidung' && (!mazeId || !f.mazeId || f.mazeId === mazeId))
        .sort((a, b) => b.t - a.t).slice(0, 10);

      return {
        stand: new Date().toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit' }),
        maze: mazeId ? db.get('mazes', mazeId)?.name || null : null,
        offeneAufgaben: tasks, offeneVorfaelle: incidents, checklisten: checklists,
        laufendePausen: breaks, unbesetztePositionen: openPositions, entscheidungen: decisions,
      };
    }, { roles: ['management', 'lead'] });

    get('/api/reports/season', async () => {
      const seasons = {};
      for (const p of db.all('people')) {
        const s = p.season || '?';
        seasons[s] ||= { season: s, personen: 0, aktiv: 0 };
        seasons[s].personen++;
        if (p.status === 'aktiv') seasons[s].aktiv++;
      }
      return {
        seasons: Object.values(seasons).sort((a, b) => String(b.season).localeCompare(String(a.season))),
        mazes: db.all('mazes').map((m) => ({
          name: m.name,
          positionen: db.find('positions', (p) => p.mazeId === m.id).length,
          meldungen: db.find('incidents', (i) => i.mazeId === m.id).length,
        })),
      };
    }, { roles: ['management'] });
  },
};
