// CATio frontend — clean vanilla JS
// Все запросы к API — асинхронные с таймаутом: вкладки не зависают,
// если сервер лёг (AbortController рвёт зависший fetch через FETCH_TIMEOUT мс).

const API_BASE = 'api/games.php';
const USER_API = 'api/user.php';
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

async function postJSON(url, payload) {
  return fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, csrf_token: window.CSRF_TOKEN }),
  });
}

// ---------- Офлайн-блок «Кот ушёл в запой» ----------
function renderOffline(container, retryFn, title) {
  container.innerHTML = `
    <div class="offline-block">
      <img class="offline-logo" src="logo.ico" alt="" style="width:72px;height:72px;border-radius:18px;background:none;display:block" />
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

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).replace(' ', 'T'));
  if (isNaN(d)) return '';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).replace(' ', 'T'));
  if (isNaN(d)) return '';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) +
    ' в ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function tagsToArray(tags) {
  if (!tags) return [];
  return tags.split(',').map(t => t.trim()).filter(Boolean);
}

function starsHtml(rating, count) {
  const full = Math.round(parseFloat(rating) || 0);
  let html = '';
  for (let i = 1; i <= 5; i++) {
    html += `<span class="star ${i <= full ? 'filled' : ''}">★</span>`;
  }
  return `<span class="stars">${html}</span> <span class="rating-num">${(parseFloat(rating) || 0).toFixed(1)}</span>` +
    (count !== undefined ? ` <span class="rating-count">(${count})</span>` : '');
}

// ---------- Тосты ----------
let toastTimer = null;
function toast(msg) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- Баланс в шапке и профиле ----------
function updateBalance(balance) {
  const text = `${Number(balance).toLocaleString('ru-RU')} ₽`;
  const b1 = $('#user-balance');
  const b2 = $('#profile-balance');
  if (b1) b1.textContent = text;
  if (b2) b2.textContent = text;
  if (window.AUTH_STATE && window.AUTH_STATE.user) {
    window.AUTH_STATE.user.balance = balance;
    if (window.IS_CLIENT && typeof window.catioSync === 'function') {
      try { window.catioSync(window.AUTH_STATE); } catch (e) {}
    }
  }
}

// ---------- Навигация по видам ----------
function getViewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('view') || 'store';
}

function syncUrl(view, gameId) {
  const params = new URLSearchParams();
  params.set('view', view);
  if (view === 'game' && gameId) params.set('id', gameId);
  if (window.IS_CLIENT) params.set('client', '1');
  history.replaceState(null, '', '?' + params.toString());
}

function showView(name, gameId) {
  // Библиотека живёт только в десктоп-клиенте
  if (name === 'library' && !window.IS_CLIENT) name = 'store';

  $$('.view').forEach(v => v.classList.remove('active'));
  const el = $(`#view-${name}`);
  if (!el) return;
  el.classList.add('active');

  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));

  syncUrl(name, gameId);

  if (name === 'store') loadStore();
  if (name === 'library') loadLibrary();
  if (name === 'community') loadWorkshop();
  if (name === 'downloads') renderDownloadsView();
  if (name === 'profile') loadProfile();
  if (name === 'game' && gameId) loadGamePage(gameId);
}

function gotoView(name) {
  showView(name);
}

function gotoGame(id) {
  showView('game', id);
}

// ============================================================
//  КАТАЛОГ (только готовые игры; ассеты — в Мастерской)
// ============================================================
let storeCache = [];
let storeGenre = 'all';
let storeSearch = '';
let storeSort = 'new';

async function loadStore() {
  const grid = $('#games-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading">Загрузка каталога...</div>';

  try {
    const data = await fetchJSON(`${API_BASE}?action=list&category=game`);
    if (!data.ok) throw new Error(data.error || 'Ошибка загрузки');

    storeCache = data.games || [];
    updateFeaturedHero();
    renderStoreGrid();
  } catch (err) {
    if (isOffline(err)) {
      renderOffline(grid, loadStore, 'Кот ушёл в запой');
    } else {
      grid.innerHTML = `<div class="loading">Не удалось загрузить каталог.<br><small>${escapeHtml(err.message)}</small></div>`;
    }
  }
}

function updateFeaturedHero() {
  // Герой каталога ведёт на реальную страницу игры, если она есть в базе
  const hero = $('#featured-hero');
  const game = storeCache.find(g => g.slug === 'lisiy-fonar') || storeCache[0];
  if (!hero || !game) return;
  const cover = $('#featured-hero-cover');
  if (cover) {
    cover.innerHTML = `<img src="${escapeHtml(game.cover_src)}" alt="${escapeHtml(game.title)}" class="hero-cover-img" />`;
  }
  hero.style.cursor = 'pointer';
  hero.onclick = () => gotoGame(game.id);
}

function applyStoreFilters(games) {
  let out = games;
  if (storeGenre !== 'all') {
    out = out.filter(g => g.genre === storeGenre);
  }
  if (storeSearch) {
    const q = storeSearch.toLowerCase();
    out = out.filter(g =>
      (g.title || '').toLowerCase().includes(q) ||
      (g.short_description || '').toLowerCase().includes(q) ||
      (g.developer_name || '').toLowerCase().includes(q)
    );
  }
  if (storeSort === 'rating') {
    out = [...out].sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
  } else if (storeSort === 'price') {
    out = [...out].sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
  }
  return out;
}

function renderStoreGrid() {
  const grid = $('#games-grid');
  if (!grid) return;
  const games = applyStoreFilters(storeCache);

  if (!games.length) {
    grid.innerHTML = '<div class="loading">Ничего не найдено. Попробуй другой запрос.</div>';
    return;
  }

  grid.innerHTML = '';
  games.forEach(game => grid.appendChild(createGameCard(game)));
}

// ============================================================
//  МАСТЕРСКАЯ (ассеты, инструменты, документация)
// ============================================================
let workshopCache = [];

async function loadWorkshop() {
  const grid = $('#workshop-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading">Загрузка мастерской...</div>';

  try {
    const data = await fetchJSON(`${API_BASE}?action=list&category=asset`);
    if (!data.ok) throw new Error(data.error || 'Ошибка загрузки');

    workshopCache = data.games || [];

    if (!workshopCache.length) {
      grid.innerHTML = '<div class="loading">В мастерской пока пусто.</div>';
      return;
    }

    grid.innerHTML = '';
    workshopCache.forEach(game => grid.appendChild(createGameCard(game)));
  } catch (err) {
    if (isOffline(err)) {
      renderOffline(grid, loadWorkshop, 'Кот ушёл в запой');
    } else {
      grid.innerHTML = `<div class="loading">Не удалось загрузить мастерскую.<br><small>${escapeHtml(err.message)}</small></div>`;
    }
  }
}

// ---------- Карточка в каталоге / мастерской ----------
// Кнопка: «В библиотеку» (бесплатно) / «Купить» (платно) / «В библиотеке» (уже есть).
// Клик по самой карточке открывает страницу игры.
function createGameCard(game) {
  const card = document.createElement('article');
  card.className = 'game-card';
  card.dataset.id = game.id;

  const price = formatPrice(game.price);
  const tags = tagsToArray(game.tags).slice(0, 3);

  card.innerHTML = `
    <div class="game-cover">
      <img src="${escapeHtml(game.cover_src || ('media.php?type=cover&id=' + game.id))}" alt="${escapeHtml(game.title)}" loading="lazy" />
      ${game.category === 'asset' ? '<span class="card-badge">Ассет</span>' : ''}
      ${game.owned ? '<span class="card-badge owned">В библиотеке</span>' : ''}
    </div>
    <div class="game-info">
      <h3 class="game-title">${escapeHtml(game.title)}</h3>
      <div class="game-dev">${escapeHtml(game.developer_name || game.developer || 'Unknown')}</div>
      <div class="game-card-rating">${starsHtml(game.rating, game.ratings_count)}</div>
      <div class="game-tags">
        ${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
      </div>
      <div class="game-footer">
        <span class="price ${price.className}">${price.text}</span>
        <button type="button" class="btn-get ${game.owned ? 'owned' : ''}" data-id="${game.id}"></button>
      </div>
    </div>
  `;

  const btn = card.querySelector('.btn-get');
  paintCardButton(btn, game, price);

  card.addEventListener('click', () => gotoGame(game.id));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    buyFromCard(btn, game, price);
  });

  return card;
}

