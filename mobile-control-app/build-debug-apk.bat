@echo off
setlocal EnableExtensions
set "PCR_CHECK="
if /I "%~1"=="--check" set "PCR_CHECK=-Check"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-apk.ps1" %PCR_CHECK%
set "PCR_EXIT=%ERRORLEVEL%"
if /I not "%~1"=="--check" pause
exit /b %PCR_EXIT%
