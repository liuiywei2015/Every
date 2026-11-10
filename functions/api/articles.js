// Cloudflare Pages Function: /api/articles
// 文章系统后端接口（文章区浏览 / 用户投稿 / 管理员审批）
//
// POST /api/articles  body.action 取值：
//   list        公开：已通过文章列表（关键词 / 标签 / 作者 / 排序 / 分页 + 标签聚合）
//   detail      公开：文章详情（待审 / 已驳回仅作者本人或管理员可读），并做浏览量合并写入
//   mine        登录用户：自己提交的全部文章（含待审核 / 已驳回）
//   uploadAsset 登录用户：单张图片 / 单个附件上传到投稿草稿区（逐个小写入，避免单篇一次写入过大）
//   submit      登录用户：新建或编辑投稿，写入后状态一律重置为 pending
//   review      管理员：listing 待审列表 / approve 通过 / reject 驳回 / revoke 撤销 / all 全部文章
//   delete      管理员：删除文章（连同 article:{id} 的全部附件键与索引条目）
// GET  /api/articles?action=asset&id=&assetId=[&authorId=|&pwd=]
//   读取附件二进制：图片 inline、文件 attachment；非公开文章的附件需作者或管理员身份
//
// KV key 约定（绑定名 GUESTBOOK，见 wrangler.toml）：
//   article:{id}                 -> { id, title, body, tags[], links[], images[], files[],
//                                     authorId, authorName, status, createdAt, updatedAt,
//                                     reviewedAt, rejectReason, views, viewsAt }
//   article:index                -> 摘要索引数组 [{ id, title, tags, authorId, authorName, status,
//                                     createdAt, updatedAt, summary, imgCount, fileCount, views, kw }]
//                                    最多 500 条，新文章 unshift 到最前
//   article:{id}:asset:{assetId} -> { name, type, size, kind, data(base64) }
//   article:draft:{draft}        -> { images: [...], files: [...] }   投稿草稿清单（提交后清除）
//   article:draft:{draft}:asset:{assetId} -> 同上，提交时迁移到正式 article:{id}:asset: 下
//
// status 取值：pending（待审核）/ approved（已通过）/ rejected（已驳回）
// 管理员密码校验方式与 admin-rooms.js / suggestions.js 保持一致（env.GUESTBOOK.get('admin_pwd')）。

const DEFAULT_ADMIN_PWD = 'liuyiwei150314';

const KEY_INDEX = 'article:index';
const PREFIX_ARTICLE = 'article:';
const PREFIX_DRAFT = 'article:draft:';
const INDEX_MAX = 500;
const ACCOUNT_PREFIX = 'account:';

// 正文与结构约束（接口侧二次校验，不依赖前端）
const TITLE_MIN = 10;
const TITLE_MAX = 120;
const BODY_MIN = 10;
const BODY_MAX = 20000;
const TAG_MAX_COUNT = 5;
const TAG_MAX_LEN = 20;
const LINK_MAX_COUNT = 10;
const LINK_MAX_LEN = 500;
const IMAGE_MAX_COUNT = 6;
const FILE_MAX_COUNT = 3;
const REASON_MAX_LEN = 200;

// 体积约束（字节）
const IMG_MAX_BYTES = 300 * 1024;
const IMG_TOTAL_BYTES = Math.round(1.2 * 1024 * 1024);
const FILE_MAX_BYTES = 2 * 1024 * 1024;
const FILE_TOTAL_BYTES = 3 * 1024 * 1024;
const ASSET_DATA_MAX = 4 * 1024 * 1024; // 单次上传的 base64 原始串上限

// 分页
const PAGE_SIZE_DEFAULT = 12;
const PAGE_SIZE_MAX = 50;

// 浏览量合并写入：同一篇文章 5 分钟内最多写一次 KV
const VIEW_WINDOW_MS = 5 * 60 * 1000;

const STATUS_SET = { pending: 1, approved: 1, rejected: 1 };

// ---------- AI 预审（Workers AI）----------
const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const AI_VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const AI_BATCH_MAX = 3;        // 单次请求最多预审篇数，避免函数超时
const AI_TEXT_MAX = 1500;      // 送模型的正文上限
const AI_REASON_MAX = 160;     // 回写理由长度上限
const AI_IMG_MAX = 3;          // 单篇最多送视觉模型的图片数
const AI_IMG_BYTES_MAX = 600 * 1024;
const ASSET_RISK_EXT = ['exe', 'bat', 'cmd', 'ps1', 'vbs', 'js', 'jar', 'msi', 'scr', 'com', 'pif', 'apk', 'dll', 'sh', 'lnk', 'iso'];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function fail(status, error, code) {
  const body = { ok: false, error };
  if (code) body.code = code;
  return json(body, status);
}

function str(v) {
  return typeof v === 'string' ? v : '';
}

