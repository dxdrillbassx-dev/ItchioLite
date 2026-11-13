/* CATio — game comments / reviews */

// ---------- Комментарии ----------
function renderComments(comments, viewer) {
  const list = $('#comments-list');
  if (!list) return;
  const count = $('#comments-count');
  if (count) count.textContent = comments.length;

  if (!comments.length) {
    list.innerHTML = '<p class="comments-empty">Комментариев пока нет. Будь первым!</p>';
    return;
  }
  list.innerHTML = '';
  comments.forEach(c => list.appendChild(createCommentEl(c, viewer)));
}

function createCommentEl(c, viewer) {
  const el = document.createElement('div');
  el.className = 'comment';
  el.dataset.id = c.id;

  const canDelete = viewer && viewer.authorized &&
    (viewer.is_admin || viewer.user_id === +c.user_id);
  const avatar = c.avatar || escapeHtml((c.username || '?').charAt(0).toUpperCase());
  const color = c.avatar_color || '#ef5b2c';

  el.innerHTML = `
    <div class="comment-avatar" style="background:${escapeHtml(color)}">${avatar}</div>
    <div class="comment-body">
      <div class="comment-head">
        <b class="comment-author">${escapeHtml(c.username)}</b>
        <span class="comment-date">${formatDateTime(c.created_at)}</span>
        ${canDelete ? '<button type="button" class="comment-delete" title="Удалить">×</button>' : ''}
      </div>
      <p class="comment-text">${escapeHtml(c.body)}</p>
    </div>
  `;

  const del = el.querySelector('.comment-delete');
  if (del) {
    del.addEventListener('click', async () => {
      if (!confirm('Удалить комментарий?')) return;
      try {
        const data = await postJSON(`${API_BASE}?action=delete_comment`, { comment_id: c.id });
        if (!data.ok) throw new Error(data.error || 'Не удалось удалить');
        el.remove();
        const count = $('#comments-count');
        if (count) count.textContent = Math.max(0, +count.textContent - 1);
      } catch (err) {
        toast(err.message || 'Ошибка');
      }
    });
  }
  return el;
}




function clearPublishFormFields() {
  const formModal = document.getElementById('submit-form-modal');
  const form = document.getElementById('submit-game-form') || (formModal && formModal.querySelector('form'));
  try { if (form && form.reset) form.reset(); } catch (e) {}
  // form.reset() может откатить options у select — восстановим из кэша
  try {
    const cached = window.__myPublishersCache && window.__myPublishersCache.list;
    const sel = document.getElementById('sg-publisher-id');
    if (sel && cached && cached.length && typeof applyPublisherOptionsToSelect === 'function') {
      applyPublisherOptionsToSelect(sel, cached, '');
    }
  } catch (e) {}
  ['sg-title','sg-developer','sg-short','sg-tags','sg-price','sg-desc','sg-video','sg-cover-url','sg-banner-url','sg-logo-url','sg-icon-url','sg-screenshots-urls','sg-trailer-urls','sg-genre','sg-publisher'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'SELECT') el.selectedIndex = 0;
    else el.value = '';
  });
  const ed = document.getElementById('sg-desc-editor');
  if (ed) ed.innerHTML = '';
  document.querySelectorAll('.sg-genre').forEach(c => { c.checked = false; });
  document.querySelectorAll('.sg-platform').forEach(c => { c.checked = (c.value === 'windows'); });
  document.querySelectorAll('.sg-ctrl').forEach(c => { c.checked = false; });
  document.querySelectorAll('.sg-content-flag').forEach(c => { c.checked = false; });
  ['sg-cover-preview','sg-banner-preview','sg-logo-preview','sg-icon-preview'].forEach(id => {
    const p = document.getElementById(id);
    if (!p) return;
    p.style.backgroundImage = '';
    p.classList.remove('has-img');
    p.innerHTML = '<span>' + (id.includes('cover') ? 'Обложка' : id.includes('banner') ? 'Баннер' : id.includes('logo') ? 'Логотип' : 'Иконка') + '</span>';
  });
  const shotsPrev = document.getElementById('sg-shots-preview');
  if (shotsPrev) shotsPrev.innerHTML = '';
  try { if (typeof fillSysReq === 'function') { fillSysReq('#sg-sys-min-fields', {}); fillSysReq('#sg-sys-rec-fields', {}); } } catch (e) {}
  try { if (typeof renderLangTable === 'function') renderLangTable('#sg-lang-table', []); } catch (e) {}
  try { if (typeof ensureTrailersEditorUi === 'function') { ensureTrailersEditorUi(); renderTrailersEditor(['']); } } catch (e) {}
  try { if (typeof syncPublishGenres === 'function') syncPublishGenres(); } catch (e) {}
  try { if (typeof syncPublishDescription === 'function') syncPublishDescription(); } catch (e) {}
  window.__importedGamePack = null;
  // сборка
  const bv = document.getElementById('sg-build-version');
  const bc = document.getElementById('sg-build-changelog');
  const bf = document.getElementById('sg-build-file');
  const bn = document.getElementById('sg-build-file-name');
  const be = document.getElementById('sg-build-existing');
  if (bv) { bv.value = ''; bv.placeholder = '1.0.0'; }
  if (bc) bc.value = '';
  if (bf) bf.value = '';
  window.__selectedBuildFile = null;
  if (bn) bn.textContent = 'ZIP / EXE / 7z…';
  if (be) { be.style.display = 'none'; be.innerHTML = ''; }
  // pack sgdb оставляем — пригодится в CATioGridDB до перезагрузки
}

