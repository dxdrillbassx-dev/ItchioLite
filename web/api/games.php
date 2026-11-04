<?php
// CATio — API каталога, игр, библиотеки, покупок, комментариев и скачиваний
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . '/../auth.php';

$pdo = getDB();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? 'list';

// Любая ошибка — JSON'ом, чтобы клиент показал текст, а не молчал
set_exception_handler(function ($e) {
    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
        http_response_code(500);
    }
    echo json_encode(['ok' => false, 'error' => 'Ошибка сервера: ' . $e->getMessage()], JSON_UNESCAPED_UNICODE);
    exit;
});

// ---------- помощники ----------
function jsonBody(): array {
    $body = json_decode(file_get_contents('php://input'), true);
    return is_array($body) ? $body : $_POST;
}

function requireAuth(): array {
    $user = getCurrentUser();
    if (!$user) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'Нужно войти в аккаунт'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    return $user;
}

function checkCsrf(array $body): void {
    if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
        http_response_code(403);
        echo json_encode(['ok' => false, 'error' => 'Неверный CSRF-токен. Обнови страницу.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

function ownsGame(PDO $pdo, int $userId, int $gameId): bool {
    $stmt = $pdo->prepare("SELECT 1 FROM library WHERE user_id = ? AND game_id = ?");
    $stmt->execute([$userId, $gameId]);
    return (bool)$stmt->fetchColumn();
}

function attachUserState(PDO $pdo, array $row, ?array $user): array {
    $row['owned'] = false;
    $row['user_rating'] = null;
    if ($user) {
        $row['owned'] = ownsGame($pdo, (int)$user['id'], (int)$row['id']);
        $stmt = $pdo->prepare("SELECT value FROM ratings WHERE user_id = ? AND game_id = ?");
        $stmt->execute([(int)$user['id'], (int)$row['id']]);
        $v = $stmt->fetchColumn();
        $row['user_rating'] = $v !== false ? (int)$v : null;
    }
    return $row;
}

try {
    $user = getCurrentUser();

    // ===== КАТАЛОГ =====
    if ($method === 'GET' && $action === 'list') {
        $category = $_GET['category'] ?? 'all';
        $where = "g.is_published = 1 AND COALESCE(g.status, 'published') NOT IN ('pending','rejected','draft')";
        $params = [];
        if (in_array($category, ['game', 'asset'], true)) {
            $where .= " AND g.category = ?";
            $params[] = $category;
        }
        $stmt = $pdo->prepare("
            SELECT g.id, g.title, g.slug, g.short_description, g.description,
                   g.price, g.category, g.genre, g.tags, g.rating,
                   g.cover_url, g.cover_emoji, g.cover_color,
                   g.developer_name, g.download_count, g.created_at, g.is_adult,
                   (SELECT COUNT(*) FROM comments c WHERE c.game_id = g.id) AS comments_count,
                   (SELECT COUNT(*) FROM ratings r WHERE r.game_id = g.id) AS ratings_count
            FROM games g
            WHERE $where
            ORDER BY g.created_at DESC
        ");
        $stmt->execute($params);
        $games = $stmt->fetchAll();

        $ownedIds = [];
        if ($user) {
            $st = $pdo->prepare("SELECT game_id FROM library WHERE user_id = ?");
            $st->execute([(int)$user['id']]);
            $ownedIds = array_map('intval', array_column($st->fetchAll(), 'game_id'));
        }
        foreach ($games as &$g) {
            $g['owned'] = in_array((int)$g['id'], $ownedIds, true);
            $g['cover_src'] = !empty($g['cover_url']) ? $g['cover_url'] : ('media.php?type=cover&id=' . $g['id']);
        }
        unset($g);

        echo json_encode(['ok' => true, 'games' => $games], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // ===== СТРАНИЦА ИГРЫ (как на itch.io) =====
    if ($method === 'GET' && $action === 'get' && isset($_GET['id'])) {
        $id = (int)$_GET['id'];
        $stmt = $pdo->prepare("SELECT * FROM games WHERE id = ? AND is_published = 1 AND COALESCE(status, 'published') NOT IN ('pending','rejected','draft')");
        $stmt->execute([$id]);
        $game = $stmt->fetch();
        if (!$game) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Игра не найдена'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $game['cover_src'] = !empty($game['cover_url']) ? $game['cover_url'] : ('media.php?type=cover&id=' . $game['id']);
        // скрины из game_media
        try {
            $ms = $pdo->prepare("SELECT url FROM game_media WHERE game_id = ? AND kind = 'screenshot' ORDER BY sort_order, id");
            $ms->execute([$id]);
            $mediaUrls = array_column($ms->fetchAll(), 'url');
            if ($mediaUrls) {
                // merge with legacy screenshots below
                $GLOBALS['_game_media_shots'] = $mediaUrls;
            }
        } catch (Throwable $e) {}


        $screenshots = [];
        try {
            $stmt = $pdo->prepare("SELECT image_url FROM game_screenshots WHERE game_id = ? ORDER BY sort, id");
            $stmt->execute([$id]);
            $screenshots = array_column($stmt->fetchAll(), 'image_url');
        } catch (Throwable $e) {}
        if (!empty($GLOBALS['_game_media_shots'])) {
            $screenshots = array_values(array_unique(array_merge($GLOBALS['_game_media_shots'], $screenshots)));
            unset($GLOBALS['_game_media_shots']);
        }
        if (!$screenshots && !empty($game['cover_url'])) {
            $screenshots = [$game['cover_url']];
        }

        $stmt = $pdo->prepare("SELECT id, platform, version, file_size_bytes, created_at
            FROM game_builds WHERE game_id = ? ORDER BY platform, created_at");
        $stmt->execute([$id]);
        $builds = $stmt->fetchAll();

        $stmt = $pdo->prepare("
            SELECT c.id, c.body, c.created_at, u.username, u.avatar, u.avatar_color, u.id AS user_id
            FROM comments c JOIN users u ON u.id = c.user_id
            WHERE c.game_id = ? ORDER BY c.created_at DESC LIMIT 50
        ");
        $stmt->execute([$id]);
        $comments = $stmt->fetchAll();

        $stmt = $pdo->prepare("SELECT COUNT(*) AS cnt, AVG(value) AS avg_v FROM ratings WHERE game_id = ?");
        $stmt->execute([$id]);
        $ratingInfo = $stmt->fetch();

        $game = attachUserState($pdo, $game, $user);
        $isAdmin = $user && $user['role'] === 'admin';

        echo json_encode([
            'ok' => true,
            'game' => $game,
            'screenshots' => $screenshots,
            'builds' => $builds,
            'comments' => $comments,
            'ratings_count' => (int)$ratingInfo['cnt'],
            'viewer' => [
                'authorized' => $user !== null,
                'is_admin' => $isAdmin,
                'user_id' => $user ? (int)$user['id'] : null,
            ],
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // ===== БИБЛИОТЕКА (реальная, по пользователю) =====
    if ($method === 'GET' && $action === 'library') {
        $user = requireAuth();
        $stmt = $pdo->prepare("
            SELECT g.id, g.title, g.slug, g.short_description, g.description,
                   g.price, g.category, g.genre, g.tags, g.rating,
                   g.cover_emoji, g.cover_color, g.developer_name, g.download_count,
                   l.added_at, l.last_played, l.playtime_minutes, l.is_pinned, l.pinned_order,
                   (SELECT COUNT(*) FROM game_builds b WHERE b.game_id = g.id) AS builds_count,
                   (SELECT GROUP_CONCAT(DISTINCT b.platform) FROM game_builds b WHERE b.game_id = g.id) AS platforms
            FROM library l
            JOIN games g ON g.id = l.game_id
            WHERE l.user_id = ?
            ORDER BY l.is_pinned DESC, l.pinned_order DESC, COALESCE(l.last_played, l.added_at) DESC
        ");
        $stmt->execute([(int)$user['id']]);
        $games = $stmt->fetchAll();
        foreach ($games as &$g) {
            $g['owned'] = true;
            $g['cover_src'] = !empty($g['cover_url']) ? $g['cover_url'] : ('media.php?type=cover&id=' . $g['id']);
            $g['playtime_minutes'] = (int)($g['playtime_minutes'] ?? 0);
            $g['is_pinned'] = (int)($g['is_pinned'] ?? 0);
        }
        unset($g);
        echo json_encode(['ok' => true, 'library' => $games], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // ===== ПОКУПКА / ПОЛУЧЕНИЕ БЕСПЛАТНОЙ =====
    if ($method === 'POST' && $action === 'buy') {
        $user = requireAuth();
        $body = jsonBody();
        checkCsrf($body);
        $gameId = (int)($body['game_id'] ?? 0);

        $stmt = $pdo->prepare("SELECT id, title, price FROM games WHERE id = ? AND is_published = 1 AND COALESCE(status, 'published') NOT IN ('pending','rejected','draft')");
        $stmt->execute([$gameId]);
        $game = $stmt->fetch();
        if (!$game) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Игра не найдена'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        if (ownsGame($pdo, (int)$user['id'], $gameId)) {
            echo json_encode(['ok' => true, 'already' => true, 'balance' => (int)$user['balance']], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $price = (float)$game['price'];
        $pdo->beginTransaction();
        try {
            if ($price > 0) {
                // Списываем только если хватает средств (атомарно)
                $stmt = $pdo->prepare("UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?");
                $stmt->execute([(int)round($price), (int)$user['id'], (int)round($price)]);
                if ($stmt->rowCount() === 0) {
                    $pdo->rollBack();
                    echo json_encode(['ok' => false, 'error' => 'Не хватает средств. Пополни баланс в профиле.'], JSON_UNESCAPED_UNICODE);
                    exit;
                }
            }
            $pdo->prepare("INSERT INTO library (user_id, game_id) VALUES (?, ?)")
                ->execute([(int)$user['id'], $gameId]);
            $pdo->prepare("INSERT INTO purchases (user_id, game_id, price_paid) VALUES (?, ?, ?)")
                ->execute([(int)$user['id'], $gameId, $price]);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        $stmt = $pdo->prepare("SELECT balance FROM users WHERE id = ?");
        $stmt->execute([(int)$user['id']]);

        echo json_encode([
            'ok' => true,
            'already' => false,
            'balance' => (int)$stmt->fetchColumn(),
            'message' => $price > 0
                ? '«' . $game['title'] . '» куплена и добавлена в библиотеку'
                : '«' . $game['title'] . '» добавлена в библиотеку',
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // ===== ОЦЕНКА ИГРЫ =====
    if ($method === 'POST' && $action === 'rate') {
        $user = requireAuth();
        $body = jsonBody();
        checkCsrf($body);
        $gameId = (int)($body['game_id'] ?? 0);
        $value = (int)($body['value'] ?? 0);
        if ($value < 1 || $value > 5) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Оценка от 1 до 5'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $stmt = $pdo->prepare("SELECT id FROM games WHERE id = ? AND is_published = 1 AND COALESCE(status, 'published') NOT IN ('pending','rejected','draft')");
        $stmt->execute([$gameId]);
        if (!$stmt->fetch()) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Игра не найдена'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $pdo->prepare("INSERT INTO ratings (user_id, game_id, value) VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE value = VALUES(value)")
            ->execute([(int)$user['id'], $gameId, $value]);
        recalcGameRating($pdo, $gameId);

        $stmt = $pdo->prepare("SELECT rating FROM games WHERE id = ?");
        $stmt->execute([$gameId]);
        echo json_encode(['ok' => true, 'rating' => (float)$stmt->fetchColumn(), 'user_rating' => $value], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // ===== ДОБАВИТЬ КОММЕНТАРИЙ =====
    if ($method === 'POST' && $action === 'comment') {
        $user = requireAuth();
        $body = jsonBody();
        checkCsrf($body);
        $gameId = (int)($body['game_id'] ?? 0);
        $text = trim((string)($body['body'] ?? ''));
        $parentId = isset($body['parent_id']) ? (int)$body['parent_id'] : null;
        if ($parentId <= 0) $parentId = null;
        if (mb_strlen($text) < 2 || mb_strlen($text) > 1000) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Комментарий от 2 до 1000 символов'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $stmt = $pdo->prepare("SELECT id FROM games WHERE id = ? AND is_published = 1 AND COALESCE(status, 'published') NOT IN ('pending','rejected','draft')");
        $stmt->execute([$gameId]);
        if (!$stmt->fetch()) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Игра не найдена'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        if ($parentId) {
            $chk = $pdo->prepare("SELECT id FROM comments WHERE id = ? AND game_id = ?");
            $chk->execute([$parentId, $gameId]);
            if (!$chk->fetch()) $parentId = null;
        }
        $pdo->prepare("INSERT INTO comments (game_id, user_id, body, parent_id) VALUES (?, ?, ?, ?)")
            ->execute([$gameId, (int)$user['id'], $text, $parentId]);
        $id = (int)$pdo->lastInsertId();

        $stmt = $pdo->prepare("SELECT c.id, c.body, c.created_at, c.parent_id, c.likes, u.username, u.avatar, u.avatar_color, u.avatar_url, u.id AS user_id
            FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?");
        $stmt->execute([$id]);
        echo json_encode(['ok' => true, 'comment' => $stmt->fetch()], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // ===== УДАЛИТЬ КОММЕНТАРИЙ (свой или админ) =====
    if ($method === 'POST' && $action === 'delete_comment') {
        $user = requireAuth();
        $body = jsonBody();
        checkCsrf($body);
        $commentId = (int)($body['comment_id'] ?? 0);
        $stmt = $pdo->prepare("SELECT user_id FROM comments WHERE id = ?");
        $stmt->execute([$commentId]);
        $ownerId = $stmt->fetchColumn();
        if ($ownerId === false) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Комментарий не найден'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        if ((int)$ownerId !== (int)$user['id'] && $user['role'] !== 'admin') {
            http_response_code(403);
            echo json_encode(['ok' => false, 'error' => 'Можно удалять только свои комментарии'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $pdo->prepare("DELETE FROM comments WHERE id = ?")->execute([$commentId]);
        echo json_encode(['ok' => true]);
        exit;
    }

    // ===== «ИГРАТЬ»: фиксируем последний запуск (для библиотеки как в Steam) =====
    if ($method === 'POST' && $action === 'launch') {
        $user = requireAuth();
        $body = jsonBody();
        checkCsrf($body);
        $gameId = (int)($body['game_id'] ?? 0);
        if (ownsGame($pdo, (int)$user['id'], $gameId)) {
            $pdo->prepare("UPDATE library SET last_played = NOW() WHERE user_id = ? AND game_id = ?")
                ->execute([(int)$user['id'], $gameId]);
        }
        echo json_encode(['ok' => true]);
        exit;
    }

    // ===== СБОРКИ ИГРЫ (файлы для скачивания) =====
    if ($method === 'GET' && $action === 'builds' && isset($_GET['game_id'])) {
        $gid = (int)$_GET['game_id'];
        $stmt = $pdo->prepare("
            SELECT id, platform, version, file_url, file_size_bytes, created_at
            FROM game_builds
            WHERE game_id = ?
            ORDER BY created_at DESC
        ");
        $stmt->execute([$gid]);
        echo json_encode(['ok' => true, 'builds' => $stmt->fetchAll()], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // ===== СКАЧИВАНИЕ СБОРКИ =====
    // Файл генерируется в web/files/ при первом скачивании (настоящий ZIP,
    // если есть ZipArchive, иначе честный .txt). Отдаём потоком с небольшим
    // ограничением скорости — так страница «Загрузки» показывает живой прогресс.
    if ($method === 'GET' && $action === 'download' && isset($_GET['build_id'])) {
        $user = requireAuth();
        $bid = (int)$_GET['build_id'];
        $stmt = $pdo->prepare("
            SELECT b.*, g.title, g.slug, g.price
            FROM game_builds b
            JOIN games g ON g.id = b.game_id
            WHERE b.id = ?
        ");
        $stmt->execute([$bid]);
        $build = $stmt->fetch();
        if (!$build) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Сборка не найдена'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        // Платное — только владельцам (и админу)
        $isAdmin = $user['role'] === 'admin';
        if ((float)$build['price'] > 0 && !$isAdmin && !ownsGame($pdo, (int)$user['id'], (int)$build['game_id'])) {
            http_response_code(403);
            echo json_encode(['ok' => false, 'error' => 'Сначала купи игру — потом скачивай'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $path = __DIR__ . '/../' . ltrim(str_replace('..', '', $build['file_url']), '/');
        if (!is_file($path)) {
            $generated = generateBuildFile($pdo, $build, $path);
            if (!$generated) {
                http_response_code(500);
                echo json_encode(['ok' => false, 'error' => 'Не удалось подготовить файл сборки'], JSON_UNESCAPED_UNICODE);
                exit;
            }
            // build мог поменять расширение (.zip -> .txt) — перечитываем
            $stmt = $pdo->prepare("SELECT * FROM game_builds WHERE id = ?");
            $stmt->execute([$bid]);
            $build = $stmt->fetch();
            $path = __DIR__ . '/../' . ltrim(str_replace('..', '', $build['file_url']), '/');
        }

        // Считаем скачивание и отмечаем активность в библиотеке
        $pdo->prepare("UPDATE games SET download_count = download_count + 1 WHERE id = ?")
            ->execute([$build['game_id']]);
        $pdo->prepare("UPDATE library SET last_played = NOW() WHERE user_id = ? AND game_id = ?")
            ->execute([(int)$user['id'], (int)$build['game_id']]);

        $ext = pathinfo($path, PATHINFO_EXTENSION);
        $filename = $build['slug'] . '-' . $build['version'] . '-' . $build['platform'] . '.' . $ext;
        $size = filesize($path);

        // Докачка с места паузы (Range: bytes=N-) — как в Steam
        $offset = 0;
        $statusCode = 200;
        $rangeHeader = $_SERVER['HTTP_RANGE'] ?? '';
        if (preg_match('/bytes=(\d+)-/', $rangeHeader, $m)) {
            $offset = min((int)$m[1], $size);
            $statusCode = 206;
        }

        // Отдача файла — переключаем заголовки с JSON на бинарные
        header_remove('Content-Type');
        http_response_code($statusCode);
        header('Content-Type: application/octet-stream');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Accept-Ranges: bytes');
        if ($statusCode === 206) {
            header('Content-Range: bytes ' . $offset . '-' . ($size - 1) . '/' . $size);
        }
        header('Content-Length: ' . ($size - $offset));
        header('X-Content-Type-Options: nosniff');

        // Троттлинг ~1.5 МБ/с, чтобы прогресс был виден (отключается ?throttle=0)
        $throttle = ($_GET['throttle'] ?? '1') !== '0';
        $chunk = 64 * 1024;
        $handle = fopen($path, 'rb');
        if ($offset > 0) fseek($handle, $offset);
        while (!feof($handle)) {
            echo fread($handle, $chunk);
            if (ob_get_level() > 0) ob_flush();
            flush();
            if ($throttle) usleep(42000); // ~1.5 МБ/с при чанке 64 КБ
        }
        fclose($handle);
        exit;
    }

    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Unknown action'], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    if (!headers_sent()) {
        http_response_code(500);
    }
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
}

// ============================================================
//  ГЕНЕРАЦИЯ ДЕМО-ФАЙЛА СБОРКИ
// ============================================================
// Демо-игры поставляются без реальных бинарников. Чтобы страница загрузок
// работала по-честному, генерируем настоящий архив с фиктивным «игровым»
// содержимым (6–14 МБ, размер зависит от игры). Если ZipArchive недоступен —
// сохраняем честный .txt и правим file_url в базе.
function generateBuildFile(PDO $pdo, array $build, string $path): bool {
    $dir = dirname($path);
    if (!is_dir($dir) && !mkdir($dir, 0775, true)) {
        return false;
    }

    $sizeMb = 6 + ((int)$build['game_id'] % 9); // 6..14 МБ, детерминированно
    $targetBytes = $sizeMb * 1024 * 1024;
    $readme = "CATio demo build\n"
        . "================\n"
        . "Игра:    {$build['title']}\n"
        . "Платформа: {$build['platform']}\n"
        . "Версия:  {$build['version']}\n\n"
        . "Это демо-файл, сгенерированный сервером, чтобы страница загрузок\n"
        . "работала как в Steam. Замени его на настоящую сборку в папке web/files/,\n"
        . "и CATio начнёт отдавать уже её.\n";

    $zipOk = class_exists('ZipArchive');
    if ($zipOk) {
        $zip = new ZipArchive();
        if ($zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) === true) {
            $zip->addFromString('README.txt', $readme);
            // «Бинарник» игры: несжимаемый шум, чтобы размер был честным
            $chunk = random_bytes(256 * 1024);
            $payload = '';
            $written = 0;
            while ($written < $targetBytes) {
                $payload .= $chunk;
                $written += strlen($chunk);
                if (strlen($payload) >= 4 * 1024 * 1024) {
                    $zip->addFromString('game_' . $written . '.bin', $payload);
                    $payload = '';
                }
            }
            if ($payload !== '') {
                $zip->addFromString('game_final.bin', $payload);
            }
            $zip->close();
        } else {
            $zipOk = false;
        }
    }

    if (!$zipOk) {
        // Фолбэк без ZipArchive: текстовый файл, правим file_url в базе
        $path = preg_replace('/\.zip$/i', '.txt', $path);
        $handle = fopen($path, 'wb');
        if (!$handle) return false;
        fwrite($handle, $readme . str_repeat("=", 60) . "\n\n");
        $line = str_repeat("CATIO-DEMO-DATA ", 8) . "\n";
        $written = 0;
        while ($written < $targetBytes) {
            fwrite($handle, $line);
            $written += strlen($line);
        }
        fclose($handle);

        $newUrl = preg_replace('/\.zip$/i', '.txt', $build['file_url']);
        $pdo->prepare("UPDATE game_builds SET file_url = ? WHERE id = ?")
            ->execute([$newUrl, $build['id']]);
    }

    // Фиксируем честный размер файла
    $pdo->prepare("UPDATE game_builds SET file_size_bytes = ? WHERE id = ?")
        ->execute([filesize($path), $build['id']]);

    return true;
}
