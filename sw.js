// VibeTracker service worker — app-shell caching for offline use.
//
// Strategy:
//   - Same-origin static assets (HTML/CSS/JS/icon/manifest/fonts): cache-first, refresh in background.
//   - Supabase API + Storage + Realtime: network-only. App's localStorage cache provides offline data;
//     queued mutations retry when the 'online' event fires (handled in supabase.js).
//   - CDN scripts/fonts (jsdelivr, Google Fonts): cache-first with network update.
//
// Bump CACHE_VERSION when you ship changes that the SW must invalidate.

const CACHE_VERSION = 'vt-v3';
const APP_SHELL = [
  './',
  './index.html',
  './board.css',
  './board.js',
  './supabase.js',
  './icon.svg',
  './manifest.webmanifest',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

function isSupabaseRequest(url){
  return url.includes('supabase.co/')
      || url.includes('/rest/v1/')
      || url.includes('/auth/v1/')
      || url.includes('/realtime/v1/')
      || url.includes('/storage/v1/');
}

function isAppShellOrigin(url){
  // Same-origin requests we want to cache (the GitHub Pages host).
  try {
    const u = new URL(url);
    return u.origin === self.location.origin;
  } catch(e){ return false; }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return; // never cache writes
  const url = req.url;

  // Supabase: always network. If offline, the app handles the failure via its localStorage cache.
  if(isSupabaseRequest(url)) return;

  // App-shell / CDN: cache-first, with background refresh (stale-while-revalidate).
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req, { ignoreSearch: true });
    const fetchPromise = fetch(req).then(res => {
      // Cache successful, non-opaque, GET responses for next time.
      if(res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')){
        cache.put(req, res.clone()).catch(()=>{});
      }
      return res;
    }).catch(() => cached); // offline → fall back to cache
    return cached || fetchPromise;
  })());
});
