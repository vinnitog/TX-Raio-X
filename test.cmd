@echo off
setlocal
cd /d "%~dp0"
npm.cmd test
exit /b %errorlevel%
