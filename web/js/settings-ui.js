/* CATio — settings UI, theme, banner editor, avatar menu, custom selects */

// ---------- Редактор баннера (превью + зум + перетаскивание) ----------
let bannerEditor = {
  objectUrl: null,
  pendingFile: null,
  posX: 50,
  posY: 50,
  zoom: 1,
  dragging: false,
  lastX: 0,
  lastY: 0,
};

let bannerEditorInited = false;
function initBannerEditor() {
  if (bannerEditorInited) return;
  const modal = $('#hp-banner-modal');
  const openBtn = $('#hp-banner-upload');
  const closeBtn = $('#hp-banner-close');
  const backdrop = $('#hp-banner-backdrop');
  const pickBtn = $('#hp-banner-pick');
  const fileInput = $('#hp-banner-file-modal') || $('#hp-banner-file');
  const saveBtn = $('#hp-banner-save');
  const zoomSl = $('#hp-banner-zoom');
  const zoomVal = $('#hp-banner-zoom-val');
  const preview = $('#hp-banner-preview');
  const previewImg = $('#hp-banner-preview-img');

  if (!modal || !openBtn) return;
  bannerEditorInited = true;

  const open = () => {
    // load current banner into preview
    const bg = $('#hp-banner-bg');
    let url = '';
    if (window.AUTH_STATE?.user?.banner_url) {
      url = window.AUTH_STATE.user.banner_url;
    } else if (bg && bg.style.backgroundImage) {
      const m = bg.style.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
      if (m) url = m[1];
    }
    // restore pos/zoom from auth or defaults
    const pos = (window.AUTH_STATE?.user?.banner_pos || '50% 50%').split(/\s+/);
    bannerEditor.posX = parseFloat(pos[0]) || 50;
    bannerEditor.posY = parseFloat(pos[1]) || 50;
    bannerEditor.zoom = parseFloat(window.AUTH_STATE?.user?.banner_zoom) || 1;
    if (bannerEditor.zoom < 1) bannerEditor.zoom = 1;

    bannerEditor.pendingFile = null;
    if (bannerEditor.objectUrl) {
      URL.revokeObjectURL(bannerEditor.objectUrl);
      bannerEditor.objectUrl = null;
    }

    if (url && previewImg) {
      previewImg.style.backgroundImage = `url('${url}')`;
      applyBannerPreview();
    } else if (previewImg) {
      previewImg.style.backgroundImage = '';
    }
    if (zoomSl) zoomSl.value = Math.round(bannerEditor.zoom * 100);
    if (zoomVal) zoomVal.textContent = Math.round(bannerEditor.zoom * 100) + '%';
    openAnimatedModal(modal);
  };

  const close = () => {
    closeAnimatedModal(modal);
    if (bannerEditor.objectUrl) {
      URL.revokeObjectURL(bannerEditor.objectUrl);
      bannerEditor.objectUrl = null;
    }
    bannerEditor.pendingFile = null;
  };

  openBtn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (backdrop) backdrop.addEventListener('click', close);

  if (pickBtn && fileInput) {
    pickBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (!fileInput.files || !fileInput.files[0]) return;
      const file = fileInput.files[0];
      if (bannerEditor.objectUrl) URL.revokeObjectURL(bannerEditor.objectUrl);
      bannerEditor.objectUrl = URL.createObjectURL(file);
      bannerEditor.pendingFile = file;
      bannerEditor.posX = 50;
      bannerEditor.posY = 50;
      bannerEditor.zoom = 1;
      if (previewImg) previewImg.style.backgroundImage = `url('${bannerEditor.objectUrl}')`;
      if (zoomSl) zoomSl.value = 100;
      if (zoomVal) zoomVal.textContent = '100%';
      applyBannerPreview();
      fileInput.value = '';
    });
  }

  if (zoomSl) {
    zoomSl.addEventListener('input', () => {
      bannerEditor.zoom = Math.max(1, Math.min(2.5, (parseInt(zoomSl.value, 10) || 100) / 100));
      if (zoomVal) zoomVal.textContent = Math.round(bannerEditor.zoom * 100) + '%';
      applyBannerPreview();
    });
  }

  // drag to pan
  if (preview) {
    const onDown = (e) => {
      bannerEditor.dragging = true;
      const pt = e.touches ? e.touches[0] : e;
      bannerEditor.lastX = pt.clientX;
      bannerEditor.lastY = pt.clientY;
    };
    const onMove = (e) => {
      if (!bannerEditor.dragging) return;
      const pt = e.touches ? e.touches[0] : e;
      const dx = pt.clientX - bannerEditor.lastX;
      const dy = pt.clientY - bannerEditor.lastY;
      bannerEditor.lastX = pt.clientX;
      bannerEditor.lastY = pt.clientY;
      // sensitivity depends on zoom — higher zoom = more room to pan
      const box = preview.getBoundingClientRect();
      // % сдвига = пиксели / размер превью * 100 / zoom
      const sensX = (100 / Math.max(1, box.width)) / bannerEditor.zoom;
      const sensY = (100 / Math.max(1, box.height)) / bannerEditor.zoom;
      bannerEditor.posX = Math.max(0, Math.min(100, bannerEditor.posX - dx * sensX));
      bannerEditor.posY = Math.max(0, Math.min(100, bannerEditor.posY - dy * sensY));
      applyBannerPreview();
      e.preventDefault();
    };
    const onUp = () => { bannerEditor.dragging = false; };
    preview.addEventListener('mousedown', onDown);
    preview.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const label = saveBtn.textContent;
      saveBtn.disabled = true;
      saveBtn.classList.add('is-loading');
      saveBtn.textContent = 'Сохранение…';
      try {
        // 1) upload new file if chosen
        if (bannerEditor.pendingFile) {
          await uploadProfileImage('banner', bannerEditor.pendingFile);
          bannerEditor.pendingFile = null;
        }
        // 2) save position / zoom
        const pos = `${Math.round(bannerEditor.posX)}% ${Math.round(bannerEditor.posY)}%`;
        const res = await postJSON(`${USER_API}?action=banner_display`, {
          pos,
          zoom: bannerEditor.zoom,
        });
        if (!res.ok) throw new Error(res.error || 'Ошибка');
        const z = res.zoom != null ? res.zoom : bannerEditor.zoom;
        applyBannerToHero(pos, z);
        // settings preview position too
        const setPrev = $('#settings-banner-preview');
        if (setPrev) {
          const size = z <= 1.01 ? 'cover' : (Math.round(z * 100) + '%');
          setPrev.style.backgroundPosition = pos;
          setPrev.style.backgroundSize = size;
        }
        if (window.AUTH_STATE?.user) {
          window.AUTH_STATE.user.banner_pos = pos;
          window.AUTH_STATE.user.banner_zoom = z;
        }
        toast('Баннер сохранён');
        close();
      } catch (err) {
        toast(err.message || 'Не удалось сохранить');
      } finally {
        saveBtn.disabled = false;
        saveBtn.classList.remove('is-loading');
        saveBtn.textContent = label || 'Сохранить';
      }
    });
  }
}

