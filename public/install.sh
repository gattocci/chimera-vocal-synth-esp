#!/bin/sh
# Install CHIMERA, a voice instrument, as CLAP, VST3 and AU plugins for this user on macOS.
#
#   curl -fsSL https://chimera.audio/install.sh | sh
#   curl -fsSL https://chimera.audio/install.sh | sh -s -- --formats clap,vst3
#   curl -fsSL https://chimera.audio/install.sh | sh -s -- --version 0.1.0
#   curl -fsSL https://chimera.audio/install.sh | sh -s -- --uninstall
#
# It reads the release's manifest.json, downloads the zip it names, checks the zip's SHA-256, and
# copies the plugins into ~/Library/Audio/Plug-Ins (no sudo). Source:
# https://github.com/jamesondh/chimera-vocal-synth (public/install.sh)
set -eu

repo=jamesondh/chimera-vocal-synth
manifest=${CHIMERA_MANIFEST:-https://github.com/$repo/releases/latest/download/manifest.json}
formats=clap,vst3,au
action=install

say() { printf '%s\n' "$*"; }
die() { printf 'chimera: %s\n' "$*" >&2; exit 1; }
usage() {
  cat << 'EOF'
Install CHIMERA's CLAP, VST3 and AU plugins into ~/Library/Audio/Plug-Ins.

  --formats LIST   only these, of clap, vst3 and au (default: all three)
  --version X      that release instead of the latest
  --uninstall      remove them
EOF
}

while [ $# -gt 0 ]; do
  case $1 in
    --formats) [ $# -ge 2 ] || die "--formats needs a list, like clap,vst3,au"; formats=$2; shift 2 ;;
    --formats=*) formats=${1#*=}; shift ;;
    --version) [ $# -ge 2 ] || die "--version needs a version, like 0.1.0"; manifest="https://github.com/$repo/releases/download/plugin-v$2/manifest.json"; shift 2 ;;
    --version=*) manifest="https://github.com/$repo/releases/download/plugin-v${1#*=}/manifest.json"; shift ;;
    --uninstall) action=uninstall; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option $1 (--formats LIST, --version X, --uninstall)" ;;
  esac
done

[ "$(uname -s)" = Darwin ] || die "this installer is for macOS. Windows and Linux builds aren't released yet: https://chimera.audio/plugin/"

plugins="$HOME/Library/Audio/Plug-Ins"
# where each format goes, and its bundle in the zip
dest() {
  case $1 in
    clap) say "$plugins/CLAP/CHIMERA.clap" ;;
    vst3) say "$plugins/VST3/CHIMERA.vst3" ;;
    au) say "$plugins/Components/CHIMERA.component" ;;
    *) die "unknown format $1 (clap, vst3, au)" ;;
  esac
}
chosen=$(say "$formats" | tr ',' ' ')
for f in $chosen; do dest "$f" > /dev/null; done
[ -n "$chosen" ] || die "no formats chosen"

# the AU registry keeps what it has seen; restarting it makes hosts notice the change
refresh_au() {
  case " $chosen " in *" au "*) killall -9 AudioComponentRegistrar 2> /dev/null || true ;; esac
}

if [ "$action" = uninstall ]; then
  for f in $chosen; do
    d=$(dest "$f")
    if [ -e "$d" ]; then rm -rf "$d" && say "removed $d"; fi
  done
  refresh_au
  say "CHIMERA is uninstalled. Rescan plugins in your DAW."
  exit 0
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM
curl -fsSL "$manifest" -o "$tmp/manifest.json" || die "couldn't download $manifest"
# a string from the manifest, by its path ("platforms.macos.url"): JSON.parse in JavaScript for
# Automation, on every macOS since 10.10 (plutil reads JSON only on recent ones)
cat > "$tmp/field.js" << 'JS'
function run(argv) {
  ObjC.import("Foundation");
  const text = ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null));
  let v = JSON.parse(text);
  for (const k of argv[1].split(".")) v = v == null ? undefined : v[k];
  return v == null ? "" : String(v);
}
JS
field() {
  v=$(osascript -l JavaScript "$tmp/field.js" "$tmp/manifest.json" "$1" 2> /dev/null) || true
  [ -n "$v" ] || die "the manifest has no $1"
  say "$v"
}
version=$(field version)
url=$(field platforms.macos.url)
sha=$(field platforms.macos.sha256)

say "Downloading CHIMERA $version..."
curl -fL --progress-bar "$url" -o "$tmp/CHIMERA.zip" || die "couldn't download $url"
got=$(shasum -a 256 "$tmp/CHIMERA.zip" | cut -d' ' -f1)
[ "$got" = "$sha" ] || die "the download's checksum is $got, not the manifest's $sha: nothing was installed"
ditto -x -k "$tmp/CHIMERA.zip" "$tmp/unzipped"

bundle() { say "$tmp/unzipped/CHIMERA/$(basename "$(dest "$1")")"; }
# every bundle checked before any is copied, so a bad download installs nothing
for f in $chosen; do
  src=$(bundle "$f")
  [ -d "$src" ] || die "the download has no $(basename "$src"): nothing was installed"
  codesign --verify --strict "$src" 2> /dev/null || die "$(basename "$src")'s signature doesn't verify: nothing was installed"
done

# Each new bundle is copied in beside the old one first (hidden, and not named like a plugin, so a
# host scanning meanwhile ignores it); only when every copy has worked are the old ones swapped out.
# A failed copy leaves the installed plugins as they were. A host with the old one loaded keeps it
# until it restarts: removing a bundle doesn't disturb a binary in use, overwriting one would.
staged() { say "$(dirname "$(dest "$1")")/.$(basename "$(dest "$1")").installing"; }
unstage() { for f in $chosen; do rm -rf "$(staged "$f")"; done; }
trap 'unstage; rm -rf "$tmp"' EXIT INT TERM
for f in $chosen; do
  mkdir -p "$(dirname "$(dest "$f")")"
  rm -rf "$(staged "$f")"
  ditto "$(bundle "$f")" "$(staged "$f")" || die "couldn't copy $(basename "$(dest "$f")") into $(dirname "$(dest "$f")"): nothing was changed"
done
say "CHIMERA $version is installed:"
for f in $chosen; do
  d=$(dest "$f")
  rm -rf "$d"
  mv "$(staged "$f")" "$d"
  say "  $d"
done
refresh_au
say "Rescan plugins in your DAW, and put CHIMERA on an instrument track."
