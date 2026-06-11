// Horrorgeticon Ops — Modul-Kernel
// Jedes Fachmodul (server/modules/*.mod.js) registriert Routen über diesen Kernel.
// Der Kernel kapselt jeden Handler:
//   · Fehler werden gezählt (Circuit-Breaker) — ab Schwelle wird das Modul automatisch
//     deaktiviert, der Rest der Plattform läuft weiter („praktisch unkaputtbar“).
//   · Module lassen sich zur Laufzeit deaktivieren, reaktivieren und neu laden
//     (Hot-Swap: Datei austauschen → „Neu laden“ — ohne Server-Neustart).
// Die Modul-Verwaltung selbst ist KEIN Modul, damit sie immer erreichbar bleibt.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ApiError, now, iso, hhmm, id } from './util.js';

const BREAKER_MAX_ERRORS = 5;        // Fehler …
const BREAKER_WINDOW_MS = 5 * 60e3;  // … innerhalb von 5 Minuten → Auto-Aus

export class Kernel {
  constructor({ db, bus, auth, router, log = console }) {
    this.db = db; this.bus = bus; this.auth = auth; this.router = router; this.log = log;
    this.modules = new Map(); // name → { def, dir, file, errors:[ts], routes:[…] }
    this.startedAt = now();
  }

  // ───────── Modul-Lebenszyklus ─────────
  async loadAll(dir) {
    this.modulesDir = dir;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mod.js')).sort();
    for (const f of files) await this.loadModule(path.join(dir, f));
  }

  async loadModule(file) {
    const url = pathToFileURL(file).href + '?v=' + Date.now(); // Cache-Bust für Hot-Reload
    let def;
    try {
      const m = await import(url);
      def = m.default;
      if (!def?.name) throw new Error('Modul exportiert kein { name, … }');
    } catch (e) {
      const name = path.basename(file).replace('.mod.js', '');
      this.log.error(`[kernel] Modul ${name} lässt sich nicht laden: ${e.message}`);
      this._setPersisted(name, { lastError: `Ladefehler: ${e.message}`, broken: true });
      this.feed(`⚠️ Modul „${name}“ konnte nicht geladen werden und bleibt aus.`, { kind: 'modul', level: 'err' });
      return null;
    }

    // Alte Routen des Moduls entfernen (bei Reload)
    this.router.routes = this.router.routes.filter((r) => r.meta.module !== def.name);

    const entry = { def, file, errors: [], loadedAt: now() };
    this.modules.set(def.name, entry);

    const persisted = this.db.get('modules', def.name) || {};
    this._setPersisted(def.name, {
      name: def.name, title: def.title || def.name, version: def.version || '1.0.0',
      enabled: persisted.enabled !== false, // standardmäßig an, gemerkter Aus-Zustand bleibt
      core: !!def.core,
      errorCount: 0, lastError: persisted.lastError || null, broken: false,
      loadedAt: iso(), description: def.description || '',
    });

    const ctx = this.moduleCtx(def.name);
    try { await def.init?.(ctx); } catch (e) { this._recordError(def.name, e, 'init'); }

    const reg = (method) => (pattern, handler, opt = {}) => {
      this.router.add(method, pattern, this._wrap(def.name, handler, opt), { module: def.name, ...opt });
    };
    try {
      def.routes?.({ get: reg('GET'), post: reg('POST'), patch: reg('PATCH'), put: reg('PUT'), del: reg('DELETE') }, ctx);
    } catch (e) { this._recordError(def.name, e, 'routes'); }
    return def.name;
  }

  moduleCtx(name) {
    return {
      db: this.db, bus: this.bus, auth: this.auth, log: this.log, kernel: this,
      feed: (text, meta) => this.feed(text, { module: name, ...meta }),
    };
  }

  // Live-Feed: zentraler Ereignisstrom (sichtbar in der App)
  feed(text, meta = {}) {
    const item = {
      id: id('f'), t: now(), time: hhmm(), text,
      kind: meta.kind || 'system', level: meta.level || 'info',
      scope: meta.scope || 'all', by: meta.by || 'System', module: meta.module || null,
      mazeId: meta.mazeId || null,
    };
    this.db.put('feed', item.id, item);
    this.bus.publish('feed.item', item);
    return item;
  }

