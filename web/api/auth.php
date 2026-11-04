<?php
// CATio — API авторизации
require_once __DIR__ . '/../auth.php';

header('Content-Type: application/json; charset=utf-8');

$action = $_GET['action'] ?? $_POST['action'] ?? '';

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
