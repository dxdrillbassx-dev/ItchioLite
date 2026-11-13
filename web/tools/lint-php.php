<?php
/**
 * Lint all PHP under web/ (no Composer needed)
 * Usage: php tools/lint-php.php
 */
$root = dirname(__DIR__);
$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root));
$fail = 0;
$ok = 0;
foreach ($iterator as $file) {
    if (!$file->isFile()) continue;
    $path = $file->getPathname();
    if (substr($path, -4) !== '.php') continue;
    if (strpos($path, DIRECTORY_SEPARATOR . 'webview' . DIRECTORY_SEPARATOR) !== false) continue;
    $cmd = 'php -l ' . escapeshellarg($path) . ' 2>&1';
    $out = shell_exec($cmd);
    if ($out === null) {
        echo "FAIL (no output): $path\n";
        $fail++;
        continue;
    }
    if (strpos($out, 'No syntax errors') !== false) {
        $ok++;
    } else {
        echo $out;
        $fail++;
    }
}
echo "OK: $ok  FAIL: $fail\n";
exit($fail > 0 ? 1 : 0);
