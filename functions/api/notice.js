// Cloudflare Pages Function: /api/notice
// 通过 KV（绑定名 GUESTBOOK）读取公告文本，实现跨设备统一公告。
// KV 绑定方式见项目根目录 wrangler.toml 中的注释。

const KEY = 'notice';
const DEFAULT_NOTICE = '欢迎来到 Cealin 聊天室，请文明交流，聊天记录云端同步。';

export async function onRequest(context) {
  const { env, request } = context;

  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });

  if (request.method === 'GET') {
    try {
      const notice = await env.GUESTBOOK.get(KEY);
      return json({ ok: true, notice: notice || DEFAULT_NOTICE });
    } catch (err) {
      return json({ ok: false, error: '读取公告失败' }, 500);
    }
  }

  if (request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch (err) {
      return json({ ok: false, error: '公告内容不能超过2000字' }, 400);
    }

    // 管理员身份校验：写/清空公告必须携带正确密码
    const DEFAULT_ADMIN_PWD = 'liuyiwei150314';
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

    // 登录校验模式：action === 'login' 只校验密码，不写公告（供首页/公告后台登录复用）
    if (body && body.action === 'login') {
      return json({ ok: true, role: 'admin' });
    }

    let notice = '';
    if (body && typeof body.notice === 'string') notice = body.notice.trim();
    if (notice.length > 2000) {
      return json({ ok: false, error: '公告内容不能超过2000字' }, 400);
    }

    try {
      if (notice) {
        await env.GUESTBOOK.put(KEY, notice);
      } else {
        // 空公告：删除 KV key，恢复默认公告
        await env.GUESTBOOK.delete(KEY);
      }
      return json({ ok: true });
    } catch (err) {
      return json({ ok: false, error: '保存公告失败' }, 500);
    }
  }

  return json({ ok: false, error: '不支持的请求方法' }, 405);
}
