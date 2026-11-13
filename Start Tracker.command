#!/bin/zsh
# Start the tracker from Finder, regardless of the current working directory.
cd -- "$(dirname -- "$0")/tracker" || exit 1

# Finder may not inherit the PATH configured in an interactive terminal.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 24 or newer, then run this launcher again."
  echo "https://nodejs.org/"
  read -r "reply?Press Enter to close."
  exit 1
fi

# Open the page only after the local server begins responding.
(
  for attempt in {1..60}; do
    if /usr/bin/curl --silent --fail --output /dev/null --max-time 1 \
      http://127.0.0.1:4317/; then
      /usr/bin/open http://127.0.0.1:4317/
      exit
    fi
    sleep 0.5
  done
) &
browser_waiter=$!

PORT=4317 node server.mjs
tracker_status=$?
# Stop waiting if startup fails or the server is shut down.
kill "$browser_waiter" 2>/dev/null
wait "$browser_waiter" 2>/dev/null
if (( tracker_status != 0 )); then
  echo "The tracker could not start. See the error above."
  read -r "reply?Press Enter to close."
fi
exit "$tracker_status"
