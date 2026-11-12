# IndieHub (ItchioLite / CATio)

**Локальный магазин игр в духе itch.io + десктоп-клиент в духе Steam.**

Чистый стек без фреймворков: PHP + MySQL + ванильный JS/CSS + нативный C++ webview.

> Учебный / пет-проект. Внутренняя валюта, авто-миграция БД, процедурные обложки, загрузки с докачкой — всё работает из коробки на XAMPP.

---

## Что это

| Каталог (itch.io-стиль) | Библиотека (Steam-стиль) | Загрузки |
|-------------------------|--------------------------|----------|
| Карточки, жанры, покупка | Список слева + детали | Очередь, прогресс, пауза |

- **Веб** — полноценный SPA-подобный интерфейс в одном `index.php`
- **Клиент** — тонкая C++ оболочка (WebView2), которая открывает тот же UI и добавляет «нативность»
- **Мастерская** — ассеты, звуки, UI-киты
- **Профиль** — уровень, баланс, активность, друзья, уведомления

---

## Стек

| Слой | Технологии |
|------|------------|
| Frontend | HTML5, CSS3 (custom properties, grid/flex), Vanilla JS |
| Backend | PHP 8+ (без фреймворков), PDO |
| БД | MySQL / MariaDB (авто-создание таблиц + демо-данные) |
| Медиа | `media.php` — процедурные SVG-обложки/скрины **или** реальные файлы |
| Десктоп | C++ + [webview](https://github.com/webview/webview) (WebView2 на Windows) |
| Сборка клиента | MSVC / MinGW, готовый `IndieHub.exe` в репозитории |

Никаких React/Vue/Laravel/Composer. Всё читается и правится руками.

---

## Быстрый старт

### 1. XAMPP

1. Установи [XAMPP](https://www.apachefriends.org/)
2. Запусти **Apache** + **MySQL**

### 2. Веб-часть

Скопируй папку `web` в:

```
C:\xampp\htdocs\itch-steam-like\
```

Или переименуй `web` → `itch-steam-like` и положи в `htdocs`.

Открой:

```
http://localhost/itch-steam-like/
```

При первом заходе:

- создаётся БД `itch_steam_local`
- создаются все таблицы
- заливаются демо-игры, ассеты, комментарии

phpMyAdmin: `http://localhost/phpmyadmin/` → база `itch_steam_local`.

### 3. Десктоп-клиент

```bash
# просто запусти
client\IndieHub.exe
```

Клиент проверяет доступность `http://localhost/itch-steam-like/`, делает несколько попыток и только потом открывает окно. Если Apache не запущен — показывает понятный MessageBox вместо чёрного экрана.

Подробности сборки — в `client/README.md`.

---



## JS-модули (рефакторинг)

Подключаются в `index.php` в таком порядке:

```
js/icons.js      — SVG-иконки + global icon()
js/utils.js      — fetchJSON, formatters, accordion, offline, iconSvg()
js/cart.js       — корзина (localStorage)
js/home.js       — главная, сайдбар-библиотека, шапка поиска
js/store.js      — каталог
js/library.js    — библиотека
js/downloads.js  — очередь загрузок
js/app.js        — страница игры, профиль, мастерская, друзья, админка…
js/game.js, workshop.js, admin.js
js/catio_fixes.js
```

Дальше из `app.js`:
- `game.js` (страница игры)
- `profile.js`
- `workshop.js`
- `friends.js` + `messages.js` + `notifications.js`
- `admin.js`

## Структура

```
ItchioLite/
├── client/                     # Нативный клиент
│   ├── main.cpp                # WebView2 + проверка сервера
│   ├── IndieHub.exe
│   ├── icons/                  # Иконки окна
│   └── webview/                # Заголовки библиотеки
├── web/                        # Кладётся в htdocs
│   ├── index.php               # Единая точка входа (все «страницы»)
│   ├── config.php / config.ini # Настройки БД
│   ├── db.php                  # PDO + миграции + сиды
│   ├── auth.php                # Сессии, CSRF, кука catio_sid
│   ├── media.php               # Обложки / баннеры / скрины (файл или SVG)
│   ├── api/                    # REST-подобные эндпоинты
│   │   ├── auth.php
│   │   ├── games.php           # Каталог, покупки, комментарии, скачивания
│   │   ├── user.php
│   │   ├── workshop.php
│   │   ├── friends.php
│   │   ├── messages.php
│   │   └── ...
│   ├── assets/
│   │   └── icons/              # ★ SVG-иконки (файлы) + helper
│   │       ├── home.svg
│   │       ├── store.svg
│   │       ├── icon.php        # <?= icon('home', 18) ?>
│   │       └── ...
│   ├── css/style.css
│   ├── js/app.js               # Основная логика UI
│   └── files/                  # Сгенерированные демо-сборки
├── database/schema.sql         # На всякий случай
└── README.md
```

---

## Основные фичи

### Каталог и магазин
- Карточки в стиле itch.io
- Поиск, жанры, сортировка
- Бесплатно → «В библиотеку», платно → «Купить» (внутренний баланс)
- Страница игры: галерея, описание, теги, сборки, рейтинг, комментарии

### Библиотека (особенно в клиенте)
- Левая колонка + детали справа (как Steam)
- Фильтры, поиск, «только установленные»
- Запуск игр из клиента

### Загрузки
- Очередь
- Живой прогресс + скорость
- Пауза / возобновление с **HTTP Range** (докачка)
- История

### Профиль и социальное
- Уровень, статистика, недавняя активность
- Баланс + пополнение (учебные рубли)
- Друзья, уведомления, сообщения
- Настройки аватара

### Мастерская
- Ассет-паки, звуки, UI-киты, инструменты
- Тот же механизм карточек и покупок

### Технические плюшки
- Авто-миграция таблиц при первом запуске
- CSRF + серверные сессии
- Процедурные SVG-обложки и скриншоты (когда нет реальных картинок)
- Импорт из Steam (есть инструменты)
- Чистый код без внешних зависимостей frontend/backend

---

## Иконки (рефакторинг SVG)

Раньше почти все иконки были **захардкожены inline** в `index.php` и `app.js` (100+ штук).

Теперь:

1. SVG лежат файлами в `web/assets/icons/`
2. Есть PHP-хелпер `icon()`:

```php
<?php require_once __DIR__ . '/assets/icons/icon.php'; ?>

<!-- Было -->
<svg width="18" height="18" viewBox="0 0 24 24" ...>...</svg>

<!-- Стало -->
<?= icon('home', 18, 'side-ico') ?>
<?= icon('downloads', 16) ?>
<?= icon('user', 16, 'menu-ico') ?>
```

Хелпер:
- читает файл один раз (кэш в static)
- убирает фиксированные width/height
- подставляет нужный размер и class
- сохраняет `stroke="currentColor"` → цвет берётся из CSS

Пример замены в сайдбаре:

```php
<button class="nav-btn side-btn" data-view="home">
  <span class="side-ico"><?= icon('home', 18) ?></span>
  Главная
</button>
```

В JS можно либо:
- оставить inline для динамически создаваемых элементов, либо
- подгружать SVG через `fetch` / `innerHTML` из тех же файлов, либо
- использовать CSS `mask-image: url(assets/icons/home.svg)`.

**Рекомендация:** постепенно выносить все повторяющиеся иконки в `assets/icons/` и заменять через `icon()`. Процедурные обложки в `media.php` оставить как есть (они генерируются на лету и зависят от цвета/эмодзи игры).

---

## Примеры из кода

### Подключение к БД + авто-миграция

```php
// db.php (упрощённо)
function getDB(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    // ... читаем config.ini ...
    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    migrate($pdo);   // CREATE TABLE IF NOT EXISTS ...
    seedDemo($pdo);  // если таблица games пустая
    return $pdo;
}
```

### API каталога

```php
// api/games.php
$games = $pdo->query("
    SELECT g.*, 
           (SELECT COUNT(*) FROM library l WHERE l.game_id = g.id) AS players_count
    FROM games g
    WHERE g.is_published = 1
    ORDER BY g.created_at DESC
")->fetchAll();

foreach ($games as &$g) {
    $g = attachUserState($pdo, $g, $currentUser); // in_library, owned, rating...
}
echo json_encode(['ok' => true, 'games' => $games]);
```

### Процедурная обложка

```
GET media.php?type=cover&id=42
```

Если есть `covers/cover_42.jpg` — отдаёт файл.  
Иначе рисует SVG с градиентом, эмодзи и названием игры.

### Клиент (C++)

```cpp
// main.cpp — проверка сервера перед показом окна
bool serverOk = false;
for (int i = 0; i < 3; ++i) {
    if (httpReachable("http://localhost/itch-steam-like/")) {
        serverOk = true;
        break;
    }
    Sleep(800);
}
if (!serverOk) {
    MessageBoxW(nullptr, L"Запусти XAMPP (Apache + MySQL)...", L"IndieHub", MB_ICONERROR);
    return 1;
}
// дальше — webview
```

---

## Что дальше можно сделать

- [ ] Полностью вынести все inline-SVG в `assets/icons/`
- [ ] Разбить `index.php` / `app.js` / `style.css` на модули (сейчас монолиты ~3k / 16k / 18k строк)
- [ ] Настоящая загрузка своих игр в Мастерскую
- [ ] Веб-сборки (запуск прямо в браузере)
- [ ] Тёмная / светлая тема
- [ ] Промокоды, возвраты
- [ ] Linux/macOS клиент (webview уже кроссплатформенный)

---

## Лицензия / заметки

Сделано максимально просто и понятно.  
Можно спокойно развивать, ломать и чинить.

Если находишь баги или хочешь добавить фичу — форкай и экспериментируй.

---

**IndieHub** · локальный itch + Steam в одном флаконе.
