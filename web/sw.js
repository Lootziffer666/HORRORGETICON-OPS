// Horrorgeticon Ops — Service Worker
// Statisches (App-Shell) aus dem Cache, API immer Netz (Live-Daten!).
// Fällt das Netz aus, bleibt die Shell bedienbar und zeigt den Offline-Zustand.
const CACHE = 'hgo-shell-v1';
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest',
  '/css/tokens.css', '/css/ops.css', '/css/app.css',
  '/icons/icon.svg',
  '/fonts/Nunito-VariableFont_wght.ttf',
  '/fonts/DMSans-VariableFont_opsz_wght.ttf',
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
