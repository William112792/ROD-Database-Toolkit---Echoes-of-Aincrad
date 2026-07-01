#!/usr/bin/env python3
"""
ROD Database build pipeline.

Reads raw Unreal-exported JSON from <project_root>/raw-export/Content/ROD/...
and produces clean, flattened, app-ready JSON under
<project_root>/Content/ROD/...

Re-runnable: as the game updates and new raw JSON is dropped into the
raw-export/ source folder, re-running this script regenerates the app
data files in place, overwriting old data with new (the localization
file is the exception -- it only ADDS new keys, never overwrites a
name you've already entered; see build_localization() below).

USAGE:
  1. Drop the new game's exported Content/ROD/... folder into
     raw-export/Content/ROD/ (overwriting the previous version).
  2. From this `tools/` folder, run:  python3 build_pipeline.py
  3. The app's Content/ROD/ folder (one level up) is regenerated.

NOTE: this script only handles the JSON data files. Texture/PNG assets
under raw-export/Content/ROD/... need to be copied manually into the
matching Content/ROD/... path alongside the JSON (the app references
weapon icons by predictable {prefix}{id} filenames -- see
derive_texture_set() below -- so as long as new weapon art follows the
same naming convention used by the game's own export, no code changes
are needed).
"""
import glob
import json
import os
import re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
LAST_BUILD_STATUS_PATH = os.path.join(PROJECT_ROOT, ".last-build-status.json")

SRC = os.path.join(PROJECT_ROOT, "raw-export", "Content", "ROD")
OUT = os.path.join(PROJECT_ROOT, "Content", "ROD")

# Languages the game itself ships. As of this version, the pipeline's
# PRIMARY localization source is the official UE string-table export at
# raw-export/Content/ROD/Localization/Game/{code}/Game.json (one folder
# per language code below) -- this is the full official game text,
# covering item names/descriptions, equipment mod names/descriptions,
# and EX-MOD labels, not just weapon names. See build_localization()
# for the parsing details and the (now secondary/fallback-only) old
# weapon_names_{code}.json format this replaces as primary source.
SUPPORTED_LANGUAGES = {
    "en":          "English",
    "de":          "Deutsch",
    "es-419":      "Español (Latinoamérica)",
    "es-ES":       "Español (España)",
    "fr":          "Français",
    "id":          "Bahasa Indonesia",
    "it":          "Italiano",
    "ko":          "한국어",
    "pt-BR":       "Português (Brasil)",
    "ru":          "Русский",
    "th":          "ไทย",
    "zh-Hans-CN":  "简体中文",
    "zh-Hant-TW":  "繁體中文",
}
DEFAULT_LANGUAGE = "en"

# Per the user: everything sourced from the official Game.json export is
# treated as verified=True unconditionally up through the game's go-live
# date below, since at this stage there's no way yet to distinguish
# "real, shipped content" from "a placeholder string for something not
# released yet" -- both look identical in the data. After this date,
# new entries discovered in a future export CAN be hand-flagged
# verified=False if their in-game status is genuinely uncertain (e.g.
# a name that looks like an unused/future-content placeholder) -- but
# that flagging is a manual, human judgment call going forward, never
# an automatic guess by this script (see build_localization() docstring).
GAME_LAUNCH_DATE = "2026-07-10"



WEAPON_CATEGORIES = {
    "OneHandedSword": {
        "itemMap": "OneHandedSwordWeaponItemDataAsMap",
        "enhMap": "OneHandedSwordWeaponEnhancementDataAsMap",
        "prefix": "WOS",
        "label": "One-Handed Sword",
    },
    "Rapier": {
        "itemMap": "RapierWeaponItemDataAsMap",
        "enhMap": "RapierWeaponEnhancementDataAsMap",
        "prefix": "WRA",
        "label": "Rapier",
    },
    "Dagger": {
        "itemMap": "DaggerWeaponItemDataAsMap",
        "enhMap": "DaggerWeaponEnhancementDataAsMap",
        "prefix": "WDA",
        "label": "Dagger",
    },
    "Mace": {
        "itemMap": "MaceWeaponItemDataAsMap",
        "enhMap": "MaceWeaponEnhancementDataAsMap",
        "prefix": "WMA",
        "label": "Rod / Hatchet / Edge / Hammer",
    },
    "TwoHandedSword": {
        "itemMap": "TwoHandedSwordWeaponItemDataAsMap",
        "enhMap": "TwoHandedSwordWeaponEnhancementDataAsMap",
        "prefix": "WTS",
        "label": "Two-Handed Sword",
    },
    "Axe": {
        "itemMap": "AxeWeaponItemDataAsMap",
        "enhMap": "AxeWeaponEnhancementDataAsMap",
        "prefix": "WAX",
        "label": "Axe / Sledgehammer",
    },
}

RANK_ORDER = ["RankD", "RankC", "RankB", "RankA", "RankS"]

ARMOR_CATEGORIES = {
    "Upper": {
        "itemMap": "UpperItemDataAsMap",
        "texPrefix": "Upper",
        "dbTexPrefix": "Upper",
        "label": "Upper Body",
        "gendered": True,
        "hasDef": True,
    },
    "Lower": {
        "itemMap": "LowerItemDataAsMap",
        "texPrefix": "Lower",
        "dbTexPrefix": "Lower",
        "label": "Lower Body",
        "gendered": True,
        "hasDef": True,
    },
    "Glove": {
        "itemMap": "GloveItemDataAsMap",
        "texPrefix": "Glove",
        "dbTexPrefix": "Glove",
        "label": "Gloves",
        "gendered": True,
        "hasDef": True,
    },
    "Shield": {
        "itemMap": "ShieldItemDataAsMap",
        "texPrefix": "S",          # NOTE: thumbnail + full-render prefix is "S", not "Shield"
        "dbTexPrefix": "Shield",   # NOTE: but the *database* thumbnail prefix IS "Shield" --
                                   # a genuine naming inconsistency in the game's own export,
                                   # not a mistake here.
        "label": "Shield",
        "gendered": False,
        "hasDef": False,  # confirmed: no shield entry in this export has a Def field at all
    },
}


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def strip_enum(value):
    """EClassRank::RankD -> RankD ; EStrikeType::Slash -> Slash"""
    if isinstance(value, str) and "::" in value:
        return value.split("::")[-1]
    return value


def asset_path_to_texture_key(asset_path_name):
    """
    /Game/ROD/DataAssets/Items/Textures/T_Item_WOS1.T_Item_WOS1
    -> Content/ROD/DataAssets/Items/Textures/T_Item_WOS1.png (relative, app-usable path)
    """
    if not asset_path_name:
        return None
    # take the part before the dot-duplicate suffix
    path_part = asset_path_name.split(".")[0]
    if path_part.startswith("/Game/"):
        path_part = "Content" + path_part[len("/Game"):]
    return path_part + ".png"


def derive_texture_set(prefix, item_id):
    """
    NOTE: the `ThumbnailTexture.AssetPathName` field embedded on each raw weapon
    item entry is NOT reliable -- in this data export every weapon of a given
    category points at the same placeholder texture (always IconID "1").
    The real per-weapon icon follows a `{prefix}{id}` naming convention and is
    confirmed present on disk for the two thumbnail render sizes plus the
    database render. There is only ONE full-size 3D model render per weapon
    *category* in this export (e.g. a single T_Item_WTS1.png stands in for
    every Two-Handed Sword) -- this is a category-level placeholder, not a
    per-item icon, so it's labeled accordingly rather than presented as if
    every weapon had its own unique full render.

    A small number of items (confirmed: WOS id 99, "Proto-Shortsword", a
    starter/no-mod weapon) have no dedicated texture files at all and reuse
    another item's art in-game (confirmed against the xlsx reference, whose
    Icon_Zoom/Full_Icon columns point Proto-Shortsword at the WOS1 files).
    TEXTURE_OVERRIDES lets us redirect those specific items rather than
    silently emitting a broken path.
    """
    override_id = TEXTURE_OVERRIDES.get((prefix, item_id), item_id)
    key = f"{prefix}{override_id}"
    return {
        "icon": f"Content/ROD/DataAssets/Items/Textures/Thumbnails/{prefix}/T_Item_Thumbnail_{key}.png",
        "iconSmall": f"Content/ROD/DataAssets/Items/Textures/Thumbnails/{prefix}/T_Item_Thumbnail_S_{key}.png",
        "iconDatabase": f"Content/ROD/Widget/Database/Thumbnail/Equipment/T_Database_Thumbnail_Equipment_{key}.png",
        "categoryPlaceholderRender": f"Content/ROD/DataAssets/Items/Textures/T_Item_{prefix}1.png",
    }


TEXTURE_OVERRIDES = {
    ("WOS", 99): 1,  # Proto-Shortsword reuses WOS1 art (confirmed via xlsx reference)
}

# Same situation as WOS_99 above: these items have no dedicated texture
# files on disk at all (confirmed -- no Upper99/Glove99 files exist in
# any size), so they reuse item 1's art rather than emit a broken path.
ARMOR_TEXTURE_OVERRIDES = {
    ("Upper", 99): 1,
    ("Glove", 99): 1,
    ("Lower", 99): 1,
    ("Shield", 99): 3,  # Shield has no id 1 -- its lowest real id is 3
}


def build_textures():
    """
    Copies raw texture/icon files from raw-export/Content/ROD/ into
    Content/ROD/ (the output tree), verbatim, preserving relative
    paths -- a genuine, previously-missing pipeline step.

    Every builder in this file that references a texture (weapon/armor/
    item icons, Sword Skill icons, Lore/Town/Database thumbnails, etc.)
    only ever CONSTRUCTS A PATH STRING pointing at where that texture
    should be (e.g. "Content/ROD/Widget/.../T_SwordSkill_WOS7.png") --
    not one of them actually copies the underlying PNG file itself.
    Confirmed by testing a completely fresh raw-export -> full pipeline
    rebuild cycle end-to-end and finding ZERO image files anywhere in
    the output: for this project's entire history, textures only ever
    appeared correctly in the running app because they'd been copied
    in manually, outside the pipeline, during development sessions --
    a genuinely automated rebuild (Build Dashboard's "Rebuild Full
    Pipeline", or `python3 build_pipeline.py` run fresh from a
    terminal) never did this at all.

    Copies two roots wholesale -- confirmed as the only two path
    prefixes any texture-path string anywhere in this file ever
    constructs (grepped every "Content/ROD/...*.png" pattern in this
    file to confirm, rather than assuming):
      - DataAssets/Items/Textures/ (weapon/armor/item icons)
      - Widget/ (all Widget-sourced icons: Sword Skill icons, database
        thumbnails, town thumbnails, etc. -- also contains some JSON
        BP-Inspector-relevant data, copied along with it for
        simplicity rather than filtering to PNG-only; BP Inspector
        itself reads its own JSON straight from raw-export directly
        and never depends on this copy existing).

    Runs FIRST, before every other section -- `build_items()`,
    `build_lore()`, and `build_sword_skills()` all check whether a
    specific texture file already exists under OUT (Content/ROD/) to
    decide `hasOfficialIcon`-style flags; if this section ran after
    them, every one of those checks would incorrectly report "no
    icon" on a fresh build, even for entries that genuinely have one.
    """
    import shutil
    copied_file_count = 0
    for rel_root in ["DataAssets/Items/Textures", "Widget"]:
        src = os.path.join(SRC, rel_root)
        dst = os.path.join(OUT, rel_root)
        if not os.path.isdir(src):
            print(f"  No {rel_root}/ found in raw-export -- skipping.")
            continue
        shutil.copytree(src, dst, dirs_exist_ok=True)
        copied_file_count += sum(len(files) for _, _, files in os.walk(dst))
    print(f"  Textures: {copied_file_count} files copied from raw-export into Content/ROD/")
    return copied_file_count


def build_weapons():
    item_asset = load_json(os.path.join(SRC, "DataAssets/Items/ItemDataAsset.json"))
    props = item_asset[0]["Properties"]

    ability_score_raw = props["AbilityScoreDataAsMap"]
    ability_score = {}
    for entry in ability_score_raw:
        v = entry["Value"]
        ability_score[v["AbilityValue"]] = {r: v[r] for r in RANK_ORDER}

    class_table_raw = props["ClassTableDataAsMap"]
    class_table = {}
    for entry in class_table_raw:
        v = entry["Value"]
        rank = strip_enum(v["Class"])
        class_table[rank] = {
            "refiningCost": v["RefiningCost"],
            "requiredCraftLv": v["RequiredCraftLv"],
            "enhancementCost": v["EnhancementCost"],
            "sellAmount": v["SellAmount"],
            "requiredEnhanceEXP": v["RequiredEnhanceEXP"],
            "grantEnhanceEXP": v["GrantEnhanceEXP"],
        }

    save_json(os.path.join(OUT, "DataAssets/Parameters/AbilityScoreTable.json"), ability_score)
    save_json(os.path.join(OUT, "DataAssets/Parameters/ClassTable.json"), class_table)

    all_weapons = {}
    category_index = {}

    for cat_key, cfg in WEAPON_CATEGORIES.items():
        items = props[cfg["itemMap"]]
        enhancements = {e["Key"]: e["Value"] for e in props[cfg["enhMap"]]}

        weapon_list = []
        for entry in items:
            item_id = entry["Key"]
            v = entry["Value"]
            enh = enhancements.get(item_id, {})

            weapon = {
                "id": v["ID"],
                "itemKey": v["ItemKey"],
                "category": cat_key,
                "categoryLabel": cfg["label"],
                "assetPrefix": cfg["prefix"],
                "weaponTypeId": v.get("WeaponTypeID"),
                "strikeType": strip_enum(v.get("WeaponStrikeType")),
                "rank": strip_enum(v.get("Class")),
                "grade": v.get("Grade"),
                "modNames": v.get("ModNames", []),
                "texSize": v.get("TexSize"),
                "iconId": v.get("IconID"),
                "descriptionKey": v.get("DescriptionKey"),
                "buyAmount": v.get("BuyAmount"),
                "sellAmount": v.get("SellAmount"),
                "canBuyAndSell": v.get("CanBuyAndSell"),
                "dropGimmick": strip_enum(v.get("DropGimmick")),
                "productionMODLotteryKey": v.get("ProductionMODLotteryKey"),
                "dropMODLotteryKey": v.get("DropMODLotteryKey"),
                "treasureMODLotteryKey": v.get("TreasureMODLotteryKey"),
                "textures": derive_texture_set(cfg["prefix"], v["ID"]),
                "enhancement": {
                    "baseWeaponATK": enh.get("BaseWeaponATK", []),
                    "abilityCorrectionRank": {
                        "STR": [strip_enum(r) for r in enh.get("AbilityCorrectionRankSTR", [])],
                        "DEX": [strip_enum(r) for r in enh.get("AbilityCorrectionRankDEX", [])],
                        "AGI": [strip_enum(r) for r in enh.get("AbilityCorrectionRankAGI", [])],
                        "INT": [strip_enum(r) for r in enh.get("AbilityCorrectionRankINT", [])],
                    },
                },
                # Rank shown at +0 enhancement (the rank can shift at higher
                # enhancement tiers -- e.g. DEX RankB -> RankA past +17 on some
                # weapons. The calculator must read the full per-tier array
                # above for accurate ACV at higher enhancement levels; this
                # field is only a convenient +0 display default.
                "acvRankBase": {
                    "STR": strip_enum((enh.get("AbilityCorrectionRankSTR") or ["EClassRank::None"])[0]),
                    "DEX": strip_enum((enh.get("AbilityCorrectionRankDEX") or ["EClassRank::None"])[0]),
                    "AGI": strip_enum((enh.get("AbilityCorrectionRankAGI") or ["EClassRank::None"])[0]),
                    "INT": strip_enum((enh.get("AbilityCorrectionRankINT") or ["EClassRank::None"])[0]),
                },
            }
            weapon_list.append(weapon)
            all_weapons[v["ItemKey"]] = weapon

        weapon_list.sort(key=lambda w: w["id"])
        save_json(os.path.join(OUT, f"DataAssets/Items/Weapons/{cat_key}.json"), weapon_list)
        category_index[cat_key] = {
            "label": cfg["label"],
            "prefix": cfg["prefix"],
            "count": len(weapon_list),
            "file": f"DataAssets/Items/Weapons/{cat_key}.json",
        }

    save_json(os.path.join(OUT, "DataAssets/Items/Weapons/_index.json"), category_index)
    return all_weapons


def derive_armor_texture_set(cat_key, cfg, item_id):
    """
    Same derivation approach as derive_texture_set() for weapons, but
    armor has extra wrinkles confirmed directly from the files on disk:
      1. Upper/Lower/Glove thumbnails are gendered (_Male/_Female suffix);
         Shield and the database-size thumbnail are not.
      2. The thumbnail SUBFOLDER is always named after the category key
         (e.g. ".../Thumbnails/Shield/"), but Shield's FILENAME prefix
         inside that folder is "S", not "Shield" -- confirmed on disk:
         Thumbnails/Shield/T_Item_Thumbnail_S3.png. The full-size category
         placeholder render also uses the short "S" prefix.
      3. Shield's DATABASE thumbnail prefix is "Shield" (matching the
         folder name), not "S" -- a real inconsistency in the game's own
         export between the two icon systems, not a bug in this code.
    """
    tex_prefix = cfg["texPrefix"]
    db_prefix = cfg["dbTexPrefix"]
    override_id = ARMOR_TEXTURE_OVERRIDES.get((cat_key, item_id), item_id)
    key = f"{tex_prefix}{override_id}"
    db_key = f"{db_prefix}{override_id}"

    if cfg["gendered"]:
        return {
            "iconMale": f"Content/ROD/DataAssets/Items/Textures/Thumbnails/{cat_key}/T_Item_Thumbnail_{key}_Male.png",
            "iconFemale": f"Content/ROD/DataAssets/Items/Textures/Thumbnails/{cat_key}/T_Item_Thumbnail_{key}_Female.png",
            "iconSmallMale": f"Content/ROD/DataAssets/Items/Textures/Thumbnails/{cat_key}/T_Item_Thumbnail_S_{key}_Male.png",
            "iconSmallFemale": f"Content/ROD/DataAssets/Items/Textures/Thumbnails/{cat_key}/T_Item_Thumbnail_S_{key}_Female.png",
            "iconDatabase": f"Content/ROD/Widget/Database/Thumbnail/Equipment/T_Database_Thumbnail_Equipment_{db_key}.png",
            "categoryPlaceholderRender": f"Content/ROD/DataAssets/Items/Textures/T_Item_{tex_prefix}1.png",
        }
    return {
        "icon": f"Content/ROD/DataAssets/Items/Textures/Thumbnails/{cat_key}/T_Item_Thumbnail_{key}.png",
        "iconSmall": f"Content/ROD/DataAssets/Items/Textures/Thumbnails/{cat_key}/T_Item_Thumbnail_S_{key}.png",
        "iconDatabase": f"Content/ROD/Widget/Database/Thumbnail/Equipment/T_Database_Thumbnail_Equipment_{db_key}.png",
        "categoryPlaceholderRender": f"Content/ROD/DataAssets/Items/Textures/T_Item_{tex_prefix}1.png",
    }


def build_armor():
    item_asset = load_json(os.path.join(SRC, "DataAssets/Items/ItemDataAsset.json"))
    props = item_asset[0]["Properties"]

    all_armor = {}
    category_index = {}

    for cat_key, cfg in ARMOR_CATEGORIES.items():
        items = props[cfg["itemMap"]]
        armor_list = []

        for entry in items:
            v = entry["Value"]
            item_id_full = v.get("ID")
            if item_id_full is None or item_id_full < 0:
                continue  # skip the -1 placeholder/empty-slot entries

            item_key = v["ItemKey"]
            # The simplified numeric suffix on ItemKey (e.g. "ItemName_Upper_3"
            # -> 3) is what textures are actually named after -- the padded
            # `ID` field (e.g. 3001) is an internal slot id, not a texture
            # index. Confirmed against files on disk for every category.
            try:
                simple_id = int(item_key.rsplit("_", 1)[-1])
            except ValueError:
                simple_id = item_id_full

            armor = {
                "id": item_id_full,
                "simpleId": simple_id,
                "itemKey": item_key,
                "category": cat_key,
                "categoryLabel": cfg["label"],
                "rank": strip_enum(v.get("Class")),
                "grade": v.get("Grade"),
                "def": v.get("Def") if cfg["hasDef"] else None,
                "modNames": v.get("ModNames", []),
                "descriptionKey": v.get("DescriptionKey"),
                "buyAmount": v.get("BuyAmount"),
                "sellAmount": v.get("SellAmount"),
                "canBuyAndSell": v.get("CanBuyAndSell"),
                "textures": derive_armor_texture_set(cat_key, cfg, simple_id),
            }
            armor_list.append(armor)
            all_armor[item_key] = armor

        armor_list.sort(key=lambda a: a["simpleId"])
        save_json(os.path.join(OUT, f"DataAssets/Items/Equipment/{cat_key}.json"), armor_list)
        category_index[cat_key] = {
            "label": cfg["label"],
            "count": len(armor_list),
            "hasDef": cfg["hasDef"],
            "gendered": cfg["gendered"],
            "file": f"DataAssets/Items/Equipment/{cat_key}.json",
        }

    save_json(os.path.join(OUT, "DataAssets/Items/Equipment/_index.json"), category_index)
    return all_armor


# SubCategory (from DT_ItemDatabase.json, the in-game Database menu's
# OWN list) -> {itemMap (ItemDataAsset.json's matching bucket),
# texPrefix (small in-world icon), dbTexPrefix (large database
# thumbnail), label}. Confirmed against the user's 3 reference
# screenshots: DT_ItemDatabase.json's SubCategory has exactly 3 values
# (UsableItem/Material/KeyItem), matching the Consumables/Materials/
# Key Items tabs shown there -- this is genuinely the authoritative
# list for what the Database menu shows, NOT ItemDataAsset.json's
# broader inventory-system categories (which also include Col/Sphere/
# Heal singletons that don't appear in the Database menu at all, and
# which include items the Database menu doesn't, see ITEM_DB_EXCEPTIONS
# below).
ITEM_CATEGORIES = {
    "Usable": {
        "itemMap": "UseItemDataAsMap",
        "dbSubCategory": "EDatabaseSubCategory::UsableItem",
        "texPrefix": "U",
        "dbTexPrefix": "Usable",
        "label": "Consumables",
    },
    "Material": {
        "itemMap": "MaterialItemDataAsMap",
        "dbSubCategory": "EDatabaseSubCategory::Material",
        "texPrefix": "M",
        "dbTexPrefix": "Material",
        "label": "Materials",
    },
    "KeyItem": {
        "itemMap": "KeyItemDataAsMap",
        "dbSubCategory": "EDatabaseSubCategory::KeyItem",
        "texPrefix": "KeyItem",
        "dbTexPrefix": "KeyItem",
        "label": "Key Items",
    },
}

# Items that exist in ItemDataAsset.json (the inventory-system data)
# but are NOT registered in DT_ItemDatabase.json (the in-game Database
# menu) at all -- confirmed by a direct set comparison before this was
# written, not assumed. "Hand Mirror" (Usable #73) is the only such
# Usable; 11 KeyItems are also missing this way (#1, 3, 4, 5, 8, 35-40
# -- a mix of quest-specific items like "Iori's Col"/"Thieves' Treasure",
# unnamed/cut-content slots, and two that resolve to dynamic
# substitution TEMPLATE strings like "{Rep_ItemName_Material_44}"
# rather than real standalone item names).
#
# Per the user's direction: the Database menu's own list
# (DT_ItemDatabase.json) is the authoritative source for what this
# section shows -- so the 11 KeyItems are simply excluded the normal
# way (they were never in the authoritative list to begin with). Hand
# Mirror specifically gets special handling: it's still shown, but
# explicitly flagged as a Database-menu exception rather than either
# silently dropped (which would discard a real, fully-described,
# fully-named item) or silently included as if it were a normal
# Database entry (which would misrepresent something genuinely
# different about it).
ITEM_DB_EXCEPTIONS_SHOWN_ANYWAY = {"Usable": [73]}


def build_sword_skills():
    """
    Equipment > Sword Skills -- the player's own per-weapon-category
    combat techniques, distinct from Partners' Combination Slash/
    Support Skill (already built under Characters) and from Active
    Skills (Recovery/Search/etc., not built here -- see the module
    docstring note below).

    Source: DataAssets/Items/Weapons/SwordSkill/DT_SwordSkillList_
    {Category}.json, one file per WEAPON_CATEGORIES key (reusing the
    exact same category dict Weapons itself uses, confirmed by the
    DT files' own ID-prefix convention: 01=OneHandedSword, 02=Rapier,
    03=Dagger, 04=Mace, 05=TwoHandedSword, 06=Axe -- matching
    WEAPON_CATEGORIES' prefix order exactly).

    Each category's row list mixes three genuinely different things.
    Distinguishing "real" from "filler" is NOT a fixed numeric ID
    range -- an early version of this builder assumed *_001-*_010
    was always the real range and *_011+ was always padding, and
    testing directly disproved that for Axe specifically (see below)
    before this shipped:
      - ID *_000: a "Counter" technique, one per category, confirmed
        present in every one of the 6 files. ALWAYS included by ID
        alone, regardless of its internal SwordSkillName string --
        5 of 6 use a CounterSlash{Category}-style name (Mace's is
        actually "CounterSlashAxe", a real, faithfully-preserved
        naming quirk in the game's own data), but TwoHandedSword's is
        "NoNameTHS00" -- a real, consistently-present mechanic that
        happens to LOOK like a placeholder by name alone, which is
        exactly why ID position, not name pattern, is what decides
        this one slot. NONE of the 6 have an official localized name,
        description, or icon anywhere in this export -- shown anyway
        with an honest "no official name found" fallback.
      - Numbered rows whose internal name does NOT start with
        "PlaceHolder" or "NoName": the real, intentional skill slots.
        60 of these resolve a full official name+description via
        SwordSkillName_{ID}/SwordSkillDescription_{ID} in
        ST_GeneralLocalizeList (60/60 coverage, matched 1:1, no
        orphans). One does NOT: Axe's *_006 ("Aftershock" internally)
        has a real DT row, a real icon (T_SwordSkill_WAX6.png exists),
        and is clearly not a placeholder by name -- but genuinely has
        no official name or description anywhere in this export.
        Shown honestly with the same "no official name found"
        fallback as the Counter skills, not silently dropped just
        because it broke the otherwise-clean *_001-*_010 pattern the
        other 5 categories follow.
      - Numbered rows whose internal name DOES start with
        "PlaceHolder" or "NoName" (excluding the *_000 slot, handled
        above): genuine unused padding. Excluded entirely -- same
        treatment as every other confirmed-unused numbered slot
        elsewhere in this project (e.g. the unnamed armor/weapon IDs).

    WeaponProficiency (0-10 on each real skill) is the per-skill
    unlock tier -- shown directly from this data, not computed. It is
    a SEPARATE progression track per weapon category (confirmed by the
    user directly, matching how the Player tab's own Weapon Proficiency
    slider was already scoped as informational/not-per-category-aware
    -- this builder doesn't change that scoping, just surfaces the
    real per-skill tier requirement honestly).

    Icon convention: T_SwordSkill_{prefix}{N}.png, where N is the
    skill ID's own numeric suffix (not a sequential 1st/2nd/3rd
    position) -- confirmed by Axe having 11 icons (WAX1-WAX11, not
    the 10 every other category has), directly matching its 11 real
    numbered rows (*_001 through *_011, including the unnamed
    Aftershock at *_006) rather than a clean 1-10 range. No icon
    exists for the *_000 Counter entries in this
    this export (confirmed: the icon set is exactly 60 files, WOS1-10/
    WRA1-10/WDA1-10/WMA1-10/WTS1-10/WAX1-10, no "*0" variant).
    """
    def load_dt_rows(category):
        prefix = WEAPON_CATEGORIES[category]["prefix"]
        path = os.path.join(SRC, f"DataAssets/Items/Weapons/SwordSkill/DT_SwordSkillList_{category}.json")
        d = load_json(path)
        return d[0]["Rows"], prefix

    general_en = load_official_strings("en")
    all_skills = []
    category_index = {}
    missing_icon_ids = []

    for cat_key, cat_cfg in WEAPON_CATEGORIES.items():
        rows, prefix = load_dt_rows(cat_key)
        cat_skills = []
        for row in rows.values():
            skill_id = row["ID"]  # e.g. "01_007"
            num = int(skill_id.split("_")[1])
            is_counter = skill_id.endswith("_000")
            # Real content is identified by ID pattern + internal-name
            # pattern together, NOT a fixed numeric range -- Axe's real
            # skill set turned out to be *_001 through *_005 plus
            # *_007 through *_011 (skipping *_006, which is real but
            # genuinely unnamed -- see below), not a clean *_001-*_010
            # range the other 5 categories happen to follow. The *_000
            # Counter skill is ALWAYS included regardless of its
            # internal name, since some categories (TwoHandedSword)
            # happen to use a "NoName..."-prefixed internal name for an
            # otherwise perfectly real, consistently-present mechanic --
            # confirmed by ID position alone, not by name pattern, for
            # that one specific slot.
            is_true_placeholder = (not is_counter) and (
                row["SwordSkillName"].startswith("PlaceHolder") or row["SwordSkillName"].startswith("NoName")
            )
            if is_true_placeholder:
                continue

            name_key = f"SwordSkillName_{skill_id}"
            desc_key = f"SwordSkillDescription_{skill_id}"
            official_name = general_en.get(name_key)
            official_desc = general_en.get(desc_key)

            if is_counter:
                icon_key = None
            else:
                icon_rel = f"Widget/Common/IconImage/SkillIconImages/SwordSkill/T_SwordSkill_{prefix}{num}.png"
                icon_full = os.path.join(OUT, icon_rel)
                icon_key = f"Content/ROD/{icon_rel}" if os.path.exists(icon_full) else None
                if icon_key is None:
                    missing_icon_ids.append(f"{cat_key} {skill_id}")

            skill = {
                "id": skill_id,
                "category": cat_key,
                "categoryLabel": cat_cfg["label"],
                "internalName": row["SwordSkillName"],  # preserved as-is, including known quirks like Mace's "CounterSlashAxe"
                "nameKey": name_key,
                "descriptionKey": desc_key,
                "hasOfficialName": official_name is not None,
                "weaponProficiency": row["WeaponProficiency"],
                "soulCost": row["Decrease_Soul"],
                "isCounterSkill": is_counter,
                "textures": {"icon": icon_key},
            }
            cat_skills.append(skill)
            all_skills.append(skill)

        cat_skills.sort(key=lambda s: int(s["id"].split("_")[1]))
        category_index[cat_key] = {
            "label": cat_cfg["label"],
            "prefix": cat_cfg["prefix"],
            "count": len(cat_skills),
            "namedCount": sum(1 for s in cat_skills if s["hasOfficialName"]),
        }

    save_json(os.path.join(OUT, "DataAssets/Items/Weapons/SwordSkills/SwordSkills.json"), all_skills)
    save_json(os.path.join(OUT, "DataAssets/Items/Weapons/SwordSkills/_index.json"), {
        "count": len(all_skills),
        "namedCount": sum(1 for s in all_skills if s["hasOfficialName"]),
        "byCategory": category_index,
        "missingIcons": missing_icon_ids,
        "file": "DataAssets/Items/Weapons/SwordSkills/SwordSkills.json",
    })
    print(f"  Sword Skills: {len(all_skills)} total ({sum(1 for s in all_skills if s['hasOfficialName'])} named), across {len(WEAPON_CATEGORIES)} weapon categories")
    if missing_icon_ids:
        print(f"    missing icons: {missing_icon_ids}")
    return all_skills


