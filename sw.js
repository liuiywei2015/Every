/* Cealin Service Worker（离线兜底）
 * 策略：
 *   1) 页面导航：network-first，断网时回退缓存（保证永远优先看到最新版本）
 *   2) 静态资源（css/js/图片/字体）：stale-while-revalidate，先给缓存再后台更新
 *   3) 接口（/api/、/functions/）：一律直连网络，不缓存任何账号与内容数据
 *   4) 版本号变更时清理旧缓存
 */
var VERSION = 'cealin-v1';
var CORE = [
  './',
  'index.html',
  'articles.html',
  'bike.html',
  'chat.html',
  'mine.html',
  'ui.css',
  'nav.js',
  'shell.js',
  'i18n.js',
  'notice-link.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(VERSION).then(function (c) {
      return Promise.all(CORE.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' }))['catch'](function () { /* 单个失败不影响安装 */ });
      }));
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== VERSION) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isApi(url) {
  var p = url.pathname;
  return p.indexOf('/api/') === 0 || p.indexOf('/functions/') >= 0;
}

function isStatic(pathname) {
  return /\.(css|js|mjs|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|webmanifest|json|mp3|mp4|webm)$/i.test(pathname);
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  if (isApi(url)) return;                 /* 账号、文章、聊天数据保持直连 */
  if (url.pathname.indexOf('sw.js') >= 0) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
        return res;
      })['catch'](function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('index.html');
        });
      })
    );
    return;
  }

  if (isStatic(url.pathname)) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && res.status === 200) {
            var copy = res.clone();
            caches.open(VERSION).then(function (c) { c.put(req, copy); });
          }
          return res;
        })['catch'](function () { return hit; });
        return hit || net;
      })
    );
  }
});
