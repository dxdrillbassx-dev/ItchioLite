<?php
/**
 * CATio / IndieHub — helper для иконок.
 * Использование:
 *   <?= icon('home', 18) ?>
 *   <?= icon('downloads', 16, 'nav-ico') ?>
 */
function icon(string $name, int $size = 18, string $class = ''): string {
    static $cache = [];
    $path = __DIR__ . '/' . $name . '.svg';
    if (!isset($cache[$name])) {
        if (!is_file($path)) {
            return '<!-- icon not found: ' . htmlspecialchars($name) . ' -->';
        }
        $svg = file_get_contents($path);
        $svg = preg_replace('/<\?xml.*?\?>/', '', $svg);
        $cache[$name] = trim($svg);
    }
    $svg = $cache[$name];
    $cls = $class !== '' ? ' class="' . htmlspecialchars($class) . '"' : '';

    // Меняем width/height ТОЛЬКО у корневого <svg>, дочерние <rect width=...> не трогаем
    if (preg_match('/<svg\b([^>]*)>/', $svg, $m, PREG_OFFSET_CAPTURE)) {
        $attrs = $m[1][0];
        $attrs = preg_replace('/\s(width|height)="[^"]*"/', '', $attrs);
        $attrs = ' width="' . $size . '" height="' . $size . '"' . $cls . $attrs;
        $svg = substr($svg, 0, $m[0][1]) . '<svg' . $attrs . '>' . substr($svg, $m[0][1] + strlen($m[0][0]));
    }
    return $svg;
}