def build_sword_skill_localization(all_skills):
    """
    Per-language name/description for every Sword Skill -- resolved
    from SwordSkillName_{id} / SwordSkillDescription_{id} in each
    language's own ST_GeneralLocalizeList (the same table Items/
    Recipes/Lore all draw from). No {Rep_X}-template substitution
    needed here, unlike Lore/Quests/Recipes -- these are plain strings.

    Manifest shape matches every other category's localization builder
    exactly (flat dict keyed by lang_code, each with label/file/
    verifiedCount/describedCount/totalCount/hasOfficialSource, plus
    top-level _defaultLanguage/_gameLaunchDate) -- an earlier version
    of this function used a different, incompatible {"_languages": {}}
    shape that would have silently failed to load in the frontend
    (missing the "file" field entirely). Caught before shipping by
    checking Lore's actual manifest file byte-for-byte rather than
    assuming the shape from memory.
    """
    loc_dir = os.path.join(OUT, "DataAssets/Items/Weapons/SwordSkills/Localization")
    english_general = load_official_strings(DEFAULT_LANGUAGE)
    manifest = {}
    summary_lines = []

    for lang_code, lang_label in SUPPORTED_LANGUAGES.items():
        general_strings = load_official_strings(lang_code)
        loc_path = os.path.join(loc_dir, f"{lang_code}.json")
        entries = load_json(loc_path) if os.path.exists(loc_path) else {}

        for skill in all_skills:
            skill_id = skill["id"]
            if skill_id in entries:
                continue  # hand-maintained: never overwrite an existing entry

            name, name_verified, name_source = skill_id, False, None
            if skill["nameKey"] in general_strings:
                name, name_verified = general_strings[skill["nameKey"]], True
                name_source = "Official game localization (Game.json)"
            elif skill["nameKey"] in english_general:
                name, name_verified = english_general[skill["nameKey"]], True
                name_source = f"Fallback to English (no {lang_code} translation found)"

            description, desc_verified, desc_source = "", False, None
            if skill["descriptionKey"] in general_strings:
                description, desc_verified = general_strings[skill["descriptionKey"]], True
                desc_source = "Official game localization (Game.json)"
            elif skill["descriptionKey"] in english_general:
                description, desc_verified = english_general[skill["descriptionKey"]], True
                desc_source = f"Fallback to English (no {lang_code} translation found)"

            entries[skill_id] = {
                "name": name,
                "verified": bool(name_verified),
                "source": name_source,
                "description": description,
                "descriptionVerified": bool(desc_verified),
                "descriptionSource": desc_source,
            }

        save_json(loc_path, entries)
        verified_count = sum(1 for v in entries.values() if v["verified"])
        described_count = sum(1 for v in entries.values() if v["descriptionVerified"])
        manifest[lang_code] = {
            "label": lang_label,
            "file": f"DataAssets/Items/Weapons/SwordSkills/Localization/{lang_code}.json",
            "verifiedCount": verified_count,
            "describedCount": described_count,
            "totalCount": len(entries),
            "hasOfficialSource": len(general_strings) > 0,
        }
        summary_lines.append(
            f"    {lang_code} ({lang_label}): {verified_count}/{len(entries)} named, "
            f"{described_count}/{len(entries)} described"
        )

    manifest["_defaultLanguage"] = DEFAULT_LANGUAGE
    manifest["_gameLaunchDate"] = GAME_LAUNCH_DATE
    save_json(os.path.join(loc_dir, "_manifest.json"), manifest)

    print(f"  Sword Skill localization: {len(all_skills)} skills x {len(SUPPORTED_LANGUAGES)} languages")
    for line in summary_lines:
        print(line)


def build_items():
    """
    Builds the flat, app-ready item list for Consumables/Materials/Key
    Items, sourced from DT_ItemDatabase.json for WHICH items belong in
    each category (matching the in-game Database menu exactly) and
    ItemDataAsset.json for the actual per-item fields (rarity, icon
    paths, stack size, buy/sell, etc. -- DT_ItemDatabase.json itself
    only has identity + description-key fields, no item stats at all).

    RarelityID (ItemRarelity_C/B/A confirmed across all items -- no D
    or S tier seen) is converted to the same RankX format weapon/armor
    rank already uses, so the existing rankBadgeImg()/rankShort()/
    rankColor() JS helpers work unmodified -- this is genuinely the
    same D/C/B/A/S concept under a different field name, not a
    separate rarity system needing its own UI.
    """
    item_asset = load_json(os.path.join(SRC, "DataAssets/Items/ItemDataAsset.json"))
    asset_props = item_asset[0]["Properties"]

    item_db = load_json(os.path.join(SRC, "DataAssets/Database/DT_ItemDatabase.json"))
    db_rows = item_db[0]["Rows"]

    all_items = {}
    category_index = {}

    for cat_key, cfg in ITEM_CATEGORIES.items():
        # Build a lookup of this category's ItemDataAsset entries by
        # numeric ID, so we can cross-reference DT_ItemDatabase.json's
        # row order/membership against the actual item record fields.
        asset_by_id = {int(e["Key"]): e["Value"] for e in asset_props[cfg["itemMap"]]}

        # WHICH items belong in this category, per the Database menu's
        # OWN list -- this naturally excludes anything not registered
        # there (see ITEM_DB_EXCEPTIONS_SHOWN_ANYWAY above).
        db_ids_in_order = [
            int(v["DatabaseTitleID"]) for v in db_rows.values()
            if v.get("SubCategory") == cfg["dbSubCategory"]
        ]
        # Plus any explicitly-approved exception (currently just Hand
        # Mirror), appended at the end so it's visually distinguishable
        # as an addition rather than blending into the authoritative
        # list's own ordering.
        extra_ids = ITEM_DB_EXCEPTIONS_SHOWN_ANYWAY.get(cat_key, [])
        all_ids = db_ids_in_order + [i for i in extra_ids if i not in db_ids_in_order]

        # The category placeholder render (shown when a SPECIFIC item's
        # own database thumbnail is missing) must itself point at a
        # thumbnail that actually exists on disk -- it can't just
        # assume item ID 1 has one. Confirmed before this was written:
        # KeyItem specifically is missing 11 of 40 thumbnails INCLUDING
        # ID 1 itself, so a naive "{prefix}1.png" placeholder would
        # point at a file that doesn't exist either. This picks the
        # first ID in this category's own list whose thumbnail file is
        # actually present.
        placeholder_id = next(
            (i for i in all_ids if os.path.exists(os.path.join(
                OUT, "Widget/Database/Thumbnail/Items",
                f"T_Database_Thumbnail_Items_{cfg['dbTexPrefix']}{i}.png"
            ))),
            all_ids[0] if all_ids else 1,  # last-resort fallback if EVERY thumbnail in a category were missing
        )
        category_placeholder = f"Content/ROD/Widget/Database/Thumbnail/Items/T_Database_Thumbnail_Items_{cfg['dbTexPrefix']}{placeholder_id}.png"

        item_list = []
        missing_db_thumbnails = []
        missing_from_item_data = []
        for item_id in all_ids:
            v = asset_by_id.get(item_id)
            db_thumb_filename = f"T_Database_Thumbnail_Items_{cfg['dbTexPrefix']}{item_id}.png"
            db_thumb_exists = os.path.exists(os.path.join(OUT, "Widget/Database/Thumbnail/Items", db_thumb_filename))
            if not db_thumb_exists:
                missing_db_thumbnails.append(item_id)

            if v is None:
                # CONFIRMED REAL GAP, not a bug: a handful of items are
                # referenced by DT_ItemDatabase.json (the Database
                # menu's own list) but have NO matching record in
                # ItemDataAsset.json (the inventory-system stats data)
                # at all -- e.g. KeyItem 41-45 (Teleport/Healing/Holo
                # Crystal, etc. -- the user's own reference screenshot's
                # Key Items tab is made up ENTIRELY of these). No rank,
                # stack size, or buy/sell data exists anywhere in this
                # export for these -- confirmed by checking
                # DatabaseDataAsset.json's parallel copy of the same
                # rows too, not just assumed absent. Earlier versions of
                # this function silently dropped these via `continue`,
                # which would have excluded exactly the items in the
                # screenshot -- fixed to build a minimal honest record
                # instead of pretending the gap doesn't exist OR hiding
                # the item entirely.
                missing_from_item_data.append(item_id)
                item_key = f"ItemName_{cat_key}_{item_id}"
                item = {
                    "id": item_id,
                    "itemKey": item_key,
                    "category": cat_key,
                    "categoryLabel": cfg["label"],
                    "rank": None,
                    "maxStack": None,
                    "buyAmount": None,
                    "sellAmount": None,
                    "canBuyAndSell": None,
                    "isDatabaseException": item_id in extra_ids and item_id not in db_ids_in_order,
                    "hasDatabaseThumbnail": db_thumb_exists,
                    "missingFromItemDataAsset": True,
                    "textures": {
                        "iconSmall": f"Content/ROD/Widget/Database/Thumbnail/Items/{db_thumb_filename}",
                        "iconDatabase": f"Content/ROD/Widget/Database/Thumbnail/Items/{db_thumb_filename}",
                        "categoryPlaceholderRender": category_placeholder,
                    },
                }
                item_list.append(item)
                all_items[item_key] = item
                continue

            item_key = v["ItemKey"]
            rank = "Rank" + strip_enum(v.get("RarelityID", "")).replace("ItemRarelity_", "")

            thumb_path = v.get("ThumbnailTexture", {}).get("AssetPathName")
            icon_small = asset_path_to_texture_key(thumb_path) if thumb_path else None

            item = {
                "id": item_id,
                "itemKey": item_key,
                "category": cat_key,
                "categoryLabel": cfg["label"],
                "rank": rank,
                "maxStack": v.get("MaxStack"),
                "buyAmount": v.get("BuyAmount"),
                "sellAmount": v.get("SellAmount"),
                "canBuyAndSell": v.get("CanBuyAndSell"),
                "isDatabaseException": item_id in extra_ids and item_id not in db_ids_in_order,
                "hasDatabaseThumbnail": db_thumb_exists,
                "missingFromItemDataAsset": False,
                "textures": {
                    "iconSmall": icon_small or f"Content/ROD/DataAssets/Items/Textures/T_Item_{cfg['texPrefix']}{item_id}.png",
                    "iconDatabase": f"Content/ROD/Widget/Database/Thumbnail/Items/{db_thumb_filename}",
                    "categoryPlaceholderRender": category_placeholder,
                },
            }
            item_list.append(item)
            all_items[item_key] = item

        save_json(os.path.join(OUT, f"DataAssets/Items/Catalog/{cat_key}.json"), item_list)
        category_index[cat_key] = {
            "label": cfg["label"],
            "count": len(item_list),
            "file": f"DataAssets/Items/Catalog/{cat_key}.json",
            "missingDatabaseThumbnails": missing_db_thumbnails,
            "missingFromItemDataAsset": missing_from_item_data,
        }
        if missing_db_thumbnails:
            print(f"    {cfg['label']}: {len(missing_db_thumbnails)} missing database thumbnail(s) (IDs: {missing_db_thumbnails})")
        if missing_from_item_data:
            print(f"    {cfg['label']}: {len(missing_from_item_data)} item(s) in the Database menu with NO stats record in ItemDataAsset.json (IDs: {missing_from_item_data})")

    save_json(os.path.join(OUT, "DataAssets/Items/Catalog/_index.json"), category_index)
    return all_items


def build_item_localization(all_items):
    """
    Build Content/ROD/DataAssets/Items/Catalog/Localization/{lang}.json
    -- per-language name + TWO description fields for every item.

    Confirmed by direct inspection before this was written: items have
    a genuinely different description structure than weapons/armor/
    monsters -- TWO separate paragraphs, sourced from two DIFFERENT
    string tables:
      1. "description" (mechanical effect text, e.g. "Recovers 100 HP
         for the user over 10 seconds.") -- ItemDescription_{key} in
         ST_GeneralLocalizeList, the SAME table/pattern weapons/armor
         use for their single description.
      2. "flavorText" (Database-menu-only lore/flavor text, e.g. "Must-
         have medicine for any budding adventurer...") -- the item's
         resolved DatabaseText_Item_{key}_{slot} key in
         ST_DatabaseLocalizeList -- the SAME table monsters use for
         their description, but here it's an ADDITIONAL second
         paragraph, not the only one.

    Confirmed by counting before this was written: only 60 of 147
    Database-menu items have a populated flavorText at all (the rest
    resolve to the literal string "None" in every language) -- the
    user's 3 reference screenshots show this exact pattern (Healing
    Potion has both paragraphs, Emerald and Teleport Crystal have only
    the first). flavorText is therefore genuinely optional per item,
    while description is present for nearly every item the same way
    weapon/armor descriptions are.

    Same fallback-to-English, verified-until-GAME_LAUNCH_DATE, and
    hand-edits-never-overwritten policies as every other localization
    builder in this file.
    """
    loc_dir = os.path.join(OUT, "DataAssets/Items/Catalog/Localization")
    english_general = load_official_strings(DEFAULT_LANGUAGE)

    def load_database_strings(lang_code):
        path = os.path.join(SRC, "Localization", "Game", lang_code, "Game.json")
        if not os.path.exists(path):
            return {}
        return load_json(path).get("ST_DatabaseLocalizeList", {})

    english_database = load_database_strings(DEFAULT_LANGUAGE)

    # Resolve each item's flavor-text lookup key ONCE here (not per
    # language) -- this requires walking DT_ItemDatabase.json's rows
    # again, the same DatabaseInfo[0] pattern monsters use (always
    # exactly one populated slot per row, gated on Get/MainProgress).
    item_db = load_json(os.path.join(SRC, "DataAssets/Database/DT_ItemDatabase.json"))
    db_rows = item_db[0]["Rows"]
    flavor_text_key_by_item_key = {}
    for v in db_rows.values():
        title_key = v.get("DatabaseTitleKey")
        for info in v.get("DatabaseInfo", []):
            if info.get("DatabaseTextKey") not in (None, "None"):
                flavor_text_key_by_item_key[title_key] = info["DatabaseTextKey"]
                break

    manifest = {}
    summary_lines = []

    for lang_code, lang_label in SUPPORTED_LANGUAGES.items():
        loc_path = os.path.join(loc_dir, f"{lang_code}.json")
        existing = load_json(loc_path) if os.path.exists(loc_path) else {}
        general_strings = load_official_strings(lang_code)
        database_strings = load_database_strings(lang_code)

        entries = dict(existing)
        for item_key in all_items:
            if item_key in entries:
                continue  # hand-maintained: never overwrite an existing entry

            name_key = item_key
            desc_key = item_key.replace("ItemName_", "ItemDescription_", 1)

            name, name_verified, name_source = "", False, None
            if name_key in general_strings:
                name, name_verified = general_strings[name_key], True
                name_source = "Official game localization (Game.json)"
            elif name_key in english_general:
                name, name_verified = english_general[name_key], True
                name_source = f"Fallback to English (no {lang_code} translation found)"

            description, desc_verified, desc_source = "", False, None
            if desc_key in general_strings:
                description, desc_verified = general_strings[desc_key], True
                desc_source = "Official game localization (Game.json)"
            elif desc_key in english_general:
                description, desc_verified = english_general[desc_key], True
                desc_source = f"Fallback to English (no {lang_code} translation found)"

            flavor_text, flavor_verified, flavor_source = "", False, None
            flavor_key = flavor_text_key_by_item_key.get(item_key)
            if flavor_key:
                if flavor_key in database_strings and database_strings[flavor_key] not in (None, "None"):
                    flavor_text, flavor_verified = database_strings[flavor_key], True
                    flavor_source = "Official game localization (Game.json)"
                elif flavor_key in english_database and english_database[flavor_key] not in (None, "None"):
                    flavor_text, flavor_verified = english_database[flavor_key], True
                    flavor_source = f"Fallback to English (no {lang_code} translation found)"

            entries[item_key] = {
                "name": name,
                "verified": bool(name_verified),
                "source": name_source,
                "description": description,
                "descriptionVerified": bool(desc_verified),
                "descriptionSource": desc_source,
                "flavorText": flavor_text,
                "flavorTextVerified": bool(flavor_verified),
                "flavorTextSource": flavor_source,
            }

        save_json(loc_path, entries)
        verified_count = sum(1 for v in entries.values() if v["verified"])
        described_count = sum(1 for v in entries.values() if v["descriptionVerified"])
        flavor_count = sum(1 for v in entries.values() if v["flavorTextVerified"])
        manifest[lang_code] = {
            "label": lang_label,
            "file": f"DataAssets/Items/Catalog/Localization/{lang_code}.json",
            "verifiedCount": verified_count,
            "describedCount": described_count,
            "flavorTextCount": flavor_count,
            "totalCount": len(entries),
            "hasOfficialSource": len(general_strings) > 0,
        }
        summary_lines.append(
            f"    {lang_code} ({lang_label}): {verified_count}/{len(entries)} named, "
            f"{described_count}/{len(entries)} described, {flavor_count}/{len(entries)} have flavor text"
        )

    manifest["_defaultLanguage"] = DEFAULT_LANGUAGE
    manifest["_gameLaunchDate"] = GAME_LAUNCH_DATE
    save_json(os.path.join(loc_dir, "_manifest.json"), manifest)

    print(f"  Item localization: {len(all_items)} items x {len(SUPPORTED_LANGUAGES)} languages")
    for line in summary_lines:
        print(line)
    return load_json(os.path.join(loc_dir, f"{DEFAULT_LANGUAGE}.json"))


# Maps each ItemDataAsset.json recipe field to: which weapon/armor
# category config to borrow texPrefix from (recipes follow the exact
# same small-icon prefix convention as the items they produce --
# confirmed: Shield's recipe icon is "T_Item_Recipe_S1.png", matching
# Shield's existing texPrefix="S" oddity, not "Recipe_Shield1"), the
# produced-item's key prefix (for resolving what this recipe actually
# crafts), and which localization namespace that produced item lives
# in ("weapon" = the same Items/Localization/ file weapons/armor
# share; "item" = Items/Catalog/Localization/, the Consumables/
# Materials/Key Items file).
RECIPE_CATEGORIES = {
    "Usable": {"itemMap": "UsableRecipeDataAsMap", "texPrefix": "U", "producedPrefix": "Usable", "producedNamespace": "item", "label": "Consumable Recipes"},
    "OneHandedSword": {"itemMap": "OneHandedSwordWeaponRecipeDataAsMap", "texPrefix": "WOS", "producedPrefix": "WOS", "producedNamespace": "weapon", "label": "One-Handed Sword Recipes"},
    "Rapier": {"itemMap": "RapierWeaponRecipeDataAsMap", "texPrefix": "WRA", "producedPrefix": "WRA", "producedNamespace": "weapon", "label": "Rapier Recipes"},
    "Dagger": {"itemMap": "DaggerWeaponRecipeDataAsMap", "texPrefix": "WDA", "producedPrefix": "WDA", "producedNamespace": "weapon", "label": "Dagger Recipes"},
    "Mace": {"itemMap": "MaceWeaponRecipeDataAsMap", "texPrefix": "WMA", "producedPrefix": "WMA", "producedNamespace": "weapon", "label": "Mace Recipes"},
    "TwoHandedSword": {"itemMap": "TwoHandedSwordWeaponRecipeDataAsMap", "texPrefix": "WTS", "producedPrefix": "WTS", "producedNamespace": "weapon", "label": "Two-Handed Sword Recipes"},
    "Axe": {"itemMap": "AxeWeaponRecipeDataAsMap", "texPrefix": "WAX", "producedPrefix": "WAX", "producedNamespace": "weapon", "label": "Axe Recipes"},
    "Upper": {"itemMap": "UpperRecipeDataAsMap", "texPrefix": "Upper", "producedPrefix": "Upper", "producedNamespace": "weapon", "label": "Upper Body Recipes"},
    "Lower": {"itemMap": "LowerRecipeDataAsMap", "texPrefix": "Lower", "producedPrefix": "Lower", "producedNamespace": "weapon", "label": "Lower Body Recipes"},
    "Glove": {"itemMap": "GloveRecipeDataAsMap", "texPrefix": "Glove", "producedPrefix": "Glove", "producedNamespace": "weapon", "label": "Glove Recipes"},
    "Shield": {"itemMap": "ShieldRecipeDataAsMap", "texPrefix": "S", "producedPrefix": "Shield", "producedNamespace": "weapon", "label": "Shield Recipes"},
}

# Matches the dynamic substitution template the game's OWN recipe name/
# description strings use, e.g. "{Rep_ItemName_WOS_1} Blueprint" or
# "Teaches you how to craft a {Rep_ItemName_Usable_1}." -- confirmed by
# direct inspection before this was written, NOT a placeholder Claude
# invented: recipe ItemKey/DescriptionKey strings are templates, not
# plain text, and the only reliable way to know what a recipe produces
# is to parse this template -- the numeric ItemData.ItemId field
# encodes the produced item's ID differently PER CATEGORY (confirmed:
# Upper/Lower/Glove use itemId = realId*1000+1, but Shield uses the
# plain realId with no encoding at all, and Usable's itemId happens to
# equal the recipe's own key, not the produced item's ID) -- so a
# formula-based approach was tried, found to be category-specific and
# unreliable, and abandoned in favor of parsing the template directly
# every time, which is unambiguous and uses the same value the game's
# own UI would substitute in.
RECIPE_TEMPLATE_PATTERN = re.compile(r"\{Rep_ItemName_(\w+?)_(-?\d+)\}")


def build_recipes():
    """
    Parses all 11 recipe maps in ItemDataAsset.json (245 total recipes:
    59 Usable + 21 each for the 6 weapon categories + 17/16/17/10 for
    Upper/Glove/Lower/Shield) into a flat, app-ready list grouped by
    what they craft.

    Recipes are NOT in any Database-menu file (DT_*Database.json) --
    confirmed by searching every Database file before this was written,
    not assumed. This is a toolkit-only, inventory-system-sourced
    section with no in-game "Database > Recipes" screen to match
    against, unlike Items/Lore/Characters which all had a real
    reference screenshot.

    For each recipe, resolves:
      - What it produces: by parsing the {Rep_ItemName_*} template
        embedded in its own name string (see RECIPE_TEMPLATE_PATTERN
        above for why a formula-based approach was abandoned), then
        cross-referencing the EXISTING weapon/armor/item localization
        DataStore.getDisplayName() / DataStore.getItemDisplayName()
        already uses -- no new localization table needed for "what
        this crafts," it's just a key reference resolved through
        sources that already exist and are already sourced/verified.
      - Materials needed: RecipeItems[], confirmed every single
        ingredient across all 245 recipes is ItemCategory_Material
        (679 ingredient entries checked, zero exceptions) -- resolved
        against the EXISTING Material item catalog the same way.
      - Col cost: the Col field directly (10-2500 range confirmed).
      - The recipe's OWN name/description (e.g. "Shortsword Blueprint"
        / "You can now create the Shortsword at the Smithy.") AND the
        PRODUCED ITEM's own name/description (e.g. "Shortsword" / "A
        small one-handed iron sword...") are both surfaced, per the
        user's explicit request for both -- these are genuinely
        different strings from different keys, not the same text
        shown twice.

    Coverage: 236/245 have a resolvable produced-item template; the 9
    that don't are recipes for armor pieces with no name anywhere in
    any export (Upper_30, Lower_99, Shield_37 -- the SAME already-known
    unnamed armor slots from the original armor-naming work, not a new
    gap -- confirmed by checking which IDs these 9 actually decode to
    before concluding this).
    """
    item_asset = load_json(os.path.join(SRC, "DataAssets/Items/ItemDataAsset.json"))
    asset_props = item_asset[0]["Properties"]
    english_general = load_official_strings(DEFAULT_LANGUAGE)

    recipe_list = []
    category_counts = {}

    for cat_key, cfg in RECIPE_CATEGORIES.items():
        count = 0
        for e in asset_props.get(cfg["itemMap"], []):
            v = e["Value"]
            recipe_key = e["Key"]
            recipe_item_key = v["ItemKey"]  # e.g. "ItemName_OneHandedSwordRecipe_1"
            recipe_desc_key = v["DescriptionKey"]

            # Parse the produced-item key out of the recipe's OWN name
            # template (English source -- the template's embedded key
            # is language-independent, it's the same {Rep_ItemName_*}
            # placeholder in every language file).
            name_template = english_general.get(recipe_item_key, "")
            m = RECIPE_TEMPLATE_PATTERN.search(name_template)
            produced_item_key = f"ItemName_{m.group(1)}_{m.group(2)}" if m else None

            materials = []
            for ri in v.get("RecipeItems", []):
                materials.append({
                    "itemKey": f"ItemName_Material_{ri['ItemId']}",
                    "quantity": ri.get("Num"),
                })

            thumb_path = v.get("ThumbnailTexture", {}).get("AssetPathName")
            icon = asset_path_to_texture_key(thumb_path) if thumb_path else None

            recipe = {
                "recipeKey": recipe_key,
                "itemKey": recipe_item_key,
                "descriptionKey": recipe_desc_key,
                "category": cat_key,
                "categoryLabel": cfg["label"],
                "producedItemKey": produced_item_key,
                "producedNamespace": cfg["producedNamespace"],
                "colCost": v.get("Col"),
                "materials": materials,
                "textures": {
                    "icon": icon or f"Content/ROD/DataAssets/Items/Textures/T_Item_Recipe_{cfg['texPrefix']}1.png",
                },
            }
            recipe_list.append(recipe)
            count += 1
        category_counts[cat_key] = count

    save_json(os.path.join(OUT, "DataAssets/Items/Recipes/Recipes.json"), recipe_list)
    save_json(os.path.join(OUT, "DataAssets/Items/Recipes/_index.json"), {
        "count": len(recipe_list),
        "categoryCounts": category_counts,
        "file": "DataAssets/Items/Recipes/Recipes.json",
    })

    return {r["itemKey"]: r for r in recipe_list}


