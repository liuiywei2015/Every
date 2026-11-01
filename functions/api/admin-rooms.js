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

        const raw = await env.GUESTBOOK.get(name, 'json');
        const messages = Array.isArray(raw) ? raw : [];
        const namesRaw = await env.GUESTBOOK.get(name + ':names', 'json');
        const names = Array.isArray(namesRaw) ? namesRaw : [];
        const presenceRaw = await env.GUESTBOOK.get(name + ':presence', 'json');
        const presence = presenceRaw && typeof presenceRaw === 'object' ? presenceRaw : {};

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
          lastActive: lastActive || null
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
