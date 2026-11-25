const CACHE_NAME = 'drama-team-shell-v3';
const APP_SHELL = [
  '/',
  '/index.html',
  '/about.html',
  '/contact.html',
  '/contributions.html',
  '/store.html',
  '/login.html',
  '/404.html',
  '/photos/logo.png',
  '/site.webmanifest'
];

function isFunctionRequest(url) {
  return url.pathname.startsWith('/.netlify/functions/') || url.pathname.startsWith('/netlify/functions/');
}

function isStaticAsset(request, url) {
  return ['script', 'style', 'image', 'font', 'manifest', 'worker'].includes(request.destination) ||
    /\.(?:css|js|mjs|png|jpe?g|webp|avif|svg|ico|woff2?|ttf|otf|webmanifest)$/i.test(url.pathname);
}

async function cacheShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(APP_SHELL.map(async path => {
    try {
      const response = await fetch(path, { cache: 'reload' });
      if (response.ok && response.type === 'basic') await cache.put(path, response);
    } catch { /* An individual unavailable asset should not prevent worker installation. */ }
  }));
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    await cacheShell();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('drama-team-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || isFunctionRequest(url)) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => {
      const cached = await caches.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      return new Response('You are offline. Reconnect and try again.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }));
    return;
  }

  if (!isStaticAsset(event.request, url)) return;
  const cachePromise = caches.open(CACHE_NAME);
  const refresh = cachePromise.then(cache => fetch(event.request).then(async response => {
    if (response.ok && response.type === 'basic') await cache.put(event.request, response.clone());
    return response;
  })).catch(() => null);
  event.waitUntil(refresh.then(() => undefined));
  event.respondWith((async () => {
    const cache = await cachePromise;
    const cached = await cache.match(event.request);
    if (cached && ['image', 'font'].includes(event.request.destination)) return cached;
    return await refresh || cached || Response.error();
  })());
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* Use the default message. */ }
  event.waitUntil(self.registration.showNotification(payload.title || 'Drama Team Family', {
    body: payload.body || 'There may be something new on our website. Come and have a look!',
    icon: '/photos/logo.png',
    badge: '/photos/logo.png',
    tag: payload.tag || 'dtm-quarterly-reminder',
    data: { url: payload.url || '/index.html' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/index.html', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => client.url.startsWith(self.location.origin));
    if (existing) {
      await existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  })());
});