def build_recipe_localization(all_recipes):
    """
    Build Content/ROD/DataAssets/Items/Recipes/Localization/{lang}.json
    -- per-language name + description for every recipe's OWN text
    (e.g. "Shortsword Blueprint" / "You can now create the Shortsword
    at the Smithy."), with the {Rep_ItemName_*} template SUBSTITUTED
    with the produced item's real, already-localized display name for
    THAT language -- not just the raw English key left in place. This
    means a German player sees "Kurzschwert Blueprint" with the German
    weapon name substituted in, not an untranslated English fragment.

    Substitution uses DataStore-equivalent lookups against the SAME
    weapon/armor or item localization files this pipeline already
    builds (build_localization() / build_item_localization()) -- this
    function must run AFTER both of those for every language's
    produced-item name to already exist when this resolves it.

    Coverage: 236/245 resolve a real produced-item template (see
    build_recipes() docstring for the 9 that don't and why). Of those
    236, the SUBSTITUTED name is only fully verified if the produced
    item's own name is ALSO verified in that language -- if the
    produced item has no name in a given language, the raw key is
    substituted instead (the same documented fallback the produced
    item's own getDisplayName already uses), and the recipe's name as
    a whole is marked unverified for that case, since showing
    "ItemName_WOS_37 Blueprint" isn't really verified prose.
    """
    loc_dir = os.path.join(OUT, "DataAssets/Items/Recipes/Localization")
    english_general = load_official_strings(DEFAULT_LANGUAGE)

    # Load every language's weapon/armor AND item localization once,
    # since recipe name substitution needs to check both namespaces
    # depending on what each recipe produces.
    weapon_armor_loc_dir = os.path.join(OUT, "DataAssets/Items/Localization")
    item_loc_dir = os.path.join(OUT, "DataAssets/Items/Catalog/Localization")

    def load_lang_file(loc_dir_path, lang_code):
        path = os.path.join(loc_dir_path, f"{lang_code}.json")
        return load_json(path) if os.path.exists(path) else {}

    manifest = {}
    summary_lines = []

    for lang_code, lang_label in SUPPORTED_LANGUAGES.items():
        loc_path = os.path.join(loc_dir, f"{lang_code}.json")
        existing = load_json(loc_path) if os.path.exists(loc_path) else {}
        general_strings = load_official_strings(lang_code)
        weapon_armor_loc = load_lang_file(weapon_armor_loc_dir, lang_code)
        item_loc = load_lang_file(item_loc_dir, lang_code)

        def resolve_produced_name(produced_key, namespace):
            if not produced_key:
                return None, False
            source_map = weapon_armor_loc if namespace == "weapon" else item_loc
            entry = source_map.get(produced_key)
            if entry and entry.get("name"):
                return entry["name"], bool(entry.get("verified"))
            return produced_key, False  # honest fallback to the raw key, same as every other category

        entries = dict(existing)
        for item_key, recipe in all_recipes.items():
            if item_key in entries:
                continue  # hand-maintained: never overwrite an existing entry

            raw_name_template = general_strings.get(item_key) or english_general.get(item_key, "")
            raw_desc_template = general_strings.get(recipe["descriptionKey"]) or english_general.get(recipe["descriptionKey"], "")
            name_is_fallback_lang = item_key not in general_strings and item_key in english_general

            produced_name, produced_verified = resolve_produced_name(recipe["producedItemKey"], recipe["producedNamespace"])

            def substitute(template):
                if not template or not produced_name:
                    return template
                return RECIPE_TEMPLATE_PATTERN.sub(produced_name, template)

            name = substitute(raw_name_template)
            description = substitute(raw_desc_template)
            # Verified only if BOTH the raw template string resolved
            # AND the substituted produced-item name is itself verified
            # -- a recipe name built from an unverified produced-item
            # name isn't genuinely verified prose, even if the template
            # string itself came from the official source.
            name_verified = bool(raw_name_template) and produced_verified and not name_is_fallback_lang
            desc_verified = bool(raw_desc_template) and produced_verified and not name_is_fallback_lang

            entries[item_key] = {
                "name": name or "",
                "verified": name_verified,
                "source": "Official game localization (Game.json), template-substituted with the produced item's name" if name else None,
                "description": description or "",
                "descriptionVerified": desc_verified,
                "descriptionSource": "Official game localization (Game.json), template-substituted with the produced item's name" if description else None,
            }

        save_json(loc_path, entries)
        verified_count = sum(1 for v in entries.values() if v["verified"])
        described_count = sum(1 for v in entries.values() if v["descriptionVerified"])
        manifest[lang_code] = {
            "label": lang_label,
            "file": f"DataAssets/Items/Recipes/Localization/{lang_code}.json",
            "verifiedCount": verified_count,
            "describedCount": described_count,
            "totalCount": len(entries),
            "hasOfficialSource": len(general_strings) > 0,
        }
        summary_lines.append(
            f"    {lang_code} ({lang_label}): {verified_count}/{len(entries)} named, "
            f"{described_count}/{len(entries)} described"
        )

    manifest["_defaultLanguage"] = DEFAULT_LANGUAGE
    manifest["_gameLaunchDate"] = GAME_LAUNCH_DATE
    save_json(os.path.join(loc_dir, "_manifest.json"), manifest)

    print(f"  Recipe localization: {len(all_recipes)} recipes x {len(SUPPORTED_LANGUAGES)} languages")
    for line in summary_lines:
        print(line)
    return load_json(os.path.join(loc_dir, f"{DEFAULT_LANGUAGE}.json"))


# EnemyType -> {label, count is computed at build time}. Mirrors
# ARMOR_CATEGORIES' role as the canonical category list + display
# labels, except monsters only have ONE flat DataTable (not one file
# per category like weapons/armor each have) -- the split into
# categories happens by filtering EnemyType after loading, not by
# reading from separate source files.
MONSTER_CATEGORIES = {
    "Beast": "Beast",
    "DemiHuman": "Demi-Human",
    "PlantInsect": "Plant/Insect",
    "Demon": "Demon",
}


def build_monsters():
    """
    Parses DT_MonsterDatabase.json (120 rows) into the same flat,
    app-ready shape weapons/armor use: one record per monster, grouped
    into a category index by EnemyType (Beast/DemiHuman/PlantInsect/
    Demon -- confirmed as the only 4 values across all 120 rows).

    UNLIKE weapons/armor, this export has NO per-monster combat stats
    (no level, HP, ATK, DEF anywhere in this file or any other --
    confirmed by an explicit search of every datatable in raw-export/
    before this was written) and NO per-monster image/texture
    reference (DatabaseImagetID is the literal placeholder "/ /_-1._-1"
    on all 120 rows, with zero exceptions -- monsters are 3D models
    shown in a live rotating viewer in-game, per the user's reference
    screenshot, not a 2D icon like every other category in this app).
    So this record is intentionally much thinner than a weapon/armor
    record: just identity (EnemyType, DatabaseTitleID) and whatever
    name/description localization resolves -- there is nothing else to
    carry forward.

    SubCategory and DescriptionKey are both confirmed "None" (unused)
    on all 120 rows and are NOT carried into the output -- including
    them would only show as dead weight in the JSON Inspector with no
    payoff, since there's nothing for them to ever resolve to.
    """
    db = load_json(os.path.join(SRC, "DataAssets/Database/DT_MonsterDatabase.json"))
    rows = db[0]["Rows"]

    all_monsters = {}
    by_category = {cat: [] for cat in MONSTER_CATEGORIES}

    for row_key, v in rows.items():
        enemy_type = strip_enum(v.get("EnemyType"))
        if enemy_type not in MONSTER_CATEGORIES:
            # Defensive: every one of the 120 known rows resolves to
            # one of the 4 categories above, confirmed before this was
            # written. A genuinely new 5th category in a future export
            # update should surface here rather than silently vanish.
            enemy_type = "Unknown"
            by_category.setdefault("Unknown", [])

        title_id = v.get("DatabaseTitleID")
        title_key = v.get("DatabaseTitleKey")  # e.g. "EnemyName_012011"

        # The populated DatabaseInfo slot's DatabaseTextKey is the
        # description lookup key (e.g. "DatabaseText_Monster_12011_1").
        # Every one of the 120 rows uses exactly slot 0 gated on
        # AdditionalCondition::Hit / ConditionValue 1 (i.e. "unlocks
        # after hitting this monster once") -- the other 2 slots are
        # always empty placeholders in this export, presumably reserved
        # for a multi-stage unlock (e.g. more lore at higher kill
        # counts) that was never populated. Only slot 0 is meaningful
        # right now, so only it is carried forward.
        description_text_key = None
        for info in v.get("DatabaseInfo", []):
            if info.get("DatabaseTextKey") not in (None, "None"):
                description_text_key = info["DatabaseTextKey"]
                break

        monster = {
            "rowKey": row_key,
            "titleId": title_id,
            "titleKey": title_key,
            "descriptionTextKey": description_text_key,
            "enemyType": enemy_type,
            "enemyTypeLabel": MONSTER_CATEGORIES.get(enemy_type, enemy_type),
        }
        all_monsters[title_key] = monster
        by_category.setdefault(enemy_type, []).append(monster)

    category_index = {}
    for cat_key, label in MONSTER_CATEGORIES.items():
        monster_list = by_category.get(cat_key, [])
        # Sort by numeric DatabaseTitleID -- per the user, exact in-game
        # display order isn't recoverable from this data (confirmed: it
        # matches neither numeric ID order nor alphabetical order), and
        # since the list is searchable the same way weapons/armor are,
        # the exact order matters less than having SOME stable, sane
        # default.
        monster_list.sort(key=lambda m: int(m["titleId"]) if str(m["titleId"]).isdigit() else 0)
        save_json(os.path.join(OUT, f"DataAssets/Database/Monsters/{cat_key}.json"), monster_list)
        category_index[cat_key] = {
            "label": label,
            "count": len(monster_list),
            "file": f"DataAssets/Database/Monsters/{cat_key}.json",
        }

    save_json(os.path.join(OUT, "DataAssets/Database/Monsters/_index.json"), category_index)
    return all_monsters


def build_monster_localization(all_monsters):
    """
    Build Content/ROD/DataAssets/Database/Monsters/Localization/{lang}.json
    -- per-language name + description for every monster, keyed by
    DatabaseTitleKey (e.g. "EnemyName_012011"), sourced from the
    official Game.json export the exact same way item/mod localization
    is: EnemyName_{id} for the name (ST_GeneralLocalizeList) and the
    monster's resolved DatabaseText_Monster_{id}_{slot} key for the
    description (ST_DatabaseLocalizeList -- NOTE: a different string
    table than items/mods use, confirmed by inspecting the source file
    directly before writing this).

    Coverage is much lower here than items/mods: only 27 of 120 monster
    rows have ANY localization at all in this export (confirmed by a
    direct count before this was written) -- the other 93 are rows that
    exist structurally (a real EnemyType + DatabaseTitleID) but have no
    matching EnemyName_* string anywhere in any of the 13 language
    files. Per the user, these stay in the list rather than being
    hidden, shown unverified with their raw identity (EnemyType +
    DatabaseTitleID) the same way an unnamed weapon falls back to its
    raw ItemKey -- with a toggle in the UI to hide them, mirroring the
    existing "verified names only" pattern.

    Same fallback-to-English and verified-until-GAME_LAUNCH_DATE policy
    as the other localization builders in this file; same hand-edits-
    never-overwritten re-run safety.
    """
    loc_dir = os.path.join(OUT, "DataAssets/Database/Monsters/Localization")
    english_general = load_official_strings(DEFAULT_LANGUAGE)

    def load_database_strings(lang_code):
        path = os.path.join(SRC, "Localization", "Game", lang_code, "Game.json")
        if not os.path.exists(path):
            return {}
        data = load_json(path)
        return data.get("ST_DatabaseLocalizeList", {})

    english_database = load_database_strings(DEFAULT_LANGUAGE)

    manifest = {}
    summary_lines = []

    for lang_code, lang_label in SUPPORTED_LANGUAGES.items():
        loc_path = os.path.join(loc_dir, f"{lang_code}.json")
        existing = load_json(loc_path) if os.path.exists(loc_path) else {}
        general_strings = load_official_strings(lang_code)
        database_strings = load_database_strings(lang_code)

        entries = dict(existing)
        for title_key, monster in all_monsters.items():
            if title_key in entries:
                continue  # hand-maintained: never overwrite an existing entry

            name, name_verified, name_source = "", False, None
            if title_key in general_strings:
                name, name_verified = general_strings[title_key], True
                name_source = "Official game localization (Game.json)"
            elif title_key in english_general:
                name, name_verified = english_general[title_key], True
                name_source = f"Fallback to English (no {lang_code} translation found)"

            desc_key = monster["descriptionTextKey"]
            description, desc_verified, desc_source = "", False, None
            if desc_key:
                if desc_key in database_strings:
                    description, desc_verified = database_strings[desc_key], True
                    desc_source = "Official game localization (Game.json)"
                elif desc_key in english_database:
                    description, desc_verified = english_database[desc_key], True
                    desc_source = f"Fallback to English (no {lang_code} translation found)"

            entries[title_key] = {
                "name": name,
                "verified": bool(name_verified),
                "source": name_source,
                "description": description,
                "descriptionVerified": bool(desc_verified),
                "descriptionSource": desc_source,
            }

        save_json(loc_path, entries)
        verified_count = sum(1 for v in entries.values() if v["verified"])
        described_count = sum(1 for v in entries.values() if v["descriptionVerified"])
        manifest[lang_code] = {
            "label": lang_label,
            "file": f"DataAssets/Database/Monsters/Localization/{lang_code}.json",
            "verifiedCount": verified_count,
            "describedCount": described_count,
            "totalCount": len(entries),
            "hasOfficialSource": len(general_strings) > 0,
        }
        summary_lines.append(
            f"    {lang_code} ({lang_label}): {verified_count}/{len(entries)} named, "
            f"{described_count}/{len(entries)} described"
        )

    manifest["_defaultLanguage"] = DEFAULT_LANGUAGE
    manifest["_gameLaunchDate"] = GAME_LAUNCH_DATE
    save_json(os.path.join(loc_dir, "_manifest.json"), manifest)

    print(f"  Monster localization: {len(all_monsters)} monsters x {len(SUPPORTED_LANGUAGES)} languages")
    for line in summary_lines:
        print(line)
    return load_json(os.path.join(loc_dir, f"{DEFAULT_LANGUAGE}.json"))


def build_lore():
    """
    Parses DT_WorldViewDatabase.json (177 rows -- the World > Lore
    section's authoritative source, confirmed against 3 reference
    screenshots: "Man-Made Goddess Statues" / "Association Blacksmiths"
    / "Great Wolf's Jaw" all resolve to exact word-for-word text
    matches) into a single flat, app-ready list.

    UNLIKE every other category built so far, this is a genuinely
    different shape, confirmed before this was written:
      - NO sub-categories. SubCategory is "None" on all 177 rows, and
        the reference screenshots show one flat scrollable list with
        no tabs -- so unlike weapons/armor/items, there's no category
        split here at all, just a single list (mirrors the screenshot
        exactly, not assumed).
      - NO small list icon. Only ONE texture exists per entry (the
        large Database-menu thumbnail) -- the reference screenshots
        show no icon in the list rows, just text; the image only
        appears in the detail/preview pane. Items, by contrast, had
        TWO separate texture families (a small list icon + a larger
        detail thumbnail) -- Lore only has the one.
      - The title/description strings live in a DIFFERENT string
        table than every other category built so far: monsters' and
        items' DatabaseText_* keys are in ST_DatabaseLocalizeList, but
        WorldView's DatabaseTitle_*/DatabaseText_* keys are BOTH in
        ST_GeneralLocalizeList instead -- confirmed by checking
        ST_DatabaseLocalizeList has literally zero WorldView_* keys at
        all before writing this, not assumed from the monster/item
        pattern holding here too.
      - Coverage is the best of any category yet: 177/177 named AND
        described, no exceptions.
      - 40 of 177 entries (a clean, contiguous ID block: 5001-5040 --
        confirmed by name to be written notes/messages like "Scouting
        Party Note 1", not landmarks) have NO thumbnail anywhere in
        either export -- a genuinely different kind of content from
        the 137 landmark/sight entries, not a texture-export oversight
        affecting the whole category. Handled the same way Items
        handled its missing-thumbnail gap: shown with a placeholder
        image and an honest flag, not hidden or guessed.
    """
    world_db = load_json(os.path.join(SRC, "DataAssets/Database/DT_WorldViewDatabase.json"))
    db_rows = world_db[0]["Rows"]

    # Placeholder must point at a thumbnail that actually exists --
    # same defensive lesson learned from Items' KeyItem gap (where ID 1
    # specifically was missing, so naively assuming the first ID works
    # would have broken). Picks the first row (in DatabaseTitleID
    # order) whose thumbnail file is actually present.
    sorted_ids = sorted(int(v["DatabaseTitleID"]) for v in db_rows.values())
    placeholder_id = next(
        (i for i in sorted_ids if os.path.exists(os.path.join(
            OUT, "Widget/Database/Thumbnail/WorldView", f"T_Database_Thumbnail_WorldView{i}.png"
        ))),
        sorted_ids[0] if sorted_ids else 1,
    )
    lore_placeholder = f"Content/ROD/Widget/Database/Thumbnail/WorldView/T_Database_Thumbnail_WorldView{placeholder_id}.png"

    lore_list = []
    missing_thumbnails = []
    for row_key, v in db_rows.items():
        title_id = int(v["DatabaseTitleID"])
        title_key = v.get("DatabaseTitleKey")  # e.g. "DatabaseTitle_WorldView_4036"

        # The single populated DatabaseInfo slot's DatabaseTextKey is
        # the description lookup key. Confirmed: every one of the 177
        # rows has exactly 1 slot (not 3 like monsters/items), always
        # populated, always gated on AdditionalCondition::Tips with
        # ConditionValue == the row's own DatabaseTitleID.
        description_text_key = None
        for info in v.get("DatabaseInfo", []):
            if info.get("DatabaseTextKey") not in (None, "None"):
                description_text_key = info["DatabaseTextKey"]
                break

        thumb_filename = f"T_Database_Thumbnail_WorldView{title_id}.png"
        thumb_exists = os.path.exists(os.path.join(OUT, "Widget/Database/Thumbnail/WorldView", thumb_filename))
        if not thumb_exists:
            missing_thumbnails.append(title_id)

        entry = {
            "rowKey": row_key,
            "titleId": title_id,
            "titleKey": title_key,
            "descriptionTextKey": description_text_key,
            "hasThumbnail": thumb_exists,
            "textures": {
                "icon": f"Content/ROD/Widget/Database/Thumbnail/WorldView/{thumb_filename}",
                "categoryPlaceholderRender": lore_placeholder,
            },
        }
        lore_list.append(entry)

    # Sort by numeric DatabaseTitleID, same "no confirmed in-game
    # order, so use a stable sane default" reasoning as monsters --
    # confirmed the reference screenshots' order doesn't match a clean
    # ID or alphabetical sort either, and it's searchable regardless.
    lore_list.sort(key=lambda e: e["titleId"])

    save_json(os.path.join(OUT, "DataAssets/Database/Lore/Lore.json"), lore_list)
    save_json(os.path.join(OUT, "DataAssets/Database/Lore/_index.json"), {
        "count": len(lore_list),
        "file": "DataAssets/Database/Lore/Lore.json",
        "missingThumbnails": missing_thumbnails,
    })
    if missing_thumbnails:
        print(f"    Lore: {len(missing_thumbnails)} missing thumbnail(s) (IDs: {missing_thumbnails})")

    return {e["titleKey"]: e for e in lore_list}


def _resolve_rep_templates(text, strings, fallback_strings=None):
    """
    Shared template-resolution helper used by build_lore_localization,
    build_town_localization, and build_quest_localization -- all three
    use the SAME {Rep_X} -> strip "Rep_" -> look up in same table rule,
    confirmed against 79 distinct template variables before this helper
    was factored out (100% resolved, no exceptions to the rule).
    """
    if not text or "{Rep_" not in text:
        return text
    def _sub(m):
        stripped = m.group(1).replace("Rep_", "", 1)
        if stripped in strings:
            return strings[stripped]
        if fallback_strings and stripped in fallback_strings:
            return fallback_strings[stripped]
        return m.group(0)
    return re.sub(r"\{(Rep_\w+?)\}", _sub, text)


def build_towns():
    """
    Builds Content/ROD/DataAssets/Database/Towns/Towns.json from
    DT_TownList.json (10 rows) cross-referenced with Town_001-006.json
    (detail files -- only 6 of the 10 towns have one; towns 007-010
    are Floor 3 placeholders with no name in any localization snapshot
    AND no detail file, confirmed before this was written).

    Fields surfaced per town:
      - ID (001-010), Floor (1/2/3), nameKey (AreaTitle_{Name})
      - thumbnailTexture path (T_Town_Thumbnail_{ID}.png)
      - WorldName: the UE map asset path -- the literal string that
        LOADS this town's level instance (e.g.
        /Game/ROD/Maps/Main/WL01/TOB/PL_TOB). This is the exact
        "level/instance loading" text the user asked for.
      - MainTerminalID: the in-game teleport gate/terminal identifier
        (e.g. TG_001 for Town of Beginnings, MT_002 for Horunka etc.)
        -- a different prefix per town, both prefixes confirmed real
        and distinct (TG = Teleport Gate, MT = Map Terminal).
      - bgmStateName: the Wwise BGM state object name for this town,
        extracted from the detail file's BGMState field -- links to
        the Wwise Audio catalog's State_Quest-Town_* events.

    Sources per field are stored in the output JSON so the frontend
    can show them inline, consistent with the Unique MOD and Recipe
    source-attribution convention.
    """
    town_list_path = os.path.join(SRC, "DataAssets/Town/DT_TownList.json")
    town_list = load_json(town_list_path)[0]["Rows"]
    english_general = load_official_strings(DEFAULT_LANGUAGE)

    towns = []
    for row_key, v in town_list.items():
        town_id = v.get("ID", row_key)
        floor = v.get("Floor")
        name_suffix = v.get("Name", "")  # e.g. "TownofBeginning"
        name_key = f"AreaTitle_{name_suffix}"

        # Town thumbnail -- confirmed all 10 exist for IDs 001-010
        thumb_path = v.get("ThumbnailTexture", {}).get("AssetPathName", "")
        thumb_local = asset_path_to_texture_key(thumb_path) if thumb_path else (
            f"Content/ROD/Widget/Common/TownThumbnail/T_Town_Thumbnail_{town_id}.png"
        )

        # Per-town detail file (only exists for towns 001-006)
        detail_path = os.path.join(SRC, f"DataAssets/Town/Town_{town_id}.json")
        world_name = None
        terminal_id = None
        bgm_state_name = None

        if os.path.exists(detail_path):
            detail = load_json(detail_path)[0]["Properties"]
            world_name = detail.get("WorldName")
            terminal_id = detail.get("MainTerminalID")
            bgm_obj = detail.get("BGMState", {})
            # Extract the clean state name from the Wwise ObjectName,
            # e.g. "AkStateValue'State_Quest-Town_TOB'" -> "State_Quest-Town_TOB"
            bgm_raw = bgm_obj.get("ObjectName", "")
            m = re.search(r"'([^']+)'", bgm_raw)
            bgm_state_name = m.group(1) if m else bgm_raw or None

        towns.append({
            "id": town_id,
            "floor": floor,
            "nameKey": name_key,
            "hasDetailFile": os.path.exists(detail_path),
            "worldName": world_name,
            "terminalID": terminal_id,
            "bgmStateName": bgm_state_name,
            "textures": {
                "thumbnail": thumb_local,
            },
            "sources": {
                "nameKey": f"DT_TownList.json row {row_key} -> Name field -> AreaTitle_{{name}} lookup in ST_GeneralLocalizeList",
                "worldName": f"Town_{town_id}.json -> WorldName" if world_name else None,
                "terminalID": f"Town_{town_id}.json -> MainTerminalID" if terminal_id else None,
            },
        })

    towns.sort(key=lambda t: t["id"])
    save_json(os.path.join(OUT, "DataAssets/Database/Towns/Towns.json"), towns)
    save_json(os.path.join(OUT, "DataAssets/Database/Towns/_index.json"), {
        "count": len(towns),
        "namedCount": sum(1 for t in towns if english_general.get(t["nameKey"])),
        "file": "DataAssets/Database/Towns/Towns.json",
    })
    print(f"  Towns: {len(towns)} total, {sum(1 for t in towns if t['hasDetailFile'])} with detail file")
    return {t["id"]: t for t in towns}


def build_town_localization(all_towns):
    """
    Per-language name for each town, keyed by nameKey
    (e.g. "AreaTitle_TownofBeginning") against ST_GeneralLocalizeList,
    with the same {Rep_X} template-resolution rule as Lore (confirmed:
    town name keys like "AreaTitle_Hornca" in ST_GeneralLocalizeList
    resolve directly without templates -- the template form
    "{Rep_AreaTitle_Hornca}" appears in OTHER strings like Lore entries
    that REFERENCE the town name, but not in the canonical
    ST_GeneralLocalizeList entry for the town name itself).
    """
    loc_dir = os.path.join(OUT, "DataAssets/Database/Towns/Localization")
    english_general = load_official_strings(DEFAULT_LANGUAGE)
    manifest = {}

    for lang_code, lang_label in SUPPORTED_LANGUAGES.items():
        loc_path = os.path.join(loc_dir, f"{lang_code}.json")
        existing = load_json(loc_path) if os.path.exists(loc_path) else {}
        general_strings = load_official_strings(lang_code)
        entries = dict(existing)

        for town_id, town in all_towns.items():
            key = town["nameKey"]
            if key in entries:
                continue

            name, name_verified, name_source = "", False, None
            raw = general_strings.get(key) or english_general.get(key)
            if raw:
                name = _resolve_rep_templates(raw, general_strings, english_general)
                name_verified = True
                name_source = "Official game localization (Game.json)"
                if key not in general_strings and key in english_general:
                    name_source = f"Fallback to English (no {lang_code} translation found)"

            entries[key] = {
                "name": name,
                "verified": name_verified,
                "source": name_source,
            }

        save_json(loc_path, entries)
        verified = sum(1 for v in entries.values() if v["verified"])
        manifest[lang_code] = {
            "label": lang_label,
            "file": f"DataAssets/Database/Towns/Localization/{lang_code}.json",
            "verifiedCount": verified,
            "totalCount": len(entries),
        }

    manifest["_defaultLanguage"] = DEFAULT_LANGUAGE
    manifest["_gameLaunchDate"] = GAME_LAUNCH_DATE
    save_json(os.path.join(loc_dir, "_manifest.json"), manifest)
    print(f"  Town localization: {len(all_towns)} towns x {len(SUPPORTED_LANGUAGES)} languages")


