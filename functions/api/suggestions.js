// Cloudflare Pages Function: /api/suggestions
// 建议功能后端接口：
//   action=submit  -> 匿名提交建议（公开，无需密码）
//   action=list    -> 管理员查看建议列表（需密码校验，新在前）
//   action=delete  -> 管理员删除单条建议（需密码校验）
// KV key 约定（绑定名 GUESTBOOK，见 wrangler.toml）：
//   suggestions -> JSON 数组 [{ id, name, email, content, ts }]，新建议 unshift 到最前
// 管理员密码校验方式与 admin-rooms.js / auth.js 保持一致。

const DEFAULT_ADMIN_PWD = 'liuyiwei150314';
const KEY = 'suggestions';
const MAX_CONTENT_LEN = 1000;
const MAX_NAME_LEN = 30;
const MAX_EMAIL_LEN = 120;

// ============ SMTP 邮件通知（原生 Node tls，零 npm 依赖） ============
// 发件 / 收件邮箱与授权码一律从环境变量读取，严禁硬编码：
//   SMTP_USER  发件邮箱（QQ 邮箱地址，如 wilson150314@qq.com）
//   SMTP_PASS  QQ 邮箱 SMTP 授权码（开启 SMTP 服务后获取，非登录密码）
//   SMTP_TO    收件邮箱，缺省时取 SMTP_USER
// 未配置环境变量时优雅降级：仅写 KV、不发送邮件、接口照常返回成功。
const SMTP_HOST = 'smtp.qq.com';
const SMTP_PORT = 465;
const SMTP_TIMEOUT = 15000;

// 发送单封 SMTP 邮件：465 端口直连 TLS，AUTH PLAIN + base64。
// 返回 { sent: true } 或 { sent: false, reason: '...' }，任何失败都不抛出。
function sendSmtpMail(env, { from, to, subject, text }) {
  return new Promise(function (resolve) {
    let tls;
    try {
      tls = require('tls');
    } catch (err) {
      resolve({ sent: false, reason: '运行环境不支持 tls（需开启 nodejs_compat），邮件未发送' });
      return;
    }

    let socket;
    let settled = false;
    const done = function (ok, reason) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (socket) socket.destroy(); } catch (err) { /* 忽略 */ }
      resolve({ sent: !!ok, reason: reason });
    };
    const timer = setTimeout(function () {
      done(false, 'SMTP 会话超时');
    }, SMTP_TIMEOUT);

    try {
      socket = tls.connect({
        host: SMTP_HOST,
        port: SMTP_PORT,
        servername: SMTP_HOST,
        rejectUnauthorized: false // QQ 邮箱证书链在部分运行时的校验不稳定，凭据仍经 TLS 加密传输
      });
    } catch (err) {
      done(false, '建立 TLS 连接失败');
      return;
    }

    let buffer = '';
    let step = 'banner'; // banner -> ehlo -> auth -> from -> rcpt -> data -> body -> quit
    const say = function (cmd) {
      step = cmd;
      socket.write(cmd + '\r\n');
    };

    socket.on('error', function () {
      done(false, 'SMTP 连接错误');
    });
    socket.on('close', function () {
      done(false, 'SMTP 连接被关闭');
    });
    socket.on('data', function (chunk) {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\r\n')) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (step === 'banner') {
          if (/^220/.test(raw)) say('EHLO cealin.local');
          else { done(false, '服务器未就绪'); return; }
        } else if (step === 'ehlo') {
          if (/^250-/.test(raw)) { /* 多行响应，继续等待末行 */ }
          else if (/^250 /.test(raw)) {
            const auth = Buffer.from('\u0000' + from + '\u0000' + (env.SMTP_PASS || '')).toString('base64');
            say('AUTH PLAIN ' + auth);
          } else { done(false, 'EHLO 失败'); return; }
        } else if (step === 'auth') {
          if (/^235/.test(raw)) say('MAIL FROM:<' + from + '>');
          else { done(false, 'SMTP 认证失败（请检查授权码）'); return; }
        } else if (step === 'from') {
          if (/^250/.test(raw)) say('RCPT TO:<' + to + '>');
          else { done(false, '发件地址被拒绝'); return; }
        } else if (step === 'rcpt') {
          if (/^250/.test(raw)) say('DATA');
          else { done(false, '收件地址被拒绝'); return; }
        } else if (step === 'data') {
          if (/^354/.test(raw)) {
            const payload = [
              'From: ' + from,
              'To: ' + to,
              'Subject: =?UTF-8?B?' + Buffer.from(subject, 'utf8').toString('base64') + '?=',
              'Date: ' + new Date().toUTCString(),
              'MIME-Version: 1.0',
              'Content-Type: text/plain; charset=UTF-8',
              'Content-Transfer-Encoding: 8bit',
              '',
              text,
              '.'
            ].join('\r\n');
            socket.write(payload + '\r\n');
            step = 'body';
          } else { done(false, 'DATA 被拒绝'); return; }
        } else if (step === 'body') {
          if (/^250/.test(raw)) say('QUIT');
          else { done(false, '邮件内容被拒绝'); return; }
        } else if (step === 'quit') {
          if (/^221/.test(raw)) done(true);
          else done(true);
          return;
        }
      }
    });
  });
}

