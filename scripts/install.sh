#!/bin/sh
# Vibisual installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/Vibisual/vibisual/main/scripts/install.sh | sh
#
# Environment:
#   VIBISUAL_VERSION=v0.1.14   install a specific tag instead of the latest release
#   VIBISUAL_PREFIX=~/.local   where the AppImage goes on Linux (default: ~/.local/bin)
#
# The script downloads a published release asset over HTTPS from GitHub and hands
# it to your package manager. It never builds from source and never asks for a
# password unless your package manager needs one.

set -eu

REPO="Vibisual/vibisual"
API="https://api.github.com/repos/${REPO}/releases"
PREFIX="${VIBISUAL_PREFIX:-$HOME/.local}"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

need() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is required but was not found on PATH."
}

# sudo only when we are not already root and it exists.
sudo_if_needed() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    say "  (this step needs sudo)"
    sudo "$@"
  else
    die "this step needs root, but sudo is not available: $*"
  fi
}

need curl

if [ -n "${VIBISUAL_VERSION:-}" ]; then
  RELEASE_JSON=$(curl -fsSL "${API}/tags/${VIBISUAL_VERSION}")
else
  RELEASE_JSON=$(curl -fsSL "${API}/latest")
fi

TAG=$(printf '%s' "$RELEASE_JSON" | tr ',' '\n' | grep '"tag_name"' | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
[ -n "$TAG" ] || die "could not read the release list from GitHub."

# Pick the first download URL whose filename matches $1 and does not match $2.
asset_url() {
  match="$1"
  reject="${2:-}"
  urls=$(printf '%s' "$RELEASE_JSON" | tr ',' '\n' \
    | grep '"browser_download_url"' \
    | sed 's/.*: *"\(https[^"]*\)".*/\1/')
  for u in $urls; do
    name=${u##*/}
    case "$name" in
      *"$match") ;;
      *) continue ;;
    esac
    if [ -n "$reject" ]; then
      case "$name" in
        *"$reject"*) continue ;;
      esac
    fi
    printf '%s' "$u"
    return 0
  done
  return 1
}

OS=$(uname -s)
ARCH=$(uname -m)
TMP=$(mktemp -d)
MOUNT=''
MAC_WORK=''
MAC_TARGET=''
MAC_BACKUP=''
MAC_COMMITTED=0

