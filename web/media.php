<?php
// CATio — картинки для игр.
// Если в папке covers/ лежит настоящий файл — отдаём его,
// иначе рисуем процедурный SVG (без GD и внешних файлов).
//
// Обложка:  media.php?type=cover&id=N   → covers/cover_N.jpg|png|webp
// Баннер:   media.php?type=hero&id=N    → covers/hero_N.*  (нет — берём cover_N.*, потом SVG)
// Иконка:   media.php?type=icon&id=N    → covers/icon_N.*  (нет — cover_N.*, потом SVG)
// Скриншот: media.php?type=shot&id=N&i=1..4 (всегда SVG)
require_once __DIR__ . '/db.php';

$type = $_GET['type'] ?? 'cover';
$id   = (int)($_GET['id'] ?? 0);
$i    = max(1, (int)($_GET['i'] ?? 1));

// ---------- настоящие файлы из web/covers/ ----------
function serveLocalImage(int $id, array $kinds): bool {
    $dir = __DIR__ . '/covers';
    $mimes = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];
    foreach ($kinds as $kind) {
        foreach ($mimes as $ext => $mime) {
            $file = "$dir/{$kind}_{$id}.{$ext}";
            if (is_file($file)) {
                header('Content-Type: ' . $mime);
                header('Cache-Control: public, max-age=3600');
                header('X-Content-Type-Options: nosniff');
                readfile($file);
                return true;
            }
        }
    }
    return false;
}

if ($id > 0 && $type !== 'shot') {
    if ($type === 'hero') {
        $kinds = ['hero', 'cover'];
    } elseif ($type === 'icon') {
        $kinds = ['icon', 'cover'];
    } else {
        $kinds = ['cover'];
    }
    if (serveLocalImage($id, $kinds)) {
        exit;
    }

    // Реальная обложка из БД (uploads/...), не процедурный SVG
    $pdo = getDB();
    $stmt = $pdo->prepare("SELECT title, slug, genre, category, cover_emoji, cover_color, cover_url, banner_url, icon_url FROM games WHERE id = ?");
    $stmt->execute([$id]);
    $game = $stmt->fetch() ?: null;
    if ($game) {
        $candidates = [];
        if ($type === 'hero') {
            if (!empty($game['banner_url'])) $candidates[] = $game['banner_url'];
            if (!empty($game['cover_url'])) $candidates[] = $game['cover_url'];
        } elseif ($type === 'icon') {
            if (!empty($game['icon_url'])) $candidates[] = $game['icon_url'];
            if (!empty($game['cover_url'])) $candidates[] = $game['cover_url'];
            if (!empty($game['banner_url'])) $candidates[] = $game['banner_url'];
            // Steam: capsule с CDN по appid из slug (...-s1091500)
            if (!empty($game['slug']) && preg_match('/-s(\d{3,10})$/', $game['slug'], $m)) {
                $aid = $m[1];
                $candidates[] = 'https://cdn.cloudflare.steamstatic.com/steam/apps/' . $aid . '/capsule_231x87.jpg';
                $candidates[] = 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/' . $aid . '/capsule_231x87.jpg';
            }
        } else {
            if (!empty($game['cover_url'])) $candidates[] = $game['cover_url'];
            if (!empty($game['banner_url'])) $candidates[] = $game['banner_url'];
        }
        foreach ($candidates as $url) {
            $url = str_replace('\\', '/', $url);
            // относительный путь от web/
            if (preg_match('#^https?://#i', $url)) {
                header('Location: ' . $url, true, 302);
                exit;
            }
            $local = __DIR__ . '/' . ltrim($url, '/');
            if (is_file($local)) {
                $ext = strtolower(pathinfo($local, PATHINFO_EXTENSION));
                $mimeMap = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif'];
                if (isset($mimeMap[$ext])) {
                    header('Content-Type: ' . $mimeMap[$ext]);
                    header('Cache-Control: public, max-age=3600');
                    header('X-Content-Type-Options: nosniff');
                    readfile($local);
                    exit;
                }
            }
        }
    }
} else {
    $game = null;
}

header('Content-Type: image/svg+xml; charset=utf-8');
header('Cache-Control: public, max-age=86400');
header('X-Content-Type-Options: nosniff');

if (!$game) {
    $pdo = getDB();
    $stmt = $pdo->prepare("SELECT title, slug, genre, category, cover_emoji, cover_color, cover_url, banner_url, icon_url FROM games WHERE id = ?");
    $stmt->execute([$id]);
    $game = $stmt->fetch();
}

if (!$game) {
    $game = ['title' => 'CATio', 'genre' => '', 'category' => 'game', 'cover_emoji' => '🐈', 'cover_color' => '#ef5b2c'];
}

