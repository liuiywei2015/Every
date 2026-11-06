/* Cealin 全站主题引导（原生 ES5，零依赖）
 * 放在 <head> 最前面同步执行，先于样式表与首屏渲染决定 <html class="light">，
 * 避免从暗色闪到明亮模式（或反向）的闪烁。
 * 存储键：cealin_theme = 'dark' | 'light'
 * 对外接口：cealinTheme.get() / cealinTheme.set('light'|'dark') / cealinTheme.toggle() / cealinTheme.isLight()
 */
(function (w, d) {
  'use strict';

  var KEY = 'cealin_theme';
  var root = d.documentElement;

  function read() {
    try {
      return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
    } catch (e) {
      return 'dark';
    }
  }

  function apply(mode) {
    if (mode === 'light') {
      if (root.classList) root.classList.add('light');
      else if ((' ' + root.className + ' ').indexOf(' light ') < 0) root.className = (root.className + ' light').replace(/^\s+/, '');
    } else {
      if (root.classList) root.classList.remove('light');
      else root.className = (' ' + root.className + ' ').replace(/\s+light\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    }
    root.setAttribute('data-theme', mode);
  }

  apply(read());

  w.cealinTheme = {
    get: function () { return read(); },
    isLight: function () { return read() === 'light'; },
    set: function (mode) {
      var v = (mode === 'light') ? 'light' : 'dark';
      try { localStorage.setItem(KEY, v); } catch (e) {}
      apply(v);
      return v;
    },
    toggle: function () {
      return w.cealinTheme.set(read() === 'light' ? 'dark' : 'light');
    }
  };

  /* 多标签页 / 多窗口同步 */
  w.addEventListener('storage', function (ev) {
    if (ev && ev.key === KEY) apply(ev.newValue === 'light' ? 'light' : 'dark');
  });
})(window, document);
