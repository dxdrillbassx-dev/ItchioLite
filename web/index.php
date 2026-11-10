<?php
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';
getDB();

$isClient = isset($_GET['client']) && $_GET['client'] == '1';
$currentView = isset($_GET['view']) ? $_GET['view'] : 'home';
// Выход по ссылке с экрана бана
if (isset($_GET['logout']) && $_GET['logout'] == '1') {
    try {
        if (function_exists('logoutUser')) logoutUser();
        elseif (function_exists('logout')) logout();
        else {
            if (session_status() === PHP_SESSION_NONE) session_start();
            $_SESSION = [];
            if (ini_get('session.use_cookies')) {
                $p = session_get_cookie_params();
                setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
            }
            session_destroy();
        }
    } catch (Throwable $e) {}
    $qs = [];
    if (isset($_GET['client']) && $_GET['client'] == '1') $qs[] = 'client=1';
    $qs[] = 'view=auth';
    header('Location: ?' . implode('&', $qs));
    exit;
}

$auth = getAuthState();
$isAuthorized = $auth['authorized'];
$user = $auth['user'];
$csrfToken = $auth['csrf_token'];

// ===== БАН: полный экран вместо приложения =====
$banInfo = null;
if ($isAuthorized && !empty($user['id'])) {
    try {
        $pdoBan = getDB();
        foreach ([
            "ALTER TABLE users ADD COLUMN is_banned TINYINT(1) NOT NULL DEFAULT 0",
            "ALTER TABLE users ADD COLUMN ban_reason VARCHAR(512) NOT NULL DEFAULT ''",
            "ALTER TABLE users ADD COLUMN banned_at TIMESTAMP NULL DEFAULT NULL",
            "ALTER TABLE users ADD COLUMN banned_until TIMESTAMP NULL DEFAULT NULL",
            "ALTER TABLE users ADD COLUMN banned_by INT UNSIGNED NULL DEFAULT NULL",
        ] as $sqlTry) {
            try { $pdoBan->exec($sqlTry); } catch (Throwable $e) {}
        }
        $stBan = $pdoBan->prepare("SELECT COALESCE(is_banned,0) AS is_banned, ban_reason, banned_at, banned_until, banned_by FROM users WHERE id = ?");
        $stBan->execute([(int)$user['id']]);
        $br = $stBan->fetch() ?: [];
        if ((int)($br['is_banned'] ?? 0) === 1) {
            if (!empty($br['banned_until']) && strtotime($br['banned_until']) < time()) {
                try { $pdoBan->exec("ALTER TABLE users ADD COLUMN show_unban_notice TINYINT(1) NOT NULL DEFAULT 0"); } catch (Throwable $e) {}
                $pdoBan->prepare("UPDATE users SET is_banned = 0, ban_reason = '', banned_at = NULL, banned_until = NULL, banned_by = NULL, show_unban_notice = 1 WHERE id = ?")
                    ->execute([(int)$user['id']]);
            } else {
                $byName = '';
                if (!empty($br['banned_by'])) {
                    $bn = $pdoBan->prepare("SELECT username FROM users WHERE id = ?");
                    $bn->execute([(int)$br['banned_by']]);
                    $byName = (string)($bn->fetchColumn() ?: '');
                }
                $banInfo = [
                    'reason' => $br['ban_reason'] ?: 'Нарушение правил',
                    'banned_at' => $br['banned_at'],
                    'banned_until' => $br['banned_until'],
                    'banned_by_name' => $byName,
                ];
            }
        }
    } catch (Throwable $e) { /* ignore */ }
}


// ===== Уведомление о разбане (один раз) =====
$unbanNotice = false;
if ($isAuthorized && empty($banInfo) && !empty($user['id'])) {
    try {
        $pdoU = getDB();
        try { $pdoU->exec("ALTER TABLE users ADD COLUMN show_unban_notice TINYINT(1) NOT NULL DEFAULT 0"); } catch (Throwable $e) {}
        $stU = $pdoU->prepare("SELECT COALESCE(show_unban_notice,0) FROM users WHERE id = ?");
        $stU->execute([(int)$user['id']]);
        $unbanNotice = ((int)$stU->fetchColumn() === 1);
    } catch (Throwable $e) {}
}

// Неавторизованным показываем только авторизацию — без мигания основного интерфейса
if (!$isAuthorized && $currentView !== 'auth') {
    $currentView = 'auth';
}

// Личные разделы недоступны без аккаунта
if (!$isAuthorized && in_array($currentView, ['library', 'downloads', 'profile', 'settings', 'notifications'], true)) {
    $currentView = 'auth';
}

// Библиотека — только в десктоп-клиенте: в браузере её раздел не открывается
if (!$isClient && $currentView === 'library') {
    $currentView = 'home';
}

// Аватар: фото если загружено, иначе инициал на цветном фоне
$avatarText = '';
$avatarColor = '#ef5b2c';
$avatarUrl = '';
if ($isAuthorized) {
    $avatarUrl = $user['avatar_url'] ?? '';
    $avatarText = mb_strtoupper(mb_substr($user['username'], 0, 1));
    $avatarColor = $user['avatar_color'] ?? '#ef5b2c';
}
function avatarStyleAttr($url, $color, $uid = 0) {
    if ($url) {
        $sep = (strpos($url, '?') !== false) ? '&' : '?';
        $bust = $url . $sep . 'u=' . (int)$uid . '&t=' . substr(md5($url . $uid), 0, 8);
        return 'background-image:url(\'' . htmlspecialchars($bust, ENT_QUOTES) . '\');background-size:cover;background-position:center;';
    }
    return 'background:' . htmlspecialchars($color) . ';';
}

