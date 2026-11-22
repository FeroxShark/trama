@echo off
setlocal
rem PA_NODE puede ser el Electron de la app (pa lanzado desde la ventana): que corra como node
set "ELECTRON_RUN_AS_NODE=1"
if not defined PA_NODE set "PA_NODE=node"
"%PA_NODE%" "%~dp0cargo.mjs" %*
exit /b %errorlevel%