function trimStr(v) {
  return str(v).replace(/^\s+|\s+$/g, '');
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function isHttpUrl(u) {
  return /^https?:\/\/[^\s]+$/i.test(u);
}

function bytesOfBase64(b64) {
  // base64 解码后的近似字节数（用于体积校验，避免真的解码大串）
  const s = String(b64 || '');
  const pad = s.endsWith('==') ? 2 : (s.endsWith('=') ? 1 : 0);
  return Math.floor(s.length * 3 / 4) - pad;
}

function base64ToBytes(b64) {
  const bin = atob(String(b64 || ''));
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function listKeys(env, prefix) {
  const names = [];
  let cursor;
  do {
    const res = await env.GUESTBOOK.list({ prefix, cursor });
    for (const item of (res.keys || [])) names.push(item.name);
    cursor = res.cursor;
  } while (cursor);
  return names;
}

async function getAdminPwd(env) {
  try {
    return (await env.GUESTBOOK.get('admin_pwd')) || DEFAULT_ADMIN_PWD;
  } catch (err) {
    return DEFAULT_ADMIN_PWD;
  }
}

async function readIndex(env) {
  try {
    const raw = await env.GUESTBOOK.get(KEY_INDEX, 'json');
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    return [];
  }
}

async function writeIndex(env, list) {
  const capped = list.slice(0, INDEX_MAX);
  await env.GUESTBOOK.put(KEY_INDEX, JSON.stringify(capped));
  return capped;
}

// 账号名以服务端数据为准，避免客户端伪造作者昵称
async function lookupAuthorName(env, authorId) {
  if (!authorId) return '';
  try {
    const acc = await env.GUESTBOOK.get(ACCOUNT_PREFIX + authorId, 'json');
    if (acc && typeof acc === 'object') return trimStr(acc.name || '');
  } catch (err) {
    /* 忽略：取不到时按空处理 */
  }
  return '';
}

function makeSummary(article) {
  const body = str(article.body).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  const summary = body.length > 80 ? body.slice(0, 80) + '…' : body;
  const tags = Array.isArray(article.tags) ? article.tags : [];
  const kw = (str(article.title) + ' ' + str(article.body) + ' ' + tags.join(' ')).toLowerCase().slice(0, 400);
  return {
    id: article.id,
    title: article.title,
    tags: tags,
    authorId: article.authorId,
    authorName: article.authorName,
    status: article.status,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
    summary: summary,
    imgCount: Array.isArray(article.images) ? article.images.length : 0,
    fileCount: Array.isArray(article.files) ? article.files.length : 0,
    views: typeof article.views === 'number' ? article.views : 0,
    kw: kw
  };
}

// 索引内替换（同 id 先移除再插入），返回新索引数组
function upsertIndex(list, summary, toFront) {
  const next = list.filter(function (it) { return !(it && it.id === summary.id); });
  if (toFront) next.unshift(summary);
  else next.push(summary);
  return next;
}

function pickTags(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const raw of v) {
    const tag = trimStr(raw);
    if (!tag) continue;
    if (tag.length > TAG_MAX_LEN) return { error: '单个标签不能超过 ' + TAG_MAX_LEN + ' 字', code: 'tag_len' };
    if (out.indexOf(tag) < 0) out.push(tag);
  }
  if (out.length > TAG_MAX_COUNT) return { error: '标签最多 ' + TAG_MAX_COUNT + ' 个', code: 'tag_max' };
  return { tags: out };
}

function pickLinks(v) {
  if (!Array.isArray(v)) return { links: [] };
  const out = [];
  for (const raw of v) {
    const link = trimStr(raw);
    if (!link) continue;
    if (link.length > LINK_MAX_LEN) return { error: '单个链接过长', code: 'link_len' };
    if (!isHttpUrl(link)) return { error: '链接必须以 http:// 或 https:// 开头', code: 'link_bad' };
    out.push(link);
  }
  if (out.length > LINK_MAX_COUNT) return { error: '相关链接最多 ' + LINK_MAX_COUNT + ' 条', code: 'link_max' };
  return { links: out };
}

function pickAssetIds(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const raw of v) {
    const id = trimStr(raw);
    if (id && out.indexOf(id) < 0) out.push(id);
  }
  return out;
}

// 清理草稿：清单键 + 其下全部附件键（提交或放弃后调用）
async function clearDraft(env, draft) {
  if (!draft) return;
  const names = await listKeys(env, PREFIX_DRAFT + draft + ':asset:');
  for (const name of names) {
    await env.GUESTBOOK.delete(name);
  }
  await env.GUESTBOOK.delete(PREFIX_DRAFT + draft);
}

async function readDraft(env, draft) {
  try {
    const raw = await env.GUESTBOOK.get(PREFIX_DRAFT + draft, 'json');
    if (raw && typeof raw === 'object') {
      return {
        images: Array.isArray(raw.images) ? raw.images : [],
        files: Array.isArray(raw.files) ? raw.files : []
      };
    }
  } catch (err) {
    /* 忽略 */
  }
  return { images: [], files: [] };
}

function sumBytes(list) {
  let total = 0;
  for (const it of list) {
    if (it && typeof it.size === 'number') total += it.size;
  }
  return total;
}

// ---------- 各 action 实现 ----------

