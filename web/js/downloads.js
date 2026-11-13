/* CATio — downloads queue */
/* Depends: icons, utils */

// ============================================================
//  ЗАГРУЗКИ (как в Steam): очередь, прогресс, скорость, пауза
// ============================================================
// Сервер отдаёт файл потоком (и поддерживает Range — докачка с места паузы),
// поэтому прогресс и скорость здесь настоящие.
const dm = {
  queue: [],        // {buildId, title, platform, version, size, status}
  active: null,
  pausedItem: null, // загрузка на паузе (куски сохранены, докачаем с Range)
  history: [],      // завершённые {title, platform, version, size, at}
  seq: 0,
};

function updateDownloadsBadge() {
  const badge = $('#downloads-badge');
  const n = dm.queue.length + (dm.active ? 1 : 0) + (dm.pausedItem ? 1 : 0);
  if (badge) {
    badge.textContent = n;
    badge.classList.toggle('hidden', n === 0);
  }
  const st = $('#side-dl-status');
  if (st) {
    st.textContent = n > 0 ? `Активных загрузок: ${n}` : 'Нет активных загрузок';
  }
}

function isGameDownloading(gameId) {
  gameId = +gameId;
  if (!gameId) return false;
  if (dm.active && +dm.active.gameId === gameId) return true;
  if (dm.queue && dm.queue.some(q => +q.gameId === gameId)) return true;
  if (dm.pausedItem && +dm.pausedItem.gameId === gameId) return true;
  return false;
}
function refreshGameInstallButton(gameId) {
  gameId = +gameId;
  try {
    const g = (window.__currentGame && +window.__currentGame.id === gameId)
      ? window.__currentGame
      : (window.__currentGamePage && +window.__currentGamePage.id === gameId ? window.__currentGamePage : null);
    if (g && typeof refreshBuyButton === 'function') refreshBuyButton(g);
  } catch (e) {}
  // кнопки сборок на странице
  try {
    document.querySelectorAll('.btn-download[data-build-id]').forEach(btn => {
      // не трогаем locked/installed — только активные «Установить»
      if (btn.disabled && btn.dataset.mode !== 'installing') return;
    });
  } catch (e) {}
}
function enqueueDownload(item) {
  const already =
    (dm.active && dm.active.buildId === item.buildId) ||
    dm.queue.some(q => q.buildId === item.buildId);
  if (already) {
    toast('Эта сборка уже в очереди загрузок');
    gotoView('downloads');
    return;
  }
  // та же игра уже качается / в очереди (кроме админ-предзагрузки)
  if (item.gameId && !item.adminPreload && isGameDownloading(item.gameId)) {
    toast('Эта игра уже устанавливается');
    refreshGameInstallButton(item.gameId);
    return;
  }
  item.id = ++dm.seq;
  item.received = 0;
  item.status = 'queued';
  dm.queue.push(item);
  if (item.adminPreload) {
    toast('Добавлено в загрузки для проверки');
  } else {
    toast(`«${item.title}» добавлена в загрузки`);
  }
  updateDownloadsBadge();
  if (item.gameId && !item.adminPreload) refreshGameInstallButton(item.gameId);
  if (getViewFromUrl() === 'downloads') renderDownloadsView();
  pumpDownloads();
}

async function pumpDownloads() {
  if (dm.active || !dm.queue.length) {
    renderDownloadsView();
    return;
  }
  const item = dm.queue.shift();
  await runDownload(item, item.status === 'queued' && item.received ? item.received : 0);
  setTimeout(pumpDownloads, 0);
}

