// Modul: Einstellungen
// Event-Stammdaten (Name, Nacht, Schichtfenster), Event-Phase (Lifecycle),
// Catering-Budgets, Fahrgruppen-Parameter, eigene Orte für das Matching.
import { bad, need, id, now, iso, hhmm } from '../kernel/util.js';

// NOTE: kidsDay is intentionally excluded — all kidsDay writes go through the
// dedicated kidsday module to avoid dual-write conflicts and ensure proper
// validation and SSE publishing on that path.
const EDITABLE = ['eventName', 'nightLabel', 'eventDate', 'active', 'shiftStart', 'shiftEnd', 'catering', 'carpool', 'sla'];

// Event-Lifecycle (horrops_fullstack.md): Vorbereitung → Aufbau → Live → Abschluss
export const PHASES = ['vorbereitung', 'aufbau', 'live', 'abschluss'];
export const PHASE_LABEL = { vorbereitung: 'Vorbereitung', aufbau: 'Aufbau', live: 'Live', abschluss: 'Abschluss' };

export default {
  name: 'settings',
  title: 'Einstellungen',
  version: '1.0.0',
  core: true,
  description: 'Event-Stammdaten, Budgets, Matching-Parameter, eigene Orte.',

  routes({ get, patch, post, del }, { db, bus, feed }) {
    get('/api/settings', async () => {
      const { secret, ...s } = db.get('settings', 'main') || {};
      return s;
    });

    patch('/api/settings', async (ctx) => {
      const cur = db.get('settings', 'main') || { id: 'main' };
      const upd = {};
      for (const k of EDITABLE) if (ctx.body[k] !== undefined) upd[k] = ctx.body[k];
      if (upd.catering) upd.catering = { ...cur.catering, ...upd.catering };
      if (upd.carpool) upd.carpool = { ...cur.carpool, ...upd.carpool };
      const next = db.put('settings', 'main', { ...cur, ...upd });
      feed(`⚙️ Einstellungen aktualisiert (${ctx.person.name}).`, { kind: 'system' });
      bus.publish('settings.changed', { keys: Object.keys(upd) });
      const { secret, ...pub } = next;
      return pub;
    }, { roles: ['management'] });

    get('/api/settings/orte', async () => db.all('orte').sort((a, b) => a.name.localeCompare(b.name, 'de')));

    // Phasenwechsel — bewusst eigener Endpunkt (nicht über PATCH /settings),
    // damit Feed-Eintrag + automatische Durchsage immer mitlaufen.
    post('/api/settings/phase', async (ctx) => {
      const phase = need(ctx.body, 'phase');
      if (!PHASES.includes(phase)) bad(`Phase muss eine von ${PHASES.join(', ')} sein`);
      const cur = db.get('settings', 'main') || { id: 'main' };
      if (cur.phase === phase) { const { secret, ...pub } = cur; return pub; }
      const next = db.put('settings', 'main', { ...cur, phase, phaseChangedAt: iso(), phaseChangedBy: ctx.person.name });
      feed(`🎬 Event-Phase: ${PHASE_LABEL[cur.phase] || '—'} → ${PHASE_LABEL[phase]} (${ctx.person.name})`, { kind: 'system', level: phase === 'live' ? 'warn' : 'info' });

      // Automatische Durchsage an alle bei den großen Übergängen
      const autoText = phase === 'live'
        ? 'Show läuft — alle auf Position. Viel Erfolg und gute Scares! 🎃'
        : phase === 'abschluss'
          ? 'Show ist vorbei — Tagesabschluss läuft. Danke für heute Nacht! Denkt an Requisiten, Fundsachen und eure Fahrgruppen.'
          : null;
      if (autoText) {
        const a = {
          id: id('a'), t: now(), time: hhmm(), text: autoText, level: 'info',
          scope: { type: 'all' }, scopeLabel: 'an alle', audience: null,
          byPersonId: ctx.person.id, byName: ctx.person.name, requiresAck: false,
        };
        db.put('announcements', a.id, a);
        bus.publish('announce.new', a);
      }
      bus.publish('settings.changed', { keys: ['phase'] });
      const { secret, ...pub } = next;
      return pub;
    }, { roles: ['management'] });

    // Live-Lagestatus: ein dauerhaft sichtbares Banner auf JEDEM Gerät, vom
    // Leitstand gesteuert. Beantwortet im Ausnahmefall (Wetter, Verzögerung)
    // durchgehend "was ist los / wann geht's weiter" — statt einmaliger Durchsage.
    post('/api/settings/lage', async (ctx) => {
      const cur = db.get('settings', 'main') || { id: 'main' };
      // Aufheben
      if (ctx.body.clear === true || ctx.body.active === false) {
        const next = db.put('settings', 'main', { ...cur, lage: null });
        feed(`🟢 Lagestatus aufgehoben — Normalbetrieb (${ctx.person.name}).`, { kind: 'durchsage', level: 'info', by: ctx.person.name });
        bus.publish('settings.changed', { keys: ['lage'] });
        const { secret, ...pub } = next;
        return pub;
      }
      const text = need(ctx.body, 'text').slice(0, 200);
      const level = ['info', 'warnung', 'stop'].includes(ctx.body.level) ? ctx.body.level : 'warnung';
      // nächste Info als "HH:MM" (optional)
      let nextInfoAt = null;
      if (ctx.body.nextInfoAt) {
        const m = String(ctx.body.nextInfoAt).match(/^(\d{1,2}):(\d{2})$/);
        if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) bad('nextInfoAt muss eine Uhrzeit "HH:MM" sein');
        nextInfoAt = `${String(m[1]).padStart(2, '0')}:${m[2]}`;
      }
      const lage = { text, level, nextInfoAt, by: ctx.person.name, at: iso(), time: hhmm() };
      const next = db.put('settings', 'main', { ...cur, lage });
      feed(`📣 Lagestatus: ${text}${nextInfoAt ? ` (nächste Info ${nextInfoAt})` : ''} — ${ctx.person.name}`,
        { kind: 'durchsage', level: level === 'stop' ? 'err' : 'warn', by: ctx.person.name });
      bus.publish('settings.changed', { keys: ['lage'] });
      const { secret, ...pub } = next;
      return pub;
    }, { roles: ['management', 'lead'] });

    post('/api/settings/orte', async (ctx) => {
      const name = need(ctx.body, 'name');
      const lat = Number(ctx.body.lat), lon = Number(ctx.body.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) bad('lat/lon müssen Zahlen sein');
      if (db.one('orte', (o) => o.name.toLowerCase() === name.toLowerCase())) bad('Ort existiert schon');
      const o = { id: id('o'), name, lat, lon };
      db.put('orte', o.id, o);
      return o;
    }, { roles: ['management'] });

    del('/api/settings/orte/:id', async (ctx) => {
      db.del('orte', ctx.params.id);
      return { ok: true };
    }, { roles: ['management'] });
  },
};
