// Modul: Event-Timeline-Export
// Chronologische Gesamtansicht aller Events fuer Nachbesprechung und Dokumentation.
// Endpunkte: JSON, druckfertiges HTML, CSV.
import { sendText } from '../kernel/http.js';
import { hhmm } from '../kernel/util.js';

export default {
  name: 'timeline',
  title: 'Event-Timeline',
  version: '1.0.0',
  description: 'Chronologischer Export aller Events fuer Nachbesprechung und Dokumentation.',

  routes({ get }, { db }) {

    // --- Hilfsfunktion: Timeline-Daten sammeln und sortieren ---
    function buildTimeline(from, to) {
      const entries = [];

      // 1. Alle Feed-Eintraege
      for (const f of db.all('feed')) {
        const ts = f.t || 0;
        if (from && ts < from) continue;
        if (to && ts > to) continue;
        // Phasenwechsel
        if (f.kind === 'system' && f.text && f.text.includes('Event-Phase')) {
          entries.push({ t: ts, time: f.time || hhmm(ts), category: 'phase', text: f.text, person: f.by || '', mazeId: f.mazeId || '', level: f.level || '' });
          continue;
        }
        // Entscheidungen
        if (f.kind === 'entscheidung') {
          entries.push({ t: ts, time: f.time || hhmm(ts), category: 'entscheidung', text: f.text, person: f.by || '', mazeId: f.mazeId || '', level: f.level || '' });
          continue;
        }
        // Sonstige Feed-Eintraege
        entries.push({ t: ts, time: f.time || hhmm(ts), category: 'feed', text: f.text, person: f.by || '', mazeId: f.mazeId || '', level: f.level || '' });
      }

      // 2. Meldungen (Incidents) mit Reaktionszeiten
      for (const i of db.all('incidents')) {
        const ts = i.t || 0;
        if (from && ts < from) continue;
        if (to && ts > to) continue;
        const reactionMin = i.reactionSec != null ? Math.round(i.reactionSec / 60 * 10) / 10 : null;
        entries.push({
          t: ts, time: i.time || hhmm(ts), category: 'meldung',
          text: `[${i.kind || 'meldung'}] ${i.text}${i.ort ? ' (' + i.ort + ')' : ''}`,
          person: i.byName || '', mazeId: i.mazeId || '', level: i.prio || '',
          extra: reactionMin != null ? `Reaktion: ${reactionMin} min` : '',
        });
      }

      // 3. Durchsagen (Announcements)
      for (const a of db.all('announcements')) {
        const ts = a.t || 0;
        if (from && ts < from) continue;
        if (to && ts > to) continue;
        entries.push({
          t: ts, time: a.time || hhmm(ts), category: 'durchsage',
          text: a.text, person: a.byName || '', mazeId: '',
          level: a.level || '', extra: a.scopeLabel || '',
        });
      }

      // 4. Check-in/Check-out (Presence)
      for (const p of db.all('presence')) {
        const ts = p.t || 0;
        if (!ts) continue;
        if (from && ts < from) continue;
        if (to && ts > to) continue;
        const person = db.get('people', p.personId);
        const personName = person ? person.name : p.personId;
        const text = p.state === 'in' ? 'Check-in' : 'Check-out';
        entries.push({
          t: ts, time: hhmm(ts), category: 'checkin',
          text, person: personName, mazeId: '', level: '',
        });
      }

      // 5. Pausenanfragen (Breaks)
      for (const b of db.all('breaks')) {
        const ts = b.t || b.requestedAt || 0;
        if (!ts) continue;
        if (from && ts < from) continue;
        if (to && ts > to) continue;
        const person = db.get('people', b.personId);
        const personName = person ? person.name : b.personId;
        const text = `Pause ${b.status}${b.note ? ': ' + b.note : ''}`;
        entries.push({
          t: ts, time: hhmm(ts), category: 'pause',
          text, person: personName, mazeId: '', level: '',
        });
      }

      // Sortieren nach Zeitstempel
      entries.sort((a, b) => a.t - b.t);
      return entries;
    }

    // --- GET /api/reports/timeline (JSON) ---
    get('/api/reports/timeline', async (ctx) => {
      const from = ctx.query.get('from') ? Number(ctx.query.get('from')) : null;
      const to = ctx.query.get('to') ? Number(ctx.query.get('to')) : null;
      return buildTimeline(from, to);
    }, { roles: ['management'] });

    // --- GET /api/reports/timeline/export (HTML) ---
    get('/api/reports/timeline/export', async (ctx) => {
      const from = ctx.query.get('from') ? Number(ctx.query.get('from')) : null;
      const to = ctx.query.get('to') ? Number(ctx.query.get('to')) : null;
      const entries = buildTimeline(from, to);
      const settings = db.get('settings', 'main') || {};
      const nightLabel = settings.nightLabel || 'Horrorgeticon Event';
      const phase = settings.phase || '?';
      const phaseChangedAt = settings.phaseChangedAt ? hhmm(settings.phaseChangedAt) : '';
      const dateStr = new Date().toLocaleDateString('de-DE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

      // Statistik
      const totalEntries = entries.length;
      const incidentCount = entries.filter((e) => e.category === 'meldung').length;
      const announcementCount = entries.filter((e) => e.category === 'durchsage').length;
      const phaseCount = entries.filter((e) => e.category === 'phase').length;
      const incidents = db.all('incidents');
      const withReaction = incidents.filter((i) => i.reactionSec != null);
      const avgReaction = withReaction.length ? Math.round(withReaction.reduce((s, i) => s + i.reactionSec, 0) / withReaction.length / 6) / 10 : null;

      const categoryColors = {
        feed: '#6b7280', meldung: '#ef4444', durchsage: '#f59e0b',
        phase: '#8b5cf6', checkin: '#10b981', pause: '#3b82f6', entscheidung: '#ec4899',
      };
      const categoryLabels = {
        feed: 'Feed', meldung: 'Meldung', durchsage: 'Durchsage',
        phase: 'Phase', checkin: 'Check-in/out', pause: 'Pause', entscheidung: 'Entscheidung',
      };

      const escHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

      const rows = entries.map((e) => {
        const color = categoryColors[e.category] || '#6b7280';
        const label = categoryLabels[e.category] || e.category;
        return `<tr>
          <td style="white-space:nowrap;font-weight:600">${escHtml(e.time)}</td>
          <td><span style="background:${color};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">${escHtml(label)}</span></td>
          <td>${escHtml(e.text)}${e.extra ? ' <em style="color:#666">(' + escHtml(e.extra) + ')</em>' : ''}</td>
          <td>${escHtml(e.person)}</td>
          <td>${escHtml(e.mazeId ? (db.get('mazes', e.mazeId)?.name || e.mazeId) : '')}</td>
        </tr>`;
      }).join('\n');

      const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Event-Timeline - ${escHtml(nightLabel)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; color: #1a1a1a; padding: 24px; max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .meta { color: #555; margin-bottom: 16px; font-size: 13px; }
  .stats { display: flex; gap: 24px; margin-bottom: 20px; padding: 12px 16px; background: #f3f4f6; border-radius: 8px; flex-wrap: wrap; }
  .stat { text-align: center; }
  .stat .val { font-size: 20px; font-weight: 700; }
  .stat .lbl { font-size: 11px; color: #555; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; color: #666; border-bottom: 2px solid #ddd; padding: 6px 8px; }
  td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  tr:hover { background: #f9fafb; }
  @media print { body { padding: 12px; } .stats { break-inside: avoid; } }
</style>
</head>
<body>
<h1>${escHtml(nightLabel)} - Event-Timeline</h1>
<div class="meta">${escHtml(dateStr)} | Phase: ${escHtml(phase)}${phaseChangedAt ? ' (seit ' + escHtml(phaseChangedAt) + ')' : ''}</div>
<div class="stats">
  <div class="stat"><div class="val">${totalEntries}</div><div class="lbl">Eintr&auml;ge gesamt</div></div>
  <div class="stat"><div class="val">${incidentCount}</div><div class="lbl">Meldungen</div></div>
  <div class="stat"><div class="val">${avgReaction != null ? avgReaction + ' min' : '-'}</div><div class="lbl">&Oslash; Reaktionszeit</div></div>
  <div class="stat"><div class="val">${announcementCount}</div><div class="lbl">Durchsagen</div></div>
  <div class="stat"><div class="val">${phaseCount}</div><div class="lbl">Phasenwechsel</div></div>
</div>
<table>
<thead><tr><th>Zeit</th><th>Kategorie</th><th>Text</th><th>Person</th><th>Maze</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>`;

      sendText(ctx.res, 200, html, 'text/html; charset=utf-8', {
        'Content-Disposition': 'inline; filename="timeline.html"',
      });
      return Symbol.for('handled');
    }, { roles: ['management'] });

    // --- GET /api/reports/timeline/csv ---
    get('/api/reports/timeline/csv', async (ctx) => {
      const from = ctx.query.get('from') ? Number(ctx.query.get('from')) : null;
      const to = ctx.query.get('to') ? Number(ctx.query.get('to')) : null;
      const entries = buildTimeline(from, to);

      const categoryLabels = {
        feed: 'Feed', meldung: 'Meldung', durchsage: 'Durchsage',
        phase: 'Phase', checkin: 'Check-in/out', pause: 'Pause', entscheidung: 'Entscheidung',
      };

      const escCsv = (s) => {
        let str = String(s || '').replace(/"/g, '""');
        if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
        return str.includes(';') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
      };

      const header = ['Zeit', 'Kategorie', 'Text', 'Person', 'Maze', 'Level'].join(';');
      const rows = entries.map((e) => {
        const mazeName = e.mazeId ? (db.get('mazes', e.mazeId)?.name || e.mazeId) : '';
        return [e.time, categoryLabels[e.category] || e.category, e.text, e.person, mazeName, e.level].map(escCsv).join(';');
      });

      const csv = '\uFEFF' + header + '\n' + rows.join('\n');

      sendText(ctx.res, 200, csv, 'text/csv; charset=utf-8', {
        'Content-Disposition': 'attachment; filename="horrorgeticon-timeline.csv"',
      });
      return Symbol.for('handled');
    }, { roles: ['management'] });
  },
};
