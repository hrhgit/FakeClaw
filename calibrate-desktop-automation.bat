@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

set "TARGET_APP=%~1"
set "MODE=%~2"
set "OPEN_IF_MISSING=%~3"
set "LAUNCH_ENV_KEY="
set "LAUNCH_COMMAND="

if "%TARGET_APP%"=="" (
  set /p "TARGET_APP=Target app [codex/cursor/trae/traecn/codebuddy/codebuddycn/antigravity] (default: antigravity): "
)
if "%TARGET_APP%"=="" set "TARGET_APP=antigravity"

if /I not "%TARGET_APP%"=="codex" if /I not "%TARGET_APP%"=="cursor" if /I not "%TARGET_APP%"=="trae" if /I not "%TARGET_APP%"=="traecn" if /I not "%TARGET_APP%"=="codebuddy" if /I not "%TARGET_APP%"=="codebuddycn" if /I not "%TARGET_APP%"=="antigravity" (
  echo [error] Invalid target app: %TARGET_APP%
  echo [hint] Use one of: codex, cursor, trae, traecn, codebuddy, codebuddycn, antigravity
  pause
  exit /b 1
)

if "%MODE%"=="" (
  set /p "MODE=Mode [analyze/calibrate] (default: analyze): "
)
if "%MODE%"=="" set "MODE=analyze"

if /I not "%MODE%"=="analyze" if /I not "%MODE%"=="calibrate" (
  echo [error] Invalid mode: %MODE%
  echo [hint] Use one of: analyze, calibrate
  pause
  exit /b 1
)

if "%OPEN_IF_MISSING%"=="" (
  set /p "OPEN_IF_MISSING=Open app if missing? [y/N]: "
)
if "%OPEN_IF_MISSING%"=="" set "OPEN_IF_MISSING=N"

where powershell >nul 2>nul
if errorlevel 1 (
  echo [error] Windows PowerShell not found in PATH.
  pause
  exit /b 1
)

if /I "%TARGET_APP%"=="codex" set "LAUNCH_ENV_KEY=CODEX_LAUNCH_COMMAND"
if /I "%TARGET_APP%"=="cursor" set "LAUNCH_ENV_KEY=CURSOR_LAUNCH_COMMAND"
if /I "%TARGET_APP%"=="trae" set "LAUNCH_ENV_KEY=TRAE_LAUNCH_COMMAND"
if /I "%TARGET_APP%"=="traecn" set "LAUNCH_ENV_KEY=TRAE_CN_LAUNCH_COMMAND"
if /I "%TARGET_APP%"=="codebuddy" set "LAUNCH_ENV_KEY=CODEBUDDY_LAUNCH_COMMAND"
if /I "%TARGET_APP%"=="codebuddycn" set "LAUNCH_ENV_KEY=CODEBUDDY_CN_LAUNCH_COMMAND"
if /I "%TARGET_APP%"=="antigravity" set "LAUNCH_ENV_KEY=ANTIGRAVITY_LAUNCH_COMMAND"

if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /I "%%A"=="!LAUNCH_ENV_KEY!" if not "%%B"=="" set "LAUNCH_COMMAND=%%B"
  )
)

set "SCRIPT_ARGS=-TargetApp %TARGET_APP% -Mode %MODE%"

if /I "%OPEN_IF_MISSING%"=="Y" (
  set "SCRIPT_ARGS=%SCRIPT_ARGS% -OpenIfMissing"
  if not "%LAUNCH_COMMAND%"=="" (
    set "SCRIPT_ARGS=%SCRIPT_ARGS% -LaunchCommand ""%LAUNCH_COMMAND%"""
  ) else (
    echo [warn] %LAUNCH_ENV_KEY% not found in .env. Will try attach-only mode.
  )
)

echo [start] Running desktop automation calibration...
echo [info] Target: %TARGET_APP%
echo [info] Mode: %MODE%
if /I "%OPEN_IF_MISSING%"=="Y" (
  echo [info] Open if missing: yes
) else (
  echo [info] Open if missing: no
)
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0scripts\calibrate-desktop-automation.ps1" %SCRIPT_ARGS%

set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo [error] Script exited with code %EXIT_CODE%.
) else (
  echo [done] Calibration script completed.
)

pause
exit /b %EXIT_CODE%
