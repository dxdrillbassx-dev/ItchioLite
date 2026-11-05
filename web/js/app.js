// CATio frontend — clean vanilla JS
// Все запросы к API — асинхронные с таймаутом: вкладки не зависают,
// если сервер лёг (AbortController рвёт зависший fetch через FETCH_TIMEOUT мс).

const API_BASE = 'api/games.php';
const USER_API = 'api/user.php';
const FETCH_TIMEOUT = 6000;
const FETCH_TIMEOUT_LONG = 120000; // импорт Steam, публикация, тяжёлые загрузки

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
  const timeout = opts.timeout ?? FETCH_TIMEOUT;
  const { timeout: _ignore, ...fetchOpts } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...fetchOpts, signal: ctrl.signal });
    return await res.json();
  } catch (err) {
    if (err && (err.name === 'AbortError' || /aborted/i.test(String(err.message || '')))) {
      throw new Error('Сервер не ответил вовремя. Попробуй ещё раз или проверь XAMPP.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function postJSON(url, payload, timeout) {
  return fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, csrf_token: window.CSRF_TOKEN }),
    timeout: timeout ?? FETCH_TIMEOUT,
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

function gameCoverUrl(g) {
  if (!g) return '';
  if (g.cover_src) return g.cover_src;
  if (g.cover_url) return g.cover_url;
  if (g.id) return 'media.php?type=cover&id=' + g.id;
  return '';
}
function gameHeroUrl(g) {
  if (!g) return '';
  // Реальная обложка/баннер важнее процедурного SVG
  if (g.banner_url) return g.banner_url;
  if (g.cover_url) return g.cover_url;
  if (g.cover_src && !String(g.cover_src).includes('media.php?type=hero')) return g.cover_src;
  if (g.id) return 'media.php?type=hero&id=' + g.id;
  return '';
}
function formatStatNum(n) {
  const v = parseInt(n, 10) || 0;
  return v.toLocaleString('ru-RU');
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


function iconSvg(name, size=16) {
  const s = size;
  const common = `width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
  const map = {
    star: `<svg ${common}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    clock: `<svg ${common}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    thumbsUp: `<svg ${common}><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>`,
    thumbsDown: `<svg ${common}><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>`,
    reply: `<svg ${common}><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>`,
    trash: `<svg ${common}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
    heart: `<svg ${common}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
    message: `<svg ${common}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    download: `<svg ${common}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    users: `<svg ${common}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    settings: `<svg ${common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    plus: `<svg ${common}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    pencil: `<svg ${common}><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  };
  return map[name] || '';
}

function formatRelative(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!t) return formatDate(iso);
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return 'только что';
  if (sec < 3600) return Math.floor(sec / 60) + ' мин. назад';
  if (sec < 86400) return Math.floor(sec / 3600) + ' ч. назад';
  if (sec < 86400 * 7) return Math.floor(sec / 86400) + ' дн. назад';
  return formatDate(iso);
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
  const b3 = $('#settings-balance');
  if (b1) b1.textContent = text;
  if (b2) b2.textContent = text;
  if (b3) b3.textContent = text;
  if (window.AUTH_STATE && window.AUTH_STATE.user) {
    window.AUTH_STATE.user.balance = balance;
    if (window.IS_CLIENT && typeof window.catioSync === 'function') {
      try { window.catioSync(window.AUTH_STATE); } catch (e) {}
    }
  }
}

// ---------- Навигация по видам ----------
const VIEW_TITLES = {
  home: 'Главная',
  store: 'Каталог',
  community: 'Мастерская',
  library: 'Библиотека',
  downloads: 'Загрузки',
  profile: 'Профиль',
  settings: 'Настройки',
  admin: 'Админка',
  game: 'Страница игры',
  auth: 'Вход',
};
let prevView = 'home';

function getViewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('view') || 'home';
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
  if (name === 'library' && !window.IS_CLIENT) name = 'home';

  const prev = getViewFromUrl();
  if (prev !== name) prevView = prev;

  $$('.view').forEach(v => v.classList.remove('active'));
  const el = $(`#view-${name}`);
  if (!el) return;
  el.classList.add('active');

  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));

  const headTitle = $('#head-title');
  if (headTitle) headTitle.textContent = VIEW_TITLES[name] || 'CATio';

  // Поиск в шапке есть не во всех вкладках
  const headSearch = $('#head-search');
  if (headSearch) {
    headSearch.style.display = (name === 'game' || name === 'auth' || name === 'settings') ? 'none' : '';
  }

  const main = $('.main');
  if (main) main.scrollTop = 0;
  window.scrollTo(0, 0);

  syncUrl(name, gameId);

  if (name === 'home') loadHome();
  if (name === 'store') loadStore();
  if (name === 'library') loadLibrary();
  if (name === 'community') loadWorkshop();
  if (name === 'downloads') renderDownloadsView();
  if (name === 'profile') loadProfile();
  if (name === 'admin') loadAdminPending();
  if (name === 'game' && gameId) loadGamePage(gameId);
}

function gotoView(name) {
  showView(name);
}

function gotoGame(id) {
  // 18+ gate before opening game page
  maybeAdultGate(id).then(ok => {
    if (ok) showView('game', id);
  });
}

const adultAccepted = new Set();
try {
  const raw = sessionStorage.getItem('adult_ok') || '[]';
  JSON.parse(raw).forEach(id => adultAccepted.add(+id));
} catch (e) {}

function persistAdultAccepted() {
  try { sessionStorage.setItem('adult_ok', JSON.stringify([...adultAccepted])); } catch (e) {}
}

function maybeAdultGate(gameId) {
  gameId = +gameId;
  if (!gameId) return Promise.resolve(true);
  if (adultAccepted.has(gameId)) return Promise.resolve(true);

  // need game meta — from cache or fetch
  return (async () => {
    let game = null;
    if (typeof storeCache !== 'undefined' && storeCache) {
      game = (storeCache || []).find(g => +g.id === gameId);
    }
    if (!game && homeCache) {
      const all = [...(homeCache.featured || []), ...(homeCache.games || [])];
      game = all.find(g => +g.id === gameId);
    }
    if (!game) {
      try {
        const data = await fetchJSON(`${API_BASE}?action=get&id=${gameId}`);
        if (data.ok) game = data.game;
      } catch (e) {}
    }
    if (!game || !+game.is_adult) return true;

    return showAdultGate(game.title || 'Игра', gameId);
  })();
}

function showAdultGate(title, gameId) {
  return new Promise(resolve => {
    const modal = $('#adult-gate-modal');
    if (!modal) { resolve(true); return; }
    const titleEl = $('#adult-gate-title');
    if (titleEl) titleEl.textContent = title;
    modal.classList.remove('hidden');

    const cleanup = () => {
      modal.classList.add('hidden');
      cont?.removeEventListener('click', onCont);
      back?.removeEventListener('click', onBack);
      xbtn?.removeEventListener('click', onBack);
    };
    const onCont = () => {
      adultAccepted.add(+gameId);
      persistAdultAccepted();
      cleanup();
      resolve(true);
    };
    const onBack = () => {
      cleanup();
      resolve(false);
      // stay on previous view — do not navigate to game
      if (window.history.length > 1) {
        // optional: history.back only if URL already changed
      }
    };
    const cont = $('#adult-gate-continue');
    const back = $('#adult-gate-back');
    const xbtn = $('#adult-gate-x');
    cont?.addEventListener('click', onCont);
    back?.addEventListener('click', onBack);
    xbtn?.addEventListener('click', onBack);
  });
}


// ============================================================
//  ГЛАВНАЯ (как в Hydra): hero-баннер, подборки, «Удиви меня»
// ============================================================
let homeCache = null;
let homeSort = 'popular';
let homeSearch = '';
let dlSearch = '';
let profileSearch = '';

const HOME_SORT_TITLES = {
  popular: '🔥 Сейчас популярно',
  week: '📈 Лучшие игры недели',
  new: '✨ Новинки',
};

async function loadHome() {
  const grid = $('#home-grid');
  if (!grid) return;

  if (!homeCache) {
    try {
      const data = await fetchJSON(`${API_BASE}?action=list&category=game`);
      if (!data.ok) throw new Error(data.error || 'Ошибка загрузки');
      homeCache = data.games || [];
    } catch (err) {
      if (isOffline(err)) {
        renderOffline(grid, () => { homeCache = null; loadHome(); }, 'Кот ушёл в запой');
      } else {
        grid.innerHTML = `<div class="loading">Не удалось загрузить главную.<br><small>${escapeHtml(err.message)}</small></div>`;
      }
      return;
    }
  }

  renderHomeHero();
  renderHomeGrid();
}

function getHomeGamesSorted() {
  let games = [...(homeCache || [])];
  if (homeSearch) {
    const q = homeSearch.toLowerCase();
    games = games.filter(g =>
      (g.title || '').toLowerCase().includes(q) ||
      (g.developer_name || '').toLowerCase().includes(q) ||
      (g.genre || '').toLowerCase().includes(q)
    );
  }
  if (homeSort === 'popular') {
    games.sort((a, b) => (parseInt(b.download_count, 10) || 0) - (parseInt(a.download_count, 10) || 0));
  } else if (homeSort === 'week') {
    games.sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
  }
  return games;
}

function renderHomeHero() {
  const hero = $('#home-hero');
  if (!hero) return;
  const list = getHomeGamesSorted();
  if (!list.length) {
    hero.classList.add('hidden');
    hero.onclick = null;
    return;
  }
  // Та же игра, что первая в сетке — та же обложка, что на карточке
  const game = list[0];
  const bg = $('#home-hero-bg');
  // Как Hydra: libraryHeroImageUrl → у нас banner, иначе cover
  const url = (game.banner_url || game.cover_url || game.cover_src || gameHeroUrl(game) || gameCoverUrl(game));
  bg.removeAttribute('data-fallback');
  bg.src = url;
  bg.alt = game.title || '';
  bg.onerror = () => {
    if (bg.dataset.fallback === '1') return;
    bg.dataset.fallback = '1';
    if (game.id) bg.src = 'media.php?type=cover&id=' + game.id;
  };
  $('#home-hero-title').textContent = game.title || '';
  const desc = (game.short_description || game.description || '').trim();
  const descEl = $('#home-hero-desc');
  if (descEl) {
    descEl.textContent = desc;
    descEl.style.display = desc ? '' : 'none';
  }
  hero.classList.remove('hidden');
  hero.onclick = () => gotoGame(game.id);
}

function renderHomeGrid() {
  const grid = $('#home-grid');
  if (!grid) return;
  let games = getHomeGamesSorted().slice(0, 12);
  if (!games.length) {
    grid.innerHTML = '<div class="loading">В каталоге пока нет игр.<br><small>Нажми «+» сверху, чтобы отправить игру на модерацию.</small></div>';
    return;
  }

  grid.innerHTML = games.map(g => {
    const cover = escapeHtml(gameCoverUrl(g));
    const author = escapeHtml(g.developer_name || g.developer || '');
    const sub = author || (parseFloat(g.price) > 0 ? (parseFloat(g.price).toFixed(0) + ' ₽') : 'Бесплатно');
    const dl = formatStatNum(g.download_count);
    const players = formatStatNum(g.players_count ?? g.ratings_count ?? 0);
    const rating = (parseFloat(g.rating) || 0).toFixed(1);
    return `
    <button type="button" class="home-card" data-id="${g.id}">
      <div class="home-card-cover">
        <img src="${cover}" alt="${escapeHtml(g.title)}" loading="lazy" />
      </div>
      <div class="home-card-shade"></div>
      <div class="home-card-info">
        <div class="home-card-title">${escapeHtml(g.title)}</div>
        <div class="home-card-sub">${sub}</div>
        <div class="home-card-stats">
          <span title="Скачивания"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 19h14"/></svg>${dl}</span>
          <span title="В библиотеках"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>${players}</span>
          <span title="Оценка"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>${rating}</span>
        </div>
      </div>
    </button>`;
  }).join('');

  $$('.home-card', grid).forEach(card => {
    card.addEventListener('click', () => gotoGame(card.dataset.id));
  });
}


function initHomeControls() {
  $$('#home-pills .home-pill[data-hsort]').forEach(pill => {
    pill.addEventListener('click', () => {
      $$('#home-pills .home-pill[data-hsort]').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      homeSort = pill.dataset.hsort;
      const title = $('#home-section-title');
      if (title) title.textContent = HOME_SORT_TITLES[homeSort] || '';
      renderHomeGrid();
    });
  });

  const surprise = $('#home-surprise');
  if (surprise) {
    surprise.addEventListener('click', async () => {
      if (!homeCache || !homeCache.length) {
        await loadHome();
      }
      if (homeCache && homeCache.length) {
        const g = homeCache[Math.floor(Math.random() * homeCache.length)];
        gotoGame(g.id);
      } else {
        toast('Каталог пуст — удивлять нечем');
      }
    });
  }
}

// ---------- Сайдбар: моя библиотека ----------
let sideLibCache = null;
let sideLibInstalledOnly = false;
let sideLibPlat = 'all';
let sideLibSort = 'recent';

// «Установленные» — игры, сборки которых скачивались на этом ПК
function getInstalledIds() {
  try { return JSON.parse(localStorage.getItem('catio_installed') || '[]'); }
  catch (e) { return []; }
}

function markInstalled(id) {
  if (!id) return;
  const ids = getInstalledIds();
  if (!ids.includes(+id)) {
    ids.push(+id);
    localStorage.setItem('catio_installed', JSON.stringify(ids));
  }
}

async function loadSideLibrary() {
  const list = $('#side-lib-list');
  if (!list) return;
  if (!window.AUTH_STATE || !window.AUTH_STATE.authorized) {
    list.innerHTML = '';
    return;
  }
  try {
    const data = await fetchJSON(`${API_BASE}?action=library`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    sideLibCache = data.library || [];
    renderSideLibrary();
  } catch (err) {
    list.innerHTML = '<div class="side-lib-empty">Не удалось загрузить</div>';
  }
}

function renderSideLibrary(filter) {
  const list = $('#side-lib-list');
  if (!list) return;
  let games = sideLibCache || [];
  const searchEl = $('#side-lib-search');
  const q = (filter !== undefined ? filter : (searchEl ? searchEl.value : '')).trim().toLowerCase();
  if (q) games = games.filter(g => (g.title || '').toLowerCase().includes(q));

  if (sideLibInstalledOnly) {
    const ids = getInstalledIds();
    games = games.filter(g => ids.includes(+g.id));
  }

  if (sideLibPlat !== 'all') {
    games = games.filter(g => (g.platforms || '').split(',').includes(sideLibPlat));
  }

  if (sideLibSort === 'name') {
    games = [...games].sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ru'));
  } else if (sideLibSort === 'rating') {
    games = [...games].sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
  } // recent — порядок из API (недавно сыгранные)

  if (!games.length) {
    const msg = sideLibInstalledOnly ? 'Ничего не установлено' : (q ? 'Ничего не найдено' : 'Пока пусто');
    list.innerHTML = `<div class="side-lib-empty">${msg}</div>`;
    return;
  }

  list.innerHTML = games.map(g => `
    <button type="button" class="side-lib-item" data-id="${g.id}">
      <img src="media.php?type=icon&id=${g.id}" alt="" loading="lazy" />
      <span class="side-lib-name">${escapeHtml(g.title)}</span>
    </button>`).join('');

  $$('.side-lib-item', list).forEach(btn => {
    btn.addEventListener('click', () => gotoGame(btn.dataset.id));
  });
}

function initSideLibrary() {
  const search = $('#side-lib-search');
  if (search) {
    search.addEventListener('input', () => renderSideLibrary(search.value));
  }

  // Галочка «только установленные»
  const installedBtn = $('#side-lib-installed');
  if (installedBtn) {
    installedBtn.addEventListener('click', () => {
      sideLibInstalledOnly = !sideLibInstalledOnly;
      installedBtn.classList.toggle('active', sideLibInstalledOnly);
      renderSideLibrary();
    });
  }

  // Кнопка фильтров — открывает/закрывает модалку
  const filtersBtn = $('#side-lib-filters');
  const modal = $('#side-lib-modal');
  if (filtersBtn && modal) {
    filtersBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      modal.classList.toggle('hidden');
      filtersBtn.classList.toggle('active', !modal.classList.contains('hidden'));
    });
    document.addEventListener('click', (e) => {
      if (!modal.classList.contains('hidden') && !modal.contains(e.target) && e.target !== filtersBtn) {
        modal.classList.add('hidden');
        filtersBtn.classList.remove('active');
      }
    });

    $$('.side-lib-opt[data-plat]', modal).forEach(opt => {
      opt.addEventListener('click', () => {
        $$('.side-lib-opt[data-plat]', modal).forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        sideLibPlat = opt.dataset.plat;
        renderSideLibrary();
      });
    });
    $$('.side-lib-opt[data-sort]', modal).forEach(opt => {
      opt.addEventListener('click', () => {
        $$('.side-lib-opt[data-sort]', modal).forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        sideLibSort = opt.dataset.sort;
        renderSideLibrary();
      });
    });
  }
}

// ---------- Шапка контента: назад + поиск по вкладке ----------
function initContentHead() {
  const back = $('#head-back');
  if (back) {
    back.addEventListener('click', () => {
      const cur = getViewFromUrl();
      showView(prevView && prevView !== cur ? prevView : 'home');
    });
  }

  const hs = $('#head-search-input');
  if (hs) {
    hs.addEventListener('input', () => {
      const q = hs.value.trim();
      const view = getViewFromUrl();
      if (view === 'store') {
        storeSearch = q;
        if (storeCache.length) renderStoreList();
      } else if (view === 'home') {
        homeSearch = q;
        renderHomeGrid();
      } else if (view === 'library') {
        librarySearch = q;
        renderLibraryGrid();
      } else if (view === 'downloads') {
        dlSearch = q;
        renderDownloadsView();
      } else if (view === 'profile') {
        profileSearch = q;
        loadProfileGames();
      }
    });
  }
}

// ============================================================
//  КАТАЛОГ (список строк + панель фильтров справа, как в Hydra)
// ============================================================
let storeCache = [];
let storeGenres = new Set();
let storeDevs = new Set();
let storeSearch = '';
let storeSort = 'popular';

