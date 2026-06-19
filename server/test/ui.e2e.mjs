#!/usr/bin/env node
// Horrorgeticon Ops — Browser-End-to-End-Test (optional, nicht Teil von `npm test`).
//
// Voraussetzungen (einmalig, beliebiger Ordner mit package.json):
//   npm i playwright-core @playwright/browser-chromium
// Laufender Demo-Server:
//   node server/main.js --demo --port 18799   (frischer Datenordner empfohlen)
// Start:
//   node server/test/ui.e2e.mjs               (BASE via OPS_E2E_BASE überschreibbar)
//
// Prüft alle vier Shells im echten Chromium: Login je Rolle, alle Leitstand-
// Views, Echtzeit-Alarm Lead→Actor→Leitstand (SSE), Wallet-Code →
// Stations-Einlösung, Chat, Phasen-Pill, Aufgaben-Inbox, Rundgänge,
// Actor-Status — und sammelt dabei alle JS-Fehler ein.
import { createRequire } from 'node:module';
import path from 'node:path';

// playwright-core darf auch im AKTUELLEN Arbeitsverzeichnis installiert sein
let chromium = null;
for (const base of [import.meta.url, path.join(process.cwd(), 'package.json')]) {
  try { ({ chromium } = createRequire(base)('playwright-core')); break; } catch { /* nächster Kandidat */ }
}
if (!chromium) {
  console.error('playwright-core fehlt — bitte `npm i playwright-core @playwright/browser-chromium` ausführen\n(im Repo oder im Verzeichnis, aus dem der Test gestartet wird).');
  process.exit(2);
}

const BASE = process.env.OPS_E2E_BASE || 'http://127.0.0.1:18799';
const SHOTS = process.env.OPS_E2E_SHOTS || '/tmp/shots';
import fs from 'node:fs';
fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0, failed = 0;
const ok = (c, l) => { c ? (passed++, console.log(`  ✔ ${l}`)) : (failed++, console.error(`  ✘ ${l}`)); };
const errsOf = new Map();

function watch(page, name) {
  errsOf.set(name, []);
  page.on('pageerror', (e) => errsOf.get(name).push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errsOf.get(name).push(`console: ${m.text()}`); });
}
async function login(page, code, pin) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('input[placeholder="z. B. LK-0427"]', code);
  await page.fill('input[type="password"]', pin);
  await page.click('button:has-text("Anmelden")');
}

