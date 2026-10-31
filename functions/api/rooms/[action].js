// Cloudflare Pages Function: /api/rooms/[action]
// 动态路由：一个文件同时处理 create / join / leave / change / messages 等动作。
//   POST /api/rooms/create  -> 创建房间（自动生成唯一四字代码）
//   POST /api/rooms/join    -> 加入房间（校验代码是否存在，昵称仅在线占用）
//   POST /api/rooms/leave   -> 退出房间（清除在线状态与成员名单登记）
//   POST /api/rooms/change  -> 更改房间代码（迁移消息/名单/在线状态）
//   GET  /api/rooms/messages -> 拉取房间消息（携带 name 时同时作为心跳）
//   POST /api/rooms/messages -> 发送消息
// 房间消息通过 KV（绑定名 GUESTBOOK）按房间存储：key 为 `room:{code}`，值为 JSON 数组 [{ name, text, time }]；
// 成员名单 key 为 `room:{code}:names`；在线状态 key 为 `room:{code}:presence`（{ name: lastActiveTs }）。

const PREFIX = 'room:';
const MAX_MESSAGES = 200;

// 四字代码字符集：26 大写字母 + 10 数字（允许纯数字/纯字母）
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });

const readRoom = async (env, code) => {
  const raw = await env.GUESTBOOK.get(PREFIX + code, 'json');
  return Array.isArray(raw) ? raw : null;
};

const writeRoom = (env, code, messages) =>
  env.GUESTBOOK.put(PREFIX + code, JSON.stringify(messages));

// 房间成员名单：key 为 `room:{code}:names`，值为 JSON 数组（已占用昵称）
const readRoomNames = async (env, code) => {
  const raw = await env.GUESTBOOK.get(PREFIX + code + ':names', 'json');
  return Array.isArray(raw) ? raw : [];
};

const writeRoomNames = (env, code, names) =>
  env.GUESTBOOK.put(PREFIX + code + ':names', JSON.stringify(names));

// 房间成员在线状态：key 为 `room:{code}:presence`，值为 JSON 对象 { name: lastActiveTs }
const readPresence = async (env, code) => {
  const raw = await env.GUESTBOOK.get(PREFIX + code + ':presence', 'json');
  return raw && typeof raw === 'object' ? raw : {};
};

const writePresence = (env, code, presence) =>
  env.GUESTBOOK.put(PREFIX + code + ':presence', JSON.stringify(presence));

// 30 秒内活跃视为在线
const ONLINE_TTL = 30000;

const normalizeCode = (code) =>
  String(code || '').trim().toUpperCase();

const isValidCode = (code) => /^[A-Z0-9]{4}$/.test(code);

const randomCode = () => {
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
};

// 生成唯一房间代码：已存在则重新生成
async function genUniqueCode(env) {
  for (let i = 0; i < 100; i++) {
    const code = randomCode();
    const existing = await env.GUESTBOOK.get(PREFIX + code);
    if (existing === null) return code;
  }
  return null; // 极端情况下无法生成
}

async function handleCreate(env, body) {
  const name = String(body.name || '').trim().slice(0, 20) || '访客';
  const code = await genUniqueCode(env);
  if (!code) {
    return json({ ok: false, error: '创建房间失败，请重试' }, 500);
  }
  await writeRoom(env, code, []);
  await writeRoomNames(env, code, [name]);
  return json({ ok: true, code, name });
}

async function handleJoin(env, body) {
  const code = normalizeCode(body.code);
  if (!isValidCode(code)) {
    return json({ ok: false, error: '房间代码格式不正确' }, 400);
  }
  const room = await readRoom(env, code);
  if (room === null) {
    return json({ ok: false, error: '房间不存在' });
  }

  const name = String(body.name || '').trim().slice(0, 20) || '访客';
  const names = await readRoomNames(env, code);
  const presence = await readPresence(env, code);
  const now = Date.now();
  const lastActive = presence[name];
  // 仅当该昵称 30 秒内活跃（在线）才拒绝重名，否则允许进入
  if (typeof lastActive === 'number' && now - lastActive < ONLINE_TTL) {
    return json({ ok: false, error: '此聊天室中已有重名人，请你更换名称' });
  }
  // 允许进入：更新在线状态；若名单中没有则追加
  presence[name] = now;
  await writePresence(env, code, presence);
  if (!names.includes(name)) {
    names.push(name);
    await writeRoomNames(env, code, names);
  }
  return json({ ok: true, code, name });
}

async function handleMessagesGet(env, url) {
  const code = normalizeCode(url.searchParams.get('code'));
  if (!isValidCode(code)) {
    return json({ ok: false, error: '房间代码格式不正确' }, 400);
  }
  const room = await readRoom(env, code);
  if (room === null) {
    return json({ ok: false, error: '房间不存在' });
  }
  // 心跳：轮询拉消息时更新该成员在线状态（前端每 3 秒轮询自动续期）
  const name = String(url.searchParams.get('name') || '').trim().slice(0, 20);
  if (name) {
    const presence = await readPresence(env, code);
    presence[name] = Date.now();
    await writePresence(env, code, presence);
  }
  return json({ ok: true, code, messages: room }); // 最新在最后
}

