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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_email (email),
            INDEX idx_username (username)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Сессии
        // ВАЖНО: expires_at — TIMESTAMP NULL. Явный NOT NULL без DEFAULT даёт
        // неявный дефолт '0000-00-00 00:00:00', который запрещён NO_ZERO_DATE (ERROR 1067).
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

        // Игры
        $pdo->exec("CREATE TABLE IF NOT EXISTS games (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            slug VARCHAR(255) NOT NULL DEFAULT '',
            short_description VARCHAR(512) DEFAULT NULL,
            description TEXT,
            developer VARCHAR(255) NOT NULL DEFAULT '',
            developer_name VARCHAR(128) DEFAULT NULL,
            price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            genre VARCHAR(100) NOT NULL DEFAULT '',
            tags VARCHAR(512) DEFAULT NULL,
            cover VARCHAR(255) NOT NULL DEFAULT '',
            cover_url VARCHAR(512) DEFAULT NULL,
            rating DECIMAL(3,1) NOT NULL DEFAULT 0.0,
            download_count INT UNSIGNED NOT NULL DEFAULT 0,
            is_published TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_genre (genre),
            INDEX idx_price (price),
            INDEX idx_published (is_published)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Авто-миграция: если таблица games уже существовала в старой схеме —
        // доводим её до актуального набора колонок
        ensureColumn($pdo, 'games', 'slug', "VARCHAR(255) NOT NULL DEFAULT ''");
        ensureColumn($pdo, 'games', 'short_description', "VARCHAR(512) DEFAULT NULL");
        ensureColumn($pdo, 'games', 'developer_name', "VARCHAR(128) DEFAULT NULL");
        ensureColumn($pdo, 'games', 'tags', "VARCHAR(512) DEFAULT NULL");
        ensureColumn($pdo, 'games', 'cover_url', "VARCHAR(512) DEFAULT NULL");
        ensureColumn($pdo, 'games', 'download_count', "INT UNSIGNED NOT NULL DEFAULT 0");
        ensureColumn($pdo, 'games', 'is_published', "TINYINT(1) NOT NULL DEFAULT 1");
        ensureColumn($pdo, 'games', 'updated_at', "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");

        // Библиотека пользователя
        $pdo->exec("CREATE TABLE IF NOT EXISTS library (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id INT UNSIGNED NOT NULL,
            game_id INT UNSIGNED NOT NULL,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_user_game (user_id, game_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
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

        // === ДЕМО-ДАННЫЕ ===

        // Демо-игры если таблица пустая
        $stmt = $pdo->query("SELECT COUNT(*) as cnt FROM games");
        if ($stmt->fetch()['cnt'] == 0) {
            $demoGames = [
                ['Лисий фонарь', 'lisiy-fonar', 'Ночной платформер про лисёнка с бумажным фонарём.', 'Ночной платформер про лисёнка с бумажным фонарём. Свет держится, только пока вы идёте, а лес запоминает, где вы уже были.', 'mast', 0.00, 'Платформер', 'платформер,инди,пиксель', 5.0],
                ['Тихий мох', 'tihiy-moh', 'Медитативная головоломка о лесном духе.', 'Медитативная головоломка о лесном духе. Растите мох, решайте загадки тишины.', 'daria', 199.00, 'Головоломка', 'головоломка,медитативная', 4.5],
                ['Северный ветер', 'severniy-veter', 'Приключение в заснеженной деревне.', 'Приключение в заснеженной деревне. Тепло здесь решает всё.', 'ivan', 349.00, 'Приключение', 'приключение,сюжет', 4.0],
                ['Ржавые шестерни', 'rzhavye-shester', 'Рогалик в стимпанк-городе.', 'Рогалик в стимпанк-городе. Город дышит механизмами — не попади между шестернями.', 'gears', 499.00, 'Рогалик', 'рогалик,стимпанк', 4.8],
                ['Бумажный дом', 'bumazhniy-dom', 'Визуальная новелла о семейной тайне.', 'Визуальная новелла о семейной тайне. Каждый выбор складывает дом из бумаги.', 'paper', 149.00, 'Визуальная новелла', 'визуальная новелла,сюжет', 4.2],
                ['Аркада 1997', 'arkada-1997', 'Ретро-аркада с пиксельной графикой.', 'Ретро-аркада с пиксельной графикой. Как в ларьке у дома, только без жвачки.', 'retro', 0.00, 'Аркада', 'аркада,ретро', 3.9],
            ];
            $stmt = $pdo->prepare("INSERT INTO games
                (title, slug, short_description, description, developer, price, genre, tags, rating)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
            foreach ($demoGames as $g) {
                $stmt->execute($g);
            }
        }

        // Демо-сборки: по одной Windows-сборке на каждую игру
        $stmt = $pdo->query("SELECT COUNT(*) as cnt FROM game_builds");
        if ($stmt->fetch()['cnt'] == 0) {
            $games = $pdo->query("SELECT id, slug FROM games")->fetchAll();
            $ins = $pdo->prepare("INSERT INTO game_builds (game_id, platform, version, file_url, file_size_bytes)
                VALUES (?, 'windows', '1.0', ?, 0)");
            foreach ($games as $g) {
                $ins->execute([$g['id'], 'files/' . $g['slug'] . '-v1.0-windows.zip']);
            }
        }

        return $pdo;
    } catch (PDOException $e) {
        die(json_encode(['error' => 'DB connection failed: ' . $e->getMessage()]));
    }
}
