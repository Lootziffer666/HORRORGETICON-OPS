// Horrorgeticon Ops — Event-Bus + SSE-Hub (Live-Feed, Tracking, Chat, Alarme)
import { now, id } from './util.js';

/** Maximale Anzahl gleichzeitiger SSE-Verbindungen insgesamt (Speicherschutz). */
const MAX_CLIENTS = 200;
/** Maximale Anzahl gleichzeitiger SSE-Verbindungen pro Person. */
const MAX_PER_PERSON = 3;
/** Intervall fuer den Stale-Connection-Reaper (ms). */
const REAP_INTERVAL = 60_000;
/** Verbindung gilt als stale, wenn kein erfolgreicher Write seit X ms (> 3 Ping-Zyklen). */
const STALE_THRESHOLD = 90_000;

export class Bus {
  constructor() {
    this.clients = new Map(); // clientId -> { res, session, person, since, lastWrite }
    this.listeners = [];      // serverinterne Abonnenten
    this._reaper = null;
    this.dndCheck = null;     // (personId) => boolean — gesetzt vom DND-Modul
  }

  /** Registriert die DND-Pruef-Funktion (aufgerufen vom dnd.mod.js). */
  setDndCheck(fn) { this.dndCheck = fn; }

  // serverintern
  on(fn) { this.listeners.push(fn); }

  /**
   * Sendet ein Ereignis an SSE-Clients.
   * @param {string} type   z. B. 'presence.changed'
   * @param {object} data
   * @param {object} [opt]  { audience: (client) => boolean }  -- Filter (z. B. DMs)
   */
  publish(type, data, opt = {}) {
    const evt = { id: id('e'), type, t: now(), data };
    for (const fn of this.listeners) { try { fn(evt); } catch { /* Zuhoerer duerfen den Bus nie reissen */ } }
    const payload = `id: ${evt.id}\nevent: ops\ndata: ${JSON.stringify(evt)}\n\n`;
    const dndTypes = new Set(['announce.new', 'alarm']);
    for (const [cid, c] of this.clients) {
      if (opt.audience && !safeAudience(opt.audience, c)) continue;
      // DND-Filter: nur fuer announce.new und alarm, und nur wenn NICHT notfall
      if (dndTypes.has(type) && data?.level !== 'notfall' && this.dndCheck) {
        const pid = c.person?.id;
        if (pid && safeDndCheck(this.dndCheck, pid)) continue;
      }
      try { c.res.write(payload); c.lastWrite = Date.now(); } catch { this.drop(cid); }
    }
    return evt;
  }

  /**
   * Neue SSE-Verbindung aufbauen. Liefert die Client-ID zurueck.
   * Erzwingt globales Limit (MAX_CLIENTS) und per-Person-Limit (MAX_PER_PERSON).
   */
  attach(req, res, ctx) {
    // --- Globales Limit ---
    if (this.clients.size >= MAX_CLIENTS) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'SSE-Limit erreicht -- bitte spaeter erneut verbinden' }));
      return null;
    }

    // --- Per-Person-Limit: aelteste Verbindungen droppen ---
    const personId = ctx.session?.personId || null;
    if (personId) {
      const personConns = [];
      for (const [cid, c] of this.clients) {
        if (c.session?.personId === personId) personConns.push({ cid, since: c.since });
      }
      // Sortierung: aelteste zuerst
      personConns.sort((a, b) => a.since - b.since);
      while (personConns.length >= MAX_PER_PERSON) {
        const oldest = personConns.shift();
        this.drop(oldest.cid);
      }
    }

    const cid = id('c');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 3000\n\n`);
    const client = { res, session: ctx.session, person: ctx.person, since: now(), lastWrite: Date.now() };
    this.clients.set(cid, client);
    const ping = setInterval(() => {
      try { res.write(`: ping ${Date.now()}\n\n`); client.lastWrite = Date.now(); } catch { this.drop(cid); }
    }, 25000);
    ping.unref?.();
    req.on('close', () => { clearInterval(ping); this.drop(cid); });
    return cid;
  }

  drop(cid) {
    const c = this.clients.get(cid);
    if (c) { try { c.res.end(); } catch { /* schon zu */ } }
    this.clients.delete(cid);
  }

  online() { return this.clients.size; }

  /**
   * Startet den Stale-Connection-Reaper. Prueft regelmaessig alle Verbindungen
   * und raeumt solche auf, deren Socket zerstoert ist oder die laenger als
   * STALE_THRESHOLD keinen erfolgreichen Write hatten.
   */
  startReaper() {
    if (this._reaper) return;
    this._reaper = setInterval(() => {
      const cutoff = Date.now() - STALE_THRESHOLD;
      for (const [cid, c] of this.clients) {
        const socket = c.res.socket || c.res.connection;
        const destroyed = !socket || socket.destroyed;
        const stale = c.lastWrite < cutoff;
        if (destroyed || stale) this.drop(cid);
      }
    }, REAP_INTERVAL);
    this._reaper.unref?.();
  }

  /**
   * Stoppt den Reaper (z.B. beim Shutdown).
   */
  stopReaper() {
    if (this._reaper) { clearInterval(this._reaper); this._reaper = null; }
  }

  /**
   * Graceful Shutdown: sendet ein Shutdown-Event an alle Clients und schliesst sie.
   */
  drainAll() {
    const shutdownPayload = `event: shutdown\ndata: "server-shutdown"\n\n`;
    for (const [cid, c] of this.clients) {
      try { c.res.write(shutdownPayload); } catch { /* egal */ }
      this.drop(cid);
    }
  }
}

function safeAudience(fn, client) {
  try { return !!fn(client); } catch { return false; }
}

function safeDndCheck(fn, personId) {
  try { return !!fn(personId); } catch { return false; }
}
