/* Cealin 全站多语言（i18n）：原生 ES5 + 内联字典，零外部依赖
 * 支持：简体中文（默认）/ English / 日本語 / 한국어 / Español
 * 用法：
 *   1) 静态文案 → 在元素上加 data-i18n="key"（文本）、data-i18n-ph="key"（placeholder）、
 *      data-i18n-title="key"（title 属性）、data-i18n-aria="key"（aria-label）
 *   2) 动态文案 → JS 中调用 window.cealinT('key', { n: 1 })
 *   3) 文本由 JS 生成、需要随语言刷新的模块 → window.cealinOnLangChange(function (code) { ... })
 * 语言选择保存在 localStorage（键 cealin_lang），全站页面共享。
 */
(function (w, d) {
  'use strict';

  var STORE_KEY = 'cealin_lang';
  var DEFAULT_LANG = 'zh';

  var LANGS = [
    { code: 'zh', label: '简体中文', short: '中文', html: 'zh-CN' },
    { code: 'en', label: 'English', short: 'EN', html: 'en' },
    { code: 'ja', label: '日本語', short: '日本語', html: 'ja' },
    { code: 'ko', label: '한국어', short: '한국어', html: 'ko' },
    { code: 'es', label: 'Español', short: 'ES', html: 'es' }
  ];

  var DICT = {
    /* ---------- 页面标题 ---------- */
    'title.guest': { zh: '游客界面 - Cealin', en: 'Guest area - Cealin', ja: 'ゲストページ - Cealin', ko: '게스트 페이지 - Cealin', es: 'Área de invitado - Cealin' },
    'title.admin': { zh: '管理员界面 - Cealin', en: 'Admin - Cealin', ja: '管理者ページ - Cealin', ko: '관리자 페이지 - Cealin', es: 'Administración - Cealin' },
    'title.chat': { zh: '聊天室 - Cealin', en: 'Chat room - Cealin', ja: 'チャットルーム - Cealin', ko: '채팅방 - Cealin', es: 'Sala de chat - Cealin' },
    'title.project': { zh: '项目 - Cealin', en: 'Projects - Cealin', ja: 'プロジェクト - Cealin', ko: '프로젝트 - Cealin', es: 'Proyectos - Cealin' },
    'title.platform': { zh: '平台 - Cealin', en: 'Platform - Cealin', ja: 'プラットフォーム - Cealin', ko: '플랫폼 - Cealin', es: 'Plataforma - Cealin' },
    'title.settings': { zh: '设置 - Cealin', en: 'Settings - Cealin', ja: '設定 - Cealin', ko: '설정 - Cealin', es: 'Ajustes - Cealin' },
    'title.notice': { zh: '公告管理 - Cealin', en: 'Manage notices - Cealin', ja: 'お知らせ管理 - Cealin', ko: '공지사항 관리 - Cealin', es: 'Gestionar anuncios - Cealin' },
    'title.suggestion': { zh: '建议 - Cealin', en: 'Feedback - Cealin', ja: 'ご意見 - Cealin', ko: '의견 - Cealin', es: 'Sugerencias - Cealin' },
    'title.account': { zh: '账号 - Cealin', en: 'Account - Cealin', ja: 'アカウント - Cealin', ko: '계정 - Cealin', es: 'Cuenta - Cealin' },
    'title.mine': { zh: '我的 - Cealin', en: 'Me - Cealin', ja: 'マイページ - Cealin', ko: '내 정보 - Cealin', es: 'Mi cuenta - Cealin' },
    'title.download': { zh: '下载 - Cealin', en: 'Download - Cealin', ja: 'ダウンロード - Cealin', ko: '다운로드 - Cealin', es: 'Descargas - Cealin' },

    /* ---------- 导航与通用 ---------- */
    'nav.home': { zh: '首页', en: 'Home', ja: 'ホーム', ko: '홈', es: 'Inicio' },
    'nav.project': { zh: '项目', en: 'Projects', ja: 'プロジェクト', ko: '프로젝트', es: 'Proyectos' },
    'nav.platform': { zh: '平台', en: 'Platform', ja: 'プラットフォーム', ko: '플랫폼', es: 'Plataforma' },
    'nav.chat': { zh: '聊天室', en: 'Chat', ja: 'チャット', ko: '채팅방', es: 'Chat' },
    'nav.suggestion': { zh: '建议', en: 'Feedback', ja: 'ご意見', ko: '의견', es: 'Sugerencias' },
    'nav.notice': { zh: '公告', en: 'Notices', ja: 'お知らせ', ko: '공지사항', es: 'Anuncios' },
    'nav.mine': { zh: '我的', en: 'Me', ja: 'マイページ', ko: '내 정보', es: 'Mi cuenta' },
    'nav.download': { zh: '下载', en: 'Downloads', ja: 'ダウンロード', ko: '다운로드', es: 'Descargas' },
    'nav.settingsTitle': { zh: '设置', en: 'Settings', ja: '設定', ko: '설정', es: 'Ajustes' },
    'nav.settings': { zh: '设置', en: 'Settings', ja: '設定', ko: '설정', es: 'Ajustes' },

    'lang.aria': { zh: '切换语言', en: 'Change language', ja: '言語を切り替える', ko: '언어 변경', es: 'Cambiar idioma' },

    'common.notice': { zh: '公告', en: 'Notice', ja: 'お知らせ', ko: '공지사항', es: 'Anuncio' },
    'common.loading': { zh: '加载中…', en: 'Loading…', ja: '読み込み中…', ko: '불러오는 중…', es: 'Cargando…' },
    'common.backHome': { zh: '返回首页', en: 'Back to home', ja: 'ホームに戻る', ko: '홈으로 돌아가기', es: 'Volver al inicio' },
    'common.guest': { zh: '访客', en: 'Guest', ja: 'ゲスト', ko: '게스트', es: 'Invitado' },
    'common.anonymous': { zh: '匿名', en: 'Anonymous', ja: '匿名', ko: '익명', es: 'Anónimo' },
    'common.delete': { zh: '删除', en: 'Delete', ja: '削除', ko: '삭제', es: 'Eliminar' },
    'common.cancel': { zh: '取消', en: 'Cancel', ja: 'キャンセル', ko: '취소', es: 'Cancelar' },
    'common.close': { zh: '关闭', en: 'Close', ja: '閉じる', ko: '닫기', es: 'Cerrar' },

    /* ---------- 时间 ---------- */
    'time.justNow': { zh: '刚刚', en: 'just now', ja: 'たった今', ko: '방금', es: 'ahora mismo' },
    'time.minAgo': { zh: '{n} 分钟前', en: '{n} min ago', ja: '{n} 分前', ko: '{n}분 전', es: 'hace {n} min' },
    'time.hourAgo': { zh: '{n} 小时前', en: '{n} h ago', ja: '{n} 時間前', ko: '{n}시간 전', es: 'hace {n} h' },
    'time.dayAgo': { zh: '{n} 天前', en: '{n} d ago', ja: '{n} 日前', ko: '{n}일 전', es: 'hace {n} d' },

    /* ---------- 首页 ---------- */
    'idx.gate.title': { zh: '欢迎来到Cealin生态系统', en: 'Welcome to the Cealin ecosystem', ja: 'Cealin エコシステムへようこそ', ko: 'Cealin 생태계에 오신 것을 환영합니다', es: 'Bienvenido al ecosistema Cealin' },
    'idx.gate.titleAdmin': { zh: '欢迎来到Cealin管理员系统', en: 'Welcome to the Cealin admin console', ja: 'Cealin 管理システムへようこそ', ko: 'Cealin 관리자 시스템에 오신 것을 환영합니다', es: 'Bienvenido al panel de administración de Cealin' },
    'idx.gate.sub': { zh: '登录后即可浏览站内全部内容', en: 'Sign in to browse everything on the site', ja: 'ログインするとサイト内のすべてを閲覧できます', ko: '로그인하면 사이트의 모든 콘텐츠를 볼 수 있습니다', es: 'Inicia sesión para ver todo el sitio' },
    'idx.gate.guest': { zh: '游客登录', en: 'Continue as guest', ja: 'ゲストとしてログイン', ko: '게스트로 로그인', es: 'Entrar como invitado' },
    'idx.gate.admin': { zh: '管理员登录', en: 'Admin sign-in', ja: '管理者としてログイン', ko: '관리자 로그인', es: 'Entrar como administrador' },
    'idx.gate.pwd': { zh: '管理员密码', en: 'Admin password', ja: '管理者パスワード', ko: '관리자 비밀번호', es: 'Contraseña de administrador' },
    'idx.gate.confirm': { zh: '验证并进入', en: 'Verify and continue', ja: '認証して進む', ko: '인증 후 입장', es: 'Verificar y entrar' },
    'idx.gate.pwdEmpty': { zh: '请输入管理员密码', en: 'Please enter the admin password', ja: '管理者パスワードを入力してください', ko: '관리자 비밀번호를 입력해 주세요', es: 'Introduce la contraseña de administrador' },
    'idx.gate.pwdWrong': { zh: '密码错误', en: 'Incorrect password', ja: 'パスワードが違います', ko: '비밀번호가 올바르지 않습니다', es: 'Contraseña incorrecta' },
    'idx.sub': { zh: '设计与灵感', en: 'Design and inspiration', ja: 'デザインとインスピレーション', ko: '디자인과 영감', es: 'Diseño e inspiración' },
    'idx.latest': { zh: '最新动态', en: 'Latest', ja: '最新の投稿', ko: '최신 소식', es: 'Novedades' },
    'idx.visitor': { zh: '访客留言 →', en: 'Guest messages →', ja: 'ゲストのメッセージ →', ko: '게스트 메시지 →', es: 'Mensajes de invitados →' },
    'idx.visitorCount': { zh: '访客留言 {n} 条 →', en: '{n} guest messages →', ja: 'ゲストのメッセージ {n} 件 →', ko: '게스트 메시지 {n}개 →', es: '{n} mensajes de invitados →' },

    /* ---------- 桌面客户端页（client.html） ---------- */
    'client.navHome': { zh: '首页', en: 'Home', ja: 'ホーム', ko: '홈', es: 'Inicio' },
    'client.badge': { zh: '桌面客户端', en: 'Desktop client', ja: 'デスクトップ版', ko: '데스크톱 클라이언트', es: 'Cliente de escritorio' },
    'client.sub': { zh: '已登录，可直接浏览 Cealin', en: 'Signed in — browse Cealin right away', ja: 'ログイン済みですぐに閲覧できます', ko: '로그인되어 바로 둘러볼 수 있습니다', es: 'Sesión iniciada: explora Cealin al instante' },
    'client.account': { zh: '当前账号', en: 'Current account', ja: '現在のアカウント', ko: '현재 계정', es: 'Cuenta actual' },
    'client.anon': { zh: '未知账号', en: 'Unknown account', ja: '不明なアカウント', ko: '알 수 없는 계정', es: 'Cuenta desconocida' },
    'client.official': { zh: '官方', en: 'Official', ja: '公式', ko: '공식', es: 'Oficial' },
    'client.notice': { zh: '公告', en: 'Notices', ja: 'お知らせ', ko: '공지사항', es: 'Anuncios' },
    'client.readonly': { zh: '只读', en: 'read-only', ja: '閲覧のみ', ko: '읽기 전용', es: 'solo lectura' },
    'client.enterChat': { zh: '进入聊天室', en: 'Enter the chat', ja: 'チャットに参加', ko: '채팅방 들어가기', es: 'Entrar al chat' },
    'client.friends': { zh: '好友', en: 'Friends', ja: '友達', ko: '친구', es: 'Amigos' },
    'client.articles': { zh: '文章', en: 'Articles', ja: '記事', ko: '글', es: 'Artículos' },
    'client.webVersion': { zh: '在浏览器中打开网页版', en: 'Open the web version in a browser', ja: 'ブラウザでWeb版を開く', ko: '브라우저에서 웹 버전 열기', es: 'Abrir la versión web en el navegador' },

    /* ---------- 游客页 ---------- */
    'guest.title': { zh: '游客界面', en: 'Guest area', ja: 'ゲストページ', ko: '게스트 페이지', es: 'Zona de invitados' },
    'guest.sub': { zh: '以游客身份浏览 Cealin', en: 'Browsing Cealin as a guest', ja: 'ゲストとして Cealin を閲覧中', ko: '게스트로 Cealin 둘러보기', es: 'Explorando Cealin como invitado' },
    'guest.readonly': { zh: '游客只读', en: 'read-only', ja: '閲覧のみ', ko: '읽기 전용', es: 'solo lectura' },
    'guest.enterChat': { zh: '进入聊天室', en: 'Enter the chat', ja: 'チャットに参加', ko: '채팅방 들어가기', es: 'Entrar al chat' },
    'guest.accountTitle': { zh: '已有账号', en: 'Already have an account', ja: 'アカウントをお持ちの方', ko: '이미 계정이 있으신가요', es: '¿Ya tienes cuenta?' },
    'guest.accountSub': { zh: '登录后即可使用聊天室等全部功能', en: 'Sign in to unlock the chat room and the rest', ja: 'ログインするとチャットなどの全機能が使えます', ko: '로그인하면 채팅방 등 모든 기능을 사용할 수 있습니다', es: 'Inicia sesión para usar el chat y el resto de funciones' },
    'guest.accountBtn': { zh: '进入登录界面', en: 'Go to sign-in', ja: 'ログイン画面へ', ko: '로그인 화면으로', es: 'Ir a iniciar sesión' },
    'guest.noticeFallback': { zh: '欢迎来到 Cealin，公告内容加载中，请稍后再试。', en: 'Welcome to Cealin. The notice is still loading—please try again in a moment.', ja: 'Cealin へようこそ。お知らせを読み込み中です。しばらくしてからもう一度お試しください。', ko: 'Cealin에 오신 것을 환영합니다. 공지사항을 불러오는 중이니 잠시 후 다시 확인해 주세요.', es: 'Bienvenido a Cealin. El anuncio se está cargando; inténtalo de nuevo en un momento.' },

    /* ---------- 项目页 ---------- */
    'project.title': { zh: '项目', en: 'Projects', ja: 'プロジェクト', ko: '프로젝트', es: 'Proyectos' },
    'project.sub': { zh: '精选作品与创作实践', en: 'Selected works and creative practice', ja: '選りすぐりの作品と制作の記録', ko: '엄선한 작업과 창작의 기록', es: 'Obras seleccionadas y proceso creativo' },
    'project.aurora.tag': { zh: '视觉 · WebGL', en: 'Visual · WebGL', ja: 'ビジュアル · WebGL', ko: '비주얼 · WebGL', es: 'Visual · WebGL' },
    'project.aurora.desc': { zh: '极光视觉实验，基于 WebGL 的动态光影生成器，让色彩在夜幕中缓慢呼吸。', en: 'An aurora experiment: a WebGL light-and-shadow generator that lets colour breathe slowly through the night.', ja: 'オーロラをテーマにしたビジュアル実験。WebGL で光と影を動かし、色彩が夜空にゆっくりと息づくように揺らぎます。', ko: '오로라를 테마로 한 비주얼 실험입니다. WebGL로 빛과 그림자를 움직여, 색채가 밤하늘에서 천천히 숨 쉬듯 흔들립니다.', es: 'Un experimento inspirado en la aurora: un generador de luz y sombra en WebGL que hace que el color respire despacio en la noche.' },
    'project.nimbus.tag': { zh: '工具 · 笔记', en: 'Tool · Notes', ja: 'ツール · ノート', ko: '도구 · 노트', es: 'Herramienta · Notas' },
    'project.nimbus.desc': { zh: '极简轻量的离线笔记工具，只保留记录本身，专注、安静、零打扰。', en: 'A minimal offline notebook that keeps nothing but the note itself—quiet, focused and free of distractions.', ja: '必要最低限のオフラインノート。記録することだけに集中できる、静かで邪魔の入らないツールです。', ko: '꼭 필요한 것만 남긴 오프라인 노트 도구. 기록에만 집중할 수 있도록 조용하고 방해 요소가 없습니다.', es: 'Un cuaderno offline minimalista que conserva solo lo esencial: concentración, calma y cero distracciones.' },
    'project.sable.tag': { zh: '界面 · 主题', en: 'Interface · Themes', ja: 'UI · テーマ', ko: '인터페이스 · 테마', es: 'Interfaz · Temas' },
    'project.sable.desc': { zh: '为创作者打造的高质感暗色界面套件，克制、细腻、经得起长久凝视。', en: 'A refined dark interface kit for creators: restrained, delicate and made to be looked at for a long time.', ja: '作り手のための質感の高いダークUIキット。控えめで繊細、長く見つめても飽きのこない仕上がりです。', ko: '크리에이터를 위한 고급 다크 UI 키트. 절제되고 섬세하며 오래 바라봐도 편안합니다.', es: 'Un kit de interfaz oscura de alta calidad para creadores: sobrio, delicado y agradable de mirar durante horas.' },
    'project.drift.tag': { zh: '声音 · 氛围', en: 'Sound · Ambience', ja: 'サウンド · アンビエンス', ko: '사운드 · 앰비언스', es: 'Sonido · Ambiente' },
    'project.drift.desc': { zh: '沉浸式声景漫游，用风声、水声与山谷的回响，把时间放慢下来。', en: 'An immersive soundscape walk that slows time down with wind, water and the echo of the valley.', ja: '風の音、水の音、谷のこだまに身をゆだねる没入型サウンドスケープ。時間の流れがゆるやかになります。', ko: '바람 소리와 물소리, 계곡의 메아리에 몸을 맡기는 몰입형 사운드스케이프. 시간이 천천히 흐릅니다.', es: 'Un paseo sonoro inmersivo que ralentiza el tiempo con el viento, el agua y el eco del valle.' },
    'project.board': { zh: '访客留言', en: 'Guest messages', ja: 'ゲストのメッセージ', ko: '게스트 메시지', es: 'Mensajes de invitados' },
    'project.namePh': { zh: '昵称（默认访客）', en: 'Name (defaults to Guest)', ja: 'ニックネーム（未入力ならゲスト）', ko: '닉네임(입력하지 않으면 게스트)', es: 'Nombre (por defecto, Invitado)' },
    'project.textPh': { zh: '留下你的想法…', en: 'Share your thoughts…', ja: 'あなたの想いを残してください…', ko: '생각을 남겨 주세요…', es: 'Deja tu comentario…' },
    'project.submit': { zh: '发表留言', en: 'Post message', ja: '投稿する', ko: '남기기', es: 'Publicar' },
    'project.boardName': { zh: '云端留言板', en: 'Cloud guestbook', ja: 'クラウド掲示板', ko: '클라우드 방명록', es: 'Libro de visitas en la nube' },
    'project.boardEmpty': { zh: '还没有留言，写下第一条吧。', en: 'No messages yet—be the first to write one.', ja: 'まだメッセージはありません。最初のひとことを書いてみませんか。', ko: '아직 메시지가 없습니다. 첫 글을 남겨 보세요.', es: 'Aún no hay mensajes: sé el primero en escribir.' },
    'project.localMode': { zh: '本地模式', en: 'Local mode', ja: 'ローカルモード', ko: '로컬 모드', es: 'Modo local' },
    'project.localHint': { zh: '部署后可跨设备同步', en: 'Sync across devices once deployed', ja: 'デプロイすると端末をまたいで同期できます', ko: '배포하면 여러 기기에서 동기화됩니다', es: 'Se sincronizará entre dispositivos al desplegar' },
    'project.count': { zh: '{n} 条留言', en: '{n} messages', ja: '{n} 件のメッセージ', ko: '메시지 {n}개', es: '{n} mensajes' },

    /* ---------- 平台页 ---------- */
    'platform.title': { zh: '平台', en: 'Platform', ja: 'プラットフォーム', ko: '플랫폼', es: 'Plataforma' },
    'platform.sub': { zh: '内容发布与互动空间', en: 'A place to publish and connect', ja: '投稿と交流のための場所', ko: '게시와 소통을 위한 공간', es: 'Un espacio para publicar y conectar' },
    'platform.namePh': { zh: '昵称（默认访客）', en: 'Name (defaults to Guest)', ja: 'ニックネーム（未入力ならゲスト）', ko: '닉네임(입력하지 않으면 게스트)', es: 'Nombre (por defecto, Invitado)' },
    'platform.textPh': { zh: '分享此刻的想法或创作…', en: 'Share a thought or something you made…', ja: '今の想いや作品を共有しましょう…', ko: '지금의 생각이나 작업을 나눠 보세요…', es: 'Comparte una idea o algo que hayas creado…' },
    'platform.hint': { zh: '发布后展示在下方动态流', en: 'New posts appear in the feed below', ja: '投稿は下のタイムラインに表示されます', ko: '게시한 글은 아래 피드에 표시됩니다', es: 'Lo que publiques aparecerá en el muro de abajo' },
    'platform.publish': { zh: '发布动态', en: 'Post', ja: '投稿する', ko: '게시하기', es: 'Publicar' },
    'platform.feed': { zh: '创作与动态', en: 'Posts', ja: '作品とつぶやき', ko: '작업과 소식', es: 'Publicaciones' },
    'platform.count': { zh: '{n} 条动态', en: '{n} posts', ja: '{n} 件の投稿', ko: '게시물 {n}개', es: '{n} publicaciones' },

    /* ---------- 设置页 ---------- */
    'settings.title': { zh: '设置', en: 'Settings', ja: '設定', ko: '설정', es: 'Ajustes' },
    'settings.dark': { zh: '深色模式', en: 'Dark mode', ja: 'ダークモード', ko: '다크 모드', es: 'Modo oscuro' },
    'settings.notify': { zh: '通知提醒', en: 'Notifications', ja: '通知', ko: '알림', es: 'Notificaciones' },
    'settings.autoplay': { zh: '自动播放', en: 'Autoplay', ja: '自動再生', ko: '자동 재생', es: 'Reproducción automática' },
    'settings.about': { zh: '关于', en: 'About', ja: 'このサイトについて', ko: '정보', es: 'Acerca de' },
    'settings.hint': { zh: '设置会自动保存到本地，下次打开仍然生效', en: 'Your settings are saved on this device and stay the way you left them', ja: '設定はこの端末に自動保存され、次回も引き継がれます', ko: '설정은 이 기기에 자동 저장되어 다음에도 그대로 유지됩니다', es: 'Los ajustes se guardan en este dispositivo y se mantienen la próxima vez' },
    'settings.version': { zh: 'CEALIN · 个人', en: 'CEALIN · Personal', ja: 'CEALIN · パーソナル', ko: 'CEALIN · 개인', es: 'CEALIN · Personal' },

    /* ---------- 公告管理 ---------- */
    'na.title': { zh: '公告管理', en: 'Notice management', ja: 'お知らせ管理', ko: '공지사항 관리', es: 'Gestión de anuncios' },
    'na.sub': { zh: '在线编辑 · 保存后即时生效', en: 'Edit online—changes go live as soon as you save', ja: 'オンラインで編集 · 保存するとすぐ反映されます', ko: '온라인 편집 · 저장하면 바로 반영됩니다', es: 'Edita en línea: los cambios se publican al guardar' },
    'na.loginTip': { zh: '仅管理员可编辑公告，请输入密码后进入编辑界面', en: 'Only admins can edit the notice. Enter the password to continue.', ja: 'お知らせを編集できるのは管理者のみです。パスワードを入力して進んでください。', ko: '공지사항은 관리자만 수정할 수 있습니다. 비밀번호를 입력하고 진행해 주세요.', es: 'Solo los administradores pueden editar el anuncio. Introduce la contraseña para continuar.' },
    'na.clientOnly': { zh: '公告管理仅在 Cealin-admin 管理员客户端内开放，请使用管理员专用客户端进入。', en: 'Notice management is available only inside the Cealin-admin client. Please use the admin app.', ja: 'お知らせ管理は Cealin-admin クライアント内でのみ利用できます。管理者専用アプリから入ってください。', ko: '공지사항 관리는 Cealin-admin 클라이언트에서만 사용할 수 있습니다. 관리자 전용 앱으로 접속해 주세요.', es: 'La gestión de anuncios solo está disponible en el cliente Cealin-admin. Usa la app de administración.' },
    'na.viewTitle': { zh: '当前公告', en: 'Current notice', ja: '現在のお知らせ', ko: '현재 공지사항', es: 'Anuncio actual' },
    'na.viewEmpty': { zh: '暂无公告', en: 'No notice yet', ja: 'お知らせはまだありません', ko: '등록된 공지사항이 없습니다', es: 'Todavía no hay anuncios' },
    'na.pwdPh': { zh: '管理员密码', en: 'Admin password', ja: '管理者パスワード', ko: '관리자 비밀번호', es: 'Contraseña de administrador' },
    'na.verify': { zh: '验证身份', en: 'Verify', ja: '認証する', ko: '인증하기', es: 'Verificar' },
    'na.pwdHint': { zh: '管理员密码不对外公开，如需修改可在 KV 键 admin_pwd 中调整', en: 'The admin password is private; to change it, edit the admin_pwd key in KV', ja: '管理者パスワードは公開していません。変更する場合は KV の admin_pwd キーを編集してください', ko: '관리자 비밀번호는 공개되지 않습니다. 변경하려면 KV의 admin_pwd 키를 수정하세요', es: 'La contraseña de administrador no es pública; para cambiarla, edita la clave admin_pwd en KV' },
    'na.editTip': { zh: '公告内容（2000 字以内，留空保存将恢复默认公告）', en: 'Notice content (up to 2,000 characters; saving an empty field restores the default notice)', ja: 'お知らせの内容（2,000 文字以内。空欄で保存すると既定のお知らせに戻ります）', ko: '공지사항 내용(2,000자 이내, 비워 두고 저장하면 기본 공지로 돌아갑니다)', es: 'Contenido del anuncio (máx. 2000 caracteres; si lo dejas vacío, se restaura el anuncio predeterminado)' },
    'na.textPh': { zh: '在此输入公告内容……', en: 'Write the notice here…', ja: 'ここにお知らせの内容を入力してください…', ko: '여기에 공지사항 내용을 입력하세요…', es: 'Escribe aquí el anuncio…' },
    'na.save': { zh: '保存公告', en: 'Save notice', ja: 'お知らせを保存', ko: '공지 저장', es: 'Guardar anuncio' },
    'na.msg.deploy': { zh: '部署后可在线更新公告', en: 'Deploy to update the notice online', ja: 'デプロイするとオンラインで更新できます', ko: '배포하면 온라인에서 수정할 수 있습니다', es: 'Despliega para actualizar el anuncio en línea' },
    'na.msg.pwdEmpty': { zh: '请输入密码', en: 'Please enter the password', ja: 'パスワードを入力してください', ko: '비밀번호를 입력해 주세요', es: 'Introduce la contraseña' },
    'na.msg.deployLogin': { zh: '部署后可在线登录', en: 'Deploy to sign in online', ja: 'デプロイするとオンラインでログインできます', ko: '배포하면 온라인에서 로그인할 수 있습니다', es: 'Despliega para iniciar sesión en línea' },
    'na.msg.pwdWrong': { zh: '密码错误', en: 'Incorrect password', ja: 'パスワードが違います', ko: '비밀번호가 올바르지 않습니다', es: 'Contraseña incorrecta' },
    'na.msg.tooLong': { zh: '公告内容不能超过2000字', en: 'The notice cannot exceed 2,000 characters', ja: 'お知らせは 2,000 文字以内で入力してください', ko: '공지사항은 2,000자를 넘을 수 없습니다', es: 'El anuncio no puede superar los 2000 caracteres' },
    'na.msg.expired': { zh: '管理员身份已过期，请刷新页面重新登录', en: 'Your admin session has expired. Refresh the page and sign in again.', ja: '管理者の認証が切れました。ページを再読み込みしてログインし直してください。', ko: '관리자 인증이 만료되었습니다. 페이지를 새로 고친 뒤 다시 로그인해 주세요.', es: 'Tu sesión de administrador ha caducado. Actualiza la página y vuelve a entrar.' },
    'na.msg.saved': { zh: '公告已保存', en: 'Notice saved', ja: 'お知らせを保存しました', ko: '공지사항을 저장했습니다', es: 'Anuncio guardado' },
    'na.msg.saveFailed': { zh: '保存失败', en: 'Couldn’t save', ja: '保存に失敗しました', ko: '저장하지 못했습니다', es: 'No se pudo guardar' },
    'na.msg.translated': { zh: '公告已保存，并已自动翻译为 5 种语言', en: 'Notice saved and auto-translated into 5 languages', ja: 'お知らせを保存し、5 言語に自動翻訳しました', ko: '공지사항을 저장하고 5개 언어로 자동 번역했습니다', es: 'Anuncio guardado y traducido automáticamente a 5 idiomas' },
    'na.msg.translateFail': { zh: '公告已保存，但部分语言翻译失败，这些语言将显示中文原文', en: 'Notice saved, but some translations failed—those languages will show the Chinese original', ja: 'お知らせは保存しましたが、一部の言語の翻訳に失敗しました。その言語では中国語の原文を表示します', ko: '공지사항은 저장했지만 일부 언어 번역에 실패했습니다. 해당 언어에서는 중국어 원문이 표시됩니다', es: 'Anuncio guardado, pero algunas traducciones fallaron; esos idiomas mostrarán el original en chino' },

    /* ---------- 建议页 ---------- */
    'sug.title': { zh: '建议', en: 'Feedback', ja: 'ご意見', ko: '의견', es: 'Sugerencias' },
    'sug.sub': { zh: '你的想法，让 Cealin 更好', en: 'Your ideas make Cealin better', ja: 'あなたの声が Cealin を良くします', ko: '여러분의 의견이 Cealin을 더 좋게 만듭니다', es: 'Tus ideas hacen que Cealin mejore' },
    'sug.boxTitle': { zh: '提交建议', en: 'Send feedback', ja: 'ご意見を送る', ko: '의견 보내기', es: 'Enviar sugerencia' },
    'sug.tip': { zh: '可匿名提交，昵称留空将记为「匿名」；邮箱仅用于管理员回复，不会公开展示。', en: 'You can stay anonymous—leave the name blank and you’ll appear as “Anonymous”. Your email is used only for replies and is never shown publicly.', ja: '匿名で送信できます。ニックネームを空欄にすると「匿名」として扱われます。メールアドレスは返信のみに使用し、公開されることはありません。', ko: '익명으로 보낼 수 있습니다. 닉네임을 비워 두면 ‘익명’으로 표시됩니다. 이메일은 답변에만 사용되며 공개되지 않습니다.', es: 'Puedes enviarlo de forma anónima: si dejas el nombre vacío aparecerás como «Anónimo». El correo solo se usa para responderte y nunca se muestra públicamente.' },
    'sug.name': { zh: '昵称（可选）', en: 'Name (optional)', ja: 'ニックネーム（任意）', ko: '닉네임(선택)', es: 'Nombre (opcional)' },
    'sug.namePh': { zh: '留空则记为匿名', en: 'Leave blank to stay anonymous', ja: '空欄の場合は匿名になります', ko: '비워 두면 익명으로 표시됩니다', es: 'Déjalo vacío para permanecer en el anonimato' },
    'sug.email': { zh: '邮箱（可选）', en: 'Email (optional)', ja: 'メールアドレス（任意）', ko: '이메일(선택)', es: 'Correo electrónico (opcional)' },
    'sug.emailPh': { zh: '选填', en: 'Optional', ja: '任意', ko: '선택 사항', es: 'Opcional' },
    'sug.content': { zh: '建议内容', en: 'Your suggestion', ja: 'ご意見の内容', ko: '의견 내용', es: 'Tu sugerencia' },
    'sug.contentPh': { zh: '写下你的建议、反馈或想法…', en: 'Tell us what you’d like to see improved…', ja: 'ご意見やフィードバック、アイデアをお書きください…', ko: '개선 의견이나 피드백, 아이디어를 적어 주세요…', es: 'Cuéntanos qué te gustaría mejorar…' },
    'sug.count': { zh: '{n} / 1000', en: '{n} / 1000', ja: '{n} / 1000', ko: '{n} / 1000', es: '{n} / 1000' },
    'sug.submit': { zh: '提交建议', en: 'Send suggestion', ja: '送信する', ko: '보내기', es: 'Enviar sugerencia' },
    'sug.msg.empty': { zh: '建议内容不能为空', en: 'Please write your suggestion first', ja: 'ご意見の内容を入力してください', ko: '의견 내용을 입력해 주세요', es: 'Escribe tu sugerencia primero' },
    'sug.msg.tooLong': { zh: '建议内容不能超过 1000 字', en: 'Suggestions cannot exceed 1,000 characters', ja: 'ご意見は 1,000 文字以内で入力してください', ko: '의견은 1,000자를 넘을 수 없습니다', es: 'La sugerencia no puede superar los 1000 caracteres' },
    'sug.msg.emailBad': { zh: '邮箱格式不正确', en: 'That email address doesn’t look right', ja: 'メールアドレスの形式が正しくありません', ko: '이메일 형식이 올바르지 않습니다', es: 'El correo no parece válido' },
    'sug.msg.sending': { zh: '提交中…', en: 'Sending…', ja: '送信中…', ko: '보내는 중…', es: 'Enviando…' },
    'sug.msg.sent': { zh: '建议已提交，感谢你的反馈！', en: 'Sent—thank you for the feedback!', ja: '送信しました。ご意見ありがとうございます！', ko: '보냈습니다. 의견 감사합니다!', es: '¡Enviado! Gracias por tu opinión.' },
    'sug.msg.failed': { zh: '提交失败，请稍后重试', en: 'Couldn’t send—please try again in a moment', ja: '送信できませんでした。しばらくしてから再度お試しください', ko: '보내지 못했습니다. 잠시 후 다시 시도해 주세요', es: 'No se pudo enviar; inténtalo de nuevo en un momento' },
    'sug.msg.netErr': { zh: '网络异常，提交失败', en: 'Network error—nothing was sent', ja: '通信エラーで送信できませんでした', ko: '네트워크 오류로 보내지 못했습니다', es: 'Error de red: no se envió nada' },

    /* ---------- 管理页 ---------- */
    'ad.title': { zh: '管理员界面', en: 'Admin console', ja: '管理画面', ko: '관리자 페이지', es: 'Panel de administración' },
    'ad.sub': { zh: '欢迎回来，管理员', en: 'Welcome back, admin', ja: 'おかえりなさい、管理者さま', ko: '다시 오신 것을 환영합니다, 관리자님', es: 'Bienvenido de nuevo, administrador' },
    'ad.noticeTitle': { zh: '编辑公告', en: 'Edit notice', ja: 'お知らせを編集', ko: '공지사항 편집', es: 'Editar anuncio' },
    'ad.authTip': { zh: '管理员会话已过期，请返回首页重新登录。', en: 'Your admin session has expired. Please go back to the home page and sign in again.', ja: '管理者セッションの有効期限が切れました。ホームに戻ってログインし直してください。', ko: '관리자 세션이 만료되었습니다. 홈으로 돌아가 다시 로그인해 주세요.', es: 'Tu sesión de administrador ha caducado. Vuelve al inicio e inicia sesión de nuevo.' },
    'ad.textPh': { zh: '输入公告内容…', en: 'Write the notice…', ja: 'お知らせの内容を入力…', ko: '공지사항 내용 입력…', es: 'Escribe el anuncio…' },
    'ad.saveNotice': { zh: '保存公告', en: 'Save notice', ja: 'お知らせを保存', ko: '공지 저장', es: 'Guardar anuncio' },
    'ad.roomsTitle': { zh: '聊天室管理', en: 'Chat rooms', ja: 'チャットルーム管理', ko: '채팅방 관리', es: 'Salas de chat' },
    'ad.roomsTip': { zh: '查看已注册房间代码、消息数量与昵称占用情况。', en: 'Review registered room codes, message counts and the names in use.', ja: '登録済みのルームコード、メッセージ数、使用中のニックネームを確認できます。', ko: '등록된 방 코드와 메시지 수, 사용 중인 닉네임을 확인합니다.', es: 'Consulta los códigos de sala registrados, el número de mensajes y los nombres en uso.' },
    'ad.refresh': { zh: '刷新列表', en: 'Refresh', ja: '更新', ko: '새로 고침', es: 'Actualizar' },
    'ad.sugTitle': { zh: '建议管理', en: 'Feedback', ja: 'ご意見の管理', ko: '의견 관리', es: 'Gestión de sugerencias' },
    'ad.sugTip': { zh: '查看访客提交的建议，可删除单条。', en: 'Review suggestions from visitors and delete individual entries.', ja: 'ゲストから届いたご意見を確認し、必要に応じて削除できます。', ko: '방문자가 보낸 의견을 확인하고 개별 삭제할 수 있습니다.', es: 'Revisa las sugerencias recibidas y elimina las que quieras.' },
    'ad.enter': { zh: '进入聊天室', en: 'Enter the chat', ja: 'チャットに参加', ko: '채팅방 들어가기', es: 'Entrar al chat' },
    'ad.back': { zh: '返回首页', en: 'Back to home', ja: 'ホームに戻る', ko: '홈으로 돌아가기', es: 'Volver al inicio' },
    'ad.neverActive': { zh: '从未活跃', en: 'Never active', ja: '稼働なし', ko: '활동 없음', es: 'Sin actividad' },
    'ad.querying': { zh: '查询中…', en: 'Loading…', ja: '照会中…', ko: '조회 중…', es: 'Consultando…' },
    'ad.roomCount': { zh: '已注册房间 {n} 个', en: '{n} rooms registered', ja: '登録ルーム {n} 件', ko: '등록된 방 {n}개', es: '{n} salas registradas' },
    'ad.roomEmpty': { zh: '暂无已注册房间', en: 'No rooms registered yet', ja: '登録されたルームはありません', ko: '등록된 방이 없습니다', es: 'Aún no hay salas registradas' },
    'ad.names': { zh: '昵称：', en: 'Names: ', ja: 'ニックネーム：', ko: '닉네임: ', es: 'Nombres: ' },
    'ad.online': { zh: '（在线）', en: ' (online)', ja: '（オンライン）', ko: ' (온라인)', es: ' (en línea)' },
    'ad.noNames': { zh: '暂无昵称占用', en: 'No names in use', ja: '使用中のニックネームはありません', ko: '사용 중인 닉네임 없음', es: 'Sin nombres en uso' },
    'ad.revoke': { zh: '取消授权', en: 'Unverify', ja: '認証を取り消す', ko: '인증 취소', es: 'Quitar verificación' },
    'ad.verify': { zh: '官方授权', en: 'Verify', ja: '公式認証', ko: '공식 인증', es: 'Verificar' },
    'ad.bannedWord': { zh: '已封禁', en: 'Banned', ja: '利用停止中', ko: '차단됨', es: 'Bloqueada' },
    'ad.banWord': { zh: '封禁', en: 'Ban', ja: '利用停止', ko: '차단', es: 'Bloquear' },
    'ad.bannedTag': { zh: '已封禁 · {t}', en: 'Banned · {t}', ja: '利用停止 · {t}', ko: '차단 · {t}', es: 'Bloqueada · {t}' },
    'ad.verifiedTag': { zh: '官方认证 · {t}', en: 'Verified · {t}', ja: '公式認証 · {t}', ko: '공식 인증 · {t}', es: 'Verificada · {t}' },
    'ad.roomMeta': { zh: '消息 {m} 条 · 在线 {o} 人 · 最近活跃 {t}', en: '{m} messages · {o} online · last active {t}', ja: 'メッセージ {m} 件 · オンライン {o} 人 · 最終活動 {t}', ko: '메시지 {m}개 · 온라인 {o}명 · 최근 활동 {t}', es: '{m} mensajes · {o} en línea · última actividad {t}' },
    'ad.reported': { zh: '该房间被举报过', en: 'This room has been reported', ja: '通報されたルームです', ko: '신고된 방입니다', es: 'Esta sala ha sido reportada' },
    'ad.relogin': { zh: '请返回首页重新登录后使用', en: 'Please go back to the home page and sign in again', ja: 'ホームに戻ってログインし直してください', ko: '홈으로 돌아가 다시 로그인해 주세요', es: 'Vuelve al inicio e inicia sesión de nuevo' },
    'ad.pwdExpired': { zh: '密码错误或登录已过期，请返回首页重新登录', en: 'Incorrect password or session expired—go back to the home page and sign in again', ja: 'パスワードが違うか、ログインの有効期限が切れています。ホームに戻ってログインし直してください', ko: '비밀번호가 틀렸거나 로그인이 만료되었습니다. 홈으로 돌아가 다시 로그인해 주세요', es: 'Contraseña incorrecta o sesión caducada: vuelve al inicio e inicia sesión de nuevo' },
    'ad.queryFailed': { zh: '查询失败，请稍后重试', en: 'Couldn’t load—please try again in a moment', ja: '取得に失敗しました。しばらくしてから再度お試しください', ko: '불러오지 못했습니다. 잠시 후 다시 시도해 주세요', es: 'No se pudo cargar; inténtalo de nuevo en un momento' },
    'ad.netQuery': { zh: '网络异常，查询失败', en: 'Network error—nothing was loaded', ja: '通信エラーで取得できませんでした', ko: '네트워크 오류로 불러오지 못했습니다', es: 'Error de red: no se pudo cargar' },
    'ad.deleted': { zh: '已删除 {code}，云端数据已全部清除', en: 'Deleted {code}; all its cloud data has been cleared', ja: '{code} を削除しました。クラウド上のデータもすべて消去されました', ko: '{code}을(를) 삭제했습니다. 클라우드 데이터도 모두 지웠습니다', es: 'Se eliminó {code} y se borraron todos sus datos en la nube' },
    'ad.verifiedDone': { zh: '已授权 {code} 为官方认证房间', en: '{code} is now a verified room', ja: '{code} を公式認証ルームにしました', ko: '{code}을(를) 공식 인증 방으로 지정했습니다', es: '{code} ahora es una sala verificada' },
    'ad.unverifiedDone': { zh: '已取消 {code} 的官方授权', en: 'Verification removed from {code}', ja: '{code} の公式認証を取り消しました', ko: '{code}의 공식 인증을 취소했습니다', es: 'Se retiró la verificación de {code}' },
    'ad.bannedDone': { zh: '已封禁 {code}', en: '{code} has been banned', ja: '{code} を利用停止にしました', ko: '{code}을(를) 차단했습니다', es: 'Se bloqueó {code}' },
    'ad.opFailed': { zh: '操作失败，请稍后重试', en: 'That didn’t work—please try again in a moment', ja: '操作に失敗しました。しばらくしてから再度お試しください', ko: '작업을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요', es: 'No se pudo completar; inténtalo de nuevo en un momento' },
    'ad.netOp': { zh: '网络异常，操作失败', en: 'Network error—nothing changed', ja: '通信エラーで操作できませんでした', ko: '네트워크 오류로 작업하지 못했습니다', es: 'Error de red: no se aplicó ningún cambio' },
    'ad.confirmBan': { zh: '确认封禁聊天室 {code} ？封禁后该房间将被标记，10 天后自动清除。', en: 'Ban room {code}? It will be flagged and cleared automatically after 10 days.', ja: 'ルーム {code} を利用停止にしますか？ 停止後はマークされ、10 日後に自動で削除されます。', ko: '{code} 방을 차단할까요? 차단되면 표시되며 10일 후 자동으로 정리됩니다.', es: '¿Bloquear la sala {code}? Quedará marcada y se eliminará automáticamente en 10 días.' },
    'ad.confirmVerify': { zh: '确认授权聊天室 {code} 为官方认证房间？授权后该房间将显示认证横幅与金色 V 标。', en: 'Verify room {code}? Verified rooms show a banner and a gold badge.', ja: 'ルーム {code} を公式認証にしますか？ 認証後はバナーと金色のVマークが表示されます。', ko: '{code} 방을 공식 인증할까요? 인증되면 배너와 금색 V 표시가 나타납니다.', es: '¿Verificar la sala {code}? Las salas verificadas muestran un banner y una insignia dorada.' },
    'ad.confirmUnverify': { zh: '确认取消聊天室 {code} 的官方授权？', en: 'Remove verification from room {code}?', ja: 'ルーム {code} の公式認証を取り消しますか？', ko: '{code} 방의 공식 인증을 취소할까요?', es: '¿Retirar la verificación de la sala {code}?' },
    'ad.confirmDelete': { zh: '确认删除聊天室 {code} ？将立即清除该房间全部数据（消息、昵称、在线状态），不可恢复。', en: 'Delete room {code}? All its data—messages, names and presence—will be erased immediately and cannot be recovered.', ja: 'ルーム {code} を削除しますか？ メッセージ、ニックネーム、オンライン状況などすべてのデータが直ちに消去され、元に戻せません。', ko: '{code} 방을 삭제할까요? 메시지, 닉네임, 접속 상태 등 모든 데이터가 즉시 삭제되며 복구할 수 없습니다.', es: '¿Eliminar la sala {code}? Se borrarán de inmediato todos sus datos (mensajes, nombres y presencia) y no se podrán recuperar.' },
    'ad.sugCount': { zh: '共 {n} 条建议', en: '{n} suggestions', ja: 'ご意見 {n} 件', ko: '의견 {n}개', es: '{n} sugerencias' },
    'ad.sugEmpty': { zh: '暂无建议', en: 'No suggestions yet', ja: 'ご意見はまだありません', ko: '의견이 없습니다', es: 'Aún no hay sugerencias' },
    'ad.noEmail': { zh: '未留邮箱', en: 'no email', ja: 'メール未登録', ko: '이메일 없음', es: 'sin correo' },
    'ad.sugDeleted': { zh: '建议已删除', en: 'Suggestion deleted', ja: 'ご意見を削除しました', ko: '의견을 삭제했습니다', es: 'Sugerencia eliminada' },
    'ad.roomDeleted': { zh: '聊天室 {code} 已删除', en: 'Room {code} deleted', ja: 'チャットルーム {code} を削除しました', ko: '채팅방 {code}이(가) 삭제되었습니다', es: 'Sala {code} eliminada' },
    'ad.confirmDelSug': { zh: '确认删除这条建议？删除后不可恢复。', en: 'Delete this suggestion? This can’t be undone.', ja: 'このご意見を削除しますか？ 削除すると元に戻せません。', ko: '이 의견을 삭제할까요? 삭제 후에는 되돌릴 수 없습니다.', es: '¿Eliminar esta sugerencia? No se puede deshacer.' },
    'ad.noticeCount': { zh: '{n} / 2000', en: '{n} / 2000', ja: '{n} / 2000', ko: '{n} / 2000', es: '{n} / 2000' },

    'ad.noticeEmpty': { zh: '公告内容不能为空', en: 'The notice cannot be empty', ja: 'お知らせの内容を入力してください', ko: '공지사항 내용을 입력해 주세요', es: 'El anuncio no puede estar vacío' },
    'ad.noticeTooLong': { zh: '公告内容不能超过2000字', en: 'The notice cannot exceed 2,000 characters', ja: 'お知らせは 2,000 文字以内で入力してください', ko: '공지사항은 2,000자를 넘을 수 없습니다', es: 'El anuncio no puede superar los 2000 caracteres' },
    'ad.noticeSaved': { zh: '公告已保存', en: 'Notice saved', ja: 'お知らせを保存しました', ko: '공지사항을 저장했습니다', es: 'Anuncio guardado' },
    'ad.noticeSaveFailed': { zh: '保存失败，请稍后重试', en: 'Couldn’t save—please try again in a moment', ja: '保存に失敗しました。しばらくしてから再度お試しください', ko: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요', es: 'No se pudo guardar; inténtalo de nuevo en un momento' },
    'ad.noticeTranslated': { zh: '公告已保存，并已自动翻译为 5 种语言', en: 'Notice saved and auto-translated into 5 languages', ja: 'お知らせを保存し、5 言語に自動翻訳しました', ko: '공지사항을 저장하고 5개 언어로 자동 번역했습니다', es: 'Anuncio guardado y traducido automáticamente a 5 idiomas' },
    'ad.noticeTranslateFail': { zh: '公告已保存，但部分语言翻译失败，这些语言将显示中文原文', en: 'Notice saved, but some translations failed—those languages will show the Chinese original', ja: 'お知らせは保存しましたが、一部の言語の翻訳に失敗しました。その言語では中国語の原文を表示します', ko: '공지사항은 저장했지만 일부 언어 번역에 실패했습니다. 해당 언어에서는 중국어 원문이 표시됩니다', es: 'Anuncio guardado, pero algunas traducciones fallaron; esos idiomas mostrarán el original en chino' },
    'ad.netSave': { zh: '网络异常，保存失败', en: 'Network error—nothing was saved', ja: '通信エラーで保存できませんでした', ko: '네트워크 오류로 저장하지 못했습니다', es: 'Error de red: no se guardó nada' },
    'ad.noticeFallback': { zh: '欢迎来到 Cealin，请文明交流。', en: 'Welcome to Cealin. Please keep the conversation friendly.', ja: 'Cealin へようこそ。お互い気持ちよくやり取りしましょう。', ko: 'Cealin에 오신 것을 환영합니다. 서로 배려하며 대화해 주세요.', es: 'Bienvenido a Cealin. Mantengamos una conversación respetuosa.' },
    'ad.offTitle': { zh: '官方账号', en: 'Official accounts', ja: '公式アカウント', ko: '공식 계정', es: 'Cuentas oficiales' },
    'ad.offDesc': { zh: '按编号或名称搜索账号（支持部分匹配，不区分大小写），也可直接查看全部账号；可授予或取消官方身份。官方账号在聊天室发言时昵称后显示金色「官方」标识。', en: 'Search by account ID or name (partial match, case-insensitive), or browse all accounts at once. You can grant or revoke official status; official accounts show a gold “Official” badge after their name in chat.', ja: 'アカウントIDまたは名前で検索できます（部分一致・大文字小文字を区別しません）。すべてのアカウントを一覧表示することもできます。公式ステータスの付与・解除が可能で、公式アカウントはチャットで名前の後に金色の「公式」バッジが表示されます。', ko: '계정 ID 또는 이름으로 검색할 수 있습니다(부분 일치, 대소문자 구분 없음). 전체 계정을 한 번에 볼 수도 있습니다. 공식 상태를 부여하거나 해제할 수 있으며, 공식 계정은 채팅에서 이름 뒤에 금색 「공식」 배지가 표시됩니다.', es: 'Busca por ID o nombre de cuenta (coincidencia parcial, sin distinguir mayúsculas) o consulta todas las cuentas de una vez. Puedes conceder o retirar el estado oficial; las cuentas oficiales muestran una insignia dorada «Oficial» tras su nombre en el chat.' },
    'ad.offPh': { zh: '输入编号或名称（可输入部分）', en: 'Account ID or name (partial is fine)', ja: 'IDまたは名前を入力（一部でも可）', ko: 'ID 또는 이름 입력(일부만 입력해도 됨)', es: 'ID o nombre (puede ser parcial)' },
    'ad.offSearch': { zh: '搜索', en: 'Search', ja: '検索', ko: '검색', es: 'Buscar' },
    'ad.offSearching': { zh: '搜索中…', en: 'Searching…', ja: '検索中…', ko: '검색 중…', es: 'Buscando…' },
    'ad.offNeedQuery': { zh: '请先输入编号再搜索', en: 'Enter an ID to search', ja: 'IDを入力してから検索してください', ko: 'ID를 입력한 뒤 검색해 주세요', es: 'Introduce un ID para buscar' },
    'ad.offCount': { zh: '匹配账号 {n} 个', en: '{n} accounts matched', ja: '一致するアカウント {n} 件', ko: '일치하는 계정 {n}개', es: '{n} cuentas coinciden' },
    'ad.offEmpty': { zh: '没有匹配的账号', en: 'No accounts matched', ja: '一致するアカウントはありません', ko: '일치하는 계정이 없습니다', es: 'Ninguna cuenta coincide' },
    'ad.offTruncated': { zh: '匹配结果较多，仅显示前 50 个，请输入更完整的编号或名称缩小范围', en: 'Too many matches—showing the first 50. Enter a fuller ID or name to narrow it down.', ja: '一致件数が多いため先頭50件のみ表示しています。IDまたは名前を詳しく入力して絞り込んでください', ko: '일치 결과가 많아 앞의 50개만 표시합니다. ID 또는 이름을 더 정확히 입력해 범위를 좁혀 주세요', es: 'Hay demasiadas coincidencias: se muestran las primeras 50. Escribe un ID o nombre más completo para acotar.' },
    'ad.ovTitle': { zh: '概览', en: 'Overview', ja: '概要', ko: '개요', es: 'Resumen' },
    'ad.ovDesc': { zh: '在线人数、账号总数与聊天室数为实时读取结果；消息条数为抽样估算、存储占用为抽样推算，仅供容量参考。统计与搜索结果最多缓存 60 秒。', en: 'Online users, total accounts and chat rooms are read live; message totals are sampled estimates and storage usage is extrapolated, for capacity reference only. Stats and searches are cached for up to 60 seconds.', ja: 'オンライン人数・アカウント総数・チャットルーム数はリアルタイムに取得した値です。メッセージ数はサンプリングによる推定値、ストレージ使用量は抽出推算値で、容量の目安としてのみご利用ください。統計と検索の結果は最大 60 秒キャッシュされます。', ko: '온라인 인원, 전체 계정 수, 채팅방 수는 실시간으로 읽은 값입니다. 메시지 수는 표본 추정치, 저장 공간 사용량은 표본 추산치로 용량 참고용입니다. 통계와 검색 결과는 최대 60초간 캐시됩니다.', es: 'Los usuarios en línea, las cuentas totales y las salas se leen en tiempo real; el total de mensajes es una estimación por muestreo y el almacenamiento se extrapola, solo como referencia de capacidad. Las estadísticas y búsquedas se guardan en caché hasta 60 segundos.' },
    'ad.ovOnline': { zh: '在线人数', en: 'Online now', ja: 'オンライン人数', ko: '온라인 인원', es: 'En línea' },
    'ad.ovRate': { zh: '占账号总数 {p}%', en: '{p}% of all accounts', ja: '全アカウントの {p}%', ko: '전체 계정의 {p}%', es: '{p}% del total de cuentas' },
    'ad.ovNoAccount': { zh: '暂无账号数据', en: 'No accounts yet', ja: 'アカウントデータがありません', ko: '계정 데이터가 없습니다', es: 'Aún no hay datos de cuentas' },
    'ad.ovAccounts': { zh: '账号总数', en: 'Total accounts', ja: 'アカウント総数', ko: '전체 계정 수', es: 'Cuentas totales' },
    'ad.ovOffline': { zh: '离线 {n} 个', en: '{n} offline', ja: 'オフライン {n} 件', ko: '오프라인 {n}개', es: '{n} sin conexión' },
    'ad.ovRooms': { zh: '聊天室数量', en: 'Chat rooms', ja: 'チャットルーム数', ko: '채팅방 수', es: 'Salas de chat' },
    'ad.ovRoomsSub': { zh: '已读取 {n} 个房间的消息数', en: 'Message counts read from {n} rooms', ja: '{n} 件のルームからメッセージ数を取得', ko: '{n}개 방의 메시지 수를 읽음', es: 'Recuento de mensajes leído en {n} salas' },
    'ad.ovMessages': { zh: '消息总条数', en: 'Total messages', ja: 'メッセージ総数', ko: '전체 메시지 수', es: 'Mensajes totales' },
    'ad.ovMessagesSub': { zh: '按全部聊天室累计', en: 'Summed across all chat rooms', ja: 'すべてのルームの合計', ko: '모든 채팅방 합계', es: 'Suma de todas las salas' },
    'ad.ovMessagesEst': {
      zh: '抽样 {n} 个房间估算（共 {t} 个房间），非全量精确值',
      en: 'Estimated from {n} of {t} rooms—not an exact total',
      ja: '{t} 件中 {n} 件のルームを抽出した推定値（全体の正確な値ではありません）',
      ko: '{t}개 중 {n}개 방을 표본으로 한 추정치(전체 정확값 아님)',
      es: 'Estimado a partir de {n} de {t} salas; no es un total exacto'
    },
    'ad.ovQuota': {
      zh: '容量与配额 · 心跳间隔 <b>{h}</b> 分钟 · 在线判定 <b>{w}</b> 分钟 · 按 <b>{d}</b> 位日活、人均在线 <b>{m}</b> 分钟估算：每人约 <b>{per}</b> 次心跳，合计约 <b>{n}</b> 次写入/天。Workers KV 免费额度为 1000 次写入/天，付费版 100 万次写入/月，超出需升级。以上为按当前配置推算的静态说明，不是实时配额数据。',
      en: 'Capacity & quotas · heartbeat every <b>{h}</b> min · online threshold <b>{w}</b> min · with <b>{d}</b> daily active users online about <b>{m}</b> min each: about <b>{per}</b> heartbeats per user, roughly <b>{n}</b> writes per day. Workers KV includes 1,000 writes/day on the free plan and 1,000,000 writes/month on paid plans; above that an upgrade is required. These figures are a static calculation from the current configuration, not live quota data.',
      ja: '容量と割り当て · ハートビート間隔 <b>{h}</b> 分 · オンライン判定 <b>{w}</b> 分 · 日次アクティブ <b>{d}</b> 人・1人あたり平均 <b>{m}</b> 分オンラインと仮定：1人あたり約 <b>{per}</b> 回、合計で約 <b>{n}</b> 回の書き込み/日。Workers KV は無料枠が 1 日 1,000 回、有料版が月 100 万回の書き込みで、超過時はアップグレードが必要です。本表示は現在の設定から算出した静的な説明であり、リアルタイムの割り当て値ではありません。',
      ko: '용량 및 할당량 · 하트비트 간격 <b>{h}</b>분 · 온라인 판정 <b>{w}</b>분 · 일일 활성 사용자 <b>{d}</b>명, 1인당 평균 <b>{m}</b>분 접속 가정: 1인당 약 <b>{per}</b>회, 합계 약 <b>{n}</b>회 쓰기/일. Workers KV 무료 한도는 하루 1,000회 쓰기, 유료 플랜은 월 100만 회 쓰기이며 초과 시 업그레이드가 필요합니다. 이 안내는 현재 설정으로 계산한 정적 설명이며 실시간 할당량 데이터가 아닙니다.',
      es: 'Capacidad y cuotas · latido cada <b>{h}</b> min · umbral de conexión <b>{w}</b> min · con <b>{d}</b> usuarios activos al día y <b>{m}</b> min en línea de media: unas <b>{per}</b> latidos por usuario y en total unas <b>{n}</b> escrituras al día. Workers KV incluye 1.000 escrituras/día en el plan gratuito y 1.000.000 al mes en el de pago; por encima hay que ampliar. Estas cifras son un cálculo estático según la configuración actual, no datos de cuota en tiempo real.'
    },
    'ad.ovKvKeys': { zh: 'KV 键总数', en: 'KV keys', ja: 'KV キー総数', ko: 'KV 키 총수', es: 'Claves KV' },
    'ad.ovKvSub': { zh: '账号 {a} · 心跳 {p} · 房间 {r} · 建议 {s}', en: 'accounts {a} · heartbeat {p} · rooms {r} · suggestions {s}', ja: 'アカウント {a} · ハートビート {p} · ルーム {r} · 提案 {s}', ko: '계정 {a} · 하트비트 {p} · 방 {r} · 건의 {s}', es: 'cuentas {a} · latidos {p} · salas {r} · sugerencias {s}' },
    'ad.ovStorage': { zh: '存储占用', en: 'Storage usage', ja: 'ストレージ使用量', ko: '저장 공간 사용량', es: 'Uso de almacenamiento' },
    'ad.ovEstimate': { zh: '估算', en: 'Estimate', ja: '推定', ko: '추정', es: 'Estimado' },
    'ad.ovSizeSub': { zh: '由 {n} 个抽样键推算，非精确服务器指标', en: 'Extrapolated from {n} sampled keys—not an exact server metric', ja: '{n} 件のキーを抽出して算出した概算値（正確なサーバー指標ではありません）', ko: '{n}개 키를 표본으로 추산한 값(정확한 서버 지표가 아님)', es: 'Extrapolado de {n} claves muestreadas; no es una métrica exacta del servidor' },
    'ad.ovUpdated': { zh: '更新于 {t}', en: 'Updated {t}', ja: '{t} 更新', ko: '{t} 업데이트', es: 'Actualizado {t}' },
    'ad.ovRefresh': { zh: '刷新概览', en: 'Refresh overview', ja: '概要を更新', ko: '개요 새로고침', es: 'Actualizar resumen' },
    'ad.ovLoading': { zh: '正在统计…', en: 'Counting…', ja: '集計中…', ko: '집계 중…', es: 'Calculando…' },
    'ad.ovTruncated': { zh: '数据量超出单次统计上限，键数与消息数为部分统计结果', en: 'Data exceeded the per-request limit—key and message counts are partial', ja: 'データ量が1回の集計上限を超えているため、キー数とメッセージ数は一部のみの集計です', ko: '데이터가 1회 집계 한도를 초과해 키 수와 메시지 수는 일부만 집계되었습니다', es: 'Los datos superan el límite por solicitud: los recuentos de claves y mensajes son parciales' },
    'ad.accAll': { zh: '全部账号', en: 'All accounts', ja: 'すべてのアカウント', ko: '전체 계정', es: 'Todas las cuentas' },
    'ad.accSortHint': { zh: '排序：在线优先，离线在后；同组按最近活跃时间倒序。', en: 'Order: online first, offline after; newest activity first within each group.', ja: '並び順：オンラインが先、オフラインが後。各グループ内は最終アクティブの新しい順です。', ko: '정렬: 온라인 우선, 오프라인은 뒤로. 같은 그룹에서는 최근 활동 순입니다.', es: 'Orden: en línea primero, sin conexión después; dentro de cada grupo, actividad más reciente primero.' },
    'ad.accShowing': { zh: '共 {total} 个账号 · 在线 {online} · 显示前 {shown} 个', en: '{total} accounts · {online} online · showing first {shown}', ja: '全 {total} 件 · オンライン {online} 件 · 先頭 {shown} 件を表示', ko: '전체 {total}개 · 온라인 {online}개 · 앞의 {shown}개 표시', es: '{total} cuentas · {online} en línea · mostrando las primeras {shown}' },
    'ad.accMatched': { zh: '匹配 {matched} 个，共 {total} 个账号 · 在线 {online} · 显示 {shown} 个', en: '{matched} matched of {total} accounts · {online} online · showing {shown}', ja: '一致 {matched} 件／全 {total} 件 · オンライン {online} 件 · {shown} 件表示', ko: '일치 {matched}개 / 전체 {total}개 · 온라인 {online}개 · {shown}개 표시', es: '{matched} de {total} cuentas coinciden · {online} en línea · mostrando {shown}' },
    'ad.accTruncated': { zh: '账号较多，仅显示前 {n} 个（共 {total} 个匹配），可用搜索缩小范围', en: 'Showing the first {n} of {total} accounts—use search to narrow it down', ja: 'アカウントが多いため先頭 {n} 件のみ表示しています（一致 {total} 件）。検索で絞り込めます', ko: '계정이 많아 앞의 {n}개만 표시합니다(일치 {total}개). 검색으로 범위를 좁혀 보세요', es: 'Se muestran las primeras {n} de {total} cuentas; usa la búsqueda para acotar' },
    'ad.accPartial': { zh: '数据量较大，列表与统计可能不完整', en: 'Large dataset—the list and counts may be incomplete', ja: 'データ量が多いため、一覧と集計が不完全な場合があります', ko: '데이터가 많아 목록과 집계가 불완전할 수 있습니다', es: 'Hay muchos datos; la lista y los recuentos pueden estar incompletos' },
    'ad.accEmpty': { zh: '还没有任何账号', en: 'No accounts yet', ja: 'アカウントはまだありません', ko: '아직 계정이 없습니다', es: 'Aún no hay cuentas' },
    'ad.accOnline': { zh: '在线', en: 'Online', ja: 'オンライン', ko: '온라인', es: 'En línea' },
    'ad.accOffline': { zh: '离线', en: 'Offline', ja: 'オフライン', ko: '오프라인', es: 'Sin conexión' },
    'ad.accNow': { zh: '刚刚活跃', en: 'Active now', ja: '現在オンライン', ko: '방금 활동', es: 'Activo ahora' },
    'ad.accLastSeen': { zh: '最近活跃 {t}', en: 'Last seen {t}', ja: '最終アクティブ {t}', ko: '최근 활동 {t}', es: 'Última actividad {t}' },
    'ad.accNoSeen': { zh: '暂无活跃记录', en: 'No activity yet', ja: 'アクティブ記録なし', ko: '활동 기록 없음', es: 'Sin actividad registrada' },
    'ad.offCreated': { zh: '注册于 {t}', en: 'Registered {t}', ja: '{t} に登録', ko: '{t} 가입', es: 'Registro: {t}' },
    'ad.offTag': { zh: '官方', en: 'Official', ja: '公式', ko: '공식', es: 'Oficial' },
    'ad.offGrant': { zh: '授予官方', en: 'Grant official', ja: '公式にする', ko: '공식 지정', es: 'Hacer oficial' },
    'ad.offRevoke': { zh: '取消官方', en: 'Revoke official', ja: '公式を解除', ko: '공식 해제', es: 'Quitar oficial' },
    'ad.offGrantedDone': { zh: '已将 {id} 设为官方账号', en: '{id} is now an official account', ja: '{id} を公式アカウントにしました', ko: '{id}을(를) 공식 계정으로 지정했습니다', es: '{id} ahora es una cuenta oficial' },
    'ad.offRevokedDone': { zh: '已取消 {id} 的官方身份', en: 'Official status removed from {id}', ja: '{id} の公式ステータスを解除しました', ko: '{id}의 공식 상태를 해제했습니다', es: 'Se retiró el estado oficial de {id}' },

    /* ---------- 聊天室 ---------- */
    'chat.title': { zh: '聊天室', en: 'Chat', ja: 'チャット', ko: '채팅방', es: 'Chat' },
    'chat.sub': { zh: '四字代码 · 随时畅聊', en: 'Four-character codes, chat any time', ja: '4 文字コードですぐにチャット', ko: '네 글자 코드로 바로 대화', es: 'Códigos de cuatro caracteres para chatear cuando quieras' },
    'chat.editEntry': { zh: '编辑公告', en: 'Edit notice', ja: 'お知らせを編集', ko: '공지사항 편집', es: 'Editar anuncio' },
    'chat.roomTip': { zh: '每个聊天室有唯一四字代码，分享代码即可邀请朋友加入', en: 'Every room has its own four-character code—share it to invite friends', ja: 'ルームごとに固有の4文字コードがあります。コードを伝えれば友だちを招待できます', ko: '방마다 고유한 네 글자 코드가 있습니다. 코드를 공유하면 친구를 초대할 수 있습니다', es: 'Cada sala tiene su propio código de cuatro caracteres: compártelo para invitar a tus amigos' },
    'chat.nick': { zh: '昵称', en: 'Nickname', ja: 'ニックネーム', ko: '닉네임', es: 'Nombre' },
    'chat.nickPh': { zh: '给自己起个名字', en: 'Pick a name for yourself', ja: '表示名を決めてください', ko: '사용할 이름을 정해 주세요', es: 'Elige un nombre' },
    'chat.code': { zh: '房间代码', en: 'Room code', ja: 'ルームコード', ko: '방 코드', es: 'Código de sala' },
    'chat.codePh': { zh: '四字代码', en: 'Four-character code', ja: '4 文字のコード', ko: '네 글자 코드', es: 'Código de cuatro caracteres' },
    'chat.join': { zh: '加入房间', en: 'Join room', ja: 'ルームに参加', ko: '방 들어가기', es: 'Entrar en la sala' },
    'chat.create': { zh: '创建房间', en: 'Create room', ja: 'ルームを作成', ko: '방 만들기', es: 'Crear sala' },
    'chat.settings': { zh: '设置', en: 'Settings', ja: '設定', ko: '설정', es: 'Ajustes' },
    'chat.leave': { zh: '退出房间', en: 'Leave room', ja: 'ルームを出る', ko: '방 나가기', es: 'Salir de la sala' },
    'chat.newCodePh': { zh: '新四字代码', en: 'New four-character code', ja: '新しい4文字コード', ko: '새 네 글자 코드', es: 'Nuevo código de cuatro caracteres' },
    'chat.random': { zh: '随机生成', en: 'Generate', ja: 'ランダム生成', ko: '무작위 생성', es: 'Generar' },
    'chat.confirmChange': { zh: '确认更改', en: 'Confirm', ja: '変更する', ko: '변경하기', es: 'Confirmar' },
    'chat.settingsTitle': { zh: '聊天室设置', en: 'Room settings', ja: 'ルーム設定', ko: '채팅방 설정', es: 'Ajustes de la sala' },
    'chat.report': { zh: '举报房间', en: 'Report room', ja: 'ルームを報告', ko: '방 신고', es: 'Reportar sala' },
    'chat.reportDone': { zh: '已举报', en: 'Reported', ja: '報告済み', ko: '신고 완료', es: 'Reportada' },
    'chat.rename': { zh: '给聊天室起名', en: 'Name this room', ja: 'ルームに名前を付ける', ko: '채팅방 이름 정하기', es: 'Poner nombre a la sala' },
    'chat.renamePh': { zh: '输入房间显示名称（留空则恢复显示代码）', en: 'Room display name (leave blank to show the code again)', ja: 'ルームの表示名を入力（空欄にするとコード表示に戻ります）', ko: '채팅방 표시 이름 입력(비워 두면 코드로 표시됩니다)', es: 'Nombre visible de la sala (si lo dejas vacío, se vuelve a mostrar el código)' },
    'chat.saveName': { zh: '保存名称', en: 'Save name', ja: '名前を保存', ko: '이름 저장', es: 'Guardar nombre' },
    'chat.changeCode': { zh: '更改代码', en: 'Change code', ja: 'コードを変更', ko: '코드 변경', es: 'Cambiar código' },
    'chat.verified': { zh: '官方认证聊天室', en: 'Verified room', ja: '公式認証ルーム', ko: '공식 인증 채팅방', es: 'Sala verificada' },
    'chat.official': { zh: '官方', en: 'Official', ja: '公式', ko: '공식', es: 'Oficial' },
    'chat.banned': { zh: '聊天室已被封禁', en: 'This room has been banned', ja: 'このルームは利用停止中です', ko: '이 채팅방은 차단되었습니다', es: 'Esta sala ha sido bloqueada' },
    'chat.msgPh': { zh: '说点什么…', en: 'Say something…', ja: 'メッセージを入力…', ko: '메시지를 입력하세요…', es: 'Escribe algo…' },
    'chat.msgPhBanned': { zh: '聊天室已被封禁，无法发送消息', en: 'This room is banned—you can’t send messages', ja: '利用停止中のためメッセージを送信できません', ko: '차단된 채팅방이라 메시지를 보낼 수 없습니다', es: 'La sala está bloqueada: no puedes enviar mensajes' },
    'chat.send': { zh: '发送', en: 'Send', ja: '送信', ko: '보내기', es: 'Enviar' },
    'chat.roomCode': { zh: '房间代码 {code}', en: 'Room code {code}', ja: 'ルームコード {code}', ko: '방 코드 {code}', es: 'Código de sala {code}' },
    'chat.myName': { zh: '昵称：{name}', en: 'You: {name}', ja: 'ニックネーム：{name}', ko: '닉네임: {name}', es: 'Tú: {name}' },
    'chat.myNameAcc': { zh: '昵称：{name} · 账号 {id}', en: 'You: {name} · ID {id}', ja: 'ニックネーム：{name} · ID {id}', ko: '닉네임: {name} · ID {id}', es: 'Tú: {name} · ID {id}' },
    'chat.accHint': { zh: '已登录账号 {id}，进房自动使用账号名称作为昵称', en: 'Signed in as {id}—your account name is used as the nickname', ja: 'アカウント {id} でログイン中：ニックネームにはアカウント名を自動で使います', ko: '계정 {id}(으)로 로그인됨 — 계정 이름이 닉네임으로 자동 사용됩니다', es: 'Sesión iniciada como {id}: tu nombre de cuenta se usa como nombre en el chat' },
    'chat.accHintTaken': { zh: '账号名称「{name}」在房内已被使用，可临时改用其他昵称，此时消息不关联账号', en: '“{name}” is already in this room—use another nickname for now; such messages won’t be linked to your account', ja: '「{name}」はこのルームで使用中です。別のニックネームで入れますが、そのメッセージはアカウントに紐づきません', ko: '이 방에서 「{name}」이(가) 이미 사용 중입니다. 다른 닉네임으로 입장할 수 있지만 해당 메시지는 계정에 연결되지 않습니다', es: '«{name}» ya está en esta sala: usa otro nombre por ahora; esos mensajes no quedarán vinculados a tu cuenta' },
    'chat.mine': { zh: '我', en: 'You', ja: '自分', ko: '나', es: 'Yo' },
    'chat.noticeFallback': { zh: '欢迎来到 Cealin 聊天室，请文明交流，聊天记录云端同步。', en: 'Welcome to the Cealin chat. Keep it friendly—messages sync to the cloud.', ja: 'Cealin チャットへようこそ。気持ちよく会話しましょう。メッセージはクラウドに同期されます。', ko: 'Cealin 채팅방에 오신 것을 환영합니다. 서로 배려하며 대화해 주세요. 메시지는 클라우드에 동기화됩니다.', es: 'Bienvenido al chat de Cealin. Conversemos con respeto: los mensajes se sincronizan en la nube.' },
    'chat.offline': { zh: '部署后可跨设备聊天', en: 'Deploy to chat across devices', ja: 'デプロイすると端末をまたいでチャットできます', ko: '배포하면 여러 기기에서 대화할 수 있습니다', es: 'Despliega para chatear entre dispositivos' },
    'chat.needNick': { zh: '请先输入昵称', en: 'Enter a nickname first', ja: '先にニックネームを入力してください', ko: '먼저 닉네임을 입력해 주세요', es: 'Primero escribe un nombre' },
    'chat.codeRule': { zh: '房间代码为四字代码（字母或数字）', en: 'Room codes are four letters or digits', ja: 'ルームコードは4文字の英数字です', ko: '방 코드는 영문 또는 숫자 네 글자입니다', es: 'El código debe tener cuatro letras o números' },
    'chat.codeRule4': { zh: '房间代码须为4位字母或数字', en: 'The room code must be 4 letters or numbers', ja: 'ルームコードは4文字の英数字で入力してください', ko: '방 코드는 영문 또는 숫자 네 글자여야 합니다', es: 'El código debe tener 4 letras o números' },
    'chat.createFailed': { zh: '创建房间失败', en: 'Couldn’t create the room', ja: 'ルームを作成できませんでした', ko: '방을 만들지 못했습니다', es: 'No se pudo crear la sala' },
    'chat.joinFailed': { zh: '加入房间失败', en: 'Couldn’t join the room', ja: 'ルームに参加できませんでした', ko: '방에 들어가지 못했습니다', es: 'No se pudo entrar en la sala' },
    'chat.reportOk': { zh: '已举报该聊天室，感谢反馈', en: 'Room reported—thanks for letting us know', ja: 'ルームを報告しました。ご協力ありがとうございます', ko: '방을 신고했습니다. 알려 주셔서 감사합니다', es: 'Sala reportada. Gracias por avisarnos' },
    'chat.reportFailed': { zh: '举报失败，请稍后重试', en: 'Couldn’t report the room—please try again in a moment', ja: '報告できませんでした。しばらくしてから再度お試しください', ko: '신고하지 못했습니다. 잠시 후 다시 시도해 주세요', es: 'No se pudo reportar; inténtalo de nuevo en un momento' },
    'chat.nameSaved': { zh: '房间名称已保存为「{name}」', en: 'Room name saved as “{name}”', ja: 'ルーム名を「{name}」として保存しました', ko: '채팅방 이름을 ‘{name}’(으)로 저장했습니다', es: 'Nombre de la sala guardado como «{name}»' },
    'chat.nameCleared': { zh: '已恢复显示房间代码', en: 'Showing the room code again', ja: 'コード表示に戻しました', ko: '코드 표시로 돌아갔습니다', es: 'Se vuelve a mostrar el código de la sala' },
    'chat.saveFailed': { zh: '保存失败', en: 'Couldn’t save', ja: '保存できませんでした', ko: '저장하지 못했습니다', es: 'No se pudo guardar' },
    'chat.saveFailedRetry': { zh: '保存失败，请稍后重试', en: 'Couldn’t save—please try again in a moment', ja: '保存できませんでした。しばらくしてから再度お試しください', ko: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요', es: 'No se pudo guardar; inténtalo de nuevo en un momento' },
    'chat.changeFailed': { zh: '更改失败', en: 'Couldn’t change it', ja: '変更できませんでした', ko: '변경하지 못했습니다', es: 'No se pudo cambiar' },
    'chat.codeUpdated': { zh: '房间代码已更新为 {code}', en: 'Room code updated to {code}', ja: 'ルームコードを {code} に更新しました', ko: '방 코드를 {code}(으)로 변경했습니다', es: 'El código de la sala ahora es {code}' },
    'chat.empty': { zh: '暂无消息，来发第一条吧', en: 'No messages yet—say hello', ja: 'まだメッセージはありません。最初のひとことを送ってみましょう', ko: '아직 메시지가 없습니다. 먼저 인사해 보세요', es: 'Aún no hay mensajes: sé el primero en escribir' },

    /* ---------- 账号（注册 / 编号登录） ---------- */
    'acc.title': { zh: '账号', en: 'Account', ja: 'アカウント', ko: '계정', es: 'Cuenta' },
    'acc.sub': { zh: '只用名称和密码注册，系统会自动分配一个唯一编号', en: 'Sign up with just a name and a password—we assign a unique ID for you', ja: '名前とパスワードだけで登録できます。専用のIDを自動で発行します', ko: '이름과 비밀번호만으로 가입할 수 있으며, 전용 ID를 자동으로 발급해 드립니다', es: 'Regístrate solo con un nombre y una contraseña: te asignamos un ID único' },
    'acc.needLogin': { zh: '未登录无法使用站内功能，请先注册或登录', en: 'You cannot use any feature of this site without signing in—please sign up or log in first', ja: 'ログインしないとサイト内の機能はご利用いただけません。先に登録またはログインしてください', ko: '로그인하지 않으면 사이트 기능을 사용할 수 없습니다. 먼저 가입하거나 로그인해 주세요', es: 'No puedes usar ninguna función del sitio sin iniciar sesión: regístrate o inicia sesión primero' },
    'acc.tabRegister': { zh: '注册', en: 'Sign up', ja: '新規登録', ko: '회원가입', es: 'Registrarse' },
    'acc.tabLogin': { zh: '登录', en: 'Log in', ja: 'ログイン', ko: '로그인', es: 'Iniciar sesión' },
    'acc.name': { zh: '名称', en: 'Name', ja: '名前', ko: '이름', es: 'Nombre' },
    'acc.namePh': { zh: '给自己起个名称（可重名）', en: 'Pick a name (duplicates are fine)', ja: '好きな名前を入力（重複可）', ko: '사용할 이름을 입력하세요 (중복 가능)', es: 'Elige un nombre (puede repetirse)' },
    'acc.pwd': { zh: '密码', en: 'Password', ja: 'パスワード', ko: '비밀번호', es: 'Contraseña' },
    'acc.pwdPh': { zh: '至少 6 位', en: 'At least 6 characters', ja: '6文字以上', ko: '6자 이상', es: 'Mínimo 6 caracteres' },
    'acc.pwdHint': { zh: '密码经 SHA-256 加盐哈希后存储，不会明文保存', en: 'Passwords are stored as salted SHA-256 hashes—never in plain text', ja: 'パスワードはソルト付きSHA-256でハッシュ化して保存され、平文では保持しません', ko: '비밀번호는 솔트를 더해 SHA-256으로 해시하여 저장되며 평문으로 보관하지 않습니다', es: 'La contraseña se guarda como hash SHA-256 con sal, nunca en texto plano' },
    'acc.registerBtn': { zh: '注册并获取编号', en: 'Sign up and get my ID', ja: '登録してIDを取得', ko: '가입하고 ID 받기', es: 'Registrarme y obtener mi ID' },
    'acc.registering': { zh: '正在注册…', en: 'Signing you up…', ja: '登録しています…', ko: '가입 처리 중…', es: 'Creando tu cuenta…' },
    'acc.id': { zh: '编号', en: 'Account ID', ja: 'アカウントID', ko: '계정 ID', es: 'ID de cuenta' },
    'acc.idPh': { zh: '账号编号（6 或 8 位）', en: 'Account ID (6 or 8 characters)', ja: 'アカウントID（6桁または8桁）', ko: '계정 ID (6자리 또는 8자리)', es: 'ID de cuenta (6 u 8 caracteres)' },
    'acc.idHint': { zh: '登录只认编号，不认名称', en: 'Only the ID works for signing in—names are not accepted', ja: 'ログインに使えるのはIDのみで、名前ではログインできません', ko: '로그인은 ID로만 가능하며 이름으로는 로그인할 수 없습니다', es: 'Solo el ID sirve para entrar, el nombre no' },
    'acc.loginBtn': { zh: '登录', en: 'Log in', ja: 'ログイン', ko: '로그인', es: 'Entrar' },
    'acc.loggingIn': { zh: '正在登录…', en: 'Logging in…', ja: 'ログインしています…', ko: '로그인 중…', es: 'Entrando…' },
    'acc.loginOk': { zh: '登录成功，正在进入游客界面…', en: 'Logged in—taking you to the guest area…', ja: 'ログインしました。ゲストページへ移動します…', ko: '로그인했습니다. 게스트 페이지로 이동합니다…', es: 'Sesión iniciada: te llevamos al área de invitado…' },
    'acc.created': { zh: '注册成功，这是你的账号编号', en: 'You are all set—here is your account ID', ja: '登録が完了しました。これがあなたのアカウントIDです', ko: '가입이 완료되었습니다. 이것이 회원님의 계정 ID입니다', es: 'Registro completado: este es tu ID de cuenta' },
    'acc.keepSafe': { zh: '请务必记住编号，它是登录的唯一凭证，遗失后无法找回', en: 'Be sure to remember this ID—it is the only way to log in and cannot be recovered', ja: 'このIDは必ず控えてください。ログインに必要な唯一の情報で、紛失すると復元できません', ko: '이 ID를 반드시 기억해 주세요. 로그인에 필요한 유일한 수단이며 분실하면 복구할 수 없습니다', es: 'Guarda bien este ID: es la única forma de entrar y no se puede recuperar' },
    'acc.copy': { zh: '复制编号', en: 'Copy ID', ja: 'IDをコピー', ko: 'ID 복사', es: 'Copiar ID' },
    'acc.copied': { zh: '已复制', en: 'Copied', ja: 'コピーしました', ko: '복사됨', es: 'Copiado' },
    'acc.goLogin': { zh: '用这个编号登录', en: 'Log in with this ID', ja: 'このIDでログイン', ko: '이 ID로 로그인', es: 'Entrar con este ID' },
    'acc.setTitle': { zh: '账号设置', en: 'Account settings', ja: 'アカウント設定', ko: '계정 설정', es: 'Ajustes de la cuenta' },
    'acc.curIdLabel': { zh: '当前登录编号', en: 'Current ID', ja: '現在のアカウントID', ko: '현재 계정 ID', es: 'ID actual' },
    'acc.toMine': {
      zh: '账号设置（更改密码、更改编号、退出登录）已移至',
      en: 'Password, ID and sign-out settings have moved to',
      ja: 'パスワード・ID の変更やログアウトはこちらに移動しました：',
      ko: '비밀번호·ID 변경과 로그아웃은 다음 페이지로 이동했습니다:',
      es: 'Los ajustes de contraseña, ID y cierre de sesión están ahora en'
    },

    'acc.newId': { zh: '新编号', en: 'New ID', ja: '新しいID', ko: '새 ID', es: 'Nuevo ID' },
    'acc.newIdPh': { zh: '8 位：数字、字母或 @', en: '8 characters: digits, letters or @', ja: '8桁：数字・英字・@', ko: '8자리: 숫자, 영문, @', es: '8 caracteres: números, letras o @' },
    'acc.chgRule': { zh: '须为 8 位，只能使用数字、字母（大小写均可）和 @，且不能与他人重复', en: 'Must be 8 characters, using only digits, letters (either case) and @, and it must not be taken', ja: '8桁で、数字・英字（大文字小文字）・@ のみ使用できます。他の人と重複はできません', ko: '8자리여야 하며 숫자, 영문(대소문자), @만 사용할 수 있고 다른 사람과 중복될 수 없습니다', es: 'Debe tener 8 caracteres y solo puede incluir números, letras (mayúsculas o minúsculas) y @, sin coincidir con otro' },
    'acc.chgLen': { zh: '还需要输入满 8 位', en: 'Still needs to reach 8 characters', ja: '8桁まであと少しです', ko: '8자리까지 입력이 필요합니다', es: 'Todavía debe llegar a 8 caracteres' },
    'acc.chgChar': { zh: '只能使用数字、字母和 @', en: 'Only digits, letters and @ are allowed', ja: '数字・英字・@ のみ使用できます', ko: '숫자, 영문, @만 사용할 수 있습니다', es: 'Solo se permiten números, letras y @' },
    'acc.chgSame': { zh: '与原编号相同，请换一个', en: 'Same as your current ID—pick another', ja: '現在のIDと同じです。別のIDにしてください', ko: '현재 ID와 같습니다. 다른 ID를 입력해 주세요', es: 'Es igual a tu ID actual: elige otro' },
    'acc.chgOk': { zh: '格式可用，输入密码后即可更改', en: 'Format looks good—enter your password to change it', ja: '形式は問題ありません。パスワードを入力すると変更できます', ko: '형식이 올바릅니다. 비밀번호를 입력하면 변경할 수 있습니다', es: 'El formato es válido: introduce tu contraseña para cambiarlo' },
    'acc.changeBtn': { zh: '更改编号', en: 'Change ID', ja: 'IDを変更', ko: 'ID 변경', es: 'Cambiar ID' },
    'acc.changing': { zh: '正在更改…', en: 'Changing…', ja: '変更しています…', ko: '변경 중…', es: 'Cambiando…' },
    'acc.changed': { zh: '编号已更改，此后请使用新编号登录', en: 'Your ID has been changed—use the new one from now on', ja: 'IDを変更しました。今後は新しいIDでログインしてください', ko: 'ID를 변경했습니다. 이제 새 ID로 로그인해 주세요', es: 'Tu ID ha cambiado: usa el nuevo de ahora en adelante' },
    'acc.changeOk': { zh: '更改成功，登录状态已同步', en: 'Changed successfully—your session is already updated', ja: '変更しました。ログイン状態も更新済みです', ko: '변경했습니다. 로그인 상태도 갱신되었습니다', es: 'Cambiado: tu sesión ya está actualizada' },
    /* 账号设置分区标题：更改密码 / 更改编号（代码）/ 登录状态 */
    'acc.secPwd': { zh: '更改密码', en: 'Change password', ja: 'パスワードを変更', ko: '비밀번호 변경', es: 'Cambiar contraseña' },
    'acc.secId': { zh: '更改编号（代码）', en: 'Change ID (code)', ja: 'アカウントID（コード）を変更', ko: 'ID(코드) 변경', es: 'Cambiar ID (código)' },
    'acc.secSession': { zh: '登录状态', en: 'Login status', ja: 'ログイン状態', ko: '로그인 상태', es: 'Estado de la sesión' },
    /* 更改密码表单 */
    'acc.curPwd': { zh: '当前密码', en: 'Current password', ja: '現在のパスワード', ko: '현재 비밀번호', es: 'Contraseña actual' },
    'acc.curPwdPh': { zh: '请输入当前密码', en: 'Enter your current password', ja: '現在のパスワードを入力してください', ko: '현재 비밀번호를 입력하세요', es: 'Escribe tu contraseña actual' },
    'acc.newPwd': { zh: '新密码', en: 'New password', ja: '新しいパスワード', ko: '새 비밀번호', es: 'Nueva contraseña' },
    'acc.newPwdPh': { zh: '6–64 位', en: '6–64 characters', ja: '6～64文字', ko: '6~64자', es: 'De 6 a 64 caracteres' },
    'acc.confirmPwd': { zh: '确认新密码', en: 'Confirm new password', ja: '新しいパスワード（確認）', ko: '새 비밀번호 확인', es: 'Confirmar la nueva contraseña' },
    'acc.confirmPwdPh': { zh: '再输入一次新密码', en: 'Type the new password again', ja: 'もう一度入力してください', ko: '새 비밀번호를 다시 입력하세요', es: 'Escribe de nuevo la nueva contraseña' },
    'acc.pwdRule': { zh: '新密码 6–64 位，且不能与当前密码相同', en: 'The new password must be 6–64 characters long and differ from your current one', ja: '新しいパスワードは6～64文字で、現在のパスワードと異なる必要があります', ko: '새 비밀번호는 6~64자이며 현재 비밀번호와 달라야 합니다', es: 'La nueva contraseña debe tener entre 6 y 64 caracteres y ser distinta de la actual' },
    'acc.pwdBtn': { zh: '更改密码', en: 'Change password', ja: 'パスワードを変更', ko: '비밀번호 변경', es: 'Cambiar contraseña' },
    'acc.pwdChanging': { zh: '正在更改…', en: 'Changing…', ja: '変更しています…', ko: '변경 중…', es: 'Cambiando…' },
    'acc.pwdOk': { zh: '密码已更改', en: 'Your password has been changed', ja: 'パスワードを変更しました', ko: '비밀번호를 변경했습니다', es: 'Tu contraseña se ha cambiado' },
    /* 退出登录 */
    'acc.logoutBtn': { zh: '退出登录', en: 'Log out', ja: 'ログアウト', ko: '로그아웃', es: 'Cerrar sesión' },
    'acc.logoutHint': { zh: '退出后将清除本机的登录状态，需重新登录才能使用站内功能', en: 'Logging out clears the sign-in state on this device—you will need to log in again to use the site', ja: 'ログアウトするとこの端末のログイン状態が消去され、サイト内の機能を使うには再度ログインが必要です', ko: '로그아웃하면 이 기기의 로그인 상태가 삭제되며, 사이트 기능을 사용하려면 다시 로그인해야 합니다', es: 'Al cerrar sesión se borra el estado de acceso en este dispositivo: tendrás que iniciar sesión de nuevo para usar el sitio' },
    'acc.logoutOk': { zh: '已退出登录，正在返回登录页…', en: 'Signed out—returning to the sign-in page…', ja: 'ログアウトしました。ログインページに戻ります…', ko: '로그아웃했습니다. 로그인 페이지로 이동합니다…', es: 'Sesión cerrada: volviendo a la página de acceso…' },

    'acc.err.name_required': { zh: '请输入名称', en: 'Please enter a name', ja: '名前を入力してください', ko: '이름을 입력해 주세요', es: 'Escribe un nombre' },
    'acc.err.name_long': { zh: '名称最多 20 个字符', en: 'Names can be up to 20 characters', ja: '名前は20文字以内で入力してください', ko: '이름은 최대 20자까지 가능합니다', es: 'El nombre admite hasta 20 caracteres' },
    'acc.err.pwd_short': { zh: '密码至少需要 6 位', en: 'Password must be at least 6 characters', ja: 'パスワードは6文字以上で入力してください', ko: '비밀번호는 6자 이상이어야 합니다', es: 'La contraseña debe tener al menos 6 caracteres' },
    'acc.err.pwd_long': { zh: '密码最长 64 位', en: 'Password must be 64 characters or less', ja: 'パスワードは64文字以内で入力してください', ko: '비밀번호는 64자 이하여야 합니다', es: 'La contraseña no puede superar los 64 caracteres' },
    'acc.err.pwd_required': { zh: '请输入密码', en: 'Please enter your password', ja: 'パスワードを入力してください', ko: '비밀번호를 입력해 주세요', es: 'Escribe tu contraseña' },
    'acc.err.id_short': { zh: '请输入 6 位或 8 位账号编号', en: 'Enter a 6- or 8-character account ID', ja: '6桁または8桁のアカウントIDを入力してください', ko: '6자리 또는 8자리 계정 ID를 입력해 주세요', es: 'Escribe un ID de 6 u 8 caracteres' },
    'acc.err.id_bad': { zh: '编号格式不正确', en: 'That ID format is not valid', ja: 'IDの形式が正しくありません', ko: 'ID 형식이 올바르지 않습니다', es: 'El formato del ID no es válido' },
    'acc.err.bad_cred': { zh: '编号或密码错误', en: 'Wrong ID or password', ja: 'IDまたはパスワードが違います', ko: 'ID 또는 비밀번호가 올바르지 않습니다', es: 'ID o contraseña incorrectos' },
    'acc.err.hash_bad': { zh: '密码哈希格式不正确', en: 'The password hash format is invalid', ja: 'パスワードハッシュの形式が正しくありません', ko: '비밀번호 해시 형식이 올바르지 않습니다', es: 'El formato del hash de contraseña no es válido' },
    'acc.err.salt_bad': { zh: '盐格式不正确', en: 'The salt format is invalid', ja: 'ソルトの形式が正しくありません', ko: '솔트 형식이 올바르지 않습니다', es: 'El formato de la sal no es válido' },
    'acc.err.id_exhausted': { zh: '编号分配失败，请稍后重试', en: 'Could not assign an ID—please try again', ja: 'IDを発行できませんでした。しばらくしてからお試しください', ko: 'ID를 발급하지 못했습니다. 잠시 후 다시 시도해 주세요', es: 'No se pudo asignar un ID: inténtalo de nuevo' },
    'acc.err.no_crypto': { zh: '当前环境不支持安全哈希，请用 https 打开', en: 'Secure hashing is unavailable here—please open the site over https', ja: 'この環境では安全なハッシュ化を利用できません。https で開いてください', ko: '이 환경에서는 안전한 해시를 사용할 수 없습니다. https로 열어 주세요', es: 'Este entorno no admite hash seguro: abre la página con https' },
    'acc.err.net': { zh: '网络异常，请稍后重试', en: 'Network problem—please try again', ja: '通信エラーです。しばらくしてからお試しください', ko: '네트워크 오류입니다. 잠시 후 다시 시도해 주세요', es: 'Error de red: inténtalo de nuevo' },
    'acc.err.server': { zh: '服务异常，请稍后重试', en: 'Something went wrong—please try again', ja: 'サーバーエラーです。しばらくしてからお試しください', ko: '서버 오류입니다. 잠시 후 다시 시도해 주세요', es: 'Error del servidor: inténtalo de nuevo' },
    'acc.err.not_login': { zh: '请先登录后再操作', en: 'Log in first to continue', ja: '操作するには先にログインしてください', ko: '작업하려면 먼저 로그인해 주세요', es: 'Inicia sesión para continuar' },
    'acc.err.pwd_same': { zh: '新密码不能与当前密码相同', en: 'The new password must differ from your current one', ja: '新しいパスワードは現在のパスワードと異なる必要があります', ko: '새 비밀번호는 현재 비밀번호와 달라야 합니다', es: 'La nueva contraseña debe ser distinta de la actual' },
    'acc.err.new_pwd_required': { zh: '请输入新密码', en: 'Please enter a new password', ja: '新しいパスワードを入力してください', ko: '새 비밀번호를 입력해 주세요', es: 'Escribe una contraseña nueva' },
    'acc.err.pwd_mismatch': { zh: '两次输入的新密码不一致', en: 'The two new passwords do not match', ja: '新しいパスワードが一致しません', ko: '새 비밀번호가 일치하지 않습니다', es: 'Las dos contraseñas nuevas no coinciden' },
    'acc.err.new_id_required': { zh: '请输入新编号', en: 'Enter a new ID', ja: '新しいIDを入力してください', ko: '새 ID를 입력해 주세요', es: 'Escribe un nuevo ID' },
    'acc.err.id_len': { zh: '新编号必须是 8 位', en: 'The new ID must be exactly 8 characters', ja: '新しいIDは8桁にしてください', ko: '새 ID는 8자리여야 합니다', es: 'El nuevo ID debe tener exactamente 8 caracteres' },
    'acc.err.id_char': { zh: '新编号只能包含数字、字母和 @', en: 'The new ID may only contain digits, letters and @', ja: '新しいIDに使えるのは数字・英字・@ のみです', ko: '새 ID에는 숫자, 영문, @만 사용할 수 있습니다', es: 'El nuevo ID solo puede contener números, letras y @' },
    'acc.err.id_same': { zh: '新编号与原编号相同', en: 'The new ID matches your current one', ja: '新しいIDが現在のIDと同じです', ko: '새 ID가 현재 ID와 같습니다', es: 'El nuevo ID es igual al actual' },
    'acc.err.id_taken': { zh: '该编号已被占用，请换一个', en: 'That ID is already taken—pick another', ja: 'そのIDはすでに使われています。別のIDにしてください', ko: '이미 사용 중인 ID입니다. 다른 ID를 입력해 주세요', es: 'Ese ID ya está en uso: elige otro' },
    'acc.err.id_not_found': { zh: '账号不存在或已被更改', en: 'That account no longer exists', ja: 'アカウントが見つかりません', ko: '계정을 찾을 수 없습니다', es: 'Esa cuenta ya no existe' },
    'acc.err.admin_pwd': { zh: '管理员密码校验失败，请重新登录后台', en: 'Admin password check failed—sign in to the console again', ja: '管理者パスワードの確認に失敗しました。管理画面に再ログインしてください', ko: '관리자 비밀번호 확인에 실패했습니다. 관리자 화면에 다시 로그인해 주세요', es: 'La contraseña de administrador no es válida: vuelve a entrar en el panel' },

    /* ---------- 我的（个人中心） ---------- */
    'mine.title': { zh: '我的', en: 'Me', ja: 'マイページ', ko: '내 정보', es: 'Mi cuenta' },
    'mine.sub': {
      zh: '账号信息与安全设置都在这里',
      en: 'Your account details and security settings, all in one place',
      ja: 'アカウント情報とセキュリティ設定をここにまとめています',
      ko: '계정 정보와 보안 설정을 이곳에서 관리합니다',
      es: 'Los datos de tu cuenta y su seguridad, todo en un mismo lugar'
    },
    'mine.infoTitle': { zh: '账号信息', en: 'Account details', ja: 'アカウント情報', ko: '계정 정보', es: 'Datos de la cuenta' },
    'mine.idLabel': { zh: '账号编号', en: 'Account ID', ja: 'アカウントID', ko: '계정 ID', es: 'ID de cuenta' },
    'mine.nameLabel': { zh: '名称', en: 'Name', ja: '名前', ko: '이름', es: 'Nombre' },
    'mine.official': { zh: '官方认证', en: 'Verified', ja: '公式認証', ko: '공식 인증', es: 'Cuenta verificada' },
    'mine.created': { zh: '注册时间', en: 'Joined', ja: '登録日', ko: '가입일', es: 'Fecha de alta' },

    /* ---------- 文章：列表页 ---------- */
    /* 文章：列表页（补充） */
    'art.clear': { zh: '清除筛选', en: 'Clear filters', ja: '絞り込み解除', ko: '필터 초기화', es: 'Limpiar filtros' },
    'art.empty': { zh: '还没有文章', en: 'No articles yet', ja: 'まだ記事がありません', ko: '아직 게시글이 없습니다', es: 'Todavía no hay artículos' },
    'art.emptyMatch': { zh: '没有匹配的文章', en: 'No matching articles', ja: '一致する記事がありません', ko: '일치하는 게시글이 없습니다', es: 'No hay artículos que coincidan' },
    'art.fileBadge': { zh: '附件 {n}', en: '{n} file', ja: '添付 {n}', ko: '첨부 {n}', es: '{n} adj.' },
    'art.imgBadge': { zh: '图 {n}', en: '{n} img', ja: '画像 {n}', ko: '이미지 {n}', es: '{n} img' },
    'art.loadFail': { zh: '加载失败，请稍后重试', en: 'Failed to load. Please try again later', ja: '読み込みに失敗しました。後でもう一度お試しください', ko: '불러오지 못했습니다. 잠시 후 다시 시도해 주세요', es: 'No se pudo cargar. Inténtalo de nuevo más tarde' },
    'art.next': { zh: '下一页', en: 'Next', ja: '次へ', ko: '다음', es: 'Siguiente' },
    'art.page': { zh: '第 {p} / {t} 页', en: 'Page {p} of {t}', ja: '{p} / {t} ページ', ko: '{p} / {t} 페이지', es: 'Página {p} de {t}' },
    'art.prev': { zh: '上一页', en: 'Previous', ja: '前へ', ko: '이전', es: 'Anterior' },
    'art.searchBtn': { zh: '搜索', en: 'Search', ja: '検索', ko: '검색', es: 'Buscar' },
    'art.searchPh': { zh: '搜索标题、正文或标签', en: 'Search title, body or tags', ja: 'タイトル・本文・タグを検索', ko: '제목, 본문, 태그 검색', es: 'Busca en el título, el texto o las etiquetas' },
    'art.sortHot': { zh: '最热', en: 'Most viewed', ja: '人気', ko: '인기', es: 'Más vistos' },
    'art.sortNew': { zh: '最新', en: 'Newest', ja: '新着', ko: '최신', es: 'Recientes' },
    'art.sub': { zh: '技术、生活与思考的记录', en: 'Notes on tech, life and ideas', ja: '技術・暮らし・思考の記録', ko: '기술, 일상, 생각의 기록', es: 'Notas sobre tecnología, vida e ideas' },
    'art.tagAll': { zh: '标签', en: 'Tags', ja: 'タグ', ko: '태그', es: 'Etiquetas' },
    'art.title': { zh: '文章', en: 'Articles', ja: '記事', ko: '게시글', es: 'Artículos' },
    'art.total': { zh: '共 {n} 篇', en: '{n} in total', ja: '全 {n} 件', ko: '총 {n}건', es: '{n} en total' },
    'art.views': { zh: '{n} 阅读', en: '{n} views', ja: '閲覧 {n}', ko: '조회 {n}', es: '{n} visitas' },
    'art.writeBtn': { zh: '写文章', en: 'Write', ja: '書く', ko: '글쓰기', es: 'Escribir' },
    /* 文章：详情页 */
    'artd.back': { zh: '返回文章区', en: 'Back to articles', ja: '記事一覧へ戻る', ko: '게시글 목록으로', es: 'Volver a los artículos' },
    'artd.download': { zh: '下载', en: 'Download', ja: 'ダウンロード', ko: '다운로드', es: 'Descargar' },
    'artd.edit': { zh: '编辑本文', en: 'Edit this article', ja: 'この記事を編集', ko: '이 글 수정', es: 'Editar este artículo' },
    'artd.files': { zh: '附件', en: 'Attachments', ja: '添付ファイル', ko: '첨부 파일', es: 'Adjuntos' },
    'artd.images': { zh: '图片', en: 'Images', ja: '画像', ko: '이미지', es: 'Imágenes' },
    'artd.links': { zh: '相关链接', en: 'Related links', ja: '関連リンク', ko: '관련 링크', es: 'Enlaces relacionados' },
    'artd.loadFail': { zh: '加载失败，请稍后重试', en: 'Failed to load. Please try again later', ja: '読み込みに失敗しました。後でもう一度お試しください', ko: '불러오지 못했습니다. 잠시 후 다시 시도해 주세요', es: 'No se pudo cargar. Inténtalo de nuevo más tarde' },
    'artd.notFound': { zh: '文章不存在或已删除', en: 'This article does not exist or has been deleted', ja: '記事が存在しないか削除されています', ko: '게시글이 없거나 삭제되었습니다', es: 'El artículo no existe o se ha eliminado' },
    'artd.notPublic': { zh: '该文章尚未公开，仅作者本人可查看', en: 'This article is not public yet; only the author can view it', ja: 'この記事はまだ公開されていません。執筆者のみ閲覧できます', ko: '아직 공개되지 않은 글로 작성자만 볼 수 있습니다', es: 'Este artículo aún no es público; solo el autor puede verlo' },
    'artd.pending': { zh: '待审核', en: 'Pending review', ja: '審査中', ko: '검토 대기', es: 'Pendiente de revisión' },
    'artd.reason': { zh: '理由：{r}', en: 'Reason: {r}', ja: '理由：{r}', ko: '사유: {r}', es: 'Motivo: {r}' },
    'artd.rejected': { zh: '已驳回', en: 'Rejected', ja: '却下されました', ko: '반려됨', es: 'Rechazado' },
    'artd.updated': { zh: '编辑于 {t}', en: 'Edited {t}', ja: '編集日 {t}', ko: '수정 {t}', es: 'Editado {t}' },
    'artd.views': { zh: '{n} 次阅读', en: '{n} views', ja: '{n} 回閲覧', ko: '{n}회 조회', es: '{n} visitas' },
    /* 文章：写作页 */
    'wr.addLink': { zh: '+ 添加链接', en: '+ Add link', ja: '+ リンクを追加', ko: '+ 링크 추가', es: '+ Añadir enlace' },
    'wr.addTag': { zh: '添加', en: 'Add', ja: '追加', ko: '추가', es: 'Añadir' },
    'wr.bodyLabel': { zh: '正文', en: 'Body', ja: '本文', ko: '본문', es: 'Texto' },
    'wr.bodyPh': { zh: '10-20000 字，支持换行与链接', en: '10-20000 characters; line breaks and links supported', ja: '10〜20000 文字。改行とリンクに対応', ko: '10~20000자, 줄바꿈과 링크 지원', es: 'De 10 a 20000 caracteres; admite saltos de línea y enlaces' },
    'wr.cancel': { zh: '取消', en: 'Cancel', ja: 'キャンセル', ko: '취소', es: 'Cancelar' },
    'wr.chooseFiles': { zh: '+ 选择附件', en: '+ Choose files', ja: '+ ファイルを選択', ko: '+ 파일 선택', es: '+ Elegir archivos' },
    'wr.chooseImages': { zh: '+ 选择图片', en: '+ Choose images', ja: '+ 画像を選択', ko: '+ 이미지 선택', es: '+ Elegir imágenes' },
    'wr.compressing': { zh: '压缩图片中…', en: 'Compressing images…', ja: '画像を圧縮中…', ko: '이미지 압축 중…', es: 'Comprimiendo imágenes…' },
    'wr.edit': { zh: '编辑', en: 'Edit', ja: '編集', ko: '수정', es: 'Editar' },
    'wr.editTitle': { zh: '编辑文章', en: 'Edit article', ja: '記事を編集', ko: '글 수정', es: 'Editar artículo' },
    'wr.errAsset': { zh: '附件上传失败', en: 'File upload failed', ja: 'ファイルのアップロードに失敗しました', ko: '파일 업로드에 실패했습니다', es: 'Error al subir el archivo' },
    'wr.errBody': { zh: '正文需为 10-20000 字', en: 'The body must be 10-20000 characters', ja: '本文は 10〜20000 文字にしてください', ko: '본문은 10~20000자여야 합니다', es: 'El texto debe tener entre 10 y 20000 caracteres' },
    'wr.errFileBig': { zh: '单个附件不能超过 2MB', en: 'Each file must be 2MB or smaller', ja: '1 件あたり 2MB までです', ko: '개당 2MB를 넘을 수 없습니다', es: 'Cada archivo debe ser de 2MB o menos' },
    'wr.errFileMax': { zh: '附件最多 3 个', en: 'Up to 3 files', ja: '添付は最大 3 件です', ko: '첨부는 최대 3개입니다', es: 'Máximo 3 adjuntos' },
    'wr.errFileRead': { zh: '附件读取失败，请重试', en: 'Could not read the file, please try again', ja: 'ファイルを読み込めませんでした。もう一度お試しください', ko: '파일을 읽지 못했습니다. 다시 시도해 주세요', es: 'No se pudo leer el archivo; inténtalo de nuevo' },
    'wr.errFileTotal': { zh: '附件合计超过 3MB', en: 'Files exceed 3MB in total', ja: '添付の合計が 3MB を超えています', ko: '첨부 합계가 3MB를 넘습니다', es: 'Los adjuntos superan 3MB en total' },
    'wr.errImgBig': { zh: '图片压缩后仍超过 300KB，请换一张', en: 'The image is still over 300KB after compression; please choose another', ja: '圧縮後も 300KB を超えています。別の画像を選んでください', ko: '압축 후에도 300KB를 넘습니다. 다른 이미지를 선택해 주세요', es: 'La imagen sigue superando 300KB tras comprimirla; elige otra' },
    'wr.errImgMax': { zh: '图片最多 6 张', en: 'Up to 6 images', ja: '画像は最大 6 枚です', ko: '이미지는 최대 6장입니다', es: 'Máximo 6 imágenes' },
    'wr.errImgRead': { zh: '图片读取失败，请重试', en: 'Could not read the image, please try again', ja: '画像を読み込めませんでした。もう一度お試しください', ko: '이미지를 읽지 못했습니다. 다시 시도해 주세요', es: 'No se pudo leer la imagen; inténtalo de nuevo' },
    'wr.errImgTotal': { zh: '图片合计超过 1.2MB', en: 'Images exceed 1.2MB in total', ja: '画像の合計が 1.2MB を超えています', ko: '이미지 합계가 1.2MB를 넘습니다', es: 'Las imágenes superan 1.2MB en total' },
    'wr.errLinkBad': { zh: '链接需以 http:// 或 https:// 开头', en: 'Links must start with http:// or https://', ja: 'リンクは http:// または https:// で始まる必要があります', ko: '링크는 http:// 또는 https://로 시작해야 합니다', es: 'Los enlaces deben empezar por http:// o https://' },
    'wr.errLinkMax': { zh: '链接最多 10 条', en: 'Up to 10 links', ja: 'リンクは最大 10 件です', ko: '링크는 최대 10개입니다', es: 'Máximo 10 enlaces' },
    'wr.errNet': { zh: '网络异常，请稍后重试', en: 'Network error, please try again later', ja: '通信エラーです。後でもう一度お試しください', ko: '네트워크 오류입니다. 잠시 후 다시 시도해 주세요', es: 'Error de red; inténtalo de nuevo más tarde' },
    'wr.errTagLen': { zh: '单个标签不超过 20 字', en: 'Each tag must be at most 20 characters', ja: 'タグは 1 つ 20 文字までです', ko: '태그는 개당 20자 이하여야 합니다', es: 'Cada etiqueta debe tener como máximo 20 caracteres' },
    'wr.errTagMax': { zh: '标签最多 5 个', en: 'Up to 5 tags', ja: 'タグは最大 5 個です', ko: '태그는 최대 5개입니다', es: 'Máximo 5 etiquetas' },
    'wr.errTitle': { zh: '标题需为 10-120 字', en: 'The title must be 10-120 characters', ja: 'タイトルは 10〜120 文字にしてください', ko: '제목은 10~120자여야 합니다', es: 'El título debe tener entre 10 y 120 caracteres' },
    'wr.filesHint': { zh: '最多 3 个，单个不超过 2MB', en: 'Up to 3, max 2MB each', ja: '最大 3 件、1 件 2MB まで', ko: '최대 3개, 개당 2MB 이하', es: 'Hasta 3, máximo 2MB cada uno' },
    'wr.filesLabel': { zh: '附件', en: 'Attachments', ja: '添付ファイル', ko: '첨부 파일', es: 'Adjuntos' },
    'wr.imagesHint': { zh: '最多 6 张，自动压缩到 300KB 内', en: 'Up to 6, auto-compressed to under 300KB', ja: '最大 6 枚、300KB 以内に自動圧縮', ko: '최대 6장, 300KB 이내로 자동 압축', es: 'Hasta 6, comprimidas automáticamente a menos de 300KB' },
    'wr.imagesLabel': { zh: '图片', en: 'Images', ja: '画像', ko: '이미지', es: 'Imágenes' },
    'wr.linksHint': { zh: '最多 10 条，需以 http(s):// 开头', en: 'Up to 10, must start with http(s)://', ja: '最大 10 件、http(s):// で始まる必要があります', ko: '최대 10개, http(s)://로 시작해야 합니다', es: 'Hasta 10, deben empezar por http(s)://' },
    'wr.linksLabel': { zh: '相关链接', en: 'Related links', ja: '関連リンク', ko: '관련 링크', es: 'Enlaces relacionados' },
    'wr.loadFail': { zh: '加载失败，请稍后重试', en: 'Failed to load. Please try again later', ja: '読み込みに失敗しました。後でもう一度お試しください', ko: '불러오지 못했습니다. 잠시 후 다시 시도해 주세요', es: 'No se pudo cargar. Inténtalo de nuevo más tarde' },
    'wr.loginRequired': { zh: '请先登录后再投稿', en: 'Please sign in before submitting', ja: '投稿する前にログインしてください', ko: '글을 쓰려면 먼저 로그인해 주세요', es: 'Inicia sesión antes de enviar' },
    'wr.myEmpty': { zh: '还没有投稿', en: 'No submissions yet', ja: 'まだ投稿がありません', ko: '아직 작성한 글이 없습니다', es: 'Todavía no has enviado nada' },
    'wr.myTitle': { zh: '我的投稿', en: 'My submissions', ja: '自分の投稿', ko: '내 게시글', es: 'Mis envíos' },
    'wr.notOwner': { zh: '只能编辑自己的文章', en: 'You can only edit your own articles', ja: '自分の記事だけ編集できます', ko: '자신의 글만 수정할 수 있습니다', es: 'Solo puedes editar tus propios artículos' },
    'wr.remove': { zh: '删除', en: 'Delete', ja: '削除', ko: '삭제', es: 'Eliminar' },
    'wr.statusApproved': { zh: '已通过', en: 'Approved', ja: '承認済み', ko: '승인됨', es: 'Aprobado' },
    'wr.statusPending': { zh: '待审核', en: 'Pending review', ja: '審査中', ko: '검토 대기', es: 'Pendiente de revisión' },
    'wr.statusRejected': { zh: '已驳回', en: 'Rejected', ja: '却下', ko: '반려됨', es: 'Rechazado' },
    'wr.sub': { zh: '提交后由管理员审核，通过后公开展示', en: 'Submissions are reviewed by an admin and published once approved', ja: '投稿は管理者が審査し、承認後に公開されます', ko: '관리자 검토 후 승인되면 공개됩니다', es: 'El administrador revisa los envíos y se publican al aprobarlos' },
    'wr.submit': { zh: '提交审核', en: 'Submit for review', ja: '審査に提出', ko: '검토 요청', es: 'Enviar a revisión' },
    'wr.submitted': { zh: '已提交，等待审核', en: 'Submitted. Waiting for review', ja: '送信しました。審査をお待ちください', ko: '제출했습니다. 검토를 기다려 주세요', es: 'Enviado. Esperando revisión' },
    'wr.submitting': { zh: '提交中…', en: 'Submitting…', ja: '送信中…', ko: '제출 중…', es: 'Enviando…' },
    'wr.tagPh': { zh: '输入后按回车', en: 'Type and press Enter', ja: '入力して Enter', ko: '입력 후 Enter', es: 'Escribe y pulsa Enter' },
    'wr.tagsHint': { zh: '回车添加，最多 5 个', en: 'Press Enter to add, up to 5', ja: 'Enter で追加、最大 5 個', ko: 'Enter로 추가, 최대 5개', es: 'Pulsa Enter para añadir, hasta 5' },
    'wr.tagsLabel': { zh: '标签', en: 'Tags', ja: 'タグ', ko: '태그', es: 'Etiquetas' },
    'wr.title': { zh: '写文章', en: 'Write an article', ja: '記事を書く', ko: '글쓰기', es: 'Escribir un artículo' },
    'wr.titleLabel': { zh: '标题', en: 'Title', ja: 'タイトル', ko: '제목', es: 'Título' },
    'wr.titlePh': { zh: '10-120 字', en: '10-120 characters', ja: '10〜120 文字', ko: '10~120자', es: 'De 10 a 120 caracteres' },
    'wr.uploading': { zh: '上传中…', en: 'Uploading…', ja: 'アップロード中…', ko: '업로드 중…', es: 'Subiendo…' },
    'wr.view': { zh: '查看', en: 'View', ja: '閲覧', ko: '보기', es: 'Ver' },
    'wr.waitUpload': { zh: '文件还在上传，请稍候', en: 'Files are still uploading, please wait', ja: 'ファイルをアップロード中です。お待ちください', ko: '파일 업로드 중입니다. 잠시만 기다려 주세요', es: 'Los archivos aún se están subiendo, espera por favor' },
    /* 文章：后台审核 */
    'ad.artAll': { zh: '全部文章', en: 'All articles', ja: 'すべての記事', ko: '전체 글', es: 'Todos los artículos' },
    'ad.artAllCount': { zh: '共 {n} 篇', en: '{n} in total', ja: '全 {n} 件', ko: '총 {n}건', es: '{n} en total' },
    'ad.artApprove': { zh: '通过', en: 'Approve', ja: '承認', ko: '승인', es: 'Aprobar' },
    'ad.artApproveOk': { zh: '已通过，文章已公开', en: 'Approved. The article is now public', ja: '承認しました。記事を公開しました', ko: '승인했습니다. 글이 공개되었습니다', es: 'Aprobado. El artículo ya es público' },
    'ad.artAttMeta': { zh: '图 {img} · 附件 {file}', en: '{img} images · {file} files', ja: '画像 {img} · 添付 {file}', ko: '이미지 {img} · 첨부 {file}', es: '{img} imágenes · {file} adjuntos' },
    'ad.artDelConfirm1': { zh: '确定删除这篇文章？', en: 'Delete this article?', ja: 'この記事を削除しますか？', ko: '이 글을 삭제할까요?', es: '¿Eliminar este artículo?' },
    'ad.artDelConfirm2': { zh: '将同时删除该文章的全部图片与附件，且无法恢复。再次确认删除？', en: 'All images and attachments of this article will be deleted too, and this cannot be undone. Delete anyway?', ja: 'この記事の画像と添付ファイルもすべて削除され、元に戻せません。本当に削除しますか？', ko: '이 글의 이미지와 첨부 파일도 모두 삭제되며 되돌릴 수 없습니다. 정말 삭제할까요?', es: 'También se eliminarán todas las imágenes y adjuntos, sin posibilidad de recuperarlos. ¿Eliminar de todos modos?' },
    'ad.artDeleted': { zh: '已删除文章及其附件', en: 'Article and its attachments deleted', ja: '記事と添付ファイルを削除しました', ko: '글과 첨부 파일을 삭제했습니다', es: 'Artículo y adjuntos eliminados' },
    'ad.artEmptyAll': { zh: '没有符合条件的文章', en: 'No articles match', ja: '条件に合う記事がありません', ko: '조건에 맞는 글이 없습니다', es: 'Ningún artículo coincide' },
    'ad.artEmptyPending': { zh: '暂无待审文章', en: 'No pending articles', ja: '審査待ちの記事はありません', ko: '대기 중인 글이 없습니다', es: 'No hay artículos pendientes' },
    'ad.artExpand': { zh: '展开预览', en: 'Preview', ja: 'プレビュー', ko: '미리보기', es: 'Vista previa' },
    'ad.artNext': { zh: '下一页', en: 'Next', ja: '次へ', ko: '다음', es: 'Siguiente' },
    'ad.artPageInfo': { zh: '第 {page} / {total} 页', en: 'Page {page} of {total}', ja: '{page} / {total} ページ', ko: '{page} / {total} 페이지', es: 'Página {page} de {total}' },
    'ad.artPendCount': { zh: '待审 {n} 篇', en: '{n} pending', ja: '審査待ち {n} 件', ko: '대기 {n}건', es: '{n} pendientes' },
    'ad.artPending': { zh: '待审文章', en: 'Pending articles', ja: '審査待ちの記事', ko: '심사 대기 글', es: 'Artículos pendientes' },
    'ad.artPrev': { zh: '上一页', en: 'Previous', ja: '前へ', ko: '이전', es: 'Anterior' },
    'ad.artReasonPrefix': { zh: '驳回理由：', en: 'Rejection reason: ', ja: '却下理由：', ko: '반려 사유: ', es: 'Motivo del rechazo: ' },
    'ad.artRefresh': { zh: '刷新', en: 'Refresh', ja: '更新', ko: '새로고침', es: 'Actualizar' },
    'ad.artReject': { zh: '驳回', en: 'Reject', ja: '却下', ko: '반려', es: 'Rechazar' },
    'ad.artRejectEmpty': { zh: '驳回理由不能为空', en: 'The rejection reason cannot be empty', ja: '却下理由は必須です', ko: '반려 사유는 비울 수 없습니다', es: 'El motivo del rechazo no puede estar vacío' },
    'ad.artRejectOk': { zh: '已驳回', en: 'Rejected', ja: '却下しました', ko: '반려했습니다', es: 'Rechazado' },
    'ad.artRejectPrompt': { zh: '请填写驳回理由（会展示给作者）', en: 'Enter the rejection reason (shown to the author)', ja: '却下理由を入力してください（執筆者に表示されます）', ko: '반려 사유를 입력해 주세요(작성자에게 표시됩니다)', es: 'Escribe el motivo del rechazo (lo verá el autor)' },
    'ad.artRevoke': { zh: '撤销审核', en: 'Undo review', ja: '審査を取り消す', ko: '심사 취소', es: 'Anular revisión' },
    'ad.artRevokeConfirm': { zh: '撤销后文章会退回待审状态，作者需重新等待审核。确认撤销？', en: 'Undoing the review returns the article to pending, so it needs reviewing again. Undo?', ja: '取り消すと記事は審査待ちに戻り、再審査が必要になります。取り消しますか？', ko: '취소하면 글이 다시 검토 대기로 돌아가 재심사가 필요합니다. 취소할까요?', es: 'Al anular la revisión el artículo vuelve a estar pendiente y deberá revisarse de nuevo. ¿Anular?' },
    'ad.artRevokeOk': { zh: '已撤销，文章退回待审', en: 'Review undone; the article is pending again', ja: '取り消しました。記事は審査待ちに戻りました', ko: '취소했습니다. 글이 다시 검토 대기로 돌아갔습니다', es: 'Revisión anulada; el artículo vuelve a estar pendiente' },
    'ad.artSearchBtn': { zh: '搜索', en: 'Search', ja: '検索', ko: '검색', es: 'Buscar' },
    'ad.artSearchPh': { zh: '搜索标题或作者', en: 'Search title or author', ja: 'タイトル・執筆者で検索', ko: '제목 또는 작성자 검색', es: 'Buscar por título o autor' },
    'ad.artStApproved': { zh: '已通过', en: 'Approved', ja: '承認済み', ko: '승인됨', es: 'Aprobado' },
    'ad.artStPending': { zh: '待审核', en: 'Pending review', ja: '審査中', ko: '검토 대기', es: 'Pendiente' },
    'ad.artStRejected': { zh: '已驳回', en: 'Rejected', ja: '却下', ko: '반려됨', es: 'Rechazado' },
    'ad.artStatusAll': { zh: '全部状态', en: 'All statuses', ja: 'すべての状態', ko: '전체 상태', es: 'Todos los estados' },
    'ad.artTip': { zh: '列表 30 秒内缓存，重复展开不会反复读取', en: 'Lists are cached for 30 seconds to save KV reads', ja: '一覧は 30 秒間キャッシュされ、再表示でも読み取りは発生しません', ko: '목록은 30초 동안 캐시되어 다시 열어도 KV 읽기가 발생하지 않습니다', es: 'Las listas se guardan en caché 30 segundos para ahorrar lecturas de KV' },
    'ad.artTitle': { zh: '文章审核', en: 'Article review', ja: '記事の審査', ko: '게시글 심사', es: 'Revisión de artículos' },
    'ad.artView': { zh: '查看', en: 'View', ja: '閲覧', ko: '보기', es: 'Ver' },
    /* 文章：导航 */
    'nav.articles': { zh: '文章', en: 'Articles', ja: '記事', ko: '게시글', es: 'Artículos' },
    /* 文章：页面标题 */
    'title.article': { zh: '文章详情 - Cealin', en: 'Article - Cealin', ja: '記事の詳細 - Cealin', ko: '게시글 상세 - Cealin', es: 'Detalle del artículo - Cealin' },
    'title.articles': { zh: '文章 - Cealin', en: 'Articles - Cealin', ja: '記事 - Cealin', ko: '게시글 - Cealin', es: 'Artículos - Cealin' },
    'title.write': { zh: '写文章 - Cealin', en: 'Write an article - Cealin', ja: '記事を書く - Cealin', ko: '글쓰기 - Cealin', es: 'Escribir un artículo - Cealin' },

    /* ---------- 好友 / 私聊 ---------- */
    'nav.friends': { zh: '好友', en: 'Friends', ja: 'フレンド', ko: '친구', es: 'Amigos' },
    'title.friends': { zh: '好友 - Cealin', en: 'Friends - Cealin', ja: 'フレンド - Cealin', ko: '친구 - Cealin', es: 'Amigos - Cealin' },
    'title.dm': { zh: '私聊 - Cealin', en: 'Private chat - Cealin', ja: '個別チャット - Cealin', ko: '1:1 채팅 - Cealin', es: 'Chat privado - Cealin' },

    'fr.title': { zh: '好友', en: 'Friends', ja: 'フレンド', ko: '친구', es: 'Amigos' },
    'fr.sub': { zh: '用编号找到彼此，对方同意后即可私聊', en: 'Find each other by account ID—once accepted, chat privately', ja: '番号でお互いを見つけ、承認されると個別チャットができます', ko: '번호로 서로를 찾고, 상대가 수락하면 1:1 채팅을 할 수 있습니다', es: 'Encuéntrense por número de cuenta y, al aceptar, podrán chatear en privado' },
    'fr.searchTitle': { zh: '添加好友', en: 'Add a friend', ja: 'フレンドを追加', ko: '친구 추가', es: 'Añadir amigo' },
    'fr.searchLabel': { zh: '对方账号编号', en: 'Their account ID', ja: '相手のアカウント番号', ko: '상대 계정 번호', es: 'Número de cuenta de la otra persona' },
    'fr.searchPh': { zh: '输入完整编号，如 ABCD2345', en: 'Enter the full ID, e.g. ABCD2345', ja: '完全な番号を入力（例：ABCD2345）', ko: '전체 번호를 입력하세요 (예: ABCD2345)', es: 'Introduce el número completo, p. ej. ABCD2345' },
    'fr.searchBtn': { zh: '搜索', en: 'Search', ja: '検索', ko: '검색', es: 'Buscar' },
    'fr.official': { zh: '官方', en: 'Official', ja: '公式', ko: '공식', es: 'Oficial' },
    'fr.self': { zh: '这是你自己的编号', en: 'That is your own ID', ja: 'これはあなた自身の番号です', ko: '본인 계정 번호입니다', es: 'Ese es tu propio número' },
    'fr.friend': { zh: '已是好友', en: 'Already friends', ja: 'すでにフレンドです', ko: '이미 친구입니다', es: 'Ya son amigos' },
    'fr.outgoing': { zh: '已发送申请，等待对方同意', en: 'Request sent—waiting for approval', ja: '申請済み：相手の承認待ちです', ko: '신청을 보냈습니다. 상대의 수락을 기다리는 중입니다', es: 'Solicitud enviada: esperando respuesta' },
    'fr.incoming': { zh: '对方已向你申请，请在下方处理', en: 'They already asked you—handle it below', ja: '相手から申請が届いています。下で処理してください', ko: '상대가 먼저 신청했습니다. 아래에서 처리하세요', es: 'Esa persona ya te envió una solicitud: gestiónala abajo' },
    'fr.verifyLabel': { zh: '验证语（可选）', en: 'Message (optional)', ja: '認証メッセージ（任意）', ko: '인증 메시지(선택)', es: 'Mensaje de verificación (opcional)' },
    'fr.verifyPh': { zh: '一句话说明你是谁，60 字以内', en: 'Say who you are in one line (max 60)', ja: '一言で自己紹介（60 文字以内）', ko: '한 줄로 소개해 주세요 (60자 이내)', es: 'Di quién eres en una línea (máx. 60)' },
    'fr.sendReq': { zh: '发送申请', en: 'Send request', ja: '申請を送信', ko: '신청 보내기', es: 'Enviar solicitud' },
    'fr.reqSent': { zh: '好友申请已发送，等待对方同意', en: 'Friend request sent—waiting for approval', ja: '申請を送信しました。承認をお待ちください', ko: '친구 신청을 보냈습니다. 수락을 기다려 주세요', es: 'Solicitud enviada: esperando aprobación' },
    'fr.reqTitle': { zh: '待处理申请', en: 'Pending requests', ja: '未処理の申請', ko: '처리할 신청', es: 'Solicitudes pendientes' },
    'fr.noReq': { zh: '暂无待处理申请', en: 'No pending requests', ja: '未処理の申請はありません', ko: '처리할 신청이 없습니다', es: 'No hay solicitudes pendientes' },
    'fr.pending': { zh: '条待处理', en: 'pending', ja: '件', ko: '건', es: 'pendientes' },
    'fr.accept': { zh: '同意', en: 'Accept', ja: '承認', ko: '수락', es: 'Aceptar' },
    'fr.reject': { zh: '拒绝', en: 'Decline', ja: '拒否', ko: '거절', es: 'Rechazar' },
    'fr.listTitle': { zh: '好友列表', en: 'Friend list', ja: 'フレンド一覧', ko: '친구 목록', es: 'Lista de amigos' },
    'fr.empty': { zh: '还没有好友，用编号搜索添加吧', en: 'No friends yet—search an ID to add one', ja: 'まだフレンドがいません。番号で検索して追加しましょう', ko: '아직 친구가 없습니다. 번호로 검색해 추가하세요', es: 'Aún no tienes amigos: busca un número para añadir' },
    'fr.loading': { zh: '加载中…', en: 'Loading…', ja: '読み込み中…', ko: '불러오는 중…', es: 'Cargando…' },
    'fr.delete': { zh: '删除', en: 'Remove', ja: '削除', ko: '삭제', es: 'Eliminar' },
    'fr.delConfirm': { zh: '确定删除好友 {name}？删除后双方都不再是好友。', en: 'Remove {name} from your friends? You will no longer be friends.', ja: 'フレンド {name} を削除しますか？双方ともフレンドではなくなります。', ko: '친구 {name} 님을 삭제할까요? 삭제하면 양쪽 모두 친구가 아니게 됩니다.', es: '¿Eliminar a {name}? Dejarán de ser amigos en ambos lados.' },
    'fr.delOk': { zh: '已删除好友', en: 'Friend removed', ja: 'フレンドを削除しました', ko: '친구를 삭제했습니다', es: 'Amigo eliminado' },
    'fr.accepted': { zh: '已添加为好友', en: 'Added as friend', ja: 'フレンドに追加しました', ko: '친구로 추가했습니다', es: 'Añadido como amigo' },
    'fr.rejected': { zh: '已拒绝该申请', en: 'Request declined', ja: '申請を拒否しました', ko: '신청을 거절했습니다', es: 'Solicitud rechazada' },
    'fr.online': { zh: '在线', en: 'Online', ja: 'オンライン', ko: '온라인', es: 'En línea' },
    'fr.offline': { zh: '离线', en: 'Offline', ja: 'オフライン', ko: '오프라인', es: 'Desconectado' },
    'fr.goChat': { zh: '去聊天', en: 'Chat', ja: 'チャットする', ko: '채팅하기', es: 'Chatear' },
    'fr.image': { zh: '图片', en: 'Image', ja: '画像', ko: '이미지', es: 'Imagen' },
    'fr.mine': { zh: '我：', en: 'You:', ja: '自分：', ko: '나:', es: 'Tú:' },
    'fr.notifyOn': { zh: '开启新消息通知', en: 'Enable notifications', ja: '新着通知をオンにする', ko: '새 메시지 알림 켜기', es: 'Activar notificaciones' },
    'fr.notifyGranted': { zh: '通知已开启', en: 'Notifications on', ja: '通知はオンです', ko: '알림이 켜졌습니다', es: 'Notificaciones activadas' },
    'fr.notifyDenied': { zh: '通知已被拒绝，请在浏览器设置中允许', en: 'Notifications blocked—allow them in browser settings', ja: '通知がブロックされています。ブラウザ設定で許可してください', ko: '알림이 차단되었습니다. 브라우저 설정에서 허용해 주세요', es: 'Notificaciones bloqueadas: permítelas en el navegador' },
    'fr.notifyUnsupported': { zh: '当前浏览器不支持通知', en: 'This browser does not support notifications', ja: 'このブラウザは通知に対応していません', ko: '이 브라우저는 알림을 지원하지 않습니다', es: 'Este navegador no admite notificaciones' },

    'fr.err.noid': { zh: '请输入 6~8 位账号编号', en: 'Enter a 6–8 character account ID', ja: '6〜8 文字の番号を入力してください', ko: '6~8자리 계정 번호를 입력하세요', es: 'Introduce un número de cuenta de 6–8 caracteres' },
    'fr.err.notfound': { zh: '未找到该编号对应的账号', en: 'No account with that ID', ja: 'その番号のアカウントが見つかりません', ko: '해당 번호의 계정을 찾을 수 없습니다', es: 'No existe ninguna cuenta con ese número' },
    'fr.err.self': { zh: '不能添加自己为好友', en: 'You cannot add yourself', ja: '自分自身は追加できません', ko: '본인은 친구로 추가할 수 없습니다', es: 'No puedes añadirte a ti mismo' },
    'fr.err.already': { zh: '你们已经是好友了', en: 'You are already friends', ja: 'すでにフレンドです', ko: '이미 친구입니다', es: 'Ya son amigos' },
    'fr.err.repeat': { zh: '已发送过申请，请等待对方同意', en: 'You already sent a request—wait for approval', ja: 'すでに申請済みです。承認をお待ちください', ko: '이미 신청했습니다. 수락을 기다려 주세요', es: 'Ya enviaste una solicitud: espera la respuesta' },
    'fr.err.incoming': { zh: '对方已向你申请，请直接同意', en: 'They already asked you—accept that request instead', ja: '相手から申請が届いています。そちらを承認してください', ko: '상대가 먼저 신청했습니다. 그 신청을 수락하세요', es: 'Esa persona ya te envió una solicitud: acéptala' },
    'fr.err.limit': { zh: '好友数量已达上限', en: 'Friend limit reached', ja: 'フレンド数の上限に達しました', ko: '친구 수 한도에 도달했습니다', es: 'Límite de amigos alcanzado' },
    'fr.err.notfriend': { zh: '你们还不是好友', en: 'You are not friends', ja: 'まだフレンドではありません', ko: '아직 친구가 아닙니다', es: 'No son amigos' },
    'fr.err.noreq': { zh: '该申请已不存在', en: 'That request no longer exists', ja: 'その申請は存在しません', ko: '해당 신청이 없습니다', es: 'Esa solicitud ya no existe' },
    'fr.err.nologin': { zh: '请先登录账号', en: 'Please sign in first', ja: '先にログインしてください', ko: '먼저 로그인하세요', es: 'Inicia sesión primero' },
    'fr.err.server': { zh: '服务暂时不可用，请稍后重试', en: 'Service unavailable—try again later', ja: '一時的に利用できません。後でお試しください', ko: '일시적으로 사용할 수 없습니다. 잠시 후 다시 시도하세요', es: 'Servicio no disponible: inténtalo más tarde' },
    'fr.err.network': { zh: '网络异常，请检查连接', en: 'Network error—check your connection', ja: '通信エラー：接続を確認してください', ko: '네트워크 오류: 연결을 확인하세요', es: 'Error de red: revisa la conexión' },
    'fr.err.forbidden': { zh: '无权访问', en: 'No permission', ja: '権限がありません', ko: '권한이 없습니다', es: 'Sin permiso' },

    'dm.back': { zh: '返回好友列表', en: 'Back to friends', ja: 'フレンド一覧に戻る', ko: '친구 목록으로', es: 'Volver a amigos' },
    'dm.me': { zh: '我', en: 'Me', ja: '自分', ko: '나', es: 'Yo' },
    'dm.ph': { zh: '输入消息…', en: 'Type a message…', ja: 'メッセージを入力…', ko: '메시지를 입력하세요…', es: 'Escribe un mensaje…' },
    'dm.send': { zh: '发送', en: 'Send', ja: '送信', ko: '보내기', es: 'Enviar' },
    'dm.img': { zh: '发送图片', en: 'Send an image', ja: '画像を送信', ko: '이미지 보내기', es: 'Enviar imagen' },
    'dm.imgLoading': { zh: '图片加载中…', en: 'Loading image…', ja: '画像を読み込み中…', ko: '이미지 불러오는 중…', es: 'Cargando imagen…' },
    'dm.empty': { zh: '还没有消息，打个招呼吧', en: 'No messages yet—say hi', ja: 'まだメッセージはありません。挨拶してみましょう', ko: '아직 메시지가 없습니다. 인사를 건네 보세요', es: 'Aún no hay mensajes: saluda' },
    'dm.compress': { zh: '图片压缩中…', en: 'Compressing image…', ja: '画像を圧縮中…', ko: '이미지 압축 중…', es: 'Comprimiendo imagen…' },
    'dm.imgBig': { zh: '图片过大，压缩后仍超过 300KB，请换一张', en: 'Image still over 300KB after compression—try another', ja: '圧縮後も 300KB を超えています。別の画像をお試しください', ko: '압축 후에도 300KB를 초과합니다. 다른 이미지를 사용하세요', es: 'Sigue superando 300KB tras comprimir: prueba otra' },
    'dm.imgFail': { zh: '图片读取失败，请重试', en: 'Could not read the image—try again', ja: '画像を読み込めませんでした。再試行してください', ko: '이미지를 읽지 못했습니다. 다시 시도하세요', es: 'No se pudo leer la imagen: reinténtalo' },
    'dm.sendFail': { zh: '发送失败，请重试', en: 'Send failed—try again', ja: '送信に失敗しました。再試行してください', ko: '전송 실패: 다시 시도하세요', es: 'Error al enviar: reinténtalo' },
    'dm.needText': { zh: '消息不能为空', en: 'Message cannot be empty', ja: 'メッセージが空です', ko: '메시지가 비어 있습니다', es: 'El mensaje no puede estar vacío' },
    'dm.badPeer': { zh: '会话对象无效，请从好友列表进入', en: 'Invalid conversation—open it from your friend list', ja: '会話相手が無効です。フレンド一覧から開いてください', ko: '대화 상대가 올바르지 않습니다. 친구 목록에서 열어 주세요', es: 'Conversación no válida: ábrela desde tu lista de amigos' },
    'dm.err.imgsize': { zh: '图片不能超过 300KB', en: 'Images must be 300KB or less', ja: '画像は 300KB 以下にしてください', ko: '이미지는 300KB 이하여야 합니다', es: 'Las imágenes deben pesar 300KB o menos' },
    'dm.err.empty': { zh: '消息内容不能为空', en: 'Message cannot be empty', ja: 'メッセージが空です', ko: '메시지가 비어 있습니다', es: 'El mensaje no puede estar vacío' },
    'dm.err.imggone': { zh: '图片已过期，无法查看', en: 'This image has expired', ja: '画像の有効期限が切れています', ko: '이미지가 만료되었습니다', es: 'Esta imagen ha caducado' },
    'dm.err.self': { zh: '不能给自己发消息', en: 'You cannot message yourself', ja: '自分には送信できません', ko: '본인에게는 보낼 수 없습니다', es: 'No puedes enviarte mensajes' },
    'dm.err.server': { zh: '私聊服务异常，请稍后重试', en: 'Chat service error, please try again later', ja: 'チャットサービスのエラーです。後でもう一度お試しください', ko: '채팅 서비스 오류입니다. 잠시 후 다시 시도해 주세요', es: 'Error del servicio de chat, inténtalo más tarde' },

    /* 聊天室通知开关 */
    'chat.notifyBtn': { zh: '开启消息通知', en: 'Enable notifications', ja: 'メッセージ通知をオンにする', ko: '메시지 알림 켜기', es: 'Activar notificaciones' },
    'chat.notifyOn': { zh: '通知已开启', en: 'Notifications on', ja: '通知はオンです', ko: '알림이 켜졌습니다', es: 'Notificaciones activadas' },

    /* ---------- 下载页（download.html） ---------- */
    'dl.title': { zh: '下载', en: 'Download', ja: 'ダウンロード', ko: '다운로드', es: 'Descargas' },
    'dl.sub': { zh: '选择适合你的平台与用途', en: 'Pick the build that fits your platform', ja: 'プラットフォームと用途に合わせて選んでください', ko: '플랫폼과 용도에 맞게 선택하세요', es: 'Elige la versión según tu plataforma' },
    'dl.tagClient': { zh: '客户端', en: 'Client', ja: 'クライアント', ko: '클라이언트', es: 'Cliente' },
    'dl.devOnly': { zh: '仅供开发者使用', en: 'For developers only', ja: '開発者専用', ko: '개발자 전용', es: 'Solo para desarrolladores' },
    'dl.version': { zh: '版本', en: 'Version', ja: 'バージョン', ko: '버전', es: 'Versión' },
    'dl.btn': { zh: '前往下载', en: 'Download', ja: 'ダウンロードへ', ko: '다운로드하기', es: 'Ir a descargar' },
    'dl.direct': { zh: '站内直链下载 APK', en: 'Direct APK download', ja: '直リンクで APK をダウンロード', ko: '사이트 직링크로 APK 다운로드', es: 'Descargar APK directo' },
    'dl.directHint': { zh: '云盘页面加载较慢时，可用上面的站内直链直接下载。', en: 'If the cloud page loads slowly, use the direct link above.', ja: 'クラウドページの読み込みが遅い場合は、上の直リンクをご利用ください。', ko: '클라우드 페이지가 느리면 위의 직링크를 사용하세요.', es: 'Si la página de la nube va lenta, usa el enlace directo de arriba.' },
    'dl.winClient': { zh: 'Windows 客户端', en: 'Windows client', ja: 'Windows クライアント', ko: 'Windows 클라이언트', es: 'Cliente para Windows' },
    'dl.winClientDesc': { zh: '桌面聊天客户端，登录一次全站免登，支持聊天室、好友与文章。', en: 'Desktop chat client — sign in once and browse the whole site; supports chat rooms, friends and articles.', ja: 'デスクトップ版チャット。一度ログインすれば全サイトを閲覧でき、チャット・フレンド・記事に対応します。', ko: '데스크톱 채팅 클라이언트로 한 번 로그인하면 사이트 전체를 이용할 수 있으며 채팅방, 친구, 글을 지원합니다.', es: 'Cliente de chat de escritorio: inicia sesión una vez y usa todo el sitio; admite salas de chat, amigos y artículos.' },
    'dl.winAdmin': { zh: 'Windows 管理端', en: 'Windows admin', ja: 'Windows 管理版', ko: 'Windows 관리자', es: 'Administración para Windows' },
    'dl.winAdminDesc': { zh: '内容与账号管理客户端，包含公告、聊天室、建议与文章审核。', en: 'Content and account console: notices, chat rooms, feedback and article review.', ja: 'コンテンツとアカウントの管理アプリ。お知らせ・チャット・ご意見・記事審査を含みます。', ko: '콘텐츠와 계정 관리 앱으로 공지, 채팅방, 의견, 글 심사를 포함합니다.', es: 'Consola de contenido y cuentas: anuncios, salas de chat, sugerencias y revisión de artículos.' },
    'dl.androidClient': { zh: 'Android 客户端', en: 'Android client', ja: 'Android クライアント', ko: 'Android 클라이언트', es: 'Cliente para Android' },
    'dl.androidClientDesc': { zh: '手机聊天客户端，支持图文消息与好友私聊。', en: 'Mobile chat client with image messages and private chats.', ja: 'スマホ版チャット。画像メッセージと友達との個別チャットに対応します。', ko: '모바일 채팅 클라이언트로 이미지 메시지와 친구 1:1 채팅을 지원합니다.', es: 'Cliente de chat móvil con mensajes con imágenes y chats privados.' },
    'dl.androidAdmin': { zh: 'Android 管理端', en: 'Android admin', ja: 'Android 管理版', ko: 'Android 관리자', es: 'Administración para Android' },
    'dl.androidAdminDesc': { zh: '手机端管理后台，便于随时处理公告与审核。', en: 'Mobile admin console for handling notices and reviews on the go.', ja: 'スマホ用管理画面。外出先でもお知らせと審査を処理できます。', ko: '모바일 관리 콘솔로 언제든 공지와 심사를 처리할 수 있습니다.', es: 'Consola de administración móvil para gestionar anuncios y revisiones.' },
    'dl.note': { zh: '所有客户端当前版本均为 1.0.0。下载按钮会打开 123 云盘分享页，请按你的平台选择对应文件；管理端仅供开发者使用。', en: 'All clients are at version 1.0.0. The download button opens a 123 Pan share page — pick the file for your platform; the admin builds are for developers only.', ja: 'すべてのクライアントはバージョン 1.0.0 です。ダウンロードボタンは 123 パンの共有ページを開きます。お使いのプラットフォームのファイルを選んでください。管理版は開発者専用です。', ko: '모든 클라이언트는 버전 1.0.0입니다. 다운로드 버튼을 누르면 123 클라우드 공유 페이지가 열리며, 사용하는 플랫폼의 파일을 선택하세요. 관리자 버전은 개발자 전용입니다.', es: 'Todos los clientes están en la versión 1.0.0. El botón abre la página compartida de 123 Pan: elige el archivo de tu plataforma; las versiones de administración son solo para desarrolladores.' },
  };

  var current = DEFAULT_LANG;
  var listeners = [];

  function findLang(code) {
    for (var i = 0; i < LANGS.length; i++) {
      if (LANGS[i].code === code) return LANGS[i];
    }
    return null;
  }

  function normalize(code) {
    return findLang(code) ? code : DEFAULT_LANG;
  }

  function t(key, vars) {
    var entry = DICT[key];
    if (!entry) return '';
    var s = entry[current];
    if (!s) s = entry[DEFAULT_LANG] || '';
    if (!s) return '';
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) {
        return (vars[k] === undefined || vars[k] === null) ? m : String(vars[k]);
      });
    }
    return s;
  }

  function apply() {
    var nodes = d.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-i18n');
      var v = t(key);
      if (v) nodes[i].textContent = v;
    }
    var phs = d.querySelectorAll('[data-i18n-ph]');
    for (var j = 0; j < phs.length; j++) {
      var pv = t(phs[j].getAttribute('data-i18n-ph'));
      if (pv) phs[j].setAttribute('placeholder', pv);
    }
    var tts = d.querySelectorAll('[data-i18n-title]');
    for (var k = 0; k < tts.length; k++) {
      var tv = t(tts[k].getAttribute('data-i18n-title'));
      if (tv) tts[k].setAttribute('title', tv);
    }
    var ars = d.querySelectorAll('[data-i18n-aria]');
    for (var m = 0; m < ars.length; m++) {
      var av = t(ars[m].getAttribute('data-i18n-aria'));
      if (av) ars[m].setAttribute('aria-label', av);
    }
    var meta = findLang(current) || LANGS[0];
    d.documentElement.setAttribute('lang', meta.html);
  }

  function syncControls() {
    var picker = d.querySelector('.lang-picker');
    if (!picker) return;
    var meta = findLang(current) || LANGS[0];
    var label = picker.querySelector('.lang-cur');
    if (label) label.textContent = meta.short;
    var opts = picker.querySelectorAll('.lang-opt');
    for (var i = 0; i < opts.length; i++) {
      var on = opts[i].getAttribute('data-lang') === current;
      opts[i].className = 'lang-opt' + (on ? ' on' : '');
      opts[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
  }

  function setLang(code) {
    current = normalize(code);
    try { localStorage.setItem(STORE_KEY, current); } catch (e) {}
    apply();
    syncControls();
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](current); } catch (e) {}
    }
  }

  function onLangChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  var STYLE_TEXT = [
    '.lang-picker{position:relative;display:flex;align-items:center;}',
    '.lang-btn{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 12px;border-radius:999px;',
    'border:1px solid rgba(255,255,255,0.18);',
    'background:linear-gradient(135deg,rgba(255,255,255,0.14),rgba(255,255,255,0.05) 55%,rgba(200,169,110,0.10));',
    '-webkit-backdrop-filter:blur(20px) saturate(170%);backdrop-filter:blur(20px) saturate(170%);',
    'box-shadow:inset 0 1px 0 rgba(255,255,255,0.20),0 4px 16px rgba(0,0,0,0.18);',
    'color:rgba(247,244,238,0.72);font-family:inherit;font-size:13px;letter-spacing:0.04em;cursor:pointer;',
    'transition:color .3s cubic-bezier(.22,1,.36,1),border-color .3s cubic-bezier(.22,1,.36,1),box-shadow .3s cubic-bezier(.22,1,.36,1),transform .3s cubic-bezier(.22,1,.36,1);}',
    '.lang-btn:hover{color:#f7f4ee;border-color:rgba(200,169,110,0.55);',
    'box-shadow:inset 0 1px 0 rgba(255,255,255,0.26),0 8px 26px rgba(200,169,110,0.16);transform:translateY(-1px);}',
    '.lang-btn:active{transform:translateY(0) scale(0.98);}',
    '.lang-btn svg{width:15px;height:15px;flex:none;opacity:0.85;}',
    '.lang-cur{white-space:nowrap;}',
    '.lang-caret{transition:transform .3s cubic-bezier(.22,1,.36,1);}',
    '.lang-picker.open .lang-caret{transform:rotate(180deg);}',
    '.lang-menu{position:absolute;top:calc(100% + 12px);right:0;min-width:164px;padding:8px;border-radius:18px;',
    'background:linear-gradient(160deg,rgba(40,44,42,0.92),rgba(18,21,20,0.96));',
    'border:1px solid rgba(255,255,255,0.16);',
    'box-shadow:inset 0 1px 0 rgba(255,255,255,0.16),0 18px 48px rgba(0,0,0,0.46);',
    '-webkit-backdrop-filter:blur(22px) saturate(170%);backdrop-filter:blur(22px) saturate(170%);',
    'opacity:0;transform:translateY(-6px) scale(0.98);pointer-events:none;z-index:40;',
    'transition:opacity .25s cubic-bezier(.22,1,.36,1),transform .25s cubic-bezier(.22,1,.36,1);}',
    '.lang-picker.open .lang-menu{opacity:1;transform:none;pointer-events:auto;}',
    '.lang-opt{display:flex;align-items:center;justify-content:space-between;width:100%;padding:9px 12px;',
    'border:none;background:none;border-radius:11px;color:rgba(247,244,238,0.72);font-family:inherit;',
    'font-size:13px;letter-spacing:0.03em;text-align:left;cursor:pointer;transition:background .2s ease,color .2s ease;}',
    '.lang-opt:hover{background:rgba(255,255,255,0.08);color:#f7f4ee;}',
    '.lang-opt.on{color:#c8a96e;}',
    '.lang-dot{width:5px;height:5px;border-radius:50%;background:#c8a96e;opacity:0;flex:none;margin-left:10px;}',
    '.lang-opt.on .lang-dot{opacity:1;}',
    '@media (max-width:860px){.lang-btn{height:32px;padding:0 10px;}.lang-btn .lang-cur{display:none;}}'
  ].join('');

  var GLOBE_SVG = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
    + '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/>'
    + '<ellipse cx="12" cy="12" rx="4.2" ry="9" stroke="currentColor" stroke-width="1.3"/>'
    + '<path d="M3.3 9.2h17.4M3.3 14.8h17.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
    + '</svg>';
  var CARET_SVG = '<svg class="lang-caret" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="11" height="11">'
    + '<path d="M6 9.5l6 6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
    + '</svg>';

  function buildControl() {
    if (!d.querySelector('.nav-right') || d.querySelector('.lang-picker')) return;

    var style = d.createElement('style');
    style.type = 'text/css';
    style.appendChild(d.createTextNode(STYLE_TEXT));
    (d.head || d.documentElement).appendChild(style);

    var meta = findLang(current) || LANGS[0];
    var picker = d.createElement('div');
    picker.className = 'lang-picker';

    var html = '<button type="button" class="lang-btn" data-i18n-aria="lang.aria" aria-haspopup="true" aria-expanded="false">'
      + GLOBE_SVG
      + '<span class="lang-cur">' + meta.short + '</span>'
      + CARET_SVG
      + '</button><div class="lang-menu" role="listbox">';
    for (var i = 0; i < LANGS.length; i++) {
      html += '<button type="button" class="lang-opt' + (LANGS[i].code === current ? ' on' : '')
        + '" role="option" data-lang="' + LANGS[i].code + '" aria-selected="' + (LANGS[i].code === current ? 'true' : 'false') + '">'
        + '<span>' + LANGS[i].label + '</span><span class="lang-dot"></span></button>';
    }
    html += '</div>';
    picker.innerHTML = html;

    var navRight = d.querySelector('.nav-right');
    var avatar = navRight.querySelector('.avatar');
    if (avatar) navRight.insertBefore(picker, avatar);
    else navRight.appendChild(picker);

    var btn = picker.querySelector('.lang-btn');
    var menu = picker.querySelector('.lang-menu');

    function openMenu() {
      picker.className = 'lang-picker open';
      btn.setAttribute('aria-expanded', 'true');
    }
    function closeMenu() {
      picker.className = 'lang-picker';
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (picker.className.indexOf('open') >= 0) closeMenu(); else openMenu();
    });
    menu.addEventListener('click', function (ev) {
      var node = ev.target;
      while (node && node !== menu && !node.getAttribute('data-lang')) node = node.parentNode;
      if (node && node !== menu && node.getAttribute('data-lang')) {
        setLang(node.getAttribute('data-lang'));
        closeMenu();
      }
      ev.stopPropagation();
    });
    d.addEventListener('click', function () { closeMenu(); });
    d.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' || ev.keyCode === 27) closeMenu();
    });
  }

  function start() {
    try {
      var saved = localStorage.getItem(STORE_KEY);
      current = normalize(saved || DEFAULT_LANG);
    } catch (e) {
      current = DEFAULT_LANG;
    }
    buildControl();
    apply();
    syncControls();
    // 多标签页 / 多窗口同步
    w.addEventListener('storage', function (ev) {
      if (ev && ev.key === STORE_KEY && ev.newValue) setLang(ev.newValue);
    });
  }

  w.cealinT = t;
  w.cealinSetLang = setLang;
  w.cealinOnLangChange = onLangChange;
  w.cealinLang = function () { return current; };

  if (d.readyState === 'loading') {
    d.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window, document);
