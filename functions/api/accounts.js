// Cloudflare Pages Function: /api/accounts
// Cealin 账号系统：只用「名称 + 密码」注册，系统自动分配唯一 8 位编号；登录只认编号 + 密码。
// 密码不以明文入库：客户端用 Web Crypto 计算 SHA-256(salt + ':' + 密码) 后只上传哈希；
// 若调用方直接传 password，服务端同样用 crypto.subtle 加盐哈希后存储。
//
// 请求（POST，JSON）：
//   { action: 'register', name, pwdHash, salt }   或 { action: 'register', name, password }
//   { action: 'challenge', id }                   -> 返回该编号的盐（登录前取盐）
//   { action: 'login', id, pwdHash }              或 { action: 'login', id, password }
//   { action: 'changeId', id, newId, pwdHash }    或 { action: 'changeId', id, newId, password }
//   { action: 'changePwd', id, pwdHash, newPwdHash, newSalt? }
//                                 或 { action: 'changePwd', id, password, newPassword }
//   { action: 'search', password, q }             管理员：按编号（完整 / 部分）搜索账号
//   { action: 'official', password, id, official } 管理员：授予 / 取消官方认证
// 响应：{ ok: true, id, name } / { ok: false, error, code }
//
// KV 约定（绑定名 GUESTBOOK）：
//   account:{id} -> { id, name, pwdHash, salt, createdAt, official?, officialAt?, idChangedAt? }
//   新编号固定 8 位，字符集为 0-9 / A-Z / a-z 与 @（@ 为唯一允许的特殊符号）；
//   系统自动分配的编号只用大写字母 + 数字（排除易混淆的 0 O 1 I L），便于手抄。

const KV_PREFIX = 'account:';
// 排除 0 / 1 / I / L / O，避免手抄编号时看错
const ID_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ID_LEN = 8;
const ID_RETRY = 12;
const NAME_MAX = 20;
const PWD_MIN = 6;
const PWD_MAX = 64;
const HEX64 = /^[a-f0-9]{64}$/;
const HEX32 = /^[a-f0-9]{32}$/;
// 登录 / 查询用：新编号 8 位，历史账号 6 位；字符限 0-9 A-Z a-z @
const ID_RE = /^[A-Za-z0-9@]{6,8}$/;
// 新编号更严格：必须 8 位
const NEW_ID_RE = /^[A-Za-z0-9@]{8}$/;
const ID_ILLEGAL_RE = /[^A-Za-z0-9@]/;
// 管理员密码：沿用全站约定（KV 键 admin_pwd 优先，缺省值与其他管理接口一致）
const DEFAULT_ADMIN_PWD = 'liuyiwei150314';
const ADMIN_PWD_KEY = 'admin_pwd';
// 搜索：最多返回 50 条，最多扫描 10 页（每页 1000 个 key）
const SEARCH_LIMIT = 50;
const SEARCH_PAGES = 10;
const SEARCH_PAGE_SIZE = 1000;

function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  }
  return out;
}

