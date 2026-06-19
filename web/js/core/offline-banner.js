// Offline-Banner: zeigt dauerhaft den Verbindungsstatus an (kein Toast).
import { on, store } from './store.js';

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