function paintCardButton(btn, game, price) {
  if (game.owned) {
    btn.textContent = 'В библиотеке';
    btn.classList.add('owned');
    btn.disabled = false;
  } else {
    btn.textContent = price.className === 'free' ? 'В библиотеку' : 'Купить';
    btn.classList.remove('owned');
    btn.disabled = false;
  }
}

async function buyFromCard(btn, game, price) {
  if (game.owned) return; // уже есть — кнопка просто ярлык
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = 'Оформляем...';
  try {
    const data = await postJSON(`${API_BASE}?action=buy`, { game_id: game.id });
    if (!data.ok) throw new Error(data.error || 'Не удалось оформить');
    if (data.balance !== undefined) updateBalance(data.balance);
    game.owned = true;
    paintCardButton(btn, game, price);
    // Бейдж «В библиотеке» на обложке
    const cover = btn.closest('.game-card').querySelector('.game-cover');
    if (cover && !cover.querySelector('.card-badge.owned')) {
      const badge = document.createElement('span');
      badge.className = 'card-badge owned';
      badge.textContent = 'В библиотеке';
      cover.appendChild(badge);
    }
    toast(data.message || `«${game.title}» добавлена в библиотеку`);
  } catch (err) {
    btn.textContent = oldText;
    btn.disabled = false;
    toast(err.message || 'Ошибка покупки');
  }
}

function initStoreControls() {
  const search = $('#search-input');
  if (search) {
    search.addEventListener('input', () => {
      storeSearch = search.value.trim();
      renderStoreGrid();
    });
  }

  const sort = $('#sort-select');
  if (sort) {
    sort.addEventListener('change', () => {
      storeSort = sort.value;
      renderStoreGrid();
    });
  }

  $$('#genre-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $$('#genre-chips .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      storeGenre = chip.dataset.genre;
      renderStoreGrid();
    });
  });
}

// ============================================================
//  СТРАНИЦА ИГРЫ (как на itch.io)
// ============================================================
let currentGame = null;

async function loadGamePage(id) {
  const wrap = $('#game-page');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading">Загрузка страницы игры...</div>';

  try {
    const data = await fetchJSON(`${API_BASE}?action=get&id=${id}`);
    if (!data.ok) throw new Error(data.error || 'Игра не найдена');
    currentGame = data;
    renderGamePage(wrap, data);
  } catch (err) {
    if (isOffline(err)) {
      renderOffline(wrap, () => loadGamePage(id), 'Кот ушёл в запой');
    } else {
      wrap.innerHTML = `<div class="loading">${escapeHtml(err.message)}<br><button type="button" class="btn-retry" onclick="gotoView('store')">Назад в каталог</button></div>`;
    }
  }
}