// «В CATio с <месяц> <год>» по-русски
$ruMonths = [1=>'января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
$memberSince = '';
if ($isAuthorized) {
    $ts = strtotime($user['created_at'] ?? 'now');
    $memberSince = $ruMonths[(int)date('n', $ts)] . ' ' . date('Y', $ts);
}
?>
<!DOCTYPE html>
<html lang="ru">
<head>
  <script>
    (function(){
      try {
        var t = localStorage.getItem('catio_theme') || 'dark';
        if (t !== 'light' && t !== 'dark') t = 'dark';
        document.documentElement.setAttribute('data-theme', t);
      } catch(e) {}
    })();
  </script>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CATio</title>
  <link rel="icon" type="image/x-icon" href="logo.ico" />
  <?php $assetVer = (string)max(@filemtime(__DIR__ . '/css/style.css') ?: 0, @filemtime(__DIR__ . '/js/app.js') ?: 0); ?>
  <link rel="stylesheet" href="css/style.css?v=<?php echo $assetVer; ?>" />
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
  <meta http-equiv="Pragma" content="no-cache" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <?php if ($isClient): ?>
  <style>.topbar{display:none!important}body{margin:0;background:#12110e}</style>
  <?php endif; ?>



</head>
<body class="<?php echo ($isClient ? 'client' : 'web') . ($isAuthorized ? '' : ' guest'); ?>">
  <div id="app">
    <?php if ($isClient && $isAuthorized): ?>
    <!-- ===== САЙДБАР (как в Hydra) — только в десктоп-клиенте ===== -->
    <aside class="sidebar">
      <div class="side-user avatar-wrap">
        <button type="button" class="side-user-btn" id="avatar-btn" aria-haspopup="true" aria-expanded="false">
          <span class="side-avatar-wrap">
            <span class="side-avatar" id="side-avatar" style="<?php echo avatarStyleAttr($avatarUrl, $avatarColor, (int)($user['id'] ?? 0)); ?>"><?php echo $avatarUrl ? '' : htmlspecialchars($avatarText); ?></span>
            <span class="side-avatar-dot" id="side-avatar-dot" aria-hidden="true"></span>
          </span>
          <span class="side-user-name"><?php echo htmlspecialchars($user['username']); ?></span>
          <span class="side-user-arrow" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg>
          </span>
        </button>
        <div class="user-menu hidden" id="user-menu" role="menu">
          <div class="user-menu-head">
            <div class="user-menu-name"><?php echo htmlspecialchars($user['username']); ?></div>
            <div class="user-menu-mail"><?php echo htmlspecialchars($user['email']); ?></div>
          </div>
          <div class="user-menu-balance">
            <span>Баланс</span>
            <b id="user-balance"><?php echo number_format($user['balance'], 0, ',', ' '); ?> ₽</b>
          </div>
          
          <button type="button" class="user-menu-item" id="menu-profile"><svg class="menu-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Профиль</button>
          <button type="button" class="user-menu-item" id="menu-notifications"><svg class="menu-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> Уведомления <span class="menu-badge notif-menu-badge hidden">0</span></button>
          <button type="button" class="user-menu-item menu-friends-btn"><svg class="menu-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> Друзья <span class="menu-badge friends-menu-badge hidden">0</span></button>
          <button type="button" class="user-menu-item" id="menu-settings"><svg class="menu-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg> Настройки</button>
          <div class="user-menu-sep" role="separator"></div>
          <button type="button" class="user-menu-item danger" id="menu-logout"><svg class="menu-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Выйти</button>
        </div>
      </div>

      <nav class="side-nav">
        <button type="button" class="nav-btn side-btn <?php echo $currentView === 'home' ? 'active' : ''; ?>" data-view="home"><span class="side-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></span>Главная</button>
        <button type="button" class="nav-btn side-btn <?php echo $currentView === 'store' ? 'active' : ''; ?>" data-view="store"><span class="side-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></span>Каталог</button>
        <?php if ($isClient): ?>
        <button type="button" class="nav-btn side-btn <?php echo $currentView === 'library' ? 'active' : ''; ?>" data-view="library"><span class="side-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></span>Библиотека</button>
        <?php endif; ?>
        <button type="button" class="nav-btn side-btn <?php echo $currentView === 'workshop' ? 'active' : ''; ?>" data-view="workshop"><span class="side-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span>Мастерская</button>
        <button type="button" class="nav-btn side-btn <?php echo $currentView === 'downloads' ? 'active' : ''; ?>" data-view="downloads"><span class="side-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></span>Загрузки<span class="nav-badge hidden" id="downloads-badge">0</span></button>
      </nav>

      <div class="side-lib">
        <div class="side-lib-title">МОЯ БИБЛИОТЕКА</div>
        <div class="side-lib-controls">
          <input type="text" id="side-lib-search" class="side-lib-search" placeholder="Поиск" aria-label="Поиск в библиотеке" />
          <button type="button" class="side-lib-tool" id="side-lib-installed" title="Только установленные">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <button type="button" class="side-lib-tool" id="side-lib-filters" title="Фильтры">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
          </button>
        </div>
        <div class="side-lib-modal hidden" id="side-lib-modal">
          <div class="side-lib-modal-section">Платформы</div>
          <button type="button" class="side-lib-opt active" data-plat="all">Все<span class="opt-check">✓</span></button>
          <button type="button" class="side-lib-opt" data-plat="windows">ПК (Windows)<span class="opt-check">✓</span></button>
          <button type="button" class="side-lib-opt" data-plat="linux">Linux<span class="opt-check">✓</span></button>
          <div class="side-lib-modal-section">Сортировать по</div>
          <button type="button" class="side-lib-opt active" data-sort="recent">Недавно сыгранные<span class="opt-check">✓</span></button>
          <button type="button" class="side-lib-opt" data-sort="name">По названию<span class="opt-check">✓</span></button>
          <button type="button" class="side-lib-opt" data-sort="rating">По оценке<span class="opt-check">✓</span></button>
        </div>
        <div id="side-lib-list"><div class="side-lib-empty">Загрузка...</div></div>
      </div>

    </aside>
    <?php endif; ?>

    <?php if (!$isClient): ?>
    <!-- ===== ВЕРХНЯЯ ШАПКА (классическая) — только в браузере ===== -->
    <header class="topbar">
      <div class="logo">
        <img class="logo-img" src="logo.ico" alt="CATio" />
        <span class="logo-text">CATio</span>
      </div>
      <nav class="nav">
        <button class="nav-btn <?php echo $currentView === 'home' ? 'active' : ''; ?>" data-view="home">Главная</button>
        <button class="nav-btn <?php echo $currentView === 'store' ? 'active' : ''; ?>" data-view="store">Каталог</button>
        <button class="nav-btn <?php echo $currentView === 'workshop' ? 'active' : ''; ?>" data-view="workshop">Мастерская</button>
        <?php if ($isAuthorized): ?>
        <button class="nav-btn <?php echo $currentView === 'profile' ? 'active' : ''; ?>" data-view="profile"><?php echo htmlspecialchars(strtoupper($user['username'])); ?></button>
        <?php endif; ?>
      </nav>
      <div class="user-area">
        <?php if ($isAuthorized): ?>
        <div class="avatar-wrap">
          <button type="button" class="avatar" id="avatar-btn" aria-haspopup="true" aria-expanded="false" style="<?php echo avatarStyleAttr($avatarUrl, $avatarColor, (int)($user['id'] ?? 0)); ?>"><?php echo $avatarUrl ? '' : htmlspecialchars($avatarText); ?></button>
          <span class="header-avatar-dot" id="header-avatar-dot" aria-hidden="true"></span>
          <div class="user-menu hidden" id="user-menu" role="menu">
            <div class="user-menu-head">
              <div class="user-menu-name"><?php echo htmlspecialchars($user['username']); ?></div>
              <div class="user-menu-mail"><?php echo htmlspecialchars($user['email']); ?></div>
            </div>
            <div class="user-menu-balance">
              <span>Баланс</span>
              <b id="user-balance"><?php echo number_format($user['balance'], 0, ',', ' '); ?> ₽</b>
            </div>
            <button type="button" class="user-menu-item" id="menu-profile"><svg class="menu-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Профиль</button>
            <button type="button" class="user-menu-item menu-notifications-btn" id="menu-notifications"><svg class="menu-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> Уведомления <span class="menu-badge notif-menu-badge hidden">0</span></button>
            <button type="button" class="user-menu-item menu-friends-btn"><svg class="menu-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> Друзья <span class="menu-badge friends-menu-badge hidden">0</span></button>
            <button type="button" class="user-menu-item" id="menu-settings"><svg class="menu-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg> Настройки</button>
            <div class="user-menu-sep" role="separator"></div>
            <button type="button" class="user-menu-item danger" id="menu-logout"><svg class="menu-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Выйти</button>
          </div>
        </div>
        <?php else: ?>
        <a href="?view=auth" class="btn-auth">Войти</a>
        <?php endif; ?>
      </div>
    </header>
    <?php endif; ?>

    <div class="content">
      <?php if ($isAuthorized): ?>
      <!-- Блок над вкладкой: назад + название + поиск по вкладке (как в Hydra) -->
      <header class="content-head">
        <div class="content-head-inner">
<button type="button" class="head-back" id="head-back" title="Назад" aria-label="Назад">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h1 class="head-title" id="head-title">Главная</h1>
        <div class="head-search" id="head-search">
          <svg class="head-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          <input type="text" id="head-search-input" placeholder="Поиск" aria-label="Поиск игр" autocomplete="off" />
          <div class="head-search-drop" id="head-search-drop" hidden></div>
        </div>
        <?php if ($isAuthorized && ($user['role'] ?? '') === 'admin'): ?>
        <button type="button" class="head-admin" id="btn-admin" data-view="admin" title="Админка" aria-label="Админка">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <span class="admin-badge hidden" id="admin-badge">0</span>
        </button>
        <?php endif; ?>
        <button type="button" class="head-cart" id="btn-cart" title="Корзина" aria-label="Корзина">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
          <span class="cart-badge hidden" id="cart-badge">0</span>
        </button>
        <button type="button" class="head-add-game" id="btn-add-game" title="Создать" onclick="if(window.openCreateMenu){openCreateMenu();}else if(window.openSubmitRules){openSubmitRules();}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        </div>
      </header>
      <?php endif; ?>

    <main class="main">
      <!-- ===== ГЛАВНАЯ (как в Hydra) ===== -->
      <section id="view-home" class="view <?php echo $currentView === 'home' ? 'active' : ''; ?>">
        <div class="home-hero hidden" id="home-hero">
          <img class="home-hero-bg" id="home-hero-bg" src="" alt="" />
          <div class="home-hero-grad"></div>
          <div class="home-hero-info">
            <img class="home-hero-logo hidden" id="home-hero-logo" src="" alt="" />
            <h2 class="home-hero-title" id="home-hero-title"></h2>
            <p class="home-hero-desc" id="home-hero-desc"></p>
          </div>
        </div>

        <div class="home-pills" id="home-pills">
          <button type="button" class="home-pill active" data-hsort="popular">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l2.2 6.6H21l-5.4 4 2.1 6.6L12 15.8 6.3 19.2l2.1-6.6L3 8.6h6.8L12 2z"/></svg>
            Сейчас популярно
          </button>
          <button type="button" class="home-pill" data-hsort="week">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l6-6 4 4 7-7"/><path d="M14 8h7v7"/></svg>
            Лучшие игры недели
          </button>
          <button type="button" class="home-pill" data-hsort="new">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/></svg>
            Новинки
          </button>
          <button type="button" class="home-pill surprise" id="home-surprise">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h.01M15 9h.01M9 15c1.5 1.5 4.5 1.5 6 0"/></svg>
            Удиви меня
          </button>
        </div>

        <h2 class="home-section-title" id="home-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l2.2 6.6H21l-5.4 4 2.1 6.6L12 15.8 6.3 19.2l2.1-6.6L3 8.6h6.8L12 2z"/></svg>
          Сейчас популярно
        </h2>
        <div class="home-grid" id="home-grid"><div class="loading">Загрузка...</div></div>
      </section>

      <!-- ===== КАТАЛОГ (сетка/список + фильтры справа, как в Hydra) ===== -->
      <section id="view-store" class="view <?php echo $currentView === 'store' ? 'active' : ''; ?>">
        <div class="store-layout">
          <div class="store-main">
            <div class="store-head">
              <div class="store-count-line">
                <div class="store-count-primary"><b id="store-count">0</b> результатов</div>
                <div class="store-hint">Используйте боковую панель для уточнения поиска</div>
              </div>
            </div>
            <div id="store-list" class="store-list"><div class="loading">Загрузка каталога...</div></div>
          </div>

          <aside class="store-filters">
            <!-- 1. Сортировка -->
            <div class="filter-block filter-block-sort">
              <div class="filter-block-body filter-block-body--open">
                <label class="sort-label sort-label--side">
                  <span>Сортировать по</span>
                  <select id="sort-select" class="sort-select" aria-label="Сортировка">
                    <option value="popular">Популярности</option>
                    <option value="new">Новизне</option>
                    <option value="rating">Оценке</option>
                    <option value="price">Цене</option>
                    <option value="title">Названию</option>
                  </select>
                </label>
              </div>
            </div>

            <!-- 2. Современные / Классика (ретро, эмуляторы) -->
            <div class="filter-block filter-block-era">
              <div class="filter-block-body filter-block-body--open">
                <div class="catalogue-mode-toggle" role="group" aria-label="Тип каталога">
                  <button type="button" class="store-era-btn active" data-era="modern" aria-pressed="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                    Современные
                  </button>
                  <button type="button" class="store-era-btn" data-era="classics" aria-pressed="false">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="12" height="16" rx="2"/><path d="M10 8h4M10 12h4M10 16h2"/></svg>
                    Классика
                  </button>
                </div>
              </div>
            </div>

            <!-- 3. Цена -->
            <div class="filter-block filter-block-price">
              <button type="button" class="filter-block-head" aria-expanded="true">
                <span class="filter-dot" style="background:#ef5b2c"></span>
                <span>Цена</span>
                <span class="hp-side-arrow" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg></span>
              </button>
              <div class="filter-block-body">
                <div class="filter-price-pills" id="price-pills">
                  <button type="button" class="price-pill active" data-price="all">Все</button>
                  <button type="button" class="price-pill" data-price="free">Бесплатные</button>
                  <button type="button" class="price-pill" data-price="paid">Платные</button>
                </div>
              </div>
            </div>

            <!-- 4. Жанры -->
            <div class="filter-block">
              <button type="button" class="filter-block-head" aria-expanded="true">
                <span class="filter-dot" style="background:#a78bfa"></span>
                <span>Жанры</span>
                <span class="filter-count" id="genre-count"></span>
                <span class="hp-side-arrow" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg></span>
              </button>
              <div class="filter-block-body">
                <input type="text" class="filter-search" id="genre-filter-search" placeholder="Фильтр..." />
                <div class="filter-opts" id="genre-opts"></div>
              </div>
            </div>

            <!-- 5. Разработчики -->
            <div class="filter-block">
              <button type="button" class="filter-block-head" aria-expanded="true">
                <span class="filter-dot" style="background:#f472b6"></span>
                <span>Разработчики</span>
                <span class="filter-count" id="dev-count"></span>
                <span class="hp-side-arrow" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg></span>
              </button>
              <div class="filter-block-body">
                <input type="text" class="filter-search" id="dev-filter-search" placeholder="Фильтр..." />
                <div class="filter-opts" id="dev-opts"></div>
              </div>
            </div>

            <button type="button" class="filter-clear-btn" id="store-clear-filters">Сбросить фильтры</button>
          </aside>
        </div>
      </section>

      <!-- ===== СТРАНИЦА ИГРЫ (как на itch.io) ===== -->
      <section id="view-game" class="view <?php echo $currentView === 'game' ? 'active' : ''; ?>">
        <div id="game-page"><div class="loading">Загрузка страницы игры...</div></div>
      </section>

      <!-- ===== ДОСТИЖЕНИЯ ИГРЫ ===== -->
      <section id="view-achievements" class="view">
        <div id="achievements-page"><div class="loading">Загрузка достижений...</div></div>
      </section>

      <!-- ===== БИБЛИОТЕКА (сетка карточек, как в Hydra) ===== -->
      <section id="view-library" class="view <?php echo $currentView === 'library' ? 'active' : ''; ?>">
        <div class="lib-head">
          <div class="lib-pills" id="library-filters">
            <button type="button" class="lib-filter active" data-filter="all">Все</button>
            <button type="button" class="lib-filter" data-filter="game">Игры</button>
            <button type="button" class="lib-filter" data-filter="asset">Ассеты</button>
            <button type="button" class="lib-filter" data-filter="installed">✓ Установленные</button>
          </div>
          <label class="sort-label">
            Сортировать по
            <select id="library-sort" class="sort-select" aria-label="Сортировка библиотеки">
              <option value="name">По названию (А-Я)</option>
              <option value="recent">Недавно добавленные</option>
              <option value="rating">По оценке</option>
            </select>
          </label>
        </div>
        <div id="library-grid" class="lib-grid"><div class="loading">Загрузка библиотеки...</div></div>
      </section>

      <!-- ===== ЗАГРУЗКИ (как в Hydra) ===== -->

      <!-- ===== МАСТЕРСКАЯ ===== -->
      <section id="view-workshop" class="view <?php echo $currentView === 'workshop' ? 'active' : ''; ?>">
        <div class="profile-page hydra-profile ws-page">
          <div class="hp-hero" id="ws-hero">
            <div class="hp-hero-bg" id="ws-hero-bg"></div>
            <div class="hp-banner" id="ws-banner">
              <div class="ws-hero-overlay">
                <img class="ws-hero-logo" src="logo.ico" alt="CATio" />
                <div class="ws-hero-left">
                  <h1 class="ws-hero-title">Модификации</h1>
                  <p class="ws-hero-desc">Благодаря мастерской модифицировать игры можно в один клик — ставьте моды, делитесь своими и открывайте новые грани любимых игр.</p>
                </div>
                <div class="ws-hero-stats" id="ws-hero-stats">
                  <div class="ws-stat">
                    <div class="ws-stat-val" id="ws-stat-downloads">0</div>
                    <div class="ws-stat-lbl">Скачиваний</div>
                  </div>
                  <div class="ws-stat">
                    <div class="ws-stat-val" id="ws-stat-mods">0</div>
                    <div class="ws-stat-lbl">Модификаций</div>
                  </div>
                  <div class="ws-stat">
                    <div class="ws-stat-val" id="ws-stat-users">0</div>
                    <div class="ws-stat-lbl">Пользователей</div>
                  </div>
                  <div class="ws-stat-note">Это только начало вы что хотели</div>
                </div>
              </div>
            </div>
            <div class="hp-toolbar" id="ws-toolbar">
              <div class="hp-tabs ws-tabs" id="ws-tabs">
                <button type="button" class="hp-btn-edit ws-tab-btn active" data-ws-tab="games">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 12h4M8 10v4M15 11h.01M18 13h.01"/></svg>
                  Игры
                </button>
                <button type="button" class="hp-btn-edit ws-tab-btn" data-ws-tab="mods">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                  Моды
                </button>
                <button type="button" class="hp-btn-edit ws-tab-btn" data-ws-tab="media">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                  Медиа
                </button>
              </div>
              <div class="hp-toolbar-spacer"></div>
              <button type="button" class="hp-btn-logout" id="ws-filters-btn" title="Фильтры">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
                Фильтры
              </button>
            </div>
          </div>

          <div class="hp-body ws-body ws-body--full">
            <div class="hp-main ws-main">
              <div class="ws-sub" id="ws-sub">Выберите из 0 игр для модификации</div>
              <div class="ws-grid" id="ws-grid">
                <div class="loading">Загрузка мастерской…</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ===== МАСТЕРСКАЯ: страница игры ===== -->
      <section id="view-workshop-game" class="view">
        <div class="profile-page hydra-profile ws-page">
          <div class="hp-hero" id="wsg-hero">
            <div class="hp-hero-bg" id="wsg-hero-bg"></div>
            <div class="hp-banner" id="wsg-banner">
              <div class="ws-hero-overlay wsg-hero-overlay">
                <div class="wsg-cover" id="wsg-cover"></div>
                <div class="wsg-head-info">
                  <h1 class="wsg-title" id="wsg-title">Игра</h1>
                  <p class="wsg-desc" id="wsg-desc"></p>
                  <div class="wsg-meta" id="wsg-meta"></div>
                </div>
              </div>
            </div>
            <div class="hp-toolbar" id="wsg-toolbar">
              <div class="hp-tabs ws-tabs" id="wsg-tabs">
                <button type="button" class="hp-btn-edit ws-tab-btn active" data-wsg-tab="mods">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                  Моды
                </button>
                <button type="button" class="hp-btn-edit ws-tab-btn" data-wsg-tab="media">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                  Медиа
                </button>
              </div>
              <div class="hp-toolbar-spacer"></div>
              <button type="button" class="hp-btn-logout" id="wsg-filters-btn" title="Фильтры">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
                Фильтры
              </button>
            </div>
          </div>
          <div class="hp-body ws-body ws-body--full">
            <div class="hp-main ws-main">
              <div class="ws-sub" id="wsg-sub">Моды этой игры</div>
              <div class="ws-grid is-mods" id="wsg-grid">
                <div class="loading">Загрузка…</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ===== Модалка фильтров мастерской ===== -->
      <div class="submit-modal hidden" id="ws-filters-modal">
        <div class="submit-modal-backdrop" data-close-ws-filters></div>
        <div class="submit-modal-box" style="max-width:440px;max-height:86vh;overflow:auto">
          <div class="submit-modal-head">
            <h2>Фильтры</h2>
            <button type="button" class="pub-modal-close" data-close-ws-filters aria-label="Закрыть">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="submit-modal-body">
            <div class="ws-side ws-filters-modal-body" id="ws-filters-body"></div>
          </div>
          <div class="submit-modal-foot">
            <button type="button" class="hp-btn-edit" id="ws-filters-reset">Сбросить</button>
            <button type="button" class="hp-btn-edit" id="ws-filters-apply" style="background:var(--accent);color:#12110e;border-color:var(--accent)">Применить</button>
          </div>
        </div>
      </div>

<section id="view-downloads" class="view <?php echo $currentView === 'downloads' ? 'active' : ''; ?>">
        <div class="downloads-page">
          <div class="downloads-active" id="downloads-active">
            <div class="downloads-empty" id="downloads-empty">
              <div class="downloads-empty-icon">↓</div>
              <p class="downloads-empty-title">Здесь так пусто...</p>
              <p class="downloads-empty-sub">Вы ещё ничего не скачали через CATio, но никогда не поздно начать.</p>
            </div>
          </div>
          <div class="downloads-history-wrap" id="downloads-history-wrap">
            <h3 class="downloads-history-title">Завершённые</h3>
            <div id="downloads-history" class="downloads-history">
              <p class="downloads-history-empty">Пока пусто</p>
            </div>
          </div>
        </div>
      </section>

      <!-- ===== КОРЗИНА ===== -->
      <section id="view-cart" class="view">
        <div class="cart-page" id="cart-page">
          <div class="cart-empty" id="cart-empty">
            <div class="cart-empty-icon" aria-hidden="true">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
              </svg>
            </div>
            <p class="cart-empty-title">Корзина пуста</p>
            <p class="cart-empty-sub">Загляни в каталог и добавь игры — они появятся здесь перед покупкой.</p>
            <button type="button" class="btn-primary cart-empty-btn" id="cart-go-store">В каталог</button>
          </div>
          <div class="cart-content hidden" id="cart-content">
            <div class="cart-list" id="cart-list"></div>
            <div class="cart-bottom-bar gp-actionbar" id="cart-bottom-bar">
              <div class="gp-action-left cart-bottom-total">
                <div class="gp-playtime cart-bottom-label">Итого</div>
                <div class="gp-last-play cart-total" id="cart-total">0 ₽</div>
              </div>
              <div class="gp-action-btns cart-bottom-actions">
                <button type="button" class="gp-bar-btn icon cart-clear-icon" id="cart-clear" title="Очистить корзину" aria-label="Очистить корзину">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>
                <button type="button" class="gp-bar-btn primary cart-checkout-btn" id="cart-checkout">Оформить покупку</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ===== УВЕДОМЛЕНИЯ (полноценная страница) ===== -->
      <section id="view-notifications" class="view <?php echo $currentView === 'notifications' ? 'active' : ''; ?>">
        <div class="notif-page">
          <div class="notif-page-toolbar">
            <div class="notif-filters">
              <button type="button" class="notif-filter active" data-nfilter="all">Все</button>
              <button type="button" class="notif-filter" data-nfilter="unread">Непрочитанные</button>
            </div>
            <div class="notif-actions">
              <button type="button" class="notif-btn" id="notif-read-all">Отметить все как прочитанные</button>
              <button type="button" class="notif-btn danger" id="notif-clear-all">Очистить все</button>
            </div>
          </div>
          <div class="notif-list" id="notif-list">
            <div class="notif-page-empty" id="notif-empty">
              <div class="notif-page-empty-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              </div>
              <div class="notif-page-empty-title">Нет уведомлений</div>
              <div class="notif-page-empty-sub">Вы в курсе всех событий! Загляните позже за новыми обновлениями.</div>
            </div>
          </div>
        </div>
      </section>

      <!-- ===== МАСТЕРСКАЯ (ассеты, инструменты, документация) ===== -->
      <section id="view-community" class="view <?php echo $currentView === 'community' ? 'active' : ''; ?>">
        <div class="catalog-header">
          <h1 class="catalog-title">Мастерская</h1>
          <p class="catalog-desc">Ассет-паки, звуки, UI-киты и инструменты для твоих игр. Загрузка своих работ — скоро.</p>
        </div>
        <div id="workshop-grid" class="games-grid"><div class="loading">Загрузка мастерской...</div></div>
      </section>

      <?php if ($isAuthorized): ?>
      <!-- ===== ПРОФИЛЬ (как в Hydra) ===== -->
            <section id="view-profile" class="view <?php echo $currentView === 'profile' ? 'active' : ''; ?>">
        <div class="profile-page hydra-profile">
          <!-- Баннер + toolbar (общий фон) -->
          <div class="hp-hero" id="hp-hero">
            <div class="hp-hero-bg<?php echo !empty($user['banner_url']) ? ' has-image' : ''; ?>" id="hp-banner-bg"
              <?php if (!empty($user['banner_url'])):
                $bpos = htmlspecialchars($user['banner_pos'] ?? '50% 50%', ENT_QUOTES);
                $bzoom = max(1, min(3, (float)($user['banner_zoom'] ?? 1)));
                $bsize = ($bzoom <= 1.01) ? 'cover' : (round($bzoom * 100) . '%');
              ?>style="background-image:url('<?php echo htmlspecialchars($user['banner_url'], ENT_QUOTES); ?>');background-position:<?php echo $bpos; ?>;background-size:<?php echo $bsize; ?>;"<?php endif; ?>></div>

            <div class="hp-banner" id="hp-banner">
              <button type="button" class="hp-banner-upload" id="hp-banner-upload" title="Загрузить баннер">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Загрузить баннер
              </button>
              <input type="file" id="hp-banner-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
              <div class="hp-user">
                <div class="hp-avatar" id="hp-avatar" style="<?php
                  if (!empty($user['avatar_url'])) {
                    echo avatarStyleAttr($user['avatar_url'] ?? '', $user['avatar_color'] ?? '#ef5b2c', (int)($user['id'] ?? 0));
                  } else {
                    echo 'background:' . htmlspecialchars($avatarColor) . ';';
                  }
                ?>"><?php echo empty($user['avatar_url']) ? htmlspecialchars($avatarText) : ''; ?></div>
<?php
                  $roleBadge = 'Игрок';
                  $roleCls = 'is-user';
                  if ($isAuthorized && $user) {
                    if (!empty($user['is_banned'])) { $roleBadge = 'Забанен'; $roleCls = 'is-banned'; }
                    elseif (($user['role'] ?? '') === 'admin') { $roleBadge = 'Администратор'; $roleCls = 'is-admin'; }
                    elseif (($user['role'] ?? '') === 'developer') { $roleBadge = 'Разработчик'; $roleCls = 'is-dev'; }
                    elseif (!empty($user['created_at']) && (time() - strtotime($user['created_at'])) < 30*86400) {
                      $roleBadge = 'Новичок'; $roleCls = 'is-newbie';
                    }
                  }
                ?>
                <div class="hp-user-info" id="hp-user-info">
                  <span class="hp-role-badge <?php echo $roleCls; ?>" id="hp-role-badge"><?php echo htmlspecialchars($roleBadge); ?></span>
                  <h1 class="hp-username" id="hp-username"><?php echo htmlspecialchars($user['username'] ?? ''); ?></h1>
                  <div class="hp-publisher-line" id="hp-publisher-line"<?php
                    $__pubLineHtml = '';
                    $__pubLineShow = false;
                    try {
                      if (!empty($isAuthorized) && !empty($user['id'])) {
                        $__pdo = function_exists('getDB') ? getDB() : null;
                        if ($__pdo) {
                          $__disp = null;
                          try {
                            $__st = $__pdo->prepare('SELECT display_publisher_id FROM users WHERE id = ?');
                            $__st->execute([(int)$user['id']]);
                            $__row = $__st->fetch();
                            if ($__row && array_key_exists('display_publisher_id', $__row) && $__row['display_publisher_id'] !== null) {
                              $__disp = (int)$__row['display_publisher_id'];
                            }
                          } catch (Throwable $e) {}
                          if ($__disp !== 0) {
                            $__sql = "SELECT p.id, p.name, p.slug FROM publisher_members pm JOIN publishers p ON p.id = pm.publisher_id WHERE pm.user_id = ?";
                            $__params = [(int)$user['id']];
                            if ($__disp > 0) {
                              $__sql .= " AND p.id = ?";
                              $__params[] = $__disp;
                            }
                            $__sql .= " ORDER BY pm.role = 'owner' DESC, p.name ASC LIMIT 1";
                            $__st2 = $__pdo->prepare($__sql);
                            $__st2->execute($__params);
                            $__pub = $__st2->fetch();
                            if ($__pub) {
                              $__pubLineShow = true;
                              $__pubLineHtml = '<button type="button" class="hp-publisher-link" data-id="'.(int)$__pub['id'].'" data-slug="'.htmlspecialchars($__pub['slug'] ?? '', ENT_QUOTES).'">'.htmlspecialchars($__pub['name'] ?? '').'</button>';
                            }
                          }
                        }
                      }
                    } catch (Throwable $e) {}
                    echo $__pubLineShow ? '' : ' hidden';
                  ?>><?php echo $__pubLineHtml; ?></div>
                </div>
              </div>
            </div>

            <!-- Кнопки под баннером (blur поверх того же фона) -->
            <div class="hp-toolbar">
              <div class="hp-toolbar-spacer"></div>
              <button type="button" class="hp-btn-edit hp-btn-icon" id="btn-edit-profile" title="Редактировать профиль" aria-label="Редактировать профиль">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </button>
              <button type="button" class="hp-btn-logout" onclick="logout()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                Выйти
              </button>
            </div>
          </div>

          <!-- Основной контент профиля -->
          <div class="hp-body">
            <div class="hp-main">
              <div class="hp-tabs">
                <button type="button" class="hp-tab active" data-ptab="library">Библиотека</button>
                <button type="button" class="hp-tab" data-ptab="reviews">Отзывы</button>
                <button type="button" class="hp-tab" data-ptab="souvenirs">Сувениры</button>
                <button type="button" class="hp-tab" data-ptab="screenshots">Скриншоты</button>
              </div>

              <div class="hp-filters" id="hp-filters">
                <div class="hp-filter">
                  <label>Платформы</label>
                  <select id="hp-platform" class="hp-select">
                    <option value="all">Все</option>
                    <option value="windows">Windows</option>
                    <option value="linux">Linux</option>
                    <option value="mac">Mac</option>
                  </select>
                </div>
                <div class="hp-filter">
                  <label>Сортировать по</label>
                  <select id="hp-sort" class="hp-select">
                    <option value="recent">Недавно сыгранные</option>
                    <option value="name">По названию</option>
                    <option value="playtime">По времени игры</option>
                    <option value="added">По дате добавления</option>
                  </select>
                </div>
              </div>

              <div class="hp-section" id="hp-pinned-section">
                <div class="hp-section-head">
                  <h3>Закреплённые <span class="hp-count" id="hp-pinned-count">0</span></h3>
                </div>
                <div class="hp-games-row" id="hp-pinned-games">
                  <div class="loading">Загрузка...</div>
                </div>
              </div>

              <div class="hp-section" id="hp-library-section">
                <div class="hp-section-head">
                  <h3>Библиотека <span class="hp-count" id="hp-library-count">0</span></h3>
                </div>
                <div class="hp-games-grid" id="hp-library-games">
                  <div class="loading">Загрузка...</div>
                </div>
              </div>

              <div class="hp-tab-pane hidden" id="hp-pane-reviews">
                <div class="hp-empty">Пока нет отзывов</div>
              </div>
              <div class="hp-tab-pane hidden" id="hp-pane-souvenirs">
                <div class="hp-empty">Сувениры появятся позже</div>
              </div>
              <div class="hp-tab-pane hidden" id="hp-pane-screenshots">
                <div class="hp-empty">Скриншотов пока нет</div>
              </div>
            </div>

            <aside class="hp-side">
              <div class="hp-side-card">
                <div class="hp-side-head">
                  <span>Статистика</span>
                  <button type="button" class="hp-side-toggle" aria-label="Свернуть" aria-expanded="true">
                    <span class="hp-side-arrow" aria-hidden="true">
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg>
                    </span>
                  </button>
                </div>
                <div class="hp-side-body">
                  <div class="hp-stat">
                    <div class="hp-stat-label">Достижения разблокированы</div>
                    <div class="hp-stat-value muted" id="hp-stat-achievements">Покажите свои достижения в профиле</div>
                  </div>
                  <div class="hp-stat">
                    <div class="hp-stat-label">Заработано очков</div>
                    <div class="hp-stat-value muted" id="hp-stat-points">Показывать заработанные очки в своём профиле</div>
                  </div>
                  <div class="hp-stat">
                    <div class="hp-stat-label">Всего сыграно</div>
                    <div class="hp-stat-row">
                      <span class="hp-stat-value" id="hp-stat-playtime">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        0 часов
                      </span>
                      <span class="hp-stat-badge" id="hp-stat-top">—</span>
                    </div>
                  </div>
                  <div class="hp-stat">
                    <div class="hp-stat-label">Карма</div>
                    <div class="hp-stat-value" id="hp-stat-karma">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2z"/></svg>
                      0 карма
                    </div>
                  </div>
                </div>
              </div>

              <div class="hp-side-card">
                <div class="hp-side-head">
                  <span>Недавняя активность</span>
                  <button type="button" class="hp-side-toggle" aria-label="Свернуть" aria-expanded="true">
                    <span class="hp-side-arrow" aria-hidden="true">
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg>
                    </span>
                  </button>
                </div>
                <div class="hp-side-body" id="hp-activity">
                  <div class="loading">Загрузка...</div>
                </div>
              </div>

              <div class="hp-side-card" id="hp-friends-card">
                <div class="hp-side-head">
                  <span>Друзья <span class="hp-count" id="hp-friends-count">0</span></span>
                  <button type="button" class="hp-side-toggle" aria-label="Свернуть" aria-expanded="true">
                    <span class="hp-side-arrow" aria-hidden="true">
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg>
                    </span>
                  </button>
                </div>
                <div class="hp-side-body" id="hp-friends-list">
                  <div class="loading">Загрузка...</div>
                </div>
              </div>
            </aside>
          </div>
        </div>

        </section>

        <!-- Модалки профиля (вне view — доступны из настроек) -->
<!-- Модалка редактирования профиля (как в Hydra) -->
        <div class="hp-modal hidden" id="hp-edit-modal">
          <div class="hp-modal-backdrop" id="hp-edit-backdrop"></div>
          <div class="hp-modal-box">
            <div class="hp-modal-head">
              <h2>Редактировать Профиль</h2>
              <button type="button" class="hp-modal-close" id="hp-edit-close" aria-label="Закрыть">×</button>
            </div>
            <div class="hp-modal-body">
              <div class="hp-edit-avatar-wrap">
                <div class="hp-edit-avatar" id="hp-edit-avatar" style="<?php
                  if (!empty($user['avatar_url'])) {
                    echo avatarStyleAttr($user['avatar_url'] ?? '', $user['avatar_color'] ?? '#ef5b2c', (int)($user['id'] ?? 0));
                  } else {
                    echo 'background:' . htmlspecialchars($avatarColor) . ';';
                  }
                ?>"><?php echo empty($user['avatar_url']) ? htmlspecialchars($avatarText) : ''; ?></div>
                <button type="button" class="hp-edit-avatar-btn" id="hp-avatar-upload" title="Сменить аватар">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                </button>
                <input type="file" id="hp-avatar-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
              </div>
              <label class="hp-edit-label">
                <span>Отображаемое имя</span>
                <input type="text" id="hp-edit-displayname" class="hp-edit-input" maxlength="32"
                       value="<?php echo htmlspecialchars($user['username']); ?>" />
              </label>
              <p class="hp-edit-hint">Чтобы указать, кто может это видеть, перейдите в Настройки.</p>
              <button type="button" class="hp-edit-save" id="hp-edit-save">Сохранить</button>
            </div>
          </div>
        </div>

        <!-- Модалка настройки баннера -->
        <div class="hp-modal hidden" id="hp-banner-modal">
          <div class="hp-modal-backdrop" id="hp-banner-backdrop"></div>
          <div class="hp-modal-box hp-banner-modal-box">
            <div class="hp-modal-head">
              <h2>Настройка баннера</h2>
              <button type="button" class="hp-modal-close" id="hp-banner-close" aria-label="Закрыть">×</button>
            </div>
            <div class="hp-modal-body hp-banner-modal-body">
              <div class="hp-banner-preview-wrap">
                <div class="hp-banner-preview" id="hp-banner-preview">
                  <div class="hp-banner-preview-img" id="hp-banner-preview-img"></div>
                </div>
                <p class="hp-edit-hint">Перетаскивайте изображение, чтобы выбрать область</p>
              </div>
              <label class="hp-edit-label">
                <span>Масштаб</span>
                <div class="hp-zoom-row">
                  <input type="range" id="hp-banner-zoom" class="hp-zoom-slider" min="100" max="250" value="100" step="1" />
                  <span class="hp-zoom-val" id="hp-banner-zoom-val">100%</span>
                </div>
              </label>
              <div class="hp-banner-modal-actions">
                <button type="button" class="hp-btn-edit" id="hp-banner-pick">Выбрать файл</button>
                <button type="button" class="auth-submit hp-banner-save-btn" id="hp-banner-save">Сохранить баннер</button>
              </div>
              <input type="file" id="hp-banner-file-modal" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
            </div>
          </div>
        </div>


<!-- ===== НАСТРОЙКИ (вкладка, как в Hydra) ===== -->
            <section id="view-settings" class="view <?php echo $currentView === 'settings' ? 'active' : ''; ?>">
        <div class="settings-layout">
          <aside class="settings-nav" id="settings-nav">
            <button type="button" class="settings-nav-btn active" data-stab="general">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>
              Основные
            </button>
            <button type="button" class="settings-nav-btn" data-stab="notifications">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              Уведомления
            </button>
            <button type="button" class="settings-nav-btn" data-stab="privacy">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Аккаунт и конфиденциальность
            </button>
            <button type="button" class="settings-nav-btn" data-stab="balance">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              Баланс
            </button>
          </aside>
          <div class="settings-main">
            <!-- ОСНОВНЫЕ -->
            <div class="settings-pane" id="settings-pane-general">
              <h2 class="settings-title">Основные</h2>
              <p class="settings-sub">Профиль, язык и внешний вид</p>

              <div class="settings-profile-card" id="settings-profile-card">
                <div class="settings-profile-card-banner" id="settings-profile-card-banner"<?php
                  if (!empty($user['banner_url'])) {
                    $bpos = htmlspecialchars($user['banner_pos'] ?? '50% 50%', ENT_QUOTES);
                    $bzoom = max(1, min(3, (float)($user['banner_zoom'] ?? 1)));
                    $bsize = ($bzoom <= 1.01) ? 'cover' : (round($bzoom * 100) . '%');
                    $burl = htmlspecialchars($user['banner_url'], ENT_QUOTES);
                    echo ' style="background-image:url(\'' . $burl . '\');background-position:' . $bpos . ';background-size:' . $bsize . ';"';
                  }
                ?>></div>
                <div class="settings-profile-card-shade"></div>
                <div class="settings-profile-card-body">
                  <div class="settings-profile-card-preview">
                    <div class="settings-avatar-preview" id="settings-avatar-preview" style="<?php echo avatarStyleAttr($avatarUrl, $avatarColor, (int)($user['id'] ?? 0)); ?>"><?php echo $avatarUrl ? '' : htmlspecialchars($avatarText); ?></div>
                    <div class="settings-profile-card-meta">
                      <div class="settings-profile-name" id="settings-display-name"><?php echo htmlspecialchars($user['username'] ?? ''); ?></div>
                      <div class="settings-profile-hint">Имя, аватар и баннер профиля</div>
                    </div>
                  </div>
                  <div class="settings-profile-card-actions">
                    <button type="button" class="hp-btn-edit" id="settings-open-profile-edit">Редактировать профиль</button>
                    <button type="button" class="hp-btn-edit" id="settings-open-banner-edit">Настроить баннер</button>
                  </div>
                </div>
                <input type="hidden" id="settings-username" value="<?php echo htmlspecialchars($user['username'] ?? ''); ?>" />
                <input type="file" id="settings-avatar-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
                <input type="file" id="settings-banner-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
                <div class="settings-banner-preview hidden" id="settings-banner-preview" <?php if (!empty($user['banner_url'])): ?>style="background-image:url('<?php echo htmlspecialchars($user['banner_url'], ENT_QUOTES); ?>')"<?php endif; ?>></div>
              </div>

              <label class="settings-label">
                <span>Язык</span>
                <select id="settings-lang" class="settings-select">
                  <option value="ru" selected>Русский</option>
                </select>
              </label>

              <div class="settings-label">
                <span>Тема оформления</span>
                <div class="theme-picker" id="theme-picker" role="group" aria-label="Тема">
                  <button type="button" class="theme-option" data-theme="dark" title="Тёмная">
                    <span class="theme-swatch theme-swatch--dark"></span>
                    <span class="theme-option-label">Тёмная</span>
                  </button>
                  <button type="button" class="theme-option" data-theme="light" title="Светлая">
                    <span class="theme-swatch theme-swatch--light"></span>
                    <span class="theme-option-label">Светлая</span>
                  </button>
                </div>
                <p class="settings-hint">Тема применяется сразу ко всему интерфейсу</p>
              </div>

              <p id="settings-error" class="auth-error hidden"></p>
              <button type="button" class="auth-submit" id="settings-save-general">Сохранить</button>
            </div>

            <!-- УВЕДОМЛЕНИЯ -->
            <div class="settings-pane hidden" id="settings-pane-notifications">
              <h2 class="settings-title">Уведомления</h2>
              <p class="settings-sub">Выберите, о чём вас оповещать</p>

              <div class="settings-group">
                <h3 class="settings-group-title">Уведомления библиотеки</h3>
                <label class="settings-check"><input type="checkbox" data-np="dl_complete" checked /> По завершении загрузки</label>
                <label class="settings-check"><input type="checkbox" data-np="new_repack" /> При добавлении нового репака</label>
                <label class="settings-check"><input type="checkbox" data-np="friend_request" checked /> При получении запроса в друзья</label>
                <label class="settings-check"><input type="checkbox" data-np="friend_playing" checked /> Когда друг начинает играть</label>
                <label class="settings-check"><input type="checkbox" data-np="friend_message" checked /> Когда друг отправляет сообщение</label>
              </div>

              <div class="settings-group">
                <h3 class="settings-group-title">Уведомления о достижениях</h3>
                <label class="settings-check"><input type="checkbox" data-np="ach_unlock" checked /> Когда достижение разблокировано</label>
                <label class="settings-check"><input type="checkbox" data-np="ach_enable" checked /> Включить уведомления о достижениях</label>
              </div>
              <button type="button" class="auth-submit" id="settings-save-notif">Сохранить</button>
            </div>

            <!-- ПРИВАТНОСТЬ -->
            <div class="settings-pane hidden" id="settings-pane-privacy">
              <h2 class="settings-title">Аккаунт и конфиденциальность</h2>
              <p class="settings-sub">Кто видит ваш профиль и как с вами связываться</p>

              <label class="settings-label">
                <span>Видимость профиля</span>
                <select id="settings-profile-vis" class="settings-select">
                  <option value="public">Публичный</option>
                  <option value="friends">Только для друзей</option>
                  <option value="hidden">Скрытый</option>
                </select>
              </label>

              <label class="settings-label">
                <span>Видимость сувениров и скриншотов</span>
                <select id="settings-media-vis" class="settings-select">
                  <option value="public">Публичный</option>
                  <option value="friends">Только для друзей</option>
                  <option value="hidden">Скрытый</option>
                </select>
              </label>

              <label class="settings-check" style="margin:16px 0">
                <input type="checkbox" id="settings-allow-friends" checked />
                Разрешить заявки в друзья
              </label>

              <label class="settings-label">
                <span>Текущий email</span>
                <input type="email" id="settings-email" class="auth-input" value="<?php echo htmlspecialchars($user['email'] ?? ''); ?>" />
              </label>

              <label class="settings-label"><span>Издательство в профиле</span>
                <select class="settings-select" id="settings-display-pub">
                  <option value="hide">Не показывать</option>
                </select>
              </label>
              <p class="settings-hint" style="margin-top:-4px;margin-bottom:12px;color:var(--text-muted);font-size:0.8rem">Какое издательство видно под ником (или скрыть)</p>

              <p id="settings-privacy-error" class="auth-error hidden"></p>
              <button type="button" class="auth-submit" id="settings-save-privacy">Сохранить</button>
            </div>

            <!-- БАЛАНС -->
            <div class="settings-pane hidden" id="settings-pane-balance">
              <h2 class="settings-title">Баланс</h2>
              <p class="settings-sub">Учебные рубли — ими можно покупать игры в каталоге</p>
              <p class="settings-balance-line">Текущий баланс: <b id="settings-balance"><?php echo number_format($user['balance'] ?? 0, 0, ',', ' '); ?> ₽</b></p>
              <div class="settings-topup-row">
                <button type="button" class="btn-topup" data-amount="100">+100 ₽</button>
                <button type="button" class="btn-topup" data-amount="500">+500 ₽</button>
                <button type="button" class="btn-topup" data-amount="1000">+1000 ₽</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <?php if ($isAuthorized): ?>
      <!-- ===== СТРАНИЦА ИЗДАТЕЛЬСТВА ===== -->
      <section id="view-publisher" class="view">
        <div class="profile-page hydra-profile" id="publisher-page">
          <div class="hp-hero" id="pub-page-hero">
            <div class="hp-hero-bg" id="pub-page-banner"></div>
            <div class="hp-banner">
              <div class="hp-user">
                <div class="hp-avatar" id="pub-page-avatar"></div>
                <div class="hp-user-info">
                  <span class="hp-role-badge is-dev">Издательство</span>
                  <h1 class="hp-username" id="pub-page-name">—</h1>
                  <p class="pub-page-desc" id="pub-page-desc"></p>
                </div>
              </div>
            </div>
            <!-- Полоска с blur как в профиле: слева статистика, справа кнопки -->
            <div class="hp-toolbar" id="pub-page-toolbar">
              <div class="hp-toolbar-left" id="pub-page-stats">
                <span class="pub-stat-chip" id="pub-players-count" title="Игроки, добавившие или играющие в игры издательства">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  <span id="pub-players-num">0</span> игроков
                </span>
              </div>
              <div class="hp-toolbar-spacer"></div>
              <div class="hp-toolbar-actions" id="pub-page-actions">
                <!-- кнопки заполняются JS: владелец — редактировать/удалить, остальные — подписаться -->
              </div>
            </div>
          </div>
          <div class="hp-body">
            <div class="hp-main">
              <div class="hp-section">
                <div class="hp-section-head">
                  <h3>Игры <span class="hp-count" id="pub-games-count">0</span></h3>
                </div>
                <div class="hp-games-grid" id="pub-page-games"><div class="loading">Загрузка...</div></div>
              </div>
            </div>
            <aside class="hp-side">
              <div class="hp-side-card" id="pub-members-card">
                <div class="hp-side-head">
                  <span>Участники <span class="hp-count" id="pub-members-count">0</span></span>
                  <button type="button" class="hp-side-toggle" aria-label="Свернуть" aria-expanded="true">
                    <span class="hp-side-arrow" aria-hidden="true">
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg>
                    </span>
                  </button>
                </div>
                <div class="hp-side-body" id="pub-page-members"></div>
              </div>
            </aside>
          </div>
        </div>
      </section>
      <?php endif; ?>

      <?php if ($isAuthorized && ($user['role'] ?? '') === 'admin'): ?>
<section id="view-admin" class="view <?php echo $currentView === 'admin' ? 'active' : ''; ?>">
        <div class="settings-layout admin-settings-layout">
          <aside class="settings-nav" id="admin-nav">
            <button type="button" class="settings-nav-btn active" data-atab="moderation">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Модерация <span class="admin-mod-count hidden" id="admin-mod-count"></span>
            </button>
            <button type="button" class="settings-nav-btn" data-atab="users">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Пользователи
            </button>
            <!-- steam import tab removed -->
          </aside>

          <div class="settings-main">
            <div class="settings-pane" id="admin-pane-moderation">
              <h2 class="settings-title">Модерация</h2>
              <p class="settings-desc">Игры, моды и медиа на проверке. Нажмите карточку — откроется модалка.</p>
              <div class="admin-layout admin-layout--list-only">
                <div class="admin-list-panel" style="grid-column: 1 / -1">
                  <div id="admin-pending-list" class="admin-pending-list">
                    <div class="loading">Загрузка...</div>
                  </div>
                </div>
                <div class="admin-edit-panel hidden" id="admin-edit-panel" style="display:none !important" aria-hidden="true">
                  <div class="admin-placeholder hidden" id="admin-empty">
                    <p class="hidden">Выберите игру слева</p>
                  </div>
                  <form class="submit-form hidden" id="admin-game-form">
                    <input type="hidden" id="admin-game-id" value="" />
                    <div class="settings-grid">
                      <label class="settings-label"><span>Название</span><input class="auth-input" id="admin-title" required /></label>
                      <label class="settings-label"><span>Жанр</span><input class="auth-input" id="admin-genre" /></label>
                      <label class="settings-label"><span>Цена (₽)</span><input class="auth-input" id="admin-price" type="number" min="0" step="1" value="0" /></label>
                      <label class="settings-label full"><span>Краткое описание</span><input class="auth-input" id="admin-short" /></label>
                      <label class="settings-label full"><span>Описание</span><textarea class="auth-input settings-textarea" id="admin-desc" rows="5"></textarea></label>
                    </div>
                    <div class="settings-block">
                      <h3 class="settings-subtitle">Системные требования</h3>
                      <div class="sysreq-fields" id="admin-sys-min-fields"></div>
                      <div class="sysreq-fields" id="admin-sys-rec-fields"></div>
                    </div>
                    <div class="settings-grid">
                      <label class="settings-label"><span>Контроллеры</span><input class="auth-input" id="admin-controllers" placeholder="xbox,playstation" /></label>
                      <label class="settings-label full"><span>Видео (URL)</span><input class="auth-input" id="admin-video" /></label>
                    </div>
                    <div class="settings-block">
                      <h3 class="settings-subtitle">Языки</h3>
                      <div class="lang-table" id="admin-lang-table"></div>
                    </div>
                    <div class="settings-block">
                      <h3 class="settings-subtitle">Текущие медиа</h3>
                      <div id="admin-media-list" class="admin-media-list"></div>
                    </div>
                    <div class="settings-grid">
                      <label class="settings-label"><span>Новая обложка</span>
                        <input type="file" id="admin-cover" accept="image/*" />
                        <img id="admin-cover-preview" class="admin-cover-preview" alt="" style="display:none;max-width:120px;max-height:120px;object-fit:cover;border-radius:8px;margin-top:8px" />
                      </label>
                      <label class="settings-label"><span>Новый баннер</span>
                        <input type="file" id="admin-banner" accept="image/*" />
                        <img id="admin-banner-preview" class="admin-cover-preview" alt="" style="display:none;max-width:160px;max-height:90px;object-fit:cover;border-radius:8px;margin-top:8px" />
                      </label>
                      <label class="settings-label full"><span>Добавить скриншоты</span><input type="file" id="admin-shots" accept="image/*" multiple /></label>
                      <label class="settings-label full"><span>Заметка модератора</span><textarea class="auth-input settings-textarea" id="admin-note" rows="2"></textarea></label>
                    </div>
                    <div class="settings-actions">
                      <button type="button" class="auth-submit" id="admin-save">Сохранить</button>
                      <button type="button" class="auth-submit" id="admin-publish">Опубликовать</button>
                      <button type="button" class="btn-ghost" id="admin-reject">Отклонить</button>
                    </div>
                  </form>
                </div>
              </div>
            </div>

            
            <div class="settings-pane hidden" id="admin-pane-users">
              <h2 class="settings-title">Пользователи</h2>
              <p class="settings-desc">Список аккаунтов, роли, баны. Можно открыть профиль или редактировать.</p>
              <div class="admin-users-toolbar">
                <input type="search" class="auth-input" id="admin-users-search" placeholder="Поиск по нику или почте…" />
                <select id="admin-users-filter" class="auth-input" style="max-width:160px">
                  <option value="all">Все</option>
                  <option value="admin">Админы</option>
                  <option value="developer">Разработчики</option>
                  <option value="user">Игроки</option>
                  <option value="banned">Забаненные</option>
                </select>
              </div>
              <div id="admin-users-list" class="admin-users-list">
                <div class="loading">Загрузка...</div>
              </div>
            </div>
            <!-- admin-pane-import removed -->
            </div>
        </div>
      </section>
      <?php endif; ?>

      <?php endif; ?>

      <?php if (!$isAuthorized): ?>
      <!-- ===== АВТОРИЗАЦИЯ ===== -->
      <section id="view-auth" class="view <?php echo $currentView === 'auth' ? 'active' : ''; ?>">
        <div class="auth-page">
          <div class="auth-box">
            <a class="auth-logo" href="?view=store<?php echo $isClient ? '&amp;client=1' : ''; ?>"><img class="logo-img logo-img-lg" src="logo.ico" alt="" />CATio</a>
            <p class="auth-sub">Вход на полку. Первый аккаунт становится администратором и разработчиком.</p>

            <div class="auth-card">
              <div class="auth-tabs">
                <button type="button" class="auth-tab active" id="tab-login" onclick="switchAuthTab('login')">Вход</button>
                <button type="button" class="auth-tab" id="tab-register" onclick="switchAuthTab('register')">Регистрация</button>
              </div>

              <p id="auth-error" class="auth-error hidden"></p>

              <form id="form-login" class="auth-form" onsubmit="doLogin(event); return false;">
                <label class="auth-label">
                  <span>Почта</span>
                  <input type="email" name="email" required autocomplete="email" class="auth-input" placeholder="you@example.com" />
                </label>
                <label class="auth-label">
                  <span>Пароль</span>
                  <input type="password" name="password" required minlength="8" autocomplete="current-password" class="auth-input" placeholder="••••••••" />
                </label>
                <button type="submit" class="auth-submit">Войти</button>
              </form>

              <form id="form-register" class="auth-form hidden" onsubmit="doRegister(event); return false;">
                <label class="auth-label">
                  <span>Имя</span>
                  <input type="text" name="username" required minlength="2" maxlength="32" autocomplete="username" class="auth-input" placeholder="catio_fan" />
                </label>
                <label class="auth-label">
                  <span>Почта</span>
                  <input type="email" name="email" required autocomplete="email" class="auth-input" placeholder="you@example.com" />
                </label>
                <label class="auth-label">
                  <span>Пароль</span>
                  <input type="password" name="password" required minlength="8" autocomplete="new-password" class="auth-input" placeholder="Минимум 8 символов" />
                </label>
                <label class="auth-consent">
                  <input type="checkbox" name="privacy_consent" id="reg-privacy-consent" value="1" />
                  <span>Я согласен(а) на <button type="button" class="auth-consent-link" id="privacy-open-btn">обработку персональных данных</button></span>
                </label>
                <button type="submit" class="auth-submit" id="reg-submit-btn" disabled>Создать аккаунт</button>
              </form>
            </div>
          </div>
        </div>
      </section>
      <?php endif; ?>
    </main>
    </div><!-- /content -->

    <!-- Нижняя полоска (загрузки + версия) — как Steam/Hydra -->
    <?php if ($isAuthorized): ?>
    <div class="bottom-bar" id="bottom-bar">
      <button type="button" class="bottom-bar-dl" id="bottom-bar-dl" title="Перейти к загрузкам">
        Нет активных загрузок
      </button>
      <span class="bottom-bar-ver" id="bottom-bar-ver">CATio — v0.0.1</span>
    </div>
    <?php endif; ?>
  </div><!-- /app -->

  <?php if ($isAuthorized): ?>
  <!-- ===== ЛАЙТБОКС ДЛЯ СКРИНШОТОВ ===== -->
  <div id="lightbox" class="lightbox hidden">
    <div class="lightbox-backdrop" id="lightbox-backdrop"></div>
    <button class="lightbox-close" id="lightbox-close" aria-label="Закрыть">×</button>
    <img id="lightbox-img" class="lightbox-img" src="" alt="Скриншот" />
  </div>
  <?php endif; ?>

  <script>
    window.IS_CLIENT = <?= $isClient ? 'true' : 'false' ?>;
    window.CSRF_TOKEN = '<?php echo $csrfToken; ?>';
    window.AUTH_STATE = <?php echo json_encode($auth); ?>;
    window.FORCE_AUTH_VIEW = <?= $isAuthorized ? 'false' : 'true' ?>;
    window.GAME_ID_FROM_URL = <?= (int)($_GET['id'] ?? 0) ?>;
  </script>
  <script>
// ===== AUTH =====
function switchAuthTab(tab) {
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('form-login').classList.toggle('hidden', tab !== 'login');
  document.getElementById('form-register').classList.toggle('hidden', tab !== 'register');
  hideAuthError();
}

(function initPrivacyConsent() {
  const cb = document.getElementById('reg-privacy-consent');
  const btn = document.getElementById('reg-submit-btn');
  if (cb && btn) {
    const sync = () => { btn.disabled = !cb.checked; };
    cb.addEventListener('change', sync);
    sync();
  }

  window.closePrivacyModal = function closePrivacyModal() {
    const m = document.getElementById('privacy-modal');
    if (!m) return;
    m.classList.add('is-closing');
    window.setTimeout(function () {
      m.classList.add('hidden');
      m.classList.remove('is-closing');
    }, 220);
  };
  window.openPrivacyModal = function openPrivacyModal() {
    const m = document.getElementById('privacy-modal');
    if (!m) return;
    m.classList.remove('is-closing');
    m.classList.remove('hidden');
  };

  // делегирование — работает даже если модалка ниже по DOM
  document.addEventListener('click', function (e) {
    const openBtn = e.target.closest('#privacy-open-btn');
    if (openBtn) {
      e.preventDefault();
      e.stopPropagation();
      window.openPrivacyModal();
      return;
    }
    const closeBtn = e.target.closest('#privacy-modal-close, [data-close-privacy]');
    if (closeBtn) {
      e.preventDefault();
      e.stopPropagation();
      window.closePrivacyModal();
    }
  });
})();

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideAuthError() {
  document.getElementById('auth-error').classList.add('hidden');
}

// Читаем ответ API: даже если сервер вернул не JSON (500, fatal error),
// показываем понятную ошибку, а не молчим
async function readApiJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Сервер вернул ошибку (HTTP ' + res.status + '). Проверь, что Apache и MySQL запущены.');
  }
}

