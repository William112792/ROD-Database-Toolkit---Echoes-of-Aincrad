#pragma once
#include <filesystem>

namespace ROD::RODConfig {
    // <Game>/Binaries/Win64/ue4ss/Mods/RODSchema/mods
    // Resolved relative to this DLL's own location at load time (set once
    // from dllmain.cpp via DllMain's HMODULE), same approach PalSchema uses
    // so RODSchema works regardless of where UE4SS's Mods folder actually is.
    std::filesystem::path GetModsRootPath();
    void SetSchemaRootPath(const std::filesystem::path& dllDirectory);
}
