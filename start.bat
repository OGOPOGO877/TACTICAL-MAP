@echo off
setlocal
cd /d "%~dp0"
title TACTICAL MAP
color 0A

echo.
echo  ========================================
echo    TACTICAL MAP
echo  ========================================
echo.
echo  This black window must stay open.
echo  Closing it stops the app.
echo.

echo [%date% %time%] start > "%~dp0start-log.txt"

where.exe node >nul 2>&1
if errorlevel 1 (
  echo  [ERROR] Node.js is not installed.
  echo  1. Open https://nodejs.org
  echo  2. Download LTS
  echo  3. Install, then run this file again.
  echo [%date% %time%] node missing >> "%~dp0start-log.txt"
  echo.
  pause
  exit /b 1
)

echo  Node.js found.
node.exe -v
echo.

if not exist "node_modules\" (
  echo  First run: installing packages...
  echo  Wait. This can take a few minutes.
  echo.
  call npm.cmd install
  if errorlevel 1 (
    echo  [ERROR] npm install failed.
    echo [%date% %time%] npm install failed >> "%~dp0start-log.txt"
    echo.
    pause
    exit /b 1
  )
  echo.
)

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo  Created .env
)

echo  Starting...
echo  Browser will open: http://localhost:3000
echo  If it does not open, type that address in Chrome.
echo.
echo [%date% %time%] npm start >> "%~dp0start-log.txt"
set OPEN_BROWSER=1
call npm.cmd start
echo.
echo  Server stopped.
echo [%date% %time%] stopped >> "%~dp0start-log.txt"
echo.
pause
