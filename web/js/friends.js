/* CATio — friends + public profiles */
/* Depends: icons, utils */

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
    btnReq.innerHTML = `${icon('user-plus', 14)} Отправить заявку`;
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
    btnReq.innerHTML = `${icon('user-plus', 14)} Отправить заявку`;
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
              ${icon('message', 14)}
            </button>`;
        } else {
          actions = `
            <button type="button" class="friends-icon-btn" data-act="profile" data-id="${u.id}" data-username="${escapeHtml(u.username)}" title="Профиль">
              ${icon('user', 14)}
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
          ${icon('library-lines', 40)}
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
      ? `<button type="button" class="hp-btn-edit hp-btn-icon" id="hp-admin-edit-user" title="Редактировать" aria-label="Редактировать">${icon('edit', 16)}</button>`
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
            ${icon('user-minus', 16)}
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
    playEl.innerHTML = `${icon('clock-alt', 14)} ${formatPlaytime(p.playtime_minutes || 0)}`;
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
          ${icon('library-lines', 40)}
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



