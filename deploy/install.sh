#!/bin/sh
# NetHelper: Docker Compose installer and upgrader.
#
#   cd deploy && ./install.sh            # interactive
#   ./install.sh -y --admin-email you@example.com --admin-name "Your Name"
#   ./install.sh --env-only              # just write deploy/.env, run Compose yourself
#
# What it does, in order (each docker command is echoed as it runs; the manual
# steps are in README.md, "Installing by hand"):
#   1. checks Docker and Compose,
#   2. creates deploy/.env with generated secrets, or fills in required secrets
#      that are still empty (a value that is set is never changed),
#   3. pulls the release images, or builds them locally,
#   4. starts the stack and waits until it is healthy,
#   5. creates the first admin if there are no users yet.
# Re-running it is safe, and is how you upgrade (take a database backup first).
#
# It does not install Docker, set up TLS, or take backups.

set -eu

usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

  --host-network        Use the host-network override (MAC addresses in discovery
                        on the local L2 segment; needs Compose 2.24+)
  --http-port PORT      Port the UI listens on (HTTP_PORT, default 8080)
  --build               Build the images here instead of pulling the release images
  --admin-email EMAIL   First admin's email (asked for if there are no users yet)
  --admin-name NAME     First admin's name
  --no-admin            Don't create a first admin
  --env-only            Write or complete deploy/.env, then stop
  -y, --yes             Don't ask anything; use defaults and the options given
  -h, --help            Show this help

The first admin's password comes from NETHELPER_ADMIN_PASSWORD if it is set in
your environment (at least 12 characters); otherwise one is generated and
printed once.
EOF
}

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
# Echo a command, then run it.
run() { printf '+ %s\n' "$*"; "$@"; }

HOST_NETWORK=
HTTP_PORT_OPT=
BUILD=
ADMIN_EMAIL=
ADMIN_NAME=
NO_ADMIN=
ENV_ONLY=
ASSUME_YES=

while [ $# -gt 0 ]; do
  case "$1" in
    --host-network) HOST_NETWORK=1 ;;
    --http-port) [ $# -ge 2 ] || die "--http-port needs a value"; HTTP_PORT_OPT=$2; shift ;;
    --http-port=*) HTTP_PORT_OPT=${1#*=} ;;
    --build) BUILD=1 ;;
    --admin-email) [ $# -ge 2 ] || die "--admin-email needs a value"; ADMIN_EMAIL=$2; shift ;;
    --admin-email=*) ADMIN_EMAIL=${1#*=} ;;
    --admin-name) [ $# -ge 2 ] || die "--admin-name needs a value"; ADMIN_NAME=$2; shift ;;
    --admin-name=*) ADMIN_NAME=${1#*=} ;;
    --no-admin) NO_ADMIN=1 ;;
    --env-only) ENV_ONLY=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
  shift
done

if [ -n "$HTTP_PORT_OPT" ]; then
  case "$HTTP_PORT_OPT" in
    ''|*[!0-9]*) die "--http-port must be a number" ;;
  esac
fi

# Prompts only when someone is at the terminal and -y wasn't given.
INTERACTIVE=
if [ -z "$ASSUME_YES" ] && [ -t 0 ] && [ -t 1 ]; then INTERACTIVE=1; fi

cd "$(dirname "$0")"
ENV_FILE=.env
[ -f .env.example ] || die "run this from the NetHelper tree: deploy/.env.example is missing"

# 64 hex characters: URL-safe, since POSTGRES_PASSWORD goes into DATABASE_URL.
gen_secret() { od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; }

# Value of KEY in the env file (last uncommented assignment), or empty.
env_get() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }

# Set KEY=VALUE: replaces an uncommented assignment, else the first commented
# one (#KEY=...), else appends. VALUE must not contain newlines.
env_set() {
  tmp="$ENV_FILE.tmp.$$"
  KEY="$1" VALUE="$2" awk '
    BEGIN { key = ENVIRON["KEY"]; value = ENVIRON["VALUE"]; live = 0; done = 0 }
    { lines[NR] = $0; if (index($0, key "=") == 1) live = 1 }
    END {
      for (i = 1; i <= NR; i++) {
        line = lines[i]
        if (!done && live && index(line, key "=") == 1) { print key "=" value; done = 1; continue }
        if (!done && !live && index(line, "#" key "=") == 1) { print key "=" value; done = 1; continue }
        print line
      }
      if (!done) print key "=" value
    }' "$ENV_FILE" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}

ask_yes_no() { # question default(y|n)
  [ -n "$INTERACTIVE" ] || { [ "$2" = y ]; return; }
  printf '%s ' "$1"
  read -r answer || answer=
  case "${answer:-$2}" in [Yy]*) return 0 ;; *) return 1 ;; esac
}

