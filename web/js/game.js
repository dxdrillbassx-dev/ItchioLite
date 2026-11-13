/* CATio — game page (render, achievements, similar, media) */

/* CATio — game page (detail, builds, comments, ratings) */
/* Depends: icons, utils, cart */

// ============================================================
//  СТРАНИЦА ИГРЫ (как на itch.io)
// ============================================================
let currentGame = null;

async function loadGamePage(id) {
  const wrap = $('#game-page');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading">Загрузка страницы игры...</div>';

  try {
    const data = await fetchJSON(`${API_BASE}?action=get&id=${id}`);
    if (!data.ok) throw new Error(data.error || 'Игра не найдена');
    currentGame = data;
    renderGamePage(wrap, data);
    // В шапке показываем название игры, как в Hydra
    const headTitle = $('#head-title');
    if (headTitle && data.game) headTitle.textContent = data.game.title;
  } catch (err) {
    if (isOffline(err)) {
      renderOffline(wrap, () => loadGamePage(id), 'Кот ушёл в запой');
    } else {
      wrap.innerHTML = `<div class="loading">${escapeHtml(err.message)}<br><button type="button" class="btn-retry" onclick="gotoView('store')">Назад в каталог</button></div>`;
    }
  }
}











function renderGamePage(wrap, data) {
  const g = data.game;
  window.__lastGameForCart = g;
  const price = formatPrice(g.price, g.discount_percent);
  const tags = tagsToArray(g.tags);
  const shots = (data.screenshots || []).map(s => (typeof s === 'string' ? s : (s && (s.url || s.image_url)) || '')).filter(Boolean);
  window.__lastGameScreenshots = shots.slice();
  const videos = data.videos || [];
  const viewer = data.viewer || {};
  const authorized = viewer.authorized;
  const cover = g.cover_src || g.cover_url || '';
  const hero = g.banner_url || g.cover_url || cover || (`media.php?type=hero&id=${g.id}`);
  // как в Steam: сначала трейлеры, потом скрины
  const gallery = [];
  const videoItems = [];
  videos.forEach((v, i) => {
    if (!v || !v.url) return;
    let src = String(v.url).replace(/^http:\/\//i, 'https://');
    // DASH alone often unplayable — skip as primary if only mpd
    if (/\.mpd(\?|$)/i.test(src) && !/\.m3u8/i.test(src)) {
      // keep as fallback candidate only if we have nothing else later
      videoItems.push({
        type: 'video', src, fallbacks: [], format: 'dash',
        thumb: v.thumbnail || cover || '', name: v.name || ('Трейлер ' + (i + 1)),
        _prio: 3,
      });
      return;
    }
    const fallbacks = Array.isArray(v.fallbacks)
      ? v.fallbacks.map(u => String(u).replace(/^http:\/\//i, 'https://'))
      : [];
    let prio = 1;
    if (/youtube\.com|youtu\.be/i.test(src)) prio = 0;
    else if (/^uploads\//i.test(src) || /\.(mp4|webm)(\?|$)/i.test(src)) prio = 0;
    else if (/\.m3u8(\?|$)/i.test(src)) prio = 2;
    videoItems.push({
      type: 'video', src, fallbacks, format: v.format || '',
      thumb: v.thumbnail || cover || '', name: v.name || ('Трейлер ' + (i + 1)),
      _prio: prio,
    });
  });
  videoItems.sort((a, b) => (a._prio - b._prio));
  videoItems.forEach(it => { delete it._prio; gallery.push(it); });
  (shots.length ? shots : (cover ? [cover] : [])).forEach((src) => {
    if (!src) return;
    src = String(src).trim();
    if (!src) return;
    // не тащим в галерею явно битые/не-картинки
    if (/\.ico(\?|$)/i.test(src)) return;
    if (/\.mp4|\.webm|\.m3u8|\.mpd/i.test(src)) return;
    gallery.push({ type: 'image', src, thumb: src });
  });
  const descHtml = formatGameDescription(g.description || 'Описание отсутствует.');
  const releaseLabel = g.created_at
    ? ('Выпущено ' + formatDate(g.created_at))
    : '';
  const publisher = g.developer_name || g.developer || '';

  const buildsCount = Array.isArray(data.builds) ? data.builds.length : (parseInt(g.builds_count, 10) || 0);
  const hasBuilds = buildsCount > 0;
  const playHours = g.playtime_minutes ? Math.max(1, Math.round(+g.playtime_minutes / 60)) : 0;
  const playLabel = playHours
    ? ('Сыграно ' + playHours + ' ' + (playHours === 1 ? 'час' : (playHours < 5 ? 'часа' : 'часов')))
    : 'Ещё не запускалась';
  const lastLabel = g.last_played
    ? ('Последний запуск ' + (typeof formatRelative === 'function' ? formatRelative(g.last_played) : formatDate(g.last_played)))
    : '';

  // Hydra-style status line: title lives only here, no big H1
  let statusMain = '';
  let statusSub = '';
  if (g.owned) {
    if (playHours > 0) {
      statusMain = playLabel;
      statusSub = lastLabel;
    } else {
      statusMain = 'Вы ещё не играли в ' + (g.title || 'эту игру');
    }
  } else {
    statusMain = 'Вы ещё не играли в ' + (g.title || 'эту игру');
  }
  const actionLeft = `<div class="gp-playtime">${escapeHtml(statusMain)}</div>`
    + (statusSub ? `<div class="gp-last-play">${escapeHtml(statusSub)}</div>` : '');

  const isWebBrowser = document.body.classList.contains('web') || !document.body.classList.contains('client');

  // В браузере: без облака/настроек; карандаш админа — в actionbar вместо настроек
  const adminEditChip = (viewer && viewer.is_admin && !isWebBrowser)
    ? `<button type="button" class="gp-hero-chip" id="gp-admin-edit" title="Редактировать">${iconSvg('pencil',15)}</button>`
    : '';
  const adminEditBar = (viewer && viewer.is_admin && isWebBrowser)
    ? `<button type="button" class="gp-bar-btn icon" id="gp-admin-edit" title="Редактировать">${iconSvg('pencil',16)}</button>`
    : '';
  const adminEditBtn = adminEditChip; // legacy name for hero tools

  const dlDisabled = !hasBuilds ? ' disabled aria-disabled="true"' : '';
  const dlClass = hasBuilds ? 'gp-bar-btn primary' : 'gp-bar-btn primary is-disabled';
  const dlTitle = hasBuilds ? 'Скачать' : 'Нет файлов для скачивания';

  const pinSvg = `${icon('trophy', 16)}`;
  const pinSvgPinned = `${icon('trophy', 16)}`;
  const isPinnedGame = !!(+g.is_pinned);

  const settingsOrEditBtn = isWebBrowser
    ? adminEditBar
    : `<button type="button" class="gp-bar-btn gp-settings-btn" id="gp-settings" title="Настройки">
         ${iconSvg('settings',16)}
         <span>Настройки</span>
       </button>`;

  const cloudChip = isWebBrowser ? '' : `
            <button type="button" class="gp-hero-chip" id="gp-cloud-saves" title="Облачное сохранение">
              ${icon('cloud', 14)}
              <span>Облачное сохранение</span>
            </button>`;

  const meUser = window.AUTH_STATE && window.AUTH_STATE.user;
  const isGameOwner = !!(meUser && g && (
    +g.submitted_by === +meUser.id || +g.user_id === +meUser.id || g.is_owner === true || g.is_owner === 1
  ));
  const updateChip = isGameOwner
    ? `<button type="button" class="gp-hero-chip" id="gp-game-update" title="Обновить версию">
        ${icon('refresh', 14)}
      </button>`
    : '';


  const inCart = !g.owned && !g.purchased && isInCart(g.id);

  // Единый модуль «цена + кнопка» как в Steam
  let purchaseMod = '';
  if (!g.owned) {
    // уже куплено / было в библиотеке — вернуть без цены и без корзины
    if (g.purchased) {
      purchaseMod = `<div class="gp-purchase-mod">
        <button type="button" class="gp-purchase-btn free" id="btn-buy-game" data-mode="restore">
          ${icon('plus', 15)}
          В библиотеку
        </button>
      </div>`;
    } else if (price.className === 'free') {
      purchaseMod = `<div class="gp-purchase-mod">
        <button type="button" class="gp-purchase-btn free" id="btn-buy-game">
          ${icon('plus', 15)}
          Получить бесплатно
        </button>
      </div>`;
    } else {
      const priceInner = price.discount > 0
        ? `<span class="gp-purchase-discount">-${price.discount}%</span>
           <span class="gp-purchase-prices">
             <span class="gp-purchase-old">${escapeHtml(price.original)}</span>
             <span class="gp-purchase-final">${escapeHtml(price.text)}</span>
           </span>`
        : `<span class="gp-purchase-final only">${escapeHtml(price.text)}</span>`;
      purchaseMod = `<div class="gp-purchase-mod ${inCart ? 'is-in-cart' : ''}">
        <div class="gp-purchase-price">${priceInner}</div>
        <button type="button" class="gp-purchase-btn ${inCart ? 'in-cart' : ''}" id="btn-buy-game">
          ${inCart
            ? `${icon('check-bold', 15)} В корзине`
            : `${icon('shopping-cart', 15)} В корзину`}
        </button>
      </div>`;
    }
  }

  const actionBtns = g.owned
    ? `<button type="button" class="${dlClass}" id="btn-buy-game"${dlDisabled} title="${dlTitle}">
         ${icon('downloads', 16)}
         Скачать
       </button>
       <span class="gp-bar-sep" aria-hidden="true"></span>
       <button type="button" class="gp-bar-btn icon gp-like-btn ${g.is_liked || g.liked ? 'liked' : ''}" id="gp-like" title="${g.is_liked || g.liked ? 'Убрать лайк' : 'Лайк'}">${iconSvg('heart',16)}</button>
       <button type="button" class="gp-bar-btn icon ${isPinnedGame ? 'is-pinned' : ''}" id="gp-share" title="${isPinnedGame ? 'Открепить' : 'Закрепить'}">${isPinnedGame ? pinSvgPinned : pinSvg}</button>
       ${settingsOrEditBtn}`
    : `${adminEditBar}${purchaseMod}`;

  wrap.innerHTML = `
    <div class="gp">
      <div class="gp-hero">
        <img class="gp-hero-bg" src="${escapeHtml(hero)}" alt="" onerror="this.style.opacity=0.35" />
        <div class="gp-hero-grad"></div>
        <div class="gp-hero-content">
          ${g.logo_url ? `<img class="gp-hero-logo" src="${escapeHtml(g.logo_url)}" alt="" onerror="this.style.display='none'" />` : ''}
        </div>
        <div class="gp-hero-bottom">
          ${(!isWebBrowser || adminEditBtn || updateChip || cloudChip) ? `<div class="gp-hero-tools">
            ${adminEditBtn || ''}
            ${updateChip || ''}
            ${cloudChip || ''}
          </div>` : ''}
          <div class="gp-actionbar">
            <div class="gp-action-left">${actionLeft}</div>
            <div class="gp-action-btns">${actionBtns}</div>
          </div>
        </div>
      </div>

      <div class="gp-layout">
        <div class="gp-main">
          <div class="gp-meta-card">
            ${releaseLabel ? `<p class="gp-meta-strong">${escapeHtml(releaseLabel)}</p>` : ''}
            ${publisher ? `<p class="gp-meta-muted">Издатель ${g.publisher_id ? `<button type="button" class="gp-publisher-link" data-pub-id="${g.publisher_id}">${escapeHtml(publisher)}</button>` : escapeHtml(publisher)}</p>` : ''}
            ${!releaseLabel && !publisher ? `<p class="gp-meta-muted">${escapeHtml(g.genre || 'Игра')}</p>` : ''}
          </div>

          ${gallery.length ? `
          <div class="gp-gallery">
            <div class="gp-gallery-viewport">
              <div class="gp-gallery-main" id="gallery-main">
                ${gallery[0].type === 'video'
                  ? `<video id="gallery-main-video" src="${escapeHtml(gallery[0].src)}" controls playsinline preload="metadata" muted poster="${escapeHtml(gallery[0].thumb || '')}"></video>`
                  : `<img id="gallery-main-img" src="${escapeHtml(gallery[0].src)}" alt="" />`}
              </div>
            </div>
            <div class="gp-gallery-thumbs">
              ${gallery.map((item, i) => `
                <button type="button" class="gp-thumb ${i===0?'active':''}${item.type==='video'?' gp-thumb-video':''}"
                  data-type="${item.type}" data-src="${escapeHtml(item.src)}" data-thumb="${escapeHtml(item.thumb || '')}">
                  <img src="${escapeHtml(item.thumb || item.src)}" alt="" />
                  ${item.type === 'video' ? '<span class="gp-thumb-play">▶</span>' : ''}
                </button>`).join('')}
            </div>
          </div>` : ''}

          <h2 class="gp-block-title">Об игре</h2>
          <div class="gp-description gp-description--collapsed" id="gp-description">${descHtml}</div>
          <button type="button" class="gp-desc-toggle" id="gp-desc-toggle">Показать больше</button>
          ${tags.length ? `<div class="game-tags gp-tags">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}

          <div class="gp-section gp-section-builds">
            <h2 class="gp-block-title">Сборки и файлы</h2>
            <div id="game-builds">${renderBuildsList(data.builds || [], g)}</div>
          </div>

          <div class="gp-similar-wrap">
            <h2 class="gp-block-title">Похожие игры</h2>
            <div id="gp-similar" class="gp-similar-grid"><div class="loading">Загрузка...</div></div>
          </div>

          <div class="gp-reviews-section" id="gp-reviews">
            ${authorized ? `
            <div class="gp-review-form-wrap" id="comment-form-wrap">
              <h2 class="gp-leave-title">Оставить отзыв</h2>
              <form class="comment-form" id="comment-form">
                <div id="comment-error" class="gp-comment-error hidden"></div>
                <input type="hidden" id="comment-parent-id" value="" />
                <div class="gp-reply-hint hidden" id="reply-hint">
                  Ответ на комментарий <button type="button" id="reply-cancel">Отменить</button>
                </div>
                <div class="gp-editor">
                  <div class="gp-editor-toolbar">
                    <button type="button" class="gp-fmt" data-fmt="bold" title="Жирный"><b>B</b></button>
                    <button type="button" class="gp-fmt" data-fmt="italic" title="Курсив"><i>I</i></button>
                    <button type="button" class="gp-fmt" data-fmt="underline" title="Подчёркнутый"><u>U</u></button>
                    <span class="gp-editor-count"><span id="comment-len">0</span>/1000</span>
                  </div>
                  <textarea id="comment-input" class="comment-input" maxlength="1000" rows="5" placeholder="" required></textarea>
                </div>
                <div class="comment-form-row">
                  <div class="rate-stars" id="rate-stars">
                    ${[1,2,3,4,5].map(v => `<button type="button" class="rate-star ${g.user_rating && v <= g.user_rating ? 'filled' : ''}" data-value="${v}">★</button>`).join('')}
                  </div>
                  <button type="submit" class="gp-submit-review" id="comment-submit">Отправить</button>
                </div>
              </form>
            </div>
            <div class="gp-reviews-separator"></div>
            ` : `<p class="gp-login-hint">Войдите, чтобы оставить отзыв</p><div class="gp-reviews-separator"></div>`}

            <div class="gp-reviews-list-header">
              <div class="gp-reviews-title-group">
                <h2 class="gp-reviews-title">Отзывы</h2>
                <span class="gp-reviews-badge" id="comments-count">${(data.comments||[]).length}</span>
              </div>
            </div>
            <div class="gp-sort-options">
              <button type="button" class="gp-sort-opt active" data-sort="new">▾ Сначала новые</button>
              <span class="gp-sort-sep">|</span>
              <button type="button" class="gp-sort-opt" data-sort="score">▴ Высший балл</button>
              <span class="gp-sort-sep">|</span>
              <button type="button" class="gp-sort-opt" data-sort="popular">${iconSvg('thumbsUp',14)} Самые популярные</button>
            </div>
            <div id="comments-list" class="gp-comments"></div>
          </div>
        </div>

        <aside class="gp-aside">
<div class="gp-side-card">
            <button type="button" class="gp-side-head">Статистика <span class="hp-side-arrow" aria-hidden="true">${icon('chevron-down', 16)}</span></button>
            <div class="gp-side-body gp-stats-body">
              <div class="gp-stat-row"><span class="gp-stat-ico">${iconSvg('download',14)}</span><span>Загрузки</span><b>${formatStatNum(g.download_count)}</b></div>
              <div class="gp-stat-row"><span class="gp-stat-ico">${iconSvg('users',14)}</span><span>Активные игроки</span><b>${formatStatNum(g.players_count ?? g.ratings_count ?? 0)}</b></div>
              <div class="gp-stat-row"><span class="gp-stat-ico">${iconSvg('star',14)}</span><span>Оценка</span><b>${(parseFloat(g.rating) || 0).toFixed(1)}</b></div>
            </div>
          </div>

          <div class="gp-side-card" id="gp-comm-card" data-game-id="${g.id}">
            <button type="button" class="gp-side-head">Скриншоты сообщества <span class="hp-side-arrow" aria-hidden="true">${icon('chevron-down', 16)}</span></button>
            <div class="gp-side-body" id="gp-comm-body">
              <div class="gp-ach-empty">Загрузка…</div>
            </div>
          </div>

          ${(() => {
            const ctrlHtml = renderControllerSupport(g.controllers);
            if (!ctrlHtml) return '';
            return `<div class="gp-side-card" id="gp-ctrl-card">
            <button type="button" class="gp-side-head">Поддержка контроллера <span class="hp-side-arrow" aria-hidden="true">${icon('chevron-down', 16)}</span></button>
            <div class="gp-side-body gp-ctrl-body">
              ${ctrlHtml}
            </div>
          </div>`;
          })()}

          ${typeof renderSysReqBlock === 'function' ? renderSysReqBlock(g.sys_req_min, g.sys_req_rec) : ''}
          ${typeof renderLangBlock === 'function' ? renderLangBlock(g.languages) : ''}
        </aside>
      </div>
    </div>
  `;

  wrap._galleryItems = gallery;
  wrap._gameData = g;
  initGallery(wrap);
  // корректно показать первый элемент (YouTube iframe / https video)
  if (gallery.length && gallery[0].type === 'video') {
    setGalleryMain(wrap, 'video', gallery[0].src, gallery[0].thumb || '', gallery[0].fallbacks || []);
  }
  if (typeof initGameCollapsibles === 'function') initGameCollapsibles(wrap);
  window.__currentGamePage = g;
  window.__currentGameBuilds = data.builds || [];
  initBuyButton(wrap, g);
  initRateStars(wrap, g);
  renderCommentsThreaded(data.comments || [], data.viewer, g.id);
  initCommentForm(g, data.viewer);
  initBuildButtons(wrap, g);
  initReviewSort(data.comments || [], data.viewer, g.id);
  loadSimilarGames(g);
  bindAdminGameEdit(g, viewer);

  // description toggle + автоплей зацикленных видео в «Об игре»
  const desc = $('#gp-description');
  const tog = $('#gp-desc-toggle');
  if (desc) {
    $$('video', desc).forEach(v => {
      v.muted = true;
      v.defaultMuted = true;
      v.loop = true;
      v.playsInline = true;
      v.removeAttribute('controls');
      const tryPlay = () => v.play().catch(() => {});
      if (v.readyState >= 2) tryPlay();
      else v.addEventListener('loadeddata', tryPlay, { once: true });
    });
  }
  if (desc && tog) {
    const needsToggle = desc.scrollHeight > 320;
    if (!needsToggle) {
      desc.classList.remove('gp-description--collapsed');
      tog.classList.add('hidden');
    } else {
      tog.addEventListener('click', () => {
        const open = desc.classList.toggle('gp-description--collapsed');
        tog.textContent = open ? 'Показать больше' : 'Показать меньше';
      });
    }
  }

  // side card collapse (как в профиле)
  prepareAccordions(wrap);
  $$('.gp-side-head', wrap).forEach(btn => {
    if (btn.dataset.boundSideAnim === '1') return;
    btn.dataset.boundSideAnim = '1';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('.gp-side-card') || btn.parentElement;
      if (!card) return;
      const body = card.querySelector('.gp-side-body');
      if (!body) {
        card.classList.toggle('collapsed');
        return;
      }
      const collapsed = animateAccordion(card, body, 'collapsed');
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });
  });

  const shareBtn = $('#gp-share', wrap);
  if (shareBtn) {
    const pinSvgOpen = `${icon('trophy', 16)}`;
    const pinSvgDone = `${icon('trophy', 16)}`;
    const applyPinUi = (pinned) => {
      shareBtn.classList.toggle('is-pinned', !!pinned);
      shareBtn.title = pinned ? 'Открепить' : 'Закрепить';
      shareBtn.innerHTML = pinned ? pinSvgDone : pinSvgOpen;
      shareBtn.dataset.pinned = pinned ? '1' : '0';
    };
    applyPinUi(!!(+g.is_pinned));
    shareBtn.addEventListener('click', async () => {
      if (!window.AUTH_STATE || !window.AUTH_STATE.authorized) {
        toast('Войди в аккаунт, чтобы закрепить игру');
        return;
      }
      if (!g.owned) {
        toast('Сначала добавь игру в библиотеку');
        return;
      }
      const currentlyPinned = shareBtn.dataset.pinned === '1' || !!(+g.is_pinned);
      const nextPinned = !currentlyPinned;
      // мгновенно меняем кнопку
      applyPinUi(nextPinned);
      shareBtn.disabled = true;
      try {
        const res = await postJSON(`${USER_API}?action=pin`, {
          game_id: +g.id,
          pinned: nextPinned ? 1 : 0,
        });
        if (!res.ok) throw new Error(res.error || 'Ошибка');
        g.is_pinned = nextPinned ? 1 : 0;
        if (Array.isArray(profileLibraryCache)) {
          const item = profileLibraryCache.find(x => +x.id === +g.id);
          if (item) {
            item.is_pinned = g.is_pinned;
            item.pinned_order = nextPinned ? Date.now() : 0;
          }
        }
        if (Array.isArray(sideLibCache)) {
          const item = sideLibCache.find(x => +x.id === +g.id);
          if (item) item.is_pinned = g.is_pinned;
        }
        toast(nextPinned ? 'Игра закреплена' : 'Игра откреплена');
      } catch (e) {
        applyPinUi(currentlyPinned); // откат
        toast(e.message || 'Не удалось изменить закрепление');
      } finally {
        shareBtn.disabled = false;
      }
    });
  }
  const likeBtn = $('#gp-like', wrap);
  if (likeBtn) {
    likeBtn.addEventListener('click', async () => {
      if (!window.AUTH_STATE || !window.AUTH_STATE.authorized) {
        toast('Войди в аккаунт, чтобы лайкнуть игру');
        return;
      }
      if (!g.owned) {
        toast('Сначала добавь игру в библиотеку');
        return;
      }
      const was = !!(g.is_liked || g.liked);
      likeBtn.disabled = true;
      try {
        const res = await postJSON(`${USER_API}?action=like`, {
          game_id: +g.id,
          liked: was ? 0 : 1,
        });
        if (!res.ok) throw new Error(res.error || 'Ошибка');
        g.is_liked = was ? 0 : 1;
        g.liked = !was;
        likeBtn.classList.toggle('liked', g.liked);
        likeBtn.title = g.liked ? 'Убрать лайк' : 'Лайк — поднять в библиотеке';
        if (Array.isArray(sideLibCache)) {
          const item = sideLibCache.find(x => +x.id === +g.id);
          if (item) {
            item.is_liked = g.is_liked;
            item.liked = g.liked;
            item.liked_at = g.liked ? new Date().toISOString() : null;
          }
          renderSideLibrary();
        } else {
          loadSideLibrary();
        }
        toast(g.liked ? 'Лайк! Игра поднята в «Моя библиотека»' : 'Лайк снят');
      } catch (err) {
        toast(err.message || 'Не удалось');
      } finally {
        likeBtn.disabled = false;
      }
    });
  }
    $('#gp-cloud-saves')?.addEventListener('click', () => toast('Облачные сохранения скоро'));
  $('#gp-settings')?.addEventListener('click', () => {
    if (wrap._gameData) {
      openGameAssetsModal(wrap._gameData);
    } else {
      toast('Данные игры ещё не загружены');
    }
  });
  // скриншоты сообщества = медиа мастерской по этой игре
  loadGameCommunityMedia(g.id);
}

function mediaCoverUrl(m) {
  if (!m) return '';
  const pick = (v) => {
    if (!v) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'object') return String(v.url || v.src || v.thumb || '').trim();
    return '';
  };
  let u = pick(m.image_url) || pick(m.cover_url) || pick(m.thumb_url) || pick(m.thumbnail);
  if (u) return u;
  let imgs = m.images_list || m.images || m.files || null;
  if (typeof imgs === 'string') {
    try { imgs = JSON.parse(imgs); } catch (e) {
      // иногда одна строка-путь без JSON
      if (imgs.includes('/') || imgs.startsWith('uploads')) return imgs.trim();
      imgs = null;
    }
  }
  if (Array.isArray(imgs) && imgs.length) {
    for (const it of imgs) {
      const x = pick(it);
      if (x) return x;
    }
  }
  return '';
}

async function loadGameCommunityMedia(gameId) {
  const body = document.getElementById('gp-comm-body');
  const card = document.getElementById('gp-comm-card') || (body && body.closest('.gp-side-card'));
  const hideCard = () => {
    if (card) {
      card.style.display = 'none';
      card.setAttribute('hidden', '');
    } else if (body) {
      body.innerHTML = '';
    }
  };
  const showCard = () => {
    if (card) {
      card.style.display = '';
      card.removeAttribute('hidden');
    }
  };
  if (!body) return;
  gameId = +gameId || 0;
  if (!gameId) {
    hideCard();
    return;
  }
  try {
    const data = await fetchJSON((typeof WS_API !== 'undefined' ? WS_API : (window.WS_API || 'api/workshop.php')) + '?action=media&game_id=' + gameId + '&limit=6');
    const list = (data && data.ok && Array.isArray(data.media)) ? data.media : [];
    if (!list.length) {
      hideCard();
      return;
    }
    showCard();
    const shots = list.slice(0, 3).map(m => {
      const src = mediaCoverUrl(m);
      if (!src) return '';
      const likes = m.likes || m.like_count || 0;
      return `<button type="button" class="gp-comm-shot" data-media-id="${m.id}" data-src="${escapeHtml(src)}">
        <img src="${escapeHtml(src)}" alt="${escapeHtml(m.title || '')}" loading="lazy" />
        <span class="gp-comm-meta">${iconSvg('heart',12)} ${likes}</span>
      </button>`;
    }).filter(Boolean).join('');
    body.innerHTML = `
      <div class="gp-comm-shots">${shots}</div>
      <button type="button" class="gp-side-more" id="gp-comm-more">Показать все</button>`;
    body.querySelectorAll('.gp-comm-shot').forEach(btn => {
      btn.addEventListener('click', () => {
        const mid = +btn.dataset.mediaId;
        if (mid && typeof openWorkshopMediaView === 'function') openWorkshopMediaView(mid);
        else if (btn.dataset.src && typeof openLightbox === 'function') openLightbox(btn.dataset.src);
      });
    });
    const more = document.getElementById('gp-comm-more');
    if (more) {
      more.addEventListener('click', () => {
        if (typeof openWorkshopGame === 'function') openWorkshopGame(gameId, 'media');
        else if (typeof showView === 'function') showView('workshop');
      });
    }
  } catch (e) {
    hideCard();
  }
}

function brandLogoHtml(kind, title, svgFallback) {
  // PNG из web/assets/controllers/{xbox,playstation,switch,keyboard}.png
  // Если файла нет — onerror покажет SVG-фолбэк
  const src = `assets/controllers/${kind}.png`;
  return `<span class="gp-ctrl-ico" title="${title}">
    <img class="gp-brand-logo gp-brand-logo--img" src="${src}" alt="${title}" width="28" height="28"
      onerror="this.onerror=null;this.style.display='none';const f=this.nextElementSibling;if(f)f.style.display='inline-flex';" />
    <span class="gp-brand-logo-fallback" style="display:none">${svgFallback}</span>
  </span>`;
}

function renderControllerSupport(raw) {
  const s = String(raw || '').trim().toLowerCase();
  // пусто / none / 0 / «нет» — блок на странице не показываем
  if (!s || s === 'none' || s === '0' || s === 'нет' || s === 'no' || s === 'false' || s === '-') {
    return '';
  }
  const hasX = /xbox|xinput/.test(s);
  const hasP = /playstation|dualshock|dualsense|ps4|ps5|\bps\b/.test(s);
  const hasSw = /switch|nintendo/.test(s);
  const hasKb = /keyboard|клавиатур|mouse|мышь/.test(s);
  const hasAny = hasX || hasP || hasSw || hasKb || !!s;
  if (!hasAny) {
    return '';
  }
  const full = /full|полная|complete/.test(s) || (hasX && hasP);
  const icoXboxSvg = `${icon('brand-1', 28, 'gp-brand-logo')}`;
  const icoPSSvg = `${icon('brand-2', 28, 'gp-brand-logo')}`;
  const icons = [];
  if (hasX || (!hasP && !hasSw && !hasKb && hasAny)) icons.push(brandLogoHtml('xbox', 'Xbox', icoXboxSvg));
  if (hasP || (!hasX && !hasSw && !hasKb && hasAny)) icons.push(brandLogoHtml('playstation', 'PlayStation', icoPSSvg));
  if (hasSw) icons.push(brandLogoHtml('switch', 'Switch', icoXboxSvg));
  if (hasKb) icons.push(brandLogoHtml('keyboard', 'Клавиатура', icoXboxSvg));
  if (!icons.length) {
    icons.push(brandLogoHtml('xbox', 'Xbox', icoXboxSvg));
    icons.push(brandLogoHtml('playstation', 'PlayStation', icoPSSvg));
  }
  return `
    <div class="gp-ctrl-icons">
      ${icons.join('')}
    </div>
    <div class="gp-ctrl-badge ${full ? 'full' : 'partial'}">${full ? 'ПОЛНАЯ ПОДДЕРЖКА' : 'ЧАСТИЧНАЯ ПОДДЕРЖКА'}</div>
    <p class="gp-ctrl-note">${full ? 'Отлично работает с контроллерами Xbox и PlayStation.' : (escapeHtml(raw) || 'Поддержка контроллера заявлена.')}</p>`;
}


// актуальный список отзывов на странице игры (для сортировки без потери данных)
window.__gameComments = window.__gameComments || { list: [], viewer: null, gameId: 0 };

function renderCommentsThreaded(comments, viewer, gameId) {
  const box = $('#comments-list');
  if (!box) return;

  // всегда держим свежий список
  if (Array.isArray(comments)) {
    window.__gameComments = {
      list: comments.slice(),
      viewer: viewer || (window.__gameComments && window.__gameComments.viewer) || null,
      gameId: gameId != null ? gameId : ((window.__gameComments && window.__gameComments.gameId) || 0)
    };
  } else if (window.__gameComments && Array.isArray(window.__gameComments.list)) {
    comments = window.__gameComments.list;
    viewer = viewer || window.__gameComments.viewer;
    gameId = gameId != null ? gameId : window.__gameComments.gameId;
  }

  // скрыть/показать форму корневого отзыва
  const formWrap = $('#comment-form-wrap');
  const uid = viewer && viewer.user_id ? +viewer.user_id : null;
  const myRoot = uid ? (comments || []).find(c => +c.user_id === uid && !(+c.parent_id > 0)) : null;
  if (formWrap) {
    formWrap.classList.toggle('hidden', !!myRoot);
    const sep = formWrap.nextElementSibling;
    if (sep && sep.classList.contains('gp-reviews-separator')) {
      sep.classList.toggle('hidden', !!myRoot);
    }
  }

  if (!comments || !comments.length) {
    box.innerHTML = `
      <div class="gp-empty-reviews">
        <div class="gp-empty-title">Пока нет отзывов</div>
        <div class="gp-empty-sub">Станьте первым, кто поделится мыслями об этой игре!</div>
      </div>`;
    return;
  }
  const byParent = {};
  const roots = [];
  comments.forEach(c => {
    const pid = c.parent_id != null && +c.parent_id > 0 ? +c.parent_id : 0;
    if (!pid) roots.push(c);
    else {
      if (!byParent[pid]) byParent[pid] = [];
      byParent[pid].push(c);
    }
  });
  // сортировка корней по активной кнопке
  const activeSort = document.querySelector('.gp-sort-opt.active');
  const mode = (activeSort && activeSort.dataset.sort) || 'new';
  if (mode === 'old') roots.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  else if (mode === 'score') roots.sort((a, b) => (b.rating||b.user_rating||0) - (a.rating||a.user_rating||0) || new Date(b.created_at) - new Date(a.created_at));
  else if (mode === 'popular') roots.sort((a, b) => ((b.likes||0)-(b.dislikes||0)) - ((a.likes||0)-(a.dislikes||0)) || new Date(b.created_at) - new Date(a.created_at));
  else roots.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  Object.keys(byParent).forEach(k => {
    byParent[k].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  });

  const renderOne = (c, depth) => {
    const hasCustomAv = !!c.avatar_url;
    const letter = (c.avatar || (c.username || '?').slice(0, 1) || '?').toString().slice(0, 1).toUpperCase();
    const avColor = c.avatar_color || '#ef5b2c';
    const avStyle = hasCustomAv
      ? `background-image:url('${escapeHtml(c.avatar_url)}');background-size:cover;background-position:center;`
      : `background:${escapeHtml(avColor)};color:#12110e;`;
    const kids = byParent[c.id] || [];
    const rating = (c.rating != null && c.rating !== '') ? c.rating : ((c.user_rating != null && c.user_rating !== '') ? c.user_rating : null);
    const playH = (c.playtime_hours != null && c.playtime_hours !== '')
      ? c.playtime_hours
      : (c.playtime_minutes != null && +c.playtime_minutes > 0 ? Math.max(1, Math.round(+c.playtime_minutes / 60)) : null);
    const likes = c.likes || c.like_count || 0;
    const dislikes = c.dislikes || c.dislike_count || 0;
    const banner = c.profile_banner || c.banner_url || '';
    // всегда фон шапки: картинка или цвет оформления
    const bannerStyle = banner
      ? `background-image:url('${escapeHtml(banner)}');background-size:cover;background-position:center;`
      : `background: linear-gradient(135deg, ${escapeHtml(avColor)}55 0%, ${escapeHtml(avColor)}22 50%, rgba(18,17,14,0.9) 100%); border: 1px solid ${escapeHtml(avColor)}44;`;
    const showBanner = true;
    const isMine = uid && +c.user_id === uid;
    const isRoot = !(c.parent_id > 0);

    return `
      <div class="gp-review ${depth ? 'is-reply' : ''} has-banner" data-id="${c.id}">
        <div class="gp-review-main">
          <div class="gp-review-headcard with-banner">
            <div class="gp-review-banner" style="${bannerStyle}"></div>
            <div class="gp-review-headcard-inner">
              <div class="gp-review-av ${hasCustomAv ? 'has-img' : 'is-letter'}" style="${avStyle}">
                ${hasCustomAv ? '' : escapeHtml(letter)}
              </div>
              <div class="gp-review-userblock">
                <div class="gp-review-name-row">
                  <button type="button" class="gp-review-name" data-profile-user="${escapeHtml(c.username)}" data-profile-id="${c.user_id || ''}">${escapeHtml(c.username)}</button>
                </div>
                <div class="gp-review-meta-row">
                  ${rating != null ? `<span class="gp-review-score">${iconSvg('star',12)} ${escapeHtml(String(rating))}/5</span>` : ''}
                  ${playH != null ? `<span class="gp-review-playtime">${iconSvg('clock',12)} ${playH} часов</span>` : ''}
                </div>
              </div>
              <span class="gp-review-time">${escapeHtml(formatRelative(c.created_at))}</span>
            </div>
          </div>
          <div class="gp-review-content">
            <div class="gp-review-text">${escapeHtml(c.body)}</div>
            <div class="gp-review-actions">
              <button type="button" class="gp-vote" data-vote="up" data-id="${c.id}" title="Нравится">${iconSvg('thumbsUp',14)} <span>${likes}</span></button>
              <button type="button" class="gp-vote" data-vote="down" data-id="${c.id}" title="Не нравится">${iconSvg('thumbsDown',14)} <span>${dislikes}</span></button>
              ${viewer && viewer.authorized ? `<button type="button" class="gp-reply-btn" data-reply="${c.id}" data-user="${escapeHtml(c.username)}">${iconSvg('reply',14)} Ответить</button>` : ''}
              ${isMine && isRoot ? `<button type="button" class="gp-del-btn" data-del="${c.id}">${iconSvg('trash',14)} Удалить отзыв</button>` : ''}
              ${isMine && !isRoot ? `<button type="button" class="gp-del-btn" data-del="${c.id}">${iconSvg('trash',14)} Удалить</button>` : ''}
            </div>
            <div class="gp-inline-reply hidden" data-inline-for="${c.id}"></div>
          </div>
        </div>
        ${kids.length ? `
          <div class="gp-review-replies">
            ${kids.map(k => renderOne(k, depth + 1)).join('')}
          </div>` : ''}
      </div>`;
  };

  box.innerHTML = roots.map(c => renderOne(c, 0)).join('');

  // vote stubs
  $$('.gp-vote', box).forEach(btn => {
    btn.addEventListener('click', () => toast('Голосование скоро'));
  });

  // inline reply
  $$('.gp-reply-btn', box).forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.reply;
      // close other inlines
      $$('.gp-inline-reply', box).forEach(el => {
        el.classList.add('hidden');
        el.innerHTML = '';
      });
      const slot = box.querySelector(`.gp-inline-reply[data-inline-for="${id}"]`);
      if (!slot) return;
      slot.classList.remove('hidden');
      slot.innerHTML = `
        <div class="gp-inline-reply-box">
          <textarea class="gp-inline-input" maxlength="1000" rows="3" placeholder="Написать ответ..."></textarea>
          <div class="gp-inline-actions">
            <button type="button" class="gp-inline-cancel">Отмена</button>
            <button type="button" class="gp-inline-send">Отправить</button>
          </div>
        </div>`;
      const ta = slot.querySelector('.gp-inline-input');
      ta?.focus();
      slot.querySelector('.gp-inline-cancel')?.addEventListener('click', () => {
        slot.classList.add('hidden');
        slot.innerHTML = '';
      });
      slot.querySelector('.gp-inline-send')?.addEventListener('click', async () => {
        const text = (ta?.value || '').trim();
        if (!text) { toast('Напишите текст ответа'); return; }
        const sendBtn = slot.querySelector('.gp-inline-send');
        if (sendBtn) sendBtn.disabled = true;
        try {
          const gid = gameId || (currentGame && currentGame.game && currentGame.game.id);
          const data = await postJSON(`${API_BASE}?action=comment`, {
            game_id: gid,
            body: text,
            parent_id: +id
          });
          if (!data.ok) throw new Error(data.error || 'Не удалось отправить');
          const page = await fetchJSON(`${API_BASE}?action=get&id=${gid}`);
          if (page.ok) {
            renderCommentsThreaded(page.comments || [], page.viewer || viewer, gid);
            const count = $('#comments-count');
            if (count) count.textContent = (page.comments || []).length;
          }
          toast('Ответ опубликован');
        } catch (err) {
          toast(err.message || 'Ошибка');
          if (sendBtn) sendBtn.disabled = false;
        }
      });
    });
  });

  // delete
  $$('.gp-del-btn', box).forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Удалить?')) return;
      try {
        const data = await postJSON(`${API_BASE}?action=delete_comment`, { comment_id: +btn.dataset.del });
        if (!data.ok) throw new Error(data.error || 'Не удалось удалить');
        const gid = gameId || (currentGame && currentGame.game && currentGame.game.id);
        const page = await fetchJSON(`${API_BASE}?action=get&id=${gid}`);
        if (page.ok) {
          renderCommentsThreaded(page.comments || [], page.viewer || viewer, gid);
          const count = $('#comments-count');
          if (count) count.textContent = (page.comments || []).length;
        }
        toast('Удалено');
      } catch (err) {
        toast(err.message || 'Ошибка');
      }
    });
  });

  // ник → профиль
  $$('.gp-review-name[data-profile-user]', box).forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const uname = btn.dataset.profileUser;
      const id = btn.dataset.profileId ? +btn.dataset.profileId : null;
      if (typeof openUserProfile === 'function') openUserProfile(uname, id);
      else toast('Профиль: ' + uname);
    });
  });
}

