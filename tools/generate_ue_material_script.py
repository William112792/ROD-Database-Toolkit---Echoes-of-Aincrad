#!/usr/bin/env python3
"""
generate_ue_material_script.py -- emits a Python script that recreates a
material FAMILY (root master + every descendant instance) inside
Unreal Engine 5.3.2 via the Python Editor Script Plugin.

Usage (from tools/, after the pipeline's Materials Index has been built):

    python3 generate_ue_material_script.py --list
        Show every root master with its descendant count.

    python3 generate_ue_material_script.py --family M_CHR_Cel_MaterialTypes
        Write recreate_M_CHR_Cel_MaterialTypes.py next to this script.

    python3 generate_ue_material_script.py --family M_CHR_Cel_MaterialTypes \
        --dest-root /Game/ROD_Recreated --texture-root /Game/ROD
        Override where assets are created / where already-imported
        textures are looked up.

Run the EMITTED script inside the UE editor (Window > Developer Tools >
Output Log, `py "recreate_....py"`, or Tools > Execute Python Script).

WHAT IT RECREATES (all read from the real export, per-family):
  - The full parent->child hierarchy, created in dependency order --
    parents are created and saved BEFORE any child links to them
    (instances only need the parent asset to exist; they don't need
    the parent's shader compiled first, but the script compiles the
    master anyway so instances preview correctly as they're created).
  - The root master as a real Material asset with: blend mode, opacity
    mask clip value, usage flags, and ONE PARAMETER NODE for every
    parameter any member of the family references (scalar / vector /
    texture / static switch), laid out in a labeled grid, defaults
    taken from the closest-to-root value. This makes every instance
    override bind by name exactly like the original family.
  - Every MaterialInstanceConstant with its parent link and its own
    scalar / vector / texture / static-switch overrides and base
    property overrides.

WHAT IT CANNOT RECREATE (stated here and in the emitted script header,
because the data genuinely is not in the export -- verified, not
assumed):
  - The master's internal node/event graph. Cooked builds strip the
    editor-only expression graph (zero MaterialExpression objects,
    empty CachedExpressionData in every sampled master). The emitted
    master wires nothing to the output pins beyond a BaseColor hookup
    of the most plausible color/texture parameter so the result is
    visibly textured -- the actual cel-shading math must be rebuilt by
    hand (the parameter scaffolding this script creates is the map for
    that work).
  - The MSM_CelSf shading model. It is a CUSTOM engine shading model in
    this game's modified UE; stock 5.3.2 has no such enum, so the
    emitted script substitutes DEFAULT_LIT and logs a warning per
    affected material. bIncludedInBaseGame and other cook-only flags
    are skipped for the same reason.
  - Texture pixel data. Texture parameters are resolved by path under
    --texture-root; import the game's textures first (the toolkit's
    Asset Inspector download buttons + Blender/UE import), or the
    emitted script logs each miss and leaves that parameter unset.
"""
import argparse
import json
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
MATERIALS_JSON = os.path.join(
    PROJECT_ROOT, "Content", "ROD", "DataAssets", "Database", "Materials", "Materials.json")


def load_materials():
    if not os.path.exists(MATERIALS_JSON):
        sys.exit("Materials index not built yet -- run: python3 build_pipeline.py --only=materials")
    with open(MATERIALS_JSON, "r", encoding="utf-8") as f:
        entries = json.load(f)
    return {e["jsonPath"]: e for e in entries}


def family_of(entries, root_key):
    """Root entry + all transitive descendants, in parents-before-children order."""
    root = None
    for e in entries.values():
        if e["name"] == root_key or e["jsonPath"] == root_key:
            root = e
            break
    if root is None:
        sys.exit(f"No material named '{root_key}'. Try --list.")
    # Walk up to the true root if the user named a mid-chain asset.
    while root["parentJson"] and root["parentJson"] in entries:
        root = entries[root["parentJson"]]
    ordered, queue = [], [root["jsonPath"]]
    while queue:
        cur = queue.pop(0)
        ordered.append(entries[cur])
        queue.extend(c for c in entries[cur]["children"] if c in entries)
    return root, ordered


def ue_pkg_path(json_path, dest_root):
    """raw-relative 'BaseMaterials/CHR/.../M_X.json' -> '/Game/.../M_X' under dest_root."""
    rel = json_path[:-5] if json_path.endswith(".json") else json_path
    return f"{dest_root.rstrip('/')}/{rel}"


