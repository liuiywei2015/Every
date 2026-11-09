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

// ---------- AI 预审配置（Workers AI，见 wrangler.toml 的 [ai] binding="AI"） ----------
const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const AI_BATCH_MAX = 3;      // 单次请求最多预审条数，避免函数超时
const AI_TEXT_MAX = 700;     // 送模型的正文/举报文本上限
const AI_REASON_MAX = 160;   // 回写 AI 理由长度上限

function hasAI(env) {
  return !!(env && env.AI && typeof env.AI.run === 'function');
}

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

// ---------- AI 预审 ----------

// 取被举报文章的标题与正文开头，作为判定依据
async function readArticleBrief(env, id) {
  try {
    const art = await env.GUESTBOOK.get(PREFIX_ARTICLE + id, 'json');
    if (!art || typeof art !== 'object') return '';
    const title = trimStr(art.title).slice(0, 120);
    let body = trimStr(art.content) || trimStr(art.body) || trimStr(art.text);
    body = body.replace(/\s+/g, ' ').slice(0, AI_TEXT_MAX);
    return [title, body].filter(Boolean).join('\n');
  } catch (err) {
    return '';
  }
}

// 从模型输出里抠出第一个 JSON 对象，容忍前后多余文字
function extractJson(text) {
  if (!text) return null;
  const s = String(text);
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try {
    return JSON.parse(s.slice(i, j + 1));
  } catch (err) {
    return null;
  }
}

// 统一取出模型返回的判定对象：Workers AI 在模型输出 JSON 时会直接给对象，
// 也可能给字符串或 OpenAI chat.completion 结构（choices[0].message.content）
function extractAiPayload(res) {
  if (!res || typeof res !== 'object') return null;
  const pick = (v) => {
    if (!v) return null;
    if (typeof v === 'object') return v;
    if (typeof v === 'string') return extractJson(v) || { _text: v };
    return null;
  };
  let out = pick(res.response);
  if (!out && res.choices && res.choices[0] && res.choices[0].message) {
    out = pick(res.choices[0].message.content);
  }
  if (!out) out = pick(res.result);
  return out;
}

const AI_SYSTEM = [
  '你是中文社区内容审核助手，负责判断一条用户举报所指的内容是否确实违规。',
  '判断标准：violation=true 表示被举报内容确实违反社区规范、需要处置；violation=false 表示未违规或证据不足。',
  '违规类型包括：垃圾广告与刷屏、辱骂人身攻击、色情低俗、违法违规、侵权盗用、聊天室违规。',
  '证据不足时必须给 violation=false，并在 reason 里说明缺少什么证据。',
  'reason 用中文，客观陈述判断依据，不要复述举报原文。',
  '只输出一行 JSON，不要解释、不要 markdown 代码块，格式：',
  '{"violation":true,"confidence":0-100,"reason":"不超过60字的中文理由"}'
].join('\n');