async function loadStore() {
  homeCache = null;
  const list = $('#store-list');
  if (!list) return;
  list.innerHTML = '<div class="loading">Загрузка каталога...</div>';

  try {
    const data = await fetchJSON(`${API_BASE}?action=list&category=game`);
    if (!data.ok) throw new Error(data.error || 'Ошибка загрузки');

    storeCache = data.games || [];
    buildStoreFilters();
    renderStoreList();
  } catch (err) {
    if (isOffline(err)) {
      renderOffline(list, loadStore, 'Кот ушёл в запой');
    } else {
      list.innerHTML = `<div class="loading">Не удалось загрузить каталог.<br><small>${escapeHtml(err.message)}</small></div>`;
    }
  }
}

// Панель фильтров: жанры и разработчики собираются из реальных данных каталога
function buildStoreFilters() {
  const genres = [...new Set(storeCache.map(g => g.genre).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const devs = [...new Set(storeCache.map(g => g.developer_name || g.developer).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));

  const gc = $('#genre-count');
  if (gc) gc.textContent = genres.length;
  const dc = $('#dev-count');
  if (dc) dc.textContent = devs.length;

  const renderOpts = (box, values, set) => {
    if (!box) return;
    box.innerHTML = values.map(v => `
      <label class="filter-opt" data-value="${escapeHtml(v.toLowerCase())}">
        <input type="checkbox" value="${escapeHtml(v)}" ${set.has(v) ? 'checked' : ''} />
        <span>${escapeHtml(v)}</span>
      </label>`).join('');
    $$('input[type="checkbox"]', box).forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) set.add(cb.value); else set.delete(cb.value);
        renderStoreList();
      });
    });
  };
  renderOpts($('#genre-opts'), genres, storeGenres);
  renderOpts($('#dev-opts'), devs, storeDevs);

  // Поиск внутри списка фильтров
  const bindFilterSearch = (inputId, boxId) => {
    const inp = $(inputId);
    if (!inp) return;
    inp.addEventListener('input', () => {
      const q = inp.value.trim().toLowerCase();
      $$('.filter-opt', $(boxId)).forEach(opt => {
        opt.style.display = !q || opt.dataset.value.includes(q) ? '' : 'none';
      });
    });
  };
  bindFilterSearch('#genre-filter-search', '#genre-opts');
  bindFilterSearch('#dev-filter-search', '#dev-opts');
}

function applyStoreFilters(games) {
  let out = games;
  if (storeGenres.size) {
    out = out.filter(g => g.genre && storeGenres.has(g.genre));
  }
  if (storeDevs.size) {
    out = out.filter(g => storeDevs.has(g.developer_name || g.developer));
  }
  if (storeSearch) {
    const q = storeSearch.toLowerCase();
    out = out.filter(g =>
      (g.title || '').toLowerCase().includes(q) ||
      (g.short_description || '').toLowerCase().includes(q) ||
      (g.developer_name || '').toLowerCase().includes(q)
    );
  }
  if (storeSort === 'popular') {
    out = [...out].sort((a, b) => (b.download_count || 0) - (a.download_count || 0));
  } else if (storeSort === 'rating') {
    out = [...out].sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
  } else if (storeSort === 'price') {
    out = [...out].sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
  }
  // 'new' — порядок из API (сначала новые)
  return out;
}