function randomHex(size) {
  const buf = new Uint8Array(size);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

// 8 位编号：随机 + 排除易混淆字符
function makeId() {
  const buf = new Uint8Array(ID_LEN);
  crypto.getRandomValues(buf);
  let id = '';
  for (let i = 0; i < ID_LEN; i++) {
    id += ID_CHARS.charAt(buf[i] % ID_CHARS.length);
  }
  return id;
}

// Web Crypto：SHA-256(salt + ':' + password) 的十六进制串
async function hashPassword(salt, password) {
  const data = new TextEncoder().encode(salt + ':' + password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

// 定长比较，避免通过响应时间猜测哈希
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function nameLen(name) {
  // 按字符计数，中文 / emoji 都算一个字
  return Array.from(name).length;
}

// 读取账号：命中返回 { key, acc }，未命中返回 null
// 历史 6 位编号是大写，用户小写输入时回退到大写键再查一次
async function readAccount(kv, id) {
  if (!id) return null;
  const key = KV_PREFIX + id;
  let raw = await kv.get(key);
  let realKey = key;
  if (!raw && id.length === 6 && /^[a-z0-9]+$/.test(id)) {
    realKey = KV_PREFIX + id.toUpperCase();
    raw = await kv.get(realKey);
  }
  if (!raw) return null;
  let acc = null;
  try {
    acc = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  if (!acc || typeof acc !== 'object') return null;
  return { key: realKey, acc: acc };
}

async function checkAdmin(kv, password) {
  let adminPwd = DEFAULT_ADMIN_PWD;
  adminPwd = (await kv.get(ADMIN_PWD_KEY)) || DEFAULT_ADMIN_PWD;
  return typeof password === 'string' && password.length > 0 && password === adminPwd;
}

export async function onRequest(context) {
  const { env, request } = context;

  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });

  const fail = (status, error, code) => json({ ok: false, error, code }, status);

  if (request.method !== 'POST') {
    return fail(405, '不支持的请求方法', 'method');
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return fail(400, '请求体不是合法的 JSON', 'bad_json');
  }
  if (!body || typeof body !== 'object') {
    return fail(400, '请求体不是合法的 JSON', 'bad_json');
  }

  const kv = env && env.GUESTBOOK;
  if (!kv) {
    return fail(500, '服务未配置存储，请稍后重试', 'no_kv');
  }

  const action = typeof body.action === 'string' ? body.action : '';
  const password = typeof body.password === 'string' ? body.password : '';
  let pwdHash = typeof body.pwdHash === 'string' ? body.pwdHash.trim().toLowerCase() : '';
  let salt = typeof body.salt === 'string' ? body.salt.trim().toLowerCase() : '';
  // 编号区分大小写（新编号允许小写），只做去空格
  const id = typeof body.id === 'string' ? body.id.trim() : '';

  /* ---------------- 注册：名称 + 密码 → 分配编号 ---------------- */
  if (action === 'register') {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return fail(400, '请输入名称', 'name_required');
    if (nameLen(name) > NAME_MAX) return fail(400, '名称最多 20 个字符', 'name_long');

    if (pwdHash) {
      // 前端已用 Web Crypto 加盐哈希：只收 64 位十六进制哈希与 32 位盐
      if (!HEX64.test(pwdHash)) return fail(400, '密码哈希格式不正确', 'hash_bad');
      if (!HEX32.test(salt)) return fail(400, '盐格式不正确', 'salt_bad');
    } else {
      if (password.length < PWD_MIN) return fail(400, '密码至少需要 6 位', 'pwd_short');
      if (password.length > PWD_MAX) return fail(400, '密码最长 64 位', 'pwd_long');
      salt = randomHex(16);
      pwdHash = await hashPassword(salt, password);
    }

    // 编号全局唯一：冲突则重新生成，最多重试 ID_RETRY 次
    let newId = '';
    let placed = false;
    for (let i = 0; i < ID_RETRY; i++) {
      const candidate = makeId();
      let exists = null;
      try {
        exists = await kv.get(KV_PREFIX + candidate);
      } catch (err) {
        return fail(500, '服务异常，请稍后重试', 'server');
      }
      if (!exists) {
        newId = candidate;
        placed = true;
        break;
      }
    }
    if (!placed) {
      return fail(503, '编号分配失败，请稍后重试', 'id_exhausted');
    }

    const record = {
      id: newId,
      name: name,
      pwdHash: pwdHash,
      salt: salt,
      createdAt: Date.now()
    };
    try {
      await kv.put(KV_PREFIX + newId, JSON.stringify(record));
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }

    // 只回编号与名称，哈希与盐不出服务端
    return json({ ok: true, id: newId, name: name });
  }

  /* ---------------- 取盐：登录前拿到该编号的盐 ---------------- */
  if (action === 'challenge') {
    if (!ID_RE.test(id)) return fail(400, '编号格式不正确', 'id_bad');
    let found = null;
    try {
      found = await readAccount(kv, id);
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    if (!found || !found.acc.salt) return fail(401, '编号或密码错误', 'bad_cred');
    return json({ ok: true, id: found.acc.id || id, salt: found.acc.salt });
  }

  /* ---------------- 登录：编号 + 密码 ---------------- */
  if (action === 'login') {
    if (!ID_RE.test(id)) return fail(400, '请输入正确的账号编号', 'id_bad');

    let found = null;
    try {
      found = await readAccount(kv, id);
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    if (!found) return fail(401, '编号或密码错误', 'bad_cred');

    const acc = found.acc;
    if (!acc.pwdHash || !acc.salt) return fail(500, '服务异常，请稍后重试', 'server');

    let candidate = '';
    if (pwdHash) {
      candidate = pwdHash;
    } else {
      if (!password) return fail(400, '请输入密码', 'pwd_required');
      candidate = await hashPassword(acc.salt, password);
    }

    if (!safeEqual(candidate, acc.pwdHash)) {
      return fail(401, '编号或密码错误', 'bad_cred');
    }
    return json({ ok: true, id: acc.id || id, name: acc.name || '' });
  }

  /* ---------------- 更改自己的编号：旧编号 + 密码 + 新编号 ---------------- */
  if (action === 'changeId') {
    const newId = typeof body.newId === 'string' ? body.newId.trim() : '';
    if (!ID_RE.test(id)) return fail(400, '编号格式不正确', 'id_bad');
    if (!newId) return fail(400, '请输入新编号', 'new_id_required');
    // 先查非法字符，再查位数，提示更准确
    if (ID_ILLEGAL_RE.test(newId)) return fail(400, '新编号只能使用数字、字母和 @', 'id_char');
    if (!NEW_ID_RE.test(newId)) return fail(400, '新编号必须是 8 位', 'id_len');

    let found = null;
    try {
      found = await readAccount(kv, id);
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    if (!found) return fail(401, '编号或密码错误', 'bad_cred');

    const acc = found.acc;
    if (!acc.pwdHash || !acc.salt) return fail(500, '服务异常，请稍后重试', 'server');

    // 校验密码（沿用 salt + pwdHash 机制，服务端可重算也接受客户端哈希）
    let candidate = '';
    if (pwdHash) {
      if (!HEX64.test(pwdHash)) return fail(400, '密码哈希格式不正确', 'hash_bad');
      candidate = pwdHash;
    } else {
      if (!password) return fail(400, '请输入密码', 'pwd_required');
      candidate = await hashPassword(acc.salt, password);
    }
    if (!safeEqual(candidate, acc.pwdHash)) {
      return fail(401, '编号或密码错误', 'bad_cred');
    }

    // 不能与自己原编号相同（历史 6 位账号比较实际生效编号）
    const currentId = acc.id || id;
    if (newId === currentId) return fail(400, '新编号不能与原编号相同', 'id_same');

    // 全局唯一：不能与他人冲突
    let exists = null;
    try {
      exists = await kv.get(KV_PREFIX + newId);
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    if (exists) return fail(409, '该编号已被占用，请换一个', 'id_taken');

    // 迁移：保留 name / pwdHash / salt / createdAt / official 等全部字段，仅换编号
    const migrated = Object.assign({}, acc, { id: newId, idChangedAt: Date.now() });
    try {
      await kv.put(KV_PREFIX + newId, JSON.stringify(migrated));
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }

    const oldKey = found.key;
    const newKey = KV_PREFIX + newId;
    if (oldKey !== newKey) {
      try {
        await kv.delete(oldKey);
      } catch (err) {
        // 旧键删除失败：回滚新键，避免一个账号存在两份数据
        try {
          await kv.delete(newKey);
        } catch (err2) {
          /* 回滚也失败时返回错误，由用户重试 */
        }
        return fail(500, '服务异常，请稍后重试', 'server');
      }
    }

    return json({
      ok: true,
      id: newId,
      name: migrated.name || '',
      official: !!migrated.official
    });
  }

  /* ---------------- 更改自己的密码：编号 + 当前密码 + 新密码 ---------------- */
  if (action === 'changePwd') {
    if (!ID_RE.test(id)) return fail(400, '编号格式不正确', 'id_bad');

    const newPwdHash = typeof body.newPwdHash === 'string' ? body.newPwdHash.trim().toLowerCase() : '';
    const newSalt = typeof body.newSalt === 'string' ? body.newSalt.trim().toLowerCase() : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    if (!newPwdHash && !newPassword) return fail(400, '请输入新密码', 'new_pwd_required');

    let found = null;
    try {
      found = await readAccount(kv, id);
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    if (!found) return fail(401, '编号或密码错误', 'bad_cred');

    const acc = found.acc;
    if (!acc.pwdHash || !acc.salt) return fail(500, '服务异常，请稍后重试', 'server');

    // 1) 校验当前密码（客户端哈希优先，也接受明文由服务端按原盐重算）
    let current = '';
    if (pwdHash) {
      if (!HEX64.test(pwdHash)) return fail(400, '密码哈希格式不正确', 'hash_bad');
      current = pwdHash;
    } else {
      if (!password) return fail(400, '请输入密码', 'pwd_required');
      current = await hashPassword(acc.salt, password);
    }
    if (!safeEqual(current, acc.pwdHash)) {
      return fail(401, '编号或密码错误', 'bad_cred');
    }

    // 2) 生成新密码的哈希与盐：前端已算好则复用前端盐，否则服务端重新加盐
    let nextHash = '';
    let nextSalt = acc.salt;
    if (newPwdHash) {
      if (!HEX64.test(newPwdHash)) return fail(400, '密码哈希格式不正确', 'hash_bad');
      if (newSalt) {
        if (!HEX32.test(newSalt)) return fail(400, '盐格式不正确', 'salt_bad');
        nextSalt = newSalt;
      }
      nextHash = newPwdHash;
    } else {
      if (newPassword.length < PWD_MIN) return fail(400, '密码至少需要 6 位', 'pwd_short');
      if (newPassword.length > PWD_MAX) return fail(400, '密码最长 64 位', 'pwd_long');
      // 换盐后无法用哈希比对，先用原盐算一次，拦住「新密码与旧密码相同」
      const sameAsOld = await hashPassword(acc.salt, newPassword);
      if (safeEqual(sameAsOld, acc.pwdHash)) {
        return fail(400, '新密码不能与当前密码相同', 'pwd_same');
      }
      nextSalt = randomHex(16);
      nextHash = await hashPassword(nextSalt, newPassword);
    }

    // 3) 新旧密码不能相同：沿用原盐时可直接比对哈希，换盐时只能在客户端判断
    if (nextSalt === acc.salt && safeEqual(nextHash, acc.pwdHash)) {
      return fail(400, '新密码不能与当前密码相同', 'pwd_same');
    }

    const updated = Object.assign({}, acc, {
      pwdHash: nextHash,
      salt: nextSalt,
      pwdChangedAt: Date.now()
    });
    try {
      await kv.put(found.key, JSON.stringify(updated));
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }

    // 只回编号与名称，哈希与盐不出服务端；登录态不变，无需重新登录
    return json({ ok: true, id: updated.id || id, name: updated.name || '' });
  }

  /* ---------------- 管理员：按编号搜索账号 ---------------- */
  if (action === 'search') {
    let admin = false;
    try {
      admin = await checkAdmin(kv, password);
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    if (!admin) return fail(401, '密码错误', 'admin_pwd');

    const q = (typeof body.q === 'string' ? body.q.trim() : '').replace(/^account:/i, '');
    const qUpper = q.toUpperCase();

    const matched = [];
    let scanned = 0;
    let page = 0;
    let cursor = undefined;
    try {
      while (page < SEARCH_PAGES) {
        const opts = { prefix: KV_PREFIX, limit: SEARCH_PAGE_SIZE };
        if (cursor) opts.cursor = cursor;
        const res = await kv.list(opts);
        const keys = (res && res.keys) || [];
        for (let i = 0; i < keys.length; i++) {
          const aid = String(keys[i] && keys[i].name ? keys[i].name : '').slice(KV_PREFIX.length);
          if (!aid) continue;
          if (qUpper && aid.toUpperCase().indexOf(qUpper) < 0) continue;
          matched.push(aid);
          if (matched.length >= SEARCH_LIMIT) break;
        }
        scanned += keys.length;
        page++;
        if (matched.length >= SEARCH_LIMIT) break;
        if (!res || res.list_complete) break;
        cursor = res.cursor;
        if (!cursor) break;
      }
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }

    // 逐个读明细（凭据字段 pwdHash / salt 一律不回传）
    const records = await Promise.all(
      matched.map(async (aid) => {
        try {
          const raw = await kv.get(KV_PREFIX + aid);
          if (!raw) return null;
          const acc = JSON.parse(raw);
          if (!acc || typeof acc !== 'object') return null;
          return {
            id: acc.id || aid,
            name: acc.name || '',
            createdAt: acc.createdAt || 0,
            official: !!acc.official,
            officialAt: acc.officialAt || 0
          };
        } catch (err) {
          return null;
        }
      })
    );

    const accounts = records.filter(Boolean).sort((a, b) => {
      if (a.official !== b.official) return a.official ? -1 : 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    return json({
      ok: true,
      accounts: accounts,
      count: accounts.length,
      scanned: scanned,
      truncated: matched.length >= SEARCH_LIMIT
    });
  }

  /* ---------------- 管理员：授予 / 取消官方认证 ---------------- */
  if (action === 'official') {
    let admin = false;
    try {
      admin = await checkAdmin(kv, password);
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    if (!admin) return fail(401, '密码错误', 'admin_pwd');

    if (!ID_RE.test(id)) return fail(400, '编号格式不正确', 'id_bad');
    const on = body.official !== false;

    let found = null;
    try {
      found = await readAccount(kv, id);
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    if (!found) return fail(404, '账号不存在', 'id_not_found');

    const acc = Object.assign({}, found.acc);
    acc.official = on;
    acc.officialAt = on ? Date.now() : 0;
    if (!acc.id) acc.id = id;

    try {
      await kv.put(found.key, JSON.stringify(acc));
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }

    return json({
      ok: true,
      id: acc.id,
      name: acc.name || '',
      official: on,
      officialAt: acc.officialAt
    });
  }

  return fail(400, '未知的操作类型', 'unknown_action');
}
