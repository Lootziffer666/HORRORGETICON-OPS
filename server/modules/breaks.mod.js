// Modul: Pausen & Springer
// Anfrage (Actor) → Freigabe/Vertagen (Lead/Leitstand) → läuft → beendet.
// Schlägt freie Springer als Ablösung vor (Mockup: „Resa F. kann A3 übernehmen“).
import { bad, notFound, id, now, hhmm } from '../kernel/util.js';
import { presenceStatus } from './live.mod.js';

const DEFAULT_BREAK_MIN = 15;

export default {
  name: 'breaks',
  title: 'Pausen & Springer',
  version: '1.0.0',
  description: 'Pausen-Anfragen, Freigaben, Springer-Vorschläge, Pausen-Historie.',

  routes({ get, post }, { db, bus, feed }) {
    const enrich = (b) => {
      const person = db.get('people', b.personId);
      const pos = db.one('positions', (x) => x.assignedPersonId === b.personId);
      const maze = pos ? db.get('mazes', pos.mazeId) : null;
      const lastBreak = db.find('breaks', (x) => x.personId === b.personId && x.status === 'beendet')
        .sort((a, c) => (c.endedAt || 0) - (a.endedAt || 0))[0];
      return {
        ...b, person: person?.name || '?', personCode: person?.code,
        maze: maze?.name || null, mazeId: maze?.id || null, position: pos?.code || null,
        wartetSeitMin: b.status === 'offen' ? Math.round((now() - b.requestedAt) / 60000) : null,
        letztePauseVorMin: lastBreak ? Math.round((now() - lastBreak.endedAt) / 60000) : null,
      };
    };

    get('/api/breaks', async (ctx) => {
      let list = db.all('breaks');
      const status = ctx.query.get('status');
      if (status) list = list.filter((b) => b.status === status);
      const mazeId = ctx.query.get('maze');
      if (mazeId) {
        list = list.filter((b) => {
          const pos = db.one('positions', (x) => x.assignedPersonId === b.personId);
          return pos?.mazeId === mazeId;
        });
      }
      return list.sort((a, b) => b.requestedAt - a.requestedAt).slice(0, 200).map(enrich);
    });

    get('/api/breaks/mine', async (ctx) =>
      db.find('breaks', (b) => b.personId === ctx.person.id)
        .sort((a, b) => b.requestedAt - a.requestedAt).slice(0, 20).map(enrich));

    post('/api/breaks/request', async (ctx) => {
      const pid = ctx.person.id;
      if (db.one('breaks', (b) => b.personId === pid && ['offen', 'genehmigt', 'läuft'].includes(b.status))) {
        bad('Es läuft bereits eine Pausen-Anfrage');
      }
      const b = {
        id: id('b'), personId: pid, note: (ctx.body.note || '').slice(0, 500),
        requestedAt: now(), time: hhmm(), status: 'offen',
        durationMin: Math.min(Math.max(Number(ctx.body.durationMin) || DEFAULT_BREAK_MIN, 1), 120),
      };
      db.put('breaks', b.id, b);
      const e = enrich(b);
      feed(`☕ Pausen-Anfrage: ${e.person}${e.position ? ` (${e.maze} · ${e.position})` : ''}${b.note ? ` — „${b.note}“` : ''}`,
        { kind: 'pause', level: 'info', mazeId: e.mazeId });
      bus.publish('break.changed', e);
      return e;
    });

    post('/api/breaks/:id/approve', async (ctx) => {
      const b = db.get('breaks', ctx.params.id) || notFound('Anfrage nicht gefunden');
      if (b.status !== 'offen' && b.status !== 'genehmigt') bad('Anfrage ist nicht mehr offen');
      const inMin = Number(ctx.body.inMin) || 0;
      const upd = inMin > 0
        ? { status: 'genehmigt', plannedAt: now() + inMin * 60000, approvedBy: ctx.person.name }
        : { status: 'läuft', startedAt: now(), approvedBy: ctx.person.name, springerId: ctx.body.springerId || null };
      db.patch('breaks', b.id, upd);
      const e = enrich(db.get('breaks', b.id));
      if (upd.springerId) {
        const springer = db.get('people', upd.springerId);
        feed(`🔁 ${springer?.name || 'Springer'} übernimmt ${e.position || 'Position'} während der Pause von ${e.person}.`, { kind: 'pause', mazeId: e.mazeId });
      }
      feed(inMin > 0
        ? `⏳ Pause von ${e.person} in ${inMin} min freigegeben (${ctx.person.name}).`
        : `☕ Pause von ${e.person} läuft (freigegeben von ${ctx.person.name}).`,
        { kind: 'pause', mazeId: e.mazeId });
      bus.publish('break.changed', e);
      bus.publish('presence.changed', { personId: b.personId });
      return e;
    }, { roles: ['management', 'lead'] });

    post('/api/breaks/:id/start', async (ctx) => {
      const b = db.get('breaks', ctx.params.id) || notFound('Anfrage nicht gefunden');
      if (b.personId !== ctx.person.id) bad('Nur die eigene Pause kann gestartet werden');
      if (b.status !== 'genehmigt') bad('Pause ist (noch) nicht freigegeben');
      db.patch('breaks', b.id, { status: 'läuft', startedAt: now() });
      const e = enrich(db.get('breaks', b.id));
      bus.publish('break.changed', e);
      bus.publish('presence.changed', { personId: b.personId });
      return e;
    });

    post('/api/breaks/:id/deny', async (ctx) => {
      const b = db.get('breaks', ctx.params.id) || notFound('Anfrage nicht gefunden');
      if (b.status !== 'offen') bad('Anfrage ist nicht mehr offen');
      db.patch('breaks', b.id, { status: 'abgelehnt', deniedBy: ctx.person.name, reason: ctx.body.reason || '' });
      const e = enrich(db.get('breaks', b.id));
      feed(`🚫 Pause von ${e.person} abgelehnt${ctx.body.reason ? ` — ${ctx.body.reason}` : ''}.`, { kind: 'pause', mazeId: e.mazeId });
      bus.publish('break.changed', e);
      return e;
    }, { roles: ['management', 'lead'] });

    post('/api/breaks/:id/end', async (ctx) => {
      const b = db.get('breaks', ctx.params.id) || notFound('Anfrage nicht gefunden');
      if (b.status !== 'läuft' && b.status !== 'genehmigt') bad('Pause läuft nicht');
      const own = b.personId === ctx.person.id;
      const roles = new Set([ctx.session.role, ...(ctx.person.roles || [])]);
      if (!own && !roles.has('lead') && !roles.has('management')) bad('Keine Berechtigung');
      db.patch('breaks', b.id, { status: 'beendet', endedAt: now() });
      const e = enrich(db.get('breaks', b.id));
      feed(`▶️ ${e.person} ist zurück auf ${e.position || 'Position'}.`, { kind: 'pause', mazeId: e.mazeId });
      bus.publish('break.changed', e);
      bus.publish('presence.changed', { personId: b.personId });
      return e;
    });

    // Springer-Vorschlag: eingecheckte Springer ohne aktuelle Position
    get('/api/breaks/springer', async () => {
      const candidates = db.find('people', (p) => p.status === 'aktiv' && p.roles.includes('springer'));
      return candidates.map((p) => ({
        id: p.id, name: p.name,
        status: presenceStatus(db, p.id),
        frei: presenceStatus(db, p.id) === 'aktiv' && !db.one('positions', (x) => x.assignedPersonId === p.id),
      })).sort((a, b) => Number(b.frei) - Number(a.frei));
    }, { roles: ['management', 'lead'] });
  },
};
