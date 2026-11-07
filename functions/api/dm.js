// Cloudflare Pages Function: /api/dm
// 好友私聊：发送文本 / 图片、增量拉取消息、按消息 id 读取图片
//
// 动作：
//   POST { action: 'send', id, to, text?, img?: { data, type } }  → { msg }
//   POST { action: 'messages', id, peer, since? }                  → { peer, messages, total }
//   POST { action: 'read', id, peer }                              → { ok, ts }  （进入会话清零未读）
//   GET  ?action=img&k={msgId}&peer={peerId}                       → { ok, type, data }
//
// 键空间（KV 绑定名 GUESTBOOK，friend: 前缀，与 room: / account: / article: 互不冲突）：
//   friend:dm:{a}~{b}      -> 消息数组，按时间正序；只保留最近 MSG_KEEP 条，避免单键无限膨胀
//                             消息结构 { id, from, name, text, img: { k, t } | null, time }
//   friend:dm:img:{msgId}  -> { conv, type, data(base64) }，单张 ≤300KB，TTL 30 天自动回收
//   friend:read:{id}       -> { peerId: 'ISO 时间' } 各会话已读基准，与 friends.js 共用同一键
//
// 写入预算（KV 免费额度：写 1000 次/天）：
//   每条消息 1 次写（带图再 1 次）；轮询 / 拉取 / 取图全部只读，页面隐藏时的低频通知轮询也不写 KV。
//   图片单独成键并带 TTL，既避免单键过大，也让旧图自动过期回收，无需额外删除写操作。

const KV_ACCOUNT = 'account:';
const KV_PRESENCE = 'account:presence:';
const FRIEND_LIST = 'friend:list:';
const DM_PREFIX = 'friend:dm:';
const IMG_PREFIX = 'friend:dm:img:';
const FRIEND_READ = 'friend:read:';

const ID_RE = /^[A-Za-z0-9@]{6,8}$/;
const TEXT_MAX = 1000;
const MSG_KEEP = 100;                                  // 每个会话只保留最近 100 条
const IMG_MAX_BYTES = 300 * 1024;                      // 与文章区单张 300KB 口径一致
const IMG_DATA_MAX = Math.round((IMG_MAX_BYTES * 4) / 3) + 4096;
const IMG_TTL = 30 * 24 * 3600;
const ONLINE_WINDOW = 20 * 60 * 1000;
const READ_MAP_MAX = 60;                               // 已读基准表最多保留 60 个会话，避免单键膨胀

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

function randomHex(size) {
  const buf = new Uint8Array(size);
  crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < size; i++) s += (buf[i] < 16 ? '0' : '') + buf[i].toString(16);
  return s;
}

function bytesOfBase64(b64) {
  const s = String(b64 || '').replace(/\s+/g, '');
  if (!s) return 0;
  let pad = 0;
  if (s.charAt(s.length - 1) === '=') pad++;
  if (s.length > 1 && s.charAt(s.length - 2) === '=') pad++;
  return Math.floor((s.length * 3) / 4) - pad;
}

async function readAccount(kv, id) {
  if (!id) return null;
  let raw = await kv.get(KV_ACCOUNT + id, 'json');
  if (!raw && id.length === 6 && /^[a-z0-9]+$/.test(id)) {
    raw = await kv.get(KV_ACCOUNT + id.toUpperCase(), 'json');
  }
  if (!raw || typeof raw !== 'object') return null;
  return raw;
}

function dmKey(a, b) {
  return DM_PREFIX + (a < b ? a + '~' + b : b + '~' + a);
}

async function friendIds(kv, id) {
  const raw = await kv.get(FRIEND_LIST + id, 'json');
  return raw && Array.isArray(raw.ids) ? raw.ids.map((v) => trim(v)).filter(Boolean) : [];
}

// 仅好友之间可收发消息
async function requireFriend(kv, me, peer) {
  const ids = await friendIds(kv, me);
  return ids.indexOf(peer) !== -1;
}

