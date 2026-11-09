// Cloudflare Pages Function: /api/ai-status
// 诊断接口：检测 Workers AI 绑定是否已生效，并做一次最小推理验证。
//
// GET  /api/ai-status          只检测 env.AI 是否存在
// POST /api/ai-status {probe:true}  额外跑一次最小推理，验证模型可调用
//
// 返回示例：
//   { ok: true, bound: true, probe: { ok: true, model: "@cf/meta/llama-3.1-8b-instruct", text: "pong" } }
//   { ok: true, bound: false, hint: "未检测到 AI 绑定..." }

const PROBE_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// 依次试探的候选模型（POST {models:[...]} 可覆盖）
const CANDIDATES = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/qwen/qwen2.5-7b-instruct',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/google/gemma-3-12b-it',
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'
];

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

  let wanted = null;
  if (request.method === 'POST') {
    try {
      const body = await request.json();
      // 调试分支：用审核提示词跑一次，返回原始响应结构（用于排查解析失败）
      if (body && body.raw === true) {
        try {
          const res = await env.AI.run(PROBE_MODEL, {
            messages: [
              { role: 'system', content: '你是内容审核助手，只输出一行 JSON：{"verdict":"pass|reject","score":0-100,"reason":"不超过60字的中文理由"}' },
              { role: 'user', content: '举报对象类型：account\n举报理由：spam\n举报补充说明：该账号连续发布刷单兼职广告并附带站外联系方式' }
            ],
            max_tokens: 300,
            temperature: 0.1
          });
          out.raw = {
            res_type: typeof res,
            res_keys: res && typeof res === 'object' ? Object.keys(res) : null,
            response_type: res ? typeof res.response : null,
            response: res && typeof res.response === 'string' ? res.response.slice(0, 800) : (res ? res.response : null),
            result_type: res ? typeof res.result : null,
            result: res && typeof res.result === 'object' ? JSON.stringify(res.result).slice(0, 800) : (res ? res.result : null),
            dumped: JSON.stringify(res).slice(0, 1000)
          };
        } catch (err) {
          out.raw = { error: String((err && err.message) || err).slice(0, 300) };
        }
        return json(out);
      }
      if (body && typeof body.model === 'string' && body.model) wanted = [body.model];
      else if (body && Array.isArray(body.models) && body.models.length) wanted = body.models.slice(0, 8);
      else if (body && body.probe) wanted = [PROBE_MODEL];
    } catch (err) {
      wanted = null;
    }
  }

  if (!wanted) {
    out.hint = '绑定已存在。POST {"probe":true} 可验证默认模型；POST {"models":[...]} 可批量试探候选。';
    return json(out);
  }

  const results = [];
  for (let i = 0; i < wanted.length; i++) {
    const model = String(wanted[i]);
    try {
      const res = await env.AI.run(model, {
        messages: [
          { role: 'system', content: 'You are a health check. Reply with exactly: pong' },
          { role: 'user', content: 'ping' }
        ],
        max_tokens: 8
      });
      let text = '';
      if (res && typeof res.response === 'string') text = res.response;
      else if (res && typeof res.result === 'string') text = res.result;
      results.push({ model: model, ok: true, text: text.slice(0, 100) });
    } catch (err) {
      results.push({ model: model, ok: false, error: String((err && err.message) || err).slice(0, 240) });
    }
  }
  out.probe = results;

  return json(out);
}
