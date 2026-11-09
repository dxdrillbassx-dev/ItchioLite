@echo off
setlocal EnableExtensions
chcp 65001 >nul
title CATio Tools

set "SCRIPT_DIR=%~dp0"
set "CONFIG_FILE=%SCRIPT_DIR%config.ini"
set "SITE_PATH="
set "PHP_PATH="

if exist "%CONFIG_FILE%" call :load_config

:check_site
if not "%SITE_PATH%"=="" if exist "%SITE_PATH%\index.php" goto site_ok
if not "%SITE_PATH%"=="" if exist "%SITE_PATH%\web\index.php" (
  set "SITE_PATH=%SITE_PATH%\web"
  goto site_ok
)
echo.
echo Enter path to CATio site folder (index.php inside)
echo Example: C:\xampp\htdocs\itch-steam-like
set /p SITE_PATH=Path: 
if "%SITE_PATH%"=="" goto check_site
if exist "%SITE_PATH%\web\index.php" if not exist "%SITE_PATH%\index.php" set "SITE_PATH=%SITE_PATH%\web"
if not exist "%SITE_PATH%\index.php" (
  echo ERROR: index.php not found
  set "SITE_PATH="
  goto check_site
)
:site_ok
echo Site: %SITE_PATH%

:check_php
if not "%PHP_PATH%"=="" if exist "%PHP_PATH%" goto php_ok
set "PHP_PATH="
if exist "C:\xampp\php\php.exe" set "PHP_PATH=C:\xampp\php\php.exe"
if "%PHP_PATH%"=="" if exist "D:\xampp\php\php.exe" set "PHP_PATH=D:\xampp\php\php.exe"
if "%PHP_PATH%"=="" if exist "C:\php\php.exe" set "PHP_PATH=C:\php\php.exe"
if "%PHP_PATH%"=="" (
  where php >nul 2>&1
  if not errorlevel 1 for /f "delims=" %%P in ('where php') do if "%PHP_PATH%"=="" set "PHP_PATH=%%P"
)
if "%PHP_PATH%"=="" (
  echo Enter full path to php.exe
  set /p PHP_PATH=php.exe: 
)
if not exist "%PHP_PATH%" (
  echo ERROR: php.exe not found
  set "PHP_PATH="
  goto check_php
)
:php_ok
echo PHP:  %PHP_PATH%
call :save_config

set "CLI=%SITE_PATH%\tools\steam_export_cli.php"
if not exist "%CLI%" if exist "%SCRIPT_DIR%steam_export_cli.php" set "CLI=%SCRIPT_DIR%steam_export_cli.php"
if not exist "%CLI%" (
  echo ERROR: steam_export_cli.php not found in site\tools or next to bat
  pause
  exit /b 1
)
set "OUT_DIR=%SITE_PATH%\uploads\game_packs\_cli_export"
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

:menu
cls
echo ============================================
echo   CATio tools
echo ============================================
echo Site: %SITE_PATH%
echo.
echo 1^) Export game by Steam URL / AppID
echo 2^) Update site from GitHub (web folder)
echo 3^) Change site path
echo 4^) Change php.exe
echo 0^) Exit
echo ============================================
set /p CHOICE=Choice: 

if "%CHOICE%"=="0" exit /b 0
if "%CHOICE%"=="3" (
  set "SITE_PATH="
  goto check_site
)
if "%CHOICE%"=="4" (
  set "PHP_PATH="
  goto check_php
)
if "%CHOICE%"=="2" goto update_site
if not "%CHOICE%"=="1" goto menu

echo.
set /p STEAM_APP=Steam URL or AppID: 
if "%STEAM_APP%"=="" (
  echo Empty.
  pause
  goto menu
)
echo.
echo Running export...
echo.
"%PHP_PATH%" "%CLI%" --app "%STEAM_APP%" --site "%SITE_PATH%" --out "%OUT_DIR%"
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" (
  echo FAIL code %ERR%
) else (
  echo OK. ZIP folder:
  echo   %OUT_DIR%
  start "" explorer "%OUT_DIR%"
)
echo.
pause
goto menu

:update_site
cls
echo Update site from GitHub
echo Repo: https://github.com/dxdrillbassx-dev/ItchioLite
echo Target: %SITE_PATH%
echo.
echo This copies files from repo folder web\* into the site folder.
echo.
set /p CONF=Continue? (Y/N): 
if /i not "%CONF%"=="Y" goto menu

set "TMP=%TEMP%\catio_site_update_%RANDOM%"
if exist "%TMP%" rd /s /q "%TMP%"
mkdir "%TMP%"

echo Downloading ZIP...
set "ZIP=%TMP%\repo.zip"
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'https://github.com/dxdrillbassx-dev/ItchioLite/archive/refs/heads/main.zip' -OutFile '%ZIP%' -UseBasicParsing } catch { exit 1 }"
if not exist "%ZIP%" (
  echo Trying master branch...
  powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'https://github.com/dxdrillbassx-dev/ItchioLite/archive/refs/heads/master.zip' -OutFile '%ZIP%' -UseBasicParsing } catch { exit 1 }"
)
if not exist "%ZIP%" (
  echo ERROR: download failed
  pause
  goto menu
)

echo Extracting...
powershell -NoProfile -Command "Expand-Archive -Path '%ZIP%' -DestinationPath '%TMP%\extract' -Force"
set "WEBSRC="
for /d %%D in ("%TMP%\extract\ItchioLite-*") do (
  if exist "%%D\web\index.php" set "WEBSRC=%%D\web"
)
if "%WEBSRC%"=="" (
  echo ERROR: web folder not found in archive
  rd /s /q "%TMP%"
  pause
  goto menu
)

echo Copying web\* -^> %SITE_PATH%\
robocopy "%WEBSRC%" "%SITE_PATH%" /E /IS /IT /NFL /NDL /NJH /NJS /nc /ns /np
set RC=%ERRORLEVEL%
if %RC% GEQ 8 (
  echo ERROR: robocopy failed code %RC%
) else (
  echo OK: site files updated from GitHub web/
)
if exist "%TMP%" rd /s /q "%TMP%"
echo.
pause
goto menu

:load_config
for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%CONFIG_FILE%") do (
  if /i "%%~A"=="SITE_PATH" set "SITE_PATH=%%~B"
  if /i "%%~A"=="PHP_PATH" set "PHP_PATH=%%~B"
)
exit /b 0

:save_config
(
  echo SITE_PATH=%SITE_PATH%
  echo PHP_PATH=%PHP_PATH%
) > "%CONFIG_FILE%"
exit /b 0