# --- 1. Preflight -----------------------------------------------------------

if [ -z "$ENV_ONLY" ]; then
  step "Checking Docker"
  command -v docker >/dev/null 2>&1 \
    || die "docker isn't installed. Install Docker Engine with the Compose plugin first (README.md, \"Docker Compose\")."
  docker info >/dev/null 2>&1 \
    || die "can't reach the Docker daemon. Is it running, and are you root or in the docker group?"
  compose_version=$(docker compose version --short 2>/dev/null) \
    || die "the Docker Compose plugin (docker compose) isn't installed"
  compose_version=${compose_version#v}
  compose_major=${compose_version%%.*}
  compose_minor=${compose_version#*.}; compose_minor=${compose_minor%%.*}
  case "$compose_major$compose_minor" in *[!0-9]*|'') die "can't parse the Compose version: $compose_version" ;; esac
  [ "$compose_major" -ge 2 ] || die "Compose v2 or later is required (found $compose_version)"
  say "Docker Compose $compose_version"
fi

# --- 2. deploy/.env -----------------------------------------------------------

step "Configuration (deploy/.env)"
created_env=
if [ ! -f "$ENV_FILE" ]; then
  (umask 077 && cp .env.example "$ENV_FILE")
  created_env=1
  say "Created deploy/.env from .env.example."
  if [ -z "$HOST_NETWORK" ] && ask_yes_no "Use host networking, so discovery sees MAC addresses on this host's local network? [y/N]" n; then
    HOST_NETWORK=1
  fi
fi
chmod 600 "$ENV_FILE"

generated=
for key in POSTGRES_PASSWORD REDIS_PASSWORD JWT_SECRET JWT_REFRESH_SECRET ENCRYPTION_KEY; do
  if [ -z "$(env_get "$key")" ]; then
    env_set "$key" "$(gen_secret)"
    generated="$generated $key"
  fi
done
if [ -n "$generated" ]; then
  say "Generated:$generated"
else
  say "All required secrets are already set; left them unchanged."
fi
case "$generated" in
  *ENCRYPTION_KEY*)
    say ""
    say "ENCRYPTION_KEY encrypts every stored device, cloud and Git credential. Back up"
    say "deploy/.env (or at least that key) somewhere other than the database backups:"
    say "a database restored without it has unreadable credentials." ;;
esac

if [ -n "$HTTP_PORT_OPT" ]; then
  env_set HTTP_PORT "$HTTP_PORT_OPT"
  say "HTTP_PORT=$HTTP_PORT_OPT"
fi

if [ -n "$HOST_NETWORK" ]; then
  current=$(env_get COMPOSE_FILE)
  if [ -n "$current" ]; then
    case "$current" in
      *docker-compose.host-network.yml*) ;;
      *) warn "COMPOSE_FILE is already set ($current) and doesn't include docker-compose.host-network.yml; left it alone" ;;
    esac
  else
    compose_file=docker-compose.yml:docker-compose.host-network.yml
    [ -f docker-compose.override.yml ] && compose_file=$compose_file:docker-compose.override.yml
    env_set COMPOSE_FILE "$compose_file"
    say "COMPOSE_FILE=$compose_file"
  fi
fi

# The host-network override uses !reset, which needs Compose 2.24+.
if [ -z "$ENV_ONLY" ]; then
  case "$(env_get COMPOSE_FILE)" in
    *docker-compose.host-network.yml*)
      if [ "$compose_major" -eq 2 ] && [ "$compose_minor" -lt 24 ]; then
        die "the host-network override needs Compose 2.24+ (found $compose_version)"
      fi ;;
  esac
fi

if [ -n "$ENV_ONLY" ]; then
  say ""
  say "deploy/.env is ready. Next, from deploy/:"
  say "  docker compose up -d --build"
  say "  docker compose exec backend npm run user:manage -- create-admin --email you@example.com --name \"Your Name\""
  exit 0
fi

# --- 3. Images ----------------------------------------------------------------

step "Images"
version=$(cat ../VERSION 2>/dev/null || true)
pinned=$(env_get NETHELPER_VERSION)
if [ -n "$pinned" ] && [ "$pinned" != "$version" ]; then
  warn "deploy/.env pins NETHELPER_VERSION=$pinned but this tree is $version. Delete that line to follow the tree (older .env.example files set it)."
fi
if [ -z "$BUILD" ] && [ -e ../.git ]; then
  # Release images only match a checkout of the release tag.
  if ! command -v git >/dev/null 2>&1; then
    BUILD=1
    say "This is a git checkout and git isn't installed to check its tag; building locally."
  elif [ "$(git -C .. describe --exact-match --tags HEAD 2>/dev/null || true)" != "v$version" ]; then
    BUILD=1
    say "This checkout isn't the v$version release tag, so the release images wouldn't match it; building locally."
  fi
