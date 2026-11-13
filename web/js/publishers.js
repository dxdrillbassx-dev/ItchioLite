/* CATio — publishers, create menu, publish forms */
/* Depends: utils, icons, workshop (optional) */

/* ===== Издательства / меню создания ===== */
window.__pubMembersSelected = [];

function openCreateMenu() {
  const m = $('#create-menu-modal');
  if (!m) { openSubmitRules(); return; }
  m.classList.remove('hidden');
}
window.openNoPubModal = function openNoPubModal() {
  const m = $('#no-pub-modal');
  if (m) m.classList.remove('hidden');
  else toast('Сначала создайте издательство');
}
function closeCreateMenu() {
  $('#create-menu-modal')?.classList.add('hidden');
}

document.addEventListener('click', (e) => {
  const pl = e.target.closest && e.target.closest('.gp-publisher-link');
  if (pl) {
    e.preventDefault();
    openPublisherPage(+pl.dataset.pubId);
  }
});

function initCreateMenu() {
  if (window.__createMenuBound) return;
  window.__createMenuBound = true;
  document.querySelectorAll('[data-close-create-menu]').forEach(el => {
    el.addEventListener('click', closeCreateMenu);
  });
  $('#create-menu-game')?.addEventListener('click', async () => {
    closeCreateMenu();
    try {
      const pubs = await window.fetchMyPublishers(true);
      if (!pubs.length) {
        openNoPubModal();
        return;
      }
    } catch (e) {
      toast(e.message || 'Ошибка загрузки издательств');
      return;
    }
    openSubmitRules();
  });
  document.querySelectorAll('[data-close-no-pub]').forEach(el => {
    el.addEventListener('click', () => $('#no-pub-modal')?.classList.add('hidden'));
  });
  $('#no-pub-create')?.addEventListener('click', () => {
    $('#no-pub-modal')?.classList.add('hidden');
    openPubsCreateModal();
  });
  $('#create-menu-pubs')?.addEventListener('click', () => {
    closeCreateMenu();
    openPubsListModal();
  });
  document.querySelectorAll('[data-close-pubs-list]').forEach(el => {
    el.addEventListener('click', () => $('#pubs-list-modal')?.classList.add('hidden'));
  });
  document.querySelectorAll('[data-close-pubs-create]').forEach(el => {
    el.addEventListener('click', () => $('#pubs-create-modal')?.classList.add('hidden'));
  });
  $('#pubs-create-open')?.addEventListener('click', () => {
    $('#pubs-list-modal')?.classList.add('hidden');
    openPubsCreateModal();
  });
  $('#pub-create-save')?.addEventListener('click', saveNewPublisher);
  ['pub-name', 'pub-desc'].forEach(id => {
    const el = document.getElementById(id);
    if (!el || el.dataset.counterBound) return;
    el.dataset.counterBound = '1';
    el.addEventListener('input', updatePubFieldCounters);
  });
  // file previews
  const bindPrev = (inputId, prevId) => {
    const input = document.getElementById(inputId);
    const prev = document.getElementById(prevId);
    if (!input || input.dataset.bound) return;
    input.dataset.bound = '1';
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (!f || !prev) return;
      prev.style.backgroundImage = 'url(' + JSON.stringify(URL.createObjectURL(f)) + ')';
      prev.classList.add('has-img');
    });
  };
  bindPrev('pub-avatar', 'pub-avatar-preview');
  bindPrev('pub-banner', 'pub-banner-preview');
  // member search
  const search = $('#pub-member-search');
  let st = null;
  search?.addEventListener('input', () => {
    clearTimeout(st);
    st = setTimeout(() => searchPubMembers(search.value.trim()), 220);
  });
  window.openCreateMenu = openCreateMenu;
}

window.openPubsListModal = async function openPubsListModal() {
  const modal = $('#pubs-list-modal');
  const list = $('#pubs-list');
  if (!modal || !list) return;
  modal.classList.remove('hidden');

  const renderList = (pubs) => {
    if (!pubs.length) {
      list.innerHTML = '<div class="friends-empty">Пока нет издательств.<br>Создайте первое — и выбирайте его при публикации.</div>';
      return;
    }
    list.innerHTML = pubs.map(p => `
      <button type="button" class="pubs-list-item" data-id="${p.id}" data-slug="${escapeHtml(p.slug || '')}">
        <span class="pubs-list-av" style="${p.avatar_url ? `background-image:url('${escapeHtml(p.avatar_url)}')` : 'background:#ef5b2c'}">${p.avatar_url ? '' : escapeHtml((p.name || '?')[0])}</span>
        <span class="pubs-list-info">
          <strong>${escapeHtml(p.name)}</strong>
          <em>${p.games_count || 0} игр · ${p.members_count || 0} уч. · ${p.my_role === 'owner' ? 'владелец' : 'участник'}</em>
        </span>
      </button>`).join('');
    $$('.pubs-list-item', list).forEach(btn => {
      btn.addEventListener('click', () => {
        modal.classList.add('hidden');
        openPublisherPage(+btn.dataset.id, btn.dataset.slug);
      });
    });
  };

  // мгновенно из кэша после создания
  let pubs = [];
  if (window.__pendingPublishPublishers && window.__pendingPublishPublishers.length) {
    pubs = window.__pendingPublishPublishers;
  } else if (window.__myPublishersCache && Array.isArray(window.__myPublishersCache.list) && window.__myPublishersCache.list.length) {
    pubs = window.__myPublishersCache.list;
  }
  if (pubs.length) {
    renderList(pubs);
  } else {
    list.innerHTML = '<div class="loading">Загрузка...</div>';
  }

  try {
    const fresh = await window.fetchMyPublishers(true);
    if (Array.isArray(fresh)) {
      pubs = fresh;
      window.__pendingPublishPublishers = pubs;
      renderList(pubs);
    } else if (!pubs.length) {
      throw new Error('Ошибка');
    }
  } catch (e) {
    if (!pubs.length) {
      list.innerHTML = `<div class="friends-empty">${escapeHtml(e.message)}</div>`;
    }
  }
}

