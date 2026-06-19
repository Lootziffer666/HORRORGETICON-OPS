// Modul: Teilnehmerverwaltung (Pitch „Minimalpaket“ Teil 1)
// Stammdaten, Status, Suche/Filter, Saison-Historie, Verknüpfungscodes,
// Zusammenführen selbst angelegter Profile mit Verwaltungs-Datensätzen.
import { ApiError, bad, need, notFound, id, iso, hashPin, shortCode, pick } from '../kernel/util.js';
import { ROLES } from '../kernel/auth.js';

export const STATUS = ['aktiv', 'angefragt', 'ausgeschieden', 'archiviert'];
const EDITABLE = ['name', 'kontakt', 'telefon', 'ort', 'notizen', 'roles', 'status', 'season',
  'notfallKontakt', 'kostuem', 'essenswunsch', 'code'];

function publicPerson(p) { const { pin, ...rest } = p; return rest; }

export default {
  name: 'people',
  title: 'Teilnehmerverwaltung',
  version: '1.0.0',
  core: true,
  description: 'Personen anlegen, pflegen, archivieren; Verknüpfung mit selbst erstellten Profilen.',

  routes({ get, post, patch, del }, { db, bus, feed }) {
    get('/api/people', async (ctx) => {
      const q = (ctx.query.get('q') || '').toLowerCase();
      const status = ctx.query.get('status');
      const role = ctx.query.get('role');
      let list = db.all('people');
      if (status) list = list.filter((p) => p.status === status);
      else list = list.filter((p) => p.status !== 'archiviert');
      if (role) list = list.filter((p) => p.roles?.includes(role));
      if (q) list = list.filter((p) =>
        [p.name, p.code, p.ort, p.kontakt, p.notizen].some((v) => v && v.toLowerCase().includes(q)));
      return list.map(publicPerson).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    }, { roles: ['management', 'lead', 'catering'] });

    get('/api/people/:id', async (ctx) => {
      const p = db.get('people', ctx.params.id) || notFound('Person nicht gefunden');
      const positions = db.find('positions', (x) => x.assignedPersonId === p.id);
      const linkCode = db.one('linkCodes', (l) => l.personId === p.id && !l.usedAt);
      return { ...publicPerson(p), positions, openLinkCode: linkCode?.code || null };
    }, { roles: ['management', 'lead'] });

    post('/api/people', async (ctx) => {
      const name = need(ctx.body, 'name').slice(0, 100);
      // Validate roles
      const rawRoles = Array.isArray(ctx.body.roles) && ctx.body.roles.length ? ctx.body.roles : ['actor'];
      const roles = rawRoles.filter((r) => ROLES.includes(r));
      if (!roles.length) bad('Mindestens eine gültige Rolle erforderlich');
      // Validate code
      let code = (ctx.body.code || autoCode(db, name)).toUpperCase().slice(0, 20);
      if (ctx.body.code && !/^[A-Z0-9\-]+$/.test(code)) bad('Personal-Code darf nur Buchstaben, Ziffern und Bindestriche enthalten');
      const p = {
        id: id('p'),
        code,
        name,
        roles,
        status: STATUS.includes(ctx.body.status) ? ctx.body.status : 'aktiv',
        kontakt: (ctx.body.kontakt || '').slice(0, 200), telefon: (ctx.body.telefon || '').slice(0, 50),
        ort: (ctx.body.ort || '').slice(0, 100),
        notizen: (ctx.body.notizen || '').slice(0, 2000), season: ctx.body.season || String(new Date().getFullYear()),
        selfCreated: false, linked: false,
        pin: ctx.body.pin ? hashPin(ctx.body.pin) : null,
        createdAt: iso(), createdBy: ctx.person.name,
      };
      if (db.one('people', (x) => x.code === p.code)) bad(`Personal-Code ${p.code} ist schon vergeben`);
      db.put('people', p.id, p);
      bus.publish('people.changed', { id: p.id });
      return publicPerson(p);
    }, { roles: ['management'] });

    patch('/api/people/:id', async (ctx) => {
      const p = db.get('people', ctx.params.id) || notFound('Person nicht gefunden');
      const upd = pick(ctx.body, EDITABLE);
      if (upd.name !== undefined) upd.name = String(upd.name).trim().slice(0, 100);
      if (upd.status && !STATUS.includes(upd.status)) bad('Unbekannter Status');
      if (upd.roles !== undefined) {
        if (!Array.isArray(upd.roles)) bad('Rollen müssen ein Array sein');
        upd.roles = upd.roles.filter((r) => ROLES.includes(r));
        if (!upd.roles.length) bad('Mindestens eine gültige Rolle erforderlich');
      }
      if (upd.code) {
        upd.code = upd.code.toUpperCase().slice(0, 20);
        if (!/^[A-Z0-9\-]+$/.test(upd.code)) bad('Personal-Code darf nur Buchstaben, Ziffern und Bindestriche enthalten');
        if (db.one('people', (x) => x.code === upd.code && x.id !== p.id)) bad(`Personal-Code ${upd.code} ist schon vergeben`);
      }
      if (upd.ort !== undefined) upd.ort = String(upd.ort).slice(0, 100);
      if (upd.notizen !== undefined) upd.notizen = String(upd.notizen).slice(0, 2000);
      if (upd.kontakt !== undefined) upd.kontakt = String(upd.kontakt).slice(0, 200);
      if (upd.telefon !== undefined) upd.telefon = String(upd.telefon).slice(0, 50);
      if (ctx.body.neuePin) upd.pin = hashPin(ctx.body.neuePin);
      const next = db.put('people', p.id, { ...p, ...upd, updatedAt: iso(), updatedBy: ctx.person.name });
      // Ausgeschiedene/archivierte Personen von Positionen lösen
      if (upd.status && upd.status !== 'aktiv') {
        for (const pos of db.find('positions', (x) => x.assignedPersonId === p.id)) {
          db.patch('positions', pos.id, { assignedPersonId: null });
          bus.publish('maze.changed', { positionId: pos.id });
        }
      }
      bus.publish('people.changed', { id: p.id });
      return publicPerson(next);
    }, { roles: ['management'] });

    del('/api/people/:id', async (ctx) => {
      const p = db.get('people', ctx.params.id) || notFound('Person nicht gefunden');
      db.patch('people', p.id, { status: 'archiviert', archivedAt: iso(), archivedBy: ctx.person.name });
      for (const pos of db.find('positions', (x) => x.assignedPersonId === p.id)) {
        db.patch('positions', pos.id, { assignedPersonId: null });
      }
      feed(`🗄️ ${p.name} wurde archiviert.`, { kind: 'person', level: 'info', by: ctx.person.name });
      bus.publish('people.changed', { id: p.id });
      return { ok: true, archiviert: p.id };
    }, { roles: ['management'] });

    // Verknüpfungscode erzeugen — wird der Person übergeben (Zettel, Nachricht …)
    post('/api/people/:id/linkcode', async (ctx) => {
      const p = db.get('people', ctx.params.id) || notFound('Person nicht gefunden');
      if (p.selfCreated) bad('Für selbst angelegte Profile wird kein Code erzeugt — bitte zusammenführen.');
      // alte, unbenutzte Codes der Person entwerten
      for (const l of db.find('linkCodes', (l) => l.personId === p.id && !l.usedAt)) {
        db.patch('linkCodes', l.id, { usedAt: iso(), usedBy: 'ersetzt' });
      }
      const lc = { id: id('lc'), code: `${shortCode(4)}-${shortCode(4)}`, personId: p.id, createdAt: iso(), createdBy: ctx.person.name, usedAt: null };
      db.put('linkCodes', lc.id, lc);
      return { code: lc.code, person: p.name };
    }, { roles: ['management'] });

    // Selbst angelegtes Profil (Quelle) in Verwaltungs-Datensatz (Ziel) zusammenführen
    post('/api/people/:id/merge', async (ctx) => {
      const target = db.get('people', ctx.params.id) || notFound('Ziel-Datensatz nicht gefunden');
      const source = db.get('people', need(ctx.body, 'sourceId')) || notFound('Quell-Profil nicht gefunden');
      if (!source.selfCreated) bad('Quelle ist kein selbst angelegtes Profil');
      if (target.selfCreated) bad('Ziel muss der Verwaltungs-Datensatz sein');
      const merged = {
        ...target,
        pin: source.pin || target.pin,
        kontakt: target.kontakt || source.kontakt, telefon: target.telefon || source.telefon,
        ort: target.ort || source.ort,
        linked: true, linkedAt: iso(), linkedFrom: source.id,
        status: target.status === 'angefragt' ? 'aktiv' : target.status,
      };
      db.put('people', target.id, merged);
      for (const s of db.find('sessions', (s) => s.personId === source.id)) {
        db.patch('sessions', s.id, { personId: target.id, roles: merged.roles });
      }
      db.del('people', source.id);
      feed(`🔗 Profil von ${merged.name} mit der Verwaltung verknüpft (durch ${ctx.person.name}).`, { kind: 'person', level: 'info' });
      bus.publish('people.changed', { id: target.id });
      return publicPerson(merged);
    }, { roles: ['management'] });

    // Unverknüpfte Selbst-Profile + Verwaltungs-Datensätze ohne Konto (für die Verknüpfen-Ansicht)
    get('/api/people/link/overview', async () => ({
      selfProfiles: db.find('people', (p) => p.selfCreated && p.status !== 'archiviert').map(publicPerson),
      unlinked: db.find('people', (p) => !p.selfCreated && !p.linked && !p.pin && p.status !== 'archiviert').map(publicPerson),
      openCodes: db.find('linkCodes', (l) => !l.usedAt).map((l) => ({
        code: l.code, person: db.get('people', l.personId)?.name || '?', createdAt: l.createdAt,
      })),
    }), { roles: ['management'] });
  },
};

function autoCode(db, name) {
  const ini = name.split(/\s+/).map((w) => w[0] || 'X').join('').slice(0, 2).toUpperCase().padEnd(2, 'X');
  for (let i = 0; i < 50; i++) {
    const code = `${ini}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
    if (!db.one('people', (x) => x.code === code)) return code;
  }
  return `${ini}-${Date.now() % 100000}`;
}
