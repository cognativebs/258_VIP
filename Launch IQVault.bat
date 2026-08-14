@echo off
REM IQVault desktop launcher - Docker, Postgres, VIP API, Comics API, Orchestr8, web
cd /d "%~dp0"

set "PS1=%~dp0scripts\start_iqvault_ecosystem.ps1"
if not exist "%PS1%" (
  echo Missing launcher script:
  echo   %PS1%
  echo.
  pause
  exit /b 1
)

REM Double-click sets %%* empty. Passing that empty token to powershell -File
REM makes Windows PowerShell 5.1 error: "a positional parameter cannot be found"
REM and the window looks like it "does nothing".
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
)

set "ERR=%ERRORLEVEL%"
echo.
if not "%ERR%"=="0" (
  echo Launcher exited with code %ERR%. Scroll up for [IQVault] ERROR.
  echo Log: %~dp0scripts\logs\launcher.log
)
echo Press any key to close this window (services keep running in their own windows).
pause >nul
exit /b %ERR%
