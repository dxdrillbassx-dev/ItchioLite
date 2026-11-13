/* CATio — store / catalog */
/* Depends: icons, utils, cart, home */

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
      ${icon('check-bold', 18, 'gi-icon gi-check')}
    </button>`;
  } else if (!inCart) {
    const title = (purchased || price.className === 'free') ? 'В библиотеку' : 'В корзину';
    actionBtn = `<button type="button" class="game-item__plus-wrapper is-add" data-id="${game.id}" title="${title}">
      ${icon('plus', 18, 'gi-icon gi-plus')}
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
  plusBtn.innerHTML = icon('check-bold', 18, 'gi-icon gi-check');
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
        ${icon('search', 40)}
      </div>
      <div class="hp-empty-text">${emptyMsg}</div>
    </div>`;
    return;
  }

  list.innerHTML = '';
  games.forEach(game => list.appendChild(createStoreRow(game)));
}

/** Бинды фильтров каталога (сорт, эра, цена, сброс, аккордеоны) */
function initStoreControls() {
  if (window.__storeControlsBound) return;
  window.__storeControlsBound = true;

  const sort = document.getElementById('sort-select');
  if (sort) {
    sort.value = storeSort || 'popular';
    sort.addEventListener('change', () => {
      storeSort = sort.value || 'popular';
      renderStoreList();
    });
  }

  document.querySelectorAll('.store-era-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      storeEra = btn.dataset.era || 'modern';
      try { localStorage.setItem('catio_store_era', storeEra); } catch (e) {}
      syncStoreEraToggle();
      renderStoreList();
    });
  });

  const pills = document.getElementById('price-pills');
  if (pills) {
    pills.querySelectorAll('.price-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        pills.querySelectorAll('.price-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        storePrice = btn.dataset.price || 'all';
        renderStoreList();
      });
    });
  }

  const clearBtn = document.getElementById('store-clear-filters');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (typeof clearStoreFilters === 'function') clearStoreFilters();
      else {
        storeGenres = new Set();
        storeDevs = new Set();
        storePrice = 'all';
        storeSearch = '';
        if (pills) {
          pills.querySelectorAll('.price-pill').forEach(b => b.classList.toggle('active', b.dataset.price === 'all'));
        }
        if (typeof buildStoreFilters === 'function') buildStoreFilters();
        renderStoreList();
      }
    });
  }

  // аккордеон блоков фильтров
  document.querySelectorAll('.store-filters .filter-block-head').forEach(head => {
    head.addEventListener('click', () => {
      const block = head.closest('.filter-block');
      if (!block) return;
      const body = block.querySelector('.filter-block-body');
      if (!body) return;
      const open = head.getAttribute('aria-expanded') !== 'false';
      head.setAttribute('aria-expanded', open ? 'false' : 'true');
      body.style.display = open ? 'none' : '';
    });
  });

  // локальный поиск по жанрам/девам в сайдбаре
  const genreSearch = document.getElementById('genre-filter-search');
  if (genreSearch) {
    genreSearch.addEventListener('input', () => {
      const q = genreSearch.value.trim().toLowerCase();
      document.querySelectorAll('#genre-opts label, #genre-opts .filter-opt').forEach(el => {
        const t = (el.textContent || '').toLowerCase();
        el.style.display = !q || t.includes(q) ? '' : 'none';
      });
    });
  }
  const devSearch = document.getElementById('dev-filter-search');
  if (devSearch) {
    devSearch.addEventListener('input', () => {
      const q = devSearch.value.trim().toLowerCase();
      document.querySelectorAll('#dev-opts label, #dev-opts .filter-opt').forEach(el => {
        const t = (el.textContent || '').toLowerCase();
        el.style.display = !q || t.includes(q) ? '' : 'none';
      });
    });
  }
}
