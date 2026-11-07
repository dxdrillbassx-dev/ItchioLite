<?php
/**
 * CATio — Steam import + SteamGridDB assets
 * controllers никогда не null
 */
foreach ([__DIR__ . '/../config.php', __DIR__ . '/config.php'] as $_cfg) {
    if (is_file($_cfg)) { require_once $_cfg; break; }
}
require_once __DIR__ . '/../auth.php';

header('Content-Type: application/json; charset=utf-8');

set_exception_handler(function ($e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
    exit;
});

$pdo = getDB();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = trim((string)($_GET['action'] ?? $_POST['action'] ?? ''));

// ---------- helpers ----------

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
    $birth = strtotime('1990-01-01');
    return "birthtime={$birth}; lastagecheckage=1-0-1990; mature_content=1; wants_mature_content=1";
}

function httpGetJson(string $url, int $timeout = 25): ?array {
    $headers = [
        'Accept: application/json',
        'Accept-Language: en-US,en;q=0.9',
        'Cookie: ' . steamCookieHeader(),
    ];
    $raw = null;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 12,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
        ]);
        $raw = curl_exec($ch);
        curl_close($ch);
    } else {
        $hdr = "User-Agent: Mozilla/5.0\r\n";
        foreach ($headers as $h) $hdr .= $h . "\r\n";
        $ctx = stream_context_create([
            'http' => ['timeout' => $timeout, 'header' => $hdr],
            'ssl' => ['verify_peer' => false, 'verify_peer_name' => false],
        ]);
        $raw = @file_get_contents($url, false, $ctx);
    }
    if (!is_string($raw) || $raw === '') return null;
    $data = json_decode($raw, true);
    return is_array($data) ? $data : null;
}

function httpDownload(string $url, string $destPath, int $timeout = 30): bool {
    if (function_exists('curl_init')) {
        $fp = @fopen($destPath, 'wb');
        if (!$fp) return false;
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_FILE => $fp,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; CATioSteamImport/1.0)',
            CURLOPT_SSL_VERIFYPEER => false,
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
    $ctx = stream_context_create([
        'http' => ['timeout' => $timeout, 'header' => "User-Agent: Mozilla/5.0\r\n"],
        'ssl' => ['verify_peer' => false, 'verify_peer_name' => false],
    ]);
    $data = @file_get_contents($url, false, $ctx);
    if ($data === false || strlen($data) < 100) return false;
    return file_put_contents($destPath, $data) !== false;
}

function slugifySteam(string $s): string {
    $s = mb_strtolower(trim($s), 'UTF-8');
    $s = preg_replace('~[^a-z0-9а-яё]+~u', '-', $s) ?: 'game';
    $s = trim($s, '-');
    return $s === '' ? 'game' : substr($s, 0, 80);
}

