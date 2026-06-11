// Modul: Zeitplan & Schichten
// Eventnacht mit Schichtfenster, Einlass-Wellen und gestaffeltem Pausenplan-Vorschlag.
import { bad, need, notFound, id } from '../kernel/util.js';

export default {
  name: 'schedule',
  title: 'Zeitplan',
  version: '1.0.0',
  description: 'Schichten, Einlass-Wellen, Pausenplan-Vorschlag.',

  routes({ get, post, patch, del }, { db, bus }) {
    get('/api/schedule', async () => ({
      shifts: db.all('shifts').sort((a, b) => String(a.start).localeCompare(String(b.start))),
      settings: (() => { const s = db.get('settings', 'main'); return { shiftStart: s?.shiftStart, shiftEnd: s?.shiftEnd, nightLabel: s?.nightLabel }; })(),
    }));

    post('/api/schedule/shifts', async (ctx) => {
      const s = {
        id: id('sh'), name: need(ctx.body, 'name'),
        start: need(ctx.body, 'start'), end: need(ctx.body, 'end'),
        gruppe: ctx.body.gruppe || 'crew', notiz: ctx.body.notiz || '',
      };
      db.put('shifts', s.id, s);
      bus.publish('schedule.changed', {});
      return s;
    }, { roles: ['management'] });

    patch('/api/schedule/shifts/:id', async (ctx) => {
      const s = db.get('shifts', ctx.params.id) || notFound('Schicht nicht gefunden');
      const upd = {};
      for (const k of ['name', 'start', 'end', 'gruppe', 'notiz']) if (ctx.body[k] !== undefined) upd[k] = ctx.body[k];
      const next = db.put('shifts', s.id, { ...s, ...upd });
      bus.publish('schedule.changed', {});
      return next;
    }, { roles: ['management'] });

    del('/api/schedule/shifts/:id', async (ctx) => {
      if (!db.get('shifts', ctx.params.id)) notFound('Schicht nicht gefunden');
      db.del('shifts', ctx.params.id);
      bus.publish('schedule.changed', {});
      return { ok: true };
    }, { roles: ['management'] });

    // Gestaffelter Pausenplan: pro Maze versetzt, damit nie zwei Nachbarn
    // gleichzeitig weg sind. Reiner Vorschlag fürs Briefing.
    get('/api/schedule/breakplan', async () => {
      const settings = db.get('settings', 'main');
      const startMin = toMin(settings?.shiftStart || '18:00') + 150; // erste Pause ~2,5 h nach Start
      const plan = [];
      for (const m of db.all('mazes').sort((a, b) => (a.order || 0) - (b.order || 0))) {
        const pos = db.find('positions', (p) => p.mazeId === m.id && p.assignedPersonId)
          .sort((a, b) => a.code.localeCompare(b.code, 'de', { numeric: true }));
        plan.push({
          maze: m.name,
          slots: pos.map((p, i) => ({
            position: p.code,
            person: db.get('people', p.assignedPersonId)?.name || '?',
            von: fromMin(startMin + i * 15),
            bis: fromMin(startMin + i * 15 + 15),
          })),
        });
      }
      return { hinweis: 'Vorschlag: 15 min je Person, innerhalb der Maze gestaffelt.', plan };
    }, { roles: ['management', 'lead'] });
  },
};

function toMin(hm) { const [h, m] = String(hm).split(':').map(Number); return h * 60 + (m || 0); }
function fromMin(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