function renderGamePage(wrap, data) {
  const g = data.game;
  const price = formatPrice(g.price);
  const tags = tagsToArray(g.tags);
  const shots = data.screenshots || [];
  const authorized = data.viewer && data.viewer.authorized;

  wrap.innerHTML = `
    <div class="game-page">
      <button type="button" class="btn-back" onclick="gotoView('store')">← Назад в каталог</button>

      <div class="game-hero">
        <div class="game-gallery">
          <div class="game-gallery-main">
            <img id="gallery-main-img" src="${escapeHtml(shots[0] || g.cover_src)}" alt="${escapeHtml(g.title)}" />
          </div>
          ${shots.length > 1 ? `
          <div class="game-gallery-thumbs" id="gallery-thumbs">
            ${shots.map((s, i) => `
              <button type="button" class="gallery-thumb ${i === 0 ? 'active' : ''}" data-src="${escapeHtml(s)}">
                <img src="${escapeHtml(s)}" alt="Скриншот ${i + 1}" loading="lazy" />
              </button>`).join('')}
          </div>` : ''}
        </div>

        <div class="game-side">
          <img class="game-side-cover" src="${escapeHtml(g.cover_src)}" alt="" />
          <h1 class="game-page-title">${escapeHtml(g.title)}</h1>
          <p class="game-page-dev">от <b>${escapeHtml(g.developer_name || g.developer || 'Unknown')}</b></p>
          <div class="game-page-rating">${starsHtml(g.rating, data.ratings_count)}</div>

          ${g.short_description ? `<p class="game-page-short">${escapeHtml(g.short_description)}</p>` : ''}

          <div class="game-tags game-page-tags">
            ${g.genre ? `<span class="tag genre">${escapeHtml(g.genre)}</span>` : ''}
            ${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
          </div>

          <div class="game-buy-box">
            <div class="game-buy-price price ${price.className}">${price.text}</div>
            <button type="button" class="btn-primary btn-buy" id="btn-buy-game"></button>
            <p class="game-buy-note" id="buy-note"></p>
          </div>

          ${authorized ? `
          <div class="game-rate-box">
            <p class="game-rate-label">Твоя оценка:</p>
            <div class="rate-stars" id="rate-stars">
              ${[1,2,3,4,5].map(v => `<button type="button" class="rate-star ${g.user_rating && v <= g.user_rating ? 'filled' : ''}" data-value="${v}">★</button>`).join('')}
            </div>
          </div>` : ''}

          <div class="game-page-meta">
            <div><span>Скачиваний</span><b>${Number(g.download_count || 0).toLocaleString('ru-RU')}</b></div>
            <div><span>Добавлена</span><b>${formatDate(g.created_at)}</b></div>
          </div>
        </div>
      </div>

      <div class="game-cols">
        <div class="game-col-main">
          <div class="section-header"><h2>Об игре</h2></div>
          <div class="game-description">
            ${(g.description || 'Описание отсутствует.').split(/\n+/).map(p => `<p>${escapeHtml(p)}</p>`).join('')}
          </div>

          <div class="section-header"><h2>Сборки и файлы</h2></div>
          <div id="game-builds">${renderBuildsList(data.builds || [], g)}</div>

          <div class="section-header"><h2>Комментарии <span class="comments-count" id="comments-count">${data.comments.length}</span></h2></div>
          ${authorized ? `
          <form class="comment-form" id="comment-form">
            <textarea id="comment-input" class="comment-input" maxlength="1000" rows="3" placeholder="Расскажи, что думаешь об игре..." required></textarea>
            <div class="comment-form-row">
              <span class="comment-hint">от 2 до 1000 символов</span>
              <button type="submit" class="btn-primary">Отправить</button>
            </div>
            <p class="comment-error hidden" id="comment-error"></p>
          </form>` : '<p class="comment-login-note">Войди, чтобы оставить комментарий.</p>'}
          <div id="comments-list" class="comments-list"></div>
        </div>
      </div>
    </div>
  `;

  initGallery(wrap);
  initBuyButton(wrap, g);
  initRateStars(wrap, g);
  renderComments(data.comments, data.viewer);
  initCommentForm(g, data.viewer);
  initBuildButtons(wrap, g);
}

// ---------- Галерея скриншотов ----------
function initGallery(wrap) {
  const main = $('#gallery-main-img', wrap);
  const thumbs = $$('.gallery-thumb', wrap);
  thumbs.forEach(thumb => {
    thumb.addEventListener('click', () => {
      if (main) main.src = thumb.dataset.src;
      thumbs.forEach(t => t.classList.remove('active'));
      thumb.classList.add('active');
    });
  });
  if (main) {
    main.addEventListener('click', () => openLightbox(main.src));
  }
}

function openLightbox(src) {
  const lb = $('#lightbox');
  const img = $('#lightbox-img');
  if (!lb || !img) return;
  img.src = src;
  lb.classList.remove('hidden');
}