function renderStoreList() {
  const list = $('#store-list');
  if (!list) return;
  const games = applyStoreFilters(storeCache);

  const count = $('#store-count');
  if (count) count.textContent = games.length.toLocaleString('ru-RU');

  if (!games.length) {
    list.innerHTML = '<div class="loading">Ничего не найдено. Попробуй другой запрос.</div>';
    return;
  }

  list.innerHTML = '';
  games.forEach(game => {
    const price = formatPrice(game.price);
    const row = document.createElement('article');
    row.className = 'store-row';
    row.dataset.id = game.id;
    row.innerHTML = `
      <div class="store-row-cover">
        <img src="${escapeHtml(game.cover_src || ('media.php?type=cover&id=' + game.id))}" alt="${escapeHtml(game.title)}" loading="lazy" />
        ${game.owned ? '<span class="card-badge owned">В библиотеке</span>' : ''}
      </div>
      <div class="store-row-info">
        <h3 class="store-row-title">${escapeHtml(game.title)}</h3>
        <div class="store-row-meta">${escapeHtml([game.genre, game.developer_name || game.developer].filter(Boolean).join(' · '))}</div>
        <div class="store-row-rating">${starsHtml(game.rating, game.ratings_count)}</div>
      </div>
      <div class="store-row-side">
        <span class="price ${price.className}">${price.text}</span>
        <button type="button" class="btn-get ${game.owned ? 'owned' : ''}" data-id="${game.id}"></button>
      </div>
      <span class="store-row-arrow">›</span>
    `;
    const btn = row.querySelector('.btn-get');
    paintCardButton(btn, game, price);
    row.addEventListener('click', () => gotoGame(game.id));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      buyFromCard(btn, game, price);
    });
    list.appendChild(row);
  });
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
      grid.innerHTML = '<div class="loading">В мастерской пока пусто.<br><small>Ассеты появятся после публикации.</small></div>';
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
    loadSideLibrary(); // обновить список в сайдбаре
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
  const sort = $('#sort-select');
  if (sort) {
    sort.addEventListener('change', () => {
      storeSort = sort.value;
      renderStoreList();
    });
  }

  // Сворачивание блоков фильтров (жанры / разработчики)
  $$('.filter-block-head').forEach(head => {
    head.addEventListener('click', () => {
      head.closest('.filter-block').classList.toggle('collapsed');
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
    // В шапке показываем название игры, как в Hydra
    const headTitle = $('#head-title');
    if (headTitle && data.game) headTitle.textContent = data.game.title;
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
  const videos = data.videos || [];
  const viewer = data.viewer || {};
  const authorized = viewer.authorized;
  const cover = g.cover_src || g.cover_url || '';
  const hero = g.banner_url || g.cover_url || cover || (`media.php?type=hero&id=${g.id}`);
  // как в Steam: сначала трейлеры, потом скрины
  const gallery = [];
  videos.forEach((v, i) => {
    if (!v || !v.url) return;
    gallery.push({
      type: 'video',
      src: v.url,
      thumb: v.thumbnail || cover || v.url,
      name: v.name || ('Трейлер ' + (i + 1)),
    });
  });
  (shots.length ? shots : (cover ? [cover] : [])).forEach((src) => {
    if (!src) return;
    gallery.push({ type: 'image', src, thumb: src });
  });
  const descHtml = (g.description || 'Описание отсутствует.')
    .split(/\n+/).map(p => `<p>${escapeHtml(p)}</p>`).join('');
  const releaseLabel = g.created_at
    ? ('Выпущено ' + formatDate(g.created_at))
    : '';
  const publisher = g.developer_name || g.developer || '';

  const actionLeft = g.owned
    ? `<div class="gp-playtime">В библиотеке${g.playtime_minutes ? ' · ' + formatPlaytime(g.playtime_minutes) : ''}</div>
       <div class="gp-last-play">${g.last_played ? 'Последний запуск: ' + formatDate(g.last_played) : ''}</div>`
    : `<div class="gp-playtime">Нет доступных источников</div>`;

  const adminEditBtn = viewer && viewer.is_admin
    ? `<button type="button" class="gp-bar-btn icon" id="gp-admin-edit" title="Редактировать">${iconSvg('pencil',16)}</button>`
    : '';

  const actionBtns = g.owned
    ? `<button type="button" class="gp-bar-btn primary" id="btn-buy-game">
         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
         Скачать
       </button>
       <button type="button" class="gp-bar-btn icon" id="gp-like" title="В избранное">${iconSvg('heart',16)}</button>
       <button type="button" class="gp-bar-btn icon" id="gp-settings" title="Настройки">${iconSvg('settings',16)}</button>
       ${adminEditBtn}`
    : `${price.className === 'paid' ? `<span class="gp-price">${escapeHtml(price.text)}</span>` : ''}
       <button type="button" class="gp-bar-btn primary" id="btn-buy-game">
         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
         Добавить в библиотеку
       </button>
       ${adminEditBtn}`;

  wrap.innerHTML = `
    <div class="gp">
      <div class="gp-hero">
        <img class="gp-hero-bg" src="${escapeHtml(hero)}" alt="" onerror="this.style.opacity=0.35" />
        <div class="gp-hero-grad"></div>
        <div class="gp-hero-content">
          <h1 class="gp-title">${escapeHtml(g.title)}</h1>
        </div>
        <div class="gp-actionbar">
          <div class="gp-action-left">${actionLeft}</div>
          <div class="gp-action-btns">${actionBtns}</div>
        </div>
      </div>

      <div class="gp-layout">
        <div class="gp-main">
          <div class="gp-meta-card">
            ${releaseLabel ? `<p class="gp-meta-strong">${escapeHtml(releaseLabel)}</p>` : ''}
            ${publisher ? `<p class="gp-meta-muted">Издатель ${escapeHtml(publisher)}</p>` : ''}
            ${!releaseLabel && !publisher ? `<p class="gp-meta-muted">${escapeHtml(g.genre || 'Игра')}</p>` : ''}
          </div>

          ${gallery.length ? `
          <div class="gp-gallery">
            <div class="gp-gallery-viewport">
              <div class="gp-gallery-main" id="gallery-main">
                ${gallery[0].type === 'video'
                  ? `<video id="gallery-main-video" src="${escapeHtml(gallery[0].src)}" controls playsinline preload="metadata" poster="${escapeHtml(gallery[0].thumb || '')}"></video>`
                  : `<img id="gallery-main-img" src="${escapeHtml(gallery[0].src)}" alt="" />`}
              </div>
            </div>
            <div class="gp-gallery-thumbs">
              ${gallery.map((item, i) => `
                <button type="button" class="gp-thumb ${i===0?'active':''}${item.type==='video'?' gp-thumb-video':''}"
                  data-type="${item.type}" data-src="${escapeHtml(item.src)}" data-thumb="${escapeHtml(item.thumb || '')}">
                  <img src="${escapeHtml(item.thumb || item.src)}" alt="" />
                  ${item.type === 'video' ? '<span class="gp-thumb-play">▶</span>' : ''}
                </button>`).join('')}
            </div>
          </div>` : ''}

          <h2 class="gp-block-title">Об игре</h2>
          <div class="gp-description gp-description--collapsed" id="gp-description">${descHtml}</div>
          <button type="button" class="gp-desc-toggle" id="gp-desc-toggle">Показать больше</button>
          ${tags.length ? `<div class="game-tags gp-tags">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}

          <div class="gp-section gp-section-builds">
            <h2 class="gp-block-title">Сборки и файлы</h2>
            <div id="game-builds">${renderBuildsList(data.builds || [], g)}</div>
          </div>

          <div class="gp-similar-wrap">
            <h2 class="gp-block-title">Похожие игры</h2>
            <div id="gp-similar" class="gp-similar-grid"><div class="loading">Загрузка...</div></div>
          </div>

          <div class="gp-reviews-section" id="gp-reviews">
            ${authorized ? `
            <div class="gp-review-form-wrap" id="comment-form-wrap">
              <h2 class="gp-leave-title">Оставить отзыв</h2>
              <form class="comment-form" id="comment-form">
                <div id="comment-error" class="gp-comment-error hidden"></div>
                <input type="hidden" id="comment-parent-id" value="" />
                <div class="gp-reply-hint hidden" id="reply-hint">
                  Ответ на комментарий <button type="button" id="reply-cancel">Отменить</button>
                </div>
                <div class="gp-editor">
                  <div class="gp-editor-toolbar">
                    <button type="button" class="gp-fmt" data-fmt="bold" title="Жирный"><b>B</b></button>
                    <button type="button" class="gp-fmt" data-fmt="italic" title="Курсив"><i>I</i></button>
                    <button type="button" class="gp-fmt" data-fmt="underline" title="Подчёркнутый"><u>U</u></button>
                    <span class="gp-editor-count"><span id="comment-len">0</span>/1000</span>
                  </div>
                  <textarea id="comment-input" class="comment-input" maxlength="1000" rows="5" placeholder="" required></textarea>
                </div>
                <div class="comment-form-row">
                  <div class="rate-stars" id="rate-stars">
                    ${[1,2,3,4,5].map(v => `<button type="button" class="rate-star ${g.user_rating && v <= g.user_rating ? 'filled' : ''}" data-value="${v}">★</button>`).join('')}
                  </div>
                  <button type="submit" class="gp-submit-review" id="comment-submit">Отправить</button>
                </div>
              </form>
            </div>
            <div class="gp-reviews-separator"></div>
            ` : `<p class="gp-login-hint">Войдите, чтобы оставить отзыв</p><div class="gp-reviews-separator"></div>`}

            <div class="gp-reviews-list-header">
              <div class="gp-reviews-title-group">
                <h2 class="gp-reviews-title">Отзывы</h2>
                <span class="gp-reviews-badge" id="comments-count">${(data.comments||[]).length}</span>
              </div>
            </div>
            <div class="gp-sort-options">
              <button type="button" class="gp-sort-opt active" data-sort="new">▾ Сначала новые</button>
              <span class="gp-sort-sep">|</span>
              <button type="button" class="gp-sort-opt" data-sort="score">▴ Высший балл</button>
              <span class="gp-sort-sep">|</span>
              <button type="button" class="gp-sort-opt" data-sort="popular">${iconSvg('thumbsUp',14)} Самые популярные</button>
            </div>
            <div id="comments-list" class="gp-comments"></div>
          </div>
        </div>

        <aside class="gp-aside">
          <div class="gp-side-card">
            <button type="button" class="gp-side-head">Достижения 0/0 <span class="chev">▾</span></button>
            <div class="gp-side-body">
              <div class="gp-ach-warn">⚠ Достижения для этой игры пока не настроены.</div>
              <div class="gp-ach-empty">Список достижений появится после публикации данных разработчиком.</div>
            </div>
          </div>

          <div class="gp-side-card">
            <button type="button" class="gp-side-head">Статистика <span class="chev">▾</span></button>
            <div class="gp-side-body gp-stats-body">
              <div class="gp-stat-row"><span class="gp-stat-ico">${iconSvg('download',14)}</span><span>Загрузки</span><b>${formatStatNum(g.download_count)}</b></div>
              <div class="gp-stat-row"><span class="gp-stat-ico">${iconSvg('users',14)}</span><span>Активные игроки</span><b>${formatStatNum(g.players_count ?? g.ratings_count ?? 0)}</b></div>
              <div class="gp-stat-row"><span class="gp-stat-ico">${iconSvg('star',14)}</span><span>Оценка</span><b>${(parseFloat(g.rating) || 0).toFixed(1)}</b></div>
            </div>
          </div>

          <div class="gp-side-card">
            <button type="button" class="gp-side-head">Скриншоты сообщества <span class="chev">▾</span></button>
            <div class="gp-side-body">
              ${gallery.filter(it => it.type === 'image').length ? `
                <div class="gp-comm-shots">
                  ${gallery.filter(it => it.type === 'image').slice(0, 3).map(item => `
                    <button type="button" class="gp-comm-shot" data-src="${escapeHtml(item.src)}">
                      <img src="${escapeHtml(item.thumb || item.src)}" alt="" loading="lazy" />
                      <span class="gp-comm-meta">${iconSvg('heart',12)} 0 · ${iconSvg('message',12)} 0</span>
                    </button>`).join('')}
                </div>
                <button type="button" class="gp-side-more" id="gp-comm-more">Показать все</button>
              ` : `<div class="gp-ach-empty">Пока нет скриншотов сообщества</div>`}
            </div>
          </div>

          <div class="gp-side-card">
            <button type="button" class="gp-side-head">Поддержка контроллера <span class="chev">▾</span></button>
            <div class="gp-side-body gp-ctrl-body">
              ${renderControllerSupport(g.controllers)}
            </div>
          </div>

          ${typeof renderSysReqBlock === 'function' ? renderSysReqBlock(g.sys_req_min, g.sys_req_rec) : ''}
          ${typeof renderLangBlock === 'function' ? renderLangBlock(g.languages) : ''}
        </aside>
      </div>
    </div>
  `;

  initGallery(wrap);
  if (typeof initGameCollapsibles === 'function') initGameCollapsibles(wrap);
  initBuyButton(wrap, g);
  initRateStars(wrap, g);
  renderCommentsThreaded(data.comments || [], data.viewer, g.id);
  initCommentForm(g, data.viewer);
  initBuildButtons(wrap, g);
  initReviewSort(data.comments || [], data.viewer);
  loadSimilarGames(g);
  bindAdminGameEdit(g, viewer);

  // description toggle
  const desc = $('#gp-description');
  const tog = $('#gp-desc-toggle');
  if (desc && tog) {
    const needsToggle = desc.scrollHeight > 320;
    if (!needsToggle) {
      desc.classList.remove('gp-description--collapsed');
      tog.classList.add('hidden');
    } else {
      tog.addEventListener('click', () => {
        const open = desc.classList.toggle('gp-description--collapsed');
        // toggle returns new state of class: true if now has collapsed
        tog.textContent = open ? 'Показать больше' : 'Показать меньше';
      });
    }
  }

  // side card collapse
  $$('.gp-side-head', wrap).forEach(btn => {
    btn.addEventListener('click', () => {
      btn.parentElement.classList.toggle('collapsed');
    });
  });

  $('#gp-like')?.addEventListener('click', () => toast('Избранное скоро появится'));
  $('#gp-settings')?.addEventListener('click', () => toast('Настройки запуска скоро'));
  $$('.gp-comm-shot', wrap).forEach(btn => {
    btn.addEventListener('click', () => {
      const img = $('#gallery-main-img');
      if (img && btn.dataset.src) img.src = btn.dataset.src;
    });
  });
  $('#gp-comm-more')?.addEventListener('click', () => {
    const img = $('#gallery-main-img');
    if (img) img.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function renderControllerSupport(raw) {
  const s = String(raw || '').toLowerCase();
  const hasX = /xbox|xinput|controller|gamepad|full/.test(s) || s.includes('xbox');
  const hasP = /playstation|dualshock|dualsense|ps4|ps5|\bps\b/.test(s);
  const hasAny = hasX || hasP || (s && s !== 'none' && s !== '0');
  if (!hasAny && !s) {
    return `<div class="gp-ctrl-none">Нет данных о поддержке контроллера</div>`;
  }
  const full = /full|полная|complete/.test(s) || (hasX && hasP) || hasAny;
  return `
    <div class="gp-ctrl-icons">
      <span class="gp-ctrl-ico" title="Xbox">$<svg class="gp-brand-logo" width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M4.102 21.033C6.211 22.881 8.977 24 12 24c3.026 0 5.792-1.119 7.898-2.967 1.877-1.912-4.356-9.104-7.899-9.104-3.54 0-9.776 7.193-7.897 9.104zm9.102-19.16c-.282-.408-.549-.645-.736-.766a1.036 1.036 0 0 0-.213-.105c.016.015.15.117.285.297.116.155.247.38.373.67L12 3.73l-.971-1.762c.126-.29.257-.515.373-.67.135-.18.269-.282.285-.297a1.036 1.036 0 0 0-.213.105c-.187.121-.454.358-.736.767C9.713 3.306 8.5 5.327 8.5 8.253c0 1.54.393 3.18 1.223 4.528.825 1.34 1.95 2.293 2.277 2.293s1.452-.953 2.277-2.293c.83-1.348 1.223-2.989 1.223-4.528 0-2.926-1.213-4.947-2.238-6.379z"/></svg></span>
      <span class="gp-ctrl-ico" title="PlayStation">$<svg class="gp-brand-logo" width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M8.984 2.596v17.547l2.802.961V8.064c0-.674.306-1.109.768-1.109.512 0 .795.435.795 1.109v6.166c2.414 1.163 4.278 0 4.278-3.163 0-3.248-1.864-4.471-4.278-3.308V2.596c5.09-.831 9.651 1.395 9.651 6.53 0 5.396-4.01 8.217-9.651 6.98V24l-9.984-3.418V0l5.619 1.928v.668z"/></svg></span>
    </div>
    <div class="gp-ctrl-badge ${full ? 'full' : 'partial'}">${full ? 'ПОЛНАЯ ПОДДЕРЖКА' : 'ЧАСТИЧНАЯ ПОДДЕРЖКА'}</div>
    <p class="gp-ctrl-note">${full ? 'Отлично работает с контроллерами Xbox и PlayStation.' : (escapeHtml(raw) || 'Поддержка контроллера заявлена разработчиком.')}</p>`;
}

function renderCommentsThreaded(comments, viewer, gameId) {
  const box = $('#comments-list');
  if (!box) return;

  // скрыть/показать форму корневого отзыва
  const formWrap = $('#comment-form-wrap');
  const uid = viewer && viewer.user_id ? +viewer.user_id : null;
  const myRoot = uid ? (comments || []).find(c => +c.user_id === uid && !(c.parent_id > 0)) : null;
  if (formWrap) {
    formWrap.classList.toggle('hidden', !!myRoot);
    const sep = formWrap.nextElementSibling;
    if (sep && sep.classList.contains('gp-reviews-separator')) {
      sep.classList.toggle('hidden', !!myRoot);
    }
  }

  if (!comments || !comments.length) {
    box.innerHTML = `
      <div class="gp-empty-reviews">
        <div class="gp-empty-title">Пока нет отзывов</div>
        <div class="gp-empty-sub">Станьте первым, кто поделится мыслями об этой игре!</div>
      </div>`;
    return;
  }
  const byParent = {};
  const roots = [];
  comments.forEach(c => {
    const pid = c.parent_id != null && +c.parent_id > 0 ? +c.parent_id : 0;
    if (!pid) roots.push(c);
    else {
      if (!byParent[pid]) byParent[pid] = [];
      byParent[pid].push(c);
    }
  });
  roots.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  Object.keys(byParent).forEach(k => {
    byParent[k].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  });

  const renderOne = (c, depth) => {
    const hasCustomAv = !!c.avatar_url;
    const avStyle = hasCustomAv
      ? `background-image:url('${escapeHtml(c.avatar_url)}');background-size:cover;background-position:center;`
      : '';
    const kids = byParent[c.id] || [];
    const rating = (c.rating != null && c.rating !== '') ? c.rating : ((c.user_rating != null && c.user_rating !== '') ? c.user_rating : null);
    const playH = (c.playtime_hours != null && c.playtime_hours !== '')
      ? c.playtime_hours
      : (c.playtime_minutes != null && +c.playtime_minutes > 0 ? Math.max(1, Math.round(+c.playtime_minutes / 60)) : null);
    const likes = c.likes || c.like_count || 0;
    const dislikes = c.dislikes || c.dislike_count || 0;
    const banner = c.profile_banner || c.banner_url || '';
    const bannerStyle = banner
      ? `background-image:url('${escapeHtml(banner)}');background-size:cover;background-position:center;`
      : '';
    const showBanner = !!banner;
    const isMine = uid && +c.user_id === uid;
    const isRoot = !(c.parent_id > 0);

    return `
      <div class="gp-review ${depth ? 'is-reply' : ''} ${showBanner ? 'has-banner' : ''}" data-id="${c.id}">
        <div class="gp-review-main">
          <div class="gp-review-headcard ${showBanner ? 'with-banner' : ''}">
            ${showBanner ? `<div class="gp-review-banner" style="${bannerStyle}"></div>` : ''}
            <div class="gp-review-headcard-inner">
              <div class="gp-review-av ${hasCustomAv ? 'has-img' : 'is-placeholder'}" style="${avStyle}">
                ${hasCustomAv ? '' : iconSvg('users', 18)}
              </div>
              <div class="gp-review-userblock">
                <div class="gp-review-name-row">
                  <button type="button" class="gp-review-name" data-profile-user="${escapeHtml(c.username)}" data-profile-id="${c.user_id || ''}">${escapeHtml(c.username)}</button>
                </div>
                <div class="gp-review-meta-row">
                  ${rating != null ? `<span class="gp-review-score">${iconSvg('star',12)} ${escapeHtml(String(rating))}/5</span>` : ''}
                  ${playH != null ? `<span class="gp-review-playtime">${iconSvg('clock',12)} ${playH} часов</span>` : ''}
                </div>
              </div>
              <span class="gp-review-time">${escapeHtml(formatRelative(c.created_at))}</span>
            </div>
          </div>
          <div class="gp-review-content">
            <div class="gp-review-text">${escapeHtml(c.body)}</div>
            <div class="gp-review-actions">
              <button type="button" class="gp-vote" data-vote="up" data-id="${c.id}" title="Нравится">${iconSvg('thumbsUp',14)} <span>${likes}</span></button>
              <button type="button" class="gp-vote" data-vote="down" data-id="${c.id}" title="Не нравится">${iconSvg('thumbsDown',14)} <span>${dislikes}</span></button>
              ${viewer && viewer.authorized ? `<button type="button" class="gp-reply-btn" data-reply="${c.id}" data-user="${escapeHtml(c.username)}">${iconSvg('reply',14)} Ответить</button>` : ''}
              ${isMine && isRoot ? `<button type="button" class="gp-del-btn" data-del="${c.id}">${iconSvg('trash',14)} Удалить отзыв</button>` : ''}
              ${isMine && !isRoot ? `<button type="button" class="gp-del-btn" data-del="${c.id}">${iconSvg('trash',14)} Удалить</button>` : ''}
            </div>
            <div class="gp-inline-reply hidden" data-inline-for="${c.id}"></div>
          </div>
        </div>
        ${kids.length ? `
          <div class="gp-review-replies">
            ${kids.map(k => renderOne(k, depth + 1)).join('')}
          </div>` : ''}
      </div>`;
  };

  box.innerHTML = roots.map(c => renderOne(c, 0)).join('');

  // vote stubs
  $$('.gp-vote', box).forEach(btn => {
    btn.addEventListener('click', () => toast('Голосование скоро'));
  });

  // inline reply
  $$('.gp-reply-btn', box).forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.reply;
      // close other inlines
      $$('.gp-inline-reply', box).forEach(el => {
        el.classList.add('hidden');
        el.innerHTML = '';
      });
      const slot = box.querySelector(`.gp-inline-reply[data-inline-for="${id}"]`);
      if (!slot) return;
      slot.classList.remove('hidden');
      slot.innerHTML = `
        <div class="gp-inline-reply-box">
          <textarea class="gp-inline-input" maxlength="1000" rows="3" placeholder="Написать ответ..."></textarea>
          <div class="gp-inline-actions">
            <button type="button" class="gp-inline-cancel">Отмена</button>
            <button type="button" class="gp-inline-send">Отправить</button>
          </div>
        </div>`;
      const ta = slot.querySelector('.gp-inline-input');
      ta?.focus();
      slot.querySelector('.gp-inline-cancel')?.addEventListener('click', () => {
        slot.classList.add('hidden');
        slot.innerHTML = '';
      });
      slot.querySelector('.gp-inline-send')?.addEventListener('click', async () => {
        const text = (ta?.value || '').trim();
        if (!text) { toast('Напишите текст ответа'); return; }
        const sendBtn = slot.querySelector('.gp-inline-send');
        if (sendBtn) sendBtn.disabled = true;
        try {
          const gid = gameId || (currentGame && currentGame.game && currentGame.game.id);
          const data = await postJSON(`${API_BASE}?action=comment`, {
            game_id: gid,
            body: text,
            parent_id: +id
          });
          if (!data.ok) throw new Error(data.error || 'Не удалось отправить');
          const page = await fetchJSON(`${API_BASE}?action=get&id=${gid}`);
          if (page.ok) {
            renderCommentsThreaded(page.comments || [], page.viewer || viewer, gid);
            const count = $('#comments-count');
            if (count) count.textContent = (page.comments || []).length;
          }
          toast('Ответ опубликован');
        } catch (err) {
          toast(err.message || 'Ошибка');
          if (sendBtn) sendBtn.disabled = false;
        }
      });
    });
  });

  // delete
  $$('.gp-del-btn', box).forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Удалить?')) return;
      try {
        const data = await postJSON(`${API_BASE}?action=delete_comment`, { comment_id: +btn.dataset.del });
        if (!data.ok) throw new Error(data.error || 'Не удалось удалить');
        const gid = gameId || (currentGame && currentGame.game && currentGame.game.id);
        const page = await fetchJSON(`${API_BASE}?action=get&id=${gid}`);
        if (page.ok) {
          renderCommentsThreaded(page.comments || [], page.viewer || viewer, gid);
          const count = $('#comments-count');
          if (count) count.textContent = (page.comments || []).length;
        }
        toast('Удалено');
      } catch (err) {
        toast(err.message || 'Ошибка');
      }
    });
  });

  // ник → профиль
  $$('.gp-review-name[data-profile-user]', box).forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const uname = btn.dataset.profileUser;
      const id = btn.dataset.profileId ? +btn.dataset.profileId : null;
      if (typeof openUserProfile === 'function') openUserProfile(uname, id);
      else toast('Профиль: ' + uname);
    });
  });
}

function initReviewSort(comments, viewer) {
  const sortBtns = () => $$('.gp-sort-opt');
  sortBtns().forEach(btn => {
    if (btn.dataset.sortBound === '1') return;
    btn.dataset.sortBound = '1';
    btn.addEventListener('click', () => {
      sortBtns().forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const list = [...(comments || [])];
      const mode = btn.dataset.sort;
      if (mode === 'new') list.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
      else if (mode === 'old') list.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
      else if (mode === 'score') list.sort((a,b) => (b.rating||b.user_rating||0) - (a.rating||a.user_rating||0) || new Date(b.created_at) - new Date(a.created_at));
      else if (mode === 'popular') list.sort((a,b) => ((b.likes||0)-(b.dislikes||0)) - ((a.likes||0)-(a.dislikes||0)) || new Date(b.created_at) - new Date(a.created_at));
      renderCommentsThreaded(list, viewer);
    });
  });
}

async function loadSimilarGames(game) {
  const grid = $('#gp-similar') || $('#gp-similar-grid');
  if (!grid) return;
  try {
    const data = await fetchJSON(`${API_BASE}?action=list&category=game`);
    if (!data.ok) throw new Error();
    let list = (data.games || []).filter(g => +g.id !== +game.id);
    if (game.genre) {
      const same = list.filter(g => g.genre === game.genre);
      list = [...same, ...list.filter(g => g.genre !== game.genre)];
    }
    list = list.slice(0, 6);
    if (!list.length) {
      grid.innerHTML = '<div class="gp-empty-sub">Пока нет похожих игр</div>';
      return;
    }
    grid.innerHTML = list.map(g => `
      <button type="button" class="gp-similar-card" data-id="${g.id}" title="${escapeHtml(g.title)}">
        <img src="${escapeHtml(g.cover_src || g.cover_url || ('media.php?type=cover&id=' + g.id))}" alt="${escapeHtml(g.title)}" loading="lazy" />
      </button>`).join('');
    $$('.gp-similar-card', grid).forEach(card => {
      card.addEventListener('click', () => gotoGame(card.dataset.id));
    });
  } catch (e) {
    grid.innerHTML = '<div class="gp-empty-sub">Не удалось загрузить</div>';
  }
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
    if (note) note.textContent = ''; // «в библиотеке» уже написано на панели под обложкой
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
      toast(data.message || 'Добавлено в библиотеку');
      loadGamePage(g.id);
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


function openAdminGameEditModal(g) {
  let modal = document.getElementById('admin-game-edit-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'admin-game-edit-modal';
    modal.className = 'submit-modal hidden';
    modal.innerHTML = `
      <div class="submit-modal-backdrop" id="age-backdrop"></div>
      <div class="submit-modal-box submit-modal-wide" role="dialog" aria-modal="true">
        <div class="submit-modal-head">
          <h2>Редактирование карточки</h2>
          <button type="button" class="friends-modal-close" id="admin-edit-close" aria-label="Закрыть">×</button>
        </div>
        <div class="submit-modal-body">
          <div class="submit-grid">
            <label class="settings-label"><span>Название</span><input class="auth-input" id="age-title" maxlength="120" /></label>
            <label class="settings-label"><span>Жанр</span><input class="auth-input" id="age-genre" /></label>
            <label class="settings-label"><span>Цена (₽)</span><input class="auth-input" id="age-price" type="number" min="0" step="1" /></label>
            <label class="settings-label full"><span>Краткое описание</span><input class="auth-input" id="age-short" maxlength="200" /></label>
            <label class="settings-label full"><span>Описание</span><textarea class="auth-input settings-textarea" id="age-desc" rows="6"></textarea></label>
            <label class="settings-label full"><span>Видео URL</span><input class="auth-input" id="age-video" placeholder="https://youtube.com/..." /></label>
            <label class="settings-label"><span>Новая обложка</span><input type="file" id="age-cover" accept="image/*" /></label>
            <label class="settings-label"><span>Новый баннер</span><input type="file" id="age-banner" accept="image/*" /></label>
          </div>
          <div id="age-error" class="gp-comment-error hidden" style="margin-top:12px"></div>
        </div>
        <div class="submit-modal-foot admin-edit-foot">
          <button type="button" class="btn-danger" id="age-delete">Удалить карточку</button>
          <div class="admin-edit-foot-right">
            <button type="button" class="hp-btn-edit" id="age-cancel">Отмена</button>
            <button type="button" class="auth-submit" id="age-save">Сохранить</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const close = () => modal.classList.add('hidden');
    modal.querySelector('#age-backdrop')?.addEventListener('click', close);
    modal.querySelector('#admin-edit-close')?.addEventListener('click', close);
    modal.querySelector('#age-cancel')?.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) close();
    });
  }

  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  setVal('age-title', g.title || '');
  setVal('age-genre', g.genre || '');
  setVal('age-price', g.price ?? 0);
  setVal('age-short', g.short_description || '');
  setVal('age-desc', g.description || '');
  setVal('age-video', g.video_url || '');

  const coverInput = document.getElementById('age-cover');
  const bannerInput = document.getElementById('age-banner');
  if (coverInput) coverInput.value = '';
  if (bannerInput) bannerInput.value = '';

  const err = document.getElementById('age-error');
  if (err) { err.classList.add('hidden'); err.textContent = ''; }

  modal.dataset.gameId = String(g.id);
  modal.classList.remove('hidden');

  const saveBtn = document.getElementById('age-save');
  const delBtn = document.getElementById('age-delete');

  if (saveBtn) {
    saveBtn.onclick = async () => {
      const id = modal.dataset.gameId;
      const fd = new FormData();
      fd.append('csrf_token', window.CSRF_TOKEN || '');
      fd.append('id', id);
      fd.append('title', document.getElementById('age-title')?.value || '');
      fd.append('genre', document.getElementById('age-genre')?.value || '');
      fd.append('price', document.getElementById('age-price')?.value || '0');
      fd.append('short_description', document.getElementById('age-short')?.value || '');
      fd.append('description', document.getElementById('age-desc')?.value || '');
      fd.append('video_url', document.getElementById('age-video')?.value || '');
      fd.append('sys_req_min', g.sys_req_min || '');
      fd.append('sys_req_rec', g.sys_req_rec || '');
      fd.append('controllers', g.controllers || '');
      fd.append('languages', typeof g.languages === 'string' ? g.languages : JSON.stringify(g.languages || []));
      fd.append('review_note', '');
      fd.append('delete_media', '');
      const cover = document.getElementById('age-cover')?.files?.[0];
      if (cover) fd.append('cover', cover);
      const banner = document.getElementById('age-banner')?.files?.[0];
      if (banner) fd.append('banner', banner);
      saveBtn.disabled = true;
      try {
        const res = await fetch(`${SUBMIT_API}?action=admin_save`, { method: 'POST', body: fd });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Ошибка сохранения');
        toast('Сохранено');
        modal.classList.add('hidden');
        homeCache = null;
        storeCache = [];
        loadGamePage(+id);
      } catch (e) {
        if (err) { err.textContent = e.message || 'Ошибка'; err.classList.remove('hidden'); }
        toast(e.message || 'Ошибка');
      } finally {
        saveBtn.disabled = false;
      }
    };
  }

  if (delBtn) {
    delBtn.onclick = async () => {
      if (!confirm('Удалить карточку игры полностью? Это нельзя отменить.')) return;
      if (!confirm('Точно удалить? Комментарии, медиа и запись в каталоге будут стерты.')) return;
      delBtn.disabled = true;
      try {
        const data = await postJSON(`${SUBMIT_API}?action=delete_game`, { id: +modal.dataset.gameId });
        if (!data.ok) throw new Error(data.error || 'Не удалось удалить');
        toast('Игра удалена');
        modal.classList.add('hidden');
        homeCache = null;
        storeCache = [];
        if (typeof gotoView === 'function') gotoView('home');
        else showView('home');
      } catch (e) {
        toast(e.message || 'Ошибка удаления');
      } finally {
        delBtn.disabled = false;
      }
    };
  }
}

