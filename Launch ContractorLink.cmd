@echo off
setlocal
cd /d "%~dp0"
title ContractorLink
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch.ps1"
if errorlevel 1 (
  echo.
  echo Setup could not finish. Read the error above and try again.
  pause
)
