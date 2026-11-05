// Cloudflare Pages Function: /api/rooms/[action]
// 动态路由：一个文件同时处理 create / join / leave / change / messages 等动作。
//   POST /api/rooms/create  -> 创建房间（自动生成唯一四字代码）
//   POST /api/rooms/join    -> 加入房间（校验代码是否存在，昵称仅在线占用；已登录账号回传校验后的 accId）
//   POST /api/rooms/leave   -> 退出房间（清除在线状态与成员名单登记）
//   POST /api/rooms/change  -> 更改房间代码（迁移消息/名单/在线状态/状态/元信息）
//   POST /api/rooms/rename  -> 聊天室起名（保存显示名称到 room:{code}:meta 的 name 字段）
//   GET  /api/rooms/messages -> 拉取房间消息（携带 name 时同时作为心跳）
//   POST /api/rooms/messages -> 发送消息（已登录账号的消息附带 accId）
// 房间消息通过 KV（绑定名 GUESTBOOK）按房间存储：key 为 `room:{code}`，值为 JSON 数组 [{ name, text, time, accId? }]；
// 成员名单 key 为 `room:{code}:names`；在线状态 key 为 `room:{code}:presence`（{ name: lastActiveTs }）；
// 元信息 key 为 `room:{code}:meta`（{ verified, verifiedAt, name }，官方授权与聊天室起名共用）。
// accId 为账号系统（/api/accounts）分配的 6 位编号，仅在「账号存在且账号名称 == 昵称」时写入，
// 使登录用户的聊天记录与账号关联；无账号 / 临时改名 / 历史消息均不带该字段。

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

// 账号编号：6 位大写字母 / 数字（与 /api/accounts 的编号规则一致）
const ACC_ID_RE = /^[A-Z0-9]{6}$/;

const sanitizeAccId = (value) => {
  const id = String(value || '').trim().toUpperCase();
  return ACC_ID_RE.test(id) ? id : '';
};

// 校验 accId 与昵称的绑定关系：账号存在且账号名称与昵称一致才返回编号，
// 避免客户端伪造他人编号把消息记到别人账号名下；未登录 / 校验失败返回空串（消息照常发送）
async function resolveAccId(env, rawAccId, name) {
  const id = sanitizeAccId(rawAccId);
  if (!id || !name) return '';
  try {
    const acc = await env.GUESTBOOK.get('account:' + id, 'json');
    if (acc && typeof acc.name === 'string' && acc.name === name) return id;
  } catch (err) {
    // 账号读取异常不影响聊天主流程，降级为无账号消息
  }
  return '';
}

// 封禁时长：10 天，到期后读取时自动清除该房间全部 KV 数据
const BAN_TTL = 10 * 24 * 60 * 60 * 1000;

// 房间状态：key 为 `room:{code}:status`，值为 JSON 对象
//   { banned: Boolean, bannedAt: Number(ms) | null, reported: Boolean, reportedAt: Number(ms) | null }
const readStatus = async (env, code) => {
  const raw = await env.GUESTBOOK.get(PREFIX + code + ':status', 'json');
  return raw && typeof raw === 'object' ? raw : {};
};

const writeStatus = (env, code, status) =>
  env.GUESTBOOK.put(PREFIX + code + ':status', JSON.stringify(status));

// 房间元信息：key 为 `room:{code}:meta`，值为 JSON 对象
//   { verified: Boolean, verifiedAt: Number(ms) | null, name: String | null }
//   verified 表示官方授权（管理端 admin-rooms.js 的 verify action 写入）；
//   name 表示房间显示名称（聊天室起名功能写入）。
const readMeta = async (env, code) => {
  const raw = await env.GUESTBOOK.get(PREFIX + code + ':meta', 'json');
  return raw && typeof raw === 'object' ? raw : {};
};

const writeMeta = (env, code, meta) =>
  env.GUESTBOOK.put(PREFIX + code + ':meta', JSON.stringify(meta));

// 删除房间全部 KV 数据，一个不剩：
// 先按前缀 room:{code}: 分页 list 删除全部派生键（names/presence/status 及未来新增派生键），再删除主键 room:{code}。
async function deleteRoomData(env, code) {
  let cursor;
  do {
    const listResult = await env.GUESTBOOK.list({ prefix: PREFIX + code + ':', cursor });
    for (const item of listResult.keys || []) {
      await env.GUESTBOOK.delete(item.name);
    }
    cursor = listResult.cursor;
  } while (cursor);
  await env.GUESTBOOK.delete(PREFIX + code);
}

