// Modul: Kids Day (Family-Friendly Event Mode)
// Familienfreundlicher Tagesmodus: geringere Intensitaet, Altersgruppen,
// Sicherheitsbriefings, Eltern-Stationen, angepasste Maze-Konfigurationen.
import { bad, need, notFound, id, now, iso, hhmm } from '../kernel/util.js';

const INTENSITIES = ['leicht', 'mittel', 'aus'];

const DEFAULT_CONFIG = {
  enabled: false,
  date: null,
  startTime: '10:00',
  endTime: '16:00',
  ageGroups: [
    { label: '4-6 Jahre', minAge: 4, maxAge: 6 },
    { label: '7-9 Jahre', minAge: 7, maxAge: 9 },
    { label: '10-12 Jahre', minAge: 10, maxAge: 12 },
  ],
  defaultIntensity: 'leicht',
  mazeConfigs: [],
  safetyBriefingRequired: true,
  parentStations: [],
  emergencyProtocol: 'Bei Notfall: Kind beruhigen, Eltern informieren, Erste Hilfe alarmieren.',
};

export default {
  name: 'kidsday',
  title: 'Kids Day',
  version: '1.0.0',
  description: 'Familientag-Modus: Intensitaetssteuerung, Altersgruppen, Sicherheit, Leitstand-KPIs.',

  routes({ get, post, patch }, { db, bus, feed }) {
    function getConfig() {
      const settings = db.get('settings', 'main') || {};
      return { ...DEFAULT_CONFIG, ...(settings.kidsDay || {}) };
    }

    function saveConfig(cfg) {
      const cur = db.get('settings', 'main') || { id: 'main' };
      db.put('settings', 'main', { ...cur, kidsDay: cfg });
    }

    // GET /api/kidsday/config — aktuelle Kids-Day-Konfiguration
    get('/api/kidsday/config', async () => {
      return getConfig();
    });

    // PATCH /api/kidsday/config — Konfiguration aktualisieren (nur Management)
    patch('/api/kidsday/config', async (ctx) => {
      const cur = getConfig();
      const upd = {};

      if (ctx.body.enabled !== undefined) upd.enabled = !!ctx.body.enabled;
      if (ctx.body.date !== undefined) upd.date = ctx.body.date;
      if (ctx.body.startTime !== undefined) upd.startTime = ctx.body.startTime;
      if (ctx.body.endTime !== undefined) upd.endTime = ctx.body.endTime;
      if (ctx.body.defaultIntensity !== undefined) {
        if (!INTENSITIES.includes(ctx.body.defaultIntensity)) bad('Intensitaet muss leicht, mittel oder aus sein');
        upd.defaultIntensity = ctx.body.defaultIntensity;
      }
      if (ctx.body.ageGroups !== undefined) {
        if (!Array.isArray(ctx.body.ageGroups)) bad('ageGroups muss ein Array sein');
        if (ctx.body.ageGroups.length > 20) bad('ageGroups darf maximal 20 Eintraege haben');
        upd.ageGroups = ctx.body.ageGroups;
      }
      if (ctx.body.mazeConfigs !== undefined) {
        if (!Array.isArray(ctx.body.mazeConfigs)) bad('mazeConfigs muss ein Array sein');
        if (ctx.body.mazeConfigs.length > 50) bad('mazeConfigs darf maximal 50 Eintraege haben');
        upd.mazeConfigs = ctx.body.mazeConfigs;
      }
      if (ctx.body.safetyBriefingRequired !== undefined) upd.safetyBriefingRequired = !!ctx.body.safetyBriefingRequired;
      if (ctx.body.parentStations !== undefined) {
        if (!Array.isArray(ctx.body.parentStations)) bad('parentStations muss ein Array sein');
        if (ctx.body.parentStations.length > 50) bad('parentStations darf maximal 50 Eintraege haben');
        upd.parentStations = ctx.body.parentStations;
      }
      if (ctx.body.emergencyProtocol !== undefined) upd.emergencyProtocol = String(ctx.body.emergencyProtocol).slice(0, 1000);

      const next = { ...cur, ...upd };
      saveConfig(next);
      bus.publish('kidsday.changed', { action: 'config_updated', config: next });
      return next;
    }, { roles: ['management'] });

    // POST /api/kidsday/activate — Kids-Day-Modus aktivieren
    post('/api/kidsday/activate', async (ctx) => {
      const cfg = getConfig();
      if (cfg.enabled) return { ok: true, message: 'Kids Day ist bereits aktiv' };
      cfg.enabled = true;
      if (!cfg.date) cfg.date = iso().slice(0, 10);
      saveConfig(cfg);
      feed(`🧒 Kids Day aktiviert (${ctx.person.name})`, { kind: 'system', level: 'warn' });
      bus.publish('kidsday.changed', { action: 'activated', config: cfg });
      bus.publish('settings.changed', { keys: ['kidsDay'] });
      return { ok: true, config: cfg };
    }, { roles: ['management'] });

    // POST /api/kidsday/deactivate — Kids-Day-Modus deaktivieren
    post('/api/kidsday/deactivate', async (ctx) => {
      const cfg = getConfig();
      if (!cfg.enabled) return { ok: true, message: 'Kids Day ist bereits deaktiviert' };
      cfg.enabled = false;
      saveConfig(cfg);
      feed(`🧒 Kids Day deaktiviert (${ctx.person.name})`, { kind: 'system', level: 'info' });
      bus.publish('kidsday.changed', { action: 'deactivated', config: cfg });
      bus.publish('settings.changed', { keys: ['kidsDay'] });
      return { ok: true, config: cfg };
    }, { roles: ['management'] });

    // GET /api/kidsday/mazes — Maze-Liste mit Intensitaetskonfiguration
    get('/api/kidsday/mazes', async () => {
      const cfg = getConfig();
      const mazes = db.all('mazes');
      return mazes.map((m) => {
        const mc = (cfg.mazeConfigs || []).find((c) => c.mazeId === m.id);
        return {
          mazeId: m.id,
          name: m.name,
          kidsDayName: mc?.kidsDayName || null,
          intensity: mc ? mc.intensity : cfg.defaultIntensity,
          maxGroupSize: mc ? mc.maxGroupSize : null,
          specialRules: mc ? mc.specialRules : null,
          kidsMode: cfg.enabled,
        };
      });
    });

    // PATCH /api/kidsday/mazes/:id — Intensitaet fuer ein Maze setzen
    patch('/api/kidsday/mazes/:id', async (ctx) => {
      const maze = db.get('mazes', ctx.params.id);
      if (!maze) notFound('Maze nicht gefunden');
      const intensity = ctx.body.intensity;
      if (intensity && !INTENSITIES.includes(intensity)) bad('Intensitaet muss leicht, mittel oder aus sein');

      const cfg = getConfig();
      const configs = [...(cfg.mazeConfigs || [])];
      const idx = configs.findIndex((c) => c.mazeId === ctx.params.id);
      const existing = configs[idx] || {};
      const entry = {
        mazeId: ctx.params.id,
        intensity: intensity || cfg.defaultIntensity,
        maxGroupSize: ctx.body.maxGroupSize !== undefined ? ctx.body.maxGroupSize : (existing.maxGroupSize || null),
        specialRules: ctx.body.specialRules !== undefined ? ctx.body.specialRules : (existing.specialRules || null),
        kidsDayName: ctx.body.kidsDayName !== undefined ? (ctx.body.kidsDayName || null) : (existing.kidsDayName || null),
      };
      if (idx >= 0) configs[idx] = entry;
      else configs.push(entry);
      cfg.mazeConfigs = configs;
      saveConfig(cfg);
      bus.publish('kidsday.changed', { action: 'maze_updated', mazeId: ctx.params.id, intensity: entry.intensity });
      return { ...entry, name: maze.name, kidsMode: cfg.enabled };
    }, { roles: ['management'] });

    // GET /api/kidsday/overview — Leitstand-KPIs fuer Kids Day
    get('/api/kidsday/overview', async () => {
      const cfg = getConfig();
      const mazes = db.all('mazes');

      // Gruppen (Gaeste-Gruppen) heute
      const today = iso().slice(0, 10);
      const allGroups = db.all('groups');
      const todayGroups = allGroups.filter((g) => g.date === today || (g.t && iso(g.t).slice(0, 10) === today));
      const activeGroups = todayGroups.filter((g) => g.status === 'aktiv' || g.status === 'im_maze');

      // Incidents im Kids-Day-Zeitraum
      const incidents = db.all('incidents');
      const todayIncidents = incidents.filter((i) => iso(i.t).slice(0, 10) === today);
      const openIncidents = todayIncidents.filter((i) => i.status !== 'erledigt');

      // Maze-Kapazitaetsauslastung
      const mazeStats = mazes.map((m) => {
        const mc = (cfg.mazeConfigs || []).find((c) => c.mazeId === m.id);
        const intensity = mc ? mc.intensity : cfg.defaultIntensity;
        return {
          mazeId: m.id,
          name: m.name,
          intensity,
          compliant: INTENSITIES.includes(intensity) && intensity !== 'aus',
          active: intensity !== 'aus',
        };
      });

      // Crew-Bereitschaft
      // NOTE: Counts the full roster (all actors + leads), not just Kids Day assigned
      // crew. Acceptable for v1 since the full crew is expected on Kids Day events.
      const people = db.all('people');
      const checkedIn = people.filter((p) => p.checkedIn || p.status === 'anwesend');
      const crew = people.filter((p) => (p.roles || []).includes('actor') || (p.roles || []).includes('lead'));

      // Wartezeit-Schaetzung (Durchschnitt der letzten Gruppen)
      // Coerce to Number and filter out NaN to guard against ISO-string timestamps.
      const completedGroups = todayGroups.filter((g) => g.doneAt && g.startedAt);
      const validWaits = completedGroups
        .map((g) => Number(g.startedAt) - Number(g.t))
        .filter((v) => Number.isFinite(v) && v >= 0);
      const avgWaitMin = validWaits.length
        ? Math.round(validWaits.reduce((s, v) => s + v, 0) / validWaits.length / 60000)
        : null;

      return {
        kidsDayActive: cfg.enabled,
        date: cfg.date || today,
        timeWindow: { start: cfg.startTime, end: cfg.endTime },
        groups: {
          total: todayGroups.length,
          active: activeGroups.length,
          completed: todayGroups.filter((g) => g.status === 'fertig' || g.status === 'erledigt').length,
        },
        waitTimeMin: avgWaitMin,
        incidents: {
          total: todayIncidents.length,
          open: openIncidents.length,
          highPrio: openIncidents.filter((i) => i.prio === 'hoch').length,
        },
        mazes: {
          total: mazes.length,
          activeInKidsMode: mazeStats.filter((m) => m.active).length,
          allCompliant: mazeStats.every((m) => m.compliant || !m.active),
          details: mazeStats,
        },
        staff: {
          required: crew.length,
          checkedIn: checkedIn.length,
          ready: checkedIn.length >= crew.length,
        },
      };
    }, { roles: ['management', 'lead'] });
  },
};
