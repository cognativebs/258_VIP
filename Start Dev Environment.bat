@echo off
REM Post-restart Dev Environment - Cursor, Docker, VIP tools
REM Double-click for interactive list, or pass -All -NoMenu for silent start
cd /d "%~dp0"
set "PS1=%~dp0scripts\start_dev_environment.ps1"
if not exist "%PS1%" (
  echo Missing %PS1%
  pause
  exit /b 1
)
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
)
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
