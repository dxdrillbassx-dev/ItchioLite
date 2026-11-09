<?php
/**
 * CLI: экспорт игры из Steam в ZIP-пакет CATio (как game_pack export).
 * Usage:
 *   php steam_export_cli.php --app "https://store.steampowered.com/app/2406770" [--out DIR] [--site DIR]
 *   php steam_export_cli.php --app 2406770
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "Only CLI\n");
    exit(1);
}

function say(string $msg): void {
    echo $msg . PHP_EOL;
}
function fail(string $msg, int $code = 1): void {
    fwrite(STDERR, "ERROR: $msg\n");
    exit($code);
}

// ---- args ----
$opts = getopt('', ['app:', 'out:', 'site:', 'help']);
if (isset($opts['help']) || empty($opts['app'])) {
    say("Usage: php steam_export_cli.php --app <steam_url|appid> [--out DIR] [--site DIR]");
    exit(empty($opts['app']) ? 1 : 0);
}

$appRaw = trim((string)$opts['app']);
$siteDir = isset($opts['site']) ? rtrim((string)$opts['site'], "\\/") : '';
$outDir  = isset($opts['out']) ? rtrim((string)$opts['out'], "\\/") : '';

// Resolve appid
$appId = 0;
if (preg_match('/(?:store\.steampowered\.com\/app\/|\/app\/)(\d{3,10})/i', $appRaw, $m)) {
    $appId = (int)$m[1];
} elseif (preg_match('/^(\d{3,10})$/', $appRaw, $m)) {
    $appId = (int)$m[1];
}
if ($appId <= 0) fail("Не удалось распознать Steam AppID из: $appRaw");

// Optional: load site config for SGDB key
if ($siteDir !== '') {
    $cfg = $siteDir . DIRECTORY_SEPARATOR . 'config.php';
    if (is_file($cfg)) {
        // config may assume web context — suppress and ignore fatals where possible
        try { @require_once $cfg; } catch (Throwable $e) {}
    }
    // also .env style
    $env = $siteDir . DIRECTORY_SEPARATOR . '.env';
    if (is_file($env)) {
        foreach (file($env, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) continue;
            [$k, $v] = array_map('trim', explode('=', $line, 2));
            $v = trim($v, " \t\"'");
            if ($k !== '' && getenv($k) === false) putenv("$k=$v");
            if ($k === 'STEAMGRIDDB_API_KEY' && !defined('STEAMGRIDDB_API_KEY')) {
                define('STEAMGRIDDB_API_KEY', $v);
            }
        }
    }
}

if ($outDir === '') {
    $outDir = ($siteDir !== '' ? $siteDir . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'game_packs' . DIRECTORY_SEPARATOR . '_cli_export' : getcwd());
}
if (!is_dir($outDir)) {
    if (!@mkdir($outDir, 0775, true) && !is_dir($outDir)) fail("Не удалось создать папку вывода: $outDir");
}

// ---- HTTP helpers ----
function httpGet(string $url, array $headers = [], int $timeout = 30): ?string {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 12,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_USERAGENT => 'CATio-SteamExportCLI/1.0',
        ]);
        $body = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($body === false || $code >= 400) return null;
        return $body;
    }
    $hdr = '';
    foreach ($headers as $h) $hdr .= $h . "\r\n";
    $ctx = stream_context_create(['http' => [
        'timeout' => $timeout,
        'header' => $hdr . "User-Agent: CATio-SteamExportCLI/1.0\r\n",
    ], 'ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
    $body = @file_get_contents($url, false, $ctx);
    return $body === false ? null : $body;
}

function downloadFile(string $url, string $dest): bool {
    $bin = httpGet($url, [], 45);
    if ($bin === null || $bin === '') return false;
    $dir = dirname($dest);
    if (!is_dir($dir)) mkdir($dir, 0775, true);
    return file_put_contents($dest, $bin) !== false;
}

function extFromUrl(string $url, string $fb = 'bin'): string {
    $path = parse_url($url, PHP_URL_PATH) ?: '';
    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    if ($ext === '' || strlen($ext) > 5) return $fb;
    return preg_replace('/[^a-z0-9]/i', '', $ext) ?: $fb;
}

function sgdbKey(): string {
    if (defined('STEAMGRIDDB_API_KEY') && STEAMGRIDDB_API_KEY) return (string)STEAMGRIDDB_API_KEY;
    $g = getenv('STEAMGRIDDB_API_KEY');
    return $g ? (string)$g : '';
}

function sgdbRequest(string $path): ?array {
    $key = sgdbKey();
    if ($key === '') return null;
    $url = 'https://www.steamgriddb.com/api/v2/' . ltrim($path, '/');
    $raw = httpGet($url, ['Authorization: Bearer ' . $key, 'Accept: application/json']);
    if ($raw === null) return null;
    $j = json_decode($raw, true);
    return is_array($j) ? $j : null;
}

function steamMovieUrl(array $m): string {
    if (is_array($m['mp4'] ?? null)) {
        $u = (string)($m['mp4']['max'] ?? $m['mp4']['480'] ?? '');
        if ($u !== '') return (stripos($u, 'http://') === 0) ? ('https://' . substr($u, 7)) : $u;
    }
    if (is_array($m['webm'] ?? null)) {
        $u = (string)($m['webm']['max'] ?? $m['webm']['480'] ?? '');
        if ($u !== '') return (stripos($u, 'http://') === 0) ? ('https://' . substr($u, 7)) : $u;
    }
    foreach (['hls_h264', 'dash_h264', 'dash_av1'] as $k) {
        $u = $m[$k] ?? null;
        if (is_array($u)) $u = $u['src'] ?? $u['url'] ?? reset($u);
        $u = trim((string)$u);
        if ($u !== '') {
            if (stripos($u, 'http://') === 0) $u = 'https://' . substr($u, 7);
            return $u;
        }
    }
    return '';
}

function parseSysReq($html): array {
    if (!is_string($html) || $html === '') return [];
    $text = html_entity_decode(strip_tags(str_replace(['<br>', '<br/>', '<br />', '</li>', '</p>'], "\n", $html)), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $out = ['os' => '', 'processor' => '', 'memory' => '', 'graphics' => '', 'directx' => '', 'storage' => '', 'notes' => trim($text)];
    foreach ([['os','ОС|OS'], ['processor','Процессор|Processor'], ['memory','Память|Memory|RAM'], ['graphics','Видеокарта|Graphics|Video'], ['directx','DirectX'], ['storage','Место на диске|Storage|Hard Drive']] as [$k, $pat]) {
        if (preg_match('/(?:' . $pat . ')\s*:\s*(.+)/iu', $text, $m)) {
            $out[$k] = trim($m[1]);
        }
    }
    return $out;
}

// ---- Steam ----
say("AppID: $appId");
say("Чтение Steam API…");
$raw = httpGet("https://store.steampowered.com/api/appdetails?appids={$appId}&l=russian", [], 25);
if (!$raw) $raw = httpGet("https://store.steampowered.com/api/appdetails?appids={$appId}&l=english", [], 25);
if (!$raw) fail('Steam API недоступен');
$j = json_decode($raw, true);
$data = $j[(string)$appId]['data'] ?? null;
if (!is_array($data) || empty($j[(string)$appId]['success'])) fail('Игра не найдена в Steam API');

$title = (string)($data['name'] ?? ('App ' . $appId));
say("Игра: $title");

$tmp = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'catio_steam_' . $appId . '_' . bin2hex(random_bytes(3));
@mkdir($tmp . '/media/screenshots', 0775, true);
@mkdir($tmp . '/media/trailers', 0775, true);
@mkdir($tmp . '/sgdb/icons', 0775, true);
@mkdir($tmp . '/sgdb/covers', 0775, true);
@mkdir($tmp . '/sgdb/heroes', 0775, true);
@mkdir($tmp . '/sgdb/logos', 0775, true);

$manifest = [
    'format' => 'catio-game-pack',
    'version' => 1,
    'exported_at' => date('c'),
    'source' => 'steam_cli',
    'steam_appid' => $appId,
    'game' => [
        'title' => $title,
        'short_description' => (string)($data['short_description'] ?? ''),
        'description' => (string)($data['detailed_description'] ?? $data['about_the_game'] ?? ''),
        'developer' => is_array($data['developers'] ?? null) ? implode(', ', $data['developers']) : '',
        'publisher' => is_array($data['publishers'] ?? null) ? implode(', ', $data['publishers']) : '',
        'genre' => '',
        'tags' => '',
        'price' => 0,
        'steam_appid' => $appId,
        'video_url' => '',
        'sys_req_min' => parseSysReq($data['pc_requirements']['minimum'] ?? ''),
        'sys_req_rec' => parseSysReq($data['pc_requirements']['recommended'] ?? ''),
        'languages' => [],
        'controllers' => '',
    ],
    'screenshots' => [],
    'movies' => [],
    'files' => [
        'cover' => null, 'banner' => null, 'icon' => null, 'logo' => null,
        'screenshots' => [], 'trailers' => [],
        'sgdb' => ['icons' => [], 'covers' => [], 'heroes' => [], 'logos' => []],
    ],
];

if (!empty($data['genres']) && is_array($data['genres'])) {
    $manifest['game']['genre'] = implode(', ', array_map(fn($g) => $g['description'] ?? '', $data['genres']));
}
if (!empty($data['categories']) && is_array($data['categories'])) {
    $manifest['game']['tags'] = implode(', ', array_map(fn($c) => $c['description'] ?? '', array_slice($data['categories'], 0, 12)));
}
// price
if (isset($data['price_overview']['final'])) {
    $manifest['game']['price'] = round(((int)$data['price_overview']['final']) / 100, 2);
}

// languages
if (!empty($data['supported_languages'])) {
    $langHtml = strip_tags(str_replace(['<br>', '<br/>', '<br />'], ',', (string)$data['supported_languages']));
    $parts = preg_split('/[,;]+/', $langHtml) ?: [];
    foreach ($parts as $p) {
        $name = trim(preg_replace('/\s*\*.*$/', '', $p));
        if ($name !== '') $manifest['game']['languages'][] = ['name' => $name, 'subtitles' => true, 'audio' => true];
    }
}

// media
say('Упаковка медиа…');
$header = (string)($data['header_image'] ?? '');
if ($header && downloadFile($header, $tmp . '/media/banner.jpg')) {
    $manifest['files']['banner'] = 'media/banner.jpg';
    say('  + banner');
}
// capsule as cover
$cover = (string)($data['capsule_image'] ?? $data['header_image'] ?? '');
if (!empty($data['screenshots'][0]['path_full'])) {
    // prefer vertical-ish? keep capsule
}
if ($cover && downloadFile($cover, $tmp . '/media/cover.jpg')) {
    $manifest['files']['cover'] = 'media/cover.jpg';
    say('  + cover');
}
// library capsule often better for cover - try CDN pattern
$libCover = "https://cdn.cloudflare.steamstatic.com/steam/apps/{$appId}/library_600x900.jpg";
if (downloadFile($libCover, $tmp . '/media/cover.jpg')) {
    $manifest['files']['cover'] = 'media/cover.jpg';
    say('  + cover (library)');
}
$iconUrl = "https://cdn.cloudflare.steamstatic.com/steam/apps/{$appId}/logo.png";
// actual icon is clienticns - try capsule_231x87 as logo
$logo = (string)($data['capsule_imagev5'] ?? '');
if ($logo && downloadFile($logo, $tmp . '/media/logo.png')) {
    $manifest['files']['logo'] = 'media/logo.png';
    say('  + logo');
}

// screenshots
$shots = $data['screenshots'] ?? [];
$si = 0;
foreach (array_slice(is_array($shots) ? $shots : [], 0, 12) as $s) {
    $u = (string)($s['path_full'] ?? $s['path_thumbnail'] ?? '');
    if ($u === '') continue;
    $si++;
    $rel = 'media/screenshots/' . sprintf('%02d', $si) . '.jpg';
    if (downloadFile($u, $tmp . '/' . $rel)) {
        $manifest['files']['screenshots'][] = $rel;
        $manifest['screenshots'][] = $rel;
        say("  + screenshot $si");
    }
}

// movies
say('Трейлеры…');
$movies = $data['movies'] ?? [];
$mi = 0;
$videoUrls = [];
foreach (array_slice(is_array($movies) ? $movies : [], 0, 5) as $m) {
    if (!is_array($m)) continue;
    $vid = steamMovieUrl($m);
    if ($vid === '') continue;
    $mi++;
    $entry = [
        'name' => (string)($m['name'] ?? ('Trailer ' . $mi)),
        'url' => $vid,
        'source_url' => $vid,
        'thumbnail' => (string)($m['thumbnail'] ?? ''),
        'file' => null,
    ];
    $isStream = (bool)preg_match('/\.m3u8(\?|$)|\.mpd(\?|$)|youtube\.com|youtu\.be/i', $vid);
    if (!$isStream) {
        $ext = extFromUrl($vid, 'mp4');
        $rel = 'media/trailers/' . sprintf('%02d', $mi) . '.' . $ext;
        if (downloadFile($vid, $tmp . '/' . $rel)) {
            $entry['file'] = $rel;
            $manifest['files']['trailers'][] = $rel;
            say("  + trailer file $mi");
        } else {
            say("  + trailer URL $mi (download failed)");
        }
    } else {
        say("  + trailer stream $mi");
    }
    if (!empty($entry['thumbnail'])) {
        $trel = 'media/trailers/' . sprintf('%02d', $mi) . '_thumb.jpg';
        if (downloadFile($entry['thumbnail'], $tmp . '/' . $trel)) $entry['thumb_file'] = $trel;
    }
    $manifest['movies'][] = $entry;
    $videoUrls[] = $vid;
}
if ($videoUrls) {
    $manifest['game']['video_url'] = count($videoUrls) === 1 ? $videoUrls[0] : json_encode($videoUrls, JSON_UNESCAPED_UNICODE);
}

// SGDB
say('SteamGridDB / CATioGridDB…');
$sgdbGameId = null;
$key = sgdbKey();
if ($key === '') {
    say('  (нет STEAMGRIDDB_API_KEY — пропускаем SGDB)');
} else {
    $gInfo = sgdbRequest('games/steam/' . $appId);
    $sgdbGameId = $gInfo['data']['id'] ?? null;
    if (!$sgdbGameId) {
        $search = sgdbRequest('search/autocomplete/' . rawurlencode($title));
        $sd = $search['data'] ?? [];
        if (is_array($sd) && $sd) $sgdbGameId = $sd[0]['id'] ?? null;
    }
    if ($sgdbGameId) {
        $kinds = ['icons' => 'icons', 'covers' => 'grids', 'heroes' => 'heroes', 'logos' => 'logos'];
        foreach ($kinds as $folder => $endpoint) {
            say("  SGDB " . $folder);
            $json = sgdbRequest($endpoint . '/game/' . (int)$sgdbGameId . '?types=static&nsfw=any');
            $rows = $json['data'] ?? [];
            if (!is_array($rows)) continue;
            $n = 0;
            foreach ($rows as $r) {
                $url = (string)($r['url'] ?? '');
                if ($url === '') continue;
                $n++;
                $ext = extFromUrl($url, 'png');
                $rel = 'sgdb/' . $folder . '/' . sprintf('%02d', $n) . '.' . $ext;
                if (downloadFile($url, $tmp . '/' . $rel)) {
                    $manifest['files']['sgdb'][$folder][] = [
                        'file' => $rel, 'url' => $url, 'thumb' => $r['thumb'] ?? $url,
                        'width' => (int)($r['width'] ?? 0), 'height' => (int)($r['height'] ?? 0),
                    ];
                    say("    + $rel");
                }
                if ($n >= 12) break;
            }
        }
        $manifest['sgdb_game_id'] = (int)$sgdbGameId;
    } else {
        say('  SGDB: игра не найдена');
    }
}

file_put_contents($tmp . '/manifest.json', json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

if (!class_exists('ZipArchive')) fail('Расширение zip не установлено в PHP (extension=zip в php.ini)');

$slug = preg_replace('/[^a-z0-9]+/i', '-', strtolower($title));
$slug = trim($slug, '-') ?: ('app-' . $appId);
$zipName = "game-pack-{$slug}-s{$appId}.zip";
$zipPath = $outDir . DIRECTORY_SEPARATOR . $zipName;

say('Создание ZIP…');
$zip = new ZipArchive();
if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) fail("Не удалось создать $zipPath");

$it = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($tmp, FilesystemIterator::SKIP_DOTS),
    RecursiveIteratorIterator::SELF_FIRST
);
$cnt = 0;
foreach ($it as $file) {
    /** @var SplFileInfo $file */
    if (!$file->isFile()) continue;
    $full = $file->getPathname();
    $rel = str_replace('\\', '/', substr($full, strlen($tmp) + 1));
    $zip->addFile($full, $rel);
    $cnt++;
    say("  zip + $rel");
}
$zip->close();

// cleanup tmp
$it2 = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($tmp, FilesystemIterator::SKIP_DOTS),
    RecursiveIteratorIterator::CHILD_FIRST
);
foreach ($it2 as $f) {
    $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
}
@rmdir($tmp);

say("Готово: $zipPath");
say("Файлов в архиве: $cnt");
say("Импортируй этот ZIP в модалке «Публикация игры» → Импорт");
exit(0);
