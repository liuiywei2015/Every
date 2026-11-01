// Cloudflare Pages Function: /api/auth/login
// 管理员密码登录校验：与 KV（绑定名 GUESTBOOK）中的 admin_pwd 比对，
// 未设置时使用默认密码 liuyiwei150314。KV 绑定方式见项目根目录 wrangler.toml 中的注释。

const DEFAULT_ADMIN_PWD = 'liuyiwei150314';

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

  if (password === adminPwd) {
    return json({ ok: true, role: 'admin' });
  }
  return json({ ok: false, error: '密码错误' }, 401);
}
