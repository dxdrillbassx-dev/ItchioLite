<?php
// CATio — подключение к БД + автосоздание таблиц
define('DB_HOST', 'localhost');
define('DB_NAME', 'itch_steam_local');
define('DB_USER', 'root');
define('DB_PASS', '');

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
        $pdo->exec("CREATE TABLE IF NOT EXISTS sessions (
            id VARCHAR(64) PRIMARY KEY,
            user_id INT UNSIGNED NOT NULL,
            ip VARCHAR(45) NOT NULL,
            user_agent VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP NOT NULL,
            INDEX idx_user_id (user_id),
            INDEX idx_expires (expires_at),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Игры (если нет)
        $pdo->exec("CREATE TABLE IF NOT EXISTS games (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            developer VARCHAR(255) NOT NULL DEFAULT '',
            price INT NOT NULL DEFAULT 0,
            genre VARCHAR(100) NOT NULL DEFAULT '',
            cover VARCHAR(255) NOT NULL DEFAULT '',
            rating DECIMAL(3,1) NOT NULL DEFAULT 0.0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_genre (genre),
            INDEX idx_price (price)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

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

        // Демо-игры если таблица пустая
        $stmt = $pdo->query("SELECT COUNT(*) as cnt FROM games");
        if ($stmt->fetch()['cnt'] == 0) {
            $demoGames = [
                ['Лисий фонарь', 'Ночной платформер про лисёнка с бумажным фонарём.', 'mast', 0, 'Платформер', 5.0],
                ['Тихий мох', 'Медитативная головоломка о лесном духе.', 'daria', 199, 'Головоломка', 4.5],
                ['Северный ветер', 'Приключение в заснеженной деревне.', 'ivan', 349, 'Приключение', 4.0],
                ['Ржавые шестерни', 'Рогалик в стимпанк-городе.', 'gears', 499, 'Рогалик', 4.8],
                ['Бумажный дом', 'Визуальная новелла о семейной тайне.', 'paper', 149, 'Визуальная новелла', 4.2],
                ['Аркада 1997', 'Ретро-аркада с пиксельной графикой.', 'retro', 0, 'Аркада', 3.9],
            ];
            $stmt = $pdo->prepare("INSERT INTO games (title, description, developer, price, genre, rating) VALUES (?, ?, ?, ?, ?, ?)");
            foreach ($demoGames as $g) {
                $stmt->execute($g);
            }
        }

        return $pdo;
    } catch (PDOException $e) {
        die(json_encode(['error' => 'DB connection failed: ' . $e->getMessage()]));
    }
}