async function aiJudge(env, item) {
  let ctx = '';
  if (item.targetType === 'article') ctx = await readArticleBrief(env, item.targetId);

  const lines = [
    '举报对象类型：' + item.targetType,
    '举报对象标识：' + item.targetId,
    '举报理由：' + (item.reason || ''),
    '举报补充说明：' + (item.detail || '（无）')
  ];
  if (ctx) lines.push('被举报内容：\n' + ctx);
  else if (item.targetType === 'article') lines.push('被举报内容：未能读取到正文，仅依据举报描述判断');

  const res = await env.AI.run(AI_MODEL, {
    messages: [
      { role: 'system', content: AI_SYSTEM },
      { role: 'user', content: lines.join('\n') }
    ],
    max_tokens: 300,
    temperature: 0.1
  });

  const payload = extractAiPayload(res);

  let verdict = 'reject';
  let score = 50;
  let reason = '';

  if (payload) {
    // violation=true → 举报成立，对应后台的 pass（执行处置）
    const rawV = payload.violation;
    let violated = null;
    if (rawV === true) violated = true;
    else if (rawV === false) violated = false;
    else if (typeof rawV === 'string') {
      const s = rawV.toLowerCase();
      if (s === 'true' || s === 'yes' || s === '1') violated = true;
      else if (s === 'false' || s === 'no' || s === '0') violated = false;
    }
    // 兼容模型仍回 verdict 字段的情况
    if (violated === null) {
      const v = trimStr(payload.verdict).toLowerCase();
      if (v === 'pass') violated = true;
      else if (v === 'reject') violated = false;
    }
    if (violated !== null) verdict = violated ? 'pass' : 'reject';

    const sc = Number(payload.confidence !== undefined ? payload.confidence : payload.score);
    if (!isNaN(sc)) score = Math.max(0, Math.min(100, Math.round(sc)));
    reason = trimStr(payload.reason);
    if (!reason && payload._text) reason = trimStr(payload._text);
    reason = reason.slice(0, AI_REASON_MAX);
  }

  if (!reason) {
    reason = '未能解析模型输出，请人工复核';
    score = 0;
  }

  return { verdict: verdict, score: score, reason: reason, model: AI_MODEL, at: Date.now() };
}

async function handleAiReview(env, body) {
  const denied = await requireAdmin(env, body);
  if (denied) return denied;

  if (!hasAI(env)) {
    return fail(503, '未启用 AI 审核：缺少 Workers AI 绑定（变量名需为 AI）', 'no_ai');
  }

  const index = await readIndex(env);
  const singleId = trimStr(body.id);
  const ids = Array.isArray(body.ids) ? body.ids.map((x) => trimStr(x)).filter(Boolean) : [];

  let targets = [];
  if (singleId) {
    targets = index.filter((it) => it && it.id === singleId);
  } else if (ids.length) {
    targets = index.filter((it) => it && ids.indexOf(it.id) >= 0);
  } else {
    targets = index.filter((it) => it && it.status === 'pending');
  }
  targets = targets.slice(0, AI_BATCH_MAX);

  if (!targets.length) {
    const counts = { total: index.length, pending: 0, passed: 0, rejected: 0 };
    for (let i = 0; i < index.length; i++) {
      const st = index[i] && index[i].status;
      if (counts[st] !== undefined) counts[st] += 1;
    }
    return ok({ reviewed: 0, reports: index, counts: counts });
  }

  let reviewed = 0;
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    let ai;
    try {
      ai = await aiJudge(env, target);
    } catch (err) {
      ai = {
        verdict: '',
        score: 0,
        reason: 'AI 判定失败：' + String((err && err.message) || err).slice(0, 100),
        model: AI_MODEL,
        at: Date.now(),
        error: true
      };
    }
    if (!ai.error) reviewed += 1;

    for (let k = 0; k < index.length; k++) {
      if (index[k] && index[k].id === target.id) {
        index[k].ai = ai;
        break;
      }
    }
  }

  // 批量写回：索引 + 单条详情
  await writeIndex(env, index);
  const puts = [];
  for (let i = 0; i < targets.length; i++) {
    const fresh = index.filter((it) => it && it.id === targets[i].id)[0];
    if (fresh) puts.push(env.GUESTBOOK.put(reportKey(fresh.id), JSON.stringify(fresh)));
  }
  if (puts.length) await Promise.all(puts);

  const counts = { total: index.length, pending: 0, passed: 0, rejected: 0 };
  for (let i = 0; i < index.length; i++) {
    const st = index[i] && index[i].status;
    if (counts[st] !== undefined) counts[st] += 1;
  }

  return ok({ reviewed: reviewed, reports: index, counts: counts });
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
    if (action === 'aiReview') return await handleAiReview(env, body);
  } catch (err) {
    return fail(500, '服务异常，请稍后重试', 'server');
  }

  return fail(400, '未知操作', 'unknown_action');
}
