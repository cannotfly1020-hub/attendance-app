/* 運動教室 出欠管理 — Network-First Service Worker */
const SW_VERSION = 'attendance-pwa-v1';
const OFFLINE_FALLBACK_CACHE = SW_VERSION + '-fallback';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(OFFLINE_FALLBACK_CACHE).then((cache) =>
      cache.addAll(['./index.html', './icon.png', './manifest.json']).catch(() => null)
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== OFFLINE_FALLBACK_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

function isBypassRequest(request, url) {
  if (request.method !== 'GET') return true;
  // Firestore / Google API / CDN は SW を経由せずブラウザに任せる
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('google.com') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('cloudflare.com') ||
    url.protocol === 'chrome-extension:'
  ) {
    return true;
  }
  return false;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }

  if (isBypassRequest(request, url)) return;

  // Network-First: 常に最新を優先し、オフライン時のみキャッシュへフォールバック
  event.respondWith(
    (async () => {
      try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok && url.origin === self.location.origin) {
          const cache = await caches.open(OFFLINE_FALLBACK_CACHE);
          cache.put(request, networkResponse.clone()).catch(() => null);
        }
        return networkResponse;
      } catch (err) {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
        }
        throw err;
      }
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
