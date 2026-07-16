#!/usr/bin/env python3
"""
build_modpak.py -- generate PATCHED DataTables for a mod pak.

WHY THIS EXISTS (and why it isn't a Lua mod)
--------------------------------------------
Three of the requested mods -- all consumables in the Item Seller, all
armour/shield recipes in the Smithy at rank 1, all quests unlocked -- are
not behaviour changes. They are DATA changes. I went looking for runtime
hooks and they are not there:

  * The Item Seller's live list is URODToolShopMenuWidgetBase::
    ToolShopContents, which is a WIDGET's display array. Injecting rows
    into it changes what is DRAWN, not what the game will let you buy --
    purchases are validated against the shop data. A shop that lists 61
    consumables and then refuses to sell them is worse than no mod.
  * No blacksmith widget exposes an equivalent array at all.
  * URODQuestManager has NO unlock/open/release API. Availability comes
    out of save state, not a settable flag.

So the right instrument is a mod pak carrying patched DataTables: the game
loads them as its own data, and every validation path agrees with the UI
because there is only one source of truth.

This script writes the patched JSON. It does NOT build the .pak -- that
needs the game's own cooked asset format, and honestly claiming to produce
a loadable pak from JSON would be a lie. The repacking step (UAssetGUI or
FModel + retoc/UnrealPak) is documented in the generated README.

WHAT IT PATCHES
---------------
DT_ShopItemList (one row, "Shop", with four lists -- and TWO SEPARATE ID
SPACES, which is the trap this generator exists to get right):

  ShopList[rank].Items       -- {Category, ItemId} pairs. The vanilla
                                entries are ItemCategory_Cost tokens (the
                                59 purchasable consumable RECIPES), NOT
                                the consumables themselves.
  BlacksmithCreateList[rank] -- .List of {ERecipeKind -> Recipe:[keys]},
                                where the ints are RECIPE-MAP KEYS scoped
                                by kind (Upper #5001 = the "5001" entry of
                                UpperRecipeDataAsMap) -- NOT item ids.
                                Getting these two spaces confused is what
                                left 18 of 19 blacksmith entries
                                unresolved earlier in this project.

Everything written here is read from the toolkit's own verified data, so
the ids cannot drift from what the game actually contains.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(HERE)
SRC = os.path.join(PROJECT_ROOT, "raw-export", "Content", "ROD")
OUT = os.path.join(PROJECT_ROOT, "Content", "ROD")
MODPAK = os.path.join(PROJECT_ROOT, "mod-pak")

SHOP_TABLE = "DataAssets/Games/DataTables/DT_ShopItemList.json"

ARMOUR_KINDS = ("Upper", "Lower", "Glove", "Shield")


def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)


def patch_shop(add_consumables=True, add_armour_recipes=True, rank="1"):
    """
    Returns (patched_table, report). Both changes target the LOWEST rank so
    everything is available from the start of the game, which is what was
    asked for.
    """
    raw_path = os.path.join(SRC, SHOP_TABLE)
    if not os.path.exists(raw_path):
        raise SystemExit(f"Shop table not found: {raw_path}\nRun the export first.")

    table = load(raw_path)
    row = table[0]["Rows"]["Shop"]
    report = {}

    # ---- Consumables into the Item Seller ----
    if add_consumables:
        usable = load(os.path.join(OUT, "DataAssets/Items/Catalog/Usable.json"))
        # canBuyAndSell is the game's own flag. An item the game marks as
        # unsellable is excluded rather than forced in -- if the shop code
        # checks that flag, a forced entry would just fail at the counter.
        sellable = [u for u in usable if u.get("canBuyAndSell")]

        shop_entry = next((e for e in row["ShopList"] if e["Key"] == rank), None)
        if shop_entry is None:
            raise SystemExit(f"ShopList has no rank {rank}")

        existing = {(i["Category"], i["ItemId"]) for i in shop_entry["Value"]["Items"]}
        added = 0
        for u in sellable:
            key = ("EItemCategory::ItemCategory_Usable", int(u["id"]))
            if key in existing:
                continue
            shop_entry["Value"]["Items"].append({"Category": key[0], "ItemId": key[1]})
            existing.add(key)
            added += 1

        report["consumables_added"] = added
        report["consumables_total_now"] = len(shop_entry["Value"]["Items"])
        report["consumables_note"] = (
            "Added as ItemCategory_Usable. The vanilla ShopList holds "
            "ItemCategory_Cost tokens (purchasable RECIPES), so these are new "
            "entries in a category the list didn't previously use -- worth "
            "testing in-game before trusting it."
        )

    # ---- Armour + shield recipes into the Smithy, lowest rank ----
    if add_armour_recipes:
        recipes = load(os.path.join(OUT, "DataAssets/Items/Recipes/Recipes.json"))
        by_kind = {}
        for r in recipes:
            if r["category"] in ARMOUR_KINDS:
                by_kind.setdefault(r["category"], []).append(int(r["recipeKey"]))

        bs_entry = next((e for e in row["BlacksmithCreateList"] if e["Key"] == rank), None)
        if bs_entry is None:
            raise SystemExit(f"BlacksmithCreateList has no rank {rank}")

        # Rank 1's List is EMPTY in vanilla (verified) -- the smithy simply
        # offers nothing at the lowest rank. Build it from scratch, in the
        # game's own shape: [{Key: "ERecipeKind::Upper", Value: {Recipe: [...]}}]
        existing_by_kind = {}
        for item in bs_entry["Value"].get("List") or []:
            kind = item["Key"].split("::")[-1]
            existing_by_kind[kind] = set(item["Value"]["Recipe"])

        new_list = []
        added = 0
        for kind in ARMOUR_KINDS:
            keys = sorted(set(by_kind.get(kind, [])) | existing_by_kind.get(kind, set()))
            if not keys:
                continue
            added += len(keys) - len(existing_by_kind.get(kind, set()))
            new_list.append({
                "Key": f"ERecipeKind::{kind}",
                "Value": {"Recipe": keys},
            })
        bs_entry["Value"]["List"] = new_list

        report["armour_recipes_added"] = added
        report["armour_recipes_by_kind"] = {k: len(by_kind.get(k, [])) for k in ARMOUR_KINDS}
        report["armour_note"] = (
            "These ints are RECIPE-MAP KEYS scoped by ERecipeKind (Upper #5001 = "
            "UpperRecipeDataAsMap[\"5001\"]), not item ids. Vanilla rank 1 is empty."
        )

    return table, report


README = """# ROD mod-pak — patched DataTables

