@echo off
cd /d "%~dp0orchestr8"
if not exist .env (
  echo Copy orchestr8\.env.example to orchestr8\.env and add your API keys.
  echo.
)
pip install -r requirements.txt -q 2>nul
echo ========================================
echo   Orchestr8 AI Gateway  —  port 5210
echo   Keys: orchestr8\.env only
echo ========================================
echo.
python api/server.py