def build_quests():
    """
    Builds Content/ROD/DataAssets/Database/Quests/Quests.json from
    the 5 QST_Main_*.json files in DataAssets/Quests/Main/ -- the only
    quest category with real data in this export (Sub/Town quest files
    genuinely don't exist, confirmed by checking every file in every
    Quests subfolder before concluding this).

    Fields surfaced per quest:
      - questId (e.g. "0001"), category (always "Main" here)
      - nameKey / descriptionKey
      - isDungeonQuest, dungeonNameKey (for the dungeon's display name)
      - timeZone (Night/Noon/Evening), clearCondition summary
      - forcePartners (list of partner codes), bNoPartner flag
      - startGateID: the level terminal/gate ID this quest starts at
        (same "level/instance loading" family as Town terminalIDs)
      - questAssetPath: the full UE asset path to this quest
        (the level/instance loading reference for quests specifically)

    {Rep_PartnerName_IOM}-style templates in descriptions are resolved
    using the same prefix-strip rule confirmed for Lore/Towns (100%
    validated, no exceptions, before this was written).

    QuestAssets/Main/DA_QuestAsset_Main_*.json is confirmed as
    internal flow-graph/level-streaming logic (cutscene triggers,
    dungeon floor transitions), not display content -- excluded
    entirely rather than partially shown.
    """
    quest_dir = os.path.join(SRC, "DataAssets/Quests/Main")
    english_general = load_official_strings(DEFAULT_LANGUAGE)

    def _clear_condition_summary(cc):
        """Convert the ClearCondition dict into a short displayable string."""
        if not cc:
            return None
        if "GoalGateID" in cc:
            return f"Reach gate: {cc['GoalGateID']}"
        if "TargetItems" in cc:
            items = cc["TargetItems"]
            parts = []
            for item in items:
                cat = strip_enum(item.get("Category", "")).replace("ItemCategory_", "")
                parts.append(f"Obtain {item.get('Num', 1)}x {cat} item #{item.get('ItemId', '?')}")
            return " & ".join(parts)
        return str(cc)

    quests = []
    for path in sorted(glob.glob(os.path.join(quest_dir, "QST_Main_*.json"))):
        d = load_json(path)
        props = d[0]["Properties"]
        qd = props.get("QuestData", {})
        quest_id = os.path.basename(path).replace("QST_Main_", "").replace(".json", "")
        category = strip_enum(props.get("QuestCategory", "EQuestCategory::Main"))
        quest_asset_path = props.get("QuestAsset", {}).get("AssetPathName", "")

        partner_data = qd.get("Partner", {})
        force_partners = partner_data.get("ForcePartners", [])
        no_partner = partner_data.get("bNoPartner", False)

        time_zone = strip_enum(qd.get("WorldTimeZone", "")).replace("ERODTimeZone::", "")
        is_dungeon = qd.get("bDungeonQuest", False)
        dungeon_name_key = qd.get("DungeonNameKey") or None
        start_gate_id = qd.get("StartGateID") or None
        clear_condition = _clear_condition_summary(qd.get("ClearCondition"))

        quests.append({
            "questId": quest_id,
            "category": category,
            "nameKey": qd.get("NameKey"),
            "descriptionKey": qd.get("DescriptionKey"),
            "isDungeon": is_dungeon,
            "dungeonNameKey": dungeon_name_key,
            "timeZone": time_zone,
            "forcePartners": force_partners,
            "bNoPartner": no_partner,
            "startGateID": start_gate_id,
            "clearConditionSummary": clear_condition,
            "questAssetPath": quest_asset_path,
            "textures": {
                "categoryIcon": f"Content/ROD/Widget/Common/IconImage/QuestIconImages/T_QuestIcon_Main.png",
            },
            "sources": {
                "name": f"QST_Main_{quest_id}.json -> QuestData.NameKey -> ST_GeneralLocalizeList",
                "description": f"QST_Main_{quest_id}.json -> QuestData.DescriptionKey -> ST_GeneralLocalizeList",
                "levelInstance": f"QST_Main_{quest_id}.json -> QuestData.StartGateID + QuestAsset path",
            },
        })

    save_json(os.path.join(OUT, "DataAssets/Database/Quests/Quests.json"), quests)
    save_json(os.path.join(OUT, "DataAssets/Database/Quests/_index.json"), {
        "count": len(quests),
        "file": "DataAssets/Database/Quests/Quests.json",
        "categories": ["Main"],
        "note": "Only Main category has data files in this export. Sub/Town quest type icons exist but no quest data files.",
    })
    print(f"  Quests: {len(quests)} total (all Main category)")
    return {q["questId"]: q for q in quests}


def build_quest_localization(all_quests):
    """
    Per-language name + description for each quest, with
    {Rep_PartnerName_X} template substitution applied to descriptions
    (confirmed across all 5 quests before this was written -- some
    descriptions reference partner names via templates, e.g.
    "{Rep_PartnerName_IOM}" -> "Iori").
    """
    loc_dir = os.path.join(OUT, "DataAssets/Database/Quests/Localization")
    english_general = load_official_strings(DEFAULT_LANGUAGE)
    manifest = {}

    for lang_code, lang_label in SUPPORTED_LANGUAGES.items():
        loc_path = os.path.join(loc_dir, f"{lang_code}.json")
        existing = load_json(loc_path) if os.path.exists(loc_path) else {}
        general_strings = load_official_strings(lang_code)
        entries = dict(existing)

        for quest_id, quest in all_quests.items():
            name_key = quest.get("nameKey")
            desc_key = quest.get("descriptionKey")
            if name_key and name_key in entries:
                continue

            name, name_verified, name_source = "", False, None
            if name_key:
                raw = general_strings.get(name_key) or english_general.get(name_key)
                if raw:
                    name = _resolve_rep_templates(raw, general_strings, english_general)
                    name_verified = True
                    name_source = "Official game localization (Game.json)"
                    if name_key not in general_strings:
                        name_source = f"Fallback to English (no {lang_code} translation found)"

            description, desc_verified, desc_source = "", False, None
            if desc_key:
                raw = general_strings.get(desc_key) or english_general.get(desc_key)
                if raw:
                    description = _resolve_rep_templates(raw, general_strings, english_general)
                    desc_verified = True
                    desc_source = "Official game localization (Game.json)"
                    if desc_key not in general_strings:
                        desc_source = f"Fallback to English (no {lang_code} translation found)"

            # Also resolve dungeon name if present
            dungeon_name_key = quest.get("dungeonNameKey")
            dungeon_name, dungeon_verified = "", False
            if dungeon_name_key:
                raw = general_strings.get(dungeon_name_key) or english_general.get(dungeon_name_key)
                if raw and raw.strip("-").strip():  # exclude "- - -" placeholder
                    dungeon_name = _resolve_rep_templates(raw, general_strings, english_general)
                    dungeon_verified = True

            if name_key:
                entries[name_key] = {
                    "name": name,
                    "verified": name_verified,
                    "source": name_source,
                    "description": description,
                    "descriptionVerified": desc_verified,
                    "descriptionSource": desc_source,
                    "dungeonName": dungeon_name,
                    "dungeonNameVerified": dungeon_verified,
                }

        save_json(loc_path, entries)
        verified = sum(1 for v in entries.values() if v["verified"])
        manifest[lang_code] = {
            "label": lang_label,
            "file": f"DataAssets/Database/Quests/Localization/{lang_code}.json",
            "verifiedCount": verified,
            "totalCount": len(entries),
        }

    manifest["_defaultLanguage"] = DEFAULT_LANGUAGE
    manifest["_gameLaunchDate"] = GAME_LAUNCH_DATE
    save_json(os.path.join(loc_dir, "_manifest.json"), manifest)
    print(f"  Quest localization: {len(all_quests)} quests x {len(SUPPORTED_LANGUAGES)} languages")


    """
    Walks every AkAudioEvent JSON under raw-export/Content/ROD/WwiseAudio/Events/
    (4449 files, confirmed before this was written) and builds one
    compact index for a dedicated Wwise Audio browser -- distinct from
    DT Inspector, since these are single tiny records (no Rows/
    Properties the way every other category here has), not rows in a
    DataTable. Dumping 4449 "unrecognized shape" entries into DT
    Inspector's flat list would be unusable; this instead preserves the
    REAL organizational structure that already exists in the export
    (the folder hierarchy + the event's own name), per the user's
    request to make this "organized and readable" for someone trying
    to find and replace a specific audio file.

    For each event, extracts:
      - The full relative folder path (the category structure already
        used by the actual Wwise project -- e.g. SFX_Enemy/Wasp/...,
        confirmed meaningful by inspection, not invented here) and the
        event's own name (kept as-is, not algorithmically shortened --
        the full name is already self-describing for the vast majority
        of events, e.g. "Play_SFX_Enemy_Wasp_Voice_Hiss", and is exactly
        what someone modding audio would grep for in the actual game
        files, so a lossy "cleaned up" label would work against that
        goal rather than for it).
      - Per-language media file paths (.wem files inside the soundbank)
        -- confirmed VO events specifically carry multiple language
        variants as SEPARATE physical files (e.g. English(US) and
        Japanese(JP) pointing at different Media/.../*.wem paths), which
        is exactly the kind of mapping someone replacing a voice line
        needs to know about up front, not discover by trial and error.
      - The .bnk soundbank path and numeric EventId/MediaId, since
        those are the actual on-disk identifiers, not just a display
        name.
    """
    events_root = os.path.join(SRC, "WwiseAudio", "Events")
    if not os.path.exists(events_root):
        print("  No WwiseAudio/Events found -- skipping.")
        return {}

    events = []
    category_counts = {}

    for root, dirs, files in os.walk(events_root):
        for fname in sorted(files):
            if not fname.endswith(".json"):
                continue
            full_path = os.path.join(root, fname)
            rel_path = os.path.relpath(full_path, events_root).replace(os.sep, "/")
            category = rel_path.split("/")[0]

            try:
                data = load_json(full_path)
            except Exception as e:
                continue  # a small number of malformed exports shouldn't halt the whole build

            if not (isinstance(data, list) and data and isinstance(data[0], dict)):
                continue
            entry = data[0]
            event_name = entry.get("Name", fname.replace(".json", ""))
            cooked = entry.get("EventCookedData", {})
            lang_map = cooked.get("EventLanguageMap", [])

            languages = []
            event_id = None
            soundbank_path = None
            for lm in lang_map:
                lang_name = (lm.get("Key") or {}).get("LanguageName")
                value = lm.get("Value") or {}
                if event_id is None:
                    event_id = value.get("EventId")
                soundbanks = value.get("SoundBanks") or []
                if soundbank_path is None and soundbanks:
                    soundbank_path = soundbanks[0].get("SoundBankPathName")
                media_paths = [m.get("MediaPathName") for m in (value.get("Media") or []) if m.get("MediaPathName")]
                languages.append({
                    "language": lang_name,
                    "mediaPaths": media_paths,
                })

            events.append({
                "path": rel_path,
                "category": category,
                "name": event_name,
                "eventId": event_id,
                "soundBankPath": soundbank_path,
                "languages": languages,
                "mediaFileCount": sum(len(l["mediaPaths"]) for l in languages),
                "isMultiLanguage": len(languages) > 1,
            })
            category_counts[category] = category_counts.get(category, 0) + 1

    events.sort(key=lambda e: e["path"])
    save_json(os.path.join(OUT, "DataAssets/_WwiseAudio/_index.json"), {
        "totalCount": len(events),
        "categoryCounts": category_counts,
    })
    save_json(os.path.join(OUT, "DataAssets/_WwiseAudio/events.json"), events)

    print(f"  Wwise audio: {len(events)} events across {len(category_counts)} categories")
    for cat, count in sorted(category_counts.items(), key=lambda x: -x[1])[:5]:
        print(f"    {cat}: {count}")

    return events


def _parse_flag_string(flag_str):
    """
    UE's Function/Property "Flags" fields are pipe-delimited strings
    like "FUNC_BlueprintCallable | FUNC_BlueprintEvent | FUNC_Public",
    NOT the "EEnum::Value" format strip_enum() handles -- a distinct
    format needing its own parser. Returns a clean list of individual
    flag names with surrounding whitespace stripped, or an empty list
    for None/empty input.
    """
    if not flag_str:
        return []
    return [f.strip() for f in flag_str.split("|") if f.strip()]


def build_bp_inspector_index():
    """
    Walks every Widget Blueprint JSON under
    raw-export/Content/ROD/Widget/ (37 WBP_AvatarCustomize_* files,
    confirmed before this was written -- NO standalone Blueprint
    (BP_*) or Macro asset exists anywhere in any export checked) and
    builds a dedicated BP Inspector index, distinct from DT Inspector
    (which only handles DataTable/CurveTable/DataAsset shapes -- a
    Widget Blueprint's actual export is a flat list of UObject-style
    entries with completely different fields, e.g. ChildProperties/
    FunctionFlags/WidgetTree, that DT Inspector's classifier has no
    concept of and was never meant to handle).

    Scoped explicitly and honestly to WIDGET Blueprints only --
    "BP Inspector" is the user-facing name, but every section/label
    here says "Widget Blueprint" specifically rather than implying
    coverage of standalone Blueprints or Macros that don't exist in
    this export. If either ever shows up in a future upload, this is
    the function to extend, not replace.

    For each WBP file, extracts:
      - Every FUNCTION (sourced from WidgetBlueprintGeneratedClass's
        own FuncMap, the actual authoritative function registry the
        compiled class uses -- NOT by scanning for Type=="Function" in
        the flat list and hoping nothing unrelated also has that Type)
        with its real UE FunctionFlags (FUNC_BlueprintCallable,
        FUNC_BlueprintEvent, FUNC_Public, etc. -- confirmed these are
        genuine, meaningful flags telling you whether something is
        actually externally invokable, not decorative) and, where
        present, REAL parameter names + types.

        Parameter extraction logic (confirmed against the full set of
        flag combinations before being trusted, not assumed from one
        example): a ChildProperties entry counts as a real parameter
        only if its PropertyFlags contains the literal "Parm" token.
        "ConstParm" ALONE (without "Parm") is NOT a parameter --
        confirmed by inspecting several real examples, every one of
        which was an internal entry-dispatch local
        (K2Node_Event_AnimationName) for the compiler's own ubergraph
        switch, not something a caller passes in. Names starting with
        "K2Node_" or "CallFunc_" are excluded as a second, independent
        safety check on top of the flag check, since those prefixes
        consistently marked internal compiler-generated locals across
        every example checked (e.g. K2Node_MakeArray_Array,
        CallFunc_Array_Get_Item) even on entries that technically also
        carried a Parm-adjacent flag in some other case.
      - A widget-hierarchy SUMMARY (counts per UMG widget type --
        CanvasPanel, Image, GridSlot, etc.) rather than a reconstructed
        visual tree: Outer-chain references give a genuine UObject
        parent (e.g. a CanvasPanelSlot's Outer is its containing
        CanvasPanel), but NOT the same thing as the actual rendered
        widget tree (a slot's visual child is a separate Content
        reference) -- attempting to reconstruct a precise visual tree
        from Outer alone would overstate what's actually confirmed, so
        this deliberately stays a count-by-type summary instead.
    """
    wbp_root = os.path.join(SRC, "Widget")
    if not os.path.exists(wbp_root):
        print("  No Widget/ folder found -- skipping.")
        return []

    # Internal-compiler-local name prefixes, confirmed across every
    # checked example to mark a node-graph-generated local variable,
    # never a real caller-facing parameter -- see docstring above.
    INTERNAL_NAME_PREFIXES = ("K2Node_", "CallFunc_")

    entries = []
    for root, dirs, files in os.walk(wbp_root):
        for fname in sorted(files):
            if not fname.endswith(".json"):
                continue
            full_path = os.path.join(root, fname)
            rel_path = os.path.relpath(full_path, SRC).replace(os.sep, "/")

            try:
                data = load_json(full_path)
            except Exception:
                continue
            if not isinstance(data, list):
                continue

            by_name = {e.get("Name"): e for e in data if isinstance(e, dict) and "Name" in e}
            widget_class = next((e for e in data if e.get("Type") == "WidgetBlueprintGeneratedClass"), None)
            func_map = (widget_class or {}).get("FuncMap", {})

            functions = []
            for func_name in func_map.keys():
                func_entry = by_name.get(func_name)
                if not func_entry:
                    continue  # FuncMap referenced a name not present as its own entry -- skip rather than fabricate
                flags = _parse_flag_string(func_entry.get("FunctionFlags"))
                params = []
                for prop in func_entry.get("ChildProperties", []):
                    prop_flags_str = prop.get("PropertyFlags", "")
                    prop_name = prop.get("Name", "")
                    if "Parm" not in prop_flags_str:
                        continue
                    if any(prop_name.startswith(p) for p in INTERNAL_NAME_PREFIXES):
                        continue
                    params.append({
                        "name": prop_name,
                        "type": prop.get("Type"),
                        "flags": _parse_flag_string(prop_flags_str),
                        "isOutput": "OutParm" in prop_flags_str or "ReturnParm" in prop_flags_str,
                    })
                functions.append({
                    "name": func_name,
                    "flags": flags,
                    "isBlueprintCallable": "FUNC_BlueprintCallable" in flags,
                    "isBlueprintEvent": "FUNC_BlueprintEvent" in flags,
                    "isPublic": "FUNC_Public" in flags,
                    "parameters": params,
                })

            # Widget-hierarchy type counts -- everything that ISN'T a
            # Function/MovieScene*/WidgetAnimation/WidgetTree/
            # WidgetBlueprintGeneratedClass entry is treated as a UMG
            # widget element for this summary.
            EXCLUDED_FROM_WIDGET_COUNT = {
                "Function", "WidgetTree", "WidgetBlueprintGeneratedClass",
                "WidgetAnimation", "MovieScene", "MovieSceneCompiledData",
            }
            widget_type_counts = {}
            for e in data:
                t = e.get("Type", "")
                if t in EXCLUDED_FROM_WIDGET_COUNT or t.startswith("MovieScene"):
                    continue
                widget_type_counts[t] = widget_type_counts.get(t, 0) + 1

            entries.append({
                "path": rel_path,
                "name": fname.replace(".json", ""),
                "totalEntries": len(data),
                "functionCount": len(functions),
                "functions": sorted(functions, key=lambda f: f["name"]),
                "widgetTypeCounts": widget_type_counts,
            })

    entries.sort(key=lambda e: e["name"])
    save_json(os.path.join(OUT, "DataAssets/_BpInspector/_index.json"), {
        "count": len(entries),
        "totalFunctions": sum(e["functionCount"] for e in entries),
    })
    save_json(os.path.join(OUT, "DataAssets/_BpInspector/widgets.json"), entries)

    total_funcs = sum(e["functionCount"] for e in entries)
    total_callable = sum(1 for e in entries for f in e["functions"] if f["isBlueprintCallable"])
    print(f"  BP Inspector (Widget Blueprints only): {len(entries)} widgets, {total_funcs} functions ({total_callable} BlueprintCallable)")

    return entries


def _clean_parent_name(object_name):
    """
    "MaterialInstanceConstant'M_CHR_Cel_Custom_Eye'" -> "M_CHR_Cel_Custom_Eye"
    "Material'M_Foo'" -> "M_Foo" ; returns None for empty/missing input.
    """
    if not object_name:
        return None
    return re.sub(r"^\w+'|'$", "", object_name)


def build_asset_materials():
    """
    Catalogs every Material / MaterialInstanceConstant JSON found
    anywhere under raw-export/ (166 total confirmed before this was
    written: 145 MaterialInstanceConstant, 21 base Material) into a
    single Materials.json -- the first half of the Asset Inspector.

    MaterialInstanceConstant assets carry REAL, NAMED parameters
    (ScalarParameterValues/VectorParameterValues/TextureParameterValues,
    each a {ParameterInfo.Name, ParameterValue} pair) plus a Parent
    reference -- confirmed this is exactly the structure the user
    described needing to recreate a mod's own material instance that
    auto-links to the game's real material system (e.g. a custom Pupil
    color/texture mod needs to know the exact parameter name
    "CustomColorPupilR" is a Vector, not just that some color exists).

    Base Material assets (the Parent target of those instances) are
    NOT this rich -- confirmed directly before writing this, not
    assumed: their own scalar/vector parameter VALUES exist in
    CachedExpressionData as bare numeric arrays (ScalarValues,
    VectorValues) with NO name attached in this export; the actual
    name-to-index mapping lives in a separate, more complex
    RuntimeEntries/PrimitiveDataIndexValues structure that risks being
    decoded wrong if guessed at. Rather than risk mislabeling a value
    with the wrong parameter name, base Materials are shown with only
    their structurally-confirmed metadata (MaterialDomain, BlendMode)
    and a parameter VALUE COUNT (not named values) -- an honest partial
    result instead of a confident-looking wrong one.

    A real base-game Parent material (e.g. M_CHR_Cel_Custom_Eye, the
    actual parent of the Pupil instances) is NOT present in this export
    at all -- confirmed by checking for it directly. This means an
    instance's Parent is shown as a reference (name + path), not a
    resolved, browsable entry, for any Parent not also present as its
    own file in this export.
    """
    materials = []
    parent_only_refs = set()  # Parent names referenced but not present as their own asset in this export

    for root, dirs, files in os.walk(SRC):
        for fname in sorted(files):
            if not fname.endswith(".json"):
                continue
            full_path = os.path.join(root, fname)
            try:
                data = load_json(full_path)
            except Exception:
                continue
            if not (isinstance(data, list) and data and isinstance(data[0], dict)):
                continue
            entry = data[0]
            asset_type = entry.get("Type")
            if asset_type not in ("MaterialInstanceConstant", "Material"):
                continue

            rel_path = os.path.relpath(full_path, SRC).replace(os.sep, "/")
            props = entry.get("Properties", {})

            if asset_type == "MaterialInstanceConstant":
                parent_ref = _clean_parent_name(props.get("Parent", {}).get("ObjectName"))

                def _extract_params(field, value_key="ParameterValue"):
                    out = []
                    for p in props.get(field, []) or []:
                        info = p.get("ParameterInfo", {})
                        out.append({
                            "name": info.get("Name"),
                            "value": p.get(value_key),
                        })
                    return out

                materials.append({
                    "path": rel_path,
                    "name": entry.get("Name"),
                    "assetType": "MaterialInstanceConstant",
                    "parent": parent_ref,
                    "scalarParameters": _extract_params("ScalarParameterValues"),
                    "vectorParameters": _extract_params("VectorParameterValues"),
                    "textureParameters": [
                        {
                            "name": (p.get("ParameterInfo", {}) or {}).get("Name"),
                            "texturePath": _clean_parent_name((p.get("ParameterValue", {}) or {}).get("ObjectName")),
                        }
                        for p in props.get("TextureParameterValues", []) or []
                    ],
                })
            else:  # base Material -- thinner, honestly-scoped record, see docstring
                ced = entry.get("CachedExpressionData", {}) or {}
                materials.append({
                    "path": rel_path,
                    "name": entry.get("Name"),
                    "assetType": "Material",
                    "materialDomain": strip_enum(props.get("MaterialDomain")),
                    "blendMode": strip_enum(props.get("BlendMode")),
                    "scalarValueCount": len(ced.get("ScalarValues", []) or []),
                    "vectorValueCount": len(ced.get("VectorValues", []) or []),
                    "textureValueCount": len(ced.get("TextureValues", []) or []),
                })

    # Cross-reference: which Parent names are referenced by at least
    # one instance but have no asset file of their own in this export.
    present_names = {m["name"] for m in materials}
    for m in materials:
        if m.get("parent") and m["parent"] not in present_names:
            parent_only_refs.add(m["parent"])

    materials.sort(key=lambda m: m["name"] or "")
    save_json(os.path.join(OUT, "DataAssets/_AssetInspector/Materials.json"), materials)

    mi_count = sum(1 for m in materials if m["assetType"] == "MaterialInstanceConstant")
    mat_count = sum(1 for m in materials if m["assetType"] == "Material")
    print(f"  Asset Inspector (Materials): {mi_count} MaterialInstanceConstant, {mat_count} base Material, {len(parent_only_refs)} referenced-but-absent parents")

    return materials


def build_asset_meshes():
    """
    Catalogs every avatar/equipment mesh-reference JSON (NOT the actual
    binary mesh geometry, which UE doesn't export to JSON at all -- the
    ASSET PATH to the real .uasset SkeletalMesh, e.g.
    "/Game/.../SK_ITM_WH001001.SK_ITM_WH001001", confirmed throughout
    this export, never the mesh data itself) into a single Meshes.json
    -- the second half of the Asset Inspector.

    Confirmed two genuinely different field shapes that needed separate
    handling, not a single uniform parser (checking the real source
    folder for each before writing this, the same lesson learned
    earlier this project with rawInputs being wrong for one section):
      - Costumes (Upper/Lower/Glove): MaleAvatarMeshes/FemaleAvatarMeshes
        (gendered, each a real list -- though every example checked had
        exactly one entry).
      - HeadGears: a single AvatarMeshes list, no gender split.
      - Equipment (6 weapon categories): MainWeaponMesh (singular).
      - Equipment/Shield: ShieldMesh (singular).

    CONFIRMED real ID cross-reference into the EXISTING Weapons/Armor
    sections this toolkit already has, not a new, separate ID space:
    filename "AvatarParts_OneHandedSword_00001" -> weapon ID 1 ->
    resolves to the SAME "ItemName_WOS_1" key ("Shortsword") weapons-
    browser.js already uses; "AvatarMesh_Upper006" -> armor ID 6 ->
    "ItemName_Upper_6" (confirmed this specific one has NO name in any
    language file -- a real, pre-existing gap in the Armor data, not
    something introduced here -- shown honestly as unresolved rather
    than hidden).
    """
    meshes = []

    # Costumes: Upper/Lower/Glove, gendered, folder name IS the slot
    # (the UE Type field is unreliable here -- confirmed directly:
    # Lower-slot files report Type=="RODAvatarBodyMesh", not a
    # dedicated "RODAvatarLowerMesh" the way Upper/Glove do).
    costume_root = os.path.join(SRC, "DataAssets/AvatarParts/Costumes")
    costume_slot_to_armor_cfg = {"Upper": "Upper", "Lower": "Lower", "Gloves": "Glove"}
    if os.path.exists(costume_root):
        for slot_folder, armor_key in costume_slot_to_armor_cfg.items():
            slot_dir = os.path.join(costume_root, slot_folder)
            if not os.path.exists(slot_dir):
                continue
            for fname in sorted(os.listdir(slot_dir)):
                if not fname.endswith(".json") or not fname.startswith("AvatarMesh_"):
                    continue
                m = re.search(r"(\d+)\.json$", fname)
                if not m:
                    continue
                mesh_id = int(m.group(1))
                full_path = os.path.join(slot_dir, fname)
                rel_path = os.path.relpath(full_path, SRC).replace(os.sep, "/")
                try:
                    data = load_json(full_path)
                except Exception:
                    continue
                props = data[0].get("Properties", {})

                def _first_path(field):
                    arr = props.get(field, []) or []
                    if arr and isinstance(arr, list):
                        return _clean_parent_name(arr[0].get("AssetPathName")) or arr[0].get("AssetPathName")
                    return None

                meshes.append({
                    "path": rel_path,
                    "name": fname.replace(".json", ""),
                    "slot": armor_key,
                    "itemId": mesh_id,
                    "itemKey": f"ItemName_{armor_key}_{mesh_id}",
                    "malePath": _first_path("MaleAvatarMeshes"),
                    "femalePath": _first_path("FemaleAvatarMeshes"),
                })

    # HeadGears: single AvatarMeshes list, no gender split.
    headgear_dir = os.path.join(SRC, "DataAssets/AvatarParts/HeadGears")
    if os.path.exists(headgear_dir):
        for fname in sorted(os.listdir(headgear_dir)):
            if not fname.endswith(".json") or not fname.startswith("AvatarMesh_"):
                continue
            m = re.search(r"(\d+)\.json$", fname)
            if not m:
                continue
            mesh_id = int(m.group(1))
            full_path = os.path.join(headgear_dir, fname)
            rel_path = os.path.relpath(full_path, SRC).replace(os.sep, "/")
            try:
                data = load_json(full_path)
            except Exception:
                continue
            props = data[0].get("Properties", {})
            arr = props.get("AvatarMeshes", []) or []
            mesh_path = _clean_parent_name(arr[0].get("AssetPathName")) if arr else None
            meshes.append({
                "path": rel_path,
                "name": fname.replace(".json", ""),
                "slot": "HeadGear",
                "itemId": mesh_id,
                "itemKey": None,  # HeadGear is not confirmed to share the Upper/Lower/Glove/Shield ItemName_{slot}_{id} convention -- left unresolved rather than guessed
                "malePath": mesh_path,
                "femalePath": mesh_path,  # no gender split for this slot -- same path shown for both, not duplicated data
            })

    # Equipment: 6 weapon categories (MainWeaponMesh) + Shield
    # (ShieldMesh) -- reuses the SAME WEAPON_CATEGORIES/ARMOR_CATEGORIES
    # prefix config every other weapon/armor lookup in this file
    # already uses, not a separate hardcoded map.
    equipment_root = os.path.join(SRC, "DataAssets/AvatarParts/Equipment")
    if os.path.exists(equipment_root):
        for cat_folder in sorted(os.listdir(equipment_root)):
            cat_dir = os.path.join(equipment_root, cat_folder)
            if not os.path.isdir(cat_dir):
                continue
            is_shield = cat_folder == "Shield"
            cat_cfg = ARMOR_CATEGORIES.get("Shield") if is_shield else WEAPON_CATEGORIES.get(cat_folder)
            if not cat_cfg:
                continue
            mesh_field = "ShieldMesh" if is_shield else "MainWeaponMesh"
            item_prefix = cat_cfg.get("texPrefix") if is_shield else cat_cfg.get("prefix")

            for fname in sorted(os.listdir(cat_dir)):
                if not fname.endswith(".json"):
                    continue
                m = re.search(r"(\d+)\.json$", fname)
                if not m:
                    continue
                mesh_id = int(m.group(1))
                full_path = os.path.join(cat_dir, fname)
                rel_path = os.path.relpath(full_path, SRC).replace(os.sep, "/")
                try:
                    data = load_json(full_path)
                except Exception:
                    continue
                props = data[0].get("Properties", {})
                mesh_ref = props.get(mesh_field, {}) or {}
                mesh_path = _clean_parent_name(mesh_ref.get("AssetPathName")) or mesh_ref.get("AssetPathName")
                item_key = f"ItemName_{item_prefix}_{mesh_id}" if item_prefix else None
                meshes.append({
                    "path": rel_path,
                    "name": fname.replace(".json", ""),
                    "slot": "Shield" if is_shield else cat_folder,
                    "itemId": mesh_id,
                    "itemKey": item_key,
                    "malePath": mesh_path,  # weapons/shields aren't gendered -- same path under both keys for a consistent shape across every mesh entry
                    "femalePath": mesh_path,
                })

    meshes.sort(key=lambda m: (m["slot"], m["itemId"]))
    save_json(os.path.join(OUT, "DataAssets/_AssetInspector/Meshes.json"), meshes)

    slot_counts = {}
    for m in meshes:
        slot_counts[m["slot"]] = slot_counts.get(m["slot"], 0) + 1
    print(f"  Asset Inspector (Meshes): {len(meshes)} total")
    for slot, count in sorted(slot_counts.items(), key=lambda x: -x[1]):
        print(f"    {slot}: {count}")

    return meshes


