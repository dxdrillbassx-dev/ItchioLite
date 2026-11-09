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
            $uid = (int)$user['id'];
            $rows = [];
            try {
                $st = $pdo->prepare("
                  SELECT p.id, p.name, p.slug, p.avatar_url, p.owner_id,
                    COALESCE(pm.role, 'member') AS my_role
                  FROM publisher_members pm
                  INNER JOIN publishers p ON p.id = pm.publisher_id
                  WHERE pm.user_id = ?
                  ORDER BY p.name ASC
                ");
                $st->execute([$uid]);
                $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
            } catch (Throwable $e) {
                jsonOut(['ok' => false, 'error' => 'DB members: ' . $e->getMessage()], 500);
            }
            try {
                $st2 = $pdo->prepare("SELECT id, name, slug, avatar_url, owner_id FROM publishers WHERE owner_id = ?");
                $st2->execute([$uid]);
                foreach ($st2->fetchAll(PDO::FETCH_ASSOC) ?: [] as $r) {
                    $found = false;
                    foreach ($rows as $ex) {
                        if ((int)$ex['id'] === (int)$r['id']) { $found = true; break; }
                    }
                    if (!$found) {
                        $r['my_role'] = 'owner';
                        $rows[] = $r;
                        try {
                            $pdo->prepare("INSERT IGNORE INTO publisher_members (publisher_id, user_id, role) VALUES (?, ?, 'owner')")
                                ->execute([(int)$r['id'], $uid]);
                        } catch (Throwable $e) {}
                    }
                }
            } catch (Throwable $e) {}
            jsonOut(['ok' => true, 'publishers' => $rows, 'user_id' => $uid, 'count' => count($rows)]);
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
            $viewerId = 0;
            try {
                $meTmp = getCurrentUser();
                if ($meTmp) $viewerId = (int)$meTmp['id'];
            } catch (Throwable $e) {}
            $gs = $pdo->prepare("
                SELECT g.id, g.title, g.slug, g.cover_url, g.price, g.discount_percent, g.genre, g.short_description, g.developer_name,
                  CASE WHEN l.user_id IS NOT NULL THEN 1 ELSE 0 END AS owned
                FROM games g
                LEFT JOIN library l ON l.game_id = g.id AND l.user_id = ?
                WHERE g.publisher_id = ? AND g.is_published = 1 AND COALESCE(g.status,'published') NOT IN ('pending','rejected','draft')
                ORDER BY g.id DESC
                LIMIT 60
            ");
            $gs->execute([$viewerId, (int)$p['id']]);
            $p['games'] = $gs->fetchAll();

            // игроки: уникальные владельцы игр этого издательства
            $pc = $pdo->prepare("
                SELECT COUNT(DISTINCT l.user_id) FROM library l
                INNER JOIN games g ON g.id = l.game_id
                WHERE g.publisher_id = ? AND g.is_published = 1
            ");
            try {
                $pc->execute([(int)$p['id']]);
                $p['players_count'] = (int)$pc->fetchColumn();
            } catch (Throwable $e) {
                $p['players_count'] = 0;
            }

            $me = getCurrentUser();
            $p['is_owner'] = false;
            $p['my_role'] = null;
            $p['is_subscribed'] = false;
            if ($me) {
                $uid = (int)$me['id'];
                $r = $pdo->prepare("SELECT role FROM publisher_members WHERE publisher_id=? AND user_id=?");
                $r->execute([(int)$p['id'], $uid]);
                $row = $r->fetch();
                if ($row) {
                    $p['my_role'] = $row['role'];
                    $p['is_owner'] = ($row['role'] === 'owner');
                }
                try {
                    $s = $pdo->prepare("SELECT 1 FROM publisher_subscriptions WHERE publisher_id=? AND user_id=?");
                    $s->execute([(int)$p['id'], $uid]);
                    $p['is_subscribed'] = (bool)$s->fetch();
                } catch (Throwable $e) {}
            }
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

        case 'subscribe': {
            if ($method !== 'POST') jsonOut(['ok'=>false], 405);
            $user = requireUserP();
            $body = json_decode(file_get_contents('php://input'), true);
            if (!is_array($body)) $body = $_POST;
            if (!verifyCsrfToken($body['csrf_token'] ?? '')) jsonOut(['ok'=>false,'error'=>'CSRF'], 403);
            $pid = (int)($body['publisher_id'] ?? 0);
            if ($pid <= 0) jsonOut(['ok'=>false,'error'=>'publisher_id'], 400);
            $chk = $pdo->prepare("SELECT id FROM publishers WHERE id = ?");
            $chk->execute([$pid]);
            if (!$chk->fetch()) jsonOut(['ok'=>false,'error'=>'Не найдено'], 404);
            $pdo->prepare("INSERT IGNORE INTO publisher_subscriptions (publisher_id, user_id) VALUES (?, ?)")
                ->execute([$pid, (int)$user['id']]);
            jsonOut(['ok' => true, 'subscribed' => true]);
        }

        case 'unsubscribe': {
            if ($method !== 'POST') jsonOut(['ok'=>false], 405);
            $user = requireUserP();
            $body = json_decode(file_get_contents('php://input'), true);
            if (!is_array($body)) $body = $_POST;
            if (!verifyCsrfToken($body['csrf_token'] ?? '')) jsonOut(['ok'=>false,'error'=>'CSRF'], 403);
            $pid = (int)($body['publisher_id'] ?? 0);
            if ($pid <= 0) jsonOut(['ok'=>false,'error'=>'publisher_id'], 400);
            $pdo->prepare("DELETE FROM publisher_subscriptions WHERE publisher_id=? AND user_id=?")
                ->execute([$pid, (int)$user['id']]);
            jsonOut(['ok' => true, 'subscribed' => false]);
        }

        case 'delete': {
            if ($method !== 'POST') jsonOut(['ok'=>false], 405);
            $user = requireUserP();
            $body = json_decode(file_get_contents('php://input'), true);
            if (!is_array($body)) $body = $_POST;
            if (!verifyCsrfToken($body['csrf_token'] ?? '')) jsonOut(['ok'=>false,'error'=>'CSRF'], 403);
            $pid = (int)($body['publisher_id'] ?? $body['id'] ?? 0);
            if ($pid <= 0) jsonOut(['ok'=>false,'error'=>'id'], 400);
            $own = $pdo->prepare("SELECT role FROM publisher_members WHERE publisher_id=? AND user_id=?");
            $own->execute([$pid, (int)$user['id']]);
            $role = $own->fetchColumn();
            if ($role !== 'owner' && ($user['role'] ?? '') !== 'admin') {
                jsonOut(['ok'=>false,'error'=>'Только владелец может удалить'], 403);
            }
            $pdo->prepare("UPDATE games SET publisher_id = NULL WHERE publisher_id = ?")->execute([$pid]);
            $pdo->prepare("DELETE FROM publisher_subscriptions WHERE publisher_id = ?")->execute([$pid]);
            $pdo->prepare("DELETE FROM publisher_members WHERE publisher_id = ?")->execute([$pid]);
            $pdo->prepare("DELETE FROM publishers WHERE id = ?")->execute([$pid]);
            $pdo->prepare("UPDATE users SET display_publisher_id = 0 WHERE display_publisher_id = ?")->execute([$pid]);
            jsonOut(['ok' => true]);
        }

        default:
            jsonOut(['ok'=>false,'error'=>'Unknown action'], 400);
    }
} catch (Throwable $e) {
    jsonOut(['ok'=>false,'error'=>$e->getMessage()], 500);
}
