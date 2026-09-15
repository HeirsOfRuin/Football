// Service worker: makes Touchline installable and playable with no network.
//
// The game is already a static module graph with no backend, so "works offline"
// is almost true by default — it only needs its own files kept somewhere. The
// approach here is deliberately not a generated precache manifest: this project
// has no build step, and a hardcoded list of fifty module paths is a list that
// goes stale the first time a file is added, silently, with nothing failing.
//
// Instead a tiny shell is precached, and every same-origin GET the app makes is
// cached as it goes. Every module in the graph is fetched during the first load
// — it is one `import` tree from `app.js` — so one online visit populates the
// whole cache without anyone maintaining a list.

// Bump to invalidate every cached file. Anything cached under an older name is
// deleted on activate, so a stale module can never be served alongside a new one.
const CACHE = 'touchline-v1';

// The few files without which nothing can start.
const SHELL = [
  './',
  './index.html',
  './styles/main.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll rejects the whole batch if one file 404s, which would leave the
    // worker uninstalled and the failure invisible. Each file is added on its
    // own so a missing icon cannot take the app shell down with it.
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') { self.skipWaiting(); return; }
  // The page tells the worker what it actually loaded.
  //
  // This is here because of a measured failure: on a first visit the worker is
  // not yet controlling the page when the module graph is imported, so those
  // fifty fetches never pass through `fetch` above and only seven files ended
  // up cached. Offline still appeared to work, off the browser's own HTTP
  // cache, which is exactly the kind of accident that holds until it does not.
  //
  // The page reports its real resource list from the Performance API, so the
  // set cached is whatever the app genuinely loaded - no hardcoded manifest to
  // go stale the first time a module is added, and no build step to generate
  // one.
  if (event.data?.type === 'cache-these' && Array.isArray(event.data.urls)) {
    event.waitUntil(cacheAll(event.data.urls));
  }
});

async function cacheAll(urls) {
  const cache = await caches.open(CACHE);
  await Promise.all(urls.map(async (url) => {
    try {
      if (new URL(url, self.location.href).origin !== self.location.origin) return;
      if (await cache.match(url)) return;
      const res = await fetch(url, { cache: 'reload' });
      if (res && res.ok) await cache.put(url, res.clone());
    } catch {
      // One file failing to cache is not a reason to abandon the rest.
    }
  }));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    // Cache first. For a game with no server this is the right way round: the
    // cached copy is the application, not a stale view of something live.
    if (cached) {
      // Refresh in the background so a reload picks up a new build without the
      // player ever waiting on the network.
      event.waitUntil(update(req));
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      // Offline and not cached. A navigation gets the shell, which is enough to
      // start the game; anything else genuinely cannot be served.
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});

async function update(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic') {
      const cache = await caches.open(CACHE);
      await cache.put(req, res.clone());
    }
  } catch {
    // Offline: the cached copy stands. Nothing to report.
  }
}
