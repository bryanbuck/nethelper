# Deploying NetHelper

Two supported ways to run the 0.9 beta:

- **Docker Compose**: everything, including Postgres and Redis, in containers. Quickest to stand up.
- **Bare metal**: systemd runs the backend and nginx serves the UI, on a Debian 12 / Ubuntu 24.04 host with Postgres and Redis from the distro.

Either way, the browser talks to one origin: nginx serves the SPA and proxies `/api` and `/socket.io` to the backend. You don't need `CORS_ORIGINS` unless the UI is served from somewhere else.

Files in this directory:

| File | Purpose |
|---|---|
| `docker-compose.yml` | Postgres 15, Redis 7, backend, frontend (nginx) |
| `docker-compose.host-network.yml` | Optional override for L2 discovery (MAC addresses) |
| `.env.example` | Compose settings and secrets → copy to `.env` |
| `systemd/nethelper-backend.service` | Bare-metal backend unit (sandboxed) |
| `nginx/nethelper.conf` | Bare-metal nginx site with TLS |

The images are built from `backend/Dockerfile` and `frontend/Dockerfile` (nginx config in `frontend/nginx/`).

---

## Docker Compose

Requirements: Docker Engine 24+ with Compose v2 (2.24+ for the host-network override).

```sh
cd deploy
cp .env.example .env
# Fill in the five secrets; one per line, e.g.:
#   openssl rand -hex 32
$EDITOR .env
docker compose up -d --build
docker compose ps          # backend and frontend should become "healthy"
```

The backend applies database migrations every time it starts, and does nothing when the schema is already current. Set `RUN_MIGRATIONS=false` on the backend service to turn that off.

**First admin.** There's no self-signup. Create the first admin with the interactive CLI:

```sh
docker compose run --rm backend npm run user:manage
```

Then browse to `http://<host>:8080` (or your `HTTP_PORT`) and sign in. Admins create further users in the app.

**Network access and discovery.** In the default (bridge) setup, the backend reaches devices through Docker's NAT. That covers ping monitoring, SSH, REST, NETCONF, cloud APIs, and discovery of hosts on any routed subnet. What it can't see is the host's own ARP table, so hosts discovered on the local L2 segment come back **without MAC addresses or vendors**. If you need those, add the host-network override:

```sh
docker compose -f docker-compose.yml -f docker-compose.host-network.yml up -d --build
```

With the override, the backend and nginx share the host's network. The API listens on 127.0.0.1:3000 only, Postgres and Redis are published on 127.0.0.1 only, and the UI listens on `HTTP_PORT` on every interface.

**TLS.** The bundled nginx speaks plain HTTP on `HTTP_PORT`. The app handles device and cloud credentials, so run it behind TLS beyond a lab:

- If a TLS-terminating reverse proxy (host nginx, Caddy, Traefik, a load balancer) runs in front, set `TRUST_PROXY=2` so rate limiting sees real client IPs.
- Bind the UI to loopback when the proxy runs on the same host: `HTTP_BIND=127.0.0.1`.

**Where data lives** (named volumes):

| Volume | Contents |
|---|---|
| `nethelper_pgdata` | PostgreSQL database |
| `nethelper_redisdata` | Redis (job queues, token cache; rebuildable) |
| `nethelper_nethelper-data` | `/data/config-backups` (flat config files) and `/data/config-repo` (Git mirror) |

To mirror backups to a remote over SSH, mount the key read-only into the backend container, then enter that path in Settings → Git mirror. For example, add this under the `backend` service in a `docker-compose.override.yml`:

```yaml
volumes:
  - /srv/nethelper/git_ed25519:/run/secrets/git_ed25519:ro
```

The mounted file must be readable by uid 1000. The remote's host key is accepted on first use and remembered in the container's home directory, so it is accepted again whenever the container is recreated.

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

1. **Packages.** Install Node.js 20+ at `/usr/bin/node` (the distro package, or NodeSource), plus the rest:

   ```sh
   apt install postgresql redis-server nginx nmap iproute2 iputils-ping git openssh-client
   ```

