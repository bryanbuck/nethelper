# NetHelper

Multi-vendor network inventory, monitoring, and configuration backup. NetHelper keeps one view of your switches, access points, and gateways, whether they're managed through a cloud controller (Aruba Central, Juniper Mist) or reached directly (AOS-CX REST, AOS-S SSH, Junos NETCONF, Cisco IOS/IOS-XE SSH). It tracks their status and keeps versioned, diffable backups of their configurations.

**Status: 0.9** (`VERSION`), open to anyone who wants to try it. Pre-1.0: behavior may still change between minor versions, and automations are experimental. What works, what has been tested on real equipment, what doesn't work yet, and how to report problems: [`docs/SUPPORT.md`](docs/SUPPORT.md).

## Install

You need a Linux host with Docker Engine and the Compose plugin ([installing Docker](docs/INSTALL.md#install-docker); Debian 13 is tested), and network reach from it to your devices' management addresses (ICMP, plus HTTPS or SSH).

As root, download the release, check it, unpack it, and run the installer:

```sh
base=https://github.com/bryanbuck/nethelper/releases/download/v0.9.1-beta.1
curl -fLO "$base/nethelper-0.9.1-beta.1.tar.gz" -fLO "$base/nethelper-0.9.1-beta.1.tar.gz.sha256"
sha256sum -c nethelper-0.9.1-beta.1.tar.gz.sha256
tar xzf nethelper-0.9.1-beta.1.tar.gz && mv nethelper-0.9.1-beta.1 /opt/nethelper
cd /opt/nethelper/deploy && ./install.sh
```

The installer generates the secrets, pulls the images, starts everything, and asks for the first admin's email and name. At the end it prints the address to sign in at (`http://<host>:8080`) and the admin's generated password. Then:

1. Keep a copy of `/opt/nethelper/deploy/.env` somewhere safe: its `ENCRYPTION_KEY` decrypts every stored credential.
2. Sign in and follow [Getting started](docs/GETTING_STARTED.md): connect your clouds, add devices and their credentials, take the first backups.
3. Beyond a lab, [put TLS in front](docs/INSTALL.md#tls): the installer serves plain HTTP.

Later, `./install.sh --upgrade` in the same folder moves to the newest release ([Upgrading](docs/OPERATIONS.md#upgrading)).

Without Docker, NetHelper runs on Debian or Ubuntu with systemd, nginx, PostgreSQL and Redis: [bare metal](docs/INSTALL.md#bare-metal-systemd--nginx).

## Documentation

| I want to… | Read |
|---|---|
| Install it another way, set up TLS, or see what the installer does | [`docs/INSTALL.md`](docs/INSTALL.md) |
| Set it up after the install: clouds, devices, credentials, backups, users | [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) |
| Back it up, restore it, upgrade it, rotate the encryption key | [`docs/OPERATIONS.md`](docs/OPERATIONS.md) |
| Know what is supported and what has been tested on real equipment | [`docs/SUPPORT.md`](docs/SUPPORT.md) |
| Change a setting | [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) |
| Report a problem | [`docs/SUPPORT.md`](docs/SUPPORT.md#reporting-a-problem) |
| Report a vulnerability, or read the security model | [`SECURITY.md`](SECURITY.md) |
| See what changed in a release | [`CHANGELOG.md`](CHANGELOG.md) |

## Developing

To work on the code (to run NetHelper, use [Install](#install) above):

```sh
git clone https://github.com/bryanbuck/nethelper.git && cd nethelper
```

```
backend/    Node.js API: Express, Prisma (PostgreSQL), Bull (Redis), Socket.io
frontend/   Vue 3 SPA: Vuetify, Pinia, Vite
deploy/     Installer, Docker Compose, systemd, nginx
docs/       Install and operations guides, architecture, roadmap, configuration, support matrix
```

Needs Node 22+, PostgreSQL 15+, Redis 7+, and `nmap` on the backend host.

```sh
cd backend  && npm ci && cp .env.example .env   # set DATABASE_URL and the secrets
npm run db:migrate
npm run user:manage -- create-admin --email you@example.com --name "Your Name"
npm run dev                                     # API on :3000

cd ../frontend && npm ci && npm run dev         # UI on :5173, proxies /api to :3000
```

`npm run ci` in each tier runs lint and tests (and, in the frontend, the production build); GitHub Actions runs both on every pull request. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

Architecture: [`docs/MULTI_VENDOR_ROADMAP.md`](docs/MULTI_VENDOR_ROADMAP.md). Forward-looking work: [`docs/ROADMAP_AND_TODO.md`](docs/ROADMAP_AND_TODO.md).

## License

GNU Affero General Public License v3.0 or later. See [`LICENSE`](LICENSE).
