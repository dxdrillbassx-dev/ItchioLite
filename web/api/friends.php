<?php
// CATio — друзья: список, заявки, поиск, онлайн-статус
require_once __DIR__ . '/../auth.php';

header('Content-Type: application/json; charset=utf-8');

set_exception_handler(function ($e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Ошибка сервера: ' . $e->getMessage()], JSON_UNESCAPED_UNICODE);
    exit;
});

$pdo = getDB();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

function jsonBodyFriends(): array {
    $body = json_decode(file_get_contents('php://input'), true);
    return is_array($body) ? $body : $_POST;
}

function requireAuthFriends(): array {
    $user = getCurrentUser();
    if (!$user) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'Нужно войти в аккаунт'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    // touch online
    try {
        $pdo = getDB();
        $pdo->prepare("UPDATE users SET last_seen = NOW(), is_online = 1 WHERE id = ?")->execute([(int)$user['id']]);
    } catch (Throwable $e) {}
    return $user;
}

function publicUserRow(array $u): array {
    return [
        'id' => (int)$u['id'],
        'username' => $u['username'],
        'avatar' => $u['avatar'] ?? '',
        'avatar_color' => $u['avatar_color'] ?? '#ef5b2c',
        'avatar_url' => $u['avatar_url'] ?? '',
        'is_online' => (int)($u['is_online'] ?? 0),
        'last_seen' => $u['last_seen'] ?? null,
    ];
}

// нормализованная пара (меньший id первым) — не используем, храним оба направления для accepted
// для pending: user_id = получатель заявки? Проще: requested_by отправил, friend_id = кому

