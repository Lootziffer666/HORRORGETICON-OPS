// Horrorgeticon Ops — Kern-Utilities (keine Abhängigkeiten)
import crypto from 'node:crypto';

export const now = () => Date.now();
export const iso = (t = Date.now()) => new Date(t).toISOString();

let lastId = 0;
export function id(prefix = '') {
  // sortierbar + kollisionsfrei: Zeit (ms, base36) + Zähler + Zufall
  const t = Date.now();
  lastId = (lastId + 1) % 1296;
  const rnd = crypto.randomBytes(3).toString('hex');
  return `${prefix}${t.toString(36)}${lastId.toString(36).padStart(2, '0')}${rnd}`;
}

const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne I/O/0/1 — vorlesbar
export function shortCode(len = 4, bytes = crypto.randomBytes(len)) {
  let s = '';
  for (let i = 0; i < len; i++) s += B32[bytes[i] % 32];
  return s;
}

export function hmacCode(secret, msg, len = 8) {
  const h = crypto.createHmac('sha256', String(secret)).update(String(msg)).digest();
  return shortCode(len, h);
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// PIN-Hashing (scrypt) — synchron ist hier ok (Login ist selten)
export function hashPin(pin, salt = crypto.randomBytes(12).toString('hex')) {
  const dk = crypto.scryptSync(String(pin), salt, 24).toString('hex');
  return `${salt}:${dk}`;
}
export function verifyPin(pin, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, dk] = stored.split(':');
  const test = crypto.scryptSync(String(pin), salt, 24).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(dk, 'hex'), Buffer.from(test, 'hex'));
}

export const token = () => crypto.randomBytes(24).toString('base64url');

export function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

// Eingabe-Validierung: wirft ApiError(400) mit deutscher Meldung
export class ApiError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
export const bad = (msg, extra) => { throw new ApiError(400, msg, extra); };
export const notFound = (msg = 'Nicht gefunden') => { throw new ApiError(404, msg); };
export const forbidden = (msg = 'Keine Berechtigung') => { throw new ApiError(403, msg); };

export function need(obj, field, type = 'string') {
  const v = obj?.[field];
  if (v === undefined || v === null || (type === 'string' && String(v).trim() === '')) {
    bad(`Feld „${field}“ fehlt`);
  }
  if (type === 'number' && typeof v !== 'number') bad(`Feld „${field}“ muss eine Zahl sein`);
  return type === 'string' ? String(v).trim() : v;
}

export const hhmm = (t = Date.now()) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function debounce(fn, ms) {
  let h = null;
  return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); };
}
