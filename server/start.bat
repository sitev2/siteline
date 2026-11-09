@echo off
title SITELINE server
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org/ and run this again.
  pause
  exit /b 1
)
if not exist node_modules\ws (
  echo First run: installing the server library...
  call npm install --omit=dev --no-audit --no-fund
)
for /l %%i in (0,0,1) do (
  node server.mjs
  echo.
  echo The server stopped. Restarting in 5 seconds - close this window to stop it.
  timeout /t 5 /nobreak >nul
)
