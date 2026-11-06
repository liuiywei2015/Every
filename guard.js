/* Cealin 登录守卫（原生 ES5，零依赖）
 * 放在受限页面 <head> 最前面同步执行：sessionStorage 无 cealin_account_id 时
 * 立刻把页面隐藏并跳转账号登录页，保证未登录用户看不到任何内容、也点不到任何功能。
 * 受限页面：guest.html / chat.html / project.html / platform.html / suggestion.html / settings.html / mine.html
 * 不受限：index.html（登录分流入口）、account.html（登录页）、admin.html 与 notice-admin.html（管理员密码通道）
 */
(function (w, d) {
  'use strict';

  var id = '';
  try {
    id = String(sessionStorage.getItem('cealin_account_id') || '').replace(/^\s+|\s+$/g, '');
  } catch (e) {
    id = '';
  }

  if (id) {
    d.documentElement.setAttribute('data-login', 'ok');
    return;
  }

  /* 未登录：先隐藏文档，再跳转，避免页面内容闪现 */
  d.documentElement.style.visibility = 'hidden';
  try {
    w.location.replace('account.html');
  } catch (e) {
    w.location.href = 'account.html';
  }
})(window, document);
