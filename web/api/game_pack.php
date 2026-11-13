<?php
require_once __DIR__ . '/bootstrap.php';
/**
 * Экспорт / импорт полной карточки игры (ZIP-пакет).
 * Нужен, чтобы переносить Steam-игры в «офлайн»-пакет без привязки к Steam.
 *
 * actions:
 *   export        GET  ?game_id=  — админ, отдаёт ZIP
 *   import_pack   POST multipart pack=file — любой авторизованный, распаковывает во временную папку
 *   sgdb_by_name  GET  ?q=       — поиск игры в SteamGridDB по названию + топ-ассеты
 */
$action = trim((string)($_GET['action'] ?? $_POST['action'] ?? ''));
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

function gp_requireUser(): array {
    $u = function_exists('getCurrentUser') ? getCurrentUser() : null;
    if (!$u) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'Нужно войти'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    return $u;
}
function gp_requireAdmin(): array {
    $u = gp_requireUser();
    if (($u['role'] ?? '') !== 'admin' && empty($u['is_admin'])) {
        http_response_code(403);
        echo json_encode(['ok' => false, 'error' => 'Только для админов'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    return $u;
}

function gp_httpGet(string $url, array $headers = [], int $timeout = 30): ?string {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_USERAGENT => 'ItchioLite-GamePack/1.0',
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
        'header' => $hdr,
        'user_agent' => 'ItchioLite-GamePack/1.0',
    ]]);
    $body = @file_get_contents($url, false, $ctx);
    return $body === false ? null : $body;
}

function gp_download(string $url, string $dest): bool {
    $timeout = preg_match('/\.(mp4|webm|mov|mkv)(\?|$)/i', $url) ? 180 : 60;
    $bin = gp_httpGet($url, [], $timeout);
    if ($bin === null || $bin === '') return false;
    $dir = dirname($dest);
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    return file_put_contents($dest, $bin) !== false;
}

function gp_sgdbKey(): string {
    return '';
}


function gp_sgdbRequest(string $path): ?array {
    return null; // diploma: no external SGDB
}


function gp_resolveLocalPath(string $urlOrPath): ?string {
    $u = trim($urlOrPath);
    if ($u === '') return null;
    // absolute URL to our host or relative uploads/
    if (preg_match('#^https?://#i', $u)) {
        $path = parse_url($u, PHP_URL_PATH) ?: '';
        $u = ltrim($path, '/');
    }
    $u = ltrim(str_replace(['\\', '..'], ['/', ''], $u), '/');
    $candidates = [
        __DIR__ . '/../' . $u,
        __DIR__ . '/../../' . $u,
        (isset($_SERVER['DOCUMENT_ROOT']) ? rtrim($_SERVER['DOCUMENT_ROOT'], '/') . '/' . $u : ''),
    ];
    foreach ($candidates as $p) {
        if ($p && is_file($p)) return $p;
    }
    return null;
}

function gp_extFromUrl(string $url, string $fallback = 'bin'): string {
    $path = parse_url($url, PHP_URL_PATH) ?: $url;
    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    if ($ext === '' || strlen($ext) > 5) return $fallback;
    return preg_replace('/[^a-z0-9]/', '', $ext) ?: $fallback;
}

function gp_loadGameRow(PDO $pdo, int $id): ?array {
    $st = $pdo->prepare('SELECT * FROM games WHERE id = ?');
    $st->execute([$id]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    return $g ?: null;
}

function gp_loadScreenshots(PDO $pdo, int $gameId): array {
    $out = [];
    try {
        $st = $pdo->prepare('SELECT image_url AS url, sort FROM game_screenshots WHERE game_id = ? ORDER BY sort ASC, id ASC');
        $st->execute([$gameId]);
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) ?: [] as $r) {
            if (!empty($r['url'])) $out[] = ['url' => $r['url'], 'kind' => 'screenshot'];
        }
    } catch (Throwable $e) {}
    try {
        $st = $pdo->prepare("SELECT url, kind, sort_order FROM game_media WHERE game_id = ? AND (kind IN ('screenshot','screenshots','image','shot') OR kind IS NULL OR kind = '') ORDER BY sort_order ASC, id ASC");
        $st->execute([$gameId]);
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) ?: [] as $r) {
            if (empty($r['url'])) continue;
            $dup = false;
            foreach ($out as $o) { if ($o['url'] === $r['url']) { $dup = true; break; } }
            if (!$dup) $out[] = ['url' => $r['url'], 'kind' => 'screenshot'];
        }
    } catch (Throwable $e) {}
    return $out;
}

function gp_loadTrailers(PDO $pdo, int $gameId, array $gameRow): array {
    $out = [];
    // video_url on game
    $vu = trim((string)($gameRow['video_url'] ?? ''));
    if ($vu !== '') {
        $out[] = ['url' => $vu, 'kind' => 'trailer', 'name' => 'Trailer', 'thumbnail' => ''];
    }
    try {
        $st = $pdo->prepare("SELECT url, kind, sort_order FROM game_media WHERE game_id = ? AND kind IN ('trailer','video','movie','movies','mp4') ORDER BY sort_order ASC, id ASC");
        $st->execute([$gameId]);
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) ?: [] as $r) {
            if (empty($r['url'])) continue;
            $dup = false;
            foreach ($out as $o) { if ($o['url'] === $r['url']) { $dup = true; break; } }
            if (!$dup) $out[] = ['url' => $r['url'], 'kind' => 'trailer', 'name' => 'Trailer', 'thumbnail' => ''];
        }
    } catch (Throwable $e) {}
    // movies JSON field
    $movies = $gameRow['movies'] ?? null;
    if (is_string($movies)) {
        $j = json_decode($movies, true);
        if (is_array($j)) $movies = $j;
    }
    if (is_array($movies)) {
        foreach ($movies as $m) {
            if (!is_array($m)) continue;
            $url = (string)($m['mp4'] ?? $m['url'] ?? $m['webm'] ?? '');
            if ($url === '') continue;
            $dup = false;
            foreach ($out as $o) { if ($o['url'] === $url) { $dup = true; break; } }
            if (!$dup) {
                $out[] = [
                    'url' => $url,
                    'kind' => 'trailer',
                    'name' => (string)($m['name'] ?? 'Trailer'),
                    'thumbnail' => (string)($m['thumbnail'] ?? ''),
                ];
            }
        }
    }
    return $out;
}


