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
    let text = await res.text();
    // Срезаем PHP Warning/Notice HTML перед JSON (display_errors на старых файлах)
    if (text) {
      const jsonStart = text.indexOf('{');
      const jsonStartArr = text.indexOf('[');
      let start = -1;
      if (jsonStart >= 0 && jsonStartArr >= 0) start = Math.min(jsonStart, jsonStartArr);
      else start = Math.max(jsonStart, jsonStartArr);
      if (start > 0) text = text.slice(start);
    }
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (parseErr) {
      const snippet = String(text || '').replace(/\s+/g, ' ').slice(0, 180);
      const m = String(text || '').match(/<b>(\w+ error|Warning|Notice|Parse error)<\/b>:\s*([^<]+)/i);
      if (m) throw new Error(m[1] + ': ' + m[2].trim());
      throw new Error('Сервер вернул не JSON (' + res.status + '): ' + (snippet || res.statusText || 'пусто'));
    }
    if (data == null) throw new Error('Пустой ответ сервера');
    return data;
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
  const bust = (u) => {
    if (!u) return '';
    if (typeof bustUrl === 'function') return bustUrl(u);
    const sep = String(u).includes('?') ? '&' : '?';
    return u + sep + 'v=' + (window.__mediaBust || '');
  };
  if (g.cover_src) return bust(g.cover_src);
  if (g.cover_url) return bust(g.cover_url);
  if (g.id) return bust('media.php?type=cover&id=' + g.id);
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
    arrowLeft: `<svg ${common}><path d="M15 18l-6-6 6-6"/></svg>`,
    share: `<svg ${common}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
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
  notifications: 'Уведомления',
  profile: 'Профиль',
  settings: 'Настройки',
  admin: 'Админка',
  game: 'Страница игры',
  auth: 'Вход',
  achievements: 'Достижения',
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

function showView(name, gameId, opts) {
  document.body.classList.toggle('auth-open', name === 'auth');
  document.body.classList.toggle('guest', name === 'auth' && !(window.AUTH_STATE && window.AUTH_STATE.authorized));

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
    headSearch.style.display = (name === 'game' || name === 'auth' || name === 'settings' || name === 'achievements') ? 'none' : '';
  }

  const main = $('.main');
  if (main) main.scrollTop = 0;
  window.scrollTo(0, 0);

  syncUrl(name, gameId);

  if (name === 'home') loadHome();
  if (name === 'store') loadStore();
  if (name === 'library') loadLibrary();
  if (name === 'community') loadWorkshop();
  if (name === 'notifications') loadNotifications();
  if (name === 'downloads') renderDownloadsView();
  if (name === 'profile') {
    if (opts && opts.foreign) {
      // чужой профиль — loadProfile не вызываем
    } else {
      viewingUserId = null;
      loadProfile();
    }
  }
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

const HOME_SORT_ICONS = {
  popular: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l2.2 6.6H21l-5.4 4 2.1 6.6L12 15.8 6.3 19.2l2.1-6.6L3 8.6h6.8L12 2z"/></svg>',
  week: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l6-6 4 4 7-7"/><path d="M14 8h7v7"/></svg>',
  new: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/></svg>',
};
const HOME_SORT_TITLES = {
  popular: 'Сейчас популярно',
  week: 'Лучшие игры недели',
  new: 'Новинки',
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
  const logoEl = $('#home-hero-logo');
  if (logoEl) {
    const logoUrl = game.logo_url || '';
    if (logoUrl) {
      logoEl.src = logoUrl;
      logoEl.classList.remove('hidden');
      logoEl.onerror = () => logoEl.classList.add('hidden');
    } else {
      logoEl.removeAttribute('src');
      logoEl.classList.add('hidden');
    }
  }
  // title hide if logo present? keep both for now
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
    const cover = escapeHtml(g.banner_url || g.cover_url || gameCoverUrl(g));
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
      if (title) title.innerHTML = (HOME_SORT_ICONS[homeSort] || '') + ' ' + (HOME_SORT_TITLES[homeSort] || '');
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
    sideLibCache = [];
    list.innerHTML = '';
    return;
  }
  try {
    const data = await fetchJSON(`${API_BASE}?action=library`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    sideLibCache = data.library || [];
    renderSideLibrary();
    // фоном подтянуть число ачивок из Steam (если ещё 0)
    syncSteamAchievementsLazy(sideLibCache);
  } catch (err) {
    // не затираем кэш при сетевой ошибке, если уже что-то было
    if (!sideLibCache || !sideLibCache.length) {
      list.innerHTML = '<div class="side-lib-empty">Не удалось загрузить</div>';
    }
  }
}

/** Мгновенно добавить игру в сайдбар, потом синхронизировать с сервером */
function sideLibAddOptimistic(game) {
  if (!game || !game.id) return;
  if (!Array.isArray(sideLibCache)) sideLibCache = [];
  if (!sideLibCache.some(g => +g.id === +game.id)) {
    sideLibCache = [{
      id: game.id,
      title: game.title || 'Игра',
      cover_url: game.cover_url || game.cover_src || '',
      icon_url: game.icon_url || '',
      icon_src: game.icon_src || game.icon_url || '',
      rating: game.rating,
      platforms: game.platforms || '',
      owned: true,
      is_pinned: game.is_pinned || 0,
      is_liked: game.is_liked || 0,
      liked: !!(game.is_liked || game.liked),
    }, ...sideLibCache];
    renderSideLibrary();
  }
  // фоновая синхронизация
  loadSideLibrary();
}

function sideLibRemoveOptimistic(gameId) {
  if (!Array.isArray(sideLibCache)) return;
  sideLibCache = sideLibCache.filter(g => +g.id !== +gameId);
  renderSideLibrary();
  loadSideLibrary();
}


let steamAchSyncing = false;
async function syncSteamAchievementsLazy(games) {
  // временно отключено — сильно грузит
  return;
  if (steamAchSyncing) return;
  const list = Array.isArray(games) ? games : [];
  const need = list.filter(g => {
    const total = parseInt(g.ach_total, 10) || 0;
    const app = g.steam_appid || (g.slug && /-s\d{3,10}$/.test(g.slug));
    return total === 0 && app;
  });
  if (!need.length) return;
  steamAchSyncing = true;
  try {
    const res = await postJSON(`${API_BASE}?action=sync_steam_achievements`, {});
    if (res && res.ok && res.updated > 0) {
      // обновить кэш сайдбара и профиль
      try {
        const data = await fetchJSON(`${API_BASE}?action=library`);
        if (data.ok) {
          sideLibCache = data.library || [];
          renderSideLibrary($('#side-lib-search')?.value || '');
          if (typeof profileLibraryCache !== 'undefined' && profileLibraryCache) {
            // merge ach fields into profile cards
            const map = {};
            sideLibCache.forEach(g => { map[g.id] = g; });
            profileLibraryCache.forEach(g => {
              if (map[g.id]) {
                g.ach_total = map[g.id].ach_total;
                g.ach_unlocked = map[g.id].ach_unlocked;
              }
            });
            if (typeof renderProfileLibrary === 'function') renderProfileLibrary();
            else if (typeof applyProfileLibraryFilter === 'function') applyProfileLibraryFilter();
            else {
              // soft re-render pinned/library if functions exist
              const pinned = profileLibraryCache.filter(g => +g.is_pinned);
              const rest = profileLibraryCache.filter(g => !+g.is_pinned);
              const pinnedBox = $('#hp-pinned-games');
              const libBox = $('#hp-library-games');
              if (pinnedBox && pinned.length) pinnedBox.innerHTML = pinned.map(g => gameCardHtml(g)).join('');
              if (libBox) libBox.innerHTML = rest.map(g => gameCardHtml(g)).join('');
              $$('.hp-game-card').forEach(card => {
                card.addEventListener('click', (e) => {
                  if (e.target.closest('.hp-game-pin')) return;
                  gotoGame(card.dataset.id);
                });
              });
            }
          }
        }
      } catch (e) {}
    }
  } catch (e) {
    // тихо — Steam может быть недоступен
  } finally {
    steamAchSyncing = false;
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

  // лайкнутые всегда сверху (пины профиля сюда не лезут)
  games = [...games].sort((a, b) => {
    const la = (+a.is_liked || a.liked) ? 1 : 0;
    const lb = (+b.is_liked || b.liked) ? 1 : 0;
    if (lb !== la) return lb - la;
    if (la && lb) {
      const ta = a.liked_at ? new Date(a.liked_at).getTime() : 0;
      const tb = b.liked_at ? new Date(b.liked_at).getTime() : 0;
      if (tb !== ta) return tb - ta;
    }
    if (sideLibSort === 'name') return (a.title || '').localeCompare(b.title || '', 'ru');
    if (sideLibSort === 'rating') return parseFloat(b.rating) - parseFloat(a.rating);
    return 0;
  });

  if (!games.length) {
    const msg = sideLibInstalledOnly ? 'Ничего не установлено' : (q ? 'Ничего не найдено' : 'Пока пусто');
    list.innerHTML = `<div class="side-lib-empty">${msg}</div>`;
    return;
  }

  list.innerHTML = games.map(g => {
    const icon = g.id ? ('media.php?type=icon&id=' + g.id + '&v=' + (window.__iconBust || Date.now())) : (g.icon_src || g.icon_url || g.cover_url || g.cover_src || '');
    const liked = !!(+g.is_liked || g.liked);
    return `
    <button type="button" class="side-lib-item ${liked ? 'liked' : ''}" data-id="${g.id}">
      <img src="${escapeHtml(icon)}" alt="" loading="lazy" onerror="this.style.opacity='0.35'" />
      <span class="side-lib-name">${escapeHtml(g.title)}</span>
      ${liked ? '<span class="side-lib-heart" title="В избранном">♥</span>' : ''}
    </button>`;
  }).join('');

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
    let searchTimer = null;
    hs.addEventListener('input', () => {
      const q = hs.value.trim();
      const view = getViewFromUrl();
      if (view === 'store') {
        hideHeadSearchDrop();
        storeSearch = q;
        if (storeCache.length) renderStoreList();
      } else if (view === 'home' || view === 'profile') {
        // Steam-style: выпадающий список игр, не фильтр страницы
        clearTimeout(searchTimer);
        if (!q) { hideHeadSearchDrop(); return; }
        searchTimer = setTimeout(() => updateHeadSearchDrop(q), 160);
      } else if (view === 'library') {
        hideHeadSearchDrop();
        librarySearch = q;
        renderLibraryGrid();
      } else if (view === 'downloads') {
        hideHeadSearchDrop();
        dlSearch = q;
        renderDownloadsView();
      } else {
        hideHeadSearchDrop();
      }
    });
    hs.addEventListener('focus', () => {
      const q = hs.value.trim();
      const view = getViewFromUrl();
      if ((view === 'home' || view === 'profile') && q) updateHeadSearchDrop(q);
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#head-search')) hideHeadSearchDrop();
    });
  }
}

let headSearchGamesCache = null;
async function ensureSearchGames() {
  if (storeCache && storeCache.length) return storeCache;
  if (headSearchGamesCache && headSearchGamesCache.length) return headSearchGamesCache;
  if (homeCache && homeCache.length) return homeCache;
  try {
    const data = await fetchJSON(`${API_BASE}?action=list&category=game`);
    if (data.ok) {
      headSearchGamesCache = data.games || [];
      return headSearchGamesCache;
    }
  } catch (e) {}
  return [];
}

function hideHeadSearchDrop() {
  const drop = $('#head-search-drop');
  if (!drop) return;
  drop.hidden = true;
  drop.innerHTML = '';
  drop.classList.remove('is-open');
}

async function updateHeadSearchDrop(q) {
  const drop = $('#head-search-drop');
  const wrap = $('#head-search');
  if (!drop || !wrap) return;
  const query = String(q || '').trim().toLowerCase();
  if (!query) { hideHeadSearchDrop(); return; }

  drop.hidden = false;
  drop.classList.add('is-open');
  drop.innerHTML = '<div class="head-search-drop-status">Поиск…</div>';

  const games = await ensureSearchGames();
  const matched = games.filter(g => {
    const t = String(g.title || '').toLowerCase();
    const d = String(g.developer_name || g.developer || '').toLowerCase();
    const gen = String(g.genre || '').toLowerCase();
    return t.includes(query) || d.includes(query) || gen.includes(query);
  }).slice(0, 8);

  if (!matched.length) {
    drop.innerHTML = '<div class="head-search-drop-status">Ничего не найдено</div>';
    return;
  }

  drop.innerHTML = matched.map(g => {
    const cover = escapeHtml(g.cover_url || g.cover_src || g.banner_url || ('media.php?type=cover&id=' + g.id));
    const title = escapeHtml(g.title || 'Без названия');
    const meta = escapeHtml((g.genre || g.developer_name || g.developer || '').toString().split(/[,/]/)[0].trim() || '');
    return `<button type="button" class="head-search-item" data-id="${g.id}">
      <img class="head-search-item-cover" src="${cover}" alt="" loading="lazy" />
      <span class="head-search-item-meta">
        <span class="head-search-item-title">${title}</span>
        ${meta ? `<span class="head-search-item-sub">${meta}</span>` : ''}
      </span>
    </button>`;
  }).join('') + `<button type="button" class="head-search-more" data-q="${escapeHtml(q)}">Все результаты в каталоге</button>`;

  drop.querySelectorAll('.head-search-item').forEach(btn => {
    btn.addEventListener('click', () => {
      hideHeadSearchDrop();
      const id = btn.dataset.id;
      if (id) gotoGame(id);
    });
  });
  const more = drop.querySelector('.head-search-more');
  if (more) {
    more.addEventListener('click', () => {
      const qq = more.dataset.q || q;
      hideHeadSearchDrop();
      storeSearch = qq;
      const input = $('#head-search-input');
      if (input) input.value = qq;
      showView('store');
      // filter after store loads
      setTimeout(() => {
        storeSearch = qq;
        if (storeCache.length) renderStoreList();
      }, 400);
    });
  }
}

// ============================================================
//  КАТАЛОГ (сетка / список + фильтры справа, как в Hydra)
// ============================================================
let storeCache = [];
let storeGenres = new Set();
let storeDevs = new Set();
let storeSearch = '';
let storeSort = 'popular';
let storeEra = localStorage.getItem('catio_store_era') || 'modern'; // 'modern' | 'classics'
let storePrice = 'all'; // 'all' | 'free' | 'paid'

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
    syncStoreEraToggle();
    renderStoreList();
    try { refreshStoreChrome(); } catch (e) {}
  } catch (err) {
    if (isOffline(err)) {
      renderOffline(list, loadStore, 'Кот ушёл в запой');
    } else {
      list.innerHTML = `<div class="loading">Не удалось загрузить каталог.<br><small>${escapeHtml(err.message)}</small></div>`;
    }
  }
}

function syncStoreEraToggle() {
  $$('.store-era-btn').forEach(btn => {
    const on = btn.dataset.era === storeEra;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

/** Классика = ретро / эмуляторы (PS1, NES, и т.д.) */
function isClassicGame(g) {
  if (!g) return false;
  if (g.is_classic == 1 || g.is_classic === true || g.era === 'classics' || g.platform_type === 'retro') return true;
  const blob = [
    g.genre, g.tags, g.platforms, g.platform, g.category, g.title, g.short_description
  ].map(x => String(x || '').toLowerCase()).join(' ');
  return /\b(retro|ретро|classic|классик|emulator|эмулятор|ps1|ps2|psx|psp|nes|snes|n64|gamecube|wii|gba|gbc|nds|3ds|sega|genesis|megadrive|dreamcast|arcade|mame|atari|dos|amiga|gameboy)\b/i.test(blob);
}

// Панель фильтров: жанры и разработчики из реальных данных
function splitFilterTokens(raw) {
  return String(raw || '')
    .split(/[,;/|·•]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function buildStoreFilters() {
  const genres = [...new Set(storeCache.flatMap(g => splitFilterTokens(g.genre)))].sort((a, b) => a.localeCompare(b, 'ru'));
  const devs = [...new Set(storeCache.flatMap(g => splitFilterTokens(g.developer_name || g.developer)))].sort((a, b) => a.localeCompare(b, 'ru'));

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

  const bindFilterSearch = (inputId, boxId) => {
    const inp = $(inputId);
    if (!inp) return;
    inp.oninput = () => {
      const q = inp.value.trim().toLowerCase();
      $$('.filter-opt', $(boxId)).forEach(opt => {
        opt.style.display = !q || opt.dataset.value.includes(q) ? '' : 'none';
      });
    };
  };
  bindFilterSearch('#genre-filter-search', '#genre-opts');
  bindFilterSearch('#dev-filter-search', '#dev-opts');
}

function applyStoreFilters(games) {
  let out = games;
  if (storeEra === 'classics') {
    out = out.filter(isClassicGame);
  } else {
    // современные — всё, что не классика
    out = out.filter(g => !isClassicGame(g));
  }
  if (storeGenres.size) {
    out = out.filter(g => splitFilterTokens(g.genre).some(p => storeGenres.has(p)));
  }
  if (storeDevs.size) {
    out = out.filter(g => splitFilterTokens(g.developer_name || g.developer).some(p => storeDevs.has(p)));
  }
  if (storePrice === 'free') {
    out = out.filter(g => !(parseFloat(g.price) > 0));
  } else if (storePrice === 'paid') {
    out = out.filter(g => parseFloat(g.price) > 0);
  }
  if (storeSearch) {
    const q = storeSearch.toLowerCase();
    out = out.filter(g =>
      (g.title || '').toLowerCase().includes(q) ||
      (g.short_description || '').toLowerCase().includes(q) ||
      (g.developer_name || g.developer || '').toLowerCase().includes(q) ||
      (g.genre || '').toLowerCase().includes(q) ||
      (g.tags || '').toLowerCase().includes(q)
    );
  }
  if (storeSort === 'popular') {
    out = [...out].sort((a, b) => (b.download_count || 0) - (a.download_count || 0));
  } else if (storeSort === 'rating') {
    out = [...out].sort((a, b) => parseFloat(b.rating || 0) - parseFloat(a.rating || 0));
  } else if (storeSort === 'price') {
    out = [...out].sort((a, b) => parseFloat(a.price || 0) - parseFloat(b.price || 0));
  } else if (storeSort === 'title') {
    out = [...out].sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ru'));
  }
  // 'new' — порядок из API
  return out;
}

function clearStoreFilters() {
  storeGenres.clear();
  storeDevs.clear();
  storePrice = 'all';
  storeSearch = '';
  const hs = $('#head-search-input');
  if (hs) hs.value = '';
  $$('#price-pills .price-pill').forEach(p => p.classList.toggle('active', p.dataset.price === 'all'));
  $$('#genre-opts input[type="checkbox"], #dev-opts input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  const gfs = $('#genre-filter-search');
  const dfs = $('#dev-filter-search');
  if (gfs) gfs.value = '';
  if (dfs) dfs.value = '';
  $$('#genre-opts .filter-opt, #dev-opts .filter-opt').forEach(o => { o.style.display = ''; });
  renderStoreList();
}

function createStoreRow(game) {
  const price = formatPrice(game.price);
  const row = document.createElement('article');
  row.className = 'store-row game-item';
  row.dataset.id = game.id;
  const cover = escapeHtml(game.banner_url || game.cover_url || game.cover_src || ('media.php?type=cover&id=' + game.id));
  const genres = escapeHtml((game.genre || '').split(/[,/|]/).map(s => s.trim()).filter(Boolean).slice(0, 4).join(', ') || '—');
  row.innerHTML = `
    <div class="game-item__content-link">
      <div class="game-item__cover-wrapper">
        <img class="game-item__cover" src="${cover}" alt="${escapeHtml(game.title)}" loading="lazy" />
      </div>
      <div class="game-item__details">
        <h3 class="store-row-title">${escapeHtml(game.title)}</h3>
        <div class="game-item__genres">${genres}</div>
      </div>
    </div>
    <button type="button" class="game-item__plus-wrapper ${game.owned ? 'is-owned' : 'is-add'}" data-id="${game.id}" title="${game.owned ? 'В библиотеке' : 'В библиотеку'}" ${game.owned ? 'disabled' : ''}>
      ${game.owned
        ? '<svg class="gi-icon gi-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
        : '<svg class="gi-icon gi-plus" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>'}
    </button>
  `;
  const plus = row.querySelector('.game-item__plus-wrapper');
  row.addEventListener('click', (e) => {
    if (e.target.closest('.game-item__plus-wrapper')) return;
    gotoGame(game.id);
  });
  plus.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (game.owned || plus.disabled) return;
    plus.disabled = true;
    try {
      const data = await postJSON(`${API_BASE}?action=buy`, { game_id: game.id });
      if (!data.ok) throw new Error(data.error || 'Не удалось оформить');
      if (data.balance !== undefined) updateBalance(data.balance);
      game.owned = true;
      // обновить в кэше
      const cached = storeCache.find(g => String(g.id) === String(game.id));
      if (cached) cached.owned = true;
      markStoreRowOwned(plus);
      try { sideLibAddOptimistic(game); } catch (err) {}
      toast(data.message || `«${game.title}» добавлена в библиотеку`);
    } catch (err) {
      plus.disabled = false;
      toast(err.message || 'Ошибка');
    }
  });
  return row;
}

function markStoreRowOwned(plusBtn) {
  if (!plusBtn) return;
  plusBtn.classList.remove('is-add');
  plusBtn.classList.add('is-owned');
  plusBtn.disabled = true;
  plusBtn.title = 'В библиотеке';
  plusBtn.innerHTML = '<svg class="gi-icon gi-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
}

function createStoreGridCard(game) {
  const price = formatPrice(game.price);
  const card = document.createElement('article');
  card.className = 'store-grid-card';
  card.dataset.id = game.id;
  const cover = escapeHtml(game.cover_url || game.cover_src || game.banner_url || ('media.php?type=cover&id=' + game.id));
  card.innerHTML = `
    <div class="store-grid-cover">
      <img src="${cover}" alt="${escapeHtml(game.title)}" loading="lazy" />
      ${game.owned ? '<span class="card-badge owned">✓</span>' : ''}
    </div>
    <div class="store-grid-body">
      <h3 class="store-grid-title">${escapeHtml(game.title)}</h3>
      <div class="store-grid-meta">${escapeHtml(game.genre || game.developer_name || '')}</div>
    </div>
  `;
  card.addEventListener('click', () => gotoGame(game.id));
  return card;
}

function renderStoreList() {
  const list = $('#store-list');
  if (!list) return;
  const games = applyStoreFilters(storeCache);

  const count = $('#store-count');
  if (count) count.textContent = games.length.toLocaleString('ru-RU');

  list.className = 'store-list';

  if (!games.length) {
    const emptyMsg = storeEra === 'classics'
      ? 'В разделе «Классика» пока пусто.<br><small>Сюда попадут ретро-игры и релизы для эмуляторов (PS1, NES и т.д.).</small>'
      : 'Ничего не найдено.<br><small>Сбрось фильтры или измени запрос.</small>';
    list.innerHTML = `<div class="loading store-empty">${emptyMsg}</div>`;
    return;
  }

  list.innerHTML = '';
  games.forEach(game => list.appendChild(createStoreRow(game)));
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
    sideLibAddOptimistic(game);
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

  setTimeout(() => { try { refreshStoreChrome(); } catch (e) {} }, 0);

  // Современные / Классика (ретро)
  $$('.store-era-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      storeEra = btn.dataset.era || 'modern';
      localStorage.setItem('catio_store_era', storeEra);
      syncStoreEraToggle();
      if (storeCache.length) renderStoreList();
    });
  });
  syncStoreEraToggle();

  // Фильтр по цене
  $$('#price-pills .price-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      $$('#price-pills .price-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      storePrice = pill.dataset.price || 'all';
      renderStoreList();
    });
  });

  // Сброс фильтров
  const clearBtn = $('#store-clear-filters');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearStoreFilters);
  }

  // Сворачивание блоков фильтров (один раз на head)
  $$('.filter-block-head').forEach(head => {
    if (head.dataset.boundFilterToggle === '1') return;
    head.dataset.boundFilterToggle = '1';
    head.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const block = head.closest('.filter-block');
      if (!block) return;
      const body = block.querySelector('.filter-block-body');
      const willCollapse = !block.classList.contains('collapsed');
      if (body) {
        if (willCollapse) {
          body.style.maxHeight = body.scrollHeight + 'px';
          body.offsetHeight;
          block.classList.add('collapsed');
          body.style.maxHeight = '0px';
          body.style.paddingTop = '0px';
          body.style.paddingBottom = '0px';
          body.style.opacity = '0';
        } else {
          block.classList.remove('collapsed');
          body.style.paddingTop = '';
          body.style.paddingBottom = '';
          body.style.opacity = '1';
          body.style.maxHeight = body.scrollHeight + 'px';
          const onEnd = (ev) => {
            if (ev.propertyName !== 'max-height') return;
            body.style.maxHeight = '';
            body.removeEventListener('transitionend', onEnd);
          };
          body.addEventListener('transitionend', onEnd);
        }
      } else {
        block.classList.toggle('collapsed');
      }
    });
  });

  // Скролл списка жанров/разработчиков не должен закрывать блок
  $$('#genre-opts, #dev-opts, .filter-opts').forEach(box => {
    if (!box || box.dataset.boundFilterScroll === '1') return;
    box.dataset.boundFilterScroll = '1';
    box.addEventListener('wheel', (e) => {
      e.stopPropagation();
    }, { passive: true });
    box.addEventListener('touchmove', (e) => {
      e.stopPropagation();
    }, { passive: true });
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



const achCache = {};

function renderAchSidebar(gameId, gameTitle, data) {
  const head = $('#gp-ach-head');
  const body = $('#gp-ach-body');
  if (!body) return;
  const list = data.achievements || [];
  const total = data.total || list.length;
  const unlocked = data.unlocked || 0;
  if (head) head.innerHTML = `Достижения ${unlocked}/${total} <span class="chev">▾</span>`;
  if (!list.length) {
    body.innerHTML = '<div class="gp-ach-empty">У этой игры нет достижений</div>';
    return;
  }
  const preview = list.filter(a => !+a.is_hidden).slice(0, 5);
  body.innerHTML = `
    <div class="gp-ach-list">
      ${preview.map(a => {
        const icon = a.icon_gray_url || a.icon_url || '';
        const name = (+a.is_hidden && !a.unlocked) ? 'Скрытое достижение' : (a.display_name || a.api_name);
        return `<div class="gp-ach-row">
          <div class="gp-ach-icon">${icon ? `<img src="${escapeHtml(icon)}" alt="" loading="lazy" onerror="this.style.display='none'" />` : ''}</div>
          <div class="gp-ach-meta"><div class="gp-ach-name">${escapeHtml(name)}</div></div>
        </div>`;
      }).join('')}
    </div>
    <button type="button" class="gp-side-more" id="gp-ach-all">Просмотреть все достижения</button>`;
  $('#gp-ach-all')?.addEventListener('click', () => openGameAchievementsPage(gameId, gameTitle || data.title));
}

async function loadGameAchievementsSidebar(gameId, gameTitle) {
  if (achCache[gameId]) {
    renderAchSidebar(gameId, gameTitle, achCache[gameId]);
    return;
  }
  const head = $('#gp-ach-head');
  const body = $('#gp-ach-body');
  if (!body) return;
  try {
    const data = await fetchJSON(`${API_BASE}?action=achievements&id=${gameId}`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    achCache[gameId] = data;
    renderAchSidebar(gameId, gameTitle, data);
  } catch (err) {
    body.innerHTML = `<div class="gp-ach-empty">${escapeHtml(err.message || 'Не удалось загрузить')}</div>`;
  }
}

async function openGameAchievementsPage(gameId, gameTitle) {
  showView('achievements', null, { soft: true });
  const wrap = $('#achievements-page');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading">Загрузка достижений...</div>';
  try {
    const data = await fetchJSON(`${API_BASE}?action=achievements&id=${gameId}`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const list = data.achievements || [];
    const total = data.total || list.length;
    const unlocked = data.unlocked || 0;
    const pct = total ? Math.round((unlocked / total) * 100) : 0;
    const title = gameTitle || data.title || 'Игра';

    wrap.innerHTML = `
      <div class="ach-page">
        <div class="ach-page-top">
          <button type="button" class="ach-back" id="ach-back">← ${escapeHtml(title)}</button>
        </div>
        <div class="ach-hero" style="background-image:url('media.php?type=hero&id=${gameId}')">
          <div class="ach-hero-fade"></div>
          <div class="ach-hero-content">
            <div class="ach-hero-user">
              <div class="ach-progress-line">
                <span class="ach-progress-ico">🏆</span>
                <span>${unlocked} / ${total}</span>
              </div>
              <div class="ach-progress-bar"><span style="width:${pct}%"></span></div>
            </div>
          </div>
        </div>
        <div class="ach-toolbar">
          <input type="search" class="ach-search" id="ach-search" placeholder="Поиск достижений" autocomplete="off" />
          <select class="ach-filter" id="ach-filter">
            <option value="all">Все достижения</option>
            <option value="locked">Не получены</option>
            <option value="hidden">Скрытые</option>
          </select>
          <select class="ach-sort" id="ach-sort">
            <option value="common">Самые распространённые</option>
            <option value="rare">Самые редкие</option>
            <option value="name">По имени</option>
          </select>
        </div>
        <div class="ach-list" id="ach-list"></div>
      </div>`;

    const render = () => {
      const q = ($('#ach-search')?.value || '').trim().toLowerCase();
      const filter = $('#ach-filter')?.value || 'all';
      const sort = $('#ach-sort')?.value || 'common';
      let rows = [...list];
      if (q) rows = rows.filter(a =>
        (a.display_name || '').toLowerCase().includes(q) ||
        (a.description || '').toLowerCase().includes(q)
      );
      if (filter === 'locked') rows = rows.filter(a => !a.unlocked);
      if (filter === 'hidden') rows = rows.filter(a => a.is_hidden);
      if (sort === 'common') rows.sort((a, b) => b.percent - a.percent);
      if (sort === 'rare') rows.sort((a, b) => a.percent - b.percent);
      if (sort === 'name') rows.sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '', 'ru'));

      const box = $('#ach-list');
      if (!box) return;
      if (!rows.length) {
        box.innerHTML = '<div class="gp-ach-empty">Ничего не найдено</div>';
        return;
      }
      box.innerHTML = rows.map(a => {
        const locked = !a.unlocked;
        const name = a.is_hidden && locked ? 'Скрытое достижение' : (a.display_name || a.api_name);
        const desc = a.is_hidden && locked ? 'Нажмите, чтобы открыть' : (a.description || '');
        const icon = locked ? (a.icon_gray_url || a.icon_url) : (a.icon_url || a.icon_gray_url);
        const p = (a.percent || 0).toFixed(1).replace(/\.0$/, '') + '%';
        return `<div class="ach-row ${locked ? 'locked' : 'unlocked'}" data-hidden="${a.is_hidden ? 1 : 0}">
          <div class="ach-row-icon">${icon ? `<img src="${escapeHtml(icon)}" alt="" loading="lazy" />` : '<span class="ach-row-placeholder"></span>'}</div>
          <div class="ach-row-body">
            <div class="ach-row-name">${escapeHtml(name)}</div>
            <div class="ach-row-desc">${escapeHtml(desc)}</div>
          </div>
          <div class="ach-row-pct">${escapeHtml(p)}</div>
        </div>`;
      }).join('');
    };

    $('#ach-back')?.addEventListener('click', () => gotoGame(gameId));
    $('#ach-search')?.addEventListener('input', render);
    $('#ach-filter')?.addEventListener('change', render);
    $('#ach-sort')?.addEventListener('change', render);
    render();
  } catch (err) {
    wrap.innerHTML = `<div class="hp-empty">${escapeHtml(err.message || 'Ошибка')}</div>`;
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
    let src = String(v.url).replace(/^http:\/\//i, 'https://');
    const fallbacks = Array.isArray(v.fallbacks)
      ? v.fallbacks.map(u => String(u).replace(/^http:\/\//i, 'https://'))
      : [];
    gallery.push({
      type: 'video',
      src,
      fallbacks,
      format: v.format || '',
      thumb: v.thumbnail || cover || '',
      name: v.name || ('Трейлер ' + (i + 1)),
    });
  });
  (shots.length ? shots : (cover ? [cover] : [])).forEach((src) => {
    if (!src) return;
    gallery.push({ type: 'image', src, thumb: src });
  });
  const descHtml = formatGameDescription(g.description || 'Описание отсутствует.');
  const releaseLabel = g.created_at
    ? ('Выпущено ' + formatDate(g.created_at))
    : '';
  const publisher = g.developer_name || g.developer || '';

  const buildsCount = Array.isArray(data.builds) ? data.builds.length : (parseInt(g.builds_count, 10) || 0);
  const hasBuilds = buildsCount > 0;
  const playHours = g.playtime_minutes ? Math.max(1, Math.round(+g.playtime_minutes / 60)) : 0;
  const playLabel = playHours
    ? ('Сыграно ' + playHours + ' ' + (playHours === 1 ? 'час' : (playHours < 5 ? 'часа' : 'часов')))
    : 'Ещё не запускалась';
  const lastLabel = g.last_played
    ? ('Последний запуск ' + (typeof formatRelative === 'function' ? formatRelative(g.last_played) : formatDate(g.last_played)))
    : '';

  // Hydra-style status line: title lives only here, no big H1
  let statusMain = '';
  let statusSub = '';
  if (g.owned) {
    if (playHours > 0) {
      statusMain = playLabel;
      statusSub = lastLabel;
    } else {
      statusMain = 'Вы ещё не играли в ' + (g.title || 'эту игру');
    }
  } else {
    statusMain = hasBuilds ? ('Добавьте «' + (g.title || 'игру') + '» в библиотеку') : 'Нет файлов для скачивания';
  }
  const actionLeft = `<div class="gp-playtime">${escapeHtml(statusMain)}</div>`
    + (statusSub ? `<div class="gp-last-play">${escapeHtml(statusSub)}</div>` : '');

  const isWebBrowser = document.body.classList.contains('web') || !document.body.classList.contains('client');

  // В браузере: без облака/настроек; карандаш админа — в actionbar вместо настроек
  const adminEditChip = (viewer && viewer.is_admin && !isWebBrowser)
    ? `<button type="button" class="gp-hero-chip" id="gp-admin-edit" title="Редактировать">${iconSvg('pencil',15)}</button>`
    : '';
  const adminEditBar = (viewer && viewer.is_admin && isWebBrowser)
    ? `<button type="button" class="gp-bar-btn icon" id="gp-admin-edit" title="Редактировать">${iconSvg('pencil',16)}</button>`
    : '';
  const adminEditBtn = adminEditChip; // legacy name for hero tools

  const dlDisabled = !hasBuilds ? ' disabled aria-disabled="true"' : '';
  const dlClass = hasBuilds ? 'gp-bar-btn primary' : 'gp-bar-btn primary is-disabled';
  const dlTitle = hasBuilds ? 'Скачать' : 'Нет файлов для скачивания';

  const pinSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;
  const pinSvgPinned = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/><path d="M4 4l16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;
  const isPinnedGame = !!(+g.is_pinned);

  const settingsOrEditBtn = isWebBrowser
    ? adminEditBar
    : `<button type="button" class="gp-bar-btn gp-settings-btn" id="gp-settings" title="Настройки">
         ${iconSvg('settings',16)}
         <span>Настройки</span>
       </button>`;

  const cloudChip = isWebBrowser ? '' : `
            <button type="button" class="gp-hero-chip" id="gp-cloud-saves" title="Облачное сохранение">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
              <span>Облачное сохранение</span>
            </button>`;

  const actionBtns = g.owned
    ? `<button type="button" class="${dlClass}" id="btn-buy-game"${dlDisabled} title="${dlTitle}">
         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
         Скачать
       </button>
       <span class="gp-bar-sep" aria-hidden="true"></span>
       <button type="button" class="gp-bar-btn icon gp-like-btn ${g.is_liked || g.liked ? 'liked' : ''}" id="gp-like" title="${g.is_liked || g.liked ? 'Убрать лайк' : 'Лайк'}">${iconSvg('heart',16)}</button>
       <button type="button" class="gp-bar-btn icon ${isPinnedGame ? 'is-pinned' : ''}" id="gp-share" title="${isPinnedGame ? 'Открепить' : 'Закрепить'}">${isPinnedGame ? pinSvgPinned : pinSvg}</button>
       ${settingsOrEditBtn}`
    : `${price.className === 'paid' ? `<span class="gp-price">${escapeHtml(price.text)}</span>` : ''}
       <button type="button" class="gp-bar-btn primary" id="btn-buy-game">
         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
         Добавить в библиотеку
       </button>
       ${adminEditBar}`;

  wrap.innerHTML = `
    <div class="gp">
      <div class="gp-hero">
        <img class="gp-hero-bg" src="${escapeHtml(hero)}" alt="" onerror="this.style.opacity=0.35" />
        <div class="gp-hero-grad"></div>
        <div class="gp-hero-content">
          ${g.logo_url ? `<img class="gp-hero-logo" src="${escapeHtml(g.logo_url)}" alt="" onerror="this.style.display='none'" />` : ''}
        </div>
        <div class="gp-hero-bottom">
          ${(!isWebBrowser || adminEditBtn || cloudChip) ? `<div class="gp-hero-tools">
            ${adminEditBtn || ''}
            ${cloudChip || ''}
          </div>` : ''}
          <div class="gp-actionbar">
            <div class="gp-action-left">${actionLeft}</div>
            <div class="gp-action-btns">${actionBtns}</div>
          </div>
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
                  ? `<video id="gallery-main-video" src="${escapeHtml(gallery[0].src)}" controls playsinline preload="metadata" muted poster="${escapeHtml(gallery[0].thumb || '')}"></video>`
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
          <div class="gp-side-card collapsed" id="gp-ach-card" data-game-id="${g.id}">
            <button type="button" class="gp-side-head" id="gp-ach-head">Достижения <span class="chev">▾</span></button>
            <div class="gp-side-body" id="gp-ach-body">
              <div class="gp-ach-empty">В разработке</div>
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

  wrap._galleryItems = gallery;
  wrap._gameData = g;
  initGallery(wrap);
  // корректно показать первый элемент (YouTube iframe / https video)
  if (gallery.length && gallery[0].type === 'video') {
    setGalleryMain(wrap, 'video', gallery[0].src, gallery[0].thumb || '', gallery[0].fallbacks || []);
  }
  if (typeof initGameCollapsibles === 'function') initGameCollapsibles(wrap);
  initBuyButton(wrap, g);
  initRateStars(wrap, g);
  renderCommentsThreaded(data.comments || [], data.viewer, g.id);
  initCommentForm(g, data.viewer);
  initBuildButtons(wrap, g);
  initReviewSort(data.comments || [], data.viewer);
  loadSimilarGames(g);
  bindAdminGameEdit(g, viewer);

  // description toggle + автоплей зацикленных видео в «Об игре»
  const desc = $('#gp-description');
  const tog = $('#gp-desc-toggle');
  if (desc) {
    $$('video', desc).forEach(v => {
      v.muted = true;
      v.defaultMuted = true;
      v.loop = true;
      v.playsInline = true;
      v.removeAttribute('controls');
      const tryPlay = () => v.play().catch(() => {});
      if (v.readyState >= 2) tryPlay();
      else v.addEventListener('loadeddata', tryPlay, { once: true });
    });
  }
  if (desc && tog) {
    const needsToggle = desc.scrollHeight > 320;
    if (!needsToggle) {
      desc.classList.remove('gp-description--collapsed');
      tog.classList.add('hidden');
    } else {
      tog.addEventListener('click', () => {
        const open = desc.classList.toggle('gp-description--collapsed');
        tog.textContent = open ? 'Показать больше' : 'Показать меньше';
      });
    }
  }

  // side card collapse
  // achievements временно отключены (нагрузка)
  $$('.gp-side-head', wrap).forEach(btn => {
    if (btn.dataset.boundSideAnim === '1') return;
    btn.dataset.boundSideAnim = '1';
    btn.addEventListener('click', () => {
      const card = btn.closest('.gp-side-card') || btn.parentElement;
      if (!card) return;
      const body = card.querySelector('.gp-side-body');
      const willCollapse = !card.classList.contains('collapsed');
      if (body) {
        if (willCollapse) {
          body.style.maxHeight = body.scrollHeight + 'px';
          body.offsetHeight;
          card.classList.add('collapsed');
          body.style.maxHeight = '0px';
          body.style.opacity = '0';
        } else {
          card.classList.remove('collapsed');
          body.style.opacity = '1';
          body.style.maxHeight = body.scrollHeight + 'px';
          const onEnd = (ev) => {
            if (ev.propertyName !== 'max-height') return;
            // длинные списки языков — не режем
            body.style.maxHeight = '';
            body.removeEventListener('transitionend', onEnd);
          };
          body.addEventListener('transitionend', onEnd);
        }
      } else {
        card.classList.toggle('collapsed');
      }
    });
  });

  const shareBtn = $('#gp-share', wrap);
  if (shareBtn) {
    const pinSvgOpen = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;
    const pinSvgDone = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/><path d="M4 4l16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;
    const applyPinUi = (pinned) => {
      shareBtn.classList.toggle('is-pinned', !!pinned);
      shareBtn.title = pinned ? 'Открепить' : 'Закрепить';
      shareBtn.innerHTML = pinned ? pinSvgDone : pinSvgOpen;
      shareBtn.dataset.pinned = pinned ? '1' : '0';
    };
    applyPinUi(!!(+g.is_pinned));
    shareBtn.addEventListener('click', async () => {
      if (!window.AUTH_STATE || !window.AUTH_STATE.authorized) {
        toast('Войди в аккаунт, чтобы закрепить игру');
        return;
      }
      if (!g.owned) {
        toast('Сначала добавь игру в библиотеку');
        return;
      }
      const currentlyPinned = shareBtn.dataset.pinned === '1' || !!(+g.is_pinned);
      const nextPinned = !currentlyPinned;
      // мгновенно меняем кнопку
      applyPinUi(nextPinned);
      shareBtn.disabled = true;
      try {
        const res = await postJSON(`${USER_API}?action=pin`, {
          game_id: +g.id,
          pinned: nextPinned ? 1 : 0,
        });
        if (!res.ok) throw new Error(res.error || 'Ошибка');
        g.is_pinned = nextPinned ? 1 : 0;
        if (Array.isArray(profileLibraryCache)) {
          const item = profileLibraryCache.find(x => +x.id === +g.id);
          if (item) {
            item.is_pinned = g.is_pinned;
            item.pinned_order = nextPinned ? Date.now() : 0;
          }
        }
        if (Array.isArray(sideLibCache)) {
          const item = sideLibCache.find(x => +x.id === +g.id);
          if (item) item.is_pinned = g.is_pinned;
        }
        toast(nextPinned ? 'Игра закреплена' : 'Игра откреплена');
      } catch (e) {
        applyPinUi(currentlyPinned); // откат
        toast(e.message || 'Не удалось изменить закрепление');
      } finally {
        shareBtn.disabled = false;
      }
    });
  }
  const likeBtn = $('#gp-like', wrap);
  if (likeBtn) {
    likeBtn.addEventListener('click', async () => {
      if (!window.AUTH_STATE || !window.AUTH_STATE.authorized) {
        toast('Войди в аккаунт, чтобы лайкнуть игру');
        return;
      }
      if (!g.owned) {
        toast('Сначала добавь игру в библиотеку');
        return;
      }
      const was = !!(g.is_liked || g.liked);
      likeBtn.disabled = true;
      try {
        const res = await postJSON(`${USER_API}?action=like`, {
          game_id: +g.id,
          liked: was ? 0 : 1,
        });
        if (!res.ok) throw new Error(res.error || 'Ошибка');
        g.is_liked = was ? 0 : 1;
        g.liked = !was;
        likeBtn.classList.toggle('liked', g.liked);
        likeBtn.title = g.liked ? 'Убрать лайк' : 'Лайк — поднять в библиотеке';
        if (Array.isArray(sideLibCache)) {
          const item = sideLibCache.find(x => +x.id === +g.id);
          if (item) {
            item.is_liked = g.is_liked;
            item.liked = g.liked;
            item.liked_at = g.liked ? new Date().toISOString() : null;
          }
          renderSideLibrary();
        } else {
          loadSideLibrary();
        }
        toast(g.liked ? 'Лайк! Игра поднята в «Моя библиотека»' : 'Лайк снят');
      } catch (err) {
        toast(err.message || 'Не удалось');
      } finally {
        likeBtn.disabled = false;
      }
    });
  }
    $('#gp-cloud-saves')?.addEventListener('click', () => toast('Облачные сохранения скоро'));
  $('#gp-settings')?.addEventListener('click', () => {
    const isAdmin = !!(window.AUTH_STATE && window.AUTH_STATE.user &&
      (window.AUTH_STATE.user.role === 'admin' || window.AUTH_STATE.user.is_admin));
    if (isAdmin && wrap._gameData) {
      openGameAssetsModal(wrap._gameData);
    } else {
      toast('Настройки запуска скоро');
    }
  });
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

