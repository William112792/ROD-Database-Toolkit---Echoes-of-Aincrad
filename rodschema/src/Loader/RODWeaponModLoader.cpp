#include "Loader/RODWeaponModLoader.h"
#include "Unreal/UObjectGlobals.hpp"
#include "Unreal/CoreUObject/UObject/UnrealType.hpp"
#include "Unreal/CoreUObject/UObject/Class.hpp"
#include "Utility/PropertyHelper.h"
#include "Utility/JsonHelpers.h"
#include "Utility/Logging.h"
#include <nlohmann/json.hpp>
#include <format>

using namespace RC;
using namespace RC::Unreal;

namespace ROD {

    // -----------------------------------------------------------------
    // RE-UE4SS does NOT ship Epic's FScriptMapHelper, and its
    // FMapProperty exposes key/value sub-properties through ACCESSOR
    // FUNCTIONS (GetKeyProp()/GetValueProp()/GetMapLayout()), not the
    // public fields Epic's runtime has. (The first build attempt used
    // the Epic-style API and failed with C2065 'FScriptMapHelper' /
    // C2039 'ValueProp' -- see build_log_2026-07-11. The claim in the
    // old comment that "RE-UE4SS mirrors Epic's reflection API 1:1"
    // was wrong; this wrapper is the corrected, checked-against-
    // headers equivalent.)
    //
    // Pair memory layout per RC's own Map.hpp: the KEY sits at offset
    // 0 of each pair ("KeyOffset ... is always at zero offset from the
    // TPair - not stored here") and the VALUE at Layout.ValueOffset.
    // Iteration must run to GetMaxIndex() (sparse storage keeps holes;
    // IsValidIndex() skips them) -- Num() alone under-iterates after
    // any removal.
    // -----------------------------------------------------------------
    struct RODMapView
    {
        FScriptMap* Map{};
        FScriptMapLayout Layout{};
        FProperty* KeyProp{};
        FProperty* ValueProp{};

        RODMapView(FMapProperty* mapProp, void* container)
            : Map(reinterpret_cast<FScriptMap*>(mapProp->ContainerPtrToValuePtr<void>(container)))
            , Layout(mapProp->GetMapLayout())
            , KeyProp(mapProp->GetKeyProp())
            , ValueProp(mapProp->GetValueProp())
        {
        }

        int32_t GetMaxIndex() const { return Map->GetMaxIndex(); }
        bool IsValidIndex(int32_t i) const { return Map->IsValidIndex(i); }
        void* GetKeyPtr(int32_t i) { return Map->GetData(i, Layout); }
        void* GetValuePtr(int32_t i) { return static_cast<uint8_t*>(Map->GetData(i, Layout)) + Layout.ValueOffset; }
    };

    // Mirrors the ROD Toolkit's own WEAPON_CATEGORIES table
    // (tools/build_pipeline.py) -- confirmed directly against
    // ItemDataAsset.json, not re-derived independently.
    const std::unordered_map<std::string, WeaponCategoryConfig>& RODWeaponModLoader::GetCategoryConfigs()
    {
        static const std::unordered_map<std::string, WeaponCategoryConfig> configs = {
            { "OneHandedSword", { "OneHandedSwordWeaponItemDataAsMap", "OneHandedSwordWeaponEnhancementDataAsMap", "WOS" } },
            { "Rapier",         { "RapierWeaponItemDataAsMap",         "RapierWeaponEnhancementDataAsMap",         "WRA" } },
            { "Dagger",         { "DaggerWeaponItemDataAsMap",         "DaggerWeaponEnhancementDataAsMap",         "WDA" } },
            { "Mace",           { "MaceWeaponItemDataAsMap",           "MaceWeaponEnhancementDataAsMap",           "WMA" } },
            { "TwoHandedSword", { "TwoHandedSwordWeaponItemDataAsMap", "TwoHandedSwordWeaponEnhancementDataAsMap", "WTS" } },
            { "Axe",            { "AxeWeaponItemDataAsMap",            "AxeWeaponEnhancementDataAsMap",            "WAX" } },
        };
        return configs;
    }

    RODWeaponModLoader::RODWeaponModLoader() : RODModLoaderBase("weapons")
    {
        SetDisplayName(STR("Weapon Loader"));
    }

