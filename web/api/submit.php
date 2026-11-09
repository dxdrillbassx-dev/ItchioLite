<?php
// CATio — загрузка игр пользователями + модерация админом
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
            $video = trim($_POST['video_url'] ?? '');
            $sysMin = trim($_POST['sys_req_min'] ?? '');
            $sysRec = trim($_POST['sys_req_rec'] ?? '');
            $controllers = trim($_POST['controllers'] ?? ''); // comma: xbox,playstation
            $languages = trim($_POST['languages'] ?? '');
            $price = (float)($_POST['price'] ?? 0);
            $isAdult = !empty($_POST['is_adult']) ? 1 : 0;
            $developerIn = trim($_POST['developer'] ?? '');
            $publisherIn = trim($_POST['publisher'] ?? '');
            $devName = $publisherIn !== '' ? $publisherIn : ($developerIn !== '' ? $developerIn : $user['username']);
            if ($publisherId > 0) {
                $pn = $pdo->prepare("SELECT name FROM publishers WHERE id = ?");
                $pn->execute([$publisherId]);
                $prow = $pn->fetch();
                if ($prow) $devName = $prow['name'];
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
            if (!$coverUrl) {
                http_response_code(400);
                echo json_encode(['ok'=>false,'error'=>'Нужна обложка'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $bannerUrl = null;
            try { $bannerUrl = saveUpload('banner', $bannerDir, $imgAllowed, 8); } catch (Throwable $e) {}
            $logoDir = $base . '/logos';
            $iconDir = $base . '/icons';
            if (!is_dir($logoDir)) @mkdir($logoDir, 0755, true);
            if (!is_dir($iconDir)) @mkdir($iconDir, 0755, true);
            $logoUrl = null;
            try { $logoUrl = saveUpload('logo', $logoDir, $imgAllowed, 4); } catch (Throwable $e) {}
            $iconUrl = null;
            try { $iconUrl = saveUpload('icon', $iconDir, $imgAllowed, 3); } catch (Throwable $e) {}

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
            $g['media'] = $media->fetchAll();
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
                'video_url' => trim($_POST['video_url'] ?? ''),
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
                    $users = $pdo->query("SELECT id FROM users")->fetchAll(PDO::FETCH_COLUMN);
                    $ins = $pdo->prepare("INSERT INTO notifications (user_id, type, title, body, meta_json) VALUES (?, 'sale', ?, ?, ?)");
                    foreach ($users as $uid) {
                        $ins->execute([(int)$uid, $title, $body, $meta]);
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

        default:
            http_response_code(400);
            echo json_encode(['ok'=>false,'error'=>'Unknown action'], JSON_UNESCAPED_UNICODE);
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok'=>false,'error'=>$e->getMessage()], JSON_UNESCAPED_UNICODE);
}
