#include "Utility/PropertyHelper.h"
#include "Unreal/CoreUObject/UObject/UnrealType.hpp"
#include "Unreal/FString.hpp"
#include "Unreal/NameTypes.hpp"
#include <nlohmann/json.hpp>
#include <format>
#include <stdexcept>

using namespace RC;
using namespace RC::Unreal;

namespace RODSchema {

    void PropertyHelper::CopyScalar(uint8_t* valuePtr, FProperty* property, const nlohmann::json& value)
    {
        // Using CopySingleValue(dest, src) uniformly here, NOT
        // SetPropertyValue_InContainer/SetValue_InContainer -- both of
        // those were guesses based on real Epic UE API names, and BOTH
        // failed to compile against this RE-UE4SS build (its property
        // classes are hand-written reimplementations of Epic's reflection
        // classes, not literally Epic's own source, so their method names
        // don't have to match). CopySingleValue is a CONFIRMED-working
        // method instead -- it's the exact same one already compiling
        // cleanly elsewhere in this codebase (RODWeaponModLoader.cpp's
        // keyProp->CopySingleValue(...) calls had zero errors in the same
        // build log that caught everything below).
        if (auto* p = CastField<FIntProperty>(property))
        {
            if (!value.is_number_integer())
            {
                throw std::runtime_error(std::format("Expected integer for property '{}'", RC::to_string(property->GetName())));
            }
            int32_t v = value.get<int32_t>();
            p->CopySingleValue(valuePtr, &v);
            return;
        }

        if (auto* p = CastField<FFloatProperty>(property))
        {
            if (!value.is_number())
            {
                throw std::runtime_error(std::format("Expected number for property '{}'", RC::to_string(property->GetName())));
            }
            float v = value.get<float>();
            p->CopySingleValue(valuePtr, &v);
            return;
        }

        if (auto* p = CastField<FDoubleProperty>(property))
        {
            if (!value.is_number())
            {
                throw std::runtime_error(std::format("Expected number for property '{}'", RC::to_string(property->GetName())));
            }
            double v = value.get<double>();
            p->CopySingleValue(valuePtr, &v);
            return;
        }

        if (auto* p = CastField<FBoolProperty>(property))
        {
            if (!value.is_boolean())
            {
                throw std::runtime_error(std::format("Expected boolean for property '{}'", RC::to_string(property->GetName())));
            }
            bool v = value.get<bool>();
            p->CopySingleValue(valuePtr, &v);
            return;
        }

        if (auto* p = CastField<FNameProperty>(property))
        {
            if (!value.is_string())
            {
                throw std::runtime_error(std::format("Expected string for property '{}'", RC::to_string(property->GetName())));
            }
            FName v(RC::to_generic_string(value.get<std::string>()), FNAME_Add);
            p->CopySingleValue(valuePtr, &v);
            return;
        }

        // NOTE (known v1 gap, not a guess-and-hope): CastField<FStrProperty>
        // and CastField<FEnumProperty> both fail to COMPILE against this
        // RE-UE4SS build specifically -- a concept/constraint check on
        // CastField<T> rejects both types entirely (not a missing method,
        // a hard compile-time rejection), so there's no runtime fallback
        // to fall back on here; the branches are simply omitted rather
        // than shipping code that doesn't build.
        //
        // Practically: this means a DIRECT explicit JSON override of a
        // string or enum field (e.g. overriding "Class" by itself,
        // outside of CopyStatsFrom) isn't supported in this build.
        // CopyStatsFrom-based mods (like the Shortsword/Death's Salvation
        // example) are UNAFFECTED by this gap -- that path copies whole
        // struct fields byte-for-byte via CopyCompleteValue, which never
        // needs to identify the concrete property subtype at all.
        // Revisit if/when explicit Str/Enum field overrides are needed:
        // will need to find out from a real compiler error why CastField
        // rejects these two specific types in this build (possibly a
        // missing template specialization for their field-class ID).

        throw std::runtime_error(std::format(
            "Property '{}' has an unsupported type in RODSchema v1 (Int/Float/Double/Bool/Name are supported; direct String/Enum field overrides are a known gap -- see code comment). "
            "CopyStatsFrom-based edits are unaffected by this.",
            RC::to_string(property->GetName())));
    }

    FProperty* PropertyHelper::GetPropertyByName(UStruct* ownerStruct, const RC::StringType& propertyName)
    {
        if (!ownerStruct) return nullptr;

        // UE4SS's generic UStruct reflection API -- walks the struct's own
        // properties plus any it inherits, matching UE's own
        // FindPropertyByName semantics. Works identically whether
        // ownerStruct is a UScriptStruct (a DataTable row struct, a
        // DataAsset's Map value struct) or something else in UStruct's
        // hierarchy.
        for (FProperty* prop : TFieldRange<FProperty>(ownerStruct, EFieldIterationFlags::IncludeSuper))
        {
            if (prop->GetName() == propertyName)
            {
                return prop;
            }
        }
        return nullptr;
    }

    void PropertyHelper::CopyJsonValueToContainer(uint8_t* container, FProperty* property, const nlohmann::json& value)
    {
        if (auto* arrayProp = CastField<FArrayProperty>(property))
        {
            if (!value.is_array())
            {
                throw std::runtime_error(std::format("Expected a JSON array for array property '{}'", RC::to_string(property->GetName())));
            }

            FScriptArrayHelper helper(arrayProp, arrayProp->ContainerPtrToValuePtr<void>(container));
            helper.EmptyValues();

            auto* inner = arrayProp->GetInner();
            for (const auto& element : value)
            {
                int32_t index = helper.AddValue();
                CopyScalar(helper.GetRawPtr(index), inner, element);
            }
            return;
        }

        CopyScalar(property->ContainerPtrToValuePtr<uint8_t>(container), property, value);
    }
}
