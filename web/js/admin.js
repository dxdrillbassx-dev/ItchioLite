/* CATio — admin moderation + submit queue + user ban */

/* CATio — admin moderation, submit, steam import */

/* CATio — admin moderation, steam import, submit, user ban */
/* Depends: icons, utils */

// ============================================================
//  ЗАГРУЗКА ИГР + АДМИН-МОДЕРАЦИЯ
// ============================================================
const STEAM_API = ''; // diploma: no Steam web API
const STEAM_DISABLED = true;
const SUBMIT_API = 'api/submit.php';

const SYSREQ_LABELS = {
  os: 'ОС',
  cpu: 'Процессор',
  ram: 'Оперативная память',
  gpu: 'Видеокарта',
  directx: 'DirectX',
  storage: 'Место на диске',
  sound: 'Звуковая карта',
  other: 'Дополнительно',
};

const LANG_NAME_RU = {
  'english': 'английский',
  'russian': 'русский',
  'ukrainian': 'украинский',
  'belarusian': 'белорусский',
  'japanese': 'японский',
  'korean': 'корейский',
  'chinese': 'китайский',
  'simplified chinese': 'китайский (упр.)',
  'traditional chinese': 'китайский (трад.)',
  'schinese': 'китайский (упр.)',
  'tchinese': 'китайский (трад.)',
  'french': 'французский',
  'german': 'немецкий',
  'italian': 'итальянский',
  'spanish': 'испанский',
  'spanish - spain': 'испанский — Испания',
  'spanish - latin america': 'испанский — Латам',
  'latam': 'испанский — Латам',
  'portuguese': 'португальский',
  'portuguese - brazil': 'португальский — Бразилия',
  'portuguese-brazil': 'португальский — Бразилия',
  'brazilian': 'португальский — Бразилия',
  'polish': 'польский',
  'turkish': 'турецкий',
  'arabic': 'арабский',
  'thai': 'тайский',
  'vietnamese': 'вьетнамский',
  'indonesian': 'индонезийский',
  'dutch': 'нидерландский',
  'czech': 'чешский',
  'hungarian': 'венгерский',
  'romanian': 'румынский',
  'swedish': 'шведский',
  'norwegian': 'норвежский',
  'danish': 'датский',
  'finnish': 'финский',
  'greek': 'греческий',
  'bulgarian': 'болгарский',
  'hindi': 'хинди',
};
function localizeLangName(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  const key = n.toLowerCase().replace(/\s+/g, ' ');
  if (LANG_NAME_RU[key]) return LANG_NAME_RU[key];
  for (const [en, ru] of Object.entries(LANG_NAME_RU)) {
    if (key.includes(en)) return ru;
  }
  if (/[а-яё]/i.test(n)) return n;
  return n;
}

const GAME_LANGS = [
  'русский','английский','японский','китайский (упр.)','китайский (трад.)',
  'корейский','французский','итальянский','немецкий','испанский — Испания',
  'испанский — Латам','португальский','португальский — Бразилия','польский',
  'турецкий','украинский','вьетнамский','арабский','тайский','индонезийский',
];

function collectSysReq(containerId) {
  const box = $(containerId);
  if (!box) return {};
  const out = {};
  $$('input[data-k]', box).forEach(inp => {
    const v = inp.value.trim();
    if (v) out[inp.dataset.k] = v;
  });
  return out;
}
function fillSysReq(containerId, data) {
  const box = $(containerId);
  if (!box) return;
  let obj = data;
  if (typeof data === 'string') {
    try { obj = JSON.parse(data); } catch (e) { obj = {}; }
  }
  obj = obj || {};
  $$('input[data-k]', box).forEach(inp => {
    inp.value = obj[inp.dataset.k] || '';
  });
}

const PUB_PRICE_MIN = 0;
const PUB_PRICE_MAX = 15000;

function ensurePubModalAlive() {
  const formModal = document.getElementById('submit-form-modal');
  if (!formModal) return;
  formModal.classList.remove('hidden', 'is-closing');
  formModal.style.opacity = '1';
  formModal.style.visibility = 'visible';
  formModal.style.pointerEvents = 'auto';
  formModal.style.display = 'flex';
  const box = formModal.querySelector('.sgdb-modal-card, .submit-modal-box');
  if (box) {
    box.style.opacity = '1';
    box.style.visibility = 'visible';
    box.style.transform = 'none';
  }
}

/**
 * В WebView2/Electron file input внутри модалки «убивает» слой.
 * Открываем нативный диалог через временный input в body.
 */
function openPubFilePicker(sourceInput, { multiple = false, accept = 'image/*' } = {}) {
  if (!sourceInput) return;
  window.__pubFileDialogOpen = true;
  window.__pubFileDialogTs = Date.now();

  const tmp = document.createElement('input');
  tmp.type = 'file';
  tmp.accept = accept || sourceInput.accept || 'image/*';
  if (multiple || sourceInput.multiple) tmp.multiple = true;
  tmp.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;width:1px;height:1px;';
  document.body.appendChild(tmp);

  const cleanup = () => {
    setTimeout(() => {
      try { tmp.remove(); } catch (e) {}
      window.__pubFileDialogOpen = false;
      window.__pubFileDialogTs = Date.now();
      ensurePubModalAlive();
    }, 300);
  };

  tmp.addEventListener('change', () => {
    try {
      // переносим FileList в исходный input через DataTransfer
      const dt = new DataTransfer();
      [...(tmp.files || [])].forEach(f => dt.items.add(f));
      try { sourceInput.files = dt.files; } catch (e1) { console.warn('assign files', e1); }
      // запасной путь — храним File в dataset/window (WebView иногда глотает .files)
      if (sourceInput.id === 'sg-build-file' && tmp.files && tmp.files[0]) {
        window.__selectedBuildFile = tmp.files[0];
        const nameEl = document.getElementById('sg-build-file-name');
        if (nameEl) {
          const f = tmp.files[0];
          nameEl.textContent = f.name + ' · ' + (typeof formatBytes === 'function' ? formatBytes(f.size) : (Math.round(f.size/1048576*10)/10 + ' МБ'));
          nameEl.style.display = 'inline';
          nameEl.style.opacity = '1';
          nameEl.style.visibility = 'visible';
          nameEl.style.color = 'var(--text-bright)';
        }
        try { if (typeof updatePublishSectionStatus === 'function') updatePublishSectionStatus(); } catch (e2) {}
      }
      sourceInput.dispatchEvent(new Event('change', { bubbles: true }));
      sourceInput.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) {
      console.warn('pub file transfer failed', e);
    }
    ensurePubModalAlive();
    cleanup();
  });
  // cancel (не во всех браузерах)
  tmp.addEventListener('cancel', () => {
    ensurePubModalAlive();
    cleanup();
  });
  // фокус/видимость после диалога
  const onVis = () => {
    if (document.visibilityState === 'visible') {
      ensurePubModalAlive();
      document.removeEventListener('visibilitychange', onVis);
    }
  };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('focus', () => ensurePubModalAlive(), { once: true });

  try {
    tmp.click();
  } catch (e) {
    cleanup();
  }
}


