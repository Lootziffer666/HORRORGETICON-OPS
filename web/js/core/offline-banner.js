// Offline-Banner: zeigt dauerhaft den Verbindungsstatus an (kein Toast).
import { on, store } from './store.js';
import { get } from './api.js';

let banner = null;
let hideTimer = null;

function show(text, cls) {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'offline-banner';
    document.body.appendChild(banner);
  }
  banner.textContent = text;
  banner.className = 'offline-banner ' + cls;
  banner.style.opacity = '1';
}

function hide() {
  if (!banner) return;
  banner.style.opacity = '0';
  hideTimer = setTimeout(() => { banner?.remove(); banner = null; hideTimer = null; }, 400);
}

export function initOfflineBanner() {
  on('online', (ok) => {
    if (!ok) {
      show('Verbindung unterbrochen \u2014 Reconnect l\u00e4uft\u2026', 'err');
    } else {
      show('Wieder verbunden \u2713', 'ok');
      hideTimer = setTimeout(hide, 3000);
    }
  });
  // Falls beim Start bereits offline
  if (!store.online) {
    show('Verbindung unterbrochen \u2014 Reconnect l\u00e4uft\u2026', 'err');
  }
}

// ───────── Live-Lagestatus-Banner ─────────
// Dauerhaft sichtbares, vom Leitstand gesetztes Banner ("Wetter-Stopp",
// "Start verzögert · nächste Info ~18:00") — auf JEDEM Gerät, unübersehbar.
let lageEl = null;
function renderLage(lage) {
  if (!lage || !lage.text) {
    lageEl?.remove(); lageEl = null;
    document.body.classList.remove('has-lage');
    return;
  }
  if (!lageEl) {
    lageEl = document.createElement('div');
    document.body.appendChild(lageEl);
  }
  const lvl = lage.level === 'stop' ? 'stop' : lage.level === 'info' ? 'info' : 'warn';
  const icon = lage.level === 'stop' ? '\u23F8' : lage.level === 'info' ? '\u2139' : '\u26A0';
  lageEl.className = 'lage-banner ' + lvl;
  lageEl.replaceChildren();
  const main = document.createElement('span');
  main.textContent = `${icon}  ${lage.text}`;
  lageEl.appendChild(main);
  if (lage.nextInfoAt) {
    const n = document.createElement('span');
    n.className = 'next';
    n.textContent = `\u00B7  n\u00e4chste Info ~${lage.nextInfoAt}`;
    lageEl.appendChild(n);
  }
  document.body.classList.add('has-lage');
}

export function initLageBanner() {
  renderLage(store.settings?.lage);
  // Bei jeder Einstellungs-Änderung den aktuellen Stand frisch holen.
  on('settings', async () => {
    try {
      const s = await get('/api/settings');
      store.settings = s;
      renderLage(s?.lage);
    } catch { /* offline — beim Reconnect erneut */ }
  });
}
