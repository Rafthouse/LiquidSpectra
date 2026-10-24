cmake_minimum_required(VERSION 3.22)
project(LiquidSpectra VERSION 1.2.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# No global -mavx2 / /arch:AVX2 / -ffast-math:
#  - AVX2 flags break the arm64 half of a macOS Universal build and exclude older CPUs
#  - fast-math removes NaN/Inf handling the meters rely on
# JUCE's recommended flags (optimisation, LTO, warnings) are applied per target below.

# JUCE: use a local checkout when LIQUIDSPECTRA_JUCE_DIR is set, otherwise fetch a pinned release
set(LIQUIDSPECTRA_JUCE_DIR "" CACHE PATH "Path to an existing JUCE 8 checkout (optional)")
if(LIQUIDSPECTRA_JUCE_DIR)
    add_subdirectory("${LIQUIDSPECTRA_JUCE_DIR}" JUCE EXCLUDE_FROM_ALL)
else()
    include(FetchContent)
    FetchContent_Declare(
        JUCE
        GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
        GIT_TAG        8.0.15
        GIT_SHALLOW    TRUE
    )
    FetchContent_MakeAvailable(JUCE)
endif()

set(LIQUIDSPECTRA_FORMATS VST3 Standalone)
if(APPLE)
    list(APPEND LIQUIDSPECTRA_FORMATS AU)
endif()

juce_add_plugin(LiquidSpectra
    COMPANY_NAME "LiquidAudio"
    PLUGIN_MANUFACTURER_CODE Liqd
    PLUGIN_CODE LqSp
    FORMATS ${LIQUIDSPECTRA_FORMATS}
    PRODUCT_NAME "LiquidSpectra"
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS FALSE
    VST3_CATEGORIES Fx Analyzer
    AU_MAIN_TYPE kAudioUnitType_Effect
    # Copying into system plug-in folders needs admin rights on Windows; opt in explicitly
    COPY_PLUGIN_AFTER_BUILD FALSE
)

target_sources(LiquidSpectra PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginWebEditor.cpp
)

# The editor is the web analyzer (plugin/web/index.html, built by `npm run build:plugin-web`).
# The page is embedded as binary data, so the plugin is self-contained.
juce_add_binary_data(LiquidSpectraWebData
    HEADER_NAME "LiquidSpectraWebData.h"
    SOURCES web/index.html
)

# Source/PluginEditor.* (native JUCE editor) and Source/SkiaVectorRenderer.* are kept for reference
# and are not compiled: the web editor replaces them.

target_include_directories(LiquidSpectra PRIVATE
    Source
    "${CMAKE_CURRENT_BINARY_DIR}/juce_binarydata_LiquidSpectraWebData/JuceLibraryCode"
)

# Windows: WebView2 SDK (Microsoft.Web.WebView2 1.0.2903.40, pinned by hash) for the embedded web UI.
# Linked statically, so the plugin needs no WebView2Loader.dll next to it.
if(WIN32)
    set(LIQUIDSPECTRA_WEBVIEW2_URL "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.2903.40")
    set(LIQUIDSPECTRA_WEBVIEW2_SHA256 "ef128016dd1e51c59178c827ed5b8aa3322c57afa8675d930f8109505542ad74")
    set(LIQUIDSPECTRA_WEBVIEW2_DIR "${CMAKE_BINARY_DIR}/webview2-sdk")
    if(NOT EXISTS "${LIQUIDSPECTRA_WEBVIEW2_DIR}/build/native/include/WebView2.h")
        file(DOWNLOAD "${LIQUIDSPECTRA_WEBVIEW2_URL}" "${CMAKE_BINARY_DIR}/webview2-sdk.zip"
             EXPECTED_HASH SHA256=${LIQUIDSPECTRA_WEBVIEW2_SHA256} TLS_VERIFY ON)
        file(ARCHIVE_EXTRACT INPUT "${CMAKE_BINARY_DIR}/webview2-sdk.zip" DESTINATION "${LIQUIDSPECTRA_WEBVIEW2_DIR}")
    endif()

    target_include_directories(LiquidSpectra PRIVATE "${LIQUIDSPECTRA_WEBVIEW2_DIR}/build/native/include")
    target_link_libraries(LiquidSpectra PRIVATE "${LIQUIDSPECTRA_WEBVIEW2_DIR}/build/native/x64/WebView2LoaderStatic.lib")
    target_compile_definitions(LiquidSpectra PUBLIC JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1)
endif()

target_compile_definitions(LiquidSpectra PUBLIC
    JUCE_WEB_BROWSER=1
    # WebView2 on Windows; required for the resource provider that serves the embedded page
    JUCE_USE_WIN_WEBVIEW2=1
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
)

target_link_libraries(LiquidSpectra
    PRIVATE
        juce::juce_audio_utils
        juce::juce_dsp
        juce::juce_gui_extra
        LiquidSpectraWebData
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags
)

# DSP unit tests (real checks, independent of NDEBUG so they also run in Release)
option(LIQUIDSPECTRA_BUILD_TESTS "Build the DSP unit tests" ON)
if(LIQUIDSPECTRA_BUILD_TESTS)
    enable_testing()

    juce_add_console_app(DSPUnitTests PRODUCT_NAME "DSPUnitTests")
    target_sources(DSPUnitTests PRIVATE Tests/DSPUnitTests.cpp)
    target_include_directories(DSPUnitTests PRIVATE Source)
    target_compile_definitions(DSPUnitTests PRIVATE
        JUCE_WEB_BROWSER=0
        JUCE_USE_CURL=0
    )
    target_link_libraries(DSPUnitTests
        PRIVATE
            juce::juce_dsp
            juce::juce_audio_basics
        PUBLIC
            juce::juce_recommended_config_flags
            juce::juce_recommended_warning_flags
    )

    add_test(NAME AllDSPUnitTests COMMAND DSPUnitTests)
endif()
