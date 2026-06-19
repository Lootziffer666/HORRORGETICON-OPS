// Modul: DND (Do Not Disturb)
// Actors/Leads koennen sich in den DND-Modus versetzen (manuell) oder er greift
// automatisch bei Phase "live" + actorStatus "position". Notfall-Durchsagen
// kommen IMMER durch — DND filtert nur info/wichtig-Announcements und Alarme.
import { now } from '../kernel/util.js';

/**
 * Prueft ob eine Person im DND-Modus ist (manuell ODER auto).
 * Auto-DND: Phase ist 'live' UND actorStatus ist 'position'.
 */
export function isDND(db, personId) {
  // Manuell aktiviert?
  const rec = db.get('dnd', personId);
  if (rec?.manual) return true;
  // Auto-DND: phase === 'live' && actorStatus === 'position'
  const settings = db.get('settings', 'main');
  if (settings?.phase !== 'live') return false;
  const presence = db.get('presence', personId);
  return presence?.actorStatus === 'position';
}

export default {
  name: 'dnd',
  title: 'Do Not Disturb',
  version: '1.0.0',
  description: 'DND-Modus fuer Actors im Maze — filtert unwichtige Notifications waehrend Position.',

  routes({ get, post }, { db, bus }) {
    // DND-Check im Bus registrieren
    bus.setDndCheck((pid) => isDND(db, pid));

    post('/api/dnd/enable', async (ctx) => {
      const personId = ctx.person.id;
      db.put('dnd', personId, { personId, manual: true, since: now() });
      bus.publish('dnd.changed', { personId, active: true, manual: true });
      return { ok: true, active: true };
    });

    post('/api/dnd/disable', async (ctx) => {
      const personId = ctx.person.id;
      db.del('dnd', personId);
      const auto = isAutoDND(db, personId);
      bus.publish('dnd.changed', { personId, active: auto, manual: false });
      return { ok: true, active: auto };
    });

    get('/api/dnd/status', async (ctx) => {
      return dndStatus(db, ctx.person.id);
    });

    get('/api/dnd/status/:personId', async (ctx) => {
      return dndStatus(db, ctx.params.personId);
    }, { roles: ['management', 'lead'] });
  },
};

function isAutoDND(db, personId) {
  const settings = db.get('settings', 'main');
  if (settings?.phase !== 'live') return false;
  const presence = db.get('presence', personId);
  return presence?.actorStatus === 'position';
}

function dndStatus(db, personId) {
  const rec = db.get('dnd', personId);
  const manual = !!rec?.manual;
  const auto = isAutoDND(db, personId);
  return { active: manual || auto, manual, auto };
}