function resetPublishFormMode() {
  window.__adminModeratingId = null;
  window.__adminPublishMode = false;
  window.__publishFormMode = 'submit';
  const formModal = document.getElementById('submit-form-modal');
  if (!formModal) return;
  const head = formModal.querySelector('.submit-modal-head h2') || formModal.querySelector('h2');
  if (head) head.textContent = 'Публикация игры';
  const sendBtn = document.getElementById('submit-game-send');
  if (sendBtn) {
    sendBtn.textContent = 'Отправить на модерацию';
    delete sendBtn.dataset.adminPublish;
    delete sendBtn.dataset.adminSave;
    delete sendBtn.dataset.publisherEdit;
    delete sendBtn.dataset.updateMode;
    sendBtn.disabled = false;
    sendBtn.classList.remove('is-disabled');
  }
  const rej = document.getElementById('submit-admin-reject');
  if (rej) { rej.classList.add('hidden'); rej.style.display = 'none'; }
  const extra = document.getElementById('sg-admin-extra-actions');
  if (extra) extra.remove();
  try { clearPublishFormFields(); } catch (e) {}
  try { ensurePublishAdminFooter(formModal, {}, null); } catch (e) {}
  window.__publishEditGameId = null;
  window.__adminModeratingId = null;
}

function ensurePublishAdminFooter(formModal, opts, g) {
  opts = opts || {};
  const foot = formModal.querySelector('.submit-modal-foot');
  if (!foot) return;

  // левая зона футера (импорт/экспорт/удалить)
  let left = foot.querySelector('.sg-foot-left');
  if (!left) {
    left = document.createElement('div');
    left.className = 'sg-foot-left';
    left.style.cssText = 'display:flex;gap:8px;align-items:center';
    // переносим существующий import, если он вложен иначе
    const oldImportBtn = foot.querySelector('#sg-import-pack-btn');
    const oldImportInput = foot.querySelector('#sg-import-pack');
    if (oldImportBtn && oldImportBtn.parentElement) {
      const parent = oldImportBtn.parentElement;
      left.appendChild(oldImportInput || document.createElement('span'));
      if (oldImportInput) left.appendChild(oldImportInput);
      left.appendChild(oldImportBtn);
      // если parent пустой служебный div — можно оставить
    }
    foot.insertBefore(left, foot.firstChild);
  }

  // гарантируем import input/btn
  let importInput = document.getElementById('sg-import-pack');
  let importBtn = document.getElementById('sg-import-pack-btn');
  if (!importInput) {
    importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.id = 'sg-import-pack';
    importInput.accept = '.zip,application/zip';
    importInput.hidden = true;
    left.appendChild(importInput);
  }
  if (!importBtn) {
    importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'hp-btn-edit';
    importBtn.id = 'sg-import-pack-btn';
    importBtn.textContent = 'Импорт';
    left.appendChild(importBtn);
  }

  // export + delete buttons
  let exportBtn = document.getElementById('sg-admin-export');
  if (!exportBtn) {
    exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'hp-btn-edit';
    exportBtn.id = 'sg-admin-export';
    exportBtn.textContent = 'Экспорт';
    left.appendChild(exportBtn);
  }
  let delBtn = document.getElementById('sg-admin-delete');
  if (!delBtn) {
    delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-danger';
    delBtn.id = 'sg-admin-delete';
    delBtn.textContent = 'Удалить карточку';
    left.appendChild(delBtn);
  }

  // порядок: Экспорт | Удалить | (Импорт только в submit)
  // переставим
  left.innerHTML = '';
  left.appendChild(importInput);

  const mode = opts.moderate ? 'moderate' : ((opts.adminEdit || opts.publisherEdit) ? 'adminEdit' : 'submit');
  // убрать устаревшую кнопку «Обновить» из футера
  const oldUpd = document.getElementById('sg-admin-update');
  if (oldUpd) try { oldUpd.remove(); } catch (e) {}

  if (mode === 'submit') {
    importBtn.style.display = '';
    importBtn.textContent = 'Импорт';
    left.appendChild(importBtn);
    exportBtn.style.display = 'none';
    delBtn.style.display = 'none';
  } else if (mode === 'adminEdit') {
    // админ чужой игры: Экспорт | Удалить
    importBtn.style.display = 'none';
    exportBtn.style.display = '';
    delBtn.style.display = '';
    left.appendChild(exportBtn);
    left.appendChild(delBtn);
  } else {
    // publisherEdit / moderate — без импорта/экспорта/удаления
    importBtn.style.display = 'none';
    exportBtn.style.display = 'none';
    delBtn.style.display = 'none';
  }

  // убрать старый extra блок если был
  const oldExtra = document.getElementById('sg-admin-extra-actions');
  if (oldExtra) oldExtra.remove();
  const oldRej = document.getElementById('sg-admin-reject');
  if (oldRej) oldRej.remove();
  // «Отклонить» только в модерации — иначе удаляем из DOM
  const rejBtn = document.getElementById('submit-admin-reject');
  if (rejBtn) {
    if (mode === 'moderate') {
      rejBtn.classList.remove('hidden');
      rejBtn.style.display = '';
    } else {
      try { rejBtn.remove(); } catch (e) {
        rejBtn.classList.add('hidden');
        rejBtn.style.display = 'none';
      }
    }
  }

  // Предзагрузка в модалке модерации игры
  let preBtn = document.getElementById('submit-admin-preload');
  if (mode === 'moderate' && g && g.id) {
    if (!preBtn) {
      preBtn = document.createElement('button');
      preBtn.type = 'button';
      preBtn.id = 'submit-admin-preload';
      preBtn.className = 'btn-ghost';
      preBtn.textContent = 'Предзагрузка';
    }
    // Безопасная вставка: send может быть не прямым потомком foot
    const foot = formModal.querySelector('.submit-modal-foot');
    const send = document.getElementById('submit-game-send');
    const rej = document.getElementById('submit-admin-reject');
    const anchor = rej || send;
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(preBtn, anchor);
    } else if (foot) {
      foot.appendChild(preBtn);
    }
    preBtn.classList.remove('hidden');
    preBtn.style.display = '';
    preBtn.onclick = () => adminPreloadGame(g.id, g.title || '');
  } else if (preBtn) {
    preBtn.classList.add('hidden');
    preBtn.style.display = 'none';
    preBtn.onclick = null;
  }

  const gid = g && g.id;
  exportBtn.onclick = async () => {
    if (!gid) return;
    if (typeof runGamePackExport === 'function') {
      await runGamePackExport(gid);
    } else {
      toast('Экспорт недоступен');
    }
  };
  delBtn.onclick = async () => {
    if (!gid) return;
    const ok1 = await appConfirm({
      title: 'Удалить карточку игры?',
      message: 'Игра будет удалена из каталога и модерации.',
      okText: 'Удалить',
      danger: true
    });
    if (!ok1) return;
    const ok2 = await appConfirm({
      title: 'Точно удалить?',
      message: 'Это действие нельзя отменить. Введите свой код друга, чтобы подтвердить.',
      okText: 'Удалить навсегда',
      danger: true,
      requireFriendCode: true
    });
    if (!ok2) return;
    delBtn.disabled = true;
    try {
      const data = await postJSON((typeof SUBMIT_API !== 'undefined' ? SUBMIT_API : 'api/submit.php') + '?action=delete_game', { id: +gid });
      if (!data.ok) throw new Error(data.error || 'Не удалось удалить');
      toast('Игра удалена');
      try { homeCache = null; storeCache = []; if (typeof loadHome==='function') loadHome(); if (typeof loadStore==='function') loadStore(); } catch(e) {}
      formModal.classList.add('hidden');
      try { resetPublishFormMode(); } catch (e) {}
      // мгновенно убрать с главной / каталога
      try {
        homeCache = null;
        storeCache = [];
        const idNum = +gid;
        document.querySelectorAll('[data-game-id="' + idNum + '"], .game-card[data-id="' + idNum + '"], .store-card[data-id="' + idNum + '"]').forEach(el => el.remove());
        if (typeof loadHome === 'function') loadHome();
        if (typeof loadStore === 'function') loadStore();
        if (typeof loadSideLibrary === 'function') loadSideLibrary();
      } catch (e) { console.warn(e); }
      try { if (typeof loadAdminPending === 'function') loadAdminPending(); } catch (e) {}
      try { if (typeof gotoView === 'function') gotoView('home'); } catch (e) {}
    } catch (e) {
      toast(e.message || 'Ошибка удаления');
    } finally {
      delBtn.disabled = false;
    }
  };
}

