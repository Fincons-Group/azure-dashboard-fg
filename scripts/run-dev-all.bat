@echo off
setlocal

cd /d "%~dp0.."

echo Killing any existing dev processes...
call npm run kill:dev

echo Starting npm run dev:all...
call npm run dev:all

endlocal
