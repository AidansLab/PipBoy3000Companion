cmake_minimum_required(VERSION 3.15)
project(FalloutPipBoySync VERSION 1.0 LANGUAGES CXX)

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# Two independent plugin targets share this project:
#   FalloutPipBoySync    — Fallout: New Vegas (xNVSE), from src/main.cpp
#   FalloutPipBoySyncFO3 — Fallout 3 (xFOSE), from src-fo3/main.cpp
# Each is built only when its SDK root is available. Both SDKs ship as git
# submodules (GamePlugin/xNVSE, GamePlugin/xFOSE), which the path variables
# default to — run `git submodule update --init` and no -D flags are needed.
# ═══════════════════════════════════════════════════════════════════════════════

set(XNVSE_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/xNVSE" CACHE PATH
    "Path to xNVSE source root (containing nvse/ directory)")
set(XFOSE_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/xFOSE" CACHE PATH
    "Path to xFOSE source root (containing fose/ directory)")

# Which plugins this build tree produces. Configure separate trees per game
# so each generated solution builds exactly one plugin:
#   cmake -S . -B build-nv  -A Win32 -DBUILD_FO3_PLUGIN=OFF
#   cmake -S . -B build-fo3 -A Win32 -DBUILD_NV_PLUGIN=OFF
option(BUILD_NV_PLUGIN "Build the Fallout: New Vegas plugin (xNVSE)" ON)
option(BUILD_FO3_PLUGIN "Build the Fallout 3 plugin (xFOSE)" ON)

set(HAVE_XNVSE FALSE)
set(HAVE_XFOSE FALSE)
if(BUILD_NV_PLUGIN AND XNVSE_ROOT AND EXISTS "${XNVSE_ROOT}/nvse")
    set(HAVE_XNVSE TRUE)
endif()
if(BUILD_FO3_PLUGIN AND XFOSE_ROOT AND EXISTS "${XFOSE_ROOT}/fose")
    set(HAVE_XFOSE TRUE)
endif()

if(NOT HAVE_XNVSE AND NOT HAVE_XFOSE)
    message(FATAL_ERROR
        "No plugin target enabled (SDK missing or both BUILD_*_PLUGIN options OFF).\n"
        "Fetch the bundled submodules:  git submodule update --init\n"
        "or point at checkouts manually: cmake -DXNVSE_ROOT=<NVSE> -DXFOSE_ROOT=<xFOSE> .."
    )
endif()

# ═══════════════════════════════════════════════════════════════════════════════
# COMPILER SETTINGS
# ═══════════════════════════════════════════════════════════════════════════════

# Both games are 32-bit — force x86 target
if(CMAKE_SIZEOF_VOID_P EQUAL 8)
    message(WARNING "Building for 64-bit detected. Fallout 3 / New Vegas require 32-bit. "
                    "Use -A Win32 when generating with cmake.")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Use static runtime to avoid DLL dependencies
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

# ═══════════════════════════════════════════════════════════════════════════════
# FALLOUT: NEW VEGAS TARGET (xNVSE)
# ═══════════════════════════════════════════════════════════════════════════════

if(HAVE_XNVSE)

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

endif() # HAVE_XNVSE

# ═══════════════════════════════════════════════════════════════════════════════
# FALLOUT 3 TARGET (xFOSE)
# Notes:
#  - xFOSE's repository ships only common/IArchive.cpp; the shared "common"
#    library headers (common/IPrefix.h etc.) come from the same Ian Patterson
#    lineage as xNVSE's, so the FO3 target borrows xNVSE's common/ directory
#    for those headers and their .cpp implementations.
#  - The FOSE game-data sources are 2008-era C++; the FO3 target compiles as
#    C++14 (the plugin source itself is C++11-compatible).
#  - Output is also named FalloutPipBoySync.dll (per the documented install
#    layout: Data\NVSE\Plugins vs Data\FOSE\Plugins), in an fo3/ subdir so
#    the two DLLs never collide in the build tree.
# ═══════════════════════════════════════════════════════════════════════════════

if(HAVE_XFOSE)

# The FO3 target borrows xNVSE's common/ library headers (xFOSE does not
# bundle them) — the xNVSE checkout must exist even when its plugin target
# is disabled for this tree.
if(NOT EXISTS "${XNVSE_ROOT}/common")
    message(FATAL_ERROR
        "The Fallout 3 target needs xNVSE's common/ library headers "
        "(xFOSE does not bundle them). Fetch both submodules: git submodule update --init"
    )
