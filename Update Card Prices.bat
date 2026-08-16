@echo off
REM Ad-hoc TCGplayer price refresh. Writes one row per card/day into
REM vault_market.card_price_history, so running it twice a day is safe.
REM
REM Optional args are passed straight through, e.g.
REM   "Update Card Prices.bat" --backfill=annual
REM   "Update Card Prices.bat" --cards=base1-4 --dry-run
cd /d "%~dp0"
echo ========================================
echo   VIP card price history  -  TCGplayer
echo   Condition: NM (assumed unless reported)
echo ========================================
echo.
call npm run job:price-history -- %*
echo.
echo Done. Press any key to close.
pause >nul
