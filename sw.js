// Offline rad: sve datoteke se spremaju pri prvom otvaranju.
const CACHE = 'ponude-v3';
const FILES = ['./', 'index.html', 'app.js', 'ponuda-pdf.js', 'config.js', 'vendor/supabase.js', 'vendor/pdfmake.min.js', 'vendor/vfs_fonts.js',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Mreža prvo (da nove verzije stignu odmah), cache kad nema interneta.
self.addEventListener('fetch', (e) => {
  // Samo vlastite datoteke; pozivi prema bazi idu mimo predmemorije.
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