async function handleList(env, body) {
  const index = await readIndex(env);
  const qRaw = trimStr(body.q).toLowerCase();
  const authorRaw = trimStr(body.author).toLowerCase();
  const sort = body.sort === 'hot' ? 'hot' : 'new';
  const tagList = Array.isArray(body.tags)
    ? body.tags.map(function (t) { return trimStr(t); }).filter(function (t) { return !!t; })
    : (trimStr(body.tag) ? [trimStr(body.tag)] : []);

  const approved = index.filter(function (it) { return it && it.status === 'approved'; });

  // 标签聚合：基于全部已通过文章，保证筛选项稳定
  const tagCount = {};
  for (const it of approved) {
    const tags = Array.isArray(it.tags) ? it.tags : [];
    for (const tag of tags) {
      if (!tag) continue;
      tagCount[tag] = (tagCount[tag] || 0) + 1;
    }
  }
  const tagList0 = Object.keys(tagCount).map(function (name) {
    return { name: name, count: tagCount[name] };
  });
  tagList0.sort(function (a, b) {
    if (b.count !== a.count) return b.count - a.count;
    return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
  });

  let list = approved;
  if (qRaw) {
    list = list.filter(function (it) {
      const kw = str(it.kw).toLowerCase();
      const title = str(it.title).toLowerCase();
      const tags = (Array.isArray(it.tags) ? it.tags.join(' ') : '').toLowerCase();
      return kw.indexOf(qRaw) >= 0 || title.indexOf(qRaw) >= 0 || tags.indexOf(qRaw) >= 0;
    });
  }
  if (tagList.length) {
    list = list.filter(function (it) {
      const tags = Array.isArray(it.tags) ? it.tags : [];
      for (const tag of tagList) {
        if (tags.indexOf(tag) >= 0) return true;
      }
      return false;
    });
  }
  if (authorRaw) {
    list = list.filter(function (it) {
      const name = str(it.authorName).toLowerCase();
      const id = str(it.authorId).toLowerCase();
      return name.indexOf(authorRaw) >= 0 || id === authorRaw;
    });
  }

  list = list.slice();
  if (sort === 'hot') {
    list.sort(function (a, b) {
      const va = typeof a.views === 'number' ? a.views : 0;
      const vb = typeof b.views === 'number' ? b.views : 0;
      if (vb !== va) return vb - va;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  } else {
    list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  }

  const pageSize = Math.min(Math.max(parseInt(body.pageSize, 10) || PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX);
  const total = list.length;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(Math.max(parseInt(body.page, 10) || 1, 1), totalPages);
  const start = (page - 1) * pageSize;
  const articles = list.slice(start, start + pageSize).map(function (it) {
    return {
      id: it.id,
      title: it.title,
      tags: Array.isArray(it.tags) ? it.tags : [],
      authorId: it.authorId,
      authorName: it.authorName,
      createdAt: it.createdAt,
      summary: it.summary,
      imgCount: it.imgCount || 0,
      fileCount: it.fileCount || 0,
      views: it.views || 0
    };
  });

  return json({
    ok: true,
    total: total,
    page: page,
    pageSize: pageSize,
    totalPages: totalPages,
    articles: articles,
    tags: tagList0
  });
}

async function handleDetail(env, body) {
  const id = trimStr(body.id);
  if (!id) return fail(400, '缺少文章 ID', 'id_required');

  const article = await env.GUESTBOOK.get(PREFIX_ARTICLE + id.replace(/^article:/, ''), 'json');
  if (!article || typeof article !== 'object') {
    return fail(404, '文章不存在或已被删除', 'not_found');
  }

  const isAuthor = trimStr(body.authorId) && trimStr(body.authorId) === article.authorId;
  let isAdmin = false;
  if (!isAuthor && trimStr(body.password)) {
    const adminPwd = await getAdminPwd(env);
    isAdmin = trimStr(body.password) === adminPwd;
  }

  if (article.status !== 'approved' && !isAuthor && !isAdmin) {
    return fail(403, '文章尚未公开', 'not_public');
  }

  // 浏览量：仅对已通过文章计数，且同一篇 5 分钟内最多写一次 KV
  if (article.status === 'approved') {
    const now = Date.now();
    const last = typeof article.viewsAt === 'number' ? article.viewsAt : 0;
    if (now - last >= VIEW_WINDOW_MS) {
      article.views = (typeof article.views === 'number' ? article.views : 0) + 1;
      article.viewsAt = now;
      try {
        await env.GUESTBOOK.put(PREFIX_ARTICLE + article.id, JSON.stringify(article));
        // 顺带同步索引里的浏览量，保证「最热」排序不过期（单篇 5 分钟内只写一次）
        const index = await readIndex(env);
        let changed = false;
        for (const it of index) {
          if (it && it.id === article.id) {
            it.views = article.views;
            changed = true;
          }
        }
        if (changed) await env.GUESTBOOK.put(KEY_INDEX, JSON.stringify(index));
      } catch (err) {
        /* 计数失败不影响阅读 */
      }
    }
  }

  return json({
    ok: true,
    article: article,
    canEdit: !!isAuthor,
    isAdmin: !!isAdmin
  });
}

async function handleMine(env, body) {
  const authorId = trimStr(body.authorId);
  if (!authorId) return fail(401, '请先登录后再查看自己的文章', 'login_required');

  const index = await readIndex(env);
  const mine = index.filter(function (it) { return it && it.authorId === authorId; });
  mine.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

  const articles = mine.slice(0, 60).map(function (it) {
    return {
      id: it.id,
      title: it.title,
      status: it.status,
      tags: Array.isArray(it.tags) ? it.tags : [],
      summary: it.summary,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
      views: it.views || 0,
      imgCount: it.imgCount || 0,
      fileCount: it.fileCount || 0
    };
  });

  return json({ ok: true, total: mine.length, articles: articles });
}

async function handleUploadAsset(env, body) {
  const draft = trimStr(body.draft).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (!draft) return fail(400, '缺少投稿草稿标识', 'draft_required');

  const kind = body.kind === 'file' ? 'file' : 'image';
  const name = trimStr(body.name).slice(0, 120) || (kind === 'image' ? 'image' : 'file');
  const type = trimStr(body.type).slice(0, 100) || (kind === 'image' ? 'image/jpeg' : 'application/octet-stream');
  const data = str(body.data);
  if (!data) return fail(400, '附件内容为空', 'asset_empty');
  if (data.length > ASSET_DATA_MAX) return fail(413, '单个附件过大', 'asset_too_large');

  const size = typeof body.size === 'number' && body.size > 0 ? body.size : bytesOfBase64(data);
  const limit = kind === 'image' ? IMG_MAX_BYTES : FILE_MAX_BYTES;
  if (size > limit) {
    return fail(413, kind === 'image' ? '图片不能超过 300KB' : '附件不能超过 2MB', 'asset_size');
  }

  const manifest = await readDraft(env, draft);
  const bucket = kind === 'image' ? manifest.images : manifest.files;
  const maxCount = kind === 'image' ? IMAGE_MAX_COUNT : FILE_MAX_COUNT;
  if (bucket.length >= maxCount) {
    return fail(400, kind === 'image' ? '图片最多 ' + IMAGE_MAX_COUNT + ' 张' : '附件最多 ' + FILE_MAX_COUNT + ' 个', 'asset_count');
  }
  const totalLimit = kind === 'image' ? IMG_TOTAL_BYTES : FILE_TOTAL_BYTES;
  if (sumBytes(bucket) + size > totalLimit) {
    return fail(413, kind === 'image' ? '图片合计不能超过 1.2MB' : '附件合计不能超过 3MB', 'asset_total');
  }

  const assetId = genId();
  await env.GUESTBOOK.put(
    PREFIX_DRAFT + draft + ':asset:' + assetId,
    JSON.stringify({ name: name, type: type, size: size, kind: kind, data: data })
  );
  bucket.push({ assetId: assetId, name: name, type: type, size: size });
  await env.GUESTBOOK.put(PREFIX_DRAFT + draft, JSON.stringify(manifest));

  return json({
    ok: true,
    assetId: assetId,
    name: name,
    size: size,
    type: type,
    kind: kind,
    images: manifest.images.length,
    files: manifest.files.length,
    imageBytes: sumBytes(manifest.images),
    fileBytes: sumBytes(manifest.files)
  });
}

async function handleSubmit(env, body) {
  const authorId = trimStr(body.authorId);
  if (!authorId) return fail(401, '请先登录后再投稿', 'login_required');

  const authorName = await lookupAuthorName(env, authorId);
  if (!authorName) return fail(401, '账号不存在或已失效，请重新登录', 'bad_account');

  const title = trimStr(body.title);
  const bodyText = str(body.body).replace(/^\s+|\s+$/g, '');
  if (title.length < TITLE_MIN || title.length > TITLE_MAX) {
    return fail(400, '标题需要 ' + TITLE_MIN + '-' + TITLE_MAX + ' 字', 'title_len');
  }
  if (bodyText.length < BODY_MIN || bodyText.length > BODY_MAX) {
    return fail(400, '正文需要 ' + BODY_MIN + '-' + BODY_MAX + ' 字', 'body_len');
  }

  const tagsRes = pickTags(body.tags);
  if (tagsRes.error) return fail(400, tagsRes.error, tagsRes.code);
  const linksRes = pickLinks(body.links);
  if (linksRes.error) return fail(400, linksRes.error, linksRes.code);

  const imageIds = pickAssetIds(body.images);
  const fileIds = pickAssetIds(body.files);
  if (imageIds.length > IMAGE_MAX_COUNT) {
    return fail(400, '图片最多 ' + IMAGE_MAX_COUNT + ' 张', 'img_max');
  }
  if (fileIds.length > FILE_MAX_COUNT) {
    return fail(400, '附件最多 ' + FILE_MAX_COUNT + ' 个', 'file_max');
  }

  // 编辑既有文章：必须本人，且沿用原 id / createdAt / views
  const editId = trimStr(body.id);
  let existing = null;
  if (editId) {
    existing = await env.GUESTBOOK.get(PREFIX_ARTICLE + editId, 'json');
    if (!existing || typeof existing !== 'object') return fail(404, '文章不存在或已被删除', 'not_found');
    if (existing.authorId !== authorId) return fail(403, '只能编辑自己的文章', 'not_owner');
  }

  const draft = trimStr(body.draft).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  const manifest = draft ? await readDraft(env, draft) : { images: [], files: [] };
  const newImages = manifest.images.filter(function (it) { return imageIds.indexOf(it.assetId) >= 0; });
  const newFiles = manifest.files.filter(function (it) { return fileIds.indexOf(it.assetId) >= 0; });

  // 编辑时保留仍然引用的旧附件（其二进制已在 article:{id}:asset: 下）
  const keptImages = (existing && Array.isArray(existing.images) ? existing.images : []).filter(function (it) {
    return imageIds.indexOf(it.assetId) >= 0;
  });
  const keptFiles = (existing && Array.isArray(existing.files) ? existing.files : []).filter(function (it) {
    return fileIds.indexOf(it.assetId) >= 0;
  });

  const missing = imageIds.length + fileIds.length - newImages.length - newFiles.length - keptImages.length - keptFiles.length;
  if (missing > 0) return fail(400, '有附件未能上传成功，请重新选择后再提交', 'asset_missing');

  const articleId = existing ? existing.id : genId();
  const now = Date.now();

  try {
    // 草稿附件迁移到正式文章下（逐个读写，避免整体过大）
    for (const it of newImages.concat(newFiles)) {
      const payload = await env.GUESTBOOK.get(PREFIX_DRAFT + draft + ':asset:' + it.assetId);
      if (payload === null) continue;
      await env.GUESTBOOK.put(PREFIX_ARTICLE + articleId + ':asset:' + it.assetId, payload);
    }

    const images = keptImages.concat(newImages.map(function (it) {
      return { assetId: it.assetId, name: it.name, type: it.type, size: it.size };
    }));
    const files = keptFiles.concat(newFiles.map(function (it) {
      return { assetId: it.assetId, name: it.name, type: it.type, size: it.size };
    }));

    // 编辑后被移除的旧附件：一并删除其二进制，避免 KV 残留
    if (existing) {
      const oldAssets = (Array.isArray(existing.images) ? existing.images : [])
        .concat(Array.isArray(existing.files) ? existing.files : []);
      for (const it of oldAssets) {
        if (!it || !it.assetId) continue;
        if (imageIds.indexOf(it.assetId) >= 0 || fileIds.indexOf(it.assetId) >= 0) continue;
        await env.GUESTBOOK.delete(PREFIX_ARTICLE + articleId + ':asset:' + it.assetId);
      }
    }

    const article = {
      id: articleId,
      title: title,
      body: bodyText,
      tags: tagsRes.tags,
      links: linksRes.links,
      images: images,
      files: files,
      authorId: authorId,
      authorName: authorName,
      status: 'pending',
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      reviewedAt: null,
      rejectReason: '',
      views: existing && typeof existing.views === 'number' ? existing.views : 0,
      viewsAt: existing && typeof existing.viewsAt === 'number' ? existing.viewsAt : 0
    };
    await env.GUESTBOOK.put(PREFIX_ARTICLE + articleId, JSON.stringify(article));

    // 索引：编辑时原位标记为待审（不改变原有排序位置），新投稿置顶
    const index = await readIndex(env);
    const summary = makeSummary(article);
    let next;
    if (existing) {
      next = index.map(function (it) { return (it && it.id === articleId) ? summary : it; });
    } else {
      next = upsertIndex(index, summary, true);
    }
    await writeIndex(env, next);

    if (draft) await clearDraft(env, draft);

    return json({ ok: true, id: articleId, status: 'pending', article: summary });
  } catch (err) {
    return fail(500, '服务异常，请稍后重试', 'server');
  }
}

// ---------- AI 预审：文章正文 + 附件 ----------

function hasAI(env) {
  return !!(env && env.AI && typeof env.AI.run === 'function');
}

// 从模型输出里抠出第一个 JSON 对象，容忍前后多余文字
function extractJson(text) {
  if (!text) return null;
  const s = String(text);
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try {
    return JSON.parse(s.slice(i, j + 1));
  } catch (err) {
    return null;
  }
}

// Workers AI 可能直接回对象、回字符串，或回 OpenAI chat.completion 结构
function extractAiPayload(res) {
  if (!res || typeof res !== 'object') return null;
  const pick = (v) => {
    if (!v) return null;
    if (typeof v === 'object') return v;
    if (typeof v === 'string') return extractJson(v) || { _text: v };
    return null;
  };
  let out = pick(res.response);
  if (!out && res.choices && res.choices[0] && res.choices[0].message) {
    out = pick(res.choices[0].message.content);
  }
  if (!out) out = pick(res.result);
  return out;
}

const AI_SYSTEM_ARTICLE = [
  '你是中文内容社区的文章审核助手，判断一篇待发布投稿是否可以公开发布。',
  'violation=true 表示不应公开、需要驳回；violation=false 表示可以发布。',
  '需要驳回的情形：垃圾广告与引流（联系方式、二维码、私域引导、拉群）、色情低俗、违法违规、辱骂人身攻击、侵权抄袭、纯标题党或凑字数的无实质内容、正文与标题严重不符。',
  '正常的技术分享、观点表达、个人经历、资源推荐一律 violation=false；证据不足时也只能 violation=false。',
  'reason 用中文客观说明依据，不超过 60 字，不要复述原文。',
  '只输出一行 JSON，不要解释、不要 markdown 代码块，格式：',
  '{"violation":true,"confidence":0-100,"reason":"不超过60字的中文理由"}'
].join('\n');

const AI_SYSTEM_IMAGE = [
  '你是图片内容审核助手，判断用户投稿图片是否违规。',
  '违规情形：二维码或联系方式引流、广告水印与促销信息、色情低俗、暴力血腥、违法违规内容、他人隐私截图。',
  '图片是正常照片、作品、示意图时一律 violation=false；无法判定时也 violation=false。',
  '只输出一行 JSON，不要解释、不要 markdown 代码块，格式：',
  '{"violation":true,"confidence":0-100,"reason":"不超过40字的中文理由"}'
].join('\n');

// 统一把模型 payload 归一成 { violated, score, reason }
function normalizeVerdict(payload) {
  let violated = null;
  let score = 50;
  let reason = '';
  if (!payload) return { violated: null, score: 0, reason: '' };

  const rawV = payload.violation;
  if (rawV === true) violated = true;
  else if (rawV === false) violated = false;
  else if (typeof rawV === 'string') {
    const s = rawV.toLowerCase();
    if (s === 'true' || s === 'yes' || s === '1') violated = true;
    else if (s === 'false' || s === 'no' || s === '0') violated = false;
  }
  if (violated === null) {
    const v = trimStr(payload.verdict).toLowerCase();
    if (v === 'pass' || v === 'approve' || v === 'ok') violated = false;
    else if (v === 'reject' || v === 'violation' || v === 'fail') violated = true;
  }

  const sc = Number(payload.confidence !== undefined ? payload.confidence : payload.score);
  if (!isNaN(sc)) score = Math.max(0, Math.min(100, Math.round(sc)));
  reason = trimStr(payload.reason);
  if (!reason && payload._text) reason = trimStr(payload._text);
  return { violated: violated, score: score, reason: reason.slice(0, AI_REASON_MAX) };
}

// 附件元信息汇总成一行文字，供文本模型参考（文件名/类型本身也是审核线索）
function assetDigest(article) {
  const images = Array.isArray(article.images) ? article.images : [];
  const files = Array.isArray(article.files) ? article.files : [];
  const parts = [];
  if (images.length) {
    parts.push('图片 ' + images.length + ' 张（' + images.map(function (it) {
      return str(it && it.name).slice(0, 40);
    }).join('、') + '）');
  }
  if (files.length) {
    parts.push('附件 ' + files.length + ' 个（' + files.map(function (it) {
      return str(it && it.name).slice(0, 40);
    }).join('、') + '）');
  }
  return parts.join('；');
}

// 正文侧判定：标题 / 标签 / 链接 / 正文
async function aiTextJudge(env, article) {
  const lines = [
    '标题：' + trimStr(article.title).slice(0, 120),
    '标签：' + (Array.isArray(article.tags) && article.tags.length ? article.tags.join('、') : '（无）'),
    '外链：' + (Array.isArray(article.links) && article.links.length ? article.links.slice(0, 10).join(' ') : '（无）'),
    '附件清单：' + (assetDigest(article) || '（无）'),
    '正文：\n' + trimStr(article.body).replace(/\s+/g, ' ').slice(0, AI_TEXT_MAX)
  ];

  const res = await env.AI.run(AI_MODEL, {
    messages: [
      { role: 'system', content: AI_SYSTEM_ARTICLE },
      { role: 'user', content: lines.join('\n') }
    ],
    max_tokens: 300,
    temperature: 0.1
  });

  const norm = normalizeVerdict(extractAiPayload(res));
  if (norm.violated === null && !norm.reason) {
    return { violated: null, score: 0, reason: '未能解析模型输出' };
  }
  return norm;
}

// 图片侧判定：取 KV 里的 base64 交给视觉模型
async function aiImageJudge(env, articleId, asset) {
  const assetId = trimStr(asset && asset.assetId);
  const name = trimStr(asset && asset.name).slice(0, 60) || 'image';
  if (!assetId) return { assetId: '', name: name, violated: null, score: 0, reason: '附件标识缺失' };

  try {
    const raw = await env.GUESTBOOK.get(PREFIX_ARTICLE + articleId + ':asset:' + assetId, 'json');
    if (!raw || typeof raw !== 'object' || !raw.data) {
      return { assetId: assetId, name: name, violated: null, score: 0, reason: '图片内容读取失败' };
    }
    const bytes = base64ToBytes(raw.data);
    if (!bytes.length || bytes.length > AI_IMG_BYTES_MAX) {
      return { assetId: assetId, name: name, violated: null, score: 0, reason: '图片过大或为空，需人工查看' };
    }

    const res = await env.AI.run(AI_VISION_MODEL, {
      image: Array.from(bytes),
      prompt: AI_SYSTEM_IMAGE,
      max_tokens: 160,
      temperature: 0.1
    });
    const norm = normalizeVerdict(extractAiPayload(res));
    return {
      assetId: assetId,
      name: name,
      violated: norm.violated,
      score: norm.score,
      reason: norm.reason || '视觉模型未给出理由'
    };
  } catch (err) {
    return {
      assetId: assetId,
      name: name,
      violated: null,
      score: 0,
      reason: '图片判定失败：' + String((err && err.message) || err).slice(0, 80)
    };
  }
}

// 文件侧判定：只做类型/命名层面的风险判断（docx/pdf 等无法解析正文）
function fileJudge(asset) {
  const name = trimStr(asset && asset.name).slice(0, 80) || 'file';
  const assetId = trimStr(asset && asset.assetId);
  const ext = (name.indexOf('.') >= 0 ? name.split('.').pop() : '').toLowerCase();
  if (ext && ASSET_RISK_EXT.indexOf(ext) >= 0) {
    return { assetId: assetId, name: name, violated: true, score: 95, reason: '可执行/脚本类文件（.' + ext + '），不允许作为附件发布' };
  }
  return { assetId: assetId, name: name, violated: false, score: 10, reason: '常规文档类型，未发现类型风险（内容需人工复核）' };
}

// 单篇完整预审：正文 + 附件，写回 article.ai
async function aiReviewOne(env, article) {
  const at = Date.now();
  const images = Array.isArray(article.images) ? article.images : [];
  const files = Array.isArray(article.files) ? article.files : [];

  // 1) 正文
  let textRes;
  try {
    textRes = await aiTextJudge(env, article);
  } catch (err) {
    textRes = { violated: null, score: 0, reason: '正文判定失败：' + String((err && err.message) || err).slice(0, 80) };
  }

  // 2) 图片（最多 AI_IMG_MAX 张，逐张串行）
  const imgResults = [];
  const imgTargets = images.slice(0, AI_IMG_MAX);
  for (let i = 0; i < imgTargets.length; i++) {
    imgResults.push(await aiImageJudge(env, article.id, imgTargets[i]));
  }

  // 3) 文件（仅类型层面）
  const fileResults = [];
  for (let i = 0; i < files.length; i++) fileResults.push(fileJudge(files[i]));

  const assetItems = imgResults.concat(fileResults);
  const badAssets = assetItems.filter(function (it) { return it && it.violated === true; });
  const textBad = textRes.violated === true;

  // 附件维度小结
  let assetVerdict = 'pass';
  let assetReason = '';
  if (badAssets.length) {
    assetVerdict = 'reject';
    assetReason = badAssets.map(function (it) { return it.name + '：' + it.reason; }).join('；').slice(0, AI_REASON_MAX);
  } else if (imgResults.length && imgResults.every(function (it) { return it.violated === null; })) {
    assetVerdict = '';
    assetReason = '图片未能完成自动判定，需人工查看';
  } else if (!assetItems.length) {
    assetVerdict = 'pass';
    assetReason = '本文没有附件';
  } else {
    assetReason = '附件未发现违规内容';
  }

  // 合并结论：任一维度判定违规即建议驳回
  let verdict = '';
  let score = 0;
  let reason = '';
  if (textBad || badAssets.length) {
    verdict = 'reject';
    score = Math.max(textBad ? textRes.score : 0, badAssets.length ? Math.max.apply(null, badAssets.map(function (it) { return it.score || 0; })) : 0);
    const chunks = [];
    if (textBad) chunks.push('正文：' + textRes.reason);
    if (badAssets.length) chunks.push('附件：' + assetReason);
    reason = chunks.join('；');
  } else if (textRes.violated === false) {
    verdict = 'pass';
    score = textRes.score;
    reason = textRes.reason || '未发现违规内容';
  } else {
    verdict = '';
    reason = textRes.reason || '未能完成自动判定，请人工复核';
  }

  return {
    verdict: verdict,
    score: Math.max(0, Math.min(100, Math.round(score || 0))),
    reason: trimStr(reason).slice(0, AI_REASON_MAX),
    model: AI_MODEL,
    visionModel: imgResults.length ? AI_VISION_MODEL : '',
    at: at,
    text: { verdict: textRes.violated, score: textRes.score, reason: textRes.reason },
    assets: {
      verdict: assetVerdict,
      reason: trimStr(assetReason).slice(0, AI_REASON_MAX),
      images: imgResults,
      files: fileResults
    }
  };
}

async function handleAiReview(env, body) {
  if (!hasAI(env)) {
    return fail(503, '未启用 AI 审核：缺少 Workers AI 绑定（变量名需为 AI）', 'no_ai');
  }

  const index = await readIndex(env);
  const singleId = trimStr(body.id);
  const ids = Array.isArray(body.ids) ? body.ids.map(function (x) { return trimStr(x); }).filter(Boolean) : [];

  let targets;
  if (singleId) targets = index.filter(function (it) { return it && it.id === singleId; });
  else if (ids.length) targets = index.filter(function (it) { return it && ids.indexOf(it.id) >= 0; });
  else {
    targets = index.filter(function (it) { return it && it.status === 'pending'; });
    targets.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
  }
  targets = targets.slice(0, AI_BATCH_MAX);

  if (!targets.length) return json({ ok: true, reviewed: 0, articles: [] });

  const out = [];
  for (let i = 0; i < targets.length; i++) {
    const brief = targets[i];
    const article = await env.GUESTBOOK.get(PREFIX_ARTICLE + brief.id, 'json');
    if (!article || typeof article !== 'object') {
      out.push({ id: brief.id, ai: { verdict: '', score: 0, reason: '文章正文丢失，无法预审', model: AI_MODEL, at: Date.now(), error: true } });
      continue;
    }
    let ai;
    try {
      ai = await aiReviewOne(env, article);
    } catch (err) {
      ai = { verdict: '', score: 0, reason: 'AI 判定失败：' + String((err && err.message) || err).slice(0, 100), model: AI_MODEL, at: Date.now(), error: true };
    }
    article.ai = ai;
    try {
      await env.GUESTBOOK.put(PREFIX_ARTICLE + article.id, JSON.stringify(article));
    } catch (err) {
      // 写入失败不影响返回，前端仍可看到本次判定
    }
    out.push({ id: article.id, ai: ai, article: article });
  }

  return json({ ok: true, reviewed: out.length, articles: out });
}

async function handleReview(env, body) {
  const password = trimStr(body.password);
  const adminPwd = await getAdminPwd(env);
  if (password !== adminPwd) return fail(401, '密码错误', 'bad_pwd');

  const op = trimStr(body.op) || 'listing';

  // AI 预审：对单篇或待审队列做正文 + 附件判定，结果写回 article.ai
  if (op === 'aiReview') {
    return await handleAiReview(env, body);
  }

  // 待审列表：返回完整正文与附件元信息，供后台展开预览
  if (op === 'listing') {
    const index = await readIndex(env);
    const pending = index.filter(function (it) { return it && it.status === 'pending'; });
    pending.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    const articles = [];
    for (const it of pending.slice(0, 30)) {
      const full = await env.GUESTBOOK.get(PREFIX_ARTICLE + it.id, 'json');
      if (full && typeof full === 'object') articles.push(full);
    }
    return json({ ok: true, total: pending.length, articles: articles });
  }

  // 全部文章：按状态筛选 + 标题/作者搜索 + 分页
  if (op === 'all') {
    const index = await readIndex(env);
    const status = trimStr(body.status);
    const q = trimStr(body.q).toLowerCase();
    let list = index.slice();
    if (status && STATUS_SET[status]) {
      list = list.filter(function (it) { return it && it.status === status; });
    }
    if (q) {
      list = list.filter(function (it) {
        return str(it.title).toLowerCase().indexOf(q) >= 0
          || str(it.authorName).toLowerCase().indexOf(q) >= 0
          || str(it.authorId).toLowerCase() === q;
      });
    }
    list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    const pageSize = Math.min(Math.max(parseInt(body.pageSize, 10) || 20, 1), PAGE_SIZE_MAX);
    const total = list.length;
    const totalPages = Math.max(Math.ceil(total / pageSize), 1);
    const page = Math.min(Math.max(parseInt(body.page, 10) || 1, 1), totalPages);
    const start = (page - 1) * pageSize;
    return json({
      ok: true,
      total: total,
      page: page,
      pageSize: pageSize,
      totalPages: totalPages,
      articles: list.slice(start, start + pageSize)
    });
  }

  const id = trimStr(body.id);
  if (!id) return fail(400, '缺少文章 ID', 'id_required');

  const article = await env.GUESTBOOK.get(PREFIX_ARTICLE + id, 'json');
  if (!article || typeof article !== 'object') return fail(404, '文章不存在或已被删除', 'not_found');

  const now = Date.now();
  try {
    if (op === 'approve') {
      article.status = 'approved';
      article.reviewedAt = now;
      article.rejectReason = '';
    } else if (op === 'reject') {
      const reason = trimStr(body.reason);
      if (!reason) return fail(400, '请填写驳回理由', 'reason_required');
      if (reason.length > REASON_MAX_LEN) return fail(400, '驳回理由不能超过 ' + REASON_MAX_LEN + ' 字', 'reason_len');
      article.status = 'rejected';
      article.reviewedAt = now;
      article.rejectReason = reason;
    } else if (op === 'revoke') {
      // 撤销审核：退回待审核状态
      article.status = 'pending';
      article.reviewedAt = null;
      article.rejectReason = '';
    } else {
      return fail(400, '未知的审核操作', 'op_bad');
    }

    await env.GUESTBOOK.put(PREFIX_ARTICLE + article.id, JSON.stringify(article));

    const index = await readIndex(env);
    const summary = makeSummary(article);
    const next = index.map(function (it) { return (it && it.id === article.id) ? summary : it; });
    await writeIndex(env, next);

    return json({ ok: true, id: article.id, status: article.status, article: summary });
  } catch (err) {
    return fail(500, '服务异常，请稍后重试', 'server');
  }
}

async function handleDelete(env, body) {
  const password = trimStr(body.password);
  const adminPwd = await getAdminPwd(env);
  if (password !== adminPwd) return fail(401, '密码错误', 'bad_pwd');

  const id = trimStr(body.id);
  if (!id) return fail(400, '缺少文章 ID', 'id_required');

  try {
    // 先删全部附件键（article:{id}:asset:），再删正文，最后摘掉索引条目
    const assetNames = await listKeys(env, PREFIX_ARTICLE + id + ':asset:');
    for (const name of assetNames) {
      await env.GUESTBOOK.delete(name);
    }
    await env.GUESTBOOK.delete(PREFIX_ARTICLE + id);

    const index = await readIndex(env);
    const next = index.filter(function (it) { return !(it && it.id === id); });
    await writeIndex(env, next);

    return json({ ok: true, deleted: true, removedAssets: assetNames.length });
  } catch (err) {
    return fail(500, '服务异常，请稍后重试', 'server');
  }
}

// 附件读取：图片 inline 展示、文件 attachment 下载；非公开文章需作者或管理员身份
async function handleAsset(env, params) {
  const id = trimStr(params.get('id'));
  const assetId = trimStr(params.get('assetId'));
  if (!id || !assetId) return fail(400, '缺少文章或附件标识', 'id_required');

  const article = await env.GUESTBOOK.get(PREFIX_ARTICLE + id, 'json');
  if (!article || typeof article !== 'object') return fail(404, '文章不存在或已被删除', 'not_found');

  if (article.status !== 'approved') {
    const authorId = trimStr(params.get('authorId'));
    const pwd = trimStr(params.get('pwd'));
    const adminPwd = await getAdminPwd(env);
    const okAuthor = authorId && authorId === article.authorId;
    const okAdmin = pwd && pwd === adminPwd;
    if (!okAuthor && !okAdmin) return fail(403, '附件未公开', 'not_public');
  }

  const raw = await env.GUESTBOOK.get(PREFIX_ARTICLE + id + ':asset:' + assetId, 'json');
  if (!raw || typeof raw !== 'object' || !raw.data) {
    return fail(404, '附件不存在', 'asset_not_found');
  }

  const kind = raw.kind === 'file' ? 'file' : 'image';
  const type = str(raw.type) || (kind === 'image' ? 'image/jpeg' : 'application/octet-stream');
  const name = str(raw.name) || (kind === 'image' ? 'image' : 'file');
  const disposition = kind === 'image' ? 'inline' : 'attachment';
  const bytes = base64ToBytes(raw.data);

  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(bytes.length),
      'Content-Disposition': disposition + "; filename*=UTF-8''" + encodeURIComponent(name),
      'Cache-Control': 'public, max-age=86400'
    }
  });
}

