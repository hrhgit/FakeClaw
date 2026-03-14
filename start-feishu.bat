@echo off
setlocal

cd /d "%~dp0"
set "BOT_PLATFORM=feishu"

echo [start] Launching notification forwarder for Feishu...
call "%~dp0start-app.bat"

exit /b %ERRORLEVEL%