async function openPublishFormForGame(g, opts) {
  opts = opts || {};
  const formModal = document.getElementById('submit-form-modal');
  if (!formModal) {
    toast('Модалка публикации не найдена');
    return;
  }
  const isPublisherEdit = !!opts.publisherEdit;
  const isAdminMode = !!(opts.adminEdit || opts.moderate) && !isPublisherEdit;
  window.__adminModeratingId = isAdminMode ? g.id : null;
  window.__publishEditGameId = (isPublisherEdit || isAdminMode) ? (g && g.id) : null;
  window.__adminPublishMode = isAdminMode;
  window.__publishFormMode = opts.moderate ? 'moderate' : (opts.adminEdit ? 'adminEdit' : 'submit');

  // заголовок ТОЛЬКО в этой модалке
  const head = formModal.querySelector('#submit-form-title') || formModal.querySelector('.sgdb-modal-head h3') || formModal.querySelector('h2, h3');
  if (head) {
    head.textContent = opts.moderate ? 'Модерация заявки' : (opts.publisherEdit ? 'Обновление карточки' : (opts.adminEdit ? 'Редактирование карточки' : 'Публикация игры'));
  }
  const sendBtn = document.getElementById('submit-game-send');
  if (sendBtn) {
    if (opts.moderate) {
      sendBtn.textContent = 'Опубликовать';
      sendBtn.dataset.adminPublish = '1';
      delete sendBtn.dataset.adminSave;
      delete sendBtn.dataset.publisherEdit;
    } else if (opts.publisherEdit) {
      sendBtn.textContent = 'Отправить на модерацию';
      delete sendBtn.dataset.adminPublish;
      delete sendBtn.dataset.adminSave;
      sendBtn.dataset.publisherEdit = '1';
      sendBtn.dataset.updateMode = '1';
    } else if (opts.adminEdit) {
      sendBtn.textContent = 'Сохранить';
      sendBtn.dataset.adminSave = '1';
      delete sendBtn.dataset.adminPublish;
      delete sendBtn.dataset.publisherEdit;
    } else {
      sendBtn.textContent = 'Отправить на модерацию';
      delete sendBtn.dataset.adminPublish;
      delete sendBtn.dataset.adminSave;
      delete sendBtn.dataset.publisherEdit;
    }
  }
  // доп. кнопки админа в футере модалки
  ensurePublishAdminFooter(formModal, opts, g);

  try { ensureTrailersEditorUi(); } catch (e) {}
  try { initPublishFilePreviews(formModal); initPublishPriceInput(); initPublishRte(); ensureTrailersEditorUi(); renderTrailersEditor(['']); } catch (e) {}

  const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
  set('sg-title', g.title || '');
  set('sg-developer', g.developer_name || g.developer || '');
  set('sg-short', g.short_description || '');
  set('sg-tags', g.tags || '');
  set('sg-price', g.price != null ? String(parseInt(g.price, 10) || 0) : '0');

  const genres = String(g.genre || '').split(/[,;]+/).map(s => s.trim()).filter(Boolean);
  document.querySelectorAll('.sg-genre').forEach(c => { c.checked = genres.some(x => x.toLowerCase() === String(c.value).toLowerCase()); });
  try { syncPublishGenres(); } catch (e) {}

  const ed = document.getElementById('sg-desc-editor');
  if (ed) ed.innerHTML = g.description || '';
  set('sg-desc', g.description || '');
  try { syncPublishDescription(); } catch (e) {}

  try { fillSysReq('#sg-sys-min-fields', g.sys_req_min); } catch (e) {}
  try { fillSysReq('#sg-sys-rec-fields', g.sys_req_rec); } catch (e) {}
  try {
    let langs = g.languages;
    if (typeof langs === 'string') { try { langs = JSON.parse(langs); } catch (e) { langs = []; } }
    if (Array.isArray(langs) && langs.length && typeof langs[0] === 'string') {
      langs = langs.map(name => ({ name, subtitles: true, audio: true }));
    }
    renderLangTable('#sg-lang-table', langs || []);
  } catch (e) {}

  // controllers
  let ctrls = String(g.controllers || '').toLowerCase().split(/[,;|]+/).map(s => s.trim()).filter(Boolean);
  document.querySelectorAll('.sg-ctrl').forEach(cb => {
    const v = String(cb.value).toLowerCase();
    cb.checked = ctrls.some(c => c === v || c.includes(v) || v.includes(c) || ['full','supported','partial'].includes(c));
  });

  // media previews
  const cover = g.cover_url || g.cover_src || '';
  const banner = g.banner_url || '';
  if (cover) {
    set('sg-cover-url', cover);
    setPubPreviewImg('sg-cover-preview', cover);
  }
  if (banner) {
    set('sg-banner-url', banner);
    setPubPreviewImg('sg-banner-preview', banner);
  }
  if (g.logo_url) {
    set('sg-logo-url', g.logo_url);
    setPubPreviewImg('sg-logo-preview', g.logo_url);
  }
  if (g.icon_url) {
    set('sg-icon-url', g.icon_url);
    setPubPreviewImg('sg-icon-preview', g.icon_url);
  }

  // trailers multi — video_url + game_media trailers
  const trailers = parseTrailerList(g.video_url);
  if (Array.isArray(g.videos)) {
    g.videos.forEach(v => {
      const u = v && (v.url || v.src);
      if (u && !trailers.includes(u)) trailers.push(u);
    });
  }
  if (Array.isArray(g.media)) {
    g.media.forEach(m => {
      const kind = String(m.kind || m.type || '').toLowerCase();
      if (['trailer', 'video', 'movie'].includes(kind)) {
        const u = (m.url || m.src || '').trim();
        if (u && !trailers.includes(u)) trailers.push(u);
      }
    });
  }
  try { ensureTrailersEditorUi(); } catch (e) {}
  renderTrailersEditor(trailers.length ? trailers : ['']);

  // screenshots preview from media
  try {
    const shotUrls = [];
    if (Array.isArray(g.screenshots)) {
      g.screenshots.forEach(s => {
        const u = typeof s === 'string' ? s : (s && (s.url || s.image_url));
        if (u) shotUrls.push(u);
      });
    }
    if (Array.isArray(g.media)) {
      g.media.forEach(m => {
        const kind = String(m.kind || m.type || '').toLowerCase();
        if (kind === 'screenshot' || kind === 'shot' || kind === 'screen') {
          const u = (m.url || '').trim();
          if (u && !shotUrls.includes(u)) shotUrls.push(u);
        }
      });
    }
    const urlsField = document.getElementById('sg-screenshots-urls');
    if (urlsField && shotUrls.length) urlsField.value = shotUrls.join('\n');
    const prevBox = document.getElementById('sg-shots-preview');
    if (prevBox) {
      if (shotUrls.length) {
        prevBox.innerHTML = shotUrls.map(u =>
          `<img src="${String(u).replace(/"/g, '&quot;')}" alt="" style="width:72px;height:48px;object-fit:cover;border-radius:6px;margin:4px" />`
        ).join('');
        prevBox.classList.remove('hidden');
        prevBox.style.display = 'flex';
        prevBox.style.flexWrap = 'wrap';
        prevBox.style.gap = '6px';
      } else {
        prevBox.innerHTML = '';
      }
    }
  } catch (e) { console.warn('shots preview', e); }

  // publishers
  try {
    await window.fillPublishPublisherSelect();
    if (g.publisher_id) {
      const sel = document.getElementById('sg-publisher-id');
      if (sel) {
        // ensure option exists even if not in "mine"
        if (![...sel.options].some(o => o.value === String(g.publisher_id))) {
          const opt = document.createElement('option');
          opt.value = String(g.publisher_id);
          opt.textContent = g.developer_name || g.publisher_name || ('Издательство #' + g.publisher_id);
          sel.appendChild(opt);
        }
        sel.value = String(g.publisher_id);
      }
      const hid = document.getElementById('sg-publisher');
      if (hid && (g.developer_name || g.publisher_name)) hid.value = g.developer_name || g.publisher_name;
    }
  } catch (e) {}

  // На модерации: разработчик и издательство только для просмотра
  try {
    const dev = document.getElementById('sg-developer');
    const pub = document.getElementById('sg-publisher-id');
    const isMod = !!(opts.moderate || opts.adminEdit);
    if (dev) {
      if (isMod) {
        dev.readOnly = true;
        dev.classList.add('is-readonly');
        dev.title = 'Только просмотр';
      } else {
        dev.readOnly = false;
        dev.classList.remove('is-readonly');
        dev.title = '';
      }
    }
    if (pub) {
      if (isMod) {
        pub.disabled = true;
        pub.classList.add('is-readonly');
        pub.title = 'Только просмотр';
      } else {
        pub.disabled = false;
        pub.classList.remove('is-readonly');
        pub.title = '';
      }
    }
  } catch (e) {}

  try { initPubFormTabs(); initPubMediaTabs(); initBuildsUi(); bindPublishValidationWatchers(); updatePublishSectionStatus(); } catch (e) {}
  if (g && g.id) {
    // builds уже могут быть в объекте g (action=get) — лишний list_builds не долбим
    if (!(Array.isArray(g.builds) && g.builds.length)) {
      try { await loadGameBuildsIntoForm(g.id); } catch (e) {}
    }
  } else {
    window.__pendingBuilds = [];
    try { renderPendingBuilds(); } catch (e) {}
  }
  // публикатор обновляет — нужна НОВАЯ версия и НОВЫЙ файл
  if (opts.publisherEdit) {
    const ver = document.getElementById('sg-build-version');
    const ch = document.getElementById('sg-build-changelog');
    const fi = document.getElementById('sg-build-file');
    const nameEl = document.getElementById('sg-build-file-name');
    const exist = document.getElementById('sg-build-existing');
    if (ver) { ver.value = ''; ver.placeholder = 'Новая версия, напр. 1.0.1'; }
    if (ch) ch.value = '';
    if (fi) fi.value = '';
    window.__selectedBuildFile = null;
    if (nameEl) {
      nameEl.textContent = 'Прикрепите новый файл сборки';
      nameEl.style.display = 'inline';
      nameEl.style.opacity = '1';
    }
    if (exist) { exist.style.display = 'none'; exist.innerHTML = ''; }
    const rej = document.getElementById('submit-admin-reject');
    if (rej) { try { rej.remove(); } catch (e) {} }
    try { updatePublishSectionStatus(); } catch (e) {}
  }
  formModal.classList.remove('hidden');
}