// ---------- цветовые утилиты ----------
function hexToRgb(string $hex): array {
    $hex = ltrim($hex, '#');
    if (strlen($hex) !== 6) $hex = 'ef5b2c';
    return [hexdec(substr($hex, 0, 2)), hexdec(substr($hex, 2, 2)), hexdec(substr($hex, 4, 2))];
}

function shade(string $hex, float $k): string {
    // k < 1 — темнее, k > 1 — светлее
    [$r, $g, $b] = hexToRgb($hex);
    $clamp = fn($v) => max(0, min(255, (int)round($v)));
    return sprintf('#%02x%02x%02x', $clamp($r * $k), $clamp($g * $k), $clamp($b * $k));
}

function mix(string $hexA, string $hexB, float $t): string {
    [$r1, $g1, $b1] = hexToRgb($hexA);
    [$r2, $g2, $b2] = hexToRgb($hexB);
    $clamp = fn($v) => max(0, min(255, (int)round($v)));
    return sprintf('#%02x%02x%02x', $clamp($r1 + ($r2 - $r1) * $t), $clamp($g1 + ($g2 - $g1) * $t), $clamp($b1 + ($b2 - $b1) * $t));
}

// ---------- детерминированный рандом ----------
function mulberry32(int $seed): callable {
    return function () use (&$seed) {
        $seed = ($seed + 0x6D2B79F5) & 0xFFFFFFFF;
        $t = $seed;
        $t = (($t ^ ($t >> 15)) * ($t | 1)) & 0xFFFFFFFF;
        $t ^= ($t + ((($t ^ ($t >> 7)) * ($t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF;
        return (($t ^ ($t >> 14)) & 0xFFFFFFFF) / 4294967296.0;
    };
}

function esc(string $s): string {
    return htmlspecialchars($s, ENT_QUOTES | ENT_XML1, 'UTF-8');
}

$color = $game['cover_color'] ?: '#ef5b2c';
$title = $game['title'];
$emoji = $game['cover_emoji'] ?: '🎮';

if ($type === 'shot') {
    renderShot($title, $color, $id, $i);
} else {
    // cover / hero / icon без файла — рисуем SVG-обложку
    renderCover($title, $emoji, $color, $game['genre'], $game['category'], $id);
}
exit;

// ============================================================
//  ОБЛОЖКА 640×360
// ============================================================
function renderCover(string $title, string $emoji, string $color, string $genre, string $category, int $id): void {
    $rand = mulberry32(crc32('cover' . $id));
    $dark  = shade($color, 0.18);
    $mid   = shade($color, 0.45);
    $light = shade($color, 1.35);

    // Декоративные диагональные полосы
    $stripes = '';
    for ($k = 0; $k < 6; $k++) {
        $x = -200 + $k * 160 + (int)($rand() * 40);
        $op = 0.05 + $rand() * 0.08;
        $stripes .= '<rect x="' . $x . '" y="-120" width="46" height="700" fill="' . $light . '" opacity="' . round($op, 3) . '" transform="rotate(24 320 180)"/>';
    }

    // Пиксельный горизонт внизу
    $blocks = '';
    $y0 = 316;
    for ($x = 0; $x < 640; $x += 16) {
        $h = 8 + (int)($rand() * 28);
        $op = 0.25 + $rand() * 0.3;
        $blocks .= '<rect x="' . $x . '" y="' . ($y0 + 44 - $h) . '" width="16" height="' . $h . '" fill="' . $dark . '" opacity="' . round($op, 2) . '"/>';
    }

    $badge = $category === 'asset' ? 'АССЕТ' : strtoupper(mb_substr($genre, 0, 18));

    echo '<?xml version="1.0" encoding="UTF-8"?>';
    ?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="<?= esc($mid) ?>"/>
      <stop offset="1" stop-color="<?= esc($dark) ?>"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.42" r="0.55">
      <stop offset="0" stop-color="<?= esc($light) ?>" stop-opacity="0.55"/>
      <stop offset="1" stop-color="<?= esc($light) ?>" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="640" height="360" fill="url(#bg)"/>
  <rect width="640" height="360" fill="url(#glow)"/>
  <?= $stripes ?>
  <?= $blocks ?>
  <text x="320" y="205" font-size="120" text-anchor="middle" font-family="'Segoe UI Emoji','Noto Color Emoji',sans-serif"><?= esc($emoji) ?></text>
  <rect x="20" y="20" rx="8" width="<?= 24 + mb_strlen($badge) * 9 ?>" height="26" fill="#12110e" opacity="0.75"/>
  <text x="32" y="38" font-size="13" font-weight="700" letter-spacing="1.5" fill="#f0ebe3" font-family="Inter,system-ui,sans-serif"><?= esc($badge) ?></text>
  <text x="24" y="330" font-size="30" font-weight="800" fill="#ffffff" font-family="Inter,system-ui,sans-serif" style="paint-order:stroke" stroke="#12110e" stroke-width="6"><?= esc($title) ?></text>
</svg>
<?php
}

// ============================================================
//  СКРИНШОТ 960×540 — псевдо-сцена в пиксель-стиле
// ============================================================
function renderShot(string $title, string $color, int $id, int $i): void {
    $rand = mulberry32(crc32('shot' . $id . ':' . $i));

    $sky1 = shade($color, 0.30);
    $sky2 = mix(shade($color, 0.10), '#12110e', 0.4);
    $hillFar  = shade($color, 0.32);
    $hillNear = shade($color, 0.22);
    $ground   = shade($color, 0.14);
    $accent   = shade($color, 1.4);

    // звёзды
    $stars = '';
    for ($k = 0; $k < 46; $k++) {
        $x = (int)($rand() * 960);
        $y = (int)($rand() * 260);
        $r = 1 + (int)($rand() * 2);
        $op = 0.25 + $rand() * 0.6;
        $stars .= '<circle cx="' . $x . '" cy="' . $y . '" r="' . $r . '" fill="#f0ebe3" opacity="' . round($op, 2) . '"/>';
    }

    // луна
    $moonX = 120 + (int)($rand() * 700);
    $moon = '<circle cx="' . $moonX . '" cy="90" r="34" fill="#f0ebe3" opacity="0.9"/>'
          . '<circle cx="' . ($moonX + 14) . '" cy="82" r="30" fill="' . esc($sky1) . '" opacity="0.55"/>';

    // дальние холмы
    $pts = '0,540 0,' . (300 + (int)($rand() * 60));
    for ($x = 0; $x <= 960; $x += 80) {
        $pts .= ' ' . $x . ',' . (250 + (int)($rand() * 110));
    }
    $pts .= ' 960,540';
    $far = '<polygon points="' . $pts . '" fill="' . esc($hillFar) . '"/>';

    // ближние холмы
    $pts = '0,540 0,' . (400 + (int)($rand() * 40));
    for ($x = 0; $x <= 960; $x += 64) {
        $pts .= ' ' . $x . ',' . (360 + (int)($rand() * 90));
    }
    $pts .= ' 960,540';
    $near = '<polygon points="' . $pts . '" fill="' . esc($hillNear) . '"/>';

    // пиксельные деревья/башни на земле
    $trees = '';
    $gy = 480;
    for ($x = 20; $x < 940; $x += 34 + (int)($rand() * 50)) {
        $h = 24 + (int)($rand() * 60);
        $w = 12 + (int)($rand() * 18);
        $trees .= '<rect x="' . $x . '" y="' . ($gy - $h) . '" width="' . $w . '" height="' . $h . '" fill="' . esc($ground) . '"/>';
        if ($rand() > 0.45) {
            $trees .= '<rect x="' . ($x - 4) . '" y="' . ($gy - $h - 12) . '" width="' . ($w + 8) . '" height="12" fill="' . esc(shade($color, 0.5)) . '"/>';
        }
    }

    // окна/искры на земле
    $lights = '';
    for ($k = 0; $k < 22; $k++) {
        $x = (int)($rand() * 940) + 10;
        $y = $gy - (int)($rand() * 60);
        $lights .= '<rect x="' . $x . '" y="' . $y . '" width="4" height="4" fill="' . esc($accent) . '" opacity="' . round(0.5 + $rand() * 0.5, 2) . '"/>';
    }

    echo '<?xml version="1.0" encoding="UTF-8"?>';
    ?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="<?= esc($sky2) ?>"/>
      <stop offset="1" stop-color="<?= esc($sky1) ?>"/>
    </linearGradient>
  </defs>
  <rect width="960" height="540" fill="url(#sky)"/>
  <?= $stars ?>
  <?= $moon ?>
  <?= $far ?>
  <?= $near ?>
  <rect x="0" y="480" width="960" height="60" fill="<?= esc($ground) ?>"/>
  <?= $trees ?>
  <?= $lights ?>
  <rect x="0" y="480" width="960" height="4" fill="<?= esc($accent) ?>" opacity="0.5"/>
  <text x="944" y="524" font-size="14" text-anchor="end" fill="#f0ebe3" opacity="0.55" font-family="Inter,system-ui,sans-serif">CATio · <?= esc($title) ?> · <?= $i ?></text>
</svg>
<?php
}
