// 临时自测接口：构造一条含图片 + .exe 附件的待审文章，跑一遍文章 AI 预审，然后完整清理。
// 仅用于验证 aiReview 链路，验证完成后本文件会被删除。
import { handleAiReview } from './articles.js';

const KEY_INDEX = 'article:index';
const PREFIX_ARTICLE = 'article:';
const TEST_PWD = 'liuyiwei150314';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export async function onRequest(context) {
  const { env, request } = context;
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  let body = {};
  try { body = await request.json(); } catch (err) { body = {}; }
  if (!body || body.password !== TEST_PWD) return json({ ok: false, error: 'bad_pwd' }, 401);

  const id = 'AISELFTEST' + Date.now();
  const assetId = 'A1';
  const imgB64 = typeof body.image === 'string' ? body.image : '';
  const backup = await env.GUESTBOOK.get(KEY_INDEX);

  const good = body.mode === 'good';
  const article = good ? {
    id: id,
    title: '用 Cloudflare Pages Functions 搭一个带 KV 的轻量博客',
    authorId: 'selftest',
    authorName: 'selftest',
    status: 'pending',
    tags: ['技术', '实践'],
    links: [],
    summary: '记录 Pages Functions 与 KV 配合的踩坑',
    body: '这篇记录我在个人站点上用 Pages Functions 配合 KV 存文章索引的实践。'
      + '路由按 /api/xxx 划分，索引用一个 JSON 数组存在 KV 里，正文单独一个 key，避免单值过大。'
      + '写入时先读索引、改完整体写回，注意并发覆盖的问题；读取时给 30 秒缓存，减少 KV 读次数。'
      + '整体方案很轻，适合个人小站，不需要额外数据库。',
    images: [],
    files: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    views: 0
  } : {
    id: id,
    title: '扫码加微信领福利，日入过千，加我拉你进群',
    authorId: 'selftest',
    authorName: 'selftest',
    status: 'pending',
    tags: ['福利'],
    links: ['http://example.com/invite'],
    summary: '扫码加微信领福利',
    body: '扫码加微信 ABC123，拉你进群领福利，日入过千，联系 QQ 99887766。名额有限，速来！',
    images: [{ assetId: assetId, name: 'qr.png', type: 'image/png', size: 15582 }],
    files: [{ assetId: 'F1', name: 'setup.exe', type: 'application/octet-stream', size: 2048 }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    views: 0
  };

  let result = null;
  try {
    if (imgB64 && !good) {
      await env.GUESTBOOK.put(
        PREFIX_ARTICLE + id + ':asset:' + assetId,
        JSON.stringify({ name: 'qr.png', type: 'image/png', size: 15582, kind: 'image', data: imgB64 })
      );
    }
    await env.GUESTBOOK.put(PREFIX_ARTICLE + id, JSON.stringify(article));

    const idx = backup ? JSON.parse(backup) : [];
    idx.push({
      id: id, title: article.title, authorId: 'selftest', authorName: 'selftest',
      status: 'pending', createdAt: article.createdAt, imgCount: 1, fileCount: 1
    });
    await env.GUESTBOOK.put(KEY_INDEX, JSON.stringify(idx));

    const resp = await handleAiReview(env, { id: id });
    result = await resp.json();
  } finally {
    try { await env.GUESTBOOK.delete(PREFIX_ARTICLE + id + ':asset:' + assetId); } catch (err) { /* ignore */ }
    try { await env.GUESTBOOK.delete(PREFIX_ARTICLE + id); } catch (err) { /* ignore */ }
    try {
      if (backup === null) await env.GUESTBOOK.delete(KEY_INDEX);
      else await env.GUESTBOOK.put(KEY_INDEX, backup);
    } catch (err) { /* ignore */ }
  }

  return json({ ok: true, cleaned: true, result: result });
}