function applyBannerPreview() {
  const el = $('#hp-banner-preview-img');
  if (!el) return;
  const size = bannerEditor.zoom <= 1.01 ? 'cover' : (Math.round(bannerEditor.zoom * 100) + '%');
  const pos = `${bannerEditor.posX}% ${bannerEditor.posY}%`;
  el.style.setProperty('background-position', pos, 'important');
  el.style.setProperty('background-size', size, 'important');
  el.style.setProperty('background-repeat', 'no-repeat', 'important');
}

/** Применить позицию/зум баннера к hero — 1:1 как в превью */
function applyBannerToHero(pos, zoom) {
  const bg = $('#hp-banner-bg');
  if (!bg) return;
  const z = Math.max(1, Math.min(2.5, parseFloat(zoom) || 1));
  const size = z <= 1.01 ? 'cover' : (Math.round(z * 100) + '%');
  const p = pos || '50% 50%';
  bg.style.setProperty('background-position', p, 'important');
  bg.style.setProperty('background-size', size, 'important');
  bg.style.setProperty('background-repeat', 'no-repeat', 'important');
  bg.classList.add('has-image');
}

function applyUserBanner(url, pos, zoom) {
  const bg = $('#hp-banner-bg');
  if (bg) {
    if (url) {
      bg.style.setProperty('background-image', `url('${url}')`, 'important');
      bg.classList.add('has-image');
    } else {
      bg.style.removeProperty('background-image');
      bg.classList.remove('has-image');
    }
    applyBannerToHero(pos || '50% 50%', zoom != null ? zoom : 1);
  }
  // фон карточки в настройках
  const cardBan = $('#settings-profile-card-banner');
  if (cardBan && url) {
    const z = Math.max(1, Math.min(2.5, parseFloat(zoom) || 1));
    const size = z <= 1.01 ? 'cover' : (Math.round(z * 100) + '%');
    cardBan.style.backgroundImage = `url('${url}')`;
    cardBan.style.backgroundPosition = pos || '50% 50%';
    cardBan.style.backgroundSize = size;
  }
}