function updatePubFieldCounters() {
  const name = $('#pub-name');
  const desc = $('#pub-desc');
  const nameCount = $('#pub-name-count');
  const descCount = $('#pub-desc-count');
  if (name && nameCount) {
    const n = (name.value || '').length;
    nameCount.textContent = n + ' / 60';
    nameCount.classList.toggle('is-warn', n >= 50);
    nameCount.classList.toggle('is-over', n >= 60);
    name.classList.toggle('is-invalid', n > 0 && n < 2);
  }
  if (desc && descCount) {
    const n = (desc.value || '').length;
    descCount.textContent = n + ' / 300';
    descCount.classList.toggle('is-warn', n >= 260);
    descCount.classList.toggle('is-over', n >= 300);
  }
}

function openPubsCreateModal() {
  window.__pubMembersSelected = [];
  renderPubMemberChips();
  const name = $('#pub-name'); if (name) { name.value = ''; name.classList.remove('is-invalid'); }
  const desc = $('#pub-desc'); if (desc) desc.value = '';
  const av = $('#pub-avatar'); if (av) av.value = '';
  const bn = $('#pub-banner'); if (bn) bn.value = '';
  const ap = $('#pub-avatar-preview'); if (ap) { ap.style.backgroundImage = ''; ap.classList.remove('has-img'); }
  const bp = $('#pub-banner-preview'); if (bp) { bp.style.backgroundImage = ''; bp.classList.remove('has-img'); }
  $('#pub-member-suggest')?.classList.add('hidden');
  updatePubFieldCounters();
  $('#pubs-create-modal')?.classList.remove('hidden');
}

async function searchPubMembers(q) {
  const box = $('#pub-member-suggest');
  if (!box) return;
  if (!q) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  try {
    const data = await fetchJSON(PUB_API + '?action=search_users&q=' + encodeURIComponent(q));
    const users = (data.users || []).filter(u => !window.__pubMembersSelected.some(m => +m.id === +u.id));
    if (!users.length) {
      box.innerHTML = '<div class="pub-member-empty">Никого не найдено</div>';
      box.classList.remove('hidden');
      return;
    }
    box.innerHTML = users.map(u => `
      <button type="button" class="pub-member-opt" data-id="${u.id}" data-name="${escapeHtml(u.username)}">
        <span class="pubs-list-av" style="${u.avatar_url ? `background-image:url('${escapeHtml(u.avatar_url)}')` : `background:${escapeHtml(u.avatar_color || '#ef5b2c')}`}">${u.avatar_url ? '' : escapeHtml((u.username||'?')[0])}</span>
        ${escapeHtml(u.username)}
      </button>`).join('');
    box.classList.remove('hidden');
    $$('.pub-member-opt', box).forEach(b => {
      b.addEventListener('click', () => {
        window.__pubMembersSelected.push({ id: +b.dataset.id, username: b.dataset.name });
        renderPubMemberChips();
        box.classList.add('hidden');
        const s = $('#pub-member-search'); if (s) s.value = '';
      });
    });
  } catch (e) {
    box.classList.add('hidden');
  }
}

function renderPubMemberChips() {
  const box = $('#pub-member-chips');
  if (!box) return;
  box.innerHTML = (window.__pubMembersSelected || []).map(m => `
    <span class="pub-member-chip" data-id="${m.id}">
      ${escapeHtml(m.username)}
      <button type="button" data-rm="${m.id}" aria-label="Убрать">×</button>
    </span>`).join('');
  $$('[data-rm]', box).forEach(b => {
    b.addEventListener('click', () => {
      window.__pubMembersSelected = window.__pubMembersSelected.filter(m => +m.id !== +b.dataset.rm);
      renderPubMemberChips();
    });
  });
}