  _wrap(name, handler, opt) {
    return async (ctx) => {
      const st = this.db.get('modules', name);
      if (st && st.enabled === false) {
        throw new ApiError(503, `Modul „${st.title || name}“ ist derzeit deaktiviert`, { module: name, moduleDisabled: true });
      }
      if (opt.roles) this.auth.requireRole(ctx, opt.roles);
      try {
        return await handler(ctx);
      } catch (e) {
        if (e instanceof ApiError) throw e; // fachliche Fehler zählen nicht als Modulfehler
        this._recordError(name, e, ctx.url?.pathname);
        throw e;
      }
    };
  }

  _recordError(name, e, where = '') {
    const entry = this.modules.get(name);
    this.log.error(`[modul:${name}] Fehler bei ${where}: ${e.stack || e.message}`);
    const t = now();
    if (entry) {
      entry.errors = entry.errors.filter((x) => t - x < BREAKER_WINDOW_MS);
      entry.errors.push(t);
    }
    const errs = entry ? entry.errors.length : BREAKER_MAX_ERRORS;
    this._setPersisted(name, { errorCount: errs, lastError: `${iso()} · ${where}: ${e.message}` });
    if (errs >= BREAKER_MAX_ERRORS) {
      this.disable(name, `automatisch nach ${errs} Fehlern in 5 min`);
    } else {
      this.bus.publish('module.changed', this.db.get('modules', name));
    }
  }

  _setPersisted(name, partial) {
    const cur = this.db.get('modules', name) || { name };
    this.db.put('modules', name, { ...cur, ...partial });
  }

  disable(name, reason = 'manuell') {
    this._setPersisted(name, { enabled: false, disabledReason: reason, disabledAt: iso() });
    this.feed(`🔌 Modul „${name}“ deaktiviert (${reason}). Übrige Module laufen weiter.`, { kind: 'modul', level: 'warn' });
    this.bus.publish('module.changed', this.db.get('modules', name));
  }

  enable(name) {
    const entry = this.modules.get(name);
    if (entry) entry.errors = [];
    this._setPersisted(name, { enabled: true, errorCount: 0, disabledReason: null });
    this.feed(`✅ Modul „${name}“ wieder aktiviert.`, { kind: 'modul', level: 'info' });
    this.bus.publish('module.changed', this.db.get('modules', name));
  }

  async reload(name) {
    const entry = this.modules.get(name);
    const file = entry?.file || path.join(this.modulesDir, `${name}.mod.js`);
    if (!fs.existsSync(file)) throw new ApiError(404, `Moduldatei ${path.basename(file)} fehlt`);
    const loaded = await this.loadModule(file);
    if (!loaded) throw new ApiError(500, `Modul „${name}“ ließ sich nicht laden — alte Version bleibt deaktiviert`);
    this.feed(`♻️ Modul „${name}“ neu geladen (Hot-Swap).`, { kind: 'modul', level: 'info' });
    this.bus.publish('module.changed', this.db.get('modules', name));
    return loaded;
  }

  status() {
    return this.db.all('modules').map((m) => ({
      ...m,
      health: m.broken ? 'defekt' : m.enabled === false ? 'deaktiviert' : (m.errorCount > 0 ? 'angeschlagen' : 'ok'),
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  // ───────── Kernel-eigene Verwaltungs-Routen (immer verfügbar) ─────────
  registerAdminRoutes() {
    const guard = (ctx) => this.auth.requireRole(ctx, ['management']);
    this.router.add('GET', '/api/modules', async (ctx) => { guard(ctx); return this.status(); }, { module: '_kernel' });
    this.router.add('POST', '/api/modules/:name/disable', async (ctx) => {
      guard(ctx); this.disable(ctx.params.name, `manuell durch ${ctx.person.name}`); return this.db.get('modules', ctx.params.name);
    }, { module: '_kernel' });
    this.router.add('POST', '/api/modules/:name/enable', async (ctx) => {
      guard(ctx); this.enable(ctx.params.name); return this.db.get('modules', ctx.params.name);
    }, { module: '_kernel' });
    this.router.add('POST', '/api/modules/:name/reload', async (ctx) => {
      guard(ctx); await this.reload(ctx.params.name); return this.db.get('modules', ctx.params.name);
    }, { module: '_kernel' });
    this.router.add('GET', '/api/health', async () => ({
      ok: true, uptimeSec: Math.round((now() - this.startedAt) / 1000),
      online: this.bus.online(), db: this.db.integrity(),
      modules: this.status().map((m) => ({ name: m.name, health: m.health })),
    }), { module: '_kernel' });
  }
}
