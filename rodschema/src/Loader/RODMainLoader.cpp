#include "Unreal/UObjectGlobals.hpp"
#include "Unreal/Engine/UDataTable.hpp"
#include "Loader/RODMainLoader.h"
#include "Loader/RODWeaponModLoader.h"
#include "Loader/RODRawTableLoader.h"
#include "SDK/RODSignatures.h"
#include "Utility/Config.h"
#include "Utility/Logging.h"
#include "UE4SSProgram.hpp"

using namespace RC;
using namespace RC::Unreal;

namespace fs = std::filesystem;

namespace ROD {
    RODMainLoader::RODMainLoader()
    {
        s_instance = this;
        CreateLoaders();
    }

    RODMainLoader::~RODMainLoader()
    {
        DatatableSerialize_Hook = {};
        GameInstanceInit_Hook = {};
        GetPakFolders_Hook = {};
        DatatableSerializeCallbacks.clear();
        GameInstanceInitCallbacks.clear();

        if (s_instance == this) s_instance = nullptr;
    }

    void RODMainLoader::CreateLoaders()
    {
        // Order matters only in that RawTableLoader should exist before
        // anything that might depend on tables it's tracking -- in
        // practice each loader is independent so this is mostly cosmetic
        // for now. Add new loaders here as they're built.
        RegisterLoader(std::make_unique<RODWeaponModLoader>());
        RegisterLoader(std::make_unique<RODRawTableLoader>());
    }

    void RODMainLoader::RegisterLoader(std::unique_ptr<RODModLoaderBase> newLoader)
    {
        newLoader->AssignDatatableRegistry(m_datatableRegistry);
        newLoader->Setup();
        m_loaders.push_back(std::move(newLoader));
    }

    void RODMainLoader::PreInitialize()
    {
        HookDatatableSerialize();
        SetupAlternativePakPathReader();
    }

    void RODMainLoader::Initialize()
    {
        SetupAutoReload();
    }

    void RODMainLoader::HookDatatableSerialize()
    {
        auto DatatableSerializeFuncPtr = SignatureManager::GetSignature("UDataTable::Serialize");
        if (!DatatableSerializeFuncPtr)
        {
            // EXPECTED to fail until a real EOA signature is found -- see
            // RODSignatures.h. RawTableLoader simply won't receive any
            // OnDatatableSerialized callbacks until this is fixed; nothing
            // crashes, the mod just silently can't touch arbitrary tables
            // (RODWeaponModLoader's direct-object-patching path is
            // unaffected, since it doesn't depend on this hook at all).
            PS::Log<LogLevel::Error>(STR("[RODSchema] Unable to hook UDataTable::Serialize -- signature not found/outdated. Generic DataTable editing (RODRawTableLoader) will not function until this is fixed. See RODSchema_RE_Guide.md.\n"));
            return;
        }

        DatatableSerialize_Hook = safetyhook::create_inline(reinterpret_cast<void*>(DatatableSerializeFuncPtr),
            reinterpret_cast<void*>(OnDataTableSerialized));

        DatatableSerializeCallbacks.push_back([](UDataTable* datatable) {
            if (s_instance) s_instance->m_datatableRegistry.Add(datatable);
        });

        PS::Log<LogLevel::Normal>(STR("[RODSchema] UDataTable::Serialize hooked successfully.\n"));
    }

    void RODMainLoader::HookGameInstanceInit()
    {
        // CLASS PATH CONFIRMED from the game's own export (not a guess
        // anymore): BP_RODGameInstance.json's BlueprintGeneratedClass has
        // SuperStruct = Class'RODGameInstance' at /Script/ROD, so
        // "/Script/ROD.RODGameInstance" is exactly right. (The game runs
        // a BP subclass, BP_RODGameInstance_C, whose instances are still
        // instances of the native class -- StaticFindObject on the native
        // class is correct.) STILL TODO (blocking): the vtable index for
        // its Init() override, found the same way PalSchema found index 90
        // for PalGameInstance: dump the class's vtable and identify which
        // slot corresponds to the Init override via a debugger, the same
        // methodology as RODSchema_RE_Guide.md but applied to a vtable
        // rather than a plain function signature.
        auto RODGameInstanceClass = UObjectGlobals::StaticFindObject<UClass*>(nullptr, nullptr, STR("/Script/ROD.RODGameInstance"));
        if (!RODGameInstanceClass)
        {
            PS::Log<LogLevel::Error>(STR("[RODSchema] Failed to find RODGameInstance (class name not yet confirmed for EOA). Cannot hook GameInstance Init -- GameInstanceInit-phase loaders (e.g. RODWeaponModLoader) will not run until this is fixed.\n"));
            return;
        }

        PS::Log<LogLevel::Warning>(STR("[RODSchema] Found a RODGameInstance class, but the vtable index for its Init() override is NOT YET CONFIRMED -- hardcoding index 90 (Palworld's own value) as a starting guess only. This is very likely wrong for EOA and needs independent verification.\n"));

        uintptr_t** VTablePtr = *reinterpret_cast<uintptr_t***>(RODGameInstanceClass->GetClassDefaultObject().Get());
        void* GameInstanceInitPtr = reinterpret_cast<void*>(VTablePtr[90]);

        GameInstanceInitCallbacks.push_back([](UObject* Instance) {
            if (s_instance) s_instance->SetupGameInstanceInitLoadersInternal();
        });

        GameInstanceInit_Hook = safetyhook::create_inline(GameInstanceInitPtr,
            reinterpret_cast<void*>(OnGameInstanceInit));
    }

