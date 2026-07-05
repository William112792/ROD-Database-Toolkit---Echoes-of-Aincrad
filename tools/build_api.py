#!/usr/bin/env python3
"""
build_api.py -- generates the /api folder: a static, file-based REST
resource tree over everything build_pipeline.py has already produced
under Content/ROD/. This is deliberately a SEPARATE script, not a
section inside build_pipeline.py's PIPELINE_SECTIONS -- the API layer
consumes the toolkit's output as a read-only downstream client, the
same relationship the website itself has to Content/ROD/, so it
should be no more coupled to the pipeline's internals than the
website is. Run it any time after a normal pipeline build:

    python3 tools/build_api.py

It never touches raw-export/, tools/build_pipeline.py, app/, guides/,
or any pipeline output file -- it only READS Content/ROD/**/*.json
and WRITES under api/ at the project root (sibling to Content/, app/,
guides/), which is also how server.js's api-routes.js serves it.

FOLDER LAYOUT (mirrors the shape sketched in APIRouting.md):
    api/
      _meta.json                 schema version, generated timestamp, counts
      items/
        weapons.json             every weapon, flattened across categories
        armor.json                every armor piece, flattened
        accessories.json          usable/material/key-item catalog, flattened
      monsters/
        monsters.json             every monster, flattened across categories
        stats.json                the Blueprint-sourced level/HP data
      datatables/
        _index.json               every real DataTable this export contains
                                   (name, row count, RowStruct, source path)
                                   -- reuses the DT Inspector's own catalog,
                                   never invents table names that don't exist
      structs/
        _index.json               every distinct RowStruct name seen across
                                   the DataTables above, with which tables
                                   use it -- the closest real equivalent to
                                   "FWeaponData"-style struct docs; this
                                   export does not carry standalone .h/.uproperty
                                   struct definitions, only RowStruct NAMES on
                                   each table, so that is what's indexed
      functions/
        _index.json               every Blueprint Widget the BP Inspector
                                   catalogued, with its function names --
                                   the real equivalent of "BP_WeaponManager"-
                                   style function docs available in this
                                   export (Widget BPs only; gameplay BPs
                                   under Blueprints/ are Default-object data,
                                   not decompiled function graphs, and are
                                   NOT included here -- see _meta.json note)
      localization/
        languages.json             the 13 supported language codes + labels
      skills/
        active_skills.json         the 10-row Active Skills table
        sword_skills.json          the Sword Skills tab's data, if built
      tutorials/
        (existing guides/*.md are the real tutorials; this folder holds a
         couple of API-specific stubs -- see build_tutorials())

Everything here is a plain read of an already-built Content/ROD/ file
reshaped into a flatter, per-resource-type layout for /api/item/{id}
style lookups -- no new data is computed or inferred.
"""
import os
import re
import sys
import glob
import json
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
CONTENT = os.path.join(PROJECT_ROOT, "Content", "ROD")
API_DIR = os.path.join(PROJECT_ROOT, "api")

API_SCHEMA_VERSION = "1.0.0"


def load(rel_path):
    full = os.path.join(CONTENT, rel_path)
    if not os.path.exists(full):
        return None
    with open(full, "r", encoding="utf-8") as f:
        return json.load(f)


