#!/usr/bin/env node
// Horrorgeticon Ops — End-to-End-Smoke-Test gegen den echten Server.
// Startet eine frische Instanz (eigener Datenordner) und prüft alle Kernabläufe.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const PORT = 18791;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'hgo-test-'));

let passed = 0, failed = 0;
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}`); }
};
const section = (s) => console.log(`\n— ${s}`);

async function api(method, p, { token, body, raw } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (raw) return { status: res.status, text };
  let json = null;
  try { json = JSON.parse(text); } catch { /* csv o. ä. */ }
  return { status: res.status, json, text };
}

function startServer(extraArgs = []) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server/main.js'), '--demo', '--port', String(PORT), '--data', DATA, ...extraArgs], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.env.DEBUG && console.error('[srv]', String(d)));
  return child;
}

async function waitUp(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return true; } catch { /* noch nicht oben */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let server = startServer();
try {
  ok(await waitUp(), 'Server startet');

  section('Auth & Rollen');
  const mgmt = (await api('POST', '/api/auth/login', { body: { code: 'DR-0001', pin: '4711' } })).json;
  ok(mgmt?.token && mgmt.role === 'management', 'Management-Login (DR-0001)');
  const lead = (await api('POST', '/api/auth/login', { body: { code: 'MT-0301', pin: '1234', role: 'lead' } })).json;
  ok(lead?.token && lead.role === 'lead', 'Lead-Login (MT-0301)');
  const actor = (await api('POST', '/api/auth/login', { body: { code: 'LK-0427', pin: '1234' } })).json;
  ok(actor?.token, 'Actor-Login (LK-0427)');
  const cat = (await api('POST', '/api/auth/login', { body: { code: 'SB-0901', pin: '1234' } })).json;
  ok(cat?.token && cat.roles.includes('catering'), 'Catering-Login (SB-0901)');
  const wrong = await api('POST', '/api/auth/login', { body: { code: 'DR-0001', pin: '0000' } });
  ok(wrong.status === 401, 'Falsche PIN wird abgewiesen');
  const noAuth = await api('GET', '/api/people');
  ok(noAuth.status === 401, 'Ohne Token kein Zugriff');
  const forb = await api('GET', '/api/db/collections', { token: actor.token });
  ok(forb.status === 403, 'Actor darf nicht in die DB-Pflege');

  section('Teilnehmerverwaltung & Verknüpfung');
  const people = (await api('GET', '/api/people', { token: mgmt.token })).json;
  ok(Array.isArray(people) && people.length >= 50, `Personenliste (${people?.length})`);
  ok(!JSON.stringify(people).includes('"pin"'), 'PIN-Hashes werden nie ausgeliefert');
  const neu = (await api('POST', '/api/people', { token: mgmt.token, body: { name: 'Test Person', roles: ['actor'], ort: 'Nebelbach' } })).json;
  ok(neu?.id, 'Person anlegen');
  const upd = (await api('PATCH', `/api/people/${neu.id}`, { token: mgmt.token, body: { notizen: 'Testnotiz' } })).json;
  ok(upd?.notizen === 'Testnotiz', 'Person bearbeiten');

  // Selbstregistrierung + Verknüpfung per Code
  const reg = (await api('POST', '/api/auth/register', { body: { name: 'Selbst Angelegt', pin: '9999', ort: 'Rabenstein' } })).json;
  ok(reg?.token && reg.person.selfCreated, 'Selbstregistrierung (eigenes Profil)');
  const lc = (await api('POST', `/api/people/${neu.id}/linkcode`, { token: mgmt.token })).json;
  ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(lc?.code || ''), `Verknüpfungscode erzeugt (${lc?.code})`);
  const linked = (await api('POST', '/api/auth/link', { token: reg.token, body: { code: lc.code } })).json;
  ok(linked?.person?.id === neu.id && linked.person.linked, 'Profil ↔ Verwaltung verknüpft');
  const meAfter = (await api('GET', '/api/auth/me', { token: reg.token })).json;
  ok(meAfter?.person?.id === neu.id, 'Sitzung läuft nach Verknüpfung auf dem Verwaltungs-Datensatz');
  const loginNew = (await api('POST', '/api/auth/login', { body: { code: neu.code, pin: '9999' } })).json;
  ok(loginNew?.token, 'Login mit übernommener PIN auf verknüpftem Datensatz');

  section('Mazes & Zuteilung');
  const mazes = (await api('GET', '/api/mazes', { token: mgmt.token })).json;
  ok(mazes?.length === 5, `5 Mazes (${mazes?.map((m) => m.name).join(', ')})`);
  const circus = mazes.find((m) => m.name === 'THE CIRCUS');
  const detail = (await api('GET', `/api/mazes/${circus.id}`, { token: mgmt.token })).json;
  ok(detail.positions.length === 8, `THE CIRCUS hat 8 Positionen (${detail.positions.length})`);
  const c6 = detail.positions.find((p) => p.code === 'C6');
  ok(c6 && !c6.assignedPersonId, 'C6 ist offen (Pavel fehlt)');
  const issues = (await api('GET', '/api/assignments/issues', { token: mgmt.token })).json;
  ok(issues.open.length >= 3, `Offene Positionen erkannt (${issues.open.length})`);
  const asg = (await api('POST', `/api/positions/${c6.id}/assign`, { token: lead.token, body: { personId: linked.person.id } })).json;
  ok(asg.assignedPersonId === linked.person.id, 'Lead besetzt C6 mit verknüpfter Person');

  section('Live-Tracking');
  const ci = (await api('POST', '/api/live/checkin', { token: loginNew.token, body: { battery: 88 } })).json;
  ok(ci.state === 'in', 'Check-in');
  const hb = (await api('POST', '/api/live/heartbeat', { token: loginNew.token, body: { battery: 87 } })).json;
  ok(hb.checkedIn === true && hb.status === 'aktiv', 'Heartbeat hält Tracking frisch');
  const conf = (await api('POST', '/api/live/confirm-position', { token: loginNew.token })).json;
  ok(conf.position === 'C6', 'Position bestätigt (C6)');
  const ov = (await api('GET', '/api/live/overview', { token: mgmt.token })).json;
  ok(ov.kpi.anwesend > 40 && ov.mazes.length === 5, `Lagebild: ${ov.kpi.anwesend}/${ov.kpi.crewGesamt} anwesend`);
  const row = ov.people.find((p) => p.id === linked.person.id);
  ok(row?.status === 'aktiv' && row.position === 'C6', 'Verknüpfte Person erscheint korrekt im Tracking');

  section('Pausen & Springer');
  const br = (await api('POST', '/api/breaks/request', { token: loginNew.token, body: { note: 'Kurz durchatmen' } })).json;
  ok(br.status === 'offen', 'Pausen-Anfrage gestellt');
  const springer = (await api('GET', '/api/breaks/springer', { token: lead.token })).json;
  ok(Array.isArray(springer), `Springer-Vorschläge (${springer.length})`);
  const apr = (await api('POST', `/api/breaks/${br.id}/approve`, { token: lead.token, body: {} })).json;
  ok(apr.status === 'läuft', 'Pause freigegeben → läuft');
  const ovP = (await api('GET', '/api/live/overview', { token: mgmt.token })).json;
  ok(ovP.people.find((p) => p.id === linked.person.id)?.status === 'pause', 'Tracking zeigt Pause');
  const end = (await api('POST', `/api/breaks/${br.id}/end`, { token: loginNew.token })).json;
  ok(end.status === 'beendet', 'Pause beendet');

  section('Meldungen & Alarm');
  const inc = (await api('POST', '/api/incidents', { token: loginNew.token, body: { kind: 'technik', text: 'Lampe flackert auf Position' } })).json;
  ok(inc.status === 'offen' && inc.ort.includes('C6'), 'Meldung mit automatischer Position');
  const ack = (await api('PATCH', `/api/incidents/${inc.id}`, { token: lead.token, body: { status: 'in_arbeit', assignee: lead.person.id } })).json;
  ok(ack.status === 'in_arbeit' && ack.reactionSec != null, 'Meldung übernommen (Reaktionszeit erfasst)');
  const done = (await api('PATCH', `/api/incidents/${inc.id}`, { token: mgmt.token, body: { status: 'erledigt' } })).json;
  ok(done.status === 'erledigt', 'Meldung erledigt');
  const stats = (await api('GET', '/api/incidents/stats', { token: mgmt.token })).json;
  ok(stats.gesamt >= 9, `Meldungs-Statistik (${stats.gesamt} gesamt, Ø ${stats.mittlereReaktionMin} min)`);

  section('Durchsagen & Lesebestätigung');
  const ann = (await api('POST', '/api/announcements', { token: mgmt.token, body: { text: 'Testdurchsage an alle', level: 'wichtig' } })).json;
  ok(ann.id, 'Durchsage gesendet');
  const annNotfall = (await api('POST', '/api/announcements', {
    token: lead.token,
    body: { text: 'Show stoppen, Position halten.', level: 'notfall', scope: { type: 'maze', mazeId: circus.id } },
  })).json;
  ok(annNotfall.requiresAck && Array.isArray(annNotfall.audience), 'Notfall-Warnung an Maze (mit Empfängerliste)');
  await api('POST', `/api/announcements/${annNotfall.id}/read`, { token: actor.token });
  const reads = (await api('GET', `/api/announcements/${annNotfall.id}/reads`, { token: lead.token })).json;
  ok(reads.gelesen.length >= 1, `Lesebestätigungen (${reads.gelesen.length} gelesen, ${reads.offen.length} offen)`);
  const myAnns = (await api('GET', '/api/announcements?mine=1', { token: actor.token })).json;
  ok(myAnns.some((a) => a.id === annNotfall.id), 'Actor sieht die Maze-Warnung');

  section('Chat');
  const chans = (await api('GET', '/api/chat/channels', { token: actor.token })).json;
  ok(chans.some((c) => c.name === '#crew') && chans.some((c) => c.type === 'maze'), `Kanäle für Actor (${chans.length})`);
  const leadChans = (await api('GET', '/api/chat/channels', { token: lead.token })).json;
  ok(leadChans.some((c) => c.name === '#leitstand'), 'Lead sieht #leitstand');
  ok(!chans.some((c) => c.name === '#leitstand'), 'Actor sieht #leitstand NICHT');
  const sent = (await api('POST', '/api/chat/ch_crew/messages', { token: actor.token, body: { text: 'Hallo Crew! 🎃' } })).json;
  ok(sent.id, 'Nachricht gesendet');
  const msgs = (await api('GET', '/api/chat/ch_crew/messages', { token: mgmt.token })).json;
  ok(msgs.some((m) => m.id === sent.id), 'Nachricht kommt an');
  const dm = (await api('POST', '/api/chat/dm', { token: actor.token, body: { personId: lead.person.id } })).json;
  ok(dm.id, 'DM-Kanal erstellt');

  section('Catering (Essens-/Getränkemarken)');
  const wallet = (await api('GET', '/api/catering/wallet', { token: actor.token })).json;
  ok(wallet.wallet.drinks.total >= 3 && wallet.code.qr.startsWith('HGO1|'), `Wallet + Einmal-Code (läuft ${wallet.code.secondsLeft}s)`);
  const stations = (await api('GET', '/api/catering/stations', { token: cat.token })).json;
  const nord = stations.find((s) => s.name === 'Station Nord');
  ok(nord?.online, 'Station Nord online');
  const check = (await api('POST', '/api/catering/check', { token: cat.token, body: { qr: wallet.code.qr } })).json;
  ok(check.ok && check.person.name === 'Lena Krause', 'Code-Prüfung an der Station');
  const redeem = (await api('POST', '/api/catering/redeem', { token: cat.token, body: { qr: wallet.code.qr, stationId: nord.id, drinks: 1, meals: 0 } })).json;
  ok(redeem.ok && redeem.wallet.drinks.used === wallet.wallet.drinks.used + 1, 'Getränkemarke eingelöst');
  const replay = await api('POST', '/api/catering/redeem', { token: cat.token, body: { qr: wallet.code.qr, stationId: nord.id, drinks: 1, meals: 0 } });
  ok(replay.status === 400 && replay.json.error.includes('bereits benutzt'), 'Doppelte Einlösung wird abgelehnt (Einmal-Code)');
  const quota = (await api('POST', '/api/catering/quota', { token: mgmt.token, body: { scope: { type: 'person', personId: actor.person.id }, drinks: 1, meals: 0 } })).json;
  ok(quota.ok, 'Kontingent aufladen');
  const closing = (await api('GET', '/api/catering/closing', { token: cat.token })).json;
  ok(closing.einloesungen > 0, `Tagesabschluss (${closing.einloesungen} Einlösungen, ${closing.drinks} Getränke)`);

  section('Fahrgruppen (Matching + Nachricht)');
  const match = (await api('POST', '/api/carpool/match', { token: mgmt.token })).json;
  ok(match.groups.length >= 2, `Matching: ${match.groups.length} Gruppen, ${match.unmatched.length} offen`);
  const bestGroup = match.groups.find((g) => g.best);
  ok(!!bestGroup, `Beste Option markiert (${bestGroup?.driverName} ab ${bestGroup?.ort})`);
  const nebelbach = match.groups.find((g) => g.ort === 'Nebelbach');
  ok(nebelbach && nebelbach.riderNames.includes('Lena Krause'), 'Lena matcht zu Marco (gleicher Ort)');
  const sentG = (await api('POST', `/api/carpool/groups/${nebelbach.id}/send`, { token: mgmt.token, body: { template: 'vorschlag' } })).json;
  ok(sentG.status === 'angefragt' && sentG.channelId, 'Vorschlag mit vorgefertigter Nachricht gesendet');
  const gMsgs = (await api('GET', `/api/chat/${sentG.channelId}/messages`, { token: actor.token })).json;
  ok(gMsgs.length >= 1 && gMsgs[0].text.includes('Fahrgruppen-Vorschlag'), 'Gruppe hat die Nachricht im Chat');
  const resp = (await api('POST', `/api/carpool/groups/${nebelbach.id}/respond`, { token: actor.token, body: { accept: true } })).json;
  ok(resp.responses[actor.person.id] === 'zugesagt', 'Mitfahrerin sagt zu');

  section('CSV-Import/-Export');
  const csvOut = await api('GET', '/api/csv/export/personen', { token: mgmt.token, raw: true });
  ok(csvOut.status === 200 && csvOut.text.includes('Lena Krause'), 'Personen-Export (CSV)');
  const csvText = 'Name;Rolle;Status;Ort;Maze;Position\nImport Tester;Scare Actor;aktiv;Nebelbach;THE CIRCUS;C6\nLena Krause;Scare Actor;aktiv;Nebelbach;;';
  const dry = (await api('POST', '/api/csv/import/personen', { token: mgmt.token, body: { text: csvText, dryRun: true } })).json;
  ok(dry.dryRun && dry.neu.length === 1 && dry.aktualisiert.length === 1, `Import-Vorschau (1 neu, 1 aktualisiert)`);
  const apply = (await api('POST', '/api/csv/import/personen', { token: mgmt.token, body: { text: csvText, dryRun: false } })).json;
  ok(apply.angewendet === 2, 'Import angewendet');
  const after = (await api('GET', '/api/people?q=Import Tester', { token: mgmt.token })).json;
  ok(after.length === 1, 'Importierte Person ist da (und auf C6 zugeteilt)');

  section('Universal-Import (Excel · HTML · TSV · E-Mail · Freitext)');
  // Excel-Copy/Paste (Tab-getrennt)
  const tsv = 'Name\tRolle\tOrt\nUni Tsv\tScare Actor\tAachen\nUni Tsv Zwei\tSpringer\tDüren';
  const tsvDry = (await api('POST', '/api/import/personen', { token: mgmt.token, body: { text: tsv, dryRun: true } })).json;
  ok(tsvDry.dryRun && tsvDry.format === 'delimited' && tsvDry.neu.length === 2, `TSV/Excel-Paste erkannt (${tsvDry.format}, ${tsvDry.neu.length} neu)`);
  // HTML-Tabelle (aus Webseite/E-Mail kopiert)
  const html = '<table><tr><th>Name</th><th>Kontakt</th></tr><tr><td>Uni Html</td><td>html@example.com</td></tr></table>';
  const htmlDry = (await api('POST', '/api/import/personen', { token: mgmt.token, body: { text: html, dryRun: true } })).json;
  ok(htmlDry.format === 'html' && htmlDry.neu.length === 1, `HTML-Tabelle erkannt (${htmlDry.format})`);
  // Freitext-Namensliste (keine Spaltenüberschriften → Freitext-Fallback)
  const freitext = 'Uni Freitext\nNoch Einer <einer@example.com>\nDrei Drei 0151 1234567';
  const ftDry = (await api('POST', '/api/import/personen', { token: mgmt.token, body: { text: freitext, dryRun: true } })).json;
  ok(ftDry.format === 'freitext' && ftDry.neu.length === 3, `Freitext erkannt & Namen extrahiert (${ftDry.neu.length})`);
  // Echte Excel-Datei (.xlsx) als base64 — vollständig ohne Fremdbibliothek geparst
  const xlsxB64 = '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';
  const xlsxApply = (await api('POST', '/api/import/personen', { token: mgmt.token, body: { base64: xlsxB64, filename: 'crew.xlsx', dryRun: false } })).json;
  ok(xlsxApply.format === 'xlsx' && xlsxApply.angewendet >= 1, `Echte Excel-Datei (.xlsx) geparst & angewendet (${xlsxApply.angewendet})`);
  const xena = (await api('GET', '/api/people?q=Xena Volt', { token: mgmt.token })).json;
  ok(xena.length === 1 && (xena[0].roles || []).includes('actor'), 'Person aus Excel-Datei angelegt (Xena Volt)');
  // Altes .xls-Binärformat → klar abgelehnt
  const xls = await api('POST', '/api/import/personen', { token: mgmt.token, body: { base64: 'AAAA', filename: 'alt.xls', dryRun: true } });
  ok(xls.status === 400, 'Altes .xls-Format wird mit Hinweis abgelehnt (400)');
  // Actor darf nicht importieren
  const impForbidden = await api('POST', '/api/import/personen', { token: actor.token, body: { text: 'Name\nNiemand', dryRun: true } });
  ok(impForbidden.status === 403, 'Actor darf nicht importieren (403)');

  section('Zuteilungs-Import & Vorlagen-Downloads');
  // Vorlagen herunterladbar (Excel-taugliche CSV mit Kopfzeile)
  const tplP = (await api('GET', '/api/import/template/personen', { token: mgmt.token })).text;
  ok(tplP.includes('Name') && tplP.includes('Maze') && tplP.includes('Position'), 'Vorlage „Personen" herunterladbar (CSV mit Kopfzeile)');
  const tplZ = (await api('GET', '/api/import/template/zuteilung', { token: mgmt.token })).text;
  ok(tplZ.includes('Maze') && tplZ.includes('Position') && tplZ.includes('Code'), 'Vorlage „Zuteilung" herunterladbar');
  // Zuteilung importieren: bestehende Person (Import Tester, aktiv) auf eine Position in THE CIRCUS
  const zutText = 'Maze;Position;Person;Code\nTHE CIRCUS;C7;Import Tester;\nUnbekanntesMaze;X1;Import Tester;\nTHE CIRCUS;C2;Gibtsnicht Person;';
  const zutDry = (await api('POST', '/api/import/zuteilung', { token: mgmt.token, body: { text: zutText, dryRun: true } })).json;
  ok(zutDry.dryRun && zutDry.zugeordnet.length === 1 && zutDry.fehler.length === 2,
    `Zuteilungs-Vorschau (${zutDry.zugeordnet.length} zugeordnet, ${zutDry.fehler.length} Fehler)`);
  const zutApply = (await api('POST', '/api/import/zuteilung', { token: mgmt.token, body: { text: zutText, dryRun: false } })).json;
  ok(zutApply.angewendet === 1, `Zuteilung angewendet (${zutApply.angewendet})`);
  const circusDetail = (await api('GET', `/api/mazes/${circus.id}`, { token: mgmt.token })).json;
  const c7 = circusDetail.positions.find((p) => p.code === 'C7');
  ok(c7?.person?.name === 'Import Tester', 'Position C7 trägt jetzt die importierte Zuteilung');
  // Fehlende Pflichtspalten → klare Ablehnung
  const zutBad = await api('POST', '/api/import/zuteilung', { token: mgmt.token, body: { text: 'Name\nNur Name', dryRun: true } });
  ok(zutBad.status === 400, 'Zuteilungs-Import ohne Maze/Position abgelehnt (400)');
  // Actor darf nicht zuteilen-importieren? Lead schon (wie /assign) — Actor nicht
  const zutActor = await api('POST', '/api/import/zuteilung', { token: actor.token, body: { text: zutText, dryRun: true } });
  ok(zutActor.status === 403, 'Actor darf keine Zuteilung importieren (403)');

  section('Vor-Ort-Start: Netz-Infos & Beitritts-QR');
  const net = (await api('GET', '/api/net/info')).json; // offen, ohne Login
  ok(net && typeof net.port === 'number' && Array.isArray(net.urls), 'Netz-Infos offen abrufbar (ohne Login)');
  ok(typeof net.joinUrl === 'string' && net.joinUrl.startsWith('http'), `Beitritts-URL vorhanden (${net.joinUrl})`);
  ok(typeof net.qrSvg === 'string' && net.qrSvg.includes('<svg') && net.qrSvg.includes('</svg>'), 'Beitritts-QR als SVG erzeugt');

  section('Live-Lagestatus (Banner für alle)');
  const lageSet = (await api('POST', '/api/settings/lage', { token: mgmt.token, body: { text: 'Wetter-Stopp — bleibt in Position.', level: 'stop', nextInfoAt: '18:30' } })).json;
  ok(lageSet.lage && lageSet.lage.text.includes('Wetter') && lageSet.lage.nextInfoAt === '18:30', 'Lagestatus gesetzt (mit nächste-Info-Zeit)');
  const settActor = (await api('GET', '/api/settings', { token: actor.token })).json;
  ok(settActor.lage && settActor.lage.level === 'stop', 'Lagestatus für Crew (Actor) in /settings sichtbar');
  const lageBadTime = await api('POST', '/api/settings/lage', { token: mgmt.token, body: { text: 'x', nextInfoAt: '25:99' } });
  ok(lageBadTime.status === 400, 'Ungültige „nächste Info"-Zeit abgelehnt (400)');
  const leadLage = await api('POST', '/api/settings/lage', { token: lead.token, body: { text: 'Lead: gleich geht es weiter.' } });
  ok(leadLage.status === 200, 'Lead darf Lagestatus setzen');
  const actorLage = await api('POST', '/api/settings/lage', { token: actor.token, body: { text: 'darf nicht' } });
  ok(actorLage.status === 403, 'Actor darf keinen Lagestatus setzen (403)');
  const cleared = (await api('POST', '/api/settings/lage', { token: mgmt.token, body: { clear: true } })).json;
  ok(cleared.lage === null, 'Lagestatus aufgehoben (Normalbetrieb)');

  section('Notfall-/Fallback-Paket (Sicherheitsnetz)');
  const fb = await api('GET', '/api/reports/fallback', { token: mgmt.token });
  ok(fb.status === 200 && fb.text.includes('Notfall') && fb.text.includes('Teilnehmerliste') && fb.text.includes('Incident-Zettel'),
    'Notfall-Paket als druckfertiges HTML erzeugt');
  ok(fb.text.includes('Positions-Zuteilung') && fb.text.includes('THE CIRCUS'), 'Enthält Maze-/Positions-Zuteilung mit echten Daten');
  const fbLead = await api('GET', '/api/reports/fallback', { token: lead.token });
  ok(fbLead.status === 200, 'Lead darf das Notfall-Paket erzeugen');
  const fbActor = await api('GET', '/api/reports/fallback', { token: actor.token });
  ok(fbActor.status === 403, 'Actor darf das Notfall-Paket nicht erzeugen (403)');

  section('DB-Pflege & Audit');
  const cols = (await api('GET', '/api/db/collections', { token: mgmt.token })).json;
  ok(cols.some((c) => c.name === 'people') && cols.some((c) => c.protected), `Collections (${cols.length})`);
  const rec = (await api('GET', `/api/db/col/people/${neu.id}`, { token: mgmt.token })).json;
  ok(rec.pin === '〈gesetzt〉', 'PIN im Editor maskiert');
  const edited = (await api('PUT', `/api/db/col/people/${neu.id}`, { token: mgmt.token, body: { value: { ...rec, notizen: 'Von Hand korrigiert' } } })).json;
  ok(edited.ok, 'Datensatz manuell bearbeitet');
  const loginStill = (await api('POST', '/api/auth/login', { body: { code: neu.code, pin: '9999' } })).json;
  ok(loginStill?.token, 'PIN-Hash hat die Hand-Korrektur überlebt');
  const audit = (await api('GET', '/api/db/audit', { token: mgmt.token })).json;
  ok(audit.length >= 1 && audit[0].byName === 'Daniel Roth', 'Audit-Trail schreibt mit');
  const undo = (await api('POST', '/api/db/undo', { token: mgmt.token })).json;
  ok(undo.ok, 'Letzte Änderung rückgängig');
  const validate = (await api('GET', '/api/db/validate', { token: mgmt.token })).json;
  ok(validate.ok === true, `Konsistenz-Prüfung ohne Befund`);

  section('Backups & Rebuild');
  const created = (await api('POST', '/api/backups/create', { token: mgmt.token })).json;
  ok(created.ok, 'Backup erstellt');
  const list = (await api('GET', '/api/backups', { token: mgmt.token })).json;
  ok(list.backups.length >= 1 && list.integrity.seq > 0, `Backups: ${list.backups.length}, seq ${list.integrity.seq}`);
  const rebuild = (await api('POST', '/api/backups/rebuild', { token: mgmt.token })).json;
  ok(rebuild.ok && rebuild.replayed > 0, `Rebuild aus Journal (${rebuild.replayed} Einträge)`);
  const stillThere = (await api('GET', '/api/people?q=Import Tester', { token: mgmt.token })).json;
  ok(stillThere.length === 1, 'Daten nach Rebuild unversehrt');
  const restore = (await api('POST', '/api/backups/restore', { token: mgmt.token, body: { file: list.backups[0].file } })).json;
  ok(restore.ok, 'Backup-Restore (mit Vorab-Sicherung)');

  section('Module: Circuit-Breaker & Hot-Reload');
  const mods = (await api('GET', '/api/modules', { token: mgmt.token })).json;
  ok(mods.length >= 15, `${mods.length} Module registriert`);
  await api('POST', '/api/modules/carpool/disable', { token: mgmt.token });
  const blocked = await api('GET', '/api/carpool/state', { token: actor.token });
  ok(blocked.status === 503 && blocked.json.moduleDisabled, 'Deaktiviertes Modul antwortet 503 — Rest läuft');
  const othersOk = await api('GET', '/api/live/overview', { token: mgmt.token });
  ok(othersOk.status === 200, 'Andere Module unbeeinträchtigt');
  await api('POST', '/api/modules/carpool/enable', { token: mgmt.token });
  const unblocked = await api('GET', '/api/carpool/state', { token: actor.token });
  ok(unblocked.status === 200, 'Modul wieder aktiv');
  const reload = (await api('POST', '/api/modules/catering/reload', { token: mgmt.token })).json;
  ok(reload.enabled !== false, 'Hot-Reload eines Moduls');
  const wallet2 = (await api('GET', '/api/catering/wallet', { token: actor.token })).json;
  ok(wallet2.wallet, 'Modul funktioniert nach Reload');

  section('Event-Phasen (Lifecycle)');
  const set0 = (await api('GET', '/api/settings', { token: mgmt.token })).json;
  ok(set0.phase === 'live', `Demo startet in Phase „live“ (${set0.phase})`);
  const ph1 = (await api('POST', '/api/settings/phase', { token: mgmt.token, body: { phase: 'abschluss' } })).json;
  ok(ph1.phase === 'abschluss', 'Phasenwechsel → abschluss');
  const phFeed = (await api('GET', '/api/feed?limit=10', { token: mgmt.token })).json;
  ok(phFeed.some((f) => f.text.includes('Event-Phase')), 'Phasenwechsel im Feed dokumentiert');
  const phAnns = (await api('GET', '/api/announcements', { token: mgmt.token })).json;
  ok(phAnns.some((a) => a.text.includes('Tagesabschluss')), 'Automatische Durchsage beim Abschluss');
  const phForb = await api('POST', '/api/settings/phase', { token: actor.token, body: { phase: 'live' } });
  ok(phForb.status === 403, 'Nur Management wechselt Phasen');
  await api('POST', '/api/settings/phase', { token: mgmt.token, body: { phase: 'live' } });

  section('Actor-Status & Verspätung');
  const stOk = (await api('POST', '/api/live/status', { token: actor.token, body: { status: 'maske' } })).json;
  ok(stOk.actorStatus === 'maske', 'Detail-Status setzen (Maske)');
  const stPos = (await api('POST', '/api/live/status', { token: actor.token, body: { status: 'position' } })).json;
  ok(stPos.actorStatus === 'position', 'Status „Auf Position“');
  const late = (await api('POST', '/api/live/late', { token: actor.token, body: { etaMin: 15, reason: 'Stau' } })).json;
  ok(late.ok, 'Verspätung melden');
  const ovLate = (await api('GET', '/api/live/overview', { token: mgmt.token })).json;
  const lateRow = ovLate.people.find((p) => p.id === actor.person.id);
  ok(lateRow?.late?.etaMin === 15, 'Verspätung erscheint im Lagebild');
  const lateFeed = (await api('GET', '/api/feed?limit=8', { token: mgmt.token })).json;
  ok(lateFeed.some((f) => f.text.includes('verspätet sich')), 'Verspätung im Feed');
  await api('POST', '/api/live/status', { token: actor.token, body: { status: 'da' } });
  const ovClear = (await api('GET', '/api/live/overview', { token: mgmt.token })).json;
  ok(!ovClear.people.find((p) => p.id === actor.person.id)?.late, 'Status „da“ löscht die Verspätung');

  section('Aufgaben & Dispatch');
  const seedTasks = (await api('GET', '/api/tasks?status=aktiv', { token: mgmt.token })).json;
  ok(seedTasks.length >= 6 && seedTasks.some((t) => t.overdue), `Demo-Aufgaben (${seedTasks.length} aktiv, überfällige markiert)`);
  const newTask = (await api('POST', '/api/tasks', {
    token: mgmt.token,
    body: { title: 'Testaufgabe: Kabel sichern', mazeId: circus.id, prio: 'hoch', critical: true, deadline: '23:30' },
  })).json;
  ok(newTask.id && newTask.status === 'offen', 'Aufgabe erstellt (kritisch, mit Frist)');
  const disp = (await api('POST', `/api/tasks/${newTask.id}/assign`, { token: mgmt.token, body: { assigneeId: actor.person.id } })).json;
  ok(disp.assigneeId === actor.person.id && disp.status === 'angenommen', 'Dispatch an Person');
  const fremd = await api('PATCH', `/api/tasks/${newTask.id}`, { token: loginNew.token, body: { status: 'erledigt' } });
  ok(fremd.status === 400, 'Fremde dürfen zugewiesene Aufgaben nicht patchen');
  const blockNoNote = await api('PATCH', `/api/tasks/${newTask.id}`, { token: actor.token, body: { status: 'blockiert' } });
  ok(blockNoNote.status === 400, 'Blockiert ohne Begründung wird abgelehnt');
  const blockedT = (await api('PATCH', `/api/tasks/${newTask.id}`, { token: actor.token, body: { status: 'blockiert', note: 'Kein Werkzeug da' } })).json;
  ok(blockedT.status === 'blockiert', 'Actor meldet Blocker mit Notiz');
  const blockFeed = (await api('GET', '/api/feed?limit=6', { token: mgmt.token })).json;
  ok(blockFeed.some((f) => f.text.includes('blockiert')), 'Kritischer Blocker im Feed');
  const doneT = (await api('PATCH', `/api/tasks/${newTask.id}`, { token: actor.token, body: { status: 'erledigt' } })).json;
  ok(doneT.status === 'erledigt', 'Aufgabe erledigt');
  const confirmed = (await api('PATCH', `/api/tasks/${newTask.id}`, { token: lead.token, body: { status: 'bestätigt' } })).json;
  ok(confirmed.status === 'bestätigt' && confirmed.history.length >= 4, 'Lead nimmt ab (Verlauf protokolliert)');
  const board = (await api('GET', '/api/tasks/board', { token: mgmt.token })).json;
  ok(board.aktiv >= 6 && board.jeMaze.length === 5, `Board-Aggregat (${board.aktiv} aktiv, ${board.kritischOffen} kritisch)`);

  section('Checklisten & Rundgänge');
  const ready0 = (await api('GET', '/api/checklists/readiness', { token: mgmt.token })).json;
  const circusReady = ready0.find((r) => r.maze === 'THE CIRCUS');
  ok(circusReady && !circusReady.bereit && circusReady.pflichtOffen === 1, 'THE CIRCUS nicht bereit (1 Pflichtpunkt offen — Demo)');
  ok(ready0.filter((r) => r.bereit).length === 4, 'Übrige 4 Mazes bereit');
  const cls = (await api('GET', `/api/checklists?maze=${circus.id}`, { token: lead.token })).json;
  const sicherheit = cls.find((c) => c.type === 'sicherheit');
  const openItem = sicherheit.items.find((i) => i.mandatory && !i.done);
  ok(!!openItem, `Offener Pflichtpunkt gefunden („${openItem?.text.slice(0, 30)}…“)`);
  const toggled = (await api('POST', `/api/checklists/${sicherheit.id}/toggle`, { token: lead.token, body: { itemId: openItem.id } })).json;
  ok(toggled.complete && toggled.mandatoryOpen === 0, 'Pflichtpunkt abgehakt → Rundgang abgeschlossen');
  const clFeed = (await api('GET', '/api/feed?limit=6', { token: mgmt.token })).json;
  ok(clFeed.some((f) => f.text.includes('Rundgang') && f.text.includes('abgeschlossen')), 'Abschluss im Feed');
  const ready1 = (await api('GET', '/api/checklists/readiness', { token: mgmt.token })).json;
  ok(ready1.every((r) => r.bereit), 'Readiness: alle Mazes bereit ✓');
  const tpl = (await api('GET', '/api/checklists/templates', { token: lead.token })).json;
  ok(tpl.length === 6 && tpl.every((t) => t.items.length >= 5), 'Eingebaute Vorlagen (6 Typen)');
  const newCl = (await api('POST', '/api/checklists', { token: mgmt.token, body: { type: 'preshow', mazeId: circus.id } })).json;
  ok(newCl.items.length >= 5 && newCl.mandatoryOpen > 0, 'Rundgang aus Vorlage angelegt');
  const actorCl = await api('POST', `/api/checklists/${newCl.id}/toggle`, { token: actor.token, body: { itemId: 'i1' } });
  ok(actorCl.status === 403, 'Actors haken keine Rundgänge ab (Lead/Mgmt)');

  section('SLA, Entscheidungslog, Übergabe');
  const incs = (await api('GET', '/api/incidents?status=offen', { token: mgmt.token })).json;
  const hot = incs.find((i) => i.prio === 'hoch');
  ok(hot && hot.overdue === true && hot.slaMin === 5, `Hoch-Prio offen seit >5 min → SLA überfällig (${hot?.slaLeftMin} min)`);
  const dec = (await api('POST', '/api/feed/decision', { token: mgmt.token, body: { text: 'Welle 42 wird 5 min gestaut' } })).json;
  ok(dec.kind === 'entscheidung', 'Entscheidung dokumentiert');
  const decFeed = (await api('GET', '/api/feed?kind=entscheidung', { token: mgmt.token })).json;
  ok(decFeed.length >= 2 && decFeed[0].text.includes('Welle 42'), `Entscheidungslog filterbar (${decFeed.length} Einträge)`);
  const decForb = await api('POST', '/api/feed/decision', { token: actor.token, body: { text: 'x' } });
  ok(decForb.status === 403, 'Entscheidungslog nur Lead/Management');
  const handover = (await api('GET', `/api/reports/handover?maze=${circus.id}`, { token: lead.token })).json;
  ok(handover.maze === 'THE CIRCUS' && Array.isArray(handover.offeneAufgaben) && handover.checklisten.length >= 3,
    `Übergabeprotokoll THE CIRCUS (${handover.offeneAufgaben.length} Aufgaben, ${handover.offeneVorfaelle.length} Vorfälle)`);
  ok(handover.entscheidungen.length >= 1, 'Entscheidungen im Übergabeprotokoll');

  section('Berichte, Zeitplan, Einstellungen, Feed');
  const rep = (await api('GET', '/api/reports/overview', { token: mgmt.token })).json;
  ok(rep.anwesenheit.quote > 0 && rep.catering.einloesungen > 0, `Bericht: ${rep.anwesenheit.quote}% Anwesenheit`);
  const plan = (await api('GET', '/api/schedule/breakplan', { token: lead.token })).json;
  ok(plan.plan.length === 5, 'Pausenplan-Vorschlag je Maze');
  const set = (await api('PATCH', '/api/settings', { token: mgmt.token, body: { nightLabel: 'Horrornacht · Sa 01.11.' } })).json;
  ok(set.nightLabel === 'Horrornacht · Sa 01.11.' && set.secret === undefined, 'Einstellungen (Secret bleibt intern)');
  const feed = (await api('GET', '/api/feed', { token: actor.token })).json;
  ok(feed.length > 5, `Live-Feed (${feed.length} Einträge)`);

  section('Kids Day');
  const kdConf = (await api('GET', '/api/kidsday/config', { token: mgmt.token })).json;
  ok(kdConf && kdConf.enabled === true && kdConf.startTime === '10:00' && kdConf.endTime === '16:00', 'Seeded Kids-Day-Config geladen (enabled, Zeitfenster)');
  ok(kdConf.mazeConfigs.length === 5 && kdConf.ageGroups.length === 3, 'Config hat 5 Maze-Configs und 3 Altersgruppen');

  const kdPatch = (await api('PATCH', '/api/kidsday/config', { token: mgmt.token, body: { endTime: '17:00' } })).json;
  ok(kdPatch.endTime === '17:00', 'PATCH /api/kidsday/config aktualisiert Zeitfenster');

  const kdForbPatch = await api('PATCH', '/api/kidsday/config', { token: actor.token, body: { endTime: '18:00' } });
  ok(kdForbPatch.status === 403, 'Actor darf Config nicht aendern (403)');

  // Deaktivieren und wieder aktivieren
  const kdDeact = (await api('POST', '/api/kidsday/deactivate', { token: mgmt.token })).json;
  ok(kdDeact.ok && kdDeact.config.enabled === false, 'Kids Day deaktiviert');
  const settingsAfterDeact = (await api('GET', '/api/settings', { token: mgmt.token })).json;
  ok(settingsAfterDeact.kidsDay && settingsAfterDeact.kidsDay.enabled === false, 'Settings spiegelt Deaktivierung');

  const kdAct = (await api('POST', '/api/kidsday/activate', { token: mgmt.token })).json;
  ok(kdAct.ok && kdAct.config.enabled === true, 'Kids Day aktiviert');
  const settingsAfterAct = (await api('GET', '/api/settings', { token: mgmt.token })).json;
  ok(settingsAfterAct.kidsDay && settingsAfterAct.kidsDay.enabled === true, 'Settings spiegelt Aktivierung');

  // Feed-Eintrag zur Aktivierung
  const kdFeed = (await api('GET', '/api/feed?limit=15', { token: mgmt.token })).json;
  ok(kdFeed.some((f) => f.text.includes('Kids Day')), 'Kids-Day-Aktivierung im Feed');

  const kdForbAct = await api('POST', '/api/kidsday/activate', { token: actor.token });
  ok(kdForbAct.status === 403, 'Actor darf Kids Day nicht aktivieren (403)');

  // Overview
  const kdOverview = (await api('GET', '/api/kidsday/overview', { token: mgmt.token })).json;
  ok(kdOverview && kdOverview.kidsDayActive === true && kdOverview.mazes.total === 5, 'Overview liefert KPIs (aktiv, 5 Mazes)');

  // Mazes mit Intensitaet
  const kdMazes = (await api('GET', '/api/kidsday/mazes', { token: mgmt.token })).json;
  ok(kdMazes.length === 5 && kdMazes.every((m) => m.kidsMode === true), 'GET /api/kidsday/mazes: 5 Mazes im Kids-Mode');
  const kdCircus = kdMazes.find((m) => m.name === 'THE CIRCUS');
  ok(kdCircus && kdCircus.intensity === 'leicht', 'THE CIRCUS-Intensitaet ist leicht');

  // Maze-Intensitaet patchen
  const kdMazePatch = (await api('PATCH', `/api/kidsday/mazes/${kdCircus.mazeId}`, { token: mgmt.token, body: { intensity: 'mittel' } })).json;
  ok(kdMazePatch.intensity === 'mittel', 'PATCH Maze-Intensitaet auf mittel');
  const kdForbMaze = await api('PATCH', `/api/kidsday/mazes/${kdCircus.mazeId}`, { token: actor.token, body: { intensity: 'aus' } });
  ok(kdForbMaze.status === 403, 'Actor darf Maze-Intensitaet nicht aendern (403)');

  // Invalid-input error paths
  const kdBadIntensity = await api('PATCH', '/api/kidsday/config', { token: mgmt.token, body: { defaultIntensity: 'extrem' } });
  ok(kdBadIntensity.status === 400, 'Ungueltige Intensitaet wird abgewiesen (400)');
  const kdBadArray = await api('PATCH', '/api/kidsday/config', { token: mgmt.token, body: { ageGroups: 'not-an-array' } });
  ok(kdBadArray.status === 400, 'Nicht-Array ageGroups wird abgewiesen (400)');
  const kdBadMazeId = await api('PATCH', '/api/kidsday/mazes/nonexistent-maze-xyz', { token: mgmt.token, body: { intensity: 'leicht' } });
  ok(kdBadMazeId.status === 404, 'Nicht existentes Maze liefert 404');

  section('DND-Modus (Nicht stören)');
  // Actor-Status steht auf 'da' (aus vorheriger Sektion), Phase ist 'live'
  // 1. Initialer Status: DND inaktiv
  const dndInit = (await api('GET', '/api/dnd/status', { token: actor.token })).json;
  ok(dndInit.active === false && dndInit.manual === false && dndInit.auto === false, 'DND initial inaktiv (kein manuell, kein auto)');

  // 2. Manuell aktivieren
  const dndEn = (await api('POST', '/api/dnd/enable', { token: actor.token })).json;
  ok(dndEn.ok === true && dndEn.active === true, 'DND manuell aktiviert');

  // 3. Status zeigt manuell aktiv
  const dndManual = (await api('GET', '/api/dnd/status', { token: actor.token })).json;
  ok(dndManual.active === true && dndManual.manual === true, 'GET /api/dnd/status zeigt manual=true');

  // 4. Manuell deaktivieren
  const dndDis = (await api('POST', '/api/dnd/disable', { token: actor.token })).json;
  ok(dndDis.ok === true, 'DND manuell deaktiviert');

  // 5. Status zeigt inaktiv
  const dndOff = (await api('GET', '/api/dnd/status', { token: actor.token })).json;
  ok(dndOff.active === false && dndOff.manual === false, 'GET /api/dnd/status zeigt inaktiv nach disable');

  // 6. Auto-DND: Status auf 'position' setzen (Phase ist 'live')
  await api('POST', '/api/live/status', { token: actor.token, body: { status: 'position' } });
  const dndAuto = (await api('GET', '/api/dnd/status', { token: actor.token })).json;
  ok(dndAuto.active === true && dndAuto.auto === true && dndAuto.manual === false, 'Auto-DND aktiv bei live+position');

  // 7. Auto-DND endet wenn Status sich aendert
  await api('POST', '/api/live/status', { token: actor.token, body: { status: 'backstage' } });
  const dndNoAuto = (await api('GET', '/api/dnd/status', { token: actor.token })).json;
  ok(dndNoAuto.active === false && dndNoAuto.auto === false, 'Auto-DND endet bei Status-Wechsel weg von position');

  // 8. Management kann fremden DND-Status abfragen
  const dndMgmt = (await api('GET', `/api/dnd/status/${actor.person.id}`, { token: mgmt.token })).json;
  ok(dndMgmt && typeof dndMgmt.active === 'boolean', 'Management kann DND-Status anderer Personen abfragen');

  // 9. Ohne Token kein Zugriff auf DND-Endpoints
  const dndNoAuth = await api('GET', '/api/dnd/status');
  ok(dndNoAuth.status === 401, 'DND-Endpoint ohne Token liefert 401');

  // 10. SSE-Filterung: info-Durchsage wird bei DND blockiert, notfall kommt durch
  // DND aktivieren fuer Actor
  await api('POST', '/api/dnd/enable', { token: actor.token });
  // SSE-Stream oeffnen und Daten sammeln
  const sseCtrl = new AbortController();
  let sseBuf = '';
  const ssePromise = (async () => {
    try {
      const sseRes = await fetch(BASE + '/api/stream?token=' + actor.token, { signal: sseCtrl.signal });
      const reader = sseRes.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        sseBuf += decoder.decode(value, { stream: true });
      }
    } catch { /* AbortError expected */ }
  })();
  await new Promise((r) => setTimeout(r, 300));
  // Info-Durchsage senden (announce.new sollte NICHT beim DND-Actor ankommen)
  await api('POST', '/api/announcements', { token: mgmt.token, body: { text: 'DND-Test-Info', level: 'info' } });
  await new Promise((r) => setTimeout(r, 400));
  // Notfall-Durchsage senden (announce.new MUSS durchkommen)
  await api('POST', '/api/announcements', { token: mgmt.token, body: { text: 'DND-Test-Notfall', level: 'notfall' } });
  await new Promise((r) => setTimeout(r, 400));
  // Stream schliessen und pruefen
  sseCtrl.abort();
  await ssePromise;
  // DND filtert announce.new und alarm Events (nicht feed.item).
  // Pruefen: announce.new mit notfall kommt durch, announce.new mit info nicht.
  // Parse SSE data lines to check event types
  const sseLines = sseBuf.split('\n').filter((l) => l.startsWith('data: '));
  const sseEvents = sseLines.map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
  const announceEvents = sseEvents.filter((e) => e.type === 'announce.new');
  const hasNotfallAnnounce = announceEvents.some((e) => e.data?.text?.includes('DND-Test-Notfall'));
  const hasInfoAnnounce = announceEvents.some((e) => e.data?.text?.includes('DND-Test-Info'));
  ok(hasNotfallAnnounce && !hasInfoAnnounce,
    'SSE-Filterung: announce.new mit Notfall kommt durch, Info-announce.new wird bei DND blockiert');

  // Cleanup: DND wieder deaktivieren, Status zuruecksetzen
  await api('POST', '/api/dnd/disable', { token: actor.token });
  await api('POST', '/api/live/status', { token: actor.token, body: { status: 'da' } });

  section('Event-Timeline-Export');
  const tlJson = (await api('GET', '/api/reports/timeline', { token: mgmt.token })).json;
  ok(Array.isArray(tlJson) && tlJson.length > 0, `Timeline JSON liefert ${tlJson.length} Eintraege`);
  const tlSample = tlJson.find((e) => e.t > 0);
  ok(tlSample && tlSample.category && tlSample.text, 'Timeline-Eintraege haben t, category, text');
  const tlSorted = tlJson.every((e, i) => i === 0 || e.t >= tlJson[i - 1].t);
  ok(tlSorted, 'Timeline ist chronologisch sortiert');
  const tlForb = await api('GET', '/api/reports/timeline', { token: actor.token });
  ok(tlForb.status === 403, 'Actor darf Timeline nicht abrufen (403)');
  const tlHtml = await api('GET', '/api/reports/timeline/export', { token: mgmt.token, raw: true });
  ok(tlHtml.status === 200 && tlHtml.text.includes('<!DOCTYPE html>'), 'Timeline HTML-Export liefert HTML-Dokument');
  ok(tlHtml.text.includes('Event-Timeline'), 'HTML-Export enthaelt Titel');
  const tlCsv = await api('GET', '/api/reports/timeline/csv', { token: mgmt.token, raw: true });
  ok(tlCsv.status === 200 && tlCsv.text.includes('Zeit;Kategorie;Text;Person;Maze;Level'), 'Timeline CSV hat korrekte Kopfzeile und Inhalt');
  const tlCsvForb = await api('GET', '/api/reports/timeline/csv', { token: actor.token });
  ok(tlCsvForb.status === 403, 'Actor darf Timeline-CSV nicht abrufen (403)');

  section('Input-Validierung');
  // Chat: Nachricht > 2000 Zeichen wird abgeschnitten
  const longMsg = 'A'.repeat(3000);
  const chatLong = (await api('POST', '/api/chat/ch_crew/messages', { token: actor.token, body: { text: longMsg } })).json;
  ok(chatLong.text.length === 2000, `Chat-Nachricht auf 2000 Zeichen gekuerzt (${chatLong.text.length})`);

  // Chat: leere Nachricht wird abgelehnt
  const chatEmpty = await api('POST', '/api/chat/ch_crew/messages', { token: actor.token, body: { text: '   ' } });
  ok(chatEmpty.status === 400, 'Leere Chat-Nachricht wird abgewiesen (400)');

  // Tasks: Titel > 200 Zeichen wird abgeschnitten
  const longTitle = 'T'.repeat(300);
  const taskLong = (await api('POST', '/api/tasks', { token: mgmt.token, body: { title: longTitle } })).json;
  ok(taskLong.title.length === 200, `Aufgaben-Titel auf 200 Zeichen gekuerzt (${taskLong.title.length})`);

  // Tasks: Deadline-Format wird validiert
  const taskBadDl = await api('POST', '/api/tasks', { token: mgmt.token, body: { title: 'Test', deadline: 'morgen' } });
  ok(taskBadDl.status === 400 && taskBadDl.json.error.includes('HH:MM'), 'Ungueltige Deadline wird abgewiesen (400)');

  // People: Ungueltige Rolle wird abgewiesen
  const badRolePerson = await api('POST', '/api/people', { token: mgmt.token, body: { name: 'Tester', roles: ['admin', 'root'] } });
  ok(badRolePerson.status === 400, 'Ungueltige Rollen werden abgewiesen (400)');

  // People: Name wird auf 100 Zeichen gekuerzt
  const longNamePerson = (await api('POST', '/api/people', { token: mgmt.token, body: { name: 'N'.repeat(150) } })).json;
  ok(longNamePerson.name.length === 100, `Personenname auf 100 Zeichen gekuerzt (${longNamePerson.name.length})`);

  // People: Code-Pattern wird validiert
  const badCodePerson = await api('POST', '/api/people', { token: mgmt.token, body: { name: 'Tester2', code: 'AB CD!!' } });
  ok(badCodePerson.status === 400, 'Ungueltiger Personal-Code wird abgewiesen (400)');

  // Announcements: Text > 1000 Zeichen wird abgeschnitten
  const longAnn = (await api('POST', '/api/announcements', { token: mgmt.token, body: { text: 'X'.repeat(1500), level: 'info' } })).json;
  ok(longAnn.text.length === 1000, `Durchsagen-Text auf 1000 Zeichen gekuerzt (${longAnn.text.length})`);

  // Announcements: Ungueltiges Level wird abgewiesen
  const badLevelAnn = await api('POST', '/api/announcements', { token: mgmt.token, body: { text: 'Test', level: 'panik' } });
  ok(badLevelAnn.status === 400, 'Ungueltige Durchsage-Stufe wird abgewiesen (400)');

  // Announcements: Ungueltiger Scope-Typ wird abgewiesen
  const badScopeAnn = await api('POST', '/api/announcements', { token: mgmt.token, body: { text: 'Test', scope: { type: 'galaxy' } } });
  ok(badScopeAnn.status === 400, 'Ungueltiger Scope-Typ wird abgewiesen (400)');

  // JSON Depth Bomb: tief verschachteltes JSON wird abgewiesen
  let deepJson = '{"a":';
  for (let i = 0; i < 55; i++) deepJson += '{"b":';
  deepJson += '1';
  for (let i = 0; i < 55; i++) deepJson += '}';
  deepJson += '}';
  const deepRes = await fetch(BASE + '/api/people', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mgmt.token}` },
    body: deepJson,
  });
  ok(deepRes.status === 400, `Tief verschachteltes JSON (55 Ebenen) wird abgewiesen (${deepRes.status})`);

  // Breaks: Note wird auf 500 Zeichen gekuerzt
  // (Pause beenden, damit neue Anfrage moeglich ist)
  const breakLong = (await api('POST', '/api/breaks/request', { token: cat.token, body: { note: 'B'.repeat(700) } })).json;
  ok(breakLong.note.length === 500, `Pausen-Notiz auf 500 Zeichen gekuerzt (${breakLong.note.length})`);
  // Cleanup: Pause ablehnen
  await api('POST', `/api/breaks/${breakLong.id}/deny`, { token: lead.token, body: { reason: 'test' } });

  section('Security & Rate-Limiting');
  // Security headers pruefen
  const secRes = await fetch(BASE + '/api/health');
  ok(secRes.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff auf API');
  ok(secRes.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options: DENY auf API');
  ok(secRes.headers.get('referrer-policy') === 'strict-origin-when-cross-origin', 'Referrer-Policy gesetzt');
  ok(secRes.headers.get('content-security-policy')?.includes("default-src 'none'"), 'CSP auf API-Responses');

  // Body-Groesse: 256KB-Limit fuer Standard-API
  const bigBody = JSON.stringify({ data: 'x'.repeat(300 * 1024) });
  const bigRes = await fetch(BASE + '/api/people', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mgmt.token}` },
    body: bigBody,
  });
  ok(bigRes.status === 413, 'Body > 256KB auf Standard-Endpunkt ergibt 413');

  // Rate-Limiting: Login-Endpunkt (10 pro 5 min)
  // Einige Logins wurden in frueheren Sektionen bereits verbraucht.
  // Wir senden genug Anfragen, damit das Limit sicher erreicht wird.
  const rlResults = [];
  for (let i = 0; i < 15; i++) {
    const r = await api('POST', '/api/auth/login', { body: { code: 'XXXX', pin: '0000' } });
    rlResults.push(r.status);
  }
  ok(rlResults.includes(429), 'Rate-Limit 429 nach zu vielen Login-Versuchen');
  const first429 = rlResults.indexOf(429);
  ok(first429 >= 1, 'Nicht sofort beim ersten Versuch gedrosselt');

  section('SSE-Verbindungslimits & Resilience');
  // Per-Person-Limit: max 3 gleichzeitige SSE-Verbindungen pro Person.
  // Wir brauchen ein frisches Token (Ratelimiter hat Login-IP gesperrt).
  // Nutze lead-Token (aus frueherem Login).
  const sseConns = [];
  for (let i = 0; i < 5; i++) {
    const ctrl = new AbortController();
    const r = fetch(BASE + '/api/stream?token=' + lead.token, {
      headers: { Authorization: `Bearer ${lead.token}` },
      signal: ctrl.signal,
    });
    sseConns.push({ promise: r, ctrl });
    // Kurz warten, damit die Verbindung registriert wird
    await new Promise((r) => setTimeout(r, 150));
  }
  // Warte kurz, damit alle Verbindungen auf dem Server registriert sind
  await new Promise((r) => setTimeout(r, 300));
  const healthSSE = (await api('GET', '/api/health', { token: lead.token })).json;
  ok(healthSSE.online <= 3, `Per-Person-Limit: max 3 SSE-Verbindungen aktiv (online: ${healthSSE.online})`);
  // Aufraeumen: alle SSE-Verbindungen schliessen
  for (const c of sseConns) { c.ctrl.abort(); }
  await new Promise((r) => setTimeout(r, 200));

  // Globales Limit: 503 bei Ueberlast (Indirekt pruefen -- zu viele Verbindungen oeffnen wir nicht,
  // aber wir pruefen, dass das attach im Bus korrekt arbeitet).
  // Stattdessen pruefen wir, dass /api/health online=0 nach Aufraemen meldet.
  const healthAfter = (await api('GET', '/api/health', { token: lead.token })).json;
  ok(healthAfter.online === 0, `SSE-Verbindungen nach Abort sauber aufgeraeumt (online: ${healthAfter.online})`);

  section('Crash-Sicherheit: kaputter Snapshot → Wiederherstellung');
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1200));
  const snapFile = path.join(DATA, 'state.json');
  fs.writeFileSync(snapFile, '{"kaputt": tru'); // absichtlich zerstört
  server = startServer();
  ok(await waitUp(), 'Server startet trotz zerstörtem Snapshot');
  const relog = (await api('POST', '/api/auth/login', { body: { code: 'DR-0001', pin: '4711' } })).json;
  ok(relog?.token, 'Login nach Wiederherstellung');
  const health = (await api('GET', '/api/health', { token: relog.token })).json;
  ok(health.db.counts.people >= 50, `Datenbestand wiederhergestellt (${health.db.counts.people} Personen)`);
  ok(health.db.bootReport.some((l) => l.includes('unbrauchbar')), 'Boot-Report dokumentiert die Reparatur');

  section('Master-Timeline-Versionierung');
  // Erstelle Timeline-Bloecke
  const tb1 = (await api('POST', '/api/timeline', { token: mgmt.token, body: { title: 'Einlass', start: '18:00', end: '18:30', type: 'phase' } })).json;
  ok(tb1.id && tb1.title === 'Einlass' && tb1.start === '18:00', 'Block erstellt (Einlass 18:00)');
  const tb2 = (await api('POST', '/api/timeline', { token: mgmt.token, body: { title: 'Briefing', start: '18:30', end: '19:00', type: 'meeting' } })).json;
  ok(tb2.id && tb2.start === '18:30', 'Block erstellt (Briefing 18:30)');
  const tb3 = (await api('POST', '/api/timeline', { token: mgmt.token, body: { title: 'Show Start', start: '19:00', end: '23:00', type: 'show' } })).json;
  ok(tb3.id && tb3.start === '19:00', 'Block erstellt (Show Start 19:00)');

  // Lesen: sortiert nach Startzeit
  const tlBlocks = (await api('GET', '/api/timeline', { token: mgmt.token })).json;
  ok(tlBlocks.blocks.length >= 9, `Timeline hat >= 9 Bloecke (6 Seed + 3 neu = ${tlBlocks.blocks.length})`);
  const tlCreated = tlBlocks.blocks.filter((b) => [tb1.id, tb2.id, tb3.id].includes(b.id));
  ok(tlCreated.length === 3 && tlCreated[0].start <= tlCreated[2].start, 'Erstellte Bloecke nach Startzeit sortiert');
  ok(tlBlocks.frozen === false, 'Timeline ist nicht eingefroren');

  // Lead kann lesen
  const tlLead = (await api('GET', '/api/timeline', { token: lead.token })).json;
  ok(tlLead.blocks.length >= 9, 'Lead kann Timeline lesen');

  // Actor darf nicht lesen
  const tlActorForb = await api('GET', '/api/timeline', { token: actor.token });
  ok(tlActorForb.status === 403, 'Actor darf Timeline nicht lesen (403)');

  // Actor darf nicht schreiben
  const tlActorWrite = await api('POST', '/api/timeline', { token: actor.token, body: { title: 'X', start: '20:00', end: '21:00' } });
  ok(tlActorWrite.status === 403, 'Actor darf Block nicht erstellen (403)');

  // PATCH: Block bearbeiten
  const tbUpd = (await api('PATCH', `/api/timeline/${tb1.id}`, { token: mgmt.token, body: { title: 'Einlass VIP', start: '17:45' } })).json;
  ok(tbUpd.title === 'Einlass VIP' && tbUpd.start === '17:45', 'Block bearbeitet (Titel + Start)');

  // Versionen wurden automatisch erstellt
  const tlVers = (await api('GET', '/api/timeline/versions', { token: mgmt.token })).json;
  ok(tlVers.length >= 4, `Versionen erstellt (${tlVers.length} nach 3 Creates + 1 Patch)`);
  ok(tlVers[0].version === 1 && tlVers[0].author, 'Erste Version hat Nummer und Autor');

  // Version-Detail abrufen
  const ver1 = (await api('GET', `/api/timeline/versions/${tlVers[0].id}`, { token: mgmt.token })).json;
  ok(ver1.blocks.length >= 1 && ver1.version === 1, 'Version-Detail enthaelt Block-Snapshot');

  // Lead kann Versionen lesen
  const tlVersLead = (await api('GET', '/api/timeline/versions', { token: lead.token })).json;
  ok(tlVersLead.length >= 4, 'Lead kann Versionen lesen');

  // Delay-Propagation
  const delayRes = (await api('POST', '/api/timeline/delay', { token: mgmt.token, body: { blockId: tb2.id, delayMinutes: 15, reason: 'Technik-Verzoegerung' } })).json;
  ok(delayRes.ok && delayRes.shifted >= 2, `Delay propagiert (${delayRes.shifted} Bloecke verschoben)`);
  const afterDelay = (await api('GET', '/api/timeline', { token: mgmt.token })).json;
  const briefingAfter = afterDelay.blocks.find((b) => b.id === tb2.id);
  const showAfter = afterDelay.blocks.find((b) => b.id === tb3.id);
  ok(briefingAfter.start === '18:45', `Briefing verschoben auf 18:45 (${briefingAfter.start})`);
  ok(showAfter.start === '19:15', `Show verschoben auf 19:15 (${showAfter.start})`);

  // Delay erstellt neue Version mit Grund
  const versAfterDelay = (await api('GET', '/api/timeline/versions', { token: mgmt.token })).json;
  const delayVer = versAfterDelay[versAfterDelay.length - 1];
  ok(delayVer.reason.includes('Technik-Verzoegerung'), 'Delay-Version hat Grund');

  // Version-Diff
  const diffRes = (await api('GET', `/api/timeline/versions/${tlVers[tlVers.length - 1].id}/diff/${delayVer.id}`, { token: mgmt.token })).json;
  ok(diffRes.v1 && diffRes.v2 && Array.isArray(diffRes.changed), 'Diff liefert v1, v2, changed');
  ok(diffRes.changed.length >= 1, `Diff zeigt geaenderte Bloecke (${diffRes.changed.length})`);

  // Freeze
  const freezeRes = (await api('POST', '/api/timeline/freeze', { token: mgmt.token })).json;
  ok(freezeRes.ok && freezeRes.frozen === true, 'Timeline eingefroren');
  const tlFrozen = (await api('GET', '/api/timeline', { token: mgmt.token })).json;
  ok(tlFrozen.frozen === true, 'GET /api/timeline zeigt frozen=true');

  // Bearbeitung ohne emergency wird abgelehnt
  const frozenEdit = await api('POST', '/api/timeline', { token: mgmt.token, body: { title: 'Test', start: '20:00', end: '21:00' } });
  ok(frozenEdit.status === 400 && frozenEdit.json.error.includes('eingefroren'), 'Aenderung bei Freeze abgelehnt');

  // Notfall-Aenderung mit emergency:true geht durch
  const emergEdit = (await api('POST', '/api/timeline', { token: mgmt.token, body: { title: 'Notfall-Block', start: '22:00', end: '22:30', emergency: true } })).json;
  ok(emergEdit.id && emergEdit.title === 'Notfall-Block', 'Notfall-Aenderung (emergency:true) funktioniert');

  // Unfreeze (toggle)
  const unfreezeRes = (await api('POST', '/api/timeline/freeze', { token: mgmt.token })).json;
  ok(unfreezeRes.ok && unfreezeRes.frozen === false, 'Timeline aufgetaut (toggle)');

  // Lead darf nicht schreiben
  const leadWrite = await api('POST', '/api/timeline', { token: lead.token, body: { title: 'X', start: '20:00', end: '21:00' } });
  ok(leadWrite.status === 403, 'Lead darf nicht schreiben (403)');

  // Delay: Zero Minuten abgelehnt (400)
  const delayZero = await api('POST', '/api/timeline/delay', { token: mgmt.token, body: { blockId: tb2.id, delayMinutes: 0, reason: 'null' } });
  ok(delayZero.status === 400, `Delay mit 0 Minuten wird abgelehnt (${delayZero.status})`);

  // Delay: Negative Minuten abgelehnt (400)
  const delayNeg = await api('POST', '/api/timeline/delay', { token: mgmt.token, body: { blockId: tb2.id, delayMinutes: -5, reason: 'negativ' } });
  ok(delayNeg.status === 400, `Delay mit negativem Wert wird abgelehnt (${delayNeg.status})`);

  // DELETE: Block loeschen
  const delBlock = await api('DELETE', `/api/timeline/${tb3.id}`, { token: mgmt.token });
  ok(delBlock.status === 200 && delBlock.json?.ok, 'Block geloescht');
  const afterBlockDel = (await api('GET', '/api/timeline', { token: mgmt.token })).json;
  ok(!afterBlockDel.blocks.find((b) => b.id === tb3.id), 'Geloeschter Block nicht mehr in Timeline');

  section('Dokumenten-Hub');

  // Management erstellt ein Dokument
  const doc1 = (await api('POST', '/api/documents', { token: mgmt.token, body: { title: 'Sicherheitsbriefing', content: '# Wichtige Infos\n\nAlle Notausgaenge pruefen.', category: 'briefing', visibility: 'alle' } })).json;
  ok(doc1?.id && doc1.title === 'Sicherheitsbriefing', 'Dokument erstellt');
  ok(doc1.category === 'briefing' && doc1.visibility === 'alle', 'Dokument hat Kategorie + Sichtbarkeit');

  // Zweites Dokument (management-only)
  const doc2 = (await api('POST', '/api/documents', { token: mgmt.token, body: { title: 'Internes Protokoll', content: 'Nur fuer Management.', category: 'sonstiges', visibility: 'management' } })).json;
  ok(doc2?.id && doc2.visibility === 'management', 'Management-only Dokument erstellt');

  // Drittes Dokument (lead visibility)
  const doc3 = (await api('POST', '/api/documents', { token: mgmt.token, body: { title: 'Lead-Info', content: 'Fuer Leads.', category: 'lageplan', visibility: 'lead' } })).json;
  ok(doc3?.id && doc3.visibility === 'lead', 'Lead-Dokument erstellt');

  // Lese alle Dokumente als Management (sieht alles)
  const allDocs = (await api('GET', '/api/documents', { token: mgmt.token })).json;
  ok(Array.isArray(allDocs) && allDocs.length >= 3, `Management sieht alle Dokumente (${allDocs?.length})`);

  // Actor sieht nur Dokumente mit visibility=alle
  const actorDocs = (await api('GET', '/api/documents', { token: actor.token })).json;
  ok(actorDocs.every((d) => d.visibility === 'alle'), 'Actor sieht nur Dokumente mit Sichtbarkeit alle');
  ok(!actorDocs.find((d) => d.id === doc2.id), 'Actor sieht management-only Dokument nicht');
  ok(!actorDocs.find((d) => d.id === doc3.id), 'Actor sieht lead-Dokument nicht');

  // Lead sieht alle + lead, aber nicht management-only
  const leadDocs = (await api('GET', '/api/documents', { token: lead.token })).json;
  ok(leadDocs.find((d) => d.id === doc3.id), 'Lead sieht lead-Dokument');
  ok(!leadDocs.find((d) => d.id === doc2.id), 'Lead sieht management-only Dokument nicht');

  // Kategorie-Filter
  const briefings = (await api('GET', '/api/documents?category=briefing', { token: mgmt.token })).json;
  ok(briefings.every((d) => d.category === 'briefing'), 'Kategoriefilter funktioniert');
  ok(briefings.find((d) => d.id === doc1.id), 'Briefing-Dokument in Kategorie-Ergebnis');

  // Update Dokument
  const updDoc = (await api('PATCH', `/api/documents/${doc1.id}`, { token: mgmt.token, body: { title: 'Sicherheitsbriefing v2', content: 'Aktualisiert.' } })).json;
  ok(updDoc.title === 'Sicherheitsbriefing v2', 'Dokument aktualisiert');

  // Pin/Unpin
  const pinRes = (await api('PATCH', `/api/documents/${doc1.id}`, { token: mgmt.token, body: { pinned: true } })).json;
  ok(pinRes.pinned === true, 'Dokument angepinnt');

  // Pinned documents appear first
  const withPin = (await api('GET', '/api/documents', { token: mgmt.token })).json;
  ok(withPin[0].id === doc1.id && withPin[0].pinned === true, 'Angepinnte Dokumente stehen oben');

  // Unpin
  const unpinRes = (await api('PATCH', `/api/documents/${doc1.id}`, { token: mgmt.token, body: { pinned: false } })).json;
  ok(unpinRes.pinned === false, 'Dokument losgeloest');

  // Delete Dokument
  const delDoc = await api('DELETE', `/api/documents/${doc1.id}`, { token: mgmt.token });
  ok(delDoc.status === 200 && delDoc.json?.ok, 'Dokument geloescht');
  const afterDel = (await api('GET', '/api/documents', { token: mgmt.token })).json;
  ok(!afterDel.find((d) => d.id === doc1.id), 'Geloeschtes Dokument nicht mehr in Liste');

  // Rollenrestriktionen: Actor kann nicht erstellen
  const actorCreate = await api('POST', '/api/documents', { token: actor.token, body: { title: 'Test', content: 'x', category: 'sonstiges', visibility: 'alle' } });
  ok(actorCreate.status === 403, 'Actor kann kein Dokument erstellen (403)');

  // Actor kann nicht bearbeiten
  const actorEdit = await api('PATCH', `/api/documents/${doc2.id}`, { token: actor.token, body: { title: 'Hack' } });
  ok(actorEdit.status === 403, 'Actor kann kein Dokument bearbeiten (403)');

  // Actor kann nicht loeschen
  const actorDel = await api('DELETE', `/api/documents/${doc2.id}`, { token: actor.token });
  ok(actorDel.status === 403, 'Actor kann kein Dokument loeschen (403)');

  section('Offline-Robustheit: Service Worker & Retry-Logik');

  // (a) SW-Cache enthaelt alle JS-Dateien
  const swSrc = fs.readFileSync(path.join(ROOT, 'web/sw.js'), 'utf8');
  const expectedJS = [
    '/js/app.js',
    '/js/core/api.js', '/js/core/dom.js', '/js/core/fmt.js',
    '/js/core/offline-banner.js', '/js/core/qr.js', '/js/core/store.js', '/js/core/ui.js',
    '/js/shell/desktop.js', '/js/shell/login.js', '/js/shell/phone.js',
    '/js/shell/station.js', '/js/shell/tablet.js',
    '/js/views/alarm.js', '/js/views/announce.js', '/js/views/attendance.js',
    '/js/views/backups.js', '/js/views/breaks.js', '/js/views/carpool.js',
    '/js/views/catering_mgmt.js', '/js/views/chat.js', '/js/views/dashboard.js',
    '/js/views/dbadmin.js', '/js/views/documents.js', '/js/views/incidents.js', '/js/views/kidsday.js',
    '/js/views/livemap.js', '/js/views/mazes.js', '/js/views/modules.js',
    '/js/views/people.js', '/js/views/profile.js', '/js/views/reports.js',
    '/js/views/schedule.js', '/js/views/settings.js', '/js/views/shared.js',
    '/js/views/tasks.js', '/js/views/timeline.js', '/js/views/wallet.js',
  ];
  const missingFromCache = expectedJS.filter((f) => !swSrc.includes(`'${f}'`));
  ok(missingFromCache.length === 0, `SW-Cache enthaelt alle ${expectedJS.length} JS-Dateien${missingFromCache.length ? ' (fehlend: ' + missingFromCache.join(', ') + ')' : ''}`);

  // (b) Cache-Version ist v2 (nicht mehr v1)
  ok(swSrc.includes("'hgo-shell-v2'"), 'SW-Cache-Version ist hgo-shell-v2');
  ok(!swSrc.includes("'hgo-shell-v1'"), 'Alte Cache-Version v1 nicht mehr vorhanden');

  // (c) offline-banner.js existiert und exportiert initOfflineBanner
  const bannerPath = path.join(ROOT, 'web/js/core/offline-banner.js');
  ok(fs.existsSync(bannerPath), 'offline-banner.js Modul existiert');
  const bannerSrc = fs.readFileSync(bannerPath, 'utf8');
  ok(bannerSrc.includes('initOfflineBanner'), 'offline-banner.js exportiert initOfflineBanner');

  // (d) store.js enthaelt emit("reconnected") Logik
  const storeSrc = fs.readFileSync(path.join(ROOT, 'web/js/core/store.js'), 'utf8');
  ok(storeSrc.includes("emit('reconnected')") || storeSrc.includes('emit("reconnected")'), 'store.js emittiert reconnected-Event nach Reconnect');

  // (e) api.js enthaelt Retry-Logik (setTimeout mit 2000ms)
  const apiSrc = fs.readFileSync(path.join(ROOT, 'web/js/core/api.js'), 'utf8');
  ok(apiSrc.includes('2000') || apiSrc.includes('2e3'), 'api.js enthaelt 2s-Retry-Delay');

  // (f) Regressions-Test: API-Aufrufe funktionieren weiterhin korrekt (Retry bricht nichts)
  const regHealth = await api('GET', '/api/health', { token: relog.token });
  ok(regHealth.status === 200, 'API-Aufrufe funktionieren weiterhin nach Retry-Logik-Integration');

} catch (e) {
  failed++;
  console.error('\n💥 Testlauf abgebrochen:', e);
} finally {
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 400));
  fs.rmSync(DATA, { recursive: true, force: true });
}

console.log(`\n${'─'.repeat(50)}\n${failed === 0 ? '✅' : '❌'} ${passed} bestanden · ${failed} fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
