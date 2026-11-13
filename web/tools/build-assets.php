<?php
/**
 * Build production JS bundle (optional).
 * Usage: php tools/build-assets.php
 * Output: js/app.bundle.js
 *
 * index.php can load the bundle when CATIO_USE_BUNDLE=1 or file exists + prod.
 */
$root = dirname(__DIR__);
$index = file_get_contents($root . '/index.php');
preg_match_all('#src="js/([^"?]+\.js)#', $index, $m);
$files = $m[1] ?? [];
// unique preserve order
$seen = [];
$ordered = [];
foreach ($files as $f) {
    if (isset($seen[$f])) continue;
    $seen[$f] = true;
    $ordered[] = $f;
}
$out = "/* CATio app.bundle.js — generated " . date('c') . " */\n";
$missing = [];
foreach ($ordered as $f) {
    $path = $root . '/js/' . $f;
    if (!is_file($path)) {
        $missing[] = $f;
        continue;
    }
    $out .= "\n;/* ==== $f ==== */\n";
    $out .= file_get_contents($path);
    $out .= "\n";
}
$dest = $root . '/js/app.bundle.js';
file_put_contents($dest, $out);
echo "Wrote $dest (" . strlen($out) . " bytes) from " . count($ordered) . " files\n";
if ($missing) {
    echo "Missing: " . implode(', ', $missing) . "\n";
}
