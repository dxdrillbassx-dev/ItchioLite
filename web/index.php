<?php
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';
getDB();

$isClient = isset($_GET['client']) && $_GET['client'] == '1';
$currentView = isset($_GET['view']) ? $_GET['view'] : 'home';
$auth = getAuthState();
$isAuthorized = $auth['authorized'];
$user = $auth['user'];
$csrfToken = $auth['csrf_token'];

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

// Как выглядит аватар пользователя (эмодзи из настроек или первая буква имени)
$avatarText = '';
$avatarColor = '#ef5b2c';
if ($isAuthorized) {
    $avatarText = $user['avatar'] !== '' ? $user['avatar'] : mb_strtoupper(mb_substr($user['username'], 0, 1));
    $avatarColor = $user['avatar_color'] ?? '#ef5b2c';
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
  <link rel="stylesheet" href="css/style.css" />
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
          <span class="side-avatar" id="side-avatar" style="background:<?php echo htmlspecialchars($avatarColor); ?>"><?php echo htmlspecialchars($avatarText); ?></span>
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
          <button type="button" class="user-menu-item" id="menu-profile">&#128100;&nbsp; Профиль</button>
          <button type="button" class="user-menu-item" id="menu-downloads">&#8681;&nbsp; Загрузки</button>
          <button type="button" class="user-menu-item" id="menu-settings">&#9881;&nbsp; Настройки</button>
          <button type="button" class="user-menu-item danger" id="menu-logout">&#8618;&nbsp; Выйти</button>
        </div>
      </div>

      <nav class="side-nav">
        <button type="button" class="nav-btn side-btn <?php echo $currentView === 'home' ? 'active' : ''; ?>" data-view="home"><span class="side-ico">⌂</span>Главная</button>
        <button type="button" class="nav-btn side-btn <?php echo $currentView === 'store' ? 'active' : ''; ?>" data-view="store"><span class="side-ico">▦</span>Каталог</button>
        <?php if ($isClient): ?>
        <button type="button" class="nav-btn side-btn <?php echo $currentView === 'library' ? 'active' : ''; ?>" data-view="library"><span class="side-ico">📖</span>Библиотека</button>
        <?php endif; ?>
        <button type="button" class="nav-btn side-btn <?php echo $currentView === 'downloads' ? 'active' : ''; ?>" data-view="downloads"><span class="side-ico">⬇</span>Загрузки<span class="nav-badge hidden" id="downloads-badge">0</span></button>
        <button type="button" class="nav-btn side-btn <?php echo $currentView === 'settings' ? 'active' : ''; ?>" data-view="settings"><span class="side-ico">⚙</span>Настройки</button>
      </nav>

      <div class="side-lib">
        <div class="side-lib-title">МОЯ БИБЛИОТЕКА</div>
        <div class="side-lib-controls">
          <input type="text" id="side-lib-search" class="side-lib-search" placeholder="Поиск" aria-label="Поиск в библиотеке" />
          <button type="button" class="side-lib-tool" id="side-lib-installed" title="Показывать только установленные">✓</button>
          <button type="button" class="side-lib-tool" id="side-lib-filters" title="Фильтры">🎚</button>
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
          <button type="button" class="avatar" id="avatar-btn" aria-haspopup="true" aria-expanded="false" style="background:<?php echo htmlspecialchars($avatarColor); ?>"><?php echo htmlspecialchars($avatarText); ?></button>
          <div class="user-menu hidden" id="user-menu" role="menu">
            <div class="user-menu-head">
              <div class="user-menu-name"><?php echo htmlspecialchars($user['username']); ?></div>
              <div class="user-menu-mail"><?php echo htmlspecialchars($user['email']); ?></div>
            </div>
            <div class="user-menu-balance">
              <span>Баланс</span>
              <b id="user-balance"><?php echo number_format($user['balance'], 0, ',', ' '); ?> ₽</b>
            </div>
            <button type="button" class="user-menu-item" id="menu-profile">&#128100;&nbsp; Профиль</button>
            <button type="button" class="user-menu-item" id="menu-downloads">&#8681;&nbsp; Загрузки</button>
            <button type="button" class="user-menu-item" id="menu-settings">&#9881;&nbsp; Настройки</button>
            <button type="button" class="user-menu-item danger" id="menu-logout">&#8618;&nbsp; Выйти</button>
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
        <button type="button" class="head-back" id="head-back" title="Назад">←</button>
        <h1 class="head-title" id="head-title">Главная</h1>
        <div class="head-search" id="head-search">
          <input type="text" id="head-search-input" placeholder="Поиск" aria-label="Поиск по вкладке" />
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

      <!-- ===== КАТАЛОГ (список + фильтры справа, как в Hydra) ===== -->
      <section id="view-store" class="view <?php echo $currentView === 'store' ? 'active' : ''; ?>">
        <div class="store-layout">
          <div class="store-main">
            <div class="store-head">
              <div class="store-count-line">
                <b id="store-count">0</b> результатов
                <span class="store-hint">Используй боковую панель для уточнения поиска</span>
              </div>
              <label class="sort-label">
                Сортировать по
                <select id="sort-select" class="sort-select" aria-label="Сортировка">
                  <option value="popular">Популярности</option>
                  <option value="new">Новизне</option>
                  <option value="rating">Оценке</option>
                  <option value="price">Цене</option>
                </select>
              </label>
            </div>
            <div id="store-list" class="store-list"><div class="loading">Загрузка каталога...</div></div>
          </div>

          <aside class="store-filters">
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
        <div class="profile-page">
          <div class="profile-banner" style="background:linear-gradient(120deg, <?php echo htmlspecialchars($avatarColor); ?>33, transparent 60%)">
            <div class="profile-header">
              <div class="profile-avatar" style="background:<?php echo htmlspecialchars($avatarColor); ?>"><?php echo htmlspecialchars($avatarText); ?></div>
              <div class="profile-info">
                <h1 class="profile-name"><?php echo htmlspecialchars($user['username']); ?></h1>
                <p class="profile-meta">
                  В CATio с <?php echo $memberSince; ?>
                  <?php if ($user['role'] === 'admin'): ?>
                  · <span class="role-badge">Администратор</span>
                  <?php endif; ?>
                </p>
              </div>
            </div>
          </div>

          <div class="profile-actions">
            <button type="button" class="btn-ghost" id="btn-settings-open">✎ Редактировать Профиль</button>
            <button type="button" class="btn-logout" onclick="logout()">↪ Выйти</button>
          </div>

          <div class="profile-body">
            <div class="profile-main">
              <div class="section-header"><h2>Библиотека <span class="filter-count" id="profile-games-count"></span></h2></div>
              <div id="profile-games" class="profile-games-grid"><div class="loading">Загрузка...</div></div>
            </div>
            <aside class="profile-side">
              <div class="side-card">
                <div class="side-card-head">Статистика</div>
                <div class="side-card-body">
                  <div class="pstat"><span>Игр в библиотеке</span><b id="stat-games">0</b></div>
                  <div class="pstat"><span>Комментариев</span><b id="stat-comments">0</b></div>
                  <div class="pstat"><span>Оценок</span><b id="stat-ratings">0</b></div>
                  <div class="pstat"><span>Потрачено</span><b id="stat-spent">0 ₽</b></div>
                  <div class="pstat"><span>Уровень</span><b id="profile-level">0</b></div>
                  <div class="pstat"><span>Баланс</span><span><b id="profile-balance"><?php echo number_format($user['balance'], 0, ',', ' '); ?> ₽</b> <button type="button" class="btn-link" id="btn-topup-open">Пополнить</button></span></div>
                </div>
              </div>
              <div class="side-card">
                <div class="side-card-head">Недавняя активность</div>
                <div class="side-card-body" id="profile-activity"><div class="loading">Загрузка...</div></div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <!-- ===== НАСТРОЙКИ (вкладка, как в Hydra) ===== -->
      <section id="view-settings" class="view <?php echo $currentView === 'settings' ? 'active' : ''; ?>">
        <div class="settings-layout">
          <aside class="settings-nav" id="settings-nav">
            <button type="button" class="settings-nav-btn active" data-stab="general">⚙ Основные</button>
            <button type="button" class="settings-nav-btn" data-stab="balance">↓ Баланс</button>
          </aside>
          <div class="settings-main">
            <div class="settings-pane" id="settings-pane-general">
              <h2 class="settings-title">ОСНОВНЫЕ</h2>
              <p class="settings-sub">Основные настройки профиля</p>

              <div class="settings-avatar-preview" id="settings-avatar-preview"><?php echo htmlspecialchars($avatarText); ?></div>

              <label class="settings-label">
                <span>Эмодзи аватара (до 4 символов)</span>
                <input type="text" id="settings-avatar-input" class="auth-input" maxlength="4" value="<?php echo htmlspecialchars($user['avatar']); ?>" placeholder="🐱" />
              </label>

              <label class="settings-label">
                <span>Цвет аватара</span>
                <input type="color" id="settings-color-input" class="settings-color" value="<?php echo htmlspecialchars($avatarColor); ?>" />
              </label>

              <p id="settings-error" class="auth-error hidden"></p>
              <button type="button" class="auth-submit" id="settings-save">Сохранить</button>
            </div>
            <div class="settings-pane hidden" id="settings-pane-balance">
              <h2 class="settings-title">БАЛАНС</h2>
              <p class="settings-sub">Учебные рубли — ими можно покупать игры в каталоге</p>
              <p class="settings-balance-line">Текущий баланс: <b id="settings-balance"><?php echo number_format($user['balance'], 0, ',', ' '); ?> ₽</b></p>
              <div class="settings-topup-row">
                <button type="button" class="btn-topup" data-amount="100">+100 ₽</button>
                <button type="button" class="btn-topup" data-amount="500">+500 ₽</button>
                <button type="button" class="btn-topup" data-amount="1000">+1000 ₽</button>
              </div>
            </div>
          </div>
        </div>
      </section>
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
                <button type="submit" class="auth-submit">Создать аккаунт</button>
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
  <script src="js/app.js"></script>
</body>
</html>
