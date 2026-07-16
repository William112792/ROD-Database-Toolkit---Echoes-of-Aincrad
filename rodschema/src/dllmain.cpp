#include "Mod/CppUserModBase.hpp"
#include "UE4SSProgram.hpp"
#include "Loader/RODMainLoader.h"
#include "SDK/RODSignatures.h"
#include "Utility/Config.h"
#include "Utility/Logging.h"
#include "../version.h"
#include <format>

using namespace RC;
using namespace RC::Unreal;

// Bootstrap sequence, matching PalSchema's dllmain.cpp exactly:
//   1. (constructor) SignatureManager::Initialize() -- scans the whole
//      exe for every known signature, ONCE, as early as possible.
//   2. (constructor) MainLoader.PreInitialize() -- installs the
//      UDataTable::Serialize hook (if step 1 found it) and the optional
//      pak-folder hook.
//   3. (on_unreal_init) MainLoader.Initialize() -- sets up auto-reload
//      (currently a no-op stub, see RODMainLoader's TODO).
//   4. (lazy, automatic) The FIRST UDataTable that actually serializes
//      after step 2's hook is installed triggers RODMainLoader::InitCore()
//      internally -- this is what actually runs PostEngineInit-phase
//      loader init/load, and installs the GameInstanceInit hook. No
//      explicit call for this step; it happens as a side effect of the
//      Serialize hook firing for real, the same bootstrapping trick
//      PalSchema itself uses to avoid needing a separate "is the engine
//      far enough along yet" signal.
class RODSchema : public RC::CppUserModBase
{
public:
    RODSchema() : CppUserModBase()
    {
        auto Version = std::format(STR("{}.{}.{}"), VERSION_MAJOR, VERSION_MINOR, VERSION_REVISION);

        ModName = STR("RODSchema");
        ModVersion = Version;
        ModDescription = STR("Allows modifying Echoes of Aincrad's data (items, weapons, and generically any DataTable) dynamically via JSON.");
        ModAuthors = STR("You");

        // NOTE: PalSchema gates startup on a MemberVariableLayout.ini file
        // shipped by a Palworld-specific UE4SS fork (for a further
        // optimization -- direct member-variable offsets instead of full
        // FProperty reflection). RODSchema doesn't have an EOA-specific
        // UE4SS fork or that file, and doesn't need one: everything here
        // goes through generic FProperty reflection instead. No equivalent
        // gate needed (or possible) at this stage.

        auto dllDir = std::filesystem::path(UE4SSProgram::get_program().get_working_directory())
            / "Mods" / "RODSchema" / "dlls";
        ROD::RODConfig::SetSchemaRootPath(dllDir);

        PS::Log<LogLevel::Verbose>(STR("[RODSchema] Initializing SignatureManager...\n"));
        ROD::SignatureManager::Initialize();

        PS::Log<LogLevel::Verbose>(STR("[RODSchema] Pre-initializing (installing hooks)...\n"));
        MainLoader.PreInitialize();

        PS::Log<LogLevel::Normal>(STR("[RODSchema] {} v{} by {} loaded.\n"), ModName, ModVersion, ModAuthors);
    }

    ~RODSchema() override = default;

    auto on_update() -> void override {}
    auto on_program_start() -> void override {}

    auto on_unreal_init() -> void override
    {
        MainLoader.Initialize();
    }

private:
    ROD::RODMainLoader MainLoader;
};

#define RODSCHEMA_API __declspec(dllexport)
extern "C"
{
    RODSCHEMA_API RC::CppUserModBase* start_mod()
    {
        return new RODSchema();
    }

    RODSCHEMA_API void uninstall_mod(RC::CppUserModBase* mod)
    {
        delete mod;
    }
}