async function doLogin(e) {
  e.preventDefault();
  hideAuthError();

  const form = e.target;
  const btn = form.querySelector('.auth-submit');
  btn.disabled = true;
  btn.textContent = 'Входим...';

  try {
    const res = await fetch('api/auth.php?action=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email.value.trim(),
        password: form.password.value,
        csrf_token: window.CSRF_TOKEN,
      }),
    });
    const data = await readApiJson(res);

    if (data.success) {
      // В клиенте сохраняем client=1 — иначе сломается синхронизация с C++
      window.location.href = window.IS_CLIENT ? '?view=home&client=1' : '?view=home';
    } else {
      showAuthError(data.error || Object.values(data.errors || {})[0] || 'Ошибка входа');
      btn.disabled = false;
      btn.textContent = 'Войти';
    }
  } catch (err) {
    showAuthError(err.message || 'Ошибка сети');
    btn.disabled = false;
    btn.textContent = 'Войти';
  }
  return false;
}

async function doRegister(e) {
  e.preventDefault();
  hideAuthError();

  const form = e.target;
  const consent = form.querySelector('#reg-privacy-consent') || form.querySelector('[name="privacy_consent"]');
  if (!consent || !consent.checked) {
    showAuthError('Нужно согласие на обработку персональных данных');
    return false;
  }
  const btn = form.querySelector('.auth-submit');
  btn.disabled = true;
  btn.textContent = 'Создаём...';

  try {
    const res = await fetch('api/auth.php?action=register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: form.username.value.trim(),
        email: form.email.value.trim(),
        password: form.password.value,
        privacy_consent: 1,
        csrf_token: window.CSRF_TOKEN,
      }),
    });
    const data = await readApiJson(res);

    if (data.success) {
      window.location.href = window.IS_CLIENT ? '?view=home&client=1' : '?view=home';
    } else {
      const errs = data.errors || {};
      showAuthError(data.error || Object.values(errs)[0] || 'Ошибка регистрации');
      btn.disabled = false;
      btn.textContent = 'Создать аккаунт';
    }
  } catch (err) {
    showAuthError(err.message || 'Ошибка сети');
    btn.disabled = false;
    btn.textContent = 'Создать аккаунт';
  }
  return false;
}

