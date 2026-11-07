/* Cealin 浏览器新消息通知（原生 ES5，零外部依赖）
 * 职责：
 *   1) 用户主动申请通知权限（浏览器只允许在用户手势里申请，因此由按钮调用 request）；
 *   2) 页面不在前台时，为好友私聊 / 聊天室的新消息弹系统通知，点击回到对应会话；
 *   3) 同一条消息只通知一次：每个会话在 localStorage 记「已通知到的时间点」，
 *      轮询重复拉回的历史消息不会重复弹窗（多标签页共享同一份记录，也不会各弹一次）。
 *
 * 用法：
 *   <script src="notify.js"></script>
 *   cealinNotify.request(function (perm) { ... });          // 用户点按钮时申请权限
 *   cealinNotify.permission();                              // 'granted' | 'denied' | 'default' | 'unsupported'
 *   cealinNotify.watch({                                    // 每轮轮询拿到消息后调用
 *     key: 'dm:ABCD1234',          // 会话标识（好友私聊用 dm:编号，聊天室用 room:代码）
 *     msgs: [{ id, from, name, text, img, time }],
 *     selfId: 'ABCD1234',          // 本人账号编号（用于排除自己发的消息）
 *     title: '张三',                // 通知标题
 *     url: 'dm.html?peer=ABCD1234' // 点击通知后跳转的地址（可省略，省略则只聚焦窗口）
 *   });
 *
 * 说明：本模块只读消息、只写 localStorage，不向服务端写任何数据，不占用 KV 写配额。
 */
