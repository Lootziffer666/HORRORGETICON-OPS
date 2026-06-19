#!/usr/bin/env node
// Horrorgeticon Ops — Server-Bootstrap
//   node server/main.js [--demo] [--port 8787] [--data ./data]
// --demo  lädt das Demo-Szenario der Horrornacht (Mockup-Datenstand), falls DB leer.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DB } from './kernel/db.js';
import { Bus } from './kernel/bus.js';
import { Auth } from './kernel/auth.js';
import { Kernel } from './kernel/kernel.js';
import { Router, RateLimiter, readBody, sendJson, sendText, serveStatic } from './kernel/http.js';
import { ApiError } from './kernel/util.js';
import { seedDemo, ensureBaseline } from './seed/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const PORT = Number(process.env.PORT || opt('port', 8787));
const DATA_DIR = path.resolve(opt('data', process.env.OPS_DATA || path.join(ROOT, 'data')));
const WEB_DIR = path.join(ROOT, 'web');

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DB(DATA_DIR).load();
const bus = new Bus();
const auth = new Auth(db);
const router = new Router();
const kernel = new Kernel({ db, bus, auth, router });

ensureBaseline(db);
if ((flag('demo') || process.env.OPS_DEMO === '1') && db.count('people') === 0) {
  seedDemo(db);
  console.log('[seed] Demo-Szenario „Horrornacht“ geladen.');
}

kernel.registerAdminRoutes();
await kernel.loadAll(path.join(__dirname, 'modules'));

// ─── Rate-Limiter-Instanzen ─────────────────────────────────────────────────
// Auth-Endpunkte: streng (10 pro 5 min) — gegen Brute-Force.
const authLimiter = new RateLimiter({ windowMs: 5 * 60_000, max: 10 });
// Allgemeine API: 500 Requests/Minute/IP — gegen Missbrauch auf dem Event-LAN.
const apiLimiter = new RateLimiter({ windowMs: 60_000, max: 500 });

// Endpunkte mit grossem Body (z.B. CSV-Import): 8 MB erlaubt.
const LARGE_BODY_ROUTES = new Set(['/api/csv/import/personen']);
// Standard-Limit fuer alle anderen API-Bodies: 256 KB.
const DEFAULT_BODY_LIMIT = 256 * 1024;
const LARGE_BODY_LIMIT = 8 * 1024 * 1024;

// Globaler Request-Timeout: 30 Sekunden.
const REQUEST_TIMEOUT_MS = 30_000;

