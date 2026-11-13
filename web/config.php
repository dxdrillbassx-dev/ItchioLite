<?php
// CATio — конфигурация
define('SITE_NAME', 'CATio');
define('SITE_URL', 'http://localhost/itch-steam-like/');

// Первый пользователь — админ (автоматически)
define('START_BALANCE_ADMIN', 10000);
define('START_BALANCE_USER', 0);

define('STEAMGRIDDB_API_KEY', '078ede6f92f4b683f467e55d16061c22');

// local | prod — в проде: display_errors=0, логи в web/tmp/php-errors.log
if (!defined('CATIO_ENV')) {
    define('CATIO_ENV', getenv('CATIO_ENV') ?: 'local');
}
if (!defined('CATIO_PROD')) {
    define('CATIO_PROD', CATIO_ENV === 'prod' || CATIO_ENV === 'production');
}
