// Cloudflare Pages Function: /api/auth
// 校验云储存密码：POST body {password}，与 KV 中 key='pwd' 比对。
// KV 中无值时使用默认密码 cealin2026。
// 修改密码走 /api/auth/change（见 auth/change.js）。

const DEFAULT_PWD = 'cealin2026';
const PWD_KEY = 'pwd';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });

export async function onRequest(context) {
  const { env, request } = context;

  if (request.method !== 'POST') {
    return json({ ok: false, error: '不支持的请求方法' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ ok: false, error: '请求体不是合法的 JSON' }, 400);
  }

  const password = String(body.password || '');
  let stored;
  try {
    stored = (await env.GUESTBOOK.get(PWD_KEY)) || DEFAULT_PWD;
  } catch (err) {
    return json({ ok: false, error: '读取密码失败' }, 500);
  }

  if (password !== stored) {
    return json({ ok: false, error: '密码错误' }, 403);
  }

  return json({ ok: true });
}
