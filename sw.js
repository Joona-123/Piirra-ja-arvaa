/* Service worker: pitää pelin toimintakykyisenä ja hallitsee välimuistin version. */
var VERSION = '1.5.0';
var CACHE = 'pja-' + VERSION;
var FILES = [
  './', './index.html', './styles.css', './app.js', './engine.js', './net.js',
  './draw.js', './qr.js', './words.js', './version.json', './manifest.json',
  './vendor/peerjs.min.js', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;               // PeerJS-liikenne ohi välimuistin
  if (url.pathname.indexOf('version.json') !== -1) return;  // versiotarkistus aina verkosta
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      }).catch(function () { return caches.match('./index.html'); });
    })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
