<?php
// CATio — загрузка игр пользователями + модерация админом
require_once __DIR__ . '/../auth.php';
header('Content-Type: application/json; charset=utf-8');

set_exception_handler(function ($e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
    exit;
});


function ensure_game_builds_table(PDO $pdo): void {
    static $done = false;
    if ($done) return;
    $done = true;
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS game_builds (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            game_id INT UNSIGNED NOT NULL,
            platform VARCHAR(32) NOT NULL DEFAULT 'windows',
            version VARCHAR(64) NOT NULL DEFAULT '1.0',
            changelog TEXT NULL,
            file_url VARCHAR(512) NOT NULL DEFAULT '',
            file_name VARCHAR(255) NOT NULL DEFAULT '',
            file_size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
            status VARCHAR(16) NOT NULL DEFAULT 'published',
            submitted_by INT UNSIGNED NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_game (game_id),
            INDEX idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    } catch (Throwable $e) {}
    // migrate older tables
    try { $pdo->exec("ALTER TABLE game_builds ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'published'"); } catch (Throwable $e) {}
    try { $pdo->exec("ALTER TABLE game_builds ADD COLUMN submitted_by INT UNSIGNED NULL"); } catch (Throwable $e) {}
    try { $pdo->exec("ALTER TABLE game_builds ADD COLUMN changelog TEXT NULL"); } catch (Throwable $e) {}
    try { $pdo->exec("ALTER TABLE game_builds ADD COLUMN file_name VARCHAR(255) NOT NULL DEFAULT ''"); } catch (Throwable $e) {}
}

