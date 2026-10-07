@echo off
cd /d "%~dp0iqvault"
if not exist node_modules (
  echo Installing IQVault dependencies...
  call npm install
)
echo.
echo ========================================
echo   IQVault  —  http://127.0.0.1:5175
echo   Login: greg@iqvault.local / vault
echo ========================================
echo.
echo NOTE: This is NOT VaultOS. If you see VaultOS here, a duplicate
echo       demo server stole this port — close it and restart IQVault.
echo.
start http://127.0.0.1:5175
call npm run dev
