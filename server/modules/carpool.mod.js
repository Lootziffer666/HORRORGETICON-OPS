// Modul: Fahrgruppen (Car-Sharing)
// Wer fährt, wer braucht einen Platz → automatischer Matching-Vorschlag
// („beste Option“: minimaler Umweg + passendes Zeitfenster), optional direkt
// mit vorgefertigter Nachricht an die Gruppe (eigener Chat-Kanal + Hinweis).
import { bad, need, notFound, id, now, iso, hhmm } from '../kernel/util.js';
import { distKm, lookupOrt, EVENT_SITE } from '../kernel/geo.js';

export const MSG_TEMPLATES = [
  {
    id: 'vorschlag',
    name: 'Standard-Vorschlag',
    text: (g) => `🚗 Fahrgruppen-Vorschlag für die Horrornacht: ${g.driverName} fährt ab ${g.ort} (${g.departAt} Uhr) und hat ${g.freeSeats} Platz/Plätze. Mitfahrt: ${g.riderNames.join(', ')}. Passt das für euch? Bitte hier kurz zu- oder absagen.`,
  },
  {
    id: 'rueckfahrt',
    name: 'Rückfahrt',
    text: (g) => `🌙 Rückfahrt nach der Show: ${g.driverName} nimmt ${g.riderNames.join(', ')} mit Richtung ${g.ort}. Treffpunkt Crew-Parkplatz nach Tagesabschluss. Kurz bestätigen, danke!`,
  },
  {
    id: 'kurzfristig',
    name: 'Kurzfristige Änderung',
    text: (g) => `⚠️ Kurzfristige Änderung in eurer Fahrgruppe (${g.driverName}, ab ${g.ort}). Bitte Nachrichten checken und neu bestätigen.`,
  },
];

