<?php
// CATio — импорт игры из Steam Store (тест для админа)
foreach ([__DIR__ . '/../config.php', __DIR__ . '/config.php'] as $_cfg) {
    if (is_file($_cfg)) { require_once $_cfg; break; }
}
require_once __DIR__ . '/../auth.php';

function sgdbApiKey(): string {
    if (defined('STEAMGRIDDB_API_KEY') && STEAMGRIDDB_API_KEY) return (string)STEAMGRIDDB_API_KEY;
    if (defined('SGDB_API_KEY') && SGDB_API_KEY) return (string)SGDB_API_KEY;
    $e = getenv('STEAMGRIDDB_API_KEY') ?: getenv('SGDB_API_KEY');
    if ($e) return (string)$e;
    // fallback: parse config.php if define wasn't loaded
    foreach ([__DIR__ . '/../config.php', __DIR__ . '/config.php'] as $cfg) {
        if (!is_file($cfg)) continue;
        $txt = @file_get_contents($cfg);
        if ($txt && preg_match("/define\(\s*'STEAMGRIDDB_API_KEY'\s*,\s*'([^']+)'\s*\)/", $txt, $m)) {
            return $m[1];
        }
    }
    return '';
}

function sgdbRequest(string $path): ?array {
    $key = sgdbApiKey();
    if ($key === '') return null;
    $url = 'https://www.steamgriddb.com/api/v2/' . ltrim($path, '/');
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => 25,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $key,
                'Accept: application/json',
                'User-Agent: CATio/1.0',
            ],
        ]);
        $raw = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($raw === false || $code >= 400) return null;
        $json = json_decode($raw, true);
        return is_array($json) ? $json : null;
    }
    $ctx = stream_context_create([
        'http' => [
            'timeout' => 25,
            'header' => "Authorization: Bearer {$key}\r\nAccept: application/json\r\nUser-Agent: CATio/1.0\r\n",
        ],
        'ssl' => ['verify_peer' => false, 'verify_peer_name' => false],
    ]);
    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) return null;
    $json = json_decode($raw, true);
    return is_array($json) ? $json : null;
}

/** @return list<array{url:string,thumb:string,style:string,score:int,width:int,height:int}> */
function sgdbAssetsBySteam(int $steamAppId, string $kind): array {
    // kind: icons | grids | heroes | logos
    $map = [
        'icons' => 'icons',
        'icon' => 'icons',
        'grids' => 'grids',
        'cover' => 'grids',
        'covers' => 'grids',
        'heroes' => 'heroes',
        'banner' => 'heroes',
        'banners' => 'heroes',
        'logos' => 'logos',
        'logo' => 'logos',
    ];
    $endpoint = $map[$kind] ?? $kind;
    $json = sgdbRequest($endpoint . '/steam/' . $steamAppId);
    if (!$json || empty($json['success'])) {
        // fallback: resolve SGDB game id then by game id
        $g = sgdbRequest('games/steam/' . $steamAppId);
        $gid = $g['data']['id'] ?? null;
        if ($gid) {
            $json = sgdbRequest($endpoint . '/game/' . (int)$gid);
        }
    }
    $rows = $json['data'] ?? [];
    if (!is_array($rows)) return [];
    $out = [];
    foreach ($rows as $r) {
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
    return $out;
}


header('Content-Type: application/json; charset=utf-8');

set_exception_handler(function ($e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
    exit;
});

$pdo = getDB();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

function requireAdminSteam(): array {
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

function parseSteamAppId(string $input): ?int {
    $input = trim($input);
    if ($input === '') return null;
    if (preg_match('/^\d{1,10}$/', $input)) return (int)$input;
    if (preg_match('~store\.steampowered\.com/app/(\d+)~i', $input, $m)) return (int)$m[1];
    if (preg_match('~steamcommunity\.com/(?:app|games)/(\d+)~i', $input, $m)) return (int)$m[1];
    if (preg_match('~[?&]appid=(\d+)~i', $input, $m)) return (int)$m[1];
    return null;
}

function steamCookieHeader(): string {
    // age gate / mature content — иначе success:false на 18+ играх
    $birth = strtotime("1990-01-01");
    return "birthtime={$birth}; lastagecheckage=1-0-1990; mature_content=1; wants_mature_content=1";
}

function httpGetJson(string $url, int $timeout = 25): ?array {
    $raw = null;
    $headers = [
        "Accept: application/json",
        "Accept-Language: en-US,en;q=0.9,ru;q=0.8",
        "Cookie: " . steamCookieHeader(),
    ];
    if (function_exists("curl_init")) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 12,
            CURLOPT_USERAGENT => "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
        ]);
        $raw = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($raw === false || $code >= 400) return null;
    } else {
        $hdr = "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\n";
        foreach ($headers as $h) $hdr .= $h . "\r\n";
        $ctx = stream_context_create([
            "http" => ["timeout" => $timeout, "header" => $hdr],
            "ssl" => ["verify_peer" => false, "verify_peer_name" => false],
        ]);
        $raw = @file_get_contents($url, false, $ctx);
        if ($raw === false) return null;
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : null;
}