function brandLogoHtml(kind, title, svgFallback) {
  // PNG из web/assets/controllers/{xbox,playstation,switch,keyboard}.png
  // Если файла нет — onerror покажет SVG-фолбэк
  const src = `assets/controllers/${kind}.png`;
  return `<span class="gp-ctrl-ico" title="${title}">
    <img class="gp-brand-logo gp-brand-logo--img" src="${src}" alt="${title}" width="28" height="28"
      onerror="this.onerror=null;this.style.display='none';const f=this.nextElementSibling;if(f)f.style.display='inline-flex';" />
    <span class="gp-brand-logo-fallback" style="display:none">${svgFallback}</span>
  </span>`;
}

function renderControllerSupport(raw) {
  const s = String(raw || '').toLowerCase();
  const hasX = /xbox|xinput/.test(s);
  const hasP = /playstation|dualshock|dualsense|ps4|ps5|\bps\b/.test(s);
  const hasSw = /switch|nintendo/.test(s);
  const hasKb = /keyboard|клавиатур|mouse|мышь/.test(s);
  const hasAny = hasX || hasP || hasSw || hasKb || (s && s !== 'none' && s !== '0');
  if (!hasAny && !s) {
    return `<div class="gp-ctrl-none">Нет данных о поддержке контроллера</div>`;
  }
  const full = /full|полная|complete/.test(s) || (hasX && hasP);
  const icoXboxSvg = `<svg class="gp-brand-logo" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4.102 21.033C6.211 22.881 8.977 24 12 24c3.026 0 5.792-1.119 7.898-2.967 1.877-1.912-4.356-9.104-7.899-9.104-3.54 0-9.776 7.193-7.897 9.104zm9.102-19.16c-.282-.408-.549-.645-.736-.766a1.036 1.036 0 0 0-.213-.105c.016.015.15.117.285.297.116.155.247.38.373.67L12 3.73l-.971-1.762c.126-.29.257-.515.373-.67.135-.18.269-.282.285-.297a1.036 1.036 0 0 0-.213.105c-.187.121-.454.358-.736.767C9.713 3.306 8.5 5.327 8.5 8.253c0 1.54.393 3.18 1.223 4.528.825 1.34 1.95 2.293 2.277 2.293s1.452-.953 2.277-2.293c.83-1.348 1.223-2.989 1.223-4.528 0-2.926-1.213-4.947-2.238-6.379z"/></svg>`;
  const icoPSSvg = `<svg class="gp-brand-logo" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.5 7.5v9.4l2.9 1.05V6.2c0-.7.32-1.15.8-1.15.53 0 .82.45.82 1.15v6.4c2.5 1.2 4.43 0 4.43-3.28 0-3.37-1.93-4.64-4.43-3.43V2.3C19.4 1.44 24 3.75 24 9.08c0 5.6-4.16 8.53-10 7.25V22.5L3.5 18.95V1.5L9.5 3.5v4zM3.5 14.2l4.4 1.55v2.15L3.5 16.4v-2.2zm13.2-1.85c1.35.55 2.05 1.45 2.05 2.7 0 1.7-1.15 2.75-3.15 2.05v-3.55c.4-.4.7-.8 1.1-1.2z"/></svg>`;
  const icons = [];
  if (hasX || (!hasP && !hasSw && !hasKb && hasAny)) icons.push(brandLogoHtml('xbox', 'Xbox', icoXboxSvg));
  if (hasP || (!hasX && !hasSw && !hasKb && hasAny)) icons.push(brandLogoHtml('playstation', 'PlayStation', icoPSSvg));
  if (hasSw) icons.push(brandLogoHtml('switch', 'Switch', icoXboxSvg));
  if (hasKb) icons.push(brandLogoHtml('keyboard', 'Клавиатура', icoXboxSvg));
  if (!icons.length) {
    icons.push(brandLogoHtml('xbox', 'Xbox', icoXboxSvg));
    icons.push(brandLogoHtml('playstation', 'PlayStation', icoPSSvg));
  }
  return `
    <div class="gp-ctrl-icons">
      ${icons.join('')}
    </div>
    <div class="gp-ctrl-badge ${full ? 'full' : 'partial'}">${full ? 'ПОЛНАЯ ПОДДЕРЖКА' : 'ЧАСТИЧНАЯ ПОДДЕРЖКА'}</div>
    <p class="gp-ctrl-note">${full ? 'Отлично работает с контроллерами Xbox и PlayStation.' : (escapeHtml(raw) || 'Поддержка контроллера заявлена.')}</p>`;
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

    // Shuffle — при каждой перезагрузке другой набор
    const shuffle = (arr) => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    let same = [];
    let other = list;
    if (game.genre) {
      same = shuffle(list.filter(g => g.genre === game.genre));
      other = shuffle(list.filter(g => g.genre !== game.genre));
    } else {
      other = shuffle(list);
    }
    list = [...same, ...other].slice(0, 4); // максимум 4

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
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Скачать`;
    btn.classList.add('owned');
    // disabled если нет сборок (ставится при рендере)
    if (note) note.textContent = '';
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
    if (btn.disabled || btn.classList.contains('is-disabled')) {
      toast('Нет файлов для скачивания');
      return;
    }
    if (g.owned) {
      // В библиотеке → сборки к загрузке
      const first = $('#game-builds .btn-download', wrap);
      if (first) first.click();
      else {
        const builds = $('#game-builds', wrap) || $('#gp-section-builds');
        if (builds) builds.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else toast('Нет доступных сборок');
      }
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
      sideLibAddOptimistic(g);
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
      <div class="submit-modal-box submit-modal-wide pub-modal-box" role="dialog" aria-modal="true">
        <div class="submit-modal-head pub-modal-head">
          <div>
            <h2>Редактирование карточки</h2>
            <p class="pub-modal-sub">Те же поля, что при публикации — изменения сразу видны всем</p>
          </div>
          <button type="button" class="pub-modal-close" id="admin-edit-close" aria-label="Закрыть">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="submit-modal-body pub-modal-body">
          <section class="pub-section">
            <div class="pub-section-head">
              <span class="pub-section-ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></span>
              <h3>Основное</h3>
            </div>
            <div class="submit-grid">
              <label class="settings-label"><span>Название</span><input class="auth-input" id="age-title" maxlength="120" /></label>
              <label class="settings-label"><span>Жанр</span>
                <select class="settings-select" id="age-genre">
                  <option value="">Выберите</option>
                  <option>Экшен</option><option>Приключения</option><option>RPG</option>
                  <option>Стратегия</option><option>Симулятор</option><option>Инди</option>
                  <option>Хоррор</option><option>Гонки</option><option>Спорт</option><option>Другое</option>
                </select>
              </label>
              <label class="settings-label"><span>Цена (₽)</span><input class="auth-input" id="age-price" type="number" min="0" step="1" /></label>
              <label class="settings-label"><span>Разработчик</span><input class="auth-input" id="age-developer" maxlength="120" /></label>
              <label class="settings-label full"><span>Краткое описание</span><input class="auth-input" id="age-short" maxlength="200" /></label>
              <label class="settings-label full"><span>Описание</span><textarea class="auth-input settings-textarea" id="age-desc" rows="5"></textarea></label>
            </div>
          </section>
          <section class="pub-section">
            <div class="pub-section-head">
              <span class="pub-section-ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></span>
              <h3>Медиа</h3>
            </div>
            <div class="submit-grid">
              <label class="settings-label"><span>Новая обложка</span><input type="file" id="age-cover" accept="image/*" /></label>
              <label class="settings-label"><span>Новый баннер</span><input type="file" id="age-banner" accept="image/*" /></label>
              <label class="settings-label full"><span>Видео URL</span><input class="auth-input" id="age-video" placeholder="https://youtube.com/..." /></label>
            </div>
          </section>
          <section class="pub-section">
            <div class="pub-section-head">
              <span class="pub-section-ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg></span>
              <h3>Системные требования</h3>
            </div>
            <div class="submit-grid">
              <div class="settings-label full" id="age-sys-min-fields">
                <span>Минимальные</span>
                <div class="sysreq-edit-grid" data-sys="min"></div>
              </div>
              <div class="settings-label full" id="age-sys-rec-fields">
                <span>Рекомендованные</span>
                <div class="sysreq-edit-grid" data-sys="rec"></div>
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
                <label class="settings-check"><input type="checkbox" value="xbox" class="age-ctrl" /> Xbox</label>
                <label class="settings-check"><input type="checkbox" value="playstation" class="age-ctrl" /> PlayStation</label>
                <label class="settings-check"><input type="checkbox" value="switch" class="age-ctrl" /> Switch</label>
                <label class="settings-check"><input type="checkbox" value="keyboard" class="age-ctrl" /> Клавиатура</label>
              </div>
            </div>
            <div class="settings-label full">
              <span>Языки</span>
              <div class="lang-table" id="age-lang-table">
                <div class="lang-table-head"><span>Язык</span><span>Субтитры</span><span>Аудио</span></div>
              </div>
            </div>
          </section>
          <section class="pub-section">
            <div class="pub-section-head">
              <span class="pub-section-ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
              <h3>Контент</h3>
            </div>
            <label class="settings-check"><input type="checkbox" id="age-adult" /> 18+ / для взрослых</label>
            <label class="settings-label full" style="margin-top:10px"><span>Заметка модератора</span><input class="auth-input" id="age-note" /></label>
          </section>
          <div id="age-error" class="gp-comment-error hidden" style="margin-top:12px"></div>
        </div>
        <div class="submit-modal-foot admin-edit-foot">
          <button type="button" class="btn-danger" id="age-delete">Удалить карточку</button>
          <div class="admin-edit-foot-right">
            <button type="button" class="hp-btn-edit" id="age-cancel">Отмена</button>
            <button type="button" class="hp-btn-edit" id="age-save">Сохранить</button>
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

  const ensureSysFields = (containerId) => {
    const box = document.querySelector(containerId);
    if (!box) return;
    // если уже есть input[data-k] — не трогаем
    if (box.querySelector('input[data-k]')) return;
    const keys = [
      ['os', 'ОС'], ['processor', 'Процессор'], ['memory', 'Оперативная память'],
      ['gpu', 'Видеокарта'], ['directx', 'DirectX'], ['storage', 'Место на диске'],
      ['sound', 'Звуковая карта'], ['other', 'Дополнительно'],
    ];
    const grid = box.querySelector('.sysreq-edit-grid') || box;
    grid.innerHTML = keys.map(([k, label]) =>
      `<input class="auth-input" data-k="${k}" placeholder="${label}" />`
    ).join('');
  };
  ensureSysFields('#age-sys-min-fields');
  ensureSysFields('#age-sys-rec-fields');

  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  setVal('age-title', g.title || '');
  setVal('age-price', g.price ?? 0);
  setVal('age-developer', g.developer_name || g.developer || '');
  setVal('age-short', g.short_description || '');
  setVal('age-desc', g.description || '');
  setVal('age-video', g.video_url || '');
  setVal('age-note', g.review_note || '');

  const genreSel = document.getElementById('age-genre');
  if (genreSel) {
    const gv = (g.genre || '').trim();
    let found = false;
    [...genreSel.options].forEach(o => {
      if (o.value === gv || o.textContent === gv) { o.selected = true; found = true; }
    });
    if (gv && !found) {
      const opt = document.createElement('option');
      opt.value = gv; opt.textContent = gv; opt.selected = true;
      genreSel.appendChild(opt);
    }
    try { initCatioSelects(modal); } catch (e) {}
  }

  try { fillSysReq('#age-sys-min-fields', g.sys_req_min); } catch (e) {}
  try { fillSysReq('#age-sys-rec-fields', g.sys_req_rec); } catch (e) {}
  try { renderLangTable('#age-lang-table', g.languages); } catch (e) {}

  const ctrls = String(g.controllers || '').toLowerCase().split(/[,;|\s]+/).filter(Boolean);
  modal.querySelectorAll('.age-ctrl').forEach(cb => {
    cb.checked = ctrls.includes(cb.value) || ctrls.some(c => c.includes(cb.value));
  });
  const adult = document.getElementById('age-adult');
  if (adult) adult.checked = !!(+g.is_adult);

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
      fd.append('developer', document.getElementById('age-developer')?.value || '');
      fd.append('short_description', document.getElementById('age-short')?.value || '');
      fd.append('description', document.getElementById('age-desc')?.value || '');
      fd.append('video_url', document.getElementById('age-video')?.value || '');
      fd.append('sys_req_min', JSON.stringify(collectSysReq('#age-sys-min-fields')));
      fd.append('sys_req_rec', JSON.stringify(collectSysReq('#age-sys-rec-fields')));
      fd.append('controllers', [...modal.querySelectorAll('.age-ctrl:checked')].map(c => c.value).join(','));
      fd.append('languages', JSON.stringify(collectLanguages('#age-lang-table')));
      fd.append('review_note', document.getElementById('age-note')?.value || '');
      fd.append('is_adult', document.getElementById('age-adult')?.checked ? '1' : '');
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
        toast('Сохранено для всех');
        modal.classList.add('hidden');
        homeCache = null;
        storeCache = [];
        window.__mediaBust = Date.now();
        window.__iconBust = window.__mediaBust;
        await loadGamePage(+id);
        refreshGameImagesEverywhere(+id);
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
        else if (typeof showView === 'function') showView('home');
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
  if (btn && viewer?.is_admin) {
    btn.addEventListener('click', () => openAdminGameEditModal(g));
  }
}

/** Открыть модалку оформления (как Hydra) для конкретной игры */
function openGameAssetsModal(g) {
  const modal = document.getElementById('steam-import-modal');
  if (!modal) {
    toast('Модалка не найдена');
    return;
  }
  let appId = parseInt(g.steam_appid, 10) || 0;
  if (!appId && g.slug) {
    const m = String(g.slug).match(/-s(\d{3,10})$/);
    if (m) appId = parseInt(m[1], 10);
  }
  if (!appId) {
    toast('У игры нет Steam AppID — SteamGridDB недоступен');
    return;
  }

  window.__steamEditMode = true;
  window.__steamEditGameId = Number(g.id);
  window.__steamAppId = appId;
  if (typeof window.setSteamAppId === 'function') window.setSteamAppId(appId);
  // сброс выбора при открытии
  try {
    const st = window.getSteamAssetState && window.getSteamAssetState();
    if (st && st.steamSelected) {
      st.steamSelected.icon_url = '';
      st.steamSelected.logo_url = '';
      st.steamSelected.banner_url = '';
      st.steamSelected.cover_url = '';
    }
  } catch (e) {}
  ['steam-sel-icon','steam-sel-logo','steam-sel-banner','steam-sel-cover'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const hint = document.getElementById('sgdb-asset-save-hint');
  if (hint) {
    hint.textContent = 'Выбери ассеты и нажми сохранить';
    hint.classList.remove('has-sel');
  }

  const title = document.getElementById('sgdb-modal-title');
  if (title) title.textContent = g.title || 'Игра';
  const it = document.getElementById('sgdb-info-title');
  if (it) it.textContent = g.title || '—';
  const ia = document.getElementById('sgdb-info-appid');
  if (ia) ia.textContent = String(appId);
  const iid = document.getElementById('sgdb-info-id');
  if (iid) iid.textContent = String(g.id);

  modal.querySelectorAll('.sgdb-nav-btn').forEach(b => {
    b.style.display = '';
    b.classList.toggle('active', b.dataset.sgdbTab === 'assets');
  });
  modal.querySelectorAll('.sgdb-pane').forEach(p => {
    p.classList.toggle('active', p.dataset.sgdbPane === 'assets');
  });
  modal.querySelectorAll('.sgdb-asset-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.assetType === 'icons');
  });

  // Предупреждение только обычным пользователям; админ меняет глобально для всех
  const warn = modal.querySelector('.sgdb-warn');
  if (warn) {
    const auth = window.AUTH_STATE || {};
    const u = auth.user || auth || {};
    const isAdmin = u.role === 'admin' || u.is_admin === true || u.is_admin === 1 || u.is_admin === '1'
      || auth.role === 'admin';
    warn.style.display = isAdmin ? 'none' : '';
  }

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => {
    if (typeof window.loadSgdbAssetsGlobal === 'function') window.loadSgdbAssetsGlobal('icons');
    else document.querySelector('.sgdb-asset-tab[data-asset-type="icons"]')?.click();
  }, 40);
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
  if (m < 1) return '0м';
  if (m < 60) return m + 'м';
  const h = Math.floor(m / 60);
  // только часы, без минут рядом
  return h + 'ч';
}

function gameCardHtml(g, { showPin = true } = {}) {
  const mins = parseInt(g.playtime_minutes, 10) || 0;
  const timeLabel = formatPlaytimeShort(mins);
  const pinned = !!+g.is_pinned;
  const achU = parseInt(g.ach_unlocked, 10) || 0;
  const achT = parseInt(g.ach_total, 10) || 0;
  const hasAch = achT > 0;
  const pct = hasAch ? Math.min(100, Math.round((achU / achT) * 100)) : 0;
  const achLeft = hasAch
    ? `<span class="hp-game-ach-count"><svg class="hp-game-ach-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h12v2a4 4 0 0 1-4 4h-1v2.26A6.5 6.5 0 0 1 16.5 20H15a3 3 0 0 0-6 0H7.5A6.5 6.5 0 0 1 11 12.26V10H10a4 4 0 0 1-4-4V4zm2 2v.5A2 2 0 0 0 10 8.5h4A2 2 0 0 0 16 6.5V6H8z"/></svg>${achU}/${achT}</span>`
    : `<span class="hp-game-ach-count muted">Нет ачивок</span>`;
  const cover = g.cover_src || g.cover_url || (`media.php?type=cover&id=${g.id}`);
  return `
    <div class="hp-game-card" data-id="${g.id}" data-title="${escapeHtml((g.title || '').toLowerCase())}">
      <img src="${escapeHtml(cover)}" alt="${escapeHtml(g.title)}" loading="lazy" />
      <span class="hp-game-time">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        ${escapeHtml(timeLabel)}
      </span>
      ${showPin ? `<button type="button" class="hp-game-pin ${pinned ? 'pinned' : ''}" data-id="${g.id}" data-pinned="${pinned ? 1 : 0}" title="${pinned ? 'Открепить' : 'Закрепить'}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="${pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
      </button>` : ''}
      <div class="hp-game-ach">
        <div class="hp-game-ach-row">
          ${achLeft}
          <span class="hp-game-ach-pct">${pct}%</span>
        </div>
        <div class="hp-game-ach-bar"><span style="width:${pct}%"></span></div>
      </div>
    </div>`;
}

function friendCodeBtnHtml(code, { compact = false } = {}) {
  const c = String(code || '').trim();
  if (!c) return '';
  return `<button type="button" class="friend-code-btn${compact ? ' is-compact' : ''}" data-code="${escapeHtml(c)}" title="Скопировать код друга">
    <svg class="friend-code-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
    <span class="friend-code-text">${escapeHtml(c)}</span>
  </button>`;
}

function bindFriendCodeButtons(root) {
  const nodes = root && root.querySelectorAll
    ? root.querySelectorAll('.friend-code-btn')
    : document.querySelectorAll('.friend-code-btn');
  nodes.forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const code = btn.dataset.code || '';
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        toast('Код друга скопирован');
      } catch (err) {
        const ta = document.createElement('textarea');
        ta.value = code;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); toast('Код друга скопирован'); } catch (e2) { toast(code); }
        ta.remove();
      }
    });
  });
}


function renderProfileFriendCode(code) {
  const name = $('#hp-username');
  if (!name) return;
  const info = $('#hp-user-info') || name.parentElement;
  if (!info) return;
  let row = info.querySelector('.hp-name-row');
  if (!row) {
    row = document.createElement('div');
    row.className = 'hp-name-row';
    name.parentNode.insertBefore(row, name);
    row.appendChild(name);
  }
  row.querySelectorAll('.friend-code-btn').forEach(el => el.remove());
  if (code) {
    row.insertAdjacentHTML('beforeend', friendCodeBtnHtml(code));
    bindFriendCodeButtons(row);
  }
}

function getMyFriendCode() {
  return (window.AUTH_STATE && window.AUTH_STATE.user && window.AUTH_STATE.user.friend_code) || '';
}

function initBottomBar() {
  const dl = document.getElementById('bottom-bar-dl');
  if (dl && !dl.dataset.bound) {
    dl.dataset.bound = '1';
    dl.addEventListener('click', () => {
      if (typeof showView === 'function') showView('downloads');
      else if (typeof gotoView === 'function') gotoView('downloads');
    });
  }
  updateBottomBarVersion();
}
function updateBottomBarVersion() {
  const el = document.querySelector('.bottom-bar-ver');
  if (!el) return;
  const code = getMyFriendCode();
  el.textContent = code ? `${code} — v0.0.1` : 'CATio — v0.0.1';
}

async function loadProfile() {
  viewingUserId = null;
  setTimeout(() => renderProfileFriendCode(getMyFriendCode()), 0);
  // restore own toolbar if was viewing foreign profile
  const toolbar = $('.hp-toolbar');
  if (toolbar && !toolbar.querySelector('#btn-edit-profile')) {
    toolbar.innerHTML = `
      <div class="hp-toolbar-spacer"></div>
      <button type="button" class="hp-btn-edit hp-btn-icon" id="btn-edit-profile" title="Редактировать профиль" aria-label="Редактировать профиль">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
      </button>
      <button type="button" class="hp-btn-logout" onclick="logout()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Выйти
      </button>`;
  }
  const upload = $('#hp-banner-upload');
  if (upload) upload.style.display = '';

  // Свежие данные с сервера (аватар, баннер, pos/zoom) — не из устаревшего AUTH_STATE
  try {
    const data = await fetchJSON(`${USER_API}?action=me`);
    if (data.ok && data.user) {
      window.AUTH_STATE = window.AUTH_STATE || {};
      window.AUTH_STATE.user = Object.assign({}, window.AUTH_STATE.user || {}, data.user);
    }
  } catch (err) {
    console.warn('profile me refresh failed', err);
  }

  const me = window.AUTH_STATE && window.AUTH_STATE.user;
  if (me) {
    applyUserBanner(me.banner_url || '', me.banner_pos || '50% 50%', me.banner_zoom || 1);
    applyUserAvatarEl($('#hp-avatar'), me);
    applyUserAvatarEl($('#side-avatar'), me);
    applyUserAvatarEl($('#settings-avatar-preview'), me);
    setProfileRoleBadge(me);
    const uname = $('#hp-username');
    if (uname) uname.textContent = me.username;
    if (typeof updateBalance === 'function' && me.balance != null) updateBalance(me.balance);
  }

  // статистика / библиотека / активность — параллельно после identity
  await Promise.all([
    loadProfileStats(),
    loadProfileActivity(),
    loadProfileFriends(),
    loadProfileLibrary(),
  ]);
  loadProfileReviews(null);
  initProfileControls();
}

async function loadProfileStats() {
  if (viewingUserId) return;
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
  if (viewingUserId) return;
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
  // Не трогаем чужой профиль
  if (viewingUserId) return;
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

let profileControlsInited = false;
function initProfileControls() {
  if (profileControlsInited) return;
  profileControlsInited = true;
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
      const card = btn.closest('.hp-side-card');
      if (!card) return;
      const collapsed = card.classList.toggle('is-collapsed');
      btn.textContent = collapsed ? '▾' : '▴';
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });
  });

  // --- Edit profile modal ---
  const modal = $('#hp-edit-modal');
  const openEdit = () => openAnimatedModal(modal);
  const closeEdit = () => closeAnimatedModal(modal);

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
        const sdn = $('#settings-display-name'); if (sdn) sdn.textContent = res.username;
        const sun = $('#settings-username'); if (sun) sun.value = res.username;
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
  const res = await fetch(`${USER_API}?action=upload`, { method: 'POST', body: fd });
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('Сервер вернул не JSON'); }
  if (!data.ok) throw new Error(data.error || 'Ошибка загрузки');
  const url = data.url + (String(data.url).includes('?') ? '&' : '?') + 't=' + Date.now();
  if (kind === 'avatar') {
    const applyAva = (el) => {
      if (!el) return;
      el.style.backgroundImage = `url('${url}')`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.style.backgroundColor = 'transparent';
      el.textContent = '';
    };
    applyAva($('#hp-avatar'));
    applyAva($('#hp-edit-avatar'));
    applyAva($('#side-avatar'));
    applyAva($('#avatar-btn'));
    applyAva($('#settings-avatar-preview'));
    if (window.AUTH_STATE && window.AUTH_STATE.user) {
      window.AUTH_STATE.user.avatar_url = data.url;
    }
    toast('Аватар обновлён');
  } else {
    applyBannerEverywhere(url, null, null);
    if (window.AUTH_STATE && window.AUTH_STATE.user) {
      window.AUTH_STATE.user.banner_url = data.url;
    }
    toast('Баннер обновлён');
  }
  return data;
}

/** Применить баннер на профиль + настройки + сайдбар */
function applyBannerEverywhere(url, pos, zoom) {
  if (url) {
    const bg = $('#hp-banner-bg');
    if (bg) {
      bg.style.backgroundImage = `url('${url}')`;
      bg.classList.add('has-image');
    }
    const setPrev = $('#settings-banner-preview');
    if (setPrev) {
      setPrev.style.backgroundImage = `url('${url}')`;
      setPrev.classList.add('has-image');
    }
    const cardBan = $('#settings-profile-card-banner');
    if (cardBan) {
      cardBan.style.backgroundImage = `url('${url}')`;
    }
  }
  if (pos != null || zoom != null) {
    const p = pos != null ? pos : (window.AUTH_STATE?.user?.banner_pos || '50% 50%');
    const z = zoom != null ? zoom : (parseFloat(window.AUTH_STATE?.user?.banner_zoom) || 1);
    applyBannerToHero(p, z);
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

let bannerEditorInited = false;
function initBannerEditor() {
  if (bannerEditorInited) return;
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
  bannerEditorInited = true;

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
    openAnimatedModal(modal);
  };

  const close = () => {
    closeAnimatedModal(modal);
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
      const box = preview.getBoundingClientRect();
      // % сдвига = пиксели / размер превью * 100 / zoom
      const sensX = (100 / Math.max(1, box.width)) / bannerEditor.zoom;
      const sensY = (100 / Math.max(1, box.height)) / bannerEditor.zoom;
      bannerEditor.posX = Math.max(0, Math.min(100, bannerEditor.posX - dx * sensX));
      bannerEditor.posY = Math.max(0, Math.min(100, bannerEditor.posY - dy * sensY));
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
      const label = saveBtn.textContent;
      saveBtn.disabled = true;
      saveBtn.classList.add('is-loading');
      saveBtn.textContent = 'Сохранение…';
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
        const z = res.zoom != null ? res.zoom : bannerEditor.zoom;
        applyBannerToHero(pos, z);
        // settings preview position too
        const setPrev = $('#settings-banner-preview');
        if (setPrev) {
          const size = z <= 1.01 ? 'cover' : (Math.round(z * 100) + '%');
          setPrev.style.backgroundPosition = pos;
          setPrev.style.backgroundSize = size;
        }
        if (window.AUTH_STATE?.user) {
          window.AUTH_STATE.user.banner_pos = pos;
          window.AUTH_STATE.user.banner_zoom = z;
        }
        toast('Баннер сохранён');
        close();
      } catch (err) {
        toast(err.message || 'Не удалось сохранить');
      } finally {
        saveBtn.disabled = false;
        saveBtn.classList.remove('is-loading');
        saveBtn.textContent = label || 'Сохранить';
      }
    });
  }
}

function applyBannerPreview() {
  const el = $('#hp-banner-preview-img');
  if (!el) return;
  const size = bannerEditor.zoom <= 1.01 ? 'cover' : (Math.round(bannerEditor.zoom * 100) + '%');
  const pos = `${bannerEditor.posX}% ${bannerEditor.posY}%`;
  el.style.setProperty('background-position', pos, 'important');
  el.style.setProperty('background-size', size, 'important');
  el.style.setProperty('background-repeat', 'no-repeat', 'important');
}

/** Применить позицию/зум баннера к hero — 1:1 как в превью */
function applyBannerToHero(pos, zoom) {
  const bg = $('#hp-banner-bg');
  if (!bg) return;
  const z = Math.max(1, Math.min(2.5, parseFloat(zoom) || 1));
  const size = z <= 1.01 ? 'cover' : (Math.round(z * 100) + '%');
  const p = pos || '50% 50%';
  bg.style.setProperty('background-position', p, 'important');
  bg.style.setProperty('background-size', size, 'important');
  bg.style.setProperty('background-repeat', 'no-repeat', 'important');
  bg.classList.add('has-image');
}

function applyUserBanner(url, pos, zoom) {
  const bg = $('#hp-banner-bg');
  if (bg) {
    if (url) {
      bg.style.setProperty('background-image', `url('${url}')`, 'important');
      bg.classList.add('has-image');
    } else {
      bg.style.removeProperty('background-image');
      bg.classList.remove('has-image');
    }
    applyBannerToHero(pos || '50% 50%', zoom != null ? zoom : 1);
  }
  // фон карточки в настройках
  const cardBan = $('#settings-profile-card-banner');
  if (cardBan && url) {
    const z = Math.max(1, Math.min(2.5, parseFloat(zoom) || 1));
    const size = z <= 1.01 ? 'cover' : (Math.round(z * 100) + '%');
    cardBan.style.backgroundImage = `url('${url}')`;
    cardBan.style.backgroundPosition = pos || '50% 50%';
    cardBan.style.backgroundSize = size;
  }
}



// ---------- Вкладка настроек ----------

// ---------- Тема (тёмная / светлая) ----------
function getTheme() {
  try {
    const t = localStorage.getItem('catio_theme');
    return t === 'light' ? 'light' : 'dark';
  } catch (e) {
    return 'dark';
  }
}

function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('catio_theme', t); } catch (e) {}
  // sync picker UI
  $$('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === t);
  });
}


// ---------- Custom select (красивые выпадающие списки) ----------

const SELECT_OPTION_ICONS = {
  // sort
  popular: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l2.4 7.2H22l-6 4.8 2.3 7L12 16.8 5.7 21 8 14 2 9.2h7.6z"/></svg>',
  new: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  rating: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l2.4 7.2H22l-6 4.8 2.3 7L12 16.8 5.7 21 8 14 2 9.2h7.6z"/></svg>',
  price: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  title: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h10M4 18h14"/></svg>',
  // platform-ish
  windows: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5.5l7.5-1v7H3V5.5zm8.5-1.2L21 3v8.5h-9.5V4.3zM3 12.5h7.5V20l-7.5-1v-6.5zm8.5 0H21V21l-9.5-1.3V12.5z"/></svg>',
  linux: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="3"/><path d="M6 19c1.5-3 3-4 6-4s4.5 1 6 4"/></svg>',
  mac: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3c2 0 3 1.5 3 3-1.5 0-3 0-3-3zm-2 18c-2 0-4-2-4-5 0-3 2-5 5-6 1-.3 2-.3 3 0 3 1 5 3 5 6 0 3-2 5-4 5-1 0-1.5-.5-2.5-.5S11 21 10 21z"/></svg>',
  all: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  // visibility
  public: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  friends: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  hidden: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-5 0-9.27-3-11-8a11.7 11.7 0 0 1 5.17-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c5 0 9.27 3 11 8a11.65 11.65 0 0 1-2.16 3.19"/><path d="M1 1l22 22"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>',
  // lang
  ru: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18"/></svg>',
  // library sorts fallback
  recent: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  name: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h10M4 18h14"/></svg>',
  playtime: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
};

function selectOptionIcon(value, label) {
  const v = String(value || '').toLowerCase().trim();
  const l = String(label || '').toLowerCase().trim();
  // пустой плейсхолдер («Выберите») — без иконки
  if (!v) return '';
  if (SELECT_OPTION_ICONS[v]) return SELECT_OPTION_ICONS[v];
  if (/windows|win/.test(v+l)) return SELECT_OPTION_ICONS.windows;
  if (/linux/.test(v+l)) return SELECT_OPTION_ICONS.linux;
  if (/mac|osx|darwin/.test(v+l)) return SELECT_OPTION_ICONS.mac;
  if (/популяр|popular/.test(l)) return SELECT_OPTION_ICONS.popular;
  if (/^нов|\bnew\b/.test(l)) return SELECT_OPTION_ICONS.new;
  if (/оцен|rating|star/.test(l)) return SELECT_OPTION_ICONS.rating;
  if (/цен[аеы]|price|₽|\$/.test(l)) return SELECT_OPTION_ICONS.price;
  if (/назван|title|^name$/.test(l) || v === 'title' || v === 'name') return SELECT_OPTION_ICONS.title;
  if (/друг|friend/.test(l)) return SELECT_OPTION_ICONS.friends;
  if (/скрыт|hidden|private/.test(l)) return SELECT_OPTION_ICONS.hidden;
  if (/всем|public|открыт/.test(l)) return SELECT_OPTION_ICONS.public;
  // жанры и прочее — без дефолтного кружка
  return '';
}

const CATIO_SELECT_CHEVRON = '<svg class="catio-select__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';


function openAnimatedModal(modal) {
  if (!modal) return;
  modal.classList.remove('is-closing', 'hidden');
  // reflow so enter transition plays
  void modal.offsetWidth;
}

function closeAnimatedModal(modal, ms = 220) {
  if (!modal || modal.classList.contains('hidden')) return;
  modal.classList.add('is-closing');
  window.setTimeout(() => {
    modal.classList.add('hidden');
    modal.classList.remove('is-closing');
  }, ms);
}

function enhanceSelect(sel) {
  if (!sel || sel.dataset.catioEnhanced === '1') return;
  if (sel.multiple || sel.size > 1) return;
  sel.dataset.catioEnhanced = '1';

  const wrap = document.createElement('div');
  wrap.className = 'catio-select';
  if (sel.className) wrap.className += ' ' + sel.className.replace(/\b(settings-select|sort-select|hp-select|auth-input)\b/g, '').trim();
  wrap.dataset.for = sel.id || '';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'catio-select__btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');

  const val = document.createElement('span');
  val.className = 'catio-select__value';
  btn.appendChild(val);
  btn.insertAdjacentHTML('beforeend', CATIO_SELECT_CHEVRON);

  const menu = document.createElement('div');
  menu.className = 'catio-select__menu';
  menu.setAttribute('role', 'listbox');

  const parent = sel.parentNode;
  parent.insertBefore(wrap, sel);
  wrap.appendChild(btn);
  wrap.appendChild(menu);
  wrap.appendChild(sel);
  sel.classList.add('select-native-hidden');
  sel.setAttribute('tabindex', '-1');
  sel.style.cssText = 'position:absolute!important;opacity:0!important;pointer-events:none!important;width:0!important;height:0!important;margin:0!important;padding:0!important;border:0!important;';

  const sync = () => {
    const opt = sel.options[sel.selectedIndex];
    if (opt) {
      const ico = selectOptionIcon(opt.value, opt.textContent);
      val.innerHTML = (ico ? `<span class=\"catio-select__ico\">${ico}</span>` : '') + `<span class=\"catio-select__txt\">${opt.textContent}</span>`;
    } else {
      val.textContent = '';
    }
    menu.querySelectorAll('.catio-select__option').forEach(o => {
      o.classList.toggle('is-active', o.dataset.value === sel.value);
    });
  };

  const rebuild = () => {
    menu.innerHTML = '';
    [...sel.options].forEach(opt => {
      if (opt.disabled && opt.value === '') return; // skip empty placeholder? keep all
      const o = document.createElement('button');
      o.type = 'button';
      o.className = 'catio-select__option' + (opt.selected ? ' is-active' : '');
      o.dataset.value = opt.value;
      const ico = selectOptionIcon(opt.value, opt.textContent);
      o.innerHTML = (ico ? `<span class="catio-select__ico">${ico}</span>` : '') + `<span class="catio-select__txt">${opt.textContent}</span>`;
      o.setAttribute('role', 'option');
      o.addEventListener('click', (e) => {
        e.stopPropagation();
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        sync();
        close();
      });
      menu.appendChild(o);
    });
    sync();
  };

  const positionMenu = () => {
    const rect = btn.getBoundingClientRect();
    const menuW = Math.max(rect.width, 168);
    let left = rect.left;
    if (left + menuW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - menuW - 8);
    menu.style.position = 'fixed';
    menu.style.left = left + 'px';
    menu.style.top = (rect.bottom + 6) + 'px';
    menu.style.width = menuW + 'px';
    menu.style.right = 'auto';
    menu.style.minWidth = menuW + 'px';
    menu.style.zIndex = '10000';
  };
  const open = () => {
    document.querySelectorAll('.catio-select.is-open').forEach(w => {
      if (w !== wrap) {
        w.classList.remove('is-open');
        const m = w.querySelector('.catio-select__menu');
        if (m) { m.style.position = ''; m.style.left = ''; m.style.top = ''; }
      }
    });
    positionMenu();
    wrap.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    wrap.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    menu.style.position = '';
    menu.style.left = '';
    menu.style.top = '';
    menu.style.width = '';
    menu.style.right = '';
  };

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (wrap.classList.contains('is-open')) close();
    else open();
  });
  // label не должен перехватывать клик
  const lab = wrap.closest('label');
  if (lab) {
    lab.addEventListener('click', (e) => {
      if (e.target.closest('.catio-select')) {
        e.preventDefault();
      }
    });
  }

  sel.addEventListener('change', sync);
  rebuild();

  // MutationObserver if options change
  const mo = new MutationObserver(rebuild);
  mo.observe(sel, { childList: true, subtree: true, attributes: true });
}

