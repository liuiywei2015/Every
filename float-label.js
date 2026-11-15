/* Cealin 全站输入框浮动标签（float-label.js）
 * 1) 纯原生 ES5，零依赖，不修改页面原有 DOM 结构，只在运行时给输入框补一层标签
 * 2) 每个页面在 </body> 前引入一次即可（若页面有 i18n.js，请放在其后）
 * 3) 对外接口：window.cealinFloatLabels.refresh() 重算几何与文案；rescan() 重新扫描新增的输入框
 * 4) 跳过：hidden / checkbox / radio / submit / button / reset / file / image / range / color /
 *    date / time / datetime-local / month / week、disabled、readonly 以及带 data-no-float 的控件
 */
(function (w, d) {
  'use strict';

  if (!w || !d || !d.querySelectorAll || !d.addEventListener) {
    return;
  }

  var CLS_HOST = 'fl-host';
  var CLS_INPUT = 'fl-input';
  var CLS_LABEL = 'fl-label';
  var CLS_MULTI = 'fl-multiline';
  var CLS_SRC = 'fl-src-label';
  var CLS_READY = 'fl-ready';
  var CLS_FLOAT = 'is-float';
  var CLS_FILLED = 'fl-filled';

  var SKIP_TYPES = {
    hidden: 1, checkbox: 1, radio: 1, submit: 1, button: 1, reset: 1,
    file: 1, image: 1, range: 1, color: 1, date: 1, time: 1,
    'datetime-local': 1, month: 1, week: 1
  };

  var REG = [];
  var boosting = false;

  function trim(s) {
    return String(s === null || s === undefined ? '' : s).replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
  }

  function num(v) {
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  function addClass(el, cls) {
    if (!el || !cls) { return; }
    if (el.classList) {
      el.classList.add(cls);
      return;
    }
    if ((' ' + el.className + ' ').indexOf(' ' + cls + ' ') < 0) {
      el.className = trim(el.className + ' ' + cls);
    }
  }

  function removeClass(el, cls) {
    if (!el || !cls) { return; }
    if (el.classList) {
      el.classList.remove(cls);
      return;
    }
    el.className = (' ' + el.className + ' ').replace(' ' + cls + ' ', ' ');
  }

  function hasClass(el, cls) {
    if (!el || !cls) { return false; }
    if (el.classList) {
      return el.classList.contains(cls);
    }
    return (' ' + el.className + ' ').indexOf(' ' + cls + ' ') > -1;
  }

  function escapeId(id) {
    if (w.CSS && typeof w.CSS.escape === 'function') {
      return w.CSS.escape(id);
    }
    return String(id).replace(/["\\]/g, '\\$&');
  }

  function tagOf(el) {
    return el && el.tagName ? el.tagName.toLowerCase() : '';
  }

  function isSkipped(el) {
    var tag = tagOf(el);
    if (tag !== 'input' && tag !== 'textarea') { return true; }
    if (el.getAttribute && el.getAttribute('data-no-float') !== null) { return true; }
    if (el.disabled || el.readOnly) { return true; }
    if (tag === 'input') {
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      if (SKIP_TYPES[type]) { return true; }
    }
    return false;
  }

  /* 找关联的 <label>：先 label[for=id]，再看紧邻的前一个兄弟节点 */
  function findLabel(el) {
    var lab = null;
    var id = el.getAttribute && el.getAttribute('id');
    if (id) {
      try {
        lab = d.querySelector('label[for="' + escapeId(id) + '"]');
      } catch (e) {
        lab = null;
      }
    }
    if (!lab) {
      var prev = el.previousElementSibling;
      if (prev && tagOf(prev) === 'label') { lab = prev; }
    }
    return lab || null;
  }

  /* 取标签文案：优先取其内部 data-i18n 片段，其次剔除 .hint 后的纯文本 */
  function labelText(lab) {
    if (!lab) { return ''; }
    var carrier = lab.querySelector ? lab.querySelector('[data-i18n]') : null;
    if (carrier) { return trim(carrier.textContent); }
    var clone = null;
    try { clone = lab.cloneNode(true); } catch (e) { clone = null; }
    if (!clone) { return trim(lab.textContent); }
    var hints = clone.querySelectorAll ? clone.querySelectorAll('.hint') : [];
    for (var i = hints.length - 1; i >= 0; i--) {
      if (hints[i].parentNode) { hints[i].parentNode.removeChild(hints[i]); }
    }
    return trim(clone.textContent);
  }

  /* 取占位符文案：data-i18n-ph 优先（保证多语言即时生效），否则用现成 placeholder */
  function placeholderText(el) {
    var key = el.getAttribute ? el.getAttribute('data-i18n-ph') : null;
    if (key && typeof w.cealinT === 'function') {
      var s = '';
      try { s = trim(w.cealinT(key)); } catch (e) { s = ''; }
      if (s) { return s; }
    }
    return trim(el.getAttribute ? el.getAttribute('placeholder') : '');
  }

  /* 隐藏原标签：标签内若还挂着 .hint / 带 id 的功能节点，只隐藏文案片段，保留提示元素 */
  function hideSource(lab) {
    if (!lab || lab.__flHidden) { return; }
    var extra = lab.querySelector ? (lab.querySelector('.hint') || lab.querySelector('[id]')) : null;
    var carrier = lab.querySelector ? lab.querySelector('[data-i18n]') : null;
    if (extra && carrier && carrier !== lab) {
      addClass(carrier, CLS_SRC);
      lab.__flCarrier = carrier;
    } else {
      addClass(lab, CLS_SRC);
      lab.__flWhole = true;
    }
    lab.__flHidden = true;
  }

  /* 把标签需要的度量值一次算好：输入框内边距、边框、字号、字距 */
  function readMetrics(el) {
    var cs = null;
    try { cs = w.getComputedStyle ? w.getComputedStyle(el) : null; } catch (e) { cs = null; }
    var multi = tagOf(el) === 'textarea';
    var m = {
      pt: cs ? num(cs.paddingTop) : 11,
      pb: cs ? num(cs.paddingBottom) : 11,
      pl: cs ? num(cs.paddingLeft) : 14,
      bt: cs ? num(cs.borderTopWidth) : 1,
      bl: cs ? num(cs.borderLeftWidth) : 1,
      fs: cs ? cs.fontSize : '',
      lh: cs ? cs.lineHeight : '',
      ls: cs ? cs.letterSpacing : ''
    };
    if (multi && m.pt < 8) { m.pt = 12; }
    return m;
  }

  /* 为浮动标签腾出上方空间：上内边距 +6（大号输入框 +8），下内边距相应减少，整体高度不变 */
  function tunePadding(el, m) {
    var h = 0;
    try { h = el.offsetHeight || 0; } catch (e) { h = 0; }
    var extra = h >= 48 ? 8 : 6;
    var top = m.pt + extra;
    var bottom = m.pb;
    if (bottom - extra >= 4) { bottom = bottom - extra; }
    /* 上方预留区必须容得下缩小后的标签（0.8 倍行高）+ 与正文的间隙，矮框自动补足 */
    var fs = parseFloat(m.fs) || 14;
    if (fs < 8 || fs > 40) { fs = 14; }
    var minTop = Math.ceil(fs * 1.25 * 0.8 + 5);
    if (top < minTop) {
      var delta = minTop - top;
      top = minTop;
      if (bottom - delta >= 2) { bottom = bottom - delta; }
    }
    el.style.paddingTop = top + 'px';
    el.style.paddingBottom = bottom + 'px';
    el.__flPad = { pt: top, pb: bottom };
    return el.__flPad;
  }

  /* 让标签与输入框逐像素对齐；容器隐藏时返回 false，等可见后再算 */
  function place(el, lab) {
    if (!el || !lab) { return false; }
    var host = el.__flHost;
    if (!host) { return false; }
    var ir = null;
    var hr = null;
    try {
      ir = el.getBoundingClientRect();
      hr = host.getBoundingClientRect();
    } catch (e) {
      return false;
    }
    if (!ir || !hr || ir.width <= 0 || ir.height <= 0) { return false; }
    var m = el.__flMetrics || readMetrics(el);
    var pad = el.__flPad || { pt: m.pt, pb: m.pb };
    lab.style.left = Math.round(ir.left - hr.left) + 'px';
    lab.style.width = Math.round(ir.width) + 'px';
    lab.style.paddingLeft = Math.round(m.bl + m.pl) + 'px';
    lab.style.paddingTop = '0px';
    lab.style.height = 'auto';
    /* 先量出标签的自然高度，再决定落点：单行框内垂直居中，多行与首行文字对齐 */
    var lh = 0;
    try { lh = lab.offsetHeight || 0; } catch (e) { lh = 0; }
    if (!lh || lh > ir.height) { lh = Math.min(ir.height, el.__flMulti ? 22 : 21); }
    var textTop = m.bt + pad.pt;              /* 正文起点（相对输入框外框） */
    var top0 = el.__flMulti ? textTop : Math.max(0, Math.round((ir.height - lh) / 2));
    var fh = lh * 0.8;                        /* 浮起（scale 0.8）后的实际高度 */
    var floatTop = Math.round(textTop - fh - 2);
    if (floatTop < 3) { floatTop = 3; }   /* 至少离上边框 3px，避免标签压住边框线 */
    /* 两套落点都算好：落回时框内垂直居中，浮起时贴进上方预留区且不压正文 */
    el.__flGeo = {
      base: Math.round(ir.top - hr.top + top0),
      float: Math.round(ir.top - hr.top + floatTop)
    };
    lab.style.top = (hasClass(lab, CLS_FLOAT) ? el.__flGeo.float : el.__flGeo.base) + 'px';
    addClass(el, CLS_READY);
    return true;
  }

  /* 按浮起状态切换落点，浮起只做缩放，位置由 top 精确控制 */
  function applyTop(el) {
    var lab = el.__flLab;
    var g = el.__flGeo;
    if (!lab || !g) { return; }
    var t = (hasClass(lab, CLS_FLOAT) ? g.float : g.base) + 'px';
    if (lab.style.top !== t) { lab.style.top = t; }
  }

  /* 状态同步：有内容 → 常驻上方 + 边框加深；聚焦 → 上浮；空且失焦 → 落回 */
  function syncState(el) {
    var lab = el.__flLab;
    if (!lab) { return; }
    var val = el.value;
    var has = !!(val && String(val).length > 0);
    var focused = false;
    try { focused = (d.activeElement === el); } catch (e) { focused = false; }
    if (has) { addClass(el, CLS_FILLED); } else { removeClass(el, CLS_FILLED); }
    if (has || focused) { addClass(lab, CLS_FLOAT); } else { removeClass(lab, CLS_FLOAT); }
    applyTop(el);
  }

  function refreshTextOf(el) {
    var lab = el.__flLab;
    if (!lab) { return; }
    var text = '';
    var src = el.__flLabSrc;
    if (src) { text = labelText(src); }
    if (!text) { text = placeholderText(el); }
    if (text && lab.textContent !== text) { lab.textContent = text; }
  }

  function bind(el) {
    el.addEventListener('focus', function () {
      if (!hasClass(el, CLS_READY)) { place(el, el.__flLab); }
      syncState(el);
    }, false);

    el.addEventListener('input', function () {
      if (!hasClass(el, CLS_READY)) { place(el, el.__flLab); }
      syncState(el);
    }, false);

    el.addEventListener('change', function () {
      syncState(el);
    }, false);

    el.addEventListener('blur', function () {
      syncState(el);
    }, false);

    el.addEventListener('click', function () {
      if (!hasClass(el, CLS_READY) && place(el, el.__flLab)) { syncState(el); }
    }, false);
  }

  function observeSize(el) {
    if (typeof w.ResizeObserver !== 'function') { return; }
    try {
      if (!w.__flResizeObserver) {
        w.__flResizeObserver = new w.ResizeObserver(function (entries) {
          for (var i = 0; i < entries.length; i++) {
            var t = entries[i].target;
            if (t && t.__flLab) { place(t, t.__flLab); }
          }
        });
      }
      w.__flResizeObserver.observe(el);
    } catch (e) { /* 忽略：不支持时依赖 focus / resize 重算 */ }
  }

  function enhance(el) {
    try {
      if (!el || el.nodeType !== 1) { return; }
      if (el.__flDone) { return; }
      if (isSkipped(el)) { return; }

      var host = el.parentNode;
      if (!host || host.nodeType !== 1) { return; }

      var multi = tagOf(el) === 'textarea';
      var src = findLabel(el);
      var text = src ? labelText(src) : '';
      if (!text) { text = placeholderText(el); }
      if (!text) { return; }

      el.__flDone = true;
      el.__flMulti = multi;

      var m = readMetrics(el);
      el.__flMetrics = m;

      /* 空输入框补一个空格占位，保持 :placeholder-shown 语义正确 */
      var ph = el.getAttribute('placeholder');
      if (ph === null || ph === '') { el.setAttribute('placeholder', ' '); }

      tunePadding(el, m);

      var lab = d.createElement('span');
      lab.className = CLS_LABEL + (multi ? ' ' + CLS_MULTI : '');
      lab.textContent = text;
      if (m.fs) { lab.style.fontSize = m.fs; }
      if (m.ls && m.ls !== 'normal') { lab.style.letterSpacing = m.ls; }
      /* 单行输入沿用其行高，让标签与正文基线严格对齐；多行保持 1.2 以免浮起后过高 */
      if (!multi && m.lh && /^[0-9.]+px$/.test(m.lh)) { lab.style.lineHeight = m.lh; }

      el.__flHost = host;
      el.__flLab = lab;
      el.__flLabSrc = src;

      addClass(host, CLS_HOST);
      addClass(el, CLS_INPUT);
      host.appendChild(lab);

      hideSource(src);

      place(el, lab);
      syncState(el);
      bind(el);
      observeSize(el);

      REG.push(el);
    } catch (e) { /* 单点失败不影响其他输入框 */ }
  }

  function scan() {
    var list = [];
    try { list = d.querySelectorAll('input, textarea'); } catch (e) { list = []; }
    boosting = true;
    for (var i = 0; i < list.length; i++) {
      enhance(list[i]);
    }
    boosting = false;
  }

  /* 补偿计算：容器从 display:none 变为可见时，补算尚未定位的控件 */
  function ensure() {
    for (var i = 0; i < REG.length; i++) {
      var el = REG[i];
      if (hasClass(el, CLS_READY)) { continue; }
      if (place(el, el.__flLab)) { syncState(el); }
    }
  }

  function refresh() {
    for (var i = 0; i < REG.length; i++) {
      var el = REG[i];
      refreshTextOf(el);
      place(el, el.__flLab);
      syncState(el);
    }
  }

  function rescan() {
    scan();
    refresh();
  }

  function watchDom() {
    if (typeof w.MutationObserver !== 'function' || !d.body) { return; }
    var mo = new w.MutationObserver(function (muts) {
      if (boosting) { return; }
      var need = false;
      for (var i = 0; i < muts.length && !need; i++) {
        var added = muts[i].addedNodes || [];
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (!n || n.nodeType !== 1) { continue; }
          var tag = tagOf(n);
          if (tag === 'input' || tag === 'textarea') { need = true; break; }
          if (n.querySelector && n.querySelector('input, textarea')) { need = true; break; }
        }
      }
      if (need) {
        w.setTimeout(function () { scan(); }, 30);
      }
    });
    try {
      mo.observe(d.body, { childList: true, subtree: true });
    } catch (e) { /* 忽略 */ }
  }

  function boot() {
    scan();
    ensure();
    watchDom();

    try {
      if (typeof w.cealinOnLangChange === 'function') {
        w.cealinOnLangChange(function () {
          w.setTimeout(refresh, 0);
        });
      }
    } catch (e) { /* 忽略 */ }

    var timer = null;
    w.addEventListener('resize', function () {
      if (timer) { return; }
      timer = w.setTimeout(function () {
        timer = null;
        refresh();
      }, 120);
    }, false);

    w.addEventListener('orientationchange', function () {
      w.setTimeout(refresh, 200);
    }, false);

    d.addEventListener('click', function () { ensure(); }, true);
    d.addEventListener('focusin', function () { ensure(); }, true);
  }

  w.cealinFloatLabels = {
    refresh: refresh,
    rescan: rescan,
    scan: scan
  };

  if (d.readyState === 'loading') {
    d.addEventListener('DOMContentLoaded', function () {
      try { boot(); } catch (e) { /* 忽略 */ }
    }, false);
  } else {
    try { boot(); } catch (e) { /* 忽略 */ }
  }
})(window, document);