async function handleMessagesPost(env, body) {
  const code = normalizeCode(body.code);
  if (!isValidCode(code)) {
    return json({ ok: false, error: '房间代码格式不正确' }, 400);
  }
  const room = await readRoom(env, code);
  if (room === null) {
    return json({ ok: false, error: '房间不存在' });
  }

  const name = String(body.name || '').trim().slice(0, 20) || '访客';
  const names = await readRoomNames(env, code);
  if (!names.includes(name)) {
    return json({ ok: false, error: '昵称未登记' });
  }
  const text = String(body.text || '').trim().slice(0, 500);
  if (!text) {
    return json({ ok: false, error: '消息内容不能为空' }, 400);
  }

  // 服务端补充时间，避免依赖客户端时钟
  const time = new Date().toISOString();
  room.push({ name, text, time });

  // 房间消息最多保留 200 条，超出截掉最旧的
  if (room.length > MAX_MESSAGES) {
    room.splice(0, room.length - MAX_MESSAGES);
  }

  await writeRoom(env, code, room);

  // 发送成功即视为在线
  const presence = await readPresence(env, code);
  presence[name] = Date.now();
  await writePresence(env, code, presence);
  return json({ ok: true, message: { name, text, time } });
}

// 更改房间代码：将房间消息与成员名单迁移到新代码，并删除旧 key
async function handleChange(env, body) {
  const code = normalizeCode(body.code);
  const newCode = normalizeCode(body.newCode);

  const room = await readRoom(env, code);
  if (room === null) {
    return json({ ok: false, error: '房间不存在' });
  }

  const name = String(body.name || '').trim().slice(0, 20) || '访客';
  const names = await readRoomNames(env, code);
  if (!names.includes(name)) {
    return json({ ok: false, error: '昵称未登记' });
  }

  if (!isValidCode(newCode)) {
    return json({ ok: false, error: '房间代码须为4位字母或数字' }, 400);
  }

  // 新代码与当前相同，无需迁移
  if (newCode === code) {
    return json({ ok: true, code: newCode });
  }

  // 新代码已被其他房间占用
  const existing = await env.GUESTBOOK.get(PREFIX + newCode);
  if (existing !== null) {
    return json({ ok: false, error: '该代码已被其他房间使用，请换一个' });
  }

  // 迁移消息、成员名单与在线状态，删除旧 key
  await writeRoom(env, newCode, room);
  await writeRoomNames(env, newCode, names);
  const presence = await readPresence(env, code);
  await writePresence(env, newCode, presence);
  await env.GUESTBOOK.delete(PREFIX + code);
  await env.GUESTBOOK.delete(PREFIX + code + ':names');
  await env.GUESTBOOK.delete(PREFIX + code + ':presence');
  return json({ ok: true, code: newCode });
}

// 退出房间：删除在线状态与成员名单登记
async function handleLeave(env, body) {
  const code = normalizeCode(body.code);
  if (!isValidCode(code)) {
    return json({ ok: false, error: '房间代码格式不正确' }, 400);
  }
  const name = String(body.name || '').trim().slice(0, 20) || '访客';

  const presence = await readPresence(env, code);
  if (Object.prototype.hasOwnProperty.call(presence, name)) {
    delete presence[name];
    await writePresence(env, code, presence);
  }

  const names = await readRoomNames(env, code);
  const idx = names.indexOf(name);
  if (idx !== -1) {
    names.splice(idx, 1);
    await writeRoomNames(env, code, names);
  }
  return json({ ok: true });
}

export async function onRequest(context) {
  const { env, request, params } = context;
  const url = new URL(request.url);
  const action = String(params.action || '').toLowerCase();

  let body = null;
  if (request.method === 'POST') {
    try {
      body = await request.json();
    } catch (err) {
      return json({ ok: false, error: '请求体不是合法的 JSON' }, 400);
    }
  }

  try {
    if (action === 'create' && request.method === 'POST') {
      return await handleCreate(env, body);
    }

    if (action === 'join' && request.method === 'POST') {
      return await handleJoin(env, body);
    }

    if (action === 'leave' && request.method === 'POST') {
      return await handleLeave(env, body);
    }

    if (action === 'change' && request.method === 'POST') {
      return await handleChange(env, body);
    }

    if (action === 'messages') {
      if (request.method === 'GET') return await handleMessagesGet(env, url);
      if (request.method === 'POST') return await handleMessagesPost(env, body);
    }

    return json({ ok: false, error: '不支持的请求方法' }, 405);
  } catch (err) {
    return json({ ok: false, error: '服务异常，请稍后重试' }, 500);
  }
}
