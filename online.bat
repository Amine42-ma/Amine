@echo off
chcp 65001 >nul
title DINO ROYALE EVOLUTION - Online
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js is not installed.
  echo   Download the LTS version from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

node tools\online.js %*

echo.
echo   The game has stopped. Close this window or run the file again.
pause