def tex_pkg_path(object_path, texture_root):
    """'/Game/ROD/Widget/.../T_X.0' -> '{texture_root}/Widget/.../T_X' (or None)."""
    if not object_path or not object_path.startswith("/Game/ROD/"):
        return None
    rel = object_path[len("/Game/ROD/"):].split(".")[0]
    return f"{texture_root.rstrip('/')}/{rel}"


BLEND_MAP = {
    "BLEND_Opaque": "unreal.BlendMode.BLEND_OPAQUE",
    "BLEND_Masked": "unreal.BlendMode.BLEND_MASKED",
    "BLEND_Translucent": "unreal.BlendMode.BLEND_TRANSLUCENT",
    "BLEND_Additive": "unreal.BlendMode.BLEND_ADDITIVE",
    "BLEND_Modulate": "unreal.BlendMode.BLEND_MODULATE",
    "BLEND_AlphaComposite": "unreal.BlendMode.BLEND_ALPHA_COMPOSITE",
    "BLEND_AlphaHoldout": "unreal.BlendMode.BLEND_ALPHA_HOLDOUT",
}

USAGE_PROP_MAP = {
    # export flag -> Material editor property (5.3.2 names)
    "bUsedWithSkeletalMesh": "used_with_skeletal_mesh",
    "bUsedWithStaticLighting": "used_with_static_lighting",
    "bUsedWithInstancedStaticMeshes": "used_with_instanced_static_meshes",
    "bUsedWithMorphTargets": "used_with_morph_targets",
    "bUsedWithClothing": "used_with_clothing",
    "bUsedWithMeshParticles": "used_with_mesh_particles",
    "bUsedWithNiagaraMeshParticles": "used_with_niagara_mesh_particles",
    "bUsedWithNanite": "used_with_nanite",
}


def collect_family_parameters(members):
    """
    One entry per (group, name) across the whole family, default = the
    value set closest to the root (members arrive parents-first, so
    first writer wins).
    """
    params = {}
    for m in members:
        for group in ("scalarParams", "vectorParams", "textureParams", "staticSwitchParams"):
            for prm in m[group]:
                key = (group, prm["name"])
                if prm["name"] and key not in params:
                    params[key] = prm["value"]
    return params


