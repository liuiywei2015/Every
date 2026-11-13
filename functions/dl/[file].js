// Cloudflare Pages Function: /dl/[file]
// 站内直链下载代理：访问者只和 cealin.pages.dev 通信，由边缘节点去拉取上游大文件，
// 不会在浏览器里直接访问 GitHub，因此无需任何加速器/代理。
//
// 用途：Windows 客户端、灵动岛等 Electron 安装包体积远超 Pages 单文件 25MB 限制，
// 无法放进 downloads/ 静态目录，改为经本函数流式转发（支持 Range 断点续传）。
//
// 白名单式映射，禁止任意 URL 透传（避免被当成开放代理滥用）。

const FILES = {
  'dynamic-island': {
    url: 'https://github.com/liuiywei2015/Every/releases/download/dynamic-island-v1.0.0/DynamicIsland-1.0.0-win-x64.zip',
    name: 'DynamicIsland-1.0.0-win-x64.zip',
    type: 'application/zip'
  },
  'cealin-win': {
    url: 'https://github.com/liuiywei2015/Every/releases/download/v26.11.8/Cealin-26.11.8-x64.exe',
    name: 'Cealin-26.11.8-x64.exe',
    type: 'application/octet-stream'
  },
  'cealin-admin-win': {
    url: 'https://github.com/liuiywei2015/Every/releases/download/v26.11.8/Cealin-admin-26.11.8-x64.exe',
    name: 'Cealin-admin-26.11.8-x64.exe',
    type: 'application/octet-stream'
  }
};

const RETRY_HINT = '安装包暂时取不到，请稍后重试；若持续失败，可在 GitHub Releases 页面自行下载。';

export async function onRequest(context) {
  const { request, params } = context;
  const method = request.method.toUpperCase();

  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const key = String((params && params.file) || '').toLowerCase().replace(/\.(zip|exe)$/, '');
  const item = FILES[key];
  if (!item) {
    return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  const range = request.headers.get('Range');
  const upHeaders = { 'User-Agent': 'Cealin-Pages-Proxy/1.0' };
  if (range) upHeaders['Range'] = range;

  let upstream;
  try {
    upstream = await fetch(item.url, {
      method: method === 'HEAD' ? 'GET' : 'GET',
      headers: upHeaders,
      redirect: 'follow'
    });
  } catch (err) {
    return new Response(RETRY_HINT, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response(RETRY_HINT, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  const headers = new Headers();
  headers.set('Content-Type', item.type);
  headers.set('Content-Disposition', 'attachment; filename="' + item.name + '"');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=86400');

  const len = upstream.headers.get('Content-Length');
  if (len) headers.set('Content-Length', len);
  const cr = upstream.headers.get('Content-Range');
  if (cr) headers.set('Content-Range', cr);

  if (method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }

  return new Response(upstream.body, { status: upstream.status === 206 ? 206 : 200, headers });
}
