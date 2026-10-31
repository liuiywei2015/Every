// Cloudflare Pages Function: /api/auth/change
// 修改云储存密码：POST body {old,new}，校验旧密码后写入 KV key='pwd'。

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

  const oldPwd = String(body.old || '');
  const newPwd = String(body.new || '');

  let stored;
  try {
    stored = (await env.GUESTBOOK.get(PWD_KEY)) || DEFAULT_PWD;
  } catch (err) {
    return json({ ok: false, error: '读取密码失败' }, 500);
  }

  if (oldPwd !== stored) {
    return json({ ok: false, error: '旧密码错误' }, 403);
  }

  if (newPwd.length < 4 || newPwd.length > 64) {
    return json({ ok: false, error: '新密码长度需在 4-64 位之间' }, 400);
  }

  try {
    await env.GUESTBOOK.put(PWD_KEY, newPwd);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: '写入密码失败' }, 500);
  }
}