function bindAdminGameEdit(g, viewer) {
  const btn = $('#gp-admin-edit');
  if (!btn || !viewer?.is_admin) return;
  btn.addEventListener('click', () => openAdminGameEditModal(g));
}

function initCommentForm(g, viewer) {
  const form = $('#comment-form');
  if (!form || form.dataset.bound === '1') return;
  form.dataset.bound = '1';
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#comment-input');
    if (!input) return;
    let errBox = $('#comment-error');
    if (!errBox) {
      errBox = document.createElement('div');
      errBox.id = 'comment-error';
      errBox.className = 'gp-comment-error hidden';
      form.insertBefore(errBox, form.firstChild);
    }
    const btn = form.querySelector('button[type="submit"]');
    const text = (input.value || '').trim();
    if (!text) {
      errBox.textContent = 'Напишите текст отзыва';
      errBox.classList.remove('hidden');
      return;
    }
    errBox.classList.add('hidden');
    if (btn) btn.disabled = true;
    try {
      // корневой отзыв — без parent_id
      const data = await postJSON(`${API_BASE}?action=comment`, { game_id: g.id, body: text });
      if (!data.ok) throw new Error(data.error || 'Не удалось отправить');
      const page = await fetchJSON(`${API_BASE}?action=get&id=${g.id}`);
      if (page.ok) {
        renderCommentsThreaded(page.comments || [], page.viewer || viewer, g.id);
        const count = $('#comments-count');
        if (count) count.textContent = (page.comments || []).length;
      }
      input.value = '';
      const len = $('#comment-len');
      if (len) len.textContent = '0';
      toast('Отзыв опубликован');
    } catch (err) {
      console.error(err);
      errBox.textContent = err.message || 'Ошибка отправки';
      errBox.classList.remove('hidden');
      toast(err.message || 'Не удалось отправить отзыв');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  const input = $('#comment-input');
  if (input && !input.dataset.lenBound) {
    input.dataset.lenBound = '1';
    input.addEventListener('input', () => {
      const el = $('#comment-len');
      if (el) el.textContent = String((input.value || '').length);
    });
  }
}

// ============================================================
//  БИБЛИОТЕКА (сетка карточек, как в Hydra)
// ============================================================
let libraryCache = [];
let libraryFilter = 'all';
let librarySearch = '';
let librarySort = 'name';

async function loadLibrary() {
  const grid = $('#library-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading">Загрузка библиотеки...</div>';

  try {
    const data = await fetchJSON(`${API_BASE}?action=library`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');

    libraryCache = data.library || [];
    renderLibraryGrid();
  } catch (err) {
    if (isOffline(err)) {
      renderOffline(grid, loadLibrary, 'Кот ушёл в запой');
    } else {
      grid.innerHTML = `<div class="loading">Ошибка загрузки<br><small>${escapeHtml(err.message)}</small></div>`;
    }
  }
}

function renderLibraryGrid() {
  const grid = $('#library-grid');
  if (!grid) return;

  let items = libraryCache;
  if (libraryFilter === 'installed') {
    const ids = getInstalledIds();
    items = items.filter(g => ids.includes(+g.id));
  } else if (libraryFilter !== 'all') {
    items = items.filter(g => g.category === libraryFilter);
  }
  if (librarySearch) {
    const q = librarySearch.toLowerCase();
    items = items.filter(g => (g.title || '').toLowerCase().includes(q));
  }
  if (librarySort === 'name') {
    items = [...items].sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ru'));
  } else if (librarySort === 'rating') {
    items = [...items].sort((a, b) => parseFloat(b.rating || 0) - parseFloat(a.rating || 0));
  }
  // 'recent' — порядок из API (недавно добавленные)

  if (!items.length) {
    grid.innerHTML = libraryCache.length
      ? '<div class="loading">Ничего не найдено</div>'
      : `<div class="library-empty">
          <p>Библиотека пуста.</p>
          <button type="button" class="btn-primary" onclick="gotoView('store')">В каталог</button>
        </div>`;
    return;
  }

  const installed = getInstalledIds();
  grid.innerHTML = '';
  items.forEach(g => {
    const card = document.createElement('article');
    card.className = 'lib-card';
    card.dataset.id = g.id;
    card.innerHTML = `
      <div class="lib-card-cover">
        <img src="media.php?type=cover&id=${g.id}" alt="${escapeHtml(g.title)}" loading="lazy" />
        ${installed.includes(+g.id) ? '<span class="lib-card-badge">✓ установлена</span>' : ''}
      </div>
      <div class="lib-card-info">
        <div class="lib-card-title">${escapeHtml(g.title)}</div>
        <div class="lib-card-meta">${g.category === 'asset' ? 'Ассет' : escapeHtml(g.genre || '')}</div>
      </div>
    `;
    card.addEventListener('click', () => gotoGame(g.id));
    grid.appendChild(card);
  });
}

function initLibraryControls() {
  const filters = $('#library-filters');
  if (filters) {
    $$('.lib-filter', filters).forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.lib-filter', filters).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        libraryFilter = btn.dataset.filter;
        renderLibraryGrid();
      });
    });
  }
  const sort = $('#library-sort');
  if (sort) {
    sort.addEventListener('change', () => {
      librarySort = sort.value;
      renderLibraryGrid();
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
  const n = dm.queue.length + (dm.active ? 1 : 0) + (dm.pausedItem ? 1 : 0);
  if (badge) {
    badge.textContent = n;
    badge.classList.toggle('hidden', n === 0);
  }
  const st = $('#side-dl-status');
  if (st) {
    st.textContent = n > 0 ? `Активных загрузок: ${n}` : 'Нет активных загрузок';
  }
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
    markInstalled(item.gameId); // игра считается установленной на этом ПК
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
  const queued = dlSearch
    ? dm.queue.filter(q => (q.title || '').toLowerCase().includes(dlSearch.toLowerCase()))
    : dm.queue;

  if (!item && !queued.length) {
    activeBox.innerHTML = `
      <div class="downloads-empty" id="downloads-empty">
        <div class="downloads-empty-icon">↓</div>
        <p class="downloads-empty-title">Здесь так пусто...</p>
        <p class="downloads-empty-sub">Вы ещё ничего не скачали через CATio, но никогда не поздно начать.</p>
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
  const history = dlSearch
    ? dm.history.filter(h => (h.title || '').toLowerCase().includes(dlSearch.toLowerCase()))
    : dm.history;
  if (!history.length) {
    box.innerHTML = '<p class="downloads-history-empty">Пока пусто</p>';
    return;
  }
  box.innerHTML = history.map(h => `
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
//  ПРОФИЛЬ (Hydra-style)
// ============================================================
let profileLibraryCache = null;
let profileSort = 'recent';
let profilePlatform = 'all';

function formatPlaytime(minutes) {
  const m = parseInt(minutes, 10) || 0;
  if (m < 1) return '0 минут';
  if (m < 60) return m + ' минут';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) {
    return rem > 0 ? `${h} ч ${rem} мин` : `${h} ${h === 1 ? 'час' : h < 5 ? 'часа' : 'часов'}`;
  }
  return `${h} часов`;
}

function formatPlaytimeShort(minutes) {
  const m = parseInt(minutes, 10) || 0;
  if (m < 1) return '0 мин';
  if (m < 60) return m + ' мин';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (rem === 0) return h + ' ч';
  return `${h} ч ${rem} мин`;
}

function gameCardHtml(g, { showPin = true } = {}) {
  const mins = parseInt(g.playtime_minutes, 10) || 0;
  const timeLabel = formatPlaytimeShort(mins);
  const pinned = !!+g.is_pinned;
  return `
    <div class="hp-game-card" data-id="${g.id}" data-title="${escapeHtml((g.title || '').toLowerCase())}">
      <img src="media.php?type=cover&id=${g.id}" alt="${escapeHtml(g.title)}" loading="lazy" />
      <span class="hp-game-time">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        ${escapeHtml(timeLabel)}
      </span>
      ${showPin ? `<button type="button" class="hp-game-pin ${pinned ? 'pinned' : ''}" data-id="${g.id}" data-pinned="${pinned ? 1 : 0}" title="${pinned ? 'Открепить' : 'Закрепить'}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="${pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
      </button>` : ''}
    </div>`;
}

async function loadProfile() {
  viewingUserId = null;
  // restore own toolbar if was viewing foreign profile
  const toolbar = $('.hp-toolbar');
  if (toolbar && !toolbar.querySelector('#btn-edit-profile')) {
    toolbar.innerHTML = `
      <div class="hp-toolbar-spacer"></div>
      <button type="button" class="hp-btn-edit" id="btn-edit-profile">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Редактировать Профиль
      </button>
      <button type="button" class="hp-btn-logout" onclick="logout()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Выйти
      </button>`;
  }
  const upload = $('#hp-banner-upload');
  if (upload) upload.style.display = '';
  // restore own banner/avatar from AUTH_STATE
  const me = window.AUTH_STATE && window.AUTH_STATE.user;
  if (me) {
    const bg = $('#hp-banner-bg');
    if (bg && me.banner_url) {
      const zoom = parseFloat(me.banner_zoom) || 1;
      const size = zoom <= 1.01 ? 'cover' : (Math.round(zoom * 100) + '%');
      bg.style.backgroundImage = `url('${me.banner_url}')`;
      bg.style.backgroundPosition = me.banner_pos || '50% 50%';
      bg.style.backgroundSize = size;
      bg.classList.add('has-image');
    }
    const av = $('#hp-avatar');
    if (av && me.avatar_url) {
      av.style.backgroundImage = `url('${me.avatar_url}')`;
      av.style.backgroundSize = 'cover';
      av.style.backgroundPosition = 'center';
      av.textContent = '';
    }
    const uname = $('#hp-username');
    if (uname) uname.textContent = me.username;
  }
  loadProfileStats();
  loadProfileActivity();
  loadProfileFriends();
  await loadProfileLibrary();
  initProfileControls();
}

async function loadProfileStats() {
  try {
    const data = await fetchJSON(`${USER_API}?action=stats`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const s = data.stats;

    const playtimeEl = $('#hp-stat-playtime');
    if (playtimeEl) {
      playtimeEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${formatPlaytime(s.playtime_minutes || 0)}`;
    }
    const topEl = $('#hp-stat-top');
    if (topEl) topEl.textContent = s.top_percent ? `Топ ${s.top_percent}%` : '—';

    const karmaEl = $('#hp-stat-karma');
    if (karmaEl) {
      karmaEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2z"/></svg> ${s.karma || 0} карма`;
    }
  } catch (err) {
    // не критично
  }
}

async function loadProfileActivity() {
  const box = $('#hp-activity');
  if (!box) return;
  try {
    const data = await fetchJSON(`${USER_API}?action=activity`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    if (!data.activity || !data.activity.length) {
      box.innerHTML = '<div class="hp-empty" style="padding:20px 0">Пока нет активности</div>';
      return;
    }
    box.innerHTML = data.activity.slice(0, 8).map(a => {
      const title = a.title || a.text || 'Игра';
      const timeLabel = a.playtime_minutes
        ? formatPlaytimeShort(a.playtime_minutes)
        : (a.ts ? formatDateTime(a.ts) : '');
      return `
        <div class="hp-activity-item" data-id="${a.game_id || ''}">
          <img class="hp-activity-icon" src="media.php?type=cover&id=${a.game_id || 0}" alt="" loading="lazy"
               onerror="this.style.display='none'" />
          <div class="hp-activity-info">
            <div class="hp-activity-title">${escapeHtml(title)}</div>
            <div class="hp-activity-time">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              ${escapeHtml(timeLabel)}
            </div>
          </div>
        </div>`;
    }).join('');

    $$('.hp-activity-item', box).forEach(item => {
      item.addEventListener('click', () => {
        if (item.dataset.id) gotoGame(item.dataset.id);
      });
    });
  } catch (err) {
    box.innerHTML = `<div class="hp-empty" style="padding:20px 0">${escapeHtml(err.message)}</div>`;
  }
}

async function loadProfileLibrary() {
  const pinnedBox = $('#hp-pinned-games');
  const libBox = $('#hp-library-games');
  if (!libBox) return;

  try {
    const data = await fetchJSON(`${API_BASE}?action=library`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    profileLibraryCache = data.library || [];
    renderProfileLibrary();
  } catch (err) {
    if (pinnedBox) pinnedBox.innerHTML = '';
    libBox.innerHTML = `<div class="hp-empty">${escapeHtml(err.message)}</div>`;
  }
}

function renderProfileLibrary() {
  let games = [...(profileLibraryCache || [])];

  if (profileSort === 'recent') {
    games.sort((a, b) => {
      const ta = a.last_played ? new Date(a.last_played).getTime() : 0;
      const tb = b.last_played ? new Date(b.last_played).getTime() : 0;
      return tb - ta;
    });
  } else if (profileSort === 'name') {
    games.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ru'));
  } else if (profileSort === 'playtime') {
    games.sort((a, b) => (parseInt(b.playtime_minutes, 10) || 0) - (parseInt(a.playtime_minutes, 10) || 0));
  } else if (profileSort === 'added') {
    games.sort((a, b) => {
      const ta = a.added_at ? new Date(a.added_at).getTime() : 0;
      const tb = b.added_at ? new Date(b.added_at).getTime() : 0;
      return tb - ta;
    });
  }

  if (profileSearch) {
    const q = profileSearch.toLowerCase();
    games = games.filter(g => (g.title || '').toLowerCase().includes(q));
  }

  const pinned = games.filter(g => +g.is_pinned);
  const rest = games.filter(g => !+g.is_pinned);

  const pinnedBox = $('#hp-pinned-games');
  const pinnedSection = $('#hp-pinned-section');
  const pinnedCount = $('#hp-pinned-count');
  if (pinnedBox) {
    if (!pinned.length) {
      if (pinnedSection) pinnedSection.style.display = 'none';
    } else {
      if (pinnedSection) pinnedSection.style.display = '';
      if (pinnedCount) pinnedCount.textContent = pinned.length;
      pinnedBox.innerHTML = pinned.map(g => gameCardHtml(g)).join('');
    }
  }

  const libBox = $('#hp-library-games');
  const libCount = $('#hp-library-count');
  if (libCount) libCount.textContent = rest.length;
  if (libBox) {
    if (!rest.length && !pinned.length) {
      libBox.innerHTML = '<div class="hp-empty">Библиотека пуста. Загляни в каталог.</div>';
    } else if (!rest.length) {
      libBox.innerHTML = '<div class="hp-empty">Все игры закреплены сверху.</div>';
    } else {
      libBox.innerHTML = rest.map(g => gameCardHtml(g)).join('');
    }
  }

  $$('.hp-game-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.hp-game-pin')) return;
      gotoGame(card.dataset.id);
    });
  });
  $$('.hp-game-pin').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const currentlyPinned = btn.dataset.pinned === '1';
      try {
        const res = await postJSON(`${USER_API}?action=pin`, {
          game_id: +id,
          pinned: currentlyPinned ? 0 : 1,
        });
        if (!res.ok) throw new Error(res.error || 'Ошибка');
        const g = profileLibraryCache.find(x => +x.id === +id);
        if (g) {
          g.is_pinned = currentlyPinned ? 0 : 1;
          g.pinned_order = currentlyPinned ? 0 : Date.now();
        }
        renderProfileLibrary();
        toast(currentlyPinned ? 'Игра откреплена' : 'Игра закреплена');
      } catch (err) {
        toast(err.message || 'Не удалось изменить закрепление');
      }
    });
  });
}

function initProfileControls() {
  $$('.hp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.hp-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.ptab;
      const libSection = $('#hp-library-section');
      const pinnedSection = $('#hp-pinned-section');
      const filters = $('#hp-filters');
      ['reviews', 'souvenirs', 'screenshots'].forEach(p => {
        const pane = $(`#hp-pane-${p}`);
        if (pane) pane.classList.toggle('hidden', name !== p);
      });
      const showLib = name === 'library';
      if (libSection) libSection.style.display = showLib ? '' : 'none';
      if (pinnedSection) {
        // hide only if switching away; re-render will set visibility for empty
        if (!showLib) pinnedSection.style.display = 'none';
        else renderProfileLibrary();
      }
      if (filters) filters.style.display = showLib ? '' : 'none';
    });
  });

  const sortSel = $('#hp-sort');
  if (sortSel) {
    sortSel.addEventListener('change', () => {
      profileSort = sortSel.value;
      renderProfileLibrary();
    });
  }
  const platSel = $('#hp-platform');
  if (platSel) {
    platSel.addEventListener('change', () => {
      profilePlatform = platSel.value;
      renderProfileLibrary();
    });
  }

  $$('.hp-side-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const body = btn.closest('.hp-side-card')?.querySelector('.hp-side-body');
      if (!body) return;
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      btn.textContent = hidden ? '▴' : '▾';
    });
  });

  // --- Edit profile modal ---
  const modal = $('#hp-edit-modal');
  const openEdit = () => { if (modal) modal.classList.remove('hidden'); };
  const closeEdit = () => { if (modal) modal.classList.add('hidden'); };

  const editBtn = $('#btn-edit-profile');
  if (editBtn) editBtn.addEventListener('click', openEdit);
  // keep old settings button working too if present
  const oldSettings = $('#btn-settings-open');
  if (oldSettings) oldSettings.addEventListener('click', openEdit);

  const closeBtn = $('#hp-edit-close');
  if (closeBtn) closeBtn.addEventListener('click', closeEdit);
  const backdrop = $('#hp-edit-backdrop');
  if (backdrop) backdrop.addEventListener('click', closeEdit);

  // Avatar upload
  const avatarBtn = $('#hp-avatar-upload');
  const avatarFile = $('#hp-avatar-file');
  if (avatarBtn && avatarFile) {
    avatarBtn.addEventListener('click', () => avatarFile.click());
    avatarFile.addEventListener('change', async () => {
      if (!avatarFile.files || !avatarFile.files[0]) return;
      await uploadProfileImage('avatar', avatarFile.files[0]);
      avatarFile.value = '';
    });
  }

  // Banner editor modal
  initBannerEditor();

  // Save display name
  const saveBtn = $('#hp-edit-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const input = $('#hp-edit-displayname');
      const name = (input ? input.value : '').trim();
      if (!name) { toast('Введите имя'); return; }
      saveBtn.disabled = true;
      try {
        const res = await postJSON(`${USER_API}?action=profile`, { display_name: name });
        if (!res.ok) throw new Error(res.error || 'Ошибка');
        const uname = $('#hp-username');
        if (uname) uname.textContent = res.username;
        if (window.AUTH_STATE && window.AUTH_STATE.user) {
          window.AUTH_STATE.user.username = res.username;
        }
        // side user name
        $$('.side-user-name, .user-menu-name').forEach(el => { el.textContent = res.username; });
        toast('Профиль сохранён');
        closeEdit();
      } catch (err) {
        toast(err.message || 'Не удалось сохранить');
      } finally {
        saveBtn.disabled = false;
      }
    });
  }
}

