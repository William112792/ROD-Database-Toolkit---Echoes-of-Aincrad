#pragma once

#include "Loader/RODModLoaderBase.h"
#include "Unreal/UObject.hpp"
#include "Unreal/CoreUObject/UObject/UnrealType.hpp"
#include "Unreal/NameTypes.hpp"
#include <nlohmann/json_fwd.hpp>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace ROD {

    struct WeaponCategoryConfig {
        std::string itemMapProperty;   // e.g. "OneHandedSwordWeaponItemDataAsMap"
        std::string enhancementMapProperty; // e.g. "OneHandedSwordWeaponEnhancementDataAsMap"
        std::string prefix;            // e.g. "WOS" -- for inferring category from ItemKey
    };

    // Where a resolved ItemKey lives: which category + which numeric map key.
    struct ResolvedWeaponRef {
        std::string category;
        int32_t id = -1;
    };

    // v1: patches the live RODItemDataAsset's per-category TMaps directly.
    // No mesh/visual handling -- see README "Known limitations".
    class RODWeaponModLoader : public RODModLoaderBase {
    public:
        RODWeaponModLoader();
        ~RODWeaponModLoader() override;

    protected:
        bool CanInitialize(const EEngineLifecyclePhase& engineLifecyclePhase) override;
        bool OnInitialize() override;
        void OnLoad(const std::filesystem::path& loaderPath, const RC::StringType& modName, const EEngineLifecyclePhase& engineLifecyclePhase) override;

    private:
        // Populates m_itemKeyLookup by walking every category's item map
        // once and reading each entry's real "ItemKey" field.
        void BuildItemKeyLookup();

        void LoadWeaponFile(const nlohmann::json& data, const RC::StringType& modName);

        // Applies CopyStatsFrom + explicit field overrides + optional
        // "Enhancement" block to the weapon identified by `ref`.
        void ApplyWeaponEdit(const std::string& itemKey, const ResolvedWeaponRef& ref, const nlohmann::json& data);

        // Copies WeaponAttack/Grade/Class/ModNames/WeaponTypeID/
        // WeaponStrikeType + the full enhancement curve from `sourceRef`
        // onto `targetRef`. Both must be in the same category (the two
        // categories' structs aren't guaranteed to share a shape).
        void CopyStats(const ResolvedWeaponRef& sourceRef, const ResolvedWeaponRef& targetRef);

        // Raw pointer to a category's TMap value struct for a given
        // numeric ID, or nullptr if not found. `outValueStruct` receives
        // the UScriptStruct describing the value type (needed to look up
        // field properties by name).
        uint8_t* FindMapEntry(const std::string& mapPropertyName, int32_t id, RC::Unreal::UScriptStruct** outValueStruct);

        std::optional<ResolvedWeaponRef> ResolveItemKey(const std::string& itemKey, const std::string& explicitCategory);

        RC::Unreal::UObject* m_itemDataAsset = nullptr;

        // ItemKey (e.g. "ItemName_WOS_1") -> {category, numeric map key}
        std::unordered_map<std::string, ResolvedWeaponRef> m_itemKeyLookup;

        static const std::unordered_map<std::string, WeaponCategoryConfig>& GetCategoryConfigs();
    };
}
