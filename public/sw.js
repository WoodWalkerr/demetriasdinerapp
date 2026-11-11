// Demetria's Diner: makes the website installable ("Add to Home Screen") and opens it with no signal.
// Always asks the network first, so menus, prices and orders are never stale. Never touches /api/
// (orders, payments, staff) or anything that isn't a plain GET. Only the customer pages are cached.
const CACHE = 'dd-v1';
const SHELL = ['/', '/css/site.css', '/js/site.js', '/icons/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/staff')) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (req.mode === 'navigate' || SHELL.includes(url.pathname) || url.pathname.startsWith('/icons/'))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? '/' : req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req.mode === 'navigate' ? '/' : req).then((r) => r || caches.match('/'))),
  );
});