export default {
  name: 'carpool',
  title: 'Fahrgruppen',
  version: '1.0.0',
  description: 'Fahrangebote & Mitfahrwünsche, automatisches Matching, Gruppen-Chat mit Vorlagen.',

  routes({ get, post, del }, { db, bus, feed }) {
    const personLoc = (entry) => {
      if (entry.lat != null && entry.lon != null) return { lat: entry.lat, lon: entry.lon };
      const o = lookupOrt(db, entry.ort);
      return o ? { lat: o.lat, lon: o.lon } : null;
    };

    const enrichGroup = (g) => ({
      ...g,
      driverName: db.get('people', g.driverId)?.name || '?',
      riderNames: g.riderIds.map((r) => db.get('people', r)?.name || '?'),
      responses: g.responses || {},
    });

    get('/api/carpool/state', async (ctx) => {
      const offers = db.all('carpoolOffers').filter((o) => o.active).map((o) => ({
        ...o, name: db.get('people', o.personId)?.name || '?',
      }));
      const requests = db.all('carpoolRequests').filter((r) => r.active).map((r) => ({
        ...r, name: db.get('people', r.personId)?.name || '?',
      }));
      const groups = db.all('carpoolGroups')
        .filter((g) => g.status !== 'aufgelöst')
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(enrichGroup);
      return {
        offers, requests, groups,
        mine: {
          offer: offers.find((o) => o.personId === ctx.person.id) || null,
          request: requests.find((r) => r.personId === ctx.person.id) || null,
          groups: groups.filter((g) => g.driverId === ctx.person.id || g.riderIds.includes(ctx.person.id)),
        },
        site: EVENT_SITE,
      };
    });

    post('/api/carpool/offer', async (ctx) => {
      const ort = need(ctx.body, 'ort');
      const seats = Number(need(ctx.body, 'seats', 'number'));
      if (seats < 1 || seats > 8) bad('Sitzplätze: 1–8');
      // vorhandenes Angebot ersetzen
      for (const o of db.find('carpoolOffers', (x) => x.personId === ctx.person.id && x.active)) {
        db.patch('carpoolOffers', o.id, { active: false });
      }
      const loc = personLoc({ ort, lat: ctx.body.lat, lon: ctx.body.lon });
      const o = {
        id: id('co'), personId: ctx.person.id, ort, seats,
        lat: loc?.lat ?? null, lon: loc?.lon ?? null,
        departAt: ctx.body.departAt || '17:00', tolMin: Number(ctx.body.tolMin) || 20,
        direction: ctx.body.direction || 'beide', note: (ctx.body.note || '').slice(0, 200),
        active: true, createdAt: now(),
      };
      db.put('carpoolOffers', o.id, o);
      bus.publish('carpool.changed', { kind: 'offer' });
      return o;
    });

    post('/api/carpool/request', async (ctx) => {
      const ort = need(ctx.body, 'ort');
      for (const r of db.find('carpoolRequests', (x) => x.personId === ctx.person.id && x.active)) {
        db.patch('carpoolRequests', r.id, { active: false });
      }
      const loc = personLoc({ ort, lat: ctx.body.lat, lon: ctx.body.lon });
      const r = {
        id: id('cr'), personId: ctx.person.id, ort,
        lat: loc?.lat ?? null, lon: loc?.lon ?? null,
        departAt: ctx.body.departAt || '17:00', flexMin: Number(ctx.body.flexMin) || 30,
        direction: ctx.body.direction || 'beide', note: (ctx.body.note || '').slice(0, 200),
        active: true, createdAt: now(),
      };
      db.put('carpoolRequests', r.id, r);
      bus.publish('carpool.changed', { kind: 'request' });
      return r;
    });

    del('/api/carpool/offer', async (ctx) => {
      for (const o of db.find('carpoolOffers', (x) => x.personId === ctx.person.id && x.active)) {
        db.patch('carpoolOffers', o.id, { active: false });
      }
      bus.publish('carpool.changed', { kind: 'offer' });
      return { ok: true };
    });
    del('/api/carpool/request', async (ctx) => {
      for (const r of db.find('carpoolRequests', (x) => x.personId === ctx.person.id && x.active)) {
        db.patch('carpoolRequests', r.id, { active: false });
      }
      bus.publish('carpool.changed', { kind: 'request' });
      return { ok: true };
    });

    // Automatisches Matching → Vorschläge (ersetzt alte, noch nicht gesendete Vorschläge)
    post('/api/carpool/match', async (ctx) => {
      for (const g of db.find('carpoolGroups', (x) => x.status === 'vorschlag')) db.del('carpoolGroups', g.id);
      const result = computeMatching(db);
      for (const g of result.groups) db.put('carpoolGroups', g.id, g);
      feed(`🚗 Fahrgruppen-Matching: ${result.groups.length} Gruppe(n) vorgeschlagen, ${result.unmatched.length} ohne Platz.`, { kind: 'fahrgruppe', by: ctx.person.name });
      bus.publish('carpool.changed', { kind: 'match' });
      return { ...result, groups: result.groups.map(enrichGroup) };
    }, { roles: ['management'] });

    get('/api/carpool/templates', async () => MSG_TEMPLATES.map((t) => ({ id: t.id, name: t.name })));

    // Vorschlag an die Gruppe senden: Chat-Kanal + vorgefertigte Nachricht + Feed
    post('/api/carpool/groups/:id/send', async (ctx) => {
      const g = db.get('carpoolGroups', ctx.params.id) || notFound('Gruppe nicht gefunden');
      if (g.status !== 'vorschlag') bad('Gruppe wurde schon angefragt');
      const tpl = MSG_TEMPLATES.find((t) => t.id === (ctx.body.template || 'vorschlag')) || MSG_TEMPLATES[0];
      const eg = enrichGroup(g);
      const members = [g.driverId, ...g.riderIds];

      const ch = {
        id: id('ch'), key: null, type: 'carpool',
        name: `🚗 Fahrgruppe ${eg.driverName.split(' ')[0]} (${g.ort})`,
        members, mazeId: null, createdAt: now(), carpoolGroupId: g.id,
      };
      db.put('channels', ch.id, ch);
      const text = ctx.body.textOverride?.slice(0, 600) || tpl.text({ ...eg, freeSeats: g.seats - g.riderIds.length });
      const m = {
        id: id('msg'), channelId: ch.id, t: now(), time: hhmm(),
        byPersonId: ctx.person.id, byName: ctx.person.name, text,
      };
      db.put('messages', m.id, m);
      db.patch('carpoolGroups', g.id, {
        status: 'angefragt', channelId: ch.id, sentAt: iso(),
        responses: Object.fromEntries(members.filter((x) => x !== g.driverId).map((x) => [x, null])),
      });
      feed(`🚗 Fahrgruppen-Vorschlag an ${eg.driverName} + ${eg.riderNames.length} Mitfahrer gesendet.`, { kind: 'fahrgruppe', by: ctx.person.name });
      bus.publish('chat.message', { ...m, channelType: 'carpool', channelName: ch.name, members }, {
        audience: (c) => members.includes(c.person.id) || hasMgmt(c),
      });
      bus.publish('carpool.changed', { kind: 'sent', groupId: g.id });
      return enrichGroup(db.get('carpoolGroups', g.id));
    }, { roles: ['management'] });

    post('/api/carpool/groups/:id/respond', async (ctx) => {
      const g = db.get('carpoolGroups', ctx.params.id) || notFound('Gruppe nicht gefunden');
      const accept = !!ctx.body.accept;
      if (!g.riderIds.includes(ctx.person.id) && g.driverId !== ctx.person.id) bad('Du gehörst nicht zu dieser Gruppe');
      const responses = { ...(g.responses || {}), [ctx.person.id]: accept ? 'zugesagt' : 'abgelehnt' };
      let upd = { responses };
      if (!accept && g.riderIds.includes(ctx.person.id)) {
        upd.riderIds = g.riderIds.filter((x) => x !== ctx.person.id);
      }
      const allIn = (upd.riderIds || g.riderIds).every((r) => responses[r] === 'zugesagt');
      if (allIn && (upd.riderIds || g.riderIds).length > 0) upd.status = 'fix';
      if ((upd.riderIds || g.riderIds).length === 0) upd.status = 'aufgelöst';
      db.patch('carpoolGroups', g.id, upd);
      if (g.channelId) {
        const m = {
          id: id('msg'), channelId: g.channelId, t: now(), time: hhmm(),
          byPersonId: ctx.person.id, byName: ctx.person.name,
          text: accept ? '✅ Ich bin dabei.' : '❌ Ich kann leider nicht.',
        };
        db.put('messages', m.id, m);
        bus.publish('chat.message', { ...m, channelType: 'carpool' }, {
          audience: (c) => [g.driverId, ...g.riderIds].includes(c.person.id) || hasMgmt(c),
        });
      }
      bus.publish('carpool.changed', { kind: 'response', groupId: g.id });
      return enrichGroup(db.get('carpoolGroups', g.id));
    });

    post('/api/carpool/groups/:id/dissolve', async (ctx) => {
      const g = db.get('carpoolGroups', ctx.params.id) || notFound('Gruppe nicht gefunden');
      db.patch('carpoolGroups', g.id, { status: 'aufgelöst' });
      bus.publish('carpool.changed', { kind: 'dissolved', groupId: g.id });
      return { ok: true };
    }, { roles: ['management'] });
  },
};

