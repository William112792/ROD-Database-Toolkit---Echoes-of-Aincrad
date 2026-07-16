#!/usr/bin/env python3
"""
analyze_texture_maps.py -- work out what a game texture's channels actually
carry, instead of guessing from how it looks.

    python3 tools/analyze_texture_maps.py <file_or_directory> [...]

Point it at a folder of item/character textures and it will report, per
texture, which of these each channel matches:

  * a tangent-space NORMAL's X/Y  -- centred on 128, uncorrelated with each
    other, and satisfying x^2 + y^2 <= 1 once remapped to [-1,1]
  * a MASK                        -- bimodal, sitting at the extremes
  * CONSTANT                      -- carries nothing (very common in alpha)
  * a continuous GRADIENT         -- a real scalar map (roughness, AO, ...)

WHY THIS EXISTS
---------------
The item shading here is MSM_CelSf (a custom cel shading model) fed by just
two per-asset textures -- Texture_BC and Texture_S -- plus a shared
reflection cubemap and detail maps. There is NO _N normal map anywhere in
the item tree, which immediately raises the question of where the normal
data lives. "_S" LOOKS like a specular map from its name and like a normal
map from its colour, and it is neither of those things by default -- so
guessing from appearance is exactly how you get it wrong.

A CAUTION THIS SCRIPT PRINTS FOR YOU: "_S" is ALSO used as a UI-sprite
suffix in this game (T_ItemCategoryIcon_*_S, T_ClassIcon_S ...), where it
means something entirely unrelated. Those are not material maps. Mixing them
into an average will quietly poison your conclusions -- ask me how I know.
Anything that looks like a UI sprite is flagged and excluded from the
summary.

WHAT THE EVIDENCE LOOKED LIKE ON T_ITM_SH001003_S (2048x2048):
    R  mean 127.1  std 16.8   |
    G  mean 127.1  std 23.1   |  both centred exactly on 128, corr(R,G) = -0.006
    B  mean 119.0  std 103.9  |  bimodal: 38% at ~0, 46% at 200+
    A  254-255 everywhere     |  carries nothing
    x^2+y^2 <= 1 for 99.92% of pixels
  -> R,G behave like a normal map's X/Y; B is an INDEPENDENT mask
     (corr with the reconstructed Z is only +0.08, and it does not track
     albedo, so it is not a colour/material segmentation either).
"""

import os
import sys

# numpy + Pillow are FASTER, but they are not required. The user's container
# has no pip at all -- not "pip refuses", literally "No module named pip" --
# so a tool that needs them is a tool that does not run. pngkit is pure
# standard library and always works.
try:
    import numpy as np
    from PIL import Image
    HAVE_NUMPY = True
except ImportError:
    HAVE_NUMPY = False
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import pngkit


UI_HINTS = ("icon", "classicon", "namebg", "_ui_", "widget", "button", "frame")


def classify(ch):
    """Describe what a single 8-bit channel looks like."""
    mean, std = ch.mean(), ch.std()
    n = ch.size
    if std < 1.0:
        return f"CONSTANT ({mean:.0f}) -- carries nothing"
    low = (ch < 16).mean()
    high = (ch > 240).mean()
    if low + high > 0.55:
        return f"MASK -- bimodal ({low*100:.0f}% at ~0, {high*100:.0f}% at ~255)"
    if abs(mean - 128) < 6 and std < 45:
        return f"NORMAL-LIKE -- centred on 128 (std {std:.0f})"
    return f"GRADIENT -- mean {mean:.0f}, std {std:.0f}"


def analyze_stdlib(path, step=4):
    """
    The no-numpy path. Same measurements, pure standard library.

    Samples every `step`-th pixel: a mean over 260k samples of a 2048x2048
    texture differs from the full-image mean by well under 0.1 of a unit, and
    it turns half a minute of pure-Python arithmetic into about a second. The
    output says it sampled, so nobody mistakes it for an exhaustive pass.
    """
    w, h, nch, px = pngkit.read_png(path)
    name = os.path.basename(path)
    is_ui = any(hint in name.lower() for hint in UI_HINTS)

    ch = [pngkit.channel(px, nch, i, step) for i in range(nch)]
    labels = ["R", "G", "B", "A"][:nch]

    print(f"\n=== {name}  ({w}x{h})  [stdlib mode, sampling 1 in {step} pixels] ===")
    if is_ui:
        print("  !! looks like a UI sprite -- '_S' means something different here.")
        print("     NOT a material map. Excluded from the summary.")

    means = []
    for label, c in zip(labels, ch):
        mean, std = pngkit.stats(c)
        means.append(mean)
        print(f"  {label}: {classify_stats(mean, std, c)}")

    if nch >= 2:
        R, G = ch[0], ch[1]
        inside = sum(1 for i in range(len(R))
                     if ((R[i] / 127.5 - 1) ** 2 + (G[i] / 127.5 - 1) ** 2) <= 1.0) / len(R) * 100
        c_rg = pngkit.corr(R, G)
        print(f"  R,G as a normal's X,Y:  x^2+y^2 <= 1 for {inside:.2f}% of pixels; corr(R,G) = {c_rg:+.3f}")

        if nch >= 3:
            B = ch[2]
            z = array_like_z(R, G)
            c_bz = pngkit.corr(B, z)
            verdict = ("B TRACKS the reconstructed Z -- it may really be a normal map"
                       if c_bz > 0.6 else
                       "B is INDEPENDENT of the reconstructed Z -- a separate mask packed into blue")
            print(f"  corr(B, reconstructed Z) = {c_bz:+.3f}  ->  {verdict}")
        return None if is_ui else (inside, c_rg, 1.0)
    return None