function setPubPreviewImg(previewId, url) {
  const prev = document.getElementById(previewId);
  if (!prev) return;
  if (!url) {
    prev.style.backgroundImage = '';
    prev.classList.remove('has-img');
    const ph = previewId.includes('cover') ? 'Обложка' : previewId.includes('banner') ? 'Баннер' : previewId.includes('logo') ? 'Логотип' : 'Иконка';
    prev.innerHTML = '<span>' + ph + '</span>';
    return;
  }
  prev.style.backgroundImage = '';
  prev.classList.add('has-img');
  prev.innerHTML = '';
  const img = document.createElement('img');
  img.src = url;
  img.alt = '';
  img.draggable = false;
  prev.appendChild(img);
}

function initPublishFilePreviews(root = document) {
  const bindOne = (inputId, previewId, nameId) => {
    const input = root.querySelector('#' + inputId) || document.getElementById(inputId);
    if (!input || input.dataset.previewBound) return;
    input.dataset.previewBound = '1';

    // кнопки/label открывают picker снаружи модалки
    const open = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPubFilePicker(input, { multiple: false, accept: input.accept || 'image/*' });
    };
    input.addEventListener('click', open);
    const id = input.id;
    if (id) {
      document.querySelectorAll('label[for="' + id + '"]').forEach(lab => {
        lab.addEventListener('click', open);
      });
    }
    // клик по превью тоже
    const prevEl = document.getElementById(previewId);
    if (prevEl) prevEl.addEventListener('click', open);

    input.addEventListener('change', () => {
      ensurePubModalAlive();
      const file = input.files && input.files[0];
      const prev = document.getElementById(previewId);
      const nameEl = document.getElementById(nameId);
      if (!file) {
        if (prev) {
          prev.style.backgroundImage = '';
          prev.classList.remove('has-img');
          const ph = prev.dataset.placeholder || (previewId.includes('cover') ? 'Обложка' : previewId.includes('banner') ? 'Баннер' : previewId.includes('logo') ? 'Логотип' : 'Иконка');
          prev.innerHTML = '<span>' + ph + '</span>';
        }
        if (nameEl) nameEl.textContent = nameEl.dataset.placeholder || nameEl.textContent;
        return;
      }
      if (nameEl) nameEl.textContent = file.name + (file.size ? ' · ' + formatBytes(file.size) : '');
      if (prev && file.type && file.type.startsWith('image/')) {
        try {
          if (prev._objUrl) { try { URL.revokeObjectURL(prev._objUrl); } catch (e) {} }
          const url = URL.createObjectURL(file);
          prev._objUrl = url;
          prev.style.backgroundImage = '';
          prev.classList.add('has-img');
          prev.innerHTML = '';
          const img = document.createElement('img');
          img.src = url;
          img.alt = '';
          img.draggable = false;
          prev.appendChild(img);
        } catch (e) {}
      }
    });
  };
  bindOne('sg-cover', 'sg-cover-preview', 'sg-cover-name');
  bindOne('sg-banner', 'sg-banner-preview', 'sg-banner-name');
  bindOne('sg-logo', 'sg-logo-preview', 'sg-logo-name');
  bindOne('sg-icon', 'sg-icon-preview', 'sg-icon-name');

  const shots = document.getElementById('sg-shots');
  if (shots && !shots.dataset.previewBound) {
    shots.dataset.previewBound = '1';
    const openShots = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPubFilePicker(shots, { multiple: true, accept: 'image/*' });
    };
    shots.addEventListener('click', openShots);
    document.querySelectorAll('label[for="sg-shots"]').forEach(lab => {
      lab.addEventListener('click', openShots);
    });
    shots.addEventListener('change', () => {
      ensurePubModalAlive();
      const box = document.getElementById('sg-shots-preview');
      if (!box) return;
      box.innerHTML = '';
      [...(shots.files || [])].slice(0, 8).forEach(f => {
        if (!f.type || !f.type.startsWith('image/')) return;
        const d = document.createElement('div');
        d.className = 'pub-shot-thumb';
        try { d.style.backgroundImage = "url('" + URL.createObjectURL(f) + "')"; } catch (e) {}
        box.appendChild(d);
      });
    });
  }
}

function initPublishPriceInput() {
  const price = document.getElementById('sg-price');
  if (!price || price.dataset.priceBound) return;
  price.dataset.priceBound = '1';
  const sanitize = () => {
    let v = String(price.value || '').replace(/[^\d]/g, '');
    if (v.length > 1) v = v.replace(/^0+/, '') || '0';
    let n = parseInt(v || '0', 10);
    if (Number.isNaN(n)) n = 0;
    if (n > PUB_PRICE_MAX) n = PUB_PRICE_MAX;
    if (n < PUB_PRICE_MIN) n = PUB_PRICE_MIN;
    price.value = String(n);
  };
  price.addEventListener('input', () => {
    price.value = String(price.value || '').replace(/[^\d]/g, '');
  });
  price.addEventListener('blur', sanitize);
  price.addEventListener('change', sanitize);
}