    void RODMainLoader::SetupAlternativePakPathReader()
    {
        auto GetPakFoldersAddress = SignatureManager::GetSignature("FPakPlatformFile::GetPakFolders");
        if (!GetPakFoldersAddress)
        {
            // Optional feature -- not blocking. JSON-only mods work fine
            // without this; it only enables shipping .pak-based mods
            // alongside RODSchema's JSON ones.
            PS::Log<LogLevel::Warning>(STR("[RODSchema] Unable to set up additional .pak read directory -- signature for FPakPlatformFile::GetPakFolders not found/outdated. This only affects .pak-based mods, not JSON mods.\n"));
            return;
        }

        GetPakFolders_Hook = safetyhook::create_inline(reinterpret_cast<void*>(GetPakFoldersAddress),
            reinterpret_cast<void*>(GetPakFolders));
    }

    void RODMainLoader::SetupAutoReload()
    {
        // TODO: port PalSchema's efsw-based FileWatchWrapper + AutoReload
        // plumbing once the above signatures are confirmed and the basic
        // hook path is verified working end-to-end -- deliberately
        // deferred so we don't add file-watching complexity on top of an
        // still-unverified hook chain.
    }

    void RODMainLoader::InitCore()
    {
        if (m_hasInit) return;
        m_hasInit = true;

        InitializeMods(EEngineLifecyclePhase::PostEngineInit);
        LoadMods(EEngineLifecyclePhase::PostEngineInit);

        HookGameInstanceInit();

        PS::Log<LogLevel::Verbose>(STR("[RODSchema] Core initialized.\n"));
    }

    void RODMainLoader::SetupGameInstanceInitLoadersInternal()
    {
        InitializeMods(EEngineLifecyclePhase::GameInstanceInit);
        LoadMods(EEngineLifecyclePhase::GameInstanceInit);
    }

    void RODMainLoader::InitializeMods(EEngineLifecyclePhase engineLifecyclePhase)
    {
        for (auto& loader : m_loaders)
        {
            loader->Initialize(engineLifecyclePhase);
        }
    }

    void RODMainLoader::LoadMods(EEngineLifecyclePhase engineLifecyclePhase)
    {
        IterateModsFolder([&](const fs::path& modPath, const RC::StringType& modName) {
            try
            {
                for (auto& loader : m_loaders)
                {
                    loader->Load(modPath, modName, engineLifecyclePhase);
                }
            }
            catch (const std::exception& e)
            {
                PS::Log<LogLevel::Error>(STR("[RODSchema] Failed to load mod {}: {}\n"), modName, RC::to_generic_string(e.what()));
            }
        });
    }

    void RODMainLoader::IterateModsFolder(const std::function<void(const std::filesystem::path&, const RC::StringType&)>& callback)
    {
        auto modsPath = GetModsPath();
        if (!fs::exists(modsPath)) return;

        for (const auto& entry : fs::directory_iterator(modsPath))
        {
            if (entry.is_directory())
            {
                callback(entry.path(), entry.path().filename().native());
            }
        }
    }

    std::filesystem::path RODMainLoader::GetModsPath()
    {
        return fs::path(UE4SSProgram::get_program().get_working_directory()) / "Mods" / "RODSchema" / "mods";
    }

    void RODMainLoader::AutoReload(const std::filesystem::path& filePath)
    {
        // Deferred along with SetupAutoReload() -- see TODO there.
        (void)filePath;
    }

    void RODMainLoader::OnDataTableSerialized(UDataTable* This, FArchive* Archive)
    {
        DatatableSerialize_Hook.call<void>(This, Archive);

        if (s_instance) s_instance->InitCore();

        for (auto& Callback : DatatableSerializeCallbacks)
        {
            Callback(This);
        }
    }

    void RODMainLoader::OnGameInstanceInit(UObject* This)
    {
        GameInstanceInit_Hook.call<void>(This);

        for (auto& Callback : GameInstanceInitCallbacks)
        {
            Callback(This);
        }
    }

    void RODMainLoader::GetPakFolders(const TCHAR* CmdLine, TArray<FString>* OutPakFolders)
    {
        GetPakFolders_Hook.call<void>(CmdLine, OutPakFolders);

        if (!s_instance) return;

        auto modsFolderPath = s_instance->GetModsPath();
        auto pathWithSuffix = std::format(STR("{}/"), RC::to_generic_string(modsFolderPath.native()));

        OutPakFolders->Add(FString(pathWithSuffix.c_str()));
    }
}
