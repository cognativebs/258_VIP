@echo off
REM Post-restart Dev Environment - Cursor, Docker, VIP tools
REM Double-click for interactive list, or pass -All -NoMenu for silent start
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start_dev_environment.ps1" %*
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
