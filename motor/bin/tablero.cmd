@echo off
where py >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    py -3 "%~dp0tablero" %*
    exit /b %ERRORLEVEL%
)
python "%~dp0tablero" %*
exit /b %ERRORLEVEL%