function initLightbox() {
  const lb = $('#lightbox');
  if (!lb) return;
  const close = () => lb.classList.add('hidden');
  $('#lightbox-close').addEventListener('click', close);
  $('#lightbox-backdrop').addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

// ---------- Кнопка покупки ----------
function refreshBuyButton(g) {
  const btn = $('#btn-buy-game');
  const note = $('#buy-note');
  if (!btn) return;
  const price = formatPrice(g.price);
  if (g.owned) {
    btn.textContent = 'Скачать';
    btn.classList.add('owned');
    if (note) note.textContent = 'Уже в твоей библиотеке';
  } else {
    btn.textContent = price.className === 'free' ? 'Получить бесплатно' : `Купить за ${price.text}`;
    btn.classList.remove('owned');
    if (note) note.textContent = '';
  }
}

function initBuyButton(wrap, g) {
  refreshBuyButton(g);
  const btn = $('#btn-buy-game', wrap);
  if (!btn) return;

  btn.addEventListener('click', async () => {
    if (g.owned) {
      // В библиотеке → предлагаем сборки к загрузке
      const first = $('#game-builds .btn-download', wrap);
      if (first) first.click();
      else gotoView('downloads');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Оформляем...';
    try {
      const data = await postJSON(`${API_BASE}?action=buy`, { game_id: g.id });
      if (!data.ok) throw new Error(data.error || 'Не удалось оформить');
      if (data.balance !== undefined) updateBalance(data.balance);
      g.owned = true;
      refreshBuyButton(g);
      toast(data.message || 'Добавлено в библиотеку');
    } catch (err) {
      toast(err.message || 'Ошибка покупки');
    } finally {
      btn.disabled = false;
      if (!g.owned) refreshBuyButton(g);
    }
  });
}

// ---------- Оценка звёздами ----------
function initRateStars(wrap, g) {
  const stars = $$('.rate-star', wrap);
  if (!stars.length) return;
  const paint = (n) => stars.forEach(s => s.classList.toggle('filled', +s.dataset.value <= n));

  stars.forEach(star => {
    star.addEventListener('mouseenter', () => paint(+star.dataset.value));
    star.addEventListener('click', async () => {
      const value = +star.dataset.value;
      try {
        const data = await postJSON(`${API_BASE}?action=rate`, { game_id: g.id, value });
        if (!data.ok) throw new Error(data.error || 'Не удалось оценить');
        g.user_rating = value;
        paint(value);
        const ratingBox = $('.game-page-rating', wrap);
        if (ratingBox && currentGame) {
          currentGame.game.rating = data.rating;
          ratingBox.innerHTML = starsHtml(data.rating, (currentGame.ratings_count || 0) + 1);
        }
        toast(`Оценка ${value} из 5 сохранена`);
      } catch (err) {
        toast(err.message || 'Ошибка');
      }
    });
  });
  const box = $('#rate-stars', wrap);
  if (box) box.addEventListener('mouseleave', () => paint(g.user_rating || 0));
}

// ---------- Сборки на странице игры ----------
function renderBuildsList(builds, g) {
  if (!builds.length) {
    return '<p class="modal-builds-empty">Сборок пока нет — скоро добавим.</p>';
  }
  const platformName = { windows: 'Windows', linux: 'Linux', mac: 'macOS', web: 'Web' };
  return `
    <div class="modal-builds">
      ${builds.map(b => `
        <div class="build-row">
          <div class="build-info">
            <span class="build-platform">${escapeHtml(platformName[b.platform] || b.platform)}</span>
            <span class="build-version">v${escapeHtml(b.version)}</span>
            ${b.file_size_bytes ? `<span class="build-size">${formatSize(b.file_size_bytes)}</span>` : ''}
          </div>
          <button type="button" class="btn-download" data-build-id="${b.id}"
            data-platform="${escapeHtml(b.platform)}" data-version="${escapeHtml(b.version)}"
            data-size="${b.file_size_bytes || 0}">В загрузки</button>
        </div>
      `).join('')}
    </div>`;
}

function initBuildButtons(wrap, g) {
  $$('.btn-download', wrap).forEach(btn => {
    btn.addEventListener('click', () => {
      enqueueDownload({
        buildId: +btn.dataset.buildId,
        gameId: g.id,
        title: g.title,
        platform: btn.dataset.platform,
        version: btn.dataset.version,
        size: +btn.dataset.size || 0,
      });
    });
  });
}

// ---------- Комментарии ----------
function renderComments(comments, viewer) {
  const list = $('#comments-list');
  if (!list) return;
  const count = $('#comments-count');
  if (count) count.textContent = comments.length;

  if (!comments.length) {
    list.innerHTML = '<p class="comments-empty">Комментариев пока нет. Будь первым!</p>';
    return;
  }
  list.innerHTML = '';
  comments.forEach(c => list.appendChild(createCommentEl(c, viewer)));
}

function createCommentEl(c, viewer) {
  const el = document.createElement('div');
  el.className = 'comment';
  el.dataset.id = c.id;

  const canDelete = viewer && viewer.authorized &&
    (viewer.is_admin || viewer.user_id === +c.user_id);
  const avatar = c.avatar || escapeHtml((c.username || '?').charAt(0).toUpperCase());
  const color = c.avatar_color || '#ef5b2c';

  el.innerHTML = `
    <div class="comment-avatar" style="background:${escapeHtml(color)}">${avatar}</div>
    <div class="comment-body">
      <div class="comment-head">
        <b class="comment-author">${escapeHtml(c.username)}</b>
        <span class="comment-date">${formatDateTime(c.created_at)}</span>
        ${canDelete ? '<button type="button" class="comment-delete" title="Удалить">×</button>' : ''}
      </div>
      <p class="comment-text">${escapeHtml(c.body)}</p>
    </div>
  `;

  const del = el.querySelector('.comment-delete');
  if (del) {
    del.addEventListener('click', async () => {
      if (!confirm('Удалить комментарий?')) return;
      try {
        const data = await postJSON(`${API_BASE}?action=delete_comment`, { comment_id: c.id });
        if (!data.ok) throw new Error(data.error || 'Не удалось удалить');
        el.remove();
        const count = $('#comments-count');
        if (count) count.textContent = Math.max(0, +count.textContent - 1);
      } catch (err) {
        toast(err.message || 'Ошибка');
      }
    });
  }
  return el;
}

function initCommentForm(g, viewer) {
  const form = $('#comment-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#comment-input');
    const errBox = $('#comment-error');
    const btn = form.querySelector('button[type="submit"]');
    errBox.classList.add('hidden');
    btn.disabled = true;
    try {
      const data = await postJSON(`${API_BASE}?action=comment`, { game_id: g.id, body: input.value.trim() });
      if (!data.ok) throw new Error(data.error || 'Не удалось отправить');
      const list = $('#comments-list');
      const empty = list.querySelector('.comments-empty');
      if (empty) empty.remove();
      list.prepend(createCommentEl(data.comment, viewer));
      const count = $('#comments-count');
      if (count) count.textContent = +count.textContent + 1;
      input.value = '';
      toast('Комментарий опубликован');
    } catch (err) {
      errBox.textContent = err.message || 'Ошибка';
      errBox.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  });
}

// ============================================================
//  БИБЛИОТЕКА (как в Steam: список слева, детали справа)
// ============================================================
let libraryCache = [];
let libraryFilter = 'all';
let librarySearch = '';
let librarySelectedId = null;

async function loadLibrary() {
  const list = $('#library-list');
  if (!list) return;
  list.innerHTML = '<div class="loading">Загрузка библиотеки...</div>';

  try {
    const data = await fetchJSON(`${API_BASE}?action=library`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');

    libraryCache = data.library || [];
    renderLibraryList();

    // Автовыбор первой игры, если ещё ничего не выбрано
    if (libraryCache.length && !librarySelectedId) {
      selectLibraryGame(libraryCache[0].id);
    } else if (librarySelectedId) {
      selectLibraryGame(librarySelectedId);
    } else {
      renderLibraryEmptyDetail();
    }
  } catch (err) {
    if (isOffline(err)) {
      renderOffline(list, loadLibrary, 'Кот ушёл в запой');
    } else {
      list.innerHTML = `<div class="loading">Ошибка загрузки<br><small>${escapeHtml(err.message)}</small></div>`;
    }
  }
}

function renderLibraryList() {
  const list = $('#library-list');
  if (!list) return;

  let items = libraryCache;
  if (libraryFilter !== 'all') {
    items = items.filter(g => g.category === libraryFilter);
  }
  if (librarySearch) {
    const q = librarySearch.toLowerCase();
    items = items.filter(g => (g.title || '').toLowerCase().includes(q));
  }

  if (!items.length) {
    list.innerHTML = libraryCache.length
      ? '<div class="loading">Ничего не найдено</div>'
      : `<div class="library-empty">
          <p>Библиотека пуста.</p>
          <button type="button" class="btn-primary" onclick="gotoView('store')">В каталог</button>
        </div>`;
    return;
  }

  list.innerHTML = '';
  items.forEach(g => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'library-item' + (+librarySelectedId === +g.id ? ' active' : '');
    item.dataset.id = g.id;
    item.innerHTML = `
      <span class="library-item-cover" style="background:${escapeHtml(g.cover_color || '#2e2a24')}">${escapeHtml(g.cover_emoji || '🎮')}</span>
      <span class="library-item-info">
        <span class="library-item-title">${escapeHtml(g.title)}</span>
        <span class="library-item-meta">${g.category === 'asset' ? 'Ассет' : escapeHtml(g.genre || '')}</span>
      </span>
    `;
    item.addEventListener('click', () => selectLibraryGame(g.id));
    list.appendChild(item);
  });
}

function renderLibraryEmptyDetail() {
  const detail = $('#library-detail');
  if (!detail) return;
  detail.innerHTML = `
    <div class="library-detail-empty">
      <div class="library-detail-empty-icon">🐈</div>
      <p>Выбери игру слева — здесь появятся подробности, сборки и скриншоты.</p>
    </div>`;
}

async function selectLibraryGame(id) {
  librarySelectedId = id;
  $$('#library-list .library-item').forEach(el => {
    el.classList.toggle('active', +el.dataset.id === +id);
  });

  const detail = $('#library-detail');
  if (!detail) return;
  detail.innerHTML = '<div class="loading">Загружаю полку...</div>';

  try {
    const data = await fetchJSON(`${API_BASE}?action=get&id=${id}`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    renderLibraryDetail(detail, data);
  } catch (err) {
    if (isOffline(err)) {
      renderOffline(detail, () => selectLibraryGame(id), 'Кот ушёл в запой');
    } else {
      detail.innerHTML = `<div class="loading">${escapeHtml(err.message)}</div>`;
    }
  }
}

function renderLibraryDetail(detail, data) {
  const g = data.game;
  const entry = libraryCache.find(x => +x.id === +g.id) || {};
  const shots = data.screenshots || [];
  const price = formatPrice(g.price);

  detail.innerHTML = `
    <div class="lib-detail-inner">
      <div class="lib-detail-hero" style="background:linear-gradient(160deg, ${escapeHtml(g.cover_color || '#ef5b2c')}2e, transparent 55%)">
        <img class="lib-detail-cover" src="${escapeHtml(g.cover_src)}" alt="" />
        <div class="lib-detail-head">
          <h2 class="lib-detail-title">${escapeHtml(g.title)}</h2>
          <p class="lib-detail-dev">от ${escapeHtml(g.developer_name || g.developer || 'Unknown')}</p>
          <div class="lib-detail-rating">${starsHtml(g.rating)}</div>
          <div class="lib-detail-meta">
            <div><span>Тип</span><b>${g.category === 'asset' ? 'Ассет-пак' : 'Игра'}</b></div>
            <div><span>Цена</span><b>${price.text}</b></div>
            <div><span>Добавлена</span><b>${formatDate(entry.added_at)}</b></div>
            <div><span>Последний запуск</span><b>${entry.last_played ? formatDateTime(entry.last_played) : 'ещё не запускалась'}</b></div>
          </div>
          <div class="lib-detail-actions">
            <button type="button" class="btn-primary" id="lib-play-btn">
              ${g.category === 'asset' ? 'Скачать пакет' : 'Играть'}
            </button>
            <button type="button" class="btn-ghost" id="lib-page-btn">Страница игры</button>
          </div>
        </div>
      </div>

      ${shots.length ? `
      <div class="section-header"><h3>Скриншоты</h3></div>
      <div class="lib-shots">
        ${shots.map(s => `<button type="button" class="lib-shot" data-src="${escapeHtml(s)}"><img src="${escapeHtml(s)}" alt="Скриншот" loading="lazy" /></button>`).join('')}
      </div>` : ''}

      <div class="section-header"><h3>Файлы</h3></div>
      <div id="lib-builds">${renderBuildsList(data.builds || [], g)}</div>

      <div class="section-header"><h3>Описание</h3></div>
      <div class="lib-description">
        ${(g.description || '').split(/\n+/).filter(Boolean).map(p => `<p>${escapeHtml(p)}</p>`).join('') || '<p>Без описания.</p>'}
      </div>
    </div>
  `;

  $('#lib-page-btn', detail).addEventListener('click', () => gotoGame(g.id));

  $('#lib-play-btn', detail).addEventListener('click', async () => {
    // «Играть» как в Steam: отмечаем запуск и отдаём сборку
    postJSON(`${API_BASE}?action=launch`, { game_id: g.id }).catch(() => {});
    if (entry) entry.last_played = new Date().toISOString();
    const first = $('#lib-builds .btn-download', detail);
    if (first) {
      first.click();
    } else {
      toast('Сборок пока нет');
    }
  });

  initBuildButtons(detail, g);

  $$('.lib-shot', detail).forEach(shot => {
    shot.addEventListener('click', () => openLightbox(shot.dataset.src));
  });
}

function initLibraryControls() {
  const search = $('#library-search');
  if (search) {
    search.addEventListener('input', () => {
      librarySearch = search.value.trim();
      renderLibraryList();
    });
  }
  const filters = $('#library-filters');
  if (filters) {
    $$('.lib-filter', filters).forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.lib-filter', filters).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        libraryFilter = btn.dataset.filter;
        renderLibraryList();
      });
    });
  }
}