endif()

set(FOSE_SOURCES
    "${XFOSE_ROOT}/fose/fose/GameAPI.cpp"
    "${XFOSE_ROOT}/fose/fose/GameBSExtraData.cpp"
    "${XFOSE_ROOT}/fose/fose/GameData.cpp"
    "${XFOSE_ROOT}/fose/fose/GameExtraData.cpp"
    "${XFOSE_ROOT}/fose/fose/GameForms.cpp"
    "${XFOSE_ROOT}/fose/fose/GameInterface.cpp"
    "${XFOSE_ROOT}/fose/fose/GameObjects.cpp"
    "${XFOSE_ROOT}/fose/fose/GameRTTI.cpp"
    "${XFOSE_ROOT}/fose/fose/GameSettings.cpp"
    "${XFOSE_ROOT}/fose/fose/GameTiles.cpp"
    "${XFOSE_ROOT}/fose/fose/GameTypes.cpp"
    "${XFOSE_ROOT}/fose/fose/Utilities.cpp"
    "${XFOSE_ROOT}/fose/fose_common/SafeWrite.cpp"
    "${XNVSE_ROOT}/common/IErrors.cpp"
    "${XNVSE_ROOT}/common/IDebugLog.cpp"
    "${XNVSE_ROOT}/common/IDataStream.cpp"
    "${XNVSE_ROOT}/common/IFileStream.cpp"
)

add_library(FalloutPipBoySyncFO3 SHARED
    src-fo3/main.cpp
    ${FOSE_SOURCES}
)

target_include_directories(FalloutPipBoySyncFO3 PRIVATE
    "${XFOSE_ROOT}/fose"       # fose/*.h, fose_common/*.h
    "${XNVSE_ROOT}"            # common/*.h (shared library headers)
)

target_compile_definitions(FalloutPipBoySyncFO3 PRIVATE
    WIN32
    _WINDOWS
    _USRDLL
    RUNTIME
    FALLOUT_VERSION=0x01070030   # Fallout 3 1.7.0.3
)

# Force include the prefix wrapper (std headers the 2008-era FOSE sources
# expect from a PCH, then fose_prefix.h for UInt32 etc.)
if(MSVC)
    target_compile_options(FalloutPipBoySyncFO3 PRIVATE "/FI\"${CMAKE_CURRENT_SOURCE_DIR}/src-fo3/fose_prefix_fix.h\"")
endif()

target_link_libraries(FalloutPipBoySyncFO3 PRIVATE
    kernel32
    user32   # main-thread pump: EnumWindows / SetTimer
)

set_target_properties(FalloutPipBoySyncFO3 PROPERTIES
    PREFIX ""
    OUTPUT_NAME "FalloutPipBoySync"
    SUFFIX ".dll"
    CXX_STANDARD 14
    CXX_STANDARD_REQUIRED ON
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/fo3"
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/fo3"
    ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/fo3"
)

endif() # HAVE_XFOSE

# ═══════════════════════════════════════════════════════════════════════════════
# INSTALL
# ═══════════════════════════════════════════════════════════════════════════════

# Optional: Set your game install paths for easy deployment
set(FALLOUT_NV_PATH "" CACHE PATH "Path to Fallout New Vegas installation")
set(FALLOUT_3_PATH "" CACHE PATH "Path to Fallout 3 installation")

if(HAVE_XNVSE AND FALLOUT_NV_PATH AND EXISTS "${FALLOUT_NV_PATH}")
    install(TARGETS ${PROJECT_NAME}
        RUNTIME DESTINATION "${FALLOUT_NV_PATH}/Data/NVSE/Plugins"
        LIBRARY DESTINATION "${FALLOUT_NV_PATH}/Data/NVSE/Plugins"
    )
    message(STATUS "Install target will deploy NV plugin to: ${FALLOUT_NV_PATH}/Data/NVSE/Plugins")
endif()

if(HAVE_XFOSE AND FALLOUT_3_PATH AND EXISTS "${FALLOUT_3_PATH}")
    install(TARGETS FalloutPipBoySyncFO3
        RUNTIME DESTINATION "${FALLOUT_3_PATH}/Data/FOSE/Plugins"
        LIBRARY DESTINATION "${FALLOUT_3_PATH}/Data/FOSE/Plugins"
    )
    message(STATUS "Install target will deploy FO3 plugin to: ${FALLOUT_3_PATH}/Data/FOSE/Plugins")
endif()
