#!/usr/bin/env sh
# Fetches vgmstream-cli, which the toolkit uses to decode Wwise .wem for
# in-browser playback.
#
# WHY THIS IS NEEDED: every .wem in this game is Wwise Vorbis (format tag
# 0xFFFF -- verified across the export, not assumed). No browser plays it
# and ffmpeg cannot decode it ("no decoder found for: none"). vgmstream
# can. Without it the Wwise Audio view still lists everything and the
# DOWNLOAD buttons still work -- only Play is unavailable, and the app
# says so plainly instead of failing silently.
#
# The binary is NOT vendored into this repo: it's a third-party build with
# its own license and release cadence, and pinning a stale copy inside the
# toolkit would be worse than fetching the current one.
#
# Usage:   sh tools/get_vgmstream.sh
# Result:  tools/bin/vgmstream-cli   (the server auto-detects it there)
#
# In Docker, run this during image build, or install vgmstream on PATH:
#   RUN apt-get update && apt-get install -y ffmpeg unzip curl \
#    && sh tools/get_vgmstream.sh
# (ffmpeg is OPTIONAL -- with it, previews are re-encoded to Ogg, roughly
# 5x smaller than WAV. Without it, the WAV is served directly and browsers
# play that too.)

set -e
VERSION="${VGMSTREAM_VERSION:-r1980}"
DEST="$(cd "$(dirname "$0")" && pwd)/bin"
URL="https://github.com/vgmstream/vgmstream/releases/download/${VERSION}/vgmstream-linux-cli.zip"

mkdir -p "$DEST"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Fetching vgmstream ${VERSION}..."
curl -fsSL -o "$TMP/vgmstream.zip" "$URL"
unzip -o -q "$TMP/vgmstream.zip" -d "$TMP"

# The archive layout has changed between releases, so find the binary
# rather than assuming a path.
BIN="$(find "$TMP" -type f -name 'vgmstream*cli' | head -n 1)"
if [ -z "$BIN" ]; then
  echo "ERROR: no vgmstream CLI binary inside $URL" >&2
  echo "Check the release assets at https://github.com/vgmstream/vgmstream/releases" >&2
  exit 1
fi

cp "$BIN" "$DEST/vgmstream-cli"
chmod +x "$DEST/vgmstream-cli"

echo "Installed -> $DEST/vgmstream-cli"
"$DEST/vgmstream-cli" -V >/dev/null 2>&1 && echo "Works. Restart the Node server; Wwise Audio previews will play."
