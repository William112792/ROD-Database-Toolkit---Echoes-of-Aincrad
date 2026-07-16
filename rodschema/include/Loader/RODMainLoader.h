#pragma once

#include "Loader/RODModLoaderBase.h"
#include "Utility/RODDataTableRegistry.h"
#include "safetyhook.hpp"
#include <filesystem>
#include <memory>
#include <vector>

namespace RC::Unreal {
    class UDataTable;
    class FArchive;
    class UObject;
}

// Ported from PalSchema's PalMainLoader. This is the real orchestrator:
// installs the UDataTable::Serialize hook (so RODRawTableLoader can react
// to ANY table, generically), owns every registered loader, and drives
// their Initialize()/Load() calls at the right lifecycle phases.
//
// STATUS: architecture is fully ported. What's NOT yet functional:
//   - "UDataTable::Serialize" has no confirmed EOA signature yet (see
//     RODSignatures.h) -- HookDatatableSerialize() will log an error and
//     no-op until that's found. This is the literal blocker for
//     RODRawTableLoader doing anything at all.
//   - HookGameInstanceInit() needs EOA's actual GameInstance class name
//     (Palworld's own was "/Script/Pal.PalGameInstance" at a hardcoded
//     vtable index 90 -- neither the class name nor the vtable index
//     transfers to EOA). Currently a placeholder that logs and returns.
//   - "FPakPlatformFile::GetPakFolders" (lets mods ship .pak files inside
//     RODSchema/mods/, read automatically) also has no confirmed EOA
//     signature yet. Optional feature -- JSON mods work without it.
namespace ROD {
    class RODMainLoader {
    public:
        RODMainLoader();
        ~RODMainLoader();

        // Call from on_program_start or similar, as early as possible --
        // installs the UDataTable::Serialize hook so no table load is
        // missed, even ones that happen before GameInstanceInit.
        void PreInitialize();

        void Initialize();

        void AutoReload(const std::filesystem::path& filePath);

    private:
        void CreateLoaders();
        void RegisterLoader(std::unique_ptr<RODModLoaderBase> newLoader);

        void HookDatatableSerialize();
        void HookGameInstanceInit();
        void SetupAlternativePakPathReader();
        void SetupAutoReload();

        void InitCore();
        void SetupGameInstanceInitLoadersInternal();
        void InitializeMods(EEngineLifecyclePhase engineLifecyclePhase);
        void LoadMods(EEngineLifecyclePhase engineLifecyclePhase);

        void IterateModsFolder(const std::function<void(const std::filesystem::path&, const RC::StringType&)>& callback);
        std::filesystem::path GetModsPath();

        static void OnDataTableSerialized(RC::Unreal::UDataTable* This, RC::Unreal::FArchive* Archive);
        static void OnGameInstanceInit(RC::Unreal::UObject* This);
        static void GetPakFolders(const RC::Unreal::TCHAR* CmdLine, RC::Unreal::TArray<RC::Unreal::FString>* OutPakFolders);

        std::vector<std::unique_ptr<RODModLoaderBase>> m_loaders;
        RODDataTableRegistry m_datatableRegistry;
        bool m_hasInit = false;

        static inline safetyhook::InlineHook DatatableSerialize_Hook{};
        static inline safetyhook::InlineHook GameInstanceInit_Hook{};
        static inline safetyhook::InlineHook GetPakFolders_Hook{};

        static inline std::vector<std::function<void(RC::Unreal::UDataTable*)>> DatatableSerializeCallbacks{};
        static inline std::vector<std::function<void(RC::Unreal::UObject*)>> GameInstanceInitCallbacks{};

        // Points back at the single live instance so the static hook
        // trampolines (which C-style function pointers require) can reach
        // real member state (m_loaders, m_datatableRegistry, etc).
        static inline RODMainLoader* s_instance = nullptr;
    };
}
