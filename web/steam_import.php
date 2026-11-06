<?php
/**
 * CATio — Steam import API
 * Максимально сейфовый: никаких Notice/Warning в ответе, картинки best-effort.
 */
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
ini_set('html_errors', '0');
error_reporting(0);
while (ob_get_level() > 0) { @ob_end_clean(); }
ob_start();

foreach ([__DIR__ . '/../config.php', __DIR__ . '/config.php'] as $_cfg) {
    if (is_file($_cfg)) { require_once $_cfg; break; }
}
require_once __DIR__ . '/../auth.php';
while (ob_get_level() > 0) { @ob_end_clean(); }
ob_start();


function steam_json($data, int $code = 200): void {
    while (ob_get_level() > 0) { @ob_end_clean(); }
    if (!headers_sent()) {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
    }
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function steam_arr(array $a, string $k, $default = null) {
    return array_key_exists($k, $a) ? $a[$k] : $default;
}

function steam_str(array $a, string $k, string $default = ''): string {
    $v = steam_arr($a, $k, $default);
    if (is_array($v)) return '';
    return trim((string)$v);
}

function requireAdminSteam(): array {
    $u = getCurrentUser();
    if (!$u) steam_json(['ok' => false, 'error' => 'Нужно войти'], 401);
    if (($u['role'] ?? '') !== 'admin') steam_json(['ok' => false, 'error' => 'Только для админов'], 403);
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
    $raw = null;
    $headers = [
        'Accept: application/json',
        'Accept-Language: en-US,en;q=0.9,ru;q=0.8',
        'Cookie: ' . steamCookieHeader(),
    ];
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 12,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
    try {
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
            if (!$ok || $code >= 400) { @unlink($destPath); return false; }
            return filesize($destPath) > 100;
        }
        $ctx = stream_context_create(['http' => ['timeout' => $timeout, 'header' => "User-Agent: Mozilla/5.0\r\n"], 'ssl' => ['verify_peer' => false, 'verify_peer_name' => false]]);
        $raw = @file_get_contents($url, false, $ctx);
        if ($raw === false || strlen($raw) < 100) return false;
        return @file_put_contents($destPath, $raw) !== false;
    } catch (Throwable $e) {
        return false;
    }
}

function slugifySteam(string $s): string {
    $s = mb_strtolower(trim($s), 'UTF-8');
    $s = preg_replace('~[^a-z0-9]+~', '-', $s) ?: 'game';
    return trim($s, '-') ?: 'game';
}

