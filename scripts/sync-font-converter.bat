@echo off
setlocal

set ROOT=%~dp0..
set SRC=%ROOT%\font-tool-typescript\dist\font-converter-deploy
set DEST=%ROOT%\tools\font-converter

echo === Sync font-converter ===
echo SRC:  %SRC%
echo DEST: %DEST%
echo.

echo [1/3] Building deploy package...
node "%ROOT%\font-tool-typescript\scripts\pack-deploy.js"
if errorlevel 1 (
    echo [ERROR] pack-deploy.js failed.
    pause
    exit /b 1
)
echo.

if exist "%DEST%" (
    echo [2/3] Removing old release...
    rmdir /s /q "%DEST%"
)

echo [3/3] Copying new release...
xcopy /e /i /q "%SRC%" "%DEST%"

echo.
echo Done.
pause
