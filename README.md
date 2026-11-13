# IndieHub / ItchioLite (CATio)

Локальная платформа цифрового дистрибутива: каталог и магазин в духе **itch.io**, библиотека и клиент в духе **Steam**.

Pet / учебный проект на минимальном стеке: **PHP 8 + MySQL + vanilla JS/CSS + нативный C++ (WebView2)**. Без Composer, без React/Vue/Laravel.

Авто-миграция схемы БД, процедурные SVG-обложки, загрузки с HTTP Range (докачка), Steam-import, мастерская, друзья, уведомления, бан-система, CSP и жёсткие upload-проверки.

---

## 1. Назначение и границы

**Реализовано**

- Каталог игр и ассетов (карточки, жанры, теги, поиск, сортировка, free → «в библиотеку», paid → внутренний баланс).
- Страница игры: галерея, трейлеры (YouTube / HLS / DASH / mp4), сборки по платформам, рейтинг, комментарии, achievements (в т.ч. из Steam).
- Библиотека (Steam-layout в клиенте): pin, like, playtime, installed, фильтры платформ.
- Очередь загрузок: прогресс, скорость, пауза, **докачка через `Range`**, история, badge в сайдбаре.
- Мастерская: моды / media / assets, likes.
- Соцконтур: friend_code, заявки (pending/accepted/blocked), сообщения, уведомления.
- Профиль: аватар/баннер (pos/zoom), karma, visibility, ban / unban notice.
- Издатели и публикация (`api/publishers.php`, `api/submit.php`).
- Steam-import по appid / store URL (метаданные, скрины, трейлеры, achievements).
- Десктоп-клиент Windows: frameless chrome, tray, offline-экран, auth cover, probe сервера.

**Сознательно не входит**

- Реальные платежи, OAuth, CDN, horizontal scale, DRM сборок.
- Production-hardening «из коробки» (нужны HTTPS, ужесточение CSP, rate limit, бэкапы).

---

## 2. Стек

| Слой | Технологии |
|------|------------|
| Frontend | HTML5, CSS3 (custom properties, grid/flex), Vanilla JS (файлы-модули) |
| Backend | PHP 8+, PDO (`ERRMODE_EXCEPTION`, `EMULATE_PREPARES => false`) |
| БД | MySQL / MariaDB, utf8mb4; `CREATE IF NOT EXISTS` + `ensureColumn` |
| Медиа | `media.php` — файл с диска **или** deterministic SVG |
| Security | `includes/security.php`: CSP, finfo-upload, DOM HTML-sanitize |
| Desktop | C++ / Win32 / WebView2, WinHTTP probe, system tray |
| Обслуживание | `cron.php`, `tools/lint-php.php`, `tools/build-assets.php`, `CATioTOOL.bat` |

---

## 3. Структура

```
ItchioLite/
├── client/
│   ├── main.cpp           # Frameless launcher, tray, server probe, JS-bridge
│   ├── IndieHub.exe
│   ├── icons/
│   └── webview2/          # WebView2 SDK (extracted)
├── web/                   # → C:\xampp\htdocs\itch-steam-like\
│   ├── index.php          # Shell: auth gate, ban screen, layout, ?v=filemtime
│   ├── auth.php           # DB-sessions + cookie catio_sid, CSRF, Argon2id
│   ├── db.php             # PDO, schema, ensureColumn, recalcGameRating
│   ├── media.php          # cover | hero | icon | shot → file | SVG
│   ├── cron.php           # sessions cleanup, sess_* files, log rotate
│   ├── includes/security.php
│   ├── api/
│   │   ├── bootstrap.php  # JSON, CSRF, requireUser/Admin, exception handler
│   │   ├── games.php      # каталог, покупки, builds, download stream
│   │   ├── submit.php     # публикация
│   │   ├── steam_import.php / admin-import
│   │   ├── user.php, friends.php, messages.php, notifications.php
│   │   ├── workshop.php, publishers.php, game_pack.php, admin.php
│   ├── js/                # app, store, library, downloads, gallery, …
│   ├── css/
│   ├── assets/icons/      # SVG + icon.php helper
│   └── uploads/           # медиа с random-именами
├── database/schema.sql    # резерв
└── README.md
```

Клиент не дублирует бизнес-логику: WebView2 открывает тот же UI с `?client=1`.

---

## 4. Runtime и схема БД

При первом `getDB()`:

1. Подключение без выбора БД → `CREATE DATABASE IF NOT EXISTS itch_steam_local`.
2. `CREATE TABLE IF NOT EXISTS` для users, sessions, games, library, builds, screenshots, comments, ratings, purchases, friendships, messages, notifications, workshop_*, achievements и др.
3. `ensureColumn()` — безопасное добавление колонок к уже существующим таблицам (миграции без ручного SQL).
4. Индексы через `INFORMATION_SCHEMA.STATISTICS` (идемпотентно).
5. Сиды демо-контента при пустом каталоге (логика в `db.php` / seed-ветках).

Ключевые сущности:

