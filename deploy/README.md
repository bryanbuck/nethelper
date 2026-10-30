# Deploying NetHelper

What's supported, known limitations, and how to report problems: [`docs/SUPPORT.md`](../docs/SUPPORT.md). Every setting: [`docs/CONFIGURATION.md`](../docs/CONFIGURATION.md).

Two supported ways to run NetHelper:

- **Docker Compose**: everything, including Postgres and Redis, in containers. Quickest to stand up.
- **Bare metal**: systemd runs the backend and nginx serves the UI, on a Debian or Ubuntu host with Postgres and Redis from the distro.

Both were installed from this runbook on clean Debian 13 (trixie) VMs on 2026-10-20. Debian 12 and Ubuntu 24.04 should work the same way but haven't been run end to end.

**Getting the code.** Clone the repository (`git clone … /opt/nethelper`) or unpack a release tarball there. Every command below runs from that tree. Each release on GitHub has `nethelper-<version>.tar.gz` (the source plus a prebuilt UI, so bare metal skips the frontend build) and its checksum:

```sh
base=https://github.com/bryanbuck/nethelper/releases/download/v0.9.0-beta.6
curl -fLO "$base/nethelper-0.9.0-beta.6.tar.gz" -fLO "$base/nethelper-0.9.0-beta.6.tar.gz.sha256"
sha256sum -c nethelper-0.9.0-beta.6.tar.gz.sha256
tar xzf nethelper-0.9.0-beta.6.tar.gz && mv nethelper-0.9.0-beta.6 /opt/nethelper
```

Either way, the browser talks to one origin: nginx serves the SPA and proxies `/api` and `/socket.io` to the backend. You don't need `CORS_ORIGINS` unless the UI is served from somewhere else.

Files in this directory:

| File | Purpose |
|---|---|
| `install.sh` | Compose installer and upgrader (see Quick start) |
| `docker-compose.yml` | Postgres 15, Redis 7, backend, frontend (nginx) |
| `docker-compose.host-network.yml` | Optional override for L2 discovery (MAC addresses) |
| `.env.example` | Compose settings and secrets → copy to `.env` |
| `systemd/nethelper-backend.service` | Bare-metal backend unit (sandboxed) |
| `systemd/backend.env.example` | Bare-metal settings template → `/etc/nethelper/backend.env` |
| `systemd/nethelper-admin` | Bare-metal helper: writes that file, runs the user and key-rotation scripts as the service user |
| `nginx/nethelper.conf` | Bare-metal nginx site with TLS |

The images are built from `backend/Dockerfile` and `frontend/Dockerfile` (nginx config in `frontend/nginx/`). Each release also publishes them to GHCR.

---

## Quick start (Docker Compose)

