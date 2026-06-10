cmake_minimum_required(VERSION 3.20)

project(lvgl_pc LANGUAGES C CXX)

# LVGL v9.x 内置 ThorVG（C++ 实现），必须用 g++ 链接
set(CMAKE_CXX_STANDARD 14)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ============================================================
# Paths
# ============================================================
set(LVGL_PREBUILT_DIR "${CMAKE_CURRENT_LIST_DIR}/lvgl-lib"
    CACHE PATH "Path to prebuilt LVGL install prefix")
set(LVGL_PREBUILT_INCLUDE_DIR "${LVGL_PREBUILT_DIR}/include/lvgl")

# SDL2 static library bundled with the extension
set(SDL2_ROOT "${CMAKE_CURRENT_LIST_DIR}/../lib/sim/SDL2-2.26.0-STATIC"
    CACHE PATH "Path to SDL2 static library")

# Display resolution (overridden via cmake -DLCD_WIDTH=xxx -DLCD_HEIGHT=xxx)
set(LCD_WIDTH 480 CACHE STRING "LCD display width")
set(LCD_HEIGHT 480 CACHE STRING "LCD display height")

# ============================================================
# Prebuilt LVGL library
# ============================================================
find_library(LVGL_PREBUILT_LIBRARY
    NAMES lvgl
    PATHS "${LVGL_PREBUILT_DIR}/lib"
    NO_DEFAULT_PATH)

find_library(LVGL_THORVG_LIBRARY
    NAMES lvgl_thorvg
    PATHS "${LVGL_PREBUILT_DIR}/lib"
    NO_DEFAULT_PATH)

if(NOT LVGL_PREBUILT_LIBRARY)
    message(FATAL_ERROR
        "Prebuilt LVGL library not found in ${LVGL_PREBUILT_DIR}.\n"
        "Build/install it first:\n"
        "  lvgl-pc\\scripts\\build-lvgl-lib.cmd\n")
endif()

add_library(lvgl STATIC IMPORTED GLOBAL)
set_target_properties(lvgl PROPERTIES
    IMPORTED_LOCATION "${LVGL_PREBUILT_LIBRARY}"
    INTERFACE_INCLUDE_DIRECTORIES "${LVGL_PREBUILT_INCLUDE_DIR}"
    INTERFACE_COMPILE_DEFINITIONS "LV_CONF_INCLUDE_SIMPLE;LV_LVGL_H_INCLUDE_SIMPLE")

if(LVGL_THORVG_LIBRARY)
    add_library(lvgl_thorvg STATIC IMPORTED GLOBAL)
    set_target_properties(lvgl_thorvg PROPERTIES
        IMPORTED_LOCATION "${LVGL_THORVG_LIBRARY}")
endif()

# ============================================================
# SDL2
# ============================================================
if(WIN32)
    # Bundled static SDL2 for Windows (MinGW)
    find_library(SDL2_LIBRARY
        NAMES SDL2
        PATHS "${SDL2_ROOT}/lib"
        NO_DEFAULT_PATH)
    find_library(SDL2MAIN_LIBRARY
        NAMES SDL2main
        PATHS "${SDL2_ROOT}/lib"
        NO_DEFAULT_PATH)

    if(NOT SDL2_LIBRARY)
        message(FATAL_ERROR "SDL2 static library not found in ${SDL2_ROOT}/lib")
    endif()

    add_library(SDL2 STATIC IMPORTED GLOBAL)
    set_target_properties(SDL2 PROPERTIES
        IMPORTED_LOCATION "${SDL2_LIBRARY}"
        INTERFACE_INCLUDE_DIRECTORIES "${SDL2_ROOT}/include")

    if(SDL2MAIN_LIBRARY)
        add_library(SDL2main STATIC IMPORTED GLOBAL)
        set_target_properties(SDL2main PROPERTIES
            IMPORTED_LOCATION "${SDL2MAIN_LIBRARY}")
    endif()