function initCatioSelects(root = document) {
  const nodes = root.querySelectorAll('select.settings-select, select.sort-select, select.hp-select, select#settings-lang, select#sort-select, select#library-sort, select#hp-sort, select#hp-platform, select#settings-profile-vis, select#settings-media-vis');
  nodes.forEach(enhanceSelect);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.catio-select')) {
    document.querySelectorAll('.catio-select.is-open').forEach(w => w.classList.remove('is-open'));
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.catio-select.is-open').forEach(w => {
      w.classList.remove('is-open');
    });
  }
});
window.addEventListener('scroll', (e) => {
  // скролл внутри самого меню не должен закрывать список
  const t = e.target;
  if (t && t.closest && t.closest('.catio-select__menu')) return;
  document.querySelectorAll('.catio-select.is-open').forEach(w => {
    const menu = w.querySelector('.catio-select__menu');
    if (menu && (t === menu || menu.contains(t))) return;
    w.classList.remove('is-open');
    if (menu) {
      menu.style.position = '';
      menu.style.left = '';
      menu.style.top = '';
      menu.style.width = '';
    }
  });
}, true);

// колесо внутри меню — не всплывает к window-scroll-closer
document.addEventListener('wheel', (e) => {
  if (e.target && e.target.closest && e.target.closest('.catio-select__menu')) {
    e.stopPropagation();
  }
}, true);


