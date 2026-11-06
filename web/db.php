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
        ensureColumn($pdo, 'users', 'friend_code', "VARCHAR(8) NOT NULL DEFAULT ''");
        try {
            $pdo->exec("CREATE UNIQUE INDEX idx_users_friend_code ON users (friend_code)");
        } catch (Throwable $e) { /* already exists or empty duplicates */ }

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
        ensureColumn($pdo, 'library', 'is_liked', "TINYINT(1) NOT NULL DEFAULT 0");
        ensureColumn($pdo, 'library', 'ach_unlocked', "INT UNSIGNED NOT NULL DEFAULT 0");
        ensureColumn($pdo, 'library', 'ach_total', "INT UNSIGNED NOT NULL DEFAULT 0");
        ensureColumn($pdo, 'games', 'steam_appid', "INT UNSIGNED NULL DEFAULT NULL");
        ensureColumn($pdo, 'games', 'ach_count', "INT UNSIGNED NOT NULL DEFAULT 0");
        ensureColumn($pdo, 'games', 'logo_url', "VARCHAR(512) NULL");
        $pdo->exec("CREATE TABLE IF NOT EXISTS game_achievements (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            game_id INT UNSIGNED NOT NULL,
            api_name VARCHAR(128) NOT NULL,
            display_name VARCHAR(255) NOT NULL DEFAULT '',
            description VARCHAR(512) NOT NULL DEFAULT '',
            icon_url VARCHAR(512) NOT NULL DEFAULT '',
            icon_gray_url VARCHAR(512) NOT NULL DEFAULT '',
            percent DECIMAL(6,2) NOT NULL DEFAULT 0,
            is_hidden TINYINT(1) NOT NULL DEFAULT 0,
            sort_order INT NOT NULL DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_game_api (game_id, api_name),
            KEY idx_ga_game (game_id),
            CONSTRAINT fk_ga_game FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        try { $pdo->exec("CREATE INDEX idx_games_steam_appid ON games (steam_appid)"); } catch (Throwable $e) {}
        ensureColumn($pdo, 'library', 'liked_at', "TIMESTAMP NULL DEFAULT NULL");

        // Ban fields
        ensureColumn($pdo, 'users', 'is_banned', "TINYINT(1) NOT NULL DEFAULT 0");
        ensureColumn($pdo, 'users', 'ban_reason', "VARCHAR(512) NOT NULL DEFAULT ''");
        ensureColumn($pdo, 'users', 'banned_at', "TIMESTAMP NULL DEFAULT NULL");
        ensureColumn($pdo, 'users', 'banned_until', "TIMESTAMP NULL DEFAULT NULL");
        ensureColumn($pdo, 'users', 'banned_by', "INT UNSIGNED NULL DEFAULT NULL");
        ensureColumn($pdo, 'users', 'show_unban_notice', "TINYINT(1) NOT NULL DEFAULT 0");

        // Друзья
        $pdo->exec("CREATE TABLE IF NOT EXISTS friendships (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id INT UNSIGNED NOT NULL,
            friend_id INT UNSIGNED NOT NULL,
            status ENUM('pending','accepted','blocked') NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_pair (user_id, friend_id),
            INDEX idx_friend (friend_id),
            INDEX idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");


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
        ensureColumn($pdo, 'games', 'languages', "TEXT NULL");
        // Было VARCHAR(255) — JSON языков обрезался на середине
        try {
            $pdo->exec("ALTER TABLE `games` MODIFY COLUMN `languages` TEXT NULL");
        } catch (Throwable $e) { /* already TEXT */ }
        ensureColumn($pdo, 'games', 'review_note', "VARCHAR(512) DEFAULT NULL");
        ensureColumn($pdo, 'games', 'is_adult', "TINYINT(1) NOT NULL DEFAULT 0");

        $pdo->exec("CREATE TABLE IF NOT EXISTS game_media (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            game_id INT UNSIGNED NOT NULL,
            kind ENUM('screenshot','video') NOT NULL DEFAULT 'screenshot',
            url VARCHAR(512) NOT NULL,
            thumb_url VARCHAR(512) DEFAULT NULL,
            title VARCHAR(255) DEFAULT NULL,
            sort_order INT NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_game (game_id),
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Авто-миграция media + иконки
        ensureColumn($pdo, 'game_media', 'thumb_url', "VARCHAR(512) DEFAULT NULL");
        ensureColumn($pdo, 'game_media', 'title', "VARCHAR(255) DEFAULT NULL");
        ensureColumn($pdo, 'games', 'icon_url', "VARCHAR(512) DEFAULT NULL");
        ensureColumn($pdo, 'games', 'video_url', "VARCHAR(512) DEFAULT NULL");

        ensureColumn($pdo, 'comments', 'parent_id', "INT UNSIGNED NULL DEFAULT NULL");
        ensureColumn($pdo, 'comments', 'likes', "INT UNSIGNED NOT NULL DEFAULT 0");
        return $pdo;
    } catch (PDOException $e) {
        die(json_encode(['error' => 'DB connection failed: ' . $e->getMessage()]));
    }
}

// Пересчёт среднего рейтинга игры по таблице ratings.
// Если оценок ещё нет — rating в games не трогаем.
function recalcGameRating(PDO $pdo, int $gameId) {
    $stmt = $pdo->prepare("SELECT AVG(value) AS avg_v, COUNT(*) AS cnt FROM ratings WHERE game_id = ?");
    $stmt->execute([$gameId]);
    $row = $stmt->fetch();
    if ($row && (int)$row['cnt'] > 0) {
        $pdo->prepare("UPDATE games SET rating = ? WHERE id = ?")
            ->execute([round((float)$row['avg_v'], 1), $gameId]);
    }
}