(function (w, d) {
  'use strict';

  var SINCE_KEY = 'cealin_notify_since';   // { 会话: 已通知到的 ISO 时间 }
  var LASTID_KEY = 'cealin_notify_last';   // { 会话: 已通知的最后一条消息 id }
  var MAX_KEYS = 60;                       // localStorage 中最多保留 60 个会话记录，避免无限增长

  function supported() {
    try {
      return !!(w.Notification && typeof w.Notification === 'function');
    } catch (e) {
      return false;
    }
  }

  function permission() {
    if (!supported()) return 'unsupported';
    try {
      return w.Notification.permission || 'default';
    } catch (e) {
      return 'unsupported';
    }
  }

  // 申请权限：必须在用户手势（click）里调用，浏览器才会弹授权框
  function request(done) {
    if (!supported()) {
      if (typeof done === 'function') done('unsupported');
      return;
    }
    var cur = permission();
    if (cur !== 'default') {
      if (typeof done === 'function') done(cur);
      return;
    }
    try {
      var ret = w.Notification.requestPermission(function (perm) {
        if (typeof done === 'function') done(perm || permission());
      });
      // 新版浏览器返回 Promise；旧版走回调，二者都兼容
      if (ret && typeof ret.then === 'function') {
        ret.then(function (perm) {
          if (typeof done === 'function') done(perm || permission());
        }, function () {
          if (typeof done === 'function') done(permission());
        });
      }
    } catch (e) {
      if (typeof done === 'function') done(permission());
    }
  }

  function readMap(key) {
    try {
      var raw = w.localStorage.getItem(key);
      var obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === 'object' ? obj : {};
    } catch (e) {
      return {};
    }
  }

  function writeMap(key, obj) {
    try {
      var names = [];
      for (var k in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
        names.push(k);
      }
      // 超过上限时按写入时间裁掉最早的一批会话记录
      if (names.length > MAX_KEYS) {
        names.sort(function (a, b) {
          return String(obj[a].at || obj[a] || '') < String(obj[b].at || obj[b] || '') ? -1 : 1;
        });
        var drop = names.length - MAX_KEYS;
        for (var i = 0; i < drop; i++) delete obj[names[i]];
      }
      w.localStorage.setItem(key, JSON.stringify(obj));
    } catch (e) { /* 隐私模式或配额满：降级为不去重，不影响页面 */ }
  }

  // 该会话已通知到的时间点（毫秒），无记录返回 0
  function since(key) {
    var map = readMap(SINCE_KEY);
    var v = map[key];
    var ts = v ? Date.parse(v) : 0;
    return isNaN(ts) ? 0 : ts;
  }

  function mark(key, isoTime) {
    if (!key || !isoTime) return;
    var ts = Date.parse(isoTime);
    if (isNaN(ts)) return;
    var map = readMap(SINCE_KEY);
    var old = Date.parse(map[key] || '');
    // 只前进不后退：多标签页交替轮询时不会把基准写回旧时间
    if (!isNaN(old) && old > ts) return;
    map[key] = new Date(ts).toISOString();
    writeMap(SINCE_KEY, map);
  }

  function lastId(key) {
    var map = readMap(LASTID_KEY);
    return map[key] ? String(map[key]) : '';
  }

  function setLastId(key, id) {
    if (!key || !id) return;
    var map = readMap(LASTID_KEY);
    map[key] = String(id);
    writeMap(LASTID_KEY, map);
  }

  // body 文案：文本消息取正文，图片消息用占位说明
  function bodyOf(m, imgText) {
    if (!m) return '';
    var name = m.name ? String(m.name) + ': ' : '';
    if (m.img) return name + (imgText || '[图片]');
    return name + String(m.text || '');
  }

  function show(title, body, key, url) {
    if (permission() !== 'granted') return false;
    try {
      var n = new w.Notification(title || 'Cealin', {
        body: body || '',
        tag: 'cealin-' + (key || 'msg'),   // 同一会话的通知互相替换，堆叠不爆屏
        renotify: false
      });
      n.onclick = function () {
        try { w.focus(); } catch (e) { /* 部分浏览器不允许脚本聚焦 */ }
        if (url) {
          try {
            var abs = new URL(url, w.location.href).href;
            if (w.location.href !== abs) w.location.href = abs;
          } catch (e2) {
            w.location.href = url;
          }
        }
        try { n.close(); } catch (e3) { /* ignore */ }
      };
      // 系统通知停留 8 秒后自动收起，避免长期驻留
      w.setTimeout(function () {
        try { n.close(); } catch (e) { /* ignore */ }
      }, 8000);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* 统一入口：每轮轮询拿到消息后调用
   * opts = { key, msgs, selfId, title, url, imgText, hiddenOnly }
   * 首次调用只记录基准（不拿历史消息刷通知）；之后只在页面隐藏时对新增的他人消息通知一次。 */
  function watch(opts) {
    if (!opts || !opts.key) return;
    var msgs = opts.msgs;
    if (!msgs || !msgs.length) return;

    var latestIso = '';
    for (var i = 0; i < msgs.length; i++) {
      var t = msgs[i] && msgs[i].time ? String(msgs[i].time) : '';
      if (t && (!latestIso || Date.parse(t) > Date.parse(latestIso))) latestIso = t;
    }
    if (!latestIso) return;

    var base = since(opts.key);
    var lastSeenId = lastId(opts.key);
    // 首次进入该会话：把基准对齐到当前最新消息，历史消息不通知
    if (!base) {
      mark(opts.key, latestIso);
      return;
    }

    var hiddenOnly = opts.hiddenOnly !== false;
    var isHidden = false;
    try { isHidden = !!(d.hidden || d.visibilityState === 'hidden'); } catch (e) { isHidden = false; }

    var fresh = [];
    for (var j = 0; j < msgs.length; j++) {
      var m = msgs[j];
      if (!m || !m.time) continue;
      if (opts.selfId && (m.from === opts.selfId || m.accId === opts.selfId)) continue;
      if (Date.parse(m.time) <= base) continue;
      if (lastSeenId && m.id === lastSeenId) continue;
      fresh.push(m);
    }

    if (fresh.length && (!hiddenOnly || isHidden)) {
      var last = fresh[fresh.length - 1];
      show(opts.title || 'Cealin', bodyOf(last, opts.imgText), opts.key, opts.url);
      setLastId(opts.key, last.id || '');
    }
    // 无论是否通知，基准都推进到最新消息：前台已读的消息不会在切后台后补弹
    mark(opts.key, latestIso);
  }

  w.cealinNotify = {
    supported: supported,
    permission: permission,
    request: request,
    since: since,
    mark: mark,
    show: show,
    watch: watch
  };
})(window, document);