try {
    switch ($action) {

        // ===== СПИСОК ДРУЗЕЙ + ЗАЯВКИ =====
        case 'list':
            $user = requireAuthFriends();
            $uid = (int)$user['id'];

            // accepted friends
            $stmt = $pdo->prepare("
                SELECT u.id, u.username, u.avatar, u.avatar_color, u.avatar_url, u.is_online, u.last_seen
                FROM friendships f
                JOIN users u ON u.id = IF(f.user_id = ?, f.friend_id, f.user_id)
                WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
                ORDER BY u.is_online DESC, u.username ASC
            ");
            $stmt->execute([$uid, $uid, $uid]);
            $friends = array_map('publicUserRow', $stmt->fetchAll());

            // incoming pending
            $stmt = $pdo->prepare("
                SELECT u.id, u.username, u.avatar, u.avatar_color, u.avatar_url, u.is_online, u.last_seen, f.id AS request_id
                FROM friendships f
                JOIN users u ON u.id = f.requested_by
                WHERE f.friend_id = ? AND f.status = 'pending' AND f.requested_by != ?
                ORDER BY f.created_at DESC
            ");
            $stmt->execute([$uid, $uid]);
            $incoming = [];
            foreach ($stmt->fetchAll() as $r) {
                $row = publicUserRow($r);
                $row['request_id'] = (int)$r['request_id'];
                $incoming[] = $row;
            }

            // outgoing pending
            $stmt = $pdo->prepare("
                SELECT u.id, u.username, u.avatar, u.avatar_color, u.avatar_url, u.is_online, u.last_seen, f.id AS request_id
                FROM friendships f
                JOIN users u ON u.id = f.friend_id
                WHERE f.requested_by = ? AND f.status = 'pending'
                ORDER BY f.created_at DESC
            ");
            $stmt->execute([$uid]);
            $outgoing = [];
            foreach ($stmt->fetchAll() as $r) {
                $row = publicUserRow($r);
                $row['request_id'] = (int)$r['request_id'];
                $outgoing[] = $row;
            }

            $online = array_values(array_filter($friends, fn($f) => !empty($f['is_online'])));
            $offline = array_values(array_filter($friends, fn($f) => empty($f['is_online'])));

            echo json_encode([
                'ok' => true,
                'me' => publicUserRow($user),
                'online' => $online,
                'offline' => $offline,
                'incoming' => $incoming,
                'outgoing' => $outgoing,
            ], JSON_UNESCAPED_UNICODE);
            break;

        // ===== ПОИСК ПОЛЬЗОВАТЕЛЕЙ =====
        case 'search':
            $user = requireAuthFriends();
            $q = trim($_GET['q'] ?? '');
            if (mb_strlen($q) < 1) {
                echo json_encode(['ok' => true, 'users' => []], JSON_UNESCAPED_UNICODE);
                break;
            }
            $uid = (int)$user['id'];
            $stmt = $pdo->prepare("
                SELECT id, username, avatar, avatar_color, avatar_url, is_online, last_seen
                FROM users
                WHERE username LIKE ? AND id != ?
                ORDER BY username ASC
                LIMIT 20
            ");
            $stmt->execute(['%' . $q . '%', $uid]);
            $users = array_map('publicUserRow', $stmt->fetchAll());

            // relation for each
            foreach ($users as &$u) {
                $fid = (int)$u['id'];
                $st = $pdo->prepare("
                    SELECT status, requested_by FROM friendships
                    WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)
                    LIMIT 1
                ");
                $st->execute([$uid, $fid, $fid, $uid]);
                $rel = $st->fetch();
                if (!$rel) {
                    $u['relation'] = 'none';
                } elseif ($rel['status'] === 'accepted') {
                    $u['relation'] = 'friends';
                } elseif ($rel['status'] === 'pending') {
                    $u['relation'] = ((int)$rel['requested_by'] === $uid) ? 'outgoing' : 'incoming';
                } else {
                    $u['relation'] = $rel['status'];
                }
            }
            unset($u);

            echo json_encode(['ok' => true, 'users' => $users], JSON_UNESCAPED_UNICODE);
            break;

        // ===== ОТПРАВИТЬ ЗАЯВКУ =====
        case 'request':
            if ($method !== 'POST') {
                http_response_code(405);
                echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
                break;
            }
            $user = requireAuthFriends();
            $body = jsonBodyFriends();
            if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
                http_response_code(403);
                echo json_encode(['ok' => false, 'error' => 'Неверный CSRF-токен'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $to = (int)($body['user_id'] ?? 0);
            $uid = (int)$user['id'];
            if ($to <= 0 || $to === $uid) {
                http_response_code(400);
                echo json_encode(['ok' => false, 'error' => 'Некорректный пользователь'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $exists = $pdo->prepare("SELECT id FROM users WHERE id = ?");
            $exists->execute([$to]);
            if (!$exists->fetch()) {
                http_response_code(404);
                echo json_encode(['ok' => false, 'error' => 'Пользователь не найден'], JSON_UNESCAPED_UNICODE);
                break;
            }
            // already?
            $st = $pdo->prepare("
                SELECT id, status, requested_by FROM friendships
                WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)
                LIMIT 1
            ");
            $st->execute([$uid, $to, $to, $uid]);
            $ex = $st->fetch();
            if ($ex) {
                if ($ex['status'] === 'accepted') {
                    echo json_encode(['ok' => false, 'error' => 'Уже в друзьях'], JSON_UNESCAPED_UNICODE);
                    break;
                }
                if ($ex['status'] === 'pending') {
                    echo json_encode(['ok' => false, 'error' => 'Заявка уже отправлена'], JSON_UNESCAPED_UNICODE);
                    break;
                }
            }
            // store: user_id = smaller? Use user_id = me, friend_id = target for pending
            $pdo->prepare("
                INSERT INTO friendships (user_id, friend_id, status, requested_by)
                VALUES (?, ?, 'pending', ?)
            ")->execute([$uid, $to, $uid]);
            // уведомление получателю
            try {
                $pdo->prepare("INSERT INTO notifications (user_id, type, title, body, meta_json) VALUES (?, 'friend_request', ?, ?, ?)")
                    ->execute([
                        $to,
                        'Новая заявка в друзья',
                        $user['username'] . ' хочет добавить вас в друзья',
                        json_encode(['from_id' => $uid, 'from_username' => $user['username']], JSON_UNESCAPED_UNICODE),
                    ]);
            } catch (Throwable $e) {}
            echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
            break;

        // ===== ПРИНЯТЬ / ОТКЛОНИТЬ =====
        case 'respond':
            if ($method !== 'POST') {
                http_response_code(405);
                echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
                break;
            }
            $user = requireAuthFriends();
            $body = jsonBodyFriends();
            if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
                http_response_code(403);
                echo json_encode(['ok' => false, 'error' => 'Неверный CSRF-токен'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $fromId = (int)($body['user_id'] ?? 0);
            $accept = !empty($body['accept']);
            $uid = (int)$user['id'];

            $st = $pdo->prepare("
                SELECT id FROM friendships
                WHERE status = 'pending' AND requested_by = ? AND friend_id = ?
                LIMIT 1
            ");
            $st->execute([$fromId, $uid]);
            $row = $st->fetch();
            // also try inverted storage
            if (!$row) {
                $st = $pdo->prepare("
                    SELECT id FROM friendships
                    WHERE status = 'pending' AND requested_by = ? AND user_id = ?
                    LIMIT 1
                ");
                $st->execute([$fromId, $uid]);
                $row = $st->fetch();
            }
            if (!$row) {
                http_response_code(404);
                echo json_encode(['ok' => false, 'error' => 'Заявка не найдена'], JSON_UNESCAPED_UNICODE);
                break;
            }
            if ($accept) {
                $pdo->prepare("UPDATE friendships SET status = 'accepted' WHERE id = ?")->execute([$row['id']]);
                // уведомить отправителя заявки
                try {
                    $pdo->prepare("INSERT INTO notifications (user_id, type, title, body, meta_json) VALUES (?, 'friend_accepted', ?, ?, ?)")
                        ->execute([
                            $fromId,
                            'Заявка принята',
                            $user['username'] . ' принял(а) вашу заявку в друзья',
                            json_encode(['from_id' => $uid, 'from_username' => $user['username']], JSON_UNESCAPED_UNICODE),
                        ]);
                } catch (Throwable $e) {}
            } else {
                $pdo->prepare("DELETE FROM friendships WHERE id = ?")->execute([$row['id']]);
            }
            echo json_encode(['ok' => true, 'accepted' => $accept], JSON_UNESCAPED_UNICODE);
            break;

        // ===== УДАЛИТЬ ИЗ ДРУЗЕЙ / ОТМЕНИТЬ ЗАЯВКУ =====
        case 'remove':
            if ($method !== 'POST') {
                http_response_code(405);
                echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
                break;
            }
            $user = requireAuthFriends();
            $body = jsonBodyFriends();
            if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
                http_response_code(403);
                echo json_encode(['ok' => false, 'error' => 'Неверный CSRF-токен'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $other = (int)($body['user_id'] ?? 0);
            $uid = (int)$user['id'];
            $pdo->prepare("
                DELETE FROM friendships
                WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)
            ")->execute([$uid, $other, $other, $uid]);
            echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
            break;

        // ===== ПУБЛИЧНЫЙ ПРОФИЛЬ =====
        case 'profile':
            $user = requireAuthFriends();
            $uid = (int)$user['id'];
            $target = trim($_GET['username'] ?? '');
            $targetId = (int)($_GET['id'] ?? 0);

            if ($targetId > 0) {
                $stmt = $pdo->prepare("SELECT id, username, avatar, avatar_color, avatar_url, banner_url, banner_pos, banner_zoom, karma, created_at, is_online, last_seen, role FROM users WHERE id = ?");
                $stmt->execute([$targetId]);
            } else {
                $stmt = $pdo->prepare("SELECT id, username, avatar, avatar_color, avatar_url, banner_url, banner_pos, banner_zoom, karma, created_at, is_online, last_seen, role FROM users WHERE username = ?");
                $stmt->execute([$target]);
            }
            $p = $stmt->fetch();
            if (!$p) {
                http_response_code(404);
                echo json_encode(['ok' => false, 'error' => 'Пользователь не найден'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $pid = (int)$p['id'];

            // relation
            $relation = 'self';
            if ($pid !== $uid) {
                $st = $pdo->prepare("
                    SELECT status, requested_by FROM friendships
                    WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)
                    LIMIT 1
                ");
                $st->execute([$uid, $pid, $pid, $uid]);
                $rel = $st->fetch();
                if (!$rel) $relation = 'none';
                elseif ($rel['status'] === 'accepted') $relation = 'friends';
                elseif ($rel['status'] === 'pending') {
                    $relation = ((int)$rel['requested_by'] === $uid) ? 'outgoing' : 'incoming';
                } else $relation = $rel['status'];
            }

            // library for profile
            $lib = $pdo->prepare("
                SELECT g.id, g.title, l.playtime_minutes, l.is_pinned, l.pinned_order, l.last_played, l.added_at
                FROM library l JOIN games g ON g.id = l.game_id
                WHERE l.user_id = ?
                ORDER BY l.is_pinned DESC, l.pinned_order DESC, COALESCE(l.last_played, l.added_at) DESC
            ");
            $lib->execute([$pid]);
            $library = $lib->fetchAll();
            foreach ($library as &$g) {
                $g['playtime_minutes'] = (int)$g['playtime_minutes'];
                $g['is_pinned'] = (int)$g['is_pinned'];
            }
            unset($g);

            $playtime = (int)$pdo->query("SELECT COALESCE(SUM(playtime_minutes),0) FROM library WHERE user_id = $pid")->fetchColumn();
            $gamesCount = (int)$pdo->query("SELECT COUNT(*) FROM library WHERE user_id = $pid")->fetchColumn();

            echo json_encode([
                'ok' => true,
                'profile' => [
                    'id' => $pid,
                    'username' => $p['username'],
                    'avatar' => $p['avatar'],
                    'avatar_color' => $p['avatar_color'],
                    'avatar_url' => $p['avatar_url'],
                    'banner_url' => $p['banner_url'],
                    'banner_pos' => $p['banner_pos'] ?? '50% 50%',
                    'banner_zoom' => (float)($p['banner_zoom'] ?? 1),
                    'karma' => (int)$p['karma'],
                    'created_at' => $p['created_at'],
                    'is_online' => (int)$p['is_online'],
                    'last_seen' => $p['last_seen'],
                    'role' => $p['role'],
                    'relation' => $relation,
                    'playtime_minutes' => $playtime,
                    'games_count' => $gamesCount,
                ],
                'library' => $library,
            ], JSON_UNESCAPED_UNICODE);
            break;


        // ===== ДРУЗЬЯ ПОЛЬЗОВАТЕЛЯ (для профиля) =====
        case 'of_user':
            $user = requireAuthFriends();
            $targetId = (int)($_GET['id'] ?? 0);
            if ($targetId <= 0) {
                $targetId = (int)$user['id'];
            }
            $stmt = $pdo->prepare("
                SELECT u.id, u.username, u.avatar, u.avatar_color, u.avatar_url, u.is_online, u.last_seen
                FROM friendships f
                JOIN users u ON u.id = IF(f.user_id = ?, f.friend_id, f.user_id)
                WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
                ORDER BY u.is_online DESC, u.username ASC
                LIMIT 50
            ");
            $stmt->execute([$targetId, $targetId, $targetId]);
            $friends = array_map('publicUserRow', $stmt->fetchAll());
            echo json_encode(['ok' => true, 'friends' => $friends, 'count' => count($friends)], JSON_UNESCAPED_UNICODE);
            break;

        default:
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Unknown action'], JSON_UNESCAPED_UNICODE);
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
}
