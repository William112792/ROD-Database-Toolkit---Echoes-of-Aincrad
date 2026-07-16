#include "Utility/Config.h"

namespace ROD::RODConfig {
    static std::filesystem::path g_schemaRoot;

    void SetSchemaRootPath(const std::filesystem::path& dllDirectory)
    {
        // dllDirectory is .../Mods/RODSchema/dlls -- the schema root
        // (where mods/ and enabled.txt live) is one level up.
        g_schemaRoot = dllDirectory.parent_path();
    }

    std::filesystem::path GetModsRootPath()
    {
        return g_schemaRoot / "mods";
    }
}
