// Keep core archives reusable, but always serve the live application shell.
// HTML, JavaScript, and CSS are deliberately never written to Cache Storage.
const VERSION = 'ejs-live-14';
const SHELL_CACHE = VERSION + '-shell';
const RUNTIME_CACHE = VERSION + '-runtime';
const CORE_CACHE = VERSION + '-cores';
const MAX_CORES_CACHED = 12;
const SHELL_FILES = ['manifest.webmanifest', 'data/cores/manifest.json', 'docs/Logo-light.png', 'docs/favicon.ico'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL_FILES.map((file) => cache.add(file).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, RUNTIME_CACHE, CORE_CACHE]);
    for (const name of await caches.keys()) {
      if (name.startsWith('ejs-') && !keep.has(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

function isolate(response) {
  if (!response || response.status === 0 || response.type === 'opaque' || response.type === 'opaqueredirect') return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirstLimited(request) {
  const cache = await caches.open(CORE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.status === 200) {
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - MAX_CORES_CACHED; i++) await cache.delete(keys[i]);
  }
  return response;
}

const APP_FILE = /\.(html|js|mjs|css|json|webmanifest|png|ico|svg|txt|md|wasm)$/i;
const NEVER_CACHE = /\.(html|js|mjs|css)$/i;

async function handle(request) {
  const url = new URL(request.url);
  if (NEVER_CACHE.test(url.pathname)) return fetch(request, { cache: 'no-store' });
  if (url.pathname.includes('/data/cores/') && url.pathname.endsWith('.7z')) return cacheFirstLimited(request);
  if (!APP_FILE.test(url.pathname)) return fetch(request);
  return networkFirst(request, RUNTIME_CACHE);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.headers.has('range')) return;
  event.respondWith(handle(request).then(isolate));
});