async function uploadProfileImage(kind, file) {
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('file', file);
  fd.append('csrf_token', window.CSRF_TOKEN || '');
  try {
    const res = await fetch(`${USER_API}?action=upload`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Ошибка загрузки');
    const url = data.url + '?t=' + Date.now();
    if (kind === 'avatar') {
      const el = $('#hp-avatar');
      if (el) {
        el.style.backgroundImage = `url('${url}')`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.textContent = '';
      }
      const editEl = $('#hp-edit-avatar');
      if (editEl) {
        editEl.style.backgroundImage = `url('${url}')`;
        editEl.style.backgroundSize = 'cover';
        editEl.style.backgroundPosition = 'center';
        editEl.textContent = '';
      }
      // sidebar avatar
      const applyAva = (el) => {
        if (!el) return;
        el.style.backgroundImage = `url('${url}')`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.style.backgroundColor = 'transparent';
        el.textContent = '';
      };
      applyAva($('#side-avatar'));
      applyAva($('#avatar-btn'));
      applyAva($('#settings-avatar-preview'));
      applyAva($('#hp-avatar'));
      applyAva($('#hp-edit-avatar'));
      if (window.AUTH_STATE && window.AUTH_STATE.user) {
        window.AUTH_STATE.user.avatar_url = data.url;
      }
      toast('Аватар обновлён');
    } else {
      const bg = $('#hp-banner-bg');
      if (bg) {
        bg.style.backgroundImage = `url('${url}')`;
        bg.classList.add('has-image');
      }
      if (window.AUTH_STATE && window.AUTH_STATE.user) {
        window.AUTH_STATE.user.banner_url = data.url;
      }
      toast('Баннер обновлён');
    }
  } catch (err) {
    toast(err.message || 'Не удалось загрузить');
  }
}

// ---------- Редактор баннера (превью + зум + перетаскивание) ----------
let bannerEditor = {
  objectUrl: null,
  pendingFile: null,
  posX: 50,
  posY: 50,
  zoom: 1,
  dragging: false,
  lastX: 0,
  lastY: 0,
};

function initBannerEditor() {
  const modal = $('#hp-banner-modal');
  const openBtn = $('#hp-banner-upload');
  const closeBtn = $('#hp-banner-close');
  const backdrop = $('#hp-banner-backdrop');
  const pickBtn = $('#hp-banner-pick');
  const fileInput = $('#hp-banner-file-modal') || $('#hp-banner-file');
  const saveBtn = $('#hp-banner-save');
  const zoomSl = $('#hp-banner-zoom');
  const zoomVal = $('#hp-banner-zoom-val');
  const preview = $('#hp-banner-preview');
  const previewImg = $('#hp-banner-preview-img');

  if (!modal || !openBtn) return;

  const open = () => {
    // load current banner into preview
    const bg = $('#hp-banner-bg');
    let url = '';
    if (window.AUTH_STATE?.user?.banner_url) {
      url = window.AUTH_STATE.user.banner_url;
    } else if (bg && bg.style.backgroundImage) {
      const m = bg.style.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
      if (m) url = m[1];
    }
    // restore pos/zoom from auth or defaults
    const pos = (window.AUTH_STATE?.user?.banner_pos || '50% 50%').split(/\s+/);
    bannerEditor.posX = parseFloat(pos[0]) || 50;
    bannerEditor.posY = parseFloat(pos[1]) || 50;
    bannerEditor.zoom = parseFloat(window.AUTH_STATE?.user?.banner_zoom) || 1;
    if (bannerEditor.zoom < 1) bannerEditor.zoom = 1;

    bannerEditor.pendingFile = null;
    if (bannerEditor.objectUrl) {
      URL.revokeObjectURL(bannerEditor.objectUrl);
      bannerEditor.objectUrl = null;
    }

    if (url && previewImg) {
      previewImg.style.backgroundImage = `url('${url}')`;
      applyBannerPreview();
    } else if (previewImg) {
      previewImg.style.backgroundImage = '';
    }
    if (zoomSl) zoomSl.value = Math.round(bannerEditor.zoom * 100);
    if (zoomVal) zoomVal.textContent = Math.round(bannerEditor.zoom * 100) + '%';
    modal.classList.remove('hidden');
  };

  const close = () => {
    modal.classList.add('hidden');
    if (bannerEditor.objectUrl) {
      URL.revokeObjectURL(bannerEditor.objectUrl);
      bannerEditor.objectUrl = null;
    }
    bannerEditor.pendingFile = null;
  };

  openBtn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (backdrop) backdrop.addEventListener('click', close);

  if (pickBtn && fileInput) {
    pickBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (!fileInput.files || !fileInput.files[0]) return;
      const file = fileInput.files[0];
      if (bannerEditor.objectUrl) URL.revokeObjectURL(bannerEditor.objectUrl);
      bannerEditor.objectUrl = URL.createObjectURL(file);
      bannerEditor.pendingFile = file;
      bannerEditor.posX = 50;
      bannerEditor.posY = 50;
      bannerEditor.zoom = 1;
      if (previewImg) previewImg.style.backgroundImage = `url('${bannerEditor.objectUrl}')`;
      if (zoomSl) zoomSl.value = 100;
      if (zoomVal) zoomVal.textContent = '100%';
      applyBannerPreview();
      fileInput.value = '';
    });
  }

  if (zoomSl) {
    zoomSl.addEventListener('input', () => {
      bannerEditor.zoom = Math.max(1, Math.min(2.5, (parseInt(zoomSl.value, 10) || 100) / 100));
      if (zoomVal) zoomVal.textContent = Math.round(bannerEditor.zoom * 100) + '%';
      applyBannerPreview();
    });
  }

  // drag to pan
  if (preview) {
    const onDown = (e) => {
      bannerEditor.dragging = true;
      const pt = e.touches ? e.touches[0] : e;
      bannerEditor.lastX = pt.clientX;
      bannerEditor.lastY = pt.clientY;
    };
    const onMove = (e) => {
      if (!bannerEditor.dragging) return;
      const pt = e.touches ? e.touches[0] : e;
      const dx = pt.clientX - bannerEditor.lastX;
      const dy = pt.clientY - bannerEditor.lastY;
      bannerEditor.lastX = pt.clientX;
      bannerEditor.lastY = pt.clientY;
      // sensitivity depends on zoom — higher zoom = more room to pan
      const sens = 0.25 / bannerEditor.zoom;
      bannerEditor.posX = Math.max(0, Math.min(100, bannerEditor.posX - dx * sens));
      bannerEditor.posY = Math.max(0, Math.min(100, bannerEditor.posY - dy * sens));
      applyBannerPreview();
      e.preventDefault();
    };
    const onUp = () => { bannerEditor.dragging = false; };
    preview.addEventListener('mousedown', onDown);
    preview.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      try {
        // 1) upload new file if chosen
        if (bannerEditor.pendingFile) {
          await uploadProfileImage('banner', bannerEditor.pendingFile);
          bannerEditor.pendingFile = null;
        }
        // 2) save position / zoom
        const pos = `${Math.round(bannerEditor.posX)}% ${Math.round(bannerEditor.posY)}%`;
        const res = await postJSON(`${USER_API}?action=banner_display`, {
          pos,
          zoom: bannerEditor.zoom,
        });
        if (!res.ok) throw new Error(res.error || 'Ошибка');
        applyBannerToHero(pos, res.zoom);
        if (window.AUTH_STATE?.user) {
          window.AUTH_STATE.user.banner_pos = pos;
          window.AUTH_STATE.user.banner_zoom = res.zoom;
        }
        toast('Баннер сохранён');
        close();
      } catch (err) {
        toast(err.message || 'Не удалось сохранить');
      } finally {
        saveBtn.disabled = false;
      }
    });
  }
}

function applyBannerPreview() {
  const el = $('#hp-banner-preview-img');
  if (!el) return;
  const size = bannerEditor.zoom <= 1.01 ? 'cover' : (Math.round(bannerEditor.zoom * 100) + '%');
  el.style.backgroundPosition = `${bannerEditor.posX}% ${bannerEditor.posY}%`;
  el.style.backgroundSize = size;
}

function applyBannerToHero(pos, zoom) {
  const bg = $('#hp-banner-bg');
  if (!bg) return;
  const size = zoom <= 1.01 ? 'cover' : (Math.round(zoom * 100) + '%');
  bg.style.backgroundPosition = pos;
  bg.style.backgroundSize = size;
  bg.classList.add('has-image');
}



// ---------- Вкладка настроек ----------
function initSettingsView() {
  const view = $('#view-settings');
  if (!view) return;

  const menuSettings = $('#menu-settings');
  if (menuSettings) menuSettings.addEventListener('click', () => {
    const menu = $('#user-menu');
    if (menu) menu.classList.add('hidden');
    gotoView('settings');
  });
  const topupOpen = $('#btn-topup-open');
  if (topupOpen) topupOpen.addEventListener('click', () => {
    gotoView('settings');
    switchSettingsTab('balance');
  });

  $$('.settings-nav-btn', view).forEach(btn => {
    btn.addEventListener('click', () => switchSettingsTab(btn.dataset.stab));
  });

  // load current prefs into form
  const me = window.AUTH_STATE && window.AUTH_STATE.user;
  if (me) {
    const pvis = $('#settings-profile-vis');
    if (pvis) pvis.value = me.profile_visibility || 'public';
    const mvis = $('#settings-media-vis');
    if (mvis) mvis.value = me.media_visibility || 'public';
    const allow = $('#settings-allow-friends');
    if (allow) allow.checked = me.allow_friend_requests !== 0;
    const email = $('#settings-email');
    if (email) email.value = me.email || '';
    const uname = $('#settings-username');
    if (uname) uname.value = me.username || '';
    // notif prefs
    let prefs = {};
    try { prefs = typeof me.notif_prefs === 'string' ? JSON.parse(me.notif_prefs) : (me.notif_prefs || {}); } catch (e) {}
    $$('[data-np]').forEach(cb => {
      const key = cb.dataset.np;
      if (prefs[key] === undefined) return;
      cb.checked = !!prefs[key];
    });
  }

  // avatar upload
  const setAvaBtn = $('#settings-avatar-upload');
  const setAvaFile = $('#settings-avatar-file');
  if (setAvaBtn && setAvaFile) {
    setAvaBtn.addEventListener('click', () => setAvaFile.click());
    setAvaFile.addEventListener('change', async () => {
      if (!setAvaFile.files?.[0]) return;
      await uploadProfileImage('avatar', setAvaFile.files[0]);
      setAvaFile.value = '';
    });
  }

  // banner upload from settings
  const setBanBtn = $('#settings-banner-upload');
  const setBanFile = $('#settings-banner-file');
  if (setBanBtn && setBanFile) {
    setBanBtn.addEventListener('click', () => setBanFile.click());
    setBanFile.addEventListener('change', async () => {
      if (!setBanFile.files?.[0]) return;
      await uploadProfileImage('banner', setBanFile.files[0]);
      const prev = $('#settings-banner-preview');
      const url = window.AUTH_STATE?.user?.banner_url;
      if (prev && url) {
        prev.style.backgroundImage = `url('${url}?t=${Date.now()}')`;
      }
      setBanFile.value = '';
    });
  }

  // save general
  $('#settings-save-general')?.addEventListener('click', async () => {
    const errBox = $('#settings-error');
    if (errBox) errBox.classList.add('hidden');
    try {
      const res = await postJSON(`${USER_API}?action=settings`, {
        section: 'general',
        username: $('#settings-username')?.value?.trim() || '',
        lang: $('#settings-lang')?.value || 'ru',
      });
      if (!res.ok) throw new Error(res.error || 'Ошибка');
      if (window.AUTH_STATE?.user) {
        window.AUTH_STATE.user.username = res.username;
        window.AUTH_STATE.user.lang = res.lang;
      }
      $$('.side-user-name, .user-menu-name, #hp-username').forEach(el => { if (el) el.textContent = res.username; });
      toast('Основные настройки сохранены');
    } catch (err) {
      if (errBox) { errBox.textContent = err.message; errBox.classList.remove('hidden'); }
      else toast(err.message);
    }
  });

  // save notifications
  $('#settings-save-notif')?.addEventListener('click', async () => {
    const prefs = {};
    $$('[data-np]').forEach(cb => { prefs[cb.dataset.np] = !!cb.checked; });
    try {
      const res = await postJSON(`${USER_API}?action=settings`, { section: 'notifications', prefs });
      if (!res.ok) throw new Error(res.error || 'Ошибка');
      if (window.AUTH_STATE?.user) window.AUTH_STATE.user.notif_prefs = prefs;
      toast('Уведомления сохранены');
    } catch (err) { toast(err.message); }
  });

  // save privacy
  $('#settings-save-privacy')?.addEventListener('click', async () => {
    const errBox = $('#settings-privacy-error');
    if (errBox) errBox.classList.add('hidden');
    try {
      const res = await postJSON(`${USER_API}?action=settings`, {
        section: 'privacy',
        profile_visibility: $('#settings-profile-vis')?.value || 'public',
        media_visibility: $('#settings-media-vis')?.value || 'public',
        allow_friend_requests: $('#settings-allow-friends')?.checked ? 1 : 0,
        email: $('#settings-email')?.value?.trim() || '',
      });
      if (!res.ok) throw new Error(res.error || 'Ошибка');
      if (window.AUTH_STATE?.user) {
        window.AUTH_STATE.user.profile_visibility = $('#settings-profile-vis')?.value;
        window.AUTH_STATE.user.media_visibility = $('#settings-media-vis')?.value;
        window.AUTH_STATE.user.allow_friend_requests = $('#settings-allow-friends')?.checked ? 1 : 0;
        window.AUTH_STATE.user.email = $('#settings-email')?.value?.trim();
      }
      toast('Конфиденциальность сохранена');
    } catch (err) {
      if (errBox) { errBox.textContent = err.message; errBox.classList.remove('hidden'); }
      else toast(err.message);
    }
  });

  // Пополнение баланса
  $$('.btn-topup', view).forEach(btn => {
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

function switchSettingsTab(tab) {
  $$('.settings-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.stab === tab));
  $$('.settings-pane').forEach(p => p.classList.toggle('hidden', p.id !== `settings-pane-${tab}`));
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


// ============================================================
//  ДРУЗЬЯ + ЧУЖИЕ ПРОФИЛИ
// ============================================================
const FRIENDS_API = 'api/friends.php';

function friendAvatarStyle(u) {
  if (u.avatar_url) {
    return `background-image:url('${u.avatar_url}');background-size:cover;background-position:center;`;
  }
  const color = u.avatar_color || '#ef5b2c';
  return `background:${color};`;
}
function friendAvatarText(u) {
  if (u.avatar_url) return '';
  if (u.avatar) return escapeHtml(u.avatar);
  return escapeHtml((u.username || '?').slice(0, 1).toUpperCase());
}


async function loadProfileFriends(userId) {
  const box = $('#hp-friends-list');
  const countEl = $('#hp-friends-count');
  if (!box) return;
  try {
    const q = userId ? `&id=${userId}` : '';
    const data = await fetchJSON(`${FRIENDS_API}?action=of_user${q}`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const friends = data.friends || [];
    if (countEl) countEl.textContent = friends.length;
    if (!friends.length) {
      box.innerHTML = '<div class="hp-empty" style="padding:12px 0">Пока нет друзей</div>';
      return;
    }
    box.innerHTML = friends.map(u => `
      <div class="hp-friend-row" data-id="${u.id}" data-username="${escapeHtml(u.username)}">
        <div class="hp-friend-avatar" style="${friendAvatarStyle(u)}">
          ${friendAvatarText(u)}
          ${u.is_online ? '<span class="online-dot"></span>' : ''}
        </div>
        <div style="min-width:0">
          <div class="hp-friend-name">${escapeHtml(u.username)}</div>
          <div class="hp-friend-status">${u.is_online ? 'В сети' : 'Не в сети'}</div>
        </div>
      </div>`).join('');
    $$('.hp-friend-row', box).forEach(row => {
      row.addEventListener('click', () => openUserProfile(row.dataset.username, row.dataset.id));
    });
  } catch (err) {
    box.innerHTML = `<div class="hp-empty" style="padding:12px 0">${escapeHtml(err.message)}</div>`;
  }
}

function openFriendsModal() {
  const modal = $('#friends-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  loadFriendsList();
  const menu = $('#user-menu');
  if (menu) menu.classList.add('hidden');
}

function closeFriendsModal() {
  const modal = $('#friends-modal');
  if (modal) modal.classList.add('hidden');
  const results = $('#friends-search-results');
  if (results) { results.classList.add('hidden'); results.innerHTML = ''; }
  const search = $('#friends-search');
  if (search) search.value = '';
}

async function loadFriendsList() {
  try {
    const data = await fetchJSON(`${FRIENDS_API}?action=list`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');

    // me
    const meBox = $('#friends-me');
    if (meBox && data.me) {
      const me = data.me;
      meBox.innerHTML = `
        <div class="friends-me-avatar" style="${friendAvatarStyle(me)}">
          ${friendAvatarText(me)}
          <span class="online-dot"></span>
        </div>
        <div class="friends-me-info">
          <div class="friends-me-name">${escapeHtml(me.username)}</div>
          <div class="friends-me-status">В сети</div>
        </div>`;
    }

    const renderList = (el, list, mode) => {
      if (!el) return;
      if (!list.length) {
        el.innerHTML = '<div class="friends-empty">Пусто</div>';
        return;
      }
      el.innerHTML = list.map(u => {
        let actions = '';
        if (mode === 'incoming') {
          actions = `
            <button type="button" class="friends-icon-btn accept" data-act="accept" data-id="${u.id}" title="Принять">✓</button>
            <button type="button" class="friends-icon-btn decline" data-act="decline" data-id="${u.id}" title="Отклонить">✕</button>`;
        } else {
          actions = `
            <button type="button" class="friends-icon-btn" data-act="message" data-id="${u.id}" data-username="${escapeHtml(u.username)}" title="Сообщение">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </button>
            <button type="button" class="friends-icon-btn" data-act="profile" data-id="${u.id}" data-username="${escapeHtml(u.username)}" title="Профиль">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </button>`;
        }
        const status = mode === 'online' || u.is_online
          ? 'В сети'
          : (mode === 'incoming' ? 'Входящая заявка' : 'Не в сети');
        return `
          <div class="friends-row" data-id="${u.id}" data-username="${escapeHtml(u.username)}">
            <div class="friends-row-avatar" style="${friendAvatarStyle(u)}">
              ${friendAvatarText(u)}
              ${u.is_online ? '<span class="online-dot"></span>' : ''}
            </div>
            <div class="friends-row-info">
              <div class="friends-row-name">${escapeHtml(u.username)}</div>
              <div class="friends-row-status">${status}</div>
            </div>
            <div class="friends-row-actions">${actions}</div>
          </div>`;
      }).join('');

      $$('.friends-row', el).forEach(row => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('[data-act]')) return;
          openUserProfile(row.dataset.username, row.dataset.id);
        });
      });
      $$('[data-act]', el).forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const act = btn.dataset.act;
          const id = +btn.dataset.id;
          if (act === 'profile') {
            openUserProfile(btn.dataset.username, id);
            return;
          }
          if (act === 'message') {
            openChat(id, btn.dataset.username);
            return;
          }
          if (act === 'accept' || act === 'decline') {
            try {
              const res = await postJSON(`${FRIENDS_API}?action=respond`, {
                user_id: id,
                accept: act === 'accept' ? 1 : 0,
              });
              if (!res.ok) throw new Error(res.error || 'Ошибка');
              toast(act === 'accept' ? 'Заявка принята' : 'Заявка отклонена');
              loadFriendsList();
            } catch (err) {
              toast(err.message || 'Ошибка');
            }
          }
        });
      });
    };

    const incSec = $('#friends-incoming-section');
    const incCount = $('#friends-incoming-count');
    if (data.incoming && data.incoming.length) {
      if (incSec) incSec.style.display = '';
      if (incCount) incCount.textContent = data.incoming.length;
      renderList($('#friends-incoming'), data.incoming, 'incoming');
    } else {
      if (incSec) incSec.style.display = 'none';
    }

    const onCount = $('#friends-online-count');
    const offCount = $('#friends-offline-count');
    if (onCount) onCount.textContent = (data.online || []).length;
    if (offCount) offCount.textContent = (data.offline || []).length;
    renderList($('#friends-online'), data.online || [], 'online');
    renderList($('#friends-offline'), data.offline || [], 'offline');
  } catch (err) {
    toast(err.message || 'Не удалось загрузить друзей');
  }
}

