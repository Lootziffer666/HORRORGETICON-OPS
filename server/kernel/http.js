// Horrorgeticon Ops — HTTP-Schicht: Router, Body-Parsing, statische Dateien.
// Jede Route gehört einem Modul; der Kernel entscheidet, ob das Modul gerade läuft.
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from './util.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

export class Router {
  constructor() { this.routes = []; }

  add(method, pattern, handler, meta = {}) {
    const parts = pattern.split('/').filter(Boolean);
    this.routes.push({ method, pattern, parts, handler, meta });
  }

  match(method, pathname) {
    const segs = pathname.split('/').filter(Boolean);
    outer:
    for (const r of this.routes) {
      if (r.method !== method || r.parts.length !== segs.length) continue;
      const params = {};
      for (let i = 0; i < segs.length; i++) {
        const p = r.parts[i];
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]);
        else if (p !== segs[i]) continue outer;
      }
      return { route: r, params };
    }
    return null;
  }
}

export function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new ApiError(413, 'Anfrage zu groß')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function parseBody(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  const ct = (req.headers['content-type'] || '').split(';')[0].trim();
  if (ct === 'application/json' || ct === '') {
    try { return JSON.parse(raw.toString('utf8')); }
    catch { throw new ApiError(400, 'Ungültiges JSON im Anfrage-Body'); }
  }
  if (ct.startsWith('text/')) return { text: raw.toString('utf8') };
  return { raw };
}

export function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

export function sendText(res, status, text, contentType = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store', ...headers });
  res.end(text);
}

export function serveStatic(res, rootDir, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';
  const abs = path.normalize(path.join(rootDir, rel));
  if (!abs.startsWith(path.normalize(rootDir))) { sendText(res, 403, 'Verboten'); return true; }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return false;
  const ext = path.extname(abs).toLowerCase();
  const immutable = ext === '.ttf' || ext === '.woff2' || ext === '.png' || ext === '.webp';
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=604800' : 'no-cache',
  });
  res.end(fs.readFileSync(abs));
  return true;
}
