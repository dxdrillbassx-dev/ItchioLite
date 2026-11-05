<?php
// CATio — импорт игры из Steam Store (тест для админа)
require_once __DIR__ . '/../auth.php';
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

function mapSteamToPreview(array $d, int $appId): array {
    $shots = [];
    foreach (($d['screenshots'] ?? []) as $s) {
        if (!empty($s['path_full'])) $shots[] = $s['path_full'];
        elseif (!empty($s['path_thumbnail'])) $shots[] = $s['path_thumbnail'];
        if (count($shots) >= 12) break;
    }
    $movies = [];
    foreach (($d['movies'] ?? []) as $m) {
        $movies[] = [
            'name' => $m['name'] ?? '',
            'thumbnail' => $m['thumbnail'] ?? '',
            'mp4' => $m['mp4']['max'] ?? ($m['mp4']['480'] ?? ''),
            'webm' => $m['webm']['max'] ?? ($m['webm']['480'] ?? ''),
        ];
        if (count($movies) >= 3) break;
    }
    $genres = [];
    foreach (($d['genres'] ?? []) as $g) {
        if (!empty($g['description'])) $genres[] = $g['description'];
    }
    $devs = $d['developers'] ?? [];
    $pubs = $d['publishers'] ?? [];
    $minHtml = is_array($d['pc_requirements'] ?? null) ? ($d['pc_requirements']['minimum'] ?? '') : '';
    $recHtml = is_array($d['pc_requirements'] ?? null) ? ($d['pc_requirements']['recommended'] ?? '') : '';

    return [
        'app_id' => $appId,
        'title' => $d['name'] ?? ('Steam ' . $appId),
        'short_description' => stripSteamHtml($d['short_description'] ?? ''),
        'description' => stripSteamHtml($d['detailed_description'] ?? ($d['about_the_game'] ?? '')),
        'genre' => $genres[0] ?? 'Action',
        'genres' => $genres,
        'developer' => $devs[0] ?? ($pubs[0] ?? ''),
        'publisher' => $pubs[0] ?? '',
        'header_image' => $d['header_image'] ?? '',
        'capsule_image' => $d['capsule_imagev5'] ?? ($d['capsule_image'] ?? ''),
        'background' => $d['background'] ?? ($d['background_raw'] ?? ''),
        // как в Hydra: library assets с CDN (выше качество, чем header/capsule из appdetails)
        'library_cover' => 'https://cdn.cloudflare.steamstatic.com/steam/apps/' . $appId . '/library_600x900_2x.jpg',
        'library_cover_fallback' => 'https://cdn.cloudflare.steamstatic.com/steam/apps/' . $appId . '/library_600x900.jpg',
        'library_hero' => 'https://cdn.cloudflare.steamstatic.com/steam/apps/' . $appId . '/library_hero_2x.jpg',
        'library_hero_fallback' => 'https://cdn.cloudflare.steamstatic.com/steam/apps/' . $appId . '/library_hero.jpg',
        'library_header' => 'https://cdn.cloudflare.steamstatic.com/steam/apps/' . $appId . '/library_header.jpg',
        'screenshots' => $shots,
        'movies' => $movies,
        'is_free' => !empty($d['is_free']),
        'release_date' => $d['release_date']['date'] ?? '',
        'supported_languages' => $d['supported_languages'] ?? '',
        'sys_req_min_text' => stripSteamHtml(is_string($minHtml) ? $minHtml : ''),
        'sys_req_rec_text' => stripSteamHtml(is_string($recHtml) ? $recHtml : ''),
        'controllers' => 'xbox,playstation',
        'steam_url' => 'https://store.steampowered.com/app/' . $appId,
    ];
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
        // 1) library vertical cover (Hydra-style), 2) capsule, 3) header
        $coverUrl = saveRemoteImage($p['library_cover'], $coverDir, 'steam' . $appId . '_cover');
        if (!$coverUrl) $coverUrl = saveRemoteImage($p['library_cover_fallback'], $coverDir, 'steam' . $appId . '_cover');
        if (!$coverUrl) $coverUrl = saveRemoteImage($p['capsule_image'] ?: '', $coverDir, 'steam' . $appId . '_cover');
        if (!$coverUrl) $coverUrl = saveRemoteImage($p['header_image'] ?: '', $coverDir, 'steam' . $appId . '_cover');

        // hero for banner
        $bannerUrl = saveRemoteImage($p['library_hero'], $bannerDir, 'steam' . $appId . '_banner');
        if (!$bannerUrl) $bannerUrl = saveRemoteImage($p['library_hero_fallback'], $bannerDir, 'steam' . $appId . '_banner');
        if (!$bannerUrl) $bannerUrl = saveRemoteImage($p['library_header'], $bannerDir, 'steam' . $appId . '_banner');
        if (!$bannerUrl) $bannerUrl = saveRemoteImage($p['header_image'] ?: ($p['background'] ?? ''), $bannerDir, 'steam' . $appId . '_banner');
        if (!$coverUrl && $bannerUrl) $coverUrl = $bannerUrl;
        if (!$coverUrl) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Не удалось скачать обложку из Steam'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $video = '';
        if (!empty($p['movies'][0]['mp4'])) $video = $p['movies'][0]['mp4'];
        elseif (!empty($p['movies'][0]['webm'])) $video = $p['movies'][0]['webm'];

        // превью трейлеров
        try {
            $pdo->exec("ALTER TABLE game_media ADD COLUMN thumb_url VARCHAR(512) NULL DEFAULT NULL");
        } catch (Throwable $e) {}

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
        $videosSaved = 0;
        $videoDir = $base . '/videos';
        if (!is_dir($videoDir)) @mkdir($videoDir, 0775, true);

        // Трейлеры Steam — ПЕРЕД скриншотами (как в магазине Steam)
        foreach (array_slice($p['movies'] ?? [], 0, 3) as $mi => $movie) {
            $mp4 = $movie['mp4'] ?? '';
            $webm = $movie['webm'] ?? '';
            $src = $mp4 !== '' ? $mp4 : $webm;
            if ($src === '') continue;

            // превью кадра трейлера скачиваем локально
            $thumbLocal = null;
            if (!empty($movie['thumbnail'])) {
                $thumbLocal = saveRemoteImage($movie['thumbnail'], $shotDir, 'steam' . $appId . '_vidthumb' . $mi);
            }

            // пробуем скачать сам ролик (480p/max может быть тяжёлым — если не вышло, оставляем CDN)
            $localVideo = null;
            $ext = (stripos($src, '.webm') !== false) ? 'webm' : 'mp4';
            $destName = 'steam' . $appId . '_vid' . $mi . '_' . bin2hex(random_bytes(3)) . '.' . $ext;
            $destFull = $videoDir . DIRECTORY_SEPARATOR . $destName;
            if (httpDownload($src, $destFull, 90)) {
                $sz = @filesize($destFull);
                // отсекаем пустышки / слишком огромные (>120 МБ)
                if ($sz !== false && $sz > 50 * 1024 && $sz < 120 * 1024 * 1024) {
                    $localVideo = 'uploads/games/videos/' . $destName;
                } else {
                    @unlink($destFull);
                }
            }

            $finalUrl = $localVideo ?: $src;
            try {
                // sort_order начинается с 0 — видео идут первыми
                $pdo->prepare("INSERT INTO game_media (game_id, kind, url, thumb_url, sort_order) VALUES (?,?,?,?,?)")
                    ->execute([$gameId, 'video', $finalUrl, $thumbLocal, $order++]);
                $videosSaved++;
            } catch (Throwable $e) {
                // без thumb_url (старая схема)
                try {
                    $pdo->prepare("INSERT INTO game_media (game_id, kind, url, sort_order) VALUES (?,?,?,?)")
                        ->execute([$gameId, 'video', $finalUrl, $order++]);
                    $videosSaved++;
                } catch (Throwable $e2) {}
            }
        }

        // Скриншоты после видео
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

        echo json_encode([
            'ok' => true,
            'game_id' => $gameId,
            'title' => $title,
            'status' => $status,
            'cover_url' => $coverUrl,
            'banner_url' => $bannerUrl,
            'screenshots' => max(0, $order - $videosSaved),
            'videos' => $videosSaved,
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