def build_asset_inspector_index(all_materials, all_meshes):
    """
    Small combining step that runs after BOTH build_asset_materials()
    and build_asset_meshes() -- writes the single _index.json the
    frontend's coverage banner reads, rather than either builder
    guessing at or partially writing the other's count.
    """
    save_json(os.path.join(OUT, "DataAssets/_AssetInspector/_index.json"), {
        "materialCount": len(all_materials),
        "materialInstanceCount": sum(1 for m in all_materials if m["assetType"] == "MaterialInstanceConstant"),
        "baseMaterialCount": sum(1 for m in all_materials if m["assetType"] == "Material"),
        "meshCount": len(all_meshes),
    })


def build_player_config():
    """
    Player section (Characters > Player) config -- the raw per-level/
    per-stat curve data needed to build an interactive "create your
    build" simulator: how many Growth Points you have at a given
    level, how much EXP each level requires, and the level-based stat
    caps from HeroStatusParameters.json.

    Two genuinely different curve SHAPES exist in this data, and both
    are preserved as-is rather than collapsed into one interpretation:

    1. GrowPointCurve2.json / HeroExperienceCurve2.json -- RODCurveFloat
       assets with a pre-baked IntegerCache array, one entry per LEVEL
       (index 0..200, confirmed length 201 matching the same 200-level
       cap used elsewhere in this project for Partners). GrowPointCurve2's
       cache is the Growth Points AWARDED at that specific level (e.g.
       index 15 = points earned reaching level 15, not a running total);
       summing indices 0..15 gives 36, confirmed to match exactly what
       the user's own in-game screenshot shows at Level 15 ("Growth
       Points: 0/36"). This file is used directly -- no interpolation
       needed, since every level already has its own baked entry.

    2. CT_GrowthParam.json (VIT/END/MND) and HeroStatusParameters.json
       (MaxHealth/MaxStamina/MaxSoul/MaxHunger/MaxSpeed/MaxStability/
       ATK/DEF) -- real UE CurveTables with sparse Time/Value keyframe
       pairs (linear interpolation between them), not a baked per-level
       array. These are NOT both keyed by character level: CT_GrowthParam
       most likely keys by the STAT'S OWN RAW VALUE (its "Time" tier
       breakpoints of 1/30/60/90 closely mirror AbilityScoreTable's
       1/31/61 ACV-rank tiers, which IS confirmed keyed by stat value,
       not level -- and VIT's value at Time=1 is exactly 200, matching
       HeroStatusParameters' MaxHealth at floor stats in the same
       screenshot). This is a strong, data-grounded hypothesis, not an
       empirical confirmation -- there is no non-floor-stat screenshot
       available to verify it the way the ACV formula was verified
       against 3 separate screenshots. Both raw curves are shipped as-is
       so the frontend can interpolate and label the result accordingly
       (see the Player tab UI / Data Coverage's Player Build section for
       exactly how this honesty distinction is surfaced).

    Output is pure config/curve data -- no item-key cross-referencing
    happens at build time. Weapon/armor selection and the live ATK/DEF
    calculation both happen client-side, reusing the already-built and
    already-verified weapon/armor JSON and the existing acv-engine.js
    functions (computeACV/simulateTotalATK), not a new formula.
    """
    def load_integer_cache(rel_path):
        d = load_json(os.path.join(SRC, rel_path))
        return d[0]["Properties"]["IntegerCache"]

    def load_curve_rows(rel_path):
        d = load_json(os.path.join(SRC, rel_path))
        rows = d[0]["Rows"]
        out = {}
        for row_name, row in rows.items():
            out[row_name] = [{"time": k["Time"], "value": k["Value"]} for k in row["Keys"]]
        return out

    grow_points_per_level = load_integer_cache("DataAssets/Parameters/Hero/GrowPointCurve2.json")
    exp_required_per_level = load_integer_cache("DataAssets/Parameters/Hero/HeroExperienceCurve2.json")
    # Weapon Proficiency curve, visible in the user's reference
    # screenshot ("Weapon Proficiency 3, Until Next Lv. 0/0") -- real
    # data exists (a per-proficiency-level point threshold, much
    # shorter than the 201-entry level curves, only 13 entries),
    # but nothing in this export ties weapon USE (hits/kills/whatever
    # actually earns these points) to a numeric rate, and nothing
    # confirms this value feeds the ATK formula at all (the screenshot's
    # ATK=292 is already fully explained by base+ACV+EX-MOD with no
    # remaining unexplained multiplier). Shipped as an honest,
    # informational-only curve -- the frontend exposes it as a separate,
    # clearly-unlinked input, not wired into any total.
    weapon_proficiency_thresholds = load_integer_cache("DataAssets/Parameters/Hero/SwordSkillPointCurve.json")

    # Cumulative total available at each level, computed once here so
    # the frontend doesn't need to re-sum a 201-entry array on every
    # slider tick. growPointsPerLevel itself is also kept in the output
    # for transparency (so e.g. Data Coverage can show the per-level
    # award, not just the running total).
    cumulative = []
    running = 0
    for v in grow_points_per_level:
        running += v
        cumulative.append(int(running))

    hero_status_caps = load_curve_rows("DataAssets/Parameters/Hero/HeroStatusParameters.json")
    growth_param_curves = load_curve_rows("DataAssets/Parameters/Hero/CT_GrowthParam.json")

    config = {
        "maxLevel": len(grow_points_per_level) - 1,
        "growPointsPerLevel": [int(v) for v in grow_points_per_level],
        "growPointsCumulativeByLevel": cumulative,
        "expRequiredByLevel": [int(v) for v in exp_required_per_level],
        "weaponProficiencyThresholds": [int(v) for v in weapon_proficiency_thresholds],
        # Level-based stat CEILINGS (the absolute max representable at a
        # given level, confirmed distinct from the live equipped-gear
        # total -- HeroStatusParameters' own ATK/DEF values are far
        # below any real equipped-weapon total, e.g. 10, confirming this
        # is a ceiling/cap concept, not the displayed live stat).
        "heroStatusCaps": hero_status_caps,
        # Stat-VALUE-keyed HP/Stamina/SP contribution curves.
        "growthParamCurves": growth_param_curves,
        "_confidence": {
            "growPoints": "confirmed — cumulative sum at level 15 matches the user's own in-game screenshot exactly (36)",
            "expRequired": "confirmed present and monotonically increasing; exact 'EXP to next level' semantics not screenshot-verified",
            "heroStatusCaps": "confirmed as level-based ceilings, not live values, by comparing to the already-verified ACV/ATK system",
            "growthParamCurves": "confirmed — at floor stats (VIT/END/MND all 1), this curve's Time=1 values (200/200/150) match the user's own in-game screenshot's HP/Stamina/SP simultaneously, for all 3 stats at once. The SLOPE at higher stat values (30/60/90 breakpoints) is NOT independently screenshot-verified, only the floor value -- treat non-floor results as a strong, data-grounded extrapolation, not an empirical match the way the floor value is.",
            "weaponProficiencyThresholds": "real curve data exists, but nothing in this export confirms what earns these points or that they feed the ATK formula at all -- shown informationally only, never wired into a calculated total",
        },
    }
    save_json(os.path.join(OUT, "DataAssets/Parameters/PlayerConfig.json"), config)
    return config


def build_wwise_audio():
    """
    Walks every AkAudioEvent JSON under raw-export/Content/ROD/WwiseAudio/Events/
    (4449 files, confirmed before this was written) and builds one
    compact index for a dedicated Wwise Audio browser -- distinct from
    DT Inspector, since these are single tiny records (no Rows/
    Properties the way every other category here has), not rows in a
    DataTable. Dumping 4449 "unrecognized shape" entries into DT
    Inspector's flat list would be unusable; this instead preserves the
    REAL organizational structure that already exists in the export
    (the folder hierarchy + the event's own name), per the user's
    request to make this "organized and readable" for someone trying
    to find and replace a specific audio file.
    """
    events_root = os.path.join(SRC, "WwiseAudio", "Events")
    if not os.path.exists(events_root):
        print("  No WwiseAudio/Events found -- skipping.")
        return {}

    events = []
    category_counts = {}

    for root, dirs, files in os.walk(events_root):
        for fname in sorted(files):
            if not fname.endswith(".json"):
                continue
            full_path = os.path.join(root, fname)
            rel_path = os.path.relpath(full_path, events_root).replace(os.sep, "/")
            category = rel_path.split("/")[0]

            try:
                data = load_json(full_path)
            except Exception:
                continue

            if not (isinstance(data, list) and data and isinstance(data[0], dict)):
                continue
            entry = data[0]
            event_name = entry.get("Name", fname.replace(".json", ""))
            cooked = entry.get("EventCookedData", {})
            lang_map = cooked.get("EventLanguageMap", [])

            languages = []
            event_id = None
            soundbank_path = None
            for lm in lang_map:
                lang_name = (lm.get("Key") or {}).get("LanguageName")
                value = lm.get("Value") or {}
                if event_id is None:
                    event_id = value.get("EventId")
                soundbanks = value.get("SoundBanks") or []
                if soundbank_path is None and soundbanks:
                    soundbank_path = soundbanks[0].get("SoundBankPathName")
                media_paths = [m.get("MediaPathName") for m in (value.get("Media") or []) if m.get("MediaPathName")]
                languages.append({
                    "language": lang_name,
                    "mediaPaths": media_paths,
                })

            events.append({
                "path": rel_path,
                "category": category,
                "name": event_name,
                "eventId": event_id,
                "soundBankPath": soundbank_path,
                "languages": languages,
                "mediaFileCount": sum(len(l["mediaPaths"]) for l in languages),
                "isMultiLanguage": len(languages) > 1,
            })
            category_counts[category] = category_counts.get(category, 0) + 1

    events.sort(key=lambda e: e["path"])
    save_json(os.path.join(OUT, "DataAssets/_WwiseAudio/_index.json"), {
        "totalCount": len(events),
        "categoryCounts": category_counts,
    })
    save_json(os.path.join(OUT, "DataAssets/_WwiseAudio/events.json"), events)

    print(f"  Wwise audio: {len(events)} events across {len(category_counts)} categories")
    for cat, count in sorted(category_counts.items(), key=lambda x: -x[1])[:5]:
        print(f"    {cat}: {count}")

    return events


def build_lore_localization(all_lore):
    """
    Build Content/ROD/DataAssets/Database/Lore/Localization/{lang}.json
    -- per-language name + description for every Lore entry.

    CONFIRMED DIFFERENT from every other category's localization
    builder in this file: both DatabaseTitle_WorldView_{id} (name) AND
    DatabaseText_WorldView_{id} (description) resolve against
    ST_GeneralLocalizeList -- NOT ST_DatabaseLocalizeList, which monsters
    and items both use for their description text. Checked directly
    before writing this (ST_DatabaseLocalizeList has zero WorldView_*
    keys at all) rather than assumed from the monster/item pattern.

    Coverage is the best of any category: 177/177 named AND described.

    BUG FIXED (was shipped broken for 8 entries -- 6 towns + 2 dungeons):
    a handful of WorldView name/description strings are themselves
    dynamic substitution TEMPLATES, e.g. "{Rep_AreaTitle_Tolbana}" --
    the SAME kind of pattern Recipes needed (see build_recipes()),
    but with a DIFFERENT resolution rule: Recipes' {Rep_ItemName_X}
    cross-references a separate item by its full key, but
    {Rep_AreaTitle_X} resolves by simply stripping the "Rep_" prefix
    and looking up the result AS A KEY IN THE SAME TABLE
    (ST_GeneralLocalizeList) -- "Rep_AreaTitle_Tolbana" ->
    "AreaTitle_Tolbana" -> "Tolbana". Confirmed against all 79 distinct
    template variables found across the related Area-Title terminal
    data before trusting this rule (100% resolved this way, no
    exceptions) -- not assumed from a single example the way an
    earlier, unrelated formula attempt for Recipes was almost trusted
    on too few samples.

    Same fallback-to-English, verified-until-GAME_LAUNCH_DATE, and
    hand-edits-never-overwritten policies as every other localization
    builder in this file -- EXCEPT: the 8 entries that were written
    with the literal unresolved template before this fix existed are
    deliberately allowed to be regenerated despite the normal
    skip-if-present guard, since they were never actually hand-edited,
    just auto-generated wrong. See _is_unresolved_template_artifact()
    below for exactly how that's detected, so a genuine future hand-edit
    containing "{" for an unrelated reason isn't mistaken for this.
    """
    loc_dir = os.path.join(OUT, "DataAssets/Database/Lore/Localization")
    english_general = load_official_strings(DEFAULT_LANGUAGE)

    def _is_unresolved_template_artifact(entry):
        """
        True only for the specific bug this fix addresses: a name OR
        description that still contains a literal "{Rep_" placeholder.
        """
        return "{Rep_" in entry.get("name", "") or "{Rep_" in entry.get("description", "")

    manifest = {}
    summary_lines = []

    for lang_code, lang_label in SUPPORTED_LANGUAGES.items():
        loc_path = os.path.join(loc_dir, f"{lang_code}.json")
        existing = load_json(loc_path) if os.path.exists(loc_path) else {}
        general_strings = load_official_strings(lang_code)

        entries = dict(existing)
        for title_key, lore in all_lore.items():
            if title_key in entries and not _is_unresolved_template_artifact(entries[title_key]):
                continue  # hand-maintained: never overwrite an existing, genuinely-resolved entry

            name, name_verified, name_source = "", False, None
            if title_key in general_strings:
                name, name_verified = general_strings[title_key], True
                name_source = "Official game localization (Game.json)"
            elif title_key in english_general:
                name, name_verified = english_general[title_key], True
                name_source = f"Fallback to English (no {lang_code} translation found)"
            name = _resolve_rep_templates(name, general_strings, english_general)

            desc_key = lore["descriptionTextKey"]
            description, desc_verified, desc_source = "", False, None
            if desc_key:
                if desc_key in general_strings and general_strings[desc_key] not in (None, "None"):
                    description, desc_verified = general_strings[desc_key], True
                    desc_source = "Official game localization (Game.json)"
                elif desc_key in english_general and english_general[desc_key] not in (None, "None"):
                    description, desc_verified = english_general[desc_key], True
                    desc_source = f"Fallback to English (no {lang_code} translation found)"
            description = _resolve_rep_templates(description, general_strings, english_general)

            entries[title_key] = {
                "name": name,
                "verified": bool(name_verified),
                "source": name_source,
                "description": description,
                "descriptionVerified": bool(desc_verified),
                "descriptionSource": desc_source,
            }

        save_json(loc_path, entries)
        verified_count = sum(1 for v in entries.values() if v["verified"])
        described_count = sum(1 for v in entries.values() if v["descriptionVerified"])
        manifest[lang_code] = {
            "label": lang_label,
            "file": f"DataAssets/Database/Lore/Localization/{lang_code}.json",
            "verifiedCount": verified_count,
            "describedCount": described_count,
            "totalCount": len(entries),
            "hasOfficialSource": len(general_strings) > 0,
        }
        summary_lines.append(
            f"    {lang_code} ({lang_label}): {verified_count}/{len(entries)} named, "
            f"{described_count}/{len(entries)} described"
        )

    manifest["_defaultLanguage"] = DEFAULT_LANGUAGE
    manifest["_gameLaunchDate"] = GAME_LAUNCH_DATE
    save_json(os.path.join(loc_dir, "_manifest.json"), manifest)

    print(f"  Lore localization: {len(all_lore)} entries x {len(SUPPORTED_LANGUAGES)} languages")
    for line in summary_lines:
        print(line)
    return load_json(os.path.join(loc_dir, f"{DEFAULT_LANGUAGE}.json"))


# Character codes that have a dedicated DT_Partner_{code}.json with a
# 200-level stat growth table -- confirmed by checking which files
# actually exist in raw-export/Content/ROD/DataAssets/Parameters/Partner/
# before writing this, not assumed from the screenshot's 7 names alone.
# These 7 (of the Character database's 22 total rows) are the ones
# playable as a following AI partner; the other 15 (including Kirito
# and Diavel) are named characters that appear in the Database menu
# but have no partner-mechanic data anywhere in this export.
PARTNER_CODES = ["ARG", "CAL", "DGT", "IOM", "NAB", "SYU", "WSM"]


def build_characters():
    """
    Parses DT_CharacterDatabase.json (22 rows) into the Characters
    list, and cross-references PARTNER_CODES to flag which 7 are also
    playable Partners (with a 200-level stat growth table -- see
    build_partner_stats() below).

    CONFIRMED DIFFERENT localization wiring than every other category
    built so far: DatabaseInfo[].DatabaseTextKey is "None" on every
    slot of every row here (unlike monsters/items/lore, which all use
    that slot for the actual description text) -- the real description
    lives directly in the top-level DescriptionKey field instead,
    resolving against ST_GeneralLocalizeList as PartnerDescription_{code}.
    Confirmed against both reference screenshots (Iori, Cal) word-for-
    word before this was written.

    Unlock conditions are also different from anything seen before:
    every row is gated by SubProgress (6 rows) or MainProgress (16
    rows) -- i.e. every single Character database entry unlocks via
    story progression, never a simple "Get"/"Hit" the way items/
    monsters do. The raw condition type + numeric value is stored as
    metadata (quest/progress IDs with no further context to decode
    them meaningfully) rather than interpreted.

    Coverage: 9/22 named, 7/22 described (confirmed before this was
    written) -- lower than items/lore, closer to monsters' situation.
    Like monsters, NO image/texture reference exists on any of the 22
    rows (DatabaseImagetID is the placeholder on all of them) --
    characters are 3D models shown in a live rotating viewer, the
    same presentation as monsters, confirmed by the user's reference
    screenshots showing exactly that.

    WEAPON CATEGORY + COMBAT SKILLS (added once DT_PartnerList.json /
    DT_CombinationSlash.json / DT_SupportSkill.json became available --
    this DIRECTLY corrects an earlier conclusion that no weapon-type
    or skill data existed for partners; it didn't exist in the export
    available at the time, but does now): DT_PartnerList.json has an
    explicit WeaponCategory + WeaponID per partner for all 7, resolved
    here to the actual weapon's real name via the SAME WEAPON_CATEGORIES
    prefix map every other weapon lookup in this file already uses
    (e.g. WeaponCategory=OneHandedSword + WeaponID=1 -> ItemName_WOS_1
    -> "Shortsword", confirmed correct before this was written). Only
    3 of the 7 (Argo/Iori/Wyzeman) have a named Combination Slash
    (DT_CombinationSlash.json) and Support Skill (DT_SupportSkill.json)
    -- confirmed by which codes actually appear in those tables, not
    assumed all 7 would; the other 4 simply don't have an entry in
    either table.
    """
    char_db = load_json(os.path.join(SRC, "DataAssets/Database/DT_CharacterDatabase.json"))
    db_rows = char_db[0]["Rows"]

    # Per-partner weapon assignment -- keyed by code (e.g. "ARG").
    partner_list_path = os.path.join(SRC, "DataAssets/Character/Partner/DT_PartnerList.json")
    partner_weapon_by_code = {}
    if os.path.exists(partner_list_path):
        pl_rows = load_json(partner_list_path)[0]["Rows"]
        for v in pl_rows.values():
            code = v.get("ID")
            weapon_category = strip_enum(v.get("WeaponCategory", "")).replace("ItemCategory_", "")
            weapon_id = v.get("WeaponID")
            weapon_item_key = None
            weapon_name_key = None
            cat_cfg = WEAPON_CATEGORIES.get(weapon_category)
            if cat_cfg and weapon_id is not None and weapon_id >= 0:
                weapon_item_key = f"ItemName_{cat_cfg['prefix']}_{weapon_id}"
                weapon_name_key = weapon_item_key  # same key resolves via the existing item-localization getter
            partner_weapon_by_code[code] = {
                "weaponCategory": weapon_category or None,
                "weaponCategoryLabel": cat_cfg["label"] if cat_cfg else None,
                "weaponId": weapon_id if (weapon_id is not None and weapon_id >= 0) else None,
                "weaponItemKey": weapon_item_key,
                "swordSkillIds": [
                    sid for sid in (v.get("SwordSkill1ID"), v.get("SwordSkill2ID"), v.get("SwordSkill3ID"))
                    if sid not in (None, -1, "-1")
                ],
            }

    # Named Combination Slash + Support Skill -- only 3 of 7 codes
    # appear in either table, confirmed directly (see docstring). The
    # localized display name/description for each SkillTagName (e.g.
    # "DoubleCircular" -> "Twin Embrace") is resolved separately by
    # build_partner_skill_localization() below, the same per-language-
    # file pattern every other category in this file uses -- this
    # function only carries the raw, language-agnostic structural data
    # (the tag name itself, point cost, max stack), not resolved text,
    # the same way weaponItemKey above is a key for the item-
    # localization lookup, not a resolved name.
    combo_slash_by_code = {}
    combo_path = os.path.join(SRC, "DataAssets/Character/Partner/DT_CombinationSlash.json")
    if os.path.exists(combo_path):
        for v in load_json(combo_path)[0]["Rows"].values():
            combo_slash_by_code[v.get("ID")] = {
                "skillTagName": v.get("SkillTagName"),
                "cosPointCost": v.get("CoSPointCost"),
            }

    support_skill_by_code = {}
    support_path = os.path.join(SRC, "DataAssets/Character/Partner/DT_SupportSkill.json")
    if os.path.exists(support_path):
        for v in load_json(support_path)[0]["Rows"].values():
            support_skill_by_code[v.get("ID")] = {
                "skillTagName": v.get("SkillTagName"),
                "susPointCost": v.get("SusPointCost"),
                "maxStack": v.get("MaxStack"),
            }

    char_list = []
    for row_key, v in db_rows.items():
        title_key = v.get("DatabaseTitleKey")  # e.g. "PartnerName_IOM"
        code = title_key.replace("PartnerName_", "") if title_key else None
        desc_key = v.get("DescriptionKey")  # e.g. "PartnerDescription_IOM" -- resolved directly, no DatabaseInfo lookup needed
        unlock_info = (v.get("DatabaseInfo") or [{}])[0]

        # Partner-thumbnail coverage is separately confirmed sparse:
        # only 3 of the 7 partner codes (ARG/IOM/WSM) have a dedicated
        # T_Partner_Thumbnail_{code}.png anywhere in either export --
        # checked directly, not assumed all 7 would have one just
        # because they're partners.
        partner_thumb_filename = f"T_Partner_Thumbnail_{code}.png"
        has_partner_thumbnail = code is not None and os.path.exists(
            os.path.join(OUT, "Widget/Common/PartnerThumbnail", partner_thumb_filename)
        )

        entry = {
            "rowKey": row_key,
            "code": code,
            "titleKey": title_key,
            "descriptionKey": desc_key if desc_key != "None" else None,
            "isPartner": code in PARTNER_CODES,
            "unlockCondition": strip_enum(unlock_info.get("AdditionalCondition")),
            "unlockConditionValue": unlock_info.get("ConditionValue"),
            "hasPartnerThumbnail": has_partner_thumbnail,
            "weapon": partner_weapon_by_code.get(code),
            "combinationSlash": combo_slash_by_code.get(code),
            "supportSkill": support_skill_by_code.get(code),
            "textures": {
                "partnerThumbnail": f"Content/ROD/Widget/Common/PartnerThumbnail/{partner_thumb_filename}" if has_partner_thumbnail else None,
            },
        }
        char_list.append(entry)

    # No confirmed in-game order (same situation as monsters/lore) --
    # sort partners first (matches the screenshot's apparent grouping
    # better than a pure alphabetical/code sort would), then by code.
    char_list.sort(key=lambda e: (not e["isPartner"], e["code"] or ""))

    save_json(os.path.join(OUT, "DataAssets/Database/Characters/Characters.json"), char_list)
    save_json(os.path.join(OUT, "DataAssets/Database/Characters/_index.json"), {
        "count": len(char_list),
        "partnerCount": sum(1 for e in char_list if e["isPartner"]),
        "file": "DataAssets/Database/Characters/Characters.json",
    })

    return {e["titleKey"]: e for e in char_list}


def build_character_localization(all_characters):
    """
    Build Content/ROD/DataAssets/Database/Characters/Localization/{lang}.json
    -- per-language name + description for every Character.

    CONFIRMED DIFFERENT from monsters/items/lore: the description comes
    directly from DescriptionKey (e.g. "PartnerDescription_IOM"), not
    from a DatabaseInfo[].DatabaseTextKey lookup -- there's no
    "find the populated slot" step needed here, since the slot is
    always empty and the real key is already sitting on the row.

    Coverage is the lowest of any category's NAME field (9/22) though
    still meaningfully above monsters' fraction -- per the established
    pattern, unnamed characters fall back to their raw code (e.g. "ASN")
    rather than being hidden, consistent with every other category.
    """
    loc_dir = os.path.join(OUT, "DataAssets/Database/Characters/Localization")
    english_general = load_official_strings(DEFAULT_LANGUAGE)

    manifest = {}
    summary_lines = []

    for lang_code, lang_label in SUPPORTED_LANGUAGES.items():
        loc_path = os.path.join(loc_dir, f"{lang_code}.json")
        existing = load_json(loc_path) if os.path.exists(loc_path) else {}
        general_strings = load_official_strings(lang_code)

        entries = dict(existing)
        for title_key, char in all_characters.items():
            if title_key in entries:
                continue  # hand-maintained: never overwrite an existing entry

            name, name_verified, name_source = "", False, None
            if title_key in general_strings:
                name, name_verified = general_strings[title_key], True
                name_source = "Official game localization (Game.json)"
            elif title_key in english_general:
                name, name_verified = english_general[title_key], True
                name_source = f"Fallback to English (no {lang_code} translation found)"

            desc_key = char["descriptionKey"]
            description, desc_verified, desc_source = "", False, None
            if desc_key:
                if desc_key in general_strings and general_strings[desc_key] not in (None, "None"):
                    description, desc_verified = general_strings[desc_key], True
                    desc_source = "Official game localization (Game.json)"
                elif desc_key in english_general and english_general[desc_key] not in (None, "None"):
                    description, desc_verified = english_general[desc_key], True
                    desc_source = f"Fallback to English (no {lang_code} translation found)"

            entries[title_key] = {
                "name": name,
                "verified": bool(name_verified),
                "source": name_source,
                "description": description,
                "descriptionVerified": bool(desc_verified),
                "descriptionSource": desc_source,
            }

        save_json(loc_path, entries)
        verified_count = sum(1 for v in entries.values() if v["verified"])
        described_count = sum(1 for v in entries.values() if v["descriptionVerified"])
        manifest[lang_code] = {
            "label": lang_label,
            "file": f"DataAssets/Database/Characters/Localization/{lang_code}.json",
            "verifiedCount": verified_count,
            "describedCount": described_count,
            "totalCount": len(entries),
            "hasOfficialSource": len(general_strings) > 0,
        }
        summary_lines.append(
            f"    {lang_code} ({lang_label}): {verified_count}/{len(entries)} named, "
            f"{described_count}/{len(entries)} described"
        )

    manifest["_defaultLanguage"] = DEFAULT_LANGUAGE
    manifest["_gameLaunchDate"] = GAME_LAUNCH_DATE
    save_json(os.path.join(loc_dir, "_manifest.json"), manifest)

    print(f"  Character localization: {len(all_characters)} entries x {len(SUPPORTED_LANGUAGES)} languages")
    for line in summary_lines:
        print(line)
    return load_json(os.path.join(loc_dir, f"{DEFAULT_LANGUAGE}.json"))


