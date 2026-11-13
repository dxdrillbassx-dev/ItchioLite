/* CATio — direct messages */
/* Depends: icons, utils, friends */

// ============================================================
//  ЛИЧНЫЕ СООБЩЕНИЯ
// ============================================================
const MESSAGES_API = 'api/messages.php';
let chatPeerId = null;
let chatPollTimer = null;

function openChat(userId, username) {
  chatPeerId = +userId;
  const modal = $('#chat-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  closeFriendsModal();

  const nameEl = $('#chat-peer-name');
  if (nameEl) nameEl.textContent = username || 'Друг';
  const statusEl = $('#chat-peer-status');
  if (statusEl) statusEl.textContent = '…';
  const input = $('#chat-input');
  if (input) {
    input.value = '';
    input.placeholder = `Сообщение ${username || ''}…`.trim();
    setTimeout(() => input.focus(), 50);
  }
  loadChatThread();
  if (chatPollTimer) clearInterval(chatPollTimer);
  chatPollTimer = setInterval(() => {
    if (chatPeerId && !$('#chat-modal')?.classList.contains('hidden')) {
      loadChatThread(true);
    }
  }, 4000);
}

function closeChat() {
  const modal = $('#chat-modal');
  if (modal) modal.classList.add('hidden');
  chatPeerId = null;
  if (chatPollTimer) {
    clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
}

async function loadChatThread(silent) {
  if (!chatPeerId) return;
  try {
    const data = await fetchJSON(`${MESSAGES_API}?action=thread&user_id=${chatPeerId}`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const peer = data.peer;
    const av = $('#chat-peer-avatar');
    if (av && peer) {
      av.style.cssText = friendAvatarStyle(peer);
      av.innerHTML = friendAvatarText(peer) + (peer.is_online ? '<span class="online-dot"></span>' : '');
    }
    const nameEl = $('#chat-peer-name');
    if (nameEl && peer) nameEl.textContent = peer.username;
    const statusEl = $('#chat-peer-status');
    if (statusEl && peer) statusEl.textContent = peer.is_online ? 'В сети' : 'Не в сети';
    const hint = $('#chat-offline-hint');
    if (hint) {
      const online = !!(peer && peer.is_online);
      hint.classList.toggle('hidden', online);
      if (!online && peer) {
        hint.textContent = `${peer.username} не в сети — увидит сообщения позже.`;
      }
    }

    renderChatMessages(data.messages || []);
  } catch (err) {
    if (!silent) toast(err.message || 'Не удалось загрузить переписку');
  }
}

function chatCoverUrl(gameId) {
  const id = String(gameId || '').replace(/[^0-9]/g, '');
  if (!id) return '';
  // сначала из кэша библиотеки / стора
  try {
    const pools = [];
    if (typeof libraryCache !== 'undefined' && Array.isArray(libraryCache)) pools.push(...libraryCache);
    if (typeof storeCache !== 'undefined' && Array.isArray(storeCache)) pools.push(...storeCache);
    if (typeof homeCache !== 'undefined' && homeCache) {
      pools.push(...(homeCache.featured || []), ...(homeCache.games || []));
    }
    const g = pools.find(x => String(x.id) === id);
    if (g) {
      const u = g.cover_src || g.cover_url || g.icon_url || g.banner_url;
      if (u) return resolveChatImageUrl(u);
    }
  } catch (e) {}
  return resolveChatImageUrl('media.php?type=cover&id=' + id);
}

function resolveChatImageUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) return url;
  url = url.replace(/^\/+/, '');
  try {
    // абсолютный URL от текущей страницы (важно для webview)
    return new URL(url, window.location.href).href;
  } catch (e) {
    return url;
  }
}

function renderChatMessages(messages) {
  const box = $('#chat-messages');
  if (!box) return;
  const peerName = ($('#chat-peer-name')?.textContent || 'другу').trim();
  if (!messages.length) {
    box.innerHTML = `
      <div class="chat-empty" id="chat-empty">
        <div class="chat-empty-icon">${icon('message', 28)}</div>
        <div class="chat-empty-title">Пока нет сообщений</div>
        <div class="chat-empty-sub">Напишите ${escapeHtml(peerName)}</div>
      </div>`;
    return;
  }
  const wasBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;

  box.innerHTML = messages.map(m => {
    const time = formatDateTime(m.created_at);
    const cls = m.mine ? 'mine' : 'theirs';
    const body = String(m.body || '').trim();

    // ---- IMAGE / DRAWING ----
    const imgMatch = body.match(/^\[image\](.+)$/i);
    if (imgMatch || body.startsWith('[image]')) {
      const raw = imgMatch ? imgMatch[1].trim() : body.slice(7).trim();
      const url = resolveChatImageUrl(raw);
      return `<div class="chat-attach ${cls}" data-type="image">
        <div class="chat-attach-media">
          ${url
            ? `<img src="${escapeHtml(url)}" alt="Изображение" loading="lazy" class="chat-attach-img" data-fallback="1" />`
            : `<div class="chat-attach-broken">🖼 Нет файла</div>`}
        </div>
        <div class="chat-attach-foot"><span>Изображение</span><span class="chat-attach-time">${escapeHtml(time)}</span></div>
      </div>`;
    }

    // ---- GAME SHARE ----
    const gameMatch = body.match(/^\[game:(\d+)\](.*)$/i);
    if (gameMatch) {
      const gid = gameMatch[1];
      const title = (gameMatch[2] || '').trim() || 'Игра';
      const cover = chatCoverUrl(gid);
      return `<div class="chat-attach ${cls}" data-type="game">
        <button type="button" class="chat-attach-game" data-game-id="${escapeHtml(gid)}">
          <span class="chat-attach-game-cover">
            ${cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" onerror="this.remove()" />` : ''}
          </span>
          <span class="chat-attach-game-info">
            <span class="chat-attach-game-title">${escapeHtml(title)}</span>
            <span class="chat-attach-game-sub">Игра · открыть</span>
          </span>
        </button>
        <div class="chat-attach-foot"><span></span><span class="chat-attach-time">${escapeHtml(time)}</span></div>
      </div>`;
    }

    // ---- TEXT ----
    return `<div class="chat-bubble ${cls}">${escapeHtml(body)}<span class="chat-bubble-time">${escapeHtml(time)}</span></div>`;
  }).join('');

  $$('.chat-attach-game', box).forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const id = el.dataset.gameId;
      if (id) gotoGame(id);
    });
  });
  // images: error fallback + click
  $$('.chat-attach-img', box).forEach(img => {
    img.addEventListener('error', () => {
      const broken = document.createElement('div');
      broken.className = 'chat-attach-broken';
      broken.textContent = '🖼 Файл недоступен';
      img.replaceWith(broken);
    });
    img.addEventListener('click', () => {
      try {
        if (typeof openLightbox === 'function') openLightbox(img.src);
        else window.open(img.src, '_blank');
      } catch (e) {
        window.open(img.src, '_blank');
      }
    });
  });

  if (wasBottom || !silentRenderGuard) {
    box.scrollTop = box.scrollHeight;
  }
}
let silentRenderGuard = false;



async function sendChatMessage() {
  const input = $('#chat-input');
  if (!input || !chatPeerId) return;
  const body = input.value.trim();
  if (!body) return;
  const btn = $('#chat-send');
  if (btn) btn.disabled = true;
  try {
    const res = await postJSON(`${MESSAGES_API}?action=send`, {
      user_id: chatPeerId,
      body,
    });
    if (!res.ok) throw new Error(res.error || 'Ошибка');
    input.value = '';
    // append optimistically
    const box = $('#chat-messages');
    if (box) {
      const empty = box.querySelector('.chat-empty');
      if (empty) box.innerHTML = '';
      const m = res.message;
      const div = document.createElement('div');
      div.className = 'chat-bubble mine';
      div.innerHTML = `${escapeHtml(m.body)}<span class="chat-bubble-time">${escapeHtml(formatDateTime(m.created_at))}</span>`;
      box.appendChild(div);
      box.scrollTop = box.scrollHeight;
    }
  } catch (err) {
    toast(err.message || 'Не удалось отправить');
  } finally {
    if (btn) btn.disabled = false;
    input.focus();
  }
}

function initChatUI() {
  const close = $('#chat-close');
  if (close) close.addEventListener('click', closeChat);
  const backdrop = $('#chat-backdrop');
  if (backdrop) backdrop.addEventListener('click', closeChat);
  const send = $('#chat-send');
  if (send) send.addEventListener('click', sendChatMessage);
  const input = $('#chat-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }
}