let friendsSearchTimer = null;
async function searchFriends(q) {
  const box = $('#friends-search-results');
  if (!box) return;
  if (!q || q.length < 1) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  try {
    const data = await fetchJSON(`${FRIENDS_API}?action=search&q=${encodeURIComponent(q)}`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    if (!data.users.length) {
      box.innerHTML = '<div class="friends-empty">Никого не найдено</div>';
      box.classList.remove('hidden');
      return;
    }
    box.innerHTML = data.users.map(u => {
      let btn = '';
      if (u.relation === 'none') {
        btn = `<button type="button" class="friends-icon-btn accept" data-act="add" data-id="${u.id}" title="Добавить">+</button>`;
      } else if (u.relation === 'friends') {
        btn = `<span class="friends-row-status">Друг</span>`;
      } else if (u.relation === 'outgoing') {
        btn = `<span class="friends-row-status">Заявка</span>`;
      } else if (u.relation === 'incoming') {
        btn = `<button type="button" class="friends-icon-btn accept" data-act="accept" data-id="${u.id}" title="Принять">✓</button>`;
      }
      return `
        <div class="friends-row" data-id="${u.id}" data-username="${escapeHtml(u.username)}">
          <div class="friends-row-avatar" style="${friendAvatarStyle(u)}">${friendAvatarText(u)}</div>
          <div class="friends-row-info">
            <div class="friends-row-name">${escapeHtml(u.username)}</div>
            <div class="friends-row-status">${u.is_online ? 'В сети' : 'Не в сети'}</div>
          </div>
          <div class="friends-row-actions">${btn}</div>
        </div>`;
    }).join('');
    box.classList.remove('hidden');

    $$('.friends-row', box).forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-act]')) return;
        openUserProfile(row.dataset.username, row.dataset.id);
      });
    });
    $$('[data-act]', box).forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const act = btn.dataset.act;
        const id = +btn.dataset.id;
        try {
          if (act === 'add') {
            const res = await postJSON(`${FRIENDS_API}?action=request`, { user_id: id });
            if (!res.ok) throw new Error(res.error || 'Ошибка');
            toast('Заявка отправлена');
            searchFriends($('#friends-search')?.value || '');
            loadFriendsList();
          } else if (act === 'accept') {
            const res = await postJSON(`${FRIENDS_API}?action=respond`, { user_id: id, accept: 1 });
            if (!res.ok) throw new Error(res.error || 'Ошибка');
            toast('Заявка принята');
            searchFriends($('#friends-search')?.value || '');
            loadFriendsList();
          }
        } catch (err) {
          toast(err.message || 'Ошибка');
        }
      });
    });
  } catch (err) {
    box.innerHTML = `<div class="friends-empty">${escapeHtml(err.message)}</div>`;
    box.classList.remove('hidden');
  }
}

function initFriendsUI() {
  $$('.menu-friends-btn').forEach(btn => {
    btn.addEventListener('click', () => openFriendsModal());
  });
  // also single querySelector fallback
  const close = $('#friends-close');
  if (close) close.addEventListener('click', closeFriendsModal);
  const backdrop = $('#friends-backdrop');
  if (backdrop) backdrop.addEventListener('click', closeFriendsModal);

  const search = $('#friends-search');
  if (search) {
    search.addEventListener('input', () => {
      clearTimeout(friendsSearchTimer);
      friendsSearchTimer = setTimeout(() => searchFriends(search.value.trim()), 250);
    });
  }

  const addBtn = $('#friends-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const s = $('#friends-search');
      if (s) { s.focus(); s.placeholder = 'Введите ник друга...'; }
    });
  }

  $$('.friends-section-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('open');
    });
  });
}

// ---------- Просмотр чужого профиля ----------
let viewingUserId = null;

async function openUserProfile(username, id) {
  closeFriendsModal();
  try {
    const q = id ? `id=${id}` : `username=${encodeURIComponent(username)}`;
    const data = await fetchJSON(`${FRIENDS_API}?action=profile&${q}`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const p = data.profile;

    // own profile → normal
    if (p.relation === 'self') {
      viewingUserId = null;
      gotoView('profile');
      return;
    }

    viewingUserId = p.id;
    // render into existing profile view in "foreign" mode
    showView('profile');
    renderForeignProfile(p, data.library || []);
  } catch (err) {
    toast(err.message || 'Не удалось открыть профиль');
  }
}

function renderForeignProfile(p, library) {
  // banner
  const bg = $('#hp-banner-bg');
  if (bg) {
    if (p.banner_url) {
      const zoom = parseFloat(p.banner_zoom) || 1;
      const size = zoom <= 1.01 ? 'cover' : (Math.round(zoom * 100) + '%');
      bg.style.backgroundImage = `url('${p.banner_url}')`;
      bg.style.backgroundPosition = p.banner_pos || '50% 50%';
      bg.style.backgroundSize = size;
      bg.classList.add('has-image');
    } else {
      bg.style.backgroundImage = '';
      bg.classList.remove('has-image');
    }
  }

  const av = $('#hp-avatar');
  if (av) {
    if (p.avatar_url) {
      av.style.backgroundImage = `url('${p.avatar_url}')`;
      av.style.backgroundSize = 'cover';
      av.style.backgroundPosition = 'center';
      av.textContent = '';
    } else {
      av.style.backgroundImage = '';
      av.style.background = p.avatar_color || '#ef5b2c';
      av.textContent = p.avatar || (p.username || '?').slice(0, 1).toUpperCase();
    }
  }
  const uname = $('#hp-username');
  if (uname) uname.textContent = p.username;

  // hide own-only controls
  const upload = $('#hp-banner-upload');
  if (upload) upload.style.display = 'none';
  const toolbar = $('.hp-toolbar');
  if (toolbar) {
    toolbar.innerHTML = `
      <div class="hp-toolbar-spacer"></div>
      <div class="hp-friend-actions" id="hp-friend-actions"></div>`;
    const box = $('#hp-friend-actions');
    if (box) {
      if (p.relation === 'none') {
        box.innerHTML = `<button type="button" class="hp-btn-edit" id="hp-add-friend">Добавить в друзья</button>`;
        $('#hp-add-friend')?.addEventListener('click', async () => {
          try {
            const res = await postJSON(`${FRIENDS_API}?action=request`, { user_id: p.id });
            if (!res.ok) throw new Error(res.error || 'Ошибка');
            toast('Заявка отправлена');
            openUserProfile(p.username, p.id);
          } catch (err) { toast(err.message); }
        });
      } else if (p.relation === 'outgoing') {
        box.innerHTML = `<button type="button" class="hp-btn-edit" id="hp-cancel-friend">Отменить заявку</button>`;
        $('#hp-cancel-friend')?.addEventListener('click', async () => {
          try {
            const res = await postJSON(`${FRIENDS_API}?action=remove`, { user_id: p.id });
            if (!res.ok) throw new Error(res.error || 'Ошибка');
            toast('Заявка отменена');
            openUserProfile(p.username, p.id);
          } catch (err) { toast(err.message); }
        });
      } else if (p.relation === 'incoming') {
        box.innerHTML = `
          <button type="button" class="hp-btn-edit" id="hp-accept-friend">Принять заявку</button>
          <button type="button" class="hp-btn-logout" id="hp-decline-friend">Отклонить</button>`;
        $('#hp-accept-friend')?.addEventListener('click', async () => {
          try {
            const res = await postJSON(`${FRIENDS_API}?action=respond`, { user_id: p.id, accept: 1 });
            if (!res.ok) throw new Error(res.error || 'Ошибка');
            toast('Теперь вы друзья');
            openUserProfile(p.username, p.id);
          } catch (err) { toast(err.message); }
        });
        $('#hp-decline-friend')?.addEventListener('click', async () => {
          try {
            const res = await postJSON(`${FRIENDS_API}?action=respond`, { user_id: p.id, accept: 0 });
            if (!res.ok) throw new Error(res.error || 'Ошибка');
            toast('Заявка отклонена');
            openUserProfile(p.username, p.id);
          } catch (err) { toast(err.message); }
        });
      } else if (p.relation === 'friends') {
        box.innerHTML = `
          <button type="button" class="hp-btn-edit" id="hp-msg-friend">Написать</button>
          <button type="button" class="hp-btn-edit" id="hp-remove-friend">Удалить из друзей</button>`;
        $('#hp-msg-friend')?.addEventListener('click', () => openChat(p.id, p.username));
        $('#hp-remove-friend')?.addEventListener('click', async () => {
          try {
            const res = await postJSON(`${FRIENDS_API}?action=remove`, { user_id: p.id });
            if (!res.ok) throw new Error(res.error || 'Ошибка');
            toast('Удалено из друзей');
            openUserProfile(p.username, p.id);
          } catch (err) { toast(err.message); }
        });
      }
    }
  }

  // stats
  const playEl = $('#hp-stat-playtime');
  if (playEl) {
    playEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${formatPlaytime(p.playtime_minutes || 0)}`;
  }
  const karmaEl = $('#hp-stat-karma');
  if (karmaEl) {
    karmaEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2z"/></svg> ${p.karma || 0} карма`;
  }

  // library without pin buttons
  profileLibraryCache = library;
  // temporary override render to hide pins for foreign
  const pinned = library.filter(g => +g.is_pinned);
  const rest = library.filter(g => !+g.is_pinned);
  const pinnedBox = $('#hp-pinned-games');
  const pinnedSection = $('#hp-pinned-section');
  const pinnedCount = $('#hp-pinned-count');
  if (pinnedBox) {
    if (!pinned.length) {
      if (pinnedSection) pinnedSection.style.display = 'none';
    } else {
      if (pinnedSection) pinnedSection.style.display = '';
      if (pinnedCount) pinnedCount.textContent = pinned.length;
      pinnedBox.innerHTML = pinned.map(g => gameCardHtml(g, { showPin: false })).join('');
    }
  }
  const libBox = $('#hp-library-games');
  const libCount = $('#hp-library-count');
  if (libCount) libCount.textContent = rest.length;
  if (libBox) {
    if (!rest.length && !pinned.length) {
      libBox.innerHTML = '<div class="hp-empty">Библиотека пуста</div>';
    } else {
      libBox.innerHTML = rest.map(g => gameCardHtml(g, { showPin: false })).join('');
    }
  }
  $$('.hp-game-card').forEach(card => {
    card.addEventListener('click', () => gotoGame(card.dataset.id));
  });

  const act = $('#hp-activity');
  if (act) act.innerHTML = '<div class="hp-empty" style="padding:12px 0">Скрыто</div>';
  loadProfileFriends(p.id);
}



// ============================================================
//  ЛИЧНЫЕ СООБЩЕНИЯ
// ============================================================
const MESSAGES_API = 'api/messages.php';
let chatPeerId = null;
let chatPollTimer = null;

function openChat(userId, username) {
  chatPeerId = +userId;
  const modal = $('#chat-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  closeFriendsModal();

  const nameEl = $('#chat-peer-name');
  if (nameEl) nameEl.textContent = username || 'Друг';
  const statusEl = $('#chat-peer-status');
  if (statusEl) statusEl.textContent = '…';
  const input = $('#chat-input');
  if (input) {
    input.value = '';
    input.placeholder = `Сообщение ${username || ''}`.trim();
    setTimeout(() => input.focus(), 50);
  }
  loadChatThread();
  if (chatPollTimer) clearInterval(chatPollTimer);
  chatPollTimer = setInterval(() => {
    if (chatPeerId && !$('#chat-modal')?.classList.contains('hidden')) {
      loadChatThread(true);
    }
  }, 4000);
}

function closeChat() {
  const modal = $('#chat-modal');
  if (modal) modal.classList.add('hidden');
  chatPeerId = null;
  if (chatPollTimer) {
    clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
}

async function loadChatThread(silent) {
  if (!chatPeerId) return;
  try {
    const data = await fetchJSON(`${MESSAGES_API}?action=thread&user_id=${chatPeerId}`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const peer = data.peer;
    const av = $('#chat-peer-avatar');
    if (av && peer) {
      av.style.cssText = friendAvatarStyle(peer);
      av.innerHTML = friendAvatarText(peer) + (peer.is_online ? '<span class="online-dot"></span>' : '');
    }
    const nameEl = $('#chat-peer-name');
    if (nameEl && peer) nameEl.textContent = peer.username;
    const statusEl = $('#chat-peer-status');
    if (statusEl && peer) statusEl.textContent = peer.is_online ? 'В сети' : 'Не в сети';
    const hint = $('#chat-offline-hint');
    if (hint) hint.classList.toggle('hidden', !!(peer && peer.is_online));

    renderChatMessages(data.messages || []);
  } catch (err) {
    if (!silent) toast(err.message || 'Не удалось загрузить переписку');
  }
}

function renderChatMessages(messages) {
  const box = $('#chat-messages');
  if (!box) return;
  const empty = $('#chat-empty');
  if (!messages.length) {
    box.innerHTML = `
      <div class="chat-empty" id="chat-empty">
        <div class="chat-empty-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
        <div class="chat-empty-title">Пока нет сообщений</div>
        <div class="chat-empty-sub">Напишите первыми</div>
      </div>`;
    return;
  }
  const wasBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = messages.map(m => {
    const time = formatDateTime(m.created_at);
    const cls = m.mine ? 'mine' : 'theirs';
    let inner = '';
    if (m.body && m.body.startsWith('[image]')) {
      const url = m.body.slice(7);
      inner = `<img class="chat-msg-image" src="${escapeHtml(url)}" alt="" loading="lazy" /><span class="chat-bubble-time">${escapeHtml(time)}</span>`;
      return `<div class="chat-bubble special ${cls}">${inner}</div>`;
    }
    if (m.body && m.body.startsWith('[game:')) {
      const mid = m.body.match(/^\[game:(\d+)\](.*)$/);
      const gid = mid ? mid[1] : '';
      const title = mid ? mid[2] : 'Игра';
      inner = `<div class="chat-msg-game" data-game-id="${gid}">
        <img src="media.php?type=cover&id=${gid}" alt="" />
        <div><div class="chat-msg-game-title">${escapeHtml(title)}</div><div class="chat-msg-game-sub">Игра из библиотеки</div></div>
      </div><span class="chat-bubble-time" style="padding:0 10px 8px;display:block">${escapeHtml(time)}</span>`;
      return `<div class="chat-bubble special ${cls}">${inner}</div>`;
    }
    return `<div class="chat-bubble ${cls}">${escapeHtml(m.body)}<span class="chat-bubble-time">${escapeHtml(time)}</span></div>`;
  }).join('');
  $$('.chat-msg-game', box).forEach(el => {
    el.addEventListener('click', () => { if (el.dataset.gameId) gotoGame(el.dataset.gameId); });
  });
  if (wasBottom || !silentRenderGuard) {
    box.scrollTop = box.scrollHeight;
  }
}
let silentRenderGuard = false;

async function sendChatMessage() {
  const input = $('#chat-input');
  if (!input || !chatPeerId) return;
  const body = input.value.trim();
  if (!body) return;
  const btn = $('#chat-send');
  if (btn) btn.disabled = true;
  try {
    const res = await postJSON(`${MESSAGES_API}?action=send`, {
      user_id: chatPeerId,
      body,
    });
    if (!res.ok) throw new Error(res.error || 'Ошибка');
    input.value = '';
    // append optimistically
    const box = $('#chat-messages');
    if (box) {
      const empty = box.querySelector('.chat-empty');
      if (empty) box.innerHTML = '';
      const m = res.message;
      const div = document.createElement('div');
      div.className = 'chat-bubble mine';
      div.innerHTML = `${escapeHtml(m.body)}<span class="chat-bubble-time">${escapeHtml(formatDateTime(m.created_at))}</span>`;
      box.appendChild(div);
      box.scrollTop = box.scrollHeight;
    }
  } catch (err) {
    toast(err.message || 'Не удалось отправить');
  } finally {
    if (btn) btn.disabled = false;
    input.focus();
  }
}

function initChatUI() {
  const close = $('#chat-close');
  if (close) close.addEventListener('click', closeChat);
  const backdrop = $('#chat-backdrop');
  if (backdrop) backdrop.addEventListener('click', closeChat);
  const send = $('#chat-send');
  if (send) send.addEventListener('click', sendChatMessage);
  const input = $('#chat-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }
}


// ============================================================
//  УВЕДОМЛЕНИЯ + РАСШИРЕННЫЙ ЧАТ
// ============================================================
const NOTIF_API = 'api/notifications.php';
const EMOJI_LIST = '😀😁😂🤣😊😍🤩😘😜🤔😴😎🥳😇🫠🙃😉😌😭😡👍👎❤️🔥✨🎉🎮🏆⚡💯👀🙏'.split(/\\u200d/).join('').match(/./gu) || ['😀','😂','😍','👍','❤️','🔥','🎮','🎉'];

let notifFilter = 'all';
let badgeTimer = null;

async function refreshBadge() {
  try {
    const data = await fetchJSON(`${NOTIF_API}?action=badge`);
    if (!data.ok) return;
    const total = data.total || 0;
    $$('.friends-menu-badge').forEach(el => {
      if (total > 0) {
        el.textContent = total > 99 ? '99+' : String(total);
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    });
    const tabBadge = $('#notif-tab-badge');
    if (tabBadge) {
      const n = (data.notifications || 0) + (data.requests || 0);
      if (n > 0) {
        tabBadge.textContent = String(n);
        tabBadge.classList.remove('hidden');
      } else {
        tabBadge.classList.add('hidden');
      }
    }
  } catch (e) {}
}

async function loadNotifications() {
  const list = $('#notif-list');
  if (!list) return;
  try {
    const q = notifFilter === 'unread' ? '&unread=1' : '';
    const data = await fetchJSON(`${NOTIF_API}?action=list${q}`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const items = data.notifications || [];
    if (!items.length) {
      list.innerHTML = `
        <div class="chat-empty" style="padding:40px 10px">
          <div class="chat-empty-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div>
          <div class="chat-empty-title">Нет уведомлений</div>
          <div class="chat-empty-sub">Вы в курсе всех событий</div>
        </div>`;
      return;
    }
    const iconMap = {
      friend_request: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>',
      friend_accepted: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>',
      message: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    };
    const defaultIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
    list.innerHTML = items.map(n => `
      <div class="notif-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-type="${escapeHtml(n.type)}"
           data-from="${n.meta && n.meta.from_id ? n.meta.from_id : ''}"
           data-username="${n.meta && n.meta.from_username ? escapeHtml(n.meta.from_username) : ''}">
        <div class="notif-item-icon">${iconMap[n.type] || defaultIcon}</div>
        <div class="notif-item-body">
          <div class="notif-item-title">${escapeHtml(n.title)}</div>
          <div class="notif-item-text">${escapeHtml(n.body)}</div>
          <div class="notif-item-time">${escapeHtml(formatDateTime(n.created_at))}</div>
        </div>
      </div>`).join('');

    $$('.notif-item', list).forEach(item => {
      item.addEventListener('click', async () => {
        try {
          await postJSON(`${NOTIF_API}?action=read`, { id: +item.dataset.id });
        } catch (e) {}
        const type = item.dataset.type;
        const from = item.dataset.from;
        const uname = item.dataset.username;
        if (type === 'message' && from) {
          openChat(+from, uname);
        } else if ((type === 'friend_request' || type === 'friend_accepted') && uname) {
          openUserProfile(uname, from);
        }
        refreshBadge();
        if (notifFilter === 'unread') loadNotifications();
        else item.classList.remove('unread');
      });
    });
  } catch (err) {
    list.innerHTML = `<div class="friends-empty">${escapeHtml(err.message)}</div>`;
  }
}

function initNotificationsUI() {
  $$('.friends-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.friends-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.ftab;
      const fp = $('#friends-pane-friends');
      const np = $('#friends-pane-notifications');
      if (fp) fp.classList.toggle('hidden', name !== 'friends');
      if (np) np.classList.toggle('hidden', name !== 'notifications');
      if (name === 'notifications') loadNotifications();
    });
  });

  $$('.notif-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.notif-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      notifFilter = btn.dataset.nfilter || 'all';
      loadNotifications();
    });
  });

  const readAll = $('#notif-read-all');
  if (readAll) readAll.addEventListener('click', async () => {
    try {
      await postJSON(`${NOTIF_API}?action=read`, { all: 1 });
      loadNotifications();
      refreshBadge();
      toast('Все прочитаны');
    } catch (e) { toast(e.message); }
  });

  const clearAll = $('#notif-clear-all');
  if (clearAll) clearAll.addEventListener('click', async () => {
    try {
      await postJSON(`${NOTIF_API}?action=clear`, {});
      loadNotifications();
      refreshBadge();
      toast('Уведомления очищены');
    } catch (e) { toast(e.message); }
  });

  refreshBadge();
  if (badgeTimer) clearInterval(badgeTimer);
  badgeTimer = setInterval(refreshBadge, 15000);
}

function initChatExtras() {
  // emoji panel
  const emojiPanel = $('#chat-emoji-panel');
  const emojiBtn = $('#chat-emoji');
  if (emojiPanel && !emojiPanel.dataset.ready) {
    emojiPanel.dataset.ready = '1';
    const emojis = ['😀','😁','😂','🤣','😊','😍','🤩','😘','😜','🤔','😴','😎','🥳','😇','🫠','😉','😭','😡','👍','👎','❤️','🔥','✨','🎉','🎮','🏆','⚡','💯','👀','🙏','💀','🤝','💬','🚀','🐱','🐉'];
    emojiPanel.innerHTML = emojis.map(e => `<button type="button" data-emoji="${e}">${e}</button>`).join('');
    $$('button', emojiPanel).forEach(b => {
      b.addEventListener('click', () => {
        const input = $('#chat-input');
        if (!input) return;
        input.value += b.dataset.emoji;
        input.focus();
      });
    });
  }
  if (emojiBtn) {
    emojiBtn.addEventListener('click', () => {
      emojiPanel?.classList.toggle('hidden');
      $('#chat-plus-menu')?.classList.add('hidden');
      $('#chat-game-picker')?.classList.add('hidden');
    });
  }

  // plus menu
  const plusBtn = $('#chat-plus');
  const plusMenu = $('#chat-plus-menu');
  if (plusBtn && plusMenu) {
    plusBtn.addEventListener('click', () => {
      plusMenu.classList.toggle('hidden');
      emojiPanel?.classList.add('hidden');
      $('#chat-game-picker')?.classList.add('hidden');
    });
    $$('[data-plus]', plusMenu).forEach(btn => {
      btn.addEventListener('click', () => {
        plusMenu.classList.add('hidden');
        const act = btn.dataset.plus;
        if (act === 'image') $('#chat-file')?.click();
        if (act === 'draw') openDrawCanvas();
        if (act === 'game') openGamePicker();
      });
    });
  }

  const fileInput = $('#chat-file');
  if (fileInput) {
    fileInput.addEventListener('change', async () => {
      if (!fileInput.files?.[0] || !chatPeerId) return;
      const fd = new FormData();
      fd.append('file', fileInput.files[0]);
      fd.append('user_id', String(chatPeerId));
      fd.append('csrf_token', window.CSRF_TOKEN || '');
      try {
        const res = await fetch(`${MESSAGES_API}?action=upload`, { method: 'POST', body: fd });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Ошибка');
        loadChatThread();
        toast('Изображение отправлено');
      } catch (err) {
        toast(err.message || 'Не удалось отправить');
      }
      fileInput.value = '';
    });
  }

  // peer click → profile
  const peer = $('#chat-peer');
  if (peer) {
    peer.addEventListener('click', () => {
      const name = $('#chat-peer-name')?.textContent;
      if (name && chatPeerId) {
        closeChat();
        openUserProfile(name, chatPeerId);
      }
    });
  }

  initDrawCanvas();
}

function openDrawCanvas() {
  const ov = $('#chat-draw-overlay');
  if (!ov) return;
  ov.classList.remove('hidden');
  const canvas = $('#chat-draw-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0e0d0b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function initDrawCanvas() {
  const canvas = $('#chat-draw-canvas');
  if (!canvas || canvas.dataset.ready) return;
  canvas.dataset.ready = '1';
  const ctx = canvas.getContext('2d');
  let drawing = false;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const pt = e.touches ? e.touches[0] : e;
    return {
      x: (pt.clientX - r.left) * (canvas.width / r.width),
      y: (pt.clientY - r.top) * (canvas.height / r.height),
    };
  };
  const start = (e) => { drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); };
  const move = (e) => {
    if (!drawing) return;
    const p = pos(e);
    ctx.strokeStyle = $('#chat-draw-color')?.value || '#ef5b2c';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    e.preventDefault();
  };
  const end = () => { drawing = false; };
  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('touchend', end);

  $('#chat-draw-close')?.addEventListener('click', () => $('#chat-draw-overlay')?.classList.add('hidden'));
  $('#chat-draw-clear')?.addEventListener('click', () => {
    ctx.fillStyle = '#0e0d0b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  });
  $('#chat-draw-send')?.addEventListener('click', async () => {
    if (!chatPeerId) return;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const fd = new FormData();
      fd.append('file', blob, 'drawing.png');
      fd.append('user_id', String(chatPeerId));
      fd.append('csrf_token', window.CSRF_TOKEN || '');
      try {
        const res = await fetch(`${MESSAGES_API}?action=upload`, { method: 'POST', body: fd });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Ошибка');
        $('#chat-draw-overlay')?.classList.add('hidden');
        loadChatThread();
        toast('Рисунок отправлен');
      } catch (err) {
        toast(err.message || 'Не удалось отправить');
      }
    }, 'image/png');
  });
}

