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
//   { action: 'heartbeat', id }                   在线心跳：写 account:presence:{id}（TTL 1800 秒）
//   { action: 'search', password, q? }            管理员：账号列表 / 按编号或名称搜索（q 留空=全部，60 秒边缘缓存）
//   { action: 'stats', password }                 管理员：概览统计（在线数、账号数、房间数、消息数估算、KV 用量估算，60 秒边缘缓存）
//   { action: 'official', password, id, official } 管理员：授予 / 取消官方认证
//   { action: 'resetRequest', id }                 用户：登录页「忘记密码」提交重置申请（不改密码）
//   { action: 'resetList', password }              管理员：密码重置申请列表（含已生成的临时密码）
//   { action: 'resetTemp', password, id }          管理员：为该编号生成临时密码并暂存明文供查看（TTL 7 天）
//   { action: 'resetDrop', password, id }          管理员：删除重置记录（同时抹掉临时密码明文）
// 响应：{ ok: true, id, name } / { ok: false, error, code }
//
// KV 约定（绑定名 GUESTBOOK）：
//   account:{id} -> { id, name, pwdHash, salt, createdAt, official?, officialAt?, idChangedAt? }
//   account:presence:{id} -> { id, ts }  （在线心跳，写入时带 expirationTtl=1800 秒自动回收）
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
// 列表最多读取 300 条账号明细、最多扫描 2000 个编号键，避免单次请求无上限膨胀
const ACCOUNT_READ_MAX = 300;
const ACCOUNT_SCAN_MAX = 2000;

// 密码重置：用户在登录页提交申请 → 写 pwdreset:{id}；管理员在后台生成临时密码并查看
// 临时密码明文只存在该键内（7 天 TTL 自动失效），用户自行改密成功后立即删除
const PWD_RESET_PREFIX = 'pwdreset:';
const PWD_RESET_TTL = 7 * 24 * 3600;
// 同一编号的重复申请间隔（毫秒）：重复提交只刷新申请时间，不覆盖已生成的临时密码
const PWD_RESET_MIN_GAP = 60 * 1000;
const TEMP_PWD_LEN = 10;
const TEMP_PWD_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';

// 在线心跳：account:presence:{id} 带 1800 秒 TTL 自动回收；读取时 20 分钟内有心跳视为在线。
// 阈值必须明显大于前端心跳间隔（10 分钟 + 0~2 分钟抖动），否则用户会在下一次心跳到来前被判离线。
const PRESENCE_PREFIX = 'account:presence:';
const PRESENCE_TTL = 1800;
const ONLINE_WINDOW = 20 * 60 * 1000;
// 单次心跳表读取上限（防止大量历史键拖垮请求）
const PRESENCE_READ_LIMIT = 200;

// 概览统计：最多遍历 10 页（每页 1000 键）、最多读 30 个房间做消息量抽样、每类最多 4 个抽样键
const STATS_PAGES = 10;
const STATS_PAGE_SIZE = 1000;
const STATS_ROOM_READ_MAX = 30;
const STATS_SAMPLE_PER_CAT = 4;

// 管理员统计 / 搜索结果的边缘缓存：同一查询 60 秒内复用，避免后台反复点击消耗 KV 读与 list 配额。
// 缓存键只由「接口类型 + 查询词」决定；管理员密码校验始终在读写缓存之前完成，未授权请求不会进入缓存。
const CACHE_TTL = 60;
const CACHE_HOST = 'cealin-cache.internal';

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

// 临时密码：管理员重置时生成，排除易混淆字符，便于口头或手抄转告用户
function makeTempPwd(len) {
  const size = len || TEMP_PWD_LEN;
  const buf = new Uint8Array(size);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < size; i++) {
    out += TEMP_PWD_CHARS.charAt(buf[i] % TEMP_PWD_CHARS.length);
  }
  return out;
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

/* ================= 邮箱验证码：注册强制验证 + 登录二次验证 =================
 * 注册：名称 + 密码 + 邮箱 + 验证码，验证码校验通过才落库，并写入 email 字段。
 * 登录：编号 + 密码校验通过后，再向绑定邮箱发码，验证码正确才算登录成功。
 * 老账号（无 email）首次登录时由用户补填邮箱，验证通过后自动绑定。
 * 验证码存 KV，按场景分键；10 分钟有效、60 秒发送冷却、24 小时最多 8 次、最多试错 5 次。 */
const EMAIL_MAX = 254;
const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
const VCODE_REG_PREFIX = 'vcode:reg:';
const VCODE_LOGIN_PREFIX = 'vcode:login:';
const VCODE_CNT_PREFIX = 'vcode:cnt:';
const VCODE_TTL = 600;
const VCODE_COOL = 60;
const VCODE_SEND_MAX = 8;
const VCODE_SEND_WINDOW = 86400;
const VCODE_TRY_MAX = 5;
const CODE_LEN = 6;
const CODE_RE = /^[0-9]{6}$/;

function normEmail(v) {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

function emailOk(email) {
  if (!email || email.length > EMAIL_MAX) return false;
  if (email.indexOf('..') >= 0) return false;
  return EMAIL_RE.test(email);
}

// 脱敏：本地部分保留首字符，其余用 *，域名保留（a***@qq.com）
function maskEmail(email) {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return email.charAt(0) + '***' + email.slice(at);
}

function makeCode() {
  const buf = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) out += String(buf[i] % 10);
  return out;
}