function save_builds_from_request(PDO $pdo, int $gameId): void {
    ensure_game_builds_table($pdo);
    $metaRaw = trim((string)($_POST['builds_meta'] ?? ''));
    $meta = [];
    if ($metaRaw !== '') {
        $j = json_decode($metaRaw, true);
        if (is_array($j)) $meta = $j;
    }
    $root = dirname(__DIR__) . '/uploads/games/builds/' . $gameId;
    if (!is_dir($root)) @mkdir($root, 0755, true);

    // PHP: builds[0] → $_FILES['builds'][name][0]  ИЛИ  builds_0
    $filesBag = [];
    if (!empty($_FILES['builds']) && is_array($_FILES['builds']['name'] ?? null)) {
        foreach ($_FILES['builds']['name'] as $k => $name) {
            if (($_FILES['builds']['error'][$k] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) continue;
            if (!is_uploaded_file($_FILES['builds']['tmp_name'][$k] ?? '')) continue;
            $filesBag[(string)$k] = [
                'name' => $name,
                'tmp_name' => $_FILES['builds']['tmp_name'][$k],
                'size' => (int)($_FILES['builds']['size'][$k] ?? 0),
                'error' => (int)$_FILES['builds']['error'][$k],
            ];
        }
    }
    foreach ($_FILES as $key => $f) {
        if (!is_array($f) || !isset($f['tmp_name'])) continue;
        if (preg_match('/^builds_(\d+)$/', $key, $m) || preg_match('/^builds\[(\d+)\]$/', $key, $m)) {
            if (($f['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK && is_uploaded_file($f['tmp_name'])) {
                $filesBag[$m[1]] = $f;
            }
        }
    }

    // одиночный файл name=build_file
    if (!$filesBag && !empty($_FILES['build_file']) && ($_FILES['build_file']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
        $filesBag['0'] = $_FILES['build_file'];
    }
    // версия/changelog из простых POST полей
    if ($meta === [] && $filesBag) {
        $meta[] = [
            'i' => '0',
            'version' => trim((string)($_POST['build_version'] ?? '1.0')) ?: '1.0',
            'platform' => 'windows',
            'changelog' => trim((string)($_POST['build_changelog'] ?? '')),
            'has_file' => true,
        ];
    }

    // если meta пустая, но файлы есть — собрать meta из ключей файлов
    if (!$meta && $filesBag) {
        foreach ($filesBag as $idx => $f) {
            $meta[] = ['i' => $idx, 'version' => '1.0', 'platform' => 'windows', 'changelog' => '', 'has_file' => true];
        }
    }

    $status = !empty($GLOBALS['__build_status_override'])
        ? (string)$GLOBALS['__build_status_override']
        : 'pending';
    $uid = isset($GLOBALS['__build_submitted_by']) ? (int)$GLOBALS['__build_submitted_by'] : null;
    try {
        $u = getCurrentUser();
        if ($u && $uid === null) $uid = (int)$u['id'];
    } catch (Throwable $e) {}

    $ins = $pdo->prepare("INSERT INTO game_builds (game_id, platform, version, changelog, file_url, file_name, file_size_bytes, status, submitted_by) VALUES (?,?,?,?,?,?,?,?,?)");
    foreach ($meta as $i => $item) {
        if (!is_array($item)) continue;
        $idx = (string)($item['i'] ?? $item['idx'] ?? $i);
        $version = trim((string)($item['version'] ?? '1.0')) ?: '1.0';
        $platform = trim((string)($item['platform'] ?? 'windows')) ?: 'windows';
        $changelog = trim((string)($item['changelog'] ?? ''));
        $existingId = (int)($item['id'] ?? 0);
        // already on server — skip re-upload
        if ($existingId > 0 && empty($item['has_file']) && empty($filesBag[$idx])) continue;

        $file = $filesBag[$idx] ?? null;
        if (!$file) {
            // fallback: первый неиспользованный файл
            if ($filesBag) {
                $file = array_shift($filesBag);
            } else {
                continue;
            }
        } else {
            unset($filesBag[$idx]);
        }
        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        if ($ext === '') $ext = 'bin';
        $safe = bin2hex(random_bytes(8)) . '.' . preg_replace('/[^a-z0-9]+/i', '', $ext);
        $dest = $root . '/' . $safe;
        if (!@move_uploaded_file($file['tmp_name'], $dest)) {
            // иногда tmp уже перемещён — пробуем copy
            if (!@copy($file['tmp_name'], $dest)) continue;
        }
        $rel = 'uploads/games/builds/' . $gameId . '/' . $safe;
        $ins->execute([
            $gameId, $platform, $version, $changelog,
            $rel, $file['name'], (int)($file['size'] ?? filesize($dest) ?: 0),
            $status, $uid
        ]);
    }
}


$pdo = getDB();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

function normalize_video_urls_field(string $raw): string {
    $raw = trim($raw);
    if ($raw === '') return '';
    $list = [];
    if ($raw[0] === '[') {
        $j = json_decode($raw, true);
        if (is_array($j)) {
            foreach ($j as $item) {
                if (is_string($item) && trim($item) !== '') $list[] = trim($item);
                elseif (is_array($item)) {
                    $u = trim((string)($item['url'] ?? $item['src'] ?? $item['mp4'] ?? ''));
                    if ($u !== '') $list[] = $u;
                }
            }
        }
    } else {
        foreach (preg_split('/\r\n|\r|\n+/', $raw) ?: [] as $line) {
            $line = trim($line);
            if ($line !== '') $list[] = $line;
        }
        // also allow comma-separated plain urls
        if (count($list) === 1 && str_contains($list[0], ',') && !str_contains($list[0], 'http')) {
            // keep as is
        } elseif (count($list) === 1 && substr_count($list[0], 'http') > 1) {
            $parts = preg_split('/\s+/', $list[0]) ?: [];
            $list = array_values(array_filter(array_map('trim', $parts)));
        }
    }
    $list = array_values(array_unique($list));
    if (!$list) return '';
    if (count($list) === 1) return $list[0];
    return json_encode($list, JSON_UNESCAPED_UNICODE);
}

function insert_trailer_media(PDO $pdo, int $gameId, string $videoField): void {
    $raw = trim($videoField);
    if ($raw === '') return;
    $list = [];
    if ($raw[0] === '[') {
        $j = json_decode($raw, true);
        if (is_array($j)) {
            foreach ($j as $item) {
                if (is_string($item) && trim($item) !== '') $list[] = trim($item);
                elseif (is_array($item)) {
                    $u = trim((string)($item['url'] ?? $item['src'] ?? ''));
                    if ($u !== '') $list[] = $u;
                }
            }
        }
    } else {
        $list = [$raw];
    }
    $list = array_values(array_unique(array_filter($list)));
    try {
        $pdo->prepare("DELETE FROM game_media WHERE game_id = ? AND kind IN ('trailer','video','movie')")->execute([$gameId]);
    } catch (Throwable $e) {}
    $order = 0;
    foreach ($list as $u) {
        try {
            $pdo->prepare("INSERT INTO game_media (game_id, kind, url, sort_order) VALUES (?, 'trailer', ?, ?)")
                ->execute([$gameId, $u, $order++]);
        } catch (Throwable $e) {
            try {
                $pdo->prepare("INSERT INTO game_media (game_id, kind, url) VALUES (?, 'trailer', ?)")
                    ->execute([$gameId, $u]);
            } catch (Throwable $e2) {}
        }
    }
}


function jsonBodyS(): array {
    $b = json_decode(file_get_contents('php://input'), true);
    return is_array($b) ? $b : $_POST;
}
function requireUserS(): array {
    $u = getCurrentUser();
    if (!$u) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'Нужно войти'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    return $u;
}
function requireAdminS(): array {
    $u = requireUserS();
    if (($u['role'] ?? '') !== 'admin') {
        http_response_code(403);
        echo json_encode(['ok' => false, 'error' => 'Только для админов'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    return $u;
}
function slugify(string $s): string {
    $s = mb_strtolower($s);
    $s = preg_replace('/[^a-z0-9а-яё]+/ui', '-', $s);
    $s = trim($s, '-');
    return $s !== '' ? $s : ('game-' . time());
}
function saveUpload(string $field, string $dir, array $allowed, int $maxMb = 8): ?string {
    if (empty($_FILES[$field]) || $_FILES[$field]['error'] !== UPLOAD_ERR_OK) return null;
    $f = $_FILES[$field];
    if ($f['size'] > $maxMb * 1024 * 1024) throw new RuntimeException("Файл $field больше {$maxMb} МБ");
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = $finfo->file($f['tmp_name']);
    if (!isset($allowed[$mime])) throw new RuntimeException("Недопустимый тип $field");
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $name = uniqid('g_', true) . '.' . $allowed[$mime];
    if (!move_uploaded_file($f['tmp_name'], $dir . '/' . $name)) throw new RuntimeException('Не удалось сохранить файл');
    return 'uploads/games/' . basename($dir) . '/' . $name;
}

$imgAllowed = ['image/jpeg'=>'jpg','image/png'=>'png','image/webp'=>'webp','image/gif'=>'gif'];

try {
    switch ($action) {

        // ===== ОТПРАВИТЬ НА МОДЕРАЦИЮ =====
        case 'submit':
            if ($method !== 'POST') { http_response_code(405); echo json_encode(['ok'=>false]); break; }
            $user = requireUserS();
            if (!verifyCsrfToken($_POST['csrf_token'] ?? '')) {
                http_response_code(403);
                echo json_encode(['ok'=>false,'error'=>'CSRF'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $title = trim($_POST['title'] ?? '');
            $desc = trim($_POST['description'] ?? '');
            $short = trim($_POST['short_description'] ?? '');
            $genre = trim($_POST['genre'] ?? '');
            $tags = trim($_POST['tags'] ?? '');
            if (mb_strlen($genre) > 255) $genre = mb_substr($genre, 0, 255);
            if (mb_strlen($tags) > 512) $tags = mb_substr($tags, 0, 512);
            $publisherId = (int)($_POST['publisher_id'] ?? 0);
            if ($publisherId > 0) {
                // только если пользователь — участник
                $chk = $pdo->prepare("SELECT publisher_id FROM publisher_members WHERE publisher_id=? AND user_id=?");
                $chk->execute([$publisherId, (int)$user['id']]);
                if (!$chk->fetch()) $publisherId = 0;
            }
            // издательство опционально — можно публиковать только с разработчиком
            $video = normalize_video_urls_field(trim((string)($_POST['video_url'] ?? '')));
            $sysMin = trim($_POST['sys_req_min'] ?? '');
            $sysRec = trim($_POST['sys_req_rec'] ?? '');
            $controllers = trim($_POST['controllers'] ?? ''); // comma: xbox,playstation
            $languages = trim($_POST['languages'] ?? '');
            $price = (float)($_POST['price'] ?? 0);
            $isAdult = !empty($_POST['is_adult']) ? 1 : 0;
            $developerIn = trim($_POST['developer'] ?? '');
            $publisherIn = trim($_POST['publisher'] ?? '');
            $devName = $developerIn !== '' ? $developerIn : ($publisherIn !== '' ? $publisherIn : $user['username']);
            if ($publisherId > 0) {
                $pn = $pdo->prepare("SELECT name FROM publishers WHERE id = ?");
                $pn->execute([$publisherId]);
                $prow = $pn->fetch();
                if ($prow && $publisherIn === '') {
                    // если выбрано издательство и имя не задано отдельно — можно подставить
                }
            }
            $developerCol = $developerIn !== '' ? $developerIn : $user['username'];

            if ($title === '' || mb_strlen($title) > 120) {
                http_response_code(400);
                echo json_encode(['ok'=>false,'error'=>'Название: 1–120 символов'], JSON_UNESCAPED_UNICODE);
                break;
            }
            if ($desc === '') {
                http_response_code(400);
                echo json_encode(['ok'=>false,'error'=>'Нужно описание'], JSON_UNESCAPED_UNICODE);
                break;
            }
            if ($genre === '') {
                http_response_code(400);
                echo json_encode(['ok'=>false,'error'=>'Укажите жанр'], JSON_UNESCAPED_UNICODE);
                break;
            }

            $base = dirname(__DIR__) . '/uploads/games';
            $coverDir = $base . '/covers';
            $bannerDir = $base . '/banners';
            $shotDir = $base . '/shots';

            $coverUrl = null;
            try { $coverUrl = saveUpload('cover', $coverDir, $imgAllowed, 5); } catch (Throwable $e) {}
            // импорт пакета: обложка уже лежит в uploads/game_packs/...
            if (!$coverUrl) {
                $cu = trim((string)($_POST['cover_url'] ?? ''));
                if ($cu !== '' && (str_starts_with($cu, 'uploads/') || str_starts_with($cu, '/uploads/'))) {
                    $coverUrl = ltrim($cu, '/');
                }
            }
            if (!$coverUrl) {
                http_response_code(400);
                echo json_encode(['ok'=>false,'error'=>'Нужна обложка'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $bannerUrl = null;
            try { $bannerUrl = saveUpload('banner', $bannerDir, $imgAllowed, 8); } catch (Throwable $e) {}
            if (!$bannerUrl) {
                $bu = trim((string)($_POST['banner_url'] ?? ''));
                if ($bu !== '' && (str_starts_with($bu, 'uploads/') || str_starts_with($bu, '/uploads/'))) {
                    $bannerUrl = ltrim($bu, '/');
                }
            }
            $logoDir = $base . '/logos';
            $iconDir = $base . '/icons';
            if (!is_dir($logoDir)) @mkdir($logoDir, 0755, true);
            if (!is_dir($iconDir)) @mkdir($iconDir, 0755, true);
            $logoUrl = null;
            try { $logoUrl = saveUpload('logo', $logoDir, $imgAllowed, 4); } catch (Throwable $e) {}
            if (!$logoUrl) {
                $lu = trim((string)($_POST['logo_url'] ?? ''));
                $lu = str_replace('\\', '/', trim($lu));
                if ($lu !== '' && (str_starts_with(ltrim($lu, '/'), 'uploads/') || preg_match('#^https?://#i', $lu))) {
                    if (preg_match('#^https?://#i', $lu)) {
                        $bin = @file_get_contents($lu);
                        if ($bin && strlen($bin) > 200) {
                            $ext = 'png';
                            if (preg_match('/\.(jpe?g|png|webp|gif)(\?|$)/i', $lu, $m)) $ext = strtolower($m[1]) === 'jpeg' ? 'jpg' : strtolower($m[1]);
                            $name = 'logo_' . bin2hex(random_bytes(4)) . '.' . $ext;
                            if (@file_put_contents($logoDir . '/' . $name, $bin)) {
                                $logoUrl = 'uploads/games/logos/' . $name;
                            }
                        }
                    } else {
                        $logoUrl = ltrim($lu, '/');
                    }
                }
            }
            $iconUrl = null;
            try { $iconUrl = saveUpload('icon', $iconDir, $imgAllowed, 3); } catch (Throwable $e) {}
            if (!$iconUrl) {
                $iu = trim((string)($_POST['icon_url'] ?? ''));
                $iu = str_replace('\\', '/', trim($iu));
                if ($iu !== '' && (str_starts_with(ltrim($iu, '/'), 'uploads/') || preg_match('#^https?://#i', $iu))) {
                    if (preg_match('#^https?://#i', $iu)) {
                        $bin = @file_get_contents($iu);
                        if ($bin && strlen($bin) > 200) {
                            $ext = 'png';
                            if (preg_match('/\.(jpe?g|png|webp|gif)(\?|$)/i', $iu, $m)) $ext = strtolower($m[1]) === 'jpeg' ? 'jpg' : strtolower($m[1]);
                            $name = 'icon_' . bin2hex(random_bytes(4)) . '.' . $ext;
                            if (@file_put_contents($iconDir . '/' . $name, $bin)) {
                                $iconUrl = 'uploads/games/icons/' . $name;
                            }
                        }
                    } else {
                        $iconUrl = ltrim($iu, '/');
                    }
                }
            }

            $slug = slugify($title) . '-' . substr(uniqid(), -4);
            $stmt = $pdo->prepare("
                INSERT INTO games
                  (title, slug, short_description, description, developer, developer_name, price, genre, tags,
                   cover_url, banner_url, logo_url, icon_url, video_url, sys_req_min, sys_req_rec, controllers, languages,
                   status, is_published, submitted_by, is_adult, publisher_id)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',0,?,?,?)
            ");
            $stmt->execute([
                $title, $slug, $short ?: mb_substr($desc, 0, 200), $desc,
                $developerCol, $devName, $price, $genre, $tags,
                $coverUrl, $bannerUrl, $logoUrl, $iconUrl, $video, $sysMin, $sysRec, $controllers, $languages,
                (int)$user['id'], $isAdult, $publisherId ?: null,
            ]);
            $gameId = (int)$pdo->lastInsertId();
            insert_trailer_media($pdo, $gameId, $video);
            try { save_builds_from_request($pdo, (int)$gameId); } catch (Throwable $e) {}
            // обязательна хотя бы одна сборка
            try {
                $bc = $pdo->prepare("SELECT COUNT(*) FROM game_builds WHERE game_id = ?");
                $bc->execute([$gameId]);
                if ((int)$bc->fetchColumn() < 1) {
                    $pdo->prepare("DELETE FROM games WHERE id = ?")->execute([$gameId]);
                    http_response_code(400);
                    echo json_encode(['ok' => false, 'error' => 'Прикрепите файл сборки и укажите версию'], JSON_UNESCAPED_UNICODE);
                    break;
                }
            } catch (Throwable $e) {}
            // обязательна хотя бы одна сборка
            try {
                $bc = $pdo->prepare("SELECT COUNT(*) FROM game_builds WHERE game_id = ?");
                $bc->execute([$gameId]);
                if ((int)$bc->fetchColumn() < 1) {
                    $pdo->prepare("DELETE FROM games WHERE id = ?")->execute([$gameId]);
                    http_response_code(400);
                    echo json_encode(['ok' => false, 'error' => 'Прикрепите файл сборки и укажите версию'], JSON_UNESCAPED_UNICODE);
                    break;
                }
            } catch (Throwable $e) {}

            // trailers from pack (local uploads paths)
            $trailerUrls = trim((string)($_POST['trailer_urls'] ?? ''));
            if ($trailerUrls !== '') {
                $order = 0;
                $trailDir = $base . '/trailers';
                if (!is_dir($trailDir)) @mkdir($trailDir, 0755, true);
                foreach (preg_split('/\r\n|\r|\n/', $trailerUrls) as $su) {
                    $su = trim($su);
                    if ($su === '') continue;
                    $su = ltrim($su, '/');
                    if (!str_starts_with($su, 'uploads/')) continue;
                    $src = dirname(__DIR__) . '/' . $su;
                    if (!is_file($src)) {
                        $alt = __DIR__ . '/../' . $su;
                        if (is_file($alt)) $src = $alt;
                    }
                    $finalUrl = $su;
                    if (is_file($src)) {
                        $ext = strtolower(pathinfo($src, PATHINFO_EXTENSION) ?: 'mp4');
                        $name = uniqid('trail_', true) . '.' . $ext;
                        if (@copy($src, $trailDir . '/' . $name)) {
                            $finalUrl = 'uploads/games/trailers/' . $name;
                        }
                    }
                    try {
                        $pdo->prepare("INSERT INTO game_media (game_id, kind, url, sort_order) VALUES (?,?,?,?)")
                            ->execute([$gameId, 'trailer', $finalUrl, $order++]);
                    } catch (Throwable $e) {}
                    // если video_url пуст — ставим первый трейлер
                    if ($order === 1) {
                        try {
                            $pdo->prepare("UPDATE games SET video_url = COALESCE(NULLIF(video_url,''), ?) WHERE id = ?")
                                ->execute([$finalUrl, $gameId]);
                        } catch (Throwable $e) {}
                    }
                }
            }
            // screenshots from pack (urls) — копируем в постоянную папку
            $shotUrls = trim((string)($_POST['screenshot_urls'] ?? ''));
            if ($shotUrls !== '') {
                $order = 0;
                if (!is_dir($shotDir)) @mkdir($shotDir, 0755, true);
                foreach (preg_split('/\r\n|\r|\n/', $shotUrls) as $su) {
                    $su = trim($su);
                    if ($su === '') continue;
                    $su = ltrim($su, '/');
                    if (!str_starts_with($su, 'uploads/')) continue;
                    $src = dirname(__DIR__) . '/' . $su;
                    if (!is_file($src)) {
                        $alt = __DIR__ . '/../' . $su;
                        if (is_file($alt)) $src = $alt;
                    }
                    if (!is_file($src)) {
                        // не сохраняем битую ссылку без файла
                        continue;
                    }
                    $ext = strtolower(pathinfo($src, PATHINFO_EXTENSION) ?: 'jpg');
                    if (!in_array($ext, ['jpg','jpeg','png','webp','gif'], true)) continue;
                    $name = uniqid('pack_', true) . '.' . $ext;
                    $dest = $shotDir . '/' . $name;
                    if (!@copy($src, $dest)) continue;
                    $finalUrl = 'uploads/games/shots/' . $name;
                    try {
                        $pdo->prepare("INSERT INTO game_media (game_id, kind, url, sort_order) VALUES (?,?,?,?)")
                            ->execute([$gameId, 'screenshot', $finalUrl, $order]);
                    } catch (Throwable $e) {}
                    try {
                        $pdo->prepare("INSERT INTO game_screenshots (game_id, image_url, sort) VALUES (?,?,?)")
                            ->execute([$gameId, $finalUrl, $order]);
                    } catch (Throwable $e2) {}
                    $order++;
                    if ($order >= 12) break;
                }
            }
            // screenshots[]
            if (!empty($_FILES['screenshots'])) {
                $files = $_FILES['screenshots'];
                $count = is_array($files['name']) ? count($files['name']) : 0;
                $order = 0;
                for ($i = 0; $i < $count && $order < 10; $i++) {
                    if ($files['error'][$i] !== UPLOAD_ERR_OK) continue;
                    $tmp = [
                        'name' => $files['name'][$i],
                        'type' => $files['type'][$i],
                        'tmp_name' => $files['tmp_name'][$i],
                        'error' => $files['error'][$i],
                        'size' => $files['size'][$i],
                    ];
                    // reuse save via temp $_FILES
                    $_FILES['_shot'] = $tmp;
                    try {
                        $url = saveUpload('_shot', $shotDir, $imgAllowed, 6);
                        if ($url) {
                            $pdo->prepare("INSERT INTO game_media (game_id, kind, url, sort_order) VALUES (?,?,?,?)")
                                ->execute([$gameId, 'screenshot', $url, $order++]);
                        }
                    } catch (Throwable $e) {}
                }
            }

            // notify admins
            try {
                $admins = $pdo->query("SELECT id FROM users WHERE role = 'admin'")->fetchAll();
                foreach ($admins as $a) {
                    $pdo->prepare("INSERT INTO notifications (user_id, type, title, body, meta_json) VALUES (?,?,?,?,?)")
                        ->execute([
                            (int)$a['id'], 'game_review',
                            'Новая игра на модерации',
                            $user['username'] . ' отправил «' . $title . '»',
                            json_encode(['game_id' => $gameId], JSON_UNESCAPED_UNICODE),
                        ]);
                }
            } catch (Throwable $e) {}

            echo json_encode(['ok' => true, 'game_id' => $gameId], JSON_UNESCAPED_UNICODE);
            break;


        // ===== ПУБЛИКАТОР: обновление карточки + новая сборка на модерацию =====
        // ===== ПРОСТОЕ ОБНОВЛЕНИЕ ВЕРСИИ (только файл, без правки карточки) =====
        case 'submit_update': {
            if ($method !== 'POST') { http_response_code(405); echo json_encode(['ok'=>false]); break; }
            $user = requireUserS();
            if (!verifyCsrfToken($_POST['csrf_token'] ?? '')) {
                http_response_code(403);
                echo json_encode(['ok'=>false,'error'=>'CSRF'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $id = (int)($_POST['game_id'] ?? $_POST['id'] ?? 0);
            $version = trim((string)($_POST['version'] ?? ''));
            $changelog = trim((string)($_POST['changelog'] ?? ''));
            if ($id <= 0) {
                http_response_code(400);
                echo json_encode(['ok'=>false,'error'=>'Нет id игры'], JSON_UNESCAPED_UNICODE);
                break;
            }
            if ($version === '') {
                http_response_code(400);
                echo json_encode(['ok'=>false,'error'=>'Укажите версию'], JSON_UNESCAPED_UNICODE);
                break;
            }
            if ($changelog === '') {
                http_response_code(400);
                echo json_encode(['ok'=>false,'error'=>'Укажите, что нового'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $st = $pdo->prepare("SELECT id, title, submitted_by FROM games WHERE id = ?");
            $st->execute([$id]);
            $game = $st->fetch(PDO::FETCH_ASSOC);
            if (!$game) {
                http_response_code(404);
                echo json_encode(['ok'=>false,'error'=>'Игра не найдена'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $uid = (int)$user['id'];
            $isOwner = ((int)($game['submitted_by'] ?? 0) === $uid);
            $isAdmin = (($user['role'] ?? '') === 'admin');
            if (!$isOwner && !$isAdmin) {
                http_response_code(403);
                echo json_encode(['ok'=>false,'error'=>'Нет доступа'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $file = $_FILES['build_file'] ?? $_FILES['file'] ?? null;
            if (!$file || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'] ?? '')) {
                http_response_code(400);
                echo json_encode(['ok'=>false,'error'=>'Прикрепите файл сборки'], JSON_UNESCAPED_UNICODE);
                break;
            }
            ensure_game_builds_table($pdo);
            $root = dirname(__DIR__) . '/uploads/games/builds/' . $id;
            if (!is_dir($root)) @mkdir($root, 0755, true);
            $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION) ?: 'bin');
            $safe = preg_replace('/[^a-zA-Z0-9._-]+/', '_', pathinfo($file['name'], PATHINFO_FILENAME));
            $fname = $safe . '-' . substr(uniqid(), -6) . '.' . $ext;
            $dest = $root . '/' . $fname;
            if (!move_uploaded_file($file['tmp_name'], $dest)) {
                http_response_code(500);
                echo json_encode(['ok'=>false,'error'=>'Не удалось сохранить файл'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $rel = 'uploads/games/builds/' . $id . '/' . $fname;
            $size = (int)($file['size'] ?? filesize($dest) ?: 0);
            $pdo->prepare("INSERT INTO game_builds (game_id, platform, version, changelog, file_url, file_name, file_size_bytes, status, submitted_by)
                VALUES (?,?,?,?,?,?,?,'pending',?)")
                ->execute([$id, 'windows', $version, $changelog, $rel, $file['name'] ?: $fname, $size, $uid]);
            $buildId = (int)$pdo->lastInsertId();
            try {
                $admins = $pdo->query("SELECT id FROM users WHERE role = 'admin'")->fetchAll(PDO::FETCH_COLUMN);
                $ins = $pdo->prepare("INSERT INTO notifications (user_id, type, title, body, meta_json) VALUES (?,?,?,?,?)");
                $meta = json_encode(['game_id' => $id, 'build_id' => $buildId, 'version' => $version], JSON_UNESCAPED_UNICODE);
                foreach ($admins as $aid) {
                    $ins->execute([(int)$aid, 'build_pending', 'Новая версия на модерации', '«' . $game['title'] . '» v' . $version, $meta]);
                }
            } catch (Throwable $e) {}
            echo json_encode(['ok' => true, 'build_id' => $buildId, 'pending' => true], JSON_UNESCAPED_UNICODE);
            break;
        }

        // ===== СПИСОК НА МОДЕРАЦИИ (admin) =====
        case 'pending':
            $user = requireAdminS();
            $st = $pdo->query("
                SELECT g.*, u.username AS submitter
                FROM games g
                LEFT JOIN users u ON u.id = g.submitted_by
                WHERE g.status = 'pending'
                ORDER BY g.created_at ASC
            ");
            $rows = $st->fetchAll();
            foreach ($rows as &$r) {
                $r['id'] = (int)$r['id'];
                $media = $pdo->prepare("SELECT id, kind, url, sort_order FROM game_media WHERE game_id = ? ORDER BY sort_order");
                $media->execute([$r['id']]);
                $r['media'] = $media->fetchAll();
            }
            unset($r);
            echo json_encode(['ok' => true, 'games' => $rows], JSON_UNESCAPED_UNICODE);
            break;

        // ===== ПОЛУЧИТЬ ОДНУ (admin) =====
        case 'get':
            $user = requireAdminS();
            $id = (int)($_GET['id'] ?? 0);
            $st = $pdo->prepare("SELECT g.*, u.username AS submitter FROM games g LEFT JOIN users u ON u.id = g.submitted_by WHERE g.id = ?");
            $st->execute([$id]);
            $g = $st->fetch();
            if (!$g) {
                http_response_code(404);
                echo json_encode(['ok'=>false,'error'=>'Не найдено'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $media = $pdo->prepare("SELECT id, kind, url, sort_order FROM game_media WHERE game_id = ? ORDER BY sort_order");
            $media->execute([$id]);
            $g['media'] = $media->fetchAll() ?: [];

            try {
                ensure_game_builds_table($pdo);
                $stB = $pdo->prepare("SELECT id, platform, version, changelog, file_url, file_name, file_size_bytes, status, created_at FROM game_builds WHERE game_id = ? ORDER BY id DESC");
                $stB->execute([$id]);
                $g['builds'] = $stB->fetchAll(PDO::FETCH_ASSOC) ?: [];
            } catch (Throwable $e) { $g['builds'] = []; }
            // скриншоты из game_screenshots, если не попали в game_media
            $shotUrls = [];
            foreach ($g['media'] as $m) {
                $k = strtolower((string)($m['kind'] ?? ''));
                if (in_array($k, ['screenshot', 'shot', 'screen'], true) && !empty($m['url'])) {
                    $shotUrls[] = $m['url'];
                }
            }
            try {
                $ss = $pdo->prepare("SELECT image_url AS url FROM game_screenshots WHERE game_id = ? ORDER BY sort ASC, id ASC");
                $ss->execute([$id]);
                foreach ($ss->fetchAll() ?: [] as $row) {
                    $u = trim((string)($row['url'] ?? ''));
                    if ($u !== '' && !in_array($u, $shotUrls, true)) {
                        $shotUrls[] = $u;
                        $g['media'][] = ['id' => 0, 'kind' => 'screenshot', 'url' => $u, 'sort_order' => 0];
                    }
                }
            } catch (Throwable $e) {}
            $g['screenshots'] = $shotUrls;
            // трейлеры из media, если video_url один/пустой
            $trailerUrls = [];
            $rawV = trim((string)($g['video_url'] ?? ''));
            if ($rawV !== '') {
                if ($rawV[0] === '[') {
                    $j = json_decode($rawV, true);
                    if (is_array($j)) {
                        foreach ($j as $item) {
                            if (is_string($item) && trim($item) !== '') $trailerUrls[] = trim($item);
                            elseif (is_array($item)) {
                                $u = trim((string)($item['url'] ?? $item['src'] ?? ''));
                                if ($u !== '') $trailerUrls[] = $u;
                            }
                        }
                    }
                } else {
                    $trailerUrls[] = $rawV;
                }
            }
            foreach ($g['media'] as $m) {
                $k = strtolower((string)($m['kind'] ?? ''));
                if (in_array($k, ['trailer', 'video', 'movie'], true) && !empty($m['url'])) {
                    $u = trim($m['url']);
                    if ($u !== '' && !in_array($u, $trailerUrls, true)) $trailerUrls[] = $u;
                }
            }
            if (count($trailerUrls) > 1) {
                $g['video_url'] = json_encode(array_values($trailerUrls), JSON_UNESCAPED_UNICODE);
            } elseif (count($trailerUrls) === 1) {
                $g['video_url'] = $trailerUrls[0];
            }
            $g['videos'] = array_map(function ($u) { return ['url' => $u]; }, $trailerUrls);
            echo json_encode(['ok' => true, 'game' => $g], JSON_UNESCAPED_UNICODE);
            break;

        // ===== АДМИН: СОХРАНИТЬ ПРАВКИ =====
        case 'admin_save':
            if ($method !== 'POST') { http_response_code(405); echo json_encode(['ok'=>false]); break; }
            $user = requireAdminS();
            if (!verifyCsrfToken($_POST['csrf_token'] ?? '')) {
                http_response_code(403);
                echo json_encode(['ok'=>false,'error'=>'CSRF'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $id = (int)($_POST['id'] ?? 0);
            $st = $pdo->prepare("SELECT id, title, price, discount_percent FROM games WHERE id = ?");
            $st->execute([$id]);
            $oldGame = $st->fetch();
            if (!$oldGame) {
                http_response_code(404);
                echo json_encode(['ok'=>false,'error'=>'Не найдено'], JSON_UNESCAPED_UNICODE);
                break;
            }

            $fields = [
                'title' => trim($_POST['title'] ?? ''),
                'short_description' => trim($_POST['short_description'] ?? ''),
                'description' => trim($_POST['description'] ?? ''),
                'genre' => trim($_POST['genre'] ?? ''),
                'video_url' => normalize_video_urls_field(trim((string)($_POST['video_url'] ?? ''))),
                'sys_req_min' => trim($_POST['sys_req_min'] ?? ''),
                'sys_req_rec' => trim($_POST['sys_req_rec'] ?? ''),
                'controllers' => trim($_POST['controllers'] ?? ''),
                'languages' => trim($_POST['languages'] ?? ''),
                'price' => (float)($_POST['price'] ?? 0),
                'discount_percent' => max(0, min(100, (int)($_POST['discount_percent'] ?? 0))),
                'review_note' => trim($_POST['review_note'] ?? ''),
                'is_adult' => !empty($_POST['is_adult']) ? 1 : 0,
                'developer' => trim($_POST['developer'] ?? ''),
                'publisher' => trim($_POST['publisher'] ?? ''),
            ];
            $devName = $fields['publisher'] !== '' ? $fields['publisher'] : ($fields['developer'] !== '' ? $fields['developer'] : '');
            $pdo->prepare("
                UPDATE games SET title=?, short_description=?, description=?, genre=?, video_url=?,
                  sys_req_min=?, sys_req_rec=?, controllers=?, languages=?, price=?, discount_percent=?, review_note=?, is_adult=?,
                  developer=?, developer_name=?
                WHERE id=?
            ")->execute([
                $fields['title'], $fields['short_description'], $fields['description'], $fields['genre'],
                $fields['video_url'], $fields['sys_req_min'], $fields['sys_req_rec'], $fields['controllers'],
                $fields['languages'], $fields['price'], $fields['discount_percent'], $fields['review_note'], $fields['is_adult'],
                $fields['developer'] ?: $devName, $devName ?: $fields['developer'], $id,
            ]);

            // Уведомление всем пользователям, если появилась/выросла скидка
            $oldDisc = (int)($oldGame['discount_percent'] ?? 0);
            $newDisc = (int)$fields['discount_percent'];
            if ($newDisc > 0 && $newDisc > $oldDisc && (float)$fields['price'] > 0) {
                $gameTitle = $fields['title'] ?: ($oldGame['title'] ?? 'Игра');
                $base = (float)$fields['price'];
                $final = (int)round($base * (100 - $newDisc) / 100);
                $title = 'Скидка −' . $newDisc . '%';
                $body = '«' . $gameTitle . '» теперь ' . $final . ' ₽ вместо ' . (int)round($base) . ' ₽';
                $banner = '';
                $cover = '';
                try {
                    $stB = $pdo->prepare("SELECT banner_url, cover_url FROM games WHERE id = ?");
                    $stB->execute([$id]);
                    $img = $stB->fetch();
                    if ($img) {
                        $banner = trim((string)($img['banner_url'] ?? ''));
                        $cover = trim((string)($img['cover_url'] ?? ''));
                    }
                } catch (Throwable $e) {}
                // hero → cover → media hero endpoint (не SVG-котик если есть файл/URL)
                if ($banner === '') $banner = $cover;
                if ($banner === '') $banner = 'media.php?type=hero&id=' . $id;
                $meta = json_encode([
                    'game_id' => $id,
                    'discount' => $newDisc,
                    'banner_url' => $banner,
                    'cover_url' => $cover ?: $banner,
                    'title' => $gameTitle,
                ], JSON_UNESCAPED_UNICODE);
                try {
                    // уведомляем только подписчиков издательства игры (если есть publisher_id)
                    $pubId = 0;
                    try {
                        $stP = $pdo->prepare("SELECT publisher_id FROM games WHERE id = ?");
                        $stP->execute([$id]);
                        $pubId = (int)($stP->fetchColumn() ?: 0);
                    } catch (Throwable $e) {}
                    $users = [];
                    if ($pubId > 0) {
                        try {
                            $stU = $pdo->prepare("SELECT user_id FROM publisher_subscriptions WHERE publisher_id = ?");
                            $stU->execute([$pubId]);
                            $users = $stU->fetchAll(PDO::FETCH_COLUMN);
                        } catch (Throwable $e) {}
                    }
                    // если нет подписчиков / нет издательства — не спамим всем
                    if ($users) {
                        $ins = $pdo->prepare("INSERT INTO notifications (user_id, type, title, body, meta_json) VALUES (?, 'sale', ?, ?, ?)");
                        foreach ($users as $uid) {
                            $ins->execute([(int)$uid, $title, $body, $meta]);
                        }
                    }
                } catch (Throwable $e) { /* ignore notify errors */ }
            }

            $base = dirname(__DIR__) . '/uploads/games';
            if (!empty($_FILES['cover']['tmp_name'])) {
                try {
                    $url = saveUpload('cover', $base.'/covers', $imgAllowed, 5);
                    if ($url) $pdo->prepare("UPDATE games SET cover_url=? WHERE id=?")->execute([$url, $id]);
                } catch (Throwable $e) {}
            }
            if (!empty($_FILES['banner']['tmp_name'])) {
                try {
                    $url = saveUpload('banner', $base.'/banners', $imgAllowed, 8);
                    if ($url) $pdo->prepare("UPDATE games SET banner_url=? WHERE id=?")->execute([$url, $id]);
                } catch (Throwable $e) {}
            }
            if (!empty($_FILES['logo']['tmp_name'])) {
                try {
                    $url = saveUpload('logo', $base.'/logos', $imgAllowed, 4);
                    if ($url) $pdo->prepare("UPDATE games SET logo_url=? WHERE id=?")->execute([$url, $id]);
                } catch (Throwable $e) {}
            }
            if (!empty($_FILES['icon']['tmp_name'])) {
                try {
                    $url = saveUpload('icon', $base.'/icons', $imgAllowed, 3);
                    if ($url) $pdo->prepare("UPDATE games SET icon_url=? WHERE id=?")->execute([$url, $id]);
                } catch (Throwable $e) {}
            }
            // new screenshots
            if (!empty($_FILES['screenshots'])) {
                $files = $_FILES['screenshots'];
                $count = is_array($files['name']) ? count($files['name']) : 0;
                $maxOrder = (int)$pdo->query("SELECT COALESCE(MAX(sort_order),0) FROM game_media WHERE game_id=$id")->fetchColumn();
                for ($i = 0; $i < $count; $i++) {
                    if ($files['error'][$i] !== UPLOAD_ERR_OK) continue;
                    $_FILES['_shot'] = [
                        'name'=>$files['name'][$i],'type'=>$files['type'][$i],
                        'tmp_name'=>$files['tmp_name'][$i],'error'=>$files['error'][$i],'size'=>$files['size'][$i],
                    ];
                    try {
                        $url = saveUpload('_shot', $base.'/shots', $imgAllowed, 6);
                        if ($url) {
                            $maxOrder++;
                            $pdo->prepare("INSERT INTO game_media (game_id, kind, url, sort_order) VALUES (?,?,?,?)")
                                ->execute([$id, 'screenshot', $url, $maxOrder]);
                        }
                    } catch (Throwable $e) {}
                }
            }
            // delete media ids
            $del = $_POST['delete_media'] ?? '';
            if ($del !== '') {
                $ids = array_filter(array_map('intval', explode(',', $del)));
                if ($ids) {
                    $in = implode(',', $ids);
                    $pdo->exec("DELETE FROM game_media WHERE game_id = $id AND id IN ($in)");
                }
            }

            insert_trailer_media($pdo, (int)$id, $fields['video_url'] ?? '');
            // новые сборки: pending, если явно просят; иначе published только при publish-флоу
            try {
                if (!empty($_POST['builds_as_pending'])) {
                    $GLOBALS['__build_status_override'] = 'pending';
                } else {
                    $stPub = $pdo->prepare("SELECT is_published, status FROM games WHERE id = ?");
                    $stPub->execute([$id]);
                    $gPub = $stPub->fetch(PDO::FETCH_ASSOC) ?: [];
                    if (!empty($gPub['is_published']) || ($gPub['status'] ?? '') === 'published') {
                        $GLOBALS['__build_status_override'] = 'published';
                    }
                }
            } catch (Throwable $e) {}
            try { save_builds_from_request($pdo, (int)$id); } catch (Throwable $e) {}

            echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
            break;

        // ===== ПУБЛИКОВАТЬ / ОТКЛОНИТЬ =====
        case 'publish':
        case 'reject':
            if ($method !== 'POST') { http_response_code(405); echo json_encode(['ok'=>false]); break; }
            $user = requireAdminS();
            $body = jsonBodyS();
            if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
                http_response_code(403);
                echo json_encode(['ok'=>false,'error'=>'CSRF'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $id = (int)($body['id'] ?? 0);
            $st = $pdo->prepare("SELECT id, title, submitted_by FROM games WHERE id = ?");
            $st->execute([$id]);
            $g = $st->fetch();
            if (!$g) {
                http_response_code(404);
                echo json_encode(['ok'=>false,'error'=>'Не найдено'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $adminName = $user['username'] ?? 'админ';
            $adminId = (int)($user['id'] ?? 0);
            if ($action === 'publish') {
                $pdo->prepare("UPDATE games SET status='published', is_published=1, category=IF(category='' OR category IS NULL,'game',category) WHERE id=?")->execute([$id]);
                try {
                    ensure_game_builds_table($pdo);
                    $pdo->prepare("UPDATE game_builds SET status='published' WHERE game_id=? AND (status='pending' OR status IS NULL OR status='')")->execute([$id]);
                } catch (Throwable $e) {}
                $type = 'game_published';
                $titleN = 'Ваша игра опубликована';
                $bodyN = 'Игра «' . $g['title'] . '» прошла модерацию. Рассмотрел: ' . $adminName;
                // каталог — остальным
                try {
                    $users = $pdo->query("SELECT id FROM users")->fetchAll();
                    $ins = $pdo->prepare("INSERT INTO notifications (user_id, type, title, body, meta_json) VALUES (?,?,?,?,?)");
                    $metaCat = json_encode(['game_id' => $id], JSON_UNESCAPED_UNICODE);
                    foreach ($users as $u) {
                        if ((int)$u['id'] === (int)$g['submitted_by']) continue;
                        $ins->execute([(int)$u['id'], 'game_added', 'Новая игра в каталоге', 'В каталоге появилась «' . $g['title'] . '»', $metaCat]);
                    }
                } catch (Throwable $e) {}
            } else {
                $pdo->prepare("UPDATE games SET status='rejected', is_published=0, review_note=? WHERE id=?")
                    ->execute([trim($body['note'] ?? ''), $id]);
                $type = 'game_rejected';
                $titleN = 'Игра не прошла модерацию';
                $bodyN = 'Игра «' . $g['title'] . '» отклонена. Отказал: ' . $adminName;
                $extra = trim($body['note'] ?? '');
                if ($extra !== '') $bodyN .= '. Причина: ' . $extra;
            }
            if ($g['submitted_by']) {
                try {
                    $metaDev = json_encode([
                        'game_id' => $id,
                        'admin_id' => $adminId,
                        'admin_username' => $adminName,
                    ], JSON_UNESCAPED_UNICODE);
                    $pdo->prepare("INSERT INTO notifications (user_id, type, title, body, meta_json) VALUES (?,?,?,?,?)")
                        ->execute([(int)$g['submitted_by'], $type, $titleN, $bodyN, $metaDev]);
                } catch (Throwable $e) {}
            }
            echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
            break;

        case 'delete_game':
            if ($method !== 'POST') { http_response_code(405); echo json_encode(['ok'=>false]); break; }
            $admin = requireAdminS();
            $body = jsonBodyS();
            if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
                http_response_code(403);
                echo json_encode(['ok'=>false,'error'=>'CSRF'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $id = (int)($body['id'] ?? 0);
            if ($id <= 0) {
                http_response_code(400);
                echo json_encode(['ok'=>false,'error'=>'Нет id'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $st = $pdo->prepare("SELECT title, cover_url, banner_url FROM games WHERE id = ?");
            $st->execute([$id]);
            $game = $st->fetch();
            if (!$game) {
                http_response_code(404);
                echo json_encode(['ok'=>false,'error'=>'Игра не найдена'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $gameTitle = (string)($game['title'] ?? 'Игра');
            // media files (best-effort)
            $urls = [];
            try {
                $m = $pdo->prepare("SELECT url FROM game_media WHERE game_id = ?");
                $m->execute([$id]);
                foreach ($m->fetchAll() as $row) $urls[] = $row['url'];
            } catch (Throwable $e) {}
            try {
                $m = $pdo->prepare("SELECT image_url AS url FROM game_screenshots WHERE game_id = ?");
                $m->execute([$id]);
                foreach ($m->fetchAll() as $row) $urls[] = $row['url'];
            } catch (Throwable $e) {}
            if (!empty($game['cover_url'])) $urls[] = $game['cover_url'];
            if (!empty($game['banner_url'])) $urls[] = $game['banner_url'];

            try { $pdo->prepare("DELETE FROM game_media WHERE game_id = ?")->execute([$id]); } catch (Throwable $e) {}
            try { $pdo->prepare("DELETE FROM game_screenshots WHERE game_id = ?")->execute([$id]); } catch (Throwable $e) {}
            try { $pdo->prepare("DELETE FROM game_builds WHERE game_id = ?")->execute([$id]); } catch (Throwable $e) {}
            try { $pdo->prepare("DELETE FROM comments WHERE game_id = ?")->execute([$id]); } catch (Throwable $e) {}
            try { $pdo->prepare("DELETE FROM ratings WHERE game_id = ?")->execute([$id]); } catch (Throwable $e) {}
            try { $pdo->prepare("DELETE FROM library WHERE game_id = ?")->execute([$id]); } catch (Throwable $e) {}
            // баннер для уведомления — локальная копия, пока есть уведомления
            $bannerKeep = trim((string)($game['banner_url'] ?? ''));
            if ($bannerKeep === '') $bannerKeep = trim((string)($game['cover_url'] ?? ''));
            $coversDir = dirname(__DIR__) . '/covers';
            $notifDir = dirname(__DIR__) . '/uploads/notif';
            if (!is_dir($notifDir)) @mkdir($notifDir, 0775, true);
            $savedBanner = '';
            foreach (['hero', 'cover'] as $kind) {
                foreach (['jpg','jpeg','png','webp'] as $ext) {
                    $src = $coversDir . "/{$kind}_{$id}.{$ext}";
                    if (is_file($src)) {
                        $destName = "deleted_{$id}.{$ext}";
                        $dest = $notifDir . '/' . $destName;
                        if (@copy($src, $dest)) $savedBanner = 'uploads/notif/' . $destName;
                        break 2;
                    }
                }
            }
            // скачать удалённый URL, если локального файла нет
            if ($savedBanner === '' && $bannerKeep !== '' && preg_match('~^https?://~i', $bannerKeep)) {
                $bin = null;
                if (function_exists('curl_init')) {
                    $ch = curl_init($bannerKeep);
                    curl_setopt_array($ch, [
                        CURLOPT_RETURNTRANSFER => true,
                        CURLOPT_FOLLOWLOCATION => true,
                        CURLOPT_TIMEOUT => 20,
                        CURLOPT_SSL_VERIFYPEER => false,
                        CURLOPT_USERAGENT => 'Mozilla/5.0 CATio/1.0',
                    ]);
                    $bin = curl_exec($ch);
                    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
                    curl_close($ch);
                    if (!$bin || $code >= 400 || strlen($bin) < 500) $bin = null;
                }
                if ($bin) {
                    $destName = 'deleted_' . $id . '.jpg';
                    $dest = $notifDir . '/' . $destName;
                    if (@file_put_contents($dest, $bin) !== false) $savedBanner = 'uploads/notif/' . $destName;
                }
            }
            if ($savedBanner === '' && $bannerKeep !== '' && !preg_match('~media\.php~i', $bannerKeep)) {
                // относительный путь в uploads — скопировать
                $rel = ltrim(str_replace(['\\','..'], ['/',''], $bannerKeep), '/');
                $srcPath = dirname(__DIR__) . '/' . $rel;
                if (is_file($srcPath)) {
                    $ext = pathinfo($srcPath, PATHINFO_EXTENSION) ?: 'jpg';
                    $destName = 'deleted_' . $id . '.' . $ext;
                    if (@copy($srcPath, $notifDir . '/' . $destName)) $savedBanner = 'uploads/notif/' . $destName;
                }
            }
            if ($savedBanner === '') $savedBanner = $bannerKeep ?: ('uploads/notif/deleted_' . $id . '.jpg');

            $pdo->prepare("DELETE FROM games WHERE id = ?")->execute([$id]);

            $root = dirname(__DIR__) . '/';
            foreach ($urls as $u) {
                if (!$u || preg_match('~^https?://~i', $u)) continue;
                $path = $root . ltrim(str_replace(['\\','..'], ['/',''], $u), '/');
                if (is_file($path)) @unlink($path);
            }
            // обновить баннеры во ВСЕХ старых уведомлениях по этой игре (скидки и т.д.)
            try {
                $stN = $pdo->query("SELECT id, meta_json FROM notifications WHERE meta_json IS NOT NULL AND meta_json != ''");
                $upd = $pdo->prepare("UPDATE notifications SET meta_json = ? WHERE id = ?");
                while ($row = $stN->fetch()) {
                    $meta = json_decode($row['meta_json'], true);
                    if (!is_array($meta)) continue;
                    if ((int)($meta['game_id'] ?? 0) !== $id) continue;
                    $meta['banner_url'] = $savedBanner ?? '';
                    $meta['cover_url'] = $savedBanner ?? '';
                    $meta['title'] = $meta['title'] ?? $gameTitle;
                    $meta['deleted'] = true;
                    $upd->execute([json_encode($meta, JSON_UNESCAPED_UNICODE), (int)$row['id']]);
                }
            } catch (Throwable $e) {}

            // всем пользователям — об удалении
            try {
                $users = $pdo->query("SELECT id FROM users")->fetchAll();
                $ins = $pdo->prepare("INSERT INTO notifications (user_id, type, title, body, meta_json) VALUES (?,?,?,?,?)");
                $titleN = 'Игра удалена';
                $bodyN = 'Карточка «' . $gameTitle . '» была удалена из каталога';
                $meta = json_encode([
                    'game_id' => $id,
                    'banner_url' => $savedBanner ?? '',
                    'cover_url' => $savedBanner ?? '',
                    'title' => $gameTitle,
                    'deleted' => true,
                ], JSON_UNESCAPED_UNICODE);
                foreach ($users as $u) {
                    $ins->execute([(int)$u['id'], 'game_deleted', $titleN, $bodyN, $meta]);
                }
            } catch (Throwable $e) {}

            echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
            break;

        
        case 'list_builds': {
            ensure_game_builds_table($pdo);
            $id = (int)($_GET['game_id'] ?? 0);
            if ($id <= 0) { echo json_encode(['ok'=>false,'error'=>'game_id']); break; }
            $user = getCurrentUser();
            $isAdmin = $user && (($user['role'] ?? '') === 'admin');
            $isSubmitter = false;
            if ($user) {
                try {
                    $stG = $pdo->prepare("SELECT submitted_by, status FROM games WHERE id = ?");
                    $stG->execute([$id]);
                    $gRow = $stG->fetch(PDO::FETCH_ASSOC);
                    if ($gRow && (int)$gRow['submitted_by'] === (int)$user['id']) $isSubmitter = true;
                    // pending-игра: автор и админ видят pending-сборки
                    if ($gRow && ($gRow['status'] ?? '') === 'pending' && ($isAdmin || $isSubmitter)) {
                        $isAdmin = true; // reuse filter below as "show all"
                    }
                } catch (Throwable $e) {}
            }
            $sql = "SELECT id, game_id, platform, version, changelog, file_url, file_name, file_size_bytes, status, created_at FROM game_builds WHERE game_id = ?";
            if (!$isAdmin && !$isSubmitter) $sql .= " AND (status = 'published' OR status IS NULL OR status = '')";
            $sql .= " ORDER BY id DESC";
            $st = $pdo->prepare($sql);
            $st->execute([$id]);
            echo json_encode(['ok'=>true, 'builds'=>$st->fetchAll(PDO::FETCH_ASSOC)], JSON_UNESCAPED_UNICODE);
            break;
        }

        case 'pending_builds': {
            $user = requireUserS();
            if (($user['role'] ?? '') !== 'admin') { http_response_code(403); echo json_encode(['ok'=>false,'error'=>'Нет доступа']); break; }
            ensure_game_builds_table($pdo);
            $st = $pdo->query("SELECT b.*, g.title AS game_title, g.cover_url, g.banner_url, g.icon_url,
                u.username AS author_name
                FROM game_builds b
                JOIN games g ON g.id = b.game_id
                LEFT JOIN users u ON u.id = b.submitted_by
                WHERE b.status = 'pending'
                ORDER BY b.created_at ASC
                LIMIT 100");
            echo json_encode(['ok'=>true, 'builds'=>$st->fetchAll(PDO::FETCH_ASSOC)], JSON_UNESCAPED_UNICODE);
            break;
        }

        case 'approve_build':
        case 'reject_build': {
            if ($method !== 'POST') { echo json_encode(['ok'=>false]); break; }
            $user = requireUserS();
            if (($user['role'] ?? '') !== 'admin') { http_response_code(403); echo json_encode(['ok'=>false,'error'=>'Нет доступа']); break; }
            $body = json_decode(file_get_contents('php://input'), true);
            if (!is_array($body)) $body = $_POST;
            if (!verifyCsrfToken($body['csrf_token'] ?? '')) { http_response_code(403); echo json_encode(['ok'=>false,'error'=>'CSRF']); break; }
            ensure_game_builds_table($pdo);
            $bid = (int)($body['id'] ?? 0);
            if ($bid <= 0) { echo json_encode(['ok'=>false,'error'=>'id']); break; }
            $st = $pdo->prepare("SELECT b.*, g.title AS game_title, g.id AS gid FROM game_builds b JOIN games g ON g.id = b.game_id WHERE b.id = ?");
            $st->execute([$bid]);
            $row = $st->fetch(PDO::FETCH_ASSOC);
            if (!$row) { echo json_encode(['ok'=>false,'error'=>'Не найдено']); break; }

            if ($action === 'approve_build') {
                $pdo->prepare("UPDATE game_builds SET status = 'published' WHERE id = ?")->execute([$bid]);
                // notify publisher
                if (!empty($row['submitted_by'])) {
                    try {
                        $pdo->prepare("INSERT INTO notifications (user_id, type, title, body, meta_json) VALUES (?,?,?,?,?)")
                            ->execute([
                                (int)$row['submitted_by'], 'build_approved',
                                'Обновление одобрено',
                                'Версия ' . $row['version'] . ' для «' . $row['game_title'] . '» опубликована',
                                json_encode(['game_id'=>(int)$row['gid'], 'build_id'=>$bid, 'version'=>$row['version']], JSON_UNESCAPED_UNICODE)
                            ]);
                    } catch (Throwable $e) {}
                }
                // notify publisher subscribers
                try {
                    $subs = $pdo->prepare("SELECT DISTINCT ps.user_id FROM publisher_subscriptions ps
                        JOIN publisher_members pm ON pm.publisher_id = ps.publisher_id
                        JOIN games g ON g.submitted_by = pm.user_id OR g.publisher_id = ps.publisher_id
                        WHERE g.id = ?");
                    $subs->execute([(int)$row['gid']]);
                    $ins = $pdo->prepare("INSERT INTO notifications (user_id, type, title, body, meta_json) VALUES (?,?,?,?,?)");
                    foreach ($subs->fetchAll(PDO::FETCH_ASSOC) as $s) {
                        $ins->execute([
                            (int)$s['user_id'], 'game_update',
                            'Обновление: ' . $row['game_title'],
                            'Вышла версия ' . $row['version'] . (!empty($row['changelog']) ? ' — ' . mb_substr($row['changelog'], 0, 120) : ''),
                            json_encode(['game_id'=>(int)$row['gid'], 'build_id'=>$bid, 'version'=>$row['version']], JSON_UNESCAPED_UNICODE)
                        ]);
                    }
                } catch (Throwable $e) {}
                echo json_encode(['ok'=>true, 'status'=>'published']);
            } else {
                // reject — delete file and row so page stays without new build
                if (!empty($row['file_url'])) {
                    $path = dirname(__DIR__) . '/' . ltrim($row['file_url'], '/');
                    if (is_file($path)) @unlink($path);
                }
                $pdo->prepare("DELETE FROM game_builds WHERE id = ?")->execute([$bid]);
                if (!empty($row['submitted_by'])) {
                    try {
                        $pdo->prepare("INSERT INTO notifications (user_id, type, title, body, meta_json) VALUES (?,?,?,?,?)")
                            ->execute([
                                (int)$row['submitted_by'], 'build_rejected',
                                'Обновление отклонено',
                                'Версия ' . $row['version'] . ' для «' . $row['game_title'] . '» отклонена модератором',
                                json_encode(['game_id'=>(int)$row['gid'], 'version'=>$row['version']], JSON_UNESCAPED_UNICODE)
                            ]);
                    } catch (Throwable $e) {}
                }
                echo json_encode(['ok'=>true, 'status'=>'rejected']);
            }
            break;
        }

        case 'delete_build': {
            if ($method !== 'POST') { echo json_encode(['ok'=>false]); break; }
            $user = requireUserS();
            $body = json_decode(file_get_contents('php://input'), true);
            if (!is_array($body)) $body = $_POST;
            if (!verifyCsrfToken($body['csrf_token'] ?? '')) { http_response_code(403); echo json_encode(['ok'=>false,'error'=>'CSRF']); break; }
            ensure_game_builds_table($pdo);
            $bid = (int)($body['id'] ?? 0);
            if ($bid <= 0) { echo json_encode(['ok'=>false,'error'=>'id']); break; }
            $st = $pdo->prepare("SELECT b.*, g.submitted_by FROM game_builds b LEFT JOIN games g ON g.id = b.game_id WHERE b.id = ?");
            $st->execute([$bid]);
            $row = $st->fetch();
            if (!$row) { echo json_encode(['ok'=>false,'error'=>'Не найдено']); break; }
            $isAdmin = (($user['role'] ?? '') === 'admin');
            $isOwner = ((int)($row['submitted_by'] ?? 0) === (int)$user['id']);
            if (!$isAdmin && !$isOwner) { http_response_code(403); echo json_encode(['ok'=>false,'error'=>'Нет доступа']); break; }
            if (!empty($row['file_url'])) {
                $path = dirname(__DIR__) . '/' . ltrim($row['file_url'], '/');
                if (is_file($path)) @unlink($path);
            }
            $pdo->prepare("DELETE FROM game_builds WHERE id = ?")->execute([$bid]);
            echo json_encode(['ok'=>true]);
            break;
        }


        default:
            http_response_code(400);
            echo json_encode(['ok'=>false,'error'=>'Unknown action'], JSON_UNESCAPED_UNICODE);
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok'=>false,'error'=>$e->getMessage()], JSON_UNESCAPED_UNICODE);
}
