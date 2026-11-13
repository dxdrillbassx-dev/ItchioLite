/* CATio — export progress modal + Steam/classic import */

// ===== Модалка прогресса экспорта =====
function ensureExportProgressModal() {
  let modal = document.getElementById('export-progress-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'export-progress-modal';
  modal.className = 'submit-modal hidden';
  modal.innerHTML = `
    <div class="submit-modal-backdrop" id="export-progress-backdrop"></div>
    <div class="submit-modal-box" style="max-width:520px">
      <div class="submit-modal-head">
        <h2 style="margin:0;font-size:1.05rem">Экспорт пакета</h2>
        <button type="button" class="modal-close" id="export-progress-close" aria-label="Закрыть">×</button>
      </div>
      <div style="padding:14px 16px 18px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:10px">
          <span id="export-progress-label" style="font-size:0.85rem;color:var(--text-muted)">Подготовка…</span>
          <span id="export-progress-pct" style="font-weight:700;font-variant-numeric:tabular-nums">0%</span>
        </div>
        <div style="height:10px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden">
          <div id="export-progress-bar" style="height:100%;width:0%;background:var(--accent,#ef5b2c);transition:width .2s ease"></div>
        </div>
        <div id="export-progress-console" style="margin-top:14px;height:220px;overflow:auto;background:#0d0c0b;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.45;color:#c8f5c0"></div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#export-progress-close')?.addEventListener('click', () => {
    if (modal.dataset.busy === '1') return;
    modal.classList.add('hidden');
  });
  modal.querySelector('#export-progress-backdrop')?.addEventListener('click', () => {
    if (modal.dataset.busy === '1') return;
    modal.classList.add('hidden');
  });
  return modal;
}

function exportProgressReset() {
  const modal = ensureExportProgressModal();
  const bar = document.getElementById('export-progress-bar');
  const pct = document.getElementById('export-progress-pct');
  const label = document.getElementById('export-progress-label');
  const cons = document.getElementById('export-progress-console');
  if (bar) bar.style.width = '0%';
  if (pct) pct.textContent = '0%';
  if (label) label.textContent = 'Подготовка…';
  if (cons) cons.innerHTML = '';
  modal.dataset.busy = '1';
  modal.classList.remove('hidden');
  return modal;
}

function exportProgressLog(msg, pct) {
  const cons = document.getElementById('export-progress-console');
  const bar = document.getElementById('export-progress-bar');
  const pctEl = document.getElementById('export-progress-pct');
  const label = document.getElementById('export-progress-label');
  if (cons && msg != null && msg !== '') {
    const line = document.createElement('div');
    line.textContent = msg;
    cons.appendChild(line);
    cons.scrollTop = cons.scrollHeight;
  }
  if (typeof pct === 'number' && !Number.isNaN(pct)) {
    const p = Math.max(0, Math.min(100, pct));
    if (bar) bar.style.width = p + '%';
    if (pctEl) pctEl.textContent = p + '%';
  }
  if (label && msg) {
    const short = String(msg).replace(/^\s*→\s*/, '').slice(0, 64);
    label.textContent = short;
  }
}

async function runGamePackExport(gameId) {
  const modal = exportProgressReset();
  exportProgressLog('$ export game #' + gameId, 1);
  try {
    const url = 'api/game_pack.php?action=export&stream=1&game_id=' + encodeURIComponent(gameId) + '&_t=' + Date.now();
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok || !res.body) {
      let msg = 'Ошибка экспорта (' + res.status + ')';
      try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let token = null;
    let filename = 'game-pack-' + gameId + '.zip';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        let row;
        try { row = JSON.parse(s); } catch (e) {
          exportProgressLog(s);
          continue;
        }
        if (row.error && row.ok === false) throw new Error(row.error);
        if (row.msg) exportProgressLog(row.msg, typeof row.pct === 'number' ? row.pct : undefined);
        else if (typeof row.pct === 'number') exportProgressLog(null, row.pct);
        if (row.token) token = row.token;
        if (row.filename) filename = row.filename;
        if (row.phase === 'done' && row.ok) {
          exportProgressLog('Скачивание ' + filename + '…', 100);
        }
      }
    }
    if (!token) throw new Error('Сервер не вернул token пакета');
    exportProgressLog('Загрузка ZIP…', 100);
    const dl = await fetch('api/game_pack.php?action=export_download&token=' + encodeURIComponent(token) + '&filename=' + encodeURIComponent(filename), { credentials: 'same-origin' });
    if (!dl.ok) throw new Error('Не удалось скачать ZIP');
    const blob = await dl.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    exportProgressLog('Готово ✓', 100);
    toast('Пакет скачан');
    modal.dataset.busy = '0';
  } catch (err) {
    exportProgressLog('ERROR: ' + (err.message || err), undefined);
    toast(err.message || 'Не удалось экспортировать');
    modal.dataset.busy = '0';
  }
}

function initSubmitGame() {
  try { bindSubmitPackImport(); } catch (e) { console.warn(e); }
  // Делегирование: работает даже если кнопку перерисуют и если другие init упали раньше
  if (!window.__submitGameDelegated) {
    window.__submitGameDelegated = true;
    document.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('#btn-add-game');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof openCreateMenu === 'function') openCreateMenu();
        else openSubmitRules();
      }
    });
  }

  const agree = $('#submit-agree');
  const next = $('#submit-rules-next');
  if (agree && next && !next.dataset.bound) {
    next.dataset.bound = '1';
    agree.addEventListener('change', () => { next.disabled = !agree.checked; });
    next.addEventListener('click', () => {
      $('#submit-rules-modal')?.classList.add('hidden');
      const formModal = $('#submit-form-modal');
      if (formModal) {
        try { resetPublishFormMode(); } catch (e) {}
        try { ensurePublishAdminFooter(formModal, {}, null); } catch (e) {}
        try { renderLangTable('#sg-lang-table', []); } catch (err) { console.warn(err); }
        formModal.classList.remove('hidden');
        const fillBtn = $('#sg-steam-fill');
        if (fillBtn && !fillBtn.dataset.bound) {
          fillBtn.dataset.bound = '1';
          fillBtn.addEventListener('click', fillSubmitFromSteam);
        }
        try { initPublishFilePreviews(formModal); initPublishPriceInput(); initPublishRte(); ensureTrailersEditorUi(); renderTrailersEditor(['']); } catch (e) {}
        try {
          initPubFormTabs();
          initPubMediaTabs();
          initBuildsUi();
          bindPublishValidationWatchers();
          updatePublishSectionStatus();
          window.__pendingBuilds = [];
          renderPendingBuilds();
          window.fillPublishPublisherSelect().then((pubs) => {
            console.log('[publishers] after form open', pubs && pubs.length);
            try { initCatioSelects(formModal); } catch (e2) {}
            // ещё раз после catio — на случай если что-то сбросило options
            return window.fillPublishPublisherSelect(pubs);
          }).catch((err) => {
            console.warn(err);
            try { initCatioSelects(formModal); } catch (e2) {}
            try { window.fillPublishPublisherSelect(); } catch (e3) {}
          });
        } catch (e) {
          try { initCatioSelects(formModal); } catch (e2) {}
        }
        try {
          $$('.sg-genre').forEach(c => {
            if (c.dataset.boundGenre) return;
            c.dataset.boundGenre = '1';
            c.addEventListener('change', syncPublishGenres);
          });
        } catch (e) {}
      }
    });
  }

  // защита: после открытия file dialog WebView шлёт «ghost click» на backdrop
  window.__pubFileDialogOpen = false;
  window.__pubFileDialogTs = 0;

  $$('[data-close]').forEach(el => {
    if (el.dataset.closeBound) return;
    el.dataset.closeBound = '1';
    el.addEventListener('click', (e) => {
      const k = el.dataset.close;
      if (k === 'form') {
        // не закрывать, если только что выбирали файл
        if (window.__pubFileDialogOpen) return;
        if (Date.now() - (window.__pubFileDialogTs || 0) < 800) return;
        try { resetPublishFormMode(); } catch (e) {}
        $('#submit-form-modal')?.classList.add('hidden');
        return;
      }
      if (k === 'rules') $('#submit-rules-modal')?.classList.add('hidden');
      if (k === 'done') $('#submit-done-modal')?.classList.add('hidden');
    });
  });

  const send = $('#submit-game-send');
  if (send && !send.dataset.bound) {
    send.dataset.bound = '1';
    send.addEventListener('click', submitGameForm);
  }
}


async function fillSubmitFromSteam() {
  toast('Импорт из Steam отключён. Используй ZIP (tools/steam-export.bat).');
}


/**
 * Стилизованный confirm вместо window.confirm.
 * requireFriendCode: true — нужно посимвольно ввести свой код друга.
 * @returns {Promise<boolean>}
 */
function appConfirm({
  title = 'Подтверждение',
  message = '',
  okText = 'OK',
  cancelText = 'Отмена',
  danger = false,
  requireFriendCode = false
} = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById('app-confirm-modal');
    if (!modal) {
      resolve(window.confirm(message || title));
      return;
    }
    const t = document.getElementById('app-confirm-title');
    const s = document.getElementById('app-confirm-sub');
    const ok = document.getElementById('app-confirm-ok');
    const cancel = document.getElementById('app-confirm-cancel');
    const icon = document.getElementById('app-confirm-icon');
    const pinWrap = document.getElementById('app-confirm-pin');
    const pinCells = document.getElementById('app-confirm-pin-cells');
    const pinHint = document.getElementById('app-confirm-pin-hint');
    const pinErr = document.getElementById('app-confirm-pin-error');

    const expectedCode = String(
      (typeof getMyFriendCode === 'function' ? getMyFriendCode() : '') ||
      (window.AUTH_STATE && window.AUTH_STATE.user && window.AUTH_STATE.user.friend_code) ||
      ''
    ).toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (t) t.textContent = title;
    if (s) {
      s.textContent = message || '';
      s.style.display = message ? '' : 'none';
    }
    if (ok) {
      ok.textContent = okText;
      ok.classList.toggle('is-danger', !!danger);
    }
    if (cancel) cancel.textContent = cancelText;
    if (icon) icon.classList.toggle('is-warn', !!danger);

    const needPin = !!(requireFriendCode && expectedCode && pinWrap && pinCells);
    let inputs = [];

    const getEntered = () => inputs.map(i => (i.value || '').toUpperCase()).join('');

    const syncOkEnabled = () => {
      if (!ok) return;
      if (!needPin) {
        ok.disabled = false;
        ok.classList.remove('is-disabled');
        return;
      }
      const ready = getEntered().length === expectedCode.length;
      ok.disabled = !ready;
      ok.classList.toggle('is-disabled', !ready);
    };

    const clearPinError = () => {
      if (pinErr) pinErr.classList.add('hidden');
      pinCells && pinCells.classList.remove('is-error');
    };

    if (pinWrap) pinWrap.classList.toggle('hidden', !needPin);
    if (pinCells) pinCells.innerHTML = '';
    clearPinError();

    if (needPin) {
      if (pinHint) {
        pinHint.textContent = 'Введите «' + expectedCode + '» по символам';
      }
      for (let i = 0; i < expectedCode.length; i++) {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.inputMode = 'text';
        inp.autocomplete = 'off';
        inp.spellcheck = false;
        inp.maxLength = 1;
        inp.className = 'app-confirm-pin-cell';
        inp.setAttribute('aria-label', 'Символ ' + (i + 1));
        inp.addEventListener('input', () => {
          clearPinError();
          let v = (inp.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          inp.value = v.slice(0, 1);
          if (inp.value && i < inputs.length - 1) inputs[i + 1].focus();
          syncOkEnabled();
        });
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Backspace' && !inp.value && i > 0) {
            inputs[i - 1].focus();
            inputs[i - 1].value = '';
            syncOkEnabled();
          }
          if (e.key === 'Enter' && !ok.disabled) ok.click();
        });
        inp.addEventListener('paste', (e) => {
          e.preventDefault();
          clearPinError();
          const text = String((e.clipboardData || window.clipboardData).getData('text') || '')
            .toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (!text) return;
          for (let j = 0; j < expectedCode.length; j++) {
            inputs[j].value = text[j] || '';
          }
          const focusIdx = Math.min(text.length, expectedCode.length) - 1;
          if (focusIdx >= 0) inputs[Math.min(focusIdx + 1, expectedCode.length - 1)].focus();
          syncOkEnabled();
        });
        pinCells.appendChild(inp);
        inputs.push(inp);
      }
      ok.disabled = true;
      ok.classList.add('is-disabled');
    } else {
      if (ok) {
        ok.disabled = false;
        ok.classList.remove('is-disabled');
      }
    }

    const finish = (val) => {
      modal.classList.add('hidden');
      if (pinCells) pinCells.innerHTML = '';
      modal.querySelectorAll('[data-confirm-cancel], #app-confirm-ok').forEach(el => {
        el.onclick = null;
      });
      resolve(val);
    };

    ok.onclick = () => {
      if (needPin) {
        const entered = getEntered();
        if (entered !== expectedCode) {
          if (pinErr) {
            pinErr.textContent = 'Неверный код друга';
            pinErr.classList.remove('hidden');
          }
          pinCells.classList.add('is-error');
          inputs.forEach(i => { i.value = ''; });
          if (inputs[0]) inputs[0].focus();
          syncOkEnabled();
          return;
        }
      }
      finish(true);
    };
    modal.querySelectorAll('[data-confirm-cancel]').forEach(el => {
      el.onclick = () => finish(false);
    });
    modal.classList.remove('hidden');
    if (needPin && inputs[0]) setTimeout(() => inputs[0].focus(), 40);
  });
}

function clearInstalledGame(gameId) {
  const m = getInstallMap();
  delete m[String(gameId)];
  setInstallMap(m);
  try {
    const ids = getInstalledIds().filter(id => +id !== +gameId);
    localStorage.setItem('catio_installed', JSON.stringify(ids));
  } catch (e) {}
}


function fillGameSettingsPath(g) {
  const gameId = g && g.id ? g.id : window.__steamEditGameId;
  const title = (g && g.title) || 'game';
  const slug = (g && g.slug) || ('game_' + gameId);
  const versions = getInstalledVersions(gameId) || {};
  const pref = getPreferredVersion(gameId);
  const hasInst = Object.keys(versions).length > 0;
  const base = 'AppData\\\\Roaming\\\\CATio\\\\games\\\\' + String(slug).replace(/[^\\w\\-]+/g, '_');
  const exeEl = document.getElementById('sgdb-exe-path');
  const instEl = document.getElementById('sgdb-install-path');
  const savesEl = document.getElementById('sgdb-saves-path');
  if (exeEl) {
    if (hasInst && pref) {
      exeEl.textContent = base + '\\\\' + pref + '\\\\' + (title.replace(/[^\\w\\-\\. ]+/g, '').trim() || 'game') + '.exe';
      exeEl.classList.add('has-value');
    } else {
      exeEl.textContent = 'Файл не выбран';
      exeEl.classList.remove('has-value');
    }
  }
  if (instEl) {
    instEl.textContent = hasInst ? base + (pref ? ('\\\\' + pref) : '') : 'Игра ещё не установлена';
  }
  if (savesEl) {
    const span = savesEl.querySelector('span');
    if (span) span.textContent = 'Папка с сохранениями не найдена';
  }
}

function openPlaytimeEditModal(gameId, title) {
  const modal = document.getElementById('playtime-edit-modal');
  if (!modal) return;
  window.__playtimeEditGameId = +gameId;
  const sub = document.getElementById('playtime-edit-sub');
  if (sub) sub.textContent = 'Вручную обновите время игры' + (title ? (' для ' + title) : '');
  let mins = 0;
  try {
    const g = (libraryCache || []).find(x => +x.id === +gameId);
    if (g) mins = parseInt(g.playtime_minutes, 10) || 0;
  } catch (e) {}
  const hEl = document.getElementById('playtime-hours');
  const mEl = document.getElementById('playtime-minutes');
  if (hEl) hEl.value = String(Math.floor(mins / 60));
  if (mEl) mEl.value = String(mins % 60);
  modal.classList.remove('hidden');
}

function bindPlaytimeEditModal() {
  const modal = document.getElementById('playtime-edit-modal');
  if (!modal || modal.dataset.bound === '1') return;
  modal.dataset.bound = '1';
  modal.querySelectorAll('[data-close-playtime]').forEach(el => {
    el.addEventListener('click', () => modal.classList.add('hidden'));
  });
  document.getElementById('playtime-edit-save')?.addEventListener('click', async () => {
    const gameId = +window.__playtimeEditGameId;
    if (!gameId) return;
    const h = Math.max(0, parseInt(document.getElementById('playtime-hours')?.value || '0', 10) || 0);
    const m = Math.max(0, Math.min(59, parseInt(document.getElementById('playtime-minutes')?.value || '0', 10) || 0));
    const minutes = h * 60 + m;
    const btn = document.getElementById('playtime-edit-save');
    if (btn) btn.disabled = true;
    try {
      const data = await postJSON((typeof API_BASE !== 'undefined' ? API_BASE : 'api/games.php') + '?action=set_playtime', {
        game_id: gameId,
        minutes
      });
      if (!data.ok) throw new Error(data.error || 'Ошибка');
      applyPlaytimeEverywhere(gameId, data.playtime_minutes != null ? data.playtime_minutes : minutes);
      toast('Время игры обновлено');
      modal.classList.add('hidden');
    } catch (e) {
      toast(e.message || 'Не удалось обновить');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

function fillGameSettingsDownloads(gameId) {
  const sel = document.getElementById('sgdb-launch-version');
  if (!sel) return;
  const versions = getInstalledVersions(gameId);
  const keys = Object.keys(versions || {});
  const preferred = getPreferredVersion(gameId);
  sel.innerHTML = '';
  if (!keys.length) {
    sel.innerHTML = '<option value=\"\">Нет установленных версий</option>';
    sel.disabled = true;
  } else {
    sel.disabled = false;
    keys.sort().forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      const meta = versions[v] || {};
      opt.textContent = 'v' + v + (meta.size ? (' · ' + (typeof formatBytes === 'function' ? formatBytes(meta.size) : '')) : '');
      if (String(preferred) === String(v)) opt.selected = true;
      sel.appendChild(opt);
    });
  }
  sel.onchange = () => {
    if (sel.value) setPreferredVersion(gameId, sel.value);
    if (typeof toast === 'function') toast('Запускаемая версия: v' + sel.value);
  };
  const srcBtn = document.getElementById('sgdb-open-sources');
  if (srcBtn && !srcBtn.dataset.bound) {
    srcBtn.dataset.bound = '1';
    srcBtn.addEventListener('click', () => {
      try { if (typeof gotoGame === 'function') gotoGame(gameId); } catch (e) {}
      document.getElementById('steam-import-modal')?.classList.add('hidden');
      toast('Откройте страницу игры, чтобы скачать другую версию');
    });
  }
}

function fillGameSettingsDanger(gameId) {
  window.__steamEditGameId = Number(gameId) || window.__steamEditGameId;
  const gid = () => Number(window.__steamEditGameId) || Number(gameId);
  const installed = getInstalledIds().includes(+gid());
  const hasVersions = Object.keys(getInstalledVersions(gid()) || {}).length > 0;
  const isInstalled = installed || hasVersions;

  const setBtn = (id, enabled, title) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.disabled = !enabled;
    b.classList.toggle('is-disabled', !enabled);
    if (title) b.title = title;
    else b.removeAttribute('title');
  };

  setBtn('sgdb-remove-library', true, '');
  setBtn('sgdb-refresh-playtime', true, '');
  setBtn('sgdb-reset-playtime', true, '');
  setBtn('sgdb-delete-files', isInstalled, isInstalled ? '' : 'Игра не установлена');
  setBtn('sgdb-del-all-shots', false, 'Нет скриншотов');
  setBtn('sgdb-del-pub-shots', false, 'Нет опубликованных скриншотов');
  setBtn('sgdb-del-local-shots', false, 'Нет локальных скриншотов');

  const bindOnce = (id, fn) => {
    const b = document.getElementById(id);
    if (!b || b.dataset.dangerBound === '1') return;
    b.dataset.dangerBound = '1';
    b.addEventListener('click', () => fn(b));
  };

  bindOnce('sgdb-remove-library', async (btn) => {
    const gameId = gid();
    const ok = await appConfirm({
      title: 'Удалить из библиотеки?',
      message: 'Игра исчезнет из вашей библиотеки. Покупка сохранится.',
      okText: 'Удалить',
      danger: true
    });
    if (!ok) return;
    btn.disabled = true;
    try {
      const data = await postJSON((typeof API_BASE !== 'undefined' ? API_BASE : 'api/games.php') + '?action=remove', { game_id: +gameId });
      if (!data.ok) throw new Error(data.error || 'Ошибка');
      toast('Игра удалена из библиотеки');
      libraryCache = (libraryCache || []).filter(g => +g.id !== +gameId);
      try { sideLibRemoveOptimistic(gameId); } catch (e) {}
      try { renderLibraryGrid(); } catch (e) {}
      // на странице игры — сразу «В библиотеку» без цены
      try {
        if (window.__currentGame && +window.__currentGame.id === +gameId) {
          window.__currentGame.owned = false;
          window.__currentGame.purchased = true;
          if (typeof loadGamePage === 'function') loadGamePage(gameId);
        }
      } catch (e) {}
      document.getElementById('steam-import-modal')?.classList.add('hidden');
    } catch (e) {
      toast(e.message || 'Не удалось удалить');
    } finally {
      btn.disabled = false;
    }
  });

  bindOnce('sgdb-refresh-playtime', async (btn) => {
    const gameId = gid();
    let title = '';
    try {
      title = (libraryCache || []).find(x => +x.id === +gameId)?.title
        || window.__steamEditGameData?.title
        || document.getElementById('sgdb-info-title')?.textContent
        || '';
    } catch (e) {}
    bindPlaytimeEditModal();
    openPlaytimeEditModal(gameId, title);
  });

  bindOnce('sgdb-reset-playtime', async (btn) => {
    const gameId = gid();
    const ok = await appConfirm({
      title: 'Сбросить время игры?',
      message: 'Счётчик времени игры будет обнулён.',
      okText: 'Сбросить',
      danger: true
    });
    if (!ok) return;
    btn.disabled = true;
    try {
      const data = await postJSON((typeof API_BASE !== 'undefined' ? API_BASE : 'api/games.php') + '?action=set_playtime', { game_id: +gameId, minutes: 0 });
      if (!data.ok) throw new Error(data.error || 'Ошибка');
      applyPlaytimeEverywhere(gameId, 0);
      toast('Время игры сброшено');
    } catch (e) {
      toast(e.message || 'Не удалось сбросить');
    } finally {
      btn.disabled = false;
    }
  });

  bindOnce('sgdb-delete-files', async (btn) => {
    if (btn.disabled) return;
    const gameId = gid();
    const ok = await appConfirm({
      title: 'Удалить файлы игры?',
      message: 'Локальные файлы и отметки установки будут удалены. Игра останется в библиотеке.',
      okText: 'Удалить файлы',
      danger: true
    });
    if (!ok) return;
    clearInstalledGame(gameId);
    toast('Файлы удалены');
    try { fillGameSettingsPath({ id: gameId }); } catch (e) {}
    fillGameSettingsDownloads(gameId);
    fillGameSettingsDanger(gameId);
    fillGameSettingsMods(gameId);
    // кнопка Играть → Скачать/Установить сразу, без перезагрузки
    try {
      const g = (window.__currentGame && +window.__currentGame.id === +gameId)
        ? window.__currentGame
        : (window.__currentGamePage && +window.__currentGamePage.id === +gameId ? window.__currentGamePage : null);
      if (g && typeof refreshBuyButton === 'function') refreshBuyButton(g);
      const btn = document.getElementById('btn-buy-game');
      if (btn && g && g.owned) {
        btn.innerHTML = `${icon('downloads', 16)} Установить`;
        btn.dataset.mode = 'install';
        btn.classList.add('owned');
        btn.disabled = false;
        btn.classList.remove('is-disabled');
      }
      if (typeof renderLibraryGrid === 'function') renderLibraryGrid();
    } catch (e) {}
  });
}


window.appConfirm = appConfirm;

async function submitGameForm() {
  const btn = $('#submit-game-send');
  const isAdminPub = !!(btn && btn.dataset.adminPublish === '1' && window.__adminModeratingId);
  const isAdminSave = !!(btn && btn.dataset.adminSave === '1' && window.__adminModeratingId);
  const isPublisherEdit = !!(btn && btn.dataset.publisherEdit === '1');
  // если форма не готова — подсказка, а не «мёртвая» кнопка
  if (btn && btn.classList.contains('is-disabled') && !isAdminPub && !isAdminSave) {
    const reason = btn.dataset.blockReason || btn.title || 'Заполните обязательные поля';
    if (typeof toast === 'function') toast(reason);
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = isAdminPub ? 'Публикация...' : (isAdminSave ? 'Сохранение...' : 'Отправка...');
  }
  try {
    // Публикатор обновляет свою игру → на модерацию (нужны версия + новый файл)
    if (isPublisherEdit) {
      const g = window.__currentGamePage || { id: window.__publishEditGameId };
      openGameUpdateModal(g);
      return;
    }
    if (false && isPublisherEdit) {
      const id = (window.__publishEditGameId || window.__adminModeratingId || 0);
      if (!id) throw new Error('Нет id игры');
      const ver = (document.getElementById('sg-build-version')?.value || '').trim();
      const ch = (document.getElementById('sg-build-changelog')?.value || '').trim();
      const bf = (typeof getSelectedBuildFile === 'function' ? getSelectedBuildFile() : null) || document.getElementById('sg-build-file')?.files?.[0] || null;
      if (!ver) throw new Error('Укажите версию обновления');
      if (!bf) throw new Error('Прикрепите новый файл сборки');
      if (typeof syncPublishGenres === 'function') syncPublishGenres();
      if (typeof syncPublishDescription === 'function') syncPublishDescription();
      const fd = new FormData();
      fd.append('csrf_token', window.CSRF_TOKEN || '');
      fd.append('id', id);
      fd.append('builds_as_pending', '1');
      fd.append('title', ($('#sg-title') && $('#sg-title').value.trim()) || '');
      fd.append('genre', ($('#sg-genre') && $('#sg-genre').value) || '');
      fd.append('price', String(parseInt(String(($('#sg-price') && $('#sg-price').value) || '0').replace(/[^\d]/g, ''), 10) || 0));
      fd.append('short_description', ($('#sg-short') && $('#sg-short').value) || '');
      fd.append('description', ($('#sg-desc') && $('#sg-desc').value) || '');
      try { ensureTrailersEditorUi(); } catch (e) {}
      const tr = (typeof collectTrailerInputs === 'function') ? collectTrailerInputs() : [];
      fd.append('video_url', (typeof serializeTrailerList === 'function' ? serializeTrailerList(tr) : '') || ($('#sg-video') && $('#sg-video').value) || '');
      fd.append('developer', ($('#sg-developer') && $('#sg-developer').value) || '');
      fd.append('publisher', ($('#sg-publisher') && $('#sg-publisher').value) || '');
      fd.append('publisher_id', ($('#sg-publisher-id') && $('#sg-publisher-id').value) || '');
      fd.append('sys_req_min', JSON.stringify(collectSysReq('#sg-sys-min-fields')));
      fd.append('sys_req_rec', JSON.stringify(collectSysReq('#sg-sys-rec-fields')));
      fd.append('languages', JSON.stringify(collectLanguages('#sg-lang-table')));
      fd.append('controllers', $$('.sg-ctrl').filter(function(c){return c.checked;}).map(function(c){return c.value;}).join(','));
      const aCover = $('#sg-cover') && $('#sg-cover').files && $('#sg-cover').files[0];
      if (aCover) fd.append('cover', aCover);
      if ($('#sg-cover-url') && $('#sg-cover-url').value) fd.append('cover_url', $('#sg-cover-url').value);
      const aBanner = $('#sg-banner') && $('#sg-banner').files && $('#sg-banner').files[0];
      if (aBanner) fd.append('banner', aBanner);
      if ($('#sg-banner-url') && $('#sg-banner-url').value) fd.append('banner_url', $('#sg-banner-url').value);
      fd.append('builds_meta', JSON.stringify([{ i: 0, version: ver, platform: 'windows', changelog: ch, has_file: true }]));
      fd.append('builds[0]', bf, bf.name || 'build.bin');
      const res = await fetch((typeof SUBMIT_API !== 'undefined' ? SUBMIT_API : 'api/submit.php') + '?action=publisher_update', { method: 'POST', body: fd });
      const raw = await res.text();
      let data;
      try { data = JSON.parse(raw.slice(raw.indexOf('{'))); } catch (e) { throw new Error('Сервер вернул не JSON'); }
      if (!data.ok) throw new Error(data.error || 'Не удалось отправить обновление');
      toast('Обновление отправлено на модерацию');
      $('#submit-form-modal')?.classList.add('hidden');
      try { resetPublishFormMode(); } catch (e) {}
      try { if (typeof loadGamePage === 'function') loadGamePage(+id); } catch (e) {}
      try { refreshAdminPendingBadge(); } catch (e) {}
      return;
    }
    if (isAdminPub || isAdminSave) {
      const id = window.__adminModeratingId;
      const fd = new FormData();
      fd.append('csrf_token', window.CSRF_TOKEN || '');
      fd.append('id', id);
      if (typeof syncPublishGenres === 'function') syncPublishGenres();
      if (typeof syncPublishDescription === 'function') syncPublishDescription();
      fd.append('title', ($('#sg-title') && $('#sg-title').value.trim()) || '');
      fd.append('genre', ($('#sg-genre') && $('#sg-genre').value) || '');
      fd.append('price', String(parseInt(String(($('#sg-price') && $('#sg-price').value) || '0').replace(/[^\d]/g, ''), 10) || 0));
      fd.append('short_description', ($('#sg-short') && $('#sg-short').value) || '');
      fd.append('description', ($('#sg-desc') && $('#sg-desc').value) || '');
      try { ensureTrailersEditorUi(); } catch (e) {}
      const tr = (typeof collectTrailerInputs === 'function') ? collectTrailerInputs() : [];
      fd.append('video_url', (typeof serializeTrailerList === 'function' ? serializeTrailerList(tr) : '') || ($('#sg-video') && $('#sg-video').value) || '');
      fd.append('developer', ($('#sg-developer') && $('#sg-developer').value) || '');
      fd.append('publisher', ($('#sg-publisher') && $('#sg-publisher').value) || '');
      fd.append('publisher_id', ($('#sg-publisher-id') && $('#sg-publisher-id').value) || '');
      fd.append('sys_req_min', JSON.stringify(collectSysReq('#sg-sys-min-fields')));
      fd.append('sys_req_rec', JSON.stringify(collectSysReq('#sg-sys-rec-fields')));
      fd.append('languages', JSON.stringify(collectLanguages('#sg-lang-table')));
      fd.append('controllers', $$('.sg-ctrl').filter(function(c){return c.checked;}).map(function(c){return c.value;}).join(','));
      const aCover = $('#sg-cover') && $('#sg-cover').files && $('#sg-cover').files[0];
      if (aCover) fd.append('cover', aCover);
      if ($('#sg-cover-url') && $('#sg-cover-url').value) fd.append('cover_url', $('#sg-cover-url').value);
      const aBanner = $('#sg-banner') && $('#sg-banner').files && $('#sg-banner').files[0];
      if (aBanner) fd.append('banner', aBanner);
      if ($('#sg-banner-url') && $('#sg-banner-url').value) fd.append('banner_url', $('#sg-banner-url').value);
      const aLogo = $('#sg-logo') && $('#sg-logo').files && $('#sg-logo').files[0];
      if (aLogo) fd.append('logo', aLogo);
      const aIcon = $('#sg-icon') && $('#sg-icon').files && $('#sg-icon').files[0];
      if (aIcon) fd.append('icon', aIcon);
      const aShots = $('#sg-shots') && $('#sg-shots').files;
      if (aShots) for (let i = 0; i < aShots.length; i++) fd.append('screenshots[]', aShots[i]);
      // сборка: версия + файл прямо из полей формы
      try {
        const ver = (document.getElementById('sg-build-version')?.value || '').trim();
        const ch = (document.getElementById('sg-build-changelog')?.value || '').trim();
        const bf = (typeof getSelectedBuildFile === 'function' ? getSelectedBuildFile() : null) || document.getElementById('sg-build-file')?.files?.[0] || null;
        if (bf) {
          fd.append('builds_meta', JSON.stringify([{
            i: 0, version: ver || '1.0', platform: 'windows', changelog: ch, has_file: true
          }]));
          fd.append('builds[0]', bf, bf.name || 'build.bin');
        }
      } catch (e) { console.warn('admin builds append', e); }
      let res = await fetch(SUBMIT_API + '?action=admin_save', { method: 'POST', body: fd });
      let data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Не удалось сохранить');
      if (isAdminPub) {
        res = await postJSON(SUBMIT_API + '?action=publish', { csrf_token: window.CSRF_TOKEN || '', id: id });
        if (!res.ok) throw new Error(res.error || 'Не удалось опубликовать');
        toast('Игра опубликована');
        try { loadAdminPending(); } catch (e) {}
        try { if (typeof loadGamePage === 'function') loadGamePage(+id); } catch (e) {}
      } else {
        toast('Сохранено');
        try { if (typeof loadGamePage === 'function') loadGamePage(+id); } catch (e) {}
      }
      if ($('#submit-form-modal')) $('#submit-form-modal').classList.add('hidden');
      try { resetPublishFormMode(); } catch (e) {}
      try { resetPublishModalMode(); } catch (e) {}
      homeCache = null;
      storeCache = [];
      return;
    }
    const err = validatePublishForm();
    if (err) throw new Error(err);
    const fd = new FormData();
        fd.append('csrf_token', window.CSRF_TOKEN || '');
    syncPublishGenres();
    syncPublishDescription();
    fd.append('title', $('#sg-title')?.value?.trim() || '');
    fd.append('genre', $('#sg-genre')?.value || '');
    fd.append('price', String(parseInt(String($('#sg-price')?.value || '0').replace(/[^\d]/g, ''), 10) || 0));
    fd.append('short_description', $('#sg-short')?.value || '');
    fd.append('description', $('#sg-desc')?.value || '');
    try { ensureTrailersEditorUi(); } catch(e) {}
    const _tr = collectTrailerInputs();
    fd.append('video_url', serializeTrailerList(_tr) || ($('#sg-video')?.value || ''));
    fd.append('developer', $('#sg-developer')?.value || '');
    fd.append('publisher', $('#sg-publisher')?.value || '');
    fd.append('publisher_id', $('#sg-publisher-id')?.value || '');
    fd.append('website', $('#sg-website')?.value || '');
    fd.append('release_date', $('#sg-release')?.value || '');
    fd.append('tags', $('#sg-tags')?.value || '');
    const plats = $$('.sg-platform').filter(c => c.checked).map(c => c.value).join(',');
    fd.append('platforms', plats);
    if ($('#sg-cover-url')?.value) fd.append('cover_url', $('#sg-cover-url').value);
    if ($('#sg-banner-url')?.value) fd.append('banner_url', $('#sg-banner-url').value);
    if ($('#sg-icon-url')?.value) fd.append('icon_url', $('#sg-icon-url').value);
    if ($('#sg-logo-url')?.value) fd.append('logo_url', $('#sg-logo-url').value);
    if ($('#sg-screenshots-urls')?.value) fd.append('screenshot_urls', $('#sg-screenshots-urls').value);
    if ($('#sg-trailer-urls')?.value) fd.append('trailer_urls', $('#sg-trailer-urls').value);
    if ($('#sg-logo-url')?.value) fd.append('logo_url', $('#sg-logo-url').value);
    if ($('#sg-icon-url')?.value) fd.append('icon_url', $('#sg-icon-url').value);
    fd.append('sys_req_min', JSON.stringify(collectSysReq('#sg-sys-min-fields')));
    fd.append('sys_req_rec', JSON.stringify(collectSysReq('#sg-sys-rec-fields')));
    fd.append('languages', JSON.stringify(collectLanguages('#sg-lang-table')));
    const ctrls = $$('.sg-ctrl').filter(c => c.checked).map(c => c.value).join(',');
    fd.append('controllers', ctrls);
    const cover = $('#sg-cover')?.files?.[0];
    if (cover) fd.append('cover', cover);
    const banner = $('#sg-banner')?.files?.[0];
    if (banner) fd.append('banner', banner);
    const logo = $('#sg-logo')?.files?.[0];
    if (logo) fd.append('logo', logo);
    const icon = $('#sg-icon')?.files?.[0];
    if (icon) fd.append('icon', icon);
    const shots = $('#sg-shots')?.files;
    if (shots) for (let i = 0; i < shots.length; i++) fd.append('screenshots[]', shots[i]);
    // сборка — прямо из полей (версия + файл обязательны)
    const buildVer = (document.getElementById('sg-build-version')?.value || '').trim();
    const buildCh = (document.getElementById('sg-build-changelog')?.value || '').trim();
    const buildFile = (typeof getSelectedBuildFile === 'function' ? getSelectedBuildFile() : null) || document.getElementById('sg-build-file')?.files?.[0] || null;
    if (!buildVer) throw new Error('Укажите версию сборки');
    if (!buildFile) throw new Error('Прикрепите файл сборки (zip/exe)');
    fd.append('builds_meta', JSON.stringify([{
      i: 0, version: buildVer, platform: 'windows', changelog: buildCh, has_file: true
    }]));
    fd.append('builds[0]', buildFile, buildFile.name || 'build.bin');
    const flags = $$('.sg-content-flag').filter(c => c.checked).map(c => c.value);
    fd.append('content_flags', flags.join(','));
    fd.append('is_adult', flags.includes('adult') ? '1' : '0');

    const res = await fetch(`${SUBMIT_API}?action=submit`, { method: 'POST', body: fd });
    const rawText = await res.text();
    let data;
    try { data = JSON.parse(rawText); }
    catch (e) {
      console.error('submit non-JSON', rawText.slice(0, 300));
      throw new Error('Сервер вернул не JSON. Обнови api/submit.php');
    }
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    try { refreshAdminPendingBadge(); } catch (e) {}
    $('#submit-form-modal')?.classList.add('hidden');
    $('#submit-game-form')?.reset();
    const ed = $('#sg-desc-editor');
    if (ed) ed.innerHTML = '';
    $$('.sg-genre').forEach(c => { c.checked = false; });
    syncPublishGenres();
    syncPublishDescription();
    $('#submit-done-modal')?.classList.remove('hidden');
  } catch (err) {
    toast(err.message || 'Не удалось отправить');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Отправить на модерацию'; }
  }
}


function initAdminUI() {
  const view = $('#view-admin');
  if (!view || view.dataset.boundAdmin === '1') return;
  view.dataset.boundAdmin = '1';

  $$('.settings-nav-btn[data-atab]', view).forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.atab;
      $$('.settings-nav-btn[data-atab]', view).forEach(b => b.classList.toggle('active', b === btn));
      $$('.settings-pane', view).forEach(p => {
        p.classList.toggle('hidden', p.id !== 'admin-pane-' + tab);
      });
      if (tab === 'moderation') loadAdminPending();
      if (tab === 'users') loadAdminUsers();
    });
  });

  const showErr = (msg) => {
    const el = $('#steam-import-error');
    if (!el) return;
    if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.textContent = msg;
    el.classList.remove('hidden');
  };

  let steamPreviewData = null;
  let steamSelected = { icon_url: '', logo_url: '', banner_url: '', cover_url: '' };
  let steamAppId = 0;
  let sgdbCache = {}; // type -> assets[]
  let sgdbCurrentType = 'icons';
  // expose for game-page gear
  window.getSteamAssetState = () => ({ steamAppId, steamSelected, sgdbCache, steamPreviewData });
  window.setSteamAppId = (id) => { steamAppId = id; sgdbCache = {}; };
  window.loadSgdbAssetsGlobal = (t) => loadSgdbAssets(t || 'icons');
  window.openSteamModal = openSteamModal;
  window.closeSteamModal = closeSteamModal;


  function openSteamModal() {
    if (typeof resetSteamModalToImportMode === 'function') resetSteamModalToImportMode();
    const m = $('#steam-import-modal');
    if (!m) return;
    // import mode defaults
    $$('.sgdb-nav-btn', m).forEach(b => {
      b.style.display = '';
      b.classList.toggle('active', b.dataset.sgdbTab === 'main');
    });
    $$('.sgdb-pane', m).forEach(p => p.classList.toggle('active', p.dataset.sgdbPane === 'main'));
    m.classList.remove('hidden');
    m.setAttribute('aria-hidden', 'false');
  }
  function closeSteamModal() {
    const m = $('#steam-import-modal');
    if (!m) return;
    m.classList.add('hidden');
    m.setAttribute('aria-hidden', 'true');
    if (typeof resetSteamModalToImportMode === 'function') resetSteamModalToImportMode();
  
  window.__steamEditMode = false;
  window.__steamEditGameId = null;
}
  // admin uses inline form; modal only from game gear
  //   $('#steam-open-modal-btn')?.addEventListener('click', openSteamModal);

  // ===== Классический импорт в админке (без модалки) =====
  (function initAdminSteamInline() {
    const previewBtn = $('#steam-preview-admin-btn');
    const importBtn = $('#steam-import-admin-btn');
    if (!previewBtn && !importBtn) return;
    const showErr = (msg) => {
      const el = $('#steam-import-error');
      if (!el) return;
      if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
      el.textContent = msg;
      el.classList.remove('hidden');
    };
    previewBtn?.addEventListener('click', async () => {
      const url = ($('#steam-url-admin')?.value || '').trim();
      showErr('');
      const box = $('#steam-preview-admin');
      box?.classList.add('hidden');
      if (!url) { showErr('Вставь ссылку или AppID'); return; }
      previewBtn.disabled = true;
      previewBtn.textContent = 'Загрузка...';
      try {
        const raw = await fetchJSON(`${STEAM_API}?action=preview&url=${encodeURIComponent(url)}`, { timeout: FETCH_TIMEOUT_LONG });
        if (!raw.ok) throw new Error(raw.error || 'Ошибка');
        const data = { ...raw, ...(raw.preview || {}) };
        window.__adminSteamPreview = data;
        const banner = $('#steam-preview-admin-banner');
        const cover = $('#steam-preview-admin-cover');
        if (banner) banner.src = data.banner_url || data.header_image || data.cover_url || data.library_image || '';
        if (cover) cover.src = data.cover_url || data.library_image || data.capsule_image || data.header_image || '';
        const t = $('#steam-preview-admin-title');
        if (t) t.textContent = data.title || '';
        const m = $('#steam-preview-admin-meta');
        if (m) m.textContent = [data.developers || data.developer, data.publishers || data.publisher, data.release_date].filter(Boolean).join(' · ');
        const s = $('#steam-preview-admin-short');
        if (s) s.textContent = (data.short_description || '').slice(0, 280);
        box?.classList.remove('hidden');
      } catch (e) {
        showErr(e.message || 'Не удалось загрузить');
      } finally {
        previewBtn.disabled = false;
        previewBtn.textContent = 'Проверить';
      }
    });
    importBtn?.addEventListener('click', async () => {
      const url = ($('#steam-url-admin')?.value || '').trim();
      showErr('');
      if (!url) { showErr('Вставь ссылку или AppID'); return; }
      importBtn.disabled = true;
      importBtn.textContent = 'Импорт...';
      try {
        const data = await postJSON(`${STEAM_API}?action=import`, {
          url,
          publish: $('#steam-publish-admin')?.checked ? 1 : 0,
        }, FETCH_TIMEOUT_LONG);
        if (!data.ok) throw new Error(data.error || 'Ошибка импорта');
        toast('Игра импортирована' + (data.title ? ': ' + data.title : ''));
        if (data.game_id && typeof loadGamePage === 'function') {
          // optional
        }
        if (typeof loadSideLibrary === 'function') loadSideLibrary();
        showErr('');
      } catch (e) {
        showErr(e.message || 'Ошибка импорта');
      } finally {
        importBtn.disabled = false;
        importBtn.textContent = 'Импортировать в CATio';
      }
    });
  })();

  document.querySelectorAll('[data-close-steam-modal]').forEach(el => {
    el.addEventListener('click', closeSteamModal);
  });

  // side nav tabs
  $$('.sgdb-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.sgdbTab;
      $$('.sgdb-nav-btn').forEach(b => b.classList.toggle('active', b === btn));
      $$('.sgdb-pane').forEach(p => p.classList.toggle('active', p.dataset.sgdbPane === tab));
      if (tab === 'assets' && steamAppId) loadSgdbAssets(sgdbCurrentType);
    });
  });

  // asset subtabs
  $$('.sgdb-asset-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.assetType;
      sgdbCurrentType = t;
      $$('.sgdb-asset-tab').forEach(b => b.classList.toggle('active', b === btn));
      loadSgdbAssets(t);
    });
  });

  function setSgdbPreview(url, type) {
    const wrap = $('#sgdb-asset-preview');
    const img = $('#sgdb-asset-preview-img');
    if (img) img.src = url || '';
    if (wrap) {
      wrap.classList.remove('is-hero', 'is-grid', 'is-logo');
      if (type === 'heroes') wrap.classList.add('is-hero');
      if (type === 'grids') wrap.classList.add('is-grid');
      if (type === 'logos') wrap.classList.add('is-logo');
    }
  }

  function selectSgdbAsset(url, type) {
    if (type === 'icons') {
      steamSelected.icon_url = url;
      $('#steam-sel-icon').value = url;
    } else if (type === 'logos') {
      steamSelected.logo_url = url;
      $('#steam-sel-logo').value = url;
    } else if (type === 'heroes') {
      steamSelected.banner_url = url;
      $('#steam-sel-banner').value = url;
    } else if (type === 'grids') {
      steamSelected.cover_url = url;
      $('#steam-sel-cover').value = url;
    }
    setSgdbPreview(url, type);
    updateSgdbSaveHint();
  }

  function updateSgdbSaveHint() {
    const hint = $('#sgdb-asset-save-hint');
    if (!hint) return;
    const parts = [];
    if (steamSelected.icon_url) parts.push('иконка');
    if (steamSelected.logo_url) parts.push('логотип');
    if (steamSelected.banner_url) parts.push('баннер');
    if (steamSelected.cover_url) parts.push('обложка');
    if (!parts.length) {
      hint.textContent = 'Выбери ассеты и нажми сохранить';
      hint.classList.remove('has-sel');
    } else {
      hint.textContent = 'Выбрано: ' + parts.join(', ');
      hint.classList.add('has-sel');
    }
  }

  /** Сохранить выбранные ассеты на сервер (игра уже в каталоге) */
  async function applyGameAssetNow(gameId, type, url) {
    if (!gameId || !url) return null;
    const payload = { game_id: gameId, csrf_token: window.CSRF_TOKEN || '' };
    if (type === 'icons' || type === 'icon') payload.icon_url = url;
    else if (type === 'logos' || type === 'logo') payload.logo_url = url;
    else if (type === 'heroes' || type === 'banner') payload.banner_url = url;
    else if (type === 'grids' || type === 'cover') payload.cover_url = url;
    else return null;
    const res = await saveGameAssetsSelection(payload);
    if (!res.ok) throw new Error(res.error || 'Не удалось сохранить ассет');
    return res;
  }

  async function saveSelectedGameAssets() {
    const gameId = Number(window.__steamEditGameId || 0);
    if (!gameId) {
      toast('Сначала открой настройки с страницы игры');
      return;
    }
    const payload = {
      game_id: gameId,
      csrf_token: window.CSRF_TOKEN || '',
      icon_url: steamSelected.icon_url || $('#steam-sel-icon')?.value || '',
      logo_url: steamSelected.logo_url || $('#steam-sel-logo')?.value || '',
      banner_url: steamSelected.banner_url || $('#steam-sel-banner')?.value || '',
      cover_url: steamSelected.cover_url || $('#steam-sel-cover')?.value || '',
    };
    if (!payload.icon_url && !payload.logo_url && !payload.banner_url && !payload.cover_url) {
      toast('Ничего не выбрано');
      return;
    }
    const btn = $('#sgdb-asset-save');
    const old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Сохранение…'; }
    try {
      const res = await saveGameAssetsSelection(payload);
      if (!res.ok) throw new Error(res.error || 'Ошибка сохранения');
      window.__mediaBust = Date.now();
      window.__iconBust = window.__mediaBust;
      homeCache = null;
      storeCache = [];
      toast('Ассеты сохранены');
      if (typeof refreshGameImagesEverywhere === 'function') {
        refreshGameImagesEverywhere(gameId);
      }
      // обновить страницу игры, если открыта
      if (typeof loadGamePage === 'function') {
        try { await loadGamePage(gameId); } catch (e) {}
      }
      if (typeof loadSideLibrary === 'function') {
        try { loadSideLibrary(); } catch (e) {}
      }
      closeSteamModal();
    } catch (err) {
      toast(err.message || 'Не удалось сохранить');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = old || 'Сохранить'; }
    }
  }

  // кнопка Сохранить в модалке ассетов
  $('#sgdb-asset-save')?.addEventListener('click', () => {
    saveSelectedGameAssets();
  });
  // expose
  window.applyGameAssetNow = applyGameAssetNow;
  window.saveSelectedGameAssets = saveSelectedGameAssets;

  function normalizeSgdbUrl(u) {
    if (!u) return '';
    u = String(u).trim();
    if (!u || u === 'undefined' || u === 'null') return '';
    // относительные пути из пакета
    if (u.startsWith('sgdb/') || u.startsWith('media/') || u.startsWith('uploads/')) {
      // уже ок
    } else if (u.startsWith('./')) {
      u = u.slice(2);
    }
    return u;
  }
  function mapPackList(list) {
    if (!Array.isArray(list)) return [];
    return list.map(a => {
      if (!a) return null;
      if (typeof a === 'string') {
        const u = normalizeSgdbUrl(a);
        return u ? { url: u, thumb: u } : null;
      }
      const url = normalizeSgdbUrl(a.url || a.file || a.thumb || '');
      const thumb = normalizeSgdbUrl(a.thumb || a.url || a.file || '') || url;
      if (!url) return null;
      return { url, thumb, width: a.width, height: a.height };
    }).filter(Boolean);
  }
  async function loadSgdbAssets(type) {
    const grid = $('#sgdb-asset-grid');
    if (!grid) return;
    grid.className = 'sgdb-asset-grid is-' + type;
    grid.innerHTML = '<div class="settings-hint">Загрузка…</div>';

    // 1) ассеты из ZIP-пакета (импорт) — keys: icons/logos/heroes/grids (+ covers)
    const pack = window.__sgdbAssetsFromPack || window.__packSgdbAssets;
    if (pack) {
      const key = (type === 'grids' || type === 'covers') ? 'grids' : type;
      const list = mapPackList(pack[key] || pack[type] || (key === 'grids' ? pack.covers : null) || []);
      if (list.length) {
        sgdbCache[type] = list;
        renderSgdbGrid(list, type);
        return;
      }
    }

    // 2) локальные ассеты уже сохранённой игры
    const g = window.__steamEditGameData || window.__lastGameForCart || (window.wrap && window.wrap._gameData) || null;
    const local = [];
    const pushLocal = (url) => {
      const u = normalizeSgdbUrl(url);
      if (!u) return;
      if (!local.some(x => x.url === u)) local.push({ url: u, thumb: u });
    };
    if (g) {
      if (type === 'icons') pushLocal(g.icon_url);
      if (type === 'logos') pushLocal(g.logo_url);
      if (type === 'heroes') { pushLocal(g.banner_url); pushLocal(g.cover_url); }
      if (type === 'grids' || type === 'covers') { pushLocal(g.cover_url); pushLocal(g.cover_src); }
    }
    if ((type === 'grids' || type === 'covers' || type === 'heroes') && Array.isArray(window.__lastGameScreenshots)) {
      window.__lastGameScreenshots.forEach(pushLocal);
    }

    // 3) онлайн CATioGridDB / SteamGridDB по названию (если локально пусто)
    const q = (window.__sgdbNameQuery || (g && g.title) || window.__packSgdbTitle || '').trim();
    if (!local.length && q) {
      try {
        const data = await fetchJSON('api/game_pack.php?action=sgdb_by_name&q=' + encodeURIComponent(q));
        const first = (data && data.results && data.results[0]) || (data && data.games && data.games[0]) || null;
        const sgdbId = (first && first.id) || data.sgdb_id || 0;
        if (sgdbId) {
          const assets = await fetchJSON('api/game_pack.php?action=sgdb_by_name&q=' + encodeURIComponent(q) + '&sgdb_id=' + sgdbId);
          const bag = (assets && assets.assets) || assets || {};
          const apiKey = (type === 'grids' || type === 'covers') ? 'covers' : type;
          const list = mapPackList(bag[apiKey] || bag[type] || bag.grids || []);
          if (list.length) {
            // кэш всего пакета ассетов для остальных вкладок
            window.__sgdbAssetsFromPack = window.__sgdbAssetsFromPack || {
              icons: mapPackList(bag.icons || []),
              logos: mapPackList(bag.logos || []),
              heroes: mapPackList(bag.heroes || []),
              grids: mapPackList(bag.covers || bag.grids || []),
            };
            sgdbCache[type] = list;
            renderSgdbGrid(list, type);
            return;
          }
        }
      } catch (e) {
        console.warn('[sgdb]', e);
      }
    }

    if (local.length) {
      sgdbCache[type] = local;
      renderSgdbGrid(local, type);
      return;
    }

    grid.innerHTML = '<div class="settings-hint">Нет ассетов для этой вкладки. Импортируй ZIP-пакет с CATioGridDB или выбери другое название.</div>';
  }

  function renderSgdbGrid(list, type) {
    const grid = $('#sgdb-asset-grid');
    if (!grid) return;
    if (!list.length) {
      grid.innerHTML = '<div class="settings-hint">Ничего не найдено</div>';
      return;
    }
    const selected =
      type === 'icons' ? steamSelected.icon_url :
      type === 'logos' ? steamSelected.logo_url :
      type === 'heroes' ? steamSelected.banner_url :
      steamSelected.cover_url;
    grid.innerHTML = list.map(a => {
      const u = a.url || a.thumb;
      const th = a.thumb || a.url;
      return `<button type="button" class="sgdb-grid-item is-${type}${u === selected ? ' selected' : ''}" data-url="${escapeHtml(u)}">
        <img src="${escapeHtml(th)}" alt="" loading="lazy" onerror="this.onerror=null;const b=this.closest('.sgdb-grid-item');if(b)b.remove();" />
      </button>`;
    }).join('');
    $$('.sgdb-grid-item', grid).forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.sgdb-grid-item', grid).forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectSgdbAsset(btn.dataset.url, type);
      });
    });
    // auto preview first/selected
    const cur = selected || (list[0] && (list[0].url || list[0].thumb));
    if (cur) setSgdbPreview(cur, type);
  }

  $('#steam-preview-btn')?.addEventListener('click', async () => {
    const url = ($('#steam-url')?.value || '').trim();
    showErr('');
    $('#steam-preview')?.classList.add('hidden');
    if (!url) { showErr('Вставь ссылку или AppID'); return; }
    const btn = $('#steam-preview-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Загрузка...'; }
    try {
      const data = await fetchJSON(`${STEAM_API}?action=preview&url=${encodeURIComponent(url)}`, { timeout: FETCH_TIMEOUT_LONG });
      if (!data.ok) throw new Error(data.error || 'Ошибка');
      const p = data.preview || {};
      steamPreviewData = p;
      steamAppId = p.appid || 0;
      sgdbCache = {};
      steamSelected = {
        icon_url: (p.icon_options && p.icon_options[0]) || p.library_image || '',
        logo_url: '',
        banner_url: (p.banner_options && p.banner_options[0]) || p.header_image || '',
        cover_url: (p.cover_options && p.cover_options[0]) || p.capsule_image || '',
      };
      const banner = $('#steam-preview-banner');
      const cover = $('#steam-preview-cover');
      if (banner) banner.src = steamSelected.banner_url;
      if (cover) cover.src = steamSelected.cover_url;
      const title = $('#steam-preview-title');
      if (title) title.textContent = p.title || '';
      const mt = $('#sgdb-modal-title');
      if (mt && p.title) mt.textContent = p.title;
      const meta = $('#steam-preview-meta');
      if (meta) meta.textContent = [p.developer, p.genre, p.release_date, p.is_free ? 'Бесплатно' : ''].filter(Boolean).join(' · ');
      const short = $('#steam-preview-short');
      if (short) short.textContent = p.short_description || '';
      const shots = $('#steam-preview-shots');
      if (shots) {
        shots.innerHTML = (p.screenshots || []).slice(0, 12).map(src =>
          `<img src="${escapeHtml(src)}" alt="" loading="lazy" />`
        ).join('') || '<span class="settings-hint">Нет скриншотов</span>';
      }
      const vids = $('#steam-preview-videos');
      if (vids) {
        const movies = p.movies || [];
        vids.innerHTML = movies.length ? movies.map(m => `
          <div class="steam-vid">
            <img src="${escapeHtml(m.thumbnail || '')}" alt="" />
            <span>${escapeHtml(m.name || 'Трейлер')}</span>
          </div>`).join('') : '<span class="settings-hint">Нет видео</span>';
      }
      const achs = $('#steam-preview-achs');
      const achCount = $('#steam-ach-count');
      const alist = p.achievements || [];
      if (achCount) achCount.textContent = alist.length ? `(${alist.length})` : '';
      if (achs) {
        achs.innerHTML = alist.length ? alist.slice(0, 12).map(a => `
          <div class="steam-ach-row">
            ${a.icon_url ? `<img src="${escapeHtml(a.icon_url)}" alt="" />` : ''}
            <span class="n">${escapeHtml(a.display_name || '')}</span>
            <span class="p">${a.percent ? (Number(a.percent).toFixed(1) + '%') : ''}</span>
          </div>`).join('') : '<span class="settings-hint">Нет ачивок</span>';
      }
      $('#steam-preview')?.classList.remove('hidden');
      toast('Данные Steam получены');
    } catch (e) {
      showErr(e.message || 'Не удалось получить данные');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Загрузить'; }
    }
  });

  $('#steam-import-btn')?.addEventListener('click', async () => {
    const btn = $('#steam-import-btn');
    const isEdit = btn && btn.dataset.mode === 'edit' && window.__steamEditGameId;
    showErr('');
    if (!isEdit) {
      const url = ($('#steam-url')?.value || '').trim();
      if (!url) { showErr('Вставь ссылку или AppID'); return; }
    }
    if (btn) { btn.disabled = true; btn.textContent = isEdit ? 'Сохранение...' : 'Импорт...'; }
    try {
      if (isEdit) {
        const data = await saveGameAssetsSelection( {
          game_id: window.__steamEditGameId,
          icon_url: steamSelected.icon_url || $('#steam-sel-icon')?.value || '',
          cover_url: steamSelected.cover_url || $('#steam-sel-cover')?.value || '',
          banner_url: steamSelected.banner_url || $('#steam-sel-banner')?.value || '',
          logo_url: steamSelected.logo_url || $('#steam-sel-logo')?.value || '',
        }, FETCH_TIMEOUT_LONG);
        if (!data.ok) throw new Error(data.error || 'Ошибка сохранения');
        toast('Ассеты сохранены');
        closeSteamModal();
        window.__steamEditGameId = null;
        if (btn) { btn.dataset.mode = ''; btn.textContent = 'Импортировать'; }
        // refresh game page / side lib
        if (typeof loadSideLibrary === 'function') loadSideLibrary();
        const gid = data.game_id;
        if (gid && typeof loadGamePage === 'function') loadGamePage(gid);
        return;
      }
      const url = ($('#steam-url')?.value || '').trim();
      const data = await postJSON(`${STEAM_API}?action=import`, {
        url,
        publish: $('#steam-publish')?.checked ? 1 : 0,
        icon_url: steamSelected.icon_url || $('#steam-sel-icon')?.value || '',
        cover_url: steamSelected.cover_url || $('#steam-sel-cover')?.value || '',
        banner_url: steamSelected.banner_url || $('#steam-sel-banner')?.value || '',
        logo_url: steamSelected.logo_url || $('#steam-sel-logo')?.value || '',
      }, FETCH_TIMEOUT_LONG);
if (!data.ok) throw new Error(data.error || 'Ошибка импорта');
      const vidInfo = data.videos ? `, видео: ${data.videos}` : '';
      toast(`Импортировано: ${data.title} (id ${data.game_id}${vidInfo})`);
      closeSteamModal();
      homeCache = null;
      storeCache = [];
      if (data.status === 'published' && typeof gotoGame === 'function') {
        gotoGame(data.game_id);
      } else {
        $$('.settings-nav-btn[data-atab]', view).forEach(b => b.classList.toggle('active', b.dataset.atab === 'moderation'));
        $$('.settings-pane', view).forEach(p => p.classList.toggle('hidden', p.id !== 'admin-pane-moderation'));
        loadAdminPending();
      }
    } catch (e) {
      showErr(e.message || 'Ошибка импорта');
      toast(e.message || 'Ошибка импорта');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Импортировать в CATio'; }
    }
  });
}



/** Серая заглушка обложки с иконкой раздела (из «Создать» / «Мастерская») */
const ADMIN_SECTION_ICO = {
  game: icon('gamepad', 22),
  build: icon('gamepad', 22),
  mod: icon('shield-check', 22),
  media: icon('image', 22),
  asset: icon('package', 22),
};

function adminCoverHtml(url, kind) {
  const u = (url || '').trim();
  if (u) {
    return `<img src="${escapeHtml(u)}" alt="" onerror="this.onerror=null;this.replaceWith((function(){var d=document.createElement('div');d.className='admin-pending-cover is-ph is-${kind||'game'}';d.innerHTML=ADMIN_SECTION_ICO['${kind||'game'}']||ADMIN_SECTION_ICO.game;return d;})())" />`;
  }
  const ico = ADMIN_SECTION_ICO[kind] || ADMIN_SECTION_ICO.game;
  return `<div class="admin-pending-cover is-ph is-${kind || 'game'}" aria-hidden="true">${ico}</div>`;
}

const ADMIN_ICO = {
  approve: icon('check-bold', 16),
  reject: icon('x', 16),
  preload: icon('downloads', 16),
};

/** Три квадратные кнопки: одобрить / отклонить / предзагрузка */
function adminPendingActionsHtml(opts) {
  opts = opts || {};
  const kind = opts.kind || '';
  const id = opts.id || '';
  const title = escapeHtml(opts.title || '');
  const extra = opts.extra || {};
  const bits = [];
  bits.push(`<button type="button" class="admin-act-btn is-approve" data-admin-act="approve" data-kind="${kind}" data-id="${id}" title="Опубликовать" aria-label="Опубликовать">${ADMIN_ICO.approve}</button>`);
  bits.push(`<button type="button" class="admin-act-btn is-reject" data-admin-act="reject" data-kind="${kind}" data-id="${id}" title="Отклонить" aria-label="Отклонить">${ADMIN_ICO.reject}</button>`);
  if (opts.preload !== false) {
    const bId = extra.buildId != null ? ` data-build-id="${extra.buildId}"` : '';
    const ver = extra.version != null ? ` data-version="${escapeHtml(String(extra.version))}"` : '';
    const gId = extra.gameId != null ? ` data-game-id="${extra.gameId}"` : '';
    bits.push(`<button type="button" class="admin-act-btn is-preload" data-admin-act="preload" data-kind="${kind}" data-id="${id}" data-title="${title}"${bId}${ver}${gId} title="Предзагрузка" aria-label="Предзагрузка">${ADMIN_ICO.preload}</button>`);
  }
  return `<div class="admin-pending-actions" onclick="event.stopPropagation()">${bits.join('')}</div>`;
}

/** Предзагрузка сборки админом — через очередь загрузок лаунчера */
function adminEnqueueBuildPreload(opts) {
  opts = opts || {};
  const buildId = +(opts.buildId || 0);
  if (!buildId) {
    toast('Нет файла сборки для предзагрузки');
    return;
  }
  if (typeof enqueueDownload !== 'function') {
    toast('Система загрузок недоступна');
    return;
  }
  enqueueDownload({
    buildId,
    gameId: +(opts.gameId || 0) || null,
    title: opts.title || 'Сборка',
    version: opts.version || '',
    platform: opts.platform || 'windows',
    adminPreload: true,
  });
}

async function adminPreloadGame(gameId, title) {
  try {
    const data = await fetchJSON((typeof SUBMIT_API !== 'undefined' ? SUBMIT_API : 'api/submit.php') + '?action=get&id=' + (+gameId));
    if (!data || !data.ok) throw new Error((data && data.error) || 'Не удалось получить заявку');
    const g = data.game || data;
    const builds = g.builds || [];
    if (!builds.length) {
      toast('У заявки нет файла сборки');
      return;
    }
    // Берём самую свежую сборку (не rejected)
    const b = builds.find(x => !['rejected'].includes(String(x.status || ''))) || builds[0];
    adminEnqueueBuildPreload({
      buildId: b.id,
      gameId: +gameId,
      title: title || g.title || 'Игра',
      version: b.version || '',
      platform: b.platform || 'windows',
    });
  } catch (e) {
    toast(e.message || 'Ошибка предзагрузки');
  }
}

function updateAdminPendingBadge(count) {
  const n = Math.max(0, parseInt(count, 10) || 0);
  const badge = document.getElementById('admin-badge');
  if (badge) {
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('hidden', n <= 0);
  }
  const modCount = document.getElementById('admin-mod-count');
  if (modCount) {
    modCount.textContent = n > 0 ? String(n) : '';
    modCount.classList.toggle('hidden', n <= 0);
  }
}
async function refreshAdminPendingBadge() {
  try {
    const me = window.AUTH_STATE && window.AUTH_STATE.user;
    if (!me || me.role !== 'admin') return;
    let total = 0;
    try {
      const data = await fetchJSON((typeof SUBMIT_API !== 'undefined' ? SUBMIT_API : 'api/submit.php') + '?action=pending&_t=' + Date.now());
      if (data && data.ok) total += (data.games || []).length;
    } catch (e) {}
    try {
      const ws = await fetchJSON((typeof WS_API !== 'undefined' ? WS_API : 'api/workshop.php') + '?action=admin_pending&_t=' + Date.now());
      if (ws && ws.ok) total += (ws.mods || []).length + (ws.media || []).length + (ws.assets || []).length;
    } catch (e) {}
    try {
      const bd = await fetchJSON((typeof SUBMIT_API !== 'undefined' ? SUBMIT_API : 'api/submit.php') + '?action=pending_builds&_t=' + Date.now());
      if (bd && bd.ok) total += (bd.builds || []).length;
    } catch (e) {}
    updateAdminPendingBadge(total);

    const prev = (typeof window.__adminPendingCount === 'number') ? window.__adminPendingCount : null;
    window.__adminPendingCount = total;

    // Если админ сидит в модерации и число заявок изменилось — обновить список без F5
    if (prev !== null && prev !== total) {
      const adminView = document.getElementById('view-admin');
      const modPane = document.getElementById('admin-pane-moderation');
      const onAdmin = adminView && adminView.classList.contains('active');
      const onMod = modPane && !modPane.classList.contains('hidden');
      if (onAdmin && onMod && typeof loadAdminPending === 'function' && !window.__adminPendingLoading) {
        try { loadAdminPending(); } catch (e) {}
      }
    }
  } catch (e) {}
}

async function loadAdminPending() {
  window.__loadAdminPendingReal = loadAdminPending;
  /* real impl */

  if (window.__adminPendingLoading) return;
  window.__adminPendingLoading = true;
  try { initAdminUI(); } catch (e) {}

  // гарантия: панель модерации видна
  try {
    const view = document.getElementById('view-admin');
    if (view) {
      view.querySelectorAll('.settings-nav-btn[data-atab]').forEach(b => {
        b.classList.toggle('active', b.dataset.atab === 'moderation');
      });
      view.querySelectorAll('.settings-pane').forEach(p => {
        p.classList.toggle('hidden', p.id !== 'admin-pane-moderation');
      });
      const modPane = document.getElementById('admin-pane-moderation');
      if (modPane) modPane.classList.remove('hidden');
    }
  } catch (e) {}

  const list = $('#admin-pending-list');
  if (!list) return;
  list.innerHTML = '<div class="loading">Загрузка...</div>';
  // правая панель больше не используется
  const editPanel = document.getElementById('admin-edit-panel');
  if (editPanel) { editPanel.style.display = 'none'; editPanel.classList.add('hidden'); }
  try {
    // Три независимых запроса параллельно (раньше шли строго друг за другом).
    const wsApi = (typeof WS_API !== 'undefined' ? WS_API : 'api/workshop.php');
    const [pendRes, wsRes, bdRes] = await Promise.all([
      fetchJSON(`${SUBMIT_API}?action=pending`).catch(e => ({ ok: false, error: e.message || String(e) })),
      fetchJSON(wsApi + '?action=admin_pending').catch(() => ({ ok: false })),
      fetchJSON(`${SUBMIT_API}?action=pending_builds`).catch(() => ({ ok: false })),
    ]);
    if (!pendRes || !pendRes.ok) throw new Error((pendRes && pendRes.error) || 'Ошибка очереди игр');
    const games = pendRes.games || [];

    let mods = [], media = [], assets = [], builds = [];
    if (wsRes && wsRes.ok) {
      mods = wsRes.mods || [];
      media = wsRes.media || [];
      assets = wsRes.assets || [];
      window.__adminWsPending = { mods, media, assets, ts: Date.now() };
    }
    if (bdRes && bdRes.ok) builds = bdRes.builds || [];

    const total = games.length + mods.length + media.length + assets.length + builds.length;
    updateAdminPendingBadge(total);
    window.__adminPendingCount = total;
    if (!total) {
      list.innerHTML = '<div class="friends-empty">Нет заявок на модерации</div>';
      return;
    }

    const parts = [];
    // Единый список как уведомления: тип сразу в карточке + 3 квадратные кнопки
    if (games.length) {
      parts.push(games.map(g => `
        <div class="admin-pending-item" data-kind="game" data-id="${g.id}" role="button" tabindex="0">
          ${adminCoverHtml(g.cover_url ? bustUrl(g.cover_url) : '', 'game')}
          <div style="flex:1;min-width:0">
            <div class="t"><span class="admin-pending-type is-game">Игра</span>${escapeHtml(g.title)}</div>
            <div class="s">${escapeHtml(g.submitter || '—')} · ${escapeHtml(g.genre || '')}</div>
          </div>
          ${adminPendingActionsHtml({ kind: 'game', id: g.id, title: g.title || '' })}
        </div>`).join(''));
    }
    if (builds.length) {
      parts.push(builds.map(b => `
        <div class="admin-pending-item admin-pending-build" data-kind="build" data-id="${b.id}">
          ${adminCoverHtml(b.cover_url ? bustUrl(b.cover_url) : '', 'build')}
          <div style="flex:1;min-width:0">
            <div class="t"><span class="admin-pending-type is-build">Версия</span>${escapeHtml(b.game_title || 'Игра')} <span style="opacity:.75;font-weight:500">v${escapeHtml(b.version || '')}</span></div>
            <div class="s">${escapeHtml(b.submitter || b.author_name || '—')} · ${escapeHtml(String(b.changelog || '').slice(0, 80))}</div>
            <div class="s">${escapeHtml(b.file_name || '')}${b.file_size_bytes ? ' · ' + (typeof formatBytes === 'function' ? formatBytes(b.file_size_bytes) : '') : ''}</div>
          </div>
          ${adminPendingActionsHtml({ kind: 'build', id: b.id, title: b.game_title || 'Игра', extra: { buildId: b.id, gameId: b.game_id, version: b.version || '' } })}
        </div>`).join(''));
    }
    if (mods.length) {
      parts.push(mods.map(m => `
        <div class="admin-pending-item" data-kind="mod" data-id="${m.id}" role="button" tabindex="0">
          ${adminCoverHtml(m.cover_url || '', 'mod')}
          <div style="flex:1;min-width:0">
            <div class="t"><span class="admin-pending-type is-mod">Мод</span>${escapeHtml(m.title || 'Мод')}</div>
            <div class="s">${escapeHtml(m.submitter || '—')} · ${escapeHtml(m.game_title || '')}</div>
          </div>
          ${adminPendingActionsHtml({ kind: 'mod', id: m.id, title: m.title || 'Мод', preload: false })}
        </div>`).join(''));
    }
    if (media.length) {
      parts.push(media.map(m => `
        <div class="admin-pending-item" data-kind="media" data-id="${m.id}" role="button" tabindex="0">
          ${adminCoverHtml(m.image_url || '', 'media')}
          <div style="flex:1;min-width:0">
            <div class="t"><span class="admin-pending-type is-media">Медиа</span>${escapeHtml(m.title || 'Медиа')}</div>
            <div class="s">${escapeHtml(m.submitter || '—')} · ${escapeHtml(m.game_title || '')}</div>
          </div>
          ${adminPendingActionsHtml({ kind: 'media', id: m.id, title: m.title || 'Медиа', preload: false })}
        </div>`).join(''));
    }
    if (assets.length) {
      parts.push(assets.map(m => `
        <div class="admin-pending-item" data-kind="asset" data-id="${m.id}" role="button" tabindex="0">
          ${adminCoverHtml(m.cover_url || '', 'asset')}
          <div style="flex:1;min-width:0">
            <div class="t"><span class="admin-pending-type is-asset">Ассет</span>${escapeHtml(m.title || 'Ассет')}</div>
            <div class="s">${escapeHtml(m.submitter || '—')} · ${escapeHtml(m.game_title || 'без игры')}</div>
          </div>
          ${adminPendingActionsHtml({ kind: 'asset', id: m.id, title: m.title || 'Ассет', preload: false })}
        </div>`).join(''));
    }
    list.innerHTML = parts.join('');

    $$('.admin-pending-item', list).forEach(btn => {
      btn.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('.admin-act-btn')) return;
        const kind = btn.getAttribute('data-kind');
        const id = +btn.dataset.id;
        if (kind === 'game') openAdminGame(id);
        else if (kind === 'mod') openAdminWorkshopItem('mod', id);
        else if (kind === 'media') openAdminWorkshopItem('media', id);
        else if (kind === 'asset') openAdminWorkshopItem('asset', id);
      });
    });

    $$('[data-admin-act]', list).forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const act = btn.dataset.adminAct;
        const kind = btn.dataset.kind;
        const id = +btn.dataset.id;
        btn.disabled = true;
        try {
          if (act === 'preload') {
            if (kind === 'game') {
              await adminPreloadGame(id, btn.dataset.title || '');
            } else if (kind === 'build') {
              adminEnqueueBuildPreload({
                buildId: +(btn.dataset.buildId || id),
                gameId: +(btn.dataset.gameId || 0),
                title: btn.dataset.title || 'Игра',
                version: btn.dataset.version || '',
              });
            }
            return;
          }
          if (act === 'approve') {
            if (kind === 'game') {
              const res = await postJSON(SUBMIT_API + '?action=publish', { csrf_token: window.CSRF_TOKEN || '', id });
              if (!res.ok) throw new Error(res.error || 'Ошибка');
              toast('Игра опубликована');
            } else if (kind === 'build') {
              const res = await postJSON(SUBMIT_API + '?action=approve_build', { csrf_token: window.CSRF_TOKEN || '', id });
              if (!res.ok) throw new Error(res.error || 'Ошибка');
              toast('Версия опубликована');
            } else if (kind === 'mod' || kind === 'media' || kind === 'asset') {
              const data = await fetchJSON((typeof WS_API !== 'undefined' ? WS_API : 'api/workshop.php') + '?action=admin_set_status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: kind, id, status: 'published', csrf_token: window.CSRF_TOKEN || '' })
              });
              if (!data || !data.ok) throw new Error((data && data.error) || 'Ошибка');
              toast('Опубликовано');
            }
            loadAdminPending();
            return;
          }
          if (act === 'reject') {
            if (kind === 'build') {
              if (!confirm('Отклонить и удалить эту сборку?')) return;
              const res = await postJSON(SUBMIT_API + '?action=reject_build', { csrf_token: window.CSRF_TOKEN || '', id });
              if (!res.ok) throw new Error(res.error || 'Ошибка');
              toast('Отклонено');
            } else if (kind === 'game') {
              const note = prompt('Причина отказа (необязательно):', '') || '';
              const res = await postJSON(SUBMIT_API + '?action=reject', { csrf_token: window.CSRF_TOKEN || '', id, note });
              if (!res.ok) throw new Error(res.error || 'Ошибка');
              toast('Отклонено');
            } else if (kind === 'mod' || kind === 'media' || kind === 'asset') {
              if (!confirm('Отклонить заявку?')) return;
              const data = await fetchJSON((typeof WS_API !== 'undefined' ? WS_API : 'api/workshop.php') + '?action=admin_set_status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: kind, id, status: 'rejected', csrf_token: window.CSRF_TOKEN || '' })
              });
              if (!data || !data.ok) throw new Error((data && data.error) || 'Ошибка');
              toast('Отклонено');
            }
            loadAdminPending();
          }
        } catch (err) {
          toast(err.message || 'Ошибка');
        } finally {
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    list.innerHTML = `<div class="friends-empty">${escapeHtml(err.message || 'Ошибка')}<br><button type="button" class="btn-retry" id="admin-retry">Повторить</button></div>`;
    $('#admin-retry')?.addEventListener('click', loadAdminPending);
  } finally {
    window.__adminPendingLoading = false;
  }
}

async function openAdminWorkshopItem(type, id) {
  // простая модалка модерации мода/медиа
  let existing = document.getElementById('ws-admin-mod-modal');
  if (!existing) {
    existing = document.createElement('div');
    existing.id = 'ws-admin-mod-modal';
    existing.className = 'submit-modal hidden';
    existing.innerHTML = `
      <div class="submit-modal-backdrop" data-close-ws-admin></div>
      <div class="submit-modal-box" style="max-width:520px">
        <div class="submit-modal-head">
          <h2 id="ws-admin-mod-title">Модерация</h2>
          <button type="button" class="pub-modal-close" data-close-ws-admin aria-label="Закрыть">
            ${icon('x', 18)}
          </button>
        </div>
        <div class="submit-modal-body">
          <div id="ws-admin-mod-body" class="ws-admin-mod-body"></div>
        </div>
        <div class="submit-modal-foot" style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap">
          <button type="button" class="btn-ghost" id="ws-admin-cancel" data-close-ws-admin>Отменить</button>
          <button type="button" class="hp-btn-edit" id="ws-admin-reject" style="color:#f66">Отклонить</button>
          <button type="button" class="hp-btn-edit" id="ws-admin-approve" style="background:var(--accent);color:#12110e;border-color:var(--accent)">Опубликовать</button>
        </div>
      </div>`;
    document.body.appendChild(existing);
    existing.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-ws-admin]')) existing.classList.add('hidden');
    });
  }
  window.__wsAdminItem = { type, id };
  const title = document.getElementById('ws-admin-mod-title');
  const body = document.getElementById('ws-admin-mod-body');
  if (title) title.textContent = type === 'mod' ? 'Модерация мода' : (type === 'asset' ? 'Модерация ассета' : 'Модерация медиа');
  if (body) body.innerHTML = '<div class="loading">Загрузка…</div>';
  existing.classList.remove('hidden');

  try {
    // Сначала кэш с loadAdminPending — без повторного admin_pending.
    let item = null;
    const cache = window.__adminWsPending;
    if (cache) {
      const arr = type === 'mod' ? (cache.mods || []) : (type === 'asset' ? (cache.assets || []) : (cache.media || []));
      item = arr.find(x => +x.id === +id) || null;
    }
    if (!item) {
      const ws = await fetchJSON((typeof WS_API !== 'undefined' ? WS_API : 'api/workshop.php') + '?action=admin_pending');
      if (ws && ws.ok) {
        window.__adminWsPending = { mods: ws.mods || [], media: ws.media || [], assets: ws.assets || [], ts: Date.now() };
        const arr = type === 'mod' ? (ws.mods || []) : (type === 'asset' ? (ws.assets || []) : (ws.media || []));
        item = arr.find(x => +x.id === +id) || null;
      }
    }
    if (body) {
      if (!item) {
        body.innerHTML = '<p>Заявка #' + id + '</p>';
      } else {
        const cover = type === 'media' ? (item.image_url || '') : (item.cover_url || '');
        body.innerHTML = `
          ${cover ? `<img src="${escapeHtml(cover)}" alt="" style="max-width:100%;max-height:200px;border-radius:10px;margin-bottom:12px;object-fit:cover" />` : ''}
          <div style="font-weight:700;font-size:1.05rem;color:var(--text-bright);margin-bottom:6px">${escapeHtml(item.title || '')}</div>
          <div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:4px">Автор: ${escapeHtml(item.submitter || '—')}</div>
          <div style="font-size:0.85rem;color:var(--text-muted)">Игра: ${escapeHtml(item.game_title || '—')}</div>`;
      }
    }
  } catch (e) {
    if (body) body.innerHTML = '<p>' + escapeHtml(e.message || 'Ошибка') + '</p>';
  }

  const approve = document.getElementById('ws-admin-approve');
  const reject = document.getElementById('ws-admin-reject');
  const bind = (btn, status) => {
    if (!btn) return;
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const data = await fetchJSON((typeof WS_API !== 'undefined' ? WS_API : 'api/workshop.php') + '?action=admin_set_status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, id, status, csrf_token: window.CSRF_TOKEN || '' })
        });
        if (!data || !data.ok) throw new Error((data && data.error) || 'Ошибка');
        toast(status === 'published' ? 'Опубликовано' : 'Отклонено');
        existing.classList.add('hidden');
        loadAdminPending();
      } catch (err) {
        toast(err.message || 'Ошибка');
      } finally {
        btn.disabled = false;
      }
    };
  };
  bind(approve, 'published');
  bind(reject, 'rejected');
}
window.openAdminWorkshopItem = openAdminWorkshopItem;

async function openAdminGame(id) {
  adminDeleteMedia = [];
  try {
    const data = await fetchJSON(`${SUBMIT_API}?action=get&id=${id}`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const g = data.game;
    // основная форма = публикация (модалку открываем сразу)
    await openPublishFormForGame(g, { moderate: true });
    // builds уже в get — не ходим в list_builds второй раз
    if (!Array.isArray(g.builds) || !g.builds.length) {
      try { await loadGameBuildsIntoForm(g.id); } catch (e) {}
    }
    if (Array.isArray(g.builds) && g.builds.length) {
      const b = g.builds[0];
      const ver = document.getElementById('sg-build-version');
      const ch = document.getElementById('sg-build-changelog');
      const nameEl = document.getElementById('sg-build-file-name');
      const exist = document.getElementById('sg-build-existing');
      if (ver) ver.value = b.version || '';
      if (ch) ch.value = b.changelog || '';
      const fname = b.file_name || (b.file_url ? String(b.file_url).split('/').pop() : '') || 'файл';
      if (nameEl) nameEl.textContent = fname + (b.file_size_bytes ? ' · ' + formatBytes(b.file_size_bytes) : '');
      if (exist) {
        exist.style.display = 'block';
        exist.innerHTML = '<strong>Сборка с заявки:</strong> v' + escapeHtml(b.version || '—')
          + (b.changelog ? ' — ' + escapeHtml(String(b.changelog)) : '')
          + '<br>Файл: ' + escapeHtml(fname);
      }
    }
    // ниже — синхронизация старой боковой панели (если есть)
    $('#admin-empty')?.classList.add('hidden');
    const form = $('#admin-game-form');
    form?.classList.remove('hidden');
    $('#admin-game-id').value = g.id;
    $('#admin-title').value = g.title || '';
    $('#admin-genre').value = g.genre || '';
    $('#admin-price').value = g.price || 0;
    $('#admin-short').value = g.short_description || '';
    $('#admin-desc').value = g.description || '';
    fillSysReq('#admin-sys-min-fields', g.sys_req_min);
    fillSysReq('#admin-sys-rec-fields', g.sys_req_rec);
    $('#admin-controllers').value = g.controllers || '';
    renderLangTable('#admin-lang-table', g.languages);
    $('#admin-video').value = g.video_url || '';
    $('#admin-note').value = g.review_note || '';

    // Модерация: открыть ту же модалку, что публикация
    try {
      window.__adminModeratingId = g.id;
      const formModal = $('#submit-form-modal');
      if (formModal) {
        if ($('#sg-title')) $('#sg-title').value = g.title || '';
        if ($('#sg-price')) $('#sg-price').value = String(parseInt(g.price, 10) || 0);
        if ($('#sg-developer')) $('#sg-developer').value = g.developer || '';
        if ($('#sg-publisher')) $('#sg-publisher').value = g.developer_name || g.developer || '';
        if ($('#sg-short')) $('#sg-short').value = g.short_description || '';
        if ($('#sg-tags')) $('#sg-tags').value = g.tags || '';
        if ($('#sg-video')) $('#sg-video').value = g.video_url || '';
        const genres = String(g.genre || '').split(',').map(s => s.trim()).filter(Boolean);
        $$('.sg-genre').forEach(c => { c.checked = genres.includes(c.value); });
        if (typeof syncPublishGenres === 'function') syncPublishGenres();
        const ed = $('#sg-desc-editor');
        if (ed) ed.innerHTML = g.description || '';
        if ($('#sg-desc')) $('#sg-desc').value = g.description || '';
        try { fillSysReq('#sg-sys-min-fields', g.sys_req_min); } catch (e) {}
        try { fillSysReq('#sg-sys-rec-fields', g.sys_req_rec); } catch (e) {}
        try { renderLangTable('#sg-lang-table', g.languages); } catch (e) {}
        const setPrev = (pid, url) => {
          if (typeof setPubPreviewImg === 'function') setPubPreviewImg(pid, url || '');
        };
        setPrev('sg-cover-preview', g.cover_url || g.cover_src);
        setPrev('sg-banner-preview', g.banner_url);
        setPrev('sg-logo-preview', g.logo_url);
        setPrev('sg-icon-preview', g.icon_url || g.icon_src);
        const h2 = formModal.querySelector('.pub-modal-head h2, .submit-modal-head h2');
        if (h2) h2.textContent = 'Модерация: ' + (g.title || 'игра');
        const sub = formModal.querySelector('.pub-modal-sub');
        if (sub) sub.textContent = 'Проверьте карточку и опубликуйте или отклоните';
        const sendBtn = $('#submit-game-send');
        if (sendBtn) {
          sendBtn.textContent = 'Опубликовать';
          sendBtn.dataset.adminPublish = '1';
        }
        let rej = $('#submit-admin-reject');
        if (!rej) {
          rej = document.createElement('button');
          rej.type = 'button';
          rej.className = 'hp-btn-edit';
          rej.id = 'submit-admin-reject';
          rej.textContent = 'Отклонить';
          if (sendBtn && sendBtn.parentElement) sendBtn.parentElement.insertBefore(rej, sendBtn);
          rej.addEventListener('click', async () => {
            const note = prompt('Причина отказа (необязательно):', '') || '';
            try {
              const res = await postJSON(SUBMIT_API + '?action=reject', {
                csrf_token: window.CSRF_TOKEN || '',
                id: window.__adminModeratingId,
                note
              });
              if (!res.ok) throw new Error(res.error || 'Ошибка');
              toast('Отклонено');
              formModal.classList.add('hidden');
              if (typeof resetPublishModalMode === 'function') resetPublishModalMode();
              loadAdminPending();
            } catch (err) { toast(err.message); }
          });
        }
        rej.classList.remove('hidden');
        formModal.classList.remove('hidden');
        try { initPublishFilePreviews(formModal); initPublishRte(); } catch (e) {}
      }
    } catch (e) { console.warn(e); }


    // Сброс файлов и превью от предыдущей игры
    const coverInput = $('#admin-cover');
    const bannerInput = $('#admin-banner');
    const shotsInput = $('#admin-shots');
    if (coverInput) coverInput.value = '';
    if (bannerInput) bannerInput.value = '';
    if (shotsInput) shotsInput.value = '';
    const coverPrev = $('#admin-cover-preview');
    const bannerPrev = $('#admin-banner-preview');
    if (coverPrev) { coverPrev.style.display = 'none'; coverPrev.removeAttribute('src'); }
    if (bannerPrev) { bannerPrev.style.display = 'none'; bannerPrev.removeAttribute('src'); }

    const media = $('#admin-media-list');
    if (media) {
      const list = g.media || [];
      media.innerHTML = list.length
        ? list.map(m => `
        <div class="admin-media-thumb" data-mid="${m.id}">
          <img src="${escapeHtml(bustUrl(m.url))}" alt="" />
          <button type="button" title="Удалить" data-del="${m.id}">×</button>
        </div>`).join('')
        : '<div class="settings-hint">Медиа нет</div>';
      $$('[data-del]', media).forEach(b => {
        b.addEventListener('click', () => {
          adminDeleteMedia.push(+b.dataset.del);
          b.closest('.admin-media-thumb')?.remove();
        });
      });
    }
    // обложка в списке слева — актуальная с сервера (с cache-bust)
    const coverUrl = g.cover_url || g.cover_src || (g.id ? ('media.php?type=cover&id=' + g.id) : '');
    if (coverUrl) setPendingItemCover(id, bustUrl(coverUrl));
    // title в списке — не затирать бейдж типа (Игра / Медиа / …)
    const pend = document.querySelector(`.admin-pending-item[data-id="${id}"]`);
    if (pend) {
      const t = pend.querySelector('.t');
      if (t && g.title) {
        const badge = t.querySelector('.admin-pending-type');
        t.textContent = '';
        if (badge) t.appendChild(badge);
        t.appendChild(document.createTextNode(g.title));
      }
    }
    $$('.admin-pending-item').forEach(el => el.classList.toggle('active', +el.dataset.id === id));
  } catch (err) {
    toast(err.message);
  }
}


async function loadAdminUsers() {
  const list = $('#admin-users-list');
  if (!list) return;
  const q = ($('#admin-users-search')?.value || '').trim();
  const filter = $('#admin-users-filter')?.value || 'all';
  list.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const data = await fetchJSON(`${ADMIN_API}?action=list_users&q=${encodeURIComponent(q)}&filter=${encodeURIComponent(filter)}`);
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const users = data.users || [];
    if (!users.length) {
      list.innerHTML = '<div class="friends-empty">Никого не найдено</div>';
      return;
    }
    list.innerHTML = users.map(u => {
      const avStyle = u.avatar_url
        ? `background-image:url('${escapeHtml(avatarUrlBust(u.avatar_url, u.id))}');background-size:cover;background-position:center;`
        : `background:${escapeHtml(u.avatar_color || '#ef5b2c')}`;
      const letter = (u.username || '?').slice(0, 1).toUpperCase();
      const badges = [];
      if (+u.is_banned) badges.push('<span class="admin-user-badge is-banned">Забанен</span>');
      if (u.role === 'admin') badges.push('<span class="admin-user-badge is-admin">Админ</span>');
      else if (u.role === 'developer') badges.push('<span class="admin-user-badge is-dev">Разработчик</span>');
      else {
        // та же логика, что на профиле: < 30 дней = Новичок
        let isNewbie = false;
        if (u.created_at) {
          const ts = new Date(String(u.created_at).replace(' ', 'T')).getTime();
          if (ts && (Date.now() - ts) < 30 * 86400 * 1000) isNewbie = true;
        }
        if (isNewbie) badges.push('<span class="admin-user-badge is-newbie">Новичок</span>');
        else badges.push('<span class="admin-user-badge is-user">Игрок</span>');
      }
      return `
        <div class="admin-user-row" data-id="${u.id}" data-username="${escapeHtml(u.username)}">
          <div class="admin-user-av" style="${avStyle}">${u.avatar_url ? '' : escapeHtml(letter)}</div>
          <div class="admin-user-info">
            <div class="admin-user-name">${escapeHtml(u.username)}</div>
            <div class="admin-user-meta">${escapeHtml(u.email || '')} · id ${u.id}</div>
            <div class="admin-user-badges">${badges.join('')}</div>
          </div>
          <div class="admin-user-actions">
            <button type="button" class="hp-btn-edit" data-act="profile">Профиль</button>
            <button type="button" class="hp-btn-edit" data-act="edit">Редактировать</button>
          </div>
        </div>`;
    }).join('');
    $$('.admin-user-row', list).forEach(row => {
      const id = +row.dataset.id;
      const uname = row.dataset.username;
      row.querySelector('[data-act="profile"]')?.addEventListener('click', () => openUserProfile(uname, id));
      row.querySelector('[data-act="edit"]')?.addEventListener('click', () => {
        openAdminUserModal({ id, username: uname, role: 'user' });
      });
    });
  } catch (err) {
    list.innerHTML = `<div class="friends-empty">${escapeHtml(err.message || 'Ошибка')}</div>`;
  }
}

function initAdminUsersControls() {
  let t = null;
  const run = () => loadAdminUsers();
  $('#admin-users-search')?.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(run, 250);
  });
  $('#admin-users-filter')?.addEventListener('change', run);
}

function setPendingItemCover(gameId, url) {
  if (!gameId || !url) return;
  const btn = document.querySelector(`.admin-pending-item[data-id="${gameId}"]`);
  if (!btn) return;
  let img = btn.querySelector('img');
  const ph = btn.querySelector('.admin-pending-cover.is-ph');
  if (!img) {
    img = document.createElement('img');
    img.alt = '';
    if (ph) ph.replaceWith(img);
    else btn.insertBefore(img, btn.firstChild);
  } else if (ph) {
    ph.remove();
  }
  img.style.display = '';
  img.onerror = () => {
    // вернуть серую заглушку с иконкой игры
    const d = document.createElement('div');
    d.className = 'admin-pending-cover is-ph is-game';
    d.innerHTML = (typeof ADMIN_SECTION_ICO !== 'undefined' && ADMIN_SECTION_ICO.game) ? ADMIN_SECTION_ICO.game : '';
    img.replaceWith(d);
  };
  img.src = url;
}

function bustUrl(url) {
  if (!url) return '';
  const u = String(url);
  const sep = u.includes('?') ? '&' : '?';
  return u + sep + 'v=' + (window.__mediaBust || Date.now());
}

function refreshGameImagesEverywhere(gameId) {
  if (!gameId) return;
  window.__mediaBust = Date.now();
  window.__iconBust = window.__mediaBust;
  const selectors = [
    `.admin-pending-item[data-id="${gameId}"] img`,
    `#admin-media-list img`,
    `.home-card[data-id="${gameId}"] img`,
    `.game-card[data-id="${gameId}"] img`,
    `.store-row[data-id="${gameId}"] img`,
    `.lib-card[data-id="${gameId}"] img`,
    `.hp-game-card[data-id="${gameId}"] img`,
    `.gp-similar-card[data-id="${gameId}"] img`,
  ];
  selectors.forEach(sel => {
    $$(sel).forEach(img => {
      const src = img.getAttribute('src') || '';
      if (!src || src.startsWith('blob:')) return;
      // force reload
      const base = src.replace(/([?&])v=\d+/, '').replace(/[?&]$/, '');
      img.src = bustUrl(base);
    });
  });
  // hero on game page if open
  const hero = $('.gp-hero-bg');
  if (hero && hero.src) {
    const base = hero.src.replace(/([?&])v=\d+/, '').replace(/[?&]$/, '');
    hero.src = bustUrl(base);
  }
}

