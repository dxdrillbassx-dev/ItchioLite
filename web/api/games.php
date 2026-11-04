<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . '/../db.php';

$pdo = getDB();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? 'list';

try {
    if ($method === 'GET' && $action === 'list') {
        $stmt = $pdo->query("
            SELECT id, title, slug, short_description, description, cover_url,
                   price, developer_name, tags, download_count, created_at
            FROM games
            WHERE is_published = 1
            ORDER BY created_at DESC
        ");
        $games = $stmt->fetchAll();
        echo json_encode(['ok' => true, 'games' => $games]);
        exit;
    }

    if ($method === 'GET' && $action === 'get' && isset($_GET['id'])) {
        $id = (int)$_GET['id'];
        $stmt = $pdo->prepare("SELECT * FROM games WHERE id = ? AND is_published = 1");
        $stmt->execute([$id]);
        $game = $stmt->fetch();
        if (!$game) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Game not found']);
            exit;
        }
        echo json_encode(['ok' => true, 'game' => $game]);
        exit;
    }

    if ($method === 'GET' && $action === 'library') {
        // Simple demo: return all games as "owned" for now
        // In real app you would check user session
        $stmt = $pdo->query("
            SELECT g.* FROM games g
            WHERE g.is_published = 1
            ORDER BY g.title
        ");
        $games = $stmt->fetchAll();
        echo json_encode(['ok' => true, 'library' => $games]);
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
        echo json_encode(['ok' => true, 'builds' => $stmt->fetchAll()]);
        exit;
    }

    // ===== СКАЧИВАНИЕ СБОРКИ =====
    if ($method === 'GET' && $action === 'download' && isset($_GET['build_id'])) {
        $bid = (int)$_GET['build_id'];
        $stmt = $pdo->prepare("
            SELECT b.*, g.title, g.slug
            FROM game_builds b
            JOIN games g ON g.id = b.game_id
            WHERE b.id = ?
        ");
        $stmt->execute([$bid]);
        $build = $stmt->fetch();
        if (!$build) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Сборка не найдена']);
            exit;
        }

        $path = __DIR__ . '/../' . ltrim(str_replace('..', '', $build['file_url']), '/');
        if (!is_file($path)) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Файл сборки ещё не загружен на сервер']);
            exit;
        }

        // Считаем скачивание
        $pdo->prepare("UPDATE games SET download_count = download_count + 1 WHERE id = ?")
            ->execute([$build['game_id']]);

        $filename = $build['slug'] . '-' . $build['version'] . '-' . $build['platform'] . '.zip';
        header('Content-Type: application/octet-stream');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . filesize($path));
        header('X-Content-Type-Options: nosniff');
        readfile($path);
        exit;
    }

    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Unknown action']);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
