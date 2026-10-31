// Cloudflare Pages Function: /api/files/delete
// 校验 X-Password 后删除 R2 bucket（binding 名 FILES）中的对象。
// 对象不存在也返回 ok。

const DEFAULT_PWD = 'cealin2026';
const PWD_KEY = 'pwd';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });

async function checkPassword(env, request) {
  const password = request.headers.get('X-Password') || '';
  const stored = (await env.GUESTBOOK.get(PWD_KEY)) || DEFAULT_PWD;
  return password === stored;
}

export async function onRequest(context) {
  const { env, request } = context;

  if (request.method !== 'POST') {
    return json({ ok: false, error: '不支持的请求方法' }, 405);
  }

  let authed;
  try {
    authed = await checkPassword(env, request);
  } catch (err) {
    return json({ ok: false, error: '读取密码失败' }, 500);
  }
  if (!authed) {
    return json({ ok: false, error: '密码错误' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ ok: false, error: '请求体不是合法的 JSON' }, 400);
  }

  const name = String(body.name || '');
  if (!name) {
    return json({ ok: false, error: '缺少 name 字段' }, 400);
  }

  try {
    await env.FILES.delete(name);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: '删除失败' }, 500);
  }
}
