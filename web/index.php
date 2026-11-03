<?php
require_once __DIR__ . '/db.php';
getDB();
$isClient = isset($_GET['client']) && $_GET['client'] == '1';
?>
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CATio</title>
  <link rel="stylesheet" href="css/style.css" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <?php if ($isClient): ?>
  <style>.topbar{display:none!important}body{margin:0;background:#12110e}</style>
  <?php endif; ?>
</head>
<body>
  <div id="app">
    <?php if (!$isClient): ?>
    <header class="topbar">
      <div class="logo">
        <span class="logo-icon">C</span>
        <span class="logo-text">CATio</span>
      </div>
      <nav class="nav">
        <button class="nav-btn active" data-view="store">Магазин</button>
        <button class="nav-btn" data-view="library">Библиотека</button>
        <button class="nav-btn" data-view="community">Сообщество</button>
        <button class="nav-btn" data-view="profile">Профиль</button>
      </nav>
      <div class="user-area">
        <span class="username">admin</span>
        <div class="avatar">A</div>
      </div>
    </header>
    <?php endif; ?>

    <main class="main">
      <section id="view-store" class="view active">
        <div class="hero">
          <div class="hero-content">
            <h1>Открой новые инди-игры</h1>
            <p>CATio — полка инди-игр</p>
          </div>
        </div>
        <div class="section-header"><h2>Популярное сейчас</h2></div>
        <div id="games-grid" class="games-grid"><div class="loading">Загрузка игр...</div></div>
      </section>

      <section id="view-library" class="view">
        <div class="section-header"><h2>Моя библиотека</h2></div>
        <div id="library-grid" class="games-grid"><div class="loading">Загрузка библиотеки...</div></div>
      </section>

      <section id="view-community" class="view">
        <div class="placeholder">
          <h2>Сообщество</h2>
          <p>Обсуждения, скриншоты, новости и активность игроков.</p>
        </div>
      </section>

      <section id="view-profile" class="view">
        <div class="profile-page">
          <div class="profile-header">
            <div class="profile-avatar">A</div>
            <div class="profile-info">
              <h1 class="profile-name">admin</h1>
              <p class="profile-meta">В CATio с ноября 2026 · Баланс: <span class="profile-balance">7 501 ₽</span></p>
            </div>
          </div>
          <div class="profile-stats">
            <div class="stat"><div class="stat-num">0</div><div class="stat-label">Игр</div></div>
            <div class="stat"><div class="stat-num">0</div><div class="stat-label">Отзывов</div></div>
            <div class="stat"><div class="stat-num">0</div><div class="stat-label">Друзей</div></div>
          </div>
          <div class="section-header"><h2>Недавняя активность</h2></div>
          <div class="placeholder" style="padding:40px 20px">Пока нет активности</div>
        </div>
      </section>
    </main>
  </div>

  <div id="modal" class="modal hidden">
    <div class="modal-backdrop"></div>
    <div class="modal-content">
      <button class="modal-close" id="modal-close">×</button>
      <div id="modal-body"></div>
    </div>
  </div>
  <script>window.IS_CLIENT = <?= $isClient ? 'true' : 'false' ?>;</script>
  <script src="js/app.js"></script>
</body>
</html>
