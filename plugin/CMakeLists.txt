cmake_minimum_required(VERSION 3.22)
project(LiquidSpectra VERSION 1.2.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Enable SIMD Vectorization
if(MSVC)
    add_compile_options(/O2 /arch:AVX2 /fp:fast /W4)
else()
    add_compile_options(-O3 -mavx2 -mfma -ffast-math -Wall -Wextra -pthread)
endif()

# Fetch JUCE framework
include(FetchContent)
FetchContent_Declare(
    JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        8.0.0
)
FetchContent_MakeAvailable(JUCE)

juce_add_plugin(LiquidSpectra
    COMPANY_NAME "LiquidAudio"
    PLUGIN_MANUFACTURER_CODE Liqd
    PLUGIN_CODE LqSp
    FORMATS VST3 AU Standalone
    PRODUCT_NAME "LiquidSpectra Multi-Track Analyzer"
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
)

target_sources(LiquidSpectra PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginProcessor.h
    Source/PluginEditor.cpp
    Source/PluginEditor.h
    Source/SkiaVectorRenderer.cpp
    Source/SkiaVectorRenderer.h
    Source/MultiInstanceBus.h
    Source/SpectralAnalyzerDSP.h
    Source/CollisionDetector.h
    Source/LoudnessMeterEBU.h
)

target_compile_definitions(LiquidSpectra PRIVATE
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
)

target_link_libraries(LiquidSpectra PRIVATE
    juce::juce_audio_utils
    juce::juce_dsp
    juce::juce_gui_basics
    juce::juce_gui_extra
    juce::juce_opengl
)

# Automated DSP Test Suite Executable
enable_testing()
add_executable(DSPUnitTests
    Tests/DSPUnitTests.cpp
    Source/SpectralAnalyzerDSP.h
    Source/CollisionDetector.h
    Source/LoudnessMeterEBU.h
    Source/MultiInstanceBus.h
)
target_link_libraries(DSPUnitTests PRIVATE juce::juce_dsp)
add_test(NAME AllDSPUnitTests COMMAND DSPUnitTests)
