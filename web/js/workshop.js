/* CATio — full workshop UI (Nexus-like) */

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
          ${icon('chevron-down', 16)}
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

/**
 * Hero мастерской: старый баннер СРАЗУ убираем (не opacity — иначе всё равно мерцает),
 * новый ставим только после preload. Токен отменяет устаревшие onload.
 */
window.__wsHeroLoadToken = window.__wsHeroLoadToken || 0;
window.__wsHeroCurrentUrl = window.__wsHeroCurrentUrl || '';

function resetWorkshopHeroBanner() {
  const bg = document.getElementById('ws-hero-bg');
  window.__wsHeroLoadToken = (window.__wsHeroLoadToken || 0) + 1;
  window.__wsHeroCurrentUrl = '';
  if (!bg) return window.__wsHeroLoadToken;
  bg.style.backgroundImage = 'none';
  bg.style.background = '';
  bg.classList.remove('has-image', 'is-swapping');
  bg.classList.add('is-waiting');
  return window.__wsHeroLoadToken;
}

function setWorkshopHeroBanner(url, token) {
  const bg = document.getElementById('ws-hero-bg');
  if (!bg) return;
  const next = (url && String(url).trim()) || '';
  if (!next) {
    if (token == null || token === window.__wsHeroLoadToken) {
      bg.style.backgroundImage = 'none';
      bg.classList.remove('has-image', 'is-waiting');
    }
    return;
  }
  // Уже показываем этот URL
  if (window.__wsHeroCurrentUrl === next && bg.classList.contains('has-image')) {
    bg.classList.remove('is-waiting');
    return;
  }
  const safe = String(next).replace(/'/g, '%27');
  const myToken = token != null ? token : window.__wsHeroLoadToken;
  const img = new Image();
  img.onload = function () {
    if (myToken !== window.__wsHeroLoadToken) return; // пришёл более новый заход
    bg.style.backgroundImage = "url('" + safe + "')";
    bg.style.backgroundSize = 'cover';
    bg.style.backgroundPosition = 'center';
    bg.classList.add('has-image');
    bg.classList.remove('is-waiting', 'is-swapping');
    window.__wsHeroCurrentUrl = next;
  };
  img.onerror = function () {
    if (myToken !== window.__wsHeroLoadToken) return;
    bg.classList.remove('is-waiting');
  };
  img.src = next;
}

async function loadWorkshopStats(opts) {
  opts = opts || {};
  const token = opts.token != null ? opts.token : window.__wsHeroLoadToken;
  try {
    const data = await fetchJSON(WS_API + '?action=stats');
    if (!data || !data.ok) {
      if (token === window.__wsHeroLoadToken) {
        const bg = document.getElementById('ws-hero-bg');
        if (bg) bg.classList.remove('is-waiting');
      }
      return;
    }
    const s = data.stats || {};
    const el = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = wsFormatNum(v); };
    el('ws-stat-views', s.views != null ? s.views : s.downloads);
    el('ws-stat-mods', s.mods);
    el('ws-stat-users', s.users);
    if (data.banner) {
      const url = data.banner.banner_url || data.banner.cover_url || '';
      // Один баннер на вкладку браузера — без смены (и мерцания) при каждом заходе
      if (url && !window.__wsHeroSessionUrl) window.__wsHeroSessionUrl = url;
      setWorkshopHeroBanner(window.__wsHeroSessionUrl || url, token);
    } else if (token === window.__wsHeroLoadToken) {
      const bg = document.getElementById('ws-hero-bg');
      if (bg) bg.classList.remove('is-waiting');
    }
    window.__wsStats = s;
    updateWorkshopSub();
  } catch (e) {
    console.warn('[workshop] stats', e);
    if (token === window.__wsHeroLoadToken) {
      const bg = document.getElementById('ws-hero-bg');
      if (bg) bg.classList.remove('is-waiting');
    }
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
      ${icon('workshop', 40)}
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
      wsFilterField('Поиск', `<div class="search-field">${icon('search', 14, 'search-field-icon')}<input type="text" class="auth-input" id="ws-f-game-q" placeholder="Название игры" value="${escapeHtml(f.q || '')}" /></div>`) +
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
      wsFilterField('Поиск', `<div class="search-field">${icon('search', 14, 'search-field-icon')}<input type="text" class="auth-input" id="ws-f-mod-q" placeholder="Поиск…" value="${escapeHtml(f.q || '')}" /></div>`) +
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
        <span class="hp-empty-logo" style="opacity:0.45;display:inline-flex" aria-hidden="true">${icon('library', 16)}</span>
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
  let heroToken = window.__wsHeroLoadToken || 0;
  if (window.__wsHeroSessionUrl) {
    // Уже есть баннер сессии — сразу ставим, без clear/мигания
    heroToken = window.__wsHeroLoadToken || 0;
    setWorkshopHeroBanner(window.__wsHeroSessionUrl, heroToken);
  } else {
    // Первый заход: убираем любой остаток, ждём stats
    heroToken = resetWorkshopHeroBanner();
  }
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
  await loadWorkshopStats({ token: heroToken });
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
      wsFilterField('Поиск', `<div class="search-field">${icon('search', 14, 'search-field-icon')}<input type="text" class="auth-input" id="wsg-f-q" placeholder="Название мода" /></div>`) +
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
      wsFilterField('Поиск', `<div class="search-field">${icon('search', 14, 'search-field-icon')}<input type="text" class="auth-input" id="wsg-f-asset-q" placeholder="Название ассета" /></div>`);
    const inp = document.getElementById('wsg-f-asset-q');
    if (inp) {
      let t;
      inp.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => loadWorkshopGameList(), 280);
      });
    }
  } else {
    side.innerHTML = wsFilterField('Поиск', `<div class="search-field">${icon('search', 14, 'search-field-icon')}<input type="text" class="auth-input" id="wsg-f-media-q" placeholder="Название" /></div>`);
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
    if (!fd.has('csrf_token')) fd.append('csrf_token', window.CSRF_TOKEN || '');
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
    if (!fd.has('csrf_token')) fd.append('csrf_token', window.CSRF_TOKEN || '');
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


/** Счётчики символов у полей формы мастерской */
function bindWsFormCounters(form) {
  if (!form || form.dataset.countersBound === '1') return;
  form.dataset.countersBound = '1';
  form.querySelectorAll('input[maxlength], textarea[maxlength], [data-counter-for]').forEach(el => {
    const max = parseInt(el.getAttribute('maxlength') || '0', 10) || 0;
    let counter = null;
    const cid = el.getAttribute('data-counter-for') || el.dataset.counter;
    if (cid) counter = document.getElementById(cid);
    if (!counter) {
      // сосед .char-count / .ws-char-count
      counter = el.parentElement && el.parentElement.querySelector('.char-count, .ws-char-count, .ws-counter');
    }
    if (!counter && el.id) {
      counter = document.getElementById(el.id + '-count') || document.getElementById(el.id + '-counter');
    }
    const update = () => {
      const n = (el.value || '').length;
      if (counter) counter.textContent = max ? (n + '/' + max) : String(n);
    };
    el.addEventListener('input', update);
    el.addEventListener('change', update);
    update();
  });
}

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
      : `${icon('layers', 18)}`;
    return `<div class="sgdb-mod-item" data-mod-id="${m.id}">
      <div class="sgdb-mod-thumb">${cover}</div>
      <div class="sgdb-mod-body">
        <div class="sgdb-mod-title">${escapeHtml(m.title || ('Мод #' + m.id))}</div>
        <div class="sgdb-mod-sub">${m.enabled !== false ? 'Включён при запуске' : 'Выключен'}</div>
      </div>
      <div class="sgdb-mod-actions">
        <button type="button" class="sgdb-mod-toggle ${m.enabled !== false ? 'on' : ''}" data-mod-toggle="${m.id}" title="Вкл/выкл при запуске" aria-label="Вкл/выкл"><span></span></button>
        <button type="button" class="sgdb-mod-del" data-mod-del="${m.id}" title="Удалить мод" aria-label="Удалить">
          ${icon('trash', 15)}
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
    btn.innerHTML = `${icon('trash', 14)} Удалить`;
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
      body: JSON.stringify({ type, id, csrf_token: window.CSRF_TOKEN || '' })
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
    if (!fd.has('csrf_token')) fd.append('csrf_token', window.CSRF_TOKEN || '');
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