async function logout() {
  try {
    await fetch('api/auth.php?action=logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csrf_token: window.CSRF_TOKEN }),
    });
  } catch (e) {}
  window.location.href = window.IS_CLIENT ? '?view=home&client=1' : '?view=home';
}

function socialAuth(provider) {
  showAuthError('Вход через ' + provider + ' скоро будет доступен');
}
</script>
  <script>
// Синхронизация авторизации с нативным клиентом (имя, баланс, гость/не гость)
// Библиотека webview создаёт биндинги как window.<имя> — НЕ через hostObjects.
(function () {
  if (!window.IS_CLIENT) return;
  function push() {
    try {
      if (typeof window.catioSync === 'function') {
        window.catioSync(window.AUTH_STATE);
      }
    } catch (e) { /* не критично */ }
  }
  push();
  setTimeout(push, 500);
  setTimeout(push, 2000);
})();
</script>
  <script src="js/app.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>

  <!-- ===== МОДАЛКА ДРУЗЕЙ ===== -->
  <div class="friends-modal hidden" id="friends-modal">
    <div class="friends-modal-backdrop" id="friends-backdrop"></div>
    <div class="friends-modal-box">
      <div class="friends-modal-head">
        <h2 class="friends-modal-title">Друзья</h2>
        <button type="button" class="friends-modal-close" id="friends-close" aria-label="Закрыть">×</button>
      </div>
      <div class="friends-modal-body">
        <div class="friends-pane" id="friends-pane-friends">
        <div class="friends-me" id="friends-me"></div>

        <div class="friends-search-row">
          <div class="friends-search-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" id="friends-search" class="friends-search" placeholder="Поиск друзей" autocomplete="off" />
          </div>
          <button type="button" class="friends-add-btn" id="friends-add-btn" title="Добавить друга">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
          </button>
        </div>

        <div class="friends-search-results hidden" id="friends-search-results"></div>

        <div class="friends-code-panel hidden" id="friends-code-panel">
          <div class="friends-code-found hidden" id="friends-code-found"></div>
          <div class="friends-code-actions">
            <button type="button" class="fc-btn primary" id="friends-code-request" disabled>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
              Отправить заявку
            </button>
            <button type="button" class="fc-btn" id="friends-code-profile" disabled>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              Профиль
            </button>
          </div>
        </div>

        <div class="friends-section" id="friends-incoming-section" style="display:none">
          <button type="button" class="friends-section-toggle open" data-sec="incoming">
            <span class="friends-chevron">▾</span> ЗАЯВКИ <span class="friends-sec-count" id="friends-incoming-count">0</span>
          </button>
          <div class="friends-section-list" id="friends-incoming"></div>
        </div>

        <div class="friends-section">
          <button type="button" class="friends-section-toggle open" data-sec="online">
            <span class="friends-chevron">▾</span> В СЕТИ <span class="friends-sec-count online" id="friends-online-count">0</span>
          </button>
          <div class="friends-section-list" id="friends-online"></div>
        </div>

        <div class="friends-section">
          <button type="button" class="friends-section-toggle open" data-sec="offline">
            <span class="friends-chevron">▾</span> НЕ В СЕТИ <span class="friends-sec-count" id="friends-offline-count">0</span>
          </button>
          <div class="friends-section-list" id="friends-offline"></div>
        </div>
        </div><!-- /friends-pane-friends -->

        <div class="friends-pane hidden" id="friends-pane-notifications">
          <div class="notif-toolbar">
            <div class="notif-filters">
              <button type="button" class="notif-filter active" data-nfilter="all">Все</button>
              <button type="button" class="notif-filter" data-nfilter="unread">Непрочитанные</button>
            </div>
            <div class="notif-actions">
              <button type="button" class="notif-btn" id="notif-read-all">Отметить все</button>
              <button type="button" class="notif-btn danger" id="notif-clear-all">Очистить</button>
            </div>
          </div>
          <div class="notif-list" id="notif-list">
            <div class="friends-empty">Загрузка...</div>
          </div>
        </div>
      </div>
    </div>
  </div>


  <!-- ===== МОДАЛКА ПЕРЕПИСКИ ===== -->
  <div class="chat-modal hidden" id="chat-modal">
    <div class="chat-modal-backdrop" id="chat-backdrop"></div>
    <div class="chat-modal-box">
      <div class="chat-modal-head">
        <div class="chat-peer" id="chat-peer">
          <div class="chat-peer-avatar" id="chat-peer-avatar"></div>
          <div class="chat-peer-info">
            <div class="chat-peer-name" id="chat-peer-name"></div>
            <div class="chat-peer-status" id="chat-peer-status"></div>
          </div>
        </div>
        <button type="button" class="chat-modal-close" id="chat-close" aria-label="Закрыть">×</button>
      </div>
      <div class="chat-messages" id="chat-messages">
        <div class="chat-empty" id="chat-empty">
          <div class="chat-empty-icon">💬</div>
          <div class="chat-empty-title">Пока нет сообщений</div>
          <div class="chat-empty-sub">Напишите первыми</div>
        </div>
      </div>
      <div class="chat-compose">
        <div class="chat-tools">
          <button type="button" class="chat-tool-btn" id="chat-plus" title="Вложение">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button type="button" class="chat-tool-btn" id="chat-emoji" title="Смайлики">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
          </button>
        </div>
        <input type="text" id="chat-input" class="chat-input" placeholder="Написать сообщение..." maxlength="2000" autocomplete="off" />
        <button type="button" class="chat-send" id="chat-send" title="Отправить">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
      <div class="chat-emoji-panel hidden" id="chat-emoji-panel"></div>
      <div class="chat-plus-menu hidden" id="chat-plus-menu">
        <button type="button" data-plus="image">📷 Фото / GIF</button>
        <button type="button" data-plus="draw">✏️ Рисунок</button>
        <button type="button" data-plus="game">🎮 Поделиться игрой</button>
      </div>
      <input type="file" id="chat-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />

      <!-- Draw modal -->
      <div class="chat-draw-overlay hidden" id="chat-draw-overlay">
        <div class="chat-draw-box">
          <div class="chat-draw-head">
            <span>Рисунок</span>
            <button type="button" id="chat-draw-close">×</button>
          </div>
          <canvas id="chat-draw-canvas" width="360" height="240"></canvas>
          <div class="chat-draw-tools">
            <input type="color" id="chat-draw-color" value="#ef5b2c" />
            <button type="button" id="chat-draw-clear">Очистить</button>
            <button type="button" id="chat-draw-send">Отправить</button>
          </div>
        </div>
      </div>

      <!-- Share game picker -->
      <div class="chat-game-picker hidden" id="chat-game-picker">
        <div class="chat-game-picker-head">Выберите игру</div>
        <div class="chat-game-picker-list" id="chat-game-picker-list"></div>
      </div>
      <div class="chat-offline-hint hidden" id="chat-offline-hint">Пользователь не в сети — увидит сообщения позже</div>
    </div>
  </div>




  <!-- ===== ВЫБОР ДРУГА ДЛЯ ПОДАРКА ===== -->
  <div class="cart-modal-overlay hidden" id="gift-friend-modal" aria-hidden="true">
    <div class="cart-modal gift-friend-modal">
      <div class="cart-modal-head">
        <h3>Подарок другу</h3>
        <button type="button" class="pub-modal-close" id="gift-friend-close" aria-label="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="cart-modal-body">
        <div class="gift-friend-search-wrap friends-search-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="gift-friend-search" class="friends-search" placeholder="Поиск по имени" autocomplete="off" />
        </div>
        <div class="gift-friend-list" id="gift-friend-list"><div class="loading">Загрузка...</div></div>
      </div>
      <div class="cart-modal-foot">
        <button type="button" class="cart-modal-btn" id="gift-friend-cancel">Отмена</button>
      </div>
    </div>
  </div>

  <!-- ===== МОДАЛКА ПОДТВЕРЖДЕНИЯ ПОКУПКИ ===== -->
  <div class="cart-modal-overlay hidden" id="checkout-modal" aria-hidden="true">
    <div class="cart-modal checkout-modal">
      <div class="cart-modal-head">
        <h3>Подтверждение покупки</h3>
        <button type="button" class="pub-modal-close" id="checkout-modal-close" aria-label="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="cart-modal-body">
        <div class="checkout-alert hidden" id="checkout-alert" role="alert"></div>
        <div class="cart-modal-list" id="checkout-modal-list"></div>
        <div class="checkout-total-row">
          <span>К оплате</span>
          <strong id="checkout-modal-total">0 ₽</strong>
        </div>
        <label class="checkout-agree">
          <input type="checkbox" id="checkout-agree-cb" />
          <span>Я согласен(на) с <button type="button" class="auth-consent-link" id="refund-policy-open">условиями покупки и возврата</button></span>
        </label>
      </div>
      <div class="cart-modal-foot">
        <button type="button" class="cart-modal-btn" id="checkout-cancel">Отменить</button>
        <button type="button" class="cart-modal-btn primary" id="checkout-confirm" disabled>Приобрести</button>
      </div>
    </div>
  </div>

  <!-- ===== УСЛОВИЯ ПОКУПКИ / ВОЗВРАТА ===== -->
  <div class="submit-modal hidden" id="refund-policy-modal">
    <div class="submit-modal-backdrop" data-close-refund></div>
    <div class="submit-modal-box privacy-modal-box">
      <div class="submit-modal-head">
        <h2>Условия покупки и возврата</h2>
        <button type="button" class="pub-modal-close" data-close-refund aria-label="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="submit-modal-body privacy-modal-body">
        <div class="privacy-hero">
          <div class="privacy-hero-ico">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <div>
            <div class="privacy-hero-title">CATio — покупки в каталоге</div>
            <div class="privacy-hero-sub">Как работает оплата, доступ к играм и возврат средств</div>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#ef5b2c">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
          </div>
          <div>
            <h4>Оплата</h4>
            <p>Средства списываются с баланса аккаунта CATio. После успешной оплаты игра появляется в вашей библиотеке.</p>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#f0c14b">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
          </div>
          <div>
            <h4>Без автоматического возврата</h4>
            <p>По умолчанию деньги за покупку <strong>не возвращаются</strong>. Покупка считается окончательной после подтверждения.</p>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#6ea8fe">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          </div>
          <div>
            <h4>Исключение: меньше 3 часов</h4>
            <p>Возврат возможен, если наиграно <strong>меньше 3 часов</strong> и есть веская причина (техническая проблема, несоответствие описанию, случайная покупка и т.п.). Решение принимает поддержка.</p>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#6fdf8b">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div>
            <h4>Как запросить возврат</h4>
            <p>Напишите в поддержку через профиль, укажите игру и причину. Мы рассмотрим обращение в разумные сроки.</p>
          </div>
        </div>
      </div>
      <div class="submit-modal-foot">
        <button type="button" class="hp-btn-edit" data-close-refund>Закрыть</button>
      </div>
    </div>
  </div>

  <!-- ===== МОДАЛКА ПРАВИЛ ПУБЛИКАЦИИ ===== -->
  <!-- Нет издательства — нельзя публиковать -->
  <div class="submit-modal hidden" id="no-pub-modal">
    <div class="submit-modal-backdrop" data-close-no-pub></div>
    <div class="submit-modal-box" style="max-width:420px">
      <div class="submit-modal-head">
        <h2>Нужно издательство</h2>
        <button type="button" class="pub-modal-close" data-close-no-pub aria-label="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="submit-modal-body">
        <p class="no-pub-text">Вы не состоите ни в одном издательстве. Чтобы отправить игру на модерацию, сначала создайте издательство или вступите в существующее.</p>
      </div>
      <div class="submit-modal-foot">
        <button type="button" class="hp-btn-edit" data-close-no-pub>Отмена</button>
        <button type="button" class="hp-btn-edit" id="no-pub-create">Создать издательство</button>
      </div>
    </div>
  </div>

  <!-- ===== Меню создания ===== -->
  <div class="submit-modal hidden" id="create-menu-modal">
    <div class="submit-modal-backdrop" data-close-create-menu></div>
    <div class="submit-modal-box" style="max-width:420px">
      <div class="submit-modal-head">
        <h2>Создать</h2>
        <button type="button" class="pub-modal-close" data-close-create-menu aria-label="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="submit-modal-body create-menu-body">
        <button type="button" class="create-menu-item" id="create-menu-game">
          <span class="create-menu-ico" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 12h4M8 10v4M15 11h.01M18 13h.01"/></svg>
          </span>
          <span class="create-menu-txt"><strong>Добавить игру</strong><em>Карточка на модерацию</em></span>
        </button>
        <button type="button" class="create-menu-item" id="create-menu-workshop">
          <span class="create-menu-ico" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
          </span>
          <span class="create-menu-txt"><strong>Мастерская</strong><em>Мод или медиа на модерацию</em></span>
        </button>
        <button type="button" class="create-menu-item" id="create-menu-pubs">
          <span class="create-menu-ico" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/></svg>
          </span>
          <span class="create-menu-txt"><strong>Мои издательства</strong><em>Студии и бренды</em></span>
        </button>
      </div>
    </div>
  </div>

  <!-- ===== Мастерская: выбор типа ===== -->
  <div class="submit-modal hidden" id="ws-type-modal">
    <div class="submit-modal-backdrop" data-close-ws-type></div>
    <div class="submit-modal-box" style="max-width:420px">
      <div class="submit-modal-head">
        <h2>Мастерская</h2>
        <button type="button" class="pub-modal-close" data-close-ws-type aria-label="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="submit-modal-body create-menu-body">
        <button type="button" class="create-menu-item" id="ws-type-mod">
          <span class="create-menu-ico" aria-hidden="true">🧩</span>
          <span class="create-menu-txt"><strong>Загрузить мод</strong><em>Файлы, описание, скриншоты</em></span>
        </button>
        <button type="button" class="create-menu-item" id="ws-type-media">
          <span class="create-menu-ico" aria-hidden="true">🖼</span>
          <span class="create-menu-txt"><strong>Загрузить медиа</strong><em>Скриншоты для игры</em></span>
        </button>
      </div>
    </div>
  </div>

  <!-- ===== Мастерская: форма медиа ===== -->
  <div class="submit-modal hidden" id="ws-media-form-modal">
    <div class="submit-modal-backdrop" data-close-ws-media-form></div>
    <div class="submit-modal-box" style="max-width:520px">
      <div class="submit-modal-head">
        <h2>Загрузка медиа</h2>
        <button type="button" class="pub-modal-close" data-close-ws-media-form aria-label="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="submit-modal-body">
        <form id="ws-media-form" class="ws-pub-form">
          <label class="ws-field"><span>Название</span>
            <input type="text" name="title" class="auth-input" required maxlength="255" placeholder="Название набора скриншотов" />
          </label>
          <label class="ws-field"><span>Игра</span>
            <select name="game_id" id="ws-media-game" class="settings-select" required>
              <option value="">Загрузка списка…</option>
            </select>
          </label>
          <label class="ws-field"><span>Описание</span>
            <textarea name="description" class="auth-input" rows="3" placeholder="Кратко о скриншотах"></textarea>
          </label>
          <label class="ws-field"><span>Изображения</span>
            <input type="file" name="images[]" id="ws-media-files" accept="image/*" multiple required />
            <div class="ws-file-hint" id="ws-media-files-hint">Можно выбрать несколько</div>
          </label>
        </form>
      </div>
      <div class="submit-modal-foot">
        <button type="button" class="hp-btn-edit" data-close-ws-media-form>Отмена</button>
        <button type="button" class="hp-btn-edit" id="ws-media-submit" style="background:var(--accent);color:#12110e;border-color:var(--accent)">Отправить на модерацию</button>
      </div>
    </div>
  </div>

  <!-- ===== Мастерская: форма мода ===== -->
  <div class="submit-modal hidden" id="ws-mod-form-modal">
    <div class="submit-modal-backdrop" data-close-ws-mod-form></div>
    <div class="submit-modal-box" style="max-width:640px;max-height:90vh;overflow:auto">
      <div class="submit-modal-head">
        <h2>Загрузка мода</h2>
        <button type="button" class="pub-modal-close" data-close-ws-mod-form aria-label="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="submit-modal-body">
        <form id="ws-mod-form" class="ws-pub-form">
          <label class="ws-field"><span>Название</span>
            <input type="text" name="title" class="auth-input" required maxlength="255" />
          </label>
          <label class="ws-field"><span>Игра</span>
            <select name="game_id" id="ws-mod-game" class="settings-select" required>
              <option value="">Загрузка списка…</option>
            </select>
          </label>
          <label class="ws-field"><span>Краткое описание</span>
            <input type="text" name="short_description" class="auth-input" maxlength="500" placeholder="Одна строка для карточки" />
          </label>
          <label class="ws-field"><span>Об этом моде</span>
            <textarea name="about" class="auth-input" rows="3"></textarea>
          </label>
          <label class="ws-field"><span>Описание</span>
            <textarea name="description" class="auth-input" rows="4"></textarea>
          </label>
          <label class="ws-field"><span>Инструкция по установке</span>
            <textarea name="install_instructions" class="auth-input" rows="3"></textarea>
          </label>
          <label class="ws-field"><span>Основные характеристики</span>
            <textarea name="features" class="auth-input" rows="2" placeholder="По одному пункту на строку"></textarea>
          </label>
          <label class="ws-field"><span>Зависимости</span>
            <textarea name="dependencies" class="auth-input" rows="2"></textarea>
          </label>
          <label class="ws-field"><span>Путь установки файлов</span>
            <input type="text" name="install_path" class="auth-input" placeholder="например Data/Meshes/..." />
          </label>
          <label class="ws-field"><span>Теги</span>
            <input type="text" name="tags" class="auth-input" placeholder="через запятую" />
          </label>
          <div class="ws-field-row">
            <label class="ws-field"><span>Обложка</span>
              <input type="file" name="cover" accept="image/*" />
            </label>
            <label class="ws-field"><span>Баннер</span>
              <input type="file" name="banner" accept="image/*" />
            </label>
          </div>
          <label class="ws-field"><span>Скриншоты</span>
            <input type="file" name="screenshots[]" accept="image/*" multiple />
          </label>
          <label class="ws-field"><span>Файл мода</span>
            <input type="file" name="mod_file" accept=".zip,.rar,.7z,.pak,.mod,application/zip" required />
          </label>
        </form>
      </div>
      <div class="submit-modal-foot">
        <button type="button" class="hp-btn-edit" data-close-ws-mod-form>Отмена</button>
        <button type="button" class="hp-btn-edit" id="ws-mod-submit" style="background:var(--accent);color:#12110e;border-color:var(--accent)">Отправить на модерацию</button>
      </div>
    </div>
  </div>

  <!-- ===== Просмотр медиа ===== -->
  <div class="submit-modal hidden" id="ws-media-view-modal">
    <div class="submit-modal-backdrop" data-close-ws-media-view></div>
    <div class="submit-modal-box ws-view-box" style="max-width:720px">
      <div class="submit-modal-head">
        <h2 id="ws-mv-title">Медиа</h2>
        <button type="button" class="pub-modal-close" data-close-ws-media-view aria-label="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="submit-modal-body">
        <div class="ws-mv-stage">
          <button type="button" class="ws-mv-nav prev" id="ws-mv-prev" hidden>‹</button>
          <img id="ws-mv-img" alt="" />
          <button type="button" class="ws-mv-nav next" id="ws-mv-next" hidden>›</button>
        </div>
        <div class="ws-mv-counter" id="ws-mv-counter"></div>
        <div class="ws-mv-meta">
          <span id="ws-mv-date"></span>
          <span id="ws-mv-author"></span>
          <span id="ws-mv-views"></span>
          <button type="button" class="ws-like-btn" id="ws-mv-like">♥ <span>0</span></button>
        </div>
        <p class="ws-mv-desc" id="ws-mv-desc"></p>
      </div>
    </div>
  </div>

  <!-- ===== Просмотр мода (Nexus-like) ===== -->
  <div class="submit-modal hidden" id="ws-mod-view-modal">
    <div class="submit-modal-backdrop" data-close-ws-mod-view></div>
    <div class="submit-modal-box ws-view-box ws-mod-view-box" style="max-width:860px;max-height:92vh;overflow:auto">
      <div class="ws-modv-hero" id="ws-modv-hero">
        <div class="ws-modv-hero-bg" id="ws-modv-bg"></div>
        <div class="ws-modv-hero-inner">
          <div class="ws-modv-top">
            <div class="ws-modv-left">
              <h2 class="ws-modv-title" id="ws-modv-title">Мод</h2>
              <div class="ws-modv-stats">
                <span id="ws-modv-views">👁 0</span>
                <span id="ws-modv-dls">⬇ 0</span>
                <span id="ws-modv-likes">♥ 0</span>
              </div>
            </div>
            <button type="button" class="ws-modv-install" id="ws-modv-install">Установить</button>
          </div>
        </div>
        <button type="button" class="pub-modal-close ws-modv-close" data-close-ws-mod-view aria-label="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="submit-modal-body">
        <div class="ws-modv-carousel" id="ws-modv-carousel">
          <button type="button" class="ws-mv-nav prev" id="ws-modv-prev" hidden>‹</button>
          <div class="ws-modv-shots" id="ws-modv-shots"></div>
          <button type="button" class="ws-mv-nav next" id="ws-modv-next" hidden>›</button>
        </div>
        <div class="ws-modv-section">
          <h3>Описание</h3>
          <div class="ws-modv-text" id="ws-modv-desc"></div>
        </div>
        <div class="ws-modv-section" id="ws-modv-about-wrap">
          <h3>Об этом моде</h3>
          <div class="ws-modv-text" id="ws-modv-about"></div>
        </div>
        <div class="ws-modv-section" id="ws-modv-install-wrap">
          <h3>Инструкция по установке</h3>
          <div class="ws-modv-text" id="ws-modv-install-txt"></div>
        </div>
        <div class="ws-modv-section" id="ws-modv-feat-wrap">
          <h3>Основные характеристики</h3>
          <div class="ws-modv-text" id="ws-modv-feat"></div>
        </div>
        <div class="ws-modv-section" id="ws-modv-deps-wrap">
          <h3>Зависимости</h3>
          <div class="ws-modv-text" id="ws-modv-deps"></div>
        </div>
        <div class="ws-modv-meta-row">
          <span id="ws-modv-author"></span>
          <span id="ws-modv-game"></span>
          <button type="button" class="ws-like-btn" id="ws-modv-like">♥ <span>0</span></button>
        </div>
      </div>
    </div>
  </div>

  <!-- ===== Список издательств ===== -->
  <div class="submit-modal hidden" id="pubs-list-modal">
    <div class="submit-modal-backdrop" data-close-pubs-list></div>
    <div class="submit-modal-box" style="max-width:480px">
      <div class="submit-modal-head">
        <h2>Мои издательства</h2>
        <button type="button" class="pub-modal-close" data-close-pubs-list aria-label="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="submit-modal-body">
        <div id="pubs-list" class="pubs-list"><div class="loading">Загрузка...</div></div>
      </div>
      <div class="submit-modal-foot">
        <button type="button" class="hp-btn-edit" data-close-pubs-list>Закрыть</button>
        <button type="button" class="hp-btn-edit" id="pubs-create-open">Создать издательство</button>
      </div>
    </div>
  </div>

  <!-- ===== Создание издательства ===== -->
  <div class="submit-modal hidden" id="pubs-create-modal">
    <div class="submit-modal-backdrop" data-close-pubs-create></div>
    <div class="submit-modal-box submit-modal-wide pub-modal-box">
      <div class="submit-modal-head pub-modal-head">
        <div>
          <h2>Новое издательство</h2>
          <p class="pub-modal-sub">Аватар, баннер, описание и участники</p>
        </div>
        <button type="button" class="pub-modal-close" data-close-pubs-create aria-label="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="submit-modal-body pub-modal-body">
        <div class="submit-grid">
          <label class="settings-label full"><span>Название *</span><input class="auth-input" id="pub-name" maxlength="120" placeholder="Например: Neon Fox Games" /></label>
          <label class="settings-label full"><span>Описание</span><textarea class="auth-input settings-textarea" id="pub-desc" rows="3" placeholder="Коротко о студии"></textarea></label>
          <div class="settings-label">
            <span>Аватар</span>
            <div class="pub-file-card" style="margin-top:6px">
              <div class="pub-file-preview pub-file-preview--icon" id="pub-avatar-preview"><span>1:1</span></div>
              <label class="pub-file-btn" for="pub-avatar">Выбрать</label>
              <input type="file" id="pub-avatar" class="pub-file-input" accept="image/*" />
            </div>
          </div>
          <div class="settings-label">
            <span>Обложка / баннер</span>
            <div class="pub-file-card" style="margin-top:6px">
              <div class="pub-file-preview pub-file-preview--wide" id="pub-banner-preview"><span>Широкий</span></div>
              <label class="pub-file-btn" for="pub-banner">Выбрать</label>
              <input type="file" id="pub-banner" class="pub-file-input" accept="image/*" />
            </div>
          </div>
          <div class="settings-label full">
            <span>Участники</span>
            <input class="auth-input" id="pub-member-search" placeholder="Поиск пользователя…" autocomplete="off" />
            <div id="pub-member-suggest" class="pub-member-suggest hidden"></div>
            <div id="pub-member-chips" class="pub-member-chips"></div>
          </div>
        </div>
      </div>
      <div class="submit-modal-foot">
        <button type="button" class="hp-btn-edit" data-close-pubs-create>Отмена</button>
        <button type="button" class="auth-submit" id="pub-create-save">Создать</button>
      </div>
    </div>
  </div>

  <div class="submit-modal hidden" id="submit-rules-modal">
    <div class="submit-modal-backdrop" data-close="rules"></div>
    <div class="submit-modal-box privacy-modal-box">
      <div class="submit-modal-head">
        <h2>Правила публикации</h2>
        <button type="button" class="pub-modal-close" data-close="rules" aria-label="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="submit-modal-body privacy-modal-body">
        <div class="privacy-hero">
          <div class="privacy-hero-ico">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>
          </div>
          <div>
            <div class="privacy-hero-title">CATio — правила каталога</div>
            <div class="privacy-hero-sub">Коротко о том, что можно публиковать и как проходит модерация</div>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#ef5b2c">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <div>
            <h4>Права на контент</h4>
            <p>Загружайте только игры, на которые у вас есть права. Запрещены кражи чужого контента и вредоносные файлы.</p>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#6ea8fe">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          </div>
          <div>
            <h4>Обложка и описание</h4>
            <p>Обложка, скриншоты и текст должны соответствовать игре. NSFW — только с явной пометкой 18+.</p>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#6fdf8b">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          </div>
          <div>
            <h4>Модерация</h4>
            <p>После отправки игра проходит проверку. Админ может поправить материалы перед публикацией или отклонить заявку.</p>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#f0c14b">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
          </div>
          <div>
            <h4>Ответственность</h4>
            <p>Нарушение правил может привести к отклонению заявки и ограничению публикации для аккаунта.</p>
          </div>
        </div>
        <label class="settings-check" style="margin-top:14px">
          <input type="checkbox" id="submit-agree" />
          Я согласен(на) с правилами публикации
        </label>
      </div>
      <div class="submit-modal-foot">
        <button type="button" class="hp-btn-edit" data-close="rules">Отмена</button>
        <button type="button" class="hp-btn-edit" id="submit-rules-next" disabled>Дальше</button>
      </div>
    </div>
  </div>

    <!-- ===== МОДАЛКА АНКЕТЫ ИГРЫ (restored simple) ===== -->
