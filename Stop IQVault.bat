@echo off
REM Stops VIP API, Comics API, Orchestr8, web, Binder, and Orchestr8 Console
REM windows started by Launch IQVault.bat. Postgres / Docker stay up.
REM Also refreshes the Desktop "Stop IQVault" shortcut (stop-icon).
cd /d "%~dp0"

set "PS1=%~dp0scripts\stop_iqvault_ecosystem.ps1"
if not exist "%PS1%" (
  echo Missing stop script:
  echo   %PS1%
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -InstallShortcut
set "ERR=%ERRORLEVEL%"
echo.
if not "%ERR%"=="0" (
  echo Stop finished with code %ERR%. Scroll up for leftover ports.
)
echo Press any key to close. Use Launch IQVault.bat when you are ready to start again.
pause >nul
exit /b %ERR%
