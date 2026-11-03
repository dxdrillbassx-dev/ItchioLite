<?php
// Local XAMPP configuration
// Change these if your MySQL credentials are different

define('DB_HOST', '127.0.0.1');
define('DB_NAME', 'itch_steam_local');
define('DB_USER', 'root');
define('DB_PASS', '');          // default XAMPP password is empty
define('DB_CHARSET', 'utf8mb4');

// Auto-create tables on first request
define('AUTO_MIGRATE', true);