function gp_parseSysReqText($text): array {
    $text = trim(html_entity_decode(strip_tags(str_replace(['<br>', '<br/>', '<br />', '</li>', '</p>'], "\n", (string)$text)), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    $text = preg_replace("/[ \t]+/", ' ', $text) ?? $text;
    $out = ['os' => '', 'processor' => '', 'memory' => '', 'gpu' => '', 'directx' => '', 'storage' => '', 'sound' => '', 'other' => ''];
    if ($text === '') return $out;
    $patterns = [
        'os' => '/(?:OS|ОС|Operating System)\s*[:：]\s*(.+)/iu',
        'processor' => '/(?:Processor|Процессор|CPU)\s*[:：]\s*(.+)/iu',
        'memory' => '/(?:Memory|Оперативная память|RAM)\s*[:：]\s*(.+)/iu',
        'gpu' => '/(?:Graphics|Видеокарта|GPU|Video Card)\s*[:：]\s*(.+)/iu',
        'directx' => '/(?:DirectX)\s*[:：]\s*(.+)/iu',
        'storage' => '/(?:Storage|Место на диске|Hard Drive|Disk Space)\s*[:：]\s*(.+)/iu',
        'sound' => '/(?:Sound(?: Card)?|Звуковая карта)\s*[:：]\s*(.+)/iu',
    ];
    $lines = preg_split('/\r\n|\r|\n/', $text) ?: [];
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '') continue;
        $matched = false;
        foreach ($patterns as $k => $re) {
            if (preg_match($re, $line, $m)) {
                $out[$k] = trim($m[1]);
                $matched = true;
                break;
            }
        }
        if (!$matched) {
            $out['other'] = trim($out['other'] . ($out['other'] ? "\n" : '') . $line);
        }
    }
    // if nothing parsed into fields, put all in other
    $has = false;
    foreach (['os','processor','memory','gpu','directx','storage','sound'] as $k) {
        if ($out[$k] !== '') { $has = true; break; }
    }
    if (!$has) $out['other'] = $text;
    return $out;
}

function gp_normalizeSysReq($v): array {
    $v = gp_jsonField($v);
    if (is_array($v)) {
        // already structured
        if (isset($v['os']) || isset($v['processor']) || isset($v['memory']) || isset($v['gpu'])) {
            return array_merge(['os'=>'','processor'=>'','memory'=>'','gpu'=>'','directx'=>'','storage'=>'','sound'=>'','other'=>''], array_map('strval', $v));
        }
        if (isset($v['notes']) || isset($v['minimum']) || isset($v['recommended'])) {
            $text = (string)($v['notes'] ?? $v['minimum'] ?? $v['recommended'] ?? '');
            return gp_parseSysReqText($text);
        }
        // flat unknown
        return gp_parseSysReqText(json_encode($v, JSON_UNESCAPED_UNICODE));
    }
    if (is_string($v) && $v !== '') return gp_parseSysReqText($v);
    return ['os'=>'','processor'=>'','memory'=>'','gpu'=>'','directx'=>'','storage'=>'','sound'=>'','other'=>''];
}

function gp_normalizeLanguages($v): array {
    $v = gp_jsonField($v);
    $out = [];
    if (!is_array($v)) {
        if (is_string($v) && $v !== '') {
            foreach (preg_split('/[,;\n]+/', $v) ?: [] as $p) {
                $p = trim($p);
                if ($p !== '') $out[] = ['name' => $p, 'subtitles' => true, 'audio' => true];
            }
        }
        return $out;
    }
    foreach ($v as $item) {
        if (is_string($item)) {
            $name = trim($item);
            if ($name !== '') $out[] = ['name' => $name, 'subtitles' => true, 'audio' => true];
        } elseif (is_array($item)) {
            $name = trim((string)($item['name'] ?? $item['lang'] ?? $item['language'] ?? ''));
            if ($name === '') continue;
            $out[] = [
                'name' => $name,
                'subtitles' => !empty($item['subtitles']) || !empty($item['sub']),
                'audio' => !empty($item['audio']) || !empty($item['full_audio']),
            ];
        }
    }
    return $out;
}

function gp_normalizeControllers($v): string {
    if (is_array($v)) $v = implode(',', $v);
    $s = mb_strtolower(trim((string)$v));
    if ($s === '') return '';
    $parts = preg_split('/[,;|]+/', $s) ?: [];
    $out = [];
    foreach ($parts as $p) {
        $p = trim($p);
        if ($p === '') continue;
        if (str_contains($p, 'xbox')) $out[] = 'xbox';
        elseif (str_contains($p, 'play') || str_contains($p, 'ps')) $out[] = 'playstation';
        elseif (str_contains($p, 'switch') || str_contains($p, 'nintendo')) $out[] = 'switch';
        elseif (str_contains($p, 'key') || str_contains($p, 'клав')) $out[] = 'keyboard';
        elseif (in_array($p, ['full', 'partial', 'supported', 'controller', 'gamepad'], true)) {
            $out[] = 'xbox';
            $out[] = 'playstation';
            $out[] = 'keyboard';
        } else {
            $out[] = $p;
        }
    }
    return implode(',', array_values(array_unique($out)));
}


function gp_steamMovieUrl(array $m): string {
    return '';
}


function gp_fetchSteamEnrich(int $appId): ?array {
    return null; // diploma: no Steam Store API
}



function gp_jsonField($v) {
    if ($v === null || $v === '') return null;
    if (is_array($v)) return $v;
    if (is_string($v)) {
        $j = json_decode($v, true);
        return (json_last_error() === JSON_ERROR_NONE) ? $j : $v;
    }
    return $v;
}