window.saveNewPublisher = async function saveNewPublisher() {
  const btn = $('#pub-create-save');
  const nameEl = $('#pub-name');
  const descEl = $('#pub-desc');
  const name = (nameEl?.value || '').trim();
  const desc = (descEl?.value || '').trim();
  if (name.length < 2) {
    nameEl?.classList.add('is-invalid');
    toast('Название: минимум 2 символа');
    return;
  }
  if (name.length > 60) {
    nameEl?.classList.add('is-invalid');
    toast('Название: максимум 60 символов');
    return;
  }
  if (desc.length > 300) {
    descEl?.classList.add('is-invalid');
    toast('Описание: максимум 300 символов');
    return;
  }
  nameEl?.classList.remove('is-invalid');
  descEl?.classList.remove('is-invalid');
  if (btn) { btn.disabled = true; btn.textContent = 'Создание...'; }
  try {
    const fd = new FormData();
    fd.append('csrf_token', window.CSRF_TOKEN || '');
    fd.append('name', name);
    fd.append('description', desc);
    fd.append('members', (window.__pubMembersSelected || []).map(m => m.id).join(','));
    const av = $('#pub-avatar')?.files?.[0];
    if (av) fd.append('avatar', av);
    const bn = $('#pub-banner')?.files?.[0];
    if (bn) fd.append('banner', bn);
    const res = await fetch(PUB_API + '?action=create', { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    toast('Издательство создано');
    $('#pubs-create-modal')?.classList.add('hidden');

    // Сразу кладём созданное издательство в кэш — можно публиковать без ожидания
    const created = data.publisher || {};
    const localPub = {
      id: created.id,
      name: created.name || name,
      slug: created.slug || '',
      avatar_url: created.avatar_url || null,
      owner_id: created.owner_id || (window.AUTH_STATE && window.AUTH_STATE.user && window.AUTH_STATE.user.id) || 0,
      my_role: 'owner',
      members_count: 1 + ((window.__pubMembersSelected || []).length || 0),
      games_count: 0
    };
    try {
      await window.fillPublishPublisherSelect(localPub);
    } catch (e) {
      console.warn(e);
    }
    try {
      const me = window.AUTH_STATE && window.AUTH_STATE.user;
      if (me && me.id && typeof loadProfilePublishers === 'function') {
        loadProfilePublishers(me.id);
      }
    } catch (e) {}
    openPubsListModal();
  } catch (e) {
    toast(e.message || 'Не удалось создать');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Создать'; }
  }
}


/* ===== Публикация: вкладки формы + сборки ===== */
window.__pendingBuilds = window.__pendingBuilds || [];


function initPubMediaTabs() {
  const tabs = document.getElementById('pub-media-tabs');
  if (!tabs || tabs.dataset.bound) return;
  tabs.dataset.bound = '1';
  const show = (name) => {
    tabs.querySelectorAll('.pub-media-tab').forEach(b => b.classList.toggle('active', b.dataset.mediaTab === name));
    const pane = document.querySelector('#submit-game-form [data-pub-pane="media"]');
    if (!pane) return;
    pane.querySelectorAll('[data-media-panel]').forEach(el => {
      el.style.display = (el.dataset.mediaPanel === name) ? '' : 'none';
    });
  };
  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.pub-media-tab');
    if (!btn) return;
    show(btn.dataset.mediaTab);
  });
  show('cover');
}

function switchPubTab(tab) {
  if (!tab) return;
  console.log('[pub] switch tab', tab);
  const modal = document.getElementById('submit-form-modal');
  if (!modal) return;
  modal.querySelectorAll('.pub-nav-btn').forEach(b => {
    const t = b.getAttribute('data-pub-tab');
    b.classList.toggle('active', t === tab);
  });
  modal.querySelectorAll('.pub-pane').forEach(p => {
    const on = p.getAttribute('data-pub-pane') === tab;
    p.classList.toggle('active', on);
    // clear inline styles from older code
    p.style.display = '';
  });
  if (tab === 'media') {
    try { initPubMediaTabs(); } catch (e) {}
  }
  try { updatePublishSectionStatus(); } catch (e) {}
}
window.switchPubTab = switchPubTab;

function initPubFormTabs() {
  if (window.__pubTabsDelegated) return;
  window.__pubTabsDelegated = true;
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('#pub-form-nav .pub-nav-btn, .pub-nav-btn[data-pub-tab]');
    if (!btn || !btn.closest('#submit-form-modal')) return;
    e.preventDefault();
    e.stopPropagation();
    const tab = btn.getAttribute('data-pub-tab') || btn.dataset.pubTab;
    switchPubTab(tab);
  }, true);
  // initial
  try { switchPubTab('main'); } catch (e) {}
}

function getPublishSectionStatus() {
  const title = ($('#sg-title')?.value || '').trim();
  const genres = $$('.sg-genre').filter(c => c.checked);
  const pubId = ($('#sg-publisher-id')?.value || '').trim();
  // description
  try { if (typeof syncPublishDescription === 'function') syncPublishDescription(); } catch (e) {}
  let desc = ($('#sg-desc')?.value || '').trim();
  if (!desc) {
    const ed = $('#sg-desc-editor');
    if (ed) desc = (ed.innerText || ed.textContent || '').trim();
  }
  const coverFile = $('#sg-cover')?.files?.[0];
  const coverUrl = ($('#sg-cover-url')?.value || '').trim();
  const hasCover = !!(coverFile || coverUrl);
  const buildVer = (document.getElementById('sg-build-version')?.value || '').trim();
  const buildFile = (typeof getSelectedBuildFile === 'function') ? getSelectedBuildFile() : document.getElementById('sg-build-file')?.files?.[0];
  const hasBuild = !!(buildVer && buildFile);

  return {
    main: !!(title && genres.length),
    desc: desc.length >= 10,
    media: hasCover,
    sys: true,
    lang: true,
    builds: hasBuild,
    content: true
  };
}

function updatePublishSectionStatus() {
  const st = getPublishSectionStatus();
  Object.keys(st).forEach(key => {
    const el = document.querySelector('#pub-form-nav [data-status-for="' + key + '"]');
    if (!el) return;
    const ok = !!st[key];
    el.textContent = ok ? '✓' : '✕';
    el.classList.toggle('is-ok', ok);
    el.classList.toggle('is-bad', !ok);
  });
  const allOk = Object.values(st).every(Boolean);
  const send = document.getElementById('submit-game-send');
  if (send) {
    const isAdminMod = !!(send.dataset.adminPublish || send.dataset.adminSave);
    const isPubEdit = !!(send.dataset.publisherEdit);
    // Не ставим disabled — клик покажет, чего не хватает. Только визуальный is-disabled.
    send.disabled = false;
    send.removeAttribute('disabled');
    if (isAdminMod) {
      send.classList.remove('is-disabled');
      send.title = '';
      send.dataset.blockReason = '';
    } else if (isPubEdit) {
      const verOk = !!(document.getElementById('sg-build-version')?.value || '').trim();
      const fileOk = !!(typeof getSelectedBuildFile === 'function' ? getSelectedBuildFile() : document.getElementById('sg-build-file')?.files?.[0]);
      const okUpd = verOk && fileOk;
      send.classList.toggle('is-disabled', !okUpd);
      send.title = okUpd ? '' : 'Укажите новую версию и прикрепите файл сборки';
      send.dataset.blockReason = okUpd ? '' : 'Укажите новую версию и прикрепите файл сборки';
    } else {
      send.classList.toggle('is-disabled', !allOk);
      const missing = [];
      if (!st.main) missing.push('название и жанры');
      if (!st.desc) missing.push('описание (от 10 символов)');
      if (!st.media) missing.push('обложку');
      if (!st.builds) missing.push('версию и файл сборки');
      const reason = missing.length ? ('Заполните: ' + missing.join(', ')) : '';
      send.title = reason;
      send.dataset.blockReason = reason;
    }
  }
  return allOk;
}
window.updatePublishSectionStatus = updatePublishSectionStatus;

