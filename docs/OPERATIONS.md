# Operating NetHelper

Running an installed NetHelper: backing it up and restoring it, upgrading, rotating the encryption key, managing users from the server, logs and health probes. Installing it is in [`INSTALL.md`](INSTALL.md); every setting is in [`CONFIGURATION.md`](CONFIGURATION.md).

Commands are given for both setups. **Docker Compose** commands run from the tree's `deploy` folder (`/opt/nethelper/deploy`); **bare metal** commands run as root.

---

## Backup and restore

What a full recovery needs:

1. **`ENCRYPTION_KEY`** (in `deploy/.env` or `/etc/nethelper/backend.env`). Every stored device, cloud, and Git credential is encrypted with it. A database backup without the key restores with unreadable credentials. Keep a copy somewhere other than the backups.
2. **PostgreSQL**: inventory, users, integrations, schedules, alerts, and backup metadata.
3. **Config backup files**: the flat files are authoritative for backup content.
4. **The Git mirror**, if enabled and not pushed to a remote. When it is pushed, the remote is the backup.

Redis only holds queues and caches; it doesn't need backing up.

### Application backups (built in)

**Settings → App Backup** (admins) takes items 2–4 in one archive, on a schedule (default daily at 02:00, newest 14 kept) or with **Run now**. Each archive holds a `pg_dump` of the database, the config-backup files, optionally the Git mirror repository, the mirror's SSH host keys, and a manifest with checksums and versions. A failed run raises the **Application backup failed** alert, and a schedule with no success since the time two scheduled runs back raises **Application backup overdue** (the schedule stopped firing, or every run since failed); notification channels can send on both.

- **Where**: `APP_BACKUP_PATH`, `/data/app-backups` in Docker and `/var/lib/nethelper/app-backups` on bare metal. Archives are mode 0600, with a `.json` summary next to each. That location is on the same disk as what it backs up: copy the archives off the host (download them from the page, or sync the directory), or point `APP_BACKUP_PATH` at another disk or a mounted network share. In Docker, mount it in `deploy/docker-compose.override.yml`:

  ```yaml
  services:
    backend:
      environment:
        APP_BACKUP_PATH: /backups
      volumes:
        - /mnt/nas/nethelper:/backups
  ```

  The directory must be writable by uid 1000 (Docker) or the `nethelper` user.
- **Off-host copy over SFTP**: set a destination on the same page (host, port, user, password or private key, and a folder that already exists). After each run, every archive kept locally that the server lacks is copied there (through a `.partial` file, size-checked, then renamed), and the same retention applies there; other files in the folder are left alone. Archives must be encrypted to be copied. The server's host key is pinned on the first connection (**Save and test connection** shows it) and a changed key is refused until you **Forget** it. A failed copy leaves the local archive in place, raises **Application backup not copied off-host**, and is retried by the next run. To restore from the copy, fetch the archive back to `APP_BACKUP_PATH` first.
- **Encryption**: optional, with a passphrase (AES-256-GCM). Only an encrypted archive can carry `ENCRYPTION_KEY` (a setting, off by default), so a restore on a new host can read the stored credentials. Keep the passphrase somewhere other than this server: the copy NetHelper stores is lost with it. An unencrypted archive never contains the key, but it does hold device configs with their secrets.
- **Needs** `pg_dump` and `tar`. The Docker image ships `pg_dump` 17, which dumps PostgreSQL 15–17. On bare metal, install `postgresql-client` of the server's major version or newer. The page says when the tool is missing or too old.

**Restore** with NetHelper stopped. The restore checks the archive first: checksums, that it isn't from a newer NetHelper, that `pg_restore` can read it, and that `ENCRYPTION_KEY` matches the one the backup was made with. Then it replaces the database **in one transaction** (a failure leaves the database as it was), copies the files into place, and moves stored file paths when the folders differ from the backed-up host (e.g. from Docker to bare metal). Newer migrations run when NetHelper starts. `--dry-run` only checks.

Docker Compose:

```sh
docker compose stop backend
docker compose run --rm backend node scripts/app-restore.js --file /data/app-backups/<archive> --dry-run
docker compose run --rm backend node scripts/app-restore.js --file /data/app-backups/<archive>
docker compose up -d
```

To restore an archive from elsewhere, copy it into the volume first (`docker compose cp <archive> backend:/data/app-backups/`, with the backend container created), or mount its directory in the `run` command (`-v "$PWD":/restore`).

Bare metal (stops and restarts `nethelper-backend` itself):

```sh
sudo nethelper-admin restore /var/lib/nethelper/app-backups/<archive> --dry-run
sudo nethelper-admin restore /var/lib/nethelper/app-backups/<archive>
```

