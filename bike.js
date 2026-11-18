/* bike.js — 低多边形 3D 山地速降（自行车 downhill）
 * 1) 纯单机：无网络请求、无外部模型/纹理，所有几何体程序化生成
 * 2) 物理：自写固定步长 120Hz 刚体积分 + 双轮弹簧阻尼悬挂 + 切向驱动 / 侧向摩擦约束
 *    自行车是完整刚体（位置 / 四元数 / 线速度 / 角速度），不是沿轨道播放的假动画
 * 3) 赛道：固定随机种子程序化生成，同一条赛道可反复计时比较
 * 4) 成绩只写 localStorage，不上传、不联机
 */
(function (global, doc) {
  'use strict';

  /* 全屏外壳 / 车库 / 赛道 / 回放（严格模式下必须先声明） */
  var viewMode = 'menu';
  var idleT = 0;
  var panelOpen = '';
  var deviceTouch = ('ontouchstart' in global) ||
    (!!global.navigator && global.navigator.maxTouchPoints > 0);
  var MAPS = null;
  var BIKES = null;
  var MP = null;
  var BIKE_MATS = null;
  var trickAir = 0;
  var backPull = 0;
  var PAL = null;
  var ENGINE = 660;
  var GRIP_MUL = 1;
  var JUMP_MUL = 1;
  var DEF_PAL = {
    dirt: [0.42, 0.33, 0.22], gravel: [0.46, 0.44, 0.41], root: [0.31, 0.24, 0.16],
    grass: [0.31, 0.42, 0.21], edgeA: [0.39, 0.31, 0.21], edgeB: [0.33, 0.31, 0.21],
    far: [0.47, 0.47, 0.48], trunk: 0x4a3524, leaf: 0x37502c, rock: 0x6b6a63
  };
  var shellEl, menuLayerEl, sideMenuEl, panelLayerEl, panelTitleEl, panelBodyEl,
    btnPanelBackEl, menuBestTimeEl, menuBestTrickEl, menuMapEl, hudBarEl, wheelieHudEl,
    wheelieTimeEl, wheeliePtsEl, toastEl, btnHomeEl, btnFullEl, btnPauseEl,
    _idleA = null, _idleB = null;
  var curMapIdx = 0;
  var curBikeIdx = 0;
  var recordBuf = [];
  var recordTimer = 0;
  var replayPos = 0;
  var replayTimer = 0;
  var wheelieActive = false;
  var wheelieTime = 0;
  var wheeliePeak = 0;        // 本次最长持续时间（秒）
  var wheeliePeakAng = 0;     // 本次最大仰角（弧度）
  var wheelieBanked = 0;
  var wheelieScoreF = 0;
  var wheelieBest = 0;
  var wheelieAngle = 0;

  /* ---- 油画画面风格 / 视角 / 涂装 / 性能改装 / 自定义赛道 ---- */
  var oilMode = 'oil';           // 'oil' 油画 | 'real' 写实
  var POST = null;               // 后处理对象
  var camMode = 'third';         // 'third' 第三人称 | 'first' 第一人称
  var PAINT = { frame: '', rim: '', helmet: '', shirt: '' };   // 自定义涂装（'' 表示用车型原色）
  var UPG = { engine: 0, grip: 0, susp: 0, trick: 0 };         // 性能改装等级 0~3
  var PARTS = 0;                 // 零件库存
  var SND_ON = true;             // 音效开关
  var AC = null, sndEngine = null;   // WebAudio 节点
  var DUST = null, DUST_N = 44, DUST_LIST = [];   // 尘土 / 雪雾粒子

  /* 涂装 / 改装 / 自定义赛道 静态定义（须在 boot 之前完成赋值） */
  var PAINT_SWATCH = ['#e0663a', '#f2c045', '#5fb0e8', '#8fd47a', '#d96ba0', '#ffffff',
    '#2b2f36', '#7a5cff', '#c0392b', '#1f9d8b', '#e8a33d', '#9aa3a8'];
  var PAINT_SLOT = [
    { k: 'frame', nameKey: 'bike.paintFrame', name: '\u8f66\u67b6' },
    { k: 'rim', nameKey: 'bike.paintRim', name: '\u8f6e\u5708' },
    { k: 'helmet', nameKey: 'bike.paintHelmet', name: '\u5934\u76d4' },
    { k: 'shirt', nameKey: 'bike.paintShirt', name: '\u9a91\u884c\u670d' }
  ];
  var UPG_DEF = [
    { k: 'engine', nameKey: 'bike.upgEngine', name: '\u4f20\u52a8\u7cfb\u7edf', noteKey: 'bike.upgEngineNote', note: '\u63d0\u5347\u8e29\u8e0f\u8f93\u51fa\u4e0e\u6781\u901f' },
    { k: 'grip', nameKey: 'bike.upgGrip', name: '\u80ce\u9762\u6293\u5730', noteKey: 'bike.upgGripNote', note: '\u63d0\u5347\u5f2f\u9053\u54ac\u5730\u4e0e\u5239\u8f66' },
    { k: 'susp', nameKey: 'bike.upgSusp', name: '\u60ac\u6302\u5438\u9707', noteKey: 'bike.upgSuspNote', note: '\u5bb9\u8bb8\u66f4\u5927\u89d2\u5ea6\u843d\u5730' },
    { k: 'trick', nameKey: 'bike.upgTrick', name: '\u7a7a\u4e2d\u63a7\u5236', noteKey: 'bike.upgTrickNote', note: '\u63d0\u5347\u817e\u7a7a\u4e0e\u8f6c\u4f53\u7075\u654f\u5ea6' }
  ];
  var UPG_MAX = 3;
  var UPG_COST = 4;   // 每级消耗零件数

  var CUSTOM_DEF = {
    length: 900, w1: 18, w2: 7, rough: 1.0, jumpStep: 88, seed: 20261130, style: 'trail'
  };
  var CUSTOM_STYLES = [
    { k: 'trail', name: '\u6797\u9053' },
    { k: 'outdoor', name: '\u571f\u573a' },
    { k: 'urban', name: '\u57ce\u5e02' },
    { k: 'dune', name: '\u6c99\u4e18' },
    { k: 'snow', name: '\u96ea\u5730' },
    { k: 'factory', name: '\u5de5\u5382' }
  ];

  var PICKUPS = null;            // 本次赛道零件组
  var PICKUP_LIST = [];
  var PICKUPS_GOT = 0;
  var CUSTOM = null;             // 自定义赛道参数

  var THREE = global.THREE;
  if (!THREE) { return; }

  /* =========================================================
   * 1. 工具函数
   * ========================================================= */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth01(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function hash2(x, y) {
    var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }
  function vnoise(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    var u = smooth01(xf), v = smooth01(yf);
    var a = hash2(xi, yi), b = hash2(xi + 1, yi);
    var c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) { sec = 0; }
    var m = Math.floor(sec / 60);
    var s = sec - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  }
  function store(key) {
    try { return global.localStorage.getItem(key); } catch (e) { return null; }
  }
  function save(key, val) {
    try { global.localStorage.setItem(key, String(val)); return true; } catch (e) { return false; }
  }
  function t(key, vars) {
    if (global.cealinT) { return global.cealinT(key, vars); }
    return key;
  }

  /* =========================================================
   * 2. 赛道数据（固定种子 → 同一条赛道）
   * ========================================================= */
  var CFG = {
    seed: 20261117,
    length: 1060,      // 赛道总长（米），沿世界 -Z 方向推进
    ds: 2,             // 纵向采样间隔
    hw: 30,            // 横向半宽（u ∈ [-30, 30]）
    du: 2,             // 横向采样间隔
    trackHalf: 6.5,    // 可骑行路面半宽
    startS: 8,         // 起点桩号
    cpEvery: 200,      // 检查点间隔
    finishS: 1040      // 终点桩号
  };
  var N = Math.floor(CFG.length / CFG.ds) + 1;
  var M = Math.floor(2 * CFG.hw / CFG.du) + 1;
  var H = new Float32Array(N * M);
  var CX = new Float32Array(N);
  var CY = new Float32Array(N);
  var SURF = new Uint8Array(N);
  var JUMPS = [];

  // 四种路面：抓地系数（0-1）+ 颜色
  var SURF_DEF = [
    { key: 'dirt', grip: 0.52, label: 'bike.surfDirt' },
    { key: 'gravel', grip: 0.70, label: 'bike.surfGravel' },
    { key: 'root', grip: 0.84, label: 'bike.surfRoot' },
    { key: 'grass', grip: 0.66, label: 'bike.surfGrass' }
  ];

  function cxAt(s) {
    var m = MP || {};
    return (m.cw1 || 15) * Math.sin(s * (m.cf1 || 0.0058)) +
      (m.cw2 || 6) * Math.sin(s * (m.cf2 || 0.0155) + 1.2);
  }
  function cyBase(s) {
    var m = MP || {};
    return -(m.slope || 0.128) * s -
      (m.und1 || 4.6) * Math.sin(s * (m.uf1 || 0.0042)) -
      (m.und2 || 1.8) * Math.sin(s * (m.uf2 || 0.0158) + 0.6);
  }
  function jumpY(s) {
    var y = 0, i, j, tt;
    for (i = 0; i < JUMPS.length; i++) {
      j = JUMPS[i];
      if (s >= j.s0 && s < j.s0 + j.len) {
        tt = (s - j.s0) / j.len;
        y += j.h * Math.pow(tt, 1.55);
      } else if (s >= j.s0 + j.len && s < j.s0 + j.len + j.gap) {
        y -= j.drop;
      }
    }
    return y;
  }
  function profileY(s, u, code) {
    var m = MP || {};
    if (m.style === 'indoor') { return indoorProfileY(s, u, code); }
    if (m.style === 'outdoor') { return outdoorProfileY(s, u, code); }
    if (m.style === 'stair') { return stairProfileY(s, u, code); }
    if (m.style === 'urban') { return urbanProfileY(s, u, code); }
    if (m.style === 'dune') { return duneProfileY(s, u, code); }
    if (m.style === 'snow') { return snowProfileY(s, u, code); }
    if (m.style === 'factory') { return factoryProfileY(s, u, code); }
    return trailProfileY(s, u, code);
  }

  /* 楼梯累计落差：每组台阶逐级下降 */
  function stairDropY(s) {
    var st = (MP && MP.stairs) || null, y = 0, i, seg, n;
    if (!st) { return 0; }
    for (i = 0; i < st.length; i++) {
      seg = st[i];
      if (s <= seg.s0) { continue; }
      n = Math.floor((s - seg.s0) / seg.step);
      if (n > seg.count) { n = seg.count; }
      y -= n * seg.rise;
    }
    return y;
  }

  /* 室内 BMX 馆：平整木地板 + 连续小跳 + 边侧弯墙 */
  function indoorProfileY(s, u, code) {
    var au = Math.abs(u), th = CFG.trackHalf, y = 0, tt;
    if (au <= th) {
      y += 0.03 * vnoise(s * 0.25, u * 0.25);
      y += 0.28 * smooth01((au - (th - 2.4)) / 2.4);
      y += jumpY(s) * (1 - clamp((au - 2.0) / 4.4, 0, 1));
    } else if (au <= th + 2.6) {
      tt = (au - th) / 2.6;
      y += 0.28 + 0.8 * smooth01(tt) + 0.03 * vnoise(s * 0.3, u * 0.3);
    } else {
      y += 1.08 + 0.04 * vnoise(s * 0.2, u * 0.2);
    }
    return y;
  }

  /* 室外土地场：pump 波浪起伏 + 土坡跳台 + 外侧土堤 */
  function outdoorProfileY(s, u, code) {
    var au = Math.abs(u), th = CFG.trackHalf, y = 0, tt;
    var pump = 0.80 * Math.sin(s * 0.30) + 0.42 * Math.sin(s * 0.63 + 1.1);
    if (au <= th) {
      y += pump * (0.55 + 0.45 * Math.cos(u * 0.40));
      y += 0.07 * vnoise(s * 0.62, u * 0.62);
      y += jumpY(s) * (1 - clamp((au - 2.0) / 4.6, 0, 1));
    } else if (au <= th + 3.2) {
      tt = (au - th) / 3.2;
      y += pump * 0.5 + 1.15 * smooth01(tt) + 0.10 * vnoise(s * 0.4, u * 0.4);
    } else {
      y += pump * 0.35 + 1.15 + 0.55 * vnoise(s * 0.18, u * 0.18);
    }
    return y;
  }

  /* 接楼梯：平台 + 三段连续台阶落差 + 两侧挡墙 */
  function stairProfileY(s, u, code) {
    var au = Math.abs(u), th = CFG.trackHalf, y = 0, tt;
    var drop = stairDropY(s);
    if (au <= th) {
      y += drop;
      y += 0.035 * vnoise(s * 0.5, u * 0.5);
      y += 0.55 * smooth01((au - (th - 1.5)) / 1.5);
      y += jumpY(s) * (1 - clamp((au - 2.2) / 4.0, 0, 1));
    } else if (au <= th + 1.8) {
      y += drop + 1.0 + 0.04 * vnoise(s * 0.4, u * 0.4);
    } else {
      tt = clamp((au - th - 1.8) / 2.6, 0, 1);
      y += drop + 1.0 + 2.4 * smooth01(tt);
    }
    return y;
  }

  /* 城市速降：街道 + 抛台 + 路缘石 + 沿街地基 */
  function urbanProfileY(s, u, code) {
    var au = Math.abs(u), th = CFG.trackHalf, y = 0, tt;
    if (au <= th) {
      y += 0.055 * vnoise(s * 0.35, u * 0.35);
      y += 0.38 * smooth01((au - (th - 1.3)) / 1.3);
      y += jumpY(s) * (1 - clamp((au - 2.6) / 4.4, 0, 1));
    } else if (au <= th + 2.4) {
      y += 0.58 + 0.06 * vnoise(s * 0.45, u * 0.45);
    } else {
      tt = clamp((au - th - 2.4) / 2.2, 0, 1);
      y += 0.58 + 1.1 * smooth01(tt);
    }
    return y;
  }

  /* 沙漠蚀谷：大起伏沙丘 + 背风陡坡（下坡一侧更陡，容易飞起来） */
  function duneProfileY(s, u, code) {
    var au = Math.abs(u), th = CFG.trackHalf, y = 0, t = s * 0.011, k;
    var dune = Math.sin(t) * Math.cos(t * 0.37 + 1.1);
    y += dune * (CFG.hill * 0.85);
    y += Math.sin(s * 0.052 + 0.4) * 2.6;
    y += Math.sin(s * 0.021 + 2.2) * 4.4;
    y += vnoise(s * 0.042, u * 0.06) * 1.15;
    var sc = clamp(au / th, 0, 1);
    // 沙脊：外侧抬高成碗状，单侧更陡
    y += smooth01(sc) * 2.4;
    var lip = Math.pow(sc, 3);
    y += lip * (u > 0 ? 3.6 : 1.5);
    y -= (s - CFG.startS) * (CFG.slope || 0.1) * 0.55;
    return y;
  }

  /* 雪线速降：压实雪脊 + 冰面硬块，抓地偏低、侧向更飘 */
  function snowProfileY(s, u, code) {
    var au = Math.abs(u), th = CFG.trackHalf, y = 0;
    y += Math.sin(s * 0.017 + 0.8) * 6.2;
    y += Math.sin(s * 0.061 + 2.4) * 1.35;
    y += vnoise(s * 0.03, u * 0.05) * 0.95;
    var ridge = Math.sin(s * 0.14) * 0.5 + 0.5;
    var sc = clamp(au / th, 0, 1);
    // 雪墙：两侧高起，弯道内侧堆雪
    y += smooth01(sc) * (1.6 + ridge * 1.9);
    y += Math.cos(s * 0.008) * 2.1 * sc;
    y -= (s - CFG.startS) * 0.075;
    return y;
  }

  /* 废弃工厂：混凝土基准台 + 池坑 + 铁轨缝，落差猛 */
  function factoryProfileY(s, u, code) {
    var au = Math.abs(u), th = CFG.trackHalf, y = 0;
    var step = Math.floor(s / 46);
    y += (step % 2 === 0 ? 1.0 : -1.2);
    y += Math.sin(s * 0.029) * 1.5;
    y += vnoise(s * 0.08, u * 0.09) * 0.42;
    var sc = clamp(au / th, 0, 1);
    // 两侧平台落差（装卸台）
    y += smooth01(sc) * 1.7;
    if (au > th * 0.94) { y -= 2.4; }
    y -= (s - CFG.startS) * 0.09;
    // 周期性下水井/检修坑
    var pit = s - Math.floor(s / 130) * 130;
    if (pit > 96 && pit < 112) {
      var d = Math.sin((pit - 96) / 16 * Math.PI);
      y -= d * 1.9;
    }
    return y;
  }

  function trailProfileY(s, u, code) {
    var au = Math.abs(u), y = 0, tt;
    var rough = (MP && typeof MP.rough === 'number') ? MP.rough : 1;
    var hill = (MP && typeof MP.hill === 'number') ? MP.hill : 11.0;
    if (au <= CFG.trackHalf) {
      y += 0.16 * rough * vnoise(s * 0.09, u * 0.13) - 0.08;
      if (code === 2) {
        y += 0.085 * Math.sin(s * 6.4 + u * 0.35) + 0.05 * Math.sin(s * 11.7);
      } else if (code === 1) {
        y += 0.28 * (vnoise(s * 0.85, u * 0.85) - 0.5);
      } else if (code === 3) {
        y += 0.10 * (vnoise(s * 0.3, u * 0.3) - 0.5);
      }
      y += jumpY(s) * (1 - clamp((au - 2.5) / 4.0, 0, 1));
    } else if (au <= 12) {
      tt = (au - CFG.trackHalf) / 5.5;
      y += 1.0 * smooth01(tt) + 0.55 * vnoise(s * 0.16, u * 0.16);
      y += jumpY(s) * 0.25;
    } else {
      tt = clamp((au - 12) / 18, 0, 1);
      y += 1.0 + hill * Math.pow(tt, 1.8) + 1.8 * vnoise(s * 0.1, u * 0.1);
    }
    return y;
  }

  function buildTrack() {
    // 赛道长度与半宽随地图变化，采样网格必须按当前 CFG 重算，
    // 否则切换到更短/更长的赛道时仍沿用上一张图的行列数，导致地形与终点错位。
    N = Math.floor(CFG.length / CFG.ds) + 1;
    M = Math.floor(2 * CFG.hw / CFG.du) + 1;
    if (H.length !== N * M) {
      H = new Float32Array(N * M);
      CX = new Float32Array(N);
      CY = new Float32Array(N);
      SURF = new Uint8Array(N);
    }
    var rng = mulberry32(CFG.seed);
    var i, j, s, k, code, run, r;

    var m = MP || {};
    var jStart = m.jumpStart || 110;
    var jLenMin = m.jumpLenMin || 6, jLenVar = m.jumpLenVar || 4;
    var jHMin = m.jumpHMin || 1.0, jHVar = m.jumpHVar || 0.85;
    var jGapMin = m.jumpGapMin || 5, jGapVar = m.jumpGapVar || 5;
    var jDropMin = m.jumpDropMin || 0.9, jDropVar = m.jumpDropVar || 0.7;
    var jStep = m.jumpStep || 85, jStepVar = m.jumpStepVar || 80;
    var sx = m.surf || [0.30, 0.58, 0.78];
    var runMin = m.runMin || 18, runVar = m.runVar || 34;

    JUMPS.length = 0;
    s = jStart;
    while (s < CFG.length - 120) {
      JUMPS.push({
        s0: s,
        len: jLenMin + rng() * jLenVar,
        h: jHMin + rng() * jHVar,
        gap: jGapMin + rng() * jGapVar,
        drop: jDropMin + rng() * jDropVar
      });
      s += jStep + rng() * jStepVar;
    }

    k = 0; code = 0;
    while (k < N) {
      run = Math.round((runMin + rng() * runVar) / CFG.ds);
      for (i = 0; i < run && k < N; i++) { SURF[k++] = code; }
      r = rng();
      code = r < sx[0] ? 1 : (r < sx[1] ? 2 : (r < sx[2] ? 3 : 0));
    }

    for (i = 0; i < N; i++) {
      s = i * CFG.ds;
      CX[i] = cxAt(s);
      CY[i] = cyBase(s);
      for (j = 0; j < M; j++) {
        H[i * M + j] = CY[i] + profileY(s, -CFG.hw + j * CFG.du, SURF[i]);
      }
    }
  }

  function rowSample(i, jf) {
    if (jf < 0) { jf = 0; }
    if (jf > M - 1) { jf = M - 1; }
    var j0 = Math.floor(jf);
    if (j0 > M - 2) { j0 = M - 2; }
    var tt = jf - j0;
    var a = H[i * M + j0], b = H[i * M + j0 + 1];
    return a + (b - a) * tt;
  }
  function heightAt(x, z) {
    var s = -z;
    if (s < 0) { s = 0; }
    if (s > CFG.length) { s = CFG.length; }
    var fi = s / CFG.ds;
    var i0 = Math.floor(fi);
    if (i0 > N - 2) { i0 = N - 2; }
    if (i0 < 0) { i0 = 0; }
    if (MP && MP.stepped) {
      i0 = Math.round(fi);
      if (i0 > N - 1) { i0 = N - 1; }
      if (i0 < 0) { i0 = 0; }
      return rowSample(i0, (x - CX[i0] + CFG.hw) / CFG.du);
    }
    var ti = fi - i0;
    var jA = (x - CX[i0] + CFG.hw) / CFG.du;
    var jB = (x - CX[i0 + 1] + CFG.hw) / CFG.du;
    var ya = rowSample(i0, jA), yb = rowSample(i0 + 1, jB);
    return ya + (yb - ya) * ti;
  }
  var _nrm = new THREE.Vector3();
  function normalAt(x, z, out) {
    var e = 0.7;
    var hL = heightAt(x - e, z), hR = heightAt(x + e, z);
    var hD = heightAt(x, z - e), hU = heightAt(x, z + e);
    out.set(hL - hR, 2 * e, hD - hU);
    if (out.lengthSq() < 1e-8) { out.set(0, 1, 0); }
    return out.normalize();
  }
  function surfAt(x, z) {
    var s = -z;
    if (s < 0) { s = 0; }
    if (s > CFG.length) { s = CFG.length; }
    return SURF[clamp(Math.round(s / CFG.ds), 0, N - 1)];
  }
  function gripAt(x, z) {
    var g = SURF_DEF[surfAt(x, z)].grip * (GRIP_MUL || 1);
    var u = x - cxAt(-z);
    if (Math.abs(u) > CFG.trackHalf) { g *= 0.78; }
    return g;
  }

  /* =========================================================
   * 3. 场景 / 渲染
   * ========================================================= */
  var canvas = doc.getElementById('bikeCanvas');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));

  var LIGHTUI = doc.documentElement.classList.contains('light');
  var COL_SKY = LIGHTUI ? 0xcfe0eb : 0x8fa9bd;
  var COL_FOG = LIGHTUI ? 0xd6e4ec : 0x9db4c6;

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(COL_SKY);
  scene.fog = new THREE.Fog(COL_FOG, 90, 420);

  var camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 900);
  camera.position.set(0, 20, 30);

  var hemi = new THREE.HemisphereLight(0xdfeaf5, 0x4b3b26, LIGHTUI ? 1.05 : 0.9);
  scene.add(hemi);
  var sun = new THREE.DirectionalLight(0xfff2d6, LIGHTUI ? 1.15 : 1.0);
  sun.position.set(-60, 90, 40);
  scene.add(sun);
  var amb = new THREE.AmbientLight(0xffffff, LIGHTUI ? 0.35 : 0.22);
  scene.add(amb);

  /* =========================================================
   * 3b. 油画后处理（Kuwahara 四象限取最小方差 + 色阶量化 + 笔触抖动）
   * ========================================================= */
  var OIL_VS = [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = vec4(position.xy, 0.0, 1.0);',
    '}'
  ].join('\n');

  var OIL_FS = [
    'uniform sampler2D tDiffuse;',
    'uniform vec2 uTexel;',
    'uniform float uTime;',
    'uniform float uAmt;',
    'varying vec2 vUv;',
    '',
    'void kwQuad(vec2 uv, vec2 sg, out vec3 mean, out float vari) {',
    '  vec3 sum = vec3(0.0);',
    '  vec3 sum2 = vec3(0.0);',
    '  float n = 0.0;',
    '  for (int i = -2; i <= 2; i++) {',
    '    for (int j = -2; j <= 2; j++) {',
    '      float fi = float(i);',
    '      float fj = float(j);',
    '      if (fi * sg.x < 0.0 || fj * sg.y < 0.0) { continue; }',
    '      vec3 c = texture2D(tDiffuse, uv + vec2(fi, fj) * uTexel * 1.45).rgb;',
    '      sum += c;',
    '      sum2 += c * c;',
    '      n += 1.0;',
    '    }',
    '  }',
    '  sum /= n;',
    '  sum2 /= n;',
    '  vec3 vv = abs(sum2 - sum * sum);',
    '  mean = sum;',
    '  vari = vv.r + vv.g + vv.b;',
    '}',
    '',
    'void main() {',
    '  float n = fract(sin(dot(vUv * vec2(311.7, 213.1), vec2(12.9898, 78.233)) + uTime * 0.017) * 43758.5453);',
    '  vec2 jit = vec2(n, fract(n * 9.71)) - 0.5;',
    '  vec2 uv = vUv + jit * uTexel * 1.9 * uAmt;',
    '  vec3 best = vec3(0.0);',
    '  float bestVar = 1e9;',
    '  vec3 m;',
    '  float vr;',
    '  kwQuad(uv, vec2(1.0, 1.0), m, vr);',
    '  if (vr < bestVar) { bestVar = vr; best = m; }',
    '  kwQuad(uv, vec2(-1.0, 1.0), m, vr);',
    '  if (vr < bestVar) { bestVar = vr; best = m; }',
    '  kwQuad(uv, vec2(1.0, -1.0), m, vr);',
    '  if (vr < bestVar) { bestVar = vr; best = m; }',
    '  kwQuad(uv, vec2(-1.0, -1.0), m, vr);',
    '  if (vr < bestVar) { bestVar = vr; best = m; }',
    '',
    '  vec3 base = texture2D(tDiffuse, vUv).rgb;',
    '  vec3 col = mix(base, best, uAmt);',
    '  col = floor(col * 13.0 + 0.5) / 13.0;',
    '  float lum = dot(col, vec3(0.299, 0.587, 0.114));',
    '  col = mix(vec3(lum), col, 1.07);',
    '  col *= vec3(1.035, 1.005, 0.955);',
    '  col += (n - 0.5) * 0.032;',
    '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n');

  function initPost() {
    if (POST) { return POST; }
    var rt = new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, stencilBuffer: false, depthBuffer: true
    });
    var ps = new THREE.Scene();
    var pc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    var mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: rt.texture },
        uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
        uTime: { value: 0 },
        uAmt: { value: 1.0 }
      },
      vertexShader: OIL_VS, fragmentShader: OIL_FS,
      depthTest: false, depthWrite: false
    });
    var quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    ps.add(quad);
    POST = { rt: rt, scene: ps, cam: pc, mat: mat, w: 0, h: 0 };
    return POST;
  }

  function resizePost(w, h) {
    var p = initPost();
    var dpr = renderer.getPixelRatio();
    var scale = (oilMode === 'oil') ? 0.92 : 1;
    var rw = Math.max(4, Math.floor(w * dpr * scale));
    var rh = Math.max(4, Math.floor(h * dpr * scale));
    if (rw === p.w && rh === p.h) { return; }
    p.w = rw; p.h = rh;
    p.rt.setSize(rw, rh);
    p.mat.uniforms.uTexel.value.set(1 / rw, 1 / rh);
  }

  /* 统一出图：油画走 rt + 全屏着色器，写实直接渲染 */
  function renderScene(dt) {
    if (oilMode !== 'oil') {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }
    var p = initPost();
    p.mat.uniforms.uTime.value += (dt || 0.016);
    renderer.setRenderTarget(p.rt);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(p.scene, p.cam);
  }

  function setOilMode(mode) {
    oilMode = (mode === 'real') ? 'real' : 'oil';
    save('cealin_bike_oil', oilMode);
    POST && (POST.w = 0);
    resize();
  }

  var terrainMesh = null, treesTrunk = null, treesLeaf = null, rocksMesh = null, gateGroup = null;

  function terrainColor(s, u, code, out) {
    var au = Math.abs(u), tt;
    var p = PAL || DEF_PAL;
    if (au <= CFG.trackHalf + 1.5) {
      if (code === 1) { out.setRGB(p.gravel[0], p.gravel[1], p.gravel[2]); }
      else if (code === 2) { out.setRGB(p.root[0], p.root[1], p.root[2]); }
      else if (code === 3) { out.setRGB(p.grass[0], p.grass[1], p.grass[2]); }
      else { out.setRGB(p.dirt[0], p.dirt[1], p.dirt[2]); }
    } else if (au <= 12) {
      tt = clamp((au - CFG.trackHalf) / 5.5, 0, 1);
      out.setRGB(lerp(p.edgeA[0], p.edgeB[0], tt), lerp(p.edgeA[1], p.edgeB[1], tt),
        lerp(p.edgeA[2], p.edgeB[2], tt));
    } else {
      tt = clamp((au - 12) / 18, 0, 1);
      out.setRGB(lerp(p.edgeB[0], p.far[0], tt), lerp(p.edgeB[1], p.far[1], tt),
        lerp(p.edgeB[2], p.far[2], tt));
    }
    var n = 0.88 + vnoise(s * 0.7, u * 0.7) * 0.24;
    out.setRGB(clamp(out.r * n, 0, 1), clamp(out.g * n, 0, 1), clamp(out.b * n, 0, 1));
    return out;
  }

  function buildTerrain() {
    var vx = new Float32Array(N * M), vy = new Float32Array(N * M), vz = new Float32Array(N * M);
    var i, j, u;
    for (i = 0; i < N; i++) {
      for (j = 0; j < M; j++) {
        u = -CFG.hw + j * CFG.du;
        vx[i * M + j] = CX[i] + u;
        vy[i * M + j] = H[i * M + j];
        vz[i * M + j] = -(i * CFG.ds);
      }
    }
    var triCount = (N - 1) * (M - 1) * 2;
    var pos = new Float32Array(triCount * 9);
    var col = new Float32Array(triCount * 9);
    var p = 0;
    var c = new THREE.Color();
    function pushTri(a, b, cc, rowIdx, uMid) {
      terrainColor(rowIdx * CFG.ds, uMid, SURF[rowIdx], c);
      var idx = [a, b, cc], q;
      for (q = 0; q < 3; q++) {
        pos[p] = vx[idx[q]]; pos[p + 1] = vy[idx[q]]; pos[p + 2] = vz[idx[q]];
        col[p] = c.r; col[p + 1] = c.g; col[p + 2] = c.b;
        p += 3;
      }
    }
    for (i = 0; i < N - 1; i++) {
      for (j = 0; j < M - 1; j++) {
        var i00 = i * M + j, i01 = i * M + j + 1;
        var i10 = (i + 1) * M + j, i11 = (i + 1) * M + j + 1;
        var uMid = -CFG.hw + (j + 0.5) * CFG.du;
        pushTri(i00, i01, i11, i, uMid);
        pushTri(i00, i11, i10, i, uMid);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    var mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    terrainMesh = new THREE.Mesh(geo, mat);
    scene.add(terrainMesh);
  }

  var propsGroup = null;
  function ensureProps() {
    if (!propsGroup) { propsGroup = new THREE.Group(); scene.add(propsGroup); }
    return propsGroup;
  }

  /* 通用：沿赛道按桩号布置实例化盒体 */
  function instBoxes(list, color) {
    if (!list.length) { return; }
    var geo = new THREE.BoxGeometry(1, 1, 1);
    var mat = new THREE.MeshLambertMaterial({ color: color, flatShading: true });
    var mesh = new THREE.InstancedMesh(geo, mat, list.length);
    var m = new THREE.Matrix4(), q = new THREE.Quaternion();
    var pt = new THREE.Vector3(), sc = new THREE.Vector3(), ax = new THREE.Vector3(0, 1, 0);
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      q.setFromAxisAngle(ax, it.yaw || 0);
      sc.set(it.w, it.h, it.d);
      pt.set(it.x, it.y, it.z);
      m.compose(pt, q, sc);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    ensureProps().add(mesh);
    return mesh;
  }

  /* 赛道切线朝向 */
  function yawAt(s) {
    var a = cxAt(Math.max(0, s - 3)), b = cxAt(Math.min(CFG.length, s + 3));
    return Math.atan2(b - a, 6);
  }

  function dressingIndoor(rng) {
    var walls = [], beams = [], stands = [], lamps = [];
    var s, u, x, z, gy, k;
    for (s = 6; s < CFG.length; s += 13) {
      for (k = -1; k <= 1; k += 2) {
        u = k * (CFG.trackHalf + 3.4);
        x = cxAt(s) + u; z = -s; gy = heightAt(x, z);
        walls.push({ x: x, y: gy + 2.1, z: z, w: 12.8, h: 4.2, d: 0.5, yaw: yawAt(s) });
        if (((s / 13) | 0) % 3 === 0) {
          stands.push({ x: cxAt(s) + k * (CFG.trackHalf + 8.6), y: gy + 0.9, z: z,
            w: 12, h: 1.8, d: 5.2, yaw: yawAt(s) });
        }
      }
    }
    for (s = 26; s < CFG.length; s += 39) {
      x = cxAt(s); z = -s; gy = heightAt(x, z);
      beams.push({ x: x, y: gy + 7.6, z: z, w: CFG.trackHalf * 2 + 9, h: 0.45, d: 0.55, yaw: yawAt(s) });
      for (k = -1; k <= 1; k += 2) {
        lamps.push({ x: cxAt(s) + k * (CFG.trackHalf - 0.6), y: gy + 7.0, z: z,
          w: 1.6, h: 0.22, d: 0.5, yaw: yawAt(s) });
      }
    }
    instBoxes(walls, 0x6c5238);
    instBoxes(stands, 0x585c63);
    instBoxes(beams, 0x4a4e55);
    var lampMesh = instBoxes(lamps, 0xfff2c4);
    if (lampMesh) { lampMesh.material = new THREE.MeshBasicMaterial({ color: 0xfff2c4 }); }
  }

  function dressingOutdoor(rng) {
    var moundGeo = new THREE.SphereGeometry(1, 7, 4);
    var moundMat = new THREE.MeshLambertMaterial({ color: 0x8a6a42, flatShading: true });
    var list = [], s, k, u, x, z, gy, sc;
    for (s = 8; s < CFG.length; s += 17) {
      for (k = -1; k <= 1; k += 2) {
        u = k * (CFG.trackHalf + 4.6 + rng() * 3.2);
        x = cxAt(s) + u; z = -s; gy = heightAt(x, z);
        list.push({ x: x, y: gy + 0.25, z: z, r: 2.1 + rng() * 2.2 });
      }
    }
    var mesh = new THREE.InstancedMesh(moundGeo, moundMat, list.length);
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), pt = new THREE.Vector3(), scl = new THREE.Vector3();
    for (var i = 0; i < list.length; i++) {
      sc = list[i].r;
      scl.set(sc, sc * 0.42, sc);
      pt.set(list[i].x, list[i].y, list[i].z);
      m.compose(pt, q, scl);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    ensureProps().add(mesh);

    var poles = [], flags = [];
    for (s = 30; s < CFG.length; s += 62) {
      for (k = -1; k <= 1; k += 2) {
        x = cxAt(s) + k * (CFG.trackHalf + 2.4); z = -s; gy = heightAt(x, z);
        poles.push({ x: x, y: gy + 3.4, z: z, w: 0.14, h: 6.8, d: 0.14 });
        flags.push({ x: x + k * 0.55, y: gy + 6.2, z: z, w: 1.0, h: 0.9, d: 0.08, yaw: yawAt(s) });
      }
    }
    instBoxes(poles, 0xb8b2a6);
    instBoxes(flags, 0xe0663a);
  }

  function dressingStair(rng) {
    var steps = [], s, i, seg, n, x, z, gy, y, k, walls = [], rails = [], lamps = [];
    var st = (MP && MP.stairs) || [];
    for (i = 0; i < st.length; i++) {
      seg = st[i];
      for (n = 0; n < seg.count; n++) {
        s = seg.s0 + n * seg.step;
        x = cxAt(s); z = -s; gy = heightAt(x, z);
        steps.push({ x: x, y: gy - 0.36, z: z, w: CFG.trackHalf * 2 + 1.2, h: 0.72, d: seg.step + 0.3 });
      }
    }
    instBoxes(steps, 0x9a938a);
    for (s = 4; s < CFG.length; s += 16) {
      x = cxAt(s); z = -s; gy = heightAt(x, z);
      for (k = -1; k <= 1; k += 2) {
        walls.push({ x: cxAt(s) + k * (CFG.trackHalf + 2.2), y: gy + 1.6, z: z,
          w: 15.6, h: 3.4, d: 0.6, yaw: yawAt(s) });
        rails.push({ x: cxAt(s) + k * (CFG.trackHalf + 0.9), y: gy + 1.25, z: z,
          w: 0.12, h: 1.0, d: 0.12 });
      }
    }
    instBoxes(walls, 0x8d8579);
    instBoxes(rails, 0x5b6167);
    for (s = 30; s < CFG.length; s += 55) {
      x = cxAt(s) + (CFG.trackHalf + 2.0); z = -s; gy = heightAt(x, z);
      lamps.push({ x: x, y: gy + 2.6, z: z, w: 0.14, h: 5.2, d: 0.14 });
      lamps.push({ x: x - 0.5, y: gy + 5.2, z: z, w: 1.0, h: 0.2, d: 0.4 });
    }
    instBoxes(lamps, 0xd8cdb6);
  }

  function dressingUrban(rng) {
    var bld = [], s, k, u, x, z, gy, h, w, d, lamps = [], rails = [];
    for (s = 10; s < CFG.length; s += 21) {
      for (k = -1; k <= 1; k += 2) {
        u = k * (CFG.trackHalf + 7 + rng() * 15);
        x = cxAt(s) + u; z = -s; gy = heightAt(x, z);
        h = 9 + rng() * 34;
        w = 7 + rng() * 11;
        d = 10 + rng() * 12;
        bld.push({ x: x, y: gy + h / 2, z: z, w: w, h: h, d: d, yaw: yawAt(s) + (rng() - 0.5) * 0.12 });
      }
    }
    instBoxes(bld, 0x3d4653);
    for (s = 24; s < CFG.length; s += 46) {
      for (k = -1; k <= 1; k += 2) {
        x = cxAt(s) + k * (CFG.trackHalf + 1.1); z = -s; gy = heightAt(x, z);
        lamps.push({ x: x, y: gy + 3.2, z: z, w: 0.16, h: 6.4, d: 0.16 });
        lamps.push({ x: x, y: gy + 6.4, z: z, w: 0.9, h: 0.22, d: 0.9 });
      }
    }
    instBoxes(lamps, 0xc8d2e0);
    for (s = 8; s < CFG.length; s += 11) {
      for (k = -1; k <= 1; k += 2) {
        x = cxAt(s) + k * (CFG.trackHalf + 2.0); z = -s; gy = heightAt(x, z);
        rails.push({ x: x, y: gy + 0.55, z: z, w: 10.6, h: 0.12, d: 0.12, yaw: yawAt(s) });
      }
    }
    instBoxes(rails, 0x76808d);
  }

  /* 沙漠 / 雪原 / 工厂 三个生物群系的侧边装饰 */
  function dressingBiome(rng, kind) {
    var th = CFG.trackHalf, s, u, x, z, gy, k;
    var a = [], b = [], c = [];
    var step = kind === 'factory' ? 24 : 13;
    for (s = 10; s < CFG.finishS; s += step * (0.55 + rng())) {
      u = (rng() < 0.5 ? -1 : 1) * (th + 2.2 + rng() * (kind === 'factory' ? 12 : 18));
      x = cxAt(s) + u; z = -s;
      gy = heightAt(x, z);
      k = rng();
      if (kind === 'dune') {
        if (k < 0.4) {
          a.push({ x: x, y: gy + 1.3, z: z, w: 0.5, h: 2.6, d: 0.5, yaw: rng() * 3 });
          a.push({ x: x + 0.45, y: gy + 1.7, z: z, w: 0.85, h: 0.3, d: 0.28 });
          a.push({ x: x - 0.4, y: gy + 1.3, z: z, w: 0.75, h: 0.28, d: 0.26 });
        } else if (k < 0.7) {
          b.push({ x: x, y: gy + 2.0, z: z, w: 0.8 + rng() * 1.4, h: 4.0 + rng() * 3.2, d: 0.8 + rng() * 1.2, yaw: rng() * 3 });
        } else {
          c.push({ x: x, y: gy + 0.28, z: z, w: 1.6 + rng(), h: 0.55, d: 1.6 + rng(), yaw: rng() * 3 });
        }
      } else if (kind === 'snow') {
        if (k < 0.5) {
          a.push({ x: x, y: gy + 1.6, z: z, w: 0.42, h: 3.2, d: 0.42, yaw: rng() * 3 });
          a.push({ x: x, y: gy + 2.2, z: z, w: 1.9, h: 1.2, d: 1.9, yaw: rng() * 3 });
          a.push({ x: x, y: gy + 3.1, z: z, w: 1.2, h: 1.0, d: 1.2, yaw: rng() * 3 });
        } else if (k < 0.82) {
          c.push({ x: x, y: gy + 0.4, z: z, w: 2.0 + rng() * 2.4, h: 0.8, d: 2.0 + rng() * 2.4, yaw: rng() * 3 });
        } else {
          b.push({ x: x, y: gy + 2.4, z: z, w: 0.16, h: 4.8, d: 0.16 });
        }
      } else {
        if (k < 0.36) {
          a.push({ x: x, y: gy + 1.45, z: z, w: 2.4, h: 2.9, d: 6.2 + rng() * 3, yaw: rng() * 3 });
        } else if (k < 0.66) {
          b.push({ x: x, y: gy + 5.5, z: z, w: 1.1, h: 11, d: 1.1 });
          b.push({ x: x, y: gy + 11.2, z: z, w: 2.6, h: 0.5, d: 2.6 });
        } else {
          c.push({ x: x, y: gy + 0.7, z: z, w: 1.2, h: 1.4, d: 1.2 + rng() * 2.2, yaw: rng() * 3 });
        }
      }
    }
    if (kind === 'dune') {
      instBoxes(a, 0x5c7a4a); instBoxes(b, 0xb07d4a); instBoxes(c, 0x9a6c3c);
    } else if (kind === 'snow') {
      instBoxes(a, 0x2f4a3a); instBoxes(b, 0x6b7784); instBoxes(c, 0xe8f1f7);
    } else {
      instBoxes(a, 0x8a5a3a); instBoxes(b, 0x6e6a63); instBoxes(c, 0x565c60);
    }
  }

  function buildProps() {
    var style = (MP && MP.style) || 'trail';
    // 各场景装饰需要一个固定种子的随机源，否则室外/城市赛道的道具布置会直接抛错
    var rng = mulberry32(CFG.seed + 31);
    if (style === 'trail') { buildTrailProps(); }
    else if (style === 'indoor') { dressingIndoor(rng); }
    else if (style === 'outdoor') { dressingOutdoor(rng); }
    else if (style === 'stair') { dressingStair(rng); }
    else if (style === 'urban') { dressingUrban(rng); }
    else if (style === 'dune') { dressingBiome(rng, 'dune'); }
    else if (style === 'snow') { dressingBiome(rng, 'snow'); }
    else if (style === 'factory') { dressingBiome(rng, 'factory'); }
  }

  function buildTrailProps() {
    var rng = mulberry32(CFG.seed + 7);
    var trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 2.4, 5);
    var leafGeo = new THREE.ConeGeometry(1.55, 4.2, 6);
    var pp = PAL || DEF_PAL;
    var trunkMat = new THREE.MeshLambertMaterial({ color: pp.trunk, flatShading: true });
    var leafMat = new THREE.MeshLambertMaterial({ color: pp.leaf, flatShading: true });
    var count = (MP && typeof MP.treeCount === 'number') ? MP.treeCount : 460;
    if (count < 1) { return; }
    treesTrunk = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    treesLeaf = new THREE.InstancedMesh(leafGeo, leafMat, count);
    var m = new THREE.Matrix4();
    var q = new THREE.Quaternion();
    var p = new THREE.Vector3();
    var sc = new THREE.Vector3();
    var axY = new THREE.Vector3(0, 1, 0);
    var n = 0, guard = 0, s, u, x, z, y, h;
    while (n < count && guard < count * 6) {
      guard++;
      s = rng() * CFG.length;
      u = (rng() < 0.5 ? -1 : 1) * (13.6 + rng() * 13);
      x = cxAt(s) + u; z = -s;
      y = heightAt(x, z);
      h = 0.7 + rng() * 0.75;
      q.setFromAxisAngle(axY, rng() * Math.PI * 2);
      sc.set(h, h, h);
      p.set(x, y + 1.2 * h, z);
      m.compose(p, q, sc);
      treesTrunk.setMatrixAt(n, m);
      p.set(x, y + 1.2 * h + 2.4 * h + 1.4 * h, z);
      m.compose(p, q, sc);
      treesLeaf.setMatrixAt(n, m);
      n++;
    }
    treesTrunk.instanceMatrix.needsUpdate = true;
    treesLeaf.instanceMatrix.needsUpdate = true;
    scene.add(treesTrunk);
    scene.add(treesLeaf);

    var rockGeo = new THREE.DodecahedronGeometry(1, 0);
    var rockMat = new THREE.MeshLambertMaterial({ color: pp.rock, flatShading: true });
    var rc = (MP && typeof MP.rockCount === 'number') ? MP.rockCount : 170;
    if (rc < 1) { return; }
    rocksMesh = new THREE.InstancedMesh(rockGeo, rockMat, rc);
    for (var i = 0; i < rc; i++) {
      var rs = rng() * CFG.length;
      var ru = (rng() < 0.5 ? -1 : 1) * (8 + rng() * 16);
      var rx = cxAt(rs) + ru, rz = -rs;
      var ry = heightAt(rx, rz);
      var rsc = 0.35 + rng() * 1.1;
      q.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3));
      sc.set(rsc, rsc * 0.8, rsc);
      p.set(rx, ry + rsc * 0.35, rz);
      m.compose(p, q, sc);
      rocksMesh.setMatrixAt(i, m);
    }
    rocksMesh.instanceMatrix.needsUpdate = true;
    scene.add(rocksMesh);
  }

  function buildGates() {
    gateGroup = new THREE.Group();
    var poleMat = new THREE.MeshLambertMaterial({ color: 0xc8a96e, flatShading: true });
    var barMat = new THREE.MeshLambertMaterial({ color: 0xe8c07a, flatShading: true });
    var poleGeo = new THREE.BoxGeometry(0.16, 3.2, 0.16);
    var barGeo = new THREE.BoxGeometry(0.16, 0.45, 9);
    var marks = [], s;
    for (s = CFG.cpEvery; s < CFG.finishS; s += CFG.cpEvery) { marks.push({ s: s, fin: false }); }
    marks.push({ s: CFG.finishS, fin: true });
    for (var i = 0; i < marks.length; i++) {
      var mx = cxAt(marks[i].s), mz = -marks[i].s, my = heightAt(mx, mz);
      var l = new THREE.Mesh(poleGeo, poleMat);
      l.position.set(mx - 4.2, my + 1.6, mz);
      var r = new THREE.Mesh(poleGeo, poleMat);
      r.position.set(mx + 4.2, my + 1.6, mz);
      var bar = new THREE.Mesh(barGeo, marks[i].fin ? barMat : poleMat);
      bar.position.set(mx, my + 3.0, mz);
      bar.rotation.y = Math.PI / 2;
      gateGroup.add(l); gateGroup.add(r); gateGroup.add(bar);
    }
    scene.add(gateGroup);
  }

  /* =========================================================
   * 4. 自行车与骑手（低多边形程序化模型）
   * ========================================================= */
  var bikeGroup = null;
  var rearWheelRoot = null, frontWheelRoot = null;
  var rearWheelSpin = null, frontWheelSpin = null;
  var crankSpin = null, barGroup = null, riderTorso = null, shadowMesh = null;

  function makeWheel(matTire, matRim, matDark) {
    var root = new THREE.Group();
    var tire = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.07, 6, 14), matTire);
    tire.rotation.y = Math.PI / 2;
    root.add(tire);
    var spin = new THREE.Group();
    for (var i = 0; i < 5; i++) {
      var spoke = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.58, 0.03), matRim);
      spoke.rotation.x = (i / 5) * Math.PI;
      spin.add(spoke);
    }
    var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 6), matDark);
    hub.rotation.z = Math.PI / 2;
    spin.add(hub);
    root.add(spin);
    return { root: root, spin: spin };
  }

  /* ---------------- 骑手与装备（可换装：背包 / 头盔 / 眼镜） ---------------- */
  var riderGroup = null, riderHead = null;
  var gearHelmetG = [], gearBagG = [], gearGlassG = [];
  var GEAR = null;
  var curGear = { helmet: 0, bag: 1, glasses: 0 };

  function ensureGear() {
    if (GEAR) { return; }
    GEAR = {
      helmet: [
        { key: 'open', nameKey: 'bike.helmetOpen', name: '\u767d\u8272\u534a\u76d4', tagKey: 'bike.gearClassic', tag: '\u7ecf\u5178', color: 0xf2f2f2, visor: 0xdfe6ec, style: 'open' },
        { key: 'full', nameKey: 'bike.helmetFull', name: '\u5168\u76d4', tagKey: 'bike.gearSafe', tag: '\u5b89\u5168', color: 0x2b2f36, visor: 0x8fb6c9, style: 'full' },
        { key: 'aero', nameKey: 'bike.helmetAero', name: '\u6d41\u7ebf\u7ade\u901f', tagKey: 'bike.gearRace', tag: '\u7ade\u901f', color: 0xd94f3d, visor: 0xffd9a0, style: 'aero' },
        { key: 'vintage', nameKey: 'bike.helmetVintage', name: '\u590d\u53e4\u76ae\u76d4', tagKey: 'bike.gearRetro', tag: '\u590d\u53e4', color: 0x8a5a33, visor: 0xd8b98c, style: 'vintage' }
      ],
      bag: [
        { key: 'none', nameKey: 'bike.bagNone', name: '\u4e0d\u80cc\u5305', tagKey: 'bike.gearLight', tag: '\u8f7b\u88c5', color: 0x000000, strap: 0x000000, style: 'none' },
        { key: 'daypack', nameKey: 'bike.bagDaypack', name: '\u53cc\u80a9\u80cc\u5305', tagKey: 'bike.gearDaily', tag: '\u65e5\u5e38', color: 0x2f3a44, strap: 0x1f262c, style: 'daypack' },
        { key: 'hydro', nameKey: 'bike.bagHydro', name: '\u8d8a\u91ce\u6c34\u888b', tagKey: 'bike.gearEnduro', tag: '\u8d8a\u91ce', color: 0x35566b, strap: 0x22323d, style: 'hydro' },
        { key: 'messenger', nameKey: 'bike.bagMessenger', name: '\u90ae\u5dee\u5305', tagKey: 'bike.gearUrban', tag: '\u8857\u5934', color: 0x7a4b2a, strap: 0x4e2f1a, style: 'messenger' }
      ],
      glasses: [
        { key: 'none', nameKey: 'bike.glassNone', name: '\u4e0d\u6234\u773c\u955c', tagKey: 'bike.gearLight', tag: '\u8f7b\u88c5', lens: 0x000000, frame: 0x000000, style: 'none' },
        { key: 'goggle', nameKey: 'bike.glassGoggle', name: '\u62a4\u76ee\u955c', tagKey: 'bike.gearOffroad', tag: '\u8d8a\u91ce', lens: 0xffd27a, frame: 0x2a2f35, style: 'goggle' },
        { key: 'sport', nameKey: 'bike.glassSport', name: '\u8fd0\u52a8\u58a8\u955c', tagKey: 'bike.gearDaily', tag: '\u65e5\u5e38', lens: 0x1f2a33, frame: 0xd94f3d, style: 'sport' },
        { key: 'round', nameKey: 'bike.glassRound', name: '\u590d\u53e4\u5706\u955c', tagKey: 'bike.gearRetro', tag: '\u590d\u53e4', lens: 0x3b2d20, frame: 0xc8a96e, style: 'round' }
      ]
    };
  }

  function partBox(parent, w, h, d, color, x, y, z, rx, ry, rz) {
    var mat = new THREE.MeshLambertMaterial({ color: color, flatShading: true });
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    if (rx) { m.rotation.x = rx; }
    if (ry) { m.rotation.y = ry; }
    if (rz) { m.rotation.z = rz; }
    parent.add(m);
    return m;
  }

  function buildHelmetModel(hd) {
    var g = new THREE.Group();
    if (hd.style === 'open') {
      partBox(g, 0.26, 0.14, 0.28, hd.color, 0, 0.11, 0.00);
      partBox(g, 0.27, 0.03, 0.10, hd.visor, 0, 0.055, 0.17);
      partBox(g, 0.18, 0.03, 0.09, hd.color, 0, 0.185, -0.02);
      partBox(g, 0.05, 0.04, 0.16, 0x2a2f34, 0, 0.10, 0.02);
    } else if (hd.style === 'full') {
      partBox(g, 0.27, 0.17, 0.30, hd.color, 0, 0.09, 0.00);
      partBox(g, 0.24, 0.11, 0.13, hd.color, 0, -0.03, 0.11);
      partBox(g, 0.21, 0.09, 0.02, hd.visor, 0, 0.03, 0.165);
      partBox(g, 0.26, 0.04, 0.06, 0x1b1f24, 0, 0.17, 0.06);
    } else if (hd.style === 'aero') {
      partBox(g, 0.24, 0.14, 0.32, hd.color, 0, 0.10, 0.00);
      partBox(g, 0.17, 0.09, 0.14, hd.color, 0, 0.07, -0.21);
      partBox(g, 0.22, 0.05, 0.06, hd.visor, 0, 0.03, 0.16);
      partBox(g, 0.04, 0.10, 0.20, 0xffffff, 0, 0.13, 0.02);
    } else {
      partBox(g, 0.26, 0.16, 0.27, hd.color, 0, 0.10, 0.00);
      partBox(g, 0.275, 0.045, 0.285, 0x6b4326, 0, 0.02, 0.00);
      partBox(g, 0.10, 0.03, 0.20, 0x4a2c17, 0, 0.19, 0.00);
    }
    return g;
  }

  function buildBagModel(bd) {
    var g = new THREE.Group();
    if (bd.style === 'none') { return g; }
    if (bd.style === 'daypack') {
      partBox(g, 0.30, 0.32, 0.14, bd.color, 0, 0.02, -0.20);
      partBox(g, 0.26, 0.10, 0.07, bd.strap, 0, 0.16, -0.13);
      partBox(g, 0.05, 0.42, 0.05, bd.strap, -0.02, -0.01, -0.13, 0, 0, 0.52);
      partBox(g, 0.05, 0.42, 0.05, bd.strap, 0.02, -0.01, -0.13, 0, 0, -0.52);
      partBox(g, 0.16, 0.09, 0.04, bd.strap, 0, -0.13, -0.24);
    } else if (bd.style === 'hydro') {
      partBox(g, 0.24, 0.34, 0.13, bd.color, 0, 0.02, -0.19);
      partBox(g, 0.20, 0.10, 0.05, bd.strap, 0, 0.15, -0.12);
      partBox(g, 0.20, 0.06, 0.05, bd.strap, 0, -0.13, -0.12);
      partBox(g, 0.035, 0.035, 0.26, 0x9fb2bd, 0.13, 0.10, -0.02, 0.9);
      partBox(g, 0.05, 0.05, 0.05, 0xd8e0e6, 0.14, 0.02, 0.08);
    } else {
      partBox(g, 0.26, 0.20, 0.13, bd.color, 0.16, -0.09, -0.20, 0, 0.35);
      partBox(g, 0.06, 0.44, 0.05, bd.strap, 0.02, 0.06, -0.16, 0, 0, -0.75);
      partBox(g, 0.14, 0.05, 0.04, bd.strap, 0.16, -0.19, -0.20);
    }
    return g;
  }

  function buildGlassModel(gd) {
    var g = new THREE.Group();
    if (gd.style === 'none') { return g; }
    if (gd.style === 'goggle') {
      partBox(g, 0.21, 0.10, 0.04, gd.frame, 0, 0.01, 0.095);
      partBox(g, 0.185, 0.075, 0.02, gd.lens, 0, 0.01, 0.115);
      partBox(g, 0.05, 0.04, 0.10, gd.frame, -0.11, 0.01, 0.05);
      partBox(g, 0.05, 0.04, 0.10, gd.frame, 0.11, 0.01, 0.05);
      partBox(g, 0.24, 0.03, 0.24, 0x1f2429, 0, 0.02, -0.02);
    } else if (gd.style === 'sport') {
      partBox(g, 0.085, 0.055, 0.03, gd.lens, -0.05, 0.01, 0.10);
      partBox(g, 0.085, 0.055, 0.03, gd.lens, 0.05, 0.01, 0.10);
      partBox(g, 0.04, 0.02, 0.03, gd.frame, 0, 0.02, 0.10);
      partBox(g, 0.02, 0.02, 0.20, gd.frame, -0.095, 0.02, 0.00);
      partBox(g, 0.02, 0.02, 0.20, gd.frame, 0.095, 0.02, 0.00);
    } else {
      var cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 8),
        new THREE.MeshLambertMaterial({ color: gd.lens, flatShading: true }));
      cyl.rotation.x = Math.PI / 2;
      cyl.position.set(-0.05, 0.01, 0.10);
      g.add(cyl);
      var cyl2 = cyl.clone();
      cyl2.position.x = 0.05;
      g.add(cyl2);
      partBox(g, 0.05, 0.018, 0.02, gd.frame, 0, 0.02, 0.10);
      partBox(g, 0.02, 0.02, 0.19, gd.frame, -0.10, 0.02, 0.00);
      partBox(g, 0.02, 0.02, 0.19, gd.frame, 0.10, 0.02, 0.00);
    }
    return g;
  }

  function buildRider(chassis) {
    ensureGear();
    var SHIRT = 0xd1622e, SHIRT_D = 0xb14f24, PANTS = 0xd8c9a8, SKIN = 0xd9a97e,
      SHOE = 0x2b2f34, GLOVE = 0x3a4046;
    riderGroup = new THREE.Group();
    var k, sd, sx = [-1, 1];

    partBox(riderGroup, 0.30, 0.15, 0.24, PANTS, 0, 0.29, -0.30);
    riderTorso = partBox(riderGroup, 0.34, 0.44, 0.25, SHIRT, 0, 0.55, -0.20, 0.26);
    partBox(riderGroup, 0.37, 0.10, 0.23, SHIRT_D, 0, 0.75, -0.11);
    partBox(riderGroup, 0.10, 0.08, 0.10, SKIN, 0, 0.81, -0.06);

    riderHead = new THREE.Group();
    riderHead.position.set(0, 0.92, -0.03);
    riderGroup.add(riderHead);
    partBox(riderHead, 0.17, 0.19, 0.18, SKIN, 0, 0, 0);
    partBox(riderHead, 0.03, 0.06, 0.06, 0x2a2f34, 0, -0.01, 0.095);

    for (k = 0; k < 2; k++) {
      sd = sx[k];
      partBox(riderGroup, 0.10, 0.32, 0.10, SHIRT, sd * 0.19, 0.64, -0.03, 1.02);
      partBox(riderGroup, 0.09, 0.30, 0.09, SKIN, sd * 0.22, 0.51, 0.26, 1.42);
      partBox(riderGroup, 0.10, 0.10, 0.11, GLOVE, sd * 0.23, 0.42, 0.48, 0.20);
      partBox(riderGroup, 0.13, 0.34, 0.14, PANTS, sd * 0.12, 0.15, -0.16, 0.78);
      partBox(riderGroup, 0.12, 0.32, 0.12, PANTS, sd * 0.14, -0.10, 0.00, 0.12);
      partBox(riderGroup, 0.13, 0.08, 0.25, SHOE, sd * 0.14, -0.28, 0.04, 0.05);
    }

    // 头盔 / 眼镜：装配到头部
    var i;
    for (i = 0; i < GEAR.helmet.length; i++) {
      var hg = buildHelmetModel(GEAR.helmet[i]);
      hg.visible = false;
      riderHead.add(hg);
      gearHelmetG.push(hg);
    }
    for (i = 0; i < GEAR.glasses.length; i++) {
      var gg = buildGlassModel(GEAR.glasses[i]);
      gg.visible = false;
      riderHead.add(gg);
      gearGlassG.push(gg);
    }
    // 背包：装配到躯干（跟随前倾）
    for (i = 0; i < GEAR.bag.length; i++) {
      var bg = buildBagModel(GEAR.bag[i]);
      bg.visible = false;
      riderTorso.add(bg);
      gearBagG.push(bg);
    }

    chassis.add(riderGroup);
    // 车把号码牌
    partBox(chassis, 0.22, 0.26, 0.02, 0xf4f1e6, 0, 0.57, 0.63, 0.12);
    partBox(chassis, 0.03, 0.13, 0.01, 0x1e2226, -0.02, 0.575, 0.645, 0.12);
  }

  function applyGearLight() {
    ensureGear();
    var i;
    for (i = 0; i < gearHelmetG.length; i++) { gearHelmetG[i].visible = (i === curGear.helmet); }
    for (i = 0; i < gearBagG.length; i++) { gearBagG[i].visible = (i === curGear.bag); }
    for (i = 0; i < gearGlassG.length; i++) { gearGlassG[i].visible = (i === curGear.glasses); }
  }

  function gearIndexByKey(group, key, fallback) {
    ensureGear();
    var arr = GEAR[group], i;
    if (key !== null && key !== undefined && key !== '') {
      for (i = 0; i < arr.length; i++) { if (arr[i].key === key) { return i; } }
    }
    return fallback;
  }

  function applyGear(group, idx) {
    ensureGear();
    var arr = GEAR[group];
    idx = clamp(idx, 0, arr.length - 1);
    curGear[group] = idx;
    save('cealin_bike_' + group, arr[idx].key);
    applyGearLight();
  }

  function loadGear() {
    ensureGear();
    curGear.helmet = gearIndexByKey('helmet', store('cealin_bike_helmet'), 0);
    curGear.bag = gearIndexByKey('bag', store('cealin_bike_bag'), 1);
    curGear.glasses = gearIndexByKey('glasses', store('cealin_bike_glasses'), 0);
  }

  function buildBikeModel() {
    bikeGroup = new THREE.Group();
    var matFrame = new THREE.MeshLambertMaterial({ color: 0x3b7fa6, flatShading: true });
    var matDark = new THREE.MeshLambertMaterial({ color: 0x22282c, flatShading: true });
    var matTire = new THREE.MeshLambertMaterial({ color: 0x1a1d1f, flatShading: true });
    var matRim = new THREE.MeshLambertMaterial({ color: 0xc8a96e, flatShading: true });
    var matShirt = new THREE.MeshLambertMaterial({ color: 0xa44a36, flatShading: true });
    var matSkin = new THREE.MeshLambertMaterial({ color: 0xd9a97e, flatShading: true });
    var matHelmet = new THREE.MeshLambertMaterial({ color: 0xe8c07a, flatShading: true });
    BIKE_MATS = { frame: matFrame, tire: matTire, rim: matRim, shirt: matShirt, skin: matSkin, helmet: matHelmet };

    var chassis = new THREE.Group();
    bikeGroup.add(chassis);

    function box(w, h, d, mat, x, y, z, rx) {
      var mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      if (rx) { mesh.rotation.x = rx; }
      chassis.add(mesh);
      return mesh;
    }

    // 车架
    box(0.075, 0.075, 0.86, matFrame, 0, 0.10, 0.12, -0.42);
    box(0.07, 0.07, 0.62, matFrame, 0, 0.30, -0.02, 0.26);
    box(0.07, 0.34, 0.07, matFrame, 0, 0.16, -0.40, 0);
    box(0.06, 0.06, 0.62, matDark, 0, -0.06, -0.30, 0);
    // 前叉
    box(0.06, 0.44, 0.06, matDark, -0.10, 0.10, 0.56, -0.12);
    box(0.06, 0.44, 0.06, matDark, 0.10, 0.10, 0.56, -0.12);
    // 车把
    barGroup = new THREE.Group();
    barGroup.position.set(0, 0.38, 0.56);
    var bar = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.05), matDark);
    barGroup.add(bar);
    var stem = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.06), matDark);
    stem.position.y = 0.06;
    barGroup.add(stem);
    chassis.add(barGroup);
    // 座垫
    box(0.16, 0.06, 0.30, matDark, 0, 0.34, -0.36, -0.08);

    // 曲柄
    crankSpin = new THREE.Group();
    crankSpin.position.set(0, -0.02, -0.10);
    crankSpin.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.30, 0.05), matDark));
    var ring = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 8), matRim);
    ring.rotation.z = Math.PI / 2;
    crankSpin.add(ring);
    chassis.add(crankSpin);

    // 骑手（可换装）
    buildRider(chassis);

    var rearWheel = makeWheel(matTire, matRim, matDark);
    rearWheelRoot = rearWheel.root;
    rearWheelSpin = rearWheel.spin;
    rearWheelRoot.position.set(0, -0.50, -0.58);
    bikeGroup.add(rearWheelRoot);

    var frontWheel = makeWheel(matTire, matRim, matDark);
    frontWheelRoot = frontWheel.root;
    frontWheelSpin = frontWheel.spin;
    frontWheelRoot.position.set(0, -0.50, 0.60);
    bikeGroup.add(frontWheelRoot);

    scene.add(bikeGroup);

    var shadowGeo = new THREE.CircleGeometry(0.95, 14);
    var shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false });
    shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    scene.add(shadowMesh);
  }

  /* =========================================================
   * 5. 刚体 / 悬挂 参数与状态
   * ========================================================= */
  var MASS = 88;
  var INV_MASS = 1 / MASS;
  var INV_I = new THREE.Vector3(1 / 26, 1 / 32, 1 / 14);   // 本地轴：x 前后翻 / y 偏航 / z 侧滚

  var body = {
    pos: new THREE.Vector3(0, 0, 0),
    quat: new THREE.Quaternion(),
    vel: new THREE.Vector3(),
    ang: new THREE.Vector3()
  };

  var WHEELS = [
    {
      name: 'rear', lx: 0, ly: -0.02, lz: -0.58, rad: 0.34,
      k: 5400, c: 880, maxLen: 0.60, minLen: 0.34, drive: 1,
      comp: 0.08, prevComp: 0.08, contact: false, load: 0, slip: 0, spin: 0,
      attach: new THREE.Vector3(), cp: new THREE.Vector3(), cn: new THREE.Vector3()
    },
    {
      name: 'front', lx: 0, ly: -0.02, lz: 0.60, rad: 0.34,
      k: 4900, c: 800, maxLen: 0.60, minLen: 0.34, drive: 0,
      comp: 0.08, prevComp: 0.08, contact: false, load: 0, slip: 0, spin: 0,
      attach: new THREE.Vector3(), cp: new THREE.Vector3(), cn: new THREE.Vector3()
    }
  ];

  var input = { throttle: 0, brake: 0, leanBack: 0, leanFwd: 0, yawLeft: 0, yawRight: 0, jump: false };
  var jumpCharge = 0;
  var jumpHeld = false;
  var driveLag = 0;

  var state = 'ready';        // ready | running | paused | crash | finish
  var elapsed = 0;
  var dist = 0;
  var speed = 0;
  var maxSpeed = 0;
  var crashes = 0;
  var airCount = 0;
  var trickScore = 0;
  var cpIndex = 0;
  var airborne = false;
  var airTime = 0;
  var grounded = true;
  var pitchAccum = 0;
  var yawAccum = 0;
  var crashTimer = 0;
  var bestTime = 0;
  var bestTrick = 0;
  var lastLanding = null;
  var fps = 0;
  var totalAirTime = 0;
  var bend = 0;

  function scoreKey(kind) {
    var k = (MAPS && MAPS[curMapIdx]) ? MAPS[curMapIdx].key : 'dusk';
    return 'cealin_bike_' + kind + '_' + k;
  }
  function loadBest() {
    bestTime = 0;
    bestTrick = 0;
    var b = parseFloat(store(scoreKey('best')));
    if (!(isFinite(b) && b > 0) && curMapIdx === 0) { b = parseFloat(store('cealin_bike_best')); }
    if (isFinite(b) && b > 0) { bestTime = b; }
    var tk = parseFloat(store(scoreKey('trick')));
    if (!(isFinite(tk) && tk > 0) && curMapIdx === 0) { tk = parseFloat(store('cealin_bike_trick')); }
    if (isFinite(tk) && tk > 0) { bestTrick = tk; }
    var wb = parseFloat(store(scoreKey('wheelie')));
    if (isFinite(wb) && wb > 0) { wheelieBest = wb; }
  }

  var T1 = new THREE.Vector3(), T2 = new THREE.Vector3(), T3 = new THREE.Vector3();
  var T4 = new THREE.Vector3(), T5 = new THREE.Vector3(), T6 = new THREE.Vector3();
  var T7 = new THREE.Vector3(), T8 = new THREE.Vector3(), T9 = new THREE.Vector3();
  var F_ACC = new THREE.Vector3(), T_ACC = new THREE.Vector3();
  var GRAV = new THREE.Vector3(0, -9.81, 0);
  // 骑手平衡回路参数（自动姿态稳定：俯仰 / 侧倾的恢复力矩与阻尼）
  var BAL_K = 1500, BAL_D = 400;

  /* =========================================================
   * 6. 放置 / 复活 / 地面射线
   * ========================================================= */
  function alignQuat(fwdDir, upDir, outQuat) {
    var fwd = fwdDir.clone().normalize();
    var up = upDir.clone().normalize();
    var right = new THREE.Vector3().crossVectors(up, fwd);
    if (right.lengthSq() < 1e-6) { right.set(1, 0, 0); }
    right.normalize();
    up.crossVectors(fwd, right).normalize();
    var mtx = new THREE.Matrix4().makeBasis(right, up, fwd);
    return outQuat.setFromRotationMatrix(mtx);
  }

  function placeAt(s, u) {
    var x = cxAt(s) + (u || 0);
    var z = -s;
    var y = heightAt(x, z) + 1.02;
    body.pos.set(x, y, z);
    normalAt(x, z, _nrm);
    var fd = new THREE.Vector3(0, 0, -1);
    fd.addScaledVector(_nrm, -fd.dot(_nrm)).normalize();
    alignQuat(fd, _nrm, body.quat);
    body.vel.set(0, 0, 0);
    body.ang.set(0, 0, 0);
    pitchAccum = 0; yawAccum = 0; airTime = 0; airborne = false;
    for (var i = 0; i < WHEELS.length; i++) {
      WHEELS[i].comp = 0.08; WHEELS[i].prevComp = 0.08; WHEELS[i].contact = false; WHEELS[i].load = 0;
    }
    camPos.set(x, y + 3, z + 7);
  }

  function respawnAtCheckpoint() {
    var s = CFG.startS + cpIndex * CFG.cpEvery + 4;
    if (s > CFG.finishS - 6) { s = CFG.finishS - 6; }
    placeAt(s, 0);
    state = 'running';
    crashTimer = 0;
    jumpCharge = 0;
    driveLag = 0;
  }

  function rayGround(attach, dir, maxT) {
    var step = 0.035, t = 0.05, prevT = 0, prevDelta = 0, delta;
    for (var i = 0; i < 42; i++) {
      T3.copy(attach).addScaledVector(dir, t);
      delta = T3.y - heightAt(T3.x, T3.z);
      if (delta <= 0) {
        if (i === 0) { return t; }
        var denom = prevDelta - delta;
        var frac = denom > 1e-6 ? clamp(prevDelta / denom, 0, 1) : 1;
        return prevT + (t - prevT) * frac;
      }
      prevT = t; prevDelta = delta;
      t += step;
      if (t > maxT) { return -1; }
    }
    return -1;
  }

  /* =========================================================
   * 7. 物理主循环（固定步长）
   * ========================================================= */
  var CP_P = new THREE.Vector3(), CP_N = new THREE.Vector3(), CP_V = new THREE.Vector3();
  var CP_F = new THREE.Vector3(), CP_R = new THREE.Vector3(), CP_T = new THREE.Vector3();
  var CP_FWD = new THREE.Vector3(), CP_LAT = new THREE.Vector3();
  var TM = new THREE.Vector3(), Q_INV = new THREE.Quaternion(), Q_W = new THREE.Quaternion();
  var WORLD_UP = new THREE.Vector3(0, 1, 0);
  var lastVy = 0;
  var lastTilt = 0, lastClear = 0;
  var TRACE_ON = false, TRACE = [];

  function physicsStep(dt) {
    F_ACC.set(0, 0, 0);
    T_ACC.set(0, 0, 0);
    lastVy = body.vel.y;

    // 重力
    F_ACC.addScaledVector(GRAV, MASS);

    // 空气阻力 F = -k * v * |v|
    var sp = body.vel.length();
    if (sp > 0.05) {
      TM.copy(body.vel).multiplyScalar(-0.26 * sp);
      F_ACC.add(TM);
    }

    var q = body.quat;
    var downW = T1.set(0, -1, 0).applyQuaternion(q);
    var fwdW = T2.set(0, 0, 1).applyQuaternion(q);
    var rightW = T4.set(1, 0, 0).applyQuaternion(q);
    var upW = T5.set(0, 1, 0).applyQuaternion(q);
    var act = (state === 'running') ? 1 : 0;

    // 骑手平衡参考量：车身相对地形法线的俯仰偏差（决定翘头程度与驱动力收敛）
    normalAt(body.pos.x, body.pos.z, T3);
    var noseUp = fwdW.dot(T3);   // >0：车头相对坡面抬起（后轮压地、前轮卸载）

    // 驱动滞后：模拟轮系 + 后轮转动惯量的加速延迟
    driveLag += ((input.throttle * act) - driveLag) * clamp(dt * 9, 0, 1);

    var contactCount = 0, i, w;
    for (i = 0; i < WHEELS.length; i++) {
      w = WHEELS[i];
      w.attach.set(w.lx, w.ly, w.lz).applyQuaternion(q).add(body.pos);
      var gDist = rayGround(w.attach, downW, w.maxLen + w.rad + 0.28);

      if (gDist > 0 && (gDist - w.rad) <= w.maxLen) {
        contactCount++;
        w.contact = true;

        var Lg = gDist - w.rad;                       // 轮心到上支点距离
        var L = clamp(Lg, w.minLen, w.maxLen);
        w.prevComp = w.comp;
        w.comp = w.maxLen - L;
        var compVel = (w.comp - w.prevComp) / dt;

        // 弹簧 - 阻尼：压缩量越大越推回
        var Fn = w.k * w.comp + w.c * compVel;
        if (Lg < w.minLen) { Fn += 150000 * (w.minLen - Lg); }   // 触底硬止档
        if (Fn < 0) { Fn = 0; }
        if (Fn > 24000) { Fn = 24000; }
        w.load = Fn;

        CP_P.copy(w.attach).addScaledVector(downW, L);   // 轮心
        w.cp.copy(CP_P);
        normalAt(CP_P.x, CP_P.z, CP_N);
        CP_R.copy(CP_P).sub(body.pos);
        CP_V.copy(body.ang).cross(CP_R).add(body.vel);

        CP_F.copy(CP_N).multiplyScalar(Fn);              // 法向支反力

        // 轮胎前进方向（投影到接触面）
        CP_FWD.copy(fwdW).addScaledVector(CP_N, -fwdW.dot(CP_N));
        if (CP_FWD.lengthSq() < 1e-5) { CP_FWD.set(0, 0, -1); }
        CP_FWD.normalize();
        CP_LAT.crossVectors(CP_N, CP_FWD).normalize();

        var mu = gripAt(CP_P.x, CP_P.z);
        var maxFric = mu * Fn;
        var vf = CP_V.dot(CP_FWD);
        var vl = CP_V.dot(CP_LAT);

        // 驱动（后轮）：扭矩随速度衰减
        if (w.drive && driveLag > 0.002) {
          // 防翘头：车头抬起时后轮驱动力自动收敛（骑手收油、重心前移的等效）
          var antiW = clamp(1 - Math.max(0, noseUp) * 1.35 + (backPull || 0) * 0.95, 0.1, 1);
          var engine = (ENGINE || 660) * antiW * (1 - clamp(vf / 24, 0, 1) * 0.72);
          var dF = driveLag * engine;
          if (dF > maxFric * 1.2) { dF = maxFric * 1.2; w.slip = 1; } else { w.slip = 0; }
          CP_F.addScaledVector(CP_FWD, dF);
        }

        // 刹车
        if (input.brake * act > 0.002 && Math.abs(vf) > 0.25) {
          var brakeMax = (w.drive ? 1150 : 1550) * input.brake * act;
          var bF = Math.min(brakeMax, Math.abs(vf) * 300 + 80);
          var bLim = maxFric * 1.5;
          if (bF > bLim) { bF = bLim; }
          CP_F.addScaledVector(CP_FWD, -Math.sign(vf) * bF);
        }

        // 侧向摩擦约束：超过抓地上限即打滑
        CP_F.addScaledVector(CP_LAT, clamp(-vl * 340, -maxFric, maxFric));

        // 滚动阻力
        if (Math.abs(vf) > 0.05) {
          CP_F.addScaledVector(CP_FWD, -Math.sign(vf) * 0.03 * Fn);
        }

        F_ACC.add(CP_F);
        CP_T.crossVectors(CP_R, CP_F);
        T_ACC.add(CP_T);

        w.spin += (vf / w.rad) * dt;
      } else {
        w.contact = false;
        w.prevComp = w.comp;
        w.comp = Math.max(0, w.comp - dt * 1.6);
        w.load = 0;
        w.slip = 0;
        w.spin += (body.vel.dot(fwdW) / w.rad) * dt * 0.35;
      }
    }

    grounded = contactCount > 0;

    // ---- Wheelie：后仰 + 油门抬前轮，后轮滑行按角度与时长累计特技分 ----
    var noseAng = Math.asin(clamp(noseUp, -1, 1));
    wheelieAngle = noseAng;
    if (state === 'running' && grounded && noseAng > 0.16 && driveLag > 0.05) {
      if (!wheelieActive) { wheelieActive = true; wheelieTime = 0; wheeliePeak = 0; wheeliePeakAng = 0; wheelieBanked = wheelieScoreF; }
      wheelieTime += dt;
      if (noseAng > wheeliePeakAng) { wheeliePeakAng = noseAng; }
      wheelieScoreF += dt * (32 + 104 * clamp((noseAng - 0.16) / 0.55, 0, 1)) * (0.8 + 0.45 * clamp(speed / 12, 0, 1));
      if (wheelieTime > wheelieBest) {
        wheelieBest = wheelieTime;
        save(scoreKey('wheelie'), wheelieBest.toFixed(2));
      }
      trickScore = trickAir + Math.round(wheelieScoreF);
      if (noseAng > 1.12) { crashNow('wheelie'); toast(t('bike.wheelieOver')); }
    } else if (wheelieActive) {
      wheelieActive = false;
      var wGain = Math.round(wheelieScoreF - wheelieBanked);
      wheelieBanked = wheelieScoreF;
      if (wheelieTime > 0.55 && wGain > 0) {
        toast(t('bike.wheelie') + ' ' + wheelieTime.toFixed(1) + 's  +' + wGain);
      }
      wheelieTime = 0;
      wheeliePeak = 0;
      wheeliePeakAng = 0;
    }

    // 姿态控制：↑ 前倾（压车头 / 空中前翻）、↓ 后仰（抬前轮 wheelie / 空中后翻）
    var pitchFwdIn = clamp((input.pitchFwd || 0) + (input.leanFwd || 0) * 0.1, 0, 1);
    var pitchBackIn = clamp((input.pitchBack || 0) + (input.leanBack || 0) * 0.85, 0, 1);
    var pitchIn = (pitchFwdIn - pitchBackIn) * act;         // +X 力矩 = 车头下压
    var yawIn = (input.yawRight - input.yawLeft) * act;
    backPull = pitchBackIn * act;
    if (grounded) {
      // 地面：重心前后移动产生俯仰力矩（压头 / 翘头）
      T_ACC.add(TM.set(pitchIn * 520, yawIn * 40, 0).applyQuaternion(q));
      if (backPull > 0.01) {
        // 后仰抬升力矩：油门越大、车速越低，前轮越容易离地（wheelie）
        // 目标仰角随速度收紧：接近目标时力矩自然衰减，超过目标反向压车头，形成可稳定保持的后轮滑行
        var thetaMax = 0.68 - 0.12 * clamp(speed / 24, 0, 1);
        var liftSoft = clamp(1 - noseAng / thetaMax, -0.65, 1);
        var liftK = (430 + 620 * driveLag) * liftSoft;
        T_ACC.addScaledVector(rightW, -backPull * liftK * (1 - clamp(speed / 30, 0, 0.3)));
        T_ACC.addScaledVector(rightW, -backPull * 110 * body.ang.dot(rightW));
      }
    } else {
      // 空中：俯仰做前后翻，左右做旋转
      T_ACC.add(TM.set(pitchIn * 190, yawIn * 100, 0).applyQuaternion(q));
      body.ang.multiplyScalar(1 - clamp(dt * 0.5, 0, 0.2));
    }

    // ---- 骑手平衡回路：贴地时自动把车身姿态拉回坡面，并给俯仰/侧倾加阻尼 ----
    if (grounded) {
      normalAt(body.pos.x, body.pos.z, T3);
      T6.crossVectors(upW, T3);                       // 恢复轴：把车身 up 拧向地形法线
      var balK = (BAL_K + Math.min(sp, 30) * 22) * (1 - 0.58 * clamp(backPull || 0, 0, 1));
      T_ACC.addScaledVector(T6, balK);
      T_ACC.addScaledVector(rightW, -BAL_D * body.ang.dot(rightW));   // 俯仰阻尼
      T_ACC.addScaledVector(fwdW, -BAL_D * body.ang.dot(fwdW));       // 侧倾阻尼
    }

    // ---- 线速度积分 ----
    body.vel.addScaledVector(F_ACC, INV_MASS * dt);
    if (body.vel.length() > 58) { body.vel.setLength(58); }

    // ---- 角速度积分（本地惯量张量转世界）----
    Q_INV.copy(q).invert();
    TM.copy(T_ACC).applyQuaternion(Q_INV);
    TM.set(TM.x * INV_I.x, TM.y * INV_I.y, TM.z * INV_I.z);
    TM.applyQuaternion(q);
    body.ang.addScaledVector(TM, dt);
    body.ang.multiplyScalar(1 - clamp(dt * 0.12, 0, 0.1));
    if (body.ang.length() > 24) { body.ang.setLength(24); }

    // ---- 位置 / 姿态积分 ----
    body.pos.addScaledVector(body.vel, dt);
    Q_W.set(body.ang.x, body.ang.y, body.ang.z, 0).multiply(q);
    body.quat.x += 0.5 * Q_W.x * dt;
    body.quat.y += 0.5 * Q_W.y * dt;
    body.quat.z += 0.5 * Q_W.z * dt;
    body.quat.w += 0.5 * Q_W.w * dt;
    body.quat.normalize();

    // 穿透兜底
    var gy = heightAt(body.pos.x, body.pos.z);
    if (body.pos.y < gy - 0.3) {
      body.pos.y = gy + 0.5;
      if (body.vel.y < 0) { body.vel.y *= -0.15; }
    }

    // ---- 腾空 / 落地判定 ----
    if (!grounded) {
      if (!airborne) { airborne = true; airTime = 0; pitchAccum = 0; yawAccum = 0; }
      airTime += dt;
      totalAirTime += dt;
      pitchAccum += body.ang.dot(rightW) * dt;
      yawAccum += body.ang.dot(upW) * dt;
    } else if (airborne) {
      if (airTime > 0.22) { onLanding(upW); }
      airborne = false;
      airTime = 0;
      pitchAccum = 0;
      yawAccum = 0;
    }

    // ---- 翻车判定 ----
    if (state === 'running') {
      normalAt(body.pos.x, body.pos.z, CP_N);
      var tilt = Math.acos(clamp(upW.dot(CP_N), -1, 1));
      var bodyClear = body.pos.y - heightAt(body.pos.x, body.pos.z);
      lastTilt = tilt; lastClear = bodyClear;
      if (grounded && tilt > 1.05) { crashNow('flip'); }
      else if (bodyClear < 0.40 && body.vel.length() > 3) { crashNow('body'); }
    }

    if (TRACE_ON) {
      TRACE.push([+elapsed.toFixed(2), +lastTilt.toFixed(3), +body.ang.x.toFixed(3),
        Math.round(WHEELS[0].load), Math.round(WHEELS[1].load),
        +WHEELS[0].comp.toFixed(3), +WHEELS[1].comp.toFixed(3),
        +lastVy.toFixed(2), +body.vel.y.toFixed(2), state,
        +fwdW.y.toFixed(3), +body.pos.y.toFixed(2),
        +(body.pos.y - heightAt(body.pos.x, body.pos.z)).toFixed(2),
        +(body.pos.x - cxAt(-body.pos.z)).toFixed(2),
        +(body.vel.z).toFixed(2)]);
      if (TRACE.length > 4000) { TRACE_ON = false; }
    }

    dist = Math.max(dist, -body.pos.z - CFG.startS);
    speed = body.vel.length();
    if (state === 'running' && speed > maxSpeed) { maxSpeed = speed; }
  }

  function onLanding(upW) {
    airCount++;
    normalAt(body.pos.x, body.pos.z, CP_N);
    var tilt = Math.acos(clamp(upW.dot(CP_N), -1, 1));
    var flips = Math.round(Math.abs(pitchAccum) / (Math.PI * 2));
    var spins = Math.round(Math.abs(yawAccum) / (Math.PI * 2));
    lastLanding = { tilt: tilt, vy: lastVy, flips: flips, spins: spins, air: airTime };
    sfxLand(tilt > 0.7 || lastVy < -9);
    if (airTime >= 3 && (parseFloat(store('cealin_bike_best_air')) || 0) < airTime) { save('cealin_bike_best_air', airTime.toFixed(2)); }
    if (state === 'running') { checkAch(); }

    var tiltTol = 1.20 + 0.06 * (UPG.susp || 0);
    var vyTol = -13 - 0.9 * (UPG.susp || 0);
    if (tilt > tiltTol || lastVy < vyTol) {
      crashNow('landing');
      return;
    }
    if (flips >= 1 || spins >= 1) {
      var gain = Math.round((flips * 260 + spins * 180) * clamp(0.6 + speed / 16, 0.6, 1.8));
      trickAir += gain;
      trickScore = trickAir + Math.round(wheelieScoreF);
      toast((flips >= 1 ? (flips > 1 ? flips + 'x ' : '') + t('bike.trickFlip') : '') +
        (spins >= 1 ? ' ' + (spins > 1 ? spins + 'x ' : '') + t('bike.trickSpin') : '') + '  +' + gain);
      if (trickScore > bestTrick) { bestTrick = trickScore; save(scoreKey('trick'), bestTrick); }
    }
  }

  function crashNow(reason) {
    if (state !== 'running') { return; }
    state = 'crash';
    sfxCrash();
    crashes++;
    crashTimer = 0;
    lastCrashReason = reason;
    body.ang.set((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7);
    body.vel.multiplyScalar(0.45);
    toast(t('bike.crashed'));
  }
  var lastCrashReason = '';

  /* =========================================================
   * 8. 视觉刷新 / 跟随相机
   * ========================================================= */
  var camPos = new THREE.Vector3(0, 20, 30);
  var camLook = new THREE.Vector3(0, 0, 0);
  var CAM_UP = new THREE.Vector3(0, 1, 0);

  function updateVisual() {
    bikeGroup.position.copy(body.pos);
    bikeGroup.quaternion.copy(body.quat);
    var w0 = WHEELS[0], w1 = WHEELS[1];
    rearWheelRoot.position.set(w0.lx, w0.ly - (w0.maxLen - w0.comp), w0.lz);
    frontWheelRoot.position.set(w1.lx, w1.ly - (w1.maxLen - w1.comp), w1.lz);
    rearWheelSpin.rotation.x = w0.spin;
    frontWheelSpin.rotation.x = w1.spin;
    crankSpin.rotation.x = w0.spin * 0.32;
    var lean = input.leanFwd - input.leanBack;
    if (riderTorso) { riderTorso.rotation.x = 0.30 + lean * 0.16; }
    var gy = heightAt(body.pos.x, body.pos.z);
    shadowMesh.position.set(body.pos.x, gy + 0.07, body.pos.z);
    var alt = body.pos.y - gy;
    var sc = clamp(1.08 - alt * 0.10, 0.35, 1.1);
    shadowMesh.scale.set(sc, sc, sc);
    shadowMesh.material.opacity = clamp(0.30 - alt * 0.028, 0.04, 0.30);
  }

  function updateCamera(dt) {
    if (camMode === 'first') { updateCameraFirst(dt); return; }
    var fwd = T6.set(0, 0, 1).applyQuaternion(body.quat);
    var flat = T7.set(fwd.x, 0, fwd.z);
    if (flat.lengthSq() < 1e-4) { flat.set(0, 0, -1); }
    flat.normalize();

    var backDist = 5.3 + speed * 0.11;
    var height = 2.15 + speed * 0.022;
    var desired = T8.copy(body.pos).addScaledVector(flat, -backDist).addScaledVector(CAM_UP, height);
    var gh = heightAt(desired.x, desired.z) + 1.3;
    if (desired.y < gh) { desired.y = gh; }

    var kp = 1 - Math.exp(-dt * 5.5);
    camPos.lerp(desired, kp);

    var lookAt = T9.copy(body.pos).addScaledVector(flat, 4.2).addScaledVector(CAM_UP, 1.0);
    camLook.lerp(lookAt, 1 - Math.exp(-dt * 7.5));

    camera.position.copy(camPos);
    camera.lookAt(camLook);
    var targetFov = 60 + clamp(speed * 0.85, 0, 22);
    camera.fov = lerp(camera.fov, targetFov, 1 - Math.exp(-dt * 3));
    camera.updateProjectionMatrix();
  }

  /* 第一人称：镜头贴车把后上方，视线跟随车身姿态 */
  function updateCameraFirst(dt) {
    var fwd = T6.set(0, 0, 1).applyQuaternion(body.quat);
    var up = T7.set(0, 1, 0).applyQuaternion(body.quat);
    var flat = T8.set(fwd.x, 0, fwd.z);
    if (flat.lengthSq() < 1e-4) { flat.set(0, 0, 1); }
    flat.normalize();
    var eye = T9.copy(body.pos)
      .addScaledVector(flat, 0.42)
      .addScaledVector(CAM_UP, 1.24)
      .addScaledVector(fwd, 0.18);
    var gh = heightAt(eye.x, eye.z) + 0.55;
    if (eye.y < gh) { eye.y = gh; }
    camPos.lerp(eye, 1 - Math.exp(-dt * 18));
    var look = body.pos.clone().addScaledVector(flat, 8.5).addScaledVector(CAM_UP, 0.72);
    camLook.lerp(look, 1 - Math.exp(-dt * 15));
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    var targetFov = 70 + clamp(speed * 0.9, 0, 20);
    camera.fov = lerp(camera.fov, targetFov, 1 - Math.exp(-dt * 3));
    camera.updateProjectionMatrix();
  }

  /* =========================================================
   * 9. HUD / 覆盖层 / 提示
   * ========================================================= */
  function byId(id) { return doc.getElementById(id); }
  var el = {
    time: byId('hudTime'), best: byId('hudBest'), speed: byId('hudSpeed'),
    dist: byId('hudDist'), trick: byId('hudTrick'), crash: byId('hudCrash'),
    cp: byId('hudCp'), surf: byId('hudSurf'), progress: byId('hudProgress'),
    overlay: byId('bikeOverlay'), ovTitle: byId('ovTitle'), ovDesc: byId('ovDesc'),
    ovStats: byId('ovStats'), ovBtn: byId('ovBtn'), btnPause: byId('btnPause'),
    toast: byId('bikeToast')
  };
  var overlayMode = 'ready';
  var toastTimer = 0;

  function toast(msg) {
    if (!el.toast) { return; }
    el.toast.textContent = msg;
    el.toast.classList.remove('hide');
    toastTimer = 1.8;
  }

  function showOverlay(mode) {
    overlayMode = mode;
    if (!el.overlay) { return; }
    el.overlay.classList.remove('hide');
    if (mode === 'ready') {
      el.ovTitle.textContent = t('bike.readyTitle');
      el.ovDesc.textContent = t('bike.readyDesc');
      el.ovStats.innerHTML = '';
      el.ovBtn.textContent = t('bike.start');
    } else if (mode === 'paused') {
      el.ovTitle.textContent = t('bike.pausedTitle');
      el.ovDesc.textContent = t('bike.pausedDesc');
      el.ovStats.innerHTML = '';
      el.ovBtn.textContent = t('bike.resume');
    } else if (mode === 'finish') {
      el.ovTitle.textContent = t('bike.finishTitle');
      el.ovDesc.textContent = t('bike.finishDesc');
      el.ovStats.innerHTML =
        '<div><span>' + t('bike.time') + '</span><b>' + fmtTime(elapsed) + '</b></div>' +
        '<div><span>' + t('bike.best') + '</span><b>' + fmtTime(bestTime) + '</b></div>' +
        '<div><span>' + t('bike.trick') + '</span><b>' + trickScore + '</b></div>' +
        '<div><span>' + t('bike.crashCount') + '</span><b>' + crashes + '</b></div>';
      el.ovBtn.textContent = t('bike.playAgain');
    }
  }
  function hideOverlay() {
    if (el.overlay) { el.overlay.classList.add('hide'); }
  }

  function updateHud(dt) {
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0 && el.toast) { el.toast.classList.add('hide'); }
    }
    hudAcc += dt;
    if (hudAcc < 0.1) { return; }
    hudAcc = 0;
    if (el.time) { el.time.textContent = fmtTime(elapsed); }
    if (el.best) { el.best.textContent = bestTime > 0 ? fmtTime(bestTime) : '--:--'; }
    if (el.speed) { el.speed.textContent = Math.round(speed * 3.6) + ' km/h'; }
    if (el.dist) { el.dist.textContent = Math.round(dist) + ' / ' + (CFG.finishS - CFG.startS) + ' m'; }
    if (el.trick) { el.trick.textContent = String(trickScore); }
    if (el.crash) { el.crash.textContent = String(crashes); }
    if (el.cp) { el.cp.textContent = cpIndex + ' / ' + Math.floor((CFG.finishS - CFG.startS) / CFG.cpEvery); }
    if (el.surf) { el.surf.textContent = t(SURF_DEF[surfAt(body.pos.x, body.pos.z)].label); }
    if (el.progress) {
      var pct = clamp(dist / (CFG.finishS - CFG.startS), 0, 1) * 100;
      el.progress.style.width = pct.toFixed(1) + '%';
    }
  }
  var hudAcc = 0;

  /* =========================================================
   * 10. 流程控制
   * ========================================================= */
  function startRun() {
    setViewMode('ride');
    elapsed = 0; dist = 0; speed = 0; maxSpeed = 0; crashes = 0;
    airCount = 0; trickScore = 0; cpIndex = 0; totalAirTime = 0;
    trickAir = 0; wheelieScoreF = 0; wheelieBanked = 0; wheelieTime = 0; wheeliePeak = 0;
    wheelieActive = false; recordBuf = []; recordTimer = 0;
    jumpCharge = 0; driveLag = 0; lastLanding = null; lastCrashReason = '';
    placeAt(CFG.startS, 0);
    state = 'running';
    hideOverlay();
    // 窄屏：把画面滚到视口内，保证虚拟按键可见可用
    try {
      if (window.innerWidth < 860 && canvas && canvas.parentNode && canvas.parentNode.scrollIntoView) {
        canvas.parentNode.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    } catch (err) { /* 忽略滚动失败 */ }
    if (el.btnPause) { el.btnPause.textContent = t('bike.pause'); }
    updateHud(1);
  }

  function doPause() {
    if (state === 'running' || state === 'crash') {
      state = 'paused';
      showOverlay('paused');
      if (el.btnPause) { el.btnPause.textContent = t('bike.resume'); }
    } else if (state === 'paused') {
      state = 'running';
      hideOverlay();
      if (el.btnPause) { el.btnPause.textContent = t('bike.pause'); }
    }
  }

  function finishRun() {
    state = 'finish';
    sfxFinish();
    if (crashes === 0) { save('cealin_bike_nocrash', '1'); }
    checkAch();
    var isNew = (bestTime <= 0 || elapsed < bestTime);
    if (isNew) {
      bestTime = elapsed;
      save(scoreKey('best'), bestTime.toFixed(3));
      save(scoreKey('date'), stampNow());
    }
    if (trickScore > bestTrick) { bestTrick = trickScore; save(scoreKey('trick'), bestTrick); }
    showOverlay('finish');
    if (el.btnPause) { el.btnPause.textContent = t('bike.pause'); }
  }

  function checkProgress() {
    if (state !== 'running') { return; }
    var cp = Math.floor(dist / CFG.cpEvery);
    if (cp > cpIndex) {
      cpIndex = Math.min(cp, Math.floor((CFG.finishS - CFG.startS) / CFG.cpEvery));
      toast(t('bike.checkpoint') + ' ' + cpIndex);
    }
    if (dist >= CFG.finishS - CFG.startS) { finishRun(); }
  }

  /* =========================================================
   * 11. 输入（键盘 + 触屏）
   * ========================================================= */
  var keys = {};
  var ext = { throttle: 0, brake: 0, leanBack: 0, leanFwd: 0, yawLeft: 0, yawRight: 0, jump: false };

  function onKey(down) {
    return function (e) {
      var code = e.code || '';
      if (code === 'Space' || code === 'ArrowUp' || code === 'ArrowDown' ||
          code === 'ArrowLeft' || code === 'ArrowRight') {
        e.preventDefault();
      }
      if (down && code === 'KeyR') {
        if (state === 'running' || state === 'crash') { respawnAtCheckpoint(); toast(t('bike.resetDone')); }
        return;
      }
      if (down && code === 'KeyV') {
        setCamMode(camMode === 'first' ? 'third' : 'first');
        toastMsg(camMode === 'first' ? tr('bike.camFirst', '\u7b2c\u4e00\u4eba\u79f0') : tr('bike.camThird', '\u7b2c\u4e09\u4eba\u79f0'));
        return;
      }
      if (down && code === 'Escape') { doPause(); return; }
      if (down && code === 'Enter' && (state === 'ready' || state === 'finish')) { startRun(); return; }
      keys[code] = down;
      if (code === 'Space') { jumpHeld = down; }
    };
  }
  doc.addEventListener('keydown', onKey(true));
  doc.addEventListener('keyup', onKey(false));

  function bindTouch(id, name) {
    var node = byId(id);
    if (!node) { return; }
    function press(e) {
      e.preventDefault();
      if (name === 'jump') { ext.jump = true; jumpHeld = true; }
      else { ext[name] = 1; }
      node.classList.add('on');
    }
    function release(e) {
      if (e) { e.preventDefault(); }
      if (name === 'jump') { ext.jump = false; jumpHeld = false; }
      else { ext[name] = 0; }
      node.classList.remove('on');
    }
    node.addEventListener('pointerdown', press);
    node.addEventListener('pointerup', release);
    node.addEventListener('pointercancel', release);
    node.addEventListener('pointerleave', release);
  }
  bindTouch('tGas', 'throttle');
  bindTouch('tBrake', 'brake');
  bindTouch('tLeanB', 'leanBack');
  bindTouch('tLeanF', 'leanFwd');
  bindTouch('tJump', 'jump');

  function syncInput() {
    var a = keys['KeyA'] ? 1 : 0, d = keys['KeyD'] ? 1 : 0;
    var al = keys['ArrowLeft'] ? 1 : 0, ar = keys['ArrowRight'] ? 1 : 0;
    input.throttle = Math.max(keys['KeyW'] ? 1 : 0, ext.throttle);
    input.brake = Math.max(keys['KeyS'] ? 1 : 0, ext.brake);
    input.leanBack = Math.max(a, al, ext.leanBack);
    input.leanFwd = Math.max(d, ar, ext.leanFwd);
    input.yawLeft = Math.max(al, ext.yawLeft);
    input.yawRight = Math.max(ar, ext.yawRight);
    input.pitchFwd = Math.max(keys['ArrowUp'] ? 1 : 0, ext.pitchFwd || 0);
    input.pitchBack = Math.max(keys['ArrowDown'] ? 1 : 0, ext.pitchBack || 0);
    input.jump = !!(keys['Space'] || ext.jump);

    // 兔跳蓄力
    if (input.jump && grounded && (state === 'running')) {
      jumpCharge = clamp(jumpCharge + 0.028, 0, 1);
    } else if (!input.jump && jumpCharge > 0) {
      if (grounded && state === 'running') {
        var upW = T1.set(0, 1, 0).applyQuaternion(body.quat);
        body.vel.addScaledVector(upW, (3.0 + 2.8 * jumpCharge) * (JUMP_MUL || 1));
        body.ang.addScaledVector(T2.set(1, 0, 0).applyQuaternion(body.quat), -1.6 * jumpCharge);
        jumpCharge = 0;
      } else {
        jumpCharge = 0;
      }
    }
  }

  /* =========================================================
   * 12. 主循环
   * ========================================================= */
  var STEP = 1 / 120;
  var lastT = 0, acc = 0, fpsAcc = 0, fpsCnt = 0;

  function frame(now) {
    global.requestAnimationFrame(frame);
    var dt = lastT ? (now - lastT) / 1000 : 0;
    lastT = now;
    if (dt > 0.1) { dt = 0.1; }
    if (dt > 0) {
      fpsAcc += dt; fpsCnt++;
      if (fpsAcc >= 0.5) { fps = Math.round(fpsCnt / fpsAcc); fpsAcc = 0; fpsCnt = 0; }
    }

    syncInput();

    if (state === 'running' || state === 'crash') {
      acc += dt;
      if (acc > STEP * 14) { acc = STEP * 14; }
      var steps = 0;
      while (acc >= STEP && steps < 14) {
        physicsStep(STEP);
        acc -= STEP;
        steps++;
      }
      elapsed += dt;
      checkProgress();
      if (state === 'crash') {
        crashTimer += dt;
        if (crashTimer > 1.6) { respawnAtCheckpoint(); }
      }
    }

    updateVisual();
    if (viewMode === 'menu') {
      updateIdleCamera(dt);
    } else {
      if (viewMode === 'replay') { advanceReplay(dt); }
      updateCamera(dt);
    }
    stepPickups(dt);
    audioTick();
    stepDust(dt);
    syncExtras(dt);
    updateHud(dt);
    renderScene(dt);
  }

  function resize() {
    var host = canvas.parentNode;
    var w = host.clientWidth || 960;
    var h = host.clientHeight || 540;
    renderer.setSize(w, h, false);
    canvas.width = Math.floor(w * renderer.getPixelRatio());
    canvas.height = Math.floor(h * renderer.getPixelRatio());
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    resizePost(w, h);
  }
  global.addEventListener('resize', resize);

  /* =========================================================
   * 13. 初始化
   * ========================================================= */
  initWorld();
  resize();

  if (el.ovBtn) {
    el.ovBtn.addEventListener('click', function () {
      if (overlayMode === 'paused') { doPause(); }
      else { startRun(); }
    });
  }
  if (el.btnPause) {
    el.btnPause.addEventListener('click', function () { doPause(); });
  }
  var btnRestart = byId('btnRestart');
  if (btnRestart) {
    btnRestart.addEventListener('click', function () { startRun(); });
  }

  hideOverlay();
  updateHud(1);
  bootShell();
  global.requestAnimationFrame(frame);

  /* i18n 延迟就绪 / 语言切换后，重绘由 JS 写入的静态文案 */
  function rerenderLang() {
    if (state === 'ready') { hideOverlay(); }
    if (typeof refreshShellText === 'function') { refreshShellText(); }
    else if (state === 'paused') { showOverlay('paused'); }
    else if (state === 'finish') { showOverlay('finish'); }
  }
  if (global.cealinOnLangChange) { global.cealinOnLangChange(rerenderLang); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', rerenderLang);
  } else {
    setTimeout(rerenderLang, 0);
  }

  /* 调试 / 自测接口（只读状态 + 注入输入，不影响正式玩法） */
  var _diagN = new THREE.Vector3(), _diagU = new THREE.Vector3();
  global.__bike = {
    ready: true,
    snapshot: function () {
      return {
        state: state,
        time: elapsed,
        dist: dist,
        speedMs: speed,
        speedKmh: speed * 3.6,
        maxSpeedMs: maxSpeed,
        crashes: crashes,
        jumps: airCount,
        trickScore: trickScore,
        checkpoint: cpIndex,
        surface: SURF_DEF[surfAt(body.pos.x, body.pos.z)].key,
        grip: gripAt(body.pos.x, body.pos.z),
        airborne: airborne,
        groundLoad: [WHEELS[0].load, WHEELS[1].load],
        comp: [WHEELS[0].comp, WHEELS[1].comp],
        quat: [body.quat.x, body.quat.y, body.quat.z, body.quat.w],
        pos: [body.pos.x, body.pos.y, body.pos.z],
        angLen: body.ang.length(),
        finished: state === 'finish',
        best: bestTime,
        bestTrick: bestTrick,
        storageBest: store('cealin_bike_best'),
        storageTrick: store('cealin_bike_trick'),
        lastCrash: lastCrashReason,
        clear: body.pos.y - heightAt(body.pos.x, body.pos.z),
        tilt: (function () {
          normalAt(body.pos.x, body.pos.z, _diagN);
          var u = _diagU.set(0, 1, 0).applyQuaternion(body.quat);
          return Math.acos(clamp(u.dot(_diagN), -1, 1));
        })(),
        grounded: grounded,
        airTime: airTime,
        wheelSpin: [WHEELS[0].spin, WHEELS[1].spin],
        wheelie: {
          active: wheelieActive, time: wheelieTime, peak: wheeliePeak,
          peakAng: wheeliePeakAng, ang: wheelieAngle,
          score: wheelieScoreF, banked: wheelieBanked, map: curMapIdx, bike: curBikeIdx
        },
        fps: fps,
        fov: camera.fov,
        offTrack: body.pos.x - cxAt(-body.pos.z),
        render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
        trackLength: CFG.finishS - CFG.startS,
        trackSeed: CFG.seed,
        oil: oilMode,
        cam: camMode,
        parts: PARTS,
        pickupsGot: PICKUPS_GOT,
        pickupsTotal: PICKUP_LIST.length,
        upg: { engine: UPG.engine, grip: UPG.grip, susp: UPG.susp, trick: UPG.trick },
        paint: { frame: PAINT.frame, rim: PAINT.rim, helmet: PAINT.helmet, shirt: PAINT.shirt },
        mapKey: (MAPS[curMapIdx] || {}).key,
        mapCount: MAPS.length,
        custom: { length: CUSTOM_DEF.length, w1: CUSTOM_DEF.w1, w2: CUSTOM_DEF.w2, rough: CUSTOM_DEF.rough, jumpStep: CUSTOM_DEF.jumpStep, seed: CUSTOM_DEF.seed, style: CUSTOM_DEF.style }
      };
    },
    start: startRun,
    pause: doPause,
    resume: function () { if (state === 'paused') { doPause(); } },
    reset: respawnAtCheckpoint,
    setOil: setOilMode,
    setCam: setCamMode,
    addParts: function (n) { PARTS = Math.max(0, PARTS + (parseInt(n, 10) || 0)); save('cealin_bike_parts', String(PARTS)); return PARTS; },
    setPaint: function (slot, color) { setPaint(slot, color); return PAINT[slot] || ''; },
    upgrade: function (k) { buyUpg(k); return UPG[k]; },
    custom: function (o) { if (o) { for (var k in o) { if (CUSTOM_DEF.hasOwnProperty(k)) { CUSTOM_DEF[k] = o[k]; } } } return applyCustom(); },
    maps: function () { return MAPS.map(function (m) { return { key: m.key, name: m.name, style: m.style || 'trail', len: m.finishS - m.startS }; }); },
    teleport: function (s) { placeAt(clamp(s, 1, CFG.length - 2), 0); },
    setInput: function (name, v) {
      if (name === 'jump') { ext.jump = !!v; return; }
      if (name in ext) { ext[name] = v ? 1 : 0; }
    },
    crash: function () { crashNow('test'); },
    traceOn: function (v) { TRACE_ON = !!v; TRACE.length = 0; },
    traceDump: function () { var d = TRACE.slice(); TRACE.length = 0; return d; }
  };
  /* =========================================================
   * 14. 全屏游戏外壳 / 车库 / 赛道 / 回放
   * ========================================================= */

  function tr(key, fb) {
    var s = t(key);
    return (s && s !== key) ? s : fb;
  }
  function stampNow() {
    var d = new Date();
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  function hex6(v) {
    var s = (v >>> 0).toString(16);
    while (s.length < 6) { s = '0' + s; }
    return s;
  }
  function stars(n, max) {
    var s = '', i;
    for (i = 0; i < max; i++) { s += (i < n ? '\u2605' : '\u2606'); }
    return s;
  }
  function level(v, lo, hi, max) {
    return clamp(Math.round((v - lo) / Math.max(0.0001, hi - lo) * max), 1, max);
  }
  function toastMsg(txt) {
    if (!toastEl) { return; }
    toastEl.textContent = txt;
    toastEl.classList.remove('hide');
    if (toastMsg._t) { global.clearTimeout(toastMsg._t); }
    toastMsg._t = global.setTimeout(function () { toastEl.classList.add('hide'); }, 2200);
  }
  function mapScoreKey(idx, kind) {
    var k = (MAPS && MAPS[idx]) ? MAPS[idx].key : 'dusk';
    return 'cealin_bike_' + kind + '_' + k;
  }

  /* ---------------- 车型 / 赛道数据 ---------------- */
  function ensureDefs() {
    if (MAPS && BIKES) { return; }
    MAPS = [
      {
        key: 'dusk', nameKey: 'bike.mapDusk', name: '\u9ec4\u660f\u6797\u9053',
        descKey: 'bike.mapDuskDesc', tint: 0xd08a4a, diff: 1,
        seed: 20261117, length: 1060, startS: 8, cpEvery: 200, finishS: 1040, trackHalf: 6.5,
        cw1: 15, cf1: 0.0058, cw2: 6, cf2: 0.0155, slope: 0.128,
        und1: 4.6, uf1: 0.0042, und2: 1.8, uf2: 0.0158, rough: 1.0, hill: 11.0,
        surf: [0.30, 0.58, 0.78], grips: [0.52, 0.70, 0.84, 0.66],
        treeCount: 460, rockCount: 170,
        jumpStep: 88, jumpStepVar: 82, jumpLenMin: 6, jumpLenVar: 7,
        jumpHMin: 0.9, jumpHVar: 0.8, jumpGapMin: 4, jumpGapVar: 5,
        jumpDropMin: 0.8, jumpDropVar: 0.7, runMin: 22, runVar: 40,
        sky: 0xf0b274, fog: 0xe4ad80, fogNear: 70, fogFar: 400,
        sunColor: 0xffc184, sunI: 1.18, hemiI: 0.72, ambI: 0.28,
        pal: {
          dirt: [0.46, 0.35, 0.23], gravel: [0.50, 0.45, 0.39], root: [0.34, 0.26, 0.17],
          grass: [0.33, 0.42, 0.22], edgeA: [0.44, 0.33, 0.22], edgeB: [0.40, 0.32, 0.24],
          far: [0.55, 0.42, 0.36], trunk: 0x4a3524, leaf: 0x39512c, rock: 0x6f6a5f
        }
      },
      {
        key: 'rain', nameKey: 'bike.mapRain', name: '\u96e8\u540e\u6ce5\u5730',
        descKey: 'bike.mapRainDesc', tint: 0x5d7a72, diff: 2,
        seed: 20261118, length: 1240, startS: 8, cpEvery: 220, finishS: 1220, trackHalf: 7.6,
        cw1: 19, cf1: 0.0046, cw2: 7.5, cf2: 0.0182, slope: 0.112,
        und1: 5.6, uf1: 0.0038, und2: 2.4, uf2: 0.0142, rough: 1.35, hill: 8.5,
        surf: [0.14, 0.62, 0.84], grips: [0.40, 0.52, 0.60, 0.44],
        treeCount: 520, rockCount: 90,
        jumpStep: 78, jumpStepVar: 70, jumpLenMin: 5, jumpLenVar: 7,
        jumpHMin: 0.8, jumpHVar: 0.7, jumpGapMin: 3, jumpGapVar: 5,
        jumpDropMin: 0.6, jumpDropVar: 0.6, runMin: 14, runVar: 26,
        sky: 0x8e9ba2, fog: 0x9aa6ab, fogNear: 55, fogFar: 310,
        sunColor: 0xdbe7ef, sunI: 0.72, hemiI: 0.95, ambI: 0.24,
        pal: {
          dirt: [0.30, 0.26, 0.20], gravel: [0.34, 0.33, 0.31], root: [0.20, 0.17, 0.13],
          grass: [0.24, 0.33, 0.19], edgeA: [0.26, 0.27, 0.22], edgeB: [0.24, 0.26, 0.25],
          far: [0.36, 0.41, 0.42], trunk: 0x3a2f24, leaf: 0x24402c, rock: 0x5a6167
        }
      },
      {
        key: 'ridge', nameKey: 'bike.mapRidge', name: '\u5ca9\u77f3\u5c71\u810a',
        descKey: 'bike.mapRidgeDesc', tint: 0xb79a72, diff: 3,
        seed: 20261119, length: 880, startS: 8, cpEvery: 170, finishS: 860, trackHalf: 5.6,
        cw1: 22, cf1: 0.0062, cw2: 9, cf2: 0.0212, slope: 0.205,
        und1: 6.4, uf1: 0.0052, und2: 2.8, uf2: 0.0196, rough: 0.7, hill: 14.0,
        surf: [0.46, 0.60, 0.78], grips: [0.62, 0.78, 0.90, 0.58],
        treeCount: 240, rockCount: 320,
        jumpStep: 95, jumpStepVar: 90, jumpLenMin: 6, jumpLenVar: 6,
        jumpHMin: 1.3, jumpHVar: 1.0, jumpGapMin: 6, jumpGapVar: 6,
        jumpDropMin: 1.1, jumpDropVar: 0.9, runMin: 26, runVar: 44,
        sky: 0xd9c3a4, fog: 0xcdb99d, fogNear: 90, fogFar: 470,
        sunColor: 0xfff0d2, sunI: 1.30, hemiI: 0.86, ambI: 0.24,
        pal: {
          dirt: [0.50, 0.44, 0.34], gravel: [0.55, 0.52, 0.47], root: [0.38, 0.31, 0.24],
          grass: [0.40, 0.42, 0.26], edgeA: [0.47, 0.42, 0.33], edgeB: [0.45, 0.41, 0.35],
          far: [0.58, 0.54, 0.51], trunk: 0x4a3c2c, leaf: 0x3d4a2c, rock: 0x7d766a
        }
      },
      {
        key: 'indoor', nameKey: 'bike.mapIndoor', name: '\u5ba4\u5185 BMX \u573a',
        descKey: 'bike.mapIndoorDesc', tint: 0x8f6a3e, diff: 1, style: 'indoor',
        seed: 20261120, length: 480, startS: 10, cpEvery: 150, finishS: 460, trackHalf: 7.0,
        cw1: 5.0, cf1: 0.0060, cw2: 2.4, cf2: 0.0130, slope: 0.004,
        und1: 0.0, uf1: 0.0042, und2: 0.0, uf2: 0.0158, rough: 0.05, hill: 0.0,
        surf: [0.42, 0.62, 0.80], grips: [0.90, 0.86, 0.92, 0.74],
        treeCount: 0, rockCount: 0,
        jumpStep: 42, jumpStepVar: 14, jumpLenMin: 4.5, jumpLenVar: 2.0,
        jumpHMin: 0.55, jumpHVar: 0.35, jumpGapMin: 3.0, jumpGapVar: 1.5,
        jumpDropMin: 0.30, jumpDropVar: 0.20, jumpStart: 60, runMin: 16, runVar: 22,
        sky: 0x1b1c22, fog: 0x22232b, fogNear: 55, fogFar: 250,
        sunColor: 0xfff0d8, sunI: 0.42, hemiI: 1.18, ambI: 0.55,
        pal: {
          dirt: [0.44, 0.32, 0.20], gravel: [0.42, 0.42, 0.45], root: [0.30, 0.22, 0.14],
          grass: [0.22, 0.30, 0.42], edgeA: [0.34, 0.30, 0.26], edgeB: [0.26, 0.27, 0.30],
          far: [0.17, 0.18, 0.21], trunk: 0x3a2a1c, leaf: 0x2a3a2c, rock: 0x54565c
        }
      },
      {
        key: 'bmxtrack', nameKey: 'bike.mapBmxOut', name: '\u5ba4\u5916\u571f\u5730\u573a',
        descKey: 'bike.mapBmxOutDesc', tint: 0xb08c5a, diff: 1, style: 'outdoor',
        seed: 20261121, length: 560, startS: 10, cpEvery: 170, finishS: 540, trackHalf: 7.6,
        cw1: 11, cf1: 0.0080, cw2: 4.2, cf2: 0.0160, slope: 0.020,
        und1: 0.0, uf1: 0.0042, und2: 0.0, uf2: 0.0158, rough: 0.15, hill: 0.0,
        surf: [0.34, 0.60, 0.80], grips: [0.56, 0.68, 0.74, 0.62],
        treeCount: 0, rockCount: 24,
        jumpStep: 58, jumpStepVar: 26, jumpLenMin: 5, jumpLenVar: 3,
        jumpHMin: 0.95, jumpHVar: 0.55, jumpGapMin: 4, jumpGapVar: 2.4,
        jumpDropMin: 0.50, jumpDropVar: 0.35, jumpStart: 70, runMin: 20, runVar: 26,
        sky: 0x9ec6e6, fog: 0xbfd8e8, fogNear: 95, fogFar: 440,
        sunColor: 0xfff4dc, sunI: 1.30, hemiI: 0.95, ambI: 0.30,
        pal: {
          dirt: [0.50, 0.38, 0.24], gravel: [0.46, 0.40, 0.30], root: [0.38, 0.28, 0.18],
          grass: [0.36, 0.45, 0.24], edgeA: [0.46, 0.36, 0.23], edgeB: [0.40, 0.38, 0.28],
          far: [0.52, 0.50, 0.34], trunk: 0x53402a, leaf: 0x3d5a2f, rock: 0x7b7568
        }
      },
      {
        key: 'stairs', nameKey: 'bike.mapStairs', name: '\u697c\u68af\u63a5\u843d',
        descKey: 'bike.mapStairsDesc', tint: 0x9a9490, diff: 3, style: 'stair',
        stepped: true,
        seed: 20261122, length: 520, startS: 10, cpEvery: 170, finishS: 500, trackHalf: 6.0,
        cw1: 7, cf1: 0.0055, cw2: 3.0, cf2: 0.0120, slope: 0.030,
        und1: 0.0, uf1: 0.0042, und2: 0.0, uf2: 0.0158, rough: 0.12, hill: 0.0,
        surf: [0.40, 0.66, 0.82], grips: [0.84, 0.82, 0.88, 0.64],
        treeCount: 0, rockCount: 0,
        jumpStep: 200, jumpStepVar: 30, jumpLenMin: 7, jumpLenVar: 3,
        jumpHMin: 1.40, jumpHVar: 0.60, jumpGapMin: 7, jumpGapVar: 3,
        jumpDropMin: 0.90, jumpDropVar: 0.40, jumpStart: 70, runMin: 20, runVar: 20,
        stairs: [
          { s0: 186, step: 2.2, count: 26, rise: 0.24 },
          { s0: 302, step: 2.0, count: 30, rise: 0.22 },
          { s0: 424, step: 2.0, count: 26, rise: 0.20 }
        ],
        sky: 0xb9b3aa, fog: 0xc2bcb2, fogNear: 75, fogFar: 340,
        sunColor: 0xfff0d4, sunI: 1.05, hemiI: 0.88, ambI: 0.34,
        pal: {
          dirt: [0.54, 0.52, 0.49], gravel: [0.46, 0.45, 0.44], root: [0.38, 0.37, 0.36],
          grass: [0.42, 0.44, 0.40], edgeA: [0.50, 0.49, 0.47], edgeB: [0.38, 0.38, 0.39],
          far: [0.56, 0.56, 0.57], trunk: 0x5a4a3a, leaf: 0x4a5a44, rock: 0x8a8880
        }
      },
      {
        key: 'citydh', nameKey: 'bike.mapCity', name: '\u57ce\u5e02\u901f\u964d',
        descKey: 'bike.mapCityDesc', tint: 0x4b5a70, diff: 3, style: 'urban',
        seed: 20261123, length: 1120, startS: 10, cpEvery: 220, finishS: 1100, trackHalf: 8.0,
        cw1: 14, cf1: 0.0044, cw2: 5, cf2: 0.0170, slope: 0.118,
        und1: 2.4, uf1: 0.0038, und2: 0.8, uf2: 0.0150, rough: 0.10, hill: 0.0,
        surf: [0.44, 0.64, 0.82], grips: [0.86, 0.82, 0.90, 0.66],
        treeCount: 0, rockCount: 0,
        jumpStep: 132, jumpStepVar: 48, jumpLenMin: 8, jumpLenVar: 4,
        jumpHMin: 1.10, jumpHVar: 0.65, jumpGapMin: 11, jumpGapVar: 5,
        jumpDropMin: 0.60, jumpDropVar: 0.40, jumpStart: 120, runMin: 24, runVar: 26,
        sky: 0x2b3550, fog: 0x3a4762, fogNear: 60, fogFar: 340,
        sunColor: 0xbfd0ff, sunI: 0.55, hemiI: 0.80, ambI: 0.46,
        pal: {
          dirt: [0.27, 0.29, 0.33], gravel: [0.31, 0.32, 0.35], root: [0.22, 0.23, 0.26],
          grass: [0.22, 0.28, 0.26], edgeA: [0.28, 0.29, 0.32], edgeB: [0.24, 0.25, 0.28],
          far: [0.18, 0.20, 0.26], trunk: 0x3a3e44, leaf: 0x2b3434, rock: 0x5a5e66
        }
      },
      {
        key: 'night', nameKey: 'bike.mapNight', name: '\u6697\u591c\u5c71\u810a',
        descKey: 'bike.mapNightDesc', tint: 0x2a3550, diff: 3,
        seed: 20261124, length: 1140, startS: 8, cpEvery: 200, finishS: 1120, trackHalf: 6.0,
        cw1: 17, cf1: 0.0054, cw2: 6.4, cf2: 0.0166, slope: 0.132,
        und1: 4.2, uf1: 0.0044, und2: 1.6, uf2: 0.0164, rough: 1.15, hill: 12.0,
        surf: [0.26, 0.54, 0.74], grips: [0.46, 0.64, 0.80, 0.60],
        treeCount: 520, rockCount: 210,
        jumpStep: 80, jumpStepVar: 70, jumpLenMin: 6, jumpLenVar: 7,
        jumpHMin: 1.0, jumpHVar: 0.9, jumpGapMin: 4, jumpGapVar: 5,
        jumpDropMin: 0.9, jumpDropVar: 0.8, runMin: 20, runVar: 36,
        sky: 0x121a2c, fog: 0x16203a, fogNear: 34, fogFar: 220,
        sunColor: 0x9ab4e0, sunI: 0.42, hemiI: 0.30, ambI: 0.16,
        pal: {
          dirt: [0.20, 0.22, 0.26], gravel: [0.24, 0.26, 0.30], root: [0.16, 0.17, 0.20],
          grass: [0.16, 0.22, 0.20], edgeA: [0.20, 0.22, 0.26], edgeB: [0.17, 0.19, 0.23],
          far: [0.13, 0.16, 0.23], trunk: 0x24272e, leaf: 0x1d2b26, rock: 0x424855
        }
      },
      {
        key: 'desert', nameKey: 'bike.mapDesert', name: '\u6c99\u6f20\u8680\u8c37',
        descKey: 'bike.mapDesertDesc', tint: 0xd9a24e, diff: 2,
        seed: 20261125, length: 1180, startS: 8, cpEvery: 210, finishS: 1160, trackHalf: 8.2,
        cw1: 20, cf1: 0.0042, cw2: 8.0, cf2: 0.0158, slope: 0.118,
        und1: 6.4, uf1: 0.0034, und2: 2.6, uf2: 0.0136, rough: 1.25, hill: 9.0,
        surf: [0.22, 0.40, 0.62], grips: [0.42, 0.54, 0.70, 0.52],
        treeCount: 90, rockCount: 260,
        jumpStep: 74, jumpStepVar: 64, jumpLenMin: 7, jumpLenVar: 8,
        jumpHMin: 1.1, jumpHVar: 1.0, jumpGapMin: 5, jumpGapVar: 6,
        jumpDropMin: 0.9, jumpDropVar: 0.9, runMin: 26, runVar: 44,
        sky: 0xf3d7a4, fog: 0xe6c793, fogNear: 110, fogFar: 520,
        sunColor: 0xffe0a8, sunI: 1.35, hemiI: 0.66, ambI: 0.30,
        pal: {
          dirt: [0.62, 0.48, 0.30], gravel: [0.66, 0.55, 0.38], root: [0.48, 0.36, 0.22],
          grass: [0.55, 0.50, 0.32], edgeA: [0.66, 0.52, 0.33], edgeB: [0.60, 0.47, 0.29],
          far: [0.76, 0.64, 0.46], trunk: 0x7a5c3a, leaf: 0x5c7a4a, rock: 0xb07d4a
        }
      },
      {
        key: 'snow', nameKey: 'bike.mapSnow', name: '\u96ea\u7ebf\u901f\u964d',
        descKey: 'bike.mapSnowDesc', tint: 0xcfe0ec, diff: 3,
        seed: 20261126, length: 1080, startS: 8, cpEvery: 190, finishS: 1060, trackHalf: 7.0,
        cw1: 21, cf1: 0.0040, cw2: 8.4, cf2: 0.0170, slope: 0.122,
        und1: 5.2, uf1: 0.0038, und2: 2.0, uf2: 0.0150, rough: 0.85, hill: 10.5,
        surf: [0.20, 0.46, 0.72], grips: [0.34, 0.50, 0.66, 0.44],
        treeCount: 340, rockCount: 120,
        jumpStep: 92, jumpStepVar: 86, jumpLenMin: 8, jumpLenVar: 9,
        jumpHMin: 1.0, jumpHVar: 0.85, jumpGapMin: 6, jumpGapVar: 6,
        jumpDropMin: 0.8, jumpDropVar: 0.7, runMin: 28, runVar: 46,
        sky: 0xdfeaf4, fog: 0xd2e2ee, fogNear: 46, fogFar: 300,
        sunColor: 0xeaf4ff, sunI: 1.05, hemiI: 0.92, ambI: 0.34,
        pal: {
          dirt: [0.72, 0.78, 0.84], gravel: [0.68, 0.74, 0.80], root: [0.40, 0.40, 0.44],
          grass: [0.62, 0.70, 0.72], edgeA: [0.78, 0.84, 0.90], edgeB: [0.70, 0.78, 0.85],
          far: [0.86, 0.91, 0.96], trunk: 0x3a4a44, leaf: 0x2f4a3a, rock: 0x8a97a4
        }
      },
      {
        key: 'factory', nameKey: 'bike.mapFactory', name: '\u5e9f\u5f03\u5de5\u5382',
        descKey: 'bike.mapFactoryDesc', tint: 0x7a7166, diff: 2,
        seed: 20261127, length: 980, startS: 8, cpEvery: 180, finishS: 960, trackHalf: 6.8,
        cw1: 16, cf1: 0.0050, cw2: 6.0, cf2: 0.0160, slope: 0.108,
        und1: 3.0, uf1: 0.0040, und2: 1.2, uf2: 0.0140, rough: 0.45, hill: 6.0,
        surf: [0.36, 0.62, 0.80], grips: [0.58, 0.74, 0.86, 0.62],
        treeCount: 40, rockCount: 60,
        jumpStep: 62, jumpStepVar: 52, jumpLenMin: 5, jumpLenVar: 6,
        jumpHMin: 0.9, jumpHVar: 0.8, jumpGapMin: 4, jumpGapVar: 4,
        jumpDropMin: 1.1, jumpDropVar: 0.9, runMin: 18, runVar: 30,
        sky: 0x9aa3a8, fog: 0x9099a0, fogNear: 60, fogFar: 340,
        sunColor: 0xd8d2c4, sunI: 0.95, hemiI: 0.72, ambI: 0.30,
        pal: {
          dirt: [0.42, 0.41, 0.39], gravel: [0.52, 0.51, 0.48], root: [0.30, 0.29, 0.28],
          grass: [0.38, 0.42, 0.34], edgeA: [0.46, 0.44, 0.41], edgeB: [0.40, 0.39, 0.37],
          far: [0.58, 0.58, 0.56], trunk: 0x4a4640, leaf: 0x3c4a3c, rock: 0x6e6a63
        }
      }

    ];
    BIKES = [
      {
        key: 'dirt', nameKey: 'bike.bikeDirt', name: '\u6ce5\u5df4\u4f6c Dirt', tagKey: 'bike.tagAllRound', tag: '\u5168\u80fd',
        mass: 88, engine: 660, grip: 1.00, jump: 1.00, rad: 0.34,
        frame: 0x3b7fa6, rim: 0xc8a96e, helmet: 0xe8c07a, shirt: 0xa44a36
      },
      {
        key: 'enduro', nameKey: 'bike.bikeEnduro', name: '\u6797\u9053\u5ba2 Enduro', tagKey: 'bike.tagTrail', tag: '\u6797\u9053',
        mass: 95, engine: 705, grip: 1.08, jump: 0.92, rad: 0.345,
        frame: 0x4f7a3c, rim: 0xb9c26b, helmet: 0xd8e08a, shirt: 0x2f5b4a
      },
      {
        key: 'dh', nameKey: 'bike.bikeDh', name: '\u901f\u964d\u731b\u517d DH', tagKey: 'bike.tagSpeed', tag: '\u901f\u964d',
        mass: 106, engine: 785, grip: 0.96, jump: 0.86, rad: 0.365,
        frame: 0xb4462f, rim: 0xe8c07a, helmet: 0xffd27a, shirt: 0x8c2a20
      },
      {
        key: 'bmx', nameKey: 'bike.bikeBmx', name: '\u8857\u5f0f\u5c0f\u94a2\u70ae BMX', tagKey: 'bike.tagStreet', tag: '\u8857\u5f0f',
        mass: 74, engine: 625, grip: 1.14, jump: 1.20, rad: 0.305,
        frame: 0xd9a72b, rim: 0xf2f2f2, helmet: 0xf7f7f7, shirt: 0x34495e
      }
    ];
  }

  /* ---------------- 全屏 ---------------- */
  function fsEl() {
    return doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement || null;
  }
  function requestFs() {
    var e = doc.documentElement;
    var fn = e.requestFullscreen || e.webkitRequestFullscreen || e.msRequestFullscreen;
    if (!fn) { return; }
    try {
      var r = fn.call(e);
      if (r && typeof r.then === 'function') { r.then(null, function () {}); }
    } catch (err) { /* 无手势时静默降级 */ }
  }
  function exitFs() {
    if (!fsEl()) { return; }
    var fn = doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
    if (!fn) { return; }
    try {
      var r = fn.call(doc);
      if (r && typeof r.then === 'function') { r.then(null, function () {}); }
    } catch (err) {}
  }
  function syncFsIcon() {
    if (btnFullEl) { btnFullEl.classList.toggle('on', !!fsEl()); }
  }
  function toggleFs() {
    if (fsEl()) { exitFs(); } else { requestFs(); }
    syncFsIcon();
  }

  /* ---------------- 世界重建 ---------------- */
  function dropMesh(obj) {
    if (!obj) { return; }
    scene.remove(obj);
    if (obj.geometry) { obj.geometry.dispose(); }
    if (obj.material) {
      if (obj.material.map) { obj.material.map.dispose(); }
      obj.material.dispose();
    }
  }
  function clearWorld() {
    if (propsGroup) {
      scene.remove(propsGroup);
      propsGroup.traverse(function (o) {
        if (o.geometry) { o.geometry.dispose(); }
        if (o.material) {
          if (o.material.map) { o.material.map.dispose(); }
          o.material.dispose();
        }
      });
      propsGroup = null;
    }
    dropMesh(terrainMesh); terrainMesh = null;
    dropMesh(treesTrunk); treesTrunk = null;
    dropMesh(treesLeaf); treesLeaf = null;
    dropMesh(rocksMesh); rocksMesh = null;
    dropMesh(gateGroup); gateGroup = null;
    clearPickups();
  }

  function applyMap(idx, keepBike) {
    ensureDefs();
    curMapIdx = clamp(idx, 0, MAPS.length - 1);
    var mp = MAPS[curMapIdx];
    MP = mp;
    PAL = mp.pal;
    CFG.seed = mp.seed;
    CFG.length = mp.length;
    CFG.startS = mp.startS;
    CFG.cpEvery = mp.cpEvery;
    CFG.finishS = mp.finishS;
    CFG.trackHalf = mp.trackHalf;
    if (scene.background && scene.background.setHex) { scene.background.setHex(mp.sky); }
    if (scene.fog) {
      scene.fog.color.setHex(mp.fog);
      scene.fog.near = mp.fogNear;
      scene.fog.far = mp.fogFar;
    }
    if (sun) { sun.color.setHex(mp.sunColor); sun.intensity = mp.sunI; }
    // 每张地图的路面抓地系数（赛道手感差异：泥地更滑、岩石山脊更咬地）
    if (mp.grips) {
      for (var gi = 0; gi < SURF_DEF.length && gi < mp.grips.length; gi++) {
        SURF_DEF[gi].grip = mp.grips[gi];
      }
    }
    if (hemi) { hemi.intensity = mp.hemiI; }
    if (amb) { amb.intensity = mp.ambI; }
    state = 'ready';
    clearWorld();
    buildTrack();
    buildTerrain();
    buildProps();
    buildGates();
    if (!keepBike) { placeAt(CFG.startS, 0); }
    camLook.copy(body.pos);
    buildPickups();
    loadBest();
    updateHud(1);
  }

  function applyBike(idx) {
    ensureDefs();
    curBikeIdx = clamp(idx, 0, BIKES.length - 1);
    var b = BIKES[curBikeIdx];
    save('cealin_bike_ride', b.key);
    ENGINE = b.engine;
    GRIP_MUL = b.grip;
    JUMP_MUL = b.jump;
    applyUpgrades();
    if (BIKE_MATS) {
      BIKE_MATS.frame.color.setHex(b.frame);
      BIKE_MATS.rim.color.setHex(b.rim);
      BIKE_MATS.helmet.color.setHex(b.helmet);
    }
    var sr = b.rad / 0.34;
    if (rearWheelRoot) { rearWheelRoot.scale.set(sr, sr, sr); }
    if (frontWheelRoot) { frontWheelRoot.scale.set(sr, sr, sr); }
    if (WHEELS && WHEELS.length > 1) {
      WHEELS[0].rad = b.rad; WHEELS[1].rad = b.rad;
      WHEELS[0].minLen = b.rad; WHEELS[1].minLen = b.rad;
      WHEELS[0].maxLen = b.rad + 0.26; WHEELS[1].maxLen = b.rad + 0.26;
    }
    applyPaint();
    applyGearLight();
  }

  function initWorld() {
    ensureDefs();
    loadPaint();
    loadUpg();
    loadCustom();
    SND_ON = store('cealin_bike_sound') !== '0';
    oilMode = (store('cealin_bike_oil') === 'real') ? 'real' : 'oil';
    camMode = (store('cealin_bike_cam') === 'first') ? 'first' : 'third';
    if (store('cealin_bike_custom')) { syncCustomMap(); }
    var bi = -1, mi = -1, i;
    var bk = store('cealin_bike_ride');
    var mk = store('cealin_bike_map');
    for (i = 0; i < BIKES.length; i++) { if (BIKES[i].key === bk) { bi = i; } }
    if (bk !== null && bk !== '' && isFinite(parseFloat(bk))) { bi = clamp(parseInt(bk, 10), 0, BIKES.length - 1); }
    if (bi < 0) { bi = 0; }
    if (mk !== null && mk !== '' && isFinite(parseFloat(mk))) { mi = clamp(parseInt(mk, 10), 0, MAPS.length - 1); }
    if (mi < 0) { mi = 0; }
    curBikeIdx = bi;
    applyMap(mi, true);
    buildBikeModel();
    loadGear();
    applyBike(bi);
    placeAt(CFG.startS, 0);
    camLook.copy(body.pos);
    rerenderPanelsSafe();
  }

  /* ---------------- 视图模式 ---------------- */
  function clearInputs() {
    input.throttle = 0; input.brake = 0; input.leanBack = 0; input.leanFwd = 0;
    input.yawLeft = 0; input.yawRight = 0; input.jump = false;
    jumpCharge = 0; jumpHeld = false;
    var ids = ['tGas', 'tBrake', 'tLeanB', 'tLeanF', 'tJump'], i, e2;
    for (i = 0; i < ids.length; i++) {
      e2 = byId(ids[i]);
      if (e2) { e2.classList.remove('on'); }
    }
  }

  function setViewMode(mode) {
    viewMode = mode;
    if (shellEl) { shellEl.setAttribute('data-mode', mode); }
    if (mode !== 'menu') {
      if (menuLayerEl) { menuLayerEl.classList.add('hide'); }
      closePanel();
    } else {
      if (menuLayerEl) { menuLayerEl.classList.remove('hide'); }
    }
    if (mode === 'ride' || mode === 'replay') {
      clearInputs();
      camPos.copy(camera.position);
    }
    if (mode !== 'ride' && wheelieHudEl) { wheelieHudEl.classList.add('hide'); }
  }

  function backToMenu() {
    state = 'ready';
    overlayMode = 'ready';
    hideOverlay();
    setViewMode('menu');
    clearInputs();
    placeAt(CFG.startS, 0);
    idleT = 0;
    updateHud(1);
    refreshShellText();
  }

  function beginRide() {
    if (!fsEl() && !deviceTouch) { requestFs(); }
    setViewMode('ride');
    overlayMode = 'ready';
    startRun();
    refreshShellText();
  }

  /* ---------------- 面板 ---------------- */
  function markSideMenu(act) {
    if (!sideMenuEl) { return; }
    var btns = sideMenuEl.getElementsByClassName('menu-btn'), i;
    for (i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute('data-act') === act) { btns[i].classList.add('current'); }
      else { btns[i].classList.remove('current'); }
    }
  }

  function openPanel(name) {
    if (!panelLayerEl) { return; }
    panelOpen = name;
    markSideMenu(name);
    if (panelLayerEl) { panelLayerEl.classList.remove('hide'); }
    if (name === 'garage') { renderGarage(); }
    else if (name === 'track') { renderTrack(); }
    else if (name === 'board') { renderBoard(); }
    else if (name === 'help') { renderHelp(); }
    else if (name === 'settings') { renderSettings(); }
  }

  function closePanel() {
    if (panelLayerEl) { panelLayerEl.classList.add('hide'); }
    if (panelOpen) { markSideMenu(''); }
    panelOpen = '';
  }

  function rerenderPanelsSafe() {
    if (!panelOpen) { return; }
    openPanel(panelOpen);
  }

  function renderGarage() {
    if (!panelBodyEl) { return; }
    if (panelTitleEl) { panelTitleEl.textContent = tr('bike.menuGarage', '\u6211\u7684\u8f66\u5e93'); }
    ensureGear();
    var html = '<p class="panel-note">' + tr('bike.garageNote',
      '\u8f66\u578b\u5f71\u54cd\u91cd\u91cf\u4e0e\u624b\u611f\uff1b\u80cc\u5305\u3001\u5934\u76d4\u3001\u773c\u955c\u4e3a\u5916\u89c2\u88c5\u5907\uff0c\u968f\u65f6\u53ef\u6362\u3002') + '</p>';
    html += '<h3 class="gear-title">' + tr('bike.gearBike', '\u81ea\u884c\u8f66') + '</h3>';
    html += '<div class="skin-grid">';
    for (var i = 0; i < BIKES.length; i++) {
      var b = BIKES[i];
      html += '<button type="button" class="skin-card' + (i === curBikeIdx ? ' on' : '') +
        '" data-bike="' + i + '">' +
        '<i class="skin-dot" style="background:#' + hex6(b.frame) + '"></i>' +
        '<span class="sc-body"><b>' + tr(b.nameKey, b.name) + '</b>' +
        '<em>' + tr('bike.specMass', '\u8f66\u91cd') + ' ' + b.mass + 'kg\u00b7' +
        tr('bike.specGrip', '\u6293\u5730') + ' ' + stars(level(b.grip, 0.85, 1.2, 5), 5) + '</em>' +
        '<em>' + tr('bike.specAcc', '\u52a0\u901f') + ' ' + stars(level(b.engine, 600, 800, 5), 5) +
        '\u00b7' + tr('bike.specJump', '\u5f39\u8df3') + ' ' + stars(level(b.jump, 0.8, 1.3, 5), 5) + '</em></span>' +
        '<i class="tag">' + tr(b.tagKey, b.tag) + '</i></button>';
    }
    html += '</div>';

    var groups = [
      { g: 'bag', titleKey: 'bike.gearBag', title: '\u80cc\u5305', dot: 'color', noteKey: 'bike.gearBagNote', note: '\u80cc\u5305\u4e0d\u5f71\u54cd\u624b\u611f\uff0c\u53ea\u6539\u53d8\u8eab\u540e\u8f6e\u5ed3\u3002' },
      { g: 'helmet', titleKey: 'bike.gearHelmet', title: '\u5934\u76d4', dot: 'color', noteKey: 'bike.gearHelmetNote', note: '\u5934\u76d4\u4e3a\u5916\u89c2\u4ef6\uff0c\u4e0d\u5f71\u54cd\u6454\u8f66\u5224\u5b9a\u3002' },
      { g: 'glasses', titleKey: 'bike.gearGlass', title: '\u773c\u955c', dot: 'lens', noteKey: 'bike.gearGlassNote', note: '\u773c\u955c\u4e3a\u5916\u89c2\u4ef6\uff0c\u53ef\u914d\u5408\u4efb\u610f\u5934\u76d4\u3002' }
    ];
    for (var gi = 0; gi < groups.length; gi++) {
      var gp = groups[gi], arr = GEAR[gp.g];
      html += '<h3 class="gear-title">' + tr(gp.titleKey, gp.title) + '</h3>';
      html += '<p class="panel-note">' + tr(gp.noteKey, gp.note) + '</p>';
      html += '<div class="skin-grid">';
      for (var si = 0; si < arr.length; si++) {
        var it = arr[si];
        var dotColor = (gp.dot === 'lens') ? it.lens : it.color;
        html += '<button type="button" class="skin-card' + (si === curGear[gp.g] ? ' on' : '') +
          '" data-gear="' + gp.g + ':' + si + '">' +
          '<i class="skin-dot" style="background:#' + hex6(dotColor) + '"></i>' +
          '<span class="sc-body"><b>' + tr(it.nameKey, it.name) + '</b>' +
          '<em>' + tr('bike.gearLook', '\u5916\u89c2') + ' \u00b7 ' + tr(it.tagKey, it.tag) + '</em></span>' +
          (si === curGear[gp.g] ? '<i class="tag">' + tr('bike.gearOn', '\u5df2\u9009') + '</i>' : '') +
          '</button>';
      }
      html += '</div>';
    }
    /* 涂装自定义 */
    html += '<h3 class="gear-title">' + tr('bike.paintTitle', '\u6d82\u88c5') + '</h3>';
    html += '<p class="panel-note">' + tr('bike.paintNote', '\u81ea\u5b9a\u4e49\u8f66\u67b6\u3001\u8f6e\u5708\u3001\u5934\u76d4\u4e0e\u9a91\u884c\u670d\u989c\u8272\uff0c\u65e0\u9700\u96f6\u4ef6\u3002') + '</p>';
    for (var pi = 0; pi < PAINT_SLOT.length; pi++) {
      var ps = PAINT_SLOT[pi];
      var cur = PAINT[ps.k];
      html += '<div class="paint-row"><span class="paint-label">' + tr(ps.nameKey, ps.name) +
        (cur ? '<i class="paint-cur" style="background:' + cur + '"></i>' : '') + '</span><div class="paint-swatches">';
      for (var si2 = 0; si2 < PAINT_SWATCH.length; si2++) {
        var sc = PAINT_SWATCH[si2];
        html += '<button type="button" class="paint-dot' + (cur === sc ? ' on' : '') + '" style="background:' + sc +
          '" data-paint="' + ps.k + ':' + sc + '"></button>';
      }
      html += '<button type="button" class="paint-dot reset" data-paint="' + ps.k + ':" title="' +
        tr('bike.paintReset', '\u6062\u590d\u539f\u8272') + '">x</button>';
      html += '</div></div>';
    }

    /* 性能改装 */
    html += '<h3 class="gear-title">' + tr('bike.upgTitle', '\u6539\u88c5') + '</h3>';
    html += '<p class="panel-note">' + tr('bike.upgParts', '\u96f6\u4ef6\u5e93\u5b58') + '\uff1a<b>' + PARTS +
      '</b>\uff08' + tr('bike.upgCostNote', '\u6bcf\u7ea7\u6d88\u8017') + ' ' + UPG_COST + '\uff09</p>';
    html += '<div class="skin-grid">';
    for (var ui = 0; ui < UPG_DEF.length; ui++) {
      var ud = UPG_DEF[ui], lv = UPG[ud.k] || 0;
      html += '<button type="button" class="skin-card upg-card' + (lv >= UPG_MAX ? ' on' : '') +
        '" data-upg="' + ud.k + '">' +
        '<span class="sc-body"><b>' + tr(ud.nameKey, ud.name) + '</b>' +
        '<em>' + stars(lv, UPG_MAX) + '</em>' +
        '<em>' + tr(ud.noteKey, ud.note) + '</em></span>' +
        '<i class="tag">' + (lv >= UPG_MAX ? tr('bike.upgFull', '\u5df2\u6ee1\u7ea7') : '+' + UPG_COST) + '</i></button>';
    }
    html += '</div>';
    panelBodyEl.innerHTML = html;
  }

  /* =========================================================
   * 13. 成就与收集进度
   * ========================================================= */
  function achState() {
    var raw = store('cealin_bike_ach'), arr = [];
    if (raw) { try { arr = JSON.parse(raw) || []; } catch (e) { arr = []; } }
    return arr;
  }
  function achHas(k) {
    var a = achState();
    for (var i = 0; i < a.length; i++) { if (a[i] === k) { return true; } }
    return false;
  }
  function achGive(k, label) {
    if (achHas(k)) { return false; }
    var a = achState();
    a.push(k);
    save('cealin_bike_ach', JSON.stringify(a));
    toastMsg(tr('bike.achGot', '\u6210\u5c31\u8fbe\u6210') + '  ' + label);
    blip(1180, 0.13, 'triangle', 0.06);
    return true;
  }
  function clearedCount() {
    var n = 0;
    for (var i = 0; i < MAPS.length; i++) {
      if ((parseFloat(store('cealin_bike_best_' + MAPS[i].key)) || 0) > 0) { n += 1; }
    }
    return n;
  }
  function partsProgress() {
    var got = 0, all = 0;
    for (var i = 0; i < MAPS.length; i++) {
      got += parseInt(store('cealin_bike_picks_' + MAPS[i].key), 10) || 0;
      all += parseInt(store('cealin_bike_picktotal_' + MAPS[i].key), 10) || 0;
    }
    return { got: got, all: all };
  }
  function collectAnyDone() {
    for (var i = 0; i < MAPS.length; i++) {
      var a = parseInt(store('cealin_bike_picks_' + MAPS[i].key), 10) || 0;
      var b = parseInt(store('cealin_bike_picktotal_' + MAPS[i].key), 10) || 0;
      if (b > 0 && a >= b) { return true; }
    }
    return false;
  }
  function achDefs() {
    var out = [];
    var cl = clearedCount();
    out.push({ key: 'clear1', name: tr('bike.achClear1', '\u9996\u6b21\u901a\u5173'), done: cl >= 1 });
    out.push({ key: 'clear5', name: tr('bike.achClear5', '\u901a\u5173 5 \u6761\u8d5b\u9053'), done: cl >= 5 });
    out.push({ key: 'clearAll', name: tr('bike.achClearAll', '\u901a\u5173\u5168\u90e8\u8d5b\u9053'), done: MAPS && cl >= MAPS.length });
    out.push({ key: 'parts10', name: tr('bike.achParts10', '\u6536\u96c6 10 \u4e2a\u96f6\u4ef6'), done: (PARTS || 0) >= 10 });
    out.push({ key: 'parts50', name: tr('bike.achParts50', '\u6536\u96c6 50 \u4e2a\u96f6\u4ef6'), done: (PARTS || 0) >= 50 });
    out.push({ key: 'air3', name: tr('bike.achAir3', '\u6ede\u7a7a 3 \u79d2\u4ee5\u4e0a'), done: (parseFloat(store('cealin_bike_best_air')) || 0) >= 3 });
    out.push({ key: 'trick1000', name: tr('bike.achTrick', '\u6280\u5de7\u5206\u7834\u5343'), done: (bestTrick || 0) >= 1000 });
    out.push({ key: 'collectMap', name: tr('bike.achCollect', '\u5355\u8d5b\u9053\u96f6\u4ef6\u5168\u6536'), done: collectAnyDone() });
    out.push({ key: 'nocrash', name: tr('bike.achNoCrash', '\u96f6\u5931\u8bef\u901a\u5173'), done: store('cealin_bike_nocrash') === '1' });
    out.push({ key: 'upgFull', name: tr('bike.achUpg', '\u6539\u88c5\u5168\u6ee1'),
      done: (UPG.engine >= UPG_MAX && UPG.grip >= UPG_MAX && UPG.susp >= UPG_MAX && UPG.trick >= UPG_MAX) });
    return out;
  }
  function achCount() {
    var d = achDefs(), n = 0;
    for (var i = 0; i < d.length; i++) { if (achHas(d[i].key)) { n += 1; } }
    return { got: n, all: d.length };
  }
  function checkAch() {
    var d = achDefs();
    for (var i = 0; i < d.length; i++) {
      if (d[i].done) { achGive(d[i].key, d[i].name); }
    }
  }

  /* =========================================================
   * 12. 音效 / 粒子（全部程序化生成，无外部资源）
   * ========================================================= */
  function later(fn, ms) {
    if (typeof global.setTimeout === 'function') { global.setTimeout(fn, ms); }
  }
  function ensureAudio() {
    if (AC) { return AC; }
    var C = global.AudioContext || global.webkitAudioContext;
    if (!C) { return null; }
    try { AC = new C(); } catch (e) { AC = null; return null; }
    try {
      var osc = AC.createOscillator(), filt = AC.createBiquadFilter(), gain = AC.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = 46;
      filt.type = 'lowpass';
      filt.frequency.value = 620;
      filt.Q.value = 0.7;
      gain.gain.value = 0;
      osc.connect(filt);
      filt.connect(gain);
      gain.connect(AC.destination);
      osc.start();
      sndEngine = { osc: osc, filt: filt, gain: gain };
    } catch (e2) { sndEngine = null; }
    return AC;
  }
  function setSound(on) {
    SND_ON = !!on;
    save('cealin_bike_sound', SND_ON ? '1' : '0');
    if (!SND_ON && sndEngine) { try { sndEngine.gain.gain.value = 0; } catch (e) {} }
    return SND_ON;
  }
  function audioTick() {
    if (!SND_ON) {
      if (sndEngine) { try { sndEngine.gain.gain.value = 0; } catch (e0) {} }
      return;
    }
    var ac = ensureAudio();
    if (!ac || !sndEngine) { return; }
    if (ac.state === 'suspended' && state === 'running') { try { ac.resume(); } catch (e1) {} }
    var sp = (state === 'running' || state === 'finish' || state === 'crash') ? Math.min(speed || 0, 28) : 0;
    var drive = (state === 'running' && input && input.throttle) ? 1 : 0;
    try {
      sndEngine.osc.frequency.value += (40 + sp * 8.6 + drive * 14 - sndEngine.osc.frequency.value) * 0.22;
      sndEngine.filt.frequency.value = 420 + sp * 95;
      var g = (state === 'running') ? (0.010 + 0.026 * clamp(sp / 22, 0, 1) + 0.008 * drive) : 0;
      sndEngine.gain.gain.value += (g - sndEngine.gain.gain.value) * 0.16;
    } catch (e2) {}
  }
  function blip(freq, dur, type, vol) {
    if (!SND_ON) { return; }
    var ac = ensureAudio();
    if (!ac) { return; }
    try {
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.value = vol || 0.07;
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      o.connect(g);
      g.connect(ac.destination);
      o.start();
      o.stop(ac.currentTime + dur + 0.03);
    } catch (e) {}
  }
  function sfxPick() { blip(920, 0.09, 'square', 0.05); later(function () { blip(1360, 0.10, 'square', 0.045); }, 70); }
  function sfxLand(hard) { blip(hard ? 92 : 132, 0.17, 'sine', hard ? 0.15 : 0.08); }
  function sfxCrash() { blip(62, 0.42, 'sawtooth', 0.18); }
  function sfxFinish() { blip(660, 0.12, 'square', 0.06); later(function () { blip(990, 0.18, 'square', 0.05); }, 130); }

  var _dustFwd = null, _dustUp = null;
  function ensureDust() {
    if (DUST) { return DUST; }
    if (typeof THREE === 'undefined' || !scene) { return null; }
    var pos = new Float32Array(DUST_N * 3);
    var i;
    for (i = 0; i < DUST_N; i++) { pos[i * 3 + 1] = -999; }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({
      size: 0.5, sizeAttenuation: true, transparent: true, opacity: 0.55, depthWrite: false, color: 0x9a8b74
    });
    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    DUST = { pts: pts, geo: geo, mat: mat, pos: pos, dirt: -1, idx: 0 };
    DUST_LIST.length = 0;
    for (i = 0; i < DUST_N; i++) {
      DUST_LIST.push({ life: 0, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0 });
    }
    return DUST;
  }
  function emitDust(x, y, z, vx, vy, vz, spread) {
    var D = ensureDust();
    if (!D) { return; }
    var p = DUST_LIST[D.idx];
    D.idx = (D.idx + 1) % DUST_N;
    p.life = 0.55 + Math.random() * 0.35;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx + (Math.random() - 0.5) * spread;
    p.vy = vy + Math.random() * 1.1;
    p.vz = vz + (Math.random() - 0.5) * spread;
  }
  function stepDust(dt) {
    var D = ensureDust();
    if (!D) { return; }
    var want = (PAL && PAL.dirt !== undefined) ? PAL.dirt : 0x9a8b74;
    if (D.dirt !== want) { D.dirt = want; try { D.mat.color.setHex(want); } catch (e) {} }
    if (state === 'running' && grounded && speed > 4 && body) {
      if (!_dustFwd) { _dustFwd = new THREE.Vector3(); _dustUp = new THREE.Vector3(); }
      _dustFwd.set(0, 0, -1).applyQuaternion(body.quat);
      _dustUp.set(0, 1, 0).applyQuaternion(body.quat);
      var px = body.pos.x - _dustFwd.x * 0.95 - _dustUp.x * 0.32;
      var py = body.pos.y - _dustUp.y * 0.32;
      var pz = body.pos.z - _dustFwd.z * 0.95 - _dustUp.z * 0.32;
      var kick = 1.1 + speed * 0.06;
      emitDust(px, py, pz, -_dustFwd.x * kick, 0.85, -_dustFwd.z * kick, 1.5);
      if (speed > 13) { emitDust(px, py, pz, -_dustFwd.x * kick * 0.7, 1.15, -_dustFwd.z * kick * 0.7, 1.9); }
    }
    var pos = D.pos, moved = false, i, p;
    for (i = 0; i < DUST_N; i++) {
      p = DUST_LIST[i];
      if (p.life > 0) {
        p.life -= dt;
        p.vy -= 5.2 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.vx *= 0.97; p.vz *= 0.97;
        pos[i * 3] = p.x;
        pos[i * 3 + 1] = p.life > 0 ? p.y : -999;
        pos[i * 3 + 2] = p.z;
        moved = true;
      }
    }
    if (moved && D.geo.attributes && D.geo.attributes.position) {
      D.geo.attributes.position.needsUpdate = true;
    }
  }

  function renderTrack() {
    if (!panelBodyEl) { return; }
    if (panelTitleEl) { panelTitleEl.textContent = tr('bike.menuTrack', '\u9009\u62e9\u8d5b\u9053'); }
    var html = '<p class="panel-note">' + tr('bike.trackNote',
      '\u6bcf\u6761\u8d5b\u9053\u7684\u5730\u5f62\u3001\u8def\u9762\u4e0e\u96be\u5ea6\u90fd\u4e0d\u540c\uff0c\u6210\u7ee9\u6309\u8d5b\u9053\u5206\u522b\u8bb0\u5f55\u3002') + '</p>';
    var pp = partsProgress(), achN = achCount();
    html += '<p class="panel-note"><b>' + tr('bike.progTitle', '进度') + '</b>  ' +
      tr('bike.progCleared', '通关') + ' ' + clearedCount() + '/' + MAPS.length + '  \u00b7  ' +
      tr('bike.trackParts', '零件') + ' ' + pp.got + (pp.all ? ('/' + pp.all) : '') + '  \u00b7  ' +
      tr('bike.achTitle', '成就') + ' ' + achN.got + '/' + achN.all + '</p>';
    html += '<div class="skin-grid">';
    for (var i = 0; i < MAPS.length; i++) {
      var m = MAPS[i];
      var mBest = parseFloat(store('cealin_bike_best_' + m.key)) || 0;
      var mPk = parseInt(store('cealin_bike_picks_' + m.key), 10) || 0;
      var mPt = parseInt(store('cealin_bike_picktotal_' + m.key), 10) || 0;
      var mStat = (mBest > 0 ? tr('bike.trackDone', '\u901a\u5173') + ' ' + fmtTime(mBest)
        : tr('bike.trackTodo', '\u672a\u901a\u5173')) +
        (mPt > 0 ? ' \u00b7 ' + tr('bike.trackParts', '\u96f6\u4ef6') + ' ' + mPk + '/' + mPt : '');
      var diff = m.diff === 1 ? tr('bike.diffEasy', '\u8f7b\u677e')
        : (m.diff === 2 ? tr('bike.diffNormal', '\u4e2d\u7b49') : tr('bike.diffHard', '\u56f0\u96be'));
      html += '<button type="button" class="skin-card' + (i === curMapIdx ? ' on' : '') +
        '" data-map="' + i + '">' +
        '<i class="skin-dot" style="background:#' + hex6(m.tint) + '"></i>' +
        '<span class="sc-body"><b>' + tr(m.nameKey, m.name) + '</b>' +
        '<em>' + (m.finishS - m.startS) + 'm\u00b7' + diff + ' ' + stars(m.diff, 3) + '</em>' +
        '<em>' + tr(m.descKey, '') + '</em>' +
        '<em class="sc-stat">' + mStat + '</em></span></button>';
    }
    html += '</div>';

    /* 自定义赛道 */
    html += '<h3 class="gear-title">' + tr('bike.customTitle', '\u81ea\u5b9a\u4e49\u8d5b\u9053') + '</h3>';
    html += '<p class="panel-note">' + tr('bike.customNote', '\u8c03\u53c2\u6570\u751f\u6210\u4e00\u6761\u4e13\u5c5e\u8d5b\u9053\uff0c\u751f\u6210\u540e\u4f1a\u51fa\u73b0\u5728\u4e0a\u65b9\u5217\u8868\u672b\u5c3e\u3002') + '</p>';
    html += '<div class="custom-row"><label>' + tr('bike.customLength', '\u8d5b\u9053\u957f\u5ea6') + ' <b>' +
      (parseInt(CUSTOM_DEF.length, 10) || 900) + 'm</b></label>' +
      '<input type="range" class="custom-range" data-cus="length" min="320" max="2400" step="20" value="' +
      (parseInt(CUSTOM_DEF.length, 10) || 900) + '"></div>';
    html += '<div class="custom-row"><label>' + tr('bike.customTurn', '\u5f2f\u9053\u5bc6\u5ea6') + ' <b>' +
      (parseInt(CUSTOM_DEF.w1, 10) || 18) + '</b></label>' +
      '<input type="range" class="custom-range" data-cus="w1" min="6" max="34" step="1" value="' +
      (parseInt(CUSTOM_DEF.w1, 10) || 18) + '"></div>';
    html += '<div class="custom-row"><label>' + tr('bike.customWidth', '\u8def\u5bbd') + ' <b>' +
      (parseFloat(CUSTOM_DEF.w2) || 7) + '</b></label>' +
      '<input type="range" class="custom-range" data-cus="w2" min="2" max="16" step="0.5" value="' +
      (parseFloat(CUSTOM_DEF.w2) || 7) + '"></div>';
    html += '<div class="custom-row"><label>' + tr('bike.customRough', '\u98a0\u7c38\u7a0b\u5ea6') + ' <b>' +
      (parseFloat(CUSTOM_DEF.rough) || 1) + '</b></label>' +
      '<input type="range" class="custom-range" data-cus="rough" min="0.2" max="2.2" step="0.1" value="' +
      (parseFloat(CUSTOM_DEF.rough) || 1) + '"></div>';
    html += '<div class="custom-row"><label>' + tr('bike.customJump', '\u8df3\u53f0\u5bc6\u5ea6') + ' <b>' +
      (parseFloat(CUSTOM_DEF.jumpStep) || 88) + '</b></label>' +
      '<input type="range" class="custom-range" data-cus="jumpStep" min="40" max="200" step="4" value="' +
      (parseFloat(CUSTOM_DEF.jumpStep) || 88) + '"></div>';
    html += '<div class="custom-row"><label>' + tr('bike.customSeed', '\u968f\u673a\u79cd\u5b50') + ' <b>' +
      (parseInt(CUSTOM_DEF.seed, 10) || 20261130) + '</b></label>' +
      '<button type="button" class="opt-btn" data-cus-dice="1">' + tr('bike.customDice', '\u6362\u4e00\u4e2a') + '</button></div>';
    html += '<div class="opt-row">';
    for (var ci = 0; ci < CUSTOM_STYLES.length; ci++) {
      var cs = CUSTOM_STYLES[ci];
      html += '<button type="button" class="opt-btn' + (CUSTOM_DEF.style === cs.k ? ' on' : '') +
        '" data-cus-style="' + cs.k + '">' + tr('bike.customStyle' + cs.k.charAt(0).toUpperCase() + cs.k.slice(1), cs.name) + '</button>';
    }
    html += '</div>';
    html += '<div class="opt-row"><button type="button" class="opt-btn on" data-cus-build="1">' +
      tr('bike.customBuild', '\u751f\u6210\u5e76\u5f00\u8dd1') + '</button></div>';
    html += '<h3 class="gear-title">' + tr('bike.achTitle', '\u6210\u5c31') + '</h3>';
    html += '<div class="skin-grid">';
    var achAll = achDefs();
    for (var aj = 0; aj < achAll.length; aj++) {
      var aon = achHas(achAll[aj].key);
      html += '<div class="skin-card' + (aon ? ' on' : '') + ' ach-card"><span class="sc-body"><b>' +
        achAll[aj].name + '</b><em>' + (aon ? tr('bike.achDone', '\u5df2\u8fbe\u6210') : tr('bike.achUndone', '\u672a\u8fbe\u6210')) +
        '</em></span></div>';
    }
    html += '</div>';
    panelBodyEl.innerHTML = html;
  }

  function renderBoard() {
    if (!panelBodyEl) { return; }
    if (panelTitleEl) { panelTitleEl.textContent = tr('bike.menuBoard', '\u6392\u884c\u699c'); }
    var html = '<table class="board-table"><thead><tr><th>' + tr('bike.menuTrack', '\u8d5b\u9053') +
      '</th><th>' + tr('bike.best', '\u6700\u4f73\u7528\u65f6') + '</th><th>' + tr('bike.trick', '\u7279\u6280\u5206') +
      '</th><th>' + tr('bike.wheelieBest', '\u6700\u957f\u540e\u8f6e') + '</th></tr></thead><tbody>';
    for (var i = 0; i < MAPS.length; i++) {
      var bt = parseFloat(store(mapScoreKey(i, 'best')));
      var tk = parseFloat(store(mapScoreKey(i, 'trick')));
      var wb = parseFloat(store(mapScoreKey(i, 'wheelie')));
      if (i === 0) {
        if (!(isFinite(bt) && bt > 0)) { bt = parseFloat(store('cealin_bike_best')); }
        if (!(isFinite(tk) && tk > 0)) { tk = parseFloat(store('cealin_bike_trick')); }
      }
      html += '<tr' + (i === curMapIdx ? ' class="me"' : '') + '><td>' + tr(MAPS[i].nameKey, MAPS[i].name) +
        '</td><td>' + ((isFinite(bt) && bt > 0) ? fmtTime(bt) : '--:--') +
        '</td><td>' + ((isFinite(tk) && tk > 0) ? Math.round(tk) : 0) +
        '</td><td>' + ((isFinite(wb) && wb > 0) ? wb.toFixed(1) + 's' : '--') + '</td></tr>';
    }
    html += '</tbody></table>';
    html += '<p class="panel-note" style="margin-top:12px">' + tr('bike.boardNote',
      '\u6210\u7ee9\u53ea\u5b58\u5728\u672c\u673a\u6d4f\u89c8\u5668\u91cc\uff0c\u4e0d\u4e0a\u4f20\u3001\u4e0d\u8054\u673a\u3002') + '</p>';
    panelBodyEl.innerHTML = html;
  }

  function renderHelp() {
    if (!panelBodyEl) { return; }
    if (panelTitleEl) { panelTitleEl.textContent = tr('bike.menuHelp', '\u64cd\u4f5c'); }
    var rows = [
      ['W / \u2191', tr('bike.helpGas', '\u52a0\u6cb9\u95e8')],
      ['S', tr('bike.helpBrake', '\u5239\u8f66')],
      ['\u2193', tr('bike.helpPitchDown', '\u540e\u4ef0\uff08\u62ac\u524d\u8f6e\uff09')],
      ['\u2191', tr('bike.helpPitchUp', '\u524d\u503e\uff08\u538b\u8f66\u5934\uff09')],
      ['\u2190 \u2192', tr('bike.helpSteer', '\u8f6c\u5411 / \u7a7a\u4e2d\u65cb\u8f6c')],
      ['Space', tr('bike.helpJump', '\u5154\u8df3')],
      ['R', tr('bike.helpReset', '\u56de\u5230\u68c0\u67e5\u70b9')],
      ['Esc', tr('bike.helpPause', '\u6682\u505c')],
      ['V', tr('bike.helpCam', '\u5207\u6362\u89c6\u89d2')],
      ['M', tr('bike.helpSound', '\u97f3\u6548\u5f00\u5173')]
    ];
    var html = '<p class="panel-note">' + tr('bike.helpWheelie',
      '\u540e\u4ef0 + \u6cb9\u95e8\u53ef\u62ac\u8d77\u524d\u8f6e\u505a wheelie\uff0c\u89d2\u5ea6\u8d8a\u9ad8\u3001\u6301\u7eed\u8d8a\u4e45\u5206\u8d8a\u9ad8\uff1b\u540e\u4ef0\u8fc7\u5934\u4f1a\u540e\u7ffb\u6454\u5012\u3002') + '</p>';
    html += '<div class="help-list">';
    for (var i = 0; i < rows.length; i++) {
      html += '<div class="help-row"><kbd>' + rows[i][0] + '</kbd><span>' + rows[i][1] + '</span></div>';
    }
    html += '</div>';
    panelBodyEl.innerHTML = html;
  }

  /* =========================================================
   * 11. 涂装 / 性能改装 / 零件收集 / 自定义赛道
   * ========================================================= */

  function loadPaint() {
    var raw = store('cealin_bike_paint');
    if (!raw) { return; }
    try {
      var o = JSON.parse(raw);
      if (o && typeof o === 'object') {
        for (var i = 0; i < PAINT_SLOT.length; i++) {
          var k = PAINT_SLOT[i].k;
          if (typeof o[k] === 'string') { PAINT[k] = o[k]; }
        }
      }
    } catch (e) { /* 忽略损坏数据 */ }
  }
  function savePaint() { save('cealin_bike_paint', JSON.stringify(PAINT)); }

  function applyPaint() {
    if (!BIKE_MATS) { return; }
    var b = BIKES[curBikeIdx] || BIKES[0] || {};
    var map = { frame: b.frame, rim: b.rim, helmet: b.helmet, shirt: b.shirt };
    for (var i = 0; i < PAINT_SLOT.length; i++) {
      var k = PAINT_SLOT[i].k;
      var mat = BIKE_MATS[k];
      if (!mat || !mat.color) { continue; }
      var v = PAINT[k];
      if (v) { mat.color.setStyle(v); }
      else if (map[k] !== undefined) { mat.color.setHex(map[k]); }
    }
  }

  function setPaint(slot, color) {
    if (!PAINT.hasOwnProperty(slot)) { return; }
    PAINT[slot] = color || '';
    savePaint();
    applyPaint();
  }

  function loadUpg() {
    var raw = store('cealin_bike_upg');
    if (raw) {
      try {
        var o = JSON.parse(raw);
        if (o && typeof o === 'object') {
          for (var i = 0; i < UPG_DEF.length; i++) {
            var k = UPG_DEF[i].k;
            var v = parseInt(o[k], 10);
            UPG[k] = isFinite(v) ? clamp(v, 0, UPG_MAX) : 0;
          }
        }
      } catch (e) { /* 忽略 */ }
    }
    var pv = parseInt(store('cealin_bike_parts'), 10);
    PARTS = isFinite(pv) ? Math.max(0, pv) : 0;
  }
  function saveUpg() {
    save('cealin_bike_upg', JSON.stringify(UPG));
    save('cealin_bike_parts', String(PARTS));
  }

  /* 改装叠加到车型基础性能之上（applyBike 之后调用） */
  function applyUpgrades() {
    ENGINE *= 1 + 0.085 * UPG.engine;
    GRIP_MUL *= 1 + 0.055 * UPG.grip;
    JUMP_MUL *= 1 + 0.05 * UPG.trick;
  }

  function buyUpg(k) {
    var def = null;
    for (var i = 0; i < UPG_DEF.length; i++) { if (UPG_DEF[i].k === k) { def = UPG_DEF[i]; } }
    if (!def) { return; }
    if (UPG[k] >= UPG_MAX) { toastMsg(tr('bike.upgFull', '\u5df2\u6ee1\u7ea7')); return; }
    if (PARTS < UPG_COST) {
      toastMsg(tr('bike.upgNoParts', '\u96f6\u4ef6\u4e0d\u8db3\uff0c\u8dd1\u8d5b\u9053\u6536\u96c6\u96f6\u4ef6'));
      return;
    }
    PARTS -= UPG_COST;
    UPG[k] += 1;
    save('cealin_bike_parts', String(PARTS));
    saveUpg();
    applyBike(curBikeIdx);
    renderGarage();
    toastMsg(tr(def.nameKey, def.name) + ' +1');
  }

  /* ---- 零件拾取 ---- */
  function clearPickups() {
    PICKUP_LIST = [];
    PICKUPS_GOT = 0;
    if (PICKUPS) {
      scene.remove(PICKUPS);
      PICKUPS = null;
    }
  }

  function buildPickups() {
    clearPickups();
    if (!CFG || !CFG.finishS) { return; }
    var g = new THREE.Group();
    var geo = new THREE.TorusGeometry(0.36, 0.12, 5, 9);
    var mat = new THREE.MeshLambertMaterial({ color: 0xffc84a, emissive: 0x5a3c00, flatShading: true });
    var s, u, x, z, y, mesh;
    for (s = CFG.startS + 46; s < CFG.finishS - 40; s += 72) {
      u = Math.sin(s * 0.037 + 1.3) * CFG.trackHalf * 0.55;
      x = cxAt(s) + u;
      z = -s;
      y = heightAt(x, z) + 1.05;
      mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      g.add(mesh);
      PICKUP_LIST.push({ mesh: mesh, s: s, baseY: y, got: false });
    }
    PICKUPS = g;
  if (MP && MP.key) { save('cealin_bike_picktotal_' + MP.key, String(PICKUP_LIST.length)); }
    scene.add(g);
  }

  var PICKUP_T = 0;
  function stepPickups(dt) {
    if (!PICKUPS || !PICKUP_LIST.length) { return; }
    PICKUP_T += dt;
    var live = state === 'running';
    var bx = body ? body.pos.x : 0, by = body ? body.pos.y : 0, bz = body ? body.pos.z : 0;
    for (var i = 0; i < PICKUP_LIST.length; i++) {
      var it = PICKUP_LIST[i];
      if (it.got) { continue; }
      it.mesh.rotation.y += dt * 2.6;
      it.mesh.rotation.x = Math.sin(PICKUP_T * 1.6 + i) * 0.35;
      it.mesh.position.y = it.baseY + Math.sin(PICKUP_T * 2.2 + i * 0.8) * 0.12;
      if (!live) { continue; }
      var dx = it.mesh.position.x - bx, dy = it.mesh.position.y - by, dz = it.mesh.position.z - bz;
      if (dx * dx + dy * dy + dz * dz < 6.0) {
        it.got = true;
        it.mesh.visible = false;
        PARTS += 1;
        PICKUPS_GOT += 1;
        save('cealin_bike_parts', String(PARTS));
        sfxPick();
        var pkKey = 'cealin_bike_picks_' + ((MP && MP.key) ? MP.key : 'x');
        if (PICKUPS_GOT > (parseInt(store(pkKey), 10) || 0)) { save(pkKey, String(PICKUPS_GOT)); }
        checkAch();
        toastMsg(tr('bike.pickupPart', '\u62ff\u5230\u96f6\u4ef6 +1') + '  (' + PICKUPS_GOT + ')');
      }
    }
  }

  /* ---- 自定义赛道 ---- */

  function loadCustom() {
    var raw = store('cealin_bike_custom');
    if (!raw) { return; }
    try {
      var o = JSON.parse(raw);
      if (o && typeof o === 'object') {
        for (var k in CUSTOM_DEF) {
          if (o[k] !== undefined && o[k] !== null) { CUSTOM_DEF[k] = o[k]; }
        }
      }
    } catch (e) { /* 忽略 */ }
  }

  function customMapIndex() {
    if (!MAPS) { return -1; }
    for (var i = 0; i < MAPS.length; i++) { if (MAPS[i].key === 'custom') { return i; } }
    return -1;
  }

  function makeCustomMap() {
    var base = MAPS[0];
    var m = {}, k;
    for (k in base) { m[k] = base[k]; }
    var len = clamp(parseInt(CUSTOM_DEF.length, 10) || 900, 320, 2400);
    var w1 = clamp(parseFloat(CUSTOM_DEF.w1) || 18, 6, 34);
    var w2 = clamp(parseFloat(CUSTOM_DEF.w2) || 7, 2, 16);
    var rg = clamp(parseFloat(CUSTOM_DEF.rough) || 1, 0.2, 2.2);
    var jp = clamp(parseFloat(CUSTOM_DEF.jumpStep) || 88, 40, 200);
    var sd = parseInt(CUSTOM_DEF.seed, 10) || 20261130;
    m.key = 'custom';
    m.nameKey = 'bike.mapCustom';
    m.name = '\u81ea\u5b9a\u4e49\u8d5b\u9053';
    m.descKey = 'bike.mapCustomDesc';
    m.tint = 0x59c6a8;
    m.diff = 2;
    m.seed = sd;
    m.length = len;
    m.finishS = len - 20;
    m.startS = 8;
    m.cpEvery = Math.max(120, Math.round(len / 5));
    m.trackHalf = clamp(4.6 + w2 * 0.35, 5.0, 9.5);
    m.cw1 = w1;
    m.cw2 = w2;
    m.rough = rg;
    m.jumpStep = jp;
    m.jumpStepVar = Math.round(jp * 0.9);
    m.jumpLenMin = 5 + rg * 2;
    m.jumpLenVar = 5 + rg * 3;
    m.jumpHMin = 0.7 + rg * 0.4;
    m.jumpHVar = 0.6 + rg * 0.5;
    m.und1 = 3.6 + rg * 1.2;
    m.und2 = 1.4 + rg * 0.6;
    var st = String(CUSTOM_DEF.style || 'trail');
    m.style = (st === 'trail') ? 'trail' : st;
    if (st === 'snow') { m.grips = [0.34, 0.50, 0.66, 0.44]; }
    else if (st === 'dune') { m.grips = [0.42, 0.54, 0.70, 0.52]; }
    else if (st === 'factory') { m.grips = [0.58, 0.74, 0.86, 0.62]; }
    else { m.grips = [0.50, 0.68, 0.82, 0.64]; }
    if (st === 'snow') {
      m.sky = 0xdfeaf4; m.fog = 0xd2e2ee; m.fogNear = 46; m.fogFar = 300;
      m.sunColor = 0xeaf4ff; m.sunI = 1.05; m.hemiI = 0.92; m.ambI = 0.34;
    } else if (st === 'dune') {
      m.sky = 0xf3d7a4; m.fog = 0xe6c793; m.fogNear = 110; m.fogFar = 520;
      m.sunColor = 0xffe0a8; m.sunI = 1.35; m.hemiI = 0.66; m.ambI = 0.30;
    } else if (st === 'factory') {
      m.sky = 0x9aa3a8; m.fog = 0x9099a0; m.fogNear = 60; m.fogFar = 340;
      m.sunColor = 0xd8d2c4; m.sunI = 0.95; m.hemiI = 0.72; m.ambI = 0.30;
    } else if (st === 'urban') {
      m.sky = 0x6f7d8c; m.fog = 0x76838f; m.fogNear = 55; m.fogFar = 320;
    }
    return m;
  }

  function syncCustomMap() {
    ensureDefs();
    var idx = customMapIndex();
    var m = makeCustomMap();
    if (idx >= 0) { MAPS[idx] = m; return idx; }
    MAPS.push(m);
    return MAPS.length - 1;
  }

  function applyCustom() {
    save('cealin_bike_custom', JSON.stringify(CUSTOM_DEF));
    var idx = syncCustomMap();
    renderTrack();
    toastMsg(tr('bike.customSaved', '\u81ea\u5b9a\u4e49\u8d5b\u9053\u5df2\u751f\u6210'));
    return idx;
  }

  function readCustomInputs() {
    if (!panelBodyEl) { return; }
    var list = panelBodyEl.querySelectorAll('[data-cus]');
    for (var i = 0; i < list.length; i++) {
      var k = list[i].getAttribute('data-cus');
      var v = parseFloat(list[i].value);
      if (isFinite(v)) { CUSTOM_DEF[k] = v; }
    }
    save('cealin_bike_custom', JSON.stringify(CUSTOM_DEF));
  }

  function onPanelInput(ev) {
    var el = ev && ev.target;
    if (!el || !el.getAttribute) { return; }
    if (!el.getAttribute('data-cus')) { return; }
    var row = el.parentNode;
    var b = row && row.querySelector ? row.querySelector('b') : null;
    if (b) { b.textContent = el.value; }
  }

  function setCamMode(mode) {
    camMode = (mode === 'first') ? 'first' : 'third';
    save('cealin_bike_cam', camMode);
    if (global.__bike && global.__bike.snapshot) { /* 保持快照接口可用 */ }
  }

  function renderSettings() {
    if (!panelBodyEl) { return; }
    if (panelTitleEl) { panelTitleEl.textContent = tr('bike.menuSettings', '\u8bbe\u7f6e'); }
    var fsOn = !!fsEl();
    var hi = renderer.getPixelRatio() > 1.01;
    var html = '<p class="panel-note">' + tr('bike.settingsNote', '\u753b\u8d28\u8c8a\u5c24\u4f1a\u5f71\u54cd\u5e27\u7387\u3002') + '</p>';
    html += '<div class="opt-row"><button type="button" class="opt-btn' + (fsOn ? ' on' : '') +
      '" data-set="fs">' + tr('bike.settingsFullscreen', '\u5168\u5c4f') + '</button>';
    html += '<button type="button" class="opt-btn' + (hi ? ' on' : '') +
      '" data-set="quality">' + (hi ? tr('bike.qualityHigh', '\u9ad8\u753b\u8d28') : tr('bike.qualityLow', '\u6d41\u7545')) + '</button></div>';
    html += '<div class="opt-row">';
    html += '<button type="button" class="opt-btn' + (oilMode === 'oil' ? ' on' : '') +
      '" data-set="style">' + (oilMode === 'oil' ? tr('bike.styleOil', '\u6cb9\u753b') : tr('bike.styleReal', '\u5199\u5b9e')) + '</button>';
    html += '<button type="button" class="opt-btn' + (camMode === 'first' ? ' on' : '') +
      '" data-set="cam">' + (camMode === 'first' ? tr('bike.camFirst', '\u7b2c\u4e00\u4eba\u79f0') : tr('bike.camThird', '\u7b2c\u4e09\u4eba\u79f0')) + '</button></div>';
    html += '<button type="button" class="opt-btn' + (SND_ON ? ' on' : '') +
      '" data-set="sound">' + (SND_ON ? tr('bike.soundOn', '音效开') : tr('bike.soundOff', '音效关')) + '</button>';
    html += '<div class="panel-sep"></div><div class="opt-row">';
    html += '<button type="button" class="opt-btn" data-set="reset">' + tr('bike.settingsReset',
      '\u6e05\u7a7a\u672c\u8d5b\u9053\u6210\u7ee9') + '</button>';
    html += '<button type="button" class="opt-btn" data-set="home">' + tr('bike.home', '\u8fd4\u56de\u4e3b\u9875') + '</button></div>';
    panelBodyEl.innerHTML = html;
  }

  /* ---------------- 外壳文案 ---------------- */
  function refreshShellText() {
    if (menuBestTimeEl) {
      menuBestTimeEl.textContent = bestTime > 0 ? fmtTime(bestTime) : '--:--';
    }
    if (menuBestTrickEl) { menuBestTrickEl.textContent = String(Math.round(bestTrick || 0)); }
    if (menuMapEl && MAPS && MAPS[curMapIdx]) {
      menuMapEl.textContent = tr(MAPS[curMapIdx].nameKey, MAPS[curMapIdx].name);
    }
    if (btnPauseEl) {
      btnPauseEl.textContent = (state === 'paused') ? t('bike.resume') : t('bike.pause');
    }
    rerenderPanelsSafe();
  }

  /* ---------------- 待机相机 / 回放 ---------------- */
  function updateIdleCamera(dt) {
    idleT += dt;
    var s = CFG.startS + 26 + Math.sin(idleT * 0.08) * 22;
    var x = cxAt(s) + Math.sin(idleT * 0.11) * 10;
    var z = -s;
    var gy = heightAt(x, z);
    _idleA.set(x + 7.2, gy + 5.2 + Math.sin(idleT * 0.21) * 0.55, z + 12.5);
    _idleB.set(x - 1.6, gy + 1.2, z - 5.5);
    camera.position.lerp(_idleA, 1 - Math.exp(-dt * 2.2));
    camera.lookAt(_idleB);
    if (Math.abs(camera.fov - 56) > 0.5) {
      camera.fov = 56;
      camera.updateProjectionMatrix();
    }
  }

  function advanceReplay(dt) {
    replayTimer += dt;
    if (replayBufferLen() === 0) { return; }
    var fpsR = 10;
    while (replayTimer >= 1 / fpsR) {
      replayTimer -= 1 / fpsR;
      replayPos++;
      if (replayPos >= recordBuf.length) { replayPos = 0; }
    }
    var f = recordBuf[replayPos];
    if (!f) { return; }
    bikeGroup.position.set(f[0], f[1], f[2]);
    bikeGroup.quaternion.set(f[3], f[4], f[5], f[6]);
    _idleA.set(f[0] + 4.5, f[1] + 2.6, f[2] + 7.5);
    _idleB.set(f[0], f[1] + 0.9, f[2]);
    camera.position.lerp(_idleA, 1 - Math.exp(-dt * 3.2));
    camera.lookAt(_idleB);
  }
  function replayBufferLen() { return recordBuf ? recordBuf.length : 0; }

  /* ---------------- 每帧扩展（wheelie HUD + 轨迹录制） ---------------- */
  function syncExtras(dt) {
    if (wheelieTime > wheeliePeak) { wheeliePeak = wheelieTime; }
    if (wheelieHudEl) {
      if (state === 'running' && wheelieActive && wheelieTime > 0.2) {
        wheelieHudEl.classList.remove('hide');
        if (wheelieTimeEl) { wheelieTimeEl.textContent = wheelieTime.toFixed(1) + 's'; }
        if (wheeliePtsEl) {
          wheeliePtsEl.textContent = '+' + Math.round(wheelieScoreF - wheelieBanked);
        }
      } else {
        wheelieHudEl.classList.add('hide');
      }
    }
    if (state === 'running') {
      recordTimer += dt;
      if (recordTimer >= 0.1) {
        recordTimer = 0;
        if (recordBuf.length < 3000) {
          recordBuf.push([body.pos.x, body.pos.y, body.pos.z,
            body.quat.x, body.quat.y, body.quat.z, body.quat.w]);
        }
      }
    }
  }

  /* ---------------- 事件绑定与启动 ---------------- */
  function closestAttr(node, attr) {
    while (node && node !== doc.body) {
      if (node.getAttribute && node.getAttribute(attr) !== null) { return node; }
      node = node.parentNode;
    }
    return null;
  }

  function bootShell() {
    ensureDefs();
    shellEl = byId('gameShell');
    menuLayerEl = byId('menuLayer');
    sideMenuEl = byId('sideMenu');
    panelLayerEl = byId('panelLayer');
    panelTitleEl = byId('panelTitle');
    panelBodyEl = byId('panelBody');
    btnPanelBackEl = byId('btnPanelBack');
    menuBestTimeEl = byId('menuBestTime');
    menuBestTrickEl = byId('menuBestTrick');
    menuMapEl = byId('menuMap');
    hudBarEl = byId('hudBar');
    wheelieHudEl = byId('wheelieHud');
    wheelieTimeEl = byId('wheelieTime');
    wheeliePtsEl = byId('wheeliePts');
    toastEl = byId('bikeToast');
    btnHomeEl = byId('btnHome');
    btnFullEl = byId('btnFull');
    btnPauseEl = byId('btnPause');
    if (!_idleA) { _idleA = new THREE.Vector3(); }
    if (!_idleB) { _idleB = new THREE.Vector3(); }
    if (btnHomeEl) {
      btnHomeEl.addEventListener('click', function () {
        exitFs();
        global.location.href = 'index.html';
      });
    }
    if (btnFullEl) { btnFullEl.addEventListener('click', function () { toggleFs(); }); }
    doc.addEventListener('fullscreenchange', syncFsIcon);
    doc.addEventListener('webkitfullscreenchange', syncFsIcon);

    if (sideMenuEl) {
      sideMenuEl.addEventListener('click', function (ev) {
        var b = closestAttr(ev.target, 'data-act');
        if (!b) { return; }
        var act = b.getAttribute('data-act');
        if (act === 'ride') { beginRide(); return; }
        if (act === 'replay') {
          if (recordBuf.length < 6) { toastMsg(tr('bike.replayEmpty', '\u8fd8\u6ca1\u6709\u53ef\u56de\u653e\u7684\u8f68\u8ff9\uff0c\u5148\u53bb\u8dd1\u4e00\u8d9f\u5427')); return; }
          replayPos = 0; replayTimer = 0;
          setViewMode('replay');
          hideOverlay();
          refreshShellText();
          toastMsg(tr('bike.replayStop', '\u56de\u653e\u4e2d\uff0c\u70b9\u4efb\u610f\u83dc\u5355\u9000\u51fa'));
          return;
        }
        openPanel(act);
      });
    }
    if (panelBodyEl) {
      panelBodyEl.addEventListener('input', onPanelInput);
      panelBodyEl.addEventListener('click', function (ev) {
        var b = closestAttr(ev.target, 'data-bike');
        if (b) {
          applyBike(parseInt(b.getAttribute('data-bike'), 10));
          renderGarage();
          refreshShellText();
          return;
        }
        var gEl = closestAttr(ev.target, 'data-gear');
        if (gEl) {
          var spec = String(gEl.getAttribute('data-gear')).split(':');
          applyGear(spec[0], parseInt(spec[1], 10));
          renderGarage();
          return;
        }
        var ptEl = closestAttr(ev.target, 'data-paint');
        if (ptEl) {
          var pSpec = String(ptEl.getAttribute('data-paint')).split(':');
          setPaint(pSpec[0], pSpec[1] || '');
          renderGarage();
          return;
        }
        var ugEl = closestAttr(ev.target, 'data-upg');
        if (ugEl) {
          buyUpg(ugEl.getAttribute('data-upg'));
          return;
        }
        var diceEl = closestAttr(ev.target, 'data-cus-dice');
        if (diceEl) {
          CUSTOM_DEF.seed = Math.floor(Math.random() * 999999) + 1;
          save('cealin_bike_custom', JSON.stringify(CUSTOM_DEF));
          renderTrack();
          return;
        }
        var stEl = closestAttr(ev.target, 'data-cus-style');
        if (stEl) {
          CUSTOM_DEF.style = stEl.getAttribute('data-cus-style');
          save('cealin_bike_custom', JSON.stringify(CUSTOM_DEF));
          renderTrack();
          return;
        }
        var bdEl = closestAttr(ev.target, 'data-cus-build');
        if (bdEl) {
          readCustomInputs();
          var cIdx = applyCustom();
          applyMap(cIdx, false);
          save('cealin_bike_map', String(cIdx));
          refreshShellText();
          renderTrack();
          return;
        }
        var m = closestAttr(ev.target, 'data-map');
        if (m) {
          var idx = parseInt(m.getAttribute('data-map'), 10);
          applyMap(idx, false);
          save('cealin_bike_map', String(idx));
          renderTrack();
          refreshShellText();
          toastMsg(tr(MAPS[idx].nameKey, MAPS[idx].name));
          return;
        }
        var s = closestAttr(ev.target, 'data-set');
        if (s) {
          var set = s.getAttribute('data-set');
          if (set === 'fs') { toggleFs(); renderSettings(); }
          else if (set === 'quality') {
            var hi = !(renderer.getPixelRatio() > 1.01);
            renderer.setPixelRatio(hi ? Math.min(global.devicePixelRatio || 1, 2) : 1);
            resize();
            renderSettings();
          } else if (set === 'style') {
            setOilMode(oilMode === 'oil' ? 'real' : 'oil');
            renderSettings();
          } else if (set === 'cam') {
            setCamMode(camMode === 'first' ? 'third' : 'first');
            renderSettings();
          } else if (set === 'sound') {
            setSound(!SND_ON);
            renderSettings();
            toastMsg(SND_ON ? tr('bike.soundOn', '音效开') : tr('bike.soundOff', '音效关'));
          } else if (set === 'reset') {
            save(mapScoreKey(curMapIdx, 'best'), '');
            save(mapScoreKey(curMapIdx, 'trick'), '');
            save(mapScoreKey(curMapIdx, 'wheelie'), '');
            save(mapScoreKey(curMapIdx, 'date'), '');
            if (curMapIdx === 0) {
              save('cealin_bike_best', '');
              save('cealin_bike_trick', '');
            }
            loadBest();
            refreshShellText();
            toastMsg(tr('bike.settingsResetDone', '\u5df2\u6e05\u7a7a\u672c\u8d5b\u9053\u6210\u7ee9'));
            renderSettings();
          } else if (set === 'home') {
            exitFs();
            global.location.href = 'index.html';
          }
        }
      });
    }
    if (btnPanelBackEl) { btnPanelBackEl.addEventListener('click', function () { closePanel(); }); }
    var ovMenuEl = byId('ovMenu');
    if (ovMenuEl) { ovMenuEl.addEventListener('click', function () { backToMenu(); }); }

    /* Esc 暂停时回到主菜单的二次留白：面板打开时先关面板 */
    doc.addEventListener('keydown', function (ev) {
      var k = ev.key;
      if (k === 'Escape' && panelOpen) { closePanel(); return; }
      if ((k === 'm' || k === 'M') && !panelOpen) { setSound(!SND_ON); renderSettings(); toastMsg(SND_ON ? tr('bike.soundOn', '\u97f3\u6548\u5f00') : tr('bike.soundOff', '\u97f3\u6548\u5173')); return; }
  if (viewMode === 'replay' && (k === 'Escape' || k === 'Enter' || k === ' ')) {
        backToMenu();
      }
    });

    syncFsIcon();
    refreshShellText();
    setViewMode('menu');
  }

  /* ---------------- 启动 ---------------- */
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', function () { bootShell(); });
  } else {
    bootShell();
  }

})(window, document);
