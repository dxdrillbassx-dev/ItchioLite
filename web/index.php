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
if (!$isAuthorized && in_array($currentView, ['library', 'downloads', 'profile', 'settings'], true)) {
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
          <span class="side-avatar" id="side-avatar" style="<?php echo avatarStyleAttr($avatarUrl, $avatarColor, (int)($user['id'] ?? 0)); ?>"><?php echo $avatarUrl ? '' : htmlspecialchars($avatarText); ?></span>
          <span class="side-user-name"><?php echo htmlspecialchars($user['username']); ?></span>
          <span class="side-user-arrow">▾</span>
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
          
          <button type="button" class="user-menu-item menu-friends-btn"><svg class="menu-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> Друзья <span class="menu-badge friends-menu-badge hidden">0</span></button>
          <button type="button" class="user-menu-item" id="menu-profile"><svg class="menu-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Профиль</button>
          <button type="button" class="user-menu-item" id="menu-downloads"><svg class="menu-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Загрузки</button>
          <button type="button" class="user-menu-item" id="menu-settings"><svg class="menu-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg> Настройки</button>
          <button type="button" class="user-menu-item danger" id="menu-logout"><svg class="menu-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Выйти</button>
        </div>
      </div>

      <nav class="side-nav">
        <button type="button" class="nav-btn side-btn <?php echo $currentView === 'home' ? 'active' : ''; ?>" data-view="home"><span class="side-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></span>Главная</button>
        <button type="button" class="nav-btn side-btn <?php echo $currentView === 'store' ? 'active' : ''; ?>" data-view="store"><span class="side-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></span>Каталог</button>
        <?php if ($isClient): ?>
        <button type="button" class="nav-btn side-btn <?php echo $currentView === 'library' ? 'active' : ''; ?>" data-view="library"><span class="side-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></span>Библиотека</button>
        <?php endif; ?>
        <button type="button" class="nav-btn side-btn <?php echo $currentView === 'downloads' ? 'active' : ''; ?>" data-view="downloads"><span class="side-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></span>Загрузки<span class="nav-badge hidden" id="downloads-badge">0</span></button>
        <button type="button" class="nav-btn side-btn <?php echo $currentView === 'settings' ? 'active' : ''; ?>" data-view="settings"><span class="side-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg></span>Настройки</button>
        <?php if ($isAuthorized && ($user['role'] ?? '') === 'admin'): ?>
        <button type="button" class="nav-btn side-btn <?php echo $currentView === 'admin' ? 'active' : ''; ?>" data-view="admin"><span class="side-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>Админка</button>
        <?php endif; ?>
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

      <div class="side-foot">
        <span id="side-dl-status">Нет активных загрузок</span>
        <span class="side-ver">CATio</span>
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
        <?php if ($isAuthorized): ?>
        <button class="nav-btn <?php echo $currentView === 'profile' ? 'active' : ''; ?>" data-view="profile"><?php echo htmlspecialchars(strtoupper($user['username'])); ?></button>
        <?php endif; ?>
      </nav>
      <div class="user-area">
        <?php if ($isAuthorized): ?>
        <div class="avatar-wrap">
          <button type="button" class="avatar" id="avatar-btn" aria-haspopup="true" aria-expanded="false" style="<?php echo avatarStyleAttr($avatarUrl, $avatarColor, (int)($user['id'] ?? 0)); ?>"><?php echo $avatarUrl ? '' : htmlspecialchars($avatarText); ?></button>
          <div class="user-menu hidden" id="user-menu" role="menu">
            <div class="user-menu-head">
              <div class="user-menu-name"><?php echo htmlspecialchars($user['username']); ?></div>
              <div class="user-menu-mail"><?php echo htmlspecialchars($user['email']); ?></div>
            </div>
            <div class="user-menu-balance">
              <span>Баланс</span>
              <b id="user-balance"><?php echo number_format($user['balance'], 0, ',', ' '); ?> ₽</b>
            </div>
            <button type="button" class="user-menu-item menu-friends-btn"><svg class="menu-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> Друзья <span class="menu-badge friends-menu-badge hidden">0</span></button>
          <button type="button" class="user-menu-item" id="menu-profile"><svg class="menu-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Профиль</button>
            <button type="button" class="user-menu-item" id="menu-downloads"><svg class="menu-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Загрузки</button>
            <button type="button" class="user-menu-item" id="menu-settings"><svg class="menu-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg> Настройки</button>
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
<button type="button" class="head-back" id="head-back" title="Назад">←</button>
        <h1 class="head-title" id="head-title">Главная</h1>
        <div class="head-search" id="head-search">
          <input type="text" id="head-search-input" placeholder="Поиск" aria-label="Поиск по вкладке" />
          <button type="button" class="head-add-game" id="btn-add-game" title="Добавить игру" onclick="if(window.openSubmitRules){openSubmitRules();}else{alert('Скрипт ещё не загрузился');}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
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
            <h2 class="home-hero-title" id="home-hero-title"></h2>
            <p class="home-hero-desc" id="home-hero-desc"></p>
          </div>
        </div>

        <div class="home-pills" id="home-pills">
          <button type="button" class="home-pill active" data-hsort="popular">🔥 Сейчас популярно</button>
          <button type="button" class="home-pill" data-hsort="week">📈 Лучшие игры недели</button>
          <button type="button" class="home-pill" data-hsort="new">✨ Новинки</button>
          <button type="button" class="home-pill surprise" id="home-surprise">🎲 Удиви меня</button>
        </div>

        <h2 class="home-section-title" id="home-section-title">🔥 Сейчас популярно</h2>
        <div class="home-grid" id="home-grid"><div class="loading">Загрузка...</div></div>
      </section>

      <!-- ===== КАТАЛОГ (сетка/список + фильтры справа, как в Hydra) ===== -->
      <section id="view-store" class="view <?php echo $currentView === 'store' ? 'active' : ''; ?>">
        <div class="store-layout">
          <div class="store-main">
            <div class="store-head">
              <div class="store-count-line">
                <b id="store-count">0</b> результатов
                <span class="store-hint">Фильтры справа · поиск в шапке</span>
              </div>
              <div class="store-head-actions">
                <div class="store-view-toggle" role="group" aria-label="Вид каталога">
                  <button type="button" class="store-view-btn active" data-mode="list" title="Список" aria-pressed="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
                  </button>
                  <button type="button" class="store-view-btn" data-mode="grid" title="Сетка" aria-pressed="false">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                  </button>
                </div>
                <label class="sort-label">
                  Сортировать по
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
            <div id="store-list" class="store-list" data-mode="list"><div class="loading">Загрузка каталога...</div></div>
          </div>

          <aside class="store-filters">
            <div class="filter-block filter-block-price">
              <button type="button" class="filter-block-head">
                <span class="filter-dot" style="background:#ef5b2c"></span>
                Цена
              </button>
              <div class="filter-block-body">
                <div class="filter-price-pills" id="price-pills">
                  <button type="button" class="price-pill active" data-price="all">Все</button>
                  <button type="button" class="price-pill" data-price="free">Бесплатные</button>
                  <button type="button" class="price-pill" data-price="paid">Платные</button>
                </div>
              </div>
            </div>
            <div class="filter-block">
              <button type="button" class="filter-block-head">
                <span class="filter-dot" style="background:#a78bfa"></span>
                Жанры
                <span class="filter-count" id="genre-count"></span>
              </button>
              <div class="filter-block-body">
                <input type="text" class="filter-search" id="genre-filter-search" placeholder="Фильтр..." />
                <div class="filter-opts" id="genre-opts"></div>
              </div>
            </div>
            <div class="filter-block">
              <button type="button" class="filter-block-head">
                <span class="filter-dot" style="background:#f472b6"></span>
                Разработчики
                <span class="filter-count" id="dev-count"></span>
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
                </div>
              </div>
            </div>

            <!-- Кнопки под баннером (blur поверх того же фона) -->
            <div class="hp-toolbar">
              <div class="hp-toolbar-spacer"></div>
              <button type="button" class="hp-btn-edit" id="btn-edit-profile">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Редактировать Профиль
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
                  <button type="button" class="hp-side-toggle" aria-label="Свернуть">▴</button>
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
                  <button type="button" class="hp-side-toggle" aria-label="Свернуть">▴</button>
                </div>
                <div class="hp-side-body" id="hp-activity">
                  <div class="loading">Загрузка...</div>
                </div>
              </div>

              <div class="hp-side-card" id="hp-friends-card">
                <div class="hp-side-head">
                  <span>Друзья <span class="hp-count" id="hp-friends-count">0</span></span>
                  <button type="button" class="hp-side-toggle" aria-label="Свернуть">▴</button>
                </div>
                <div class="hp-side-body" id="hp-friends-list">
                  <div class="loading">Загрузка...</div>
                </div>
              </div>
            </aside>
          </div>
        </div>

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
                <button type="button" class="hp-edit-save" id="hp-banner-save">Сохранить</button>
              </div>
              <input type="file" id="hp-banner-file-modal" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
            </div>
          </div>
        </div>

      </section>

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

              <div class="settings-avatar-block">
                <div class="settings-avatar-preview" id="settings-avatar-preview" style="<?php echo avatarStyleAttr($avatarUrl, $avatarColor, (int)($user['id'] ?? 0)); ?>"><?php echo $avatarUrl ? '' : htmlspecialchars($avatarText); ?></div>
                <div class="settings-avatar-actions">
                  <button type="button" class="hp-btn-edit" id="settings-avatar-upload">Загрузить аватар</button>
                </div>
                <input type="file" id="settings-avatar-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
              </div>

              <label class="settings-label">
                <span>Отображаемое имя</span>
                <input type="text" id="settings-username" class="auth-input" maxlength="32" value="<?php echo htmlspecialchars($user['username'] ?? ''); ?>" />
              </label>

              <label class="settings-label">
                <span>Баннер профиля</span>
                <div class="settings-banner-row">
                  <div class="settings-banner-preview" id="settings-banner-preview" <?php if (!empty($user['banner_url'])): ?>style="background-image:url('<?php echo htmlspecialchars($user['banner_url'], ENT_QUOTES); ?>')"<?php endif; ?>></div>
                  <button type="button" class="hp-btn-edit" id="settings-banner-upload">Загрузить баннер</button>
                  <input type="file" id="settings-banner-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
                </div>
              </label>

              <label class="settings-label">
                <span>Язык</span>
                <select id="settings-lang" class="settings-select">
                  <option value="ru" selected>Русский</option>
                </select>
              </label>

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
      <?php if ($isAuthorized && ($user['role'] ?? '') === 'admin'): ?>
      <section id="view-admin" class="view <?php echo $currentView === 'admin' ? 'active' : ''; ?>">
        <div class="settings-layout admin-settings-layout">
          <aside class="settings-nav" id="admin-nav">
            <button type="button" class="settings-nav-btn active" data-atab="moderation">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Модерация
            </button>
            <button type="button" class="settings-nav-btn" data-atab="users">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Пользователи
            </button>
            <button type="button" class="settings-nav-btn" data-atab="import">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Загрузка игр
            </button>
          </aside>

          <div class="settings-main">
            <div class="settings-pane" id="admin-pane-moderation">
              <h2 class="settings-title">Модерация</h2>
              <p class="settings-desc">Игры, отправленные пользователями на проверку.</p>
              <div class="admin-layout">
                <div class="admin-list-panel">
                  <div id="admin-pending-list" class="admin-pending-list">
                    <div class="loading">Загрузка...</div>
                  </div>
                </div>
                <div class="admin-edit-panel" id="admin-edit-panel">
                  <div class="admin-placeholder" id="admin-empty">
                    <p>Выберите игру слева</p>
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
                    <div class="settings-grid">
                      <label class="settings-label"><span>Новая обложка</span><input type="file" id="admin-cover" accept="image/*" /></label>
                      <label class="settings-label"><span>Новый баннер</span><input type="file" id="admin-banner" accept="image/*" /></label>
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
<div class="settings-pane hidden" id="admin-pane-import">
              <h2 class="settings-title">Загрузка игр</h2>
              <p class="settings-desc">Вставь ссылку на страницу Steam Store — подтянем название, описание, шапку, обложку, скриншоты и трейлер.</p>
              <div class="settings-block steam-import-box">
                <label class="settings-label full">
                  <span>Ссылка Steam или AppID</span>
                  <div class="steam-import-row">
                    <input class="auth-input" id="steam-url" placeholder="https://store.steampowered.com/app/730/..." />
                    <button type="button" class="auth-submit" id="steam-preview-btn">Проверить</button>
                  </div>
                </label>
                <p class="settings-hint">Примеры: <code>https://store.steampowered.com/app/570</code> или просто <code>570</code></p>
                <div id="steam-import-error" class="gp-comment-error hidden"></div>
              </div>
              <div id="steam-preview" class="steam-preview hidden">
                <div class="steam-preview-hero">
                  <img id="steam-preview-banner" src="" alt="" />
                  <div class="steam-preview-hero-info">
                    <img id="steam-preview-cover" class="steam-preview-cover" src="" alt="" />
                    <div>
                      <h3 id="steam-preview-title"></h3>
                      <p id="steam-preview-meta" class="settings-hint"></p>
                    </div>
                  </div>
                </div>
                <p id="steam-preview-short" class="steam-preview-short"></p>
                <div id="steam-preview-shots" class="steam-preview-shots"></div>
                <div class="settings-actions">
                  <label class="settings-check"><input type="checkbox" id="steam-publish" checked /> Сразу опубликовать</label>
                  <button type="button" class="auth-submit" id="steam-import-btn">Импортировать в CATio</button>
                </div>
              </div>
            </div>
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
  document.getElementById('privacy-open-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    const m = document.getElementById('privacy-modal');
    if (m) m.classList.remove('hidden');
  });
  document.getElementById('privacy-modal-close')?.addEventListener('click', () => {
    document.getElementById('privacy-modal')?.classList.add('hidden');
  });
  document.querySelector('[data-close-privacy]')?.addEventListener('click', () => {
    document.getElementById('privacy-modal')?.classList.add('hidden');
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
        <div class="friends-tabs">
          <button type="button" class="friends-tab active" data-ftab="friends">Друзья</button>
          <button type="button" class="friends-tab" data-ftab="notifications">Уведомления <span class="friends-tab-badge hidden" id="notif-tab-badge">0</span></button>
        </div>
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


  <!-- ===== МОДАЛКА ПРАВИЛ ПУБЛИКАЦИИ ===== -->
  <div class="submit-modal hidden" id="submit-rules-modal">
    <div class="submit-modal-backdrop" data-close="rules"></div>
    <div class="submit-modal-box">
      <div class="submit-modal-head">
        <h2>Правила публикации</h2>
        <button type="button" class="friends-modal-close" data-close="rules">×</button>
      </div>
      <div class="submit-modal-body">
        <ul class="submit-rules">
          <li>Загружайте только игры, на которые у вас есть права.</li>
          <li>Запрещены вредоносные файлы, кражи контента и NSFW без пометки.</li>
          <li>Обложка и описание должны соответствовать игре.</li>
          <li>После отправки игра проходит модерацию администратором.</li>
          <li>Админ может править материалы перед публикацией или отклонить заявку.</li>
        </ul>
        <label class="settings-check">
          <input type="checkbox" id="submit-agree" />
          Я согласен(на) с правилами публикации
        </label>
      </div>
      <div class="submit-modal-foot">
        <button type="button" class="hp-btn-edit" data-close="rules">Отмена</button>
        <button type="button" class="auth-submit" id="submit-rules-next" disabled>Дальше</button>
      </div>
    </div>
  </div>

  <!-- ===== МОДАЛКА АНКЕТЫ ИГРЫ ===== -->
  <div class="submit-modal hidden" id="submit-form-modal">
    <div class="submit-modal-backdrop" data-close="form"></div>
    <div class="submit-modal-box submit-modal-wide">
      <div class="submit-modal-head">
        <h2>Добавить игру</h2>
        <button type="button" class="friends-modal-close" data-close="form">×</button>
      </div>
      <div class="submit-modal-body">
        <form id="submit-game-form" class="submit-form">
          <div class="submit-grid">
            <label class="settings-label"><span>Название *</span><input class="auth-input" name="title" id="sg-title" required maxlength="120" /></label>
            <label class="settings-label"><span>Жанр *</span>
              <select class="settings-select" name="genre" id="sg-genre" required>
                <option value="">Выберите</option>
                <option>Экшен</option><option>Приключения</option><option>RPG</option>
                <option>Стратегия</option><option>Симулятор</option><option>Инди</option>
                <option>Хоррор</option><option>Гонки</option><option>Спорт</option><option>Другое</option>
              </select>
            </label>
            <label class="settings-label"><span>Цена (₽)</span><input class="auth-input" name="price" id="sg-price" type="number" min="0" value="0" /></label>
            <label class="settings-label full"><span>Краткое описание</span><input class="auth-input" name="short_description" id="sg-short" maxlength="200" /></label>
            <label class="settings-label full"><span>Описание *</span><textarea class="auth-input settings-textarea" name="description" id="sg-desc" rows="5" required></textarea></label>
            <label class="settings-label"><span>Обложка *</span><input type="file" name="cover" id="sg-cover" accept="image/*" required /></label>
            <label class="settings-label"><span>Шапка / баннер</span><input type="file" name="banner" id="sg-banner" accept="image/*" /></label>
            <label class="settings-label full"><span>Скриншоты</span><input type="file" name="screenshots[]" id="sg-shots" accept="image/*" multiple /></label>
            <label class="settings-label full"><span>Видео (YouTube URL)</span><input class="auth-input" name="video_url" id="sg-video" placeholder="https://youtube.com/..." /></label>
            <div class="settings-label full">
              <span>Системные требования — минимальные</span>
              <div class="sysreq-fields" id="sg-sys-min-fields">
                <input class="auth-input" data-k="os" placeholder="ОС *" />
                <input class="auth-input" data-k="cpu" placeholder="Процессор" />
                <input class="auth-input" data-k="ram" placeholder="Оперативная память" />
                <input class="auth-input" data-k="gpu" placeholder="Видеокарта" />
                <input class="auth-input" data-k="directx" placeholder="DirectX" />
                <input class="auth-input" data-k="storage" placeholder="Место на диске" />
                <input class="auth-input" data-k="sound" placeholder="Звуковая карта" />
                <input class="auth-input" data-k="other" placeholder="Дополнительно" />
              </div>
            </div>
            <div class="settings-label full">
              <span>Системные требования — рекомендуемые</span>
              <div class="sysreq-fields" id="sg-sys-rec-fields">
                <input class="auth-input" data-k="os" placeholder="ОС *" />
                <input class="auth-input" data-k="cpu" placeholder="Процессор" />
                <input class="auth-input" data-k="ram" placeholder="Оперативная память" />
                <input class="auth-input" data-k="gpu" placeholder="Видеокарта" />
                <input class="auth-input" data-k="directx" placeholder="DirectX" />
                <input class="auth-input" data-k="storage" placeholder="Место на диске" />
                <input class="auth-input" data-k="sound" placeholder="Звуковая карта" />
                <input class="auth-input" data-k="other" placeholder="Дополнительно" />
              </div>
            </div>
            <div class="settings-label full">
              <span>Поддержка контроллеров</span>
              <div class="submit-checks">
                <label class="settings-check"><input type="checkbox" value="xbox" class="sg-ctrl" /> Xbox</label>
                <label class="settings-check"><input type="checkbox" value="playstation" class="sg-ctrl" /> PlayStation</label>
              </div>
            </div>
            <div class="settings-label full">
              <span>Языки</span>
              <div class="lang-table" id="sg-lang-table">
                <div class="lang-table-head"><span>Язык</span><span>Субтитры</span><span>Аудио</span></div>
              </div>
            </div>
            <label class="settings-check full" style="margin-top:4px">
              <input type="checkbox" id="sg-adult" />
              Игра содержит контент 18+
            </label>
          </div>
        </form>
      </div>
      <div class="submit-modal-foot">
        <button type="button" class="hp-btn-edit" data-close="form">Отмена</button>
        <button type="button" class="auth-submit" id="submit-game-send">Отправить на модерацию</button>
      </div>
    </div>
  </div>

  <!-- ===== УСПЕХ ===== -->
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
    <div class="submit-modal-box">
      <div class="submit-modal-head">
        <h2>Обработка персональных данных</h2>
        <button type="button" class="friends-modal-close" id="privacy-modal-close" aria-label="Закрыть">×</button>
      </div>
      <div class="submit-modal-body" style="max-height:60vh;overflow:auto;font-size:0.9rem;line-height:1.5;color:var(--text)">
        <p>Регистрируясь в CATio, вы соглашаетесь на обработку персональных данных: имя пользователя, адрес электронной почты, технические данные сессии и сведения о библиотеке игр.</p>
        <p>Данные используются для работы аккаунта, безопасности и функционирования сервиса. Мы не передаём их третьим лицам без законного основания.</p>
        <p>Вы можете запросить удаление или уточнение данных, обратившись к администрации сервиса.</p>
      </div>
    </div>
  </div>
</body>
</html>
