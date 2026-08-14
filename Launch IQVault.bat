@echo off
REM IQVault desktop launcher - Docker, Postgres, VIP API, Comics API, Orchestr8, web
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start_iqvault_ecosystem.ps1" %*
if errorlevel 1 (
  echo.
  echo Press any key to close this window.
  pause >nul
  exit /b 1
)
REM Pause so a fast failure is visible on double-click instead of flashing.
echo.
echo Press any key to close this window (services keep running in their own windows).
pause >nul
