@echo off
setlocal EnableExtensions

cd /d "%~dp0"
start "FakeClaw Service (WeCom)" /d "%~dp0" "%ComSpec%" /k call "%~dp0scripts\start-service-window.bat" wecom WeCom
exit /b 0
