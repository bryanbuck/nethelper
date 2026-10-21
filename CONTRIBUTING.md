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

- Docs updated as described in [Keeping docs current](#keeping-docs-current).
- No secrets, real device configurations, or unanonymized captures. Fixtures marked live are anonymized real captures; new ones must be too.
- No fabricated data in the UI: charts and stats come from the API.

## Keeping docs current

The docs have drifted before: new work replaced old behavior, and the docs went on describing the old one. Update the docs in the same pull request as the change.

| If you change… | Update… |
|---|---|
| Something a user or operator sees | `CHANGELOG.md`, under `[Unreleased]`, linking the issue |
| An environment variable | its Joi schema in `backend/src/config/env.js`, `backend/.env.example` (and `deploy/.env.example` if Compose passes it), and `docs/CONFIGURATION.md` |
| A service, cloud provider, or transport | its entry in `docs/ROADMAP_AND_TODO.md`, plus `docs/MULTI_VENDOR_ROADMAP.md` if the architecture changes |
| A roadmap item's status (started, shipped, deferred) | its status line in `docs/ROADMAP_AND_TODO.md`, with an absolute date |
| Deployment: Dockerfiles, Compose, systemd, nginx | `deploy/README.md`. Keep the proxy blocks of the two nginx configs in sync |
| The rights NetHelper needs on a device, or the first-run steps | `docs/GETTING_STARTED.md` |
| What the beta supports, or a known limitation | `docs/BETA_NOTES.md` |
| Something you learned on real hardware | `docs/hardware/` |

And three rules:

- `docs/MULTI_VENDOR_ROADMAP.md` is authoritative for the architecture. If your change contradicts it, update it in the same pull request.
- When a change supersedes older behavior, fix or delete the text that describes the old behavior. Don't add the new description next to it.
- Don't commit point-in-time docs (one-off plans, summaries, task notes). Move whatever is still true into the docs above. Git history keeps the rest.

## Releasing

1. Set the new version everywhere it appears: `VERSION`, `version` in both `package.json` files (and their lockfiles, with `npm version <v> --no-git-tag-version` in each tier), the `NETHELPER_VERSION` defaults in `deploy/docker-compose.yml`, `ARG VITE_APP_VERSION` in `frontend/Dockerfile`, and the `gh release download` example in `deploy/README.md`. `backend/tests/unit/release-version.test.js` fails if one is missed.
2. Move the `[Unreleased]` entries in `CHANGELOG.md` under a dated heading for the version: `## [<version>] — <YYYY-MM-DD>`.
3. Merge to `master`, then tag and push the tag: `git tag v<version> && git push origin v<version>`.

The tag runs `.github/workflows/release.yml`. It checks that the tag matches `VERSION`, publishes the backend and frontend images to GHCR, and creates a GitHub release with `nethelper-<version>.tar.gz` (the source plus a prebuilt `frontend/dist`) and its checksum, using the version's `CHANGELOG.md` section as the notes. A version with a suffix (`-beta.2`) is marked as a pre-release and doesn't move the `latest` image tag. To try the workflow without publishing, run it by hand from the Actions tab: it builds everything and keeps the tarball as a workflow artifact.

## Security issues

Don't open a public issue. See [`SECURITY.md`](SECURITY.md).
