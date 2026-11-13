/* CATio — home + side library + content head */
/* Depends: icons, utils, cart */

// ============================================================
//  ГЛАВНАЯ (как в Hydra): hero-баннер, подборки, «Удиви меня»
// ============================================================
let homeCache = null;
let homeSort = 'popular';
let homeSearch = '';
let dlSearch = '';
let profileSearch = '';

const HOME_SORT_ICONS = {
  popular: icon('star', 16),
  week: icon('trending-up', 16),
  new: '' + icon('clock', 16) + '',
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
        ${icon('table', 44)}
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
          <span title="Скачивания">${icon('download-lg', 14)}${dl}</span>
          <span title="В библиотеках">${icon('friends', 14)}${players}</span>
          <span title="Оценка">${icon('star-fill-alt', 14)}${rating}</span>
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
        btn.innerHTML = icon('plus', 18, 'gi-icon gi-plus');
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
        btn.innerHTML = `${icon('plus', 15)} В библиотеку`;
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
      el.innerHTML = `${icon('clock', 12)} ${label}`;
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
    const icon = g.id ? ('media.php?type=icon&id=' + g.id + '&v=' + (window.__iconBust || window.__mediaBust || '1')) : (g.icon_src || g.icon_url || g.cover_url || g.cover_src || '');
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

