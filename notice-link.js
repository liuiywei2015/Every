// Cealin 公告入口身份分流：管理员 → notice-admin.html（可编辑）；游客/未登录 → guest.html（只读）
(function () {
  function route() {
    var isAdmin = false;
    try {
      isAdmin = sessionStorage.getItem('cealin_admin') === '1' && !!sessionStorage.getItem('cealin_admin_pwd');
    } catch (e) {
      isAdmin = false;
    }
    var links = document.querySelectorAll('.menu a[href="notice-admin.html"]');
    for (var i = 0; i < links.length; i++) {
      if (!isAdmin) links[i].href = 'guest.html';
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', route);
  } else {
    route();
  }
})();