function syncPublishGenres() {
  const genres = $$('.sg-genre').filter(c => c.checked).map(c => c.value);
  const hidden = $('#sg-genre');
  if (hidden) hidden.value = genres.join(', ');
  return genres;
}

function syncPublishDescription() {
  const ed = $('#sg-desc-editor');
  const ta = $('#sg-desc');
  if (!ed || !ta) return '';
  const html = (ed.innerHTML || '').trim();
  ta.value = html;
  return html;
}

function plainTextFromHtml(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  return (d.textContent || d.innerText || '').trim();
}

function initPublishRte() {
  const root = $('#sg-rte');
  const ed = $('#sg-desc-editor');
  if (!root || !ed || root.dataset.bound === '1') return;
  root.dataset.bound = '1';

  const run = (cmd, val) => {
    ed.focus();
    try {
      if (cmd === 'createLink') {
        const url = prompt('URL ссылки:', 'https://');
        if (!url) return;
        document.execCommand('createLink', false, url);
      } else if (cmd === 'formatBlock') {
        document.execCommand('formatBlock', false, val || 'p');
      } else if (cmd === 'insertShot') {
        const shots = $('#sg-shots')?.files;
        if (!shots || !shots.length) {
          toast('Сначала выберите скриншоты в блоке «Медиа»');
          return;
        }
        const file = shots[0];
        const reader = new FileReader();
        reader.onload = () => {
          ed.focus();
          document.execCommand('insertImage', false, reader.result);
          syncPublishDescription();
        };
        reader.readAsDataURL(file);
      } else {
        document.execCommand(cmd, false, val || null);
      }
    } catch (e) {}
    syncPublishDescription();
  };

  $$('.pub-rte-btn', root).forEach(btn => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      run(btn.dataset.cmd, btn.dataset.val || null);
    });
  });
  ed.addEventListener('input', syncPublishDescription);
  ed.addEventListener('blur', syncPublishDescription);
  ed.addEventListener('paste', () => setTimeout(syncPublishDescription, 0));
}

function validatePublishForm() {
  syncPublishGenres();
  syncPublishDescription();
  const title = ($('#sg-title')?.value || '').trim();
  if (title.length < 2) return 'Укажите название игры (минимум 2 символа)';
  const genre = ($('#sg-genre')?.value || '').trim();
  if (!genre) return 'Выберите хотя бы один жанр';
  const descHtml = ($('#sg-desc')?.value || '').trim();
  const descText = plainTextFromHtml(descHtml);
  if (descText.length < 20) return 'Описание слишком короткое (минимум 20 символов)';
  let price = parseInt(String($('#sg-price')?.value || '0').replace(/[^\d]/g, ''), 10);
  if (Number.isNaN(price)) price = 0;
  if (price < PUB_PRICE_MIN) return 'Цена не может быть меньше ' + PUB_PRICE_MIN + ' ₽';
  if (price > PUB_PRICE_MAX) return 'Цена не может быть больше ' + PUB_PRICE_MAX + ' ₽';
  const cover = $('#sg-cover')?.files?.[0];
  const coverUrl = $('#sg-cover-url')?.value;
  if (!cover && !coverUrl) return 'Добавьте обложку';
  // Издательство обязательно для не-админов
  const isAdmin = !!(window.AUTH_STATE && window.AUTH_STATE.user && (
    window.AUTH_STATE.user.role === 'admin' || window.AUTH_STATE.user.is_admin
  ));
  const pubId = ($('#sg-publisher-id')?.value || '').trim();
  if (!isAdmin && !pubId) {
    return 'Выберите издательство (публикация без издательства доступна только админам)';
  }
  return null;
}

