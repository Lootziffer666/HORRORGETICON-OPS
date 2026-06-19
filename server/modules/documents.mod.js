// Modul: Dokumenten-Hub
// Zentraler Ort fuer Event-Dokumentation (Briefings, Lageplaene, Notfall-Infos).
// Management erstellt/bearbeitet Dokumente, Leads und Actors lesen (je nach Sichtbarkeit).
// Angepinnte Dokumente erscheinen immer zuerst.
import { bad, need, notFound, id, now, hhmm } from '../kernel/util.js';

const CATEGORIES = ['briefing', 'lageplan', 'notfall', 'sonstiges'];
const VISIBILITIES = ['alle', 'management', 'lead'];

function userRoles(ctx) {
  return new Set([ctx.session.role, ...(ctx.person.roles || [])]);
}

function canSee(doc, roles) {
  if (doc.visibility === 'alle') return true;
  if (doc.visibility === 'management') return roles.has('management');
  if (doc.visibility === 'lead') return roles.has('management') || roles.has('lead');
  return true;
}

export default {
  name: 'documents',
  title: 'Dokumenten-Hub',
  version: '1.0.0',
  description: 'Zentrale Verwaltung von Event-Dokumenten (Briefings, Lageplaene, Notfall-Infos) mit Sichtbarkeitssteuerung.',

  routes({ get, post, patch, del }, { db, bus, feed }) {

    get('/api/documents', async (ctx) => {
      let list = db.all('documents');
      const roles = userRoles(ctx);

      // Visibility filtering
      list = list.filter((doc) => canSee(doc, roles));

      // Category filtering
      const category = ctx.query.get('category');
      if (category && CATEGORIES.includes(category)) {
        list = list.filter((doc) => doc.category === category);
      }

      // Pinned first, then newest first
      list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt);

      return list;
    });

    post('/api/documents', async (ctx) => {
      const title = need(ctx.body, 'title');
      const content = ctx.body.content || '';
      const category = ctx.body.category || 'sonstiges';
      if (!CATEGORIES.includes(category)) bad('Kategorie muss briefing, lageplan, notfall oder sonstiges sein');
      const visibility = ctx.body.visibility || 'alle';
      if (!VISIBILITIES.includes(visibility)) bad('Sichtbarkeit muss alle, management oder lead sein');

      const doc = {
        id: id('doc'),
        title: title.slice(0, 200),
        content: String(content).slice(0, 50000),
        category,
        visibility,
        pinned: !!ctx.body.pinned,
        createdAt: now(),
        createdBy: ctx.person.name,
        updatedAt: now(),
        updatedBy: ctx.person.name,
      };
      db.put('documents', doc.id, doc);
      bus.publish('documents.changed', doc);
      return doc;
    }, { roles: ['management'] });

    patch('/api/documents/:id', async (ctx) => {
      const doc = db.get('documents', ctx.params.id);
      if (!doc) notFound('Dokument nicht gefunden');

      const upd = {};
      if (ctx.body.title !== undefined) upd.title = String(ctx.body.title).trim().slice(0, 200);
      if (ctx.body.content !== undefined) upd.content = String(ctx.body.content).slice(0, 50000);
      if (ctx.body.category !== undefined) {
        if (!CATEGORIES.includes(ctx.body.category)) bad('Kategorie muss briefing, lageplan, notfall oder sonstiges sein');
        upd.category = ctx.body.category;
      }
      if (ctx.body.visibility !== undefined) {
        if (!VISIBILITIES.includes(ctx.body.visibility)) bad('Sichtbarkeit muss alle, management oder lead sein');
        upd.visibility = ctx.body.visibility;
      }
      if (ctx.body.pinned !== undefined) upd.pinned = !!ctx.body.pinned;

      if (!Object.keys(upd).length) bad('Nichts zu aendern');

      upd.updatedAt = now();
      upd.updatedBy = ctx.person.name;
      db.patch('documents', doc.id, upd);
      const updated = db.get('documents', doc.id);
      bus.publish('documents.changed', updated);
      return updated;
    }, { roles: ['management'] });

    del('/api/documents/:id', async (ctx) => {
      const doc = db.get('documents', ctx.params.id);
      if (!doc) notFound('Dokument nicht gefunden');
      db.del('documents', doc.id);
      bus.publish('documents.changed', { id: doc.id, deleted: true });
      return { ok: true };
    }, { roles: ['management'] });
  },
};
