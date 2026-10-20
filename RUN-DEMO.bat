@echo off
rem One-click demo: installs if needed, builds, starts the server and the bus
rem simulator (with students riding the buses) in their own windows, then opens the app.
cd /d "%~dp0"

where node >nul 2>nul || (echo Node.js 20+ is required: https://nodejs.org & pause & exit /b 1)

if not exist node_modules (
  echo Installing packages...
  call npm install || (pause & exit /b 1)
)
if not exist client\dist\index.html (
  echo Building the React app...
  call npm run build || (pause & exit /b 1)
)

rem Attendance samples phones only in the travel window; open it all day for the demo.
start "UBTS server" cmd /k "set TRAVEL_WINDOWS=00:00-24:00&& node server/index.js"
echo Waiting for the server...
:wait
timeout /t 2 /nobreak >nul
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://localhost:4000/api/health | Out-Null; exit 0 } catch { exit 1 }" || goto wait

start "UBTS simulator" cmd /k node scripts/simulate.js --riders --faults --drop 127:40
start "" http://localhost:4000/
