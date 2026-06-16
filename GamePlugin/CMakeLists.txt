cmake_minimum_required(VERSION 3.15)
project(FalloutPipBoySync VERSION 1.0 LANGUAGES CXX)

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION — Edit these paths to match your setup
# ═══════════════════════════════════════════════════════════════════════════════

# Path to xNVSE source directory (clone from https://github.com/xNVSE/NVSE)
# This should point to the directory containing the 'nvse/' subdirectory.
set(XNVSE_ROOT "" CACHE PATH "Path to xNVSE source root (containing nvse/ directory)")

if(NOT XNVSE_ROOT OR NOT EXISTS "${XNVSE_ROOT}/nvse")
    message(FATAL_ERROR 
        "XNVSE_ROOT must be set to the xNVSE source directory.\n"
        "Clone it from: https://github.com/xNVSE/NVSE\n"
        "Then configure with: cmake -DXNVSE_ROOT=<path_to_NVSE> .."
    )
endif()

# ═══════════════════════════════════════════════════════════════════════════════
# COMPILER SETTINGS
# ═══════════════════════════════════════════════════════════════════════════════

# Fallout NV is 32-bit — force x86 target
if(CMAKE_SIZEOF_VOID_P EQUAL 8)
    message(WARNING "Building for 64-bit detected. Fallout NV requires 32-bit. "
                    "Use -A Win32 when generating with cmake.")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Use static runtime to avoid DLL dependencies
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

# ═══════════════════════════════════════════════════════════════════════════════
# XNVSE LIBRARY
# ═══════════════════════════════════════════════════════════════════════════════

set(NVSE_SOURCES
    "${XNVSE_ROOT}/nvse/nvse/containers.cpp"
    "${XNVSE_ROOT}/nvse/nvse/GameAPI.cpp"
    "${XNVSE_ROOT}/nvse/nvse/GameBSExtraData.cpp"
    "${XNVSE_ROOT}/nvse/nvse/GameData.cpp"
    "${XNVSE_ROOT}/nvse/nvse/GameExtraData.cpp"
    "${XNVSE_ROOT}/nvse/nvse/GameForms.cpp"
    "${XNVSE_ROOT}/nvse/nvse/GameObjects.cpp"
    "${XNVSE_ROOT}/nvse/nvse/GameOSDepend.cpp"
    "${XNVSE_ROOT}/nvse/nvse/GameProcess.cpp"
    "${XNVSE_ROOT}/nvse/nvse/GameRTTI.cpp"
    "${XNVSE_ROOT}/nvse/nvse/GameScript.cpp"
    "${XNVSE_ROOT}/nvse/nvse/GameSettings.cpp"
    "${XNVSE_ROOT}/nvse/nvse/GameTasks.cpp"
    "${XNVSE_ROOT}/nvse/nvse/GameTiles.cpp"
    "${XNVSE_ROOT}/nvse/nvse/GameUI.cpp"
    "${XNVSE_ROOT}/nvse/nvse/GameTypes.cpp"
    "${XNVSE_ROOT}/nvse/nvse/NiTypes.cpp"
    "${XNVSE_ROOT}/nvse/nvse/printf.cpp"
    "${XNVSE_ROOT}/nvse/nvse/SafeWrite.cpp"
    "${XNVSE_ROOT}/nvse/nvse/Utilities.cpp"
    "${XNVSE_ROOT}/nvse/nvse/utility.cpp"
    "${XNVSE_ROOT}/common/IDataStream.cpp"
    "${XNVSE_ROOT}/common/IFileStream.cpp"
    "${XNVSE_ROOT}/common/IErrors.cpp"
    "${XNVSE_ROOT}/common/IDebugLog.cpp"
)

# ═══════════════════════════════════════════════════════════════════════════════
# PLUGIN TARGET
# ═══════════════════════════════════════════════════════════════════════════════

add_library(${PROJECT_NAME} SHARED
    src/main.cpp
    ${NVSE_SOURCES}
)

target_include_directories(${PROJECT_NAME} PRIVATE
    "${XNVSE_ROOT}"
    "${XNVSE_ROOT}/nvse"
    "${XNVSE_ROOT}/common"
)

target_compile_definitions(${PROJECT_NAME} PRIVATE
    WIN32
    _WINDOWS
    _USRDLL
    RUNTIME
    RUNTIME_VERSION=0x040020D0
)

# Force include nvse/prefix.h which provides standard types like UInt32
if(MSVC)
    target_compile_options(${PROJECT_NAME} PRIVATE "/FI\"nvse/prefix.h\"")
endif()

# Windows libraries needed for Named Pipes
target_link_libraries(${PROJECT_NAME} PRIVATE
    kernel32
)

# Set output name (no "lib" prefix)
set_target_properties(${PROJECT_NAME} PROPERTIES
    PREFIX ""
    OUTPUT_NAME "FalloutPipBoySync"
    SUFFIX ".dll"
)

# ═══════════════════════════════════════════════════════════════════════════════
# INSTALL
# ═══════════════════════════════════════════════════════════════════════════════

# Optional: Set your Fallout NV install path for easy deployment
set(FALLOUT_NV_PATH "" CACHE PATH "Path to Fallout New Vegas installation")

if(FALLOUT_NV_PATH AND EXISTS "${FALLOUT_NV_PATH}")
    install(TARGETS ${PROJECT_NAME}
        RUNTIME DESTINATION "${FALLOUT_NV_PATH}/Data/NVSE/Plugins"
        LIBRARY DESTINATION "${FALLOUT_NV_PATH}/Data/NVSE/Plugins"
    )
    message(STATUS "Install target will deploy to: ${FALLOUT_NV_PATH}/Data/NVSE/Plugins")
endif()
