[CmdletBinding()]
param(
    [string]$Generator = "MinGW Makefiles",
    [ValidateSet("Release","Debug","RelWithDebInfo","MinSizeRel")]
    [string]$Config = "Release",
    [int]$Parallel = 8,
    [switch]$Clean,
    [string]$LvglSrcPath = ""
)

$ErrorActionPreference = 'Stop'

$LvglPcRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

# LVGL source: use -LvglSrcPath if provided, else try env LVGL_SRC, else default
if([string]::IsNullOrWhiteSpace($LvglSrcPath)) {
    $LvglSrcPath = $env:LVGL_SRC
}
if([string]::IsNullOrWhiteSpace($LvglSrcPath)) {
    $LvglSrcPath = Join-Path $LvglPcRoot "..\LVGL"
}
$LvglSrc = Resolve-Path $LvglSrcPath -ErrorAction SilentlyContinue
if(-not $LvglSrc) {
    throw "LVGL source folder not found: $LvglSrcPath`nUse -LvglSrcPath or set LVGL_SRC environment variable."
}
$LvglSrc = $LvglSrc.Path
Write-Host "LVGL source: $LvglSrc" -ForegroundColor Cyan

$BuildDir = Join-Path $LvglPcRoot "_lvgl_build"
$InstallDir = Join-Path $LvglPcRoot "lvgl-lib"

if($Clean) {
    if(Test-Path $BuildDir) { Remove-Item -Recurse -Force $BuildDir }
    if(Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
}

New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

Write-Host "== Configure LVGL ==" -ForegroundColor Cyan

$LvConfPath = Join-Path $LvglPcRoot "lv_conf.h"
if(-not (Test-Path $LvConfPath)) {
    throw "lv_conf.h not found at: $LvConfPath"
}
# Use LV_CONF_INCLUDE_SIMPLE (default ON in custom.cmake) so that
# lv_conf_internal.h does: #include "lv_conf.h"
# We add lvgl-pc root to the include search path so the compiler finds it.
if($LvglPcRoot.Path) { $LvConfDir = $LvglPcRoot.Path } else { $LvConfDir = "$LvglPcRoot" }
$LvConfDir = $LvConfDir -replace '\\','/'

$cmakeArgs = @(
    "-S", $LvglSrc,
    "-B", $BuildDir,
    "-G", $Generator,
    "-DCMAKE_C_FLAGS=-I$LvConfDir",
    "-DCMAKE_CXX_FLAGS=-I$LvConfDir -D__STDC_FORMAT_MACROS",
    "-DCMAKE_INSTALL_PREFIX=$InstallDir",
    "-DBUILD_SHARED_LIBS=OFF",
    "-DLV_CONF_BUILD_DISABLE_DEMOS=ON",
    "-DLV_CONF_BUILD_DISABLE_EXAMPLES=ON"
)

& cmake @cmakeArgs

Write-Host "== Build + Install LVGL ($Config) ==" -ForegroundColor Cyan

# Copy lv_conf.h to LVGL source root so that cmake install can find it
# at the default path (CMAKE_SOURCE_DIR/lv_conf.h)
$TempConfCopy = Join-Path $LvglSrc "lv_conf.h"
Copy-Item -Path $LvConfPath -Destination $TempConfCopy -Force

$buildArgs = @(
    "--build", $BuildDir,
    "--target", "install",
    "--parallel", 64
)

if($Generator -match "Visual Studio" -or $Generator -match "Multi-Config") {
    $buildArgs += @("--config", $Config)
}

& cmake @buildArgs

# Clean up: remove the temporary lv_conf.h from LVGL source tree
Remove-Item -Path $TempConfCopy -Force -ErrorAction SilentlyContinue

# Copy missing root-level headers that cmake install doesn't include
# (e.g. lvgl_private.h is referenced by src/lvgl_private.h via "../lvgl_private.h")
$IncLvglDir = Join-Path $InstallDir "include\lvgl"
$RootHeaders = @("lvgl_private.h")
foreach($h in $RootHeaders) {
    $src = Join-Path $LvglSrc $h
    if(Test-Path $src) {
        Copy-Item -Path $src -Destination $IncLvglDir -Force
    }
}

Write-Host "== Done ==" -ForegroundColor Green
Write-Host "Installed to: $InstallDir" -ForegroundColor Green
Write-Host "- Headers:   $(Join-Path $InstallDir 'include\lvgl')" -ForegroundColor Green
Write-Host "- Library:   $(Join-Path $InstallDir 'lib')" -ForegroundColor Green