def build_partner_stats():
    """
    Parses each DT_Partner_{code}.json (one per PARTNER_CODES entry)
    into a per-partner 200-level stat growth table (Defence/Vitality/
    Mind/Endurance/Strength/Dexterity/Agility/Intelligence per level).

    This is genuinely richer data than anything else in the Characters
    section -- confirmed 200 levels per partner, all 8 stat fields
    present on every level, across all 7 files, before this was
    written. Stored as a flat {code: {level: {stats}}} structure rather
    than per-category files, since there are only 7 of these and the
    Partners view needs the whole table at once (e.g. for a level
    slider), not paginated browsing the way a 100+ row DataTable would.
    """
    partner_stats = {}
    for code in PARTNER_CODES:
        path = os.path.join(SRC, "DataAssets/Parameters/Partner", f"DT_Partner_{code}.json")
        if not os.path.exists(path):
            continue  # defensive -- shouldn't happen, all 7 confirmed present
        data = load_json(path)
        rows = data[0]["Rows"]
        partner_stats[code] = {level: stats for level, stats in rows.items()}

    save_json(os.path.join(OUT, "DataAssets/Database/Characters/PartnerStats.json"), partner_stats)
    print(f"  Partner stats: {len(partner_stats)} partners x up to 200 levels each")
    return partner_stats


def build_partner_skill_localization(all_characters):
    """
    Build Content/ROD/DataAssets/Database/Characters/SkillLocalization/{lang}.json
    -- per-language name + description for every Combination Slash and
    Support Skill tag name found on any character (e.g. "DoubleCircular"
    -> name "Twin Embrace" + a mechanical description). Both resolve
    against ST_GeneralLocalizeList as CombinationSrashName_{tag} /
    CombinationSrashDescription_{tag} (note: "Srash", not "Slash" --
    a typo in the game's OWN key names, preserved exactly rather than
    silently corrected, since correcting it would make the key not
    match the real data) and SupportSkillName_{tag} /
    SupportSkillDescription_{tag} respectively.

    Coverage is intentionally small and uneven, confirmed before this
    was written: of the 3 partners with a Combination Slash (ARG/IOM/
    WSM) and the 3 with a Support Skill (same 3 codes), only IOM's pair
    (DoubleCircular / HealZone) resolves in the current localization
    snapshot for either -- ARG's (TwinMoon / Analyze) and WSM's
    (TriStampede / VertigoImpact) resolve to nothing in any of the 13
    language files. Per the established pattern, unresolved entries
    fall back to the raw SkillTagName as their "name" rather than being
    hidden or guessed.
    """
    loc_dir = os.path.join(OUT, "DataAssets/Database/Characters/SkillLocalization")
    english_general = load_official_strings(DEFAULT_LANGUAGE)

    # Collect every distinct skill tag name referenced by any character,
    # split by which key-prefix family it belongs to (Combination Slash
    # vs. Support Skill use different localization key prefixes).
    combo_tags = sorted({c["combinationSlash"]["skillTagName"] for c in all_characters.values()
                         if c.get("combinationSlash") and c["combinationSlash"].get("skillTagName")})
    support_tags = sorted({c["supportSkill"]["skillTagName"] for c in all_characters.values()
                           if c.get("supportSkill") and c["supportSkill"].get("skillTagName")})

    manifest = {}
    summary_lines = []

    for lang_code, lang_label in SUPPORTED_LANGUAGES.items():
        loc_path = os.path.join(loc_dir, f"{lang_code}.json")
        existing = load_json(loc_path) if os.path.exists(loc_path) else {}
        general_strings = load_official_strings(lang_code)

        entries = dict(existing)

        def resolve(tag, name_prefix, desc_prefix):
            key = f"{name_prefix}_{tag}"
            if key in entries:
                return  # hand-maintained: never overwrite an existing entry
            name_key = f"{name_prefix}_{tag}"
            desc_key = f"{desc_prefix}_{tag}"
            name, name_verified, name_source = tag, False, None
            if name_key in general_strings:
                name, name_verified = general_strings[name_key], True
                name_source = "Official game localization (Game.json)"
            elif name_key in english_general:
                name, name_verified = english_general[name_key], True
                name_source = f"Fallback to English (no {lang_code} translation found)"
            description, desc_verified, desc_source = "", False, None
            if desc_key in general_strings and general_strings[desc_key] not in (None, "None"):
                description, desc_verified = general_strings[desc_key], True
                desc_source = "Official game localization (Game.json)"
            elif desc_key in english_general and english_general[desc_key] not in (None, "None"):
                description, desc_verified = english_general[desc_key], True
                desc_source = f"Fallback to English (no {lang_code} translation found)"
            entries[key] = {
                "name": name,
                "verified": bool(name_verified),
                "source": name_source,
                "description": description,
                "descriptionVerified": bool(desc_verified),
                "descriptionSource": desc_source,
            }

        for tag in combo_tags:
            resolve(tag, "CombinationSrashName", "CombinationSrashDescription")
        for tag in support_tags:
            resolve(tag, "SupportSkillName", "SupportSkillDescription")

        save_json(loc_path, entries)
        verified_count = sum(1 for v in entries.values() if v["verified"])
        manifest[lang_code] = {
            "label": lang_label,
            "file": f"DataAssets/Database/Characters/SkillLocalization/{lang_code}.json",
            "verifiedCount": verified_count,
            "totalCount": len(entries),
            "hasOfficialSource": len(general_strings) > 0,
        }
        summary_lines.append(f"    {lang_code} ({lang_label}): {verified_count}/{len(entries)} named")

    manifest["_defaultLanguage"] = DEFAULT_LANGUAGE
    manifest["_gameLaunchDate"] = GAME_LAUNCH_DATE
    save_json(os.path.join(loc_dir, "_manifest.json"), manifest)

    print(f"  Partner skill localization: {len(combo_tags)} combination slash + {len(support_tags)} support skill tags x {len(SUPPORTED_LANGUAGES)} languages")
    for line in summary_lines:
        print(line)
    return load_json(os.path.join(loc_dir, f"{DEFAULT_LANGUAGE}.json"))


# Maps each AvatarCustomizeDataAsset.json field to a display label and
# the texture-thumbnail folder it uses. Confirmed: parts have NO name
# field anywhere in either export (purely visual swatches, selected by
# thumbnail, not by reading a name) -- so unlike every other category,
# there's no localization builder for these; the ID + thumbnail IS the
# whole record. Voice entries are the one exception with a LocalizeKey
# field, but it resolves to nothing in any of the 13 language files
# (confirmed directly), so even that falls back to its raw ID the same
# honest way an unnamed monster/character does.
AVATAR_PART_FIELDS = {
    "HeadGearPartsDataAsMap": {"label": "Head Gear", "texFolder": "HeadGear"},
    "JawPartsDataAsMap": {"label": "Jaw", "texFolder": "Jaw"},
    "EyebrowPartsDataAsMap": {"label": "Eyebrow", "texFolder": "Eyebrow"},
    "EyelinePartsDataAsMap": {"label": "Eyeline", "texFolder": "Eyeline"},
    "PupilPartsDataAsMap": {"label": "Pupil", "texFolder": "Pupil"},
    "NosePartsDataAsMap": {"label": "Nose", "texFolder": "Nose"},
    "MolePartsDataAsMap": {"label": "Mole", "texFolder": "Mole"},
    "FrecklesPartsDataAsMap": {"label": "Freckles", "texFolder": "Freckles"},
}

AVATAR_COLOR_PALETTE_FIELDS = {
    "GeneralColorPalletDataAsMap": "General",
    "SkinColorPalletDataAsMap": "Skin",
    "LipColorPalletDataAsMap": "Lip",
    "EyeColorPalletDataAsMap": "Eye",
    "EyelineColorPalletDataAsMap": "Eyeline",
    "EyePointColorPalletDataAsMap": "Eye Point",
}


def build_avatar_customize():
    """
    Parses AvatarCustomizeDataAsset.json (face/head parts, voice
    options, 6 color palette categories) and AvatarCustomizePresetData.json
    (21 full-look presets) into the Character Customization sub-section.

    Genuinely different shape from every other category built so far:
    NO name field exists anywhere for parts or color swatches -- they're
    pure visual data (ID + thumbnail, or ID + hex color), selected by
    looking at them, not by reading a label. Voice entries have a
    LocalizeKey field but it resolves to nothing in any of the 13
    language files (confirmed directly) -- so even voices fall back to
    a raw-ID label, the same honest treatment as an unnamed monster.

    This intentionally only reads AvatarCustomizeDataAsset.json (not
    the redundant ThumbnailDataTable/DT_*.json files sitting alongside
    it, confirmed to have identical row counts per part type -- e.g.
    both report 21 Eyebrow entries) and AvatarCustomizePresetData.json.
    The much larger AvatarMesh_*/Costumes/* tree alongside these is
    mesh-rigging/binding configuration for the 3D model pipeline, not
    list-displayable content, and is deliberately left out of scope --
    it stays in raw-export/ for the DT Inspector to surface if anyone
    wants to look, but no UI is built around it here.
    """
    asset = load_json(os.path.join(SRC, "DataAssets/AvatarParts/AvatarCustomize/AvatarCustomizeDataAsset.json"))
    props = asset[0]["Properties"]

    parts = {}
    for field, cfg in AVATAR_PART_FIELDS.items():
        entries = []
        for e in props.get(field, []):
            v = e["Value"]
            tex_path = v.get("ThumbnailTexture", {}).get("AssetPathName")
            entries.append({
                "id": v.get("ID"),
                "textures": {
                    "thumbnail": asset_path_to_texture_key(tex_path) if tex_path else None,
                },
            })
        entries.sort(key=lambda e: e["id"] if e["id"] is not None else 0)
        parts[field] = {"label": cfg["label"], "count": len(entries), "items": entries}

    color_palettes = {}
    for field, label in AVATAR_COLOR_PALETTE_FIELDS.items():
        entries = []
        for e in props.get(field, []):
            v = e["Value"]
            entries.append({
                "id": v.get("ID"),
                "mainColorHex": (v.get("MainColor") or {}).get("Hex"),
                "subColorHex": (v.get("SubColor") or {}).get("Hex"),
            })
        entries.sort(key=lambda e: e["id"] if e["id"] is not None else 0)
        color_palettes[field] = {"label": label, "count": len(entries), "items": entries}

    voices = []
    for e in props.get("VoiceDataAsMap", []):
        v = e["Value"]
        voices.append({
            "id": v.get("ID"),
            "localizeKey": v.get("LocalizeKey"),
            "switchName": v.get("SwitchName"),
        })
    voices.sort(key=lambda e: e["id"] if e["id"] is not None else 0)

    preset_data = load_json(os.path.join(SRC, "DataAssets/AvatarParts/AvatarCustomize/AvatarCustomizePresetData.json"))
    preset_props = preset_data[0]["Properties"]
    preset_thumbs = preset_props.get("PresetThumbnailList", [])
    presets = []
    for i, p in enumerate(preset_props.get("PresetDataList", [])):
        thumb_path = preset_thumbs[i]["AssetPathName"] if i < len(preset_thumbs) else None
        presets.append({
            "presetId": p.get("PresetId"),
            "bodyType": strip_enum(p.get("BodyType")),
            "headGearId": p.get("HeadGearID"),
            "eyebrowId": p.get("EyebrowsID"),
            "eyelineId": p.get("EyelineID"),
            "pupilId": p.get("PupilID"),
            "textures": {
                "thumbnail": asset_path_to_texture_key(thumb_path) if thumb_path else None,
            },
        })

    output = {
        "parts": parts,
        "colorPalettes": color_palettes,
        "voices": voices,
        "presets": presets,
    }
    save_json(os.path.join(OUT, "DataAssets/Database/Characters/AvatarCustomize.json"), output)

    print(f"  Avatar customize: {sum(p['count'] for p in parts.values())} part swatches across "
          f"{len(parts)} categories, {sum(c['count'] for c in color_palettes.values())} color swatches, "
          f"{len(voices)} voices, {len(presets)} presets")
    return output


def build_peculiar_mods():
    attr = load_json(os.path.join(SRC, "DataAssets/Parameters/Shared/DA_AttributeModification.json"))
    props = attr[0]["Properties"]
    pec = {e["Key"]: e["Value"] for e in props["PeculiarModificationData"]}

    clean = {}
    for key, val in pec.items():
        effects = []
        for d in val.get("Data", []):
            for eff in d.get("Effects", []):
                effects.append({
                    "type": strip_enum(eff.get("Type")),
                    "value": eff.get("Value"),
                })
        clean[key] = {
            "key": key,
            "townActive": val.get("bTownActive", False),
            "effects": effects,
            "resolved": True,
        }
    save_json(os.path.join(OUT, "DataAssets/Parameters/Shared/PeculiarModifications.json"), clean)
    return clean


def build_mod_localization(all_referenced_mod_keys):
    """
    Build Content/ROD/DataAssets/Parameters/Shared/Localization/{lang}.json
    -- per-language name + description for every equipment Unique MOD
    key, e.g. EquipmentsModName_AgilityBlast /
    EquipmentsModDescription_AgilityBlast from the official Game.json
    export. This is a SEPARATE datatable/manifest from item localization
    (Items/Localization/) per the user's "one manifest per datatable"
    direction -- PeculiarModifications.json itself (numeric effects,
    townActive flag) stays language-agnostic, same as weapon/armor base
    stats; only the display name/description are localized here.

    IMPORTANT: `all_referenced_mod_keys` must be the UNION of (a) every
    key in PeculiarModificationData (mods with resolved numeric effect
    data) and (b) every key actually referenced in some weapon/armor's
    modNames list -- NOT just (a) alone. Before the official source
    existed, 72 of 191 distinct mod names referenced by weapons/armor
    had no resolved effect data at all (shown as "Unknown Modifier" in
    the app, e.g. AgilityBlast, visible in-game but previously
    undocumented) -- those 72 still won't get NUMERIC effect data from
    this file (that's PeculiarModificationData's separate job), but
    passing only the resolved subset here would silently skip
    localizing exactly the mods this update was meant to fix. Every key
    actually seen on an item, resolved or not, gets a name+description
    lookup attempt against the official table.

    Same fallback chain as item localization: a language missing a
    specific mod's name/description falls back to English, tagged
    distinctly from a native translation. Same verified=True-until-
    GAME_LAUNCH_DATE policy as item localization (see build_localization
    docstring for the full reasoning -- not repeated here).

    Hand-maintained the same way: existing entries are never overwritten
    on re-run, only new keys get added.
    """
    loc_dir = os.path.join(OUT, "DataAssets/Parameters/Shared/Localization")
    english_strings = load_official_strings(DEFAULT_LANGUAGE)

    manifest = {}
    summary_lines = []

    for lang_code, lang_label in SUPPORTED_LANGUAGES.items():
        loc_path = os.path.join(loc_dir, f"{lang_code}.json")
        existing = load_json(loc_path) if os.path.exists(loc_path) else {}
        official_strings = load_official_strings(lang_code)

        entries = dict(existing)
        for mod_key in all_referenced_mod_keys:
            if mod_key in entries:
                # Hand-maintained: never overwrite an entry that
                # already exists, whether auto-generated by an earlier
                # run or hand-edited afterward.
                continue

            name_key = f"EquipmentsModName_{mod_key}"
            desc_key = f"EquipmentsModDescription_{mod_key}"

            name, name_verified, name_source = "", False, None
            if name_key in official_strings:
                name, name_verified = official_strings[name_key], True
                name_source = "Official game localization (Game.json)"
            elif name_key in english_strings:
                name, name_verified = english_strings[name_key], True
                name_source = f"Fallback to English (no {lang_code} translation found)"

            description, desc_verified, desc_source = "", False, None
            if desc_key in official_strings:
                description, desc_verified = official_strings[desc_key], True
                desc_source = "Official game localization (Game.json)"
            elif desc_key in english_strings:
                description, desc_verified = english_strings[desc_key], True
                desc_source = f"Fallback to English (no {lang_code} translation found)"

            entries[mod_key] = {
                "name": name,
                "verified": bool(name_verified),
                "source": name_source,
                "description": description,
                "descriptionVerified": bool(desc_verified),
                "descriptionSource": desc_source,
            }

        save_json(loc_path, entries)

        verified_count = sum(1 for v in entries.values() if v["verified"])
        described_count = sum(1 for v in entries.values() if v["descriptionVerified"])
        manifest[lang_code] = {
            "label": lang_label,
            "file": f"DataAssets/Parameters/Shared/Localization/{lang_code}.json",
            "verifiedCount": verified_count,
            "describedCount": described_count,
            "totalCount": len(entries),
            "hasOfficialSource": len(official_strings) > 0,
        }
        summary_lines.append(
            f"    {lang_code} ({lang_label}): {verified_count}/{len(entries)} named, "
            f"{described_count}/{len(entries)} described"
        )

    manifest["_defaultLanguage"] = DEFAULT_LANGUAGE
    manifest["_gameLaunchDate"] = GAME_LAUNCH_DATE
    save_json(os.path.join(loc_dir, "_manifest.json"), manifest)

    print(f"  Mod localization: {len(all_referenced_mod_keys)} mods x {len(SUPPORTED_LANGUAGES)} languages")
    for line in summary_lines:
        print(line)
    return load_json(os.path.join(loc_dir, f"{DEFAULT_LANGUAGE}.json"))


# HISTORICAL / NO LONGER THE SOURCE OF TRUTH as of this version. This
# was the original hand-maintained EX-MOD label mapping, used before
# the official Game.json export existed -- 9 of 26 entries were
# confirmed against actual screenshots (Annealed Blade, Steel Sword,
# Steel Rapier: BonusATK, BonusSP, EnhNormalDmg, EnhExtraDmg, EnhSSDmg,
# EnhSlashDmg, CoefCoSPoint, CoefStamina, CoefCombatSprint), and the
# other 17 were best-guesses from the enum name alone, never verified.
# Now that AttributeModName_EX_{type} in the official Game.json export
# resolves ALL 26 types' labels (and their +/-/% format) directly from
# game data, in every supported language, this table is kept ONLY so
# the old confirmed/guessed history isn't lost (in keeping with this
# project's practice of documenting confidence levels, even ones that
# have since been superseded by a better source) -- build_ex_mod_pool()
# below does not read from it anymore.
EX_MOD_DISPLAY_MAP_HISTORICAL = {
    "BonusHealth":       {"label": "HP",                              "format": "+{v}",  "confirmed": False},
    "BonusStamina":      {"label": "Stamina",                         "format": "+{v}",  "confirmed": False},
    "BonusSP":           {"label": "SP",                              "format": "+{v}",  "confirmed": True},
    "BonusATK":          {"label": "ATK",                             "format": "+{v}",  "confirmed": True},
    "BonusDEF":          {"label": "DEF",                             "format": "+{v}",  "confirmed": False},
    "EnhSSDmg":          {"label": "Sword Skill Damage",              "format": "+{v}%", "confirmed": True},
    "EnhSlashDmg":       {"label": "Slash Damage",                    "format": "+{v}%", "confirmed": True},
    "EnhDown":           {"label": "Down Damage",                     "format": "+{v}%", "confirmed": False},
    "EnhDodge":          {"label": "Dodge",                           "format": "+{v}%", "confirmed": False},
    "CoefCombatSprint":  {"label": "Sprint Speed",                    "format": "+{v}%", "confirmed": True},
    "EnhSlash":          {"label": "Slash Enhancement",               "format": "+{v}%", "confirmed": False},
    "CoefSP":            {"label": "SP Consumption",                  "format": "-{v}%", "confirmed": False},
    "CoefStamina":       {"label": "Stamina Consumption",             "format": "-{v}%", "confirmed": True},
    "CoefExp":           {"label": "EXP Gain",                        "format": "+{v}%", "confirmed": False},
    "CoefCol":           {"label": "Col Gain",                        "format": "+{v}%", "confirmed": False},
    "CoefResist":        {"label": "Status Resistance",               "format": "+{v}%", "confirmed": False},
    "EnhHealCrystal":    {"label": "Healing Crystal Effect",          "format": "+{v}%", "confirmed": False},
    "CoefGrantBSDamage": {"label": "Combination Slash Damage Granted","format": "+{v}%", "confirmed": False},
    "CoefSSCoolTime":    {"label": "Sword Skill Cooldown",            "format": "-{v}%", "confirmed": False},
    "CoefSuSPoint":      {"label": "SP Point (Sword)",                "format": "+{v}%", "confirmed": False},
    "EnhAtkSpeed":       {"label": "Attack Speed",                    "format": "+{v}%", "confirmed": False},
    "EnhBSDmg":          {"label": "Combination Slash Damage",        "format": "+{v}%", "confirmed": False},
    "DamageReduce":      {"label": "Damage Reduction",                "format": "+{v}%", "confirmed": False},
    "EnhNormalDmg":      {"label": "Normal Attack Damage",            "format": "+{v}%", "confirmed": True},
    "EnhExtraDmg":       {"label": "Extra Attack Damage",             "format": "+{v}%", "confirmed": True},
    "CoefCoSPoint":      {"label": "Combo SP Increased",              "format": "+{v}%", "confirmed": True},
}

# The demo build only seems to roll ATK bonus within indices 1-4 of its
# 10-tier array (values 20/25/30/35), not the full 0-9 range (15-60) --
# inferred from observed screenshots (Annealed Blade ATK+35, Steel Rapier
# ATK+35), not confirmed against a data field that states this explicitly.
# We don't have direct evidence for every other EX-MOD type's demo range,
# so this same [1,4] window is applied as a best-guess default to all
# types for now -- surfaced as a note in the picker UI rather than
# silently asserted as confirmed for types we haven't actually seen roll.
DEMO_OBSERVED_MIN_TIER_INDEX = 1
DEMO_OBSERVED_MAX_TIER_INDEX = 4


def build_ex_mod_pool():
    """
    Builds the language-agnostic EX-MOD structural pool (type, tiers,
    demo-observed range) -- English label/format now comes from the
    official Game.json source via split_ex_mod_label() rather than the
    old hand-maintained EX_MOD_DISPLAY_MAP_HISTORICAL guesses, so every
    one of the 26 types now has a labelConfirmed=True English label
    (previously only 9/26 were confirmed). Per-language labels/formats
    are NOT stored here -- see build_ex_mod_localization() below, same
    split as item/mod name+description vs. PeculiarModifications.json's
    language-agnostic effect data.
    """
    attr = load_json(os.path.join(SRC, "DataAssets/Parameters/Shared/DA_AttributeModification.json"))
    props = attr[0]["Properties"]
    extra = props["ExtraModificationData"]
    english_strings = load_official_strings(DEFAULT_LANGUAGE)

    pool = []
    for entry in extra:
        raw_type = strip_enum(entry["Key"])
        tiers = entry["Value"]["Effects"]

        official_key = f"AttributeModName_EX_{raw_type}"
        if official_key in english_strings:
            label, fmt = split_ex_mod_label(english_strings[official_key])
            label_confirmed = True
        else:
            # Defensive fallback only -- every one of the 26 known
            # types resolves against the official source as of this
            # version (confirmed 26/26 before this code was written).
            # This branch exists so an unexpected future 27th type
            # degrades to a readable guess instead of crashing.
            historical = EX_MOD_DISPLAY_MAP_HISTORICAL.get(raw_type, {})
            label = historical.get("label", raw_type)
            fmt = historical.get("format", "+{v}")
            label_confirmed = False

        pool.append({
            "type": raw_type,
            "label": label,
            "format": fmt,
            "labelConfirmed": label_confirmed,
            "tiers": tiers,
            "demoObservedMinTierIndex": DEMO_OBSERVED_MIN_TIER_INDEX,
            "demoObservedMaxTierIndex": DEMO_OBSERVED_MAX_TIER_INDEX,
        })

    save_json(os.path.join(OUT, "DataAssets/Parameters/Shared/ExModPool.json"), pool)
    confirmed_count = sum(1 for p in pool if p["labelConfirmed"])
    print(f"  EX-MOD pool: {len(pool)} types ({confirmed_count} with confirmed labels)")
    return pool


def build_ex_mod_localization(ex_mod_types):
    """
    Build Content/ROD/DataAssets/Parameters/Shared/ExModLocalization/{lang}.json
    -- per-language label + format string for every EX-MOD type, e.g.
    {"BonusATK": {"label": "ATK", "format": "+{v}", ...}, ...}, sourced
    from AttributeModName_EX_{type} in the official Game.json export via
    split_ex_mod_label(). Own datatable/manifest (one per datatable, per
    the user's direction) -- separate from the language-agnostic
    ExModPool.json (type/tiers/demo-range) the same way item/mod names
    are split from their language-agnostic stat/effect data elsewhere
    in this pipeline.

    Same fallback-to-English and verified-until-GAME_LAUNCH_DATE policy
    as the other localization builders in this file.
    """
    loc_dir = os.path.join(OUT, "DataAssets/Parameters/Shared/ExModLocalization")
    english_strings = load_official_strings(DEFAULT_LANGUAGE)

    manifest = {}
    summary_lines = []

    for lang_code, lang_label in SUPPORTED_LANGUAGES.items():
        loc_path = os.path.join(loc_dir, f"{lang_code}.json")
        existing = load_json(loc_path) if os.path.exists(loc_path) else {}
        official_strings = load_official_strings(lang_code)

        entries = dict(existing)
        for ex_type in ex_mod_types:
            if ex_type in entries:
                # Hand-maintained: never overwrite an entry that
                # already exists, whether auto-generated by an earlier
                # run or hand-edited afterward.
                continue

            official_key = f"AttributeModName_EX_{ex_type}"

            if official_key in official_strings:
                raw = official_strings[official_key]
                verified, source = True, "Official game localization (Game.json)"
            elif official_key in english_strings:
                raw = english_strings[official_key]
                verified = True
                source = f"Fallback to English (no {lang_code} translation found)"
            else:
                raw, verified, source = None, False, None

            if raw is not None:
                label, fmt = split_ex_mod_label(raw)
            else:
                label, fmt = ex_type, "+{v}"

            entries[ex_type] = {
                "label": label,
                "format": fmt,
                "verified": bool(verified),
                "source": source,
            }

        save_json(loc_path, entries)
        verified_count = sum(1 for v in entries.values() if v["verified"])
        manifest[lang_code] = {
            "label": lang_label,
            "file": f"DataAssets/Parameters/Shared/ExModLocalization/{lang_code}.json",
            "verifiedCount": verified_count,
            "totalCount": len(entries),
            "hasOfficialSource": len(official_strings) > 0,
        }
        summary_lines.append(f"    {lang_code} ({lang_label}): {verified_count}/{len(entries)} verified")

    manifest["_defaultLanguage"] = DEFAULT_LANGUAGE
    manifest["_gameLaunchDate"] = GAME_LAUNCH_DATE
    save_json(os.path.join(loc_dir, "_manifest.json"), manifest)

    print(f"  EX-MOD localization: {len(ex_mod_types)} types x {len(SUPPORTED_LANGUAGES)} languages")
    for line in summary_lines:
        print(line)
    return load_json(os.path.join(loc_dir, f"{DEFAULT_LANGUAGE}.json"))


