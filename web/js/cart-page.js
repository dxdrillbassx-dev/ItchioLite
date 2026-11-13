/* CATio — cart page UI */
/* Depends: cart.js, utils.js, icons.js */

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
      try { window.fillPublishPublisherSelect(); } catch (e) {}
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
  // прогреем список издательств заранее
  try { window.fetchMyPublishers(true).catch(() => {}); } catch (e) {}
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