function initReviewSort(comments, viewer, gameId) {
  if (Array.isArray(comments)) {
    window.__gameComments = {
      list: comments.slice(),
      viewer: viewer || null,
      gameId: gameId != null ? gameId : (window.__gameComments && window.__gameComments.gameId) || 0
    };
  }
  const sortBtns = () => $$('.gp-sort-opt');
  sortBtns().forEach(btn => {
    if (btn.dataset.sortBound === '1') return;
    btn.dataset.sortBound = '1';
    btn.addEventListener('click', () => {
      sortBtns().forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const store = window.__gameComments || { list: [], viewer: null, gameId: 0 };
      const list = [...(store.list || [])];
      const mode = btn.dataset.sort;
      // только корневые для порядка, ответы остаются привязаны в renderCommentsThreaded
      const roots = list.filter(c => !(+c.parent_id > 0));
      const replies = list.filter(c => +c.parent_id > 0);
      if (mode === 'new') roots.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
      else if (mode === 'old') roots.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
      else if (mode === 'score') roots.sort((a,b) => (b.rating||b.user_rating||0) - (a.rating||a.user_rating||0) || new Date(b.created_at) - new Date(a.created_at));
      else if (mode === 'popular') roots.sort((a,b) => ((b.likes||0)-(b.dislikes||0)) - ((a.likes||0)-(a.dislikes||0)) || new Date(b.created_at) - new Date(a.created_at));
      const sorted = roots.concat(replies);
      renderCommentsThreaded(sorted, store.viewer || viewer, store.gameId || gameId);
    });
  });
}

