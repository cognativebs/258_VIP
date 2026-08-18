@echo off
REM One-click VIP stack: Docker, Postgres, Comics API, VIP API, collector, Binder, Orchestr8
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start_iqvault_ecosystem.ps1" %*
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
