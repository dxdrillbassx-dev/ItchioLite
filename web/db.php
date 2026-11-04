<?php
// CATio — подключение к БД + автосоздание таблиц
define('DB_HOST', 'localhost');
define('DB_NAME', 'itch_steam_local');
define('DB_USER', 'root');
define('DB_PASS', '');

// Добавляет колонку в таблицу, если её ещё нет (авто-миграция старых БД)
function ensureColumn(PDO $pdo, string $table, string $column, string $definition) {
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?");
    $stmt->execute([DB_NAME, $table, $column]);
    if ($stmt->fetchColumn() == 0) {
        $pdo->exec("ALTER TABLE `$table` ADD COLUMN `$column` $definition");
    }
}

function getDB() {
    static $pdo = null;
    if ($pdo) return $pdo;

    try {
        // Подключаемся без выбора БД сначала
        $pdo = new PDO(
            'mysql:host=' . DB_HOST . ';charset=utf8mb4',
            DB_USER, DB_PASS,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]
        );

        // Создаём БД если нет
        $pdo->exec("CREATE DATABASE IF NOT EXISTS `" . DB_NAME . "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
        $pdo->exec("USE `" . DB_NAME . "`");

        // === АВТОСОЗДАНИЕ ТАБЛИЦ ===

        // Пользователи
        $pdo->exec("CREATE TABLE IF NOT EXISTS users (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(32) NOT NULL UNIQUE,
            email VARCHAR(255) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            role ENUM('admin','developer','user') NOT NULL DEFAULT 'user',
            balance INT NOT NULL DEFAULT 0,
            avatar VARCHAR(10) NOT NULL DEFAULT '',
            avatar_color VARCHAR(7) NOT NULL DEFAULT '#ef5b2c',
            banner_url VARCHAR(512) NOT NULL DEFAULT '',
            karma INT NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_email (email),
            INDEX idx_username (username)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Авто-миграция новых полей профиля
        ensureColumn($pdo, 'users', 'banner_url', "VARCHAR(512) NOT NULL DEFAULT ''");
        ensureColumn($pdo, 'users', 'karma', "INT NOT NULL DEFAULT 0");
        ensureColumn($pdo, 'users', 'avatar_url', "VARCHAR(512) NOT NULL DEFAULT ''");
        ensureColumn($pdo, 'users', 'banner_pos', "VARCHAR(32) NOT NULL DEFAULT '50% 50%'");
        ensureColumn($pdo, 'users', 'banner_zoom', "DECIMAL(4,2) NOT NULL DEFAULT 1.00");

        // Сессии
        // ВАЖНО: expires_at — TIMESTAMP NULL. Явный NOT NULL без DEFAULT даёт
        // неявный дефолт '0000-00-00 00:00:00', который запрещён NO_ZERO_DATE (ERROR 1067).
        $createSessions = function () use ($pdo) {
            $pdo->exec("CREATE TABLE IF NOT EXISTS sessions (
                id VARCHAR(64) PRIMARY KEY,
                user_id INT UNSIGNED NOT NULL,
                ip VARCHAR(45) NOT NULL,
                user_agent VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NULL DEFAULT NULL,
                INDEX idx_user_id (user_id),
                INDEX idx_expires (expires_at),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        };
        $createSessions();

        // Если таблица досталась от старой схемы и id не VARCHAR(64) — токен сессии
        // записывается обрезанным/не тем, и вход «не держится»: кука есть, а строки в базе нет.
        // Пересоздаём таблицу (сессии — расходник, всех просто разлогинит).
        $idCol = $pdo->query("SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'id'")->fetch();
        if ($idCol && !(strtolower($idCol['DATA_TYPE']) === 'varchar' && (int)$idCol['CHARACTER_MAXIMUM_LENGTH'] === 64)) {
            $pdo->exec("DROP TABLE sessions");
            $createSessions();
        }

        // Игры и ассет-паки (category: game | asset)
        $pdo->exec("CREATE TABLE IF NOT EXISTS games (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            slug VARCHAR(255) NOT NULL DEFAULT '',
            short_description VARCHAR(512) DEFAULT NULL,
            description TEXT,
            developer VARCHAR(255) NOT NULL DEFAULT '',
            developer_name VARCHAR(128) DEFAULT NULL,
            price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            category ENUM('game','asset') NOT NULL DEFAULT 'game',
            genre VARCHAR(100) NOT NULL DEFAULT '',
            tags VARCHAR(512) DEFAULT NULL,
            cover VARCHAR(255) NOT NULL DEFAULT '',
            cover_url VARCHAR(512) DEFAULT NULL,
            cover_emoji VARCHAR(8) NOT NULL DEFAULT '🎮',
            cover_color VARCHAR(7) NOT NULL DEFAULT '#ef5b2c',
            rating DECIMAL(3,1) NOT NULL DEFAULT 0.0,
            download_count INT UNSIGNED NOT NULL DEFAULT 0,
            is_published TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_genre (genre),
            INDEX idx_price (price),
            INDEX idx_category (category),
            INDEX idx_published (is_published)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Авто-миграция: если таблица users уже существовала в старой схеме
        // (например, из database/schema.sql) — доводим её до актуального набора колонок.
        ensureColumn($pdo, 'users', 'role', "ENUM('admin','developer','user') NOT NULL DEFAULT 'user'");
        ensureColumn($pdo, 'users', 'balance', "INT NOT NULL DEFAULT 0");
        ensureColumn($pdo, 'users', 'avatar', "VARCHAR(10) NOT NULL DEFAULT ''");
        ensureColumn($pdo, 'users', 'avatar_color', "VARCHAR(7) NOT NULL DEFAULT '#ef5b2c'");

        // Сессии: в старой схеме таблицы не было вообще — CREATE выше создаст новую.
        ensureColumn($pdo, 'sessions', 'ip', "VARCHAR(45) NOT NULL DEFAULT ''");
        ensureColumn($pdo, 'sessions', 'user_agent', "VARCHAR(255) NOT NULL DEFAULT ''");
        ensureColumn($pdo, 'sessions', 'expires_at', "TIMESTAMP NULL DEFAULT NULL");

        // Авто-миграция games
        ensureColumn($pdo, 'games', 'slug', "VARCHAR(255) NOT NULL DEFAULT ''");
        ensureColumn($pdo, 'games', 'short_description', "VARCHAR(512) DEFAULT NULL");
        ensureColumn($pdo, 'games', 'developer_name', "VARCHAR(128) DEFAULT NULL");
        ensureColumn($pdo, 'games', 'category', "ENUM('game','asset') NOT NULL DEFAULT 'game'");
        ensureColumn($pdo, 'games', 'tags', "VARCHAR(512) DEFAULT NULL");
        ensureColumn($pdo, 'games', 'cover_url', "VARCHAR(512) DEFAULT NULL");
        ensureColumn($pdo, 'games', 'cover_emoji', "VARCHAR(8) NOT NULL DEFAULT '🎮'");
        ensureColumn($pdo, 'games', 'cover_color', "VARCHAR(7) NOT NULL DEFAULT '#ef5b2c'");
        ensureColumn($pdo, 'games', 'download_count', "INT UNSIGNED NOT NULL DEFAULT 0");
        ensureColumn($pdo, 'games', 'is_published', "TINYINT(1) NOT NULL DEFAULT 1");
        ensureColumn($pdo, 'games', 'updated_at', "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");

        // Библиотека пользователя (купленные/полученные игры и ассеты)
        $pdo->exec("CREATE TABLE IF NOT EXISTS library (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id INT UNSIGNED NOT NULL,
            game_id INT UNSIGNED NOT NULL,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_played TIMESTAMP NULL DEFAULT NULL,
            playtime_minutes INT UNSIGNED NOT NULL DEFAULT 0,
            is_pinned TINYINT(1) NOT NULL DEFAULT 0,
            pinned_order INT NOT NULL DEFAULT 0,
            UNIQUE KEY uniq_user_game (user_id, game_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        ensureColumn($pdo, 'library', 'last_played', "TIMESTAMP NULL DEFAULT NULL");
        ensureColumn($pdo, 'library', 'playtime_minutes', "INT UNSIGNED NOT NULL DEFAULT 0");
        ensureColumn($pdo, 'library', 'is_pinned', "TINYINT(1) NOT NULL DEFAULT 0");
        
        ensureColumn($pdo, 'library', 'pinned_order', "INT NOT NULL DEFAULT 0");

        // Демо: если у всех игр playtime = 0 — раздаём случайное время для красоты профиля
        try {
            $zero = (int)$pdo->query("SELECT COUNT(*) FROM library WHERE playtime_minutes > 0")->fetchColumn();
            $total = (int)$pdo->query("SELECT COUNT(*) FROM library")->fetchColumn();
            if ($total > 0 && $zero === 0) {
                $rows = $pdo->query("SELECT id FROM library")->fetchAll();
                $upd = $pdo->prepare("UPDATE library SET playtime_minutes = ?, last_played = DATE_SUB(NOW(), INTERVAL FLOOR(RAND()*14) DAY) WHERE id = ?");
                foreach ($rows as $r) {
                    $mins = rand(5, 6000);
                    $upd->execute([$mins, $r['id']]);
                }
                // Закрепим первую игру
                $first = $pdo->query("SELECT id FROM library ORDER BY id ASC LIMIT 1")->fetchColumn();
                if ($first) {
                    $pdo->prepare("UPDATE library SET is_pinned = 1, pinned_order = 1 WHERE id = ?")->execute([$first]);
                }
            }
        } catch (Throwable $e) { /* ignore */ }


        // Сборки игр (файлы для скачивания)
        $pdo->exec("CREATE TABLE IF NOT EXISTS game_builds (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            game_id INT UNSIGNED NOT NULL,
            platform ENUM('windows','linux','mac','web') NOT NULL DEFAULT 'windows',
            version VARCHAR(32) NOT NULL DEFAULT '1.0',
            file_url VARCHAR(512) NOT NULL,
            file_size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_game (game_id),
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Скриншоты к страницам игр (как на itch.io)
        $pdo->exec("CREATE TABLE IF NOT EXISTS game_screenshots (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            game_id INT UNSIGNED NOT NULL,
            image_url VARCHAR(512) NOT NULL,
            sort INT NOT NULL DEFAULT 0,
            INDEX idx_game (game_id),
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Комментарии к играм
        $pdo->exec("CREATE TABLE IF NOT EXISTS comments (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            game_id INT UNSIGNED NOT NULL,
            user_id INT UNSIGNED NOT NULL,
            body TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_game (game_id),
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Оценки игр (1-5, одна на пользователя)
        $pdo->exec("CREATE TABLE IF NOT EXISTS ratings (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id INT UNSIGNED NOT NULL,
            game_id INT UNSIGNED NOT NULL,
            value TINYINT UNSIGNED NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_user_game (user_id, game_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Покупки (история: сколько и когда заплатил)
        $pdo->exec("CREATE TABLE IF NOT EXISTS purchases (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id INT UNSIGNED NOT NULL,
            game_id INT UNSIGNED NOT NULL,
            price_paid DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_user (user_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // === ДЕМО-ДАННЫЕ ===
        seedDemoData($pdo);


        // Друзья
        $pdo->exec("CREATE TABLE IF NOT EXISTS friendships (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id INT UNSIGNED NOT NULL,
            friend_id INT UNSIGNED NOT NULL,
            status ENUM('pending','accepted','blocked') NOT NULL DEFAULT 'pending',
            requested_by INT UNSIGNED NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_pair (user_id, friend_id),
            INDEX idx_friend (friend_id),
            INDEX idx_status (status),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        ensureColumn($pdo, 'users', 'last_seen', "TIMESTAMP NULL DEFAULT NULL");
        ensureColumn($pdo, 'users', 'is_online', "TINYINT(1) NOT NULL DEFAULT 0");


        // Личные сообщения (только между друзьями)
        $pdo->exec("CREATE TABLE IF NOT EXISTS messages (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            sender_id INT UNSIGNED NOT NULL,
            receiver_id INT UNSIGNED NOT NULL,
            body TEXT NOT NULL,
            is_read TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_pair (sender_id, receiver_id),
            INDEX idx_receiver (receiver_id, is_read),
            INDEX idx_created (created_at),
            FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");


        // Уведомления
        $pdo->exec("CREATE TABLE IF NOT EXISTS notifications (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id INT UNSIGNED NOT NULL,
            type VARCHAR(32) NOT NULL,
            title VARCHAR(255) NOT NULL DEFAULT '',
            body VARCHAR(512) NOT NULL DEFAULT '',
            meta_json TEXT NULL,
            is_read TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_user_read (user_id, is_read),
            INDEX idx_created (created_at),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        ensureColumn($pdo, 'users', 'lang', "VARCHAR(8) NOT NULL DEFAULT 'ru'");
        ensureColumn($pdo, 'users', 'profile_visibility', "ENUM('public','friends','hidden') NOT NULL DEFAULT 'public'");
        ensureColumn($pdo, 'users', 'media_visibility', "ENUM('public','friends','hidden') NOT NULL DEFAULT 'public'");
        ensureColumn($pdo, 'users', 'allow_friend_requests', "TINYINT(1) NOT NULL DEFAULT 1");
        ensureColumn($pdo, 'users', 'notif_prefs', "TEXT NULL");


        // Модерация и расширенные поля игры
        ensureColumn($pdo, 'games', 'status', "ENUM('draft','pending','published','rejected') NOT NULL DEFAULT 'published'");
        ensureColumn($pdo, 'games', 'submitted_by', "INT UNSIGNED NULL DEFAULT NULL");
        ensureColumn($pdo, 'games', 'banner_url', "VARCHAR(512) DEFAULT NULL");
        ensureColumn($pdo, 'games', 'video_url', "VARCHAR(512) DEFAULT NULL");
        ensureColumn($pdo, 'games', 'sys_req_min', "TEXT NULL");
        ensureColumn($pdo, 'games', 'sys_req_rec', "TEXT NULL");
        ensureColumn($pdo, 'games', 'controllers', "VARCHAR(64) NOT NULL DEFAULT ''");
        ensureColumn($pdo, 'games', 'languages', "VARCHAR(255) NOT NULL DEFAULT ''");
        ensureColumn($pdo, 'games', 'review_note', "VARCHAR(512) DEFAULT NULL");
        ensureColumn($pdo, 'games', 'is_adult', "TINYINT(1) NOT NULL DEFAULT 0");

        $pdo->exec("CREATE TABLE IF NOT EXISTS game_media (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            game_id INT UNSIGNED NOT NULL,
            kind ENUM('screenshot','video') NOT NULL DEFAULT 'screenshot',
            url VARCHAR(512) NOT NULL,
            sort_order INT NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_game (game_id),
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        ensureColumn($pdo, 'comments', 'parent_id', "INT UNSIGNED NULL DEFAULT NULL");
        ensureColumn($pdo, 'comments', 'likes', "INT UNSIGNED NOT NULL DEFAULT 0");
        return $pdo;
    } catch (PDOException $e) {
        die(json_encode(['error' => 'DB connection failed: ' . $e->getMessage()]));
    }
}

// Пересчёт среднего рейтинга игры по таблице ratings.
// Если оценок ещё нет — демо-значение в games.rating не трогаем.
function recalcGameRating(PDO $pdo, int $gameId) {
    $stmt = $pdo->prepare("SELECT AVG(value) AS avg_v, COUNT(*) AS cnt FROM ratings WHERE game_id = ?");
    $stmt->execute([$gameId]);
    $row = $stmt->fetch();
    if ($row && (int)$row['cnt'] > 0) {
        $pdo->prepare("UPDATE games SET rating = ? WHERE id = ?")
            ->execute([round((float)$row['avg_v'], 1), $gameId]);
    }
}

function seedDemoData(PDO $pdo) {
    // Демо-игры и ассеты, если таблица пустая
    $stmt = $pdo->query("SELECT COUNT(*) as cnt FROM games");
    if ($stmt->fetch()['cnt'] == 0) {
        $demoGames = [
            // title, slug, short, description, developer, price, category, genre, tags, rating, emoji, color
            ['Лисий фонарь', 'lisiy-fonar', 'Ночной платформер про лисёнка с бумажным фонарём.', "Ночной платформер про лисёнка с бумажным фонарём.\n\nСвет держится, только пока вы идёте, а лес запоминает, где вы уже были. 12 ручных уровней, тёплый чиптюн и ни одного таймера на экране.\n\nУправление: стрелки + Shift. Есть поддержка геймпада.", 'mast', 0.00, 'game', 'Платформер', 'платформер,инди,пиксель', 5.0, '🦊', '#ef5b2c'],
            ['Тихий мох', 'tihiy-moh', 'Медитативная головоломка о лесном духе.', "Медитативная головоломка о лесном духе.\n\nРастите мох по старым камням, решайте загадки тишины. Никто никуда не торопится: 40 полян, дождь по расписанию и совы, которые просто наблюдают.", 'daria', 199.00, 'game', 'Головоломка', 'головоломка,медитативная', 4.5, '🌿', '#3e7d4e'],
            ['Северный ветер', 'severniy-veter', 'Приключение в заснеженной деревне.', "Приключение в заснеженной деревне.\n\nТепло здесь решает всё: тащите угли, чините печи и не дайте метели закрыть последнюю дверь. Сюжет на 4 часа, три концовки.", 'ivan', 349.00, 'game', 'Приключение', 'приключение,сюжет', 4.0, '❄️', '#4a7ba6'],
            ['Ржавые шестерни', 'rzhavye-shester', 'Рогалик в стимпанк-городе.', "Рогалик в стимпанк-городе.\n\nГород дышит механизмами — не попади между шестернями. Каждый забег пересобирает районы: 80+ деталей, 14 противников и босс-часовщик.", 'gears', 499.00, 'game', 'Рогалик', 'рогалик,стимпанк', 4.8, '⚙️', '#b8860b'],
            ['Бумажный дом', 'bumazhniy-dom', 'Визуальная новелла о семейной тайне.', "Визуальная новелла о семейной тайне.\n\nКаждый выбор складывает дом из бумаги — а разворачивает его уже не вы. 60 000 слов, живая ручная анимация, тёплый финал не гарантирован.", 'paper', 149.00, 'game', 'Визуальная новелла', 'визуальная новелла,сюжет', 4.2, '🏠', '#c05a8a'],
            ['Аркада 1997', 'arkada-1997', 'Ретро-аркада с пиксельной графикой.', "Ретро-аркада с пиксельной графикой.\n\nКак в ларьке у дома, только без жвачки. Один кредит, одна жизнь, таблица рекордов на весь подъезд.", 'retro', 0.00, 'game', 'Аркада', 'аркада,ретро', 3.9, '👾', '#6b4fbb'],
            // === АССЕТ-ПАКИ ===
            ['Пиксель-пак: Лес', 'pixel-pack-les', '240 спрайтов леса: деревья, кусты, грибы, тропы.', "240 спрайтов леса в двух размерах (16px и 32px).\n\nДеревья, кусты, грибы, тропы, опавшая листва и анимированные ветки. Лицензия CC0 — можно в коммерческие проекты без указания автора.", 'mast', 0.00, 'asset', 'Ассет', 'спрайты,пиксель-арт,2d', 4.7, '🌲', '#3e7d4e'],
            ['8-бит звуковой пак', '8bit-sfx', '180 ретро-звуков: прыжки, монетки, взрывы, UI.', "180 ретро-звуков в WAV и OGG.\n\nПрыжки, монетки, взрывы, шаги, открытие дверей и 20 коротких фанфар. Всё сделано на чипе, всё чисто отрендерено.", 'retro', 99.00, 'asset', 'Ассет', 'звук,sfx,8bit', 4.4, '🔊', '#ef5b2c'],
            ['UI-кит «Кот»', 'ui-kit-cat', 'Кнопки, панели и иконки в тёмной теме CATio.', "Набор интерфейса в тёмной теме CATio.\n\nКнопки, панели, ползунки, чекбоксы и 60 иконок в PNG + SVG. Есть 9-patch для растягивания панелей без швов.", 'daria', 149.00, 'asset', 'Ассет', 'ui,интерфейс,иконки', 4.9, '🐈', '#c05a8a'],
            ['Тайлсет «Подземелье»', 'tileset-dungeon', 'Полный тайлсет подземелья: стены, полы, ловушки.', "Полный тайлсет подземелья 32px.\n\nСтены, полы, лестницы, ловушки, факелы с анимацией и декоративные черепа. Автотайлинг из коробки для Tiled и Godot.", 'gears', 0.00, 'asset', 'Ассет', 'тайлсет,подземелье,roguelike', 4.6, '🧱', '#b8860b'],
            ['Chiptune-мелодии', 'chiptune-pack', '12 зацикленных чиптюн-треков для игр.', "12 зацикленных чиптюн-треков (от 40 секунд до 3 минут).\n\nБоевые, тёплые, тревожные и один совершенно необязательный трек про кота. WAV + OGG + исходники в Furnace.", 'ivan', 199.00, 'asset', 'Ассет', 'музыка,chiptune,саундтрек', 4.8, '🎵', '#4a7ba6'],
        ];
        $stmt = $pdo->prepare("INSERT INTO games
            (title, slug, short_description, description, developer, developer_name, price, category, genre, tags, rating, cover_emoji, cover_color)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        foreach ($demoGames as $g) {
            $stmt->execute([$g[0], $g[1], $g[2], $g[3], $g[4], $g[4], $g[5], $g[6], $g[7], $g[8], $g[9], $g[10], $g[11]]);
        }
    }

    // Демо-сборки: игры — Windows/Linux/macOS, ассеты — один zip-пакет.
    // Файлы не лежат в репозитории: api/games.php?action=download сгенерирует их
    // в web/files/ при первом скачивании.
    $stmt = $pdo->query("SELECT COUNT(*) as cnt FROM game_builds");
    if ($stmt->fetch()['cnt'] == 0) {
        $games = $pdo->query("SELECT id, slug, category FROM games")->fetchAll();
        $ins = $pdo->prepare("INSERT INTO game_builds (game_id, platform, version, file_url, file_size_bytes)
            VALUES (?, ?, '1.0', ?, 0)");
        foreach ($games as $g) {
            if ($g['category'] === 'asset') {
                $ins->execute([$g['id'], 'windows', 'files/' . $g['slug'] . '-v1.0-pack.zip']);
            } else {
                foreach (['windows', 'linux', 'mac'] as $platform) {
                    $ins->execute([$g['id'], $platform, 'files/' . $g['slug'] . '-v1.0-' . $platform . '.zip']);
                }
            }
        }
    }

    // Скриншоты к каждой игре: генерируются media.php на лету
    $stmt = $pdo->query("SELECT COUNT(*) as cnt FROM game_screenshots");
    if ($stmt->fetch()['cnt'] == 0) {
        $games = $pdo->query("SELECT id FROM games")->fetchAll();
        $ins = $pdo->prepare("INSERT INTO game_screenshots (game_id, image_url, sort) VALUES (?, ?, ?)");
        foreach ($games as $g) {
            for ($i = 1; $i <= 4; $i++) {
                $ins->execute([$g['id'], 'media.php?type=shot&id=' . $g['id'] . '&i=' . $i, $i]);
            }
        }
    }

    // Демо-пользователи (войти под них нельзя: хэш пароля намеренно битый).
    // Нужны, чтобы на страницах игр сразу жили комментарии.
    $insUser = $pdo->prepare("INSERT IGNORE INTO users (username, email, password_hash, role, balance, avatar, avatar_color)
        VALUES (?, ?, '!locked', 'user', 0, ?, ?)");
    $insUser->execute(['catio_cat', 'cat@catio.local', '🐱', '#ef5b2c']);
    $insUser->execute(['pixel_fox', 'fox@catio.local', '🦊', '#3e7d4e']);
    $insUser->execute(['night_owl', 'owl@catio.local', '🦉', '#4a7ba6']);

    // Демо-комментарии
    $stmt = $pdo->query("SELECT COUNT(*) as cnt FROM comments");
    if ($stmt->fetch()['cnt'] == 0) {
        $uid = [];
        foreach ($pdo->query("SELECT id, username FROM users WHERE email LIKE '%@catio.local'")->fetchAll() as $u) {
            $uid[$u['username']] = (int)$u['id'];
        }
        $gid = [];
        foreach ($pdo->query("SELECT id, slug FROM games")->fetchAll() as $g) {
            $gid[$g['slug']] = (int)$g['id'];
        }
        $demoComments = [
            ['lisiy-fonar', 'pixel_fox', 'Прошёл за один вечер, фонарь до сих пор светит в голове. Уровень с туманом — лучшее, что я видел в пикселе.'],
            ['lisiy-fonar', 'night_owl', 'Коротко, тепло и честно. Бесплатно — вообще даром, автору бы донат-кнопку.'],
            ['lisiy-fonar', 'catio_cat', 'Мяу. То есть: отличная инерция прыжка, редко такое встретишь.'],
            ['tihiy-moh', 'catio_cat', 'Засыпаю под эти звуки дождя. Головоломки честные, без догадываний наугад.'],
            ['severniy-veter', 'pixel_fox', 'Метель на третьем часу напугала меня по-настоящему. Три концовки выбил все.'],
            ['rzhavye-shester', 'night_owl', 'Босс-часовщик съел у меня двенадцать забегов. Вернусь ещё.'],
            ['bumazhniy-dom', 'catio_cat', 'Плакал над бумажной кухней. Не ожидал от новеллы такого удара.'],
            ['arkada-1997', 'pixel_fox', 'Поставил рекорд 148 200. Кто перебьёт — тот красавчик.'],
            ['pixel-pack-les', 'night_owl', 'Взял для своего платформера — встало как родное, спасибо за CC0!'],
            ['ui-kit-cat', 'catio_cat', 'Иконки огонь, использую прямо в CATio-лайауте своей игры.'],
            ['chiptune-pack', 'pixel_fox', 'Трек про кота — лучший саундтрек года, не обсуждается.'],
        ];
        $ins = $pdo->prepare("INSERT INTO comments (game_id, user_id, body) VALUES (?, ?, ?)");
        foreach ($demoComments as $c) {
            if (isset($gid[$c[0]], $uid[$c[1]])) {
                $ins->execute([$gid[$c[0]], $uid[$c[1]], $c[2]]);
            }
        }
    }
}
