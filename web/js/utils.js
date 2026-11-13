/* CATio — utils: fetch, formatters, accordion, offline, iconSvg */
/* Depends on: icons.js (global icon) */

// CATio frontend — clean vanilla JS
// Все запросы к API — асинхронные с таймаутом: вкладки не зависают,
// если сервер лёг (AbortController рвёт зависший fetch через FETCH_TIMEOUT мс).

const API_BASE = 'api/games.php';
const USER_API = 'api/user.php';
const PUB_API = 'api/publishers.php';

// stubs — чтобы клики до парсинга низа файла не падали
if (typeof window.fetchMyPublishers !== 'function') {
  window.fetchMyPublishers = async function() {
    throw new Error('publishers module ещё не загружен, обновите страницу (Ctrl+F5)');
  };
}
if (typeof window.fillPublishPublisherSelect !== 'function') {
  window.fillPublishPublisherSelect = async function() { return []; };
}
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
function formatPrice(price, discountPercent) {
  const p = parseFloat(price) || 0;
  const disc = Math.min(100, Math.max(0, parseInt(discountPercent, 10) || 0));
  if (p === 0) return { text: 'Бесплатно', className: 'free', original: null, final: 0, discount: 0 };
  if (disc > 0) {
    const final = Math.round(p * (100 - disc) / 100);
    return {
      text: `${final} ₽`,
      className: 'paid sale',
      original: `${Math.round(p)} ₽`,
      final,
      discount: disc,
      originalNum: Math.round(p)
    };
  }
  return { text: `${Math.round(p)} ₽`, className: 'paid', original: null, final: Math.round(p), discount: 0 };
}

function formatSize(bytes) {
  const b = parseInt(bytes, 10);
  if (!b) return '';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' КБ';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' МБ';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' ГБ';
}
function formatBytes(n) {
  const s = formatSize(n);
  return s || ((Number(n) || 0) + ' Б');
}


// ---------- Accordion (профиль / фильтры / страница игры) ----------
const HP_SIDE_ARROW = `<span class="hp-side-arrow" aria-hidden="true">${icon('chevron-down', 16)}</span>`;

/** Оборачивает содержимое body в .acc-inner один раз */
function ensureAccordionInner(body) {
  if (!body) return null;
  if (body.dataset.accInner === '1') {
    return body.querySelector(':scope > .acc-inner') || body.firstElementChild;
  }
  if (body.children.length === 1 && body.firstElementChild && body.firstElementChild.classList.contains('acc-inner')) {
    body.dataset.accInner = '1';
    return body.firstElementChild;
  }
  const inner = document.createElement('div');
  inner.className = 'acc-inner';
  while (body.firstChild) inner.appendChild(body.firstChild);
  body.appendChild(inner);
  body.dataset.accInner = '1';
  body.classList.add('acc-body');
  return inner;
}

function setAccordionHTML(body, html) {
  if (!body) return;
  const inner = ensureAccordionInner(body);
  if (inner) inner.innerHTML = html;
  else body.innerHTML = html;
}

/**
 * Высота 0↔scrollHeight: контент клипится сверху вниз / снизу вверх, закрытие до нуля.
 */
function animateAccordion(card, body, collapsedClass) {
  if (!card || !body) return;
  ensureAccordionInner(body);
  body.classList.add('acc-body');
  if (body.dataset.animating === '1') return card.classList.contains(collapsedClass);
  body.dataset.animating = '1';

  const willCollapse = !card.classList.contains(collapsedClass);
  const ms = 280;
  // открытие и закрытие — одна кривая; закрытие = реверс открытия
  const easeOpen = `height ${ms}ms cubic-bezier(0.22, 1, 0.36, 1)`;
  const easeClose = `height ${ms}ms cubic-bezier(0.64, 0, 0.78, 0)`;

  let done = false;
  const finish = (fn) => {
    if (done) return;
    done = true;
    try { fn && fn(); } catch (e) {}
    body.dataset.animating = '0';
  };

  if (willCollapse) {
    // открыт → закрыт = реверс открытия: height full → 0
    body.style.overflow = 'hidden';
    body.style.transition = 'none';
    body.style.height = body.scrollHeight + 'px';
    body.offsetHeight;
    card.classList.add(collapsedClass); // стрелка сразу; height анимирует inline
    body.style.transition = easeClose;
    body.style.height = '0px';
    const onEnd = (ev) => {
      if (ev.target !== body || ev.propertyName !== 'height') return;
      body.removeEventListener('transitionend', onEnd);
      finish(() => {
        body.style.transition = '';
        body.style.height = ''; // дальше держит CSS height:0
      });
    };
    body.addEventListener('transitionend', onEnd);
    setTimeout(() => {
      body.removeEventListener('transitionend', onEnd);
      finish(() => {
        body.style.transition = '';
        body.style.height = '';
      });
    }, ms + 60);
  } else {
    // закрыт → открыт: height 0 → full
    card.classList.remove(collapsedClass);
    body.style.overflow = 'hidden';
    body.style.transition = 'none';
    body.style.height = '0px';
    body.offsetHeight;
    const target = body.scrollHeight;
    body.style.transition = easeOpen;
    body.style.height = target + 'px';
    const onEnd = (ev) => {
      if (ev.target !== body || ev.propertyName !== 'height') return;
      body.removeEventListener('transitionend', onEnd);
      finish(() => {
        body.style.transition = 'none';
        body.style.height = 'auto';
        body.offsetHeight;
        body.style.transition = '';
        body.style.overflow = '';
      });
    };
    body.addEventListener('transitionend', onEnd);
    setTimeout(() => {
      body.removeEventListener('transitionend', onEnd);
      finish(() => {
        body.style.transition = 'none';
        body.style.height = 'auto';
        body.offsetHeight;
        body.style.transition = '';
        body.style.overflow = '';
      });
    }, ms + 60);
  }
  return willCollapse;
}

function prepareAccordions(root) {
  const scope = root || document;
  scope.querySelectorAll('.hp-side-body, .gp-side-body, .filter-block-body:not(.filter-block-body--open)').forEach(ensureAccordionInner);
}


function iconSvg(name, size=16) {
  const s = size;
  const map = {
    star: icon('star-fill', s),
    clock: icon('clock-alt', s),
    thumbsUp: icon('thumbs-up', s),
    thumbsDown: icon('thumbs-down', s),
    reply: icon('reply', s),
    trash: icon('trash', s),
    heart: icon('heart', s),
    message: icon('message', s),
    download: icon('downloads', s),
    users: icon('friends', s),
    settings: icon('settings-gear', s),
    plus: icon('plus', s),
    pencil: icon('edit', s),
    arrowLeft: icon('chevron-left', s),
    share: icon('share', s),
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

