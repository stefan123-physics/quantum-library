// Service worker: makes the installed app open instantly and work offline.
// - code & data (HTML, JS, CSS, JSON, manifest): network first, cached copy when offline
// - PDFs, pdf.js, icons, fonts: served from cache, refreshed in the background
const CACHE = 'quantum-library-v4';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'favicon.svg',
  'js/app.js', 'js/i18n.js', 'js/store.js', 'js/search.js', 'js/pdf.js', 'js/lab.js', 'js/bg.js',
  'js/read-aloud.js', 'js/math-speech.js', 'js/voices.js', 'js/tts-fallback.js',
  'data/library.json', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs',
  'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

const FRESH = /\.(html|js|mjs|css|json|webmanifest)$|\/$/;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !isFont) return;

  if (sameOrigin && (req.mode === 'navigate' || FRESH.test(url.pathname)) && !url.pathname.includes('/vendor/')) {
    // network first
    e.respondWith(
      fetch(req)
        .then((res) => {
          // clone now, before the page starts reading the body
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('index.html'))),
    );
    return;
  }

  // stale-while-revalidate
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const cached = await c.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res.ok || res.type === 'opaque') {
            const copy = res.clone();
            c.put(req, copy).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
