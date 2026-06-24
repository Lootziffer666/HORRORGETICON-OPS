// Modul: CSV-Import/-Export
// Export: Personen, Zuteilung, Catering, Meldungen, Fahrgruppen — Excel-tauglich (; + BOM).
// Import: Personen & Zuteilungen mit Vorschau (Dry-Run), toleranter Spaltenerkennung.
import { bad, need, id, iso, hashPin } from '../kernel/util.js';
import { parseCsv, toCsv, mapHeader } from '../kernel/csv.js';
import { universalParse, parseFreeText } from '../kernel/import.js';
import { sendText } from '../kernel/http.js';

const PEOPLE_SYNONYMS = {
  name: ['name', 'vollername', 'teilnehmer'],
  code: ['code', 'personalcode', 'kuerzel', 'id'],
  rolle: ['rolle', 'rollen', 'funktion'],
  status: ['status'],
  kontakt: ['kontakt', 'email', 'mail', 'emailadresse'],
  telefon: ['telefon', 'handy', 'mobil', 'tel'],
  ort: ['ort', 'wohnort', 'stadt', 'plz'],
  notizen: ['notizen', 'notiz', 'bemerkung', 'kommentar'],
  maze: ['maze', 'labyrinth', 'bereich'],
  position: ['position', 'pos', 'platz'],
};