function renderLangTable(containerId, selected) {
  const box = $(containerId);
  if (!box) return;
  let sel = selected;
  if (typeof selected === 'string') {
    try { sel = JSON.parse(selected); } catch (e) { sel = []; }
  }
  if (!Array.isArray(sel)) sel = [];
  const map = {};
  sel.forEach(r => {
    const n = r && (r.name || r.lang || r.language);
    if (n) map[n] = r;
  });
  box.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'lang-table-head';
  head.innerHTML = '<span>Язык</span><span>Субтитры</span><span>Аудио</span>';
  box.appendChild(head);
  const body = document.createElement('div');
  body.className = 'lang-table-body';
  (GAME_LANGS || []).forEach(name => {
    const r = map[name] || {};
    const row = document.createElement('div');
    row.className = 'lang-table-row';
    row.innerHTML = `
      <span class="lang-table-name">${escapeHtml(name)}</span>
      <label class="lang-table-cell"><input type="checkbox" data-lang="${escapeHtml(name)}" data-kind="sub" ${r.subtitles ? 'checked' : ''} /></label>
      <label class="lang-table-cell"><input type="checkbox" data-lang="${escapeHtml(name)}" data-kind="audio" ${r.audio ? 'checked' : ''} /></label>`;
    body.appendChild(row);
  });
  box.appendChild(body);
}
function collectLanguages(containerId) {
  const box = $(containerId);
  if (!box) return [];
  const map = {};
  $$('input[data-lang]', box).forEach(inp => {
    const name = inp.dataset.lang;
    if (!map[name]) map[name] = { name, subtitles: false, audio: false };
    if (inp.dataset.kind === 'sub') map[name].subtitles = inp.checked;
    if (inp.dataset.kind === 'audio') map[name].audio = inp.checked;
  });
  return Object.values(map).filter(r => r.subtitles || r.audio);
}
function parseSysReq(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw) || {}; } catch (e) {
    // legacy plain text → other
    return raw.trim() ? { other: String(raw) } : {};
  }
}
function parseLangs(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(normalizeLangRow).filter(r => r && r.name);
  }
  let s = String(raw).trim();
  // двойное экранирование / HTML-entities
  if (s.includes('&quot;') || s.includes('&#')) {
    const ta = document.createElement('textarea');
    ta.innerHTML = s;
    s = ta.value;
  }
  // попытка JSON
  const tryParse = (str) => {
    try {
      const j = JSON.parse(str);
      if (Array.isArray(j)) return j.map(normalizeLangRow).filter(r => r && r.name);
      if (j && typeof j === 'object' && j.name) return [normalizeLangRow(j)];
    } catch (e) {}
    return null;
  };
  let parsed = tryParse(s);
  if (parsed) return parsed;
  // обрезанный JSON (VARCHAR 255) — вытащим целые объекты {"name":"..."}
  const objs = [];
  const re = /\{\s*"name"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"subtitles"\s*:\s*(true|false)\s*,\s*"audio"\s*:\s*(true|false)\s*\}/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    objs.push({ name: m[1].replace(/\\"/g, '"'), subtitles: m[2] === 'true', audio: m[3] === 'true' });
  }
  if (objs.length) return objs;
  // legacy: "English, French*, German"
  return s.split(/[,;]+/).map(part => {
    const full = part.includes('*');
    const name = part.replace(/\*/g, '').trim();
    if (!name || name.length > 80 || name.startsWith('{') || name.startsWith('"')) return null;
    return { name, subtitles: true, audio: full };
  }).filter(Boolean);
}
function normalizeLangRow(r) {
  if (!r) return null;
  if (typeof r === 'string') return { name: localizeLangName(r), subtitles: true, audio: false };
  const name = localizeLangName(String(r.name || r.lang || r.language || '').trim());
  if (!name) return null;
  return {
    name,
    subtitles: !!(r.subtitles ?? r.subs ?? true),
    audio: !!(r.audio ?? r.full_audio ?? false),
  };
}

/** Описание игры: если есть HTML (img/video/iframe) — санитизируем; иначе — абзацы из текста */
function formatGameDescription(raw) {
  let text = String(raw || '').trim() || 'Описание отсутствует.';
  // markdown leftover **bold** → strong
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  if (!/<[a-z][\s\S]*>/i.test(text)) {
    return text.split(/\n+/).map(p => `<p>${escapeHtml(p)}</p>`).join('');
  }

  const allowed = new Set(['P','BR','IMG','VIDEO','SOURCE','IFRAME','A','B','STRONG','I','EM','U','UL','OL','LI','H1','H2','H3','H4','H5','SPAN','DIV','TABLE','THEAD','TBODY','TR','TH','TD','HR']);
  const tmp = document.createElement('div');
  tmp.innerHTML = text;

  const walk = (node) => {
    [...node.childNodes].forEach(ch => {
      if (ch.nodeType === 1) {
        if (!allowed.has(ch.tagName)) {
          while (ch.firstChild) node.insertBefore(ch.firstChild, ch);
          node.removeChild(ch);
          return;
        }
        [...ch.attributes].forEach(attr => {
          const n = attr.name.toLowerCase();
          const v = (attr.value || '').trim();
          // strip events, styles, dangerous URLs
          if (n.startsWith('on') || n === 'style' || n === 'srcdoc' || n === 'class' || n === 'formaction' || n === 'xlink:href') {
            ch.removeAttribute(attr.name);
            return;
          }
          if ((n === 'href' || n === 'src' || n === 'poster') && /^\s*(javascript:|data:|vbscript:)/i.test(v)) {
            ch.removeAttribute(attr.name);
          }
        });
        if (ch.tagName === 'A') {
          const href = ch.getAttribute('href') || '';
          if (!/^https?:\/\//i.test(href)) ch.removeAttribute('href');
          else {
            ch.setAttribute('target', '_blank');
            ch.setAttribute('rel', 'noopener noreferrer');
          }
        }
        if (ch.tagName === 'IMG') {
          const src = ch.getAttribute('src') || '';
          if (!/^https?:\/\//i.test(src)) { node.removeChild(ch); return; }
          ch.setAttribute('loading', 'lazy');
          ch.setAttribute('referrerpolicy', 'no-referrer');
          ch.removeAttribute('width');
          ch.removeAttribute('height');
        }
        if (ch.tagName === 'IFRAME') {
          const src = ch.getAttribute('src') || '';
          if (!/^https?:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|player\.vimeo\.com)\//i.test(src)) {
            node.removeChild(ch); return;
          }
          ch.setAttribute('loading', 'lazy');
          ch.setAttribute('allowfullscreen', '');
          ch.setAttribute('referrerpolicy', 'no-referrer');
        }
        if (ch.tagName === 'VIDEO') {
          ch.removeAttribute('controls');
          ch.setAttribute('autoplay', '');
          ch.setAttribute('muted', '');
          ch.setAttribute('loop', '');
          ch.setAttribute('playsinline', '');
          ch.setAttribute('preload', 'auto');
          ch.muted = true;
        }
        walk(ch);
      }
    });
  };
  walk(tmp);

  // группируем подряд идущие IMG в ряды (Steam: 2 в ряд / 1 на всю ширину)
  const groupImages = (parent) => {
    const kids = [...parent.childNodes];
    let buf = [];
    const flush = () => {
      if (!buf.length) return;
      const wrap = document.createElement('div');
      if (buf.length === 1) wrap.className = 'gp-desc-img-row gp-desc-img-row--1';
      else if (buf.length >= 3) wrap.className = 'gp-desc-img-row gp-desc-img-row--3';
      else wrap.className = 'gp-desc-img-row';
      parent.insertBefore(wrap, buf[0]);
      buf.forEach(img => wrap.appendChild(img));
      buf = [];
    };
    kids.forEach(ch => {
      if (ch.nodeType === 1 && ch.tagName === 'IMG') {
        buf.push(ch);
      } else if (ch.nodeType === 1 && ch.tagName === 'BR' && buf.length) {
        try { parent.removeChild(ch); } catch (e) {}
      } else {
        flush();
        if (ch.nodeType === 1) groupImages(ch);
      }
    });
    flush();
  };
  groupImages(tmp);

  tmp.querySelectorAll('video').forEach(v => {
    v.classList.add('gp-desc-video');
    v.muted = true;
  });
  tmp.querySelectorAll('iframe').forEach(f => {
    let src = f.getAttribute('src') || '';
    if (/youtube\.com|youtube-nocookie\.com/i.test(src)) {
      try {
        const u = new URL(src, 'https://www.youtube.com');
        u.searchParams.set('autoplay', '1');
        u.searchParams.set('mute', '1');
        u.searchParams.set('controls', '0');
        u.searchParams.set('modestbranding', '1');
        u.searchParams.set('rel', '0');
        u.searchParams.set('playsinline', '1');
        const id = u.pathname.split('/').pop();
        if (id) { u.searchParams.set('loop', '1'); u.searchParams.set('playlist', id); }
        f.setAttribute('src', u.toString());
        f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
      } catch (e) {}
    }
  });

  return tmp.innerHTML || `<p>${escapeHtml(text)}</p>`;
}

function renderSysReqBlock(minRaw, recRaw) {
  const min = parseSysReq(minRaw);
  const rec = parseSysReq(recRaw);
  if (!Object.keys(min).length && !Object.keys(rec).length) return '';
  const listHtml = (obj, title) => {
    const items = Object.keys(SYSREQ_LABELS).filter(k => obj[k]).map(k =>
      `<li><b>${SYSREQ_LABELS[k]}:</b> ${escapeHtml(obj[k])}</li>`
    ).join('');
    if (!items) return `<p class="gp-ach-empty">Нет данных</p>`;
    return `<ul class="sysreq-list">${items}</ul>`;
  };
  return `
    <div class="gp-side-card" id="game-sysreq">
      <button type="button" class="gp-side-head">Системные требования <span class="hp-side-arrow" aria-hidden="true">${icon('chevron-down', 16)}</span></button>
      <div class="gp-side-body">
        <div class="sysreq-tabs">
          <button type="button" class="sysreq-tab active" data-tab="min">Минимальные</button>
          <button type="button" class="sysreq-tab" data-tab="rec">Рекомендованные</button>
        </div>
        <div class="sysreq-pane" data-pane="min">${listHtml(min, 'Минимальные:')}</div>
        <div class="sysreq-pane hidden" data-pane="rec">${listHtml(rec, 'Рекомендованные:')}</div>
      </div>
    </div>`;
}
function renderLangBlock(raw) {
  const langs = parseLangs(raw);
  if (!langs.length) return '';
  const rows = langs.map(r => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td class="${r.subtitles ? 'ok' : 'no'}">${r.subtitles ? icon('check-bold', 16, 'lang-ico lang-ico--ok') : icon('x', 16, 'lang-ico lang-ico--no')}</td>
      <td class="${r.audio ? 'ok' : 'no'}">${r.audio ? icon('check-bold', 16, 'lang-ico lang-ico--ok') : icon('x', 16, 'lang-ico lang-ico--no')}</td>
    </tr>`).join('');
  return `
    <div class="gp-side-card" id="game-langs">
      <button type="button" class="gp-side-head">Язык <span class="hp-side-arrow" aria-hidden="true">${icon('chevron-down', 16)}</span></button>
      <div class="gp-side-body">
        <table class="lang-display">
          <thead><tr><th>Язык</th><th>Субтитры</th><th>Аудио</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}
function initGameCollapsibles(wrap) {
  $$('.game-collapsible-head', wrap).forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.game-collapsible')?.classList.toggle('collapsed'));
  });
  $$('.sysreq-tab', wrap).forEach(tab => {
    tab.addEventListener('click', () => {
      const body = tab.closest('.gp-side-body') || tab.closest('.game-collapsible-body');
      if (!body) return;
      $$('.sysreq-tab', body).forEach(t => t.classList.toggle('active', t === tab));
      $$('.sysreq-pane', body).forEach(p => p.classList.toggle('hidden', p.dataset.pane !== tab.dataset.tab));
    });
  });
}


let adminDeleteMedia = [];


const GAME_PACK_API = 'api/game_pack.php';

async function importGamePackFile(file) {
  if (!file) return;
  const fd = new FormData();
  fd.append('pack', file);
  fd.append('action', 'import_pack');
  const res = await fetch(GAME_PACK_API + '?action=import_pack', {
    method: 'POST',
    body: fd,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Не удалось импортировать пакет');
  return data;
}

function applyGamePackToSubmitForm(data) {
  const game = data.game || {};
  const files = data.files || {};
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (!el || v == null || v === '') return;
    el.value = v;
  };
  const setPreview = (previewId, url, nameId, label) => {
    if (!url) return;
    if (typeof setPubPreviewImg === 'function') setPubPreviewImg(previewId, url);
    if (nameId) {
      const n = document.getElementById(nameId);
      if (n) n.textContent = label || url.split('/').pop() || 'из пакета';
    }
  };

  set('sg-title', game.title || '');
  set('sg-developer', game.developer || '');
  set('sg-short', game.short_description || '');
  set('sg-tags', game.tags || '');
  set('sg-price', game.price != null ? String(game.price) : '');
  set('sg-release', game.release_date || '');
  set('sg-video', game.video_url || '');

  // описание: contenteditable #sg-desc-editor + textarea #sg-desc
  const desc = game.description || '';
  if (desc) {
    const ed = document.getElementById('sg-desc-editor');
    const ta = document.getElementById('sg-desc');
    if (ed) {
      ed.innerHTML = desc;
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (ta) ta.value = desc;
    try { if (typeof syncPublishDescription === 'function') syncPublishDescription(); } catch (e) {}
  }

  // жанры
  const genreStr = String(game.genre || '');
  const parts = genreStr.split(/[,;/|]+/).map(s => s.trim()).filter(Boolean);
  document.querySelectorAll('.sg-genre').forEach(cb => {
    cb.checked = parts.some(p => p.toLowerCase() === String(cb.value).toLowerCase());
  });
  try { if (typeof syncPublishGenres === 'function') syncPublishGenres(); } catch (e) {}

  // платформы
  let plats = game.platforms;
  if (typeof plats === 'string') {
    try { plats = JSON.parse(plats); } catch (e) { plats = String(plats).split(/[,;]+/); }
  }
  if (Array.isArray(plats)) {
    const setP = new Set(plats.map(p => String(p).toLowerCase().trim()));
    document.querySelectorAll('.sg-platform').forEach(cb => {
      const v = String(cb.value).toLowerCase();
      cb.checked = setP.has(v) || [...setP].some(x => x.includes(v) || v.includes(x));
    });
  }

  // управление
  let ctrls = game.controllers;
  if (typeof ctrls === 'string') {
    ctrls = ctrls.split(/[,;|]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  }
  if (Array.isArray(ctrls) && ctrls.length) {
    const expanded = new Set();
    ctrls.forEach(c => {
      const x = String(c).toLowerCase();
      if (x === 'full' || x === 'partial' || x === 'supported' || x === 'controller' || x === 'gamepad') {
        expanded.add('xbox'); expanded.add('playstation'); expanded.add('keyboard');
      } else expanded.add(x);
    });
    document.querySelectorAll('.sg-ctrl').forEach(cb => {
      const v = String(cb.value).toLowerCase();
      cb.checked = expanded.has(v) || [...expanded].some(c => c.includes(v) || v.includes(c));
    });
  }

  // системные требования (объект или notes/HTML)
  const normSys = (raw) => {
    if (raw == null || raw === '') return null;
    let obj = raw;
    if (typeof raw === 'string') {
      try { obj = JSON.parse(raw); } catch (e) { return { other: raw }; }
    }
    if (obj && typeof obj === 'object') {
      if (obj.os || obj.processor || obj.memory || obj.gpu || obj.storage) return obj;
      if (obj.notes) return { other: String(obj.notes) };
    }
    return obj;
  };
  try {
    const mn = normSys(game.sys_req_min);
    const rc = normSys(game.sys_req_rec);
    if (mn) fillSysReq('#sg-sys-min-fields', mn);
    if (rc) fillSysReq('#sg-sys-rec-fields', rc);
  } catch (e) { console.warn('sysreq', e); }

  // языки: ["English"] или [{name,subtitles,audio}]
  try {
    let langs = game.languages;
    if (typeof langs === 'string') {
      try { langs = JSON.parse(langs); } catch (e) { langs = langs.split(/[,;]+/).map(s => s.trim()).filter(Boolean); }
    }
    if (Array.isArray(langs) && langs.length) {
      if (typeof langs[0] === 'string') {
        langs = langs.map(name => ({ name, subtitles: true, audio: true }));
      }
      renderLangTable('#sg-lang-table', langs);
    }
  } catch (e) { console.warn('lang', e); }

  // медиа
  if (files.cover) {
    set('sg-cover-url', files.cover);
    setPreview('sg-cover-preview', files.cover, 'sg-cover-name', 'обложка из пакета');
  }
  if (files.banner) {
    set('sg-banner-url', files.banner);
    setPreview('sg-banner-preview', files.banner, 'sg-banner-name', 'баннер из пакета');
  }
  if (files.logo) {
    set('sg-logo-url', files.logo);
    setPreview('sg-logo-preview', files.logo, 'sg-logo-name', 'логотип из пакета');
  }
  if (files.icon) {
    set('sg-icon-url', files.icon);
    setPreview('sg-icon-preview', files.icon, 'sg-icon-name', 'иконка из пакета');
  } else {
    // нет своей иконки — берём первую из SGDB в пакете
    try {
      const sg = (files && files.sgdb) || (data.manifest && data.manifest.files && data.manifest.files.sgdb) || {};
      const icons = sg.icons || [];
      let firstIcon = '';
      if (Array.isArray(icons) && icons.length) {
        const it = icons[0];
        firstIcon = typeof it === 'string' ? it : (it && (it.url || it.path || it.file || '')) || '';
      }
      if (firstIcon) {
        set('sg-icon-url', firstIcon);
        setPreview('sg-icon-preview', firstIcon, 'sg-icon-name', 'иконка SGDB');
      }
    } catch (e) { console.warn('sgdb icon fallback', e); }
  }

  // скриншоты
  window.__importedGamePack = data;
  let shotUrls = [];
  if (files.screenshots && files.screenshots.length) shotUrls = files.screenshots.slice();
  else if (data.manifest && Array.isArray(data.manifest.screenshots)) shotUrls = data.manifest.screenshots.slice();
  // только реальные URL/пути
  shotUrls = shotUrls.filter(u => !!u && String(u).length > 3);
  if (shotUrls.length) {
    let box = document.getElementById('sg-screenshots-urls');
    if (!box) {
      box = document.createElement('input');
      box.type = 'hidden';
      box.id = 'sg-screenshots-urls';
      box.name = 'screenshot_urls';
      (document.getElementById('submit-game-form') || document.body).appendChild(box);
    }
    // нормализуем пути (без ведущего /)
    shotUrls = shotUrls.map(u => String(u).replace(/^\//, ''));
    box.value = shotUrls.join('\n');
    const prevBox = document.getElementById('sg-shots-preview');
    if (prevBox) {
      prevBox.style.display = 'flex';
      prevBox.style.flexWrap = 'wrap';
      prevBox.style.gap = '6px';
      prevBox.innerHTML = shotUrls.slice(0, 12).map(u => {
        const src = (u.startsWith('http') || u.startsWith('uploads/') || u.startsWith('/')) ? u : u;
        return '<div class="pub-shot-item" title="' + escapeHtml(src) + '" style="background-image:url(\'' + String(src).replace(/'/g, '%27') + '\');background-size:cover;background-position:center;width:72px;height:48px;border-radius:6px;display:inline-block;border:1px solid rgba(255,255,255,0.12)"></div>';
      }).join('');
    }
    console.log('[import] screenshots', shotUrls.length, shotUrls);
  } else {
    console.warn('[import] no screenshots in pack', data.files, data.manifest && data.manifest.files);
  }

  // трейлеры: video_url или первый movie
  const movies = data.movies || (data.manifest && data.manifest.movies) || [];
  let videoSet = game.video_url || '';
  if (!videoSet && movies.length) {
    const first = movies[0];
    videoSet = first.url || first.source_url || first.mp4 || first.file || '';
  }
  try { ensureTrailersEditorUi(); } catch (e) {}
  const allTrailers = [];
  if (videoSet) allTrailers.push(videoSet);
  movies.forEach(m => {
    const u = m.url || m.source_url || m.mp4 || m.file || '';
    if (u && !allTrailers.includes(u)) allTrailers.push(u);
  });
  renderTrailersEditor(allTrailers.length ? allTrailers : ['']);
  if (allTrailers.length) set('sg-video', serializeTrailerList(allTrailers));
  // локальные mp4 трейлеры — сохраняем список для submit
  const localTrailers = (files.trailers || []).concat(
    movies.map(m => m.file || m.url).filter(u => u && String(u).startsWith('uploads/'))
  );
  if (localTrailers.length) {
    let hid = document.getElementById('sg-trailer-urls');
    if (!hid) {
      hid = document.createElement('input');
      hid.type = 'hidden';
      hid.id = 'sg-trailer-urls';
      hid.name = 'trailer_urls';
      const form = document.getElementById('submit-game-form') || document.getElementById('submit-form-modal');
      if (form) form.appendChild(hid);
    }
    hid.value = [...new Set(localTrailers)].join('\n');
  }

  // CATioGridDB ассеты из ZIP — в кэш для модалки оформления
  try {
    const sg = (files && files.sgdb) || (data.manifest && data.manifest.files && data.manifest.files.sgdb) || {};
    const packSgdb = { icons: [], logos: [], heroes: [], grids: [] };
    const mapKey = { icons: 'icons', logos: 'logos', heroes: 'heroes', covers: 'grids', grids: 'grids' };
    Object.keys(sg || {}).forEach(k => {
      const dst = mapKey[k] || k;
      const arr = sg[k] || [];
      if (!Array.isArray(arr)) return;
      arr.forEach(item => {
        const url = (item && (item.url || item.thumb || item.file)) || (typeof item === 'string' ? item : '');
        if (!url) return;
        packSgdb[dst] = packSgdb[dst] || [];
        packSgdb[dst].push({ url, thumb: (item && item.thumb) || url, width: item && item.width, height: item && item.height });
      });
    });
    window.__packSgdbAssets = packSgdb;
    window.__packSgdbTitle = game.title || '';
    console.log('[import] sgdb from pack', Object.keys(packSgdb).map(k => k + ':' + (packSgdb[k]||[]).length));
  } catch (e) { console.warn(e); }

  const nShots = shotUrls ? shotUrls.length : 0;
  const nLang = Array.isArray(game.languages) ? game.languages.length : 0;
  const nTr = (typeof collectTrailerInputs === 'function' ? collectTrailerInputs() : []).length;
  toast('Импорт: скринов ' + nShots + ', трейлеров ' + nTr + ', языков ' + nLang);
}



function ensureImportPackInput() {
  let input = document.getElementById('sg-import-pack');
  if (input) return input;
  input = document.createElement('input');
  input.type = 'file';
  input.id = 'sg-import-pack';
  input.accept = '.zip,application/zip';
  input.hidden = true;
  document.body.appendChild(input);
  return input;
}

async function handleImportPackFile(file, btn) {
  if (!file) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Импорт…'; }
  try {
    toast('Импорт пакета…');
    const data = await importGamePackFile(file);
    applyGamePackToSubmitForm(data);
  } catch (err) {
    console.error(err);
    toast(err.message || 'Ошибка импорта');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Импорт'; }
  }
}

function bindSubmitPackImport() {
  if (window.__importPackDelegated) return;
  window.__importPackDelegated = true;

  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('#sg-import-pack-btn');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const input = ensureImportPackInput();
    // защита от ghost-click на backdrop модалки
    window.__pubFileDialogOpen = true;
    window.__pubFileDialogTs = Date.now();
    setTimeout(() => { window.__pubFileDialogOpen = false; }, 1200);
    input.onchange = async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      await handleImportPackFile(file, btn);
    };
    input.click();
  }, true);
}

//  АДМИН: редактирование чужого профиля + бан
// ============================================================
function openAdminUserModal(p) {
  const modal = $('#admin-user-modal');
  if (!modal) { toast('Модалка админа не найдена'); return; }
  modal.classList.remove('hidden');
  $('#admin-user-id').value = p.id;
  $('#admin-user-name').value = p.username || '';
  $('#admin-user-role').value = p.role || 'user';
  $('#admin-user-balance').value = p.balance ?? 0;
  $('#admin-user-karma').value = p.karma ?? 0;
  $('#admin-user-color').value = p.avatar_color || '#ef5b2c';
  $('#admin-user-ban-reason').value = p.ban_reason || '';
  $('#admin-user-ban-days').value = 0;
  $('#admin-user-status').textContent = p.is_banned ? 'Пользователь сейчас забанен' : '';
  // подтянуть свежие данные
  fetchJSON(`${ADMIN_API}?action=get_user&id=${p.id}`).then(data => {
    if (!data.ok || !data.user) return;
    const u = data.user;
    $('#admin-user-name').value = u.username || '';
    $('#admin-user-role').value = u.role || 'user';
    $('#admin-user-balance').value = u.balance ?? 0;
    $('#admin-user-karma').value = u.karma ?? 0;
    $('#admin-user-color').value = u.avatar_color || '#ef5b2c';
    $('#admin-user-ban-reason').value = u.ban_reason || '';
    $('#admin-user-status').textContent = +u.is_banned ? 'Пользователь сейчас забанен' : '';
  }).catch(() => {});
}

function closeAdminUserModal() {
  $('#admin-user-modal')?.classList.add('hidden');
}

function initAdminUserModal() {
  $('#admin-user-close')?.addEventListener('click', closeAdminUserModal);
  document.querySelectorAll('[data-close-admin-user]').forEach(el => {
    el.addEventListener('click', closeAdminUserModal);
  });

  $('#admin-user-save')?.addEventListener('click', async () => {
    const id = +($('#admin-user-id')?.value || 0);
    if (!id) return;
    const status = $('#admin-user-status');
    try {
      const res = await postJSON(`${ADMIN_API}?action=update_user`, {
        user_id: id,
        username: $('#admin-user-name')?.value || '',
        role: $('#admin-user-role')?.value || 'user',
        balance: +($('#admin-user-balance')?.value || 0),
        karma: +($('#admin-user-karma')?.value || 0),
        avatar_color: $('#admin-user-color')?.value || '#ef5b2c',
      });
      if (!res.ok) throw new Error(res.error || 'Ошибка');
      // медиа
      const av = $('#admin-user-avatar')?.files?.[0];
      const bn = $('#admin-user-banner')?.files?.[0];
      const upload = async (file, kind) => {
        const fd = new FormData();
        fd.append('csrf_token', window.CSRF_TOKEN || '');
        fd.append('user_id', String(id));
        fd.append('kind', kind);
        fd.append('file', file);
        const r = await fetch(`${ADMIN_API}?action=upload_user_media`, { method: 'POST', body: fd, credentials: 'same-origin' });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || 'Ошибка загрузки');
      };
      if (av) await upload(av, 'avatar');
      if (bn) await upload(bn, 'banner');
      if (status) status.textContent = 'Сохранено';
      toast('Профиль обновлён');
      // обновить открытый профиль
      const uname = $('#admin-user-name')?.value;
      if (uname) openUserProfile(uname, id);
    } catch (err) {
      if (status) status.textContent = err.message || 'Ошибка';
      toast(err.message || 'Ошибка');
    }
  });

  $('#admin-user-ban')?.addEventListener('click', async () => {
    const id = +($('#admin-user-id')?.value || 0);
    if (!id) return;
    if (!confirm('Забанить этого пользователя?')) return;
    try {
      const res = await postJSON(`${ADMIN_API}?action=ban`, {
        user_id: id,
        reason: $('#admin-user-ban-reason')?.value || 'Нарушение правил',
        days: +($('#admin-user-ban-days')?.value || 0),
      });
      if (!res.ok) throw new Error(res.error || 'Ошибка');
      toast('Пользователь забанен');
      $('#admin-user-status').textContent = 'Забанен';
    } catch (err) {
      toast(err.message || 'Ошибка');
    }
  });

  $('#admin-user-unban')?.addEventListener('click', async () => {
    const id = +($('#admin-user-id')?.value || 0);
    if (!id) return;
    try {
      const res = await postJSON(`${ADMIN_API}?action=unban`, { user_id: id });
      if (!res.ok) throw new Error(res.error || 'Ошибка');
      toast('Бан снят');
      $('#admin-user-status').textContent = 'Бан снят';
    } catch (err) {
      toast(err.message || 'Ошибка');
    }
  });

  // кнопка «вернуться к авторизации» на экране бана
  $('#ban-back-auth')?.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await postJSON((window.AUTH_API || 'api/auth.php') + '?action=logout', {});
    } catch (err) {}
    try {
      await fetch('api/auth.php?action=logout', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csrf_token: window.CSRF_TOKEN || '' }) });
    } catch (err) {}
    const q = window.IS_CLIENT ? '?view=auth&client=1' : '?view=auth';
    window.location.href = q;
  });
}

