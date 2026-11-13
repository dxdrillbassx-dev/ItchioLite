/* CATio game-format.js — always loaded
 * Depends: utils.js (escapeHtml), icons.js (icon)
 */
window.SYSREQ_LABELS = window.SYSREQ_LABELS || {
  os: 'ОС',
  cpu: 'Процессор',
  ram: 'Оперативная память',
  gpu: 'Видеокарта',
  directx: 'DirectX',
  storage: 'Место на диске',
  sound: 'Звуковая карта',
  other: 'Дополнительно',
};

window.LANG_NAME_RU = window.LANG_NAME_RU || {
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
  if (window.LANG_NAME_RU[key]) return LANG_NAME_RU[key];
  for (const [en, ru] of Object.entries(window.LANG_NAME_RU)) {
    if (key.includes(en)) return ru;
  }
  if (/[а-яё]/i.test(n)) return n;
  return n;
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
    const items = Object.keys(window.SYSREQ_LABELS).filter(k => obj[k]).map(k =>
      `<li><b>${window.SYSREQ_LABELS[k]}:</b> ${escapeHtml(obj[k])}</li>`
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

window.formatGameDescription = formatGameDescription;
window.renderSysReqBlock = renderSysReqBlock;
window.renderLangBlock = renderLangBlock;
window.parseSysReq = parseSysReq;
window.parseLangs = parseLangs;
window.localizeLangName = localizeLangName;
window.normalizeLangRow = normalizeLangRow;
window.initGameCollapsibles = initGameCollapsibles;
