@echo off
cd /d "%~dp0demo"
if not exist node_modules (
  echo Installing VaultOS dependencies...
  call npm install
)
echo.
echo ========================================
echo   VaultOS  —  http://127.0.0.1:5174
echo   Login: store@vaultos.demo / demo
echo ========================================
echo.
echo NOTE: If port 5174 is already in use, close the other VaultOS window first.
echo       IQVault runs separately on port 5175 — use start_iqvault.bat
echo.
start http://127.0.0.1:5174
call npm run dev