2. **Service user and directories**:

   ```sh
   useradd --system --home-dir /var/lib/nethelper --shell /usr/sbin/nologin nethelper
   install -d -o nethelper -g nethelper -m 0750 /var/lib/nethelper /var/log/nethelper
   install -d -o root -g nethelper -m 0750 /etc/nethelper
   ```

3. **Database.** Use a hex password, since it goes into a URL:

   ```sh
   sudo -u postgres createuser nethelper
   sudo -u postgres psql -c "ALTER USER nethelper PASSWORD '<hex password>'"
   sudo -u postgres createdb -O nethelper nethelper
   ```

   Redis: set `requirepass` in `/etc/redis/redis.conf` and restart it.

4. **Code, dependencies, and build**:

   ```sh
   cd /opt/nethelper/backend  && npm ci --omit=dev && npx prisma generate
   cd /opt/nethelper/frontend && npm ci && npm run build   # produces dist/
   ```

5. **Configuration.** Copy `backend/.env.example` to `/etc/nethelper/backend.env`, then:
   - Set `DATABASE_URL`, `REDIS_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `ENCRYPTION_KEY`. Generate each secret with `openssl rand -hex 32`.
   - Remove the placeholder `ARUBA_CENTRAL_*` and SMTP lines you don't use.
   - Leave `NODE_ENV`, `BIND_ADDRESS`, `TRUST_PROXY`, `LOG_DIR`, and the backup paths alone: the unit sets them.

   Then lock the file down:

   ```sh
   chown root:nethelper /etc/nethelper/backend.env
   chmod 0640 /etc/nethelper/backend.env
   ```

6. **Backend service.** It migrates the database, then starts:

   ```sh
   cp /opt/nethelper/deploy/systemd/nethelper-backend.service /etc/systemd/system/
   systemctl daemon-reload && systemctl enable --now nethelper-backend
   curl -s 127.0.0.1:3000/health/ready     # {"status":"ready",...}
   ```

7. **nginx and TLS.** Edit `server_name` and the certificate paths first, then install the site:

   ```sh
   cp /opt/nethelper/frontend/nginx/security-headers.conf /etc/nginx/snippets/nethelper-security-headers.conf
   cp /opt/nethelper/deploy/nginx/nethelper.conf /etc/nginx/sites-available/
   ln -s ../sites-available/nethelper.conf /etc/nginx/sites-enabled/
   nginx -t && systemctl reload nginx
   ```

8. **First admin**:

   ```sh
   cd /opt/nethelper/backend
   sudo -u nethelper sh -c 'set -a; . /etc/nethelper/backend.env; set +a; npm run user:manage'
   ```

The unit is sandboxed:

- Its only capability is `CAP_NET_RAW`, which the ping monitor's ICMP needs.
- Discovery runs `nmap -sn` without privileges and reads MAC addresses from the kernel neighbour table.
- The unit can only write to `/var/lib/nethelper` and `/var/log/nethelper`.
- Put Git mirror SSH keys under `/var/lib/nethelper/.ssh/` (owner `nethelper`, mode 0600).

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

## Upgrading

Migrations run automatically on start in both setups. Take a database backup first: migrations are forward-only.

**Docker Compose:**

```sh
git pull                          # or unpack the new release
cd deploy && docker compose up -d --build
docker compose ps                 # wait for healthy
```

**Bare metal:**

```sh
cd /opt/nethelper && git pull
cd backend  && npm ci --omit=dev && npx prisma generate
cd ../frontend && npm ci && npm run build
systemctl restart nethelper-backend      # migrates, then starts
```

Nginx needs no reload unless its config changed; browsers pick up the new SPA on the next page load.

## Rotating the encryption key

Changing `ENCRYPTION_KEY` makes stored secrets unreadable unless they are re-encrypted:

1. Stop the backend.
2. Put the new key in the config, and keep the old one to hand.
3. Run the rotation script. It rewrites all the secrets or none of them, and `-- --dry-run` previews it first.
4. Start the backend again.

The command for step 3:

```sh
# Docker Compose
docker compose run --rm -e OLD_ENCRYPTION_KEY='<old key>' backend npm run key:rotate
# Bare metal
cd /opt/nethelper/backend
sudo -u nethelper sh -c 'set -a; . /etc/nethelper/backend.env; set +a; OLD_ENCRYPTION_KEY="<old key>" npm run key:rotate'
```
