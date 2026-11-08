// Cloudflare Pages Function: /api/reports
// 举报中心后端接口（用户提交举报 / 管理员审核处理）
//
// POST /api/reports  body.action 取值：
//   submit  公开：提交举报（targetType=article|room|account，targetId、reason、detail、reporterId）
//   list    管理员：举报列表（可按 status 过滤，默认全部，新举报在前，附各状态计数）
//   handle  管理员：处理单条举报（id + decision=pass|reject + note）
//            pass 时按对象类型联动：article -> 文章状态置 rejected（下架）；
//            room -> room:{code}:status 标记 banned；account -> 仅记录处理结果，不封号
//
// KV key 约定（绑定名 GUESTBOOK，见 wrangler.toml）：
//   reports        -> 举报索引数组 [{ id, targetType, targetId, reason, detail, reporterId,
//                       status, decision, note, effect, createdAt, handledAt }]
//                       最多 500 条，新举报 unshift 到最前
//   report:{id}    -> 单条举报（字段同上）
//   report:dup:{targetType}:{targetId}:{reporterId} -> 同一用户对同一对象 24 小时内只受理一次（TTL 86400）
//
// status 取值：pending（待处理）/ passed（举报通过）/ rejected（举报驳回）
// 管理员密码校验方式与 admin-rooms.js / articles.js 保持一致（env.GUESTBOOK.get('admin_pwd')）。

const DEFAULT_ADMIN_PWD = 'liuyiwei150314';

const KEY_INDEX = 'reports';
const PREFIX_REPORT = 'report:';
const INDEX_MAX = 500;
const DUP_TTL = 86400; // 24 小时

const KEY_ARTICLE_INDEX = 'article:index';
const PREFIX_ARTICLE = 'article:';
const PREFIX_ROOM = 'room:';

// 字段约束（接口侧二次校验，不依赖前端）
const TARGET_MAX_LEN = 80;
const REASON_MAX_LEN = 200;
const DETAIL_MAX_LEN = 500;
const REPORTER_MAX_LEN = 40;
const NOTE_MAX_LEN = 200;

const TARGET_SET = { article: 1, room: 1, account: 1 };
const STATUS_SET = { pending: 1, passed: 1, rejected: 1 };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function fail(status, error, code) {
  const body = { ok: false, error };
  if (code) body.code = code;
  return json(body, status);
}

function ok(data) {
  return json({ ok: true, data });
}

function str(v) {
  return typeof v === 'string' ? v : '';
}

