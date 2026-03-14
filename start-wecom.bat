@echo off
setlocal

cd /d "%~dp0"
set "BOT_PLATFORM=wecom"

echo [start] Launching notification forwarder for WeCom...
call "%~dp0start-app.bat"

exit /b %ERRORLEVEL%
