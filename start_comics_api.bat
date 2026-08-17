@echo off
cd /d "%~dp0"
echo ========================================
echo   Comics API  —  http://127.0.0.1:5200
echo   Same as: npm run comics
echo   Requires: docker compose up -d (or docker start iqvault-postgres)
echo ========================================
echo.
python api/comics_server.py
