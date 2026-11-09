// Cloudflare Pages Function: /api/ai-status
// 诊断接口：检测 Workers AI 绑定是否已生效，并做一次最小推理验证。
//
// GET  /api/ai-status          只检测 env.AI 是否存在
// POST /api/ai-status {probe:true}  额外跑一次最小推理，验证模型可调用
//
// 返回示例：
//   { ok: true, bound: true, probe: { ok: true, model: "@cf/meta/llama-3.1-8b-instruct", text: "pong" } }
//   { ok: true, bound: false, hint: "未检测到 AI 绑定..." }

const PROBE_MODEL = '@cf/meta/llama-3.1-8b-instruct';

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequest(context) {
  const { env, request } = context;

  const bound = !!(env && env.AI && typeof env.AI.run === 'function');
  const out = {
    ok: true,
    bound: bound,
    compatibility_date: (env && env.CF_PAGES_BRANCH !== undefined) ? 'pages' : 'unknown'
  };

  if (!bound) {
    out.hint = '未检测到 AI 绑定：请确认 wrangler.toml 的 [ai] binding="AI" 已被本次部署采纳，或在 Pages 项目 Settings -> Bindings 中手动添加 Workers AI（变量名 AI）。';
    return json(out);
  }

  let wantProbe = false;
  if (request.method === 'POST') {
    try {
      const body = await request.json();
      wantProbe = !!(body && body.probe);
    } catch (err) {
      wantProbe = false;
    }
  }

  if (!wantProbe) {
    out.hint = '绑定已存在。POST {"probe":true} 可验证模型实际可调用。';
    return json(out);
  }

  try {
    const res = await env.AI.run(PROBE_MODEL, {
      messages: [
        { role: 'system', content: 'You are a health check. Reply with exactly: pong' },
        { role: 'user', content: 'ping' }
      ],
      max_tokens: 8
    });
    let text = '';
    if (res && typeof res.response === 'string') text = res.response;
    out.probe = { ok: true, model: PROBE_MODEL, text: text.slice(0, 100) };
  } catch (err) {
    out.probe = { ok: false, model: PROBE_MODEL, error: String((err && err.message) || err).slice(0, 300) };
  }

  return json(out);
}
