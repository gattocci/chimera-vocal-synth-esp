#!/usr/bin/env bash
# The files a release carries, from build.sh's bundles (signed and notarised by then, on CI), in
# out/release:
#
#   CHIMERA-macos.zip   a CHIMERA folder: the three bundles and a how-to
#   SHA256SUMS          the zip's checksum
#   manifest.json       what an installer needs (public/install.sh, or another tool): the version,
#                       the zip's address and checksum, and where each bundle goes
#
#   release.sh                 the manifest points at the GitHub release plugin-v<version>
#   release.sh --base URL      ... at URL instead (CI's install test uses a file:// one)
#   release.sh --publish TAG   then make the GitHub release TAG with them (CI, on a tag)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

repo=jamesondh/chimera-vocal-synth
version=$(sed -n '/^\[workspace.package\]/,/^\[/s/^version = "\(.*\)"/\1/p' Cargo.toml)
tag="plugin-v$version"
base="https://github.com/$repo/releases/download/$tag"
publish=""
while [ $# -gt 0 ]; do
  case $1 in
    --base) base=$2; shift 2 ;;
    --publish) publish=$2; shift 2 ;;
    *) echo "usage: release.sh [--base URL] [--publish TAG]" >&2; exit 2 ;;
  esac
done
if [ -n "$publish" ] && [ "$publish" != "$tag" ]; then
  echo "the tag $publish doesn't match the version in Cargo.toml ($version): tag $tag, or change the version" >&2
  exit 1
fi

out=out/release
rm -rf "$out" && mkdir -p "$out/CHIMERA"
for b in clap vst3 component; do
  ditto "target/bundled/CHIMERA.$b" "$out/CHIMERA/CHIMERA.$b"
done
cat > "$out/CHIMERA/How to install.txt" <<EOF
CHIMERA $version, a voice instrument: CLAP, VST3 and AU for macOS 11 or later.

Copy each plugin into its folder (in Finder: Go > Go to Folder, and paste the path):

  CHIMERA.clap       ~/Library/Audio/Plug-Ins/CLAP
  CHIMERA.vst3       ~/Library/Audio/Plug-Ins/VST3
  CHIMERA.component  ~/Library/Audio/Plug-Ins/Components

Then rescan plugins in your DAW and put CHIMERA on an instrument track.

Or in Terminal, without this download:  curl -fsSL https://chimera.audio/install.sh | sh

More: https://chimera.audio/plugin/
EOF
ditto -c -k --keepParent "$out/CHIMERA" "$out/CHIMERA-macos.zip"
rm -rf "$out/CHIMERA"

sha=$(shasum -a 256 "$out/CHIMERA-macos.zip" | cut -d' ' -f1)
echo "$sha  CHIMERA-macos.zip" > "$out/SHA256SUMS"
cat > "$out/manifest.json" <<EOF
{
  "schema": 1,
  "name": "CHIMERA",
  "id": "com.github.jamesondh.chimera",
  "version": "$version",
  "homepage": "https://chimera.audio/plugin/",
  "platforms": {
    "macos": {
      "url": "$base/CHIMERA-macos.zip",
      "sha256": "$sha",
      "minimum_system": "11.0",
      "architectures": ["arm64", "x86_64"],
      "bundles": [
        { "format": "clap", "path": "CHIMERA/CHIMERA.clap", "install": "~/Library/Audio/Plug-Ins/CLAP" },
        { "format": "vst3", "path": "CHIMERA/CHIMERA.vst3", "install": "~/Library/Audio/Plug-Ins/VST3" },
        { "format": "au", "path": "CHIMERA/CHIMERA.component", "install": "~/Library/Audio/Plug-Ins/Components" }
      ]
    }
  }
}
EOF
# (plutil -lint takes JSON for an invalid property list; install.sh reads it with JSON.parse too)
osascript -l JavaScript -e 'function run(a) { ObjC.import("Foundation"); JSON.parse(ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(a[0], $.NSUTF8StringEncoding, null))); return "manifest.json parses" }' "$PWD/$out/manifest.json" ||
  { echo "manifest.json isn't valid JSON" >&2; exit 1; }
ls -l "$out"

if [ -n "$publish" ]; then
  # sign.sh does nothing without its secrets (a fork's pull request), and an ad hoc signature passes
  # codesign --verify: a release has to show the Developer ID and Apple's stapled ticket itself
  for b in clap vst3 component; do
    bundle="target/bundled/CHIMERA.$b"
    signature=$(codesign -dvv "$bundle" 2>&1) || true
    grep -q '^Authority=Developer ID Application:' <<< "$signature" ||
      { echo "$bundle isn't signed with a Developer ID: not publishing" >&2; exit 1; }
    xcrun stapler validate "$bundle" > /dev/null || { echo "$bundle has no notarisation ticket: not publishing" >&2; exit 1; }
  done
  gh release create "$tag" "$out/CHIMERA-macos.zip" "$out/SHA256SUMS" "$out/manifest.json" \
    --repo "$repo" --title "CHIMERA plugin $version" --notes "CHIMERA $version as a CLAP, VST3 and AU instrument for macOS 11 or later (Apple silicon and Intel), signed and notarised.

Install in Terminal:

\`\`\`sh
curl -fsSL https://chimera.audio/install.sh | sh
\`\`\`

Or download CHIMERA-macos.zip below and follow its How to install.txt. More at https://chimera.audio/plugin/."
fi
