@echo off
rem One click: make sure the backend is running, then start the mobile app in
rem tunnel mode, which works on any network (Windows marks most Wi-Fi "Public"
rem and its firewall then blocks phones from a plain `expo start`).
cd /d "%~dp0"

where node >nul 2>nul || (echo Node.js 20+ is required: https://nodejs.org & pause & exit /b 1)

if not exist node_modules (
  echo Installing the mobile app's packages...
  call npm install || (pause & exit /b 1)
)

rem ---- Backend on port 4000 (the app reads all its data from it) ------------
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://localhost:4000/api/health | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  echo Backend is running on port 4000.
  goto expo
)

powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 4000 -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo.
  echo Something is using port 4000 but not answering - an old or stuck backend.
  echo Close that window ^(or end the "node" task in Task Manager^), then run this again.
  pause
  exit /b 1
)

echo Starting the backend in its own window...
pushd ..
if not exist node_modules (
  call npm install || (popd & pause & exit /b 1)
)
rem The new window starts in the project folder (inherited from pushd).
start "UBTS backend" cmd /k "set TRAVEL_WINDOWS=00:00-24:00&& node server/index.js"
popd
echo Waiting for the backend...
set tries=0
:wait
set /a tries+=1
if %tries% gtr 45 (echo The backend did not start - see the "UBTS backend" window. & pause & exit /b 1)
timeout /t 2 /nobreak >nul
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 http://localhost:4000/api/health | Out-Null; exit 0 } catch { exit 1 }" || goto wait
echo Backend is running on port 4000.

rem ---- Mobile app --------------------------------------------------------------
:expo
echo.
echo Starting the mobile app through the Expo tunnel. When "Tunnel ready" and a QR code appear:
echo   Android: open Expo Go and scan the QR code.
echo   iPhone : scan it with the Camera app, or type the exp:// address into Safari.
echo Keep this window and the backend window open while you use the app.
echo.
call npx expo start --tunnel --clear
pause
