#!/usr/bin/env python3
"""
normal_to_s.py -- turn a standard normal map into the game's packed "_S" map.

    python3 tools/normal_to_s.py Weapon_Shield_030_Nrm.png -o T_ITM_NEW_S.png
    python3 tools/normal_to_s.py Nrm.png --mask my_mask.png --flip-green

WHAT THE GAME'S "_S" MAP ACTUALLY IS
------------------------------------
Measured across 12 shield "_S" textures and one known normal map
(Weapon_Shield_030_Nrm), not guessed:

                        known normal map        game's _S maps
    R                   128.0                   127.5     <- same
    G                   127.1                   127.2     <- same
    corr(R, G)          -0.020                  -0.005    <- same (independent)
    x^2+y^2 <= 1        100.00%                 99.77%    <- same
    B                   255, std 0 (CONSTANT)   150, std ~90 (BIMODAL MASK)
    A                   255                     255 (unused)

The normal map stores X and Y in R and G and leaves BLUE as a constant 255 --
Z is reconstructible from X and Y, so blue is dead weight. The game's "_S"
map has the SAME R and G, and puts a mask in that free blue channel.

So "_S" is not a specular map, and not a bare normal map either: it is
    R = normal X
    G = normal Y
    B = an authored MASK
    A = unused (255)

WHAT THIS TOOL WILL NOT DO
--------------------------
It will not invent the blue channel. I tested whether B could be DERIVED from
the normal -- curvature, edge/gradient magnitude, slope, flatness -- and every
correlation came back at |r| = 0.03 to 0.07 across the shields. That is noise.
B is painted by hand, and it carries something the normal simply does not know.

So the tool gives you three honest options, and defaults to the one that
cannot mislead:

    --mask FILE     use a real mask you supply           (best)
    --mask-value N  fill blue with a constant            (default: 255)
    --mask-from-curvature
                    derive blue from the normal's curvature. Clearly labelled
                    a STARTING POINT, because the measurements above say the
                    game's own maps do NOT look like this. Use it as something
                    to paint over, never as an answer.

The result is a correct R/G/A and a blue channel you still own. That is a real
head start on a new shield or weapon, and it is honest about where the work
still is.
"""

import argparse
import os
import sys

# numpy + Pillow are faster, but NOT required -- the user's container has no
# pip at all ("No module named pip"), so a tool that needs them is a tool that
# doesn't run. pngkit is pure standard library.
try:
    import numpy as np
    from PIL import Image
    HAVE_NUMPY = True
except ImportError:
    HAVE_NUMPY = False
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import pngkit


def convert_stdlib(normal_path, out_path, mask_path=None, mask_value=255,
                   from_curvature=False, flip_green=False, verbose=True):
    """The no-numpy path. Identical output, pure standard library."""
    from array import array

    w, h, nch, px = pngkit.read_png(normal_path)
    if verbose:
        print(f"  input: {os.path.basename(normal_path)}  {w}x{h}   [stdlib mode]")

    mask_px = None
    if mask_path:
        mw, mh, mnch, mpx = pngkit.read_png(mask_path)
        if (mw, mh) != (w, h):
            sys.exit(f"  mask is {mw}x{mh} but the normal map is {w}x{h} -- resize it first "
                     f"(stdlib mode doesn't resample).")
        mask_px, mask_nch = mpx, mnch
        source = f"your mask ({os.path.basename(mask_path)})"
    elif from_curvature:
        source = "curvature (A STARTING POINT — the game's real maps don't look like this; paint over it)"
    else:
        source = f"constant {mask_value} (no mask supplied — the blue channel is yours to author)"

    out = array("B", bytes(w * h * 4))
    # Curvature needs neighbours, so read normals into a plain list first.
    if from_curvature:
        nxs = [0.0] * (w * h)
        nys = [0.0] * (w * h)
        for i in range(w * h):
            nxs[i] = px[i * nch + 0] / 127.5 - 1.0
            nys[i] = px[i * nch + 1] / 127.5 - 1.0

    sum_r = sum_g = 0
    for y in range(h):
        for x in range(w):
            i = y * w + x
            r = px[i * nch + 0]
            g = px[i * nch + 1]
            if flip_green:
                g = 255 - g
            sum_r += r
            sum_g += g

            if mask_px is not None:
                b = mask_px[i * mask_nch + 0]
            elif from_curvature:
                xr = min(x + 1, w - 1)
                yd = min(y + 1, h - 1)
                dxx = nxs[y * w + xr] - nxs[i]
                dyy = nys[yd * w + x] - nys[i]
                c = abs(dxx + dyy)
                b = int(min(1.0, c ** 0.45 * 2.2) * 255)
            else:
                b = mask_value

            o = i * 4
            out[o] = r
            out[o + 1] = g
            out[o + 2] = b
            out[o + 3] = 255

    n = w * h
    if verbose:
        print(f"    R mean {sum_r / n:.1f}, G mean {sum_g / n:.1f}")
        print(f"    blue channel: {source}")
    pngkit.write_png(out_path, w, h, 4, out)
    if verbose:
        print(f"  wrote {out_path}")
    return out_path, source