<!-- ===== МОДАЛКА АНКЕТЫ ИГРЫ ===== -->
    <div class="submit-modal hidden" id="submit-form-modal">
    <div class="submit-modal-backdrop" data-close="form"></div>
    <div class="submit-modal-box submit-modal-wide pub-modal-box">
      <div class="submit-modal-head pub-modal-head">
        <div>
          <h2>Публикация игры</h2>
          <p class="pub-modal-sub">Заполните карточку игры — жанры, медиа, требования и описание</p>
        </div>
        <button type="button" class="pub-modal-close" data-close="form" aria-label="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="submit-modal-body pub-modal-body">
        <form id="submit-game-form" class="submit-form pub-form">

          <section class="pub-section">
            <div class="pub-section-head">
              <span class="pub-section-ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></span>
              <h3>Основное</h3>
            </div>
            <div class="submit-grid">
              <label class="settings-label"><span>Название *</span><input class="auth-input" name="title" id="sg-title" required maxlength="120" /></label>
              <label class="settings-label"><span>Цена (₽)</span><input class="auth-input" name="price" id="sg-price" type="text" inputmode="numeric" pattern="[0-9]*" value="0" maxlength="7" autocomplete="off" /></label>
              <label class="settings-label"><span>Разработчик</span><input class="auth-input" name="developer" id="sg-developer" maxlength="120" placeholder="Студия или автор" /></label>
              <label class="settings-label"><span>Издательство</span>
                <select class="settings-select" id="sg-publisher-id" name="publisher_id">
                  <option value="">— без издательства —</option>
                </select>
              </label>
              <input type="hidden" name="publisher" id="sg-publisher" value="" />
              <label class="settings-label"><span>Дата релиза</span><input class="auth-input" name="release_date" id="sg-release" type="date" /></label>
              <label class="settings-label"><span>Сайт / страница</span><input class="auth-input" name="website" id="sg-website" type="url" placeholder="https://" maxlength="255" /></label>
              <label class="settings-label full"><span>Краткое описание</span><input class="auth-input" name="short_description" id="sg-short" maxlength="200" placeholder="Одна строка для карточки в каталоге" /></label>
              <div class="settings-label full">
                <span>Жанры * <em class="pub-field-hint">можно несколько</em></span>
                <div class="pub-genre-grid" id="sg-genre-grid">
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Экшен" /><span>Экшен</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Приключения" /><span>Приключения</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="RPG" /><span>RPG</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Стратегия" /><span>Стратегия</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Симулятор" /><span>Симулятор</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Инди" /><span>Инди</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Хоррор" /><span>Хоррор</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Гонки" /><span>Гонки</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Спорт" /><span>Спорт</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Шутер" /><span>Шутер</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Платформер" /><span>Платформер</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Головоломка" /><span>Головоломка</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Выживание" /><span>Выживание</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Открытый мир" /><span>Открытый мир</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Мультиплеер" /><span>Мультиплеер</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Казуальная" /><span>Казуальная</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Другое" /><span>Другое</span></label>
                </div>
                <input type="hidden" name="genre" id="sg-genre" value="" />
              </div>
              <label class="settings-label full"><span>Теги</span><input class="auth-input" name="tags" id="sg-tags" maxlength="200" placeholder="через запятую: pixel-art, co-op, roguelike…" /></label>
              <div class="settings-label full">
                <span>Платформы</span>
                <div class="submit-checks pub-platform-checks">
                  <label class="settings-check"><input type="checkbox" class="sg-platform" value="windows" checked /> Windows</label>
                  <label class="settings-check"><input type="checkbox" class="sg-platform" value="linux" /> Linux</label>
                  <label class="settings-check"><input type="checkbox" class="sg-platform" value="mac" /> macOS</label>
                </div>
              </div>
              <div class="settings-label full">
                <span>Описание * <em class="pub-field-hint">форматирование как в Steam</em></span>
                <div class="pub-rte" id="sg-rte">
                  <div class="pub-rte-toolbar" role="toolbar" aria-label="Форматирование">
                    <button type="button" class="pub-rte-btn" data-cmd="bold" title="Жирный"><b>B</b></button>
                    <button type="button" class="pub-rte-btn" data-cmd="italic" title="Курсив"><i>I</i></button>
                    <button type="button" class="pub-rte-btn" data-cmd="underline" title="Подчёркнутый"><u>U</u></button>
                    <span class="pub-rte-sep"></span>
                    <button type="button" class="pub-rte-btn" data-cmd="formatBlock" data-val="h2" title="Заголовок">H2</button>
                    <button type="button" class="pub-rte-btn" data-cmd="formatBlock" data-val="h3" title="Подзаголовок">H3</button>
                    <button type="button" class="pub-rte-btn" data-cmd="formatBlock" data-val="p" title="Абзац">¶</button>
                    <span class="pub-rte-sep"></span>
                    <button type="button" class="pub-rte-btn" data-cmd="insertUnorderedList" title="Список">• List</button>
                    <button type="button" class="pub-rte-btn" data-cmd="insertOrderedList" title="Нумерация">1. List</button>
                    <button type="button" class="pub-rte-btn" data-cmd="indent" title="Отступ →">→</button>
                    <button type="button" class="pub-rte-btn" data-cmd="outdent" title="Отступ ←">←</button>
                    <span class="pub-rte-sep"></span>
                    <button type="button" class="pub-rte-btn" data-cmd="createLink" title="Ссылка">🔗</button>
                    <button type="button" class="pub-rte-btn" data-cmd="insertHorizontalRule" title="Линия">―</button>
                    <button type="button" class="pub-rte-btn" data-cmd="removeFormat" title="Сбросить стиль">✕</button>
                    <span class="pub-rte-sep"></span>
                    <button type="button" class="pub-rte-btn" data-cmd="insertShot" title="Вставить скриншот">🖼 Скрин</button>
                  </div>
                  <div class="pub-rte-editor auth-input" id="sg-desc-editor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Подробное описание игры…"></div>
                  <textarea class="hidden" name="description" id="sg-desc" required></textarea>
                </div>
              </div>
            </div>
          </section>

          <section class="pub-section">
            <div class="pub-section-head">
              <span class="pub-section-ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></span>
              <h3>Медиа</h3>
            </div>
            <div class="pub-media-grid">
              <div class="pub-file-card" data-for="sg-cover">
                <div class="pub-file-preview" id="sg-cover-preview"><span>Обложка *</span></div>
                <label class="pub-file-btn" for="sg-cover">Выбрать файл</label>
                <input type="file" name="cover" id="sg-cover" class="pub-file-input" accept="image/*" />
                <div class="pub-file-name" id="sg-cover-name">PNG / JPG, 600×900</div>
              </div>
              <div class="pub-file-card" data-for="sg-banner">
                <div class="pub-file-preview pub-file-preview--wide" id="sg-banner-preview"><span>Баннер / шапка</span></div>
                <label class="pub-file-btn" for="sg-banner">Выбрать файл</label>
                <input type="file" name="banner" id="sg-banner" class="pub-file-input" accept="image/*" />
                <div class="pub-file-name" id="sg-banner-name">Широкий баннер</div>
              </div>
              <div class="pub-file-card" data-for="sg-logo">
                <div class="pub-file-preview pub-file-preview--logo" id="sg-logo-preview"><span>Логотип</span></div>
                <label class="pub-file-btn" for="sg-logo">Выбрать файл</label>
                <input type="file" name="logo" id="sg-logo" class="pub-file-input" accept="image/*" />
                <div class="pub-file-name" id="sg-logo-name">Прозрачный PNG</div>
              </div>
              <div class="pub-file-card" data-for="sg-icon">
                <div class="pub-file-preview pub-file-preview--icon" id="sg-icon-preview"><span>Иконка</span></div>
                <label class="pub-file-btn" for="sg-icon">Выбрать файл</label>
                <input type="file" name="icon" id="sg-icon" class="pub-file-input" accept="image/*" />
                <div class="pub-file-name" id="sg-icon-name">Квадрат 256×256</div>
              </div>
            </div>
            <div class="settings-label full" style="margin-top:12px">
              <span>Скриншоты</span>
              <div class="pub-shots-row">
                <label class="pub-file-btn" for="sg-shots">Выбрать скриншоты</label>
                <input type="file" name="screenshots[]" id="sg-shots" class="pub-file-input" accept="image/*" multiple />
                <div class="pub-shots-preview" id="sg-shots-preview"></div>
              </div>
            </div>
            <div class="settings-label full" id="sg-trailers-wrap" style="margin-top:10px"></div>
            <input type="hidden" name="cover_url" id="sg-cover-url" />
              <input type="hidden" name="screenshot_urls" id="sg-screenshots-urls" />
              <input type="hidden" name="icon_url" id="sg-icon-url" />
              <input type="hidden" name="logo_url" id="sg-logo-url" />
            <input type="hidden" name="banner_url" id="sg-banner-url" />
          </section>

          <section class="pub-section">
            <div class="pub-section-head">
              <span class="pub-section-ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg></span>
              <h3>Системные требования</h3>
            </div>
            <div class="settings-label full">
              <span>Минимальные</span>
              <div class="sysreq-fields" id="sg-sys-min-fields">
                <input class="auth-input" data-k="os" placeholder="ОС" />
                <input class="auth-input" data-k="processor" placeholder="Процессор" />
                <input class="auth-input" data-k="memory" placeholder="Оперативная память" />
                <input class="auth-input" data-k="gpu" placeholder="Видеокарта" />
                <input class="auth-input" data-k="directx" placeholder="DirectX" />
                <input class="auth-input" data-k="storage" placeholder="Место на диске" />
                <input class="auth-input" data-k="sound" placeholder="Звуковая карта" />
                <input class="auth-input" data-k="other" placeholder="Дополнительно" />
              </div>
            </div>
            <div class="settings-label full" style="margin-top:10px">
              <span>Рекомендуемые</span>
              <div class="sysreq-fields" id="sg-sys-rec-fields">
                <input class="auth-input" data-k="os" placeholder="ОС" />
                <input class="auth-input" data-k="processor" placeholder="Процессор" />
                <input class="auth-input" data-k="memory" placeholder="Оперативная память" />
                <input class="auth-input" data-k="gpu" placeholder="Видеокарта" />
                <input class="auth-input" data-k="directx" placeholder="DirectX" />
                <input class="auth-input" data-k="storage" placeholder="Место на диске" />
                <input class="auth-input" data-k="sound" placeholder="Звуковая карта" />
                <input class="auth-input" data-k="other" placeholder="Дополнительно" />
              </div>
            </div>
          </section>

          <section class="pub-section">
            <div class="pub-section-head">
              <span class="pub-section-ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></span>
              <h3>Языки и управление</h3>
            </div>
            <div class="settings-label full">
              <span>Поддержка контроллеров</span>
              <div class="submit-checks">
                <label class="settings-check"><input type="checkbox" value="xbox" class="sg-ctrl" /> Xbox</label>
                <label class="settings-check"><input type="checkbox" value="playstation" class="sg-ctrl" /> PlayStation</label>
                <label class="settings-check"><input type="checkbox" value="switch" class="sg-ctrl" /> Switch</label>
                <label class="settings-check"><input type="checkbox" value="keyboard" class="sg-ctrl" /> Клавиатура</label>
              </div>
            </div>
            <div class="settings-label full">
              <span>Языки</span>
              <div class="lang-table" id="sg-lang-table">
                <div class="lang-table-head"><span>Язык</span><span>Субтитры</span><span>Аудио</span></div>
              </div>
            </div>
          </section>

          <section class="pub-section" id="sg-builds-section">
            <div class="pub-section-head">
              <span class="pub-section-ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></span>
              <h3>Сборка и файл</h3>
            </div>
            <p class="pub-hint">Укажите версию, кратко что нового и прикрепите файл (zip/exe). Без этого на модерацию не отправится.</p>
            <div class="ws-ff" style="margin-bottom:10px">
              <span>Версия *</span>
              <input type="text" class="auth-input" id="sg-build-version" name="build_version" placeholder="1.0.0" maxlength="32" />
            </div>
            <div class="ws-ff" style="margin-bottom:10px">
              <span>Что нового</span>
              <input type="text" class="auth-input" id="sg-build-changelog" name="build_changelog" placeholder="Кратко об изменениях…" maxlength="500" />
            </div>
            <div class="ws-ff" style="margin-bottom:10px">
              <span>Файл *</span>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <label class="pub-file-btn" for="sg-build-file">Выбрать файл</label>
                <input type="file" id="sg-build-file" class="pub-file-input" name="build_file" accept=".exe,.zip,.7z,.rar,.msi,.dmg,.appimage,.tar,.gz" hidden />
                <span class="settings-hint" id="sg-build-file-name">ZIP / EXE / 7z…</span>
              </div>
              <div id="sg-build-existing" class="settings-hint" style="display:none;margin-top:8px"></div>
            </div>
          </section>

          <section class="pub-section">
            <div class="pub-section-head">
              <span class="pub-section-ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
              <h3>Специфический контент</h3>
            </div>
            <p class="pub-hint">Отметьте, если в игре есть возрастной или чувствительный материал</p>
            <div class="pub-content-flags">
              <label class="pub-flag"><input type="checkbox" class="sg-content-flag" value="adult" id="sg-adult" /><span>18+ / для взрослых</span></label>
              <label class="pub-flag"><input type="checkbox" class="sg-content-flag" value="violence" /><span>Насилие</span></label>
              <label class="pub-flag"><input type="checkbox" class="sg-content-flag" value="gore" /><span>Жестокость / кровь</span></label>
              <label class="pub-flag"><input type="checkbox" class="sg-content-flag" value="drugs" /><span>Наркотики / алкоголь</span></label>
              <label class="pub-flag"><input type="checkbox" class="sg-content-flag" value="language" /><span>Ненормативная лексика</span></label>
              <label class="pub-flag"><input type="checkbox" class="sg-content-flag" value="horror" /><span>Хоррор / пугающий контент</span></label>
              <label class="pub-flag"><input type="checkbox" class="sg-content-flag" value="gambling" /><span>Азартные механики</span></label>
              <label class="pub-flag"><input type="checkbox" class="sg-content-flag" value="prohibited" /><span>Запрещённые темы</span></label>
            </div>
          </section>

        </form>
      </div>
            <div class="submit-modal-foot" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div style="display:flex;gap:8px;align-items:center">
          <input type="file" id="sg-import-pack" accept=".zip,application/zip" hidden />
          <button type="button" class="hp-btn-edit" id="sg-import-pack-btn" title="Импорт ZIP-пакета игры">Импорт</button>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-left:auto">
          <button type="button" class="hp-btn-edit" data-close="form">Отмена</button>
          <button type="button" class="hp-btn-edit" id="submit-game-send">Отправить на модерацию</button>
        </div>
      </div>
    </div>
  </div>


