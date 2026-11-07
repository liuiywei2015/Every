// Cloudflare Pages Function: /api/notice
// 公告读写：保存时自动翻译为 zh/en/ja/ko/es 五种语言，与原文一起存入同一 KV 键。
//
// 存储结构（v2，KV 键 notice）：
//   {
//     v: 2,
//     sourceLang: 'zh',
//     translated: true | false,        // 五种语言是否齐全
//     updatedAt: <毫秒时间戳>,
//     langs: { zh: '原文', en: '…', ja: '…', ko: '…', es: '…' }
//   }
//
// 兼容旧数据：历史版本在 KV 里存的是纯文本字符串，读取端自动识别为 { zh: 原文 }，
// 不报错、不丢内容；下次保存时自动升级为上面的 JSON 结构。

const KEY = 'notice';
const DEFAULT_NOTICE = '欢迎来到 Cealin 聊天室，请文明交流，聊天记录云端同步。';
const DEFAULT_ADMIN_PWD = 'liuyiwei150314';
const MAX_LEN = 2000;              // 中文原文上限，与后台字数限制一致
const MAX_TRANSLATED_LEN = 8000;   // 单语种译文上限（译文长度可能膨胀）
const SOURCE_LANG = 'zh';
const LANGS = ['zh', 'en', 'ja', 'ko', 'es'];

// 免费公共翻译接口的语言代码映射
const OUT_LANG = { en: 'en', ja: 'ja', ko: 'ko', es: 'es' };

// Workers AI（若绑定存在则优先使用）：多语翻译模型
const AI_MODEL = '@cf/meta/m2m100-1.2b';

// 翻译预算：无论翻译是否完成，都不能阻塞公告保存
const TRANSLATE_BUDGET = 20000;
const GOOGLE_TIMEOUT = 6000;
const MEMORY_TIMEOUT = 8000;
const HTTP_TIMEOUT = GOOGLE_TIMEOUT;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

/* ===================== 存储结构解析（含旧值兼容） ===================== */

function normalizeLangs(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (let i = 0; i < LANGS.length; i++) {
    const code = LANGS[i];
    const v = input[code];
    if (typeof v === 'string' && v.trim()) out[code] = v.trim().slice(0, MAX_TRANSLATED_LEN);
  }
  return out;
}

// 把 KV 里的任意历史值统一解析为 { translated, updatedAt, langs }
function parseStored(raw) {
  if (raw === null || raw === undefined) {
    return { translated: false, updatedAt: 0, langs: { zh: DEFAULT_NOTICE }, legacy: false };
  }
  if (typeof raw === 'object') {
    return normalizeRecord(raw, false);
  }
  const str = String(raw);
  const head = str.trim().charAt(0);
  if (head === '{') {
    try {
      const obj = JSON.parse(str);
      if (obj && typeof obj === 'object') return normalizeRecord(obj, false);
    } catch (e) {
      // 不是合法 JSON（例如公告正文本身就以 { 开头），按旧纯文本处理
    }
  }
  const langs = {};
  if (str.trim()) langs[SOURCE_LANG] = str;
  return { translated: false, updatedAt: 0, langs: langs, legacy: true };
}

function normalizeRecord(obj, legacy) {
  const src = obj.langs || obj.noticeByLang || obj.i18n;
  let langs = normalizeLangs(src);
  if (!langs[SOURCE_LANG] && typeof obj.notice === 'string' && obj.notice.trim()) {
    langs[SOURCE_LANG] = obj.notice.trim().slice(0, MAX_TRANSLATED_LEN);
  }
  let translated = obj.translated === true;
  if (!translated) {
    translated = LANGS.every(function (code) { return !!langs[code]; });
  }
  return {
    translated: !!translated,
    updatedAt: Number(obj.updatedAt) || 0,
    langs: langs,
    legacy: !!legacy
  };
}

/* ===================== 文本切分 / 清洗 ===================== */

function splitText(text, size) {
  const str = String(text || '');
  if (str.length <= size) return str ? [str] : [];
  const parts = [];
  let buf = '';
  const paragraphs = str.split(/\n/);
  for (let i = 0; i < paragraphs.length; i++) {
    let line = paragraphs[i];
    const joiner = buf ? '\n' : '';
    if ((buf + joiner + line).length <= size) {
      buf = buf + joiner + line;
      continue;
    }
    if (buf) {
      parts.push(buf);
      buf = '';
    }
    // 单行本身超长时硬切
    while (line.length > size) {
      parts.push(line.slice(0, size));
      line = line.slice(size);
    }
    buf = line;
  }
  if (buf) parts.push(buf);
  return parts;
}