// SSE-Stream (Kernel-eigen, läuft auch wenn Module straucheln)
router.add('GET', '/api/stream', async (ctx) => {
  const cid = bus.attach(ctx.req, ctx.res, ctx);
  if (cid === null) return Symbol.for('handled'); // 503 wurde direkt geschrieben
  return Symbol.for('handled'); // Verbindung bleibt offen
}, { module: '_kernel' });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ip = req.socket.remoteAddress || '0.0.0.0';

  // ─── Security Headers (immer, auch bei Fehlern) ────────────────────────────
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  try {
    if (url.pathname.startsWith('/api/')) {
      // API-spezifische Security-Headers
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");

      // ─── Rate-Limiting ───────────────────────────────────────────────────────
      const isAuthRoute = url.pathname === '/api/auth/login' || url.pathname === '/api/auth/register';
      if (isAuthRoute) {
        if (!authLimiter.allow(ip)) {
          throw new ApiError(429, 'Zu viele Anmeldeversuche — bitte in einigen Minuten erneut versuchen');
        }
      }
      if (!apiLimiter.allow(ip)) {
        throw new ApiError(429, 'Anfragelimit erreicht — bitte kurz warten');
      }

      const m = router.match(req.method, url.pathname);
      if (!m) throw new ApiError(404, `Unbekannter Endpunkt ${req.method} ${url.pathname}`);
      const authCtx = auth.resolve(req);
      const openRoutes = new Set(['/api/auth/login', '/api/auth/register', '/api/health', '/api/auth/orte']);
      if (!authCtx && !openRoutes.has(url.pathname)) throw new ApiError(401, 'Bitte anmelden');

      // ─── Body-Parsing mit konfigurierbarem Limit ─────────────────────────────
      const bodyLimit = LARGE_BODY_ROUTES.has(url.pathname) ? LARGE_BODY_LIMIT : DEFAULT_BODY_LIMIT;
      let body = {};
      if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') {
        const raw = await readBody(req, bodyLimit);
        if (!raw.length) { body = {}; }
        else {
          const ct = (req.headers['content-type'] || '').split(';')[0].trim();
          if (ct === 'application/json' || ct === '') {
            try { body = JSON.parse(raw.toString('utf8')); }
            catch { throw new ApiError(400, 'Ungültiges JSON im Anfrage-Body'); }
          } else if (ct.startsWith('text/')) { body = { text: raw.toString('utf8') }; }
          else { body = { raw }; }
        }
      }

      const ctx = {
        req, res, url, params: m.params, query: url.searchParams,
        session: authCtx?.session || null, person: authCtx?.person || null,
        body,
      };

      // ─── Request-Timeout (30s) ──────────────────────────────────────────────
      const timeoutPromise = new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new ApiError(504, 'Zeitüberschreitung — Anfrage abgebrochen')), REQUEST_TIMEOUT_MS);
        timer.unref?.();
        // Store for cleanup on success
        ctx._timeout = timer;
      });

      let out;
      try {
        out = await Promise.race([m.route.handler(ctx), timeoutPromise]);
      } finally {
        if (ctx._timeout) clearTimeout(ctx._timeout);
      }

      if (out === Symbol.for('handled')) return; // z. B. SSE oder eigener Download
      sendJson(res, 200, out ?? { ok: true });
      return;
    }

    // Static files: allow framing (SAMEORIGIN) for PWA
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'");

    if (serveStatic(res, WEB_DIR, url.pathname)) return;
    // SPA-Fallback: alles Unbekannte → index.html (Hash-Routing im Client)
    serveStatic(res, WEB_DIR, '/index.html') || sendText(res, 404, 'Nicht gefunden');
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    if (status >= 500) console.error('[http]', req.method, url.pathname, e.stack || e);
    if (!res.headersSent) {
      sendJson(res, status, { error: e.message || 'Interner Fehler', ...(e.extra || {}) });
    } else { try { res.end(); } catch { /* Verbindung bereits zu */ } }
  }
});

// Aufräum-Takt: Sitzungen, Präsenz-Verfall (offline-Erkennung)
const tick = setInterval(() => {
  try {
    auth.cleanup();
    bus.publish('tick', { t: Date.now() });
  } catch (e) { console.error('[tick]', e.message); }
}, 30000);
tick.unref?.();

// Stale-Connection-Reaper starten (raeumt Zombie-SSE-Verbindungen auf)
bus.startReaper();

// Geordneter Stopp: SSE drainieren, Snapshot, sauber beenden.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[shutdown] ${sig} — Verbindungen schliessen …`);
    // 1. Reaper stoppen
    bus.stopReaper();
    // 2. Alle SSE-Clients sauber benachrichtigen und trennen
    bus.drainAll();
    // 3. Snapshot sichern
    try { db.snapshot('shutdown'); } catch (e) { console.error(e.message); }
    // 4. Server schliessen und beenden
    server.close(() => process.exit(0));
    // Sicherheitsnetz: nach 3s trotzdem beenden (z.B. bei haengenden Sockets)
    setTimeout(() => process.exit(0), 3000).unref();
    // Offene idle-Verbindungen (keep-alive) sofort zerstoeren, damit server.close() zeitnah feuert.
    server.closeAllConnections?.();
  });
}
process.on('uncaughtException', (e) => {
  // Der Server fällt nicht um: Fehler loggen, Snapshot sichern, weiterlaufen.
  console.error('[uncaught]', e.stack || e);
  try { db.snapshot('nach-uncaught'); } catch { /* best effort */ }
});
process.on('unhandledRejection', (e) => console.error('[unhandled]', e));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Horrorgeticon Ops läuft → http://localhost:${PORT}`);
  console.log(`Daten: ${DATA_DIR}`);
  for (const line of db.bootReport) console.log('[db]', line);
});
