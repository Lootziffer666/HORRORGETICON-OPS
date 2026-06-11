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
import { Router, parseBody, sendJson, sendText, serveStatic } from './kernel/http.js';
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

// SSE-Stream (Kernel-eigen, läuft auch wenn Module straucheln)
router.add('GET', '/api/stream', async (ctx) => {
  bus.attach(ctx.req, ctx.res, ctx);
  return Symbol.for('handled'); // Verbindung bleibt offen
}, { module: '_kernel' });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const m = router.match(req.method, url.pathname);
      if (!m) throw new ApiError(404, `Unbekannter Endpunkt ${req.method} ${url.pathname}`);
      const authCtx = auth.resolve(req);
      const openRoutes = new Set(['/api/auth/login', '/api/auth/register', '/api/health', '/api/auth/orte']);
      if (!authCtx && !openRoutes.has(url.pathname)) throw new ApiError(401, 'Bitte anmelden');
      const ctx = {
        req, res, url, params: m.params, query: url.searchParams,
        session: authCtx?.session || null, person: authCtx?.person || null,
        body: (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') ? await parseBody(req) : {},
      };
      const out = await m.route.handler(ctx);
      if (out === Symbol.for('handled')) return; // z. B. SSE oder eigener Download
      sendJson(res, 200, out ?? { ok: true });
      return;
    }
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

// Geordneter Stopp: letzter Snapshot, dann Ende
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[shutdown] ${sig} — letzter Snapshot …`);
    try { db.snapshot('shutdown'); } catch (e) { console.error(e.message); }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
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