function cleanText(s) {
  if (typeof s !== 'string') return '';
  const t = s.replace(/^\s+|\s+$/g, '');
  if (!t) return '';
  return t.slice(0, MAX_TRANSLATED_LEN);
}

function hasCJK(s) {
  return /[\u3400-\u9fff]/.test(String(s || ''));
}

// 译文与原文完全一致且原文含中文 → 视为该接口未真正翻译
function looksUntranslated(src, out) {
  if (!out) return true;
  if (out === src) return true;
  return false;
}

/* ===================== 翻译引擎 ===================== */

async function fetchWithTimeout(url, init, timeout) {
  let timer = null;
  let signal = null;
  try {
    if (typeof AbortController === 'function') {
      const ctrl = new AbortController();
      signal = ctrl.signal;
      timer = setTimeout(function () { ctrl.abort(); }, timeout || HTTP_TIMEOUT);
    }
    const opts = Object.assign({}, init || {});
    if (signal) opts.signal = signal;
    return await fetch(url, opts);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Workers AI 返回结构兼容多种形态
function pickAIText(out) {
  if (!out) return '';
  if (typeof out === 'string') return out;
  if (typeof out.translated_text === 'string') return out.translated_text;
  if (typeof out.response === 'string') return out.response;
  if (Array.isArray(out.translated_text) && out.translated_text.length) return String(out.translated_text[0] || '');
  if (Array.isArray(out.responses) && out.responses.length) {
    const r = out.responses[0];
    if (typeof r === 'string') return r;
    if (r && typeof r.response === 'string') return r.response;
  }
  if (out.result && typeof out.result.translated_text === 'string') return out.result.translated_text;
  return '';
}

async function runWorkersAI(env, text, target) {
  if (!env || !env.AI || typeof env.AI.run !== 'function') return '';
  const out = await env.AI.run(AI_MODEL, {
    text: text,
    source_lang: SOURCE_LANG,
    target_lang: target
  });
  return cleanText(pickAIText(out));
}

async function runGoogle(text, target) {
  const tl = OUT_LANG[target];
  if (!tl) return '';
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=' + tl + '&dt=t';
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: 'q=' + encodeURIComponent(text)
  }, HTTP_TIMEOUT);
  if (!resp || !resp.ok) return '';
  const data = await resp.json();
  const seg = data && data[0];
  if (!Array.isArray(seg)) return '';
  let out = '';
  for (let i = 0; i < seg.length; i++) {
    const item = seg[i];
    if (item && typeof item[0] === 'string') out += item[0];
  }
  return cleanText(out);
}

async function runMyMemory(text, target) {
  const tl = OUT_LANG[target];
  if (!tl) return '';
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=' + encodeURIComponent('zh-CN|' + tl);
  const resp = await fetchWithTimeout(url, { method: 'GET' }, MEMORY_TIMEOUT);
  if (!resp || !resp.ok) return '';
  const data = await resp.json();
  const status = Number(data && data.responseStatus);
  if (status && status !== 200) return '';
  const txt = data && data.responseData && data.responseData.translatedText;
  if (typeof txt !== 'string') return '';
  if (/MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(txt)) return '';
  return cleanText(txt);
}

// 单段文本翻译：Workers AI 优先 → Google 免费接口 → MyMemory 免费接口
async function translateChunk(env, chunk, target, stats) {
  if (env && env.AI) {
    try {
      const s = await runWorkersAI(env, chunk, target);
      if (s && !looksUntranslated(chunk, s)) {
        stats.ai = true;
        return s;
      }
    } catch (e) {
      // 绑定存在但调用失败（模型不可用 / 配额），继续降级
    }
  }
  try {
    const s = await runGoogle(chunk, target);
    if (s && !looksUntranslated(chunk, s)) {
      stats.http = true;
      return s;
    }
  } catch (e) {}
  try {
    // MyMemory 单次查询有长度限制，这里再按 400 字符切片
    const pieces = splitText(chunk, 400);
    const done = [];
    for (let i = 0; i < pieces.length; i++) {
      const s = await runMyMemory(pieces[i], target);
      if (!s) return '';
      done.push(s);
    }
    const joined = cleanText(done.join(' '));
    if (joined) {
      stats.http = true;
      return joined;
    }
  } catch (e) {}
  return '';
}

// 整篇翻译（按长度切片串行，避免单次请求过大）
async function translateWhole(env, text, target, stats) {
  const pieces = splitText(text, 1200);
  const out = [];
  for (let i = 0; i < pieces.length; i++) {
    const s = await translateChunk(env, pieces[i], target, stats);
    if (!s) return '';
    out.push(s);
  }
  return cleanText(out.join('\n'));
}

/* ===================== 请求处理 ===================== */