For an encrypted archive, the passphrase is asked for, or taken from `NETHELPER_BACKUP_PASSPHRASE` (or `--passphrase-file`). On a new host whose `ENCRYPTION_KEY` differs, the restore refuses. If the archive carries the original key, `--key-out <file>` writes it out: put it in the settings as `ENCRYPTION_KEY`, then run the restore again. `--force` restores anyway, leaving stored credentials unreadable (re-enter them in Settings).

### Manual backup (without the app)

The same data by hand, e.g. for a host where the backend doesn't start:

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

A manual restore doesn't move stored file paths: restore the files to the same location they were taken from (`/data/...` in Docker, or `/var/lib/nethelper/...` on bare metal).

---

## Upgrading

Admins see when a newer release is out: on the System Status page and next to the version at the right of the status bar (a daily look at this project's public release list on GitHub; `UPDATE_CHECK_ENABLED=false` turns it off). NetHelper never updates itself: upgrading is a command on the server.

Migrations run automatically on start in both setups, and they are forward-only, so every upgrade starts with a backup.

### One command (an install from a release tarball)

```sh
# Docker Compose, from the tree's deploy folder
./install.sh --upgrade

# Bare metal, as root
nethelper-admin upgrade
```

Both do the same things, in this order, and change nothing until the swap:

1. Find the newest release (or `--version 0.9.2` for a particular one), download it next to the current tree and check it against its published checksum.
2. Bare metal only: install the backend's dependencies in the new tree.
3. Take an application backup with your Settings → App Backup settings (`--no-backup` skips it; a backup that fails stops the upgrade).
4. Swap the trees. The path stays the same and the old tree is kept as `<tree>.previous` (one is kept; the next upgrade replaces it). Docker carries over `deploy/.env` and `deploy/docker-compose.override.yml`; anything else you added to the old tree stays in `<tree>.previous`.
5. Start the new version and wait until it is healthy: Docker runs the new release's `install.sh` (pulls or builds, restarts), bare metal restarts `nethelper-backend`.

Notes:

- If the new version doesn't come up, nothing is rolled back for you. The command prints where the old tree and the backup are, and whether the new release has database migrations: without any, swapping the trees back is enough; with them, restore the backup first ([Backup and restore](#backup-and-restore)).
- A release older than the installed one is refused.
- Bare metal: the command lists the unit, nginx site and security-headers files when the release changed them, since your install has its own copies. It never overwrites those.
- Docker: a `NETHELPER_VERSION` line in `deploy/.env` would keep the old images, so the command refuses to run until it is deleted.
- A host without internet access can point the command at a mirror: `NETHELPER_RELEASE_BASE` (a URL holding `v<version>/nethelper-<version>.tar.gz` and its `.sha256`) together with `--version`.
- The command first shipped after 0.9.0, so the upgrade *from* 0.9.0 (or a beta) is still by hand, below.

### By hand (a git checkout, or an install older than the upgrade command)

Take a backup first (Settings → App Backup → Run now).

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
3. Run the rotation script. It rewrites all the secrets (credentials, integrations, the Git mirror, notification webhooks, the app backup passphrase and SFTP login, automation HTTP headers) or none of them, and `--dry-run` previews it first.
4. Start the backend again.

The command for step 3:

```sh
# Docker Compose
docker compose run --rm -e OLD_ENCRYPTION_KEY='<old key>' backend npm run key:rotate   # preview: ... key:rotate -- --dry-run
# Bare metal (as root)
OLD_ENCRYPTION_KEY='<old key>' nethelper-admin rotate-key                              # preview: rotate-key --dry-run
```

---

## Managing users from the server

Admins manage users on the **Users** page. From the server, for a first admin or when no admin can sign in:

```sh
# Docker Compose
docker compose exec backend npm run user:manage
# Bare metal
nethelper-admin users
```

With no arguments, both open an interactive menu for listing, editing, and deleting users, and resetting passwords. `create-admin --email you@example.com --name "Your Name"` after either command creates an admin without the menu and prints a generated password once.

## Logs

In production, logs are JSON on stdout.

```sh
# Docker Compose
docker compose logs -f backend
# Bare metal
journalctl -u nethelper-backend -f
```

On bare metal the same entries are also in `/var/log/nethelper/*.log` (rotated at 10 MB, 5 kept).

## Health probes

For a load balancer or monitoring: `/health` (liveness) and `/health/ready` (database and Redis; 503 when either is down), without authentication. Docker Compose: `http://<host>:8080/health`, passed through the bundled nginx to the backend. Bare metal: `127.0.0.1:3000/health` on the host, or through your nginx site.
