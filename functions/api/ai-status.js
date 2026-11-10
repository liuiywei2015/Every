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

// 视觉模型候选（POST {vision:true} 时逐个试探）
const VISION_CANDIDATES = [
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/meta/llama-3.2-11b-vision-instruct',
  '@cf/meta/llama-3.2-90b-vision-instruct',
  '@cf/unum/uform-gen2-qwen-500m'
];

// 64x64 纯白 PNG，用于视觉模型连通性探测
const VISION_PROBE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PMQ0AAAwDoPo33UrYvQQckD4XAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAYHLAMpT0sIcNbcEAAAAAElFTkSuQmCC';

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

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

  let vision = false;
  let wanted = null;
  if (request.method === 'POST') {
    try {
      const body = await request.json();
      if (body && body.vision) {
        vision = true;
        wanted = Array.isArray(body.models) && body.models.length
          ? body.models.slice(0, 6)
          : VISION_CANDIDATES;
      } else if (body && typeof body.model === 'string' && body.model) wanted = [body.model];
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
      const res = vision
        ? await env.AI.run(model, {
          image: Array.from(b64ToBytes(VISION_PROBE_PNG)),
          prompt: 'Describe this image in one short sentence.',
          max_tokens: 40
        })
        : await env.AI.run(model, {
          messages: [
            { role: 'system', content: 'You are a health check. Reply with exactly: pong' },
            { role: 'user', content: 'ping' }
          ],
          max_tokens: 8
        });
      let text = '';
      if (res && typeof res.response === 'string') text = res.response;
      else if (res && typeof res.result === 'string') text = res.result;
      else if (res && typeof res.description === 'string') text = res.description;
      else if (res && Array.isArray(res.result)) text = JSON.stringify(res.result).slice(0, 100);
      results.push({ model: model, ok: true, text: text.slice(0, 100) });
    } catch (err) {
      results.push({ model: model, ok: false, error: String((err && err.message) || err).slice(0, 240) });
    }
  }
  out.probe = results;
  if (vision) out.vision = true;

  return json(out);
}