function avatarUrlBust(url, uid) {
  if (!url) return '';
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + 'u=' + (uid || 0) + '&t=' + encodeURIComponent(String(url).slice(-12));
}

function applyUserAvatarEl(el, user) {
  if (!el || !user) return;
  // Не красим контейнер side-user-btn — только сам кружок/квадрат аватара
  if (el.id === 'avatar-btn' && el.classList.contains('side-user-btn')) {
    const inner = el.querySelector('.side-avatar') || $('#side-avatar');
    if (inner) el = inner;
    else return;
  }
  const url = user.avatar_url || '';
  // Жёстко фиксируем квадрат — защита от растягивания
  if (el.classList.contains('side-avatar')) {
    el.style.width = '38px';
    el.style.height = '38px';
    el.style.minWidth = '38px';
    el.style.minHeight = '38px';
    el.style.flexShrink = '0';
    el.style.borderRadius = '10px';
  }
  if (el.classList.contains('hp-avatar')) {
    el.style.width = '88px';
    el.style.height = '88px';
    el.style.minWidth = '88px';
    el.style.minHeight = '88px';
    el.style.flexShrink = '0';
    el.style.aspectRatio = '1 / 1';
  }
  if (url) {
    el.style.backgroundImage = `url('${avatarUrlBust(url, user.id)}')`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.style.backgroundRepeat = 'no-repeat';
    el.style.backgroundColor = 'transparent';
    el.textContent = '';
  } else {
    el.style.backgroundImage = 'none';
    el.style.backgroundColor = user.avatar_color || '#ef5b2c';
    el.style.background = user.avatar_color || '#ef5b2c';
    el.textContent = (user.avatar || (user.username || '?').slice(0, 1)).toUpperCase();
  }
}