// 邮件通道优先级：
//   1. 自有邮箱 SMTP（SMTP_USER + SMTP_PASS，QQ 邮箱走 smtp.qq.com:465 隐式 TLS，零第三方依赖）
//   2. Brevo（BREVO_API_KEY）
//   3. Resend（RESEND_API_KEY）
// 发件人：SMTP 通道取 SMTP_USER，API 通道取 MAIL_FROM
const SMTP_HOST = 'smtp.qq.com';
const SMTP_PORT = 465;
const SMTP_TIMEOUT = 15000;

function smtpReady(env) {
  return !!(env && env.SMTP_USER && env.SMTP_PASS);
}

function mailReady(env) {
  return smtpReady(env) || !!(env && (env.BREVO_API_KEY || env.RESEND_API_KEY));
}

// 单封 SMTP 投递：cloudflare:sockets 走 465 端口隐式 TLS（node:tls 在 Workers 上连 465 会超时，
// 故改用原生 sockets + secureTransport:'on'），AUTH PLAIN 认证，正文 base64 避免 8bit 中文乱码。
// 任何失败都返回 {ok:false}，不抛异常。
async function sendSmtpMail(user, pass, to, subject, text) {
  let connect = null;
  try {
    const mod = await import('cloudflare:sockets');
    connect = mod && mod.connect;
  } catch (err) {
    connect = null;
  }
  if (typeof connect !== 'function') return { ok: false, reason: 'mail_fail' };

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const timer = { id: 0 };
  let socket = null;
  let settled = false;
  let resolveDone = null;
  const done = new Promise(function (resolve) { resolveDone = resolve; });
  const finish = function (ok) {
    if (settled) return;
    settled = true;
    clearTimeout(timer.id);
    try { if (socket && socket.close) socket.close(); } catch (err) { /* 忽略 */ }
    resolveDone({ ok: !!ok, via: ok ? 'smtp' : undefined });
  };
  timer.id = setTimeout(function () { finish(false); }, SMTP_TIMEOUT);

  try {
    socket = connect({ hostname: SMTP_HOST, port: SMTP_PORT }, { secureTransport: 'on', allowHalfOpen: false });
    await socket.opened;
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    const state = { buf: '' };

    const send = async function (line) {
      await writer.write(encoder.encode(line + '\r\n'));
    };
    const readLine = async function () {
      for (;;) {
        const idx = state.buf.indexOf('\r\n');
        if (idx >= 0) {
          const line = state.buf.slice(0, idx);
          state.buf = state.buf.slice(idx + 2);
          return line;
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error('closed');
        state.buf += decoder.decode(chunk.value, { stream: true });
      }
    };
    // 读取一条完整应答（含 250- 多行续行）
    const readReply = async function () {
      let line = await readLine();
      const code = line.slice(0, 3);
      while (line.charAt(3) === '-') {
        line = await readLine();
        if (line.slice(0, 3) !== code) break;
      }
      return line;
    };

    if (!/^220/.test(await readReply())) return finish(false);           // banner
    await send('EHLO cealin.pages.dev');
    if (!/^250/.test(await readReply())) return finish(false);           // EHLO
    const token = Buffer.from('\u0000' + user + '\u0000' + pass, 'utf8').toString('base64');
    await send('AUTH PLAIN ' + token);
    if (!/^235/.test(await readReply())) return finish(false);           // 认证
    await send('MAIL FROM:<' + user + '>');
    if (!/^250/.test(await readReply())) return finish(false);
    await send('RCPT TO:<' + to + '>');
    if (!/^250/.test(await readReply())) return finish(false);
    await send('DATA');
    if (!/^354/.test(await readReply())) return finish(false);
    const body = Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
    const payload = [
      'From: Cealin <' + user + '>',
      'To: <' + to + '>',
      'Subject: =?UTF-8?B?' + Buffer.from(subject, 'utf8').toString('base64') + '?=',
      'Date: ' + new Date().toUTCString(),
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      body,
      '.'
    ].join('\r\n');
    await writer.write(encoder.encode(payload + '\r\n'));
    if (!/^250/.test(await readReply())) return finish(false);           // 正文投递
    try { await send('QUIT'); } catch (err) { /* 忽略 */ }
    finish(true);
  } catch (err) {
    finish(false);
  }
  return done;
}

async function sendMail(env, to, subject, text) {
  const brevo = env ? env.BREVO_API_KEY : '';
  const resend = env ? env.RESEND_API_KEY : '';
  const apiFrom = env && typeof env.MAIL_FROM === 'string' ? env.MAIL_FROM.trim() : '';

  // 首选：自有邮箱 SMTP
  if (smtpReady(env)) {
    const smtpUser = String(env.SMTP_USER).trim();
    const sent = await sendSmtpMail(smtpUser, String(env.SMTP_PASS), to, subject, text);
    if (sent.ok) return sent;
    if (!brevo && !resend) return { ok: false, reason: 'mail_fail' };
  }

  const from = apiFrom;
  if (!brevo && !resend) return { ok: false, reason: 'mail_not_configured' };
  if (!from) return { ok: false, reason: 'mail_not_configured' };

  let resp = null;
  try {
    if (brevo) {
      resp = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': String(brevo),
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          sender: { email: from, name: 'Cealin' },
          to: [{ email: to }],
          subject: subject,
          textContent: text
        })
      });
    } else {
      resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + String(resend),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ from: from, to: [to], subject: subject, text: text })
      });
    }
  } catch (err) {
    return { ok: false, reason: 'mail_fail' };
  }
  if (!resp || !resp.ok) {
    return { ok: false, reason: 'mail_fail', status: resp ? resp.status : 0 };
  }
  return { ok: true, via: brevo ? 'brevo' : 'resend' };
}