// ---------- Вкладка настроек ----------

// ---------- Тема (тёмная / светлая) ----------
function getTheme() {
  try {
    const t = localStorage.getItem('catio_theme');
    return t === 'light' ? 'light' : 'dark';
  } catch (e) {
    return 'dark';
  }
}

function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('catio_theme', t); } catch (e) {}
  // sync picker UI
  $$('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === t);
  });
}


// ---------- Custom select (красивые выпадающие списки) ----------

const SELECT_OPTION_ICONS = {
  // sort
  popular: icon('star-alt', 14),
  new: icon('calendar', 14),
  rating: icon('star-alt', 14),
  price: icon('dollar', 14),
  title: icon('menu-lines', 14),
  // platform-ish
  windows: icon('windows', 14),
  linux: icon('user-simple', 14),
  mac: '' + icon('user-simple', 14) + '',
  all: icon('grid-2x2', 14),
  // visibility
  public: icon('globe', 14),
  friends: icon('friends', 14),
  hidden: icon('eye-off', 14),
  // lang
  ru: icon('target', 14),
  // library sorts fallback
  recent: icon('clock', 14),
  name: icon('menu-lines', 14),
  playtime: icon('clock', 14),
};

function selectOptionIcon(value, label) {
  const v = String(value || '').toLowerCase().trim();
  const l = String(label || '').toLowerCase().trim();
  // пустой плейсхолдер («Выберите») — без иконки
  if (!v) return '';
  if (SELECT_OPTION_ICONS[v]) return SELECT_OPTION_ICONS[v];
  if (/windows|win/.test(v+l)) return SELECT_OPTION_ICONS.windows;
  if (/linux/.test(v+l)) return SELECT_OPTION_ICONS.linux;
  if (/mac|osx|darwin/.test(v+l)) return SELECT_OPTION_ICONS.mac;
  if (/популяр|popular/.test(l)) return SELECT_OPTION_ICONS.popular;
  if (/^нов|\bnew\b/.test(l)) return SELECT_OPTION_ICONS.new;
  if (/оцен|rating|star/.test(l)) return SELECT_OPTION_ICONS.rating;
  if (/цен[аеы]|price|₽|\$/.test(l)) return SELECT_OPTION_ICONS.price;
  if (/назван|title|^name$/.test(l) || v === 'title' || v === 'name') return SELECT_OPTION_ICONS.title;
  if (/друг|friend|подарок/.test(l)) return SELECT_OPTION_ICONS.friends;
  if (/моего аккаунт|self|себе/.test(l)) return SELECT_OPTION_ICONS.public;
  if (/скрыт|hidden|private/.test(l)) return SELECT_OPTION_ICONS.hidden;
  if (/всем|public|открыт/.test(l)) return SELECT_OPTION_ICONS.public;
  // жанры и прочее — без дефолтного кружка
  return '';
}

const CATIO_SELECT_CHEVRON = icon('chevron-down-lg', 16, 'catio-select__chevron');


function openAnimatedModal(modal) {
  if (!modal) return;
  modal.classList.remove('is-closing', 'hidden');
  // reflow so enter transition plays
  void modal.offsetWidth;
}

function closeAnimatedModal(modal, ms = 220) {
  if (!modal || modal.classList.contains('hidden')) return;
  modal.classList.add('is-closing');
  window.setTimeout(() => {
    modal.classList.add('hidden');
    modal.classList.remove('is-closing');
  }, ms);
}