On a host with Docker Engine and the Compose plugin ([installing Docker](#docker-compose)):

```sh
git clone https://github.com/bryanbuck/nethelper.git /opt/nethelper   # or unpack a release tarball
cd /opt/nethelper/deploy
./install.sh
```

It asks whether to use host networking (MAC addresses in discovery; see **Network access and discovery** below) and for the first admin's email and name. At the end it prints the address to sign in at and the admin's generated password. It prints every Docker command before running it. In order, it:

1. checks Docker and Compose;
2. creates `deploy/.env` with generated secrets. If the file exists, it only fills in required secrets that are empty and never changes a value you set;
3. pulls the release images, or builds them on this host;
4. starts the stack and waits until it is healthy;
5. creates the first admin if there are no users yet.

It doesn't install Docker, set up TLS, or take backups. `./install.sh --help` lists the options. Unattended: `./install.sh -y --admin-email you@example.com --admin-name "Your Name"`; set `NETHELPER_ADMIN_PASSWORD` in your environment to choose the password. `./install.sh --env-only` only writes `deploy/.env`, if you'd rather run Compose yourself (next section).

**Prebuilt images.** Releases publish `ghcr.io/bryanbuck/nethelper-backend` and `nethelper-frontend` (amd64), which pull without a login. In a git checkout that isn't a release tag (the release images wouldn't match it), or when the pull fails, the script builds the images on this host instead: a few minutes, with access to the npm registry.

Back up `deploy/.env` afterwards: its `ENCRYPTION_KEY` decrypts every stored credential (see **Backup and restore**). Then sign in, change the admin's password, and follow [`docs/GETTING_STARTED.md`](../docs/GETTING_STARTED.md).

---

## Docker Compose

Requirements: Docker Engine 24+ with Compose v2 (2.24+ for the host-network override). The distro's `docker.io` package is often older; Docker's own repository is the simplest route (tested on Debian 13: Engine 29, Compose 5):

```sh
apt install ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $VERSION_CODENAME stable" \
  > /etc/apt/sources.list.d/docker.list
apt update && apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

(On Ubuntu, use `linux/ubuntu` in both URLs.) Then run `./install.sh` (Quick start), or install by hand:

### Installing by hand

```sh
cd /opt/nethelper/deploy
cp .env.example .env
# Fill in the five secrets; one per line, e.g.:
#   openssl rand -hex 32
$EDITOR .env
docker compose up -d --build
docker compose ps          # backend and frontend should become "healthy"
```

**Health probes** for a load balancer or monitoring: `http://<host>:8080/health` (liveness) and `/health/ready` (database and Redis; 503 when either is down). Both pass through the bundled nginx to the backend.

The backend applies database migrations every time it starts, and does nothing when the schema is already current. Set `RUN_MIGRATIONS=false` on the backend service to turn that off.

**First admin.** There's no self-signup. `install.sh` creates the first admin; by hand, once the backend is healthy:

```sh
docker compose exec backend npm run user:manage -- create-admin --email you@example.com --name "Your Name"
```

It prints a generated password once. To choose the password instead, pass `-e NETHELPER_ADMIN_PASSWORD=...` after `exec`. Then:

1. Browse to `http://<host>:8080` (or your `HTTP_PORT`) and sign in.
2. Change the password from the account menu (top right).
3. Add everyone else on the **Users** page.

Running `docker compose exec backend npm run user:manage` with no arguments opens an interactive menu for listing, editing, and deleting users, and resetting passwords.

**Network access and discovery.** In the default (bridge) setup, the backend reaches devices through Docker's NAT. That covers ping monitoring, SSH, REST, NETCONF, cloud APIs, and discovery of hosts on any routed subnet. What it can't see is the host's own ARP table, so hosts discovered on the local L2 segment come back **without MAC addresses or vendors**. If you need those, use the host-network override (`./install.sh --host-network` sets it up). By hand, turn it on in `deploy/.env`, not with `-f` flags:

```sh
# deploy/.env
COMPOSE_FILE=docker-compose.yml:docker-compose.host-network.yml
```

```sh
docker compose up -d --build
```

Every `docker compose` command then loads the override, which matters: a command given only `docker-compose.yml` (for example a `docker compose run`) recreates Postgres and Redis without the ports the host-network backend needs, and the backend loses its database. Setting `COMPOSE_FILE` also stops Compose from loading `docker-compose.override.yml` by itself. If you have one (the Git mirror key below), add it to the list: `COMPOSE_FILE=docker-compose.yml:docker-compose.host-network.yml:docker-compose.override.yml`.

With the override, the backend and nginx share the host's network. The API listens on 127.0.0.1:3000 only, Postgres and Redis are published on 127.0.0.1 only, and the UI listens on `HTTP_PORT` on every interface.

**TLS.** The bundled nginx speaks plain HTTP on `HTTP_PORT`. Browse to `http://<host>:8080`: a browser that tries `https://` on that port (typed, or Firefox's HTTPS-Only Mode) shows `SSL_ERROR_RX_RECORD_TOO_LONG`. Add an exception for the address, or put TLS in front. The app handles device and cloud credentials, so run it behind TLS beyond a lab:

- If a TLS-terminating reverse proxy (host nginx, Caddy, Traefik, a load balancer) runs in front, set `TRUST_PROXY=2` so rate limiting sees real client IPs.
- Bind the UI to loopback when the proxy runs on the same host: `HTTP_BIND=127.0.0.1`.

A minimal same-host setup with the host's nginx in front: in `deploy/.env` set
`HTTP_BIND=127.0.0.1` and `TRUST_PROXY=2` (two proxies: the host nginx, then
the bundled one), run `docker compose up -d`, and add a site like this to the
host's nginx (certificates from certbot or your own CA):

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {
    listen 443 ssl;
    http2 on;
    server_name nethelper.example.com;
    ssl_certificate     /etc/letsencrypt/live/nethelper.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/nethelper.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:8080;   # the bundled UI (HTTP_PORT)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;          # Socket.io
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 1h;
        add_header Strict-Transport-Security "max-age=31536000" always;
    }
}
```

The bundled nginx already adds the security headers and proxies `/api`,
`/socket.io` and `/health` to the backend. With the host-network override the
UI listens on every interface regardless of `HTTP_BIND`; firewall `HTTP_PORT`
so only the host nginx reaches it.

Without TLS, sign-in passwords and the device and cloud credentials you enter
cross the network in clear text: run plain HTTP only on a trusted management
network.

**Where data lives** (named volumes):

| Volume | Contents |
|---|---|
| `nethelper_pgdata` | PostgreSQL database |
| `nethelper_redisdata` | Redis (job queues, token cache; rebuildable) |
| `nethelper_nethelper-data` | `/data/config-backups` (flat config files), `/data/config-repo` (Git mirror), and `/data/git-known_hosts` (the mirror's SSH host key) |

To mirror backups to a remote over SSH, mount the key read-only into the backend container, then enter that path in Settings → Git mirror. For example, create `deploy/docker-compose.override.yml`:

```yaml
services:
  backend:
    volumes:
      - /srv/nethelper/git_ed25519:/run/secrets/git_ed25519:ro
```

With the host-network override, add this file to `COMPOSE_FILE` (see above); otherwise Compose ignores it. The remote must be private: device configs contain secrets. On GitHub, add the public key as a deploy key with write access.

The mounted file must be readable by uid 1000. The remote's host key is accepted on first use and remembered in `/data/git-known_hosts`, on the data volume, so it survives recreating the container. To pin the key instead of trusting the first connection, write it there before the first push (`ssh-keyscan <host>`, checked against the fingerprint your Git server publishes).

**Logs:** `docker compose logs -f backend`. In production, logs are JSON on stdout.

---

## Bare metal (systemd + nginx)

Tested layout (adjust the unit file if yours differs):

| Path | Contents |
|---|---|
| `/opt/nethelper` | The code (a checkout of this repository, or a release tarball) |
| `/etc/nethelper/backend.env` | Configuration and secrets (mode 0640, owner `root:nethelper`) |
| `/var/lib/nethelper` | Config backups and the Git mirror; also the service user's home |
| `/var/log/nethelper` | Log files (rotate at 10 MB, 5 kept; also in the journal) |

1. **Packages.** Install Node.js 22+ at `/usr/bin/node`. Node 20 is end-of-life and some dependencies require 22, so where the distro ships 20 (Debian 12 and 13, Ubuntu 24.04), use NodeSource:

   ```sh
   curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
   apt install nodejs
   ```

   Then the rest:

   ```sh
   apt install postgresql redis-server nginx nmap iproute2 iputils-ping git openssh-client
   ```

   Tested on Debian 13 with PostgreSQL 17, Redis 8 and nginx 1.26.

2. **Service user, directories, and the admin helper**:

   ```sh
   useradd --system --home-dir /var/lib/nethelper --shell /usr/sbin/nologin nethelper
   install -d -o nethelper -g nethelper -m 0750 /var/lib/nethelper /var/log/nethelper
   install -d -o root -g nethelper -m 0750 /etc/nethelper
   ln -s /opt/nethelper/deploy/systemd/nethelper-admin /usr/local/sbin/nethelper-admin
   ```

   `nethelper-admin` (run as root) writes the settings file and runs the backend's user and key-rotation scripts as the `nethelper` user with that file loaded. `nethelper-admin --help` lists its commands.

3. **Configuration**:

   ```sh
   nethelper-admin init-env
   ```

   This writes `/etc/nethelper/backend.env` (mode 0640, group `nethelper`) from `deploy/systemd/backend.env.example`, with generated values for `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `REDIS_PASSWORD` and the database password in `DATABASE_URL`. It prints the database and Redis passwords for the next step. It never overwrites an existing file. By hand: copy the template there (`install -o root -g nethelper -m 0640 …`) and fill in those values, each from `openssl rand -hex 32`. Never start from `backend/.env.example`: that one is for development.

   Don't add `NODE_ENV`, `BIND_ADDRESS`, `TRUST_PROXY`, `LOG_DIR`, or the backup paths. The unit sets them, and systemd lets this file override the unit: a copied development value such as `LOG_DIR=./logs` makes the service crash-loop (it can't write inside `/opt`), and `NODE_ENV=development` would run it in development mode on every interface.

