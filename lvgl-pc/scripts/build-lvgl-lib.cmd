@echo off
setlocal

set SCRIPT_DIR=%~dp0

REM ============================================
REM LVGL source path: 请修改为你本地的 LVGL v9 源码路径
REM ============================================
if "%LVGL_SRC%"=="" set LVGL_SRC=%SCRIPT_DIR%..\..\LVGL

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%build-lvgl-lib.ps1" -LvglSrcPath "%LVGL_SRC%" -Clean %*
pause
endlocal