def build_mod_coverage_report(all_weapons, resolved_mods):
    """Cross-reference every weapon ModNames entry against resolved PeculiarModificationData."""
    all_mod_refs = set()
    for w in all_weapons.values():
        all_mod_refs.update(w["modNames"])

    report = {
        "totalModNamesReferenced": len(all_mod_refs),
        "resolved": sorted(m for m in all_mod_refs if m in resolved_mods),
        "unresolved": sorted(m for m in all_mod_refs if m not in resolved_mods),
    }
    save_json(os.path.join(OUT, "DataAssets/Parameters/Shared/ModCoverageReport.json"), report)
    return report


_OFFICIAL_STRINGS_CACHE = {}


def load_official_strings(lang_code):
    """
    Loads and caches ST_GeneralLocalizeList from
    raw-export/Content/ROD/Localization/Game/{lang_code}/Game.json --
    the official UE string-table export covering item names/
    descriptions, equipment mod names/descriptions, and EX-MOD labels
    for every language. Returns {} if that language's file isn't
    present (caller falls back to other sources from there).
    """
    if lang_code in _OFFICIAL_STRINGS_CACHE:
        return _OFFICIAL_STRINGS_CACHE[lang_code]
    path = os.path.join(SRC, "Localization", "Game", lang_code, "Game.json")
    if not os.path.exists(path):
        _OFFICIAL_STRINGS_CACHE[lang_code] = {}
        return {}
    data = load_json(path)
    strings = data.get("ST_GeneralLocalizeList", {})
    _OFFICIAL_STRINGS_CACHE[lang_code] = strings
    return strings


# Matches official EX-MOD label strings like "HP +{Num}",
# "Sword Skill Damage +{Num}%", "SP-Verbrauch -{Num} %" (German/French
# insert a space before the percent sign), "剑技伤害+{Num}％" (Chinese
# uses the full-width ％ rather than ASCII %). Captures:
#   group 1 = the label text with the sign/placeholder stripped off
#   group 2 = the sign (+ or -)
#   group 3 = the percent character if present (any width), else ""
# This is intentionally tolerant of the inter-language spacing/character
# differences above since it's parsing 13 languages' worth of strings
# that an English-only-authored regex would otherwise silently miss --
# confirmed to parse all 26 EX-MOD types across all 13 languages
# (338/338) before this pattern was adopted.
EX_MOD_LABEL_PATTERN = re.compile(r"^(.*?)\s*([+-])\s*\{Num\}\s*([%％]?)$")


def split_ex_mod_label(raw_string):
    """
    Splits an official AttributeModName_EX_{type} string into a clean
    display label and a format template, e.g.:
      "Sword Skill Damage +{Num}%" -> ("Sword Skill Damage", "+{v}%")
      "SP Consumption -{Num}%"     -> ("SP Consumption", "-{v}%")
      "HP +{Num}"                  -> ("HP", "+{v}")
    Returns (raw_string, "+{v}") unchanged if the pattern doesn't match
    (so an unexpected future string degrades gracefully rather than
    crashing the build) -- this should not happen given 338/338 known
    strings parse cleanly, but the build pipeline should never hard-fail
    on a single new/unexpected localization string.
    """
    m = EX_MOD_LABEL_PATTERN.match(raw_string)
    if not m:
        return raw_string, "+{v}"
    label, sign, pct = m.groups()
    fmt = sign + "{v}" + ("%" if pct else "")
    return label, fmt

def build_localization(all_weapons, all_armor):
    """
    Build Content/ROD/DataAssets/Items/Localization/{lang}.json for
    every language in SUPPORTED_LANGUAGES, plus a _manifest.json (one
    manifest per datatable, per the user's direction -- this is the
    manifest for the Items/Equipment name+description datatable
    specifically; mod localization gets its own, see
    build_mod_localization() below).

    SOURCE PRIORITY per item key, per language:
      1. Official Game.json export (ST_GeneralLocalizeList,
         ItemName_{key} / ItemDescription_{key}) -- ground truth, the
         actual string table the game itself ships. This now covers
         weapons (121/127), armor (68/70), AND item descriptions for
         all of those (584 total across the whole item table) -- a
         major upgrade from the old weapon-names-only source.
      2. Old weapon_names_{code}.json (legacy primary source for
         weapon names only, no descriptions) -- kept as a fallback per
         the user's "fallback where possible" direction, in case a
         future language ever has the old file but not yet the new
         Game.json export. Every key in here was already cross-checked
         against the new source with zero conflicts (121/121 match),
         so this fallback is safe.
      3. Hand-verified seed table (armor names only, English only) --
         the original screenshot/xlsx-derived names from before any
         official source existed. ONE genuine conflict was found
         against the new official source (ItemName_Glove_5: hand-typed
         "Bandage Gloves" vs. official "Bandage Guards") -- official
         wins per the user's direction, logged below rather than
         silently dropped.
      4. Raw ItemKey with no name/description -- verified=False, per
         the existing app convention of falling back to showing the
         raw key string.

    FALLBACK CHAIN ACROSS LANGUAGES: a small number of keys (~5-9 out
    of ~3700) are missing from non-English Game.json exports entirely
    (cutscene/tutorial strings added after the other languages' last
    translation pass) -- none of the missing keys observed so far are
    ItemName/ItemDescription keys, but as a defensive measure, any
    language missing a name/description for a given item key falls
    back to the English text for that key, tagged
    source="Fallback to English (no {lang_code} translation found)"
    so the UI can show this is a fallback rather than a native
    translation, distinct from a verified native one.

    VERIFIED FLAG: per the user, every entry sourced from official data
    is verified=True unconditionally through GAME_LAUNCH_DATE (the
    game hasn't shipped yet, so there's currently no way to distinguish
    real content from a future-content placeholder -- both look
    identical in the export). After that date, a HUMAN can hand-flag a
    specific entry verified=False if its in-game status becomes
    genuinely uncertain; this script never does that automatically.

    This file is hand-maintained going forward per language the same
    way as before: re-running the build pipeline will NOT overwrite an
    entry already present in a given language's file, only add new
    keys it doesn't recognize yet -- so a manual correction made after
    this build (e.g. flagging a future placeholder unverified) always
    survives a re-run.
    """
    loc_dir = os.path.join(OUT, "DataAssets/Items/Localization")
    all_items = {**all_weapons, **all_armor}

    # English-only hand-verified fallback seed table (xlsx/screenshot-
    # derived), used only for an item key that the official source
    # doesn't cover AT ALL for English. Kept verbatim from the earlier
    # build for traceability even though the official source has now
    # superseded all but one of these (see conflicts_log below).
    armor_seed_names_en = {
        "ItemName_Upper_99": "Proto-Guardian Jacket",
        "ItemName_Upper_4": "Leather Shirt",
        "ItemName_Upper_7": "Soldier's Mail",
        "ItemName_Glove_99": "Proto-Bullet Gloves",
        "ItemName_Glove_7": "Iron Bangles",
        "ItemName_Glove_5": "Bandage Gloves",
        "ItemName_Lower_99": "Proto-Journey Pants",
        "ItemName_Lower_7": "Bronze Boots",
        "ItemName_Shield_11": "Round Shield",
        "ItemName_Shield_99": "Proto-Veil Shield",
    }

    # Old per-weapon-language files, kept as a secondary fallback
    # source per the user's "fallback where possible" direction.
    def load_legacy_weapon_names(lang_code):
        path = os.path.join(SRC, "Localization", f"weapon_names_{lang_code}.json")
        return load_json(path) if os.path.exists(path) else {}

    manifest = {}
    summary_lines = []
    conflicts_log = []  # [(item_key, hand_value, official_value)]

    english_strings = load_official_strings(DEFAULT_LANGUAGE)

    for lang_code, lang_label in SUPPORTED_LANGUAGES.items():
        loc_path = os.path.join(loc_dir, f"{lang_code}.json")
        existing = load_json(loc_path) if os.path.exists(loc_path) else {}

        official_strings = load_official_strings(lang_code)
        legacy_names = load_legacy_weapon_names(lang_code)

        entries = dict(existing)
        for item_key in all_items:
            if item_key in entries:
                # Hand-maintained: an entry already present (whether
                # auto-generated by an earlier run or hand-edited
                # afterward, e.g. a human flagging verified=False for
                # a future-content placeholder per GAME_LAUNCH_DATE
                # policy) is NEVER recomputed or overwritten. Only a
                # key with no entry yet gets resolved below.
                continue

            name_key = item_key  # e.g. "ItemName_WOS_1"
            desc_key = item_key.replace("ItemName_", "ItemDescription_", 1)

            # ---- Resolve the display name ----
            name, name_verified, name_source = None, False, None

            if name_key in official_strings:
                name, name_verified = official_strings[name_key], True
                name_source = "Official game localization (Game.json)"
                if (lang_code == DEFAULT_LANGUAGE
                        and item_key in armor_seed_names_en
                        and armor_seed_names_en[item_key] != name):
                    conflicts_log.append((item_key, armor_seed_names_en[item_key], name))
            elif name_key in legacy_names:
                name, name_verified = legacy_names[name_key], True
                name_source = f"Legacy fallback (weapon_names_{lang_code}.json)"
            elif lang_code == DEFAULT_LANGUAGE and item_key in armor_seed_names_en:
                name, name_verified = armor_seed_names_en[item_key], True
                name_source = (
                    "Inferred from in-game MOD='None' + the 'Proto-' pattern "
                    "confirmed on every other category's id-99 starter item"
                    if item_key == "ItemName_Shield_99"
                    else "In-game screenshot (pre-dates official localization upload)"
                )
            elif name_key in english_strings:
                # Fallback chain: no translation in THIS language, but
                # English has one -- show English rather than the raw
                # key, tagged distinctly from a native verified name.
                name, name_verified = english_strings[name_key], True
                name_source = f"Fallback to English (no {lang_code} translation found)"

            # ---- Resolve the description (same priority, official-only --
            # no legacy/hand-seed source ever existed for descriptions) ----
            description, desc_verified, desc_source = None, False, None
            if desc_key in official_strings:
                description = official_strings[desc_key]
                desc_verified, desc_source = True, "Official game localization (Game.json)"
            elif desc_key in english_strings:
                description = english_strings[desc_key]
                desc_verified = True
                desc_source = f"Fallback to English (no {lang_code} translation found)"

            entries[item_key] = {
                "name": name or "",
                "verified": bool(name_verified),
                "source": name_source,
                "description": description or "",
                "descriptionVerified": bool(desc_verified),
                "descriptionSource": desc_source,
            }

        save_json(loc_path, entries)

        verified_count = sum(1 for v in entries.values() if v["verified"])
        described_count = sum(1 for v in entries.values() if v["descriptionVerified"])
        manifest[lang_code] = {
            "label": lang_label,
            "file": f"DataAssets/Items/Localization/{lang_code}.json",
            "verifiedCount": verified_count,
            "describedCount": described_count,
            "totalCount": len(entries),
            "hasOfficialSource": len(official_strings) > 0,
        }
        summary_lines.append(
            f"    {lang_code} ({lang_label}): {verified_count}/{len(entries)} named, "
            f"{described_count}/{len(entries)} described"
            + (" [official Game.json]" if official_strings else " [no official source]")
        )

    manifest["_defaultLanguage"] = DEFAULT_LANGUAGE
    manifest["_gameLaunchDate"] = GAME_LAUNCH_DATE
    save_json(os.path.join(loc_dir, "_manifest.json"), manifest)

    # Ambiguous-pairs tracking: fully resolved for weapons once the
    # official English table arrived. Kept as an empty, structurally-
    # ready list (not removed) so the Data Coverage UI degrades to "no
    # open questions" instead of erroring if it's ever needed again.
    save_json(os.path.join(loc_dir, "ambiguous_name_pairs.json"), [])

    print(f"  Localization: {len(SUPPORTED_LANGUAGES)} languages processed")
    for line in summary_lines:
        print(line)
    if conflicts_log:
        print(f"  {len(conflicts_log)} conflict(s) between hand-verified and official source "
              f"(official source wins, per project policy):")
        for item_key, hand_val, official_val in conflicts_log:
            print(f"    {item_key}: hand-verified={hand_val!r}  official={official_val!r}")

    return load_json(os.path.join(loc_dir, f"{DEFAULT_LANGUAGE}.json"))



# Asset paths in these exports look like:
#   /Game/ROD/Widget/Database/Thumbnail/Equipment/T_Database_Thumbnail_Equipment_WOS1.T_Database_Thumbnail_Equipment_WOS1
# i.e. a UE soft-object-path with the asset name repeated after the dot.
# This pattern matches that shape specifically (not every string starting
# with /Game/ -- a few fields are plain text that happens to start
# similarly) so we don't misreport non-texture strings as texture refs.
_ASSET_PATH_RE = re.compile(r"^/Game/[^.\s]+\.[^.\s]+$")


