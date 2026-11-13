<?php
/**
 * CATio — security helpers: errors, CSP, uploads, HTML sanitize
 */
if (defined('CATIO_SECURITY_LOADED')) {
    return;
}
define('CATIO_SECURITY_LOADED', true);

// config optional
$cfg = dirname(__DIR__) . '/config.php';
if (is_file($cfg)) {
    require_once $cfg;
}
if (!defined('CATIO_PROD')) {
    define('CATIO_PROD', false);
}

// ----- PHP errors: never dump HTML to clients in prod -----
$logDir = dirname(__DIR__) . '/tmp';
if (!is_dir($logDir)) {
    @mkdir($logDir, 0700, true);
}
$logFile = $logDir . '/php-errors.log';
@ini_set('log_errors', '1');
@ini_set('error_log', $logFile);
if (CATIO_PROD) {
    @ini_set('display_errors', '0');
    @ini_set('display_startup_errors', '0');
    error_reporting(E_ALL & ~E_NOTICE & ~E_DEPRECATED & ~E_STRICT);
} else {
    // local: still log; display optional
    @ini_set('display_errors', getenv('CATIO_DISPLAY_ERRORS') === '0' ? '0' : '1');
}

/**
 * Security headers (CSP + basics). Call once per response.
 */
function catio_send_security_headers(bool $isApi = false): void {
    if (headers_sent()) {
        return;
    }
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    // Pragmatic CSP: app uses inline scripts/styles in index.php
    $csp = [
        "default-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        "frame-ancestors 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: blob: https:",
        "media-src 'self' data: blob: https:",
        "font-src 'self' data: https://fonts.gstatic.com",
        "connect-src 'self'",
        "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
    ];
    header('Content-Security-Policy: ' . implode('; ', $csp));
    if ($isApi) {
        header('Content-Type: application/json; charset=utf-8');
    }
}

/** MIME → extension maps */
function catio_upload_map(string $kind = 'image'): array {
    if ($kind === 'image') {
        return [
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
            'image/gif' => 'gif',
        ];
    }
    if ($kind === 'archive') {
        return [
            'application/zip' => 'zip',
            'application/x-zip-compressed' => 'zip',
            'application/x-rar-compressed' => 'rar',
            'application/vnd.rar' => 'rar',
            'application/x-7z-compressed' => '7z',
            'application/octet-stream' => 'bin', // last resort, filtered by extension below
        ];
    }
    return catio_upload_map('image');
}

/**
 * Safe upload: size + finfo MIME + extension whitelist.
 * @param array $file one $_FILES[...] entry
 * @param string $destDir absolute directory
 * @param array $mimeToExt map mime => ext
 * @param int $maxMb
 * @param array|null $extWhitelist optional extra ext filter e.g. ['jpg','png']
 * @return string basename of saved file
 */
function catio_save_upload(array $file, string $destDir, array $mimeToExt, int $maxMb = 8, ?array $extWhitelist = null): string {
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        throw new RuntimeException('Файл не загружен');
    }
    if (($file['size'] ?? 0) > $maxMb * 1024 * 1024) {
        throw new RuntimeException("Файл больше {$maxMb} МБ");
    }
    $tmp = $file['tmp_name'] ?? '';
    if ($tmp === '' || !is_uploaded_file($tmp)) {
        throw new RuntimeException('Некорректный upload');
    }
    if (!class_exists('finfo')) {
        throw new RuntimeException('finfo недоступен на сервере');
    }
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = $finfo->file($tmp) ?: '';
    if ($mime === '' || !isset($mimeToExt[$mime])) {
        throw new RuntimeException('Недопустимый тип файла (' . $mime . ')');
    }
    $ext = $mimeToExt[$mime];
    // client filename extension check (polyglot defense)
    $orig = strtolower(pathinfo((string)($file['name'] ?? ''), PATHINFO_EXTENSION));
    if ($extWhitelist !== null) {
        $extWhitelist = array_map('strtolower', $extWhitelist);
        if ($orig !== '' && !in_array($orig, $extWhitelist, true)) {
            throw new RuntimeException('Недопустимое расширение .' . $orig);
        }
        if (!in_array($ext, $extWhitelist, true)) {
            throw new RuntimeException('Недопустимый тип');
        }
    }
    // reject double extensions like file.php.jpg is ok; file.jpg.php is not ($orig=php)
    if (preg_match('/ph(p|ar|tml|ps)|phtml|cgi|exe|js|shtml/i', $orig)) {
        throw new RuntimeException('Запрещённое расширение');
    }
    if (!is_dir($destDir)) {
        if (!@mkdir($destDir, 0755, true) && !is_dir($destDir)) {
            throw new RuntimeException('Не удалось создать каталог');
        }
    }
    $name = bin2hex(random_bytes(8)) . '_' . time() . '.' . $ext;
    $dest = rtrim($destDir, '/\\') . DIRECTORY_SEPARATOR . $name;
    if (!move_uploaded_file($tmp, $dest)) {
        throw new RuntimeException('Не удалось сохранить файл');
    }
    @chmod($dest, 0644);
    return $name;
}

