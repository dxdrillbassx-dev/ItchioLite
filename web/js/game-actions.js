/* CATio — game buy/rate/install/builds */

// ---------- Кнопка покупки ----------
function refreshBuyButton(g) {
  const btn = $('#btn-buy-game');
  const note = $('#buy-note');
  if (!btn) return;
  const price = formatPrice(g.price, g.discount_percent);
  const mod = btn.closest('.gp-purchase-mod');
  if (g.owned) {
    const pref = getPreferredVersion(g.id);
    const hasAny = Object.keys(getInstalledVersions(g.id)).length > 0;
    const installing = typeof isGameDownloading === 'function' && isGameDownloading(g.id);
    if (installing) {
      btn.innerHTML = `${icon('sun', 16)} Установка`;
      btn.dataset.mode = 'installing';
      btn.disabled = true;
      btn.classList.add('is-disabled', 'owned');
      btn.classList.remove('in-cart');
      if (mod) mod.classList.remove('is-in-cart');
      if (note) note.textContent = 'Идёт установка…';
    } else if (hasAny) {
      btn.innerHTML = `${icon('play', 16)} Играть${pref ? ' · v' + escapeHtml(pref) : ''}`;
      btn.dataset.mode = 'play';
      btn.disabled = false;
      btn.classList.remove('is-disabled');
      btn.classList.add('owned');
      btn.classList.remove('in-cart');
      if (mod) mod.classList.remove('is-in-cart');
      if (note) note.textContent = 'Установлено на этом ПК';
    } else {
      btn.innerHTML = `${icon('downloads', 16)} Установить`;
      btn.dataset.mode = 'install';
      btn.disabled = false;
      btn.classList.remove('is-disabled');
      btn.classList.add('owned');
      btn.classList.remove('in-cart');
      if (mod) mod.classList.remove('is-in-cart');
      if (note) note.textContent = '';
    }
  } else if (isInCart(g.id)) {
    btn.innerHTML = `${icon('check-bold', 15)} В корзине`;
    btn.classList.add('in-cart');
    btn.classList.remove('owned');
    if (mod) mod.classList.add('is-in-cart');
  } else if (g.purchased) {
    btn.innerHTML = `${icon('plus', 15)} В библиотеку`;
    btn.dataset.mode = 'restore';
    btn.classList.remove('owned', 'in-cart');
    if (mod) mod.classList.remove('is-in-cart');
    if (note) note.textContent = 'Куплено — можно вернуть в библиотеку';
  } else {
    if (price.className === 'free') {
      btn.innerHTML = `${icon('plus', 15)} Получить бесплатно`;
    } else {
      btn.innerHTML = `${icon('shopping-cart', 15)} В корзину`;
    }
    btn.classList.remove('owned', 'in-cart');
    if (mod) mod.classList.remove('is-in-cart');
    if (note) note.textContent = '';
  }
}

