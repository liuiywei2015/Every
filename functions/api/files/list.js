// Cloudflare Pages Function: /api/files/list
// 校验 X-Password 后列出 R2 bucket（binding 名 FILES）中全部对象。

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

  try {
    const objects = [];
    let cursor;
    do {
      const listed = await env.FILES.list({ cursor: cursor || undefined });
      objects.push(...listed.objects);
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);

    const files = objects.map(function (o) {
      return {
        name: o.key,
        size: o.size,
        uploaded: o.uploaded
      };
    });

    return json({ ok: true, files });
  } catch (err) {
    return json({ ok: false, error: '读取文件列表失败' }, 500);
  }
}
