#!/usr/bin/env bash
# SITELINE game server — one-step setup for Ubuntu / Debian Linux.
# See server/LINUX.txt. Run it from your user account (not as root):
#
#   bash ~/siteline/server/install-linux.sh
#
# Safe to run again: it only redoes what is missing. It
#   1. installs Node.js (version 22) if it is missing or too old
#   2. installs the server's one library (ws)
#   3. makes the server start by itself when the PC boots, restart if it
#      crashes, and download game updates from GitHub every night at 04:30
#   4. installs Tailscale and gives the server a public https address (Funnel)
set -euo pipefail

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || fail "Run this as your normal user, not with sudo. It asks for your password when it needs it."
command -v apt-get >/dev/null || fail "This script is for Ubuntu or Debian (it needs apt-get)."

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SERVER_DIR")"
[ -f "$SERVER_DIR/server.mjs" ] || fail "Can't find server.mjs next to this script. Keep the whole siteline folder together."
PORT="${PORT:-8787}"
ME="$(id -un)"

say "Asking for your password once (needed to install programs)"
sudo -v
if ! command -v curl >/dev/null || ! command -v git >/dev/null; then
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl git
fi

# ---------- 1. Node.js ----------
node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0; }
if ! command -v node >/dev/null || [ "$(node_major)" -lt 18 ]; then
  say "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  say "Node.js $(node -v) is already installed"
fi
NODE="$(command -v node)"
NPM="$(command -v npm)"

# ---------- 2. server library ----------
say "Installing the server library"
(cd "$SERVER_DIR" && "$NPM" install --omit=dev --no-audit --no-fund)

# ---------- 3. start on boot + nightly updates ----------
say "Setting the server to start by itself"
# If the folder is a git clone, every (re)start first downloads the latest game files.
PULL=""
if git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  PULL="ExecStartPre=-/usr/bin/git -C $REPO_DIR pull --ff-only
ExecStartPre=-$NPM --prefix $SERVER_DIR install --omit=dev --no-audit --no-fund"
else
  echo "(This folder isn't a git clone, so it can't update itself. See LINUX.txt to set it up with git.)"
fi

sudo tee /etc/systemd/system/siteline.service >/dev/null <<EOF
[Unit]
Description=SITELINE game server
Wants=network-online.target
After=network-online.target

[Service]
User=$ME
WorkingDirectory=$SERVER_DIR
Environment=PORT=$PORT
Environment=PATH=$(dirname "$NODE"):/usr/bin:/bin
$PULL
ExecStart=$NODE server.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# nightly restart = nightly update (the restart pulls the newest files first)
sudo tee /etc/systemd/system/siteline-update.service >/dev/null <<EOF
[Unit]
Description=Update and restart the SITELINE game server

[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl restart siteline.service
EOF
sudo tee /etc/systemd/system/siteline-update.timer >/dev/null <<EOF
[Unit]
Description=Update the SITELINE game server every night

[Timer]
OnCalendar=*-*-* 04:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable siteline.service siteline-update.timer >/dev/null
sudo systemctl restart siteline.service
sudo systemctl start siteline-update.timer

for _ in $(seq 1 20); do
  curl -fsS "http://localhost:$PORT" 2>/dev/null | grep -q 'SITELINE server is running' && break
  sleep 1
done
curl -fsS "http://localhost:$PORT" 2>/dev/null | grep -q 'SITELINE server is running' \
  || fail "The server didn't start. See what went wrong with:  journalctl -u siteline -n 50"
echo "Server is running on port $PORT."

# ---------- 4. Tailscale Funnel ----------
if ! command -v tailscale >/dev/null; then
  say "Installing Tailscale"
  curl -fsSL https://tailscale.com/install.sh | sh
fi
if ! tailscale status >/dev/null 2>&1; then
  say "Sign in to Tailscale: open the link below in any browser"
  sudo tailscale up
fi
say "Giving the server a public address (Tailscale Funnel)"
echo "If it prints a link asking you to turn on HTTPS or Funnel: open it, approve, and run this script again."
sudo tailscale funnel --bg "$PORT"

ADDR="$(tailscale status --json 2>/dev/null | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,""))}catch{}})' || true)"
say "Done!"
if [ -n "$ADDR" ]; then
  echo "Server address:  https://$ADDR"
  echo "Game link:       https://sitev2.github.io/siteline/?server=wss://$ADDR"
else
  echo "See your address with:  tailscale funnel status"
fi
echo
echo "Useful commands:"
echo "  systemctl status siteline       is it running?"
echo "  journalctl -u siteline -f       watch the server log (Ctrl+C to stop watching)"
echo "  sudo systemctl restart siteline update to the newest game files and restart now"
