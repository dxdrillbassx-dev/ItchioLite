// IndieHub frontend — clean vanilla JS
// Navigation is now handled by the native launcher

const API_BASE = 'api/games.php';

function $(sel, ctx = document) {
  return ctx.querySelector(sel);
}

function $$(sel, ctx = document) {
  return Array.from(ctx.querySelectorAll(sel));
}

function formatPrice(price) {
  const p = parseFloat(price);
  if (p === 0) return { text: 'Бесплатно', className: 'free' };
  return { text: `$${p.toFixed(2)}`, className: 'paid' };
}

function tagsToArray(tags) {
  if (!tags) return [];
  return tags.split(',').map(t => t.trim()).filter(Boolean);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------- View switching (from URL param) ----------
function getViewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('view') || 'store';
}

function showView(name) {
  $$('.view').forEach(v => v.classList.remove('active'));
  const el = $(`#view-${name}`);
  if (el) el.classList.add('active');

  if (name === 'library') loadLibrary();
  if (name === 'store') loadStore();
}

// ---------- Store ----------
async function loadStore() {
  const grid = $('#games-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading">Загрузка игр...</div>';

  try {
    const res = await fetch(`${API_BASE}?action=list`);
    const data = await res.json();

    if (!data.ok) throw new Error(data.error || 'Ошибка загрузки');

    if (!data.games.length) {
      grid.innerHTML = '<div class="loading">Игр пока нет</div>';
      return;
    }

    grid.innerHTML = '';
    data.games.forEach(game => {
      grid.appendChild(createGameCard(game));
    });
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<div class="loading">Не удалось загрузить игры.<br><small>${err.message}</small></div>`;
  }
}

function createGameCard(game) {
  const card = document.createElement('article');
  card.className = 'game-card';
  card.dataset.id = game.id;

  const price = formatPrice(game.price);
  const tags = tagsToArray(game.tags).slice(0, 3);

  card.innerHTML = `
    <div class="game-cover">
      ${game.cover_url ? `<img src="${game.cover_url}" alt="${escapeHtml(game.title)}" />` : '🎮'}
    </div>
    <div class="game-info">
      <h3 class="game-title">${escapeHtml(game.title)}</h3>
      <div class="game-dev">${escapeHtml(game.developer_name || 'Unknown')}</div>
      <div class="game-tags">
        ${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
      </div>
      <div class="game-footer">
        <span class="price ${price.className}">${price.text}</span>
        <button class="btn-get" data-id="${game.id}">Подробнее</button>
      </div>
    </div>
  `;

  card.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-get')) return;
    openGameModal(game);
  });

  card.querySelector('.btn-get').addEventListener('click', (e) => {
    e.stopPropagation();
    openGameModal(game);
  });

  return card;
}

// ---------- Library ----------
async function loadLibrary() {
  const grid = $('#library-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading">Загрузка библиотеки...</div>';

  try {
    const res = await fetch(`${API_BASE}?action=library`);
    const data = await res.json();

    if (!data.ok) throw new Error(data.error || 'Ошибка');

    if (!data.library.length) {
      grid.innerHTML = '<div class="loading">Библиотека пуста. Добавь игры из магазина!</div>';
      return;
    }

    grid.innerHTML = '';
    data.library.forEach(game => {
      const card = createGameCard(game);
      const btn = card.querySelector('.btn-get');
      if (btn) btn.textContent = 'Играть';
      grid.appendChild(card);
    });
  } catch (err) {
    grid.innerHTML = `<div class="loading">Ошибка загрузки библиотеки<br><small>${err.message}</small></div>`;
  }
}

// ---------- Modal ----------
function openGameModal(game) {
  const modal = $('#modal');
  const body = $('#modal-body');
  const price = formatPrice(game.price);

  body.innerHTML = `
    <h2 class="modal-title">${escapeHtml(game.title)}</h2>
    <div class="modal-dev">от ${escapeHtml(game.developer_name || 'Unknown')}</div>
    <p class="modal-desc">${escapeHtml(game.description || game.short_description || 'Описание отсутствует.')}</p>
    <div class="modal-actions">
      <button class="btn-primary" id="btn-get-game">
        ${price.className === 'free' ? 'Получить бесплатно' : `Купить за ${price.text}`}
      </button>
      <span class="modal-price">${price.text}</span>
    </div>
  `;

  modal.classList.remove('hidden');

  $('#btn-get-game').onclick = () => {
    alert(price.className === 'free'
      ? `"${game.title}" добавлена в библиотеку! (демо)`
      : `Покупка "${game.title}" за ${price.text} — демо-режим`);
    closeModal();
  };
}

function closeModal() {
  $('#modal').classList.add('hidden');
}

function initModal() {
  $('#modal-close').addEventListener('click', closeModal);
  $('.modal-backdrop').addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

// ---------- Web navigation (only when not in native client) ----------
function initWebNav() {
  if (window.IS_CLIENT) return; // native launcher handles navigation

  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      $$('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showView(view);
    });
  });
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  initModal();
  initWebNav();
  const view = getViewFromUrl();
  showView(view);
});