cleanup() {
  result=$?
  trap - EXIT INT TERM
  # Never discard the old working bundle until the complete replacement is installed.
  if [ -n "$MAC_BACKUP" ] && { [ -e "$MAC_BACKUP" ] || [ -L "$MAC_BACKUP" ]; } && [ "$MAC_COMMITTED" -ne 1 ]; then
    if [ ! -e "$MAC_TARGET" ] && [ ! -L "$MAC_TARGET" ]; then
      mv "$MAC_BACKUP" "$MAC_TARGET" || true
    fi
    if [ -e "$MAC_BACKUP" ] || [ -L "$MAC_BACKUP" ]; then
      printf 'Original app preserved at %s; automatic restore was not possible.\n' "$MAC_BACKUP" >&2
      MAC_WORK='' # Preserve the recovery copy even if restoring it also failed.
    fi
  fi
  if [ -n "$MOUNT" ]; then
    hdiutil detach "$MOUNT" >/dev/null 2>&1 || hdiutil detach -force "$MOUNT" >/dev/null 2>&1 || true
  fi
  [ -z "$MAC_WORK" ] || rm -rf "$MAC_WORK"
  rm -rf "$TMP"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

install_macos_bundle() {
  bundle="$1"
  MAC_TARGET="$2"
  [ -f "$bundle/Contents/Info.plist" ] && [ -x "$bundle/Contents/MacOS/Vibisual" ] || die 'the disk image does not contain a complete Vibisual.app.'
  # A sibling staging directory keeps both renames on the destination filesystem.
  MAC_WORK=$(mktemp -d "${MAC_TARGET%/*}/.vibisual-install.XXXXXX")
  staged="$MAC_WORK/new.app"
  MAC_BACKUP="$MAC_WORK/previous.app"
  ditto "$bundle" "$staged" || die 'could not copy the new app; the existing app was left in place.'
  [ -f "$staged/Contents/Info.plist" ] && [ -x "$staged/Contents/MacOS/Vibisual" ] || die 'the copied app is incomplete; the existing app was left in place.'
  if [ -e "$MAC_TARGET" ] || [ -L "$MAC_TARGET" ]; then
    mv "$MAC_TARGET" "$MAC_BACKUP" || die 'could not prepare the existing app for replacement.'
  fi
  mv "$staged" "$MAC_TARGET" || die 'could not install the new app; restoring the previous app.'
  MAC_COMMITTED=1
}

download() {
  say "  downloading ${1##*/}"
  curl -fL# -o "$2" "$1"
}

say "Vibisual ${TAG}"
say ""

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64) URL=$(asset_url "-arm64.dmg") || die "no Apple Silicon build in ${TAG}." ;;
      x86_64) URL=$(asset_url ".dmg" "arm64") || die "no Intel build in ${TAG}." ;;
      *) die "unsupported macOS architecture: ${ARCH}" ;;
    esac

    DMG="${TMP}/vibisual.dmg"
    download "$URL" "$DMG"

    say "  mounting"
    MOUNT=$(hdiutil attach -nobrowse -readonly "$DMG" | grep -o '/Volumes/.*' | head -1)
    [ -n "$MOUNT" ] || die "could not mount the disk image."

    say "  copying Vibisual.app to /Applications"
    install_macos_bundle "${MOUNT}/Vibisual.app" "/Applications/Vibisual.app"

    say ""
    say "Installed to /Applications/Vibisual.app"
    say ""
    say "One more step — these builds are not code-signed yet, so Gatekeeper will"
    say "refuse the first launch until you clear the quarantine flag:"
    say ""
    say "    xattr -cr /Applications/Vibisual.app"
    say ""
    say "Run it once and the app opens normally from then on."
    ;;

  Linux)
    if [ "$ARCH" != "x86_64" ] && [ "$ARCH" != "amd64" ]; then
      die "Linux builds are x86_64 only right now (you are on ${ARCH})."
    fi

    if command -v dpkg >/dev/null 2>&1 && URL=$(asset_url ".deb"); then
      DEB="${TMP}/vibisual.deb"
      download "$URL" "$DEB"
      say "  installing with apt"
      if command -v apt >/dev/null 2>&1; then
        sudo_if_needed apt install -y "$DEB"
      else
        sudo_if_needed dpkg -i "$DEB" || sudo_if_needed apt-get install -f -y
      fi
      say ""
      say "Installed. Look for Vibisual in your application menu, or run: vibisual"

    elif command -v rpm >/dev/null 2>&1 && URL=$(asset_url ".rpm"); then
      RPM="${TMP}/vibisual.rpm"
      download "$URL" "$RPM"
      say "  installing with dnf"
      if command -v dnf >/dev/null 2>&1; then
        sudo_if_needed dnf install -y "$RPM"
      else
        sudo_if_needed rpm -Uvh "$RPM"
      fi
      say ""
      say "Installed. Look for Vibisual in your application menu, or run: vibisual"

    else
      URL=$(asset_url ".AppImage") || die "no Linux build in ${TAG}."
      mkdir -p "${PREFIX}/bin"
      TARGET="${PREFIX}/bin/vibisual"
      download "$URL" "$TARGET"
      chmod +x "$TARGET"
      say ""
      say "Installed to ${TARGET}"
      case ":${PATH}:" in
        *":${PREFIX}/bin:"*) ;;
        *) say "Add it to your PATH:  export PATH=\"${PREFIX}/bin:\$PATH\"" ;;
      esac
      say ""
      say "AppImages need FUSE 2, which recent distributions no longer ship."
      say "If it exits immediately with a libfuse error, install it once:"
      say ""
      say "    sudo apt install libfuse2t64    # 'libfuse2' on Ubuntu 22.04 and older"
    fi
    ;;

  *)
    die "unsupported platform: ${OS}. On Windows use scripts/install.ps1."
    ;;
esac

say ""
say "Vibisual runs on top of the Claude CLI, which must be installed separately"
say "and available on your PATH: https://claude.com/claude-code"