async function runDownload(item, offset) {
  dm.active = item;
  item.status = 'downloading';
  item.speed = 0;
  item.startedAt = Date.now();
  item.chunks = item.chunks || [];
  item.controller = new AbortController();
  renderDownloadsView();
  updateDownloadsBadge();
  if (item.gameId) refreshGameInstallButton(item.gameId);

  let lastBytes = offset;
  let lastTick = Date.now();
  const speedTimer = setInterval(() => {
    const now = Date.now();
    const dt = (now - lastTick) / 1000;
    if (dt > 0) {
      item.speed = (item.received - lastBytes) / dt;
      lastBytes = item.received;
      lastTick = now;
      updateDownloadProgressDom(item);
    }
  }, 500);

  try {
    const headers = offset > 0 ? { Range: `bytes=${offset}-` } : {};
    const res = await fetch(`${API_BASE}?action=download&build_id=${item.buildId}`, {
      headers,
      signal: item.controller.signal,
    });

    if (!res.ok && res.status !== 206) {
      let msg = 'HTTP ' + res.status;
      try { msg = (await res.json()).error || msg; } catch (e) {}
      throw new Error(msg);
    }

    const total = parseInt(res.headers.get('Content-Length') || '0', 10);
    item.total = offset + (total || 0);
    if (offset > 0) item.received = offset;

    const reader = res.body.getReader();
    while (true) {
      if (item.paused) {
        // Пауза: рвём чтение, скачанные куски сохраняем — докачаем с Range
        try { await reader.cancel(); } catch (e) {}
        item.status = 'paused';
        clearInterval(speedTimer);
        dm.active = null;
        dm.pausedItem = item;
        renderDownloadsView();
        updateDownloadsBadge();
        setTimeout(pumpDownloads, 0); // очередь едет дальше
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      item.chunks.push(value);
      item.received += value.length;
      updateDownloadProgressDom(item);
    }

    clearInterval(speedTimer);

    if (!item.total) item.total = item.received;

    // Сохраняем файл
    const blob = new Blob(item.chunks, { type: 'application/octet-stream' });
    const ext = (res.headers.get('Content-Disposition') || '').match(/\.(\w+)"?$/)?.[1] || 'zip';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${item.title.replace(/[^\wа-яА-ЯёЁ\- ]/gi, '').trim().replace(/\s+/g, '-')}-v${item.version}-${item.platform}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);

    item.status = 'done';
    dm.active = null;
    dm.history.unshift({
      title: item.title,
      platform: item.platform,
      version: item.version,
      size: item.received,
      at: new Date().toISOString(),
    });
    if (!item.preDownload) {
      markVersionInstalled(item.gameId, item.version, item.buildId, item.received);
      markInstalled(item.gameId);
    }
    toast(item.preDownload ? `Предзагрузка «${item.title}» готова` : `«${item.title}» установлена`);
    // обновить кнопку на странице игры
    try {
      if (item.gameId) refreshGameInstallButton(item.gameId);
      const buildsBox = document.getElementById('game-builds');
      const pageGame = window.__currentGamePage || window.__currentGame;
      if (buildsBox && pageGame && +pageGame.id === +item.gameId) {
        buildsBox.innerHTML = renderBuildsList(window.__currentGameBuilds || [], pageGame);
        initBuildButtons(document.getElementById('game-page') || document, pageGame);
      }
    } catch (e) {}
    renderDownloadsView();
    updateDownloadsBadge();
  } catch (err) {
    clearInterval(speedTimer);
    if (item.paused) {
      // AbortController от паузы приводит сюда — это не ошибка
      item.status = 'paused';
      dm.pausedItem = item;
      dm.active = null;
      renderDownloadsView();
      updateDownloadsBadge();
      setTimeout(pumpDownloads, 0);
      return;
    }
    item.status = 'error';
    item.error = err.name === 'AbortError' ? 'Отменено' : (err.message || 'Ошибка загрузки');
    toast(item.error);
    dm.active = null;
    if (item.gameId) refreshGameInstallButton(item.gameId);
    renderDownloadsView();
    updateDownloadsBadge();
    setTimeout(pumpDownloads, 0);
  }
}

function pauseDownload() {
  if (dm.active && dm.active.status === 'downloading') {
    dm.active.paused = true;
    try { dm.active.controller.abort(); } catch (e) {}
  }
}

function resumePausedDownload() {
  const it = dm.pausedItem;
  if (!it) return;
  if (dm.active) {
    // Уже что-то качается — честно ставим назад в начало очереди
    dm.pausedItem = null;
    it.status = 'queued';
    dm.queue.unshift(it);
    toast('Поставлена в очередь — докачаем с места паузы');
    renderDownloadsView();
    updateDownloadsBadge();
    return;
  }
  dm.pausedItem = null;
  it.paused = false;
  runDownload(it, it.received || 0);
}

function cancelActiveDownload() {
  if (dm.pausedItem) {
    // Отмена приостановленной — просто выбрасываем куски
    dm.pausedItem = null;
    renderDownloadsView();
    updateDownloadsBadge();
    setTimeout(pumpDownloads, 0);
    return;
  }
  if (dm.active) {
    const item = dm.active;
    item.paused = false;
    item.cancelled = true;
    try { item.controller.abort(); } catch (e) {}
    item.status = 'cancelled';
    dm.active = null;
    renderDownloadsView();
    updateDownloadsBadge();
    setTimeout(pumpDownloads, 0);
  }
}
function renderDownloadsView() {
  const activeBox = $('#downloads-active');
  if (!activeBox) return;

  const item = dm.active || dm.pausedItem;
  const queued = dlSearch
    ? dm.queue.filter(q => (q.title || '').toLowerCase().includes(dlSearch.toLowerCase()))
    : dm.queue;

  if (!item && !queued.length) {
    activeBox.innerHTML = `
      <div class="downloads-empty" id="downloads-empty">
        <div class="downloads-empty-icon" aria-hidden="true">
          ${icon('download-lg', 88)}
        </div>
        <p class="downloads-empty-title">Здесь так пусто...</p>
        <p class="downloads-empty-sub">Вы ещё ничего не скачали через CATio, но никогда не поздно начать.</p>
      </div>`;
  } else {
    let html = '';
    if (item) {
      const pct = item.total ? Math.min(100, (item.received / item.total) * 100) : 0;
      html += `
      <div class="dl-item active" id="dl-active" data-id="${item.id}">
        <div class="dl-row">
          <div class="dl-info">
            <div class="dl-title">${escapeHtml(item.title)}</div>
            <div class="dl-meta">${escapeHtml(item.platform)} · v${escapeHtml(item.version)}</div>
          </div>
          <div class="dl-status ${item.status}">${statusText(item)}</div>
        </div>
        <div class="dl-bar"><div class="dl-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
        <div class="dl-numbers">
          <span class="dl-bytes">${formatSize(item.received)} / ${item.total ? formatSize(item.total) : '…'}</span>
          <span class="dl-pct">${pct.toFixed(0)}%</span>
          <span class="dl-speed">${item.status === 'downloading' ? formatSpeed(item.speed || 0) : ''}</span>
        </div>
        <div class="dl-actions">
          ${item.status === 'downloading'
            ? '<button type="button" class="btn-ghost" id="dl-pause">Пауза</button>'
            : ''}
          ${item.status === 'paused'
            ? '<button type="button" class="btn-primary" id="dl-resume">Продолжить</button>'
            : ''}
          <button type="button" class="btn-ghost danger" id="dl-cancel">Отмена</button>
        </div>
      </div>`;
    }
    if (dm.pausedItem && dm.active) {
      // Есть и активная, и приостановленная — показываем паузу отдельной строкой
      const p = dm.pausedItem;
      const ppct = p.total ? Math.min(100, (p.received / p.total) * 100) : 0;
      html += `
      <div class="dl-item paused">
        <div class="dl-row">
          <div class="dl-info">
            <div class="dl-title">${escapeHtml(p.title)}</div>
            <div class="dl-meta">${escapeHtml(p.platform)} · v${escapeHtml(p.version)} · ${ppct.toFixed(0)}%</div>
          </div>
          <div class="dl-status paused">На паузе</div>
        </div>
        <div class="dl-actions">
          <button type="button" class="btn-primary" id="dl-resume">Продолжить</button>
          <button type="button" class="btn-ghost danger" id="dl-cancel">Отмена</button>
        </div>
      </div>`;
    }
    if (queued.length) {
      html += '<h3 class="downloads-queue-title">В очереди</h3>' + queued.map(q => `
        <div class="dl-item queued">
          <div class="dl-row">
            <div class="dl-info">
              <div class="dl-title">${escapeHtml(q.title)}</div>
              <div class="dl-meta">${escapeHtml(q.platform)} · v${escapeHtml(q.version)}</div>
            </div>
            <div class="dl-status queued">В очереди</div>
          </div>
        </div>`).join('');
    }
    activeBox.innerHTML = html;

    const pauseBtn = $('#dl-pause');
    if (pauseBtn) pauseBtn.addEventListener('click', pauseDownload);
    const resumeBtn = $('#dl-resume');
    if (resumeBtn) resumeBtn.addEventListener('click', resumePausedDownload);
    const cancelBtn = $('#dl-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', cancelActiveDownload);
  }

  renderDownloadsHistory();
}

function statusText(item) {
  switch (item.status) {
    case 'downloading': return 'Загружается';
    case 'paused': return 'На паузе';
    case 'error': return 'Ошибка: ' + (item.error || '');
    case 'cancelled': return 'Отменена';
    default: return item.status;
  }
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec < 1) return '0 КБ/с';
  if (bytesPerSec < 1024 * 1024) return (bytesPerSec / 1024).toFixed(0) + ' КБ/с';
  return (bytesPerSec / 1024 / 1024).toFixed(1) + ' МБ/с';
}

// Обновляем только цифры/полоску — без перерисовки (иначе кнопки моргают)
function updateDownloadProgressDom(item) {
  const box = $('#dl-active');
  if (!box || !dm.active || dm.active.id !== item.id) return;
  const pct = item.total ? Math.min(100, (item.received / item.total) * 100) : 0;
  const fill = box.querySelector('.dl-bar-fill');
  const bytes = box.querySelector('.dl-bytes');
  const pctEl = box.querySelector('.dl-pct');
  const speed = box.querySelector('.dl-speed');
  if (fill) fill.style.width = pct.toFixed(1) + '%';
  if (bytes) bytes.textContent = `${formatSize(item.received)} / ${item.total ? formatSize(item.total) : '…'}`;
  if (pctEl) pctEl.textContent = pct.toFixed(0) + '%';
  if (speed) speed.textContent = item.status === 'downloading' ? formatSpeed(item.speed || 0) : '';
}

function renderDownloadsHistory() {
  const box = $('#downloads-history');
  if (!box) return;
  const history = dlSearch
    ? dm.history.filter(h => (h.title || '').toLowerCase().includes(dlSearch.toLowerCase()))
    : dm.history;
  if (!history.length) {
    box.innerHTML = '<p class="downloads-history-empty">Пока пусто</p>';
    return;
  }
  box.innerHTML = history.map(h => `
    <div class="dl-history-row">
      <div class="dl-info">
        <div class="dl-title">${escapeHtml(h.title)}</div>
        <div class="dl-meta">${escapeHtml(h.platform)} · v${escapeHtml(h.version)}</div>
      </div>
      <div class="dl-history-meta">
        <span>${formatSize(h.size)}</span>
        <span class="dl-history-time">${formatDateTime(h.at)}</span>
      </div>
    </div>`).join('');
}

