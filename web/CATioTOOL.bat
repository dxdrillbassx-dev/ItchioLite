@echo off

mode con cols=110 lines=25

setlocal EnableExtensions
chcp 65001 >nul
title ItchioLite - CATio Tools

for /f %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"
set "FIRST_RUN=1"

set "SCRIPT_DIR=%~dp0"
set "CONFIG_FILE=%SCRIPT_DIR%config.ini"
set "SITE_PATH="
set "SITE_ROOT="
set "PHP_PATH="
set "EXPORT_PATH="
set "OUT_DIR="
set "KEEP_DIR="

if exist "%CONFIG_FILE%" call :load_config





:check_site
if not "%SITE_PATH%"=="" if exist "%SITE_PATH%\index.php" goto site_ok

if not "%SITE_PATH%"=="" if exist "%SITE_PATH%\web\index.php" (
    set "SITE_PATH=%SITE_PATH%\web"
    goto site_ok
)

echo.
echo Введите путь к папке CATio.
echo В ней должен находиться index.php
echo Пример: C:\xampp\htdocs\itch-steam-like
echo.
set /p SITE_PATH=Путь: 

if "%SITE_PATH%"=="" goto check_site

if exist "%SITE_PATH%\web\index.php" if not exist "%SITE_PATH%\index.php" (
    set "SITE_PATH=%SITE_PATH%\web"
)

