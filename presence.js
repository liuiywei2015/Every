/* Cealin 在线心跳（原生 ES5，零外部依赖）
 * 作用：登录态页面把「我还在线」这件事轻量上报给后端，供后台概览面板统计在线人数。
 *
 * 规则（按「每天 1000 人在线」的规模标定，尽量少写 KV）：
 *   1) 心跳基准间隔 10 分钟（CONFIG.interval），首次进入页面立即上报一次；
 *   2) 每次上报在基准间隔上叠加 0~2 分钟随机抖动（CONFIG.jitter），避免整点集中打接口；
 *   3) 页面不可见（切标签页 / 切后台）时暂停心跳；重新可见时只有距上次心跳已超过基准间隔才补发一次；
 *   4) 任何失败（网络异常、接口报错、未登录）一律静默忽略，不影响页面其它功能，也不弹任何提示；
 *   5) 后端 account:presence:{id} 带 1800 秒 TTL 自动回收，在线判定窗口 20 分钟（大于心跳间隔）。
 *
 * 用法：<script src="presence.js"></script>（有登录态时自动开始）
 *     登录成功后如需立刻补一次上报，可调用 window.cealinPresence.start()；
 *     退出登录时可调用 window.cealinPresence.stop()。
 *     需要临时调整节奏：window.cealinPresence.config.interval = 600000（毫秒）。
 */
(function (w) {
  'use strict';

  var ENDPOINT = '/api/accounts';

  // 可配置常量：心跳基准间隔与随机抖动上限（毫秒）
  var CONFIG = {
    interval: 600000,  // 10 分钟
    jitter: 120000     // 0~2 分钟随机偏移
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

  // 基准间隔 + 随机抖动：0~jitter 毫秒
  function nextDelay() {
    return CONFIG.interval + Math.floor(Math.random() * (CONFIG.jitter + 1));
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
    var now = Date.now();
    // 未到基准间隔（含重复调用 start / 连续恢复可见）不重复写入，保护 KV 写配额
    if (lastSent && now - lastSent < CONFIG.interval) return true;
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

  // 单次定时：到点上报后按「基准 + 新抖动」重新排期，使各页面的心跳自然错峰
  function schedule() {
    clearTimer();
    if (stopped || isHidden()) return;
    timer = w.setTimeout(function () {
      timer = null;
      if (stopped) return;
      if (isHidden()) return;   // 已切后台：交给 visibilitychange 恢复
      send();
      schedule();
    }, nextDelay());
  }

  function onVisibility() {
    if (stopped) return;
    if (isHidden()) {
      clearTimer();
      return;
    }
    // 重新可见：距上次心跳已超过基准间隔才补发一次，然后恢复排期
    if (!lastSent || Date.now() - lastSent >= CONFIG.interval) send();
    schedule();
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
      } catch (e) { /* 环境不支持则只按定时上报 */ }
    }
    // 首次进入立即上报一次；若距上次不足一个间隔则自动跳过
    send();
    schedule();
  }

  function stop() {
    stopped = true;
    clearTimer();
  }

  w.cealinPresence = { start: start, stop: stop, send: send, config: CONFIG };

  if (readId()) start();
})(window);