async function openGamePicker() {
  const picker = $('#chat-game-picker');
  const list = $('#chat-game-picker-list');
  if (!picker || !list) return;
  picker.classList.remove('hidden');
  list.innerHTML = '<div class="friends-empty">Загрузка...</div>';
  try {
    const data = await fetchJSON(`${API_BASE}?action=library`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const games = data.library || [];
    if (!games.length) {
      list.innerHTML = '<div class="friends-empty">Библиотека пуста</div>';
      return;
    }
    list.innerHTML = games.map(g => `
      <button type="button" class="chat-game-pick-item" data-id="${g.id}" data-title="${escapeHtml(g.title)}">
        <img src="media.php?type=cover&id=${g.id}" alt="" />
        <span>${escapeHtml(g.title)}</span>
      </button>`).join('');
    $$('.chat-game-pick-item', list).forEach(btn => {
      btn.addEventListener('click', async () => {
        picker.classList.add('hidden');
        if (!chatPeerId) return;
        try {
          const body = `[game:${btn.dataset.id}]${btn.dataset.title}`;
          const res = await postJSON(`${MESSAGES_API}?action=send`, { user_id: chatPeerId, body });
          if (!res.ok) throw new Error(res.error || 'Ошибка');
          loadChatThread();
        } catch (err) {
          toast(err.message || 'Не удалось отправить');
        }
      });
    });
  } catch (err) {
    list.innerHTML = `<div class="friends-empty">${escapeHtml(err.message)}</div>`;
  }
}


// ============================================================
//  ЗАГРУЗКА ИГР + АДМИН-МОДЕРАЦИЯ
// ============================================================
const STEAM_API = 'api/steam_import.php';
const SUBMIT_API = 'api/submit.php';

const SYSREQ_LABELS = {
  os: 'ОС',
  cpu: 'Процессор',
  ram: 'Оперативная память',
  gpu: 'Видеокарта',
  directx: 'DirectX',
  storage: 'Место на диске',
  sound: 'Звуковая карта',
  other: 'Дополнительно',
};
const GAME_LANGS = [
  'русский','английский','японский','китайский (упр.)','китайский (трад.)',
  'корейский','французский','итальянский','немецкий','испанский — Испания',
  'испанский — Латам','португальский','португальский — Бразилия','польский',
  'турецкий','украинский','вьетнамский','арабский','тайский','индонезийский',
];

function collectSysReq(containerId) {
  const box = $(containerId);
  if (!box) return {};
  const out = {};
  $$('input[data-k]', box).forEach(inp => {
    const v = inp.value.trim();
    if (v) out[inp.dataset.k] = v;
  });
  return out;
}
function fillSysReq(containerId, data) {
  const box = $(containerId);
  if (!box) return;
  let obj = data;
  if (typeof data === 'string') {
    try { obj = JSON.parse(data); } catch (e) { obj = {}; }
  }
  obj = obj || {};
  $$('input[data-k]', box).forEach(inp => {
    inp.value = obj[inp.dataset.k] || '';
  });
}
function renderLangTable(containerId, selected) {
  const box = $(containerId);
  if (!box) return;
  let sel = selected;
  if (typeof selected === 'string') {
    try { sel = JSON.parse(selected); } catch (e) { sel = []; }
  }
  if (!Array.isArray(sel)) sel = [];
  const map = {};
  sel.forEach(r => { map[r.name] = r; });
  const head = box.querySelector('.lang-table-head');
  box.innerHTML = '';
  if (head) box.appendChild(head);
  else box.insertAdjacentHTML('afterbegin', '<div class="lang-table-head"><span>Язык</span><span>Субтитры</span><span>Аудио</span></div>');
  GAME_LANGS.forEach(name => {
    const r = map[name] || {};
    const row = document.createElement('div');
    row.className = 'lang-table-row';
    row.innerHTML = `
      <span>${escapeHtml(name)}</span>
      <label style="text-align:center"><input type="checkbox" data-lang="${escapeHtml(name)}" data-kind="sub" ${r.subtitles ? 'checked' : ''} /></label>
      <label style="text-align:center"><input type="checkbox" data-lang="${escapeHtml(name)}" data-kind="audio" ${r.audio ? 'checked' : ''} /></label>`;
    box.appendChild(row);
  });
}
function collectLanguages(containerId) {
  const box = $(containerId);
  if (!box) return [];
  const map = {};
  $$('input[data-lang]', box).forEach(inp => {
    const name = inp.dataset.lang;
    if (!map[name]) map[name] = { name, subtitles: false, audio: false };
    if (inp.dataset.kind === 'sub') map[name].subtitles = inp.checked;
    if (inp.dataset.kind === 'audio') map[name].audio = inp.checked;
  });
  return Object.values(map).filter(r => r.subtitles || r.audio);
}
function parseSysReq(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw) || {}; } catch (e) {
    // legacy plain text → other
    return raw.trim() ? { other: String(raw) } : {};
  }
}
function parseLangs(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j)) return j;
  } catch (e) {}
  // legacy comma list
  return String(raw).split(',').map(s => s.trim()).filter(Boolean).map(name => ({ name, subtitles: true, audio: false }));
}
function renderSysReqBlock(minRaw, recRaw) {
  const min = parseSysReq(minRaw);
  const rec = parseSysReq(recRaw);
  if (!Object.keys(min).length && !Object.keys(rec).length) return '';
  const listHtml = (obj, title) => {
    const items = Object.keys(SYSREQ_LABELS).filter(k => obj[k]).map(k =>
      `<li><b>${SYSREQ_LABELS[k]}:</b> ${escapeHtml(obj[k])}</li>`
    ).join('');
    if (!items) return `<p class="gp-ach-empty">Нет данных</p>`;
    return `<ul class="sysreq-list">${items}</ul>`;
  };
  return `
    <div class="gp-side-card" id="game-sysreq">
      <button type="button" class="gp-side-head">Системные требования <span class="chev">▾</span></button>
      <div class="gp-side-body">
        <div class="sysreq-tabs">
          <button type="button" class="sysreq-tab active" data-tab="min">Минимальные</button>
          <button type="button" class="sysreq-tab" data-tab="rec">Рекомендованные</button>
        </div>
        <div class="sysreq-pane" data-pane="min">${listHtml(min, 'Минимальные:')}</div>
        <div class="sysreq-pane hidden" data-pane="rec">${listHtml(rec, 'Рекомендованные:')}</div>
      </div>
    </div>`;
}
function renderLangBlock(raw) {
  const langs = parseLangs(raw);
  if (!langs.length) return '';
  const rows = langs.map(r => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td class="${r.subtitles ? 'ok' : 'no'}">${r.subtitles ? '✓' : '✕'}</td>
      <td class="${r.audio ? 'ok' : 'no'}">${r.audio ? '✓' : '✕'}</td>
    </tr>`).join('');
  return `
    <div class="gp-side-card" id="game-langs">
      <button type="button" class="gp-side-head">Язык <span class="chev">▾</span></button>
      <div class="gp-side-body">
        <table class="lang-display">
          <thead><tr><th>Язык</th><th>Субтитры</th><th>Аудио</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}
function initGameCollapsibles(wrap) {
  $$('.game-collapsible-head', wrap).forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.game-collapsible')?.classList.toggle('collapsed'));
  });
  $$('.sysreq-tab', wrap).forEach(tab => {
    tab.addEventListener('click', () => {
      const body = tab.closest('.gp-side-body') || tab.closest('.game-collapsible-body');
      if (!body) return;
      $$('.sysreq-tab', body).forEach(t => t.classList.toggle('active', t === tab));
      $$('.sysreq-pane', body).forEach(p => p.classList.toggle('hidden', p.dataset.pane !== tab.dataset.tab));
    });
  });
}


let adminDeleteMedia = [];

function initSubmitGame() {
  // Делегирование: работает даже если кнопку перерисуют и если другие init упали раньше
  if (!window.__submitGameDelegated) {
    window.__submitGameDelegated = true;
    document.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('#btn-add-game');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        openSubmitRules();
      }
    });
  }

  const agree = $('#submit-agree');
  const next = $('#submit-rules-next');
  if (agree && next && !next.dataset.bound) {
    next.dataset.bound = '1';
    agree.addEventListener('change', () => { next.disabled = !agree.checked; });
    next.addEventListener('click', () => {
      $('#submit-rules-modal')?.classList.add('hidden');
      const formModal = $('#submit-form-modal');
      if (formModal) {
        try { renderLangTable('#sg-lang-table', []); } catch (err) { console.warn(err); }
        formModal.classList.remove('hidden');
      }
    });
  }

  $$('[data-close]').forEach(el => {
    if (el.dataset.closeBound) return;
    el.dataset.closeBound = '1';
    el.addEventListener('click', () => {
      const k = el.dataset.close;
      if (k === 'rules') $('#submit-rules-modal')?.classList.add('hidden');
      if (k === 'form') $('#submit-form-modal')?.classList.add('hidden');
      if (k === 'done') $('#submit-done-modal')?.classList.add('hidden');
    });
  });

  const send = $('#submit-game-send');
  if (send && !send.dataset.bound) {
    send.dataset.bound = '1';
    send.addEventListener('click', submitGameForm);
  }
}