function moveSegIndicator(groupEl) {
  if (!groupEl) return;
  let ind = groupEl.querySelector('.seg-indicator');
  if (!ind) {
    ind = document.createElement('span');
    ind.className = 'seg-indicator';
    groupEl.prepend(ind);
  }
  const active = groupEl.querySelector('.store-era-btn.active, .price-pill.active, .seg-btn.active');
  if (!active) { ind.style.opacity = '0'; return; }
  ind.style.opacity = '1';
  ind.style.width = active.offsetWidth + 'px';
  ind.style.height = active.offsetHeight + 'px';
  ind.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
}

function initSegControls() {
  const groups = [
    document.querySelector('#view-store .catalogue-mode-toggle'),
    document.querySelector('#price-pills'),
  ].filter(Boolean);
  groups.forEach(g => {
    if (g.dataset.segInit === '1') {
      moveSegIndicator(g);
      return;
    }
    g.dataset.segInit = '1';
    g.classList.add('seg-control');
    g.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        requestAnimationFrame(() => moveSegIndicator(g));
        setTimeout(() => moveSegIndicator(g), 40);
      });
    });
  });
  const paint = () => groups.forEach(moveSegIndicator);
  paint();
  requestAnimationFrame(paint);
  setTimeout(paint, 50);
  setTimeout(paint, 200);
  window.addEventListener('resize', paint);
}

/** Пересчитать сегменты при открытии каталога */
function refreshStoreChrome() {
  try { initCatioSelects(document.getElementById('view-store') || document); } catch (e) {}
  try { initSegControls(); } catch (e) {}
  // force indicator after layout
  setTimeout(() => {
    document.querySelectorAll('#view-store .seg-control, #view-store .catalogue-mode-toggle, #price-pills').forEach(moveSegIndicator);
  }, 30);
}

