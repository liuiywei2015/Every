/* 霓虹打砖块（Breakout）—— 纯前端单机游戏
 * 1) 仅本地运算：不发起任何网络请求，不可联机
 * 2) 颜色全部即时读取 theme.css 的 CSS 变量，明暗主题切换后自动重绘
 * 3) 排行榜与静音开关只存 localStorage（本机），键名见 STORE_* 常量
 * 4) 音效由 Web Audio 实时合成，不加载任何外部音频文件
 * 5) 代码风格与站点其它脚本保持一致：ES5、IIFE、无第三方依赖
 */
(function (w, d) {
  'use strict';

  var canvas = d.getElementById('board');
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext('2d');
  var stage = d.getElementById('stage');
  var overlay = d.getElementById('overlay');
  var hudScore = d.getElementById('hudScore');
  var hudLevel = d.getElementById('hudLevel');
  var hudLives = d.getElementById('hudLives');
  var hudBest = d.getElementById('hudBest');
  var btnPause = d.getElementById('btnPause');
  var btnRestart = d.getElementById('btnRestart');
  var btnSound = d.getElementById('btnSound');
  var boardList = d.getElementById('boardList');

  var STORE_SCORES = 'cealin_game_top5_v1';
  var STORE_MUTE = 'cealin_game_mute_v1';

  var COLS = 8;
  var LIVES_MAX = 3;
  var DROP_CHANCE = 0.16;
  var WIDE_TIME = 12;
  var BALL_MAX = 5;

  /* ---------- i18n ---------- */
  function T(key, vars) {
    var s = '';
    try {
      if (w.cealinT) s = w.cealinT(key, vars) || '';
    } catch (e) { s = ''; }
    return s;
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------- 主题色读取 ---------- */
  function readVar(name, fallback) {
    var v = '';
    try { v = w.getComputedStyle(d.documentElement).getPropertyValue(name) || ''; } catch (e) { v = ''; }
    v = v.replace(/^\s+|\s+$/g, '');
    return v || fallback;
  }

  function toRgb(c) {
    c = String(c || '').replace(/\s+/g, '');
    if (c.charAt(0) === '#') {
      if (c.length === 4) {
        return [parseInt(c.charAt(1) + c.charAt(1), 16), parseInt(c.charAt(2) + c.charAt(2), 16), parseInt(c.charAt(3) + c.charAt(3), 16)];
      }
      return [parseInt(c.substr(1, 2), 16) || 0, parseInt(c.substr(3, 2), 16) || 0, parseInt(c.substr(5, 2), 16) || 0];
    }
    var m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      var p = m[1].split(',');
      return [parseInt(p[0], 10) || 0, parseInt(p[1], 10) || 0, parseInt(p[2], 10) || 0];
    }
    return [200, 169, 110];
  }

  function rgba(c, a) {
    var p = toRgb(c);
    return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')';
  }

  var C = {
    gold: '#c8a96e', goldLight: '#e8c07a', ok: '#9fc69a', err: '#e8a08c', danger: '#ff6b5e',
    fg: '#f7f4ee', muted: 'rgba(247,244,238,0.55)', pageBg: '#14181a', lineRGB: '255,255,255',
    palette: [], light: false
  };

  function refreshColors() {
    C.gold = readVar('--gold', C.gold);
    C.goldLight = readVar('--gold-light', C.goldLight);
    C.ok = readVar('--ok', C.ok);
    C.err = readVar('--err', C.err);
    C.danger = readVar('--danger', C.danger);
    C.fg = readVar('--fg', C.fg);
    C.muted = readVar('--muted', C.muted);
    C.pageBg = readVar('--page-bg', C.pageBg);
    C.lineRGB = readVar('--line-rgb', C.lineRGB);
    C.light = d.documentElement.className.indexOf('light') >= 0;
    C.palette = [C.gold, C.goldLight, C.ok, C.err, C.danger];
  }

  function brickColor(idx) {
    return C.palette[idx % C.palette.length];
  }

  /* ---------- 世界尺寸 / 画布自适应 ---------- */
  var W = 640, H = 420, DPR = 1;

  function ballRadius() {
    return Math.max(5, Math.min(9, W * 0.0115));
  }

  function speedFor(level) {
    return H * (0.52 + 0.07 * (level - 1));
  }

  function layoutBoard() {
    var margin = Math.max(12, W * 0.035);
    var gap = Math.max(4, Math.round(W * 0.008));
    var cellW = (W - margin * 2 - gap * (COLS - 1)) / COLS;
    var bh = Math.max(12, Math.min(26, Math.round(H * 0.055)));
    return { margin: margin, gap: gap, cellW: cellW, brickH: bh, top: Math.round(H * 0.13) };
  }

  var paddle = { x: 0, y: 0, w: 110, h: 14, baseW: 110, target: 0, wide: 0 };
  var balls = [];
  var bricks = [];
  var powers = [];
  var keys = { left: false, right: false };

  var game = {
    mode: 'ready', score: 0, lives: LIVES_MAX, level: 1,
    best: 0, records: [], muted: false, stuck: true, stuckTimer: 0,
    banner: 0, newRecord: false
  };

  function resize() {
    var rect = stage.getBoundingClientRect();
    var prevW = W, prevH = H;
    W = Math.max(280, Math.round(rect.width || 640));
    H = Math.round(W * 0.66);
    DPR = Math.max(1, Math.min(3, w.devicePixelRatio || 1));
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    var sx = prevW > 0 ? W / prevW : 1;
    var sy = prevH > 0 ? H / prevH : 1;

    paddle.baseW = Math.max(64, Math.min(W * 0.26, 150));
    paddle.w = paddle.wide > 0 ? Math.min(W * 0.46, paddle.baseW * 1.65) : paddle.baseW;
    paddle.h = Math.max(10, Math.round(H * 0.032));
    paddle.y = H - Math.round(H * 0.08);
    paddle.x = Math.round(paddle.x * sx) || Math.round(W / 2);
    paddle.target = paddle.x;
    clampPaddleX();

    placeBricks();

    var r = ballRadius();
    for (var i = 0; i < balls.length; i++) {
      balls[i].x = balls[i].x * sx;
      balls[i].y = balls[i].y * sy;
      balls[i].r = r;
    }
    for (var j = 0; j < powers.length; j++) {
      powers[j].x = powers[j].x * sx;
      powers[j].y = powers[j].y * sy;
    }
    clampPower();
  }

  function clampPaddleX() {
    var half = paddle.w / 2;
    if (paddle.x < half) paddle.x = half;
    if (paddle.x > W - half) paddle.x = W - half;
    if (paddle.target < half) paddle.target = half;
    if (paddle.target > W - half) paddle.target = W - half;
  }

  function clampPower() {
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      if (b.x < b.r) b.x = b.r;
      if (b.x > W - b.r) b.x = W - b.r;
    }
  }

  /* ---------- 砖块 ---------- */
  var POINTS = [60, 50, 40, 30, 20, 15, 10];

  function buildBricks(level) {
    bricks = [];
    var rows = Math.min(7, 4 + Math.floor((level - 1) / 2));
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < COLS; c++) {
        bricks.push({
          row: r, col: c, alive: true,
          points: POINTS[Math.min(POINTS.length - 1, r)],
          colorIdx: r,
          x: 0, y: 0, w: 0, h: 0
        });
      }
    }
    placeBricks();
  }

  function placeBricks() {
    var geo = layoutBoard();
    for (var i = 0; i < bricks.length; i++) {
      var b = bricks[i];
      b.x = geo.margin + b.col * (geo.cellW + geo.gap);
      b.y = geo.top + b.row * (geo.brickH + geo.gap);
      b.w = geo.cellW;
      b.h = geo.brickH;
    }
  }

  function bricksLeft() {
    var n = 0;
    for (var i = 0; i < bricks.length; i++) if (bricks[i].alive) n++;
    return n;
  }

  /* ---------- 球与挡板 ---------- */
  function resetBall() {
    balls = [];
    balls.push({
      x: paddle.x, y: paddle.y - paddle.h / 2 - ballRadius() - 4,
      vx: 0, vy: 0, r: ballRadius(), boost: 1, trail: []
    });
    game.stuck = true;
    game.stuckTimer = 0;
  }

  function launch() {
    if (!game.stuck || !balls.length) return;
    game.stuck = false;
    var sp = speedFor(game.level);
    var t = (Math.random() * 0.9 - 0.45);
    var b = balls[0];
    b.vx = Math.sin(t) * sp;
    b.vy = -Math.cos(t) * sp;
    sfxLaunch();
  }

  function applyPower(type) {
    if (type === 'wide') {
      paddle.wide = WIDE_TIME;
      paddle.w = Math.min(W * 0.46, paddle.baseW * 1.65);
      clampPaddleX();
    } else if (type === 'multi') {
      var extra = [];
      for (var i = 0; i < balls.length; i++) {
        if (balls.length + extra.length >= BALL_MAX) break;
        var b = balls[i];
        var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || speedFor(game.level);
        var base = Math.atan2(b.vy, b.vx);
        for (var k = -1; k <= 1; k += 2) {
          if (balls.length + extra.length >= BALL_MAX) break;
          var ang = base + k * 0.42;
          extra.push({
            x: b.x, y: b.y,
            vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
            r: b.r, boost: b.boost, trail: []
          });
        }
      }
      if (game.stuck && balls.length) {
        game.stuck = false;
        var b0 = balls[0];
        b0.vx = Math.sin(0.2) * speedFor(game.level);
        b0.vy = -Math.cos(0.2) * speedFor(game.level);
      }
      balls = balls.concat(extra);
    }
    sfxPower();
  }

  function maybeDropPower(brick) {
    if (Math.random() > DROP_CHANCE) return;
    var type = Math.random() < 0.58 ? 'wide' : 'multi';
    powers.push({
      x: brick.x + brick.w / 2, y: brick.y + brick.h / 2,
      w: 34, h: 16, vy: H * 0.3, type: type
    });
  }

  function loseLife() {
    game.lives--;
    sfxLose();
    updateHud();
    if (game.lives <= 0) {
      game.lives = 0;
      endGame();
      return;
    }
    paddle.wide = 0;
    paddle.w = paddle.baseW;
    clampPaddleX();
    resetBall();
  }

  function nextLevel() {
    game.level++;
    game.banner = 1.8;
    buildBricks(game.level);
    paddle.wide = 0;
    paddle.w = paddle.baseW;
    clampPaddleX();
    resetBall();
    updateHud();
    sfxLevel();
  }

  /* ---------- 主循环 ---------- */
  function update(dt) {
    /* 挡板跟随 */
    if (keys.left || keys.right) {
      var kv = W * 0.95 * dt;
      if (keys.left) paddle.target -= kv;
      if (keys.right) paddle.target += kv;
      clampPaddleX();
    }
    paddle.x += (paddle.target - paddle.x) * Math.min(1, dt * 22);
    clampPaddleX();

    if (paddle.wide > 0) {
      paddle.wide -= dt;
      if (paddle.wide <= 0) {
        paddle.wide = 0;
        paddle.w = paddle.baseW;
        clampPaddleX();
      }
    }

    if (game.banner > 0) game.banner -= dt;

    /* 球 */
    if (game.stuck) {
      game.stuckTimer += dt;
      var b0 = balls[0];
      if (b0) {
        b0.x = paddle.x;
        b0.y = paddle.y - paddle.h / 2 - b0.r - 4;
      }
      if (game.stuckTimer > 1.5) launch();
    } else {
      moveBalls(dt);
      if (!balls.length) loseLife();
    }

    /* 掉落道具 */
    for (var p = powers.length - 1; p >= 0; p--) {
      var pw = powers[p];
      pw.y += pw.vy * dt;
      var halfW = paddle.w / 2;
      var hitY = pw.y + pw.h / 2 >= paddle.y - paddle.h / 2 && pw.y - pw.h / 2 <= paddle.y + paddle.h / 2;
      var hitX = pw.x + pw.w / 2 >= paddle.x - halfW && pw.x - pw.w / 2 <= paddle.x + halfW;
      if (hitY && hitX) {
        applyPower(pw.type);
        powers.splice(p, 1);
        continue;
      }
      if (pw.y > H + 30) powers.splice(p, 1);
    }
  }

  function moveBalls(dt) {
    var i, j, b, brick;
    for (i = balls.length - 1; i >= 0; i--) {
      b = balls[i];
      var px = b.x, py = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      /* 记录轨迹（霓虹拖尾） */
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 6) b.trail.shift();

      /* 左右墙 */
      if (b.x - b.r < 0) {
        b.x = b.r;
        b.vx = Math.abs(b.vx);
        sfxWall();
      } else if (b.x + b.r > W) {
        b.x = W - b.r;
        b.vx = -Math.abs(b.vx);
        sfxWall();
      }
      /* 顶墙 */
      if (b.y - b.r < 0) {
        b.y = b.r;
        b.vy = Math.abs(b.vy);
        sfxWall();
      }

      /* 挡板 */
      if (b.vy > 0 && b.y + b.r >= paddle.y - paddle.h / 2 && b.y - b.r <= paddle.y + paddle.h / 2) {
        var halfPad = paddle.w / 2;
        if (b.x >= paddle.x - halfPad - b.r && b.x <= paddle.x + halfPad + b.r) {
          var off = (b.x - paddle.x) / halfPad;
          if (off > 1) off = 1;
          if (off < -1) off = -1;
          var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
          b.boost = Math.min(1.18, (b.boost || 1) * 1.012);
          sp = sp * 1.0;
          var ang = off * 1.02;
          b.vx = Math.sin(ang) * sp * b.boost;
          b.vy = -Math.abs(Math.cos(ang) * sp * b.boost);
          b.y = paddle.y - paddle.h / 2 - b.r - 0.5;
          sfxPaddle();
        }
      }

      /* 砖块 */
      for (j = 0; j < bricks.length; j++) {
        brick = bricks[j];
        if (!brick.alive) continue;
        if (b.x + b.r < brick.x || b.x - b.r > brick.x + brick.w) continue;
        if (b.y + b.r < brick.y || b.y - b.r > brick.y + brick.h) continue;

        /* 依据上一帧位置判断反弹方向 */
        var wasLeft = px + b.r <= brick.x;
        var wasRight = px - b.r >= brick.x + brick.w;
        if (wasLeft || wasRight) {
          b.vx = -b.vx;
          b.x = wasLeft ? brick.x - b.r - 0.5 : brick.x + brick.w + b.r + 0.5;
        } else {
          b.vy = -b.vy;
          b.y = (py < brick.y) ? brick.y - b.r - 0.5 : brick.y + brick.h + b.r + 0.5;
        }

        brick.alive = false;
        game.score += brick.points;
        updateHud();
        sfxBrick(brick.row);
        maybeDropPower(brick);
        break;
      }

      /* 掉出底部 */
      if (b.y - b.r > H) {
        balls.splice(i, 1);
        continue;
      }
    }

    if (!balls.length) return;
    if (bricksLeft() === 0) nextLevel();
  }

  /* ---------- 绘制 ---------- */
  function roundRect(x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    /* 背景网格 */
    ctx.save();
    ctx.strokeStyle = 'rgba(' + C.lineRGB + ',' + (C.light ? 0.07 : 0.05) + ')';
    ctx.lineWidth = 1;
    var gy;
    for (gy = 0; gy < H; gy += 30) {
      ctx.beginPath();
      ctx.moveTo(0, gy + 0.5);
      ctx.lineTo(W, gy + 0.5);
      ctx.stroke();
    }
    ctx.restore();

    /* 底部霓虹地平线 */
    var grad = ctx.createLinearGradient(0, H - 70, 0, H);
    grad.addColorStop(0, rgba(C.gold, 0));
    grad.addColorStop(1, rgba(C.gold, C.light ? 0.14 : 0.20));
    ctx.fillStyle = grad;
    ctx.fillRect(0, H - 70, W, 70);

    /* 砖块 */
    var i, br;
    for (i = 0; i < bricks.length; i++) {
      br = bricks[i];
      if (!br.alive) continue;
      var col = brickColor(br.colorIdx);
      ctx.save();
      ctx.shadowColor = rgba(col, C.light ? 0.5 : 0.85);
      ctx.shadowBlur = 14;
      var bg = ctx.createLinearGradient(br.x, br.y, br.x, br.y + br.h);
      bg.addColorStop(0, rgba(col, C.light ? 0.85 : 0.95));
      bg.addColorStop(1, rgba(col, C.light ? 0.55 : 0.62));
      ctx.fillStyle = bg;
      roundRect(br.x, br.y, br.w, br.h, Math.min(6, br.h / 2));
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = rgba(col, C.light ? 0.5 : 0.9);
      ctx.lineWidth = 1;
      roundRect(br.x + 0.5, br.y + 0.5, br.w - 1, br.h - 1, Math.min(6, br.h / 2));
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,' + (C.light ? 0.18 : 0.10) + ')';
      roundRect(br.x + 3, br.y + 3, br.w - 6, Math.max(2, br.h * 0.22), 2);
      ctx.fill();
      ctx.restore();
    }

    /* 掉落道具 */
    for (i = 0; i < powers.length; i++) {
      var pw = powers[i];
      var pc = pw.type === 'wide' ? C.gold : C.ok;
      ctx.save();
      ctx.shadowColor = rgba(pc, 0.9);
      ctx.shadowBlur = 16;
      ctx.fillStyle = rgba(pc, 0.9);
      roundRect(pw.x - pw.w / 2, pw.y - pw.h / 2, pw.w, pw.h, 8);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = rgba(C.pageBg, 0.75);
      ctx.fillStyle = rgba(C.pageBg, 0.85);
      ctx.lineWidth = 2;
      if (pw.type === 'wide') {
        ctx.beginPath();
        ctx.moveTo(pw.x - 11, pw.y);
        ctx.lineTo(pw.x + 11, pw.y);
        ctx.moveTo(pw.x - 11, pw.y);
        ctx.lineTo(pw.x - 6, pw.y - 4);
        ctx.moveTo(pw.x - 11, pw.y);
        ctx.lineTo(pw.x - 6, pw.y + 4);
        ctx.moveTo(pw.x + 11, pw.y);
        ctx.lineTo(pw.x + 6, pw.y - 4);
        ctx.moveTo(pw.x + 11, pw.y);
        ctx.lineTo(pw.x + 6, pw.y + 4);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(pw.x - 7, pw.y, 2.6, 0, Math.PI * 2);
        ctx.arc(pw.x, pw.y, 2.6, 0, Math.PI * 2);
        ctx.arc(pw.x + 7, pw.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    /* 挡板 */
    var padCol = paddle.wide > 0 ? C.ok : C.gold;
    ctx.save();
    ctx.shadowColor = rgba(padCol, 0.95);
    ctx.shadowBlur = 20;
    var pg = ctx.createLinearGradient(paddle.x - paddle.w / 2, 0, paddle.x + paddle.w / 2, 0);
    pg.addColorStop(0, rgba(padCol, 0.75));
    pg.addColorStop(0.5, rgba(C.goldLight, 0.98));
    pg.addColorStop(1, rgba(padCol, 0.75));
    ctx.fillStyle = pg;
    roundRect(paddle.x - paddle.w / 2, paddle.y - paddle.h / 2, paddle.w, paddle.h, paddle.h / 2);
    ctx.fill();
    ctx.restore();

    /* 球 */
    for (i = 0; i < balls.length; i++) {
      var b = balls[i];
      var k;
      for (k = 0; k < b.trail.length; k++) {
        var tp = b.trail[k];
        ctx.fillStyle = rgba(C.goldLight, 0.05 + 0.05 * k);
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, Math.max(1, b.r * (0.4 + 0.09 * k)), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.save();
      ctx.shadowColor = rgba(C.goldLight, 1);
      ctx.shadowBlur = 22;
      var rg = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.2, b.x, b.y, b.r);
      rg.addColorStop(0, C.light ? '#ffffff' : '#fff8e8');
      rg.addColorStop(1, rgba(C.goldLight, 0.95));
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* 关卡提示 */
    if (game.banner > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, game.banner / 0.6) * 0.92;
      ctx.fillStyle = C.fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 ' + Math.round(Math.max(16, W * 0.032)) + 'px "PingFang SC","Microsoft YaHei",Arial,sans-serif';
      ctx.shadowColor = rgba(C.gold, 0.9);
      ctx.shadowBlur = 20;
      ctx.fillText(T('game.levelUp', { n: game.level }), W / 2, H * 0.42);
      ctx.restore();
    }
  }

  /* ---------- HUD / 排行 ---------- */
  function updateHud() {
    hudScore.textContent = String(game.score);
    hudLevel.textContent = String(game.level);
    var hearts = '';
    for (var i = 0; i < game.lives; i++) hearts += '♥';
    for (var j = game.lives; j < LIVES_MAX; j++) hearts += '·';
    hudLives.textContent = hearts || '·';
    hudBest.textContent = String(game.best);
  }

  function loadRecords() {
    var out = [];
    try {
      var raw = w.localStorage.getItem(STORE_SCORES);
      if (raw) {
        var arr = JSON.parse(raw);
        if (arr && arr.length) {
          for (var i = 0; i < arr.length; i++) {
            var it = arr[i];
            if (it && typeof it.score === 'number') {
              out.push({ score: it.score, level: it.level || 1, date: it.date || '' });
            }
          }
        }
      }
    } catch (e) { out = []; }
    out.sort(byScore);
    return out.slice(0, 5);
  }

  function saveRecords(list) {
    try { w.localStorage.setItem(STORE_SCORES, JSON.stringify(list)); } catch (e) {}
  }

  function byScore(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.date) < String(b.date) ? 1 : -1;
  }

  function todayStr() {
    var dt = new Date();
    var m = dt.getMonth() + 1;
    var dd = dt.getDate();
    return dt.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (dd < 10 ? '0' + dd : dd);
  }

  function bestOf(list) {
    return list && list.length ? list[0].score : 0;
  }

  function boardRowsHtml(list, withHead) {
    var html = '';
    if (!list || !list.length) {
      html += '<p class="board-empty">' + esc(T('game.boardEmpty')) + '</p>';
      return html;
    }
    if (withHead) {
      html += '<div class="board-row head"><span>' + esc(T('game.colRank')) + '</span>'
        + '<span>' + esc(T('game.colScore')) + '</span><span>' + esc(T('game.colDate')) + '</span></div>';
    }
    for (var i = 0; i < list.length; i++) {
      html += '<div class="board-row' + (i === 0 ? ' top' : '') + '">'
        + '<span class="board-rank">' + (i + 1) + '</span>'
        + '<span class="board-score">' + esc(list[i].score) + '</span>'
        + '<span class="board-date">' + esc(list[i].date) + '</span>'
        + '</div>';
    }
    return html;
  }

  function renderBoard() {
    if (!boardList) return;
    boardList.innerHTML = boardRowsHtml(game.records, false);
  }

  /* ---------- 覆盖层 ---------- */
  function setOverlay(kind) {
    if (!overlay) return;
    if (!kind || kind === 'none') {
      overlay.className = 'overlay hide';
      overlay.innerHTML = '';
      return;
    }
    overlay.className = 'overlay';
    var html = '';
    if (kind === 'ready') {
      html += '<div class="overlay-title">' + esc(T('game.title')) + '</div>';
      html += '<div class="overlay-desc">' + esc(T('game.readyDesc')) + '</div>';
      html += '<div class="overlay-desc">' + esc(T('game.hint')) + '</div>';
      html += '<button type="button" class="btn primary" data-act="start">' + esc(T('game.start')) + '</button>';
    } else if (kind === 'paused') {
      html += '<div class="overlay-title">' + esc(T('game.pausedTitle')) + '</div>';
      html += '<div class="overlay-desc">' + esc(T('game.pausedDesc')) + '</div>';
      html += '<button type="button" class="btn primary" data-act="resume">' + esc(T('game.resume')) + '</button>';
    } else if (kind === 'over') {
      html += '<div class="overlay-title">' + esc(T('game.overTitle'));
      if (game.newRecord) html += '<span class="overlay-badge">' + esc(T('game.newRecord')) + '</span>';
      html += '</div>';
      html += '<div class="overlay-score">' + esc(T('game.finalScore')) + ' ' + esc(game.score)
        + ' · ' + esc(T('game.reachLevel', { n: game.level })) + '</div>';
      html += '<div class="overlay-board">' + boardRowsHtml(game.records, true) + '</div>';
      html += '<button type="button" class="btn primary" data-act="restart">' + esc(T('game.playAgain')) + '</button>';
    }
    overlay.innerHTML = html;
  }

  /* ---------- 音效（Web Audio 实时合成） ---------- */
  var actx = null;

  function audioCtx() {
    if (game.muted) return null;
    if (!actx) {
      var AC = w.AudioContext || w.webkitAudioContext;
      if (!AC) return null;
      try { actx = new AC(); } catch (e) { return null; }
    }
    if (actx.state === 'suspended' && actx.resume) {
      try { actx.resume(); } catch (e) {}
    }
    return actx;
  }

  function beep(freq, dur, type, vol, slideTo, delay) {
    var ac = audioCtx();
    if (!ac) return;
    var t0 = ac.currentTime + (delay || 0);
    var osc = ac.createOscillator();
    var gain = ac.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) {
      try { osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur); } catch (e) {}
    }
    var v = vol || 0.05;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(v, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  var lastWall = 0;
  function sfxWall() {
    var now = Date.now();
    if (now - lastWall < 45) return;
    lastWall = now;
    beep(320, 0.05, 'triangle', 0.035);
  }
  function sfxPaddle() { beep(180, 0.08, 'sine', 0.075, 240); }
  function sfxBrick(row) { beep(460 + (row || 0) * 46, 0.06, 'square', 0.05); }
  function sfxLaunch() { beep(300, 0.09, 'sine', 0.06, 520); }
  function sfxPower() {
    beep(520, 0.08, 'triangle', 0.07);
    beep(680, 0.08, 'triangle', 0.07, 0, 0.08);
    beep(900, 0.10, 'triangle', 0.07, 0, 0.16);
  }
  function sfxLevel() {
    beep(440, 0.10, 'sine', 0.07);
    beep(590, 0.10, 'sine', 0.07, 0, 0.10);
    beep(740, 0.12, 'sine', 0.07, 0, 0.20);
    beep(880, 0.16, 'sine', 0.07, 0, 0.32);
  }
  function sfxLose() { beep(300, 0.34, 'sawtooth', 0.07, 110); }
  function sfxOver() {
    beep(320, 0.26, 'sawtooth', 0.07, 200);
    beep(200, 0.42, 'sawtooth', 0.07, 80, 0.26);
  }

  function syncSoundBtn() {
    if (!btnSound) return;
    btnSound.textContent = game.muted ? T('game.soundOff') : T('game.soundOn');
    btnSound.className = 'btn' + (game.muted ? '' : ' on');
    btnSound.setAttribute('aria-pressed', game.muted ? 'false' : 'true');
  }

  function syncPauseBtn() {
    if (!btnPause) return;
    btnPause.textContent = game.mode === 'paused' ? T('game.resume') : T('game.pause');
  }

  /* ---------- 流程控制 ---------- */
  function resetGame() {
    game.score = 0;
    game.lives = LIVES_MAX;
    game.level = 1;
    game.newRecord = false;
    game.banner = 0;
    powers = [];
    paddle.wide = 0;
    paddle.w = paddle.baseW;
    paddle.x = W / 2;
    paddle.target = W / 2;
    clampPaddleX();
    buildBricks(1);
    resetBall();
    updateHud();
  }

  function startGame() {
    resetGame();
    game.mode = 'running';
    setOverlay('none');
    syncPauseBtn();
    audioCtx();
  }

  function restartGame() {
    startGame();
  }

  function togglePause() {
    if (game.mode === 'running') {
      game.mode = 'paused';
      setOverlay('paused');
    } else if (game.mode === 'paused') {
      game.mode = 'running';
      setOverlay('none');
    }
    syncPauseBtn();
  }

  function endGame() {
    var prevBest = game.best;
    var recs = loadRecords();
    if (game.score > 0) {
      recs.push({ score: game.score, level: game.level, date: todayStr() });
      recs.sort(byScore);
      recs = recs.slice(0, 5);
      saveRecords(recs);
    }
    game.records = recs;
    game.best = bestOf(recs);
    game.newRecord = game.score > 0 && game.score > prevBest && recs.length > 0 && recs[0].score === game.score;
    game.mode = 'over';
    powers = [];
    updateHud();
    renderBoard();
    setOverlay('over');
    syncPauseBtn();
    sfxOver();
  }

  /* ---------- 交互 ---------- */
  function pointerClientX(ev) {
    if (ev.touches && ev.touches.length) return ev.touches[0].clientX;
    if (ev.changedTouches && ev.changedTouches.length) return ev.changedTouches[0].clientX;
    return ev.clientX;
  }

  function movePaddleTo(clientX) {
    var rect = canvas.getBoundingClientRect();
    var x = clientX - rect.left;
    paddle.target = x;
    clampPaddleX();
    if (game.stuck && game.mode === 'running') launch();
  }

  stage.addEventListener('mousemove', function (ev) {
    if (game.mode !== 'running') return;
    movePaddleTo(pointerClientX(ev));
  }, false);

  stage.addEventListener('mousedown', function (ev) {
    if (game.mode === 'ready') { startGame(); return; }
    if (game.mode === 'running' && game.stuck) launch();
    ev.preventDefault();
  }, false);

  stage.addEventListener('touchstart', function (ev) {
    if (game.mode === 'ready') { startGame(); }
    movePaddleTo(pointerClientX(ev));
    ev.preventDefault();
  }, { passive: false });

  stage.addEventListener('touchmove', function (ev) {
    if (game.mode !== 'running') return;
    movePaddleTo(pointerClientX(ev));
    ev.preventDefault();
  }, { passive: false });

  d.addEventListener('keydown', function (ev) {
    var k = ev.key || '';
    var code = ev.keyCode || 0;

    if (k === ' ' || k === 'Spacebar' || code === 32) {
      ev.preventDefault();
      if (game.mode === 'ready' || game.mode === 'over') { startGame(); return; }
      if (game.stuck) { launch(); return; }
      togglePause();
      return;
    }
    if (k === 'Escape' || k === 'Esc' || code === 27) {
      if (game.mode === 'running' || game.mode === 'paused') {
        ev.preventDefault();
        togglePause();
      }
      return;
    }
    if (k === 'ArrowLeft' || code === 37) {
      ev.preventDefault();
      keys.left = true;
      if (game.mode === 'ready') startGame();
      if (game.stuck && game.mode === 'running') launch();
      return;
    }
    if (k === 'ArrowRight' || code === 39) {
      ev.preventDefault();
      keys.right = true;
      if (game.mode === 'ready') startGame();
      if (game.stuck && game.mode === 'running') launch();
      return;
    }
    if (k === 'r' || k === 'R' || code === 82) {
      restartGame();
    }
  }, false);

  d.addEventListener('keyup', function (ev) {
    var k = ev.key || '';
    var code = ev.keyCode || 0;
    if (k === 'ArrowLeft' || code === 37) keys.left = false;
    if (k === 'ArrowRight' || code === 39) keys.right = false;
  }, false);

  if (overlay) {
    overlay.addEventListener('click', function (ev) {
      var node = ev.target;
      while (node && node !== overlay && !node.getAttribute('data-act')) node = node.parentNode;
      var act = node && node !== overlay ? node.getAttribute('data-act') : '';
      if (act === 'start' || act === 'restart') startGame();
      else if (act === 'resume') togglePause();
    }, false);
  }

  if (btnPause) {
    btnPause.addEventListener('click', function () {
      if (game.mode === 'ready' || game.mode === 'over') { startGame(); return; }
      togglePause();
    }, false);
  }

  if (btnRestart) {
    btnRestart.addEventListener('click', function () { restartGame(); }, false);
  }

  if (btnSound) {
    btnSound.addEventListener('click', function () {
      game.muted = !game.muted;
      try { w.localStorage.setItem(STORE_MUTE, game.muted ? '1' : '0'); } catch (e) {}
      syncSoundBtn();
      if (!game.muted) beep(660, 0.08, 'sine', 0.06);
    }, false);
  }

  d.addEventListener('visibilitychange', function () {
    if (d.hidden && game.mode === 'running') togglePause();
  }, false);

  var resizeTimer = null;
  function onResize() {
    if (resizeTimer) w.clearTimeout(resizeTimer);
    resizeTimer = w.setTimeout(function () {
      resize();
      draw();
    }, 120);
  }

  w.addEventListener('resize', onResize, false);
  w.addEventListener('orientationchange', onResize, false);

  /* 主题切换后重新取色并重绘 */
  try {
    if (w.MutationObserver) {
      var mo = new w.MutationObserver(function () {
        refreshColors();
        draw();
      });
      mo.observe(d.documentElement, { attributes: true, attributeFilter: ['class'] });
    }
  } catch (e) {}

  /* 语言切换后刷新文案 */
  try {
    if (w.cealinOnLangChange) {
      w.cealinOnLangChange(function () {
        syncPauseBtn();
        syncSoundBtn();
        renderBoard();
        if (game.mode === 'ready') setOverlay('ready');
        else if (game.mode === 'paused') setOverlay('paused');
        else if (game.mode === 'over') setOverlay('over');
      });
    }
  } catch (e) {}

  /* ---------- 启动 ---------- */
  var lastT = 0;
  function frame(t) {
    if (!lastT) lastT = t;
    var dt = (t - lastT) / 1000;
    lastT = t;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;
    if (game.mode === 'running') update(dt);
    draw();
    w.requestAnimationFrame(frame);
  }

  function init() {
    refreshColors();
    try {
      game.muted = w.localStorage.getItem(STORE_MUTE) === '1';
    } catch (e) { game.muted = false; }
    game.records = loadRecords();
    game.best = bestOf(game.records);

    resize();
    paddle.x = W / 2;
    paddle.target = W / 2;
    clampPaddleX();
    buildBricks(1);
    resetBall();
    updateHud();
    renderBoard();
    syncSoundBtn();
    syncPauseBtn();
    setOverlay('ready');
    w.requestAnimationFrame(frame);
  }

  if (d.readyState === 'loading') {
    d.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window, document);
