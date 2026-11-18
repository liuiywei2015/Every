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
    var au = Math.abs(u), y = 0, tt;
    var rough = (MP && MP.rough) || 1;
    var hill = (MP && MP.hill) || 11.0;
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

  function buildProps() {
    var rng = mulberry32(CFG.seed + 7);
    var trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 2.4, 5);
    var leafGeo = new THREE.ConeGeometry(1.55, 4.2, 6);
    var pp = PAL || DEF_PAL;
    var trunkMat = new THREE.MeshLambertMaterial({ color: pp.trunk, flatShading: true });
    var leafMat = new THREE.MeshLambertMaterial({ color: pp.leaf, flatShading: true });
    var count = (MP && MP.treeCount) || 460;
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
    var rc = (MP && MP.rockCount) || 170;
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

    // 骑手
    riderTorso = box(0.34, 0.46, 0.24, matShirt, 0, 0.62, -0.02, 0.30);
    var head = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.19, 0.19), matSkin);
    head.position.set(0, 0.92, 0.08);
    chassis.add(head);
    var helmet = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.16, 0.27), matHelmet);
    helmet.position.set(0, 1.02, 0.08);
    chassis.add(helmet);
    box(0.09, 0.09, 0.44, matSkin, -0.20, 0.62, 0.30, 0.75);
    box(0.09, 0.09, 0.44, matSkin, 0.20, 0.62, 0.30, 0.75);
    box(0.12, 0.34, 0.12, matDark, -0.13, 0.16, -0.04, 0.35);
    box(0.12, 0.34, 0.12, matDark, 0.13, 0.16, -0.04, 0.35);

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

    if (tilt > 1.20 || lastVy < -13) {
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
    syncExtras(dt);
    updateHud(dt);
    renderer.render(scene, camera);
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
        trackSeed: CFG.seed
      };
    },
    start: startRun,
    pause: doPause,
    resume: function () { if (state === 'paused') { doPause(); } },
    reset: respawnAtCheckpoint,
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
    dropMesh(terrainMesh); terrainMesh = null;
    dropMesh(treesTrunk); treesTrunk = null;
    dropMesh(treesLeaf); treesLeaf = null;
    dropMesh(rocksMesh); rocksMesh = null;
    dropMesh(gateGroup); gateGroup = null;
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
    if (BIKE_MATS) {
      BIKE_MATS.frame.color.setHex(b.frame);
      BIKE_MATS.rim.color.setHex(b.rim);
      BIKE_MATS.helmet.color.setHex(b.helmet);
      BIKE_MATS.shirt.color.setHex(b.shirt);
    }
    var sr = b.rad / 0.34;
    if (rearWheelRoot) { rearWheelRoot.scale.set(sr, sr, sr); }
    if (frontWheelRoot) { frontWheelRoot.scale.set(sr, sr, sr); }
    if (WHEELS && WHEELS.length > 1) {
      WHEELS[0].rad = b.rad; WHEELS[1].rad = b.rad;
      WHEELS[0].minLen = b.rad; WHEELS[1].minLen = b.rad;
      WHEELS[0].maxLen = b.rad + 0.26; WHEELS[1].maxLen = b.rad + 0.26;
    }
  }

  function initWorld() {
    ensureDefs();
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
    var html = '<p class="panel-note">' + tr('bike.garageNote',
      '\u6bcf\u8f86\u8f66\u7684\u91cd\u91cf\u3001\u6293\u5730\u3001\u52a0\u901f\u4e0e\u5f39\u8df3\u90fd\u4e0d\u540c\uff0c\u9009\u5b9a\u540e\u7acb\u5373\u751f\u6548\u3002') + '</p>';
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
    panelBodyEl.innerHTML = html;
  }

  function renderTrack() {
    if (!panelBodyEl) { return; }
    if (panelTitleEl) { panelTitleEl.textContent = tr('bike.menuTrack', '\u9009\u62e9\u8d5b\u9053'); }
    var html = '<p class="panel-note">' + tr('bike.trackNote',
      '\u6bcf\u6761\u8d5b\u9053\u7684\u5730\u5f62\u3001\u8def\u9762\u4e0e\u96be\u5ea6\u90fd\u4e0d\u540c\uff0c\u6210\u7ee9\u6309\u8d5b\u9053\u5206\u522b\u8bb0\u5f55\u3002') + '</p>';
    html += '<div class="skin-grid">';
    for (var i = 0; i < MAPS.length; i++) {
      var m = MAPS[i];
      var diff = m.diff === 1 ? tr('bike.diffEasy', '\u8f7b\u677e')
        : (m.diff === 2 ? tr('bike.diffNormal', '\u4e2d\u7b49') : tr('bike.diffHard', '\u56f0\u96be'));
      html += '<button type="button" class="skin-card' + (i === curMapIdx ? ' on' : '') +
        '" data-map="' + i + '">' +
        '<i class="skin-dot" style="background:#' + hex6(m.tint) + '"></i>' +
        '<span class="sc-body"><b>' + tr(m.nameKey, m.name) + '</b>' +
        '<em>' + (m.finishS - m.startS) + 'm\u00b7' + diff + ' ' + stars(m.diff, 3) + '</em>' +
        '<em>' + tr(m.descKey, '') + '</em></span></button>';
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
      ['Esc', tr('bike.helpPause', '\u6682\u505c')]
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
      panelBodyEl.addEventListener('click', function (ev) {
        var b = closestAttr(ev.target, 'data-bike');
        if (b) {
          applyBike(parseInt(b.getAttribute('data-bike'), 10));
          renderGarage();
          refreshShellText();
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