function initThemePicker() {
  applyTheme(getTheme());
  $$('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.theme);
      toast(btn.dataset.theme === 'light' ? 'Светлая тема' : 'Тёмная тема');
    });
  });
}


function openProfileEditModal() {
  const modal = $('#hp-edit-modal');
  if (!modal) { toast('Модалка профиля не найдена'); return; }
  const me = window.AUTH_STATE && window.AUTH_STATE.user;
  const input = $('#hp-edit-displayname');
  if (input && me) input.value = me.username || '';
  // sync avatar preview in modal
  if (me && typeof applyUserAvatarEl === 'function') {
    applyUserAvatarEl($('#hp-edit-avatar'), me);
  }
  openAnimatedModal(modal);
}

function openBannerEditModal() {
  // ensure editor bound
  try { initBannerEditor(); } catch (e) {}
  const openBtn = $('#hp-banner-upload');
  if (openBtn) {
    openBtn.click();
    return;
  }
  const modal = $('#hp-banner-modal');
  if (!modal) { toast('Модалка баннера не найдена'); return; }
  // fallback open + preview
  const me = window.AUTH_STATE && window.AUTH_STATE.user;
  const previewImg = $('#hp-banner-preview-img');
  if (previewImg && me?.banner_url) {
    previewImg.style.backgroundImage = `url('${me.banner_url}')`;
  }
  if (typeof applyBannerPreview === 'function') {
    try {
      const pos = (me?.banner_pos || '50% 50%').split(/\s+/);
      if (typeof bannerEditor !== 'undefined') {
        bannerEditor.posX = parseFloat(pos[0]) || 50;
        bannerEditor.posY = parseFloat(pos[1]) || 50;
        bannerEditor.zoom = parseFloat(me?.banner_zoom) || 1;
        applyBannerPreview();
      }
    } catch (e) {}
  }
  openAnimatedModal(modal);
}

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

  // Профиль / баннер — модалки вне view-profile, открываются напрямую
  const openProfileEdit = $('#settings-open-profile-edit');
  if (openProfileEdit) {
    openProfileEdit.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openProfileEditModal();
    });
  }
  const openBannerEdit = $('#settings-open-banner-edit');
  if (openBannerEdit) {
    openBannerEdit.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openBannerEditModal();
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

  let menuClosing = false;
  function openMenu() {
    menuClosing = false;
    menu.classList.remove('hidden', 'is-closing');
    void menu.offsetWidth;
    menu.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
  }
  function closeMenu() {
    if (menu.classList.contains('hidden') || menuClosing) return;
    menuClosing = true;
    menu.classList.remove('is-open');
    menu.classList.add('is-closing');
    btn.setAttribute('aria-expanded', 'false');
    window.setTimeout(() => {
      menu.classList.add('hidden');
      menu.classList.remove('is-closing');
      menuClosing = false;
    }, 180);
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.classList.contains('hidden') || menu.classList.contains('is-closing')) openMenu();
    else closeMenu();
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
const ADMIN_API = 'api/admin.php';

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
  setFriendsAddMode(false);
  loadFriendsList();
  const menu = $('#user-menu');
  const btn = $('#avatar-btn');
  if (menu) menu.classList.add('hidden');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function closeFriendsModal() {
  const modal = $('#friends-modal');
  if (modal) modal.classList.add('hidden');
  const results = $('#friends-search-results');
  if (results) { results.classList.add('hidden'); results.innerHTML = ''; }
  const search = $('#friends-search');
  if (search) search.value = '';
  setFriendsAddMode(false);
}

let friendsSearchTimer = null;
let friendsListCache = null;
let friendsAddMode = false;
let friendsCodeUser = null;

function filterFriendsLocal(q) {
  const box = $('#friends-search-results');
  if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
  const query = (q || '').trim().toLowerCase();
  $$('.friends-row').forEach(row => {
    if (row.closest('#friends-search-results') || row.closest('#friends-code-found')) return;
    const name = (row.dataset.username || '').toLowerCase();
    row.style.display = (!query || name.includes(query)) ? '' : 'none';
  });
}

async function lookupFriendCode(code) {
  const found = $('#friends-code-found');
  const btnReq = $('#friends-code-request');
  const btnProf = $('#friends-code-profile');
  friendsCodeUser = null;
  if (btnReq) {
    btnReq.disabled = true;
    btnReq.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg> Отправить заявку`;
  }
  if (btnProf) btnProf.disabled = true;
  if (found) { found.classList.add('hidden'); found.innerHTML = ''; }

  const q = String(code || '').trim();
  if (q.length < 2) return;

  try {
    const data = await fetchJSON(`${FRIENDS_API}?action=search&q=${encodeURIComponent(q)}`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    let u = (data.users || []).find(x => String(x.friend_code || '').toLowerCase() === q.toLowerCase());
    if (!u && (data.users || []).length === 1) u = data.users[0];
    if (!u) {
      if (found) {
        found.innerHTML = '<div class="friends-empty" style="padding:8px 0">Никого не найдено</div>';
        found.classList.remove('hidden');
      }
      return;
    }
    friendsCodeUser = u;
    if (found) {
      found.innerHTML = `
        <div class="friends-row-avatar" style="${friendAvatarStyle(u)}">${friendAvatarText(u)}</div>
        <div class="friends-row-info">
          <div class="friends-row-name">${escapeHtml(u.username)}</div>
          <div class="friends-row-status">${u.is_online ? 'В сети' : 'Не в сети'}${u.friend_code ? ' · ' + escapeHtml(u.friend_code) : ''}</div>
        </div>`;
      found.classList.remove('hidden');
    }
    if (btnProf) btnProf.disabled = false;
    if (btnReq) {
      const rel = u.relation || 'none';
      if (rel === 'friends') {
        btnReq.textContent = 'Уже в друзьях';
        btnReq.disabled = true;
      } else if (rel === 'outgoing') {
        btnReq.textContent = 'Заявка отправлена';
        btnReq.disabled = true;
      } else {
        btnReq.disabled = false;
      }
    }
  } catch (err) {
    toast(err.message || 'Ошибка поиска');
  }
}

async function searchFriends(q) {
  if (friendsAddMode) await lookupFriendCode(q);
  else filterFriendsLocal(q);
}

function setFriendsAddMode(on) {
  friendsAddMode = !!on;
  const btn = $('#friends-add-btn');
  const input = $('#friends-search');
  const panel = $('#friends-code-panel');
  const results = $('#friends-search-results');
  if (btn) {
    btn.classList.toggle('is-active', friendsAddMode);
    btn.setAttribute('aria-pressed', friendsAddMode ? 'true' : 'false');
  }
  if (input) {
    input.placeholder = friendsAddMode ? 'Введите код друга' : 'Поиск друзей';
    if (!friendsAddMode) input.value = '';
  }
  if (panel) panel.classList.toggle('hidden', !friendsAddMode);
  if (results) { results.classList.add('hidden'); results.innerHTML = ''; }
  friendsCodeUser = null;
  const found = $('#friends-code-found');
  if (found) { found.classList.add('hidden'); found.innerHTML = ''; }
  const btnReq = $('#friends-code-request');
  const btnProf = $('#friends-code-profile');
  if (btnReq) {
    btnReq.disabled = true;
    btnReq.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg> Отправить заявку`;
  }
  if (btnProf) btnProf.disabled = true;
  filterFriendsLocal('');
  if (friendsAddMode && input) setTimeout(() => input.focus(), 30);
}

async function loadFriendsList() {
  try {
    const data = await fetchJSON(`${FRIENDS_API}?action=list`);
    friendsListCache = data;
    if (!data.ok) throw new Error(data.error || 'Ошибка');

    const meBox = $('#friends-me');
    if (meBox && data.me) {
      const me = data.me;
      if (me.friend_code && window.AUTH_STATE?.user) window.AUTH_STATE.user.friend_code = me.friend_code;
      updateBottomBarVersion();
      meBox.innerHTML = `
        <div class="friends-me-avatar" style="${friendAvatarStyle(me)}">
          ${friendAvatarText(me)}
          <span class="online-dot"></span>
        </div>
        <div class="friends-me-info">
          <div class="friends-me-name-row">
            <div class="friends-me-name">${escapeHtml(me.username)}</div>
            ${friendCodeBtnHtml(me.friend_code || getMyFriendCode())}
          </div>
          <div class="friends-me-status">В сети</div>
        </div>`;
      bindFriendCodeButtons(meBox);
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
        } else if (mode === 'online' || mode === 'offline') {
          actions = `
            <button type="button" class="friends-icon-btn" data-act="message" data-id="${u.id}" data-username="${escapeHtml(u.username)}" title="Написать">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </button>`;
        } else {
          actions = `
            <button type="button" class="friends-icon-btn" data-act="profile" data-id="${u.id}" data-username="${escapeHtml(u.username)}" title="Профиль">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
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

    const online = (data.online || data.friends || []).filter(u => u.is_online);
    const offline = (data.friends || []).filter(u => !u.is_online);
    // if API marks none online, still show all friends under offline
    const onlineList = online.length ? online : [];
    const offlineList = offline.length ? offline : (data.friends || []).filter(u => !onlineList.find(o => o.id === u.id));

    const onCount = $('#friends-online-count');
    const offCount = $('#friends-offline-count');
    if (onCount) onCount.textContent = onlineList.length;
    if (offCount) offCount.textContent = offlineList.length;
    renderList($('#friends-online'), onlineList, 'online');
    renderList($('#friends-offline'), offlineList, 'offline');

    // re-apply local filter if any
    if (!friendsAddMode) {
      const q = $('#friends-search')?.value || '';
      if (q.trim()) filterFriendsLocal(q);
    }
  } catch (err) {
    toast(err.message || 'Не удалось загрузить друзей');
  }
}

function initFriendsUI() {
  $$('.menu-friends-btn').forEach(btn => {
    btn.addEventListener('click', () => openFriendsModal());
  });
  function openNotificationsPage() {
    $$('#user-menu').forEach(m => m.classList.add('hidden'));
    $$('#avatar-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
    gotoView('notifications');
  }
  $$('#menu-notifications, .menu-notifications-btn').forEach(btn => {
    btn.addEventListener('click', openNotificationsPage);
  });
  const bottomDl = $('#bottom-dl-btn');
  if (bottomDl) bottomDl.addEventListener('click', () => gotoView('downloads'));

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
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && friendsAddMode) {
        e.preventDefault();
        lookupFriendCode(search.value.trim());
      }
    });
  }

  const addBtn = $('#friends-add-btn');
  if (addBtn) addBtn.addEventListener('click', () => setFriendsAddMode(!friendsAddMode));

  $('#friends-code-request')?.addEventListener('click', async () => {
    if (!friendsCodeUser) return;
    try {
      const res = await postJSON(`${FRIENDS_API}?action=request`, { user_id: friendsCodeUser.id });
      if (!res.ok) throw new Error(res.error || 'Ошибка');
      toast('Заявка отправлена');
      lookupFriendCode($('#friends-search')?.value || '');
      loadFriendsList();
    } catch (err) {
      toast(err.message || 'Ошибка');
    }
  });
  $('#friends-code-profile')?.addEventListener('click', () => {
    if (!friendsCodeUser) return;
    openUserProfile(friendsCodeUser.username, friendsCodeUser.id);
  });

  $$('.friends-section-toggle').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('open'));
  });
}

// ---------- Просмотр чужого профиля ----------
let viewingUserId = null;


function renderForeignLibraryOnly(library) {
  profileLibraryCache = library || [];
  const pinned = profileLibraryCache.filter(g => +g.is_pinned);
  const rest = profileLibraryCache.filter(g => !+g.is_pinned);
  const pinnedBox = $('#hp-pinned-games');
  const pinnedSection = $('#hp-pinned-section');
  const pinnedCount = $('#hp-pinned-count');
  if (pinnedBox) {
    if (!pinned.length) {
      if (pinnedSection) pinnedSection.style.display = 'none';
      pinnedBox.innerHTML = '';
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
}

async function loadProfileReviews(userId) {
  const pane = $('#hp-pane-reviews');
  if (!pane) return;
  pane.innerHTML = '<div class="loading">Загрузка отзывов...</div>';
  try {
    const url = userId
      ? `${FRIENDS_API}?action=user_comments&user_id=${userId}`
      : `${USER_API}?action=my_comments`;
    const data = await fetchJSON(url);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const list = data.comments || [];
    if (!list.length) {
      pane.innerHTML = '<div class="hp-empty">Пока нет отзывов</div>';
      return;
    }
    // Та же структура, что у комментариев на странице игры
    pane.innerHTML = `<div class="gp-comments-list hp-profile-reviews">${list.map(c => {
      const hasCustomAv = !!c.avatar_url;
      const avStyle = hasCustomAv
        ? `background-image:url('${escapeHtml(avatarUrlBust(c.avatar_url, c.user_id))}');background-size:cover;background-position:center;`
        : (c.avatar_color ? `background:${escapeHtml(c.avatar_color)}` : '');
      const uname = c.username || 'Игрок';
      const rating = c.rating != null && c.rating !== '' ? c.rating : null;
      const gameTitle = c.game_title || 'Игра';
      const cover = c.cover_src || c.cover_url || ('media.php?type=cover&id=' + c.game_id);
      const banner = c.banner_url || c.profile_banner || '';
      const bannerStyle = banner
        ? `background-image:url('${escapeHtml(avatarUrlBust(banner, c.user_id))}');`
        : '';
      const showBanner = !!banner;
      const timeStr = c.created_at
        ? (typeof formatRelative === 'function' ? formatRelative(c.created_at) : formatDateTime(c.created_at))
        : '';
      return `
      <div class="gp-review ${showBanner ? 'has-banner' : ''}" data-id="${c.id}">
        <div class="gp-review-main" style="flex-direction:column;gap:10px">
          <div class="gp-review-headcard ${showBanner ? 'with-banner' : ''}">
            ${showBanner ? `<div class="gp-review-banner" style="${bannerStyle}"></div>` : ''}
            <div class="gp-review-headcard-inner">
              <div class="gp-review-av ${hasCustomAv ? 'has-img' : 'is-placeholder'}" style="${avStyle}">
                ${hasCustomAv ? '' : escapeHtml((uname || '?').slice(0, 1).toUpperCase())}
              </div>
              <div class="gp-review-userblock">
                <div class="gp-review-name-row">
                  <span class="gp-review-name">${escapeHtml(uname)}</span>
                </div>
                <div class="gp-review-meta-row">
                  ${rating != null ? `<span class="gp-review-score">★ ${escapeHtml(String(rating))}/5</span>` : ''}
                </div>
              </div>
              <span class="gp-review-time">${escapeHtml(timeStr)}</span>
            </div>
          </div>
          <div class="gp-review-content">
            <div class="gp-review-text">${escapeHtml(c.body || '')}</div>
            <button type="button" class="hp-rev-game" data-id="${c.game_id}" style="margin-top:8px">
              <img src="${escapeHtml(cover)}" alt="" loading="lazy" onerror="this.style.display='none'" />
              <span>к игре «${escapeHtml(gameTitle)}»</span>
            </button>
          </div>
        </div>
      </div>`;
    }).join('')}</div>`;
    $$('.hp-rev-game', pane).forEach(btn => {
      btn.addEventListener('click', () => gotoGame(btn.dataset.id));
    });
  } catch (err) {
    pane.innerHTML = `<div class="hp-empty">${escapeHtml(err.message || 'Не удалось загрузить')}</div>`;
  }
}

async function openUserProfile(username, id) {
  closeFriendsModal();
  // сразу показываем профиль в состоянии загрузки — без чужих/своих старых данных
  viewingUserId = id || -1;
  showView('profile', null, { foreign: true });
  setProfileLoadingShell(true);
  try {
    const q = id ? `id=${id}` : `username=${encodeURIComponent(username)}`;
    const data = await fetchJSON(`${FRIENDS_API}?action=profile&${q}`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const p = data.profile;

    // own profile → normal
    if (p.relation === 'self') {
      viewingUserId = null;
      setProfileLoadingShell(false);
      gotoView('profile');
      return;
    }

    viewingUserId = p.id;
    const isAdmin = !!(data.viewer_is_admin || (window.AUTH_STATE && window.AUTH_STATE.user && (window.AUTH_STATE.user.role === 'admin' || window.AUTH_STATE.user.is_admin)));
    renderForeignProfile(p, data.library || [], isAdmin);
    setProfileLoadingShell(false);
    const libSnapshot = data.library || [];
    setTimeout(() => {
      if (viewingUserId === p.id) {
        renderForeignLibraryOnly(libSnapshot);
      }
    }, 50);
  } catch (err) {
    setProfileLoadingShell(false);
    viewingUserId = null;
    toast(err.message || 'Не удалось открыть профиль');
  }
}

function setProfileLoadingShell(on) {
  const page = $('.hydra-profile') || $('#view-profile');
  if (page) page.classList.toggle('is-loading', !!on);
  if (on) {
    const uname = $('#hp-username');
    if (uname) uname.textContent = 'Загрузка…';
    const lib = $('#hp-library-games') || $('#profile-library');
    if (lib) lib.innerHTML = '<div class="loading">Загрузка профиля…</div>';
  }
}

function renderForeignProfile(p, library, viewerIsAdmin) {
  // banner — те же pos/zoom что сохранил пользователь
  applyUserBanner(p.banner_url || '', p.banner_pos || '50% 50%', p.banner_zoom || 1);
  if (!p.banner_url) {
    const bg = $('#hp-banner-bg');
    if (bg) {
      bg.style.removeProperty('background-image');
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
  renderProfileFriendCode(p.friend_code || '');
  setProfileRoleBadge(p);

  // hide own-only controls
  const upload = $('#hp-banner-upload');
  if (upload) upload.style.display = 'none';
  const toolbar = $('.hp-toolbar');
  if (toolbar) {
    const authUser = window.AUTH_STATE && window.AUTH_STATE.user;
    const isAdm = !!(viewerIsAdmin
      || (authUser && (authUser.role === 'admin' || authUser.is_admin === true || authUser.is_admin === 1)));
    const adminBtn = isAdm
      ? `<button type="button" class="hp-btn-edit hp-btn-icon" id="hp-admin-edit-user" title="Редактировать" aria-label="Редактировать"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>`
      : '';
    // Админ-кнопка ОТДЕЛЬНО от friend-actions — иначе innerHTML друзей её стирает
    toolbar.innerHTML = `
      <div class="hp-toolbar-spacer"></div>
      ${adminBtn}
      <div class="hp-friend-actions" id="hp-friend-actions"></div>`;
    if (isAdm) {
      $('#hp-admin-edit-user')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openAdminUserModal(p);
      });
    }
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
          <button type="button" class="hp-btn-logout hp-btn-icon" id="hp-remove-friend" title="Удалить из друзей" aria-label="Удалить из друзей">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
          </button>
          <button type="button" class="hp-btn-edit" id="hp-msg-friend">Написать</button>`;
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
  loadProfileReviews(p.id);
  renderForeignLibraryOnly(library);
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
    input.placeholder = `Сообщение ${username || ''}…`.trim();
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
    if (hint) {
      const online = !!(peer && peer.is_online);
      hint.classList.toggle('hidden', online);
      if (!online && peer) {
        hint.textContent = `${peer.username} не в сети — увидит сообщения позже.`;
      }
    }

    renderChatMessages(data.messages || []);
  } catch (err) {
    if (!silent) toast(err.message || 'Не удалось загрузить переписку');
  }
}

function chatCoverUrl(gameId) {
  const id = String(gameId || '').replace(/[^0-9]/g, '');
  if (!id) return '';
  // сначала из кэша библиотеки / стора
  try {
    const pools = [];
    if (typeof libraryCache !== 'undefined' && Array.isArray(libraryCache)) pools.push(...libraryCache);
    if (typeof storeCache !== 'undefined' && Array.isArray(storeCache)) pools.push(...storeCache);
    if (typeof homeCache !== 'undefined' && homeCache) {
      pools.push(...(homeCache.featured || []), ...(homeCache.games || []));
    }
    const g = pools.find(x => String(x.id) === id);
    if (g) {
      const u = g.cover_src || g.cover_url || g.icon_url || g.banner_url;
      if (u) return resolveChatImageUrl(u);
    }
  } catch (e) {}
  return resolveChatImageUrl('media.php?type=cover&id=' + id);
}

function resolveChatImageUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) return url;
  url = url.replace(/^\/+/, '');
  try {
    // абсолютный URL от текущей страницы (важно для webview)
    return new URL(url, window.location.href).href;
  } catch (e) {
    return url;
  }
}

