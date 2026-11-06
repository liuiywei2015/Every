/* Cealin 在线心跳（原生 ES5，零外部依赖）
 * 作用：登录态页面把「我还在线」这件事轻量上报给后端，供后台概览面板统计在线人数。
 *
 * 规则：
 *   1) 页面加载后立即上报一次，之后每 60 秒上报一次（action=heartbeat，带账号编号）；
 *   2) 页面关闭 / 切后台不做特殊处理，后端靠 180 秒阈值判定离线，心跳键 300 秒 TTL 自动回收；
 *   3) 任何失败（网络异常、接口报错、未登录）一律静默忽略，不影响页面其它功能，也不弹任何提示；
 *   4) 心跳间隔不低于 60 秒，避免浪费 KV 写入配额。
 *
 * 用法：<script src="presence.js"></script>（有登录态时自动开始）
 *     登录成功后如需立刻补一次上报，可调用 window.cealinPresence.start()；
 *     退出登录时可调用 window.cealinPresence.stop()。
 */
(function (w) {
  'use strict';

  var ENDPOINT = '/api/accounts';
  var INTERVAL = 60000;
  var lastSent = 0;
  var timer = null;

  function readId() {
    try {
      return String(sessionStorage.getItem('cealin_account_id') || '').replace(/^\s+|\s+$/g, '');
    } catch (e) {
      return '';
    }
  }

  function send() {
    var id = readId();
    if (!id) return false;
    var now = Date.now();
    // 同一分钟内（含手动调用 start）只发一次，避免重复写入
    if (now - lastSent < INTERVAL - 3000) return true;
    lastSent = now;
    try {
      var req = w.fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'heartbeat', id: id }),
        cache: 'no-store',
        credentials: 'same-origin',
        keepalive: true
      });
      if (req && typeof req.then === 'function') {
        req.then(function () {}).catch(function () {});
      }
    } catch (e) {
      /* 静默失败：心跳不影响页面任何功能 */
    }
    return true;
  }

  function start() {
    send();
    if (!timer) timer = w.setInterval(send, INTERVAL);
  }

  function stop() {
    if (timer) {
      w.clearInterval(timer);
      timer = null;
    }
  }

  w.cealinPresence = { start: start, stop: stop, send: send };

  if (readId()) start();
})(window);