/* ---------------- send：发送消息 ---------------- */
async function handleSend(env, me, myName, body) {
  const kv = env.GUESTBOOK;
  const to = trim(body.to);
  if (!ID_RE.test(to)) return fail(400, '参数不完整', 'noid');
  if (to === me) return fail(400, '不能给自己发消息', 'self');

  const acc = await readAccount(kv, to);
  if (!acc) return fail(404, '对方账号不存在', 'notfound');
  const peerId = acc.id || to;

  if (!(await requireFriend(kv, me, peerId))) {
    return fail(403, '你们还不是好友，无法发送消息', 'notfriend');
  }

  const text = trim(body.text).slice(0, TEXT_MAX);
  const imgIn = body.img && typeof body.img === 'object' ? body.img : null;
  if (!text && !imgIn) return fail(400, '消息内容不能为空', 'empty');

  const msgId = Date.now().toString(36) + '-' + randomHex(6);
  let imgRef = null;
  let imgData = '';
  if (imgIn) {
    imgData = String(imgIn.data || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
    if (!imgData) return fail(400, '图片内容为空', 'imgempty');
    if (imgData.length > IMG_DATA_MAX) return fail(413, '图片不能超过 300KB', 'imgsize');
    if (bytesOfBase64(imgData) > IMG_MAX_BYTES) return fail(413, '图片不能超过 300KB', 'imgsize');
    const type = /^image\/(png|jpeg|jpg|webp|gif)$/i.test(String(imgIn.type || '')) ? String(imgIn.type) : 'image/jpeg';
    imgRef = { k: msgId, t: type };
  }

  const msg = {
    id: msgId,
    from: me,
    name: myName,
    text: text,
    img: imgRef,
    time: new Date().toISOString()
  };

  const key = dmKey(me, peerId);
  const raw = await kv.get(key, 'json');
  const list = Array.isArray(raw) ? raw : [];
  list.push(msg);
  const capped = list.slice(-MSG_KEEP);
  await kv.put(key, JSON.stringify(capped));

  if (imgRef) {
    await kv.put(
      IMG_PREFIX + msgId,
      JSON.stringify({ conv: key, type: imgRef.t, data: imgData }),
      { expirationTtl: IMG_TTL }
    );
  }

  return json({ ok: true, msg: msg });
}

/* ---------------- messages：增量拉取 ---------------- */
async function handleMessages(env, me, body) {
  const kv = env.GUESTBOOK;
  const peer = trim(body.peer || body.to);
  if (!ID_RE.test(peer)) return fail(400, '参数不完整', 'noid');

  const acc = await readAccount(kv, peer);
  if (!acc) return fail(404, '对方账号不存在', 'notfound');
  const peerId = acc.id || peer;

  if (!(await requireFriend(kv, me, peerId))) {
    return fail(403, '你们还不是好友，无法查看会话', 'notfriend');
  }

  const since = trim(body.since);
  const raw = await kv.get(dmKey(me, peerId), 'json');
  const all = Array.isArray(raw) ? raw : [];
  const messages = since
    ? all.filter((m) => m && String(m.time) > since)
    : all;

  const pres = await kv.get(KV_PRESENCE + peerId, 'json');
  const ts = pres && typeof pres.ts === 'number' ? pres.ts : 0;

  return json({
    ok: true,
    peer: {
      id: acc.id || peerId,
      name: acc.name || peerId,
      official: !!acc.official,
      online: ts > 0 && Date.now() - ts <= ONLINE_WINDOW
    },
    messages: messages,
    total: all.length
  });
}

/* ---------------- read：标记已读（进入会话时清零未读） ---------------- */
async function handleRead(env, me, peer) {
  const kv = env.GUESTBOOK;
  const p = trim(peer);
  if (!ID_RE.test(p)) return fail(400, '参数不完整', 'noid');
  const map = (await kv.get(FRIEND_READ + me, 'json')) || {};
  map[p] = new Date().toISOString();
  // 超限时按时间裁掉最早的记录，保证单键不会无限增长
  const names = Object.keys(map);
  if (names.length > READ_MAP_MAX) {
    names.sort((a, b) => (String(map[a]) < String(map[b]) ? -1 : 1));
    for (let i = 0; i < names.length - READ_MAP_MAX; i++) delete map[names[i]];
  }
  await kv.put(FRIEND_READ + me, JSON.stringify(map));
  return json({ ok: true, ts: map[p] });
}

/* ---------------- img：按消息 id 取图（仅会话双方可读） ---------------- */
async function handleImg(env, me, msgId, peer) {
  const kv = env.GUESTBOOK;
  const k = trim(msgId);
  const p = trim(peer);
  if (!k || !p) return fail(400, '参数不完整', 'noid');
  const raw = await kv.get(IMG_PREFIX + k, 'json');
  if (!raw || !raw.data) return fail(404, '图片已过期', 'imggone');
  // 只允许该会话的双方读取
  const mine = dmKey(me, p);
  if (raw.conv && raw.conv !== mine) return fail(403, '无权访问该图片', 'forbidden');
  return json({ ok: true, type: raw.type || 'image/jpeg', data: raw.data });
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
        peer: url.searchParams.get('peer') || '',
        k: url.searchParams.get('k') || ''
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
    if (action === 'send') return await handleSend(env, myId, self.name || myId, body);
    if (action === 'messages') return await handleMessages(env, myId, body);
    if (action === 'read') return await handleRead(env, myId, body.peer || body.to);
    if (action === 'img') return await handleImg(env, myId, body.k, body.peer);
    return fail(400, '不支持的操作', 'action');
  } catch (err) {
    return fail(500, '私聊服务异常，请稍后重试', 'server');
  }
}
