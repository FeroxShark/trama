@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0proyecto-ruta.ps1" %*
exit /b %ERRORLEVEL%
