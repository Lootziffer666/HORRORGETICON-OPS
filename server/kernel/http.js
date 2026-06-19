// Horrorgeticon Ops — HTTP-Schicht: Router, Body-Parsing, statische Dateien, Rate-Limiting.
// Jede Route gehört einem Modul; der Kernel entscheidet, ob das Modul gerade läuft.
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from './util.js';

// ─── Rate-Limiter (In-Memory, Sliding Window) ───────────────────────────────
// Keine Abhängigkeiten. Pro IP wird ein Array von Zeitstempeln gehalten.
// cleanup() entfernt abgelaufene Einträge periodisch.
export class RateLimiter {
  /**
   * @param {object} opts
   * @param {number} opts.windowMs  - Fenstergroesse in ms (Standard: 60_000 = 1 min)
   * @param {number} opts.max       - Max. erlaubte Anfragen im Fenster
   * @param {number} [opts.cleanupIntervalMs] - Aufraeum-Intervall (Standard: 60_000)
   */
  constructor({ windowMs = 60_000, max = 100, cleanupIntervalMs = 60_000 } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    /** @type {Map<string, number[]>} */
    this.hits = new Map();
    this._timer = setInterval(() => this._cleanup(), cleanupIntervalMs);
    this._timer.unref?.();
  }

  /**
   * Prueft ob die IP das Limit ueberschritten hat.
   * @param {string} ip
   * @returns {boolean} true wenn erlaubt, false wenn Limit erreicht
   */
  allow(ip) {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    let list = this.hits.get(ip);
    if (!list) { list = []; this.hits.set(ip, list); }
    // Alte Eintraege am Anfang entfernen (Array ist chronologisch sortiert)
    while (list.length > 0 && list[0] <= cutoff) list.shift();
    if (list.length >= this.max) return false;
    list.push(now);
    return true;
  }

  /** Setzt das Limit fuer eine IP zurueck (z.B. nach erfolgreichem Login). */
  reset(ip) { this.hits.delete(ip); }

  _cleanup() {
    const cutoff = Date.now() - this.windowMs;
    for (const [ip, list] of this.hits) {
      while (list.length > 0 && list[0] <= cutoff) list.shift();
      if (list.length === 0) this.hits.delete(ip);
    }
  }

  destroy() { clearInterval(this._timer); }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

export class Router {
  constructor() { this.routes = []; }

  add(method, pattern, handler, meta = {}) {
    const parts = pattern.split('/').filter(Boolean);
    this.routes.push({ method, pattern, parts, handler, meta });
  }

  match(method, pathname) {
    const segs = pathname.split('/').filter(Boolean);
    outer:
    for (const r of this.routes) {
      if (r.method !== method || r.parts.length !== segs.length) continue;
      const params = {};
      for (let i = 0; i < segs.length; i++) {
        const p = r.parts[i];
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]);
        else if (p !== segs[i]) continue outer;
      }
      return { route: r, params };
    }
    return null;
  }
}

export function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = []; let exceeded = false;
    req.on('data', (c) => {
      if (exceeded) return;
      size += c.length;
      if (size > limit) {
        exceeded = true;
        reject(new ApiError(413, 'Anfrage zu groß'));
        // Resume and drain remaining data so the socket stays open for the response
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!exceeded) resolve(Buffer.concat(chunks)); });
    req.on('error', (e) => { if (!exceeded) reject(e); });
  });
}

export async function parseBody(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  const ct = (req.headers['content-type'] || '').split(';')[0].trim();
  if (ct === 'application/json' || ct === '') {
    const str = raw.toString('utf8');
    // Lightweight JSON depth check: count max consecutive opening braces/brackets
    if (jsonDepth(str) > 50) throw new ApiError(400, 'JSON-Verschachtelung zu tief (max. 50 Ebenen)');
    try { return JSON.parse(str); }
    catch { throw new ApiError(400, 'Ungültiges JSON im Anfrage-Body'); }
  }
  if (ct.startsWith('text/')) return { text: raw.toString('utf8') };
  return { raw };
}

/** Lightweight nesting depth check without recursive parsing. */
export function jsonDepth(str) {
  let max = 0, depth = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    if (ch === 123 || ch === 91) { depth++; if (depth > max) max = depth; } // { or [
    else if (ch === 125 || ch === 93) { depth--; } // } or ]
    else if (ch === 34) { // skip strings (may contain braces)
      i++;
      while (i < str.length) {
        if (str.charCodeAt(i) === 92) { i++; } // backslash escape
        else if (str.charCodeAt(i) === 34) break;
        i++;
      }
    }
  }
  return max;
}

export function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

export function sendText(res, status, text, contentType = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store', ...headers });
  res.end(text);
}

export function serveStatic(res, rootDir, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';
  const abs = path.normalize(path.join(rootDir, rel));
  if (!abs.startsWith(path.normalize(rootDir))) { sendText(res, 403, 'Verboten'); return true; }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return false;
  const ext = path.extname(abs).toLowerCase();
  const immutable = ext === '.ttf' || ext === '.woff2' || ext === '.png' || ext === '.webp';
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=604800' : 'no-cache',
  });
  res.end(fs.readFileSync(abs));
  return true;
}
