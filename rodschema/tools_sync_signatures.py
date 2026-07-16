#!/usr/bin/env python3
"""
tools_sync_signatures.py -- writes signatures.json back into
include/SDK/RODSignatures.h before a Windows build. Run from the
RODSchema folder root:  python tools_sync_signatures.py

Only the PATTERN STRINGS inside the existing map initializers are
rewritten (matched by target name); brand-new targets added in the JSON
are appended to the map their "kind" selects. The header's comments and
everything else are left untouched, so re-derivation notes survive.
"""
import json, re, sys, os

HDR = os.path.join("include", "SDK", "RODSignatures.h")
data = json.load(open("signatures.json", encoding="utf-8"))
h = open(HDR, encoding="utf-8").read()
cr = h.find("SignaturesCallResolve")

changed = 0
appended = []
for sig in data["signatures"]:
    target, pattern, kind = sig["target"], sig["pattern"], sig.get("kind", "direct")
    rx = re.compile(r'(\{\s*"' + re.escape(target) + r'"\s*,\s*\n?\s*")([0-9A-Fa-f? ]*)("\s*\})')
    m = rx.search(h)
    if m:
        if m.group(2).strip() != pattern:
            h = h[:m.start(2)] + pattern + h[m.end(2):]
            changed += 1
    else:
        appended.append((target, pattern, kind))

for target, pattern, kind in appended:
    # Append inside the right map: find that map's closing "};" after its name.
    anchor = "SignaturesCallResolve" if kind == "call-resolve" else "Signatures"
    pos = h.find(anchor)
    if pos == -1:
        sys.exit(f"Could not find map '{anchor}' in {HDR} to append {target}")
    close = h.find("};", pos)
    entry = f'            {{ "{target}",\n              "{pattern}" }},  // added via signatures.json\n'
    h = h[:close] + entry + h[close:]
    changed += 1

open(HDR, "w", encoding="utf-8").write(h)
print(f"Synced {changed} signature(s) into {HDR} ({len(appended)} appended). Build with build.ps1 on Windows (VS2022).")
