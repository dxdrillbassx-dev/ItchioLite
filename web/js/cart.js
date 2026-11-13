/* CATio — cart (localStorage) */
/* Depends on: utils.js, icons.js */

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
          ${icon('x', 18)}
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




