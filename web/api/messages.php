<?php
// CATio — личные сообщения
require_once __DIR__ . '/bootstrap.php';

$pdo = getDB();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

function jsonBodyMsg(): array { return jsonBody(); }

function requireAuthMsg(): array { return requireUser(); }

function areFriends(PDO $pdo, int $a, int $b): bool {
    $st = $pdo->prepare("
        SELECT id FROM friendships
        WHERE status = 'accepted'
          AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
        LIMIT 1
    ");
    $st->execute([$a, $b, $b, $a]);
    return (bool)$st->fetch();
}

function publicUserMini(array $u): array {
    return [
        'id' => (int)$u['id'],
        'username' => $u['username'],
        'avatar' => $u['avatar'] ?? '',
        'avatar_color' => $u['avatar_color'] ?? '#ef5b2c',
        'avatar_url' => $u['avatar_url'] ?? '',
        'is_online' => (int)($u['is_online'] ?? 0),
    ];
}

try {
    switch ($action) {

        // История переписки с пользователем
        case 'thread':
            $user = requireAuthMsg();
            $uid = (int)$user['id'];
            $other = (int)($_GET['user_id'] ?? 0);
            if ($other <= 0 || $other === $uid) {
                http_response_code(400);
                echo json_encode(['ok' => false, 'error' => 'Некорректный пользователь'], JSON_UNESCAPED_UNICODE);
                break;
            }
            if (!areFriends($pdo, $uid, $other)) {
                http_response_code(403);
                echo json_encode(['ok' => false, 'error' => 'Писать можно только друзьям'], JSON_UNESCAPED_UNICODE);
                break;
            }

            $st = $pdo->prepare("SELECT id, username, avatar, avatar_color, avatar_url, is_online FROM users WHERE id = ?");
            $st->execute([$other]);
            $peer = $st->fetch();
            if (!$peer) {
                http_response_code(404);
                echo json_encode(['ok' => false, 'error' => 'Пользователь не найден'], JSON_UNESCAPED_UNICODE);
                break;
            }

            // пометить входящие как прочитанные
            $pdo->prepare("UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ? AND is_read = 0")
                ->execute([$other, $uid]);

            $limit = min(100, max(20, (int)($_GET['limit'] ?? 50)));
            $st = $pdo->prepare("
                SELECT id, sender_id, receiver_id, body, is_read, created_at
                FROM messages
                WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
                ORDER BY created_at DESC
                LIMIT $limit
            ");
            $st->execute([$uid, $other, $other, $uid]);
            $rows = array_reverse($st->fetchAll());

            $messages = [];
            foreach ($rows as $r) {
                $messages[] = [
                    'id' => (int)$r['id'],
                    'sender_id' => (int)$r['sender_id'],
                    'receiver_id' => (int)$r['receiver_id'],
                    'body' => $r['body'],
                    'is_read' => (int)$r['is_read'],
                    'created_at' => $r['created_at'],
                    'mine' => ((int)$r['sender_id'] === $uid),
                ];
            }

            echo json_encode([
                'ok' => true,
                'peer' => publicUserMini($peer),
                'messages' => $messages,
            ], JSON_UNESCAPED_UNICODE);
            break;

        // Отправить сообщение
        case 'send':
            if ($method !== 'POST') {
                http_response_code(405);
                echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
                break;
            }
            $user = requireAuthMsg();
            $body = jsonBodyMsg();
            if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
                http_response_code(403);
                echo json_encode(['ok' => false, 'error' => 'Неверный CSRF-токен'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $uid = (int)$user['id'];
            $to = (int)($body['user_id'] ?? 0);
            $text = trim($body['body'] ?? '');
            if ($to <= 0 || $to === $uid) {
                http_response_code(400);
                echo json_encode(['ok' => false, 'error' => 'Некорректный получатель'], JSON_UNESCAPED_UNICODE);
                break;
            }
            if ($text === '' || mb_strlen($text) > 2000) {
                http_response_code(400);
                echo json_encode(['ok' => false, 'error' => 'Сообщение: 1–2000 символов'], JSON_UNESCAPED_UNICODE);
                break;
            }
            if (!areFriends($pdo, $uid, $to)) {
                http_response_code(403);
                echo json_encode(['ok' => false, 'error' => 'Писать можно только друзьям'], JSON_UNESCAPED_UNICODE);
                break;
            }

            $pdo->prepare("INSERT INTO messages (sender_id, receiver_id, body) VALUES (?, ?, ?)")
                ->execute([$uid, $to, $text]);
            $id = (int)$pdo->lastInsertId();
            try {
                $preview = mb_strlen($text) > 80 ? mb_substr($text, 0, 80) . '…' : $text;
                $pdo->prepare("INSERT INTO notifications (user_id, type, title, body, meta_json) VALUES (?, 'message', ?, ?, ?)")
                    ->execute([
                        $to,
                        'Новое сообщение',
                        $user['username'] . ': ' . $preview,
                        json_encode(['from_id' => $uid, 'from_username' => $user['username']], JSON_UNESCAPED_UNICODE),
                    ]);
            } catch (Throwable $e) {}
            $st = $pdo->prepare("SELECT id, sender_id, receiver_id, body, is_read, created_at FROM messages WHERE id = ?");
            $st->execute([$id]);
            $r = $st->fetch();

            echo json_encode([
                'ok' => true,
                'message' => [
                    'id' => (int)$r['id'],
                    'sender_id' => (int)$r['sender_id'],
                    'receiver_id' => (int)$r['receiver_id'],
                    'body' => $r['body'],
                    'is_read' => (int)$r['is_read'],
                    'created_at' => $r['created_at'],
                    'mine' => true,
                ],
            ], JSON_UNESCAPED_UNICODE);
            break;

        // Непрочитанные (счётчик)
        case 'unread':
            $user = requireAuthMsg();
            $uid = (int)$user['id'];
            $st = $pdo->prepare("SELECT COUNT(*) FROM messages WHERE receiver_id = ? AND is_read = 0"); $st->execute([$uid]); $cnt = (int)$st->fetchColumn();
            echo json_encode(['ok' => true, 'unread' => $cnt], JSON_UNESCAPED_UNICODE);
            break;


        case 'upload':
            if ($method !== 'POST') {
                http_response_code(405);
                echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
                break;
            }
            $user = requireAuthMsg();
            if (!verifyCsrfToken($_POST['csrf_token'] ?? '')) {
                http_response_code(403);
                echo json_encode(['ok' => false, 'error' => 'CSRF'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $to = (int)($_POST['user_id'] ?? 0);
            $uid = (int)$user['id'];
            if ($to <= 0 || !areFriends($pdo, $uid, $to)) {
                http_response_code(403);
                echo json_encode(['ok' => false, 'error' => 'Только друзьям'], JSON_UNESCAPED_UNICODE);
                break;
            }
            if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                http_response_code(400);
                echo json_encode(['ok' => false, 'error' => 'Файл не загружен'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $file = $_FILES['file'];
            if ($file['size'] > 8 * 1024 * 1024) {
                http_response_code(400);
                echo json_encode(['ok' => false, 'error' => 'Максимум 8 МБ'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $finfo = new finfo(FILEINFO_MIME_TYPE);
            $mime = $finfo->file($file['tmp_name']);
            $allowed = ['image/jpeg'=>'jpg','image/png'=>'png','image/webp'=>'webp','image/gif'=>'gif'];
            if (!isset($allowed[$mime])) {
                http_response_code(400);
                echo json_encode(['ok' => false, 'error' => 'Только изображения'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $dir = dirname(__DIR__) . '/uploads/chat';
            if (!is_dir($dir)) mkdir($dir, 0755, true);
            $name = 'chat_' . $uid . '_' . time() . '.' . $allowed[$mime];
            if (!move_uploaded_file($file['tmp_name'], $dir . '/' . $name)) {
                http_response_code(500);
                echo json_encode(['ok' => false, 'error' => 'Ошибка сохранения'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $url = 'uploads/chat/' . $name;
            $body = '[image]' . $url;
            $pdo->prepare("INSERT INTO messages (sender_id, receiver_id, body) VALUES (?, ?, ?)")
                ->execute([$uid, $to, $body]);
            $id = (int)$pdo->lastInsertId();
            try {
                $pdo->prepare("INSERT INTO notifications (user_id, type, title, body, meta_json) VALUES (?, 'message', ?, ?, ?)")
                    ->execute([$to, 'Новое сообщение', $user['username'] . ': [изображение]',
                        json_encode(['from_id'=>$uid,'from_username'=>$user['username']], JSON_UNESCAPED_UNICODE)]);
            } catch (Throwable $e) {}
            $st = $pdo->prepare("SELECT id, sender_id, receiver_id, body, is_read, created_at FROM messages WHERE id = ?");
            $st->execute([$id]);
            $r = $st->fetch();
            echo json_encode(['ok'=>true,'message'=>[
                'id'=>(int)$r['id'],'sender_id'=>(int)$r['sender_id'],'receiver_id'=>(int)$r['receiver_id'],
                'body'=>$r['body'],'is_read'=>(int)$r['is_read'],'created_at'=>$r['created_at'],'mine'=>true,
            ]], JSON_UNESCAPED_UNICODE);
            break;

        default:
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Unknown action'], JSON_UNESCAPED_UNICODE);
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
}
