#pragma once

#include "Unreal/NameTypes.hpp"
#include "Utility/RODDataTableRegistry.h"
#include "nlohmann/json.hpp"
#include <filesystem>
#include <functional>
#include <mutex>
#include <string>

namespace RC::Unreal {
    class UDataTable;
}

// Ported from PalSchema's PalModLoaderBase. Every concrete loader (weapons,
// raw tables, etc.) derives from this. Compared to the earlier v1-only
// version of this file, this adds: a shared UDataTableRegistry reference (so
// any loader can look up a live UDataTable by name), lifecycle-phase-aware
// Load()/OnLoad(), and an OnDatatableSerialized() hook so a loader can react
// every time ANY table finishes deserializing -- not just once at boot.
namespace ROD {
    enum class EEngineLifecyclePhase {
        PreEngineInit,
        PostEngineInit,
        UE4SSInit,
        GameInstanceInit,
    };

    class RODModLoaderBase {
    public:
        virtual ~RODModLoaderBase();

        void AssignDatatableRegistry(RODDataTableRegistry& datatableRegistry);

        const RC::StringType& GetDisplayName() const;

        // Called once per loader, right after construction, before any UE
        // objects are guaranteed to exist -- do NOT call UE functions here.
        void Setup();

        void AutoReload(const RC::StringType& modName, const std::filesystem::path& modFilePath);

        // Called once per mod folder, per lifecycle phase, walking
        // mods/<ModName>/<modFolderType>/*.json and invoking OnLoad().
        void Load(const std::filesystem::path& modPath, const RC::StringType& modName, const EEngineLifecyclePhase& engineLifecyclePhase);

        // Finds this loader's target UObject(s) via OnInitialize(), once
        // it's safe to do so for the given phase (see CanInitialize).
        void Initialize(const EEngineLifecyclePhase& engineLifecyclePhase);

        const bool& HasInitialized() const;

        const std::string& GetModFolderType();

    protected:
        explicit RODModLoaderBase(const std::string& modFolderName);

        void SetDisplayName(const RC::StringType& displayName);

        void IterateModsFolder(const std::function<void(const std::filesystem::path&, const RC::StringType&)>& callback);

        // Does not throw if the data table isn't found, returns nullptr
        RC::Unreal::UDataTable* TryGetDatatableByName(const std::string& name);

        // Throws a std::runtime_error if the data table isn't found
        RC::Unreal::UDataTable* GetDatatableByName(const std::string& name);

    protected:
        // Called once, at construction time (from Setup()). No UE calls here.
        virtual void OnSetup();

        virtual void OnLoad(const std::filesystem::path& loaderPath, const RC::StringType& modName, const EEngineLifecyclePhase& engineLifecyclePhase) = 0;

        virtual void OnAutoReload(const RC::StringType& modName, const std::filesystem::path& modFilePath);

        virtual bool CanInitialize(const EEngineLifecyclePhase& engineLifecyclePhase) = 0;

        // Return true iff the target UObject(s) were found successfully.
        virtual bool OnInitialize() = 0;

        // Runs after OnInitialize() succeeds and mods have been loaded once.
        virtual void PostInitialize();

        // Fires every time ANY UDataTable finishes deserializing, for as
        // long as the RawTableLoader's hook is installed. Base impl is a
        // no-op; only loaders that care about live table reloads (i.e.
        // RODRawTableLoader itself) override this.
        virtual void OnDatatableSerialized(RC::Unreal::UDataTable* datatable);

    private:
        std::string m_modFolderType;
        RC::StringType m_displayName = STR("Unknown Loader");
        RODDataTableRegistry* m_datatableRegistry = nullptr;
        bool m_hasInitialized = false;
        std::mutex m_mutex;

        DatatableSerializeCallbackId m_datatableSerializeCallbackId{};
    };
}
