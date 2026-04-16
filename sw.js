const CACHE_NAME = 'wardrobe-cache-v12';  // 升版本

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.png',
  './sw.js',
  'https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.min.js',
  'https://unpkg.com/live2d-widget@3.1.4/lib/L2Dwidget.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('📦 [SW] 缓存核心文件...');
      return cache.addAll(ASSETS_TO_CACHE).catch(err => console.warn('部分资源预缓存失败', err));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('🗑️ 删除旧缓存', key);
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) return networkResponse;

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch(() => {
        if (event.request.mode === 'navigate' || event.request.destination === 'document') {
          return caches.match('./index.html');
        }
        console.log('❌ 完全离线且无缓存:', event.request.url);
        return new Response('Offline', { status: 503 });
      });
    })
  );
});
