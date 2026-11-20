#!/bin/bash
# دبل كليك في Finder: بيلاقي Node 26 ويشغّل «npm run mac-setup» من فولدر البرنامج.
cd "$(dirname "$0")" || exit 1
for d in "$HOME"/.local/node-v2[4-9]*-darwin-arm64/bin /opt/homebrew/bin /usr/local/bin; do
  if [ -x "$d/node" ] && [ "$("$d/node" -p 'process.versions.node.split(".")[0]')" -ge 24 ]; then export PATH="$d:$PATH"; break; fi
done
command -v node >/dev/null || { echo "مش لاقي Node 24 أو أحدث. شوف docs/mac-checklist.md"; read -r; exit 1; }
npm run mac-setup
