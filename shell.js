/* Cealin 全站外壳（移动端底部导航 / PWA 注册）
 * 引入方式：所有页面在 </body> 前引入 <script src="shell.js"></script>
 * 设计原则：
 *   1) 零外部依赖、零 KV 写入
 *   2) 不改变既有页面结构：底部导航为运行时挂载，页面移除脚本即完全还原
 *   3) 搜索能力仅存在于「文章」功能内（articles.html / article.html），全站不再提供搜索入口
 * 功能：
 *   A. 移动端底部导航：屏宽 <= 860px 时显示 5 项 tab，当前页高亮，抽屉仍可用
 *   B. PWA：注册 sw.js，使站点可添加到桌面并离线打开
 */
(function (w, d) {
  'use strict';

  function currentFile() {
    var p = (w.location.pathname || '').split('/').pop();
    return p || 'index.html';
  }

  function addClass(el, c) {
    if (!el) return;
    var s = ' ' + (el.className || '') + ' ';
    if (s.indexOf(' ' + c + ' ') < 0) el.className = ((el.className || '') + ' ' + c).replace(/^\s+/, '');
  }

  /* ================= 1. 移动端底部导航 ================= */
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
    bar.innerHTML = html;
    d.body.appendChild(bar);
    addClass(d.documentElement, 'has-mtab');
  }

  /* ================= 2. 启动 ================= */
  function start() {
    buildTabs();
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
})(window, document);
