/* Cealin 全站外壳（命令面板 / 移动端底部导航 / PWA 注册）
 * 引入方式：所有页面在 </body> 前引入 <script src="shell.js"></script>
 * 设计原则：
 *   1) 零外部依赖、零 KV 写入：命令面板只读页面索引与文章列表（列表结果按 10 分钟本地缓存）
 *   2) 不改变既有页面结构：命令面板与底部导航均为运行时挂载，页面移除脚本即完全还原
 *   3) 中文优先，存在 i18n.js 时同步多语言文案，缺 key 时中文兜底
 * 功能：
 *   A. 命令面板：Ctrl/Cmd+K 或“/”唤起，搜索全站页面、功能与文章，↑↓ 选择、Enter 打开、Esc 关闭
 *   B. 移动端底部导航：屏宽 <= 860px 时显示 5 项 tab，当前页高亮，抽屉仍可用
 *   C. PWA：注册 sw.js，使站点可添加到桌面并离线打开
 */
(function (w, d) {
  'use strict';

  /* ================= 1. 页面索引（零网络开销） ================= */
  var PAGES = [
    { href: 'index.html',        title: '首页',     keys: ['home', 'shouye', 'cealin'] },
    { href: 'project.html',      title: '项目',     keys: ['project', 'xiangmu', '作品'] },
    { href: 'platform.html',     title: '平台',     keys: ['platform', 'pingtai'] },
    { href: 'game.html',         title: '游戏',     keys: ['game', 'youxi', '游戏中心'] },
    { href: 'bike.html',         title: '单车',     keys: ['bike', 'danche', '山地速降', '3d'] },
    { href: 'chat.html',         title: '聊天室',   keys: ['chat', 'liaotian', '公共聊天'] },
    { href: 'dm.html',           title: '私信',     keys: ['dm', 'sixin', '消息'] },
    { href: 'friends.html',      title: '好友',     keys: ['friend', 'haoyou', '关注'] },
    { href: 'articles.html',     title: '文章',     keys: ['article', 'wenzhang', '博客', 'blog'] },
    { href: 'write.html',        title: '写文章',   keys: ['write', 'xiewenzhang', '发布', '新建文章'] },
    { href: 'suggestion.html',   title: '建议反馈', keys: ['suggestion', 'jianyi', '反馈', 'feedback'] },
    { href: 'notice-admin.html', title: '公告',     keys: ['notice', 'gonggao', '通知'] },
    { href: 'download.html',     title: '下载',     keys: ['download', 'xiazai', '客户端下载'] },
    { href: 'client.html',       title: '客户端',   keys: ['client', 'kehuduan', '桌面版', '手机版'] },
    { href: 'mine.html',         title: '我的',     keys: ['mine', 'wode', '个人中心', '账号'] },
    { href: 'settings.html',     title: '设置',     keys: ['settings', 'shezhi', '偏好'] },
    { href: 'account.html',      title: '登录 / 注册', keys: ['account', 'login', 'denglu', '注册', '重置密码'] },
    { href: 'guest.html',        title: '游客',     keys: ['guest', 'youke'] },
    { href: 'admin.html',        title: '管理后台', keys: ['admin', 'guanli', '后台'] }
  ];

  /* 面板内可执行的本地动作（不涉及任何网络写入） */
  var ACTIONS = [
    { id: 'act:menu',  title: '打开侧边导航', keys: ['menu', 'daohang', '抽屉', '侧栏'], hint: '快捷' },
    { id: 'act:top',   title: '回到页面顶部', keys: ['top', 'huidao', '顶部'], hint: '快捷' },
    { id: 'act:copy',  title: '复制当前页面链接', keys: ['copy', 'fuzhi', '链接', '分享'], hint: '快捷' }
  ];

  function T(key, fallback) {
    try {
      var v = w.cealinT ? w.cealinT(key) : '';
      return (v && v !== key) ? v : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function currentFile() {
    var p = (w.location.pathname || '').split('/').pop();
    return p || 'index.html';
  }

  /* ================= 2. 文章索引（只读，本地缓存 10 分钟） ================= */
  var ART_CACHE_KEY = 'cealin_cmd_articles_v1';
  var ART_TTL = 600000;
  var articles = [];
  var articlesLoaded = false;

  function readArtCache() {
    try {
      var raw = w.localStorage.getItem(ART_CACHE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.ts || (Date.now() - o.ts) > ART_TTL || !o.list) return null;
      return o.list;
    } catch (e) {
      return null;
    }
  }

  function saveArtCache(list) {
    try {
      w.localStorage.setItem(ART_CACHE_KEY, JSON.stringify({ ts: Date.now(), list: list }));
    } catch (e) { /* 隐私模式忽略 */ }
  }

  function loadArticles() {
    if (articlesLoaded) return;
    articlesLoaded = true;
    var cached = readArtCache();
    if (cached) {
      articles = cached;
      return;
    }
    try {
      fetch('/api/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', page: 1, pageSize: 60 })
      }).then(function (r) { return r.json(); }).then(function (res) {
        if (!res || !res.ok || !res.articles || !res.articles.length) return;
        var list = [];
        for (var i = 0; i < res.articles.length; i++) {
          var it = res.articles[i];
          if (!it || !it.id) continue;
          list.push({
            id: it.id,
            title: String(it.title || '').replace(/\s+/g, ' ').trim(),
            summary: String(it.summary || '').replace(/\s+/g, ' ').trim().slice(0, 80),
            author: String(it.authorName || it.author || '').slice(0, 24)
          });
        }
        articles = list;
        saveArtCache(list);
      })['catch'](function () { /* 静默失败，仅保留页面索引 */ });
    } catch (e) { /* 忽略 */ }
  }

  /* ================= 3. 匹配与排序 ================= */
  function norm(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function scoreItem(item, q) {
    var t = norm(item.title);
    var best = -1;
    if (t === q) best = 200;
    else if (t.indexOf(q) === 0) best = 160;
    else if (t.indexOf(q) >= 0) best = 120;
    var keys = item.keys || [];
    for (var i = 0; i < keys.length && best < 120; i++) {
      var k = norm(keys[i]);
      if (k.indexOf(q) === 0) { best = Math.max(best, 100); }
      else if (k.indexOf(q) >= 0) { best = Math.max(best, 80); }
    }
    if (best < 0 && item.summary && norm(item.summary).indexOf(q) >= 0) best = 50;
    return best;
  }

  function buildResults(q) {
    var out = [];
    var i;
    var query = norm(q);
    if (!query) {
      /* 空查询：给最近访问的页面 + 全部页面 + 动作 */
      var recent = readRecent();
      for (i = 0; i < recent.length; i++) out.push(recent[i]);
      for (i = 0; i < PAGES.length; i++) {
        if (recentIndex(recent, PAGES[i].href) < 0) out.push(pageItem(PAGES[i]));
      }
      for (i = 0; i < ACTIONS.length; i++) out.push(actionItem(ACTIONS[i]));
      return out;
    }
    var scored = [];
    for (i = 0; i < PAGES.length; i++) {
      var s = scoreItem(PAGES[i], query);
      if (s >= 0) scored.push({ s: s + 5, item: pageItem(PAGES[i]) });
    }
    for (i = 0; i < ACTIONS.length; i++) {
      var s2 = scoreItem(ACTIONS[i], query);
      if (s2 >= 0) scored.push({ s: s2, item: actionItem(ACTIONS[i]) });
    }
    for (i = 0; i < articles.length; i++) {
      var a = articles[i];
      var s3 = scoreItem({ title: a.title, keys: [a.author], summary: a.summary }, query);
      if (s3 >= 0) scored.push({ s: s3, item: articleItem(a) });
    }
    scored.sort(function (x, y) { return y.s - x.s; });
    for (i = 0; i < scored.length && i < 24; i++) out.push(scored[i].item);
    return out;
  }

  function pageItem(p) {
    return { kind: 'page', href: p.href, title: p.title, meta: p.href, icon: 'M4 12h16M12 4v16' };
  }
  function actionItem(a) {
    return { kind: 'action', id: a.id, title: a.title, meta: a.hint || '快捷操作', icon: 'M13 2L4 14h6l-1 8 9-12h-6z' };
  }
  function articleItem(a) {
    return {
      kind: 'article', href: 'article.html?id=' + encodeURIComponent(a.id),
      title: a.title || '（无标题）', meta: a.author ? ('文章 · ' + a.author) : '文章',
      icon: 'M5 3h11l4 4v14H5zM15 3v5h5M9 13h7M9 17h7'
    };
  }

  /* 最近访问：本地记录最多 4 条，纯 localStorage，不写 KV */
  var RECENT_KEY = 'cealin_cmd_recent_v1';
  function readRecent() {
    var arr = [];
    try {
      var raw = w.localStorage.getItem(RECENT_KEY);
      if (!raw) return arr;
      var ids = JSON.parse(raw) || [];
      for (var i = 0; i < ids.length; i++) {
        for (var j = 0; j < PAGES.length; j++) {
          if (PAGES[j].href === ids[i]) { arr.push(pageItem(PAGES[j])); break; }
        }
      }
    } catch (e) { /* 忽略 */ }
    return arr;
  }
  function recentIndex(list, href) {
    for (var i = 0; i < list.length; i++) if (list[i].href === href) return i;
    return -1;
  }
  function pushRecent(href) {
    if (!href || href.indexOf('.html') < 0) return;
    try {
      var raw = w.localStorage.getItem(RECENT_KEY);
      var ids = raw ? (JSON.parse(raw) || []) : [];
      var out = [href];
      for (var i = 0; i < ids.length && out.length < 4; i++) {
        if (ids[i] !== href) out.push(ids[i]);
      }
      w.localStorage.setItem(RECENT_KEY, JSON.stringify(out));
    } catch (e) { /* 忽略 */ }
  }

  /* ================= 4. 命令面板 UI ================= */
  var root = null;
  var input = null;
  var listEl = null;
  var results = [];
  var active = 0;
  var composing = false;

  function h(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  }); }

  function ensureRoot() {
    if (root) return;
    root = d.createElement('div');
    root.className = 'cmd-root';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      '<div class="cmd-backdrop" data-cmd-close="1"></div>' +
      '<div class="cmd-panel" role="dialog" aria-modal="true" aria-label="全站搜索">' +
        '<div class="cmd-head">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>' +
          '<input id="cmdInput" type="text" autocomplete="off" spellcheck="false" placeholder="搜索页面、功能或文章…" aria-label="搜索">' +
          '<kbd>Esc</kbd>' +
        '</div>' +
        '<div class="cmd-list" id="cmdList" role="listbox"></div>' +
        '<div class="cmd-foot"><span>↑↓ 选择</span><span>Enter 打开</span><span class="cmd-foot-tip">Ctrl / ⌘ + K</span></div>' +
      '</div>';
    d.body.appendChild(root);
    input = root.querySelector('#cmdInput');
    listEl = root.querySelector('#cmdList');

    input.addEventListener('input', function () {
      if (composing) return;
      render(input.value);
    });
    input.addEventListener('compositionstart', function () { composing = true; });
    input.addEventListener('compositionend', function () { composing = false; render(input.value); });
    input.addEventListener('keydown', onKey);

    root.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== root) {
        if (t.getAttribute && t.getAttribute('data-cmd-close')) { close(); return; }
        if (t.getAttribute && t.getAttribute('data-idx') !== null) {
          active = parseInt(t.getAttribute('data-idx'), 10) || 0;
          run(active);
          return;
        }
        t = t.parentNode;
      }
    });
  }

  function render(q) {
    results = buildResults(q);
    if (active >= results.length) active = 0;
    if (!results.length) {
      listEl.innerHTML = '<div class="cmd-empty">没有匹配结果，换个关键词试试</div>';
      return;
    }
    var html = '';
    var group = '';
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var g = r.kind === 'article' ? '文章' : (r.kind === 'action' ? '快捷操作' : '页面');
      if (g !== group) {
        group = g;
        html += '<div class="cmd-group">' + h(group) + '</div>';
      }
      html += '<div class="cmd-item' + (i === active ? ' on' : '') + '" data-idx="' + i + '" role="option" aria-selected="' + (i === active ? 'true' : 'false') + '">' +
        '<span class="cmd-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="' + r.icon + '"/></svg></span>' +
        '<span class="cmd-txt"><span class="cmd-title">' + h(r.title) + '</span><span class="cmd-meta">' + h(r.meta || '') + '</span></span>' +
        '</div>';
    }
    listEl.innerHTML = html;
    scrollActive();
  }

  function scrollActive() {
    var el = listEl.querySelector('.cmd-item.on');
    if (!el) return;
    var top = el.offsetTop;
    var bottom = top + el.offsetHeight;
    if (top < listEl.scrollTop) listEl.scrollTop = top;
    else if (bottom > listEl.scrollTop + listEl.clientHeight) listEl.scrollTop = bottom - listEl.clientHeight;
  }

  function onKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      active = (e.key === 'ArrowDown') ? (active + 1) % results.length : (active - 1 + results.length) % results.length;
      var items = listEl.querySelectorAll('.cmd-item');
      for (var i = 0; i < items.length; i++) {
        var on = parseInt(items[i].getAttribute('data-idx'), 10) === active;
        items[i].className = 'cmd-item' + (on ? ' on' : '');
        items[i].setAttribute('aria-selected', on ? 'true' : 'false');
      }
      scrollActive();
    } else if (e.key === 'Enter') {
      if (composing) return;
      e.preventDefault();
      run(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  function run(idx) {
    var r = results[idx];
    if (!r) return;
    if (r.kind === 'page' || r.kind === 'article') {
      pushRecent(r.href);
      w.location.href = r.href;
      return;
    }
    close();
    if (r.id === 'act:menu') {
      var btn = d.querySelector('.nav-toggle');
      if (btn) { btn.click(); return; }
      var fake = d.querySelector('.sidenav .sn-close');
      if (fake) fake.click();
    } else if (r.id === 'act:top') {
      try { w.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { w.scrollTo(0, 0); }
    } else if (r.id === 'act:copy') {
      copyLink();
    }
  }

  function copyLink() {
    var url = w.location.href;
    function done(ok) { toast(ok ? '链接已复制' : '复制失败，请手动复制地址栏'); }
    try {
      if (w.navigator.clipboard && w.navigator.clipboard.writeText) {
        w.navigator.clipboard.writeText(url).then(function () { done(true); }, function () { fallback(); });
      } else fallback();
    } catch (e) { fallback(); }
    function fallback() {
      try {
        var ta = d.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        d.body.appendChild(ta);
        ta.select();
        var ok = d.execCommand('copy');
        d.body.removeChild(ta);
        done(ok);
      } catch (e2) { done(false); }
    }
  }

  var toastTimer = null;
  function toast(msg) {
    var el = d.getElementById('cmdToast');
    if (!el) {
      el = d.createElement('div');
      el.id = 'cmdToast';
      el.className = 'cmd-toast';
      d.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'cmd-toast on';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'cmd-toast'; }, 1800);
  }

  function open() {
    ensureRoot();
    loadArticles();
    root.className = 'cmd-root on';
    root.setAttribute('aria-hidden', 'false');
    addClass(d.documentElement, 'cmd-open');
    input.value = '';
    active = 0;
    render('');
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 20);
  }

  function close() {
    if (!root) return;
    root.className = 'cmd-root';
    root.setAttribute('aria-hidden', 'true');
    removeClass(d.documentElement, 'cmd-open');
  }

  function addClass(el, c) {
    if (!el) return;
    var s = ' ' + (el.className || '') + ' ';
    if (s.indexOf(' ' + c + ' ') < 0) el.className = ((el.className || '') + ' ' + c).replace(/^\s+/, '');
  }

  function removeClass(el, c) {
    if (!el) return;
    el.className = String(el.className || '').replace(new RegExp('(^|\\s)' + c + '(?=\\s|$)', 'g'), ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  }

  function isOpen() {
    return !!(root && /(^|\s)on(\s|$)/.test(root.className || ''));
  }

  function isTyping(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return !!(el.isContentEditable);
  }

  /* ================= 5. 侧栏搜索入口（手机端无键盘时的唤起路径） ================= */
  function injectSidebarEntry() {
    var body = d.querySelector('.sidenav .sn-body');
    if (!body || d.getElementById('snSearchBtn')) return;
    var btn = d.createElement('button');
    btn.type = 'button';
    btn.id = 'snSearchBtn';
    btn.className = 'sn-item sn-search';
    btn.innerHTML = '<span class="sn-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg></span>' +
      '<span class="sn-text">搜索全站</span>';
    btn.addEventListener('click', function () {
      var closeBtn = d.querySelector('.sidenav .sn-close');
      if (closeBtn) closeBtn.click();
      setTimeout(open, 60);
    });
    body.insertBefore(btn, body.firstChild);
  }

  /* ================= 6. 移动端底部导航 ================= */
  var TABS = [
    ['index.html', '首页', 'M3 11l9-8 9 8M5 10v10h14V10'],
    ['articles.html', '文章', 'M5 3h11l4 4v14H5zM15 3v5h5M9 13h7M9 17h7'],
    ['game.html', '游戏', 'M7 12h4M9 10v4M15 11h.01M17 13h.01M6 8h12a3 3 0 013 3v4a3 3 0 01-3 3H6a3 3 0 01-3-3v-4a3 3 0 013-3z'],
    ['chat.html', '聊天', 'M21 12a8 8 0 01-8 8H8l-4 3v-6a8 8 0 118-8'],
    ['mine.html', '我的', 'M20 21v-2a5 5 0 00-5-5H9a5 5 0 00-5 5v2M12 11a4 4 0 100-8 4 4 0 000 8z']
  ];

  function buildTabs() {
    if (d.getElementById('mtabBar')) return;
    var cur = currentFile();
    var bar = d.createElement('nav');
    bar.id = 'mtabBar';
    bar.className = 'mtab';
    bar.setAttribute('aria-label', '底部导航');
    var html = '';
    for (var i = 0; i < TABS.length; i++) {
      var t = TABS[i];
      html += '<a class="mtab-item' + (t[0] === cur ? ' on' : '') + '" href="' + t[0] + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="' + t[2] + '"/></svg>' +
        '<span>' + t[1] + '</span></a>';
    }
    html += '<button type="button" class="mtab-item mtab-search" id="mtabSearch" aria-label="搜索">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>' +
      '<span>搜索</span></button>';
    bar.innerHTML = html;
    d.body.appendChild(bar);
    var s = d.getElementById('mtabSearch');
    if (s) s.addEventListener('click', function () { open(); });
    addClass(d.documentElement, 'has-mtab');
  }

  /* ================= 7. 启动 ================= */
  function start() {
    ensureRoot();
    injectSidebarEntry();
    buildTabs();

    d.addEventListener('keydown', function (e) {
      var k = e.key || '';
      if ((e.ctrlKey || e.metaKey) && (k === 'k' || k === 'K')) {
        e.preventDefault();
        if (isOpen()) close(); else open();
        return;
      }
      if (k === '/' && !isOpen() && !isTyping(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        open();
        return;
      }
      if (k === 'Escape' && isOpen()) { e.preventDefault(); close(); }
    });

    /* 侧栏由 nav.js 在 DOMContentLoaded 里渲染，稍后再补一次入口 */
    setTimeout(injectSidebarEntry, 60);
    setTimeout(injectSidebarEntry, 400);
  }

  /* PWA 注册：仅 https 与 localhost 生效，失败静默 */
  function registerSW() {
    try {
      if (!('serviceWorker' in w.navigator)) return;
      var p = w.location.protocol;
      if (p !== 'https:' && w.location.hostname !== 'localhost' && w.location.hostname !== '127.0.0.1') return;
      w.navigator.serviceWorker.register('sw.js').then(function () { /* 成功静默 */ })['catch'](function () { /* 失败静默 */ });
    } catch (e) { /* 忽略 */ }
  }

  if (d.readyState === 'loading') {
    d.addEventListener('DOMContentLoaded', function () { start(); registerSW(); });
  } else {
    start();
    registerSW();
  }

  w.cealinCmd = { open: open, close: close, isOpen: isOpen };
})(window, document);
