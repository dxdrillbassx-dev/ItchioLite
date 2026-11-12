/**
 * CATio / ItchioLite — патч UI/багов v2 (подключать ПОСЛЕ app.js)
 *
 * 1) SGDB: выбор icon/logo/banner/cover
 * 2) Боковая библиотека: иконка не кэшируется от другой игры
 * 3) Моды: Установить → Установка… → Удалить только после успеха
 * 4) Превью фото при выборе файлов
 * 5) Скрыть «Сборка и файл» в редактировании/модерации
 * 6) Скриншоты сообщества: отступы
 * 7) Профиль → скриншоты: прятать empty-state когда есть карточки
 *
 * <script src="js/app.js"></script>
 * <script src="js/catio_fixes.js"></script>
 */
(function () {
  'use strict';

  function toast(msg) {
    if (typeof window.toast === 'function') window.toast(msg);
    else console.log('[CATio]', msg);
  }

  // ---------- inject CSS ----------
  (function injectCss() {
    if (document.getElementById('catio-fixes-css')) return;
    const s = document.createElement('style');
    s.id = 'catio-fixes-css';
    s.textContent = `
      .gp-side-body > .acc-inner,
      #gp-comm-body,
      #gp-comm-body .acc-inner {
        padding: 12px 14px 14px !important;
        box-sizing: border-box;
      }
      .gp-ach-empty { padding: 4px 2px 6px !important; display: block; }
      .gp-comm-shots {
        display: grid !important;
        grid-template-columns: 1fr 1fr !important;
        gap: 10px !important;
        margin: 0 0 8px !important;
      }
      .gp-comm-shot { border-radius: 8px !important; overflow: hidden; position: relative; }
      .gp-side-more { margin-top: 10px !important; }

      /* likes badge: only top-right, no left/bottom */
      #gp-comm-body .gp-comm-meta,
      .gp-comm-meta {
        left: auto !important;
        bottom: auto !important;
        top: 6px !important;
        right: 6px !important;
      }

      /* hide legacy wide preview box in media upload */
      #ws-media-files-preview.pub-file-preview,
      #ws-media-form-modal .pub-file-preview--wide {
        display: none !important;
      }

      /* profile shot game icon badge */
      .hp-shot-card { position: relative; }
      .hp-shot-game-ico {
        position: absolute; top: 6px; right: 6px;
        width: 28px; height: 28px; border-radius: 7px;
        overflow: hidden; border: 1px solid rgba(255,255,255,0.25);
        background: rgba(0,0,0,0.55); box-shadow: 0 2px 8px rgba(0,0,0,0.35);
        pointer-events: none;
      }
      .hp-shot-game-ico img {
        width: 100%; height: 100%; object-fit: cover; display: block;
      }

      .catio-file-list { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
      .catio-file-card {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 12px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 10px; max-width: 100%; min-width: 0;
      }
      .catio-file-card img {
        width: 52px; height: 52px; object-fit: cover;
        border-radius: 8px; flex-shrink: 0; background: #111;
      }
      .catio-file-card .meta { min-width: 0; overflow: hidden; }
      .catio-file-card .meta .name {
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        font-weight: 600; font-size: 12px;
      }
      .catio-file-card .meta .size { opacity: .65; font-size: 11px; margin-top: 2px; }

      #sg-shots-preview, .catio-shots-preview {
        display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px;
      }
      .catio-shot-thumb {
        width: 72px; height: 48px; border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.1); overflow: hidden; background: #111;
      }
      .catio-shot-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }

      body.catio-hide-builds #sg-builds-section { display: none !important; }

      #hp-screenshots-grid.hp-screenshots-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 12px; padding: 4px 0 16px;
      }
      #hp-screenshots-grid .hp-shot-card {
        border-radius: 10px; border: 1px solid rgba(255,255,255,0.08);
        aspect-ratio: 16/10; overflow: hidden; padding: 0; background: #121212;
      }
      #hp-screenshots-grid .hp-shot-card img {
        width: 100%; height: 100%; object-fit: cover; display: block;
      }
      #hp-pane-screenshots.has-shots #hp-screenshots-empty { display: none !important; }
      #hp-pane-screenshots.has-shots #hp-screenshots-grid { display: grid !important; }
      /* Close button: square like other modals (not round) */
      #submit-form-modal .pub-modal-close,
      #submit-form-modal.pub-modal-box .pub-modal-close,
      .submit-modal#submit-form-modal .pub-modal-close {
        width: 36px !important;
        height: 36px !important;
        border-radius: 8px !important;
        background: transparent !important;
        color: var(--text-muted, #999) !important;
        font-size: inherit !important;
        padding: 0 !important;
      }
      #submit-form-modal .pub-modal-close:hover {
        background: rgba(255,255,255,0.08) !important;
        color: var(--text-bright, #fff) !important;
      }

    `;
    document.head.appendChild(s);
  })();

  // ---------- 1) SGDB selection (capture phase) ----------
  document.addEventListener('click', function (e) {
    const item = e.target && e.target.closest && e.target.closest('.sgdb-grid-item');
    if (!item) return;
    const url = item.getAttribute('data-url') || '';
    if (!url) return;

    const grid = item.closest('.sgdb-asset-grid, #sgdb-asset-grid, #sgdb-grid, .sgdb-grid');
    let type = 'icons';
    if (grid) {
      const m = String(grid.className || '').match(/is-(icons|logos|heroes|grids|covers)/);
      if (m) type = m[1];
    }
    const tab = document.querySelector('.sgdb-asset-tab.active');
    if (tab && tab.dataset.assetType) type = tab.dataset.assetType;

    if (grid) {
      grid.querySelectorAll('.sgdb-grid-item').forEach((b) => b.classList.remove('selected'));
      item.classList.add('selected');
    }

    const fieldMap = {
      icons: ['icon_url', 'steam-sel-icon'],
      icon: ['icon_url', 'steam-sel-icon'],
      logos: ['logo_url', 'steam-sel-logo'],
      logo: ['logo_url', 'steam-sel-logo'],
      heroes: ['banner_url', 'steam-sel-banner'],
      banner: ['banner_url', 'steam-sel-banner'],
      grids: ['cover_url', 'steam-sel-cover'],
      covers: ['cover_url', 'steam-sel-cover'],
      cover: ['cover_url', 'steam-sel-cover'],
    };
    const conf = fieldMap[type] || fieldMap.icons;
    try {
      const st = window.getSteamAssetState && window.getSteamAssetState();
      if (st && st.steamSelected) st.steamSelected[conf[0]] = url;
    } catch (err) {}
    const hid = document.getElementById(conf[1]);
    if (hid) hid.value = url;

    const img = document.getElementById('sgdb-asset-preview-img');
    if (img) img.src = url;
    const wrap = document.getElementById('sgdb-asset-preview');
    if (wrap) {
      wrap.classList.remove('is-hero', 'is-grid', 'is-logo');
      if (type === 'heroes') wrap.classList.add('is-hero');
      if (type === 'grids' || type === 'covers') wrap.classList.add('is-grid');
      if (type === 'logos') wrap.classList.add('is-logo');
    }
    const hint = document.getElementById('sgdb-asset-save-hint');
    if (hint) {
      const get = (id) => (document.getElementById(id) || {}).value || '';
      const parts = [];
      if (get('steam-sel-icon')) parts.push('иконка');
      if (get('steam-sel-logo')) parts.push('логотип');
      if (get('steam-sel-banner')) parts.push('баннер');
      if (get('steam-sel-cover')) parts.push('обложка');
      if (parts.length) {
        hint.textContent = 'Выбрано: ' + parts.join(', ');
        hint.classList.add('has-sel');
      }
    }
    try {
      if (typeof window.selectSgdbAsset === 'function') window.selectSgdbAsset(url, type);
    } catch (err) {}
  }, true);

  // ---------- 2) Side library icons ----------
  function fixSideLibIcons() {
    const list = document.getElementById('side-lib-list');
    if (!list) return;
    const byId = {};
    try {
      (window.sideLibCache || []).forEach((g) => { if (g && g.id) byId[String(g.id)] = g; });
      (window.libraryCache || []).forEach((g) => { if (g && g.id) byId[String(g.id)] = g; });
      (window.profileLibraryCache || []).forEach((g) => { if (g && g.id) byId[String(g.id)] = g; });
    } catch (e) {}
    list.querySelectorAll('.side-lib-item[data-id]').forEach((btn) => {
      const id = btn.getAttribute('data-id');
      const img = btn.querySelector('img');
      if (!id || !img) return;
      const g = byId[String(id)] || {};
      const v = String(window.__iconBust || window.__mediaBust || Date.now()) + '-' + id;
      // 1) прямой icon_url / icon_src (не media.php, не cover)
      let direct = (g.icon_url || g.icon_src || '').trim();
      if (direct && /media\.php\?type=(cover|hero)/i.test(direct)) direct = '';
      if (direct && !/media\.php\?type=icon/i.test(direct)) {
        const url = direct + (direct.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(v);
        if ((img.getAttribute('src') || '') !== url) img.setAttribute('src', url);
        img.onerror = function () {
          this.onerror = null;
          this.src = 'media.php?type=icon&id=' + id + '&v=' + encodeURIComponent(v + '-fb');
        };
        return;
      }
      // 2) media.php?type=icon (уже без Steam library overwrite)
      const want = 'media.php?type=icon&id=' + id + '&v=' + encodeURIComponent(v);
      if ((img.getAttribute('src') || '').indexOf('type=icon&id=' + id) === -1) {
        img.setAttribute('src', want);
      }
      img.onerror = function () {
        this.onerror = null;
        this.style.opacity = '0.35';
      };
    });
  }
  const libObs = new MutationObserver(() => fixSideLibIcons());
  function watchLib() {
    const list = document.getElementById('side-lib-list');
    if (list) libObs.observe(list, { childList: true, subtree: true });
    fixSideLibIcons();
  }

  // ---------- 3) Mods ----------
  function updateModInstallButtonFixed(mod, forceMode) {
    const btn = document.getElementById('ws-modv-install');
    if (!btn || !mod) return;

    if (forceMode === 'installing') {
      btn.dataset.mode = 'installing';
      btn.disabled = true;
      btn.className = 'hp-btn-save ws-modv-install is-busy';
      btn.title = 'Установка…';
      btn.textContent = 'Установка…';
      btn.style.opacity = '0.7';
      btn.style.cursor = 'default';
      return;
    }

    const installed =
      forceMode === 'remove' ? true :
      forceMode === 'install' ? false :
      (typeof isModInstalled === 'function' && isModInstalled(mod.id));

    btn.disabled = false;
    btn.style.opacity = '';
    btn.style.cursor = '';
    btn.dataset.mode = installed ? 'remove' : 'install';
    if (installed) {
      btn.className = 'hp-btn-logout hp-btn-danger ws-modv-install';
      btn.title = 'Удалить';
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Удалить';
    } else {
      btn.className = 'hp-btn-save ws-modv-install';
      btn.title = 'Установить';
      btn.textContent = 'Установить';
    }
  }
  window.updateModInstallButton = updateModInstallButtonFixed;

  window.wsDownloadModFile = async function (mod) {
    if (!mod) return false;
    const url = mod.file_url || window.__wsModvFile || '';
    if (!url) {
      toast('Файл мода недоступен — к моду не прикреплён архив');
      return false;
    }
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const a = document.createElement('a');
      const ext = (url.split('?')[0].match(/\.([a-z0-9]+)$/i) || [, 'zip'])[1];
      const safe = ((mod.title || 'mod').replace(/[^\wа-яА-ЯёЁ\- ]/gi, '').trim().replace(/\s+/g, '-') || 'mod');
      a.href = URL.createObjectURL(blob);
      a.download = safe + '.' + ext;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 8000);
      return true;
    } catch (e) {
      try { window.open(url, '_blank'); return true; } catch (_) {}
      toast(e.message || 'Не удалось скачать мод');
      return false;
    }
  };

  window.handleModInstallClick = async function () {
    const mod = window.__wsModvData;
    if (!mod) return;
    const btn = document.getElementById('ws-modv-install');
    const mode = (btn && btn.dataset.mode) || 'install';
    if (mode === 'installing') return;

    if (mode === 'remove') {
      if (typeof markModInstalled === 'function') markModInstalled(mod.id, false, mod);
      updateModInstallButtonFixed(mod, 'install');
      try {
        const gid = +mod.game_id || 0;
        if (gid && typeof fillGameSettingsMods === 'function') fillGameSettingsMods(gid);
      } catch (e) {}
      toast('Мод удалён');
      return;
    }

    if (!(mod.file_url || window.__wsModvFile)) {
      toast('У этого мода нет файла — установка невозможна');
      return;
    }
    if (typeof userOwnsGameId === 'function' && !userOwnsGameId(mod.game_id)) {
      if (typeof bindModNoGameModal === 'function') bindModNoGameModal();
      if (typeof openModNoGameModal === 'function') openModNoGameModal(mod);
      return;
    }

    updateModInstallButtonFixed(mod, 'installing');
    const ok = await window.wsDownloadModFile(mod);
    if (ok) {
      if (typeof markModInstalled === 'function') markModInstalled(mod.id, true, mod);
      updateModInstallButtonFixed(mod, 'remove');
      try {
        const gid = +mod.game_id || 0;
        if (gid && typeof fillGameSettingsMods === 'function') fillGameSettingsMods(gid);
      } catch (e) {}
      toast('Мод установлен');
    } else {
      updateModInstallButtonFixed(mod, 'install');
    }
  };

  // After openWorkshopModView — re-sync button (don't trust stale early paint)
  function wrapOpenMod() {
    const orig = window.openWorkshopModView;
    if (typeof orig !== 'function' || orig.__catioWrapped) return;
    const wrapped = async function () {
      await orig.apply(this, arguments);
      try {
        const mod = window.__wsModvData;
        if (mod) updateModInstallButtonFixed(mod);
      } catch (e) {}
    };
    wrapped.__catioWrapped = true;
    window.openWorkshopModView = wrapped;
  }

  // ---------- 4) File previews ----------
  function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' Б';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' КБ';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' МБ';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' ГБ';
  }

  function renderFileList(container, files) {
    if (!container) return;
    (container._objUrls || []).forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) {} });
    container._objUrls = [];
    container.innerHTML = '';
    const list = Array.from(files || []);
    if (!list.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'catio-file-list';
    list.forEach((f) => {
      const card = document.createElement('div');
      card.className = 'catio-file-card';
      if (f.type && f.type.startsWith('image/')) {
        try {
          const url = URL.createObjectURL(f);
          container._objUrls.push(url);
          const img = document.createElement('img');
          img.src = url;
          img.alt = '';
          card.appendChild(img);
        } catch (e) {}
      } else {
        const badge = document.createElement('div');
        badge.style.cssText = 'width:52px;height:52px;border-radius:8px;background:rgba(239,91,44,0.15);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#ef5b2c;flex-shrink:0';
        badge.textContent = (f.name.split('.').pop() || 'FILE').toUpperCase().slice(0, 4);
        card.appendChild(badge);
      }
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = '<div class="name"></div><div class="size"></div>';
      meta.querySelector('.name').textContent = f.name || '';
      meta.querySelector('.size').textContent = formatBytes(f.size);
      card.appendChild(meta);
      wrap.appendChild(card);
    });
    container.appendChild(wrap);
  }

  function ensureListEl(afterId, listId) {
    let el = document.getElementById(listId);
    if (el) return el;
    const after = document.getElementById(afterId);
    if (!after || !after.parentNode) return null;
    el = document.createElement('div');
    el.id = listId;
    after.parentNode.insertBefore(el, after.nextSibling);
    return el;
  }

  function bindFileInput(inputId, listId, hintId) {
    const input = document.getElementById(inputId);
    if (!input || input.dataset.catioPreview === '1') return;
    input.dataset.catioPreview = '1';
    input.addEventListener('change', () => {
      const box = document.getElementById(listId) || ensureListEl(hintId || inputId, listId);
      renderFileList(box, input.files);
      if (hintId) {
        const hint = document.getElementById(hintId);
        if (hint && input.files && input.files.length) {
          const names = Array.from(input.files).slice(0, 3).map((f) => f.name).join(', ');
          const more = input.files.length > 3 ? ' +' + (input.files.length - 3) : '';
          hint.textContent = input.files.length + ' файл(ов): ' + names + more;
        }
      }
    });
  }

  function bindPublishImagePreviews() {
    [
      ['sg-cover', 'sg-cover-preview', 'sg-cover-name'],
      ['sg-banner', 'sg-banner-preview', 'sg-banner-name'],
      ['sg-logo', 'sg-logo-preview', 'sg-logo-name'],
      ['sg-icon', 'sg-icon-preview', 'sg-icon-name'],
    ].forEach(([inputId, prevId, nameId]) => {
      const input = document.getElementById(inputId);
      if (!input || input.dataset.catioImgPrev === '1') return;
      input.dataset.catioImgPrev = '1';
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        const prev = document.getElementById(prevId);
        const nameEl = document.getElementById(nameId);
        if (!file) return;
        if (nameEl) nameEl.textContent = file.name + (file.size ? ' · ' + formatBytes(file.size) : '');
        if (prev && file.type && file.type.startsWith('image/')) {
          try {
            if (prev._objUrl) URL.revokeObjectURL(prev._objUrl);
            const url = URL.createObjectURL(file);
            prev._objUrl = url;
            prev.classList.add('has-img');
            prev.innerHTML = '';
            const img = document.createElement('img');
            img.src = url;
            img.alt = '';
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit';
            prev.appendChild(img);
          } catch (e) {}
        }
      });
    });

    const shots = document.getElementById('sg-shots');
    if (shots && shots.dataset.catioImgPrev !== '1') {
      shots.dataset.catioImgPrev = '1';
      shots.addEventListener('change', () => {
        let box = document.getElementById('sg-shots-preview');
        if (!box) {
          box = document.createElement('div');
          box.id = 'sg-shots-preview';
          box.className = 'catio-shots-preview';
          (shots.parentNode || document.body).appendChild(box);
        }
        (box._objUrls || []).forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) {} });
        box._objUrls = [];
        box.innerHTML = '';
        Array.from(shots.files || []).slice(0, 12).forEach((f) => {
          if (!f.type || !f.type.startsWith('image/')) {
            const chip = document.createElement('div');
            chip.className = 'catio-file-card';
            chip.innerHTML = '<div class="meta"><div class="name"></div><div class="size"></div></div>';
            chip.querySelector('.name').textContent = f.name;
            chip.querySelector('.size').textContent = formatBytes(f.size);
            box.appendChild(chip);
            return;
          }
          const d = document.createElement('div');
          d.className = 'catio-shot-thumb';
          try {
            const url = URL.createObjectURL(f);
            box._objUrls.push(url);
            const img = document.createElement('img');
            img.src = url;
            img.alt = f.name;
            d.appendChild(img);
          } catch (e) {}
          box.appendChild(d);
        });
      });
    }
  }

  function bindAllFilePreviews() {
    ensureListEl('ws-mod-file-hint', 'ws-mod-file-list');
    ensureListEl('ws-media-files-hint', 'ws-media-files-list');
    bindFileInput('ws-mod-file', 'ws-mod-file-list', 'ws-mod-file-hint');
    bindFileInput('ws-media-files', 'ws-media-files-list', 'ws-media-files-hint');
    bindFileInput('sg-build-file', 'sg-build-file-list', 'sg-build-file-name');
    bindPublishImagePreviews();
  }

  // ---------- 5) Hide builds section ----------
  function isEditOrModerationMode() {
    if (window.__steamEditMode) return true;
    if (window.__steamEditGameId) return true;
    if (window.__editGameId) return true;
    const title = document.getElementById('submit-form-title');
    const t = (title && title.textContent) || '';
    if (/редакт|модер|измен/i.test(t)) return true;
    const gid = document.querySelector('#submit-game-form [name="game_id"], #sg-game-id');
    if (gid && gid.value && String(gid.value) !== '0') return true;
    return false;
  }
  function syncBuildsVisibility() {
    const sec = document.getElementById('sg-builds-section');
    const hide = isEditOrModerationMode();
    if (sec) sec.style.display = hide ? 'none' : '';
    document.body.classList.toggle('catio-hide-builds', hide);
  }
  document.addEventListener('click', function (e) {
    const btn = e.target && e.target.closest && e.target.closest('#submit-game-send, #submit-game-save, #pub-save-btn');
    if (!btn) return;
    if (document.body.classList.contains('catio-hide-builds')) {
      const ver = document.getElementById('sg-build-version');
      if (ver && !ver.value.trim()) ver.value = '1.0.0';
    }
  }, true);

  // ---------- 6/7) Community + profile screenshots ----------
  function wrapLoadComm() {
    const orig = window.loadGameCommunityMedia;
    if (typeof orig !== 'function' || orig.__catioWrapped) return;
    const wrapped = async function () {
      await orig.apply(this, arguments);
      const body = document.getElementById('gp-comm-body');
      if (!body) return;
      if (!body.querySelector('.acc-inner')) body.style.padding = '12px 14px 14px';
    };
    wrapped.__catioWrapped = true;
    window.loadGameCommunityMedia = wrapped;
  }

  function syncProfileShotsEmpty() {
    const pane = document.getElementById('hp-pane-screenshots');
    const emptyEl = document.getElementById('hp-screenshots-empty');
    const grid = document.getElementById('hp-screenshots-grid');
    if (!pane || !grid) return;
    const has = grid.querySelectorAll('.hp-shot-card').length > 0;
    if (has) {
      pane.classList.add('has-shots');
      if (emptyEl) {
        emptyEl.classList.add('hidden');
        emptyEl.style.display = 'none';
      }
      grid.classList.remove('hidden');
    } else {
      pane.classList.remove('has-shots');
      if (emptyEl) {
        emptyEl.classList.remove('hidden');
        emptyEl.style.display = '';
      }
    }
  }

  function wrapLoadShots() {
    const orig = window.loadProfileScreenshots;
    if (typeof orig !== 'function' || orig.__catioWrapped) return;
    const wrapped = async function () {
      await orig.apply(this, arguments);
      syncProfileShotsEmpty();
    };
    wrapped.__catioWrapped = true;
    window.loadProfileScreenshots = wrapped;
  }

  const shotsObs = new MutationObserver(() => syncProfileShotsEmpty());
  const uiObs = new MutationObserver(() => {
    syncBuildsVisibility();
    bindAllFilePreviews();
    bindModMediaPreviews();
    watchModals();
    wrapOpenMod();
    wrapLoadComm();
    wrapLoadShots();
    wrapLoadShotsWithGameIcon();
  });

  function boot() {
    watchLib();
    syncBuildsVisibility();
    bindAllFilePreviews();
    bindModMediaPreviews();
    watchModals();
    wrapOpenMod();
    wrapLoadComm();
    wrapLoadShots();
    wrapLoadShotsWithGameIcon();
    uiObs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    const grid = document.getElementById('hp-screenshots-grid');
    if (grid) shotsObs.observe(grid, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();



  // ---------- strict mod installed (NOT from downloads queue) ----------
  function getInstalledModIdsStrict() {
    try {
      const raw = localStorage.getItem('catio_installed_mods');
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    } catch (e) {
      return [];
    }
  }
  window.isModInstalled = function (modId) {
    return getInstalledModIdsStrict().includes(+modId);
  };

  // Override updateModInstallButton again with strict check
  const _updModBtn = window.updateModInstallButton;
  window.updateModInstallButton = function (mod, forceMode) {
    if (typeof _updModBtn === 'function' && forceMode) {
      return _updModBtn(mod, forceMode);
    }
    const btn = document.getElementById('ws-modv-install');
    if (!btn || !mod) return;
    const installed = window.isModInstalled(mod.id);
    btn.disabled = false;
    btn.style.opacity = '';
    btn.style.cursor = '';
    btn.dataset.mode = installed ? 'remove' : 'install';
    if (installed) {
      btn.className = 'hp-btn-logout hp-btn-danger ws-modv-install';
      btn.title = 'Удалить';
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Удалить';
    } else {
      btn.className = 'hp-btn-save ws-modv-install';
      btn.title = 'Установить';
      btn.textContent = 'Установить';
    }
  };

  // One-time: if user never successfully installed via our flow, don't keep stale ids
  // (optional debug helper)
  window.catioClearInstalledMods = function () {
    localStorage.removeItem('catio_installed_mods');
    localStorage.removeItem('catio_game_mods');
    console.log('[CATio] cleared installed mods');
  };

  // ---------- clear catio file previews on modal close ----------
  function clearCatioFilePreviews(root) {
    root = root || document;
    root.querySelectorAll('.catio-file-list, #ws-mod-file-list, #ws-media-files-list, #ws-mod-cover-list, #ws-mod-banner-list, #ws-mod-shots-list, #sg-build-file-list, #sg-shots-preview').forEach((el) => {
      (el._objUrls || []).forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) {} });
      el._objUrls = [];
      el.innerHTML = '';
    });
    // reset file inputs inside open/closing modals
    root.querySelectorAll('input[type="file"]').forEach((inp) => {
      try {
        inp.value = '';
        // allow re-bind previews next open
        delete inp.dataset.catioPreview;
        delete inp.dataset.catioImgPrev;
      } catch (e) {}
    });
    // restore hints
    const hints = {
      'ws-mod-file-hint': 'ZIP / RAR / 7Z, до 500 МБ',
      'ws-media-files-hint': 'До 12 изображений, PNG/JPG/WebP, до 5 МБ каждое',
      'ws-mod-cover-hint': 'до 5 МБ',
      'ws-mod-banner-hint': 'до 5 МБ',
      'ws-mod-shots-hint': 'До 10 шт., до 5 МБ',
      'sg-build-file-name': 'ZIP / EXE / 7z…',
    };
    Object.keys(hints).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = hints[id];
    });
    // clear single-image previews in publish form
    ['sg-cover-preview', 'sg-banner-preview', 'sg-logo-preview', 'sg-icon-preview'].forEach((id) => {
      const prev = document.getElementById(id);
      if (!prev) return;
      if (prev._objUrl) { try { URL.revokeObjectURL(prev._objUrl); } catch (e) {} prev._objUrl = null; }
      prev.classList.remove('has-img');
      // keep placeholder text if empty
      if (!prev.querySelector('img[src^="http"], img[src^="uploads"], img[src^="media"]')) {
        // don't wipe server-side previews for edit mode with remote urls unless input cleared
      }
    });
  }
  window.catioClearFilePreviews = clearCatioFilePreviews;

  // Intercept modal close clicks / class hide
  document.addEventListener('click', function (e) {
    const closer = e.target && e.target.closest && e.target.closest(
      '[data-close-ws-mod-form],[data-close-ws-media-form],[data-close-ws-type],[data-close-create-menu],[data-close-submit],[data-close-steam],.pub-modal-close,.submit-modal-backdrop'
    );
    if (!closer) return;
    const modal = closer.closest('.submit-modal, .modal, [id$="-modal"]') || document;
    setTimeout(() => clearCatioFilePreviews(modal === document ? document : modal), 0);
  }, true);

  // When modal gets .hidden — clear
  const modalHideObs = new MutationObserver((muts) => {
    muts.forEach((m) => {
      const el = m.target;
      if (!(el instanceof HTMLElement)) return;
      if (!el.classList.contains('submit-modal') && !/modal/i.test(el.id || '')) return;
      if (el.classList.contains('hidden')) {
        clearCatioFilePreviews(el);
        // also reset form
        const form = el.querySelector('form');
        if (form) {
          try { form.reset(); } catch (e) {}
        }
      }
    });
  });
  function watchModals() {
    document.querySelectorAll('.submit-modal, [id$="-modal"]').forEach((el) => {
      modalHideObs.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
  }

  // ---------- mod cover/banner/shots → catio-file-card ----------
  function bindModMediaPreviews() {
    [
      ['ws-mod-cover', 'ws-mod-cover-list', 'ws-mod-cover-hint'],
      ['ws-mod-banner', 'ws-mod-banner-list', 'ws-mod-banner-hint'],
      ['ws-mod-shots', 'ws-mod-shots-list', 'ws-mod-shots-hint'],
      ['ws-mod-file', 'ws-mod-file-list', 'ws-mod-file-hint'],
      ['ws-media-files', 'ws-media-files-list', 'ws-media-files-hint'],
    ].forEach(([inputId, listId, hintId]) => {
      const input = document.getElementById(inputId);
      if (!input) return;
      // always re-bind after clear (dataset cleared on close)
      if (input.dataset.catioPreview === '1') return;
      input.dataset.catioPreview = '1';
      // ensure list container after hint
      let box = document.getElementById(listId);
      if (!box) {
        const hint = document.getElementById(hintId) || input;
        box = document.createElement('div');
        box.id = listId;
        (hint.parentNode || input.parentNode).appendChild(box);
      }
      input.addEventListener('change', () => {
        const b = document.getElementById(listId);
        // use renderFileList from outer scope if available
        if (typeof renderFileList === 'function') renderFileList(b, input.files);
        else {
          // fallback minimal
          if (!b) return;
          b.innerHTML = '';
          Array.from(input.files || []).forEach((f) => {
            const d = document.createElement('div');
            d.className = 'catio-file-card';
            d.textContent = f.name;
            b.appendChild(d);
          });
        }
        const hint = document.getElementById(hintId);
        if (hint && input.files && input.files.length) {
          const names = Array.from(input.files).slice(0, 3).map((f) => f.name).join(', ');
          const more = input.files.length > 3 ? ' +' + (input.files.length - 3) : '';
          hint.textContent = input.files.length + ' файл(ов): ' + names + more;
        }
      });
    });
    // hide legacy media preview box
    const legacy = document.getElementById('ws-media-files-preview');
    if (legacy) legacy.style.display = 'none';
  }

  // ---------- profile screenshots: game icon badge ----------
  function decorateProfileShotCards() {
    const grid = document.getElementById('hp-screenshots-grid');
    if (!grid) return;
    grid.querySelectorAll('.hp-shot-card').forEach((card) => {
      if (card.querySelector('.hp-shot-game-ico')) return;
      const gid = card.getAttribute('data-game-id') || card.dataset.gameId;
      // try from media data on window cache
      let gameId = +gid || 0;
      if (!gameId) {
        const mid = +card.getAttribute('data-media-id') || 0;
        // no game id — skip
        if (!gameId) return;
      }
      if (!gameId) return;
      const badge = document.createElement('span');
      badge.className = 'hp-shot-game-ico';
      badge.title = 'Игра';
      const img = document.createElement('img');
      img.alt = '';
      img.src = 'media.php?type=icon&id=' + gameId + '&v=' + (window.__iconBust || gameId);
      img.onerror = function () {
        this.onerror = null;
        this.src = 'media.php?type=cover&id=' + gameId + '&v=' + gameId;
      };
      badge.appendChild(img);
      card.appendChild(badge);
    });
  }

  // Patch loadProfileScreenshots card HTML to include data-game-id + icon
  function wrapLoadShotsWithGameIcon() {
    const orig = window.loadProfileScreenshots;
    if (typeof orig !== 'function' || orig.__catioGameIco) return;
    const wrapped = async function () {
      await orig.apply(this, arguments);
      // After original render, try to re-fetch and decorate using media list attributes
      try {
        const grid = document.getElementById('hp-screenshots-grid');
        if (!grid) return;
        // If cards lack data-game-id, pull from last API via dataset on grid
        // Re-query media for this profile and map id→game_id
        const uid = grid.dataset.shotsFor;
        if (!uid) { decorateProfileShotCards(); return; }
        const data = await fetchJSON('api/workshop.php?action=media&user_id=' + uid + '&limit=48&_t=' + Date.now());
        const list = (data && data.ok && Array.isArray(data.media)) ? data.media : [];
        const byId = {};
        list.forEach((m) => { if (m && m.id) byId[+m.id] = m; });
        grid.querySelectorAll('.hp-shot-card').forEach((card) => {
          const mid = +card.getAttribute('data-media-id') || 0;
          const m = byId[mid];
          if (m && m.game_id) card.setAttribute('data-game-id', String(m.game_id));
          // also store game title on title attr
          if (m && m.game_title) card.title = (m.title || 'Скриншот') + ' · ' + m.game_title;
        });
        decorateProfileShotCards();
      } catch (e) {
        decorateProfileShotCards();
      }
      // empty state
      try {
        const pane = document.getElementById('hp-pane-screenshots');
        const emptyEl = document.getElementById('hp-screenshots-empty');
        const has = grid && grid.querySelectorAll('.hp-shot-card').length > 0;
        if (pane) pane.classList.toggle('has-shots', !!has);
        if (has && emptyEl) { emptyEl.classList.add('hidden'); emptyEl.style.display = 'none'; }
      } catch (e) {}
    };
    wrapped.__catioGameIco = true;
    wrapped.__catioWrapped = true;
    window.loadProfileScreenshots = wrapped;
  }


  


  // ---------- CATioGridDB из ZIP: кэш + восстановление без онлайна ----------
  function packSgdbStorageKey(appid, title) {
    if (appid) return 'catio_pack_sgdb_' + String(appid);
    const t = (title || '').toLowerCase().trim().slice(0, 80);
    return t ? 'catio_pack_sgdb_t_' + t : '';
  }

  function normalizePackSgdb(sg) {
    const out = { icons: [], logos: [], heroes: [], grids: [] };
    const mapKey = { icons: 'icons', logos: 'logos', heroes: 'heroes', covers: 'grids', grids: 'grids' };
    Object.keys(sg || {}).forEach((k) => {
      const dst = mapKey[k] || k;
      if (!out[dst]) out[dst] = [];
      (Array.isArray(sg[k]) ? sg[k] : []).forEach((item) => {
        if (!item) return;
        if (typeof item === 'string') {
          out[dst].push({ url: item, thumb: item });
          return;
        }
        let url = item.url || item.file || '';
        let thumb = item.thumb || url;
        // .ico плохо в <img> — для превью/сохранения предпочитаем thumb png
        if (/\.ico(\?|$)/i.test(url) && thumb && !/\.ico(\?|$)/i.test(thumb)) {
          url = thumb;
        }
        if (!url) return;
        out[dst].push({
          url,
          thumb: thumb || url,
          width: item.width,
          height: item.height,
          file: item.file || '',
        });
      });
    });
    return out;
  }

  function savePackSgdbCache(pack, appid, title) {
    const key = packSgdbStorageKey(appid, title);
    if (!key || !pack) return;
    try {
      localStorage.setItem(key, JSON.stringify({
        at: Date.now(),
        appid: appid || 0,
        title: title || '',
        pack,
      }));
    } catch (e) {}
  }

  function loadPackSgdbCache(appid, title) {
    const keys = [packSgdbStorageKey(appid, title), packSgdbStorageKey(0, title)].filter(Boolean);
    for (const key of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const data = JSON.parse(raw);
        if (data && data.pack) return data.pack;
      } catch (e) {}
    }
    return null;
  }

  function applyPackSgdbToWindow(pack, appid, title) {
    if (!pack) return;
    const norm = normalizePackSgdb(pack);
    window.__packSgdbAssets = norm;
    window.__sgdbAssetsFromPack = norm;
    window.__packSgdbTitle = title || window.__packSgdbTitle || '';
    if (appid) window.__packSteamAppId = appid;
    savePackSgdbCache(norm, appid, title);
  }

  // перехват успешного import_pack: нормализуем icons/logos и кладём в localStorage
  const _origFetch = window.fetch;
  if (!_origFetch.__catioPackWrap) {
    const wrapped = async function (input, init) {
      const res = await _origFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (/game_pack\.php.*import_pack|action=import_pack/i.test(url) || (init && init.body && String(init.body).indexOf('import_pack') >= 0)) {
          const clone = res.clone();
          clone.json().then((data) => {
            if (!data || !data.ok) return;
            const files = data.files || {};
            const game = data.game || {};
            const sg = files.sgdb || {};
            const appid = game.steam_appid || data.steam_appid || 0;
            const title = game.title || '';
            applyPackSgdbToWindow(sg, appid, title);
            // дефолтная иконка если пусто
            setTimeout(() => {
              try {
                const iconHid = document.getElementById('sg-icon-url');
                if (iconHid && !iconHid.value) {
                  const icons = (window.__packSgdbAssets && window.__packSgdbAssets.icons) || [];
                  const best = icons.find((x) => x.url && !/\.ico(\?|$)/i.test(x.url)) || icons[0];
                  if (best && best.url) {
                    iconHid.value = best.url;
                    if (typeof setPubPreviewImg === 'function') setPubPreviewImg('sg-icon-preview', best.url);
                    else {
                      const prev = document.getElementById('sg-icon-preview');
                      if (prev) prev.innerHTML = '<img src="' + best.url + '" alt="" style="width:100%;height:100%;object-fit:cover" />';
                    }
                  }
                }
                const logoHid = document.getElementById('sg-logo-url');
                if (logoHid && !logoHid.value) {
                  const logos = (window.__packSgdbAssets && window.__packSgdbAssets.logos) || [];
                  if (logos[0] && logos[0].url) {
                    logoHid.value = logos[0].url;
                    if (typeof setPubPreviewImg === 'function') setPubPreviewImg('sg-logo-preview', logos[0].url);
                  }
                }
              } catch (e) {}
            }, 100);
          }).catch(() => {});
        }
      } catch (e) {}
      return res;
    };
    wrapped.__catioPackWrap = true;
    window.fetch = wrapped;
  }

  // при открытии модалки ассетов — восстановить пакет из localStorage
  function ensurePackSgdbLoaded() {
    if (window.__packSgdbAssets && (window.__packSgdbAssets.icons || []).length) return true;
    const g = window.__steamEditGameData || window.__lastGameForCart || null;
    const appid = (g && g.steam_appid) || window.__packSteamAppId || 0;
    const title = (g && g.title) || window.__packSgdbTitle || window.__sgdbNameQuery || '';
    const cached = loadPackSgdbCache(appid, title);
    if (cached) {
      applyPackSgdbToWindow(cached, appid, title);
      return true;
    }
    return false;
  }

  function catioRenderPackTab(type) {
    type = type || 'icons';
    ensurePackSgdbLoaded();
    const pack = window.__sgdbAssetsFromPack || window.__packSgdbAssets;
    if (!pack) return false;
    if (typeof window.renderSgdbPackAssets === 'function') {
      return window.renderSgdbPackAssets(type);
    }
    return false;
  }
  window.catioForceLoadSgdb = function (type) {
    // только локальный пакет / кэш, без онлайна SteamGridDB
    if (!catioRenderPackTab(type || 'icons')) {
      const grid = document.getElementById('sgdb-asset-grid') || document.querySelector('.sgdb-asset-grid');
      if (grid && !grid.querySelector('.sgdb-grid-item')) {
        grid.innerHTML = '<div class="settings-hint">Нет локальных ассетов. Импортируй ZIP с CATioGridDB.</div>';
      }
    }
  };

  document.addEventListener('click', function (e) {
    const tab = e.target && e.target.closest && e.target.closest('.sgdb-asset-tab, .sgdb-nav-btn');
    if (!tab) return;
    setTimeout(() => {
      const type = (tab.dataset && (tab.dataset.assetType || tab.dataset.sgdbTab)) || 'icons';
      const t = type === 'assets' ? 'icons' : type;
      if (['icons', 'logos', 'heroes', 'grids', 'covers'].includes(t)) {
        ensurePackSgdbLoaded();
        catioRenderPackTab(t === 'covers' ? 'grids' : t);
      }
    }, 50);
  }, true);

  // патч loadSgdbAssetsGlobal: сначала локальный пакет
  const _loadG = window.loadSgdbAssetsGlobal;
  window.loadSgdbAssetsGlobal = function (t) {
    ensurePackSgdbLoaded();
    if (window.__packSgdbAssets && typeof window.renderSgdbPackAssets === 'function') {
      const ok = window.renderSgdbPackAssets(t || 'icons');
      if (ok) return;
    }
    try { if (typeof _loadG === 'function') _loadG(t); } catch (e) {}
  };


  console.log('[CATio] catio_fixes.js v6 loaded');

})();
