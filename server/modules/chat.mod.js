// Modul: Chat
// Kanäle: #leitstand (Mgmt/Leads), #crew (alle), je Maze ein Kanal, #catering,
// Fahrgruppen-Kanäle (vom Fahrgruppen-Modul erzeugt) und Direktnachrichten.
import { bad, need, notFound, id, now, hhmm } from '../kernel/util.js';

export default {
  name: 'chat',
  title: 'Chat',
  version: '1.0.0',
  description: 'Kanäle, Direktnachrichten, Ungelesen-Zähler — Echtzeit über SSE.',

  init({ db }) {
    // Systemkanäle sicherstellen
    const ensure = (key, name, type, extra = {}) => {
      if (!db.one('channels', (c) => c.key === key)) {
        db.put('channels', key, { id: key, key, name, type, members: null, createdAt: now(), ...extra });
      }
    };
    ensure('ch_leitstand', '#leitstand', 'system', { restrict: ['management', 'lead'] });
    ensure('ch_crew', '#crew', 'system');
    ensure('ch_catering', '#catering', 'system', { restrict: ['management', 'catering'] });
    for (const m of db.all('mazes')) {
      ensure(`ch_maze_${m.id}`, `#${m.name.toLowerCase().replace(/\s+/g, '-')}`, 'maze', { mazeId: m.id });
    }
  },

  routes({ get, post }, { db, bus }) {
    const visibleTo = (c, person, role) => {
      const roles = new Set([role, ...(person.roles || [])]);
      if (roles.has('management')) return true;
      if (c.members) return c.members.includes(person.id);
      if (c.restrict) return c.restrict.some((r) => roles.has(r));
      if (c.type === 'maze') {
        const pos = db.one('positions', (x) => x.assignedPersonId === person.id);
        const maze = c.mazeId ? db.get('mazes', c.mazeId) : null;
        return pos?.mazeId === c.mazeId || maze?.leadPersonId === person.id;
      }
      return true; // #crew u. ä.
    };

    const channelInfo = (c, personId) => {
      const msgs = db.find('messages', (m) => m.channelId === c.id);
      const last = msgs.sort((a, b) => b.t - a.t)[0] || null;
      const readMark = db.get('chatReads', `${c.id}_${personId}`);
      const unread = msgs.filter((m) => m.t > (readMark?.t || 0) && m.byPersonId !== personId).length;
      let name = c.name;
      if (c.type === 'dm') {
        const other = (c.members || []).find((x) => x !== personId);
        name = db.get('people', other)?.name || 'Direktnachricht';
      }
      return {
        id: c.id, name, type: c.type, mazeId: c.mazeId || null, members: c.members || null,
        last: last ? { text: last.text.slice(0, 80), by: last.byName, t: last.t, time: last.time } : null,
        unread,
      };
    };

    get('/api/chat/channels', async (ctx) => {
      return db.all('channels')
        .filter((c) => visibleTo(c, ctx.person, ctx.session.role))
        .map((c) => channelInfo(c, ctx.person.id))
        .sort((a, b) => (b.last?.t || 0) - (a.last?.t || 0));
    });

    post('/api/chat/dm', async (ctx) => {
      const otherId = need(ctx.body, 'personId');
      const other = db.get('people', otherId) || notFound('Person nicht gefunden');
      if (other.id === ctx.person.id) bad('Selbstgespräche bitte analog führen 🙂');
      const existing = db.one('channels', (c) => c.type === 'dm' &&
        c.members?.includes(ctx.person.id) && c.members?.includes(other.id));
      if (existing) return channelInfo(existing, ctx.person.id);
      const c = {
        id: id('ch'), key: null, name: 'DM', type: 'dm',
        members: [ctx.person.id, other.id], createdAt: now(),
      };
      db.put('channels', c.id, c);
      return channelInfo(c, ctx.person.id);
    });

    get('/api/chat/:ch/messages', async (ctx) => {
      const c = db.get('channels', ctx.params.ch) || notFound('Kanal nicht gefunden');
      if (!visibleTo(c, ctx.person, ctx.session.role)) bad('Kein Zugriff auf diesen Kanal');
      const after = Number(ctx.query.get('after') || 0);
      return db.find('messages', (m) => m.channelId === c.id && m.t > after)
        .sort((a, b) => a.t - b.t).slice(-200);
    });

    post('/api/chat/:ch/messages', async (ctx) => {
      const c = db.get('channels', ctx.params.ch) || notFound('Kanal nicht gefunden');
      if (!visibleTo(c, ctx.person, ctx.session.role)) bad('Kein Zugriff auf diesen Kanal');
      const m = {
        id: id('msg'), channelId: c.id, t: now(), time: hhmm(),
        byPersonId: ctx.person.id, byName: ctx.person.name,
        text: need(ctx.body, 'text').slice(0, 1000),
      };
      db.put('messages', m.id, m);
      db.put('chatReads', `${c.id}_${ctx.person.id}`, { id: `${c.id}_${ctx.person.id}`, t: m.t });
      bus.publish('chat.message', { ...m, channelType: c.type, channelName: c.name, members: c.members || null }, {
        audience: (client) => visibleTo(c, client.person, client.session.role),
      });
      return m;
    });

    post('/api/chat/:ch/read', async (ctx) => {
      const c = db.get('channels', ctx.params.ch) || notFound('Kanal nicht gefunden');
      db.put('chatReads', `${c.id}_${ctx.person.id}`, { id: `${c.id}_${ctx.person.id}`, t: now() });
      return { ok: true };
    });
  },
};
