// Modul: Berichte & Auswertungen
// Saison-Report („Erfahrung soll sich summieren“ — Pitch), Nacht-Auswertung,
// Anwesenheit, Catering-Verbrauch, Fahrgruppen-Quote.
import { presenceStatus } from './live.mod.js';
import { sendText } from '../kernel/http.js';

const ROLE_LABEL = { management: 'Management', lead: 'Maze Lead', actor: 'Scare Actor', springer: 'Springer', catering: 'Catering' };
const escH = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export default {
  name: 'reports',
  title: 'Berichte',
  version: '1.0.0',
  description: 'Auswertungen über Anwesenheit, Meldungen, Catering und Fahrgruppen.',

  routes({ get }, { db }) {
    get('/api/reports/overview', async () => {
      const crew = db.find('people', (p) => p.status === 'aktiv');
      const anwesend = crew.filter((p) => presenceStatus(db, p.id) !== 'out');
      const incidents = db.all('incidents');
      const done = incidents.filter((i) => i.reactionSec != null);
      const reds = db.all('redemptions');
      const groups = db.find('carpoolGroups', (g) => g.status === 'fix' || g.status === 'angefragt');
      const breaks = db.all('breaks');

      return {
        anwesenheit: {
          crew: crew.length, anwesend: anwesend.length,
          quote: crew.length ? Math.round((anwesend.length / crew.length) * 100) : 0,
          unentschuldigt: crew.filter((p) => {
            const pr = db.get('presence', p.id);
            return (!pr || pr.state !== 'in') && db.one('positions', (x) => x.assignedPersonId === p.id);
          }).length,
        },
        meldungen: {
          gesamt: incidents.length,
          offen: incidents.filter((i) => i.status !== 'erledigt').length,
          mittlereReaktionMin: done.length ? Math.round(done.reduce((s, i) => s + i.reactionSec, 0) / done.length / 6) / 10 : null,
          nachMaze: db.all('mazes').map((m) => ({
            maze: m.name, n: incidents.filter((i) => i.mazeId === m.id).length,
          })).sort((a, b) => b.n - a.n),
        },
        pausen: {
          gesamt: breaks.length,
          beendet: breaks.filter((b) => b.status === 'beendet').length,
          mittlereWartezeitMin: (() => {
            const w = breaks.filter((b) => b.startedAt && b.requestedAt);
            return w.length ? Math.round(w.reduce((s, b) => s + (b.startedAt - b.requestedAt), 0) / w.length / 6000) / 10 : null;
          })(),
        },
        catering: {
          drinks: reds.reduce((s, r) => s + r.drinks, 0),
          meals: reds.reduce((s, r) => s + r.meals, 0),
          einloesungen: reds.length,
          abgelehnt: db.count('rejections'),
        },
        fahrgruppen: {
          gruppen: groups.length,
          fix: groups.filter((g) => g.status === 'fix').length,
          mitfahrer: groups.reduce((s, g) => s + g.riderIds.length, 0),
          sitzauslastung: (() => {
            const seats = groups.reduce((s, g) => s + g.seats, 0);
            const used = groups.reduce((s, g) => s + g.riderIds.length, 0);
            return seats ? Math.round((used / seats) * 100) : 0;
          })(),
        },
      };
    }, { roles: ['management'] });

    // Übergabeprotokoll (horrops_fullstack.md: HandoverSummary) — alles, was
    // die nächste Schicht / der Nachbericht wissen muss, in einer Antwort.
    get('/api/reports/handover', async (ctx) => {
      const mazeId = ctx.query.get('maze') || null;
      const inMaze = (x) => !mazeId || x.mazeId === mazeId;
      const posIds = new Set(db.find('positions', (p) => !mazeId || p.mazeId === mazeId).map((p) => p.id));

      const tasks = db.find('tasks', (t) => inMaze(t) && t.status !== 'erledigt' && t.status !== 'bestätigt')
        .map((t) => ({ id: t.id, title: t.title, status: t.status, prio: t.prio, critical: t.critical, note: t.note, assignee: t.assigneeId ? db.get('people', t.assigneeId)?.name : null }));
      const incidents = db.find('incidents', (i) => inMaze(i) && i.status !== 'erledigt')
        .map((i) => ({ id: i.id, time: i.time, text: i.text, prio: i.prio, status: i.status, ort: i.ort }));
      const checklists = db.find('checklists', (c) => inMaze(c)).map((c) => ({
        id: c.id, title: c.title, type: c.type,
        done: c.items.filter((x) => x.done).length, total: c.items.length,
        pflichtOffen: c.items.filter((x) => x.mandatory && !x.done).length,
      }));
      const breaks = db.find('breaks', (b) => b.status === 'läuft')
        .filter((b) => {
          const pos = db.one('positions', (x) => x.assignedPersonId === b.personId);
          return !mazeId || pos?.mazeId === mazeId;
        })
        .map((b) => ({ person: db.get('people', b.personId)?.name || '?', seitMin: Math.round((Date.now() - (b.startedAt || b.requestedAt)) / 60000) }));
      const openPositions = db.find('positions', (p) => posIds.has(p.id) && !p.assignedPersonId)
        .map((p) => ({ code: p.code, name: p.name, maze: db.get('mazes', p.mazeId)?.name }));
      const decisions = db.find('feed', (f) => f.kind === 'entscheidung' && (!mazeId || !f.mazeId || f.mazeId === mazeId))
        .sort((a, b) => b.t - a.t).slice(0, 10);

      return {
        stand: new Date().toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit' }),
        maze: mazeId ? db.get('mazes', mazeId)?.name || null : null,
        offeneAufgaben: tasks, offeneVorfaelle: incidents, checklisten: checklists,
        laufendePausen: breaks, unbesetztePositionen: openPositions, entscheidungen: decisions,
      };
    }, { roles: ['management', 'lead'] });

    get('/api/reports/season', async () => {
      const seasons = {};
      for (const p of db.all('people')) {
        const s = p.season || '?';
        seasons[s] ||= { season: s, personen: 0, aktiv: 0 };
        seasons[s].personen++;
        if (p.status === 'aktiv') seasons[s].aktiv++;
      }
      return {
        seasons: Object.values(seasons).sort((a, b) => String(b.season).localeCompare(String(a.season))),
        mazes: db.all('mazes').map((m) => ({
          name: m.name,
          positionen: db.find('positions', (p) => p.mazeId === m.id).length,
          meldungen: db.find('incidents', (i) => i.mazeId === m.id).length,
        })),
      };
    }, { roles: ['management'] });

    // Notfall-/Fallback-Paket (druckfertig): alles, was der Eventabend braucht,
    // falls die App ausfällt — "die Vorbereitung IST der Notfallplan".
    // Ein Klick → Browser zeigt die Seite → Drucken/PDF → in den Leitstand-Ordner.
    get('/api/reports/fallback', async (ctx) => {
      const s = db.get('settings', 'main') || {};
      const nightLabel = s.nightLabel || s.eventName || 'Horrorgeticon Event';
      const dateStr = new Date().toLocaleString('de-DE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      const crew = db.find('people', (p) => p.status === 'aktiv')
        .sort((a, b) => a.name.localeCompare(b.name, 'de'));
      const mazes = db.all('mazes').sort((a, b) => (a.order || 0) - (b.order || 0));

      // Verantwortliche: Management + Leads
      const verantwortliche = db.find('people', (p) => p.status === 'aktiv' && (p.roles || []).some((r) => r === 'management' || r === 'lead'))
        .sort((a, b) => ((b.roles.includes('management') ? 1 : 0) - (a.roles.includes('management') ? 1 : 0)) || a.name.localeCompare(b.name, 'de'));

      const verRows = verantwortliche.map((p) => {
        const ledMaze = mazes.find((m) => m.leadPersonId === p.id);
        return `<tr><td><b>${escH(p.name)}</b></td><td>${escH((p.roles || []).map((r) => ROLE_LABEL[r] || r).join(', '))}${ledMaze ? ' · ' + escH(ledMaze.name) : ''}</td><td>${escH(p.telefon || '—')}</td><td>${escH(p.kontakt || '')}</td></tr>`;
      }).join('\n') || '<tr><td colspan="4"><em>Keine Verantwortlichen hinterlegt.</em></td></tr>';

      const crewRows = crew.map((p, i) => {
        const pos = db.one('positions', (x) => x.assignedPersonId === p.id);
        const maze = pos ? db.get('mazes', pos.mazeId) : null;
        return `<tr><td>${i + 1}</td><td><b>${escH(p.name)}</b></td><td>${escH(p.code || '')}</td><td>${escH((p.roles || []).map((r) => ROLE_LABEL[r] || r).join('+'))}</td><td>${escH(maze ? maze.name + ' · ' + pos.code : '—')}</td><td>${escH(p.telefon || '')}</td><td>${escH(p.ort || '')}</td></tr>`;
      }).join('\n');

      const mazeBlocks = mazes.map((m) => {
        const lead = m.leadPersonId ? db.get('people', m.leadPersonId)?.name : null;
        const positions = db.find('positions', (p) => p.mazeId === m.id)
          .sort((a, b) => a.code.localeCompare(b.code, 'de', { numeric: true }));
        const rows = positions.map((p) => {
          const person = p.assignedPersonId ? db.get('people', p.assignedPersonId) : null;
          const offen = !person ? ' style="background:#fde8e8"' : '';
          return `<tr${offen}><td style="white-space:nowrap"><b>${escH(p.code)}</b></td><td>${escH(p.name || '')}</td><td>${person ? escH(person.name) + ' <span style="color:#888">(' + escH(person.code || '') + ')</span>' : '<b style="color:#c0392b">— OFFEN —</b>'}</td><td>${escH(person?.telefon || '')}</td></tr>`;
        }).join('\n') || '<tr><td colspan="4"><em>keine Positionen</em></td></tr>';
        const besetzt = positions.filter((p) => p.assignedPersonId).length;
        return `<div class="block"><h3>${escH(m.name)} <span class="sub">${besetzt}/${positions.length} besetzt${lead ? ' · Lead: ' + escH(lead) : ''}</span></h3>
<table><thead><tr><th>Pos</th><th>Bezeichnung</th><th>Person</th><th>Telefon</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      }).join('\n');

      const incidentRows = Array.from({ length: 16 }, () =>
        '<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>').join('\n');

      const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<title>Notfall-Paket — ${escH(nightLabel)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:12.5px; color:#1a1a1a; padding:22px; max-width:1000px; margin:0 auto; }
  h1 { font-size:22px; } h2 { font-size:16px; margin:18px 0 6px; border-bottom:2px solid #333; padding-bottom:3px; }
  h3 { font-size:13.5px; margin:10px 0 4px; } h3 .sub { font-weight:400; color:#666; font-size:11.5px; }
  .meta { color:#555; margin:2px 0 14px; }
  .box { background:#fff7e6; border:1.5px solid #e6a817; border-radius:8px; padding:12px 14px; margin:12px 0; }
  .box h2 { border:0; margin:0 0 6px; color:#9a6a00; } .box ol { margin-left:18px; } .box li { margin:3px 0; }
  table { width:100%; border-collapse:collapse; margin-top:4px; }
  th { text-align:left; font-size:10.5px; text-transform:uppercase; color:#555; border-bottom:1.5px solid #ccc; padding:4px 6px; }
  td { padding:4px 6px; border-bottom:1px solid #eee; vertical-align:top; }
  .block { break-inside:avoid; margin-bottom:8px; }
  .incident td { height:26px; border:1px solid #bbb; }
  .pagebreak { page-break-before:always; }
  @media print { body { padding:10px; } a { display:none; } }
</style></head><body>
<h1>🛟 Notfall-/Fallback-Paket</h1>
<div class="meta"><b>${escH(nightLabel)}</b> · Stand: ${escH(dateStr)}</div>

<div class="box">
  <h2>Wenn die App ausfällt: umschalten, nicht reparieren</h2>
  <ol>
    <li>Live-Owner sagt klar an: <b>„App-Fallback aktiv."</b></li>
    <li>Diese ausgedruckte Teilnehmer- &amp; Zuteilungsliste wird zur Wahrheit.</li>
    <li>Meldungen laufen über vorhandene Kanäle (Funk/Ruf) und auf den Incident-Zettel.</li>
    <li>Änderungen werden <b>handschriftlich</b> notiert.</li>
    <li>Der Abend läuft weiter — <b>nicht</b> live am System herumbasteln.</li>
    <li>Nach dem Event: Stand rekonstruieren, Ursache analysieren.</li>
  </ol>
</div>

<h2>Verantwortliche &amp; Kontakte</h2>
<table><thead><tr><th>Name</th><th>Rolle / Bereich</th><th>Telefon</th><th>Kontakt</th></tr></thead><tbody>${verRows}</tbody></table>

<h2>Maze- &amp; Positions-Zuteilung</h2>
${mazeBlocks}

<div class="pagebreak"></div>
<h2>Teilnehmerliste (aktiv: ${crew.length})</h2>
<table><thead><tr><th>#</th><th>Name</th><th>Code</th><th>Rollen</th><th>Einsatz</th><th>Telefon</th><th>Ort</th></tr></thead><tbody>${crewRows}</tbody></table>

<div class="pagebreak"></div>
<h2>Incident-Zettel (handschriftlich)</h2>
<table class="incident"><thead><tr><th style="width:60px">Zeit</th><th style="width:160px">Ort / Maze</th><th>Was ist passiert</th><th style="width:130px">Wer</th><th style="width:90px">Status</th></tr></thead><tbody>${incidentRows}</tbody></table>

<p style="margin-top:24px;color:#888;font-size:11px">Erzeugt von Horrorgeticon Ops · Diese Seite ausdrucken und im Leitstand bereithalten.</p>
</body></html>`;

      sendText(ctx.res, 200, html, 'text/html; charset=utf-8', {
        'Content-Disposition': 'inline; filename="horrorgeticon-notfall-paket.html"',
      });
      return Symbol.for('handled');
    }, { roles: ['management', 'lead'] });
  },
};