function enhanceSelect(sel) {
  if (!sel || sel.dataset.catioEnhanced === '1') return;
  if (sel.multiple || sel.size > 1) return;
  sel.dataset.catioEnhanced = '1';

  const wrap = document.createElement('div');
  wrap.className = 'catio-select';
  if (sel.className) wrap.className += ' ' + sel.className.replace(/\b(settings-select|sort-select|hp-select|auth-input)\b/g, '').trim();
  wrap.dataset.for = sel.id || '';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'catio-select__btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');

  const val = document.createElement('span');
  val.className = 'catio-select__value';
  btn.appendChild(val);
  btn.insertAdjacentHTML('beforeend', CATIO_SELECT_CHEVRON);

  const menu = document.createElement('div');
  menu.className = 'catio-select__menu';
  menu.setAttribute('role', 'listbox');

  const parent = sel.parentNode;
  parent.insertBefore(wrap, sel);
  wrap.appendChild(btn);
  wrap.appendChild(menu);
  wrap.appendChild(sel);
  sel.classList.add('select-native-hidden');
  sel.setAttribute('tabindex', '-1');
  sel.setAttribute('aria-hidden', 'true');
  sel.style.cssText = 'position:absolute!important;left:-9999px!important;top:0!important;opacity:0!important;pointer-events:none!important;width:1px!important;height:1px!important;margin:0!important;padding:0!important;border:0!important;clip:rect(0,0,0,0)!important;overflow:hidden!important;appearance:none!important;';

  const sync = () => {
    const opt = sel.options[sel.selectedIndex];
    if (opt) {
      const ico = selectOptionIcon(opt.value, opt.textContent);
      val.innerHTML = (ico ? `<span class=\"catio-select__ico\">${ico}</span>` : '') + `<span class=\"catio-select__txt\">${opt.textContent}</span>`;
    } else {
      val.textContent = '';
    }
    menu.querySelectorAll('.catio-select__option').forEach(o => {
      o.classList.toggle('is-active', o.dataset.value === sel.value);
    });
  };

  const rebuild = () => {
    menu.innerHTML = '';
    [...sel.options].forEach(opt => {
      if (opt.disabled && opt.value === '') return; // skip empty placeholder? keep all
      const o = document.createElement('button');
      o.type = 'button';
      o.className = 'catio-select__option' + (opt.selected ? ' is-active' : '');
      o.dataset.value = opt.value;
      const ico = selectOptionIcon(opt.value, opt.textContent);
      o.innerHTML = (ico ? `<span class="catio-select__ico">${ico}</span>` : '') + `<span class="catio-select__txt">${opt.textContent}</span>`;
      o.setAttribute('role', 'option');
      o.addEventListener('click', (e) => {
        e.stopPropagation();
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        sync();
        close();
      });
      menu.appendChild(o);
    });
    sync();
  };

  const positionMenu = () => {
    const rect = btn.getBoundingClientRect();
    const menuW = Math.max(rect.width, 168);
    let left = rect.left;
    if (left + menuW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - menuW - 8);
    menu.style.position = 'fixed';
    menu.style.left = left + 'px';
    menu.style.top = (rect.bottom + 6) + 'px';
    menu.style.width = menuW + 'px';
    menu.style.right = 'auto';
    menu.style.minWidth = menuW + 'px';
    menu.style.zIndex = '10000';
  };
  const open = () => {
    document.querySelectorAll('.catio-select.is-open').forEach(w => {
      if (w !== wrap) {
        w.classList.remove('is-open');
        const m = w.querySelector('.catio-select__menu');
        if (m) { m.style.position = ''; m.style.left = ''; m.style.top = ''; }
      }
    });
    positionMenu();
    wrap.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    wrap.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    menu.style.position = '';
    menu.style.left = '';
    menu.style.top = '';
    menu.style.width = '';
    menu.style.right = '';
  };

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (wrap.classList.contains('is-open')) close();
    else open();
  });
  // label не должен перехватывать клик
  const lab = wrap.closest('label');
  if (lab) {
    lab.addEventListener('click', (e) => {
      if (e.target.closest('.catio-select')) {
        e.preventDefault();
      }
    });
  }

  sel.addEventListener('change', sync);
  rebuild();

  // MutationObserver if options change
  const mo = new MutationObserver(rebuild);
  mo.observe(sel, { childList: true, subtree: true, attributes: true });
}

