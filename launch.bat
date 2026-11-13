@echo off
cd /d "%~dp0tracker"
if errorlevel 1 exit /b 1
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 or newer from https://nodejs.org/ then try again.
  pause
  exit /b 1
)
node server.mjs
pause
