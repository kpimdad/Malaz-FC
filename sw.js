/* ═══════════════════════════════════════════════════════
   MALAZ FC WC 2026 — Service Worker
   Strategy: cache shell offline, always fetch Firebase live
   ═══════════════════════════════════════════════════════ */

const CACHE  = 'mfc-wc26-v3';

self.addEventListener('install', e => {
  // Don't pre-cache — always fetch fresh from network
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for everything — never serve stale JS/CSS
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('firestore') ||
      url.hostname.includes('gstatic') ||
      url.hostname.includes('googleapis')) {
    return;
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
