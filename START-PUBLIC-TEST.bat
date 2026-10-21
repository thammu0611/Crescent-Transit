@echo off
rem Public test server: starts the backend (if it is not already running) and a
rem free Cloudflare quick tunnel, then shows the https address testers type into
rem the Android app (sign-in screen -> Server) or open in any phone's browser.
rem The address changes every time this starts. Close the windows to stop.
cd /d "%~dp0"
setlocal

where node >nul 2>nul || (echo Node.js 20+ is required: https://nodejs.org & pause & exit /b 1)

rem cloudflared: on PATH, next to this file in tools\, or in C:\ct\tools.
set "CF="
for /f "delims=" %%p in ('where cloudflared 2^>nul') do if not defined CF set "CF=%%p"
if not defined CF if exist "%~dp0tools\cloudflared.exe" set "CF=%~dp0tools\cloudflared.exe"
if not defined CF if exist "C:\ct\tools\cloudflared.exe" set "CF=C:\ct\tools\cloudflared.exe"
if not defined CF (
  echo cloudflared was not found. Install it with:  winget install Cloudflare.cloudflared
  pause & exit /b 1
)

if not exist node_modules (
  echo Installing packages...
  call npm install || (pause & exit /b 1)
)
if not exist client\dist\index.html (
  echo Building the web app...
  call npm run build || (pause & exit /b 1)
)

rem Backend: attendance open all day for testing; TRUST_PROXY so each tester's
rem own address (not the tunnel's) counts for rate limits.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://localhost:4000/api/health | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  start "UBTS server" cmd /k "set TRAVEL_WINDOWS=00:00-24:00&& set TRUST_PROXY=1&& node server/index.js"
  echo Waiting for the server...
  goto wait
)
echo The server is already running on port 4000.
goto tunnel

:wait
timeout /t 2 /nobreak >nul
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://localhost:4000/api/health | Out-Null; exit 0 } catch { exit 1 }" || goto wait

:tunnel
choice /c YN /m "Also start the bus simulator (moving buses for testers to watch)"
if not errorlevel 2 start "UBTS simulator" cmd /k node scripts/simulate.js

set "LOG=%TEMP%\crescent-tunnel.log"
if exist "%LOG%" del "%LOG%"
start "UBTS public tunnel - keep open" "%CF%" tunnel --no-autoupdate --url http://localhost:4000 --logfile "%LOG%"
echo Starting the public tunnel...
powershell -NoProfile -Command ^
  "$deadline=(Get-Date).AddSeconds(60); $u=$null;" ^
  "while(-not $u -and (Get-Date) -lt $deadline){ Start-Sleep 1; if(Test-Path $env:LOG){ $m=Select-String -Path $env:LOG -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1; if($m){ $u=$m.Matches[0].Value } } }" ^
  "if(-not $u){ Write-Host 'Could not read the tunnel address; look in the tunnel window.'; exit 1 }" ^
  "Set-Clipboard $u;" ^
  "Write-Host ''; Write-Host '  Public address (copied to the clipboard):' -ForegroundColor Yellow; Write-Host ('  ' + $u) -ForegroundColor Green; Write-Host '';" ^
  "Write-Host '  Android app : sign-in screen -> Server -> paste it -> Save and test';" ^
  "Write-Host '  Any browser : open it to use the web app';" ^
  "Write-Host '  Demo logins : stu001..stu024, drv118, admin, finance  (password Demo@2026)'; Write-Host ''"
echo Keep the server and tunnel windows open while people test.
pause
