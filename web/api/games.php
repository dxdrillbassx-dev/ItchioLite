<?php
foreach ([__DIR__ . '/../config.php', __DIR__ . '/config.php'] as $_cfg) {
    if (is_file($_cfg)) { require_once $_cfg; break; }
}
// CATio — API каталога, игр, библиотеки, покупок, комментариев и скачиваний
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . '/../auth.php';

function httpGetRaw(string $url, int $timeout = 20): ?string {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CATio/1.0',
            CURLOPT_HTTPHEADER => ['Accept-Language: ru-RU,ru;q=0.9,en;q=0.8'],
        ]);
        $raw = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($raw === false || $code >= 400) return null;
        return $raw;
    }
    $ctx = stream_context_create([
        'http' => ['timeout' => $timeout, 'header' => "User-Agent: CATio/1.0\r\nAccept-Language: ru,en\r\n"],
        'ssl' => ['verify_peer' => false, 'verify_peer_name' => false],
    ]);
    $raw = @file_get_contents($url, false, $ctx);
    return $raw === false ? null : $raw;
}

function syncGameAchievementsFromSteam(PDO $pdo, int $gameId, int $appId): int {
    if ($appId <= 0) return 0;

    $percents = [];
    $schema = [];

    // 1) Community page (русские имена + иконки) — основной источник без API-ключа
    $html = httpGetRaw("https://steamcommunity.com/stats/{$appId}/achievements/?l=russian");
    if (!$html || stripos($html, 'achieveRow') === false) {
        $html = httpGetRaw("https://steamcommunity.com/stats/{$appId}/achievements/?l=english");
    }
    if ($html && stripos($html, 'achieveRow') !== false) {
        $parts = preg_split('/class="[^"]*achieveRow[^"]*"/i', $html);
        array_shift($parts);
        foreach ($parts as $i => $chunk) {
            $icon = '';
            $name = '';
            $desc = '';
            $pct = 0.0;
            if (preg_match('/<img[^>]+src="([^"]+)"/i', $chunk, $m)) {
                $icon = html_entity_decode($m[1], ENT_QUOTES, 'UTF-8');
            }
            if (preg_match('/<h3[^>]*>([\s\S]*?)<\/h3>/i', $chunk, $m)) {
                $name = trim(html_entity_decode(strip_tags($m[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
            }
            if (preg_match('/<h5[^>]*>([\s\S]*?)<\/h5>/i', $chunk, $m)) {
                $desc = trim(html_entity_decode(strip_tags($m[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
            }
            if (preg_match('/achievePercent[^>]*>([\d.,]+)/i', $chunk, $m)) {
                $pct = (float)str_replace(',', '.', $m[1]);
            }
            if ($name === '' && $icon === '') continue;
            $api = 'sc_' . $i;
            $schema[$api] = [
                'display_name' => $name !== '' ? $name : ('Achievement ' . ($i + 1)),
                'description' => $desc,
                'icon_url' => $icon,
                'icon_gray_url' => $icon,
                'is_hidden' => 0,
                'sort_order' => $i,
                'percent' => $pct,
            ];
        }
    }

    // 2) Schema API (если есть ключ или вдруг отвечает) — нормальные api_name + gray icons
    $key = '';
    if (defined('STEAM_WEB_API_KEY')) $key = (string)constant('STEAM_WEB_API_KEY');
    if ($key === '' && defined('STEAM_API_KEY')) $key = (string)constant('STEAM_API_KEY');
    $schemaUrls = [];
    if ($key !== '') {
        $schemaUrls[] = "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=" . urlencode($key) . "&appid={$appId}&l=russian";
        $schemaUrls[] = "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=" . urlencode($key) . "&appid={$appId}&l=english";
    }
    foreach ($schemaUrls as $url) {
        $raw = httpGetRaw($url, 12);
        if (!$raw) continue;
        $json = json_decode($raw, true);
        $achs = $json['game']['availableGameStats']['achievements'] ?? null;
        if (!is_array($achs) || !count($achs)) continue;
        $schema = [];
        foreach ($achs as $i => $a) {
            $name = $a['name'] ?? '';
            if ($name === '') continue;
            $icon = $a['icon'] ?? '';
            $icongray = $a['icongray'] ?? '';
            if ($icon && !preg_match('#^https?://#i', $icon)) {
                $icon = 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/' . $appId . '/' . $icon;
            }
            if ($icongray && !preg_match('#^https?://#i', $icongray)) {
                $icongray = 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/' . $appId . '/' . $icongray;
            }
            $schema[$name] = [
                'display_name' => $a['displayName'] ?? $name,
                'description' => $a['description'] ?? '',
                'icon_url' => $icon,
                'icon_gray_url' => $icongray ?: $icon,
                'is_hidden' => !empty($a['hidden']) ? 1 : 0,
                'sort_order' => $i,
                'percent' => 0.0,
            ];
        }
        break;
    }

    // 3) Global percentages (api_name → %)
    $raw = httpGetRaw("https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=" . $appId, 12);
    if ($raw) {
        $json = json_decode($raw, true);
        foreach (($json['achievementpercentages']['achievements'] ?? []) as $row) {
            if (empty($row['name'])) continue;
            $percents[$row['name']] = (float)($row['percent'] ?? 0);
        }
    }
    // merge percents into schema by api_name; if schema empty build from percents
    if ($schema) {
        foreach ($schema as $k => &$a) {
            if (isset($percents[$k])) $a['percent'] = $percents[$k];
        }
        unset($a);
    } elseif ($percents) {
        $i = 0;
        foreach ($percents as $name => $pct) {
            $schema[$name] = [
                'display_name' => $name,
                'description' => '',
                'icon_url' => '',
                'icon_gray_url' => '',
                'is_hidden' => 0,
                'sort_order' => $i++,
                'percent' => $pct,
            ];
        }
    }

    if (!$schema) return 0;

    // Скачать иконки локально (раз навсегда)
    $iconDir = dirname(__DIR__) . '/uploads/achievements/' . $gameId;
    if (!is_dir($iconDir)) @mkdir($iconDir, 0775, true);

    $downloadIcon = function(string $url, string $dest) {
        if ($url === '' || is_file($dest) && filesize($dest) > 100) return is_file($dest);
        if (!preg_match('#^https?://#i', $url)) return false;
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_TIMEOUT => 15,
                CURLOPT_SSL_VERIFYPEER => false,
                CURLOPT_USERAGENT => 'Mozilla/5.0 CATio/1.0',
            ]);
            $bin = curl_exec($ch);
            $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            if ($bin && $code < 400 && strlen($bin) > 50) {
                file_put_contents($dest, $bin);
                return true;
            }
        }
        return false;
    };

    $pdo->prepare("DELETE FROM game_achievements WHERE game_id = ?")->execute([$gameId]);
    $ins = $pdo->prepare("INSERT INTO game_achievements
        (game_id, api_name, display_name, description, icon_url, icon_gray_url, percent, is_hidden, sort_order)
        VALUES (?,?,?,?,?,?,?,?,?)");
    $n = 0;
    foreach ($schema as $apiName => $a) {
        $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $apiName);
        $localColor = '';
        $localGray = '';
        if (!empty($a['icon_url'])) {
            $dest = $iconDir . '/' . $safe . '.jpg';
            if ($downloadIcon($a['icon_url'], $dest)) {
                $localColor = 'uploads/achievements/' . $gameId . '/' . $safe . '.jpg';
            } else {
                $localColor = $a['icon_url'];
            }
        }
        if (!empty($a['icon_gray_url'])) {
            $dest = $iconDir . '/' . $safe . '_gray.jpg';
            if ($downloadIcon($a['icon_gray_url'], $dest)) {
                $localGray = 'uploads/achievements/' . $gameId . '/' . $safe . '_gray.jpg';
            } else {
                $localGray = $a['icon_gray_url'];
            }
        }
        if ($localGray === '' && $localColor !== '') $localGray = $localColor;

        $ins->execute([
            $gameId,
            mb_substr($apiName, 0, 128),
            mb_substr($a['display_name'], 0, 255),
            mb_substr($a['description'] ?? '', 0, 512),
            mb_substr($localColor, 0, 512),
            mb_substr($localGray, 0, 512),
            (float)($a['percent'] ?? 0),
            (int)($a['is_hidden'] ?? 0),
            (int)($a['sort_order'] ?? $n),
        ]);
        $n++;
    }
    try {
        $pdo->prepare("UPDATE games SET ach_count = ?, steam_appid = ? WHERE id = ?")->execute([$n, $appId, $gameId]);
        // обновить library.ach_total для всех владельцев
        $pdo->prepare("UPDATE library SET ach_total = ? WHERE game_id = ?")->execute([$n, $gameId]);
    } catch (Throwable $e) {}
    return $n;
}


$pdo = getDB();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? 'list';

// Любая ошибка — JSON'ом, чтобы клиент показал текст, а не молчал
set_exception_handler(function ($e) {
    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
        http_response_code(500);
    }
    echo json_encode(['ok' => false, 'error' => 'Ошибка сервера: ' . $e->getMessage()], JSON_UNESCAPED_UNICODE);
    exit;
});

// ---------- помощники ----------
function jsonBody(): array {
    $body = json_decode(file_get_contents('php://input'), true);
    return is_array($body) ? $body : $_POST;
}

function requireAuth(): array {
    $user = getCurrentUser();
    if (!$user) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'Нужно войти в аккаунт'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    return $user;
}

function checkCsrf(array $body): void {
    if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
        http_response_code(403);
        echo json_encode(['ok' => false, 'error' => 'Неверный CSRF-токен. Обнови страницу.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

function ownsGame(PDO $pdo, int $userId, int $gameId): bool {
    $stmt = $pdo->prepare("SELECT 1 FROM library WHERE user_id = ? AND game_id = ?");
    $stmt->execute([$userId, $gameId]);
    return (bool)$stmt->fetchColumn();
}

function hasPurchased(PDO $pdo, int $userId, int $gameId): bool {
    try {
        $stmt = $pdo->prepare("SELECT 1 FROM purchases WHERE user_id = ? AND game_id = ? LIMIT 1");
        $stmt->execute([$userId, $gameId]);
        return (bool)$stmt->fetchColumn();
    } catch (Throwable $e) {
        return false;
    }
}

function attachUserState(PDO $pdo, array $row, ?array $user): array {
    $row['owned'] = false;
    $row['purchased'] = false;
    $row['user_rating'] = null;
    $row['is_pinned'] = 0;
    $row['is_liked'] = 0;
    $row['liked'] = false;
    if ($user) {
        $row['owned'] = ownsGame($pdo, (int)$user['id'], (int)$row['id']);
        $row['purchased'] = $row['owned'] || hasPurchased($pdo, (int)$user['id'], (int)$row['id']);
        $stmt = $pdo->prepare("SELECT value FROM ratings WHERE user_id = ? AND game_id = ?");
        $stmt->execute([(int)$user['id'], (int)$row['id']]);
        $v = $stmt->fetchColumn();
        $row['user_rating'] = $v !== false ? (int)$v : null;
        if ($row['owned']) {
            try {
                $st = $pdo->prepare("SELECT is_pinned, is_liked FROM library WHERE user_id = ? AND game_id = ?");
                $st->execute([(int)$user['id'], (int)$row['id']]);
                $lib = $st->fetch();
                if ($lib) {
                    $row['is_pinned'] = (int)($lib['is_pinned'] ?? 0);
                    $row['is_liked'] = (int)($lib['is_liked'] ?? 0);
                    $row['liked'] = (bool)$row['is_liked'];
                }
            } catch (Throwable $e) {
                $st = $pdo->prepare("SELECT is_pinned FROM library WHERE user_id = ? AND game_id = ?");
                $st->execute([(int)$user['id'], (int)$row['id']]);
                $pin = $st->fetchColumn();
                $row['is_pinned'] = $pin !== false ? (int)$pin : 0;
            }
        }
    }
    return $row;
}


function catioFetchSteamMovies(int $appId): array {
    return []; /* diploma: no steam network calls */

    if ($appId <= 0) return [];
    static $cache = [];
    if (isset($cache[$appId])) return $cache[$appId];

    $urls = [
        "https://store.steampowered.com/api/appdetails?appids={$appId}&l=english&cc=us",
        "https://store.steampowered.com/api/appdetails?appids={$appId}&l=russian&cc=us",
    ];
    $raw = null;
    foreach ($urls as $url) {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_TIMEOUT => 12,
                CURLOPT_CONNECTTIMEOUT => 6,
                CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; CATio/1.0)',
                CURLOPT_HTTPHEADER => [
                    'Accept: application/json',
                    'Cookie: birthtime=631152000; lastagecheckage=1-0-1990; mature_content=1; wants_mature_content=1',
                ],
                CURLOPT_SSL_VERIFYPEER => false,
            ]);
            $raw = curl_exec($ch);
            $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            if ($raw === false || $code >= 400) { $raw = null; continue; }
        } else {
            $ctx = stream_context_create([
                'http' => [
                    'timeout' => 12,
                    'header' => "User-Agent: Mozilla/5.0\r\nCookie: birthtime=631152000; mature_content=1\r\n",
                ],
                'ssl' => ['verify_peer' => false, 'verify_peer_name' => false],
            ]);
            $raw = @file_get_contents($url, false, $ctx);
            if ($raw === false) { $raw = null; continue; }
        }
        $json = json_decode($raw, true);
        if (!is_array($json)) { $raw = null; continue; }
        $block = $json[(string)$appId] ?? $json[$appId] ?? null;
        if (!is_array($block) || empty($block['success'])) { $raw = null; continue; }
        $movies = $block['data']['movies'] ?? [];
        if (!is_array($movies) || !$movies) { $raw = null; continue; }

        $out = [];
        foreach (array_slice($movies, 0, 5) as $m) {
            // приоритет: HLS (браузер + hls.js) → DASH → legacy mp4/webm
            $urlVid = $m['hls_h264'] ?? ($m['dash_h264'] ?? '');
            if (!$urlVid && is_array($m['mp4'] ?? null)) {
                $urlVid = $m['mp4']['max'] ?? ($m['mp4']['480'] ?? '');
            }
            if (!$urlVid && is_array($m['webm'] ?? null)) {
                $urlVid = $m['webm']['max'] ?? ($m['webm']['480'] ?? '');
            }
            if (!$urlVid) continue;
            if (stripos($urlVid, 'http://') === 0) $urlVid = 'https://' . substr($urlVid, 7);
            $thumb = $m['thumbnail'] ?? '';
            if ($thumb && stripos($thumb, 'http://') === 0) $thumb = 'https://' . substr($thumb, 7);
            $fmt = 'mp4';
            if (stripos($urlVid, '.m3u8') !== false) $fmt = 'hls';
            elseif (stripos($urlVid, '.mpd') !== false) $fmt = 'dash';
            elseif (stripos($urlVid, '.webm') !== false) $fmt = 'webm';
            $out[] = [
                'url' => $urlVid,
                'thumbnail' => $thumb,
                'name' => $m['name'] ?? 'Трейлер',
                'format' => $fmt,
            ];
        }
        $cache[$appId] = $out;
        return $out;
    }
    $cache[$appId] = [];
    return [];
}

try {
    $user = getCurrentUser();

    // ===== КАТАЛОГ =====
    if ($method === 'GET' && $action === 'list') {
        $category = $_GET['category'] ?? 'all';
        $where = "g.is_published = 1 AND COALESCE(g.status, 'published') NOT IN ('pending','rejected','draft')";
        $params = [];
        if (in_array($category, ['game', 'asset'], true)) {
            $where .= " AND g.category = ?";
            $params[] = $category;
        }
        $stmt = $pdo->prepare("
            SELECT g.id, g.title, g.slug, g.short_description, g.description,
                   g.price, g.discount_percent, g.category, g.genre, g.tags, g.rating,
                   g.cover_url, g.banner_url, g.cover_emoji, g.cover_color,
                   g.developer_name, g.download_count, g.created_at, g.is_adult,
                   (SELECT COUNT(*) FROM comments c WHERE c.game_id = g.id) AS comments_count,
                   (SELECT COUNT(*) FROM ratings r WHERE r.game_id = g.id) AS ratings_count,
                   (SELECT COUNT(*) FROM library l WHERE l.game_id = g.id) AS players_count
            FROM games g
            WHERE $where
            ORDER BY g.created_at DESC
        ");
        $stmt->execute($params);
        $games = $stmt->fetchAll();

        $ownedIds = [];
        $purchasedIds = [];
        if ($user) {
            $st = $pdo->prepare("SELECT game_id FROM library WHERE user_id = ?");
            $st->execute([(int)$user['id']]);
            $ownedIds = array_map('intval', array_column($st->fetchAll(), 'game_id'));
            try {
                $st = $pdo->prepare("SELECT DISTINCT game_id FROM purchases WHERE user_id = ?");
                $st->execute([(int)$user['id']]);
                $purchasedIds = array_map('intval', array_column($st->fetchAll(), 'game_id'));
            } catch (Throwable $e) {
                $purchasedIds = [];
            }
        }
        foreach ($games as &$g) {
            $gid = (int)$g['id'];
            $g['owned'] = in_array($gid, $ownedIds, true);
            $g['purchased'] = $g['owned'] || in_array($gid, $purchasedIds, true);
            $g['cover_src'] = !empty($g['cover_url']) ? $g['cover_url'] : ('media.php?type=cover&id=' . $g['id']);
        }
        unset($g);

        echo json_encode(['ok' => true, 'games' => $games], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // ===== СТРАНИЦА ИГРЫ (как на itch.io) =====
    if ($method === 'GET' && $action === 'get' && isset($_GET['id'])) {
        $id = (int)$_GET['id'];
        $stmt = $pdo->prepare("SELECT * FROM games WHERE id = ? AND is_published = 1 AND COALESCE(status, 'published') NOT IN ('pending','rejected','draft')");
        $stmt->execute([$id]);
        $game = $stmt->fetch();
        if (!$game) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Игра не найдена'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $game['cover_src'] = !empty($game['cover_url']) ? $game['cover_url'] : ('media.php?type=cover&id=' . $game['id']);

        // видео + скрины из game_media
        $videos = [];
        $mediaUrls = [];
        try {
            $ms = $pdo->prepare("SELECT kind, url, thumb_url, title, sort_order FROM game_media WHERE game_id = ? ORDER BY sort_order, id");
            $ms->execute([$id]);
            foreach ($ms->fetchAll() as $row) {
                if (in_array(($row['kind'] ?? ''), ['video','trailer','movie','movies'], true)) {
                    $videos[] = [
                        'url' => $row['url'],
                        'thumbnail' => !empty($row['thumb_url']) ? $row['thumb_url'] : (!empty($game['cover_url']) ? $game['cover_url'] : null),
                        'name' => !empty($row['title']) ? $row['title'] : 'Трейлер',
                    ];
                } else {
                    $mediaUrls[] = $row['url'];
                }
            }
        } catch (Throwable $e) {
            try {
                $ms = $pdo->prepare("SELECT kind, url FROM game_media WHERE game_id = ? ORDER BY sort_order, id");
                $ms->execute([$id]);
                foreach ($ms->fetchAll() as $row) {
                    if (in_array(($row['kind'] ?? ''), ['video','trailer','movie','movies'], true)) {
                        $videos[] = [
                            'url' => $row['url'],
                            'thumbnail' => !empty($game['cover_url']) ? $game['cover_url'] : null,
                            'name' => 'Трейлер',
                        ];
                    } else {
                        $mediaUrls[] = $row['url'];
                    }
                }
            } catch (Throwable $e2) {}
        }
                // games.video_url: одна ссылка, несколько через \n или JSON-массив
        if (!empty($game['video_url'])) {
            $rawVu = trim((string)$game['video_url']);
            $list = [];
            if ($rawVu !== '' && $rawVu[0] === '[') {
                $j = json_decode($rawVu, true);
                if (is_array($j)) {
                    foreach ($j as $item) {
                        if (is_string($item)) $list[] = $item;
                        elseif (is_array($item)) $list[] = (string)($item['url'] ?? $item['src'] ?? $item['mp4'] ?? '');
                    }
                }
            } else {
                $list = preg_split('/\r\n|\r|\n+/', $rawVu) ?: [];
            }
            $have = [];
            foreach ($videos as $vv) { $have[strtolower((string)($vv['url'] ?? ''))] = true; }
            $n = 0;
            foreach ($list as $vu) {
                $vu = trim((string)$vu);
                if ($vu === '') continue;
                if (stripos($vu, 'http://') === 0) $vu = 'https://' . substr($vu, 7);
                $dead = (bool)preg_match('~steam/apps/\d+/(movie_max|movie480)\.(mp4|webm)~i', $vu);
                if ($dead) continue;
                $key = strtolower($vu);
                if (isset($have[$key])) continue;
                $have[$key] = true;
                $fmt = 'mp4';
                if (stripos($vu, '.m3u8') !== false) $fmt = 'hls';
                elseif (stripos($vu, '.mpd') !== false) $fmt = 'dash';
                elseif (preg_match('/youtube\.com|youtu\.be/i', $vu)) $fmt = 'youtube';
                $videos[] = [
                    'url' => $vu,
                    'thumbnail' => !empty($game['cover_url']) ? $game['cover_url'] : null,
                    'name' => 'Трейлер' . ($n ? ' ' . ($n + 1) : ''),
                    'format' => $fmt,
                ];
                $n++;
            }
        }
        // живые трейлеры Steam (HLS) по appid из slug (...-s1091500)
        if (!$videos && !empty($game['slug']) && preg_match('/-s(\d{3,10})$/', $game['slug'], $sm)) {
            $aid = $sm[1];
            foreach (catioFetchSteamMovies((int)$aid) as $smv) {
                $videos[] = $smv;
            }
        }
        // нормализуем URL видео: http→https, относительные пути оставляем как есть
        foreach ($videos as &$vv) {
            if (empty($vv['url'])) continue;
            $u = $vv['url'];
            if (stripos($u, 'http://') === 0) {
                $u = 'https://' . substr($u, 7);
            }
            // локальные uploads/... — ок для <video src>
            $vv['url'] = $u;
            if (empty($vv['thumbnail']) && !empty($game['cover_url'])) {
                $vv['thumbnail'] = $game['cover_url'];
            }
            if (empty($vv['name'])) $vv['name'] = 'Трейлер';
        }
        unset($vv);

        $screenshots = [];
        try {
            $stmt = $pdo->prepare("SELECT image_url FROM game_screenshots WHERE game_id = ? ORDER BY sort, id");
            $stmt->execute([$id]);
            $screenshots = array_column($stmt->fetchAll(), 'image_url');
        } catch (Throwable $e) {}
        if ($mediaUrls) {
            $screenshots = array_values(array_unique(array_merge($mediaUrls, $screenshots)));
        }
        if (!$screenshots && !empty($game['cover_url'])) {
            $screenshots = [$game['cover_url']];
        }

        try {
            $stmt = $pdo->prepare("SELECT id, platform, version, changelog, file_url, file_name, file_size_bytes, status, created_at
                FROM game_builds WHERE game_id = ? AND (status = 'published' OR status IS NULL OR status = '')
                ORDER BY id DESC");
            $stmt->execute([$id]);
            $builds = $stmt->fetchAll();
        } catch (Throwable $e) {
            try {
                $stmt = $pdo->prepare("SELECT id, platform, version, file_url, file_size_bytes, created_at
                    FROM game_builds WHERE game_id = ? ORDER BY id DESC");
                $stmt->execute([$id]);
                $builds = $stmt->fetchAll();
            } catch (Throwable $e2) {
                $builds = [];
            }
        }

        $stmt = $pdo->prepare("
            SELECT c.id, c.body, c.created_at, c.parent_id, c.likes,
                   u.username, u.avatar, u.avatar_color, u.avatar_url, u.banner_url, u.id AS user_id,
                   (SELECT r.value FROM ratings r WHERE r.user_id = u.id AND r.game_id = c.game_id LIMIT 1) AS rating,
                   (SELECT l.playtime_minutes FROM library l WHERE l.user_id = u.id AND l.game_id = c.game_id LIMIT 1) AS playtime_minutes
            FROM comments c
            JOIN users u ON u.id = c.user_id
            WHERE c.game_id = ?
            ORDER BY c.created_at ASC
            LIMIT 200
        ");
        $stmt->execute([$id]);
        $comments = $stmt->fetchAll();
        foreach ($comments as &$cm) {
            $cm['parent_id'] = $cm['parent_id'] !== null ? (int)$cm['parent_id'] : null;
            $cm['likes'] = (int)($cm['likes'] ?? 0);
            $cm['dislikes'] = 0;
            $cm['rating'] = $cm['rating'] !== null ? (int)$cm['rating'] : null;
            $cm['playtime_minutes'] = $cm['playtime_minutes'] !== null ? (int)$cm['playtime_minutes'] : null;
            if (!empty($cm['avatar_url'])) {
                $cm['avatar_url'] = $cm['avatar_url'];
            } else {
                $cm['avatar_url'] = null;
            }
            $cm['profile_banner'] = !empty($cm['banner_url']) ? $cm['banner_url'] : null;
        }
        unset($cm);

        $stmt = $pdo->prepare("SELECT COUNT(*) AS cnt, AVG(value) AS avg_v FROM ratings WHERE game_id = ?");
        $stmt->execute([$id]);
        $ratingInfo = $stmt->fetch();

        $game = attachUserState($pdo, $game, $user);
        $isAdmin = $user && $user['role'] === 'admin';

        echo json_encode([
            'ok' => true,
            'game' => $game,
            'screenshots' => $screenshots,
            'videos' => $videos,
            'builds' => $builds,
            'comments' => $comments,
            'ratings_count' => (int)$ratingInfo['cnt'],
            'viewer' => [
                'authorized' => $user !== null,
                'is_admin' => $isAdmin,
                'user_id' => $user ? (int)$user['id'] : null,
            ],
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // ===== БИБЛИОТЕКА (реальная, по пользователю) =====
    
    
    // ===== Список достижений игры (Steam schema + % + иконки) =====
    
    // ===== SteamGridDB assets =====
    if ($method === 'GET' && $action === 'sgdb_assets') {
        $user = requireAuth();
        if (($user['role'] ?? '') !== 'admin' && empty($user['is_admin'])) {
            http_response_code(403);
            echo json_encode(['ok' => false, 'error' => 'Только для админов'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $appId = (int)($_GET['appid'] ?? 0);
        if ($appId <= 0 && !empty($_GET['url'])) {
            if (preg_match('/(\d{3,10})/', (string)$_GET['url'], $m)) $appId = (int)$m[1];
        }
        if ($appId <= 0) {
            echo json_encode(['ok' => false, 'error' => 'AppID'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $key = '';
        if (defined('STEAMGRIDDB_API_KEY')) $key = (string)STEAMGRIDDB_API_KEY;
        if ($key === '' && defined('SGDB_API_KEY')) $key = (string)SGDB_API_KEY;
        if ($key === '') {
            foreach ([__DIR__ . '/../config.php', __DIR__ . '/config.php'] as $cfg) {
                if (!is_file($cfg)) continue;
                $txt = @file_get_contents($cfg);
                if ($txt && preg_match("/define\\(\\s*'STEAMGRIDDB_API_KEY'\\s*,\\s*'([^']+)'\\s*\\)/", $txt, $mm)) {
                    $key = $mm[1];
                    break;
                }
            }
        }
        if ($key === '') {
            echo json_encode(['ok' => false, 'error' => 'Нет STEAMGRIDDB_API_KEY', 'need_key' => true], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $type = strtolower(trim((string)($_GET['type'] ?? 'icons')));
        $map = ['icon' => 'icons', 'icons' => 'icons', 'logo' => 'logos', 'logos' => 'logos',
                'banner' => 'heroes', 'heroes' => 'heroes', 'cover' => 'grids', 'grids' => 'grids', 'grid' => 'grids'];
        $endpoint = $map[$type] ?? 'icons';
        $sgdbGet = function(string $path) use ($key): ?array {
            $url = 'https://www.steamgriddb.com/api/v2/' . ltrim($path, '/');
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_TIMEOUT => 25,
                CURLOPT_SSL_VERIFYPEER => false,
                CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $key, 'Accept: application/json'],
            ]);
            $raw = curl_exec($ch);
            $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            if (!$raw || $code >= 400) return null;
            $j = json_decode($raw, true);
            return is_array($j) ? $j : null;
        };
        $json = $sgdbGet($endpoint . '/steam/' . $appId);
        if (!$json || empty($json['success'])) {
            $g = $sgdbGet('games/steam/' . $appId);
            $gid = $g['data']['id'] ?? null;
            if ($gid) $json = $sgdbGet($endpoint . '/game/' . (int)$gid);
        }
        $out = [];
        foreach (($json['data'] ?? []) as $r) {
            $url = $r['url'] ?? '';
            if ($url === '') continue;
            $out[] = [
                'url' => $url,
                'thumb' => $r['thumb'] ?? $url,
                'style' => (string)($r['style'] ?? ''),
                'score' => (int)($r['score'] ?? 0),
                'width' => (int)($r['width'] ?? 0),
                'height' => (int)($r['height'] ?? 0),
            ];
            if (count($out) >= 40) break;
        }
        echo json_encode(['ok' => true, 'appid' => $appId, 'type' => $type, 'assets' => $out, 'count' => count($out)], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($method === 'POST' && $action === 'update_assets') {
        $user = requireAuth();
        if (($user['role'] ?? '') !== 'admin' && empty($user['is_admin'])) {
            http_response_code(403);
            echo json_encode(['ok' => false, 'error' => 'Только для админов'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $body = json_decode(file_get_contents('php://input'), true);
        if (!is_array($body)) $body = $_POST;
        if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
            http_response_code(403);
            echo json_encode(['ok' => false, 'error' => 'CSRF'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $gameId = (int)($body['game_id'] ?? 0);
        if ($gameId <= 0) {
            echo json_encode(['ok' => false, 'error' => 'game_id'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $st = $pdo->prepare("SELECT id FROM games WHERE id = ?");
        $st->execute([$gameId]);
        if (!$st->fetch()) {
            echo json_encode(['ok' => false, 'error' => 'Игра не найдена'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $base = dirname(__DIR__) . '/uploads/games';
        $coversDir = dirname(__DIR__) . '/covers';
        if (!is_dir($coversDir)) @mkdir($coversDir, 0775, true);
        $dirs = [
            'icon' => $base . '/icons',
            'cover' => $base . '/covers',
            'banner' => $base . '/banners',
            'logo' => $base . '/logos',
        ];
        foreach ($dirs as $d) { if (!is_dir($d)) @mkdir($d, 0775, true); }
        $download = function(string $url, string $dir, string $prefix) {
            if ($url === '') return null;
            $url = trim($url);
            if (!preg_match('#^https?://#i', $url)) {
                $rel = ltrim(str_replace('\\', '/', $url), '/');
                if (strpos($rel, 'uploads/') === 0) {
                    $src = dirname(__DIR__) . '/' . $rel;
                    if (!is_file($src)) $src = __DIR__ . '/../' . $rel;
                    if (is_file($src)) {
                        $ext = strtolower(pathinfo($src, PATHINFO_EXTENSION) ?: 'jpg');
                        if ($ext === 'jpeg') $ext = 'jpg';
                        $ext = preg_replace('/[^a-z0-9]/', '', $ext) ?: 'jpg';
                        if (!is_dir($dir)) @mkdir($dir, 0775, true);
                        $name = $prefix . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
                        $full = rtrim($dir, "/\\") . '/' . $name;
                        if (@copy($src, $full)) return 'uploads/games/' . basename($dir) . '/' . $name;
                    }
                }
                return null;
            }
            $ext = 'jpg';
            $path = parse_url($url, PHP_URL_PATH) ?? '';
            if (preg_match('~\.(png|jpe?g|webp|gif)$~i', $path, $m)) $ext = strtolower($m[1] === 'jpeg' ? 'jpg' : $m[1]);
            $name = $prefix . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
            $full = rtrim($dir, '/\\') . '/' . $name;
            $ch = curl_init($url);
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 30, CURLOPT_SSL_VERIFYPEER => false]);
            $bin = curl_exec($ch);
            $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            if (!$bin || $code >= 400 || strlen($bin) < 100) return null;
            file_put_contents($full, $bin);
            return 'uploads/games/' . basename($dir) . '/' . $name;
        };
        $fields = [];
        $params = [];
        $iconUrl = trim((string)($body['icon_url'] ?? ''));
        $coverUrl = trim((string)($body['cover_url'] ?? ''));
        $bannerUrl = trim((string)($body['banner_url'] ?? ''));
        $logoUrl = trim((string)($body['logo_url'] ?? ''));
        if ($iconUrl !== '') {
            $local = $download($iconUrl, $dirs['icon'], 'g' . $gameId . '_icon');
            if ($local) {
                $fields[] = 'icon_url = ?'; $params[] = $local;
                $src = dirname(__DIR__) . '/' . $local;
                if (is_file($src)) @copy($src, $coversDir . '/appicon_' . $gameId . '.jpg');
                else {
                    $ch = curl_init($iconUrl);
                    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 30, CURLOPT_SSL_VERIFYPEER => false]);
                    $bin = curl_exec($ch); curl_close($ch);
                    if ($bin) file_put_contents($coversDir . '/appicon_' . $gameId . '.jpg', $bin);
                }
            }
        }
        if ($coverUrl !== '') {
            $local = $download($coverUrl, $dirs['cover'], 'g' . $gameId . '_cover');
            if ($local) { $fields[] = 'cover_url = ?'; $params[] = $local; }
        }
        if ($bannerUrl !== '') {
            $local = $download($bannerUrl, $dirs['banner'], 'g' . $gameId . '_banner');
            if ($local) { $fields[] = 'banner_url = ?'; $params[] = $local; }
        }
        if ($logoUrl !== '') {
            $local = $download($logoUrl, $dirs['logo'], 'g' . $gameId . '_logo');
            if ($local) {
                try { ensureColumn($pdo, 'games', 'logo_url', "VARCHAR(512) NULL"); } catch (Throwable $e) {}
                $fields[] = 'logo_url = ?'; $params[] = $local;
            }
        }
        if ($fields) {
            $params[] = $gameId;
            $pdo->prepare("UPDATE games SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);
        }
        echo json_encode(['ok' => true, 'game_id' => $gameId], JSON_UNESCAPED_UNICODE);
        exit;
    }


    if ($method === 'GET' && $action === 'achievements') {
        $gameId = (int)($_GET['id'] ?? 0);
        if ($gameId <= 0) {
            echo json_encode(['ok' => false, 'error' => 'id'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $st = $pdo->prepare("SELECT id, title, slug, steam_appid, ach_count FROM games WHERE id = ?");
        $st->execute([$gameId]);
        $game = $st->fetch();
        if (!$game) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Игра не найдена'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $appId = (int)($game['steam_appid'] ?? 0);
        if ($appId <= 0 && !empty($game['slug']) && preg_match('/-s(\d{3,10})$/', $game['slug'], $m)) {
            $appId = (int)$m[1];
            try { $pdo->prepare("UPDATE games SET steam_appid = ? WHERE id = ?")->execute([$appId, $gameId]); } catch (Throwable $e) {}
        }

        $force = !empty($_GET['refresh']);
        $cntSt = $pdo->prepare("SELECT COUNT(*) FROM game_achievements WHERE game_id = ?");
        $cntSt->execute([$gameId]);
        $cnt = (int)$cntSt->fetchColumn();
        // синк только если пусто / refresh / данные битые (нет иконок)
        $needSync = $force || $cnt === 0;
        if (!$needSync && $cnt > 0) {
            $bad = (int)$pdo->query("SELECT COUNT(*) FROM game_achievements WHERE game_id = ".(int)$gameId." AND (icon_url IS NULL OR icon_url = '')")->fetchColumn();
            if ($bad === $cnt) $needSync = true;
        }
        if ($appId > 0 && $needSync) {
            @set_time_limit(120);
            syncGameAchievementsFromSteam($pdo, $gameId, $appId);
        }

        $st = $pdo->prepare("SELECT api_name, display_name, description, icon_url, icon_gray_url, percent, is_hidden, sort_order
            FROM game_achievements WHERE game_id = ? ORDER BY is_hidden ASC, percent DESC, sort_order ASC, id ASC");
        $st->execute([$gameId]);
        $list = $st->fetchAll();
        foreach ($list as &$a) {
            $a['percent'] = (float)$a['percent'];
            $a['is_hidden'] = (int)$a['is_hidden'];
            $a['unlocked'] = 0; // без привязки Steam-аккаунта
        }
        unset($a);
        $total = count($list);
        try {
            $pdo->prepare("UPDATE games SET ach_count = ? WHERE id = ?")->execute([$total, $gameId]);
        } catch (Throwable $e) {}

        echo json_encode([
            'ok' => true,
            'game_id' => $gameId,
            'title' => $game['title'],
            'steam_appid' => $appId,
            'total' => $total,
            'unlocked' => 0,
            'achievements' => $list,
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // ===== Синхронизация ачивок из Steam (публичный API, без ключа) =====
    if ($method === 'POST' && $action === 'sync_steam_achievements') {
        $user = requireAuth();
        $body = json_decode(file_get_contents('php://input'), true) ?: $_POST;
        if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
            http_response_code(403);
            echo json_encode(['ok' => false, 'error' => 'CSRF'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $uid = (int)$user['id'];
        $onlyGameId = isset($body['game_id']) ? (int)$body['game_id'] : 0;

        // helper inline
        $fetchAch = function(int $appId) {
            $url = "https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=" . $appId;
            if (function_exists('curl_init')) {
                $ch = curl_init($url);
                curl_setopt_array($ch, [
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_TIMEOUT => 15,
                    CURLOPT_FOLLOWLOCATION => true,
                    CURLOPT_SSL_VERIFYPEER => false,
                    CURLOPT_USERAGENT => 'CATio/1.0',
                ]);
                $raw = curl_exec($ch);
                curl_close($ch);
            } else {
                $raw = @file_get_contents($url);
            }
            if ($raw === false || $raw === null) return 0;
            $json = json_decode($raw, true);
            $list = $json['achievementpercentages']['achievements'] ?? null;
            return is_array($list) ? count($list) : 0;
        };

        $sql = "
            SELECT g.id, g.slug, g.steam_appid, g.ach_count, l.ach_total
            FROM library l
            JOIN games g ON g.id = l.game_id
            WHERE l.user_id = ?
        ";
        $params = [$uid];
        if ($onlyGameId > 0) {
            $sql .= " AND g.id = ?";
            $params[] = $onlyGameId;
        }
        $st = $pdo->prepare($sql);
        $st->execute($params);
        $rows = $st->fetchAll();
        $updated = 0;
        foreach ($rows as $row) {
            $appId = (int)($row['steam_appid'] ?? 0);
            if ($appId <= 0 && !empty($row['slug']) && preg_match('/-s(\d{3,10})$/', $row['slug'], $m)) {
                $appId = (int)$m[1];
            }
            if ($appId <= 0) continue;

            // всегда обновляем appid если нашли
            if (empty($row['steam_appid']) && $appId > 0) {
                try { $pdo->prepare("UPDATE games SET steam_appid = ? WHERE id = ?")->execute([$appId, $row['id']]); } catch (Throwable $e) {}
            }

            $count = $fetchAch($appId);
            try {
                $pdo->prepare("UPDATE games SET ach_count = ?, steam_appid = ? WHERE id = ?")->execute([$count, $appId, $row['id']]);
                // в library: total = schema count, unlocked не трогаем (нет привязки Steam-аккаунта)
                $pdo->prepare("UPDATE library SET ach_total = ? WHERE user_id = ? AND game_id = ?")
                    ->execute([$count, $uid, $row['id']]);
                $updated++;
            } catch (Throwable $e) {}
        }
        echo json_encode(['ok' => true, 'updated' => $updated], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($method === 'GET' && $action === 'library') {
        $user = requireAuth();
        $stmt = $pdo->prepare("
            SELECT g.id, g.title, g.slug, g.short_description, g.description,
                   g.price, g.discount_percent, g.category, g.genre, g.tags, g.rating,
                   g.cover_url, g.banner_url, g.icon_url, g.cover_emoji, g.cover_color,
                   g.developer_name, g.download_count,
                   l.added_at, l.last_played, l.playtime_minutes, l.is_pinned, l.pinned_order, COALESCE(l.ach_unlocked,0) AS ach_unlocked, COALESCE(NULLIF(l.ach_total,0), g.ach_count, 0) AS ach_total, g.steam_appid, g.ach_count AS game_ach_count,
                   COALESCE(l.is_liked, 0) AS is_liked, l.liked_at,
                   (SELECT COUNT(*) FROM game_builds b WHERE b.game_id = g.id) AS builds_count,
                   (SELECT GROUP_CONCAT(DISTINCT b.platform) FROM game_builds b WHERE b.game_id = g.id) AS platforms
            FROM library l
            JOIN games g ON g.id = l.game_id
            WHERE l.user_id = ?
            ORDER BY COALESCE(l.is_liked, 0) DESC, l.liked_at DESC, l.is_pinned DESC, l.pinned_order DESC, COALESCE(l.last_played, l.added_at) DESC
        ");
        $stmt->execute([(int)$user['id']]);
        $games = $stmt->fetchAll();
        foreach ($games as &$g) {
            $g['owned'] = true;
            $g['cover_src'] = !empty($g['cover_url']) ? $g['cover_url'] : ('media.php?type=cover&id=' . $g['id']);
            // всегда через media.php?type=icon — там Steam library_600x900 / client-style
            $g['icon_src'] = 'media.php?type=icon&id=' . $g['id'];
            $g['playtime_minutes'] = (int)($g['playtime_minutes'] ?? 0);
            $g['is_pinned'] = (int)($g['is_pinned'] ?? 0);
            $g['ach_unlocked'] = (int)($g['ach_unlocked'] ?? 0);
            $g['ach_total'] = (int)($g['ach_total'] ?? 0);
            $g['is_liked'] = (int)($g['is_liked'] ?? 0);
            $g['liked'] = (bool)$g['is_liked'];
        }
        unset($g);
        echo json_encode(['ok' => true, 'library' => $games], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // ===== ПОКУПКА / ПОЛУЧЕНИЕ БЕСПЛАТНОЙ =====
    if ($method === 'POST' && $action === 'buy') {
        $user = requireAuth();
        $body = jsonBody();
        checkCsrf($body);
        $gameId = (int)($body['game_id'] ?? 0);
        $giftTo = (int)($body['gift_to'] ?? 0);

        $stmt = $pdo->prepare("SELECT id, title, price, discount_percent, cover_url, banner_url FROM games WHERE id = ? AND is_published = 1 AND COALESCE(status, 'published') NOT IN ('pending','rejected','draft')");
        $stmt->execute([$gameId]);
        $game = $stmt->fetch();
        if (!$game) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Игра не найдена'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $uid = (int)$user['id'];
        $isGift = $giftTo > 0 && $giftTo !== $uid;
        $targetUid = $isGift ? $giftTo : $uid;

        if ($isGift) {
            // только принятые друзья
            $stF = $pdo->prepare("SELECT 1 FROM friendships WHERE status = 'accepted' AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) LIMIT 1");
            $stF->execute([$uid, $giftTo, $giftTo, $uid]);
            if (!$stF->fetch()) {
                http_response_code(400);
                echo json_encode(['ok' => false, 'error' => 'Подарить можно только другу'], JSON_UNESCAPED_UNICODE);
                exit;
            }
            $stU = $pdo->prepare("SELECT id, username FROM users WHERE id = ?");
            $stU->execute([$giftTo]);
            $friendRow = $stU->fetch();
            if (!$friendRow) {
                http_response_code(404);
                echo json_encode(['ok' => false, 'error' => 'Пользователь не найден'], JSON_UNESCAPED_UNICODE);
                exit;
            }
        }

        // для себя: уже в библиотеке
        if (!$isGift && ownsGame($pdo, $uid, $gameId)) {
            echo json_encode(['ok' => true, 'already' => true, 'owned' => true, 'purchased' => true, 'balance' => (int)$user['balance']], JSON_UNESCAPED_UNICODE);
            exit;
        }

        // Уже покупал (себе) раньше — вернуть в библиотеку без списания
        if (!$isGift && hasPurchased($pdo, $uid, $gameId)) {
            try {
                $pdo->prepare("INSERT INTO library (user_id, game_id) VALUES (?, ?)")->execute([$uid, $gameId]);
            } catch (Throwable $e) {}
            echo json_encode([
                'ok' => true,
                'already' => false,
                'restored' => true,
                'owned' => true,
                'purchased' => true,
                'balance' => (int)$user['balance'],
                'message' => '«' . $game['title'] . '» снова добавлена в библиотеку',
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }

        // подарок: если у друга уже покупка — просто в библиотеку, без списания у дарителя
        if ($isGift && hasPurchased($pdo, $targetUid, $gameId)) {
            try {
                $pdo->prepare("INSERT INTO library (user_id, game_id) VALUES (?, ?)")->execute([$targetUid, $gameId]);
            } catch (Throwable $e) {}
            echo json_encode([
                'ok' => true,
                'already' => false,
                'restored' => true,
                'gift' => true,
                'owned' => false,
                'purchased' => false,
                'balance' => (int)$user['balance'],
                'message' => 'У друга уже есть эта игра — вернули в библиотеку',
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }
        if ($isGift && ownsGame($pdo, $targetUid, $gameId)) {
            echo json_encode(['ok' => true, 'already' => true, 'gift' => true, 'balance' => (int)$user['balance'], 'message' => 'У друга уже есть эта игра'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $basePrice = (float)$game['price'];
        $discount = min(100, max(0, (int)($game['discount_percent'] ?? 0)));
        $price = $discount > 0 ? round($basePrice * (100 - $discount) / 100, 2) : $basePrice;
        $pdo->beginTransaction();
        try {
            if ($price > 0) {
                $stmt = $pdo->prepare("UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?");
                $stmt->execute([(int)round($price), $uid, (int)round($price)]);
                if ($stmt->rowCount() === 0) {
                    $pdo->rollBack();
                    echo json_encode(['ok' => false, 'error' => 'Не хватает средств. Пополни баланс в профиле.', 'code' => 'no_funds'], JSON_UNESCAPED_UNICODE);
                    exit;
                }
            }
            $pdo->prepare("INSERT INTO library (user_id, game_id) VALUES (?, ?)")
                ->execute([$targetUid, $gameId]);
            $pdo->prepare("INSERT INTO purchases (user_id, game_id, price_paid) VALUES (?, ?, ?)")
                ->execute([$targetUid, $gameId, $price]);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        if ($isGift) {
            try {
                $banner = $game['banner_url'] ?: ($game['cover_url'] ?: ('media.php?type=hero&id=' . $gameId));
                $meta = json_encode([
                    'game_id' => $gameId,
                    'from_user_id' => $uid,
                    'from_username' => $user['username'] ?? '',
                    'title' => $game['title'],
                    'banner_url' => $banner,
                    'cover_url' => $banner,
                ], JSON_UNESCAPED_UNICODE);
                $pdo->prepare("INSERT INTO notifications (user_id, type, title, body, meta_json) VALUES (?, 'gift', ?, ?, ?)")
                    ->execute([
                        $targetUid,
                        'Подарок: «' . $game['title'] . '»',
                        ($user['username'] ?? 'Друг') . ' подарил(а) вам «' . $game['title'] . '». Игра уже в библиотеке.',
                        $meta,
                    ]);
            } catch (Throwable $e) {}
        }

        $stmt = $pdo->prepare("SELECT balance FROM users WHERE id = ?");
        $stmt->execute([$uid]);

        echo json_encode([
            'ok' => true,
            'already' => false,
            'owned' => !$isGift,
            'purchased' => !$isGift,
            'gift' => $isGift,
            'gift_to' => $isGift ? $giftTo : null,
            'balance' => (int)$stmt->fetchColumn(),
            'message' => $isGift
                ? ('Подарок «' . $game['title'] . '» отправлен')
                : ($price > 0
                    ? '«' . $game['title'] . '» куплена и добавлена в библиотеку'
                    : '«' . $game['title'] . '» добавлена в библиотеку'),
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // ===== УДАЛИТЬ ИЗ БИБЛИОТЕКИ =====
    if ($method === 'POST' && $action === 'remove') {
        $user = requireAuth();
        $body = jsonBody();
        checkCsrf($body);
        $gameId = (int)($body['game_id'] ?? 0);
        if ($gameId <= 0) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Не указана игра'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $stmt = $pdo->prepare("DELETE FROM library WHERE user_id = ? AND game_id = ?");
        $stmt->execute([(int)$user['id'], $gameId]);
        $stillPurchased = hasPurchased($pdo, (int)$user['id'], $gameId);
        echo json_encode([
            'ok' => true,
            'removed' => $stmt->rowCount() > 0,
            'purchased' => $stillPurchased,
            'message' => 'Игра убрана из библиотеки',
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // ===== ВРЕМЯ ИГРЫ =====
    if ($method === 'POST' && $action === 'set_playtime') {
        $user = requireAuth();
        $body = jsonBody();
        checkCsrf($body);
        $gameId = (int)($body['game_id'] ?? 0);
        $minutes = isset($body['minutes']) ? (int)$body['minutes'] : null;
        if ($gameId <= 0) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Не указана игра'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $chk = $pdo->prepare("SELECT 1 FROM library WHERE user_id = ? AND game_id = ?");
        $chk->execute([(int)$user['id'], $gameId]);
        if (!$chk->fetchColumn()) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Игры нет в библиотеке'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        if ($minutes === null) {
            // «обновить» — добавить 1–5 минут как имитацию сессии
            $pdo->prepare("UPDATE library SET playtime_minutes = COALESCE(playtime_minutes,0) + ?, last_played = NOW() WHERE user_id = ? AND game_id = ?")
                ->execute([rand(1, 5), (int)$user['id'], $gameId]);
        } else {
            $minutes = max(0, $minutes);
            $pdo->prepare("UPDATE library SET playtime_minutes = ?, last_played = IF(? > 0, COALESCE(last_played, NOW()), last_played) WHERE user_id = ? AND game_id = ?")
                ->execute([$minutes, $minutes, (int)$user['id'], $gameId]);
        }
        $st = $pdo->prepare("SELECT playtime_minutes FROM library WHERE user_id = ? AND game_id = ?");
        $st->execute([(int)$user['id'], $gameId]);
        $pt = (int)$st->fetchColumn();
        echo json_encode(['ok' => true, 'playtime_minutes' => $pt], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // ===== ОЦЕНКА ИГРЫ =====
    if ($method === 'POST' && $action === 'rate') {
        $user = requireAuth();
        $body = jsonBody();
        checkCsrf($body);
        $gameId = (int)($body['game_id'] ?? 0);
        $value = (int)($body['value'] ?? 0);
        if ($value < 1 || $value > 5) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Оценка от 1 до 5'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $stmt = $pdo->prepare("SELECT id FROM games WHERE id = ? AND is_published = 1 AND COALESCE(status, 'published') NOT IN ('pending','rejected','draft')");
        $stmt->execute([$gameId]);
        if (!$stmt->fetch()) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Игра не найдена'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $pdo->prepare("INSERT INTO ratings (user_id, game_id, value) VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE value = VALUES(value)")
            ->execute([(int)$user['id'], $gameId, $value]);
        recalcGameRating($pdo, $gameId);

        $stmt = $pdo->prepare("SELECT rating FROM games WHERE id = ?");
        $stmt->execute([$gameId]);
        echo json_encode(['ok' => true, 'rating' => (float)$stmt->fetchColumn(), 'user_rating' => $value], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // ===== ДОБАВИТЬ КОММЕНТАРИЙ =====
    if ($method === 'POST' && $action === 'comment') {
        $user = requireAuth();
        $body = jsonBody();
        checkCsrf($body);
        $gameId = (int)($body['game_id'] ?? 0);
        $text = trim((string)($body['body'] ?? ''));
        $parentId = isset($body['parent_id']) ? (int)$body['parent_id'] : null;
        if ($parentId <= 0) $parentId = null;
        if (mb_strlen($text) < 2 || mb_strlen($text) > 1000) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Комментарий от 2 до 1000 символов'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $stmt = $pdo->prepare("SELECT id FROM games WHERE id = ? AND is_published = 1 AND COALESCE(status, 'published') NOT IN ('pending','rejected','draft')");
        $stmt->execute([$gameId]);
        if (!$stmt->fetch()) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Игра не найдена'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        if ($parentId) {
            $chk = $pdo->prepare("SELECT id FROM comments WHERE id = ? AND game_id = ?");
            $chk->execute([$parentId, $gameId]);
            if (!$chk->fetch()) $parentId = null;
        }
        $pdo->prepare("INSERT INTO comments (game_id, user_id, body, parent_id) VALUES (?, ?, ?, ?)")
            ->execute([$gameId, (int)$user['id'], $text, $parentId]);
        $id = (int)$pdo->lastInsertId();

        $stmt = $pdo->prepare("SELECT c.id, c.body, c.created_at, c.parent_id, c.likes,
            u.username, u.avatar, u.avatar_color, u.avatar_url, u.banner_url, u.id AS user_id
            FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?");
        $stmt->execute([$id]);
        echo json_encode(['ok' => true, 'comment' => $stmt->fetch()], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // ===== УДАЛИТЬ КОММЕНТАРИЙ (свой или админ) =====
    if ($method === 'POST' && $action === 'delete_comment') {
        $user = requireAuth();
        $body = jsonBody();
        checkCsrf($body);
        $commentId = (int)($body['comment_id'] ?? 0);
        $stmt = $pdo->prepare("SELECT user_id FROM comments WHERE id = ?");
        $stmt->execute([$commentId]);
        $ownerId = $stmt->fetchColumn();
        if ($ownerId === false) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Комментарий не найден'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        if ((int)$ownerId !== (int)$user['id'] && $user['role'] !== 'admin') {
            http_response_code(403);
            echo json_encode(['ok' => false, 'error' => 'Можно удалять только свои комментарии'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $pdo->prepare("DELETE FROM comments WHERE id = ?")->execute([$commentId]);
        echo json_encode(['ok' => true]);
        exit;
    }

    // ===== «ИГРАТЬ»: фиксируем последний запуск (для библиотеки как в Steam) =====
    if ($method === 'POST' && $action === 'launch') {
        $user = requireAuth();
        $body = jsonBody();
        checkCsrf($body);
        $gameId = (int)($body['game_id'] ?? 0);
        if (ownsGame($pdo, (int)$user['id'], $gameId)) {
            $pdo->prepare("UPDATE library SET last_played = NOW() WHERE user_id = ? AND game_id = ?")
                ->execute([(int)$user['id'], $gameId]);
        }
        echo json_encode(['ok' => true]);
        exit;
    }

    // ===== СБОРКИ ИГРЫ (файлы для скачивания) =====
    if ($method === 'GET' && $action === 'builds' && isset($_GET['game_id'])) {
        $gid = (int)$_GET['game_id'];
        $user = getCurrentUser();
        $isAdmin = $user && (($user['role'] ?? '') === 'admin');
        $sql = "SELECT id, platform, version, changelog, file_url, file_name, file_size_bytes, status, created_at
            FROM game_builds WHERE game_id = ?";
        if (!$isAdmin) $sql .= " AND (status = 'published' OR status IS NULL OR status = '')";
        $sql .= " ORDER BY created_at DESC";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([$gid]);
        echo json_encode(['ok' => true, 'builds' => $stmt->fetchAll()], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // ===== СКАЧИВАНИЕ СБОРКИ =====
    // Файл генерируется в web/files/ при первом скачивании (настоящий ZIP,
    // если есть ZipArchive, иначе честный .txt). Отдаём потоком с небольшим
    // ограничением скорости — так страница «Загрузки» показывает живой прогресс.
    if ($method === 'GET' && $action === 'download' && isset($_GET['build_id'])) {
        $user = requireAuth();
        $bid = (int)$_GET['build_id'];
        $stmt = $pdo->prepare("
            SELECT b.*, g.title, g.slug, g.price
            FROM game_builds b
            JOIN games g ON g.id = b.game_id
            WHERE b.id = ?
        ");
        $stmt->execute([$bid]);
        $build = $stmt->fetch();
        if (!$build) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Сборка не найдена'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        // Платное — только владельцам (и админу). Pending — только админу (предзагрузка).
        $isAdmin = $user['role'] === 'admin';
        $bStatus = (string)($build['status'] ?? 'published');
        if ($bStatus === 'pending' && !$isAdmin) {
            http_response_code(403);
            echo json_encode(['ok' => false, 'error' => 'Сборка на модерации'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        if ($bStatus === 'rejected') {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Сборка недоступна'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        if ((float)$build['price'] > 0 && !$isAdmin && !ownsGame($pdo, (int)$user['id'], (int)$build['game_id'])) {
            http_response_code(403);
            echo json_encode(['ok' => false, 'error' => 'Сначала купи игру — потом скачивай'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $path = __DIR__ . '/../' . ltrim(str_replace('..', '', $build['file_url']), '/');
        if (!is_file($path)) {
            $generated = generateBuildFile($pdo, $build, $path);
            if (!$generated) {
                http_response_code(500);
                echo json_encode(['ok' => false, 'error' => 'Не удалось подготовить файл сборки'], JSON_UNESCAPED_UNICODE);
                exit;
            }
            // build мог поменять расширение (.zip -> .txt) — перечитываем
            $stmt = $pdo->prepare("SELECT * FROM game_builds WHERE id = ?");
            $stmt->execute([$bid]);
            $build = $stmt->fetch();
            $path = __DIR__ . '/../' . ltrim(str_replace('..', '', $build['file_url']), '/');
        }

        // Считаем скачивание и отмечаем активность в библиотеке
        $pdo->prepare("UPDATE games SET download_count = download_count + 1 WHERE id = ?")
            ->execute([$build['game_id']]);
        $pdo->prepare("UPDATE library SET last_played = NOW() WHERE user_id = ? AND game_id = ?")
            ->execute([(int)$user['id'], (int)$build['game_id']]);

        $ext = pathinfo($path, PATHINFO_EXTENSION);
        $filename = $build['slug'] . '-' . $build['version'] . '-' . $build['platform'] . '.' . $ext;
        $size = filesize($path);

        // Докачка с места паузы (Range: bytes=N-) — как в Steam
        $offset = 0;
        $statusCode = 200;
        $rangeHeader = $_SERVER['HTTP_RANGE'] ?? '';
        if (preg_match('/bytes=(\d+)-/', $rangeHeader, $m)) {
            $offset = min((int)$m[1], $size);
            $statusCode = 206;
        }

        // Отдача файла — переключаем заголовки с JSON на бинарные
        header_remove('Content-Type');
        http_response_code($statusCode);
        header('Content-Type: application/octet-stream');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Accept-Ranges: bytes');
        if ($statusCode === 206) {
            header('Content-Range: bytes ' . $offset . '-' . ($size - 1) . '/' . $size);
        }
        header('Content-Length: ' . ($size - $offset));
        header('X-Content-Type-Options: nosniff');

        // Троттлинг ~1.5 МБ/с, чтобы прогресс был виден (отключается ?throttle=0)
        $throttle = ($_GET['throttle'] ?? '1') !== '0';
        $chunk = 64 * 1024;
        $handle = fopen($path, 'rb');
        if ($offset > 0) fseek($handle, $offset);
        while (!feof($handle)) {
            echo fread($handle, $chunk);
            if (ob_get_level() > 0) ob_flush();
            flush();
            if ($throttle) usleep(42000); // ~1.5 МБ/с при чанке 64 КБ
        }
        fclose($handle);
        exit;
    }

    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Unknown action'], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    if (!headers_sent()) {
        http_response_code(500);
    }
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
}

// ============================================================
//  ГЕНЕРАЦИЯ ДЕМО-ФАЙЛА СБОРКИ
// ============================================================
// Демо-игры поставляются без реальных бинарников. Чтобы страница загрузок
// работала по-честному, генерируем настоящий архив с фиктивным «игровым»
// содержимым (6–14 МБ, размер зависит от игры). Если ZipArchive недоступен —
// сохраняем честный .txt и правим file_url в базе.
function generateBuildFile(PDO $pdo, array $build, string $path): bool {
    $dir = dirname($path);
    if (!is_dir($dir) && !mkdir($dir, 0775, true)) {
        return false;
    }

    $sizeMb = 6 + ((int)$build['game_id'] % 9); // 6..14 МБ, детерминированно
    $targetBytes = $sizeMb * 1024 * 1024;
    $readme = "CATio demo build\n"
        . "================\n"
        . "Игра:    {$build['title']}\n"
        . "Платформа: {$build['platform']}\n"
        . "Версия:  {$build['version']}\n\n"
        . "Это демо-файл, сгенерированный сервером, чтобы страница загрузок\n"
        . "работала как в Steam. Замени его на настоящую сборку в папке web/files/,\n"
        . "и CATio начнёт отдавать уже её.\n";

    $zipOk = class_exists('ZipArchive');
    if ($zipOk) {
        $zip = new ZipArchive();
        if ($zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) === true) {
            $zip->addFromString('README.txt', $readme);
            // «Бинарник» игры: несжимаемый шум, чтобы размер был честным
            $chunk = random_bytes(256 * 1024);
            $payload = '';
            $written = 0;
            while ($written < $targetBytes) {
                $payload .= $chunk;
                $written += strlen($chunk);
                if (strlen($payload) >= 4 * 1024 * 1024) {
                    $zip->addFromString('game_' . $written . '.bin', $payload);
                    $payload = '';
                }
            }
            if ($payload !== '') {
                $zip->addFromString('game_final.bin', $payload);
            }
            $zip->close();
        } else {
            $zipOk = false;
        }
    }

    if (!$zipOk) {
        // Фолбэк без ZipArchive: текстовый файл, правим file_url в базе
        $path = preg_replace('/\.zip$/i', '.txt', $path);
        $handle = fopen($path, 'wb');
        if (!$handle) return false;
        fwrite($handle, $readme . str_repeat("=", 60) . "\n\n");
        $line = str_repeat("CATIO-DEMO-DATA ", 8) . "\n";
        $written = 0;
        while ($written < $targetBytes) {
            fwrite($handle, $line);
            $written += strlen($line);
        }
        fclose($handle);

        $newUrl = preg_replace('/\.zip$/i', '.txt', $build['file_url']);
        $pdo->prepare("UPDATE game_builds SET file_url = ? WHERE id = ?")
            ->execute([$newUrl, $build['id']]);
    }

    // Фиксируем честный размер файла
    $pdo->prepare("UPDATE game_builds SET file_size_bytes = ? WHERE id = ?")
        ->execute([filesize($path), $build['id']]);

    return true;
}