function bindPublishValidationWatchers() {
  if (window.__pubValidateBound) return;
  window.__pubValidateBound = true;
  const form = document.getElementById('submit-game-form');
  if (!form) return;
  form.addEventListener('input', () => updatePublishSectionStatus());
  form.addEventListener('change', () => updatePublishSectionStatus());
  document.addEventListener('input', (e) => {
    if (e.target && (e.target.id === 'sg-desc-editor' || e.target.closest?.('#sg-desc-editor'))) {
      updatePublishSectionStatus();
    }
  });
}


function formatBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' Б';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' КБ';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' МБ';
  return (n / 1073741824).toFixed(2) + ' ГБ';
}

function renderPendingBuilds() {
  const box = document.getElementById('sg-builds-list');
  const hid = document.getElementById('sg-builds-json');
  if (!box) return;
  const list = window.__pendingBuilds || [];
  if (hid) {
    hid.value = JSON.stringify(list.map(b => ({
      version: b.version, platform: b.platform, changelog: b.changelog || '',
      file_name: b.file_name || (b.file && b.file.name) || '', file_size: b.file_size || (b.file && b.file.size) || 0,
      id: b.id || null, file_url: b.file_url || null
    })));
  }
  if (!list.length) {
    box.innerHTML = '<div class="settings-hint">Пока нет сборок — добавьте файл выше. При отправке игры они загрузятся вместе с карточкой.</div>';
    return;
  }
  box.innerHTML = list.map((b, i) => `
    <div class="build-item" data-idx="${i}">
      <div class="bi-meta">
        <div class="bi-title">${escapeHtml(b.version || '1.0')} · ${escapeHtml(b.platform || 'windows')}</div>
        <div class="bi-sub">${escapeHtml(b.file_name || (b.file && b.file.name) || b.file_url || 'файл')} · ${formatBytes(b.file_size || (b.file && b.file.size) || 0)}${b.changelog ? ' · ' + escapeHtml(String(b.changelog).slice(0, 80)) : ''}</div>
      </div>
      <button type="button" class="bi-del" data-del-build="${i}" title="Убрать">×</button>
    </div>`).join('');
  box.querySelectorAll('[data-del-build]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = +btn.dataset.delBuild;
      const item = window.__pendingBuilds[i];
      if (item && item.id) {
        try {
          await postJSON((typeof SUBMIT_API !== 'undefined' ? SUBMIT_API : 'api/submit.php') + '?action=delete_build', {
            csrf_token: window.CSRF_TOKEN || '', id: item.id
          });
        } catch (e) {
          toast(e.message || 'Не удалось удалить сборку');
          return;
        }
      }
      window.__pendingBuilds.splice(i, 1);
      renderPendingBuilds();
    });
  });
}

function getSelectedBuildFile() {
  const input = document.getElementById('sg-build-file');
  if (input && input.files && input.files[0]) return input.files[0];
  if (window.__selectedBuildFile instanceof File) return window.__selectedBuildFile;
  return null;
}
function setBuildFileLabel(file) {
  const nameEl = document.getElementById('sg-build-file-name');
  if (!nameEl) return;
  if (file) {
    const sz = (typeof formatBytes === 'function') ? formatBytes(file.size) : ((file.size / 1048576).toFixed(1) + ' МБ');
    nameEl.textContent = file.name + ' · ' + sz;
    nameEl.style.cssText = 'display:inline;opacity:1;visibility:visible;color:var(--text-bright)';
  } else {
    nameEl.textContent = 'ZIP / EXE / 7z…';
  }
}
function initBuildsUi() {
  const fileInput = document.getElementById('sg-build-file');
  const ver = document.getElementById('sg-build-version');
  const ch = document.getElementById('sg-build-changelog');
  const updateBuildName = () => {
    const f = getSelectedBuildFile();
    setBuildFileLabel(f);
    try { updatePublishSectionStatus(); } catch (e) {}
  };
  if (fileInput && fileInput.dataset.boundBuild !== '1') {
    fileInput.dataset.boundBuild = '1';
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files[0]) window.__selectedBuildFile = fileInput.files[0];
      updateBuildName();
    });
    const openBuild = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof openPubFilePicker === 'function') {
        openPubFilePicker(fileInput, {
          multiple: false,
          accept: '.exe,.zip,.7z,.rar,.msi,.dmg,.appimage,.tar,.gz,application/zip,application/octet-stream'
        });
      } else {
        fileInput.click();
      }
    };
    document.querySelectorAll('label[for="sg-build-file"]').forEach(lab => {
      lab.addEventListener('click', openBuild);
    });
    fileInput.addEventListener('click', openBuild);
  }
  if (ver && ver.dataset.boundBuild !== '1') {
    ver.dataset.boundBuild = '1';
    ver.addEventListener('input', () => { try { updatePublishSectionStatus(); } catch (e) {} });
    ver.addEventListener('change', () => { try { updatePublishSectionStatus(); } catch (e) {} });
  }
  if (ch && ch.dataset.boundBuild !== '1') {
    ch.dataset.boundBuild = '1';
    ch.addEventListener('input', () => { try { updatePublishSectionStatus(); } catch (e) {} });
  }
}

