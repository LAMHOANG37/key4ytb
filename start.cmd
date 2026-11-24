@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24.22.1 or newer, then run npm ci.
  pause
  exit /b 1
)
if not exist "node_modules\youtubei.js" (
  echo Dependencies are missing. Run npm ci in this folder first.
  pause
  exit /b 1
)
node --env-file-if-exists=.env server.mjs