export default {
  name: 'csv',
  title: 'CSV-Import/-Export',
  version: '1.0.0',
  description: 'Listen rein und raus: Personen, Zuteilung, Catering, Meldungen, Fahrgruppen.',

  routes({ get, post }, { db, bus, feed }) {
    const download = (ctx, filename, header, rows) => {
      sendText(ctx.res, 200, toCsv(header, rows), 'text/csv; charset=utf-8', {
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
      return Symbol.for('handled');
    };

    get('/api/csv/export/personen', async (ctx) => {
      const rows = db.all('people').filter((p) => p.status !== 'archiviert').map((p) => {
        const pos = db.one('positions', (x) => x.assignedPersonId === p.id);
        const maze = pos ? db.get('mazes', pos.mazeId) : null;
        return [p.code, p.name, (p.roles || []).join('+'), p.status, p.kontakt, p.telefon, p.ort,
          maze?.name || '', pos?.code || '', p.linked || !p.selfCreated ? 'ja' : 'nein', p.notizen];
      });
      return download(ctx, 'horrorgeticon-personen.csv',
        ['Code', 'Name', 'Rollen', 'Status', 'Kontakt', 'Telefon', 'Ort', 'Maze', 'Position', 'Verknüpft', 'Notizen'], rows);
    }, { roles: ['management'] });

    get('/api/csv/export/zuteilung', async (ctx) => {
      const rows = [];
      for (const m of db.all('mazes').sort((a, b) => (a.order || 0) - (b.order || 0))) {
        for (const pos of db.find('positions', (p) => p.mazeId === m.id).sort((a, b) => a.code.localeCompare(b.code, 'de', { numeric: true }))) {
          const person = pos.assignedPersonId ? db.get('people', pos.assignedPersonId) : null;
          rows.push([m.name, pos.code, pos.name, person?.name || 'OFFEN', person?.code || '']);
        }
      }
      return download(ctx, 'horrorgeticon-zuteilung.csv', ['Maze', 'Position', 'Bezeichnung', 'Person', 'Code'], rows);
    }, { roles: ['management', 'lead'] });

    get('/api/csv/export/catering', async (ctx) => {
      const rows = db.all('redemptions').sort((a, b) => a.t - b.t).map((r) =>
        [new Date(r.t).toLocaleString('de-DE'), r.personName, db.get('stations', r.stationId)?.name || '', r.drinks, r.meals, r.operator]);
      return download(ctx, 'horrorgeticon-catering.csv', ['Zeit', 'Person', 'Station', 'Getränke', 'Essen', 'Bedienung'], rows);
    }, { roles: ['management', 'catering'] });

    get('/api/csv/export/meldungen', async (ctx) => {
      const rows = db.all('incidents').sort((a, b) => a.t - b.t).map((i) =>
        [i.time, i.kind, i.prio, i.text, i.ort || '', i.byName, i.status, i.reactionSec != null ? Math.round(i.reactionSec / 60 * 10) / 10 : '']);
      return download(ctx, 'horrorgeticon-meldungen.csv', ['Zeit', 'Art', 'Priorität', 'Meldung', 'Ort', 'Von', 'Status', 'Reaktion (min)'], rows);
    }, { roles: ['management'] });

    get('/api/csv/export/fahrgruppen', async (ctx) => {
      const rows = db.all('carpoolGroups').filter((g) => g.status !== 'aufgelöst').map((g) => [
        db.get('people', g.driverId)?.name || '?', g.ort, g.departAt,
        g.riderIds.map((r) => db.get('people', r)?.name || '?').join(' + '),
        `${g.riderIds.length}/${g.seats}`, g.status, g.detourKm,
      ]);
      return download(ctx, 'horrorgeticon-fahrgruppen.csv', ['Fahrer', 'Ab Ort', 'Abfahrt', 'Mitfahrer', 'Auslastung', 'Status', 'Umweg (km)'], rows);
    }, { roles: ['management'] });

    // Import Personen (CSV): dryRun=true → Vorschau; sonst anwenden
    post('/api/csv/import/personen', async (ctx) => {
      const text = need(ctx.body, 'text');
      const { header, rows } = parseCsv(text);
      if (!header.length) bad('CSV ist leer oder hat keine Kopfzeile');
      const map = mapHeader(header, PEOPLE_SYNONYMS);
      if (map.name === undefined) bad(`Spalte „Name" nicht gefunden. Erkannte Spalten: ${header.join(', ')}`);
      const result = buildPreview(db, map, rows);
      if (ctx.body.dryRun !== false) return { dryRun: true, format: 'csv', ...result };
      const applied = applyPeople(db, bus, feed, ctx, result, 'CSV-Import');
      return { dryRun: false, format: 'csv', angewendet: applied, ...result };
    }, { roles: ['management'] });

    // Universal-Import Personen: nimmt Text ODER Datei (base64+filename) — Excel/CSV/TSV/HTML/E-Mail/Freitext.
    // dryRun=true → Vorschau (ändert nichts); sonst anwenden.
    post('/api/import/personen', async (ctx) => {
      const { text = '', base64 = '', filename = '' } = ctx.body || {};
      if (!String(text).trim() && !base64) bad('Kein Inhalt — Text einfügen oder Datei wählen');

      const parsed = universalParse({ text, base64, filename });
      if (parsed.format === 'unsupported') bad(parsed.notes[0] || 'Format wird nicht unterstützt');

      const notes = [...parsed.notes];
      let header = parsed.header, rows = parsed.rows, format = parsed.format;
      let map = mapHeader(header, PEOPLE_SYNONYMS);

      // Keine Namensspalte? → tolerant als Freitext interpretieren (Namen/E-Mails/Telefon extrahieren)
      if (map.name === undefined && format !== 'freitext') {
        const flat = parsed.text && parsed.text.trim()
          ? parsed.text
          : [header, ...rows].map((r) => r.join(' ')).join('\n');
        const ft = parseFreeText(flat);
        header = ft.header; rows = ft.rows; format = 'freitext';
        map = mapHeader(header, PEOPLE_SYNONYMS);
        notes.push('Keine Spaltenüberschriften erkannt — als Freitext interpretiert.');
      }
      if (map.name === undefined || !rows.length) {
        bad(`Keine Namen erkannt. ${parsed.header.length ? `Erkannte Spalten: ${parsed.header.join(', ')}` : 'Inhalt war leer oder unlesbar.'}`);
      }

      const result = buildPreview(db, map, rows);
      result.format = format;
      result.notes = notes;
      result.erkannteSpalten = parsed.header;
      if (ctx.body.dryRun !== false) return { dryRun: true, ...result };
      const applied = applyPeople(db, bus, feed, ctx, result, 'Import');
      return { dryRun: false, angewendet: applied, ...result };
    }, { roles: ['management'] });
  },
};

function autoCode(db, name) {
  const ini = name.split(/\s+/).map((w) => w[0] || 'X').join('').slice(0, 2).toUpperCase().padEnd(2, 'X');
  for (let i = 0; i < 50; i++) {
    const c = `${ini}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
    if (!db.one('people', (x) => x.code === c)) return c;
  }
  return `${ini}-${Date.now() % 100000}`;
}

// Baut die Vorschau (Dry-Run) aus zugeordneten Spalten — gemeinsam für CSV- und Universal-Import.
function buildPreview(db, map, rows) {
  const get_ = (row, key) => map[key] !== undefined ? String(row[map[key]] ?? '').trim() : '';
  const result = { neu: [], aktualisiert: [], fehler: [], zeilen: rows.length };
  for (let n = 0; n < rows.length; n++) {
    const row = rows[n];
    const name = get_(row, 'name');
    if (!name) { result.fehler.push({ zeile: n + 2, grund: 'Name fehlt' }); continue; }
    const code = get_(row, 'code').toUpperCase();
    const roles = (get_(row, 'rolle') || 'actor').toLowerCase()
      .split(/[+,/]/).map((r) => r.trim())
      .map((r) => ({ 'scare actor': 'actor', 'schauspieler': 'actor', 'maze lead': 'lead', 'leitung': 'management' }[r] || r))
      .filter((r) => ['management', 'lead', 'actor', 'springer', 'catering'].includes(r));
    const statusRaw = get_(row, 'status').toLowerCase();
    const status = ['aktiv', 'angefragt', 'ausgeschieden'].includes(statusRaw) ? statusRaw : 'aktiv';

    const existing = (code && db.one('people', (p) => p.code === code))
      || db.one('people', (p) => p.name.toLowerCase() === name.toLowerCase());
    const data = {
      name, status, roles: roles.length ? roles : ['actor'],
      kontakt: get_(row, 'kontakt'), telefon: get_(row, 'telefon'),
      ort: get_(row, 'ort'), notizen: get_(row, 'notizen'),
      maze: get_(row, 'maze'), position: get_(row, 'position').toUpperCase(),
    };
    if (existing) result.aktualisiert.push({ zeile: n + 2, id: existing.id, code: existing.code, ...data });
    else result.neu.push({ zeile: n + 2, code: code || '(auto)', ...data });
  }
  return result;
}

// Wendet die Vorschau an (legt an / aktualisiert, teilt Positionen zu) — gemeinsam für beide Import-Wege.
function applyPeople(db, bus, feed, ctx, result, sourceLabel) {
  let applied = 0;
  const findPosition = (mazeName, posCode) => {
    if (!mazeName || !posCode) return null;
    const maze = db.one('mazes', (m) => m.name.toLowerCase() === mazeName.toLowerCase());
    return maze ? db.one('positions', (p) => p.mazeId === maze.id && p.code === posCode) : null;
  };
  for (const e of result.neu) {
    const p = {
      id: id('p'), code: e.code === '(auto)' ? autoCode(db, e.name) : e.code,
      name: e.name, roles: e.roles, status: e.status,
      kontakt: e.kontakt, telefon: e.telefon, ort: e.ort, notizen: e.notizen,
      selfCreated: false, linked: false, pin: null,
      season: String(new Date().getFullYear()), createdAt: iso(), createdBy: `${sourceLabel} (${ctx.person.name})`,
    };
    db.put('people', p.id, p);
    const pos = findPosition(e.maze, e.position);
    if (pos) db.patch('positions', pos.id, { assignedPersonId: p.id });
    applied++;
  }
  for (const e of result.aktualisiert) {
    db.patch('people', e.id, {
      name: e.name, status: e.status, roles: e.roles,
      kontakt: e.kontakt || undefined, telefon: e.telefon || undefined,
      ort: e.ort || undefined, notizen: e.notizen || undefined,
      updatedAt: iso(), updatedBy: `${sourceLabel} (${ctx.person.name})`,
    });
    const pos = findPosition(e.maze, e.position);
    if (pos) db.patch('positions', pos.id, { assignedPersonId: e.id });
    applied++;
  }
  feed(`📥 ${sourceLabel}: ${result.neu.length} neu, ${result.aktualisiert.length} aktualisiert, ${result.fehler.length} Fehler.`, { kind: 'system', by: ctx.person.name });
  bus.publish('people.changed', {});
  bus.publish('maze.changed', {});
  return applied;
}
