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
            $downloads = 0;
            try {
                $mods = (int)$pdo->query("SELECT COUNT(*) FROM workshop_mods WHERE status = 'published'")->fetchColumn();
                $downloads = (int)$pdo->query("SELECT COALESCE(SUM(downloads),0) FROM workshop_mods WHERE status = 'published'")->fetchColumn();
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
                    'downloads' => $downloads,
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
            try {
                $c = $pdo->prepare("SELECT COUNT(*) FROM workshop_mods WHERE game_id = ? AND status = 'published'");
                $c->execute([$id]);
                $modsCount = (int)$c->fetchColumn();
                $c = $pdo->prepare("SELECT COUNT(*) FROM workshop_media WHERE game_id = ? AND status = 'published'");
                $c->execute([$id]);
                $mediaCount = (int)$c->fetchColumn();
            } catch (Throwable $e) {}
            $game['mods_count'] = $modsCount;
            $game['media_count'] = $mediaCount;
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

            $st = $pdo->prepare("SELECT m.*, g.title AS game_title, g.slug AS game_slug, g.cover_url AS game_cover,
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
            $page = max(1, ws_int($_GET, 'page', 1));
            $limit = min(48, max(1, ws_int($_GET, 'limit', 24)));
            $offset = ($page - 1) * $limit;

            $where = ["wm.status = 'published'"];
            $params = [];
            if ($gameId > 0) {
                $where[] = "wm.game_id = ?";
                $params[] = $gameId;
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

        default:
            ws_json(['ok' => false, 'error' => 'Unknown action'], 400);
    }
} catch (Throwable $e) {
    ws_json(['ok' => false, 'error' => $e->getMessage()], 500);
}
