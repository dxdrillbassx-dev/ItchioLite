/* CATio — ленивая подгрузка тяжёлых админ/publish скриптов */
(function () {
  'use strict';
  window.SUBMIT_API = window.SUBMIT_API || 'api/submit.php';
  window.ADMIN_API = window.ADMIN_API || 'api/admin.php';
  window.WS_API = window.WS_API || 'api/workshop.php';
  const loaded = new Set();

  function assetVer() {
    return window.__assetVer || String(Date.now());
  }

  window.__catioLoadScript = function __catioLoadScript(src) {
    const pure = src.split('?')[0];
    if (loaded.has(pure) || document.querySelector('script[data-catio-lazy="' + pure + '"]')) {
      return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.dataset.catioLazy = pure;
      s.onload = function () {
        loaded.add(pure);
        resolve();
      };
      s.onerror = function () {
        reject(new Error('Не удалось загрузить ' + pure));
      };
      document.body.appendChild(s);
    });
  };

  let bundlePromise = null;
  window.loadAdminBundle = function loadAdminBundle() {
    if (bundlePromise) return bundlePromise;
    const v = assetVer();
    bundlePromise = (async function () {
      await window.__catioLoadScript('js/admin.js?v=' + v);
      window.__adminBundleLoaded = true;
      // app.js мог выполнить стартовую инициализацию до загрузки lazy-бандла.
      // Поэтому инициализируем обработчики админской модалки сразу после загрузки admin.js.
      if (typeof window.initAdminUserModal === 'function' && !window.__adminUserModalInitialized) {
        window.initAdminUserModal();
        window.__adminUserModalInitialized = true;
      }
      document.dispatchEvent(new CustomEvent('catio:admin-bundle'));
    })();
    return bundlePromise;
  };

  function needBundle(el) {
    if (!el || !el.closest) return false;
    if (el.closest('[data-view="admin"]')) return true;
    if (el.closest('#view-admin')) return true;
    if (el.closest('#submit-rules-modal, #submit-form-modal, #submit-rules-next, #submit-game-send')) return true;
    if (el.closest('[data-open-publish], .btn-open-publish, #nav-publish')) return true;
    if (el.getAttribute && el.getAttribute('data-view') === 'admin') return true;
    return false;
  }

  document.addEventListener('click', function (e) {
    const t = e.target;
    if (needBundle(t) || needBundle(t.closest && t.closest('button, a, [data-view], [data-atab]'))) {
      window.loadAdminBundle().catch(function (err) {
        console.warn('[CATio] admin bundle', err);
      });
    }
  }, true);

  document.addEventListener('DOMContentLoaded', function () {
    try {
      const params = new URLSearchParams(location.search);
      if (params.get('view') === 'admin') window.loadAdminBundle().catch(function () {});
      const va = document.getElementById('view-admin');
      if (va && va.classList.contains('active')) window.loadAdminBundle().catch(function () {});
    } catch (e) {}
  });

  window.loadAdminPending = async function loadAdminPendingStub() {
    try {
      await window.loadAdminBundle();
      const real = window.__loadAdminPendingReal;
      if (typeof real === 'function') return real.apply(this, arguments);
      // admin-import already on page — call global if stub was overwritten wrong
      if (typeof loadAdminPending === 'function' && loadAdminPending !== loadAdminPendingStub) {
        return loadAdminPending.apply(this, arguments);
      }
      console.warn('[CATio] loadAdminPending not in bundle');
    } finally {
      window.__adminPendingLoading = false;
    }
  };

  window.loadAdminPendingWhenReady = window.loadAdminPending;

  window.__catioLoadCss = function __catioLoadCss(href) {
    const pure = href.split('?')[0];
    if (document.querySelector('link[data-catio-lazy-css="' + pure + '"]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.dataset.catioLazyCss = pure;
    document.head.appendChild(l);
  };

  window.ensurePublishStyles = function ensurePublishStyles() {
    const v = assetVer();
    window.__catioLoadCss('css/cart-publish.css?v=' + v);
    window.__catioLoadCss('css/workshop-admin.css?v=' + v);
  };

  // Стили публикации/админки — не на каждом заходе в каталог
  document.addEventListener('click', function (e) {
    const t = e.target && e.target.closest && e.target.closest(
      '#submit-rules-modal, #submit-form-modal, #submit-rules-next, [data-view="admin"], [data-view="workshop"], #view-admin, #view-workshop'
    );
    if (t) window.ensurePublishStyles();
  }, true);

  document.addEventListener('DOMContentLoaded', function () {
    try {
      const p = new URLSearchParams(location.search);
      const v = p.get('view');
      if (v === 'admin' || v === 'workshop') window.ensurePublishStyles();
    } catch (e) {}
  });

})();