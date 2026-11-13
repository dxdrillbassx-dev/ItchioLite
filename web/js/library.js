/* CATio — library view */
/* Depends: icons, utils */

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
            ${icon('search', 56)}
          </div>
          <p class="library-empty-title">Ничего не найдено</p>
          <p class="library-empty-sub">Попробуйте другой фильтр</p>
        </div>`
      : `<div class="library-empty library-empty-centered">
          <div class="library-empty-icon" aria-hidden="true">
            ${icon('library', 56)}
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
      ? `<span class="hp-game-ach-count">${icon('award', 16, 'hp-game-ach-ico')}${achU}/${achT}</span>`
      : `<span class="hp-game-ach-count muted">Нет ачивок</span>`;

    const card = document.createElement('article');
    card.className = 'lib-card' + (isInstalled ? ' is-installed' : '');
    card.dataset.id = g.id;
    card.tabIndex = 0;
    card.innerHTML = `
      <div class="lib-card-cover">
        <img src="${escapeHtml(cover)}" alt="${escapeHtml(g.title || '')}" loading="lazy" />
        <div class="lib-card-time" title="Время в игре">
          ${icon('clock', 12)}
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

