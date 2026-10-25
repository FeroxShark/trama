@echo off
title Detener Trama
echo Deteniendo procesos de Trama en Windows y WSL...
taskkill /f /im Trama.exe >nul 2>&1
taskkill /f /fi "WINDOWTITLE eq Trama Motor*" >nul 2>&1
wsl.exe -e systemctl --user stop trama-motor >nul 2>&1
echo Trama detenido.
timeout /t 2 >nul
exit
