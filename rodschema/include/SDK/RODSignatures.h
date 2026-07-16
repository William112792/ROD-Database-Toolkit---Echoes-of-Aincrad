#pragma once

#include <filesystem>
#include <unordered_map>
#include <string>

// Mirrors PalSchema's SignatureManager exactly (Signatures /
// SignaturesCallResolve / SignatureMap -- see RODSchema_RE_Guide.md for
// what each one means and how to add to them). None of PalSchema's
// original signature BYTES transfer -- every entry here has been (or
// still needs to be) independently re-derived against Echoes of
// Aincrad's own compiled binary.
//
// STATUS NOTE: "UDataTable::Serialize" is now CONFIRMED (1/1 module-wide
// unique match) -- see its entry below for identity-confidence caveats
// (inferred from behavior, not an explicit debug string naming it).
// "FPakPlatformFile::GetPakFolders" is still a PLACEHOLDER (empty
// signature string, treated as "not yet found" and skipped during
// scanning) -- optional feature, doesn't block JSON mods.
namespace ROD {
    class SignatureManager {
    public:
        static void Initialize();

        // Expected parameter format: [CLASS]::[FUNCTION], e.g.
        // AROHeroCharacter::ChangeEquipmentBody
        static void* GetSignature(const std::string& ClassAndFunction);

    private:
        static inline std::unordered_map<std::string, void*> SignatureMap;

        // Direct-match signatures: the AOB match address IS the function's
        // entry point. Use this when the function's own opening bytes are
        // unique module-wide (verify via a full-module scan -- see guide).
        static inline std::unordered_map<std::string, std::string> Signatures {
            // Confirmed unique (1/1 module-wide match) against build
            // "May 27 2026 (TitanEngine)". Fires on Upper/Gloves/Lower
            // costume changes -- confirmed NOT to fire on weapon/shield
            // swaps (see RODSchema_RE_Guide.md).
            { "AROHeroCharacter::ChangeEquipmentBody",
              "48 8B C4 48 89 58 08 48 89 70 10 48 89 78 18 4C 89 60 20 55 41 56 41 57 48 8D 68 C8 48 81 EC 20 01 00 00 48 8B 01 45 8B F9 45 8B E0 0F B6 DA 48 8B F9 FF 90 D0 07 00 00 84 C0 0F 84 E5 00 00 00" },

            // Confirmed unique (1/1). Real function name NOT confirmed --
            // this is the shared dispatcher whose control flow reaches both
            // the OnEquipmentWeaponChanged and OnEquipmentShieldChanged
            // debug log strings (confirmed via Graph view). See the guide's
            // "Next steps" before hooking this -- parameter mapping isn't
            // confirmed yet, only entry address/bytes.
            { "AROHeroCharacter::WeaponShieldEquipDispatcher_UNCONFIRMED_NAME",
              "48 89 5C 24 18 55 56 57 48 83 EC 20 48 8B F9 E8 ?? ?? ?? ?? 48 8B 07" },

            // CONFIRMED UNIQUE (1/1 module-wide match) at 0000000142AC00E8.
            // Real identity is INFERRED, not proven via an explicit debug
            // string naming the function (unlike the AROHeroCharacter
            // entries above) -- circumstantial evidence is strong though:
            // archive-null check, an IsLoading()-style bitflag test, a
            // custom-version GUID compare, and a direct path to the
            // "Missing RowStruct while loading DataTable '%s'!" string.
            // Treat as high-confidence but not certain until the hook is
            // actually installed and a real table load is observed to
            // trigger it correctly.
            { "UDataTable::Serialize",
              "40 55 53 56 57 41 56 41 57 48 8B EC 48 83 EC 58 4C 8B 79 28 48 8B DA 48 8B F1 4D 85 FF 75 6B" },

            // NOT YET FOUND. Placeholder. Optional feature (lets mods ship
            // .pak files under RODSchema/mods/, read automatically) -- not
            // blocking for JSON-only mods.
            { "FPakPlatformFile::GetPakFolders", "" },
        };

        // Call-resolve signatures: the AOB match is a `call` (or similar
        // relative-address) instruction; the actual function address is
        // resolved by following that call's target, not by using the match
        // address directly. Use this when a function's own prologue is too
        // generic to uniquely match, but a nearby CALLER of it is
        // distinctive enough to anchor on instead.
        static inline std::unordered_map<std::string, std::string> SignaturesCallResolve {
            // (empty for now -- add entries here if UDataTable::Serialize,
            // once hunted, turns out to need the call-resolve technique
            // rather than a direct match, same as it did for PalSchema)
        };
    };
}
