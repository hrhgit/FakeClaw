@echo off
setlocal EnableExtensions

cd /d "%~dp0"
set "BOT_PLATFORM=napcat"
set "NAPCAT_SCRIPT="
set "NAPCAT_DIR="

where node >nul 2>nul
if errorlevel 1 (
  echo [error] Node.js not found in PATH.
  echo Install Node.js 22+ and reopen this script.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [error] npm not found in PATH.
  echo Install Node.js with npm and reopen this script.
  pause
  exit /b 1
)

if not exist ".env" (
  echo [error] Missing .env file.
  pause
  exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
  if /I "%%A"=="NAPCAT_START_SCRIPT" if not "%%B"=="" set "NAPCAT_SCRIPT=%%B"
)

if "%NAPCAT_SCRIPT%"=="" (
  echo [error] NAPCAT_START_SCRIPT is not configured.
  echo Add your local NapCat startup script path to .env first.
  pause
  exit /b 1
)

for %%I in ("%NAPCAT_SCRIPT%") do set "NAPCAT_DIR=%%~dpI"

if not exist "%NAPCAT_SCRIPT%" (
  echo [error] NapCat script not found: %NAPCAT_SCRIPT%
  echo Update NAPCAT_START_SCRIPT in .env to match your local NapCat install.
  pause
  exit /b 1
)

echo [start] Launching NapCat in a separate window...
start "NapCat" /d "%NAPCAT_DIR%" "%ComSpec%" /k call "%NAPCAT_SCRIPT%"

echo [start] Launching notification forwarder in a separate window...
start "FakeClaw Service (QQ)" /d "%~dp0" "%ComSpec%" /k call "%~dp0scripts\start-service-window.bat" "%BOT_PLATFORM%" QQ

echo [done] Both windows were opened.
echo [hint] The service window will keep retrying until NapCat websocket becomes available.
exit /b 0
