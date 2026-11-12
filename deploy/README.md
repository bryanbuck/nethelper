# deploy/

What NetHelper is installed and upgraded with. The guides are in `docs/`:

- **Installing** (Docker Compose, bare metal, TLS): [`docs/INSTALL.md`](../docs/INSTALL.md). The short version is in the [README](../README.md#install).
- **Backups, restore, upgrades, key rotation**: [`docs/OPERATIONS.md`](../docs/OPERATIONS.md).

Files in this directory:

| File | Purpose |
|---|---|
| `install.sh` | Compose installer and upgrader ([running it](../docs/INSTALL.md#run-the-installer); `--upgrade` in [Upgrading](../docs/OPERATIONS.md#upgrading)) |
| `upgrade-lib.sh` | Shared by the two upgrade commands: fetch and check a release, swap the trees |
| `docker-compose.yml` | Postgres 15, Redis 7, backend, frontend (nginx) |
| `docker-compose.host-network.yml` | Optional override for L2 discovery (MAC addresses) |
| `.env.example` | Compose settings and secrets → copy to `.env` |
| `systemd/nethelper-backend.service` | Bare-metal backend unit (sandboxed) |
| `systemd/backend.env.example` | Bare-metal settings template → `/etc/nethelper/backend.env` |
| `systemd/nethelper-admin` | Bare-metal helper: writes that file, runs the user, key-rotation and restore scripts as the service user, and upgrades the install |
| `nginx/nethelper.conf` | Bare-metal nginx site with TLS |

The images are built from `backend/Dockerfile` and `frontend/Dockerfile` (nginx config in `frontend/nginx/`). Each release also publishes them to GHCR.

## Upgrading

Moved to [`docs/OPERATIONS.md`](../docs/OPERATIONS.md#upgrading). In short, on an install from a release tarball: `./install.sh --upgrade` in this folder (Docker Compose), or `nethelper-admin upgrade` as root (bare metal).

## Backup and restore

Moved to [`docs/OPERATIONS.md`](../docs/OPERATIONS.md#backup-and-restore).
