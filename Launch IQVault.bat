@echo off
REM IQVault desktop launcher - Docker, Postgres, Comics API, VIP API, collector web, Binder
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start_iqvault_ecosystem.ps1" %*
if errorlevel 1 exit /b 1
