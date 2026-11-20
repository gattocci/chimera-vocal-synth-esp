#!/usr/bin/env bash
# public/install.sh as a user runs it, against this build's release files (release.sh, served as
# file:// URLs) and into a HOME of its own: all three formats, one, a checksum that doesn't match,
# and uninstalling. CI runs it on every push.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
here=crates/chimera-plugin/macos

"$here/release.sh" --base "file://$PWD/out/release"
manifest="file://$PWD/out/release/manifest.json"
home=$(mktemp -d)
plugins="$home/Library/Audio/Plug-Ins"
all=("$plugins/CLAP/CHIMERA.clap" "$plugins/VST3/CHIMERA.vst3" "$plugins/Components/CHIMERA.component")
failures=0
check() { # name, then a command that should succeed
  local name=$1
  shift
  if "$@"; then echo "ok   $name"; else echo "FAIL $name"; failures=$((failures + 1)); fi
}
installer() { HOME="$home" CHIMERA_MANIFEST="$manifest" sh public/install.sh "$@"; }
none() { for p in "${all[@]}"; do [ ! -e "$p" ] || return 1; done; }

installer
for p in "${all[@]}"; do
  check "installs $(basename "$p")" test -d "$p"
  check "$(basename "$p") verifies" codesign --verify --strict "$p"
done

installer --uninstall
check "uninstall removes all three" none

installer --formats clap
check "--formats clap installs the CLAP" test -d "${all[0]}"
check "and only the CLAP" test ! -e "${all[1]}" -a ! -e "${all[2]}"
installer --uninstall

# an update that can't finish leaves what was installed as it was: the VST3 folder read-only, so its
# copy fails after the CLAP's has been made
installer
echo old > "${all[0]}/old"
chmod a-w "$plugins/VST3"
check "an update that can't copy fails" bash -c '! HOME="$0" CHIMERA_MANIFEST="$1" sh public/install.sh 2> /dev/null' "$home" "$manifest"
chmod u+w "$plugins/VST3"
check "and leaves the CLAP it had" test -f "${all[0]}/old"
check "and the VST3" test -d "${all[1]}"
check "and nothing half-copied" bash -c '! ls -a "$0"/*/ | grep -q installing' "$plugins"
installer --uninstall

# a download that isn't what the manifest says installs nothing
sed 's/"sha256": "[0-9a-f]*"/"sha256": "0000"/' out/release/manifest.json > "$home/bad.json"
if HOME="$home" CHIMERA_MANIFEST="file://$home/bad.json" sh public/install.sh 2> "$home/err"; then
  check "a wrong checksum fails" false
else
  check "a wrong checksum fails, and says so" grep -q checksum "$home/err"
fi
check "and installs nothing" none

check "the manifest's version is Cargo.toml's" grep -q "\"version\": \"$(sed -n '/^\[workspace.package\]/,/^\[/s/^version = "\(.*\)"/\1/p' Cargo.toml)\"" out/release/manifest.json

rm -rf "$home"
[ "$failures" = 0 ] || { echo "$failures failed"; exit 1; }