function isGamePublisherOf(g) {
  const me = window.AUTH_STATE && window.AUTH_STATE.user;
  if (!me || !g) return false;
  if (+g.submitted_by === +me.id) return true;
  if (+g.user_id === +me.id) return true;
  return false;
}

function openAdminGameEditModal(g) {
  if (!g) return;
  // Только админское редактирование карточки (не обновление версии)
  openPublishFormForGame(g, { adminEdit: true });
  const rej = document.getElementById('submit-admin-reject');
  if (rej) { try { rej.remove(); } catch (e) { rej.classList.add('hidden'); rej.style.display = 'none'; } }
}

function bindAdminGameEdit(g, viewer) {
  const btn = document.getElementById('gp-admin-edit');
  if (btn && viewer && (viewer.is_admin || viewer.role === 'admin')) {
    // Привязываем обработчик после каждого рендера страницы игры.
    // Используем сохранённый объект страницы, чтобы клик по SVG-иконке
    // и повторное создание actionbar не теряли ссылку на игру.
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const game = window.__currentGamePage || g;
      if (typeof openPublishFormForGame === 'function') {
        openPublishFormForGame(game, { adminEdit: true }).catch(err => {
          console.error('[CATio] Не удалось открыть редактор игры:', err);
          toast(err.message || 'Не удалось открыть редактор игры');
        });
      } else {
        toast('Редактор игры ещё не загружен');
      }
    };
  }
  const upd = document.getElementById('gp-game-update');
  if (upd) {
    upd.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openGameUpdateModal(g); };
  }
}

