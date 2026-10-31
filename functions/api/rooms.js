// Cloudflare Pages Function: /api/rooms
// 聊天室功能：通过 KV（绑定名 GUESTBOOK）按房间存储消息数组。
// 房间消息 key 为 `room:{code}`，值为 JSON 数组 [{ name, text, time }]。
// KV 绑定方式见项目根目录 wrangler.toml 中的注释。

const PREFIX = 'room:';
const MAX_MESSAGES = 200;

// 四字代码字符集：排除易混淆的 0/O/1/I
const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

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

const normalizeCode = (code) =>
  String(code || '').trim().toUpperCase();

const isValidCode = (code) => /^[2-9A-HJ-NP-Z]{4}$/.test(code);

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
  return json({ ok: true, code });
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
  return json({ ok: true, message: { name, text, time } });
}

export async function onRequest(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');

  let body = null;
  if (request.method === 'POST') {
    try {
      body = await request.json();
    } catch (err) {
      return json({ ok: false, error: '请求体不是合法的 JSON' }, 400);
    }
  }

  try {
    if (request.method === 'GET' && path === '/api/rooms/messages') {
      return await handleMessagesGet(env, url);
    }

    if (request.method === 'POST') {
      if (path === '/api/rooms/create') return await handleCreate(env, body);
      if (path === '/api/rooms/join') return await handleJoin(env, body);
      if (path === '/api/rooms/messages') return await handleMessagesPost(env, body);
    }

    return json({ ok: false, error: '不支持的请求方法' }, 405);
  } catch (err) {
    return json({ ok: false, error: '服务异常，请稍后重试' }, 500);
  }
}
