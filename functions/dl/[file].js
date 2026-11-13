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

function failPage() {
  const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex">'
    + '<title>下载暂时不可用 · 赛琳</title>'
    + '<style>'
    + 'html,body{margin:0;height:100%}'
    + 'body{display:flex;align-items:center;justify-content:center;background:#0e0f12;color:#e8e6e1;'
    + 'font:15px/1.7 "Segoe UI","Microsoft YaHei",system-ui,sans-serif;padding:24px}'
    + '.box{max-width:460px;text-align:center;border:1px solid rgba(200,169,110,.28);border-radius:16px;'
    + 'padding:34px 28px;background:rgba(255,255,255,.03)}'
    + 'h1{margin:0 0 10px;font-size:19px;font-weight:600;letter-spacing:.02em}'
    + 'p{margin:0 0 6px;color:#a8a49c;font-size:14px}'
    + '.en{color:#6f6b64;font-size:12.5px}'
    + '.acts{margin-top:22px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap}'
    + 'a,button{appearance:none;cursor:pointer;border-radius:10px;padding:9px 18px;font-size:14px;'
    + 'text-decoration:none;font-family:inherit;transition:background .18s,transform .18s;border:1px solid transparent}'
    + '.primary{background:#c8a96e;color:#17181b;border-color:#c8a96e}'
    + '.primary:hover{background:#d6b87c;transform:translateY(-1px)}'
    + '.ghost{background:transparent;color:#c8a96e;border-color:rgba(200,169,110,.4)}'
    + '.ghost:hover{background:rgba(200,169,110,.1)}'
    + '</style></head><body><div class="box">'
    + '<h1>安装包暂时取不到</h1>'
    + '<p>下载通道刚刚没有响应，通常是瞬时网络抖动，重新试一次一般就好了。</p>'
    + '<p class="en">The download channel is temporarily unavailable. Please try again in a moment.</p>'
    + '<div class="acts"><button class="primary" onclick="location.reload()">重新下载</button>'
    + '<a class="ghost" href="/download">返回下载页</a></div>'
    + '</div></body></html>';
  return new Response(html, {
    status: 502,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '5'
    }
  });
}

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
    return failPage();
  }

  // 416：客户端请求的 Range 超出文件范围，属正常语义，原样透传供下载器自行处理
  if (upstream.status === 416) {
    const h416 = new Headers({ 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
    const cr416 = upstream.headers.get('Content-Range');
    if (cr416) h416.set('Content-Range', cr416);
    return new Response(null, { status: 416, headers: h416 });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return failPage();
  }

  const headers = new Headers();
  headers.set('Content-Type', item.type);
  headers.set('Content-Disposition', 'attachment; filename="' + item.name + '"');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=3600');

  const len = upstream.headers.get('Content-Length');
  if (len) headers.set('Content-Length', len);
  const cr = upstream.headers.get('Content-Range');
  if (cr) headers.set('Content-Range', cr);

  if (method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }

  return new Response(upstream.body, { status: upstream.status === 206 ? 206 : 200, headers });
}