async function loadGameBuildsIntoForm(gameId) {
  if (!gameId) return;
  try {
    const data = await fetchJSON((typeof SUBMIT_API !== 'undefined' ? SUBMIT_API : 'api/submit.php') + '?action=list_builds&game_id=' + encodeURIComponent(gameId));
    if (!data.ok) return;
    const list = data.builds || [];
    const ver = document.getElementById('sg-build-version');
    const ch = document.getElementById('sg-build-changelog');
    const nameEl = document.getElementById('sg-build-file-name');
    const exist = document.getElementById('sg-build-existing');
    if (!list.length) {
      if (exist) { exist.style.display = 'none'; exist.textContent = ''; }
      return;
    }
    const b = list[0];
    if (ver) ver.value = b.version || '';
    if (ch) ch.value = b.changelog || '';
    const fname = b.file_name || (b.file_url ? String(b.file_url).split('/').pop() : '') || 'файл на сервере';
    const size = b.file_size_bytes ? (' · ' + formatBytes(b.file_size_bytes)) : '';
    if (nameEl) nameEl.textContent = fname + size + ' (на сервере)';
    if (exist) {
      exist.style.display = 'block';
      exist.innerHTML = '<strong>Текущая сборка:</strong> v' + escapeHtml(b.version || '—')
        + (b.changelog ? ' — ' + escapeHtml(String(b.changelog)) : '')
        + '<br>Файл: ' + escapeHtml(fname) + size
        + (b.status ? ' · статус: ' + escapeHtml(b.status) : '');
    }
  } catch (e) {
    console.warn('list_builds', e);
  }
}


/** Издательства: простой mine → select, без сложного кэша */
window.__myPublishersCache = window.__myPublishersCache || { list: null, ts: 0 };

window.fetchMyPublishers = async function fetchMyPublishers(force) {
  // force всегда = свежий запрос
  const api = (typeof PUB_API !== 'undefined' ? PUB_API : 'api/publishers.php');
  const url = api + '?action=mine&_t=' + Date.now();
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Accept': 'application/json' }
  });
  const text = await res.text();
  let data;
  try {
    const s = text.indexOf('{');
    data = JSON.parse(s >= 0 ? text.slice(s) : text);
  } catch (e) {
    console.error('[publishers] bad JSON', text.slice(0, 400));
    throw new Error('Ответ publishers не JSON');
  }
  if (!data || data.ok === false) {
    throw new Error((data && data.error) || ('HTTP ' + res.status));
  }
  const pubs = Array.isArray(data.publishers) ? data.publishers : [];
  console.log('[publishers] mine', pubs.length, pubs.map(p => p.id + ':' + p.name));
  window.__myPublishersCache = { list: pubs, ts: Date.now() };
  window.__pendingPublishPublishers = pubs;
  return pubs;
};

window.applyPublisherOptionsToSelect = function applyPublisherOptionsToSelect(sel, pubs, prefer) {
  if (!sel) return;
  const isAdmin = !!(window.AUTH_STATE && window.AUTH_STATE.user && (
    window.AUTH_STATE.user.role === 'admin' || window.AUTH_STATE.user.is_admin
  ));

  try {
    const oldWrap = sel.closest('.catio-select');
    if (oldWrap && oldWrap.parentNode) {
      oldWrap.parentNode.insertBefore(sel, oldWrap);
      oldWrap.remove();
    }
  } catch (e) {}
  delete sel.dataset.catioEnhanced;
  // прячем нативный — рисуем кастомный с аватарками
  sel.classList.add('settings-select', 'select-native-hidden');
  sel.classList.remove('hidden');
  sel.hidden = false;
  sel.disabled = false;
  sel.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;';
  sel.removeAttribute('aria-hidden');

  const list = Array.isArray(pubs) ? pubs.filter(p => p && p.id != null) : [];

  while (sel.options.length > 0) sel.remove(0);
  if (isAdmin) {
    const empty = new Option('— без издательства —', '', false, false);
    empty.dataset.avatar = '';
    empty.dataset.kind = 'empty';
    sel.add(empty);
  }
  list.forEach(p => {
    const opt = new Option(String(p.name || ('#' + p.id)), String(p.id), false, false);
    opt.dataset.avatar = p.avatar_url || p.avatar || '';
    opt.dataset.kind = 'pub';
    sel.add(opt);
  });

  const pref = prefer != null && prefer !== '' ? String(prefer) : '';
  if (pref && list.some(p => String(p.id) === pref)) {
    sel.value = pref;
  } else if (!isAdmin && list.length >= 1) {
    sel.value = String(list[0].id);
  } else if (list.length === 1 && isAdmin) {
    sel.value = String(list[0].id);
  } else if (!isAdmin && list.length === 0) {
    sel.value = '';
  } else {
    sel.value = isAdmin ? '' : (list[0] ? String(list[0].id) : '');
  }

  const hid = document.getElementById('sg-publisher');
  const syncHid = () => {
    const c = list.find(p => String(p.id) === String(sel.value));
    if (hid) hid.value = c ? (c.name || '') : '';
  };
  syncHid();
  sel.onchange = () => {
    syncHid();
    updatePublisherAdminHint(sel);
    rebuildPublisherSelectUI(sel, list);
  };

  updatePublisherAdminHint(sel);
  rebuildPublisherSelectUI(sel, list);

  console.log('[publishers] applied to #' + (sel.id || '?'), 'options=', sel.options.length, 'admin=', isAdmin);
};

