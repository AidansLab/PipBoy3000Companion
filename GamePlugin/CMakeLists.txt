cmake_minimum_required(VERSION 3.15)
project(FalloutPipBoySync VERSION 1.0 LANGUAGES CXX)

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# Two independent plugin targets share this project:
#   FalloutPipBoySyncNV  - Fallout: New Vegas (xNVSE), from src/main.cpp
#   FalloutPipBoySyncFO3 - Fallout 3 (official FOSE, silverlock.org), from
#                          src-fo3/main.cpp
# Each is built only when its SDK root is available. xNVSE ships as a git
# submodule (GamePlugin/xNVSE). FOSE is NOT on GitHub and is included in
# this git repo for ease of building.
# ═══════════════════════════════════════════════════════════════════════════════

set(XNVSE_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/xNVSE" CACHE PATH
    "Path to xNVSE source root (containing nvse/ directory)")
set(FOSE_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/FOSE" CACHE PATH
    "Path to the official FOSE SDK root (containing fose/ and common/ directories)")

# Which plugins this build tree produces. Configure separate trees per game
# so each generated solution builds exactly one plugin:
#   cmake -S . -B build-nv  -A Win32 -DBUILD_FO3_PLUGIN=OFF
#   cmake -S . -B build-fo3 -A Win32 -DBUILD_NV_PLUGIN=OFF
option(BUILD_NV_PLUGIN "Build the Fallout: New Vegas plugin (xNVSE)" ON)
option(BUILD_FO3_PLUGIN "Build the Fallout 3 plugin (FOSE)" ON)

set(HAVE_XNVSE FALSE)
set(HAVE_FOSE FALSE)
if(BUILD_NV_PLUGIN AND XNVSE_ROOT AND EXISTS "${XNVSE_ROOT}/nvse")
    set(HAVE_XNVSE TRUE)
endif()
if(BUILD_FO3_PLUGIN AND FOSE_ROOT AND EXISTS "${FOSE_ROOT}/fose")
    set(HAVE_FOSE TRUE)
endif()

if(NOT HAVE_XNVSE AND NOT HAVE_FOSE)
    message(FATAL_ERROR
        "No plugin target enabled (SDK missing or both BUILD_*_PLUGIN options OFF).\n"
        "xNVSE is a bundled submodule:  git submodule update --init\n"
        "FOSE is not on GitHub - download it from https://fose.silverlock.org "
        "and extract to GamePlugin/FOSE, or point at it manually: "
        "cmake -DXNVSE_ROOT=<xNVSE> -DFOSE_ROOT=<FOSE> .."
    )
endif()

# ═══════════════════════════════════════════════════════════════════════════════
# COMPILER SETTINGS
# ═══════════════════════════════════════════════════════════════════════════════

# Both games are 32-bit - force x86 target
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
    src-nv/main.cpp
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
    OUTPUT_NAME "Pip-Boy Sync NV By Aidan's Lab"
    SUFFIX ".dll"
)

# Release zip with the mod-manager layout (paths relative to Data/):
#   nvse/plugins/<OUTPUT_NAME>.dll
# Staged then zipped with cmake -E tar so no external zip tool is needed.
add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E rm -rf "${CMAKE_CURRENT_BINARY_DIR}/zip-nv/nvse/plugins"
    COMMAND ${CMAKE_COMMAND} -E make_directory "${CMAKE_CURRENT_BINARY_DIR}/zip-nv/nvse/plugins"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "$<TARGET_FILE:${PROJECT_NAME}>"
            "${CMAKE_CURRENT_BINARY_DIR}/zip-nv/nvse/plugins/"
    COMMAND ${CMAKE_COMMAND} -E tar cf
            "${CMAKE_CURRENT_BINARY_DIR}/$<TARGET_FILE_BASE_NAME:${PROJECT_NAME}>.zip"
            --format=zip -- nvse
    WORKING_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/zip-nv"
    COMMENT "Packaging NV release zip (nvse/plugins/ layout, staging dir cleaned first)"
)