    RODWeaponModLoader::~RODWeaponModLoader() = default;

    bool RODWeaponModLoader::CanInitialize(const EEngineLifecyclePhase& engineLifecyclePhase)
    {
        return engineLifecyclePhase == EEngineLifecyclePhase::GameInstanceInit;
    }

    bool RODWeaponModLoader::OnInitialize()
    {
        try
        {
            // Confirmed real asset path (matches the ROD Toolkit's own
            // raw-export source file for DataAssets/Items/ItemDataAsset.json).
            m_itemDataAsset = UObjectGlobals::StaticFindObject<UObject*>(
                nullptr, nullptr, STR("/Game/ROD/DataAssets/Items/ItemDataAsset.ItemDataAsset"));

            if (!m_itemDataAsset)
            {
                throw std::runtime_error(
                    "Could not find /Game/ROD/DataAssets/Items/ItemDataAsset.ItemDataAsset in memory. "
                    "Either the asset hasn't loaded yet at GameInstanceInit, or this game version moved it -- "
                    "check UE4SS_ObjectDump.txt for the current real path before assuming the code is wrong.");
            }

            BuildItemKeyLookup();
        }
        catch (const std::exception& e)
        {
            PS::Log<LogLevel::Error>(STR("[RODSchema] Unable to initialize {}: {}\n"), GetDisplayName(), RC::to_generic_string(e.what()));
            return false;
        }

        return true;
    }

    void RODWeaponModLoader::BuildItemKeyLookup()
    {
        auto* cls = m_itemDataAsset->GetClassPrivate();

        for (const auto& [category, config] : GetCategoryConfigs())
        {
            auto* mapProp = CastField<FMapProperty>(cls->GetPropertyByNameInChain(RC::to_generic_string(config.itemMapProperty).c_str()));
            if (!mapProp)
            {
                PS::Log<LogLevel::Warning>(STR("[RODSchema] Property '{}' not found on RODItemDataAsset -- skipping {} category (game version drift?).\n"),
                    RC::to_generic_string(config.itemMapProperty), RC::to_generic_string(category));
                continue;
            }

            RODMapView mapView(mapProp, m_itemDataAsset);
            auto* valueStructProp = CastField<FStructProperty>(mapView.ValueProp);
            auto* keyProp = mapView.KeyProp;

            for (int32_t i = 0; i < mapView.GetMaxIndex(); ++i)
            {
                if (!mapView.IsValidIndex(i)) continue;

                int32_t id = 0;
                keyProp->CopySingleValue(&id, mapView.GetKeyPtr(i));

                auto* valuePtr = mapView.GetValuePtr(i);
                auto* itemKeyProp = CastField<FNameProperty>(valueStructProp->GetStruct()->GetPropertyByName(STR("ItemKey")));
                if (!itemKeyProp)
                {
                    // ItemKey is confirmed present on every weapon entry we
                    // pulled -- if this fires, the struct shape changed.
                    continue;
                }

                FName itemKeyName;
                itemKeyProp->CopySingleValue(&itemKeyName, itemKeyProp->ContainerPtrToValuePtr<void>(valuePtr));

                m_itemKeyLookup[RC::to_string(itemKeyName.ToString())] = ResolvedWeaponRef{ category, id };
            }
        }

        PS::Log<LogLevel::Normal>(STR("[RODSchema] Indexed {} weapons across {} categories.\n"), m_itemKeyLookup.size(), GetCategoryConfigs().size());
    }

    std::optional<ResolvedWeaponRef> RODWeaponModLoader::ResolveItemKey(const std::string& itemKey, const std::string& explicitCategory)
    {
        auto it = m_itemKeyLookup.find(itemKey);
        if (it == m_itemKeyLookup.end())
        {
            return std::nullopt;
        }

        if (!explicitCategory.empty() && it->second.category != explicitCategory)
        {
            PS::Log<LogLevel::Warning>(STR("[RODSchema] '{}' was expected in category '{}' but was actually found in '{}' -- using the real one.\n"),
                RC::to_generic_string(itemKey), RC::to_generic_string(explicitCategory), RC::to_generic_string(it->second.category));
        }

        return it->second;
    }

