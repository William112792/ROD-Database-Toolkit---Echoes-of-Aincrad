#include "Utility/JsonHelpers.h"
#include "Utility/Logging.h"
#include <nlohmann/json.hpp>
#include <fstream>

namespace PS::JsonHelpers {

    void ParseJsonFileInPath(const std::filesystem::path& path, const std::function<void(const nlohmann::json&)>& callback)
    {
        std::ifstream file(path);
        if (!file.is_open())
        {
            PS::Log<RC::LogLevel::Error>(STR("[RODSchema] Could not open '{}'\n"), path.wstring());
            return;
        }

        try
        {
            nlohmann::json data = nlohmann::json::parse(file, nullptr, /*allow_exceptions=*/true, /*ignore_comments=*/true);
            callback(data);
        }
        catch (const nlohmann::json::parse_error& e)
        {
            PS::Log<RC::LogLevel::Error>(STR("[RODSchema] Invalid JSON in '{}': {}\n"), path.wstring(), RC::to_generic_string(e.what()));
        }
    }

    void ParseJsonFilesInPath(const std::filesystem::path& path, const std::function<void(const nlohmann::json&)>& callback)
    {
        if (!std::filesystem::exists(path)) return;

        for (const auto& entry : std::filesystem::directory_iterator(path))
        {
            if (!entry.is_regular_file()) continue;
            if (entry.path().extension() != ".json") continue;

            ParseJsonFileInPath(entry.path(), callback);
        }
    }
}
