/* First Outpost service worker: lets the game start without a connection
   after it has been opened once. Only files from this site are stored.

   The build (see vite.config.ts) fills in the two values below: a fingerprint
   of the site files and the list of those files. */
const BUILD = '__BUILD__';
const FILES = /*__FILES__*/ [];
const PREFIX = 'first-outpost-';
const CACHE = PREFIX + BUILD;
// Each address has one version, so a saved copy fits whatever headers the request has.
const ANY = { ignoreVary: true };

// First visit: save every file of the game, so the next start needs no network.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // All or nothing, checked with the server (unchanged files come back as a short 304):
      // a half-saved copy must never replace a whole one.
      .then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: 'no-cache' })))),
    // No skipWaiting: a new build takes over when the old game's tabs are closed. A tab that is still running
    // the old code keeps its own saved files (the pieces it loads later, like the room games, have old names).
  );
});

// A new build: drop the copies saved by older builds of this game (and only those).
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((name) => name.startsWith(PREFIX) && name !== CACHE).map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// The page names the big files it actually used (3D models for this device's quality level).
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'keep' || !Array.isArray(data.urls)) return;
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        data.urls.map((url) => cache.match(url, ANY).then((hit) => hit || cache.add(url).catch(() => undefined))),
      ),
    ),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // NASA requests always go to the network
  if (url.pathname.endsWith('/sw.js')) return; // never keep an old copy of this file

  // Pages and the daily data file: newest first, saved copy when offline.
  const fresh = request.mode === 'navigate' || url.pathname.endsWith('spaceweather-latest.json');
  if (fresh) {
    const network = fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        // One saved page for all addresses (?play=... and other query strings would each add a copy).
        // (only for pages: a data file or an image opened in a tab must not replace the start page)
        const isPage = request.mode === 'navigate' && (response.headers.get('content-type') || '').includes('text/html');
        const key = isPage ? './' : request;
        caches.open(CACHE).then((cache) => cache.put(key, copy));
      }
      return response;
    });
    network.catch(() => undefined); // a late failure after the saved copy was used is fine
    const saved = () => caches.match(request, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || caches.match('./', ANY));
    // A network that answers slowly (weak Wi-Fi) should not keep a child waiting: after 4 s, use the saved copy.
    const slow = new Promise((resolve) => setTimeout(() => resolve('slow'), 4000));
    event.respondWith(
      Promise.race([network, slow]).then(
        (first) => (first === 'slow' ? saved().then((hit) => hit || network) : first),
        () => saved(),
      ),
    );
    return;
  }

  // Everything else has a unique name per build: saved copy first.
  event.respondWith(
    caches.match(request, ANY).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