function renderChatMessages(messages) {
  const box = $('#chat-messages');
  if (!box) return;
  const peerName = ($('#chat-peer-name')?.textContent || 'другу').trim();
  if (!messages.length) {
    box.innerHTML = `
      <div class="chat-empty" id="chat-empty">
        <div class="chat-empty-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
        <div class="chat-empty-title">Пока нет сообщений</div>
        <div class="chat-empty-sub">Напишите ${escapeHtml(peerName)}</div>
      </div>`;
    return;
  }
  const wasBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;

  box.innerHTML = messages.map(m => {
    const time = formatDateTime(m.created_at);
    const cls = m.mine ? 'mine' : 'theirs';
    const body = String(m.body || '').trim();

    // ---- IMAGE / DRAWING ----
    const imgMatch = body.match(/^\[image\](.+)$/i);
    if (imgMatch || body.startsWith('[image]')) {
      const raw = imgMatch ? imgMatch[1].trim() : body.slice(7).trim();
      const url = resolveChatImageUrl(raw);
      return `<div class="chat-attach ${cls}" data-type="image">
        <div class="chat-attach-media">
          ${url
            ? `<img src="${escapeHtml(url)}" alt="Изображение" loading="lazy" class="chat-attach-img" data-fallback="1" />`
            : `<div class="chat-attach-broken">🖼 Нет файла</div>`}
        </div>
        <div class="chat-attach-foot"><span>Изображение</span><span class="chat-attach-time">${escapeHtml(time)}</span></div>
      </div>`;
    }

    // ---- GAME SHARE ----
    const gameMatch = body.match(/^\[game:(\d+)\](.*)$/i);
    if (gameMatch) {
      const gid = gameMatch[1];
      const title = (gameMatch[2] || '').trim() || 'Игра';
      const cover = chatCoverUrl(gid);
      return `<div class="chat-attach ${cls}" data-type="game">
        <button type="button" class="chat-attach-game" data-game-id="${escapeHtml(gid)}">
          <span class="chat-attach-game-cover">
            ${cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" onerror="this.remove()" />` : ''}
          </span>
          <span class="chat-attach-game-info">
            <span class="chat-attach-game-title">${escapeHtml(title)}</span>
            <span class="chat-attach-game-sub">Игра · открыть</span>
          </span>
        </button>
        <div class="chat-attach-foot"><span></span><span class="chat-attach-time">${escapeHtml(time)}</span></div>
      </div>`;
    }

    // ---- TEXT ----
    return `<div class="chat-bubble ${cls}">${escapeHtml(body)}<span class="chat-bubble-time">${escapeHtml(time)}</span></div>`;
  }).join('');

  $$('.chat-attach-game', box).forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const id = el.dataset.gameId;
      if (id) gotoGame(id);
    });
  });
  // images: error fallback + click
  $$('.chat-attach-img', box).forEach(img => {
    img.addEventListener('error', () => {
      const broken = document.createElement('div');
      broken.className = 'chat-attach-broken';
      broken.textContent = '🖼 Файл недоступен';
      img.replaceWith(broken);
    });
    img.addEventListener('click', () => {
      try {
        if (typeof openLightbox === 'function') openLightbox(img.src);
        else window.open(img.src, '_blank');
      } catch (e) {
        window.open(img.src, '_blank');
      }
    });
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
    const notifN = data.notifications || 0;
    const reqN = data.requests || 0;

    $$('.friends-menu-badge').forEach(el => {
      const n = reqN || 0;
      if (n > 0) {
        el.textContent = n > 99 ? '99+' : String(n);
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    });

    $$('.notif-menu-badge').forEach(el => {
      if (notifN > 0) {
        el.textContent = notifN > 99 ? '99+' : String(notifN);
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    });

    const tabBadge = $('#notif-tab-badge');
    if (tabBadge) {
      const n = notifN + reqN;
      if (n > 0) {
        tabBadge.textContent = String(n);
        tabBadge.classList.remove('hidden');
      } else {
        tabBadge.classList.add('hidden');
      }
    }

    const dot = $('#side-avatar-dot');
    if (dot) {
      if (total > 0) dot.classList.add('visible');
      else dot.classList.remove('visible');
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
        <div class="notif-page-empty">
          <div class="notif-page-empty-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div>
          <div class="notif-page-empty-title">Нет уведомлений</div>
          <div class="notif-page-empty-sub">Вы в курсе всех событий! Загляните позже за новыми обновлениями.</div>
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
        silentRenderGuard = false;
        await loadChatThread();
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
        silentRenderGuard = false;
        await loadChatThread();
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
    list.innerHTML = games.map(g => {
      const cov = g.cover_src || g.cover_url || ('media.php?type=cover&id=' + g.id);
      return `<button type="button" class="chat-game-pick-item" data-id="${g.id}" data-title="${escapeHtml(g.title)}">
        <img src="${escapeHtml(cov)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
        <span>${escapeHtml(g.title)}</span>
      </button>`;
    }).join('');
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

const LANG_NAME_RU = {
  'english': 'английский',
  'russian': 'русский',
  'ukrainian': 'украинский',
  'belarusian': 'белорусский',
  'japanese': 'японский',
  'korean': 'корейский',
  'chinese': 'китайский',
  'simplified chinese': 'китайский (упр.)',
  'traditional chinese': 'китайский (трад.)',
  'schinese': 'китайский (упр.)',
  'tchinese': 'китайский (трад.)',
  'french': 'французский',
  'german': 'немецкий',
  'italian': 'итальянский',
  'spanish': 'испанский',
  'spanish - spain': 'испанский — Испания',
  'spanish - latin america': 'испанский — Латам',
  'latam': 'испанский — Латам',
  'portuguese': 'португальский',
  'portuguese - brazil': 'португальский — Бразилия',
  'portuguese-brazil': 'португальский — Бразилия',
  'brazilian': 'португальский — Бразилия',
  'polish': 'польский',
  'turkish': 'турецкий',
  'arabic': 'арабский',
  'thai': 'тайский',
  'vietnamese': 'вьетнамский',
  'indonesian': 'индонезийский',
  'dutch': 'нидерландский',
  'czech': 'чешский',
  'hungarian': 'венгерский',
  'romanian': 'румынский',
  'swedish': 'шведский',
  'norwegian': 'норвежский',
  'danish': 'датский',
  'finnish': 'финский',
  'greek': 'греческий',
  'bulgarian': 'болгарский',
  'hindi': 'хинди',
};
function localizeLangName(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  const key = n.toLowerCase().replace(/\s+/g, ' ');
  if (LANG_NAME_RU[key]) return LANG_NAME_RU[key];
  for (const [en, ru] of Object.entries(LANG_NAME_RU)) {
    if (key.includes(en)) return ru;
  }
  if (/[а-яё]/i.test(n)) return n;
  return n;
}

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

const PUB_PRICE_MIN = 0;
const PUB_PRICE_MAX = 15000;

function initPublishFilePreviews(root = document) {
  const bindOne = (inputId, previewId, nameId) => {
    const input = root.querySelector('#' + inputId) || document.getElementById(inputId);
    if (!input || input.dataset.previewBound) return;
    input.dataset.previewBound = '1';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      const prev = document.getElementById(previewId);
      const nameEl = document.getElementById(nameId);
      if (!file) {
        if (prev) { prev.style.backgroundImage = ''; prev.classList.remove('has-img'); }
        if (nameEl) nameEl.textContent = nameEl.dataset.placeholder || '';
        return;
      }
      if (nameEl) nameEl.textContent = file.name;
      if (prev && file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        prev.style.backgroundImage = `url('${url}')`;
        prev.classList.add('has-img');
      }
    });
  };
  bindOne('sg-cover', 'sg-cover-preview', 'sg-cover-name');
  bindOne('sg-banner', 'sg-banner-preview', 'sg-banner-name');
  bindOne('sg-logo', 'sg-logo-preview', 'sg-logo-name');
  bindOne('sg-icon', 'sg-icon-preview', 'sg-icon-name');

  const shots = document.getElementById('sg-shots');
  if (shots && !shots.dataset.previewBound) {
    shots.dataset.previewBound = '1';
    shots.addEventListener('change', () => {
      const box = document.getElementById('sg-shots-preview');
      if (!box) return;
      box.innerHTML = '';
      [...(shots.files || [])].slice(0, 8).forEach(f => {
        if (!f.type.startsWith('image/')) return;
        const d = document.createElement('div');
        d.className = 'pub-shot-thumb';
        d.style.backgroundImage = `url('${URL.createObjectURL(f)}')`;
        box.appendChild(d);
      });
    });
  }
}

function initPublishPriceInput() {
  const price = document.getElementById('sg-price');
  if (!price || price.dataset.priceBound) return;
  price.dataset.priceBound = '1';
  const sanitize = () => {
    let v = String(price.value || '').replace(/[^\d]/g, '');
    if (v.length > 1) v = v.replace(/^0+/, '') || '0';
    let n = parseInt(v || '0', 10);
    if (Number.isNaN(n)) n = 0;
    if (n > PUB_PRICE_MAX) n = PUB_PRICE_MAX;
    if (n < PUB_PRICE_MIN) n = PUB_PRICE_MIN;
    price.value = String(n);
  };
  price.addEventListener('input', () => {
    price.value = String(price.value || '').replace(/[^\d]/g, '');
  });
  price.addEventListener('blur', sanitize);
  price.addEventListener('change', sanitize);
}

function validatePublishForm() {
  const title = ($('#sg-title')?.value || '').trim();
  if (title.length < 2) return 'Укажите название игры (минимум 2 символа)';
  const genre = ($('#sg-genre')?.value || '').trim();
  if (!genre) return 'Выберите жанр';
  const desc = ($('#sg-desc')?.value || '').trim();
  if (desc.length < 20) return 'Описание слишком короткое (минимум 20 символов)';
  let price = parseInt(String($('#sg-price')?.value || '0').replace(/[^\d]/g, ''), 10);
  if (Number.isNaN(price)) price = 0;
  if (price < PUB_PRICE_MIN) return `Цена не может быть меньше ${PUB_PRICE_MIN} ₽`;
  if (price > PUB_PRICE_MAX) return `Цена не может быть больше ${PUB_PRICE_MAX} ₽`;
  const cover = $('#sg-cover')?.files?.[0];
  const coverUrl = $('#sg-cover-url')?.value;
  if (!cover && !coverUrl) return 'Добавьте обложку';
  return null;
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
  sel.forEach(r => {
    const n = r && (r.name || r.lang || r.language);
    if (n) map[n] = r;
  });
  box.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'lang-table-head';
  head.innerHTML = '<span>Язык</span><span>Субтитры</span><span>Аудио</span>';
  box.appendChild(head);
  const body = document.createElement('div');
  body.className = 'lang-table-body';
  (GAME_LANGS || []).forEach(name => {
    const r = map[name] || {};
    const row = document.createElement('div');
    row.className = 'lang-table-row';
    row.innerHTML = `
      <span class="lang-table-name">${escapeHtml(name)}</span>
      <label class="lang-table-cell"><input type="checkbox" data-lang="${escapeHtml(name)}" data-kind="sub" ${r.subtitles ? 'checked' : ''} /></label>
      <label class="lang-table-cell"><input type="checkbox" data-lang="${escapeHtml(name)}" data-kind="audio" ${r.audio ? 'checked' : ''} /></label>`;
    body.appendChild(row);
  });
  box.appendChild(body);
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
  if (Array.isArray(raw)) {
    return raw.map(normalizeLangRow).filter(r => r && r.name);
  }
  let s = String(raw).trim();
  // двойное экранирование / HTML-entities
  if (s.includes('&quot;') || s.includes('&#')) {
    const ta = document.createElement('textarea');
    ta.innerHTML = s;
    s = ta.value;
  }
  // попытка JSON
  const tryParse = (str) => {
    try {
      const j = JSON.parse(str);
      if (Array.isArray(j)) return j.map(normalizeLangRow).filter(r => r && r.name);
      if (j && typeof j === 'object' && j.name) return [normalizeLangRow(j)];
    } catch (e) {}
    return null;
  };
  let parsed = tryParse(s);
  if (parsed) return parsed;
  // обрезанный JSON (VARCHAR 255) — вытащим целые объекты {"name":"..."}
  const objs = [];
  const re = /\{\s*"name"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"subtitles"\s*:\s*(true|false)\s*,\s*"audio"\s*:\s*(true|false)\s*\}/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    objs.push({ name: m[1].replace(/\\"/g, '"'), subtitles: m[2] === 'true', audio: m[3] === 'true' });
  }
  if (objs.length) return objs;
  // legacy: "English, French*, German"
  return s.split(/[,;]+/).map(part => {
    const full = part.includes('*');
    const name = part.replace(/\*/g, '').trim();
    if (!name || name.length > 80 || name.startsWith('{') || name.startsWith('"')) return null;
    return { name, subtitles: true, audio: full };
  }).filter(Boolean);
}
function normalizeLangRow(r) {
  if (!r) return null;
  if (typeof r === 'string') return { name: localizeLangName(r), subtitles: true, audio: false };
  const name = localizeLangName(String(r.name || r.lang || r.language || '').trim());
  if (!name) return null;
  return {
    name,
    subtitles: !!(r.subtitles ?? r.subs ?? true),
    audio: !!(r.audio ?? r.full_audio ?? false),
  };
}

/** Описание игры: если есть HTML (img/video/iframe) — санитизируем; иначе — абзацы из текста */
function formatGameDescription(raw) {
  let text = String(raw || '').trim() || 'Описание отсутствует.';
  // markdown leftover **bold** → strong
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  if (!/<[a-z][\s\S]*>/i.test(text)) {
    return text.split(/\n+/).map(p => `<p>${escapeHtml(p)}</p>`).join('');
  }

  const allowed = new Set(['P','BR','IMG','VIDEO','SOURCE','IFRAME','A','B','STRONG','I','EM','U','UL','OL','LI','H1','H2','H3','H4','H5','SPAN','DIV','TABLE','THEAD','TBODY','TR','TH','TD','HR']);
  const tmp = document.createElement('div');
  tmp.innerHTML = text;

  const walk = (node) => {
    [...node.childNodes].forEach(ch => {
      if (ch.nodeType === 1) {
        if (!allowed.has(ch.tagName)) {
          while (ch.firstChild) node.insertBefore(ch.firstChild, ch);
          node.removeChild(ch);
          return;
        }
        [...ch.attributes].forEach(attr => {
          const n = attr.name.toLowerCase();
          if (n.startsWith('on') || n === 'style' || n === 'srcdoc' || n === 'class') ch.removeAttribute(attr.name);
        });
        if (ch.tagName === 'A') {
          const href = ch.getAttribute('href') || '';
          if (!/^https?:\/\//i.test(href)) ch.removeAttribute('href');
          else {
            ch.setAttribute('target', '_blank');
            ch.setAttribute('rel', 'noopener noreferrer');
          }
        }
        if (ch.tagName === 'IMG') {
          const src = ch.getAttribute('src') || '';
          if (!/^https?:\/\//i.test(src)) { node.removeChild(ch); return; }
          ch.setAttribute('loading', 'lazy');
          ch.setAttribute('referrerpolicy', 'no-referrer');
          ch.removeAttribute('width');
          ch.removeAttribute('height');
        }
        if (ch.tagName === 'IFRAME') {
          const src = ch.getAttribute('src') || '';
          if (!/^https?:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|player\.vimeo\.com)\//i.test(src)) {
            node.removeChild(ch); return;
          }
          ch.setAttribute('loading', 'lazy');
          ch.setAttribute('allowfullscreen', '');
          ch.setAttribute('referrerpolicy', 'no-referrer');
        }
        if (ch.tagName === 'VIDEO') {
          ch.removeAttribute('controls');
          ch.setAttribute('autoplay', '');
          ch.setAttribute('muted', '');
          ch.setAttribute('loop', '');
          ch.setAttribute('playsinline', '');
          ch.setAttribute('preload', 'auto');
          ch.muted = true;
        }
        walk(ch);
      }
    });
  };
  walk(tmp);

  // группируем подряд идущие IMG в ряды (Steam: 2 в ряд / 1 на всю ширину)
  const groupImages = (parent) => {
    const kids = [...parent.childNodes];
    let buf = [];
    const flush = () => {
      if (!buf.length) return;
      const wrap = document.createElement('div');
      if (buf.length === 1) wrap.className = 'gp-desc-img-row gp-desc-img-row--1';
      else if (buf.length >= 3) wrap.className = 'gp-desc-img-row gp-desc-img-row--3';
      else wrap.className = 'gp-desc-img-row';
      parent.insertBefore(wrap, buf[0]);
      buf.forEach(img => wrap.appendChild(img));
      buf = [];
    };
    kids.forEach(ch => {
      if (ch.nodeType === 1 && ch.tagName === 'IMG') {
        buf.push(ch);
      } else if (ch.nodeType === 1 && ch.tagName === 'BR' && buf.length) {
        try { parent.removeChild(ch); } catch (e) {}
      } else {
        flush();
        if (ch.nodeType === 1) groupImages(ch);
      }
    });
    flush();
  };
  groupImages(tmp);

  tmp.querySelectorAll('video').forEach(v => {
    v.classList.add('gp-desc-video');
    v.muted = true;
  });
  tmp.querySelectorAll('iframe').forEach(f => {
    let src = f.getAttribute('src') || '';
    if (/youtube\.com|youtube-nocookie\.com/i.test(src)) {
      try {
        const u = new URL(src, 'https://www.youtube.com');
        u.searchParams.set('autoplay', '1');
        u.searchParams.set('mute', '1');
        u.searchParams.set('controls', '0');
        u.searchParams.set('modestbranding', '1');
        u.searchParams.set('rel', '0');
        u.searchParams.set('playsinline', '1');
        const id = u.pathname.split('/').pop();
        if (id) { u.searchParams.set('loop', '1'); u.searchParams.set('playlist', id); }
        f.setAttribute('src', u.toString());
        f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
      } catch (e) {}
    }
  });

  return tmp.innerHTML || `<p>${escapeHtml(text)}</p>`;
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
      <td class="${r.subtitles ? 'ok' : 'no'}">${r.subtitles ? '<svg class="lang-ico lang-ico--ok" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>' : '<svg class="lang-ico lang-ico--no" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>'}</td>
      <td class="${r.audio ? 'ok' : 'no'}">${r.audio ? '<svg class="lang-ico lang-ico--ok" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>' : '<svg class="lang-ico lang-ico--no" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>'}</td>
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
        const fillBtn = $('#sg-steam-fill');
        if (fillBtn && !fillBtn.dataset.bound) {
          fillBtn.dataset.bound = '1';
          fillBtn.addEventListener('click', fillSubmitFromSteam);
        }
        try { initCatioSelects(formModal); } catch (e) {}
        try { initPublishFilePreviews(formModal); initPublishPriceInput(); } catch (e) {}
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


async function fillSubmitFromSteam() {
  const input = $('#sg-steam-url');
  const btn = $('#sg-steam-fill');
  const raw = (input?.value || '').trim();
  if (!raw) { toast('Вставь ссылку Steam или AppID'); return; }
  let appid = raw;
  const m = raw.match(/store\.steampowered\.com\/app\/(\d+)/i) || raw.match(/\/app\/(\d+)/) || raw.match(/^(\d+)$/);
  if (m) appid = m[1];
  if (btn) { btn.disabled = true; btn.textContent = 'Загрузка…'; }
  try {
    const data = await fetchJSON(`api/steam_import.php?action=preview&appid=${encodeURIComponent(appid)}`);
    if (!data.ok) throw new Error(data.error || 'Не удалось получить данные Steam');
    const g = data.game || data.preview || data;
    if ($('#sg-title') && g.title) $('#sg-title').value = g.title;
    if ($('#sg-short') && (g.short_description || g.short_desc)) $('#sg-short').value = g.short_description || g.short_desc;
    if ($('#sg-desc') && (g.description || g.about)) $('#sg-desc').value = g.description || g.about;
    if ($('#sg-developer') && (g.developer || g.developers)) {
      const d = g.developer || (Array.isArray(g.developers) ? g.developers.join(', ') : g.developers);
      $('#sg-developer').value = d || '';
    }
    if ($('#sg-genre') && g.genre) {
      const genreSel = $('#sg-genre');
      const gstr = String(g.genre).split(/[,/]/)[0].trim();
      const opt = [...genreSel.options].find(o => o.value === gstr || o.textContent === gstr);
      if (opt) genreSel.value = opt.value;
      else { genreSel.value = 'Другое'; }
    }
    if ($('#sg-price') && g.price != null) $('#sg-price').value = parseFloat(g.price) || 0;
    if ($('#sg-cover-url') && (g.cover_url || g.header_image)) $('#sg-cover-url').value = g.cover_url || g.header_image;
    if ($('#sg-banner-url') && (g.banner_url || g.header_image)) $('#sg-banner-url').value = g.banner_url || g.header_image;
    // sys req minimal if object
    const fillSys = (boxId, obj) => {
      const box = $(boxId);
      if (!box || !obj) return;
      $$('input[data-k]', box).forEach(inp => {
        const k = inp.dataset.k;
        if (obj[k]) inp.value = obj[k];
      });
    };
    fillSys('#sg-sys-min-fields', g.pc_requirements_min || g.sys_min || g.requirements_min);
    fillSys('#sg-sys-rec-fields', g.pc_requirements_rec || g.sys_rec || g.requirements_rec);
    toast('Данные Steam подставлены — проверь и дополни');
  } catch (err) {
    toast(err.message || 'Ошибка Steam');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Подтянуть'; }
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
    const err = validatePublishForm();
    if (err) throw new Error(err);
    const fd = new FormData();
    fd.append('csrf_token', window.CSRF_TOKEN || '');
    fd.append('title', $('#sg-title')?.value?.trim() || '');
    fd.append('genre', $('#sg-genre')?.value || '');
    fd.append('price', String(parseInt(String($('#sg-price')?.value || '0').replace(/[^\d]/g, ''), 10) || 0));
    fd.append('short_description', $('#sg-short')?.value || '');
    fd.append('description', $('#sg-desc')?.value || '');
    fd.append('video_url', $('#sg-video')?.value || '');
    fd.append('developer', $('#sg-developer')?.value || '');
    if ($('#sg-cover-url')?.value) fd.append('cover_url', $('#sg-cover-url').value);
    if ($('#sg-banner-url')?.value) fd.append('banner_url', $('#sg-banner-url').value);
    fd.append('sys_req_min', JSON.stringify(collectSysReq('#sg-sys-min-fields')));
    fd.append('sys_req_rec', JSON.stringify(collectSysReq('#sg-sys-rec-fields')));
    fd.append('languages', JSON.stringify(collectLanguages('#sg-lang-table')));
    const ctrls = $$('.sg-ctrl').filter(c => c.checked).map(c => c.value).join(',');
    fd.append('controllers', ctrls);
    const cover = $('#sg-cover')?.files?.[0];
    if (cover) fd.append('cover', cover);
    const banner = $('#sg-banner')?.files?.[0];
    if (banner) fd.append('banner', banner);
    const logo = $('#sg-logo')?.files?.[0];
    if (logo) fd.append('logo', logo);
    const icon = $('#sg-icon')?.files?.[0];
    if (icon) fd.append('icon', icon);
    const shots = $('#sg-shots')?.files;
    if (shots) for (let i = 0; i < shots.length; i++) fd.append('screenshots[]', shots[i]);
    const flags = $$('.sg-content-flag').filter(c => c.checked).map(c => c.value);
    fd.append('content_flags', flags.join(','));
    fd.append('is_adult', flags.includes('adult') ? '1' : '0');

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
      if (tab === 'users') loadAdminUsers();
    });
  });

  const showErr = (msg) => {
    const el = $('#steam-import-error');
    if (!el) return;
    if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.textContent = msg;
    el.classList.remove('hidden');
  };

  let steamPreviewData = null;
  let steamSelected = { icon_url: '', logo_url: '', banner_url: '', cover_url: '' };
  let steamAppId = 0;
  let sgdbCache = {}; // type -> assets[]
  let sgdbCurrentType = 'icons';
  // expose for game-page gear
  window.getSteamAssetState = () => ({ steamAppId, steamSelected, sgdbCache, steamPreviewData });
  window.setSteamAppId = (id) => { steamAppId = id; sgdbCache = {}; };
  window.loadSgdbAssetsGlobal = (t) => loadSgdbAssets(t || 'icons');
  window.openSteamModal = openSteamModal;
  window.closeSteamModal = closeSteamModal;


  function openSteamModal() {
    if (typeof resetSteamModalToImportMode === 'function') resetSteamModalToImportMode();
    const m = $('#steam-import-modal');
    if (!m) return;
    // import mode defaults
    $$('.sgdb-nav-btn', m).forEach(b => {
      b.style.display = '';
      b.classList.toggle('active', b.dataset.sgdbTab === 'main');
    });
    $$('.sgdb-pane', m).forEach(p => p.classList.toggle('active', p.dataset.sgdbPane === 'main'));
    m.classList.remove('hidden');
    m.setAttribute('aria-hidden', 'false');
  }
  function closeSteamModal() {
    const m = $('#steam-import-modal');
    if (!m) return;
    m.classList.add('hidden');
    m.setAttribute('aria-hidden', 'true');
    if (typeof resetSteamModalToImportMode === 'function') resetSteamModalToImportMode();
  
  window.__steamEditMode = false;
  window.__steamEditGameId = null;
}
  // admin uses inline form; modal only from game gear
  //   $('#steam-open-modal-btn')?.addEventListener('click', openSteamModal);

  // ===== Классический импорт в админке (без модалки) =====
  (function initAdminSteamInline() {
    const previewBtn = $('#steam-preview-admin-btn');
    const importBtn = $('#steam-import-admin-btn');
    if (!previewBtn && !importBtn) return;
    const showErr = (msg) => {
      const el = $('#steam-import-error');
      if (!el) return;
      if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
      el.textContent = msg;
      el.classList.remove('hidden');
    };
    previewBtn?.addEventListener('click', async () => {
      const url = ($('#steam-url-admin')?.value || '').trim();
      showErr('');
      const box = $('#steam-preview-admin');
      box?.classList.add('hidden');
      if (!url) { showErr('Вставь ссылку или AppID'); return; }
      previewBtn.disabled = true;
      previewBtn.textContent = 'Загрузка...';
      try {
        const raw = await fetchJSON(`${STEAM_API}?action=preview&url=${encodeURIComponent(url)}`, { timeout: FETCH_TIMEOUT_LONG });
        if (!raw.ok) throw new Error(raw.error || 'Ошибка');
        const data = { ...raw, ...(raw.preview || {}) };
        window.__adminSteamPreview = data;
        const banner = $('#steam-preview-admin-banner');
        const cover = $('#steam-preview-admin-cover');
        if (banner) banner.src = data.banner_url || data.header_image || data.cover_url || data.library_image || '';
        if (cover) cover.src = data.cover_url || data.library_image || data.capsule_image || data.header_image || '';
        const t = $('#steam-preview-admin-title');
        if (t) t.textContent = data.title || '';
        const m = $('#steam-preview-admin-meta');
        if (m) m.textContent = [data.developers || data.developer, data.publishers || data.publisher, data.release_date].filter(Boolean).join(' · ');
        const s = $('#steam-preview-admin-short');
        if (s) s.textContent = (data.short_description || '').slice(0, 280);
        box?.classList.remove('hidden');
      } catch (e) {
        showErr(e.message || 'Не удалось загрузить');
      } finally {
        previewBtn.disabled = false;
        previewBtn.textContent = 'Проверить';
      }
    });
    importBtn?.addEventListener('click', async () => {
      const url = ($('#steam-url-admin')?.value || '').trim();
      showErr('');
      if (!url) { showErr('Вставь ссылку или AppID'); return; }
      importBtn.disabled = true;
      importBtn.textContent = 'Импорт...';
      try {
        const data = await postJSON(`${STEAM_API}?action=import`, {
          url,
          publish: $('#steam-publish-admin')?.checked ? 1 : 0,
        }, FETCH_TIMEOUT_LONG);
        if (!data.ok) throw new Error(data.error || 'Ошибка импорта');
        toast('Игра импортирована' + (data.title ? ': ' + data.title : ''));
        if (data.game_id && typeof loadGamePage === 'function') {
          // optional
        }
        if (typeof loadSideLibrary === 'function') loadSideLibrary();
        showErr('');
      } catch (e) {
        showErr(e.message || 'Ошибка импорта');
      } finally {
        importBtn.disabled = false;
        importBtn.textContent = 'Импортировать в CATio';
      }
    });
  })();

  document.querySelectorAll('[data-close-steam-modal]').forEach(el => {
    el.addEventListener('click', closeSteamModal);
  });

  // side nav tabs
  $$('.sgdb-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.sgdbTab;
      $$('.sgdb-nav-btn').forEach(b => b.classList.toggle('active', b === btn));
      $$('.sgdb-pane').forEach(p => p.classList.toggle('active', p.dataset.sgdbPane === tab));
      if (tab === 'assets' && steamAppId) loadSgdbAssets(sgdbCurrentType);
    });
  });

  // asset subtabs
  $$('.sgdb-asset-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.assetType;
      sgdbCurrentType = t;
      $$('.sgdb-asset-tab').forEach(b => b.classList.toggle('active', b === btn));
      loadSgdbAssets(t);
    });
  });

  function setSgdbPreview(url, type) {
    const wrap = $('#sgdb-asset-preview');
    const img = $('#sgdb-asset-preview-img');
    if (img) img.src = url || '';
    if (wrap) {
      wrap.classList.remove('is-hero', 'is-grid', 'is-logo');
      if (type === 'heroes') wrap.classList.add('is-hero');
      if (type === 'grids') wrap.classList.add('is-grid');
      if (type === 'logos') wrap.classList.add('is-logo');
    }
  }

  function selectSgdbAsset(url, type) {
    if (type === 'icons') {
      steamSelected.icon_url = url;
      $('#steam-sel-icon').value = url;
    } else if (type === 'logos') {
      steamSelected.logo_url = url;
      $('#steam-sel-logo').value = url;
    } else if (type === 'heroes') {
      steamSelected.banner_url = url;
      $('#steam-sel-banner').value = url;
    } else if (type === 'grids') {
      steamSelected.cover_url = url;
      $('#steam-sel-cover').value = url;
    }
    setSgdbPreview(url, type);
    updateSgdbSaveHint();
  }

  function updateSgdbSaveHint() {
    const hint = $('#sgdb-asset-save-hint');
    if (!hint) return;
    const parts = [];
    if (steamSelected.icon_url) parts.push('иконка');
    if (steamSelected.logo_url) parts.push('логотип');
    if (steamSelected.banner_url) parts.push('баннер');
    if (steamSelected.cover_url) parts.push('обложка');
    if (!parts.length) {
      hint.textContent = 'Выбери ассеты и нажми сохранить';
      hint.classList.remove('has-sel');
    } else {
      hint.textContent = 'Выбрано: ' + parts.join(', ');
      hint.classList.add('has-sel');
    }
  }

  /** Сохранить выбранные ассеты на сервер (игра уже в каталоге) */
  async function applyGameAssetNow(gameId, type, url) {
    if (!gameId || !url) return null;
    const payload = { game_id: gameId, csrf_token: window.CSRF_TOKEN || '' };
    if (type === 'icons' || type === 'icon') payload.icon_url = url;
    else if (type === 'logos' || type === 'logo') payload.logo_url = url;
    else if (type === 'heroes' || type === 'banner') payload.banner_url = url;
    else if (type === 'grids' || type === 'cover') payload.cover_url = url;
    else return null;
    const res = await postJSON(`${STEAM_API}?action=update_assets`, payload, FETCH_TIMEOUT_LONG);
    if (!res.ok) throw new Error(res.error || 'Не удалось сохранить ассет');
    return res;
  }

  async function saveSelectedGameAssets() {
    const gameId = Number(window.__steamEditGameId || 0);
    if (!gameId) {
      toast('Сначала открой настройки с страницы игры');
      return;
    }
    const payload = {
      game_id: gameId,
      csrf_token: window.CSRF_TOKEN || '',
      icon_url: steamSelected.icon_url || $('#steam-sel-icon')?.value || '',
      logo_url: steamSelected.logo_url || $('#steam-sel-logo')?.value || '',
      banner_url: steamSelected.banner_url || $('#steam-sel-banner')?.value || '',
      cover_url: steamSelected.cover_url || $('#steam-sel-cover')?.value || '',
    };
    if (!payload.icon_url && !payload.logo_url && !payload.banner_url && !payload.cover_url) {
      toast('Ничего не выбрано');
      return;
    }
    const btn = $('#sgdb-asset-save');
    const old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Сохранение…'; }
    try {
      const res = await postJSON(`${STEAM_API}?action=update_assets`, payload, FETCH_TIMEOUT_LONG);
      if (!res.ok) throw new Error(res.error || 'Ошибка сохранения');
      window.__mediaBust = Date.now();
      window.__iconBust = window.__mediaBust;
      homeCache = null;
      storeCache = [];
      toast('Ассеты сохранены');
      if (typeof refreshGameImagesEverywhere === 'function') {
        refreshGameImagesEverywhere(gameId);
      }
      // обновить страницу игры, если открыта
      if (typeof loadGamePage === 'function') {
        try { await loadGamePage(gameId); } catch (e) {}
      }
      if (typeof loadSideLibrary === 'function') {
        try { loadSideLibrary(); } catch (e) {}
      }
      closeSteamModal();
    } catch (err) {
      toast(err.message || 'Не удалось сохранить');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = old || 'Сохранить'; }
    }
  }

  // кнопка Сохранить в модалке ассетов
  $('#sgdb-asset-save')?.addEventListener('click', () => {
    saveSelectedGameAssets();
  });
  // expose
  window.applyGameAssetNow = applyGameAssetNow;
  window.saveSelectedGameAssets = saveSelectedGameAssets;

  async function loadSgdbAssets(type) {
    const grid = $('#sgdb-asset-grid');
    if (!grid) return;
    if (!steamAppId && window.__steamAppId) steamAppId = +window.__steamAppId;
    if (!steamAppId) {
      grid.innerHTML = '<div class="settings-hint">Сначала загрузи игру во вкладке «Основные»</div>';
      return;
    }
    grid.className = 'sgdb-asset-grid is-' + type;
    if (sgdbCache[type]) {
      renderSgdbGrid(sgdbCache[type], type);
      return;
    }
    grid.innerHTML = '<div class="loading">Загрузка SteamGridDB...</div>';
    try {
      const data = await fetchJSON(`${API_BASE}?action=sgdb_assets&appid=${steamAppId}&type=${encodeURIComponent(type)}`, { timeout: FETCH_TIMEOUT_LONG });
      if (!data.ok) {
        grid.innerHTML = `<div class="settings-hint">${escapeHtml(data.error || 'Ошибка SGDB')}</div>`;
        // fallback: steam CDN options from preview
        if (steamPreviewData) {
          const fb = [];
          if (type === 'icons' && steamPreviewData.icon_options) fb.push(...steamPreviewData.icon_options.map(u => ({ url: u, thumb: u })));
          if (type === 'grids' && steamPreviewData.cover_options) fb.push(...steamPreviewData.cover_options.map(u => ({ url: u, thumb: u })));
          if (type === 'heroes' && steamPreviewData.banner_options) fb.push(...steamPreviewData.banner_options.map(u => ({ url: u, thumb: u })));
          if (fb.length) renderSgdbGrid(fb, type);
        }
        return;
      }
      sgdbCache[type] = data.assets || [];
      renderSgdbGrid(sgdbCache[type], type);
    } catch (e) {
      grid.innerHTML = `<div class="settings-hint">${escapeHtml(e.message || 'Ошибка')}</div>`;
    }
  }

  function renderSgdbGrid(list, type) {
    const grid = $('#sgdb-asset-grid');
    if (!grid) return;
    if (!list.length) {
      grid.innerHTML = '<div class="settings-hint">Ничего не найдено</div>';
      return;
    }
    const selected =
      type === 'icons' ? steamSelected.icon_url :
      type === 'logos' ? steamSelected.logo_url :
      type === 'heroes' ? steamSelected.banner_url :
      steamSelected.cover_url;
    grid.innerHTML = list.map(a => {
      const u = a.url || a.thumb;
      const th = a.thumb || a.url;
      return `<button type="button" class="sgdb-grid-item is-${type}${u === selected ? ' selected' : ''}" data-url="${escapeHtml(u)}">
        <img src="${escapeHtml(th)}" alt="" loading="lazy" onerror="this.parentElement.style.opacity=0.3" />
      </button>`;
    }).join('');
    $$('.sgdb-grid-item', grid).forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.sgdb-grid-item', grid).forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectSgdbAsset(btn.dataset.url, type);
      });
    });
    // auto preview first/selected
    const cur = selected || (list[0] && (list[0].url || list[0].thumb));
    if (cur) setSgdbPreview(cur, type);
  }

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
      steamPreviewData = p;
      steamAppId = p.appid || 0;
      sgdbCache = {};
      steamSelected = {
        icon_url: (p.icon_options && p.icon_options[0]) || p.library_image || '',
        logo_url: '',
        banner_url: (p.banner_options && p.banner_options[0]) || p.header_image || '',
        cover_url: (p.cover_options && p.cover_options[0]) || p.capsule_image || '',
      };
      const banner = $('#steam-preview-banner');
      const cover = $('#steam-preview-cover');
      if (banner) banner.src = steamSelected.banner_url;
      if (cover) cover.src = steamSelected.cover_url;
      const title = $('#steam-preview-title');
      if (title) title.textContent = p.title || '';
      const mt = $('#sgdb-modal-title');
      if (mt && p.title) mt.textContent = p.title;
      const meta = $('#steam-preview-meta');
      if (meta) meta.textContent = [p.developer, p.genre, p.release_date, p.is_free ? 'Бесплатно' : ''].filter(Boolean).join(' · ');
      const short = $('#steam-preview-short');
      if (short) short.textContent = p.short_description || '';
      const shots = $('#steam-preview-shots');
      if (shots) {
        shots.innerHTML = (p.screenshots || []).slice(0, 12).map(src =>
          `<img src="${escapeHtml(src)}" alt="" loading="lazy" />`
        ).join('') || '<span class="settings-hint">Нет скриншотов</span>';
      }
      const vids = $('#steam-preview-videos');
      if (vids) {
        const movies = p.movies || [];
        vids.innerHTML = movies.length ? movies.map(m => `
          <div class="steam-vid">
            <img src="${escapeHtml(m.thumbnail || '')}" alt="" />
            <span>${escapeHtml(m.name || 'Трейлер')}</span>
          </div>`).join('') : '<span class="settings-hint">Нет видео</span>';
      }
      const achs = $('#steam-preview-achs');
      const achCount = $('#steam-ach-count');
      const alist = p.achievements || [];
      if (achCount) achCount.textContent = alist.length ? `(${alist.length})` : '';
      if (achs) {
        achs.innerHTML = alist.length ? alist.slice(0, 12).map(a => `
          <div class="steam-ach-row">
            ${a.icon_url ? `<img src="${escapeHtml(a.icon_url)}" alt="" />` : ''}
            <span class="n">${escapeHtml(a.display_name || '')}</span>
            <span class="p">${a.percent ? (Number(a.percent).toFixed(1) + '%') : ''}</span>
          </div>`).join('') : '<span class="settings-hint">Нет ачивок</span>';
      }
      $('#steam-preview')?.classList.remove('hidden');
      toast('Данные Steam получены');
    } catch (e) {
      showErr(e.message || 'Не удалось получить данные');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Загрузить'; }
    }
  });

  $('#steam-import-btn')?.addEventListener('click', async () => {
    const btn = $('#steam-import-btn');
    const isEdit = btn && btn.dataset.mode === 'edit' && window.__steamEditGameId;
    showErr('');
    if (!isEdit) {
      const url = ($('#steam-url')?.value || '').trim();
      if (!url) { showErr('Вставь ссылку или AppID'); return; }
    }
    if (btn) { btn.disabled = true; btn.textContent = isEdit ? 'Сохранение...' : 'Импорт...'; }
    try {
      if (isEdit) {
        const data = await postJSON(`${API_BASE}?action=update_assets`, {
          game_id: window.__steamEditGameId,
          icon_url: steamSelected.icon_url || $('#steam-sel-icon')?.value || '',
          cover_url: steamSelected.cover_url || $('#steam-sel-cover')?.value || '',
          banner_url: steamSelected.banner_url || $('#steam-sel-banner')?.value || '',
          logo_url: steamSelected.logo_url || $('#steam-sel-logo')?.value || '',
        }, FETCH_TIMEOUT_LONG);
        if (!data.ok) throw new Error(data.error || 'Ошибка сохранения');
        toast('Ассеты сохранены');
        closeSteamModal();
        window.__steamEditGameId = null;
        if (btn) { btn.dataset.mode = ''; btn.textContent = 'Импортировать'; }
        // refresh game page / side lib
        if (typeof loadSideLibrary === 'function') loadSideLibrary();
        const gid = data.game_id;
        if (gid && typeof loadGamePage === 'function') loadGamePage(gid);
        return;
      }
      const url = ($('#steam-url')?.value || '').trim();
      const data = await postJSON(`${STEAM_API}?action=import`, {
        url,
        publish: $('#steam-publish')?.checked ? 1 : 0,
        icon_url: steamSelected.icon_url || $('#steam-sel-icon')?.value || '',
        cover_url: steamSelected.cover_url || $('#steam-sel-cover')?.value || '',
        banner_url: steamSelected.banner_url || $('#steam-sel-banner')?.value || '',
        logo_url: steamSelected.logo_url || $('#steam-sel-logo')?.value || '',
      }, FETCH_TIMEOUT_LONG);
if (!data.ok) throw new Error(data.error || 'Ошибка импорта');
      const vidInfo = data.videos ? `, видео: ${data.videos}` : '';
      toast(`Импортировано: ${data.title} (id ${data.game_id}${vidInfo})`);
      closeSteamModal();
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
        <img src="${escapeHtml(g.cover_url ? bustUrl(g.cover_url) : '')}" alt="" onerror="this.style.display=\'none\'" />
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

    // Сброс файлов и превью от предыдущей игры
    const coverInput = $('#admin-cover');
    const bannerInput = $('#admin-banner');
    const shotsInput = $('#admin-shots');
    if (coverInput) coverInput.value = '';
    if (bannerInput) bannerInput.value = '';
    if (shotsInput) shotsInput.value = '';
    const coverPrev = $('#admin-cover-preview');
    const bannerPrev = $('#admin-banner-preview');
    if (coverPrev) { coverPrev.style.display = 'none'; coverPrev.removeAttribute('src'); }
    if (bannerPrev) { bannerPrev.style.display = 'none'; bannerPrev.removeAttribute('src'); }

    const media = $('#admin-media-list');
    if (media) {
      const list = g.media || [];
      media.innerHTML = list.length
        ? list.map(m => `
        <div class="admin-media-thumb" data-mid="${m.id}">
          <img src="${escapeHtml(bustUrl(m.url))}" alt="" />
          <button type="button" title="Удалить" data-del="${m.id}">×</button>
        </div>`).join('')
        : '<div class="settings-hint">Медиа нет</div>';
      $$('[data-del]', media).forEach(b => {
        b.addEventListener('click', () => {
          adminDeleteMedia.push(+b.dataset.del);
          b.closest('.admin-media-thumb')?.remove();
        });
      });
    }
    // обложка в списке слева — актуальная с сервера (с cache-bust)
    const coverUrl = g.cover_url || g.cover_src || (g.id ? ('media.php?type=cover&id=' + g.id) : '');
    if (coverUrl) setPendingItemCover(id, bustUrl(coverUrl));
    // title в списке
    const pend = document.querySelector(`.admin-pending-item[data-id="${id}"]`);
    if (pend) {
      const t = pend.querySelector('.t');
      if (t && g.title) t.textContent = g.title;
    }
    $$('.admin-pending-item').forEach(el => el.classList.toggle('active', +el.dataset.id === id));
  } catch (err) {
    toast(err.message);
  }
}


async function loadAdminUsers() {
  const list = $('#admin-users-list');
  if (!list) return;
  const q = ($('#admin-users-search')?.value || '').trim();
  const filter = $('#admin-users-filter')?.value || 'all';
  list.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const data = await fetchJSON(`${ADMIN_API}?action=list_users&q=${encodeURIComponent(q)}&filter=${encodeURIComponent(filter)}`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const users = data.users || [];
    if (!users.length) {
      list.innerHTML = '<div class="friends-empty">Никого не найдено</div>';
      return;
    }
    list.innerHTML = users.map(u => {
      const avStyle = u.avatar_url
        ? `background-image:url('${escapeHtml(avatarUrlBust(u.avatar_url, u.id))}');background-size:cover;background-position:center;`
        : `background:${escapeHtml(u.avatar_color || '#ef5b2c')}`;
      const letter = (u.username || '?').slice(0, 1).toUpperCase();
      const badges = [];
      if (+u.is_banned) badges.push('<span class="admin-user-badge is-banned">Забанен</span>');
      if (u.role === 'admin') badges.push('<span class="admin-user-badge is-admin">Админ</span>');
      else if (u.role === 'developer') badges.push('<span class="admin-user-badge is-dev">Разработчик</span>');
      else {
        // та же логика, что на профиле: < 30 дней = Новичок
        let isNewbie = false;
        if (u.created_at) {
          const ts = new Date(String(u.created_at).replace(' ', 'T')).getTime();
          if (ts && (Date.now() - ts) < 30 * 86400 * 1000) isNewbie = true;
        }
        if (isNewbie) badges.push('<span class="admin-user-badge is-newbie">Новичок</span>');
        else badges.push('<span class="admin-user-badge is-user">Игрок</span>');
      }
      return `
        <div class="admin-user-row" data-id="${u.id}" data-username="${escapeHtml(u.username)}">
          <div class="admin-user-av" style="${avStyle}">${u.avatar_url ? '' : escapeHtml(letter)}</div>
          <div class="admin-user-info">
            <div class="admin-user-name">${escapeHtml(u.username)}</div>
            <div class="admin-user-meta">${escapeHtml(u.email || '')} · id ${u.id}</div>
            <div class="admin-user-badges">${badges.join('')}</div>
          </div>
          <div class="admin-user-actions">
            <button type="button" class="hp-btn-edit" data-act="profile">Профиль</button>
            <button type="button" class="hp-btn-edit" data-act="edit">Редактировать</button>
          </div>
        </div>`;
    }).join('');
    $$('.admin-user-row', list).forEach(row => {
      const id = +row.dataset.id;
      const uname = row.dataset.username;
      row.querySelector('[data-act="profile"]')?.addEventListener('click', () => openUserProfile(uname, id));
      row.querySelector('[data-act="edit"]')?.addEventListener('click', () => {
        openAdminUserModal({ id, username: uname, role: 'user' });
      });
    });
  } catch (err) {
    list.innerHTML = `<div class="friends-empty">${escapeHtml(err.message || 'Ошибка')}</div>`;
  }
}

function initAdminUsersControls() {
  let t = null;
  const run = () => loadAdminUsers();
  $('#admin-users-search')?.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(run, 250);
  });
  $('#admin-users-filter')?.addEventListener('change', run);
}

function setPendingItemCover(gameId, url) {
  if (!gameId || !url) return;
  const btn = document.querySelector(`.admin-pending-item[data-id="${gameId}"]`);
  if (!btn) return;
  let img = btn.querySelector('img');
  if (!img) {
    img = document.createElement('img');
    img.alt = '';
    btn.insertBefore(img, btn.firstChild);
  }
  img.style.display = '';
  img.onerror = () => { img.style.display = 'none'; };
  img.src = url;
}

function bustUrl(url) {
  if (!url) return '';
  const u = String(url);
  const sep = u.includes('?') ? '&' : '?';
  return u + sep + 'v=' + (window.__mediaBust || Date.now());
}

function refreshGameImagesEverywhere(gameId) {
  if (!gameId) return;
  window.__mediaBust = Date.now();
  window.__iconBust = window.__mediaBust;
  const selectors = [
    `.admin-pending-item[data-id="${gameId}"] img`,
    `#admin-media-list img`,
    `.home-card[data-id="${gameId}"] img`,
    `.game-card[data-id="${gameId}"] img`,
    `.store-row[data-id="${gameId}"] img`,
    `.lib-card[data-id="${gameId}"] img`,
    `.hp-game-card[data-id="${gameId}"] img`,
    `.gp-similar-card[data-id="${gameId}"] img`,
  ];
  selectors.forEach(sel => {
    $$(sel).forEach(img => {
      const src = img.getAttribute('src') || '';
      if (!src || src.startsWith('blob:')) return;
      // force reload
      const base = src.replace(/([?&])v=\d+/, '').replace(/[?&]$/, '');
      img.src = bustUrl(base);
    });
  });
  // hero on game page if open
  const hero = $('.gp-hero-bg');
  if (hero && hero.src) {
    const base = hero.src.replace(/([?&])v=\d+/, '').replace(/[?&]$/, '');
    hero.src = bustUrl(base);
  }
}

function bindAdminMediaPreviews() {
  const bind = (inputId, previewId, kind) => {
    const input = $(inputId);
    const preview = $(previewId);
    if (!input || input.dataset.previewBound === '1') return;
    input.dataset.previewBound = '1';
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      const gameId = $('#admin-game-id')?.value;
      if (!f) {
        if (preview) {
          preview.style.display = 'none';
          preview.removeAttribute('src');
        }
        return;
      }
      if (preview) {
        if (preview._objUrl) URL.revokeObjectURL(preview._objUrl);
        preview._objUrl = URL.createObjectURL(f);
        preview.src = preview._objUrl;
        preview.style.display = 'block';
      }
      // сразу в списке слева (обложка/иконка)
      if (kind === 'cover' && gameId) {
        setPendingItemCover(gameId, preview ? preview.src : URL.createObjectURL(f));
      }
      // сразу в блоке текущих медиа — временный thumb
      if (kind === 'cover') {
        const media = $('#admin-media-list');
        if (media) {
          let tmp = media.querySelector('.admin-media-thumb.is-pending-cover');
          if (!tmp) {
            tmp = document.createElement('div');
            tmp.className = 'admin-media-thumb is-pending-cover';
            tmp.innerHTML = '<img alt="" /><span class="settings-hint" style="position:absolute;bottom:2px;left:2px;right:2px;font-size:10px;background:rgba(0,0,0,.65);color:#fff;text-align:center;border-radius:2px">новая</span>';
            media.prepend(tmp);
          }
          const img = tmp.querySelector('img');
          if (img) img.src = preview ? preview.src : URL.createObjectURL(f);
        }
      }
    });
  };
  bind('#admin-cover', '#admin-cover-preview', 'cover');
  bind('#admin-banner', '#admin-banner-preview', 'banner');
}

