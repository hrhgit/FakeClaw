@echo off
setlocal EnableExtensions

cd /d "%~dp0"
start "FakeClaw Service (Telegram)" /d "%~dp0" "%ComSpec%" /k call "%~dp0scripts\start-service-window.bat" telegram Telegram
exit /b 0
