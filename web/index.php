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
        <button class="nav-btn <?php echo $currentView === 'library' ? 'active' : ''; ?>" data-view="library">Библиотека</button>
        <button class="nav-btn <?php echo $currentView === 'community' ? 'active' : ''; ?>" data-view="community">Мастерская</button>
        <?php if ($isAuthorized): ?>
        <button class="nav-btn <?php echo $currentView === 'profile' ? 'active' : ''; ?>" data-view="profile"><?php echo htmlspecialchars(strtoupper($user['username'])); ?></button>
        <?php endif; ?>
      </nav>
      <div class="user-area">
        <?php if ($isAuthorized): ?>
        <div class="avatar-wrap">
          <button type="button" class="avatar" id="avatar-btn" aria-haspopup="true" aria-expanded="false"><?php echo htmlspecialchars(mb_strtoupper(mb_substr($user['username'], 0, 1))); ?></button>
          <div class="user-menu hidden" id="user-menu" role="menu">
            <div class="user-menu-head">
              <div class="user-menu-name"><?php echo htmlspecialchars($user['username']); ?></div>
              <div class="user-menu-mail"><?php echo htmlspecialchars($user['email']); ?></div>
            </div>
            <div class="user-menu-balance">
              <span>Баланс</span>
              <b><?php echo number_format($user['balance'], 0, ',', ' '); ?> ₽</b>
            </div>
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
      <section id="view-store" class="view <?php echo $currentView === 'store' ? 'active' : ''; ?>">
        <div class="catalog-header">
          <h1 class="catalog-title">Каталог</h1>
          <p class="catalog-desc">Игры независимых авторов: бесплатно или за учебные рубли. Комиссия полки — 10%.</p>
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

        <div class="hero featured-hero">
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
          <div class="hero-cover">
            <div class="hero-cover-placeholder">🎮</div>
          </div>
        </div>

        <div class="section-header"><h2>Все игры</h2></div>
        <div id="games-grid" class="games-grid"><div class="loading">Загрузка игр...</div></div>
      </section>

      <section id="view-library" class="view <?php echo $currentView === 'library' ? 'active' : ''; ?>">
        <div class="section-header"><h2>Моя библиотека</h2></div>
        <div id="library-grid" class="games-grid"><div class="loading">Загрузка библиотеки...</div></div>
      </section>

      <section id="view-community" class="view <?php echo $currentView === 'community' ? 'active' : ''; ?>">
        <div class="placeholder">
          <h2>Мастерская</h2>
          <p>Загружай свои игры, делись сборками и получай отзывы.</p>
        </div>
      </section>

      <?php if ($isAuthorized): ?>
      <section id="view-profile" class="view <?php echo $currentView === 'profile' ? 'active' : ''; ?>">
        <div class="profile-page">
          <div class="profile-header">
            <div class="profile-avatar"><?php echo htmlspecialchars(mb_strtoupper(mb_substr($user['username'], 0, 1))); ?></div>
            <div class="profile-info">
              <h1 class="profile-name"><?php echo htmlspecialchars($user['username']); ?></h1>
              <p class="profile-meta">В CATio с <?php echo date('F Y', strtotime($user['created_at'] ?? 'now')); ?> · Баланс: <span class="profile-balance"><?php echo number_format($user['balance'], 0, ',', ' '); ?> ₽</span></p>
              <?php if ($user['role'] === 'admin'): ?>
              <span class="role-badge">Администратор</span>
              <?php endif; ?>
            </div>
          </div>
          <div class="profile-stats">
            <div class="stat"><div class="stat-num">0</div><div class="stat-label">Игр</div></div>
            <div class="stat"><div class="stat-num">0</div><div class="stat-label">Отзывов</div></div>
            <div class="stat"><div class="stat-num">0</div><div class="stat-label">Друзей</div></div>
          </div>
          <div class="section-header"><h2>Недавняя активность</h2></div>
          <div class="placeholder" style="padding:40px 20px">Пока нет активности</div>
          <button class="btn-logout" onclick="logout()">Выйти</button>
        </div>
      </section>
      <?php endif; ?>

      <?php if (!$isAuthorized): ?>
      <section id="view-auth" class="view <?php echo $currentView === 'auth' ? 'active' : ''; ?>">
        <div class="auth-page">
          <div class="auth-box">
            <a class="auth-logo" href="?view=store<?php echo $isClient ? '&amp;client=1' : ''; ?>"><img class="logo-img logo-img-lg" src="logo.ico" alt="" />CATio</a>
            <p class="auth-sub">Вход на полку. Первый аккаунт становится администратором и разработчиком.</p>

            <div class="auth-card">
              <!-- Переключатель Вход/Регистрация -->
              <div class="auth-tabs">
                <button type="button" class="auth-tab active" id="tab-login" onclick="switchAuthTab('login')">Вход</button>
                <button type="button" class="auth-tab" id="tab-register" onclick="switchAuthTab('register')">Регистрация</button>
              </div>

              <!-- Ошибки -->
              <p id="auth-error" class="auth-error hidden"></p>

              <!-- ФОРМА ВХОДА -->
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

              <!-- ФОРМА РЕГИСТРАЦИИ -->
              <form id="form-register" class="auth-form hidden" onsubmit="doRegister(event); return false;">
                <label class="auth-label">
                  <span>Имя</span>
                  <input type="text" name="username" required minlength="2" maxlength="32" class="auth-input" placeholder="Ваше имя" />
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

            <!-- Соцсети -->
            <div class="auth-social">
              <button type="button" class="auth-social-btn" onclick="socialAuth('google')">Войти через Google</button>
              <button type="button" class="auth-social-btn" onclick="socialAuth('x')">Войти через X</button>
            </div>
          </div>
        </div>
      </section>
      <?php endif; ?>
    </main>
  </div>

  <div id="modal" class="modal hidden">
    <div class="modal-backdrop"></div>
    <div class="modal-content">
      <button class="modal-close" id="modal-close">×</button>
      <div id="modal-body"></div>
    </div>
  </div>

  <script>
    window.IS_CLIENT = <?= $isClient ? 'true' : 'false' ?>;
    window.CSRF_TOKEN = '<?php echo $csrfToken; ?>';
    window.AUTH_STATE = <?php echo json_encode($auth); ?>;
    window.FORCE_AUTH_VIEW = <?= $isAuthorized ? 'false' : 'true' ?>;
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
// Передаём объект напрямую (не JSON.stringify): иначе в C++ кавычки приходят
// экранированными и проверка req.find() не срабатывает.
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
