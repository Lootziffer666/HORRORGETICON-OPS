// Modul: Backups & Wiederherstellung
// Sichtbar machen, was die DB-Schicht ohnehin automatisch tut (Autosave/Journal/
// Snapshots) + manuelle Aktionen: Backup jetzt, Wiederherstellen, Rebuild aus
// Journal, Voll-Export/-Import des Zustands.
import { bad, need } from '../kernel/util.js';
import { sendText } from '../kernel/http.js';

export default {
  name: 'backup',
  title: 'Backups & Wiederherstellung',
  version: '1.0.0',
  description: 'Snapshots, Journal, Rebuild, Voll-Export/-Import, Integritätsbericht.',

  routes({ get, post }, { db, bus, feed }) {
    get('/api/backups', async () => ({
      integrity: db.integrity(),
      backups: db.listBackups().map((b) => ({
        ...b, at: new Date(b.mtime).toLocaleString('de-DE'),
        mb: Math.round(b.bytes / 1024 / 102.4) / 10,
      })),
    }), { roles: ['management'] });

    post('/api/backups/create', async (ctx) => {
      const r = db.snapshot(`manuell durch ${ctx.person.name}`);
      feed(`💾 Backup erstellt (seq ${r.seq}) durch ${ctx.person.name}.`, { kind: 'system' });
      return { ok: true, ...r };
    }, { roles: ['management'] });

    post('/api/backups/restore', async (ctx) => {
      const file = need(ctx.body, 'file');
      const r = db.restoreBackup(file);
      feed(`⏪ Backup wiederhergestellt: ${file} (durch ${ctx.person.name}). Vorher wurde automatisch gesichert.`, { kind: 'system', level: 'warn' });
      bus.publish('db.restored', r);
      return { ok: true, ...r };
    }, { roles: ['management'] });

    post('/api/backups/rebuild', async (ctx) => {
      const r = db.rebuildFromJournal();
      feed(`🧩 Rebuild aus dem Journal abgeschlossen: ${r.replayed} Einträge nachgespielt (durch ${ctx.person.name}).`, { kind: 'system' });
      bus.publish('db.restored', { rebuild: true });
      return { ok: true, ...r };
    }, { roles: ['management'] });

    get('/api/backups/export', async (ctx) => {
      const payload = JSON.stringify({
        exportedAt: new Date().toISOString(), seq: db.seq,
        app: 'horrorgeticon-ops', state: db.state,
      }, null, 1);
      sendText(ctx.res, 200, payload, 'application/json; charset=utf-8', {
        'Content-Disposition': `attachment; filename="horrorgeticon-export-${Date.now()}.json"`,
      });
      return Symbol.for('handled');
    }, { roles: ['management'] });

    post('/api/backups/import', async (ctx) => {
      const data = ctx.body?.state ? ctx.body : null;
      if (!data || typeof data.state !== 'object') bad('Erwartet { state: {...} } aus einem Voll-Export');
      if (ctx.body.dryRun) {
        const counts = Object.fromEntries(Object.entries(data.state).map(([k, v]) => [k, Object.keys(v || {}).length]));
        return { dryRun: true, counts };
      }
      db.importState(data.state);
      feed(`📦 Voll-Import eingespielt (durch ${ctx.person.name}). Vorher wurde automatisch gesichert.`, { kind: 'system', level: 'warn' });
      bus.publish('db.restored', { import: true });
      return { ok: true };
    }, { roles: ['management'] });
  },
};
