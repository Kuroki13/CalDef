/**
 * CalDef service worker.
 *
 * Deliberately small. Its whole job is to make an installed app open into
 * something rather than a browser error when the network is missing — an
 * installed icon that leads to "You are not connected" is worse than no
 * install at all.
 *
 * What it will NOT do, and why:
 *
 * - It never caches a navigation response. Every page in this app is
 *   personal: a diary, a weight history, a target. Storing a rendered page
 *   would leave one user's figures on disk for whoever opens the browser
 *   next, and would show stale numbers as though they were today's.
 * - It never touches `/api/*`. Those responses are per-user and, for the
 *   provider routes, quota-metered. Serving a cached answer would hide both.
 * - It never caches an authenticated fetch, because it never caches
 *   anything that is not a hashed static asset.
 *
 * So: static assets are cache-first (their URLs contain a content hash, so a
 * stale one cannot exist), and navigations are network-only with a fallback
 * to a static offline page.
 */

const VERSION = "caldef-v1";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

const OFFLINE_URL = "/offline";

/** Precached at install so the fallback is available before the first miss. */
const SHELL_URLS = [OFFLINE_URL, "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_URLS))
      // Taking over immediately is safe here: there is no old worker with
      // incompatible caches, and waiting would leave the first install
      // without a fallback until the next visit.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only GET. A POST is a write — replaying or caching one would be a bug
  // with consequences, not a slow page.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Same origin only. A cross-origin request here would be a font or an
  // analytics call this app does not make.
  if (url.origin !== self.location.origin) return;

  // Never the API: per-user, and quota-metered upstream.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkThenOfflinePage(request));
    return;
  }

  if (isImmutableAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

/**
 * Hashed build output and the icons.
 *
 * `/_next/static/*` filenames contain a content hash, so a cached copy can
 * never be stale — a changed file is a changed URL. The icons are not
 * hashed, but they change about once a project and the version prefix on
 * the cache name clears them on the next worker.
 */
function isImmutableAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    /^\/(icon|apple-touch-icon)[\w-]*\.png$/.test(pathname)
  );
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  // Only a clean 200 is worth keeping. An opaque or partial response cached
  // here would be served forever under a URL that looks fine.
  if (response.ok && response.type === "basic") {
    const cache = await caches.open(ASSETS);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkThenOfflinePage(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(OFFLINE_URL);
    // If even the fallback is missing, let the browser show its own error
    // rather than inventing a response.
    return cached ?? Response.error();
  }
}