- **users** — role (`admin|developer|user`), balance, avatar/banner, friend_code, ban-поля, karma, visibility.
- **sessions** — id VARCHAR(64) = токен cookie `catio_sid`, expires_at, ip, ua.
- **games** — price, category (`game|asset`), cover_*, steam_appid, is_published, tags, …
- **library** — owned, last_played, playtime_minutes, is_pinned, is_liked, achievements counters.
- **game_builds** — platform, version, file_url, size, status, changelog.
- **game_screenshots**, **comments**, **ratings**, **purchases**.
- **friendships**, **messages**, **notifications**.
- **game_achievements** + Steam-синхронизация по appid.

Первый зарегистрированный пользователь → `admin` + стартовый баланс.

---

## 5. Авторизация и CSRF

```php
// auth.php — cookie-сессия в БД
$token = bin2hex(random_bytes(32));
// INSERT INTO sessions … expires_at = NOW() + 30 days
setcookie('catio_sid', $token, [
    'httponly' => true,
    'samesite' => 'Lax',
    'secure'   => $https,
    'path'     => '/',
]);
```

- Пароли: `password_hash(..., PASSWORD_ARGON2ID)` + rehash при `password_needs_rehash`.
- CSRF: токен в PHP-сессии, проверка `hash_equals` в API (`checkCsrf` в `bootstrap.php`).
- PHP session files складываются в `web/tmp/sessions` (обход проблем XAMPP с `C:\xampp\tmp`).
- Зачистка «зомби»-cookie со старыми path/именами (`catio_session` / разные path).

---

## 6. Security

Файл `web/includes/security.php`:

| Мера | Детали |
|------|--------|
| CSP | `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`; script/style с `'unsafe-inline'` (legacy inline в shell); media/img `https:`; frame-src YouTube/Vimeo; **fonts.googleapis.com / fonts.gstatic.com** для Inter |
| Headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin` |
| Upload | `finfo` MIME → whitelist, size limit, random `bin2hex` имя, запрет php/cgi/exe-расширений |
| HTML | `catio_sanitize_html()` — DOMDocument whitelist, срез `on*`, `javascript:`, чужих iframe |
| Errors | log в `web/tmp/php-errors.log`; в prod `display_errors=0` |
| Cron | удаление просроченных sessions, старых `sess_*`, ротация огромного лога |

Пример CSP (актуальный фрагмент):

```php
$csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self'",
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
];
```

Долгосрочно Inter лучше self-host в `assets/fonts/` и убрать внешние origins из CSP.

---

## 7. Медиа

`media.php?type=cover|hero|icon|shot&id=N[&i=1]`

1. Читает game из БД (`cover_url`, `banner_url`, `icon_url`, …).
2. Если URL локальный / файл в `covers/` или `uploads/` — отдаёт с `Cache-Control` и `nosniff`.
3. Иначе рисует SVG: детерминированный PRNG (`mulberry32(crc32(...))`), градиенты, эмодзи, бейдж жанра.

Прямые пути вида `/uploads/games/shots/pack_….jpg` в HTML **нельзя полностью скрыть** от DevTools (браузер обязан знать URL). Проксирование через `media.php` убирает структуру каталогов из разметки, но не из Network tab. Signed URL + Referer-check — следующий уровень, для localhost обычно избыточен.

---

## 8. API

Общий вход: `api/bootstrap.php`

- JSON + security headers, CORS methods/headers для same-origin.
- `requireUser()` / `requireAdmin()`, `checkCsrf()`, `jsonOut()`, `jsonBody()`.
- Глобальный exception handler → `{ ok: false, error: "…" }` без HTML-мусора.

Основные эндпоинты:

| Файл | Роль |
|------|------|
| `games.php` | list / get / buy / library / rate / comment / builds / **download stream + Range** |
| `submit.php` | публикация игры/сборки/медиа |
| `user.php` | профиль, баланс, настройки, аватар |
| `friends.php` / `messages.php` / `notifications.php` | соцсеть |
| `workshop.php` | мастерская |
| `publishers.php` | издатели |
| `steam_import.php` + admin tools | импорт Steam |
| `admin.php` | админка (в т.ч. баны) |
| `game_pack.php` | пакеты/сборки |

Фронт: `fetchJSON` / `postJSON` с `AbortController` (6s / 120s для тяжёлых операций), обрезка PHP Warning перед JSON.

---

## 9. Загрузки (клиентская очередь)

`js/downloads.js`:

- Очередь + один active + paused item.
- Чтение тела через `ReadableStream` reader, накопление chunks.
- Пауза → `reader.cancel()`, сохранение offset; продолжение с заголовком **`Range: bytes=offset-`**.
- Финальный Blob → `<a download>` с нормализованным именем.
- `markInstalled` / badge / обновление кнопок на странице игры.

Серверная сторона download в `api/games.php` должна отдавать файл потоком и уважать `HTTP_RANGE` (иначе докачка не взлетит).

---

## 10. Трейлеры и 403 на HLS

В `games.php` видео нормализуются в список `{ url, format, name, thumbnail }`:

- `.m3u8` → `hls`, `.mpd` → `dash`, YouTube → `youtube`, иначе mp4.
- Дополнительно: живые Steam HLS по `steam_appid` / slug `-s{appid}`.

**403 на `hls_264_master.m3u8`** почти всегда:

- CDN режет hotlink (нужен Referer / cookie / signed token);
- ссылка протухла;
- нет CORS для MSE/hls.js с чужого origin.

Для продакшен-подобных трейлеров предпочтительны **YouTube/Vimeo embed** (уже в `frame-src`) или **свои файлы на том же origin**. Сырой Steam HLS в `<video>` / hls.js часто нестабилен.

Если «в публикации указали 3 ссылки, а на странице пусто» — проверить:

1. Что `submit` реально записал URLs в БД (поле трейлеров / media JSON).
2. Что `games.php?action=get` их возвращает в `videos`.
3. Что фронт не отфильтровал мёртвые URL (в коде есть skip «dead» / dedupe).

---

## 11. Десктоп-клиент

`client/main.cpp`:

- Frameless окно, кастомные кнопки (back/forward/refresh, секции Store/Library/…, min/max/close).
- **System tray**: крестик/минус прячут в трей; «Выйти» только из меню трея.
- WinHTTP-проверка `http://localhost/itch-steam-like/?client=1` (несколько попыток + таймер retry).
- Offline HTML через `set_html` (без сети, без meta-refresh) + мост `catioRetry()`.
- Режим full-cover: auth или offline, без табов.
- URL с `?client=1` — библиотека и chrome, завязанные на десктоп.