// 生成并写入验证码：先查日限、再查冷却，均通过才发码
async function issueCode(kv, key, scene, email) {
  const now = Date.now();
  const cntKey = VCODE_CNT_PREFIX + scene + ':' + (email || key);
  let cnt = 0;
  try {
    cnt = Number(await kv.get(cntKey)) || 0;
  } catch (err) {
    cnt = 0;
  }
  if (cnt >= VCODE_SEND_MAX) return { ok: false, code: 'code_daily' };

  let prev = null;
  try {
    prev = await kv.get(key, 'json');
  } catch (err) {
    prev = null;
  }
  if (prev && prev.sentAt && now - prev.sentAt < VCODE_COOL * 1000) {
    return { ok: false, code: 'code_cooldown', wait: Math.ceil((VCODE_COOL * 1000 - (now - prev.sentAt)) / 1000) };
  }

  const code = makeCode();
  try {
    await kv.put(
      key,
      JSON.stringify({ code: code, sentAt: now, tried: 0 }),
      { expirationTtl: VCODE_TTL }
    );
    await kv.put(cntKey, String(cnt + 1), { expirationTtl: VCODE_SEND_WINDOW });
  } catch (err) {
    return { ok: false, code: 'server' };
  }
  return { ok: true, code: code };
}

// 校验验证码：正确即删除；错误累计到上限也删除，防止暴力尝试
async function verifyCode(kv, key, code) {
  let raw = null;
  try {
    raw = await kv.get(key, 'json');
  } catch (err) {
    return { ok: false, code: 'server' };
  }
  if (!raw || !raw.code) return { ok: false, code: 'code_bad' };

  if (String(raw.code) !== String(code)) {
    const tried = (Number(raw.tried) || 0) + 1;
    if (tried >= VCODE_TRY_MAX) {
      try { await kv.delete(key); } catch (err) {}
    } else {
      try {
        await kv.put(
          key,
          JSON.stringify({ code: raw.code, sentAt: raw.sentAt || Date.now(), tried: tried }),
          { expirationTtl: VCODE_TTL }
        );
      } catch (err) {}
    }
    return { ok: false, code: 'code_bad' };
  }

  try { await kv.delete(key); } catch (err) {}
  return { ok: true };
}

// 字节长度：KV 存储按 key + value 的字节数计，用于概览里的「估算占用」
function byteLen(str) {
  if (!str) return 0;
  try {
    return new TextEncoder().encode(str).length;
  } catch (err) {
    return String(str).length;
  }
}

// KV 键归类：概览面板按类别统计键数量与抽样体积
function categorizeKey(name) {
  if (name.indexOf(PRESENCE_PREFIX) === 0) return 'presence';
  if (name.indexOf(KV_PREFIX) === 0) return 'account';
  if (name.indexOf('room:') === 0) {
    return /^[A-Za-z0-9]{4}$/.test(name.slice(5)) ? 'room' : 'roomSub';
  }
  if (name.indexOf('suggestion') === 0) return 'suggestion';
  if (name === 'notice') return 'notice';
  return 'other';
}

// 读取在线表：account:presence:{id} 的键本身带 1800 秒 TTL，
// 值里的 ts 在 20 分钟内才算在线；超出的只作为「最近活跃时间」参考。
async function readPresence(kv, now, maxRead) {
  const names = [];
  let cursor;
  let page = 0;
  do {
    const opts = { prefix: PRESENCE_PREFIX, limit: 1000 };
    if (cursor) opts.cursor = cursor;
    const res = await kv.list(opts);
    const keys = (res && res.keys) || [];
    for (let i = 0; i < keys.length; i++) {
      const name = keys[i] && keys[i].name ? String(keys[i].name) : '';
      if (name.length > PRESENCE_PREFIX.length) names.push(name);
    }
    cursor = res && !res.list_complete ? res.cursor : null;
    page++;
  } while (cursor && page < SEARCH_PAGES);

  const limit = typeof maxRead === 'number' && maxRead > 0 ? maxRead : PRESENCE_READ_LIMIT;
  const readNames = names.slice(0, limit);
  const rows = await Promise.all(
    readNames.map(async (name) => {
      try {
        const raw = await kv.get(name, 'json');
        const id = name.slice(PRESENCE_PREFIX.length);
        const ts = raw && typeof raw.ts === 'number' ? raw.ts : 0;
        return { id: id, ts: ts };
      } catch (err) {
        return null;
      }
    })
  );

  const map = {};
  const order = [];
  let onlineCount = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.id) continue;
    const online = row.ts > 0 && now - row.ts <= ONLINE_WINDOW;
    map[row.id] = { ts: row.ts, online: online };
    order.push(row.id);
    if (online) onlineCount++;
  }
  return { map: map, ids: order, onlineCount: onlineCount, truncated: names.length > readNames.length };
}