def array_like_z(R, G):
    from array import array as _arr
    out = _arr("B", bytes(len(R)))
    for i in range(len(R)):
        nx = R[i] / 127.5 - 1.0
        ny = G[i] / 127.5 - 1.0
        v = 1.0 - (nx * nx + ny * ny)
        out[i] = int(max(0.0, v) ** 0.5 * 255)
    return out


def classify_stats(mean, std, vals):
    """Same verdicts as classify(), from summary statistics."""
    if std < 1.0:
        return f"CONSTANT ({mean:.0f}) -- carries nothing"
    n = len(vals)
    low = sum(1 for v in vals if v < 16) / n
    high = sum(1 for v in vals if v > 240) / n
    if low + high > 0.55:
        return f"MASK -- bimodal ({low*100:.0f}% at ~0, {high*100:.0f}% at ~255)"
    if abs(mean - 128) < 6 and std < 45:
        return f"NORMAL-LIKE -- centred on 128 (std {std:.0f})"
    return f"GRADIENT -- mean {mean:.0f}, std {std:.0f}"


def analyze(path):
    if not HAVE_NUMPY:
        return analyze_stdlib(path)
    img = Image.open(path).convert("RGBA")
    a = np.array(img).astype(np.float32)
    R, G, B, A = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    name = os.path.basename(path)
    is_ui = any(h in name.lower() for h in UI_HINTS)

    print(f"\n=== {name}  ({img.width}x{img.height}) ===")
    if is_ui:
        print("  !! looks like a UI sprite -- '_S' means something different here.")
        print("     NOT a material map. Excluded from the summary.")

    for label, ch in (("R", R), ("G", G), ("B", B), ("A", A)):
        print(f"  {label}: {classify(ch)}")

    # The normal-map test. Note honestly that it is a NECESSARY but not
    # sufficient condition: data clustered near 128 passes it trivially, so
    # it only means something alongside the "centred + uncorrelated" checks.
    nx, ny = R / 127.5 - 1.0, G / 127.5 - 1.0
    inside = (nx ** 2 + ny ** 2 <= 1.0).mean() * 100
    corr = float(np.corrcoef(R.ravel(), G.ravel())[0, 1]) if R.std() and G.std() else float("nan")
    print(f"  R,G as a normal's X,Y:  x^2+y^2 <= 1 for {inside:.2f}% of pixels; corr(R,G) = {corr:+.3f}")

    # Is B the normal's Z, or something else entirely?
    z = np.sqrt(np.clip(1 - (nx ** 2 + ny ** 2), 0, 1)) * 255
    if B.std() > 1:
        zc = float(np.corrcoef(B.ravel(), z.ravel())[0, 1])
        verdict = ("B TRACKS the reconstructed Z -- it may really be a normal map"
                   if zc > 0.6 else
                   "B is INDEPENDENT of the reconstructed Z -- a separate mask packed into blue")
        print(f"  corr(B, reconstructed Z) = {zc:+.3f}  ->  {verdict}")

    return None if is_ui else (inside, corr, A.std())


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)

    files = []
    for a in args:
        if os.path.isdir(a):
            for root, _d, names in os.walk(a):
                files += [os.path.join(root, n) for n in names
                          if n.lower().endswith((".png", ".tga", ".jpg"))]
        else:
            files.append(a)
    files.sort()
    if not files:
        sys.exit("No images found.")

    results = [r for r in (analyze(f) for f in files) if r]
    if len(results) > 1:
        arr = np.array(results)
        print(f"\n=== summary over {len(results)} material texture(s) "
              f"(UI sprites excluded) ===")
        print(f"  mean %pixels satisfying the normal constraint: {arr[:, 0].mean():.1f}%")
        print(f"  mean corr(R,G):                                {arr[:, 1].mean():+.3f}")
        print(f"  alpha carries data in "
              f"{(arr[:, 2] > 1).sum()}/{len(arr)} textures")
        print("\n  If R,G are consistently centred on 128 AND uncorrelated across many\n"
              "  assets, that is a normal map's X/Y -- artistic masks do not do that.\n"
              "  If they are not, this packing theory is wrong and should be dropped.")


if __name__ == "__main__":
    main()