function initCatioSelects(root = document) {
  const nodes = root.querySelectorAll('select.settings-select, select.sort-select, select.hp-select, select.cart-modal-for, select#settings-lang, select#sort-select, select#library-sort, select#hp-sort, select#hp-platform, select#settings-profile-vis, select#settings-media-vis');
  nodes.forEach(sel => {
    // список издательств при публикации и в настройках — нативный select (надёжнее)
    if (sel.id === 'sg-publisher-id' || sel.id === 'settings-display-pub') return;
    enhanceSelect(sel);
  });
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.catio-select')) {
    document.querySelectorAll('.catio-select.is-open').forEach(w => w.classList.remove('is-open'));
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.catio-select.is-open').forEach(w => {
      w.classList.remove('is-open');
    });
    if (typeof hideHeadSearchDrop === 'function') hideHeadSearchDrop();
  }
});
window.addEventListener('scroll', (e) => {
  // скролл внутри самого меню не должен закрывать список
  const t = e.target;
  if (t && t.closest && t.closest('.catio-select__menu')) return;
  document.querySelectorAll('.catio-select.is-open').forEach(w => {
    const menu = w.querySelector('.catio-select__menu');
    if (menu && (t === menu || menu.contains(t))) return;
    w.classList.remove('is-open');
    if (menu) {
      menu.style.position = '';
      menu.style.left = '';
      menu.style.top = '';
      menu.style.width = '';
    }
  });
}, true);

// колесо внутри меню — не всплывает к window-scroll-closer
document.addEventListener('wheel', (e) => {
  if (e.target && e.target.closest && e.target.closest('.catio-select__menu')) {
    e.stopPropagation();
  }
}, true);


function moveSegIndicator(groupEl) {
  if (!groupEl) return;
  let ind = groupEl.querySelector('.seg-indicator');
  if (!ind) {
    ind = document.createElement('span');
    ind.className = 'seg-indicator';
    groupEl.prepend(ind);
  }
  const active = groupEl.querySelector('.store-era-btn.active, .price-pill.active, .seg-btn.active');
  if (!active) { ind.style.opacity = '0'; return; }
  ind.style.opacity = '1';
  ind.style.width = active.offsetWidth + 'px';
  ind.style.height = active.offsetHeight + 'px';
  ind.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
}

function initSegControls() {
  const groups = [
    document.querySelector('#view-store .catalogue-mode-toggle'),
    document.querySelector('#price-pills'),
  ].filter(Boolean);
  groups.forEach(g => {
    if (g.dataset.segInit === '1') {
      moveSegIndicator(g);
      return;
    }
    g.dataset.segInit = '1';
    g.classList.add('seg-control');
    g.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        requestAnimationFrame(() => moveSegIndicator(g));
        setTimeout(() => moveSegIndicator(g), 40);
      });
    });
  });
  const paint = () => groups.forEach(moveSegIndicator);
  paint();
  requestAnimationFrame(paint);
  setTimeout(paint, 50);
  setTimeout(paint, 200);
  window.addEventListener('resize', paint);
}

/** Пересчитать сегменты при открытии каталога */
function refreshStoreChrome() {
  try { initCatioSelects(document.getElementById('view-store') || document); } catch (e) {}
  try { initSegControls(); } catch (e) {}
  // force indicator after layout
  setTimeout(() => {
    document.querySelectorAll('#view-store .seg-control, #view-store .catalogue-mode-toggle, #price-pills').forEach(moveSegIndicator);
  }, 30);
}

function initThemePicker() {
  applyTheme(getTheme());
  $$('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.theme);
      toast(btn.dataset.theme === 'light' ? 'Светлая тема' : 'Тёмная тема');
    });
  });
}


function openProfileEditModal() {
  const modal = $('#hp-edit-modal');
  if (!modal) { toast('Модалка профиля не найдена'); return; }
  const me = window.AUTH_STATE && window.AUTH_STATE.user;
  const input = $('#hp-edit-displayname');
  if (input && me) input.value = me.username || '';
  // sync avatar preview in modal
  if (me && typeof applyUserAvatarEl === 'function') {
    applyUserAvatarEl($('#hp-edit-avatar'), me);
  }
  openAnimatedModal(modal);
}