---

## 12. Frontend-модули

Подключение в `index.php` (версии через `filemtime`):

```
js/icons.js, utils.js, cart.js, home.js, store.js, library.js,
downloads.js, app.js, game.js, gallery.js, workshop*.js,
friends.js, messages.js, notifications.js, profile.js,
admin*.js, publishers.js, settings-ui.js, catio_fixes.js
```

`utils.js`: `fetchJSON` с таймаутом, offline-блок «Кот ушёл в запой», `gameCoverUrl()` → `media.php?type=cover&id=` fallback.

Темы: `data-theme` light/dark из `localStorage` до paint.

---

## 13. Примеры из кода

### PDO + авто-миграция колонки

```php
function ensureColumn(PDO $pdo, string $table, string $column, string $definition) {
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?");
    $stmt->execute([DB_NAME, $table, $column]);
    if ($stmt->fetchColumn() == 0) {
        $pdo->exec("ALTER TABLE `$table` ADD COLUMN `$column` $definition");
    }
}
```

### Безопасный upload

```php
$name = catio_save_upload(
    $_FILES['cover'],
    __DIR__ . '/uploads/games/covers',
    catio_upload_map('image'),
    8, // MB
    ['jpg', 'jpeg', 'png', 'webp']
);
// → "a1b2c3d4e5f60708_1730000000.jpg"
```

### Fetch с таймаутом (фронт)

```js
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
const res = await fetch(url, { ...opts, signal: ctrl.signal });
// срезаем PHP Warning HTML до первого { или [
```

### Клиент: probe сервера (идея)

```cpp
// WinHTTP GET localhost → если не 2xx, set_html(ERROR_HTML) + IDT_RETRY
// при успехе Navigate(STORE_URL), выйти из cover mode
```

### Пересчёт рейтинга

```php
function recalcGameRating(PDO $pdo, int $gameId) {
    $stmt = $pdo->prepare("SELECT AVG(value) AS avg_v, COUNT(*) AS cnt FROM ratings WHERE game_id = ?");
    $stmt->execute([$gameId]);
    $row = $stmt->fetch();
    if ($row && (int)$row['cnt'] > 0) {
        $pdo->prepare("UPDATE games SET rating = ? WHERE id = ?")
            ->execute([round((float)$row['avg_v'], 1), $gameId]);
    }
}
```

---

## 14. Обслуживание

```bash
# cron раз в час
0 * * * * php /path/to/web/cron.php

# или HTTP с секретом
# CATIO_CRON_KEY=…  →  /cron.php?key=…
```

Cron: `DELETE` просроченных sessions, unlink старых `tmp/sessions/sess_*`, ротация `php-errors.log` > 5 MB.

---

## 15. Локальный запуск (кратко)

1. XAMPP: Apache + MySQL.
2. `web/` → `htdocs/itch-steam-like/`.
3. Браузер: `http://localhost/itch-steam-like/` — при первом заходе схема и сиды.
4. Клиент: `client/IndieHub.exe` (проверяет тот же URL с `?client=1`).

Конфиг БД: `web/config.ini` / `config.php` (по умолчанию root@localhost, БД `itch_steam_local`).

---

## 16. Известные ограничения

- Пути медиа в DevTools нельзя «стереть» полностью; opaque proxy (`media.php`) — максимум для разметки.
- CSP с `'unsafe-inline'` — pragmatic из‑за inline в shell; цель — nonces.
- Внешний HLS часто 403; embed или same-origin файлы надёжнее.
- Клиент завязан на localhost XAMPP path.
- Монолиты `index.php` / крупных JS — удобны для прототипа, дальше — дробление.

---

## 17. Лицензия / статус

Открытый pet-проект для изучения, форков и экспериментов.  
Стек намеренно простой: всё можно прочитать и изменить без магии сборщиков.
```
