/* CATio — user/avatar helpers (always loaded).
 * Раньше в admin.js → при lazy admin ломался профиль (applyUserAvatarEl).
 * Depends: utils.js ($)
 */
function avatarUrlBust(url, uid) {
  if (!url) return '';
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + 'u=' + (uid || 0) + '&t=' + encodeURIComponent(String(url).slice(-12));
}

function applyUserAvatarEl(el, user) {
  if (!el || !user) return;
  if (el.id === 'avatar-btn' && el.classList.contains('side-user-btn')) {
    const inner = el.querySelector('.side-avatar') || (typeof $ === 'function' ? $('#side-avatar') : null);
    if (inner) el = inner;
    else return;
  }
  const url = user.avatar_url || '';
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
    el.style.backgroundImage = "url('" + avatarUrlBust(url, user.id) + "')";
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
  if (user.created_at) {
    const ts = new Date(user.created_at).getTime();
    if (ts && (Date.now() - ts) < 30 * 86400 * 1000) {
      return { text: 'Новичок', cls: 'is-newbie' };
    }
  }
  return { text: 'Игрок', cls: 'is-user' };
}

function setProfileRoleBadge(user) {
  let badge = typeof $ === 'function' ? $('#hp-role-badge') : document.getElementById('hp-role-badge');
  const info = (typeof $ === 'function' ? ($('#hp-user-info') || $('.hp-user-info')) : null)
    || document.getElementById('hp-user-info');
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

window.avatarUrlBust = avatarUrlBust;
window.applyUserAvatarEl = applyUserAvatarEl;
window.profileRoleLabel = profileRoleLabel;
window.setProfileRoleBadge = setProfileRoleBadge;
