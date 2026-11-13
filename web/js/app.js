// CATio frontend — shell (toast, balance, navigation, init)

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
  if (name === 'community') { name = 'workshop'; if (typeof openWorkshop === 'function') openWorkshop(); }
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
  if (name === 'admin') {
    // всегда открываем раздел «Модерация», иначе справа может быть пусто
    const view = document.getElementById('view-admin');
    if (view) {
      view.querySelectorAll('.settings-nav-btn[data-atab]').forEach(b => {
        b.classList.toggle('active', b.dataset.atab === 'moderation');
      });
      view.querySelectorAll('.settings-pane').forEach(p => {
        p.classList.toggle('hidden', p.id !== 'admin-pane-moderation');
      });
    }
    loadAdminPending();
  }
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



/* --- home.js, store.js loaded separately --- */


/* --- game.js, workshop.js, admin.js loaded separately --- */



document.addEventListener('DOMContentLoaded', () => {
  // Сначала кнопка «+», чтобы сбой других init её не убил




  /* publishers.js loaded separately — init calls below */


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

  const safe = (name, fn) => {
    try {
      let f = null;
      try { if (typeof fn === 'function') f = fn; } catch (e) { f = null; }
      if (!f) {
        try { if (typeof window[name] === 'function') f = window[name]; } catch (e) {}
      }
      // global function declarations bind to window in browser
      if (!f) {
        try { f = Function('return typeof ' + name + " === \'function\' ? " + name + ' : null')(); } catch (e) {}
      }
      if (f) f();
    } catch (e) { console.error(name, e); }
  };
  safe('initWebNav', typeof initWebNav === 'function' ? initWebNav : null);
  safe('initClientNav', typeof initClientNav === 'function' ? initClientNav : null);
  safe('initAvatarMenu', typeof initAvatarMenu === 'function' ? initAvatarMenu : null);
  safe('initCartUI', typeof initCartUI === 'function' ? initCartUI : null);
  safe('initStoreControls', typeof initStoreControls === 'function' ? initStoreControls : null);
  safe('initLibraryControls', typeof initLibraryControls === 'function' ? initLibraryControls : null);
  safe('initCatioSelects', typeof initCatioSelects === 'function' ? initCatioSelects : null);
  safe('initSegControls', typeof initSegControls === 'function' ? initSegControls : null);
  safe('initThemePicker', typeof initThemePicker === 'function' ? initThemePicker : null);
  safe('initProfileControls', typeof initProfileControls === 'function' ? initProfileControls : null);
  safe('initSettingsView', typeof initSettingsView === 'function' ? initSettingsView : null);
  safe('initLightbox', typeof initLightbox === 'function' ? initLightbox : null);
  safe('initHomeControls', typeof initHomeControls === 'function' ? initHomeControls : null);
  safe('initFriendsUI', typeof initFriendsUI === 'function' ? initFriendsUI : null);
  safe('initChatUI', typeof initChatUI === 'function' ? initChatUI : null);
  safe('initChatExtras', typeof initChatExtras === 'function' ? initChatExtras : null);
  safe('initNotificationsUI', typeof initNotificationsUI === 'function' ? initNotificationsUI : null);
  safe('initBottomBar', typeof initBottomBar === 'function' ? initBottomBar : null);
  safe('bindFriendCodeButtons', () => { bindFriendCodeButtons(); renderProfileFriendCode(getMyFriendCode()); updateBottomBarVersion(); });
  safe('initAdminPanel', typeof initAdminPanel === 'function' ? initAdminPanel : null);
  safe('initAdminUserModal', typeof initAdminUserModal === 'function' ? initAdminUserModal : null);
  safe('initSideLibrary', typeof initSideLibrary === 'function' ? initSideLibrary : null);
  safe('initContentHead', typeof initContentHead === 'function' ? initContentHead : null);
  safe('updateDownloadsBadge', typeof updateDownloadsBadge === 'function' ? updateDownloadsBadge : null);
  safe('loadSideLibrary', typeof loadSideLibrary === 'function' ? loadSideLibrary : null);

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
  const runAdminBadge = () => {
    try {
      if (!(window.AUTH_STATE && window.AUTH_STATE.authorized)) return;
      if (typeof refreshAdminPendingBadge === 'function') refreshAdminPendingBadge();
    } catch (e) {}
  };
  runAdminBadge();
  setInterval(runAdminBadge, 45000);
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


/* publish modal helpers provided by publishers.js */
