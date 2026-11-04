<?php
// CATio — API профиля: статистика, активность, настройки, баланс
require_once __DIR__ . '/../auth.php';

header('Content-Type: application/json; charset=utf-8');

set_exception_handler(function ($e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Ошибка сервера: ' . $e->getMessage()], JSON_UNESCAPED_UNICODE);
    exit;
});

$pdo = getDB();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

function jsonBodyUser(): array {
    $body = json_decode(file_get_contents('php://input'), true);
    return is_array($body) ? $body : $_POST;
}

function requireAuthUser(): array {
    $user = getCurrentUser();
    if (!$user) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'Нужно войти в аккаунт'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    return $user;
}

try {
    switch ($action) {

        // ===== СТАТИСТИКА ПРОФИЛЯ (как в Steam: игр, отзывов, уровень) =====
        case 'stats':
            $user = requireAuthUser();
            $uid = (int)$user['id'];

            $games = (int)$pdo->query("SELECT COUNT(*) FROM library WHERE user_id = $uid")->fetchColumn();
            $comments = (int)$pdo->query("SELECT COUNT(*) FROM comments WHERE user_id = $uid")->fetchColumn();
            $ratings = (int)$pdo->query("SELECT COUNT(*) FROM ratings WHERE user_id = $uid")->fetchColumn();
            $spent = (float)$pdo->query("SELECT COALESCE(SUM(price_paid),0) FROM purchases WHERE user_id = $uid")->fetchColumn();
            $playtime = (int)$pdo->query("SELECT COALESCE(SUM(playtime_minutes),0) FROM library WHERE user_id = $uid")->fetchColumn();
            $karma = (int)($user['karma'] ?? 0);

            // «Уровень» CATio: складывается из реальных действий
            $level = $games * 2 + $comments + $ratings;

            // Условный топ-% по времени игры (для демо)
            $top_percent = null;
            if ($playtime > 0) {
                $top_percent = max(1, min(99, 100 - (int)round(log10(max(1, $playtime)) * 12)));
            }

            echo json_encode([
                'ok' => true,
                'stats' => [
                    'games' => $games,
                    'comments' => $comments,
                    'ratings' => $ratings,
                    'spent' => $spent,
                    'level' => $level,
                    'playtime_minutes' => $playtime,
                    'karma' => $karma,
                    'top_percent' => $top_percent,
                ],
            ], JSON_UNESCAPED_UNICODE);
            break;

        // ===== НЕДАВНЯЯ АКТИВНОСТЬ (покупки + комментарии) =====
        case 'activity':
            $user = requireAuthUser();
            $uid = (int)$user['id'];

            // Недавние игры из библиотеки (по last_played / playtime)
            $stmt = $pdo->prepare("
                SELECT g.id AS game_id, g.title, l.last_played AS ts, l.playtime_minutes,
                       'play' AS type
                FROM library l
                JOIN games g ON g.id = l.game_id
                WHERE l.user_id = ? AND (l.last_played IS NOT NULL OR l.playtime_minutes > 0)
                ORDER BY COALESCE(l.last_played, l.added_at) DESC
                LIMIT 10
            ");
            $stmt->execute([$uid]);
            $fromLib = $stmt->fetchAll();

            // Покупки
            $stmt = $pdo->prepare("
                SELECT g.id AS game_id, g.title, p.created_at AS ts, 0 AS playtime_minutes,
                       'purchase' AS type,
                       CONCAT('Получено «', g.title, '»') AS text
                FROM purchases p
                JOIN games g ON g.id = p.game_id
                WHERE p.user_id = ?
                ORDER BY p.created_at DESC
                LIMIT 5
            ");
            $stmt->execute([$uid]);
            $fromPurch = $stmt->fetchAll();

            $activity = [];
            foreach ($fromLib as $row) {
                $activity[] = [
                    'type' => 'play',
                    'game_id' => (int)$row['game_id'],
                    'title' => $row['title'],
                    'ts' => $row['ts'],
                    'playtime_minutes' => (int)$row['playtime_minutes'],
                    'text' => $row['title'],
                ];
            }
            foreach ($fromPurch as $row) {
                // не дублируем если уже есть в play
                $exists = false;
                foreach ($activity as $a) {
                    if ((int)$a['game_id'] === (int)$row['game_id']) { $exists = true; break; }
                }
                if (!$exists) {
                    $activity[] = [
                        'type' => 'purchase',
                        'game_id' => (int)$row['game_id'],
                        'title' => $row['title'],
                        'ts' => $row['ts'],
                        'playtime_minutes' => 0,
                        'text' => $row['text'],
                    ];
                }
            }

            // сортировка по времени
            usort($activity, function ($a, $b) {
                return strcmp($b['ts'] ?? '', $a['ts'] ?? '');
            });
            $activity = array_slice($activity, 0, 10);

            echo json_encode(['ok' => true, 'activity' => $activity], JSON_UNESCAPED_UNICODE);
            break;

        // ===== НАСТРОЙКИ ПРОФИЛЯ (аватар-эмодзи и цвет) =====
        case 'update_profile':
            if ($method !== 'POST') {
                http_response_code(405);
                echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
                break;
            }
            $user = requireAuthUser();
            $body = jsonBodyUser();
            if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
                http_response_code(403);
                echo json_encode(['ok' => false, 'error' => 'Неверный CSRF-токен. Обнови страницу.'], JSON_UNESCAPED_UNICODE);
                break;
            }

            $avatar = trim((string)($body['avatar'] ?? ''));
            $color = trim((string)($body['avatar_color'] ?? ''));

            if ($avatar !== '' && mb_strlen($avatar) > 4) {
                $avatar = mb_substr($avatar, 0, 4);
            }
            if ($color !== '' && !preg_match('/^#[0-9a-fA-F]{6}$/', $color)) {
                $color = '';
            }

            if ($avatar !== '') {
                $pdo->prepare("UPDATE users SET avatar = ? WHERE id = ?")->execute([$avatar, (int)$user['id']]);
            }
            if ($color !== '') {
                $pdo->prepare("UPDATE users SET avatar_color = ? WHERE id = ?")->execute([$color, (int)$user['id']]);
            }

            $stmt = $pdo->prepare("SELECT username, email, role, balance, avatar, avatar_color, created_at FROM users WHERE id = ?");
            $stmt->execute([(int)$user['id']]);
            echo json_encode(['ok' => true, 'user' => $stmt->fetch()], JSON_UNESCAPED_UNICODE);
            break;

        // ===== ПОПОЛНЕНИЕ БАЛАНСА (учебные рубли, без реальной оплаты) =====
        case 'topup':
            if ($method !== 'POST') {
                http_response_code(405);
                echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
                break;
            }
            $user = requireAuthUser();
            $body = jsonBodyUser();
            if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
                http_response_code(403);
                echo json_encode(['ok' => false, 'error' => 'Неверный CSRF-токен. Обнови страницу.'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $amount = (int)($body['amount'] ?? 0);
            if ($amount < 100 || $amount > 10000) {
                http_response_code(400);
                echo json_encode(['ok' => false, 'error' => 'Сумма от 100 до 10 000 ₽'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $pdo->prepare("UPDATE users SET balance = balance + ? WHERE id = ?")
                ->execute([$amount, (int)$user['id']]);
            $stmt = $pdo->prepare("SELECT balance FROM users WHERE id = ?");
            $stmt->execute([(int)$user['id']]);
            echo json_encode(['ok' => true, 'balance' => (int)$stmt->fetchColumn()], JSON_UNESCAPED_UNICODE);
            break;


        // ===== ЗАКРЕПИТЬ / ОТКРЕПИТЬ ИГРУ =====
        case 'pin':
            if ($method !== 'POST') {
                http_response_code(405);
                echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
                break;
            }
            $user = requireAuthUser();
            $body = jsonBodyUser();
            if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
                http_response_code(403);
                echo json_encode(['ok' => false, 'error' => 'Неверный CSRF-токен. Обнови страницу.'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $gameId = (int)($body['game_id'] ?? 0);
            $pinned = (int)($body['pinned'] ?? 0) ? 1 : 0;
            $uid = (int)$user['id'];

            $check = $pdo->prepare("SELECT id FROM library WHERE user_id = ? AND game_id = ?");
            $check->execute([$uid, $gameId]);
            if (!$check->fetch()) {
                http_response_code(404);
                echo json_encode(['ok' => false, 'error' => 'Игра не в библиотеке'], JSON_UNESCAPED_UNICODE);
                break;
            }

            $order = $pinned ? time() : 0;
            $pdo->prepare("UPDATE library SET is_pinned = ?, pinned_order = ? WHERE user_id = ? AND game_id = ?")
                ->execute([$pinned, $order, $uid, $gameId]);

            echo json_encode(['ok' => true, 'pinned' => $pinned], JSON_UNESCAPED_UNICODE);
            break;


        // ===== ЗАГРУЗКА АВАТАРА / БАННЕРА =====
        case 'upload':
            if ($method !== 'POST') {
                http_response_code(405);
                echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
                break;
            }
            $user = requireAuthUser();
            $kind = $_POST['kind'] ?? ''; // avatar | banner
            if (!in_array($kind, ['avatar', 'banner'], true)) {
                http_response_code(400);
                echo json_encode(['ok' => false, 'error' => 'kind: avatar или banner'], JSON_UNESCAPED_UNICODE);
                break;
            }
            // CSRF из form-data
            if (!verifyCsrfToken($_POST['csrf_token'] ?? '')) {
                http_response_code(403);
                echo json_encode(['ok' => false, 'error' => 'Неверный CSRF-токен. Обнови страницу.'], JSON_UNESCAPED_UNICODE);
                break;
            }
            if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                http_response_code(400);
                echo json_encode(['ok' => false, 'error' => 'Файл не загружен'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $file = $_FILES['file'];
            if ($file['size'] > 5 * 1024 * 1024) {
                http_response_code(400);
                echo json_encode(['ok' => false, 'error' => 'Максимум 5 МБ'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $finfo = new finfo(FILEINFO_MIME_TYPE);
            $mime = $finfo->file($file['tmp_name']);
            $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
            if (!isset($allowed[$mime])) {
                http_response_code(400);
                echo json_encode(['ok' => false, 'error' => 'Только JPG, PNG или WebP'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $ext = $allowed[$mime];
            $dir = dirname(__DIR__) . '/uploads/users';
            if (!is_dir($dir)) {
                mkdir($dir, 0755, true);
            }
            $uid = (int)$user['id'];
            $filename = $kind . '_' . $uid . '_' . time() . '.' . $ext;
            $dest = $dir . '/' . $filename;
            if (!move_uploaded_file($file['tmp_name'], $dest)) {
                http_response_code(500);
                echo json_encode(['ok' => false, 'error' => 'Не удалось сохранить файл'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $url = 'uploads/users/' . $filename;
            $col = $kind === 'avatar' ? 'avatar_url' : 'banner_url';
            $pdo->prepare("UPDATE users SET `$col` = ? WHERE id = ?")->execute([$url, $uid]);

            echo json_encode(['ok' => true, 'url' => $url, 'kind' => $kind], JSON_UNESCAPED_UNICODE);
            break;

        // ===== ОБНОВЛЕНИЕ ОТОБРАЖАЕМОГО ИМЕНИ =====
        case 'profile':
            if ($method !== 'POST') {
                http_response_code(405);
                echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
                break;
            }
            $user = requireAuthUser();
            $body = jsonBodyUser();
            if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
                http_response_code(403);
                echo json_encode(['ok' => false, 'error' => 'Неверный CSRF-токен. Обнови страницу.'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $display = trim($body['display_name'] ?? '');
            if ($display === '' || mb_strlen($display) > 32) {
                http_response_code(400);
                echo json_encode(['ok' => false, 'error' => 'Имя: 1–32 символа'], JSON_UNESCAPED_UNICODE);
                break;
            }
            // Проверка уникальности username
            $chk = $pdo->prepare("SELECT id FROM users WHERE username = ? AND id != ?");
            $chk->execute([$display, (int)$user['id']]);
            if ($chk->fetch()) {
                http_response_code(400);
                echo json_encode(['ok' => false, 'error' => 'Это имя уже занято'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $pdo->prepare("UPDATE users SET username = ? WHERE id = ?")->execute([$display, (int)$user['id']]);
            echo json_encode(['ok' => true, 'username' => $display], JSON_UNESCAPED_UNICODE);
            break;


        // ===== НАСТРОЙКА ОТОБРАЖЕНИЯ БАННЕРА (позиция / зум) =====
        case 'banner_display':
            if ($method !== 'POST') {
                http_response_code(405);
                echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
                break;
            }
            $user = requireAuthUser();
            $body = jsonBodyUser();
            if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
                http_response_code(403);
                echo json_encode(['ok' => false, 'error' => 'Неверный CSRF-токен. Обнови страницу.'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $pos = trim($body['pos'] ?? '50% 50%');
            $zoom = (float)($body['zoom'] ?? 1);
            $zoom = max(1.0, min(2.5, $zoom));
            // pos: "X% Y%"
            if (!preg_match('/^\d{1,3}%\s+\d{1,3}%$/', $pos)) {
                $pos = '50% 50%';
            }
            $pdo->prepare("UPDATE users SET banner_pos = ?, banner_zoom = ? WHERE id = ?")
                ->execute([$pos, $zoom, (int)$user['id']]);
            echo json_encode(['ok' => true, 'pos' => $pos, 'zoom' => $zoom], JSON_UNESCAPED_UNICODE);
            break;


        case 'settings':
            if ($method !== 'POST') {
                http_response_code(405);
                echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
                break;
            }
            $user = requireAuthUser();
            $body = jsonBodyUser();
            if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
                http_response_code(403);
                echo json_encode(['ok' => false, 'error' => 'Неверный CSRF-токен'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $uid = (int)$user['id'];
            $section = $body['section'] ?? 'general';

            if ($section === 'general') {
                $username = trim($body['username'] ?? '');
                $lang = $body['lang'] ?? 'ru';
                if ($username === '' || mb_strlen($username) > 32) {
                    http_response_code(400);
                    echo json_encode(['ok' => false, 'error' => 'Имя: 1–32 символа'], JSON_UNESCAPED_UNICODE);
                    break;
                }
                if (!in_array($lang, ['ru'], true)) $lang = 'ru';
                $chk = $pdo->prepare("SELECT id FROM users WHERE username = ? AND id != ?");
                $chk->execute([$username, $uid]);
                if ($chk->fetch()) {
                    http_response_code(400);
                    echo json_encode(['ok' => false, 'error' => 'Это имя уже занято'], JSON_UNESCAPED_UNICODE);
                    break;
                }
                $pdo->prepare("UPDATE users SET username = ?, lang = ? WHERE id = ?")->execute([$username, $lang, $uid]);
                echo json_encode(['ok' => true, 'username' => $username, 'lang' => $lang], JSON_UNESCAPED_UNICODE);
                break;
            }

            if ($section === 'notifications') {
                $prefs = $body['prefs'] ?? [];
                if (!is_array($prefs)) $prefs = [];
                $json = json_encode($prefs, JSON_UNESCAPED_UNICODE);
                $pdo->prepare("UPDATE users SET notif_prefs = ? WHERE id = ?")->execute([$json, $uid]);
                echo json_encode(['ok' => true, 'prefs' => $prefs], JSON_UNESCAPED_UNICODE);
                break;
            }

            if ($section === 'privacy') {
                $pvis = $body['profile_visibility'] ?? 'public';
                $mvis = $body['media_visibility'] ?? 'public';
                $allow = !empty($body['allow_friend_requests']) ? 1 : 0;
                $email = trim($body['email'] ?? '');
                if (!in_array($pvis, ['public','friends','hidden'], true)) $pvis = 'public';
                if (!in_array($mvis, ['public','friends','hidden'], true)) $mvis = 'public';
                if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                    http_response_code(400);
                    echo json_encode(['ok' => false, 'error' => 'Некорректный email'], JSON_UNESCAPED_UNICODE);
                    break;
                }
                $chk = $pdo->prepare("SELECT id FROM users WHERE email = ? AND id != ?");
                $chk->execute([$email, $uid]);
                if ($chk->fetch()) {
                    http_response_code(400);
                    echo json_encode(['ok' => false, 'error' => 'Email уже занят'], JSON_UNESCAPED_UNICODE);
                    break;
                }
                $pdo->prepare("UPDATE users SET profile_visibility = ?, media_visibility = ?, allow_friend_requests = ?, email = ? WHERE id = ?")
                    ->execute([$pvis, $mvis, $allow, $email, $uid]);
                echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
                break;
            }

            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Unknown section'], JSON_UNESCAPED_UNICODE);
            break;

        default:
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Unknown action'], JSON_UNESCAPED_UNICODE);
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
}
