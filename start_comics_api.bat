@echo off
cd /d "%~dp0"
echo ========================================
echo   Comics API  —  http://127.0.0.1:5200
echo   Requires: docker compose up -d
echo ========================================
echo.
python api/comics_server.py
