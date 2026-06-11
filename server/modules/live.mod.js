// Modul: Live-Sicht & Anwesenheit (Tracking)
// Check-in/-out, Geräte-Heartbeat, Positionsbestätigung, Gelände-/Maze-Live-Bild.
// Tracking zählt auf den Verwaltungs-Datensatz — bei unverknüpften Selbst-Profilen
// wird das in der Übersicht ausgewiesen (deshalb ist die Verknüpfung wichtig).
import { bad, notFound, now, iso, hhmm } from '../kernel/util.js';

const STALE_MS = 90 * 1000; // ohne Lebenszeichen → „Verbindung verloren“

// Selbstgesetzter Detail-Status (horrops_fullstack.md: ActorStatusPanel)
export const ACTOR_STATI = ['anreise', 'da', 'maske', 'backstage', 'position', 'nicht_verfuegbar'];
export const ACTOR_STATUS_LABEL = {
  anreise: 'Auf Anreise', da: 'Da', maske: 'In der Maske',
  backstage: 'Backstage', position: 'Auf Position', nicht_verfuegbar: 'Nicht verfügbar',
};

export function presenceStatus(db, personId) {
  const pr = db.get('presence', personId);
  if (!pr || pr.state !== 'in') return 'out';
  const onBreak = db.one('breaks', (b) => b.personId === personId && b.status === 'läuft');
  if (onBreak) return 'pause';
  const incident = db.one('incidents', (i) => i.byPersonId === personId && i.status !== 'erledigt' && i.prio === 'hoch');
  if (incident) return 'vorfall';
  if (now() - (pr.lastSeen || 0) > STALE_MS) return 'stumm';
  return 'aktiv';
}

