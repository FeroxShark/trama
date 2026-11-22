@echo off
setlocal
if not defined PA_NODE set "PA_NODE=node"
"%PA_NODE%" "%~dp0git.mjs" %*
exit /b %errorlevel%
