<?php
/**
 * CATio maintenance cron
 * Crontab example (every hour):
 *   0 * * * * php /path/to/web/cron.php >/dev/null 2>&1
 *
 * Or hit: https://yoursite/cron.php?key=YOUR_SECRET
 */
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/includes/security.php';

$key = getenv('CATIO_CRON_KEY') ?: '';
if ($key !== '') {
    $got = $_GET['key'] ?? '';
    if (!hash_equals($key, (string)$got) && (PHP_SAPI !== 'cli')) {
        http_response_code(403);
        echo "Forbidden\n";
        exit;
    }
}

$report = [];
$pdo = getDB();

// 1) expired sessions
try {
    $n = $pdo->exec("DELETE FROM sessions WHERE expires_at < NOW()");
    $report['sessions_deleted'] = $n === false ? 0 : $n;
} catch (Throwable $e) {
    $report['sessions_error'] = $e->getMessage();
}

// 2) old PHP session files (> 30 days)
$sessDir = __DIR__ . '/tmp/sessions';
$cut = time() - 30 * 86400;
$removed = 0;
if (is_dir($sessDir)) {
    foreach (glob($sessDir . '/sess_*') ?: [] as $f) {
        if (is_file($f) && filemtime($f) < $cut) {
            @unlink($f);
            $removed++;
        }
    }
}
$report['php_sess_files_removed'] = $removed;

// 3) rotate log if huge
$log = __DIR__ . '/tmp/php-errors.log';
if (is_file($log) && filesize($log) > 5 * 1024 * 1024) {
    @rename($log, $log . '.' . date('Ymd-His') . '.bak');
    $report['log_rotated'] = true;
}

$report['ok'] = true;
$report['at'] = date('c');

if (PHP_SAPI === 'cli') {
    echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
} else {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($report, JSON_UNESCAPED_UNICODE);
}
