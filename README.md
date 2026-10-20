# NetHelper

Multi-vendor network inventory, monitoring, and configuration backup. NetHelper keeps one view of your switches, access points, and gateways, whether they're managed through a cloud controller (Aruba Central, Juniper Mist) or reached directly (AOS-CX REST, AOS-S SSH, Junos NETCONF). It tracks their status and keeps versioned, diffable backups of their configurations.

**Status: 0.9 beta** (`VERSION`). A private, in-house release. What works, what doesn't, and how to report problems: [`docs/BETA_NOTES.md`](docs/BETA_NOTES.md).

## Running it

- **Install** (Docker Compose or systemd + nginx), first admin, backups, and upgrades: [`deploy/README.md`](deploy/README.md)
- **Every setting**: [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md)
- **Changes**: [`CHANGELOG.md`](CHANGELOG.md)

## Developing

```
backend/    Node.js API: Express, Prisma (PostgreSQL), Bull (Redis), Socket.io
frontend/   Vue 3 SPA: Vuetify, Pinia, Vite
deploy/     Docker Compose, systemd, nginx
docs/       Architecture, roadmap, configuration, beta notes
```

Needs Node 22+, PostgreSQL 15+, Redis 7+, and `nmap` on the backend host.

```sh
cd backend  && npm ci && cp .env.example .env   # set DATABASE_URL and the secrets
npm run db:migrate
npm run user:manage -- create-admin --email you@example.com --name "Your Name"
npm run dev                                     # API on :3000

cd ../frontend && npm ci && npm run dev         # UI on :5173, proxies /api to :3000
```

`npm run ci` in each tier runs lint and tests (and, in the frontend, the production build).

Architecture: [`docs/MULTI_VENDOR_ROADMAP.md`](docs/MULTI_VENDOR_ROADMAP.md). Forward-looking work: [`docs/ROADMAP_AND_TODO.md`](docs/ROADMAP_AND_TODO.md).

## License

GNU Affero General Public License v3.0 or later. See [`LICENSE`](LICENSE).