// 组装建议通知邮件并发送；未配置 SMTP 环境变量时返回降级原因。
function sendSuggestionMail(env, item) {
  const user = env.SMTP_USER || '';
  const pass = env.SMTP_PASS || '';
  const to = env.SMTP_TO || user;
  if (!user || !pass || !to) {
    return Promise.resolve({ sent: false, reason: '未配置 SMTP 环境变量（SMTP_USER / SMTP_PASS / SMTP_TO）' });
  }
  const lines = [
    '昵称：' + (item.name || '匿名'),
    '邮箱：' + (item.email || '未填写'),
    '提交时间：' + new Date(item.ts).toLocaleString('zh-CN'),
    '',
    '建议内容：',
    item.content || ''
  ];
  return sendSmtpMail(env, {
    from: user,
    to: to,
    subject: 'Cealin 新建议',
    text: lines.join('\r\n')
  });
}

export async function onRequest(context) {
  const { env, request } = context;

  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });

  if (request.method !== 'POST') {
    return json({ ok: false, error: '不支持的请求方法' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ ok: false, error: '请求体不是合法的 JSON' }, 400);
  }

  const action = body && typeof body.action === 'string' ? body.action : '';

  // ---------- 提交建议（公开） ----------
  if (action === 'submit') {
    const name = body && typeof body.name === 'string' ? body.name.trim() : '';
    const email = body && typeof body.email === 'string' ? body.email.trim() : '';
    const content = body && typeof body.content === 'string' ? body.content.trim() : '';

    if (!content) {
      return json({ ok: false, error: '建议内容不能为空' }, 400);
    }
    if (content.length > MAX_CONTENT_LEN) {
      return json({ ok: false, error: '建议内容不能超过 ' + MAX_CONTENT_LEN + ' 字' }, 400);
    }
    if (name.length > MAX_NAME_LEN) {
      return json({ ok: false, error: '昵称不能超过 ' + MAX_NAME_LEN + ' 字' }, 400);
    }
    if (email.length > MAX_EMAIL_LEN) {
      return json({ ok: false, error: '邮箱不能超过 ' + MAX_EMAIL_LEN + ' 字' }, 400);
    }

    try {
      let list = await env.GUESTBOOK.get(KEY, 'json');
      if (!Array.isArray(list)) list = [];
      if (list.length >= 500) list = list.slice(0, 499); // 最多保留 500 条

      const item = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        name: name || '匿名',
        email: email || '',
        content: content,
        ts: Date.now()
      };
      list.unshift(item);
      await env.GUESTBOOK.put(KEY, JSON.stringify(list));
      // 邮件通知：SMTP 环境变量已配置时发送到收件邮箱；未配置或发送失败均不影响接口结果（优雅降级）
      let mailInfo = { sent: false, reason: '未知原因' };
      try {
        mailInfo = await sendSuggestionMail(env, item);
      } catch (err) {
        mailInfo = { sent: false, reason: 'SMTP 发送异常' };
      }
      return json({ ok: true, id: item.id, mailSent: mailInfo.sent, mailReason: mailInfo.sent ? '' : (mailInfo.reason || '') });
    } catch (err) {
      return json({ ok: false, error: '服务异常，请稍后重试' }, 500);
    }
  }

  // 以下操作需管理员密码
  const password = body && typeof body.password === 'string' ? body.password : '';

  let adminPwd = DEFAULT_ADMIN_PWD;
  try {
    adminPwd = (await env.GUESTBOOK.get('admin_pwd')) || DEFAULT_ADMIN_PWD;
  } catch (err) {
    return json({ ok: false, error: '服务异常，请稍后重试' }, 500);
  }

  if (password !== adminPwd) {
    return json({ ok: false, error: '密码错误' }, 401);
  }

  // ---------- 管理员查看列表 ----------
  if (action === 'list') {
    try {
      let list = await env.GUESTBOOK.get(KEY, 'json');
      if (!Array.isArray(list)) list = [];
      return json({ ok: true, suggestions: list });
    } catch (err) {
      return json({ ok: false, error: '服务异常，请稍后重试' }, 500);
    }
  }

  // ---------- 管理员删除单条建议 ----------
  if (action === 'delete') {
    const id = body && typeof body.id === 'string' ? body.id : '';
    if (!id) {
      return json({ ok: false, error: '缺少建议 ID' }, 400);
    }
    try {
      let list = await env.GUESTBOOK.get(KEY, 'json');
      if (!Array.isArray(list)) list = [];
      const next = list.filter(function (it) {
        return !(it && it.id === id);
      });
      if (next.length === list.length) {
        return json({ ok: false, error: '建议不存在或已被删除' }, 404);
      }
      await env.GUESTBOOK.put(KEY, JSON.stringify(next));
      return json({ ok: true, deleted: true });
    } catch (err) {
      return json({ ok: false, error: '服务异常，请稍后重试' }, 500);
    }
  }

  return json({ ok: false, error: '未知操作' }, 400);
}