export async function onRequest(context) {
  const { env, request } = context;

  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });

  const fail = (status, error, code) => json({ ok: false, error, code }, status);

  /* ---------------- 边缘缓存（Cloudflare Cache API） ----------------
   * 只服务管理员 stats / search：同一「接口类型 + 查询词」60 秒内复用结果，
   * 避免后台反复点刷新、反复搜索时把 KV 读次数与 list 配额打满。
   * 缓存键用内部域名 + 路径 + 查询词构造（不同查询词、不同统计类型互不串数据）；
   * 读缓存与写缓存一律发生在管理员密码校验通过之后，未授权请求既不会命中也不会污染缓存。
   * 本地开发或未绑定 caches 时自动退化为直连 KV，行为不变。 */
  const cacheStore = (() => {
    try {
      if (typeof caches !== 'undefined' && caches && caches.default) return caches.default;
    } catch (err) {
      /* 无 Cache API 时忽略 */
    }
    return null;
  })();

  const cacheKeyOf = (kind, q) =>
    'https://' + CACHE_HOST + '/api/accounts/' + kind + (q ? '?q=' + encodeURIComponent(String(q).toLowerCase()) : '');

  const cacheRead = async (key) => {
    if (!cacheStore) return null;
    try {
      const hit = await cacheStore.match(key);
      if (!hit) return null;
      const text = await hit.text();
      return text || null;
    } catch (err) {
      return null;
    }
  };

  const cacheHit = (text) =>
    new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Cealin-Cache': 'hit' }
    });

  const cacheMiss = async (key, payload) => {
    const text = JSON.stringify(payload);
    if (cacheStore) {
      try {
        await cacheStore.put(
          key,
          new Response(text, {
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'public, max-age=' + CACHE_TTL
            }
          })
        );
      } catch (err) {
        /* 缓存写入失败不影响本次返回 */
      }
    }
    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Cealin-Cache': 'miss' }
    });
  };

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

  /* ---------------- 发送邮箱验证码：注册 / 登录二次验证 ---------------- */
  if (action === 'sendCode') {
    const scene = typeof body.scene === 'string' ? body.scene.trim() : '';
    let email = normEmail(body.email);

    if (scene === 'register') {
      if (!email) return fail(400, '请填写邮箱', 'email_required');
      if (!emailOk(email)) return fail(400, '邮箱格式不正确', 'email_bad');
    } else if (scene === 'login') {
      if (!ID_RE.test(id)) return fail(400, '编号格式不正确', 'id_bad');
      let found = null;
      try {
        found = await readAccount(kv, id);
      } catch (err) {
        return fail(500, '服务异常，请稍后重试', 'server');
      }
      if (!found) return fail(401, '编号或密码错误', 'bad_cred');
      const bound = normEmail(found.acc.email);
      // 已绑定邮箱：一律发到绑定邮箱，不接受任意外发；未绑定：使用本次填写的邮箱
      if (bound) email = bound;
      if (!email) return fail(400, '该账号尚未绑定邮箱，请先填写邮箱', 'email_required');
      if (!emailOk(email)) return fail(400, '邮箱格式不正确', 'email_bad');
    } else {
      return fail(400, '不支持的验证码场景，请刷新页面重试', 'scene_bad');
    }

    if (!mailReady(env)) {
      return fail(503, '邮件服务未配置，暂时无法发送验证码', 'mail_not_configured');
    }

    const key = scene === 'register' ? VCODE_REG_PREFIX + email : VCODE_LOGIN_PREFIX + id;
    const issued = await issueCode(kv, key, scene, email);
    if (!issued.ok) {
      if (issued.code === 'code_cooldown') {
        return json({ ok: false, error: '验证码发送过于频繁，请稍后再试', code: 'code_cooldown', wait: issued.wait || VCODE_COOL }, 429);
      }
      if (issued.code === 'code_daily') return fail(429, '该邮箱今日收码次数已达上限，请明天再试', 'code_daily');
      return fail(500, '服务异常，请稍后重试', 'server');
    }

    const sent = await sendMail(
      env,
      email,
      'Cealin 邮箱验证码',
      '你的 Cealin 验证码是 ' + issued.code + '，10 分钟内有效。\n若非本人操作，请忽略本邮件。'
    );
    if (!sent.ok) {
      try { await kv.delete(key); } catch (err) {}
      if (sent.reason === 'mail_not_configured') {
        return fail(503, '邮件服务未配置，暂时无法发送验证码', 'mail_not_configured');
      }
      return fail(502, '验证码发送失败，请稍后重试', 'mail_fail');
    }

    return json({ ok: true, masked: maskEmail(email), cooldown: VCODE_COOL, ttl: VCODE_TTL });
  }

  /* ---------------- 注册：名称 + 密码 + 邮箱验证码 → 分配编号 ---------------- */
  if (action === 'register') {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return fail(400, '请输入名称', 'name_required');
    if (nameLen(name) > NAME_MAX) return fail(400, '名称最多 20 个字符', 'name_long');

    // 注册强制邮箱验证：未配置邮件通道时直接拒绝，避免出现「无验证注册」的口子
    if (!mailReady(env)) return fail(503, '邮件服务未配置，暂时无法注册', 'mail_not_configured');
    const email = normEmail(body.email);
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!email) return fail(400, '请填写邮箱', 'email_required');
    if (!emailOk(email)) return fail(400, '邮箱格式不正确', 'email_bad');
    if (!CODE_RE.test(code)) return fail(400, '请输入 6 位邮箱验证码', 'code_required');
    const codeCheck = await verifyCode(kv, VCODE_REG_PREFIX + email, code);
    if (!codeCheck.ok) {
      if (codeCheck.code === 'server') return fail(500, '服务异常，请稍后重试', 'server');
      return fail(400, '验证码不正确或已失效，请重新获取', 'code_bad');
    }

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
      createdAt: Date.now(),
      email: email
    };
    try {
      await kv.put(KV_PREFIX + newId, JSON.stringify(record));
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }

    // 只回编号、名称与注册时间，哈希与盐不出服务端
    return json({ ok: true, id: newId, name: name, createdAt: record.createdAt });
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

    /* ---- 密码通过后的第二道验证：邮箱验证码 ----
     * 邮件通道未配置时降级为原密码登录（否则全站登录会被锁死）；
     * 通道可用时：已绑邮箱必须验证码正确才放行，未绑邮箱则由本次填写的邮箱完成首次绑定。 */
    if (mailReady(env)) {
      const boundEmail = normEmail(acc.email);
      const inputEmail = normEmail(body.email);
      const code = typeof body.code === 'string' ? body.code.trim() : '';
      const targetEmail = boundEmail || inputEmail;

      if (!targetEmail) {
        return fail(401, '该账号尚未绑定邮箱，请填写邮箱并获取验证码', 'email_required');
      }
      if (!boundEmail && !emailOk(targetEmail)) {
        return fail(400, '邮箱格式不正确', 'email_bad');
      }
      if (!CODE_RE.test(code)) {
        return fail(401, '请输入邮箱验证码', 'code_required');
      }
      const codeCheck = await verifyCode(kv, VCODE_LOGIN_PREFIX + id, code);
      if (!codeCheck.ok) {
        if (codeCheck.code === 'server') return fail(500, '服务异常，请稍后重试', 'server');
        return fail(401, '验证码不正确或已失效，请重新获取', 'code_bad');
      }
      // 首次登录补绑邮箱：验证码已通过，写入账号记录
      if (!boundEmail) {
        acc.email = targetEmail;
        try {
          await kv.put(found.key, JSON.stringify(acc));
        } catch (err) {
          return fail(500, '服务异常，请稍后重试', 'server');
        }
      }
    }

    return json({
      ok: true,
      id: acc.id || id,
      name: acc.name || '',
      official: !!acc.official,
      createdAt: acc.createdAt || 0,
      email: acc.email ? maskEmail(normEmail(acc.email)) : ''
    });
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

    // 用户自主改密成功后立即抹掉重置记录里的临时密码明文
    try {
      await kv.delete(PWD_RESET_PREFIX + (updated.id || id));
    } catch (err) {
      /* 清理失败不影响改密结果，记录仍受 TTL 约束自动过期 */
    }

    // 只回编号与名称，哈希与盐不出服务端；登录态不变，无需重新登录
    return json({ ok: true, id: updated.id || id, name: updated.name || '' });
  }

  /* ---------------- 在线心跳：登录态页面约每 10 分钟上报一次 ----------------
   * 只写 account:presence:{编号} = { id, ts }，并带 1800 秒 TTL 自动回收，
   * 因此离开页面无需额外通知，超过 20 分钟没有心跳即视为离线
   * （判定阈值明显大于心跳间隔，保证用户不会在下一次心跳到来前被判离线）。 */
  if (action === 'heartbeat') {
    if (!ID_RE.test(id)) return fail(400, '编号格式不正确', 'id_bad');

    let found = null;
    try {
      found = await readAccount(kv, id);
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    // 编号不存在时不写心跳键，避免无效数据堆积（前端静默忽略该失败）
    if (!found) return fail(404, '账号不存在', 'id_not_found');

    const realId = found.acc.id || id;
    const ts = Date.now();
    try {
      await kv.put(PRESENCE_PREFIX + realId, JSON.stringify({ id: realId, ts: ts }), {
        expirationTtl: PRESENCE_TTL
      });
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    return json({ ok: true, id: realId, ts: ts, onlineWindow: ONLINE_WINDOW, ttl: PRESENCE_TTL });
  }

  /* ---------------- 管理员：账号列表 / 按编号或名称搜索 ----------------
   * q 留空 → 列出全部账号；q 非空 → 编号（account id）与名称（name）同时参与匹配，
   * 均为「包含即命中」的部分匹配、大小写不敏感。返回结构统一，前端只用一套逻辑。
   * 排序：在线优先 → 组内按最近活跃时间倒序 → 无活跃记录按注册时间倒序。 */
  if (action === 'search') {
    let admin = false;
    try {
      admin = await checkAdmin(kv, password);
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    if (!admin) return fail(401, '密码错误', 'admin_pwd');

    const now = Date.now();
    const q = (typeof body.q === 'string' ? body.q.trim() : '').replace(/^account:/i, '');
    const qLower = q.toLowerCase();

    // 缓存命中直接返回（密码校验已在上方完成）：键含查询词，不同查询词互不干扰
    const cacheKey = cacheKeyOf('search', qLower);
    const cachedSearch = await cacheRead(cacheKey);
    if (cachedSearch) return cacheHit(cachedSearch);

    // 1) 先取在线表（心跳键数量≈近期活跃账号数，通常很小）
    let presence = null;
    try {
      presence = await readPresence(kv, now, PRESENCE_READ_LIMIT);
    } catch (err) {
      presence = { map: {}, ids: [], onlineCount: 0, truncated: false };
    }
    const onlineMap = presence.map;

    // 2) 遍历 account: 前缀键收集编号，跳过 account:presence: 心跳键
    const ids = [];
    let scanned = 0;
    let page = 0;
    let cursor = undefined;
    let keysTruncated = false;
    try {
      while (page < SEARCH_PAGES) {
        const opts = { prefix: KV_PREFIX, limit: SEARCH_PAGE_SIZE };
        if (cursor) opts.cursor = cursor;
        const res = await kv.list(opts);
        const keys = (res && res.keys) || [];
        for (let i = 0; i < keys.length; i++) {
          const name = keys[i] && keys[i].name ? String(keys[i].name) : '';
          if (name.length <= KV_PREFIX.length) continue;
          const aid = name.slice(KV_PREFIX.length);
          if (aid.indexOf('presence:') === 0) continue;
          ids.push(aid);
          if (ids.length >= ACCOUNT_SCAN_MAX) break;
        }
        scanned += keys.length;
        page++;
        if (ids.length >= ACCOUNT_SCAN_MAX) { keysTruncated = true; break; }
        if (!res || res.list_complete) break;
        cursor = res.cursor;
        if (!cursor) break;
      }
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }

    // 3) 读明细（凭据字段 pwdHash / salt 一律不回传）
    const detailIds = ids.slice(0, ACCOUNT_READ_MAX);
    const detailTruncated = ids.length > detailIds.length;
    const records = await Promise.all(
      detailIds.map(async (aid) => {
        try {
          const raw = await kv.get(KV_PREFIX + aid);
          if (!raw) return null;
          const acc = JSON.parse(raw);
          if (!acc || typeof acc !== 'object') return null;
          const realId = acc.id || aid;
          const p = onlineMap[aid] || onlineMap[realId] || null;
          const lastSeen = p && typeof p.ts === 'number' ? p.ts : 0;
          return {
            id: realId,
            name: acc.name || '',
            createdAt: acc.createdAt || 0,
            official: !!acc.official,
            officialAt: acc.officialAt || 0,
            online: !!(p && p.online),
            lastSeen: lastSeen
          };
        } catch (err) {
          return null;
        }
      })
    );

    const all = records.filter(Boolean);

    // 4) 过滤：编号或名称包含查询词即命中
    const matched = all.filter(function (it) {
      if (!qLower) return true;
      if (String(it.id || '').toLowerCase().indexOf(qLower) >= 0) return true;
      return String(it.name || '').toLowerCase().indexOf(qLower) >= 0;
    });

    // 5) 排序：在线优先；组内最近活跃倒序；从未活跃按注册时间倒序
    matched.sort(function (a, b) {
      if (a.online !== b.online) return a.online ? -1 : 1;
      const la = a.lastSeen || 0;
      const lb = b.lastSeen || 0;
      if (la !== lb) return lb - la;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    const accounts = matched.slice(0, SEARCH_LIMIT);

    let onlineCount = 0;
    for (let i = 0; i < all.length; i++) {
      if (all[i].online) onlineCount++;
    }

    return cacheMiss(cacheKey, {
      ok: true,
      accounts: accounts,
      count: accounts.length,
      matched: matched.length,
      total: ids.length,
      online: onlineCount,
      limit: SEARCH_LIMIT,
      query: q,
      scanned: scanned,
      // 列表本身被截断（只展示前 SEARCH_LIMIT 条）
      truncated: matched.length > accounts.length,
      // 数据量超过单请求处理上限，统计/匹配可能不完整
      partial: keysTruncated || detailTruncated || !!presence.truncated,
      // 结果会被边缘缓存复用，最长可能有 60 秒延迟
      cacheTtl: CACHE_TTL
    });
  }

  /* ---------------- 管理员：概览统计 ----------------
   * 在线人数 / 账号总数 / 聊天室数 / 消息总条数 均为真实读取结果；
   * 存储占用为「抽样平均体积 × 键数」的估算值，前端必须标注「估算」。 */
  if (action === 'stats') {
    let admin = false;
    try {
      admin = await checkAdmin(kv, password);
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    if (!admin) return fail(401, '密码错误', 'admin_pwd');

    const now = Date.now();

    // 缓存命中直接返回（密码校验已在上方完成）：统计结果只有一种，键不含查询词
    const cacheKey = cacheKeyOf('stats', '');
    const cachedStats = await cacheRead(cacheKey);
    if (cachedStats) return cacheHit(cachedStats);

    // 1) 遍历全部 KV 键并归类（KV list 每页最多 1000 个键）
    const counts = { account: 0, presence: 0, room: 0, roomSub: 0, suggestion: 0, notice: 0, other: 0 };
    const samples = { account: [], presence: [], room: [], roomSub: [], suggestion: [], notice: [], other: [] };
    const roomCodes = [];
    let kvKeys = 0;
    let cursor = undefined;
    let page = 0;
    try {
      while (page < STATS_PAGES) {
        const opts = { limit: STATS_PAGE_SIZE };
        if (cursor) opts.cursor = cursor;
        const res = await kv.list(opts);
        const keys = (res && res.keys) || [];
        for (let i = 0; i < keys.length; i++) {
          const name = keys[i] && keys[i].name ? String(keys[i].name) : '';
          if (!name) continue;
          const cat = categorizeKey(name);
          counts[cat]++;
          kvKeys++;
          if (samples[cat].length < STATS_SAMPLE_PER_CAT) samples[cat].push(name);
          if (cat === 'room') roomCodes.push(name.slice(5));
        }
        page++;
        if (!res || res.list_complete) { cursor = null; break; }
        cursor = res.cursor;
        if (!cursor) break;
      }
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    const keysTruncated = !!cursor;

    // 2) 在线人数：读心跳表，20 分钟内有心跳算在线
    let presence = null;
    try {
      presence = await readPresence(kv, now, PRESENCE_READ_LIMIT);
    } catch (err) {
      presence = { map: {}, ids: [], onlineCount: 0, truncated: false };
    }

    // 3) 聊天室：读主键拿消息条数（顺带作为 room 类体积样本）
    const roomReadCodes = roomCodes.slice(0, STATS_ROOM_READ_MAX);
    let messages = 0;
    const roomBytes = [];
    const roomRows = await Promise.all(
      roomReadCodes.map(async (code) => {
        try {
          const raw = await kv.get('room:' + code);
          if (!raw) return { count: 0, bytes: 0 };
          let arr = null;
          try {
            arr = JSON.parse(raw);
          } catch (e) {
            arr = null;
          }
          return { count: Array.isArray(arr) ? arr.length : 0, bytes: byteLen('room:' + code) + byteLen(raw) };
        } catch (err) {
          return { count: 0, bytes: 0 };
        }
      })
    );
    for (let i = 0; i < roomRows.length; i++) {
      messages += roomRows[i].count;
      if (roomRows[i].bytes > 0) roomBytes.push(roomRows[i].bytes);
    }

    // 4) 抽样估算平均单键体积（key + value 字节数）
    const avgBytes = {};
    let sampleCount = 0;
    let sampleTotal = 0;
    const cats = ['account', 'roomSub', 'suggestion', 'notice', 'other'];
    for (let c = 0; c < cats.length; c++) {
      const cat = cats[c];
      if (!counts[cat] || !samples[cat].length) continue;
      const vals = await Promise.all(
        samples[cat].map(async (name) => {
          try {
            const raw = await kv.get(name);
            return byteLen(name) + byteLen(raw);
          } catch (err) {
            return 0;
          }
        })
      );
      let total = 0;
      let n = 0;
      for (let i = 0; i < vals.length; i++) {
        if (vals[i] > 0) { total += vals[i]; n++; }
      }
      if (n) {
        avgBytes[cat] = total / n;
        sampleTotal += total;
        sampleCount += n;
      }
    }
    // 心跳键体积几乎固定（{id,ts}），不额外读取，按固定结构估算
    if (counts.presence) {
      avgBytes.presence = PRESENCE_PREFIX.length + 10 + 48;
    }
    // 房间主键体积用上面读房间时的样本
    if (roomBytes.length) {
      let total = 0;
      for (let i = 0; i < roomBytes.length; i++) total += roomBytes[i];
      avgBytes.room = total / roomBytes.length;
    }

    const globalAvg = sampleCount ? sampleTotal / sampleCount : 0;
    let estimatedBytes = 0;
    const catNames = Object.keys(counts);
    for (let i = 0; i < catNames.length; i++) {
      const cat = catNames[i];
      const avg = avgBytes[cat] || globalAvg || 0;
      estimatedBytes += counts[cat] * avg;
    }

    return cacheMiss(cacheKey, {
      ok: true,
      now: now,
      accounts: {
        total: counts.account,
        online: presence.onlineCount,
        offline: Math.max(0, counts.account - presence.onlineCount),
        presenceKeys: counts.presence
      },
      rooms: {
        total: counts.room,
        // 消息总条数为抽样估算：只累加前 STATS_ROOM_READ_MAX 个房间的实际条数
        messages: messages,
        // 按抽样均值外推到全部房间的估算总量（仅供容量判断，非精确值）
        messagesEstimate: roomReadCodes.length
          ? Math.round((messages / roomReadCodes.length) * counts.room)
          : 0,
        counted: roomReadCodes.length,
        readMax: STATS_ROOM_READ_MAX,
        estimate: roomReadCodes.length < counts.room
      },
      kv: {
        keys: kvKeys,
        byCategory: counts,
        estimatedBytes: Math.round(estimatedBytes),
        sampledKeys: sampleCount,
        estimate: true
      },
      limits: {
        onlineWindow: ONLINE_WINDOW,
        presenceTtl: PRESENCE_TTL,
        listPageMax: STATS_PAGES * STATS_PAGE_SIZE,
        roomReadMax: STATS_ROOM_READ_MAX,
        cacheTtl: CACHE_TTL
      },
      // 房间数超过抽样上限不算「数据不完整」：消息数已由 rooms.estimate 明确标注为抽样估算
      truncated: keysTruncated || !!presence.truncated
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

  /* ---------------- 用户：提交密码重置申请 ----------------
   * 登录页「忘记密码」提交后只写 pwdreset:{id}，作为待处理申请通知管理员；
   * 不改动账号任何密码字段，所以光凭编号无法劫持他人账号。 */
  if (action === 'resetRequest') {
    if (!ID_RE.test(id)) return fail(400, '请输入正确的账号编号', 'id_bad');

    let found = null;
    try {
      found = await readAccount(kv, id);
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    if (!found) return fail(404, '该编号不存在，请检查后重试', 'id_not_found');

    const realId = found.acc.id || id;
    const key = PWD_RESET_PREFIX + realId;
    const now = Date.now();

    let existing = null;
    try {
      const raw = await kv.get(key);
      if (raw) existing = JSON.parse(raw);
    } catch (err) {
      existing = null;
    }

    // 已生成临时密码：原样保留，避免把管理员看过的密码覆盖掉
    if (existing && existing.status === 'done' && existing.tempPwd) {
      return json({
        ok: true, id: realId, status: 'done', already: true,
        reqAt: existing.reqAt || 0, doneAt: existing.doneAt || 0
      });
    }
    // 短时间内的重复提交：只回执，不重复写 KV
    if (existing && existing.status !== 'done' && now - (existing.reqAt || 0) < PWD_RESET_MIN_GAP) {
      return json({ ok: true, id: realId, status: 'pending', already: true, reqAt: existing.reqAt || now });
    }

    const record = { id: realId, name: found.acc.name || '', reqAt: now, status: 'pending' };
    try {
      await kv.put(key, JSON.stringify(record), { expirationTtl: PWD_RESET_TTL });
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    return json({ ok: true, id: realId, status: 'pending', already: false, reqAt: now });
  }

  /* ---------------- 管理员：密码重置申请列表 ----------------
   * 只返回编号 / 名称 / 申请时间 / 状态 / 已生成的临时密码（如有），
   * 账号的 pwdHash 与 salt 一律不出服务端。 */
  if (action === 'resetList') {
    let admin = false;
    try {
      admin = await checkAdmin(kv, password);
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    if (!admin) return fail(401, '密码错误', 'admin_pwd');

    let keys = [];
    try {
      const res = await kv.list({ prefix: PWD_RESET_PREFIX, limit: 200 });
      keys = (res && res.keys) || [];
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }

    const rows = await Promise.all(
      keys.map(async (k) => {
        const name = k && k.name ? String(k.name) : '';
        if (name.length <= PWD_RESET_PREFIX.length) return null;
        try {
          const raw = await kv.get(name);
          if (!raw) return null;
          const it = JSON.parse(raw);
          if (!it || typeof it !== 'object') return null;
          return {
            id: it.id || name.slice(PWD_RESET_PREFIX.length),
            name: it.name || '',
            reqAt: it.reqAt || 0,
            status: it.status === 'done' ? 'done' : 'pending',
            tempPwd: typeof it.tempPwd === 'string' ? it.tempPwd : '',
            doneAt: it.doneAt || 0
          };
        } catch (err) {
          return null;
        }
      })
    );

    const items = rows.filter(Boolean);
    items.sort(function (a, b) { return (b.reqAt || 0) - (a.reqAt || 0); });
    return json({ ok: true, items: items, count: items.length, ttl: PWD_RESET_TTL });
  }

  /* ---------------- 管理员：为指定编号生成临时密码 ----------------
   * 用新盐 + 新哈希覆盖账号密码（登录逻辑无需改动），并把明文暂存进重置记录供管理员查看；
   * 明文只在 7 天内有效，用户自行改密后立即删除。 */
  if (action === 'resetTemp') {
    let admin = false;
    try {
      admin = await checkAdmin(kv, password);
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    if (!admin) return fail(401, '密码错误', 'admin_pwd');

    if (!ID_RE.test(id)) return fail(400, '编号格式不正确', 'id_bad');

    let found = null;
    try {
      found = await readAccount(kv, id);
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    if (!found) return fail(404, '账号不存在', 'id_not_found');

    const now = Date.now();
    const realId = found.acc.id || id;
    const tempPwd = makeTempPwd();
    const nextSalt = randomHex(16);
    const nextHash = await hashPassword(nextSalt, tempPwd);

    const updated = Object.assign({}, found.acc, {
      id: realId,
      pwdHash: nextHash,
      salt: nextSalt,
      pwdChangedAt: now,
      pwdResetAt: now
    });
    try {
      await kv.put(found.key, JSON.stringify(updated));
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }

    const key = PWD_RESET_PREFIX + realId;
    let reqAt = now;
    try {
      const raw = await kv.get(key);
      if (raw) {
        const old = JSON.parse(raw);
        if (old && old.reqAt) reqAt = old.reqAt;
      }
    } catch (err) {
      /* 无历史申请时按当前时间记录 */
    }

    const record = {
      id: realId,
      name: updated.name || '',
      reqAt: reqAt,
      status: 'done',
      tempPwd: tempPwd,
      doneAt: now
    };
    try {
      await kv.put(key, JSON.stringify(record), { expirationTtl: PWD_RESET_TTL });
    } catch (err) {
      // 记录写入失败时密码已经改掉：如实告知，避免用户以为可以查看旧密码
      return fail(500, '密码已重置但记录写入失败，请刷新后重新生成', 'reset_record');
    }

    return json({
      ok: true,
      id: realId,
      name: updated.name || '',
      tempPwd: tempPwd,
      doneAt: now,
      expiresAt: now + PWD_RESET_TTL * 1000
    });
  }

  /* ---------------- 管理员：删除重置记录（同时抹掉临时密码明文） ---------------- */
  if (action === 'resetDrop') {
    let admin = false;
    try {
      admin = await checkAdmin(kv, password);
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    if (!admin) return fail(401, '密码错误', 'admin_pwd');

    if (!ID_RE.test(id)) return fail(400, '编号格式不正确', 'id_bad');
    try {
      await kv.delete(PWD_RESET_PREFIX + id);
    } catch (err) {
      return fail(500, '服务异常，请稍后重试', 'server');
    }
    return json({ ok: true, id: id });
  }

  return fail(400, '未知的操作类型', 'unknown_action');
}
