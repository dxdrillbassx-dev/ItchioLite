<?php
// CATio — друзья + публичный профиль
require_once __DIR__ . '/bootstrap.php';

$pdo = getDB();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

function userPublicRow(array $u): array {
    return [
        'id' => (int)$u['id'],
        'username' => $u['username'],
        'avatar' => $u['avatar'] ?? '',
        'avatar_color' => $u['avatar_color'] ?? '#ef5b2c',
        'avatar_url' => $u['avatar_url'] ?? '',
        'banner_url' => $u['banner_url'] ?? '',
        'banner_pos' => $u['banner_pos'] ?? '50% 50%',
        'banner_zoom' => isset($u['banner_zoom']) ? (float)$u['banner_zoom'] : 1.0,
        'role' => $u['role'] ?? 'user',
        'karma' => (int)($u['karma'] ?? 0),
        'created_at' => $u['created_at'] ?? null,
        'is_banned' => (int)($u['is_banned'] ?? 0),
        'is_online' => false,
        'friend_code' => $u['friend_code'] ?? '',
    ];
}
function relationBetween(PDO $pdo, int $me, int $other): string {
    if ($me === $other) return 'self';
    $st = $pdo->prepare("SELECT status, user_id, friend_id FROM friendships
        WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?) LIMIT 1");
    $st->execute([$me, $other, $other, $me]);
    $row = $st->fetch();
    if (!$row) return 'none';
    if ($row['status'] === 'accepted') return 'friends';
    if ($row['status'] === 'pending') {
        return ((int)$row['user_id'] === $me) ? 'outgoing' : 'incoming';
    }
    return 'none';
}
function fetchUserLibrary(PDO $pdo, int $uid): array {
    $stmt = $pdo->prepare("
        SELECT g.id, g.title, g.slug, g.price, g.category, g.genre, g.tags, g.rating,
               g.cover_url, g.banner_url, g.icon_url, g.cover_emoji, g.cover_color,
               g.developer_name, g.download_count,
               l.added_at, l.last_played, l.playtime_minutes, l.is_pinned, l.pinned_order,
               COALESCE(l.is_liked, 0) AS is_liked, l.liked_at,
               COALESCE(l.ach_unlocked, 0) AS ach_unlocked, COALESCE(NULLIF(l.ach_total, 0), g.ach_count, 0) AS ach_total, g.steam_appid
        FROM library l
        JOIN games g ON g.id = l.game_id
        WHERE l.user_id = ?
        ORDER BY l.is_pinned DESC, l.pinned_order DESC, COALESCE(l.is_liked, 0) DESC, COALESCE(l.last_played, l.added_at) DESC
    ");
    $stmt->execute([$uid]);
    $games = $stmt->fetchAll();
    foreach ($games as &$g) {
        $g['owned'] = true;
        $g['cover_src'] = !empty($g['cover_url']) ? $g['cover_url'] : ('media.php?type=cover&id=' . $g['id']);
        $g['is_pinned'] = (int)($g['is_pinned'] ?? 0);
        $g['is_liked'] = (int)($g['is_liked'] ?? 0);
        $g['playtime_minutes'] = (int)($g['playtime_minutes'] ?? 0);
        $g['ach_unlocked'] = (int)($g['ach_unlocked'] ?? 0);
        $g['ach_total'] = (int)($g['ach_total'] ?? 0);
    }
    unset($g);
    return $games;
}

try {
    switch ($action) {

        // ===== ПРОФИЛЬ ДРУГОГО ПОЛЬЗОВАТЕЛЯ (библиотека СТРОГО его) =====
        case 'profile': {
            $me = getCurrentUser();
            $id = isset($_GET['id']) ? (int)$_GET['id'] : 0;
            $username = trim($_GET['username'] ?? '');
            if ($id > 0) {
                $st = $pdo->prepare("SELECT * FROM users WHERE id = ? LIMIT 1");
                $st->execute([$id]);
            } elseif ($username !== '') {
                $st = $pdo->prepare("SELECT * FROM users WHERE username = ? LIMIT 1");
                $st->execute([$username]);
            } else {
                http_response_code(400);
                echo json_encode(['ok' => false, 'error' => 'Укажи id или username'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $u = $st->fetch();
            if (!$u) {
                http_response_code(404);
                echo json_encode(['ok' => false, 'error' => 'Пользователь не найден'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $uid = (int)$u['id'];
            $meId = $me ? (int)$me['id'] : 0;
            $rel = $meId ? relationBetween($pdo, $meId, $uid) : 'none';

            $profile = userPublicRow($u);
            $profile['relation'] = $rel;

            // Скрываем бан-детали от обычных, админу — можно
            $isAdmin = $me && (($me['role'] ?? '') === 'admin');
            if ($isAdmin) {
                $profile['ban_reason'] = $u['ban_reason'] ?? '';
                $profile['banned_until'] = $u['banned_until'] ?? null;
                $profile['banned_at'] = $u['banned_at'] ?? null;
                $profile['banned_by'] = $u['banned_by'] ?? null;
                if (!empty($u['banned_by'])) {
                    $bn = $pdo->prepare("SELECT username FROM users WHERE id = ?");
                    $bn->execute([(int)$u['banned_by']]);
                    $profile['banned_by_name'] = $bn->fetchColumn() ?: '';
                }
            }

            // Библиотека ТОЛЬКО этого пользователя — не текущего
            $library = fetchUserLibrary($pdo, $uid);

            // Статы
            $gamesCount = count($library);
            $playtime = 0;
            foreach ($library as $g) $playtime += (int)$g['playtime_minutes'];

            echo json_encode([
                'ok' => true,
                'profile' => $profile,
                'library' => $library,
                'stats' => [
                    'games' => $gamesCount,
                    'playtime_minutes' => $playtime,
                    'karma' => (int)($u['karma'] ?? 0),
                ],
                'viewer_is_admin' => $isAdmin,
            ], JSON_UNESCAPED_UNICODE);
            break;
        }

        case 'list': {
            $me = requireUser();
            $uid = (int)$me['id'];
            $meRow = userPublicRow($me);

            $accepted = $pdo->prepare("
                SELECT u.* FROM friendships f
                JOIN users u ON u.id = IF(f.user_id = ?, f.friend_id, f.user_id)
                WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
                ORDER BY u.username
            ");
            $accepted->execute([$uid, $uid, $uid]);
            $friends = array_map('userPublicRow', $accepted->fetchAll());

            $incoming = $pdo->prepare("
                SELECT u.* FROM friendships f
                JOIN users u ON u.id = f.user_id
                WHERE f.friend_id = ? AND f.status = 'pending'
                ORDER BY f.created_at DESC
            ");
            $incoming->execute([$uid]);
            $inc = array_map('userPublicRow', $incoming->fetchAll());

            $outgoing = $pdo->prepare("
                SELECT u.* FROM friendships f
                JOIN users u ON u.id = f.friend_id
                WHERE f.user_id = ? AND f.status = 'pending'
                ORDER BY f.created_at DESC
            ");
            $outgoing->execute([$uid]);
            $out = array_map('userPublicRow', $outgoing->fetchAll());

            echo json_encode([
                'ok' => true,
                'me' => $meRow,
                'friends' => $friends,
                'online' => $friends, // нет presence — показываем всех
                'incoming' => $inc,
                'outgoing' => $out,
            ], JSON_UNESCAPED_UNICODE);
            break;
        }

        case 'of_user': {
            $me = getCurrentUser();
            $id = isset($_GET['id']) ? (int)$_GET['id'] : ($me ? (int)$me['id'] : 0);
            if ($id <= 0) {
                echo json_encode(['ok' => true, 'friends' => []], JSON_UNESCAPED_UNICODE);
                break;
            }
            $st = $pdo->prepare("
                SELECT u.* FROM friendships f
                JOIN users u ON u.id = IF(f.user_id = ?, f.friend_id, f.user_id)
                WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
                ORDER BY u.username
            ");
            $st->execute([$id, $id, $id]);
            echo json_encode(['ok' => true, 'friends' => array_map('userPublicRow', $st->fetchAll())], JSON_UNESCAPED_UNICODE);
            break;
        }

        case 'owns_games': {
            $me = requireUser();
            $raw = $_GET['game_ids'] ?? '';
            if (is_array($raw)) $ids = array_map('intval', $raw);
            else $ids = array_filter(array_map('intval', preg_split('/[,\s]+/', (string)$raw)));
            $ids = array_values(array_unique(array_filter($ids)));
            $owns = [];
            if ($ids) {
                $stF = $pdo->prepare("SELECT u.id FROM friendships f
                    JOIN users u ON u.id = IF(f.user_id = ?, f.friend_id, f.user_id)
                    WHERE f.status = 'accepted' AND (f.user_id = ? OR f.friend_id = ?)");
                $stF->execute([(int)$me['id'], (int)$me['id'], (int)$me['id']]);
                $friendIds = array_map(fn($r) => (int)$r['id'], $stF->fetchAll());
                if ($friendIds) {
                    $in = implode(',', array_fill(0, count($ids), '?'));
                    $st = $pdo->prepare("SELECT user_id, game_id FROM library WHERE game_id IN ($in) AND user_id IN (" . implode(',', array_fill(0, count($friendIds), '?')) . ")");
                    $st->execute([...$ids, ...$friendIds]);
                    foreach ($st->fetchAll() as $row) {
                        $uid = (int)$row['user_id'];
                        $gid = (int)$row['game_id'];
                        if (!isset($owns[$uid])) $owns[$uid] = [];
                        $owns[$uid][] = $gid;
                    }
                }
            }
            echo json_encode(['ok' => true, 'owns' => $owns], JSON_UNESCAPED_UNICODE);
            break;
        }

        case 'search': {
            $me = requireUser();
            $q = trim($_GET['q'] ?? '');
            if (mb_strlen($q) < 1) {
                echo json_encode(['ok' => true, 'users' => []], JSON_UNESCAPED_UNICODE);
                break;
            }
            $st = $pdo->prepare("SELECT * FROM users WHERE (username LIKE ? OR friend_code LIKE ?) AND COALESCE(is_banned,0) = 0 AND id != ? ORDER BY username LIMIT 20");
            $like = '%' . $q . '%';
            $st->execute([$like, $like, (int)$me['id']]);
            $users = [];
            foreach ($st->fetchAll() as $row) {
                $u = userPublicRow($row);
                $u['relation'] = relationBetween($pdo, (int)$me['id'], (int)$row['id']);
                $users[] = $u;
            }
            echo json_encode(['ok' => true, 'users' => $users], JSON_UNESCAPED_UNICODE);
            break;
        }

        case 'request': {
            if ($method !== 'POST') { http_response_code(405); echo json_encode(['ok'=>false,'error'=>'POST']); break; }
            $me = requireUser();
            $body = jsonBody();
            checkCsrf($body);
            $to = (int)($body['user_id'] ?? 0);
            if ($to <= 0 || $to === (int)$me['id']) {
                echo json_encode(['ok' => false, 'error' => 'Некорректный пользователь'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $rel = relationBetween($pdo, (int)$me['id'], $to);
            if ($rel === 'friends' || $rel === 'outgoing') {
                echo json_encode(['ok' => true, 'status' => $rel], JSON_UNESCAPED_UNICODE);
                break;
            }
            if ($rel === 'incoming') {
                // принять
                $pdo->prepare("UPDATE friendships SET status = 'accepted' WHERE
                    ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) AND status = 'pending'")
                    ->execute([$to, (int)$me['id'], (int)$me['id'], $to]);
                try {
                    $meta = json_encode(['from_id' => (int)$me['id'], 'from_username' => $me['username'] ?? ''], JSON_UNESCAPED_UNICODE);
                    $pdo->prepare("INSERT INTO notifications (user_id, type, title, body, meta_json) VALUES (?, 'friend_accepted', ?, ?, ?)")
                        ->execute([$to, 'Заявка принята', ($me['username'] ?? 'Пользователь') . ' принял(а) вашу заявку в друзья', $meta]);
                } catch (Throwable $e) {}
                echo json_encode(['ok' => true, 'status' => 'friends'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $pdo->prepare("INSERT INTO friendships (user_id, friend_id, status) VALUES (?, ?, 'pending')")
                ->execute([(int)$me['id'], $to]);
            try {
                $meta = json_encode(['from_id' => (int)$me['id'], 'from_username' => $me['username'] ?? ''], JSON_UNESCAPED_UNICODE);
                $pdo->prepare("INSERT INTO notifications (user_id, type, title, body, meta_json) VALUES (?, 'friend_request', ?, ?, ?)")
                    ->execute([$to, 'Заявка в друзья', 'Пользователь ' . ($me['username'] ?? '') . ' хочет добавить вас в друзья', $meta]);
            } catch (Throwable $e) {}
            echo json_encode(['ok' => true, 'status' => 'outgoing'], JSON_UNESCAPED_UNICODE);
            break;
        }

        case 'respond': {
            if ($method !== 'POST') { http_response_code(405); echo json_encode(['ok'=>false,'error'=>'POST']); break; }
            $me = requireUser();
            $body = jsonBody();
            checkCsrf($body);
            $from = (int)($body['user_id'] ?? 0);
            $accept = !empty($body['accept']);
            if ($from <= 0) {
                echo json_encode(['ok' => false, 'error' => 'user_id'], JSON_UNESCAPED_UNICODE);
                break;
            }
            if ($accept) {
                $pdo->prepare("UPDATE friendships SET status = 'accepted' WHERE user_id = ? AND friend_id = ? AND status = 'pending'")
                    ->execute([$from, (int)$me['id']]);
                try {
                    $meta = json_encode(['from_id' => (int)$me['id'], 'from_username' => $me['username'] ?? ''], JSON_UNESCAPED_UNICODE);
                    $pdo->prepare("INSERT INTO notifications (user_id, type, title, body, meta_json) VALUES (?, 'friend_accepted', ?, ?, ?)")
                        ->execute([$from, 'Заявка принята', ($me['username'] ?? 'Пользователь') . ' принял(а) вашу заявку в друзья', $meta]);
                } catch (Throwable $e) {}
            } else {
                $pdo->prepare("DELETE FROM friendships WHERE user_id = ? AND friend_id = ? AND status = 'pending'")
                    ->execute([$from, (int)$me['id']]);
            }
            echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
            break;
        }

        case 'remove': {
            if ($method !== 'POST') { http_response_code(405); echo json_encode(['ok'=>false,'error'=>'POST']); break; }
            $me = requireUser();
            $body = jsonBody();
            checkCsrf($body);
            $other = (int)($body['user_id'] ?? 0);
            $pdo->prepare("DELETE FROM friendships WHERE
                (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)")
                ->execute([(int)$me['id'], $other, $other, (int)$me['id']]);
            echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
            break;
        }


        case 'user_comments': {
            $id = (int)($_GET['user_id'] ?? 0);
            if ($id <= 0) {
                echo json_encode(['ok' => true, 'comments' => []], JSON_UNESCAPED_UNICODE);
                break;
            }
            $st = $pdo->prepare("
                SELECT c.id, c.body, c.created_at, c.game_id, c.parent_id, c.user_id,
                       g.title AS game_title, g.cover_url,
                       u.username, u.avatar, u.avatar_color, u.avatar_url, u.banner_url,
                       (SELECT r.value FROM ratings r WHERE r.user_id = c.user_id AND r.game_id = c.game_id LIMIT 1) AS rating
                FROM comments c
                JOIN games g ON g.id = c.game_id
                JOIN users u ON u.id = c.user_id
                WHERE c.user_id = ? AND (c.parent_id IS NULL OR c.parent_id = 0)
                ORDER BY c.created_at DESC
                LIMIT 100
            ");
            $st->execute([$id]);
            $rows = $st->fetchAll();
            foreach ($rows as &$c) {
                $c['cover_src'] = !empty($c['cover_url']) ? $c['cover_url'] : ('media.php?type=cover&id=' . $c['game_id']);
            }
            unset($c);
            echo json_encode(['ok' => true, 'comments' => $rows], JSON_UNESCAPED_UNICODE);
            break;
        }

        default:
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Unknown action'], JSON_UNESCAPED_UNICODE);
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
}