function openBannerEditModal() {
  // ensure editor bound
  try { initBannerEditor(); } catch (e) {}
  const openBtn = $('#hp-banner-upload');
  if (openBtn) {
    openBtn.click();
    return;
  }
  const modal = $('#hp-banner-modal');
  if (!modal) { toast('Модалка баннера не найдена'); return; }
  // fallback open + preview
  const me = window.AUTH_STATE && window.AUTH_STATE.user;
  const previewImg = $('#hp-banner-preview-img');
  if (previewImg && me?.banner_url) {
    previewImg.style.backgroundImage = `url('${me.banner_url}')`;
  }
  if (typeof applyBannerPreview === 'function') {
    try {
      const pos = (me?.banner_pos || '50% 50%').split(/\s+/);
      if (typeof bannerEditor !== 'undefined') {
        bannerEditor.posX = parseFloat(pos[0]) || 50;
        bannerEditor.posY = parseFloat(pos[1]) || 50;
        bannerEditor.zoom = parseFloat(me?.banner_zoom) || 1;
        applyBannerPreview();
      }
    } catch (e) {}
  }
  openAnimatedModal(modal);
}

async function fillSettingsDisplayPub() {
  const sel = $('#settings-display-pub');
  if (!sel) return;
  // защита от повторных гонок при быстром переключении вкладок
  const token = (sel._fillToken = (sel._fillToken || 0) + 1);

  let pubs = [];
  let display = null;
  try {
    const data = await fetchJSON(PUB_API + '?action=mine');
    pubs = data.publishers || [];
  } catch (e) { console.warn('fillSettingsDisplayPub mine', e); }
  if (sel._fillToken !== token) return;
  try {
    const me = window.AUTH_STATE && window.AUTH_STATE.user;
    if (me && me.id) {
      const fu = await fetchJSON(PUB_API + '?action=for_user&user_id=' + me.id);
      if (sel._fillToken !== token) return;
      display = fu.display_publisher_id;
    }
  } catch (e) {}
  if (sel._fillToken !== token) return;

  // Снимаем старую catio-обёртку аккуратно
  const oldWrap = sel.closest('.catio-select');
  if (oldWrap && oldWrap.parentNode) {
    oldWrap.parentNode.insertBefore(sel, oldWrap);
    oldWrap.remove();
  }
  delete sel.dataset.catioEnhanced;
  sel.removeAttribute('tabindex');
  sel.removeAttribute('aria-hidden');
  sel.classList.add('settings-select');
  sel.classList.remove('select-native-hidden');
  sel.style.cssText = '';

  const html = '<option value="hide">Не показывать</option>' +
    pubs.map(p => '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>').join('');
  sel.innerHTML = html;
  if (display === 0 || display === '0' || display === null || display === undefined || display === '') {
    sel.value = 'hide';
  } else if ([...sel.options].some(o => o.value === String(display))) {
    sel.value = String(display);
  } else {
    sel.value = 'hide';
  }

  // Нативный select надёжнее кастомного в settings — не пропадает
  // (catio иногда мигает и схлопывается из-за overflow/перестроения)
  // Оставляем обычный settings-select вид.
  try {
    // если очень хочется кастом — enhance, но без повторного destroy
    // enhanceSelect(sel);
  } catch (e) { console.warn(e); }
}

