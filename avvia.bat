@echo off
REM Avvia il visualizzatore STEP sul computer locale (serve Node.js).
REM Doppio clic su questo file: apre il server e il browser.
cd /d "%~dp0"
start "" http://localhost:8080
node server.mjs 8080
pause
