// CATio frontend — clean vanilla JS
// Все запросы к API — асинхронные с таймаутом: вкладки не зависают,
// если сервер лёг (AbortController рвёт зависший fetch через FETCH_TIMEOUT мс).

const API_BASE = 'api/games.php';
const FETCH_TIMEOUT = 6000;

function $(sel, ctx = document) {
  return ctx.querySelector(sel);
}

function $$(sel, ctx = document) {
  return Array.from(ctx.querySelectorAll(sel));
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------- Fetch с таймаутом ----------
async function fetchJSON(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Офлайн-блок «Кот ушёл в запой» ----------
function renderOffline(container, retryFn, title) {
  container.innerHTML = `
    <div class="offline-block">
      <div class="offline-logo">C</div>
      <h2 class="offline-title">${escapeHtml(title || 'Кот ушёл в запой')}</h2>
      <p class="offline-text">
        Сервер CATio временно недоступен — страница не смогла дозвониться до полки.<br>
        Проверь, что Apache и MySQL запущены в XAMPP, и попробуй снова.
      </p>
      <button type="button" class="btn-retry" id="offline-retry">Попробовать снова</button>
    </div>`;
  container.querySelector('#offline-retry').addEventListener('click', retryFn);
}

function isOffline(err) {
  return err && (err.name === 'AbortError' || err instanceof TypeError);
}

function formatPrice(price) {
  const p = parseFloat(price);
  if (p === 0) return { text: 'Бесплатно', className: 'free' };
  return { text: `${p.toFixed(0)} ₽`, className: 'paid' };
}

function formatSize(bytes) {
  const b = parseInt(bytes, 10);
  if (!b) return '';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' КБ';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' МБ';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' ГБ';
}

function tagsToArray(tags) {
  if (!tags) return [];
  return tags.split(',').map(t => t.trim()).filter(Boolean);
}

// ---------- View switching ----------
function getViewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('view') || 'store';
}

function showView(name) {
  $$('.view').forEach(v => v.classList.remove('active'));
  const el = $(`#view-${name}`);
  if (el) el.classList.add('active');

  if (name === 'library') loadLibrary();
  if (name === 'store') loadStore();
}

// ---------- Store ----------
let storeCache = [];

async function loadStore() {
  const grid = $('#games-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading">Загрузка игр...</div>';

  try {
    const data = await fetchJSON(`${API_BASE}?action=list`);
    if (!data.ok) throw new Error(data.error || 'Ошибка загрузки');

    storeCache = data.games || [];

    if (!storeCache.length) {
      grid.innerHTML = '<div class="loading">Игр пока нет</div>';
      return;
    }

    renderStoreGrid(grid, storeCache);
  } catch (err) {
    if (isOffline(err)) {
      renderOffline(grid, loadStore, 'Кот ушёл в запой');
    } else {
      grid.innerHTML = `<div class="loading">Не удалось загрузить игры.<br><small>${escapeHtml(err.message)}</small></div>`;
    }
  }
}

function renderStoreGrid(grid, games) {
  grid.innerHTML = '';
  games.forEach(game => {
    grid.appendChild(createGameCard(game, { buttonLabel: 'Подробнее' }));
  });
}

function createGameCard(game, opts = {}) {
  const card = document.createElement('article');
  card.className = 'game-card';
  card.dataset.id = game.id;

  const price = formatPrice(game.price);
  const tags = tagsToArray(game.tags).slice(0, 3);

  card.innerHTML = `
    <div class="game-cover">
      ${game.cover_url ? `<img src="${escapeHtml(game.cover_url)}" alt="${escapeHtml(game.title)}" />` : '🎮'}
    </div>
    <div class="game-info">
      <h3 class="game-title">${escapeHtml(game.title)}</h3>
      <div class="game-dev">${escapeHtml(game.developer_name || 'Unknown')}</div>
      <div class="game-tags">
        ${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
      </div>
      <div class="game-footer">
        <span class="price ${price.className}">${price.text}</span>
        <button type="button" class="btn-get" data-id="${game.id}">${escapeHtml(opts.buttonLabel || 'Подробнее')}</button>
      </div>
    </div>
  `;

  card.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-get')) return;
    openGameModal(game, opts);
  });

  card.querySelector('.btn-get').addEventListener('click', (e) => {
    e.stopPropagation();
    openGameModal(game, opts);
  });

  return card;
}

