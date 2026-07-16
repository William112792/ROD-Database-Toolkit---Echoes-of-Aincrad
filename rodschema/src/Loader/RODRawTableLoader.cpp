#include "Unreal/CoreUObject/UObject/Class.hpp"
#include "Unreal/UObjectGlobals.hpp"
#include "Unreal/CoreUObject/UObject/UnrealType.hpp"
#include "Unreal/NameTypes.hpp"
#include "Unreal/Engine/UDataTable.hpp"
#include "SDK/Structs/FManagedStruct.h"
#include "Utility/PropertyHelper.h"
#include "Utility/Logging.h"
#include "Utility/JsonHelpers.h"
#include "Loader/RODRawTableLoader.h"

using namespace RC;
using namespace RC::Unreal;

namespace ROD {
    RODRawTableLoader::RODRawTableLoader() : RODModLoaderBase("raw") {
        SetDisplayName(STR("Raw Table Loader"));
    }

    RODRawTableLoader::~RODRawTableLoader() {}

    void RODRawTableLoader::Apply(const RC::StringType& tableName, UDataTable* datatable)
    {
        auto it = m_tableDataMap.find(tableName);
        if (it != m_tableDataMap.end())
        {
            LoadResult result{};

            for (auto& data : it->second)
            {
                Apply(data, datatable, result);
            }

            PS::Log<LogLevel::Normal>(STR("[RODSchema] {}: {} rows updated, {} rows added, {} rows deleted, {} error{}.\n"),
                datatable->GetName(), result.SuccessfulModifications, result.SuccessfulAdditions,
                result.SuccessfulDeletions, result.ErrorCount, result.ErrorCount != 1 ? STR("s") : STR(""));
        }
    }

    void RODRawTableLoader::Apply(const nlohmann::json& data, UDataTable* datatable, LoadResult& outResult)
    {
        for (auto& [dataKey, dataRow] : data.items())
        {
            if (dataKey == "Rows")
            {
                outResult.ErrorCount++;
                PS::Log<LogLevel::Error>(STR("[RODSchema] When copying entries from FModel, don't include the 'Rows' field -- add row entries directly instead.\n"));
                continue;
            }

            auto rowKeyName = FName(RC::to_generic_string(dataKey), FNAME_Add);
            if (dataRow.is_null())
            {
                DeleteRow(datatable, rowKeyName, outResult);
                continue;
            }

            auto row = datatable->FindRowUnchecked(rowKeyName);
            if (!row)
            {
                AddRow(datatable, rowKeyName, dataRow, outResult);
                continue;
            }

            EditRow(datatable, rowKeyName, row, dataRow, outResult);
        }
    }

    void RODRawTableLoader::OnLoad(const std::filesystem::path& loaderPath, const RC::StringType& modName, const EEngineLifecyclePhase& engineLifecyclePhase)
    {
        // Table data gets collected regardless of phase -- it's just JSON
        // sitting in a map until a real UDataTable with a matching name
        // actually serializes (see OnDatatableSerialized). No UE calls
        // happen here, so there's no phase restriction needed, unlike
        // RODWeaponModLoader (which needs a live object to exist first).
        PS::JsonHelpers::ParseJsonFilesInPath(loaderPath, [&](const nlohmann::json& data) {
            for (auto& [Key, Value] : data.items())
            {
                AddToTableDataMap(Key, Value);
            }
        });
    }

    void RODRawTableLoader::OnAutoReload(const RC::StringType& modName, const std::filesystem::path& modFilePath)
    {
        PS::JsonHelpers::ParseJsonFileInPath(modFilePath, [&](const nlohmann::json& data) {
            for (auto& [key, value] : data.items())
            {
                auto datatable = GetDatatableByName(key);
                if (!datatable)
                {
                    PS::Log<LogLevel::Error>(STR("[RODSchema] Failed to auto-reload {}, data table {} doesn't exist (yet?).\n"), modName, RC::to_generic_string(key));
                    return;
                }

                auto name = datatable->GetName();
                LoadResult result;
                Apply(value, datatable, result);

                PS::Log<LogLevel::Normal>(STR("[RODSchema] {}: {} rows updated, {} rows added, {} rows deleted, {} error{}.\n"),
                    name, result.SuccessfulModifications, result.SuccessfulAdditions,
                    result.SuccessfulDeletions, result.ErrorCount, result.ErrorCount != 1 ? STR("s") : STR(""));
            }
        });
    }

