/* ═══════════════════════════════════════════════════════
   MALAZ FC WC 2026 — Service Worker
   Strategy: cache shell offline, always fetch Firebase live
   ═══════════════════════════════════════════════════════ */

const CACHE  = 'mfc-wc26-v1';
const STATIC = ['/', '/index.html', '/style.css', '/app.js', '/matches.js', '/firebase-config.js', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Always fetch Firebase live — don't cache Firestore/gstatic
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('firestore') ||
      url.hostname.includes('gstatic') ||
      url.hostname.includes('googleapis')) {
    return; // fall through to network
  }
  // Cache-first for static shell
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
