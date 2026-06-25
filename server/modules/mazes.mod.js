// Modul: Mazes & Zuteilung (Pitch „Minimalpaket“ Teil 2)
// Mazes + Positionen anlegen/benennen, Personen zuordnen,
// offene/doppelte Zuteilungen sichtbar machen, Lead je Maze.
import { bad, need, notFound, id, iso } from '../kernel/util.js';

export default {
  name: 'mazes',
  title: 'Mazes & Zuteilung',
  version: '1.0.0',
  core: true,
  description: 'Maze- und Positionsverwaltung, Zuteilung der Crew, Konflikt-Erkennung.',

  routes({ get, post, patch, del }, { db, bus, feed }) {
    const summarize = (m) => {
      const pos = db.find('positions', (p) => p.mazeId === m.id);
      const besetzt = pos.filter((p) => p.assignedPersonId).length;
      return {
        ...m, positionen: pos.length, besetzt,
        lead: m.leadPersonId ? db.get('people', m.leadPersonId)?.name || null : null,
      };
    };

    get('/api/mazes', async () => db.all('mazes').sort((a, b) => (a.order || 0) - (b.order || 0)).map(summarize));

    get('/api/mazes/:id', async (ctx) => {
      const m = db.get('mazes', ctx.params.id) || notFound('Maze nicht gefunden');
      const positions = db.find('positions', (p) => p.mazeId === m.id)
        .sort((a, b) => a.code.localeCompare(b.code, 'de', { numeric: true }))
        .map((p) => ({ ...p, person: p.assignedPersonId ? strip(db.get('people', p.assignedPersonId)) : null }));
      return { ...summarize(m), positions };
    });

    post('/api/mazes', async (ctx) => {
      const m = {
        id: id('m'), name: need(ctx.body, 'name'),
        short: (ctx.body.short || ctx.body.name[0]).toUpperCase(),
        order: ctx.body.order ?? db.count('mazes') + 1,
        zone: ctx.body.zone || null, leadPersonId: ctx.body.leadPersonId || null,
        callTime: parseHHMM(ctx.body.callTime),
        rooms: ctx.body.rooms || [], createdAt: iso(),
      };
      db.put('mazes', m.id, m);
      bus.publish('maze.changed', { mazeId: m.id });
      return m;
    }, { roles: ['management'] });

    patch('/api/mazes/:id', async (ctx) => {
      const m = db.get('mazes', ctx.params.id) || notFound('Maze nicht gefunden');
      const upd = {};
      for (const k of ['name', 'short', 'order', 'zone', 'leadPersonId', 'rooms']) {
        if (ctx.body[k] !== undefined) upd[k] = ctx.body[k];
      }
      if (ctx.body.callTime !== undefined) upd.callTime = parseHHMM(ctx.body.callTime);
      const next = db.put('mazes', m.id, { ...m, ...upd });
      bus.publish('maze.changed', { mazeId: m.id });
      return next;
    }, { roles: ['management'] });

    del('/api/mazes/:id', async (ctx) => {
      const m = db.get('mazes', ctx.params.id) || notFound('Maze nicht gefunden');
      const pos = db.find('positions', (p) => p.mazeId === m.id);
      if (pos.some((p) => p.assignedPersonId)) bad('Maze hat noch zugeteilte Personen — erst Zuteilungen lösen');
      for (const p of pos) db.del('positions', p.id);
      db.del('mazes', m.id);
      bus.publish('maze.changed', { mazeId: m.id });
      return { ok: true };
    }, { roles: ['management'] });

    post('/api/positions', async (ctx) => {
      const mazeId = need(ctx.body, 'mazeId');
      if (!db.get('mazes', mazeId)) notFound('Maze nicht gefunden');
      const p = {
        id: id('pos'), mazeId,
        code: need(ctx.body, 'code').toUpperCase(),
        name: ctx.body.name || '', desc: ctx.body.desc || '',
        room: ctx.body.room || null, // {x:'42%', y:'18%'} auf der Maze-Schemakarte
        assignedPersonId: ctx.body.assignedPersonId || null,
      };
      if (db.one('positions', (x) => x.mazeId === mazeId && x.code === p.code)) bad(`Position ${p.code} existiert in dieser Maze schon`);
      db.put('positions', p.id, p);
      bus.publish('maze.changed', { mazeId, positionId: p.id });
      return p;
    }, { roles: ['management'] });

    patch('/api/positions/:id', async (ctx) => {
      const p = db.get('positions', ctx.params.id) || notFound('Position nicht gefunden');
      const upd = {};
      for (const k of ['code', 'name', 'desc', 'room']) if (ctx.body[k] !== undefined) upd[k] = ctx.body[k];
      const next = db.put('positions', p.id, { ...p, ...upd });
      bus.publish('maze.changed', { mazeId: p.mazeId, positionId: p.id });
      return next;
    }, { roles: ['management'] });

    del('/api/positions/:id', async (ctx) => {
      const p = db.get('positions', ctx.params.id) || notFound('Position nicht gefunden');
      db.del('positions', p.id);
      bus.publish('maze.changed', { mazeId: p.mazeId });
      return { ok: true };
    }, { roles: ['management'] });

    // Zuteilen / Freigeben (personId: null → Position wird frei)
    post('/api/positions/:id/assign', async (ctx) => {
      const pos = db.get('positions', ctx.params.id) || notFound('Position nicht gefunden');
      const personId = ctx.body.personId ?? null;
      if (personId) {
        const person = db.get('people', personId) || notFound('Person nicht gefunden');
        if (person.status !== 'aktiv') bad(`${person.name} ist nicht aktiv (${person.status})`);
        // Doppelzuteilung lösen: Person verlässt ihre alte Position
        for (const other of db.find('positions', (x) => x.assignedPersonId === personId && x.id !== pos.id)) {
          db.patch('positions', other.id, { assignedPersonId: null });
        }
        db.patch('positions', pos.id, { assignedPersonId: personId, assignedAt: iso(), assignedBy: ctx.person.name });
        const maze = db.get('mazes', pos.mazeId);
        feed(`📍 ${person.name} → ${maze?.name || '?'} · ${pos.code} ${pos.name ? `„${pos.name}“` : ''}`, { kind: 'zuteilung', by: ctx.person.name, mazeId: pos.mazeId });
      } else {
        db.patch('positions', pos.id, { assignedPersonId: null });
      }
      bus.publish('maze.changed', { mazeId: pos.mazeId, positionId: pos.id });
      return db.get('positions', pos.id);
    }, { roles: ['management', 'lead'] });

    // Konflikte: offene Positionen, Doppelzuteilungen, Nicht-Zugeteilte
    get('/api/assignments/issues', async () => {
      const positions = db.all('positions');
      const open = positions.filter((p) => !p.assignedPersonId).map((p) => ({
        ...p, maze: db.get('mazes', p.mazeId)?.name,
      }));
      const byPerson = {};
      for (const p of positions) {
        if (p.assignedPersonId) (byPerson[p.assignedPersonId] ||= []).push(p);
      }
      const doubles = Object.entries(byPerson).filter(([, l]) => l.length > 1).map(([pid, l]) => ({
        person: strip(db.get('people', pid)), positions: l,
      }));
      const assignedIds = new Set(Object.keys(byPerson));
      const unassigned = db.find('people', (p) =>
        p.status === 'aktiv' && (p.roles.includes('actor') || p.roles.includes('springer')) && !assignedIds.has(p.id))
        .map(strip);
      return { open, doubles, unassigned };
    }, { roles: ['management', 'lead'] });
  },
};

function strip(p) { if (!p) return null; const { pin, ...rest } = p; return rest; }

// Rufzeit-Parser: leer → null, sonst validierte Uhrzeit "HH:MM".
function parseHHMM(v) {
  if (v === undefined || v === null || v === '') return null;
  const m = String(v).match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) bad('Rufzeit muss eine Uhrzeit "HH:MM" sein');
  return `${String(m[1]).padStart(2, '0')}:${m[2]}`;
}
