// Modul: Anmeldung & Konto
// · Login mit Personal-Code + PIN (Mockup: Login-Screen)
// · Selbstregistrierung als Scare Actor (eigenes Profil anlegen)
// · Verknüpfung des eigenen Profils mit dem Verwaltungs-Datensatz per Code
//   → erst danach zählt das Live-Tracking auf den richtigen Datensatz.
import { ApiError, bad, need, hashPin, verifyPin, id, now, iso, pick } from '../kernel/util.js';
import { DEFAULT_ORTE } from '../kernel/geo.js';

function publicPerson(p) {
  if (!p) return null;
  const { pin, ...rest } = p;
  return rest;
}

function nextCode(db, name) {
  const ini = name.split(/\s+/).map((w) => w[0] || 'X').join('').slice(0, 2).toUpperCase().padEnd(2, 'X');
  for (let i = 0; i < 50; i++) {
    const num = String(Math.floor(Math.random() * 9000) + 1000);
    const code = `${ini}-${num}`;
    if (!db.one('people', (x) => x.code === code)) return code;
  }
  return `${ini}-${Date.now() % 100000}`;
}

export default {
  name: 'auth',
  title: 'Anmeldung & Konto',
  version: '1.0.0',
  core: true,
  description: 'Login per Personal-Code + PIN, Selbstregistrierung, Profil-Verknüpfung.',

  routes({ get, post }, { db, bus, auth, feed }) {
    post('/api/auth/login', async (ctx) => {
      const code = need(ctx.body, 'code').toUpperCase();
      const pin = need(ctx.body, 'pin');
      const person = db.one('people', (p) => p.code?.toUpperCase() === code && p.status !== 'archiviert');
      if (!person || !person.pin || !verifyPin(pin, person.pin)) {
        throw new ApiError(401, 'Code oder PIN stimmt nicht. Bei Problemen: Crew-Büro kontaktieren.');
      }
      if (person.status === 'ausgeschieden') throw new ApiError(403, 'Dieser Zugang ist nicht mehr aktiv.');
      const role = (ctx.body.role && person.roles.includes(ctx.body.role)) ? ctx.body.role : person.roles[0];
      const token = auth.createSession(person, role);
      return { token, person: publicPerson(person), role, roles: person.roles };
    });

    post('/api/auth/role', async (ctx) => {
      const role = need(ctx.body, 'role');
      if (!ctx.person.roles.includes(role) && !ctx.person.roles.includes('management')) {
        bad('Diese Rolle ist dir nicht zugeteilt');
      }
      db.patch('sessions', ctx.session.id, { role });
      return { ok: true, role };
    });

    post('/api/auth/logout', async (ctx) => { auth.drop(ctx.session.id); return { ok: true }; });

    get('/api/auth/me', async (ctx) => {
      const fresh = db.get('people', ctx.person.id);
      return { person: publicPerson(fresh), role: ctx.session.role, roles: fresh.roles };
    });

    // Ortsliste für Registrierung/Fahrgruppen (ohne Login abrufbar)
    get('/api/auth/orte', async ({ }) => {
      const custom = db.all('orte');
      const names = new Set(custom.map((o) => o.name));
      return [...custom, ...DEFAULT_ORTE.filter((o) => !names.has(o.name))].map((o) => o.name).sort();
    });

    // Selbstregistrierung: eigenes Scare-Actor-Profil anlegen
    post('/api/auth/register', async (ctx) => {
      const name = need(ctx.body, 'name');
      const pin = need(ctx.body, 'pin');
      if (String(pin).length < 4) bad('PIN braucht mindestens 4 Stellen');
      if (db.one('people', (p) => p.name.toLowerCase() === name.toLowerCase() && p.selfCreated)) {
        bad('Unter diesem Namen existiert bereits ein selbst angelegtes Profil');
      }
      const p = {
        id: id('p'), code: nextCode(db, name), name,
        roles: ['actor'], status: 'angefragt', selfCreated: true, linked: false,
        kontakt: ctx.body.kontakt || '', telefon: ctx.body.telefon || '', ort: ctx.body.ort || '',
        notizen: '', season: new Date().getFullYear().toString(),
        pin: hashPin(pin), createdAt: iso(),
      };
      db.put('people', p.id, p);
      feed(`👤 Neues Profil angelegt: ${p.name} (wartet auf Verknüpfung/Freigabe)`, { kind: 'person', level: 'info' });
      bus.publish('people.changed', { id: p.id });
      const token = auth.createSession(p, 'actor');
      return { token, person: publicPerson(p), role: 'actor', roles: p.roles };
    });

    // Verknüpfen: eingeloggtes (selbst angelegtes) Profil + Verknüpfungscode der Verwaltung
    post('/api/auth/link', async (ctx) => {
      const code = need(ctx.body, 'code').toUpperCase().replace(/\s/g, '');
      const lc = db.one('linkCodes', (l) => l.code === code && !l.usedAt);
      if (!lc) throw new ApiError(404, 'Verknüpfungscode ungültig oder schon benutzt');
      const roster = db.get('people', lc.personId);
      if (!roster) throw new ApiError(404, 'Zugehöriger Verwaltungs-Datensatz fehlt');
      const self = db.get('people', ctx.person.id);

      // Profildaten des selbst angelegten Kontos in den Verwaltungs-Datensatz übernehmen
      const merged = {
        ...roster,
        pin: self.pin,
        kontakt: roster.kontakt || self.kontakt, telefon: roster.telefon || self.telefon,
        ort: roster.ort || self.ort,
        linked: true, linkedAt: iso(), linkedFrom: self.selfCreated ? self.id : null,
        status: roster.status === 'angefragt' ? 'aktiv' : roster.status,
      };
      db.put('people', roster.id, merged);
      db.patch('linkCodes', lc.id, { usedAt: iso(), usedBy: self.id });

      // Selbst angelegtes Duplikat auflösen, Sitzungen umhängen
      if (self.selfCreated && self.id !== roster.id) {
        for (const s of db.find('sessions', (s) => s.personId === self.id)) {
          db.patch('sessions', s.id, { personId: roster.id, roles: merged.roles });
        }
        db.del('people', self.id);
      }
      feed(`🔗 ${merged.name} hat das eigene Profil mit der Verwaltung verknüpft — Tracking läuft jetzt auf dem richtigen Datensatz.`, { kind: 'person', level: 'info' });
      bus.publish('people.changed', { id: roster.id });
      return { person: publicPerson(merged), roles: merged.roles, role: merged.roles[0] };
    });

    post('/api/auth/pin', async (ctx) => {
      const alt = need(ctx.body, 'alt');
      const neu = need(ctx.body, 'neu');
      const p = db.get('people', ctx.person.id);
      if (!verifyPin(alt, p.pin)) throw new ApiError(403, 'Aktuelle PIN stimmt nicht');
      if (String(neu).length < 4) bad('Neue PIN braucht mindestens 4 Stellen');
      db.patch('people', p.id, { pin: hashPin(neu) });
      return { ok: true };
    });

    // Eigenes Profil pflegen (Actor-Sicht)
    post('/api/auth/profile', async (ctx) => {
      const allowed = pick(ctx.body, ['kontakt', 'telefon', 'ort', 'notfallKontakt', 'kostuem', 'essenswunsch']);
      const p = db.patch('people', ctx.person.id, allowed);
      bus.publish('people.changed', { id: p.id });
      return publicPerson(p);
    });
  },
};
