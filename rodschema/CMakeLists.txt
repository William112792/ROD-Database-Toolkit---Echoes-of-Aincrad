cmake_minimum_required(VERSION 3.22)

set(CMAKE_CXX_STANDARD 23)

# Same deps/ submodule layout as PalSchema:
#   deps/json          (nlohmann/json)
#   deps/safetyhook     (only needed once v2 adds a function hook)
#   deps/glaze
#   deps/RE-UE4SS       (UE4SS itself, provides the CppUserModBase SDK)
#   deps/efsw
# `git submodule update --init --recursive` before configuring.
add_subdirectory(deps)

set(TARGET RODSchema)
project(${TARGET})

file(GLOB_RECURSE SRC_FILES CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/src/dllmain.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/Loader/*.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/Utility/*.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/SDK/*.cpp"
)

add_library(${TARGET} SHARED ${SRC_FILES})
target_include_directories(${TARGET} PRIVATE
    include/
)
target_link_libraries(${TARGET} PRIVATE nlohmann_json::nlohmann_json UE4SS safetyhook)

# glaze/efsw (PalSchema's schema-generator UI and hot-reload file watcher)
# still not used -- SetupAutoReload() in RODMainLoader is currently a
# deferred TODO stub, so nothing links against them yet.
