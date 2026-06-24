// Horrorgeticon Ops — Nebenläufigkeits-/Lasttest
// Simuliert eine Crew vieler Geräte gleichzeitig: N Personen anlegen, einloggen,
// je eine Live-Verbindung (SSE) offen halten, dann EINE Durchsage absetzen und
// messen, wie viele Geräte sie in Echtzeit empfangen. Plus Antwortzeiten des
// Lagebilds unter Last.
//
//   node server/test/loadtest.mjs            # Standard: 150 Verbindungen
//   LOAD_N=200 node server/test/loadtest.mjs # eigene Anzahl
//
// Ehrlich: Das misst die SERVER-Software auf DIESER Maschine. Reale Funk-/WLAN-
// Bedingungen vor Ort sind damit nicht abgebildet — aber es zeigt, ob der Server
// die gleichzeitige Last trägt.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const PORT = Number(process.env.LOAD_PORT || 18890);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'hgo-load-'));
const N = Number(process.env.LOAD_N || 150);

const t0 = Date.now();
const log = (...a) => console.log(...a);

async function api(method, p, { token, body } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}

function openSSE(token, onChunk) {
  return new Promise((resolve) => {
    const req = http.request(`${BASE}/api/stream?token=${encodeURIComponent(token)}`, { method: 'GET' }, (res) => {
      res.setEncoding('utf8');
      res.on('data', onChunk);
      res.on('error', () => {});
      resolve({ req, status: res.statusCode });
    });
    req.on('error', () => resolve({ req, status: 0 }));
    req.end();
  });
}

const server = spawn(process.execPath, [path.join(ROOT, 'server/main.js'), '--demo', '--port', String(PORT), '--data', DATA], { stdio: ['ignore', 'ignore', 'ignore'] });

async function waitUp(tries = 80) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return true; } catch { /* */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const sockets = [];
let exitCode = 0;
try {
  if (!await waitUp()) throw new Error('Server kam nicht hoch');
  log(`\nHorrorgeticon Ops — Lasttest  ·  Ziel: ${N} gleichzeitige Live-Verbindungen\n${'─'.repeat(56)}`);

  const mgmt = (await api('POST', '/api/auth/login', { body: { code: 'DR-0001', pin: '4711' } })).json;
  if (!mgmt?.token) throw new Error('Management-Login fehlgeschlagen');

  // 1) N Test-Personen anlegen (mit PIN) + einloggen
  const tStart = Date.now();
  const sessions = [];
  let createFail = 0;
  for (let i = 0; i < N; i++) {
    const pin = '1234';
    const r = await api('POST', '/api/people', { token: mgmt.token, body: { name: `Lasttest Crew ${i + 1}`, roles: ['actor'], pin, ort: 'Laststadt' } });
    if (r.status !== 200 || !r.json?.code) { createFail++; continue; }
    const login = await api('POST', '/api/auth/login', { body: { code: r.json.code, pin } });
    if (login.json?.token) sessions.push({ token: login.json.token, received: false });
  }
  log(`  Personen angelegt & eingeloggt : ${sessions.length}/${N}${createFail ? `  (${createFail} Anlage-Limits)` : ''}`);

  // 2) Je eine SSE-Live-Verbindung öffnen (gleichzeitig halten)
  const MARK = `LASTTEST-PING-${Date.now()}`;
  let connected = 0, refused = 0;
  const opens = sessions.map((s) => openSSE(s.token, (chunk) => { if (chunk.includes(MARK)) s.received = true; })
    .then((res) => { if (res.status === 200) { connected++; sockets.push(res.req); } else if (res.status === 503) { refused++; } }));
  await Promise.all(opens);
  await new Promise((r) => setTimeout(r, 800)); // Verbindungen sich setzen lassen
  log(`  Gleichzeitige Live-Verbindungen: ${connected}${refused ? `  (${refused} am Limit abgewiesen)` : ''}`);

  // 3) Lagebild-Antwortzeit unter Last (Median/Max aus 8 Messungen)
  const lat = [];
  for (let i = 0; i < 8; i++) {
    const a = Date.now();
    await api('GET', '/api/live/overview', { token: mgmt.token });
    lat.push(Date.now() - a);
  }
  lat.sort((x, y) => x - y);
  const median = lat[Math.floor(lat.length / 2)];
  log(`  Lagebild-Antwortzeit (Median)  : ${median} ms   (max ${lat[lat.length - 1]} ms)`);

  // 4) EINE Durchsage an alle → wie viele Geräte empfangen sie live?
  const tBroadcast = Date.now();
  await api('POST', '/api/announcements', { token: mgmt.token, body: { text: MARK, level: 'info' } });
  await new Promise((r) => setTimeout(r, 2500));
  const got = sessions.filter((s) => s.received).length;
  const fanoutMs = Date.now() - tBroadcast;
  log(`  Durchsage live empfangen       : ${got}/${connected} Verbindungen  (innerhalb ${fanoutMs} ms)`);

  log(`${'─'.repeat(56)}`);
  const okConn = connected >= Math.min(N, 150) * 0.95 || connected >= 150;
  const okFan = connected > 0 && got >= connected * 0.95;
  const okLat = median < 500;
  log(`  Verbindungen tragen   : ${okConn ? 'OK' : 'KNAPP'}`);
  log(`  Broadcast erreicht alle: ${okFan ? 'OK' : 'KNAPP'}`);
  log(`  Antwortzeit < 500ms    : ${okLat ? 'OK' : 'ZU LANGSAM'}`);
  log(`\n  Gesamtdauer: ${((Date.now() - tStart) / 1000).toFixed(1)}s\n`);
  if (!(okConn && okFan && okLat)) exitCode = 1;
} catch (e) {
  console.error('Lasttest abgebrochen:', e.message);
  exitCode = 1;
} finally {
  for (const req of sockets) { try { req.destroy(); } catch { /* */ } }
  try { server.kill('SIGKILL'); } catch { /* */ }
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* */ }
}
process.exit(exitCode);
