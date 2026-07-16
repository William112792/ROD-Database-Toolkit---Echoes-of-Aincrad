#!/usr/bin/env python3
"""
pngkit.py -- read and write PNGs using nothing but the Python standard library.

WHY THIS EXISTS
---------------
The texture tools needed numpy and Pillow. In the user's container that turned
out to be unfixable by the usual routes:

  * `pip install` -- the app can't write to system site-packages
  * `pip install --break-system-packages` -- refused outright
  * `pip install --target tools/pylibs` -- "No module named pip".
    There IS no pip in that container.

At that point the honest conclusion is that the dependency itself is the bug.
A PNG is zlib-compressed scanlines with a five-filter predictor, and the
statistics the texture tools compute are sums and counts. None of that needs a
third-party library. `zlib`, `struct` and `array` ship with Python.

So the texture tools now use numpy/Pillow when they're available (they're
faster), and fall back to this when they aren't -- which means they work on any
Python 3, with no install step, forever.

SCOPE, stated plainly: 8-bit non-interlaced PNGs, greyscale/RGB/RGBA/palette.
That covers every texture in this game. It is not a general PNG library and
does not pretend to be.
"""

import struct
import zlib
from array import array


class PNGError(Exception):
    pass


def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def read_png(path):
    """
    -> (width, height, channels, pixels)

    `pixels` is a flat `array('B')` of length width*height*channels, in
    row-major order. Always 8-bit.
    """
    with open(path, "rb") as f:
        data = f.read()

    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise PNGError(f"{path}: not a PNG")

    pos = 8
    idat = bytearray()
    width = height = depth = color_type = None
    palette = None
    trns = None

    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        pos += 12 + length  # length + type + data + crc

        if ctype == b"IHDR":
            width, height, depth, color_type, comp, filt, interlace = struct.unpack(">IIBBBBB", chunk)
            if depth != 8:
                raise PNGError(f"{path}: only 8-bit PNGs supported (this one is {depth}-bit)")
            if interlace:
                raise PNGError(f"{path}: interlaced PNGs not supported")
        elif ctype == b"PLTE":
            palette = chunk
        elif ctype == b"tRNS":
            trns = chunk
        elif ctype == b"IDAT":
            idat += chunk
        elif ctype == b"IEND":
            break

    if width is None:
        raise PNGError(f"{path}: no IHDR")

    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(color_type)
    if channels is None:
        raise PNGError(f"{path}: unsupported colour type {color_type}")

    raw = zlib.decompress(bytes(idat))
    stride = width * channels

    # Undo the per-scanline filter. This is the only fiddly part of a PNG,
    # and it is 30 lines.
    out = bytearray(height * stride)
    prev = bytearray(stride)
    rpos = 0
    for y in range(height):
        ft = raw[rpos]
        rpos += 1
        line = bytearray(raw[rpos:rpos + stride])
        rpos += stride

        if ft == 0:
            pass
        elif ft == 1:  # Sub
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif ft == 2:  # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ft == 3:  # Average
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ft == 4:  # Paeth
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                c = prev[i - channels] if i >= channels else 0
                line[i] = (line[i] + _paeth(a, prev[i], c)) & 0xFF
        else:
            raise PNGError(f"{path}: bad filter type {ft}")

        out[y * stride:(y + 1) * stride] = line
        prev = line

    pixels = array("B", out)

    # Expand a palette to RGB/RGBA so callers only ever see real channels.
    if color_type == 3:
        if palette is None:
            raise PNGError(f"{path}: palette image with no PLTE")
        has_alpha = trns is not None
        nch = 4 if has_alpha else 3
        expanded = array("B", bytes(width * height * nch))
        for i, idx in enumerate(pixels):
            expanded[i * nch + 0] = palette[idx * 3 + 0]
            expanded[i * nch + 1] = palette[idx * 3 + 1]
            expanded[i * nch + 2] = palette[idx * 3 + 2]
            if has_alpha:
                expanded[i * nch + 3] = trns[idx] if idx < len(trns) else 255
        pixels, channels = expanded, nch

    return width, height, channels, pixels


def write_png(path, width, height, channels, pixels):
    """Write an 8-bit PNG. `pixels` is flat, row-major, width*height*channels."""
    color_type = {1: 0, 2: 4, 3: 2, 4: 6}.get(channels)
    if color_type is None:
        raise PNGError(f"unsupported channel count {channels}")

    stride = width * channels
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter 0 (None): we're compressing, not optimising
        raw += bytes(pixels[y * stride:(y + 1) * stride])

    def chunk(tag, payload):
        c = struct.pack(">I", len(payload)) + tag + payload
        return c + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 6)))
        f.write(chunk(b"IEND", b""))
    return path


def channel(pixels, channels, index, step=1):
    """
    Pull one channel out as an array('B').

    `step` samples every Nth pixel. Statistics over a 2048x2048 texture do not
    need all 4.2M pixels -- sampling 1-in-4 changes a mean by well under a
    tenth of a unit and makes pure-Python analysis take a second instead of
    half a minute. The tools say when they've sampled.
    """
    return array("B", pixels[index::channels * step])


def stats(vals):
    """mean and standard deviation, in one pass."""
    n = len(vals)
    if n == 0:
        return 0.0, 0.0
    total = 0
    sq = 0
    for v in vals:
        total += v
        sq += v * v
    mean = total / n
    var = max(0.0, sq / n - mean * mean)
    return mean, var ** 0.5


def corr(a, b):
    """Pearson correlation between two equal-length byte arrays."""
    n = min(len(a), len(b))
    if n == 0:
        return float("nan")
    sa = sb = saa = sbb = sab = 0
    for i in range(n):
        x, y = a[i], b[i]
        sa += x
        sb += y
        saa += x * x
        sbb += y * y
        sab += x * y
    num = n * sab - sa * sb
    den = ((n * saa - sa * sa) * (n * sbb - sb * sb)) ** 0.5
    return num / den if den else float("nan")
