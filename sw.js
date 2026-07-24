// VibeTracker service worker — offline app-shell + auto-update.
//
// Strategy:
//   - Entry point (index.html, /): NETWORK-FIRST so the latest ?v=N script/style URLs load
//     when online. Falls back to cache when offline.
//   - Versioned assets (board.js?v=N, board.css?v=N, supabase.js?v=N): cache-first with
//     background refresh. Pre-cached during install so offline reloads work immediately.
//   - Static assets (icon.svg, manifest): cache-first.
//   - CDN scripts / fonts: cache-first with background refresh.
//   - Supabase API + Realtime + Storage: network-only (app handles offline via localStorage).
//
// IMPORTANT: bump BOTH APP_VERSION (matches ?v= in index.html) AND CACHE_VERSION on every deploy.

const APP_VERSION = 214;
const CACHE_VERSION = 'vt-v' + APP_VERSION;

const APP_SHELL = [
  './',
  './index.html',
  './board.css?v=' + APP_VERSION,
  './board.js?v=' + APP_VERSION,
  './supabase.js?v=' + APP_VERSION,
  './icon.svg',
  './manifest.webmanifest',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // Use allSettled so one failed pre-cache doesn't abort install.
    await Promise.allSettled(APP_SHELL.map(async url => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if(res && (res.ok || res.type === 'opaque')) await cache.put(url, res);
      } catch(e){ /* skip — will be fetched on demand */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if(event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isSupabaseRequest(url){
  return url.includes('supabase.co/')
      || url.includes('/rest/v1/')
      || url.includes('/auth/v1/')
      || url.includes('/realtime/v1/')
      || url.includes('/storage/v1/');
}

function isEntryPoint(req){
  if(req.mode === 'navigate') return true;
  const u = new URL(req.url);
  if(u.origin !== self.location.origin) return false;
  const p = u.pathname;
  return p === '/' || p.endsWith('/') || p.endsWith('/index.html');
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = req.url;

  // Supabase API + realtime + storage: always network. Offline is handled by the app.
  if(isSupabaseRequest(url)) return;

  // Entry point: NETWORK-FIRST. Ensures latest ?v= script URLs load whenever online.
  if(isEntryPoint(req)){
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      try {
        const res = await fetch(req);
        if(res && res.status === 200) cache.put(req, res.clone()).catch(()=>{});
        return res;
      } catch(e){
        const cached = await cache.match(req) || await cache.match('./index.html') || await cache.match('./');
        return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // Everything else (versioned JS/CSS, icon, manifest, CDN): cache-first, background refresh.
  // ignoreSearch=false so ?v=N is respected — a v-mismatch triggers a proper network fetch.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req);
    const fetchPromise = fetch(req).then(res => {
      if(res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')){
        cache.put(req, res.clone()).catch(()=>{});
      }
      return res;
    }).catch(() => cached);
    return cached || fetchPromise;
  })());
});
