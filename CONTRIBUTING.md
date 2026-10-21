# Contributing to NetHelper

Thanks for helping. This page covers the workflow; the architecture and the project's conventions are in [`docs/MULTI_VENDOR_ROADMAP.md`](docs/MULTI_VENDOR_ROADMAP.md). Read this before a change of any size.

## Setup

Node 22 (see `.nvmrc`), PostgreSQL 15+, Redis 7+. The quick start in [`README.md`](README.md) gets both tiers running. Tests need neither the database nor Redis: Prisma, Redis, and every device transport are mocked.

## Workflow

1. Branch from `master` (`fix/…`, `feat/…`, `chore/…`).
2. Develop the backend and frontend together: they share an API and WebSocket contract, and several tests check that the two tiers agree.
3. Before pushing, run `npm run ci` in `backend/` (lint + Jest) and in `frontend/` (lint + Vitest + production build).
4. Open a pull request against `master` and fill in the checklist. CI runs the same `npm run ci` in both tiers, and a PR merges only when it is green and has been reviewed.

## Things CI enforces

- Every mutating route has an `authorize(...)` guard, and no static path is shadowed by a `/:param` route (`backend/tests/api/role-gates.test.js`).
- The Postman collection matches the routes and carries no credential. Run `npm run postman:generate` after any route change.
- The frontend mirrors of backend constants (vendors, device status, automation nodes, alert rules) stay in sync (`frontend/tests/unit/*-parity.spec.js`).

## Things review checks

- No secrets, real device configurations, or unanonymized captures. Fixtures marked live are anonymized real captures; new ones must be too.
- No fabricated data in the UI: charts and stats come from the API.

## Security issues

Don't open a public issue. See [`SECURITY.md`](SECURITY.md).
