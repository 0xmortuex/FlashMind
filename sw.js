// FlashMind service worker — app-shell caching for offline study of saved decks.
// Bump CACHE when any shell asset changes so clients pick up the new version.
const CACHE = 'flashmind-v31';

// data/meb/sets/*.json (one study set per MEB file, up to ~450 KB each) is NOT
// listed here: it is cached at runtime when opened, keeping the last SETS_KEEP.
const SETS_PATH = '/data/meb/sets/';
const SETS_KEEP = 12;
// Same for the scenario banks (data/meb/scen/bank/*.json, up to ~200 KB each). The scenario
// index and specs (data/meb/scen/index.json, spec/*.json) are small and cached at runtime, never precached.
const BANKS_PATH = '/data/meb/scen/bank/';
const BANKS_KEEP = 12;

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
  './css/juice.css',
  './css/studio.css',
  './css/exams.css',
  './css/meb.css',
  './css/class.css',
  './js/i18n-class.js',
  './js/class-core.js',
  './js/classroom.js',
  './js/battle.js',
  './js/i18n.js',
  './js/i18n-exams.js',
  './js/i18n-meb.js',
  './js/i18n-scen.js',
  './js/i18n-topics.js',
  './css/labs.css',
  './js/i18n-studio5.js',
  './css/coach.css',
  './js/i18n-coach.js',
  './css/live.css',
  './js/i18n-live.js',
  './js/fx.js',
  './js/sound.js',
  './js/palette.js',
  './js/tts.js',
  './js/sync.js',
  './js/decks.js',
  './js/stats.js',
  './js/demo.js',
  './js/api.js',
  './js/simspec.js',
  './js/parser.js',
  './js/pdf.js',
  './js/ocr.js',
  './js/today.js',
  './js/sources.js',
  './js/math.js',
  './js/mindmap.js',
  './js/audio.js',
  './js/labs.js',
  './js/lesson.js',
  './js/topics.js',
  './js/notes.js',
  './js/occlusion.js',
  './js/checker.js',
  './js/adaptive.js',
  './js/insights.js',
  './js/planner.js',
  './js/memory.js',
  './js/predictor.js',
  './js/concepts.js',
  './js/coach.js',
  './js/focus.js',
  './js/flashcards.js',
  './js/quiz.js',
  './js/pastpaper.js',
  './js/mebindex.js',
  './js/storageguard.js',
  './js/mebsets.js',
  './js/scenarioset.js',
  './js/mebscen.js',
  './js/paperreview.js',
  './js/handwrite.js',
  './js/chat.js',
  './js/live-core.js',
  './js/camera.js',
  './js/voice.js',
  './js/lecture.js',
  './js/worklets/voice-capture.js',
  './js/worklets/voice-playback.js',
  './js/search.js',
  './js/profile.js',
  './js/export.js',
  './js/shell.js',
  './js/library.js',
  './js/gallery.js',
  './js/app.js',
  './assets/favicon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './manifest.webmanifest'
];

// Oldest cached study sets (or scenario banks) go first (cache keys are in insertion order).
async function trimSets(cache, path = SETS_PATH, keep = SETS_KEEP) {
  const keys = (await cache.keys()).filter((r) => new URL(r.url).pathname.includes(path));
  await Promise.all(keys.slice(0, Math.max(0, keys.length - keep)).map((r) => cache.delete(r)));
}

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
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('flashmind-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // KaTeX (math typesetting) is versioned and immutable: cache-first so
  // formulas still render offline once they've been seen.
  if (url.origin === 'https://cdnjs.cloudflare.com' && url.pathname.startsWith('/ajax/libs/KaTeX/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) event.waitUntil(cache.put(req, res.clone()).catch(() => {}));
        return res;
      })
    );
    return;
  }
  // Only serve same-origin GETs from cache; let everything else hit the network
  // (API generation/sharing, CDN scripts) so we never serve stale API data.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Runtime-cache successful same-origin responses for next time.
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          const isSet = url.pathname.includes(SETS_PATH), isBank = url.pathname.includes(BANKS_PATH);
          event.waitUntil(cache.put(req, copy).then(() => (isSet && trimSets(cache)) || (isBank && trimSets(cache, BANKS_PATH, BANKS_KEEP))).catch(() => {}));
        }
        return res;
      }).catch(async () => {
        if (req.mode === 'navigate') {
          const shell = await cache.match('./index.html');
          if (shell) return shell;
        }
        return Response.error();
      });
    })
  );
});