function profileRoleLabel(user) {
  if (!user) return '';
  if (+user.is_banned === 1) return { text: 'Забанен', cls: 'is-banned' };
  const role = (user.role || 'user').toLowerCase();
  if (role === 'admin') return { text: 'Администратор', cls: 'is-admin' };
  if (role === 'developer') return { text: 'Разработчик', cls: 'is-dev' };
  // Новичок: аккаунт младше 30 дней
  if (user.created_at) {
    const ts = new Date(user.created_at).getTime();
    if (ts && (Date.now() - ts) < 30 * 86400 * 1000) {
      return { text: 'Новичок', cls: 'is-newbie' };
    }
  }
  return { text: 'Игрок', cls: 'is-user' };
}

function setProfileRoleBadge(user) {
  let badge = $('#hp-role-badge');
  const info = $('#hp-user-info') || $('.hp-user-info');
  if (!badge && info) {
    badge = document.createElement('span');
    badge.id = 'hp-role-badge';
    badge.className = 'hp-role-badge';
    info.insertBefore(badge, info.firstChild);
  }
  if (!badge) return;
  const r = profileRoleLabel(user);
  if (!r || !r.text) { badge.style.display = 'none'; return; }
  badge.style.display = '';
  badge.className = 'hp-role-badge ' + r.cls;
  badge.textContent = r.text;
}

