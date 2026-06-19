#!/usr/bin/env node
// Horrorgeticon Ops -- Load Test
// Simulates 150+ concurrent SSE connections with parallel API calls.
// Zero dependencies -- uses only native Node.js APIs.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const PORT = 18793;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'hgo-load-'));

// ─── Helpers ───

async function apiFetch(method, urlPath, { token, body } = {}) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: res.status, json, text };
}

function sseConnect(token) {
  return new Promise((resolve) => {
    const url = new URL(`${BASE}/api/stream`);
    const opts = {
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/stream',
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
    };
    const req = http.get(opts, (res) => {
      if (res.statusCode !== 200) {
        resolve({ connected: false, status: res.statusCode, req, res });
        return;
      }
      // Keep alive -- just drain data
      res.on('data', () => {});
      resolve({ connected: true, status: 200, req, res });
    });
    req.on('error', () => resolve({ connected: false, status: 0, req, res: null }));
    req.setTimeout(5000, () => resolve({ connected: false, status: 0, req, res: null }));
  });
}

function destroySSE(conn) {
  try { conn.req?.destroy(); } catch { /* ignore */ }
  try { conn.res?.destroy(); } catch { /* ignore */ }
}

async function waitUp(tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(Math.floor(sorted.length * p), sorted.length - 1);
  return sorted[idx];
}

// ─── Main ───

