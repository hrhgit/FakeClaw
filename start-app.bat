@echo off
setlocal

cd /d "%~dp0"

if "%BOT_PLATFORM%"=="" set "BOT_PLATFORM=napcat"

where node >nul 2>nul
if errorlevel 1 (
  echo [error] Node.js not found in PATH.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [error] npm not found in PATH.
  pause
  exit /b 1
)

if not exist ".env" (
  echo [error] Missing .env file.
  pause
  exit /b 1
)

echo [start] Launching FakeClaw service for platform: %BOT_PLATFORM%
call npm start

set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [error] Process exited with code %EXIT_CODE%.
)

pause
exit /b %EXIT_CODE%
