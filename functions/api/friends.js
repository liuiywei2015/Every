// Cloudflare Pages Function: /api/friends
// 好友关系：按编号精确搜索、发起申请（带验证语）、同意 / 拒绝、好友列表（含每会话未读数）、删除好友、标记已读
//
// 动作（POST，请求体 { action, ... }；也支持 GET ?action=...&id=...）：
//   { action: 'search', id }             精确搜索编号 → { user, relation }
//   { action: 'request', id, to, msg }   发起好友申请（msg 为验证语，可空）
//   { action: 'accept', id, from }       同意申请（双向写入好友关系）
//   { action: 'reject', id, from }       拒绝申请
//   { action: 'list', id }               好友列表 + 待处理申请（含未读数与最后一条消息预览）
//   { action: 'remove', id, peer }       删除好友（双向解除）
//   { action: 'read', id, peer }         写入「已进入与 peer 的会话」基准时间（未读数清零）
//
// 键空间（KV 绑定名 GUESTBOOK，统一 friend: 前缀，与 room: / account: / article: 互不冲突）：
//   friend:list:{id}           -> { ids: [编号...], ts }        互为好友的编号列表（同意后双向写入）
//   friend:req:{toId}:{fromId} -> { from, name, official, msg, ts }  待处理申请，TTL 30 天自动回收
//   friend:read:{id}           -> { peerId: 'ISO 时间' }        各会话已读基准（进入会话 / 停留时写入）
//   friend:dm:{a}~{b}          -> [ { id, from, name, text, img, time } ]  私聊消息（由 dm.js 维护）
//   account:{id} / account:presence:{id}  只读复用账号与在线状态
//
// 写入预算（KV 免费额度：写 1000 次/天、读 100000 次/天）：
//   本接口的搜索 / 列表 / 已读基准读取全部只读，轮询不产生写入；
//   写入只发生在用户动作上：发申请 1 次、同意 3 次（2 份名单 + 删申请）、拒绝 1 次、删除 3 次、标记已读 1 次，
//   与人工操作次数同阶，正常使用远低于配额。

const KV_ACCOUNT = 'account:';
const KV_PRESENCE = 'account:presence:';
const FRIEND_LIST = 'friend:list:';
const FRIEND_REQ = 'friend:req:';
const FRIEND_READ = 'friend:read:';
const DM_PREFIX = 'friend:dm:';

const ID_RE = /^[A-Za-z0-9@]{6,8}$/;
const VERIFY_MAX = 60;        // 验证语上限（一句）
const REQ_TTL = 30 * 24 * 3600;  // 申请 30 天未处理自动回收
const MAX_FRIENDS = 60;       // 好友数量上限（控制列表轮询的读取次数）
const REQ_LIST_MAX = 50;      // 一次最多展示 50 条待处理申请
const ONLINE_WINDOW = 20 * 60 * 1000;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function fail(status, error, code) {
  return json({ ok: false, error: error, code: code }, status);
}

function trim(v) {
  return String(v === undefined || v === null ? '' : v).replace(/^\s+|\s+$/g, '');
}

// 读取账号：命中返回账号对象，未命中返回 null
// 历史 6 位编号为大写，用户小写输入时回退到大写键再查一次（与 accounts.js 一致）
async function readAccount(kv, id) {
  if (!id) return null;
  let raw = await kv.get(KV_ACCOUNT + id, 'json');
  if (!raw && id.length === 6 && /^[a-z0-9]+$/.test(id)) {
    raw = await kv.get(KV_ACCOUNT + id.toUpperCase(), 'json');
  }
  if (!raw || typeof raw !== 'object') return null;
  return raw;
}

async function isOnline(kv, id, now) {
  const raw = await kv.get(KV_PRESENCE + id, 'json');
  const ts = raw && typeof raw.ts === 'number' ? raw.ts : 0;
  return ts > 0 && now - ts <= ONLINE_WINDOW;
}

// 私聊消息键：两端编号按字典序排列，保证 a 与 b 打开的是同一个键
function dmKey(a, b) {
  return DM_PREFIX + (a < b ? a + '~' + b : b + '~' + a);
}

async function friendIds(kv, id) {
  const raw = await kv.get(FRIEND_LIST + id, 'json');
  const ids = raw && Array.isArray(raw.ids) ? raw.ids : [];
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    const v = trim(ids[i]);
    if (v && out.indexOf(v) === -1) out.push(v);
  }
  return out;
}

async function writeFriendIds(kv, id, ids) {
  await kv.put(FRIEND_LIST + id, JSON.stringify({ ids: ids, ts: new Date().toISOString() }));
}

function publicUser(acc, online) {
  return {
    id: acc.id || '',
    name: acc.name || acc.id || '',
    official: !!acc.official,
    online: !!online
  };
}

