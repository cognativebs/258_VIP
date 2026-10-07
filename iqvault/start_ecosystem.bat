@echo off
cd /d "%~dp0"
echo Starting IQVault Ecosystem...
echo   Bridge  : http://127.0.0.1:5199
echo   VaultOS : http://127.0.0.1:5174  (store@vaultos.demo / demo)
echo   IQVault : http://127.0.0.1:5175  (greg@iqvault.local / vault)
echo.

start "IQVault Bridge" cmd /k node bridge\server.js

timeout /t 2 /nobreak >nul

start "VaultOS" cmd /k call start_vaultos.bat
timeout /t 2 /nobreak >nul
start "IQVault" cmd /k call start_iqvault.bat

echo All three services launching in separate windows.