// 封禁到期自动清除：读取房间时检查，若封禁超过 10 天则删除该房间全部 KV 数据
async function cleanupExpiredBan(env, code) {
  const status = await readStatus(env, code);
  if (status.banned && typeof status.bannedAt === 'number' && Date.now() - status.bannedAt >= BAN_TTL) {
    await deleteRoomData(env, code);
    return true;
  }
  return false;
}

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
  // 封禁到期自动清除
  if (await cleanupExpiredBan(env, code)) {
    return json({ ok: false, error: '房间不存在' });
  }
  const status = await readStatus(env, code);

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
  // 返回 meta：前端据此判断官方授权状态与房间显示名称
  const meta = await readMeta(env, code);
  // 账号登录态：编号与昵称校验通过才回传，前端据此渲染"本人消息"
  const accId = await resolveAccId(env, body.accId, name);
  return json({
    ok: true,
    code,
    name,
    accId,
    banned: !!status.banned,
    bannedAt: status.bannedAt || null,
    reported: !!status.reported,
    verified: !!meta.verified,
    roomName: typeof meta.name === 'string' ? meta.name : null
  });
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
  // 封禁到期自动清除
  if (await cleanupExpiredBan(env, code)) {
    return json({ ok: false, error: '房间不存在' });
  }
  // 心跳：轮询拉消息时更新该成员在线状态（前端每 3 秒轮询自动续期）
  const name = String(url.searchParams.get('name') || '').trim().slice(0, 20);
  if (name) {
    const presence = await readPresence(env, code);
    presence[name] = Date.now();
    await writePresence(env, code, presence);
  }
  // 返回 meta：前端轮询时同步官方授权状态与房间显示名称
  const meta = await readMeta(env, code);
  return json({
    ok: true,
    code,
    messages: room, // 最新在最后
    verified: !!meta.verified,
    roomName: typeof meta.name === 'string' ? meta.name : null
  });
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
  // 封禁到期自动清除
  if (await cleanupExpiredBan(env, code)) {
    return json({ ok: false, error: '房间不存在' });
  }

  // 封禁状态：被封禁房间禁止发送新消息（仍可进入查看历史消息）
  const status = await readStatus(env, code);
  if (status.banned) {
    return json({ ok: false, error: '聊天室已被封禁，无法发送消息' }, 403);
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
  // 已登录账号：消息附带账号编号，便于刷新 / 重进房间后识别本人消息
  const accId = await resolveAccId(env, body.accId, name);
  const message = { name, text, time };
  if (accId) message.accId = accId;
  room.push(message);

  // 房间消息最多保留 200 条，超出截掉最旧的
  if (room.length > MAX_MESSAGES) {
    room.splice(0, room.length - MAX_MESSAGES);
  }

  await writeRoom(env, code, room);

  // 发送成功即视为在线
  const presence = await readPresence(env, code);
  presence[name] = Date.now();
  await writePresence(env, code, presence);
  // 返回 meta：前端可据此同步官方授权状态与房间显示名称
  const meta = await readMeta(env, code);
  return json({
    ok: true,
    message,
    verified: !!meta.verified,
    roomName: typeof meta.name === 'string' ? meta.name : null
  });
}

// 更改房间代码：将房间消息与成员名单迁移到新代码，并删除旧 key
async function handleChange(env, body) {
  const code = normalizeCode(body.code);
  const newCode = normalizeCode(body.newCode);

  const room = await readRoom(env, code);
  if (room === null) {
    return json({ ok: false, error: '房间不存在' });
  }
  // 封禁到期自动清除
  if (await cleanupExpiredBan(env, code)) {
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

  // 迁移消息、成员名单、在线状态与状态标记（封禁/举报）及元信息（授权/名称），删除旧 key（全部派生键 + 主键，一个不剩）
  await writeRoom(env, newCode, room);
  await writeRoomNames(env, newCode, names);
  const presence = await readPresence(env, code);
  await writePresence(env, newCode, presence);
  const status = await readStatus(env, code);
  if (Object.keys(status).length) {
    await writeStatus(env, newCode, status);
  }
  const meta = await readMeta(env, code);
  if (Object.keys(meta).length) {
    await writeMeta(env, newCode, meta);
  }
  await deleteRoomData(env, code);
  return json({
    ok: true,
    code: newCode,
    verified: !!meta.verified,
    roomName: typeof meta.name === 'string' ? meta.name : null
  });
}

// 聊天室起名：为当前房间设置显示名称，保存到 room:{code}:meta 的 name 字段
// 权限校验与更改代码（change）一致：必须是已登记昵称的成员；空名称视为清除名称（恢复显示代码）
async function handleRename(env, body) {
  const code = normalizeCode(body.code);
  if (!isValidCode(code)) {
    return json({ ok: false, error: '房间代码格式不正确' }, 400);
  }
  const room = await readRoom(env, code);
  if (room === null) {
    return json({ ok: false, error: '房间不存在' });
  }
  // 封禁到期自动清除
  if (await cleanupExpiredBan(env, code)) {
    return json({ ok: false, error: '房间不存在' });
  }

  const name = String(body.name || '').trim().slice(0, 20) || '访客';
  const names = await readRoomNames(env, code);
  if (!names.includes(name)) {
    return json({ ok: false, error: '昵称未登记' });
  }

  const roomName = String(body.roomName || '').trim().slice(0, 20);
  const meta = await readMeta(env, code);
  if (roomName) {
    meta.name = roomName;
  } else {
    delete meta.name;
  }
  await writeMeta(env, code, meta);
  return json({
    ok: true,
    code,
    roomName: typeof meta.name === 'string' ? meta.name : null,
    verified: !!meta.verified
  });
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

// 举报房间：记录该房间为被举报状态（任一用户可举报，后台据此在管理员列表标记）
async function handleReport(env, body) {
  const code = normalizeCode(body.code);
  if (!isValidCode(code)) {
    return json({ ok: false, error: '房间代码格式不正确' }, 400);
  }
  const room = await readRoom(env, code);
  if (room === null) {
    return json({ ok: false, error: '房间不存在' });
  }
  // 封禁到期自动清除
  if (await cleanupExpiredBan(env, code)) {
    return json({ ok: false, error: '房间不存在' });
  }
  const status = await readStatus(env, code);
  status.reported = true;
  status.reportedAt = Date.now();
  await writeStatus(env, code, status);
  return json({ ok: true, code });
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

    if (action === 'rename' && request.method === 'POST') {
      return await handleRename(env, body);
    }

    if (action === 'report' && request.method === 'POST') {
      return await handleReport(env, body);
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
