// Cloudflare Pages Function: /api/accounts
// Cealin 账号系统：只用「名称 + 密码」注册，系统自动分配唯一 6 位编号；登录只认编号 + 密码。
// 密码不以明文入库：客户端用 Web Crypto 计算 SHA-256(salt + ':' + 密码) 后只上传哈希；
// 若调用方直接传 password，服务端同样用 crypto.subtle 加盐哈希后存储。
//
// 请求（POST，JSON）：
//   { action: 'register', name, pwdHash, salt }   或 { action: 'register', name, password }
//   { action: 'challenge', id }                   -> 返回该编号的盐（登录前取盐）
//   { action: 'login', id, pwdHash }              或 { action: 'login', id, password }
// 响应：{ ok: true, id, name } / { ok: false, error, code }
//
// KV 约定（绑定名 GUESTBOOK）：
//   account:{id} -> { id, name, pwdHash, salt, createdAt }
//   id 为 6 位大写字母 / 数字，字符集排除易混淆的 0 O 1 I L

const KV_PREFIX = 'account:';
// 排除 0 / 1 / I / L / O，避免手抄编号时看错
const ID_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ID_LEN = 6;
const ID_RETRY = 12;
const NAME_MAX = 20;
const PWD_MIN = 6;
const PWD_MAX = 64;
const HEX64 = /^[a-f0-9]{64}$/;
const HEX32 = /^[a-f0-9]{32}$/;
const ID_RE = /^[A-Z0-9]{6}$/;

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

// 6 位编号：随机 + 排除易混淆字符
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
  const id = typeof body.id === 'string' ? body.id.trim().toUpperCase() : '';

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
    let raw = null;
    try {
      raw = await kv.get(KV_PREFIX + id);
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    if (!raw) return fail(401, '编号或密码错误', 'bad_cred');
    let acc = null;
    try {
      acc = JSON.parse(raw);
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    if (!acc || !acc.salt) return fail(500, '服务异常，请稍后重试', 'server');
    return json({ ok: true, id: id, salt: acc.salt });
  }

  /* ---------------- 登录：编号 + 密码 ---------------- */
  if (action === 'login') {
    if (!ID_RE.test(id)) return fail(400, '请输入 6 位账号编号', 'id_bad');

    let raw = null;
    try {
      raw = await kv.get(KV_PREFIX + id);
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    if (!raw) return fail(401, '编号或密码错误', 'bad_cred');

    let acc = null;
    try {
      acc = JSON.parse(raw);
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    if (!acc || !acc.pwdHash || !acc.salt) return fail(500, '服务异常，请稍后重试', 'server');

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
    return json({ ok: true, id: acc.id, name: acc.name || '' });
  }

  return fail(400, '未知的操作类型', 'unknown_action');
}
