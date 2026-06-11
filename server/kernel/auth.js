// Horrorgeticon Ops — Sitzungen & Rollen
// Rollen: management · lead · actor · springer · catering
// Eine Person kann mehrere Rollen haben; „management“ darf alles.
import { token, now, ApiError } from './util.js';

const SESSION_TTL = 1000 * 60 * 60 * 18; // 18 h — eine Eventnacht + Puffer

export const ROLES = ['management', 'lead', 'actor', 'springer', 'catering'];

export class Auth {
  constructor(db) { this.db = db; }

  createSession(person, role) {
    const t = token();
    this.db.put('sessions', t, {
      id: t, personId: person.id, role,
      roles: person.roles, exp: now() + SESSION_TTL, created: now(),
    });
    return t;
  }

  resolve(req) {
    const url = new URL(req.url, 'http://x');
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const t = bearer || url.searchParams.get('token');
    if (!t) return null;
    const s = this.db.get('sessions', t);
    if (!s) return null;
    if (s.exp < now()) { this.db.del('sessions', t); return null; }
    const person = this.db.get('people', s.personId);
    if (!person || person.status === 'archiviert') return null;
    return { session: s, person };
  }

  drop(t) { this.db.del('sessions', t); }

  // Wirft, wenn die aktive Rolle nicht reicht. management übersteuert alles.
  requireRole(ctx, roles) {
    if (!ctx?.person) throw new ApiError(401, 'Bitte anmelden');
    if (!roles || roles.length === 0) return;
    const have = new Set([ctx.session.role, ...(ctx.person.roles || [])]);
    if (have.has('management')) return;
    if (!roles.some((r) => have.has(r))) {
      throw new ApiError(403, 'Keine Berechtigung für diese Aktion');
    }
  }

  cleanup() {
    const t = now();
    for (const s of this.db.all('sessions')) {
      if (s.exp < t) this.db.del('sessions', s.id);
    }
  }
}