/* ---------------- search：按编号精确搜索 ---------------- */
async function handleSearch(env, me, target) {
  const kv = env.GUESTBOOK;
  const id = trim(target);
  if (!ID_RE.test(id)) return fail(400, '请输入正确的账号编号', 'noid');
  if (id === me) {
    // 自己搜自己：直接返回本人信息，前端提示「这是你自己的编号」
    const self = await readAccount(kv, me);
    return json({ ok: true, user: publicUser(self || { id: me }, true), relation: 'self' });
  }
  const acc = await readAccount(kv, id);
  if (!acc) return fail(404, '未找到该编号对应的账号', 'notfound');
  const realId = acc.id || id;
  const now = Date.now();
  const online = await isOnline(kv, realId, now);

  const ids = await friendIds(kv, me);
  let relation = 'none';
  if (ids.indexOf(realId) !== -1) {
    relation = 'friend';
  } else {
    // 我先申请过对方 → outgoing；对方先申请我 → incoming（前端提示去下方处理）
    const out = await kv.get(FRIEND_REQ + realId + ':' + me);
    if (out) {
      relation = 'outgoing';
    } else {
      const inc = await kv.get(FRIEND_REQ + me + ':' + realId);
      if (inc) relation = 'incoming';
    }
  }
  return json({ ok: true, user: publicUser(acc, online), relation: relation });
}

/* ---------------- request：发起好友申请 ---------------- */
async function handleRequest(env, me, to, msg) {
  const kv = env.GUESTBOOK;
  const target = trim(to);
  if (!ID_RE.test(target)) return fail(400, '请输入正确的账号编号', 'noid');
  if (target === me) return fail(400, '不能添加自己为好友', 'self');

  const acc = await readAccount(kv, target);
  if (!acc) return fail(404, '未找到该编号对应的账号', 'notfound');
  const realTo = acc.id || target;

  const mine = await friendIds(kv, me);
  if (mine.indexOf(realTo) !== -1) return fail(400, '你们已经是好友了', 'already');
  if (mine.length >= MAX_FRIENDS) return fail(400, '好友数量已达上限', 'limit');

  const existed = await kv.get(FRIEND_REQ + realTo + ':' + me);
  if (existed) return fail(400, '已发送过申请，请等待对方同意', 'repeat');

  const incoming = await kv.get(FRIEND_REQ + me + ':' + realTo);
  if (incoming) return fail(400, '对方已向你提出申请，请直接同意', 'incoming');

  const my = await readAccount(kv, me);
  const body = {
    from: me,
    name: (my && my.name) || me,
    official: !!(my && my.official),
    msg: trim(msg).slice(0, VERIFY_MAX),
    ts: new Date().toISOString()
  };
  await kv.put(FRIEND_REQ + realTo + ':' + me, JSON.stringify(body), { expirationTtl: REQ_TTL });
  return json({ ok: true, request: body });
}

/* ---------------- accept / reject：处理申请 ---------------- */
async function handleAccept(env, me, from) {
  const kv = env.GUESTBOOK;
  const who = trim(from);
  const raw = await kv.get(FRIEND_REQ + me + ':' + who, 'json');
  if (!raw) return fail(404, '该申请已不存在', 'noreq');
  const acc = await readAccount(kv, who);
  if (!acc) {
    await kv.delete(FRIEND_REQ + me + ':' + who);
    return fail(404, '对方账号已不存在', 'notfound');
  }
  const peerId = acc.id || who;

  const mine = await friendIds(kv, me);
  const theirs = await friendIds(kv, peerId);
  if (mine.indexOf(peerId) === -1 && mine.length >= MAX_FRIENDS) {
    return fail(400, '好友数量已达上限', 'limit');
  }
  if (mine.indexOf(peerId) === -1) mine.push(peerId);
  if (theirs.indexOf(me) === -1) theirs.push(me);
  await writeFriendIds(kv, me, mine);
  await writeFriendIds(kv, peerId, theirs);
  await kv.delete(FRIEND_REQ + me + ':' + who);
  return json({ ok: true, friend: publicUser(acc, false) });
}

async function handleReject(env, me, from) {
  const kv = env.GUESTBOOK;
  const who = trim(from);
  const raw = await kv.get(FRIEND_REQ + me + ':' + who);
  if (!raw) return fail(404, '该申请已不存在', 'noreq');
  await kv.delete(FRIEND_REQ + me + ':' + who);
  return json({ ok: true });
}

