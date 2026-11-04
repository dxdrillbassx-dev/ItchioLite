<?php
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';
getDB();

$isClient = isset($_GET['client']) && $_GET['client'] == '1';
$currentView = isset($_GET['view']) ? $_GET['view'] : 'store';
$auth = getAuthState();
$isAuthorized = $auth['authorized'];
$user = $auth['user'];
$csrfToken = $auth['csrf_token'];

// Неавторизованным показываем только авторизацию — без мигания основного интерфейса
if (!$isAuthorized && $currentView !== 'auth') {
    $currentView = 'auth';
}

// Личные разделы недоступны без аккаунта
if (!$isAuthorized && in_array($currentView, ['library', 'downloads', 'profile'], true)) {
    $currentView = 'auth';
}

// Библиотека — только в десктоп-клиенте: в браузере её раздел не открывается
if (!$isClient && $currentView === 'library') {
    $currentView = 'store';
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
<body>
  <div id="app">
    <?php if (!$isClient): ?>
    <header class="topbar">
      <div class="logo">
        <img class="logo-img" src="logo.ico" alt="CATio" />
        <span class="logo-text">CATio</span>
      </div>
      <nav class="nav">
        <button class="nav-btn <?php echo $currentView === 'store' ? 'active' : ''; ?>" data-view="store">Каталог</button>
        <button class="nav-btn <?php echo $currentView === 'community' ? 'active' : ''; ?>" data-view="community">Мастерская</button>
        <?php if ($isAuthorized): ?>
        <button class="nav-btn <?php echo $currentView === 'downloads' ? 'active' : ''; ?>" data-view="downloads">
          Загрузки<span class="nav-badge hidden" id="downloads-badge">0</span>
        </button>
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

    <main class="main">
      <!-- ===== КАТАЛОГ (только готовые игры; ассеты живут в Мастерской) ===== -->
      <section id="view-store" class="view <?php echo $currentView === 'store' ? 'active' : ''; ?>">
        <div class="catalog-header">
          <h1 class="catalog-title">Каталог</h1>
          <p class="catalog-desc">Готовые игры независимых авторов: бесплатно или за учебные рубли. Ассеты и инструменты — в Мастерской.</p>
        </div>

        <div class="search-row">
          <input type="text" id="search-input" class="search-input" placeholder="Название или описание" aria-label="Поиск" />
          <select id="sort-select" class="sort-select" aria-label="Сортировка">
            <option value="new">Сначала новые</option>
            <option value="rating">По оценке</option>
            <option value="price">Сначала дешевле</option>
          </select>
        </div>

        <div class="chiprow" id="genre-chips">
          <button type="button" class="chip active" data-genre="all">Все жанры</button>
          <button type="button" class="chip" data-genre="RPG">RPG</button>
          <button type="button" class="chip" data-genre="Аркада">Аркада</button>
          <button type="button" class="chip" data-genre="Визуальная новелла">Визуальная новелла</button>
          <button type="button" class="chip" data-genre="Головоломка">Головоломка</button>
          <button type="button" class="chip" data-genre="Платформер">Платформер</button>
          <button type="button" class="chip" data-genre="Приключение">Приключение</button>
          <button type="button" class="chip" data-genre="Рогалик">Рогалик</button>
          <button type="button" class="chip" data-genre="Симулятор">Симулятор</button>
          <button type="button" class="chip" data-genre="Стратегия">Стратегия</button>
          <button type="button" class="chip" data-genre="Хоррор">Хоррор</button>
        </div>

        <div class="hero featured-hero" id="featured-hero">
          <div class="hero-info">
            <p class="hero-genre">Платформер</p>
            <h2 class="hero-title">Лисий фонарь</h2>
            <p class="hero-desc">Ночной платформер про лисёнка с бумажным фонарём. Свет держится, только пока вы идёте, а лес запоминает, где вы уже были.</p>
            <p class="hero-author">автор mast</p>
            <div class="hero-meta">
              <div class="stars" aria-label="Рейтинг 5 из 5">
                <span class="star filled">★</span>
                <span class="star filled">★</span>
                <span class="star filled">★</span>
                <span class="star filled">★</span>
                <span class="star filled">★</span>
              </div>
              <span class="hero-rating">5.0</span>
              <span class="hero-price free">Бесплатно</span>
            </div>
          </div>
          <div class="hero-cover" id="featured-hero-cover">
            <div class="hero-cover-placeholder">🦊</div>
          </div>
        </div>

        <div class="section-header"><h2 id="store-section-title">Все игры</h2></div>
        <div id="games-grid" class="games-grid"><div class="loading">Загрузка каталога...</div></div>
      </section>

      <!-- ===== СТРАНИЦА ИГРЫ (как на itch.io) ===== -->
      <section id="view-game" class="view <?php echo $currentView === 'game' ? 'active' : ''; ?>">
        <div id="game-page"><div class="loading">Загрузка страницы игры...</div></div>
      </section>

      <!-- ===== БИБЛИОТЕКА (как в Steam) ===== -->
      <section id="view-library" class="view <?php echo $currentView === 'library' ? 'active' : ''; ?>">
        <div class="library-layout">
          <aside class="library-side">
            <div class="library-side-head">
              <h2 class="library-title">Библиотека</h2>
              <input type="text" id="library-search" class="library-search" placeholder="Поиск в библиотеке" aria-label="Поиск в библиотеке" />
              <div class="library-filters" id="library-filters">
                <button type="button" class="lib-filter active" data-filter="all">Все</button>
                <button type="button" class="lib-filter" data-filter="game">Игры</button>
                <button type="button" class="lib-filter" data-filter="asset">Ассеты</button>
              </div>
            </div>
            <div id="library-list" class="library-list"><div class="loading">Загрузка библиотеки...</div></div>
          </aside>
          <div class="library-detail" id="library-detail">
            <div class="library-detail-empty">
              <div class="library-detail-empty-icon">🐈</div>
              <p>Выбери игру слева — здесь появятся подробности, сборки и скриншоты.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- ===== ЗАГРУЗКИ (как в Steam) ===== -->
      <section id="view-downloads" class="view <?php echo $currentView === 'downloads' ? 'active' : ''; ?>">
        <div class="section-header"><h2>Загрузки</h2></div>
        <div class="downloads-page">
          <div class="downloads-active" id="downloads-active">
            <div class="downloads-empty" id="downloads-empty">
              <div class="downloads-empty-icon">⬇</div>
              <p>Нет активных загрузок. Зайди в библиотеку и скачай что-нибудь тёплое.</p>
              <button type="button" class="btn-primary" onclick="gotoView('library')">Открыть библиотеку</button>
            </div>
          </div>
          <div class="downloads-history-wrap">
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
      <!-- ===== ПРОФИЛЬ (как в Steam) ===== -->
      <section id="view-profile" class="view <?php echo $currentView === 'profile' ? 'active' : ''; ?>">
        <div class="profile-page">
          <div class="profile-banner" style="background:linear-gradient(120deg, <?php echo htmlspecialchars($avatarColor); ?>33, transparent 60%)">
            <div class="profile-header">
              <div class="profile-avatar" style="background:<?php echo htmlspecialchars($avatarColor); ?>"><?php echo htmlspecialchars($avatarText); ?></div>
              <div class="profile-info">
                <h1 class="profile-name"><?php echo htmlspecialchars($user['username']); ?></h1>
                <p class="profile-meta">
                  <span class="profile-level">Уровень <b id="profile-level">0</b></span>
                  · В CATio с <?php echo $memberSince; ?>
                  <?php if ($user['role'] === 'admin'): ?>
                  · <span class="role-badge">Администратор</span>
                  <?php endif; ?>
                </p>
                <p class="profile-balance-line">Баланс: <b id="profile-balance"><?php echo number_format($user['balance'], 0, ',', ' '); ?> ₽</b>
                  <button type="button" class="btn-link" id="btn-topup-open">Пополнить</button>
                </p>
              </div>
              <button type="button" class="btn-settings" id="btn-settings-open">&#9881; Настройки</button>
            </div>
          </div>

          <div class="profile-stats" id="profile-stats">
            <div class="stat"><div class="stat-num" id="stat-games">0</div><div class="stat-label">Игр и ассетов</div></div>
            <div class="stat"><div class="stat-num" id="stat-comments">0</div><div class="stat-label">Комментариев</div></div>
            <div class="stat"><div class="stat-num" id="stat-ratings">0</div><div class="stat-label">Оценок</div></div>
            <div class="stat"><div class="stat-num" id="stat-spent">0 ₽</div><div class="stat-label">Потрачено</div></div>
          </div>

          <div class="profile-cols">
            <div class="profile-col-main">
              <div class="section-header"><h2>Недавняя активность</h2></div>
              <div id="profile-activity" class="profile-activity"><div class="loading">Загрузка...</div></div>
            </div>
            <div class="profile-col-side">
              <div class="section-header"><h2>Мои игры</h2></div>
              <div id="profile-games" class="profile-games"><div class="loading">Загрузка...</div></div>
            </div>
          </div>

          <button class="btn-logout" onclick="logout()">Выйти</button>
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
  </div>

  <?php if ($isAuthorized): ?>
  <!-- ===== МОДАЛКА НАСТРОЕК ПРОФИЛЯ ===== -->
  <div id="settings-modal" class="modal hidden">
    <div class="modal-backdrop" id="settings-backdrop"></div>
    <div class="modal-content settings-content">
      <button class="modal-close" id="settings-close">×</button>
      <h2 class="modal-title">Настройки профиля</h2>

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

      <div class="settings-topup">
        <h3 class="settings-topup-title">Пополнить баланс (учебные рубли)</h3>
        <div class="settings-topup-row">
          <button type="button" class="btn-topup" data-amount="100">+100 ₽</button>
          <button type="button" class="btn-topup" data-amount="500">+500 ₽</button>
          <button type="button" class="btn-topup" data-amount="1000">+1000 ₽</button>
        </div>
      </div>
    </div>
  </div>

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
// горизонтальный скролл чипов колесиком при наведении
document.addEventListener('DOMContentLoaded', () => {
  const row = document.getElementById('genre-chips');
  if (!row) return;
  row.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      row.scrollLeft += e.deltaY;
    }
  }, { passive: false });
});

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
      window.location.href = window.IS_CLIENT ? '?view=store&client=1' : '?view=store';
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
      window.location.href = window.IS_CLIENT ? '?view=store&client=1' : '?view=store';
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
  window.location.href = window.IS_CLIENT ? '?view=store&client=1' : '?view=store';
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