export async function onRequest(context) {
  const { env, request } = context;

  if (!env || !env.GUESTBOOK) {
    return fail(500, '服务未正确配置 KV 绑定', 'no_kv');
  }

  const url = new URL(request.url);
  const method = request.method;

  // GET：只用于读取附件（<img src> / 下载链接无法携带 POST body）
  if (method === 'GET') {
    const action = trimStr(url.searchParams.get('action')) || 'asset';
    if (action !== 'asset') return fail(400, 'GET 仅支持 action=asset', 'method_bad');
    try {
      return await handleAsset(env, url.searchParams);
    } catch (err) {
      return fail(500, '附件读取失败', 'server');
    }
  }

  if (method !== 'POST') {
    return fail(405, '不支持的请求方法', 'method');
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return fail(400, '请求体不是合法的 JSON', 'bad_json');
  }
  if (!body || typeof body !== 'object') body = {};

  const action = trimStr(body.action) || 'list';

  try {
    if (action === 'list') return await handleList(env, body);
    if (action === 'detail') return await handleDetail(env, body);
    if (action === 'mine') return await handleMine(env, body);
    if (action === 'uploadAsset') return await handleUploadAsset(env, body);
    if (action === 'submit') return await handleSubmit(env, body);
    if (action === 'review') return await handleReview(env, body);
    if (action === 'delete') return await handleDelete(env, body);
  } catch (err) {
    return fail(500, '服务异常，请稍后重试', 'server');
  }

  return fail(400, '未知操作', 'unknown_action');
}
