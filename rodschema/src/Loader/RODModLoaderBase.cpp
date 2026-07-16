#include "Loader/RODModLoaderBase.h"
#include "Utility/Logging.h"
#include "Utility/Config.h"
#include "Utility/JsonHelpers.h"
#include <stdexcept>

namespace ROD {
    RODModLoaderBase::RODModLoaderBase(const std::string& modFolderName)
        : m_modFolderType(modFolderName)
    {
    }

    RODModLoaderBase::~RODModLoaderBase() = default;

    void RODModLoaderBase::AssignDatatableRegistry(RODDataTableRegistry& datatableRegistry)
    {
        m_datatableRegistry = &datatableRegistry;
    }

    const RC::StringType& RODModLoaderBase::GetDisplayName() const
    {
        return m_displayName;
    }

    void RODModLoaderBase::SetDisplayName(const RC::StringType& displayName)
    {
        m_displayName = displayName;
    }

    const std::string& RODModLoaderBase::GetModFolderType()
    {
        return m_modFolderType;
    }

    const bool& RODModLoaderBase::HasInitialized() const
    {
        return m_hasInitialized;
    }

    void RODModLoaderBase::Setup()
    {
        if (m_datatableRegistry)
        {
            m_datatableSerializeCallbackId = m_datatableRegistry->RegisterDatatableSerializeCallback(
                [this](RC::Unreal::UDataTable* datatable) {
                    OnDatatableSerialized(datatable);
                });
        }

        OnSetup();
    }

    void RODModLoaderBase::OnSetup() {}

    void RODModLoaderBase::PostInitialize() {}

    void RODModLoaderBase::OnDatatableSerialized(RC::Unreal::UDataTable*) {}

    void RODModLoaderBase::OnAutoReload(const RC::StringType&, const std::filesystem::path&) {}

    RC::Unreal::UDataTable* RODModLoaderBase::TryGetDatatableByName(const std::string& name)
    {
        if (!m_datatableRegistry) return nullptr;
        return m_datatableRegistry->GetDatatableByName(name);
    }

    RC::Unreal::UDataTable* RODModLoaderBase::GetDatatableByName(const std::string& name)
    {
        auto table = TryGetDatatableByName(name);
        if (!table)
        {
            throw std::runtime_error("Data table '" + name + "' was not found. It may not have loaded yet, or the name may be wrong.");
        }
        return table;
    }

    void RODModLoaderBase::IterateModsFolder(const std::function<void(const std::filesystem::path&, const RC::StringType&)>& callback)
    {
        auto modsRoot = RODConfig::GetModsRootPath();
        if (!std::filesystem::exists(modsRoot))
        {
            PS::Log<RC::LogLevel::Warning>(STR("[RODSchema] mods/ folder not found at {}\n"), modsRoot.wstring());
            return;
        }

        for (const auto& modDir : std::filesystem::directory_iterator(modsRoot))
        {
            if (!modDir.is_directory()) continue;

            auto modName = modDir.path().filename().wstring();
            auto categoryPath = modDir.path() / m_modFolderType;
            if (!std::filesystem::exists(categoryPath)) continue;

            callback(categoryPath, modName);
        }
    }

    void RODModLoaderBase::Load(const std::filesystem::path& modPath, const RC::StringType& modName, const EEngineLifecyclePhase& engineLifecyclePhase)
    {
        auto categoryPath = modPath / m_modFolderType;
        if (!std::filesystem::exists(categoryPath)) return;

        OnLoad(categoryPath, modName, engineLifecyclePhase);
    }

    void RODModLoaderBase::AutoReload(const RC::StringType& modName, const std::filesystem::path& modFilePath)
    {
        OnAutoReload(modName, modFilePath);
    }

    void RODModLoaderBase::Initialize(const EEngineLifecyclePhase& engineLifecyclePhase)
    {
        std::lock_guard<std::mutex> lock(m_mutex);

        if (m_hasInitialized || !CanInitialize(engineLifecyclePhase))
        {
            return;
        }

        if (!OnInitialize())
        {
            PS::Log<RC::LogLevel::Error>(STR("[RODSchema] {} failed to initialize, mods in this category will not be loaded.\n"), GetDisplayName());
            return;
        }

        m_hasInitialized = true;

        PostInitialize();
    }
}
