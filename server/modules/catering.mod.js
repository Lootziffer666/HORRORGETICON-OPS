// Modul: Catering — Essens- & Getränkemarken
// Prozedere wie im Mockup:
//   1. Leitstand weist Kontingente zu (alle / Maze / Person)
//   2. Crew zeigt rotierenden Einmal-Code (QR + Klartext, erneuert sich alle 60 s)
//   3. Station scannt/tippt Code, wählt Marken, entwertet → sofort verbucht,
//      derselbe Code funktioniert an keiner anderen Station mehr.
import { bad, need, notFound, id, now, iso, hhmm, hmacCode } from '../kernel/util.js';

const SLOT_MS = 60 * 1000;

function secretOf(db) { return db.get('settings', 'main')?.secret || 'ops'; }
function slotNow() { return Math.floor(Date.now() / SLOT_MS); }
function codeFor(db, personId, slot) { return hmacCode(secretOf(db) + '|' + personId, 'marke|' + slot, 8); }

function walletOf(db, personId) {
  return db.get('wallets', personId) || {
    personId, drinks: { total: 0, used: 0 }, meals: { total: 0, used: 0 }, updatedAt: null, expiresAt: null,
  };
}

export default {
  name: 'catering',
  title: 'Catering & Marken',
  version: '1.0.0',
  description: 'Kontingente, Einmal-Codes (60 s), Stationen, Einlösungen, Tagesabschluss.',

  routes({ get, post }, { db, bus, feed }) {
    // ── Crew: eigenes Wallet + aktueller Code ──
    get('/api/catering/wallet', async (ctx) => {
      const w = walletOf(db, ctx.person.id);
      const slot = slotNow();
      const code = codeFor(db, ctx.person.id, slot);
      const history = db.find('redemptions', (r) => r.personId === ctx.person.id)
        .sort((a, b) => b.t - a.t).slice(0, 20)
        .map((r) => ({ ...r, station: db.get('stations', r.stationId)?.name || '?' }));
      return {
        wallet: w,
        code: {
          value: code,
          display: `${ctx.person.code} · ${code.slice(0, 4)}`,
          qr: `HGO1|${ctx.person.id}|${slot}|${code}`,
          secondsLeft: Math.ceil(((slot + 1) * SLOT_MS - Date.now()) / 1000),
        },
        history,
      };
    });

    // ── Leitstand: Kontingente zuweisen ──
    post('/api/catering/quota', async (ctx) => {
      const drinks = Number(ctx.body.drinks ?? 0);
      const meals = Number(ctx.body.meals ?? 0);
      if (drinks < 0 || meals < 0) bad('Kontingent kann nicht negativ sein');
      const scope = ctx.body.scope || { type: 'all' };
      let targets = [];
      if (scope.type === 'all') {
        targets = db.find('people', (p) => p.status === 'aktiv');
      } else if (scope.type === 'maze') {
        const ids = new Set(db.find('positions', (p) => p.mazeId === scope.mazeId && p.assignedPersonId)
          .map((p) => p.assignedPersonId));
        const maze = db.get('mazes', scope.mazeId);
        if (maze?.leadPersonId) ids.add(maze.leadPersonId);
        targets = [...ids].map((i) => db.get('people', i)).filter(Boolean);
      } else if (scope.type === 'person') {
        const p = db.get('people', scope.personId) || notFound('Person nicht gefunden');
        targets = [p];
      } else bad('Unbekannter Empfängerkreis');

      const expiresAt = ctx.body.expiresAt || null;
      for (const p of targets) {
        const w = walletOf(db, p.id);
        db.put('wallets', p.id, {
          ...w,
          drinks: { total: w.drinks.total + drinks, used: w.drinks.used },
          meals: { total: w.meals.total + meals, used: w.meals.used },
          updatedAt: iso(), expiresAt,
        });
      }
      const label = scope.type === 'all' ? `gesamte Crew (${targets.length})`
        : scope.type === 'maze' ? `${db.get('mazes', scope.mazeId)?.name} (${targets.length})`
          : targets[0]?.name;
      feed(`🎟️ Kontingent zugewiesen: ${drinks} Getränke · ${meals} Essen → ${label}`, { kind: 'catering', by: ctx.person.name });
      bus.publish('catering.wallet', { scope, drinks, meals });
      return { ok: true, personen: targets.length };
    }, { roles: ['management'] });

    // ── Station: Code prüfen (Vorschau, ohne zu entwerten) ──
    post('/api/catering/check', async (ctx) => {
      const res = resolveCode(db, ctx.body);
      const w = walletOf(db, res.person.id);
      const presence = db.get('presence', res.person.id);
      const pos = db.one('positions', (x) => x.assignedPersonId === res.person.id);
      const maze = pos ? db.get('mazes', pos.mazeId) : null;
      return {
        ok: true, slot: res.slot,
        person: {
          id: res.person.id, name: res.person.name, code: res.person.code,
          einsatz: maze ? `${maze.name} · ${pos.code}` : (res.person.roles || []).join(', '),
          inPause: !!db.one('breaks', (b) => b.personId === res.person.id && b.status === 'läuft'),
          eingecheckt: presence?.state === 'in',
        },
        wallet: w,
        alreadyUsed: !!db.get('usedCodes', `${res.person.id}:${res.slot}`),
      };
    }, { roles: ['catering', 'management'] });

    // ── Station: einlösen ──
    post('/api/catering/redeem', async (ctx) => {
      const stationId = need(ctx.body, 'stationId');
      const station = db.get('stations', stationId) || notFound('Station nicht gefunden');
      const drinks = Number(ctx.body.drinks || 0);
      const meals = Number(ctx.body.meals || 0);
      if (drinks <= 0 && meals <= 0) bad('Nichts ausgewählt');

      const res = resolveCode(db, ctx.body);
      const usedKey = `${res.person.id}:${res.slot}`;
      if (db.get('usedCodes', usedKey)) {
        db.put('rejections', id('rj'), {
          id: id('rj'), t: now(), time: hhmm(), personId: res.person.id, stationId,
          grund: 'Code bereits benutzt',
        });
        bus.publish('catering.redeemed', { rejected: true, stationId });
        bad('Code wurde bereits benutzt — bitte neuen Code anzeigen lassen (erneuert sich alle 60 s)');
      }

      const w = walletOf(db, res.person.id);
      if (w.expiresAt && Date.now() > Date.parse(w.expiresAt)) bad('Kontingent ist abgelaufen');
      if (w.drinks.total - w.drinks.used < drinks) bad(`Nicht genug Getränkemarken (Rest: ${w.drinks.total - w.drinks.used})`);
      if (w.meals.total - w.meals.used < meals) bad(`Nicht genug Essensmarken (Rest: ${w.meals.total - w.meals.used})`);

      db.put('usedCodes', usedKey, { id: usedKey, personId: res.person.id, slot: res.slot, t: now(), stationId });
      db.put('wallets', res.person.id, {
        ...w,
        drinks: { ...w.drinks, used: w.drinks.used + drinks },
        meals: { ...w.meals, used: w.meals.used + meals },
        updatedAt: iso(),
      });
      const r = {
        id: id('r'), t: now(), time: hhmm(), personId: res.person.id, personName: res.person.name,
        stationId, stationName: station.name, drinks, meals,
        operator: ctx.person.name,
      };
      db.put('redemptions', r.id, r);
      bus.publish('catering.redeemed', r);
      bus.publish('catering.wallet', { personId: res.person.id });
      return { ok: true, redemption: r, wallet: db.get('wallets', res.person.id) };
    }, { roles: ['catering', 'management'] });

    // ── Stationen ──
    get('/api/catering/stations', async () => db.all('stations').map((s) => withStationStats(db, s)));

    post('/api/catering/stations', async (ctx) => {
      const s = { id: id('st'), name: need(ctx.body, 'name'), place: ctx.body.place || '', operatorPersonId: null, createdAt: iso() };
      db.put('stations', s.id, s);
      return s;
    }, { roles: ['management'] });

    post('/api/catering/stations/:id/select', async (ctx) => {
      const s = db.get('stations', ctx.params.id) || notFound('Station nicht gefunden');
      // andere Stationen dieses Bedieners freigeben
      for (const o of db.find('stations', (x) => x.operatorPersonId === ctx.person.id)) {
        db.patch('stations', o.id, { operatorPersonId: null });
      }
      db.patch('stations', s.id, { operatorPersonId: ctx.person.id, selectedAt: iso() });
      bus.publish('catering.station', { stationId: s.id });
      return withStationStats(db, db.get('stations', s.id));
    }, { roles: ['catering', 'management'] });

    // ── Leitstand-Übersicht / Tagesabschluss ──
    get('/api/catering/overview', async () => {
      const wallets = db.all('wallets');
      const settings = db.get('settings', 'main');
      const used = (k) => wallets.reduce((s, w) => s + w[k].used, 0);
      const total = (k) => wallets.reduce((s, w) => s + w[k].total, 0);
      const rows = wallets.map((w) => {
        const p = db.get('people', w.personId);
        if (!p || p.status === 'archiviert') return null;
        const pos = db.one('positions', (x) => x.assignedPersonId === w.personId);
        const maze = pos ? db.get('mazes', pos.mazeId) : null;
        const last = db.find('redemptions', (r) => r.personId === w.personId).sort((a, b) => b.t - a.t)[0];
        return {
          personId: w.personId, name: p.name, code: p.code,
          einsatz: maze ? `${maze.name} · ${pos.code}` : (p.roles || []).join(', '),
          drinks: w.drinks, meals: w.meals,
          zuletzt: last ? `${last.time} · ${db.get('stations', last.stationId)?.name?.replace('Station ', '') || '?'}` : null,
        };
      }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'de'));
      return {
        kpi: {
          drinksUsed: used('drinks'), drinksTotal: total('drinks'),
          mealsUsed: used('meals'), mealsTotal: total('meals'),
          drinksBudget: settings?.catering?.drinksBudget ?? null,
          mealsBudget: settings?.catering?.mealsBudget ?? null,
          stationsOnline: db.find('stations', (s) => s.operatorPersonId).length,
          stationsGesamt: db.count('stations'),
          abgelehnt: db.count('rejections'),
        },
        rows,
        stations: db.all('stations').map((s) => withStationStats(db, s)),
        letzte: db.all('redemptions').sort((a, b) => b.t - a.t).slice(0, 30).map((r) => ({
          ...r,
          einsatz: (() => {
            const pos = db.one('positions', (x) => x.assignedPersonId === r.personId);
            const maze = pos ? db.get('mazes', pos.mazeId) : null;
            return maze ? `${maze.name} · ${pos.code}` : '';
          })(),
        })),
      };
    }, { roles: ['management', 'catering'] });

    get('/api/catering/closing', async (ctx) => {
      const list = db.all('redemptions').sort((a, b) => a.t - b.t);
      const byStation = {};
      for (const r of list) {
        const k = db.get('stations', r.stationId)?.name || r.stationId;
        byStation[k] ||= { station: k, drinks: 0, meals: 0, n: 0 };
        byStation[k].drinks += r.drinks; byStation[k].meals += r.meals; byStation[k].n++;
      }
      return {
        stand: hhmm(), einloesungen: list.length,
        drinks: list.reduce((s, r) => s + r.drinks, 0),
        meals: list.reduce((s, r) => s + r.meals, 0),
        abgelehnt: db.count('rejections'),
        proStation: Object.values(byStation),
      };
    }, { roles: ['management', 'catering'] });
  },
};