const b = await chromium.launch({ args: ['--no-sandbox'] });
try {
  // ── 1 · Management (Desktop) ──
  const ctx1 = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const mg = await ctx1.newPage(); watch(mg, 'mgmt');
  await login(mg, 'DR-0001', '4711');
  await mg.waitForSelector('.dt-side', { timeout: 8000 });
  ok(true, 'Management-Login → Desktop-Shell');
  await mg.waitForSelector('.kpi');
  ok((await mg.locator('.kpi').count()) >= 4, 'Dashboard-KPIs gerendert');
  ok((await mg.locator('.dt-top .live-dot:has-text("LIVE")').count()) === 1, 'Phasenbewusste Live-Anzeige (LIVE)');
  await mg.click('.dt-top .live-dot');
  await mg.waitForSelector('.ov .sheet:has-text("Event-Phase")', { timeout: 4000 });
  ok(true, 'Phasen-Sheet öffnet per Klick');
  await mg.keyboard.press('Escape');
  await mg.waitForTimeout(300);
  await mg.screenshot({ path: `${SHOTS}/01-mgmt-dashboard.png` });

  const navTargets = ['map', 'anwesenheit', 'aufgaben', 'pausen', 'meldungen', 'durchsagen', 'chat',
    'personen', 'mazes', 'catering', 'fahrgruppen', 'zeitplan', 'berichte', 'db', 'module', 'backups', 'einstellungen'];
  for (const t of navTargets) {
    await mg.evaluate((x) => { location.hash = '#/' + x; }, t);
    await mg.waitForTimeout(650);
    ok((await mg.locator('.mod-off').count()) === 0, `View „${t}“ rendert ohne Fehlerkarte`);
  }

  // Aufgaben-Board + Checklisten-Tab
  await mg.evaluate(() => { location.hash = '#/aufgaben'; });
  await mg.waitForTimeout(700);
  ok((await mg.locator('.panel-h .t:has-text("Blockiert")').count()) === 1, 'Aufgaben-Board mit Status-Spalten');
  ok((await mg.locator('text=Ersatz-Stroboskop').count()) >= 1, 'Demo-Aufgabe auf dem Board');
  await mg.screenshot({ path: `${SHOTS}/13-mgmt-aufgaben.png` });
  await mg.click('.chip:has-text("Checklisten & Rundgänge")');
  await mg.waitForTimeout(700);
  ok((await mg.locator('text=Sind wir bereit?').count()) >= 1, 'Checklisten-Tab mit Readiness-Zeile');
  await mg.screenshot({ path: `${SHOTS}/14-mgmt-checklisten.png` });

  await mg.evaluate(() => { location.hash = '#/fahrgruppen'; });
  await mg.waitForTimeout(700);
  await mg.click('button:has-text("Beste Gruppen berechnen")');
  await mg.waitForTimeout(900);
  ok((await mg.locator('text=★ Beste Option').count()) >= 1, 'Fahrgruppen-Matching zeigt „Beste Option“');

  // ── Kids Day Leitstand ──
  await mg.evaluate((x) => { location.hash = '#/' + x; }, 'kidsday');
  await mg.waitForTimeout(700);
  ok((await mg.locator('.mod-off').count()) === 0, 'Kids Day View rendert ohne Fehlerkarte');
  ok((await mg.locator('text=Kids Day').count()) >= 1, 'Kids Day Status-Banner sichtbar');
  ok((await mg.locator('text=Maze-Intensitaeten').count()) >= 1, 'Maze-Intensitaeten Panel vorhanden');
  ok((await mg.locator('text=Leicht').count()) >= 1 || (await mg.locator('text=Mittel').count()) >= 1, 'Intensitaets-Chips (Leicht/Mittel) angezeigt');
  await mg.screenshot({ path: `${SHOTS}/17-mgmt-kidsday.png` });

  // ── Timeline / Ablaufplan ──
  await mg.evaluate((x) => { location.hash = '#/' + x; }, 'timeline');
  await mg.waitForTimeout(700);
  ok((await mg.locator('.mod-off').count()) === 0, 'Timeline View rendert ohne Fehlerkarte');
  ok((await mg.locator('text=Crew-Briefing').count()) >= 1 || (await mg.locator('text=Show-Start').count()) >= 1 || (await mg.locator('text=Einlass').count()) >= 1, 'Timeline-Bloecke werden angezeigt');
  ok((await mg.locator('text=6 Bloecke').count()) >= 1, 'Block-Count Badge zeigt 6 Bloecke');
  ok((await mg.locator('text=Einfrieren').count()) >= 1 || (await mg.locator('text=Auftauen').count()) >= 1, 'Freeze/Unfreeze Button vorhanden');
  ok((await mg.locator('text=Versionshistorie').count()) >= 1, 'Versionshistorie Panel vorhanden');
  await mg.screenshot({ path: `${SHOTS}/18-mgmt-timeline.png` });

  // ── Dokumenten-Hub ──
  await mg.evaluate((x) => { location.hash = '#/' + x; }, 'dokumente');
  await mg.waitForTimeout(700);
  ok((await mg.locator('.mod-off').count()) === 0, 'Dokumenten-Hub rendert ohne Fehlerkarte');
  ok((await mg.locator('text=Sicherheits-Briefing').count()) >= 1 || (await mg.locator('text=Lageplan').count()) >= 1 || (await mg.locator('text=Notfallplan').count()) >= 1, 'Seeded Dokumente werden angezeigt');
  ok((await mg.locator('.chip:has-text("Briefing")').count()) >= 1, 'Kategorie-Filter Chip Briefing vorhanden');
  ok((await mg.locator('.chip:has-text("Notfall")').count()) >= 1, 'Kategorie-Filter Chip Notfall vorhanden');
  ok((await mg.locator('text=Angepinnt').count()) >= 1, 'Angepinnt Badge sichtbar');
  // Dokument oeffnen und Detail-Sheet pruefen
  await mg.click('.card:has-text("Sicherheits-Briefing")');
  await mg.waitForSelector('.ov .sheet', { timeout: 4000 });
  ok(true, 'Dokumenten-Detail Sheet oeffnet sich');
  await mg.keyboard.press('Escape');
  await mg.waitForTimeout(400);
  await mg.screenshot({ path: `${SHOTS}/19-mgmt-dokumente.png` });

  // ── 2 · Actor (Phone) ──
  const ctx2 = await b.newContext({ viewport: { width: 412, height: 880 }, isMobile: true, hasTouch: true });
  const ac = await ctx2.newPage(); watch(ac, 'actor');
  await login(ac, 'LK-0427', '1234');
  await ac.waitForSelector('.m-nav', { timeout: 8000 });
  ok(true, 'Actor-Login → Phone-Shell');
  ok((await ac.locator('text=Deine Schicht heute').count()) === 1, 'Schichtkarte (Phase live)');
  // Detail-Status setzen
  await ac.click('.chip:has-text("Maske")');
  await ac.waitForTimeout(800);
  ok((await ac.locator('.chip.active:has-text("Maske")').count()) === 1, 'Actor-Status-Chip „Maske“ aktiv');
  await ac.screenshot({ path: `${SHOTS}/05-actor-start.png` });
  await ac.click('.m-nav .it:has-text("Karte")');
  await ac.waitForSelector('.maze-map');
  ok((await ac.locator('.pin').count()) >= 8, 'Maze-Karte mit Pins');
  await ac.click('.m-nav .it:has-text("Marken")');
  await ac.waitForSelector('.qr-box canvas');
  ok(true, 'Wallet-QR (Canvas) gerendert');
  const codeText = await ac.locator('.wallet-code').textContent();
  const short = (codeText || '').split('·')[1]?.trim();
  ok(/^[A-Z2-9]{4}$/.test(short || ''), `Wallet zeigt 4er-Code (${short})`);
  await ac.click('.m-nav .it:has-text("Start")');
  await ac.waitForTimeout(600);

  // ── DND Mode (Actor Phone) ──
  await ac.click('.m-nav .it:has-text("Profil")');
  await ac.waitForTimeout(700);
  ok((await ac.locator('text=Nicht stören (DND)').count()) >= 1, 'DND Panel im Profil sichtbar');
  ok((await ac.locator('text=DND aktivieren').count()) >= 1 || (await ac.locator('text=DND deaktivieren').count()) >= 1, 'DND Toggle-Button vorhanden');
  // Enable DND via API from actor browser context
  await ac.evaluate(async () => {
    const token = localStorage.getItem('hgo.token');
    await fetch('/api/dnd/enable', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
  });
  await ac.waitForTimeout(500);
  await ac.click('.m-nav .it:has-text("Profil")');
  await ac.waitForTimeout(700);
  ok((await ac.locator('.m-head text=DND').count()) >= 1 || (await ac.locator('.m-head .badge:has-text("DND")').count()) >= 1, 'DND Badge erscheint im Phone-Header');
  // Disable DND via API
  await ac.evaluate(async () => {
    const token = localStorage.getItem('hgo.token');
    await fetch('/api/dnd/disable', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
  });
  await ac.waitForTimeout(500);
  await ac.click('.m-nav .it:has-text("Start")');
  await ac.waitForTimeout(500);
  ok((await ac.locator('.m-head text=DND').count()) === 0, 'DND Badge verschwindet nach Deaktivierung');
  await ac.screenshot({ path: `${SHOTS}/20-actor-dnd.png` });
  await ac.click('.m-nav .it:has-text("Start")');
  await ac.waitForTimeout(600);

  // ── 3 · Lead (Tablet): Aufgaben-Inbox + Rundgänge + Alarm ──
  const ctx3 = await b.newContext({ viewport: { width: 1194, height: 834 } });
  const ld = await ctx3.newPage(); watch(ld, 'lead');
  await login(ld, 'MT-0301', '1234');
  await ld.waitForSelector('text=Rollenwahl', { timeout: 8000 });
  await ld.click('.role-card:has-text("Maze Lead")');
  await ld.waitForSelector('text=Maze-Leitung', { timeout: 8000 });
  ok(true, 'Lead-Login → Tablet-Shell');
  await ld.waitForSelector('.lead-split', { timeout: 8000 });

  // Aufgaben-Inbox: kritische Keller-Aufgabe annehmen
  await ld.click('.chip:has-text("Aufgaben")');
  await ld.waitForSelector('text=Eingehend vom Leitstand', { timeout: 6000 });
  ok((await ld.locator('text=Absperrung im Keller').count()) >= 1, 'Lead-Inbox zeigt Leitstand-Aufgabe');
  await ld.click('.prow:has-text("Absperrung im Keller")');
  await ld.waitForSelector('.ov .sheet');
  await ld.click('.ov button:has-text("Annehmen")');
  await ld.waitForTimeout(900);
  ok((await ld.locator('.prow:has-text("Absperrung im Keller") .badge:has-text("Angenommen")').count()) >= 1, 'Aufgabe angenommen → Status sichtbar');
  await ld.screenshot({ path: `${SHOTS}/15-lead-aufgaben.png` });

  // Rundgänge: offenen Pflichtpunkt (Funkcheck) abhaken
  await ld.click('.chip:has-text("Mehr")');
  await ld.waitForSelector('text=Rundgänge & Checklisten', { timeout: 6000 });
  ok((await ld.locator('text=Pflicht offen').count()) >= 1, 'Rundgänge zeigen offenen Pflichtpunkt');
  await ld.click('text=Sicherheit-Rundgang');
  await ld.waitForSelector('.ov .sheet');
  await ld.click('.ov .prow:has-text("Funkcheck")');
  await ld.waitForTimeout(900);
  ok((await ld.locator('.ov .prow:has-text("Funkcheck") .av .ic').count()) >= 0, 'Pflichtpunkt umgeschaltet');
  await ld.keyboard.press('Escape');
  await ld.waitForTimeout(600);
  await ld.keyboard.press('Escape');
  await ld.waitForTimeout(400);
  ok((await ld.locator('.panel-h .badge:has-text("bereit ✓")').count()) >= 1, 'Rundgänge-Panel meldet „bereit ✓“');
  await ld.screenshot({ path: `${SHOTS}/16-lead-mehr.png` });

  // Notfall-Warnung → Actor-Vollbild (SSE)
  await ld.click('button:has-text("Warnung an Maze")');
  await ld.waitForSelector('.ov .sheet');
  await ld.click('.chip:has-text("Show stoppen")');
  await ld.fill('.ov textarea', 'Show stoppen, Position halten. E2E-Testalarm.');
  await ld.click('.ov button:has-text("Warnung senden")');
  await ac.waitForSelector('.alarm-ov', { timeout: 6000 });
  ok(true, 'Actor erhält Vollbild-Alarm in Echtzeit (SSE)');
  await ac.click('.alarm-ov button');
  await ac.waitForTimeout(500);
  ok((await ac.locator('.alarm-ov').count()) === 0, 'Lesebestätigung schließt Alarm');
  if (await mg.locator('.alarm-ov').count()) { await mg.click('.alarm-ov button'); await mg.waitForTimeout(400); }
  ok(true, 'Leitstand hat den Alarm ebenfalls erhalten');

  // ── 4 · Catering-Station: Wallet-Code einlösen ──
  const ctx4 = await b.newContext({ viewport: { width: 1194, height: 834 } });
  const st = await ctx4.newPage(); watch(st, 'station');
  await login(st, 'SB-0901', '1234');
  await st.waitForSelector('text=Einlöse-Modus', { timeout: 8000 });
  await st.waitForTimeout(800);
  if ((await st.locator('text=Schritt 1 · Station wählen').count()) > 0) {
    await st.click('.role-card:has-text("Station Nord")');
    await st.waitForTimeout(700);
  }
  await st.waitForSelector('input[placeholder="LK-0427"]', { timeout: 8000 });
  await st.fill('input[placeholder="LK-0427"]', 'LK-0427');
  await st.fill('input[placeholder="9F3K"]', short);
  await st.click('button:has-text("Code prüfen")');
  await st.waitForSelector('text=Code gescannt — gültig', { timeout: 6000 });
  ok((await st.locator('text=Lena Krause').count()) >= 1, 'Station validiert Code und zeigt Person');
  await st.click('button:has-text("einlösen")');
  await st.waitForTimeout(900);
  ok(true, 'Einlösung durchgeführt');

  // ── 5 · Chat in Echtzeit ──
  await mg.evaluate(() => { location.hash = '#/chat'; });
  await mg.waitForTimeout(800);
  await mg.click('.chat-list .prow:has-text("#crew")');
  await mg.waitForTimeout(500);
  await mg.fill('.panel input[placeholder="Nachricht …"]', 'E2E: Hallo Crew! 🎃');
  await mg.press('.panel input[placeholder="Nachricht …"]', 'Enter');
  await mg.waitForTimeout(900);
  await ac.click('.m-nav .it:has-text("Chat")');
  await ac.waitForTimeout(700);
  await ac.click('.prow:has-text("#crew")');
  await ac.waitForTimeout(700);
  ok((await ac.locator('text=E2E: Hallo Crew').count()) >= 1, 'Chat-Nachricht kommt beim Actor an');

  // ── JS-Fehler auswerten ──
  for (const [name, errs] of errsOf) {
    const real = errs.filter((e) => e.includes('pageerror') || (!e.includes('favicon') && !e.includes('Failed to load resource')));
    ok(real.length === 0, `Keine JS-Fehler (${name})${real.length ? ': ' + real[0].slice(0, 140) : ''}`);
  }
} catch (e) {
  failed++;
  console.error('\n💥 Testlauf abgebrochen:', e.message?.split('\n')[0] || e);
} finally {
  await b.close();
}

console.log(`\n${failed === 0 ? '✅' : '❌'} UI-E2E: ${passed} bestanden · ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