// ---------- Library ----------
async function loadLibrary() {
  const grid = $('#library-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading">Загрузка библиотеки...</div>';

  try {
    const data = await fetchJSON(`${API_BASE}?action=library`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');

    if (!data.library.length) {
      grid.innerHTML = '<div class="loading">Библиотека пуста. Добавь игры из магазина!</div>';
      return;
    }

    grid.innerHTML = '';
    data.library.forEach(game => {
      const card = createGameCard(game, { buttonLabel: 'Скачать' });
      grid.appendChild(card);
    });
  } catch (err) {
    if (isOffline(err)) {
      renderOffline(grid, loadLibrary, 'Кот ушёл в запой');
    } else {
      grid.innerHTML = `<div class="loading">Ошибка загрузки библиотеки<br><small>${escapeHtml(err.message)}</small></div>`;
    }
  }
}

// ---------- Сборки и скачивание ----------
async function loadBuilds(gameId) {
  const data = await fetchJSON(`${API_BASE}?action=builds&game_id=${gameId}`);
  if (!data.ok) throw new Error(data.error || 'Ошибка загрузки сборок');
  return data.builds || [];
}

function buildDownloadUrl(buildId) {
  return `${API_BASE}?action=download&build_id=${buildId}`;
}

function renderBuildsList(builds) {
  if (!builds.length) {
    return '<p class="modal-builds-empty">Сборок пока нет — скоро добавим.</p>';
  }
  const platformName = { windows: 'Windows', linux: 'Linux', mac: 'macOS', web: 'Web' };
  return `
    <div class="modal-builds">
      <h3 class="modal-builds-title">Сборки</h3>
      ${builds.map(b => `
        <div class="build-row">
          <div class="build-info">
            <span class="build-platform">${escapeHtml(platformName[b.platform] || b.platform)}</span>
            <span class="build-version">v${escapeHtml(b.version)}</span>
            ${b.file_size_bytes ? `<span class="build-size">${formatSize(b.file_size_bytes)}</span>` : ''}
          </div>
          <a class="btn-download" href="${buildDownloadUrl(b.id)}" download>Скачать</a>
        </div>
      `).join('')}
    </div>`;
}

// ---------- Modal ----------
async function openGameModal(game, opts = {}) {
  const modal = $('#modal');
  const body = $('#modal-body');
  const price = formatPrice(game.price);
  const owned = opts.buttonLabel === 'Скачать';

  body.innerHTML = `
    <h2 class="modal-title">${escapeHtml(game.title)}</h2>
    <div class="modal-dev">от ${escapeHtml(game.developer_name || 'Unknown')}</div>
    <p class="modal-desc">${escapeHtml(game.description || game.short_description || 'Описание отсутствует.')}</p>
    <div class="modal-builds-area"><div class="loading" style="padding:16px 0">Загрузка сборок...</div></div>
    <div class="modal-actions">
      <button type="button" class="btn-primary" id="btn-get-game">
        ${owned
          ? 'Скачать'
          : (price.className === 'free' ? 'Получить бесплатно' : `Купить за ${price.text}`)}
      </button>
      <span class="modal-price">${price.text}</span>
    </div>
  `;

  modal.classList.remove('hidden');

  // Подтягиваем сборки
  const area = body.querySelector('.modal-builds-area');
  try {
    const builds = await loadBuilds(game.id);
    area.innerHTML = renderBuildsList(builds);
  } catch (err) {
    if (isOffline(err)) {
      area.innerHTML = '<p class="modal-builds-empty">Сборки недоступны — нет связи с сервером.</p>';
    } else {
      area.innerHTML = `<p class="modal-builds-empty">${escapeHtml(err.message)}</p>`;
    }
  }

  $('#btn-get-game').onclick = () => {
    if (owned) {
      const btn = body.querySelector('.btn-download');
      if (btn) btn.click();
      else closeModal();
      return;
    }
    // Демо-покупка: платные пока только имитируем, бесплатные — сразу в библиотеку
    if (price.className === 'free') {
      closeModal();
      alert(`"${game.title}" добавлена в библиотеку! (демо)`);
    } else {
      alert(`Покупка "${game.title}" за ${price.text} — демо-режим`);
    }
  };
}

function closeModal() {
  $('#modal').classList.add('hidden');
}

function initModal() {
  $('#modal-close').addEventListener('click', closeModal);
  $('.modal-backdrop').addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

// ---------- Меню под аватаркой ----------
function initAvatarMenu() {
  const btn = $('#avatar-btn');
  const menu = $('#user-menu');
  if (!btn || !menu) return;

  function closeMenu() {
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = menu.classList.contains('hidden');
    menu.classList.toggle('hidden');
    btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
  });

  document.addEventListener('click', (e) => {
    if (!menu.classList.contains('hidden') && !menu.contains(e.target) && e.target !== btn) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  const settingsBtn = $('#menu-settings');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      closeMenu();
      alert('Настройки скоро появятся. Кот ещё их пакует.');
    });
  }

  const logoutBtn = $('#menu-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      closeMenu();
      logout();
    });
  }
}

// ---------- Web navigation (only when not in native client) ----------
function initWebNav() {
  if (window.IS_CLIENT) return; // native launcher handles navigation

  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      $$('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showView(view);
    });
  });
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  initModal();
  initWebNav();
  initAvatarMenu();
  // Неавторизованным всегда показываем auth, даже если в URL другой view
  const view = (window.FORCE_AUTH_VIEW && $('#view-auth')) ? 'auth' : getViewFromUrl();
  showView(view);
});