function hasMgmt(client) {
  const roles = new Set([client.session?.role, ...(client.person?.roles || [])]);
  return roles.has('management');
}

// Greedy-Matching: jeder Mitfahrwunsch geht zum Fahrer mit dem geringsten
// Umweg (Luftlinie Fahrer-Ort ↔ Mitfahrer-Ort), solange Sitz + Zeitfenster passen.
export function computeMatching(db) {
  const offers = db.all('carpoolOffers').filter((o) => o.active);
  const requests = db.all('carpoolRequests').filter((r) => r.active);
  const toMin = (hm) => { const [h, m] = String(hm || '17:00').split(':').map(Number); return h * 60 + (m || 0); };

  const groups = offers.map((o) => ({
    id: id('cg'), offerId: o.id, driverId: o.personId, ort: o.ort,
    lat: o.lat, lon: o.lon, departAt: o.departAt, seats: o.seats,
    riderIds: [], detourKm: 0, score: 0,
    status: 'vorschlag', createdAt: now(), responses: {},
  }));

  const unmatched = [];
  // Wer am wenigsten flexibel ist, wird zuerst vermittelt
  const sorted = [...requests].sort((a, b) => (a.flexMin || 30) - (b.flexMin || 30));
  for (const r of sorted) {
    let best = null, bestCost = Infinity;
    for (const g of groups) {
      if (g.riderIds.length >= g.seats) continue;
      const o = offers.find((x) => x.id === g.offerId);
      const dt = Math.abs(toMin(g.departAt) - toMin(r.departAt));
      if (dt > (o.tolMin || 20) + (r.flexMin || 30)) continue;
      if (o.direction !== 'beide' && r.direction !== 'beide' && o.direction !== r.direction) continue;
      const dKm = (g.lat != null && r.lat != null) ? distKm(g, r) : (g.ort === r.ort ? 0 : null);
      if (dKm === null || dKm > 25) continue; // mehr als 25 km Umweg schlagen wir nicht vor
      const cost = dKm + dt / 10; // km dominieren, Zeitversatz als Feinjustierung
      if (cost < bestCost) { bestCost = cost; best = g; }
    }
    if (best) {
      best.riderIds.push(r.personId);
      best.detourKm = Math.round((best.detourKm + bestCost) * 10) / 10;
      best.score += 1;
    } else {
      unmatched.push({ personId: r.personId, name: db.get('people', r.personId)?.name || '?', ort: r.ort });
    }
  }
  const filled = groups.filter((g) => g.riderIds.length > 0);
  // „Beste Option“: höchste Auslastung, geringster Umweg
  filled.sort((a, b) => (b.riderIds.length / b.seats) - (a.riderIds.length / a.seats) || a.detourKm - b.detourKm);
  filled.forEach((g, i) => { g.best = i === 0; });
  return { groups: filled, unmatched, angebotene: offers.length, gesucht: requests.length };
}