    uint8_t* RODWeaponModLoader::FindMapEntry(const std::string& mapPropertyName, int32_t id, UScriptStruct** outValueStruct)
    {
        auto* cls = m_itemDataAsset->GetClassPrivate();
        auto* mapProp = CastField<FMapProperty>(cls->GetPropertyByNameInChain(RC::to_generic_string(mapPropertyName).c_str()));
        if (!mapProp) return nullptr;

        RODMapView mapView(mapProp, m_itemDataAsset);
        auto* valueStructProp = CastField<FStructProperty>(mapView.ValueProp);
        if (outValueStruct) *outValueStruct = valueStructProp->GetStruct();

        auto* keyProp = mapView.KeyProp;

        for (int32_t i = 0; i < mapView.GetMaxIndex(); ++i)
        {
            if (!mapView.IsValidIndex(i)) continue;

            int32_t candidateId = 0;
            keyProp->CopySingleValue(&candidateId, mapView.GetKeyPtr(i));

            if (candidateId == id)
            {
                return reinterpret_cast<uint8_t*>(mapView.GetValuePtr(i));
            }
        }

        return nullptr;
    }

    void RODWeaponModLoader::CopyStats(const ResolvedWeaponRef& sourceRef, const ResolvedWeaponRef& targetRef)
    {
        if (sourceRef.category != targetRef.category)
        {
            throw std::runtime_error(std::format(
                "CopyStatsFrom must reference a weapon in the SAME category ('{}' vs '{}') -- the two categories' structs aren't guaranteed to match.",
                sourceRef.category, targetRef.category));
        }

        const auto& config = GetCategoryConfigs().at(sourceRef.category);

        // Fields copied on the item map entry -- confirmed real, shared
        // fields on every weapon we pulled.
        static const std::vector<std::string> statFields = {
            "WeaponAttack", "Grade", "Class", "ModNames", "WeaponTypeID", "WeaponStrikeType"
        };

        UScriptStruct* itemStruct = nullptr;
        auto* srcItem = FindMapEntry(config.itemMapProperty, sourceRef.id, &itemStruct);
        auto* dstItem = FindMapEntry(config.itemMapProperty, targetRef.id, &itemStruct);
        if (!srcItem || !dstItem || !itemStruct)
        {
            throw std::runtime_error("CopyStatsFrom: could not resolve source or target map entry (unexpected -- both were already looked up via the ItemKey index).");
        }

        for (const auto& fieldName : statFields)
        {
            auto* prop = itemStruct->GetPropertyByName(RC::to_generic_string(fieldName).c_str());
            if (!prop) continue;
            prop->CopyCompleteValue(prop->ContainerPtrToValuePtr<void>(dstItem), prop->ContainerPtrToValuePtr<void>(srcItem));
        }

        // Full enhancement curve, separate map, same ID.
        UScriptStruct* enhStruct = nullptr;
        auto* srcEnh = FindMapEntry(config.enhancementMapProperty, sourceRef.id, &enhStruct);
        auto* dstEnh = FindMapEntry(config.enhancementMapProperty, targetRef.id, &enhStruct);
        if (srcEnh && dstEnh && enhStruct)
        {
            for (FProperty* prop : TFieldRange<FProperty>(enhStruct, EFieldIterationFlags::None))
            {
                prop->CopyCompleteValue(prop->ContainerPtrToValuePtr<void>(dstEnh), prop->ContainerPtrToValuePtr<void>(srcEnh));
            }
        }
        else
        {
            PS::Log<LogLevel::Warning>(STR("[RODSchema] CopyStatsFrom applied stats but the enhancement curve entry wasn't found for one side -- enhancement curve left unchanged.\n"));
        }
    }

