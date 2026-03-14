@echo off
setlocal

cd /d "%~dp0"
set "BOT_PLATFORM=telegram"

echo [start] Launching notification forwarder for Telegram...
call "%~dp0start-app.bat"

exit /b %ERRORLEVEL%
