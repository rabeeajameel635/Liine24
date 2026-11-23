#!/bin/bash
# Liine24 on an Apple-silicon Mac from nothing: Node (only if missing), the code, ffmpeg, then «npm run mac-setup».
# No sudo, no Homebrew, no Apple developer tools. Everything lands in ~/.local, ~/Liine24 and
# ~/Library/Application Support/Ghorfa. Safe to run again: it keeps what is already there and refreshes the code.
#   curl -fsSL https://raw.githubusercontent.com/rabeeajameel635/Liine24/refs/heads/claude/rabee-studio/install.sh | bash
set -euo pipefail

ROOT="${LIINE24_DIR:-$HOME/Liine24}"
BRANCH="${LIINE24_BRANCH:-claude/rabee-studio}"
REPO="https://github.com/rabeeajameel635/Liine24"

NODE_V="v26.13.0"
NODE_SHA="d38bd5e5a2ddce6bbb5ce45e46e208337da4d51fffe611e567fd32073d6439f6"      # node-v26.13.0-darwin-arm64.tar.gz, from nodejs.org SHASUMS256.txt
FF_URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1"   # ffmpeg 6.1.1 static builds, GPL-3.0
FFMPEG_SHA="8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa"    # ffmpeg-darwin-arm64.gz
FFPROBE_SHA="d986a8ec7b030899fe66a8a288ed809a3543338705a3ce178cfb85869c5d80be"   # ffprobe-darwin-arm64.gz

say() { printf '\n%s  %s\n' "$1" "$2"; }
die() { printf '✗ %s\n' "$1" >&2; exit 1; }
fetch() { curl -fL --retry 3 --progress-bar -o "$2" "$1" || die "التنزيل وقع: $1"; }
check() { [ "$(shasum -a 256 "$1" | cut -d' ' -f1)" = "$2" ] || { rm -f "$1"; die "البصمة مش مطابقة، والملف اتمسح: $(basename "$1")"; }; }

[ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ] || die "السكريبت ده لماك بمعالج Apple (M1 أو أحدث) بس."
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

say "١" "Node"
NODE_BIN=""
for d in "$HOME"/.local/node-v*-darwin-arm64/bin; do
  if [ -x "$d/node" ] && [ "$("$d/node" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 24 ]; then NODE_BIN="$d"; fi
done
if [ -z "$NODE_BIN" ]; then
  echo "مش موجود في ~/.local. بينزل Node $NODE_V (58 ميجا)…"
  fetch "https://nodejs.org/dist/$NODE_V/node-$NODE_V-darwin-arm64.tar.gz" "$TMP/node.tar.gz"
  check "$TMP/node.tar.gz" "$NODE_SHA"
  mkdir -p "$HOME/.local" && tar -xzf "$TMP/node.tar.gz" -C "$HOME/.local"
  NODE_BIN="$HOME/.local/node-$NODE_V-darwin-arm64/bin"
  "$NODE_BIN/node" -v >/dev/null || die "Node نزل بس ما اشتغلش: $NODE_BIN/node"
fi
echo "✓ Node $("$NODE_BIN/node" -v) في $NODE_BIN"
export PATH="$NODE_BIN:$PATH"

say "٢" "الكود في $ROOT"
if [ -d "$ROOT/.git" ]; then
  echo "✓ نسخة git موجودة، ما اتلمستش. للتحديث: git -C \"$ROOT\" pull"
else
  echo "بينزل الكود (80 ميجا)…"
  fetch "$REPO/archive/refs/heads/$BRANCH.zip" "$TMP/code.zip"
  mkdir "$TMP/code" && unzip -q "$TMP/code.zip" -d "$TMP/code"
  SRC="$(ls -d "$TMP"/code/*/ | head -1)"
  [ -f "$SRC/app/package.json" ] || die "الملف المضغوط مش فيه البرنامج."
  mkdir -p "$ROOT" && cp -R "$SRC". "$ROOT/"
  echo "✓ الكود اتحط"
fi

say "٣" "ffmpeg في $ROOT/app/bin"
mkdir -p "$ROOT/app/bin"
for f in ffmpeg ffprobe; do
  out="$ROOT/app/bin/$f"
  if [ -x "$out" ] && "$out" -version >/dev/null 2>&1; then echo "✓ $f موجود وشغال"; continue; fi
  echo "بينزل $f (19 ميجا)…"
  fetch "$FF_URL/$f-darwin-arm64.gz" "$TMP/$f.gz"
  if [ "$f" = ffmpeg ]; then check "$TMP/$f.gz" "$FFMPEG_SHA"; else check "$TMP/$f.gz" "$FFPROBE_SHA"; fi
  gunzip -c "$TMP/$f.gz" > "$out" && chmod +x "$out"
  "$out" -version >/dev/null 2>&1 || die "$f نزل بس ما اشتغلش: $out"
  echo "✓ $f اتنزل واتأكد"
done

say "٤" "التنصيب والتشغيل"
rm -rf "$TMP"; trap - EXIT
cd "$ROOT/app"
exec npm run mac-setup
