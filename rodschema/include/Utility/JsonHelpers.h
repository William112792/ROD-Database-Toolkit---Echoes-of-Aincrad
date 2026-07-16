#pragma once
#include "nlohmann/json_fwd.hpp"
#include <filesystem>
#include <functional>

namespace PS::JsonHelpers {
    // Parses every *.json file directly under `path` (non-recursive,
    // matching PalSchema's own convention: mods/<Mod>/weapons/*.json,
    // not mods/<Mod>/weapons/**/*.json) and invokes callback per file.
    // A malformed file logs an error and is skipped -- it does not abort
    // loading the rest of the mod's files.
    void ParseJsonFilesInPath(const std::filesystem::path& path, const std::function<void(const nlohmann::json&)>& callback);

    // Single-file version, used for hot-reload in a future version.
    void ParseJsonFileInPath(const std::filesystem::path& path, const std::function<void(const nlohmann::json&)>& callback);
}