function updatePublisherAdminHint(sel) {
  if (!sel) return;
  const label = sel.closest('label.settings-label') || sel.parentElement;
  if (!label) return;
  let head = label.querySelector('.sg-pub-label-row');
  if (!head) {
    head = document.createElement('div');
    head.className = 'sg-pub-label-row';
    const title = label.querySelector('.sg-pub-label-title, :scope > span');
    if (title) {
      title.classList.add('sg-pub-label-title');
      head.appendChild(title);
    } else {
      const t = document.createElement('span');
      t.className = 'sg-pub-label-title';
      t.textContent = 'Издательство';
      head.appendChild(t);
    }
    const hint = document.createElement('span');
    hint.className = 'sg-pub-admin-hint';
    hint.hidden = true;
    head.appendChild(hint);
    label.insertBefore(head, label.firstChild);
  }
  const hint = head.querySelector('.sg-pub-admin-hint');
  if (!hint) return;
  if (!sel.value) {
    hint.hidden = false;
    hint.textContent = 'Доступно только админам';
  } else {
    hint.hidden = true;
    hint.textContent = '';
  }
}

/** Простой дропдаун издательств — без аватарок, высота как у input */
function rebuildPublisherSelectUI(sel, list) {
  if (!sel) return;
  const parent = sel.parentElement;
  if (!parent) return;

  parent.querySelectorAll(':scope > .catio-select, :scope > .sg-pub-dd').forEach(n => n.remove());

  const wrap = document.createElement('div');
  wrap.className = 'sg-pub-dd';
  parent.appendChild(wrap);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sg-pub-dd-btn';
  wrap.appendChild(btn);

  const menu = document.createElement('div');
  menu.className = 'sg-pub-dd-menu';
  wrap.appendChild(menu);

  const isAdmin = !!(window.AUTH_STATE && window.AUTH_STATE.user && (
    window.AUTH_STATE.user.role === 'admin' || window.AUTH_STATE.user.is_admin
  ));

  const paintBtn = () => {
    const v = sel.value;
    let text;
    if (!v) {
      text = isAdmin ? '— без издательства —' : 'Выберите издательство';
    } else {
      const opt = sel.selectedOptions[0];
      text = (opt && opt.textContent) || ('#' + v);
    }
    btn.innerHTML = '';
    const t = document.createElement('span');
    t.className = 'sg-pub-dd-txt';
    t.textContent = text;
    btn.appendChild(t);
    const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chev.setAttribute('class', 'sg-pub-dd-chev');
    chev.setAttribute('width', '16');
    chev.setAttribute('height', '16');
    chev.setAttribute('viewBox', '0 0 24 24');
    chev.setAttribute('fill', 'none');
    chev.setAttribute('stroke', 'currentColor');
    chev.setAttribute('stroke-width', '2');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M6 9l6 6 6-6');
    chev.appendChild(path);
    btn.appendChild(chev);
  };

  menu.innerHTML = '';
  [...sel.options].forEach(opt => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'sg-pub-dd-opt' + (String(opt.value) === String(sel.value) ? ' is-on' : '');
    row.textContent = opt.textContent;
    row.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      wrap.classList.remove('is-open');
      menu.querySelectorAll('.sg-pub-dd-opt').forEach(x => x.classList.toggle('is-on', x === row));
      paintBtn();
    });
    menu.appendChild(row);
  });

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const open = wrap.classList.toggle('is-open');
    if (open) {
      document.querySelectorAll('.sg-pub-dd.is-open').forEach(w => {
        if (w !== wrap) w.classList.remove('is-open');
      });
    }
  });

  paintBtn();
}

document.addEventListener('click', function(e) {
  if (!e.target.closest || e.target.closest('.sg-pub-dd')) return;
  document.querySelectorAll('.sg-pub-dd.is-open').forEach(w => w.classList.remove('is-open'));
});

window.fillPublishPublisherSelect = async function fillPublishPublisherSelect(preloaded) {
  // Ищем select максимально широко
  const formModal = document.getElementById('submit-form-modal');
  const candidates = [];
  if (formModal) candidates.push(...formModal.querySelectorAll('#sg-publisher-id, select[name="publisher_id"]'));
  const byId = document.getElementById('sg-publisher-id');
  if (byId) candidates.push(byId);
  document.querySelectorAll('select[name="publisher_id"]').forEach(s => candidates.push(s));
  // unique
  const sels = [...new Set(candidates.filter(Boolean))];
  if (!sels.length) {
    console.warn('[publishers] #sg-publisher-id не найден в DOM');
    return [];
  }

  let pubs = null;
  if (Array.isArray(preloaded) && preloaded.length) {
    pubs = preloaded.slice();
  } else if (preloaded && typeof preloaded === 'object' && preloaded.id != null) {
    // один объект — всё равно подтянем полный список
    try { pubs = await window.fetchMyPublishers(true); } catch (e) { pubs = [preloaded]; }
  } else {
    try {
      pubs = await window.fetchMyPublishers(true);
    } catch (e) {
      console.error('[publishers] load failed', e);
      pubs = (window.__myPublishersCache && window.__myPublishersCache.list) || [];
      try { toast('Не удалось загрузить издательства: ' + (e.message || e)); } catch (e2) {}
    }
  }
  if (!Array.isArray(pubs)) pubs = [];

  let prefer = '';
  if (preloaded != null && (typeof preloaded === 'number' || typeof preloaded === 'string')) {
    prefer = String(preloaded);
  } else if (preloaded && preloaded.id != null) {
    prefer = String(preloaded.id);
  } else if (sels[0] && sels[0].value) {
    prefer = String(sels[0].value);
  }

  sels.forEach(sel => applyPublisherOptionsToSelect(sel, pubs, prefer));

  // Повтор через кадр — на случай form.reset() / перерисовки сразу после
  requestAnimationFrame(() => {
    sels.forEach(sel => {
      if (sel.options.length <= 1 && pubs.length > 0) {
        applyPublisherOptionsToSelect(sel, pubs, prefer);
      }
    });
  });
  setTimeout(() => {
    sels.forEach(sel => {
      if (sel.options.length <= 1 && pubs.length > 0) {
        console.warn('[publishers] re-apply after timeout');
        applyPublisherOptionsToSelect(sel, pubs, prefer);
      }
    });
  }, 50);
  setTimeout(() => {
    sels.forEach(sel => {
      if (sel.options.length <= 1 && pubs.length > 0) {
        applyPublisherOptionsToSelect(sel, pubs, prefer);
      }
    });
  }, 300);

  return pubs;
};


