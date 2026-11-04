<?php
// CATio — API авторизации
require_once __DIR__ . '/../auth.php';

header('Content-Type: application/json; charset=utf-8');

$action = $_GET['action'] ?? $_POST['action'] ?? '';

// Любая ошибка (БД, PHP) возвращается JSON'ом — клиент покажет её текстом,
// а не будет молча крутить форму
set_exception_handler(function ($e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Ошибка сервера: ' . $e->getMessage()], JSON_UNESCAPED_UNICODE);
    exit;
});

// ===== ДИАГНОСТИКА (открой в браузере: api/auth.php?action=diag) =====
if ($action === 'diag') {
    $out = ['php' => PHP_VERSION];
    try {
        $db = getDB();
        $out['db'] = 'подключение ок, база ' . DB_NAME;

        // Полные типы колонок — вдруг таблица осталась от старой схемы
        $cols = $db->query("SELECT COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('users','sessions')
            ORDER BY TABLE_NAME, ORDINAL_POSITION")->fetchAll();
        foreach ($cols as $c) {
            $out['columns'][] = $c['COLUMN_NAME'] . ' : ' . $c['COLUMN_TYPE'];
        }

        $out['users_count'] = (int)$db->query("SELECT COUNT(*) FROM users")->fetchColumn();
        $out['sessions_count'] = (int)$db->query("SELECT COUNT(*) FROM sessions")->fetchColumn();

        // Какие сессии вообще лежат в базе и не протухли ли они
        $out['sessions_rows'] = $db->query("SELECT id, user_id, expires_at, NOW() AS db_now,
            (expires_at > NOW()) AS is_valid FROM sessions LIMIT 5")->fetchAll();
    } catch (Throwable $e) {
        $out['db_error'] = $e->getMessage();
    }

    // Зомби-кука от старой версии (должна игнорироваться)
    if (!empty($_COOKIE['catio_session'])) {
        $out['legacy_cookie_catio_session'] = 'есть (зомби, игнорируется): ' . substr($_COOKIE['catio_session'], 0, 12) . '...';
    }

    // Рабочая кука
    if (!empty($_COOKIE['catio_sid'])) {
        $t = $_COOKIE['catio_sid'];
        $out['cookie'] = 'catio_sid есть, длина ' . strlen($t) . ', начало: ' . substr($t, 0, 12) . '...';
        try {
            $db = getDB();
            $stmt = $db->prepare("SELECT COUNT(*) FROM sessions WHERE id = ?");
            $stmt->execute([$t]);
            $out['session_row_exists'] = $stmt->fetchColumn() > 0 ? 'да' : 'НЕТ';
        } catch (Throwable $e) {
            $out['session_check_error'] = $e->getMessage();
        }
    } else {
        $out['cookie'] = 'catio_sid НЕТ — браузер не прислал рабочую куку';
    }

    $u = getCurrentUser();
    $out['current_user'] = $u ? $u['username'] : 'не авторизован';

    echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

switch ($action) {

    // ===== РЕГИСТРАЦИЯ =====
    case 'register':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            http_response_code(405);
            echo json_encode(['success' => false, 'error' => 'Method not allowed']);
            exit;
        }

        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body) $body = $_POST;

        // CSRF
        if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Invalid CSRF token']);
            exit;
        }

        $username = trim($body['username'] ?? '');
        $email = trim($body['email'] ?? '');
        $password = $body['password'] ?? '';

        // Валидация
        $errors = [];
        if ($err = validateUsername($username)) $errors['username'] = $err;
        if ($err = validateEmail($email)) $errors['email'] = $err;
        if ($err = validatePassword($password)) $errors['password'] = $err;

        if (!empty($errors)) {
            http_response_code(422);
            echo json_encode(['success' => false, 'errors' => $errors]);
            exit;
        }

        $result = registerUser($username, $email, $password);
        if (!$result['success']) {
            http_response_code(422);
            echo json_encode(['success' => false, 'error' => $result['error']]);
            exit;
        }

        echo json_encode(['success' => true, 'user_id' => $result['user_id'], 'role' => $result['role']]);
        break;

    // ===== ВХОД =====
    case 'login':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            http_response_code(405);
            echo json_encode(['success' => false, 'error' => 'Method not allowed']);
            exit;
        }

        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body) $body = $_POST;

        if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Invalid CSRF token']);
            exit;
        }

        $email = trim($body['email'] ?? '');
        $password = $body['password'] ?? '';

        $errors = [];
        if ($err = validateEmail($email)) $errors['email'] = $err;
        if (empty($password)) $errors['password'] = 'Введите пароль';

        if (!empty($errors)) {
            http_response_code(422);
            echo json_encode(['success' => false, 'errors' => $errors]);
            exit;
        }

        $result = loginUser($email, $password);
        if (!$result['success']) {
            http_response_code(401);
            echo json_encode(['success' => false, 'error' => $result['error']]);
            exit;
        }

        echo json_encode(['success' => true, 'user_id' => $result['user_id']]);
        break;

    // ===== ВЫХОД =====
    case 'logout':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            http_response_code(405);
            echo json_encode(['success' => false, 'error' => 'Method not allowed']);
            exit;
        }

        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body) $body = $_POST;

        if (!verifyCsrfToken($body['csrf_token'] ?? '')) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Invalid CSRF token']);
            exit;
        }

        logoutUser();
        echo json_encode(['success' => true]);
        break;

    // ===== СОСТОЯНИЕ =====
    case 'state':
    default:
        echo json_encode(getAuthState());
        break;
}