// ============================================================
//  ЗАГРУЗКИ (как в Steam): очередь, прогресс, скорость, пауза
// ============================================================
// Сервер отдаёт файл потоком (и поддерживает Range — докачка с места паузы),
// поэтому прогресс и скорость здесь настоящие.
const dm = {
  queue: [],        // {buildId, title, platform, version, size, status}
  active: null,
  pausedItem: null, // загрузка на паузе (куски сохранены, докачаем с Range)
  history: [],      // завершённые {title, platform, version, size, at}
  seq: 0,
};

function updateDownloadsBadge() {
  const badge = $('#downloads-badge');
  if (!badge) return;
  const n = dm.queue.length + (dm.active ? 1 : 0) + (dm.pausedItem ? 1 : 0);
  badge.textContent = n;
  badge.classList.toggle('hidden', n === 0);
}

function enqueueDownload(item) {
  const already =
    (dm.active && dm.active.buildId === item.buildId) ||
    dm.queue.some(q => q.buildId === item.buildId);
  if (already) {
    toast('Эта сборка уже в очереди загрузок');
    gotoView('downloads');
    return;
  }
  item.id = ++dm.seq;
  item.received = 0;
  item.status = 'queued';
  dm.queue.push(item);
  toast(`«${item.title}» добавлена в загрузки`);
  updateDownloadsBadge();
  if (getViewFromUrl() === 'downloads') renderDownloadsView();
  pumpDownloads();
}

