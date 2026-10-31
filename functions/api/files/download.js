// Cloudflare Pages Function: /api/files/download
// 校验 X-Password 后从 R2 bucket（binding 名 FILES）取对象并返回响应体。

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

  if (request.method !== 'GET') {
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

  const url = new URL(request.url);
  const name = url.searchParams.get('name') || '';
  if (!name) {
    return json({ ok: false, error: '缺少 name 参数' }, 400);
  }

  try {
    const obj = await env.FILES.get(name);
    if (!obj) {
      return json({ ok: false, error: '文件不存在' }, 404);
    }

    const headers = {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(name)
    };
    return new Response(obj.body, { headers });
  } catch (err) {
    return json({ ok: false, error: '下载失败' }, 500);
  }
}
