# RODSchema

A [PalSchema](https://github.com/okaetsu/PalSchema)-equivalent mod loader
for **Echoes of Aincrad** (EOA) — a native UE4SS C++ Mod (`main.dll`) that
lets modders patch the game's data with plain JSON files instead of hex
editing or rebuilding DataTables by hand.

This is now a **full architectural port** of PalSchema's core
(`MainLoader` + `RawTableLoader`), not just a narrow stats-only patcher —
per direct advice from PalSchema's own author: the `RawTableLoader` +
`MainLoader` pairing is the reusable part of PalSchema; everything else in
the original project is Palworld-specific.

## Current status — what works vs. what's blocked

| Capability | Status |
|---|---|
| Edit existing weapon stats (`RODWeaponModLoader`) | **Working** (pure reflection, no hook needed) |
| Edit/add/delete rows in **any** named `UDataTable`, generically (`RODRawTableLoader`) | **Unblocked** — `UDataTable::Serialize` signature confirmed; hook not yet tested in-game |
| `AROHeroCharacter::ChangeEquipmentBody` signature | **Confirmed** (costume/armor-body equip, NOT weapons) |
| Weapon/shield equip dispatcher signature | **Confirmed**, real name/parameters still unmapped |
| Mesh remap (v2 original goal) | Not started — needs the dispatcher above traced further |
| Auto-reload (file watching) | Deferred stub, not built yet |
| Pak-based mods (`.pak` alongside JSON) | Optional, blocked on a second signature (`FPakPlatformFile::GetPakFolders`) |
| EOA GameInstance class + vtable index (needed for `GameInstanceInit`-phase loaders to fire automatically) | Not found yet — currently a placeholder guess in `RODMainLoader` |

**Next concrete step: build it and confirm the hook actually fires and
resolves a real `UDataTable*` in-game** (see `RODSchema_RE_Guide.md`
"Next steps") — the signature is confirmed unique, but its *identity* as
`Serialize` specifically is inferred from behavior, not proven by an
explicit name string the way the `AROHeroCharacter` functions were, so the
real proof is seeing it work correctly at runtime.

## Architecture

At game boot, RODSchema:

1. Finds the game's real `RODItemDataAsset` object in memory (confirmed
   class, confirmed asset path — see "Confirmed findings" below).
2. Reads every `*.json` file under `mods/<YourMod>/weapons/`.
3. For each entry, looks up the matching weapon by its real `ItemKey`
   (e.g. `ItemName_WOS_1`) and overwrites the requested fields directly
   on the live `TMap` entry — before the player ever sees the item.
4. Optionally copies another weapon's full stat block over
   (`CopyStatsFrom`), which is the mechanism for your Shortsword ➜
   Death's Salvation ask.

It does **not** touch meshes/visuals yet — see Known limitations.

## Confirmed findings (from your UE4SS dumps + the ROD Toolkit's own
build pipeline — cross-referenced, not guessed)

- **Real class**: `/Script/ROD.RODItemDataAsset` (confirmed present in
  `UE4SS_ObjectDump.txt`), a native `UDataAsset` subclass — architecturally
  the direct equivalent of Palworld's `PalStaticItemDataAsset`.
- **Real asset instance path**: `/Game/ROD/DataAssets/Items/ItemDataAsset`
  (confirmed — this is the same file the ROD Toolkit's own
  `build_pipeline.py` reads as `DataAssets/Items/ItemDataAsset.json`).