function httpDownload(string $url, string $destPath, int $timeout = 30): bool {
    if (function_exists('curl_init')) {
        $fp = fopen($destPath, 'wb');
        if (!$fp) return false;
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_FILE => $fp,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; CATioSteamImport/1.0)',
        ]);
        $ok = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        fclose($fp);
        if (!$ok || $code >= 400 || !is_file($destPath) || filesize($destPath) < 100) {
            @unlink($destPath);
            return false;
        }
        return true;
    }
    $ctx = stream_context_create(['http' => ['timeout' => $timeout, 'header' => "User-Agent: Mozilla/5.0\r\n"]]);
    $data = @file_get_contents($url, false, $ctx);
    if ($data === false || strlen($data) < 100) return false;
    return file_put_contents($destPath, $data) !== false;
}

function slugifySteam(string $s): string {
    $s = mb_strtolower($s, 'UTF-8');
    $s = preg_replace('~[^a-z0-9а-яё]+~u', '-', $s);
    $s = trim($s, '-');
    if ($s === '') $s = 'game';
    return substr($s, 0, 80);
}

function stripSteamHtml(string $html): string {
    $html = preg_replace('~<br\s*/?>~i', "\n", $html);
    $html = preg_replace('~</p>~i', "\n\n", $html);
    $html = preg_replace('~</li>~i', "\n", $html);
    $html = strip_tags($html);
    $html = html_entity_decode($html, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $html = preg_replace("/[ \t]+/", ' ', $html);
    $html = preg_replace("/\n{3,}/", "\n\n", $html);
    return trim($html);
}

function parseSteamLanguages(string $raw): string {
    $raw = strip_tags($raw);
    $raw = html_entity_decode($raw, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $parts = preg_split('~[,;]+~', $raw);
    $out = [];
    foreach ($parts as $p) {
        $name = trim(preg_replace('~\*~', '', $p));
        $name = trim(preg_replace('~\s+~', ' ', $name));
        if ($name === '' || mb_strlen($name) > 60) continue;
        $out[] = ['name' => $name, 'subtitles' => true, 'audio' => true];
        if (count($out) >= 30) break;
    }
    return json_encode($out, JSON_UNESCAPED_UNICODE);
}

function fetchSteamApp(int $appId): ?array {
    // Cyberpunk и др. 18+ часто success:false на l=russian / cc=ru
    $attempts = [
        "https://store.steampowered.com/api/appdetails?appids={id}&l=english&cc=us",
        "https://store.steampowered.com/api/appdetails?appids={id}&l=russian&cc=us",
        "https://store.steampowered.com/api/appdetails?appids={id}&l=english&cc=de",
        "https://store.steampowered.com/api/appdetails?appids={id}&l=english",
        "https://store.steampowered.com/api/appdetails?appids={id}&l=russian",
        "https://store.steampowered.com/api/appdetails?appids={id}",
    ];
    $key = (string)$appId;
    foreach ($attempts as $tpl) {
        $url = str_replace("{id}", $key, $tpl);
        $json = httpGetJson($url);
        if (!$json) continue;
        // ключ иногда int в JSON decode? проверяем оба
        $block = $json[$key] ?? $json[$appId] ?? null;
        if (!is_array($block)) continue;
        if (empty($block["success"])) continue;
        $d = $block["data"] ?? null;
        if (is_array($d) && !empty($d["name"])) return $d;
    }
    return null;
}


function fetchSteamAchievementCount(int $appId): int {
    // Публичный Steam Web API — ключ не нужен
    $url = "https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=" . $appId;
    $json = httpGetJson($url, 20);
    if (!$json) return 0;
    $list = $json['achievementpercentages']['achievements'] ?? null;
    if (!is_array($list)) return 0;
    return count($list);
}

function steamLibraryIconUrl(int $appId): string {
    return 'https://cdn.cloudflare.steamstatic.com/steam/apps/' . $appId . '/library_600x900.jpg';
}

function mapSteamToPreview(array $d, int $appId): array {
    $shots = [];
    foreach (($d['screenshots'] ?? []) as $s) {
        if (!empty($s['path_full'])) $shots[] = $s['path_full'];
        elseif (!empty($s['path_thumbnail'])) $shots[] = $s['path_thumbnail'];
        if (count($shots) >= 12) break;
    }
    $movies = [];
    $toHttps = function ($u) {
        $u = trim((string)$u);
        if ($u === '') return '';
        if (stripos($u, 'http://') === 0) $u = 'https://' . substr($u, 7);
        return $u;
    };
    foreach (($d['movies'] ?? []) as $m) {
        $mp4 = '';
        if (is_array($m['mp4'] ?? null)) {
            $mp4 = $m['mp4']['max'] ?? ($m['mp4']['480'] ?? '');
        }
        $webm = '';
        if (is_array($m['webm'] ?? null)) {
            $webm = $m['webm']['max'] ?? ($m['webm']['480'] ?? '');
        }
        $movies[] = [
            'name' => $m['name'] ?? 'Trailer',
            'thumbnail' => $toHttps($m['thumbnail'] ?? ''),
            'mp4' => $toHttps($mp4),
            'webm' => $toHttps($webm),
        ];
        if (count($movies) >= 5) break;
    }

    $library = 'https://cdn.cloudflare.steamstatic.com/steam/apps/' . $appId . '/library_600x900.jpg';
    $library2 = 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/' . $appId . '/library_600x900.jpg';
    $header = $d['header_image'] ?? '';
    $capsule = $d['capsule_imagev5'] ?? ($d['capsule_image'] ?? '');
    $bg = '';
    if (!empty($d['background'])) $bg = $d['background'];
    if (!empty($d['background_raw'])) $bg = $d['background_raw'];

    // варианты иконки / обложки на выбор
    $icon_options = array_values(array_unique(array_filter([
        $library, $library2, $capsule, $header,
    ])));
    $cover_options = array_values(array_unique(array_filter([
        $capsule, $library, $header,
    ])));
    $banner_options = array_values(array_unique(array_filter([
        $header, $bg, $capsule,
    ])));

    // превью ачивок (быстрый scrape community)
    $achievements = fetchSteamAchievementsPreview($appId, 12);

    $genres = [];
    foreach (($d['genres'] ?? []) as $g) {
        if (!empty($g['description'])) $genres[] = $g['description'];
    }

    return [
        'appid' => $appId,
        'title' => $d['name'] ?? '',
        'short_description' => $d['short_description'] ?? '',
        'description' => $d['detailed_description'] ?? '',
        'developer' => is_array($d['developers'] ?? null) ? implode(', ', $d['developers']) : ($d['developers'] ?? ''),
        'publisher' => is_array($d['publishers'] ?? null) ? implode(', ', $d['publishers']) : '',
        'genre' => implode(', ', $genres),
        'release_date' => $d['release_date']['date'] ?? '',
        'is_free' => !empty($d['is_free']),
        'header_image' => $header,
        'capsule_image' => $capsule,
        'background' => $bg,
        'library_image' => $library,
        'icon_options' => $icon_options,
        'cover_options' => $cover_options,
        'banner_options' => $banner_options,
        'screenshots' => $shots,
        'movies' => $movies,
        'achievements' => $achievements,
        'achievements_total' => count($achievements) ?: null,
    ];
}

function fetchSteamAchievementsPreview(int $appId, int $limit = 20): array {
    $html = null;
    if (function_exists('httpGetJson')) {
        // reuse curl from steam_import via raw get
    }
    $urls = [
        "https://steamcommunity.com/stats/{$appId}/achievements/?l=russian",
        "https://steamcommunity.com/stats/{$appId}/achievements/?l=english",
    ];
    foreach ($urls as $url) {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_TIMEOUT => 18,
                CURLOPT_SSL_VERIFYPEER => false,
                CURLOPT_USERAGENT => 'Mozilla/5.0 CATio/1.0',
                CURLOPT_HTTPHEADER => ['Accept-Language: ru-RU,ru;q=0.9'],
            ]);
            $html = curl_exec($ch);
            curl_close($ch);
        } else {
            $html = @file_get_contents($url);
        }
        if ($html && stripos($html, 'achieveRow') !== false) break;
        $html = null;
    }
    if (!$html) return [];

    $out = [];
    // режем по achieveRow
    $parts = preg_split('/class="[^"]*achieveRow[^"]*"/i', $html);
    array_shift($parts);
    foreach ($parts as $i => $chunk) {
        if ($i >= $limit) break;
        $icon = '';
        $name = '';
        $desc = '';
        $pct = 0.0;
        if (preg_match('/<img[^>]+src="([^"]+)"/i', $chunk, $m)) $icon = html_entity_decode($m[1], ENT_QUOTES, 'UTF-8');
        if (preg_match('/<h3[^>]*>([\s\S]*?)<\/h3>/i', $chunk, $m)) $name = trim(html_entity_decode(strip_tags($m[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if (preg_match('/<h5[^>]*>([\s\S]*?)<\/h5>/i', $chunk, $m)) $desc = trim(html_entity_decode(strip_tags($m[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if (preg_match('/achievePercent[^>]*>([\d.,]+)/i', $chunk, $m)) $pct = (float)str_replace(',', '.', $m[1]);
        if ($name === '' && $icon === '') continue;
        $out[] = [
            'display_name' => $name ?: ('Achievement ' . ($i + 1)),
            'description' => $desc,
            'icon_url' => $icon,
            'percent' => $pct,
        ];
    }
    return $out;
}


function saveRemoteImage(string $url, string $dir, string $prefix): ?string {
    if ($url === '' || !preg_match('~^https?://~i', $url)) return null;
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $ext = 'jpg';
    $path = parse_url($url, PHP_URL_PATH) ?? '';
    if (preg_match('~\.(png|jpe?g|webp|gif)$~i', $path, $m)) {
        $ext = strtolower($m[1] === 'jpeg' ? 'jpg' : $m[1]);
    }
    $name = $prefix . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
    $full = rtrim($dir, '/\\') . DIRECTORY_SEPARATOR . $name;
    if (!httpDownload($url, $full)) return null;
    return 'uploads/games/' . basename($dir) . '/' . $name;
}

try {
    $admin = requireAdminSteam();

    
    if ($action === 'sgdb_assets' && $method === 'GET') {
        $appId = parseSteamAppId($_GET['url'] ?? ($_GET['appid'] ?? ''));
        if (!$appId) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'AppID'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        if (sgdbApiKey() === '') {
            echo json_encode([
                'ok' => false,
                'error' => 'Нет STEAMGRIDDB_API_KEY в config.php (ключ не видит PHP). Проверь require config.php.',
                'need_key' => true,
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $type = strtolower(trim((string)($_GET['type'] ?? 'icons')));
        $list = sgdbAssetsBySteam($appId, $type);
        echo json_encode([
            'ok' => true,
            'appid' => $appId,
            'type' => $type,
            'assets' => $list,
            'count' => count($list),
            'has_key' => true,
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // Обновить ассеты уже существующей игры (иконка/обложка/баннер/лого)
    if ($action === 'update_assets' && $method === 'POST') {
        $admin = requireAdminSteam();
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
        $st = $pdo->prepare("SELECT id, steam_appid, slug FROM games WHERE id = ?");
        $st->execute([$gameId]);
        $game = $st->fetch();
        if (!$game) {
            echo json_encode(['ok' => false, 'error' => 'Игра не найдена'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $base = dirname(__DIR__) . '/uploads/games';
        $coversDir = dirname(__DIR__) . '/covers';
        if (!is_dir($coversDir)) @mkdir($coversDir, 0775, true);
        $iconDir = $base . '/icons';
        $coverDir = $base . '/covers';
        $bannerDir = $base . '/banners';
        $logoDir = $base . '/logos';
        foreach ([$iconDir, $coverDir, $bannerDir, $logoDir] as $d) {
            if (!is_dir($d)) @mkdir($d, 0775, true);
        }
        $fields = [];
        $params = [];
        $iconUrl = trim((string)($body['icon_url'] ?? ''));
        $coverUrl = trim((string)($body['cover_url'] ?? ''));
        $bannerUrl = trim((string)($body['banner_url'] ?? ''));
        $logoUrl = trim((string)($body['logo_url'] ?? ''));
        if ($iconUrl !== '') {
            $local = saveRemoteImage($iconUrl, $iconDir, 'g' . $gameId . '_icon');
            if ($local) {
                $fields[] = 'icon_url = ?';
                $params[] = $local;
                $src = dirname(__DIR__) . '/' . ltrim($local, '/');
                if (is_file($src)) {
                    @copy($src, $coversDir . '/appicon_' . $gameId . '.jpg');
                } else {
                    @httpDownload($iconUrl, $coversDir . '/appicon_' . $gameId . '.jpg');
                }
            }
        }
        if ($coverUrl !== '') {
            $local = saveRemoteImage($coverUrl, $coverDir, 'g' . $gameId . '_cover');
            if ($local) {
                $fields[] = 'cover_url = ?';
                $params[] = $local;
            }
        }
        if ($bannerUrl !== '') {
            $local = saveRemoteImage($bannerUrl, $bannerDir, 'g' . $gameId . '_banner');
            if ($local) {
                $fields[] = 'banner_url = ?';
                $params[] = $local;
            }
        }
        if ($logoUrl !== '') {
            $local = saveRemoteImage($logoUrl, $logoDir, 'g' . $gameId . '_logo');
            if ($local) {
                try {
                    ensureColumn($pdo, 'games', 'logo_url', "VARCHAR(512) NULL");
                } catch (Throwable $e) {}
                $fields[] = 'logo_url = ?';
                $params[] = $local;
            }
        }
        if ($fields) {
            $params[] = $gameId;
            $pdo->prepare("UPDATE games SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);
        }
        echo json_encode(['ok' => true, 'game_id' => $gameId], JSON_UNESCAPED_UNICODE);
        exit;
    }


    if ($action === 'preview' && $method === 'GET') {
        $appId = parseSteamAppId($_GET['url'] ?? ($_GET['appid'] ?? ''));
        if (!$appId) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Укажите ссылку Steam или AppID'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $data = fetchSteamApp($appId);
        if (!$data) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Steam не отдал данные по appid ' . $appId . '. Для 18+ игр нужен доступ к store.steampowered.com (попробуй VPN / проверь allow_url_fopen или curl).'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        echo json_encode(['ok' => true, 'preview' => mapSteamToPreview($data, $appId)], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($action === 'import' && $method === 'POST') {
        $body = json_decode(file_get_contents('php://input'), true);
        if (!is_array($body)) $body = $_POST;
        if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
            http_response_code(403);
            echo json_encode(['ok' => false, 'error' => 'CSRF'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $appId = parseSteamAppId((string)($body['url'] ?? $body['appid'] ?? ''));
        if (!$appId) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Укажите ссылку Steam или AppID'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $publish = !empty($body['publish']);
        $data = fetchSteamApp($appId);
        if (!$data) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Steam не отдал данные по appid ' . $appId], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $p = mapSteamToPreview($data, $appId);

        $base = dirname(__DIR__) . '/uploads/games';
        $coverDir = $base . '/covers';
        $bannerDir = $base . '/banners';
        $shotDir = $base . '/shots';
        foreach ([$coverDir, $bannerDir, $shotDir] as $d) {
            if (!is_dir($d)) @mkdir($d, 0775, true);
        }

        // capsule as cover, header as banner
        $coverSrc = trim((string)($body['cover_url'] ?? '')) ?: ($p['capsule_image'] ?: ($p['library_image'] ?? $p['header_image']));
        $coverUrl = saveRemoteImage($coverSrc, $coverDir, 'steam' . $appId . '_cover');
        $bannerSrc = trim((string)($body['banner_url'] ?? '')) ?: ($p['header_image'] ?: ($p['background'] ?? ''));
        $bannerUrl = saveRemoteImage($bannerSrc, $bannerDir, 'steam' . $appId . '_banner');
        if (!$coverUrl && $bannerUrl) $coverUrl = $bannerUrl;
        if (!$coverUrl) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Не удалось скачать обложку из Steam'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $video = '';
        if (!empty($p['movies'][0]['mp4'])) $video = $p['movies'][0]['mp4'];
        elseif (!empty($p['movies'][0]['webm'])) $video = $p['movies'][0]['webm'];

        $sysMin = json_encode(['notes' => $p['sys_req_min_text']], JSON_UNESCAPED_UNICODE);
        $sysRec = json_encode(['notes' => $p['sys_req_rec_text']], JSON_UNESCAPED_UNICODE);
        $langs = parseSteamLanguages($p['supported_languages'] ?? '');

        $title = $p['title'];
        $slug = slugifySteam($title) . '-s' . $appId;
        // unique slug
        $chk = $pdo->prepare("SELECT id FROM games WHERE slug = ?");
        $chk->execute([$slug]);
        if ($chk->fetch()) $slug .= '-' . substr(uniqid(), -3);

        $status = $publish ? 'published' : 'pending';
        $isPub = $publish ? 1 : 0;
        $price = !empty($p['is_free']) ? 0 : 0;

        $stmt = $pdo->prepare("
            INSERT INTO games
              (title, slug, short_description, description, developer, developer_name, price, genre,
               cover_url, banner_url, video_url, sys_req_min, sys_req_rec, controllers, languages,
               status, is_published, submitted_by, is_adult, category)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'game')
        ");
        $stmt->execute([
            $title,
            $slug,
            mb_substr($p['short_description'], 0, 500),
            $p['description'] !== '' ? $p['description'] : $p['short_description'],
            $p['developer'],
            $p['developer'],
            $price,
            $p['genre'],
            $coverUrl,
            $bannerUrl,
            $video,
            $sysMin,
            $sysRec,
            $p['controllers'],
            $langs,
            $status,
            $isPub,
            (int)$admin['id'],
            0,
        ]);
        $gameId = (int)$pdo->lastInsertId();

        $order = 0;
        foreach (array_slice($p['screenshots'], 0, 10) as $shotUrl) {
            $local = saveRemoteImage($shotUrl, $shotDir, 'steam' . $appId . '_shot' . $order);
            if (!$local) continue;
            try {
                $pdo->prepare("INSERT INTO game_media (game_id, kind, url, sort_order) VALUES (?,?,?,?)")
                    ->execute([$gameId, 'screenshot', $local, $order++]);
            } catch (Throwable $e) {
                try {
                    $pdo->prepare("INSERT INTO game_screenshots (game_id, image_url, sort) VALUES (?,?,?)")
                        ->execute([$gameId, $local, $order - 1]);
                } catch (Throwable $e2) {}
            }
        }

        // Видео-трейлеры в game_media (и дублируем первый в video_url уже записан)
        $vidCount = 0;
        foreach (array_slice($p['movies'], 0, 5) as $mi => $m) {
            $url = $m['mp4'] ?: ($m['webm'] ?? '');
            if ($url === '') continue;
            $thumb = $m['thumbnail'] ?? '';
            $titleVid = $m['name'] ?: ('Трейлер ' . ($mi + 1));
            try {
                $pdo->prepare("INSERT INTO game_media (game_id, kind, url, thumb_url, title, sort_order) VALUES (?,?,?,?,?,?)")
                    ->execute([$gameId, 'video', $url, $thumb ?: null, $titleVid, $mi]);
                $vidCount++;
            } catch (Throwable $e) {
                try {
                    $pdo->prepare("INSERT INTO game_media (game_id, kind, url, sort_order) VALUES (?,?,?,?)")
                        ->execute([$gameId, 'video', $url, $mi]);
                    $vidCount++;
                } catch (Throwable $e2) {}
            }
        }

        // steam_appid + число ачивок (Steam Web API, без ключа)
        $achCount = fetchSteamAchievementCount((int)$appId);
        try {
            $pdo->prepare("UPDATE games SET steam_appid = ?, ach_count = ? WHERE id = ?")
                ->execute([(int)$appId, $achCount, $gameId]);
        } catch (Throwable $e) {}

        // Иконка для сайдбара: library_600x900 (как client icon / обложка приложения)
        $iconDir = $base . '/icons';
        if (!is_dir($iconDir)) @mkdir($iconDir, 0775, true);
        $iconSrc = trim((string)($body['icon_url'] ?? '')) ?: steamLibraryIconUrl((int)$appId);
        $iconUrl = saveRemoteImage($iconSrc, $iconDir, 'steam' . $appId . '_icon');
        if (!$iconUrl) {
            $iconUrl = saveRemoteImage($p['capsule_image'] ?: $p['header_image'], $iconDir, 'steam' . $appId . '_icon');
        }
        if ($iconUrl) {
            try {
                $pdo->prepare("UPDATE games SET icon_url = ? WHERE id = ?")->execute([$iconUrl, $gameId]);
            } catch (Throwable $e) {}
            // копия в covers/icon_{id}.ext для media.php?type=icon
            $coversDir = dirname(__DIR__) . '/covers';
            if (!is_dir($coversDir)) @mkdir($coversDir, 0775, true);
            $src = dirname(__DIR__) . '/' . ltrim($iconUrl, '/');
            if (is_file($src)) {
                $ext = strtolower(pathinfo($src, PATHINFO_EXTENSION)) ?: 'jpg';
                @copy($src, $coversDir . '/appicon_' . $gameId . '.' . $ext);
            }
            // гарантированно library art как appicon
            $libDest = $coversDir . '/appicon_' . $gameId . '.jpg';
            @httpDownload(steamLibraryIconUrl((int)$appId), $libDest);
        }

        // Полный список ачивок + локальные иконки при импорте
        $achSaved = 0;
        try {
            $achList = fetchSteamAchievementsPreview((int)$appId, 500);
            if ($achList) {
                $pdo->exec("CREATE TABLE IF NOT EXISTS game_achievements (
                    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    game_id INT UNSIGNED NOT NULL,
                    api_name VARCHAR(128) NOT NULL,
                    display_name VARCHAR(255) NOT NULL DEFAULT '',
                    description VARCHAR(512) NOT NULL DEFAULT '',
                    icon_url VARCHAR(512) NOT NULL DEFAULT '',
                    icon_gray_url VARCHAR(512) NOT NULL DEFAULT '',
                    percent DECIMAL(6,2) NOT NULL DEFAULT 0,
                    is_hidden TINYINT(1) NOT NULL DEFAULT 0,
                    sort_order INT NOT NULL DEFAULT 0,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_game_api (game_id, api_name),
                    KEY idx_ga_game (game_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
                $pdo->prepare("DELETE FROM game_achievements WHERE game_id = ?")->execute([$gameId]);
                $iconDirA = dirname(__DIR__) . '/uploads/achievements/' . $gameId;
                if (!is_dir($iconDirA)) @mkdir($iconDirA, 0775, true);
                $insA = $pdo->prepare("INSERT INTO game_achievements (game_id, api_name, display_name, description, icon_url, icon_gray_url, percent, is_hidden, sort_order) VALUES (?,?,?,?,?,?,?,?,?)");
                foreach ($achList as $i => $a) {
                    $local = '';
                    if (!empty($a['icon_url'])) {
                        $dest = $iconDirA . '/ach_' . $i . '.jpg';
                        if (httpDownload($a['icon_url'], $dest)) {
                            $local = 'uploads/achievements/' . $gameId . '/ach_' . $i . '.jpg';
                        } else {
                            $local = $a['icon_url'];
                        }
                    }
                    $insA->execute([
                        $gameId,
                        'sc_' . $i,
                        mb_substr($a['display_name'] ?? '', 0, 255),
                        mb_substr($a['description'] ?? '', 0, 512),
                        mb_substr($local, 0, 512),
                        mb_substr($local, 0, 512),
                        (float)($a['percent'] ?? 0),
                        0,
                        $i,
                    ]);
                    $achSaved++;
                }
                $pdo->prepare("UPDATE games SET ach_count = ? WHERE id = ?")->execute([$achSaved, $gameId]);
            }
        } catch (Throwable $e) {}

        echo json_encode([
            'ok' => true,
            'game_id' => $gameId,
            'title' => $title,
            'status' => $status,
            'cover_url' => $coverUrl,
            'banner_url' => $bannerUrl,
            'icon_url' => $iconUrl ?? null,
            'achievements' => $achSaved,
            'screenshots' => $order,
            'videos' => $vidCount,
            'steam_app_id' => $appId,
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Unknown action'], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
}