def emit(root, members, dest_root, texture_root):
    fam_params = collect_family_parameters(members)
    lines = []
    w = lines.append
    w('"""')
    w(f"Recreates the {root['name']} material family in UE 5.3.2 -- GENERATED, do not hand-edit")
    w(f"(regenerate via tools/generate_ue_material_script.py --family {root['name']}).")
    w("")
    w(f"Family: 1 master + {len(members) - 1} descendants, created parents-before-children.")
    w("Read the header of generate_ue_material_script.py for exactly what is and is not")
    w("recreated. In particular: the master's internal node graph is NOT in the game's")
    w("cooked export, and MSM_CelSf is a custom engine shading model -- DEFAULT_LIT is")
    w("substituted and a warning logged per affected material.")
    w('"""')
    w("import unreal")
    w("")
    w("AT = unreal.AssetToolsHelpers.get_asset_tools()")
    w("MEL = unreal.MaterialEditingLibrary")
    w("EAL = unreal.EditorAssetLibrary")
    w("")
    w("def ensure_dir(pkg):")
    w("    folder = pkg.rsplit('/', 1)[0]")
    w("    if not EAL.does_directory_exist(folder):")
    w("        EAL.make_directory(folder)")
    w("")
    w("def find_texture(path):")
    w("    if path and EAL.does_asset_exist(path):")
    w("        return unreal.load_asset(path)")
    w("    unreal.log_warning(f'[recreate] texture not imported yet, parameter left unset: {path}')")
    w("    return None")
    w("")

    # ---- master ----
    master_pkg = ue_pkg_path(root["jsonPath"], dest_root)
    master_name = root["name"]
    w(f"# ===== master: {master_name} =====")
    w(f"master_pkg = '{master_pkg}'")
    w("ensure_dir(master_pkg)")
    w("if EAL.does_asset_exist(master_pkg):")
    w("    master = unreal.load_asset(master_pkg)")
    w("    unreal.log(f'[recreate] master already exists, reusing: {master_pkg}')")
    w("else:")
    w(f"    master = AT.create_asset('{master_name}', master_pkg.rsplit('/', 1)[0], unreal.Material, unreal.MaterialFactoryNew())")
    blend = BLEND_MAP.get(root.get("blendMode", ""))
    if blend:
        w(f"master.set_editor_property('blend_mode', {blend})")
    if root.get("customShadingModel"):
        w(f"unreal.log_warning('[recreate] {master_name}: game uses custom shading model {root['shadingModel']} -- ' ")
        w("                   'stock 5.3.2 has no such enum, substituting DEFAULT_LIT; rebuild the cel response by hand')")
        w("master.set_editor_property('shading_model', unreal.MaterialShadingModel.MSM_DEFAULT_LIT)")
    if root.get("opacityMaskClipValue") is not None:
        w(f"master.set_editor_property('opacity_mask_clip_value', {root['opacityMaskClipValue']})")
    for flag in root.get("usageFlags", []):
        prop = USAGE_PROP_MAP.get(flag)
        if prop:
            w(f"master.set_editor_property('{prop}', True)")
    w("")
    w("# One parameter node per name any family member references, laid out in a grid.")
    w("# This is the SCAFFOLDING for rebuilding the shader math by hand -- every")
    w("# instance override below binds to these by name, exactly like the original.")
    col = {"scalarParams": 0, "vectorParams": 1, "textureParams": 2, "staticSwitchParams": 3}
    row_idx = {g: 0 for g in col}
    first_tex_var = None
    first_vec_var = None
    for (group, name), default in sorted(fam_params.items()):
        r = row_idx[group]; row_idx[group] += 1
        x = -1400 + col[group] * 340
        y = -600 + r * 160
        var = f"p_{re.sub(r'[^A-Za-z0-9]', '_', str(name))}_{col[group]}"
        if group == "scalarParams":
            w(f"{var} = MEL.create_material_expression(master, unreal.MaterialExpressionScalarParameter, {x}, {y})")
            w(f"{var}.set_editor_property('parameter_name', '{name}')")
            if isinstance(default, (int, float)):
                w(f"{var}.set_editor_property('default_value', {float(default)})")
        elif group == "vectorParams":
            w(f"{var} = MEL.create_material_expression(master, unreal.MaterialExpressionVectorParameter, {x}, {y})")
            w(f"{var}.set_editor_property('parameter_name', '{name}')")
            if isinstance(default, dict):
                w(f"{var}.set_editor_property('default_value', unreal.LinearColor("
                  f"{default.get('R', 0)}, {default.get('G', 0)}, {default.get('B', 0)}, {default.get('A', 1)}))")
            if first_vec_var is None:
                first_vec_var = var
        elif group == "textureParams":
            w(f"{var} = MEL.create_material_expression(master, unreal.MaterialExpressionTextureSampleParameter2D, {x}, {y})")
            w(f"{var}.set_editor_property('parameter_name', '{name}')")
            tex_path = tex_pkg_path(default, texture_root) if isinstance(default, str) else None
            if tex_path:
                w(f"_t = find_texture('{tex_path}')")
                w(f"if _t: {var}.set_editor_property('texture', _t)")
            if first_tex_var is None and name and "base" in str(name).lower() or first_tex_var is None and name and "main" in str(name).lower():
                first_tex_var = var
            if first_tex_var is None:
                first_tex_var = var
        else:  # staticSwitchParams
            w(f"{var} = MEL.create_material_expression(master, unreal.MaterialExpressionStaticSwitchParameter, {x}, {y})")
            w(f"{var}.set_editor_property('parameter_name', '{name}')")
            if isinstance(default, bool):
                w(f"{var}.set_editor_property('default_value', {default})")
        w("")
    # Minimal visible hookup so the recreated master isn't a black blob.
    hook = first_tex_var or first_vec_var
    if hook:
        w("# Visible-preview hookup only -- NOT the original graph (which the export doesn't contain).")
        w(f"MEL.connect_material_property({hook}, '', unreal.MaterialProperty.MP_BASE_COLOR)")
    w("MEL.recompile_material(master)")
    w("EAL.save_asset(master_pkg)")
    w("")

    # ---- instances, parents-first (members is already topologically ordered) ----
    for m in members[1:]:
        pkg = ue_pkg_path(m["jsonPath"], dest_root)
        parent_pkg = ue_pkg_path(m["parentJson"], dest_root) if m["parentJson"] else master_pkg
        w(f"# ----- {m['type']}: {m['name']} (parent: {os.path.basename(parent_pkg)}) -----")
        if not m.get("parentExists", True):
            w(f"unreal.log_warning('[recreate] {m['name']}: parent JSON was missing from the export upload -- ' ")
            w(f"                   'parenting to the family master instead; re-export the parent for exact structure')")
            parent_pkg = master_pkg
        w(f"pkg = '{pkg}'")
        w("ensure_dir(pkg)")
        w("if EAL.does_asset_exist(pkg):")
        w("    mi = unreal.load_asset(pkg)")
        w("else:")
        w(f"    mi = AT.create_asset('{m['name']}', pkg.rsplit('/', 1)[0], unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())")
        w(f"MEL.set_material_instance_parent(mi, unreal.load_asset('{parent_pkg}'))")
        for prm in m["scalarParams"]:
            if prm["name"] is not None and isinstance(prm["value"], (int, float)):
                w(f"MEL.set_material_instance_scalar_parameter_value(mi, '{prm['name']}', {float(prm['value'])})")
        for prm in m["vectorParams"]:
            v = prm["value"]
            if prm["name"] is not None and isinstance(v, dict):
                w(f"MEL.set_material_instance_vector_parameter_value(mi, '{prm['name']}', unreal.LinearColor("
                  f"{v.get('R', 0)}, {v.get('G', 0)}, {v.get('B', 0)}, {v.get('A', 1)}))")
        for prm in m["textureParams"]:
            tex_path = tex_pkg_path(prm["value"], texture_root) if isinstance(prm["value"], str) else None
            if prm["name"] is not None and tex_path:
                w(f"_t = find_texture('{tex_path}')")
                w(f"if _t: MEL.set_material_instance_texture_parameter_value(mi, '{prm['name']}', _t)")
        for prm in m["staticSwitchParams"]:
            if prm["name"] is not None and isinstance(prm["value"], bool):
                w(f"MEL.set_material_instance_static_switch_parameter_value(mi, '{prm['name']}', {prm['value']})")
        ov = []
        blend = BLEND_MAP.get(m.get("blendMode", ""))
        if blend or m.get("opacityMaskClipValue") is not None or m.get("customShadingModel"):
            w("bpo = mi.get_editor_property('base_property_overrides')")
            if blend:
                w("bpo.set_editor_property('override_blend_mode', True)")
                w(f"bpo.set_editor_property('blend_mode', {blend})")
            if m.get("opacityMaskClipValue") is not None:
                w("bpo.set_editor_property('override_opacity_mask_clip_value', True)")
                w(f"bpo.set_editor_property('opacity_mask_clip_value', {m['opacityMaskClipValue']})")
            if m.get("customShadingModel"):
                w(f"unreal.log_warning('[recreate] {m['name']}: original override was {m['shadingModel']} (custom) -- skipped')")
            w("mi.set_editor_property('base_property_overrides', bpo)")
        w("MEL.update_material_instance(mi)")
        w("EAL.save_asset(pkg)")
        w("")
    w(f"unreal.log('[recreate] done: {root['name']} family, {len(members)} assets')")
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="list root masters with descendant counts")
    ap.add_argument("--family", help="root master name (or any member -- the chain is walked up)")
    ap.add_argument("--dest-root", default="/Game/ROD_Recreated",
                    help="UE content path recreated assets are created under (default /Game/ROD_Recreated)")
    ap.add_argument("--texture-root", default="/Game/ROD",
                    help="UE content path where the game's textures were imported (default /Game/ROD)")
    ap.add_argument("--out", help="output .py path (default recreate_<root>.py next to this script)")
    args = ap.parse_args()

    entries = load_materials()
    if args.list:
        roots = {}
        for e in entries.values():
            roots.setdefault(e["rootJson"], 0)
            roots[e["rootJson"]] += 1
        for rj, n in sorted(roots.items(), key=lambda x: -x[1]):
            name = entries[rj]["name"] if rj in entries else os.path.basename(rj).replace(".json", "")
            broken = "" if rj in entries and entries[rj]["type"] == "Material" else "  [root JSON missing/instance -- chain broken]"
            print(f"{n:4}  {name}{broken}")
        return
    if not args.family:
        ap.error("--family or --list required")
    root, members = family_of(entries, args.family)
    script = emit(root, members, args.dest_root, args.texture_root)
    out = args.out or os.path.join(SCRIPT_DIR, f"recreate_{root['name']}.py")
    with open(out, "w", encoding="utf-8") as f:
        f.write(script)
    print(f"Wrote {out}: 1 master + {len(members) - 1} descendants "
          f"({sum(1 for m in members if m['customShadingModel'])} use the custom MSM_CelSf model -- DEFAULT_LIT substituted).")
    print("Run inside UE 5.3.2: Tools > Execute Python Script (Python Editor Script Plugin enabled).")


if __name__ == "__main__":
    main()