async function readAdminPwd(env) {
  let pwd = '';
  try {
    pwd = await env.GUESTBOOK.get('admin_pwd');
  } catch (e) {
    pwd = '';
  }
  return pwd || DEFAULT_ADMIN_PWD;
}

async function handleGet(env) {
  let raw = null;
  try {
    raw = await env.GUESTBOOK.get(KEY);
  } catch (e) {
    raw = null;
  }
  const rec = parseStored(raw);
  const langs = rec.langs || {};
  return json({
    ok: true,
    notice: langs[SOURCE_LANG] || DEFAULT_NOTICE,
    noticeByLang: langs,
    languages: LANGS,
    sourceLang: SOURCE_LANG,
    translated: !!rec.translated,
    updatedAt: rec.updatedAt || 0
  }, 200);
}

async function handlePost(env, request) {
  let body = null;
  try {
    body = await request.json();
  } catch (e) {
    body = null;
  }
  if (!body || typeof body !== 'object') return json({ ok: false, error: '请求格式错误' }, 400);

  const adminPwd = await readAdminPwd(env);
  if (body.password !== adminPwd) return json({ ok: false, error: '密码错误' }, 401);

  // 仅校验密码（登录）
  if (body.action === 'login') return json({ ok: true, role: 'admin' }, 200);

  // 已存在的分语种内容（可选传入，用于跳过重复翻译）
  const preset = normalizeLangs(body.langs || body.noticeByLang);
  let source = typeof body.notice === 'string' ? body.notice.trim() : '';
  if (!source) source = preset[SOURCE_LANG] || '';
  if (source.length > MAX_LEN) return json({ ok: false, error: '公告内容不能超过2000字' }, 400);

  // 中文内容未变时复用已有译文，避免同一篇公告被反复翻译
  if (source) {
    let existed = null;
    try {
      existed = parseStored(await env.GUESTBOOK.get(KEY));
    } catch (e) {
      existed = null;
    }
    if (existed && existed.langs && existed.langs[SOURCE_LANG] === source) {
      for (let i = 0; i < LANGS.length; i++) {
        const code = LANGS[i];
        if (code !== SOURCE_LANG && !preset[code] && existed.langs[code]) preset[code] = existed.langs[code];
      }
    }
  }

  // 空内容：删除键，前台回退默认公告
  if (!source) {
    try {
      await env.GUESTBOOK.delete(KEY);
    } catch (e) {
      return json({ ok: false, error: '公告清空失败' }, 500);
    }
    return json({
      ok: true,
      cleared: true,
      translated: false,
      notice: '',
      noticeByLang: {},
      languages: LANGS,
      missing: LANGS.slice(1)
    }, 200);
  }

  // 翻译：五语并行，任一失败只影响该语种，不阻塞保存
  const langs = { zh: source };
  const stats = { ai: false, http: false };
  const targets = LANGS.filter(function (code) { return code !== SOURCE_LANG; });
  for (let i = 0; i < targets.length; i++) {
    if (preset[targets[i]]) langs[targets[i]] = preset[targets[i]];
  }
  const waitAll = Promise.all(targets.map(async function (code) {
    if (langs[code]) return;
    try {
      const text = await translateWhole(env, source, code, stats);
      if (text) langs[code] = text;
    } catch (e) {
      // 单语失败忽略
    }
  }));

  // 预算保护：超时也要先把公告存下来
  await Promise.race([
    waitAll,
    new Promise(function (resolve) { setTimeout(resolve, TRANSLATE_BUDGET); })
  ]);

  const missing = LANGS.filter(function (code) { return !langs[code]; });
  const record = {
    v: 2,
    sourceLang: SOURCE_LANG,
    translated: missing.length === 0,
    updatedAt: Date.now(),
    langs: langs
  };

  try {
    await env.GUESTBOOK.put(KEY, JSON.stringify(record));
  } catch (e) {
    return json({ ok: false, error: '公告保存失败' }, 500);
  }

  return json({
    ok: true,
    translated: record.translated,
    missing: missing,
    engine: stats.ai ? 'workers-ai' : (stats.http ? 'public-api' : 'none'),
    updatedAt: record.updatedAt,
    notice: langs[SOURCE_LANG],
    noticeByLang: langs,
    languages: LANGS
  }, 200);
}

export async function onRequest(context) {
  const { request, env } = context;
  try {
    if (request.method === 'GET') return await handleGet(env);
    if (request.method === 'POST') return await handlePost(env, request);
    return json({ ok: false, error: '方法不支持' }, 405);
  } catch (e) {
    return json({ ok: false, error: '服务异常：' + ((e && e.message) || 'unknown') }, 500);
  }
}