async function openPublisherPage(id, slug) {
  $$('.view').forEach(v => v.classList.remove('active'));
  const view = $('#view-publisher');
  if (view) view.classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.remove('active'));
  try {
    const url = new URL(location.href);
    url.searchParams.set('view', 'publisher');
    if (id) url.searchParams.set('pub', String(id));
    history.pushState({}, '', url);
  } catch (e) {}
  const headTitle = $('#head-title');
  if (headTitle) headTitle.textContent = 'Издательство';
  const nameEl = $('#pub-page-name');
  const descEl = $('#pub-page-desc');
  const gamesEl = $('#pub-page-games');
  const memEl = $('#pub-page-members');
  const av = $('#pub-page-avatar');
  const ban = $('#pub-page-banner');
  const actionsEl = $('#pub-page-actions');
  const playersNum = $('#pub-players-num');
  const gamesCountEl = $('#pub-games-count');
  const membersCountEl = $('#pub-members-count');
  if (gamesEl) gamesEl.innerHTML = '<div class="loading">Загрузка...</div>';
  if (actionsEl) actionsEl.innerHTML = '';
  try {
    const q = id ? ('id=' + id) : ('slug=' + encodeURIComponent(slug || ''));
    const data = await fetchJSON(PUB_API + '?action=get&' + q);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const p = data.publisher;
    if (nameEl) nameEl.textContent = p.name || '';
    if (descEl) descEl.textContent = p.description || '';
    if (av) {
      if (p.avatar_url) {
        av.style.backgroundImage = 'url(' + JSON.stringify(p.avatar_url) + ')';
        av.textContent = '';
      } else {
        av.style.backgroundImage = '';
        av.style.background = '#ef5b2c';
        av.textContent = (p.name || '?')[0];
      }
    }
    if (ban) {
      if (p.banner_url) {
        ban.style.backgroundImage = 'url(' + JSON.stringify(p.banner_url) + ')';
        ban.classList.add('has-image');
      } else {
        ban.style.backgroundImage = '';
        ban.classList.remove('has-image');
      }
    }
    if (playersNum) playersNum.textContent = String(p.players_count || 0);
    const list = p.members || [];
    if (membersCountEl) membersCountEl.textContent = String(list.length);
    if (memEl) {
      const html = list.length ? list.map(m => {
        const avStyle = m.avatar_url
          ? ('background-image:url(' + JSON.stringify(m.avatar_url) + ')')
          : ('background:' + (m.avatar_color || '#ef5b2c'));
        const letter = m.avatar_url ? '' : escapeHtml((m.username || '?').slice(0, 1).toUpperCase());
        const role = m.role === 'owner' ? 'владелец' : 'участник';
        return '<div class="hp-friend-row pub-member-row" data-username="' + escapeHtml(m.username) + '" data-id="' + m.id + '" role="button" tabindex="0">' +
          '<div class="hp-friend-avatar" style="' + avStyle + '">' + letter + '</div>' +
          '<div class="hp-friend-text">' +
            '<div class="hp-friend-name">' + escapeHtml(m.username) + '</div>' +
            '<div class="hp-friend-status">' + role + '</div>' +
          '</div></div>';
      }).join('') : '<div class="settings-hint" style="padding:8px 6px">Нет участников</div>';
      // через setAccordionHTML — сохраняем .acc-inner для корректного схлопывания
      if (typeof setAccordionHTML === 'function') setAccordionHTML(memEl, html);
      else memEl.innerHTML = html;
      $$('.pub-member-row', memEl).forEach(r => {
        r.addEventListener('click', () => openUserProfile(r.dataset.username, r.dataset.id));
      });
    }
    // accordion toggle for members — один обработчик, как в профиле
    const memCard = $('#pub-members-card');
    if (memCard && !memCard.dataset.toggleBound) {
      memCard.dataset.toggleBound = '1';
      const body = memCard.querySelector('.hp-side-body');
      const toggleBtn = memCard.querySelector('.hp-side-toggle');
      if (body) ensureAccordionInner(body);
      const onToggle = (e) => {
        if (e) e.stopPropagation();
        if (!body) return;
        const collapsed = animateAccordion(memCard, body, 'is-collapsed');
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      };
      // клик по шапке (включая стрелку) — один раз
      const head = memCard.querySelector('.hp-side-head');
      if (head) head.addEventListener('click', onToggle);
    }
    if (p.name && headTitle) headTitle.textContent = p.name;
    const games = p.games || [];
    if (gamesCountEl) gamesCountEl.textContent = String(games.length);
    const gamesSectionHead = document.querySelector('#view-publisher .hp-section-head');
    if (gamesEl) {
      gamesEl.classList.remove('store-grid');
      gamesEl.classList.add('hp-games-grid');
      if (!games.length) {
        if (gamesSectionHead) gamesSectionHead.style.display = 'none';
        gamesEl.classList.add('is-empty');
        gamesEl.innerHTML = `<div class="hp-empty hp-empty-centered">
          <div class="hp-empty-logo" aria-hidden="true">
            ${icon('table', 40)}
          </div>
          <div class="hp-empty-text">Пока нет опубликованных игр</div>
        </div>`;
      } else {
        if (gamesSectionHead) gamesSectionHead.style.display = '';
        gamesEl.classList.remove('is-empty');
        const byId = {};
        games.forEach(g => { byId[String(g.id)] = g; });
        gamesEl.innerHTML = games.map(g => publisherGameCardHtml(g)).join('');
        $$('.hp-game-card', gamesEl).forEach(c => {
          const g = byId[String(c.dataset.id)];
          c.addEventListener('click', (e) => {
            if (e.target.closest('.game-item__plus-wrapper') || e.target.closest('.hp-game-price')) return;
            gotoGame(+c.dataset.id);
          });
          const plus = c.querySelector('.game-item__plus-wrapper.is-add');
          if (plus && g) {
            plus.addEventListener('click', async (e) => {
              e.stopPropagation();
              e.preventDefault();
              if (plus.disabled) return;
              const price = formatPrice(g.price, g.discount_percent);
              plus.disabled = true;
              try {
                if (price.className === 'free' || g.purchased) {
                  const data = await postJSON(API_BASE + '?action=buy', { game_id: g.id });
                  if (!data.ok) throw new Error(data.error || 'Не удалось оформить');
                  if (data.balance !== undefined && typeof updateBalance === 'function') updateBalance(data.balance);
                  g.owned = true;
                  markStoreRowOwned(plus);
                  const priceEl = c.querySelector('.hp-game-price');
                  if (priceEl) priceEl.remove();
                  try { if (typeof sideLibAddOptimistic === 'function') sideLibAddOptimistic(g); } catch (err) {}
                  toast(data.message || ('«' + (g.title || 'Игра') + '» добавлена в библиотеку'));
                } else {
                  const ok = typeof addToCart === 'function' && addToCart(g);
                  if (ok) {
                    plus.remove();
                    if (typeof showAddToCartModal === 'function') showAddToCartModal(g);
                    else toast('Добавлено в корзину');
                  } else {
                    plus.disabled = false;
                  }
                }
              } catch (err) {
                plus.disabled = false;
                toast(err.message || 'Ошибка');
              }
            });
          }
        });
      }
    }
    // кнопки в toolbar
    if (actionsEl) {
      const isOwner = !!p.is_owner;
      const isSub = !!p.is_subscribed;
      if (isOwner) {
        actionsEl.innerHTML = `
          <button type="button" class="hp-btn-edit hp-btn-icon" id="pub-btn-edit" title="Редактировать" aria-label="Редактировать">
            ${icon('edit', 16)}
          </button>
          <button type="button" class="hp-btn-logout hp-btn-danger" id="pub-btn-delete" title="Удалить издательство">
            ${icon('trash', 14)}
            Удалить
          </button>`;
        $('#pub-btn-edit')?.addEventListener('click', () => {
          toast('Редактирование издательства — скоро');
        });
        $('#pub-btn-delete')?.addEventListener('click', async () => {
          if (!confirm('Удалить издательство «' + (p.name || '') + '»? Игры останутся, но без привязки.')) return;
          try {
            const res = await postJSON(PUB_API + '?action=delete', {
              csrf_token: window.CSRF_TOKEN || '',
              publisher_id: p.id
            });
            if (!res.ok) throw new Error(res.error || 'Ошибка');
            toast('Издательство удалено');
            showView('home');
          } catch (err) {
            toast(err.message || 'Не удалось удалить');
          }
        });
      } else {
        const starSvg = icon('star', 16);
        actionsEl.innerHTML = `
          <button type="button" class="hp-btn-subscribe${isSub ? ' is-subscribed' : ''}" id="pub-btn-sub" data-sub="${isSub ? '1' : '0'}">
            ${starSvg}
            <span>${isSub ? 'Вы подписаны' : 'Подписаться'}</span>
          </button>`;
        const btn = $('#pub-btn-sub');
        btn?.addEventListener('click', async () => {
          const nowSub = btn.dataset.sub === '1';
          btn.disabled = true;
          try {
            const act = nowSub ? 'unsubscribe' : 'subscribe';
            const res = await postJSON(PUB_API + '?action=' + act, {
              csrf_token: window.CSRF_TOKEN || '',
              publisher_id: p.id
            });
            if (!res.ok) throw new Error(res.error || 'Ошибка');
            const sub = !!res.subscribed;
            btn.dataset.sub = sub ? '1' : '0';
            btn.classList.toggle('is-subscribed', sub);
            const span = btn.querySelector('span');
            if (span) span.textContent = sub ? 'Вы подписаны' : 'Подписаться';
            toast(sub ? 'Подписка оформлена — скидки этого издательства будут в уведомлениях' : 'Подписка отменена');
          } catch (err) {
            toast(err.message || 'Ошибка');
          } finally {
            btn.disabled = false;
          }
        });
      }
    }
  } catch (e) {
    if (gamesEl) gamesEl.innerHTML = `<div class="friends-empty">${escapeHtml(e.message)}</div>`;
  }
}
window.openPublisherPage = openPublisherPage;

// ===== Издательство в профиле =====
window.__pubLineToken = 0;


