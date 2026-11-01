// Cloudflare Pages Function: /api/admin-rooms
// 管理员查询聊天室房间注册情况（需管理员密码校验）：
//   列出所有已注册房间代码、消息数量、已占用昵称、在线成员与最近活跃时间。
// 房间 key 约定（见 rooms/[action].js）：
//   room:{code}           -> 消息数组 [{ name, text, time }]
//   room:{code}:names     -> 已占用昵称数组
//   room:{code}:presence  -> { name: lastActiveTs }

const DEFAULT_ADMIN_PWD = 'liuyiwei150314';
const PREFIX = 'room:';
const ONLINE_TTL = 30000;
const BAN_TTL = 10 * 24 * 60 * 60 * 1000; // 封禁 10 天后自动清除

export async function onRequest(context) {
  const { env, request } = context;

  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });

  if (request.method !== 'POST') {
    return json({ ok: false, error: '不支持的请求方法' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ ok: false, error: '请求体不是合法的 JSON' }, 400);
  }

  const action = body && typeof body.action === 'string' ? body.action : 'list';
  const code = body && typeof body.code === 'string' ? String(body.code).trim().toUpperCase() : '';
  const password = body && typeof body.password === 'string' ? body.password : '';

  let adminPwd = DEFAULT_ADMIN_PWD;
  try {
    adminPwd = (await env.GUESTBOOK.get('admin_pwd')) || DEFAULT_ADMIN_PWD;
  } catch (err) {
    return json({ ok: false, error: '服务异常，请稍后重试' }, 500);
  }

  if (password !== adminPwd) {
    return json({ ok: false, error: '密码错误' }, 401);
  }

  // 官方授权 / 取消授权聊天室：标记保存在 room:{code}:meta 的 verified 字段（用户进房显示认证横幅与金色 V 标）
  if (action === 'verify') {
    if (!/^[A-Z0-9]{4}$/.test(code)) {
      return json({ ok: false, error: '房间代码格式不正确' }, 400);
    }
    const verify = body && body.verify !== false;
    try {
      const room = await env.GUESTBOOK.get(PREFIX + code);
      if (room === null) {
        return json({ ok: false, error: '房间不存在' });
      }
      const metaRaw = await env.GUESTBOOK.get(PREFIX + code + ':meta', 'json');
      const meta = metaRaw && typeof metaRaw === 'object' ? metaRaw : {};
      if (verify) {
        meta.verified = true;
        meta.verifiedAt = Date.now();
      } else {
        delete meta.verified;
        delete meta.verifiedAt;
      }
      await env.GUESTBOOK.put(PREFIX + code + ':meta', JSON.stringify(meta));
      return json({ ok: true, code, verified: !!meta.verified });
    } catch (err) {
      return json({ ok: false, error: '服务异常，请稍后重试' }, 500);
    }
  }

  // 封禁聊天室：标记封禁状态与封禁时间（用户仍可进入，前端显示封禁红字）
  if (action === 'ban') {
    if (!/^[A-Z0-9]{4}$/.test(code)) {
      return json({ ok: false, error: '房间代码格式不正确' }, 400);
    }
    try {
      const room = await env.GUESTBOOK.get(PREFIX + code);
      if (room === null) {
        return json({ ok: false, error: '房间不存在' });
      }
      const statusRaw = await env.GUESTBOOK.get(PREFIX + code + ':status', 'json');
      const status = statusRaw && typeof statusRaw === 'object' ? statusRaw : {};
      status.banned = true;
      status.bannedAt = Date.now();
      await env.GUESTBOOK.put(PREFIX + code + ':status', JSON.stringify(status));
      return json({ ok: true, code, banned: true, bannedAt: status.bannedAt });
    } catch (err) {
      return json({ ok: false, error: '服务异常，请稍后重试' }, 500);
    }
  }

  // 删除聊天室：立即清除该房间全部 KV 数据，一个不剩。
  // 先按前缀 room:{code}: 分页 list 删除全部派生键（names/presence/status 及未来新增派生键），再删除主键 room:{code}。
  if (action === 'delete') {
    if (!/^[A-Z0-9]{4}$/.test(code)) {
      return json({ ok: false, error: '房间代码格式不正确' }, 400);
    }
    try {
      let cursor;
      do {
        const listResult = await env.GUESTBOOK.list({ prefix: PREFIX + code + ':', cursor });
        for (const item of listResult.keys || []) {
          await env.GUESTBOOK.delete(item.name);
        }
        cursor = listResult.cursor;
      } while (cursor);
      await env.GUESTBOOK.delete(PREFIX + code);
      return json({ ok: true, code, deleted: true });
    } catch (err) {
      return json({ ok: false, error: '服务异常，请稍后重试' }, 500);
    }
  }

  try {
    const now = Date.now();
    const rooms = [];

    // 分页列出所有 room: 前缀键（KV list 每页默认最多 1000 个键）
    let cursor;
    do {
      const listResult = await env.GUESTBOOK.list({ prefix: PREFIX, cursor });
      for (const item of listResult.keys || []) {
        const name = item.name || '';
        const code = name.slice(PREFIX.length);
        // 仅处理主键 room:{code}（4 位大写字母或数字），跳过 :names / :presence 派生键
        if (!/^[A-Z0-9]{4}$/.test(code)) continue;

        // 封禁到期自动清除：封禁超过 10 天删除该房间全部 KV 数据
        const statusRaw = await env.GUESTBOOK.get(name + ':status', 'json');
        const status = statusRaw && typeof statusRaw === 'object' ? statusRaw : {};
        if (status.banned && typeof status.bannedAt === 'number' && now - status.bannedAt >= BAN_TTL) {
          await env.GUESTBOOK.delete(name);
          await env.GUESTBOOK.delete(name + ':names');
          await env.GUESTBOOK.delete(name + ':presence');
          await env.GUESTBOOK.delete(name + ':status');
          await env.GUESTBOOK.delete(name + ':meta');
          continue;
        }

        const raw = await env.GUESTBOOK.get(name, 'json');
        const messages = Array.isArray(raw) ? raw : [];
        const namesRaw = await env.GUESTBOOK.get(name + ':names', 'json');
        const names = Array.isArray(namesRaw) ? namesRaw : [];
        const presenceRaw = await env.GUESTBOOK.get(name + ':presence', 'json');
        const presence = presenceRaw && typeof presenceRaw === 'object' ? presenceRaw : {};
        const metaRaw = await env.GUESTBOOK.get(name + ':meta', 'json');
        const meta = metaRaw && typeof metaRaw === 'object' ? metaRaw : {};

        const onlineNames = [];
        let lastActive = 0;
        Object.keys(presence).forEach(function (nick) {
          const ts = presence[nick];
          if (typeof ts !== 'number') return;
          if (ts > lastActive) lastActive = ts;
          // 30 秒内活跃视为在线（与 rooms/[action].js 的 ONLINE_TTL 一致）
          if (now - ts < ONLINE_TTL) onlineNames.push(nick);
        });

        rooms.push({
          code,
          messageCount: messages.length,
          names,
          onlineNames,
          lastActive: lastActive || null,
          banned: !!status.banned,
          bannedAt: status.bannedAt || null,
          reported: !!status.reported,
          reportedAt: status.reportedAt || null,
          verified: !!meta.verified,
          verifiedAt: meta.verifiedAt || null,
          roomName: typeof meta.name === 'string' ? meta.name : ''
        });
      }
      cursor = listResult.cursor;
    } while (cursor);

    // 最近活跃优先排序
    rooms.sort(function (a, b) {
      const la = a.lastActive || 0;
      const lb = b.lastActive || 0;
      return lb - la;
    });

    return json({ ok: true, rooms });
  } catch (err) {
    return json({ ok: false, error: '服务异常，请稍后重试' }, 500);
  }
}
