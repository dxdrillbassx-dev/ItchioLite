<?php
// CATio — Издательства
require_once __DIR__ . '/../auth.php';
require_once __DIR__ . '/../db.php';

header('Content-Type: application/json; charset=utf-8');

function jsonOut($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function requireUserP() {
    $u = getCurrentUser();
    if (!$u) jsonOut(['ok' => false, 'error' => 'Войдите в аккаунт'], 401);
    return $u;
}

function slugifyPub($name) {
    $s = mb_strtolower(trim($name), 'UTF-8');
    $s = preg_replace('/[^\p{L}\p{N}]+/u', '-', $s);
    $s = trim($s, '-');
    if ($s === '') $s = 'pub';
    return mb_substr($s, 0, 120);
}

function savePubUpload($field, $dir, $maxMb = 5) {
    if (empty($_FILES[$field]) || $_FILES[$field]['error'] !== UPLOAD_ERR_OK) return null;
    $f = $_FILES[$field];
    if ($f['size'] > $maxMb * 1024 * 1024) throw new RuntimeException('Файл слишком большой');
    $ext = strtolower(pathinfo($f['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, ['jpg','jpeg','png','webp','gif'], true)) throw new RuntimeException('Только изображения');
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $name = bin2hex(random_bytes(8)) . '.' . ($ext === 'jpeg' ? 'jpg' : $ext);
    $path = rtrim($dir, '/') . '/' . $name;
    if (!move_uploaded_file($f['tmp_name'], $path)) throw new RuntimeException('Не удалось сохранить файл');
    // relative from web root
    $rel = 'uploads/publishers/' . basename($dir) . '/' . $name;
    // if dir is already .../uploads/publishers/avatars
    if (strpos(str_replace('\\','/',$dir), 'publishers') !== false) {
        $parts = explode('publishers/', str_replace('\\','/',$dir));
        $sub = end($parts);
        $rel = 'uploads/publishers/' . trim($sub, '/') . '/' . $name;
    }
    return $rel;
}

$pdo = getDB();
$action = $_GET['action'] ?? $_POST['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    switch ($action) {

        case 'mine': {
            $user = requireUserP();
            $stmt = $pdo->prepare("
                SELECT p.*, pm.role AS my_role,
                  (SELECT COUNT(*) FROM games g WHERE g.publisher_id = p.id AND g.is_published = 1) AS games_count,
                  (SELECT COUNT(*) FROM publisher_members m WHERE m.publisher_id = p.id) AS members_count
                FROM publishers p
                INNER JOIN publisher_members pm ON pm.publisher_id = p.id AND pm.user_id = ?
                ORDER BY p.name ASC
            ");
            $stmt->execute([(int)$user['id']]);
            jsonOut(['ok' => true, 'publishers' => $stmt->fetchAll()]);
        }

        case 'get': {
            $id = (int)($_GET['id'] ?? 0);
            $slug = trim($_GET['slug'] ?? '');
            if ($id <= 0 && $slug === '') jsonOut(['ok'=>false,'error'=>'id/slug'], 400);
            if ($id > 0) {
                $st = $pdo->prepare("SELECT * FROM publishers WHERE id = ?");
                $st->execute([$id]);
            } else {
                $st = $pdo->prepare("SELECT * FROM publishers WHERE slug = ?");
                $st->execute([$slug]);
            }
            $p = $st->fetch();
            if (!$p) jsonOut(['ok'=>false,'error'=>'Не найдено'], 404);
            $ms = $pdo->prepare("
                SELECT u.id, u.username, u.avatar_url, u.avatar_color, pm.role
                FROM publisher_members pm
                JOIN users u ON u.id = pm.user_id
                WHERE pm.publisher_id = ?
                ORDER BY pm.role = 'owner' DESC, u.username ASC
            ");
            $ms->execute([(int)$p['id']]);
            $p['members'] = $ms->fetchAll();
            $gs = $pdo->prepare("
                SELECT id, title, slug, cover_url, price, discount_percent, genre, short_description, developer_name
                FROM games
                WHERE publisher_id = ? AND is_published = 1 AND COALESCE(status,'published') NOT IN ('pending','rejected','draft')
                ORDER BY id DESC
                LIMIT 60
            ");
            $gs->execute([(int)$p['id']]);
            $p['games'] = $gs->fetchAll();
            jsonOut(['ok' => true, 'publisher' => $p]);
        }

        case 'create': {
            if ($method !== 'POST') jsonOut(['ok'=>false], 405);
            $user = requireUserP();
            if (!verifyCsrfToken($_POST['csrf_token'] ?? '')) jsonOut(['ok'=>false,'error'=>'CSRF'], 403);
            $name = trim($_POST['name'] ?? '');
            $desc = trim($_POST['description'] ?? '');
            if ($name === '' || mb_strlen($name) < 2) jsonOut(['ok'=>false,'error'=>'Название: минимум 2 символа'], 400);
            if (mb_strlen($name) > 120) jsonOut(['ok'=>false,'error'=>'Название слишком длинное'], 400);
            $slug = slugifyPub($name);
            $baseSlug = $slug;
            $n = 0;
            while (true) {
                $chk = $pdo->prepare("SELECT id FROM publishers WHERE slug = ?");
                $chk->execute([$slug]);
                if (!$chk->fetch()) break;
                $n++;
                $slug = $baseSlug . '-' . $n;
            }
            $root = dirname(__DIR__) . '/uploads/publishers';
            $avatar = null;
            $banner = null;
            try { $avatar = savePubUpload('avatar', $root . '/avatars', 4); } catch (Throwable $e) {}
            try { $banner = savePubUpload('banner', $root . '/banners', 8); } catch (Throwable $e) {}

            $pdo->prepare("INSERT INTO publishers (name, slug, description, avatar_url, banner_url, owner_id) VALUES (?,?,?,?,?,?)")
                ->execute([$name, $slug, $desc, $avatar, $banner, (int)$user['id']]);
            $pid = (int)$pdo->lastInsertId();
            $pdo->prepare("INSERT INTO publisher_members (publisher_id, user_id, role) VALUES (?,?, 'owner')")
                ->execute([$pid, (int)$user['id']]);

            // members: comma ids
            $members = trim($_POST['members'] ?? '');
            if ($members !== '') {
                $ids = array_unique(array_filter(array_map('intval', explode(',', $members))));
                $ins = $pdo->prepare("INSERT IGNORE INTO publisher_members (publisher_id, user_id, role) VALUES (?, ?, 'member')");
                foreach ($ids as $uid) {
                    if ($uid === (int)$user['id'] || $uid <= 0) continue;
                    $ins->execute([$pid, $uid]);
                }
            }
            $st = $pdo->prepare("SELECT * FROM publishers WHERE id = ?");
            $st->execute([$pid]);
            jsonOut(['ok' => true, 'publisher' => $st->fetch()]);
        }

        case 'search_users': {
            $user = requireUserP();
            $q = trim($_GET['q'] ?? '');
            if (mb_strlen($q) < 1) jsonOut(['ok'=>true,'users'=>[]]);
            $st = $pdo->prepare("
                SELECT id, username, avatar_url, avatar_color
                FROM users
                WHERE username LIKE ? AND id != ?
                ORDER BY username ASC
                LIMIT 20
            ");
            $st->execute(['%' . $q . '%', (int)$user['id']]);
            jsonOut(['ok'=>true, 'users'=>$st->fetchAll()]);
        }

        case 'for_user': {
            $uid = (int)($_GET['user_id'] ?? 0);
            if ($uid <= 0) jsonOut(['ok'=>false,'error'=>'user_id'], 400);
            $st = $pdo->prepare("
                SELECT p.id, p.name, p.slug, p.avatar_url, pm.role
                FROM publisher_members pm
                JOIN publishers p ON p.id = pm.publisher_id
                WHERE pm.user_id = ?
                ORDER BY pm.role = 'owner' DESC, p.name ASC
            ");
            $st->execute([$uid]);
            $display = null;
            try {
                $d = $pdo->prepare("SELECT display_publisher_id FROM users WHERE id = ?");
                $d->execute([$uid]);
                $row = $d->fetch();
                if ($row && array_key_exists('display_publisher_id', $row)) {
                    $display = $row['display_publisher_id'];
                    if ($display !== null) $display = (int)$display;
                }
            } catch (Throwable $e) {}
            jsonOut(['ok'=>true, 'publishers'=>$st->fetchAll(), 'display_publisher_id'=>$display]);
        }

        case 'set_display': {
            if ($method !== 'POST') jsonOut(['ok'=>false], 405);
            $user = requireUserP();
            $body = json_decode(file_get_contents('php://input'), true);
            if (!is_array($body)) $body = $_POST;
            if (!verifyCsrfToken($body['csrf_token'] ?? '')) jsonOut(['ok'=>false,'error'=>'CSRF'], 403);
            // null / '' / 'hide' => 0 (скрыто), иначе id издательства участника
            $raw = $body['display_publisher_id'] ?? 'hide';
            if ($raw === '' || $raw === 'hide' || $raw === null) {
                $val = 0;
            } else {
                $val = (int)$raw;
                if ($val > 0) {
                    $chk = $pdo->prepare("SELECT 1 FROM publisher_members WHERE publisher_id=? AND user_id=?");
                    $chk->execute([$val, (int)$user['id']]);
                    if (!$chk->fetch()) jsonOut(['ok'=>false,'error'=>'Вы не в этом издательстве'], 400);
                } else {
                    $val = 0;
                }
            }
            $pdo->prepare("UPDATE users SET display_publisher_id = ? WHERE id = ?")->execute([$val, (int)$user['id']]);
            jsonOut(['ok'=>true, 'display_publisher_id'=>$val]);
        }

        default:
            jsonOut(['ok'=>false,'error'=>'Unknown action'], 400);
    }
} catch (Throwable $e) {
    jsonOut(['ok'=>false,'error'=>$e->getMessage()], 500);
}