function openGameUpdateModal(g) {
  if (!g || !g.id) { toast('Нет игры'); return; }
  let modal = document.getElementById('game-update-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'game-update-modal';
    modal.className = 'submit-modal';
    modal.innerHTML = `
      <div class="submit-modal-backdrop" data-close-upd></div>
      <div class="submit-modal-box" style="max-width:440px">
        <div class="submit-modal-head">
          <h2>Обновить версию</h2>
          <button type="button" class="friends-modal-close" data-close-upd aria-label="Закрыть">×</button>
        </div>
        <div class="submit-modal-body" style="display:flex;flex-direction:column;gap:12px">
          <p class="settings-hint" style="margin:0">Новый файл уйдёт на проверку. После одобрения появится в списке сборок.</p>
          <label class="ws-ff"><span>Версия *</span>
            <input type="text" class="auth-input" id="upd-version" placeholder="1.0.1" maxlength="32" />
          </label>
          <label class="ws-ff"><span>Что нового *</span>
            <textarea class="auth-input" id="upd-changelog" rows="3" placeholder="Кратко об изменениях…" maxlength="1000" style="resize:vertical"></textarea>
          </label>
          <div class="ws-ff">
            <span>Файл сборки *</span>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">
              <label class="pub-file-btn" for="upd-file">Выбрать файл</label>
              <input type="file" id="upd-file" accept=".exe,.zip,.7z,.rar,.msi,.dmg,.appimage,.tar,.gz" hidden />
              <span class="settings-hint" id="upd-file-name">ZIP / EXE / 7z…</span>
            </div>
          </div>
        </div>
        <div class="submit-modal-foot" style="display:flex;justify-content:flex-end;gap:8px">
          <button type="button" class="hp-btn-edit" data-close-upd>Отмена</button>
          <button type="button" class="hp-btn-edit" id="upd-send" style="background:var(--accent);color:#12110e;border-color:var(--accent)">Отправить на проверку</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-upd]')) modal.classList.add('hidden');
    });
    const fileInput = modal.querySelector('#upd-file');
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      const nameEl = modal.querySelector('#upd-file-name');
      if (!nameEl) return;
      if (f) {
        const sz = (typeof formatBytes === 'function') ? formatBytes(f.size) : ((f.size / 1048576).toFixed(1) + ' МБ');
        nameEl.textContent = f.name + ' · ' + sz;
        nameEl.style.color = 'var(--text-bright)';
        nameEl.style.fontWeight = '600';
      } else {
        nameEl.textContent = 'ZIP / EXE / 7z…';
        nameEl.style.fontWeight = '';
      }
    });
  }
  // bind send to current game
  const sendBtn = modal.querySelector('#upd-send');
  const fileInput = modal.querySelector('#upd-file');
  sendBtn.onclick = async () => {
    const version = (modal.querySelector('#upd-version')?.value || '').trim();
    const changelog = (modal.querySelector('#upd-changelog')?.value || '').trim();
    const file = fileInput.files && fileInput.files[0];
    if (!version) { toast('Укажите версию'); return; }
    if (!changelog) { toast('Укажите, что нового'); return; }
    if (!file) { toast('Прикрепите файл'); return; }
    sendBtn.disabled = true;
    sendBtn.textContent = 'Отправка…';
    try {
      const fd = new FormData();
      fd.append('csrf_token', window.CSRF_TOKEN || '');
      fd.append('game_id', String(g.id));
      fd.append('version', version);
      fd.append('changelog', changelog);
      fd.append('build_file', file, file.name);
      const res = await fetch((typeof SUBMIT_API !== 'undefined' ? SUBMIT_API : 'api/submit.php') + '?action=submit_update', { method: 'POST', body: fd });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Ошибка');
      toast('Обновление отправлено на проверку');
      modal.classList.add('hidden');
    } catch (err) {
      toast(err.message || 'Не удалось отправить');
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Отправить на проверку';
    }
  };
  modal.querySelector('#upd-version').value = '';
  modal.querySelector('#upd-changelog').value = '';
  fileInput.value = '';
  const n = modal.querySelector('#upd-file-name');
  if (n) { n.textContent = 'ZIP / EXE / 7z…'; n.style.fontWeight = ''; }
  modal.classList.remove('hidden');
}
window.openGameUpdateModal = openGameUpdateModal;


async function loadSgdbAssetsForName(name) {
  // онлайн поиск отключён — только локальные/ZIP ассеты
  if (typeof window.loadSgdbAssetsGlobal === 'function') return window.loadSgdbAssetsGlobal('icons');
  return;

  const q = String(name || '').trim();
  if (q.length < 2) return;
  const grid = document.getElementById('sgdb-grid') || document.querySelector('.sgdb-grid');
  if (grid) grid.innerHTML = '<div class="loading">Только ассеты из ZIP-пакета (онлайн API отключён)</div>';
  try {
    const data = await fetchJSON('api/game_pack.php?action=sgdb_by_name&q=' + encodeURIComponent(q));
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const first = (data.results || [])[0];
    if (!first) {
      if (grid) grid.innerHTML = '<div class="loading">Ничего не найдено в CATioGridDB</div>';
      return;
    }
    window.__sgdbGameId = first.id;
    const assets = await fetchJSON('api/game_pack.php?action=sgdb_by_name&q=' + encodeURIComponent(q) + '&sgdb_id=' + first.id);
    if (!assets.ok) throw new Error(assets.error || 'Ошибка ассетов');
    window.__sgdbAssetsByName = assets.assets || {};
    // показать covers по умолчанию
    const list = (assets.assets && assets.assets.covers) || [];
    if (grid) {
      if (!list.length) grid.innerHTML = '<div class="loading">Ассеты не найдены</div>';
      else {
        grid.innerHTML = list.map(a => {
          const u = a.url || a.thumb;
          const th = a.thumb || a.url;
          return '<button type="button" class="sgdb-grid-item" data-url="' + escapeHtml(u) + '"><img src="' + escapeHtml(th) + '" alt="" loading="lazy" /></button>';
        }).join('');
      }
    }
    toast('CATioGridDB: ' + first.name);
  } catch (e) {
    if (grid) grid.innerHTML = '<div class="loading">' + escapeHtml(e.message || 'Ошибка') + '</div>';
  }
}


function getLocalGameAssets(gameId) {
  try {
    const raw = localStorage.getItem('catio_local_assets_' + gameId);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function setLocalGameAssets(gameId, assets) {
  try {
    localStorage.setItem('catio_local_assets_' + gameId, JSON.stringify(assets || {}));
  } catch (e) {}
}
async function saveGameAssetsSelection(payload) {
  const gameId = payload.game_id || window.__steamEditGameId;
  payload = { ...(payload || {}), game_id: gameId, csrf_token: payload.csrf_token || window.CSRF_TOKEN || '' };
  // админ/владелец — сохраняем через games.php (локальные uploads/ и http)
  try {
    const res = await postJSON((typeof API_BASE !== 'undefined' ? API_BASE : 'api/games.php') + '?action=update_assets', payload, typeof FETCH_TIMEOUT_LONG !== 'undefined' ? FETCH_TIMEOUT_LONG : 60000);
    if (res && res.ok) return res;
    // если сервер отказал не-админу — локально
    if (window.__assetsLocalOnly || (res && res.error)) {
      const cur = getLocalGameAssets(gameId) || {};
      const next = { ...cur, ...payload, updated_at: Date.now() };
      setLocalGameAssets(gameId, next);
      return { ok: true, local: true };
    }
    return res || { ok: false, error: 'Ошибка сохранения' };
  } catch (e) {
    if (window.__assetsLocalOnly) {
      const cur = getLocalGameAssets(gameId) || {};
      setLocalGameAssets(gameId, { ...cur, ...payload, updated_at: Date.now() });
      return { ok: true, local: true };
    }
    throw e;
  }
}

/** Открыть модалку оформления (как Hydra) для конкретной игры */
function openGameAssetsModal(g) {
  const modal = document.getElementById('steam-import-modal');
  if (!modal) {
    toast('Модалка не найдена');
    return;
  }
  window.__steamEditGameData = g || null;
  if (g && Array.isArray(g.screenshots)) window.__lastGameScreenshots = g.screenshots;

  let appId = parseInt(g.steam_appid, 10) || 0;
  if (!appId && g.slug) {
    const m = String(g.slug).match(/-s(\d{3,10})$/);
    if (m) appId = parseInt(m[1], 10);
  }
  if (!appId) {
    // non-steam: откроем модалку и поищем в CATioGridDB по названию
    window.__steamEditMode = true;
    window.__steamEditGameId = Number(g.id);
    window.__steamAppId = 0;
    window.__sgdbNameQuery = g.title || '';
    const modal2 = document.getElementById('steam-import-modal');
    if (!modal2) { toast('Модалка не найдена'); return; }
    const title = document.getElementById('sgdb-modal-title');
    if (title) title.textContent = g.title || 'Игра';
    const it = document.getElementById('sgdb-info-title');
    if (it) it.textContent = g.title || '—';
    const ia = document.getElementById('sgdb-info-appid');
    if (ia) ia.textContent = 'non-steam';
    const iid = document.getElementById('sgdb-info-id');
    if (iid) iid.textContent = String(g.id);
    modal2.classList.remove('hidden');
    // подгрузить ассеты по имени
    try {
      if (typeof window.loadSgdbAssetsGlobal === 'function') window.loadSgdbAssetsGlobal('icons');
      else if (typeof loadSgdbAssets === 'function') loadSgdbAssets('icons');
    } catch (e) { console.warn(e); }
    try {
      fillGameSettingsPath(g);
      fillGameSettingsDownloads(g.id);
      fillGameSettingsDanger(g.id);
      fillGameSettingsMods(g.id);
    } catch (e) {}
    return;
  }

  window.__steamEditMode = true;
  window.__steamEditGameId = Number(g.id);
  window.__steamAppId = appId;
  if (typeof window.setSteamAppId === 'function') window.setSteamAppId(appId);
  // сброс выбора при открытии
  try {
    const st = window.getSteamAssetState && window.getSteamAssetState();
    if (st && st.steamSelected) {
      st.steamSelected.icon_url = '';
      st.steamSelected.logo_url = '';
      st.steamSelected.banner_url = '';
      st.steamSelected.cover_url = '';
    }
  } catch (e) {}
  ['steam-sel-icon','steam-sel-logo','steam-sel-banner','steam-sel-cover'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const hint = document.getElementById('sgdb-asset-save-hint');
  if (hint) {
    hint.textContent = 'Выбери ассеты и нажми сохранить';
    hint.classList.remove('has-sel');
  }

  const title = document.getElementById('sgdb-modal-title');
  if (title) title.textContent = g.title || 'Игра';
  const it = document.getElementById('sgdb-info-title');
  if (it) it.textContent = g.title || '—';
  const ia = document.getElementById('sgdb-info-appid');
  if (ia) ia.textContent = String(appId);
  const iid = document.getElementById('sgdb-info-id');
  if (iid) iid.textContent = String(g.id);

  modal.querySelectorAll('.sgdb-nav-btn').forEach(b => {
    b.style.display = '';
    b.classList.toggle('active', b.dataset.sgdbTab === 'assets');
  });
  modal.querySelectorAll('.sgdb-pane').forEach(p => {
    p.classList.toggle('active', p.dataset.sgdbPane === 'assets');
  });
  modal.querySelectorAll('.sgdb-asset-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.assetType === 'icons');
  });

  // Админ = глобально для всех; обычный = только локально у себя
  const auth = window.AUTH_STATE || {};
  const u = auth.user || auth || {};
  const isAdmin = !!(u.role === 'admin' || u.is_admin === true || u.is_admin === 1 || u.is_admin === '1' || auth.role === 'admin');
  window.__assetsLocalOnly = !isAdmin;
  const warn = modal.querySelector('.sgdb-warn');
  if (warn) {
    warn.style.display = isAdmin ? 'none' : '';
    warn.textContent = isAdmin
      ? ''
      : 'Изменения применятся только у вас локально. Глобально для всех может менять только админ.';
  }
  const srcLabel = modal.querySelector('.sgdb-source-label');
  if (srcLabel) srcLabel.textContent = 'CATioGridDB';

  try {
    fillGameSettingsPath(g);
    fillGameSettingsDownloads(g.id);
    fillGameSettingsDanger(g.id);
      fillGameSettingsMods(g.id);
  } catch (e) {}
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  // если в пакете были CATioGridDB ассеты — подставить в кэш
  if (window.__packSgdbAssets) {
    window.__sgdbAssetsFromPack = window.__packSgdbAssets;
  }
  setTimeout(() => {
    if (window.__sgdbAssetsFromPack && typeof window.renderSgdbPackAssets === 'function') {
      window.renderSgdbPackAssets('icons');
    } else if (typeof window.loadSgdbAssetsGlobal === 'function') {
      window.loadSgdbAssetsGlobal('icons');
    } else {
      document.querySelector('.sgdb-asset-tab[data-asset-type="icons"]')?.click();
    }
  }, 40);
}

function renderSgdbPackAssets(type) {
  const pack = window.__sgdbAssetsFromPack || window.__packSgdbAssets;
  if (!pack) return false;
  const key = type === 'covers' || type === 'grids' ? 'grids' : type;
  let list = pack[key] || pack[type] || (key === 'grids' ? pack.covers : null) || [];
  if (!Array.isArray(list)) list = [];
  list = list.map(a => {
    if (!a) return null;
    if (typeof a === 'string') return { url: a, thumb: a };
    const url = a.url || a.file || a.thumb || '';
    if (!url) return null;
    return { url, thumb: a.thumb || url };
  }).filter(Boolean);
  const grid = document.getElementById('sgdb-asset-grid') || document.querySelector('.sgdb-asset-grid') || document.getElementById('sgdb-grid');
  if (!grid) return false;
  if (!list.length) {
    grid.innerHTML = '<div class="settings-hint">В пакете нет ассетов для этой вкладки</div>';
    return true;
  }
  // делегируем штатному рендеру, если есть
  if (typeof renderSgdbGrid === 'function') {
    try { renderSgdbGrid(list, type); return true; } catch (e) {}
  }
  grid.className = 'sgdb-asset-grid is-' + type;
  grid.innerHTML = list.map(a => {
    const u = a.url || a.thumb;
    const th = a.thumb || a.url;
    return '<button type="button" class="sgdb-grid-item is-' + type + '" data-url="' + escapeHtml(u) + '"><img src="' + escapeHtml(th) + '" alt="" loading="lazy" onerror="this.onerror=null;const b=this.closest(&quot;.sgdb-grid-item&quot;);if(b)b.remove();" /></button>';
  }).join('');
  grid.querySelectorAll('.sgdb-grid-item').forEach(btn => {
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.sgdb-grid-item').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      if (typeof selectSgdbAsset === 'function') selectSgdbAsset(btn.dataset.url, type);
      else if (typeof window.selectSgdbAsset === 'function') window.selectSgdbAsset(btn.dataset.url, type);
    });
  });
  return true;
}
window.renderSgdbPackAssets = renderSgdbPackAssets;
if (!window.__sgdbPackTabDelegate) {
  window.__sgdbPackTabDelegate = true;
  document.addEventListener('click', (e) => {
    const tab = e.target.closest && e.target.closest('.sgdb-asset-tab');
    if (!tab) return;
    if (!window.__sgdbAssetsFromPack && !window.__packSgdbAssets) return;
    const type = tab.dataset.assetType || 'icons';
    // дать штатному обработчику сработать, потом перерисовать из пакета
    setTimeout(() => { try { renderSgdbPackAssets(type); } catch (err) {} }, 30);
  });
}





function initCommentForm(g, viewer) {
  const form = $('#comment-form');
  if (!form || form.dataset.bound === '1') return;
  form.dataset.bound = '1';
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#comment-input');
    if (!input) return;
    let errBox = $('#comment-error');
    if (!errBox) {
      errBox = document.createElement('div');
      errBox.id = 'comment-error';
      errBox.className = 'gp-comment-error hidden';
      form.insertBefore(errBox, form.firstChild);
    }
    const btn = form.querySelector('button[type="submit"]');
    const text = (input.value || '').trim();
    if (!text) {
      errBox.textContent = 'Напишите текст отзыва';
      errBox.classList.remove('hidden');
      return;
    }
    errBox.classList.add('hidden');
    if (btn) btn.disabled = true;
    try {
      // корневой отзыв — без parent_id
      const data = await postJSON(`${API_BASE}?action=comment`, { game_id: g.id, body: text });
      if (!data.ok) throw new Error(data.error || 'Не удалось отправить');
      const page = await fetchJSON(`${API_BASE}?action=get&id=${g.id}`);
      if (page.ok) {
        renderCommentsThreaded(page.comments || [], page.viewer || viewer, g.id);
        const count = $('#comments-count');
        if (count) count.textContent = (page.comments || []).length;
      }
      input.value = '';
      const len = $('#comment-len');
      if (len) len.textContent = '0';
      toast('Отзыв опубликован');
    } catch (err) {
      console.error(err);
      errBox.textContent = err.message || 'Ошибка отправки';
      errBox.classList.remove('hidden');
      toast(err.message || 'Не удалось отправить отзыв');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  const input = $('#comment-input');
  if (input && !input.dataset.lenBound) {
    input.dataset.lenBound = '1';
    input.addEventListener('input', () => {
      const el = $('#comment-len');
      if (el) el.textContent = String((input.value || '').length);
    });
  }
}


/* --- library.js, downloads.js loaded separately --- */


/* --- profile/friends/messages/notifications loaded separately --- */

