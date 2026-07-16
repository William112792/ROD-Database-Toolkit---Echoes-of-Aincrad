#pragma once

#include "Unreal/NameTypes.hpp"
#include "Loader/RODModLoaderBase.h"
#include "nlohmann/json.hpp"

namespace RC::Unreal {
    class UDataTable;
}

// Ported from PalSchema's PalRawTableLoader. This is the generic
// "edit/add/delete rows in ANY UDataTable by name" loader -- it doesn't
// know or care in advance which tables exist; it reacts to the
// UDataTable::Serialize hook (installed by RODMainLoader) firing for
// whichever table happens to load, and applies whatever JSON a mod
// registered for that table's name.
//
// Mod JSON format (mods/<Mod>/raw/*.json), matches PalSchema's own:
//   {
//     "DT_ShopItemList": {
//       "SomeRowName": { "SomeField": 123 },
//       "AnotherRowName": null,          <- null deletes the row
//       "BrandNewRowName": { ... }        <- row that doesn't exist yet gets ADDED
//     }
//   }
namespace ROD {
    class RODRawTableLoader : public RODModLoaderBase {
        struct LoadResult {
            int SuccessfulModifications = 0;
            int SuccessfulAdditions = 0;
            int SuccessfulDeletions = 0;
            int ErrorCount = 0;
        };
    public:
        RODRawTableLoader();
        ~RODRawTableLoader() override;

        void Apply(const RC::StringType& datatableName, RC::Unreal::UDataTable* datatable);
        void Apply(const nlohmann::json& data, RC::Unreal::UDataTable* table, LoadResult& outResult);

    protected:
        void OnLoad(const std::filesystem::path& loaderPath, const RC::StringType& modName, const EEngineLifecyclePhase& engineLifecyclePhase) override;
        void OnAutoReload(const RC::StringType& modName, const std::filesystem::path& modFilePath) override;

        bool CanInitialize(const EEngineLifecyclePhase& engineLifecyclePhase) override;
        bool OnInitialize() override;
        void OnDatatableSerialized(RC::Unreal::UDataTable* datatable) override;

    private:
        std::unordered_map<RC::StringType, std::vector<nlohmann::json>> m_tableDataMap;

        void AddRow(RC::Unreal::UDataTable* datatable, const RC::Unreal::FName& rowName, const nlohmann::json& data, LoadResult& outResult);
        void EditRow(RC::Unreal::UDataTable* datatable, const RC::Unreal::FName& rowName, uint8_t* row, const nlohmann::json& data, LoadResult& outResult);
        void DeleteRow(RC::Unreal::UDataTable* datatable, const RC::Unreal::FName& rowName, LoadResult& outResult);

        bool ModifyRowProperties(RC::Unreal::UDataTable* datatable, const RC::Unreal::FName& rowName, void* rowPtr, const nlohmann::json& data, LoadResult& outResult);

        void AddToTableDataMap(const std::string& datatableName, const nlohmann::json& data);
    };
}
