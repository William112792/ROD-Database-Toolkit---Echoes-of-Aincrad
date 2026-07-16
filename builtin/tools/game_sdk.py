#!/usr/bin/env python3
"""
game_sdk.py -- parses a Dumper-7 CppSDK dump of Echoes of Aincrad and
(a) indexes its enums/structs/classes for the toolkit, and (b) emits
UE-5.3.2-PROJECT-READY C++ (USTRUCT/UENUM/UCLASS with GENERATED_BODY
and UPROPERTY) for the types that matter to DataTables and DataAssets.

Why a generator instead of shipping Dumper-7's headers directly: the
Dumper-7 SDK is built for EXTERNAL code (raw offsets, Pad_ members,
DUMPER7_ASSERTS_*, no UHT macros). Dropping it into a UE project does
not compile and would not produce a usable DataTable row type. What a
UE project actually needs is the same STRUCT SHAPES re-expressed as
UHT-visible declarations -- which is exactly what the dump gives us
the ground truth for. Everything below is derived from the dump text;
nothing is invented.

Sources parsed (per module, ROD by default):
  CppSDK/SDK/<Module>_structs.hpp   -- enums + structs
  CppSDK/SDK/<Module>_classes.hpp   -- UCLASSes (DataAssets live here)

CLI:
  python3 game_sdk.py --index   <sdk_root> --out <json_dir>
  python3 game_sdk.py --emit-ue <sdk_root> --out <cpp_dir> [--plugin-name ROD_SDK]
"""

import argparse
import json
import os
import re
import sys

# ---------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------

ENUM_RE = re.compile(r"^enum class (\w+)\s*:\s*(\w+)\s*$")
STRUCT_RE = re.compile(r"^struct (\w+)(?:\s+final)?(?:\s*:\s*public\s+(\w+))?\s*$")
CLASS_RE = re.compile(r"^class (\w+)(?:\s+final)?(?:\s*:\s*public\s+(\w+))?\s*$")
# A member line: <type possibly with spaces/templates> <name>[: bits];  // 0xOFFSET(0xSIZE)(flags)
MEMBER_RE = re.compile(
    r"^\t(?P<type>[\w:<>,\s\*]+?)\s+(?P<name>\w+)(?P<bits>\s*:\s*\d+)?\s*;\s*//\s*0x(?P<offset>[0-9A-Fa-f]+)\((?P<size>0x[0-9A-Fa-f]+)\)\((?P<flags>.*)\)"
)
ENUM_VALUE_RE = re.compile(r"^\t(\w+)\s*=\s*(-?\d+),?\s*$")