function initAdminPanel() {
  if (!$('#view-admin')) return;
  try { initAdminUI(); } catch (e) {}
  try { bindAdminMediaPreviews(); } catch (e) {}
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
      homeCache = null;
      storeCache = [];
      window.__mediaBust = Date.now();
      window.__iconBust = window.__mediaBust;
      await openAdminGame(+id);
      refreshGameImagesEverywhere(+id);
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
function youtubeIdFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/i);
  return m ? m[1] : null;
}

let _hlsScriptPromise = null;
function loadHlsJs() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (_hlsScriptPromise) return _hlsScriptPromise;
  _hlsScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';
    s.onload = () => resolve(window.Hls);
    s.onerror = () => reject(new Error('hls.js load failed'));
    document.head.appendChild(s);
  });
  return _hlsScriptPromise;
}

function setGalleryMain(wrap, type, src, thumb, fallbacks) {
  const box = $('#gallery-main', wrap) || $('.gp-gallery-main', wrap);
  if (!box) return;
  // остановить предыдущее видео / hls
  if (wrap._hls) {
    try { wrap._hls.destroy(); } catch (e) {}
    wrap._hls = null;
  }
  const oldVid = $('#gallery-main-video', wrap);
  if (oldVid) {
    try { oldVid.pause(); } catch (e) {}
  }
  if (type === 'video') {
    const yt = youtubeIdFromUrl(src);
    if (yt) {
      box.innerHTML = `<iframe id="gallery-main-video" src="https://www.youtube.com/embed/${escapeHtml(yt)}?autoplay=1&mute=1&rel=0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen style="width:100%;height:100%;border:0;border-radius:8px;background:#000"></iframe>`;
    } else {
      const queue = [String(src || '').replace(/^http:\/\//i, 'https://')]
        .concat((fallbacks || []).map(u => String(u).replace(/^http:\/\//i, 'https://')))
        .filter(Boolean);
      let idx = 0;
      const tryPlay = async () => {
        if (idx >= queue.length) {
          if (thumb) {
            box.innerHTML = `<img id="gallery-main-img" src="${escapeHtml(thumb)}" alt="Трейлер недоступен" />`;
          }
          return;
        }
        const safeSrc = queue[idx++];
        const isHls = /\.m3u8(\?|$)/i.test(safeSrc);
        const isDash = /\.mpd(\?|$)/i.test(safeSrc);
        if (isDash) {
          // DASH без dash.js пропускаем
          return tryPlay();
        }
        box.innerHTML = `<video id="gallery-main-video" controls playsinline preload="metadata" poster="${escapeHtml(thumb || '')}"></video>`;
        const v = $('#gallery-main-video', wrap);
        if (!v) return;
        v.muted = true;
        v.defaultMuted = true;
        v.setAttribute('muted', '');
        v.addEventListener('error', () => tryPlay(), { once: true });
        v.addEventListener('ended', () => {
          const items = wrap._galleryItems || [];
          const cur = items.findIndex(it => it.type === 'video' && (it.src === safeSrc || (it.fallbacks || []).includes(safeSrc)));
          // следующее видео в галерее
          for (let i = (cur >= 0 ? cur + 1 : 0); i < items.length; i++) {
            if (items[i].type === 'video') {
              setGalleryMain(wrap, 'video', items[i].src, items[i].thumb || '', items[i].fallbacks || []);
              // подсветить thumb
              $$('.gp-gallery-thumb', wrap).forEach((t, ti) => t.classList.toggle('active', ti === i));
              return;
            }
          }
        }, { once: true });

        if (isHls) {
          // Safari — native HLS
          if (v.canPlayType('application/vnd.apple.mpegurl')) {
            v.src = safeSrc;
            v.play().catch(() => {});
            return;
          }
          try {
            const Hls = await loadHlsJs();
            if (Hls && Hls.isSupported()) {
              const hls = new Hls({ enableWorker: true });
              wrap._hls = hls;
              hls.loadSource(safeSrc);
              hls.attachMedia(v);
              hls.on(Hls.Events.MANIFEST_PARSED, () => { v.play().catch(() => {}); });
              hls.on(Hls.Events.ERROR, (_, data) => {
                if (data && data.fatal) {
                  try { hls.destroy(); } catch (e) {}
                  wrap._hls = null;
                  tryPlay();
                }
              });
              return;
            }
          } catch (e) {
            return tryPlay();
          }
          return tryPlay();
        }

        v.src = safeSrc;
        v.play().catch(() => {});
      };
      tryPlay();
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
  $$('.gp-thumb', wrap).forEach((btn, i) => {
    btn.addEventListener('click', () => {
      $$('.gp-thumb', wrap).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const item = (wrap._galleryItems && wrap._galleryItems[i]) || null;
      const fb = item && item.fallbacks ? item.fallbacks : [];
      setGalleryMain(wrap, btn.dataset.type || 'image', btn.dataset.src, btn.dataset.thumb || '', fb);
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

// ============================================================
//  АДМИН: редактирование чужого профиля + бан
// ============================================================
function openAdminUserModal(p) {
  const modal = $('#admin-user-modal');
  if (!modal) { toast('Модалка админа не найдена'); return; }
  modal.classList.remove('hidden');
  $('#admin-user-id').value = p.id;
  $('#admin-user-name').value = p.username || '';
  $('#admin-user-role').value = p.role || 'user';
  $('#admin-user-balance').value = p.balance ?? 0;
  $('#admin-user-karma').value = p.karma ?? 0;
  $('#admin-user-color').value = p.avatar_color || '#ef5b2c';
  $('#admin-user-ban-reason').value = p.ban_reason || '';
  $('#admin-user-ban-days').value = 0;
  $('#admin-user-status').textContent = p.is_banned ? 'Пользователь сейчас забанен' : '';
  // подтянуть свежие данные
  fetchJSON(`${ADMIN_API}?action=get_user&id=${p.id}`).then(data => {
    if (!data.ok || !data.user) return;
    const u = data.user;
    $('#admin-user-name').value = u.username || '';
    $('#admin-user-role').value = u.role || 'user';
    $('#admin-user-balance').value = u.balance ?? 0;
    $('#admin-user-karma').value = u.karma ?? 0;
    $('#admin-user-color').value = u.avatar_color || '#ef5b2c';
    $('#admin-user-ban-reason').value = u.ban_reason || '';
    $('#admin-user-status').textContent = +u.is_banned ? 'Пользователь сейчас забанен' : '';
  }).catch(() => {});
}

function closeAdminUserModal() {
  $('#admin-user-modal')?.classList.add('hidden');
}

function initAdminUserModal() {
  $('#admin-user-close')?.addEventListener('click', closeAdminUserModal);
  document.querySelectorAll('[data-close-admin-user]').forEach(el => {
    el.addEventListener('click', closeAdminUserModal);
  });

  $('#admin-user-save')?.addEventListener('click', async () => {
    const id = +($('#admin-user-id')?.value || 0);
    if (!id) return;
    const status = $('#admin-user-status');
    try {
      const res = await postJSON(`${ADMIN_API}?action=update_user`, {
        user_id: id,
        username: $('#admin-user-name')?.value || '',
        role: $('#admin-user-role')?.value || 'user',
        balance: +($('#admin-user-balance')?.value || 0),
        karma: +($('#admin-user-karma')?.value || 0),
        avatar_color: $('#admin-user-color')?.value || '#ef5b2c',
      });
      if (!res.ok) throw new Error(res.error || 'Ошибка');
      // медиа
      const av = $('#admin-user-avatar')?.files?.[0];
      const bn = $('#admin-user-banner')?.files?.[0];
      const upload = async (file, kind) => {
        const fd = new FormData();
        fd.append('csrf_token', window.CSRF_TOKEN || '');
        fd.append('user_id', String(id));
        fd.append('kind', kind);
        fd.append('file', file);
        const r = await fetch(`${ADMIN_API}?action=upload_user_media`, { method: 'POST', body: fd, credentials: 'same-origin' });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || 'Ошибка загрузки');
      };
      if (av) await upload(av, 'avatar');
      if (bn) await upload(bn, 'banner');
      if (status) status.textContent = 'Сохранено';
      toast('Профиль обновлён');
      // обновить открытый профиль
      const uname = $('#admin-user-name')?.value;
      if (uname) openUserProfile(uname, id);
    } catch (err) {
      if (status) status.textContent = err.message || 'Ошибка';
      toast(err.message || 'Ошибка');
    }
  });

  $('#admin-user-ban')?.addEventListener('click', async () => {
    const id = +($('#admin-user-id')?.value || 0);
    if (!id) return;
    if (!confirm('Забанить этого пользователя?')) return;
    try {
      const res = await postJSON(`${ADMIN_API}?action=ban`, {
        user_id: id,
        reason: $('#admin-user-ban-reason')?.value || 'Нарушение правил',
        days: +($('#admin-user-ban-days')?.value || 0),
      });
      if (!res.ok) throw new Error(res.error || 'Ошибка');
      toast('Пользователь забанен');
      $('#admin-user-status').textContent = 'Забанен';
    } catch (err) {
      toast(err.message || 'Ошибка');
    }
  });

  $('#admin-user-unban')?.addEventListener('click', async () => {
    const id = +($('#admin-user-id')?.value || 0);
    if (!id) return;
    try {
      const res = await postJSON(`${ADMIN_API}?action=unban`, { user_id: id });
      if (!res.ok) throw new Error(res.error || 'Ошибка');
      toast('Бан снят');
      $('#admin-user-status').textContent = 'Бан снят';
    } catch (err) {
      toast(err.message || 'Ошибка');
    }
  });

  // кнопка «вернуться к авторизации» на экране бана
  $('#ban-back-auth')?.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await postJSON((window.AUTH_API || 'api/auth.php') + '?action=logout', {});
    } catch (err) {}
    try {
      await fetch('api/auth.php?action=logout', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csrf_token: window.CSRF_TOKEN || '' }) });
    } catch (err) {}
    const q = window.IS_CLIENT ? '?view=auth&client=1' : '?view=auth';
    window.location.href = q;
  });
}

function avatarUrlBust(url, uid) {
  if (!url) return '';
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + 'u=' + (uid || 0) + '&t=' + encodeURIComponent(String(url).slice(-12));
}

function applyUserAvatarEl(el, user) {
  if (!el || !user) return;
  // Не красим контейнер side-user-btn — только сам кружок/квадрат аватара
  if (el.id === 'avatar-btn' && el.classList.contains('side-user-btn')) {
    const inner = el.querySelector('.side-avatar') || $('#side-avatar');
    if (inner) el = inner;
    else return;
  }
  const url = user.avatar_url || '';
  // Жёстко фиксируем квадрат — защита от растягивания
  if (el.classList.contains('side-avatar')) {
    el.style.width = '38px';
    el.style.height = '38px';
    el.style.minWidth = '38px';
    el.style.minHeight = '38px';
    el.style.flexShrink = '0';
    el.style.borderRadius = '10px';
  }
  if (el.classList.contains('hp-avatar')) {
    el.style.width = '88px';
    el.style.height = '88px';
    el.style.minWidth = '88px';
    el.style.minHeight = '88px';
    el.style.flexShrink = '0';
    el.style.aspectRatio = '1 / 1';
  }
  if (url) {
    el.style.backgroundImage = `url('${avatarUrlBust(url, user.id)}')`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.style.backgroundRepeat = 'no-repeat';
    el.style.backgroundColor = 'transparent';
    el.textContent = '';
  } else {
    el.style.backgroundImage = 'none';
    el.style.backgroundColor = user.avatar_color || '#ef5b2c';
    el.style.background = user.avatar_color || '#ef5b2c';
    el.textContent = (user.avatar || (user.username || '?').slice(0, 1)).toUpperCase();
  }
}

function profileRoleLabel(user) {
  if (!user) return '';
  if (+user.is_banned === 1) return { text: 'Забанен', cls: 'is-banned' };
  const role = (user.role || 'user').toLowerCase();
  if (role === 'admin') return { text: 'Администратор', cls: 'is-admin' };
  if (role === 'developer') return { text: 'Разработчик', cls: 'is-dev' };
  // Новичок: аккаунт младше 30 дней
  if (user.created_at) {
    const ts = new Date(user.created_at).getTime();
    if (ts && (Date.now() - ts) < 30 * 86400 * 1000) {
      return { text: 'Новичок', cls: 'is-newbie' };
    }
  }
  return { text: 'Игрок', cls: 'is-user' };
}

function setProfileRoleBadge(user) {
  let badge = $('#hp-role-badge');
  const info = $('#hp-user-info') || $('.hp-user-info');
  if (!badge && info) {
    badge = document.createElement('span');
    badge.id = 'hp-role-badge';
    badge.className = 'hp-role-badge';
    info.insertBefore(badge, info.firstChild);
  }
  if (!badge) return;
  const r = profileRoleLabel(user);
  if (!r || !r.text) { badge.style.display = 'none'; return; }
  badge.style.display = '';
  badge.className = 'hp-role-badge ' + r.cls;
  badge.textContent = r.text;
}



document.addEventListener('DOMContentLoaded', () => {
  // Сначала кнопка «+», чтобы сбой других init её не убил
  try { initSubmitGame(); } catch (e) { console.error('initSubmitGame', e); }

  const safe = (name, fn) => { try { fn(); } catch (e) { console.error(name, e); } };
  safe('initWebNav', initWebNav);
  safe('initClientNav', initClientNav);
  safe('initAvatarMenu', initAvatarMenu);
  safe('initStoreControls', initStoreControls);
  safe('initLibraryControls', initLibraryControls);
  safe('initCatioSelects', initCatioSelects);
  safe('initSegControls', initSegControls);
  safe('initThemePicker', initThemePicker);
  safe('initProfileControls', initProfileControls);
  safe('initSettingsView', initSettingsView);
  safe('initLightbox', initLightbox);
  safe('initHomeControls', initHomeControls);
  safe('initFriendsUI', initFriendsUI);
  safe('initChatUI', initChatUI);
  safe('initChatExtras', initChatExtras);
  safe('initNotificationsUI', initNotificationsUI);
  safe('initBottomBar', initBottomBar);
  safe('bindFriendCodeButtons', () => { bindFriendCodeButtons(); renderProfileFriendCode(getMyFriendCode()); updateBottomBarVersion(); });
  safe('initAdminPanel', initAdminPanel);
  safe('initAdminUserModal', initAdminUserModal);
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
