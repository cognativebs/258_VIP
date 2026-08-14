@echo off
REM Stops the VIP API, Comics API, Orchestr8, and web windows started by
REM "Launch IQVault.bat". Postgres keeps running so you don't lose the DB.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop_iqvault_ecosystem.ps1"
pause