function bindAdminMediaPreviews() {
  const bind = (inputId, previewId, kind) => {
    const input = $(inputId);
    const preview = $(previewId);
    if (!input || input.dataset.previewBound === '1') return;
    input.dataset.previewBound = '1';
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      const gameId = $('#admin-game-id')?.value;
      if (!f) {
        if (preview) {
          preview.style.display = 'none';
          preview.removeAttribute('src');
        }
        return;
      }
      if (preview) {
        if (preview._objUrl) URL.revokeObjectURL(preview._objUrl);
        preview._objUrl = URL.createObjectURL(f);
        preview.src = preview._objUrl;
        preview.style.display = 'block';
      }
      // сразу в списке слева (обложка/иконка)
      if (kind === 'cover' && gameId) {
        setPendingItemCover(gameId, preview ? preview.src : URL.createObjectURL(f));
      }
      // сразу в блоке текущих медиа — временный thumb
      if (kind === 'cover') {
        const media = $('#admin-media-list');
        if (media) {
          let tmp = media.querySelector('.admin-media-thumb.is-pending-cover');
          if (!tmp) {
            tmp = document.createElement('div');
            tmp.className = 'admin-media-thumb is-pending-cover';
            tmp.innerHTML = '<img alt="" /><span class="settings-hint" style="position:absolute;bottom:2px;left:2px;right:2px;font-size:10px;background:rgba(0,0,0,.65);color:#fff;text-align:center;border-radius:2px">новая</span>';
            media.prepend(tmp);
          }
          const img = tmp.querySelector('img');
          if (img) img.src = preview ? preview.src : URL.createObjectURL(f);
        }
      }
    });
  };
  bind('#admin-cover', '#admin-cover-preview', 'cover');
  bind('#admin-banner', '#admin-banner-preview', 'banner');
}