    void RODWeaponModLoader::ApplyWeaponEdit(const std::string& itemKey, const ResolvedWeaponRef& ref, const nlohmann::json& data)
    {
        const auto& config = GetCategoryConfigs().at(ref.category);

        if (data.contains("CopyStatsFrom"))
        {
            auto sourceKey = data.at("CopyStatsFrom").get<std::string>();
            auto sourceRef = ResolveItemKey(sourceKey, "");
            if (!sourceRef)
            {
                throw std::runtime_error(std::format("CopyStatsFrom target '{}' was not found in any weapon category.", sourceKey));
            }

            CopyStats(*sourceRef, ref);
            PS::Log<LogLevel::Normal>(STR("[RODSchema] Modified Weapon '{}' (copied stats from '{}')\n"),
                RC::to_generic_string(itemKey), RC::to_generic_string(sourceKey));
        }

        UScriptStruct* itemStruct = nullptr;
        auto* itemPtr = FindMapEntry(config.itemMapProperty, ref.id, &itemStruct);
        if (!itemPtr || !itemStruct)
        {
            throw std::runtime_error(std::format("Internal error: lost the map entry for '{}' after resolving it.", itemKey));
        }

        static const std::vector<std::string> directFields = {
            "WeaponAttack", "Grade", "Class", "ModNames", "WeaponTypeID",
            "WeaponStrikeType", "BuyAmount", "SellAmount", "CanBuyAndSell"
        };

        bool anyExplicitField = false;
        for (const auto& fieldName : directFields)
        {
            if (!data.contains(fieldName)) continue;
            auto* prop = itemStruct->GetPropertyByName(RC::to_generic_string(fieldName).c_str());
            if (!prop)
            {
                PS::Log<LogLevel::Warning>(STR("[RODSchema] '{}' has no property called '{}' on this game version -- skipped.\n"),
                    RC::to_generic_string(itemKey), RC::to_generic_string(fieldName));
                continue;
            }
            RODSchema::PropertyHelper::CopyJsonValueToContainer(itemPtr, prop, data.at(fieldName));
            anyExplicitField = true;
        }

        if (data.contains("Enhancement"))
        {
            UScriptStruct* enhStruct = nullptr;
            auto* enhPtr = FindMapEntry(config.enhancementMapProperty, ref.id, &enhStruct);
            if (enhPtr && enhStruct)
            {
                for (auto& [fieldName, fieldValue] : data.at("Enhancement").items())
                {
                    auto* prop = enhStruct->GetPropertyByName(RC::to_generic_string(fieldName).c_str());
                    if (!prop)
                    {
                        PS::Log<LogLevel::Warning>(STR("[RODSchema] Enhancement field '{}' not found for '{}' -- skipped.\n"),
                            RC::to_generic_string(fieldName), RC::to_generic_string(itemKey));
                        continue;
                    }
                    RODSchema::PropertyHelper::CopyJsonValueToContainer(enhPtr, prop, fieldValue);
                }
                anyExplicitField = true;
            }
        }

        if (anyExplicitField && !data.contains("CopyStatsFrom"))
        {
            PS::Log<LogLevel::Normal>(STR("[RODSchema] Modified Weapon '{}'\n"), RC::to_generic_string(itemKey));
        }
    }

    void RODWeaponModLoader::LoadWeaponFile(const nlohmann::json& data, const RC::StringType& modName)
    {
        for (auto& [itemKey, value] : data.items())
        {
            try
            {
                std::string explicitCategory;
                if (value.contains("Category"))
                {
                    explicitCategory = value.at("Category").get<std::string>();
                }

                auto ref = ResolveItemKey(itemKey, explicitCategory);
                if (!ref)
                {
                    PS::Log<LogLevel::Error>(STR("[RODSchema] '{}' (mod '{}') does not match any real weapon ItemKey -- skipped. v1 does not support adding brand-new weapons, only editing existing ones.\n"),
                        RC::to_generic_string(itemKey), modName);
                    continue;
                }

                ApplyWeaponEdit(itemKey, *ref, value);
            }
            catch (const std::exception& e)
            {
                PS::Log<LogLevel::Error>(STR("[RODSchema] Failed to apply '{}' (mod '{}'): {}\n"),
                    RC::to_generic_string(itemKey), modName, RC::to_generic_string(e.what()));
            }
        }
    }

    void RODWeaponModLoader::OnLoad(const std::filesystem::path& loaderPath, const RC::StringType& modName, const EEngineLifecyclePhase& engineLifecyclePhase)
    {
        if (engineLifecyclePhase != EEngineLifecyclePhase::GameInstanceInit) return;

        PS::JsonHelpers::ParseJsonFilesInPath(loaderPath, [&](const nlohmann::json& data) {
            LoadWeaponFile(data, modName);
        });
    }
}