<div class="submit-modal hidden" id="submit-done-modal">
    <div class="submit-modal-backdrop" data-close="done"></div>
    <div class="submit-modal-box">
      <div class="submit-modal-body" style="text-align:center;padding:32px 20px">
        <div class="chat-empty-icon" style="margin:0 auto 12px">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        </div>
        <h2 class="chat-empty-title">Игра отправлена на рассмотрение</h2>
        <p class="chat-empty-sub">Спасибо! Администраторы проверят материалы и опубликуют игру или свяжутся с вами.</p>
        <button type="button" class="auth-submit" data-close="done" style="margin-top:16px">Отлично</button>
      </div>
    </div>
  </div>


  <!-- ===== 18+ GATE ===== -->
  <div class="adult-gate hidden" id="adult-gate-modal">
    <div class="adult-gate-backdrop"></div>
    <div class="adult-gate-box" role="dialog" aria-modal="true">
      <div class="adult-gate-head">
        <h2>Эта игра содержит неприемлемый контент</h2>
        <button type="button" class="friends-modal-close" id="adult-gate-x" aria-label="Закрыть">×</button>
      </div>
      <div class="adult-gate-body">
        <p><strong id="adult-gate-title">Игра</strong> содержит контент, который может не подходить для всех возрастов. Вы уверены, что хотите продолжить?</p>
      </div>
      <div class="adult-gate-foot">
        <button type="button" class="adult-gate-back" id="adult-gate-back">Назад</button>
        <button type="button" class="adult-gate-continue" id="adult-gate-continue">Продолжить</button>
      </div>
    </div>
  </div>

  <!-- ===== АДМИН: РЕДАКТИРОВАНИЕ ПОЛЬЗОВАТЕЛЯ ===== -->
  <div class="submit-modal hidden" id="admin-user-modal">
    <div class="submit-modal-backdrop" data-close-admin-user></div>
    <div class="submit-modal-box submit-modal-wide" role="dialog" aria-modal="true">
      <div class="submit-modal-head">
        <h2>Редактирование пользователя</h2>
        <button type="button" class="friends-modal-close" id="admin-user-close" aria-label="Закрыть">×</button>
      </div>
      <div class="submit-modal-body" id="admin-user-body">
        <input type="hidden" id="admin-user-id" value="" />
        <label class="settings-label"><span>Ник</span><input type="text" id="admin-user-name" maxlength="32" /></label>
        <label class="settings-label"><span>Роль</span>
          <select id="admin-user-role">
            <option value="user">user</option>
            <option value="developer">developer</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <label class="settings-label"><span>Баланс</span><input type="number" id="admin-user-balance" min="0" step="1" /></label>
        <label class="settings-label"><span>Карма</span><input type="number" id="admin-user-karma" step="1" /></label>
        <label class="settings-label"><span>Цвет аватара</span><input type="color" id="admin-user-color" value="#ef5b2c" /></label>
        <div class="admin-user-media-row">
          <label class="settings-label"><span>Новый аватар</span><input type="file" id="admin-user-avatar" accept="image/*" /></label>
          <label class="settings-label"><span>Новая шапка</span><input type="file" id="admin-user-banner" accept="image/*" /></label>
        </div>
        <hr class="admin-user-hr" />
        <h3 class="admin-user-ban-title">Бан</h3>
        <label class="settings-label"><span>Причина бана</span><input type="text" id="admin-user-ban-reason" placeholder="Нарушение правил…" /></label>
        <label class="settings-label"><span>Срок (дней, 0 = навсегда)</span><input type="number" id="admin-user-ban-days" min="0" value="0" /></label>
        <div class="admin-user-actions">
          <button type="button" class="auth-submit" id="admin-user-save">Сохранить</button>
          <button type="button" class="btn-danger" id="admin-user-ban">Забанить</button>
          <button type="button" class="hp-btn-edit" id="admin-user-unban">Разбанить</button>
        </div>
        <p class="comment-hint" id="admin-user-status"></p>
      </div>
    </div>
  </div>

  <?php if ($banInfo): ?>
  <!-- ===== ЭКРАН БАНА ===== -->
  <div class="ban-screen" id="ban-screen">
    <div class="ban-screen-inner">
      <div class="ban-logo">🐱</div>
      <h1 class="ban-title">Котик в тебе разочарован</h1>
      <p class="ban-sub">Твой доступ к CATio ограничен.</p>
      <div class="ban-card">
        <div class="ban-row"><span>Причина</span><b><?php echo htmlspecialchars($banInfo['reason'], ENT_QUOTES, 'UTF-8'); ?></b></div>
        <div class="ban-row"><span>Кто забанил</span><b><?php echo htmlspecialchars($banInfo['banned_by_name'] ?: 'Администратор', ENT_QUOTES, 'UTF-8'); ?></b></div>
        <div class="ban-row"><span>Срок</span><b><?php
          if (!empty($banInfo['banned_until'])) {
            echo 'до ' . htmlspecialchars(date('d.m.Y H:i', strtotime($banInfo['banned_until'])), ENT_QUOTES, 'UTF-8');
          } else {
            echo 'навсегда';
          }
        ?></b></div>
      </div>
      <a class="ban-back-btn" href="?view=auth&logout=1<?php echo $isClient ? '&amp;client=1' : ''; ?>" id="ban-back-auth">Вернуться к авторизации</a>
    </div>
  </div>
  <style>
    #app, .topbar, .sidebar { display: none !important; }
  </style>
  <?php endif; ?>


  <?php if (!empty($unbanNotice)): ?>
  <!-- ===== ЭКРАН РАЗБАНА ===== -->
  <div class="ban-screen unban-screen" id="unban-screen">
    <div class="ban-screen-inner">
      <div class="ban-logo">😺</div>
      <h1 class="ban-title">Котик милостливый пожалел тебя</h1>
      <p class="ban-sub">Больше не ссы мимо лотка.<br>Вы были разблокированы.</p>
      <button type="button" class="ban-back-btn" id="unban-continue-btn">Продолжить</button>
    </div>
  </div>
  <style>
    #app, .topbar, .sidebar { display: none !important; }
  </style>
  <script>
  document.getElementById('unban-continue-btn')?.addEventListener('click', async () => {
    try {
      await fetch('api/admin.php?action=dismiss_unban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ csrf_token: window.CSRF_TOKEN || '' })
      });
    } catch (e) {}
    const client = <?php echo $isClient ? 'true' : 'false'; ?>;
    window.location.href = client ? '?view=home&client=1' : '?view=home';
  });
  </script>
  <?php endif; ?>


  <div class="submit-modal hidden" id="privacy-modal">
    <div class="submit-modal-backdrop" data-close-privacy></div>
    <div class="submit-modal-box privacy-modal-box">
      <div class="submit-modal-head">
        <h2>Лицензионное соглашение</h2>
        <button type="button" class="pub-modal-close" id="privacy-modal-close" aria-label="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="submit-modal-body privacy-modal-body">
        <div class="privacy-hero">
          <div class="privacy-hero-ico">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <div>
            <div class="privacy-hero-title">CATio — защита ваших данных</div>
            <div class="privacy-hero-sub">Кратко о том, что мы собираем и зачем</div>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#ef5b2c">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <div>
            <h4>Какие данные</h4>
            <p>Имя пользователя, e-mail, данные сессии, сведения о библиотеке и покупках — только то, что нужно для аккаунта.</p>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#6ea8fe">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>
          </div>
          <div>
            <h4>Зачем это нужно</h4>
            <p>Вход в аккаунт, безопасность, библиотека игр, уведомления и работа сервиса. Без лишней аналитики «для рекламы».</p>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#6fdf8b">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <div>
            <h4>Кому передаём</h4>
            <p>Третьим лицам — только по закону или с вашего согласия. Мы не продаём персональные данные.</p>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#f0c14b">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
          </div>
          <div>
            <h4>Ваши права</h4>
            <p>Можно запросить уточнение или удаление данных — напишите администрации CATio.</p>
          </div>
        </div>
      </div>
    </div>
  </div>