async function pumpDownloads() {
  if (dm.active || !dm.queue.length) {
    renderDownloadsView();
    return;
  }
  const item = dm.queue.shift();
  await runDownload(item, item.status === 'queued' && item.received ? item.received : 0);
  setTimeout(pumpDownloads, 0);
}

async function runDownload(item, offset) {
  dm.active = item;
  item.status = 'downloading';
  item.speed = 0;
  item.startedAt = Date.now();
  item.chunks = item.chunks || [];
  item.controller = new AbortController();
  renderDownloadsView();
  updateDownloadsBadge();

  let lastBytes = offset;
  let lastTick = Date.now();
  const speedTimer = setInterval(() => {
    const now = Date.now();
    const dt = (now - lastTick) / 1000;
    if (dt > 0) {
      item.speed = (item.received - lastBytes) / dt;
      lastBytes = item.received;
      lastTick = now;
      updateDownloadProgressDom(item);
    }
  }, 500);

  try {
    const headers = offset > 0 ? { Range: `bytes=${offset}-` } : {};
    const res = await fetch(`${API_BASE}?action=download&build_id=${item.buildId}`, {
      headers,
      signal: item.controller.signal,
    });

    if (!res.ok && res.status !== 206) {
      let msg = 'HTTP ' + res.status;
      try { msg = (await res.json()).error || msg; } catch (e) {}
      throw new Error(msg);
    }

    const total = parseInt(res.headers.get('Content-Length') || '0', 10);
    item.total = offset + (total || 0);
    if (offset > 0) item.received = offset;

    const reader = res.body.getReader();
    while (true) {
      if (item.paused) {
        // Пауза: рвём чтение, скачанные куски сохраняем — докачаем с Range
        try { await reader.cancel(); } catch (e) {}
        item.status = 'paused';
        clearInterval(speedTimer);
        dm.active = null;
        dm.pausedItem = item;
        renderDownloadsView();
        updateDownloadsBadge();
        setTimeout(pumpDownloads, 0); // очередь едет дальше
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      item.chunks.push(value);
      item.received += value.length;
      updateDownloadProgressDom(item);
    }

    clearInterval(speedTimer);

    if (!item.total) item.total = item.received;

    // Сохраняем файл
    const blob = new Blob(item.chunks, { type: 'application/octet-stream' });
    const ext = (res.headers.get('Content-Disposition') || '').match(/\.(\w+)"?$/)?.[1] || 'zip';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${item.title.replace(/[^\wа-яА-ЯёЁ\- ]/gi, '').trim().replace(/\s+/g, '-')}-v${item.version}-${item.platform}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);

    item.status = 'done';
    dm.active = null;
    dm.history.unshift({
      title: item.title,
      platform: item.platform,
      version: item.version,
      size: item.received,
      at: new Date().toISOString(),
    });
    toast(`«${item.title}» скачана`);
    renderDownloadsView();
    updateDownloadsBadge();
  } catch (err) {
    clearInterval(speedTimer);
    if (item.paused) {
      // AbortController от паузы приводит сюда — это не ошибка
      item.status = 'paused';
      dm.pausedItem = item;
      dm.active = null;
      renderDownloadsView();
      updateDownloadsBadge();
      setTimeout(pumpDownloads, 0);
      return;
    }
    item.status = 'error';
    item.error = err.name === 'AbortError' ? 'Отменено' : (err.message || 'Ошибка загрузки');
    toast(item.error);
    dm.active = null;
    renderDownloadsView();
    updateDownloadsBadge();
    setTimeout(pumpDownloads, 0);
  }
}

function pauseDownload() {
  if (dm.active && dm.active.status === 'downloading') {
    dm.active.paused = true;
    try { dm.active.controller.abort(); } catch (e) {}
  }
}

function resumePausedDownload() {
  const it = dm.pausedItem;
  if (!it) return;
  if (dm.active) {
    // Уже что-то качается — честно ставим назад в начало очереди
    dm.pausedItem = null;
    it.status = 'queued';
    dm.queue.unshift(it);
    toast('Поставлена в очередь — докачаем с места паузы');
    renderDownloadsView();
    updateDownloadsBadge();
    return;
  }
  dm.pausedItem = null;
  it.paused = false;
  runDownload(it, it.received || 0);
}

function cancelActiveDownload() {
  if (dm.pausedItem) {
    // Отмена приостановленной — просто выбрасываем куски
    dm.pausedItem = null;
    renderDownloadsView();
    updateDownloadsBadge();
    setTimeout(pumpDownloads, 0);
    return;
  }
  if (dm.active) {
    const item = dm.active;
    item.paused = false;
    item.cancelled = true;
    try { item.controller.abort(); } catch (e) {}
    item.status = 'cancelled';
    dm.active = null;
    renderDownloadsView();
    updateDownloadsBadge();
    setTimeout(pumpDownloads, 0);
  }
}
function renderDownloadsView() {
  const activeBox = $('#downloads-active');
  if (!activeBox) return;

  const item = dm.active || dm.pausedItem;
  const queued = dm.queue;

  if (!item && !queued.length) {
    activeBox.innerHTML = `
      <div class="downloads-empty" id="downloads-empty">
        <div class="downloads-empty-icon">⬇</div>
        <p>Нет активных загрузок. Зайди в библиотеку и скачай что-нибудь тёплое.</p>
        <button type="button" class="btn-primary" onclick="gotoView('library')">Открыть библиотеку</button>
      </div>`;
  } else {
    let html = '';
    if (item) {
      const pct = item.total ? Math.min(100, (item.received / item.total) * 100) : 0;
      html += `
      <div class="dl-item active" id="dl-active" data-id="${item.id}">
        <div class="dl-row">
          <div class="dl-info">
            <div class="dl-title">${escapeHtml(item.title)}</div>
            <div class="dl-meta">${escapeHtml(item.platform)} · v${escapeHtml(item.version)}</div>
          </div>
          <div class="dl-status ${item.status}">${statusText(item)}</div>
        </div>
        <div class="dl-bar"><div class="dl-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
        <div class="dl-numbers">
          <span class="dl-bytes">${formatSize(item.received)} / ${item.total ? formatSize(item.total) : '…'}</span>
          <span class="dl-pct">${pct.toFixed(0)}%</span>
          <span class="dl-speed">${item.status === 'downloading' ? formatSpeed(item.speed || 0) : ''}</span>
        </div>
        <div class="dl-actions">
          ${item.status === 'downloading'
            ? '<button type="button" class="btn-ghost" id="dl-pause">Пауза</button>'
            : ''}
          ${item.status === 'paused'
            ? '<button type="button" class="btn-primary" id="dl-resume">Продолжить</button>'
            : ''}
          <button type="button" class="btn-ghost danger" id="dl-cancel">Отмена</button>
        </div>
      </div>`;
    }
    if (dm.pausedItem && dm.active) {
      // Есть и активная, и приостановленная — показываем паузу отдельной строкой
      const p = dm.pausedItem;
      const ppct = p.total ? Math.min(100, (p.received / p.total) * 100) : 0;
      html += `
      <div class="dl-item paused">
        <div class="dl-row">
          <div class="dl-info">
            <div class="dl-title">${escapeHtml(p.title)}</div>
            <div class="dl-meta">${escapeHtml(p.platform)} · v${escapeHtml(p.version)} · ${ppct.toFixed(0)}%</div>
          </div>
          <div class="dl-status paused">На паузе</div>
        </div>
        <div class="dl-actions">
          <button type="button" class="btn-primary" id="dl-resume">Продолжить</button>
          <button type="button" class="btn-ghost danger" id="dl-cancel">Отмена</button>
        </div>
      </div>`;
    }
    if (queued.length) {
      html += '<h3 class="downloads-queue-title">В очереди</h3>' + queued.map(q => `
        <div class="dl-item queued">
          <div class="dl-row">
            <div class="dl-info">
              <div class="dl-title">${escapeHtml(q.title)}</div>
              <div class="dl-meta">${escapeHtml(q.platform)} · v${escapeHtml(q.version)}</div>
            </div>
            <div class="dl-status queued">В очереди</div>
          </div>
        </div>`).join('');
    }
    activeBox.innerHTML = html;

    const pauseBtn = $('#dl-pause');
    if (pauseBtn) pauseBtn.addEventListener('click', pauseDownload);
    const resumeBtn = $('#dl-resume');
    if (resumeBtn) resumeBtn.addEventListener('click', resumePausedDownload);
    const cancelBtn = $('#dl-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', cancelActiveDownload);
  }

  renderDownloadsHistory();
}

function statusText(item) {
  switch (item.status) {
    case 'downloading': return 'Загружается';
    case 'paused': return 'На паузе';
    case 'error': return 'Ошибка: ' + (item.error || '');
    case 'cancelled': return 'Отменена';
    default: return item.status;
  }
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec < 1) return '0 КБ/с';
  if (bytesPerSec < 1024 * 1024) return (bytesPerSec / 1024).toFixed(0) + ' КБ/с';
  return (bytesPerSec / 1024 / 1024).toFixed(1) + ' МБ/с';
}

// Обновляем только цифры/полоску — без перерисовки (иначе кнопки моргают)
function updateDownloadProgressDom(item) {
  const box = $('#dl-active');
  if (!box || !dm.active || dm.active.id !== item.id) return;
  const pct = item.total ? Math.min(100, (item.received / item.total) * 100) : 0;
  const fill = box.querySelector('.dl-bar-fill');
  const bytes = box.querySelector('.dl-bytes');
  const pctEl = box.querySelector('.dl-pct');
  const speed = box.querySelector('.dl-speed');
  if (fill) fill.style.width = pct.toFixed(1) + '%';
  if (bytes) bytes.textContent = `${formatSize(item.received)} / ${item.total ? formatSize(item.total) : '…'}`;
  if (pctEl) pctEl.textContent = pct.toFixed(0) + '%';
  if (speed) speed.textContent = item.status === 'downloading' ? formatSpeed(item.speed || 0) : '';
}

function renderDownloadsHistory() {
  const box = $('#downloads-history');
  if (!box) return;
  if (!dm.history.length) {
    box.innerHTML = '<p class="downloads-history-empty">Пока пусто</p>';
    return;
  }
  box.innerHTML = dm.history.map(h => `
    <div class="dl-history-row">
      <div class="dl-info">
        <div class="dl-title">${escapeHtml(h.title)}</div>
        <div class="dl-meta">${escapeHtml(h.platform)} · v${escapeHtml(h.version)}</div>
      </div>
      <div class="dl-history-meta">
        <span>${formatSize(h.size)}</span>
        <span class="dl-history-time">${formatDateTime(h.at)}</span>
      </div>
    </div>`).join('');
}

// ============================================================
//  ПРОФИЛЬ (как в Steam: статистика, активность, мои игры)
// ============================================================
async function loadProfile() {
  loadProfileStats();
  loadProfileActivity();
  loadProfileGames();
}

async function loadProfileStats() {
  try {
    const data = await fetchJSON(`${USER_API}?action=stats`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const s = data.stats;
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('#stat-games', s.games);
    set('#stat-comments', s.comments);
    set('#stat-ratings', s.ratings);
    set('#stat-spent', `${Number(s.spent).toLocaleString('ru-RU')} ₽`);
    set('#profile-level', s.level);
  } catch (err) {
    // стата не критична — молча оставляем нули
  }
}

async function loadProfileActivity() {
  const box = $('#profile-activity');
  if (!box) return;
  try {
    const data = await fetchJSON(`${USER_API}?action=activity`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    if (!data.activity.length) {
      box.innerHTML = '<div class="placeholder" style="padding:40px 20px">Пока нет активности — купи или прокомментируй что-нибудь.</div>';
      return;
    }
    box.innerHTML = data.activity.map(a => `
      <div class="activity-row">
        <span class="activity-icon">${a.type === 'purchase' ? '🛒' : '💬'}</span>
        <div class="activity-text">
          <a href="?view=game&id=${a.game_id}" class="activity-link" data-game-id="${a.game_id}">${escapeHtml(a.text)}</a>
          <span class="activity-date">${formatDateTime(a.ts)}</span>
        </div>
      </div>`).join('');
    $$('.activity-link', box).forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        gotoGame(link.dataset.gameId);
      });
    });
  } catch (err) {
    box.innerHTML = `<div class="placeholder" style="padding:40px 20px">${escapeHtml(err.message)}</div>`;
  }
}

