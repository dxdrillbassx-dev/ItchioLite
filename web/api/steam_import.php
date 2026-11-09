<?php
// Steam import disabled for diploma build. Use offline ZIP via tools/steam-export.bat
header('Content-Type: application/json; charset=utf-8');
http_response_code(403);
echo json_encode([
  'ok' => false,
  'error' => 'Импорт из Steam отключён. Используйте ZIP-пакет (tools/steam-export.bat).'
], JSON_UNESCAPED_UNICODE);
