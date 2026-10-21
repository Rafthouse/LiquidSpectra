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
    Source/PluginEditor.cpp
)

# Source/SkiaVectorRenderer.* is an experimental Skia renderer kept for reference; it is not
# compiled because the project does not ship or link Skia.

target_include_directories(LiquidSpectra PRIVATE Source)

target_compile_definitions(LiquidSpectra PUBLIC
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0
)

target_link_libraries(LiquidSpectra
    PRIVATE
        juce::juce_audio_utils
        juce::juce_dsp
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
