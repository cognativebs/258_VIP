@echo off
cd /d "%~dp0orchestr8"
if not exist .env (
  echo No orchestr8\.env yet - copying from .env.example
  copy /Y .env.example .env >nul
  echo.
  echo Edit orchestr8\.env and paste keys into the matching lines:
  echo   OPENAI_API_KEY=sk-proj-...   or sk-...
  echo   ANTHROPIC_API_KEY=sk-ant-...
  echo   XAI_API_KEY=xai-...
  echo.
  echo Do not mix them - Anthropic keys start with sk-ant-, xAI with xai-.
  echo.
  notepad .env
  echo.
)
pip install -r requirements.txt -q 2>nul
echo ========================================
echo   Orchestr8 AI Gateway  -  port 5210
echo   Keys: orchestr8\.env only
echo ========================================
echo.
python api/server.py
