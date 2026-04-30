@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"

REM ============================================
REM LVGL source path
REM ============================================
if "%LVGL_SRC%"=="" set "LVGL_SRC=%SCRIPT_DIR%..\..\LVGL"

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%build-lvgl-lib.ps1" -LvglSrcPath "%LVGL_SRC%" -Clean %*
pause
endlocal
