const CACHE_NAME = 'wardrobe-cache-v9.17';
// 这里列出所有必须缓存的文件
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  // 看板娘的核心库
  'https://unpkg.com/live2d-widget@3.1.4/lib/L2Dwidget.min.js',
  // 注意：看板娘的模型文件是动态加载的，下面会通过网络拦截自动缓存
];

// 1. 安装阶段：强行缓存静态资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('📦 [SW] 正在缓存核心文件...');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// 2. 激活阶段：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

// 3. 拦截请求：核心逻辑 (Stale-while-revalidate 策略)
// 优先读缓存，如果缓存没有就去网络拉取，并把拉取到的结果存入缓存
self.addEventListener('fetch', (event) => {
  // 过滤掉非 GET 请求和非 http/https 请求
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // 策略：如果缓存里有，直接返回缓存（秒开）
      if (cachedResponse) {
        return cachedResponse;
      }

      // 如果缓存没有（比如看板娘的模型贴图），去网络请求
      return fetch(event.request).then((networkResponse) => {
        // 请求失败直接返回
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic' && networkResponse.type !== 'cors') {
          return networkResponse;
        }

        // 请求成功了，复制一份存到缓存里，下次就不用联网了
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch(() => {
        // 既没缓存也没网，这里可以返回一个离线页面，或者留空
        console.log('❌ 离线且无缓存:', event.request.url);
      });
    })
  );

});




