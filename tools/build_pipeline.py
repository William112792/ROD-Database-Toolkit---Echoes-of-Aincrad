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
import struct
import zlib

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
LAST_BUILD_STATUS_PATH = os.path.join(PROJECT_ROOT, ".last-build-status.json")
# Cached copy of the last FULL status report (--status output). Written
# every time --status computes fresh, read back by --status-cached: the
# schema check really runs every section, which by 44 sections + the
# Maps/DNG level scans takes minutes -- far too slow for the Build
# Dashboard's page-load request (it produced a real 500/504 from a real
# deployment). The dashboard now loads THIS instantly and re-runs the
# real checks only on explicit request, as a background job.
LAST_PIPELINE_STATUS_PATH = os.path.join(PROJECT_ROOT, ".last-pipeline-status.json")

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


# The game's own map icon PNGs (Widget/3DMapCapture/MapIcon/IconImages)
# are unrecolored MASK sprites, not final art: verified by direct pixel
# sampling -- every icon's opaque pixels are pure red (255,0,0) for the
# main shape and pure green (0,166,0-ish) for a secondary shape (almost
# certainly a drop-shadow layer), meant for the game's own UI material
# to tint at runtime. This toolkit has no such material/shader to run,
# so build_map_icons() recolors them itself with real image processing:
# the green channel becomes a soft, offset, dark drop shadow (for the
# "make it look more 3D" request), and the red channel becomes a flat
# fill in whichever color is confirmed for that icon type -- WHITE when
# the true in-game color isn't confirmed, rather than guessing a color
# and presenting it as fact.
MAP_ICON_COLORS = {
    # key: (source icon filename stem, target hex fill color, confirmed?)
    # Confirmed by explicit user instruction across sessions.
    "safeArea": ("T_Mapicon_SafetyArea", "#FFFFFF", True),
    "warpTerminal": ("T_Mapicon_TeleportGate", "#FFFFFF", True),
    "treasureChest": ("T_Mapicon_Treasure", "#FFD54A", True),
    "ark": ("T_Mapicon_KeyArc", "#B47CE5", True),
    "seal": ("T_Mapicon_Seal", "#E5484D", True),
    "magicalSeal": ("T_Mapicon_AmuletSeal", "#FF7AC6", True),
    "sideQuestTrinket": ("T_Mapicon_SubQuest", "#FFD54A", True),
    "townSmithy": ("T_Mapicon_Blacksmith", "#4CD97B", True),
    "townChest": ("T_Mapicon_Chest", "#3FD5C8", True),
    "townItemSeller": ("T_Mapicon_ItemShop", "#FFA23F", True),
    # The classic pin + 5 "instant pin" skins -- all confirmed yellow
    # (same family as the original Waypoint color), offered as
    # different PIN GRAPHICS a manual marker entry can choose between,
    # not different meanings.
    "waypoint": ("T_Mapicon_Pin", "#FFD54A", True),
    "waypointPinBase": ("T_Mapicon_InstantPin_Base", "#FFD54A", True),
    "waypointPinCommon": ("T_Mapicon_InstantPin_Common", "#FFD54A", True),
    "waypointPinEnemy": ("T_Mapicon_InstantPin_Enemy", "#FFD54A", True),
    "waypointPinGimmick": ("T_Mapicon_InstantPin_Gimmick", "#FFD54A", True),
    "waypointPinItem": ("T_Mapicon_InstantPin_Item", "#FFD54A", True),
    # Not given an explicit color -- white per "white instead of red if
    # we aren't sure of its color", not a guess.
    "town": ("T_Mapicon_Town", "#FFFFFF", False),
    "dungeon": ("T_Mapicon_Dungeon_Entrance", "#FFFFFF", False),
    "searchTerminal": ("T_Mapicon_SearchTerminal", "#FFFFFF", False),
    "door": ("T_Mapicon_Door", "#FFFFFF", False),
    "boss": ("T_Mapicon_BossEnemy", "#FFFFFF", False),
    "eliteMonster": ("T_Mapicon_EliteEnemy", "#FFFFFF", False),
    "monsterSpawn": ("T_Mapicon_Enemy", "#FFFFFF", False),
    "material": ("T_Mapicon_Item", "#FFFFFF", False),
    "missionObjective": ("T_Mapicon_OtherGimmick", "#FFFFFF", False),
    "player": ("T_Mapicon_Hero", "#FFFFFF", False),
}


