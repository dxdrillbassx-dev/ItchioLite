<?php
require_once __DIR__ . '/../auth.php';
header('Content-Type: application/json; charset=utf-8');

set_exception_handler(function ($e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
    exit;
});

$pdo = getDB();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

function jsonBodyN(): array {
    $b = json_decode(file_get_contents('php://input'), true);
    return is_array($b) ? $b : $_POST;
}
function requireAuthN(): array {
    $u = getCurrentUser();
    if (!$u) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'Нужно войти'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    return $u;
}

/** Создать уведомление (вызывается из других API через require) */
function createNotification(PDO $pdo, int $userId, string $type, string $title, string $body = '', array $meta = []): void {
    $pdo->prepare("INSERT INTO notifications (user_id, type, title, body, meta_json) VALUES (?, ?, ?, ?, ?)")
        ->execute([$userId, $type, $title, $body, $meta ? json_encode($meta, JSON_UNESCAPED_UNICODE) : null]);
}

try {
    switch ($action) {
        case 'list':
            $user = requireAuthN();
            $uid = (int)$user['id'];
            $onlyUnread = !empty($_GET['unread']);
            $sql = "SELECT id, type, title, body, meta_json, is_read, created_at FROM notifications WHERE user_id = ?";
            if ($onlyUnread) $sql .= " AND is_read = 0";
            $sql .= " ORDER BY created_at DESC LIMIT 50";
            $st = $pdo->prepare($sql);
            $st->execute([$uid]);
            $rows = [];
            foreach ($st->fetchAll() as $r) {
                $rows[] = [
                    'id' => (int)$r['id'],
                    'type' => $r['type'],
                    'title' => $r['title'],
                    'body' => $r['body'],
                    'meta' => $r['meta_json'] ? json_decode($r['meta_json'], true) : null,
                    'is_read' => (int)$r['is_read'],
                    'created_at' => $r['created_at'],
                ];
            }
            echo json_encode(['ok' => true, 'notifications' => $rows], JSON_UNESCAPED_UNICODE);
            break;

        case 'badge':
            $user = requireAuthN();
            $uid = (int)$user['id'];
            $notif = 0;
            $msgs = 0;
            $req = 0;
            try {
                $notif = (int)$pdo->query("SELECT COUNT(*) FROM notifications WHERE user_id = $uid AND is_read = 0")->fetchColumn();
            } catch (Throwable $e) {}
            try {
                $msgs = (int)$pdo->query("SELECT COUNT(*) FROM messages WHERE receiver_id = $uid AND is_read = 0")->fetchColumn();
            } catch (Throwable $e) {}
            // входящие заявки без requested_by (колонки может не быть)
            try {
                $req = (int)$pdo->query("SELECT COUNT(*) FROM friendships WHERE friend_id = $uid AND status = 'pending'")->fetchColumn();
            } catch (Throwable $e) {}
            echo json_encode([
                'ok' => true,
                'notifications' => $notif,
                'messages' => $msgs,
                'requests' => $req,
                'total' => $notif + $msgs + $req,
            ], JSON_UNESCAPED_UNICODE);
            break;

        case 'read':
            if ($method !== 'POST') { http_response_code(405); echo json_encode(['ok'=>false]); break; }
            $user = requireAuthN();
            $body = jsonBodyN();
            if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
                http_response_code(403);
                echo json_encode(['ok' => false, 'error' => 'CSRF'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $uid = (int)$user['id'];
            if (!empty($body['all'])) {
                $pdo->prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?")->execute([$uid]);
            } elseif (!empty($body['id'])) {
                $pdo->prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?")
                    ->execute([(int)$body['id'], $uid]);
            }
            echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
            break;

        case 'clear':
            if ($method !== 'POST') { http_response_code(405); echo json_encode(['ok'=>false]); break; }
            $user = requireAuthN();
            $body = jsonBodyN();
            if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
                http_response_code(403);
                echo json_encode(['ok' => false, 'error' => 'CSRF'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $pdo->prepare("DELETE FROM notifications WHERE user_id = ?")->execute([(int)$user['id']]);
            echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
            break;

        default:
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Unknown action'], JSON_UNESCAPED_UNICODE);
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
}