/* ---------------- list：好友列表 + 待处理申请 ---------------- */
async function handleList(env, me) {
  const kv = env.GUESTBOOK;
  const now = Date.now();
  const ids = (await friendIds(kv, me)).slice(0, MAX_FRIENDS);
  // 已读基准集中存一个键，避免每个会话多读一次
  const readMap = (await kv.get(FRIEND_READ + me, 'json')) || {};

  const rows = await Promise.all(
    ids.map(async (pid) => {
      const acc = await readAccount(kv, pid);
      if (!acc) return null;                       // 账号已不存在（脏数据）则不展示
      const [pres, conv] = await Promise.all([
        kv.get(KV_PRESENCE + pid, 'json'),
        kv.get(dmKey(me, pid), 'json')
      ]);
      const msgs = Array.isArray(conv) ? conv : [];
      const readTs = readMap && readMap[pid] ? String(readMap[pid]) : '';
      let unread = 0;
      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        if (m && m.from !== me && (!readTs || String(m.time) > readTs)) unread++;
      }
      let last = null;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i] && msgs[i].time) {
          last = {
            from: msgs[i].from || '',
            text: msgs[i].text || '',
            img: !!msgs[i].img,
            time: msgs[i].time
          };
          break;
        }
      }
      const ts = pres && typeof pres.ts === 'number' ? pres.ts : 0;
      return {
        id: acc.id || pid,
        name: acc.name || pid,
        official: !!acc.official,
        online: ts > 0 && now - ts <= ONLINE_WINDOW,
        unread: unread,
        last: last
      };
    })
  );

  const friends = rows.filter(Boolean).sort((a, b) => {
    const ta = a.last ? String(a.last.time) : '';
    const tb = b.last ? String(b.last.time) : '';
    if (ta === tb) return a.id < b.id ? -1 : 1;
    return ta < tb ? 1 : -1;
  });

  // 待处理申请：friend:req:{me}:* 前缀列举，逐条读取（上限 REQ_LIST_MAX）
  const listRes = await kv.list({ prefix: FRIEND_REQ + me + ':', limit: REQ_LIST_MAX });
  const keys = (listRes && listRes.keys) || [];
  const reqs = await Promise.all(
    keys.map(async (k) => {
      const name = k && k.name ? String(k.name) : '';
      if (!name) return null;
      const fromId = name.slice((FRIEND_REQ + me + ':').length);
      if (!fromId) return null;
      const raw = await kv.get(name, 'json');
      if (!raw) return null;
      return {
        id: raw.from || fromId,
        name: raw.name || fromId,
        official: !!raw.official,
        msg: raw.msg || '',
        ts: raw.ts || ''
      };
    })
  );

  return json({
    ok: true,
    friends: friends,
    requests: reqs.filter(Boolean)
  });
}

/* ---------------- remove：删除好友（双向） ---------------- */
async function handleRemove(env, me, peer) {
  const kv = env.GUESTBOOK;
  const pid = trim(peer);
  if (!pid) return fail(400, '参数不完整', 'noid');
  const mine = await friendIds(kv, me);
  if (mine.indexOf(pid) === -1) return fail(404, '你们不是好友', 'notfriend');
  const theirs = await friendIds(kv, pid);
  await writeFriendIds(kv, me, mine.filter((v) => v !== pid));
  await writeFriendIds(kv, pid, theirs.filter((v) => v !== me));
  return json({ ok: true });
}

/* ---------------- read：标记已读（进入会话时清零未读） ---------------- */
async function handleRead(env, me, peer) {
  const kv = env.GUESTBOOK;
  const pid = trim(peer);
  if (!pid) return fail(400, '参数不完整', 'noid');
  const map = (await kv.get(FRIEND_READ + me, 'json')) || {};
  map[pid] = new Date().toISOString();
  await kv.put(FRIEND_READ + me, JSON.stringify(map));
  return json({ ok: true, ts: map[pid] });
}

export async function onRequest(context) {
  const { env, request } = context;
  if (!env || !env.GUESTBOOK) return fail(500, 'KV 未绑定', 'noenv');

  let body = {};
  try {
    if (request.method === 'GET') {
      const url = new URL(request.url);
      body = {
        action: url.searchParams.get('action') || '',
        id: url.searchParams.get('id') || '',
        to: url.searchParams.get('to') || '',
        from: url.searchParams.get('from') || '',
        peer: url.searchParams.get('peer') || '',
        msg: url.searchParams.get('msg') || ''
      };
    } else if (request.method === 'POST') {
      body = await request.json();
    } else {
      return fail(405, '不支持的请求方法', 'method');
    }
  } catch (err) {
    return fail(400, '请求体不是合法的 JSON', 'badjson');
  }
  if (!body || typeof body !== 'object') return fail(400, '请求体不是合法的 JSON', 'badjson');

  const action = trim(body.action);
  const me = trim(body.id);
  if (!me || !ID_RE.test(me)) return fail(401, '请先登录账号', 'nologin');
  const self = await readAccount(env.GUESTBOOK, me);
  if (!self) return fail(401, '账号不存在，请重新登录', 'nologin');
  const myId = self.id || me;

  try {
    if (action === 'search') return await handleSearch(env, myId, body.to || body.target || body.q);
    if (action === 'request') return await handleRequest(env, myId, body.to || body.target, body.msg);
    if (action === 'accept') return await handleAccept(env, myId, body.from || body.peer);
    if (action === 'reject') return await handleReject(env, myId, body.from || body.peer);
    if (action === 'list') return await handleList(env, myId);
    if (action === 'remove') return await handleRemove(env, myId, body.peer || body.to);
    if (action === 'read') return await handleRead(env, myId, body.peer || body.to);
    return fail(400, '不支持的操作', 'action');
  } catch (err) {
    return fail(500, '好友服务异常，请稍后重试', 'server');
  }
}
