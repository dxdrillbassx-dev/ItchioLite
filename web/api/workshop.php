<?php
/**
 * CATio Workshop API — мастерская (Nexus-like)
 * actions: stats, games, mods, media, genres, tags
 */
while (ob_get_level() > 0) { @ob_end_clean(); }
ob_start();

foreach ([__DIR__ . '/../config.php', __DIR__ . '/config.php'] as $_cfg) {
    if (is_file($_cfg)) { require_once $_cfg; break; }
}
require_once __DIR__ . '/../db.php';
if (is_file(__DIR__ . '/../auth.php')) require_once __DIR__ . '/../auth.php';

function ws_json($data, int $code = 200): void {
    while (ob_get_level() > 0) { @ob_end_clean(); }
    if (!headers_sent()) {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
    }
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function ws_str(array $a, string $k, string $d = ''): string {
    return array_key_exists($k, $a) ? trim((string)$a[$k]) : $d;
}
function ws_int(array $a, string $k, int $d = 0): int {
    return array_key_exists($k, $a) ? (int)$a[$k] : $d;
}


function ws_notify_admins(PDO $pdo, string $title, string $body, array $meta = []): void {
    try {
        $admins = $pdo->query("SELECT id FROM users WHERE role = 'admin'")->fetchAll(PDO::FETCH_ASSOC) ?: [];
        if (!$admins) return;
        $st = $pdo->prepare("INSERT INTO notifications (user_id, type, title, body, meta_json) VALUES (?,?,?,?,?)");
        $metaJson = json_encode($meta, JSON_UNESCAPED_UNICODE);
        foreach ($admins as $a) {
            $st->execute([(int)$a['id'], 'workshop_review', $title, $body, $metaJson]);
        }
    } catch (Throwable $e) {}
}


try {
    $pdo = getDB();
} catch (Throwable $e) {
    ws_json(['ok' => false, 'error' => 'DB error'], 500);
}

$action = $_GET['action'] ?? $_POST['action'] ?? '';

try {
    switch ($action) {
        case 'stats': {
            $games = (int)$pdo->query("SELECT COUNT(*) FROM games WHERE (status = 'published' OR (status IS NULL AND COALESCE(is_published,1) = 1)) AND COALESCE(category,'game') = 'game'")->fetchColumn();
            $mods = 0;
            $views = 0;
            try {
                $mods = (int)$pdo->query("SELECT COUNT(*) FROM workshop_mods WHERE status = 'published'")->fetchColumn();
            } catch (Throwable $e) {}
            try {
                $vMods = (int)$pdo->query("SELECT COALESCE(SUM(views),0) FROM workshop_mods WHERE status = 'published'")->fetchColumn();
                $vMedia = 0;
                $vAssets = 0;
                try { $vMedia = (int)$pdo->query("SELECT COALESCE(SUM(views),0) FROM workshop_media WHERE status = 'published'")->fetchColumn(); } catch (Throwable $e) {}
                try { $vAssets = (int)$pdo->query("SELECT COALESCE(SUM(views),0) FROM workshop_assets WHERE status = 'published'")->fetchColumn(); } catch (Throwable $e) {}
                $views = $vMods + $vMedia + $vAssets;
            } catch (Throwable $e) {}
            $users = (int)$pdo->query("SELECT COUNT(*) FROM users")->fetchColumn();
            // random banner from published games
            $banner = null;
            try {
                $st = $pdo->query("SELECT id, title, slug, banner_url, cover_url FROM games WHERE (status = 'published' OR (status IS NULL AND COALESCE(is_published,1) = 1)) AND (banner_url IS NOT NULL AND banner_url != '' OR cover_url IS NOT NULL AND cover_url != '') ORDER BY RAND() LIMIT 1");
                $banner = $st->fetch(PDO::FETCH_ASSOC) ?: null;
            } catch (Throwable $e) {}
            ws_json([
                'ok' => true,
                'stats' => [
                    'games' => $games,
                    'mods' => $mods,
                    'views' => $views,
                    'downloads' => $views, // backward-compat
                    'users' => $users,
                ],
                'banner' => $banner,
            ]);
        }

        case 'games': {
            $q = ws_str($_GET, 'q');
            $genre = ws_str($_GET, 'genre');
            $page = max(1, ws_int($_GET, 'page', 1));
            $limit = min(48, max(1, ws_int($_GET, 'limit', 24)));
            $offset = ($page - 1) * $limit;

            $where = ["(g.status = 'published' OR (g.status IS NULL AND COALESCE(g.is_published,1) = 1))", "COALESCE(g.category,'game') = 'game'"];
            $params = [];
            if ($q !== '') {
                $where[] = "(g.title LIKE ? OR g.short_description LIKE ? OR g.developer_name LIKE ?)";
                $like = '%' . $q . '%';
                $params[] = $like; $params[] = $like; $params[] = $like;
            }
            if ($genre !== '') {
                $where[] = "g.genre LIKE ?";
                $params[] = '%' . $genre . '%';
            }
            $sqlWhere = implode(' AND ', $where);

            $cnt = $pdo->prepare("SELECT COUNT(*) FROM games g WHERE $sqlWhere");
            $cnt->execute($params);
            $total = (int)$cnt->fetchColumn();

            $st = $pdo->prepare("SELECT g.id, g.title, g.slug, g.short_description, g.cover_url, g.banner_url, g.icon_url,
                g.genre, g.tags, g.developer_name, g.developer, g.price, g.rating, g.download_count
                FROM games g WHERE $sqlWhere
                ORDER BY g.title ASC
                LIMIT $limit OFFSET $offset");
            $st->execute($params);
            $list = $st->fetchAll(PDO::FETCH_ASSOC);

            // mod counts per game
            $modCounts = [];
            try {
                $ids = array_column($list, 'id');
                if ($ids) {
                    $in = implode(',', array_map('intval', $ids));
                    $mc = $pdo->query("SELECT game_id, COUNT(*) AS c FROM workshop_mods WHERE status='published' AND game_id IN ($in) GROUP BY game_id");
                    while ($r = $mc->fetch(PDO::FETCH_ASSOC)) $modCounts[(int)$r['game_id']] = (int)$r['c'];
                }
            } catch (Throwable $e) {}
            foreach ($list as &$g) {
                $g['mods_count'] = $modCounts[(int)$g['id']] ?? 0;
            }
            unset($g);

            ws_json(['ok' => true, 'games' => $list, 'total' => $total, 'page' => $page, 'limit' => $limit]);
        }

        case 'game': {
            $id = ws_int($_GET, 'id', 0);
            if ($id <= 0) ws_json(['ok' => false, 'error' => 'id required'], 400);
            $st = $pdo->prepare("SELECT g.id, g.title, g.slug, g.short_description, g.description, g.cover_url, g.banner_url, g.icon_url,
                g.genre, g.tags, g.developer_name, g.developer, g.rating, g.download_count
                FROM games g
                WHERE g.id = ? AND (g.status = 'published' OR (g.status IS NULL AND COALESCE(g.is_published,1) = 1))
                LIMIT 1");
            $st->execute([$id]);
            $game = $st->fetch(PDO::FETCH_ASSOC);
            if (!$game) ws_json(['ok' => false, 'error' => 'Игра не найдена'], 404);
            $modsCount = 0;
            $mediaCount = 0;
            $assetsCount = 0;
            try {
                $c = $pdo->prepare("SELECT COUNT(*) FROM workshop_mods WHERE game_id = ? AND status = 'published'");
                $c->execute([$id]);
                $modsCount = (int)$c->fetchColumn();
                $c = $pdo->prepare("SELECT COUNT(*) FROM workshop_media WHERE game_id = ? AND status = 'published'");
                $c->execute([$id]);
                $mediaCount = (int)$c->fetchColumn();
                $c = $pdo->prepare("SELECT COUNT(*) FROM workshop_assets WHERE game_id = ? AND status = 'published'");
                $c->execute([$id]);
                $assetsCount = (int)$c->fetchColumn();
            } catch (Throwable $e) {}
            $game['mods_count'] = $modsCount;
            $game['media_count'] = $mediaCount;
            $game['assets_count'] = $assetsCount;
            ws_json(['ok' => true, 'game' => $game]);
        }

        case 'mods': {
            $q = ws_str($_GET, 'q');
            $game = ws_str($_GET, 'game'); // name search
            $gameId = ws_int($_GET, 'game_id', 0);
            $tag = ws_str($_GET, 'tag');
            $author = ws_str($_GET, 'author');
            $lang = ws_str($_GET, 'lang');
            $param = ws_str($_GET, 'param'); // title|description|author
            $sizeMin = ws_int($_GET, 'size_min', 0);
            $sizeMax = ws_int($_GET, 'size_max', 0);
            $dlMin = ws_int($_GET, 'dl_min', 0);
            $dlMax = ws_int($_GET, 'dl_max', 0);
            $likeMin = ws_int($_GET, 'like_min', 0);
            $likeMax = ws_int($_GET, 'like_max', 0);
            $page = max(1, ws_int($_GET, 'page', 1));
            $limit = min(48, max(1, ws_int($_GET, 'limit', 24)));
            $offset = ($page - 1) * $limit;

            $where = ["m.status = 'published'"];
            $params = [];
            if ($gameId > 0) {
                $where[] = "m.game_id = ?";
                $params[] = $gameId;
            }
            if ($game !== '') {
                $where[] = "g.title LIKE ?";
                $params[] = '%' . $game . '%';
            }
            if ($tag !== '') {
                $where[] = "m.tags LIKE ?";
                $params[] = '%' . $tag . '%';
            }
            if ($lang !== '') {
                $where[] = "m.languages LIKE ?";
                $params[] = '%' . $lang . '%';
            }
            if ($q !== '') {
                if ($param === 'title') {
                    $where[] = "m.title LIKE ?";
                    $params[] = '%' . $q . '%';
                } elseif ($param === 'description') {
                    $where[] = "(m.short_description LIKE ? OR m.description LIKE ?)";
                    $params[] = '%' . $q . '%';
                    $params[] = '%' . $q . '%';
                } elseif ($param === 'author') {
                    $where[] = "u.username LIKE ?";
                    $params[] = '%' . $q . '%';
                } else {
                    $where[] = "(m.title LIKE ? OR m.short_description LIKE ? OR u.username LIKE ?)";
                    $like = '%' . $q . '%';
                    $params[] = $like; $params[] = $like; $params[] = $like;
                }
            }
            if ($author !== '') {
                $where[] = "u.username LIKE ?";
                $params[] = '%' . $author . '%';
            }
            if ($sizeMin > 0) { $where[] = "m.file_size >= ?"; $params[] = $sizeMin; }
            if ($sizeMax > 0) { $where[] = "m.file_size <= ?"; $params[] = $sizeMax; }
            if ($dlMin > 0) { $where[] = "m.downloads >= ?"; $params[] = $dlMin; }
            if ($dlMax > 0) { $where[] = "m.downloads <= ?"; $params[] = $dlMax; }
            if ($likeMin > 0) { $where[] = "m.likes >= ?"; $params[] = $likeMin; }
            if ($likeMax > 0) { $where[] = "m.likes <= ?"; $params[] = $likeMax; }

            $sqlWhere = implode(' AND ', $where);
            $from = "FROM workshop_mods m
                JOIN games g ON g.id = m.game_id
                JOIN users u ON u.id = m.user_id
                WHERE $sqlWhere";

            $cnt = $pdo->prepare("SELECT COUNT(*) $from");
            $cnt->execute($params);
            $total = (int)$cnt->fetchColumn();

            $st = $pdo->prepare("SELECT m.*, g.title AS game_title, g.slug AS game_slug, g.cover_url AS game_cover, g.icon_url AS game_icon,
                u.username AS author_name, u.avatar_url AS author_avatar, u.avatar_color AS author_color
                $from
                ORDER BY m.created_at DESC
                LIMIT $limit OFFSET $offset");
            $st->execute($params);
            $list = $st->fetchAll(PDO::FETCH_ASSOC);

            ws_json(['ok' => true, 'mods' => $list, 'total' => $total, 'page' => $page, 'limit' => $limit]);
        }

        case 'media': {
            $game = ws_str($_GET, 'game');
            $gameId = ws_int($_GET, 'game_id', 0);
            $userId = ws_int($_GET, 'user_id', 0);
            $page = max(1, ws_int($_GET, 'page', 1));
            $limit = min(48, max(1, ws_int($_GET, 'limit', 24)));
            $offset = ($page - 1) * $limit;

            $where = ["wm.status = 'published'"];
            $params = [];
            if ($gameId > 0) {
                $where[] = "wm.game_id = ?";
                $params[] = $gameId;
            }
            if ($userId > 0) {
                $where[] = "wm.user_id = ?";
                $params[] = $userId;
            }
            if ($game !== '') {
                $where[] = "g.title LIKE ?";
                $params[] = '%' . $game . '%';
            }
            $sqlWhere = implode(' AND ', $where);
            $from = "FROM workshop_media wm
                JOIN games g ON g.id = wm.game_id
                JOIN users u ON u.id = wm.user_id
                WHERE $sqlWhere";

            $cnt = $pdo->prepare("SELECT COUNT(*) $from");
            $cnt->execute($params);
            $total = (int)$cnt->fetchColumn();

            $st = $pdo->prepare("SELECT wm.*, g.title AS game_title, g.slug AS game_slug,
                g.cover_url AS game_cover, g.icon_url AS game_icon,
                u.username AS author_name, u.avatar_url AS author_avatar, u.avatar_color AS author_color
                $from
                ORDER BY wm.created_at DESC
                LIMIT $limit OFFSET $offset");
            $st->execute($params);
            $list = $st->fetchAll(PDO::FETCH_ASSOC);

            ws_json(['ok' => true, 'media' => $list, 'total' => $total, 'page' => $page, 'limit' => $limit]);
        }

        case 'genres': {
            $st = $pdo->query("SELECT genre FROM games WHERE (status = 'published' OR (status IS NULL AND COALESCE(is_published,1) = 1)) AND genre IS NOT NULL AND genre != ''");
            $set = [];
            while ($row = $st->fetch(PDO::FETCH_ASSOC)) {
                foreach (preg_split('/[,;]+/', (string)$row['genre']) as $g) {
                    $g = trim($g);
                    if ($g !== '') $set[$g] = ($set[$g] ?? 0) + 1;
                }
            }
            arsort($set);
            $out = [];
            foreach ($set as $name => $cnt) $out[] = ['name' => $name, 'count' => $cnt];
            ws_json(['ok' => true, 'genres' => $out]);
        }

        case 'tags': {
            $set = [];
            try {
                $st = $pdo->query("SELECT tags FROM workshop_mods WHERE status = 'published' AND tags IS NOT NULL AND tags != ''");
                while ($row = $st->fetch(PDO::FETCH_ASSOC)) {
                    foreach (preg_split('/[,;]+/', (string)$row['tags']) as $t) {
                        $t = trim($t);
                        if ($t !== '') $set[$t] = ($set[$t] ?? 0) + 1;
                    }
                }
            } catch (Throwable $e) {}
            arsort($set);
            $out = [];
            foreach ($set as $name => $cnt) $out[] = ['name' => $name, 'count' => $cnt];
            ws_json(['ok' => true, 'tags' => $out]);
        }

        case 'mod': {
            $id = ws_int($_GET, 'id', 0);
            if ($id <= 0) ws_json(['ok' => false, 'error' => 'id required'], 400);
            $st = $pdo->prepare("SELECT m.*, g.title AS game_title, g.slug AS game_slug, g.cover_url AS game_cover,
                u.username AS author_name, u.avatar_url AS author_avatar, u.avatar_color AS author_color
                FROM workshop_mods m
                JOIN games g ON g.id = m.game_id
                JOIN users u ON u.id = m.user_id
                WHERE m.id = ? AND m.status = 'published' LIMIT 1");
            $st->execute([$id]);
            $mod = $st->fetch(PDO::FETCH_ASSOC);
            if (!$mod) ws_json(['ok' => false, 'error' => 'Мод не найден'], 404);
            try {
                $pdo->prepare("UPDATE workshop_mods SET views = views + 1 WHERE id = ?")->execute([$id]);
                $mod['views'] = (int)($mod['views'] ?? 0) + 1;
            } catch (Throwable $e) {}
            $shots = [];
            if (!empty($mod['screenshots'])) {
                $decoded = json_decode($mod['screenshots'], true);
                if (is_array($decoded)) $shots = $decoded;
            }
            if (!$shots && !empty($mod['cover_url'])) $shots = [$mod['cover_url']];
            $mod['screenshots_list'] = $shots;
            $liked = false;
            $uid = 0;
            try {
                if (function_exists('getCurrentUser')) {
                    $u = getCurrentUser();
                    if ($u) $uid = (int)($u['id'] ?? 0);
                }
                if ($uid) {
                    $lk = $pdo->prepare("SELECT 1 FROM workshop_likes WHERE user_id=? AND target_type='mod' AND target_id=?");
                    $lk->execute([$uid, $id]);
                    $liked = (bool)$lk->fetchColumn();
                }
            } catch (Throwable $e) {}
            $mod['liked'] = $liked;
            ws_json(['ok' => true, 'mod' => $mod]);
        }

        case 'media_item': {
            $id = ws_int($_GET, 'id', 0);
            if ($id <= 0) ws_json(['ok' => false, 'error' => 'id required'], 400);
            $st = $pdo->prepare("SELECT wm.*, g.title AS game_title, g.slug AS game_slug,
                u.username AS author_name, u.avatar_url AS author_avatar, u.avatar_color AS author_color
                FROM workshop_media wm
                JOIN games g ON g.id = wm.game_id
                JOIN users u ON u.id = wm.user_id
                WHERE wm.id = ? AND wm.status = 'published' LIMIT 1");
            $st->execute([$id]);
            $item = $st->fetch(PDO::FETCH_ASSOC);
            if (!$item) ws_json(['ok' => false, 'error' => 'Медиа не найдено'], 404);
            try {
                $pdo->prepare("UPDATE workshop_media SET views = views + 1 WHERE id = ?")->execute([$id]);
                $item['views'] = (int)($item['views'] ?? 0) + 1;
            } catch (Throwable $e) {}
            $imgs = [];
            if (!empty($item['images'])) {
                $decoded = json_decode($item['images'], true);
                if (is_array($decoded)) $imgs = $decoded;
            }
            if (!$imgs && !empty($item['image_url'])) $imgs = [$item['image_url']];
            $item['images_list'] = $imgs;
            $liked = false;
            $uid = 0;
            try {
                if (function_exists('getCurrentUser')) {
                    $u = getCurrentUser();
                    if ($u) $uid = (int)($u['id'] ?? 0);
                }
                if ($uid) {
                    $lk = $pdo->prepare("SELECT 1 FROM workshop_likes WHERE user_id=? AND target_type='media' AND target_id=?");
                    $lk->execute([$uid, $id]);
                    $liked = (bool)$lk->fetchColumn();
                }
            } catch (Throwable $e) {}
            $item['liked'] = $liked;
            ws_json(['ok' => true, 'media' => $item]);
        }

        case 'admin_pending': {
            $u = function_exists('getCurrentUser') ? getCurrentUser() : null;
            if (!$u || ($u['role'] ?? '') !== 'admin') ws_json(['ok' => false, 'error' => 'Только для админов'], 403);
            $mods = [];
            $media = [];
            $assets = [];
            try {
                $st = $pdo->query("SELECT m.id, m.title, m.cover_url, m.status, m.created_at, m.game_id,
                    g.title AS game_title, u.username AS submitter
                    FROM workshop_mods m
                    LEFT JOIN games g ON g.id = m.game_id
                    LEFT JOIN users u ON u.id = m.user_id
                    WHERE m.status = 'pending'
                    ORDER BY m.created_at ASC");
                $mods = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
            } catch (Throwable $e) {}
            try {
                $st = $pdo->query("SELECT wm.id, wm.title, wm.image_url, wm.status, wm.created_at, wm.game_id,
                    g.title AS game_title, u.username AS submitter
                    FROM workshop_media wm
                    LEFT JOIN games g ON g.id = wm.game_id
                    LEFT JOIN users u ON u.id = wm.user_id
                    WHERE wm.status = 'pending'
                    ORDER BY wm.created_at ASC");
                $media = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
            } catch (Throwable $e) {}
            try {
                $st = $pdo->query("SELECT a.id, a.title, a.cover_url, a.status, a.created_at, a.game_id,
                    g.title AS game_title, u.username AS submitter
                    FROM workshop_assets a
                    LEFT JOIN games g ON g.id = a.game_id
                    LEFT JOIN users u ON u.id = a.user_id
                    WHERE a.status = 'pending'
                    ORDER BY a.created_at ASC");
                $assets = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
            } catch (Throwable $e) {}
            ws_json(['ok' => true, 'mods' => $mods, 'media' => $media, 'assets' => $assets]);
        }

        case 'admin_set_status': {
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') ws_json(['ok' => false, 'error' => 'POST only'], 405);
            $u = function_exists('getCurrentUser') ? getCurrentUser() : null;
            if (!$u || ($u['role'] ?? '') !== 'admin') ws_json(['ok' => false, 'error' => 'Только для админов'], 403);
            $raw = json_decode(file_get_contents('php://input') ?: '{}', true) ?: [];
            $type = in_array(($raw['type'] ?? ''), ['mod', 'media', 'asset'], true) ? $raw['type'] : '';
            $id = (int)($raw['id'] ?? 0);
            $status = in_array(($raw['status'] ?? ''), ['published', 'rejected', 'pending'], true) ? $raw['status'] : '';
            if (!$type || $id <= 0 || !$status) ws_json(['ok' => false, 'error' => 'type/id/status required'], 400);
            $table = $type === 'mod' ? 'workshop_mods' : ($type === 'media' ? 'workshop_media' : 'workshop_assets');
            $st = $pdo->prepare("UPDATE `$table` SET status = ? WHERE id = ?");
            $st->execute([$status, $id]);
            ws_json(['ok' => true, 'id' => $id, 'status' => $status]);
        }

        case 'like': {
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') ws_json(['ok' => false, 'error' => 'POST only'], 405);
            $u = function_exists('getCurrentUser') ? getCurrentUser() : null;
            if (!$u) ws_json(['ok' => false, 'error' => 'Нужно войти'], 401);
            $uid = (int)$u['id'];
            $raw = json_decode(file_get_contents('php://input') ?: '{}', true) ?: [];
            $type = in_array(($raw['type'] ?? ''), ['mod','media','asset'], true) ? $raw['type'] : '';
            $tid = (int)($raw['id'] ?? 0);
            if (!$type || $tid <= 0) ws_json(['ok' => false, 'error' => 'type/id required'], 400);
            $table = $type === 'mod' ? 'workshop_mods' : ($type === 'media' ? 'workshop_media' : 'workshop_assets');
            try {
                $chk = $pdo->prepare("SELECT 1 FROM workshop_likes WHERE user_id=? AND target_type=? AND target_id=?");
                $chk->execute([$uid, $type, $tid]);
                if ($chk->fetchColumn()) {
                    $pdo->prepare("DELETE FROM workshop_likes WHERE user_id=? AND target_type=? AND target_id=?")->execute([$uid, $type, $tid]);
                    $pdo->exec("UPDATE `$table` SET likes = GREATEST(0, likes - 1) WHERE id = " . (int)$tid);
                    $liked = false;
                } else {
                    $pdo->prepare("INSERT INTO workshop_likes (user_id, target_type, target_id) VALUES (?,?,?)")->execute([$uid, $type, $tid]);
                    $pdo->exec("UPDATE `$table` SET likes = likes + 1 WHERE id = " . (int)$tid);
                    $liked = true;
                }
                $cnt = (int)$pdo->query("SELECT likes FROM `$table` WHERE id = " . (int)$tid)->fetchColumn();
                ws_json(['ok' => true, 'liked' => $liked, 'likes' => $cnt]);
            } catch (Throwable $e) {
                ws_json(['ok' => false, 'error' => $e->getMessage()], 500);
            }
        }

        case 'submit_media': {
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') ws_json(['ok' => false, 'error' => 'POST only'], 405);
            $u = function_exists('getCurrentUser') ? getCurrentUser() : null;
            if (!$u) ws_json(['ok' => false, 'error' => 'Нужно войти'], 401);
            $uid = (int)$u['id'];
            $gameId = (int)($_POST['game_id'] ?? 0);
            $title = trim((string)($_POST['title'] ?? ''));
            $desc = trim((string)($_POST['description'] ?? ''));
            if ($gameId <= 0) ws_json(['ok' => false, 'error' => 'Выберите игру'], 400);
            if ($title === '') ws_json(['ok' => false, 'error' => 'Укажите название'], 400);

            $g = $pdo->prepare("SELECT id FROM games WHERE id = ? AND (status = 'published' OR (status IS NULL AND COALESCE(is_published,1) = 1))");
            $g->execute([$gameId]);
            if (!$g->fetchColumn()) ws_json(['ok' => false, 'error' => 'Игра не найдена'], 404);

            $dir = dirname(__DIR__) . '/uploads/workshop/media/' . $uid;
            if (!is_dir($dir)) @mkdir($dir, 0755, true);
            $urls = [];
            $allowed = ['image/jpeg','image/png','image/webp','image/gif'];
            if (!empty($_FILES['images'])) {
                $names = $_FILES['images']['name'];
                if (!is_array($names)) $names = [$names];
                $tmps = is_array($_FILES['images']['tmp_name']) ? $_FILES['images']['tmp_name'] : [$_FILES['images']['tmp_name']];
                $errs = is_array($_FILES['images']['error']) ? $_FILES['images']['error'] : [$_FILES['images']['error']];
                $types = is_array($_FILES['images']['type'] ?? null) ? $_FILES['images']['type'] : [$_FILES['images']['type'] ?? ''];
                foreach ($names as $i => $name) {
                    if (($errs[$i] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) continue;
                    $tmp = $tmps[$i] ?? '';
                    $mime = $types[$i] ?? (function_exists('mime_content_type') ? @mime_content_type($tmp) : '');
                    if ($mime && !in_array($mime, $allowed, true)) continue;
                    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION) ?: 'jpg');
                    if (!in_array($ext, ['jpg','jpeg','png','webp','gif'], true)) $ext = 'jpg';
                    $fname = 'm_' . time() . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
                    if (@move_uploaded_file($tmp, $dir . '/' . $fname)) {
                        $urls[] = 'uploads/workshop/media/' . $uid . '/' . $fname;
                    }
                }
            }
            if (!$urls) ws_json(['ok' => false, 'error' => 'Загрузите хотя бы одно изображение'], 400);

            $st = $pdo->prepare("INSERT INTO workshop_media (game_id, user_id, title, description, image_url, images, status) VALUES (?,?,?,?,?,?, 'pending')");
            $st->execute([$gameId, $uid, $title, $desc, $urls[0], json_encode($urls, JSON_UNESCAPED_UNICODE)]);
            $newId = (int)$pdo->lastInsertId();
            $uname = (string)($u['username'] ?? 'user');
            ws_notify_admins($pdo, 'Новое медиа на модерации', $uname . ' отправил «' . $title . '»', ['kind' => 'media', 'id' => $newId]);
            ws_json(['ok' => true, 'id' => $newId, 'status' => 'pending']);
        }

        case 'submit_mod': {
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') ws_json(['ok' => false, 'error' => 'POST only'], 405);
            $u = function_exists('getCurrentUser') ? getCurrentUser() : null;
            if (!$u) ws_json(['ok' => false, 'error' => 'Нужно войти'], 401);
            $uid = (int)$u['id'];
            $gameId = (int)($_POST['game_id'] ?? 0);
            $title = trim((string)($_POST['title'] ?? ''));
            $about = trim((string)($_POST['about'] ?? ''));
            $description = trim((string)($_POST['description'] ?? ''));
            $install = trim((string)($_POST['install_instructions'] ?? ''));
            $features = trim((string)($_POST['features'] ?? ''));
            $deps = trim((string)($_POST['dependencies'] ?? ''));
            $installPath = trim((string)($_POST['install_path'] ?? ''));
            $tags = trim((string)($_POST['tags'] ?? ''));
            $short = trim((string)($_POST['short_description'] ?? ''));
            if ($gameId <= 0) ws_json(['ok' => false, 'error' => 'Выберите игру'], 400);
            if ($title === '') ws_json(['ok' => false, 'error' => 'Укажите название'], 400);

            $g = $pdo->prepare("SELECT id FROM games WHERE id = ? AND (status = 'published' OR (status IS NULL AND COALESCE(is_published,1) = 1))");
            $g->execute([$gameId]);
            if (!$g->fetchColumn()) ws_json(['ok' => false, 'error' => 'Игра не найдена'], 404);

            $base = dirname(__DIR__) . '/uploads/workshop/mods/' . $uid;
            if (!is_dir($base)) @mkdir($base, 0755, true);
            $imgAllowed = ['jpg','jpeg','png','webp','gif'];

            $saveOne = function(string $field, string $subdir) use ($base, $imgAllowed, $uid): ?string {
                if (empty($_FILES[$field]) || ($_FILES[$field]['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) return null;
                $f = $_FILES[$field];
                $ext = strtolower(pathinfo($f['name'], PATHINFO_EXTENSION) ?: 'jpg');
                if (!in_array($ext, $imgAllowed, true)) $ext = 'jpg';
                $dir = $base . '/' . $subdir;
                if (!is_dir($dir)) @mkdir($dir, 0755, true);
                $fname = $subdir . '_' . time() . '_' . bin2hex(random_bytes(3)) . '.' . $ext;
                if (!@move_uploaded_file($f['tmp_name'], $dir . '/' . $fname)) return null;
                return 'uploads/workshop/mods/' . $uid . '/' . $subdir . '/' . $fname;
            };

            $coverUrl = $saveOne('cover', 'cover');
            $bannerUrl = $saveOne('banner', 'banner');

            $shots = [];
            if (!empty($_FILES['screenshots'])) {
                $names = $_FILES['screenshots']['name'];
                if (!is_array($names)) $names = [$names];
                $tmps = is_array($_FILES['screenshots']['tmp_name']) ? $_FILES['screenshots']['tmp_name'] : [$_FILES['screenshots']['tmp_name']];
                $errs = is_array($_FILES['screenshots']['error']) ? $_FILES['screenshots']['error'] : [$_FILES['screenshots']['error']];
                $dir = $base . '/shots';
                if (!is_dir($dir)) @mkdir($dir, 0755, true);
                foreach ($names as $i => $name) {
                    if (($errs[$i] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) continue;
                    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION) ?: 'jpg');
                    if (!in_array($ext, $imgAllowed, true)) $ext = 'jpg';
                    $fname = 's_' . time() . '_' . $i . '_' . bin2hex(random_bytes(2)) . '.' . $ext;
                    if (@move_uploaded_file($tmps[$i], $dir . '/' . $fname)) {
                        $shots[] = 'uploads/workshop/mods/' . $uid . '/shots/' . $fname;
                    }
                }
            }
            if (!$coverUrl && $shots) $coverUrl = $shots[0];

            $fileUrl = null;
            $fileSize = 0;
            if (!empty($_FILES['mod_file']) && ($_FILES['mod_file']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
                $f = $_FILES['mod_file'];
                $ext = strtolower(pathinfo($f['name'], PATHINFO_EXTENSION) ?: 'zip');
                if (!in_array($ext, ['zip','rar','7z','pak','mod'], true)) $ext = 'zip';
                $dir = $base . '/files';
                if (!is_dir($dir)) @mkdir($dir, 0755, true);
                $fname = 'mod_' . time() . '_' . bin2hex(random_bytes(3)) . '.' . $ext;
                if (@move_uploaded_file($f['tmp_name'], $dir . '/' . $fname)) {
                    $fileUrl = 'uploads/workshop/mods/' . $uid . '/files/' . $fname;
                    $fileSize = (int)$f['size'];
                }
            }
            if (!$fileUrl) ws_json(['ok' => false, 'error' => 'Загрузите файл мода'], 400);

            $slug = preg_replace('~[^a-z0-9]+~', '-', strtolower(preg_replace('~[^\p{L}\p{N}]+~u', '-', $title)));
            $slug = trim($slug, '-') ?: ('mod-' . time());

            $st = $pdo->prepare("INSERT INTO workshop_mods
                (game_id, user_id, title, slug, short_description, description, about, install_instructions, features, dependencies, install_path,
                 cover_url, banner_url, screenshots, file_url, file_size, tags, status)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')");
            $st->execute([
                $gameId, $uid, $title, $slug, $short ?: mb_substr($about ?: $description, 0, 500),
                $description, $about, $install, $features, $deps, $installPath,
                $coverUrl, $bannerUrl, $shots ? json_encode($shots, JSON_UNESCAPED_UNICODE) : null,
                $fileUrl, $fileSize, $tags
            ]);
            $newId = (int)$pdo->lastInsertId();
            $uname = (string)($u['username'] ?? 'user');
            ws_notify_admins($pdo, 'Новый мод на модерации', $uname . ' отправил «' . $title . '»', ['kind' => 'mod', 'id' => $newId, 'game_id' => $gameId]);
            ws_json(['ok' => true, 'id' => $newId, 'status' => 'pending']);
        }

        case 'assets': {
            $page = max(1, (int)($_GET['page'] ?? 1));
            $limit = min(48, max(1, (int)($_GET['limit'] ?? 24)));
            $offset = ($page - 1) * $limit;
            $q = trim((string)($_GET['q'] ?? ''));
            $gameId = (int)($_GET['game_id'] ?? 0);
            $tag = trim((string)($_GET['tag'] ?? ''));
            $where = ["a.status = 'published'"];
            $params = [];
            if ($gameId > 0) {
                $where[] = 'a.game_id = ?';
                $params[] = $gameId;
            }
            if ($q !== '') {
                $where[] = '(a.title LIKE ? OR a.description LIKE ? OR a.short_description LIKE ?)';
                $like = '%' . $q . '%';
                $params[] = $like; $params[] = $like; $params[] = $like;
            }
            if ($tag !== '') {
                $where[] = 'a.tags LIKE ?';
                $params[] = '%' . $tag . '%';
            }
            $w = implode(' AND ', $where);
            $from = "FROM workshop_assets a
                LEFT JOIN games g ON g.id = a.game_id
                LEFT JOIN users u ON u.id = a.user_id";
            $cntSt = $pdo->prepare("SELECT COUNT(*) $from WHERE $w");
            $cntSt->execute($params);
            $total = (int)$cntSt->fetchColumn();
            $sql = "SELECT a.*, u.username AS author_name, g.title AS game_title, g.cover_url AS game_cover, g.icon_url AS game_icon
                $from WHERE $w ORDER BY a.created_at DESC LIMIT $limit OFFSET $offset";
            $st = $pdo->prepare($sql);
            $st->execute($params);
            $list = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
            ws_json(['ok' => true, 'assets' => $list, 'total' => $total, 'page' => $page, 'limit' => $limit]);
        }

        case 'asset': {
            $id = (int)($_GET['id'] ?? 0);
            if ($id <= 0) ws_json(['ok' => false, 'error' => 'id required'], 400);
            $st = $pdo->prepare("SELECT a.*, u.username AS author_name, g.title AS game_title, g.cover_url AS game_cover, g.icon_url AS game_icon, g.slug AS game_slug
                FROM workshop_assets a
                LEFT JOIN games g ON g.id = a.game_id
                LEFT JOIN users u ON u.id = a.user_id
                WHERE a.id = ? AND a.status = 'published'");
            $st->execute([$id]);
            $item = $st->fetch(PDO::FETCH_ASSOC);
            if (!$item) ws_json(['ok' => false, 'error' => 'Ассет не найден'], 404);
            try {
                $pdo->prepare("UPDATE workshop_assets SET views = views + 1 WHERE id = ?")->execute([$id]);
                $item['views'] = (int)($item['views'] ?? 0) + 1;
            } catch (Throwable $e) {}
            $shots = [];
            if (!empty($item['screenshots'])) {
                $decoded = json_decode($item['screenshots'], true);
                if (is_array($decoded)) $shots = array_values(array_filter($decoded));
            }
            if (!$shots && !empty($item['cover_url'])) $shots = [$item['cover_url']];
            $item['screenshots_list'] = $shots;
            $files = [];
            if (!empty($item['files'])) {
                $fd = json_decode($item['files'], true);
                if (is_array($fd)) $files = $fd;
            }
            if (!$files && !empty($item['file_url'])) {
                $files = [['url' => $item['file_url'], 'name' => basename($item['file_url']), 'size' => (int)($item['file_size'] ?? 0)]];
            }
            $item['files_list'] = $files;
            $liked = false;
            try {
                if (function_exists('getCurrentUser')) {
                    $cu = getCurrentUser();
                    if ($cu) {
                        $lk = $pdo->prepare("SELECT 1 FROM workshop_likes WHERE user_id=? AND target_type='asset' AND target_id=?");
                        $lk->execute([(int)$cu['id'], $id]);
                        $liked = (bool)$lk->fetchColumn();
                    }
                }
            } catch (Throwable $e) {}
            $item['liked'] = $liked;
            ws_json(['ok' => true, 'asset' => $item]);
        }

        case 'submit_asset': {
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') ws_json(['ok' => false, 'error' => 'POST only'], 405);
            $u = function_exists('getCurrentUser') ? getCurrentUser() : null;
            if (!$u) ws_json(['ok' => false, 'error' => 'Нужно войти'], 401);
            $uid = (int)$u['id'];
            $gameId = (int)($_POST['game_id'] ?? 0);
            $title = trim((string)($_POST['title'] ?? ''));
            $description = trim((string)($_POST['description'] ?? ''));
            $short = trim((string)($_POST['short_description'] ?? ''));
            $tags = trim((string)($_POST['tags'] ?? ''));
            if ($title === '') ws_json(['ok' => false, 'error' => 'Укажите название'], 400);
            if ($description === '') ws_json(['ok' => false, 'error' => 'Напишите описание'], 400);

            // игра необязательна
            if ($gameId > 0) {
                $g = $pdo->prepare("SELECT id FROM games WHERE id = ? AND (status = 'published' OR (status IS NULL AND COALESCE(is_published,1) = 1))");
                $g->execute([$gameId]);
                if (!$g->fetchColumn()) $gameId = 0;
            } else {
                $gameId = null;
            }

            $base = dirname(__DIR__) . '/uploads/workshop/assets/' . $uid;
            if (!is_dir($base)) @mkdir($base, 0755, true);

            $coverUrl = null;
            $bannerUrl = null;
            $shots = [];
            $allowedImg = ['image/jpeg','image/png','image/webp','image/gif'];

            $saveImg = function($f, $subdir) use ($base, $uid, $allowedImg) {
                if (empty($f) || ($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) return null;
                $mime = $f['type'] ?? (function_exists('mime_content_type') ? @mime_content_type($f['tmp_name']) : '');
                if ($mime && !in_array($mime, $allowedImg, true)) return null;
                $ext = strtolower(pathinfo($f['name'], PATHINFO_EXTENSION) ?: 'jpg');
                if (!in_array($ext, ['jpg','jpeg','png','webp','gif'], true)) $ext = 'jpg';
                $dir = $base . '/' . $subdir;
                if (!is_dir($dir)) @mkdir($dir, 0755, true);
                $fname = substr($subdir, 0, 1) . '_' . time() . '_' . bin2hex(random_bytes(3)) . '.' . $ext;
                if (!@move_uploaded_file($f['tmp_name'], $dir . '/' . $fname)) return null;
                return 'uploads/workshop/assets/' . $uid . '/' . $subdir . '/' . $fname;
            };

            if (!empty($_FILES['cover'])) $coverUrl = $saveImg($_FILES['cover'], 'covers');
            if (!empty($_FILES['banner'])) $bannerUrl = $saveImg($_FILES['banner'], 'banners');

            if (!empty($_FILES['screenshots'])) {
                $names = $_FILES['screenshots']['name'];
                if (!is_array($names)) $names = [$names];
                $tmps = is_array($_FILES['screenshots']['tmp_name']) ? $_FILES['screenshots']['tmp_name'] : [$_FILES['screenshots']['tmp_name']];
                $errs = is_array($_FILES['screenshots']['error']) ? $_FILES['screenshots']['error'] : [$_FILES['screenshots']['error']];
                $types = is_array($_FILES['screenshots']['type'] ?? null) ? $_FILES['screenshots']['type'] : [$_FILES['screenshots']['type'] ?? ''];
                $dir = $base . '/shots';
                if (!is_dir($dir)) @mkdir($dir, 0755, true);
                foreach ($names as $i => $name) {
                    if (($errs[$i] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) continue;
                    $mime = $types[$i] ?? '';
                    if ($mime && !in_array($mime, $allowedImg, true)) continue;
                    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION) ?: 'jpg');
                    if (!in_array($ext, ['jpg','jpeg','png','webp','gif'], true)) $ext = 'jpg';
                    $fname = 's_' . time() . '_' . $i . '_' . bin2hex(random_bytes(2)) . '.' . $ext;
                    if (@move_uploaded_file($tmps[$i], $dir . '/' . $fname)) {
                        $shots[] = 'uploads/workshop/assets/' . $uid . '/shots/' . $fname;
                    }
                }
            }
            if (!$coverUrl && $shots) $coverUrl = $shots[0];

            $fileUrl = null;
            $fileSize = 0;
            $filesList = [];
            if (!empty($_FILES['asset_file']) && ($_FILES['asset_file']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
                $f = $_FILES['asset_file'];
                $ext = strtolower(pathinfo($f['name'], PATHINFO_EXTENSION) ?: 'zip');
                if (!in_array($ext, ['zip','rar','7z','pdf','txt','md','doc','docx','json','unitypackage','fbx','blend','psd','ai'], true)) $ext = 'zip';
                $dir = $base . '/files';
                if (!is_dir($dir)) @mkdir($dir, 0755, true);
                $fname = 'asset_' . time() . '_' . bin2hex(random_bytes(3)) . '.' . $ext;
                if (@move_uploaded_file($f['tmp_name'], $dir . '/' . $fname)) {
                    $fileUrl = 'uploads/workshop/assets/' . $uid . '/files/' . $fname;
                    $fileSize = (int)$f['size'];
                    $filesList[] = ['url' => $fileUrl, 'name' => $f['name'], 'size' => $fileSize];
                }
            }

            $slug = preg_replace('~[^a-z0-9]+~', '-', strtolower(preg_replace('~[^\p{L}\p{N}]+~u', '-', $title)));
            $slug = trim($slug, '-') ?: ('asset-' . time());

            $st = $pdo->prepare("INSERT INTO workshop_assets
                (game_id, user_id, title, slug, short_description, description, cover_url, banner_url, screenshots, file_url, file_size, files, tags, status)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')");
            $st->execute([
                $gameId, $uid, $title, $slug,
                $short ?: mb_substr($description, 0, 500),
                $description, $coverUrl, $bannerUrl,
                $shots ? json_encode($shots, JSON_UNESCAPED_UNICODE) : null,
                $fileUrl, $fileSize,
                $filesList ? json_encode($filesList, JSON_UNESCAPED_UNICODE) : null,
                $tags
            ]);
            $newId = (int)$pdo->lastInsertId();
            $uname = (string)($u['username'] ?? 'user');
            ws_notify_admins($pdo, 'Новый ассет на модерации', $uname . ' отправил «' . $title . '»', ['kind' => 'asset', 'id' => $newId, 'game_id' => $gameId]);
            ws_json(['ok' => true, 'id' => $newId, 'status' => 'pending']);
        }

        default:
            ws_json(['ok' => false, 'error' => 'Unknown action'], 400);
    }
} catch (Throwable $e) {
    ws_json(['ok' => false, 'error' => $e->getMessage()], 500);
}
