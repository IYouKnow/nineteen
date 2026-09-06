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
# It installs Docker (if missing), fetches the latest GitHub release, clones
# that tag, generates .env, builds and starts the container, then prints the
# URL and access code. If the repo has no releases it falls back to main.
# Hosted project containers and /opt/nineteen/data are never touched.

REPO="${NINETEEN_REPO:-IYouKnow/nineteen}"
DEFAULT_REPO="$REPO"
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

# --- determine the latest GitHub release ---
fetch_latest_release() {
  curl -fsS "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1
}
LATEST_TAG="$(fetch_latest_release || true)"
if [ -n "$LATEST_TAG" ]; then
  VERSION="${LATEST_TAG#v}"
  CLONE_REF="$LATEST_TAG"
  log "Installing latest release: $LATEST_TAG"
else
  VERSION="dev"
  CLONE_REF="main"
  warn "No releases found for $REPO — installing $CLONE_REF (version dev)"
fi

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
  git -C "$APP_DIR" fetch --depth 1 origin "$CLONE_REF" >/dev/null 2>&1 || true
  git -C "$APP_DIR" checkout "$CLONE_REF" >/dev/null 2>&1 || warn "could not switch to $CLONE_REF; using current checkout"
elif [ -d "$APP_DIR/.git" ]; then
  log "Existing install found at $APP_DIR — updating to $CLONE_REF ..."
  git -C "$APP_DIR" fetch --depth 1 origin "$CLONE_REF" >/dev/null 2>&1 || true
  git -C "$APP_DIR" checkout "$CLONE_REF" >/dev/null 2>&1 || warn "could not switch to $CLONE_REF; using existing checkout"
else
  log "Cloning $REPO ($CLONE_REF) to $APP_DIR ..."
  mkdir -p "$APP_DIR"
  git clone --branch "$CLONE_REF" --depth 1 "https://github.com/$REPO.git" "$APP_DIR"
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
docker compose build --build-arg VERSION="$VERSION"
docker compose up -d

# --- wait for health ---
log "Waiting for Nineteen to become healthy..."
HEALTHY=0
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 2
done

if [ "$HEALTHY" -ne 1 ]; then
  warn "Nineteen did not respond on /api/health within the wait — check: docker compose logs -f"
fi

cat <<EOF

==> Nineteen is up!
    URL:        http://localhost:${PORT}
    Invite:     ${invite:-<see .env>}
    Data dir:   $APP_DIR/data

    Logs:       docker compose logs -f
    Restart:    docker compose restart
    Update:     re-run this installer, or use the in-app Updates tab

    Open the URL and register the first admin using the invite code.
EOF
