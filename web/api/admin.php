<?php
// CATio — админ: редактирование пользователей, роли, баны
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

function jsonBodyA(): array {
    $b = json_decode(file_get_contents('php://input'), true);
    return is_array($b) ? $b : $_POST;
}
function requireAdminA(): array {
    $u = getCurrentUser();
    if (!$u) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'Нужно войти'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    if (($u['role'] ?? '') !== 'admin') {
        http_response_code(403);
        echo json_encode(['ok' => false, 'error' => 'Только для админов'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    return $u;
}

/** ID самого первого админа (минимальный id среди role=admin; иначе самый первый пользователь). */
function founderAdminId(PDO $pdo): int {
    try {
        $id = $pdo->query("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1")->fetchColumn();
        if ($id) return (int)$id;
    } catch (Throwable $e) {}
    try {
        $id = $pdo->query("SELECT id FROM users ORDER BY id ASC LIMIT 1")->fetchColumn();
        if ($id) return (int)$id;
    } catch (Throwable $e) {}
    return 1;
}

/**
 * Можно ли актору менять роль/банить цель.
 * — нельзя трогать первого админа (кроме него самого и только без снятия админки)
 * — младший админ (больший id) не может снимать/банить старшего админа (меньший id)
 */
function canManageAdminTarget(PDO $pdo, array $actor, array $target, string $newRole = null): array {
    $actorId = (int)$actor['id'];
    $targetId = (int)$target['id'];
    $targetRole = $target['role'] ?? 'user';
    $founder = founderAdminId($pdo);

    // снятие админки с себя — запрет
    if ($newRole !== null && $targetId === $actorId && $newRole !== 'admin' && $targetRole === 'admin') {
        return [false, 'Нельзя снять админку с себя'];
    }

    // первый админ: никто не снимает с него админку и не банит
    if ($targetId === $founder) {
        if ($newRole !== null && $newRole !== 'admin') {
            return [false, 'Нельзя снять админку с главного администратора'];
        }
        if ($newRole === null) {
            // вызов для бана
            if ($actorId !== $founder) {
                return [false, 'Нельзя забанить главного администратора'];
            }
        }
    }

    // цель — админ со старшинством (меньший id): младший не может снять/понизить
    if ($targetRole === 'admin' && $targetId < $actorId) {
        if ($newRole !== null && $newRole !== 'admin') {
            return [false, 'Нельзя снять админку со старшего администратора'];
        }
        if ($newRole === null) {
            return [false, 'Нельзя забанить старшего администратора'];
        }
    }

    return [true, ''];
}

function checkCsrfA(array $body): void {
    if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
        http_response_code(403);
        echo json_encode(['ok' => false, 'error' => 'Неверный CSRF-токен'], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

try {
    switch ($action) {


        case 'list_users': {
            requireAdminA();
            $q = trim($_GET['q'] ?? '');
            $filter = $_GET['filter'] ?? 'all';
            $sql = "SELECT id, username, email, role, balance, karma, avatar, avatar_color, avatar_url, banner_url,
                           created_at, last_seen, COALESCE(is_banned,0) AS is_banned, ban_reason, banned_until
                    FROM users WHERE 1=1";
            $params = [];
            if ($q !== '') {
                $sql .= " AND (username LIKE ? OR email LIKE ?)";
                $params[] = '%' . $q . '%';
                $params[] = '%' . $q . '%';
            }
            if ($filter === 'admin') $sql .= " AND role = 'admin'";
            elseif ($filter === 'developer') $sql .= " AND role = 'developer'";
            elseif ($filter === 'user') $sql .= " AND role = 'user'";
            elseif ($filter === 'banned') $sql .= " AND COALESCE(is_banned,0) = 1";
            $sql .= " ORDER BY id ASC LIMIT 500";
            $st = $pdo->prepare($sql);
            $st->execute($params);
            $rows = $st->fetchAll();
            foreach ($rows as &$u) {
                $u['id'] = (int)$u['id'];
                $u['is_banned'] = (int)$u['is_banned'];
                $u['balance'] = (int)$u['balance'];
                $u['karma'] = (int)($u['karma'] ?? 0);
            }
            unset($u);
            echo json_encode(['ok' => true, 'users' => $rows], JSON_UNESCAPED_UNICODE);
            break;
        }

        case 'get_user': {
            requireAdminA();
            $id = (int)($_GET['id'] ?? 0);
            $st = $pdo->prepare("SELECT id, username, email, role, balance, avatar, avatar_color, avatar_url,
                banner_url, banner_pos, banner_zoom, karma, created_at,
                COALESCE(is_banned,0) AS is_banned, ban_reason, banned_at, banned_until, banned_by
                FROM users WHERE id = ?");
            $st->execute([$id]);
            $u = $st->fetch();
            if (!$u) {
                http_response_code(404);
                echo json_encode(['ok' => false, 'error' => 'Не найден'], JSON_UNESCAPED_UNICODE);
                break;
            }
            if (!empty($u['banned_by'])) {
                $bn = $pdo->prepare("SELECT username FROM users WHERE id = ?");
                $bn->execute([(int)$u['banned_by']]);
                $u['banned_by_name'] = $bn->fetchColumn() ?: '';
            }
            echo json_encode(['ok' => true, 'user' => $u], JSON_UNESCAPED_UNICODE);
            break;
        }

        case 'update_user': {
            if ($method !== 'POST') { http_response_code(405); exit; }
            $admin = requireAdminA();
            $body = jsonBodyA();
            checkCsrfA($body);
            $id = (int)($body['user_id'] ?? 0);
            if ($id <= 0) {
                echo json_encode(['ok' => false, 'error' => 'user_id'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $st = $pdo->prepare("SELECT * FROM users WHERE id = ?");
            $st->execute([$id]);
            $target = $st->fetch();
            if (!$target) {
                echo json_encode(['ok' => false, 'error' => 'Пользователь не найден'], JSON_UNESCAPED_UNICODE);
                break;
            }

            // username
            if (isset($body['username'])) {
                $name = trim($body['username']);
                if ($name === '' || mb_strlen($name) > 32) {
                    echo json_encode(['ok' => false, 'error' => 'Ник 1–32 символа'], JSON_UNESCAPED_UNICODE);
                    break;
                }
                $chk = $pdo->prepare("SELECT id FROM users WHERE username = ? AND id != ?");
                $chk->execute([$name, $id]);
                if ($chk->fetch()) {
                    echo json_encode(['ok' => false, 'error' => 'Ник занят'], JSON_UNESCAPED_UNICODE);
                    break;
                }
                $pdo->prepare("UPDATE users SET username = ? WHERE id = ?")->execute([$name, $id]);
            }

            // role
            if (isset($body['role'])) {
                $role = $body['role'];
                if (!in_array($role, ['user', 'developer', 'admin'], true)) {
                    echo json_encode(['ok' => false, 'error' => 'Некорректная роль'], JSON_UNESCAPED_UNICODE);
                    break;
                }
                [$okRole, $errRole] = canManageAdminTarget($pdo, $admin, $target, $role);
                if (!$okRole) {
                    echo json_encode(['ok' => false, 'error' => $errRole], JSON_UNESCAPED_UNICODE);
                    break;
                }
                $pdo->prepare("UPDATE users SET role = ? WHERE id = ?")->execute([$role, $id]);
            }

            // balance
            if (isset($body['balance'])) {
                $bal = max(0, (int)$body['balance']);
                $pdo->prepare("UPDATE users SET balance = ? WHERE id = ?")->execute([$bal, $id]);
            }

            // karma
            if (isset($body['karma'])) {
                $pdo->prepare("UPDATE users SET karma = ? WHERE id = ?")->execute([(int)$body['karma'], $id]);
            }

            // avatar_color
            if (isset($body['avatar_color']) && preg_match('/^#[0-9a-fA-F]{6}$/', $body['avatar_color'])) {
                $pdo->prepare("UPDATE users SET avatar_color = ? WHERE id = ?")->execute([$body['avatar_color'], $id]);
            }

            echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
            break;
        }

        case 'upload_user_media': {
            if ($method !== 'POST') { http_response_code(405); exit; }
            $admin = requireAdminA();
            // multipart
            $id = (int)($_POST['user_id'] ?? 0);
            $kind = $_POST['kind'] ?? ''; // avatar | banner
            $csrf = $_POST['csrf_token'] ?? '';
            if (!verifyCsrfToken($csrf)) {
                http_response_code(403);
                echo json_encode(['ok' => false, 'error' => 'CSRF'], JSON_UNESCAPED_UNICODE);
                break;
            }
            if ($id <= 0 || !in_array($kind, ['avatar', 'banner'], true)) {
                echo json_encode(['ok' => false, 'error' => 'user_id / kind'], JSON_UNESCAPED_UNICODE);
                break;
            }
            if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                echo json_encode(['ok' => false, 'error' => 'Файл не загружен'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $f = $_FILES['file'];
            $ext = strtolower(pathinfo($f['name'], PATHINFO_EXTENSION));
            if (!in_array($ext, ['jpg','jpeg','png','gif','webp'], true)) {
                echo json_encode(['ok' => false, 'error' => 'Только изображения'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $maxBytes = ($ext === 'gif') ? (50 * 1024 * 1024) : (8 * 1024 * 1024);
            if (($f['size'] ?? 0) > $maxBytes) {
                echo json_encode(['ok' => false, 'error' => $ext === 'gif' ? 'Максимум 50 МБ для GIF' : 'Максимум 8 МБ'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $dir = dirname(__DIR__) . '/uploads/users';
            if (!is_dir($dir)) @mkdir($dir, 0755, true);
            $name = $kind . '_' . $id . '_' . time() . '.' . $ext;
            $path = $dir . '/' . $name;
            if (!move_uploaded_file($f['tmp_name'], $path)) {
                echo json_encode(['ok' => false, 'error' => 'Не удалось сохранить'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $url = 'uploads/users/' . $name;
            $col = $kind === 'avatar' ? 'avatar_url' : 'banner_url';
            $pdo->prepare("UPDATE users SET `$col` = ? WHERE id = ?")->execute([$url, $id]);
            echo json_encode(['ok' => true, 'url' => $url], JSON_UNESCAPED_UNICODE);
            break;
        }

        case 'ban': {
            if ($method !== 'POST') { http_response_code(405); exit; }
            $admin = requireAdminA();
            $body = jsonBodyA();
            checkCsrfA($body);
            $id = (int)($body['user_id'] ?? 0);
            $reason = trim($body['reason'] ?? '');
            $days = isset($body['days']) ? (int)$body['days'] : 0; // 0 = permanent
            if ($id <= 0) {
                echo json_encode(['ok' => false, 'error' => 'user_id'], JSON_UNESCAPED_UNICODE);
                break;
            }
            if ($id === (int)$admin['id']) {
                echo json_encode(['ok' => false, 'error' => 'Нельзя забанить себя'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $stT = $pdo->prepare("SELECT * FROM users WHERE id = ?");
            $stT->execute([$id]);
            $banTarget = $stT->fetch();
            if ($banTarget) {
                [$okBan, $errBan] = canManageAdminTarget($pdo, $admin, $banTarget, null);
                if (!$okBan) {
                    echo json_encode(['ok' => false, 'error' => $errBan], JSON_UNESCAPED_UNICODE);
                    break;
                }
            }
            if ($reason === '') $reason = 'Нарушение правил CATio';
            $until = null;
            if ($days > 0) {
                $until = date('Y-m-d H:i:s', time() + $days * 86400);
            }
            $pdo->prepare("UPDATE users SET is_banned = 1, ban_reason = ?, banned_at = NOW(),
                banned_until = ?, banned_by = ? WHERE id = ?")
                ->execute([$reason, $until, (int)$admin['id'], $id]);
            // снести сессии забаненного
            try {
                $pdo->prepare("DELETE FROM sessions WHERE user_id = ?")->execute([$id]);
            } catch (Throwable $e) {}
            echo json_encode(['ok' => true, 'banned_until' => $until], JSON_UNESCAPED_UNICODE);
            break;
        }

        case 'unban': {
            if ($method !== 'POST') { http_response_code(405); exit; }
            $admin = requireAdminA();
            $body = jsonBodyA();
            checkCsrfA($body);
            $id = (int)($body['user_id'] ?? 0);
            try { $pdo->exec("ALTER TABLE users ADD COLUMN show_unban_notice TINYINT(1) NOT NULL DEFAULT 0"); } catch (Throwable $e) {}
            $pdo->prepare("UPDATE users SET is_banned = 0, ban_reason = '', banned_at = NULL,
                banned_until = NULL, banned_by = NULL, show_unban_notice = 1 WHERE id = ?")->execute([$id]);
            echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
            break;
        }

        case 'dismiss_unban': {
            $u = getCurrentUser();
            if (!$u) {
                http_response_code(401);
                echo json_encode(['ok' => false, 'error' => 'auth'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $body = jsonBodyA();
            // csrf soft
            try { $pdo->exec("ALTER TABLE users ADD COLUMN show_unban_notice TINYINT(1) NOT NULL DEFAULT 0"); } catch (Throwable $e) {}
            $pdo->prepare("UPDATE users SET show_unban_notice = 0 WHERE id = ?")->execute([(int)$u['id']]);
            echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
            break;
        }

        case 'ban_status': {
            // для экрана бана — доступно залогиненному
            $u = getCurrentUser();
            if (!$u) {
                echo json_encode(['ok' => true, 'banned' => false], JSON_UNESCAPED_UNICODE);
                break;
            }
            $st = $pdo->prepare("SELECT COALESCE(is_banned,0) AS is_banned, ban_reason, banned_at, banned_until, banned_by
                FROM users WHERE id = ?");
            $st->execute([(int)$u['id']]);
            $row = $st->fetch() ?: [];
            $banned = (int)($row['is_banned'] ?? 0) === 1;
            // авто-разбан по сроку
            if ($banned && !empty($row['banned_until']) && strtotime($row['banned_until']) < time()) {
                try { $pdo->exec("ALTER TABLE users ADD COLUMN show_unban_notice TINYINT(1) NOT NULL DEFAULT 0"); } catch (Throwable $e) {}
                $pdo->prepare("UPDATE users SET is_banned = 0, ban_reason = '', banned_at = NULL,
                    banned_until = NULL, banned_by = NULL, show_unban_notice = 1 WHERE id = ?")->execute([(int)$u['id']]);
                $banned = false;
            }
            $byName = '';
            if ($banned && !empty($row['banned_by'])) {
                $bn = $pdo->prepare("SELECT username FROM users WHERE id = ?");
                $bn->execute([(int)$row['banned_by']]);
                $byName = $bn->fetchColumn() ?: '';
            }
            echo json_encode([
                'ok' => true,
                'banned' => $banned,
                'reason' => $row['ban_reason'] ?? '',
                'banned_at' => $row['banned_at'] ?? null,
                'banned_until' => $row['banned_until'] ?? null,
                'banned_by_name' => $byName,
            ], JSON_UNESCAPED_UNICODE);
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