if not exist "%SITE_PATH%\index.php" (
    echo.
    echo %ESC%[91m[ОШИБКА]%ESC%[0m index.php не найден!
    set "SITE_PATH="
    pause
    goto check_site
)

:site_ok
for %%I in ("%SITE_PATH%") do set "SITE_PATH=%%~fI"

if /i "%SITE_PATH:~-4%"=="\web" (
    for %%I in ("%SITE_PATH%\..") do set "SITE_ROOT=%%~fI"
) else (
    set "SITE_ROOT=%SITE_PATH%"
)

set "KEEP_DIR=%SITE_ROOT%\uploads\game_packs\_cli_export"

echo.
echo Сайт: %SITE_PATH%

:check_php
if not "%PHP_PATH%"=="" if exist "%PHP_PATH%" goto php_ok

set "PHP_PATH="

if exist "C:\xampp\php\php.exe" set "PHP_PATH=C:\xampp\php\php.exe"
if "%PHP_PATH%"=="" if exist "D:\xampp\php\php.exe" set "PHP_PATH=D:\xampp\php\php.exe"
if "%PHP_PATH%"=="" if exist "C:\php\php.exe" set "PHP_PATH=C:\php\php.exe"

if "%PHP_PATH%"=="" (
    where php >nul 2>&1
    if not errorlevel 1 (
        for /f "delims=" %%P in ('where php') do (
            if "%PHP_PATH%"=="" set "PHP_PATH=%%P"
        )
    )
)

if "%PHP_PATH%"=="" (
    echo.
    echo PHP не найден. Укажите путь к php.exe.
    set /p PHP_PATH=Путь: 
)

if not exist "%PHP_PATH%" (
    echo.
    echo %ESC%[91m[ОШИБКА]%ESC%[0m php.exe не найден!
    set "PHP_PATH="
    goto check_php
)

:php_ok
echo PHP: %PHP_PATH%

if defined FIRST_RUN (
    <nul set /p "=%ESC%[90m  Загрузка CATio Tools%ESC%[0m"
    call :bar
    echo.
    set "FIRST_RUN="
)

set "CLI=%SITE_PATH%\tools\steam_export_cli.php"

if not exist "%CLI%" if exist "%SITE_ROOT%\tools\steam_export_cli.php" (
    set "CLI=%SITE_ROOT%\tools\steam_export_cli.php"
)

if not exist "%CLI%" if exist "%SCRIPT_DIR%steam_export_cli.php" (
    set "CLI=%SCRIPT_DIR%steam_export_cli.php"
)

if not exist "%CLI%" (
    echo.
    echo %ESC%[91m[ОШИБКА]%ESC%[0m steam_export_cli.php не найден!
    pause
    exit /b 1
)

if "%EXPORT_PATH%"=="" (
    set "OUT_DIR=%KEEP_DIR%"
) else (
    set "OUT_DIR=%EXPORT_PATH%"
)

if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

call :save_config


:menu
cls
echo                                                                     ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⡠⠔⠒⠊⠉⠉⠉⠉⠙⠋⠛⠻⠶⣢⢄⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
echo ⣿⣿⣿⣿⣿⣷⣿⣿⣿⡅⡹⢿⠆⠙⠋⠉⠻⠿⣿⣿⣿⣿⣿⣿⣮⠻⣦⡙⢷⡑⠘⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣌⠡⠌⠂⣙⠻⣛⠻⠷⠐⠈⠛⢱⣮⣷⣽⣿  C⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⠔⠊⠁⠉⠀⠀⠀⠀⠀⠀⠀⠀⢰⡆⠀⠀⣈⣑⢌⠳⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀
echo ⣿⣿⣿⣿⡇⢿⢹⣿⣶⠐⠁⠀⣀⣠⣤⠄⠀⠀⠈⠙⠻⣿⣿⣿⣦⣵⣌⠻⣷⢝⠦⠚⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⢟⣻⣿⣊⡃⠀⣙⠿⣿⣿⣿⣎⢮⡀⢮⣽⣿⣿  A⠀⠀⠀⠀⠀⠀⠀⢀⣜⠁⣀⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡊⣟⢿⣷⡌⠳⡄⠀⠀⠀⠀⠀⠀⠀
echo ⢿⣿⣿⣿⣧⡸⡎⡛⡩⠖⠀⣴⣿⣿⣿⠀⠀⠀⠀⠸⠇⠀⠙⢿⣿⣿⣿⣷⣌⢷⣑⢷⣄⠻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⣫⠶⠛⠉⠀⠁⠀⠈⠈⠀⠠⠜⠻⣿⣆⢿⣼⣿⣿⣿  T⠀⠀⠀⠀⠀⠀⢠⣿⡷⠊⡁⠀⠀⠀⠀⣀⣠⠤⠤⠖⠒⠒⠒⠒⠐⠒⣓⡛⠊⠈⢷⢤⠜⢆⠀⠀⠀⠀⠀⠀
echo ⢐⣿⣿⣿⣿⣧⢧⣧⢻⣦⢀⣹⣿⣿⣿⣇⠀⠄⠀⠀⠀⡀⠀⠈⢻⣿⣿⣿⣿⣷⣝⢦⡹⠷⡙⢿⣿⣿⣿⣿⣿⣿⣿⣿⠈⠁⠀⠀⠀⠁⠀⠀⠀⠱⣶⣄⡀⠀⠈⠛⠜⣿⣿⣿⣿  i⠀⠀⠀⠀⠀⢠⣿⣿⣷⡯⠟⢀⡄⠀⠈⠁⠀⠀⠀⠀⠀⠀⠀⠀⣀⣀⣙⣁⣂⣀⡀⠹⠕⡢⢝⡢⢄⡀⠀⠀
echo ⠀⠊⢫⣿⣏⣿⡌⣼⣄⢫⡌⣿⣿⣿⣿⣿⣦⡈⠲⣄⣤⣤⡡⢀⣠⣿⣿⣿⣿⣿⣿⣷⣼⣍⢬⣦⡙⣿⣿⣿⣿⣿⣯⢁⡄⠀⡀⡀⠀⠄⢈⣠⢪⠀⣿⣿⣿⣦⠀⢉⢂⠹⡿⣿⣿  o⠀⠀⠀⠀⠀⣾⣿⣿⣯⣴⠞⠁⠀⠀⣤⠀⠀⢀⣀⡠⣴⣶⡋⠉⠩⢿⡧⠤⠹⣿⣿⣿⣿⣶⣶⣬⣝⣻⢦⡀
echo ⠀⠀⠄⢹⢃⢻⣟⠙⣿⣦⠱⢻⣿⣿⣿⣿⣿⣿⣷⣬⣍⣭⣥⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⡙⢿⣼⡿⣿⣿⣿⣿⣿⣷⣄⠘⣱⢦⣤⡴⡿⢈⣼⣿⣿⣿⣇⣴⣶⣮⣅⢻⣿⡏  T⠀⠀⠀⠀⢰⣿⣿⡿⠋⠀⠀⠀⠀⢀⣩⢴⣾⠟⠛⠙⠂⡇⠀⠀⠀⠈⢷⠐⠒⠻⣿⣿⣿⣿⣿⣿⣿⣿⣷⢵
echo ⠀⠀⠈⠹⣇⢡⢿⡆⠻⣿⣷⠀⢻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣍⡻⣿⣟⣻⣿⣿⣿⣿⣷⣦⣥⣬⣤⣴⣾⣿⣿⣿⣿⣷⣿⣿⣿⣿⣷⡜⠃ O⠀⠀⠀⠀⣼⡿⠋⠀⠀⠀⣀⣴⣾⡿⣿⡿⢿⣿⣶⡀⠈⠀⠀⠀⠀⠀⠀⢠⣤⣤⡘⡏⣿⣿⣿⣿⣿⣿⣿⡏
echo ⠀⠀⠀⢀⣘⠈⢂⠃⣧⡹⣿⣷⡄⠙⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣮⣅⡙⢿⣟⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠋⡕⠂    O⠀⠀⠀⣰⠫⠀⠀⣠⣴⣿⣿⣿⣿⡿⠋⣼⣿⣿⣽⣆⠀⠀⠀⠀⠀⠀⠀⣽⣿⣿⣟⣆⢹⣿⣿⣿⣿⣿⠏⠀
echo ⠀⠀⠀⠀⠛⢷⣜⢷⡌⠻⣿⣿⣦⣝⣻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣯⣹⣷⣦⣹⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠿⠉⠃⠀     L⠀⢀⡜⢁⢀⣴⣿⣿⣿⣿⣿⣿⣿⢧⣄⢻⢟⣿⣿⠏⠀⠀⠀⠀⠀⠀⠀⣿⢿⣿⡿⢸⢸⣿⣿⣿⡟⠁⠀⠀
echo                                                                     ⠀⡎⣠⣴⣿⣿⣿⣿⣿⣿⣿⣿⣿⠀⠀⠉⠀⢀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠙⠋⠁⠈⢸⡞⠋⠈⢷⠀⠀⠀
echo %ESC%[97m[1]%ESC%[0m Экспорт игры через Steam URL / AppID                            ⠸⡶⣿⣿⣿⣿⣿⣿⠷⢾⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠁⠀⠀⡼⡇⠀⠀⠈⠀⠀⠀
echo %ESC%[97m[2]%ESC%[0m Обновить сайт с GitHub                                          ⠀⠈⠛⠿⠿⣿⣿⡿⣇⠘⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣰⣧⠁⠀⠀⠀⠀⠀⠀
echo %ESC%[97m[3]%ESC%[0m Очистить лишние файлы в web                                     ⠀⠀⣠⣶⠖⠒⠒⠛⠭⠷⣿⣿⣿⡀⠀⠀⠀⠀⠀⠀⠀⠒⠙⠀⠀⠀⠀⠀⢀⡠⣾⣿⣿⠀⠀⠀⠀⠀⠀⠀
echo                                                                     ⠀⠀⣿⠀⠀⢀⣀⠀⠀⠀⠸⣿⣿⣿⣶⣦⣤⣄⣀⣀⠀⠀⢀⣀⣀⣤⣴⣾⣉⣀⣿⣿⡏⠀⠀⠀⠀⠀⠀⠀
echo %ESC%[97m[4]%ESC%[0m Изменить путь к сайту                                           ⠀⠀⢧⠀⠀⠈⠻⢷⣤⡀⠀⢿⢿⡿⣿⣿⣿⣿⣻⣶⡭⣹⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣷⡤⣀⠀⠀⠀⠀⠀
echo %ESC%[97m[5]%ESC%[0m Изменить путь к PHP                                             ⠀⠀⠈⣆⠠⢀⠀⠀⠈⢙⣦⣁⠈⠧⣿⣿⣿⡉⠻⢿⣷⣾⣿⣿⣿⣿⣿⣿⣿⠿⠿⠟⠛⢋⢳⠁⠀⠀⠀⠀
echo %ESC%[97m[6]%ESC%[0m Изменить папку сохранения экспорта                              ⠀⠠⣾⡟⣿⡩⡤⠖⢾⠉⠀⠊⠳⢬⣸⣿⣿⣷⠂⠄⠙⢿⢿⣿⣿⣿⣿⣿⡄⠀⠀⠀⣀⣦⠃⠀⠀⠀⠀⠀
echo %ESC%[97m[7]%ESC%[0m Починить MySQL                                                  ⠀⠀⢏⠀⠀⢰⠛⠂⠘⡆⠀⢸⣿⣷⠙⣿⣿⣿⡇⠀⣠⠵⡭⠛⠿⡟⣿⣿⣿⡤⠖⠻⣻⡃⠀⠀⠀⠀⠀⠀
echo                                                                     ⠀⠀⠘⡄⢀⡏⠀⠐⠀⢹⡀⢸⣿⣟⠁⣿⣿⡟⣿⠚⠁⠀⢯⣀⠀⡎⠹⣿⣿⣿⡀⠄⠐⡇⠀⠀⠀⠀⠀⠀
echo %ESC%[90m[0]%ESC%[0m Выход                                                           ⠀⠀⠀⠹⡼⠀⠀⠀⠀⠀⣇⢸⣿⡇⢀⣾⣿⣿⣿⣄⠀⠀⢸⡹⣿⣹⠯⣿⣿⣿⡇⠀⡸⠀⠀⠀⠀⠀⠀⠀
echo                                                                     ⠀⠀⠀⢠⠋⠀⠀⠀⠀⠀⢸⣾⣿⣠⣿⡼⣿⣿⣿⣧⠤⣄⡀⣇⠙⠋⣇⠘⣿⣿⣿⣶⠃⠀⠀⠀⠀⠀⠀⠀
echo %ESC%[90m▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰%ESC%[0m                   ⠀⠀⠀⡎⠀⠀⠀⠀⠀⠀⠨⣿⣿⣿⡇⢴⣿⣿⣿⣿⣇⣸⡀⢸⠂⠀⢸⣶⣿⣿⣿⣟⡄⠀⠀⠀⠀⠀⠀⠀
echo.

set "CHOICE="
set /p "CHOICE=%ESC%[96mВыберите действие: %ESC%[0m"

if "%CHOICE%"=="0" exit /b 0
if "%CHOICE%"=="1" goto export_game
if "%CHOICE%"=="2" goto update_site
if "%CHOICE%"=="3" goto cleanup_site
if "%CHOICE%"=="4" (
    set "SITE_PATH="
    goto check_site
)
if "%CHOICE%"=="5" (
    set "PHP_PATH="
    goto check_php
)
if "%CHOICE%"=="6" goto change_export_path
if "%CHOICE%"=="7" goto fix_mysql

goto menu


:export_game
cls
echo.
echo ============================================================
echo %ESC%[96m                      ЭКСПОРТ ИГРЫ%ESC%[0m
echo ============================================================
echo.
echo Текущая папка сохранения:
echo %OUT_DIR%
echo.
set "STEAM_APP="
set /p STEAM_APP=Введите Steam URL или AppID: 

if "%STEAM_APP%"=="" (
    echo.
    echo %ESC%[91m[ОШИБКА]%ESC%[0m Вы ничего не ввели.
    pause
    goto menu
)

if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

echo.
echo Запуск экспорта...
echo.

set "EXP_LOG=%TEMP%\catio_export_%RANDOM%_%RANDOM%.log"
set "EXP_RC=%TEMP%\catio_export_%RANDOM%.rc"
if exist "%EXP_RC%" del /q "%EXP_RC%"

start "" /b cmd /v /c ""%PHP_PATH%" "%CLI%" --app "%STEAM_APP%" --site "%SITE_PATH%" --out "%OUT_DIR%" >"%EXP_LOG%" 2>&1 & <nul set /p "=!errorlevel!">"%EXP_RC%""

call :spin_wait "%EXP_RC%" "%EXP_RC%.never" "Exporting game..."

set "ERR=1"
if exist "%EXP_RC%" set /p ERR=<"%EXP_RC%"
if not defined ERR set "ERR=1"

if exist "%EXP_LOG%" type "%EXP_LOG%"

echo.
if not "%ERR%"=="0" (
    echo %ESC%[91m[ОШИБКА]%ESC%[0m Экспорт завершился с кодом %ERR%.
) else (
    call :bar
    echo %ESC%[92m[УСПЕХ]%ESC%[0m Экспорт завершён!
    echo Архивы находятся в:
    echo %OUT_DIR%
    start "" explorer "%OUT_DIR%"
)

echo.
pause
goto menu


:fix_mysql
cls
echo.
echo ============================================================
echo                    ПОЧИНИТЬ MYSQL
echo ============================================================
echo.

set "XAMPP_DIR="
set "MYSQL_DIR="

for %%I in ("%PHP_PATH%\..\..") do set "XAMPP_DIR=%%~fI"
if defined XAMPP_DIR if exist "%XAMPP_DIR%\mysql\data" set "MYSQL_DIR=%XAMPP_DIR%\mysql"
if "%MYSQL_DIR%"=="" if exist "C:\xampp\mysql\data" set "MYSQL_DIR=C:\xampp\mysql"
if "%MYSQL_DIR%"=="" if exist "D:\xampp\mysql\data" set "MYSQL_DIR=D:\xampp\mysql"

if "%MYSQL_DIR%"=="" (
    echo.
    echo %ESC%[91m[ОШИБКА]%ESC%[0m Папка mysql не найдена рядом с PHP.
    echo Ожидалось что-то вроде C:\xampp\mysql
    pause
    goto menu
)

set "MYSQL_DATA=%MYSQL_DIR%\data"
set "MYSQL_BACKUP=%MYSQL_DIR%\backup"
set "MYSQL_BROKEN=%MYSQL_DIR%\data_broken"

if not exist "%MYSQL_DATA%" (
    echo.
    echo %ESC%[91m[ОШИБКА]%ESC%[0m Папка data не найдена: %MYSQL_DATA%
    pause
    goto menu
)

if not exist "%MYSQL_BACKUP%" (
    echo.
    echo %ESC%[91m[ОШИБКА]%ESC%[0m Папка backup не найдена: %MYSQL_BACKUP%
    echo Без неё восстановление невозможно.
    pause
    goto menu
)

echo Папка MySQL: %MYSQL_DIR%
echo.
echo Будет выполнено:
echo   1. data ^> data_broken
echo   2. backup ^> data
echo.
echo %ESC%[93mВНИМАНИЕ%ESC%[0m! В новой data останутся только системные базы
echo из backup. Текущие базы сохранятся в data_broken.
echo.
set "CONF="
set /p CONF=Продолжить? (Д/Н): 

if /i not "%CONF%"=="Д" goto menu

echo.
echo Проверка mysqld.exe...
tasklist /fi "imagename eq mysqld.exe" 2>nul | find /i "mysqld.exe" >nul
if errorlevel 1 goto mysql_stopped

echo MySQL запущен. Пытаюсь остановить...
taskkill /f /im mysqld.exe >nul 2>&1
timeout /t 3 /nobreak >nul

tasklist /fi "imagename eq mysqld.exe" 2>nul | find /i "mysqld.exe" >nul
if not errorlevel 1 (
    echo.
    echo %ESC%[91m[ОШИБКА]%ESC%[0m Не удалось остановить mysqld.exe.
    echo Остановите MySQL через XAMPP Control Panel и повторите.
    pause
    goto menu
)

:mysql_stopped
echo mysqld.exe остановлен.
echo.
echo Удаляю предыдущую data_broken...
if exist "%MYSQL_BROKEN%" rd /s /q "%MYSQL_BROKEN%"

echo Переименовываю data в data_broken...
rename "%MYSQL_DATA%" data_broken
if errorlevel 1 (
    echo.
    echo %ESC%[91m[ОШИБКА]%ESC%[0m Не удалось переименовать data!
    pause
    goto menu
)

echo Копирую backup в data...

set "RC_FILE=%TEMP%\catio_rc_%RANDOM%.tmp"
if exist "%RC_FILE%" del /q "%RC_FILE%"

start "" /b cmd /v /c "robocopy "%MYSQL_BACKUP%" "%MYSQL_DATA%" /E /R:2 /W:2 /NFL /NDL /NJH /NJS /NC /NS /NP >nul 2>&1 & <nul set /p "=!errorlevel!">"%RC_FILE%""

call :spin_wait "%RC_FILE%" "%RC_FILE%.never" "Restoring MySQL..."

set "RC=1"
if exist "%RC_FILE%" set /p RC=<"%RC_FILE%"
if not defined RC set "RC=1"

if %RC% GEQ 8 goto fix_mysql_rollback

echo.
call :bar
echo %ESC%[92m[УСПЕХ]%ESC%[0m MySQL восстановлен из backup!
echo Старая папка сохранена: %MYSQL_BROKEN%
echo.

set "CONF="
set /p CONF=Перенести пользовательские базы из data_broken? (Д/Н): 

if /i not "%CONF%"=="Д" goto fix_mysql_done

echo.
echo Копирую пользовательские базы...
for /d %%D in ("%MYSQL_BROKEN%\*") do (
    if /i not "%%~nxD"=="mysql" if /i not "%%~nxD"=="performance_schema" if /i not "%%~nxD"=="phpmyadmin" if /i not "%%~nxD"=="test" (
        robocopy "%%~fD" "%MYSQL_DATA%\%%~nxD" /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NC /NS /NP >nul
        echo   + %%~nxD
    )
)

if exist "%MYSQL_BROKEN%\ibdata1" (
    copy /y "%MYSQL_BROKEN%\ibdata1" "%MYSQL_DATA%\ibdata1" >nul
    echo   + ibdata1
)
echo.
echo Готово. Если MySQL не запустится после этого —
echo удалите ibdata1 из data и запустите снова.

:fix_mysql_done
echo.
echo Запустите MySQL через XAMPP Control Panel и проверьте phpMyAdmin.
echo.
pause
goto menu


:fix_mysql_rollback
echo.
echo %ESC%[91m[ОШИБКА]%ESC%[0m Копирование завершилось с кодом %RC%.
echo Пытаюсь вернуть старую data...
if exist "%MYSQL_DATA%" rd /s /q "%MYSQL_DATA%"
rename "%MYSQL_BROKEN%" data
if errorlevel 1 (
    echo.
    echo %ESC%[91m[ОШИБКА]%ESC%[0m Не удалось вернуть старую data!
    echo Проверьте папку вручную: %MYSQL_DIR%
) else (
    echo %ESC%[92m[УСПЕХ]%ESC%[0m Старая data возвращена на место.
)
echo.
pause
goto menu


:change_export_path
cls
echo.
echo ============================================================
echo                ПАПКА СОХРАНЕНИЯ ЭКСПОРТА
echo ============================================================
echo.
echo Текущая папка:
echo %OUT_DIR%
echo.
echo Стандартная папка:
echo %KEEP_DIR%
echo.
echo Введите новый путь.
echo Оставьте поле пустым для возврата к стандартной папке.
echo.

set "NEW_EXPORT_PATH="
set /p NEW_EXPORT_PATH=Новый путь: 

if "%NEW_EXPORT_PATH%"=="" (
    set "EXPORT_PATH="
    set "OUT_DIR=%KEEP_DIR%"
    goto export_path_save
)

for %%I in ("%NEW_EXPORT_PATH%") do set "EXPORT_PATH=%%~fI"
set "OUT_DIR=%EXPORT_PATH%"

:export_path_save
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

if not exist "%OUT_DIR%" (
    echo.
    echo %ESC%[91m[ОШИБКА]%ESC%[0m Не удалось создать указанную папку!
    pause
    goto menu
)

call :save_config

echo.
echo %ESC%[92m[УСПЕХ]%ESC%[0m Папка экспорта изменена:
echo %OUT_DIR%
echo.
pause
goto menu


:update_site
cls
echo.
echo ============================================================
echo                    ОБНОВЛЕНИЕ САЙТА
echo ============================================================
echo.
echo Репозиторий:
echo https://github.com/dxdrillbassx-dev/ItchioLite
echo.
echo Источник: web/
echo Назначение: %SITE_PATH%
echo.
echo %ESC%[93mВНИМАНИЕ%ESC%[0m: существующие файлы будут перезаписаны,
echo но отсутствующие в репозитории файлы удаляться не будут.
echo.
set "CONF="
set /p CONF=Продолжить? (Д/Н): 

if /i not "%CONF%"=="Д" goto menu

call :download_repo
set "TMP=%TEMP%\catio_site_update_%RANDOM%_%RANDOM%"

if exist "%TMP%" rd /s /q "%TMP%"
mkdir "%TMP%"

if errorlevel 1 (
    echo %ESC%[91m[ОШИБКА]%ESC%[0m Не удалось создать временную папку.
    exit /b 1
)

set "ZIP=%TMP%\repo.zip"
set "DLOK=%TMP%\dl.ok"
set "DLERR=%TMP%\dl.err"
set "WSFILE=%TMP%\websrc.txt"

echo.
echo Загрузка репозитория с GitHub...

set "DL_ZIP=%ZIP%"
set "DL_EXTRACT=%TMP%\extract"
set "DL_OK=%DLOK%"
set "DL_ERR=%DLERR%"
set "DL_WS=%WSFILE%"
start "" /b powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue';$z=$env:DL_ZIP;$x=$env:DL_EXTRACT;$ok=$env:DL_OK;$er=$env:DL_ERR;$ws=$env:DL_WS;try{$dl=$false;$uris=@('https://github.com/dxdrillbassx-dev/ItchioLite/archive/refs/heads/main.zip','https://github.com/dxdrillbassx-dev/ItchioLite/archive/refs/heads/master.zip');foreach($u in $uris){try{Invoke-WebRequest -Uri $u -OutFile $z -UseBasicParsing -ErrorAction Stop;$dl=$true;break}catch{}};if(-not $dl){'download failed'|Out-File -Encoding ascii $er;exit 1};Expand-Archive -LiteralPath $z -DestinationPath $x -Force;$web=$null;Get-ChildItem -Path $x -Directory|ForEach-Object{if(Test-Path (Join-Path $_.FullName 'web\index.php')){$web=Join-Path $_.FullName 'web'}};if(-not $web){'web folder not found'|Out-File -Encoding ascii $er;exit 1};$web|Out-File -Encoding ascii $ws;''|Out-File -Encoding ascii $ok}catch{'error'|Out-File -Encoding ascii $er;exit 1}"

call :spin_wait "%DLOK%" "%DLERR%" "Downloading repository..."

if errorlevel 1 (
    echo.
    echo %ESC%[91m[ОШИБКА]%ESC%[0m Не удалось загрузить или распаковать репозиторий!
    if exist "%DLERR%" type "%DLERR%"
    call :cleanup_temp
    exit /b 1
)

set "WEBSRC="
if exist "%WSFILE%" set /p WEBSRC=<"%WSFILE%"

if "%WEBSRC%"=="" (
    echo.
    echo %ESC%[91m[ОШИБКА]%ESC%[0m Папка web не найдена в репозитории!
    call :cleanup_temp
    exit /b 1
)

echo.
echo %ESC%[92mРепозиторий успешно загружен.%ESC%[0m
echo Источник: %WEBSRC%

exit /b 0


:cleanup_temp
echo.
pause
goto menu


:cleanup_site
cls
echo.
echo ============================================================
echo                    ОЧИСТКА ПАПКИ WEB
echo ============================================================
echo.
echo Цель: %SITE_PATH%
echo.
echo Будут удалены все файлы и папки,
echo которых нет в актуальном репозитории GitHub.
echo.
echo Сохраняемая папка:
echo %KEEP_DIR%
echo.
echo Остальные папки за пределами цели не затрагиваются.
echo.
echo %ESC%[93mВНИМАНИЕ%ESC%[0m! Удалённые файлы восстановить будет нельзя.
echo.
set "CONF="
set /p CONF=Продолжить? (Д/Н): 

if /i not "%CONF%"=="Д" goto menu

call :download_repo
if errorlevel 1 (
    pause
    goto menu
)

echo.
echo ============================================================
echo              ПРЕДВАРИТЕЛЬНЫЙ ПРОСМОТР УДАЛЕНИЯ
echo ============================================================
echo.
echo Сейчас будет показан список изменений.
echo Пока никакие файлы не удаляются.
echo.

robocopy "%WEBSRC%" "%SITE_PATH%" /MIR /L /XD "%KEEP_DIR%" /R:0 /W:0

echo.
echo ============================================================
echo.
set "CONF="
set /p CONF=Удалить лишние файлы и синхронизировать web? (Д/Н): 

if /i not "%CONF%"=="Д" (
    echo.
    echo Очистка отменена.
    call :cleanup_temp
    pause
    goto menu
)

echo.
echo Выполняется очистка...
echo.

set "RC_FILE=%TEMP%\catio_rc_%RANDOM%.tmp"
if exist "%RC_FILE%" del /q "%RC_FILE%"

start "" /b cmd /v /c "robocopy "%WEBSRC%" "%SITE_PATH%" /MIR /XD "%KEEP_DIR%" /R:2 /W:2 /NFL /NDL /NJH /NJS /NC /NS /NP >nul 2>&1 & <nul set /p "=!errorlevel!">"%RC_FILE%""

call :spin_wait "%RC_FILE%" "%RC_FILE%.never" "Cleaning web folder..."

set "RC=1"
if exist "%RC_FILE%" set /p RC=<"%RC_FILE%"
if not defined RC set "RC=1"

echo.
if %RC% GEQ 8 (
    echo %ESC%[91m[ОШИБКА]%ESC%[0m Robocopy завершился с кодом %RC%.
    echo Некоторые файлы могли не синхронизироваться.
) else (
    call :bar
    echo %ESC%[92m[УСПЕХ]%ESC%[0m Очистка завершена!
    echo Папка синхронизирована с GitHub.
)

echo.
echo Сохраняемая папка:
echo %KEEP_DIR%

call :cleanup_temp
echo.
pause
goto menu


:download_repo
set "TMP=%TEMP%\catio_site_update_%RANDOM%_%RANDOM%"

if exist "%TMP%" rd /s /q "%TMP%"
mkdir "%TMP%"

if errorlevel 1 (
    echo %ESC%[91m[ОШИБКА]%ESC%[0m Не удалось создать временную папку.
    exit /b 1
)

set "ZIP=%TMP%\repo.zip"

echo.
echo Загрузка репозитория с GitHub...
echo Ветка: main

powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'https://github.com/dxdrillbassx-dev/ItchioLite/archive/refs/heads/main.zip' -OutFile '%ZIP%' -UseBasicParsing -ErrorAction Stop } catch { exit 1 }"

if errorlevel 1 (
    echo Ветка main недоступна. Пробуем master...
    if exist "%ZIP%" del /q "%ZIP%"

    powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'https://github.com/dxdrillbassx-dev/ItchioLite/archive/refs/heads/master.zip' -OutFile '%ZIP%' -UseBasicParsing -ErrorAction Stop } catch { exit 1 }"
)

if not exist "%ZIP%" (
    echo.
    echo %ESC%[91m[ОШИБКА]%ESC%[0m Не удалось скачать репозиторий!
    call :cleanup_temp
    exit /b 1
)

echo.
echo Распаковка архива...

powershell -NoProfile -Command "try { Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%TMP%\extract' -Force -ErrorAction Stop } catch { exit 1 }"

if errorlevel 1 (
    echo %ESC%[91m[ОШИБКА]%ESC%[0m Не удалось распаковать архив.
    call :cleanup_temp
    exit /b 1
)

set "WEBSRC="

for /d %%D in ("%TMP%\extract\*") do (
    if exist "%%D\web\index.php" set "WEBSRC=%%D\web"
)

if "%WEBSRC%"=="" (
    echo.
    echo %ESC%[91m[ОШИБКА]%ESC%[0m Папка web не найдена в репозитории!
    call :cleanup_temp
    exit /b 1
)

echo.
echo Репозиторий успешно загружен.
echo Источник: %WEBSRC%

exit /b 0


:cleanup_temp
if defined TMP if exist "%TMP%" rd /s /q "%TMP%"
exit /b 0


:bar
powershell -NoProfile -Command "$w=24;for($i=0;$i -le $w;$i++){$p=[math]::Round($i/$w*100);$b=('▰'*$i)+('▱'*($w-$i));[Console]::Write(([char]13+'  ['+$b+'] '+$p+[char]37).PadRight(48));Start-Sleep -m 35};[Console]::WriteLine('')"
exit /b 0


:spin_wait
set "SPIN_OK=%~1"
set "SPIN_ERR=%~2"
set "SPIN_LB=%~3"
powershell -NoProfile -Command "$ok=$env:SPIN_OK;$er=$env:SPIN_ERR;$lb=$env:SPIN_LB;$f='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'.ToCharArray();$i=0;while(1){if(Test-Path -LiteralPath $ok){exit 0};if(Test-Path -LiteralPath $er){exit 1};$c=$f[$i];[Console]::Write(([char]13+'  '+$c+' '+$lb).PadRight(56));Start-Sleep -m 80;$i++;if($i -ge 10){$i=0}}"
exit /b %ERRORLEVEL%


:load_config
for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%CONFIG_FILE%") do (
    if /i "%%~A"=="SITE_PATH" set "SITE_PATH=%%~B"
    if /i "%%~A"=="PHP_PATH" set "PHP_PATH=%%~B"
    if /i "%%~A"=="EXPORT_PATH" set "EXPORT_PATH=%%~B"
)
exit /b 0


:save_config
(
    echo SITE_PATH=%SITE_PATH%
    echo PHP_PATH=%PHP_PATH%
    echo EXPORT_PATH=%EXPORT_PATH%
) > "%CONFIG_FILE%"
exit /b 0