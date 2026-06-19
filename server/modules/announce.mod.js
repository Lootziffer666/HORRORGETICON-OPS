// Modul: Durchsagen & Live-Feed
// Durchsagen an alle / einzelne Mazes / einzelne Positionen, drei Stufen
// (Info · Wichtig · Notfall). Notfall = Vollbild-Alarm mit Lesebestätigung
// (Mockup: „Warnung an Maze senden“). Der Feed bündelt alle Ereignisse.
import { bad, need, notFound, id, now, hhmm } from '../kernel/util.js';

const LEVELS = ['info', 'wichtig', 'notfall'];

export const TEMPLATES = [
  { id: 'stop', level: 'notfall', text: 'Show stoppen, Position halten. Wartet auf Freigabe.' },
  { id: 'raeumen', level: 'notfall', text: 'Abschnitt räumen — ruhig zum nächsten Notausgang, Gäste mitnehmen.' },
  { id: 'security', level: 'wichtig', text: 'Security ist unterwegs zu euch. Position halten, Abstand zum Gast.' },
  { id: 'andrang', level: 'wichtig', text: 'Hoher Andrang am Einlass — Wellen werden enger getaktet. Bleibt auf Position.' },
  { id: 'weiter', level: 'info', text: 'Entwarnung — Show läuft normal weiter. Danke!' },
];

export default {
  name: 'announce',
  title: 'Durchsagen & Feed',
  version: '1.0.0',
  description: 'Durchsagen mit Empfängerkreis und Lesebestätigung; zentraler Live-Feed.',

  routes({ get, post }, { db, bus, feed }) {
    const audiencePersonIds = (scope) => {
      if (!scope || scope.type === 'all') return null; // alle
      if (scope.type === 'maze') {
        const ids = new Set();
        for (const pos of db.find('positions', (p) => p.mazeId === scope.mazeId && p.assignedPersonId)) {
          ids.add(pos.assignedPersonId);
        }
        const maze = db.get('mazes', scope.mazeId);
        if (maze?.leadPersonId) ids.add(maze.leadPersonId);
        return ids;
      }
      if (scope.type === 'positions') {
        const ids = new Set();
        for (const posId of scope.positionIds || []) {
          const pos = db.get('positions', posId);
          if (pos?.assignedPersonId) ids.add(pos.assignedPersonId);
        }
        return ids;
      }
      return new Set();
    };

    get('/api/announce/templates', async () => TEMPLATES);

    get('/api/announcements', async (ctx) => {
      const mine = ctx.query.get('mine') === '1';
      let list = db.all('announcements').sort((a, b) => b.t - a.t).slice(0, 100);
      if (mine) {
        list = list.filter((a) => {
          if (!a.audience) return true;
          return a.audience.includes(ctx.person.id);
        });
      }
      return list.map((a) => ({
        ...a,
        gelesen: !!db.get('announceReads', `${a.id}_${ctx.person.id}`),
        reads: undefined,
      }));
    });

    post('/api/announcements', async (ctx) => {
      const text = need(ctx.body, 'text').slice(0, 1000);
      const level = ctx.body.level || 'info';
      if (!LEVELS.includes(level)) bad('Stufe muss info, wichtig oder notfall sein');
      const scope = ctx.body.scope || { type: 'all' };
      if (typeof scope !== 'object' || scope === null || !scope.type) bad('Scope muss ein Objekt mit type sein');
      if (!['all', 'maze', 'positions'].includes(scope.type)) bad('Scope-Typ muss all, maze oder positions sein');
      const aud = audiencePersonIds(scope);
      const scopeLabel = scope.type === 'all' ? 'an alle'
        : scope.type === 'maze' ? `nur ${db.get('mazes', scope.mazeId)?.name || 'Maze'}`
          : `${(scope.positionIds || []).length} Position(en)`;
      const a = {
        id: id('a'), t: now(), time: hhmm(),
        text, level, scope, scopeLabel,
        audience: aud ? [...aud] : null,
        byPersonId: ctx.person.id, byName: ctx.person.name,
        requiresAck: level === 'notfall' || !!ctx.body.requiresAck,
      };
      db.put('announcements', a.id, a);
      feed(`📢 ${level === 'notfall' ? 'NOTFALL — ' : level === 'wichtig' ? 'Wichtig: ' : ''}${text}`, {
        kind: 'durchsage', level: level === 'notfall' ? 'err' : level === 'wichtig' ? 'warn' : 'info',
        by: ctx.person.name, scope: scopeLabel, mazeId: scope.mazeId || null,
      });
      bus.publish('announce.new', a, {
        audience: a.audience ? (c) => a.audience.includes(c.person.id) || isOps(c) : undefined,
      });
      if (a.requiresAck) {
        bus.publish('alarm', {
          announcementId: a.id, text: a.text, level, by: ctx.person.name, time: a.time,
          scopeLabel, mazeId: scope.mazeId || null,
          audience: a.audience,
        }, { audience: a.audience ? (c) => a.audience.includes(c.person.id) || isOps(c) : undefined });
      }
      return a;
    }, { roles: ['management', 'lead'] });

    post('/api/announcements/:id/read', async (ctx) => {
      const a = db.get('announcements', ctx.params.id) || notFound('Durchsage nicht gefunden');
      const key = `${a.id}_${ctx.person.id}`;
      if (!db.get('announceReads', key)) {
        db.put('announceReads', key, { id: key, annId: a.id, personId: ctx.person.id, t: now(), name: ctx.person.name });
        bus.publish('announce.read', { annId: a.id, personId: ctx.person.id, name: ctx.person.name });
      }
      return { ok: true };
    });

    get('/api/announcements/:id/reads', async (ctx) => {
      const a = db.get('announcements', ctx.params.id) || notFound('Durchsage nicht gefunden');
      const reads = db.find('announceReads', (r) => r.annId === a.id);
      const expected = a.audience
        ? a.audience.map((pid) => db.get('people', pid)).filter(Boolean)
        : db.find('people', (p) => p.status === 'aktiv');
      return {
        gelesen: reads.map((r) => ({ name: r.name, t: r.t })),
        offen: expected.filter((p) => !reads.some((r) => r.personId === p.id)).map((p) => ({ id: p.id, name: p.name })),
        quote: expected.length ? Math.round((reads.length / expected.length) * 100) : 100,
      };
    }, { roles: ['management', 'lead'] });

    // Entscheidungslog (horrops_fullstack.md: DecisionLog) — dokumentierte
    // Leitstand-Entscheidungen landen markiert im zentralen Feed.
    post('/api/feed/decision', async (ctx) => {
      const text = need(ctx.body, 'text').slice(0, 400);
      const item = feed(`📌 Entscheidung: ${text}`, {
        kind: 'entscheidung', level: 'info', by: ctx.person.name,
        mazeId: ctx.body.mazeId || null,
      });
      return item;
    }, { roles: ['management', 'lead'] });

    get('/api/feed', async (ctx) => {
      const limit = Number(ctx.query.get('limit') || 80);
      const mazeId = ctx.query.get('maze');
      const kind = ctx.query.get('kind');
      let list = db.all('feed').sort((a, b) => b.t - a.t);
      if (mazeId) list = list.filter((f) => !f.mazeId || f.mazeId === mazeId);
      if (kind) list = list.filter((f) => f.kind === kind);
      return list.slice(0, limit);
    });
  },
};

function isOps(client) {
  const roles = new Set([client.session?.role, ...(client.person?.roles || [])]);
  return roles.has('management') || roles.has('lead');
}
