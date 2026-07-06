// FlashMind service worker — app-shell caching for offline study of saved decks.
// Bump CACHE when any shell asset changes so clients pick up the new version.
const CACHE = 'flashmind-v5';

// Same-origin shell assets. Third-party (PDF.js CDN) and API/worker calls are
// intentionally excluded — they fall through to the network.
const SHELL = [
  './',
  './index.html',
  './css/main.css',
  './css/notes.css',
  './css/cards.css',
  './css/quiz.css',
  './css/exam.css',
  './css/profile.css',
  './css/chat.css',
  './css/library.css',
  './css/fx.css',
  './js/i18n.js',
  './js/fx.js',
  './js/sound.js',
  './js/palette.js',
  './js/tts.js',
  './js/sync.js',
  './js/decks.js',
  './js/stats.js',
  './js/demo.js',
  './js/api.js',
  './js/parser.js',
  './js/pdf.js',
  './js/notes.js',
  './js/flashcards.js',
  './js/quiz.js',
  './js/chat.js',
  './js/search.js',
  './js/profile.js',
  './js/export.js',
  './js/shell.js',
  './js/library.js',
  './js/app.js',
  './assets/favicon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Only serve same-origin GETs from cache; let everything else hit the network
  // (API generation/sharing, CDN scripts) so we never serve stale API data.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Runtime-cache successful same-origin responses for next time.
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