def _find_asset_paths(obj, found, limit=2000):
    """Recursively collects every distinct /Game/... soft-object-path
    string inside a JSON value, up to `limit` (defensive cap -- some
    DataAssets have thousands of nested entries; for a SUMMARY we don't
    need an exhaustive count beyond a few thousand to make the point)."""
    if len(found) >= limit:
        return
    if isinstance(obj, str):
        if _ASSET_PATH_RE.match(obj):
            found.add(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            _find_asset_paths(v, found, limit)
    elif isinstance(obj, list):
        for v in obj:
            _find_asset_paths(v, found, limit)


def _classify_datatable(entry):
    """
    Returns (kind, rowCount, fields, autoSummary) for one parsed UE
    export entry (the single dict inside the top-level [ ... ] wrapper
    every one of these files uses). Pure structural inspection -- no
    per-file special-casing, so this works unmodified for any future
    datatable dropped into raw-export/ without code changes, per the
    user's "auto-generated now, refine by hand as we explore each one"
    direction. Confirmed against all 65 currently-known datatables with
    zero unhandled shapes before this was wired into the real pipeline.
    """
    type_ = entry.get("Type", "Unknown")
    rows = entry.get("Rows")
    props = entry.get("Properties")

    if type_ == "DataTable" and isinstance(rows, dict):
        row_count = len(rows)
        sample_keys = []
        if rows:
            first_val = next(iter(rows.values()))
            if isinstance(first_val, dict):
                sample_keys = list(first_val.keys())
        field_preview = ", ".join(sample_keys[:6]) + ("..." if len(sample_keys) > 6 else "")
        return (
            "DataTable", row_count, sample_keys,
            f"DataTable with {row_count} row{'s' if row_count != 1 else ''}. Fields: {field_preview}",
        )

    if type_ == "CurveTable" and isinstance(rows, dict):
        curve_names = list(rows.keys())
        preview = ", ".join(curve_names[:8]) + ("..." if len(curve_names) > 8 else "")
        return (
            "CurveTable", len(curve_names), curve_names,
            f"CurveTable with {len(curve_names)} named curve{'s' if len(curve_names) != 1 else ''}: {preview}",
        )

    if type_ in ("CurveFloat", "RODCurveFloat") and isinstance(props, dict):
        keys = (props.get("FloatCurve") or {}).get("Keys", [])
        return (
            type_, len(keys), ["Time", "Value"],
            f"Single float curve with {len(keys)} keyframe point{'s' if len(keys) != 1 else ''}.",
        )

    if isinstance(props, dict):
        field_summaries = []
        for k, v in props.items():
            if isinstance(v, list):
                field_summaries.append(f"{k}[{len(v)}]")
            elif isinstance(v, dict):
                field_summaries.append(f"{k}{{{len(v)}}}")
            else:
                field_summaries.append(k)
        preview = ", ".join(field_summaries[:8]) + ("..." if len(field_summaries) > 8 else "")
        return (
            "DataAsset", None, list(props.keys()),
            f"Singleton config object (not a row-based table). Fields: {preview}",
        )

    return (type_ or "Unknown", None, [], f"Type={type_}: unrecognized shape, no Rows or Properties found.")


def build_dt_inspector_index():
    """
    Walks every JSON file under raw-export/ (excluding Localization/,
    which has its own dedicated handling elsewhere in this pipeline and
    isn't a DataTable/DataAsset/CurveTable in the UE sense) and builds:

      1. Content/ROD/DataAssets/_DtInspector/_index.json -- one entry
         per datatable with its location, kind (DataTable/CurveTable/
         CurveFloat/DataAsset), row count, an auto-generated structural
         summary, and texture-reference stats (how many distinct
         /Game/... asset paths it references, and how many of those
         already have a matching .png present in Content/ROD/ vs. not
         -- see asset_path_to_texture_key()). PNGs themselves are
         deliberately NOT copied or bundled here, per the user's
         "don't add texture bloat until we start using them" direction
         -- this index only reports on textures that are ALREADY
         present from earlier work (e.g. equipment thumbnails) so
         there's no actual bloat added by this feature itself.
      2. A copy of each raw datatable file itself into
         Content/ROD/<same relative path>, exactly as extracted (same
         convention as every other category in this pipeline -- e.g.
         PeculiarModifications.json is a DERIVED file, but plenty of
         raw files are also served as-is). This is a copy, not a
         re-shape: the DT Inspector is explicitly a full, exact
         database/datatable view, distinct from the JSON Inspector's
         per-entry convenience view, so showing anything other than
         the byte-for-byte original would undermine its purpose.

    This is intentionally a generic structural walk with NO per-file
    special-casing -- per the user's direction, summaries here are
    auto-generated now and can be replaced with hand-written, reviewed
    summaries later as each datatable actually gets explored/used by a
    future section (World/Items/Monsters/Characters).
    """
    # WwiseAudio and Widget are excluded the same way Localization
    # already was -- WwiseAudio has its own build_wwise_audio()
    # builder (4449 single-record AkAudioEvent files don't fit this
    # function's model at all), and Widget now has its own
    # build_bp_inspector_index() builder for the same reason: a Widget
    # Blueprint's flat entry list (CanvasPanel/Function/MovieScene*/
    # WidgetTree/etc.) doesn't match DataTable/CurveTable/DataAsset
    # either -- confirmed directly before adding this exclusion, a
    # WBP's own BackgroundBlur entry was being misclassified here as a
    # generic "DataAsset" with a misleading field summary, not flagged
    # as unrecognized the way Wwise events at least were.
    excluded_dir_names = {"Localization", "WwiseAudio", "Widget"}
    entries = []
    asset_path_cache = {}  # avoid re-stat'ing the same texture path repeatedly across files

    for root, dirs, files in os.walk(SRC):
        if excluded_dir_names & set(root.split(os.sep)):
            continue
        for fname in sorted(files):
            if not fname.endswith(".json"):
                continue
            full_path = os.path.join(root, fname)
            rel_path = os.path.relpath(full_path, SRC).replace(os.sep, "/")

            try:
                data = load_json(full_path)
            except Exception as e:
                entries.append({
                    "path": rel_path,
                    "name": fname,
                    "kind": "Error",
                    "rowCount": None,
                    "fields": [],
                    "summary": f"Failed to parse: {e}",
                    "textureRefCount": 0,
                    "texturesPresent": 0,
                    "texturesMissing": 0,
                })
                continue

            if not (isinstance(data, list) and data and isinstance(data[0], dict)):
                # Not a recognized UE export wrapper shape (e.g. the
                # legacy weapon_names_{code}.json, which is excluded by
                # the Localization/ directory filter above anyway, but
                # this guards against any other odd shape too).
                continue

            entry = data[0]
            kind, row_count, fields, summary = _classify_datatable(entry)

            asset_paths = set()
            _find_asset_paths(entry, asset_paths)
            present, missing = 0, 0
            for ap in asset_paths:
                tex_key = asset_path_to_texture_key(ap)
                if tex_key is None:
                    continue
                # BUG FIX: tex_key already includes the "Content/ROD/..."
                # prefix (see asset_path_to_texture_key's docstring), so
                # it must be joined against PROJECT_ROOT, not OUT --
                # OUT already IS ".../Content/ROD", so joining tex_key
                # onto it doubled the prefix into a path that could
                # never exist (".../Content/ROD/Content/ROD/..."),
                # which silently made every texture look "missing"
                # even when 192 of them were actually already present.
                if tex_key not in asset_path_cache:
                    asset_path_cache[tex_key] = os.path.exists(os.path.join(PROJECT_ROOT, tex_key))
                if asset_path_cache[tex_key]:
                    present += 1
                else:
                    missing += 1

            entries.append({
                "path": rel_path,
                "name": entry.get("Name", fname),
                "kind": kind,
                "rowCount": row_count,
                "fields": fields,
                "summary": summary,
                "textureRefCount": len(asset_paths),
                "texturesPresent": present,
                "texturesMissing": missing,
            })

            # Copy the raw file as-is into the served output tree so
            # the app can fetch it directly -- same convention as every
            # other raw-export file this pipeline passes through.
            save_json(os.path.join(OUT, rel_path), data)

    entries.sort(key=lambda e: e["path"])
    index_path = os.path.join(OUT, "DataAssets/_DtInspector/_index.json")
    save_json(index_path, entries)

    kind_counts = {}
    for e in entries:
        kind_counts[e["kind"]] = kind_counts.get(e["kind"], 0) + 1
    print(f"  DT Inspector index: {len(entries)} datatables")
    for k, c in sorted(kind_counts.items(), key=lambda x: -x[1]):
        print(f"    {k}: {c}")
    total_tex = sum(e["textureRefCount"] for e in entries)
    total_present = sum(e["texturesPresent"] for e in entries)
    print(f"  Texture references found: {total_tex} total, {total_present} already present in Content/ROD/")

    return entries


# ============================================================
# PIPELINE_SECTIONS
#
# An explicit, ordered description of the exact same build sequence
# that used to live only as a flat list of function calls inside
# main(). This is NOT new logic -- every entry here corresponds to one
# call that was already being made, in the same order, with the same
# arguments. The point of expressing it this way is so a future tool
# (e.g. a Build Dashboard) can introspect "what does the pipeline
# build, in what order, from what raw files" without needing a second,
# hand-maintained copy of that knowledge that could drift from the
# real call sequence.
#
# Each section dict has:
#   key            -- short identifier (used by --only/--from CLI flags)
#   label          -- human-readable name for log/dashboard output
#   builder        -- the actual function to call (same function objects
#                      main() always called -- this isn't a reimplementation)
#   requires       -- list of context keys this section's builder needs as
#                      positional arguments, IN ORDER. Matches the builder's
#                      own parameter names exactly (confirmed via
#                      inspect.signature() before this list was written --
#                      e.g. build_localization(all_weapons, all_armor) means
#                      requires=["all_weapons", "all_armor"]).
#   produces       -- context key(s) this section's return value should be
#                      stored under, for later sections to consume. None if
#                      nothing downstream needs this section's return value.
#   prepare        -- optional callable(ctx) -> tuple of extra positional
#                      args, for the few sections whose real call in main()
#                      did some inline computation on prior results rather
#                      than passing a stage's raw return value directly
#                      (e.g. build_mod_coverage_report needs a MERGED
#                      weapons+armor dict, not either alone; build_mod_localization
#                      needs a freshly-computed set unioning three different
#                      sources). Keeping these as explicit small functions
#                      here, rather than trying to force every real call
#                      through pure auto-injection, is more honest than
#                      pretending every stage's inputs are a 1:1 passthrough
#                      when several genuinely aren't.
#   rawInputs      -- list of raw-export file/dir paths (relative to SRC)
#                      this section's builder actually reads from, confirmed
#                      directly against each function's own os.path.join(SRC, ...)
#                      calls before this list was written, not guessed.
#                      Dynamic per-ID files (e.g. one DT_Partner_{code}.json
#                      per partner) are listed as a glob pattern, not every
#                      literal expansion.
# ============================================================

def _merge_weapons_armor(ctx):
    return ({**ctx["all_weapons"], **ctx["all_armor"]}, ctx["resolved_mods"])


def _compute_all_referenced_mod_keys(ctx):
    official_mod_name_keys = {
        k[len("EquipmentsModName_"):]
        for k in load_official_strings(DEFAULT_LANGUAGE)
        if k.startswith("EquipmentsModName_")
    }
    all_referenced_mod_keys = (
        set(ctx["resolved_mods"].keys())
        | set(ctx["mod_coverage_report"]["resolved"])
        | set(ctx["mod_coverage_report"]["unresolved"])
        | official_mod_name_keys
    )
    return (sorted(all_referenced_mod_keys),)


def _compute_ex_mod_types(ctx):
    return ([entry["type"] for entry in ctx["ex_mod_pool"]],)


PIPELINE_SECTIONS = [
    {
        "key": "textures", "label": "Textures & Icons",
        "builder": build_textures, "requires": [], "produces": None,
        "rawInputs": ["DataAssets/Items/Textures/**/*.png", "Widget/**/*.png"],
        "expectedOutputs": ["DataAssets/Items/Textures/T_Item_U58.png", "Widget/Common/IconImage/SkillIconImages/SwordSkill/T_SwordSkill_WAX9.png"],
    },
    {
        "key": "weapons", "label": "Weapons",
        "builder": build_weapons, "requires": [], "produces": "all_weapons",
        "rawInputs": ["DataAssets/Items/ItemDataAsset.json"],
        "expectedOutputs": ["DataAssets/Parameters/AbilityScoreTable.json", "DataAssets/Parameters/ClassTable.json", "DataAssets/Items/Weapons/_index.json"],
    },
    {
        "key": "armor", "label": "Armor",
        "builder": build_armor, "requires": [], "produces": "all_armor",
        "rawInputs": ["DataAssets/Items/ItemDataAsset.json"],
        "expectedOutputs": ["DataAssets/Items/Equipment/_index.json"],
    },
    {
        "key": "sword_skills", "label": "Equipment > Sword Skills",
        "builder": build_sword_skills, "requires": [], "produces": "all_sword_skills",
        "rawInputs": [
            "DataAssets/Items/Weapons/SwordSkill/DT_SwordSkillList_OneHandedSword.json",
            "DataAssets/Items/Weapons/SwordSkill/DT_SwordSkillList_Rapier.json",
            "DataAssets/Items/Weapons/SwordSkill/DT_SwordSkillList_Dagger.json",
            "DataAssets/Items/Weapons/SwordSkill/DT_SwordSkillList_Mace.json",
            "DataAssets/Items/Weapons/SwordSkill/DT_SwordSkillList_TwoHandedSword.json",
            "DataAssets/Items/Weapons/SwordSkill/DT_SwordSkillList_Axe.json",
        ],
        "expectedOutputs": ["DataAssets/Items/Weapons/SwordSkills/SwordSkills.json", "DataAssets/Items/Weapons/SwordSkills/_index.json"],
    },
    {
        "key": "items", "label": "Items (Catalog)",
        "builder": build_items, "requires": [], "produces": "all_items",
        "rawInputs": ["DataAssets/Items/ItemDataAsset.json", "DataAssets/Database/DT_ItemDatabase.json"],
        "expectedOutputs": ["DataAssets/Items/Catalog/_index.json"],
    },
    {
        "key": "recipes", "label": "Items > Recipes",
        "builder": build_recipes, "requires": [], "produces": "all_recipes",
        "rawInputs": ["DataAssets/Items/ItemDataAsset.json"],
        "expectedOutputs": ["DataAssets/Items/Recipes/Recipes.json", "DataAssets/Items/Recipes/_index.json"],
    },
    {
        "key": "monsters", "label": "Monsters",
        "builder": build_monsters, "requires": [], "produces": "all_monsters",
        "rawInputs": ["DataAssets/Database/DT_MonsterDatabase.json"],
        "expectedOutputs": ["DataAssets/Database/Monsters/_index.json"],
    },
    {
        "key": "lore", "label": "World > Lore",
        "builder": build_lore, "requires": [], "produces": "all_lore",
        "rawInputs": ["DataAssets/Database/DT_WorldViewDatabase.json"],
        "expectedOutputs": ["DataAssets/Database/Lore/Lore.json", "DataAssets/Database/Lore/_index.json"],
    },
    {
        "key": "towns", "label": "World > Towns",
        "builder": build_towns, "requires": [], "produces": "all_towns",
        "rawInputs": ["DataAssets/Town/DT_TownList.json", "DataAssets/Town/Town_*.json"],
        "expectedOutputs": ["DataAssets/Database/Towns/Towns.json", "DataAssets/Database/Towns/_index.json"],
    },
    {
        "key": "quests", "label": "World > Quests",
        "builder": build_quests, "requires": [], "produces": "all_quests",
        "rawInputs": ["DataAssets/Quests/Main/QST_Main_*.json"],
        "expectedOutputs": ["DataAssets/Database/Quests/Quests.json", "DataAssets/Database/Quests/_index.json"],
    },
    {
        "key": "characters", "label": "Characters / Partners",
        "builder": build_characters, "requires": [], "produces": "all_characters",
        "rawInputs": [
            "DataAssets/Database/DT_CharacterDatabase.json",
            "DataAssets/Character/Partner/DT_PartnerList.json",
            "DataAssets/Character/Partner/DT_CombinationSlash.json",
            "DataAssets/Character/Partner/DT_SupportSkill.json",
        ],
        "expectedOutputs": ["DataAssets/Database/Characters/Characters.json", "DataAssets/Database/Characters/_index.json"],
    },
    {
        "key": "partner_stats", "label": "Partner Stat Tables",
        "builder": build_partner_stats, "requires": [], "produces": None,
        "rawInputs": ["DataAssets/Parameters/Partner/DT_Partner_*.json"],
        "expectedOutputs": ["DataAssets/Database/Characters/PartnerStats.json"],
    },
    {
        "key": "avatar_customize", "label": "Avatar Customize",
        "builder": build_avatar_customize, "requires": [], "produces": None,
        "rawInputs": [
            "DataAssets/AvatarParts/AvatarCustomize/AvatarCustomizeDataAsset.json",
            "DataAssets/AvatarParts/AvatarCustomize/AvatarCustomizePresetData.json",
        ],
        "expectedOutputs": ["DataAssets/Database/Characters/AvatarCustomize.json"],
    },
    {
        "key": "player_config", "label": "Player Build Config",
        "builder": build_player_config, "requires": [], "produces": None,
        "rawInputs": [
            "DataAssets/Parameters/Hero/GrowPointCurve2.json",
            "DataAssets/Parameters/Hero/HeroExperienceCurve2.json",
            "DataAssets/Parameters/Hero/HeroStatusParameters.json",
            "DataAssets/Parameters/Hero/CT_GrowthParam.json",
            "DataAssets/Parameters/Hero/SwordSkillPointCurve.json",
        ],
        "expectedOutputs": ["DataAssets/Parameters/PlayerConfig.json"],
    },
    {
        "key": "weapon_armor_loc", "label": "Weapon/Armor Localization",
        "builder": build_localization, "requires": ["all_weapons", "all_armor"], "produces": None,
        "rawInputs": ["Localization/Game/*/Game.json"],
        "expectedOutputs": ["DataAssets/Items/Localization/_manifest.json"],
    },
    {
        "key": "sword_skill_loc", "label": "Sword Skill Localization",
        "builder": build_sword_skill_localization, "requires": ["all_sword_skills"], "produces": None,
        "rawInputs": ["Localization/Game/*/Game.json"],
        "expectedOutputs": ["DataAssets/Items/Weapons/SwordSkills/Localization/_manifest.json"],
    },
    {
        "key": "item_loc", "label": "Item Localization",
        "builder": build_item_localization, "requires": ["all_items"], "produces": None,
        "rawInputs": ["Localization/Game/*/Game.json"],
        "expectedOutputs": ["DataAssets/Items/Catalog/Localization/_manifest.json"],
    },
    {
        # MUST run after weapon_armor_loc AND item_loc -- recipe name/
        # description template substitution reads those sections'
        # OUTPUT files back from disk for every language. This
        # ordering constraint already existed in main() as a code
        # comment; it's now also enforced structurally, since this
        # entry's position in PIPELINE_SECTIONS is itself the
        # dependency order a --from=recipe_loc run would respect.
        "key": "recipe_loc", "label": "Recipe Localization",
        "builder": build_recipe_localization, "requires": ["all_recipes"], "produces": None,
        "rawInputs": ["Localization/Game/*/Game.json"],
        "expectedOutputs": ["DataAssets/Items/Recipes/Localization/_manifest.json"],
    },
    {
        "key": "monster_loc", "label": "Monster Localization",
        "builder": build_monster_localization, "requires": ["all_monsters"], "produces": None,
        "rawInputs": ["Localization/Game/*/Game.json"],
        "expectedOutputs": ["DataAssets/Database/Monsters/Localization/_manifest.json"],
    },
    {
        "key": "lore_loc", "label": "Lore Localization",
        "builder": build_lore_localization, "requires": ["all_lore"], "produces": None,
        "rawInputs": ["Localization/Game/*/Game.json"],
        "expectedOutputs": ["DataAssets/Database/Lore/Localization/_manifest.json"],
    },
    {
        "key": "town_loc", "label": "Town Localization",
        "builder": build_town_localization, "requires": ["all_towns"], "produces": None,
        "rawInputs": ["Localization/Game/*/Game.json"],
        "expectedOutputs": ["DataAssets/Database/Towns/Localization/_manifest.json"],
    },
    {
        "key": "quest_loc", "label": "Quest Localization",
        "builder": build_quest_localization, "requires": ["all_quests"], "produces": None,
        "rawInputs": ["Localization/Game/*/Game.json"],
        "expectedOutputs": ["DataAssets/Database/Quests/Localization/_manifest.json"],
    },
    {
        "key": "character_loc", "label": "Character Localization",
        "builder": build_character_localization, "requires": ["all_characters"], "produces": None,
        "rawInputs": ["Localization/Game/*/Game.json"],
        "expectedOutputs": ["DataAssets/Database/Characters/Localization/_manifest.json"],
    },
    {
        "key": "partner_skill_loc", "label": "Partner Skill Localization",
        "builder": build_partner_skill_localization, "requires": ["all_characters"], "produces": None,
        "rawInputs": ["Localization/Game/*/Game.json"],
        "expectedOutputs": ["DataAssets/Database/Characters/SkillLocalization/_manifest.json"],
    },
    {
        "key": "peculiar_mods", "label": "Unique MOD Definitions",
        "builder": build_peculiar_mods, "requires": [], "produces": "resolved_mods",
        "rawInputs": ["DataAssets/Parameters/Shared/DA_AttributeModification.json"],
        "expectedOutputs": ["DataAssets/Parameters/Shared/PeculiarModifications.json"],
    },
    {
        "key": "ex_mod_pool", "label": "EX-MOD Pool",
        "builder": build_ex_mod_pool, "requires": [], "produces": "ex_mod_pool",
        "rawInputs": ["DataAssets/Parameters/Shared/DA_AttributeModification.json"],
        "expectedOutputs": ["DataAssets/Parameters/Shared/ExModPool.json"],
    },
    {
        # main() originally called this with `{**all_weapons, **all_armor}`
        # inline -- _merge_weapons_armor reproduces that exact merge,
        # not a new computation.
        "key": "mod_coverage", "label": "Mod Coverage Report",
        "builder": build_mod_coverage_report, "requires": [], "produces": "mod_coverage_report",
        "prepare": _merge_weapons_armor,
        "rawInputs": [],  # derives entirely from already-built sections, no new raw file
        "expectedOutputs": ["DataAssets/Parameters/Shared/ModCoverageReport.json"],
    },
    {
        "key": "mod_loc", "label": "Mod Localization",
        "builder": build_mod_localization, "requires": [], "produces": None,
        "prepare": _compute_all_referenced_mod_keys,
        "rawInputs": ["Localization/Game/*/Game.json"],
        "expectedOutputs": ["DataAssets/Parameters/Shared/Localization/_manifest.json"],
    },
    {
        "key": "ex_mod_loc", "label": "EX-MOD Localization",
        "builder": build_ex_mod_localization, "requires": [], "produces": None,
        "prepare": _compute_ex_mod_types,
        "rawInputs": ["Localization/Game/*/Game.json"],
        "expectedOutputs": ["DataAssets/Parameters/Shared/ExModLocalization/_manifest.json"],
    },
    {
        "key": "dt_inspector", "label": "DT Inspector Index",
        "builder": build_dt_inspector_index, "requires": [], "produces": None,
        "rawInputs": [],  # walks all of raw-export/ itself, not one specific file
        "expectedOutputs": ["DataAssets/_DtInspector/_index.json"],
    },
    {
        "key": "bp_inspector", "label": "BP Inspector Index (Widget Blueprints)",
        "builder": build_bp_inspector_index, "requires": [], "produces": None,
        "rawInputs": ["Widget/AvatarCustomize/AvatarCustomize/WBP_*.json"],
        "expectedOutputs": ["DataAssets/_BpInspector/_index.json", "DataAssets/_BpInspector/widgets.json"],
    },
    {
        "key": "asset_materials", "label": "Asset Inspector (Materials)",
        "builder": build_asset_materials, "requires": [], "produces": "all_materials",
        "rawInputs": [],  # walks all of raw-export/ itself looking for Material/MaterialInstanceConstant Type, not one fixed path
        "expectedOutputs": ["DataAssets/_AssetInspector/Materials.json"],
    },
    {
        "key": "asset_meshes", "label": "Asset Inspector (Meshes)",
        "builder": build_asset_meshes, "requires": [], "produces": "all_meshes",
        "rawInputs": [
            "DataAssets/AvatarParts/Costumes/Upper/AvatarMesh_*.json",
            "DataAssets/AvatarParts/Costumes/Lower/AvatarMesh_*.json",
            "DataAssets/AvatarParts/Costumes/Gloves/AvatarMesh_*.json",
            "DataAssets/AvatarParts/HeadGears/AvatarMesh_*.json",
            "DataAssets/AvatarParts/Equipment/OneHandedSword/*.json",
            "DataAssets/AvatarParts/Equipment/Shield/*.json",
        ],
        "expectedOutputs": ["DataAssets/_AssetInspector/Meshes.json"],
    },
    {
        "key": "asset_inspector_index", "label": "Asset Inspector Index",
        "builder": build_asset_inspector_index, "requires": ["all_materials", "all_meshes"], "produces": None,
        "rawInputs": [],
        "expectedOutputs": ["DataAssets/_AssetInspector/_index.json"],
    },
    {
        "key": "wwise_audio", "label": "Wwise Audio Index",
        "builder": build_wwise_audio, "requires": [], "produces": None,
        "rawInputs": ["WwiseAudio/Events/**/*.json"],
        "expectedOutputs": ["DataAssets/_WwiseAudio/_index.json", "DataAssets/_WwiseAudio/events.json"],
    },
]


class PipelineRunner:
    """
    Executes PIPELINE_SECTIONS in order, threading return values through
    a context dict exactly the way main() always passed local variables
    from one call to the next. start_key/stop_key (both inclusive) let a
    caller run a contiguous sub-range of the pipeline -- this is what
    backs the --only=<section> and --from=<section> CLI flags, and is
    the same mechanism a future dashboard's "rebuild just this section"
    button would call into, rather than reimplementing the ordering.

    IMPORTANT: running a sub-range only works correctly if every section
    BEFORE start_key that something in the requested range depends on
    has already been run in a PRIOR full (or wider-range) invocation --
    this runner does not go back and silently rebuild missing
    prerequisites, since doing so silently would hide exactly the kind
    of staleness a dashboard is supposed to surface, not paper over.
    """

    def __init__(self, sections=None):
        self.sections = sections if sections is not None else PIPELINE_SECTIONS
        self.context = {}
        self.last_results = []  # updated as run() progresses -- lets a caller inspect WHICH section failed after an exception, without re-parsing the error string

    def run(self, start_key=None, stop_key=None, verbose=True):
        keys = [s["key"] for s in self.sections]
        start_idx = keys.index(start_key) if start_key else 0
        stop_idx = keys.index(stop_key) if stop_key else len(self.sections) - 1
        if start_idx > stop_idx:
            raise ValueError(f"start_key '{start_key}' comes after stop_key '{stop_key}' in pipeline order")

        results = []
        self.last_results = results
        for section in self.sections[start_idx:stop_idx + 1]:
            if verbose:
                print(f"Building {section['label']}...")
            try:
                # Gathering prerequisites from context (and "prepare")
                # is inside this try too, not just the builder call --
                # a missing prerequisite (e.g. running --only=X when X
                # depends on a section that wasn't run earlier in THIS
                # invocation) is just as real a failure as the builder
                # itself raising, and needs to show up in results/
                # last_results the same way, not silently bypass the
                # tracking that _write_last_build_status() depends on.
                args = [self.context[k] for k in section["requires"]]
                if "prepare" in section:
                    args = list(section["prepare"](self.context)) + args
                value = section["builder"](*args)
                if section["produces"]:
                    self.context[section["produces"]] = value
                results.append({"key": section["key"], "label": section["label"], "ok": True, "error": None})
            except Exception as e:
                results.append({"key": section["key"], "label": section["label"], "ok": False, "error": str(e)})
                if verbose:
                    print(f"  FAILED: {e}")
                raise  # a failed section means everything after it in this run is unreliable -- stop, don't silently continue on broken context
        return results


def _check_raw_inputs_exist(raw_inputs):
    """
    For a section's rawInputs list (literal relative paths or glob
    patterns, both relative to SRC), reports which ones actually exist
    on disk right now. A literal path with no glob characters is
    checked directly; a pattern (containing * or **) is checked via
    glob.glob and counts as "present" if it matches at least one file
    -- this is the Export check half of the dashboard, and uses
    EXACTLY the same SRC root every builder function already reads
    from, not a separately-guessed path.
    """
    results = []
    for pattern in raw_inputs:
        full_pattern = os.path.join(SRC, pattern)
        if "*" in pattern:
            matches = glob.glob(full_pattern, recursive=True)
            results.append({"path": pattern, "present": len(matches) > 0, "matchCount": len(matches)})
        else:
            results.append({"path": pattern, "present": os.path.exists(full_pattern), "matchCount": 1 if os.path.exists(full_pattern) else 0})
    return results


def _check_outputs_exist(expected_outputs):
    """
    Mirrors _check_raw_inputs_exist(), but for a section's
    expectedOutputs -- the actual Content/ROD/... file(s) its builder
    is supposed to produce, derived directly from each builder's real
    save_json() calls (see the PIPELINE_SECTIONS comment block for how
    these were extracted -- not guessed). Every expectedOutputs entry
    is a literal path (no globs needed: even the per-language
    localization builders, which write 13 files, are represented by
    their single _manifest.json -- the one file that genuinely
    summarizes "did this category's localization build succeed,"
    rather than tracking all 13 language files individually here).
    This is Phase 3's "data points generated" check.
    """
    results = []
    for rel_path in expected_outputs:
        full_path = os.path.join(OUT, rel_path)
        results.append({"path": rel_path, "present": os.path.exists(full_path)})
    return results


def _read_last_build_status():
    """
    Reads .last-build-status.json (written by main()'s real-build path
    -- NOT by --status mode, which never builds anything for real) --
    this is Phase 2's "was the last build successful" signal. Returns
    None if the pipeline has never been run for real since this file
    was introduced (a legitimate, honest state -- not an error).
    """
    if not os.path.exists(LAST_BUILD_STATUS_PATH):
        return None
    try:
        return load_json(LAST_BUILD_STATUS_PATH)
    except Exception:
        return None


def _write_last_build_status(success, mode, failed_section=None, error=None):
    """
    Called once at the end of main()'s real-build path (full, --only,
    or --from -- every real run, not just full ones, each tagged with
    its own `mode` so the dashboard can show what kind of run last
    happened) -- written here, in the pipeline itself, rather than only
    by the dashboard's rebuild endpoint, so this stays accurate even
    when the pipeline is run directly from a terminal/cron, not just
    through the web UI.
    """
    import datetime
    payload = {
        "success": success,
        "mode": mode,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "failedSection": failed_section,
        "error": error,
    }
    try:
        save_json(LAST_BUILD_STATUS_PATH, payload)
    except Exception:
        pass  # status tracking is a convenience, never worth crashing a real build over


def get_pipeline_status():
    """
    Builds the full status report the dashboard needs: for each
    section, in real pipeline order, the raw-input Export check (do
    the files this section reads from actually exist), an Outputs
    check (do the files this section is supposed to PRODUCE actually
    exist on disk right now -- Phase 3's "data points generated"), and
    a Schema check (does running this exact section, for real, against
    whatever raw files currently exist and whatever earlier sections
    already produced in THIS status run, succeed or raise).

    Also returns a top-level "overview" dict aggregating all of the
    above into the 4-phase summary the Build Dashboard shows at the
    top of the page:
      Phase 1 (raw export structure): does raw-export/Content/ROD/
        exist at all; how many distinct rawInputs paths/patterns
        (deduplicated across every section) are present vs missing;
        plus a broader, genuinely-walked count of every .json file
        actually sitting under raw-export/Content/ROD/ and how many of
        those aren't referenced by any section's rawInputs at all (the
        same "investigate, maybe a new section" framing the existing
        Unrecognized Files upload tray already uses, just applied to
        what's already on disk rather than only what's freshly
        uploaded).
      Phase 2 (schema validation): how many sections have a confirmed-
        valid vs confirmed-invalid schema right now, plus the last
        REAL build's own success/failure (a separate concept from the
        schema check here, which never writes anything outside this
        status run's own idempotent rebuilds -- see _write_last_build_status).
      Phase 3 (data points generated): how many distinct expectedOutputs
        paths (deduplicated across every section) exist vs are missing.
      Phase 4 is intentionally NOT computed here -- "proper application
        running" and the live per-category counts (items/recipes/
        weapons/armor/towns/partners/monsters) are most honestly
        answered by the actual running app's own DataStore, which the
        Build Dashboard view already has direct access to client-side;
        recomputing those same numbers here from raw JSON would risk
        silently drifting from what the app itself actually shows.

    The Schema check genuinely RUNS each section's builder (one fresh
    PipelineRunner, advanced section-by-section in real pipeline
    order, so each section's real prerequisites from earlier sections
    are already in its context) rather than a lighter heuristic --
    "looks like it has the right fields" is not the same as "would
    actually build successfully," and a real run is what answers that
    honestly. Every section's builder already writes safe, idempotent
    output, so running it for real to check has no harmful side effect
    beyond writing the same output a normal pipeline run would also
    write.
    """
    runner = PipelineRunner()
    sections_report = []

    seen_raw_paths = {}    # path -> present bool, deduplicated across sections for Phase 1
    seen_output_paths = {} # path -> present bool, deduplicated across sections for Phase 3

    for section in PIPELINE_SECTIONS:
        export_checks = _check_raw_inputs_exist(section["rawInputs"])
        export_ok = all(c["present"] for c in export_checks) if export_checks else True
        for c in export_checks:
            seen_raw_paths[c["path"]] = c["present"]

        output_checks = _check_outputs_exist(section.get("expectedOutputs", []))
        outputs_ok = all(c["present"] for c in output_checks) if output_checks else None
        for c in output_checks:
            seen_output_paths[c["path"]] = c["present"]

        schema_ok = None
        schema_error = None
        if export_ok:
            try:
                runner.run(start_key=section["key"], stop_key=section["key"], verbose=False)
                schema_ok = True
            except Exception as e:
                schema_ok = False
                schema_error = str(e)
        # If the export check already failed, don't even attempt the
        # schema check -- it would fail for the SAME reason (missing
        # input file), and reporting two failures from one root cause
        # would be confusing rather than informative.

        sections_report.append({
            "key": section["key"],
            "label": section["label"],
            "rawInputs": export_checks,
            "expectedOutputs": output_checks,
            "exportOk": export_ok,
            "outputsOk": outputs_ok,
            "schemaOk": schema_ok,
            "schemaError": schema_error,
        })

    # Phase 1: folder structure + a genuine filesystem walk, not just
    # the curated rawInputs list -- catches content sitting in
    # raw-export/ that no section has claimed yet (future-section
    # material, the same way Recipes/Towns/Quests all started).
    folder_structure_ok = os.path.isdir(SRC)
    all_raw_json_on_disk = []
    if folder_structure_ok:
        for root, _dirs, files in os.walk(SRC):
            for f in files:
                if f.endswith(".json"):
                    rel = os.path.relpath(os.path.join(root, f), SRC).replace(os.sep, "/")
                    all_raw_json_on_disk.append(rel)

    # "Claimed" = either a literal rawInputs path, or one of the REAL
    # files a glob-pattern rawInputs entry actually expands to (via the
    # same glob.glob() the Export check itself already uses) -- not a
    # basename-suffix heuristic. A basename-suffix check was tried
    # first and found to be a real bug: a pattern like
    # "DataAssets/AvatarParts/Equipment/Shield/*.json" has the bare
    # basename "*.json", which strips down to ".json" -- a 5-character
    # suffix nearly every JSON file on disk ends with, incorrectly
    # marking ~334 genuinely-unsurveyed NPC files (and likely others)
    # as "claimed." Caught by checking the actual unclaimed count
    # against a file family already known (from earlier project work)
    # to be unclaimed, rather than trusting a 0 result at face value.
    known_literal_paths = {p for p in seen_raw_paths if "*" not in p}
    claimed_glob_matches = set()
    for section in PIPELINE_SECTIONS:
        for pattern in section["rawInputs"]:
            if "*" not in pattern:
                continue
            for full_match in glob.glob(os.path.join(SRC, pattern), recursive=True):
                claimed_glob_matches.add(os.path.relpath(full_match, SRC).replace(os.sep, "/"))

    unclaimed_files = []
    for rel in all_raw_json_on_disk:
        if rel in known_literal_paths:
            continue
        if rel in claimed_glob_matches:
            continue
        unclaimed_files.append(rel)

    overview = {
        "phase1_rawExport": {
            "folderStructureOk": folder_structure_ok,
            "identifiedJsonExisting": sum(1 for v in seen_raw_paths.values() if v),
            "identifiedJsonMissing": sum(1 for v in seen_raw_paths.values() if not v),
            "totalRawJsonFilesOnDisk": len(all_raw_json_on_disk),
            "unclaimedJsonFilesOnDisk": len(unclaimed_files),
            "unclaimedJsonFileSample": sorted(unclaimed_files)[:50],
        },
        "phase2_schema": {
            "schemaValidCount": sum(1 for s in sections_report if s["schemaOk"] is True),
            # schemaOk is False when the builder ran and threw; it's
            # None when the schema check was SKIPPED because the
            # export check already failed (missing raw input). Both
            # genuinely mean "would fail to run through the pipeline
            # right now" -- only counting the explicit False case would
            # under-report this whenever a raw input is missing, since
            # that section's schema would then show in neither bucket.
            "schemaInvalidCount": sum(1 for s in sections_report if s["schemaOk"] is not True),
            "lastBuild": _read_last_build_status(),
        },
        "phase3_dataPoints": {
            "outputsGenerated": sum(1 for v in seen_output_paths.values() if v),
            "outputsMissing": sum(1 for v in seen_output_paths.values() if not v),
        },
    }

    return {"sections": sections_report, "overview": overview}


def ensure_standalone_files_exist():
    """
    dev-reference.json and animation-config.json are standalone files,
    intentionally never touched by any pipeline BUILDER (every other
    section explicitly skips them, so hand edits to the AES key,
    mapping-file links, or animation timing persist across rebuilds
    forever) -- but that guarantee also means nothing ever CREATES
    them if they're missing, which is exactly what happens on a
    genuinely fresh instance (raw-export/Content deleted and rebuilt
    from scratch, or a brand-new deployment that's never had them).
    Confirmed as a real, reported gap by testing exactly that scenario
    end-to-end and finding both files missing after a full rebuild.

    Called once at the end of main()'s real-build path. Creates each
    file with known-good default content ONLY if it doesn't already
    exist -- an existing file, customized or not, is never touched,
    matching the same guarantee every other section already makes
    about these two files. Defaults are the actual current values
    already used throughout this project (the real AES key, the real
    Discord mapping-file links as of this writing, the corrected
    in-game rank border colors) -- not placeholders, since a fresh
    instance genuinely needs the same real starting values a hand-
    maintained one already has, not empty stand-ins.
    """
    defaults = {
        "dev-reference.json": {
            "_comment": "Reverse-engineering reference info for the dev team. Edit this file directly to update -- it's not touched by the build pipeline, so changes here persist across rebuilds.",
            "aesEncryptionKey": "0x65B628BF55835C9F5FAFF52E452ED9F7E6A677D46F165A9A88E1DB1CD394A0D9",
            "mappingFiles": [
                {
                    "label": "USMAP",
                    "type": "usmap",
                    "description": "Unreal mapping file for unversioned property serialization",
                    "filename": "5.3.2-0ROD-App-ONEbeta-1.0-EchoesofAincrad.usmap",
                    "url": "https://cdn.discordapp.com/attachments/1479346995142459496/1516182556020838640/5.3.2-0ROD-App-ONEbeta-1.0-EchoesofAincrad.usmap?ex=6a40dfca&is=6a3f8e4a&hm=76cca1fe2db76089ed805e7fc22a9a11ce173aef97114f8afcadb67d6f07ce60&",
                },
                {
                    "label": "IDA",
                    "type": "ida",
                    "description": "ID mapping file",
                    "filename": "5.3.2-0ROD-App-ONEbeta-1.0-EchoesofAincrad.idmap",
                    "url": "https://cdn.discordapp.com/attachments/1479346995142459496/1516182750523297973/5.3.2-0ROD-App-ONEbeta-1.0-EchoesofAincrad.idmap?ex=6a40dff9&is=6a3f8e79&hm=b14231f66e676cde0c24a9830b148dd97a931f0cd8d0e3da5392a9f54346a2ff&",
                },
            ],
            "_note": "Discord CDN attachment URLs include expiring signature params (ex=/is=/hm=). If a link stops working, it needs to be regenerated from the original Discord message and pasted back in here -- that's the only maintenance this file should ever need.",
        },
        "animation-config.json": {
            "_comment": "Controls the equipment icon scan-frame animation. Edit directly -- not regenerated by the build pipeline, so changes persist across rebuilds.",
            "scanBar": {
                "enabled": True,
                "color": "rgba(120, 200, 255, 0.35)",
                "travelDurationMs": 1000,
                "pauseDurationMs": 4500,
                "randomizeStart": True,
                "_note": "travelDurationMs is how long the bar takes to move bottom-to-top. pauseDurationMs is the gap after one pass finishes before the next one starts. Full cycle = travelDurationMs + pauseDurationMs. randomizeStart staggers each icon's animation start time independently so a grid of icons doesn't all scan in lockstep; set to false to make every icon start its cycle at the same moment.",
            },
            "rankBorderColors": {
                "_note": "Border + glow color shown around each equipment icon, keyed by item rank. Corrected directly by user observation in-game: RankD=green, RankA=purple, RankC=blue, RankB=red, RankS=gold are all confirmed correct as of this version.",
                "RankD": "#5EEB6D",
                "RankC": "#5BC4E0",
                "RankB": "#E0455F",
                "RankA": "#9B6FE0",
                "RankS": "#F2C94C",
                "none": "#8A9096",
            },
        },
    }
    for filename, content in defaults.items():
        target = os.path.join(OUT, filename)
        if os.path.exists(target):
            continue
        save_json(target, content)
        print(f"  Created default {filename} (was missing)")


def main():

    import sys
    only_key = None
    from_key = None
    status_mode = False
    for arg in sys.argv[1:]:
        if arg.startswith("--only="):
            only_key = arg.split("=", 1)[1]
        elif arg.startswith("--from="):
            from_key = arg.split("=", 1)[1]
        elif arg == "--status":
            status_mode = True

    if status_mode:
        import io
        import contextlib
        captured = io.StringIO()
        with contextlib.redirect_stdout(captured):
            report = get_pipeline_status()
        # Builders' own print() calls (progress lines, coverage notes)
        # go to `captured` and are discarded here -- printing them
        # alongside the JSON would corrupt it for any caller parsing
        # stdout as JSON (confirmed this was happening before this fix:
        # every section's internal print() calls were interleaving with
        # the final json.dumps(), making the output unparseable).
        print(json.dumps(report))
        return

    runner = PipelineRunner()
    if only_key:
        mode = f"only:{only_key}"
    elif from_key:
        mode = f"from:{from_key}"
    else:
        mode = "full"

    try:
        if only_key:
            runner.run(start_key=only_key, stop_key=only_key)
        elif from_key:
            runner.run(start_key=from_key)
        else:
            runner.run()
    except Exception as e:
        # The runner's own last_results (now tracked on self, see
        # PipelineRunner.__init__) tells us exactly which section
        # failed -- its last entry, since run() appends a result
        # before raising. Far more reliable than trying to match the
        # section's key/label against the exception's own text, which
        # most exceptions (KeyError, FileNotFoundError, etc.) won't
        # contain at all.
        failed_section = runner.last_results[-1]["key"] if runner.last_results else None
        _write_last_build_status(success=False, mode=mode, failed_section=failed_section, error=str(e))
        raise

    ensure_standalone_files_exist()
    _write_last_build_status(success=True, mode=mode)
    print("Done.")


if __name__ == "__main__":
    main()
