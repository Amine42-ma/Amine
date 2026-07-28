@echo off
REM ---------------------------------------------------------------------------
REM  Dino Royale Evolution - launcher for Windows
REM  Starts the game server and opens the browser. No installation required.
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

if "%PORT%"=="" set PORT=8080

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed.
  echo   Install it from https://nodejs.org ^(version 20 or newer^), then run this again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting Dino Royale Evolution on http://localhost:%PORT%
echo   Keep this window open while you play. Close it to stop the server.
echo.

start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%"
node server\server.js

echo.
echo   The server stopped.
pause
