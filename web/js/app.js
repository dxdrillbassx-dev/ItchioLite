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
const HP_SIDE_ARROW = `<span class="hp-side-arrow" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg></span>`;

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

// ---------- Корзина (localStorage) ----------
function cartStorageKey() {
  const uid = (window.AUTH_STATE && window.AUTH_STATE.user && window.AUTH_STATE.user.id)
    || (window.CURRENT_USER && window.CURRENT_USER.id)
    || 'guest';
  return 'itch_cart_v1_u' + uid;
}
const CART_KEY = 'itch_cart_v1'; // legacy fallback
window.__lastGameForCart = null; // текущая игра на странице — для синхронизации кнопки

function getCart() {
  try {
    const raw = localStorage.getItem(cartStorageKey());
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveCart(items) {
  localStorage.setItem(cartStorageKey(), JSON.stringify(items || []));
  updateCartBadge();
  try {
    if (window.__lastGameForCart && typeof refreshBuyButton === 'function') {
      refreshBuyButton(window.__lastGameForCart);
    }
  } catch (e) {}
  try {
    const modal = document.getElementById('cart-add-modal');
    if (modal && typeof renderCartModalBody === 'function') {
      renderCartModalBody(modal);
    }
  } catch (e) {}
  window.dispatchEvent(new CustomEvent('cart:changed'));
}

function cartCount() {
  return getCart().reduce((sum, x) => sum + (parseInt(x.qty, 10) || 1), 0);
}

function cartQty(gameId) {
  const id = String(gameId);
  const item = getCart().find(x => String(x.id) === id);
  return item ? (parseInt(item.qty, 10) || 1) : 0;
}

function isInCart(gameId) {
  return cartQty(gameId) > 0;
}

function addToCart(game) {
  if (!game || !game.id) return false;
  const items = getCart();
  const id = String(game.id);
  const existing = items.find(x => String(x.id) === id);
  const priceInfo = formatPrice(game.price, game.discount_percent);
  if (existing) {
    existing.qty = (parseInt(existing.qty, 10) || 1) + 1;
    existing.title = game.title || existing.title;
    existing.cover = game.cover_src || game.cover_url || game.banner_url || existing.cover || '';
    existing.price = game.price;
    existing.discount_percent = game.discount_percent || 0;
    existing.finalPrice = priceInfo.final;
    existing.genre = game.genre || existing.genre || '';
    existing.developer = game.developer_name || game.developer || existing.developer || '';
  } else {
    items.push({
      id: game.id,
      title: game.title || 'Игра',
      cover: game.cover_src || game.cover_url || game.banner_url || '',
      price: game.price,
      discount_percent: game.discount_percent || 0,
      finalPrice: priceInfo.final,
      genre: game.genre || '',
      developer: game.developer_name || game.developer || '',
      forAccount: 'self',
      qty: 1,
      addedAt: Date.now()
    });
  }
  saveCart(items);
  return true;
}

function removeFromCart(gameId, opts = {}) {
  const id = String(gameId);
  const items = getCart();
  const idx = items.findIndex(x => String(x.id) === id);
  if (idx < 0) return;
  if (opts && opts.one && (parseInt(items[idx].qty, 10) || 1) > 1) {
    items[idx].qty = (parseInt(items[idx].qty, 10) || 1) - 1;
  } else {
    items.splice(idx, 1);
  }
  saveCart(items);
}

function setCartForAccount(gameId, value) {
  const id = String(gameId);
  const items = getCart();
  const item = items.find(x => String(x.id) === id);
  if (!item) return;
  item.forAccount = value === 'friend' ? 'friend' : 'self';
  if (item.forAccount !== 'friend') {
    delete item.giftTo;
    delete item.giftToName;
  }
  saveCart(items);
}
function setCartGiftFriend(gameId, friendId, friendName) {
  const id = String(gameId);
  const items = getCart();
  const item = items.find(x => String(x.id) === id);
  if (!item) return;
  item.forAccount = 'friend';
  item.giftTo = +friendId;
  item.giftToName = friendName || '';
  saveCart(items);
}
function setAllGiftFriends(friendId, friendName) {
  const items = getCart();
  items.forEach(item => {
    if (item.forAccount === 'friend') {
      item.giftTo = +friendId;
      item.giftToName = friendName || '';
    }
  });
  saveCart(items);
}

function clearCart() {
  saveCart([]);
}

async function syncCartPrices() {
  const items = getCart();
  if (!items.length) return items;
  let map = {};
  try {
    if (Array.isArray(storeCache) && storeCache.length) {
      storeCache.forEach(g => { map[+g.id] = g; });
    } else {
      const data = await fetchJSON(`${API_BASE}?action=list`);
      (data.games || []).forEach(g => { map[+g.id] = g; });
    }
  } catch (e) {}
  let changed = false;
  items.forEach(it => {
    const g = map[+it.id];
    if (!g) return;
    const price = parseFloat(g.price);
    const disc = parseInt(g.discount_percent, 10) || 0;
    if (!Number.isNaN(price) && (Number(it.price) !== price || (parseInt(it.discount_percent, 10) || 0) !== disc)) {
      it.price = price;
      it.discount_percent = disc;
      if (g.cover_url) it.cover = g.cover_url;
      if (g.title) it.title = g.title;
      changed = true;
    }
  });
  if (changed) saveCart(items);
  return items;
}


function updateCartBadge() {
  const badge = document.getElementById('cart-badge');
  const btn = document.getElementById('btn-cart');
  const n = cartCount();
  if (badge) {
    badge.textContent = n > 0 ? String(n) : '';
    badge.classList.toggle('hidden', n === 0);
  }
  if (btn) btn.classList.toggle('has-items', n > 0);
}

function renderPriceBlock(priceInfo) {
  if (priceInfo.className === 'free') {
    return `<span class="cart-price free">Бесплатно</span>`;
  }
  if (priceInfo.discount > 0) {
    return `<span class="cart-price-block">
      <span class="cart-discount">-${priceInfo.discount}%</span>
      <span class="cart-price-col">
        <span class="cart-price-old">${escapeHtml(priceInfo.original)}</span>
        <span class="cart-price sale">${escapeHtml(priceInfo.text)}</span>
      </span>
    </span>`;
  }
  return `<span class="cart-price">${escapeHtml(priceInfo.text)}</span>`;
}

function cartModalRowHtml(item) {
  const pi = formatPrice(item.price, item.discount_percent);
  const qty = parseInt(item.qty, 10) || 1;
  const forVal = item.forAccount === 'friend' ? 'friend' : 'self';
  const rows = [];
  for (let i = 0; i < qty; i++) {
    rows.push(`
      <div class="cart-modal-game" data-id="${item.id}" data-copy="${i}">
        <img class="cart-modal-cover" src="${escapeHtml(item.cover || '')}" alt="" onerror="this.style.opacity=0.35" />
        <div class="cart-modal-meta">
          <div class="cart-modal-title">${escapeHtml(item.title || 'Игра')}</div>
          <div class="cart-modal-account">
            <select class="cart-modal-for" data-id="${item.id}" aria-label="Для кого">
              <option value="self" ${forVal === 'self' ? 'selected' : ''}>Для моего аккаунта</option>
              <option value="friend" ${forVal === 'friend' ? 'selected' : ''}>В подарок другу</option>
            </select>
          </div>
        </div>
        <div class="cart-modal-side">
          <div class="cart-modal-side-price">${renderPriceBlock(pi)}</div>
          <div class="cart-modal-actions">
            <button type="button" class="cart-modal-link add" data-id="${item.id}">Добавить</button>
            <span class="cart-modal-act-sep">|</span>
            <button type="button" class="cart-modal-link remove" data-id="${item.id}">Удалить</button>
          </div>
        </div>
      </div>`);
  }
  return rows.join('');
}

function renderCartModalBody(modal) {
  if (!modal) return;
  const list = modal.querySelector('#cart-modal-list');
  const openBtn = modal.querySelector('#cart-open');
  const items = getCart();
  if (!items.length) {
    modal.remove();
    return;
  }
  if (list) list.innerHTML = items.map(cartModalRowHtml).join('');
  if (openBtn) openBtn.textContent = 'Открыть корзину (' + cartCount() + ')';
  try {
    let total = 0;
    items.forEach(item => {
      const pi = formatPrice(item.price, item.discount_percent);
      total += (pi.final || 0) * (parseInt(item.qty, 10) || 1);
    });
    const tEl = modal.querySelector('#cart-add-modal-total');
    if (tEl) tEl.textContent = total > 0 ? `${Math.round(total)} ₽` : 'Бесплатно';
  } catch (e) {}
  try { initCatioSelects(modal); } catch (e) {}

  list && list.querySelectorAll('.cart-modal-for').forEach(sel => {
    sel.addEventListener('change', () => setCartForAccount(sel.dataset.id, sel.value));
  });
  list && list.querySelectorAll('.cart-modal-link.add').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const item = getCart().find(x => String(x.id) === String(id));
      if (!item) return;
      addToCart({
        id: item.id,
        title: item.title,
        cover_src: item.cover,
        price: item.price,
        discount_percent: item.discount_percent,
        genre: item.genre,
        developer_name: item.developer
      });
    });
  });
  list && list.querySelectorAll('.cart-modal-link.remove').forEach(btn => {
    btn.addEventListener('click', () => {
      removeFromCart(btn.dataset.id, { one: true });
    });
  });
}

function showAddToCartModal(game) {
  const existing = document.getElementById('cart-add-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'cart-add-modal';
  modal.className = 'cart-modal-overlay';
  modal.setAttribute('aria-hidden', 'false');
  // та же вёрстка, что у «Подтверждение покупки»
  modal.innerHTML = `
    <div class="cart-modal checkout-modal" role="dialog" aria-labelledby="cart-modal-title">
      <div class="cart-modal-head">
        <h3 id="cart-modal-title">Добавлено в корзину!</h3>
        <button type="button" class="pub-modal-close" id="cart-add-modal-close" aria-label="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="cart-modal-body">
        <div id="cart-modal-list" class="cart-modal-list"></div>
        <div class="checkout-total-row">
          <span>В корзине</span>
          <strong id="cart-add-modal-total">0 ₽</strong>
        </div>
      </div>
      <div class="cart-modal-foot">
        <button type="button" class="cart-modal-btn" id="cart-continue">Продолжить покупки</button>
        <button type="button" class="cart-modal-btn primary" id="cart-open">Открыть корзину (${cartCount()})</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  renderCartModalBody(modal);
  try { initCatioSelects(modal); } catch (e) {}

  // сумма
  try {
    let total = 0;
    getCart().forEach(item => {
      const pi = formatPrice(item.price, item.discount_percent);
      const qty = parseInt(item.qty, 10) || 1;
      total += (pi.final || 0) * qty;
    });
    const tEl = modal.querySelector('#cart-add-modal-total');
    if (tEl) tEl.textContent = total > 0 ? `${Math.round(total)} ₽` : 'Бесплатно';
  } catch (e) {}

  const close = () => {
    modal.remove();
  };
  modal.querySelector('#cart-add-modal-close')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('#cart-continue')?.addEventListener('click', close);
  modal.querySelector('#cart-open')?.addEventListener('click', () => {
    close();
    if (typeof showView === 'function') showView('cart');
  });
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
  workshop: 'Мастерская',
  library: 'Библиотека',
  downloads: 'Загрузки',
  cart: 'Корзина',
  notifications: 'Уведомления',
  profile: 'Профиль',
  settings: 'Настройки',
  admin: 'Админка',
  game: 'Страница игры',
  auth: 'Вход',
  achievements: 'Достижения',
  publisher: 'Издательство',
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
  if (view === 'publisher') {
    const cur = new URLSearchParams(window.location.search);
    const pub = cur.get('pub');
    if (pub) params.set('pub', pub);
  }
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
    headSearch.style.display = (name === 'game' || name === 'auth' || name === 'settings' || name === 'achievements' || name === 'cart') ? 'none' : '';
  }

  const main = $('.main');
  if (main) main.scrollTop = 0;
  window.scrollTo(0, 0);

  syncUrl(name, gameId);

  if (name === 'home') loadHome();
  if (name === 'store') loadStore();
  if (name === 'library') loadLibrary();
  if (name === 'community') loadWorkshop();
  if (name === 'workshop' && typeof openWorkshop === 'function') openWorkshop();
  if (name === 'notifications') loadNotifications();
  if (name === 'downloads') renderDownloadsView();
  if (name === 'cart') renderCartPage();
  if (name === 'profile') {
    if (opts && opts.foreign) {
      // чужой профиль — loadProfile не вызываем
    } else {
      viewingUserId = null;
      loadProfile();
    }
  }
  if (name === 'admin') loadAdminPending();
  if (name === 'game') {
    const gid = gameId || window.__lastGameForCart?.id || window.GAME_ID_FROM_URL || 0;
    if (gid) loadGamePage(gid);
  }
  if (name === 'publisher') {
    const params = new URLSearchParams(window.location.search);
    const pubId = +(params.get('pub') || 0);
    if (pubId) openPublisherPage(pubId);
  }
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
    grid.classList.add('is-empty');
    grid.innerHTML = `<div class="hp-empty hp-empty-centered home-empty">
      <div class="hp-empty-logo" aria-hidden="true">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
      </div>
      <div class="hp-empty-text">В каталоге пока нет игр</div>
      <div class="hp-empty-text" style="font-size:0.82rem;opacity:0.8">Нажми «+» сверху, чтобы отправить игру на модерацию</div>
    </div>`;
    return;
  }
  grid.classList.remove('is-empty');

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
  const id = +gameId;
  if (Array.isArray(sideLibCache)) {
    sideLibCache = sideLibCache.filter(g => +g.id !== id);
    try { renderSideLibrary($('#side-lib-search')?.value || ''); } catch (e) {}
  }
  // покупка остаётся — только убрали из библиотеки
  try {
    if (Array.isArray(storeCache)) {
      const g = storeCache.find(x => +x.id === id);
      if (g) { g.owned = false; g.purchased = true; }
    }
    if (window.__currentGame && +window.__currentGame.id === id) {
      window.__currentGame.owned = false;
      window.__currentGame.purchased = true;
    }
  } catch (e) {}
  // кнопки в каталоге: «В библиотеку» (вернуть), не «В корзину»
  try {
    $$(`.game-item__plus-wrapper[data-id="${id}"], .btn-get[data-id="${id}"]`).forEach(btn => {
      btn.disabled = false;
      btn.classList.remove('is-owned', 'owned');
      btn.classList.add('is-add', 'is-restore');
      btn.title = 'В библиотеку';
      if (btn.classList.contains('game-item__plus-wrapper')) {
        btn.innerHTML = '<svg class="gi-icon gi-plus" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
      } else {
        btn.textContent = 'В библиотеку';
      }
    });
    // страница игры
    if (typeof refreshBuyButton === 'function' && window.__currentGame && +window.__currentGame.id === id) {
      // purchased but not owned → restore mode via buy API
      refreshBuyButton(window.__currentGame);
      const btn = document.getElementById('btn-buy-game');
      if (btn && !window.__currentGame.owned) {
        btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14"/><path d="M5 12h14"/></svg> В библиотеку`;
        btn.dataset.mode = 'restore';
        btn.classList.remove('owned', 'in-cart');
      }
    }
  } catch (e) {}
  try { loadSideLibrary(); } catch (e) {}
}

function applyPlaytimeEverywhere(gameId, minutes) {
  const id = +gameId;
  minutes = Math.max(0, parseInt(minutes, 10) || 0);
  try {
    if (Array.isArray(libraryCache)) {
      const g = libraryCache.find(x => +x.id === id);
      if (g) g.playtime_minutes = minutes;
    }
  } catch (e) {}
  try {
    if (Array.isArray(sideLibCache)) {
      const g = sideLibCache.find(x => +x.id === id);
      if (g) g.playtime_minutes = minutes;
    }
  } catch (e) {}
  try {
    if (window.__currentGame && +window.__currentGame.id === id) {
      window.__currentGame.playtime_minutes = minutes;
    }
  } catch (e) {}
  // карточки библиотеки
  try { if (typeof renderLibraryGrid === 'function') renderLibraryGrid(); } catch (e) {}
  // профиль / hp-game-time
  try {
    $$(`.hp-game-card[data-id="${id}"] .hp-game-time`).forEach(el => {
      const label = typeof formatPlaytimeShort === 'function' ? formatPlaytimeShort(minutes) : (minutes + ' м');
      const svg = el.querySelector('svg');
      el.innerHTML = (svg ? svg.outerHTML + ' ' : '') + label;
    });
    $$(`.lib-card[data-id="${id}"] .lib-card-time`).forEach(el => {
      const label = typeof formatLibPlaytime === 'function' ? formatLibPlaytime(minutes) : (minutes + ' м');
      el.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> ${label}`;
    });
  } catch (e) {}
  // страница игры
  try {
    const pt = document.querySelector('.gp-playtime');
    if (pt && window.__currentGame && +window.__currentGame.id === id) {
      // leave status text; playtime often elsewhere
    }
  } catch (e) {}
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

  // Кнопка фильтров — модалка у правого края сайдбара, поверх всего, анимация L→R / R→L
  const filtersBtn = $('#side-lib-filters');
  const modal = $('#side-lib-modal');
  if (filtersBtn && modal) {
    // выносим в body, иначе stacking context сайдбара прячет модалку под контентом
    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }

    const placeSideLibModal = () => {
      const sidebar = document.querySelector('.sidebar');
      const sr = sidebar ? sidebar.getBoundingClientRect() : null;
      const br = filtersBtn.getBoundingClientRect();
      // левый край модалки = правый край боковой колонки
      const left = sr ? Math.round(sr.right) : Math.round(br.right + 8);
      // верх модалки = верх кнопки (−2px визуально вровень)
      let top = Math.round(br.top - 2);
      modal.style.position = 'fixed';
      modal.style.left = left + 'px';
      modal.style.top = top + 'px';
      modal.style.right = 'auto';
      modal.style.bottom = 'auto';
      modal.style.zIndex = '10050';
      requestAnimationFrame(() => {
        const mr = modal.getBoundingClientRect();
        if (mr.bottom > window.innerHeight - 8) {
          modal.style.top = Math.max(8, Math.round(window.innerHeight - mr.height - 8)) + 'px';
        }
      });
    };

    let closingTimer = null;
    const isSideLibModalOpen = () =>
      !modal.classList.contains('hidden') && !modal.classList.contains('is-closing');

    const openSideLibModal = () => {
      if (closingTimer) { clearTimeout(closingTimer); closingTimer = null; }
      modal.classList.remove('hidden', 'is-closing');
      placeSideLibModal();
      modal.classList.remove('is-open');
      void modal.offsetWidth;
      modal.classList.add('is-open');
      filtersBtn.classList.add('active');
    };
    const closeSideLibModal = () => {
      if (modal.classList.contains('hidden') || modal.classList.contains('is-closing')) return;
      modal.classList.remove('is-open');
      modal.classList.add('is-closing');
      filtersBtn.classList.remove('active');
      closingTimer = setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('is-closing');
        closingTimer = null;
      }, 200);
    };

    // расстояние от точки до прямоугольника (0 = внутри)
    const distToRect = (x, y, r) => {
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      return Math.hypot(dx, dy);
    };

    filtersBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (modal.classList.contains('hidden') || modal.classList.contains('is-closing')) openSideLibModal();
      else closeSideLibModal();
    });
    document.addEventListener('click', (e) => {
      if (
        isSideLibModalOpen() &&
        !modal.contains(e.target) &&
        e.target !== filtersBtn &&
        !filtersBtn.contains(e.target)
      ) {
        closeSideLibModal();
      }
    });
    // скролл/колесо вне модалки — закрыть
    const onScrollOrWheel = (e) => {
      if (!isSideLibModalOpen()) return;
      if (e.target && modal.contains(e.target)) return;
      closeSideLibModal();
    };
    window.addEventListener('scroll', onScrollOrWheel, true);
    document.addEventListener('wheel', onScrollOrWheel, { passive: true, capture: true });
    // курсор ушёл далеко от модалки и кнопки
    const LEAVE_PX = 56;
    document.addEventListener('mousemove', (e) => {
      if (!isSideLibModalOpen()) return;
      const mr = modal.getBoundingClientRect();
      const br = filtersBtn.getBoundingClientRect();
      const d = Math.min(distToRect(e.clientX, e.clientY, mr), distToRect(e.clientX, e.clientY, br));
      if (d > LEAVE_PX) closeSideLibModal();
    });
    window.addEventListener('resize', () => {
      if (isSideLibModalOpen()) placeSideLibModal();
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
      // Страница игры в мастерской — стрелка ведёт обратно в мастерскую
      if (window.__wsgId) {
        openWorkshop();
        return;
      }
      const cur = getViewFromUrl();
      const target = prevView && prevView !== cur ? prevView : 'home';
      if (target === 'game') {
        const gid = window.__lastGameForCart?.id || window.GAME_ID_FROM_URL || 0;
        showView('game', gid || undefined);
      } else {
        showView(target);
      }
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
        if (!q) {
          // пустой ввод — только прячем дроп, фокус в поле оставляем
          const drop = $('#head-search-drop');
          if (drop) {
            drop.hidden = true;
            drop.innerHTML = '';
            drop.classList.remove('is-open', 'is-closing');
          }
          return;
        }
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

    const distToRect = (x, y, r) => {
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      return Math.hypot(dx, dy);
    };
    const onSearchAwayScroll = (e) => {
      const input = $('#head-search-input');
      const focused = input && document.activeElement === input;
      if (!isHeadSearchDropOpen() && !focused) return;
      const drop = $('#head-search-drop');
      if (e.target && drop && drop.contains(e.target)) return;
      if (e.target && e.target.closest && e.target.closest('#head-search')) return;
      hideHeadSearchDrop();
    };
    window.addEventListener('scroll', onSearchAwayScroll, true);
    document.addEventListener('wheel', onSearchAwayScroll, { passive: true, capture: true });
    document.addEventListener('mousemove', (e) => {
      const wrap = $('#head-search');
      const input = $('#head-search-input');
      const drop = $('#head-search-drop');
      if (!wrap || !input) return;
      const focused = document.activeElement === input;
      const dropOpen = isHeadSearchDropOpen();
      if (!focused && !dropOpen) return;
      const dWrap = distToRect(e.clientX, e.clientY, wrap.getBoundingClientRect());
      const dDrop = drop && !drop.hidden
        ? distToRect(e.clientX, e.clientY, drop.getBoundingClientRect())
        : Infinity;
      if (Math.min(dWrap, dDrop) > 56) hideHeadSearchDrop();
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
  const input = $('#head-search-input');
  // деактивация поля поиска
  if (input && document.activeElement === input) {
    try { input.blur(); } catch (e) {}
  }
  if (!drop || drop.hidden) return;
  drop.classList.remove('is-open');
  drop.classList.add('is-closing');
  window.setTimeout(() => {
    drop.hidden = true;
    drop.innerHTML = '';
    drop.classList.remove('is-closing');
  }, 160);
}

function isHeadSearchDropOpen() {
  const drop = $('#head-search-drop');
  return !!(drop && !drop.hidden && drop.classList.contains('is-open'));
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

function storeRowPriceHtml(price) {
  if (price.className === 'free') {
    return ''; // бесплатные — без приписки в каталоге
  }
  if (price.discount > 0) {
    return `<span class="store-row-price sale">
      <span class="store-row-discount">-${price.discount}%</span>
      <span class="store-row-price-col">
        <span class="store-row-price-old">${escapeHtml(price.original)}</span>
        <span class="store-row-price-final">${escapeHtml(price.text)}</span>
      </span>
    </span>`;
  }
  return `<span class="store-row-price paid">${escapeHtml(price.text)}</span>`;
}

function createStoreRow(game) {
  const price = formatPrice(game.price, game.discount_percent);
  const row = document.createElement('article');
  row.className = 'store-row game-item';
  row.dataset.id = game.id;
  const cover = escapeHtml(game.banner_url || game.cover_url || game.cover_src || ('media.php?type=cover&id=' + game.id));
  const genres = escapeHtml((game.genre || '').split(/[,/|]/).map(s => s.trim()).filter(Boolean).slice(0, 4).join(', ') || '—');
  const inCart = !game.owned && typeof isInCart === 'function' && isInCart(game.id);
  const purchased = !!(game.purchased || game.owned);
  // плюс только если не в библиотеке и не в корзине; галочка только если в библиотеке
  let actionBtn = '';
  if (game.owned) {
    actionBtn = `<button type="button" class="game-item__plus-wrapper is-owned" data-id="${game.id}" title="В библиотеке" disabled>
      <svg class="gi-icon gi-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
    </button>`;
  } else if (!inCart) {
    const title = (purchased || price.className === 'free') ? 'В библиотеку' : 'В корзину';
    actionBtn = `<button type="button" class="game-item__plus-wrapper is-add" data-id="${game.id}" title="${title}">
      <svg class="gi-icon gi-plus" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
    </button>`;
  }
  // inCart → кнопки нет
  row.innerHTML = `
    <div class="game-item__content-link">
      <div class="game-item__cover-wrapper">
        <img class="game-item__cover" src="${cover}" alt="${escapeHtml(game.title)}" loading="lazy" />
      </div>
      <div class="game-item__details">
        <h3 class="store-row-title">${escapeHtml(game.title)}</h3>
        <div class="game-item__genres">${genres}</div>
      </div>
      ${(!game.owned && price.className !== 'free') ? `<div class="store-row-price-wrap">${storeRowPriceHtml(price)}</div>` : ''}
      ${actionBtn}
    </div>
  `;
  const plus = row.querySelector('.game-item__plus-wrapper');
  row.addEventListener('click', (e) => {
    if (e.target.closest('.game-item__plus-wrapper') || e.target.closest('.store-row-price-wrap')) return;
    gotoGame(game.id);
  });
  if (plus) {
    plus.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (game.owned || plus.disabled) return;

      // Уже куплена, но не в библиотеке → вернуть в библиотеку без оплаты
      if (game.purchased || price.className === 'free') {
        plus.disabled = true;
        try {
          const data = await postJSON(`${API_BASE}?action=buy`, { game_id: game.id });
          if (!data.ok) throw new Error(data.error || 'Не удалось оформить');
          if (data.balance !== undefined) updateBalance(data.balance);
          game.owned = true;
          game.purchased = true;
          const cached = storeCache.find(g => String(g.id) === String(game.id));
          if (cached) { cached.owned = true; cached.purchased = true; }
          markStoreRowOwned(plus);
          try { sideLibAddOptimistic(game); } catch (err) {}
          toast(data.message || `«${game.title}» добавлена в библиотеку`);
        } catch (err) {
          plus.disabled = false;
          toast(err.message || 'Ошибка');
        }
        return;
      }

      // Платные некупленные → в корзину, иконку убрать
      const ok = typeof addToCart === 'function' && addToCart(game);
      if (ok) {
        plus.remove(); // пока в корзине — ни плюса, ни галочки
        if (typeof showAddToCartModal === 'function') showAddToCartModal(game);
        else toast('Добавлено в корзину');
      }
    });
  }
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
  const price = formatPrice(game.price, game.discount_percent);
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
    list.innerHTML = `<div class="hp-empty hp-empty-centered store-empty">
      <div class="hp-empty-logo" aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
      </div>
      <div class="hp-empty-text">${emptyMsg}</div>
    </div>`;
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

  const price = formatPrice(game.price, game.discount_percent);
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
    const inCart = price.className !== 'free' && typeof isInCart === 'function' && isInCart(game.id);
    btn.textContent = price.className === 'free' ? 'В библиотеку' : (inCart ? 'В корзине' : 'В корзину');
    btn.classList.remove('owned');
    btn.disabled = false;
  }
}

async function buyFromCard(btn, game, price) {
  if (game.owned) return;
  // Платные — в корзину
  if (price.className !== 'free') {
    if (typeof isInCart === 'function' && isInCart(game.id)) {
      if (typeof showView === 'function') showView('cart');
      return;
    }
    const ok = typeof addToCart === 'function' && addToCart(game);
    if (ok) {
      btn.textContent = 'В корзине';
      if (typeof showAddToCartModal === 'function') showAddToCartModal(game);
      else toast('Добавлено в корзину');
    }
    return;
  }
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
    const cover = btn.closest('.game-card')?.querySelector('.game-cover');
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

  // Сворачивание блоков фильтров (как в профиле)
  prepareAccordions(document);
  $$('.filter-block-head').forEach(head => {
    if (head.dataset.boundFilterToggle === '1') return;
    head.dataset.boundFilterToggle = '1';
    head.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const block = head.closest('.filter-block');
      if (!block) return;
      const body = block.querySelector('.filter-block-body');
      if (!body) {
        block.classList.toggle('collapsed');
        return;
      }
      const collapsed = animateAccordion(block, body, 'collapsed');
      head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
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
  if (head) head.innerHTML = `Достижения ${unlocked}/${total} <span class="hp-side-arrow" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg></span>`;
  if (!list.length) {
    setAccordionHTML(body, '<div class="gp-ach-empty">У этой игры нет достижений</div>');
    return;
  }
  const preview = list.filter(a => !+a.is_hidden).slice(0, 5);
  setAccordionHTML(body, `
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
    <button type="button" class="gp-side-more" id="gp-ach-all">Просмотреть все достижения</button>`);
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
    setAccordionHTML(body, `<div class="gp-ach-empty">${escapeHtml(err.message || 'Не удалось загрузить')}</div>`);
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
  window.__lastGameForCart = g;
  const price = formatPrice(g.price, g.discount_percent);
  const tags = tagsToArray(g.tags);
  const shots = (data.screenshots || []).map(s => (typeof s === 'string' ? s : (s && (s.url || s.image_url)) || '')).filter(Boolean);
  window.__lastGameScreenshots = shots.slice();
  const videos = data.videos || [];
  const viewer = data.viewer || {};
  const authorized = viewer.authorized;
  const cover = g.cover_src || g.cover_url || '';
  const hero = g.banner_url || g.cover_url || cover || (`media.php?type=hero&id=${g.id}`);
  // как в Steam: сначала трейлеры, потом скрины
  const gallery = [];
  const videoItems = [];
  videos.forEach((v, i) => {
    if (!v || !v.url) return;
    let src = String(v.url).replace(/^http:\/\//i, 'https://');
    // DASH alone often unplayable — skip as primary if only mpd
    if (/\.mpd(\?|$)/i.test(src) && !/\.m3u8/i.test(src)) {
      // keep as fallback candidate only if we have nothing else later
      videoItems.push({
        type: 'video', src, fallbacks: [], format: 'dash',
        thumb: v.thumbnail || cover || '', name: v.name || ('Трейлер ' + (i + 1)),
        _prio: 3,
      });
      return;
    }
    const fallbacks = Array.isArray(v.fallbacks)
      ? v.fallbacks.map(u => String(u).replace(/^http:\/\//i, 'https://'))
      : [];
    let prio = 1;
    if (/youtube\.com|youtu\.be/i.test(src)) prio = 0;
    else if (/^uploads\//i.test(src) || /\.(mp4|webm)(\?|$)/i.test(src)) prio = 0;
    else if (/\.m3u8(\?|$)/i.test(src)) prio = 2;
    videoItems.push({
      type: 'video', src, fallbacks, format: v.format || '',
      thumb: v.thumbnail || cover || '', name: v.name || ('Трейлер ' + (i + 1)),
      _prio: prio,
    });
  });
  videoItems.sort((a, b) => (a._prio - b._prio));
  videoItems.forEach(it => { delete it._prio; gallery.push(it); });
  (shots.length ? shots : (cover ? [cover] : [])).forEach((src) => {
    if (!src) return;
    src = String(src).trim();
    if (!src) return;
    // не тащим в галерею явно битые/не-картинки
    if (/\.ico(\?|$)/i.test(src)) return;
    if (/\.mp4|\.webm|\.m3u8|\.mpd/i.test(src)) return;
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
    statusMain = 'Вы ещё не играли в ' + (g.title || 'эту игру');
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

  const meUser = window.AUTH_STATE && window.AUTH_STATE.user;
  const isGameOwner = !!(meUser && g && (
    +g.submitted_by === +meUser.id || +g.user_id === +meUser.id || g.is_owner === true || g.is_owner === 1
  ));
  const updateChip = isGameOwner
    ? `<button type="button" class="gp-hero-chip" id="gp-game-update" title="Обновить версию">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>
      </button>`
    : '';


  const inCart = !g.owned && !g.purchased && isInCart(g.id);

  // Единый модуль «цена + кнопка» как в Steam
  let purchaseMod = '';
  if (!g.owned) {
    // уже куплено / было в библиотеке — вернуть без цены и без корзины
    if (g.purchased) {
      purchaseMod = `<div class="gp-purchase-mod">
        <button type="button" class="gp-purchase-btn free" id="btn-buy-game" data-mode="restore">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
          В библиотеку
        </button>
      </div>`;
    } else if (price.className === 'free') {
      purchaseMod = `<div class="gp-purchase-mod">
        <button type="button" class="gp-purchase-btn free" id="btn-buy-game">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
          Получить бесплатно
        </button>
      </div>`;
    } else {
      const priceInner = price.discount > 0
        ? `<span class="gp-purchase-discount">-${price.discount}%</span>
           <span class="gp-purchase-prices">
             <span class="gp-purchase-old">${escapeHtml(price.original)}</span>
             <span class="gp-purchase-final">${escapeHtml(price.text)}</span>
           </span>`
        : `<span class="gp-purchase-final only">${escapeHtml(price.text)}</span>`;
      purchaseMod = `<div class="gp-purchase-mod ${inCart ? 'is-in-cart' : ''}">
        <div class="gp-purchase-price">${priceInner}</div>
        <button type="button" class="gp-purchase-btn ${inCart ? 'in-cart' : ''}" id="btn-buy-game">
          ${inCart
            ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6L9 17l-5-5"/></svg> В корзине`
            : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> В корзину`}
        </button>
      </div>`;
    }
  }

  const actionBtns = g.owned
    ? `<button type="button" class="${dlClass}" id="btn-buy-game"${dlDisabled} title="${dlTitle}">
         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
         Скачать
       </button>
       <span class="gp-bar-sep" aria-hidden="true"></span>
       <button type="button" class="gp-bar-btn icon gp-like-btn ${g.is_liked || g.liked ? 'liked' : ''}" id="gp-like" title="${g.is_liked || g.liked ? 'Убрать лайк' : 'Лайк'}">${iconSvg('heart',16)}</button>
       <button type="button" class="gp-bar-btn icon ${isPinnedGame ? 'is-pinned' : ''}" id="gp-share" title="${isPinnedGame ? 'Открепить' : 'Закрепить'}">${isPinnedGame ? pinSvgPinned : pinSvg}</button>
       ${settingsOrEditBtn}`
    : `${adminEditBar}${purchaseMod}`;

  wrap.innerHTML = `
    <div class="gp">
      <div class="gp-hero">
        <img class="gp-hero-bg" src="${escapeHtml(hero)}" alt="" onerror="this.style.opacity=0.35" />
        <div class="gp-hero-grad"></div>
        <div class="gp-hero-content">
          ${g.logo_url ? `<img class="gp-hero-logo" src="${escapeHtml(g.logo_url)}" alt="" onerror="this.style.display='none'" />` : ''}
        </div>
        <div class="gp-hero-bottom">
          ${(!isWebBrowser || adminEditBtn || updateChip || cloudChip) ? `<div class="gp-hero-tools">
            ${adminEditBtn || ''}
            ${updateChip || ''}
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
            ${publisher ? `<p class="gp-meta-muted">Издатель ${g.publisher_id ? `<button type="button" class="gp-publisher-link" data-pub-id="${g.publisher_id}">${escapeHtml(publisher)}</button>` : escapeHtml(publisher)}</p>` : ''}
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
            <button type="button" class="gp-side-head" id="gp-ach-head">Достижения <span class="hp-side-arrow" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg></span></button>
            <div class="gp-side-body" id="gp-ach-body">
              <div class="gp-ach-empty">В разработке</div>
            </div>
          </div>

          <div class="gp-side-card">
            <button type="button" class="gp-side-head">Статистика <span class="hp-side-arrow" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg></span></button>
            <div class="gp-side-body gp-stats-body">
              <div class="gp-stat-row"><span class="gp-stat-ico">${iconSvg('download',14)}</span><span>Загрузки</span><b>${formatStatNum(g.download_count)}</b></div>
              <div class="gp-stat-row"><span class="gp-stat-ico">${iconSvg('users',14)}</span><span>Активные игроки</span><b>${formatStatNum(g.players_count ?? g.ratings_count ?? 0)}</b></div>
              <div class="gp-stat-row"><span class="gp-stat-ico">${iconSvg('star',14)}</span><span>Оценка</span><b>${(parseFloat(g.rating) || 0).toFixed(1)}</b></div>
            </div>
          </div>

          <div class="gp-side-card" id="gp-comm-card" data-game-id="${g.id}">
            <button type="button" class="gp-side-head">Скриншоты сообщества <span class="hp-side-arrow" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg></span></button>
            <div class="gp-side-body" id="gp-comm-body">
              <div class="gp-ach-empty">Загрузка…</div>
            </div>
          </div>

          <div class="gp-side-card">
            <button type="button" class="gp-side-head">Поддержка контроллера <span class="hp-side-arrow" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg></span></button>
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
  window.__currentGamePage = g;
  window.__currentGameBuilds = data.builds || [];
  initBuyButton(wrap, g);
  initRateStars(wrap, g);
  renderCommentsThreaded(data.comments || [], data.viewer, g.id);
  initCommentForm(g, data.viewer);
  initBuildButtons(wrap, g);
  initReviewSort(data.comments || [], data.viewer, g.id);
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

  // side card collapse (как в профиле)
  prepareAccordions(wrap);
  $$('.gp-side-head', wrap).forEach(btn => {
    if (btn.dataset.boundSideAnim === '1') return;
    btn.dataset.boundSideAnim = '1';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('.gp-side-card') || btn.parentElement;
      if (!card) return;
      const body = card.querySelector('.gp-side-body');
      if (!body) {
        card.classList.toggle('collapsed');
        return;
      }
      const collapsed = animateAccordion(card, body, 'collapsed');
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
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
    if (wrap._gameData) {
      openGameAssetsModal(wrap._gameData);
    } else {
      toast('Данные игры ещё не загружены');
    }
  });
  // скриншоты сообщества = медиа мастерской по этой игре
  loadGameCommunityMedia(g.id);
}

function mediaCoverUrl(m) {
  if (!m) return '';
  const pick = (v) => {
    if (!v) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'object') return String(v.url || v.src || v.thumb || '').trim();
    return '';
  };
  let u = pick(m.image_url) || pick(m.cover_url) || pick(m.thumb_url) || pick(m.thumbnail);
  if (u) return u;
  let imgs = m.images_list || m.images || m.files || null;
  if (typeof imgs === 'string') {
    try { imgs = JSON.parse(imgs); } catch (e) {
      // иногда одна строка-путь без JSON
      if (imgs.includes('/') || imgs.startsWith('uploads')) return imgs.trim();
      imgs = null;
    }
  }
  if (Array.isArray(imgs) && imgs.length) {
    for (const it of imgs) {
      const x = pick(it);
      if (x) return x;
    }
  }
  return '';
}

async function loadGameCommunityMedia(gameId) {
  const body = document.getElementById('gp-comm-body');
  if (!body) return;
  gameId = +gameId || 0;
  if (!gameId) {
    body.innerHTML = '<div class="gp-ach-empty">Пока нет работ сообщества</div>';
    return;
  }
  try {
    const data = await fetchJSON((typeof WS_API !== 'undefined' ? WS_API : 'api/workshop.php') + '?action=media&game_id=' + gameId + '&limit=6');
    const list = (data && data.ok && Array.isArray(data.media)) ? data.media : [];
    if (!list.length) {
      body.innerHTML = '<div class="gp-ach-empty">Пока нет работ сообщества</div>';
      return;
    }
    const shots = list.slice(0, 3).map(m => {
      const src = mediaCoverUrl(m);
      if (!src) return '';
      const likes = m.likes || m.like_count || 0;
      return `<button type="button" class="gp-comm-shot" data-media-id="${m.id}" data-src="${escapeHtml(src)}">
        <img src="${escapeHtml(src)}" alt="${escapeHtml(m.title || '')}" loading="lazy" />
        <span class="gp-comm-meta">${iconSvg('heart',12)} ${likes}</span>
      </button>`;
    }).filter(Boolean).join('');
    body.innerHTML = `
      <div class="gp-comm-shots">${shots}</div>
      <button type="button" class="gp-side-more" id="gp-comm-more">Показать все</button>`;
    body.querySelectorAll('.gp-comm-shot').forEach(btn => {
      btn.addEventListener('click', () => {
        const mid = +btn.dataset.mediaId;
        if (mid && typeof openWorkshopMediaView === 'function') openWorkshopMediaView(mid);
        else if (btn.dataset.src && typeof openLightbox === 'function') openLightbox(btn.dataset.src);
      });
    });
    const more = document.getElementById('gp-comm-more');
    if (more) {
      more.addEventListener('click', () => {
        if (typeof openWorkshopGame === 'function') openWorkshopGame(gameId, 'media');
        else if (typeof showView === 'function') showView('workshop');
      });
    }
  } catch (e) {
    body.innerHTML = '<div class="gp-ach-empty">Не удалось загрузить</div>';
  }
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


// актуальный список отзывов на странице игры (для сортировки без потери данных)
window.__gameComments = window.__gameComments || { list: [], viewer: null, gameId: 0 };

function renderCommentsThreaded(comments, viewer, gameId) {
  const box = $('#comments-list');
  if (!box) return;

  // всегда держим свежий список
  if (Array.isArray(comments)) {
    window.__gameComments = {
      list: comments.slice(),
      viewer: viewer || (window.__gameComments && window.__gameComments.viewer) || null,
      gameId: gameId != null ? gameId : ((window.__gameComments && window.__gameComments.gameId) || 0)
    };
  } else if (window.__gameComments && Array.isArray(window.__gameComments.list)) {
    comments = window.__gameComments.list;
    viewer = viewer || window.__gameComments.viewer;
    gameId = gameId != null ? gameId : window.__gameComments.gameId;
  }

  // скрыть/показать форму корневого отзыва
  const formWrap = $('#comment-form-wrap');
  const uid = viewer && viewer.user_id ? +viewer.user_id : null;
  const myRoot = uid ? (comments || []).find(c => +c.user_id === uid && !(+c.parent_id > 0)) : null;
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
  // сортировка корней по активной кнопке
  const activeSort = document.querySelector('.gp-sort-opt.active');
  const mode = (activeSort && activeSort.dataset.sort) || 'new';
  if (mode === 'old') roots.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  else if (mode === 'score') roots.sort((a, b) => (b.rating||b.user_rating||0) - (a.rating||a.user_rating||0) || new Date(b.created_at) - new Date(a.created_at));
  else if (mode === 'popular') roots.sort((a, b) => ((b.likes||0)-(b.dislikes||0)) - ((a.likes||0)-(a.dislikes||0)) || new Date(b.created_at) - new Date(a.created_at));
  else roots.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  Object.keys(byParent).forEach(k => {
    byParent[k].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  });

  const renderOne = (c, depth) => {
    const hasCustomAv = !!c.avatar_url;
    const letter = (c.avatar || (c.username || '?').slice(0, 1) || '?').toString().slice(0, 1).toUpperCase();
    const avColor = c.avatar_color || '#ef5b2c';
    const avStyle = hasCustomAv
      ? `background-image:url('${escapeHtml(c.avatar_url)}');background-size:cover;background-position:center;`
      : `background:${escapeHtml(avColor)};color:#12110e;`;
    const kids = byParent[c.id] || [];
    const rating = (c.rating != null && c.rating !== '') ? c.rating : ((c.user_rating != null && c.user_rating !== '') ? c.user_rating : null);
    const playH = (c.playtime_hours != null && c.playtime_hours !== '')
      ? c.playtime_hours
      : (c.playtime_minutes != null && +c.playtime_minutes > 0 ? Math.max(1, Math.round(+c.playtime_minutes / 60)) : null);
    const likes = c.likes || c.like_count || 0;
    const dislikes = c.dislikes || c.dislike_count || 0;
    const banner = c.profile_banner || c.banner_url || '';
    // всегда фон шапки: картинка или цвет оформления
    const bannerStyle = banner
      ? `background-image:url('${escapeHtml(banner)}');background-size:cover;background-position:center;`
      : `background: linear-gradient(135deg, ${escapeHtml(avColor)}55 0%, ${escapeHtml(avColor)}22 50%, rgba(18,17,14,0.9) 100%); border: 1px solid ${escapeHtml(avColor)}44;`;
    const showBanner = true;
    const isMine = uid && +c.user_id === uid;
    const isRoot = !(c.parent_id > 0);

    return `
      <div class="gp-review ${depth ? 'is-reply' : ''} has-banner" data-id="${c.id}">
        <div class="gp-review-main">
          <div class="gp-review-headcard with-banner">
            <div class="gp-review-banner" style="${bannerStyle}"></div>
            <div class="gp-review-headcard-inner">
              <div class="gp-review-av ${hasCustomAv ? 'has-img' : 'is-letter'}" style="${avStyle}">
                ${hasCustomAv ? '' : escapeHtml(letter)}
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

function initReviewSort(comments, viewer, gameId) {
  if (Array.isArray(comments)) {
    window.__gameComments = {
      list: comments.slice(),
      viewer: viewer || null,
      gameId: gameId != null ? gameId : (window.__gameComments && window.__gameComments.gameId) || 0
    };
  }
  const sortBtns = () => $$('.gp-sort-opt');
  sortBtns().forEach(btn => {
    if (btn.dataset.sortBound === '1') return;
    btn.dataset.sortBound = '1';
    btn.addEventListener('click', () => {
      sortBtns().forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const store = window.__gameComments || { list: [], viewer: null, gameId: 0 };
      const list = [...(store.list || [])];
      const mode = btn.dataset.sort;
      // только корневые для порядка, ответы остаются привязаны в renderCommentsThreaded
      const roots = list.filter(c => !(+c.parent_id > 0));
      const replies = list.filter(c => +c.parent_id > 0);
      if (mode === 'new') roots.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
      else if (mode === 'old') roots.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
      else if (mode === 'score') roots.sort((a,b) => (b.rating||b.user_rating||0) - (a.rating||a.user_rating||0) || new Date(b.created_at) - new Date(a.created_at));
      else if (mode === 'popular') roots.sort((a,b) => ((b.likes||0)-(b.dislikes||0)) - ((a.likes||0)-(a.dislikes||0)) || new Date(b.created_at) - new Date(a.created_at));
      const sorted = roots.concat(replies);
      renderCommentsThreaded(sorted, store.viewer || viewer, store.gameId || gameId);
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
  const price = formatPrice(g.price, g.discount_percent);
  const mod = btn.closest('.gp-purchase-mod');
  if (g.owned) {
    const pref = getPreferredVersion(g.id);
    const hasAny = Object.keys(getInstalledVersions(g.id)).length > 0;
    const installing = typeof isGameDownloading === 'function' && isGameDownloading(g.id);
    if (installing) {
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4"/><path d="M12 18v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="m16.24 16.24 2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="m4.93 19.07 2.83-2.83"/><path d="m16.24 7.76 2.83-2.83"/></svg> Установка`;
      btn.dataset.mode = 'installing';
      btn.disabled = true;
      btn.classList.add('is-disabled', 'owned');
      btn.classList.remove('in-cart');
      if (mod) mod.classList.remove('is-in-cart');
      if (note) note.textContent = 'Идёт установка…';
    } else if (hasAny) {
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Играть${pref ? ' · v' + escapeHtml(pref) : ''}`;
      btn.dataset.mode = 'play';
      btn.disabled = false;
      btn.classList.remove('is-disabled');
      btn.classList.add('owned');
      btn.classList.remove('in-cart');
      if (mod) mod.classList.remove('is-in-cart');
      if (note) note.textContent = 'Установлено на этом ПК';
    } else {
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Установить`;
      btn.dataset.mode = 'install';
      btn.disabled = false;
      btn.classList.remove('is-disabled');
      btn.classList.add('owned');
      btn.classList.remove('in-cart');
      if (mod) mod.classList.remove('is-in-cart');
      if (note) note.textContent = '';
    }
  } else if (isInCart(g.id)) {
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6L9 17l-5-5"/></svg> В корзине`;
    btn.classList.add('in-cart');
    btn.classList.remove('owned');
    if (mod) mod.classList.add('is-in-cart');
  } else if (g.purchased) {
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14"/><path d="M5 12h14"/></svg> В библиотеку`;
    btn.dataset.mode = 'restore';
    btn.classList.remove('owned', 'in-cart');
    if (mod) mod.classList.remove('is-in-cart');
    if (note) note.textContent = 'Куплено — можно вернуть в библиотеку';
  } else {
    if (price.className === 'free') {
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14"/><path d="M5 12h14"/></svg> Получить бесплатно`;
    } else {
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> В корзину`;
    }
    btn.classList.remove('owned', 'in-cart');
    if (mod) mod.classList.remove('is-in-cart');
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
      const mode = btn.dataset.mode || 'install';
      if (mode === 'installing' || (typeof isGameDownloading === 'function' && isGameDownloading(g.id))) {
        toast('Игра уже устанавливается');
        return;
      }
      const builds = (window.__currentGameBuilds || []).filter(b => !b.status || b.status === 'published');
      if (mode === 'play') {
        const ver = getPreferredVersion(g.id);
        toast(ver ? `Запуск v${ver}…` : 'Запуск…');
        // Клиент: если есть bridge — дергаем; иначе подсказка
        if (window.IS_CLIENT && typeof window.catioPlayGame === 'function') {
          try { window.catioPlayGame(g.id, ver); } catch (e) { toast(e.message || 'Не удалось запустить'); }
        } else {
          toast('Запуск из браузера недоступен — откройте в клиенте CATio');
        }
        return;
      }
      if (builds.length) openInstallModal(g, builds);
      else {
        const box = $('#game-builds', wrap) || $('#gp-section-builds');
        if (box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else toast('Нет доступных сборок');
      }
      return;
    }

    const price = formatPrice(g.price, g.discount_percent);
    const mode = btn.dataset.mode || '';

    // Куплено ранее / удалено из библиотеки — вернуть в библиотеку без корзины
    if (g.purchased || mode === 'restore') {
      btn.disabled = true;
      const prev = btn.innerHTML;
      btn.textContent = 'Добавляем...';
      try {
        const data = await postJSON(`${API_BASE}?action=buy`, { game_id: g.id });
        if (!data.ok) throw new Error(data.error || 'Не удалось добавить');
        if (data.balance !== undefined) updateBalance(data.balance);
        g.owned = true;
        g.purchased = true;
        toast(data.message || 'Вернули в библиотеку');
        sideLibAddOptimistic(g);
        loadGamePage(g.id);
      } catch (err) {
        toast(err.message || 'Ошибка');
        btn.innerHTML = prev;
      } finally {
        btn.disabled = false;
      }
      return;
    }

    // Бесплатные — сразу в библиотеку
    if (price.className === 'free') {
      btn.disabled = true;
      btn.textContent = 'Оформляем...';
      try {
        const data = await postJSON(`${API_BASE}?action=buy`, { game_id: g.id });
        if (!data.ok) throw new Error(data.error || 'Не удалось оформить');
        if (data.balance !== undefined) updateBalance(data.balance);
        g.owned = true;
        g.purchased = true;
        toast(data.message || 'Добавлено в библиотеку');
        sideLibAddOptimistic(g);
        loadGamePage(g.id);
      } catch (err) {
        toast(err.message || 'Ошибка');
      } finally {
        btn.disabled = false;
        if (!g.owned) refreshBuyButton(g);
      }
      return;
    }

    // Платные — в корзину
    if (isInCart(g.id)) {
      showView('cart');
      return;
    }
    const added = addToCart(g);
    if (added) {
      refreshBuyButton(g);
      showAddToCartModal(g);
    } else {
      toast('Уже в корзине');
      showView('cart');
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

// ---------- Установки (localStorage) ----------
function getInstallMap() {
  try { return JSON.parse(localStorage.getItem('catio_installs') || '{}') || {}; }
  catch (e) { return {}; }
}
function setInstallMap(map) {
  try { localStorage.setItem('catio_installs', JSON.stringify(map)); } catch (e) {}
}
function getInstalledVersions(gameId) {
  const m = getInstallMap();
  return (m[String(gameId)] && m[String(gameId)].versions) || {};
}
function isVersionInstalled(gameId, version) {
  return !!getInstalledVersions(gameId)[String(version)];
}
function markVersionInstalled(gameId, version, buildId, size) {
  const m = getInstallMap();
  const key = String(gameId);
  if (!m[key]) m[key] = { versions: {}, preferred: null };
  m[key].versions[String(version)] = { buildId: +buildId, size: +size || 0, at: Date.now() };
  if (!m[key].preferred) m[key].preferred = String(version);
  setInstallMap(m);
  markInstalled(gameId);
}
function getPreferredVersion(gameId) {
  const m = getInstallMap()[String(gameId)];
  if (!m) return null;
  if (m.preferred && m.versions[m.preferred]) return m.preferred;
  // newest by date
  let best = null, bestAt = 0;
  Object.keys(m.versions || {}).forEach(v => {
    const at = m.versions[v].at || 0;
    if (at >= bestAt) { bestAt = at; best = v; }
  });
  return best;
}
function setPreferredVersion(gameId, version) {
  const m = getInstallMap();
  const key = String(gameId);
  if (!m[key]) return;
  m[key].preferred = String(version);
  setInstallMap(m);
}

// ---------- Модалка установки ----------
let __installCtx = null;
function openInstallModal(g, builds, preferBuildId) {
  const modal = document.getElementById('install-modal');
  if (!modal || !builds || !builds.length) {
    toast('Нет доступных сборок');
    return;
  }
  __installCtx = { g, builds };
  const cover = document.getElementById('install-cover');
  const title = document.getElementById('install-title');
  const sizeEl = document.getElementById('install-size');
  const sel = document.getElementById('install-version');
  const confirmBtn = document.getElementById('install-confirm');
  if (title) title.textContent = g.title || 'Игра';
  if (cover) {
    const url = g.icon_url || g.cover_url || g.banner_url || '';
    cover.style.backgroundImage = url ? "url('" + String(url).replace(/'/g, '%27') + "')" : '';
    cover.textContent = url ? '' : (g.title || '?').slice(0, 1).toUpperCase();
  }
  if (sel) {
    sel.innerHTML = builds.map(b => {
      const inst = isVersionInstalled(g.id, b.version) ? ' ✓' : '';
      return `<option value="${b.id}" data-version="${escapeHtml(b.version)}" data-size="${b.file_size_bytes || 0}" data-platform="${escapeHtml(b.platform || 'windows')}" data-installed="${inst ? '1' : '0'}">v${escapeHtml(b.version)} · ${escapeHtml(b.platform || 'windows')}${inst}</option>`;
    }).join('');
    if (preferBuildId) sel.value = String(preferBuildId);
    const syncInstallUi = () => {
      const opt = sel.selectedOptions[0];
      if (sizeEl && opt) sizeEl.textContent = formatSize(+opt.dataset.size || 0);
      const installed = !!(opt && (opt.dataset.installed === '1' || isVersionInstalled(g.id, opt.dataset.version || '')));
      if (confirmBtn) {
        confirmBtn.disabled = installed;
        confirmBtn.classList.toggle('is-disabled', installed);
        confirmBtn.textContent = installed ? 'Уже установлено' : 'Установить';
        confirmBtn.style.opacity = installed ? '0.55' : '';
        confirmBtn.style.cursor = installed ? 'default' : '';
      }
    };
    sel.onchange = syncInstallUi;
    syncInstallUi();
  }
  modal.classList.remove('hidden');
}
function closeInstallModal() {
  const modal = document.getElementById('install-modal');
  if (modal) modal.classList.add('hidden');
  __installCtx = null;
}
document.addEventListener('click', (e) => {
  if (!e.target || !e.target.closest) return;
  if (e.target.closest('[data-close-install]')) {
    closeInstallModal();
    return;
  }
  if (e.target.closest('#install-confirm')) {
    e.preventDefault();
    const sel = document.getElementById('install-version');
    const confirmBtn = document.getElementById('install-confirm');
    if (confirmBtn && confirmBtn.disabled) return;
    if (!sel || !__installCtx) return;
    const opt = sel.selectedOptions[0];
    if (!opt) return;
    const buildId = +opt.value;
    const version = opt.dataset.version || '';
    const size = +opt.dataset.size || 0;
    const platform = opt.dataset.platform || 'windows';
    const g = __installCtx.g;
    if (isVersionInstalled(g.id, version)) {
      toast('Эта версия уже установлена');
      return;
    }
    closeInstallModal();
    enqueueDownload({
      buildId,
      gameId: g.id,
      title: g.title,
      platform,
      version,
      size,
      onDoneInstall: true
    });
  }
});

// ---------- Сборки на странице игры ----------
function renderBuildsList(builds, g) {
  if (!builds.length) {
    return '<p class="modal-builds-empty">Сборок пока нет — загрузите файл при публикации.</p>';
  }
  const isAdm = !!(window.AUTH_STATE && window.AUTH_STATE.user && window.AUTH_STATE.user.role === 'admin');
  const owned = !!(g && (g.owned === true || g.owned === 1 || g.owned === '1' || g.in_library || g.is_owned || g.purchased));
  return `
    <div class="modal-builds">
      ${builds.map(b => {
        const installed = isVersionInstalled(g.id, b.version);
        const pending = (b.status === 'pending');
        let btnLabel = 'Установить';
        let locked = false;
        if (pending && isAdm) {
          btnLabel = 'Предзагрузить';
          locked = false;
        } else if (pending) {
          btnLabel = 'На модерации';
          locked = true;
        } else if (!owned) {
          btnLabel = 'Купите игру';
          locked = true;
        } else if (installed) {
          btnLabel = 'Установлено';
          locked = true;
        }
        return `
        <div class="build-row${pending ? ' is-pending' : ''}${locked ? ' is-locked' : ''}">
          <div class="build-info">
            <span class="build-version">v${escapeHtml(b.version || '')}</span>
            ${b.file_name ? `<span class="build-size">${escapeHtml(b.file_name)}</span>` : ''}
            ${b.file_size_bytes ? `<span class="build-size">${formatSize(b.file_size_bytes)}</span>` : ''}
            ${b.changelog ? `<span class="build-size">${escapeHtml(String(b.changelog).slice(0, 80))}</span>` : ''}
            ${pending ? '<span class="build-pending">на модерации</span>' : ''}
          </div>
          <button type="button" class="btn-download${installed ? ' is-installed' : ''}${locked ? ' is-disabled' : ''}" data-build-id="${b.id}"
            data-platform="${escapeHtml(b.platform || 'windows')}" data-version="${escapeHtml(b.version || '')}"
            data-size="${b.file_size_bytes || 0}" data-pending="${pending ? '1' : '0'}"
            ${locked ? 'disabled' : ''}>${btnLabel}</button>
        </div>`;
      }).join('')}
    </div>`;
}

function initBuildButtons(wrap, g) {
  $$('.btn-download', wrap).forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const builds = (window.__currentGameBuilds || []).filter(b => b.status !== 'rejected');
      const bid = +btn.dataset.buildId;
      if (btn.dataset.pending === '1') {
        // admin pre-download without install tracking
        enqueueDownload({
          buildId: bid,
          gameId: g.id,
          title: g.title + ' (предзагрузка)',
          platform: btn.dataset.platform,
          version: btn.dataset.version,
          size: +btn.dataset.size || 0,
          preDownload: true
        });
        return;
      }
      openInstallModal(g, builds.length ? builds : [{
        id: bid, version: btn.dataset.version, platform: btn.dataset.platform, file_size_bytes: +btn.dataset.size || 0
      }], bid);
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




function clearPublishFormFields() {
  const formModal = document.getElementById('submit-form-modal');
  const form = document.getElementById('submit-game-form') || (formModal && formModal.querySelector('form'));
  try { if (form && form.reset) form.reset(); } catch (e) {}
  ['sg-title','sg-developer','sg-short','sg-tags','sg-price','sg-desc','sg-video','sg-cover-url','sg-banner-url','sg-logo-url','sg-icon-url','sg-screenshots-urls','sg-trailer-urls','sg-genre','sg-publisher','sg-publisher-id'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'SELECT') el.selectedIndex = 0;
    else el.value = '';
  });
  const ed = document.getElementById('sg-desc-editor');
  if (ed) ed.innerHTML = '';
  document.querySelectorAll('.sg-genre').forEach(c => { c.checked = false; });
  document.querySelectorAll('.sg-platform').forEach(c => { c.checked = (c.value === 'windows'); });
  document.querySelectorAll('.sg-ctrl').forEach(c => { c.checked = false; });
  document.querySelectorAll('.sg-content-flag').forEach(c => { c.checked = false; });
  ['sg-cover-preview','sg-banner-preview','sg-logo-preview','sg-icon-preview'].forEach(id => {
    const p = document.getElementById(id);
    if (!p) return;
    p.style.backgroundImage = '';
    p.classList.remove('has-img');
    p.innerHTML = '<span>' + (id.includes('cover') ? 'Обложка' : id.includes('banner') ? 'Баннер' : id.includes('logo') ? 'Логотип' : 'Иконка') + '</span>';
  });
  const shotsPrev = document.getElementById('sg-shots-preview');
  if (shotsPrev) shotsPrev.innerHTML = '';
  try { if (typeof fillSysReq === 'function') { fillSysReq('#sg-sys-min-fields', {}); fillSysReq('#sg-sys-rec-fields', {}); } } catch (e) {}
  try { if (typeof renderLangTable === 'function') renderLangTable('#sg-lang-table', []); } catch (e) {}
  try { if (typeof ensureTrailersEditorUi === 'function') { ensureTrailersEditorUi(); renderTrailersEditor(['']); } } catch (e) {}
  try { if (typeof syncPublishGenres === 'function') syncPublishGenres(); } catch (e) {}
  try { if (typeof syncPublishDescription === 'function') syncPublishDescription(); } catch (e) {}
  window.__importedGamePack = null;
  // сборка
  const bv = document.getElementById('sg-build-version');
  const bc = document.getElementById('sg-build-changelog');
  const bf = document.getElementById('sg-build-file');
  const bn = document.getElementById('sg-build-file-name');
  const be = document.getElementById('sg-build-existing');
  if (bv) { bv.value = ''; bv.placeholder = '1.0.0'; }
  if (bc) bc.value = '';
  if (bf) bf.value = '';
  window.__selectedBuildFile = null;
  if (bn) bn.textContent = 'ZIP / EXE / 7z…';
  if (be) { be.style.display = 'none'; be.innerHTML = ''; }
  // pack sgdb оставляем — пригодится в CATioGridDB до перезагрузки
}

function resetPublishFormMode() {
  window.__adminModeratingId = null;
  window.__adminPublishMode = false;
  window.__publishFormMode = 'submit';
  const formModal = document.getElementById('submit-form-modal');
  if (!formModal) return;
  const head = formModal.querySelector('.submit-modal-head h2') || formModal.querySelector('h2');
  if (head) head.textContent = 'Публикация игры';
  const sendBtn = document.getElementById('submit-game-send');
  if (sendBtn) {
    sendBtn.textContent = 'Отправить на модерацию';
    delete sendBtn.dataset.adminPublish;
    delete sendBtn.dataset.adminSave;
    delete sendBtn.dataset.publisherEdit;
    delete sendBtn.dataset.updateMode;
    sendBtn.disabled = false;
    sendBtn.classList.remove('is-disabled');
  }
  const rej = document.getElementById('submit-admin-reject');
  if (rej) { rej.classList.add('hidden'); rej.style.display = 'none'; }
  const extra = document.getElementById('sg-admin-extra-actions');
  if (extra) extra.remove();
  try { clearPublishFormFields(); } catch (e) {}
  try { ensurePublishAdminFooter(formModal, {}, null); } catch (e) {}
  window.__publishEditGameId = null;
  window.__adminModeratingId = null;
}

function ensurePublishAdminFooter(formModal, opts, g) {
  opts = opts || {};
  const foot = formModal.querySelector('.submit-modal-foot');
  if (!foot) return;

  // левая зона футера (импорт/экспорт/удалить)
  let left = foot.querySelector('.sg-foot-left');
  if (!left) {
    left = document.createElement('div');
    left.className = 'sg-foot-left';
    left.style.cssText = 'display:flex;gap:8px;align-items:center';
    // переносим существующий import, если он вложен иначе
    const oldImportBtn = foot.querySelector('#sg-import-pack-btn');
    const oldImportInput = foot.querySelector('#sg-import-pack');
    if (oldImportBtn && oldImportBtn.parentElement) {
      const parent = oldImportBtn.parentElement;
      left.appendChild(oldImportInput || document.createElement('span'));
      if (oldImportInput) left.appendChild(oldImportInput);
      left.appendChild(oldImportBtn);
      // если parent пустой служебный div — можно оставить
    }
    foot.insertBefore(left, foot.firstChild);
  }

  // гарантируем import input/btn
  let importInput = document.getElementById('sg-import-pack');
  let importBtn = document.getElementById('sg-import-pack-btn');
  if (!importInput) {
    importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.id = 'sg-import-pack';
    importInput.accept = '.zip,application/zip';
    importInput.hidden = true;
    left.appendChild(importInput);
  }
  if (!importBtn) {
    importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'hp-btn-edit';
    importBtn.id = 'sg-import-pack-btn';
    importBtn.textContent = 'Импорт';
    left.appendChild(importBtn);
  }

  // export + delete buttons
  let exportBtn = document.getElementById('sg-admin-export');
  if (!exportBtn) {
    exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'hp-btn-edit';
    exportBtn.id = 'sg-admin-export';
    exportBtn.textContent = 'Экспорт';
    left.appendChild(exportBtn);
  }
  let delBtn = document.getElementById('sg-admin-delete');
  if (!delBtn) {
    delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-danger';
    delBtn.id = 'sg-admin-delete';
    delBtn.textContent = 'Удалить карточку';
    left.appendChild(delBtn);
  }

  // порядок: Экспорт | Удалить | (Импорт только в submit)
  // переставим
  left.innerHTML = '';
  left.appendChild(importInput);

  const mode = opts.moderate ? 'moderate' : ((opts.adminEdit || opts.publisherEdit) ? 'adminEdit' : 'submit');
  // убрать устаревшую кнопку «Обновить» из футера
  const oldUpd = document.getElementById('sg-admin-update');
  if (oldUpd) try { oldUpd.remove(); } catch (e) {}

  if (mode === 'submit') {
    importBtn.style.display = '';
    importBtn.textContent = 'Импорт';
    left.appendChild(importBtn);
    exportBtn.style.display = 'none';
    delBtn.style.display = 'none';
  } else if (mode === 'adminEdit') {
    // админ чужой игры: Экспорт | Удалить
    importBtn.style.display = 'none';
    exportBtn.style.display = '';
    delBtn.style.display = '';
    left.appendChild(exportBtn);
    left.appendChild(delBtn);
  } else {
    // publisherEdit / moderate — без импорта/экспорта/удаления
    importBtn.style.display = 'none';
    exportBtn.style.display = 'none';
    delBtn.style.display = 'none';
  }

  // убрать старый extra блок если был
  const oldExtra = document.getElementById('sg-admin-extra-actions');
  if (oldExtra) oldExtra.remove();
  const oldRej = document.getElementById('sg-admin-reject');
  if (oldRej) oldRej.remove();
  // «Отклонить» только в модерации — иначе удаляем из DOM
  const rejBtn = document.getElementById('submit-admin-reject');
  if (rejBtn) {
    if (mode === 'moderate') {
      rejBtn.classList.remove('hidden');
      rejBtn.style.display = '';
    } else {
      try { rejBtn.remove(); } catch (e) {
        rejBtn.classList.add('hidden');
        rejBtn.style.display = 'none';
      }
    }
  }

  const gid = g && g.id;
  exportBtn.onclick = async () => {
    if (!gid) return;
    if (typeof runGamePackExport === 'function') {
      await runGamePackExport(gid);
    } else {
      toast('Экспорт недоступен');
    }
  };
  delBtn.onclick = async () => {
    if (!gid) return;
    const ok1 = await appConfirm({
      title: 'Удалить карточку игры?',
      message: 'Игра будет удалена из каталога и модерации.',
      okText: 'Удалить',
      danger: true
    });
    if (!ok1) return;
    const ok2 = await appConfirm({
      title: 'Точно удалить?',
      message: 'Это действие нельзя отменить. Введите свой код друга, чтобы подтвердить.',
      okText: 'Удалить навсегда',
      danger: true,
      requireFriendCode: true
    });
    if (!ok2) return;
    delBtn.disabled = true;
    try {
      const data = await postJSON((typeof SUBMIT_API !== 'undefined' ? SUBMIT_API : 'api/submit.php') + '?action=delete_game', { id: +gid });
      if (!data.ok) throw new Error(data.error || 'Не удалось удалить');
      toast('Игра удалена');
      try { homeCache = null; storeCache = []; if (typeof loadHome==='function') loadHome(); if (typeof loadStore==='function') loadStore(); } catch(e) {}
      formModal.classList.add('hidden');
      try { resetPublishFormMode(); } catch (e) {}
      // мгновенно убрать с главной / каталога
      try {
        homeCache = null;
        storeCache = [];
        const idNum = +gid;
        document.querySelectorAll('[data-game-id="' + idNum + '"], .game-card[data-id="' + idNum + '"], .store-card[data-id="' + idNum + '"]').forEach(el => el.remove());
        if (typeof loadHome === 'function') loadHome();
        if (typeof loadStore === 'function') loadStore();
        if (typeof loadSideLibrary === 'function') loadSideLibrary();
      } catch (e) { console.warn(e); }
      try { if (typeof loadAdminPending === 'function') loadAdminPending(); } catch (e) {}
      try { if (typeof gotoView === 'function') gotoView('home'); } catch (e) {}
    } catch (e) {
      toast(e.message || 'Ошибка удаления');
    } finally {
      delBtn.disabled = false;
    }
  };
}

async function openPublishFormForGame(g, opts) {
  opts = opts || {};
  const formModal = document.getElementById('submit-form-modal');
  if (!formModal) {
    toast('Модалка публикации не найдена');
    return;
  }
  const isPublisherEdit = !!opts.publisherEdit;
  const isAdminMode = !!(opts.adminEdit || opts.moderate) && !isPublisherEdit;
  window.__adminModeratingId = isAdminMode ? g.id : null;
  window.__publishEditGameId = (isPublisherEdit || isAdminMode) ? (g && g.id) : null;
  window.__adminPublishMode = isAdminMode;
  window.__publishFormMode = opts.moderate ? 'moderate' : (opts.adminEdit ? 'adminEdit' : 'submit');

  // заголовок ТОЛЬКО в этой модалке
  const head = formModal.querySelector('#submit-form-title') || formModal.querySelector('.sgdb-modal-head h3') || formModal.querySelector('h2, h3');
  if (head) {
    head.textContent = opts.moderate ? 'Модерация заявки' : (opts.publisherEdit ? 'Обновление карточки' : (opts.adminEdit ? 'Редактирование карточки' : 'Публикация игры'));
  }
  const sendBtn = document.getElementById('submit-game-send');
  if (sendBtn) {
    if (opts.moderate) {
      sendBtn.textContent = 'Опубликовать';
      sendBtn.dataset.adminPublish = '1';
      delete sendBtn.dataset.adminSave;
      delete sendBtn.dataset.publisherEdit;
    } else if (opts.publisherEdit) {
      sendBtn.textContent = 'Отправить на модерацию';
      delete sendBtn.dataset.adminPublish;
      delete sendBtn.dataset.adminSave;
      sendBtn.dataset.publisherEdit = '1';
      sendBtn.dataset.updateMode = '1';
    } else if (opts.adminEdit) {
      sendBtn.textContent = 'Сохранить';
      sendBtn.dataset.adminSave = '1';
      delete sendBtn.dataset.adminPublish;
      delete sendBtn.dataset.publisherEdit;
    } else {
      sendBtn.textContent = 'Отправить на модерацию';
      delete sendBtn.dataset.adminPublish;
      delete sendBtn.dataset.adminSave;
      delete sendBtn.dataset.publisherEdit;
    }
  }
  // доп. кнопки админа в футере модалки
  ensurePublishAdminFooter(formModal, opts, g);

  try { ensureTrailersEditorUi(); } catch (e) {}
  try { initPublishFilePreviews(formModal); initPublishPriceInput(); initPublishRte(); ensureTrailersEditorUi(); renderTrailersEditor(['']); } catch (e) {}

  const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
  set('sg-title', g.title || '');
  set('sg-developer', g.developer_name || g.developer || '');
  set('sg-short', g.short_description || '');
  set('sg-tags', g.tags || '');
  set('sg-price', g.price != null ? String(parseInt(g.price, 10) || 0) : '0');

  const genres = String(g.genre || '').split(/[,;]+/).map(s => s.trim()).filter(Boolean);
  document.querySelectorAll('.sg-genre').forEach(c => { c.checked = genres.some(x => x.toLowerCase() === String(c.value).toLowerCase()); });
  try { syncPublishGenres(); } catch (e) {}

  const ed = document.getElementById('sg-desc-editor');
  if (ed) ed.innerHTML = g.description || '';
  set('sg-desc', g.description || '');
  try { syncPublishDescription(); } catch (e) {}

  try { fillSysReq('#sg-sys-min-fields', g.sys_req_min); } catch (e) {}
  try { fillSysReq('#sg-sys-rec-fields', g.sys_req_rec); } catch (e) {}
  try {
    let langs = g.languages;
    if (typeof langs === 'string') { try { langs = JSON.parse(langs); } catch (e) { langs = []; } }
    if (Array.isArray(langs) && langs.length && typeof langs[0] === 'string') {
      langs = langs.map(name => ({ name, subtitles: true, audio: true }));
    }
    renderLangTable('#sg-lang-table', langs || []);
  } catch (e) {}

  // controllers
  let ctrls = String(g.controllers || '').toLowerCase().split(/[,;|]+/).map(s => s.trim()).filter(Boolean);
  document.querySelectorAll('.sg-ctrl').forEach(cb => {
    const v = String(cb.value).toLowerCase();
    cb.checked = ctrls.some(c => c === v || c.includes(v) || v.includes(c) || ['full','supported','partial'].includes(c));
  });

  // media previews
  const cover = g.cover_url || g.cover_src || '';
  const banner = g.banner_url || '';
  if (cover) {
    set('sg-cover-url', cover);
    setPubPreviewImg('sg-cover-preview', cover);
  }
  if (banner) {
    set('sg-banner-url', banner);
    setPubPreviewImg('sg-banner-preview', banner);
  }
  if (g.logo_url) {
    set('sg-logo-url', g.logo_url);
    setPubPreviewImg('sg-logo-preview', g.logo_url);
  }
  if (g.icon_url) {
    set('sg-icon-url', g.icon_url);
    setPubPreviewImg('sg-icon-preview', g.icon_url);
  }

  // trailers multi — video_url + game_media trailers
  const trailers = parseTrailerList(g.video_url);
  if (Array.isArray(g.videos)) {
    g.videos.forEach(v => {
      const u = v && (v.url || v.src);
      if (u && !trailers.includes(u)) trailers.push(u);
    });
  }
  if (Array.isArray(g.media)) {
    g.media.forEach(m => {
      const kind = String(m.kind || m.type || '').toLowerCase();
      if (['trailer', 'video', 'movie'].includes(kind)) {
        const u = (m.url || m.src || '').trim();
        if (u && !trailers.includes(u)) trailers.push(u);
      }
    });
  }
  try { ensureTrailersEditorUi(); } catch (e) {}
  renderTrailersEditor(trailers.length ? trailers : ['']);

  // screenshots preview from media
  try {
    const shotUrls = [];
    if (Array.isArray(g.screenshots)) {
      g.screenshots.forEach(s => {
        const u = typeof s === 'string' ? s : (s && (s.url || s.image_url));
        if (u) shotUrls.push(u);
      });
    }
    if (Array.isArray(g.media)) {
      g.media.forEach(m => {
        const kind = String(m.kind || m.type || '').toLowerCase();
        if (kind === 'screenshot' || kind === 'shot' || kind === 'screen') {
          const u = (m.url || '').trim();
          if (u && !shotUrls.includes(u)) shotUrls.push(u);
        }
      });
    }
    const urlsField = document.getElementById('sg-screenshots-urls');
    if (urlsField && shotUrls.length) urlsField.value = shotUrls.join('\n');
    const prevBox = document.getElementById('sg-shots-preview');
    if (prevBox) {
      if (shotUrls.length) {
        prevBox.innerHTML = shotUrls.map(u =>
          `<img src="${String(u).replace(/"/g, '&quot;')}" alt="" style="width:72px;height:48px;object-fit:cover;border-radius:6px;margin:4px" />`
        ).join('');
        prevBox.classList.remove('hidden');
        prevBox.style.display = 'flex';
        prevBox.style.flexWrap = 'wrap';
        prevBox.style.gap = '6px';
      } else {
        prevBox.innerHTML = '';
      }
    }
  } catch (e) { console.warn('shots preview', e); }

  // publishers
  try {
    await window.fillPublishPublisherSelect();
    if (g.publisher_id) {
      const sel = document.getElementById('sg-publisher-id');
      if (sel) {
        // ensure option exists even if not in "mine"
        if (![...sel.options].some(o => o.value === String(g.publisher_id))) {
          const opt = document.createElement('option');
          opt.value = String(g.publisher_id);
          opt.textContent = g.developer_name || g.publisher_name || ('Издательство #' + g.publisher_id);
          sel.appendChild(opt);
        }
        sel.value = String(g.publisher_id);
      }
      const hid = document.getElementById('sg-publisher');
      if (hid && (g.developer_name || g.publisher_name)) hid.value = g.developer_name || g.publisher_name;
    }
  } catch (e) {}

  // На модерации: разработчик и издательство только для просмотра
  try {
    const dev = document.getElementById('sg-developer');
    const pub = document.getElementById('sg-publisher-id');
    const isMod = !!(opts.moderate || opts.adminEdit);
    if (dev) {
      if (isMod) {
        dev.readOnly = true;
        dev.classList.add('is-readonly');
        dev.title = 'Только просмотр';
      } else {
        dev.readOnly = false;
        dev.classList.remove('is-readonly');
        dev.title = '';
      }
    }
    if (pub) {
      if (isMod) {
        pub.disabled = true;
        pub.classList.add('is-readonly');
        pub.title = 'Только просмотр';
      } else {
        pub.disabled = false;
        pub.classList.remove('is-readonly');
        pub.title = '';
      }
    }
  } catch (e) {}

  try { initPubFormTabs(); initPubMediaTabs(); initBuildsUi(); bindPublishValidationWatchers(); updatePublishSectionStatus(); } catch (e) {}
  if (g && g.id) {
    try { await loadGameBuildsIntoForm(g.id); } catch (e) {}
  } else {
    window.__pendingBuilds = [];
    try { renderPendingBuilds(); } catch (e) {}
  }
  // публикатор обновляет — нужна НОВАЯ версия и НОВЫЙ файл
  if (opts.publisherEdit) {
    const ver = document.getElementById('sg-build-version');
    const ch = document.getElementById('sg-build-changelog');
    const fi = document.getElementById('sg-build-file');
    const nameEl = document.getElementById('sg-build-file-name');
    const exist = document.getElementById('sg-build-existing');
    if (ver) { ver.value = ''; ver.placeholder = 'Новая версия, напр. 1.0.1'; }
    if (ch) ch.value = '';
    if (fi) fi.value = '';
    window.__selectedBuildFile = null;
    if (nameEl) {
      nameEl.textContent = 'Прикрепите новый файл сборки';
      nameEl.style.display = 'inline';
      nameEl.style.opacity = '1';
    }
    if (exist) { exist.style.display = 'none'; exist.innerHTML = ''; }
    const rej = document.getElementById('submit-admin-reject');
    if (rej) { try { rej.remove(); } catch (e) {} }
    try { updatePublishSectionStatus(); } catch (e) {}
  }
  formModal.classList.remove('hidden');
}

function isGamePublisherOf(g) {
  const me = window.AUTH_STATE && window.AUTH_STATE.user;
  if (!me || !g) return false;
  if (+g.submitted_by === +me.id) return true;
  if (+g.user_id === +me.id) return true;
  return false;
}

function openAdminGameEditModal(g) {
  if (!g) return;
  // Только админское редактирование карточки (не обновление версии)
  openPublishFormForGame(g, { adminEdit: true });
  const rej = document.getElementById('submit-admin-reject');
  if (rej) { try { rej.remove(); } catch (e) { rej.classList.add('hidden'); rej.style.display = 'none'; } }
}

function bindAdminGameEdit(g, viewer) {
  const btn = document.getElementById('gp-admin-edit');
  if (btn && viewer?.is_admin) {
    btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openAdminGameEditModal(g); };
  }
  const upd = document.getElementById('gp-game-update');
  if (upd) {
    upd.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openGameUpdateModal(g); };
  }
}

function openGameUpdateModal(g) {
  if (!g || !g.id) { toast('Нет игры'); return; }
  let modal = document.getElementById('game-update-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'game-update-modal';
    modal.className = 'submit-modal';
    modal.innerHTML = `
      <div class="submit-modal-backdrop" data-close-upd></div>
      <div class="submit-modal-box" style="max-width:440px">
        <div class="submit-modal-head">
          <h2>Обновить версию</h2>
          <button type="button" class="friends-modal-close" data-close-upd aria-label="Закрыть">×</button>
        </div>
        <div class="submit-modal-body" style="display:flex;flex-direction:column;gap:12px">
          <p class="settings-hint" style="margin:0">Новый файл уйдёт на проверку. После одобрения появится в списке сборок.</p>
          <label class="ws-ff"><span>Версия *</span>
            <input type="text" class="auth-input" id="upd-version" placeholder="1.0.1" maxlength="32" />
          </label>
          <label class="ws-ff"><span>Что нового *</span>
            <textarea class="auth-input" id="upd-changelog" rows="3" placeholder="Кратко об изменениях…" maxlength="1000" style="resize:vertical"></textarea>
          </label>
          <div class="ws-ff">
            <span>Файл сборки *</span>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">
              <label class="pub-file-btn" for="upd-file">Выбрать файл</label>
              <input type="file" id="upd-file" accept=".exe,.zip,.7z,.rar,.msi,.dmg,.appimage,.tar,.gz" hidden />
              <span class="settings-hint" id="upd-file-name">ZIP / EXE / 7z…</span>
            </div>
          </div>
        </div>
        <div class="submit-modal-foot" style="display:flex;justify-content:flex-end;gap:8px">
          <button type="button" class="hp-btn-edit" data-close-upd>Отмена</button>
          <button type="button" class="hp-btn-edit" id="upd-send" style="background:var(--accent);color:#12110e;border-color:var(--accent)">Отправить на проверку</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-upd]')) modal.classList.add('hidden');
    });
    const fileInput = modal.querySelector('#upd-file');
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      const nameEl = modal.querySelector('#upd-file-name');
      if (!nameEl) return;
      if (f) {
        const sz = (typeof formatBytes === 'function') ? formatBytes(f.size) : ((f.size / 1048576).toFixed(1) + ' МБ');
        nameEl.textContent = f.name + ' · ' + sz;
        nameEl.style.color = 'var(--text-bright)';
        nameEl.style.fontWeight = '600';
      } else {
        nameEl.textContent = 'ZIP / EXE / 7z…';
        nameEl.style.fontWeight = '';
      }
    });
  }
  // bind send to current game
  const sendBtn = modal.querySelector('#upd-send');
  const fileInput = modal.querySelector('#upd-file');
  sendBtn.onclick = async () => {
    const version = (modal.querySelector('#upd-version')?.value || '').trim();
    const changelog = (modal.querySelector('#upd-changelog')?.value || '').trim();
    const file = fileInput.files && fileInput.files[0];
    if (!version) { toast('Укажите версию'); return; }
    if (!changelog) { toast('Укажите, что нового'); return; }
    if (!file) { toast('Прикрепите файл'); return; }
    sendBtn.disabled = true;
    sendBtn.textContent = 'Отправка…';
    try {
      const fd = new FormData();
      fd.append('csrf_token', window.CSRF_TOKEN || '');
      fd.append('game_id', String(g.id));
      fd.append('version', version);
      fd.append('changelog', changelog);
      fd.append('build_file', file, file.name);
      const res = await fetch((typeof SUBMIT_API !== 'undefined' ? SUBMIT_API : 'api/submit.php') + '?action=submit_update', { method: 'POST', body: fd });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Ошибка');
      toast('Обновление отправлено на проверку');
      modal.classList.add('hidden');
    } catch (err) {
      toast(err.message || 'Не удалось отправить');
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Отправить на проверку';
    }
  };
  modal.querySelector('#upd-version').value = '';
  modal.querySelector('#upd-changelog').value = '';
  fileInput.value = '';
  const n = modal.querySelector('#upd-file-name');
  if (n) { n.textContent = 'ZIP / EXE / 7z…'; n.style.fontWeight = ''; }
  modal.classList.remove('hidden');
}
window.openGameUpdateModal = openGameUpdateModal;


async function loadSgdbAssetsForName(name) {
  // онлайн поиск отключён — только локальные/ZIP ассеты
  if (typeof window.loadSgdbAssetsGlobal === 'function') return window.loadSgdbAssetsGlobal('icons');
  return;

  const q = String(name || '').trim();
  if (q.length < 2) return;
  const grid = document.getElementById('sgdb-grid') || document.querySelector('.sgdb-grid');
  if (grid) grid.innerHTML = '<div class="loading">Только ассеты из ZIP-пакета (онлайн API отключён)</div>';
  try {
    const data = await fetchJSON('api/game_pack.php?action=sgdb_by_name&q=' + encodeURIComponent(q));
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const first = (data.results || [])[0];
    if (!first) {
      if (grid) grid.innerHTML = '<div class="loading">Ничего не найдено в CATioGridDB</div>';
      return;
    }
    window.__sgdbGameId = first.id;
    const assets = await fetchJSON('api/game_pack.php?action=sgdb_by_name&q=' + encodeURIComponent(q) + '&sgdb_id=' + first.id);
    if (!assets.ok) throw new Error(assets.error || 'Ошибка ассетов');
    window.__sgdbAssetsByName = assets.assets || {};
    // показать covers по умолчанию
    const list = (assets.assets && assets.assets.covers) || [];
    if (grid) {
      if (!list.length) grid.innerHTML = '<div class="loading">Ассеты не найдены</div>';
      else {
        grid.innerHTML = list.map(a => {
          const u = a.url || a.thumb;
          const th = a.thumb || a.url;
          return '<button type="button" class="sgdb-grid-item" data-url="' + escapeHtml(u) + '"><img src="' + escapeHtml(th) + '" alt="" loading="lazy" /></button>';
        }).join('');
      }
    }
    toast('CATioGridDB: ' + first.name);
  } catch (e) {
    if (grid) grid.innerHTML = '<div class="loading">' + escapeHtml(e.message || 'Ошибка') + '</div>';
  }
}


function getLocalGameAssets(gameId) {
  try {
    const raw = localStorage.getItem('catio_local_assets_' + gameId);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function setLocalGameAssets(gameId, assets) {
  try {
    localStorage.setItem('catio_local_assets_' + gameId, JSON.stringify(assets || {}));
  } catch (e) {}
}
async function saveGameAssetsSelection(payload) {
  const gameId = payload.game_id || window.__steamEditGameId;
  payload = { ...(payload || {}), game_id: gameId, csrf_token: payload.csrf_token || window.CSRF_TOKEN || '' };
  // админ/владелец — сохраняем через games.php (локальные uploads/ и http)
  try {
    const res = await postJSON((typeof API_BASE !== 'undefined' ? API_BASE : 'api/games.php') + '?action=update_assets', payload, typeof FETCH_TIMEOUT_LONG !== 'undefined' ? FETCH_TIMEOUT_LONG : 60000);
    if (res && res.ok) return res;
    // если сервер отказал не-админу — локально
    if (window.__assetsLocalOnly || (res && res.error)) {
      const cur = getLocalGameAssets(gameId) || {};
      const next = { ...cur, ...payload, updated_at: Date.now() };
      setLocalGameAssets(gameId, next);
      return { ok: true, local: true };
    }
    return res || { ok: false, error: 'Ошибка сохранения' };
  } catch (e) {
    if (window.__assetsLocalOnly) {
      const cur = getLocalGameAssets(gameId) || {};
      setLocalGameAssets(gameId, { ...cur, ...payload, updated_at: Date.now() });
      return { ok: true, local: true };
    }
    throw e;
  }
}

/** Открыть модалку оформления (как Hydra) для конкретной игры */
function openGameAssetsModal(g) {
  const modal = document.getElementById('steam-import-modal');
  if (!modal) {
    toast('Модалка не найдена');
    return;
  }
  window.__steamEditGameData = g || null;
  if (g && Array.isArray(g.screenshots)) window.__lastGameScreenshots = g.screenshots;

  let appId = parseInt(g.steam_appid, 10) || 0;
  if (!appId && g.slug) {
    const m = String(g.slug).match(/-s(\d{3,10})$/);
    if (m) appId = parseInt(m[1], 10);
  }
  if (!appId) {
    // non-steam: откроем модалку и поищем в CATioGridDB по названию
    window.__steamEditMode = true;
    window.__steamEditGameId = Number(g.id);
    window.__steamAppId = 0;
    window.__sgdbNameQuery = g.title || '';
    const modal2 = document.getElementById('steam-import-modal');
    if (!modal2) { toast('Модалка не найдена'); return; }
    const title = document.getElementById('sgdb-modal-title');
    if (title) title.textContent = g.title || 'Игра';
    const it = document.getElementById('sgdb-info-title');
    if (it) it.textContent = g.title || '—';
    const ia = document.getElementById('sgdb-info-appid');
    if (ia) ia.textContent = 'non-steam';
    const iid = document.getElementById('sgdb-info-id');
    if (iid) iid.textContent = String(g.id);
    modal2.classList.remove('hidden');
    // подгрузить ассеты по имени
    try {
      if (typeof window.loadSgdbAssetsGlobal === 'function') window.loadSgdbAssetsGlobal('icons');
      else if (typeof loadSgdbAssets === 'function') loadSgdbAssets('icons');
    } catch (e) { console.warn(e); }
    try {
      fillGameSettingsPath(g);
      fillGameSettingsDownloads(g.id);
      fillGameSettingsDanger(g.id);
      fillGameSettingsMods(g.id);
    } catch (e) {}
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

  // Админ = глобально для всех; обычный = только локально у себя
  const auth = window.AUTH_STATE || {};
  const u = auth.user || auth || {};
  const isAdmin = !!(u.role === 'admin' || u.is_admin === true || u.is_admin === 1 || u.is_admin === '1' || auth.role === 'admin');
  window.__assetsLocalOnly = !isAdmin;
  const warn = modal.querySelector('.sgdb-warn');
  if (warn) {
    warn.style.display = isAdmin ? 'none' : '';
    warn.textContent = isAdmin
      ? ''
      : 'Изменения применятся только у вас локально. Глобально для всех может менять только админ.';
  }
  const srcLabel = modal.querySelector('.sgdb-source-label');
  if (srcLabel) srcLabel.textContent = 'CATioGridDB';

  try {
    fillGameSettingsPath(g);
    fillGameSettingsDownloads(g.id);
    fillGameSettingsDanger(g.id);
      fillGameSettingsMods(g.id);
  } catch (e) {}
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  // если в пакете были CATioGridDB ассеты — подставить в кэш
  if (window.__packSgdbAssets) {
    window.__sgdbAssetsFromPack = window.__packSgdbAssets;
  }
  setTimeout(() => {
    if (window.__sgdbAssetsFromPack && typeof window.renderSgdbPackAssets === 'function') {
      window.renderSgdbPackAssets('icons');
    } else if (typeof window.loadSgdbAssetsGlobal === 'function') {
      window.loadSgdbAssetsGlobal('icons');
    } else {
      document.querySelector('.sgdb-asset-tab[data-asset-type="icons"]')?.click();
    }
  }, 40);
}

function renderSgdbPackAssets(type) {
  const pack = window.__sgdbAssetsFromPack || window.__packSgdbAssets;
  if (!pack) return false;
  const key = type === 'covers' || type === 'grids' ? 'grids' : type;
  let list = pack[key] || pack[type] || (key === 'grids' ? pack.covers : null) || [];
  if (!Array.isArray(list)) list = [];
  list = list.map(a => {
    if (!a) return null;
    if (typeof a === 'string') return { url: a, thumb: a };
    const url = a.url || a.file || a.thumb || '';
    if (!url) return null;
    return { url, thumb: a.thumb || url };
  }).filter(Boolean);
  const grid = document.getElementById('sgdb-asset-grid') || document.querySelector('.sgdb-asset-grid') || document.getElementById('sgdb-grid');
  if (!grid) return false;
  if (!list.length) {
    grid.innerHTML = '<div class="settings-hint">В пакете нет ассетов для этой вкладки</div>';
    return true;
  }
  // делегируем штатному рендеру, если есть
  if (typeof renderSgdbGrid === 'function') {
    try { renderSgdbGrid(list, type); return true; } catch (e) {}
  }
  grid.className = 'sgdb-asset-grid is-' + type;
  grid.innerHTML = list.map(a => {
    const u = a.url || a.thumb;
    const th = a.thumb || a.url;
    return '<button type="button" class="sgdb-grid-item is-' + type + '" data-url="' + escapeHtml(u) + '"><img src="' + escapeHtml(th) + '" alt="" loading="lazy" onerror="this.onerror=null;const b=this.closest(&quot;.sgdb-grid-item&quot;);if(b)b.remove();" /></button>';
  }).join('');
  grid.querySelectorAll('.sgdb-grid-item').forEach(btn => {
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.sgdb-grid-item').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      if (typeof selectSgdbAsset === 'function') selectSgdbAsset(btn.dataset.url, type);
      else if (typeof window.selectSgdbAsset === 'function') window.selectSgdbAsset(btn.dataset.url, type);
    });
  });
  return true;
}
window.renderSgdbPackAssets = renderSgdbPackAssets;
if (!window.__sgdbPackTabDelegate) {
  window.__sgdbPackTabDelegate = true;
  document.addEventListener('click', (e) => {
    const tab = e.target.closest && e.target.closest('.sgdb-asset-tab');
    if (!tab) return;
    if (!window.__sgdbAssetsFromPack && !window.__packSgdbAssets) return;
    const type = tab.dataset.assetType || 'icons';
    // дать штатному обработчику сработать, потом перерисовать из пакета
    setTimeout(() => { try { renderSgdbPackAssets(type); } catch (err) {} }, 30);
  });
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
//  БИБЛИОТЕКА (Hydra-like)
// ============================================================
let libraryCache = [];
let libraryFilter = 'all'; // all | modern | classics
let libraryInstalledOnly = false;
let librarySearch = '';
let librarySort = 'name';
let libraryView = localStorage.getItem('catio_library_view') || 'grid';

function libraryCountLabel(n) {
  const k = n % 100;
  const k1 = n % 10;
  if (k > 10 && k < 20) return n + ' игр';
  if (k1 === 1) return n + ' игра';
  if (k1 >= 2 && k1 <= 4) return n + ' игры';
  return n + ' игр';
}

function isClassicGame(g) {
  // классика: тег/жанр retro/classic/emulator или category classics
  const blob = [
    g.category, g.genre, g.tags, g.era, g.platform
  ].filter(Boolean).join(' ').toLowerCase();
  if (/\b(classic|classics|retro|emulator|эмулятор|классик|ретро)\b/.test(blob)) return true;
  const year = parseInt(g.release_year || g.year || 0, 10);
  if (year && year > 0 && year < 2008) return true;
  return false;
}

async function loadLibrary() {
  const grid = $('#library-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="library-loading"><div class="loading">Загрузка библиотеки...</div></div>';

  try {
    const data = await fetchJSON(`${API_BASE}?action=library`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    libraryCache = data.library || [];
    renderLibraryGrid();
    try { if (typeof loadSideLibrary === 'function') loadSideLibrary(); } catch (e) {}
  } catch (err) {
    if (isOffline(err)) {
      renderOffline(grid, loadLibrary, 'Кот ушёл в запой');
    } else {
      grid.innerHTML = `<div class="library-empty library-empty-centered">
        <p class="library-empty-title">Ошибка загрузки</p>
        <p class="library-empty-sub">${escapeHtml(err.message || '')}</p>
        <button type="button" class="btn-primary" id="library-retry">Повторить</button>
      </div>`;
      grid.querySelector('#library-retry')?.addEventListener('click', loadLibrary);
    }
  }
}

function getFilteredLibraryItems() {
  let items = libraryCache.slice();
  const installedIds = getInstalledIds();

  if (libraryFilter === 'modern') {
    items = items.filter(g => !isClassicGame(g));
  } else if (libraryFilter === 'classics') {
    items = items.filter(g => isClassicGame(g));
  }

  if (libraryInstalledOnly) {
    items = items.filter(g => installedIds.includes(+g.id));
  }

  // header search or local
  const qHead = (document.querySelector('#head-search, .head-search input, input[name="q"]')?.value || '').trim();
  const q = (librarySearch || qHead).toLowerCase();
  if (q) {
    items = items.filter(g =>
      (g.title || '').toLowerCase().includes(q) ||
      (g.genre || '').toLowerCase().includes(q) ||
      (g.developer_name || '').toLowerCase().includes(q)
    );
  }

  const isInst = (g) => installedIds.includes(+g.id);

  if (librarySort === 'name') {
    items.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ru'));
  } else if (librarySort === 'name_desc') {
    items.sort((a, b) => (b.title || '').localeCompare(a.title || '', 'ru'));
  } else if (librarySort === 'playtime') {
    items.sort((a, b) => (parseInt(b.playtime_minutes, 10) || 0) - (parseInt(a.playtime_minutes, 10) || 0));
  } else if (librarySort === 'played') {
    items.sort((a, b) => String(b.last_played || '').localeCompare(String(a.last_played || '')));
  } else if (librarySort === 'installed') {
    items.sort((a, b) => (isInst(b) ? 1 : 0) - (isInst(a) ? 1 : 0) || (a.title || '').localeCompare(b.title || '', 'ru'));
  }

  return items;
}

function formatLibPlaytime(mins) {
  mins = parseInt(mins, 10) || 0;
  if (mins <= 0) return '0 м';
  if (mins < 60) return mins + ' м';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 100) return h + ' ч';
  return m ? (h + ' ч ' + m + ' м') : (h + ' ч');
}

function renderLibraryGrid() {
  const grid = $('#library-grid');
  if (!grid) return;

  grid.classList.remove('is-grid', 'is-compact', 'is-large');
  grid.classList.add(libraryView === 'compact' ? 'is-compact' : (libraryView === 'large' ? 'is-large' : 'is-grid'));

  const items = getFilteredLibraryItems();

  if (!items.length) {
    const filtered = libraryCache.length > 0;
    grid.innerHTML = filtered
      ? `<div class="library-empty library-empty-centered">
          <div class="library-empty-icon" aria-hidden="true">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          </div>
          <p class="library-empty-title">Ничего не найдено</p>
          <p class="library-empty-sub">Попробуйте другой фильтр</p>
        </div>`
      : `<div class="library-empty library-empty-centered">
          <div class="library-empty-icon" aria-hidden="true">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          </div>
          <p class="library-empty-title">Библиотека пуста</p>
          <p class="library-empty-sub">Здесь появятся игры, которые вы купите или получите</p>
          <button type="button" class="btn-primary" id="library-go-store">В каталог</button>
        </div>`;
    grid.querySelector('#library-go-store')?.addEventListener('click', () => gotoView('store'));
    return;
  }

  const installed = getInstalledIds();
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();

  items.forEach(g => {
    const isInstalled = installed.includes(+g.id);
    const mins = parseInt(g.playtime_minutes, 10) || 0;
    const timeLabel = formatLibPlaytime(mins);
    // как в профиле: cover, не icon (icon часто от другой/steam-игры)
    const cover = g.cover_src || g.cover_url || ('media.php?type=cover&id=' + g.id);
    const achU = parseInt(g.ach_unlocked, 10) || 0;
    const achT = parseInt(g.ach_total, 10) || 0;
    const hasAch = achT > 0;
    const achPct = hasAch ? Math.min(100, Math.round((achU / achT) * 100)) : 0;
    const achLeft = hasAch
      ? `<span class="hp-game-ach-count"><svg class="hp-game-ach-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h12v2a4 4 0 0 1-4 4h-1v2.26A6.5 6.5 0 0 1 16.5 20H15a3 3 0 0 0-6 0H7.5A6.5 6.5 0 0 1 11 12.26V10H10a4 4 0 0 1-4-4V4zm2 2v.5A2 2 0 0 0 10 8.5h4A2 2 0 0 0 16 6.5V6H8z"/></svg>${achU}/${achT}</span>`
      : `<span class="hp-game-ach-count muted">Нет ачивок</span>`;

    const card = document.createElement('article');
    card.className = 'lib-card' + (isInstalled ? ' is-installed' : '');
    card.dataset.id = g.id;
    card.tabIndex = 0;
    card.innerHTML = `
      <div class="lib-card-cover">
        <img src="${escapeHtml(cover)}" alt="${escapeHtml(g.title || '')}" loading="lazy" />
        <div class="lib-card-time" title="Время в игре">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          ${escapeHtml(timeLabel)}
        </div>
                <div class="hp-game-ach">
          <div class="hp-game-ach-row">
            ${achLeft}
            <span class="hp-game-ach-pct">${achPct}%</span>
          </div>
          <div class="hp-game-ach-bar"><span style="width:${achPct}%"></span></div>
        </div>
      </div>
    `;
    card.addEventListener('click', () => gotoGame(g.id));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        gotoGame(g.id);
      }
    });
    frag.appendChild(card);
  });
  grid.appendChild(frag);
}

function initLibraryControls() {
  const filters = $('#library-filters');
  if (filters && filters.dataset.bound !== '1') {
    filters.dataset.bound = '1';
    $$('.library-era-btn', filters).forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.library-era-btn', filters).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        libraryFilter = btn.dataset.filter || 'all';
        renderLibraryGrid();
      });
    });
  }

  const instBtn = $('#library-installed-only');
  if (instBtn && instBtn.dataset.bound !== '1') {
    instBtn.dataset.bound = '1';
    instBtn.addEventListener('click', () => {
      libraryInstalledOnly = !libraryInstalledOnly;
      instBtn.classList.toggle('active', libraryInstalledOnly);
      instBtn.setAttribute('aria-pressed', libraryInstalledOnly ? 'true' : 'false');
      renderLibraryGrid();
    });
  }

  const sort = $('#library-sort');
  if (sort && sort.dataset.bound !== '1') {
    sort.dataset.bound = '1';
    sort.value = librarySort;
    sort.addEventListener('change', () => {
      librarySort = sort.value;
      renderLibraryGrid();
    });
  }

  const viewToggle = $('#library-view-toggle');
  if (viewToggle && viewToggle.dataset.bound !== '1') {
    viewToggle.dataset.bound = '1';
    $$('.library-view-btn', viewToggle).forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === libraryView);
      btn.addEventListener('click', () => {
        $$('.library-view-btn', viewToggle).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        libraryView = btn.dataset.view || 'grid';
        try { localStorage.setItem('catio_library_view', libraryView); } catch (e) {}
        renderLibraryGrid();
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

function isGameDownloading(gameId) {
  gameId = +gameId;
  if (!gameId) return false;
  if (dm.active && +dm.active.gameId === gameId) return true;
  if (dm.queue && dm.queue.some(q => +q.gameId === gameId)) return true;
  if (dm.pausedItem && +dm.pausedItem.gameId === gameId) return true;
  return false;
}
function refreshGameInstallButton(gameId) {
  gameId = +gameId;
  try {
    const g = (window.__currentGame && +window.__currentGame.id === gameId)
      ? window.__currentGame
      : (window.__currentGamePage && +window.__currentGamePage.id === gameId ? window.__currentGamePage : null);
    if (g && typeof refreshBuyButton === 'function') refreshBuyButton(g);
  } catch (e) {}
  // кнопки сборок на странице
  try {
    document.querySelectorAll('.btn-download[data-build-id]').forEach(btn => {
      // не трогаем locked/installed — только активные «Установить»
      if (btn.disabled && btn.dataset.mode !== 'installing') return;
    });
  } catch (e) {}
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
  // та же игра уже качается / в очереди
  if (item.gameId && isGameDownloading(item.gameId)) {
    toast('Эта игра уже устанавливается');
    refreshGameInstallButton(item.gameId);
    return;
  }
  item.id = ++dm.seq;
  item.received = 0;
  item.status = 'queued';
  dm.queue.push(item);
  toast(`«${item.title}» добавлена в загрузки`);
  updateDownloadsBadge();
  if (item.gameId) refreshGameInstallButton(item.gameId);
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
  if (item.gameId) refreshGameInstallButton(item.gameId);

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
    if (!item.preDownload) {
      markVersionInstalled(item.gameId, item.version, item.buildId, item.received);
      markInstalled(item.gameId);
    }
    toast(item.preDownload ? `Предзагрузка «${item.title}» готова` : `«${item.title}» установлена`);
    // обновить кнопку на странице игры
    try {
      if (item.gameId) refreshGameInstallButton(item.gameId);
      const buildsBox = document.getElementById('game-builds');
      const pageGame = window.__currentGamePage || window.__currentGame;
      if (buildsBox && pageGame && +pageGame.id === +item.gameId) {
        buildsBox.innerHTML = renderBuildsList(window.__currentGameBuilds || [], pageGame);
        initBuildButtons(document.getElementById('game-page') || document, pageGame);
      }
    } catch (e) {}
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
    if (item.gameId) refreshGameInstallButton(item.gameId);
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
        <div class="downloads-empty-icon" aria-hidden="true">
          <svg width="88" height="88" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 19h14"/>
          </svg>
        </div>
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

function publisherGameCardHtml(g) {
  const cover = g.cover_src || g.cover_url || ('media.php?type=cover&id=' + g.id);
  const price = formatPrice(g.price, g.discount_percent);
  const owned = !!(g.owned === 1 || g.owned === true || g.owned === '1');
  let priceHtml = '';
  if (!owned) {
    if (price.className === 'free') {
      priceHtml = `<span class="hp-game-price is-free">Бесплатно</span>`;
    } else if (price.discount > 0) {
      priceHtml = `<span class="hp-game-price is-sale"><span class="hp-game-price-disc">-${price.discount}%</span><span class="hp-game-price-col"><span class="hp-game-price-old">${escapeHtml(price.original)}</span><span class="hp-game-price-final">${escapeHtml(price.text)}</span></span></span>`;
    } else {
      priceHtml = `<span class="hp-game-price">${escapeHtml(price.text)}</span>`;
    }
  }
  let actionBtn = '';
  if (owned) {
    actionBtn = `<button type="button" class="game-item__plus-wrapper is-owned" data-id="${g.id}" title="В библиотеке" disabled>
      <svg class="gi-icon gi-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
    </button>`;
  } else {
    const title = price.className === 'free' ? 'В библиотеку' : 'В корзину';
    actionBtn = `<button type="button" class="game-item__plus-wrapper is-add" data-id="${g.id}" data-price="${escapeHtml(String(g.price ?? 0))}" data-discount="${escapeHtml(String(g.discount_percent ?? 0))}" title="${title}">
      <svg class="gi-icon gi-plus" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
    </button>`;
  }
  return `
    <div class="hp-game-card" data-id="${g.id}" data-title="${escapeHtml((g.title || '').toLowerCase())}">
      <img src="${escapeHtml(cover)}" alt="${escapeHtml(g.title)}" loading="lazy" />
      ${priceHtml}
      ${actionBtn}
    </div>`;
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
  // restore own toolbar if was viewing foreign profile (только toolbar профиля!)
  const toolbar = document.querySelector('#view-profile .hp-toolbar') || document.querySelector('#hp-hero .hp-toolbar');
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
  // вернуть боковые карточки (могли быть скрыты на чужом профиле)
  ['#hp-activity', '#hp-friends-list'].forEach(sel => {
    const el = $(sel);
    if (el) setSideCardVisible(el, true);
  });
  await Promise.all([
    loadProfileStats(),
    loadProfileActivity(),
    loadProfileFriends(),
    loadProfileLibrary(),
  ]);
  loadProfileReviews(null);
  initProfileControls();
  try {
    const me2 = window.AUTH_STATE && window.AUTH_STATE.user;
    if (me2 && me2.id) {
      const line = document.getElementById('hp-publisher-line');
      if (line) line.dataset.forUser = String(me2.id);
      // если в AUTH уже 0 — сразу прячем, потом сверим с API
      if (me2.display_publisher_id === 0 || me2.display_publisher_id === '0') {
        renderPublisherLine(line, []);
      }
      await loadProfilePublishers(me2.id);
    }
  } catch (e) {}
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
      setAccordionHTML(box, '');
      setSideCardVisible(box, false);
      return;
    }
    setSideCardVisible(box, true);
    setAccordionHTML(box, data.activity.slice(0, 8).map(a => {
      const title = a.title || a.text || 'Игра';
      const timeLabel = a.playtime_minutes
        ? formatPlaytimeShort(a.playtime_minutes)
        : (a.ts ? formatDateTime(a.ts) : '');
      const cover = a.game_id ? ('media.php?type=cover&id=' + a.game_id) : '';
      return (
        '<div class="hp-friend-row hp-activity-item" data-id="' + (a.game_id || '') + '">' +
          '<div class="hp-friend-avatar" style="' + (cover ? ('background-image:url(\'' + cover + '\')') : 'background:#3a3632') + '">' + (cover ? '' : '•') + '</div>' +
          '<div class="hp-friend-text">' +
            '<div class="hp-friend-name">' + escapeHtml(title) + '</div>' +
            '<div class="hp-friend-status">' + escapeHtml(timeLabel) + '</div>' +
          '</div>' +
        '</div>'
      );
    }).join(''));

    $$('.hp-activity-item', box).forEach(item => {
      item.addEventListener('click', () => {
        if (item.dataset.id) gotoGame(item.dataset.id);
      });
    });
  } catch (err) {
    setAccordionHTML(box, '');
    setSideCardVisible(box, false);
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

async function loadProfileScreenshots() {
  const emptyEl = $('#hp-screenshots-empty');
  const grid = $('#hp-screenshots-grid');
  if (!grid) return;
  // только медиа ЭТОГО профиля — не чужой кэш
  const authId = (window.AUTH_STATE && window.AUTH_STATE.user && window.AUTH_STATE.user.id)
    || (window.CURRENT_USER && window.CURRENT_USER.id)
    || 0;
  const uid = viewingUserId ? +viewingUserId : +authId;
  const reqToken = String(uid) + ':' + Date.now();
  grid.dataset.shotsFor = String(uid || '');
  grid.dataset.shotsToken = reqToken;
  grid.innerHTML = '';
  if (!uid) {
    if (emptyEl) emptyEl.classList.remove('hidden');
    grid.classList.add('hidden');
    return;
  }
  if (emptyEl) {
    emptyEl.classList.remove('hidden');
    emptyEl.querySelector('.hp-empty-title') && (emptyEl.querySelector('.hp-empty-title').textContent = 'Загрузка…');
  }
  try {
    const data = await fetchJSON(`api/workshop.php?action=media&user_id=${uid}&limit=48&_t=${Date.now()}`);
    // устаревший ответ (уже открыли другой профиль)
    if (grid.dataset.shotsToken !== reqToken || String(grid.dataset.shotsFor) !== String(uid)) return;
    // если ушли на другой профиль
    const still = viewingUserId ? +viewingUserId : +authId;
    if (+still !== +uid) return;

    let list = (data && data.ok && Array.isArray(data.media)) ? data.media : [];
    // жёстко только user_id этого профиля
    list = list.filter(m => +m.user_id === +uid || !m.user_id);
    const cards = list.map(m => {
      const src = (typeof mediaCoverUrl === 'function' ? mediaCoverUrl(m) : (m.image_url || ''));
      const title = escapeHtml(m.title || m.game_title || 'Скриншот');
      if (!src) return '';
      // доп. проверка: если API отдал чужой user_id — пропуск
      if (m.user_id && +m.user_id !== +uid) return '';
      return `<button type="button" class="hp-shot-card" data-user-id="${uid}" data-media-id="${m.id || ''}" data-src="${escapeHtml(src)}" title="${title}">
        <img src="${escapeHtml(src)}" alt="${title}" loading="lazy" onerror="this.closest('.hp-shot-card')?.remove();" />
      </button>`;
    }).filter(Boolean);

    if (!cards.length) {
      if (emptyEl) {
        emptyEl.classList.remove('hidden');
        const t = emptyEl.querySelector('.hp-empty-title');
        if (t) t.textContent = 'Пока нет скриншотов';
      }
      grid.classList.add('hidden');
      grid.innerHTML = '';
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    grid.classList.remove('hidden');
    grid.innerHTML = cards.join('');
    $$('.hp-shot-card', grid).forEach(btn => {
      btn.addEventListener('click', () => {
        // защита от чужих карточек
        if (btn.dataset.userId && +btn.dataset.userId !== +uid) return;
        const mid = +btn.dataset.mediaId;
        if (mid && typeof openWorkshopMediaView === 'function') openWorkshopMediaView(mid);
        else if (btn.dataset.src && typeof openLightbox === 'function') openLightbox(btn.dataset.src);
      });
    });
  } catch (err) {
    if (grid.dataset.shotsToken !== reqToken) return;
    if (emptyEl) {
      emptyEl.classList.remove('hidden');
      const t = emptyEl.querySelector('.hp-empty-title');
      if (t) t.textContent = 'Пока нет скриншотов';
    }
    grid.classList.add('hidden');
    grid.innerHTML = '';
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
  const libSectionHead = $('#hp-library-section .hp-section-head');
  if (libCount) libCount.textContent = rest.length;
  if (libBox) {
    if (!rest.length && !pinned.length) {
      if (libSectionHead) libSectionHead.style.display = 'none';
      libBox.innerHTML = `<div class="hp-empty hp-empty-centered">
        <div class="hp-empty-logo" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8M8 11h5"/></svg>
        </div>
        <div class="hp-empty-text">Загляни в каталог — здесь появятся твои игры</div>
      </div>`;
    } else if (!rest.length) {
      if (libSectionHead) libSectionHead.style.display = '';
      libBox.innerHTML = '<div class="hp-empty hp-empty-centered"><div class="hp-empty-text">Все игры закреплены сверху.</div></div>';
    } else {
      if (libSectionHead) libSectionHead.style.display = '';
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
      ['reviews', 'screenshots'].forEach(p => {
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
      if (name === 'screenshots') {
        loadProfileScreenshots();
      }
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

  prepareAccordions(document);
  $$('.hp-side-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('.hp-side-card');
      if (!card) return;
      const body = card.querySelector('.hp-side-body');
      if (!body) {
        card.classList.toggle('is-collapsed');
        btn.setAttribute('aria-expanded', card.classList.contains('is-collapsed') ? 'false' : 'true');
        return;
      }
      const collapsed = animateAccordion(card, body, 'is-collapsed');
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });
  });

  // --- Edit profile modal (делегирование — кнопка пересоздаётся после чужого профиля) ---
  const modal = $('#hp-edit-modal');
  const openEdit = () => { if (modal) openAnimatedModal(modal); };
  const closeEdit = () => { if (modal) closeAnimatedModal(modal); };
  window.openProfileEditModal = openEdit;

  if (!window.__profileEditDelegated) {
    window.__profileEditDelegated = true;
    document.addEventListener('click', (e) => {
      const t = e.target && e.target.closest && e.target.closest('#btn-edit-profile, #btn-settings-open, #settings-open-profile-edit');
      if (!t) return;
      e.preventDefault();
      openEdit();
    });
  }

  const closeBtn = $('#hp-edit-close');
  if (closeBtn && !closeBtn.dataset.bound) {
    closeBtn.dataset.bound = '1';
    closeBtn.addEventListener('click', closeEdit);
  }
  const backdrop = $('#hp-edit-backdrop');
  if (backdrop && !backdrop.dataset.bound) {
    backdrop.dataset.bound = '1';
    backdrop.addEventListener('click', closeEdit);
  }

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
  if (/друг|friend|подарок/.test(l)) return SELECT_OPTION_ICONS.friends;
  if (/моего аккаунт|self|себе/.test(l)) return SELECT_OPTION_ICONS.public;
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
  sel.setAttribute('aria-hidden', 'true');
  sel.style.cssText = 'position:absolute!important;left:-9999px!important;top:0!important;opacity:0!important;pointer-events:none!important;width:1px!important;height:1px!important;margin:0!important;padding:0!important;border:0!important;clip:rect(0,0,0,0)!important;overflow:hidden!important;appearance:none!important;';

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
  const nodes = root.querySelectorAll('select.settings-select, select.sort-select, select.hp-select, select.cart-modal-for, select#settings-lang, select#sort-select, select#library-sort, select#hp-sort, select#hp-platform, select#settings-profile-vis, select#settings-media-vis');
  nodes.forEach(sel => {
    // список издательств при публикации и в настройках — нативный select (надёжнее)
    if (sel.id === 'sg-publisher-id' || sel.id === 'settings-display-pub') return;
    enhanceSelect(sel);
  });
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
    if (typeof hideHeadSearchDrop === 'function') hideHeadSearchDrop();
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

async function fillSettingsDisplayPub() {
  const sel = $('#settings-display-pub');
  if (!sel) return;
  // защита от повторных гонок при быстром переключении вкладок
  const token = (sel._fillToken = (sel._fillToken || 0) + 1);

  let pubs = [];
  let display = null;
  try {
    const data = await fetchJSON(PUB_API + '?action=mine');
    pubs = data.publishers || [];
  } catch (e) { console.warn('fillSettingsDisplayPub mine', e); }
  if (sel._fillToken !== token) return;
  try {
    const me = window.AUTH_STATE && window.AUTH_STATE.user;
    if (me && me.id) {
      const fu = await fetchJSON(PUB_API + '?action=for_user&user_id=' + me.id);
      if (sel._fillToken !== token) return;
      display = fu.display_publisher_id;
    }
  } catch (e) {}
  if (sel._fillToken !== token) return;

  // Снимаем старую catio-обёртку аккуратно
  const oldWrap = sel.closest('.catio-select');
  if (oldWrap && oldWrap.parentNode) {
    oldWrap.parentNode.insertBefore(sel, oldWrap);
    oldWrap.remove();
  }
  delete sel.dataset.catioEnhanced;
  sel.removeAttribute('tabindex');
  sel.removeAttribute('aria-hidden');
  sel.classList.add('settings-select');
  sel.classList.remove('select-native-hidden');
  sel.style.cssText = '';

  const html = '<option value="hide">Не показывать</option>' +
    pubs.map(p => '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>').join('');
  sel.innerHTML = html;
  if (display === 0 || display === '0' || display === null || display === undefined || display === '') {
    sel.value = 'hide';
  } else if ([...sel.options].some(o => o.value === String(display))) {
    sel.value = String(display);
  } else {
    sel.value = 'hide';
  }

  // Нативный select надёжнее кастомного в settings — не пропадает
  // (catio иногда мигает и схлопывается из-за overflow/перестроения)
  // Оставляем обычный settings-select вид.
  try {
    // если очень хочется кастом — enhance, но без повторного destroy
    // enhanceSelect(sel);
  } catch (e) { console.warn(e); }
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
      });
      if (!res.ok) throw new Error(res.error || 'Ошибка');
      if (window.AUTH_STATE?.user) {
        window.AUTH_STATE.user.username = res.username;
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
      // издательство в профиле — мгновенно + API
      try {
        const sel = $('#settings-display-pub');
        const v = sel?.value || 'hide';
        const hide = (v === 'hide' || v === '' || v === '0');
        const me = window.AUTH_STATE && window.AUTH_STATE.user;
        const line = document.getElementById('hp-publisher-line');

        // оптимистично: сразу прячем или ставим выбранное
        if (me && me.id && line) {
          line.dataset.forUser = String(me.id);
          if (hide) {
            renderPublisherLine(line, []);
            if (window.AUTH_STATE.user) window.AUTH_STATE.user.display_publisher_id = 0;
          } else {
            const opt = sel?.selectedOptions && sel.selectedOptions[0];
            const name = (opt && opt.textContent) ? opt.textContent.trim() : '';
            const pid = Number(v) || 0;
            if (pid && name) {
              renderPublisherLine(line, [{ id: pid, name: name, slug: '' }]);
            }
            if (window.AUTH_STATE.user) window.AUTH_STATE.user.display_publisher_id = pid;
          }
        }

        const resPub = await postJSON(PUB_API + '?action=set_display', {
          csrf_token: window.CSRF_TOKEN || '',
          display_publisher_id: hide ? 'hide' : v
        });
        if (resPub && resPub.ok === false) throw new Error(resPub.error || 'Не удалось сохранить издательство');

        // синхронизация с сервером (на случай slug и т.п.)
        if (me && me.id) {
          window.__pubLineToken = (window.__pubLineToken || 0) + 1;
          if (typeof viewingUserId !== 'undefined') viewingUserId = null;
          await loadProfilePublishers(me.id);
        }
      } catch (e2) {
        console.warn(e2);
        toast(e2.message || 'Настройки сохранены, но издательство не обновилось');
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
  if (tab === 'privacy' && typeof fillSettingsDisplayPub === 'function') {
    try { fillSettingsDisplayPub(); } catch (e) {}
  }
}

// ---------- Меню под аватаркой ----------
function initAvatarMenu() {
  const btn = $('#avatar-btn');
  const menu = $('#user-menu');
  if (!btn || !menu) return;

  let menuClosing = false;
  const isMenuOpen = () => !menu.classList.contains('hidden') && !menuClosing && menu.classList.contains('is-open');

  function openMenu() {
    menuClosing = false;
    menu.classList.remove('hidden', 'is-closing');
    void menu.offsetWidth;
    menu.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
    try { if (typeof refreshBadge === 'function') refreshBadge(); } catch (e) {}
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

  const distToRect = (x, y, r) => {
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    return Math.hypot(dx, dy);
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.classList.contains('hidden') || menu.classList.contains('is-closing')) openMenu();
    else closeMenu();
  });

  document.addEventListener('click', (e) => {
    if (isMenuOpen() && !menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      closeMenu();
    }
  });

  const onScrollOrWheel = (e) => {
    if (!isMenuOpen()) return;
    if (e.target && (menu.contains(e.target) || btn.contains(e.target))) return;
    closeMenu();
  };
  window.addEventListener('scroll', onScrollOrWheel, true);
  document.addEventListener('wheel', onScrollOrWheel, { passive: true, capture: true });

  const LEAVE_PX = 56;
  document.addEventListener('mousemove', (e) => {
    if (!isMenuOpen()) return;
    const mr = menu.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const d = Math.min(distToRect(e.clientX, e.clientY, mr), distToRect(e.clientX, e.clientY, br));
    if (d > LEAVE_PX) closeMenu();
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
      setAccordionHTML(box, '');
      setSideCardVisible(box, false);
      return;
    }
    setSideCardVisible(box, true);
    setAccordionHTML(box, friends.map(u => `
      <div class="hp-friend-row" data-id="${u.id}" data-username="${escapeHtml(u.username)}">
        <div class="hp-friend-avatar" style="${friendAvatarStyle(u)}">
          ${friendAvatarText(u)}
          ${u.is_online ? '<span class="online-dot"></span>' : ''}
        </div>
        <div class="hp-friend-text">
          <div class="hp-friend-name">${escapeHtml(u.username)}</div>
          <div class="hp-friend-status">${u.is_online ? 'В сети' : 'Не в сети'}</div>
        </div>
      </div>`).join(''));
    $$('.hp-friend-row', box).forEach(row => {
      row.addEventListener('click', () => openUserProfile(row.dataset.username, row.dataset.id));
    });
  } catch (err) {
    setAccordionHTML(box, `<div class="hp-empty" style="padding:12px 0">${escapeHtml(err.message)}</div>`);
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
      libBox.innerHTML = `<div class="hp-empty hp-empty-centered">
        <div class="hp-empty-logo" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8M8 11h5"/></svg>
        </div>
        <div class="hp-empty-text">Загляни в каталог — здесь появятся твои игры</div>
      </div>`;
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
      try {
        const grid = document.getElementById('hp-screenshots-grid');
        if (grid) { grid.innerHTML = ''; grid.dataset.shotsFor = ''; }
      } catch (e) {}
      gotoView('profile');
      return;
    }

    viewingUserId = p.id;
    const isAdmin = !!(data.viewer_is_admin || (window.AUTH_STATE && window.AUTH_STATE.user && (window.AUTH_STATE.user.role === 'admin' || window.AUTH_STATE.user.is_admin)));
    // сброс медиа чужого/своего кэша до рендера
    try {
      const grid = document.getElementById('hp-screenshots-grid');
      const emptyEl = document.getElementById('hp-screenshots-empty');
      if (grid) { grid.innerHTML = ''; grid.classList.add('hidden'); grid.dataset.shotsFor = String(p.id); }
      if (emptyEl) emptyEl.classList.remove('hidden');
    } catch (e) {}
    renderForeignProfile(p, data.library || [], isAdmin);
    setProfileLoadingShell(false);
    // если вкладка скриншотов активна — грузим сразу его медиа
    try {
      const tab = document.querySelector('.hp-tab.active');
      if (tab && tab.dataset.ptab === 'screenshots') loadProfileScreenshots();
    } catch (e) {}
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
  // сразу чистим строку — иначе на чужом профиле видно моё издательство
  const pubLine = document.getElementById('hp-publisher-line');
  if (pubLine) {
    pubLine.dataset.forUser = String(p.id);
    renderPublisherLine(pubLine, []);
  }
  try { loadProfilePublishers(p.id); } catch (e) {}
  renderProfileFriendCode(p.friend_code || '');
  setProfileRoleBadge(p);

  // hide own-only controls
  const upload = $('#hp-banner-upload');
  if (upload) upload.style.display = 'none';
  const toolbar = document.querySelector('#view-profile .hp-toolbar') || document.querySelector('#hp-hero .hp-toolbar');
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
      libBox.innerHTML = `<div class="hp-empty hp-empty-centered">
        <div class="hp-empty-logo" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8M8 11h5"/></svg>
        </div>
        <div class="hp-empty-text">Загляни в каталог — здесь появятся твои игры</div>
      </div>`;
    } else {
      libBox.innerHTML = rest.map(g => gameCardHtml(g, { showPin: false })).join('');
    }
  }
  $$('.hp-game-card').forEach(card => {
    card.addEventListener('click', () => gotoGame(card.dataset.id));
  });

  // активность чужого профиля пока не отдаём — блок скрываем целиком
  const act = $('#hp-activity');
  if (act) {
    setAccordionHTML(act, '');
    setSideCardVisible(act, false);
  }
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

function setMenuBadge(selector, count) {
  const n = parseInt(count, 10) || 0;
  $$(selector).forEach(el => {
    if (n > 0) {
      el.textContent = n > 99 ? '99+' : String(n);
      el.classList.remove('hidden');
      el.style.display = '';
      el.setAttribute('aria-hidden', 'false');
    } else {
      el.textContent = '0';
      el.classList.add('hidden');
      el.style.display = 'none';
      el.setAttribute('aria-hidden', 'true');
    }
  });
}

function setAvatarDots(show) {
  $$('.side-avatar-dot, .header-avatar-dot, #side-avatar-dot, #header-avatar-dot').forEach(dot => {
    if (!dot) return;
    if (show) {
      dot.classList.add('visible');
      dot.style.display = 'block';
    } else {
      dot.classList.remove('visible');
      dot.style.display = 'none';
    }
  });
}

async function refreshBadge() {
  try {
    const data = await fetchJSON(`${NOTIF_API}?action=badge`);
    if (!data || !data.ok) return;
    const notifN = parseInt(data.notifications, 10) || 0;
    const reqN = parseInt(data.requests, 10) || 0;
    const msgN = parseInt(data.messages, 10) || 0;
    const total = parseInt(data.total, 10) || (notifN + reqN + msgN);

    setMenuBadge('.friends-menu-badge', reqN);
    setMenuBadge('.notif-menu-badge', notifN);
    setMenuBadge('.messages-menu-badge, .msg-menu-badge', msgN);

    const tabBadge = $('#notif-tab-badge');
    if (tabBadge) {
      const n = notifN + reqN;
      if (n > 0) {
        tabBadge.textContent = String(n);
        tabBadge.classList.remove('hidden');
        tabBadge.style.display = '';
      } else {
        tabBadge.classList.add('hidden');
        tabBadge.style.display = 'none';
      }
    }

    setAvatarDots(total > 0);
  } catch (e) {
    console.warn('refreshBadge', e);
  }
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
          <div class="notif-page-empty-icon" aria-hidden="true"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M4 2L2 4"/><path d="M20 2l2 2"/></svg></div>
          <div class="notif-page-empty-title">Нет уведомлений</div>
          <div class="notif-page-empty-sub">Вы в курсе всех событий! Загляните позже за новыми обновлениями.</div>
        </div>`;
      return;
    }
    const iconMap = {
      friend_request: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>',
      friend_accepted: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>',
      message: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
      sale: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
      system: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    };
    const defaultIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
    list.innerHTML = items.map(n => {
      const meta = n.meta || {};
      const gid = meta.game_id || '';
      const isSale = n.type === 'sale' || (gid && (n.type === 'system' || /скидк/i.test(n.title || '')));
      const isDeleted = n.type === 'game_deleted' || /удален/i.test(n.title || '');
      const wantBanner = isSale || isDeleted;
      let banner = meta.banner_url || meta.cover_url || '';
      // после удаления игры media.php уже не найдёт карточку — пробуем локальную копию
      const localDeleted = gid ? ('uploads/notif/deleted_' + gid + '.jpg') : '';
      if (!banner || /media\.php/.test(String(banner))) {
        if (meta.deleted && localDeleted) banner = localDeleted;
        else if (gid) banner = localDeleted || ('media.php?type=hero&id=' + gid);
      }
      const bannerCls = isDeleted ? 'notif-item-banner is-deleted' : 'notif-item-banner';
      const bannerHtml = (wantBanner && banner)
        ? `<div class="${bannerCls}" aria-hidden="true"><img src="${escapeHtml(banner)}" alt="" loading="lazy" onerror="this.onerror=null;const g=${gid||0};if(g){this.src='uploads/notif/deleted_'+g+'.jpg';this.onerror=function(){this.parentElement&&this.parentElement.remove();};}else if(this.parentElement)this.parentElement.remove();" /></div>`
        : '';
      return `
      <div class="notif-item ${n.is_read ? '' : 'unread'} ${wantBanner && banner ? 'has-banner' : ''} ${isDeleted ? 'is-deleted' : ''}" data-id="${n.id}" data-type="${escapeHtml(n.type)}"
           data-from="${meta.from_id || meta.admin_id || ''}"
           data-username="${escapeHtml(meta.from_username || meta.admin_username || '')}"
           data-game-id="${gid}">
        <div class="notif-item-icon">${iconMap[n.type] || defaultIcon}</div>
        <div class="notif-item-body">
          <div class="notif-item-title">${escapeHtml(n.title)}</div>
          <div class="notif-item-text">${escapeHtml(n.body)}</div>
          <div class="notif-item-time">${escapeHtml(formatDateTime(n.created_at))}</div>
        </div>
        ${bannerHtml}
      </div>`;
    }).join('');

    $$('.notif-item', list).forEach(item => {
      item.addEventListener('click', async () => {
        try {
          await postJSON(`${NOTIF_API}?action=read`, { id: +item.dataset.id });
        } catch (e) {}
        const type = item.dataset.type;
        const from = item.dataset.from;
        const uname = item.dataset.username;
        const gameId = item.dataset.gameId;
        if (type === 'message' && from) {
          openChat(+from, uname);
        } else if ((type === 'friend_request' || type === 'friend_accepted') && uname) {
          openUserProfile(uname, from);
        } else if (type === 'game_published' || type === 'game_rejected') {
          const adminId = meta.admin_id || meta.adminId;
          const adminName = meta.admin_username || meta.admin_name || uname || '';
          if (adminName || adminId) openUserProfile(adminName, adminId);
          else if (gameId && typeof gotoGame === 'function') gotoGame(+gameId);
        } else if ((type === 'sale' || type === 'system' || type === 'game_added') && gameId) {
          if (typeof gotoGame === 'function') gotoGame(+gameId);
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
  badgeTimer = setInterval(refreshBadge, 3000);
  // мгновенно обновлять при возврате во вкладку
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshBadge();
  });
  window.addEventListener('focus', () => refreshBadge());
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
const STEAM_API = 'api/steam_import.php'; // disabled for diploma — do not call
const STEAM_DISABLED = true;
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

function ensurePubModalAlive() {
  const formModal = document.getElementById('submit-form-modal');
  if (!formModal) return;
  formModal.classList.remove('hidden', 'is-closing');
  formModal.style.opacity = '1';
  formModal.style.visibility = 'visible';
  formModal.style.pointerEvents = 'auto';
  formModal.style.display = 'flex';
  const box = formModal.querySelector('.sgdb-modal-card, .submit-modal-box');
  if (box) {
    box.style.opacity = '1';
    box.style.visibility = 'visible';
    box.style.transform = 'none';
  }
}

/**
 * В WebView2/Electron file input внутри модалки «убивает» слой.
 * Открываем нативный диалог через временный input в body.
 */
function openPubFilePicker(sourceInput, { multiple = false, accept = 'image/*' } = {}) {
  if (!sourceInput) return;
  window.__pubFileDialogOpen = true;
  window.__pubFileDialogTs = Date.now();

  const tmp = document.createElement('input');
  tmp.type = 'file';
  tmp.accept = accept || sourceInput.accept || 'image/*';
  if (multiple || sourceInput.multiple) tmp.multiple = true;
  tmp.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;width:1px;height:1px;';
  document.body.appendChild(tmp);

  const cleanup = () => {
    setTimeout(() => {
      try { tmp.remove(); } catch (e) {}
      window.__pubFileDialogOpen = false;
      window.__pubFileDialogTs = Date.now();
      ensurePubModalAlive();
    }, 300);
  };

  tmp.addEventListener('change', () => {
    try {
      // переносим FileList в исходный input через DataTransfer
      const dt = new DataTransfer();
      [...(tmp.files || [])].forEach(f => dt.items.add(f));
      try { sourceInput.files = dt.files; } catch (e1) { console.warn('assign files', e1); }
      // запасной путь — храним File в dataset/window (WebView иногда глотает .files)
      if (sourceInput.id === 'sg-build-file' && tmp.files && tmp.files[0]) {
        window.__selectedBuildFile = tmp.files[0];
        const nameEl = document.getElementById('sg-build-file-name');
        if (nameEl) {
          const f = tmp.files[0];
          nameEl.textContent = f.name + ' · ' + (typeof formatBytes === 'function' ? formatBytes(f.size) : (Math.round(f.size/1048576*10)/10 + ' МБ'));
          nameEl.style.display = 'inline';
          nameEl.style.opacity = '1';
          nameEl.style.visibility = 'visible';
          nameEl.style.color = 'var(--text-bright)';
        }
        try { if (typeof updatePublishSectionStatus === 'function') updatePublishSectionStatus(); } catch (e2) {}
      }
      sourceInput.dispatchEvent(new Event('change', { bubbles: true }));
      sourceInput.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) {
      console.warn('pub file transfer failed', e);
    }
    ensurePubModalAlive();
    cleanup();
  });
  // cancel (не во всех браузерах)
  tmp.addEventListener('cancel', () => {
    ensurePubModalAlive();
    cleanup();
  });
  // фокус/видимость после диалога
  const onVis = () => {
    if (document.visibilityState === 'visible') {
      ensurePubModalAlive();
      document.removeEventListener('visibilitychange', onVis);
    }
  };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('focus', () => ensurePubModalAlive(), { once: true });

  try {
    tmp.click();
  } catch (e) {
    cleanup();
  }
}


function setPubPreviewImg(previewId, url) {
  const prev = document.getElementById(previewId);
  if (!prev) return;
  if (!url) {
    prev.style.backgroundImage = '';
    prev.classList.remove('has-img');
    const ph = previewId.includes('cover') ? 'Обложка' : previewId.includes('banner') ? 'Баннер' : previewId.includes('logo') ? 'Логотип' : 'Иконка';
    prev.innerHTML = '<span>' + ph + '</span>';
    return;
  }
  prev.style.backgroundImage = '';
  prev.classList.add('has-img');
  prev.innerHTML = '';
  const img = document.createElement('img');
  img.src = url;
  img.alt = '';
  img.draggable = false;
  prev.appendChild(img);
}

function initPublishFilePreviews(root = document) {
  const bindOne = (inputId, previewId, nameId) => {
    const input = root.querySelector('#' + inputId) || document.getElementById(inputId);
    if (!input || input.dataset.previewBound) return;
    input.dataset.previewBound = '1';

    // кнопки/label открывают picker снаружи модалки
    const open = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPubFilePicker(input, { multiple: false, accept: input.accept || 'image/*' });
    };
    input.addEventListener('click', open);
    const id = input.id;
    if (id) {
      document.querySelectorAll('label[for="' + id + '"]').forEach(lab => {
        lab.addEventListener('click', open);
      });
    }
    // клик по превью тоже
    const prevEl = document.getElementById(previewId);
    if (prevEl) prevEl.addEventListener('click', open);

    input.addEventListener('change', () => {
      ensurePubModalAlive();
      const file = input.files && input.files[0];
      const prev = document.getElementById(previewId);
      const nameEl = document.getElementById(nameId);
      if (!file) {
        if (prev) {
          prev.style.backgroundImage = '';
          prev.classList.remove('has-img');
          const ph = prev.dataset.placeholder || (previewId.includes('cover') ? 'Обложка' : previewId.includes('banner') ? 'Баннер' : previewId.includes('logo') ? 'Логотип' : 'Иконка');
          prev.innerHTML = '<span>' + ph + '</span>';
        }
        if (nameEl) nameEl.textContent = nameEl.dataset.placeholder || nameEl.textContent;
        return;
      }
      if (nameEl) nameEl.textContent = file.name + (file.size ? ' · ' + formatBytes(file.size) : '');
      if (prev && file.type && file.type.startsWith('image/')) {
        try {
          if (prev._objUrl) { try { URL.revokeObjectURL(prev._objUrl); } catch (e) {} }
          const url = URL.createObjectURL(file);
          prev._objUrl = url;
          prev.style.backgroundImage = '';
          prev.classList.add('has-img');
          prev.innerHTML = '';
          const img = document.createElement('img');
          img.src = url;
          img.alt = '';
          img.draggable = false;
          prev.appendChild(img);
        } catch (e) {}
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
    const openShots = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPubFilePicker(shots, { multiple: true, accept: 'image/*' });
    };
    shots.addEventListener('click', openShots);
    document.querySelectorAll('label[for="sg-shots"]').forEach(lab => {
      lab.addEventListener('click', openShots);
    });
    shots.addEventListener('change', () => {
      ensurePubModalAlive();
      const box = document.getElementById('sg-shots-preview');
      if (!box) return;
      box.innerHTML = '';
      [...(shots.files || [])].slice(0, 8).forEach(f => {
        if (!f.type || !f.type.startsWith('image/')) return;
        const d = document.createElement('div');
        d.className = 'pub-shot-thumb';
        try { d.style.backgroundImage = "url('" + URL.createObjectURL(f) + "')"; } catch (e) {}
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

function syncPublishGenres() {
  const genres = $$('.sg-genre').filter(c => c.checked).map(c => c.value);
  const hidden = $('#sg-genre');
  if (hidden) hidden.value = genres.join(', ');
  return genres;
}

function syncPublishDescription() {
  const ed = $('#sg-desc-editor');
  const ta = $('#sg-desc');
  if (!ed || !ta) return '';
  const html = (ed.innerHTML || '').trim();
  ta.value = html;
  return html;
}

function plainTextFromHtml(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  return (d.textContent || d.innerText || '').trim();
}

function initPublishRte() {
  const root = $('#sg-rte');
  const ed = $('#sg-desc-editor');
  if (!root || !ed || root.dataset.bound === '1') return;
  root.dataset.bound = '1';

  const run = (cmd, val) => {
    ed.focus();
    try {
      if (cmd === 'createLink') {
        const url = prompt('URL ссылки:', 'https://');
        if (!url) return;
        document.execCommand('createLink', false, url);
      } else if (cmd === 'formatBlock') {
        document.execCommand('formatBlock', false, val || 'p');
      } else if (cmd === 'insertShot') {
        const shots = $('#sg-shots')?.files;
        if (!shots || !shots.length) {
          toast('Сначала выберите скриншоты в блоке «Медиа»');
          return;
        }
        const file = shots[0];
        const reader = new FileReader();
        reader.onload = () => {
          ed.focus();
          document.execCommand('insertImage', false, reader.result);
          syncPublishDescription();
        };
        reader.readAsDataURL(file);
      } else {
        document.execCommand(cmd, false, val || null);
      }
    } catch (e) {}
    syncPublishDescription();
  };

  $$('.pub-rte-btn', root).forEach(btn => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      run(btn.dataset.cmd, btn.dataset.val || null);
    });
  });
  ed.addEventListener('input', syncPublishDescription);
  ed.addEventListener('blur', syncPublishDescription);
  ed.addEventListener('paste', () => setTimeout(syncPublishDescription, 0));
}

function validatePublishForm() {
  syncPublishGenres();
  syncPublishDescription();
  const title = ($('#sg-title')?.value || '').trim();
  if (title.length < 2) return 'Укажите название игры (минимум 2 символа)';
  const genre = ($('#sg-genre')?.value || '').trim();
  if (!genre) return 'Выберите хотя бы один жанр';
  const descHtml = ($('#sg-desc')?.value || '').trim();
  const descText = plainTextFromHtml(descHtml);
  if (descText.length < 20) return 'Описание слишком короткое (минимум 20 символов)';
  let price = parseInt(String($('#sg-price')?.value || '0').replace(/[^\d]/g, ''), 10);
  if (Number.isNaN(price)) price = 0;
  if (price < PUB_PRICE_MIN) return 'Цена не может быть меньше ' + PUB_PRICE_MIN + ' ₽';
  if (price > PUB_PRICE_MAX) return 'Цена не может быть больше ' + PUB_PRICE_MAX + ' ₽';
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
      <button type="button" class="gp-side-head">Системные требования <span class="hp-side-arrow" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg></span></button>
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
      <button type="button" class="gp-side-head">Язык <span class="hp-side-arrow" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg></span></button>
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


const GAME_PACK_API = 'api/game_pack.php';

async function importGamePackFile(file) {
  if (!file) return;
  const fd = new FormData();
  fd.append('pack', file);
  fd.append('action', 'import_pack');
  const res = await fetch(GAME_PACK_API + '?action=import_pack', {
    method: 'POST',
    body: fd,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Не удалось импортировать пакет');
  return data;
}

function applyGamePackToSubmitForm(data) {
  const game = data.game || {};
  const files = data.files || {};
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (!el || v == null || v === '') return;
    el.value = v;
  };
  const setPreview = (previewId, url, nameId, label) => {
    if (!url) return;
    if (typeof setPubPreviewImg === 'function') setPubPreviewImg(previewId, url);
    if (nameId) {
      const n = document.getElementById(nameId);
      if (n) n.textContent = label || url.split('/').pop() || 'из пакета';
    }
  };

  set('sg-title', game.title || '');
  set('sg-developer', game.developer || '');
  set('sg-short', game.short_description || '');
  set('sg-tags', game.tags || '');
  set('sg-price', game.price != null ? String(game.price) : '');
  set('sg-release', game.release_date || '');
  set('sg-video', game.video_url || '');

  // описание: contenteditable #sg-desc-editor + textarea #sg-desc
  const desc = game.description || '';
  if (desc) {
    const ed = document.getElementById('sg-desc-editor');
    const ta = document.getElementById('sg-desc');
    if (ed) {
      ed.innerHTML = desc;
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (ta) ta.value = desc;
    try { if (typeof syncPublishDescription === 'function') syncPublishDescription(); } catch (e) {}
  }

  // жанры
  const genreStr = String(game.genre || '');
  const parts = genreStr.split(/[,;/|]+/).map(s => s.trim()).filter(Boolean);
  document.querySelectorAll('.sg-genre').forEach(cb => {
    cb.checked = parts.some(p => p.toLowerCase() === String(cb.value).toLowerCase());
  });
  try { if (typeof syncPublishGenres === 'function') syncPublishGenres(); } catch (e) {}

  // платформы
  let plats = game.platforms;
  if (typeof plats === 'string') {
    try { plats = JSON.parse(plats); } catch (e) { plats = String(plats).split(/[,;]+/); }
  }
  if (Array.isArray(plats)) {
    const setP = new Set(plats.map(p => String(p).toLowerCase().trim()));
    document.querySelectorAll('.sg-platform').forEach(cb => {
      const v = String(cb.value).toLowerCase();
      cb.checked = setP.has(v) || [...setP].some(x => x.includes(v) || v.includes(x));
    });
  }

  // управление
  let ctrls = game.controllers;
  if (typeof ctrls === 'string') {
    ctrls = ctrls.split(/[,;|]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  }
  if (Array.isArray(ctrls) && ctrls.length) {
    const expanded = new Set();
    ctrls.forEach(c => {
      const x = String(c).toLowerCase();
      if (x === 'full' || x === 'partial' || x === 'supported' || x === 'controller' || x === 'gamepad') {
        expanded.add('xbox'); expanded.add('playstation'); expanded.add('keyboard');
      } else expanded.add(x);
    });
    document.querySelectorAll('.sg-ctrl').forEach(cb => {
      const v = String(cb.value).toLowerCase();
      cb.checked = expanded.has(v) || [...expanded].some(c => c.includes(v) || v.includes(c));
    });
  }

  // системные требования (объект или notes/HTML)
  const normSys = (raw) => {
    if (raw == null || raw === '') return null;
    let obj = raw;
    if (typeof raw === 'string') {
      try { obj = JSON.parse(raw); } catch (e) { return { other: raw }; }
    }
    if (obj && typeof obj === 'object') {
      if (obj.os || obj.processor || obj.memory || obj.gpu || obj.storage) return obj;
      if (obj.notes) return { other: String(obj.notes) };
    }
    return obj;
  };
  try {
    const mn = normSys(game.sys_req_min);
    const rc = normSys(game.sys_req_rec);
    if (mn) fillSysReq('#sg-sys-min-fields', mn);
    if (rc) fillSysReq('#sg-sys-rec-fields', rc);
  } catch (e) { console.warn('sysreq', e); }

  // языки: ["English"] или [{name,subtitles,audio}]
  try {
    let langs = game.languages;
    if (typeof langs === 'string') {
      try { langs = JSON.parse(langs); } catch (e) { langs = langs.split(/[,;]+/).map(s => s.trim()).filter(Boolean); }
    }
    if (Array.isArray(langs) && langs.length) {
      if (typeof langs[0] === 'string') {
        langs = langs.map(name => ({ name, subtitles: true, audio: true }));
      }
      renderLangTable('#sg-lang-table', langs);
    }
  } catch (e) { console.warn('lang', e); }

  // медиа
  if (files.cover) {
    set('sg-cover-url', files.cover);
    setPreview('sg-cover-preview', files.cover, 'sg-cover-name', 'обложка из пакета');
  }
  if (files.banner) {
    set('sg-banner-url', files.banner);
    setPreview('sg-banner-preview', files.banner, 'sg-banner-name', 'баннер из пакета');
  }
  if (files.logo) {
    set('sg-logo-url', files.logo);
    setPreview('sg-logo-preview', files.logo, 'sg-logo-name', 'логотип из пакета');
  }
  if (files.icon) {
    set('sg-icon-url', files.icon);
    setPreview('sg-icon-preview', files.icon, 'sg-icon-name', 'иконка из пакета');
  } else {
    // нет своей иконки — берём первую из SGDB в пакете
    try {
      const sg = (files && files.sgdb) || (data.manifest && data.manifest.files && data.manifest.files.sgdb) || {};
      const icons = sg.icons || [];
      let firstIcon = '';
      if (Array.isArray(icons) && icons.length) {
        const it = icons[0];
        firstIcon = typeof it === 'string' ? it : (it && (it.url || it.path || it.file || '')) || '';
      }
      if (firstIcon) {
        set('sg-icon-url', firstIcon);
        setPreview('sg-icon-preview', firstIcon, 'sg-icon-name', 'иконка SGDB');
      }
    } catch (e) { console.warn('sgdb icon fallback', e); }
  }

  // скриншоты
  window.__importedGamePack = data;
  let shotUrls = [];
  if (files.screenshots && files.screenshots.length) shotUrls = files.screenshots.slice();
  else if (data.manifest && Array.isArray(data.manifest.screenshots)) shotUrls = data.manifest.screenshots.slice();
  // только реальные URL/пути
  shotUrls = shotUrls.filter(u => !!u && String(u).length > 3);
  if (shotUrls.length) {
    let box = document.getElementById('sg-screenshots-urls');
    if (!box) {
      box = document.createElement('input');
      box.type = 'hidden';
      box.id = 'sg-screenshots-urls';
      box.name = 'screenshot_urls';
      (document.getElementById('submit-game-form') || document.body).appendChild(box);
    }
    // нормализуем пути (без ведущего /)
    shotUrls = shotUrls.map(u => String(u).replace(/^\//, ''));
    box.value = shotUrls.join('\n');
    const prevBox = document.getElementById('sg-shots-preview');
    if (prevBox) {
      prevBox.style.display = 'flex';
      prevBox.style.flexWrap = 'wrap';
      prevBox.style.gap = '6px';
      prevBox.innerHTML = shotUrls.slice(0, 12).map(u => {
        const src = (u.startsWith('http') || u.startsWith('uploads/') || u.startsWith('/')) ? u : u;
        return '<div class="pub-shot-item" title="' + escapeHtml(src) + '" style="background-image:url(\'' + String(src).replace(/'/g, '%27') + '\');background-size:cover;background-position:center;width:72px;height:48px;border-radius:6px;display:inline-block;border:1px solid rgba(255,255,255,0.12)"></div>';
      }).join('');
    }
    console.log('[import] screenshots', shotUrls.length, shotUrls);
  } else {
    console.warn('[import] no screenshots in pack', data.files, data.manifest && data.manifest.files);
  }

  // трейлеры: video_url или первый movie
  const movies = data.movies || (data.manifest && data.manifest.movies) || [];
  let videoSet = game.video_url || '';
  if (!videoSet && movies.length) {
    const first = movies[0];
    videoSet = first.url || first.source_url || first.mp4 || first.file || '';
  }
  try { ensureTrailersEditorUi(); } catch (e) {}
  const allTrailers = [];
  if (videoSet) allTrailers.push(videoSet);
  movies.forEach(m => {
    const u = m.url || m.source_url || m.mp4 || m.file || '';
    if (u && !allTrailers.includes(u)) allTrailers.push(u);
  });
  renderTrailersEditor(allTrailers.length ? allTrailers : ['']);
  if (allTrailers.length) set('sg-video', serializeTrailerList(allTrailers));
  // локальные mp4 трейлеры — сохраняем список для submit
  const localTrailers = (files.trailers || []).concat(
    movies.map(m => m.file || m.url).filter(u => u && String(u).startsWith('uploads/'))
  );
  if (localTrailers.length) {
    let hid = document.getElementById('sg-trailer-urls');
    if (!hid) {
      hid = document.createElement('input');
      hid.type = 'hidden';
      hid.id = 'sg-trailer-urls';
      hid.name = 'trailer_urls';
      const form = document.getElementById('submit-game-form') || document.getElementById('submit-form-modal');
      if (form) form.appendChild(hid);
    }
    hid.value = [...new Set(localTrailers)].join('\n');
  }

  // CATioGridDB ассеты из ZIP — в кэш для модалки оформления
  try {
    const sg = (files && files.sgdb) || (data.manifest && data.manifest.files && data.manifest.files.sgdb) || {};
    const packSgdb = { icons: [], logos: [], heroes: [], grids: [] };
    const mapKey = { icons: 'icons', logos: 'logos', heroes: 'heroes', covers: 'grids', grids: 'grids' };
    Object.keys(sg || {}).forEach(k => {
      const dst = mapKey[k] || k;
      const arr = sg[k] || [];
      if (!Array.isArray(arr)) return;
      arr.forEach(item => {
        const url = (item && (item.url || item.thumb || item.file)) || (typeof item === 'string' ? item : '');
        if (!url) return;
        packSgdb[dst] = packSgdb[dst] || [];
        packSgdb[dst].push({ url, thumb: (item && item.thumb) || url, width: item && item.width, height: item && item.height });
      });
    });
    window.__packSgdbAssets = packSgdb;
    window.__packSgdbTitle = game.title || '';
    console.log('[import] sgdb from pack', Object.keys(packSgdb).map(k => k + ':' + (packSgdb[k]||[]).length));
  } catch (e) { console.warn(e); }

  const nShots = shotUrls ? shotUrls.length : 0;
  const nLang = Array.isArray(game.languages) ? game.languages.length : 0;
  const nTr = (typeof collectTrailerInputs === 'function' ? collectTrailerInputs() : []).length;
  toast('Импорт: скринов ' + nShots + ', трейлеров ' + nTr + ', языков ' + nLang);
}



function ensureImportPackInput() {
  let input = document.getElementById('sg-import-pack');
  if (input) return input;
  input = document.createElement('input');
  input.type = 'file';
  input.id = 'sg-import-pack';
  input.accept = '.zip,application/zip';
  input.hidden = true;
  document.body.appendChild(input);
  return input;
}

async function handleImportPackFile(file, btn) {
  if (!file) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Импорт…'; }
  try {
    toast('Импорт пакета…');
    const data = await importGamePackFile(file);
    applyGamePackToSubmitForm(data);
  } catch (err) {
    console.error(err);
    toast(err.message || 'Ошибка импорта');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Импорт'; }
  }
}

function bindSubmitPackImport() {
  if (window.__importPackDelegated) return;
  window.__importPackDelegated = true;

  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('#sg-import-pack-btn');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const input = ensureImportPackInput();
    // защита от ghost-click на backdrop модалки
    window.__pubFileDialogOpen = true;
    window.__pubFileDialogTs = Date.now();
    setTimeout(() => { window.__pubFileDialogOpen = false; }, 1200);
    input.onchange = async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      await handleImportPackFile(file, btn);
    };
    input.click();
  }, true);
}

// ===== Модалка прогресса экспорта =====
function ensureExportProgressModal() {
  let modal = document.getElementById('export-progress-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'export-progress-modal';
  modal.className = 'submit-modal hidden';
  modal.innerHTML = `
    <div class="submit-modal-backdrop" id="export-progress-backdrop"></div>
    <div class="submit-modal-box" style="max-width:520px">
      <div class="submit-modal-head">
        <h2 style="margin:0;font-size:1.05rem">Экспорт пакета</h2>
        <button type="button" class="modal-close" id="export-progress-close" aria-label="Закрыть">×</button>
      </div>
      <div style="padding:14px 16px 18px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:10px">
          <span id="export-progress-label" style="font-size:0.85rem;color:var(--text-muted)">Подготовка…</span>
          <span id="export-progress-pct" style="font-weight:700;font-variant-numeric:tabular-nums">0%</span>
        </div>
        <div style="height:10px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden">
          <div id="export-progress-bar" style="height:100%;width:0%;background:var(--accent,#ef5b2c);transition:width .2s ease"></div>
        </div>
        <div id="export-progress-console" style="margin-top:14px;height:220px;overflow:auto;background:#0d0c0b;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.45;color:#c8f5c0"></div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#export-progress-close')?.addEventListener('click', () => {
    if (modal.dataset.busy === '1') return;
    modal.classList.add('hidden');
  });
  modal.querySelector('#export-progress-backdrop')?.addEventListener('click', () => {
    if (modal.dataset.busy === '1') return;
    modal.classList.add('hidden');
  });
  return modal;
}

function exportProgressReset() {
  const modal = ensureExportProgressModal();
  const bar = document.getElementById('export-progress-bar');
  const pct = document.getElementById('export-progress-pct');
  const label = document.getElementById('export-progress-label');
  const cons = document.getElementById('export-progress-console');
  if (bar) bar.style.width = '0%';
  if (pct) pct.textContent = '0%';
  if (label) label.textContent = 'Подготовка…';
  if (cons) cons.innerHTML = '';
  modal.dataset.busy = '1';
  modal.classList.remove('hidden');
  return modal;
}

function exportProgressLog(msg, pct) {
  const cons = document.getElementById('export-progress-console');
  const bar = document.getElementById('export-progress-bar');
  const pctEl = document.getElementById('export-progress-pct');
  const label = document.getElementById('export-progress-label');
  if (cons && msg != null && msg !== '') {
    const line = document.createElement('div');
    line.textContent = msg;
    cons.appendChild(line);
    cons.scrollTop = cons.scrollHeight;
  }
  if (typeof pct === 'number' && !Number.isNaN(pct)) {
    const p = Math.max(0, Math.min(100, pct));
    if (bar) bar.style.width = p + '%';
    if (pctEl) pctEl.textContent = p + '%';
  }
  if (label && msg) {
    const short = String(msg).replace(/^\s*→\s*/, '').slice(0, 64);
    label.textContent = short;
  }
}

async function runGamePackExport(gameId) {
  const modal = exportProgressReset();
  exportProgressLog('$ export game #' + gameId, 1);
  try {
    const url = 'api/game_pack.php?action=export&stream=1&game_id=' + encodeURIComponent(gameId) + '&_t=' + Date.now();
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok || !res.body) {
      let msg = 'Ошибка экспорта (' + res.status + ')';
      try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let token = null;
    let filename = 'game-pack-' + gameId + '.zip';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        let row;
        try { row = JSON.parse(s); } catch (e) {
          exportProgressLog(s);
          continue;
        }
        if (row.error && row.ok === false) throw new Error(row.error);
        if (row.msg) exportProgressLog(row.msg, typeof row.pct === 'number' ? row.pct : undefined);
        else if (typeof row.pct === 'number') exportProgressLog(null, row.pct);
        if (row.token) token = row.token;
        if (row.filename) filename = row.filename;
        if (row.phase === 'done' && row.ok) {
          exportProgressLog('Скачивание ' + filename + '…', 100);
        }
      }
    }
    if (!token) throw new Error('Сервер не вернул token пакета');
    exportProgressLog('Загрузка ZIP…', 100);
    const dl = await fetch('api/game_pack.php?action=export_download&token=' + encodeURIComponent(token) + '&filename=' + encodeURIComponent(filename), { credentials: 'same-origin' });
    if (!dl.ok) throw new Error('Не удалось скачать ZIP');
    const blob = await dl.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    exportProgressLog('Готово ✓', 100);
    toast('Пакет скачан');
    modal.dataset.busy = '0';
  } catch (err) {
    exportProgressLog('ERROR: ' + (err.message || err), undefined);
    toast(err.message || 'Не удалось экспортировать');
    modal.dataset.busy = '0';
  }
}

function initSubmitGame() {
  try { bindSubmitPackImport(); } catch (e) { console.warn(e); }
  // Делегирование: работает даже если кнопку перерисуют и если другие init упали раньше
  if (!window.__submitGameDelegated) {
    window.__submitGameDelegated = true;
    document.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('#btn-add-game');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof openCreateMenu === 'function') openCreateMenu();
        else openSubmitRules();
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
        try { resetPublishFormMode(); } catch (e) {}
        try { ensurePublishAdminFooter(formModal, {}, null); } catch (e) {}
        try { renderLangTable('#sg-lang-table', []); } catch (err) { console.warn(err); }
        formModal.classList.remove('hidden');
        const fillBtn = $('#sg-steam-fill');
        if (fillBtn && !fillBtn.dataset.bound) {
          fillBtn.dataset.bound = '1';
          fillBtn.addEventListener('click', fillSubmitFromSteam);
        }
        try { initPublishFilePreviews(formModal); initPublishPriceInput(); initPublishRte(); ensureTrailersEditorUi(); renderTrailersEditor(['']); } catch (e) {}
        try {
          initPubFormTabs();
          initPubMediaTabs();
          initBuildsUi();
          bindPublishValidationWatchers();
          updatePublishSectionStatus();
          window.__pendingBuilds = [];
          renderPendingBuilds();
          window.fillPublishPublisherSelect().then(() => {
            try { initCatioSelects(formModal); } catch (e2) {}
          }).catch((err) => {
            console.warn(err);
            try { initCatioSelects(formModal); } catch (e2) {}
          });
        } catch (e) {
          try { initCatioSelects(formModal); } catch (e2) {}
        }
        try {
          $$('.sg-genre').forEach(c => {
            if (c.dataset.boundGenre) return;
            c.dataset.boundGenre = '1';
            c.addEventListener('change', syncPublishGenres);
          });
        } catch (e) {}
      }
    });
  }

  // защита: после открытия file dialog WebView шлёт «ghost click» на backdrop
  window.__pubFileDialogOpen = false;
  window.__pubFileDialogTs = 0;

  $$('[data-close]').forEach(el => {
    if (el.dataset.closeBound) return;
    el.dataset.closeBound = '1';
    el.addEventListener('click', (e) => {
      const k = el.dataset.close;
      if (k === 'form') {
        // не закрывать, если только что выбирали файл
        if (window.__pubFileDialogOpen) return;
        if (Date.now() - (window.__pubFileDialogTs || 0) < 800) return;
        try { resetPublishFormMode(); } catch (e) {}
        $('#submit-form-modal')?.classList.add('hidden');
        return;
      }
      if (k === 'rules') $('#submit-rules-modal')?.classList.add('hidden');
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
  toast('Импорт из Steam отключён. Используй ZIP (tools/steam-export.bat).');
}


/**
 * Стилизованный confirm вместо window.confirm.
 * requireFriendCode: true — нужно посимвольно ввести свой код друга.
 * @returns {Promise<boolean>}
 */
function appConfirm({
  title = 'Подтверждение',
  message = '',
  okText = 'OK',
  cancelText = 'Отмена',
  danger = false,
  requireFriendCode = false
} = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById('app-confirm-modal');
    if (!modal) {
      resolve(window.confirm(message || title));
      return;
    }
    const t = document.getElementById('app-confirm-title');
    const s = document.getElementById('app-confirm-sub');
    const ok = document.getElementById('app-confirm-ok');
    const cancel = document.getElementById('app-confirm-cancel');
    const icon = document.getElementById('app-confirm-icon');
    const pinWrap = document.getElementById('app-confirm-pin');
    const pinCells = document.getElementById('app-confirm-pin-cells');
    const pinHint = document.getElementById('app-confirm-pin-hint');
    const pinErr = document.getElementById('app-confirm-pin-error');

    const expectedCode = String(
      (typeof getMyFriendCode === 'function' ? getMyFriendCode() : '') ||
      (window.AUTH_STATE && window.AUTH_STATE.user && window.AUTH_STATE.user.friend_code) ||
      ''
    ).toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (t) t.textContent = title;
    if (s) {
      s.textContent = message || '';
      s.style.display = message ? '' : 'none';
    }
    if (ok) {
      ok.textContent = okText;
      ok.classList.toggle('is-danger', !!danger);
    }
    if (cancel) cancel.textContent = cancelText;
    if (icon) icon.classList.toggle('is-warn', !!danger);

    const needPin = !!(requireFriendCode && expectedCode && pinWrap && pinCells);
    let inputs = [];

    const getEntered = () => inputs.map(i => (i.value || '').toUpperCase()).join('');

    const syncOkEnabled = () => {
      if (!ok) return;
      if (!needPin) {
        ok.disabled = false;
        ok.classList.remove('is-disabled');
        return;
      }
      const ready = getEntered().length === expectedCode.length;
      ok.disabled = !ready;
      ok.classList.toggle('is-disabled', !ready);
    };

    const clearPinError = () => {
      if (pinErr) pinErr.classList.add('hidden');
      pinCells && pinCells.classList.remove('is-error');
    };

    if (pinWrap) pinWrap.classList.toggle('hidden', !needPin);
    if (pinCells) pinCells.innerHTML = '';
    clearPinError();

    if (needPin) {
      if (pinHint) {
        pinHint.textContent = 'Введите «' + expectedCode + '» по символам';
      }
      for (let i = 0; i < expectedCode.length; i++) {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.inputMode = 'text';
        inp.autocomplete = 'off';
        inp.spellcheck = false;
        inp.maxLength = 1;
        inp.className = 'app-confirm-pin-cell';
        inp.setAttribute('aria-label', 'Символ ' + (i + 1));
        inp.addEventListener('input', () => {
          clearPinError();
          let v = (inp.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          inp.value = v.slice(0, 1);
          if (inp.value && i < inputs.length - 1) inputs[i + 1].focus();
          syncOkEnabled();
        });
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Backspace' && !inp.value && i > 0) {
            inputs[i - 1].focus();
            inputs[i - 1].value = '';
            syncOkEnabled();
          }
          if (e.key === 'Enter' && !ok.disabled) ok.click();
        });
        inp.addEventListener('paste', (e) => {
          e.preventDefault();
          clearPinError();
          const text = String((e.clipboardData || window.clipboardData).getData('text') || '')
            .toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (!text) return;
          for (let j = 0; j < expectedCode.length; j++) {
            inputs[j].value = text[j] || '';
          }
          const focusIdx = Math.min(text.length, expectedCode.length) - 1;
          if (focusIdx >= 0) inputs[Math.min(focusIdx + 1, expectedCode.length - 1)].focus();
          syncOkEnabled();
        });
        pinCells.appendChild(inp);
        inputs.push(inp);
      }
      ok.disabled = true;
      ok.classList.add('is-disabled');
    } else {
      if (ok) {
        ok.disabled = false;
        ok.classList.remove('is-disabled');
      }
    }

    const finish = (val) => {
      modal.classList.add('hidden');
      if (pinCells) pinCells.innerHTML = '';
      modal.querySelectorAll('[data-confirm-cancel], #app-confirm-ok').forEach(el => {
        el.onclick = null;
      });
      resolve(val);
    };

    ok.onclick = () => {
      if (needPin) {
        const entered = getEntered();
        if (entered !== expectedCode) {
          if (pinErr) {
            pinErr.textContent = 'Неверный код друга';
            pinErr.classList.remove('hidden');
          }
          pinCells.classList.add('is-error');
          inputs.forEach(i => { i.value = ''; });
          if (inputs[0]) inputs[0].focus();
          syncOkEnabled();
          return;
        }
      }
      finish(true);
    };
    modal.querySelectorAll('[data-confirm-cancel]').forEach(el => {
      el.onclick = () => finish(false);
    });
    modal.classList.remove('hidden');
    if (needPin && inputs[0]) setTimeout(() => inputs[0].focus(), 40);
  });
}

function clearInstalledGame(gameId) {
  const m = getInstallMap();
  delete m[String(gameId)];
  setInstallMap(m);
  try {
    const ids = getInstalledIds().filter(id => +id !== +gameId);
    localStorage.setItem('catio_installed', JSON.stringify(ids));
  } catch (e) {}
}


function fillGameSettingsPath(g) {
  const gameId = g && g.id ? g.id : window.__steamEditGameId;
  const title = (g && g.title) || 'game';
  const slug = (g && g.slug) || ('game_' + gameId);
  const versions = getInstalledVersions(gameId) || {};
  const pref = getPreferredVersion(gameId);
  const hasInst = Object.keys(versions).length > 0;
  const base = 'AppData\\\\Roaming\\\\CATio\\\\games\\\\' + String(slug).replace(/[^\\w\\-]+/g, '_');
  const exeEl = document.getElementById('sgdb-exe-path');
  const instEl = document.getElementById('sgdb-install-path');
  const savesEl = document.getElementById('sgdb-saves-path');
  if (exeEl) {
    if (hasInst && pref) {
      exeEl.textContent = base + '\\\\' + pref + '\\\\' + (title.replace(/[^\\w\\-\\. ]+/g, '').trim() || 'game') + '.exe';
      exeEl.classList.add('has-value');
    } else {
      exeEl.textContent = 'Файл не выбран';
      exeEl.classList.remove('has-value');
    }
  }
  if (instEl) {
    instEl.textContent = hasInst ? base + (pref ? ('\\\\' + pref) : '') : 'Игра ещё не установлена';
  }
  if (savesEl) {
    const span = savesEl.querySelector('span');
    if (span) span.textContent = 'Папка с сохранениями не найдена';
  }
}

function openPlaytimeEditModal(gameId, title) {
  const modal = document.getElementById('playtime-edit-modal');
  if (!modal) return;
  window.__playtimeEditGameId = +gameId;
  const sub = document.getElementById('playtime-edit-sub');
  if (sub) sub.textContent = 'Вручную обновите время игры' + (title ? (' для ' + title) : '');
  let mins = 0;
  try {
    const g = (libraryCache || []).find(x => +x.id === +gameId);
    if (g) mins = parseInt(g.playtime_minutes, 10) || 0;
  } catch (e) {}
  const hEl = document.getElementById('playtime-hours');
  const mEl = document.getElementById('playtime-minutes');
  if (hEl) hEl.value = String(Math.floor(mins / 60));
  if (mEl) mEl.value = String(mins % 60);
  modal.classList.remove('hidden');
}

function bindPlaytimeEditModal() {
  const modal = document.getElementById('playtime-edit-modal');
  if (!modal || modal.dataset.bound === '1') return;
  modal.dataset.bound = '1';
  modal.querySelectorAll('[data-close-playtime]').forEach(el => {
    el.addEventListener('click', () => modal.classList.add('hidden'));
  });
  document.getElementById('playtime-edit-save')?.addEventListener('click', async () => {
    const gameId = +window.__playtimeEditGameId;
    if (!gameId) return;
    const h = Math.max(0, parseInt(document.getElementById('playtime-hours')?.value || '0', 10) || 0);
    const m = Math.max(0, Math.min(59, parseInt(document.getElementById('playtime-minutes')?.value || '0', 10) || 0));
    const minutes = h * 60 + m;
    const btn = document.getElementById('playtime-edit-save');
    if (btn) btn.disabled = true;
    try {
      const data = await postJSON((typeof API_BASE !== 'undefined' ? API_BASE : 'api/games.php') + '?action=set_playtime', {
        game_id: gameId,
        minutes
      });
      if (!data.ok) throw new Error(data.error || 'Ошибка');
      applyPlaytimeEverywhere(gameId, data.playtime_minutes != null ? data.playtime_minutes : minutes);
      toast('Время игры обновлено');
      modal.classList.add('hidden');
    } catch (e) {
      toast(e.message || 'Не удалось обновить');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

function fillGameSettingsDownloads(gameId) {
  const sel = document.getElementById('sgdb-launch-version');
  if (!sel) return;
  const versions = getInstalledVersions(gameId);
  const keys = Object.keys(versions || {});
  const preferred = getPreferredVersion(gameId);
  sel.innerHTML = '';
  if (!keys.length) {
    sel.innerHTML = '<option value=\"\">Нет установленных версий</option>';
    sel.disabled = true;
  } else {
    sel.disabled = false;
    keys.sort().forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      const meta = versions[v] || {};
      opt.textContent = 'v' + v + (meta.size ? (' · ' + (typeof formatBytes === 'function' ? formatBytes(meta.size) : '')) : '');
      if (String(preferred) === String(v)) opt.selected = true;
      sel.appendChild(opt);
    });
  }
  sel.onchange = () => {
    if (sel.value) setPreferredVersion(gameId, sel.value);
    if (typeof toast === 'function') toast('Запускаемая версия: v' + sel.value);
  };
  const srcBtn = document.getElementById('sgdb-open-sources');
  if (srcBtn && !srcBtn.dataset.bound) {
    srcBtn.dataset.bound = '1';
    srcBtn.addEventListener('click', () => {
      try { if (typeof gotoGame === 'function') gotoGame(gameId); } catch (e) {}
      document.getElementById('steam-import-modal')?.classList.add('hidden');
      toast('Откройте страницу игры, чтобы скачать другую версию');
    });
  }
}

function fillGameSettingsDanger(gameId) {
  window.__steamEditGameId = Number(gameId) || window.__steamEditGameId;
  const gid = () => Number(window.__steamEditGameId) || Number(gameId);
  const installed = getInstalledIds().includes(+gid());
  const hasVersions = Object.keys(getInstalledVersions(gid()) || {}).length > 0;
  const isInstalled = installed || hasVersions;

  const setBtn = (id, enabled, title) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.disabled = !enabled;
    b.classList.toggle('is-disabled', !enabled);
    if (title) b.title = title;
    else b.removeAttribute('title');
  };

  setBtn('sgdb-remove-library', true, '');
  setBtn('sgdb-refresh-playtime', true, '');
  setBtn('sgdb-reset-playtime', true, '');
  setBtn('sgdb-delete-files', isInstalled, isInstalled ? '' : 'Игра не установлена');
  setBtn('sgdb-del-all-shots', false, 'Нет скриншотов');
  setBtn('sgdb-del-pub-shots', false, 'Нет опубликованных скриншотов');
  setBtn('sgdb-del-local-shots', false, 'Нет локальных скриншотов');

  const bindOnce = (id, fn) => {
    const b = document.getElementById(id);
    if (!b || b.dataset.dangerBound === '1') return;
    b.dataset.dangerBound = '1';
    b.addEventListener('click', () => fn(b));
  };

  bindOnce('sgdb-remove-library', async (btn) => {
    const gameId = gid();
    const ok = await appConfirm({
      title: 'Удалить из библиотеки?',
      message: 'Игра исчезнет из вашей библиотеки. Покупка сохранится.',
      okText: 'Удалить',
      danger: true
    });
    if (!ok) return;
    btn.disabled = true;
    try {
      const data = await postJSON((typeof API_BASE !== 'undefined' ? API_BASE : 'api/games.php') + '?action=remove', { game_id: +gameId });
      if (!data.ok) throw new Error(data.error || 'Ошибка');
      toast('Игра удалена из библиотеки');
      libraryCache = (libraryCache || []).filter(g => +g.id !== +gameId);
      try { sideLibRemoveOptimistic(gameId); } catch (e) {}
      try { renderLibraryGrid(); } catch (e) {}
      // на странице игры — сразу «В библиотеку» без цены
      try {
        if (window.__currentGame && +window.__currentGame.id === +gameId) {
          window.__currentGame.owned = false;
          window.__currentGame.purchased = true;
          if (typeof loadGamePage === 'function') loadGamePage(gameId);
        }
      } catch (e) {}
      document.getElementById('steam-import-modal')?.classList.add('hidden');
    } catch (e) {
      toast(e.message || 'Не удалось удалить');
    } finally {
      btn.disabled = false;
    }
  });

  bindOnce('sgdb-refresh-playtime', async (btn) => {
    const gameId = gid();
    let title = '';
    try {
      title = (libraryCache || []).find(x => +x.id === +gameId)?.title
        || window.__steamEditGameData?.title
        || document.getElementById('sgdb-info-title')?.textContent
        || '';
    } catch (e) {}
    bindPlaytimeEditModal();
    openPlaytimeEditModal(gameId, title);
  });

  bindOnce('sgdb-reset-playtime', async (btn) => {
    const gameId = gid();
    const ok = await appConfirm({
      title: 'Сбросить время игры?',
      message: 'Счётчик времени игры будет обнулён.',
      okText: 'Сбросить',
      danger: true
    });
    if (!ok) return;
    btn.disabled = true;
    try {
      const data = await postJSON((typeof API_BASE !== 'undefined' ? API_BASE : 'api/games.php') + '?action=set_playtime', { game_id: +gameId, minutes: 0 });
      if (!data.ok) throw new Error(data.error || 'Ошибка');
      applyPlaytimeEverywhere(gameId, 0);
      toast('Время игры сброшено');
    } catch (e) {
      toast(e.message || 'Не удалось сбросить');
    } finally {
      btn.disabled = false;
    }
  });

  bindOnce('sgdb-delete-files', async (btn) => {
    if (btn.disabled) return;
    const gameId = gid();
    const ok = await appConfirm({
      title: 'Удалить файлы игры?',
      message: 'Локальные файлы и отметки установки будут удалены. Игра останется в библиотеке.',
      okText: 'Удалить файлы',
      danger: true
    });
    if (!ok) return;
    clearInstalledGame(gameId);
    toast('Файлы удалены');
    try { fillGameSettingsPath({ id: gameId }); } catch (e) {}
    fillGameSettingsDownloads(gameId);
    fillGameSettingsDanger(gameId);
    fillGameSettingsMods(gameId);
    // кнопка Играть → Скачать/Установить сразу, без перезагрузки
    try {
      const g = (window.__currentGame && +window.__currentGame.id === +gameId)
        ? window.__currentGame
        : (window.__currentGamePage && +window.__currentGamePage.id === +gameId ? window.__currentGamePage : null);
      if (g && typeof refreshBuyButton === 'function') refreshBuyButton(g);
      const btn = document.getElementById('btn-buy-game');
      if (btn && g && g.owned) {
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Установить`;
        btn.dataset.mode = 'install';
        btn.classList.add('owned');
        btn.disabled = false;
        btn.classList.remove('is-disabled');
      }
      if (typeof renderLibraryGrid === 'function') renderLibraryGrid();
    } catch (e) {}
  });
}


window.appConfirm = appConfirm;

async function submitGameForm() {
  const btn = $('#submit-game-send');
  const isAdminPub = !!(btn && btn.dataset.adminPublish === '1' && window.__adminModeratingId);
  const isAdminSave = !!(btn && btn.dataset.adminSave === '1' && window.__adminModeratingId);
  const isPublisherEdit = !!(btn && btn.dataset.publisherEdit === '1');
  // если форма не готова — подсказка, а не «мёртвая» кнопка
  if (btn && btn.classList.contains('is-disabled') && !isAdminPub && !isAdminSave) {
    const reason = btn.dataset.blockReason || btn.title || 'Заполните обязательные поля';
    if (typeof toast === 'function') toast(reason);
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = isAdminPub ? 'Публикация...' : (isAdminSave ? 'Сохранение...' : 'Отправка...');
  }
  try {
    // Публикатор обновляет свою игру → на модерацию (нужны версия + новый файл)
    if (isPublisherEdit) {
      const g = window.__currentGamePage || { id: window.__publishEditGameId };
      openGameUpdateModal(g);
      return;
    }
    if (false && isPublisherEdit) {
      const id = (window.__publishEditGameId || window.__adminModeratingId || 0);
      if (!id) throw new Error('Нет id игры');
      const ver = (document.getElementById('sg-build-version')?.value || '').trim();
      const ch = (document.getElementById('sg-build-changelog')?.value || '').trim();
      const bf = (typeof getSelectedBuildFile === 'function' ? getSelectedBuildFile() : null) || document.getElementById('sg-build-file')?.files?.[0] || null;
      if (!ver) throw new Error('Укажите версию обновления');
      if (!bf) throw new Error('Прикрепите новый файл сборки');
      if (typeof syncPublishGenres === 'function') syncPublishGenres();
      if (typeof syncPublishDescription === 'function') syncPublishDescription();
      const fd = new FormData();
      fd.append('csrf_token', window.CSRF_TOKEN || '');
      fd.append('id', id);
      fd.append('builds_as_pending', '1');
      fd.append('title', ($('#sg-title') && $('#sg-title').value.trim()) || '');
      fd.append('genre', ($('#sg-genre') && $('#sg-genre').value) || '');
      fd.append('price', String(parseInt(String(($('#sg-price') && $('#sg-price').value) || '0').replace(/[^\d]/g, ''), 10) || 0));
      fd.append('short_description', ($('#sg-short') && $('#sg-short').value) || '');
      fd.append('description', ($('#sg-desc') && $('#sg-desc').value) || '');
      try { ensureTrailersEditorUi(); } catch (e) {}
      const tr = (typeof collectTrailerInputs === 'function') ? collectTrailerInputs() : [];
      fd.append('video_url', (typeof serializeTrailerList === 'function' ? serializeTrailerList(tr) : '') || ($('#sg-video') && $('#sg-video').value) || '');
      fd.append('developer', ($('#sg-developer') && $('#sg-developer').value) || '');
      fd.append('publisher', ($('#sg-publisher') && $('#sg-publisher').value) || '');
      fd.append('publisher_id', ($('#sg-publisher-id') && $('#sg-publisher-id').value) || '');
      fd.append('sys_req_min', JSON.stringify(collectSysReq('#sg-sys-min-fields')));
      fd.append('sys_req_rec', JSON.stringify(collectSysReq('#sg-sys-rec-fields')));
      fd.append('languages', JSON.stringify(collectLanguages('#sg-lang-table')));
      fd.append('controllers', $$('.sg-ctrl').filter(function(c){return c.checked;}).map(function(c){return c.value;}).join(','));
      const aCover = $('#sg-cover') && $('#sg-cover').files && $('#sg-cover').files[0];
      if (aCover) fd.append('cover', aCover);
      if ($('#sg-cover-url') && $('#sg-cover-url').value) fd.append('cover_url', $('#sg-cover-url').value);
      const aBanner = $('#sg-banner') && $('#sg-banner').files && $('#sg-banner').files[0];
      if (aBanner) fd.append('banner', aBanner);
      if ($('#sg-banner-url') && $('#sg-banner-url').value) fd.append('banner_url', $('#sg-banner-url').value);
      fd.append('builds_meta', JSON.stringify([{ i: 0, version: ver, platform: 'windows', changelog: ch, has_file: true }]));
      fd.append('builds[0]', bf, bf.name || 'build.bin');
      const res = await fetch((typeof SUBMIT_API !== 'undefined' ? SUBMIT_API : 'api/submit.php') + '?action=publisher_update', { method: 'POST', body: fd });
      const raw = await res.text();
      let data;
      try { data = JSON.parse(raw.slice(raw.indexOf('{'))); } catch (e) { throw new Error('Сервер вернул не JSON'); }
      if (!data.ok) throw new Error(data.error || 'Не удалось отправить обновление');
      toast('Обновление отправлено на модерацию');
      $('#submit-form-modal')?.classList.add('hidden');
      try { resetPublishFormMode(); } catch (e) {}
      try { if (typeof loadGamePage === 'function') loadGamePage(+id); } catch (e) {}
      try { refreshAdminPendingBadge(); } catch (e) {}
      return;
    }
    if (isAdminPub || isAdminSave) {
      const id = window.__adminModeratingId;
      const fd = new FormData();
      fd.append('csrf_token', window.CSRF_TOKEN || '');
      fd.append('id', id);
      if (typeof syncPublishGenres === 'function') syncPublishGenres();
      if (typeof syncPublishDescription === 'function') syncPublishDescription();
      fd.append('title', ($('#sg-title') && $('#sg-title').value.trim()) || '');
      fd.append('genre', ($('#sg-genre') && $('#sg-genre').value) || '');
      fd.append('price', String(parseInt(String(($('#sg-price') && $('#sg-price').value) || '0').replace(/[^\d]/g, ''), 10) || 0));
      fd.append('short_description', ($('#sg-short') && $('#sg-short').value) || '');
      fd.append('description', ($('#sg-desc') && $('#sg-desc').value) || '');
      try { ensureTrailersEditorUi(); } catch (e) {}
      const tr = (typeof collectTrailerInputs === 'function') ? collectTrailerInputs() : [];
      fd.append('video_url', (typeof serializeTrailerList === 'function' ? serializeTrailerList(tr) : '') || ($('#sg-video') && $('#sg-video').value) || '');
      fd.append('developer', ($('#sg-developer') && $('#sg-developer').value) || '');
      fd.append('publisher', ($('#sg-publisher') && $('#sg-publisher').value) || '');
      fd.append('publisher_id', ($('#sg-publisher-id') && $('#sg-publisher-id').value) || '');
      fd.append('sys_req_min', JSON.stringify(collectSysReq('#sg-sys-min-fields')));
      fd.append('sys_req_rec', JSON.stringify(collectSysReq('#sg-sys-rec-fields')));
      fd.append('languages', JSON.stringify(collectLanguages('#sg-lang-table')));
      fd.append('controllers', $$('.sg-ctrl').filter(function(c){return c.checked;}).map(function(c){return c.value;}).join(','));
      const aCover = $('#sg-cover') && $('#sg-cover').files && $('#sg-cover').files[0];
      if (aCover) fd.append('cover', aCover);
      if ($('#sg-cover-url') && $('#sg-cover-url').value) fd.append('cover_url', $('#sg-cover-url').value);
      const aBanner = $('#sg-banner') && $('#sg-banner').files && $('#sg-banner').files[0];
      if (aBanner) fd.append('banner', aBanner);
      if ($('#sg-banner-url') && $('#sg-banner-url').value) fd.append('banner_url', $('#sg-banner-url').value);
      const aLogo = $('#sg-logo') && $('#sg-logo').files && $('#sg-logo').files[0];
      if (aLogo) fd.append('logo', aLogo);
      const aIcon = $('#sg-icon') && $('#sg-icon').files && $('#sg-icon').files[0];
      if (aIcon) fd.append('icon', aIcon);
      const aShots = $('#sg-shots') && $('#sg-shots').files;
      if (aShots) for (let i = 0; i < aShots.length; i++) fd.append('screenshots[]', aShots[i]);
      // сборка: версия + файл прямо из полей формы
      try {
        const ver = (document.getElementById('sg-build-version')?.value || '').trim();
        const ch = (document.getElementById('sg-build-changelog')?.value || '').trim();
        const bf = (typeof getSelectedBuildFile === 'function' ? getSelectedBuildFile() : null) || document.getElementById('sg-build-file')?.files?.[0] || null;
        if (bf) {
          fd.append('builds_meta', JSON.stringify([{
            i: 0, version: ver || '1.0', platform: 'windows', changelog: ch, has_file: true
          }]));
          fd.append('builds[0]', bf, bf.name || 'build.bin');
        }
      } catch (e) { console.warn('admin builds append', e); }
      let res = await fetch(SUBMIT_API + '?action=admin_save', { method: 'POST', body: fd });
      let data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Не удалось сохранить');
      if (isAdminPub) {
        res = await postJSON(SUBMIT_API + '?action=publish', { csrf_token: window.CSRF_TOKEN || '', id: id });
        if (!res.ok) throw new Error(res.error || 'Не удалось опубликовать');
        toast('Игра опубликована');
        try { loadAdminPending(); } catch (e) {}
        try { if (typeof loadGamePage === 'function') loadGamePage(+id); } catch (e) {}
      } else {
        toast('Сохранено');
        try { if (typeof loadGamePage === 'function') loadGamePage(+id); } catch (e) {}
      }
      if ($('#submit-form-modal')) $('#submit-form-modal').classList.add('hidden');
      try { resetPublishFormMode(); } catch (e) {}
      try { resetPublishModalMode(); } catch (e) {}
      homeCache = null;
      storeCache = [];
      return;
    }
    const err = validatePublishForm();
    if (err) throw new Error(err);
    const fd = new FormData();
        fd.append('csrf_token', window.CSRF_TOKEN || '');
    syncPublishGenres();
    syncPublishDescription();
    fd.append('title', $('#sg-title')?.value?.trim() || '');
    fd.append('genre', $('#sg-genre')?.value || '');
    fd.append('price', String(parseInt(String($('#sg-price')?.value || '0').replace(/[^\d]/g, ''), 10) || 0));
    fd.append('short_description', $('#sg-short')?.value || '');
    fd.append('description', $('#sg-desc')?.value || '');
    try { ensureTrailersEditorUi(); } catch(e) {}
    const _tr = collectTrailerInputs();
    fd.append('video_url', serializeTrailerList(_tr) || ($('#sg-video')?.value || ''));
    fd.append('developer', $('#sg-developer')?.value || '');
    fd.append('publisher', $('#sg-publisher')?.value || '');
    fd.append('publisher_id', $('#sg-publisher-id')?.value || '');
    fd.append('website', $('#sg-website')?.value || '');
    fd.append('release_date', $('#sg-release')?.value || '');
    fd.append('tags', $('#sg-tags')?.value || '');
    const plats = $$('.sg-platform').filter(c => c.checked).map(c => c.value).join(',');
    fd.append('platforms', plats);
    if ($('#sg-cover-url')?.value) fd.append('cover_url', $('#sg-cover-url').value);
    if ($('#sg-banner-url')?.value) fd.append('banner_url', $('#sg-banner-url').value);
    if ($('#sg-icon-url')?.value) fd.append('icon_url', $('#sg-icon-url').value);
    if ($('#sg-logo-url')?.value) fd.append('logo_url', $('#sg-logo-url').value);
    if ($('#sg-screenshots-urls')?.value) fd.append('screenshot_urls', $('#sg-screenshots-urls').value);
    if ($('#sg-trailer-urls')?.value) fd.append('trailer_urls', $('#sg-trailer-urls').value);
    if ($('#sg-logo-url')?.value) fd.append('logo_url', $('#sg-logo-url').value);
    if ($('#sg-icon-url')?.value) fd.append('icon_url', $('#sg-icon-url').value);
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
    // сборка — прямо из полей (версия + файл обязательны)
    const buildVer = (document.getElementById('sg-build-version')?.value || '').trim();
    const buildCh = (document.getElementById('sg-build-changelog')?.value || '').trim();
    const buildFile = (typeof getSelectedBuildFile === 'function' ? getSelectedBuildFile() : null) || document.getElementById('sg-build-file')?.files?.[0] || null;
    if (!buildVer) throw new Error('Укажите версию сборки');
    if (!buildFile) throw new Error('Прикрепите файл сборки (zip/exe)');
    fd.append('builds_meta', JSON.stringify([{
      i: 0, version: buildVer, platform: 'windows', changelog: buildCh, has_file: true
    }]));
    fd.append('builds[0]', buildFile, buildFile.name || 'build.bin');
    const flags = $$('.sg-content-flag').filter(c => c.checked).map(c => c.value);
    fd.append('content_flags', flags.join(','));
    fd.append('is_adult', flags.includes('adult') ? '1' : '0');

    const res = await fetch(`${SUBMIT_API}?action=submit`, { method: 'POST', body: fd });
    const rawText = await res.text();
    let data;
    try { data = JSON.parse(rawText); }
    catch (e) {
      console.error('submit non-JSON', rawText.slice(0, 300));
      throw new Error('Сервер вернул не JSON. Обнови api/submit.php');
    }
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    try { refreshAdminPendingBadge(); } catch (e) {}
    $('#submit-form-modal')?.classList.add('hidden');
    $('#submit-game-form')?.reset();
    const ed = $('#sg-desc-editor');
    if (ed) ed.innerHTML = '';
    $$('.sg-genre').forEach(c => { c.checked = false; });
    syncPublishGenres();
    syncPublishDescription();
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
    const res = await saveGameAssetsSelection(payload);
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
      const res = await saveGameAssetsSelection(payload);
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

  function normalizeSgdbUrl(u) {
    if (!u) return '';
    u = String(u).trim();
    if (!u || u === 'undefined' || u === 'null') return '';
    // относительные пути из пакета
    if (u.startsWith('sgdb/') || u.startsWith('media/') || u.startsWith('uploads/')) {
      // уже ок
    } else if (u.startsWith('./')) {
      u = u.slice(2);
    }
    return u;
  }
  function mapPackList(list) {
    if (!Array.isArray(list)) return [];
    return list.map(a => {
      if (!a) return null;
      if (typeof a === 'string') {
        const u = normalizeSgdbUrl(a);
        return u ? { url: u, thumb: u } : null;
      }
      const url = normalizeSgdbUrl(a.url || a.file || a.thumb || '');
      const thumb = normalizeSgdbUrl(a.thumb || a.url || a.file || '') || url;
      if (!url) return null;
      return { url, thumb, width: a.width, height: a.height };
    }).filter(Boolean);
  }
  async function loadSgdbAssets(type) {
    const grid = $('#sgdb-asset-grid');
    if (!grid) return;
    grid.className = 'sgdb-asset-grid is-' + type;
    grid.innerHTML = '<div class="settings-hint">Загрузка…</div>';

    // 1) ассеты из ZIP-пакета (импорт) — keys: icons/logos/heroes/grids (+ covers)
    const pack = window.__sgdbAssetsFromPack || window.__packSgdbAssets;
    if (pack) {
      const key = (type === 'grids' || type === 'covers') ? 'grids' : type;
      const list = mapPackList(pack[key] || pack[type] || (key === 'grids' ? pack.covers : null) || []);
      if (list.length) {
        sgdbCache[type] = list;
        renderSgdbGrid(list, type);
        return;
      }
    }

    // 2) локальные ассеты уже сохранённой игры
    const g = window.__steamEditGameData || window.__lastGameForCart || (window.wrap && window.wrap._gameData) || null;
    const local = [];
    const pushLocal = (url) => {
      const u = normalizeSgdbUrl(url);
      if (!u) return;
      if (!local.some(x => x.url === u)) local.push({ url: u, thumb: u });
    };
    if (g) {
      if (type === 'icons') pushLocal(g.icon_url);
      if (type === 'logos') pushLocal(g.logo_url);
      if (type === 'heroes') { pushLocal(g.banner_url); pushLocal(g.cover_url); }
      if (type === 'grids' || type === 'covers') { pushLocal(g.cover_url); pushLocal(g.cover_src); }
    }
    if ((type === 'grids' || type === 'covers' || type === 'heroes') && Array.isArray(window.__lastGameScreenshots)) {
      window.__lastGameScreenshots.forEach(pushLocal);
    }

    // 3) онлайн CATioGridDB / SteamGridDB по названию (если локально пусто)
    const q = (window.__sgdbNameQuery || (g && g.title) || window.__packSgdbTitle || '').trim();
    if (!local.length && q) {
      try {
        const data = await fetchJSON('api/game_pack.php?action=sgdb_by_name&q=' + encodeURIComponent(q));
        const first = (data && data.results && data.results[0]) || (data && data.games && data.games[0]) || null;
        const sgdbId = (first && first.id) || data.sgdb_id || 0;
        if (sgdbId) {
          const assets = await fetchJSON('api/game_pack.php?action=sgdb_by_name&q=' + encodeURIComponent(q) + '&sgdb_id=' + sgdbId);
          const bag = (assets && assets.assets) || assets || {};
          const apiKey = (type === 'grids' || type === 'covers') ? 'covers' : type;
          const list = mapPackList(bag[apiKey] || bag[type] || bag.grids || []);
          if (list.length) {
            // кэш всего пакета ассетов для остальных вкладок
            window.__sgdbAssetsFromPack = window.__sgdbAssetsFromPack || {
              icons: mapPackList(bag.icons || []),
              logos: mapPackList(bag.logos || []),
              heroes: mapPackList(bag.heroes || []),
              grids: mapPackList(bag.covers || bag.grids || []),
            };
            sgdbCache[type] = list;
            renderSgdbGrid(list, type);
            return;
          }
        }
      } catch (e) {
        console.warn('[sgdb]', e);
      }
    }

    if (local.length) {
      sgdbCache[type] = local;
      renderSgdbGrid(local, type);
      return;
    }

    grid.innerHTML = '<div class="settings-hint">Нет ассетов для этой вкладки. Импортируй ZIP-пакет с CATioGridDB или выбери другое название.</div>';
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
        <img src="${escapeHtml(th)}" alt="" loading="lazy" onerror="this.onerror=null;const b=this.closest('.sgdb-grid-item');if(b)b.remove();" />
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
        const data = await saveGameAssetsSelection( {
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


function updateAdminPendingBadge(count) {
  const n = Math.max(0, parseInt(count, 10) || 0);
  const badge = document.getElementById('admin-badge');
  if (badge) {
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('hidden', n <= 0);
  }
  const modCount = document.getElementById('admin-mod-count');
  if (modCount) {
    modCount.textContent = n > 0 ? String(n) : '';
    modCount.classList.toggle('hidden', n <= 0);
  }
}
async function refreshAdminPendingBadge() {
  try {
    const me = window.AUTH_STATE && window.AUTH_STATE.user;
    if (!me || me.role !== 'admin') return;
    let total = 0;
    try {
      const data = await fetchJSON((typeof SUBMIT_API !== 'undefined' ? SUBMIT_API : 'api/submit.php') + '?action=pending&_t=' + Date.now());
      if (data && data.ok) total += (data.games || []).length;
    } catch (e) {}
    try {
      const ws = await fetchJSON((typeof WS_API !== 'undefined' ? WS_API : 'api/workshop.php') + '?action=admin_pending&_t=' + Date.now());
      if (ws && ws.ok) total += (ws.mods || []).length + (ws.media || []).length + (ws.assets || []).length;
    } catch (e) {}
    try {
      const bd = await fetchJSON((typeof SUBMIT_API !== 'undefined' ? SUBMIT_API : 'api/submit.php') + '?action=pending_builds&_t=' + Date.now());
      if (bd && bd.ok) total += (bd.builds || []).length;
    } catch (e) {}
    updateAdminPendingBadge(total);
  } catch (e) {}
}

async function loadAdminPending() {
  try { initAdminUI(); } catch (e) {}

  const list = $('#admin-pending-list');
  if (!list) return;
  list.innerHTML = '<div class="loading">Загрузка...</div>';
  // правая панель больше не используется
  const editPanel = document.getElementById('admin-edit-panel');
  if (editPanel) { editPanel.style.display = 'none'; editPanel.classList.add('hidden'); }
  try {
    const data = await fetchJSON(`${SUBMIT_API}?action=pending`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const games = data.games || [];

    let mods = [], media = [], assets = [], builds = [];
    try {
      const ws = await fetchJSON((typeof WS_API !== 'undefined' ? WS_API : 'api/workshop.php') + '?action=admin_pending');
      if (ws && ws.ok) {
        mods = ws.mods || [];
        media = ws.media || [];
        assets = ws.assets || [];
      }
    } catch (e) {}
    try {
      const bd = await fetchJSON(`${SUBMIT_API}?action=pending_builds`);
      if (bd && bd.ok) builds = bd.builds || [];
    } catch (e) {}

    const total = games.length + mods.length + media.length + assets.length + builds.length;
    updateAdminPendingBadge(total);
    if (!total) {
      list.innerHTML = '<div class="friends-empty">Нет заявок на модерации</div>';
      return;
    }

    const parts = [];
    if (games.length) {
      parts.push('<div class="admin-pending-section">Игры</div>');
      parts.push(games.map(g => `
        <button type="button" class="admin-pending-item" data-kind="game" data-id="${g.id}">
          <img src="${escapeHtml(g.cover_url ? bustUrl(g.cover_url) : '')}" alt="" onerror="this.style.display='none'" />
          <div>
            <div class="t">${escapeHtml(g.title)}</div>
            <div class="s">${escapeHtml(g.submitter || '—')} · ${escapeHtml(g.genre || '')}</div>
          </div>
        </button>`).join(''));
    }
    if (builds.length) {
      parts.push('<div class="admin-pending-section">Обновления версий</div>');
      parts.push(builds.map(b => `
        <div class="admin-pending-item admin-pending-build" data-kind="build" data-id="${b.id}">
          <img src="${escapeHtml(b.cover_url ? bustUrl(b.cover_url) : '')}" alt="" onerror="this.style.display='none'" />
          <div style="flex:1;min-width:0">
            <div class="t">${escapeHtml(b.game_title || 'Игра')} <span style="opacity:.75;font-weight:500">v${escapeHtml(b.version || '')}</span></div>
            <div class="s">${escapeHtml(b.submitter || b.author_name || '—')} · ${escapeHtml(String(b.changelog || '').slice(0, 80))}</div>
            <div class="s">${escapeHtml(b.file_name || '')}${b.file_size_bytes ? ' · ' + (typeof formatBytes === 'function' ? formatBytes(b.file_size_bytes) : '') : ''}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <button type="button" class="hp-btn-edit" data-approve-build="${b.id}" style="background:var(--accent);color:#12110e;border-color:var(--accent);font-size:12px;padding:4px 8px">Одобрить</button>
            <button type="button" class="hp-btn-edit" data-reject-build="${b.id}" style="color:#f66;font-size:12px;padding:4px 8px">Отклонить</button>
          </div>
        </div>`).join(''));
    }
    if (mods.length) {
      parts.push('<div class="admin-pending-section">Моды</div>');
      parts.push(mods.map(m => `
        <button type="button" class="admin-pending-item" data-kind="mod" data-id="${m.id}">
          <img src="${escapeHtml(m.cover_url || '')}" alt="" onerror="this.style.display='none'" />
          <div>
            <div class="t">${escapeHtml(m.title || 'Мод')}</div>
            <div class="s">${escapeHtml(m.submitter || '—')} · ${escapeHtml(m.game_title || '')}</div>
          </div>
        </button>`).join(''));
    }
    if (media.length) {
      parts.push('<div class="admin-pending-section">Медиа</div>');
      parts.push(media.map(m => `
        <button type="button" class="admin-pending-item" data-kind="media" data-id="${m.id}">
          <img src="${escapeHtml(m.image_url || '')}" alt="" onerror="this.style.display='none'" />
          <div>
            <div class="t">${escapeHtml(m.title || 'Медиа')}</div>
            <div class="s">${escapeHtml(m.submitter || '—')} · ${escapeHtml(m.game_title || '')}</div>
          </div>
        </button>`).join(''));
    }
    if (assets.length) {
      parts.push('<div class="admin-pending-section">Ассеты</div>');
      parts.push(assets.map(m => `
        <button type="button" class="admin-pending-item" data-kind="asset" data-id="${m.id}">
          <img src="${escapeHtml(m.cover_url || '')}" alt="" onerror="this.style.display='none'" />
          <div>
            <div class="t">${escapeHtml(m.title || 'Ассет')}</div>
            <div class="s">${escapeHtml(m.submitter || '—')} · ${escapeHtml(m.game_title || 'без игры')}</div>
          </div>
        </button>`).join(''));
    }
    list.innerHTML = parts.join('');

    $$('.admin-pending-item', list).forEach(btn => {
      btn.addEventListener('click', () => {
        const kind = btn.getAttribute('data-kind');
        const id = +btn.dataset.id;
        if (kind === 'game') openAdminGame(id);
        else if (kind === 'mod') openAdminWorkshopItem('mod', id);
        else if (kind === 'media') openAdminWorkshopItem('media', id);
        else if (kind === 'asset') openAdminWorkshopItem('asset', id);
      });
    });
    $$('[data-approve-build]', list).forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const res = await postJSON(SUBMIT_API + '?action=approve_build', { csrf_token: window.CSRF_TOKEN || '', id: +btn.dataset.approveBuild });
          if (!res.ok) throw new Error(res.error || 'Ошибка');
          toast('Версия опубликована');
          loadAdminPending();
        } catch (err) { toast(err.message || 'Ошибка'); }
      });
    });
    $$('[data-reject-build]', list).forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Отклонить и удалить эту сборку?')) return;
        try {
          const res = await postJSON(SUBMIT_API + '?action=reject_build', { csrf_token: window.CSRF_TOKEN || '', id: +btn.dataset.rejectBuild });
          if (!res.ok) throw new Error(res.error || 'Ошибка');
          toast('Отклонено');
          loadAdminPending();
        } catch (err) { toast(err.message || 'Ошибка'); }
      });
    });
  } catch (err) {
    list.innerHTML = `<div class="friends-empty">${escapeHtml(err.message || 'Ошибка')}<br><button type="button" class="btn-retry" id="admin-retry">Повторить</button></div>`;
    $('#admin-retry')?.addEventListener('click', loadAdminPending);
  }
}

async function openAdminWorkshopItem(type, id) {
  // простая модалка модерации мода/медиа
  let existing = document.getElementById('ws-admin-mod-modal');
  if (!existing) {
    existing = document.createElement('div');
    existing.id = 'ws-admin-mod-modal';
    existing.className = 'submit-modal hidden';
    existing.innerHTML = `
      <div class="submit-modal-backdrop" data-close-ws-admin></div>
      <div class="submit-modal-box" style="max-width:480px">
        <div class="submit-modal-head">
          <h2 id="ws-admin-mod-title">Модерация</h2>
          <button type="button" class="pub-modal-close" data-close-ws-admin aria-label="Закрыть">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="submit-modal-body">
          <div id="ws-admin-mod-body" class="ws-admin-mod-body"></div>
        </div>
        <div class="submit-modal-foot">
          <button type="button" class="hp-btn-edit" id="ws-admin-reject" style="color:#f66">Отклонить</button>
          <button type="button" class="hp-btn-edit" id="ws-admin-approve" style="background:var(--accent);color:#12110e;border-color:var(--accent)">Опубликовать</button>
        </div>
      </div>`;
    document.body.appendChild(existing);
    existing.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-ws-admin]')) existing.classList.add('hidden');
    });
  }
  window.__wsAdminItem = { type, id };
  const title = document.getElementById('ws-admin-mod-title');
  const body = document.getElementById('ws-admin-mod-body');
  if (title) title.textContent = type === 'mod' ? 'Модерация мода' : (type === 'asset' ? 'Модерация ассета' : 'Модерация медиа');
  if (body) body.innerHTML = '<div class="loading">Загрузка…</div>';
  existing.classList.remove('hidden');

  try {
    // подтягиваем данные из списка pending (уже есть на экране) или повторный запрос
    const ws = await fetchJSON((typeof WS_API !== 'undefined' ? WS_API : 'api/workshop.php') + '?action=admin_pending');
    let item = null;
    if (ws && ws.ok) {
      const arr = type === 'mod' ? (ws.mods || []) : (type === 'asset' ? (ws.assets || []) : (ws.media || []));
      item = arr.find(x => +x.id === +id) || null;
    }
    if (body) {
      if (!item) {
        body.innerHTML = '<p>Заявка #' + id + '</p>';
      } else {
        const cover = type === 'media' ? (item.image_url || '') : (item.cover_url || '');
        body.innerHTML = `
          ${cover ? `<img src="${escapeHtml(cover)}" alt="" style="max-width:100%;max-height:200px;border-radius:10px;margin-bottom:12px;object-fit:cover" />` : ''}
          <div style="font-weight:700;font-size:1.05rem;color:var(--text-bright);margin-bottom:6px">${escapeHtml(item.title || '')}</div>
          <div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:4px">Автор: ${escapeHtml(item.submitter || '—')}</div>
          <div style="font-size:0.85rem;color:var(--text-muted)">Игра: ${escapeHtml(item.game_title || '—')}</div>`;
      }
    }
  } catch (e) {
    if (body) body.innerHTML = '<p>' + escapeHtml(e.message || 'Ошибка') + '</p>';
  }

  const approve = document.getElementById('ws-admin-approve');
  const reject = document.getElementById('ws-admin-reject');
  const bind = (btn, status) => {
    if (!btn) return;
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const data = await fetchJSON((typeof WS_API !== 'undefined' ? WS_API : 'api/workshop.php') + '?action=admin_set_status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, id, status })
        });
        if (!data || !data.ok) throw new Error((data && data.error) || 'Ошибка');
        toast(status === 'published' ? 'Опубликовано' : 'Отклонено');
        existing.classList.add('hidden');
        loadAdminPending();
      } catch (err) {
        toast(err.message || 'Ошибка');
      } finally {
        btn.disabled = false;
      }
    };
  };
  bind(approve, 'published');
  bind(reject, 'rejected');
}
window.openAdminWorkshopItem = openAdminWorkshopItem;

async function openAdminGame(id) {
  adminDeleteMedia = [];
  try {
    const data = await fetchJSON(`${SUBMIT_API}?action=get&id=${id}`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const g = data.game;
    // основная форма = публикация
    await openPublishFormForGame(g, { moderate: true });
    try { await loadGameBuildsIntoForm(g.id); } catch (e) {}
    // если в ответе get уже есть builds — заполним сразу
    if (Array.isArray(g.builds) && g.builds.length) {
      const b = g.builds[0];
      const ver = document.getElementById('sg-build-version');
      const ch = document.getElementById('sg-build-changelog');
      const nameEl = document.getElementById('sg-build-file-name');
      const exist = document.getElementById('sg-build-existing');
      if (ver) ver.value = b.version || '';
      if (ch) ch.value = b.changelog || '';
      const fname = b.file_name || (b.file_url ? String(b.file_url).split('/').pop() : '') || 'файл';
      if (nameEl) nameEl.textContent = fname + (b.file_size_bytes ? ' · ' + formatBytes(b.file_size_bytes) : '');
      if (exist) {
        exist.style.display = 'block';
        exist.innerHTML = '<strong>Сборка с заявки:</strong> v' + escapeHtml(b.version || '—')
          + (b.changelog ? ' — ' + escapeHtml(String(b.changelog)) : '')
          + '<br>Файл: ' + escapeHtml(fname);
      }
    }
    // ниже — синхронизация старой боковой панели (если есть)
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

    // Модерация: открыть ту же модалку, что публикация
    try {
      window.__adminModeratingId = g.id;
      const formModal = $('#submit-form-modal');
      if (formModal) {
        if ($('#sg-title')) $('#sg-title').value = g.title || '';
        if ($('#sg-price')) $('#sg-price').value = String(parseInt(g.price, 10) || 0);
        if ($('#sg-developer')) $('#sg-developer').value = g.developer || '';
        if ($('#sg-publisher')) $('#sg-publisher').value = g.developer_name || g.developer || '';
        if ($('#sg-short')) $('#sg-short').value = g.short_description || '';
        if ($('#sg-tags')) $('#sg-tags').value = g.tags || '';
        if ($('#sg-video')) $('#sg-video').value = g.video_url || '';
        const genres = String(g.genre || '').split(',').map(s => s.trim()).filter(Boolean);
        $$('.sg-genre').forEach(c => { c.checked = genres.includes(c.value); });
        if (typeof syncPublishGenres === 'function') syncPublishGenres();
        const ed = $('#sg-desc-editor');
        if (ed) ed.innerHTML = g.description || '';
        if ($('#sg-desc')) $('#sg-desc').value = g.description || '';
        try { fillSysReq('#sg-sys-min-fields', g.sys_req_min); } catch (e) {}
        try { fillSysReq('#sg-sys-rec-fields', g.sys_req_rec); } catch (e) {}
        try { renderLangTable('#sg-lang-table', g.languages); } catch (e) {}
        const setPrev = (pid, url) => {
          if (typeof setPubPreviewImg === 'function') setPubPreviewImg(pid, url || '');
        };
        setPrev('sg-cover-preview', g.cover_url || g.cover_src);
        setPrev('sg-banner-preview', g.banner_url);
        setPrev('sg-logo-preview', g.logo_url);
        setPrev('sg-icon-preview', g.icon_url || g.icon_src);
        const h2 = formModal.querySelector('.pub-modal-head h2, .submit-modal-head h2');
        if (h2) h2.textContent = 'Модерация: ' + (g.title || 'игра');
        const sub = formModal.querySelector('.pub-modal-sub');
        if (sub) sub.textContent = 'Проверьте карточку и опубликуйте или отклоните';
        const sendBtn = $('#submit-game-send');
        if (sendBtn) {
          sendBtn.textContent = 'Опубликовать';
          sendBtn.dataset.adminPublish = '1';
        }
        let rej = $('#submit-admin-reject');
        if (!rej) {
          rej = document.createElement('button');
          rej.type = 'button';
          rej.className = 'hp-btn-edit';
          rej.id = 'submit-admin-reject';
          rej.textContent = 'Отклонить';
          if (sendBtn && sendBtn.parentElement) sendBtn.parentElement.insertBefore(rej, sendBtn);
          rej.addEventListener('click', async () => {
            const note = prompt('Причина отказа (необязательно):', '') || '';
            try {
              const res = await postJSON(SUBMIT_API + '?action=reject', {
                csrf_token: window.CSRF_TOKEN || '',
                id: window.__adminModeratingId,
                note
              });
              if (!res.ok) throw new Error(res.error || 'Ошибка');
              toast('Отклонено');
              formModal.classList.add('hidden');
              if (typeof resetPublishModalMode === 'function') resetPublishModalMode();
              loadAdminPending();
            } catch (err) { toast(err.message); }
          });
        }
        rej.classList.remove('hidden');
        formModal.classList.remove('hidden');
        try { initPublishFilePreviews(formModal); initPublishRte(); } catch (e) {}
      }
    } catch (e) { console.warn(e); }


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

/** Несколько трейлеров: JSON-массив строк или через перевод строки */
function parseTrailerList(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.map(String).map(s => s.trim()).filter(Boolean);
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const j = JSON.parse(s);
      if (Array.isArray(j)) {
        return j.map(x => {
          if (typeof x === 'string') return x.trim();
          if (x && typeof x === 'object') return String(x.url || x.src || x.mp4 || x.source_url || '').trim();
          return '';
        }).filter(Boolean);
      }
    } catch (e) {}
  }
  return s.split(/\r?\n+/).map(x => x.trim()).filter(Boolean);
}
function serializeTrailerList(list) {
  const arr = (list || []).map(s => String(s).trim()).filter(Boolean);
  return arr.length ? JSON.stringify(arr) : '';
}
function collectTrailerInputs() {
  const box = document.getElementById('sg-trailers-list');
  if (!box) {
    const single = document.getElementById('sg-video');
    return single && single.value.trim() ? [single.value.trim()] : [];
  }
  return [...box.querySelectorAll('input.sg-trailer-url')]
    .map(i => i.value.trim())
    .filter(Boolean);
}
function renderTrailersEditor(urls) {
  const box = document.getElementById('sg-trailers-list');
  if (!box) return;
  const list = (urls && urls.length) ? urls : [''];
  box.innerHTML = list.map((u, i) => `
    <div class="sg-trailer-row" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <input class="auth-input sg-trailer-url" type="url" placeholder="https://… mp4 / m3u8 / youtube / steam" value="${escapeHtml(u)}" style="flex:1" />
      <button type="button" class="hp-btn-edit sg-trailer-del" title="Удалить" ${list.length < 2 ? 'disabled' : ''}>×</button>
    </div>`).join('');
  box.querySelectorAll('.sg-trailer-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const rows = [...box.querySelectorAll('.sg-trailer-row')];
      if (rows.length <= 1) return;
      btn.closest('.sg-trailer-row')?.remove();
    });
  });
  // sync hidden
  const hid = document.getElementById('sg-video');
  if (hid) hid.value = serializeTrailerList(collectTrailerInputs());
  box.querySelectorAll('input.sg-trailer-url').forEach(inp => {
    inp.addEventListener('input', () => {
      if (hid) hid.value = serializeTrailerList(collectTrailerInputs());
    });
  });
}
function ensureTrailersEditorUi() {
  const host = document.getElementById('sg-trailers-wrap');
  if (!host) return;
  if (!document.getElementById('sg-trailers-list')) {
    host.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
        <span style="font-size:0.85rem;opacity:0.85">Трейлеры (несколько ссылок)</span>
        <button type="button" class="hp-btn-edit" id="sg-trailer-add" type="button">+ ссылка</button>
      </div>
      <div id="sg-trailers-list"></div>
      <input type="hidden" name="video_url" id="sg-video" value="" />
      <div class="settings-hint" style="margin-top:6px">mp4, webm, HLS (.m3u8), YouTube. Steam CDN часто отдаёт HLS — плеер подхватит через hls.js.</div>`;
    document.getElementById('sg-trailer-add')?.addEventListener('click', () => {
      const cur = collectTrailerInputs();
      cur.push('');
      renderTrailersEditor(cur);
    });
  }
}

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

function showTrailerFallback(box, src, thumb, wrap) {
  // без кнопки «Открыть видео» — пробуем следующий ролик в галерее
  const items = (wrap && wrap._galleryItems) || [];
  const curSrc = String(src || '');
  let nextIdx = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type !== 'video') continue;
    if (items[i].src === curSrc || (items[i].fallbacks || []).includes(curSrc)) {
      // ищем следующий video после текущего
      for (let j = i + 1; j < items.length; j++) {
        if (items[j].type === 'video') { nextIdx = j; break; }
      }
      break;
    }
  }
  if (nextIdx < 0) {
    // первый рабочий video отличный от src
    for (let i = 0; i < items.length; i++) {
      if (items[i].type === 'video' && items[i].src !== curSrc) { nextIdx = i; break; }
    }
  }
  if (nextIdx >= 0 && wrap) {
    const it = items[nextIdx];
    $$('.gp-gallery-thumb', wrap).forEach((t, ti) => t.classList.toggle('active', ti === nextIdx));
    setGalleryMain(wrap, 'video', it.src, it.thumb || '', it.fallbacks || []);
    return;
  }
  // последний шанс — постер без кнопки
  if (thumb) {
    box.innerHTML = `<img id="gallery-main-img" src="${escapeHtml(thumb)}" alt="Трейлер" />`;
  } else {
    box.innerHTML = `<div style="width:100%;height:100%;background:#000;display:flex;align-items:center;justify-content:center;color:#888">Трейлер недоступен</div>`;
  }
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
          showTrailerFallback(box, src, thumb, wrap);
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
                  // CORS/Steam CDN — пробуем следующий URL, иначе кнопка «открыть»
                  if (idx < queue.length) tryPlay();
                  else showTrailerFallback(box, safeSrc, thumb, wrap);
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

// ---------- Корзина: страница и UI ----------
async function renderCartPage() {
  const empty = $('#cart-empty');
  const content = $('#cart-content');
  const list = $('#cart-list');
  const totalEl = $('#cart-total');
  if (!list) return;

  try { await syncCartPrices(); } catch (e) {}
  const items = getCart();
  if (!items.length) {
    if (empty) empty.classList.remove('hidden');
    if (content) content.classList.add('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');
  if (content) content.classList.remove('hidden');

  let total = 0;
  // карточки как в модалке «Добавлено в корзину»
  list.innerHTML = items.map(item => {
    const pi = formatPrice(item.price, item.discount_percent);
    const qty = parseInt(item.qty, 10) || 1;
    total += (pi.final || 0) * qty;
    const forVal = item.forAccount === 'friend' ? 'friend' : 'self';
    const copies = [];
    for (let i = 0; i < qty; i++) {
      copies.push(`
      <div class="cart-page-row store-row game-item" data-id="${item.id}" data-copy="${i}">
        <div class="cart-page-row-inner">
          <div class="cart-page-cover-wrap">
            <img class="cart-page-cover" src="${escapeHtml(item.cover || '')}" alt="" onerror="this.style.opacity=0.35" />
          </div>
          <div class="cart-page-details">
            <h3 class="cart-page-title">${escapeHtml(item.title || 'Игра')}</h3>
            <div class="cart-page-account">
              <select class="cart-modal-for" data-id="${item.id}" aria-label="Для кого">
                <option value="self" ${forVal === 'self' ? 'selected' : ''}>Для моего аккаунта</option>
                <option value="friend" ${forVal === 'friend' ? 'selected' : ''}>В подарок другу</option>
              </select>
            </div>
          </div>
          <div class="cart-page-side">
            <div class="cart-page-price">${renderPriceBlock(pi)}</div>
            <div class="cart-modal-actions cart-page-actions">
              <button type="button" class="cart-modal-link add" data-id="${item.id}">Добавить</button>
              <span class="cart-modal-act-sep">|</span>
              <button type="button" class="cart-modal-link remove" data-id="${item.id}">Удалить</button>
            </div>
          </div>
        </div>
      </div>`);
    }
    return copies.join('');
  }).join('');

  if (totalEl) totalEl.textContent = total > 0 ? `${Math.round(total)} ₽` : 'Бесплатно';

  list.querySelectorAll('.cart-modal-for').forEach(sel => {
    sel.addEventListener('change', () => setCartForAccount(sel.dataset.id, sel.value));
  });
  list.querySelectorAll('.cart-modal-link.add').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const item = getCart().find(x => String(x.id) === String(id));
      if (!item) return;
      addToCart({ id: item.id, title: item.title, price: item.price, discount_percent: item.discount_percent, cover: item.cover, cover_url: item.cover });
      renderCartPage();
    });
  });
  list.querySelectorAll('.cart-modal-link.remove').forEach(btn => {
    btn.addEventListener('click', () => {
      removeFromCart(btn.dataset.id, { one: true });
      renderCartPage();
    });
  });
  list.querySelectorAll('.cart-page-cover, .cart-page-title').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      const id = el.closest('[data-id]')?.dataset.id;
      if (id) gotoGame(id);
    });
  });
  try { initCatioSelects(list); } catch (e) {}
}

function setCheckoutAlert(msg, type) {
  const el = document.getElementById('checkout-alert');
  if (!el) return;
  if (!msg) {
    el.className = 'checkout-alert hidden';
    el.textContent = '';
    return;
  }
  el.className = 'checkout-alert' + (type === 'error' ? ' is-error' : type === 'ok' ? ' is-ok' : '');
  el.textContent = msg;
}

async function openCheckoutModal() {
  try { await syncCartPrices(); } catch (e) {}
  const items = getCart();
  if (!items.length) {
    toast('Корзина пуста');
    return;
  }
  const modal = $('#checkout-modal');
  const list = $('#checkout-modal-list');
  const totalEl = $('#checkout-modal-total');
  const cb = $('#checkout-agree-cb');
  const confirmBtn = $('#checkout-confirm');
  if (!modal || !list) {
    doCheckoutPurchase();
    return;
  }
  let total = 0;
  list.innerHTML = items.map(item => {
    const pi = formatPrice(item.price, item.discount_percent);
    const qty = parseInt(item.qty, 10) || 1;
    total += (pi.final || 0) * qty;
    let sub = 'Для моего аккаунта';
    if (item.forAccount === 'friend') {
      sub = item.giftToName
        ? ('В подарок ' + item.giftToName)
        : 'В подарок другу';
    }
    return `
      <div class="cart-modal-game">
        <img class="cart-modal-cover" src="${escapeHtml(item.cover || '')}" alt="" onerror="this.style.opacity=0.35" />
        <div class="cart-modal-meta">
          <div class="cart-modal-title">${escapeHtml(item.title || 'Игра')}${qty > 1 ? ` ×${qty}` : ''}</div>
          <div class="cart-modal-sub">${escapeHtml(sub)}</div>
        </div>
        <div class="cart-modal-side-price">${renderPriceBlock(pi)}</div>
      </div>`;
  }).join('');
  if (totalEl) totalEl.textContent = total > 0 ? `${Math.round(total)} ₽` : 'Бесплатно';
  if (cb) cb.checked = false;
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Приобрести';
  }
  setCheckoutAlert('');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeCheckoutModal() {
  const modal = $('#checkout-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  setCheckoutAlert('');
}

async function openGiftFriendModal() {
  const modal = document.getElementById('gift-friend-modal');
  const list = document.getElementById('gift-friend-list');
  if (!modal || !list) {
    openCheckoutModal();
    return;
  }
  list.innerHTML = '<div class="loading">Загрузка...</div>';
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  try {
    const giftIds = [...new Set(getCart().filter(i => i.forAccount === 'friend').map(i => +i.id).filter(Boolean))];
    window.__giftGameIds = giftIds;
    const data = await fetchJSON(`${FRIENDS_API}?action=list`);
    const friends = data.friends || [];
    let owns = {};
    if (giftIds.length) {
      try {
        const ownData = await fetchJSON(`${FRIENDS_API}?action=owns_games&game_ids=${giftIds.join(',')}`);
        owns = ownData.owns || {};
      } catch (e) {}
    }
    window.__giftOwnsMap = owns;
    window.__giftFriendsCache = friends;
    renderGiftFriendList(friends, '');
  } catch (e) {
    list.innerHTML = '<div class="empty-hint">Не удалось загрузить друзей</div>';
  }
}

function renderGiftFriendList(friends, q) {
  const list = document.getElementById('gift-friend-list');
  if (!list) return;
  const query = (q || '').trim().toLowerCase();
  const filtered = query
    ? friends.filter(u => String(u.username || '').toLowerCase().includes(query))
    : friends;
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-hint">Нет друзей для подарка</div>';
    return;
  }
  const ownsMap = window.__giftOwnsMap || {};
  const giftIds = window.__giftGameIds || [];
  list.innerHTML = filtered.map(u => {
    const owned = ownsMap[String(u.id)] || ownsMap[u.id] || [];
    const ownedSet = new Set((owned || []).map(Number));
    const ownsAny = giftIds.some(gid => ownedSet.has(+gid));
    const ownsAll = giftIds.length > 0 && giftIds.every(gid => ownedSet.has(+gid));
    const disabled = ownsAny; // нельзя выбрать, если уже есть хотя бы одна из игр
    let statusCls = 'gift-friend-status';
    let status;
    if (ownsAll || ownsAny) {
      status = ownsAll ? 'Уже владеет' : 'Уже есть в библиотеке';
      statusCls += ' is-owns';
    } else if (u.is_online) {
      status = 'В сети';
      statusCls += ' is-online';
    } else {
      status = 'Не в сети';
      statusCls += ' is-offline';
    }
    return `
    <button type="button" class="gift-friend-row${disabled ? ' is-disabled' : ''}" data-id="${u.id}" data-name="${escapeHtml(u.username || '')}" ${disabled ? 'disabled' : ''}>
      <span class="gift-friend-av" style="${typeof friendAvatarStyle === 'function' ? friendAvatarStyle(u) : ''}">${typeof friendAvatarText === 'function' ? friendAvatarText(u) : escapeHtml((u.username||'?')[0])}</span>
      <span class="gift-friend-meta">
        <span class="gift-friend-name">${escapeHtml(u.username || '')}</span>
        <span class="${statusCls}">${escapeHtml(status)}</span>
      </span>
    </button>`;
  }).join('');
  list.querySelectorAll('.gift-friend-row:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      setAllGiftFriends(btn.dataset.id, btn.dataset.name);
      closeGiftFriendModal();
      openCheckoutModal();
    });
  });
}

function closeGiftFriendModal() {
  const modal = document.getElementById('gift-friend-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

async function doCheckoutPurchase() {
  const items = getCart();
  if (!items.length) {
    toast('Корзина пуста');
    return;
  }
  const cb = document.getElementById('checkout-agree-cb');
  if (cb && !cb.checked) {
    setCheckoutAlert('Нужно согласиться с условиями покупки и возврата', 'error');
    return;
  }
  const missingGift = items.some(it => it.forAccount === 'friend' && !it.giftTo);
  if (missingGift) {
    setCheckoutAlert('Выберите друга для подарка', 'error');
    closeCheckoutModal();
    openGiftFriendModal();
    return;
  }

  const btn = $('#checkout-confirm') || $('#cart-checkout');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Оформляем...';
  }
  setCheckoutAlert('');

  let ok = 0, fail = 0;
  const boughtIds = [];
  const errors = [];
  const remaining = [];

  for (const item of items) {
    const qty = parseInt(item.qty, 10) || 1;
    let itemOk = true;
    for (let i = 0; i < qty; i++) {
      try {
        const payload = { game_id: item.id };
        if (item.forAccount === 'friend' && item.giftTo) payload.gift_to = +item.giftTo;
        const data = await postJSON(`${API_BASE}?action=buy`, payload);
        if (data.ok) {
          ok++;
          boughtIds.push(+item.id);
          if (data.balance !== undefined) updateBalance(data.balance);
          if (!data.gift) {
            sideLibAddOptimistic({ id: item.id, title: item.title, cover_url: item.cover, owned: true, purchased: true });
            try {
              if (Array.isArray(storeCache)) {
                const g = storeCache.find(x => +x.id === +item.id);
                if (g) { g.owned = true; g.purchased = true; }
              }
            } catch (e) {}
            if (window.__lastGameForCart && +window.__lastGameForCart.id === +item.id) {
              window.__lastGameForCart.owned = true;
              window.__lastGameForCart.purchased = true;
            }
          }
        } else {
          itemOk = false;
          fail++;
          errors.push(data.error || 'Не удалось оформить');
          break;
        }
      } catch (e) {
        itemOk = false;
        fail++;
        errors.push((e && e.message) || 'Ошибка сети');
        break;
      }
    }
    if (!itemOk) remaining.push(item);
  }

  if (remaining.length) {
    saveCart(remaining);
  } else {
    clearCart();
  }
  renderCartPage();

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Приобрести';
  }

  if (fail && ok === 0) {
    // ничего не купилось — модалку оставляем, показываем алерт
    const msg = errors.find(x => /средств|баланс/i.test(x)) || errors[0] || 'Не удалось оформить покупку';
    setCheckoutAlert(msg, 'error');
    // снять disabled у кнопки если галочка стоит
    if (cb && cb.checked) btn && (btn.disabled = false);
    return;
  }

  closeCheckoutModal();
  if (ok && !fail) toast(ok === 1 ? 'Готово' : `Оформлено: ${ok}`);
  else if (ok && fail) toast(`Оформлено: ${ok}, с ошибкой: ${fail}`);
  else if (fail) toast('Не удалось оформить покупку');

  if (ok && typeof loadSideLibrary === 'function') loadSideLibrary();
  try {
    if ($('#view-store')?.classList.contains('active') && typeof renderStoreList === 'function') renderStoreList();
  } catch (e) {}
  try {
    const last = window.__lastGameForCart;
    if (last && boughtIds.includes(+last.id) && typeof loadGamePage === 'function') {
      loadGamePage(last.id);
    }
  } catch (e) {}
}

function checkoutCart() {
  const items = getCart();
  if (!items.length) {
    toast('Корзина пуста');
    return;
  }
  const needGift = items.some(it => it.forAccount === 'friend' && !it.giftTo);
  if (needGift) openGiftFriendModal();
  else openCheckoutModal();
}

function openRefundPolicyModal() {
  const m = document.getElementById('refund-policy-modal');
  if (!m) return;
  m.classList.remove('hidden');
  m.style.zIndex = '10050';
  m.style.pointerEvents = 'auto';
  m.style.opacity = '1';
  m.style.visibility = 'visible';
}
function closeRefundPolicyModal() {
  const m = document.getElementById('refund-policy-modal');
  if (!m) return;
  m.classList.add('hidden');
  m.style.zIndex = '';
  m.style.pointerEvents = '';
  m.style.opacity = '';
  m.style.visibility = '';
}

function initCartUI() {
  // смена аккаунта → другая корзина
  window.addEventListener('auth:changed', () => {
    try { updateCartBadge(); renderCartPage(); } catch (e) {}
  });
  // если AUTH_STATE выставляется без события — перечитать при focus
  window.addEventListener('focus', () => {
    try { updateCartBadge(); } catch (e) {}
  });
  window.addEventListener('cart:changed', () => {
    try {
      if ($('#view-store')?.classList.contains('active') && typeof renderStoreList === 'function') {
        renderStoreList();
      }
    } catch (e) {}
  });

  updateCartBadge();
  const cartBtn = $('#btn-cart');
  if (cartBtn) {
    cartBtn.addEventListener('click', () => showView('cart'));
  }
  const goStore = $('#cart-go-store');
  if (goStore) goStore.addEventListener('click', () => showView('store'));
  const clearBtn = $('#cart-clear');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    if (confirm('Очистить корзину?')) {
      clearCart();
      renderCartPage();
    }
  });
  const checkout = $('#cart-checkout');
  if (checkout) checkout.addEventListener('click', checkoutCart);

  // подтверждение покупки
  document.getElementById('checkout-modal-close')?.addEventListener('click', closeCheckoutModal);
  document.getElementById('checkout-cancel')?.addEventListener('click', closeCheckoutModal);
  document.getElementById('checkout-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'checkout-modal') closeCheckoutModal();
  });
  document.getElementById('checkout-agree-cb')?.addEventListener('change', () => {
    setCheckoutAlert('');
  });
  document.getElementById('checkout-confirm')?.addEventListener('click', () => {
    if (!document.getElementById('checkout-agree-cb')?.checked) {
      setCheckoutAlert('Нужно согласиться с условиями покупки и возврата', 'error');
      return;
    }
    doCheckoutPurchase();
  });

  // условия покупки — делегирование, чтобы не ломалось
  document.addEventListener('click', (e) => {
    const openBtn = e.target.closest('#refund-policy-open');
    if (openBtn) {
      e.preventDefault();
      e.stopPropagation();
      openRefundPolicyModal();
      return;
    }
    if (e.target.closest('[data-close-refund]')) {
      e.preventDefault();
      e.stopPropagation();
      closeRefundPolicyModal();
    }
  });

  document.getElementById('gift-friend-close')?.addEventListener('click', closeGiftFriendModal);
  document.getElementById('gift-friend-cancel')?.addEventListener('click', closeGiftFriendModal);
  document.getElementById('gift-friend-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'gift-friend-modal') closeGiftFriendModal();
  });
  document.getElementById('gift-friend-search')?.addEventListener('input', (e) => {
    renderGiftFriendList(window.__giftFriendsCache || [], e.target.value);
  });
}



function bindPublisherLineClicks(el) {
  if (!el) return;
  el.querySelectorAll('.hp-publisher-link').forEach(b => {
    if (b.dataset.bound === '1') return;
    b.dataset.bound = '1';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = +b.dataset.id;
      if (id) openPublisherPage(id, b.dataset.slug || '');
    });
  });
}

/** Мгновенно рисует/прячет строку издательства (без сети). */
function renderPublisherLine(el, pubs) {
  if (!el) return;
  if (!pubs || !pubs.length) {
    el.innerHTML = '';
    el.hidden = true;
    el.setAttribute('hidden', '');
    el.style.display = 'none';
    return;
  }
  el.innerHTML = pubs.map(p =>
    '<button type="button" class="hp-publisher-link" data-id="' + p.id + '" data-slug="' + escapeHtml(p.slug || '') + '">' +
      escapeHtml(p.name) +
    '</button>'
  ).join('<span class="hp-publisher-sep">·</span>');
  el.hidden = false;
  el.removeAttribute('hidden');
  el.style.display = 'flex';
  el.style.visibility = 'visible';
  el.style.opacity = '1';
  bindPublisherLineClicks(el);
}

/**
 * Загружает издательство для userId.
 * При смене userId сразу очищает строку, чтобы не светилось чужое.
 */
async function loadProfilePublishers(userId, lineEl) {
  const el = lineEl || document.getElementById('hp-publisher-line');
  if (!el || !userId) return;
  const uid = +userId;
  if (!uid) return;

  const prev = +(el.dataset.forUser || 0);
  el.dataset.forUser = String(uid);
  // смена пользователя → сразу убираем чужое/моё, пока не пришёл ответ
  if (prev && prev !== uid) {
    renderPublisherLine(el, []);
  }

  const token = ++window.__pubLineToken;

  try {
    const data = await fetchJSON(PUB_API + '?action=for_user&user_id=' + uid + '&_t=' + Date.now());
    if (token !== window.__pubLineToken) return;
    if (+(el.dataset.forUser || 0) !== uid) return;

    const all = (data && Array.isArray(data.publishers)) ? data.publishers : [];
    let pref = data ? data.display_publisher_id : null;
    if (pref === 'hide' || pref === false || pref === '0') pref = 0;
    if (pref !== null && pref !== undefined && pref !== '') pref = Number(pref);

    let show = [];
    if (pref === 0) {
      show = [];
    } else if (pref > 0) {
      const one = all.find(p => +p.id === +pref);
      show = one ? [one] : [];
    } else {
      show = all.length ? [all[0]] : [];
    }
    renderPublisherLine(el, show);
  } catch (e) {
    console.warn('loadProfilePublishers', e);
  }
}

/** Скрыть/показать боковую карточку целиком */
function setSideCardVisible(bodyEl, visible) {
  if (!bodyEl) return;
  const card = bodyEl.closest ? bodyEl.closest('.hp-side-card') : null;
  if (!card) return;
  card.style.display = visible ? '' : 'none';
}


window.renderPublisherLine = renderPublisherLine;
window.loadProfilePublishers = loadProfilePublishers;
window.setSideCardVisible = setSideCardVisible;
if (typeof bindPublisherLineClicks === 'function') window.bindPublisherLineClicks = bindPublisherLineClicks;



// --- global create / submit openers (must work even if other init fails) ---
window.openSubmitRules = function openSubmitRules() {
  try { if (typeof resetPublishFormMode === 'function') resetPublishFormMode(); } catch (e) {}
  const modal = document.getElementById('submit-rules-modal');
  if (!modal) {
    // fallback: сразу форма
    const formModal = document.getElementById('submit-form-modal');
    if (formModal) {
      formModal.classList.remove('hidden');
      return;
    }
    alert('Модалка добавления игры не найдена. Обнови index.php');
    return;
  }
  const agree = document.getElementById('submit-agree');
  if (agree) agree.checked = false;
  const next = document.getElementById('submit-rules-next');
  if (next) next.disabled = true;
  modal.classList.remove('hidden');
};
window.openCreateMenu = function openCreateMenu() {
  const m = document.getElementById('create-menu-modal');
  if (!m) {
    window.openSubmitRules();
    return;
  }
  m.classList.remove('hidden');
};
window.closeCreateMenu = function closeCreateMenu() {
  const m = document.getElementById('create-menu-modal');
  if (m) m.classList.add('hidden');
};

if (!window.__createMenuDelegated) {
  window.__createMenuDelegated = true;
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#btn-add-game')) {
      e.preventDefault();
      e.stopPropagation();
      if (window.openCreateMenu) window.openCreateMenu();
      else if (window.openSubmitRules) window.openSubmitRules();
      return;
    }
    if (t.closest('#create-menu-game')) {
      e.preventDefault();
      e.stopPropagation();
      if (window.closeCreateMenu) window.closeCreateMenu();
      (async function() {
        let pubs = [];
        try {
          pubs = await window.fetchMyPublishers(true);
        } catch (err) {
          console.warn(err);
          toast(err.message || 'Ошибка загрузки издательств');
          return;
        }
        if (!pubs.length) {
          if (typeof openNoPubModal === 'function') openNoPubModal();
          else alert('Сначала создайте издательство');
          return;
        }
        if (window.openSubmitRules) window.openSubmitRules();
      })();
      return;
    }
    if (t.closest('[data-close-create-menu]')) {
      if (window.closeCreateMenu) window.closeCreateMenu();
    }
  }, true);
}
document.addEventListener('DOMContentLoaded', () => {
  // Сначала кнопка «+», чтобы сбой других init её не убил


/* ===== Издательства / меню создания ===== */
window.__pubMembersSelected = [];

function openCreateMenu() {
  const m = $('#create-menu-modal');
  if (!m) { openSubmitRules(); return; }
  m.classList.remove('hidden');
}
window.openNoPubModal = function openNoPubModal() {
  const m = $('#no-pub-modal');
  if (m) m.classList.remove('hidden');
  else toast('Сначала создайте издательство');
}
function closeCreateMenu() {
  $('#create-menu-modal')?.classList.add('hidden');
}

document.addEventListener('click', (e) => {
  const pl = e.target.closest && e.target.closest('.gp-publisher-link');
  if (pl) {
    e.preventDefault();
    openPublisherPage(+pl.dataset.pubId);
  }
});

function initCreateMenu() {
  if (window.__createMenuBound) return;
  window.__createMenuBound = true;
  document.querySelectorAll('[data-close-create-menu]').forEach(el => {
    el.addEventListener('click', closeCreateMenu);
  });
  $('#create-menu-game')?.addEventListener('click', async () => {
    closeCreateMenu();
    try {
      const pubs = await window.fetchMyPublishers(true);
      if (!pubs.length) {
        openNoPubModal();
        return;
      }
    } catch (e) {
      toast(e.message || 'Ошибка загрузки издательств');
      return;
    }
    openSubmitRules();
  });
  document.querySelectorAll('[data-close-no-pub]').forEach(el => {
    el.addEventListener('click', () => $('#no-pub-modal')?.classList.add('hidden'));
  });
  $('#no-pub-create')?.addEventListener('click', () => {
    $('#no-pub-modal')?.classList.add('hidden');
    openPubsCreateModal();
  });
  $('#create-menu-pubs')?.addEventListener('click', () => {
    closeCreateMenu();
    openPubsListModal();
  });
  document.querySelectorAll('[data-close-pubs-list]').forEach(el => {
    el.addEventListener('click', () => $('#pubs-list-modal')?.classList.add('hidden'));
  });
  document.querySelectorAll('[data-close-pubs-create]').forEach(el => {
    el.addEventListener('click', () => $('#pubs-create-modal')?.classList.add('hidden'));
  });
  $('#pubs-create-open')?.addEventListener('click', () => {
    $('#pubs-list-modal')?.classList.add('hidden');
    openPubsCreateModal();
  });
  $('#pub-create-save')?.addEventListener('click', saveNewPublisher);
  ['pub-name', 'pub-desc'].forEach(id => {
    const el = document.getElementById(id);
    if (!el || el.dataset.counterBound) return;
    el.dataset.counterBound = '1';
    el.addEventListener('input', updatePubFieldCounters);
  });
  // file previews
  const bindPrev = (inputId, prevId) => {
    const input = document.getElementById(inputId);
    const prev = document.getElementById(prevId);
    if (!input || input.dataset.bound) return;
    input.dataset.bound = '1';
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (!f || !prev) return;
      prev.style.backgroundImage = 'url(' + JSON.stringify(URL.createObjectURL(f)) + ')';
      prev.classList.add('has-img');
    });
  };
  bindPrev('pub-avatar', 'pub-avatar-preview');
  bindPrev('pub-banner', 'pub-banner-preview');
  // member search
  const search = $('#pub-member-search');
  let st = null;
  search?.addEventListener('input', () => {
    clearTimeout(st);
    st = setTimeout(() => searchPubMembers(search.value.trim()), 220);
  });
  window.openCreateMenu = openCreateMenu;
}

window.openPubsListModal = async function openPubsListModal() {
  const modal = $('#pubs-list-modal');
  const list = $('#pubs-list');
  if (!modal || !list) return;
  modal.classList.remove('hidden');

  const renderList = (pubs) => {
    if (!pubs.length) {
      list.innerHTML = '<div class="friends-empty">Пока нет издательств.<br>Создайте первое — и выбирайте его при публикации.</div>';
      return;
    }
    list.innerHTML = pubs.map(p => `
      <button type="button" class="pubs-list-item" data-id="${p.id}" data-slug="${escapeHtml(p.slug || '')}">
        <span class="pubs-list-av" style="${p.avatar_url ? `background-image:url('${escapeHtml(p.avatar_url)}')` : 'background:#ef5b2c'}">${p.avatar_url ? '' : escapeHtml((p.name || '?')[0])}</span>
        <span class="pubs-list-info">
          <strong>${escapeHtml(p.name)}</strong>
          <em>${p.games_count || 0} игр · ${p.members_count || 0} уч. · ${p.my_role === 'owner' ? 'владелец' : 'участник'}</em>
        </span>
      </button>`).join('');
    $$('.pubs-list-item', list).forEach(btn => {
      btn.addEventListener('click', () => {
        modal.classList.add('hidden');
        openPublisherPage(+btn.dataset.id, btn.dataset.slug);
      });
    });
  };

  // мгновенно из кэша после создания
  let pubs = [];
  if (window.__pendingPublishPublishers && window.__pendingPublishPublishers.length) {
    pubs = window.__pendingPublishPublishers;
  } else if (window.__myPublishersCache && Array.isArray(window.__myPublishersCache.list) && window.__myPublishersCache.list.length) {
    pubs = window.__myPublishersCache.list;
  }
  if (pubs.length) {
    renderList(pubs);
  } else {
    list.innerHTML = '<div class="loading">Загрузка...</div>';
  }

  try {
    const fresh = await window.fetchMyPublishers(true);
    if (Array.isArray(fresh)) {
      pubs = fresh;
      window.__pendingPublishPublishers = pubs;
      renderList(pubs);
    } else if (!pubs.length) {
      throw new Error('Ошибка');
    }
  } catch (e) {
    if (!pubs.length) {
      list.innerHTML = `<div class="friends-empty">${escapeHtml(e.message)}</div>`;
    }
  }
}

function updatePubFieldCounters() {
  const name = $('#pub-name');
  const desc = $('#pub-desc');
  const nameCount = $('#pub-name-count');
  const descCount = $('#pub-desc-count');
  if (name && nameCount) {
    const n = (name.value || '').length;
    nameCount.textContent = n + ' / 60';
    nameCount.classList.toggle('is-warn', n >= 50);
    nameCount.classList.toggle('is-over', n >= 60);
    name.classList.toggle('is-invalid', n > 0 && n < 2);
  }
  if (desc && descCount) {
    const n = (desc.value || '').length;
    descCount.textContent = n + ' / 300';
    descCount.classList.toggle('is-warn', n >= 260);
    descCount.classList.toggle('is-over', n >= 300);
  }
}

function openPubsCreateModal() {
  window.__pubMembersSelected = [];
  renderPubMemberChips();
  const name = $('#pub-name'); if (name) { name.value = ''; name.classList.remove('is-invalid'); }
  const desc = $('#pub-desc'); if (desc) desc.value = '';
  const av = $('#pub-avatar'); if (av) av.value = '';
  const bn = $('#pub-banner'); if (bn) bn.value = '';
  const ap = $('#pub-avatar-preview'); if (ap) { ap.style.backgroundImage = ''; ap.classList.remove('has-img'); }
  const bp = $('#pub-banner-preview'); if (bp) { bp.style.backgroundImage = ''; bp.classList.remove('has-img'); }
  $('#pub-member-suggest')?.classList.add('hidden');
  updatePubFieldCounters();
  $('#pubs-create-modal')?.classList.remove('hidden');
}

async function searchPubMembers(q) {
  const box = $('#pub-member-suggest');
  if (!box) return;
  if (!q) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  try {
    const data = await fetchJSON(PUB_API + '?action=search_users&q=' + encodeURIComponent(q));
    const users = (data.users || []).filter(u => !window.__pubMembersSelected.some(m => +m.id === +u.id));
    if (!users.length) {
      box.innerHTML = '<div class="pub-member-empty">Никого не найдено</div>';
      box.classList.remove('hidden');
      return;
    }
    box.innerHTML = users.map(u => `
      <button type="button" class="pub-member-opt" data-id="${u.id}" data-name="${escapeHtml(u.username)}">
        <span class="pubs-list-av" style="${u.avatar_url ? `background-image:url('${escapeHtml(u.avatar_url)}')` : `background:${escapeHtml(u.avatar_color || '#ef5b2c')}`}">${u.avatar_url ? '' : escapeHtml((u.username||'?')[0])}</span>
        ${escapeHtml(u.username)}
      </button>`).join('');
    box.classList.remove('hidden');
    $$('.pub-member-opt', box).forEach(b => {
      b.addEventListener('click', () => {
        window.__pubMembersSelected.push({ id: +b.dataset.id, username: b.dataset.name });
        renderPubMemberChips();
        box.classList.add('hidden');
        const s = $('#pub-member-search'); if (s) s.value = '';
      });
    });
  } catch (e) {
    box.classList.add('hidden');
  }
}

function renderPubMemberChips() {
  const box = $('#pub-member-chips');
  if (!box) return;
  box.innerHTML = (window.__pubMembersSelected || []).map(m => `
    <span class="pub-member-chip" data-id="${m.id}">
      ${escapeHtml(m.username)}
      <button type="button" data-rm="${m.id}" aria-label="Убрать">×</button>
    </span>`).join('');
  $$('[data-rm]', box).forEach(b => {
    b.addEventListener('click', () => {
      window.__pubMembersSelected = window.__pubMembersSelected.filter(m => +m.id !== +b.dataset.rm);
      renderPubMemberChips();
    });
  });
}

window.saveNewPublisher = async function saveNewPublisher() {
  const btn = $('#pub-create-save');
  const nameEl = $('#pub-name');
  const descEl = $('#pub-desc');
  const name = (nameEl?.value || '').trim();
  const desc = (descEl?.value || '').trim();
  if (name.length < 2) {
    nameEl?.classList.add('is-invalid');
    toast('Название: минимум 2 символа');
    return;
  }
  if (name.length > 60) {
    nameEl?.classList.add('is-invalid');
    toast('Название: максимум 60 символов');
    return;
  }
  if (desc.length > 300) {
    descEl?.classList.add('is-invalid');
    toast('Описание: максимум 300 символов');
    return;
  }
  nameEl?.classList.remove('is-invalid');
  descEl?.classList.remove('is-invalid');
  if (btn) { btn.disabled = true; btn.textContent = 'Создание...'; }
  try {
    const fd = new FormData();
    fd.append('csrf_token', window.CSRF_TOKEN || '');
    fd.append('name', name);
    fd.append('description', desc);
    fd.append('members', (window.__pubMembersSelected || []).map(m => m.id).join(','));
    const av = $('#pub-avatar')?.files?.[0];
    if (av) fd.append('avatar', av);
    const bn = $('#pub-banner')?.files?.[0];
    if (bn) fd.append('banner', bn);
    const res = await fetch(PUB_API + '?action=create', { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    toast('Издательство создано');
    $('#pubs-create-modal')?.classList.add('hidden');

    // Сразу кладём созданное издательство в кэш — можно публиковать без ожидания
    const created = data.publisher || {};
    const localPub = {
      id: created.id,
      name: created.name || name,
      slug: created.slug || '',
      avatar_url: created.avatar_url || null,
      owner_id: created.owner_id || (window.AUTH_STATE && window.AUTH_STATE.user && window.AUTH_STATE.user.id) || 0,
      my_role: 'owner',
      members_count: 1 + ((window.__pubMembersSelected || []).length || 0),
      games_count: 0
    };
    try {
      await window.fillPublishPublisherSelect(localPub.id);
    } catch (e) {
      console.warn(e);
    }
    try {
      const me = window.AUTH_STATE && window.AUTH_STATE.user;
      if (me && me.id && typeof loadProfilePublishers === 'function') {
        loadProfilePublishers(me.id);
      }
    } catch (e) {}
    openPubsListModal();
  } catch (e) {
    toast(e.message || 'Не удалось создать');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Создать'; }
  }
}


/* ===== Публикация: вкладки формы + сборки ===== */
window.__pendingBuilds = window.__pendingBuilds || [];


function initPubMediaTabs() {
  const tabs = document.getElementById('pub-media-tabs');
  if (!tabs || tabs.dataset.bound) return;
  tabs.dataset.bound = '1';
  const show = (name) => {
    tabs.querySelectorAll('.pub-media-tab').forEach(b => b.classList.toggle('active', b.dataset.mediaTab === name));
    const pane = document.querySelector('#submit-game-form [data-pub-pane="media"]');
    if (!pane) return;
    pane.querySelectorAll('[data-media-panel]').forEach(el => {
      el.style.display = (el.dataset.mediaPanel === name) ? '' : 'none';
    });
  };
  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.pub-media-tab');
    if (!btn) return;
    show(btn.dataset.mediaTab);
  });
  show('cover');
}

function switchPubTab(tab) {
  if (!tab) return;
  console.log('[pub] switch tab', tab);
  const modal = document.getElementById('submit-form-modal');
  if (!modal) return;
  modal.querySelectorAll('.pub-nav-btn').forEach(b => {
    const t = b.getAttribute('data-pub-tab');
    b.classList.toggle('active', t === tab);
  });
  modal.querySelectorAll('.pub-pane').forEach(p => {
    const on = p.getAttribute('data-pub-pane') === tab;
    p.classList.toggle('active', on);
    // clear inline styles from older code
    p.style.display = '';
  });
  if (tab === 'media') {
    try { initPubMediaTabs(); } catch (e) {}
  }
  try { updatePublishSectionStatus(); } catch (e) {}
}
window.switchPubTab = switchPubTab;

function initPubFormTabs() {
  if (window.__pubTabsDelegated) return;
  window.__pubTabsDelegated = true;
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('#pub-form-nav .pub-nav-btn, .pub-nav-btn[data-pub-tab]');
    if (!btn || !btn.closest('#submit-form-modal')) return;
    e.preventDefault();
    e.stopPropagation();
    const tab = btn.getAttribute('data-pub-tab') || btn.dataset.pubTab;
    switchPubTab(tab);
  }, true);
  // initial
  try { switchPubTab('main'); } catch (e) {}
}

function getPublishSectionStatus() {
  const title = ($('#sg-title')?.value || '').trim();
  const genres = $$('.sg-genre').filter(c => c.checked);
  const pubId = ($('#sg-publisher-id')?.value || '').trim();
  // description
  try { if (typeof syncPublishDescription === 'function') syncPublishDescription(); } catch (e) {}
  let desc = ($('#sg-desc')?.value || '').trim();
  if (!desc) {
    const ed = $('#sg-desc-editor');
    if (ed) desc = (ed.innerText || ed.textContent || '').trim();
  }
  const coverFile = $('#sg-cover')?.files?.[0];
  const coverUrl = ($('#sg-cover-url')?.value || '').trim();
  const hasCover = !!(coverFile || coverUrl);
  const buildVer = (document.getElementById('sg-build-version')?.value || '').trim();
  const buildFile = (typeof getSelectedBuildFile === 'function') ? getSelectedBuildFile() : document.getElementById('sg-build-file')?.files?.[0];
  const hasBuild = !!(buildVer && buildFile);

  return {
    main: !!(title && genres.length),
    desc: desc.length >= 10,
    media: hasCover,
    sys: true,
    lang: true,
    builds: hasBuild,
    content: true
  };
}

function updatePublishSectionStatus() {
  const st = getPublishSectionStatus();
  Object.keys(st).forEach(key => {
    const el = document.querySelector('#pub-form-nav [data-status-for="' + key + '"]');
    if (!el) return;
    const ok = !!st[key];
    el.textContent = ok ? '✓' : '✕';
    el.classList.toggle('is-ok', ok);
    el.classList.toggle('is-bad', !ok);
  });
  const allOk = Object.values(st).every(Boolean);
  const send = document.getElementById('submit-game-send');
  if (send) {
    const isAdminMod = !!(send.dataset.adminPublish || send.dataset.adminSave);
    const isPubEdit = !!(send.dataset.publisherEdit);
    // Не ставим disabled — клик покажет, чего не хватает. Только визуальный is-disabled.
    send.disabled = false;
    send.removeAttribute('disabled');
    if (isAdminMod) {
      send.classList.remove('is-disabled');
      send.title = '';
      send.dataset.blockReason = '';
    } else if (isPubEdit) {
      const verOk = !!(document.getElementById('sg-build-version')?.value || '').trim();
      const fileOk = !!(typeof getSelectedBuildFile === 'function' ? getSelectedBuildFile() : document.getElementById('sg-build-file')?.files?.[0]);
      const okUpd = verOk && fileOk;
      send.classList.toggle('is-disabled', !okUpd);
      send.title = okUpd ? '' : 'Укажите новую версию и прикрепите файл сборки';
      send.dataset.blockReason = okUpd ? '' : 'Укажите новую версию и прикрепите файл сборки';
    } else {
      send.classList.toggle('is-disabled', !allOk);
      const missing = [];
      if (!st.main) missing.push('название и жанры');
      if (!st.desc) missing.push('описание (от 10 символов)');
      if (!st.media) missing.push('обложку');
      if (!st.builds) missing.push('версию и файл сборки');
      const reason = missing.length ? ('Заполните: ' + missing.join(', ')) : '';
      send.title = reason;
      send.dataset.blockReason = reason;
    }
  }
  return allOk;
}
window.updatePublishSectionStatus = updatePublishSectionStatus;

function bindPublishValidationWatchers() {
  if (window.__pubValidateBound) return;
  window.__pubValidateBound = true;
  const form = document.getElementById('submit-game-form');
  if (!form) return;
  form.addEventListener('input', () => updatePublishSectionStatus());
  form.addEventListener('change', () => updatePublishSectionStatus());
  document.addEventListener('input', (e) => {
    if (e.target && (e.target.id === 'sg-desc-editor' || e.target.closest?.('#sg-desc-editor'))) {
      updatePublishSectionStatus();
    }
  });
}


function formatBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' Б';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' КБ';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' МБ';
  return (n / 1073741824).toFixed(2) + ' ГБ';
}

function renderPendingBuilds() {
  const box = document.getElementById('sg-builds-list');
  const hid = document.getElementById('sg-builds-json');
  if (!box) return;
  const list = window.__pendingBuilds || [];
  if (hid) {
    hid.value = JSON.stringify(list.map(b => ({
      version: b.version, platform: b.platform, changelog: b.changelog || '',
      file_name: b.file_name || (b.file && b.file.name) || '', file_size: b.file_size || (b.file && b.file.size) || 0,
      id: b.id || null, file_url: b.file_url || null
    })));
  }
  if (!list.length) {
    box.innerHTML = '<div class="settings-hint">Пока нет сборок — добавьте файл выше. При отправке игры они загрузятся вместе с карточкой.</div>';
    return;
  }
  box.innerHTML = list.map((b, i) => `
    <div class="build-item" data-idx="${i}">
      <div class="bi-meta">
        <div class="bi-title">${escapeHtml(b.version || '1.0')} · ${escapeHtml(b.platform || 'windows')}</div>
        <div class="bi-sub">${escapeHtml(b.file_name || (b.file && b.file.name) || b.file_url || 'файл')} · ${formatBytes(b.file_size || (b.file && b.file.size) || 0)}${b.changelog ? ' · ' + escapeHtml(String(b.changelog).slice(0, 80)) : ''}</div>
      </div>
      <button type="button" class="bi-del" data-del-build="${i}" title="Убрать">×</button>
    </div>`).join('');
  box.querySelectorAll('[data-del-build]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = +btn.dataset.delBuild;
      const item = window.__pendingBuilds[i];
      if (item && item.id) {
        try {
          await postJSON((typeof SUBMIT_API !== 'undefined' ? SUBMIT_API : 'api/submit.php') + '?action=delete_build', {
            csrf_token: window.CSRF_TOKEN || '', id: item.id
          });
        } catch (e) {
          toast(e.message || 'Не удалось удалить сборку');
          return;
        }
      }
      window.__pendingBuilds.splice(i, 1);
      renderPendingBuilds();
    });
  });
}

function getSelectedBuildFile() {
  const input = document.getElementById('sg-build-file');
  if (input && input.files && input.files[0]) return input.files[0];
  if (window.__selectedBuildFile instanceof File) return window.__selectedBuildFile;
  return null;
}
function setBuildFileLabel(file) {
  const nameEl = document.getElementById('sg-build-file-name');
  if (!nameEl) return;
  if (file) {
    const sz = (typeof formatBytes === 'function') ? formatBytes(file.size) : ((file.size / 1048576).toFixed(1) + ' МБ');
    nameEl.textContent = file.name + ' · ' + sz;
    nameEl.style.cssText = 'display:inline;opacity:1;visibility:visible;color:var(--text-bright)';
  } else {
    nameEl.textContent = 'ZIP / EXE / 7z…';
  }
}
function initBuildsUi() {
  const fileInput = document.getElementById('sg-build-file');
  const ver = document.getElementById('sg-build-version');
  const ch = document.getElementById('sg-build-changelog');
  const updateBuildName = () => {
    const f = getSelectedBuildFile();
    setBuildFileLabel(f);
    try { updatePublishSectionStatus(); } catch (e) {}
  };
  if (fileInput && fileInput.dataset.boundBuild !== '1') {
    fileInput.dataset.boundBuild = '1';
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files[0]) window.__selectedBuildFile = fileInput.files[0];
      updateBuildName();
    });
    const openBuild = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof openPubFilePicker === 'function') {
        openPubFilePicker(fileInput, {
          multiple: false,
          accept: '.exe,.zip,.7z,.rar,.msi,.dmg,.appimage,.tar,.gz,application/zip,application/octet-stream'
        });
      } else {
        fileInput.click();
      }
    };
    document.querySelectorAll('label[for="sg-build-file"]').forEach(lab => {
      lab.addEventListener('click', openBuild);
    });
    fileInput.addEventListener('click', openBuild);
  }
  if (ver && ver.dataset.boundBuild !== '1') {
    ver.dataset.boundBuild = '1';
    ver.addEventListener('input', () => { try { updatePublishSectionStatus(); } catch (e) {} });
    ver.addEventListener('change', () => { try { updatePublishSectionStatus(); } catch (e) {} });
  }
  if (ch && ch.dataset.boundBuild !== '1') {
    ch.dataset.boundBuild = '1';
    ch.addEventListener('input', () => { try { updatePublishSectionStatus(); } catch (e) {} });
  }
}

async function loadGameBuildsIntoForm(gameId) {
  if (!gameId) return;
  try {
    const data = await fetchJSON((typeof SUBMIT_API !== 'undefined' ? SUBMIT_API : 'api/submit.php') + '?action=list_builds&game_id=' + encodeURIComponent(gameId));
    if (!data.ok) return;
    const list = data.builds || [];
    const ver = document.getElementById('sg-build-version');
    const ch = document.getElementById('sg-build-changelog');
    const nameEl = document.getElementById('sg-build-file-name');
    const exist = document.getElementById('sg-build-existing');
    if (!list.length) {
      if (exist) { exist.style.display = 'none'; exist.textContent = ''; }
      return;
    }
    const b = list[0];
    if (ver) ver.value = b.version || '';
    if (ch) ch.value = b.changelog || '';
    const fname = b.file_name || (b.file_url ? String(b.file_url).split('/').pop() : '') || 'файл на сервере';
    const size = b.file_size_bytes ? (' · ' + formatBytes(b.file_size_bytes)) : '';
    if (nameEl) nameEl.textContent = fname + size + ' (на сервере)';
    if (exist) {
      exist.style.display = 'block';
      exist.innerHTML = '<strong>Текущая сборка:</strong> v' + escapeHtml(b.version || '—')
        + (b.changelog ? ' — ' + escapeHtml(String(b.changelog)) : '')
        + '<br>Файл: ' + escapeHtml(fname) + size
        + (b.status ? ' · статус: ' + escapeHtml(b.status) : '');
    }
  } catch (e) {
    console.warn('list_builds', e);
  }
}


/** Издательства: прямые запросы (логика a75e210) */
window.__myPublishersCache = window.__myPublishersCache || { list: null, ts: 0 };
window.__pendingPublishPublishers = null;

window.fetchMyPublishers = async function fetchMyPublishers(force) {
  const api = (typeof PUB_API !== 'undefined' ? PUB_API : 'api/publishers.php');
  const url = api + '?action=mine&_t=' + Date.now();
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Accept': 'application/json' }
  });
  const text = await res.text();
  let data;
  try {
    const s = text.indexOf('{');
    data = JSON.parse(s >= 0 ? text.slice(s) : text);
  } catch (e) {
    console.error('[publishers] bad JSON', text.slice(0, 300));
    throw new Error('Ответ publishers не JSON');
  }
  if (!data || data.ok === false) {
    throw new Error((data && data.error) || ('HTTP ' + res.status));
  }
  const pubs = Array.isArray(data.publishers) ? data.publishers : [];
  console.log('[publishers] mine ok', pubs.length, pubs);
  window.__myPublishersCache = { list: pubs, ts: Date.now() };
  window.__pendingPublishPublishers = pubs;
  return pubs;
}

window.applyPublisherOptionsToSelect = function applyPublisherOptionsToSelect(sel, pubs, prefer) {
  if (!sel) return;
  try {
    const oldWrap = sel.closest('.catio-select');
    if (oldWrap && oldWrap.parentNode) {
      oldWrap.parentNode.insertBefore(sel, oldWrap);
      oldWrap.remove();
    }
  } catch (e) {}
  delete sel.dataset.catioEnhanced;
  sel.classList.add('settings-select');
  sel.classList.remove('select-native-hidden', 'hidden');
  sel.hidden = false;
  sel.style.cssText = 'display:block;visibility:visible;';
  sel.removeAttribute('aria-hidden');
  sel.removeAttribute('tabindex');

  const list = Array.isArray(pubs) ? pubs : [];
  // всегда можно без издательства
  let html = '<option value="">— без издательства —</option>';
  if (list.length) {
    html += list.map(p =>
      '<option value="' + String(p.id) + '">' + escapeHtml(String(p.name || ('#' + p.id))) + '</option>'
    ).join('');
  }
  sel.innerHTML = html;

  const pref = prefer != null && prefer !== '' ? String(prefer) : '';
  if (pref && list.some(p => String(p.id) === pref)) {
    sel.value = pref;
  } else {
    sel.value = '';
  }

  const hid = document.getElementById('sg-publisher');
  const syncHid = () => {
    const c = list.find(p => String(p.id) === String(sel.value));
    if (hid) hid.value = c ? (c.name || '') : '';
  };
  syncHid();
  sel.onchange = syncHid;
}

window.fillPublishPublisherSelect = async function fillPublishPublisherSelect(preloaded) {
  const formModal = document.getElementById('submit-form-modal');
  let sel = (formModal && formModal.querySelector('#sg-publisher-id'))
    || document.getElementById('sg-publisher-id')
    || document.querySelector('select[name="publisher_id"]');
  if (!sel) {
    console.warn('[publishers] #sg-publisher-id не найден');
    return [];
  }

  const cur = sel.value || '';
  let pubs = Array.isArray(preloaded) && preloaded.length ? preloaded.slice() : null;

  if (!pubs) {
    try {
      pubs = await window.fetchMyPublishers(true);
    } catch (e) {
      console.error('[publishers] load failed', e);
      pubs = [];
      toast('Не удалось загрузить издательства: ' + (e.message || e));
    }
  }

  applyPublisherOptionsToSelect(sel, pubs, cur);

  if (cur && pubs.some(p => String(p.id) === String(cur))) sel.value = String(cur);

  const hid = document.getElementById('sg-publisher');
  if (hid) {
    const p = pubs.find(x => String(x.id) === String(sel.value));
    hid.value = p ? (p.name || '') : '';
  }

  return pubs;
}



async function openPublisherPage(id, slug) {
  $$('.view').forEach(v => v.classList.remove('active'));
  const view = $('#view-publisher');
  if (view) view.classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.remove('active'));
  try {
    const url = new URL(location.href);
    url.searchParams.set('view', 'publisher');
    if (id) url.searchParams.set('pub', String(id));
    history.pushState({}, '', url);
  } catch (e) {}
  const headTitle = $('#head-title');
  if (headTitle) headTitle.textContent = 'Издательство';
  const nameEl = $('#pub-page-name');
  const descEl = $('#pub-page-desc');
  const gamesEl = $('#pub-page-games');
  const memEl = $('#pub-page-members');
  const av = $('#pub-page-avatar');
  const ban = $('#pub-page-banner');
  const actionsEl = $('#pub-page-actions');
  const playersNum = $('#pub-players-num');
  const gamesCountEl = $('#pub-games-count');
  const membersCountEl = $('#pub-members-count');
  if (gamesEl) gamesEl.innerHTML = '<div class="loading">Загрузка...</div>';
  if (actionsEl) actionsEl.innerHTML = '';
  try {
    const q = id ? ('id=' + id) : ('slug=' + encodeURIComponent(slug || ''));
    const data = await fetchJSON(PUB_API + '?action=get&' + q);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const p = data.publisher;
    if (nameEl) nameEl.textContent = p.name || '';
    if (descEl) descEl.textContent = p.description || '';
    if (av) {
      if (p.avatar_url) {
        av.style.backgroundImage = 'url(' + JSON.stringify(p.avatar_url) + ')';
        av.textContent = '';
      } else {
        av.style.backgroundImage = '';
        av.style.background = '#ef5b2c';
        av.textContent = (p.name || '?')[0];
      }
    }
    if (ban) {
      if (p.banner_url) {
        ban.style.backgroundImage = 'url(' + JSON.stringify(p.banner_url) + ')';
        ban.classList.add('has-image');
      } else {
        ban.style.backgroundImage = '';
        ban.classList.remove('has-image');
      }
    }
    if (playersNum) playersNum.textContent = String(p.players_count || 0);
    const list = p.members || [];
    if (membersCountEl) membersCountEl.textContent = String(list.length);
    if (memEl) {
      const html = list.length ? list.map(m => {
        const avStyle = m.avatar_url
          ? ('background-image:url(' + JSON.stringify(m.avatar_url) + ')')
          : ('background:' + (m.avatar_color || '#ef5b2c'));
        const letter = m.avatar_url ? '' : escapeHtml((m.username || '?').slice(0, 1).toUpperCase());
        const role = m.role === 'owner' ? 'владелец' : 'участник';
        return '<div class="hp-friend-row pub-member-row" data-username="' + escapeHtml(m.username) + '" data-id="' + m.id + '" role="button" tabindex="0">' +
          '<div class="hp-friend-avatar" style="' + avStyle + '">' + letter + '</div>' +
          '<div class="hp-friend-text">' +
            '<div class="hp-friend-name">' + escapeHtml(m.username) + '</div>' +
            '<div class="hp-friend-status">' + role + '</div>' +
          '</div></div>';
      }).join('') : '<div class="settings-hint" style="padding:8px 6px">Нет участников</div>';
      // через setAccordionHTML — сохраняем .acc-inner для корректного схлопывания
      if (typeof setAccordionHTML === 'function') setAccordionHTML(memEl, html);
      else memEl.innerHTML = html;
      $$('.pub-member-row', memEl).forEach(r => {
        r.addEventListener('click', () => openUserProfile(r.dataset.username, r.dataset.id));
      });
    }
    // accordion toggle for members — один обработчик, как в профиле
    const memCard = $('#pub-members-card');
    if (memCard && !memCard.dataset.toggleBound) {
      memCard.dataset.toggleBound = '1';
      const body = memCard.querySelector('.hp-side-body');
      const toggleBtn = memCard.querySelector('.hp-side-toggle');
      if (body) ensureAccordionInner(body);
      const onToggle = (e) => {
        if (e) e.stopPropagation();
        if (!body) return;
        const collapsed = animateAccordion(memCard, body, 'is-collapsed');
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      };
      // клик по шапке (включая стрелку) — один раз
      const head = memCard.querySelector('.hp-side-head');
      if (head) head.addEventListener('click', onToggle);
    }
    if (p.name && headTitle) headTitle.textContent = p.name;
    const games = p.games || [];
    if (gamesCountEl) gamesCountEl.textContent = String(games.length);
    const gamesSectionHead = document.querySelector('#view-publisher .hp-section-head');
    if (gamesEl) {
      gamesEl.classList.remove('store-grid');
      gamesEl.classList.add('hp-games-grid');
      if (!games.length) {
        if (gamesSectionHead) gamesSectionHead.style.display = 'none';
        gamesEl.classList.add('is-empty');
        gamesEl.innerHTML = `<div class="hp-empty hp-empty-centered">
          <div class="hp-empty-logo" aria-hidden="true">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
          </div>
          <div class="hp-empty-text">Пока нет опубликованных игр</div>
        </div>`;
      } else {
        if (gamesSectionHead) gamesSectionHead.style.display = '';
        gamesEl.classList.remove('is-empty');
        const byId = {};
        games.forEach(g => { byId[String(g.id)] = g; });
        gamesEl.innerHTML = games.map(g => publisherGameCardHtml(g)).join('');
        $$('.hp-game-card', gamesEl).forEach(c => {
          const g = byId[String(c.dataset.id)];
          c.addEventListener('click', (e) => {
            if (e.target.closest('.game-item__plus-wrapper') || e.target.closest('.hp-game-price')) return;
            gotoGame(+c.dataset.id);
          });
          const plus = c.querySelector('.game-item__plus-wrapper.is-add');
          if (plus && g) {
            plus.addEventListener('click', async (e) => {
              e.stopPropagation();
              e.preventDefault();
              if (plus.disabled) return;
              const price = formatPrice(g.price, g.discount_percent);
              plus.disabled = true;
              try {
                if (price.className === 'free' || g.purchased) {
                  const data = await postJSON(API_BASE + '?action=buy', { game_id: g.id });
                  if (!data.ok) throw new Error(data.error || 'Не удалось оформить');
                  if (data.balance !== undefined && typeof updateBalance === 'function') updateBalance(data.balance);
                  g.owned = true;
                  markStoreRowOwned(plus);
                  const priceEl = c.querySelector('.hp-game-price');
                  if (priceEl) priceEl.remove();
                  try { if (typeof sideLibAddOptimistic === 'function') sideLibAddOptimistic(g); } catch (err) {}
                  toast(data.message || ('«' + (g.title || 'Игра') + '» добавлена в библиотеку'));
                } else {
                  const ok = typeof addToCart === 'function' && addToCart(g);
                  if (ok) {
                    plus.remove();
                    if (typeof showAddToCartModal === 'function') showAddToCartModal(g);
                    else toast('Добавлено в корзину');
                  } else {
                    plus.disabled = false;
                  }
                }
              } catch (err) {
                plus.disabled = false;
                toast(err.message || 'Ошибка');
              }
            });
          }
        });
      }
    }
    // кнопки в toolbar
    if (actionsEl) {
      const isOwner = !!p.is_owner;
      const isSub = !!p.is_subscribed;
      if (isOwner) {
        actionsEl.innerHTML = `
          <button type="button" class="hp-btn-edit hp-btn-icon" id="pub-btn-edit" title="Редактировать" aria-label="Редактировать">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button type="button" class="hp-btn-logout hp-btn-danger" id="pub-btn-delete" title="Удалить издательство">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Удалить
          </button>`;
        $('#pub-btn-edit')?.addEventListener('click', () => {
          toast('Редактирование издательства — скоро');
        });
        $('#pub-btn-delete')?.addEventListener('click', async () => {
          if (!confirm('Удалить издательство «' + (p.name || '') + '»? Игры останутся, но без привязки.')) return;
          try {
            const res = await postJSON(PUB_API + '?action=delete', {
              csrf_token: window.CSRF_TOKEN || '',
              publisher_id: p.id
            });
            if (!res.ok) throw new Error(res.error || 'Ошибка');
            toast('Издательство удалено');
            showView('home');
          } catch (err) {
            toast(err.message || 'Не удалось удалить');
          }
        });
      } else {
        const starSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l2.2 6.6H21l-5.4 4 2.1 6.6L12 15.8 6.3 19.2l2.1-6.6L3 8.6h6.8L12 2z"/></svg>';
        actionsEl.innerHTML = `
          <button type="button" class="hp-btn-subscribe${isSub ? ' is-subscribed' : ''}" id="pub-btn-sub" data-sub="${isSub ? '1' : '0'}">
            ${starSvg}
            <span>${isSub ? 'Вы подписаны' : 'Подписаться'}</span>
          </button>`;
        const btn = $('#pub-btn-sub');
        btn?.addEventListener('click', async () => {
          const nowSub = btn.dataset.sub === '1';
          btn.disabled = true;
          try {
            const act = nowSub ? 'unsubscribe' : 'subscribe';
            const res = await postJSON(PUB_API + '?action=' + act, {
              csrf_token: window.CSRF_TOKEN || '',
              publisher_id: p.id
            });
            if (!res.ok) throw new Error(res.error || 'Ошибка');
            const sub = !!res.subscribed;
            btn.dataset.sub = sub ? '1' : '0';
            btn.classList.toggle('is-subscribed', sub);
            const span = btn.querySelector('span');
            if (span) span.textContent = sub ? 'Вы подписаны' : 'Подписаться';
            toast(sub ? 'Подписка оформлена — скидки этого издательства будут в уведомлениях' : 'Подписка отменена');
          } catch (err) {
            toast(err.message || 'Ошибка');
          } finally {
            btn.disabled = false;
          }
        });
      }
    }
  } catch (e) {
    if (gamesEl) gamesEl.innerHTML = `<div class="friends-empty">${escapeHtml(e.message)}</div>`;
  }
}
window.openPublisherPage = openPublisherPage;

// ===== Издательство в профиле =====
window.__pubLineToken = 0;



  try { initSubmitGame(); } catch (e) { console.error('initSubmitGame', e); }
  try { initCreateMenu(); } catch (e) { console.error('initCreateMenu', e); }
  try {
    // клики по серверному рендеру строки издательства
    bindPublisherLineClicks(document.getElementById('hp-publisher-line'));
    const me = window.AUTH_STATE && window.AUTH_STATE.user;
    const view = (typeof getViewFromUrl === 'function') ? getViewFromUrl() : 'home';
    if (me && me.id) {
      // всегда синхронизируем строку для своего профиля (даже если уже есть PHP-рендер)
      if (!viewingUserId) {
        loadProfilePublishers(me.id);
      }
      window.fetchMyPublishers(true).catch(() => {});
    }
  } catch (e) {}

  const safe = (name, fn) => { try { fn(); } catch (e) { console.error(name, e); } };
  safe('initWebNav', initWebNav);
  safe('initClientNav', initClientNav);
  safe('initAvatarMenu', initAvatarMenu);
  safe('initCartUI', initCartUI);
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


document.addEventListener('click', (e) => {
  const adm = e.target.closest && e.target.closest('#btn-admin');
  if (adm) {
    e.preventDefault();
    if (typeof showView === 'function') showView('admin');
    else if (typeof setView === 'function') setView('admin');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  try { refreshAdminPendingBadge(); } catch (e) {}
  setInterval(() => { try { refreshAdminPendingBadge(); } catch (e) {} }, 45000);
});

/* Preload publishers on boot */
document.addEventListener('DOMContentLoaded', () => {
  try {
    if (window.AUTH_STATE && window.AUTH_STATE.authorized && typeof fetchMyPublishers === 'function') {
      window.fetchMyPublishers(true).then(list => {
        console.log('[publishers] preloaded', (list || []).length);
      }).catch(e => console.warn('[publishers] preload', e));
    }
  } catch (e) {}
});

document.addEventListener('DOMContentLoaded', () => {
  try { initPubFormTabs(); initPubMediaTabs(); initBuildsUi(); bindPublishValidationWatchers(); updatePublishSectionStatus(); } catch (e) {}
});


/* ===== simple publish modal (no side tabs) ===== */
window.switchPubTab = function(){ /* no tabs in restored modal */ };
window.forcePublishModalLayout = function(){};
window.initPubFormTabs = function(){};
function initPubFormTabs(){}



/* ============================================================
   МАСТЕРСКАЯ (Workshop)
   ============================================================ */
const WS_API = 'api/workshop.php';
window.__wsTab = 'games';
window.__wsFilters = {};
window.__wsgId = 0;
window.__wsgTab = 'mods';

function wsFormatNum(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'b';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'm';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}
function wsFormatBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
function wsFormatDate(s) {
  if (!s) return '—';
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return String(s).slice(0, 10);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) { return '—'; }
}

function wsSideCard(title, bodyHtml) {
  return `<div class="hp-side-card">
    <div class="hp-side-head">
      <span>${title}</span>
      <button type="button" class="hp-side-toggle" aria-label="Свернуть" aria-expanded="true">
        <span class="hp-side-arrow" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg>
        </span>
      </button>
    </div>
    <div class="hp-side-body">${bodyHtml}</div>
  </div>`;
}

function bindWsSideToggles(root) {
  const scope = root || document;
  scope.querySelectorAll('.ws-side .hp-side-toggle').forEach(btn => {
    if (btn.dataset.wsBound) return;
    btn.dataset.wsBound = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const card = btn.closest('.hp-side-card');
      if (!card) return;
      const body = card.querySelector('.hp-side-body');
      if (body && typeof animateAccordion === 'function') {
        const collapsed = animateAccordion(card, body, 'is-collapsed');
        btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      } else {
        const collapsed = card.classList.toggle('is-collapsed');
        btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      }
    });
  });
}

async function loadWorkshopStats() {
  try {
    const data = await fetchJSON(WS_API + '?action=stats');
    if (!data || !data.ok) return;
    const s = data.stats || {};
    const el = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = wsFormatNum(v); };
    el('ws-stat-views', s.views != null ? s.views : s.downloads);
    el('ws-stat-mods', s.mods);
    el('ws-stat-users', s.users);
    const bg = document.getElementById('ws-hero-bg');
    if (bg && data.banner) {
      const url = data.banner.banner_url || data.banner.cover_url || '';
      if (url) {
        bg.style.backgroundImage = "url('" + String(url).replace(/'/g, '%27') + "')";
        bg.classList.add('has-image');
      }
    }
    window.__wsStats = s;
    updateWorkshopSub();
  } catch (e) {
    console.warn('[workshop] stats', e);
  }
}

function updateWorkshopSub() {
  const sub = document.getElementById('ws-sub');
  if (!sub) return;
  const tab = window.__wsTab || 'games';
  const s = window.__wsStats || {};
  let text = '';
  let hide = false;
  if (tab === 'games') {
    const n = window.__wsGamesTotal != null ? window.__wsGamesTotal : (s.games || 0);
    hide = !n;
    text = n ? ('Выберите из ' + n + ' игр для модификации') : '';
  } else if (tab === 'mods') {
    const n = s.mods || 0;
    hide = !n && !window.__wsHasListContent;
    text = n ? 'Изучите лучшие модификации в интернете' : '';
  } else if (tab === 'media') {
    const n = s.media || 0;
    hide = !n && !window.__wsHasListContent;
    text = n ? 'Лучшая галерея в интернете' : '';
  } else if (tab === 'assets') {
    hide = !window.__wsHasListContent;
    text = 'Гайды, механики, паки и всё связанное с играми';
  } else {
    text = '';
  }
  sub.textContent = text;
  sub.classList.toggle('is-hidden', hide || !text);
}

function wsEmptyHtml(text) {
  return `<div class="hp-empty hp-empty-centered">
    <div class="hp-empty-logo" aria-hidden="true">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
    </div>
    <div class="hp-empty-text">${escapeHtml(text)}</div>
  </div>`;
}

function wsFilterField(label, html) {
  return `<label class="ws-ff"><span>${label}</span>${html}</label>`;
}

function renderWorkshopSide(tab) {
  const side = document.getElementById('ws-filters-body') || document.getElementById('ws-side');
  if (!side) return;
  const f = window.__wsFilters || {};
  if (tab === 'games') {
    side.innerHTML =
      wsFilterField('Поиск', `<div class="search-field"><svg class="search-field-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><input type="text" class="auth-input" id="ws-f-game-q" placeholder="Название игры" value="${escapeHtml(f.q || '')}" /></div>`) +
      wsFilterField('Жанр', `<div class="ws-chip-list" id="ws-genre-list"><span class="settings-hint">Загрузка…</span></div>`);
    loadWorkshopGenres();
    const inp = document.getElementById('ws-f-game-q');
    if (inp) {
      let t;
      inp.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          window.__wsFilters = { ...(window.__wsFilters || {}), q: inp.value.trim() };
          loadWorkshopList();
        }, 280);
      });
    }
  } else if (tab === 'mods') {
    side.innerHTML =
      wsFilterField('Игра', `<input type="text" class="auth-input" id="ws-f-mod-game" placeholder="Название игры" value="${escapeHtml(f.game || '')}" />`) +
      wsFilterField('Поиск', `<div class="search-field"><svg class="search-field-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><input type="text" class="auth-input" id="ws-f-mod-q" placeholder="Поиск…" value="${escapeHtml(f.q || '')}" /></div>`) +
      wsFilterField('Искать в', `<select class="settings-select" id="ws-f-mod-param" style="width:100%">
          <option value="" ${!f.param ? 'selected' : ''}>Везде</option>
          <option value="title" ${f.param === 'title' ? 'selected' : ''}>Название</option>
          <option value="description" ${f.param === 'description' ? 'selected' : ''}>Описание</option>
          <option value="author" ${f.param === 'author' ? 'selected' : ''}>Автор</option>
        </select>`) +
      wsFilterField('Теги', `<div class="ws-chip-list" id="ws-tag-list"><span class="settings-hint">Загрузка…</span></div>`) +
      wsFilterField('Язык', `<div class="ws-chip-list" id="ws-lang-list">
        ${['ru','en','de','fr','es','zh','ja','ko'].map(l =>
          `<button type="button" class="ws-chip ${f.lang === l ? 'active' : ''}" data-ws-lang="${l}">${l.toUpperCase()}</button>`
        ).join('')}
      </div>`) +
      wsFilterField('Размер файла (МБ)', `<div class="ws-range-row">
        <input type="number" class="auth-input" id="ws-f-size-min" min="0" placeholder="Мин" value="${f.size_min_mb || ''}" />
        <input type="number" class="auth-input" id="ws-f-size-max" min="0" placeholder="Макс" value="${f.size_max_mb || ''}" />
      </div>`) +
      wsFilterField('Скачивания', `<div class="ws-range-row">
        <input type="number" class="auth-input" id="ws-f-dl-min" min="0" placeholder="Мин" value="${f.dl_min || ''}" />
        <input type="number" class="auth-input" id="ws-f-dl-max" min="0" placeholder="Макс" value="${f.dl_max || ''}" />
      </div>`) +
      wsFilterField('Лайки', `<div class="ws-range-row">
        <input type="number" class="auth-input" id="ws-f-like-min" min="0" placeholder="Мин" value="${f.like_min || ''}" />
        <input type="number" class="auth-input" id="ws-f-like-max" min="0" placeholder="Макс" value="${f.like_max || ''}" />
      </div>`);
    loadWorkshopTags();
    const setFilter = (key, val) => {
      window.__wsFilters = { ...(window.__wsFilters || {}), [key]: val };
      loadWorkshopList();
    };
    const bindText = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      let t;
      el.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => setFilter(key, el.value.trim()), 280);
      });
      el.addEventListener('change', () => setFilter(key, el.value.trim()));
    };
    bindText('ws-f-mod-game', 'game');
    bindText('ws-f-mod-q', 'q');
    const param = document.getElementById('ws-f-mod-param');
    if (param) param.addEventListener('change', () => setFilter('param', param.value));
    const bindNum = (id, key, storeMbKey) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => {
        const raw = el.value.trim();
        const next = { ...(window.__wsFilters || {}) };
        if (storeMbKey) next[storeMbKey] = raw;
        next[key] = raw ? String(Math.round(parseFloat(raw) * (storeMbKey ? 1048576 : 1))) : '';
        window.__wsFilters = next;
        loadWorkshopList();
      });
    };
    bindNum('ws-f-size-min', 'size_min', 'size_min_mb');
    bindNum('ws-f-size-max', 'size_max', 'size_max_mb');
    bindNum('ws-f-dl-min', 'dl_min');
    bindNum('ws-f-dl-max', 'dl_max');
    bindNum('ws-f-like-min', 'like_min');
    bindNum('ws-f-like-max', 'like_max');
    document.getElementById('ws-lang-list')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ws-lang]');
      if (!b) return;
      const lang = b.getAttribute('data-ws-lang');
      const cur = (window.__wsFilters || {}).lang;
      window.__wsFilters = { ...(window.__wsFilters || {}), lang: cur === lang ? '' : lang };
      renderWorkshopSide('mods');
      loadWorkshopList();
    });
  } else {
    side.innerHTML = wsFilterField('Игра', `<input type="text" class="auth-input" id="ws-f-media-game" placeholder="Название игры" value="${escapeHtml(f.game || '')}" />`);
    const inp = document.getElementById('ws-f-media-game');
    if (inp) {
      let t;
      inp.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          window.__wsFilters = { ...(window.__wsFilters || {}), game: inp.value.trim() };
          loadWorkshopList();
        }, 280);
      });
    }
  }
}

async function loadWorkshopGenres() {
  const box = document.getElementById('ws-genre-list');
  if (!box) return;
  try {
    const data = await fetchJSON(WS_API + '?action=genres');
    const list = (data && data.genres) || [];
    if (!list.length) {
      box.innerHTML = `<span class="settings-hint" style="display:inline-flex;align-items:center;gap:8px">
        <span class="hp-empty-logo" style="opacity:0.45;display:inline-flex" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></span>
        <span>Жанров пока нет</span>
      </span>`;
      return;
    }
    const cur = (window.__wsFilters || {}).genre || '';
    box.innerHTML = list.map(g =>
      `<button type="button" class="ws-chip ${cur === g.name ? 'active' : ''}" data-ws-genre="${escapeHtml(g.name)}">${escapeHtml(g.name)} <small>${g.count}</small></button>`
    ).join('');
    box.onclick = (e) => {
      const b = e.target.closest('[data-ws-genre]');
      if (!b) return;
      const name = b.getAttribute('data-ws-genre');
      const prev = (window.__wsFilters || {}).genre;
      window.__wsFilters = { ...(window.__wsFilters || {}), genre: prev === name ? '' : name };
      loadWorkshopGenres();
      loadWorkshopList();
    };
  } catch (e) {
    box.innerHTML = '<span class="settings-hint">Ошибка загрузки</span>';
  }
}

async function loadWorkshopTags() {
  const box = document.getElementById('ws-tag-list');
  if (!box) return;
  try {
    const data = await fetchJSON(WS_API + '?action=tags');
    const list = (data && data.tags) || [];
    if (!list.length) {
      box.innerHTML = '<span class="settings-hint">Тегов пока нет</span>';
      return;
    }
    const cur = (window.__wsFilters || {}).tag || '';
    box.innerHTML = list.slice(0, 30).map(t =>
      `<button type="button" class="ws-chip ${cur === t.name ? 'active' : ''}" data-ws-tag="${escapeHtml(t.name)}">${escapeHtml(t.name)}</button>`
    ).join('');
    box.onclick = (e) => {
      const b = e.target.closest('[data-ws-tag]');
      if (!b) return;
      const name = b.getAttribute('data-ws-tag');
      const prev = (window.__wsFilters || {}).tag;
      window.__wsFilters = { ...(window.__wsFilters || {}), tag: prev === name ? '' : name };
      loadWorkshopTags();
      loadWorkshopList();
    };
  } catch (e) {
    box.innerHTML = '<span class="settings-hint">Ошибка</span>';
  }
}


// ---------- Workshop list cache + async views ----------
window.__wsListCache = window.__wsListCache || Object.create(null);
window.__wsgListCache = window.__wsgListCache || Object.create(null);
window.__wsViewsLocal = window.__wsViewsLocal || Object.create(null);
window.__wsViewedSession = window.__wsViewedSession || Object.create(null);

function wsCacheKey(prefix, tab, extra) {
  try { return prefix + ':' + tab + ':' + JSON.stringify(extra || {}); }
  catch (e) { return prefix + ':' + tab + ':' + String(Date.now()); }
}

function wsGetCachedViews(type, id, fallback) {
  const k = type + ':' + id;
  if (window.__wsViewsLocal[k] != null) return window.__wsViewsLocal[k];
  return fallback != null ? (+fallback || 0) : 0;
}

function wsBumpViewsLocal(type, id, absolute) {
  const k = type + ':' + id;
  const prevLocal = window.__wsViewsLocal[k];
  let v;
  if (absolute != null) v = Math.max(0, +absolute || 0);
  else v = (prevLocal != null ? prevLocal : 0) + 1;
  const firstOpen = !window.__wsViewedSession[k];
  if (firstOpen) window.__wsViewedSession[k] = 1;
  window.__wsViewsLocal[k] = v;
  const sel = type === 'mod' ? '[data-mod-id="' + id + '"]'
    : (type === 'media' ? '[data-media-id="' + id + '"]' : '[data-asset-id="' + id + '"]');
  document.querySelectorAll(sel).forEach(card => {
    const el = card.querySelector('[data-ws-views]');
    if (el) el.textContent = '👁 ' + wsFormatNum(v);
    card.setAttribute('data-views', String(v));
  });
  if (firstOpen) {
    const hero = document.getElementById('ws-stat-views');
    if (hero) {
      const cur = parseInt(String(hero.textContent || '0').replace(/\D/g, ''), 10) || 0;
      hero.textContent = wsFormatNum(cur + 1);
      if (window.__wsStats) window.__wsStats.views = (window.__wsStats.views || cur) + 1;
    }
  }
  const patchList = (list) => {
    if (!Array.isArray(list)) return;
    const item = list.find(x => +x.id === +id);
    if (item) item.views = v;
  };
  Object.keys(window.__wsListCache || {}).forEach(key => {
    const bag = window.__wsListCache[key];
    if (!bag || !bag.list) return;
    if (key.indexOf(':mods:') >= 0 && type === 'mod') patchList(bag.list);
    if (key.indexOf(':media:') >= 0 && type === 'media') patchList(bag.list);
    if (key.indexOf(':assets:') >= 0 && type === 'asset') patchList(bag.list);
  });
  Object.keys(window.__wsgListCache || {}).forEach(key => {
    const bag = window.__wsgListCache[key];
    if (!bag || !bag.list) return;
    if (key.indexOf(':mods:') >= 0 && type === 'mod') patchList(bag.list);
    if (key.indexOf(':media:') >= 0 && type === 'media') patchList(bag.list);
    if (key.indexOf(':assets:') >= 0 && type === 'asset') patchList(bag.list);
  });
  return v;
}

function wsFixGridLayout(grid, tab) {
  if (!grid) return;
  grid.classList.toggle('is-mods', tab === 'mods' || tab === 'assets');
  grid.classList.toggle('is-media', tab === 'media');
  grid.classList.toggle('is-assets', tab === 'assets');
  document.querySelectorAll('#view-workshop .ws-body, #view-workshop-game .ws-body').forEach(b => {
    b.classList.add('ws-body--full');
  });
  void grid.offsetWidth;
  requestAnimationFrame(function () {
    grid.classList.toggle('is-mods', tab === 'mods' || tab === 'assets');
    grid.classList.toggle('is-media', tab === 'media');
    grid.classList.toggle('is-assets', tab === 'assets');
    void grid.offsetWidth;
  });
}

function wsApplyListToGrid(grid, tab, list, opts) {
  opts = opts || {};
  wsFixGridLayout(grid, tab);
  grid.classList.remove('is-empty');
  if (!list || !list.length) {
    grid.classList.add('is-empty');
    grid.innerHTML = wsEmptyHtml(opts.empty || 'Пусто');
    return;
  }
  if (tab === 'games') {
    grid.innerHTML = renderWorkshopGames(list);
    grid.querySelectorAll('[data-ws-game-id]').forEach(card => {
      card.addEventListener('click', function () {
        openWorkshopGame(card.getAttribute('data-ws-game-id'));
      });
    });
  } else if (tab === 'mods') {
    grid.innerHTML = renderWorkshopMods(list);
  } else if (tab === 'media') {
    grid.innerHTML = renderWorkshopMedia(list);
  } else if (tab === 'assets') {
    grid.innerHTML = renderWorkshopAssets(list);
  }
  wsFixGridLayout(grid, tab);
}

function renderWorkshopGames(list) {
  if (!list.length) return '<div class="ws-empty">Игр в мастерской пока нет</div>';
  return list.map(g => {
    const cover = g.cover_url || g.banner_url || '';
    const mods = g.mods_count != null ? g.mods_count : 0;
    const modsLabel = mods + ' мод' + (mods === 1 ? '' : (mods >= 2 && mods <= 4 ? 'а' : 'ов'));
    return `<button type="button" class="ws-game-card" data-ws-game-id="${g.id}">
      ${cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" />` : ''}
      <div class="ws-game-shade"></div>
      <div class="ws-game-info">
        <div class="ws-game-title">${escapeHtml(g.title || '')}</div>
        <div class="ws-game-meta">${modsLabel}</div>
      </div>
    </button>`;
  }).join('');
}

function wsGameBadge(m) {
  const icon = m.game_icon || m.game_cover || '';
  const title = m.game_title || '';
  if (!icon && !title) return '';
  const style = icon ? `background-image:url('${String(icon).replace(/'/g, '%27')}')` : '';
  const letter = title ? escapeHtml(title.slice(0, 1).toUpperCase()) : '';
  return `<span class="ws-game-badge" title="${escapeHtml(title)}" style="${style}">${icon ? '' : letter}</span>`;
}

function renderWorkshopMods(list) {
  if (!list.length) return '<div class="ws-empty">Модов пока нет — скоро появятся</div>';
  return list.map(m => {
    const cover = m.cover_url || m.banner_url || m.game_cover || '';
    return `<article class="ws-mod-card" data-mod-id="${m.id}">
      <div class="ws-card-cover" style="${cover ? "background-image:url('" + String(cover).replace(/'/g, '%27') + "')" : ''}"></div>
      <div class="ws-card-shade"></div>
      ${wsGameBadge(m)}
      <div class="ws-card-info">
        <div class="ws-card-title">${escapeHtml(m.title || '')}</div>
        <div class="ws-card-sub">${escapeHtml(m.author_name || 'Автор')}</div>
        <div class="ws-card-stats">
          <span data-ws-views>👁 ${wsFormatNum(wsGetCachedViews('mod', m.id, m.views))}</span>
          <span>♥ ${wsFormatNum(m.likes)}</span>
          <span>${wsFormatBytes(m.file_size)}</span>
        </div>
      </div>
    </article>`;
  }).join('');
}

function renderWorkshopMedia(list) {
  if (!list.length) return '<div class="ws-empty">Медиа пока нет</div>';
  return list.map(m => {
    const img = m.image_url || '';
    return `<article class="ws-media-card" data-media-id="${m.id}">
      <div class="ws-card-cover" style="${img ? "background-image:url('" + String(img).replace(/'/g, '%27') + "')" : ''}"></div>
      <div class="ws-card-shade"></div>
      ${wsGameBadge(m)}
      <div class="ws-card-info">
        <div class="ws-card-title">${escapeHtml(m.title || 'Скриншот')}</div>
        <div class="ws-card-sub">${escapeHtml(m.author_name || 'Автор')}</div>
        <div class="ws-card-stats">
          <span>♥ ${wsFormatNum(m.likes)}</span>
          <span data-ws-views>👁 ${wsFormatNum(wsGetCachedViews('media', m.id, m.views))}</span>
        </div>
      </div>
    </article>`;
  }).join('');
}

function renderWorkshopAssets(list) {
  if (!list.length) return '<div class="ws-empty">Ассетов пока нет</div>';
  return list.map(m => {
    const cover = m.cover_url || m.banner_url || m.game_cover || '';
    return `<article class="ws-mod-card" data-asset-id="${m.id}">
      <div class="ws-card-cover" style="${cover ? "background-image:url('" + String(cover).replace(/'/g, '%27') + "')" : ''}"></div>
      <div class="ws-card-shade"></div>
      ${wsGameBadge(m)}
      <div class="ws-card-info">
        <div class="ws-card-title">${escapeHtml(m.title || '')}</div>
        <div class="ws-card-sub">${escapeHtml(m.author_name || 'Автор')}</div>
        <div class="ws-card-stats">
          <span data-ws-views>👁 ${wsFormatNum(wsGetCachedViews('asset', m.id, m.views))}</span>
          <span>♥ ${wsFormatNum(m.likes)}</span>
          <span>${m.file_size ? wsFormatBytes(m.file_size) : '—'}</span>
        </div>
      </div>
    </article>`;
  }).join('');
}

async function loadWorkshopList(opts) {
  opts = opts || {};
  const force = !!opts.force;
  const grid = document.getElementById('ws-grid');
  if (!grid) return;
  const tab = window.__wsTab || 'games';
  const f = window.__wsFilters || {};
  const key = wsCacheKey('ws', tab, f);

  const paint = (list, total) => {
    window.__wsHasListContent = !!(list && list.length);
    if (tab === 'games' && total != null) window.__wsGamesTotal = total;
    updateWorkshopSub();
    const emptyMsg = tab === 'games' ? 'Пока нет игр для модификации'
      : (tab === 'mods' ? 'Модов пока нет'
      : (tab === 'media' ? 'Медиа пока нет' : 'Ассетов пока нет — публикуйте гайды, механики, паки'));
    wsApplyListToGrid(grid, tab, list, { empty: emptyMsg });
  };

  const cached = window.__wsListCache[key];
  if (cached && cached.list && !force) {
    paint(cached.list, cached.total);
    if (!cached._refreshing && (Date.now() - (cached.ts || 0) > 15000)) {
      cached._refreshing = true;
      loadWorkshopList({ force: true, soft: true }).finally(() => { cached._refreshing = false; });
    }
    return;
  }

  if (!opts.soft) {
    wsFixGridLayout(grid, tab);
    grid.classList.remove('is-empty');
    grid.innerHTML = '<div class="loading">Загрузка…</div>';
    window.__wsHasListContent = false;
    updateWorkshopSub();
  }

  try {
    let list = [];
    let total = null;
    if (tab === 'games') {
      const params = new URLSearchParams({ action: 'games', limit: '48' });
      if (f.q) params.set('q', f.q);
      if (f.genre) params.set('genre', f.genre);
      const data = await fetchJSON(WS_API + '?' + params.toString());
      list = (data && data.games) || [];
      total = data.total != null ? data.total : list.length;
    } else if (tab === 'mods') {
      const params = new URLSearchParams({ action: 'mods', limit: '48' });
      ['q','game','tag','lang','param','size_min','size_max','dl_min','dl_max','like_min','like_max'].forEach(k => {
        if (f[k]) params.set(k, f[k]);
      });
      const data = await fetchJSON(WS_API + '?' + params.toString());
      list = (data && data.mods) || [];
      total = data.total != null ? data.total : list.length;
    } else if (tab === 'media') {
      const params = new URLSearchParams({ action: 'media', limit: '48' });
      if (f.game) params.set('game', f.game);
      const data = await fetchJSON(WS_API + '?' + params.toString());
      list = (data && data.media) || [];
      total = data.total != null ? data.total : list.length;
    } else if (tab === 'assets') {
      const params = new URLSearchParams({ action: 'assets', limit: '48' });
      if (f.q) params.set('q', f.q);
      if (f.game) params.set('game_id', f.game);
      if (f.tag) params.set('tag', f.tag);
      const data = await fetchJSON(WS_API + '?' + params.toString());
      list = (data && data.assets) || [];
      total = data.total != null ? data.total : list.length;
    }
    list.forEach(item => {
      if (!item || item.id == null) return;
      const type = tab === 'mods' ? 'mod' : (tab === 'media' ? 'media' : (tab === 'assets' ? 'asset' : null));
      if (!type) return;
      const local = window.__wsViewsLocal[type + ':' + item.id];
      if (local != null) item.views = Math.max(+item.views || 0, local);
    });
    window.__wsListCache[key] = { list: list, total: total, ts: Date.now() };
    paint(list, total);
  } catch (e) {
    if (!opts.soft) {
      grid.classList.add('is-empty');
      grid.innerHTML = wsEmptyHtml('Ошибка: ' + (e.message || 'неизвестно'));
      wsFixGridLayout(grid, tab);
    }
  }
}

async function openWorkshop() {
  window.__wsgId = 0;
  $$('.view').forEach(v => v.classList.remove('active'));
  const view = document.getElementById('view-workshop');
  if (view) view.classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-view') === 'workshop'));
  try {
    const url = new URL(location.href);
    url.searchParams.set('view', 'workshop');
    url.searchParams.delete('wsg');
    history.pushState({}, '', url);
  } catch (e) {}
  const head = document.getElementById('head-title');
  if (head) head.textContent = 'Мастерская';
  window.__wsTab = window.__wsTab || 'games';
  // не сбрасываем фильтры/кэш при каждом заходе — только если явно пустые
  if (!window.__wsFilters) window.__wsFilters = {};
  document.querySelectorAll('#ws-tabs .ws-tab-btn, #ws-tabs .hp-tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('data-ws-tab') === window.__wsTab);
  });
  // layout body
  const body = document.querySelector('#view-workshop .ws-body');
  if (body) body.classList.add('ws-body--full');
  await loadWorkshopStats();
  renderWorkshopSide(window.__wsTab);
  await loadWorkshopList();
}
window.openWorkshop = openWorkshop;

async function openWorkshopGame(id, tab) {
  id = parseInt(id, 10) || 0;
  if (!id) return;
  window.__wsgId = id;
  window.__wsgTab = (tab === 'media' || tab === 'mods' || tab === 'assets') ? tab : 'mods';
  $$('.view').forEach(v => v.classList.remove('active'));
  const view = document.getElementById('view-workshop-game');
  if (view) view.classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-view') === 'workshop'));
  try {
    const url = new URL(location.href);
    url.searchParams.set('view', 'workshop');
    url.searchParams.set('wsg', String(id));
    if (window.__wsgTab === 'media') url.searchParams.set('wsg_tab', 'media');
    else if (window.__wsgTab === 'assets') url.searchParams.set('wsg_tab', 'assets');
    else url.searchParams.delete('wsg_tab');
    history.pushState({}, '', url);
  } catch (e) {}
  const headTitle = document.getElementById('head-title');
  if (headTitle) headTitle.textContent = 'Мастерская';

  document.querySelectorAll('#wsg-tabs .ws-tab-btn, #wsg-tabs .hp-tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('data-wsg-tab') === window.__wsgTab);
  });

  try {
    const data = await fetchJSON(WS_API + '?action=game&id=' + id);
    if (!data || !data.ok || !data.game) throw new Error((data && data.error) || 'Не найдено');
    const g = data.game;
    const cover = document.getElementById('wsg-cover');
    const title = document.getElementById('wsg-title');
    const desc = document.getElementById('wsg-desc');
    const meta = document.getElementById('wsg-meta');
    const bg = document.getElementById('wsg-hero-bg');
    const gameTitle = g.title || 'Игра';
    if (headTitle) headTitle.textContent = gameTitle;
    if (title) title.textContent = gameTitle;
    if (desc) desc.textContent = g.short_description || '';
    const imgUrl = g.banner_url || g.cover_url || '';
    if (cover) {
      const url = g.cover_url || g.banner_url || '';
      cover.style.backgroundImage = url ? "url('" + String(url).replace(/'/g, '%27') + "')" : '';
    }
    if (bg) {
      if (imgUrl) {
        bg.style.backgroundImage = "url('" + String(imgUrl).replace(/'/g, '%27') + "')";
        bg.classList.add('has-image');
      } else {
        bg.style.backgroundImage = '';
        bg.classList.remove('has-image');
      }
    }
    if (meta) {
      meta.innerHTML = `
        <span>${g.mods_count || 0} модов</span>
        <span>${g.media_count || 0} медиа</span>
        <span>${g.assets_count || 0} ассетов</span>
        ${g.genre ? '<span>' + escapeHtml(g.genre) + '</span>' : ''}
        ${g.developer_name || g.developer ? '<span>' + escapeHtml(g.developer_name || g.developer) + '</span>' : ''}`;
    }
  } catch (e) {
    toast(e.message || 'Ошибка загрузки');
    return openWorkshop();
  }

  // side filters for this game (mods/media of this game)
  renderWorkshopGameSide();
  await loadWorkshopGameList();
}
window.openWorkshopGame = openWorkshopGame;

function openWorkshopFiltersModal() {
  const modal = document.getElementById('ws-filters-modal');
  if (!modal) return;
  if (window.__wsgId) {
    renderWorkshopGameSide();
  } else {
    renderWorkshopSide(window.__wsTab || 'games');
  }
  modal.classList.remove('hidden');
}
function closeWorkshopFiltersModal() {
  const modal = document.getElementById('ws-filters-modal');
  if (modal) modal.classList.add('hidden');
}
window.openWorkshopFiltersModal = openWorkshopFiltersModal;

document.addEventListener('click', (e) => {
  const t = e.target;
  if (!t || !t.closest) return;
  if (t.closest('#ws-filters-btn') || t.closest('#wsg-filters-btn')) {
    e.preventDefault();
    openWorkshopFiltersModal();
    return;
  }
  if (t.closest('[data-close-ws-filters]')) {
    closeWorkshopFiltersModal();
    return;
  }
  if (t.closest('#ws-filters-apply')) {
    e.preventDefault();
    if (window.__wsgId) loadWorkshopGameList();
    else loadWorkshopList();
    closeWorkshopFiltersModal();
    return;
  }
  if (t.closest('#ws-filters-reset')) {
    e.preventDefault();
    if (window.__wsgId) {
      window.__wsgFilters = {};
      renderWorkshopGameSide();
      loadWorkshopGameList();
    } else {
      window.__wsFilters = {};
      renderWorkshopSide(window.__wsTab || 'games');
      loadWorkshopList();
    }
    return;
  }
});

function renderWorkshopGameSide() {
  const side = document.getElementById('ws-filters-body') || document.getElementById('wsg-side');
  if (!side) return;
  const tab = window.__wsgTab || 'mods';
  if (tab === 'mods') {
    side.innerHTML =
      wsFilterField('Поиск', `<div class="search-field"><svg class="search-field-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><input type="text" class="auth-input" id="wsg-f-q" placeholder="Название мода" /></div>`) +
      wsFilterField('Теги', `<div class="ws-chip-list" id="wsg-tag-list"><span class="settings-hint">Загрузка…</span></div>`);
    const inp = document.getElementById('wsg-f-q');
    if (inp) {
      let t;
      inp.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => loadWorkshopGameList(), 280);
      });
    }
    loadWorkshopTagsInto('wsg-tag-list', () => loadWorkshopGameList());
  } else if (tab === 'assets') {
    side.innerHTML =
      wsFilterField('Поиск', `<div class="search-field"><svg class="search-field-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><input type="text" class="auth-input" id="wsg-f-asset-q" placeholder="Название ассета" /></div>`);
    const inp = document.getElementById('wsg-f-asset-q');
    if (inp) {
      let t;
      inp.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => loadWorkshopGameList(), 280);
      });
    }
  } else {
    side.innerHTML = wsFilterField('Поиск', `<div class="search-field"><svg class="search-field-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><input type="text" class="auth-input" id="wsg-f-media-q" placeholder="Название" /></div>`);
    const inp = document.getElementById('wsg-f-media-q');
    if (inp) {
      let t;
      inp.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => loadWorkshopGameList(), 280);
      });
    }
  }
}

async function loadWorkshopTagsInto(boxId, onPick) {
  const box = document.getElementById(boxId);
  if (!box) return;
  try {
    const data = await fetchJSON(WS_API + '?action=tags');
    const list = (data && data.tags) || [];
    if (!list.length) {
      box.innerHTML = '<span class="settings-hint">Тегов пока нет</span>';
      return;
    }
    box.innerHTML = list.slice(0, 24).map(t =>
      `<button type="button" class="ws-chip" data-ws-tag="${escapeHtml(t.name)}">${escapeHtml(t.name)}</button>`
    ).join('');
    box.onclick = (e) => {
      const b = e.target.closest('[data-ws-tag]');
      if (!b) return;
      box.querySelectorAll('.ws-chip').forEach(x => x.classList.toggle('active', x === b ? !b.classList.contains('active') : false));
      if (typeof onPick === 'function') onPick();
    };
  } catch (e) {
    box.innerHTML = '<span class="settings-hint">Ошибка</span>';
  }
}

async function loadWorkshopGameList(opts) {
  opts = opts || {};
  const force = !!opts.force;
  const grid = document.getElementById('wsg-grid');
  const sub = document.getElementById('wsg-sub');
  if (!grid || !window.__wsgId) return;
  const tab = window.__wsgTab || 'mods';
  const gid = window.__wsgId;
  const qEl = document.getElementById(tab === 'mods' ? 'wsg-f-q' : (tab === 'assets' ? 'wsg-f-asset-q' : 'wsg-f-media-q'));
  const q = (qEl && qEl.value.trim()) || '';
  const tagBtn = document.querySelector('#wsg-tag-list .ws-chip.active');
  const tag = tagBtn ? (tagBtn.getAttribute('data-ws-tag') || '') : '';
  const key = wsCacheKey('wsg', tab, { gid: gid, q: q, tag: tag });

  const paint = (list) => {
    if (sub) {
      const label = tab === 'mods' ? 'Моды этой игры' : (tab === 'media' ? 'Медиа этой игры' : 'Ассеты этой игры');
      sub.textContent = list.length ? label : '';
      sub.classList.toggle('is-hidden', !list.length);
    }
    const empty = tab === 'mods' ? 'Модов для этой игры пока нет'
      : (tab === 'media' ? 'Медиа для этой игры пока нет' : 'Ассетов для этой игры пока нет');
    wsApplyListToGrid(grid, tab, list, { empty: empty });
  };

  const cached = window.__wsgListCache[key];
  if (cached && cached.list && !force) {
    paint(cached.list);
    if (!cached._refreshing && (Date.now() - (cached.ts || 0) > 15000)) {
      cached._refreshing = true;
      loadWorkshopGameList({ force: true, soft: true }).finally(() => { cached._refreshing = false; });
    }
    return;
  }

  if (!opts.soft) {
    wsFixGridLayout(grid, tab);
    grid.classList.remove('is-empty');
    grid.innerHTML = '<div class="loading">Загрузка…</div>';
  }

  try {
    let list = [];
    if (tab === 'mods') {
      const params = new URLSearchParams({ action: 'mods', game_id: String(gid), limit: '48' });
      if (q) params.set('q', q);
      if (tag) params.set('tag', tag);
      const data = await fetchJSON(WS_API + '?' + params.toString());
      list = (data && data.mods) || [];
    } else if (tab === 'assets') {
      const params = new URLSearchParams({ action: 'assets', game_id: String(gid), limit: '48' });
      if (q) params.set('q', q);
      const data = await fetchJSON(WS_API + '?' + params.toString());
      list = (data && data.assets) || [];
    } else {
      const params = new URLSearchParams({ action: 'media', game_id: String(gid), limit: '48' });
      const data = await fetchJSON(WS_API + '?' + params.toString());
      list = (data && data.media) || [];
    }
    list.forEach(item => {
      if (!item || item.id == null) return;
      const type = tab === 'mods' ? 'mod' : (tab === 'media' ? 'media' : 'asset');
      const local = window.__wsViewsLocal[type + ':' + item.id];
      if (local != null) item.views = Math.max(+item.views || 0, local);
    });
    window.__wsgListCache[key] = { list: list, ts: Date.now() };
    paint(list);
  } catch (e) {
    if (sub) sub.classList.add('is-hidden');
    if (!opts.soft) {
      grid.classList.add('is-empty');
      grid.innerHTML = wsEmptyHtml('Ошибка: ' + (e.message || ''));
      wsFixGridLayout(grid, tab);
    }
  }
}

document.addEventListener('click', (e) => {
  const nav = e.target && e.target.closest && e.target.closest('.nav-btn[data-view="workshop"]');
  if (nav) {
    e.preventDefault();
    openWorkshop();
    return;
  }
  const back = e.target && e.target.closest && e.target.closest('#wsg-back');
  if (back) {
    e.preventDefault();
    openWorkshop();
    return;
  }
  const tabBtn = e.target && e.target.closest && e.target.closest('#ws-tabs [data-ws-tab]');
  if (tabBtn) {
    const tab = tabBtn.getAttribute('data-ws-tab');
    window.__wsTab = tab;
    window.__wsFilters = {};
    document.querySelectorAll('#ws-tabs .ws-tab-btn, #ws-tabs .hp-tab').forEach(t => t.classList.toggle('active', t === tabBtn));
    renderWorkshopSide(tab);
    loadWorkshopList();
    return;
  }
  const gTab = e.target && e.target.closest && e.target.closest('#wsg-tabs [data-wsg-tab]');
  if (gTab) {
    window.__wsgTab = gTab.getAttribute('data-wsg-tab');
    document.querySelectorAll('#wsg-tabs .ws-tab-btn, #wsg-tabs .hp-tab').forEach(t => t.classList.toggle('active', t === gTab));
    renderWorkshopGameSide();
    loadWorkshopGameList();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('view') === 'workshop') {
      const wsg = parseInt(params.get('wsg') || '0', 10);
      const wsgTab = params.get('wsg_tab') || '';
      if (wsg) openWorkshopGame(wsg, wsgTab || undefined);
      else openWorkshop();
    }
  } catch (e) {}
});

// ========== Мастерская: создание и просмотр ==========
window.__wsMvImages = [];
window.__wsMvIdx = 0;
window.__wsMvId = 0;
window.__wsModvShots = [];
window.__wsModvIdx = 0;
window.__wsModvId = 0;
window.__wsModvFile = '';

function wsCloseModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('hidden');
}
function wsOpenModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('hidden');
}

async function wsFillGamesSelect(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">Загрузка…</option>';
  try {
    const data = await fetchJSON(WS_API + '?action=games&limit=200');
    const list = (data && data.games) || [];
    if (!list.length) {
      sel.innerHTML = '<option value="">Нет опубликованных игр</option>';
      return;
    }
    sel.innerHTML = '<option value="">Выберите игру</option>' +
      list.map(g => `<option value="${g.id}">${escapeHtml(g.title || ('#' + g.id))}</option>`).join('');
  } catch (e) {
    sel.innerHTML = '<option value="">Ошибка загрузки</option>';
  }
}

function openWorkshopCreateFlow() {
  // правила публикации (как у игр), затем выбор типа
  const rules = document.getElementById('submit-rules-modal');
  if (!rules) {
    wsOpenModal('ws-type-modal');
    return;
  }
  window.__wsAfterRules = true;
  const agree = document.getElementById('submit-agree');
  if (agree) agree.checked = false;
  const next = document.getElementById('submit-rules-next');
  if (next) next.disabled = true;
  rules.classList.remove('hidden');
}

// перехват «Далее» в правилах, если пришли из мастерской
(function bindWsRulesNext() {
  if (window.__wsRulesBound) return;
  window.__wsRulesBound = true;
  document.addEventListener('click', (e) => {
    const next = e.target && e.target.closest && e.target.closest('#submit-rules-next');
    if (!next) return;
    if (!window.__wsAfterRules) return;
    e.preventDefault();
    e.stopPropagation();
    window.__wsAfterRules = false;
    const rules = document.getElementById('submit-rules-modal');
    if (rules) rules.classList.add('hidden');
    wsOpenModal('ws-type-modal');
  }, true);
})();

document.addEventListener('click', (e) => {
  const t = e.target;
  if (!t || !t.closest) return;

  if (t.closest('#create-menu-workshop')) {
    e.preventDefault();
    e.stopPropagation();
    if (window.closeCreateMenu) window.closeCreateMenu();
    const authed = window.AUTH_STATE && window.AUTH_STATE.authorized;
    if (!authed && !(window.CURRENT_USER && window.CURRENT_USER.id)) {
      toast('Войдите, чтобы публиковать в мастерской');
      return;
    }
    openWorkshopCreateFlow();
    return;
  }

  if (t.closest('[data-close-ws-type]')) wsCloseModal('ws-type-modal');
  if (t.closest('[data-close-ws-media-form]')) wsCloseModal('ws-media-form-modal');
  if (t.closest('[data-close-ws-mod-form]')) wsCloseModal('ws-mod-form-modal');
  if (t.closest('[data-close-ws-asset-form]')) wsCloseModal('ws-asset-form-modal');
  if (t.closest('[data-close-ws-media-view]')) wsCloseModal('ws-media-view-modal');
  if (t.closest('[data-close-ws-mod-view]')) wsCloseModal('ws-mod-view-modal');
  if (t.closest('[data-close-ws-asset-view]')) wsCloseModal('ws-asset-view-modal');

  if (t.closest('#ws-type-media')) {
    e.preventDefault();
    wsCloseModal('ws-type-modal');
    const form = document.getElementById('ws-media-form');
    if (form) form.reset();
    wsFillGamesSelect('ws-media-game');
    wsOpenModal('ws-media-form-modal');
    return;
  }
  if (t.closest('#ws-type-mod')) {
    e.preventDefault();
    wsCloseModal('ws-type-modal');
    const form = document.getElementById('ws-mod-form');
    if (form) form.reset();
    wsFillGamesSelect('ws-mod-game');
    wsOpenModal('ws-mod-form-modal');
    return;
  }
  if (t.closest('#ws-type-asset')) {
    e.preventDefault();
    wsCloseModal('ws-type-modal');
    const form = document.getElementById('ws-asset-form');
    if (form) form.reset();
    const ed = document.getElementById('ws-asset-desc-editor');
    const ta = document.getElementById('ws-asset-desc');
    if (ed) ed.innerHTML = '';
    if (ta) ta.value = '';
    wsFillGamesSelect('ws-asset-game').then(() => {
      const sel = document.getElementById('ws-asset-game');
      if (sel && sel.options.length && sel.options[0].value === '') {
        sel.options[0].textContent = 'Без привязки к игре';
      }
    });
    if (typeof initWsAssetRte === 'function') initWsAssetRte();
    wsOpenModal('ws-asset-form-modal');
    return;
  }

  // клик по карточке медиа
  const mediaCard = t.closest('.ws-media-card[data-media-id]');
  if (mediaCard) {
    e.preventDefault();
    openWorkshopMediaView(mediaCard.getAttribute('data-media-id'));
    return;
  }
  // клик по карточке ассета
  const assetCard = t.closest('[data-asset-id]');
  if (assetCard) {
    e.preventDefault();
    openWorkshopAssetView(assetCard.getAttribute('data-asset-id'));
    return;
  }
  // клик по карточке мода
  const modCard = t.closest('.ws-mod-card[data-mod-id]');
  if (modCard) {
    e.preventDefault();
    openWorkshopModView(modCard.getAttribute('data-mod-id'));
    return;
  }


  if (t.closest('#ws-mv-like')) {
    e.preventDefault();
    wsToggleLike('media', window.__wsMvId, '#ws-mv-like');
    return;
  }
  if (t.closest('#ws-modv-like')) {
    e.preventDefault();
    wsToggleLike('mod', window.__wsModvId, '#ws-modv-like');
    return;
  }
  if (t.closest('#ws-assetv-like')) {
    e.preventDefault();
    wsToggleLike('asset', window.__wsAssetvId, '#ws-assetv-like');
    return;
  }
  if (t.closest('#ws-modv-install')) {
    handleModInstallClick();
    return;
  }
  const assetDl = t.closest('#ws-asset-view-modal .btn-download[data-asset-file], #ws-assetv-download');
  if (assetDl) {
    e.preventDefault();
    e.stopPropagation();
    const href = assetDl.getAttribute('data-asset-file') || window.__wsAssetvFile || '';
    if (href) {
      const a = document.createElement('a');
      a.href = href;
      a.download = '';
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      toast('Файл не прикреплён');
    }
    return;
  }
});

function bindWsFileHint(inputId, hintId, opts) {
  const input = document.getElementById(inputId);
  const hint = document.getElementById(hintId);
  if (!input || input.dataset.hintBound) return;
  input.dataset.hintBound = '1';
  input.addEventListener('change', () => {
    if (!hint) return;
    const files = input.files ? Array.from(input.files) : [];
    if (!files.length) {
      hint.textContent = opts.empty || 'Файл не выбран';
      return;
    }
    if (opts.maxFiles && files.length > opts.maxFiles) {
      hint.textContent = 'Максимум ' + opts.maxFiles + ' файлов';
      return;
    }
    const names = files.slice(0, 3).map(f => f.name).join(', ');
    const more = files.length > 3 ? ' +' + (files.length - 3) : '';
    hint.textContent = files.length + ' файл(ов): ' + names + more;
  });
}

document.addEventListener('click', async (e) => {
  if (e.target && e.target.closest && e.target.closest('#ws-media-submit')) {
    e.preventDefault();
    const form = document.getElementById('ws-media-form');
    if (!form) return;
    const title = (form.querySelector('[name="title"]')?.value || '').trim();
    const gameId = form.querySelector('[name="game_id"]')?.value || '';
    const desc = (form.querySelector('[name="description"]')?.value || '').trim();
    const filesInput = document.getElementById('ws-media-files');
    const files = filesInput && filesInput.files ? Array.from(filesInput.files) : [];
    if (title.length < 2) { toast('Название: минимум 2 символа'); return; }
    if (title.length > 80) { toast('Название: максимум 80 символов'); return; }
    if (!gameId) { toast('Выберите игру'); return; }
    if (desc.length > 400) { toast('Описание: максимум 400 символов'); return; }
    if (!files.length) { toast('Добавьте хотя бы одно изображение'); return; }
    if (files.length > 12) { toast('Максимум 12 изображений'); return; }
    for (const f of files) {
      if (f.size > 5 * 1024 * 1024) { toast('Файл «' + f.name + '» больше 5 МБ'); return; }
    }
    const fd = new FormData(form);
    fd.delete('images[]');
    files.forEach(f => fd.append('images[]', f));
    const btn = document.getElementById('ws-media-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Отправка…'; }
    try {
      const res = await fetch(WS_API + '?action=submit_media', { method: 'POST', body: fd, credentials: 'same-origin' });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text.replace(/^[^{[]*/, '')); } catch { throw new Error(text.slice(0, 200) || 'Ошибка сервера'); }
      if (!data.ok) throw new Error(data.error || 'Ошибка');
      toast('Медиа отправлено на модерацию');
      wsCloseModal('ws-media-form-modal');
      form.reset();
      const hint = document.getElementById('ws-media-files-hint');
      if (hint) hint.textContent = 'До 12 изображений, PNG/JPG/WebP, до 5 МБ каждое';
      try { if (typeof refreshAdminPendingBadge === 'function') refreshAdminPendingBadge(); } catch (e) {}
    } catch (err) {
      toast(err.message || 'Не удалось отправить');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Отправить на модерацию'; }
    }
    return;
  }

  if (e.target && e.target.closest && e.target.closest('#ws-mod-submit')) {
    e.preventDefault();
    const form = document.getElementById('ws-mod-form');
    if (!form) return;
    const title = (form.querySelector('[name="title"]')?.value || '').trim();
    const gameId = form.querySelector('[name="game_id"]')?.value || '';
    const shortD = (form.querySelector('[name="short_description"]')?.value || '').trim();
    const about = (form.querySelector('[name="about"]')?.value || '').trim();
    const desc = (form.querySelector('[name="description"]')?.value || '').trim();
    const install = (form.querySelector('[name="install_instructions"]')?.value || '').trim();
    const features = (form.querySelector('[name="features"]')?.value || '').trim();
    const deps = (form.querySelector('[name="dependencies"]')?.value || '').trim();
    const tags = (form.querySelector('[name="tags"]')?.value || '').trim();
    const modFile = document.getElementById('ws-mod-file');
    const shots = document.getElementById('ws-mod-shots');
    if (title.length < 2) { toast('Название: минимум 2 символа'); return; }
    if (title.length > 80) { toast('Название: максимум 80 символов'); return; }
    if (!gameId) { toast('Выберите игру'); return; }
    if (shortD.length > 120) { toast('Краткое описание: максимум 120'); return; }
    if (about.length > 600) { toast('«Об этом моде»: максимум 600'); return; }
    if (desc.length > 2000) { toast('Описание: максимум 2000'); return; }
    if (install.length > 1000) { toast('Инструкция: максимум 1000'); return; }
    if (features.length > 500) { toast('Характеристики: максимум 500'); return; }
    if (deps.length > 400) { toast('Зависимости: максимум 400'); return; }
    if (tags.split(',').filter(t => t.trim()).length > 8) { toast('Максимум 8 тегов'); return; }
    if (!modFile || !modFile.files || !modFile.files.length) { toast('Выберите файл мода'); return; }
    if (modFile.files[0].size > 500 * 1024 * 1024) { toast('Файл мода больше 500 МБ'); return; }
    if (shots && shots.files && shots.files.length > 10) { toast('Максимум 10 скриншотов'); return; }
    const fd = new FormData(form);
    const btn = document.getElementById('ws-mod-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Отправка…'; }
    try {
      const res = await fetch(WS_API + '?action=submit_mod', {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
        timeout: undefined
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text.replace(/^[^{[]*/, '')); } catch { throw new Error(text.slice(0, 200) || 'Ошибка сервера'); }
      if (!data.ok) throw new Error(data.error || 'Ошибка');
      toast('Мод отправлен на модерацию');
      wsCloseModal('ws-mod-form-modal');
      form.reset();
      try { if (typeof refreshAdminPendingBadge === 'function') refreshAdminPendingBadge(); } catch (e) {}
    } catch (err) {
      toast(err.message || 'Не удалось отправить');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Отправить на модерацию'; }
    }
  }
});

// counters + file hints for workshop forms
document.addEventListener('DOMContentLoaded', () => {
  ['ws-media-form', 'ws-mod-form'].forEach(id => {
    const form = document.getElementById(id);
    if (form) bindWsFormCounters(form);
  });
  bindWsFileHint('ws-media-files', 'ws-media-files-hint', { maxFiles: 12, empty: 'До 12 изображений, PNG/JPG/WebP, до 5 МБ каждое' });
  bindWsFileHint('ws-mod-cover', 'ws-mod-cover-hint', { empty: 'до 5 МБ' });
  bindWsFileHint('ws-mod-banner', 'ws-mod-banner-hint', { empty: 'до 5 МБ' });
  bindWsFileHint('ws-mod-shots', 'ws-mod-shots-hint', { maxFiles: 10, empty: 'До 10 шт., до 5 МБ' });
  bindWsFileHint('ws-mod-file', 'ws-mod-file-hint', { empty: 'ZIP / RAR / 7Z, до 500 МБ' });
});

/**
 * Выбор файла ВНЕ модалки (input на document.body).
 * WebView2 ломает compositing у fixed-модалок при native file dialog —
 * поэтому диалог открываем только с input, который не внутри .submit-modal.
 */
function assignFilesToInput(targetInput, fileList) {
  if (!targetInput) return;
  try {
    const dt = new DataTransfer();
    Array.from(fileList || []).forEach(f => dt.items.add(f));
    targetInput.files = dt.files;
  } catch (err) {
    console.warn('[file] DataTransfer assign failed', err);
  }
  // сборка игры — имя файла рядом с кнопкой
  if (targetInput.id === 'sg-build-file') {
    const f = (fileList && fileList[0]) || (targetInput.files && targetInput.files[0]) || null;
    if (f) window.__selectedBuildFile = f;
    if (typeof setBuildFileLabel === 'function') setBuildFileLabel(f);
    else {
      const nameEl = document.getElementById('sg-build-file-name');
      if (nameEl && f) {
        nameEl.textContent = f.name + ' · ' + (f.size / 1048576).toFixed(1) + ' МБ';
        nameEl.style.cssText = 'display:inline;opacity:1;visibility:visible;color:var(--text-bright)';
      }
    }
    try { if (typeof updatePublishSectionStatus === 'function') updatePublishSectionStatus(); } catch (e) {}
  }
  targetInput.dispatchEvent(new Event('change', { bubbles: true }));
  targetInput.dispatchEvent(new Event('input', { bubbles: true }));
}

function pickFilesOutsideModal(targetInput) {
  if (!targetInput) return;
  const tmp = document.createElement('input');
  tmp.type = 'file';
  tmp.multiple = !!targetInput.multiple;
  if (targetInput.accept) tmp.accept = targetInput.accept;
  // полностью вне любого stacking context модалки
  tmp.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;';
  document.body.appendChild(tmp);

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    try { tmp.remove(); } catch (e) {}
  };

  tmp.addEventListener('change', () => {
    assignFilesToInput(targetInput, tmp.files);
    cleanup();
  });
  tmp.addEventListener('cancel', () => {
    cleanup();
  });
  // если cancel не пришёл — убрать tmp при следующем фокусе окна
  const onFocus = () => {
    setTimeout(() => {
      if (!done && (!tmp.files || !tmp.files.length)) cleanup();
    }, 300);
    window.removeEventListener('focus', onFocus);
  };
  window.addEventListener('focus', onFocus);

  // открыть диалог синхронно в user gesture
  tmp.click();
}

function recoverModalsAfterFileDialog() {
  /* no-op: файлы больше не открываются изнутри модалки */
}

(function bindExternalFilePicker() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t) return;

    let targetInput = null;

    if (t.matches && t.matches('input[type="file"]')) {
      // только если input лежит внутри модалки — перехватываем
      if (t.closest('.submit-modal, .hp-modal, .modal')) {
        targetInput = t;
      }
    } else {
      const lab = t.closest && t.closest('label[for]');
      if (lab) {
        const el = document.getElementById(lab.getAttribute('for') || '');
        if (el && el.type === 'file' && el.closest('.submit-modal, .hp-modal, .modal')) {
          targetInput = el;
        }
      }
    }

    if (!targetInput) return;

    // блокируем штатный open из модалки
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    pickFilesOutsideModal(targetInput);
  }, true);
})();

function wsMvStep(dir) {
  const imgs = window.__wsMvImages || [];
  if (imgs.length < 2) return;
  window.__wsMvIdx = (window.__wsMvIdx + dir + imgs.length) % imgs.length;
  const img = document.getElementById('ws-mv-img');
  if (img) img.src = imgs[window.__wsMvIdx];
  const c = document.getElementById('ws-mv-counter');
  if (c) c.textContent = (window.__wsMvIdx + 1) + ' / ' + imgs.length;
}

function wsTextOrEmpty(v) {
  const s = String(v || '').trim();
  return s || 'Не указано автором';
}

function wsBuildGallery(mainEl, thumbsEl, images, onMainClick) {
  const imgs = (images || []).filter(Boolean);
  const thumbsOnly = !!(mainEl && (
    mainEl.hidden ||
    mainEl.hasAttribute('hidden') ||
    (mainEl.closest && mainEl.closest('.ws-gallery--thumbs-only'))
  ));

  if (mainEl && !thumbsOnly) {
    mainEl.hidden = false;
    mainEl.style.display = '';
    if (!imgs.length) {
      mainEl.innerHTML = '<div class="ws-gallery-empty">Нет изображений</div>';
    } else {
      mainEl.innerHTML = `<img src="${escapeHtml(imgs[0])}" alt="" data-ws-gallery-main />`;
      const img = mainEl.querySelector('img');
      if (img && onMainClick) {
        img.style.cursor = 'zoom-in';
        img.addEventListener('click', () => onMainClick(img.src));
      }
    }
  } else if (mainEl) {
    mainEl.innerHTML = '';
    mainEl.hidden = true;
    mainEl.style.display = 'none';
  }

  if (thumbsEl) {
    if (!imgs.length) {
      thumbsEl.innerHTML = thumbsOnly ? '<div class="ws-gallery-empty">Нет изображений</div>' : '';
      thumbsEl.style.display = thumbsOnly ? '' : 'none';
      return;
    }
    // в медиа thumbs прячем если картинка одна; в модах (thumbsOnly) показываем всегда
    if (!thumbsOnly && imgs.length < 2) {
      thumbsEl.innerHTML = '';
      thumbsEl.style.display = 'none';
      return;
    }
    thumbsEl.style.display = '';
    thumbsEl.innerHTML = imgs.map((src, i) => `
      <button type="button" class="ws-gallery-thumb ${i === 0 ? 'active' : ''}" data-src="${escapeHtml(src)}">
        <img src="${escapeHtml(src)}" alt="" loading="lazy" />
      </button>`).join('');
    thumbsEl.querySelectorAll('.ws-gallery-thumb').forEach(btn => {
      btn.addEventListener('click', () => {
        thumbsEl.querySelectorAll('.ws-gallery-thumb').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const src = btn.getAttribute('data-src') || '';
        if (!src) return;
        if (thumbsOnly) {
          if (onMainClick) onMainClick(src);
          return;
        }
        if (mainEl) {
          mainEl.innerHTML = `<img src="${escapeHtml(src)}" alt="" data-ws-gallery-main />`;
          const img = mainEl.querySelector('img');
          if (img && onMainClick) {
            img.style.cursor = 'zoom-in';
            img.addEventListener('click', () => onMainClick(img.src));
          }
        }
      });
    });
  }
}

function getInstalledModIds() {
  try {
    return JSON.parse(localStorage.getItem('catio_installed_mods') || '[]').map(Number).filter(Boolean);
  } catch (e) { return []; }
}
function setInstalledModIds(ids) {
  try { localStorage.setItem('catio_installed_mods', JSON.stringify(ids)); } catch (e) {}
}
function isModInstalled(modId) {
  return getInstalledModIds().includes(+modId);
}
/** { [gameId]: [ { id, title, cover_url, enabled } ] } */
function getGameModsMap() {
  try { return JSON.parse(localStorage.getItem('catio_game_mods') || '{}') || {}; }
  catch (e) { return {}; }
}
function setGameModsMap(map) {
  try { localStorage.setItem('catio_game_mods', JSON.stringify(map || {})); } catch (e) {}
}
function getModsForGame(gameId) {
  const map = getGameModsMap();
  const list = map[String(gameId)] || map[+gameId] || [];
  return Array.isArray(list) ? list : [];
}
function setModsForGame(gameId, list) {
  const map = getGameModsMap();
  map[String(gameId)] = Array.isArray(list) ? list : [];
  setGameModsMap(map);
}
function markModInstalled(modId, on, modMeta) {
  modId = +modId;
  let ids = getInstalledModIds().filter(id => +id !== modId);
  if (on) ids.push(modId);
  setInstalledModIds(ids);
  // привязка к игре
  const gameId = modMeta && modMeta.game_id ? +modMeta.game_id : 0;
  if (gameId) {
    let list = getModsForGame(gameId).filter(m => +m.id !== modId);
    if (on) {
      list.push({
        id: modId,
        title: (modMeta && modMeta.title) || ('Мод #' + modId),
        cover_url: (modMeta && (modMeta.cover_url || modMeta.banner_url || (modMeta.images_list && modMeta.images_list[0]))) || '',
        enabled: true
      });
    }
    setModsForGame(gameId, list);
  } else if (!on) {
    // удалили без game_id — вычистить из всех игр
    const map = getGameModsMap();
    Object.keys(map).forEach(gid => {
      map[gid] = (map[gid] || []).filter(m => +m.id !== modId);
    });
    setGameModsMap(map);
  }
}
function setModEnabled(gameId, modId, enabled) {
  const list = getModsForGame(gameId).map(m => {
    if (+m.id === +modId) return { ...m, enabled: !!enabled };
    return m;
  });
  setModsForGame(gameId, list);
}
function removeModFromGame(gameId, modId) {
  setModsForGame(gameId, getModsForGame(gameId).filter(m => +m.id !== +modId));
  markModInstalled(modId, false);
}
function fillGameSettingsMods(gameId) {
  const box = document.getElementById('sgdb-mods-list');
  if (!box) return;
  gameId = +gameId || +(window.__steamEditGameId || 0);
  const mods = getModsForGame(gameId);
  const pane = box.closest('.sgdb-pane');
  const paneTitle = pane && pane.querySelector('.sgdb-pane-title');
  const paneHint = pane && pane.querySelector(':scope > .settings-hint');
  if (!mods.length) {
    if (paneTitle) paneTitle.style.display = 'none';
    if (paneHint) paneHint.style.display = 'none';
    box.innerHTML = `<div class="sgdb-mods-empty">
      <div class="sgdb-mods-empty-title">Модификации ещё не установлены</div>
      <button type="button" class="hp-btn-edit" id="sgdb-mods-to-ws">В мастерскую</button>
    </div>`;
    document.getElementById('sgdb-mods-to-ws')?.addEventListener('click', () => {
      document.getElementById('steam-import-modal')?.classList.add('hidden');
      if (typeof openWorkshop === 'function') openWorkshop();
      else if (typeof showView === 'function') showView('workshop');
    });
    return;
  }
  if (paneTitle) paneTitle.style.display = '';
  if (paneHint) paneHint.style.display = '';
  box.innerHTML = mods.map(m => {
    const cover = m.cover_url
      ? `<img src="${escapeHtml(m.cover_url)}" alt="" loading="lazy" />`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin:11px;opacity:.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`;
    return `<div class="sgdb-mod-item" data-mod-id="${m.id}">
      <div class="sgdb-mod-thumb">${cover}</div>
      <div class="sgdb-mod-body">
        <div class="sgdb-mod-title">${escapeHtml(m.title || ('Мод #' + m.id))}</div>
        <div class="sgdb-mod-sub">${m.enabled !== false ? 'Включён при запуске' : 'Выключен'}</div>
      </div>
      <div class="sgdb-mod-actions">
        <button type="button" class="sgdb-mod-toggle ${m.enabled !== false ? 'on' : ''}" data-mod-toggle="${m.id}" title="Вкл/выкл при запуске" aria-label="Вкл/выкл"><span></span></button>
        <button type="button" class="sgdb-mod-del" data-mod-del="${m.id}" title="Удалить мод" aria-label="Удалить">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
  box.querySelectorAll('[data-mod-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mid = +btn.getAttribute('data-mod-toggle');
      const on = !btn.classList.contains('on');
      setModEnabled(gameId, mid, on);
      fillGameSettingsMods(gameId);
    });
  });
  box.querySelectorAll('[data-mod-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const mid = +btn.getAttribute('data-mod-del');
      const ok = await appConfirm({
        title: 'Удалить мод?',
        message: 'Мод будет убран из списка этой игры. В мастерской снова появится «Установить».',
        okText: 'Удалить',
        danger: true
      });
      if (!ok) return;
      removeModFromGame(gameId, mid);
      fillGameSettingsMods(gameId);
      // обновить кнопку на странице мода, если открыта
      try {
        if (window.__wsModvData && +window.__wsModvData.id === mid) {
          updateModInstallButton(window.__wsModvData);
        }
      } catch (e) {}
      toast('Мод удалён');
    });
  });
}

function userOwnsGameId(gameId) {
  gameId = +gameId;
  if (!gameId) return false;
  try {
    if (Array.isArray(libraryCache) && libraryCache.some(g => +g.id === gameId)) return true;
  } catch (e) {}
  try {
    if (Array.isArray(sideLibCache) && sideLibCache.some(g => +g.id === gameId)) return true;
  } catch (e) {}
  try {
    if (window.__currentGame && +window.__currentGame.id === gameId && window.__currentGame.owned) return true;
  } catch (e) {}
  return false;
}

function updateModInstallButton(mod) {
  const btn = document.getElementById('ws-modv-install');
  if (!btn || !mod) return;
  const installed = isModInstalled(mod.id);
  btn.dataset.mode = installed ? 'remove' : 'install';
  if (installed) {
    // 1:1 как #pub-btn-delete на странице издательства
    btn.className = 'hp-btn-logout hp-btn-danger ws-modv-install';
    btn.title = 'Удалить';
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Удалить`;
  } else {
    btn.className = 'hp-btn-save ws-modv-install';
    btn.title = 'Установить';
    btn.textContent = 'Установить';
  }
}

function openModNoGameModal(mod) {
  const modal = document.getElementById('ws-mod-no-game-modal');
  if (!modal) return;
  window.__wsModNoGame = mod;
  const text = document.getElementById('ws-mod-nogame-text');
  if (text) {
    text.textContent = 'У вас нет игры «' + (mod.game_title || 'для этой модификации') + '». Автоматическая установка невозможна, но можно скачать файл и установить вручную.';
  }
  modal.classList.remove('hidden');
}

function bindModNoGameModal() {
  const modal = document.getElementById('ws-mod-no-game-modal');
  if (!modal || modal.dataset.bound === '1') return;
  modal.dataset.bound = '1';
  modal.querySelectorAll('[data-close-ws-mod-nogame]').forEach(el => {
    el.addEventListener('click', () => modal.classList.add('hidden'));
  });
  document.getElementById('ws-mod-nogame-buy')?.addEventListener('click', () => {
    const mod = window.__wsModNoGame;
    modal.classList.add('hidden');
    if (mod && mod.game_id && typeof gotoGame === 'function') gotoGame(mod.game_id);
  });
  document.getElementById('ws-mod-nogame-manual')?.addEventListener('click', () => {
    const mod = window.__wsModNoGame;
    modal.classList.add('hidden');
    if (mod) wsDownloadModFile(mod);
  });
}

function wsDownloadModFile(mod) {
  if (!mod) return;
  const url = mod.file_url || window.__wsModvFile || '';
  if (!url) {
    toast('Файл мода недоступен');
    return;
  }
  // в очередь загрузок, если есть
  try {
    if (typeof dm !== 'undefined' && dm && Array.isArray(dm.queue)) {
      dm.queue.push({
        buildId: 'mod-' + mod.id,
        title: (mod.title || 'Мод') + ' (мод)',
        platform: 'mod',
        version: '1',
        size: 0,
        status: 'queued',
        url
      });
      if (typeof renderDownloads === 'function') renderDownloads();
      if (typeof processDownloadQueue === 'function') processDownloadQueue();
      toast('Мод добавлен в загрузки');
      return;
    }
  } catch (e) {}
  window.open(url, '_blank');
  toast('Скачивание файла мода');
}

async function handleModInstallClick() {
  const mod = window.__wsModvData;
  if (!mod) return;
  const btn = document.getElementById('ws-modv-install');
  const mode = btn?.dataset.mode || 'install';
  if (mode === 'remove') {
    markModInstalled(mod.id, false, mod);
    updateModInstallButton(mod);
    try {
      const gid = +mod.game_id || +(window.__steamEditGameId || 0);
      if (gid) fillGameSettingsMods(gid);
    } catch (e) {}
    toast('Мод удалён');
    return;
  }
  if (!userOwnsGameId(mod.game_id)) {
    bindModNoGameModal();
    openModNoGameModal(mod);
    return;
  }
  // авто-установка: скачать + пометить + список модов игры
  markModInstalled(mod.id, true, mod);
  updateModInstallButton(mod);
  try {
    const gid = +mod.game_id || 0;
    if (gid) fillGameSettingsMods(gid);
  } catch (e) {}
  wsDownloadModFile(mod);
  toast('Мод установлен');
}

async function openWorkshopMediaView(id) {
  id = parseInt(id, 10) || 0;
  if (!id) return;
  window.__wsMvId = id;
  try {
    const data = await fetchJSON(WS_API + '?action=media_item&id=' + id);
    if (!data || !data.ok || !data.media) throw new Error((data && data.error) || 'Не найдено');
    const m = data.media;
    try {
      if (m.views != null) wsBumpViewsLocal('media', id, +m.views);
      else wsBumpViewsLocal('media', id);
    } catch (e) {}
    const imgs = m.images_list || (m.image_url ? [m.image_url] : []);
    window.__wsMvImages = imgs;
    window.__wsMvIdx = 0;
    const title = document.getElementById('ws-mv-title');
    if (title) title.textContent = m.title || 'Скриншот';
    wsBuildGallery(
      document.getElementById('ws-mv-main'),
      document.getElementById('ws-mv-thumbs'),
      imgs,
      (src) => openLightbox(src)
    );
    const date = document.getElementById('ws-mv-date');
    if (date) date.textContent = m.created_at ? ('Опубликовано: ' + wsFormatDate(m.created_at)) : '';
    const author = document.getElementById('ws-mv-author');
    if (author) author.textContent = m.author_name ? ('от ' + m.author_name) : '';
    const views = document.getElementById('ws-mv-views');
    if (views) views.textContent = '👁 ' + wsFormatNum(m.views);
    const likeBtn = document.getElementById('ws-mv-like');
    if (likeBtn) {
      likeBtn.classList.toggle('is-liked', !!m.liked);
      const sp = likeBtn.querySelector('span');
      if (sp) sp.textContent = wsFormatNum(m.likes);
    }
    const desc = document.getElementById('ws-mv-desc');
    if (desc) desc.textContent = wsTextOrEmpty(m.description);
    wsOpenModal('ws-media-view-modal');
  } catch (e) {
    toast(e.message || 'Ошибка');
  }
}

async function openWorkshopModView(id) {
  id = parseInt(id, 10) || 0;
  if (!id) return;
  window.__wsModvId = id;
  try {
    const data = await fetchJSON(WS_API + '?action=mod&id=' + id);
    if (!data || !data.ok || !data.mod) throw new Error((data && data.error) || 'Не найдено');
    const m = data.mod;
    try { if (m.views != null) wsBumpViewsLocal('mod', id, +m.views); else wsBumpViewsLocal('mod', id); } catch (e) {}

    window.__wsModvData = m;
    const shots = m.screenshots_list || [];
    window.__wsModvShots = shots;
    window.__wsModvIdx = 0;
    window.__wsModvFile = m.file_url || '';

    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || ''; };
    setTxt('ws-modv-title', m.title || 'Мод');
    const setStat = (id, n) => {
      const el = document.getElementById(id);
      if (!el) return;
      const b = el.querySelector('b');
      if (b) b.textContent = wsFormatNum(n);
      else el.textContent = wsFormatNum(n);
    };
    setStat('ws-modv-views', m.views);
    setStat('ws-modv-dls', m.downloads);
    setStat('ws-modv-likes', m.likes);
    setTxt('ws-modv-author', m.author_name ? ('Автор: ' + m.author_name) : 'Автор: Не указано автором');
    setTxt('ws-modv-game', m.game_title ? ('Игра: ' + m.game_title) : 'Игра: Не указано автором');

    const bg = document.getElementById('ws-modv-bg');
    if (bg) {
      const url = m.banner_url || m.cover_url || m.game_cover || '';
      bg.style.backgroundImage = url ? ("url('" + String(url).replace(/'/g, '%27') + "')") : '';
      bg.style.backgroundSize = 'cover';
      bg.style.backgroundPosition = 'center';
    }

    setTxt('ws-modv-desc', wsTextOrEmpty(m.description || m.short_description));
    setTxt('ws-modv-about', wsTextOrEmpty(m.about));
    setTxt('ws-modv-install-txt', wsTextOrEmpty(m.install_instructions));
    setTxt('ws-modv-feat', wsTextOrEmpty(m.features));
    setTxt('ws-modv-deps', wsTextOrEmpty(m.dependencies));
    // секции всегда видны
    ['ws-modv-about-wrap','ws-modv-install-wrap','ws-modv-feat-wrap','ws-modv-deps-wrap'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });

    wsBuildGallery(
      document.getElementById('ws-modv-main'),
      document.getElementById('ws-modv-thumbs'),
      shots,
      (src) => openLightbox(src)
    );

    const likeBtn = document.getElementById('ws-modv-like');
    if (likeBtn) {
      likeBtn.classList.toggle('is-liked', !!m.liked);
      const sp = likeBtn.querySelector('span');
      if (sp) sp.textContent = wsFormatNum(m.likes);
    }

    updateModInstallButton(m);
    wsOpenModal('ws-mod-view-modal');
  } catch (e) {
    toast(e.message || 'Ошибка');
  }
}

async function wsToggleLike(type, id, btnSel) {
  id = parseInt(id, 10) || 0;
  if (!id) return;
  try {
    const data = await fetchJSON(WS_API + '?action=like', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, id })
    });
    if (!data || !data.ok) throw new Error((data && data.error) || 'Ошибка');
    const btn = document.querySelector(btnSel);
    if (btn) {
      btn.classList.toggle('is-liked', !!data.liked);
      const sp = btn.querySelector('span');
      if (sp) sp.textContent = wsFormatNum(data.likes);
    }
  } catch (e) {
    toast(e.message || 'Нужно войти');
  }
}

window.openWorkshopMediaView = openWorkshopMediaView;

window.__wsAssetvId = 0;
window.__wsAssetvFile = '';
window.__wsAssetvShots = [];

async function openWorkshopAssetView(id) {
  id = parseInt(id, 10) || 0;
  if (!id) return;
  window.__wsAssetvId = id;
  window.__wsAssetvFile = '';
  try {
    const data = await fetchJSON(WS_API + '?action=asset&id=' + id);
    if (!data || !data.ok || !data.asset) {
      toast((data && data.error) || 'Ассет не найден');
      return;
    }
    const a = data.asset;
    try {
      if (a.views != null) wsBumpViewsLocal('asset', id, +a.views);
      else wsBumpViewsLocal('asset', id);
    } catch (e) {}
    const titleEl = document.getElementById('ws-assetv-title');
    if (titleEl) titleEl.textContent = a.title || 'Ассет';

    const likeBtn = document.getElementById('ws-assetv-like');
    if (likeBtn) {
      likeBtn.classList.toggle('is-liked', !!a.liked);
      const sp = likeBtn.querySelector('span');
      if (sp) sp.textContent = wsFormatNum(a.likes);
    }
    const statsLine = document.getElementById('ws-assetv-stats-line');
    if (statsLine) {
      statsLine.textContent = '👁 ' + wsFormatNum(a.views) + ' · ⬇ ' + wsFormatNum(a.downloads) + ' · ♥ ' + wsFormatNum(a.likes);
    }

    const desc = document.getElementById('ws-assetv-desc');
    if (desc) {
      const raw = a.description || a.short_description || '';
      desc.innerHTML = typeof formatGameDescription === 'function' ? formatGameDescription(raw) : escapeHtml(raw).replace(/\n/g, '<br>');
      desc.classList.remove('gp-description--collapsed');
      desc.scrollTop = 0;
    }
    const author = document.getElementById('ws-assetv-author');
    if (author) author.textContent = a.author_name ? ('Автор: ' + a.author_name) : '';
    const gameEl = document.getElementById('ws-assetv-game');
    if (gameEl) gameEl.textContent = a.game_title ? ('Игра: ' + a.game_title) : 'Без привязки к игре';

    // галерея: скрины → cover → пусто
    let shots = a.screenshots_list || [];
    if (!shots.length && a.cover_url) shots = [a.cover_url];
    if (!shots.length && a.banner_url) shots = [a.banner_url];
    window.__wsAssetvShots = shots;
    const gal = document.getElementById('ws-assetv-gallery');
    const mainImg = document.getElementById('ws-assetv-main-img');
    const thumbs = document.getElementById('ws-assetv-thumbs');
    if (gal) gal.hidden = false;
    if (mainImg) {
      if (shots.length) {
        mainImg.src = shots[0];
        mainImg.style.display = '';
      } else {
        mainImg.removeAttribute('src');
        mainImg.style.display = 'none';
      }
    }
    if (thumbs) {
      if (shots.length > 1) {
        thumbs.innerHTML = shots.map((src, i) =>
          `<button type="button" class="gp-thumb ${i===0?'active':''}" data-src="${escapeHtml(src)}"><img src="${escapeHtml(src)}" alt="" /></button>`
        ).join('');
        thumbs.style.display = '';
        thumbs.querySelectorAll('.gp-thumb').forEach(btn => {
          btn.addEventListener('click', () => {
            thumbs.querySelectorAll('.gp-thumb').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (mainImg && btn.dataset.src) {
              mainImg.src = btn.dataset.src;
              mainImg.style.display = '';
            }
          });
        });
      } else {
        thumbs.innerHTML = '';
        thumbs.style.display = 'none';
      }
    }

    const files = a.files_list || [];
    const filesBox = document.getElementById('ws-assetv-files');
    if (filesBox) {
      if (!files.length) {
        filesBox.innerHTML = '<p class="modal-builds-empty">Файлы не прикреплены</p>';
        window.__wsAssetvFile = '';
      } else {
        window.__wsAssetvFile = files[0].url || '';
        filesBox.innerHTML = files.map(f => {
          const name = escapeHtml(f.name || basenameSafe(f.url) || 'файл');
          const size = f.size ? (typeof formatSize === 'function' ? formatSize(f.size) : wsFormatBytes(f.size)) : '';
          const url = escapeHtml(f.url || '');
          return `<div class="build-row">
            <div class="build-info">
              <span class="build-version">${name}</span>
              ${size ? `<span class="build-size">${size}</span>` : ''}
            </div>
            <button type="button" class="btn-download" data-asset-file="${url}">Скачать</button>
          </div>`;
        }).join('');
      }
    }

    wsOpenModal('ws-asset-view-modal');
  } catch (err) {
    toast(err.message || 'Ошибка загрузки ассета');
  }
}

function basenameSafe(u) {
  try { return String(u).split('/').pop() || ''; } catch (e) { return ''; }
}
window.openWorkshopAssetView = openWorkshopAssetView;

window.openWorkshopModView = openWorkshopModView;


function initWsAssetRte() {
  const root = document.getElementById('ws-asset-rte');
  const ed = document.getElementById('ws-asset-desc-editor');
  const ta = document.getElementById('ws-asset-desc');
  if (!root || !ed || root.dataset.bound === '1') return;
  root.dataset.bound = '1';
  root.querySelectorAll('.pub-rte-btn').forEach(btn => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      ed.focus();
      const cmd = btn.getAttribute('data-cmd');
      const val = btn.getAttribute('data-val') || undefined;
      if (cmd === 'createLink') {
        const url = prompt('URL ссылки');
        if (url) document.execCommand('createLink', false, url);
        return;
      }
      document.execCommand(cmd, false, val);
    });
  });
  const sync = () => { if (ta) ta.value = ed.innerHTML.trim(); };
  ed.addEventListener('input', sync);
  ed.addEventListener('blur', sync);
}

document.addEventListener('click', async (e) => {
  if (!(e.target && e.target.closest && e.target.closest('#ws-asset-submit'))) return;
  e.preventDefault();
  const form = document.getElementById('ws-asset-form');
  if (!form) return;
  const title = (form.querySelector('[name="title"]')?.value || '').trim();
  const ed = document.getElementById('ws-asset-desc-editor');
  const ta = document.getElementById('ws-asset-desc');
  if (ed && ta) ta.value = ed.innerHTML.trim();
  const desc = (ta ? ta.value : (form.querySelector('[name="description"]')?.value || '')).trim();
  const plain = desc.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  if (title.length < 2) { toast('Название: минимум 2 символа'); return; }
  if (!plain) { toast('Напишите описание'); return; }
  const fd = new FormData(form);
  if (ta) fd.set('description', ta.value);
  const btn = document.getElementById('ws-asset-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Отправка…'; }
  try {
    const res = await fetch(WS_API + '?action=submit_asset', { method: 'POST', body: fd, credentials: 'same-origin' });
    let text = await res.text();
    const js = text.indexOf('{');
    if (js > 0) text = text.slice(js);
    const data = JSON.parse(text);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    toast('Ассет отправлен на модерацию');
    wsCloseModal('ws-asset-form-modal');
    form.reset();
    if (ed) ed.innerHTML = '';
    if (ta) ta.value = '';
    // сразу обновить модерку и уведомления без перезагрузки
    try { if (typeof refreshAdminPendingBadge === 'function') refreshAdminPendingBadge(); } catch (e) {}
    try { if (typeof loadAdminPending === 'function') loadAdminPending(); } catch (e) {}
    try { if (typeof loadNotifications === 'function') loadNotifications(); } catch (e) {}
    try { if (typeof refreshBadge === 'function') refreshBadge(); } catch (e) {}
  } catch (err) {
    toast(err.message || 'Не удалось отправить');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Отправить на модерацию'; }
  }
});
