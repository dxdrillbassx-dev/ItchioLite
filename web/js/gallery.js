/* CATio — game gallery (trailers/screenshots) + lightbox */

// ---------- Галерея: видео (трейлеры) + скриншоты ----------

/** Несколько трейлеров: JSON-массив строк или через перевод строки */
function parseTrailerList(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.map(String).map(s => s.trim()).filter(Boolean);
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const j = JSON.parse(s);
      if (Array.isArray(j)) {
        return j.map(x => {
          if (typeof x === 'string') return x.trim();
          if (x && typeof x === 'object') return String(x.url || x.src || x.mp4 || x.source_url || '').trim();
          return '';
        }).filter(Boolean);
      }
    } catch (e) {}
  }
  return s.split(/\r?\n+/).map(x => x.trim()).filter(Boolean);
}
function serializeTrailerList(list) {
  const arr = (list || []).map(s => String(s).trim()).filter(Boolean);
  return arr.length ? JSON.stringify(arr) : '';
}
function collectTrailerInputs() {
  const box = document.getElementById('sg-trailers-list');
  if (!box) {
    const single = document.getElementById('sg-video');
    return single && single.value.trim() ? [single.value.trim()] : [];
  }
  return [...box.querySelectorAll('input.sg-trailer-url')]
    .map(i => i.value.trim())
    .filter(Boolean);
}
function renderTrailersEditor(urls) {
  const box = document.getElementById('sg-trailers-list');
  if (!box) return;
  const list = (urls && urls.length) ? urls : [''];
  box.innerHTML = list.map((u, i) => `
    <div class="sg-trailer-row" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <input class="auth-input sg-trailer-url" type="url" placeholder="https://… mp4 / m3u8 / youtube / steam" value="${escapeHtml(u)}" style="flex:1" />
      <button type="button" class="hp-btn-edit sg-trailer-del" title="Удалить" ${list.length < 2 ? 'disabled' : ''}>×</button>
    </div>`).join('');
  box.querySelectorAll('.sg-trailer-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const rows = [...box.querySelectorAll('.sg-trailer-row')];
      if (rows.length <= 1) return;
      btn.closest('.sg-trailer-row')?.remove();
    });
  });
  // sync hidden
  const hid = document.getElementById('sg-video');
  if (hid) hid.value = serializeTrailerList(collectTrailerInputs());
  box.querySelectorAll('input.sg-trailer-url').forEach(inp => {
    inp.addEventListener('input', () => {
      if (hid) hid.value = serializeTrailerList(collectTrailerInputs());
    });
  });
}
function ensureTrailersEditorUi() {
  const host = document.getElementById('sg-trailers-wrap');
  if (!host) return;
  if (!document.getElementById('sg-trailers-list')) {
    host.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
        <span style="font-size:0.85rem;opacity:0.85">Трейлеры (несколько ссылок)</span>
        <button type="button" class="hp-btn-edit" id="sg-trailer-add" type="button">+ ссылка</button>
      </div>
      <div id="sg-trailers-list"></div>
      <input type="hidden" name="video_url" id="sg-video" value="" />
      <div class="settings-hint" style="margin-top:6px">mp4, webm, HLS (.m3u8), YouTube. Steam CDN часто отдаёт HLS — плеер подхватит через hls.js.</div>`;
    document.getElementById('sg-trailer-add')?.addEventListener('click', () => {
      const cur = collectTrailerInputs();
      cur.push('');
      renderTrailersEditor(cur);
    });
  }
}

function youtubeIdFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/i);
  return m ? m[1] : null;
}

let _hlsScriptPromise = null;
function loadHlsJs() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (_hlsScriptPromise) return _hlsScriptPromise;
  _hlsScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';
    s.onload = () => resolve(window.Hls);
    s.onerror = () => reject(new Error('hls.js load failed'));
    document.head.appendChild(s);
  });
  return _hlsScriptPromise;
}

function showTrailerFallback(box, src, thumb, wrap) {
  // без кнопки «Открыть видео» — пробуем следующий ролик в галерее
  const items = (wrap && wrap._galleryItems) || [];
  const curSrc = String(src || '');
  let nextIdx = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type !== 'video') continue;
    if (items[i].src === curSrc || (items[i].fallbacks || []).includes(curSrc)) {
      // ищем следующий video после текущего
      for (let j = i + 1; j < items.length; j++) {
        if (items[j].type === 'video') { nextIdx = j; break; }
      }
      break;
    }
  }
  if (nextIdx < 0) {
    // первый рабочий video отличный от src
    for (let i = 0; i < items.length; i++) {
      if (items[i].type === 'video' && items[i].src !== curSrc) { nextIdx = i; break; }
    }
  }
  if (nextIdx >= 0 && wrap) {
    const it = items[nextIdx];
    $$('.gp-gallery-thumb', wrap).forEach((t, ti) => t.classList.toggle('active', ti === nextIdx));
    setGalleryMain(wrap, 'video', it.src, it.thumb || '', it.fallbacks || []);
    return;
  }
  // последний шанс — постер без кнопки
  if (thumb) {
    box.innerHTML = `<img id="gallery-main-img" src="${escapeHtml(thumb)}" alt="Трейлер" />`;
  } else {
    box.innerHTML = `<div style="width:100%;height:100%;background:#000;display:flex;align-items:center;justify-content:center;color:#888">Трейлер недоступен</div>`;
  }
}
function setGalleryMain(wrap, type, src, thumb, fallbacks) {
  const box = $('#gallery-main', wrap) || $('.gp-gallery-main', wrap);
  if (!box) return;
  // остановить предыдущее видео / hls
  if (wrap._hls) {
    try { wrap._hls.destroy(); } catch (e) {}
    wrap._hls = null;
  }
  const oldVid = $('#gallery-main-video', wrap);
  if (oldVid) {
    try { oldVid.pause(); } catch (e) {}
  }
  if (type === 'video') {
    const yt = youtubeIdFromUrl(src);
    if (yt) {
      box.innerHTML = `<iframe id="gallery-main-video" src="https://www.youtube.com/embed/${escapeHtml(yt)}?autoplay=1&mute=1&rel=0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen style="width:100%;height:100%;border:0;border-radius:8px;background:#000"></iframe>`;
    } else {
      const queue = [String(src || '').replace(/^http:\/\//i, 'https://')]
        .concat((fallbacks || []).map(u => String(u).replace(/^http:\/\//i, 'https://')))
        .filter(Boolean);
      let idx = 0;
      const tryPlay = async () => {
        if (idx >= queue.length) {
          showTrailerFallback(box, src, thumb, wrap);
          return;
        }
        const safeSrc = queue[idx++];
        const isHls = /\.m3u8(\?|$)/i.test(safeSrc);
        const isDash = /\.mpd(\?|$)/i.test(safeSrc);
        if (isDash) {
          // DASH без dash.js пропускаем
          return tryPlay();
        }
        box.innerHTML = `<video id="gallery-main-video" controls playsinline preload="metadata" poster="${escapeHtml(thumb || '')}"></video>`;
        const v = $('#gallery-main-video', wrap);
        if (!v) return;
        v.muted = true;
        v.defaultMuted = true;
        v.setAttribute('muted', '');
        v.addEventListener('error', () => tryPlay(), { once: true });
        v.addEventListener('ended', () => {
          const items = wrap._galleryItems || [];
          const cur = items.findIndex(it => it.type === 'video' && (it.src === safeSrc || (it.fallbacks || []).includes(safeSrc)));
          // следующее видео в галерее
          for (let i = (cur >= 0 ? cur + 1 : 0); i < items.length; i++) {
            if (items[i].type === 'video') {
              setGalleryMain(wrap, 'video', items[i].src, items[i].thumb || '', items[i].fallbacks || []);
              // подсветить thumb
              $$('.gp-gallery-thumb', wrap).forEach((t, ti) => t.classList.toggle('active', ti === i));
              return;
            }
          }
        }, { once: true });

        if (isHls) {
          // Safari — native HLS
          if (v.canPlayType('application/vnd.apple.mpegurl')) {
            v.src = safeSrc;
            v.play().catch(() => {});
            return;
          }
          try {
            const Hls = await loadHlsJs();
            if (Hls && Hls.isSupported()) {
              const hls = new Hls({ enableWorker: true });
              wrap._hls = hls;
              hls.loadSource(safeSrc);
              hls.attachMedia(v);
              hls.on(Hls.Events.MANIFEST_PARSED, () => { v.play().catch(() => {}); });
              hls.on(Hls.Events.ERROR, (_, data) => {
                if (data && data.fatal) {
                  try { hls.destroy(); } catch (e) {}
                  wrap._hls = null;
                  // CORS/Steam CDN — пробуем следующий URL, иначе кнопка «открыть»
                  if (idx < queue.length) tryPlay();
                  else showTrailerFallback(box, safeSrc, thumb, wrap);
                }
              });
              return;
            }
          } catch (e) {
            return tryPlay();
          }
          return tryPlay();
        }

        v.src = safeSrc;
        v.play().catch(() => {});
      };
      tryPlay();
    }
  } else {
    box.innerHTML = `<img id="gallery-main-img" src="${escapeHtml(src)}" alt="" />`;
    const img = $('#gallery-main-img', wrap);
    if (img) {
      img.addEventListener('click', () => openLightbox(src));
    }
  }
}

function initGallery(wrap) {
  $$('.gp-thumb', wrap).forEach((btn, i) => {
    btn.addEventListener('click', () => {
      $$('.gp-thumb', wrap).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const item = (wrap._galleryItems && wrap._galleryItems[i]) || null;
      const fb = item && item.fallbacks ? item.fallbacks : [];
      setGalleryMain(wrap, btn.dataset.type || 'image', btn.dataset.src, btn.dataset.thumb || '', fb);
    });
  });
  const mainImg = $('#gallery-main-img', wrap);
  if (mainImg) {
    mainImg.addEventListener('click', () => {
      if (mainImg.src) openLightbox(mainImg.src);
    });
  }
  // сайдбар «скрины сообщества»
  $$('.gp-comm-shot', wrap).forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.src) openLightbox(btn.dataset.src);
    });
  });
}

// ---------- Лайтбокс ----------
let lightboxEl = null;
function ensureLightbox() {
  if (lightboxEl) return lightboxEl;
  lightboxEl = document.createElement('div');
  lightboxEl.className = 'lightbox hidden';
  lightboxEl.innerHTML = `
    <div class="lightbox-backdrop"></div>
    <img class="lightbox-img" src="" alt="" />
    <button type="button" class="lightbox-close" title="Закрыть">×</button>`;
  document.body.appendChild(lightboxEl);
  const close = () => lightboxEl && lightboxEl.classList.add('hidden');
  $('.lightbox-backdrop', lightboxEl).addEventListener('click', close);
  $('.lightbox-close', lightboxEl).addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  return lightboxEl;
}

function openLightbox(src) {
  if (!src) return;
  const lb = ensureLightbox();
  const img = $('.lightbox-img', lb);
  if (img) img.src = src;
  lb.classList.remove('hidden');
}

function initLightbox() {
  ensureLightbox();
}

// Patch showView to load admin list

// ============================================================
