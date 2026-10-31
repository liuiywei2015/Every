// Cloudflare Pages Function: /api/files/upload
// 校验 X-Password 后接收 multipart/form-data 的 file 字段，
// 写入 R2 bucket（binding 名 FILES）。单文件上限 50MB。

const DEFAULT_PWD = 'cealin2026';
const PWD_KEY = 'pwd';
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

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

// 文件名安全清洗：去掉路径分隔符与控制字符、去除前导点、截断 120 字符
function sanitizeName(raw) {
  let s = String(raw || '').replace(/[\\/\x00-\x1f]/g, '').trim();
  s = s.replace(/^\.+/, '');
  if (s.length > 120) s = s.slice(0, 120);
  return s;
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

  let form;
  try {
    form = await request.formData();
  } catch (err) {
    return json({ ok: false, error: '请以 multipart/form-data 上传' }, 400);
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return json({ ok: false, error: '缺少 file 字段' }, 400);
  }

  if (file.size > MAX_SIZE) {
    return json({ ok: false, error: '文件超过 50MB 上限' }, 413);
  }

  const name = sanitizeName(file.name);
  if (!name) {
    return json({ ok: false, error: '文件名无效' }, 400);
  }

  try {
    await env.FILES.put(name, file.stream(), {
      httpMetadata: {
        contentType: file.type || 'application/octet-stream'
      }
    });
    return json({ ok: true, name, size: file.size });
  } catch (err) {
    return json({ ok: false, error: '上传失败' }, 500);
  }
}