- **Per-category storage**: each of the 6 weapon categories has its own
  `TMap<int32, FStruct>` property on that asset, e.g.
  `OneHandedSwordWeaponItemDataAsMap` — **keyed by numeric ID, not
  FName** (a real structural difference from Palworld's item system,
  where PalSchema's loader keys off FName). RODSchema's loader accounts
  for this by building an `ItemKey -> ID` lookup at init.
- **Real struct fields on a weapon entry** (pulled directly from your
  data for `ItemName_WOS_1` / `ItemName_WOS_28`):
  `WeaponAttack`, `Grade`, `Class` (rank enum), `ModNames` (array),
  `WeaponTypeID`, `WeaponStrikeType`, `TexSize`, `BuyAmount`,
  `SellAmount`, `DescriptionKey`, `ThumbnailTexture` (confirmed a
  placeholder — same value on every weapon, not worth patching).
- **Enhancement curve lives in a separate map**:
  `OneHandedSwordWeaponEnhancementDataAsMap` (same ID key), holding
  `BaseWeaponATK[]` (21 enhancement tiers) and per-ability
  `AbilityCorrectionRank{STR,DEX,AGI,INT}[]` arrays.
- **Mesh naming convention** (partially confirmed): weapon meshes live
  at `/Game/ROD/ITM/Weapons/Hero/{categoryFolder}/WH{catCode}{ID:03d}/
  SK_ITM_WH{catCode}{ID:03d}` — confirmed for IDs 004 and 013 in your
  object dump; IDs 001 and 028 weren't loaded in memory at dump time,
  so their exact folder names are inferred from the pattern, not
  independently confirmed.

## Known limitations (v1 -> v2)

- **No mesh/visual swap yet.** There is no mesh field anywhere on the
  weapon struct itself — visual resolution almost certainly happens in
  game code (likely `RODWeaponActor` / `RODAvatarEquipmentWeapon`, both
  real classes in your dump) that builds the asset path from the ID at
  runtime. Actually remapping Shortsword's rendered mesh to Death's
  Salvation's will need one of:
  - a function hook intercepting that path-construction call and
    substituting the ID (PalSchema-style `safetyhook` inline hook —
    requires finding the real function via a signature/AOB scan against
    the actual EOA binary, which nobody has done yet), or
  - a traditional `.pak` asset-redirect mod (a different modding
    technique entirely, outside UE4SS/RODSchema's JSON-patching scope).

  Deliberately NOT scoped into v1 — flagged here as a planning note for
  v2, not solved by a fake `MeshOverride` JSON field that would silently
  do nothing in-game.
- **No pre-generated SDK headers for EOA exist.** PalSchema's own SDK
  mirrors Palworld's *actual compiled binary* via hand/tool-generated
  offsets. None of that transfers — a different game means different
  offsets. RODSchema avoids needing a full SDK dump at all: everywhere
  we touch a `UDataAsset`/`UDataTable` (`RODWeaponModLoader`,
  `RODRawTableLoader`), we use UE4SS's own generic `FProperty` reflection
  API (`PropertyHelper.cpp`) — property lookup by name, not hardcoded
  offsets. The only place this repo DOES use raw AOB signatures
  (`RODSignatures.h`) is for the handful of functions that need an actual
  inline *hook* rather than "find object, read/write its properties" —
  `UDataTable::Serialize`, the equip-related `AROHeroCharacter` functions,
  etc. Those signatures are independently re-derived against EOA's own
  binary (see `RODSchema_RE_Guide.md`), not ported from PalSchema's.
- **This zip contains source, not a compiled `dlls/main.dll`.** I don't
  have a Windows/MSVC toolchain or the EOA game binary in this
  environment, so I can't actually compile or test this. Build it
  yourself per "Building" below — that also means the very first
  compile is where you'll find out if any property name here has
  drifted from what your specific game version has.

## Editing ANY DataTable generically (once UDataTable::Serialize is found)

`RODRawTableLoader` reads `mods/<YourMod>/raw/*.json`. Format matches
PalSchema's own raw-table convention exactly:

```json
{
  "DT_ShopItemList": {
    "SomeRowName": { "SomeField": 123 },
    "AnotherRowName": null,
    "BrandNewRowName": { "SomeField": 456 }
  }
}
```

- Top-level keys are real `UDataTable` names (as they'd appear in
  `UE4SS_ObjectDump.txt` or FModel).
- A row name that already exists gets its listed fields overwritten
  (**edit**).
- A row name set to `null` gets removed entirely (**delete**).
- A row name that doesn't exist yet gets created fresh, using
  `FManagedStruct` to properly allocate/construct a new row of the
  table's own row-struct type (**add**).
- This works the moment ANY table with a matching name serializes,
  whenever that happens to be — including a table that gets reloaded
  mid-session, not just once at boot.

## Folder structure

```
RODSchema/
  dlls/                        <- put compiled main.dll here (UE4SS Mods/RODSchema/dlls/)
  mods/
    ExampleWeaponSwap/
      metadata.json
      weapons/
        OneHandedSword.json     <- Shortsword -> Death's Salvation stat swap
    NewItems/
      metadata.json
      items/
        UsableItems.json        <- X Juice / Z Juice new-item example
    <YourMod>/
      raw/
        *.json                  <- generic DataTable edits (any table, any row)
  enabled.txt
  assets/
    schemas/                    <- JSON Schema for editor autocomplete
    examples/                   <- source copies of the mods above
  src/, include/                <- C++ source (see Building)
  CMakeLists.txt
```

## Installing (once built)

1. Copy `dlls/main.dll` to
   `<Game>/Binaries/Win64/ue4ss/Mods/RODSchema/dlls/main.dll`.
2. Copy `mods/` and `enabled.txt` alongside it, same as PalSchema.
3. Edit/add JSON under `mods/<YourMod>/weapons/`.

## Building

Same prerequisites as PalSchema — see
[UE4SS build requirements](https://docs.ue4ss.com/#build-requirements)
(Epic Games GitHub access is required for Unreal Engine source).

```bash
git submodule update --init --recursive
cmake -B build -G "Visual Studio 17 2022"
# or: cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Game__Shipping__Win64
cmake --build build --config Game__Shipping__Win64
```

This CMakeLists.txt is adapted from PalSchema's own — same `deps/`
layout expected (`json`, `safetyhook`, `glaze`, `RE-UE4SS`, `efsw`) if
you pull those in as submodules the same way PalSchema does.

## Verifying it's actually injecting (your stated test plan)

1. Build, install, launch the game with the example mod's
   `weapons/OneHandedSword.json` as shipped (Shortsword copies Death's
   Salvation's stats).
2. Check `ue4ss/UE4SS.log` for
   `[RODSchema] Modified Weapon 'ItemName_WOS_1' (copied stats from 'ItemName_WOS_28')`
   — RODSchema logs every successful edit, same convention as PalSchema.
3. In-game, check Shortsword's ATK is now 105 (was 25) and its rank
   badge shows S (was D).
4. Tweak the JSON's `WeaponAttack` to some other value you can visually
   confirm (e.g. `9999`), relaunch, confirm it changes — that's your
   sanity check that the DLL is genuinely re-parsing the file each run
   rather than you seeing a cached/stale result.
