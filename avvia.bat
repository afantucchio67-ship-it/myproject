@echo off
REM Avvia il visualizzatore STEP sul computer locale (serve Node.js).
REM Doppio clic su questo file: apre il server e poi il browser.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js non trovato: installalo da https://nodejs.org oppure apri dist\visualizzatore-step.html con doppio clic.
  pause
  exit /b 1
)
start "" /b cmd /c "timeout /t 2 /nobreak >nul && start "" http://localhost:8080"
node server.mjs 8080
pause