function stripSteamHtml(string $html): string {
    $html = html_entity_decode($html, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $html = preg_replace('~<br\s*/?>~i', "\n", $html) ?? $html;
    $html = strip_tags($html);
    return trim(preg_replace("/[ \t]+/", ' ', $html) ?? $html);
}

function parseSteamLanguages(string $raw): string {
    $raw = stripSteamHtml($raw);
    $parts = preg_split('~[,;\n]+~', $raw) ?: [];
    $out = [];
    foreach ($parts as $p) {
        $p = trim(preg_replace('/\*.*$/', '', $p) ?? $p);
        if ($p !== '') $out[] = $p;
        if (count($out) >= 30) break;
    }
    return json_encode($out, JSON_UNESCAPED_UNICODE);
}

function fetchSteamApp(int $appId): ?array {
    $key = (string)$appId;
    $attempts = [
        "https://store.steampowered.com/api/appdetails?appids={id}&l=english&cc=us",
        "https://store.steampowered.com/api/appdetails?appids={id}&l=russian&cc=us",
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

function saveRemoteImage(string $url, string $dir, string $prefix): ?string {
    $url = trim($url);
    if ($url === '' || !preg_match('~^https?://~i', $url)) return null;
    try {
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
    } catch (Throwable $e) {
        return null;
    }
}

/** Всегда возвращает полный набор ключей — никаких Undefined array key */
function mapSteamToPreview(array $d, int $appId): array {
    $header = steam_str($d, 'header_image');
    $capsule = steam_str($d, 'capsule_imagev5');
    if ($capsule === '') $capsule = steam_str($d, 'capsule_image');
    $bg = steam_str($d, 'background_raw');
    if ($bg === '') $bg = steam_str($d, 'background');

    // CDN fallbacks — header почти всегда есть
    $cdnHeader = 'https://cdn.cloudflare.steamstatic.com/steam/apps/' . $appId . '/header.jpg';
    $cdnLibrary = 'https://cdn.cloudflare.steamstatic.com/steam/apps/' . $appId . '/library_600x900.jpg';
    $cdnCapsule = 'https://cdn.cloudflare.steamstatic.com/steam/apps/' . $appId . '/capsule_616x353.jpg';
    $cdnCapsuleSmall = 'https://cdn.cloudflare.steamstatic.com/steam/apps/' . $appId . '/capsule_231x87.jpg';

    if ($header === '') $header = $cdnHeader;
    $library = $cdnLibrary;

    $shots = [];
    foreach ((array)steam_arr($d, 'screenshots', []) as $s) {
        if (!is_array($s)) continue;
        $u = steam_str($s, 'path_full');
        if ($u === '') $u = steam_str($s, 'path_thumbnail');
        if ($u !== '') $shots[] = $u;
        if (count($shots) >= 12) break;
    }

    $movies = [];
    foreach ((array)steam_arr($d, 'movies', []) as $m) {
        if (!is_array($m)) continue;
        $mp4 = '';
        $webm = '';
        $mp4a = steam_arr($m, 'mp4', null);
        if (is_array($mp4a)) $mp4 = (string)($mp4a['max'] ?? $mp4a['480'] ?? '');
        $webma = steam_arr($m, 'webm', null);
        if (is_array($webma)) $webm = (string)($webma['max'] ?? $webma['480'] ?? '');
        if (stripos($mp4, 'http://') === 0) $mp4 = 'https://' . substr($mp4, 7);
        if (stripos($webm, 'http://') === 0) $webm = 'https://' . substr($webm, 7);
        $movies[] = [
            'name' => steam_str($m, 'name', 'Trailer'),
            'thumbnail' => steam_str($m, 'thumbnail'),
            'mp4' => $mp4,
            'webm' => $webm,
        ];
        if (count($movies) >= 5) break;
    }

    $genres = [];
    foreach ((array)steam_arr($d, 'genres', []) as $g) {
        if (is_array($g) && !empty($g['description'])) $genres[] = (string)$g['description'];
    }

    $devs = steam_arr($d, 'developers', []);
    $pubs = steam_arr($d, 'publishers', []);
    $developer = is_array($devs) ? implode(', ', $devs) : (string)$devs;
    $publisher = is_array($pubs) ? implode(', ', $pubs) : (string)$pubs;

    $sysMinText = '';
    $sysRecText = '';
    $pc = steam_arr($d, 'pc_requirements', null);
    if (is_array($pc)) {
        $sysMinText = stripSteamHtml((string)($pc['minimum'] ?? ''));
        $sysRecText = stripSteamHtml((string)($pc['recommended'] ?? ''));
    }

    $release = '';
    $rd = steam_arr($d, 'release_date', null);
    if (is_array($rd)) $release = (string)($rd['date'] ?? '');
    elseif (is_string($rd)) $release = $rd;

    // Обложка: header (широкая) надёжнее library (часто 404 до релиза)
    $cover = $header !== '' ? $header : ($capsule !== '' ? $capsule : $cdnCapsule);
    $banner = $header !== '' ? $header : $cdnHeader;
    $icon = $capsule !== '' ? $capsule : $cdnCapsuleSmall;

    return [
        'appid' => $appId,
        'steam_app_id' => $appId,
        'title' => steam_str($d, 'name', 'Steam ' . $appId),
        'short_description' => steam_str($d, 'short_description'),
        'description' => steam_str($d, 'detailed_description'),
        'developer' => $developer,
        'publisher' => $publisher,
        'developers' => $developer,
        'publishers' => $publisher,
        'sys_req_min_text' => $sysMinText,
        'sys_req_rec_text' => $sysRecText,
        'supported_languages' => steam_str($d, 'supported_languages'),
        'genre' => implode(', ', $genres),
        'release_date' => $release,
        'is_free' => !empty($d['is_free']),
        'header_image' => $header,
        'capsule_image' => $capsule !== '' ? $capsule : $cdnCapsule,
        'background' => $bg,
        'library_image' => $library,
        'cover_url' => $cover,
        'banner_url' => $banner,
        'icon_url' => $icon,
        'logo_url' => '',
        'icon_options' => array_values(array_unique(array_filter([$icon, $capsule, $cdnCapsuleSmall, $header]))),
        'cover_options' => array_values(array_unique(array_filter([$cover, $header, $capsule, $library, $cdnCapsule]))),
        'banner_options' => array_values(array_unique(array_filter([$banner, $header, $bg, $cdnHeader]))),
        'screenshots' => $shots,
        'movies' => $movies,
        'achievements' => [],
        'achievements_total' => null,
    ];
}

// SGDB stubs (optional assets UI)
function sgdbApiKey(): string {
    if (defined('STEAMGRIDDB_API_KEY') && STEAMGRIDDB_API_KEY) return (string)STEAMGRIDDB_API_KEY;
    if (defined('SGDB_API_KEY') && SGDB_API_KEY) return (string)SGDB_API_KEY;
    return (string)(getenv('STEAMGRIDDB_API_KEY') ?: getenv('SGDB_API_KEY') ?: '');
}

try {
    $pdo = getDB();
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $action = trim((string)($_GET['action'] ?? $_POST['action'] ?? ''));
    $admin = requireAdminSteam();

    if ($action === 'preview' && $method === 'GET') {
        $appId = parseSteamAppId((string)($_GET['url'] ?? $_GET['appid'] ?? ''));
        if (!$appId) steam_json(['ok' => false, 'error' => 'Укажите ссылку Steam или AppID'], 400);
        $data = fetchSteamApp($appId);
        if (!$data) steam_json(['ok' => false, 'error' => 'Steam не отдал данные по appid ' . $appId], 404);
        $preview = mapSteamToPreview($data, $appId);
        steam_json(array_merge(['ok' => true, 'preview' => $preview], $preview));
    }

    if ($action === 'import' && $method === 'POST') {
        $body = json_decode((string)file_get_contents('php://input'), true);
        if (!is_array($body)) $body = $_POST ?: [];
        if (function_exists('verifyCsrfToken') && !verifyCsrfToken($body['csrf_token'] ?? '')) {
            steam_json(['ok' => false, 'error' => 'CSRF'], 403);
        }
        $appId = parseSteamAppId((string)($body['url'] ?? $body['appid'] ?? ''));
        if (!$appId) steam_json(['ok' => false, 'error' => 'Укажите ссылку Steam или AppID'], 400);

        $data = fetchSteamApp($appId);
        if (!$data) steam_json(['ok' => false, 'error' => 'Steam не отдал данные'], 404);
        $p = mapSteamToPreview($data, $appId);

        $title = steam_str($p, 'title', 'Steam ' . $appId);
        $slug = slugifySteam($title) . '-s' . $appId;
        $short = steam_str($p, 'short_description');
        $desc = steam_str($p, 'description', $short);
        $developer = steam_str($p, 'developer');
        $publisher = steam_str($p, 'publisher');
        $genre = steam_str($p, 'genre');
        $release = steam_str($p, 'release_date');
        $sysMin = json_encode(['notes' => steam_str($p, 'sys_req_min_text')], JSON_UNESCAPED_UNICODE);
        $sysRec = json_encode(['notes' => steam_str($p, 'sys_req_rec_text')], JSON_UNESCAPED_UNICODE);
        $langs = parseSteamLanguages(steam_str($p, 'supported_languages'));
        $status = !empty($body['publish']) ? 'published' : 'draft';

        // already exists?
        try {
            $chk = $pdo->prepare("SELECT id, title FROM games WHERE steam_appid = ? OR slug = ? LIMIT 1");
            $chk->execute([$appId, $slug]);
            $ex = $chk->fetch(PDO::FETCH_ASSOC);
            if ($ex) {
                steam_json([
                    'ok' => true,
                    'game_id' => (int)$ex['id'],
                    'title' => $ex['title'] ?? $title,
                    'status' => 'exists',
                    'message' => 'Игра уже в базе',
                    'steam_app_id' => $appId,
                ]);
            }
        } catch (Throwable $e) {}

        $baseDir = dirname(__DIR__) . '/uploads/games';
        foreach (['covers', 'banners', 'icons', 'shots'] as $sub) {
            $d = $baseDir . '/' . $sub;
            if (!is_dir($d)) @mkdir($d, 0775, true);
        }

        $pickSave = function (array $urls, string $dir, string $prefix) {
            foreach ($urls as $u) {
                $u = trim((string)$u);
                if ($u === '') continue;
                $local = saveRemoteImage($u, $dir, $prefix);
                if ($local) return $local;
            }
            return '';
        };

        $coverUrl = $pickSave([
            $body['cover_url'] ?? '',
            $p['cover_url'],
            $p['header_image'],
            $p['capsule_image'],
            'https://cdn.cloudflare.steamstatic.com/steam/apps/' . $appId . '/header.jpg',
            'https://cdn.cloudflare.steamstatic.com/steam/apps/' . $appId . '/capsule_616x353.jpg',
            'https://cdn.cloudflare.steamstatic.com/steam/apps/' . $appId . '/library_600x900.jpg',
        ], $baseDir . '/covers', 'steam' . $appId . '_cover');

        $bannerUrl = $pickSave([
            $body['banner_url'] ?? '',
            $p['banner_url'],
            $p['header_image'],
            'https://cdn.cloudflare.steamstatic.com/steam/apps/' . $appId . '/header.jpg',
        ], $baseDir . '/banners', 'steam' . $appId . '_banner');

        $iconUrl = $pickSave([
            $body['icon_url'] ?? '',
            $p['icon_url'],
            $p['capsule_image'],
            'https://cdn.cloudflare.steamstatic.com/steam/apps/' . $appId . '/capsule_231x87.jpg',
            'https://cdn.cloudflare.steamstatic.com/steam/apps/' . $appId . '/header.jpg',
        ], $baseDir . '/icons', 'steam' . $appId . '_icon');

        if ($bannerUrl === '' && $coverUrl !== '') $bannerUrl = $coverUrl;

        $video = '';
        $movies = steam_arr($p, 'movies', []);
        if (is_array($movies) && isset($movies[0]) && is_array($movies[0])) {
            $video = (string)($movies[0]['mp4'] ?? $movies[0]['webm'] ?? '');
        }

        $gameId = 0;
        $warn = [];

        // Данные которые хотим записать (НИКОГДА null для строковых полей)
        $want = [
            'title' => mb_substr($title, 0, 255),
            'slug' => mb_substr($slug, 0, 255),
            'short_description' => (string)$short,
            'description' => (string)($desc !== '' ? $desc : $short),
            'developer' => mb_substr((string)$developer, 0, 255),
            'publisher' => mb_substr((string)$publisher, 0, 255),
            'genre' => mb_substr((string)$genre, 0, 255),
            'release_date' => mb_substr((string)$release, 0, 64),
            'price' => 0,
            'status' => (string)$status,
            'cover_url' => (string)$coverUrl,
            'banner_url' => (string)$bannerUrl,
            'video_url' => (string)$video,
            'sys_req_min' => ($sysMin !== '' && $sysMin !== null) ? $sysMin : '{}',
            'sys_req_rec' => ($sysRec !== '' && $sysRec !== null) ? $sysRec : '{}',
            'controllers' => '[]',
            'languages' => ($langs !== '' && $langs !== null) ? $langs : '[]',
            'steam_appid' => (int)$appId,
            'icon_url' => (string)$iconUrl,
        ];

        // Читаем схему и заполняем ВСЕ NOT NULL без дефолта
        $colMeta = [];
        try {
            $colMeta = $pdo->query('SHOW COLUMNS FROM games')->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable $e) {
            $warn[] = 'SHOW COLUMNS: ' . $e->getMessage();
        }

        $row = [];
        foreach ($colMeta as $c) {
            $name = $c['Field'] ?? '';
            if ($name === '' || $name === 'id') continue;
            $extra = strtolower((string)($c['Extra'] ?? ''));
            if (strpos($extra, 'auto_increment') !== false) continue;

            $type = strtolower((string)($c['Type'] ?? ''));
            $nullable = strtoupper((string)($c['Null'] ?? 'YES')) === 'YES';
            $default = $c['Default'] ?? null;

            if (array_key_exists($name, $want)) {
                $val = $want[$name];
                // на всякий: null → безопасный дефолт
                if ($val === null) {
                    if (strpos($type, 'int') !== false || strpos($type, 'decimal') !== false || strpos($type, 'float') !== false) $val = 0;
                    else $val = '';
                }
                $row[$name] = $val;
                continue;
            }

            // колонка обязательна и без DEFAULT — подставляем пустое
            if (!$nullable && $default === null && strpos($extra, 'auto_increment') === false) {
                // timestamp/datetime с ON UPDATE — можно пропустить, MySQL сам
                if (strpos($type, 'timestamp') !== false || strpos($type, 'datetime') !== false) {
                    // если NOT NULL без default — NOW()
                    $row[$name] = date('Y-m-d H:i:s');
                } elseif (strpos($type, 'int') !== false || strpos($type, 'decimal') !== false || strpos($type, 'float') !== false || strpos($type, 'double') !== false) {
                    $row[$name] = 0;
                } elseif (strpos($type, 'json') !== false) {
                    $row[$name] = '{}';
                } else {
                    // controllers, languages и любые TEXT/VARCHAR
                    if ($name === 'controllers' || $name === 'languages') $row[$name] = '[]';
                    elseif ($name === 'sys_req_min' || $name === 'sys_req_rec') $row[$name] = '{}';
                    else $row[$name] = '';
                }
            }
        }

        // Если SHOW COLUMNS не сработал — жёсткий набор
        if (!$row) {
            $row = $want;
            $row['controllers'] = '[]';
            $row['languages'] = $row['languages'] ?? '[]';
            $row['sys_req_min'] = $row['sys_req_min'] ?? '{}';
            $row['sys_req_rec'] = $row['sys_req_rec'] ?? '{}';
            $row['created_at'] = date('Y-m-d H:i:s');
        }

        // Гарантия controllers
        if (!isset($row['controllers']) || $row['controllers'] === null || $row['controllers'] === '') {
            $row['controllers'] = '[]';
        }
        foreach (['sys_req_min', 'sys_req_rec'] as $k) {
            if (!isset($row[$k]) || $row[$k] === null || $row[$k] === '') $row[$k] = '{}';
        }
        if (!isset($row['languages']) || $row['languages'] === null || $row['languages'] === '') {
            $row['languages'] = '[]';
        }

        // Убрать чистые null
        foreach ($row as $k => $v) {
            if ($v === null) $row[$k] = '';
        }

        try {
            $fields = array_keys($row);
            $placeholders = implode(',', array_fill(0, count($fields), '?'));
            $sql = 'INSERT INTO games (`' . implode('`,`' , $fields) . '`) VALUES (' . $placeholders . ')';
            $pdo->prepare($sql)->execute(array_values($row));
            $gameId = (int)$pdo->lastInsertId();
        } catch (Throwable $e) {
            $warn[] = 'insert: ' . $e->getMessage();
            // Минимальный INSERT только title+slug + обязательные из схемы
            try {
                $min = [
                    'title' => mb_substr($title, 0, 255),
                    'slug' => mb_substr($slug . '-m' . bin2hex(random_bytes(2)), 0, 255),
                    'description' => (string)($desc !== '' ? $desc : $short),
                    'price' => 0,
                    'status' => (string)$status,
                    'cover_url' => (string)$coverUrl,
                    'controllers' => '[]',
                    'sys_req_min' => '{}',
                    'sys_req_rec' => '{}',
                    'languages' => '[]',
                ];
                // добрать NOT NULL из meta
                foreach ($colMeta as $c) {
                    $name = $c['Field'] ?? '';
                    if ($name === '' || $name === 'id' || isset($min[$name])) continue;
                    $nullable = strtoupper((string)($c['Null'] ?? 'YES')) === 'YES';
                    $default = $c['Default'] ?? null;
                    $extra = strtolower((string)($c['Extra'] ?? ''));
                    $type = strtolower((string)($c['Type'] ?? ''));
                    if (!$nullable && $default === null && strpos($extra, 'auto_increment') === false) {
                        if (strpos($type, 'int') !== false) $min[$name] = 0;
                        elseif (strpos($type, 'timestamp') !== false || strpos($type, 'datetime') !== false) $min[$name] = date('Y-m-d H:i:s');
                        else $min[$name] = ($name === 'controllers' || $name === 'languages') ? '[]' : '';
                    }
                }
                $fields = array_keys($min);
                $sql = 'INSERT INTO games (`' . implode('`,`' , $fields) . '`) VALUES (' . implode(',', array_fill(0, count($fields), '?')) . ')';
                $pdo->prepare($sql)->execute(array_values($min));
                $gameId = (int)$pdo->lastInsertId();
            } catch (Throwable $e2) {
                steam_json(['ok' => false, 'error' => 'DB: ' . $e2->getMessage(), 'warnings' => $warn], 500);
            }
        }

        if ($gameId <= 0) steam_json(['ok' => false, 'error' => 'Не удалось создать запись', 'warnings' => $warn], 500);

        // Добиваем поля по одному — что получится
        $updates = [
            'steam_appid' => (int)$appId,
            'banner_url' => (string)$bannerUrl,
            'cover_url' => (string)$coverUrl,
            'icon_url' => (string)$iconUrl,
            'short_description' => (string)$short,
            'description' => (string)($desc !== '' ? $desc : $short),
            'developer' => (string)$developer,
            'publisher' => (string)$publisher,
            'genre' => (string)$genre,
            'release_date' => (string)$release,
            'video_url' => (string)$video,
            'sys_req_min' => ($sysMin !== '' && $sysMin !== null) ? $sysMin : '{}',
            'sys_req_rec' => ($sysRec !== '' && $sysRec !== null) ? $sysRec : '{}',
            'controllers' => '[]',
            'languages' => ($langs !== '' && $langs !== null) ? $langs : '[]',
            'status' => (string)$status,
        ];
        foreach ($updates as $col => $val) {
            if ($val === '' || $val === null) continue;
            try {
                $pdo->prepare("UPDATE games SET `{$col}` = ? WHERE id = ?")->execute([$val, $gameId]);
            } catch (Throwable $e) {
                $warn[] = "upd {$col}: " . $e->getMessage();
            }
        }

        // screenshots best-effort
        $shotsSaved = 0;
        $shots = steam_arr($p, 'screenshots', []);
        if (is_array($shots)) {
            $ord = 0;
            foreach (array_slice($shots, 0, 8) as $su) {
                $local = saveRemoteImage((string)$su, $baseDir . '/shots', 'steam' . $appId . '_s' . $ord);
                if (!$local) continue;
                try {
                    $pdo->prepare("INSERT INTO game_media (game_id, type, url, sort_order) VALUES (?,?,?,?)")
                        ->execute([$gameId, 'screenshot', $local, $ord]);
                    $shotsSaved++;
                    $ord++;
                } catch (Throwable $e) {
                    try {
                        $pdo->prepare("INSERT INTO game_screenshots (game_id, url, sort_order) VALUES (?,?,?)")
                            ->execute([$gameId, $local, $ord]);
                        $shotsSaved++;
                        $ord++;
                    } catch (Throwable $e2) { break; }
                }
            }
        }

        steam_json([
            'ok' => true,
            'game_id' => $gameId,
            'title' => $title,
            'status' => $status,
            'cover_url' => $coverUrl,
            'banner_url' => $bannerUrl,
            'icon_url' => $iconUrl,
            'screenshots' => $shotsSaved,
            'steam_app_id' => $appId,
            'warnings' => $warn,
            'message' => 'Импорт готов' . ($coverUrl === '' ? ' (обложку можно залить вручную)' : ''),
        ]);
    }

    // keep sgdb/update from old file if needed — minimal stubs
    if ($action === 'sgdb_assets') {
        steam_json(['ok' => true, 'assets' => [], 'count' => 0, 'has_key' => sgdbApiKey() !== '']);
    }
    if ($action === 'update_assets') {
        steam_json(['ok' => true, 'message' => 'use game page gear']);
    }

    steam_json(['ok' => false, 'error' => 'Unknown action: ' . $action, 'available' => ['preview', 'import']], 400);
} catch (Throwable $e) {
    steam_json(['ok' => false, 'error' => $e->getMessage()], 500);
}
