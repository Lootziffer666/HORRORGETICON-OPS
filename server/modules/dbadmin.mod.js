// Modul: Datenbank-Pflege (manuell)
// Collection-Browser + Datensatz-Editor (JSON) mit Audit-Trail.
// Für den Notfall, wenn etwas „von Hand“ geradegezogen werden muss.
import { bad, notFound, id, now, iso } from '../kernel/util.js';

// Diese Collections enthalten Geheimnisse bzw. Technik — nur lesbar, nicht editierbar:
const PROTECTED = new Set(['sessions', 'usedCodes']);

export default {
  name: 'dbadmin',
  title: 'Datenbank-Pflege',
  version: '1.0.0',
  description: 'Alle Collections einsehen, Datensätze manuell korrigieren — mit Audit-Trail.',

  routes({ get, put, post, del }, { db, bus, feed }) {
    get('/api/db/collections', async () => {
      return db.collections().sort().map((c) => ({
        name: c, count: db.count(c), protected: PROTECTED.has(c),
      }));
    }, { roles: ['management'] });

    get('/api/db/col/:col', async (ctx) => {
      const col = ctx.params.col;
      const q = (ctx.query.get('q') || '').toLowerCase();
      const offset = Number(ctx.query.get('offset') || 0);
      const limit = Math.min(Number(ctx.query.get('limit') || 50), 200);
      let list = db.all(col);
      if (q) list = list.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
      const total = list.length;
      list = list.slice(offset, offset + limit);
      if (col === 'people') list = list.map(({ pin, ...r }) => ({ ...r, pin: pin ? '〈gesetzt〉' : null }));
      if (col === 'sessions') list = list.map((s) => ({ ...s, id: s.id.slice(0, 8) + '…' }));
      return { col, total, offset, limit, rows: list };
    }, { roles: ['management'] });

    get('/api/db/col/:col/:id', async (ctx) => {
      const rec = db.get(ctx.params.col, ctx.params.id) || notFound('Datensatz nicht gefunden');
      if (ctx.params.col === 'people') { const { pin, ...r } = rec; return { ...r, pin: pin ? '〈gesetzt〉' : null }; }
      return rec;
    }, { roles: ['management'] });

    put('/api/db/col/:col/:id', async (ctx) => {
      const { col, id: rid } = ctx.params;
      if (PROTECTED.has(col)) bad(`Collection „${col}“ ist geschützt`);
      const before = db.get(col, rid);
      let value = ctx.body?.value;
      if (value === undefined) bad('Body braucht { value: {...} }');
      if (typeof value !== 'object' || value === null || Array.isArray(value)) bad('Datensatz muss ein Objekt sein');
      // PIN-Hash bewahren, wenn der Platzhalter zurückkommt
      if (col === 'people' && before && (value.pin === '〈gesetzt〉' || value.pin === undefined)) {
        value = { ...value, pin: before.pin };
      }
      db.put(col, rid, value);
      db.put('audit', id('au'), {
        id: id('au'), t: now(), at: iso(), byName: ctx.person.name, byPersonId: ctx.person.id,
        action: before ? 'bearbeitet' : 'angelegt', col, recordId: rid,
        before: col === 'people' && before ? { ...before, pin: undefined } : before,
      });
      feed(`🛠️ DB-Pflege: ${before ? 'Datensatz bearbeitet' : 'Datensatz angelegt'} in „${col}“ (${ctx.person.name})`, { kind: 'system' });
      bus.publish('db.changed', { col, id: rid });
      notifyDomain(bus, col);
      return { ok: true };
    }, { roles: ['management'] });

    del('/api/db/col/:col/:id', async (ctx) => {
      const { col, id: rid } = ctx.params;
      if (PROTECTED.has(col)) bad(`Collection „${col}“ ist geschützt`);
      const before = db.get(col, rid) || notFound('Datensatz nicht gefunden');
      db.del(col, rid);
      db.put('audit', id('au'), {
        id: id('au'), t: now(), at: iso(), byName: ctx.person.name, byPersonId: ctx.person.id,
        action: 'gelöscht', col, recordId: rid,
        before: col === 'people' ? { ...before, pin: undefined } : before,
      });
      feed(`🗑️ DB-Pflege: Datensatz aus „${col}“ gelöscht (${ctx.person.name})`, { kind: 'system', level: 'warn' });
      bus.publish('db.changed', { col, id: rid });
      notifyDomain(bus, col);
      return { ok: true };
    }, { roles: ['management'] });

    // Letzte manuelle Änderung rückgängig machen (aus dem Audit-Trail)
    post('/api/db/undo', async (ctx) => {
      const last = db.all('audit').sort((a, b) => b.t - a.t).find((a) => !a.undone && a.before !== undefined);
      if (!last) bad('Nichts zum Rückgängigmachen vorhanden');
      if (last.before) db.put(last.col, last.recordId, last.before);
      else db.del(last.col, last.recordId);
      db.patch('audit', last.id, { undone: true, undoneAt: iso(), undoneBy: ctx.person.name });
      bus.publish('db.changed', { col: last.col, id: last.recordId });
      notifyDomain(bus, last.col);
      return { ok: true, rueckgaengig: { col: last.col, id: last.recordId, action: last.action } };
    }, { roles: ['management'] });

    get('/api/db/audit', async (ctx) => {
      const limit = Math.min(Number(ctx.query.get('limit') || 50), 200);
      return db.all('audit').sort((a, b) => b.t - a.t).slice(0, limit);
    }, { roles: ['management'] });

    // Konsistenz-Prüfung über die Fachdaten
    get('/api/db/validate', async () => {
      const issues = [];
      for (const pos of db.all('positions')) {
        if (!db.get('mazes', pos.mazeId)) issues.push(`Position ${pos.code}: Maze ${pos.mazeId} fehlt`);
        if (pos.assignedPersonId && !db.get('people', pos.assignedPersonId)) {
          issues.push(`Position ${pos.code}: zugeteilte Person ${pos.assignedPersonId} fehlt`);
        }
      }
      for (const m of db.all('mazes')) {
        if (m.leadPersonId && !db.get('people', m.leadPersonId)) issues.push(`Maze ${m.name}: Lead fehlt im Personenstamm`);
      }
      for (const w of db.all('wallets')) {
        if (!db.get('people', w.personId)) issues.push(`Wallet ohne Person: ${w.personId}`);
        if (w.drinks.used > w.drinks.total || w.meals.used > w.meals.total) {
          issues.push(`Wallet ${db.get('people', w.personId)?.name || w.personId}: mehr eingelöst als zugeteilt`);
        }
      }
      const codes = {};
      for (const p of db.all('people')) {
        if (p.status === 'archiviert') continue;
        if (codes[p.code]) issues.push(`Personal-Code ${p.code} doppelt: ${codes[p.code]} und ${p.name}`);
        codes[p.code] = p.name;
      }
      return { ok: issues.length === 0, issues };
    }, { roles: ['management'] });
  },
};

// Damit Live-Ansichten nach Hand-Korrekturen sofort nachziehen
function notifyDomain(bus, col) {
  if (col === 'people') bus.publish('people.changed', {});
  if (col === 'mazes' || col === 'positions') bus.publish('maze.changed', {});
  if (col === 'breaks') bus.publish('break.changed', {});
  if (col === 'incidents') bus.publish('incident.changed', {});
  if (col === 'wallets' || col === 'stations') bus.publish('catering.wallet', {});
  if (col.startsWith('carpool')) bus.publish('carpool.changed', {});
}
