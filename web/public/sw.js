// SIGAM-INABVE · service worker: la aplicación abre aunque no haya conexión.
// Los datos NO se guardan aquí (van por Supabase); solo los archivos de la aplicación.
const VERSION = 'sigam-__BUILD__';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(['/', '/index.html', '/manifest.webmanifest',
    '/img/inabve-blanco.png', '/img/inabve-color.png', '/img/gobierno-blanco.png', '/icons/icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;     // Supabase y otros: siempre a la red
  if (e.request.mode === 'navigate') {                                           // páginas: red primero, si no hay, la copia
    e.respondWith(fetch(e.request).then(r => { caches.open(VERSION).then(c => c.put('/index.html', r.clone())); return r; })
      .catch(() => caches.match('/index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/img/') || url.pathname.startsWith('/icons/'))) {
      const copia = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copia));
    }
    return r;
  })));
});