else()
    # System SDL2 for Linux/macOS (apt install libsdl2-dev)
    find_package(PkgConfig REQUIRED)
    # IMPORTED_TARGET 生成 PkgConfig::SDL2_PKG，携带 -lSDL2 / 头路径 / 库目录
    pkg_check_modules(SDL2_PKG REQUIRED IMPORTED_TARGET sdl2)

    # 转发到 PkgConfig::SDL2_PKG。不能用 ${SDL2_PKG_LIBRARIES}（值为 "SDL2"），
    # 它与本 INTERFACE target 同名会自引用，使 -lSDL2 从链接行丢失。
    add_library(SDL2 INTERFACE)
    target_link_libraries(SDL2 INTERFACE PkgConfig::SDL2_PKG)
endif()

# ============================================================
# Executable
# ============================================================
add_executable(lvgl_pc
    src/main.c
    src/fb_sdl.c
    src/lv_port_disp.c
    src/lv_port_indev.c
    src/generated/lvgl_generated_ui.c
)

# Force C++ linker for ThorVG objects inside liblvgl.a
set_target_properties(lvgl_pc PROPERTIES LINKER_LANGUAGE CXX)

target_include_directories(lvgl_pc PRIVATE
    "${CMAKE_CURRENT_LIST_DIR}/src")

if(WIN32)
    target_include_directories(lvgl_pc PRIVATE
        "${SDL2_ROOT}/include"
        "${SDL2_ROOT}/include/SDL2")
endif()

# Glob generated UI / callback / image / font sources
file(GLOB LVGL_GENERATED_UI_SOURCES
    "${CMAKE_CURRENT_LIST_DIR}/src/generated/*_lvgl_ui.c")
file(GLOB LVGL_GENERATED_CB_SOURCES
    "${CMAKE_CURRENT_LIST_DIR}/src/generated/*_lvgl_callbacks.c")
file(GLOB LVGL_GENERATED_IMG_SOURCES
    "${CMAKE_CURRENT_LIST_DIR}/src/generated/img_*.c")
file(GLOB LVGL_GENERATED_FONT_SOURCES
    "${CMAKE_CURRENT_LIST_DIR}/src/generated/fonts/*.c"
    "${CMAKE_CURRENT_LIST_DIR}/src/generated/font_*.c")
# lv_img_dsc_list.c for external-bin deployment mode
file(GLOB LVGL_IMG_DSC_LIST_SOURCES
    "${CMAKE_CURRENT_LIST_DIR}/src/generated/lv_img_dsc_list.c")

target_sources(lvgl_pc PRIVATE
    ${LVGL_GENERATED_UI_SOURCES}
    ${LVGL_GENERATED_CB_SOURCES}
    ${LVGL_GENERATED_IMG_SOURCES}
    ${LVGL_GENERATED_FONT_SOURCES}
    ${LVGL_IMG_DSC_LIST_SOURCES})

# ============================================================
# Link libraries
# ============================================================
target_link_libraries(lvgl_pc PRIVATE lvgl)

if(LVGL_THORVG_LIBRARY)
    target_link_libraries(lvgl_pc PRIVATE lvgl_thorvg)
endif()

target_link_libraries(lvgl_pc PRIVATE SDL2)

if(SDL2MAIN_LIBRARY)
    target_link_libraries(lvgl_pc PRIVATE SDL2main)
endif()

# SDL2 static lib on Windows needs these system libs
if(WIN32)
    target_link_libraries(lvgl_pc PRIVATE
        user32 gdi32 winmm imm32 ole32 oleaut32
        version setupapi hid)
endif()

# pthreads (MinGW bundles it; on Linux/macOS link explicitly)
if(NOT WIN32)
    find_package(Threads REQUIRED)
    target_link_libraries(lvgl_pc PRIVATE Threads::Threads)
endif()

# ============================================================
# Compile definitions
# ============================================================
target_compile_definitions(lvgl_pc PRIVATE
    LCD_WIDTH=${LCD_WIDTH}
    LCD_HEIGHT=${LCD_HEIGHT}
    _HONEYGUI_SIMULATOR_)

if(WIN32)
    target_compile_definitions(lvgl_pc PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
endif()

# C++ standard library (MinGW/GCC needs explicit link)
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    target_link_libraries(lvgl_pc PRIVATE stdc++)
endif()