function initSettingsView() {
  const view = $('#view-settings');
  if (!view) return;

  const menuSettings = $('#menu-settings');
  if (menuSettings) menuSettings.addEventListener('click', () => {
    const menu = $('#user-menu');
    if (menu) menu.classList.add('hidden');
    gotoView('settings');
  });
  const topupOpen = $('#btn-topup-open');
  if (topupOpen) topupOpen.addEventListener('click', () => {
    gotoView('settings');
    switchSettingsTab('balance');
  });

  $$('.settings-nav-btn', view).forEach(btn => {
    btn.addEventListener('click', () => switchSettingsTab(btn.dataset.stab));
  });

  // load current prefs into form
  const me = window.AUTH_STATE && window.AUTH_STATE.user;
  if (me) {
    const pvis = $('#settings-profile-vis');
    if (pvis) pvis.value = me.profile_visibility || 'public';
    const mvis = $('#settings-media-vis');
    if (mvis) mvis.value = me.media_visibility || 'public';
    const allow = $('#settings-allow-friends');
    if (allow) allow.checked = me.allow_friend_requests !== 0;
    const email = $('#settings-email');
    if (email) email.value = me.email || '';
    const uname = $('#settings-username');
    if (uname) uname.value = me.username || '';
    // notif prefs
    let prefs = {};
    try { prefs = typeof me.notif_prefs === 'string' ? JSON.parse(me.notif_prefs) : (me.notif_prefs || {}); } catch (e) {}
    $$('[data-np]').forEach(cb => {
      const key = cb.dataset.np;
      if (prefs[key] === undefined) return;
      cb.checked = !!prefs[key];
    });
  }

  // Профиль / баннер — модалки вне view-profile, открываются напрямую
  const openProfileEdit = $('#settings-open-profile-edit');
  if (openProfileEdit) {
    openProfileEdit.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openProfileEditModal();
    });
  }
  const openBannerEdit = $('#settings-open-banner-edit');
  if (openBannerEdit) {
    openBannerEdit.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openBannerEditModal();
    });
  }

  // save general
  $('#settings-save-general')?.addEventListener('click', async () => {
    const errBox = $('#settings-error');
    if (errBox) errBox.classList.add('hidden');
    try {
      const res = await postJSON(`${USER_API}?action=settings`, {
        section: 'general',
        username: $('#settings-username')?.value?.trim() || '',
      });
      if (!res.ok) throw new Error(res.error || 'Ошибка');
      if (window.AUTH_STATE?.user) {
        window.AUTH_STATE.user.username = res.username;
      }
      $$('.side-user-name, .user-menu-name, #hp-username').forEach(el => { if (el) el.textContent = res.username; });
      toast('Основные настройки сохранены');
    } catch (err) {
      if (errBox) { errBox.textContent = err.message; errBox.classList.remove('hidden'); }
      else toast(err.message);
    }
  });

  // save notifications
  $('#settings-save-notif')?.addEventListener('click', async () => {
    const prefs = {};
    $$('[data-np]').forEach(cb => { prefs[cb.dataset.np] = !!cb.checked; });
    try {
      const res = await postJSON(`${USER_API}?action=settings`, { section: 'notifications', prefs });
      if (!res.ok) throw new Error(res.error || 'Ошибка');
      if (window.AUTH_STATE?.user) window.AUTH_STATE.user.notif_prefs = prefs;
      toast('Уведомления сохранены');
    } catch (err) { toast(err.message); }
  });

  // save privacy
  $('#settings-save-privacy')?.addEventListener('click', async () => {
    const errBox = $('#settings-privacy-error');
    if (errBox) errBox.classList.add('hidden');
    try {
      const res = await postJSON(`${USER_API}?action=settings`, {
        section: 'privacy',
        profile_visibility: $('#settings-profile-vis')?.value || 'public',
        media_visibility: $('#settings-media-vis')?.value || 'public',
        allow_friend_requests: $('#settings-allow-friends')?.checked ? 1 : 0,
        email: $('#settings-email')?.value?.trim() || '',
      });
      if (!res.ok) throw new Error(res.error || 'Ошибка');
      if (window.AUTH_STATE?.user) {
        window.AUTH_STATE.user.profile_visibility = $('#settings-profile-vis')?.value;
        window.AUTH_STATE.user.media_visibility = $('#settings-media-vis')?.value;
        window.AUTH_STATE.user.allow_friend_requests = $('#settings-allow-friends')?.checked ? 1 : 0;
        window.AUTH_STATE.user.email = $('#settings-email')?.value?.trim();
      }
      // издательство в профиле — мгновенно + API
      try {
        const sel = $('#settings-display-pub');
        const v = sel?.value || 'hide';
        const hide = (v === 'hide' || v === '' || v === '0');
        const me = window.AUTH_STATE && window.AUTH_STATE.user;
        const line = document.getElementById('hp-publisher-line');

        // оптимистично: сразу прячем или ставим выбранное
        if (me && me.id && line) {
          line.dataset.forUser = String(me.id);
          if (hide) {
            renderPublisherLine(line, []);
            if (window.AUTH_STATE.user) window.AUTH_STATE.user.display_publisher_id = 0;
          } else {
            const opt = sel?.selectedOptions && sel.selectedOptions[0];
            const name = (opt && opt.textContent) ? opt.textContent.trim() : '';
            const pid = Number(v) || 0;
            if (pid && name) {
              renderPublisherLine(line, [{ id: pid, name: name, slug: '' }]);
            }
            if (window.AUTH_STATE.user) window.AUTH_STATE.user.display_publisher_id = pid;
          }
        }

        const resPub = await postJSON(PUB_API + '?action=set_display', {
          csrf_token: window.CSRF_TOKEN || '',
          display_publisher_id: hide ? 'hide' : v
        });
        if (resPub && resPub.ok === false) throw new Error(resPub.error || 'Не удалось сохранить издательство');

        // синхронизация с сервером (на случай slug и т.п.)
        if (me && me.id) {
          window.__pubLineToken = (window.__pubLineToken || 0) + 1;
          if (typeof viewingUserId !== 'undefined') viewingUserId = null;
          await loadProfilePublishers(me.id);
        }
      } catch (e2) {
        console.warn(e2);
        toast(e2.message || 'Настройки сохранены, но издательство не обновилось');
      }
      toast('Конфиденциальность сохранена');
    } catch (err) {
      if (errBox) { errBox.textContent = err.message; errBox.classList.remove('hidden'); }
      else toast(err.message);
    }
  });

  // Пополнение баланса
  $$('.btn-topup', view).forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const data = await postJSON(`${USER_API}?action=topup`, { amount: +btn.dataset.amount });
        if (!data.ok) throw new Error(data.error || 'Не удалось пополнить');
        updateBalance(data.balance);
        toast(`Баланс пополнен: ${Number(data.balance).toLocaleString('ru-RU')} ₽`);
      } catch (err) {
        toast(err.message || 'Ошибка');
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function switchSettingsTab(tab) {
  $$('.settings-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.stab === tab));
  $$('.settings-pane').forEach(p => p.classList.toggle('hidden', p.id !== `settings-pane-${tab}`));
  if (tab === 'privacy' && typeof fillSettingsDisplayPub === 'function') {
    try { fillSettingsDisplayPub(); } catch (e) {}
  }
}

// ---------- Меню под аватаркой ----------
function initAvatarMenu() {
  const btn = $('#avatar-btn');
  const menu = $('#user-menu');
  if (!btn || !menu) return;

  let menuClosing = false;
  const isMenuOpen = () => !menu.classList.contains('hidden') && !menuClosing && menu.classList.contains('is-open');

  function openMenu() {
    menuClosing = false;
    menu.classList.remove('hidden', 'is-closing');
    void menu.offsetWidth;
    menu.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
    try { if (typeof refreshBadge === 'function') refreshBadge(); } catch (e) {}
  }
  function closeMenu() {
    if (menu.classList.contains('hidden') || menuClosing) return;
    menuClosing = true;
    menu.classList.remove('is-open');
    menu.classList.add('is-closing');
    btn.setAttribute('aria-expanded', 'false');
    window.setTimeout(() => {
      menu.classList.add('hidden');
      menu.classList.remove('is-closing');
      menuClosing = false;
    }, 180);
  }

  const distToRect = (x, y, r) => {
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    return Math.hypot(dx, dy);
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.classList.contains('hidden') || menu.classList.contains('is-closing')) openMenu();
    else closeMenu();
  });

  document.addEventListener('click', (e) => {
    if (isMenuOpen() && !menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      closeMenu();
    }
  });

  const onScrollOrWheel = (e) => {
    if (!isMenuOpen()) return;
    if (e.target && (menu.contains(e.target) || btn.contains(e.target))) return;
    closeMenu();
  };
  window.addEventListener('scroll', onScrollOrWheel, true);
  document.addEventListener('wheel', onScrollOrWheel, { passive: true, capture: true });

  const LEAVE_PX = 56;
  document.addEventListener('mousemove', (e) => {
    if (!isMenuOpen()) return;
    const mr = menu.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const d = Math.min(distToRect(e.clientX, e.clientY, mr), distToRect(e.clientX, e.clientY, br));
    if (d > LEAVE_PX) closeMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  const profileBtn = $('#menu-profile');
  if (profileBtn) {
    profileBtn.addEventListener('click', () => {
      closeMenu();
      gotoView('profile');
    });
  }

  const downloadsBtn = $('#menu-downloads');
  if (downloadsBtn) {
    downloadsBtn.addEventListener('click', () => {
      closeMenu();
      gotoView('downloads');
    });
  }

  const logoutBtn = $('#menu-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      closeMenu();
      logout();
    });
  }
}

