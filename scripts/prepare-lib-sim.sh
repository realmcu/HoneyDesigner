#!/bin/bash
# 从 SDK 准备插件内置库文件 - 操作指南

cat << 'EOF'
================================================================================
  HoneyGUI 插件内置库准备指南
================================================================================

插件已不依赖外部 SDK，但打包前需要从 HoneyGUI SDK 准备以下文件到 lib/sim/

--------------------------------------------------------------------------------
第一步：拷贝仿真端源码
--------------------------------------------------------------------------------
从 SDK 的 simulator/win32 目录拷贝（包含 .config 配置文件），目标目录名固定为 win32_sim：

  mkdir -p ./lib/sim/win32_sim && cp -r /path/to/HoneyGUI-SDK/simulator/win32/. ./lib/sim/win32_sim/

注意：不要写成 "cp -r .../simulator/win32 ./lib/sim/"，那样得到的是 lib/sim/win32/
（与预编译库目录同名），而不是 lib/sim/win32_sim/；源路径末尾的 "/." 用于连同 .config 等隐藏文件一起拷贝。

--------------------------------------------------------------------------------
第二步：拷贝头文件
--------------------------------------------------------------------------------
从 SDK 拷贝 GUI 框架头文件到 include 目录：

  mkdir -p ./lib/sim/include
  cp /path/to/HoneyGUI-SDK/realgui/engine/*.h ./lib/sim/include/
  cp /path/to/HoneyGUI-SDK/realgui/widget/*.h ./lib/sim/include/
  cp /path/to/HoneyGUI-SDK/realgui/server/*.h ./lib/sim/include/
  cp /path/to/HoneyGUI-SDK/realgui/3rd/*.h ./lib/sim/include/

--------------------------------------------------------------------------------
第三步：拷贝构建工具
--------------------------------------------------------------------------------
从 SDK 拷贝 SCons 构建脚本：

  mkdir -p ./lib/sim/tool
  cp -r /path/to/HoneyGUI-SDK/tool/scons-tool ./lib/sim/tool/

注意：mkromfs 已用 TypeScript 重写，位于 tools/mkromfs.ts，无需拷贝

--------------------------------------------------------------------------------
第四步：编译预编译库（Linux）
--------------------------------------------------------------------------------
在 Linux 环境下编译 libgui.a：

  cd /path/to/HoneyGUI-SDK/simulator/win32
  scons --buildlib=gui
  cp build/libgui.a /path/to/plugin/lib/sim/linux/

--------------------------------------------------------------------------------
第五步：编译预编译库（Windows）
--------------------------------------------------------------------------------
在 Windows + MinGW 环境下编译 libgui.a：

  cd C:\path\to\HoneyGUI-SDK\simulator\win32
  scons --buildlib=gui
  copy build\libgui.a C:\path\to\plugin\lib\sim\win32\

--------------------------------------------------------------------------------
第六步：验证文件完整性
--------------------------------------------------------------------------------
检查以下文件是否存在：

  ✓ lib/sim/win32_sim/main.c
  ✓ lib/sim/win32_sim/.config
  ✓ lib/sim/include/gui_api.h
  ✓ lib/sim/tool/scons-tool/building.py
  ✓ lib/sim/linux/libgui.a (~3.7 MB)
  ✓ lib/sim/win32/libgui.a (~4 MB)
  ✓ lib/sim/SDL2-2.26.0-STATIC/ (已内置)

--------------------------------------------------------------------------------
第七步：打包插件
--------------------------------------------------------------------------------
编译并打包插件：

  npm run compile
  npm run build:webview
  vsce package

生成：honeygui-visual-designer-x.x.x.vsix

================================================================================
EOF
