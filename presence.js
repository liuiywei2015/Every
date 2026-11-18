/* Cealin 在线心跳（原生 ES5，零外部依赖）
 * 作用：登录态页面把「我还在线」这件事上报给后端，供后台概览面板统计当日活跃人数。
 *
 * 规则（按「每天 1000 人活跃」的规模标定，把 KV 写入压到每天每人最多 1 次）：
 *   1) 同一浏览器同一账号「当天只上报一次」，用 localStorage 记录 cealin_presence_day 去重；
 *      刷新页面、切换页面、反复进入都不会重复写入 KV；
 *   2) 页面长时间挂着跨过零点时，用一个 30 分钟的轻量本地检查发现日期变化，再补报当天那一次；
 *   3) 页面不可见（切标签页 / 切后台）时不发起任何请求；
 *   4) 任何失败（网络异常、接口报错、未登录）一律静默忽略，不影响页面其它功能，也不弹任何提示；
 *   5) 后端 account:presence:{id} 的 TTL 与在线判定窗口按「当日活跃」口径放大（见 functions/api/accounts.js）。
 *
 * 用法：<script src="presence.js"></script>（有登录态时自动开始）
 *     登录成功后如需立刻补一次上报，可调用 window.cealinPresence.start()；
 *     退出登录时可调用 window.cealinPresence.stop()。
 */
(function (w) {
  'use strict';

  var ENDPOINT = '/api/accounts';
  var DAY_KEY = 'cealin_presence_day';

  // 可配置常量：最短上报间隔（毫秒）与跨天检查节奏
  var CONFIG = {
    minGap: 86400000,   // 一天
    checkEvery: 1800000 // 30 分钟做一次纯本地日期检查，不发请求
  };

  var lastSent = 0;
  var timer = null;
  var stopped = true;
  var listening = false;

  function readId() {
    try {
      return String(sessionStorage.getItem('cealin_account_id') || '').replace(/^\s+|\s+$/g, '');
    } catch (e) {
      return '';
    }
  }

  function isHidden() {
    try {
      return !!(typeof document !== 'undefined' && document && document.hidden);
    } catch (e) {
      return false;
    }
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function readMark() {
    try {
      var raw = w.localStorage.getItem(DAY_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      return obj && typeof obj === 'object' ? obj : null;
    } catch (e) {
      return null;
    }
  }

  function writeMark(id, day) {
    try {
      w.localStorage.setItem(DAY_KEY, JSON.stringify({ id: id, day: day, ts: Date.now() }));
    } catch (e) { /* 本地存储不可用则退化为仅按内存判断 */ }
  }

  // 当天是否已经为这个账号上报过
  function alreadyToday(id) {
    var mark = readMark();
    if (mark && mark.id === id && mark.day === today()) return true;
    if (lastSent) {
      var d = new Date(lastSent);
      var day = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
      if (day === today()) return true;
    }
    return false;
  }

  function clearTimer() {
    if (timer) {
      w.clearTimeout(timer);
      timer = null;
    }
  }

  function send() {
    var id = readId();
    if (!id) return false;
    // 当天已报过：直接跳过，绝不重复写 KV
    if (alreadyToday(id)) return true;
    lastSent = Date.now();
    writeMark(id, today());
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

  // 跨天检查：只做本地日期比对，日期没变就什么都不发
  function watch() {
    clearTimer();
    if (stopped) return;
    timer = w.setTimeout(function () {
      timer = null;
      if (stopped) return;
      var id = readId();
      if (id && !alreadyToday(id) && !isHidden()) send();
      watch();
    }, CONFIG.checkEvery);
  }

  function onVisibility() {
    if (stopped || isHidden()) return;
    // 回到前台时若已跨天，补报当天那一次；否则不发任何请求
    var id = readId();
    if (id && !alreadyToday(id)) send();
  }

  function start() {
    if (!readId()) return;
    stopped = false;
    if (!listening) {
      listening = true;
      try {
        if (typeof document !== 'undefined' && document && document.addEventListener) {
          document.addEventListener('visibilitychange', onVisibility);
        }
      } catch (e) { /* 环境不支持则只按首次进入上报 */ }
    }
    send();
    watch();
  }

  function stop() {
    stopped = true;
    clearTimer();
  }

  w.cealinPresence = { start: start, stop: stop, send: send, config: CONFIG };

  if (readId()) start();
})(window);
