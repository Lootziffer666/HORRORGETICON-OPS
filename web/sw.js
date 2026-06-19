// Horrorgeticon Ops — Service Worker
// Statisches (App-Shell) aus dem Cache, API immer Netz (Live-Daten!).
// Fällt das Netz aus, bleibt die Shell bedienbar und zeigt den Offline-Zustand.
const CACHE = 'hgo-shell-v2';
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest',
  '/css/tokens.css', '/css/ops.css', '/css/app.css',
  '/icons/icon.svg',
  '/fonts/Nunito-VariableFont_wght.ttf',
  '/fonts/DMSans-VariableFont_opsz_wght.ttf',
  '/js/app.js',
  '/js/core/api.js',
  '/js/core/dom.js',
  '/js/core/fmt.js',
  '/js/core/offline-banner.js',
  '/js/core/qr.js',
  '/js/core/store.js',
  '/js/core/ui.js',
  '/js/shell/desktop.js',
  '/js/shell/login.js',
  '/js/shell/phone.js',
  '/js/shell/station.js',
  '/js/shell/tablet.js',
  '/js/views/alarm.js',
  '/js/views/announce.js',
  '/js/views/attendance.js',
  '/js/views/backups.js',
  '/js/views/breaks.js',
  '/js/views/carpool.js',
  '/js/views/catering_mgmt.js',
  '/js/views/chat.js',
  '/js/views/dashboard.js',
  '/js/views/dbadmin.js',
  '/js/views/documents.js',
  '/js/views/incidents.js',
  '/js/views/kidsday.js',
  '/js/views/livemap.js',
  '/js/views/mazes.js',
  '/js/views/modules.js',
  '/js/views/people.js',
  '/js/views/profile.js',
  '/js/views/reports.js',
  '/js/views/schedule.js',
  '/js/views/settings.js',
  '/js/views/shared.js',
  '/js/views/tasks.js',
  '/js/views/timeline.js',
  '/js/views/wallet.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return; // API: nie cachen
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit || caches.match('/index.html'));
      return hit || net;
    }),
  );
});
