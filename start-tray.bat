@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%scripts") do set "SCRIPTS_DIR=%%~fI"
for %%I in ("%SCRIPT_DIR%") do set "REPO_ROOT=%%~fI"
for %%I in ("%REPO_ROOT%\..\..\PortManager\Cargo.toml") do set "PORTMUX_MANIFEST_PATH=%%~fI"

cd /d "%REPO_ROOT%"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPTS_DIR%\\build-tray-app.ps1"
if errorlevel 1 (
  echo.
  echo [error] Failed to build tray application.
  pause
  exit /b 1
)

if exist "%PORTMUX_MANIFEST_PATH%" (
  set "PORTMUX_MANIFEST_PATH=%PORTMUX_MANIFEST_PATH%"
)

start "" "%REPO_ROOT%\tray\bin\FakeClaw.Tray.exe"
exit /b 0
