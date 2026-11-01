// Cloudflare Pages Function: /api/suggestions
// 建议功能后端接口：
//   action=submit  -> 匿名提交建议（公开，无需密码）
//   action=list    -> 管理员查看建议列表（需密码校验，新在前）
//   action=delete  -> 管理员删除单条建议（需密码校验）
// KV key 约定（绑定名 GUESTBOOK，见 wrangler.toml）：
//   suggestions -> JSON 数组 [{ id, name, email, content, ts }]，新建议 unshift 到最前
// 管理员密码校验方式与 admin-rooms.js / auth.js 保持一致。

const DEFAULT_ADMIN_PWD = 'liuyiwei150314';
const KEY = 'suggestions';
const MAX_CONTENT_LEN = 1000;
const MAX_NAME_LEN = 30;
const MAX_EMAIL_LEN = 120;

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

  const action = body && typeof body.action === 'string' ? body.action : '';

  // ---------- 提交建议（公开） ----------
  if (action === 'submit') {
    const name = body && typeof body.name === 'string' ? body.name.trim() : '';
    const email = body && typeof body.email === 'string' ? body.email.trim() : '';
    const content = body && typeof body.content === 'string' ? body.content.trim() : '';

    if (!content) {
      return json({ ok: false, error: '建议内容不能为空' }, 400);
    }
    if (content.length > MAX_CONTENT_LEN) {
      return json({ ok: false, error: '建议内容不能超过 ' + MAX_CONTENT_LEN + ' 字' }, 400);
    }
    if (name.length > MAX_NAME_LEN) {
      return json({ ok: false, error: '昵称不能超过 ' + MAX_NAME_LEN + ' 字' }, 400);
    }
    if (email.length > MAX_EMAIL_LEN) {
      return json({ ok: false, error: '邮箱不能超过 ' + MAX_EMAIL_LEN + ' 字' }, 400);
    }

    try {
      let list = await env.GUESTBOOK.get(KEY, 'json');
      if (!Array.isArray(list)) list = [];
      if (list.length >= 500) list = list.slice(0, 499); // 最多保留 500 条

      const item = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        name: name || '匿名',
        email: email || '',
        content: content,
        ts: Date.now()
      };
      list.unshift(item);
      await env.GUESTBOOK.put(KEY, JSON.stringify(list));
      return json({ ok: true, id: item.id });
    } catch (err) {
      return json({ ok: false, error: '服务异常，请稍后重试' }, 500);
    }
  }

  // 以下操作需管理员密码
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

  // ---------- 管理员查看列表 ----------
  if (action === 'list') {
    try {
      let list = await env.GUESTBOOK.get(KEY, 'json');
      if (!Array.isArray(list)) list = [];
      return json({ ok: true, suggestions: list });
    } catch (err) {
      return json({ ok: false, error: '服务异常，请稍后重试' }, 500);
    }
  }

  // ---------- 管理员删除单条建议 ----------
  if (action === 'delete') {
    const id = body && typeof body.id === 'string' ? body.id : '';
    if (!id) {
      return json({ ok: false, error: '缺少建议 ID' }, 400);
    }
    try {
      let list = await env.GUESTBOOK.get(KEY, 'json');
      if (!Array.isArray(list)) list = [];
      const next = list.filter(function (it) {
        return !(it && it.id === id);
      });
      if (next.length === list.length) {
        return json({ ok: false, error: '建议不存在或已被删除' }, 404);
      }
      await env.GUESTBOOK.put(KEY, JSON.stringify(next));
      return json({ ok: true, deleted: true });
    } catch (err) {
      return json({ ok: false, error: '服务异常，请稍后重试' }, 500);
    }
  }

  return json({ ok: false, error: '未知操作' }, 400);
}