function openSubmitRules() {
  const modal = document.getElementById('submit-rules-modal');
  if (!modal) {
    console.error('submit-rules-modal не найден в HTML. Обнови index.php');
    alert('Модалка добавления игры не найдена. Нужен актуальный index.php');
    return;
  }
  const agree = document.getElementById('submit-agree');
  if (agree) agree.checked = false;
  const next = document.getElementById('submit-rules-next');
  if (next) next.disabled = true;
  modal.classList.remove('hidden');
  // язык-таблицу готовим заранее, но ошибка не должна блокировать окно
  try { renderLangTable('#sg-lang-table', []); } catch (err) { console.warn(err); }
}

// Глобальный хук на случай inline onclick
window.openSubmitRules = openSubmitRules;

async function submitGameForm() {
  const btn = $('#submit-game-send');
  if (btn) { btn.disabled = true; btn.textContent = 'Отправка...'; }
  try {
    const fd = new FormData();
    fd.append('csrf_token', window.CSRF_TOKEN || '');
    fd.append('title', $('#sg-title')?.value?.trim() || '');
    fd.append('genre', $('#sg-genre')?.value || '');
    fd.append('price', $('#sg-price')?.value || '0');
    fd.append('short_description', $('#sg-short')?.value || '');
    fd.append('description', $('#sg-desc')?.value || '');
    fd.append('video_url', $('#sg-video')?.value || '');
    fd.append('sys_req_min', JSON.stringify(collectSysReq('#sg-sys-min-fields')));
    fd.append('sys_req_rec', JSON.stringify(collectSysReq('#sg-sys-rec-fields')));
    fd.append('languages', JSON.stringify(collectLanguages('#sg-lang-table')));
    const ctrls = $$('.sg-ctrl').filter(c => c.checked).map(c => c.value).join(',');
    fd.append('controllers', ctrls);
    const cover = $('#sg-cover')?.files?.[0];
    if (cover) fd.append('cover', cover);
    const banner = $('#sg-banner')?.files?.[0];
    if (banner) fd.append('banner', banner);
    const shots = $('#sg-shots')?.files;
    if (shots) for (let i = 0; i < shots.length; i++) fd.append('screenshots[]', shots[i]);

    const res = await fetch(`${SUBMIT_API}?action=submit`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    $('#submit-form-modal')?.classList.add('hidden');
    $('#submit-game-form')?.reset();
    $('#submit-done-modal')?.classList.remove('hidden');
  } catch (err) {
    toast(err.message || 'Не удалось отправить');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Отправить на модерацию'; }
  }
}


function initAdminUI() {
  const view = $('#view-admin');
  if (!view || view.dataset.boundAdmin === '1') return;
  view.dataset.boundAdmin = '1';

  $$('.settings-nav-btn[data-atab]', view).forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.atab;
      $$('.settings-nav-btn[data-atab]', view).forEach(b => b.classList.toggle('active', b === btn));
      $$('.settings-pane', view).forEach(p => {
        p.classList.toggle('hidden', p.id !== 'admin-pane-' + tab);
      });
      if (tab === 'moderation') loadAdminPending();
    });
  });

  const showErr = (msg) => {
    const el = $('#steam-import-error');
    if (!el) return;
    if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.textContent = msg;
    el.classList.remove('hidden');
  };

  $('#steam-preview-btn')?.addEventListener('click', async () => {
    const url = ($('#steam-url')?.value || '').trim();
    showErr('');
    $('#steam-preview')?.classList.add('hidden');
    if (!url) { showErr('Вставь ссылку или AppID'); return; }
    const btn = $('#steam-preview-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Загрузка...'; }
    try {
      const data = await fetchJSON(`${STEAM_API}?action=preview&url=${encodeURIComponent(url)}`, { timeout: FETCH_TIMEOUT_LONG });
      if (!data.ok) throw new Error(data.error || 'Ошибка');
      const p = data.preview || {};
      const banner = $('#steam-preview-banner');
      const cover = $('#steam-preview-cover');
      if (banner) banner.src = p.header_image || p.background || '';
      if (cover) cover.src = p.capsule_image || p.header_image || '';
      const title = $('#steam-preview-title');
      if (title) title.textContent = p.title || '';
      const meta = $('#steam-preview-meta');
      if (meta) meta.textContent = [p.developer, p.genre, p.release_date, p.is_free ? 'Бесплатно' : ''].filter(Boolean).join(' · ');
      const short = $('#steam-preview-short');
      if (short) short.textContent = p.short_description || '';
      const shots = $('#steam-preview-shots');
      if (shots) {
        shots.innerHTML = (p.screenshots || []).slice(0, 8).map(src =>
          `<img src="${escapeHtml(src)}" alt="" loading="lazy" />`
        ).join('');
      }
      $('#steam-preview')?.classList.remove('hidden');
      toast('Данные Steam получены');
    } catch (e) {
      showErr(e.message || 'Не удалось получить данные');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Проверить'; }
    }
  });

  $('#steam-import-btn')?.addEventListener('click', async () => {
    const url = ($('#steam-url')?.value || '').trim();
    showErr('');
    if (!url) { showErr('Вставь ссылку или AppID'); return; }
    const btn = $('#steam-import-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Импорт...'; }
    try {
      const data = await postJSON(`${STEAM_API}?action=import`, {
        url,
        publish: $('#steam-publish')?.checked ? 1 : 0,
      }, FETCH_TIMEOUT_LONG);
      if (!data.ok) throw new Error(data.error || 'Ошибка импорта');
      const vidInfo = data.videos ? `, видео: ${data.videos}` : '';
      toast(`Импортировано: ${data.title} (id ${data.game_id}${vidInfo})`);
      homeCache = null;
      storeCache = [];
      if (data.status === 'published' && typeof gotoGame === 'function') {
        gotoGame(data.game_id);
      } else {
        $$('.settings-nav-btn[data-atab]', view).forEach(b => b.classList.toggle('active', b.dataset.atab === 'moderation'));
        $$('.settings-pane', view).forEach(p => p.classList.toggle('hidden', p.id !== 'admin-pane-moderation'));
        loadAdminPending();
      }
    } catch (e) {
      showErr(e.message || 'Ошибка импорта');
      toast(e.message || 'Ошибка импорта');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Импортировать в CATio'; }
    }
  });
}

async function loadAdminPending() {
  try { initAdminUI(); } catch (e) {}

  const list = $('#admin-pending-list');
  if (!list) return;
  list.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const data = await fetchJSON(`${SUBMIT_API}?action=pending`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const games = data.games || [];
    if (!games.length) {
      list.innerHTML = '<div class="friends-empty">Нет игр на модерации</div>';
      return;
    }
    list.innerHTML = games.map(g => `
      <button type="button" class="admin-pending-item" data-id="${g.id}">
        <img src="${escapeHtml(g.cover_url || '')}" alt="" onerror="this.style.display=\'none\'" />
        <div>
          <div class="t">${escapeHtml(g.title)}</div>
          <div class="s">${escapeHtml(g.submitter || '—')} · ${escapeHtml(g.genre || '')}</div>
        </div>
      </button>`).join('');
    $$('.admin-pending-item', list).forEach(btn => {
      btn.addEventListener('click', () => openAdminGame(+btn.dataset.id));
    });
  } catch (err) {
    list.innerHTML = `<div class="friends-empty">${escapeHtml(err.message || 'Ошибка')}<br><button type="button" class="btn-retry" id="admin-retry">Повторить</button></div>`;
    $('#admin-retry')?.addEventListener('click', loadAdminPending);
  }
}

async function openAdminGame(id) {
  adminDeleteMedia = [];
  try {
    const data = await fetchJSON(`${SUBMIT_API}?action=get&id=${id}`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const g = data.game;
    $('#admin-empty')?.classList.add('hidden');
    const form = $('#admin-game-form');
    form?.classList.remove('hidden');
    $('#admin-game-id').value = g.id;
    $('#admin-title').value = g.title || '';
    $('#admin-genre').value = g.genre || '';
    $('#admin-price').value = g.price || 0;
    $('#admin-short').value = g.short_description || '';
    $('#admin-desc').value = g.description || '';
    fillSysReq('#admin-sys-min-fields', g.sys_req_min);
    fillSysReq('#admin-sys-rec-fields', g.sys_req_rec);
    $('#admin-controllers').value = g.controllers || '';
    renderLangTable('#admin-lang-table', g.languages);
    $('#admin-video').value = g.video_url || '';
    $('#admin-note').value = g.review_note || '';
    const media = $('#admin-media-list');
    if (media) {
      media.innerHTML = (g.media || []).map(m => `
        <div class="admin-media-thumb" data-mid="${m.id}">
          <img src="${escapeHtml(m.url)}" alt="" />
          <button type="button" title="Удалить" data-del="${m.id}">×</button>
        </div>`).join('');
      $$('[data-del]', media).forEach(b => {
        b.addEventListener('click', () => {
          adminDeleteMedia.push(+b.dataset.del);
          b.closest('.admin-media-thumb')?.remove();
        });
      });
    }
    $$('.admin-pending-item').forEach(el => el.classList.toggle('active', +el.dataset.id === id));
  } catch (err) {
    toast(err.message);
  }
}

function initAdminPanel() {
  if (!$('#view-admin')) return;
  try { initAdminUI(); } catch (e) {}
  // load when opening admin view - hook showView
  $('#admin-save')?.addEventListener('click', async () => {
    const id = $('#admin-game-id')?.value;
    if (!id) return;
    const fd = new FormData();
    fd.append('csrf_token', window.CSRF_TOKEN || '');
    fd.append('id', id);
    fd.append('title', $('#admin-title')?.value || '');
    fd.append('genre', $('#admin-genre')?.value || '');
    fd.append('price', $('#admin-price')?.value || '0');
    fd.append('short_description', $('#admin-short')?.value || '');
    fd.append('description', $('#admin-desc')?.value || '');
    fd.append('sys_req_min', JSON.stringify(collectSysReq('#admin-sys-min-fields')));
    fd.append('sys_req_rec', JSON.stringify(collectSysReq('#admin-sys-rec-fields')));
    fd.append('controllers', $('#admin-controllers')?.value || '');
    fd.append('languages', JSON.stringify(collectLanguages('#admin-lang-table')));
    fd.append('video_url', $('#admin-video')?.value || '');
    fd.append('review_note', $('#admin-note')?.value || '');
    fd.append('delete_media', adminDeleteMedia.join(','));
    const cover = $('#admin-cover')?.files?.[0];
    if (cover) fd.append('cover', cover);
    const banner = $('#admin-banner')?.files?.[0];
    if (banner) fd.append('banner', banner);
    const shots = $('#admin-shots')?.files;
    if (shots) for (let i = 0; i < shots.length; i++) fd.append('screenshots[]', shots[i]);
    try {
      const res = await fetch(`${SUBMIT_API}?action=admin_save`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Ошибка');
      toast('Сохранено');
      openAdminGame(+id);
    } catch (err) { toast(err.message); }
  });

  $('#admin-publish')?.addEventListener('click', async () => {
    const id = +($('#admin-game-id')?.value || 0);
    if (!id) return;
    const btn = $('#admin-publish');
    if (btn) btn.disabled = true;
    try {
      // Сначала сохраняем текущие поля формы
      const fd = new FormData();
      fd.append('csrf_token', window.CSRF_TOKEN || '');
      fd.append('id', id);
      fd.append('title', $('#admin-title')?.value || '');
      fd.append('genre', $('#admin-genre')?.value || '');
      fd.append('price', $('#admin-price')?.value || '0');
      fd.append('short_description', $('#admin-short')?.value || '');
      fd.append('description', $('#admin-desc')?.value || '');
      fd.append('video_url', $('#admin-video')?.value || '');
      fd.append('sys_req_min', $('#admin-sys-min')?.value || '');
      fd.append('sys_req_rec', $('#admin-sys-rec')?.value || '');
      fd.append('controllers', $('#admin-controllers')?.value || '');
      fd.append('languages', $('#admin-languages')?.value || '');
      fd.append('review_note', $('#admin-note')?.value || '');
      fd.append('delete_media', '');
      const cover = $('#admin-cover')?.files?.[0];
      if (cover) fd.append('cover', cover);
      const banner = $('#admin-banner')?.files?.[0];
      if (banner) fd.append('banner', banner);
      const shots = $('#admin-shots')?.files;
      if (shots) for (let i = 0; i < shots.length; i++) fd.append('screenshots[]', shots[i]);

      const saveRes = await fetch(`${SUBMIT_API}?action=admin_save`, { method: 'POST', body: fd });
      const saveData = await saveRes.json();
      if (!saveData.ok) throw new Error(saveData.error || 'Ошибка сохранения перед публикацией');

      const res = await postJSON(`${SUBMIT_API}?action=publish`, { id }, FETCH_TIMEOUT_LONG);
      if (!res.ok) throw new Error(res.error || 'Ошибка публикации');
      toast('Игра опубликована');
      homeCache = null;
      storeCache = [];
      $('#admin-game-form')?.classList.add('hidden');
      $('#admin-empty')?.classList.remove('hidden');
      loadAdminPending();
    } catch (err) { toast(err.message); }
    finally { if (btn) btn.disabled = false; }
  });

  $('#admin-reject')?.addEventListener('click', async () => {
    const id = +($('#admin-game-id')?.value || 0);
    if (!id) return;
    try {
      const res = await postJSON(`${SUBMIT_API}?action=reject`, {
        id,
        note: $('#admin-note')?.value || '',
      }, FETCH_TIMEOUT_LONG);
      if (!res.ok) throw new Error(res.error || 'Ошибка');
      toast('Отклонено');
      $('#admin-game-form')?.classList.add('hidden');
      $('#admin-empty')?.classList.remove('hidden');
      loadAdminPending();
    } catch (err) { toast(err.message); }
  });
}

// ---------- Галерея: видео (трейлеры) + скриншоты ----------
function setGalleryMain(wrap, type, src, thumb) {
  const box = $('#gallery-main', wrap) || $('.gp-gallery-main', wrap);
  if (!box) return;
  // остановить предыдущее видео
  const oldVid = $('#gallery-main-video', wrap);
  if (oldVid) {
    try { oldVid.pause(); } catch (e) {}
  }
  if (type === 'video') {
    box.innerHTML = `<video id="gallery-main-video" src="${escapeHtml(src)}" controls playsinline preload="metadata" poster="${escapeHtml(thumb || '')}"></video>`;
    const v = $('#gallery-main-video', wrap);
    if (v) {
      v.play().catch(() => {});
    }
  } else {
    box.innerHTML = `<img id="gallery-main-img" src="${escapeHtml(src)}" alt="" />`;
    const img = $('#gallery-main-img', wrap);
    if (img) {
      img.addEventListener('click', () => openLightbox(src));
    }
  }
}

function initGallery(wrap) {
  $$('.gp-thumb', wrap).forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.gp-thumb', wrap).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setGalleryMain(wrap, btn.dataset.type || 'image', btn.dataset.src, btn.dataset.thumb || '');
    });
  });
  const mainImg = $('#gallery-main-img', wrap);
  if (mainImg) {
    mainImg.addEventListener('click', () => {
      if (mainImg.src) openLightbox(mainImg.src);
    });
  }
  // сайдбар «скрины сообщества»
  $$('.gp-comm-shot', wrap).forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.src) openLightbox(btn.dataset.src);
    });
  });
}

// ---------- Лайтбокс ----------
let lightboxEl = null;
function ensureLightbox() {
  if (lightboxEl) return lightboxEl;
  lightboxEl = document.createElement('div');
  lightboxEl.className = 'lightbox hidden';
  lightboxEl.innerHTML = `
    <div class="lightbox-backdrop"></div>
    <img class="lightbox-img" src="" alt="" />
    <button type="button" class="lightbox-close" title="Закрыть">×</button>`;
  document.body.appendChild(lightboxEl);
  const close = () => lightboxEl && lightboxEl.classList.add('hidden');
  $('.lightbox-backdrop', lightboxEl).addEventListener('click', close);
  $('.lightbox-close', lightboxEl).addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  return lightboxEl;
}

function openLightbox(src) {
  if (!src) return;
  const lb = ensureLightbox();
  const img = $('.lightbox-img', lb);
  if (img) img.src = src;
  lb.classList.remove('hidden');
}

function initLightbox() {
  ensureLightbox();
}

// Patch showView to load admin list
document.addEventListener('DOMContentLoaded', () => {
  // Сначала кнопка «+», чтобы сбой других init её не убил
  try { initSubmitGame(); } catch (e) { console.error('initSubmitGame', e); }

  const safe = (name, fn) => { try { fn(); } catch (e) { console.error(name, e); } };
  safe('initWebNav', initWebNav);
  safe('initClientNav', initClientNav);
  safe('initAvatarMenu', initAvatarMenu);
  safe('initStoreControls', initStoreControls);
  safe('initLibraryControls', initLibraryControls);
  safe('initSettingsView', initSettingsView);
  safe('initLightbox', initLightbox);
  safe('initHomeControls', initHomeControls);
  safe('initFriendsUI', initFriendsUI);
  safe('initChatUI', initChatUI);
  safe('initChatExtras', initChatExtras);
  safe('initNotificationsUI', initNotificationsUI);
  safe('initAdminPanel', initAdminPanel);
  safe('initSideLibrary', initSideLibrary);
  safe('initContentHead', initContentHead);
  safe('updateDownloadsBadge', updateDownloadsBadge);
  safe('loadSideLibrary', loadSideLibrary);

  // Неавторизованным всегда показываем auth, даже если в URL другой view
  let view = (window.FORCE_AUTH_VIEW && $('#view-auth')) ? 'auth' : getViewFromUrl();
  const gameId = window.GAME_ID_FROM_URL || 0;
  if (view === 'game' && !gameId) view = 'home';
  if (view === 'game' && gameId) {
    maybeAdultGate(gameId).then(ok => {
      if (ok) showView('game', gameId);
      else showView('home');
    });
  } else {
    showView(view, gameId);
  }
});
