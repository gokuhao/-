@echo off
setlocal
title StepBeast Dev

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo [StepBeast] npm was not found. Install Node.js first.
  pause
  exit /b 1
)

if not exist "node_modules\electron\package.json" (
  echo [StepBeast] Dependencies are missing. Run npm install first.
  pause
  exit /b 1
)

echo [StepBeast] Starting development mode. Keep this window open.
echo [StepBeast] Use the tray menu to quit the app completely.
echo.

call npm run dev
set "STEPBEAST_EXIT_CODE=%errorlevel%"

if not "%STEPBEAST_EXIT_CODE%"=="0" (
  echo.
  echo [StepBeast] Development mode exited with code %STEPBEAST_EXIT_CODE%.
  echo [StepBeast] Keep the log above for troubleshooting.
  pause
)

exit /b %STEPBEAST_EXIT_CODE%
