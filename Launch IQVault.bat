@echo off
REM IQVault desktop launcher — Docker, Postgres, VIP API, Comics API, Orchestr8, web
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start_iqvault_ecosystem.ps1"
REM Always pause so a fast failure (e.g. PowerShell couldn't even parse the
REM script) is visible on a double-click instead of just flashing the window.
echo.
echo Press any key to close this window (services keep running in their own windows).
pause >nul
