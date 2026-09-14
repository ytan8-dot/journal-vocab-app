const CACHE_NAME = 'journal-vocab-cache-v3';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/api.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// ネットワーク優先: オンライン時は常に最新のファイルを取得し、
// 取得できた場合はキャッシュを更新する。オフライン時のみキャッシュにフォールバックする。
// （キャッシュ優先だと、アプリを更新してもService Workerのバイト内容が
//   変わらない限りブラウザが更新を検知できず、古い画面が表示され続けるため）
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // GAS APIへのリクエストは常にネットワークから取得する（キャッシュ対象外）
  if (url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
