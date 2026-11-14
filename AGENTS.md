# AGENTS.md — Cealin 项目协作说明

> 本文件供 AI 助手（Marvis）跨会话接手本项目时快速恢复上下文。
> 项目根目录：`E:\cealin.pages.dev\every`（git 仓库根也在此目录，外层 `E:\cealin.pages.dev` 不是仓库）

## 1. 项目定位

Cealin：纯静态多页面站点 + Cloudflare Pages Functions 后端，数据存 Cloudflare KV（绑定名 `GUESTBOOK`）。
线上地址 `cealin.pages.dev`，GitHub 仓库 `https://github.com/liuiywei2015/Every.git`，主分支 `main`，
推送到 `main` 即触发 Cloudflare Pages 自动部署。

技术约定（务必遵守）：

- 前端全部原生 ES5 + 零外部依赖，不使用框架/构建工具，无 npm 产物（仓库里没有 `package.json`、`node_modules`）。
- 所有文件为 **UTF-8** 编码；PowerShell 默认 CP936 读取会显示乱码，**看到乱码不代表文件损坏**，禁止据此"修复"编码。
- `pages_build_output_dir = "."`：仓库根目录即站点根目录，新增页面放在根目录，新增接口放在 `functions/api/`。
- 样式与主题变量走 `theme.css`（暗/明双主题），页面内不再重复定义主题变量。
- 多语言文案统一走 `i18n.js` 的字典 + `data-i18n` 属性或 `window.cealinT()`，不要在页面里写死中文。

## 2. 目录结构

```
every/
├── *.html                  19 个页面（见下表）
├── assets/bg.jpg           全屏油画背景
├── downloads/*.apk         安卓客户端安装包（4 个，约 52KB/个）
├── theme.css / theme.js    主题变量 + 首屏防闪烁引导（localStorage: cealin_theme）
├── i18n.js                 五语言字典（zh/en/ja/ko/es）+ cealinT() + cealinOnLangChange()
├── guard.js                登录守卫：无 sessionStorage.cealin_account_id 则隐藏页面并跳 account.html
├── client-detect.js        桌面客户端识别，客户端内把首页重定向到 client.html
├── presence.js             在线状态心跳
├── notify.js               通知提示
├── notice-link.js          公告入口链接注入
├── wrangler.toml           Pages Functions 配置：KV 绑定 GUESTBOOK、Workers AI 绑定 AI、nodejs_compat
├── .env.example            SMTP 变量示例（SMTP_USER / SMTP_PASS / SMTP_TO，用于建议邮件通知）
└── functions/
    ├── api/*.js            接口
    └── dl/[file].js        下载代理（白名单映射 + Range 断点续传）
```

### 页面一览

| 页面 | 职责 | 依赖接口 |
|---|---|---|
| index.html | 首页 + 登录分流（仅游客登录，管理员身份只在客户端注入） | /api/messages |
| account.html | 账号：注册（名称+密码→系统分配 8 位编号）、登录（编号+密码+邮箱验证码） | /api/accounts |
| guest.html | 游客界面，公告只读 | /api/notice |
| client.html | 桌面客户端内置页（当前账号 / 官方公告，只读） | /api/notice |
| chat.html | 聊天室（房间创建/加入/退出、公告弹窗、举报入口） | /api/rooms, /api/notice, /api/reports |
| friends.html | 好友：编号精确搜索、申请/同意/拒绝、列表含未读数 | /api/friends |
| dm.html | 好友私聊（文本/图片、增量拉取） | /api/dm |
| articles.html / article.html | 文章列表 / 文章详情 | /api/articles |
| write.html | 投稿编辑器（支持图片附件上传） | /api/articles |
| mine.html | 我的：账号信息、自己投稿的文章 | /api/accounts, /api/articles |
| settings.html | 设置（主题、语言、账号跳转） | 无 |
| project.html / platform.html | 项目 / 平台展示页，含访客留言 | /api/messages |
| suggestion.html | 匿名建议提交 | /api/suggestions |
| notice-admin.html / admin.html | 公告管理 / 管理员总控台（概览、公告、聊天室、文章、举报、建议） | 多个 |
| download.html | 下载页（Windows 客户端、Android APK、Windows 管理端） | 无（走 /dl/） |

### 接口（functions/api）

| 文件 | 职责要点 |
|---|---|
| accounts.js | 账号系统。密码不明文入库：客户端 SHA-256(salt + ':' + 密码) 后只传哈希；注册/登录/邮箱验证码/改密等 |
| auth.js | 管理员密码校验（KV 键 `admin_pwd`，未设置时用默认值） |
| messages.js | 留言板（KV 数组，跨设备同步） |
| rooms/[action].js | 动态路由：create / join / leave / change / messages；房间 key：`room:{code}`、`room:{code}:names`、`room:{code}:presence` |
| admin-rooms.js | 管理员查询房间占用、在线成员、活跃时间 |
| friends.js | 好友关系、申请、未读数、标记已读 |
| dm.js | 私聊消息收发、按 id 读图 |
| articles.js | 文章列表/详情/我的投稿/资源上传、管理员审批、浏览量合并写入 |
| notice.js | 公告读写，保存时自动翻译成 zh/en/ja/ko/es（优先 Workers AI，未绑定时降级公共翻译接口） |
| reports.js | 举报提交与管理员处理 |
| suggestions.js | 匿名建议提交 + 管理员列表/删除，可选 SMTP 邮件通知 |
| ai-status.js | 诊断：Workers AI 绑定是否生效 |
| dl/[file].js | 站内直链下载代理，白名单映射上游大文件 |

## 3. 认证与状态约定

浏览器端状态全部走 sessionStorage / localStorage，键名沿用：

- `cealin_account_id` — 登录账号编号（sessionStorage）
- `cealin_admin` / `cealin_admin_pwd` — 管理员会话（sessionStorage）
- `cealin_client` — 桌面客户端标记（sessionStorage）
- `cealin_theme` — 主题 dark/light（localStorage）
- `cealin_lang` — 语言 zh/en/ja/ko/es（localStorage）
- `cealin_posts` / `cealin_comments` — 首页动态本地兜底数据

## 4. 发布约定（重要）

**每次改动完成后自动推送 GitHub**，已安装 `.git/hooks/post-commit` 钩子：commit 后自动 `git push origin HEAD:main`，
日志写入 `.git/autopush.log`。因此正常流程只有两步：

```bash
git add -A
git commit -m "type(scope): 说明"
# 推送由钩子自动完成；若网络失败，手动补一句 git push origin main
```

提交信息风格沿用历史记录：`feat(scope): ...` / `fix(scope): ...` / `chore(scope): ...`。

## 5. 已知注意点

- `downloads/` 里的 APK 体积小，可直接入库；体积超 Pages 单文件 25MB 限制的客户端安装包必须经 `functions/dl/[file].js` 白名单代理转发，不能放静态目录。
- 修改 `i18n.js` 时新增 key 要同时补齐五语言，避免漏译回退成中文。
- 管理员默认密码位于 `functions/api/auth.js`，改动需谨慎且不要提交到公开仓库的说明文档里。
- `.env` 不入库（`.gitignore` 已忽略 `temp/`），生产环境变量在 Cloudflare Pages 控制台配置。
