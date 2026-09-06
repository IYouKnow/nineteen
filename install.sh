#!/usr/bin/env bash
set -euo pipefail

# Nineteen bootstrap installer for a fresh Debian server with Docker.
#
# One-liner:
#   curl -fsSL https://raw.githubusercontent.com/IYouKnow/nineteen/main/install.sh | sudo bash
#
# Or clone the repo first and run:
#   sudo bash install.sh
#
# It installs Docker (if missing), clones the Nineteen source, generates .env,
# builds and starts the container, then prints the URL and access code.
# Hosted project containers and /opt/nineteen/data are never touched.

REPO="${NINETEEN_REPO:-IYouKnow/nineteen}"
DEFAULT_REPO="$REPO"
BRANCH="main"
DEFAULT_DIR="/opt/nineteen"
DEFAULT_PORT="8080"

log()  { echo -e "\033[1;34m==>\033[0m $*"; }
warn() { echo -e "\033[1;33mwarning:\033[0m $*" >&2; }
die()  { echo -e "\033[1;31merror:\033[0m $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root: sudo bash install.sh"

# prompt <question> <default> — reads from the terminal (works with `curl | bash`)
prompt() {
  local q="$1" d="$2" v
  if [ -t 0 ]; then
    read -r -p "$q [$d]: " v || true
  else
    read -r -p "$q [$d]: " v < /dev/tty || true
  fi
  echo "${v:-$d}"
}

log "Nineteen installer"
log "Repo: $REPO"

# --- prerequisites ---
for p in git curl; do
  if ! command -v "$p" >/dev/null 2>&1; then
    log "Installing $p..."
    apt-get update -y >/dev/null 2>&1 || true
    apt-get install -y "$p" >/dev/null
  fi
done

# --- Docker ---
if ! command -v docker >/dev/null 2>&1; then
  log "Docker not found — installing Docker Engine + Compose plugin (get.docker.com)..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi
command -v docker >/dev/null 2>&1 || die "Docker install failed"
docker compose version >/dev/null 2>&1 || die "Docker Compose plugin is not available"

# --- locate / clone the repo ---
APP_DIR="$DEFAULT_DIR"
if [ -f "docker-compose.yml" ] && [ -d ".git" ]; then
  APP_DIR="$(pwd)"
  log "Running from an existing checkout: $APP_DIR"
elif [ -d "$APP_DIR/.git" ]; then
  log "Existing install found at $APP_DIR — pulling latest..."
  git -C "$APP_DIR" pull --ff-only >/dev/null 2>&1 || warn "git pull failed; continuing with existing checkout"
else
  log "Cloning $REPO to $APP_DIR ..."
  mkdir -p "$APP_DIR"
  git clone --branch "$BRANCH" --depth 1 "https://github.com/$REPO.git" "$APP_DIR"
fi
cd "$APP_DIR"

# --- .env ---
if [ -f .env ]; then
  log ".env already exists — keeping it"
else
  log "Creating .env"
  secret="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  invite="$(prompt "Invite code (used once to register the first admin)" "nineteen")"
  nrepo="$(prompt "NINETEEN_REPO (public source repo, owner/name)" "$DEFAULT_REPO")"
  port="$(prompt "Host port to publish" "$DEFAULT_PORT")"
  cat > .env <<EOF
JWT_SECRET=$secret
INVITE_CODE=$invite
NINETEEN_REPO=$nrepo
APP_PORT=$port
EOF
  PORT="$port"
fi

# --- data dir ---
mkdir -p "$APP_DIR/data"

# --- build & run ---
log "Building and starting the container (this can take a few minutes)..."
docker compose build
docker compose up -d

# --- wait for health ---
log "Waiting for Nineteen to become healthy..."
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

cat <<EOF

==> Nineteen is up!
    URL:        http://localhost:${PORT}
    Invite:     ${invite:-<see .env>}
    Data dir:   $APP_DIR/data

    Logs:       docker compose logs -f
    Restart:    docker compose restart
    Update:     cd $APP_DIR && git pull && docker compose up -d --build

    Open the URL and register the first admin using the invite code.
EOF