async function loadSimilarGames(game) {
  const grid = $('#gp-similar') || $('#gp-similar-grid');
  if (!grid) return;
  try {
    const data = await fetchJSON(`${API_BASE}?action=list&category=game`);
    if (!data.ok) throw new Error();
    let list = (data.games || []).filter(g => +g.id !== +game.id);

    // Shuffle — при каждой перезагрузке другой набор
    const shuffle = (arr) => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    let same = [];
    let other = list;
    if (game.genre) {
      same = shuffle(list.filter(g => g.genre === game.genre));
      other = shuffle(list.filter(g => g.genre !== game.genre));
    } else {
      other = shuffle(list);
    }
    list = [...same, ...other].slice(0, 4); // максимум 4

    if (!list.length) {
      grid.innerHTML = '<div class="gp-empty-sub">Пока нет похожих игр</div>';
      return;
    }
    grid.innerHTML = list.map(g => `
      <button type="button" class="gp-similar-card" data-id="${g.id}" title="${escapeHtml(g.title)}">
        <img src="${escapeHtml(g.cover_src || g.cover_url || ('media.php?type=cover&id=' + g.id))}" alt="${escapeHtml(g.title)}" loading="lazy" />
      </button>`).join('');
    $$('.gp-similar-card', grid).forEach(card => {
      card.addEventListener('click', () => gotoGame(card.dataset.id));
    });
  } catch (e) {
    grid.innerHTML = '<div class="gp-empty-sub">Не удалось загрузить</div>';
  }
}