def _png_read_rgba(path):
    """
    Minimal pure-stdlib PNG decoder (zlib + struct only -- no Pillow),
    scoped deliberately to exactly what these 26 icon files are:
    verified 8-bit-per-channel RGBA (color type 6), non-interlaced.
    Written after a real deployment couldn't get Pillow/numpy
    installed at all (no Dockerfile of this project's own to add a
    RUN pip install to, and no reliable shell access to a running
    container to install into persistently) -- rather than keep
    asking for an install that isn't practical for that environment,
    map icon recoloring no longer needs ANY third-party package.

    Returns (width, height, rgba_bytearray) with rgba_bytearray laid
    out row-major, 4 bytes per pixel. Raises ValueError for any PNG
    outside the verified 8-bit-RGBA-non-interlaced shape rather than
    silently mishandling it -- callers should catch that and fall back
    (to Pillow, if available, or skip that one icon) instead of
    trusting a wrong decode.
    """
    with open(path, "rb") as f:
        data = f.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path}: not a PNG (bad signature)")

    pos = 8
    width = height = bitdepth = colortype = interlace = None
    idat = bytearray()
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        ctype = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        if ctype == b"IHDR":
            width, height, bitdepth, colortype, _comp, _filt, interlace = struct.unpack(">IIBBBBB", chunk)
        elif ctype == b"IDAT":
            idat += chunk
        elif ctype == b"IEND":
            break
        pos += 8 + length + 4  # length + type + data + crc

    if bitdepth != 8 or colortype != 6 or interlace != 0:
        raise ValueError(f"{path}: unsupported PNG shape (bitdepth={bitdepth}, colortype={colortype}, interlace={interlace}) -- only 8-bit RGBA non-interlaced is implemented")

    raw = zlib.decompress(bytes(idat))
    bpp = 4  # bytes per pixel for 8-bit RGBA
    stride = width * bpp
    out = bytearray(width * height * bpp)
    prev_row = bytearray(stride)
    src_pos = 0
    for y in range(height):
        filter_type = raw[src_pos]
        src_pos += 1
        row = bytearray(raw[src_pos:src_pos + stride])
        src_pos += stride
        if filter_type == 0:
            pass  # None
        elif filter_type == 1:  # Sub
            for i in range(bpp, stride):
                row[i] = (row[i] + row[i - bpp]) & 0xFF
        elif filter_type == 2:  # Up
            for i in range(stride):
                row[i] = (row[i] + prev_row[i]) & 0xFF
        elif filter_type == 3:  # Average
            for i in range(stride):
                left = row[i - bpp] if i >= bpp else 0
                up = prev_row[i]
                row[i] = (row[i] + ((left + up) // 2)) & 0xFF
        elif filter_type == 4:  # Paeth
            for i in range(stride):
                left = row[i - bpp] if i >= bpp else 0
                up = prev_row[i]
                up_left = prev_row[i - bpp] if i >= bpp else 0
                p = left + up - up_left
                pa, pb, pc = abs(p - left), abs(p - up), abs(p - up_left)
                pred = left if (pa <= pb and pa <= pc) else (up if pb <= pc else up_left)
                row[i] = (row[i] + pred) & 0xFF
        else:
            raise ValueError(f"{path}: unknown PNG filter type {filter_type}")
        out[y * stride:(y + 1) * stride] = row
        prev_row = row
    return width, height, out


def _png_write_rgba(path, width, height, rgba):
    """
    Minimal pure-stdlib PNG encoder matching _png_read_rgba -- writes
    8-bit RGBA, filter type 0 (None) on every scanline (larger files
    than a real encoder's adaptive filtering, entirely irrelevant at
    icon sizes) and lets zlib do the compression work.
    """
    stride = width * 4
    filtered = bytearray()
    for y in range(height):
        filtered.append(0)  # filter type None
        filtered += rgba[y * stride:(y + 1) * stride]
    compressed = zlib.compress(bytes(filtered), 9)

    def chunk(ctype, payload):
        return (struct.pack(">I", len(payload)) + ctype + payload
                + struct.pack(">I", zlib.crc32(ctype + payload) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", compressed))
        f.write(chunk(b"IEND", b""))


def _box_blur_alpha(alpha, width, height, radius):
    """
    Cheap separable box blur over a single 0-255 alpha channel (plain
    Python, no numpy) -- run twice (horizontal then vertical passes)
    to approximate the soft drop-shadow a Gaussian blur gave when PIL
    was doing the work. Good enough at icon sizes (~64px); not trying
    to be a general-purpose image filter.
    """
    if radius <= 0:
        return alpha
    size = 2 * radius + 1

    def blur_1d(src, w, h, horizontal):
        dst = bytearray(len(src))
        for y in range(h):
            for x in range(w):
                total = 0
                count = 0
                for d in range(-radius, radius + 1):
                    if horizontal:
                        xx = x + d
                        if 0 <= xx < w:
                            total += src[y * w + xx]
                            count += 1
                    else:
                        yy = y + d
                        if 0 <= yy < h:
                            total += src[yy * w + x]
                            count += 1
                dst[y * w + x] = total // count
        return dst

    pass1 = blur_1d(alpha, width, height, True)
    pass2 = blur_1d(pass1, width, height, False)
    return pass2


def _hex_to_rgb(hexstr):
    hexstr = hexstr.lstrip("#")
    return tuple(int(hexstr[i:i+2], 16) for i in (0, 2, 4))


def _recolor_icon_pure_python(src_path, out_path, hexcolor):
    """
    Recolors one icon using ONLY the stdlib PNG codec above -- no
    Pillow/numpy. Same algorithm as the PIL path (green -> soft offset
    drop shadow, red -> flat confirmed/white fill, crop to content
    bbox with a small margin), reimplemented with plain Python loops
    over bytearrays. Icons are ~64px, and this runs once per icon at
    build time, so the lack of vectorization doesn't matter in
    practice (the whole 26-icon set takes well under a second).
    """
    width, height, rgba = _png_read_rgba(src_path)
    fill_rgb = _hex_to_rgb(hexcolor)
    pad = 4
    cw, ch = width + pad, height + pad

    # Classify each source pixel and build two RGBA layers at the
    # padded canvas size, shadow offset by (2,2), main shape at (0,0).
    shadow_alpha_src = bytearray(width * height)
    main_canvas = bytearray(cw * ch * 4)  # transparent black by default
    shadow_canvas_alpha = bytearray(cw * ch)

    for y in range(height):
        for x in range(width):
            i = (y * width + x) * 4
            r, g, b, a = rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]
            if a <= 20:
                continue
            if g > r and g > 40:
                shadow_alpha_src[y * width + x] = 150
            elif r >= g and r > 40:
                cx, cy = x, y  # main shape at (0,0) offset
                ci = (cy * cw + cx) * 4
                main_canvas[ci:ci + 4] = bytes((fill_rgb[0], fill_rgb[1], fill_rgb[2], a))

    blurred = _box_blur_alpha(shadow_alpha_src, width, height, 1)
    for y in range(height):
        for x in range(width):
            v = blurred[y * width + x]
            if v <= 2:
                continue
            cx, cy = x + 2, y + 2  # shadow offset
            shadow_canvas_alpha[cy * cw + cx] = v

    # Composite shadow under main (main already fully opaque where set,
    # so a straight overwrite is correct -- there's no partial-alpha
    # blending needed between the two layers at their respective pixels
    # since red/green classification is mutually exclusive per source
    # pixel and their canvas positions only overlap at the 2px offset
    # seam, where "main wins" is exactly the intended look).
    canvas = bytearray(cw * ch * 4)
    for p in range(cw * ch):
        a = shadow_canvas_alpha[p]
        if a:
            canvas[p * 4:p * 4 + 4] = bytes((0, 0, 0, a))
    for p in range(cw * ch):
        if main_canvas[p * 4 + 3]:
            canvas[p * 4:p * 4 + 4] = main_canvas[p * 4:p * 4 + 4]

    # Crop to content bbox + small margin, same as the PIL path.
    min_x, min_y, max_x, max_y = cw, ch, -1, -1
    for y in range(ch):
        for x in range(cw):
            if canvas[(y * cw + x) * 4 + 3] > 0:
                if x < min_x: min_x = x
                if x > max_x: max_x = x
                if y < min_y: min_y = y
                if y > max_y: max_y = y
    if max_x < 0:
        _png_write_rgba(out_path, cw, ch, canvas)
        return
    margin = 2
    x0 = max(0, min_x - margin); y0 = max(0, min_y - margin)
    x1 = min(cw - 1, max_x + margin); y1 = min(ch - 1, max_y + margin)
    out_w, out_h = x1 - x0 + 1, y1 - y0 + 1
    cropped = bytearray(out_w * out_h * 4)
    for y in range(out_h):
        src_row_start = ((y0 + y) * cw + x0) * 4
        cropped[y * out_w * 4:(y + 1) * out_w * 4] = canvas[src_row_start:src_row_start + out_w * 4]
    _png_write_rgba(out_path, out_w, out_h, cropped)


def _recolor_icon_pil(src_path, out_path, hexcolor):
    """Same algorithm, using PIL/numpy when they happen to be available (faster, identical result)."""
    from PIL import Image, ImageFilter
    import numpy as np
    im = Image.open(src_path).convert("RGBA")
    arr = np.array(im).astype(np.int16)
    r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
    opaque = a > 20
    is_green = opaque & (g > r) & (g > 40)
    is_red = opaque & (r >= g) & (r > 40)

    h, w = r.shape
    shadow_alpha = np.where(is_green, 150, 0).astype(np.uint8)
    shadow_im = Image.fromarray(shadow_alpha, "L")
    shadow_rgba = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    shadow_rgba.putalpha(shadow_im)
    shadow_rgba = shadow_rgba.filter(ImageFilter.GaussianBlur(1.1))
    pad = 4
    canvas = Image.new("RGBA", (w + pad, h + pad), (0, 0, 0, 0))
    canvas.alpha_composite(shadow_rgba, (2, 2))

    fill_rgb = _hex_to_rgb(hexcolor)
    main_alpha = np.where(is_red, a, 0).astype(np.uint8)
    main_rgba = np.zeros((h, w, 4), dtype=np.uint8)
    main_rgba[:, :, 0] = fill_rgb[0]
    main_rgba[:, :, 1] = fill_rgb[1]
    main_rgba[:, :, 2] = fill_rgb[2]
    main_rgba[:, :, 3] = main_alpha
    main_im = Image.fromarray(main_rgba, "RGBA")
    canvas.alpha_composite(main_im, (0, 0))

    bbox = canvas.getbbox()
    if bbox:
        margin = 2
        x0, y0, x1, y1 = bbox
        x0 = max(0, x0 - margin); y0 = max(0, y0 - margin)
        x1 = min(canvas.width, x1 + margin); y1 = min(canvas.height, y1 + margin)
        canvas = canvas.crop((x0, y0, x1, y1))
    canvas.save(out_path)


def build_map_icons():
    """
    Builds Content/ROD/DataAssets/_MapIcons/<key>.png -- recolored,
    shadowed versions of the game's raw red/green mask icon sprites
    (see MAP_ICON_COLORS above for the full discovery):

      1. Read the source icon's raw RGBA pixels.
      2. Green-channel-dominant pixels (the shadow shape) become a
         soft, downward-and-right offset, blurred, semi-transparent
         black shadow -- giving the flat mask a sense of depth ("look
         more 3D") instead of a second flat green shape.
      3. Red-channel-dominant pixels (the main shape) become a flat
         fill of the confirmed (or honestly-white-if-unconfirmed)
         color, composited OVER the shadow.
      4. Crop tightly to content bbox + a small margin, so a marker
         render at ~26-28px isn't mostly empty padding.

    ZERO required dependencies: uses a small pure-stdlib PNG decoder/
    encoder (_png_read_rgba/_png_write_rgba, zlib + struct only) as
    the DEFAULT path, verified against all 26 source icons (8-bit
    RGBA, non-interlaced -- the only shape this codec implements).
    PIL/numpy are used INSTEAD when actually importable (faster,
    identical output), but are no longer required for this feature to
    work at all.

    HISTORY: an earlier version required Pillow/numpy and degraded to
    "no icons" when they weren't installed, which turned out to be a
    real, unresolvable problem for at least one deployment -- no
    project Dockerfile to add a RUN pip install to, and no reliably
    persistent way to install into a running container by hand. Rather
    than keep asking for an install that isn't practical everywhere
    this toolkit runs, this feature no longer needs one.
    """
    use_pil = False
    try:
        from PIL import Image, ImageFilter  # noqa: F401
        import numpy as np  # noqa: F401
        use_pil = True
    except ImportError:
        pass

    icon_src_dir = os.path.join(SRC, "Widget/3DMapCapture/MapIcon/IconImages")
    out_dir = os.path.join(OUT, "DataAssets/_MapIcons")
    os.makedirs(out_dir, exist_ok=True)

    index = {}
    errors = []
    for key, (stem, hexcolor, confirmed) in MAP_ICON_COLORS.items():
        src_path = os.path.join(icon_src_dir, f"{stem}.png")
        if not os.path.exists(src_path):
            continue
        out_path = os.path.join(out_dir, f"{key}.png")
        try:
            if use_pil:
                _recolor_icon_pil(src_path, out_path, hexcolor)
            else:
                _recolor_icon_pure_python(src_path, out_path, hexcolor)
        except Exception as e:
            errors.append((key, str(e)))
            continue
        index[key] = {
            "file": f"DataAssets/_MapIcons/{key}.png",
            "color": hexcolor,
            "colorConfirmed": confirmed,
            "sourceIcon": f"Widget/3DMapCapture/MapIcon/IconImages/{stem}.png",
        }

    save_json(os.path.join(out_dir, "_index.json"), index)
    confirmed_count = sum(1 for v in index.values() if v["colorConfirmed"])
    engine = "PIL/numpy" if use_pil else "pure-stdlib PNG codec (no dependencies)"
    print(f"  Map icons: {len(index)} recolored via {engine} "
          f"({confirmed_count} confirmed colors, {len(index) - confirmed_count} defaulted to white -- unconfirmed)")
    if errors:
        print(f"  WARNING: {len(errors)} icon(s) failed to recolor: {errors}")
    return index


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


def build_item_sources(all_weapons, all_armor, all_items, all_recipes, all_chests, all_monster_drops, all_shops):
    """
    Builds Content/ROD/DataAssets/Database/ItemSources/ItemSources.json
    -- a per-itemKey cross-reference answering "where does this thing
    actually come from", assembled from sections that already exist
    (Recipes, Chests, Monsters > Drops, Shops) rather than recomputing
    anything. Built as ONE combining pass over all of them (526 chests
    x their pools, 242 drop rows x their pools, ~245 recipes, 6 shops)
    so every Weapon/Armor/Consumable preview panel does a single O(1)
    dict lookup instead of re-scanning these datasets client-side on
    every render.

    For a given finished item (a weapon, armor piece, or catalog item,
    identified by its OWN itemKey), the assembled entry can carry:
      - recipe: the recipe that PRODUCES this item, if any (looked up
        by matching recipe.producedItemKey to this item's key) --
        includes its own recipeKey, colCost, and materials list.
      - recipeFoundInChests / recipeDroppedByMonsters: locations for
        the RECIPE ITSELF (not the finished item), resolved by
        re-using the SAME chest/drop pool scan below against the
        recipe's own itemKey (the "purchase token" -- confirmed
        pattern from the Shops section).
      - recipeAvailableInShops: shop id(s) selling that recipe,
        resolved via the confirmed Cost-token -> recipe join Shops
        already established.
      - foundInChests / droppedByMonsters: locations for the FINISHED
        item itself, in case it's ALSO placed as direct loot (checked
        generically -- not assumed to never happen).
      - usedAsMaterialIn: recipes that consume this item as one of
        their crafting materials (the reverse of "materials").
      - sourceDataTables / sourceDataAssets: the real file paths this
        item's own data was built from, for the "show your sources"
        request -- same paths already recorded in each contributing
        section's own docstrings, just surfaced per-item now.

    HONEST LIMIT: this cross-reference can only be as complete as the
    sections feeding it. Chests/Drops resolve most, not all, item
    slots (Cost/Col/Invalid remain unresolved -- see those sections'
    own coverage notes); an item with no recipe, no chest hit, and no
    drop hit is NOT "wrong", it may simply not be attainable through
    any of the three systems this export exposes attainability data
    for (e.g. quest rewards, an unexported system, or simply unused
    data) -- the preview panel states this per-item rather than
    showing an empty section with no explanation.
    """
    # Recipe reverse-lookups.
    recipe_by_produced = {}       # producedItemKey -> recipe
    materials_used_in = {}        # materialItemKey -> [ {recipeKey, itemKey, producedItemKey, quantity} ]
    for recipe in all_recipes.values():
        if recipe.get("producedItemKey"):
            recipe_by_produced[recipe["producedItemKey"]] = recipe
        for mat in recipe.get("materials", []):
            if mat.get("itemKey"):
                materials_used_in.setdefault(mat["itemKey"], []).append({
                    "recipeKey": recipe["recipeKey"],
                    "itemKey": recipe["itemKey"],
                    "producedItemKey": recipe.get("producedItemKey"),
                    "quantity": mat.get("quantity"),
                })

    # Shop reverse-lookup: recipeItemKey -> [shopId, ...]
    shops_by_recipe_key = {}
    for shop in all_shops:
        for entry in shop.get("entries", []):
            if entry.get("recipeItemKey"):
                shops_by_recipe_key.setdefault(entry["recipeItemKey"], []).append(shop["shopId"])

    # Single pass over every chest's resolved pools.
    chest_hits = {}  # itemKey -> [ {chestId, location} ]
    for chest in all_chests.values():
        for pool in chest.get("pools", {}).values():
            for slot in pool:
                if slot.get("itemKey"):
                    chest_hits.setdefault(slot["itemKey"], []).append({
                        "chestId": chest["chestId"], "location": chest.get("location"),
                    })

    # Single pass over every monster reward row's resolved pools.
    drop_hits = {}  # itemKey -> [ {rewardKey, enemyCode, enemyNameKey} ]
    for reward in all_monster_drops:
        for pool in reward.get("pools", {}).values():
            for slot in pool:
                if slot.get("itemKey"):
                    drop_hits.setdefault(slot["itemKey"], []).append({
                        "rewardKey": reward.get("rewardKey"),
                        "enemyCode": reward.get("enemyCode"),
                        "enemyNameKey": reward.get("enemyNameKey"),
                    })

    # Source file paths per finished-item collection -- recorded once
    # here rather than re-deriving; matches each section's own builder.
    SOURCE_PATHS = {
        "weapon": {
            "dataTables": [],
            "dataAssets": ["DataAssets/Items/ItemDataAsset.json (weapon category maps)"],
        },
        "armor": {
            "dataTables": [],
            "dataAssets": ["DataAssets/Items/ItemDataAsset.json (armor category maps)"],
        },
        "item": {
            "dataTables": ["DataAssets/Database/DT_ItemDatabase.json"],
            "dataAssets": ["DataAssets/Items/ItemDataAsset.json (Usable/Material/KeyItem category maps)"],
        },
    }

    def build_entry(item_key, kind):
        recipe = recipe_by_produced.get(item_key)
        entry = {
            "itemKey": item_key,
            "kind": kind,
            "recipe": None,
            "recipeAvailableInShops": [],
            "recipeFoundInChests": [],
            "recipeDroppedByMonsters": [],
            "foundInChests": chest_hits.get(item_key, []),
            "droppedByMonsters": drop_hits.get(item_key, []),
            "usedAsMaterialIn": materials_used_in.get(item_key, []),
            "sourceDataTables": SOURCE_PATHS[kind]["dataTables"],
            "sourceDataAssets": SOURCE_PATHS[kind]["dataAssets"],
        }
        if recipe:
            entry["recipe"] = {
                "recipeKey": recipe["recipeKey"], "itemKey": recipe["itemKey"],
                "category": recipe["category"], "categoryLabel": recipe["categoryLabel"],
                "colCost": recipe.get("colCost"), "materials": recipe.get("materials", []),
            }
            entry["recipeAvailableInShops"] = shops_by_recipe_key.get(recipe["itemKey"], [])
            entry["recipeFoundInChests"] = chest_hits.get(recipe["itemKey"], [])
            entry["recipeDroppedByMonsters"] = drop_hits.get(recipe["itemKey"], [])
            entry["sourceDataTables"] = list(dict.fromkeys(
                entry["sourceDataTables"] + ["DataAssets/Items/ItemDataAsset.json (recipe maps)"]))
        return entry

    sources = {}
    for item_key in all_weapons:
        sources[item_key] = build_entry(item_key, "weapon")
    for item_key in all_armor:
        sources[item_key] = build_entry(item_key, "armor")
    for item_key in all_items:
        sources[item_key] = build_entry(item_key, "item")

    out_dir = os.path.join(OUT, "DataAssets/Database/ItemSources")
    save_json(os.path.join(out_dir, "ItemSources.json"), sources)
    with_recipe = sum(1 for v in sources.values() if v["recipe"])
    with_chest = sum(1 for v in sources.values() if v["foundInChests"] or v["recipeFoundInChests"])
    with_drop = sum(1 for v in sources.values() if v["droppedByMonsters"] or v["recipeDroppedByMonsters"])
    with_any = sum(1 for v in sources.values() if v["recipe"] or v["foundInChests"] or v["droppedByMonsters"]
                   or v["recipeFoundInChests"] or v["recipeDroppedByMonsters"] or v["usedAsMaterialIn"])
    save_json(os.path.join(out_dir, "_index.json"), {
        "itemCount": len(sources),
        "withRecipe": with_recipe,
        "withChestSource": with_chest,
        "withMonsterDropSource": with_drop,
        "withAnySource": with_any,
        "withNoKnownSource": len(sources) - with_any,
        "file": "DataAssets/Database/ItemSources/ItemSources.json",
    })
    print(f"  Item sources: {len(sources)} items cross-referenced ({with_recipe} with a recipe, "
          f"{with_chest} with a chest source, {with_drop} with a monster-drop source, "
          f"{len(sources) - with_any} with no known source in this export)")
    return sources


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


def build_areas():
    """
    Builds Content/ROD/DataAssets/Database/Areas/Areas.json -- the
    World > Areas section.

    UNLIKE every category built before it, Areas has NO data-table
    list file at all -- confirmed by direct search before this was
    written (no DT_AreaList/DT_AreaDatabase exists anywhere in the
    export; DT_InitPopAreaTable_WL01/WL02 exist but both have ZERO
    rows). The authoritative area registry is the official
    localization itself: the 176 AreaTitle_* keys in Game.json's
    ST_GeneralLocalizeList, confirmed IDENTICAL across all 13
    languages before being treated as canonical (checked key-set
    equality per language, not assumed from en alone).

    Three additional keys are referenced by BP_AreaTitle_Gimmick_Spawner
    actors in level files but exist in NO language's table
    (AreaTitle_LA01Lower_SA_02 / AreaTitle_QiyuHallOfGuardianship_SA_02
    / AreaTitle_RuinStrategyTemple_SA_02 -- all *_SA_02 duplicates of a
    named area, likely internal variants for a second safe-area gate in
    the same area). Following the Items section's "Hand Mirror"
    precedent, these are shown flagged (isUnofficialKey) rather than
    silently dropped -- referenced-by-data is still real.

    Cross-references gathered per area, each from a confirmed source:
      - dungeonKey/dungeonCode: parsed from the area's own EN title
        template ("{Rep_DungeonName_X}: ..." -- 82 of 176 use one),
        the same {Rep_} convention Recipes/Lore/Towns/Quests already
        resolve. An area with no template has NO dungeon link in the
        data -- recorded as null, not guessed to be "overworld."
      - terminals: from DA_InGame.json's WorldDatas (the per-floor
        teleport terminal registry -- 192 entries across floor indexes
        Dungeon/First/Second). Two link kinds, kept distinct:
        "destination" (the terminal's own Key IS this area's key --
        teleporting there puts you in this area) and "nameRef" (the
        terminal's TerminalName_* display string embeds
        {Rep_<thisAreaKey>} -- the gate is named after the area).
        Terminal world coordinates are copied through when non-zero
        (122 of 192 have real coordinates; the rest are genuinely
        0,0,0 in the source and passed through as null instead of a
        fake origin point).
      - spawnerLevels: which level files (Maps/ + DNG/, LV_*.json)
        contain a BP_AreaTitle_Gimmick_Spawner actor with
        AreaName == this key -- the literal level/instance loading
        identifier family Towns/Quests already surface. This scan is a
        SOFT dependency: Maps/ and DNG/ ship in separate Content-*.zip
        archives from the core Content.zip, so their absence must not
        fail the build -- the index records levelScanAvailable so the
        app can say "not scanned" instead of implying "none exist."
      - questRefs: which quests' QST_/DA_QuestAsset_ files mention the
        key (start/goal gates and floor transitions reference areas).

    No thumbnail/texture exists for any area anywhere in the export
    (confirmed by direct search -- the in-game area title is a spawned
    banner widget, not a stored image), so unlike Lore there is no
    image handling here at all, matching Monsters' reasoning.
    """
    english_general = load_official_strings(DEFAULT_LANGUAGE)
    official_keys = sorted(k for k in english_general if k.startswith("AreaTitle_"))

    # --- Terminal registry from DA_InGame (hard requirement) ---
    da_ingame_path = os.path.join(SRC, "DataAssets/Games/InGame/DA_InGame.json")
    da_props = load_json(da_ingame_path)[0]["Properties"]
    terminal_links = {}  # areaKey -> [ {id, floor, kind, coordinate} ]

    def _add_terminal(area_key, tid, floor, kind, coord):
        entry = {"id": tid, "floor": floor, "linkKind": kind}
        if coord and any(coord.get(a) for a in ("X", "Y", "Z")):
            entry["coordinate"] = {a: coord[a] for a in ("X", "Y", "Z")}
        else:
            entry["coordinate"] = None
        terminal_links.setdefault(area_key, []).append(entry)

    total_terminals = 0
    for world in da_props.get("WorldDatas", []):
        floor = strip_enum(world.get("FloorIndex", "")).replace("ERODFloorIndex::", "")
        for t in world.get("TerminalDatas", []):
            total_terminals += 1
            tid, key, coord = t.get("ID"), t.get("Key"), t.get("Coordinate")
            if key and key.startswith("AreaTitle_"):
                _add_terminal(key, tid, floor, "destination", coord)
            elif key and key.startswith("TerminalName_"):
                # The gate's display string may embed {Rep_AreaTitle_X}
                raw = english_general.get(key, "")
                for m in re.finditer(r"\{Rep_(AreaTitle_\w+?)\}", raw):
                    _add_terminal(m.group(1), tid, floor, "nameRef", coord)

    # --- Spawner level scan (soft dependency -- Maps/DNG are separate uploads) ---
    spawner_levels = {}  # areaKey -> [relative level paths]
    unofficial_spawner_keys = set()
    scan_roots = [r for r in ("Maps", "DNG") if os.path.isdir(os.path.join(SRC, r))]
    level_scan_available = len(scan_roots) > 0
    spawner_pat = re.compile(r'"AreaName":\s*"(AreaTitle_\w+)"')
    files_scanned = 0
    for root_name in scan_roots:
        for dirpath, _dirs, files in os.walk(os.path.join(SRC, root_name)):
            for fn in files:
                if not (fn.startswith("LV_") and fn.endswith(".json")):
                    continue
                full = os.path.join(dirpath, fn)
                files_scanned += 1
                try:
                    with open(full, "r", encoding="utf-8", errors="ignore") as f:
                        text = f.read()
                except OSError:
                    continue
                if "AreaName" not in text:
                    continue
                rel = os.path.relpath(full, SRC).replace(os.sep, "/")
                for m in spawner_pat.finditer(text):
                    key = m.group(1)
                    if rel not in spawner_levels.setdefault(key, []):
                        spawner_levels[key].append(rel)
                    if key not in english_general:
                        unofficial_spawner_keys.add(key)

    # --- Quest references ---
    quest_refs = {}  # areaKey -> [questId]
    for pattern in ("DataAssets/Quests/Main/QST_Main_*.json",
                    "DataAssets/QuestAssets/Main/DA_QuestAsset_Main_*.json"):
        for path in sorted(glob.glob(os.path.join(SRC, pattern))):
            quest_id = re.search(r"(Main_\d+)", os.path.basename(path)).group(1)
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    text = f.read()
            except OSError:
                continue
            for key in set(re.findall(r"AreaTitle_\w+", text)):
                refs = quest_refs.setdefault(key, [])
                if quest_id not in refs:
                    refs.append(quest_id)

    # --- Assemble entries: official keys first, then flagged extras ---
    all_keys = list(official_keys)
    for key in sorted(unofficial_spawner_keys):
        if key not in all_keys:
            all_keys.append(key)

    dungeon_tmpl = re.compile(r"\{Rep_(DungeonName_(\w+?))\}")
    areas = []
    dungeon_linked = 0
    for key in all_keys:
        is_official = key in english_general
        raw_en = english_general.get(key, "")
        m = dungeon_tmpl.search(raw_en)
        dungeon_key = m.group(1) if m else None
        dungeon_code = m.group(2) if m else None
        if dungeon_key:
            dungeon_linked += 1
        terminals = sorted(terminal_links.get(key, []), key=lambda t: (t["floor"], t["id"]))
        areas.append({
            "areaKey": key,
            "areaId": key.replace("AreaTitle_", "", 1),
            "isUnofficialKey": not is_official,
            "dungeonKey": dungeon_key,
            "dungeonCode": dungeon_code,
            "terminals": terminals,
            "spawnerLevels": sorted(spawner_levels.get(key, [])),
            "questRefs": sorted(quest_refs.get(key, [])),
        })

    # Sort alphabetically by key -- areas have no numeric ID and no
    # confirmed in-game ordering anywhere in the export (there is no
    # list file to take an order FROM), so a stable alphabetical
    # default keeps the list scannable; search covers the rest.
    areas.sort(key=lambda a: a["areaKey"].lower())

    save_json(os.path.join(OUT, "DataAssets/Database/Areas/Areas.json"), areas)
    save_json(os.path.join(OUT, "DataAssets/Database/Areas/_index.json"), {
        "count": len(areas),
        "officialCount": len(official_keys),
        "unofficialKeys": sorted(unofficial_spawner_keys),
        "dungeonLinkedCount": dungeon_linked,
        "terminalTotal": total_terminals,
        "areasWithTerminals": sum(1 for a in areas if a["terminals"]),
        "levelScanAvailable": level_scan_available,
        "levelScanRoots": scan_roots,
        "levelFilesScanned": files_scanned,
        "areasWithSpawners": sum(1 for a in areas if a["spawnerLevels"]),
        "file": "DataAssets/Database/Areas/Areas.json",
    })
    print(f"  Areas: {len(areas)} total ({len(official_keys)} official keys + "
          f"{len(unofficial_spawner_keys)} referenced-but-unnamed), "
          f"{dungeon_linked} dungeon-linked, "
          f"{sum(1 for a in areas if a['terminals'])} with terminal links")
    if level_scan_available:
        print(f"    Level scan: {files_scanned} LV_*.json files across {scan_roots}, "
              f"{sum(1 for a in areas if a['spawnerLevels'])} areas with title-spawner placements")
    else:
        print("    Level scan: Maps/ and DNG/ not present in raw-export -- spawner links skipped (soft dependency)")

    return {a["areaKey"]: a for a in areas}


def build_area_localization(all_areas):
    """
    Per-language name for each area, keyed by areaKey (the AreaTitle_*
    localization key itself) against ST_GeneralLocalizeList, with the
    same {Rep_X} template rule as Lore/Towns/Quests -- 82 of the 176
    official area titles are templates embedding a DungeonName_* (e.g.
    "{Rep_DungeonName_HTE_Anc}: Spirit Gate" -> "Ancient Ritual Hall:
    Spirit Gate"), resolved per-language against that language's own
    table with English fallback.

    For dungeon-linked areas, the linked dungeon's own display name is
    ALSO resolved and stored per-language (dungeonName) so the app can
    show "Linked dungeon: Ancient Ritual Hall" localized without a
    second lookup table -- the same convention build_quest_localization
    already uses for its dungeonName field.

    The 3 unofficial *_SA_02 keys (see build_areas) resolve in NO
    language by definition -- they get an empty, unverified entry so
    every language file still has one row per area (totalCount stays
    consistent with the Areas list itself).
    """
    loc_dir = os.path.join(OUT, "DataAssets/Database/Areas/Localization")
    english_general = load_official_strings(DEFAULT_LANGUAGE)
    manifest = {}

    for lang_code, lang_label in SUPPORTED_LANGUAGES.items():
        loc_path = os.path.join(loc_dir, f"{lang_code}.json")
        existing = load_json(loc_path) if os.path.exists(loc_path) else {}
        general_strings = load_official_strings(lang_code)
        entries = dict(existing)

        for area_key, area in all_areas.items():
            if area_key in entries:
                continue

            name, name_verified, name_source = "", False, None
            raw = general_strings.get(area_key) or english_general.get(area_key)
            if raw:
                name = _resolve_rep_templates(raw, general_strings, english_general)
                name_verified = True
                name_source = "Official game localization (Game.json)"
                if area_key not in general_strings and area_key in english_general:
                    name_source = f"Fallback to English (no {lang_code} translation found)"

            dungeon_name, dungeon_verified = "", False
            dungeon_key = area.get("dungeonKey")
            if dungeon_key:
                raw_d = general_strings.get(dungeon_key) or english_general.get(dungeon_key)
                if raw_d:
                    dungeon_name = _resolve_rep_templates(raw_d, general_strings, english_general)
                    dungeon_verified = True

            entries[area_key] = {
                "name": name,
                "verified": name_verified,
                "source": name_source,
                "dungeonName": dungeon_name,
                "dungeonNameVerified": dungeon_verified,
            }

        save_json(loc_path, entries)
        verified = sum(1 for v in entries.values() if v["verified"])
        manifest[lang_code] = {
            "label": lang_label,
            "file": f"DataAssets/Database/Areas/Localization/{lang_code}.json",
            "verifiedCount": verified,
            "totalCount": len(entries),
        }

    manifest["_defaultLanguage"] = DEFAULT_LANGUAGE
    manifest["_gameLaunchDate"] = GAME_LAUNCH_DATE
    save_json(os.path.join(loc_dir, "_manifest.json"), manifest)
    print(f"  Area localization: {len(all_areas)} areas x {len(SUPPORTED_LANGUAGES)} languages")


# The 17 official dungeon codes -- the DungeonName_* key set, confirmed
# IDENTICAL across all 13 languages before being treated as canonical
# (same verification build_areas did for AreaTitle_*). Shared between
# build_dungeons and build_gates so both attribute by the SAME list.
DUNGEON_CODES = [
    "ERU_Boeroe", "ERU_Kati", "ERU_Nebeka", "ERU_OKU", "ERU_Qiyu",
    "HFO_DEF", "HFO_Ruin",
    "HTE_Anc", "HTE_FI", "HTE_Und",
    "MGK_LA01", "MGK_Seal", "MGK_Test",
    "NTR_Blue", "NTR_Demi", "NTR_Lime", "NTR_TWI",
]

# Gate/terminal IDs on the Dungeon floor follow
#   {WT|SA}_{DungeonCode}_F{n}{s|e}[_{numericVariant}]
# (s = the floor's start gate, e = its end gate; the numeric suffix
# variants -- e.g. SA_NTR_Blue_F1e_20027 -- are additional instanced
# end-gates, confirmed by the base form existing alongside them).
# 69 of the 192 registered gates match this with a real dungeon code;
# exactly ONE dungeon-floor gate doesn't match at all
# (SA_ERU_WAY_BOEROE_01) and is left honestly unattributed rather than
# force-fitted.
_GATE_DUNGEON_PATTERN = re.compile(r"^(WT|SA)_(.+?)_F(\d+)([se])(?:_(\d+))?$")


def _match_dungeon_code(key):
    """Longest-prefix match of a generation-config key (theme/way/room)
    against the official dungeon codes; None when nothing matches --
    near-misses like NTR_Twilight_* vs NTR_TWI are deliberately NOT
    aliased (plausible but unconfirmed), they stay unassigned."""
    up = key.upper()
    for code in sorted(DUNGEON_CODES, key=len, reverse=True):
        cu = code.upper()
        if up == cu or up.startswith(cu + "_"):
            return code
    return None


def build_dungeons(all_areas):
    """
    Builds Content/ROD/DataAssets/Database/Dungeons/Dungeons.json --
    the World > Dungeons section: the 17 officially named dungeons
    (DungeonName_* keys, identical set in all 13 languages, verified)
    across 5 families matching the DNG/ folder codes
    (ERU/HFO/HTE/MGK/NTR).

    Like Areas, there is NO dungeon data-table list file anywhere in
    the export (confirmed by search) -- the localization key set is
    the registry. What the data DOES have, and what this section
    surfaces per dungeon:

      - gates: the dungeon's per-floor gate chain from DA_InGame's
        WorldDatas, parsed via _GATE_DUNGEON_PATTERN (floor number +
        start/end kind + instanced variant suffix). 13 of 17 dungeons
        have at least one registered gate; ERU_OKU / HFO_Ruin /
        HTE_FI / MGK_Test genuinely have none in the registry.
      - linkedAreaKeys: areas whose own official title embeds this
        dungeon's name key (the {Rep_DungeonName_*} template link the
        Areas section already resolves) -- comes straight from
        all_areas, the same data the app shows, so the two sections
        can never disagree.
      - questRefs: quests whose files mention the dungeon's name key.
      - generation: this dungeon's slice of DA_InGame's procedural
        dungeon-generation config -- DungeonThemes / Ways / Rooms
        keys prefix-matched to the dungeon code (38/56, 47/71, 31/43
        match a named dungeon; the rest -- debug/test/default/common
        entries like HSD_Test*, DBG_Debug, HFO_COMMON_* -- go into the
        index's unassigned bucket, shown honestly rather than
        force-attributed), plus SafeDungeonSeeds sets (36/36 of those
        match a named dungeon) with per-set seed counts.
      - moduleLevels: DNG/ level files attributed to this dungeon by
        exact path-token match of the dungeon's sub-code within its
        family folder (e.g. DNG/ERU/WAY/NEBEKA/... -> ERU_Nebeka,
        LV_DNG_HTE_UND_* -> HTE_Und). Token-exact matching, NOT
        substring (so "FI" only matches the literal path component/
        name token FI, never "Field"). Files in a family folder with
        no sub-code token stay family-shared (counted in the index,
        not misattributed). DNG/ is a SOFT dependency, same treatment
        as build_areas' level scan: it ships in Content-DNG.zip, so
        its absence must not fail the build -- the index records
        dngScanAvailable so the app can say "not scanned" instead of
        implying "none exist."

    No image exists for any dungeon (searched -- same situation as
    Areas/Monsters), so no thumbnail handling.
    """
    english_general = load_official_strings(DEFAULT_LANGUAGE)
    da_props = load_json(os.path.join(SRC, "DataAssets/Games/InGame/DA_InGame.json"))[0]["Properties"]

    # --- Gate chains from the terminal registry ---
    gates_by_code = {}
    unmatched_dungeon_floor_gates = []
    for world in da_props.get("WorldDatas", []):
        floor = strip_enum(world.get("FloorIndex", "")).replace("ERODFloorIndex::", "")
        for t in world.get("TerminalDatas", []):
            m = _GATE_DUNGEON_PATTERN.match(t.get("ID", ""))
            code = m.group(2) if m and m.group(2) in DUNGEON_CODES else None
            if code:
                coord = t.get("Coordinate") or {}
                gates_by_code.setdefault(code, []).append({
                    "id": t["ID"],
                    "floor": floor,
                    "type": m.group(1),
                    "dungeonFloorNum": int(m.group(3)),
                    "gateKind": "start" if m.group(4) == "s" else "end",
                    "variant": m.group(5),
                    "coordinate": ({a: coord[a] for a in ("X", "Y", "Z")}
                                   if any(coord.get(a) for a in ("X", "Y", "Z")) else None),
                })
            elif "Dungeon" in floor:
                unmatched_dungeon_floor_gates.append(t.get("ID"))

    # --- Areas linked via their own title templates (from all_areas) ---
    areas_by_dungeon = {}
    for area in all_areas.values():
        if area.get("dungeonKey"):
            areas_by_dungeon.setdefault(area["dungeonKey"], []).append(area["areaKey"])

    # --- Quest references ---
    quest_refs = {}
    for pattern in ("DataAssets/Quests/Main/QST_Main_*.json",
                    "DataAssets/QuestAssets/Main/DA_QuestAsset_Main_*.json"):
        for path in sorted(glob.glob(os.path.join(SRC, pattern))):
            quest_id = re.search(r"(Main_\d+)", os.path.basename(path)).group(1)
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    text = f.read()
            except OSError:
                continue
            for key in set(re.findall(r"DungeonName_\w+", text)):
                refs = quest_refs.setdefault(key, [])
                if quest_id not in refs:
                    refs.append(quest_id)

    # --- Generation config slices ---
    def _bucket(pairs):
        """[(key, ...)] -> ({code: [keys]}, [unassigned keys])"""
        hit, miss = {}, []
        for k in pairs:
            code = _match_dungeon_code(k)
            if code:
                hit.setdefault(code, []).append(k)
            else:
                miss.append(k)
        return hit, miss

    theme_keys = [t["Key"] for t in da_props.get("DungeonThemes", [])]
    way_keys = [w["Key"] for w in da_props.get("Ways", [])]
    room_keys = [r["Key"] for r in da_props.get("Rooms", [])]
    themes_by, themes_un = _bucket(theme_keys)
    ways_by, ways_un = _bucket(way_keys)
    rooms_by, rooms_un = _bucket(room_keys)

    seeds_by = {}
    for s in da_props.get("SafeDungeonSeeds", []):
        code = _match_dungeon_code(s["Param"]["ThemeKey"])
        if code:
            seeds_by.setdefault(code, []).append({
                "themeKey": s["Param"]["ThemeKey"],
                "gridSize": s["Param"].get("GridSize"),
                "seedCount": len(s.get("Seeds", [])),
            })

    # --- DNG module-level attribution (soft dependency) ---
    dng_root = os.path.join(SRC, "DNG")
    dng_scan_available = os.path.isdir(dng_root)
    modules_by_code = {}
    family_counts = {}
    family_shared_counts = {}
    token_split = re.compile(r"[/_.\-]")
    if dng_scan_available:
        sub_by_family = {}
        for code in DUNGEON_CODES:
            fam, sub = code.split("_", 1)
            sub_by_family.setdefault(fam, []).append((code, sub.upper()))
        for dirpath, _dirs, files in os.walk(dng_root):
            for fn in files:
                if not (fn.startswith("LV_") and fn.endswith(".json")):
                    continue
                rel = os.path.relpath(os.path.join(dirpath, fn), SRC).replace(os.sep, "/")
                parts = rel.split("/")
                family = parts[1] if len(parts) > 1 else ""
                family_counts[family] = family_counts.get(family, 0) + 1
                tokens = set(t.upper() for t in token_split.split(rel) if t)
                assigned = None
                for code, sub in sub_by_family.get(family, []):
                    if sub in tokens:
                        assigned = code
                        break
                if assigned:
                    modules_by_code.setdefault(assigned, []).append(rel)
                else:
                    family_shared_counts[family] = family_shared_counts.get(family, 0) + 1

    dungeons = []
    for code in DUNGEON_CODES:
        key = f"DungeonName_{code}"
        family = code.split("_", 1)[0]
        gates = sorted(gates_by_code.get(code, []),
                       key=lambda g: (g["dungeonFloorNum"], g["gateKind"] != "start", g["id"]))
        dungeons.append({
            "dungeonKey": key,
            "code": code,
            "family": family,
            "gates": gates,
            "linkedAreaKeys": sorted(areas_by_dungeon.get(key, [])),
            "questRefs": sorted(quest_refs.get(key, [])),
            "generation": {
                "themes": sorted(themes_by.get(code, [])),
                "ways": sorted(ways_by.get(code, [])),
                "rooms": sorted(rooms_by.get(code, [])),
                "seedSets": sorted(seeds_by.get(code, []), key=lambda s: s["themeKey"]),
            },
            "moduleLevels": sorted(modules_by_code.get(code, [])),
        })

    dungeons.sort(key=lambda d: d["code"])

    save_json(os.path.join(OUT, "DataAssets/Database/Dungeons/Dungeons.json"), dungeons)
    save_json(os.path.join(OUT, "DataAssets/Database/Dungeons/_index.json"), {
        "count": len(dungeons),
        "withGates": sum(1 for d in dungeons if d["gates"]),
        "withLinkedAreas": sum(1 for d in dungeons if d["linkedAreaKeys"]),
        "unmatchedDungeonFloorGates": sorted(unmatched_dungeon_floor_gates),
        "generationUnassigned": {
            "themes": sorted(themes_un),
            "ways": sorted(ways_un),
            "rooms": sorted(rooms_un),
        },
        "generationTotals": {
            "themes": len(theme_keys), "ways": len(way_keys), "rooms": len(room_keys),
            "seedSets": len(da_props.get("SafeDungeonSeeds", [])),
        },
        "dngScanAvailable": dng_scan_available,
        "dngFamilyLevelCounts": family_counts,
        "dngFamilySharedCounts": family_shared_counts,
        "file": "DataAssets/Database/Dungeons/Dungeons.json",
    })
    print(f"  Dungeons: {len(dungeons)} named ({sum(1 for d in dungeons if d['gates'])} with gate chains, "
          f"{sum(1 for d in dungeons if d['linkedAreaKeys'])} with linked areas)")
    if dng_scan_available:
        attributed = sum(len(d["moduleLevels"]) for d in dungeons)
        print(f"    DNG scan: {sum(family_counts.values())} level files, {attributed} attributed to a named dungeon, "
              f"{sum(family_shared_counts.values())} family-shared")
    else:
        print("    DNG scan: DNG/ not present in raw-export -- module levels skipped (soft dependency)")

    return {d["dungeonKey"]: d for d in dungeons}


def build_dungeon_localization(all_dungeons):
    """
    Per-language name for each dungeon, keyed by dungeonKey
    (DungeonName_*) against ST_GeneralLocalizeList -- same manifest
    shape and {Rep_} rule as every localization builder before it
    (dungeon names themselves contain no templates in the current
    snapshot, but the resolver is applied anyway for consistency and
    future exports).
    """
    loc_dir = os.path.join(OUT, "DataAssets/Database/Dungeons/Localization")
    english_general = load_official_strings(DEFAULT_LANGUAGE)
    manifest = {}

    for lang_code, lang_label in SUPPORTED_LANGUAGES.items():
        loc_path = os.path.join(loc_dir, f"{lang_code}.json")
        existing = load_json(loc_path) if os.path.exists(loc_path) else {}
        general_strings = load_official_strings(lang_code)
        entries = dict(existing)

        for dungeon_key in all_dungeons:
            if dungeon_key in entries:
                continue
            name, verified, source = "", False, None
            raw = general_strings.get(dungeon_key) or english_general.get(dungeon_key)
            if raw:
                name = _resolve_rep_templates(raw, general_strings, english_general)
                verified = True
                source = "Official game localization (Game.json)"
                if dungeon_key not in general_strings and dungeon_key in english_general:
                    source = f"Fallback to English (no {lang_code} translation found)"
            entries[dungeon_key] = {"name": name, "verified": verified, "source": source}

        save_json(loc_path, entries)
        manifest[lang_code] = {
            "label": lang_label,
            "file": f"DataAssets/Database/Dungeons/Localization/{lang_code}.json",
            "verifiedCount": sum(1 for v in entries.values() if v["verified"]),
            "totalCount": len(entries),
        }

    manifest["_defaultLanguage"] = DEFAULT_LANGUAGE
    manifest["_gameLaunchDate"] = GAME_LAUNCH_DATE
    save_json(os.path.join(loc_dir, "_manifest.json"), manifest)
    print(f"  Dungeon localization: {len(all_dungeons)} dungeons x {len(SUPPORTED_LANGUAGES)} languages")


def build_gates():
    """
    Builds Content/ROD/DataAssets/Database/Gates/Gates.json -- the
    World > Gates section: the full flattened teleport-gate registry
    from DA_InGame.json's WorldDatas (192 gates across floor indexes
    Dungeon/First/Second), one row per gate.

    Per gate:
      - id / floor / type (SA_* Safe Area terminal vs WT_* Warp
        Terminal -- two confirmed separate art families under
        ENV/Theme/Elven/)
      - nameKey: the gate's localization key. Two kinds exist in the
        registry and are kept as-is: TerminalName_* (123 gates, the
        gate's own display string) and AreaTitle_* (69 gates -- the
        gate's Key IS an area key, i.e. its teleport destination).
        destinationAreaKey is set for the latter so the app can link
        straight into World > Areas.
      - coordinate: real world position when non-zero in the source
        (122 of 192); null otherwise, never a fake origin.
      - dungeon attribution via _GATE_DUNGEON_PATTERN (code + floor
        number + start/end + instanced variant) -- 69 gates match a
        named dungeon; SA_ERU_WAY_BOEROE_01 is the one dungeon-floor
        gate that matches nothing and is left unattributed.
      - nameRefAreaKeys: AreaTitle_* keys embedded in the gate's own
        EN display-string template ({Rep_AreaTitle_X}) -- the honest
        gate<->town/area name link. NOTE: towns' own terminalID field
        is a DIFFERENT ID namespace (TG_001-style, from
        DT_TownList.json) than this registry's WT_*/SA_* IDs -- an
        earlier working assumption that WT_TOB literally matched the
        Towns tab's terminal IDs was checked and found WRONG before
        shipping; the real tie is that WT_TOB's display template
        embeds the town's AreaTitle key. The Gates view joins on THAT,
        client-side, against the same loaded Towns data.
      - mapPieces: whether DA_MapPiece_PL_WL01/02_WP.json carries
        map-reveal piece data keyed by this gate's ID (world + piece
        count). 124 gate IDs have pieces (72 WL01 + 52 WL02). The
        MapPiece files ship in the core Content.zip's DataAssets, but
        are still loaded defensively (their absence downgrades the
        cross-reference, not the build).

    Town linkage is deliberately a CLIENT-SIDE join in the Gates view
    (town.nameKey against this builder's nameRefAreaKeys) against the
    already-loaded Towns data, not duplicated here -- same
    can-never-disagree reasoning build_dungeons uses for areas.

    "Golden Gates" are NOT a field here on purpose: the term exists in
    exactly two official item strings (Usable_74) and nothing in any
    file identifies which gates -- if any currently shipped -- are
    golden. The leading hypothesis (the crystal-activated SA_* gates)
    is recorded in Data Coverage as an OPEN question, not encoded as
    data.
    """
    da_props = load_json(os.path.join(SRC, "DataAssets/Games/InGame/DA_InGame.json"))[0]["Properties"]
    english_general = load_official_strings(DEFAULT_LANGUAGE)

    # Map-piece cross-reference (defensive load)
    map_pieces = {}  # gate ID -> {"world": "WL01", "pieceCount": n}
    for world_name in ("WL01", "WL02"):
        mp_path = os.path.join(SRC, f"DataAssets/WorldAdmin/MapPiece/DA_MapPiece_PL_{world_name}_WP.json")
        if not os.path.exists(mp_path):
            continue
        for row in load_json(mp_path)[0]["Properties"].get("MapPieceData", []):
            map_pieces[row["Key"]] = {
                "world": world_name,
                "pieceCount": len(row.get("Value", {}).get("MapPieceDataDetails", [])),
            }

    gates = []
    for world in da_props.get("WorldDatas", []):
        floor = strip_enum(world.get("FloorIndex", "")).replace("ERODFloorIndex::", "")
        for t in world.get("TerminalDatas", []):
            gid, key = t.get("ID"), t.get("Key")
            coord = t.get("Coordinate") or {}
            m = _GATE_DUNGEON_PATTERN.match(gid or "")
            code = m.group(2) if m and m.group(2) in DUNGEON_CODES else None
            name_ref_area_keys = []
            if key and key.startswith("TerminalName_"):
                raw = english_general.get(key, "")
                name_ref_area_keys = sorted(set(
                    mm.group(1) for mm in re.finditer(r"\{Rep_(AreaTitle_\w+?)\}", raw)
                ))
            gates.append({
                "id": gid,
                "floor": floor,
                "type": "SA" if gid.startswith("SA_") else ("WT" if gid.startswith("WT_") else "other"),
                "nameKey": key,
                "destinationAreaKey": key if key and key.startswith("AreaTitle_") else None,
                "nameRefAreaKeys": name_ref_area_keys,
                "coordinate": ({a: coord[a] for a in ("X", "Y", "Z")}
                               if any(coord.get(a) for a in ("X", "Y", "Z")) else None),
                "dungeonCode": code,
                "dungeonKey": f"DungeonName_{code}" if code else None,
                "dungeonFloorNum": int(m.group(3)) if code else None,
                "gateKind": ("start" if m.group(4) == "s" else "end") if code else None,
                "gateVariant": m.group(5) if code else None,
                "mapPieces": map_pieces.get(gid),
            })

    # Stable sort: floor order as registered (Dungeon/First/Second),
    # then ID -- the registry itself is the only ordering source.
    floor_order = {"Dungeon": 0, "First": 1, "Second": 2}
    gates.sort(key=lambda g: (floor_order.get(g["floor"], 99), g["id"]))

    save_json(os.path.join(OUT, "DataAssets/Database/Gates/Gates.json"), gates)
    save_json(os.path.join(OUT, "DataAssets/Database/Gates/_index.json"), {
        "count": len(gates),
        "byFloor": {f: sum(1 for g in gates if g["floor"] == f) for f in sorted(set(g["floor"] for g in gates))},
        "byType": {ty: sum(1 for g in gates if g["type"] == ty) for ty in sorted(set(g["type"] for g in gates))},
        "withCoordinates": sum(1 for g in gates if g["coordinate"]),
        "withMapPieces": sum(1 for g in gates if g["mapPieces"]),
        "dungeonAttributed": sum(1 for g in gates if g["dungeonCode"]),
        "destinationAreaLinked": sum(1 for g in gates if g["destinationAreaKey"]),
        "file": "DataAssets/Database/Gates/Gates.json",
    })
    print(f"  Gates: {len(gates)} total "
          f"({sum(1 for g in gates if g['type'] == 'SA')} SA / {sum(1 for g in gates if g['type'] == 'WT')} WT), "
          f"{sum(1 for g in gates if g['coordinate'])} with coordinates, "
          f"{sum(1 for g in gates if g['mapPieces'])} with map pieces, "
          f"{sum(1 for g in gates if g['dungeonCode'])} dungeon-attributed")

    return {g["id"]: g for g in gates}


def build_gate_localization(all_gates):
    """
    Per-language display name for each gate, keyed by the gate's
    nameKey (NOT its ID -- multiple gates can share one key, e.g. two
    gates both keyed AreaTitle_BlueDropCaveLowermost, so keying by the
    localization key dedupes naturally and the view resolves
    gate.nameKey -> entry). Both key kinds (TerminalName_* and
    AreaTitle_*) live in ST_GeneralLocalizeList; 168 of the values are
    {Rep_} templates and resolve with the shared rule.

    One known gap, recorded rather than papered over:
    TerminalName_WT_Mountaintop exists in NO language's table -- the
    single unresolved gate name among all 192 registered gates.
    """
    loc_dir = os.path.join(OUT, "DataAssets/Database/Gates/Localization")
    english_general = load_official_strings(DEFAULT_LANGUAGE)
    manifest = {}
    name_keys = sorted(set(g["nameKey"] for g in all_gates.values() if g.get("nameKey")))

    for lang_code, lang_label in SUPPORTED_LANGUAGES.items():
        loc_path = os.path.join(loc_dir, f"{lang_code}.json")
        existing = load_json(loc_path) if os.path.exists(loc_path) else {}
        general_strings = load_official_strings(lang_code)
        entries = dict(existing)

        for key in name_keys:
            if key in entries:
                continue
            name, verified, source = "", False, None
            raw = general_strings.get(key) or english_general.get(key)
            if raw:
                name = _resolve_rep_templates(raw, general_strings, english_general)
                verified = True
                source = "Official game localization (Game.json)"
                if key not in general_strings and key in english_general:
                    source = f"Fallback to English (no {lang_code} translation found)"
            entries[key] = {"name": name, "verified": verified, "source": source}

        save_json(loc_path, entries)
        manifest[lang_code] = {
            "label": lang_label,
            "file": f"DataAssets/Database/Gates/Localization/{lang_code}.json",
            "verifiedCount": sum(1 for v in entries.values() if v["verified"]),
            "totalCount": len(entries),
        }

    manifest["_defaultLanguage"] = DEFAULT_LANGUAGE
    manifest["_gameLaunchDate"] = GAME_LAUNCH_DATE
    save_json(os.path.join(loc_dir, "_manifest.json"), manifest)
    print(f"  Gate localization: {len(name_keys)} distinct name keys x {len(SUPPORTED_LANGUAGES)} languages")


# Enemy Blueprint class names follow E{6 digits} (e.g. BP_E012011_C),
# and the Monster database's titleKey is EnemyName_{same 6 digits} --
# a CONFIRMED code-level link (not name inference). Reward-table keys
# reuse the same codes, sometimes with a _NN variant suffix.
_ENEMY_CODE_PATTERN = re.compile(r"^(E\d{6})(?:_\d+)?$")


def build_monster_spawns():
    """
    Builds Content/ROD/DataAssets/Database/MonsterSpawns/ -- the
    Monsters > Spawns section, from the three populated per-world
    spawn tables under DataAssets/WorldAdmin/WL01|WL02/ (NOT
    DT_InitPopAreaTable_*, which was confirmed to have ZERO rows in
    both worlds back when Areas was scoped):

      - DT_CharacterGroupTable_*   spawn COMPOSITIONS: group key ->
        list of characters (Blueprint class + Level + PopNum)
      - DT_CharacterGroupLotTable_* weighted LOTTERIES over group keys
      - DT_SocketPopTable_*         POP CONFIGS: wave count/delay
        ranges + which group-lots each socket rolls

    The chain is Pop -> Lot(s) -> weighted Group(s) -> characters.
    This builder flattens all three per world and adds REVERSE
    indexes (which lots reference a group; which pops reference a
    lot) so the app can walk the chain from any anchor.

    Character entries resolve their Blueprint class (BP_E012011_C ->
    enemy code E012011 -> EnemyName_012011) to the Monster database
    where the code matches -- a confirmed code link, not name
    matching. Classes with no E-code (BP_Rabbit_C and other named
    animals) or codes absent from the database are passed through
    with enemyNameKey=null, shown as-is.

    HONEST LIMITS, recorded here and in Data Coverage:
      - Level/PopNum are -1 ("inherit/default") in 2,941 of 2,950
        character slots in THESE spawn tables specifically -- that is
        genuinely what DT_CharacterGroupTable says, and this section
        keeps showing -1 as inherit rather than silently substituting
        a different table's number. The actual per-enemy default level
        (and HP/Attack/Defence curves) is NOT absent from the export
        anymore: it arrived in a later Blueprints/ asset drop and is
        now its own section, Monsters > Stats (build_monster_stats),
        joined by the same E{code} link used here. This section's -1
        display is intentionally unchanged by that -- Spawns reports
        what the spawn table says, Stats reports what the enemy's own
        Blueprint default says, and the two are allowed to differ.
        The two genuine level-related curves living directly in THIS
        export's scope (CoefFixedLevelExperiencePointCurve,
        EnemyLevelCoefDamageCurve) are still exported into the index
        for this view's own overview panel.
      - Spawn PLACEMENT geometry is mostly absent from the exported
        level JSONs too (only 4 RODInitPopAreaVolume + 36
        RODSpawnPointsComponent actors across all of Maps/) -- this
        section is the spawn LOGIC, deliberately not a spawn MAP.
    """
    english_general = load_official_strings(DEFAULT_LANGUAGE)

    def _curve_points(path):
        if not os.path.exists(path):
            return None
        s = json.dumps(load_json(path))
        return [{"time": float(t), "value": float(v)}
                for t, v in re.findall(r'"Time":\s*([\d.eE+-]+),\s*"Value":\s*([\d.eE+-]+)', s)]

    groups, lots, pops = [], [], []
    lots_by_group = {}   # groupKey -> [lotKey]
    pops_by_lot = {}     # lotKey -> [popKey]
    level_default_slots, level_set_slots = 0, 0

    for world in ("WL01", "WL02"):
        base = os.path.join(SRC, f"DataAssets/WorldAdmin/{world}")
        if not os.path.isdir(base):
            continue

        group_rows = load_json(os.path.join(base, f"DT_CharacterGroupTable_{world}.json"))[0]["Rows"]
        lot_rows = load_json(os.path.join(base, f"DT_CharacterGroupLotTable_{world}.json"))[0]["Rows"]
        pop_rows = load_json(os.path.join(base, f"DT_SocketPopTable_{world}.json"))[0]["Rows"]

        for key, row in group_rows.items():
            characters = []
            for c in row.get("Characters", []):
                obj = (c.get("Character") or {}).get("ObjectName", "")
                m = re.search(r"BP_(\w+)_C'", obj)
                bp_class = m.group(1) if m else (obj or None)
                code_m = _ENEMY_CODE_PATTERN.match(bp_class or "")
                enemy_code = code_m.group(1) if code_m else None
                name_key = f"EnemyName_{enemy_code[1:]}" if enemy_code else None
                if name_key and name_key not in english_general:
                    name_key = None  # code exists, database name doesn't -- shown as code
                level = c.get("Level", -1)
                if level == -1:
                    level_default_slots += 1
                else:
                    level_set_slots += 1
                characters.append({
                    "bpClass": bp_class,
                    "enemyCode": enemy_code,
                    "enemyNameKey": name_key,
                    "level": level,
                    "popNum": c.get("PopNum", -1),
                })
            groups.append({
                "groupKey": key,
                "world": world,
                "characters": characters,
                "hasWeightAdjusts": bool(row.get("WeatherWeightAdjust") or row.get("HeroTensionWeightAdjust") or row.get("PartyTensionWeightAdjust")),
            })

        for key, row in lot_rows.items():
            entries = []
            total_w = sum((e.get("Weight") or 0) for e in row.get("CharacterGroupKeyWeights", [])) or 0
            for e in row.get("CharacterGroupKeyWeights", []):
                gk = e.get("CharacterGroupKey") or e.get("Key")
                w = e.get("Weight", 0)
                entries.append({
                    "groupKey": gk,
                    "weight": w,
                    # weight-derived share, labeled as such in the view
                    "sharePct": round(100.0 * w / total_w, 2) if total_w else None,
                })
                if gk:
                    lots_by_group.setdefault(f"{world}:{gk}", []).append(key)
            lots.append({"lotKey": key, "world": world, "entries": entries})

        for key, row in pop_rows.items():
            lot_keys = row.get("CharacterGroupLotTableKeys", []) or []
            for lk in lot_keys:
                pops_by_lot.setdefault(f"{world}:{lk}", []).append(key)
            pops.append({
                "popKey": key,
                "world": world,
                "waveNumRange": row.get("WaveNumRange"),
                "waveDelayTimeRange1st": row.get("WaveDelayTimeRange1st"),
                "waveDelayTimeRange": row.get("WaveDelayTimeRange"),
                "lotKeys": lot_keys,
                "summonLocatorGatherRadius": row.get("SummonLocatorGatherRadius"),
                "waveConditionSocketPopCharNum": row.get("WaveConditionSocketPopCharNum"),
            })

    # Attach reverse references
    for g in groups:
        g["referencedByLots"] = sorted(set(lots_by_group.get(f"{g['world']}:{g['groupKey']}", [])))
    for l in lots:
        l["referencedByPops"] = sorted(set(pops_by_lot.get(f"{l['world']}:{l['lotKey']}", [])))

    out_dir = os.path.join(OUT, "DataAssets/Database/MonsterSpawns")
    save_json(os.path.join(out_dir, "Groups.json"), groups)
    save_json(os.path.join(out_dir, "Lots.json"), lots)
    save_json(os.path.join(out_dir, "Pops.json"), pops)

    distinct_codes = sorted(set(c["enemyCode"] for g in groups for c in g["characters"] if c["enemyCode"]))
    named_codes = sorted(set(c["enemyCode"] for g in groups for c in g["characters"] if c["enemyNameKey"]))
    save_json(os.path.join(out_dir, "_index.json"), {
        "groupCount": len(groups),
        "lotCount": len(lots),
        "popCount": len(pops),
        "byWorld": {w: sum(1 for g in groups if g["world"] == w) for w in ("WL01", "WL02")},
        "distinctEnemyCodes": len(distinct_codes),
        "codesWithDatabaseName": len(named_codes),
        "levelDefaultSlots": level_default_slots,
        "levelSetSlots": level_set_slots,
        "xpCoefCurve": _curve_points(os.path.join(SRC, "DataAssets/Parameters/Enemy/CoefFixedLevelExperiencePointCurve.json")),
        "damageCoefCurve": _curve_points(os.path.join(SRC, "DataAssets/Parameters/Damage/EnemyLevelCoefDamageCurve.json")),
        "files": {
            "groups": "DataAssets/Database/MonsterSpawns/Groups.json",
            "lots": "DataAssets/Database/MonsterSpawns/Lots.json",
            "pops": "DataAssets/Database/MonsterSpawns/Pops.json",
        },
    })
    print(f"  Monster spawns: {len(groups)} groups / {len(lots)} lots / {len(pops)} pop configs across WL01+WL02")
    print(f"    {len(distinct_codes)} distinct enemy codes ({len(named_codes)} resolve to a Monster database name); "
          f"Level set in only {level_set_slots} of {level_set_slots + level_default_slots} character slots (rest -1 = inherit)")

    return {"groups": groups, "lots": lots, "pops": pops}


def _load_cost_recipe_map():
    """
    Cost-category items are RECIPE PURCHASE TOKENS -- discovered while
    scoping Shops: every `*Recipe*` map in ItemDataAsset defines its
    recipe's produced token as ItemData {Category: Cost, ItemId: N},
    and those Cost ids are globally unique across all recipe maps
    (verified: 59 ids, 0 duplicates, and all 59 shop stock entries
    resolve through them 1:1). Returns
    {costId: {recipeItemKey, recipeMap, recipeKey}} so Shops, Chests,
    and Drops all resolve Cost items to the recipe's REAL ItemKey from
    the data rather than leaving them raw -- this retroactively
    resolved the 393 Cost slots the Drops section originally shipped
    as unresolvable.
    """
    props = load_json(os.path.join(SRC, "DataAssets/Items/ItemDataAsset.json"))[0]["Properties"]
    cost_map = {}
    for map_name, entries in props.items():
        if not isinstance(entries, list) or "Recipe" not in map_name:
            continue
        for e in entries:
            v = e.get("Value", {})
            idata = v.get("ItemData", {})
            if str(idata.get("Category", "")).endswith("_Cost") and v.get("ItemKey"):
                cost_map[idata.get("ItemId")] = {
                    "recipeItemKey": v["ItemKey"],
                    "recipeMap": map_name,
                    "recipeKey": e.get("Key"),
                }
    return cost_map


def _build_resolved_item_pools(all_weapons, all_armor):
    """
    Loads DT_ItemLotTable and resolves every slot's display key, in
    confidence order (shared by Monsters > Drops and Items > Chests so
    the two sections can never resolve the same pool differently):
      1. weapon/armor categories -> exact (category, id) lookup against
         the SAME context Equipment is built from (the data's real
         ItemKey, no pattern guessing);
      2. Cost -> the recipe purchase-token map (see _load_cost_recipe_map);
      3. everything else -> the verified ItemName_{Category}_{Id}
         localization pattern;
      4. still nothing (Col currency amounts, Invalid, the handful of
         armor-recipe keys absent from the tables) -> itemKey=None,
         shown raw by the views, never faked.
    Returns (pools, unresolved_count).
    """
    english_general = load_official_strings(DEFAULT_LANGUAGE)
    cost_map = _load_cost_recipe_map()
    equip_key_by_cat_id = {}
    for coll in (all_weapons, all_armor):
        for item_key, entry in coll.items():
            equip_key_by_cat_id[(entry.get("category"), entry.get("id"))] = item_key

    def _resolve_item(cat, item_id):
        key = equip_key_by_cat_id.get((cat, item_id))
        if key:
            return key, "equipment data (ItemKey field)"
        if cat == "Cost" and item_id in cost_map:
            return cost_map[item_id]["recipeItemKey"], "recipe purchase token (ItemDataAsset recipe map)"
        candidate = f"ItemName_{cat}_{item_id}"
        if candidate in english_general:
            return candidate, "ItemName_{Category}_{Id} localization pattern"
        return None, None

    item_lot_rows = load_json(os.path.join(SRC, "DataAssets/WorldAdmin/DT_ItemLotTable.json"))[0]["Rows"]
    pools = {}
    unresolved_slots = 0
    for lot_key, row in item_lot_rows.items():
        slots = []
        total_w = sum((p.get("Weight") or 0) for p in row.get("ItemLotParams", [])) or 0
        for p in row.get("ItemLotParams", []):
            it = p.get("Item", {})
            cat = strip_enum(it.get("Category", "")).replace("ItemCategory_", "")
            item_id = it.get("ItemId")
            item_key, key_source = _resolve_item(cat, item_id)
            if not item_key:
                unresolved_slots += 1
            w = p.get("Weight", 0)
            slots.append({
                "category": cat,
                "itemId": item_id,
                "num": it.get("Num", 1),
                "itemKey": item_key,
                "itemKeySource": key_source,
                "weight": w,
                "sharePct": round(100.0 * w / total_w, 2) if total_w else None,
            })
        pools[lot_key] = slots
    return pools, unresolved_slots


def build_monster_drops(all_weapons, all_armor):
    """
    Builds Content/ROD/DataAssets/Database/MonsterDrops/Drops.json --
    the Monsters > Drops section, from the two global loot tables
    under DataAssets/WorldAdmin/:

      - DT_RewardLotTable  (242 rows): reward key -> per-QuestRewardID
        weighted picks of ItemLot keys ("which pool, if any, drops")
      - DT_ItemLotTable   (1013 rows): pool key -> weighted item slots
        ("which item that pool yields")

    Monster attribution: reward keys reusing the enemy Blueprint code
    (E{6 digits}, optionally with a _NN variant suffix -- e.g.
    E001003_01/_02) are linked to the Monster database via
    EnemyName_{code}, the same confirmed code link build_monster_spawns
    uses. 68 of the 242 keys are E-coded; the rest (named keys like
    Boar01/Rabbit, encounter keys like WL01Hills2_sub002Boss1, and
    explicit *Test*/Rarelity* debug rows) are shown UNLINKED --
    name-similarity guesses (Boar01 "looks like" Frenzy Boar) are
    deliberately not encoded.

    Item resolution per lot slot, in confidence order:
      1. weapon/armor categories: exact (category, id) lookup against
         the SAME all_weapons/all_armor context the Equipment section
         is built from -- yields the item's REAL ItemKey from the
         data (e.g. ItemName_WOS_1), no pattern guessing;
      2. everything else: the ItemName_{Category}_{Id} localization
         pattern, which resolves for Material/Usable/KeyItem and all
         *Recipe categories (verified against the EN table before
         this was written);
      3. Cost (393 slots), Col (currency, 186 slots), and Invalid (3)
         resolve to no display name by either route -- passed through
         with itemKey=null and shown as their raw category+id, not
         faked.

    Percentages: every weight is also emitted as a weight-derived
    share of its own pool's total (sharePct), labeled as derived in
    the view -- the tables contain WEIGHTS, not printed drop rates.
    """
    english_general = load_official_strings(DEFAULT_LANGUAGE)
    reward_rows = load_json(os.path.join(SRC, "DataAssets/WorldAdmin/DT_RewardLotTable.json"))[0]["Rows"]
    # Pool loading + item resolution is shared with Items > Chests (see
    # _build_resolved_item_pools) -- extracted when Chests was built,
    # and UPGRADED at the same time: Cost slots now resolve through the
    # recipe purchase-token map (393 previously-unresolvable slots).
    pools, unresolved_slots = _build_resolved_item_pools(all_weapons, all_armor)

    drops = []
    for reward_key, row in reward_rows.items():
        code_m = _ENEMY_CODE_PATTERN.match(reward_key)
        enemy_code = code_m.group(1) if code_m else None
        enemy_name_key = f"EnemyName_{enemy_code[1:]}" if enemy_code else None
        if enemy_name_key and enemy_name_key not in english_general:
            enemy_name_key = None
        reward_sets = []
        used_pool_keys = set()
        for rp in row.get("RewardParams", []):
            entries = []
            total_w = sum((e.get("Weight") or 0) for e in rp.get("RewardLotParams", [])) or 0
            for e in rp.get("RewardLotParams", []):
                lk = e.get("LotItemKey")
                w = e.get("Weight", 0)
                if lk and lk != "None":
                    used_pool_keys.add(lk)
                entries.append({
                    "lotItemKey": None if lk == "None" else lk,
                    "weight": w,
                    "sharePct": round(100.0 * w / total_w, 2) if total_w else None,
                })
            reward_sets.append({
                "questRewardID": rp.get("QuestRewardID"),
                "entries": entries,
                "hasCraftLevelParams": bool(rp.get("CraftLevelRewardLotParams")),
            })
        drops.append({
            "rewardKey": reward_key,
            "enemyCode": enemy_code,
            "enemyNameKey": enemy_name_key,
            "variantOf": (enemy_code if code_m and reward_key != enemy_code else None),
            "isDebugKey": bool(re.search(r"Test|Rarelity", reward_key, re.I)),
            "rewardSets": reward_sets,
            "pools": {k: pools[k] for k in sorted(used_pool_keys) if k in pools},
            "missingPoolKeys": sorted(k for k in used_pool_keys if k not in pools),
        })

    drops.sort(key=lambda d: d["rewardKey"].lower())

    out_dir = os.path.join(OUT, "DataAssets/Database/MonsterDrops")
    save_json(os.path.join(out_dir, "Drops.json"), drops)
    referenced_pools = set(k for d in drops for k in d["pools"])
    save_json(os.path.join(out_dir, "_index.json"), {
        "rewardCount": len(drops),
        "monsterLinked": sum(1 for d in drops if d["enemyNameKey"]),
        "eCoded": sum(1 for d in drops if d["enemyCode"]),
        "debugKeys": sum(1 for d in drops if d["isDebugKey"]),
        "poolTotal": len(pools),
        "poolsReferencedByRewards": len(referenced_pools),
        "unresolvedItemSlots": unresolved_slots,
        "file": "DataAssets/Database/MonsterDrops/Drops.json",
    })
    print(f"  Monster drops: {len(drops)} reward rows ({sum(1 for d in drops if d['enemyNameKey'])} monster-linked via enemy code, "
          f"{sum(1 for d in drops if d['isDebugKey'])} debug), {len(pools)} item pools "
          f"({len(referenced_pools)} referenced), {unresolved_slots} item slots with no display name (Cost/Col/Invalid)")

    return drops


def build_monster_drop_localization(all_monster_drops):
    """
    Per-language display name for every DISTINCT resolvable itemKey
    that appears in drop pools -- keyed by itemKey, resolved against
    ST_GeneralLocalizeList with the shared {Rep_} rule. Equipment
    keys (from the ItemKey field) and ItemName_{Cat}_{Id} pattern keys
    both live in the same table, so one resolver covers both.
    Unresolvable slots (Cost/Col/Invalid) have itemKey=null in the
    data and simply never appear here -- the view shows their raw
    category+id instead of a faked name.
    """
    loc_dir = os.path.join(OUT, "DataAssets/Database/MonsterDrops/Localization")
    english_general = load_official_strings(DEFAULT_LANGUAGE)
    item_keys = sorted(set(
        s["itemKey"]
        for d in all_monster_drops
        for slots in d["pools"].values()
        for s in slots
        if s.get("itemKey")
    ))
    manifest = {}

    for lang_code, lang_label in SUPPORTED_LANGUAGES.items():
        loc_path = os.path.join(loc_dir, f"{lang_code}.json")
        existing = load_json(loc_path) if os.path.exists(loc_path) else {}
        general_strings = load_official_strings(lang_code)
        entries = dict(existing)

        for key in item_keys:
            if key in entries:
                continue
            name, verified, source = "", False, None
            raw = general_strings.get(key) or english_general.get(key)
            if raw:
                name = _resolve_rep_templates(raw, general_strings, english_general)
                verified = True
                source = "Official game localization (Game.json)"
                if key not in general_strings and key in english_general:
                    source = f"Fallback to English (no {lang_code} translation found)"
            entries[key] = {"name": name, "verified": verified, "source": source}

        save_json(loc_path, entries)
        manifest[lang_code] = {
            "label": lang_label,
            "file": f"DataAssets/Database/MonsterDrops/Localization/{lang_code}.json",
            "verifiedCount": sum(1 for v in entries.values() if v["verified"]),
            "totalCount": len(entries),
        }

    manifest["_defaultLanguage"] = DEFAULT_LANGUAGE
    manifest["_gameLaunchDate"] = GAME_LAUNCH_DATE
    save_json(os.path.join(loc_dir, "_manifest.json"), manifest)
    print(f"  Monster drop localization: {len(item_keys)} distinct item keys x {len(SUPPORTED_LANGUAGES)} languages")


def build_monster_stats():
    """
    Builds Content/ROD/DataAssets/Database/MonsterStats/MonsterStats.json
    -- the previously-impossible Monster Levels/HP section, unlocked
    by the Blueprints/ export that landed after build_monster_spawns()
    recorded "-1 = inherit, no Blueprints folder exists" as an honest
    limit. That limit is now resolved for every enemy this export
    contains real Blueprint data for.

    Source, per enemy code (E{6 digits}, the SAME confirmed link
    build_monster_spawns and build_monster_drops use):
      - Blueprints/Characters/Enemies/*/BP_E{code}.json's
        Default__BP_E{code}_C object: EnemyLevel (the "inherit"
        default), EnemyCharacterID, EnemyType, AttackPower,
        DefencePower, WeaponExperiencePoint, and
        DifficultyLevelRewardLotKeys -- CONFIRMED to match real keys
        in DT_RewardLotTable.json (checked directly: e.g. Mob_Beast_S,
        Sphere_Mob both exist), a richer per-difficulty drops link
        than the reward-key inference Monsters > Drops uses today.
      - .../Datas/CT_E{code}.json, referenced by the BP's
        ParameterTable field: a per-enemy CurveTable with rows
        MaxHealth, MaxStability, AttackPower, DefencePower,
        ExperiencePoint, PartyExperiencePoint, WeaponExperiencePoint,
        Col -- each a level curve (Time = level 1..301, Value = the
        stat at that level). 174 unique enemy codes have a BP; 5 of
        those 174 have no CT file in the current export (listed as
        missing, not interpolated).

    This does NOT retroactively change Monster Spawns' own -1 display
    -- that section's "inherit" is still literally what the spawn
    table says (the actual runtime level depends on additional
    caller-side logic this export doesn't carry either), so Spawns
    keeps showing -1 as inherit while THIS section shows the enemy's
    own Blueprint default level and the curve it's placed on.
    """
    bp_files = sorted(glob.glob(os.path.join(SRC, "Blueprints/Characters/Enemies/*/BP_E*.json")))
    monsters = []
    missing_curve = []
    for bp_path in bp_files:
        m = re.search(r"BP_(E\d{6})\.json$", bp_path)
        if not m:
            continue
        code = m.group(1)
        family_dir = os.path.dirname(bp_path)
        family = os.path.basename(family_dir)
        try:
            objs = load_json(bp_path)
        except Exception:
            continue
        default_obj = next((o for o in objs if o.get("Name", "").startswith("Default__")), None)
        if not default_obj:
            continue
        props = default_obj.get("Properties", {})

        difficulty_rewards = {}
        for e in props.get("DifficultyLevelRewardLotKeys", []):
            diff = strip_enum(e.get("Key", "")).replace("EDifficultyLevel_", "")
            difficulty_rewards[diff] = (e.get("Value", {}) or {}).get("RewardLotKeys", [])

        curve_path = os.path.join(family_dir, "Datas", f"CT_{code}.json")
        curve = None
        if os.path.exists(curve_path):
            ct_rows = load_json(curve_path)[0].get("Rows", {})
            curve = {}
            for stat_name, row in ct_rows.items():
                keys = row.get("Keys", [])
                curve[stat_name] = [{"level": int(k["Time"]), "value": k["Value"]} for k in keys]
        else:
            missing_curve.append(code)

        name_key = f"EnemyName_{code[1:]}"
        monsters.append({
            "code": code,
            "family": family,
            "bpPath": os.path.relpath(bp_path, SRC).replace(os.sep, "/"),
            "enemyNameKey": name_key,  # resolution/verification happens client-side against the same Monster database Spawns/Drops use
            "enemyCharacterId": props.get("EnemyCharacterID"),
            "enemyType": strip_enum(props.get("EnemyType", "")).replace("EEnemyType_", ""),
            "level": props.get("EnemyLevel"),
            "attackPower": props.get("AttackPower"),
            "defencePower": props.get("DefencePower"),
            "weaponExperiencePoint": props.get("WeaponExperiencePoint"),
            "difficultyRewards": difficulty_rewards,
            "curve": curve,
            "hasCurve": curve is not None,
        })

    monsters.sort(key=lambda m: m["code"])
    out_dir = os.path.join(OUT, "DataAssets/Database/MonsterStats")
    save_json(os.path.join(out_dir, "MonsterStats.json"), monsters)
    families = sorted(set(m["family"] for m in monsters))
    save_json(os.path.join(out_dir, "_index.json"), {
        "count": len(monsters),
        "withCurve": sum(1 for m in monsters if m["hasCurve"]),
        "missingCurve": sorted(missing_curve),
        "families": families,
        "curveStats": ["MaxHealth", "MaxStability", "AttackPower", "DefencePower",
                       "ExperiencePoint", "PartyExperiencePoint", "WeaponExperiencePoint", "Col"],
        "difficultyLevels": ["Story", "Normal", "Hard", "VeryHard"],
        "levelRange": [1, 301],
        "file": "DataAssets/Database/MonsterStats/MonsterStats.json",
    })
    print(f"  Monster stats: {len(monsters)} enemy Blueprints ({len(families)} families), "
          f"{sum(1 for m in monsters if m['hasCurve'])} with a level curve "
          f"({len(missing_curve)} missing: {missing_curve})")
    return monsters


def build_npcs():
    """
    Builds Content/ROD/DataAssets/Database/NPCs/NPCs.json -- the
    Characters > NPCs section, from the four subfolders of
    DataAssets/Character/NPC/ (the ~200 files sitting unsurveyed in
    the Phase 1 unclaimed tray since the CHR-era Content.zip landed):

      - DataTable/DT_NPC_001..006: per-town rosters -- ID lists ONLY
        (the row struct has a single ID field, confirmed), numbered
        001-006 matching the six towns that have Town_00X detail
        files. Shared/DT_NPC_MoveSpeed: 8 named walk/run speeds.
      - Data/<folder>/NPCData_<id>: the NPC definitions (114) --
        NameKey, AppearanceData.PartsID, sequence data, bLookAt. The
        <folder> (001_TownOfBigining / 009_FacialCheck) is kept as
        the placement folder; 009_FacialCheck is a debug set.
      - Parts/NPCParts_<id>: appearance mesh references (128 numeric
        + 1 shared AnimData asset) -- Head/HeadGear/Body skeletal-mesh
        paths into CHR/, a direct forward-reference to the future
        Skeleton Assets tab.
      - Action/<folder>/NPCAction_<id>_<n>: placed action scripts
        (65 files, 64 NPC ids) -- root locations, move types
        (ENPCMoveSpeedType), gesture animation montage references.

    HONEST LIMITS, all confirmed before building:
      - NPC display names DO NOT RESOLVE: every NPCData carries a
        NameKey (NPC1002 style), and 0 of 114 exist in ANY language's
        localization tables -- generic townsfolk are unnamed in this
        export. NPCs are therefore shown by ID with the raw NameKey,
        and there is NO npc localization builder (nothing to build).
      - The three sources only partially overlap, and the section
        shows the union honestly rather than hiding the mismatches:
        81 roster IDs (some with no data file -- e.g. IDs 4-13 appear
        in town rosters 002-006 with no NPCData anywhere), 114 data
        files (102 of them in NO roster -- the 9xxx FacialCheck set
        plus others), 74 orphan parts files referenced by no NPC, and
        38 referenced PartsIDs with NO parts file (the 9xxx debug set
        references appearance parts that don't exist in the export).
    """
    npc_root = os.path.join(SRC, "DataAssets/Character/NPC")

    # Rosters
    roster_of = {}  # npcId -> {"table": "DT_NPC_001", "townId": "001"}
    for path in sorted(glob.glob(os.path.join(npc_root, "DataTable/DT_NPC_0*.json"))):
        table = os.path.basename(path).replace(".json", "")
        town_id = table.split("_")[-1]
        for row in load_json(path)[0].get("Rows", {}).values():
            if "ID" in row:
                roster_of[row["ID"]] = {"table": table, "townId": town_id}

    move_speeds = {}
    ms_path = os.path.join(npc_root, "DataTable/Shared/DT_NPC_MoveSpeed.json")
    if os.path.exists(ms_path):
        move_speeds = {k: v.get("MoveSpeed") for k, v in load_json(ms_path)[0].get("Rows", {}).items()}

    # Parts
    parts_files = {}  # partsId -> {file, meshes}
    for path in sorted(glob.glob(os.path.join(npc_root, "Parts/NPCParts_*.json"))):
        m = re.search(r"NPCParts_(\d+)\.json$", path)
        if not m:
            continue  # NPCParts_AnimData.json -- the shared anim asset, recorded in the index instead
        props = load_json(path)[0].get("Properties", {})
        meshes = {}
        for slot in ("HeadMesh", "HeadGearMesh", "BodyMesh"):
            ap = (props.get(slot) or {}).get("AssetPathName") or ""
            if ap:
                meshes[slot.replace("Mesh", "").lower()] = ap.split(".")[0]
        parts_files[int(m.group(1))] = {
            "file": os.path.relpath(path, SRC).replace(os.sep, "/"),
            "meshes": meshes,
        }

    # Actions
    actions_of = {}  # npcId -> [ {file, moveTypes, gestureAnims} ]
    for path in sorted(glob.glob(os.path.join(npc_root, "Action/*/NPCAction_*.json"))):
        m = re.search(r"NPCAction_(\d+)_(\d+)\.json$", path)
        if not m:
            continue
        text = open(path, "r", encoding="utf-8", errors="ignore").read()
        move_types = sorted(set(t.split("::")[-1] for t in re.findall(r'"ENPCMoveSpeedType::\w+"', text.replace('"', '"'))))
        # more robust: regex on raw
        move_types = sorted(set(re.findall(r"ENPCMoveSpeedType::(\w+)", text)))
        gesture_anims = sorted(set(re.findall(r"AnimMontage'([\w]+)'", text)))
        actions_of.setdefault(int(m.group(1)), []).append({
            "file": os.path.relpath(path, SRC).replace(os.sep, "/"),
            "moveTypes": move_types,
            "gestureAnimations": gesture_anims,
        })

    # Data files (the primary entries), then roster-only IDs appended
    npcs = []
    data_ids = set()
    for path in sorted(glob.glob(os.path.join(npc_root, "Data/*/NPCData_*.json"))):
        m = re.search(r"Data/([^/]+)/NPCData_(\d+)\.json$", path.replace(os.sep, "/"))
        folder, npc_id = m.group(1), int(m.group(2))
        data_ids.add(npc_id)
        props = load_json(path)[0].get("Properties", {})
        parts_id = (props.get("AppearanceData") or {}).get("PartsID")
        parts = parts_files.get(parts_id) if parts_id is not None else None
        npcs.append({
            "npcId": npc_id,
            "nameKey": props.get("NameKey"),
            "nameKeyResolves": False,  # 0/114 exist in any language's tables -- confirmed, see docstring
            "placementFolder": folder,
            "isDebugSet": folder.startswith("009_"),
            "roster": roster_of.get(npc_id),
            "dataFile": os.path.relpath(path, SRC).replace(os.sep, "/"),
            "partsId": parts_id,
            "partsFile": parts["file"] if parts else None,
            "meshes": parts["meshes"] if parts else None,
            "partsMissing": parts_id is not None and parts is None,
            "lookAt": bool(props.get("bLookAt")),
            "sequenceCount": len(props.get("SequenceData") or []),
            "actions": actions_of.get(npc_id, []),
        })
    for npc_id, roster in sorted(roster_of.items()):
        if npc_id in data_ids:
            continue
        npcs.append({
            "npcId": npc_id,
            "nameKey": None,
            "nameKeyResolves": False,
            "placementFolder": None,
            "isDebugSet": False,
            "roster": roster,
            "dataFile": None,  # in a town roster but has NO NPCData file anywhere -- shown, not hidden
            "partsId": None, "partsFile": None, "meshes": None, "partsMissing": False,
            "lookAt": False, "sequenceCount": 0,
            "actions": actions_of.get(npc_id, []),
        })

    npcs.sort(key=lambda n: n["npcId"])
    used_parts = set(n["partsId"] for n in npcs if n["partsId"] is not None)
    orphan_parts = sorted(set(parts_files) - used_parts)

    out_dir = os.path.join(OUT, "DataAssets/Database/NPCs")
    save_json(os.path.join(out_dir, "NPCs.json"), npcs)
    save_json(os.path.join(out_dir, "_index.json"), {
        "count": len(npcs),
        "withDataFile": len(data_ids),
        "rosterOnly": len(npcs) - len(data_ids),
        "inRoster": sum(1 for n in npcs if n["roster"]),
        "debugSet": sum(1 for n in npcs if n["isDebugSet"]),
        "withParts": sum(1 for n in npcs if n["partsFile"]),
        "partsMissing": sum(1 for n in npcs if n["partsMissing"]),
        "orphanPartsFiles": len(orphan_parts),
        "withActions": sum(1 for n in npcs if n["actions"]),
        "moveSpeeds": move_speeds,
        "hasSharedAnimData": os.path.exists(os.path.join(npc_root, "Parts/NPCParts_AnimData.json")),
        "nameKeysResolvable": 0,
        "file": "DataAssets/Database/NPCs/NPCs.json",
    })
    print(f"  NPCs: {len(npcs)} total ({len(data_ids)} with data files, {len(npcs) - len(data_ids)} roster-only, "
          f"{sum(1 for n in npcs if n['isDebugSet'])} debug-set), {sum(1 for n in npcs if n['partsFile'])} with appearance parts "
          f"({len(orphan_parts)} orphan parts files), {sum(1 for n in npcs if n['actions'])} with placed actions; "
          f"0 name keys resolve in any language (confirmed)")
    return {n["npcId"]: n for n in npcs}


def build_active_skills():
    """
    Builds Content/ROD/DataAssets/Database/ActiveSkills/ActiveSkills.json
    from DataAssets/Parameters/Hero/DT_ActiveSkillList.json -- the
    table §14 recorded as deliberately left unbuilt while ActiveSkill1's
    in-game trigger was unconfirmed; the user has now asked for it as
    part of the Characters cluster.

    10 rows: internal name, soul cost (Decrease_Soul), cooldown
    seconds, and a thumbnail texture (T_ActiveSkill1..10.png -- all 10
    PNGs confirmed present under Widget/.../ActiveSkill/, copied by the
    textures section). The internal names (Recovery, Search, ...) are
    ENGLISH DEVELOPER STRINGS, not localization: no ActiveSkillName_*
    key family exists in any language (searched), so there is NO
    localization builder for this section and the app labels the name
    as internal/unlocalized rather than pretending it's translated.
    """
    rows = load_json(os.path.join(SRC, "DataAssets/Parameters/Hero/DT_ActiveSkillList.json"))[0]["Rows"]
    skills = []
    for row in rows.values():
        tex = (row.get("ThumbnailTexture") or {}).get("AssetPathName") or ""
        tex_rel = None
        if tex.startswith("/Game/ROD/"):
            tex_rel = "Content/ROD/" + tex[len("/Game/ROD/"):].split(".")[0] + ".png"
        skills.append({
            "id": row.get("ID"),
            "internalName": row.get("ActiveSkillName"),
            "soulCost": row.get("Decrease_Soul"),
            "coolTimeSeconds": row.get("CoolTime"),
            "iconTexture": tex_rel,
            "hasIcon": bool(tex_rel) and os.path.exists(os.path.join(SRC, tex[len("/Game/ROD/"):].split(".")[0] + ".png")),
        })
    skills.sort(key=lambda s: s["id"] or "")
    out_dir = os.path.join(OUT, "DataAssets/Database/ActiveSkills")
    save_json(os.path.join(out_dir, "ActiveSkills.json"), skills)
    save_json(os.path.join(out_dir, "_index.json"), {
        "count": len(skills),
        "withIcon": sum(1 for s in skills if s["hasIcon"]),
        "localizedNames": 0,  # no ActiveSkillName_* keys exist in any language -- confirmed
        "file": "DataAssets/Database/ActiveSkills/ActiveSkills.json",
    })
    print(f"  Active skills: {len(skills)} ({sum(1 for s in skills if s['hasIcon'])} with icons); "
          f"names are internal developer strings -- no localization exists (confirmed)")
    return skills


# The nine officially named status effects. Codes are the exact
# TutorialTitle_/TutorialDetailwindow_ key suffixes; the key pairs are
# confirmed present in ALL 13 languages. 'BadStatus' is the general
# "Status Effects" overview tutorial, kept separate from the nine.
AILMENT_CODES = ["Burn", "Darkness", "Fatigue", "Frost", "InstantDeath",
                 "Paralysis", "Poison", "Sleep", "Vertigo"]


def build_ailments():
    """
    Builds Content/ROD/DataAssets/Database/Ailments/Ailments.json --
    the Characters > Ailments section.

    NO status-effect data table or enum exists anywhere in DataAssets
    (searched for EBadStatus/StatusEffect/State* enums: the only hit
    is EVoiceState) -- ailment MECHANICS live in unexported
    Blueprints, the same honest situation as monster HP. What the
    export DOES officially provide, and what this section is built
    from:
      - the tutorial localization pairs (TutorialTitle_<code> +
        TutorialDetailwindow_<code>_01) for exactly NINE status
        effects, present in all 13 languages -- official names AND
        effect descriptions;
      - the state icon inventory under
        Widget/Common/IconImage/StateIconImages/: 9 T_BadStateIcon +
        9 T_GoodStateIcon + 5 T_StateIcon + up/down arrows. NINE bad
        icons for NINE named ailments is a suggestive count match,
        but NO data maps icon numbers to ailment codes -- the icons
        are shown as an inventory, deliberately NOT paired to
        specific ailments.
    """
    icon_dir = os.path.join(SRC, "Widget/Common/IconImage/StateIconImages")
    icons = sorted(os.listdir(icon_dir)) if os.path.isdir(icon_dir) else []
    icon_inventory = {
        "bad": [i for i in icons if i.startswith("T_BadStateIcon")],
        "good": [i for i in icons if i.startswith("T_GoodStateIcon")],
        "generic": [i for i in icons if re.match(r"T_StateIcon\d", i)],
        "other": [i for i in icons if i.startswith("T_StateIcon_")],
    }
    ailments = [{
        "code": code,
        "titleKey": f"TutorialTitle_{code}",
        "detailKey": f"TutorialDetailwindow_{code}_01",
    } for code in AILMENT_CODES]

    out_dir = os.path.join(OUT, "DataAssets/Database/Ailments")
    save_json(os.path.join(out_dir, "Ailments.json"), ailments)
    save_json(os.path.join(out_dir, "_index.json"), {
        "count": len(ailments),
        "generalTitleKey": "TutorialTitle_BadStatus",
        "generalDetailKey": "TutorialDetailwindow_BadStatus_01",
        "iconInventory": icon_inventory,
        "iconDir": "Content/ROD/Widget/Common/IconImage/StateIconImages",
        "iconPairingConfirmed": False,  # 9 bad icons, 9 ailments -- count match only, no mapping data exists
        "file": "DataAssets/Database/Ailments/Ailments.json",
    })
    print(f"  Ailments: {len(ailments)} officially named status effects; icon inventory "
          f"{len(icon_inventory['bad'])} bad / {len(icon_inventory['good'])} good / "
          f"{len(icon_inventory['generic']) + len(icon_inventory['other'])} generic (pairing to ailments NOT confirmed)")
    return {a["code"]: a for a in ailments}


def build_ailment_localization(all_ailments):
    """
    Per-language name + description for each ailment, keyed by code,
    from the tutorial key pairs (verified present in all 13 languages).
    The name stored is the FULL official title ("Status Effects: Burn")
    -- stripping the prefix per-language would be guessing at each
    language's separator conventions, so the view shows the official
    string as-is. The general "Status Effects" overview entry is
    stored under the reserved code "_general".
    """
    loc_dir = os.path.join(OUT, "DataAssets/Database/Ailments/Localization")
    english_general = load_official_strings(DEFAULT_LANGUAGE)
    manifest = {}
    codes = list(all_ailments) + ["_general"]

    for lang_code, lang_label in SUPPORTED_LANGUAGES.items():
        loc_path = os.path.join(loc_dir, f"{lang_code}.json")
        existing = load_json(loc_path) if os.path.exists(loc_path) else {}
        general_strings = load_official_strings(lang_code)
        entries = dict(existing)

        for code in codes:
            if code in entries:
                continue
            tk = "TutorialTitle_BadStatus" if code == "_general" else f"TutorialTitle_{code}"
            dk = "TutorialDetailwindow_BadStatus_01" if code == "_general" else f"TutorialDetailwindow_{code}_01"
            name_raw = general_strings.get(tk) or english_general.get(tk)
            desc_raw = general_strings.get(dk) or english_general.get(dk)
            entries[code] = {
                "name": _resolve_rep_templates(name_raw, general_strings, english_general) if name_raw else "",
                "description": _resolve_rep_templates(desc_raw, general_strings, english_general) if desc_raw else "",
                "verified": bool(name_raw and desc_raw),
                "source": "Official tutorial localization (Game.json)" if (name_raw and desc_raw) else None,
            }

        save_json(loc_path, entries)
        manifest[lang_code] = {
            "label": lang_label,
            "file": f"DataAssets/Database/Ailments/Localization/{lang_code}.json",
            "verifiedCount": sum(1 for v in entries.values() if v["verified"]),
            "totalCount": len(entries),
        }

    manifest["_defaultLanguage"] = DEFAULT_LANGUAGE
    manifest["_gameLaunchDate"] = GAME_LAUNCH_DATE
    save_json(os.path.join(loc_dir, "_manifest.json"), manifest)
    print(f"  Ailment localization: {len(codes)} entries x {len(SUPPORTED_LANGUAGES)} languages")


def build_shops():
    """
    Builds Content/ROD/DataAssets/Database/Shops/Shops.json from
    DataAssets/Games/DataTables/DT_ShopItemList.json -- a single-row
    table whose one "Shop" row carries a ShopList map of six shops
    (keys "1".."6"), each a plain stock list of Cost-category items.

    The load-bearing discovery (confirmed, not inferred): SHOPS SELL
    RECIPES. Every stock entry is Category Cost, and Cost items are
    recipe purchase tokens -- all 59 stock entries across the six
    shops resolve 1:1 through _load_cost_recipe_map() to a recipe's
    real ItemKey (0 duplicates, 0 misses). The view joins those keys
    against the SAME loaded Recipes data the Items > Recipes tab
    renders, so names/costs/materials come from one source.

    HONESTLY UNCONFIRMED: which shop is in which town. Six shops and
    six towns with detail files is a suggestive count match (the same
    001-006 numbering DT_NPC uses), but NO field links a ShopList key
    to a town -- shops are shown as "Shop 1".."Shop 6" with that noted,
    not force-assigned to towns.
    """
    shop_row = load_json(os.path.join(SRC, "DataAssets/Games/DataTables/DT_ShopItemList.json"))[0]["Rows"]["Shop"]
    cost_map = _load_cost_recipe_map()
    shops = []
    unresolved = 0
    for s in shop_row.get("ShopList", []):
        entries = []
        for item in s.get("Value", {}).get("Items", []):
            cat = strip_enum(item.get("Category", "")).replace("ItemCategory_", "")
            item_id = item.get("ItemId")
            rec = cost_map.get(item_id) if cat == "Cost" else None
            if not rec:
                unresolved += 1
            entries.append({
                "category": cat,
                "itemId": item_id,
                "recipeItemKey": rec["recipeItemKey"] if rec else None,
                "recipeMap": rec["recipeMap"] if rec else None,
            })
        shops.append({"shopId": s.get("Key"), "entries": entries})

    shops.sort(key=lambda x: int(x["shopId"]) if str(x["shopId"]).isdigit() else 0)
    out_dir = os.path.join(OUT, "DataAssets/Database/Shops")
    save_json(os.path.join(out_dir, "Shops.json"), shops)
    save_json(os.path.join(out_dir, "_index.json"), {
        "count": len(shops),
        "stockTotal": sum(len(s["entries"]) for s in shops),
        "recipeResolved": sum(1 for s in shops for e in s["entries"] if e["recipeItemKey"]),
        "unresolved": unresolved,
        "townMappingConfirmed": False,  # 6 shops / 6 towns is a count match only -- no linking field exists
        "file": "DataAssets/Database/Shops/Shops.json",
    })
    print(f"  Shops: {len(shops)} shops, {sum(len(s['entries']) for s in shops)} stock entries "
          f"({sum(1 for s in shops for e in s['entries'] if e['recipeItemKey'])} resolve to recipes, {unresolved} unresolved); "
          f"shop-to-town mapping NOT confirmed by any field")
    return shops


def build_chests(all_weapons, all_armor):
    """
    Builds Content/ROD/DataAssets/Database/Chests/Chests.json from
    DataAssets/WorldAdmin/DT_FixTBoxTable.json (526 fixed treasure
    boxes -- the FixTBoxTable DA_InGame points at), resolving each
    chest's contents through the SAME shared pool resolver Drops uses
    (_build_resolved_item_pools), so a pool can never resolve
    differently between the two sections. This is where most of the
    ~900 item pools the Drops section found unreferenced by monster
    rewards turn out to live.

    Chest keys are TB_{location}_{n}, and the location fragment is the
    SAME location naming the gate registry uses after its SA_/WT_
    prefix -- 522 of 526 chests match a registered gate's location
    fragment exactly (checked, not assumed), giving each chest a real
    place in the world via the Gates/Areas tabs; the view does that
    join client-side against the loaded gate list. NO chest placement
    coordinates exist in the exported levels (searched) -- the gate
    link is location CONTEXT, deliberately not a map position. 3
    referenced pool keys are missing from DT_ItemLotTable and are
    listed per chest rather than hidden.
    """
    tb_rows = load_json(os.path.join(SRC, "DataAssets/WorldAdmin/DT_FixTBoxTable.json"))[0]["Rows"]
    pools, _unresolved = _build_resolved_item_pools(all_weapons, all_armor)

    chests = []
    for key, row in tb_rows.items():
        m = re.match(r"^TB_(.+)_(\d+)$", key)
        location = m.group(1) if m else None
        pool_keys = [k for k in row.get("ItemLotTableKeys", []) if k and k != "None"]
        chests.append({
            "chestId": key,
            "location": location,
            "chestNum": int(m.group(2)) if m else None,
            "poolKeys": pool_keys,
            "pools": {k: pools[k] for k in pool_keys if k in pools},
            "missingPoolKeys": [k for k in pool_keys if k not in pools],
        })

    chests.sort(key=lambda c: (c["location"] or "", c["chestNum"] or 0, c["chestId"]))
    out_dir = os.path.join(OUT, "DataAssets/Database/Chests")
    save_json(os.path.join(out_dir, "Chests.json"), chests)
    locations = sorted(set(c["location"] for c in chests if c["location"]))
    save_json(os.path.join(out_dir, "_index.json"), {
        "count": len(chests),
        "locations": len(locations),
        "withPools": sum(1 for c in chests if c["pools"]),
        "missingPoolRefs": sum(len(c["missingPoolKeys"]) for c in chests),
        "placementCoordinates": False,  # none exist in the exported levels -- searched
        "file": "DataAssets/Database/Chests/Chests.json",
    })
    print(f"  Chests: {len(chests)} fixed treasure boxes across {len(locations)} locations, "
          f"{sum(1 for c in chests if c['pools'])} with resolved pools, "
          f"{sum(len(c['missingPoolKeys']) for c in chests)} missing pool refs (shown per chest)")
    return {c["chestId"]: c for c in chests}


def build_chest_localization(all_chests):
    """
    Per-language display name for every distinct resolvable itemKey in
    chest pools -- identical shape and resolver to
    build_monster_drop_localization (the two sections share the pool
    resolver, so they share the localization approach; entries overlap
    between the two files by design, per-category separation).
    """
    loc_dir = os.path.join(OUT, "DataAssets/Database/Chests/Localization")
    english_general = load_official_strings(DEFAULT_LANGUAGE)
    item_keys = sorted(set(
        s["itemKey"]
        for c in all_chests.values()
        for slots in c["pools"].values()
        for s in slots
        if s.get("itemKey")
    ))
    manifest = {}
    for lang_code, lang_label in SUPPORTED_LANGUAGES.items():
        loc_path = os.path.join(loc_dir, f"{lang_code}.json")
        existing = load_json(loc_path) if os.path.exists(loc_path) else {}
        general_strings = load_official_strings(lang_code)
        entries = dict(existing)
        for key in item_keys:
            if key in entries:
                continue
            name, verified, source = "", False, None
            raw = general_strings.get(key) or english_general.get(key)
            if raw:
                name = _resolve_rep_templates(raw, general_strings, english_general)
                verified = True
                source = "Official game localization (Game.json)"
                if key not in general_strings and key in english_general:
                    source = f"Fallback to English (no {lang_code} translation found)"
            entries[key] = {"name": name, "verified": verified, "source": source}
        save_json(loc_path, entries)
        manifest[lang_code] = {
            "label": lang_label,
            "file": f"DataAssets/Database/Chests/Localization/{lang_code}.json",
            "verifiedCount": sum(1 for v in entries.values() if v["verified"]),
            "totalCount": len(entries),
        }
    manifest["_defaultLanguage"] = DEFAULT_LANGUAGE
    manifest["_gameLaunchDate"] = GAME_LAUNCH_DATE
    save_json(os.path.join(loc_dir, "_manifest.json"), manifest)
    print(f"  Chest localization: {len(item_keys)} distinct item keys x {len(SUPPORTED_LANGUAGES)} languages")


GUIDES_DIR = os.path.join(PROJECT_ROOT, "guides")
GUIDE_UPLOADS_DIR = os.path.join(PROJECT_ROOT, "uploads")

DEFAULT_GUIDE_MANIFEST = {
    "maxGuides": 20,
    "maxImagesPerGuide": 20,
    "maxImageSizeMB": 25,
    "maxGuideFileSizeMB": 10,
    "allowEditing": True,
}

# The seeded example guide, embedded here so guides_init can create it
# on a fresh instance without any file to copy from. Kept byte-for-byte
# in sync with the version originally shipped in guides/.
SEEDED_GUIDE_ID = "getting-started-installing-unreal-engine"
SEEDED_GUIDE_CONTENT = """# Getting Started: Installing Unreal Engine

This guide walks through installing Unreal Engine for Echoes of Aincrad modding —
from creating an Epic Games account to opening the editor for the first time.

> Screenshot placeholders below render as dashed boxes until real images are added.
> To replace one: open this guide in **Edit**, put your cursor on the placeholder
> line, delete it, and paste (Ctrl+V) or drag & drop your screenshot — the image
> uploads automatically and appears exactly where you dropped it.

---

## Step 1 — Create an Epic Games account

Go to [epicgames.com](https://www.epicgames.com) and sign up (or sign in if you
already have an account from Fortnite or the Epic Games Store). Unreal Engine is
free for this kind of use.

![Screenshot: Epic Games sign-up page](uploads/getting-started-installing-unreal-engine/step-1.png)

## Step 2 — Download the Epic Games Launcher

From the Epic Games site, download the **Epic Games Launcher** installer for your
platform and run it. The launcher manages engine versions, so you rarely need to
visit the website again after this.

![Screenshot: Epic Games Launcher download button](uploads/getting-started-installing-unreal-engine/step-2.png)

## Step 3 — Open the Unreal Engine tab

Launch the Epic Games Launcher, sign in, and select the **Unreal Engine** tab in
the left sidebar, then the **Library** tab along the top.

![Screenshot: Launcher with Unreal Engine > Library selected](uploads/getting-started-installing-unreal-engine/step-3.png)

## Step 4 — Install an engine version

Click the **＋** next to *Engine Versions* and pick the version matching the game's
engine. Choose your install location — a full install needs roughly 30-60 GB
depending on options.

- Under **Options**, you can uncheck target platforms you don't need to save space.
- Keep *Engine Source* unchecked unless you know you need it.

![Screenshot: Engine version selector with Options expanded](uploads/getting-started-installing-unreal-engine/step-4.png)

## Step 5 — Wait for the install and verify

The launcher downloads and verifies the engine. When the button on the engine slot
changes to **Launch**, the install is complete.

![Screenshot: Engine slot showing the Launch button](uploads/getting-started-installing-unreal-engine/step-5.png)

## Step 6 — First launch

Click **Launch**. The Unreal Project Browser opens — this is where you'll create
the project used for building mods. Creating and configuring that project is
covered in the next guide.

![Screenshot: Unreal Project Browser on first launch](uploads/getting-started-installing-unreal-engine/step-6.png)

---

## What's next

- Creating a mod project (separate guide)
- Importing assets extracted with this toolkit — see the Asset Inspector and the
  per-asset download buttons for `psk`/`fbx`/`blend` files
- Repacking and testing in-game

> Tip: the toolkit's **Data Coverage** page lists exactly which game data is
> confirmed vs. inferred — check it before relying on any value in your mod.
"""


def build_guides_init():
    """
    Initializes the Modding Guides storage: creates guides/ and
    uploads/ at the PROJECT ROOT (user content, deliberately outside
    Content/ROD -- the only section whose outputs use the
    project-root "//" convention in expectedOutputs), writes
    guides/manifest.json with the default limits, and seeds the
    Getting Started example guide.

    STRICTLY create-only: nothing here ever overwrites an existing
    file, so re-running the section (or the full pipeline) can never
    clobber a user's edited manifest limits or their version of the
    seeded guide. Exists as an explicit, runnable focus build because
    lazy server-side folder creation failed with EACCES in a real
    Docker deployment (the app directory was owned by root while node
    ran unprivileged, and the failure only surfaced at request time
    as an unhandled 500) -- running this init where the filesystem IS
    writable (image build, entrypoint, or the dashboard button) makes
    the storage exist up front; if THIS fails with a permission
    error, it fails loudly at init time with the fix in the message
    instead of at a user's first save.
    """
    created = []
    try:
        for d in (GUIDES_DIR, GUIDE_UPLOADS_DIR):
            if not os.path.isdir(d):
                os.makedirs(d, exist_ok=True)
                created.append(os.path.relpath(d, PROJECT_ROOT) + "/")
        manifest_path = os.path.join(GUIDES_DIR, "manifest.json")
        if not os.path.exists(manifest_path):
            save_json(manifest_path, DEFAULT_GUIDE_MANIFEST)
            created.append("guides/manifest.json")
        seeded_path = os.path.join(GUIDES_DIR, f"{SEEDED_GUIDE_ID}.md")
        if not os.path.exists(seeded_path):
            with open(seeded_path, "w", encoding="utf-8") as f:
                f.write(SEEDED_GUIDE_CONTENT)
            created.append(f"guides/{SEEDED_GUIDE_ID}.md")
    except PermissionError as e:
        raise PermissionError(
            f"Cannot create Modding Guides storage under {PROJECT_ROOT}: {e}. "
            "The process user lacks write permission -- in Docker, chown the app "
            "directory (or mount guides/ and uploads/ as writable volumes) for the "
            "user node runs as, then re-run this section."
        )
    if created:
        print(f"  Guides init: created {', '.join(created)}")
    else:
        print("  Guides init: guides/, uploads/, manifest, and seeded guide all present -- nothing to create (create-only by design)")


# Sidecar extensions for downloadable binary companions, grouped by
# asset kind. Files sit in the SAME folder with the SAME stem as their
# JSON (verified: 417 of 420 sidecars in the current export match; the
# 3 orphans -- a Temp folder + one stem mismatch -- are counted in the
# index, not hidden). blend has no files in the current export yet but
# is supported for when they're uploaded (user-stated workflow).
SKELETON_SIDECAR_EXTS = ["psk", "pskx", "uemodel", "blend"]
ANIMATION_SIDECAR_EXTS = ["psa", "ueanim"]


def _find_sidecars(json_path, exts):
    """Same-folder, same-stem companion files for a JSON asset."""
    stem = json_path[:-5]  # strip .json
    found = {}
    for ext in exts:
        p = f"{stem}.{ext}"
        if os.path.exists(os.path.join(SRC, p)):
            found[ext] = p
    return found


def build_asset_skeletons():
    """
    Builds Content/ROD/DataAssets/_AssetInspector/Skeletons.json --
    the Asset Inspector's Skeletons/Meshes tab over the CHR/ and ITM/
    trees (the CHR folder finally getting its section, deferred to
    now per the roadmap reshuffle, unblocked by the 9 new asset
    exports).

    One entry per SK_*.json skeletal-mesh asset (469 in the current
    export), grouped with its same-folder companions by the
    user-documented naming conventions, each verified against the
    real tree before building:
      - {stem}_Skeleton.json         the bone skeleton (128)
      - PHYS_{restOfStem}.json OR {stem}_PhysicsAsset.json
                                     the physics asset (174 + 26 --
                                     BOTH real conventions exist)
      - {stem}_MorphData.json        morph data, sometimes (28)
      - sidecar binaries psk/pskx/uemodel/blend with the same stem,
        downloadable via the EXISTING /api/pipeline/download-file
        endpoint (it already serves any raw-export path with
        traversal protection -- zero server changes needed).
    Like every Asset Inspector tab: the JSONs are mesh METADATA and
    references, never geometry (UE doesn't export geometry to JSON);
    the sidecars ARE the geometry, which is exactly why they're
    surfaced for download.
    """
    entries = []
    companion_suffixes = ("_Skeleton", "_MorphData", "_PhysicsAsset")
    for root in ("CHR", "ITM"):
        base = os.path.join(SRC, root)
        if not os.path.isdir(base):
            continue
        for dirpath, _dirs, files in os.walk(base):
            for f in sorted(files):
                if not ((f.startswith("SK_") or f.startswith("SM_")) and f.endswith(".json")):
                    continue
                stem = f[:-5]
                is_static = f.startswith("SM_")
                if stem.endswith(companion_suffixes):
                    continue  # companions attach to their mesh entry below
                rel_dir = os.path.relpath(dirpath, SRC).replace(os.sep, "/")
                rel_json = f"{rel_dir}/{f}"
                # PHYS_ convention swaps the SK_ prefix; _PhysicsAsset appends.
                phys_prefixed = f"{rel_dir}/PHYS_{stem[3:]}.json"
                phys_suffixed = f"{rel_dir}/{stem}_PhysicsAsset.json"
                entry = {
                    "name": stem,
                    "jsonPath": rel_json,
                    "folder": rel_dir,
                    # SM_ static meshes (e.g. enemy StaticMesh/ subfolders,
                    # 11 pskx sidecars in the current export) are a real,
                    # separate asset kind cataloged alongside SK_ skeletal
                    # meshes -- found when the pskx census (33) didn't
                    # match the first catalog pass (22).
                    "kind": "StaticMesh" if is_static else "SkeletalMesh",
                    "family": "/".join(rel_dir.split("/")[:2]),
                    "skeletonJson": (f"{rel_dir}/{stem}_Skeleton.json"
                        if not is_static and os.path.exists(os.path.join(dirpath, f"{stem}_Skeleton.json")) else None),
                    "physicsJson": (phys_prefixed if os.path.exists(os.path.join(SRC, phys_prefixed))
                                    else (phys_suffixed if os.path.exists(os.path.join(SRC, phys_suffixed)) else None)),
                    "morphDataJson": f"{rel_dir}/{stem}_MorphData.json"
                        if os.path.exists(os.path.join(dirpath, f"{stem}_MorphData.json")) else None,
                    "sidecars": _find_sidecars(rel_json, SKELETON_SIDECAR_EXTS),
                    # Binaries can also sit on the SKELETON companion's stem
                    # (e.g. SK_X_Skeleton.pskx) -- 11 of the current export's
                    # 33 pskx files live there, found when the first census
                    # count didn't match the catalog's.
                    "skeletonSidecars": _find_sidecars(f"{rel_dir}/{stem}_Skeleton.json", SKELETON_SIDECAR_EXTS)
                        if os.path.exists(os.path.join(dirpath, f"{stem}_Skeleton.json")) else {},
                }
                entries.append(entry)
    entries.sort(key=lambda e: e["jsonPath"])

    out_dir = os.path.join(OUT, "DataAssets/_AssetInspector")
    save_json(os.path.join(out_dir, "Skeletons.json"), entries)
    by_family = {}
    for e in entries:
        by_family[e["family"]] = by_family.get(e["family"], 0) + 1
    sidecar_counts = {ext: sum(1 for e in entries if ext in e["sidecars"] or ext in e["skeletonSidecars"])
                      for ext in SKELETON_SIDECAR_EXTS}
    print(f"  Asset skeletons: {len(entries)} meshes "
          f"({sum(1 for e in entries if e['kind'] == 'SkeletalMesh')} skeletal / {sum(1 for e in entries if e['kind'] == 'StaticMesh')} static) "
          f"({sum(1 for e in entries if e['skeletonJson'])} with _Skeleton, "
          f"{sum(1 for e in entries if e['physicsJson'])} with physics, "
          f"{sum(1 for e in entries if e['morphDataJson'])} with morph data); "
          f"sidecars: {sidecar_counts}")
    return {"count": len(entries), "byFamily": by_family, "sidecarCounts": sidecar_counts}


def build_asset_animations():
    """
    Builds Content/ROD/DataAssets/_AssetInspector/Animations.json --
    the Asset Inspector's Animations tab over the ANM/ tree (plus the
    handful of AS_/A_ sequences living beside CHR costume assets).

    One entry per animation-asset JSON, kind classified by the
    verified filename prefixes: A_ AnimSequence, AM_ AnimMontage,
    BS_ BlendSpace, AC_ AnimComposite, AS_ AnimSequence (costume-side
    naming). Sidecar binaries psa/ueanim with the same stem are
    downloadable via the existing download-file endpoint. Sidecars
    with NO same-stem JSON sibling (3 in the current export, a Temp
    folder + one stem mismatch) are listed in the orphans array --
    shown, not hidden.
    """
    kind_by_prefix = {"A": "AnimSequence", "AM": "AnimMontage", "BS": "BlendSpace",
                      "AC": "AnimComposite", "AS": "AnimSequence"}
    entries = []
    claimed_sidecars = set()
    roots = ("ANM", "CHR")
    for root in roots:
        base = os.path.join(SRC, root)
        if not os.path.isdir(base):
            continue
        for dirpath, _dirs, files in os.walk(base):
            for f in sorted(files):
                if not f.endswith(".json"):
                    continue
                m = re.match(r"^(A|AM|BS|AC|AS)_", f)
                if not m:
                    continue
                # CHR/ contains many non-animation A*_ jsons? No -- the A_
                # prefix census is dominated by ANM sequences; costume-side
                # AS_/A_ files ARE sequences. Everything matching stays in.
                rel_dir = os.path.relpath(dirpath, SRC).replace(os.sep, "/")
                if root == "CHR" and m.group(1) not in ("AS", "A"):
                    continue  # montages/blendspaces only cataloged from ANM/
                rel_json = f"{rel_dir}/{f}"
                sidecars = _find_sidecars(rel_json, ANIMATION_SIDECAR_EXTS)
                for p in sidecars.values():
                    claimed_sidecars.add(p)
                entries.append({
                    "name": f[:-5],
                    "jsonPath": rel_json,
                    "folder": rel_dir,
                    "kind": kind_by_prefix[m.group(1)],
                    "sidecars": sidecars,
                })
    entries.sort(key=lambda e: e["jsonPath"])

    # Orphan sidecars: binaries with no same-stem json sibling
    orphans = []
    for root in roots:
        base = os.path.join(SRC, root)
        if not os.path.isdir(base):
            continue
        for dirpath, _dirs, files in os.walk(base):
            for f in files:
                ext = f.rsplit(".", 1)[-1].lower()
                if ext in ANIMATION_SIDECAR_EXTS:
                    rel = os.path.relpath(os.path.join(dirpath, f), SRC).replace(os.sep, "/")
                    if rel not in claimed_sidecars:
                        orphans.append(rel)

    out_dir = os.path.join(OUT, "DataAssets/_AssetInspector")
    save_json(os.path.join(out_dir, "Animations.json"), entries)
    kinds = {}
    for e in entries:
        kinds[e["kind"]] = kinds.get(e["kind"], 0) + 1
    sidecar_counts = {ext: sum(1 for e in entries if ext in e["sidecars"]) for ext in ANIMATION_SIDECAR_EXTS}
    print(f"  Asset animations: {len(entries)} assets {kinds}; sidecars: {sidecar_counts}; orphan sidecars: {len(orphans)}")
    return {"count": len(entries), "byKind": kinds, "sidecarCounts": sidecar_counts, "orphanSidecars": sorted(orphans)}


def _piece_overlap_quality(pieces, piece_extent):
    """
    Rough per-area "will this composite look seamless" signal, added
    after a user-reported visual investigation (verified via direct
    pixel compositing, not guessed): pieces genuinely overlap by very
    different amounts area-to-area -- a 3-piece area can share 46-76%
    of each neighbor's extent (composites cleanly) while a 4-piece
    area can share as little as 2% between one pair (a hairline
    sliver, or true separation) -- because this export's
    PieceMaskMaterial field (the game's own blend mask) is empty, so
    there's no data to soften a thin-overlap seam the way the real
    game presumably does. This does NOT indicate a placement bug (the
    center-anchor position itself is independently verified via
    terminal-containment testing at 70/71) -- it's a genuine property
    of how sparsely two specific pieces were authored to overlap.

    For every pair of pieces, computes the overlap fraction of the
    SMALLER piece's area covered by the intersection rectangle (0 if
    they don't intersect at all). Returns the minimum such fraction
    across pairs whose bounding boxes touch at all (pairs with truly
    zero geometric overlap are counted as isolated separately, since
    "0% overlap of a touching pair" and "these two don't touch at
    all" are different, both worth surfacing).
    """
    if len(pieces) < 2:
        return {"minOverlapFraction": 1.0, "isolatedPieceCount": 0, "seamRisk": "none"}

    def rect(p):
        half = piece_extent / 2.0
        return (p["centerX"] - half, p["centerY"] - half, p["centerX"] + half, p["centerY"] + half)

    min_frac = None
    isolated = 0
    for i, p in enumerate(pieces):
        touches_any = False
        best_for_p = 0.0
        r1 = rect(p)
        for j, q in enumerate(pieces):
            if i == j:
                continue
            r2 = rect(q)
            ix = max(0.0, min(r1[2], r2[2]) - max(r1[0], r2[0]))
            iy = max(0.0, min(r1[3], r2[3]) - max(r1[1], r2[1]))
            if ix > 0 and iy > 0:
                touches_any = True
                frac = (ix * iy) / (piece_extent * piece_extent)
                best_for_p = max(best_for_p, frac)
        if not touches_any:
            isolated += 1
        else:
            min_frac = best_for_p if min_frac is None else min(min_frac, best_for_p)

    if min_frac is None:
        risk = "high" if isolated else "none"
    elif min_frac < 0.15:
        risk = "high"
    elif min_frac < 0.35:
        risk = "medium"
    else:
        risk = "low"
    if isolated:
        risk = "high"
    return {
        "minOverlapFraction": round(min_frac, 3) if min_frac is not None else None,
        "isolatedPieceCount": isolated,
        "seamRisk": risk,
    }


def _resolve_piece_mask_image(mask_asset_path):
    """
    Resolves a MapPieceDataDetails' PieceMaskMaterial reference (a
    MaterialInstanceConstant) to the actual mask PNG it points at, by
    reading the material JSON's own TextureParameterValues.

    DISCOVERED this session (a later asset export finally included
    these -- previously PieceMaskMaterial appeared empty for every
    area checked, which is why the seam-risk workaround shipped
    first): the mask PNG's alpha channel is flat 255 (it's not an
    alpha mask); the real per-pixel crop data lives in the RED and
    GREEN color channels, which trace a boundary-curve shape (visibly
    a coastline-like line, not a broad radial gradient) rather than a
    single value -- almost certainly a directional cut line per
    neighboring piece, encoded two channels at once. No shader graph
    is exported for M_MapPiece_Mask, so the EXACT R/G combination
    formula the game's own material uses cannot be recovered with
    certainty from this JSON metadata alone -- this is stated
    honestly rather than presented as a verified pixel-perfect
    algorithm. Applied client-side as a CSS luminance mask-image
    (which blends R/G/B by standard luminance weighting), a
    defensible, real-data-driven improvement over both raw
    uncropped overlap and the earlier synthetic CSS radial-gradient
    feather it replaces.
    """
    if not mask_asset_path:
        return None
    rel = mask_asset_path.split("/Game/ROD/")[-1].split(".")[0] + ".json"
    full = os.path.join(SRC, rel)
    if not os.path.exists(full):
        return None
    try:
        mat = load_json(full)
    except Exception:
        return None
    mat_obj = next((o for o in mat if o.get("Type") == "MaterialInstanceConstant"), None)
    if not mat_obj:
        return None
    for tex_param in mat_obj.get("Properties", {}).get("TextureParameterValues", []):
        tex_path = (tex_param.get("ParameterValue") or {}).get("ObjectPath", "")
        if tex_path.startswith("/Game/ROD/"):
            png_rel = tex_path[len("/Game/ROD/"):].split(".")[0] + ".png"
            if os.path.exists(os.path.join(SRC, png_rel)):
                return f"Content/ROD/{png_rel}"
    return None


def build_static_maps():
    """
    Builds Content/ROD/DataAssets/Database/WorldMap/StaticMaps.json --
    Town Maps and Dungeon Floor Maps, a DIFFERENT (simpler) asset
    shape than the pieced-together field maps World > Map already
    covers: each is a single, already-composited image with no
    per-piece position math needed.

    HONEST LIMIT, stated up front rather than silently omitted: unlike
    the field map's terminal-coordinate markers, NO coordinate data
    exists anywhere in this export that is confirmed to be scaled to
    THESE specific image spaces -- town/dungeon-local marker positions
    (NPCs, chests, etc. placed on this specific 2D image) would need a
    separate, dungeon/town-local coordinate table this export doesn't
    contain (checked: DA_InGame's TerminalDatas are world-space, not
    town/dungeon-image-space). These are exposed as browsable
    REFERENCE IMAGES, not interactive marker maps, with that
    limitation stated in the view rather than faked with placeholder
    pins.

    Town maps: Widget/MapTexture/TownMap/T_MapImage_Town_{CODE}*.png
    (a plain full-town image, plus an "_Overall" zoomed-out variant
    where present). Town CODE here is the SAME 3-letter code World >
    Towns already uses (e.g. TOB), joined client-side to that data for
    a display name.

    Dungeon floor maps: Widget/MapTexture/DungeonFloorMap/
    T_DungeonFloorMap_{SUFFIX}.png. SUFFIX here (e.g. "HTE1", "NTR2")
    is NOT confirmed to correspond 1:1 with any specific entry in
    DUNGEON_CODES (which has finer-grained codes like HTE_Anc, HTE_FI,
    HTE_Und all sharing the "HTE" prefix) -- rather than guess which
    of several same-prefix dungeons a bare-numbered floor belongs to,
    each floor is labeled with its raw exported suffix and its
    3-letter prefix only, honestly unattributed to a specific dungeon
    name. A "_Way" suffixed variant (tiny images, e.g. 64x32) is a
    separate small connector/route graphic, not a full floor map, and
    is listed as its own entry rather than merged in.
    """
    towns = []
    town_dir = os.path.join(SRC, "Widget/MapTexture/TownMap")
    if os.path.isdir(town_dir):
        seen_codes = set()
        for f in sorted(os.listdir(town_dir)):
            if not f.endswith(".png"):
                continue
            m = re.match(r"^T_MapImage_Town_([A-Za-z0-9]+)(_Overall)?\.png$", f)
            if not m:
                continue
            code, is_overall = m.group(1), bool(m.group(2))
            if code not in seen_codes:
                seen_codes.add(code)
                towns.append({"townCode": code, "images": []})
            entry = next(t for t in towns if t["townCode"] == code)
            entry["images"].append({
                "variant": "overall" if is_overall else "full",
                "image": f"Content/ROD/Widget/MapTexture/TownMap/{f}",
            })

    dungeon_floors = []
    dfm_dir = os.path.join(SRC, "Widget/MapTexture/DungeonFloorMap")
    if os.path.isdir(dfm_dir):
        for f in sorted(os.listdir(dfm_dir)):
            if not f.endswith(".png"):
                continue
            m = re.match(r"^T_DungeonFloorMap_([A-Za-z]+)(\d+)(_Way)?\.png$", f)
            if not m:
                continue
            prefix, num, is_way = m.group(1), m.group(2), bool(m.group(3))
            dungeon_floors.append({
                "prefix": prefix,
                "floorNumber": int(num),
                "isWayGraphic": is_way,
                "suffix": f"{prefix}{num}{'_Way' if is_way else ''}",
                "image": f"Content/ROD/Widget/MapTexture/DungeonFloorMap/{f}",
                "dungeonAttributionConfirmed": False,
            })

    out_dir = os.path.join(OUT, "DataAssets/Database/WorldMap")
    save_json(os.path.join(out_dir, "StaticMaps.json"), {"towns": towns, "dungeonFloors": dungeon_floors})
    print(f"  Static maps: {len(towns)} town(s) ({sum(len(t['images']) for t in towns)} images), "
          f"{len(dungeon_floors)} dungeon floor image(s) -- reference images, no marker coordinates (confirmed none exist)")
    return {"townCount": len(towns), "dungeonFloorCount": len(dungeon_floors)}


def build_world_map(all_chests):
    """
    Builds Content/ROD/DataAssets/Database/WorldMap/WorldMap.json --
    the World > Map tab: an interactive floor-map overview + per-area
    composite maps with coordinate-plotted markers and legend toggles.

    The coordinate system, decoded and VERIFIED this session:
      - DA_MapPiece_PL_{WL}_WP.json holds, PER GATE ID, a list of map
        pieces with PiecePosition (world X/Y) and TexturePerPixel
        (80 world units per pixel; pieces are 512x512 textures).
        PiecePosition is the piece CENTER -- verified by containment:
        every terminal with coordinates falls inside a center-anchored
        rect of one of its own pieces (the corner hypothesis scattered
        misses). Screen axes: +X right, +Y down -- verified against
        the floor-map widget's canvas offsets (TOB south/high-Y sits
        at the bottom, Plains3 north/low-Y at the top).
      - DA_InGame's TerminalDatas carry a Coordinate per terminal:
        122 of 192 are non-zero and plot directly. The SA_/WT_ prefix
        question from the Gates section is ALSO answered by the
        in-game legend: SA = Safe Area, WT = Warp Terminal.
      - Piece textures live under Widget/MapTexture/FieldMap/
        {WL}_{family}/T_MapPiece_{WL}_{location}{letter}.png, letter
        a/b/c matching MapPieceDataDetails order (verified: every
        area with exported textures matches its details count
        exactly, 0 mismatches). Only SOME areas have textures in the
        current export (7 of 72 in WL01 -- Forest2/Plains1/Plains3/
        Town families); areas without them are still listed with
        hasTextures:false rather than dropped.
      - The floor OVERVIEW (T_FloorMap_WL01.png, 1024x1024) gets its
        clickable area overlays from WBP_Map_FloorMap_WL01.json's
        CanvasPanelSlot offsets -- the game's own layout, no world
        math needed there.

    HONEST LIMITS (stated in the view's legend, not hidden):
      - Chests have NO coordinates anywhere in the export (confirmed
        back in the Chests section) -- they attach to areas by the
        location-fragment join and are shown as a per-area list, not
        plotted points.
      - Bosses, monster spawns, gathering materials, and mission
        objectives have no exported coordinates either (spawn/gather
        locators live in unexported level actors; socket tables carry
        no positions -- checked DT_SocketPopTable_WL01's fields
        directly). Their legend entries render disabled with that
        explanation.
      - Composite area maps could show pieces positioned wrong
        relative to each other -- user-reported with real in-game
        screenshots, TWICE (the first round wrongly suspected thin
        piece-to-piece overlap alone). ROOT CAUSE FOUND AND FIXED:
        MapPieceDataDetails' array order does NOT match alphabetical
        piece-letter order (confirmed directly -- one area's array is
        [c, a, b], not [a, b, c]; ALL 7 currently-textured areas turned
        out to have non-alphabetical order). This function used to
        construct each piece's filename from its ARRAY INDEX
        (`chr(ord("a")+i)`), silently pairing every position with the
        WRONG texture whenever an area's array wasn't alphabetical --
        now fixed to read each entry's own PieceTexture field directly.
        Genuine thin piece-to-piece overlap (see _piece_overlap_quality)
        is a SEPARATE, real property of some areas' authored layout
        (as little as ~10% overlap between two pieces) -- seamRisk/
        minPieceOverlapFraction/isolatedPieceCount are still computed
        and exposed for that. A later asset export also added real
        PieceMaskMaterial data (previously empty for every area
        checked) resolved to its actual mask PNG via
        _resolve_piece_mask_image and applied client-side as a CSS
        luminance mask -- see that helper's docstring for exactly what
        the mask encodes and the honest limits of reproducing it
        without the shader graph.
    """
    ig = load_json(os.path.join(SRC, "DataAssets/Games/InGame/DA_InGame.json"))[0]["Properties"]
    term_coords = {}
    for w in ig.get("WorldDatas", []):
        for t in w.get("TerminalDatas", []):
            c = t.get("Coordinate", {})
            if any(abs(c.get(k, 0)) > 0.01 for k in ("X", "Y")):
                term_coords[t["ID"]] = {"x": c["X"], "y": c["Y"]}

    chest_ids_by_location = {}
    chest_contents_by_location = {}
    for cid, chest in (all_chests or {}).items():
        if not chest.get("location"):
            continue
        chest_ids_by_location.setdefault(chest["location"], []).append(cid)
        contents = []
        for pool in chest.get("pools", {}).values():
            for slot in pool:
                if slot.get("itemKey"):
                    contents.append({
                        "itemKey": slot["itemKey"], "num": slot.get("num"),
                        "sharePct": slot.get("sharePct"),
                    })
        chest_contents_by_location.setdefault(chest["location"], []).append({
            "chestId": cid, "contents": contents,
        })

    PIECE_PX = 512
    areas = []
    worlds_seen = []
    for piece_file in sorted(glob.glob(os.path.join(SRC, "DataAssets/WorldAdmin/MapPiece/DA_MapPiece_PL_*_WP.json"))):
        world = os.path.basename(piece_file).split("_")[3]  # WL01 / WL02
        worlds_seen.append(world)
        data = load_json(piece_file)[0]["Properties"]["MapPieceData"]
        for entry in data:
            gate_id = entry["Key"]
            location = gate_id.split("_", 1)[1] if "_" in gate_id else gate_id
            family = location.split("_")[0]
            tpp = entry["Value"].get("TexturePerPixel", 80.0)
            details = entry["Value"].get("MapPieceDataDetails", [])
            pieces = []
            for i, det in enumerate(details):
                # BUG FOUND AND FIXED this session: MapPieceDataDetails'
                # array order does NOT match alphabetical piece-letter
                # order (confirmed directly -- SA_Plains1_1_01's array is
                # [c, a, b], not [a, b, c]). The original code assigned
                # letters purely by array INDEX and constructed a
                # filename from that guess, which silently paired each
                # PiecePosition with the WRONG texture whenever a gate's
                # array wasn't already alphabetical -- the real cause of
                # the "pieces positioned wrong relative to each other"
                # visual bug a user reported with reference screenshots.
                # Fixed to read the REAL filename directly from the
                # entry's own PieceTexture.AssetPathName instead of
                # reconstructing it from position.
                tex_path = (det.get("PieceTexture") or {}).get("AssetPathName", "")
                if not tex_path:
                    continue
                tex_name = tex_path.split("/")[-1].split(".")[0]  # e.g. T_MapPiece_WL01_Plains1_1_01c
                rel = f"Widget/MapTexture/FieldMap/{world}_{family}/{tex_name}.png"
                if not os.path.exists(os.path.join(SRC, rel)):
                    continue
                p = det.get("PiecePosition", {})
                mask_image = _resolve_piece_mask_image(
                    (det.get("PieceMaskMaterial") or {}).get("AssetPathName", "")
                )
                pieces.append({
                    "image": f"Content/ROD/{rel}",
                    "maskImage": mask_image,
                    "centerX": p.get("X", 0.0),
                    "centerY": p.get("Y", 0.0),
                    "px": PIECE_PX,
                })
            half = PIECE_PX * tpp / 2.0
            bounds = None
            if pieces:
                bounds = {
                    "minX": min(p["centerX"] for p in pieces) - half,
                    "minY": min(p["centerY"] for p in pieces) - half,
                    "maxX": max(p["centerX"] for p in pieces) + half,
                    "maxY": max(p["centerY"] for p in pieces) + half,
                }
            # Markers: every terminal whose coordinates fall inside this
            # area's composite bounds (neighbors visible on the same
            # composite plot too -- that's how the in-game map behaves).
            markers = []
            if bounds:
                for tid, c in term_coords.items():
                    if bounds["minX"] <= c["x"] <= bounds["maxX"] and bounds["minY"] <= c["y"] <= bounds["maxY"]:
                        markers.append({
                            "id": tid,
                            "kind": "SA" if tid.startswith("SA_") else ("WT" if tid.startswith("WT_") else "other"),
                            "x": c["x"], "y": c["y"],
                        })
            seam = _piece_overlap_quality(pieces, PIECE_PX * tpp)
            areas.append({
                "gateId": gate_id,
                "location": location,
                "family": family,
                "world": world,
                "texturePerPixel": tpp,
                "pieces": pieces,
                "hasTextures": bool(pieces),
                "bounds": bounds,
                "markers": sorted(markers, key=lambda m: m["id"]),
                "chestIds": sorted(chest_ids_by_location.get(location, [])),
                "chests": sorted(chest_contents_by_location.get(location, []), key=lambda c: c["chestId"]),
                "hasOwnCoordinate": gate_id in term_coords,
                "seamRisk": seam["seamRisk"],
                "minPieceOverlapFraction": seam["minOverlapFraction"],
                "isolatedPieceCount": seam["isolatedPieceCount"],
            })

    # Floor overview overlays from the game's own widget layout
    floor = None
    wbp_path = os.path.join(SRC, "Widget/Cockpit/Minimap/WBP_Map_FloorMap_WL01.json")
    floor_img_rel = "Widget/MapTexture/FloorMap/T_FloorMap_WL01.png"
    if os.path.exists(wbp_path) and os.path.exists(os.path.join(SRC, floor_img_rel)):
        wbp = load_json(wbp_path)
        images = {o.get("Name"): o for o in wbp if o.get("Type") == "Image"}
        overlays = []
        for o in wbp:
            if o.get("Type") != "CanvasPanelSlot":
                continue
            props = o.get("Properties", {})
            content = ((props.get("Content") or {}).get("ObjectName") or "").split(".")[-1].rstrip("'")
            img_obj = images.get(content)
            if not img_obj or content in ("HeroIcon",):
                continue
            brush = (img_obj.get("Properties") or {}).get("Brush", {})
            res = (brush.get("ResourceObject") or {}).get("ObjectPath", "")
            if "FloorMapPiece" not in res and "FloorMap/WL01" not in res and content != "WL01_Floor":
                if content == "FloorMap":
                    continue
            tex_rel = None
            if res.startswith("/Game/ROD/"):
                tex_rel = "Content/ROD/" + res[len("/Game/ROD/"):].split(".")[0] + ".png"
            ld = props.get("LayoutData", {})
            off = ld.get("Offsets", {})
            size = brush.get("ImageSize", {})
            if content == "WL01_Floor" or not tex_rel:
                continue
            overlays.append({
                "name": content,
                "image": tex_rel,
                "left": off.get("Left", 0.0),
                "top": off.get("Top", 0.0),
                "width": size.get("X", 0.0),
                "height": size.get("Y", 0.0),
            })
        floor = {
            "world": "WL01",
            "image": f"Content/ROD/{floor_img_rel}",
            "size": 1024,
            # Slots anchor at canvas center (0.5, 0.5) -- offsets are
            # relative to the 1024x1024 canvas center, verified in the
            # WBP: the FloorMap root panel spans Right/Bottom 1024.
            "anchorCenter": True,
            "overlays": overlays,
        }

    out_dir = os.path.join(OUT, "DataAssets/Database/WorldMap")

    # Real, recolored map icons (see build_map_icons -- the game's own
    # icon sprites are unrecolored red/green mask layers; this points
    # at the pipeline's own recolored output instead of the raw ones).
    # Reads keys directly from MAP_ICON_COLORS (the single source of
    # truth build_map_icons itself uses) rather than a separately
    # maintained duplicate list -- a duplicate list is exactly how a
    # prior session's expansion of MAP_ICON_COLORS to 26 keys silently
    # failed to reach WorldMap.json's icons registry (this list was
    # never updated alongside it, caught when a status check showed
    # only 15 of 26 icons actually wired through).
    icons = {}
    for key in MAP_ICON_COLORS:
        candidate = os.path.join(OUT, "DataAssets/_MapIcons", f"{key}.png")
        if os.path.exists(candidate):
            icons[key] = f"Content/ROD/DataAssets/_MapIcons/{key}.png"

    # Multi-area "World View" composite (the user's request: "chunks
    # lined up together like the big map but made of the chunks"),
    # answerable because every piece already carries real, absolute
    # world-space coordinates -- plotting ALL textured areas' pieces
    # on ONE shared canvas at the same 80-unit/pixel scale needs no
    # new data, just wider bounds than any single area's own. Built
    # per world (WL01, WL02, ...) since different worlds' coordinate
    # spaces aren't guaranteed comparable.
    world_composites = {}
    for world_code in sorted(set(a["world"] for a in areas)):
        world_pieces = []
        for a in areas:
            if a["world"] != world_code or not a["hasTextures"]:
                continue
            for p in a["pieces"]:
                world_pieces.append({**p, "sourceGateId": a["gateId"]})
        if not world_pieces:
            continue
        tpp0 = next(a["texturePerPixel"] for a in areas if a["world"] == world_code and a["hasTextures"])
        half0 = PIECE_PX * tpp0 / 2.0
        wminX = min(p["centerX"] for p in world_pieces) - half0
        wminY = min(p["centerY"] for p in world_pieces) - half0
        wmaxX = max(p["centerX"] for p in world_pieces) + half0
        wmaxY = max(p["centerY"] for p in world_pieces) + half0
        world_markers = [
            {"id": tid, "kind": "SA" if tid.startswith("SA_") else ("WT" if tid.startswith("WT_") else "other"), "x": c["x"], "y": c["y"]}
            for tid, c in term_coords.items()
            if wminX <= c["x"] <= wmaxX and wminY <= c["y"] <= wmaxY
        ]
        world_composites[world_code] = {
            "world": world_code,
            "texturePerPixel": tpp0,
            "pieces": world_pieces,
            "bounds": {"minX": wminX, "minY": wminY, "maxX": wmaxX, "maxY": wmaxY},
            "markers": sorted(world_markers, key=lambda m: m["id"]),
            "areaCount": len(set(p["sourceGateId"] for p in world_pieces)),
        }

    save_json(os.path.join(out_dir, "WorldMap.json"), {
        "floor": floor, "areas": areas, "icons": icons, "worldComposites": world_composites,
    })
    with_tex = sum(1 for a in areas if a["hasTextures"])
    total_markers = sum(len(a["markers"]) for a in areas)
    textured_areas = [a for a in areas if a["hasTextures"]]
    seam_high = sum(1 for a in textured_areas if a["seamRisk"] == "high")
    seam_medium = sum(1 for a in textured_areas if a["seamRisk"] == "medium")
    seam_low = sum(1 for a in textured_areas if a["seamRisk"] in ("low", "none"))
    save_json(os.path.join(out_dir, "_index.json"), {
        "worlds": sorted(set(worlds_seen)),
        "areaCount": len(areas),
        "areasWithTextures": with_tex,
        "terminalCoordinates": len(term_coords),
        "markerPlacements": total_markers,
        "floorOverlayCount": len((floor or {}).get("overlays", [])),
        "chestsAttachedByLocation": sum(len(a["chestIds"]) for a in areas),
        "coordinateLayers": ["SA (Safe Areas)", "WT (Warp Terminals)"],
        "noCoordinateLayers": ["Chests (location join only)", "Bosses", "Monster spawns", "Materials", "Mission objectives"],
        "seamRiskCounts": {"low": seam_low, "medium": seam_medium, "high": seam_high},
        "seamRiskNote": (
            "Piece placement itself is verified via terminal-containment testing (70/71 match) -- "
            "seam risk reflects how much any two of an area's OWN pieces actually overlap by "
            "authored position, not a placement error. Low overlap between specific pieces means "
            "a visible gap or hard seam is likely without the game's own blend mask "
            "(PieceMaskMaterial), which is empty in this export."
        ),
        "file": "DataAssets/Database/WorldMap/WorldMap.json",
    })
    print(f"  World map: {len(areas)} areas ({with_tex} with exported map textures), "
          f"{len(term_coords)} terminals with coordinates, {total_markers} marker placements, "
          f"{len((floor or {}).get('overlays', []))} floor overlays; chests attach by location join (no coordinates -- confirmed); "
          f"seam risk across textured areas: {seam_low} low / {seam_medium} medium / {seam_high} high")
    return {"areaCount": len(areas), "areasWithTextures": with_tex}


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


def build_asset_inspector_index(all_materials, all_meshes, all_skeletons, all_animations):
    """
    Small combining step that runs after ALL asset builders -- writes
    the single _index.json the frontend's coverage banner reads,
    rather than any builder guessing at or partially writing another's
    counts. Skeletons/Animations contribute their summary dicts
    (counts, per-family/kind breakdowns, sidecar tallies, orphan
    sidecar list) so the tabs and Data Coverage read one source.
    """
    save_json(os.path.join(OUT, "DataAssets/_AssetInspector/_index.json"), {
        "materialCount": len(all_materials),
        "materialInstanceCount": sum(1 for m in all_materials if m["assetType"] == "MaterialInstanceConstant"),
        "baseMaterialCount": sum(1 for m in all_materials if m["assetType"] == "Material"),
        "meshCount": len(all_meshes),
        "skeletons": all_skeletons,
        "animations": all_animations,
        "files": {
            "skeletons": "DataAssets/_AssetInspector/Skeletons.json",
            "animations": "DataAssets/_AssetInspector/Animations.json",
        },
    })


# Human-friendly labels + a quantifiable/informational split for every
# EModificationType found across DA_AttributeModification's
# BonusModificationData (verified exhaustively -- 19 distinct types,
# all accounted for below, none left to guess at render time).
# "quantifiable" means it maps cleanly onto a stat this toolkit's
# Player builder already computes (HP/Stamina/SP/ATK/DEF) and can be
# folded into an additive "after modifiers" total; "informational"
# means it's real data with no existing numeric home in this builder
# (sword-skill damage buffs, dodge/sprint, economy) -- shown, not
# silently dropped, but not summed into a total that would misrepresent
# precision this toolkit doesn't actually have for those systems.
ATTRIBUTE_MOD_EFFECT_INFO = {
    "BonusHealth": {"label": "Bonus Max HP", "unit": "flat", "quantifiable": "MaxHealth"},
    "BonusStamina": {"label": "Bonus Max Stamina", "unit": "flat", "quantifiable": "MaxStamina"},
    "BonusSP": {"label": "Bonus Max SP", "unit": "flat", "quantifiable": "MaxSoul"},
    "CoefATK": {"label": "ATK Coefficient", "unit": "percent", "quantifiable": "ATK"},
    "CoefDEF": {"label": "DEF Coefficient", "unit": "percent", "quantifiable": "DEF"},
    "CoefStamina": {"label": "Stamina Coefficient", "unit": "percent", "quantifiable": "MaxStamina"},
    "CoefSP": {"label": "SP Coefficient", "unit": "percent", "quantifiable": "MaxSoul"},
    "EnhHealCrystal": {"label": "Healing Crystal Enhancement", "unit": "percent", "quantifiable": None},
    "EnhDown": {"label": "Down-Attack Enhancement", "unit": "percent", "quantifiable": None},
    "EnhSlash": {"label": "Slash Damage Enhancement", "unit": "percent", "quantifiable": None},
    "EnhSlashDmg": {"label": "Slash Damage Enhancement (Major)", "unit": "percent", "quantifiable": None},
    "EnhSSDmg": {"label": "Sword Skill Damage Enhancement", "unit": "percent", "quantifiable": None},
    "EnhAtkSpeed": {"label": "Attack Speed Enhancement", "unit": "percent", "quantifiable": None},
    "EnhDodge": {"label": "Dodge Enhancement", "unit": "percent", "quantifiable": None},
    "CoefCombatSprint": {"label": "Combat Sprint Speed Coefficient", "unit": "percent", "quantifiable": None},
    "CoefCol": {"label": "Col Gain Coefficient", "unit": "percent", "quantifiable": None},
    "CoefExp": {"label": "Experience Gain Coefficient", "unit": "percent", "quantifiable": None},
    "CoefResist": {"label": "Resistance Coefficient", "unit": "percent", "quantifiable": None},
    "EnhPouch": {"label": "Pouch Capacity Enhancement", "unit": "percent", "quantifiable": None},
}


def build_attribute_modifications():
    """
    Builds Content/ROD/DataAssets/Database/AttributeModifications/
    AttributeModifications.json -- the per-stat "bonus modifier"
    breakpoints from DA_AttributeModification.BonusModificationData:
    as each of the 7 growth stats (Strength, Dexterity, Agility,
    Intelligence, Vitality, Endurance, Mind -- the SAME 7 keys the
    Player builder already tracks as STR/DEX/AGI/INT/VIT/END/MND)
    reaches a trigger value, real named bonus effects unlock.

    Verified directly against the raw asset before building anything:
    all 19 distinct EModificationType values across every stat's
    LevelData are accounted for in ATTRIBUTE_MOD_EFFECT_INFO above,
    each given a human label and classified as either quantifiable
    (maps onto MaxHealth/MaxStamina/MaxSoul/ATK/DEF, which this
    toolkit's Player builder already computes) or informational (real
    effects with no existing numeric home here -- shown, not summed).

    HONEST LIMIT: TriggerLevel is compared against the STAT'S OWN
    allocated value (e.g. "at Vitality 30, gain +100% Heal Crystal
    effectiveness"), not player character level -- confirmed by the
    data's own shape (each entry is keyed by a growth stat, not a
    flat list). This is a natural reading of the source structure, not
    independently confirmed against an in-game screenshot the way the
    HP/Stamina/SP floor values were -- stated as such in the view.
    """
    d = load_json(os.path.join(SRC, "DataAssets/Parameters/Shared/DA_AttributeModification.json"))[0]["Properties"]
    stats = {}
    unknown_types = set()
    for entry in d.get("BonusModificationData", []):
        stat = strip_enum(entry["Key"]).replace("EGrowthType_", "")
        breakpoints = []
        for lv in entry["Value"].get("LevelData", []):
            effects = []
            for e in lv.get("Effects", []):
                etype = strip_enum(e["Type"]).replace("EModificationType_", "")
                info = ATTRIBUTE_MOD_EFFECT_INFO.get(etype)
                if not info:
                    unknown_types.add(etype)
                effects.append({
                    "type": etype,
                    "value": e.get("Value"),
                    "label": info["label"] if info else etype,
                    "unit": info["unit"] if info else "unknown",
                    "quantifiable": info["quantifiable"] if info else None,
                })
            breakpoints.append({"triggerLevel": lv.get("TriggerLevel"), "effects": effects})
        breakpoints.sort(key=lambda b: b["triggerLevel"])
        stats[stat] = breakpoints

    out_dir = os.path.join(OUT, "DataAssets/Database/AttributeModifications")
    save_json(os.path.join(out_dir, "AttributeModifications.json"), stats)
    total_breakpoints = sum(len(v) for v in stats.values())
    save_json(os.path.join(out_dir, "_index.json"), {
        "statCount": len(stats),
        "totalBreakpoints": total_breakpoints,
        "unknownEffectTypes": sorted(unknown_types),
        "file": "DataAssets/Database/AttributeModifications/AttributeModifications.json",
    })
    print(f"  Attribute modifications: {len(stats)} stats, {total_breakpoints} level breakpoints"
          + (f" ({len(unknown_types)} unrecognized effect types: {sorted(unknown_types)})" if unknown_types else ""))
    return stats


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
    # ANM/CHR/ITM/Blueprints joined the exclusions when the big asset
    # exports landed: this walk MIRRORS every classified json into OUT,
    # and mirroring the asset trees would duplicate ~2 GB of asset
    # metadata that is NOT datatables -- it's the Asset Inspector's
    # domain (Skeletons/Animations catalogs + the download-file
    # endpoint, which streams from raw-export directly, no mirror
    # needed). Same reasoning as the existing Widget exclusion (its
    # own builder), discovered the hard way: the first inspectors run
    # after the merge filled the disk to 0 bytes mid-mirror and died,
    # leaving a partial Content/ROD/ANM tree (2,664 of 5,600 files)
    # that had to be deleted.
    excluded_dir_names = {"Localization", "WwiseAudio", "Widget",
                          "ANM", "CHR", "ITM", "Blueprints"}
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
        # Runs after "textures" (needs the raw icon sprites already
        # readable from raw-export -- it reads directly from SRC, not
        # from the textures section's copy, so ordering isn't a hard
        # dependency, but keeping map icons visually adjacent to the
        # general texture pass in the section list matches how they're
        # used together in World > Map).
        "key": "map_icons", "label": "World Map Icons (recolored)",
        "builder": build_map_icons, "requires": [], "produces": None,
        "rawInputs": ["Widget/3DMapCapture/MapIcon/IconImages/*.png"],
        "expectedOutputs": ["DataAssets/_MapIcons/_index.json"],
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
        "key": "shops", "label": "Items > Shops",
        "builder": build_shops, "requires": [], "produces": "all_shops",
        "rawInputs": ["DataAssets/Games/DataTables/DT_ShopItemList.json", "DataAssets/Items/ItemDataAsset.json"],
        "expectedOutputs": ["DataAssets/Database/Shops/Shops.json", "DataAssets/Database/Shops/_index.json"],
    },
    {
        # Shares the pool resolver with Monsters > Drops (same
        # requires, same reasoning: equipment slots resolve through the
        # data's real ItemKey fields).
        "key": "chests", "label": "Items > Chests",
        "builder": build_chests, "requires": ["all_weapons", "all_armor"], "produces": "all_chests",
        "rawInputs": ["DataAssets/WorldAdmin/DT_FixTBoxTable.json", "DataAssets/WorldAdmin/DT_ItemLotTable.json"],
        "expectedOutputs": ["DataAssets/Database/Chests/Chests.json", "DataAssets/Database/Chests/_index.json"],
    },
    {
        "key": "world_map", "label": "World > Map",
        "builder": build_world_map, "requires": ["all_chests"], "produces": None,
        "rawInputs": [
            "DataAssets/WorldAdmin/MapPiece/DA_MapPiece_PL_*_WP.json",
            "DataAssets/Games/InGame/DA_InGame.json",
            "Widget/MapTexture/FieldMap/**/*.png",
        ],
        "expectedOutputs": ["DataAssets/Database/WorldMap/WorldMap.json", "DataAssets/Database/WorldMap/_index.json"],
    },
    {
        "key": "static_maps", "label": "World > Map (Towns/Dungeons)",
        "builder": build_static_maps, "requires": [], "produces": None,
        "rawInputs": ["Widget/MapTexture/TownMap/*.png", "Widget/MapTexture/DungeonFloorMap/*.png"],
        "expectedOutputs": ["DataAssets/Database/WorldMap/StaticMaps.json"],
    },
    {
        "key": "monsters", "label": "Monsters",
        "builder": build_monsters, "requires": [], "produces": "all_monsters",
        "rawInputs": ["DataAssets/Database/DT_MonsterDatabase.json"],
        "expectedOutputs": ["DataAssets/Database/Monsters/_index.json"],
    },
    {
        "key": "monster_spawns", "label": "Monsters > Spawns",
        "builder": build_monster_spawns, "requires": [], "produces": None,
        "rawInputs": [
            "DataAssets/WorldAdmin/WL01/DT_CharacterGroupTable_WL01.json",
            "DataAssets/WorldAdmin/WL01/DT_CharacterGroupLotTable_WL01.json",
            "DataAssets/WorldAdmin/WL01/DT_SocketPopTable_WL01.json",
            "DataAssets/WorldAdmin/WL02/DT_CharacterGroupTable_WL02.json",
            "DataAssets/WorldAdmin/WL02/DT_CharacterGroupLotTable_WL02.json",
            "DataAssets/WorldAdmin/WL02/DT_SocketPopTable_WL02.json",
        ],
        "expectedOutputs": [
            "DataAssets/Database/MonsterSpawns/Groups.json",
            "DataAssets/Database/MonsterSpawns/Lots.json",
            "DataAssets/Database/MonsterSpawns/Pops.json",
            "DataAssets/Database/MonsterSpawns/_index.json",
        ],
    },
    {
        # Requires the SAME weapon/armor context Equipment is built
        # from so drop item resolution uses the data's real ItemKey
        # fields (no pattern guessing for equipment).
        "key": "monster_drops", "label": "Monsters > Drops",
        "builder": build_monster_drops, "requires": ["all_weapons", "all_armor"], "produces": "all_monster_drops",
        "rawInputs": [
            "DataAssets/WorldAdmin/DT_RewardLotTable.json",
            "DataAssets/WorldAdmin/DT_ItemLotTable.json",
        ],
        "expectedOutputs": ["DataAssets/Database/MonsterDrops/Drops.json", "DataAssets/Database/MonsterDrops/_index.json"],
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
        # rawInputs lists only the HARD requirements. Maps/**/LV_*.json
        # and DNG/**/LV_*.json are deliberately NOT listed even though
        # build_areas scans them when present: they ship in separate
        # Content-Maps.zip/Content-DNG.zip archives from the core
        # Content.zip, and listing them here would make the dashboard's
        # Export check report a Content.zip-only instance as broken when
        # it isn't -- the builder itself treats them as a soft dependency
        # (the Areas _index.json records levelScanAvailable so the app
        # can distinguish "not scanned" from "none exist").
        "key": "areas", "label": "World > Areas",
        "builder": build_areas, "requires": [], "produces": "all_areas",
        "rawInputs": ["DataAssets/Games/InGame/DA_InGame.json", "Localization/Game/en/Game.json"],
        "expectedOutputs": ["DataAssets/Database/Areas/Areas.json", "DataAssets/Database/Areas/_index.json"],
    },
    {
        # DNG/**/LV_*.json is a soft dependency for the same reason
        # Maps/DNG are for the areas section above -- it ships in
        # Content-DNG.zip, so it's deliberately absent from rawInputs.
        "key": "dungeons", "label": "World > Dungeons",
        "builder": build_dungeons, "requires": ["all_areas"], "produces": "all_dungeons",
        "rawInputs": ["DataAssets/Games/InGame/DA_InGame.json", "Localization/Game/en/Game.json"],
        "expectedOutputs": ["DataAssets/Database/Dungeons/Dungeons.json", "DataAssets/Database/Dungeons/_index.json"],
    },
    {
        # The MapPiece files DO ship in the core Content.zip's
        # DataAssets (unlike Maps/DNG), so they're listed as real raw
        # inputs -- the builder still loads them defensively so their
        # absence downgrades the map-piece cross-reference rather than
        # failing the build.
        "key": "gates", "label": "World > Gates",
        "builder": build_gates, "requires": [], "produces": "all_gates",
        "rawInputs": [
            "DataAssets/Games/InGame/DA_InGame.json",
            "DataAssets/WorldAdmin/MapPiece/DA_MapPiece_PL_WL01_WP.json",
            "DataAssets/WorldAdmin/MapPiece/DA_MapPiece_PL_WL02_WP.json",
        ],
        "expectedOutputs": ["DataAssets/Database/Gates/Gates.json", "DataAssets/Database/Gates/_index.json"],
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
        "key": "attribute_modifications", "label": "Player > Bonus Modifiers",
        "builder": build_attribute_modifications, "requires": [], "produces": None,
        "rawInputs": ["DataAssets/Parameters/Shared/DA_AttributeModification.json"],
        "expectedOutputs": ["DataAssets/Database/AttributeModifications/AttributeModifications.json", "DataAssets/Database/AttributeModifications/_index.json"],
    },
    {
        "key": "npcs", "label": "Characters > NPCs",
        "builder": build_npcs, "requires": [], "produces": None,
        "rawInputs": [
            "DataAssets/Character/NPC/DataTable/DT_NPC_*.json",
            "DataAssets/Character/NPC/Data/*/NPCData_*.json",
            "DataAssets/Character/NPC/Parts/NPCParts_*.json",
            "DataAssets/Character/NPC/Action/*/NPCAction_*.json",
        ],
        "expectedOutputs": ["DataAssets/Database/NPCs/NPCs.json", "DataAssets/Database/NPCs/_index.json"],
    },
    {
        "key": "active_skills", "label": "Characters > Active Skills",
        "builder": build_active_skills, "requires": [], "produces": None,
        "rawInputs": ["DataAssets/Parameters/Hero/DT_ActiveSkillList.json"],
        "expectedOutputs": ["DataAssets/Database/ActiveSkills/ActiveSkills.json", "DataAssets/Database/ActiveSkills/_index.json"],
    },
    {
        "key": "ailments", "label": "Characters > Ailments",
        "builder": build_ailments, "requires": [], "produces": "all_ailments",
        "rawInputs": ["Localization/Game/en/Game.json", "Widget/Common/IconImage/StateIconImages/*.png"],
        "expectedOutputs": ["DataAssets/Database/Ailments/Ailments.json", "DataAssets/Database/Ailments/_index.json"],
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
        "key": "area_loc", "label": "Area Localization",
        "builder": build_area_localization, "requires": ["all_areas"], "produces": None,
        "rawInputs": ["Localization/Game/*/Game.json"],
        "expectedOutputs": ["DataAssets/Database/Areas/Localization/_manifest.json"],
    },
    {
        "key": "dungeon_loc", "label": "Dungeon Localization",
        "builder": build_dungeon_localization, "requires": ["all_dungeons"], "produces": None,
        "rawInputs": ["Localization/Game/*/Game.json"],
        "expectedOutputs": ["DataAssets/Database/Dungeons/Localization/_manifest.json"],
    },
    {
        "key": "gate_loc", "label": "Gate Localization",
        "builder": build_gate_localization, "requires": ["all_gates"], "produces": None,
        "rawInputs": ["Localization/Game/*/Game.json"],
        "expectedOutputs": ["DataAssets/Database/Gates/Localization/_manifest.json"],
    },
    {
        "key": "monster_drop_loc", "label": "Monster Drop Localization",
        "builder": build_monster_drop_localization, "requires": ["all_monster_drops"], "produces": None,
        "rawInputs": ["Localization/Game/*/Game.json"],
        "expectedOutputs": ["DataAssets/Database/MonsterDrops/Localization/_manifest.json"],
    },
    {
        "key": "monster_stats", "label": "Monsters > Stats (Levels/HP)",
        "builder": build_monster_stats, "requires": [], "produces": "all_monster_stats",
        "rawInputs": ["Blueprints/Characters/Enemies/**/BP_E*.json", "Blueprints/Characters/Enemies/**/Datas/CT_E*.json"],
        "expectedOutputs": ["DataAssets/Database/MonsterStats/MonsterStats.json", "DataAssets/Database/MonsterStats/_index.json"],
    },
    {
        "key": "ailment_loc", "label": "Ailment Localization",
        "builder": build_ailment_localization, "requires": ["all_ailments"], "produces": None,
        "rawInputs": ["Localization/Game/*/Game.json"],
        "expectedOutputs": ["DataAssets/Database/Ailments/Localization/_manifest.json"],
    },
    {
        "key": "chest_loc", "label": "Chest Localization",
        "builder": build_chest_localization, "requires": ["all_chests"], "produces": None,
        "rawInputs": ["Localization/Game/*/Game.json"],
        "expectedOutputs": ["DataAssets/Database/Chests/Localization/_manifest.json"],
    },
    {
        # Combines Recipes/Chests/Drops/Shops (all already built) into
        # one per-item cross-reference -- see build_item_sources'
        # docstring. Requires every section whose output it reads.
        "key": "item_sources", "label": "Items > Sources & Crafting",
        "builder": build_item_sources,
        "requires": ["all_weapons", "all_armor", "all_items", "all_recipes", "all_chests", "all_monster_drops", "all_shops"],
        "produces": "all_item_sources",
        "rawInputs": [],
        "expectedOutputs": ["DataAssets/Database/ItemSources/ItemSources.json", "DataAssets/Database/ItemSources/_index.json"],
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
        # The CHR/ folder's section at last (deferred per the roadmap
        # reshuffle until the asset exports landed). ITM/ is included
        # -- shield/weapon skeletal meshes live there.
        "key": "asset_skeletons", "label": "Asset Inspector (Skeletons)",
        "builder": build_asset_skeletons, "requires": [], "produces": "all_skeletons",
        "rawInputs": ["CHR/**/SK_*.json"],
        "expectedOutputs": ["DataAssets/_AssetInspector/Skeletons.json"],
    },
    {
        "key": "asset_animations", "label": "Asset Inspector (Animations)",
        "builder": build_asset_animations, "requires": [], "produces": "all_animations",
        "rawInputs": ["ANM/**/*.json"],
        "expectedOutputs": ["DataAssets/_AssetInspector/Animations.json"],
    },
    {
        "key": "asset_inspector_index", "label": "Asset Inspector Index",
        "builder": build_asset_inspector_index, "requires": ["all_materials", "all_meshes", "all_skeletons", "all_animations"], "produces": None,
        "rawInputs": [],
        "expectedOutputs": ["DataAssets/_AssetInspector/_index.json"],
    },
    {
        "key": "wwise_audio", "label": "Wwise Audio Index",
        "builder": build_wwise_audio, "requires": [], "produces": None,
        "rawInputs": ["WwiseAudio/Events/**/*.json"],
        "expectedOutputs": ["DataAssets/_WwiseAudio/_index.json", "DataAssets/_WwiseAudio/events.json"],
    },
    {
        # User-content storage init -- the ONLY section whose outputs
        # live at the project root (note the "//" prefix convention in
        # expectedOutputs). Create-only: safe to re-run forever.
        "key": "guides_init", "label": "Modding Guides Init",
        "builder": build_guides_init, "requires": [], "produces": None,
        "rawInputs": [],
        "expectedOutputs": ["//guides/manifest.json", "//guides/getting-started-installing-unreal-engine.md"],
    },
]


# ----------------------------------------------------------------------
# Focus builds
#
# The pipeline grew to 44 sections, and a full run (which now includes
# the Maps/DNG level scans and the full DT/BP/Asset/Wwise walks) takes
# minutes, not seconds -- long enough that the Build Dashboard's
# original run-to-completion-in-one-HTTP-request rebuild endpoint
# started timing out (a real 504 from a real deployment). Focus builds
# keep the single full run as-is, and add named bundles of related
# sections so day-to-day work rebuilds ONLY what's being worked on.
#
# "Retaining previous calculations" falls out of how the pipeline has
# always worked: every section writes its own output files and never
# deletes a sibling's, so running a subset leaves everything else on
# disk exactly as the last build left it. What focus builds ADD is
# dependency resolution: a selection is transitively expanded so that
# any section whose `requires` names a context value gets its producer
# section included automatically (e.g. selecting `monster_drops` pulls
# in `weapons` + `armor`, selecting `dungeon_loc` pulls in `dungeons`
# which pulls in `areas`). This also upgrades --only=<key>: it used to
# fail outright on any section with requires (a documented limitation
# since the Build Dashboard was built); it now auto-includes the
# prerequisites and PRINTS what it added, so nothing happens silently.
# ----------------------------------------------------------------------

FOCUS_GROUPS = {
    # name -> {label, sections} -- sections may be listed in any order;
    # execution always follows PIPELINE_SECTIONS order after expansion.
    "world": {
        "label": "World (Lore/Towns/Quests/Areas/Dungeons/Gates)",
        "sections": ["lore", "towns", "quests", "areas", "dungeons", "gates", "map_icons", "world_map", "static_maps",
                     "lore_loc", "town_loc", "quest_loc", "area_loc", "dungeon_loc", "gate_loc"],
    },
    "monsters": {
        "label": "Monsters (database/Spawns/Drops/Stats)",
        "sections": ["monsters", "monster_spawns", "monster_drops",
                     "monster_loc", "monster_drop_loc", "monster_stats"],
    },
    "items": {
        "label": "Items (Catalog/Recipes)",
        "sections": ["items", "recipes", "shops", "chests", "item_loc", "recipe_loc", "chest_loc", "item_sources"],
    },
    "equipment": {
        "label": "Equipment (Weapons/Armor/Sword Skills/MODs)",
        "sections": ["weapons", "armor", "sword_skills",
                     "weapon_armor_loc", "sword_skill_loc",
                     "peculiar_mods", "ex_mod_pool", "mod_coverage", "mod_loc", "ex_mod_loc"],
    },
    "characters": {
        "label": "Characters (Partners/Customization/Player)",
        "sections": ["characters", "partner_stats", "avatar_customize", "player_config", "attribute_modifications",
                     "npcs", "active_skills", "ailments",
                     "character_loc", "partner_skill_loc", "ailment_loc"],
    },
    "inspectors": {
        "label": "Inspectors (DT/BP/Asset)",
        "sections": ["dt_inspector", "bp_inspector",
                     "asset_materials", "asset_meshes", "asset_skeletons", "asset_animations",
                     "asset_inspector_index"],
    },
    "audio": {
        "label": "Wwise Audio",
        "sections": ["wwise_audio"],
    },
    "textures": {
        "label": "Textures & Icons",
        "sections": ["textures", "map_icons"],
    },
    "guides": {
        "label": "Modding Guides Init (folders + starter files)",
        "sections": ["guides_init"],
    },
}


def resolve_selection(target_keys):
    """
    Expands a set of section keys with their transitive prerequisite
    PRODUCER sections (via the requires/produces graph), returning
    (ordered_keys, added_keys) where ordered_keys follows
    PIPELINE_SECTIONS order and added_keys is what dependency
    resolution pulled in beyond the request -- callers print it so
    auto-inclusion is never silent. Unknown keys raise with the full
    valid list, same fail-loudly stance as the rest of the runner.
    """
    by_key = {s["key"]: s for s in PIPELINE_SECTIONS}
    producer_of = {s["produces"]: s["key"] for s in PIPELINE_SECTIONS if s["produces"]}
    unknown = [k for k in target_keys if k not in by_key]
    if unknown:
        raise ValueError(f"Unknown section key(s) {unknown}; valid keys: {sorted(by_key)}")

    selected = set()
    stack = list(target_keys)
    while stack:
        key = stack.pop()
        if key in selected:
            continue
        selected.add(key)
        for req in by_key[key]["requires"]:
            producer = producer_of.get(req)
            if producer is None:
                raise ValueError(f"Section '{key}' requires '{req}' but no section produces it")
            if producer not in selected:
                stack.append(producer)

    ordered = [s["key"] for s in PIPELINE_SECTIONS if s["key"] in selected]
    added = sorted(selected - set(target_keys))
    return ordered, added


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

    def run_selected(self, target_keys, verbose=True):
        """
        Runs an arbitrary (non-contiguous) selection of sections in
        PIPELINE_SECTIONS order, after expanding it with transitive
        prerequisite producers via resolve_selection(). This is what
        backs --group=<name> and the dependency-resolving upgrade of
        --only=<key>; unlike run()'s contiguous start/stop range,
        nothing OUTSIDE the expanded selection executes, so a focus
        build never wastes time on unrelated sections and never
        touches their outputs on disk ("retain previous
        calculations").
        """
        ordered, added = resolve_selection(target_keys)
        if verbose and added:
            print(f"Auto-including prerequisite section(s): {', '.join(added)}")
        by_key = {s["key"]: s for s in self.sections}
        selected_sections = [by_key[k] for k in ordered]
        sub_runner = PipelineRunner(sections=selected_sections)
        sub_runner.context = self.context
        try:
            return sub_runner.run(verbose=verbose)
        finally:
            # surface the sub-run's progress for main()'s failure
            # tracking, exactly like run() does on self
            self.last_results = sub_runner.last_results


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
        # A "//"-prefixed entry is PROJECT-ROOT-relative rather than
        # Content/ROD-relative -- added for the guides_init section,
        # whose outputs (guides/, uploads/) are user-content folders
        # that deliberately live OUTSIDE the game-data tree.
        if rel_path.startswith("//"):
            full_path = os.path.join(PROJECT_ROOT, rel_path[2:])
            results.append({"path": rel_path[2:], "present": os.path.exists(full_path)})
        else:
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

    # Focus groups are exposed here so the Build Dashboard renders its
    # focus-build buttons from the SAME registry the CLI runs -- the
    # introspect-don't-duplicate principle the dashboard was built on.
    groups_report = {}
    for name, g in FOCUS_GROUPS.items():
        ordered, added = resolve_selection(g["sections"])
        groups_report[name] = {"label": g["label"], "sections": ordered, "autoIncluded": added}
    return {"sections": sections_report, "overview": overview, "groups": groups_report}


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
    group_key = None
    status_mode = False
    for arg in sys.argv[1:]:
        if arg.startswith("--only="):
            only_key = arg.split("=", 1)[1]
        elif arg.startswith("--from="):
            from_key = arg.split("=", 1)[1]
        elif arg.startswith("--group="):
            group_key = arg.split("=", 1)[1]
        elif arg == "--status":
            status_mode = True
        elif arg == "--status-cached":
            status_mode = "cached"

    if status_mode:
        import io
        import contextlib
        import datetime

        if status_mode == "cached":
            if os.path.exists(LAST_PIPELINE_STATUS_PATH):
                # Serve the last computed report instantly -- it carries
                # generatedAt + cached:true so the dashboard can say WHEN
                # these checks were real rather than implying they're live.
                report = load_json(LAST_PIPELINE_STATUS_PATH)
                report["cached"] = True
                print(json.dumps(report))
                return
            # No cache yet (first load on a fresh instance): return an
            # instant, honest "no checks computed yet" report rather
            # than silently falling into the minutes-long fresh compute
            # -- which is exactly the slow path that 500/504'd and that
            # --status-cached exists to avoid. Focus groups are still
            # included (resolve_selection is instant) so the dashboard's
            # buttons work before the first check run.
            groups_report = {}
            for name, g in FOCUS_GROUPS.items():
                ordered, added = resolve_selection(g["sections"])
                groups_report[name] = {"label": g["label"], "sections": ordered, "autoIncluded": added}
            print(json.dumps({
                "sections": [], "overview": None, "groups": groups_report,
                "cached": True, "neverComputed": True, "generatedAt": None,
            }))
            return

        captured = io.StringIO()
        with contextlib.redirect_stdout(captured):
            report = get_pipeline_status()
        # Builders' own print() calls (progress lines, coverage notes)
        # go to `captured` and are discarded here -- printing them
        # alongside the JSON would corrupt it for any caller parsing
        # stdout as JSON (confirmed this was happening before this fix:
        # every section's internal print() calls were interleaving with
        # the final json.dumps(), making the output unparseable).
        report["generatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        report["cached"] = False
        save_json(LAST_PIPELINE_STATUS_PATH, report)
        print(json.dumps(report))
        return

    runner = PipelineRunner()
    if group_key:
        if group_key not in FOCUS_GROUPS:
            print(f"Unknown focus group '{group_key}'. Available: {', '.join(FOCUS_GROUPS)}")
            sys.exit(2)
        mode = f"group:{group_key}"
    elif only_key:
        mode = f"only:{only_key}"
    elif from_key:
        mode = f"from:{from_key}"
    else:
        mode = "full"

    try:
        if group_key:
            runner.run_selected(FOCUS_GROUPS[group_key]["sections"])
        elif only_key:
            # Dependency-resolving since focus builds were added: a
            # section with `requires` auto-includes its producer(s),
            # printed by run_selected -- previously this exact call
            # failed outright on such sections (documented limitation).
            runner.run_selected([only_key])
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
