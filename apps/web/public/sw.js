/* Agentor service worker (PLAN-MOBILE M3, produktspecifikation §8).
 *
 * - Caches only the app shell: built static assets, icons, logos, fonts and the offline page.
 * - Never caches pages with data, API or server-action responses, auth routes or PDFs. Offline
 *   reading comes from the per-user, per-company snapshot in IndexedDB (aggregates only), which
 *   the /offline page renders.
 * - Shows Web Push messages and opens the screen they point to (same origin only).
 */
const VERSION = 'agentor-shell-v1';
// Registered with ?dev=1 in development: no shell cache, so hot-reloaded chunks are never stale.
const DEV = new URL(self.location.href).searchParams.get('dev') === '1';
const OFFLINE_URL = '/offline';
const PRECACHE = [OFFLINE_URL, '/icons/agentor.svg', '/icons/icon-192.png', '/icons/icon-512.png'];

// The offline page and the scripts it needs, so it renders without a network.
async function precache() {
  const cache = await caches.open(VERSION);
  await cache.addAll(PRECACHE);
  const html = await (await fetch(OFFLINE_URL, { credentials: 'omit' })).text();
  // Paths also appear inside the inline RSC payload as \"…\": stop at quotes and backslashes.
  const assets = [...html.matchAll(/\/_next\/static\/[^"'\s)\\]+/g)].map((m) => m[0]);
  // One missing file must not cost the whole install (the shell then just isn't offline-ready).
  await Promise.all([...new Set(assets)].map((a) => cache.add(a).catch(() => undefined)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const SHELL = /^\/(_next\/static|icons|logos|fonts)\//;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Static, content-hashed shell files: cache first.
  if (SHELL.test(url.pathname) && !DEV) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok && res.type === 'basic') {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Pages: always the network. Offline, show the offline page with the snapshot.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL).then((r) => r || Response.error())),
    );
  }
  // Everything else (RSC payloads, actions, auth, exports) goes to the network untouched.
});

self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' ? data.title : 'Agentor';
  const url =
    typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//')
      ? data.url
      : '/notifications';
  const body = typeof data.body === 'string' ? data.body : '';
  event.waitUntil(
    Promise.all([
      self.registration
        .showNotification(title, {
          body,
          tag: typeof data.tag === 'string' ? data.tag : undefined,
          icon: '/icons/icon-192.png',
          badge: '/icons/badge-96.png',
          data: { url },
          lang: 'da',
        })
        // Notifications blocked: nothing to show, the open app still hears about it below.
        .catch(() => undefined),
      // An open app refreshes its bell and lists at once.
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((list) =>
          list.forEach((c) => c.postMessage({ type: 'agentor:push', title, body, url })),
        ),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/notifications', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === target.origin && 'focus' in c) {
          return c.focus().then(() => ('navigate' in c ? c.navigate(target.href) : undefined));
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});

// The page asks the worker to forget the shell cache on logout (nothing personal is in it, but
// a clean start costs little).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'agentor:logout')
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
});
