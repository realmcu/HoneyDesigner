#!/usr/bin/env bash
# 编译 LVGL 静态库 (Linux/macOS)，对应 build-lvgl-lib.ps1 的 bash 版本。
# 默认安装到 lvgl-pc/lvgl-lib（CI 用，会覆盖检出里的 Windows .a）。
#
# ⚠️ 本地慎用：默认 INSTALL_DIR 会覆盖仓库自带的 Windows lvgl-lib，
#    破坏本地 Windows 仿真。本地验证请用 INSTALL_DIR 指向独立目录，例如：
#    INSTALL_DIR=$HOME/lvgl-linux/lvgl-lib ./build-lvgl-lib-linux.sh
#
# 用法：
#   ./build-lvgl-lib-linux.sh [LVGL_SRC]
#   LVGL_SRC 优先级：第 1 个参数 > $LVGL_SRC 环境变量 > 默认 ../../LVGL
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LVGL_PC_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# LVGL 源码路径
LVGL_SRC="${1:-${LVGL_SRC:-$LVGL_PC_ROOT/../LVGL}}"
if [ ! -d "$LVGL_SRC" ]; then
    echo "LVGL source folder not found: $LVGL_SRC" >&2
    echo "Pass it as arg1 or set LVGL_SRC env var." >&2
    exit 1
fi
LVGL_SRC="$(cd "$LVGL_SRC" && pwd)"

INSTALL_DIR="${INSTALL_DIR:-$LVGL_PC_ROOT/lvgl-lib}"
BUILD_DIR="${BUILD_DIR:-$LVGL_PC_ROOT/_lvgl_build}"
JOBS="$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"

echo "LVGL source : $LVGL_SRC"
echo "Install dir : $INSTALL_DIR"
echo "Build dir   : $BUILD_DIR"

LV_CONF="$LVGL_PC_ROOT/lv_conf.h"
[ -f "$LV_CONF" ] || { echo "lv_conf.h not found: $LV_CONF" >&2; exit 1; }

# cmake install 阶段需要源码根存在 lv_conf.h（LV_CONF_INCLUDE_SIMPLE）；用完即删。
cp "$LV_CONF" "$LVGL_SRC/lv_conf.h"
trap 'rm -f "$LVGL_SRC/lv_conf.h"' EXIT

echo "== Configure LVGL =="
cmake -S "$LVGL_SRC" -B "$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_FLAGS="-I$LVGL_PC_ROOT" \
    -DCMAKE_CXX_FLAGS="-I$LVGL_PC_ROOT -D__STDC_FORMAT_MACROS" \
    -DCMAKE_INSTALL_PREFIX="$INSTALL_DIR" \
    -DBUILD_SHARED_LIBS=OFF \
    -DLV_CONF_BUILD_DISABLE_DEMOS=ON \
    -DLV_CONF_BUILD_DISABLE_EXAMPLES=ON

echo "== Build + Install LVGL =="
cmake --build "$BUILD_DIR" --target install -j"$JOBS"

# 补 cmake install 漏装的 root 头（lvgl_private.h 被 src/lvgl_private.h 以 ../ 引用）
if [ -f "$LVGL_SRC/lvgl_private.h" ]; then
    cp "$LVGL_SRC/lvgl_private.h" "$INSTALL_DIR/include/lvgl/"
fi

echo "== Done =="
echo "Installed to: $INSTALL_DIR"
ls -la "$INSTALL_DIR/lib/"
