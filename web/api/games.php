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

    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Unknown action']);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}