function stripSteamHtml(string $html): string {
    $html = preg_replace('~<br\s*/?>~i', "\n", $html) ?? $html;
    $html = preg_replace('~</p>~i', "\n\n", $html) ?? $html;
    $html = strip_tags($html);
    $html = html_entity_decode($html, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $html = preg_replace("/[ \t]+/", ' ', $html) ?? $html;
    $html = preg_replace("/\n{3,}/", "\n\n", $html) ?? $html;
    return trim($html);
}

function fetchSteamApp(int $appId): ?array {
    $key = (string)$appId;
    // Сначала русский — CATio на русском; fallback на english
    $attempts = [
        "https://store.steampowered.com/api/appdetails?appids={id}&l=russian&cc=us",
        "https://store.steampowered.com/api/appdetails?appids={id}&l=russian",
        "https://store.steampowered.com/api/appdetails?appids={id}&l=english&cc=us",
        "https://store.steampowered.com/api/appdetails?appids={id}&l=english",
        "https://store.steampowered.com/api/appdetails?appids={id}",
    ];
    foreach ($attempts as $tpl) {
        $json = httpGetJson(str_replace('{id}', $key, $tpl));
        if (!$json) continue;
        $block = $json[$key] ?? $json[$appId] ?? null;
        if (!is_array($block) || empty($block['success'])) continue;
        $d = $block['data'] ?? null;
        if (is_array($d) && !empty($d['name'])) return $d;
    }
    return null;
}

function mapSteamToPreview(array $d, int $appId): array {
    $header  = (string)($d['header_image'] ?? '');
    $capsule = (string)($d['capsule_imagev5'] ?? $d['capsule_image'] ?? '');
    $cdnHeader  = 'https://cdn.cloudflare.steamstatic.com/steam/apps/' . $appId . '/header.jpg';
    $cdnLibrary = 'https://cdn.cloudflare.steamstatic.com/steam/apps/' . $appId . '/library_600x900.jpg';
    $cdnCapsule = 'https://cdn.cloudflare.steamstatic.com/steam/apps/' . $appId . '/capsule_616x353.jpg';

    if ($header === '')  $header  = $cdnHeader;
    if ($capsule === '') $capsule = $cdnCapsule;

    $shots = [];
    foreach ((array)($d['screenshots'] ?? []) as $s) {
        if (!is_array($s)) continue;
        $u = (string)($s['path_full'] ?? $s['path_thumbnail'] ?? '');
        if ($u !== '') $shots[] = $u;
        if (count($shots) >= 8) break;
    }

    $movies = [];
    foreach ((array)($d['movies'] ?? []) as $m) {
        if (!is_array($m)) continue;
        $mp4 = '';
        if (is_array($m['mp4'] ?? null)) {
            $mp4 = (string)($m['mp4']['max'] ?? $m['mp4']['480'] ?? '');
        }
        if ($mp4 === '' && is_array($m['webm'] ?? null)) {
            $mp4 = (string)($m['webm']['max'] ?? $m['webm']['480'] ?? '');
        }
        if (stripos($mp4, 'http://') === 0) $mp4 = 'https://' . substr($mp4, 7);
        if ($mp4 === '') continue;
        $movies[] = [
            'name'      => (string)($m['name'] ?? 'Trailer'),
            'thumbnail' => (string)($m['thumbnail'] ?? ''),
            'mp4'       => $mp4,
        ];
        if (count($movies) >= 3) break;
    }

    $genres = [];
    foreach ((array)($d['genres'] ?? []) as $g) {
        if (is_array($g) && !empty($g['description'])) {
            $genres[] = (string)$g['description'];
        }
    }

    $devs = $d['developers'] ?? [];
    $developer = is_array($devs) ? implode(', ', $devs) : (string)$devs;

    $sysMin = '';
    $sysRec = '';
    $pc = $d['pc_requirements'] ?? null;
    if (is_array($pc)) {
        $sysMin = stripSteamHtml((string)($pc['minimum'] ?? ''));
        $sysRec = stripSteamHtml((string)($pc['recommended'] ?? ''));
    }

    // controllers — всегда string
    $ctrlParts = [];
    foreach ((array)($d['categories'] ?? []) as $c) {
        if (!is_array($c)) continue;
        $desc = mb_strtolower((string)($c['description'] ?? ''));
        if ($desc === '') continue;
        if (str_contains($desc, 'full controller') || str_contains($desc, 'полная поддержка')) {
            $ctrlParts[] = 'full';
        } elseif (str_contains($desc, 'partial controller') || str_contains($desc, 'частичная')) {
            $ctrlParts[] = 'partial';
        } elseif (
            str_contains($desc, 'controller') ||
            str_contains($desc, 'геймпад') ||
            str_contains($desc, 'xbox') ||
            str_contains($desc, 'playstation') ||
            str_contains($desc, 'steam input')
        ) {
            $ctrlParts[] = 'supported';
        }
    }
    $controllers = implode(',', array_unique($ctrlParts));

    $langsRaw = (string)($d['supported_languages'] ?? '');
    $langs = '[]';
    if ($langsRaw !== '') {
        $parts = preg_split('~[,;\n]+~', strip_tags(html_entity_decode($langsRaw, ENT_QUOTES | ENT_HTML5, 'UTF-8'))) ?: [];
        $clean = [];
        foreach ($parts as $p) {
            $p = trim(preg_replace('/\*.*$/', '', $p) ?? $p);
            if ($p !== '' && mb_strlen($p) < 60) $clean[] = $p;
            if (count($clean) >= 20) break;
        }
        $langs = json_encode($clean, JSON_UNESCAPED_UNICODE);
    }

    $release = '';
    if (is_array($d['release_date'] ?? null)) {
        $release = (string)($d['release_date']['date'] ?? '');
    }

    return [
        'appid'               => $appId,
        'title'               => (string)($d['name'] ?? ('Steam ' . $appId)),
        'short_description'   => (string)($d['short_description'] ?? ''),
        'description'         => (string)($d['detailed_description'] ?? ''),
        'developer'           => $developer,
        'developers'          => $developer,
        'publisher'           => is_array($d['publishers'] ?? null) ? implode(', ', $d['publishers']) : (string)($d['publishers'] ?? ''),
        'publishers'          => is_array($d['publishers'] ?? null) ? implode(', ', $d['publishers']) : (string)($d['publishers'] ?? ''),
        'genre'               => implode(', ', $genres),
        'release_date'        => $release,
        'is_free'             => !empty($d['is_free']),
        'header_image'        => $header,
        'capsule_image'       => $capsule,
        'library_image'       => $cdnLibrary,
        'cover_url'           => $capsule ?: $header,
        'banner_url'          => $header,
        'screenshots'         => $shots,
        'movies'              => $movies,
        'sys_req_min_text'    => $sysMin,
        'sys_req_rec_text'    => $sysRec,
        'controllers'         => $controllers,
        'languages'           => $langs,
        'supported_languages' => $langsRaw,
    ];
}

function saveRemoteImage(string $url, string $dir, string $prefix): ?string {
    $url = trim($url);
    if ($url === '' || !preg_match('~^https?://~i', $url)) return null;
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $ext = 'jpg';
    $path = parse_url($url, PHP_URL_PATH) ?? '';
    if (preg_match('~\.(png|jpe?g|webp|gif)$~i', (string)$path, $m)) {
        $ext = strtolower($m[1] === 'jpeg' ? 'jpg' : $m[1]);
    }
    $name = $prefix . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
    $full = rtrim($dir, '/\\') . DIRECTORY_SEPARATOR . $name;
    if (!httpDownload($url, $full)) return null;
    return 'uploads/games/' . basename($dir) . '/' . $name;
}

// ---------- SteamGridDB ----------

function sgdbApiKey(): string {
    if (defined('STEAMGRIDDB_API_KEY') && STEAMGRIDDB_API_KEY) return (string)STEAMGRIDDB_API_KEY;
    if (defined('SGDB_API_KEY') && SGDB_API_KEY) return (string)SGDB_API_KEY;
    $e = getenv('STEAMGRIDDB_API_KEY') ?: getenv('SGDB_API_KEY');
    if ($e) return (string)$e;
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
    $map = [
        'icons' => 'icons', 'icon' => 'icons',
        'grids' => 'grids', 'cover' => 'grids', 'covers' => 'grids',
        'heroes' => 'heroes', 'banner' => 'heroes', 'banners' => 'heroes',
        'logos' => 'logos', 'logo' => 'logos',
    ];
    $endpoint = $map[$kind] ?? $kind;
    $json = sgdbRequest($endpoint . '/steam/' . $steamAppId);
    if (!$json || empty($json['success'])) {
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
            'url'    => $url,
            'thumb'  => $r['thumb'] ?? $url,
            'style'  => (string)($r['style'] ?? ''),
            'score'  => (int)($r['score'] ?? 0),
            'width'  => (int)($r['width'] ?? 0),
            'height' => (int)($r['height'] ?? 0),
        ];
        if (count($out) >= 40) break;
    }
    return $out;
}

