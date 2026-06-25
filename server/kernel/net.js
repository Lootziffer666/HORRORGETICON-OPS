// Horrorgeticon Ops — Netz-Helfer für den Vor-Ort-Betrieb
// Findet die LAN-Adresse(n), unter denen die Crew den Leitstand erreicht,
// und öffnet auf Wunsch den Browser (Doppelklick-Start ohne Tipparbeit).
import os from 'node:os';
import { spawn } from 'node:child_process';

function isPrivate(ip) {
  return /^10\./.test(ip)
    || /^192\.168\./.test(ip)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

// Alle nutzbaren IPv4-Adressen — private (LAN) zuerst.
export function lanIPv4s() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  const priv = out.filter(isPrivate);
  const rest = out.filter((ip) => !isPrivate(ip));
  return [...priv, ...rest];
}

// Die wahrscheinlichste Beitritts-Adresse fürs Event-WLAN.
export function primaryLanIPv4() {
  return lanIPv4s()[0] || '127.0.0.1';
}

// Beitritts-URL(s), die Phones/Tablets im selben WLAN aufrufen.
export function joinUrls(port) {
  const ips = lanIPv4s();
  if (!ips.length) return [`http://localhost:${port}`];
  return ips.map((ip) => `http://${ip}:${port}`);
}

// Standardbrowser öffnen (plattformübergreifend, best effort).
export function openBrowser(url) {
  const p = process.platform;
  try {
    if (p === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (p === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch { /* kein Browser verfügbar — nicht schlimm, URL steht im Banner */ }
}