4. **Database and Redis**, with the passwords `init-env` printed:

   ```sh
   sudo -u postgres createuser nethelper
   sudo -u postgres psql -c "ALTER USER nethelper PASSWORD '<database password>'"
   sudo -u postgres createdb -O nethelper nethelper
   ```

   Redis: set `requirepass <redis password>` in `/etc/redis/redis.conf` and restart it.

5. **Dependencies and build**:

   ```sh
   cd /opt/nethelper/backend  && npm ci --omit=dev && npx prisma generate
   cd /opt/nethelper/frontend && npm ci && npm run build   # produces dist/
   ```

   A release tarball already contains `frontend/dist`, so skip the second line.

6. **Backend service.** It migrates the database, then starts:

   ```sh
   cp /opt/nethelper/deploy/systemd/nethelper-backend.service /etc/systemd/system/
   systemctl daemon-reload && systemctl enable --now nethelper-backend
   curl -s 127.0.0.1:3000/health/ready     # {"status":"ready",...}
   ```

7. **nginx and TLS.** Edit `server_name` and the certificate paths first (certbot, your internal CA, or for a lab a self-signed certificate with the host's name and IP in `subjectAltName`), then install the site:

   ```sh
   cp /opt/nethelper/frontend/nginx/security-headers.conf /etc/nginx/snippets/nethelper-security-headers.conf
   cp /opt/nethelper/deploy/nginx/nethelper.conf /etc/nginx/sites-available/
   ln -s ../sites-available/nethelper.conf /etc/nginx/sites-enabled/
   nginx -t && systemctl reload nginx
   ```

8. **First admin.** It prints a generated password once (or set `NETHELPER_ADMIN_PASSWORD` to choose it). Change it after signing in, then add other users on the Users page:

   ```sh
   nethelper-admin users create-admin --email you@example.com --name "Your Name"
   ```

   `nethelper-admin users` with no arguments opens the interactive user menu.

The unit is sandboxed:

- Its only capability is `CAP_NET_RAW`, which the ping monitor's ICMP needs.
- Discovery runs `nmap -sn` without privileges and reads MAC addresses from the kernel neighbour table.
- The unit can only write to `/var/lib/nethelper` and `/var/log/nethelper`.
- Put Git mirror SSH keys under `/var/lib/nethelper/.ssh/` (owner `nethelper`, mode 0600).
- The Git mirror remembers the remote's host key in `git-known_hosts` next to the repository (`/var/lib/nethelper/git-known_hosts` with the default layout). It still reads the service user's `~/.ssh/known_hosts`.

**Logs:**

```sh
journalctl -u nethelper-backend -f
```

The same entries are also in `/var/log/nethelper/*.log`.

---

## Backup and restore

What to back up, in order of importance:

1. **`ENCRYPTION_KEY`** (in `deploy/.env` or `/etc/nethelper/backend.env`). Every stored device, cloud, and Git credential is encrypted with it. A database backup without the key restores with unreadable credentials. Keep it somewhere other than the database backups.
2. **PostgreSQL**: inventory, users, integrations, schedules, and backup metadata.
3. **Config backup files**: the flat files are authoritative for backup content.
4. **The Git mirror**, if enabled and not pushed to a remote. When it is pushed, the remote is the backup.

Redis only holds queues and caches; it doesn't need backing up.

**Docker Compose:**

```sh
# Database
docker compose exec -T postgres pg_dump -U nethelper -Fc nethelper > nethelper-$(date +%F).dump
# Config backups + Git mirror
docker run --rm -v nethelper_nethelper-data:/data -v "$PWD":/out alpine \
  tar czf /out/nethelper-data-$(date +%F).tgz -C /data .
```

Restore into a fresh stack (`up -d postgres` first):

```sh
docker compose exec -T postgres pg_restore -U nethelper -d nethelper --clean --if-exists < nethelper-YYYY-MM-DD.dump
docker run --rm -v nethelper_nethelper-data:/data -v "$PWD":/in alpine \
  tar xzf /in/nethelper-data-YYYY-MM-DD.tgz -C /data
docker compose up -d
```

**Bare metal:**

```sh
sudo -u postgres pg_dump -Fc nethelper > nethelper-$(date +%F).dump
tar czf nethelper-data-$(date +%F).tgz -C /var/lib/nethelper config-backups config-repo
```

Restore with `pg_restore --clean --if-exists -d nethelper`, then untar into `/var/lib/nethelper`. Stop the service while you restore.

The backup rows store absolute file paths. Restore the files to the same location they were taken from: `/data/...` in Docker, or `/var/lib/nethelper/...` on bare metal.

---

## Device accounts and live monitoring

Give NetHelper its own account on each device rather than reusing a person's.
NetHelper only reads from devices, but some platforms need more than a basic
read-only login to read the configuration:

| Platform | Account |
|---|---|
| AOS-CX | A dedicated local user; tested with an administrator account. REST must be on (`https-server rest access-mode read-write`, `https-server vrf <vrf>`) |
| AOS-S | **Manager** level: an operator login can't read `running-config` |
| Junos | A login class with `view` and `view-configuration` (without it, config reads come back as `/* ACCESS-DENIED */`); NETCONF on with `set system services netconf ssh` |

Live monitoring (the **Always monitor** switch on a device's Live tab) keeps
one REST session open per monitored switch, and AOS-CX allows only 6 REST
sessions per user by default; backups and polls open short-lived sessions on
top of that. Details: [`docs/hardware/`](../docs/hardware/). What to do after
the install, step by step: [`docs/GETTING_STARTED.md`](../docs/GETTING_STARTED.md).

Run **one** backend instance. Each backend process watches every device with
live monitoring turned on, so two replicas would open duplicate sessions and
record every event twice. Live-monitoring settings are in
[`docs/CONFIGURATION.md`](../docs/CONFIGURATION.md#live-portpoe-state).

## Upgrading

Migrations run automatically on start in both setups. Take a database backup first: migrations are forward-only.

From a release tarball, unpack the new release next to the old tree and swap them. With Docker Compose, copy `deploy/.env` (and `deploy/docker-compose.override.yml`, if you have one) into the new tree first: they live in the tree.

**Docker Compose:**

```sh
cd /opt/nethelper && git pull     # or swap in the new release
cd deploy && ./install.sh         # pulls or builds, restarts, waits for healthy
```

By hand, replace the last line with `docker compose up -d --build` (or `docker compose pull && docker compose up -d` for the release images), then `docker compose ps` until both are healthy. If `deploy/.env` sets `NETHELPER_VERSION` (older `.env.example` files did), delete that line, or the old version stays pinned; `install.sh` warns about it.

**Bare metal:**

```sh
cd /opt/nethelper && git pull            # or swap in the new release
cd backend  && npm ci --omit=dev && npx prisma generate
cd ../frontend && npm ci && npm run build   # not needed from a release tarball
systemctl restart nethelper-backend      # migrates, then starts
```

Nginx needs no reload unless its config changed; browsers pick up the new SPA on the next page load.

## Rotating the encryption key

Changing `ENCRYPTION_KEY` makes stored secrets unreadable unless they are re-encrypted:

1. Stop the backend.
2. Put the new key in the config, and keep the old one to hand.
3. Run the rotation script. It rewrites all the secrets or none of them, and `--dry-run` previews it first.
4. Start the backend again.

The command for step 3:

```sh
# Docker Compose
docker compose run --rm -e OLD_ENCRYPTION_KEY='<old key>' backend npm run key:rotate   # preview: ... key:rotate -- --dry-run
# Bare metal (as root)
OLD_ENCRYPTION_KEY='<old key>' nethelper-admin rotate-key                              # preview: rotate-key --dry-run
```
