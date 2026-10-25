@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0pa.ps1" %*
exit /b %ERRORLEVEL%