<!-- Модалка оформления игры (как Hydra) -->
<div id="steam-import-modal" class="sgdb-modal hidden" aria-hidden="true">
  <div class="sgdb-modal-backdrop" data-close-steam-modal></div>
  <div class="sgdb-modal-card" role="dialog" aria-modal="true">
    <div class="sgdb-modal-head">
      <h3 id="sgdb-modal-title">Игра</h3>
      <button type="button" class="sgdb-modal-close" data-close-steam-modal aria-label="Закрыть">×</button>
    </div>
    <div class="sgdb-modal-body">
      <aside class="sgdb-nav">
        <button type="button" class="sgdb-nav-btn" data-sgdb-tab="main">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          Основные
        </button>
        <button type="button" class="sgdb-nav-btn" data-sgdb-tab="path">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          Расположение
        </button>
        <button type="button" class="sgdb-nav-btn active" data-sgdb-tab="assets">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          Настройка
        </button>
        <button type="button" class="sgdb-nav-btn" data-sgdb-tab="downloads">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Загрузки
        </button>
        <button type="button" class="sgdb-nav-btn sgdb-nav-danger" data-sgdb-tab="danger">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Опасная зона
        </button>
      </aside>
      <div class="sgdb-content">
        <div class="sgdb-pane" data-sgdb-pane="main">
          <div class="sgdb-pane-title">Основные</div>
          <div class="sgdb-info-grid">
            <div class="sgdb-info-row"><span>Название</span><b id="sgdb-info-title">—</b></div>
            <div class="sgdb-info-row"><span>App ID</span><b id="sgdb-info-appid">—</b></div>
            <div class="sgdb-info-row"><span>ID в CATio</span><b id="sgdb-info-id">—</b></div>
          </div>
          <p class="settings-hint">Ссылку Steam для импорта используй в админке → Загрузка игр. Здесь только оформление уже добавленной игры.</p>
        </div>
        <div class="sgdb-pane" data-sgdb-pane="path">
          <div class="sgdb-pane-title">Расположение</div>
          <div class="sgdb-placeholder">
            <p>Путь к исполняемому файлу и папке игры</p>
            <p class="settings-hint">В разработке</p>
          </div>
        </div>
        <div class="sgdb-pane active" data-sgdb-pane="assets">
          <div class="sgdb-asset-tabs">
            <button type="button" class="sgdb-asset-tab active" data-asset-type="icons">Иконка</button>
            <button type="button" class="sgdb-asset-tab" data-asset-type="logos">Логотип</button>
            <button type="button" class="sgdb-asset-tab" data-asset-type="heroes">Баннер</button>
            <button type="button" class="sgdb-asset-tab" data-asset-type="grids">Обложка</button>
          </div>
          <div class="sgdb-asset-preview-wrap">
            <div class="sgdb-asset-preview checker" id="sgdb-asset-preview">
              <img id="sgdb-asset-preview-img" src="" alt="" />
            </div>
          </div>
          <p class="sgdb-warn">⚠ Ваши пользовательские изображения не будут синхронизированы с вашей учётной записью.</p>
          <div class="sgdb-source-label">CATioGridDB</div>
          <div class="sgdb-asset-scroll">
            <div id="sgdb-asset-grid" class="sgdb-asset-grid">
              <div class="settings-hint">Загрузка…</div>
            </div>
          </div>
          <input type="hidden" id="steam-sel-icon" />
          <input type="hidden" id="steam-sel-logo" />
          <input type="hidden" id="steam-sel-banner" />
          <input type="hidden" id="steam-sel-cover" />
          <div class="sgdb-asset-savebar">
            <span class="sgdb-asset-save-hint" id="sgdb-asset-save-hint">Выбери ассеты и нажми сохранить</span>
            <button type="button" class="auth-submit sgdb-asset-save-btn" id="sgdb-asset-save">Сохранить</button>
          </div>
        </div>
        <div class="sgdb-pane" data-sgdb-pane="downloads">
          <div class="sgdb-pane-title">Загрузки</div>
          <div class="sgdb-placeholder">
            <p>Нет активных загрузок</p>
            <p class="settings-hint">В разработке</p>
          </div>
        </div>
        <div class="sgdb-pane" data-sgdb-pane="danger">
          <div class="sgdb-pane-title">Опасная зона</div>
          <div class="sgdb-placeholder">
            <p>Удаление игры из каталога и сброс локальных файлов</p>
            <p class="settings-hint">В разработке</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ===== Модалка установки игры ===== -->
<div class="submit-modal hidden" id="install-modal">
  <div class="submit-modal-backdrop" data-close-install></div>
  <div class="submit-modal-box" style="max-width:440px">
    <div class="submit-modal-head">
      <h2>Установить</h2>
      <button type="button" class="pub-modal-close" data-close-install aria-label="Закрыть">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="submit-modal-body">
      <div class="install-game-row">
        <div class="install-game-cover" id="install-cover"></div>
        <div class="install-game-meta">
          <div class="install-game-title" id="install-title">Игра</div>
          <div class="install-game-size" id="install-size">—</div>
        </div>
      </div>
      <label class="ws-ff" style="margin-top:14px">
        <span>Версия</span>
        <select class="settings-select" id="install-version" style="width:100%"></select>
      </label>
      <p class="settings-hint" style="margin-top:10px">Файлы: AppData\Roaming\CATio\games\…</p>
    </div>
    <div class="submit-modal-foot">
      <button type="button" class="hp-btn-edit" data-close-install>Отмена</button>
      <button type="button" class="hp-btn-edit" id="install-confirm" style="background:var(--accent);color:#12110e;border-color:var(--accent)">Установить</button>
    </div>
  </div>
</div>

</body>
</html>
