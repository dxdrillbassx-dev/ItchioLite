<?php
/**
 * CATio API bootstrap — общий старт для всех api/*.php
 * Подключает config/db/auth, JSON-заголовки, хелперы.
 */
declare(strict_types=1);

if (defined('CATIO_API_BOOTSTRAP')) {
    return;
}
define('CATIO_API_BOOTSTRAP', true);

while (ob_get_level() > 0) {
    @ob_end_clean();
}
ob_start();

foreach ([__DIR__ . '/../config.php', __DIR__ . '/config.php'] as $_cfg) {
    if (is_file($_cfg)) {
        require_once $_cfg;
        break;
    }
}
require_once __DIR__ . '/../db.php';
if (is_file(__DIR__ . '/../auth.php')) {
    require_once __DIR__ . '/../auth.php';
}
require_once __DIR__ . '/../includes/security.php';

if (!headers_sent()) {
    if (function_exists('catio_send_security_headers')) {
        catio_send_security_headers(true);
    } else {
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
    }
    // CORS: same-origin only. Uncomment if desktop webview needs it:
    // header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token');
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    exit(0);
}

set_exception_handler(static function (Throwable $e): void {
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode([
        'ok' => false,
        'error' => 'Ошибка сервера: ' . $e->getMessage(),
    ], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
});

if (!function_exists('jsonOut')) {
    /** @return never */
    function jsonOut($data, int $code = 200): void {
        while (ob_get_level() > 0) {
            @ob_end_clean();
        }
        if (!headers_sent()) {
            http_response_code($code);
            header('Content-Type: application/json; charset=utf-8');
        }
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        exit;
    }
}

if (!function_exists('jsonBody')) {
    function jsonBody(): array {
        $raw = file_get_contents('php://input');
        $b = is_string($raw) ? json_decode($raw, true) : null;
        return is_array($b) ? $b : $_POST;
    }
}

if (!function_exists('requireUser')) {
    function requireUser(): array {
        $u = function_exists('getCurrentUser') ? getCurrentUser() : null;
        if (!$u) {
            jsonOut(['ok' => false, 'error' => 'Нужно войти'], 401);
        }
        return $u;
    }
}

if (!function_exists('requireAdmin')) {
    function requireAdmin(): array {
        $u = requireUser();
        $role = $u['role'] ?? ($u['is_admin'] ?? '');
        $ok = ($role === 'admin' || $role === 'moderator' || !empty($u['is_admin']));
        if (!$ok) {
            jsonOut(['ok' => false, 'error' => 'Недостаточно прав'], 403);
        }
        return $u;
    }
}

if (!function_exists('checkCsrf')) {
    function checkCsrf(array $body): void {
        $token = $body['csrf'] ?? $body['csrf_token'] ?? $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (function_exists('verifyCsrfToken')) {
            if (!verifyCsrfToken((string)$token)) {
                jsonOut(['ok' => false, 'error' => 'CSRF'], 403);
            }
            return;
        }
        if (empty($_SESSION['csrf_token']) || !hash_equals((string)$_SESSION['csrf_token'], (string)$token)) {
            jsonOut(['ok' => false, 'error' => 'CSRF'], 403);
        }
    }
}

if (!function_exists('httpGetRaw')) {
    function httpGetRaw(string $url, int $timeout = 20): ?string {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => $timeout,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_SSL_VERIFYPEER => false,
                CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CATio/1.0',
                CURLOPT_HTTPHEADER => ['Accept-Language: ru-RU,ru;q=0.9,en;q=0.8'],
            ]);
            $raw = curl_exec($ch);
            $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            if ($raw === false || $code >= 400) {
                return null;
            }
            return $raw;
        }
        $ctx = stream_context_create([
            'http' => [
                'timeout' => $timeout,
                'header' => "User-Agent: CATio/1.0\r\nAccept-Language: ru,en\r\n",
            ],
            'ssl' => ['verify_peer' => false, 'verify_peer_name' => false],
        ]);
        $raw = @file_get_contents($url, false, $ctx);
        return $raw === false ? null : $raw;
    }
}

$pdo = getDB();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = $_GET['action'] ?? '';