function initAdminPanel() {
  if (!$('#view-admin')) return;
  try { initAdminUI(); } catch (e) {}
  try { bindAdminMediaPreviews(); } catch (e) {}
  // load when opening admin view - hook showView
  $('#admin-save')?.addEventListener('click', async () => {
    const id = $('#admin-game-id')?.value;
    if (!id) return;
    const fd = new FormData();
    fd.append('csrf_token', window.CSRF_TOKEN || '');
    fd.append('id', id);
    fd.append('title', $('#admin-title')?.value || '');
    fd.append('genre', $('#admin-genre')?.value || '');
    fd.append('price', $('#admin-price')?.value || '0');
    fd.append('short_description', $('#admin-short')?.value || '');
    fd.append('description', $('#admin-desc')?.value || '');
    fd.append('sys_req_min', JSON.stringify(collectSysReq('#admin-sys-min-fields')));
    fd.append('sys_req_rec', JSON.stringify(collectSysReq('#admin-sys-rec-fields')));
    fd.append('controllers', $('#admin-controllers')?.value || '');
    fd.append('languages', JSON.stringify(collectLanguages('#admin-lang-table')));
    fd.append('video_url', $('#admin-video')?.value || '');
    fd.append('review_note', $('#admin-note')?.value || '');
    fd.append('delete_media', adminDeleteMedia.join(','));
    const cover = $('#admin-cover')?.files?.[0];
    if (cover) fd.append('cover', cover);
    const banner = $('#admin-banner')?.files?.[0];
    if (banner) fd.append('banner', banner);
    const shots = $('#admin-shots')?.files;
    if (shots) for (let i = 0; i < shots.length; i++) fd.append('screenshots[]', shots[i]);
    try {
      const res = await fetch(`${SUBMIT_API}?action=admin_save`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Ошибка');
      toast('Сохранено');
      homeCache = null;
      storeCache = [];
      window.__mediaBust = Date.now();
      window.__iconBust = window.__mediaBust;
      await openAdminGame(+id);
      refreshGameImagesEverywhere(+id);
    } catch (err) { toast(err.message); }
  });

  $('#admin-publish')?.addEventListener('click', async () => {
    const id = +($('#admin-game-id')?.value || 0);
    if (!id) return;
    const btn = $('#admin-publish');
    if (btn) btn.disabled = true;
    try {
      // Сначала сохраняем текущие поля формы
      const fd = new FormData();
      fd.append('csrf_token', window.CSRF_TOKEN || '');
      fd.append('id', id);
      fd.append('title', $('#admin-title')?.value || '');
      fd.append('genre', $('#admin-genre')?.value || '');
      fd.append('price', $('#admin-price')?.value || '0');
      fd.append('short_description', $('#admin-short')?.value || '');
      fd.append('description', $('#admin-desc')?.value || '');
      fd.append('video_url', $('#admin-video')?.value || '');
      fd.append('sys_req_min', $('#admin-sys-min')?.value || '');
      fd.append('sys_req_rec', $('#admin-sys-rec')?.value || '');
      fd.append('controllers', $('#admin-controllers')?.value || '');
      fd.append('languages', $('#admin-languages')?.value || '');
      fd.append('review_note', $('#admin-note')?.value || '');
      fd.append('delete_media', '');
      const cover = $('#admin-cover')?.files?.[0];
      if (cover) fd.append('cover', cover);
      const banner = $('#admin-banner')?.files?.[0];
      if (banner) fd.append('banner', banner);
      const shots = $('#admin-shots')?.files;
      if (shots) for (let i = 0; i < shots.length; i++) fd.append('screenshots[]', shots[i]);

      const saveRes = await fetch(`${SUBMIT_API}?action=admin_save`, { method: 'POST', body: fd });
      const saveData = await saveRes.json();
      if (!saveData.ok) throw new Error(saveData.error || 'Ошибка сохранения перед публикацией');

      const res = await postJSON(`${SUBMIT_API}?action=publish`, { id }, FETCH_TIMEOUT_LONG);
      if (!res.ok) throw new Error(res.error || 'Ошибка публикации');
      toast('Игра опубликована');
      homeCache = null;
      storeCache = [];
      $('#admin-game-form')?.classList.add('hidden');
      $('#admin-empty')?.classList.remove('hidden');
      loadAdminPending();
    } catch (err) { toast(err.message); }
    finally { if (btn) btn.disabled = false; }
  });

  $('#admin-reject')?.addEventListener('click', async () => {
    const id = +($('#admin-game-id')?.value || 0);
    if (!id) return;
    try {
      const res = await postJSON(`${SUBMIT_API}?action=reject`, {
        id,
        note: $('#admin-note')?.value || '',
      }, FETCH_TIMEOUT_LONG);
      if (!res.ok) throw new Error(res.error || 'Ошибка');
      toast('Отклонено');
      $('#admin-game-form')?.classList.add('hidden');
      $('#admin-empty')?.classList.remove('hidden');
      loadAdminPending();
    } catch (err) { toast(err.message); }
  });
}



// Phase3: явная регистрация для catio-lazy stub
try {
  window.__loadAdminPendingReal = loadAdminPending;
  window.loadAdminPending = loadAdminPending;
  if (typeof openAdminGame === 'function') window.openAdminGame = openAdminGame;
} catch (e) {}