    bool RODRawTableLoader::CanInitialize(const EEngineLifecyclePhase& engineLifecyclePhase)
    {
        // Unlike RODWeaponModLoader, this loader doesn't need to find any
        // specific UObject up front -- its "target" is whatever table shows
        // up via the Serialize hook, whenever that happens to be. So it's
        // safe (and correct) to consider it initialized as soon as the
        // engine itself is up, matching PalRawTableLoader's own choice of
        // PostEngineInit rather than waiting for GameInstanceInit.
        return engineLifecyclePhase == EEngineLifecyclePhase::PostEngineInit;
    }

    bool RODRawTableLoader::OnInitialize()
    {
        return true;
    }

    void RODRawTableLoader::OnDatatableSerialized(UDataTable* datatable)
    {
        if (!datatable) return;

        Apply(datatable->GetName(), datatable);
    }

    void RODRawTableLoader::AddRow(UDataTable* datatable, const FName& rowName, const nlohmann::json& data, LoadResult& outResult)
    {
        auto rowStruct = datatable->GetRowStruct();
        FManagedStruct newRowData(rowStruct);

        try
        {
            if (ModifyRowProperties(datatable, rowName, newRowData.GetData(), data, outResult))
            {
                datatable->AddRow(rowName, *reinterpret_cast<FTableRowBase*>(newRowData.GetData()));
                outResult.SuccessfulAdditions++;
            }
        }
        catch (const std::exception& e)
        {
            auto tableName = datatable->GetName();
            outResult.ErrorCount++;
            PS::Log<LogLevel::Error>(STR("[RODSchema] Failed to add row '{}' in {}: {}\n"), rowName.ToString(), tableName, RC::to_generic_string(e.what()));
        }
    }

    void RODRawTableLoader::EditRow(UDataTable* datatable, const FName& rowName, uint8_t* row, const nlohmann::json& data, LoadResult& outResult)
    {
        try
        {
            if (ModifyRowProperties(datatable, rowName, row, data, outResult))
            {
                outResult.SuccessfulModifications++;
            }
        }
        catch (const std::exception& e)
        {
            auto tableName = datatable->GetName();
            outResult.ErrorCount++;
            PS::Log<LogLevel::Error>(STR("[RODSchema] Failed to edit row '{}' in {}: {}\n"), rowName.ToString(), tableName, RC::to_generic_string(e.what()));
        }
    }

    void RODRawTableLoader::DeleteRow(UDataTable* datatable, const FName& rowName, LoadResult& outResult)
    {
        datatable->RemoveRow(rowName);
        outResult.SuccessfulDeletions++;
    }

    bool RODRawTableLoader::ModifyRowProperties(UDataTable* datatable, const FName& rowName, void* rowPtr, const nlohmann::json& data, LoadResult& outResult)
    {
        if (!data.is_object())
        {
            throw std::runtime_error(std::format("Value for {} must be an object", RC::to_string(rowName.ToString())));
        }

        auto rowStruct = datatable->GetRowStruct();
        bool wasRowModified = false;
        for (auto& [key, value] : data.items())
        {
            auto keyWide = RC::to_generic_string(key);
            auto property = RODSchema::PropertyHelper::GetPropertyByName(rowStruct, keyWide);
            if (property)
            {
                RODSchema::PropertyHelper::CopyJsonValueToContainer(reinterpret_cast<uint8_t*>(rowPtr), property, value);
                wasRowModified = true;
            }
            else
            {
                outResult.ErrorCount++;
                PS::Log<LogLevel::Warning>(STR("[RODSchema] Property '{}' not found in row '{}' in {}.\n"), keyWide, rowName.ToString(), datatable->GetName());
            }
        }

        return wasRowModified;
    }

    void RODRawTableLoader::AddToTableDataMap(const std::string& datatableName, const nlohmann::json& data)
    {
        auto datatableNameWide = RC::to_generic_string(datatableName);
        auto it = m_tableDataMap.find(datatableNameWide);
        if (it != m_tableDataMap.end())
        {
            it->second.push_back(data);
        }
        else
        {
            m_tableDataMap.emplace(datatableNameWide, std::vector<nlohmann::json>{ data });
        }
    }
}
