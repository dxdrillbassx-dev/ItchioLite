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

            // «Уровень» CATio: складывается из реальных действий
            $level = $games * 2 + $comments + $ratings;

            echo json_encode([
                'ok' => true,
                'stats' => [
                    'games' => $games,
                    'comments' => $comments,
                    'ratings' => $ratings,
                    'spent' => $spent,
                    'level' => $level,
                ],
            ], JSON_UNESCAPED_UNICODE);
            break;

        // ===== НЕДАВНЯЯ АКТИВНОСТЬ (покупки + комментарии) =====
        case 'activity':
            $user = requireAuthUser();
            $uid = (int)$user['id'];

            $stmt = $pdo->prepare("
                SELECT 'purchase' AS type, p.created_at AS ts, g.id AS game_id, g.title,
                       CONCAT('Получено «', g.title, '»', IF(p.price_paid > 0, CONCAT(' за ', FORMAT(p.price_paid, 0), ' ₽'), ' бесплатно')) AS text
                FROM purchases p JOIN games g ON g.id = p.game_id
                WHERE p.user_id = ?
                UNION ALL
                SELECT 'comment' AS type, c.created_at AS ts, g.id AS game_id, g.title,
                       CONCAT('Комментарий к «', g.title, '»: ', LEFT(c.body, 80), IF(CHAR_LENGTH(c.body) > 80, '…', '')) AS text
                FROM comments c JOIN games g ON g.id = c.game_id
                WHERE c.user_id = ?
                ORDER BY ts DESC
                LIMIT 10
            ");
            $stmt->execute([$uid, $uid]);
            echo json_encode(['ok' => true, 'activity' => $stmt->fetchAll()], JSON_UNESCAPED_UNICODE);
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

        default:
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Unknown action'], JSON_UNESCAPED_UNICODE);
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
}