export default {
  name: 'live',
  title: 'Live-Sicht & Anwesenheit',
  version: '1.0.0',
  description: 'Check-in, Heartbeat-Tracking, Live-Karte (Gelände & Maze), Anwesenheitsliste.',

  routes({ get, post }, { db, bus, feed }) {
    const myId = (ctx) => {
      // Leads/Management dürfen für andere einchecken (z. B. vergessenes Handy)
      if (ctx.body.personId && ctx.body.personId !== ctx.person.id) {
        ctx.kernelAuthOk = true;
        return ctx.body.personId;
      }
      return ctx.person.id;
    };

    post('/api/live/checkin', async (ctx) => {
      const pid = myId(ctx);
      if (pid !== ctx.person.id) {
        // Fremd-Check-in nur für Lead/Management
        const roles = new Set([ctx.session.role, ...(ctx.person.roles || [])]);
        if (!roles.has('management') && !roles.has('lead')) bad('Nur Lead/Management dürfen andere einchecken');
      }
      const person = db.get('people', pid) || notFound('Person nicht gefunden');
      const pr = {
        personId: pid, state: 'in', since: now(), lastSeen: now(),
        battery: ctx.body.battery ?? null, device: ctx.body.device || ctx.req.headers['user-agent']?.slice(0, 80) || '',
        positionConfirmedAt: null, unlinked: !!person.selfCreated,
        actorStatus: 'da', lateInfo: null, // Check-in löst Anreise/Verspätung auf
      };
      db.put('presence', pid, pr);
      const pos = db.one('positions', (x) => x.assignedPersonId === pid);
      const maze = pos ? db.get('mazes', pos.mazeId) : null;
      feed(`✅ ${person.name} eingecheckt${maze ? ` — ${maze.name} · ${pos.code}` : ''}${person.selfCreated ? ' (Profil noch unverknüpft!)' : ''}`,
        { kind: 'anwesenheit', mazeId: maze?.id || null });
      bus.publish('presence.changed', { personId: pid, state: 'in' });
      return { ...pr, status: presenceStatus(db, pid) };
    });

    post('/api/live/checkout', async (ctx) => {
      const pid = myId(ctx);
      const pr = db.get('presence', pid);
      if (!pr || pr.state !== 'in') bad('Nicht eingecheckt');
      db.put('presence', pid, { ...pr, state: 'out', outAt: now(), lastSeen: now(), actorStatus: null, lateInfo: null });
      // laufende Pause beenden
      for (const b of db.find('breaks', (b) => b.personId === pid && ['offen', 'genehmigt', 'läuft'].includes(b.status))) {
        db.patch('breaks', b.id, { status: 'beendet', endedAt: now() });
      }
      const person = db.get('people', pid);
      feed(`👋 ${person?.name || '?'} ausgecheckt (Schichtende).`, { kind: 'anwesenheit' });
      bus.publish('presence.changed', { personId: pid, state: 'out' });
      return { ok: true };
    });

    // Heartbeat: alle ~25 s vom Gerät; hält das Tracking frisch
    post('/api/live/heartbeat', async (ctx) => {
      const pid = ctx.person.id;
      const pr = db.get('presence', pid);
      if (!pr || pr.state !== 'in') return { ok: true, checkedIn: false };
      const wasStale = now() - (pr.lastSeen || 0) > STALE_MS;
      db.put('presence', pid, { ...pr, lastSeen: now(), battery: ctx.body.battery ?? pr.battery });
      if (wasStale) bus.publish('presence.changed', { personId: pid, state: 'in' });
      return { ok: true, checkedIn: true, status: presenceStatus(db, pid) };
    });

    // Detail-Status selbst setzen (Bereit/Maske/Backstage/Auf Position …)
    post('/api/live/status', async (ctx) => {
      const status = ctx.body.status;
      if (!ACTOR_STATI.includes(status)) bad(`Status muss einer von ${ACTOR_STATI.join(', ')} sein`);
      const pid = ctx.person.id;
      const pr = db.get('presence', pid) || { personId: pid, state: 'out', since: null, lastSeen: null };
      if (pr.state !== 'in' && status !== 'anreise') bad('Erst einchecken — vor dem Check-in geht nur „Auf Anreise“');
      const upd = { ...pr, actorStatus: status, lastSeen: pr.state === 'in' ? now() : pr.lastSeen };
      if (status === 'position') upd.positionConfirmedAt = now();
      if (status !== 'anreise') upd.lateInfo = null; // wer da ist, ist nicht mehr verspätet
      db.put('presence', pid, upd);
      bus.publish('presence.changed', { personId: pid });
      return { ok: true, actorStatus: status };
    });

    // Verspätung melden — geht auch VOR dem Check-in (Anreise-Fall)
    post('/api/live/late', async (ctx) => {
      const etaMin = Number(ctx.body.etaMin);
      if (!Number.isFinite(etaMin) || etaMin < 1 || etaMin > 600) bad('ETA in Minuten angeben (1–600)');
      const pid = ctx.person.id;
      const pr = db.get('presence', pid) || { personId: pid, state: 'out', since: null, lastSeen: null };
      db.put('presence', pid, {
        ...pr,
        actorStatus: pr.state === 'in' ? pr.actorStatus : 'anreise',
        lateInfo: { etaMin, reason: (ctx.body.reason || '').slice(0, 200), t: now() },
      });
      const pos = db.one('positions', (x) => x.assignedPersonId === pid);
      const maze = pos ? db.get('mazes', pos.mazeId) : null;
      feed(`⏰ ${ctx.person.name} verspätet sich ~${etaMin} min${ctx.body.reason ? ` — „${String(ctx.body.reason).slice(0, 80)}“` : ''}${pos ? ` (${maze?.name} · ${pos.code})` : ''}`,
        { kind: 'anwesenheit', level: 'warn', mazeId: maze?.id || null });
      bus.publish('presence.changed', { personId: pid });
      return { ok: true };
    });

    post('/api/live/confirm-position', async (ctx) => {
      const pid = ctx.person.id;
      const pos = db.one('positions', (x) => x.assignedPersonId === pid) || bad('Dir ist keine Position zugeteilt');
      const pr = db.get('presence', pid) || bad('Bitte zuerst einchecken');
      db.put('presence', pid, { ...pr, positionConfirmedAt: now(), lastSeen: now() });
      bus.publish('presence.changed', { personId: pid });
      return { ok: true, position: pos.code };
    });

    // Lagebild: KPIs + Mazes + Service-Zonen + Personenliste mit Status
    get('/api/live/overview', async () => {
      const people = db.find('people', (p) => p.status === 'aktiv' || p.status === 'angefragt');
      const crew = people.filter((p) => p.status === 'aktiv');
      const rows = crew.map((p) => {
        const pos = db.one('positions', (x) => x.assignedPersonId === p.id);
        const maze = pos ? db.get('mazes', pos.mazeId) : null;
        const pr = db.get('presence', p.id);
        return {
          id: p.id, name: p.name, code: p.code, roles: p.roles, linked: p.linked || !p.selfCreated,
          selfCreated: !!p.selfCreated,
          maze: maze?.name || null, mazeId: maze?.id || null,
          position: pos ? pos.code : null, positionName: pos?.name || null,
          status: presenceStatus(db, p.id),
          actorStatus: pr?.actorStatus || null,
          late: pr?.lateInfo || null,
          since: pr?.since || null, lastSeen: pr?.lastSeen || null, battery: pr?.battery ?? null,
        };
      });
      const anwesend = rows.filter((r) => r.status !== 'out').length;
      const positions = db.all('positions');
      const besetzt = positions.filter((p) => p.assignedPersonId &&
        presenceStatus(db, p.assignedPersonId) !== 'out').length;

      const mazes = db.all('mazes').sort((a, b) => (a.order || 0) - (b.order || 0)).map((m) => {
        const pos = positions.filter((p) => p.mazeId === m.id);
        const onSite = pos.filter((p) => p.assignedPersonId && presenceStatus(db, p.assignedPersonId) !== 'out');
        const incidents = db.find('incidents', (i) => i.mazeId === m.id && i.status !== 'erledigt');
        const breaks = db.find('breaks', (b) => b.status === 'läuft' &&
          pos.some((p) => p.assignedPersonId === b.personId));
        const st = incidents.some((i) => i.prio === 'hoch') ? 'err'
          : (incidents.length || onSite.length < pos.length * 0.8) ? 'warn' : 'ok';
        return {
          id: m.id, name: m.name, short: m.short, zone: m.zone,
          total: pos.length, besetzt: onSite.length, vorfaelle: incidents.length, pausen: breaks.length,
          status: st,
          meta: incidents.length ? `${onSite.length}/${pos.length} · ${incidents.length} Vorfall${incidents.length > 1 ? 'e' : ''}`
            : `${onSite.length}/${pos.length} · ruhig`,
        };
      });

      const zones = db.all('zones').map((z) => {
        let meta = z.note || '';
        let st = 'ok';
        if (z.kind === 'catering') {
          const openDrinks = db.find('incidents', (i) => i.kind === 'getraenk' && i.status !== 'erledigt').length;
          meta = openDrinks ? `${openDrinks} Getränke-Anfrage${openDrinks > 1 ? 'n' : ''}` : 'keine offenen Anfragen';
        } else if (z.kind === 'crew') {
          const inBreak = rows.filter((r) => r.status === 'pause').length;
          meta = `${inBreak} in Pause`;
        } else if (z.kind === 'security') {
          const active = db.find('incidents', (i) => i.prio === 'hoch' && i.status !== 'erledigt');
          st = active.length ? 'err' : 'ok';
          meta = active.length ? `${active.length} Einsatz läuft · ${active[0].ort || ''}` : 'ruhig';
        }
        return { ...z, status: st, meta };
      });

      return {
        t: now(), time: hhmm(),
        kpi: {
          anwesend, crewGesamt: crew.length,
          fehlen: crew.length - anwesend,
          positionenBesetzt: besetzt, positionenGesamt: positions.length,
          aktivePausen: db.find('breaks', (b) => b.status === 'läuft').length,
          offenePausen: db.find('breaks', (b) => b.status === 'offen').length,
          offeneMeldungen: db.find('incidents', (i) => i.status !== 'erledigt').length,
          hochPrio: db.find('incidents', (i) => i.status !== 'erledigt' && i.prio === 'hoch').length,
          unverknuepft: rows.filter((r) => r.selfCreated).length,
        },
        mazes, zones, people: rows,
      };
    });

    // Maze-Detail für Karten (Räume, Pins, Nachbarn)
    get('/api/live/maze/:id', async (ctx) => {
      const m = db.get('mazes', ctx.params.id) || notFound('Maze nicht gefunden');
      const pos = db.find('positions', (p) => p.mazeId === m.id)
        .sort((a, b) => a.code.localeCompare(b.code, 'de', { numeric: true }))
        .map((p) => {
          const person = p.assignedPersonId ? db.get('people', p.assignedPersonId) : null;
          const pr = person ? db.get('presence', person.id) : null;
          return {
            id: p.id, code: p.code, name: p.name, desc: p.desc, room: p.room,
            person: person ? { id: person.id, name: person.name } : null,
            status: person ? presenceStatus(db, person.id) : 'leer',
            actorStatus: pr?.actorStatus || null,
            late: pr?.lateInfo || null,
          };
        });
      const incidents = db.find('incidents', (i) => i.mazeId === m.id && i.status !== 'erledigt');
      return { id: m.id, name: m.name, short: m.short, rooms: m.rooms || [], lead: db.get('people', m.leadPersonId)?.name || null, positions: pos, incidents };
    });
  },
};
