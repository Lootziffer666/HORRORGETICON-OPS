// Horrorgeticon Ops — Event-Bus + SSE-Hub (Live-Feed, Tracking, Chat, Alarme)
import { now, id } from './util.js';

export class Bus {
  constructor() {
    this.clients = new Map(); // clientId → { res, session, person }
    this.listeners = [];      // serverinterne Abonnenten
  }

  // serverintern
  on(fn) { this.listeners.push(fn); }

  /**
   * Sendet ein Ereignis an SSE-Clients.
   * @param {string} type   z. B. 'presence.changed'
   * @param {object} data
   * @param {object} [opt]  { audience: (client) => boolean }  — Filter (z. B. DMs)
   */
  publish(type, data, opt = {}) {
    const evt = { id: id('e'), type, t: now(), data };
    for (const fn of this.listeners) { try { fn(evt); } catch { /* Zuhörer dürfen den Bus nie reißen */ } }
    const payload = `id: ${evt.id}\nevent: ops\ndata: ${JSON.stringify(evt)}\n\n`;
    for (const [cid, c] of this.clients) {
      if (opt.audience && !safeAudience(opt.audience, c)) continue;
      try { c.res.write(payload); } catch { this.drop(cid); }
    }
    return evt;
  }

  attach(req, res, ctx) {
    const cid = id('c');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 3000\n\n`);
    const client = { res, session: ctx.session, person: ctx.person, since: now() };
    this.clients.set(cid, client);
    const ping = setInterval(() => {
      try { res.write(`: ping ${Date.now()}\n\n`); } catch { this.drop(cid); }
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
}

function safeAudience(fn, client) {
  try { return !!fn(client); } catch { return false; }
}
