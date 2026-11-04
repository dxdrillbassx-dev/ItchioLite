<?php
// CATio — система авторизации
require_once __DIR__ . '/db.php';

// PHP-сессия (CSRF) живёт 30 дней — клиент не будет слетать при каждом запуске
$sessionLifetime = 60 * 60 * 24 * 30;
session_set_cookie_params([
    'lifetime' => $sessionLifetime,
    'path' => '/',
    'httponly' => true,
    'samesite' => 'Lax',
]);
ini_set('session.gc_maxlifetime', (string)$sessionLifetime);
session_start();

// ========== CSRF ==========
function generateCsrfToken() {
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function verifyCsrfToken($token) {
    return isset($_SESSION['csrf_token']) && hash_equals($_SESSION['csrf_token'], $token);
}

// ========== ВАЛИДАЦИЯ ==========
function validateUsername($username) {
    // 2-32 символа, буквы/цифры/подчёркивание/дефис
    if (empty($username) || strlen($username) < 2 || strlen($username) > 32) {
        return 'Имя должно быть от 2 до 32 символов';
    }
    if (!preg_match('/^[\p{L}\p{N}_\-]+$/u', $username)) {
        return 'Имя может содержать только буквы, цифры, _ и -';
    }
    return null;
}

function validateEmail($email) {
    if (empty($email) || strlen($email) > 255) {
        return 'Email обязателен (макс. 255 символов)';
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return 'Некорректный email';
    }
    return null;
}

function validatePassword($password) {
    if (empty($password) || strlen($password) < 8) {
        return 'Пароль должен быть минимум 8 символов';
    }
    if (strlen($password) > 72) {
        return 'Пароль слишком длинный (макс. 72)';
    }
    return null;
}

// ========== СЕССИИ ==========
function createSession($userId) {
    $db = getDB();
    $token = bin2hex(random_bytes(32));
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $ua = substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255);

    $stmt = $db->prepare("INSERT INTO sessions (id, user_id, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))");
    $stmt->execute([$token, $userId, $ip, $ua]);

    // Проверяем, что строка реально появилась в базе — иначе кука будет «мёртвой»:
    // браузер её шлёт, а сессии в таблице нет
    $check = $db->prepare("SELECT COUNT(*) FROM sessions WHERE id = ?");
    $check->execute([$token]);
    if ($check->fetchColumn() == 0) {
        throw new RuntimeException('Сессия не сохранилась в базе — проверь таблицу sessions в phpMyAdmin');
    }

    // Зачищаем «зомби»-куки прошлых версий: куки с разными path сосуществуют,
    // и старая (без явного path браузер прибивал её к /itch-steam-like/api)
    // перекрывала новую — сервер видел дохлый токен и не пускал.
    clearAuthCookies();

    // HttpOnly cookie, 30 дней. Имя catio_sid — НОВОЕ, чтобы застрявшая
    // зомби-кука catio_session больше не участвовала в авторизации вообще.
    setcookie('catio_sid', $token, [
        'expires' => time() + 30 * 24 * 3600,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);

    return $token;
}

// Удаляет auth-куки (старые и новые имена) на всех путях, где они могли застрять
function clearAuthCookies() {
    $paths = ['/', '/itch-steam-like/', '/itch-steam-like/api', '/itch-steam-like/api/'];
    foreach ($paths as $path) {
        setcookie('catio_session', '', ['expires' => 1, 'path' => $path]);
        setcookie('catio_sid', '', ['expires' => 1, 'path' => $path]);
    }
}

function destroySession($token) {
    $db = getDB();
    $stmt = $db->prepare("DELETE FROM sessions WHERE id = ?");
    $stmt->execute([$token]);
    clearAuthCookies();
}

function getCurrentUser() {
    if (empty($_COOKIE['catio_sid'])) return null;

    $db = getDB();
    $stmt = $db->prepare("
        SELECT u.id, u.username, u.email, u.role, u.balance, u.avatar, u.created_at
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND s.expires_at > NOW()
    ");
    $stmt->execute([$_COOKIE['catio_sid']]);
    $user = $stmt->fetch();

    return $user ?: null;
}

function isLoggedIn() {
    return getCurrentUser() !== null;
}

function isAdmin($user) {
    return $user && $user['role'] === 'admin';
}

// ========== РЕГИСТРАЦИЯ ==========
function registerUser($username, $email, $password) {
    $db = getDB();

    // Проверяем уникальность
    $stmt = $db->prepare("SELECT id FROM users WHERE username = ? OR email = ?");
    $stmt->execute([$username, $email]);
    if ($stmt->fetch()) {
        return ['success' => false, 'error' => 'Имя или email уже заняты'];
    }

    // Первый пользователь — админ и разработчик
    $stmt = $db->query("SELECT COUNT(*) as cnt FROM users");
    $isFirst = $stmt->fetch()['cnt'] == 0;
    $role = $isFirst ? 'admin' : 'user';

    $hash = password_hash($password, PASSWORD_ARGON2ID, ['memory_cost' => 65536, 'time_cost' => 4]);

    $stmt = $db->prepare("INSERT INTO users (username, email, password_hash, role, balance) VALUES (?, ?, ?, ?, ?)");
    $stmt->execute([$username, $email, $hash, $role, $isFirst ? 10000 : 0]);

    $userId = $db->lastInsertId();

    // Автоматический вход после регистрации
    createSession($userId);

    return ['success' => true, 'user_id' => $userId, 'role' => $role];
}

// ========== ВХОД ==========
function loginUser($email, $password) {
    $db = getDB();

    $stmt = $db->prepare("SELECT id, password_hash FROM users WHERE email = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        return ['success' => false, 'error' => 'Неверный email или пароль'];
    }

    // Re-hash если нужно
    if (password_needs_rehash($user['password_hash'], PASSWORD_ARGON2ID)) {
        $newHash = password_hash($password, PASSWORD_ARGON2ID);
        $stmt = $db->prepare("UPDATE users SET password_hash = ? WHERE id = ?");
        $stmt->execute([$newHash, $user['id']]);
    }

    createSession($user['id']);

    return ['success' => true, 'user_id' => $user['id']];
}

// ========== ВЫХОД ==========
function logoutUser() {
    if (!empty($_COOKIE['catio_sid'])) {
        destroySession($_COOKIE['catio_sid']);
    }
    session_destroy();
}

// ========== ЭКСПОРТ В JS ==========
function getAuthState() {
    $user = getCurrentUser();
    return [
        'authorized' => $user !== null,
        'user' => $user ? [
            'id' => (int)$user['id'],
            'username' => $user['username'],
            'email' => $user['email'],
            'role' => $user['role'],
            'balance' => (int)$user['balance'],
            'avatar' => $user['avatar'],
        ] : null,
        'csrf_token' => generateCsrfToken(),
    ];
}
