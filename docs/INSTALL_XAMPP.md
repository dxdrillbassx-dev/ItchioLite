# Установка на XAMPP (Windows)

## 1. XAMPP
1. Скачай XAMPP: https://www.apachefriends.org/
2. Установи
3. Запусти **Apache** и **MySQL** через Control Panel

## 2. Файлы проекта
Скопируй содержимое папки `web` в:
```
C:\xampp\htdocs\itch-steam-like\
```

Должно получиться:
```
C:\xampp\htdocs\itch-steam-like\index.php
C:\xampp\htdocs\itch-steam-like\config.php
C:\xampp\htdocs\itch-steam-like\db.php
C:\xampp\htdocs\itch-steam-like\api\games.php
C:\xampp\htdocs\itch-steam-like\css\style.css
C:\xampp\htdocs\itch-steam-like\js\app.js
```

## 3. Проверка
Открой в браузере:
```
http://localhost/itch-steam-like/
```

Если всё ок — увидишь магазин с играми.

## 4. База данных
При первом заходе таблицы создаются сами.

Можно посмотреть в phpMyAdmin:
```
http://localhost/phpmyadmin/
```
→ база `itch_steam_local`

## Если что-то не работает

### Ошибка подключения к MySQL
Открой `config.php` и проверь:
```php
define('DB_HOST', '127.0.0.1');
define('DB_USER', 'root');
define('DB_PASS', '');   // у XAMPP по умолчанию пустой пароль
```

### Белый экран / 500 ошибка
Включи отображение ошибок PHP (временно) в `index.php` в самом верху:
```php
ini_set('display_errors', 1);
error_reporting(E_ALL);
```

### API не отвечает
Проверь, что файл лежит по пути:
```
http://localhost/itch-steam-like/api/games.php?action=list
```
Должен вернуть JSON.