def _read(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read().replace("\r\n", "\n").split("\n")


def parse_structs_file(path):
    """Returns (enums, structs) from a Dumper-7 *_structs.hpp."""
    enums, structs = {}, {}
    lines = _read(path)
    i = 0
    while i < len(lines):
        line = lines[i]

        m = ENUM_RE.match(line)
        if m and i + 1 < len(lines) and lines[i + 1].strip() == "{":
            name, underlying = m.group(1), m.group(2)
            values = []
            i += 2
            while i < len(lines) and not lines[i].startswith("};"):
                vm = ENUM_VALUE_RE.match(lines[i])
                if vm:
                    # Dumper-7 appends a synthetic <Enum>_MAX sentinel;
                    # it is not a real game value, so it's flagged (kept
                    # for fidelity, excluded from the emitted UENUM).
                    values.append({
                        "name": vm.group(1),
                        "value": int(vm.group(2)),
                        "isMaxSentinel": vm.group(1).endswith("_MAX"),
                    })
                i += 1
            enums[name] = {"name": name, "underlying": underlying, "values": values}
            i += 1
            continue

        m = STRUCT_RE.match(line)
        if m and i + 1 < len(lines) and lines[i + 1].strip() == "{":
            name, super_name = m.group(1), m.group(2)
            members, i2 = _parse_members(lines, i + 2)
            structs[name] = {"name": name, "super": super_name, "members": members}
            i = i2
            continue

        i += 1
    return enums, structs


def parse_classes_file(path):
    """Returns classes from a Dumper-7 *_classes.hpp (members only, no UFunctions)."""
    classes = {}
    lines = _read(path)
    i = 0
    while i < len(lines):
        m = CLASS_RE.match(lines[i])
        if m and i + 1 < len(lines) and lines[i + 1].strip() == "{":
            name, super_name = m.group(1), m.group(2)
            members, i2 = _parse_members(lines, i + 2)
            classes[name] = {"name": name, "super": super_name, "members": members}
            i = i2
            continue
        i += 1
    return classes


def _parse_members(lines, i):
    members = []
    while i < len(lines) and not lines[i].startswith("};"):
        m = MEMBER_RE.match(lines[i])
        if m:
            raw_type = " ".join(m.group("type").split())
            name = m.group("name")
            # Padding members are Dumper-7 layout filler, not real
            # properties -- the UE project regenerates layout itself.
            is_pad = name.startswith("Pad_") or "Fixing Size After Last Property" in m.group("flags")
            members.append({
                "name": name,
                "type": raw_type,
                "offset": int(m.group("offset"), 16),
                "size": int(m.group("size"), 16),
                "isBitfield": bool(m.group("bits")),
                "isPadding": is_pad,
                "flags": m.group("flags"),
            })
        i += 1
    return members, i + 1


def load_sdk(sdk_root, module="ROD"):
    """sdk_root = the folder containing CppSDK/. Returns the parsed model."""
    sdk_dir = os.path.join(sdk_root, "CppSDK", "SDK")
    structs_file = os.path.join(sdk_dir, f"{module}_structs.hpp")
    classes_file = os.path.join(sdk_dir, f"{module}_classes.hpp")
    if not os.path.exists(structs_file):
        raise FileNotFoundError(f"{structs_file} not found -- is this a Dumper-7 dump root?")
    enums, structs = parse_structs_file(structs_file)
    classes = parse_classes_file(classes_file) if os.path.exists(classes_file) else {}
    return {"module": module, "enums": enums, "structs": structs, "classes": classes}


# ---------------------------------------------------------------------
# Classification (what a DataTable / DataAsset workflow actually needs)
# ---------------------------------------------------------------------

def _super_chain(name, table):
    seen, chain = set(), []
    cur = name
    while cur and cur in table and cur not in seen:
        seen.add(cur)
        cur = table[cur].get("super")
        if cur:
            chain.append(cur)
    return chain


def classify(model):
    structs, classes = model["structs"], model["classes"]
    row_structs = sorted(
        n for n in structs
        if "FTableRowBase" in _super_chain(n, structs) or structs[n].get("super") == "FTableRowBase"
    )
    data_assets = sorted(
        n for n in classes
        if any(s in ("UDataAsset", "UPrimaryDataAsset") for s in _super_chain(n, classes))
        or classes[n].get("super") in ("UDataAsset", "UPrimaryDataAsset")
    )
    return row_structs, data_assets


TYPE_TOKEN_RE = re.compile(r"\b([FEU]\w+)\b")


def referenced_types(type_str):
    """Every F*/E*/U* type token inside a member type (handles TMap/TArray/TSoftObjectPtr nesting)."""
    return set(TYPE_TOKEN_RE.findall(type_str))


def transitive_closure(model, seed_structs, seed_classes):
    """
    Every struct/enum reachable from the seeds' members -- the exact set
    a UE project must declare for the seeds to compile. Types the dump
    doesn't define (engine types like FVector, UTexture2D) are returned
    separately so the generator can include Engine headers instead of
    re-declaring them (re-declaring engine types is what breaks these
    generated SDKs).
    """
    structs, enums, classes = model["structs"], model["enums"], model["classes"]
    need_structs, need_enums, engine_types = set(), set(), set()
    queue = list(seed_structs)
    for c in seed_classes:
        for m in classes[c]["members"]:
            if not m["isPadding"]:
                queue.extend(referenced_types(m["type"]))

    while queue:
        t = queue.pop()
        if t in need_structs or t in need_enums:
            continue
        if t in structs:
            need_structs.add(t)
            sup = structs[t].get("super")
            if sup:
                queue.append(sup)
            for m in structs[t]["members"]:
                if not m["isPadding"]:
                    queue.extend(referenced_types(m["type"]))
        elif t in enums:
            need_enums.add(t)
        elif t.startswith(("F", "E", "U")):
            engine_types.add(t)
    return need_structs, need_enums, engine_types


# ---------------------------------------------------------------------
# UE-project C++ emission
# ---------------------------------------------------------------------

# Dumper-7 spelling -> UE project spelling. Unknown engine types pass
# through unchanged (they come from Engine headers, which we include).
def ue_type(raw, known_structs, known_enums):
    t = raw
    t = re.sub(r"\bclass\s+", "", t)
    t = re.sub(r"\bstruct\s+", "", t)
    t = t.replace("TSubclassOf<", "TSubclassOf<")  # unchanged, listed for clarity
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _emit_member(m, known_structs, known_enums):
    if m["isPadding"]:
        return None
    if m["isBitfield"]:
        # Dumper-7 renders UE bools as uint8 X : 1 -- in a UE project the
        # UHT-correct declaration is a plain bool.
        return f"\tUPROPERTY(EditAnywhere, BlueprintReadWrite)\n\tbool {m['name']} = false;"
    t = ue_type(m["type"], known_structs, known_enums)
    return f"\tUPROPERTY(EditAnywhere, BlueprintReadWrite)\n\t{t} {m['name']};"


def emit_ue_project(model, out_dir, plugin_name="RODGameSDK"):
    structs, enums, classes = model["structs"], model["enums"], model["classes"]
    row_structs, data_assets = classify(model)
    need_structs, need_enums, engine_types = transitive_closure(model, row_structs, data_assets)

    os.makedirs(out_dir, exist_ok=True)
    api = f"{plugin_name.upper()}_API"

    # ---- Enums ----
    lines = [
        "// RODGameEnums.h -- GENERATED by the ROD Database Toolkit from the",
        "// game's own Dumper-7 dump. Every value below is the real runtime",
        "// value; the Dumper-7 <Enum>_MAX sentinels are omitted (they are",
        "// tool artifacts, not game values).",
        "#pragma once",
        "#include \"CoreMinimal.h\"",
        "#include \"RODGameEnums.generated.h\"",
        "",
    ]
    for name in sorted(need_enums):
        e = enums[name]
        lines.append(f"UENUM(BlueprintType)")
        lines.append(f"enum class {name} : uint8")
        lines.append("{")
        for v in e["values"]:
            if v["isMaxSentinel"]:
                continue
            lines.append(f"\t{v['name']} = {v['value']} UMETA(DisplayName = \"{v['name']}\"),")
        lines.append("};")
        lines.append("")
    _write(os.path.join(out_dir, "RODGameEnums.h"), "\n".join(lines))

    # ---- Structs (row structs + everything they reach) ----
    # Declaration order matters for UHT: emit supers/dependencies first.
    ordered = _topo_sort(need_structs, structs)
    lines = [
        "// RODGameStructs.h -- GENERATED by the ROD Database Toolkit.",
        "// DataTable ROW STRUCTS (deriving FTableRowBase) plus every struct",
        "// they reference, re-expressed as UHT-visible USTRUCTs so a UE",
        "// 5.3.2 project can actually compile and use them (the raw Dumper-7",
        "// headers cannot -- they carry raw offsets, Pad_ members and no",
        "// UPROPERTY macros).",
        "//",
        "// Layout note: offsets are NOT reproduced. UE recomputes layout from",
        "// the declarations; matching the game's binary layout is neither",
        "// needed nor possible for an editor-side project. What matters for a",
        "// DataTable is that the FIELD NAMES AND TYPES match -- they do.",
        "#pragma once",
        "#include \"CoreMinimal.h\"",
        "#include \"Engine/DataTable.h\"",
        "#include \"RODGameEnums.h\"",
        "#include \"RODGameStructs.generated.h\"",
        "",
    ]
    for name in ordered:
        s = structs[name]
        sup = s.get("super")
        is_row = name in row_structs
        base = f" : public {sup}" if sup else ""
        lines.append(f"USTRUCT(BlueprintType)")
        lines.append(f"struct {api} {name}{base}")
        lines.append("{")
        lines.append("\tGENERATED_BODY()")
        lines.append("")
        for m in s["members"]:
            emitted = _emit_member(m, need_structs, need_enums)
            if emitted:
                lines.append(emitted)
                lines.append("")
        lines.append("};")
        lines.append("")
        if is_row:
            lines.append(f"// ^ DataTable row struct (import CSV/JSON rows against this type)")
            lines.append("")
    _write(os.path.join(out_dir, "RODGameStructs.h"), "\n".join(lines))

    # ---- DataAsset classes ----
    lines = [
        "// RODGameDataAssets.h -- GENERATED by the ROD Database Toolkit.",
        "// The game's UDataAsset classes (RODItemDataAsset and friends) with",
        "// their real TMap<int32, F...ItemData> properties -- these are the",
        "// containers the RODSchema typed loaders patch at runtime, and the",
        "// types a UE project needs to author replacement assets.",
        "#pragma once",
        "#include \"CoreMinimal.h\"",
        "#include \"Engine/DataAsset.h\"",
        "#include \"RODGameEnums.h\"",
        "#include \"RODGameStructs.h\"",
        "#include \"RODGameDataAssets.generated.h\"",
        "",
    ]
    for name in data_assets:
        c = classes[name]
        sup = c.get("super") or "UDataAsset"
        lines.append("UCLASS(BlueprintType)")
        lines.append(f"class {api} {name} : public {sup}")
        lines.append("{")
        lines.append("\tGENERATED_BODY()")
        lines.append("")
        lines.append("public:")
        for m in c["members"]:
            emitted = _emit_member(m, need_structs, need_enums)
            if emitted:
                lines.append(emitted)
                lines.append("")
        lines.append("};")
        lines.append("")
    _write(os.path.join(out_dir, "RODGameDataAssets.h"), "\n".join(lines))

    return {
        "rowStructs": row_structs,
        "dataAssets": data_assets,
        "structsEmitted": len(ordered),
        "enumsEmitted": len(need_enums),
        "engineTypesReferenced": sorted(engine_types),
    }


def _topo_sort(names, structs):
    """Supers and referenced structs before dependents (UHT needs full definitions)."""
    out, visiting, done = [], set(), set()

    def visit(n):
        if n in done or n not in names:
            return
        if n in visiting:
            return  # cycle: emit in encounter order (UE structs can't truly cycle by value)
        visiting.add(n)
        s = structs[n]
        if s.get("super"):
            visit(s["super"])
        for m in s["members"]:
            if not m["isPadding"]:
                for t in referenced_types(m["type"]):
                    visit(t)
        visiting.discard(n)
        done.add(n)
        out.append(n)

    for n in sorted(names):
        visit(n)
    return out


def _write(path, text):
    with open(path, "w", encoding="utf-8") as f:
        f.write(text.rstrip() + "\n")


# ---------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sdk_root", help="Folder containing CppSDK/ (a Dumper-7 dump root)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--module", default="ROD")
    ap.add_argument("--index", action="store_true", help="Write the JSON index")
    ap.add_argument("--emit-ue", action="store_true", help="Write UE-project C++ headers")
    ap.add_argument("--plugin-name", default="RODGameSDK")
    args = ap.parse_args()

    model = load_sdk(args.sdk_root, args.module)
    row_structs, data_assets = classify(model)
    print(f"Parsed {args.module}: {len(model['enums'])} enums, {len(model['structs'])} structs, "
          f"{len(model['classes'])} classes -- {len(row_structs)} DataTable row structs, "
          f"{len(data_assets)} DataAsset classes")

    if args.index:
        os.makedirs(args.out, exist_ok=True)
        _write_json(os.path.join(args.out, "Enums.json"), list(model["enums"].values()))
        _write_json(os.path.join(args.out, "Structs.json"), list(model["structs"].values()))
        _write_json(os.path.join(args.out, "Classes.json"), list(model["classes"].values()))
    if args.emit_ue:
        stats = emit_ue_project(model, args.out, args.plugin_name)
        print(f"Emitted UE headers: {stats['structsEmitted']} structs, {stats['enumsEmitted']} enums, "
              f"{len(stats['dataAssets'])} DataAsset classes")


def _write_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1)


if __name__ == "__main__":
    main()
