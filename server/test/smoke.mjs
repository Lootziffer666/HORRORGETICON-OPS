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
  const asylum = mazes.find((m) => m.name === 'Asylum');
  const detail = (await api('GET', `/api/mazes/${asylum.id}`, { token: mgmt.token })).json;
  ok(detail.positions.length === 11, `Asylum hat 11 Positionen (${detail.positions.length})`);
  const a6 = detail.positions.find((p) => p.code === 'A6');
  ok(a6 && !a6.assignedPersonId, 'A6 „Archiv“ ist offen (Pavel fehlt)');
  const issues = (await api('GET', '/api/assignments/issues', { token: mgmt.token })).json;
  ok(issues.open.length >= 3, `Offene Positionen erkannt (${issues.open.length})`);
  const asg = (await api('POST', `/api/positions/${a6.id}/assign`, { token: lead.token, body: { personId: linked.person.id } })).json;
  ok(asg.assignedPersonId === linked.person.id, 'Lead besetzt A6 mit verknüpfter Person');

  section('Live-Tracking');
  const ci = (await api('POST', '/api/live/checkin', { token: loginNew.token, body: { battery: 88 } })).json;
  ok(ci.state === 'in', 'Check-in');
  const hb = (await api('POST', '/api/live/heartbeat', { token: loginNew.token, body: { battery: 87 } })).json;
  ok(hb.checkedIn === true && hb.status === 'aktiv', 'Heartbeat hält Tracking frisch');
  const conf = (await api('POST', '/api/live/confirm-position', { token: loginNew.token })).json;
  ok(conf.position === 'A6', 'Position bestätigt (A6)');
  const ov = (await api('GET', '/api/live/overview', { token: mgmt.token })).json;
  ok(ov.kpi.anwesend > 40 && ov.mazes.length === 5, `Lagebild: ${ov.kpi.anwesend}/${ov.kpi.crewGesamt} anwesend`);
  const row = ov.people.find((p) => p.id === linked.person.id);
  ok(row?.status === 'aktiv' && row.position === 'A6', 'Verknüpfte Person erscheint korrekt im Tracking');

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
  const inc = (await api('POST', '/api/incidents', { token: loginNew.token, body: { kind: 'technik', text: 'Lampe flackert im Archiv' } })).json;
  ok(inc.status === 'offen' && inc.ort.includes('A6'), 'Meldung mit automatischer Position');
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
    body: { text: 'Show stoppen, Position halten.', level: 'notfall', scope: { type: 'maze', mazeId: asylum.id } },
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
  const csvText = 'Name;Rolle;Status;Ort;Maze;Position\nImport Tester;Scare Actor;aktiv;Nebelbach;Asylum;A11\nLena Krause;Scare Actor;aktiv;Nebelbach;;';
  const dry = (await api('POST', '/api/csv/import/personen', { token: mgmt.token, body: { text: csvText, dryRun: true } })).json;
  ok(dry.dryRun && dry.neu.length === 1 && dry.aktualisiert.length === 1, `Import-Vorschau (1 neu, 1 aktualisiert)`);
  const apply = (await api('POST', '/api/csv/import/personen', { token: mgmt.token, body: { text: csvText, dryRun: false } })).json;
  ok(apply.angewendet === 2, 'Import angewendet');
  const after = (await api('GET', '/api/people?q=Import Tester', { token: mgmt.token })).json;
  ok(after.length === 1, 'Importierte Person ist da (und auf A11 zugeteilt)');

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
    body: { title: 'Testaufgabe: Kabel sichern', mazeId: asylum.id, prio: 'hoch', critical: true, deadline: '23:30' },
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
  const asylumReady = ready0.find((r) => r.maze === 'Asylum');
  ok(asylumReady && !asylumReady.bereit && asylumReady.pflichtOffen === 1, 'Asylum nicht bereit (1 Pflichtpunkt offen — Demo)');
  ok(ready0.filter((r) => r.bereit).length === 4, 'Übrige 4 Mazes bereit');
  const cls = (await api('GET', `/api/checklists?maze=${asylum.id}`, { token: lead.token })).json;
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
  const newCl = (await api('POST', '/api/checklists', { token: mgmt.token, body: { type: 'preshow', mazeId: asylum.id } })).json;
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
  const handover = (await api('GET', `/api/reports/handover?maze=${asylum.id}`, { token: lead.token })).json;
  ok(handover.maze === 'Asylum' && Array.isArray(handover.offeneAufgaben) && handover.checklisten.length >= 3,
    `Übergabeprotokoll Asylum (${handover.offeneAufgaben.length} Aufgaben, ${handover.offeneVorfaelle.length} Vorfälle)`);
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
  const kdAsylum = kdMazes.find((m) => m.name === 'Asylum');
  ok(kdAsylum && kdAsylum.intensity === 'leicht', 'Asylum-Intensitaet ist leicht');

  // Maze-Intensitaet patchen
  const kdMazePatch = (await api('PATCH', `/api/kidsday/mazes/${kdAsylum.mazeId}`, { token: mgmt.token, body: { intensity: 'mittel' } })).json;
  ok(kdMazePatch.intensity === 'mittel', 'PATCH Maze-Intensitaet auf mittel');
  const kdForbMaze = await api('PATCH', `/api/kidsday/mazes/${kdAsylum.mazeId}`, { token: actor.token, body: { intensity: 'aus' } });
  ok(kdForbMaze.status === 403, 'Actor darf Maze-Intensitaet nicht aendern (403)');

  // Invalid-input error paths
  const kdBadIntensity = await api('PATCH', '/api/kidsday/config', { token: mgmt.token, body: { defaultIntensity: 'extrem' } });
  ok(kdBadIntensity.status === 400, 'Ungueltige Intensitaet wird abgewiesen (400)');
  const kdBadArray = await api('PATCH', '/api/kidsday/config', { token: mgmt.token, body: { ageGroups: 'not-an-array' } });
  ok(kdBadArray.status === 400, 'Nicht-Array ageGroups wird abgewiesen (400)');
  const kdBadMazeId = await api('PATCH', '/api/kidsday/mazes/nonexistent-maze-xyz', { token: mgmt.token, body: { intensity: 'leicht' } });
  ok(kdBadMazeId.status === 404, 'Nicht existentes Maze liefert 404');

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