Generated by `tools/build_modpak.py` from the toolkit's own verified data.

## What's in here

`DT_ShopItemList.json` — the game's shop table, patched:

* **Item Seller (ShopList, rank 1)** — every consumable the game marks as
  buy/sellable, added as `ItemCategory_Usable` entries.
* **Smithy (BlacksmithCreateList, rank 1)** — every Upper / Lower / Glove /
  Shield recipe, in the game's own `ERecipeKind -> Recipe:[keys]` shape.
  Vanilla rank 1 is **empty**, so this is built from scratch.

The two lists use **different id spaces** and this generator respects that:
ShopList takes `{Category, ItemId}` pairs, while BlacksmithCreateList takes
**recipe-map keys** scoped by kind (`Upper #5001` = `UpperRecipeDataAsMap["5001"]`).
Mixing them up is the single easiest way to produce a shop full of dead entries.

## What this is NOT

This is **JSON, not a .pak**. Building a loadable pak requires re-serializing
into the game's cooked asset format — this script does not pretend to do that,
because a pak that silently fails to load is worse than no pak.

## Repacking

1. Open the original `DT_ShopItemList.uasset` in **UAssetGUI** (it reads the
   cooked asset directly and can import edited values).
2. Apply the changes from the JSON here (or edit the rows to match).
3. Save the `.uasset`, then pack it with **UnrealPak** or **retoc** into a
   `~mods` pak that loads after the base game's.
4. Drop the pak in `<game>/Content/Paks/~mods/`.

Keep the folder structure inside the pak identical to the original asset path:
`ROD/Content/ROD/DataAssets/Games/DataTables/DT_ShopItemList.uasset`

## Verify before you trust it

Load the game, open the Item Seller and the Smithy. If entries appear but
can't be purchased, the shop is validating against something else — tell the
toolkit and it'll dig further rather than guess.
"""


def main():
    args = set(sys.argv[1:])
    rank = "1"

    table, report = patch_shop(
        add_consumables="--no-consumables" not in args,
        add_armour_recipes="--no-armour" not in args,
        rank=rank,
    )

    out_path = os.path.join(MODPAK, "DT_ShopItemList.json")
    save(out_path, table)
    with open(os.path.join(MODPAK, "README.md"), "w", encoding="utf-8") as f:
        f.write(README)
    save(os.path.join(MODPAK, "_report.json"), report)

    print(f"Wrote {out_path}")
    for k, v in report.items():
        if not k.endswith("note"):
            print(f"  {k}: {v}")
    print(f"\nRepacking instructions: {os.path.join(MODPAK, 'README.md')}")


if __name__ == "__main__":
    main()
