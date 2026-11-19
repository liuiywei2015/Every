/* Cealin 侧边导航（GitHub 风格抽屉）
 * 引入方式：所有页面在 </body> 前引入 <script src="nav.js"></script>
 * 行为：
 *   1) 接管顶部 .topbar 内的 .menu 条目，顶部横排菜单收起为左上角三条横杠按钮
 *   2) 点击横杠 → 左侧抽屉滑出，展示全站功能快捷方式；点击条目直接跳转对应功能页
 *   3) 点击遮罩 / 关闭按钮 / Esc 均可收起；自动高亮当前页
 *   4) 页面没有 .topbar（如 bike.html）时使用悬浮按钮 + 内置默认条目
 * 依赖：i18n.js 的 cealinT / cealinOnLangChange（存在则同步多语言，不存在则用中文兜底）
 */
(function (w, d) {
  'use strict';

  var DEFAULT_ITEMS = [
    ['index.html', 'nav.home', '首页'],
    ['project.html', 'nav.project', '项目'],
    ['platform.html', 'nav.platform', '平台'],
    ['game.html', 'nav.game', '游戏'],
    ['bike.html', 'nav.bike', '单车'],
    ['chat.html', 'nav.chat', '聊天室'],
    ['friends.html', 'nav.friends', '好友'],
    ['articles.html', 'nav.articles', '文章'],
    ['suggestion.html', 'nav.suggestion', '建议'],
    ['notice-admin.html', 'nav.notice', '公告'],
    ['download.html', 'nav.download', '下载'],
    ['mine.html', 'nav.mine', '我的']
  ];

  var ICONS = {
    'index.html': 'M3 11l9-8 9 8M5 10v10h14V10',
    'project.html': 'M3 7h6l2 2h10v10H3z',
    'platform.html': 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
    'game.html': 'M7 12h4M9 10v4M15 11h.01M17 13h.01M6 8h12a3 3 0 013 3v4a3 3 0 01-3 3H6a3 3 0 01-3-3v-4a3 3 0 013-3z',
    'bike.html': 'M6 18a4 4 0 100-8 4 4 0 000 8zM18 18a4 4 0 100-8 4 4 0 000 8zM6 14l4-6h5l3 6',
    'chat.html': 'M21 12a8 8 0 01-8 8H8l-4 3v-6a8 8 0 118-8',
    'friends.html': 'M16 20v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1M9 11a4 4 0 100-8 4 4 0 000 8zM22 20v-1a4 4 0 00-3-3.9M16 4.1A4 4 0 0116 11',
    'articles.html': 'M5 3h11l4 4v14H5zM15 3v5h5M9 13h7M9 17h7',
    'suggestion.html': 'M21 11a8 8 0 01-8 8H8l-4 3v-7a8 8 0 018-8h1a8 8 0 018 4z',
    'notice-admin.html': 'M3 10v4h4l7 5V5L7 10H3zM17 8a5 5 0 010 8',
    'download.html': 'M12 4v11m0 0l-4-4m4 4l4-4M4 20h16',
    'mine.html': 'M20 21v-2a5 5 0 00-5-5H9a5 5 0 00-5 5v2M12 11a4 4 0 100-8 4 4 0 000 8z',
    'settings.html': 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1l2-1.5-2-3.5-2.3 1a7 7 0 00-1.7-1L14.5 3h-4l-.4 2.5a7 7 0 00-1.7 1L6 5.5l-2 3.5L6.1 11a7 7 0 000 2L4 14.5l2 3.5 2.4-1a7 7 0 001.7 1l.4 2.5h4l.4-2.5a7 7 0 001.7-1l2.4 1 2-3.5-2.1-1.5a7 7 0 00.1-1z'
  };

  function svg(path) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + path + '"/></svg>';
  }

  function label(key, fallback) {
    try {
      var v = w.cealinT ? w.cealinT(key) : '';
      return (v && v !== key) ? v : (fallback || '');
    } catch (e) {
      return fallback || '';
    }
  }

  function currentFile() {
    var p = (w.location.pathname || '').split('/').pop();
    return p || 'index.html';
  }

  function collect() {
    var topbar = d.querySelector('header.topbar');
    var out = [];
    if (topbar) {
      var links = topbar.querySelectorAll('.menu a');
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        var href = a.getAttribute('href') || '';
        if (!href || href.charAt(0) === '#') continue;
        out.push({
          href: href,
          key: a.getAttribute('data-i18n') || '',
          text: (a.textContent || '').replace(/\s+/g, ' ').trim()
        });
      }
    }
    if (!out.length) {
      for (var j = 0; j < DEFAULT_ITEMS.length; j++) {
        out.push({ href: DEFAULT_ITEMS[j][0], key: DEFAULT_ITEMS[j][1], text: DEFAULT_ITEMS[j][2] });
      }
    }
    /* 设置入口原在顶栏头像上，补进侧栏 */
    var hasSettings = false;
    for (var k = 0; k < out.length; k++) {
      if (out[k].href === 'settings.html') hasSettings = true;
    }
    if (!hasSettings) {
      out.push({ href: 'settings.html', key: 'nav.settings', text: '设置' });
    }
    return { items: out, topbar: topbar };
  }

  function build(meta) {
    var items = meta.items;
    var topbar = meta.topbar;
    var cur = currentFile();

    /* ---- 三条横杠按钮 ---- */
    var toggle = d.createElement('button');
    toggle.type = 'button';
    toggle.className = 'nav-toggle' + (topbar ? '' : ' nav-toggle-floating');
    toggle.setAttribute('aria-label', '导航菜单');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>';

    if (topbar) {
      topbar.insertBefore(toggle, topbar.firstChild);
    } else {
      d.body.appendChild(toggle);
    }

    /* ---- 抽屉 ---- */
    var aside = d.createElement('aside');
    aside.className = 'sidenav';
    aside.id = 'cealinSidenav';
    aside.setAttribute('aria-hidden', 'true');

    var html = '<div class="sn-head"><a class="sn-brand" href="index.html">Cealin</a>' +
      '<button type="button" class="sn-close" aria-label="收起菜单">&#10005;</button></div>' +
      '<nav class="sn-body"><div class="sn-group">功能</div>';

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var href = it.href;
      var file = href.split('/').pop().split('#')[0];
      var on = (file === cur || (cur === '' && file === 'index.html')) ? ' on' : '';
      var icon = ICONS[file] || 'M4 4h16v16H4z';
      html += '<a class="sn-item' + on + '" href="' + href + '" data-sn-key="' + (it.key || '') + '" data-sn-text="' + (it.text || '').replace(/"/g, '&quot;') + '">' +
        svg(icon) + '<span class="sn-text">' + (it.text || '') + '</span></a>';
    }

    html += '</nav><div class="sn-foot"><a class="sn-item" href="index.html">' + svg(ICONS['index.html']) + '<span class="sn-text">返回首页</span></a></div>';
    aside.innerHTML = html;

    var backdrop = d.createElement('div');
    backdrop.className = 'sn-backdrop';

    d.body.appendChild(backdrop);
    d.body.appendChild(aside);

    /* ---- 交互 ---- */
    function open() {
      d.body.classList.add('nav-open');
      aside.setAttribute('aria-hidden', 'false');
      toggle.setAttribute('aria-expanded', 'true');
    }
    function close() {
      d.body.classList.remove('nav-open');
      aside.setAttribute('aria-hidden', 'true');
      toggle.setAttribute('aria-expanded', 'false');
    }
    function isOpen() {
      return d.body.classList.contains('nav-open');
    }

    toggle.addEventListener('click', function (e) {
      e.preventDefault();
      isOpen() ? close() : open();
    });
    backdrop.addEventListener('click', close);
    var closeBtn = aside.querySelector('.sn-close');
    if (closeBtn) closeBtn.addEventListener('click', close);

    d.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) close();
    });

    /* 跳转前先收起，避免返回时仍展开 */
    var links = aside.querySelectorAll('a');
    for (var n = 0; n < links.length; n++) {
      links[n].addEventListener('click', function () { close(); });
    }

    /* ---- 多语言同步 ---- */
    function repaint() {
      var nodes = aside.querySelectorAll('[data-sn-key]');
      for (var m = 0; m < nodes.length; m++) {
        var key = nodes[m].getAttribute('data-sn-key');
        if (!key) continue;
        var t = label(key, nodes[m].getAttribute('data-sn-text'));
        var span = nodes[m].querySelector('.sn-text');
        if (span && t) span.textContent = t;
      }
    }
    if (w.cealinOnLangChange) {
      try { w.cealinOnLangChange(repaint); } catch (e) {}
    }
    repaint();

    /* ---- 深链 / 调试：?nav=open 或 #nav-open 时默认展开 ---- */
    try {
      if (/(?:^|[?&])nav=open/.test(w.location.search) || w.location.hash === '#nav-open') open();
    } catch (e) {}
  }

  function start() {
    build(collect());
  }

  if (d.readyState === 'loading') {
    d.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window, document);
