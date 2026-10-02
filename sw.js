// Service Worker: 一度開いたあとはオフラインでも起動できるようにする。
// アプリのファイルを更新したら CACHE の番号を上げる（オンラインなら network-first で
// 常に新しいファイルを取りに行くので、上げ忘れても次回オンライン時に最新になる）。

const CACHE = 'sgcalendar-v2';
const FONT_CACHE = 'sgcalendar-fonts';
const NETWORK_TIMEOUT_MS = 4000;

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './favicon.ico',
  './android-touch-icon.png',
  './syukujitsu.csv',
  './js/main.js',
  './js/clock.js',
  './js/dates.js',
  './js/dom.js',
  './js/garbage.js',
  './js/holidays.js',
  './js/photo.js',
  './js/settings.js',
  './js/settings-ui.js',
  './js/storage.js',
  './js/view.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('sgcalendar-') && key !== CACHE && key !== FONT_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // GET以外（時刻同期のHEAD）は必ずサーバーに届かせたいので手を出さない
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  } else if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request));
  } else if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(staleWhileRevalidate(request));
  }
  // それ以外（祝日データの取得）はそのままネットワークへ
});

function isCacheable(response) {
  return response.status === 200 && response.type !== 'opaque';
}

// アプリ本体: まずネットワーク、だめならキャッシュ。回線が極端に遅いときも待たせない。
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then((response) => {
    if (isCacheable(response)) cache.put(request, response.clone());
    return response;
  });
  const timeout = new Promise((_, reject) => setTimeout(reject, NETWORK_TIMEOUT_MS));
  try {
    return await Promise.race([network, timeout]);
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    // キャッシュにも無ければ、ネットワークの結果（失敗ならその失敗）をそのまま返す
    if (!cached) return network;
    network.catch(() => {});
    return cached;
  }
}

// フォントファイル: URLごとに内容が変わらないので、あればキャッシュを使う
async function cacheFirst(request) {
  const cache = await caches.open(FONT_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) cache.put(request, response.clone());
  return response;
}

// フォントのCSS: キャッシュをすぐ返しつつ、裏で最新に更新する
async function staleWhileRevalidate(request) {
  const cache = await caches.open(FONT_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (isCacheable(response)) cache.put(request, response.clone());
    return response;
  });
  if (!cached) return network;
  network.catch(() => {});
  return cached;
}
