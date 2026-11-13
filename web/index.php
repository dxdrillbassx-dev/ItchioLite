<?php
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';
if (function_exists('catio_send_security_headers')) { catio_send_security_headers(false); }
require_once __DIR__ . '/assets/icons/icon.php';
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
  <?php $assetVer = (string)max(@filemtime(__DIR__ . '/css/base.css') ?: 0, @filemtime(__DIR__ . '/css/game-library.css') ?: 0, @filemtime(__DIR__ . '/css/shell.css') ?: 0, @filemtime(__DIR__ . '/css/social.css') ?: 0, @filemtime(__DIR__ . '/css/game-extra.css') ?: 0, @filemtime(__DIR__ . '/css/cart-publish.css') ?: 0, @filemtime(__DIR__ . '/css/workshop-admin.css') ?: 0, @filemtime(__DIR__ . '/js/app.js') ?: 0, @filemtime(__DIR__ . '/js/game-actions.js') ?: 0, @filemtime(__DIR__ . '/js/game-comments.js') ?: 0, @filemtime(__DIR__ . '/js/workshop-assets.js') ?: 0, @filemtime(__DIR__ . '/js/admin-import.js') ?: 0, @filemtime(__DIR__ . '/js/gallery.js') ?: 0, @filemtime(__DIR__ . '/js/settings-ui.js') ?: 0, @filemtime(__DIR__ . '/js/publishers.js') ?: 0, @filemtime(__DIR__ . '/js/icons.js') ?: 0); ?>
  <link rel="stylesheet" href="css/base.css?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>">
  <link rel="stylesheet" href="css/game-library.css?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>">
  <link rel="stylesheet" href="css/shell.css?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>">
  <link rel="stylesheet" href="css/social.css?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>">
  <link rel="stylesheet" href="css/game-extra.css?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>">
  <link rel="stylesheet" href="css/cart-publish.css?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>">
  <link rel="stylesheet" href="css/workshop-admin.css?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>">
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
            <?= icon('chevron-down', 16) ?>
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
          
          <button type="button" class="user-menu-item" id="menu-profile"><?= icon('user', 16, 'menu-ico') ?> Профиль</button>
          <button type="button" class="user-menu-item" id="menu-notifications"><?= icon('bell', 16, 'menu-ico') ?> Уведомления <span class="menu-badge notif-menu-badge hidden">0</span></button>
          <button type="button" class="user-menu-item menu-friends-btn"><?= icon('friends', 16, 'menu-ico') ?> Друзья <span class="menu-badge friends-menu-badge hidden">0</span></button>
          <button type="button" class="user-menu-item" id="menu-settings"><?= icon('settings', 16, 'menu-ico') ?> Настройки</button>
          <div class="user-menu-sep" role="separator"></div>
          <button type="button" class="user-menu-item danger" id="menu-logout"><?= icon('logout', 16, 'menu-ico') ?> Выйти</button>
        </div>
      </div>

      <nav class="side-nav">
        <button type="button" class="nav-btn side-btn <?php echo $currentView === 'home' ? 'active' : ''; ?>" data-view="home"><span class="side-ico"><?= icon('home', 18) ?></span>Главная</button>
        <button type="button" class="nav-btn side-btn <?php echo $currentView === 'store' ? 'active' : ''; ?>" data-view="store"><span class="side-ico"><?= icon('store', 18) ?></span>Каталог</button>
        <?php if ($isClient): ?>
        <button type="button" class="nav-btn side-btn <?php echo $currentView === 'library' ? 'active' : ''; ?>" data-view="library"><span class="side-ico"><?= icon('library', 18) ?></span>Библиотека</button>
        <?php endif; ?>
        <button type="button" class="nav-btn side-btn <?php echo $currentView === 'workshop' ? 'active' : ''; ?>" data-view="workshop"><span class="side-ico"><?= icon('workshop', 18) ?></span>Мастерская</button>
        <button type="button" class="nav-btn side-btn <?php echo $currentView === 'downloads' ? 'active' : ''; ?>" data-view="downloads"><span class="side-ico"><?= icon('downloads', 18) ?></span>Загрузки<span class="nav-badge hidden" id="downloads-badge">0</span></button>
      </nav>

      <div class="side-lib">
        <div class="side-lib-title">МОЯ БИБЛИОТЕКА</div>
        <div class="side-lib-controls">
          <div class="search-field">
            <?= icon('search', 14, 'search-field-icon') ?>
            <input type="text" id="side-lib-search" class="side-lib-search" placeholder="Поиск" aria-label="Поиск в библиотеке" />
          </div>
          <button type="button" class="side-lib-tool" id="side-lib-installed" title="Только установленные">
            <?= icon('check', 15) ?>
          </button>
          <button type="button" class="side-lib-tool" id="side-lib-filters" title="Фильтры">
            <?= icon('filter', 15) ?>
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
            <button type="button" class="user-menu-item" id="menu-profile"><?= icon('user', 16, 'menu-ico') ?> Профиль</button>
            <button type="button" class="user-menu-item menu-notifications-btn" id="menu-notifications"><?= icon('bell', 16, 'menu-ico') ?> Уведомления <span class="menu-badge notif-menu-badge hidden">0</span></button>
            <button type="button" class="user-menu-item menu-friends-btn"><?= icon('friends', 16, 'menu-ico') ?> Друзья <span class="menu-badge friends-menu-badge hidden">0</span></button>
            <button type="button" class="user-menu-item" id="menu-settings"><?= icon('settings', 16, 'menu-ico') ?> Настройки</button>
            <div class="user-menu-sep" role="separator"></div>
            <button type="button" class="user-menu-item danger" id="menu-logout"><?= icon('logout', 16, 'menu-ico') ?> Выйти</button>
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
          <?= icon('chevron-left', 18) ?>
        </button>
        <h1 class="head-title" id="head-title">Главная</h1>
        <div class="head-search" id="head-search">
          <?= icon('search', 16, 'head-search-icon') ?>
          <input type="text" id="head-search-input" placeholder="Поиск" aria-label="Поиск игр" autocomplete="off" />
          <div class="head-search-drop" id="head-search-drop" hidden></div>
        </div>
        <?php if ($isAuthorized && ($user['role'] ?? '') === 'admin'): ?>
        <button type="button" class="head-admin" id="btn-admin" data-view="admin" title="Админка" aria-label="Админка">
          <?= icon('shield', 18) ?>
          <span class="admin-badge hidden" id="admin-badge">0</span>
        </button>
        <?php endif; ?>
        <button type="button" class="head-cart" id="btn-cart" title="Корзина" aria-label="Корзина">
          <?= icon('cart', 18) ?>
          <span class="cart-badge hidden" id="cart-badge">0</span>
        </button>
        <button type="button" class="head-add-game" id="btn-add-game" title="Создать" onclick="if(window.openCreateMenu){openCreateMenu();}else if(window.openSubmitRules){openSubmitRules();}">
          <?= icon('plus', 18) ?>
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
            <?= icon('star', 14) ?>
            Сейчас популярно
          </button>
          <button type="button" class="home-pill" data-hsort="week">
            <?= icon('trending-up', 14) ?>
            Лучшие игры недели
          </button>
          <button type="button" class="home-pill" data-hsort="new">
            <?= icon('clock', 14) ?>
            Новинки
          </button>
          <button type="button" class="home-pill surprise" id="home-surprise">
            <?= icon('smile', 14) ?>
            Удиви меня
          </button>
        </div>

        <h2 class="home-section-title" id="home-section-title">
          <?= icon('star', 16) ?>
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
                    <?= icon('monitor', 14) ?>
                    Современные
                  </button>
                  <button type="button" class="store-era-btn" data-era="classics" aria-pressed="false">
                    <?= icon('file-text', 14) ?>
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
                <span class="hp-side-arrow" aria-hidden="true"><?= icon('chevron-down', 16) ?></span>
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
                <span class="hp-side-arrow" aria-hidden="true"><?= icon('chevron-down', 16) ?></span>
              </button>
              <div class="filter-block-body">
                <div class="search-field">
                  <?= icon('search', 13, 'search-field-icon') ?>
                  <input type="text" class="filter-search" id="genre-filter-search" placeholder="Фильтр..." />
                </div>
                <div class="filter-opts" id="genre-opts"></div>
              </div>
            </div>

            <!-- 5. Разработчики -->
            <div class="filter-block">
              <button type="button" class="filter-block-head" aria-expanded="true">
                <span class="filter-dot" style="background:#f472b6"></span>
                <span>Разработчики</span>
                <span class="filter-count" id="dev-count"></span>
                <span class="hp-side-arrow" aria-hidden="true"><?= icon('chevron-down', 16) ?></span>
              </button>
              <div class="filter-block-body">
                <div class="search-field">
                  <?= icon('search', 13, 'search-field-icon') ?>
                  <input type="text" class="filter-search" id="dev-filter-search" placeholder="Фильтр..." />
                </div>
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
        <div class="library-page">
          <div class="library-toolbar">
            <div class="library-toolbar-left">
              <div class="library-era" id="library-filters" role="group" aria-label="Фильтр библиотеки">
                <button type="button" class="library-era-btn active" data-filter="all">
                  <?= icon('menu-lines', 14) ?>
                  Все
                </button>
                <button type="button" class="library-era-btn" data-filter="modern">
                  <?= icon('monitor', 14) ?>
                  Современные
                </button>
                <button type="button" class="library-era-btn" data-filter="classics">
                  <?= icon('file-text', 14) ?>
                  Классика
                </button>
              </div>
              <button type="button" class="library-installed-btn" id="library-installed-only" aria-pressed="false" title="Только установленные">
                <?= icon('check-bold', 16) ?>
              </button>
            </div>
            <div class="library-toolbar-right">
              <label class="library-sort-wrap">
                <span class="library-sort-label">Сортировать по</span>
                <select id="library-sort" class="sort-select" aria-label="Сортировка библиотеки">
                  <option value="name">По названию (A-Z)</option>
                  <option value="name_desc">По названию (Z-A)</option>
                  <option value="recent">Недавно добавленные</option>
                  <option value="played">Недавно играли</option>
                  <option value="playtime">По времени в игре</option>
                  <option value="installed">Сначала установленные</option>
                </select>
              </label>
              <div class="library-view-toggle" id="library-view-toggle" role="group" aria-label="Вид">
                <button type="button" class="library-view-btn" data-view="compact" title="Компактный" aria-label="Компактный">
                  <?= icon('grid', 15) ?>
                </button>
                <button type="button" class="library-view-btn active" data-view="grid" title="Сетка" aria-label="Сетка">
                  <?= icon('grid-2x2', 15) ?>
                </button>
                <button type="button" class="library-view-btn" data-view="large" title="Большой" aria-label="Большой">
                  <?= icon('list-view', 15) ?>
                </button>
              </div>
            </div>
          </div>
          <div id="library-grid" class="lib-grid is-grid"><div class="loading">Загрузка библиотеки...</div></div>
        </div>
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
                    <div class="ws-stat-val" id="ws-stat-views">0</div>
                    <div class="ws-stat-lbl">Просмотров</div>
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
                  <?= icon('gamepad', 15) ?>
                  Игры
                </button>
                <button type="button" class="hp-btn-edit ws-tab-btn" data-ws-tab="mods">
                  <?= icon('workshop', 15) ?>
                  Моды
                </button>
                <button type="button" class="hp-btn-edit ws-tab-btn" data-ws-tab="media">
                  <?= icon('image', 15) ?>
                  Медиа
                </button>
                <button type="button" class="hp-btn-edit ws-tab-btn" data-ws-tab="assets">
                  <?= icon('package', 15) ?>
                  Ассеты
                </button>
              </div>
              <div class="hp-toolbar-spacer"></div>
              <button type="button" class="hp-btn-logout" id="ws-filters-btn" title="Фильтры">
                <?= icon('filter', 15) ?>
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
                  <?= icon('workshop', 15) ?>
                  Моды
                </button>
                <button type="button" class="hp-btn-edit ws-tab-btn" data-wsg-tab="media">
                  <?= icon('image', 15) ?>
                  Медиа
                </button>
                <button type="button" class="hp-btn-edit ws-tab-btn" data-wsg-tab="assets">
                  <?= icon('package', 15) ?>
                  Ассеты
                </button>
              </div>
              <div class="hp-toolbar-spacer"></div>
              <button type="button" class="hp-btn-logout" id="wsg-filters-btn" title="Фильтры">
                <?= icon('filter', 15) ?>
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
              <?= icon('x', 18) ?>
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
              <div class="downloads-empty-icon" aria-hidden="true">
                <?= icon('download-lg', 88) ?>
              </div>
              <p class="downloads-empty-title">Здесь так пусто...</p>
              <p class="downloads-empty-sub">Вы ещё ничего не скачали через CATio, но никогда не поздно начать.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- ===== КОРЗИНА ===== -->
      <section id="view-cart" class="view">
        <div class="cart-page" id="cart-page">
          <div class="cart-empty" id="cart-empty">
            <div class="cart-empty-icon" aria-hidden="true">
              <?= icon('cart', 48) ?>
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
                  <?= icon('trash', 16) ?>
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
              <div class="notif-page-empty-icon" aria-hidden="true">
                <?= icon('bell-off', 44) ?>
              </div>
              <div class="notif-page-empty-title">Нет уведомлений</div>
              <div class="notif-page-empty-sub">Вы в курсе всех событий! Загляните позже за новыми обновлениями.</div>
            </div>
          </div>
        </div>
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
                <?= icon('upload', 15) ?>
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
                <?= icon('edit', 16) ?>
              </button>
              <button type="button" class="hp-btn-logout" onclick="logout()">
                <?= icon('logout', 14) ?>
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
                <div class="hp-empty hp-empty-centered">
                  <div class="hp-empty-logo" aria-hidden="true">
                    <?= icon('layers', 40) ?>
                  </div>
                  <div class="hp-empty-text">Пока нет отзывов</div>
                </div>
              </div>
              <div class="hp-tab-pane hidden" id="hp-pane-screenshots">
                <div class="hp-empty hp-empty-centered" id="hp-screenshots-empty">
                  <div class="hp-empty-logo" aria-hidden="true">
                    <?= icon('image', 40) ?>
                  </div>
                  <div class="hp-empty-text">Скриншотов пока нет</div>
                </div>
                <div class="hp-screenshots-grid hidden" id="hp-screenshots-grid"></div>
              </div>
            </div>

            <aside class="hp-side">
              <div class="hp-side-card">
                <div class="hp-side-head">
                  <span>Статистика</span>
                  <button type="button" class="hp-side-toggle" aria-label="Свернуть" aria-expanded="true">
                    <span class="hp-side-arrow" aria-hidden="true">
                      <?= icon('chevron-down', 16) ?>
                    </span>
                  </button>
                </div>
                <div class="hp-side-body">
                  <div class="hp-stat">
                    <div class="hp-stat-label">Всего сыграно</div>
                    <div class="hp-stat-row">
                      <span class="hp-stat-value" id="hp-stat-playtime">
                        <?= icon('clock-alt', 14) ?>
                        0 часов
                      </span>
                      <span class="hp-stat-badge" id="hp-stat-top">—</span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="hp-side-card">
                <div class="hp-side-head">
                  <span>Недавняя активность</span>
                  <button type="button" class="hp-side-toggle" aria-label="Свернуть" aria-expanded="true">
                    <span class="hp-side-arrow" aria-hidden="true">
                      <?= icon('chevron-down', 16) ?>
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
                      <?= icon('chevron-down', 16) ?>
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
                  <?= icon('camera', 16) ?>
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
              <?= icon('settings', 16) ?>
              Основные
            </button>
            <button type="button" class="settings-nav-btn" data-stab="notifications">
              <?= icon('bell', 16) ?>
              Уведомления
            </button>
            <button type="button" class="settings-nav-btn" data-stab="privacy">
              <?= icon('lock', 16) ?>
              Аккаунт и конфиденциальность
            </button>
            <button type="button" class="settings-nav-btn" data-stab="balance">
              <?= icon('credit-card', 16) ?>
              Баланс
            </button>
          </aside>
          <div class="settings-main">
            <!-- ОСНОВНЫЕ -->
            <div class="settings-pane" id="settings-pane-general">
              <h2 class="settings-title">Основные</h2>
              <p class="settings-sub">Профиль и внешний вид</p>

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

              <p id="settings-error" class="auth-error hidden"></p>
              <button type="button" class="hp-btn-save" id="settings-save-general">Сохранить</button>
            </div>

            <!-- УВЕДОМЛЕНИЯ -->
            <div class="settings-pane hidden" id="settings-pane-notifications">
              <h2 class="settings-title">Уведомления</h2>
              <p class="settings-sub">Выберите, о чём вас оповещать</p>

              <div class="filter-block settings-filter-block settings-rows-block">
                <div class="filter-block-body filter-block-body--open settings-rows">
                  <label class="settings-row settings-row-check">
                    <span class="settings-row-label">Завершение загрузки</span>
                    <span class="settings-row-control">
                      <input type="checkbox" data-np="dl_complete" checked />
                      <span class="settings-row-check-text">Вкл</span>
                    </span>
                  </label>
                  <label class="settings-row settings-row-check">
                    <span class="settings-row-label">Запрос в друзья</span>
                    <span class="settings-row-control">
                      <input type="checkbox" data-np="friend_request" checked />
                      <span class="settings-row-check-text">Вкл</span>
                    </span>
                  </label>
                  <label class="settings-row settings-row-check">
                    <span class="settings-row-label">Друг начал играть</span>
                    <span class="settings-row-control">
                      <input type="checkbox" data-np="friend_playing" checked />
                      <span class="settings-row-check-text">Вкл</span>
                    </span>
                  </label>
                  <label class="settings-row settings-row-check">
                    <span class="settings-row-label">Сообщение от друга</span>
                    <span class="settings-row-control">
                      <input type="checkbox" data-np="friend_message" checked />
                      <span class="settings-row-check-text">Вкл</span>
                    </span>
                  </label>
                </div>
              </div>
              <button type="button" class="hp-btn-save" id="settings-save-notif">Сохранить</button>
            </div>

            <!-- ПРИВАТНОСТЬ -->
            <div class="settings-pane hidden" id="settings-pane-privacy">
              <h2 class="settings-title">Аккаунт и конфиденциальность</h2>
              <p class="settings-sub">Кто видит ваш профиль и как с вами связываться</p>

              <div class="filter-block settings-filter-block settings-rows-block">
                <div class="filter-block-body filter-block-body--open settings-rows">
                  <label class="settings-row">
                    <span class="settings-row-label">Видимость профиля</span>
                    <select id="settings-profile-vis" class="settings-select sort-select" aria-label="Видимость профиля">
                      <option value="public">Публичный</option>
                      <option value="friends">Только для друзей</option>
                      <option value="hidden">Скрытый</option>
                    </select>
                  </label>
                  <label class="settings-row">
                    <span class="settings-row-label">Видимость скриншотов</span>
                    <select id="settings-media-vis" class="settings-select sort-select" aria-label="Видимость скриншотов">
                      <option value="public">Публичный</option>
                      <option value="friends">Только для друзей</option>
                      <option value="hidden">Скрытый</option>
                    </select>
                  </label>
                  <label class="settings-row settings-row-check">
                    <span class="settings-row-label">Заявки в друзья</span>
                    <span class="settings-row-control">
                      <input type="checkbox" id="settings-allow-friends" checked />
                      <span class="settings-row-check-text">Разрешить</span>
                    </span>
                  </label>
                  <label class="settings-row">
                    <span class="settings-row-label">Текущий email</span>
                    <input type="email" id="settings-email" class="auth-input settings-row-input" value="<?php echo htmlspecialchars($user['email'] ?? ''); ?>" />
                  </label>
                  <label class="settings-row">
                    <span class="settings-row-label">Издательство в профиле</span>
                    <select class="settings-select sort-select" id="settings-display-pub" aria-label="Издательство в профиле">
                      <option value="hide">Не показывать</option>
                    </select>
                  </label>
                </div>
              </div>

              <p id="settings-privacy-error" class="auth-error hidden"></p>
              <button type="button" class="hp-btn-save" id="settings-save-privacy">Сохранить</button>
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
                  <?= icon('friends', 14) ?>
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
                      <?= icon('chevron-down', 16) ?>
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
              <?= icon('shield', 16) ?>
              Модерация <span class="admin-mod-count hidden" id="admin-mod-count"></span>
            </button>
            <button type="button" class="settings-nav-btn" data-atab="users">
              <?= icon('friends', 16) ?>
              Пользователи
            </button>
            <!-- steam import tab removed -->
          </aside>

          <div class="settings-main">
            <div class="settings-pane" id="admin-pane-moderation">
              <h2 class="settings-title">Модерация</h2>
              <p class="settings-sub">Всё на проверке: игры, моды, ассеты, медиа и версии. Тип указан на карточке — нажмите, чтобы открыть модалку.</p>
              <div class="filter-block settings-filter-block settings-rows-block admin-mod-list-wrap">
                <div class="filter-block-body filter-block-body--open" style="padding:8px !important">
                  <div id="admin-pending-list" class="admin-pending-list">
                    <div class="loading">Загрузка...</div>
                  </div>
                </div>
              </div>
              <div class="admin-layout admin-layout--list-only" style="display:none">
                <div class="admin-list-panel" style="grid-column: 1 / -1">
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
              <p class="settings-sub">Список аккаунтов, роли и баны. Можно открыть профиль или редактировать.</p>
              <div class="filter-block settings-filter-block settings-rows-block admin-mod-list-wrap">
                <div class="filter-block-body filter-block-body--open" style="padding:12px 14px !important">
                  <div class="admin-users-toolbar" style="margin-bottom:12px;display:flex;gap:10px;flex-wrap:wrap">
                    <input type="search" class="auth-input" id="admin-users-search" placeholder="Поиск по нику или почте…" style="flex:1;min-width:180px" />
                    <select id="admin-users-filter" class="settings-select sort-select" style="max-width:180px">
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
  <script src="js/icons.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/utils.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/cart.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/cart-page.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/home.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/store.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/library.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/downloads.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/profile.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/settings-ui.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/friends.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/messages.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/notifications.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/gallery.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/game.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/game-actions.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/game-comments.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/workshop-assets.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/workshop.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/admin-import.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/admin.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/publishers.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
<script src="js/app.js?v=<?php echo isset($assetVer) ? $assetVer : time(); ?>"></script>
  <script src="js/catio_fixes.js"></script>

<?php require __DIR__ . '/partials/modals.php'; ?>
</body>
</html>