async function loadProfileGames() {
  const box = $('#profile-games');
  if (!box) return;
  try {
    const data = await fetchJSON(`${API_BASE}?action=library`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    if (!data.library.length) {
      box.innerHTML = '<p class="profile-games-empty">Пусто. Самое время зайти в каталог.</p>';
      return;
    }
    box.innerHTML = data.library.slice(0, 6).map(g => `
      <button type="button" class="profile-game-row" data-id="${g.id}">
        <span class="library-item-cover" style="background:${escapeHtml(g.cover_color || '#2e2a24')}">${escapeHtml(g.cover_emoji || '🎮')}</span>
        <span class="profile-game-title">${escapeHtml(g.title)}</span>
      </button>`).join('');
    $$('.profile-game-row', box).forEach(row => {
      row.addEventListener('click', () => gotoGame(row.dataset.id));
    });
  } catch (err) {
    box.innerHTML = `<p class="profile-games-empty">${escapeHtml(err.message)}</p>`;
  }
}

// ---------- Модалка настроек ----------
function initSettingsModal() {
  const modal = $('#settings-modal');
  if (!modal) return;

  const open = () => modal.classList.remove('hidden');
  const close = () => modal.classList.add('hidden');

  const openBtn = $('#btn-settings-open');
  if (openBtn) openBtn.addEventListener('click', open);
  const menuSettings = $('#menu-settings');
  if (menuSettings) menuSettings.addEventListener('click', () => {
    const menu = $('#user-menu');
    if (menu) menu.classList.add('hidden');
    open();
  });
  const topupOpen = $('#btn-topup-open');
  if (topupOpen) topupOpen.addEventListener('click', open);

  $('#settings-close').addEventListener('click', close);
  $('#settings-backdrop').addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  // Живой предпросмотр аватара
  const preview = $('#settings-avatar-preview');
  const avatarInput = $('#settings-avatar-input');
  const colorInput = $('#settings-color-input');
  const syncPreview = () => {
    if (!preview) return;
    preview.textContent = avatarInput.value.trim() || '🐱';
    preview.style.background = colorInput.value;
  };
  if (avatarInput) avatarInput.addEventListener('input', syncPreview);
  if (colorInput) colorInput.addEventListener('input', syncPreview);

  // Сохранение
  const saveBtn = $('#settings-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const errBox = $('#settings-error');
      errBox.classList.add('hidden');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Сохраняем...';
      try {
        const data = await postJSON(`${USER_API}?action=update_profile`, {
          avatar: avatarInput.value.trim(),
          avatar_color: colorInput.value,
        });
        if (!data.ok) throw new Error(data.error || 'Не удалось сохранить');
        // Обновляем шапку без перезагрузки
        if (window.AUTH_STATE && window.AUTH_STATE.user) {
          window.AUTH_STATE.user.avatar = data.user.avatar;
          window.AUTH_STATE.user.avatar_color = data.user.avatar_color;
        }
        const avatarBtn = $('#avatar-btn');
        if (avatarBtn) {
          avatarBtn.textContent = data.user.avatar || avatarBtn.textContent;
          avatarBtn.style.background = data.user.avatar_color || avatarBtn.style.background;
        }
        const profileAvatar = $('.profile-avatar');
        if (profileAvatar) {
          profileAvatar.textContent = data.user.avatar || profileAvatar.textContent;
          profileAvatar.style.background = data.user.avatar_color || profileAvatar.style.background;
        }
        close();
        toast('Настройки сохранены');
      } catch (err) {
        errBox.textContent = err.message || 'Ошибка';
        errBox.classList.remove('hidden');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Сохранить';
      }
    });
  }

  // Пополнение баланса
  $$('.btn-topup', modal).forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const data = await postJSON(`${USER_API}?action=topup`, { amount: +btn.dataset.amount });
        if (!data.ok) throw new Error(data.error || 'Не удалось пополнить');
        updateBalance(data.balance);
        toast(`Баланс пополнен: ${Number(data.balance).toLocaleString('ru-RU')} ₽`);
      } catch (err) {
        toast(err.message || 'Ошибка');
      } finally {
        btn.disabled = false;
      }
    });
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

  const profileBtn = $('#menu-profile');
  if (profileBtn) {
    profileBtn.addEventListener('click', () => {
      closeMenu();
      gotoView('profile');
    });
  }

  const downloadsBtn = $('#menu-downloads');
  if (downloadsBtn) {
    downloadsBtn.addEventListener('click', () => {
      closeMenu();
      gotoView('downloads');
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

// ---------- Навигация (только в браузере; в клиенте — нативный лаунчер) ----------
function initWebNav() {
  if (window.IS_CLIENT) return; // native launcher handles navigation

  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showView(btn.dataset.view);
    });
  });
}

// В нативном клиенте topbar скрыт — навигация всё равно нужна для внутренних переходов
function initClientNav() {
  if (!window.IS_CLIENT) return;
  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showView(btn.dataset.view);
    });
  });
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  initWebNav();
  initClientNav();
  initAvatarMenu();
  initStoreControls();
  initLibraryControls();
  initSettingsModal();
  initLightbox();
  updateDownloadsBadge();

  // Неавторизованным всегда показываем auth, даже если в URL другой view
  let view = (window.FORCE_AUTH_VIEW && $('#view-auth')) ? 'auth' : getViewFromUrl();
  const gameId = window.GAME_ID_FROM_URL || 0;
  if (view === 'game' && !gameId) view = 'store';
  showView(view, gameId);
});
