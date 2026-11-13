/* CATio — notifications + chat extras */
/* Depends: icons, utils, messages */

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

function isAuthorized() {
  return !!(window.AUTH_STATE && window.AUTH_STATE.authorized);
}

async function refreshBadge() {
  // На экране логина / гость — не дёргаем API (иначе 401 в консоли)
  if (!isAuthorized()) {
    setMenuBadge('.friends-menu-badge', 0);
    setMenuBadge('.notif-menu-badge', 0);
    setMenuBadge('.messages-menu-badge, .msg-menu-badge', 0);
    setAvatarDots(false);
    return;
  }
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

    // Админ: параллельно проверяем очередь модерации (список обновится при изменении счётчика)
    try {
      const me = window.AUTH_STATE && window.AUTH_STATE.user;
      if (me && me.role === 'admin' && typeof refreshAdminPendingBadge === 'function') {
        refreshAdminPendingBadge();
      }
    } catch (e) {}
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
          <div class="notif-page-empty-icon" aria-hidden="true">${icon('bell-off', 44)}</div>
          <div class="notif-page-empty-title">Нет уведомлений</div>
          <div class="notif-page-empty-sub">Вы в курсе всех событий! Загляните позже за новыми обновлениями.</div>
        </div>`;
      return;
    }
    const iconMap = {
      friend_request: icon('user-plus', 18),
      friend_accepted: icon('friends', 18),
      message: icon('message', 18),
      sale: icon('dollar', 18),
      system: icon('bell', 18),
    };
    const defaultIcon = icon('bell', 18);
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

  if (isAuthorized()) {
    refreshBadge();
    if (badgeTimer) clearInterval(badgeTimer);
    badgeTimer = setInterval(refreshBadge, 1500);
    // 1.5s: уведомление о новой заявке появляется быстрее (раньше 3s)
  }
  // мгновенно обновлять при возврате во вкладку (только если уже вошли)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isAuthorized()) refreshBadge();
  });
  window.addEventListener('focus', () => { if (isAuthorized()) refreshBadge(); });
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