/**
 * Server-side HTML sanitize for game descriptions (aligned with JS whitelist).
 */
function catio_sanitize_html(string $html, int $maxLen = 100000): string {
    $html = trim($html);
    if ($html === '') {
        return '';
    }
    if (mb_strlen($html) > $maxLen) {
        $html = mb_substr($html, 0, $maxLen);
    }
    // plain text path
    if (!preg_match('/<[a-z][\s\S]*>/i', $html)) {
        return $html;
    }
    if (!class_exists('DOMDocument')) {
        return strip_tags($html, '<p><br><b><strong><i><em><u><ul><ol><li><a><img><h1><h2><h3><h4><h5><span><div><hr><table><thead><tbody><tr><th><td><video><source>');
    }
    $allowed = [
        'p' => true, 'br' => true, 'b' => true, 'strong' => true, 'i' => true, 'em' => true, 'u' => true,
        'ul' => true, 'ol' => true, 'li' => true, 'a' => true, 'img' => true,
        'h1' => true, 'h2' => true, 'h3' => true, 'h4' => true, 'h5' => true,
        'span' => true, 'div' => true, 'hr' => true,
        'table' => true, 'thead' => true, 'tbody' => true, 'tr' => true, 'th' => true, 'td' => true,
        'video' => true, 'source' => true, 'iframe' => true,
    ];
    $libxml = libxml_use_internal_errors(true);
    $doc = new DOMDocument();
    $wrapped = '<?xml encoding="utf-8"><div id="catio-root">' . $html . '</div>';
    $doc->loadHTML($wrapped, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);
    $root = $doc->getElementById('catio-root');
    if (!$root) {
        libxml_clear_errors();
        libxml_use_internal_errors($libxml);
        return strip_tags($html);
    }
    $walk = function (DOMNode $node) use (&$walk, $allowed) {
        if ($node->nodeType === XML_ELEMENT_NODE) {
            $tag = strtolower($node->nodeName);
            if (!isset($allowed[$tag])) {
                // unwrap: keep children
                while ($node->firstChild) {
                    $node->parentNode->insertBefore($node->firstChild, $node);
                }
                $node->parentNode->removeChild($node);
                return;
            }
            if ($node->hasAttributes()) {
                $remove = [];
                foreach ($node->attributes as $attr) {
                    $n = strtolower($attr->name);
                    $v = trim($attr->value);
                    if (str_starts_with($n, 'on') || $n === 'style' || $n === 'srcdoc' || $n === 'class' || $n === 'formaction') {
                        $remove[] = $attr->name;
                        continue;
                    }
                    if (in_array($n, ['href', 'src', 'poster'], true) && preg_match('#^\s*(javascript:|data:|vbscript:)#i', $v)) {
                        $remove[] = $attr->name;
                        continue;
                    }
                    if ($tag === 'a' && $n === 'href' && !preg_match('#^https?://#i', $v)) {
                        $remove[] = $attr->name;
                    }
                    if ($tag === 'img' && $n === 'src' && !preg_match('#^https?://#i', $v) && !preg_match('#^(uploads/|media\.php)#i', $v)) {
                        $remove[] = $attr->name;
                    }
                    if ($tag === 'iframe' && $n === 'src' && !preg_match('#^https://(www\.)?(youtube\.com|youtube-nocookie\.com|player\.vimeo\.com)/#i', $v)) {
                        $remove[] = $attr->name;
                    }
                }
                foreach ($remove as $r) {
                    $node->removeAttribute($r);
                }
            }
            if ($tag === 'a') {
                $node->setAttribute('rel', 'noopener noreferrer');
                $node->setAttribute('target', '_blank');
            }
        }
        $children = [];
        foreach ($node->childNodes as $ch) {
            $children[] = $ch;
        }
        foreach ($children as $ch) {
            $walk($ch);
        }
    };
    $walk($root);
    $out = '';
    foreach ($root->childNodes as $ch) {
        $out .= $doc->saveHTML($ch);
    }
    libxml_clear_errors();
    libxml_use_internal_errors($libxml);
    return $out;
}
