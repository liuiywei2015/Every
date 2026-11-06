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

    /* ---------- 导航与通用 ---------- */
    'nav.home': { zh: '首页', en: 'Home', ja: 'ホーム', ko: '홈', es: 'Inicio' },
    'nav.project': { zh: '项目', en: 'Projects', ja: 'プロジェクト', ko: '프로젝트', es: 'Proyectos' },
    'nav.platform': { zh: '平台', en: 'Platform', ja: 'プラットフォーム', ko: '플랫폼', es: 'Plataforma' },
    'nav.chat': { zh: '聊天室', en: 'Chat', ja: 'チャット', ko: '채팅방', es: 'Chat' },
    'nav.suggestion': { zh: '建议', en: 'Feedback', ja: 'ご意見', ko: '의견', es: 'Sugerencias' },
    'nav.notice': { zh: '公告', en: 'Notices', ja: 'お知らせ', ko: '공지사항', es: 'Anuncios' },
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
    'idx.gate.sub': { zh: '请选择登录身份', en: 'Choose how you’d like to sign in', ja: 'ログイン方法を選択してください', ko: '로그인 방식을 선택해 주세요', es: 'Elige cómo quieres entrar' },
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
    'ad.confirmDelSug': { zh: '确认删除这条建议？删除后不可恢复。', en: 'Delete this suggestion? This can’t be undone.', ja: 'このご意見を削除しますか？ 削除すると元に戻せません。', ko: '이 의견을 삭제할까요? 삭제 후에는 되돌릴 수 없습니다.', es: '¿Eliminar esta sugerencia? No se puede deshacer.' },
    'ad.noticeCount': { zh: '{n} / 2000', en: '{n} / 2000', ja: '{n} / 2000', ko: '{n} / 2000', es: '{n} / 2000' },

    'ad.noticeEmpty': { zh: '公告内容不能为空', en: 'The notice cannot be empty', ja: 'お知らせの内容を入力してください', ko: '공지사항 내용을 입력해 주세요', es: 'El anuncio no puede estar vacío' },
    'ad.noticeTooLong': { zh: '公告内容不能超过2000字', en: 'The notice cannot exceed 2,000 characters', ja: 'お知らせは 2,000 文字以内で入力してください', ko: '공지사항은 2,000자를 넘을 수 없습니다', es: 'El anuncio no puede superar los 2000 caracteres' },
    'ad.noticeSaved': { zh: '公告已保存', en: 'Notice saved', ja: 'お知らせを保存しました', ko: '공지사항을 저장했습니다', es: 'Anuncio guardado' },
    'ad.noticeSaveFailed': { zh: '保存失败，请稍后重试', en: 'Couldn’t save—please try again in a moment', ja: '保存に失敗しました。しばらくしてから再度お試しください', ko: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요', es: 'No se pudo guardar; inténtalo de nuevo en un momento' },
    'ad.netSave': { zh: '网络异常，保存失败', en: 'Network error—nothing was saved', ja: '通信エラーで保存できませんでした', ko: '네트워크 오류로 저장하지 못했습니다', es: 'Error de red: no se guardó nada' },
    'ad.noticeFallback': { zh: '欢迎来到 Cealin，请文明交流。', en: 'Welcome to Cealin. Please keep the conversation friendly.', ja: 'Cealin へようこそ。お互い気持ちよくやり取りしましょう。', ko: 'Cealin에 오신 것을 환영합니다. 서로 배려하며 대화해 주세요.', es: 'Bienvenido a Cealin. Mantengamos una conversación respetuosa.' },
    'ad.offTitle': { zh: '官方账号', en: 'Official accounts', ja: '公式アカウント', ko: '공식 계정', es: 'Cuentas oficiales' },
    'ad.offDesc': { zh: '按编号搜索账号，授予或取消官方身份。官方账号在聊天室发言时昵称后显示金色「官方」标识。', en: 'Search an account by ID and grant or revoke official status. Official accounts show a gold “Official” badge after their name in chat.', ja: 'IDでアカウントを検索し、公式ステータスを付与・解除します。公式アカウントはチャットで名前の後に金色の「公式」バッジが表示されます。', ko: 'ID로 계정을 검색해 공식 상태를 부여하거나 해제합니다. 공식 계정은 채팅에서 이름 뒤에 금색 「공식」 배지가 표시됩니다.', es: 'Busca una cuenta por ID y concede o retira el estado oficial. Las cuentas oficiales muestran una insignia dorada «Oficial» tras su nombre en el chat.' },
    'ad.offPh': { zh: '输入账号编号（可输入部分）', en: 'Account ID (partial is fine)', ja: 'アカウントIDを入力（一部でも可）', ko: '계정 ID 입력(일부만 입력해도 됨)', es: 'ID de cuenta (puede ser parcial)' },
    'ad.offSearch': { zh: '搜索', en: 'Search', ja: '検索', ko: '검색', es: 'Buscar' },
    'ad.offSearching': { zh: '搜索中…', en: 'Searching…', ja: '検索中…', ko: '검색 중…', es: 'Buscando…' },
    'ad.offNeedQuery': { zh: '请先输入编号再搜索', en: 'Enter an ID to search', ja: 'IDを入力してから検索してください', ko: 'ID를 입력한 뒤 검색해 주세요', es: 'Introduce un ID para buscar' },
    'ad.offCount': { zh: '匹配账号 {n} 个', en: '{n} accounts matched', ja: '一致するアカウント {n} 件', ko: '일치하는 계정 {n}개', es: '{n} cuentas coinciden' },
    'ad.offEmpty': { zh: '没有匹配的账号', en: 'No accounts matched', ja: '一致するアカウントはありません', ko: '일치하는 계정이 없습니다', es: 'Ninguna cuenta coincide' },
    'ad.offTruncated': { zh: '账号较多，仅显示前 50 个，请输入更完整的编号缩小范围', en: 'Showing the first 50—enter a fuller ID to narrow it down', ja: '件数が多いため先頭50件のみ表示しています。IDを詳しく入力して絞り込んでください', ko: '계정이 많아 앞의 50개만 표시합니다. ID를 더 정확히 입력해 범위를 좁혀 주세요', es: 'Se muestran las primeras 50: escribe un ID más completo para acotar' },
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
    'acc.err.admin_pwd': { zh: '管理员密码校验失败，请重新登录后台', en: 'Admin password check failed—sign in to the console again', ja: '管理者パスワードの確認に失敗しました。管理画面に再ログインしてください', ko: '관리자 비밀번호 확인에 실패했습니다. 관리자 화면에 다시 로그인해 주세요', es: 'La contraseña de administrador no es válida: vuelve a entrar en el panel' }
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