endif() # HAVE_XNVSE

# ═══════════════════════════════════════════════════════════════════════════════
# FALLOUT 3 TARGET (official FOSE)
# ═══════════════════════════════════════════════════════════════════════════════

if(HAVE_FOSE)

set(FOSE_SOURCES
    "${FOSE_ROOT}/fose/fose/GameAPI.cpp"
    "${FOSE_ROOT}/fose/fose/GameBSExtraData.cpp"
    "${FOSE_ROOT}/fose/fose/GameData.cpp"
    "${FOSE_ROOT}/fose/fose/GameExtraData.cpp"
    "${FOSE_ROOT}/fose/fose/GameForms.cpp"
    "${FOSE_ROOT}/fose/fose/GameInterface.cpp"
    "${FOSE_ROOT}/fose/fose/GameObjects.cpp"
    "${FOSE_ROOT}/fose/fose/GameRTTI.cpp"
    "${FOSE_ROOT}/fose/fose/GameSettings.cpp"
    "${FOSE_ROOT}/fose/fose/GameTiles.cpp"
    "${FOSE_ROOT}/fose/fose/GameTypes.cpp"
    "${FOSE_ROOT}/fose/fose/Utilities.cpp"
    "${FOSE_ROOT}/fose/fose_common/SafeWrite.cpp"
    "${FOSE_ROOT}/common/IErrors.cpp"
    "${FOSE_ROOT}/common/IDebugLog.cpp"
    "${FOSE_ROOT}/common/IDataStream.cpp"
    "${FOSE_ROOT}/common/IFileStream.cpp"
)

add_library(FalloutPipBoySyncFO3 SHARED
    src-fo3/main.cpp
    ${FOSE_SOURCES}
)

target_include_directories(FalloutPipBoySyncFO3 PRIVATE
    "${FOSE_ROOT}/fose"       # fose/*.h, fose_common/*.h
    "${FOSE_ROOT}"            # common/*.h
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
    OUTPUT_NAME "Pip-Boy Sync F3 By Aidan's Lab"
    SUFFIX ".dll"
    CXX_STANDARD 14
    CXX_STANDARD_REQUIRED ON
)

# Release zip with the mod-manager layout (paths relative to Data/):
#   fose/plugins/<OUTPUT_NAME>.dll
# Staged then zipped with cmake -E tar so no external zip tool is needed.
add_custom_command(TARGET FalloutPipBoySyncFO3 POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E rm -rf "${CMAKE_CURRENT_BINARY_DIR}/zip-fo3/fose/plugins"
    COMMAND ${CMAKE_COMMAND} -E make_directory "${CMAKE_CURRENT_BINARY_DIR}/zip-fo3/fose/plugins"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "$<TARGET_FILE:FalloutPipBoySyncFO3>"
            "${CMAKE_CURRENT_BINARY_DIR}/zip-fo3/fose/plugins/"
    COMMAND ${CMAKE_COMMAND} -E tar cf
            "${CMAKE_CURRENT_BINARY_DIR}/$<TARGET_FILE_BASE_NAME:FalloutPipBoySyncFO3>.zip"
            --format=zip -- fose
    WORKING_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/zip-fo3"
    COMMENT "Packaging FO3 release zip (fose/plugins/ layout, staging dir cleaned first)"
)

endif() # HAVE_FOSE

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

if(HAVE_FOSE AND FALLOUT_3_PATH AND EXISTS "${FALLOUT_3_PATH}")
    install(TARGETS FalloutPipBoySyncFO3
        RUNTIME DESTINATION "${FALLOUT_3_PATH}/Data/FOSE/Plugins"
        LIBRARY DESTINATION "${FALLOUT_3_PATH}/Data/FOSE/Plugins"
    )
    message(STATUS "Install target will deploy FO3 plugin to: ${FALLOUT_3_PATH}/Data/FOSE/Plugins")
endif()