fi
if [ -z "$BUILD" ]; then
  if ! run docker compose pull backend frontend; then
    say ""
    say "Couldn't pull the release images: no registry access from this host, or a"
    say "private registry (for ghcr.io, a GitHub token with read:packages:"
    say "  echo <token> | docker login ghcr.io -u <github user> --password-stdin)."
    say "Building locally instead (a few minutes)."
    BUILD=1
  fi
fi
if [ -n "$BUILD" ]; then
  run docker compose build
fi

# --- 4. Start -----------------------------------------------------------------

step "Starting NetHelper"
run docker compose up -d

health() { # service -> health status, or "missing"
  id=$(docker compose ps -q "$1" 2>/dev/null | head -n 1)
  [ -n "$id" ] || { echo missing; return; }
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo missing
}

say "Waiting for the backend and frontend to report healthy (up to 3 minutes)..."
deadline=$(( $(date +%s) + 180 ))
while :; do
  backend_health=$(health backend)
  frontend_health=$(health frontend)
  [ "$backend_health" = healthy ] && [ "$frontend_health" = healthy ] && break
  if [ "$(date +%s)" -ge "$deadline" ]; then
    say "backend: $backend_health, frontend: $frontend_health"
    run docker compose logs --tail 50 backend || true
    die "NetHelper didn't become healthy. The backend's log is above; 'docker compose ps' shows each service."
  fi
  sleep 3
done
say "Healthy."

# --- 5. First admin -----------------------------------------------------------

admin_command='docker compose exec backend npm run user:manage -- create-admin --email you@example.com --name "Your Name"'
if [ -z "$NO_ADMIN" ]; then
  step "First admin"
  users=$(docker compose exec -T backend node scripts/user-manager.js count-users 2>/dev/null | tail -n 1 | tr -d '\r')
  case "$users" in
    ''|*[!0-9]*)
      warn "couldn't count users; create the first admin yourself: $admin_command" ;;
    0)
      created_admin=
      while [ -z "$created_admin" ]; do
        if [ -z "$ADMIN_EMAIL" ] && [ -n "$INTERACTIVE" ]; then
          printf 'Admin email (empty to skip): '
          read -r ADMIN_EMAIL || ADMIN_EMAIL=
          [ -n "$ADMIN_EMAIL" ] || break
        fi
        if [ -z "$ADMIN_NAME" ] && [ -n "$INTERACTIVE" ]; then
          printf 'Admin name: '
          read -r ADMIN_NAME || ADMIN_NAME=
        fi
        if [ -z "$ADMIN_EMAIL" ] || [ -z "$ADMIN_NAME" ]; then
          say "No admin email and name given; skipped. Create one with:"
          say "  $admin_command"
          break
        fi
        # The password goes by name (-e NAME), never as a value on a command line.
        if [ -n "${NETHELPER_ADMIN_PASSWORD:-}" ]; then
          set -- -e NETHELPER_ADMIN_PASSWORD
        else
          set --
        fi
        if docker compose exec -T "$@" backend node scripts/user-manager.js create-admin --if-no-users \
             --email "$ADMIN_EMAIL" --name "$ADMIN_NAME"; then
          created_admin=1
        elif [ -n "$INTERACTIVE" ]; then
          say "Try again."
          ADMIN_EMAIL=
          ADMIN_NAME=
        else
          die "couldn't create the admin (the error is above)"
        fi
      done ;;
    *)
      say "$users user(s) already exist; no admin created." ;;
  esac
fi

# --- Done ---------------------------------------------------------------------

port=$(env_get HTTP_PORT); port=${port:-8080}
bind=$(env_get HTTP_BIND)
case "$(env_get COMPOSE_FILE)" in *docker-compose.host-network.yml*) bind= ;; esac
if [ "$bind" = 127.0.0.1 ]; then
  host=127.0.0.1
else
  host=$(hostname -I 2>/dev/null | awk '{print $1}')
  host=${host:-<this host>}
fi

step "Done"
say "NetHelper is running: http://$host:$port"
say ""
say "- It speaks plain HTTP. Passwords and device credentials cross the network in"
say "  clear text, so beyond a trusted management network put TLS in front"
say "  (README.md, \"TLS\")."
say "- After signing in: change the admin's password (account menu), then follow"
say "  docs/GETTING_STARTED.md."
say "- To upgrade later: take a database backup (README.md, \"Backup and restore\"),"
say "  update this tree, and run ./install.sh again."
[ -n "$created_env" ] && say "- Keep a copy of deploy/.env: it holds ENCRYPTION_KEY."
exit 0
