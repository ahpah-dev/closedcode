@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo ClosedCode needs Node.js 22.22.2 or newer.
  echo Install Node.js from https://nodejs.org, then open this launcher again.
  pause
  exit /b 1
)
node "%~dp0scripts\start-closedcode.mjs"
set "ClosedCodeExitCode=%errorlevel%"
if not "%ClosedCodeExitCode%"=="0" pause
exit /b %ClosedCodeExitCode%