def save(rel_path, data):
    full = os.path.join(API_DIR, rel_path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return full


def build_items():
    """
    api/items/{weapons,armor,accessories}.json -- flattened across
    every category subfile the toolkit already built, each entry
    tagged with its source category so the flattening is reversible.
    """
    counts = {}

    weapons = []
    widx = load("DataAssets/Items/Weapons/_index.json") or {}
    for cat_key, meta in widx.items():
        rows = load(meta["file"].replace("Content/ROD/", "")) or []
        # meta["file"] is already Content/ROD-relative in the source data
        rows = load(meta["file"]) or rows
        for r in rows:
            weapons.append({**r, "resourceType": "weapon"})
    save("items/weapons.json", weapons)
    counts["weapons"] = len(weapons)

    armor = []
    aidx = load("DataAssets/Items/Equipment/_index.json") or {}
    for cat_key, meta in aidx.items():
        rows = load(meta["file"]) or []
        for r in rows:
            armor.append({**r, "resourceType": "armor"})
    save("items/armor.json", armor)
    counts["armor"] = len(armor)

    accessories = []
    cidx = load("DataAssets/Items/Catalog/_index.json") or {}
    for cat_key, meta in cidx.items():
        rows = load(meta["file"]) or []
        for r in rows:
            accessories.append({**r, "resourceType": "item", "itemCategory": cat_key})
    save("items/accessories.json", accessories)
    counts["accessories"] = len(accessories)

    print(f"  api/items: {counts['weapons']} weapons, {counts['armor']} armor, {counts['accessories']} accessories/consumables")
    return counts


def build_monsters():
    """api/monsters/{monsters,stats}.json -- flattened, plus the Stats section."""
    monsters = []
    midx = load("DataAssets/Database/Monsters/_index.json") or {}
    for cat_key, meta in midx.items():
        rows = load(meta["file"]) or []
        for r in rows:
            monsters.append({**r, "resourceType": "monster", "monsterCategory": cat_key})
    save("monsters/monsters.json", monsters)

    stats = load("DataAssets/Database/MonsterStats/MonsterStats.json") or []
    save("monsters/stats.json", stats)

    print(f"  api/monsters: {len(monsters)} monsters, {len(stats)} with Blueprint stats")
    return {"monsters": len(monsters), "stats": len(stats)}


def build_datatables():
    """
    api/datatables/_index.json -- every REAL DataTable in this export
    (kind == "DataTable" in the DT Inspector's own catalog), never a
    fabricated name. Each entry: table name, row count, RowStruct
    (when classified), and the source path.
    """
    dt_index = load("DataAssets/_DtInspector/_index.json") or []
    tables = []
    for e in dt_index:
        if e.get("kind") != "DataTable":
            continue
        name = os.path.basename(e["path"])[:-5]  # strip .json
        tables.append({
            "name": name,
            "path": e["path"],
            "rowCount": e.get("rowCount"),
            "fields": e.get("fields", []),
            "summary": e.get("summary"),
        })
    tables.sort(key=lambda t: t["name"])
    save("datatables/_index.json", tables)
    print(f"  api/datatables: {len(tables)} real DataTables cataloged")
    return len(tables)


def build_structs():
    """
    api/structs/_index.json -- distinct RowStruct-equivalent names.
    This export's DT Inspector classifies each DataTable's row shape
    by its FIELD LIST (no standalone .uproperty/.h struct files exist
    in an UnrealPak JSON export), so "struct" here means "distinct
    field signature", grouped by which tables share it -- the closest
    real equivalent to a struct catalog this data supports. Fabricating
    named structs like "FWeaponData" that don't appear anywhere in the
    export would misrepresent the source.
    """
    dt_index = load("DataAssets/_DtInspector/_index.json") or []
    by_fields = {}
    for e in dt_index:
        if e.get("kind") != "DataTable":
            continue
        sig = tuple(sorted(e.get("fields", [])))
        if not sig:
            continue
        by_fields.setdefault(sig, []).append(os.path.basename(e["path"])[:-5])

    structs = []
    for i, (sig, tables) in enumerate(sorted(by_fields.items(), key=lambda x: -len(x[1]))):
        structs.append({
            "structId": f"RowShape_{i+1:03d}",
            "fields": list(sig),
            "usedByTables": sorted(tables),
            "tableCount": len(tables),
        })
    save("structs/_index.json", structs)
    print(f"  api/structs: {len(structs)} distinct row shapes across {sum(s['tableCount'] for s in structs)} tables")
    return len(structs)


def build_functions():
    """
    api/functions/_index.json -- every Widget Blueprint the BP
    Inspector catalogued, with its function names. Gameplay Blueprints
    under Blueprints/ (e.g. BP_E001001, BP_WeaponManager-style classes
    if any exist) are Default-object PROPERTY data in this export, not
    decompiled function graphs -- they do not carry a "functions" list
    the way Widget BPs do, so they are intentionally NOT included here
    to avoid implying a function catalog that doesn't exist for them.
    """
    widgets = load("DataAssets/_BpInspector/widgets.json") or []
    functions = []
    for w in widgets:
        if not w.get("functions"):
            continue
        functions.append({
            "blueprint": w["name"],
            "path": w["path"],
            "functionCount": w.get("functionCount", len(w["functions"])),
            "functions": w["functions"],
        })
    functions.sort(key=lambda f: f["blueprint"])
    save("functions/_index.json", functions)
    print(f"  api/functions: {len(functions)} Widget Blueprints with a function list "
          f"(gameplay Blueprints are property data, not function graphs -- excluded, see docstring)")
    return len(functions)


def build_localization():
    manifest = load("DataAssets/Database/Ailments/Localization/_manifest.json") or {}
    langs = [{"code": k, "label": v.get("label")} for k, v in manifest.items() if not k.startswith("_")]
    save("localization/languages.json", sorted(langs, key=lambda l: l["code"]))
    print(f"  api/localization: {len(langs)} supported languages")
    return len(langs)


def build_skills():
    active = load("DataAssets/Database/ActiveSkills/ActiveSkills.json") or []
    save("skills/active_skills.json", active)
    sword_glob = glob.glob(os.path.join(CONTENT, "DataAssets/Database/SwordSkills*.json"))
    sword = load("DataAssets/Database/SwordSkills/SwordSkills.json")
    if sword is not None:
        save("skills/sword_skills.json", sword)
    print(f"  api/skills: {len(active)} active skills" + (f", sword skills included" if sword is not None else ""))
    return len(active)


def build_tutorials():
    """
    api/tutorials/ -- a couple of API-specific stubs. The toolkit's
    real, growing tutorial content is the Modding Guides feature
    (guides/*.md, user-authored, browsable in-app) -- this folder does
    NOT duplicate those; it links to them and adds the two examples
    named when this API was scoped, kept intentionally short.
    """
    os.makedirs(os.path.join(API_DIR, "tutorials"), exist_ok=True)
    readme = """# API Tutorials

The toolkit's real modding tutorials live in `guides/*.md` (user-authored,
browsable in-app under **Modding Guides**) -- this folder does not duplicate
them. It holds a couple of short, API-specific examples for working with the
`/api` resource tree programmatically.
"""
    with open(os.path.join(API_DIR, "tutorials", "README.md"), "w", encoding="utf-8") as f:
        f.write(readme)

    create_weapon = """# Tutorial: Looking up a weapon via the API

1. List a category to find an id:
   `GET /api/weapons?category=OneHandedSword`
2. Fetch the full record:
   `GET /api/weapon/1`
3. Cross-reference its recipe (if any) via Items > Recipes data:
   `GET /api/item/ItemName_UseItemRecipe_1` (recipe purchase tokens
   resolve through the same Cost -> recipe map the toolkit's Shops
   and Drops sections use -- see APIRouting.md's "Confirmed joins"
   table before assuming two ids are related).
"""
    with open(os.path.join(API_DIR, "tutorials", "create_weapon.md"), "w", encoding="utf-8") as f:
        f.write(create_weapon)

    replace_model = """# Tutorial: Finding an asset's sidecar files via the API

This API surface indexes METADATA JSON only (see `/api/datatables`,
`/api/structs`, `/api/functions`). Binary mesh/animation sidecars (psk,
pskx, uemodel, psa, ueanim) are downloaded through the existing website
endpoint, not this API: `GET /api/pipeline/download-file?path=<rel>` on
the main app server, using the `sidecars` map from the Asset Inspector's
Skeletons/Animations catalogs (`Content/ROD/DataAssets/_AssetInspector/
Skeletons.json` / `Animations.json`). A future `find_references()` /
`open_blend()` execution (see APIRouting.md's Roadmap section) would
wrap that same lookup for tool use.
"""
    with open(os.path.join(API_DIR, "tutorials", "replace_model.md"), "w", encoding="utf-8") as f:
        f.write(replace_model)
    print("  api/tutorials: 3 files (README + 2 stubs; real tutorials are guides/*.md)")


def main():
    print("Building /api resource tree from Content/ROD/ ...")
    if not os.path.isdir(CONTENT):
        print(f"ERROR: {CONTENT} does not exist -- run the main pipeline first "
              f"(python3 tools/build_pipeline.py).", file=sys.stderr)
        sys.exit(1)

    counts = {}
    counts["items"] = build_items()
    counts["monsters"] = build_monsters()
    counts["datatables"] = build_datatables()
    counts["structs"] = build_structs()
    counts["functions"] = build_functions()
    counts["languages"] = build_localization()
    counts["skills"] = build_skills()
    build_tutorials()

    save("_meta.json", {
        "schemaVersion": API_SCHEMA_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "generatedBy": "tools/build_api.py (standalone, downstream of build_pipeline.py)",
        "counts": counts,
        "notes": [
            "This is a read-only reflection of Content/ROD/ at generation time. "
            "Re-run this script after any build_pipeline.py run to refresh it.",
            "Gameplay Blueprints (Blueprints/Characters/Enemies/*) are Default-object "
            "property data in this export, not decompiled function graphs -- they are "
            "NOT included under api/functions/ for that reason (see build_functions docstring).",
            "api/structs/ indexes distinct DataTable row FIELD SIGNATURES, not named "
            "UStruct definitions -- this export contains no standalone struct headers.",
        ],
    })
    print(f"\nDone. /api written to {API_DIR}")


if __name__ == "__main__":
    main()