// ---------- EXPORT ----------
if ($action === 'export') {
    // NDJSON stream progress when stream=1, else direct ZIP
    $stream = !empty($_GET['stream']) || !empty($_POST['stream']);
    if ($stream) {
        header('Content-Type: application/x-ndjson; charset=utf-8');
        header('Cache-Control: no-cache, no-store');
        header('X-Accel-Buffering: no');
        while (ob_get_level()) ob_end_flush();
        @ini_set('output_buffering', 'off');
        @ini_set('zlib.output_compression', '0');
    } else {
        }

    gp_requireAdmin();
    if (!class_exists('ZipArchive')) {
        if ($stream) {
            echo json_encode(['ok' => false, 'error' => 'ZipArchive не установлен на сервере'], JSON_UNESCAPED_UNICODE) . "\n";
            exit;
        }
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'ZipArchive не установлен на сервере'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    $gameId = (int)($_GET['game_id'] ?? $_POST['game_id'] ?? 0);
    if ($gameId <= 0) {
        if ($stream) { echo json_encode(['ok'=>false,'error'=>'game_id'], JSON_UNESCAPED_UNICODE)."\n"; exit; }
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'game_id'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $emit = function (array $row) use ($stream) {
        if (!$stream) return;
        echo json_encode($row, JSON_UNESCAPED_UNICODE) . "\n";
        if (function_exists('flush')) flush();
        if (function_exists('ob_flush')) { @ob_flush(); }
    };

    $pdo = getDB();
    $emit(['phase' => 'meta', 'pct' => 2, 'msg' => 'Чтение карточки игры #' . $gameId . '…']);
    $g = gp_loadGameRow($pdo, $gameId);
    if (!$g) {
        $emit(['ok' => false, 'error' => 'Игра не найдена', 'pct' => 0]);
        if (!$stream) { http_response_code(404); echo json_encode(['ok'=>false,'error'=>'Игра не найдена'], JSON_UNESCAPED_UNICODE); }
        exit;
    }
    $emit(['phase' => 'meta', 'pct' => 5, 'msg' => 'Игра: ' . (string)($g['title'] ?? '')]);

    $shots = gp_loadScreenshots($pdo, $gameId);
    $steamAppId = (int)($g['steam_appid'] ?? 0);
    if (!$steamAppId && !empty($g['slug']) && preg_match('/-s(\d{3,10})$/', (string)$g['slug'], $m)) {
        $steamAppId = (int)$m[1];
    }

    $manifest = [
        'format' => 'itchiolite-game-pack',
        'version' => 1,
        'exported_at' => gmdate('c'),
        'source_game_id' => (int)$g['id'],
        'steam_appid' => $steamAppId ?: null,
        'game' => [
            'title' => $g['title'] ?? '',
            'slug' => $g['slug'] ?? '',
            'short_description' => $g['short_description'] ?? '',
            'description' => $g['description'] ?? '',
            'developer' => $g['developer_name'] ?? $g['developer'] ?? '',
            'publisher_name' => $g['publisher_name'] ?? '',
            'price' => $g['price'] ?? 0,
            'discount_percent' => $g['discount_percent'] ?? 0,
            'genre' => $g['genre'] ?? '',
            'tags' => $g['tags'] ?? '',
            'category' => $g['category'] ?? 'game',
            'release_date' => $g['release_date'] ?? null,
            'platforms' => $g['platforms'] ?? null,
            'controllers' => $g['controllers'] ?? null,
            'is_adult' => (int)($g['is_adult'] ?? 0),
            'video_url' => $g['video_url'] ?? null,
            'sys_req_min' => gp_jsonField($g['sys_req_min'] ?? $g['pc_requirements_min'] ?? null),
            'sys_req_rec' => gp_jsonField($g['sys_req_rec'] ?? $g['pc_requirements_rec'] ?? null),
            'languages' => gp_jsonField($g['languages'] ?? null),
            'cover_url' => $g['cover_url'] ?? $g['cover'] ?? '',
            'banner_url' => $g['banner_url'] ?? $g['header_image'] ?? '',
            'icon_url' => $g['icon_url'] ?? '',
            'logo_url' => $g['logo_url'] ?? '',
        ],
        'screenshots' => array_map(fn($s) => $s['url'] ?? $s['image_url'] ?? '', $shots),
        'movies' => gp_jsonField($g['movies'] ?? null) ?: [],
        'files' => [
            'cover' => null, 'banner' => null, 'icon' => null, 'logo' => null,
            'screenshots' => [],
            'sgdb' => ['icons' => [], 'covers' => [], 'heroes' => [], 'logos' => []],
        ],
    ];

    // нормализация sys/lang/controllers + догрузка из Steam если пусто
    $manifest['game']['sys_req_min'] = gp_normalizeSysReq($manifest['game']['sys_req_min'] ?? null);
    $manifest['game']['sys_req_rec'] = gp_normalizeSysReq($manifest['game']['sys_req_rec'] ?? null);
    $manifest['game']['languages'] = gp_normalizeLanguages($manifest['game']['languages'] ?? null);
    $manifest['game']['controllers'] = gp_normalizeControllers($manifest['game']['controllers'] ?? '');

    if ($steamAppId > 0) {
        $emit(['phase' => 'meta', 'pct' => 8, 'msg' => 'Догрузка данных Steam API…']);
        $steamData = gp_fetchSteamEnrich($steamAppId);
        if ($steamData) {
            $pc = $steamData['pc_requirements'] ?? null;
            if (is_array($pc)) {
                $minT = (string)($pc['minimum'] ?? '');
                $recT = (string)($pc['recommended'] ?? '');
                $emptyMin = !array_filter($manifest['game']['sys_req_min'] ?? []);
                $emptyRec = !array_filter($manifest['game']['sys_req_rec'] ?? []);
                if ($emptyMin && $minT !== '') $manifest['game']['sys_req_min'] = gp_parseSysReqText($minT);
                if ($emptyRec && $recT !== '') $manifest['game']['sys_req_rec'] = gp_parseSysReqText($recT);
            }
            if (empty($manifest['game']['languages'])) {
                $langsRaw = (string)($steamData['supported_languages'] ?? '');
                if ($langsRaw !== '') {
                    $parts = preg_split('~[,;\n]+~', strip_tags(html_entity_decode($langsRaw, ENT_QUOTES | ENT_HTML5, 'UTF-8'))) ?: [];
                    $clean = [];
                    foreach ($parts as $p) {
                        $p = trim(preg_replace('/\*.*$/', '', $p) ?? $p);
                        if ($p !== '' && mb_strlen($p) < 60) $clean[] = $p;
                        if (count($clean) >= 24) break;
                    }
                    $manifest['game']['languages'] = gp_normalizeLanguages($clean);
                }
            }
            if (trim((string)$manifest['game']['controllers']) === '') {
                $ctrlParts = [];
                foreach ((array)($steamData['categories'] ?? []) as $c) {
                    if (!is_array($c)) continue;
                    $desc = mb_strtolower((string)($c['description'] ?? ''));
                    if (str_contains($desc, 'xbox')) $ctrlParts[] = 'xbox';
                    if (str_contains($desc, 'playstation') || str_contains($desc, 'ps5') || str_contains($desc, 'ps4')) $ctrlParts[] = 'playstation';
                    if (str_contains($desc, 'switch') || str_contains($desc, 'nintendo')) $ctrlParts[] = 'switch';
                    if (str_contains($desc, 'controller') || str_contains($desc, 'геймпад') || str_contains($desc, 'full controller')) {
                        $ctrlParts[] = 'xbox'; $ctrlParts[] = 'playstation'; $ctrlParts[] = 'keyboard';
                    }
                }
                $manifest['game']['controllers'] = gp_normalizeControllers(implode(',', array_unique($ctrlParts)));
            }
            // movies from steam if local empty (mp4/webm ИЛИ hls/dash)
            if (!empty($steamData['movies']) && is_array($steamData['movies'])) {
                $got = 0;
                foreach ($steamData['movies'] as $m) {
                    if (!is_array($m)) continue;
                    $vid = gp_steamMovieUrl($m);
                    if ($vid === '') {
                        $emit(['phase' => 'meta', 'pct' => null, 'msg' => '  steam movie without playable url: ' . (string)($m['name'] ?? '')]);
                        continue;
                    }
                    $manifest['movies'][] = [
                        'name' => (string)($m['name'] ?? 'Trailer'),
                        'mp4' => $vid,
                        'url' => $vid,
                        'source_url' => $vid,
                        'thumbnail' => (string)($m['thumbnail'] ?? ''),
                        'format' => (str_contains($vid, '.m3u8') ? 'hls' : (str_contains($vid, '.mpd') ? 'dash' : 'file')),
                    ];
                    $got++;
                    $emit(['phase' => 'meta', 'pct' => null, 'msg' => '  + trailer: ' . $vid]);
                    if ($got >= 3) break;
                }
                if ($got > 0 && empty($manifest['game']['video_url'])) {
                    $manifest['game']['video_url'] = $manifest['movies'][0]['url'];
                }
                $emit(['phase' => 'meta', 'pct' => 9, 'msg' => 'Steam movies: ' . count($manifest['movies'])]);
            } else {
                $emit(['phase' => 'meta', 'pct' => 9, 'msg' => 'Steam movies: 0 (поле movies пустое)']);
            }
        } else {
            $emit(['phase' => 'meta', 'pct' => 8, 'msg' => 'Steam API недоступен, берём только локальные данные']);
        }
    }


    $tmpRoot = sys_get_temp_dir() . '/itchio_pack_' . $gameId . '_' . bin2hex(random_bytes(4));
    $mediaDir = $tmpRoot . '/media';
    $sgdbDir = $tmpRoot . '/sgdb';
    mkdir($mediaDir . '/screenshots', 0755, true);
    mkdir($sgdbDir . '/icons', 0755, true);
    mkdir($sgdbDir . '/covers', 0755, true);
    mkdir($sgdbDir . '/heroes', 0755, true);
    mkdir($sgdbDir . '/logos', 0755, true);

    $addMedia = function (string $url, string $destRel, string $label) use ($tmpRoot, $emit): ?string {
        if (!$url) return null;
        $emit(['phase' => 'media', 'pct' => null, 'msg' => '→ ' . $label . ': ' . basename(parse_url($url, PHP_URL_PATH) ?: $url)]);
        $local = gp_resolveLocalPath($url);
        $dest = $tmpRoot . '/' . $destRel;
        if ($local) {
            $ext = pathinfo($local, PATHINFO_EXTENSION) ?: gp_extFromUrl($url, 'jpg');
            if (!str_contains(basename($destRel), '.')) $dest .= '.' . $ext;
            if (@copy($local, $dest)) {
                $emit(['phase' => 'media', 'pct' => null, 'msg' => '  OK local ' . str_replace($tmpRoot . '/', '', $dest)]);
                return str_replace($tmpRoot . '/', '', $dest);
            }
        }
        $ext = gp_extFromUrl($url, 'jpg');
        if (!str_contains(basename($destRel), '.')) $dest .= '.' . $ext;
        if (gp_download($url, $dest)) {
            $emit(['phase' => 'media', 'pct' => null, 'msg' => '  OK download ' . str_replace($tmpRoot . '/', '', $dest)]);
            return str_replace($tmpRoot . '/', '', $dest);
        }
        $emit(['phase' => 'media', 'pct' => null, 'msg' => '  SKIP (не удалось) ' . $label]);
        return null;
    };

    $gGame = $manifest['game'];
    $emit(['phase' => 'media', 'pct' => 10, 'msg' => 'Упаковка медиа…']);
    $manifest['files']['cover'] = $addMedia((string)$gGame['cover_url'], 'media/cover', 'cover');
    $emit(['phase' => 'media', 'pct' => 18, 'msg' => 'cover']);
    $manifest['files']['banner'] = $addMedia((string)$gGame['banner_url'], 'media/banner', 'banner');
    $emit(['phase' => 'media', 'pct' => 26, 'msg' => 'banner']);
    $manifest['files']['icon'] = $addMedia((string)$gGame['icon_url'], 'media/icon', 'icon');
    $emit(['phase' => 'media', 'pct' => 32, 'msg' => 'icon']);
    $manifest['files']['logo'] = $addMedia((string)$gGame['logo_url'], 'media/logo', 'logo');
    $emit(['phase' => 'media', 'pct' => 38, 'msg' => 'logo']);

    $i = 0;
    $shotTotal = max(1, count($manifest['screenshots']));
    foreach ($manifest['screenshots'] as $su) {
        $i++;
        $rel = $addMedia((string)$su, 'media/screenshots/' . sprintf('%02d', $i), 'screenshot ' . $i);
        if ($rel) $manifest['files']['screenshots'][] = $rel;
        $emit(['phase' => 'media', 'pct' => 38 + (int)round(20 * $i / $shotTotal), 'msg' => 'screenshot ' . $i . '/' . count($manifest['screenshots'])]);
    }

    
    // trailers / video
    $emit(['phase' => 'media', 'pct' => 55, 'msg' => 'Трейлеры / видео…']);
    mkdir($tmpRoot . '/media/trailers', 0755, true);
    $trailers = gp_loadTrailers($pdo, $gameId, $g);
    // ВАЖНО: сохранить movies из Steam-enrich до очистки
    $steamMoviesKeep = is_array($manifest['movies'] ?? null) ? $manifest['movies'] : [];
    $manifest['movies'] = [];
    $manifest['files']['trailers'] = [];
    $ti = 0;
    foreach ($steamMoviesKeep as $m) {
        if (!is_array($m)) continue;
        $u = (string)($m['mp4'] ?? $m['url'] ?? $m['source_url'] ?? '');
        if ($u === '') continue;
        $trailers[] = [
            'url' => $u,
            'kind' => 'trailer',
            'name' => (string)($m['name'] ?? 'Trailer'),
            'thumbnail' => (string)($m['thumbnail'] ?? ''),
        ];
    }
    $emit(['phase' => 'media', 'pct' => 56, 'msg' => 'trailer candidates: ' . count($trailers)]);
    // dedupe
    $seenTr = [];
    $trailers2 = [];
    foreach ($trailers as $tr) {
        $u = (string)($tr['url'] ?? '');
        if ($u === '' || isset($seenTr[$u])) continue;
        $seenTr[$u] = true;
        $trailers2[] = $tr;
    }
    $trailers = $trailers2;

    foreach ($trailers as $tr) {
        $ti++;
        $url = (string)($tr['url'] ?? '');
        if ($url === '') continue;
        $entry = [
            'name' => $tr['name'] ?? ('Trailer ' . $ti),
            'source_url' => $url,
            'thumbnail' => $tr['thumbnail'] ?? '',
            'file' => null,
            'thumb_file' => null,
        ];
        // Стримы (HLS/DASH/YouTube) — только ссылка. Прямые mp4/webm — пробуем скачать.
        $isStream = (bool)preg_match('/youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|\.m3u8(\?|$)|\.mpd(\?|$)|dash_|hls_/i', $url);
        if ($isStream) {
            $entry['url'] = $url;
            $entry['source_url'] = $url;
            $emit(['phase' => 'media', 'pct' => null, 'msg' => '  keep stream URL: ' . $url]);
        } else {
            $emit(['phase' => 'media', 'pct' => null, 'msg' => '  download trailer: ' . $url]);
            $rel = $addMedia($url, 'media/trailers/' . sprintf('%02d', $ti), 'trailer ' . $ti);
            if ($rel) {
                $entry['file'] = $rel;
                $entry['url'] = $rel;
                $manifest['files']['trailers'][] = $rel;
            } else {
                $entry['url'] = $url;
                $entry['source_url'] = $url;
                $emit(['phase' => 'media', 'pct' => null, 'msg' => '  download failed, keep URL: ' . $url]);
            }
        }
        $thumb = (string)($tr['thumbnail'] ?? '');
        if ($thumb) {
            $trel = $addMedia($thumb, 'media/trailers/' . sprintf('%02d', $ti) . '_thumb', 'trailer thumb ' . $ti);
            if ($trel) $entry['thumb_file'] = $trel;
        }
        $manifest['movies'][] = $entry;
        $emit(['phase' => 'media', 'pct' => 55 + min(4, $ti), 'msg' => 'trailer ' . $ti . ($entry['file'] ? ' OK' : ' URL')]);
    }
    // video_url для формы — любой доступный трейлер (ссылка или файл)
    if (!empty($g['video_url']) && empty($manifest['game']['video_url'])) {
        $manifest['game']['video_url'] = $g['video_url'];
    }
    if (empty($manifest['game']['video_url']) && !empty($manifest['movies'][0])) {
        $m0 = $manifest['movies'][0];
        $manifest['game']['video_url'] = $m0['source_url'] ?? $m0['url'] ?? $m0['mp4'] ?? $m0['file'] ?? '';
    }
    $emit(['phase' => 'media', 'pct' => 59, 'msg' => 'trailers in pack: ' . count($manifest['movies']) . ', video_url=' . (string)($manifest['game']['video_url'] ?? '')]);

$emit(['phase' => 'sgdb', 'pct' => 60, 'msg' => 'SteamGridDB…']);
    $sgdbGameId = null;
    if ($steamAppId > 0) {
        $emit(['phase' => 'sgdb', 'pct' => 62, 'msg' => 'SGDB games/steam/' . $steamAppId]);
        $gInfo = gp_sgdbRequest('games/steam/' . $steamAppId);
        $sgdbGameId = $gInfo['data']['id'] ?? null;
    }
    if (!$sgdbGameId && !empty($g['title'])) {
        $emit(['phase' => 'sgdb', 'pct' => 64, 'msg' => 'SGDB search: ' . $g['title']]);
        $search = gp_sgdbRequest('search/autocomplete/' . rawurlencode((string)$g['title']));
        $data = $search['data'] ?? [];
        if (is_array($data) && $data) $sgdbGameId = $data[0]['id'] ?? null;
    }
    if ($sgdbGameId) {
        $kinds = ['icons' => 'icons', 'covers' => 'grids', 'heroes' => 'heroes', 'logos' => 'logos'];
        $ki = 0;
        foreach ($kinds as $folder => $endpoint) {
            $ki++;
            $emit(['phase' => 'sgdb', 'pct' => 65 + $ki * 5, 'msg' => 'SGDB ' . $folder . '…']);
            $json = gp_sgdbRequest($endpoint . '/game/' . (int)$sgdbGameId . '?types=static&nsfw=any');
            $rows = $json['data'] ?? [];
            if (!is_array($rows)) continue;
            $n = 0;
            foreach ($rows as $r) {
                $url = (string)($r['url'] ?? '');
                if ($url === '') continue;
                $n++;
                $ext = gp_extFromUrl($url, 'png');
                $rel = 'sgdb/' . $folder . '/' . sprintf('%02d', $n) . '.' . $ext;
                $emit(['phase' => 'sgdb', 'pct' => null, 'msg' => '  + ' . $rel]);
                if (gp_download($url, $tmpRoot . '/' . $rel)) {
                    $manifest['files']['sgdb'][$folder][] = [
                        'file' => $rel, 'url' => $url, 'thumb' => $r['thumb'] ?? $url,
                        'width' => (int)($r['width'] ?? 0), 'height' => (int)($r['height'] ?? 0),
                        'style' => (string)($r['style'] ?? ''),
                    ];
                }
                if ($n >= 12) break;
            }
        }
        $manifest['sgdb_game_id'] = (int)$sgdbGameId;
    } else {
        $emit(['phase' => 'sgdb', 'pct' => 70, 'msg' => 'SGDB: игра не найдена, пропускаем']);
    }

    $emit(['phase' => 'zip', 'pct' => 85, 'msg' => 'Запись manifest.json…']);
    file_put_contents($tmpRoot . '/manifest.json', json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

    $token = bin2hex(random_bytes(12));
    $zipDir = __DIR__ . '/../uploads/game_packs/_export';
    if (!is_dir($zipDir)) mkdir($zipDir, 0755, true);
    $zipPath = $zipDir . '/' . $token . '.zip';

    $emit(['phase' => 'zip', 'pct' => 88, 'msg' => 'Создание ZIP…']);
    $zip = new ZipArchive();
    if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        $emit(['ok' => false, 'error' => 'Не удалось создать ZIP', 'pct' => 88]);
        if (!$stream) { http_response_code(500); echo json_encode(['ok'=>false,'error'=>'ZIP'], JSON_UNESCAPED_UNICODE); }
        exit;
    }
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($tmpRoot, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );
    $fileCount = 0;
    foreach ($it as $file) {
        $path = $file->getPathname();
        $local = substr($path, strlen($tmpRoot) + 1);
        $local = str_replace('\\', '/', $local);
        if ($file->isDir()) {
            $zip->addEmptyDir($local);
        } else {
            $zip->addFile($path, $local);
            $fileCount++;
            $emit(['phase' => 'zip', 'pct' => null, 'msg' => '  zip + ' . $local]);
        }
    }
    $zip->close();
    $emit(['phase' => 'zip', 'pct' => 96, 'msg' => 'ZIP готов, файлов: ' . $fileCount]);

    // cleanup tmp dir
    $it2 = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($tmpRoot, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($it2 as $f) {
        $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
    }
    @rmdir($tmpRoot);

    $fname = 'game-pack-' . preg_replace('/[^a-z0-9\-]+/i', '-', (string)($g['slug'] ?: $g['title'] ?: $gameId)) . '.zip';
    $emit(['phase' => 'done', 'pct' => 100, 'msg' => 'Готово', 'ok' => true, 'token' => $token, 'filename' => $fname, 'size' => filesize($zipPath)]);

    if (!$stream) {
        // direct download
        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="' . $fname . '"');
        header('Content-Length: ' . filesize($zipPath));
        readfile($zipPath);
        // keep file briefly for stream downloads; for direct can delete
        @unlink($zipPath);
    }
    exit;
}

if ($action === 'import_pack') {
    if ($method !== 'POST') {
        http_response_code(405);
        echo json_encode(['ok' => false, 'error' => 'POST'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    $user = gp_requireUser();
    if (!class_exists('ZipArchive')) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'ZipArchive не установлен'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    if (empty($_FILES['pack']) || $_FILES['pack']['error'] !== UPLOAD_ERR_OK) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Загрузите ZIP-файл пакета'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    $f = $_FILES['pack'];
    if ($f['size'] > 120 * 1024 * 1024) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'ZIP больше 120 МБ'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $token = bin2hex(random_bytes(8));
    $extractTo = __DIR__ . '/../uploads/game_packs/' . $token;
    if (!is_dir($extractTo)) mkdir($extractTo, 0755, true);

    $zip = new ZipArchive();
    if ($zip->open($f['tmp_name']) !== true) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Не удалось открыть ZIP'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    $zip->extractTo($extractTo);
    $zip->close();

    // find manifest
    $manifestPath = $extractTo . '/manifest.json';
    if (!is_file($manifestPath)) {
        // maybe nested folder
        $found = null;
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($extractTo, FilesystemIterator::SKIP_DOTS));
        foreach ($it as $file) {
            if ($file->isFile() && strtolower($file->getFilename()) === 'manifest.json') {
                $found = $file->getPathname();
                break;
            }
        }
        if (!$found) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'В архиве нет manifest.json'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $manifestPath = $found;
        $extractTo = dirname($found);
    }

    $manifest = json_decode((string)file_get_contents($manifestPath), true);
    if (!is_array($manifest)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Битый manifest.json'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $baseUrl = 'uploads/game_packs/' . $token;
    // if nested, adjust
    $relFromUploads = 'uploads/game_packs/' . $token;
    $packRoot = realpath($extractTo);
    $uploadsRoot = realpath(__DIR__ . '/../uploads/game_packs/' . $token);
    if ($packRoot && $uploadsRoot && str_starts_with($packRoot, $uploadsRoot) && $packRoot !== $uploadsRoot) {
        $extra = trim(str_replace($uploadsRoot, '', $packRoot), DIRECTORY_SEPARATOR);
        $baseUrl = 'uploads/game_packs/' . $token . '/' . str_replace(DIRECTORY_SEPARATOR, '/', $extra);
    }

    $mapFile = function (?string $rel) use ($extractTo, $baseUrl): ?string {
        if (!$rel) return null;
        $rel = ltrim(str_replace('\\', '/', $rel), '/');
        $full = $extractTo . '/' . $rel;
        if (!is_file($full)) return null;
        return $baseUrl . '/' . $rel;
    };

    $files = $manifest['files'] ?? [];
    $game = $manifest['game'] ?? [];
    $outFiles = [
        'cover' => $mapFile($files['cover'] ?? null),
        'banner' => $mapFile($files['banner'] ?? null),
        'icon' => $mapFile($files['icon'] ?? null),
        'logo' => $mapFile($files['logo'] ?? null),
        'screenshots' => [],
        'trailers' => [],
        'sgdb' => ['icons' => [], 'covers' => [], 'heroes' => [], 'logos' => []],
    ];
    foreach (($files['screenshots'] ?? []) as $s) {
        $u = $mapFile(is_array($s) ? ($s['file'] ?? null) : $s);
        if ($u) $outFiles['screenshots'][] = $u;
    }
    foreach (($files['trailers'] ?? []) as $s) {
        $u = $mapFile(is_array($s) ? ($s['file'] ?? null) : $s);
        if ($u) $outFiles['trailers'][] = $u;
    }
    // movies from manifest with local files remapped
    $moviesOut = [];
    foreach (($manifest['movies'] ?? []) as $m) {
        if (!is_array($m)) continue;
        $item = $m;
        if (!empty($m['file'])) {
            $lu = $mapFile($m['file']);
            if ($lu) { $item['file'] = $lu; $item['url'] = $lu; }
        }
        if (!empty($m['thumb_file'])) {
            $tu = $mapFile($m['thumb_file']);
            if ($tu) $item['thumbnail'] = $tu;
        }
        if (empty($item['url']) && !empty($m['source_url'])) $item['url'] = $m['source_url'];
        $moviesOut[] = $item;
    }

    // --- Постоянная директория CATioGridDB (как covers живут в uploads, не в памяти) ---
    $steamAppId = (int)($manifest['steam_appid'] ?? $game['steam_appid'] ?? 0);
    $gridKey = $steamAppId > 0 ? ('s' . $steamAppId) : ('p' . $token);
    $gridRel = 'uploads/catiogrid/' . $gridKey;
    $gridAbs = dirname(__DIR__) . '/' . $gridRel;
    foreach (['icons', 'logos', 'covers', 'heroes', 'media'] as $sub) {
        $d = $gridAbs . '/' . $sub;
        if (!is_dir($d)) @mkdir($d, 0755, true);
    }

    $copyToGrid = function (string $srcFull, string $sub, string $name) use ($gridAbs, $gridRel): ?string {
        if (!is_file($srcFull)) return null;
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION) ?: pathinfo($srcFull, PATHINFO_EXTENSION) ?: 'png');
        if ($ext === 'jpeg') $ext = 'jpg';
        $safe = preg_replace('/[^a-zA-Z0-9._-]+/', '_', pathinfo($name, PATHINFO_FILENAME)) ?: 'file';
        $destName = $safe . '.' . $ext;
        $destFull = $gridAbs . '/' . $sub . '/' . $destName;
        // уникальное имя если занято другим содержимым
        if (is_file($destFull) && @md5_file($destFull) !== @md5_file($srcFull)) {
            $destName = $safe . '_' . substr(md5($srcFull . microtime()), 0, 6) . '.' . $ext;
            $destFull = $gridAbs . '/' . $sub . '/' . $destName;
        }
        if (!is_file($destFull)) {
            if (!@copy($srcFull, $destFull)) return null;
        }
        return $gridRel . '/' . $sub . '/' . $destName;
    };

    // основные media → catiogrid/.../media/
    foreach (['cover' => 'cover', 'banner' => 'banner', 'icon' => 'icon', 'logo' => 'logo'] as $fk => $baseName) {
        $rel = $files[$fk] ?? null;
        if (!$rel) continue;
        $rel = ltrim(str_replace('\\', '/', (string)$rel), '/');
        $src = $extractTo . '/' . $rel;
        $copied = $copyToGrid($src, 'media', $baseName . '.' . (pathinfo($rel, PATHINFO_EXTENSION) ?: 'jpg'));
        if ($copied) $outFiles[$fk] = $copied;
        elseif (!$outFiles[$fk]) $outFiles[$fk] = $mapFile($rel);
    }

    // sgdb/* → catiogrid/.../{icons,logos,covers,heroes}/
    foreach (['icons', 'covers', 'heroes', 'logos'] as $k) {
        $n = 0;
        foreach (($files['sgdb'][$k] ?? []) as $item) {
            $rel = is_array($item) ? ($item['file'] ?? '') : $item;
            $rel = ltrim(str_replace('\\', '/', (string)$rel), '/');
            if ($rel === '') continue;
            $src = $extractTo . '/' . $rel;
            $n++;
            $name = sprintf('%02d', $n) . '.' . (pathinfo($rel, PATHINFO_EXTENSION) ?: 'png');
            $copied = $copyToGrid($src, $k, $name);
            if (!$copied) {
                // fallback: temp pack url
                $copied = $mapFile($rel);
            }
            if (!$copied) continue;
            $thumb = $copied;
            // для .ico превью — remote thumb из манифеста если есть
            if (preg_match('/\.ico$/i', $copied) && is_array($item) && !empty($item['thumb']) && preg_match('#^https?://#i', (string)$item['thumb'])) {
                $thumb = (string)$item['thumb'];
            }
            $outFiles['sgdb'][$k][] = [
                'file' => $copied,
                'url' => $copied,
                'thumb' => $thumb,
                'width' => (int)(is_array($item) ? ($item['width'] ?? 0) : 0),
                'height' => (int)(is_array($item) ? ($item['height'] ?? 0) : 0),
            ];
        }
    }

    // дефолт icon/logo если пусто
    if (empty($outFiles['icon']) && !empty($outFiles['sgdb']['icons'])) {
        foreach ($outFiles['sgdb']['icons'] as $ic) {
            $u = (string)($ic['url'] ?? '');
            if ($u && !preg_match('/\.ico$/i', $u)) { $outFiles['icon'] = $u; break; }
        }
        if (empty($outFiles['icon'])) $outFiles['icon'] = (string)($outFiles['sgdb']['icons'][0]['url'] ?? '') ?: null;
    }
    if (empty($outFiles['logo']) && !empty($outFiles['sgdb']['logos'])) {
        $outFiles['logo'] = (string)($outFiles['sgdb']['logos'][0]['url'] ?? '') ?: null;
    }

    // fallbacks from game urls if files missing
    if (!$outFiles['cover'] && !empty($game['cover_url'])) $outFiles['cover'] = $game['cover_url'];
    if (!$outFiles['banner'] && !empty($game['banner_url'])) $outFiles['banner'] = $game['banner_url'];

    // нормализация для формы публикации (даже старые ZIP)
    $game['sys_req_min'] = gp_normalizeSysReq($game['sys_req_min'] ?? null);
    $game['sys_req_rec'] = gp_normalizeSysReq($game['sys_req_rec'] ?? null);
    $game['languages'] = gp_normalizeLanguages($game['languages'] ?? null);
    $game['controllers'] = gp_normalizeControllers($game['controllers'] ?? '');

    echo json_encode([
        'ok' => true,
        'pack_token' => $token,
        'grid_key' => $gridKey,
        'grid_path' => $gridRel,
        'manifest' => $manifest,
        'game' => $game,
        'files' => $outFiles,
        'steam_appid' => $manifest['steam_appid'] ?? $steamAppId ?? null,
        'sgdb_game_id' => $manifest['sgdb_game_id'] ?? null,
        'movies' => $moviesOut ?? ($manifest['movies'] ?? []),
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ---------- SGDB BY NAME (non-steam) ----------
header('Content-Type: application/json; charset=utf-8');
if ($action === 'sgdb_by_name') {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'Онлайн SteamGridDB отключён. Используйте ZIP-пакет.', 'assets' => [], 'results' => []], JSON_UNESCAPED_UNICODE);
    exit;
}




if ($action === 'export_download') {
    gp_requireAdmin();
    $token = preg_replace('/[^a-f0-9]/', '', (string)($_GET['token'] ?? ''));
    if (strlen($token) < 16) {
        http_response_code(400);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => false, 'error' => 'token'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    $zipPath = __DIR__ . '/../uploads/game_packs/_export/' . $token . '.zip';
    if (!is_file($zipPath)) {
        http_response_code(404);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => false, 'error' => 'Файл не найден или истёк'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    $fname = trim((string)($_GET['filename'] ?? ('game-pack-' . $token . '.zip')));
    $fname = preg_replace('/[^a-zA-Z0-9._\-]+/', '_', $fname) ?: 'game-pack.zip';
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . $fname . '"');
    header('Content-Length: ' . filesize($zipPath));
    readfile($zipPath);
    @unlink($zipPath);
    exit;
}

http_response_code(400);

// Локальные ассеты, сохранённые при импорте игры в uploads/games/{icons,logos,...}.
// Возвращаем список файлов из общих каталогов проекта, а не только URL из записи games.
if ($action === 'list_game_assets') {
    gp_requireAdmin();
    $type = strtolower(trim((string)($_GET['type'] ?? '')));
    $allowedTypes = ['icons', 'logos', 'banners', 'covers', 'shots', 'videos'];
    if (!in_array($type, $allowedTypes, true)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Недопустимый тип ассетов'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    $gameId = (int)($_GET['game_id'] ?? 0);
    if (($type === 'icons' || $type === 'logos') && $gameId < 1) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Для списка иконок и логотипов требуется game_id'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    $baseRel = 'uploads/games/' . $type;
    $baseAbs = dirname(__DIR__) . '/' . $baseRel;
    $out = [];
    $requiredPrefix = $gameId > 0 ? 'g' . $gameId . '_' : '';
    $extOk = $type === 'videos' ? ['mp4', 'webm', 'mov'] : ['png', 'jpg', 'jpeg', 'webp', 'gif', 'ico', 'svg'];
    if (is_dir($baseAbs) && is_readable($baseAbs)) {
        $files = scandir($baseAbs) ?: [];
        sort($files, SORT_NATURAL | SORT_FLAG_CASE);
        foreach ($files as $file) {
            if ($file === '.' || $file === '..') continue;
            if ($requiredPrefix !== '' && strncasecmp($file, $requiredPrefix, strlen($requiredPrefix)) !== 0) continue;
            $full = $baseAbs . DIRECTORY_SEPARATOR . $file;
            if (!is_file($full)) continue;
            $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
            if (!in_array($ext, $extOk, true)) continue;
            $url = $baseRel . '/' . rawurlencode($file);
            $out[] = ['url' => $url, 'thumb' => $url, 'file' => $file];
        }
    }
    echo json_encode(['ok' => true, 'type' => $type, 'assets' => $out, 'count' => count($out)], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($action === 'list_catiogrid') {
    gp_requireUser();
    $appid = (int)($_GET['appid'] ?? $_GET['steam_appid'] ?? 0);
    $key = trim((string)($_GET['key'] ?? ''));
    if ($key === '' && $appid > 0) $key = 's' . $appid;
    if ($key === '') {
        echo json_encode(['ok' => false, 'error' => 'appid или key'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    $key = preg_replace('/[^a-zA-Z0-9_-]/', '', $key);
    $baseRel = 'uploads/catiogrid/' . $key;
    $baseAbs = dirname(__DIR__) . '/' . $baseRel;
    $out = ['icons' => [], 'logos' => [], 'covers' => [], 'heroes' => [], 'media' => []];
    if (!is_dir($baseAbs)) {
        echo json_encode(['ok' => true, 'key' => $key, 'path' => $baseRel, 'assets' => $out, 'count' => 0], JSON_UNESCAPED_UNICODE);
        exit;
    }
    $extOk = ['png','jpg','jpeg','webp','gif','ico'];
    foreach (array_keys($out) as $sub) {
        $dir = $baseAbs . '/' . $sub;
        if (!is_dir($dir)) continue;
        $files = scandir($dir);
        if (!$files) continue;
        sort($files);
        foreach ($files as $f) {
            if ($f === '.' || $f === '..') continue;
            $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
            if (!in_array($ext, $extOk, true)) continue;
            $url = $baseRel . '/' . $sub . '/' . $f;
            $thumb = $url;
            // ico — для превью лучше соседний png с тем же номером если есть
            if ($ext === 'ico') {
                $stem = pathinfo($f, PATHINFO_FILENAME);
                foreach (['png','webp','jpg'] as $ae) {
                    if (is_file($dir . '/' . $stem . '.' . $ae)) { $thumb = $baseRel . '/' . $sub . '/' . $stem . '.' . $ae; break; }
                }
            }
            $out[$sub][] = ['url' => $url, 'thumb' => $thumb, 'file' => $url];
        }
    }
    $count = 0;
    foreach ($out as $arr) $count += count($arr);
    echo json_encode(['ok' => true, 'key' => $key, 'path' => $baseRel, 'assets' => $out, 'count' => $count], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode([
    'ok' => false,
    'error' => 'Unknown action',
    'available' => ['export', 'import_pack', 'sgdb_by_name', 'list_catiogrid', 'list_game_assets'],
], JSON_UNESCAPED_UNICODE);
