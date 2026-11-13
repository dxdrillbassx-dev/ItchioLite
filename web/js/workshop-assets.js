/* CATio — legacy asset-catalog helpers (view-community removed) */

async function loadWorkshop() {
  // Старая вкладка community удалена; открываем настоящую мастерскую
  if (typeof openWorkshop === 'function') {
    try { openWorkshop(); } catch (e) {}
  } else if (typeof showView === 'function') {
    showView('workshop');
  }
}

function createGameCard(game) {
  // минимальный fallback, если кто-то ещё вызовет
  const card = document.createElement('article');
  card.className = 'game-card';
  card.dataset.id = game && game.id;
  card.textContent = (game && game.title) || '';
  card.addEventListener('click', () => typeof gotoGame === 'function' && gotoGame(game.id));
  return card;
}
