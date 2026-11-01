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

  return json({ ok: false, error: '不支持的请求方法' }, 405);
}
