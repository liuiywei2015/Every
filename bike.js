/* bike.js — 低多边形 3D 山地速降（自行车 downhill）
 * 1) 纯单机：无网络请求、无外部模型/纹理，所有几何体程序化生成
 * 2) 物理：自写固定步长 120Hz 刚体积分 + 双轮弹簧阻尼悬挂 + 切向驱动 / 侧向摩擦约束
 *    自行车是完整刚体（位置 / 四元数 / 线速度 / 角速度），不是沿轨道播放的假动画
 * 3) 赛道：固定随机种子程序化生成，同一条赛道可反复计时比较
 * 4) 成绩只写 localStorage，不上传、不联机
 */
(function (global, doc) {
  'use strict';

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
    return 15 * Math.sin(s * 0.0058) + 6 * Math.sin(s * 0.0155 + 1.2);
  }
  function cyBase(s) {
    return -0.128 * s - 4.6 * Math.sin(s * 0.0042) - 1.8 * Math.sin(s * 0.0158 + 0.6);
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
    if (au <= CFG.trackHalf) {
      y += 0.16 * vnoise(s * 0.09, u * 0.13) - 0.08;
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
      y += 1.0 + 11.0 * Math.pow(tt, 1.8) + 1.8 * vnoise(s * 0.1, u * 0.1);
    }
    return y;
  }

  function buildTrack() {
    var rng = mulberry32(CFG.seed);
    var i, j, s, k, code, run, r;

    JUMPS.length = 0;
    s = 110;
    while (s < CFG.length - 120) {
      JUMPS.push({
        s0: s,
        len: 6 + rng() * 4,
        h: 1.0 + rng() * 0.85,
        gap: 5 + rng() * 5,
        drop: 0.9 + rng() * 0.7
      });
      s += 85 + rng() * 80;
    }

    k = 0; code = 0;
    while (k < N) {
      run = Math.round((18 + rng() * 34) / CFG.ds);
      for (i = 0; i < run && k < N; i++) { SURF[k++] = code; }
      r = rng();
      code = r < 0.30 ? 1 : (r < 0.58 ? 2 : (r < 0.78 ? 3 : 0));
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
    var g = SURF_DEF[surfAt(x, z)].grip;
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

  scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x4b3b26, LIGHTUI ? 1.05 : 0.9));
  var sun = new THREE.DirectionalLight(0xfff2d6, LIGHTUI ? 1.15 : 1.0);
  sun.position.set(-60, 90, 40);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, LIGHTUI ? 0.35 : 0.22));

  var terrainMesh = null, treesTrunk = null, treesLeaf = null, rocksMesh = null, gateGroup = null;

  function terrainColor(s, u, code, out) {
    var au = Math.abs(u), tt;
    if (au <= CFG.trackHalf + 1.5) {
      if (code === 1) { out.setRGB(0.40, 0.38, 0.35); }
      else if (code === 2) { out.setRGB(0.30, 0.23, 0.15); }
      else if (code === 3) { out.setRGB(0.30, 0.40, 0.20); }
      else { out.setRGB(0.43, 0.32, 0.21); }
    } else if (au <= 12) {
      tt = clamp((au - CFG.trackHalf) / 5.5, 0, 1);
      out.setRGB(lerp(0.40, 0.33, tt), lerp(0.31, 0.31, tt), lerp(0.21, 0.21, tt));
    } else {
      tt = clamp((au - 12) / 18, 0, 1);
      out.setRGB(lerp(0.31, 0.47, tt), lerp(0.30, 0.47, tt), lerp(0.28, 0.48, tt));
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
    var trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3524, flatShading: true });
    var leafMat = new THREE.MeshLambertMaterial({ color: 0x2f4a2a, flatShading: true });
    var count = 460;
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
    var rockMat = new THREE.MeshLambertMaterial({ color: 0x6b6a63, flatShading: true });
    var rc = 170;
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

  (function loadBest() {
    var b = parseFloat(store('cealin_bike_best'));
    if (isFinite(b) && b > 0) { bestTime = b; }
    var tk = parseFloat(store('cealin_bike_trick'));
    if (isFinite(tk) && tk > 0) { bestTrick = tk; }
  })();

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
          var antiW = clamp(1 - Math.max(0, noseUp) * 1.9, 0.1, 1);
          var engine = 660 * antiW * (1 - clamp(vf / 24, 0, 1) * 0.72);
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

    // 姿态控制
    var pitchIn = (input.leanFwd - input.leanBack) * act;   // +X 力矩 = 车头下压
    var yawIn = (input.yawRight - input.yawLeft) * act;
    if (grounded) {
      // 地面：重心前后移动产生俯仰力矩（翘头 / 压头）
      T_ACC.add(TM.set(pitchIn * 520, yawIn * 40, 0).applyQuaternion(q));
    } else {
      // 空中：左右旋转控制车身姿态（空翻 / 侧转）
      T_ACC.add(TM.set(pitchIn * 165, yawIn * 100, 0).applyQuaternion(q));
      body.ang.multiplyScalar(1 - clamp(dt * 0.5, 0, 0.2));
    }

    // ---- 骑手平衡回路：贴地时自动把车身姿态拉回坡面，并给俯仰/侧倾加阻尼 ----
    if (grounded) {
      normalAt(body.pos.x, body.pos.z, T3);
      T6.crossVectors(upW, T3);                       // 恢复轴：把车身 up 拧向地形法线
      var balK = BAL_K + Math.min(sp, 30) * 22;       // 车速越快，稳定力矩越强
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

    if (tilt > 0.95 || lastVy < -10.5) {
      crashNow('landing');
      return;
    }
    if (flips >= 1 || spins >= 1) {
      var gain = Math.round((flips * 260 + spins * 180) * clamp(0.6 + speed / 16, 0.6, 1.8));
      trickScore += gain;
      toast((flips >= 1 ? (flips > 1 ? flips + 'x ' : '') + t('bike.trickFlip') : '') +
        (spins >= 1 ? ' ' + (spins > 1 ? spins + 'x ' : '') + t('bike.trickSpin') : '') + '  +' + gain);
      if (trickScore > bestTrick) { bestTrick = trickScore; save('cealin_bike_trick', bestTrick); }
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
    elapsed = 0; dist = 0; speed = 0; maxSpeed = 0; crashes = 0;
    airCount = 0; trickScore = 0; cpIndex = 0; totalAirTime = 0;
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
      save('cealin_bike_best', bestTime.toFixed(3));
    }
    if (trickScore > bestTrick) { bestTrick = trickScore; save('cealin_bike_trick', bestTrick); }
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
    input.jump = !!(keys['Space'] || ext.jump);

    // 兔跳蓄力
    if (input.jump && grounded && (state === 'running')) {
      jumpCharge = clamp(jumpCharge + 0.028, 0, 1);
    } else if (!input.jump && jumpCharge > 0) {
      if (grounded && state === 'running') {
        var upW = T1.set(0, 1, 0).applyQuaternion(body.quat);
        body.vel.addScaledVector(upW, 3.0 + 2.8 * jumpCharge);
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
    updateCamera(dt);
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
  buildTrack();
  buildTerrain();
  buildProps();
  buildGates();
  buildBikeModel();
  placeAt(CFG.startS, 0);
  camLook.copy(body.pos);
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

  showOverlay('ready');
  updateHud(1);
  global.requestAnimationFrame(frame);

  /* i18n 延迟就绪 / 语言切换后，重绘由 JS 写入的静态文案 */
  function rerenderLang() {
    if (state === 'ready') { showOverlay('ready'); }
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
})(window, document);