// ---------- API ----------

try {
    $admin = requireAdminSteam();

    // ---- SteamGridDB: список ассетов ----
    if ($action === 'sgdb_assets') {
        $appId = parseSteamAppId((string)($_GET['url'] ?? $_GET['appid'] ?? ''));
        if (!$appId) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'AppID'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        if (sgdbApiKey() === '') {
            echo json_encode([
                'ok' => false,
                'error' => 'Нет STEAMGRIDDB_API_KEY в config.php',
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

    // ---- Обновить ассеты уже существующей игры ----
    if ($action === 'update_assets') {
        $body = json_decode((string)file_get_contents('php://input'), true);
        if (!is_array($body)) $body = $_POST;

        if (!function_exists('verifyCsrfToken') || !verifyCsrfToken($body['csrf_token'] ?? '')) {
            http_response_code(403);
            echo json_encode(['ok' => false, 'error' => 'CSRF'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $gameId = (int)($body['game_id'] ?? 0);
        if ($gameId <= 0) {
            echo json_encode(['ok' => false, 'error' => 'game_id'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $st = $pdo->prepare('SELECT id, steam_appid, slug FROM games WHERE id = ?');
        $st->execute([$gameId]);
        $game = $st->fetch();
        if (!$game) {
            echo json_encode(['ok' => false, 'error' => 'Игра не найдена'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $base = dirname(__DIR__) . '/uploads/games';
        $coversDir = dirname(__DIR__) . '/covers';
        if (!is_dir($coversDir)) @mkdir($coversDir, 0775, true);

        $iconDir   = $base . '/icons';
        $coverDir  = $base . '/covers';
        $bannerDir = $base . '/banners';
        $logoDir   = $base . '/logos';
        foreach ([$iconDir, $coverDir, $bannerDir, $logoDir] as $d) {
            if (!is_dir($d)) @mkdir($d, 0775, true);
        }

        $fields = [];
        $params = [];

        $iconUrl   = trim((string)($body['icon_url'] ?? ''));
        $coverUrl  = trim((string)($body['cover_url'] ?? ''));
        $bannerUrl = trim((string)($body['banner_url'] ?? ''));
        $logoUrl   = trim((string)($body['logo_url'] ?? ''));

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
                    if (function_exists('ensureColumn')) {
                        ensureColumn($pdo, 'games', 'logo_url', 'VARCHAR(512) NULL');
                    }
                } catch (Throwable $e) {}
                $fields[] = 'logo_url = ?';
                $params[] = $local;
            }
        }

        if ($fields) {
            $params[] = $gameId;
            $pdo->prepare('UPDATE games SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);
        }

        echo json_encode(['ok' => true, 'game_id' => $gameId], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // ---- preview ----
    if ($action === 'preview' && $method === 'GET') {
        $appId = parseSteamAppId((string)($_GET['url'] ?? $_GET['appid'] ?? ''));
        if (!$appId) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Укажите ссылку Steam или AppID'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $data = fetchSteamApp($appId);
        if (!$data) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Steam не отдал данные по appid ' . $appId], JSON_UNESCAPED_UNICODE);
            exit;
        }
        echo json_encode(['ok' => true, 'preview' => mapSteamToPreview($data, $appId)], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // ---- import ----
    if ($action === 'import' && $method === 'POST') {
        $body = json_decode((string)file_get_contents('php://input'), true);
        if (!is_array($body)) $body = $_POST;

        if (!function_exists('verifyCsrfToken') || !verifyCsrfToken($body['csrf_token'] ?? '')) {
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
        $coverDir  = $base . '/covers';
        $bannerDir = $base . '/banners';
        $shotDir   = $base . '/shots';
        $iconDir   = $base . '/icons';
        foreach ([$coverDir, $bannerDir, $shotDir, $iconDir] as $d) {
            if (!is_dir($d)) @mkdir($d, 0775, true);
        }

        $coverSrc  = trim((string)($body['cover_url']  ?? '')) ?: ($p['capsule_image'] ?: $p['library_image'] ?: $p['header_image']);
        $bannerSrc = trim((string)($body['banner_url'] ?? '')) ?: ($p['header_image'] ?: '');
        $coverUrl  = saveRemoteImage($coverSrc,  $coverDir,  'steam' . $appId . '_cover');
        $bannerUrl = saveRemoteImage($bannerSrc, $bannerDir, 'steam' . $appId . '_banner');
        if (!$coverUrl && $bannerUrl) $coverUrl = $bannerUrl;
        if (!$coverUrl) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Не удалось скачать обложку из Steam'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $video = '';
        if (!empty($p['movies'][0]['mp4'])) $video = $p['movies'][0]['mp4'];

        $sysMin = json_encode(['notes' => $p['sys_req_min_text'] ?? ''], JSON_UNESCAPED_UNICODE);
        $sysRec = json_encode(['notes' => $p['sys_req_rec_text'] ?? ''], JSON_UNESCAPED_UNICODE);
        $langs  = $p['languages'] ?? '[]';
        if ($langs === '' || $langs === null) $langs = '[]';

        $controllers = (string)($p['controllers'] ?? '');

        $title = $p['title'];
        $slug  = slugifySteam($title) . '-s' . $appId;
        $chk = $pdo->prepare('SELECT id FROM games WHERE slug = ?');
        $chk->execute([$slug]);
        if ($chk->fetch()) $slug .= '-' . substr(uniqid(), -3);

        $status = $publish ? 'published' : 'pending';
        $isPub  = $publish ? 1 : 0;
        $price  = 0;

        // INSERT: controllers всегда строка
        $stmt = $pdo->prepare("
            INSERT INTO games
              (title, slug, short_description, description, developer, developer_name, price, genre,
               cover_url, banner_url, video_url, sys_req_min, sys_req_rec, controllers, languages,
               status, is_published, submitted_by, is_adult, category, steam_appid)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ");
        $stmt->execute([
            $title,
            $slug,
            mb_substr((string)$p['short_description'], 0, 500),
            $p['description'] !== '' ? $p['description'] : $p['short_description'],
            $p['developer'],
            $p['developer'],
            $price,
            $p['genre'],
            $coverUrl,
            $bannerUrl ?: null,
            $video ?: null,
            $sysMin,
            $sysRec,
            $controllers,
            $langs,
            $status,
            $isPub,
            (int)$admin['id'],
            0,
            'game',
            (int)$appId,
        ]);
        $gameId = (int)$pdo->lastInsertId();

        // скриншоты
        $order = 0;
        foreach (array_slice($p['screenshots'], 0, 10) as $shotUrl) {
            $local = saveRemoteImage($shotUrl, $shotDir, 'steam' . $appId . '_shot' . $order);
            if (!$local) continue;
            try {
                $pdo->prepare('INSERT INTO game_media (game_id, kind, url, sort_order) VALUES (?,?,?,?)')
                    ->execute([$gameId, 'screenshot', $local, $order]);
            } catch (Throwable $e) {
                try {
                    $pdo->prepare('INSERT INTO game_screenshots (game_id, image_url, sort) VALUES (?,?,?)')
                        ->execute([$gameId, $local, $order]);
                } catch (Throwable $e2) {}
            }
            $order++;
        }

        // трейлеры
        $vidCount = 0;
        foreach (array_slice($p['movies'], 0, 5) as $mi => $m) {
            $url = $m['mp4'] ?? '';
            if ($url === '') continue;
            $thumb = $m['thumbnail'] ?? '';
            $titleVid = $m['name'] ?? ('Трейлер ' . ($mi + 1));
            try {
                $pdo->prepare('INSERT INTO game_media (game_id, kind, url, thumb_url, title, sort_order) VALUES (?,?,?,?,?,?)')
                    ->execute([$gameId, 'video', $url, $thumb ?: null, $titleVid, $mi]);
                $vidCount++;
            } catch (Throwable $e) {
                try {
                    $pdo->prepare('INSERT INTO game_media (game_id, kind, url, sort_order) VALUES (?,?,?,?)')
                        ->execute([$gameId, 'video', $url, $mi]);
                    $vidCount++;
                } catch (Throwable $e2) {}
            }
        }

        // иконка (можно переопределить с фронта / SGDB)
        $iconSrc = trim((string)($body['icon_url'] ?? ''))
            ?: ('https://cdn.cloudflare.steamstatic.com/steam/apps/' . $appId . '/library_600x900.jpg');
        $iconUrl = saveRemoteImage($iconSrc, $iconDir, 'steam' . $appId . '_icon');
        if (!$iconUrl) {
            $iconUrl = saveRemoteImage($p['capsule_image'] ?: $p['header_image'], $iconDir, 'steam' . $appId . '_icon');
        }
        if ($iconUrl) {
            try {
                $pdo->prepare('UPDATE games SET icon_url = ? WHERE id = ?')->execute([$iconUrl, $gameId]);
            } catch (Throwable $e) {}
            $coversDir = dirname(__DIR__) . '/covers';
            if (!is_dir($coversDir)) @mkdir($coversDir, 0775, true);
            $src = dirname(__DIR__) . '/' . ltrim($iconUrl, '/');
            if (is_file($src)) {
                $ext = strtolower(pathinfo($src, PATHINFO_EXTENSION)) ?: 'jpg';
                @copy($src, $coversDir . '/appicon_' . $gameId . '.' . $ext);
            }
        }

        // если при импорте сразу передали SGDB cover/banner/logo
        $extraFields = [];
        $extraParams = [];
        foreach (['cover_url' => $coverDir, 'banner_url' => $bannerDir, 'logo_url' => $base . '/logos'] as $col => $dir) {
            $srcUrl = trim((string)($body[$col] ?? ''));
            if ($srcUrl === '' || $srcUrl === $coverSrc || $srcUrl === $bannerSrc) continue;
            if ($col === 'logo_url' && !is_dir($dir)) @mkdir($dir, 0775, true);
            $local = saveRemoteImage($srcUrl, $dir, 'steam' . $appId . '_' . str_replace('_url', '', $col));
            if ($local) {
                $extraFields[] = "`$col` = ?";
                $extraParams[] = $local;
            }
        }
        if ($extraFields) {
            $extraParams[] = $gameId;
            try {
                $pdo->prepare('UPDATE games SET ' . implode(', ', $extraFields) . ' WHERE id = ?')->execute($extraParams);
            } catch (Throwable $e) {}
        }

        echo json_encode([
            'ok'           => true,
            'game_id'      => $gameId,
            'title'        => $title,
            'status'       => $status,
            'cover_url'    => $coverUrl,
            'banner_url'   => $bannerUrl,
            'icon_url'     => $iconUrl ?? null,
            'screenshots'  => $order,
            'videos'       => $vidCount,
            'steam_app_id' => $appId,
            'controllers'  => $controllers,
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    http_response_code(400);
    echo json_encode([
        'ok'        => false,
        'error'     => 'Unknown action: ' . $action,
        'method'    => $method,
        'available' => ['preview', 'import', 'sgdb_assets', 'update_assets'],
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
}
