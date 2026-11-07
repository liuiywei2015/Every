/* Cealin 运行环境识别（原生 ES5，零依赖）
 *
 * 放在每个页面 <head> 最前面同步执行，职责：
 * 1) 识别当前是「桌面客户端内置网页」还是「浏览器网页版」，结果写入 window.CEALIN_IS_CLIENT
 * 2) 客户端内访问网页版入口页（/、index.html、account.html）时直接改道 client.html，
 *    登录态由客户端 preload 在文档创建阶段注入，用户不必再点一次「游客登录」
 * 3) 客户端内把导航中的「首页」指向 client.html，少一次跳转
 *
 * 识别依据（任一命中即为客户端）：
 *  a. sessionStorage.cealin_client === '1'（客户端 webview-preload 文档创建阶段写入）
 *  b. navigator.userAgent 含 CealinDesktop（客户端 webview 追加的 UA 标识，兜底）
 */
(function (w, d) {
  'use strict';

  var CLIENT_PAGE = 'client.html';
  var isClient = false;

  try {
    if (String(sessionStorage.getItem('cealin_client') || '') === '1') isClient = true;
  } catch (e) {
    isClient = false;
  }

  if (!isClient) {
    try {
      isClient = /CealinDesktop/i.test(String(navigator.userAgent || ''));
    } catch (e) {
      isClient = false;
    }
  }

  w.CEALIN_IS_CLIENT = isClient;
  if (!isClient) return;

  try {
    d.documentElement.setAttribute('data-cealin-client', '1');
  } catch (e) {
    /* 忽略：仅用于样式标记 */
  }

  /* 当前页面名（去掉目录、.html 后缀，统一小写） */
  function pageName() {
    var p = String(w.location.pathname || '/');
    var last = p.slice(p.lastIndexOf('/') + 1);
    return last.replace(/\.html?$/i, '').toLowerCase();
  }

  var page = pageName();

  /* 客户端已登录（未登录时客户端根本不会加载站点），网页版登录分流页不再需要 */
  if (!page || page === 'index' || page === 'account') {
    try {
      w.location.replace(CLIENT_PAGE);
    } catch (e) {
      w.location.href = CLIENT_PAGE;
    }
    return;
  }

  /* 客户端内「首页」指向 client.html */
  function fixHomeLinks() {
    var links = d.querySelectorAll('a[href$="index.html"]');
    for (var i = 0; i < links.length; i++) {
      links[i].setAttribute('href', CLIENT_PAGE);
    }
  }

  if (d.readyState === 'loading') {
    d.addEventListener('DOMContentLoaded', fixHomeLinks);
  } else {
    fixHomeLinks();
  }
})(window, document);
