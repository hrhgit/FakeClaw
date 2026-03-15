@echo off
setlocal EnableExtensions

set "STARTUP_DIR=%~dp0"
for %%I in ("%STARTUP_DIR%..\\scripts") do set "SCRIPTS_DIR=%%~fI"
for %%I in ("%STARTUP_DIR%..") do set "REPO_ROOT=%%~fI"

cd /d "%REPO_ROOT%"
start "FakeClaw Service (Feishu)" /d "%REPO_ROOT%" "%ComSpec%" /k call "%SCRIPTS_DIR%\start-service-window.bat" feishu Feishu
exit /b 0