async function main() {
  console.log('=== Horrorgeticon Ops -- Load Test ===\n');
  console.log(`Port: ${PORT} | Data: ${DATA}`);

  // Start server
  const server = spawn(process.execPath, [
    path.join(ROOT, 'server/main.js'), '--demo', '--port', String(PORT), '--data', DATA,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});

  let exitCode = 0;
  try {
    console.log('Starting server...');
    const up = await waitUp();
    if (!up) { console.error('Server failed to start'); process.exit(1); }
    console.log('Server ready.\n');

    // ─── Phase 1: Login as management ───
    const mgmt = (await apiFetch('POST', '/api/auth/login', { body: { code: 'DR-0001', pin: '4711' } })).json;
    if (!mgmt?.token) { console.error('Management login failed'); process.exit(1); }
    console.log('Management login OK.');

    // ─── Phase 2: Create 50 temporary actors with PINs ───
    const ACTOR_COUNT = 50;
    const TEST_PIN = '0000';
    console.log(`Creating ${ACTOR_COUNT} temporary test actors...`);
    const actors = [];
    for (let i = 0; i < ACTOR_COUNT; i++) {
      const res = await apiFetch('POST', '/api/people', {
        token: mgmt.token,
        body: { name: `LoadTest Actor ${i}`, roles: ['actor'], pin: TEST_PIN, ort: 'Teststadt' },
      });
      if (res.json?.id && res.json?.code) {
        actors.push(res.json);
      }
    }
    console.log(`Created ${actors.length} actors.`);

    // ─── Phase 3: Login each actor ───
    console.log('Logging in actors...');
    const tokens = [];
    for (const actor of actors) {
      const res = await apiFetch('POST', '/api/auth/login', { body: { code: actor.code, pin: TEST_PIN } });
      if (res.json?.token) tokens.push(res.json.token);
    }
    // Add management token
    tokens.push(mgmt.token);
    console.log(`Obtained ${tokens.length} tokens.\n`);

    // ─── Phase 4: Open SSE connections (3 per person, up to 150+) ───
    const SSE_PER_TOKEN = 3;
    const TARGET_SSE = Math.min(tokens.length * SSE_PER_TOKEN, 160);
    console.log(`Opening ${TARGET_SSE} SSE connections (${SSE_PER_TOKEN} per token)...`);

    const sseConns = [];
    let sseConnected = 0;
    let sseFailed = 0;

    for (let i = 0; i < TARGET_SSE; i++) {
      const tokenIdx = Math.floor(i / SSE_PER_TOKEN) % tokens.length;
      const conn = await sseConnect(tokens[tokenIdx]);
      sseConns.push(conn);
      if (conn.connected) sseConnected++;
      else sseFailed++;
    }
    console.log(`SSE: ${sseConnected} connected, ${sseFailed} rejected/failed.`);

    // Small wait for SSE to settle
    await new Promise((r) => setTimeout(r, 500));

    // ─── Phase 5: Parallel API calls (heartbeats, incidents, breaks) ───
    const API_CALLS = 200;
    console.log(`\nFiring ${API_CALLS} parallel API calls (heartbeats, incidents, breaks)...`);

    const latencies = [];
    const errors = [];

    const calls = [];
    for (let i = 0; i < API_CALLS; i++) {
      const token = tokens[i % tokens.length];
      const kind = i % 3;
      let promise;
      if (kind === 0) {
        // Heartbeat
        promise = (async () => {
          const t0 = performance.now();
          const r = await apiFetch('POST', '/api/live/heartbeat', { token, body: {} });
          const dt = performance.now() - t0;
          return { dt, ok: r.status < 400 };
        })();
      } else if (kind === 1) {
        // Incident
        promise = (async () => {
          const t0 = performance.now();
          const r = await apiFetch('POST', '/api/incidents', {
            token,
            body: { kind: 'sonstiges', prio: 'niedrig', text: `Load test incident ${i}` },
          });
          const dt = performance.now() - t0;
          return { dt, ok: r.status < 400 };
        })();
      } else {
        // Break request
        promise = (async () => {
          const t0 = performance.now();
          const r = await apiFetch('POST', '/api/breaks', {
            token,
            body: { durationMin: 10, note: `Load test break ${i}` },
          });
          const dt = performance.now() - t0;
          return { dt, ok: r.status < 400 };
        })();
      }
      calls.push(promise);
    }

    const results = await Promise.all(calls);
    for (const r of results) {
      latencies.push(r.dt);
      if (!r.ok) errors.push(r);
    }

    // ─── Phase 6: Check SSE stability ───
    // Brief wait then see how many connections are still open
    await new Promise((r) => setTimeout(r, 300));
    let sseStillAlive = 0;
    for (const conn of sseConns) {
      if (conn.connected && conn.res && !conn.res.destroyed) sseStillAlive++;
    }

    // ─── Phase 7: Summary ───
    latencies.sort((a, b) => a - b);
    const p50 = percentile(latencies, 0.5);
    const p95 = percentile(latencies, 0.95);
    const p99 = percentile(latencies, 0.99);
    const avg = latencies.reduce((s, v) => s + v, 0) / latencies.length;

    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║           LOAD TEST SUMMARY                      ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║ SSE Connections Target:   ${TARGET_SSE.toString().padStart(5)}               ║`);
    console.log(`║ SSE Connected:            ${sseConnected.toString().padStart(5)}               ║`);
    console.log(`║ SSE Rejected/Failed:      ${sseFailed.toString().padStart(5)}               ║`);
    console.log(`║ SSE Still Alive:          ${sseStillAlive.toString().padStart(5)}               ║`);
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║ API Calls:                ${API_CALLS.toString().padStart(5)}               ║`);
    console.log(`║ API Errors:               ${errors.length.toString().padStart(5)}               ║`);
    console.log(`║ Avg Latency:           ${avg.toFixed(1).padStart(8)} ms          ║`);
    console.log(`║ p50 Latency:           ${p50.toFixed(1).padStart(8)} ms          ║`);
    console.log(`║ p95 Latency:           ${p95.toFixed(1).padStart(8)} ms          ║`);
    console.log(`║ p99 Latency:           ${p99.toFixed(1).padStart(8)} ms          ║`);
    console.log('╚══════════════════════════════════════════════════╝');

    // ─── Failure threshold ───
    const apiCalls = API_CALLS;
    const apiErrors = errors.length;
    if (sseConnected < 100 || apiErrors > apiCalls * 0.5) {
      process.exitCode = 1;
      if (sseConnected < 100) console.warn(`\n⚠ Only ${sseConnected} SSE connections established (target: 150+). Check MAX_CLIENTS setting.`);
      if (apiErrors > apiCalls * 0.5) console.warn(`\n⚠ API error rate too high: ${apiErrors}/${apiCalls} (>${Math.round(apiCalls * 0.5)} threshold).`);
    }

    // ─── Cleanup SSE ───
    for (const conn of sseConns) destroySSE(conn);

  } catch (err) {
    console.error('Load test error:', err);
    exitCode = 1;
  } finally {
    server.kill('SIGTERM');
    // Give it a moment to shut down
    await new Promise((r) => setTimeout(r, 500));
    try { server.kill('SIGKILL'); } catch { /* already dead */ }
    // Clean up temp data
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log('\nDone.');
  process.exit(exitCode);
}

main();
