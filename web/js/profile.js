/* CATio — profile view */

/* CATio — profile */
/* Depends: icons, utils, cart */

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
      ${icon('check-bold', 18, 'gi-icon gi-check')}
    </button>`;
  } else {
    const title = price.className === 'free' ? 'В библиотеку' : 'В корзину';
    actionBtn = `<button type="button" class="game-item__plus-wrapper is-add" data-id="${g.id}" data-price="${escapeHtml(String(g.price ?? 0))}" data-discount="${escapeHtml(String(g.discount_percent ?? 0))}" title="${title}">
      ${icon('plus', 18, 'gi-icon gi-plus')}
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
    ? `<span class="hp-game-ach-count">${icon('award', 16, 'hp-game-ach-ico')}${achU}/${achT}</span>`
    : `<span class="hp-game-ach-count muted">Нет ачивок</span>`;
  const cover = g.cover_src || g.cover_url || (`media.php?type=cover&id=${g.id}`);
  return `
    <div class="hp-game-card" data-id="${g.id}" data-title="${escapeHtml((g.title || '').toLowerCase())}">
      <img src="${escapeHtml(cover)}" alt="${escapeHtml(g.title)}" loading="lazy" />
      <span class="hp-game-time">
        ${icon('clock-alt', 16)}
        ${escapeHtml(timeLabel)}
      </span>
      ${showPin ? `<button type="button" class="hp-game-pin ${pinned ? 'pinned' : ''}" data-id="${g.id}" data-pinned="${pinned ? 1 : 0}" title="${pinned ? 'Открепить' : 'Закрепить'}">
        ${icon('trophy', 12)}
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
    ${icon('copy', 16, 'friend-code-ico')}
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
        ${icon('edit', 16)}
      </button>
      <button type="button" class="hp-btn-logout" onclick="logout()">
        ${icon('logout', 14)}
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
      playtimeEl.innerHTML = `${icon('clock-alt', 14)} ${formatPlaytime(s.playtime_minutes || 0)}`;
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
          ${icon('library-lines', 40)}
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


