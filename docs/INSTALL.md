# Installing NetHelper

The short version is in the [README](../README.md#install): unpack a release and run `deploy/install.sh`. This page is the long version: what the installer does, Docker Compose by hand, bare metal, TLS, and where the data lives.

Afterwards: [`GETTING_STARTED.md`](GETTING_STARTED.md) for the first hour in the app, and [`OPERATIONS.md`](OPERATIONS.md) for backups, upgrades and key rotation. What's supported, known limitations, and how to report problems: [`SUPPORT.md`](SUPPORT.md). Every setting: [`CONFIGURATION.md`](CONFIGURATION.md).

Two supported ways to run NetHelper:

- **Docker Compose**: everything, including Postgres and Redis, in containers. Quickest to stand up.
- **Bare metal**: systemd runs the backend and nginx serves the UI, on a Debian or Ubuntu host with Postgres and Redis from the distro.

Both were installed from this runbook on clean Debian 13 (trixie) VMs on 2026-10-20. Debian 12 and Ubuntu 24.04 should work the same way but haven't been run end to end.

Either way, the browser talks to one origin: nginx serves the SPA and proxies `/api` and `/socket.io` to the backend. You don't need `CORS_ORIGINS` unless the UI is served from somewhere else.

## Get a release

Each release on GitHub has `nethelper-<version>.tar.gz` (the source plus a prebuilt UI, so bare metal skips the frontend build) and its checksum. Unpack it at `/opt/nethelper`; every command on this page runs from that tree:

```sh
base=https://github.com/bryanbuck/nethelper/releases/download/v0.9.1-beta.1
curl -fLO "$base/nethelper-0.9.1-beta.1.tar.gz" -fLO "$base/nethelper-0.9.1-beta.1.tar.gz.sha256"
sha256sum -c nethelper-0.9.1-beta.1.tar.gz.sha256
tar xzf nethelper-0.9.1-beta.1.tar.gz && mv nethelper-0.9.1-beta.1 /opt/nethelper
```

Install from a release, not a `git clone`, unless you're working on the code: see [From source](#from-source-a-git-checkout).

---

## Docker Compose

### Install Docker

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

(On Ubuntu, use `linux/ubuntu` in both URLs.)

### Run the installer

```sh
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

Back up `deploy/.env` afterwards: its `ENCRYPTION_KEY` decrypts every stored credential (see [Backup and restore](OPERATIONS.md#backup-and-restore)). Then sign in, change the admin's password, and follow [`GETTING_STARTED.md`](GETTING_STARTED.md).

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

The backend applies database migrations every time it starts, and does nothing when the schema is already current. Set `RUN_MIGRATIONS=false` on the backend service to turn that off.

### First admin

There's no self-signup. `install.sh` creates the first admin; by hand, once the backend is healthy:

```sh
docker compose exec backend npm run user:manage -- create-admin --email you@example.com --name "Your Name"
```

It prints a generated password once. To choose the password instead, pass `-e NETHELPER_ADMIN_PASSWORD=...` after `exec`. Then:

1. Browse to `http://<host>:8080` (or your `HTTP_PORT`) and sign in.
2. Change the password from the account menu (top right).
3. Add everyone else on the **Users** page.

### Network access and discovery

In the default (bridge) setup, the backend reaches devices through Docker's NAT. That covers ping monitoring, SSH, REST, NETCONF, cloud APIs, and discovery of hosts on any routed subnet. What it can't see is the host's own ARP table, so hosts discovered on the local L2 segment come back **without MAC addresses or vendors**. If you need those, use the host-network override (`./install.sh --host-network` sets it up). By hand, turn it on in `deploy/.env`, not with `-f` flags:

```sh
# deploy/.env
COMPOSE_FILE=docker-compose.yml:docker-compose.host-network.yml
```

```sh
docker compose up -d --build
```

Every `docker compose` command then loads the override, which matters: a command given only `docker-compose.yml` (for example a `docker compose run`) recreates Postgres and Redis without the ports the host-network backend needs, and the backend loses its database. Setting `COMPOSE_FILE` also stops Compose from loading `docker-compose.override.yml` by itself. If you have one (the Git mirror key below), add it to the list: `COMPOSE_FILE=docker-compose.yml:docker-compose.host-network.yml:docker-compose.override.yml`.

With the override, the backend and nginx share the host's network. The API listens on 127.0.0.1:3000 only, Postgres and Redis are published on 127.0.0.1 only, and the UI listens on `HTTP_PORT` on every interface.

### TLS

The bundled nginx speaks plain HTTP on `HTTP_PORT`. Browse to `http://<host>:8080`: a browser that tries `https://` on that port (typed, or Firefox's HTTPS-Only Mode) shows `SSL_ERROR_RX_RECORD_TOO_LONG`. Add an exception for the address, or put TLS in front. The app handles device and cloud credentials, so run it behind TLS beyond a lab:

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

### Where data lives

Named volumes:

| Volume | Contents |
|---|---|
| `nethelper_pgdata` | PostgreSQL database |
| `nethelper_redisdata` | Redis (job queues, token cache; rebuildable) |
| `nethelper_nethelper-data` | `/data/config-backups` (flat config files), `/data/config-repo` (Git mirror), `/data/git-known_hosts` (the mirror's SSH host key), and `/data/app-backups` (application backups; see [Backup and restore](OPERATIONS.md#backup-and-restore)) |

To mirror backups to a remote over SSH, mount the key read-only into the backend container, then enter that path in Settings → Git mirror. For example, create `deploy/docker-compose.override.yml`:

```yaml
services:
  backend:
    volumes:
      - /srv/nethelper/git_ed25519:/run/secrets/git_ed25519:ro
```

With the host-network override, add this file to `COMPOSE_FILE` (see above); otherwise Compose ignores it. The remote must be private: device configs contain secrets. On GitHub, add the public key as a deploy key with write access.

The mounted file must be readable by uid 1000. The remote's host key is accepted on first use and remembered in `/data/git-known_hosts`, on the data volume, so it survives recreating the container. To pin the key instead of trusting the first connection, write it there before the first push (`ssh-keyscan <host>`, checked against the fingerprint your Git server publishes).

Logs and health probes: [`OPERATIONS.md`](OPERATIONS.md#logs).

---

## Bare metal (systemd + nginx)

Tested layout (adjust the unit file if yours differs):

| Path | Contents |
|---|---|
| `/opt/nethelper` | The code (a checkout of this repository, or a release tarball) |
| `/etc/nethelper/backend.env` | Configuration and secrets (mode 0640, owner `root:nethelper`) |
| `/var/lib/nethelper` | Config backups, the Git mirror and application backups; also the service user's home |
| `/var/log/nethelper` | Log files (rotate at 10 MB, 5 kept; also in the journal) |

1. **Packages.** Install Node.js 22+ at `/usr/bin/node`. Node 20 is end-of-life and some dependencies require 22, so where the distro ships 20 (Debian 12 and 13, Ubuntu 24.04), use NodeSource:

   ```sh
   curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
   apt install nodejs
   ```

   Then the rest:

   ```sh
   apt install postgresql postgresql-client redis-server nginx nmap iproute2 iputils-ping git openssh-client
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

Logs: [`OPERATIONS.md`](OPERATIONS.md#logs).

---

## From source (a git checkout)

A `git clone` of the repository installs the same way (`cd deploy && ./install.sh`, or the bare-metal steps above). It is the right choice for working on the code or trying a branch. For simply running NetHelper, a release is better:

- `master` is whatever was merged last, not a release.
- In a checkout that isn't at a release tag, `install.sh` builds the images on the host instead of pulling them: a few minutes, with access to the npm registry.
- The one-command upgrade refuses a git checkout. Upgrade with `git pull` and the steps in [`OPERATIONS.md`](OPERATIONS.md#by-hand-a-git-checkout-or-an-install-older-than-the-upgrade-command).
- Bare metal has to build the UI (step 5).

Setting up a development environment is a different thing: see "Developing" in the [README](../README.md#developing) and [`CONTRIBUTING.md`](../CONTRIBUTING.md).

---

## Device accounts and live monitoring

Give NetHelper its own account on each device rather than reusing a person's.
NetHelper only reads from devices, but some platforms need more than a basic
read-only login to read the configuration. The rights each platform needs, and
what to turn on on the device, are in the table at the top of
[`GETTING_STARTED.md`](GETTING_STARTED.md#before-you-start).

Live monitoring (the **Always monitor** switch on a device's Live tab) keeps
one REST session open per monitored switch, and AOS-CX allows only 6 REST
sessions per user by default; backups and polls open short-lived sessions on
top of that. Details: [`hardware/`](hardware/). What to do after
the install, step by step: [`GETTING_STARTED.md`](GETTING_STARTED.md).

Run **one** backend instance. Each backend process watches every device with
live monitoring turned on, so two replicas would open duplicate sessions and
record every event twice. Live-monitoring settings are in
[`CONFIGURATION.md`](CONFIGURATION.md#live-portpoe-state).
