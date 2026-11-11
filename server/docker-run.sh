#!/bin/sh
# Runs the SITELINE game server inside a container (the ZimaOS app in server/zimaos-compose.yml,
# see server/ZIMAOS.txt). Keeps the game files up to date from GitHub: every half hour it checks
# for an update, and when there is one it waits until nobody is playing, then restarts with it.
APP=${APP_DIR:-/app}
REPO=${REPO:-https://github.com/sitev2/siteline.git}
BRANCH=${BRANCH:-main}
PORT=${PORT:-8787}
CHECK=${UPDATE_CHECK_SECONDS:-1800}
export PORT

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }
PID=
trap 'log "stopping"; [ -n "$PID" ] && kill "$PID" 2>/dev/null; exit 0' TERM INT

command -v git >/dev/null || { log "git is missing: use the node:22 image"; exit 1; }
[ -d "$APP/.git" ] || git clone --depth 1 -b "$BRANCH" "$REPO" "$APP"

while true; do
  git -C "$APP" fetch -q --depth 1 origin "$BRANCH" && git -C "$APP" reset -q --hard FETCH_HEAD \
    || log "couldn't check for updates (offline?): using the game files already here"
  (cd "$APP/server" && npm install --omit=dev --no-audit --no-fund --loglevel=error)
  log "starting the game server (version $(git -C "$APP" rev-parse --short HEAD))"
  node "$APP/server/server.mjs" & PID=$!
  while kill -0 "$PID" 2>/dev/null; do
    sleep "$CHECK" & wait $!
    git -C "$APP" fetch -q --depth 1 origin "$BRANCH" || continue
    [ "$(git -C "$APP" rev-parse HEAD)" = "$(git -C "$APP" rev-parse FETCH_HEAD)" ] && continue
    log "update found: it will be installed when nobody is playing"
    until wget -qO- "http://127.0.0.1:$PORT" 2>/dev/null | grep -q 'Players online: 0'; do
      kill -0 "$PID" 2>/dev/null || break
      sleep 60 & wait $!
    done
    kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null
  done
  log "game server stopped, restarting"
  sleep 3
done
