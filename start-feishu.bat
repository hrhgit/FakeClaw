@echo off
setlocal EnableExtensions

cd /d "%~dp0"
start "FakeClaw Service (Feishu)" /d "%~dp0" "%ComSpec%" /k call "%~dp0scripts\start-service-window.bat" feishu Feishu
exit /b 0
