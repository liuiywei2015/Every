// Cloudflare Pages Function: /api/messages
// 通过 KV（绑定名 GUESTBOOK）存储留言 JSON 数组，实现跨设备同步。
// KV 绑定方式见项目根目录 wrangler.toml 中的注释。

const KEY = 'messages';

async function readMessages(env) {
  const raw = await env.GUESTBOOK.get(KEY, 'json');
  return Array.isArray(raw) ? raw : [];
}

export async function onRequest(context) {
  const { env, request } = context;

  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });

  if (request.method === 'GET') {
    try {
      const messages = await readMessages(env);
      return json({ ok: true, messages });
    } catch (err) {
      return json({ ok: false, error: '读取留言失败' }, 500);
    }
  }

  if (request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch (err) {
      return json({ ok: false, error: '请求体不是合法的 JSON' }, 400);
    }

    const name = String(body.name || '').trim().slice(0, 20) || '访客';
    const text = String(body.text || '').trim().slice(0, 500);
    if (!text) {
      return json({ ok: false, error: '留言内容不能为空' }, 400);
    }

    // 服务端补充时间，避免依赖客户端时钟，保证各设备看到一致时间
    const time = new Date().toISOString();

    try {
      const messages = await readMessages(env);
      messages.push({ name, text, time });
      await env.GUESTBOOK.put(KEY, JSON.stringify(messages));
      return json({ ok: true, message: { name, text, time } });
    } catch (err) {
      return json({ ok: false, error: '写入留言失败' }, 500);
    }
  }

  return json({ ok: false, error: '不支持的请求方法' }, 405);
}
