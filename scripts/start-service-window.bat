@echo off
setlocal EnableExtensions

cd /d "%~dp0\.."

set "BOT_PLATFORM=%~1"
set "BOT_PLATFORM_LABEL=%~2"

if "%BOT_PLATFORM%"=="" (
  echo [error] Missing BOT_PLATFORM argument.
  pause
  exit /b 1
)

if "%BOT_PLATFORM_LABEL%"=="" set "BOT_PLATFORM_LABEL=%BOT_PLATFORM%"

echo [start] Launching FakeClaw service for %BOT_PLATFORM_LABEL%...
call "%~dp0..\\startup\\start-app.bat"

exit /b %ERRORLEVEL%
