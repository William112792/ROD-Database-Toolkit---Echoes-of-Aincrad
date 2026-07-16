#pragma once

#include "Unreal/CoreUObject/UObject/UnrealType.hpp"
#include "Unreal/CoreUObject/UObject/Class.hpp"
#include "nlohmann/json_fwd.hpp"
#include <cstdint>

// Unlike PalSchema's PropertyHelper (which can lean on a fully-generated
// Palworld SDK), RODSchema has no generated SDK for Echoes of Aincrad yet.
// This version works purely off UE4SS's generic FProperty reflection API
// (CastField<T>, ContainerPtrToValuePtr) so it doesn't assume any specific
// struct layout beyond property NAMES, which we verified directly against
// your ItemDataAsset.json export. This is slower than a real generated SDK
// (name lookup + cast per field, every load) but correct is more important
// than fast for a JSON-driven data patcher that only runs once at boot.
namespace RODSchema {
    class PropertyHelper {
    public:
        // container = raw pointer to the struct/object instance being
        // patched (e.g. reinterpret_cast<uint8_t*>(weaponEntryPtr)).
        // Supports: Int/Float/Double/Bool/Str/Name properties, Enum
        // properties (by their string name, e.g. "EClassRank::RankS"),
        // and ArrayProperty of any of the above (recurses per element).
        // Throws std::runtime_error with a descriptive message on any
        // type mismatch rather than silently truncating/misinterpreting
        // a value -- a bad JSON value should be a loud, logged failure.
        static void CopyJsonValueToContainer(uint8_t* container, RC::Unreal::FProperty* property, const nlohmann::json& value);

        // Generic property-by-name lookup on any UStruct/UScriptStruct.
        // Used by both RODWeaponModLoader (DataAsset maps) and
        // RODRawTableLoader (arbitrary DataTable row structs) so there's
        // one shared, tested implementation of "find field X on struct Y."
        static RC::Unreal::FProperty* GetPropertyByName(RC::Unreal::UStruct* ownerStruct, const RC::StringType& propertyName);

    private:
        static void CopyScalar(uint8_t* valuePtr, RC::Unreal::FProperty* property, const nlohmann::json& value);
    };
}
