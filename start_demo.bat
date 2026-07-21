@echo off
cd /d "%~dp0demo"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo Starting VaultOS (PC only)...
echo For iPhone photos, use start_demo_mobile.bat instead.
echo.
start http://127.0.0.1:5174
call npm run dev