#!/bin/zsh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 20 or newer, then run this launcher again."
  echo "https://nodejs.org/"
  read -r "reply?Press Enter to close."
  exit 1
fi
node server.mjs