function initBuyButton(wrap, g) {
  refreshBuyButton(g);
  const btn = $('#btn-buy-game', wrap);
  if (!btn) return;

  btn.addEventListener('click', async () => {
    if (btn.disabled || btn.classList.contains('is-disabled')) {
      toast('Нет файлов для скачивания');
      return;
    }
    if (g.owned) {
      const mode = btn.dataset.mode || 'install';
      if (mode === 'installing' || (typeof isGameDownloading === 'function' && isGameDownloading(g.id))) {
        toast('Игра уже устанавливается');
        return;
      }
      const builds = (window.__currentGameBuilds || []).filter(b => !b.status || b.status === 'published');
      if (mode === 'play') {
        const ver = getPreferredVersion(g.id);
        toast(ver ? `Запуск v${ver}…` : 'Запуск…');
        // Клиент: если есть bridge — дергаем; иначе подсказка
        if (window.IS_CLIENT && typeof window.catioPlayGame === 'function') {
          try { window.catioPlayGame(g.id, ver); } catch (e) { toast(e.message || 'Не удалось запустить'); }
        } else {
          toast('Запуск из браузера недоступен — откройте в клиенте CATio');
        }
        return;
      }
      if (builds.length) openInstallModal(g, builds);
      else {
        const box = $('#game-builds', wrap) || $('#gp-section-builds');
        if (box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else toast('Нет доступных сборок');
      }
      return;
    }

    const price = formatPrice(g.price, g.discount_percent);
    const mode = btn.dataset.mode || '';

    // Куплено ранее / удалено из библиотеки — вернуть в библиотеку без корзины
    if (g.purchased || mode === 'restore') {
      btn.disabled = true;
      const prev = btn.innerHTML;
      btn.textContent = 'Добавляем...';
      try {
        const data = await postJSON(`${API_BASE}?action=buy`, { game_id: g.id });
        if (!data.ok) throw new Error(data.error || 'Не удалось добавить');
        if (data.balance !== undefined) updateBalance(data.balance);
        g.owned = true;
        g.purchased = true;
        toast(data.message || 'Вернули в библиотеку');
        sideLibAddOptimistic(g);
        loadGamePage(g.id);
      } catch (err) {
        toast(err.message || 'Ошибка');
        btn.innerHTML = prev;
      } finally {
        btn.disabled = false;
      }
      return;
    }

    // Бесплатные — сразу в библиотеку
    if (price.className === 'free') {
      btn.disabled = true;
      btn.textContent = 'Оформляем...';
      try {
        const data = await postJSON(`${API_BASE}?action=buy`, { game_id: g.id });
        if (!data.ok) throw new Error(data.error || 'Не удалось оформить');
        if (data.balance !== undefined) updateBalance(data.balance);
        g.owned = true;
        g.purchased = true;
        toast(data.message || 'Добавлено в библиотеку');
        sideLibAddOptimistic(g);
        loadGamePage(g.id);
      } catch (err) {
        toast(err.message || 'Ошибка');
      } finally {
        btn.disabled = false;
        if (!g.owned) refreshBuyButton(g);
      }
      return;
    }

    // Платные — в корзину
    if (isInCart(g.id)) {
      showView('cart');
      return;
    }
    const added = addToCart(g);
    if (added) {
      refreshBuyButton(g);
      showAddToCartModal(g);
    } else {
      toast('Уже в корзине');
      showView('cart');
    }
  });
}

// ---------- Оценка звёздами ----------
function initRateStars(wrap, g) {
  const stars = $$('.rate-star', wrap);
  if (!stars.length) return;
  const paint = (n) => stars.forEach(s => s.classList.toggle('filled', +s.dataset.value <= n));

  stars.forEach(star => {
    star.addEventListener('mouseenter', () => paint(+star.dataset.value));
    star.addEventListener('click', async () => {
      const value = +star.dataset.value;
      try {
        const data = await postJSON(`${API_BASE}?action=rate`, { game_id: g.id, value });
        if (!data.ok) throw new Error(data.error || 'Не удалось оценить');
        g.user_rating = value;
        paint(value);
        const ratingBox = $('.game-page-rating', wrap);
        if (ratingBox && currentGame) {
          currentGame.game.rating = data.rating;
          ratingBox.innerHTML = starsHtml(data.rating, (currentGame.ratings_count || 0) + 1);
        }
        toast(`Оценка ${value} из 5 сохранена`);
      } catch (err) {
        toast(err.message || 'Ошибка');
      }
    });
  });
  const box = $('#rate-stars', wrap);
  if (box) box.addEventListener('mouseleave', () => paint(g.user_rating || 0));
}

// ---------- Установки (localStorage) ----------
function getInstallMap() {
  try { return JSON.parse(localStorage.getItem('catio_installs') || '{}') || {}; }
  catch (e) { return {}; }
}
function setInstallMap(map) {
  try { localStorage.setItem('catio_installs', JSON.stringify(map)); } catch (e) {}
}
function getInstalledVersions(gameId) {
  const m = getInstallMap();
  return (m[String(gameId)] && m[String(gameId)].versions) || {};
}
function isVersionInstalled(gameId, version) {
  return !!getInstalledVersions(gameId)[String(version)];
}
function markVersionInstalled(gameId, version, buildId, size) {
  const m = getInstallMap();
  const key = String(gameId);
  if (!m[key]) m[key] = { versions: {}, preferred: null };
  m[key].versions[String(version)] = { buildId: +buildId, size: +size || 0, at: Date.now() };
  if (!m[key].preferred) m[key].preferred = String(version);
  setInstallMap(m);
  markInstalled(gameId);
}
function getPreferredVersion(gameId) {
  const m = getInstallMap()[String(gameId)];
  if (!m) return null;
  if (m.preferred && m.versions[m.preferred]) return m.preferred;
  // newest by date
  let best = null, bestAt = 0;
  Object.keys(m.versions || {}).forEach(v => {
    const at = m.versions[v].at || 0;
    if (at >= bestAt) { bestAt = at; best = v; }
  });
  return best;
}
function setPreferredVersion(gameId, version) {
  const m = getInstallMap();
  const key = String(gameId);
  if (!m[key]) return;
  m[key].preferred = String(version);
  setInstallMap(m);
}

// ---------- Модалка установки ----------
let __installCtx = null;
function openInstallModal(g, builds, preferBuildId) {
  const modal = document.getElementById('install-modal');
  if (!modal || !builds || !builds.length) {
    toast('Нет доступных сборок');
    return;
  }
  __installCtx = { g, builds };
  const cover = document.getElementById('install-cover');
  const title = document.getElementById('install-title');
  const sizeEl = document.getElementById('install-size');
  const sel = document.getElementById('install-version');
  const confirmBtn = document.getElementById('install-confirm');
  if (title) title.textContent = g.title || 'Игра';
  if (cover) {
    const url = g.icon_url || g.cover_url || g.banner_url || '';
    cover.style.backgroundImage = url ? "url('" + String(url).replace(/'/g, '%27') + "')" : '';
    cover.textContent = url ? '' : (g.title || '?').slice(0, 1).toUpperCase();
  }
  if (sel) {
    sel.innerHTML = builds.map(b => {
      const inst = isVersionInstalled(g.id, b.version) ? ' ✓' : '';
      return `<option value="${b.id}" data-version="${escapeHtml(b.version)}" data-size="${b.file_size_bytes || 0}" data-platform="${escapeHtml(b.platform || 'windows')}" data-installed="${inst ? '1' : '0'}">v${escapeHtml(b.version)} · ${escapeHtml(b.platform || 'windows')}${inst}</option>`;
    }).join('');
    if (preferBuildId) sel.value = String(preferBuildId);
    const syncInstallUi = () => {
      const opt = sel.selectedOptions[0];
      if (sizeEl && opt) sizeEl.textContent = formatSize(+opt.dataset.size || 0);
      const installed = !!(opt && (opt.dataset.installed === '1' || isVersionInstalled(g.id, opt.dataset.version || '')));
      if (confirmBtn) {
        confirmBtn.disabled = installed;
        confirmBtn.classList.toggle('is-disabled', installed);
        confirmBtn.textContent = installed ? 'Уже установлено' : 'Установить';
        confirmBtn.style.opacity = installed ? '0.55' : '';
        confirmBtn.style.cursor = installed ? 'default' : '';
      }
    };
    sel.onchange = syncInstallUi;
    syncInstallUi();
  }
  modal.classList.remove('hidden');
}
function closeInstallModal() {
  const modal = document.getElementById('install-modal');
  if (modal) modal.classList.add('hidden');
  __installCtx = null;
}
document.addEventListener('click', (e) => {
  if (!e.target || !e.target.closest) return;
  if (e.target.closest('[data-close-install]')) {
    closeInstallModal();
    return;
  }
  if (e.target.closest('#install-confirm')) {
    e.preventDefault();
    const sel = document.getElementById('install-version');
    const confirmBtn = document.getElementById('install-confirm');
    if (confirmBtn && confirmBtn.disabled) return;
    if (!sel || !__installCtx) return;
    const opt = sel.selectedOptions[0];
    if (!opt) return;
    const buildId = +opt.value;
    const version = opt.dataset.version || '';
    const size = +opt.dataset.size || 0;
    const platform = opt.dataset.platform || 'windows';
    const g = __installCtx.g;
    if (isVersionInstalled(g.id, version)) {
      toast('Эта версия уже установлена');
      return;
    }
    closeInstallModal();
    enqueueDownload({
      buildId,
      gameId: g.id,
      title: g.title,
      platform,
      version,
      size,
      onDoneInstall: true
    });
  }
});

// ---------- Сборки на странице игры ----------
function renderBuildsList(builds, g) {
  if (!builds.length) {
    return '<p class="modal-builds-empty">Сборок пока нет — загрузите файл при публикации.</p>';
  }
  const isAdm = !!(window.AUTH_STATE && window.AUTH_STATE.user && window.AUTH_STATE.user.role === 'admin');
  const owned = !!(g && (g.owned === true || g.owned === 1 || g.owned === '1' || g.in_library || g.is_owned || g.purchased));
  return `
    <div class="modal-builds">
      ${builds.map(b => {
        const installed = isVersionInstalled(g.id, b.version);
        const pending = (b.status === 'pending');
        let btnLabel = 'Установить';
        let locked = false;
        if (pending && isAdm) {
          btnLabel = 'Предзагрузить';
          locked = false;
        } else if (pending) {
          btnLabel = 'На модерации';
          locked = true;
        } else if (!owned) {
          btnLabel = 'Купите игру';
          locked = true;
        } else if (installed) {
          btnLabel = 'Установлено';
          locked = true;
        }
        return `
        <div class="build-row${pending ? ' is-pending' : ''}${locked ? ' is-locked' : ''}">
          <div class="build-info">
            <span class="build-version">v${escapeHtml(b.version || '')}</span>
            ${b.file_name ? `<span class="build-size">${escapeHtml(b.file_name)}</span>` : ''}
            ${b.file_size_bytes ? `<span class="build-size">${formatSize(b.file_size_bytes)}</span>` : ''}
            ${b.changelog ? `<span class="build-size">${escapeHtml(String(b.changelog).slice(0, 80))}</span>` : ''}
            ${pending ? '<span class="build-pending">на модерации</span>' : ''}
          </div>
          <button type="button" class="btn-download${installed ? ' is-installed' : ''}${locked ? ' is-disabled' : ''}" data-build-id="${b.id}"
            data-platform="${escapeHtml(b.platform || 'windows')}" data-version="${escapeHtml(b.version || '')}"
            data-size="${b.file_size_bytes || 0}" data-pending="${pending ? '1' : '0'}"
            ${locked ? 'disabled' : ''}>${btnLabel}</button>
        </div>`;
      }).join('')}
    </div>`;
}

function initBuildButtons(wrap, g) {
  $$('.btn-download', wrap).forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const builds = (window.__currentGameBuilds || []).filter(b => b.status !== 'rejected');
      const bid = +btn.dataset.buildId;
      if (btn.dataset.pending === '1') {
        // admin pre-download without install tracking
        enqueueDownload({
          buildId: bid,
          gameId: g.id,
          title: g.title + ' (предзагрузка)',
          platform: btn.dataset.platform,
          version: btn.dataset.version,
          size: +btn.dataset.size || 0,
          preDownload: true
        });
        return;
      }
      openInstallModal(g, builds.length ? builds : [{
        id: bid, version: btn.dataset.version, platform: btn.dataset.platform, file_size_bytes: +btn.dataset.size || 0
      }], bid);
    });
  });
}

