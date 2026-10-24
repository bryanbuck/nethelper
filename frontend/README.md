# NetHelper — Frontend

Vue 3 SPA for NetHelper: device inventory and status, discovery, configuration backups and diffs, cloud integrations, user administration, and the (experimental) automation builder.

> Architecture: [`../docs/MULTI_VENDOR_ROADMAP.md`](../docs/MULTI_VENDOR_ROADMAP.md). Contributor workflow: [`../CONTRIBUTING.md`](../CONTRIBUTING.md). Deployment: [`../deploy/README.md`](../deploy/README.md). This file covers local development only.

## Development

Needs Node 22+ and a running backend (see [`../backend/README.md`](../backend/README.md)).

```sh
npm ci
cp .env.example .env     # defaults work when the backend is on localhost:3000
npm run dev              # http://localhost:5173
```

The Vite dev server proxies `/api` and `/socket.io` to the backend, so the SPA always calls its own origin, exactly as it does behind nginx in production. To develop against a backend elsewhere or serve the dev server under another hostname, set these in `.env`:

- `DEV_PROXY_TARGET`: the backend URL (default `http://localhost:3000`).
- `DEV_ALLOWED_HOSTS`: extra hostnames the dev server answers to, comma-separated.

These are dev-server settings and never reach the bundle. All frontend settings are listed in [`../docs/CONFIGURATION.md`](../docs/CONFIGURATION.md#frontend).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/`; also the quickest full check of the app |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run test:unit` | Vitest (`tests/unit/*.spec.js`), including the vendor-list parity check against the backend |
| `npm run lint` / `lint:fix` | ESLint over `src/` |
| `npm run ci` | Lint, unit tests, and build |

## Layout

```
src/
  views/        pages: dashboard, devices (inventory, discovery, backups, firmware), automations, settings, users
  components/   reusable pieces by feature
  stores/       Pinia stores, one per feature
  services/     API clients (axios, JWT refresh in services/api.js) and the Socket.io client
  models/       vendors.js mirrors backend/src/constants/vendors.js (keep in sync)
  router/       routes and the auth/role guard
nginx/          production nginx config for the Docker image
```

New features follow the `devices` pattern: a singleton service in `services/`, a Pinia store in `stores/`, and a view in `views/<feature>/`. Show notifications through `useNotificationsStore()`.

## Stack

Vue 3 (Composition API), Vuetify 3, Pinia, Vue Router 5, Vite 8, axios, socket.io-client, Chart.js (vue-chartjs), and Vue Flow for the automation builder.