function withStationStats(db, s) {
  const reds = db.find('redemptions', (r) => r.stationId === s.id);
  return {
    ...s,
    operator: s.operatorPersonId ? db.get('people', s.operatorPersonId)?.name || null : null,
    online: !!s.operatorPersonId,
    einloesungen: reds.length,
    drinks: reds.reduce((x, r) => x + r.drinks, 0),
    meals: reds.reduce((x, r) => x + r.meals, 0),
  };
}

// Akzeptiert: QR-Payload „HGO1|personId|slot|code“ ODER manuelle Eingabe
// { personCode: 'LK-0427', code: '9F3K' } — aktueller oder vorheriger 60-s-Slot.
function resolveCode(db, body) {
  if (body.qr) {
    const parts = String(body.qr).trim().split('|');
    if (parts.length !== 4 || parts[0] !== 'HGO1') bad('QR-Code hat ein unbekanntes Format');
    const [, personId, slotStr, code] = parts;
    const person = db.get('people', personId) || notFound('Person zum Code nicht gefunden');
    const slot = Number(slotStr);
    const cur = slotNow();
    if (Math.abs(cur - slot) > 1) bad('Code ist abgelaufen — bitte neu anzeigen lassen');
    if (codeFor(db, personId, slot) !== code) bad('Code ist ungültig');
    return { person, slot };
  }
  const personCode = need(body, 'personCode').toUpperCase().replace(/\s/g, '');
  const short = need(body, 'code').toUpperCase().replace(/\s/g, '');
  const person = db.one('people', (p) => p.code?.toUpperCase() === personCode) || notFound(`Kein Crew-Mitglied mit Code ${personCode}`);
  for (const slot of [slotNow(), slotNow() - 1]) {
    const full = codeFor(db, person.id, slot);
    if (full === short || full.slice(0, 4) === short) return { person, slot };
  }
  bad('Marken-Code stimmt nicht oder ist abgelaufen (gilt 60 s)');
}