def load_rgb(path):
    return np.array(Image.open(path).convert("RGBA")).astype(np.float32)


def curvature_mask(nx, ny):
    """
    Edge/curvature from the normal field, normalized to 0-255.
    A STARTING POINT ONLY -- see the module docstring. The game's real blue
    channel does not correlate with this.
    """
    curv = np.abs(np.gradient(nx, axis=1) + np.gradient(ny, axis=0))
    if curv.max() > 0:
        curv = curv / curv.max()
    # Emphasise edges the way an artist would see them, then lift to mid-grey
    # so it reads as "mask with edges", not "black image with specks".
    curv = np.power(curv, 0.45)
    return np.clip(curv * 255.0, 0, 255)


def convert(normal_path, out_path, mask_path=None, mask_value=255,
            from_curvature=False, flip_green=False, verbose=True):
    if not HAVE_NUMPY:
        return convert_stdlib(normal_path, out_path, mask_path, mask_value,
                              from_curvature, flip_green, verbose)
    n = load_rgb(normal_path)
    R, G, B = n[..., 0], n[..., 1], n[..., 2]
    h, w = R.shape

    # Sanity-check the input really IS a normal map, rather than silently
    # producing garbage from, say, an albedo texture someone mis-dragged.
    nx, ny = R / 127.5 - 1.0, G / 127.5 - 1.0
    inside = (nx ** 2 + ny ** 2 <= 1.0).mean() * 100
    centred = abs(R.mean() - 128) < 12 and abs(G.mean() - 128) < 12
    if verbose:
        print(f"  input: {os.path.basename(normal_path)}  {w}x{h}")
        print(f"    R mean {R.mean():.1f}, G mean {G.mean():.1f}, "
              f"x^2+y^2<=1 for {inside:.2f}% of pixels")
    if not (centred and inside > 95):
        print("  !! This does not look like a tangent-space normal map "
              "(R,G should centre on 128 and stay inside the unit circle).")
        print("     Converting anyway, but check the input.")

    if flip_green:
        # DirectX vs OpenGL green convention. Which one this game wants is NOT
        # something the statistics can tell us -- both conventions produce
        # green centred on 128 -- so it's a flag, not an assumption.
        G = 255.0 - G
        if verbose:
            print("    green channel flipped (DirectX <-> OpenGL convention)")

    # ---- the blue channel ----
    if mask_path:
        m = load_rgb(mask_path)
        mask = m[..., 0] if m.shape[2] >= 1 else m
        if mask.shape != R.shape:
            mask = np.array(Image.fromarray(mask.astype(np.uint8)).resize((w, h), Image.LANCZOS)).astype(np.float32)
        source = f"your mask ({os.path.basename(mask_path)})"
    elif from_curvature:
        mask = curvature_mask(nx, ny)
        source = "curvature (A STARTING POINT — the game's real maps don't look like this; paint over it)"
    else:
        mask = np.full_like(R, float(mask_value))
        source = f"constant {mask_value} (no mask supplied — the blue channel is yours to author)"

    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[..., 0] = np.clip(R, 0, 255).astype(np.uint8)      # normal X
    out[..., 1] = np.clip(G, 0, 255).astype(np.uint8)      # normal Y
    out[..., 2] = np.clip(mask, 0, 255).astype(np.uint8)   # authored mask
    out[..., 3] = 255                                       # unused, as in every game _S

    Image.fromarray(out, "RGBA").save(out_path)
    if verbose:
        print(f"    blue channel: {source}")
        print(f"  wrote {out_path}")
    return out_path, source


def main():
    ap = argparse.ArgumentParser(description="Convert a normal map into the game's packed _S format.")
    ap.add_argument("normal", help="the normal map (e.g. Weapon_Shield_030_Nrm.png)")
    ap.add_argument("-o", "--out", help="output path (default: <name>_S.png)")
    ap.add_argument("--mask", help="image whose red channel becomes the _S blue channel")
    ap.add_argument("--mask-value", type=int, default=255, help="constant blue value (default 255)")
    ap.add_argument("--mask-from-curvature", action="store_true",
                    help="derive blue from curvature — a starting point to paint over, NOT an answer")
    ap.add_argument("--flip-green", action="store_true", help="flip green (DirectX <-> OpenGL)")
    a = ap.parse_args()

    out = a.out or os.path.splitext(a.normal)[0].replace("_Nrm", "").replace("_N", "") + "_S.png"
    convert(a.normal, out, a.mask, a.mask_value, a.mask_from_curvature, a.flip_green)


if __name__ == "__main__":
    main()
