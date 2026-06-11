// Modul: Einstellungen
// Event-Stammdaten (Name, Nacht, Schichtfenster), Catering-Budgets,
// Fahrgruppen-Parameter, eigene Orte für das Matching.
import { bad, need, id } from '../kernel/util.js';

const EDITABLE = ['eventName', 'nightLabel', 'eventDate', 'active', 'shiftStart', 'shiftEnd', 'catering', 'carpool'];

export default {
  name: 'settings',
  title: 'Einstellungen',
  version: '1.0.0',
  core: true,
  description: 'Event-Stammdaten, Budgets, Matching-Parameter, eigene Orte.',

  routes({ get, patch, post, del }, { db, bus, feed }) {
    get('/api/settings', async () => {
      const { secret, ...s } = db.get('settings', 'main') || {};
      return s;
    });

    patch('/api/settings', async (ctx) => {
      const cur = db.get('settings', 'main') || { id: 'main' };
      const upd = {};
      for (const k of EDITABLE) if (ctx.body[k] !== undefined) upd[k] = ctx.body[k];
      if (upd.catering) upd.catering = { ...cur.catering, ...upd.catering };
      if (upd.carpool) upd.carpool = { ...cur.carpool, ...upd.carpool };
      const next = db.put('settings', 'main', { ...cur, ...upd });
      feed(`⚙️ Einstellungen aktualisiert (${ctx.person.name}).`, { kind: 'system' });
      bus.publish('settings.changed', { keys: Object.keys(upd) });
      const { secret, ...pub } = next;
      return pub;
    }, { roles: ['management'] });

    get('/api/settings/orte', async () => db.all('orte').sort((a, b) => a.name.localeCompare(b.name, 'de')));

    post('/api/settings/orte', async (ctx) => {
      const name = need(ctx.body, 'name');
      const lat = Number(ctx.body.lat), lon = Number(ctx.body.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) bad('lat/lon müssen Zahlen sein');
      if (db.one('orte', (o) => o.name.toLowerCase() === name.toLowerCase())) bad('Ort existiert schon');
      const o = { id: id('o'), name, lat, lon };
      db.put('orte', o.id, o);
      return o;
    }, { roles: ['management'] });

    del('/api/settings/orte/:id', async (ctx) => {
      db.del('orte', ctx.params.id);
      return { ok: true };
    }, { roles: ['management'] });
  },
};