function trimStr(v) {
  return str(v).replace(/^\s+|\s+$/g, '');
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function getAdminPwd(env) {
  try {
    return (await env.GUESTBOOK.get('admin_pwd')) || DEFAULT_ADMIN_PWD;
  } catch (err) {
    return DEFAULT_ADMIN_PWD;
  }
}

// 管理员密码校验：与 admin-rooms.js / articles.js 写法一致，失败直接返回 Response
async function requireAdmin(env, body) {
  const adminPwd = await getAdminPwd(env);
  const password = trimStr(body.password) || trimStr(body.pwd);
  if (!password) return fail(401, '需要管理员密码', 'no_pwd');
  if (password !== adminPwd) return fail(401, '密码错误', 'bad_pwd');
  return null;
}

async function readIndex(env) {
  let raw = null;
  try {
    raw = await env.GUESTBOOK.get(KEY_INDEX, 'json');
  } catch (err) {
    raw = null;
  }
  return Array.isArray(raw) ? raw : [];
}

async function writeIndex(env, list) {
  const cut = list.length > INDEX_MAX ? list.slice(0, INDEX_MAX) : list;
  await env.GUESTBOOK.put(KEY_INDEX, JSON.stringify(cut));
}

function reportKey(id) {
  return PREFIX_REPORT + id;
}

// 单条 + 索引一次并行写入
async function writeReport(env, item, index) {
  await Promise.all([
    env.GUESTBOOK.put(reportKey(item.id), JSON.stringify(item)),
    env.GUESTBOOK.put(KEY_INDEX, JSON.stringify(index.slice(0, INDEX_MAX)))
  ]);
}

// ---------- 举报：提交 ----------

async function handleSubmit(env, body) {
  const targetType = trimStr(body.targetType) || 'article';
  if (!TARGET_SET[targetType]) return fail(400, '举报对象类型不合法', 'bad_type');

  const targetId = trimStr(body.targetId);
  if (!targetId) return fail(400, '缺少举报对象标识', 'no_target');
  if (targetId.length > TARGET_MAX_LEN) return fail(400, '举报对象标识过长', 'target_too_long');

  const reason = trimStr(body.reason);
  if (!reason) return fail(400, '请选择举报原因', 'no_reason');
  if (reason.length > REASON_MAX_LEN) return fail(400, '举报原因过长', 'reason_too_long');

  let detail = trimStr(body.detail);
  if (detail.length > DETAIL_MAX_LEN) detail = detail.slice(0, DETAIL_MAX_LEN);

  let reporterId = trimStr(body.reporterId);
  if (reporterId.length > REPORTER_MAX_LEN) reporterId = reporterId.slice(0, REPORTER_MAX_LEN);

  // 24 小时内同一用户对同一对象只受理一次，避免重复刷单
  const dupKey = reporterId
    ? 'report:dup:' + targetType + ':' + targetId + ':' + reporterId
    : '';

  if (dupKey) {
    let existed = null;
    try {
      existed = await env.GUESTBOOK.get(dupKey);
    } catch (err) {
      existed = null;
    }
    if (existed) return ok({ id: existed, duplicate: true, status: 'pending' });
  }

  const now = Date.now();
  const id = 'r' + genId();
  const item = {
    id: id,
    targetType: targetType,
    targetId: targetId,
    reason: reason,
    detail: detail,
    reporterId: reporterId,
    status: 'pending',
    decision: '',
    note: '',
    effect: '',
    createdAt: now,
    handledAt: 0
  };

  const index = await readIndex(env);
  index.unshift(item);
  if (index.length > INDEX_MAX) index.length = INDEX_MAX;

  await writeReport(env, item, index);

  if (dupKey) {
    try {
      await env.GUESTBOOK.put(dupKey, id, { expirationTtl: DUP_TTL });
    } catch (err) {
      // 去重键写入失败不影响举报受理
    }
  }

  return ok({ id: id, duplicate: false, status: 'pending', report: item });
}

// ---------- 举报：列表 ----------

async function handleList(env, body) {
  const denied = await requireAdmin(env, body);
  if (denied) return denied;

  const status = trimStr(body.status);
  if (status && !STATUS_SET[status]) return fail(400, '举报状态不合法', 'bad_status');

  const index = await readIndex(env);
  const counts = { total: index.length, pending: 0, passed: 0, rejected: 0 };
  for (let i = 0; i < index.length; i++) {
    const st = index[i] && index[i].status;
    if (counts[st] === undefined) continue;
    counts[st] += 1;
  }

  const list = status ? index.filter((it) => it && it.status === status) : index.slice(0);
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return ok({ reports: list, counts: counts, status: status || 'all' });
}

// ---------- 举报：处理 ----------

// 文章下架：状态置 rejected，并同步 article:index 摘要
async function rejectArticle(env, articleId, note, now) {
  const key = PREFIX_ARTICLE + articleId;
  let art = null;
  try {
    art = await env.GUESTBOOK.get(key, 'json');
  } catch (err) {
    art = null;
  }
  if (!art || typeof art !== 'object') return 'article_missing';

  art.status = 'rejected';
  art.reviewedAt = now;
  art.rejectReason = note || '举报核实：内容违规';
  art.updatedAt = now;

  let index = [];
  try {
    const raw = await env.GUESTBOOK.get(KEY_ARTICLE_INDEX, 'json');
    if (Array.isArray(raw)) index = raw;
  } catch (err) {
    index = [];
  }
  for (let i = 0; i < index.length; i++) {
    const it = index[i];
    if (it && it.id === articleId) {
      it.status = 'rejected';
      it.updatedAt = now;
      break;
    }
  }

  await Promise.all([
    env.GUESTBOOK.put(key, JSON.stringify(art)),
    index.length ? env.GUESTBOOK.put(KEY_ARTICLE_INDEX, JSON.stringify(index)) : Promise.resolve()
  ]);

  return 'article_rejected';
}

// 聊天室封禁：room:{code}:status 标记 banned（结构参照 admin-rooms.js 的 ban 分支）
async function banRoom(env, code, now) {
  const key = PREFIX_ROOM + code + ':status';
  let st = null;
  try {
    st = await env.GUESTBOOK.get(key, 'json');
  } catch (err) {
    st = null;
  }
  if (!st || typeof st !== 'object') st = {};

  st.banned = true;
  st.bannedAt = now;
  st.reported = true;
  st.reportedAt = st.reportedAt || now;
  st.reportHandledAt = now;

  await env.GUESTBOOK.put(key, JSON.stringify(st));
  return 'room_banned';
}

async function handleHandle(env, body) {
  const denied = await requireAdmin(env, body);
  if (denied) return denied;

  const id = trimStr(body.id);
  if (!id) return fail(400, '缺少举报编号', 'no_id');

  const decision = trimStr(body.decision);
  if (decision !== 'pass' && decision !== 'reject') {
    return fail(400, '处理结论只能是 pass 或 reject', 'bad_decision');
  }

  let note = trimStr(body.note);
  if (note.length > NOTE_MAX_LEN) note = note.slice(0, NOTE_MAX_LEN);

  const index = await readIndex(env);
  let pos = -1;
  for (let i = 0; i < index.length; i++) {
    if (index[i] && index[i].id === id) {
      pos = i;
      break;
    }
  }
  if (pos < 0) return fail(404, '举报不存在或已被清理', 'not_found');

  const item = index[pos];
  if (item.status && item.status !== 'pending') {
    return fail(409, '该举报已处理', 'already_handled');
  }

  const now = Date.now();
  let effect = '';

  if (decision === 'pass') {
    if (item.targetType === 'article') {
      effect = await rejectArticle(env, item.targetId, note, now);
    } else if (item.targetType === 'room') {
      effect = await banRoom(env, item.targetId, now);
    } else if (item.targetType === 'account') {
      // 账号类举报只记录处理结果，不做封号动作
      effect = 'account_noted';
    } else {
      effect = 'unknown_type';
    }
  } else {
    effect = 'none';
  }

  item.status = decision === 'pass' ? 'passed' : 'rejected';
  item.decision = decision;
  item.note = note;
  item.effect = effect;
  item.handledAt = now;

  index[pos] = item;
  await writeReport(env, item, index);

  return ok({ report: item, effect: effect });
}

// ---------- 入口 ----------

export async function onRequest(context) {
  const { env, request } = context;

  if (!env || !env.GUESTBOOK) {
    return fail(500, '服务未正确配置 KV 绑定', 'no_kv');
  }

  if (request.method !== 'POST') {
    return fail(405, '不支持的请求方法', 'method');
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return fail(400, '请求体不是合法的 JSON', 'bad_json');
  }
  if (!body || typeof body !== 'object') body = {};

  const action = trimStr(body.action) || 'list';

  try {
    if (action === 'submit') return await handleSubmit(env, body);
    if (action === 'list') return await handleList(env, body);
    if (action === 'handle') return await handleHandle(env, body);
  } catch (err) {
    return fail(500, '服务异常，请稍后重试', 'server');
  }

  return fail(400, '未知操作', 'unknown_action');
}
