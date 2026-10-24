# NetHelper Platform — Roadmap & TODO

The single forward-looking backlog for NetHelper: features and improvements planned but not yet prioritized, plus the status of recently-shipped work.

- **Architecture & the multi-vendor phased plan** live in [`MULTI_VENDOR_ROADMAP.md`](MULTI_VENDOR_ROADMAP.md) (authoritative).
- **Project conventions** live in [`../CLAUDE.md`](../CLAUDE.md).
- **Hardware facts** the code depends on live in [`hardware/`](hardware/). Superseded point-in-time docs were deleted on 2026-10-19; git history has them.

## 🧑‍🔧 Waiting on the maintainer

Hands-on checks that need real equipment, a real host, or a browser login, which development sessions can't do themselves. Each item names where its details live; tick it here and update that place when done. Add new ones here rather than only inside a feature's section.

- [ ] **Browser click-through of the beta.4 sprint** (added 2026-10-23):
  - Device page: the Last Seen card keeps "Confirmed by <cloud> N minutes ago" current with the page left open (#46/#50); switching the History range quickly never shows the wrong window (#52).
  - Dashboard: the status cards follow a device going offline/online within seconds, without a full reload every 30 s (#51).
  - Settings → API Credentials: the credential test dialog lists the right devices (#51).
  - Devices page: Groups (create, rename, delete, "Show devices"), the table's Group bulk action and Group filter, and the automation builder's group pickers listing them (#26); Firmware Status button and its Recorded versions card, the header on a narrow window (#25).
  - Settings: Connection Test tab (operator/admin), Notifications tab (admin) (#25, item 2).
  - Icons on the device page buttons have their gap back (#27).
  - After the Vite 8 / vue-router 5 upgrade: sign-in redirect back to the page you asked for, admin-only pages, `/schedule` and `/settings/device-api-testing` redirects, the dev server's live reload.
- [ ] **Alert notifications, live** (item 2 below): a Test send to a real mailbox and to a Slack or Teams webhook; then unplug a ping-monitored device and check one message on open and one on resolve.
- [ ] **`deploy/install.sh` on a real Docker host** ("Simpler install" below): a bridge install, a `--host-network` install, and a re-run as an upgrade; check that `docker compose exec -e NAME` passes the variable through. Optionally `nethelper-admin` on bare metal.
- [ ] **VLAN overlay on hardware** (shipped untested in `v0.9.0-beta.4`; item 3a below): Refresh topology, then check the 6200F's VLANs on `/map` against `show vlan` / `show interface brief`, and capture the two REST replies as `backend/tests/fixtures/aos-cx-live/interfaces-vlans.json`; check the Mist EX's ports, and whether a Mist trunk port lists every allowed VLAN. Then remove a VLAN from a CX uplink's allowed list, refresh, and check that the link turns dashed with the right port named.
- [ ] **Junos SSH CLI fallback on hardware** (Phase 7 below): connection test, polls and a backup with NETCONF disabled.

---

> Context: NetHelper is now **multi-vendor** (Aruba/Juniper/Cisco) with a `cloud`/`direct` management model. Some items below were written in the earlier Aruba-Central-only era; where they still apply, read "Aruba Central" as "any cloud provider" and "central/direct" as "cloud/direct." Corrected inline where it matters.

---

## 🚀 Beta Release Readiness

**Status**: ✅ Shipped 2026-10-20 as `v0.9.0-beta.1` (started 2026-09-25 on `release/beta`, merged into `master`). Open follow-ups are the going-public checklist and the post-beta hardening list at the end of this section.

Preparing the dev-environment build for a private, in-house beta. Deploy targets are Docker Compose and bare metal (systemd + nginx). Scope is frozen on multi-vendor Phases 0–2; Meraki/Catalyst are post-beta, and the automation builder is labeled experimental.

- ✅ Repo hygiene (2026-09-25): untracked `backend/.env` and `backend/node_modules`; lockfiles committed; AGPL-3.0-or-later `LICENSE`.
- ✅ Auth (2026-09-25): `/auth/register` is admin-only (no self-signup); 12-character password minimum; failed-attempt rate limit on login/refresh; constant-time response for unknown users on login; logout always revokes the refresh token.
- ✅ Config & secrets (2026-09-25): startup env validation (`config/env.js`); removed the hardcoded encryption fallback key; `npm run key:rotate` re-encrypts stored secrets; log redaction (`utils/redact.js`).
- ✅ HTTP hardening (2026-09-25): `CORS_ORIGINS` replaces the hardcoded dev hosts (Express + Socket.io); `TRUST_PROXY`; `BODY_LIMIT` (2 MB default); 5xx messages are hidden in production.
- ✅ Authorization (2026-09-25): all mutating routes are role-gated; backup content/download/diff restricted to admin/operator.
- ✅ Injection (2026-09-25): nmap arguments already strictly validated. Git mirror remote URL, branch, and paths are now validated, `GIT_ALLOW_PROTOCOL` is set, and `GIT_SSH_COMMAND` quoting is fixed.
- ✅ Dependencies (2026-09-25): `npm audit fix` in both tiers; nodemailer 6 → 10; removed unused `node-cron` and `@faker-js/faker`; Vuetify 3.9.0-beta.1 → 3.13.5. Accepted: a moderate `uuid` advisory via `bull` (the only "fix" is a downgrade to bull 1.x).
- ✅ Dev/demo removal (2026-09-25): mock device generators, the dev WebSocket event simulator, and the random dashboard "network health" series removed (replaced by a real current-status chart); the add-device form no longer invents a MAC; automation node pickers use real device names; workflow JSON file import implemented; 20 empty placeholder components/pages deleted; Schedule/Executions nav items removed (routes redirect to Automations); broken forgot-password flow replaced by "ask an administrator"; Automations marked Experimental.
- ✅ Honest tests (2026-09-25): the API-credential "Test" button was a placeholder that reported success if fields were filled; it now runs the real transport-routed test via `services/connection-test.service.js`.
- ✅ Config & build (2026-09-25): Vite dev hosts/proxy target from `DEV_ALLOWED_HOSTS`/`DEV_PROXY_TARGET`; `/socket.io` proxied; same-origin API/WS defaults; production bundles strip debug console output; debug logging only via `VITE_DEBUG_LOGGING` in production. Lint is clean in both tiers (was 194 frontend warnings).
- ✅ Shutdown (2026-09-25): idempotent SIGTERM/SIGINT handling closes Socket.io, Bull queues, DB, and Redis with a 10 s force-exit (previously crashed on the duplicate signal systemd+npm+nodemon deliver).
- ✅ Optional device serial (2026-09-25): migration `optional_device_serial` makes `Device.serial` nullable (blank → NULL); per-device storage uses `deviceStorageKey()` (serial, else `device-<id>`), so any number of serial-less direct devices can exist.
- ✅ Tests (2026-09-25): backend Jest suite (`backend/tests/`, 268 tests) covers auth (admin-only register, login/refresh rotation/logout revocation), a route-table authorization sweep (every mutating route rejects viewers; admin-only actions reject operators; no static route shadowed by a param route), the transport matrix, encryption, env validation, CORS, log redaction, Git mirror settings validation, `pullConfig` fallback ordering and `CapabilityError` surfacing, retention, and Central/Mist normalization against spec-derived fixtures. Frontend Vitest (`frontend/tests/unit/`): devices/backups/settings stores and a `models/vendors.js` ↔ `constants/vendors.js` parity check. `npm run ci` in each tier runs lint + tests (+ build). No test touches a real DB, Redis, or device.
- ✅ Fixed (2026-09-25, found by the sweep): `GET /devices/groups` was shadowed by `GET /devices/:deviceId` and never reached its handler.
- ⏳ Deferred: a browser E2E smoke test (login → add device → backup → diff). Cypress was never installed; run it against a stack stood up by `deploy/install.sh -y` (2026-10-21).
- ✅ Packaging (2026-09-25): `backend/Dockerfile` + `frontend/Dockerfile` (unprivileged nginx, same-origin `/api` + `/socket.io` proxy, CSP/security headers), `deploy/docker-compose.yml` (+ host-network override for L2 discovery), bare-metal `deploy/systemd/nethelper-backend.service` (sandboxed, `CAP_NET_RAW` only) and `deploy/nginx/nethelper.conf` (TLS), operator runbook `deploy/README.md` (install, first admin, backup/restore, upgrade, key rotation). Backend: `GET /health/ready` (DB + Redis), `npm run db:deploy`, `BIND_ADDRESS`, JSON stdout logging in production, size-rotated log files (`LOG_FILES`/`LOG_DIR`), `BACKUP_GIT_REPO_PATH`. Packages renamed `nethelper-backend`/`nethelper-frontend` at `0.9.0-beta.1`; removed `db:seed` (no seed script existed) and two loose dev scripts (one hardcoded a test password). **Not yet built or run**: the dev host has no Docker or nginx; first `docker compose up` and `nginx -t` happen on the target host.
- ✅ First run & docs (2026-09-25): `npm run user:manage -- create-admin` (non-interactive bootstrap); admin **Users** page and `/api/v1/users` (list, edit name/role, reset password, delete; no self-demote/self-delete); `POST /auth/change-password` + account-menu dialog. Fixed a data-loss hazard: deleting a user cascade-deleted the cloud integrations, credentials, and Git mirror config they created (and failed outright for automation owners); deletion now transfers them to an admin (`services/user-lifecycle.js`, used by the API and the CLI). Docs: root `README.md`, `CHANGELOG.md`, `VERSION`, `docs/BETA_NOTES.md` (support matrix with honest verification status, limitations, bug-report checklist), `docs/CONFIGURATION.md` (every env var); frontend and backend READMEs rewritten or corrected. UI shows the version and a Beta chip; dead bell button and placeholder account text removed; favicon and page title. Placeholder `ARUBA_CENTRAL_*`/SMTP values in `backend/.env.example` are now commented out: copied as-is they would have created a bogus Central integration.
- ✅ Bulk device credentials (2026-10-16): the device credential could only be set one device at a time in the edit dialog. The Devices page bulk bar now has **Credential** (operator+): pick a credential (or Remove), see per-device what will be linked, replaced, or skipped, apply, and optionally run connection tests (two at a time). `POST /devices/credential` + `/credential/preview` (`services/device-credential.service.js`). Devices reached only through a cloud (Central/Mist APs, AOS-S under Central, Meraki) are skipped; Central-managed AOS-CX switches are linked (local REST reads). New table filters: Platform and Credential (none/any/specific), so "AOS-CX + no credential + select all" links a fleet in one pass.
- ✅ Duplicate devices (2026-10-16): cloud sync matched only by serial, so a device added by hand without one was added a second time. Sync now adopts a serial-less device when exactly one has the same MAC (keeps its name, credential, groups, live monitoring). Weaker matches (same IP) are reported by `GET /devices/duplicates`, prompted on the Devices page and the device page, and merged with `POST /devices/merge` (operator+; also a bulk "Merge" action). A merge keeps one row, fills its missing fields, takes over the cloud link, and moves events, executions, config backups, discovery links, groups, and backup-schedule selections to it (`services/device-merge.service.js`). Sync now reports its outcome over `device:sync:completed`/`device:sync:failed` (it runs as a Bull job; the store used to overwrite the device list with the queue response).
- ✅ Fixed (2026-10-16): the device page cached the store's device object, which went stale whenever any view refetched the list, and ignored device-to-device navigation, so the Live tab's "Always monitor" switch showed another or an outdated row's state.
- ✅ Status bar (2026-10-16): background-activity toasts (sync, discovery, backups, automations, alerts, socket state) stacked over the page, covered clickable areas, and were gone once they timed out. They now go to a status bar at the bottom (`components/common/StatusBar.vue`): the newest message on the left, a history pop-up of the session's messages (All/Problems filter, unseen badge), and the version plus a real-time connection dot on the right. Only critical alerts still pop up (bottom-right, above the bar). Persistent messages (lost connection, critical alerts, failed automation runs) stay in the bar until dismissed. The log (`stores/notifications.js`) keeps 200 entries in `sessionStorage` per tab, so a reload keeps it; signing in or out clears it. The socket's lost/restored/failed messages share one entry instead of stacking ("Connection Lost" used to stay up forever).
- ✅ Mist first contact (2026-10-19, branch `feature/mist-parity`): a live Mist org was read for the first time (GET-only probe `backend/scripts/probe-cloud.js`, anonymised captures in `backend/tests/fixtures/mist-live/`). Fixed: site UUIDs stored as Location (now site names), last-seen and config status never populated, Mist devices stuck "unverified" (cloud ownership now from `mist_configured` / site assignment), and a presigned S3 URL in WLANs that made every site scope backup look changed (stripped by `utils/config-redact.js`). Parity with Central: a Mist-managed EX with an IP and a credential backs up the NETCONF `set` config plus Mist's object, falls back to Mist when NETCONF fails, is polled over NETCONF (pollers now follow the router; a cloud-managed device is never SSHed), and a direct connection test that can't reach a cloud device shows what the cloud reports. Also: sync merges `Device.metadata` and keeps a known IP/firmware; the device list now includes its cloud integration (table chips said "Cloud" for every provider); provider-neutral UI text; per-integration scope backup button; scope backups filter by cloud; the Central probe no longer tries CX REST on Junos/IOS switches; a Juniper device without an integration no longer falls back to Central; Mist test failures carry actions. Discovery is multi-vendor (Juniper/Mist OUIs, `matchedVendor`). Validated online the same day (devices powered on): status flips, enrichment, cloud-offline alerts auto-resolve, scope backups stable. Also (2026-10-19, the user's choice): a cloud-managed device whose cloud reports it online but that fails NetHelper's ping now shows `warning`, not `offline` (`utils/device-status.js`, mirrored in the frontend), and its ping alert reads "is not answering ping". NETCONF to the Mist EX ran once a firewall was opened (2026-10-19): connection test, NETCONF polls and LLDP neighbors worked first time. It found that a Junos account without `view-configuration` gets `/* ACCESS-DENIED */` placeholders instead of an error, which had been stored as a successful backup; such reads are now refused, and a Mist-managed switch is backed up from Mist with a warning on the backup (new `ConfigBackup.warning`, migration `20261019200000_config_backup_warning`). Also fixed: the Junos chassis MAC is `fpc-mac-base` on real hardware. With `view-configuration` granted, the full backup ran: Junos `set` config plus Mist's object. Junos still withholds four hierarchies (scripts, event-options, secret, extension-service); per the user's choice such a read is kept and the backup's warning names them, and only an all-placeholder read is refused. Not yet run on hardware: the Junos SSH CLI fallback. Plan for the rest (cloud neighbors, scheduled sync + cloud status poller, cloud event streams, alert notifications): `~/.claude/plans/at-this-point-i-reactive-blanket.md` (local).
- ✅ Fixed (2026-10-19): every device was pinged twice a minute. Startup ran its own `setInterval` sweep next to the Bull repeatable job, so the two sweeps overwrote each other's stats (the log read "12 successful, 11 failed out of 18") and both counted consecutive failures: a device went offline after about half its `PING_MONITOR_FAILURE_THRESHOLD`. The Bull job is now the only scheduler, and like the topology and cloud jobs it removes a repeatable left over from another interval or from monitoring being turned off.
- ✅ Phase 7, hardware validation and clean-host installs (2026-10-20, two clean Debian 13 VMs; results in `docs/BETA_NOTES.md` → "How much has been tested on real equipment"):
  - ✅ Docker Compose install from `deploy/README.md` only (host-network override), `create-admin`, integrations and credentials entered in the UI.
  - ✅ Per platform: Central (sync, status refresh, config-sync alert, 7 scope backups), Mist (sync, NETCONF + cloud backups, offline/recovery of an unplugged AP with alerts closing themselves), Junos NETCONF, AOS-CX REST and AOS-S SSH (connection test, polls, LLDP, backup, config change, diff). Also discovery with MACs, the Git mirror to a private GitHub repo, an in-place upgrade, a bare-metal reboot.
  - ✅ Bare-metal install: systemd unit, nginx with TLS (lab self-signed), `nginx -t` (only the predicted `listen … http2` deprecation on nginx 1.26).
  - ✅ Fixed what the run found (merged into `release/beta` 2026-10-20, `c3b89f7`; see `CHANGELOG.md`): runbook bugs (`.env.example` overriding the unit, `COMPOSE_FILE` for the host-network override and the Git key override, Docker install and code steps, Node 22, health probes through nginx, Prisma/npm notices); AOS-S VT100 screen handling; CLI errors stored as backups; Boot ROM version; the credential test dialog's false success; per-admin cloud integrations; email normalization; auth-failure messages; cloud-only AP tests; discovery serials and IP matching; `POST /devices` 500.
  - ✅ Browser click-through by the user (2026-10-20): Users page, change-password dialog, less-used pages after the Vuetify 3.13 upgrade, Network Map with cloud + LLDP links.
  - ✅ A cloud-managed device its cloud reports offline but whose IP answers ping showed `online` (Central kept an offline switch's old IP, now another switch's). The user chose `warning` (2026-10-20), the mirror of the cloud-online/no-ping rule; `utils/device-status.js` and `models/Device.js`, parity-tested.
  - Not run on hardware: the Junos SSH fallback.
  - ✅ Released 2026-10-20: `npm run ci` green in both tiers (backend 727 tests, frontend 86 + build), `CHANGELOG.md` dated, `release/beta` merged into `master` and tagged `v0.9.0-beta.1`.
  - ✅ Housekeeping (2026-10-19):
    - The `CLAUDE.md` commit trailer is updated.
    - `backend/ARCHITECTURE.md` was deleted. It described the pre-multi-vendor design: a deleted Central service, node-cron, and horizontal scaling.
    - `backend/DEVICE_POLLING_API.md` was rewritten against the current pollers. Writing it turned up a bug, now fixed: the `backup` and `login-sessions` pollers tried an AOS-CX REST login on any switch, including Junos and IOS.
    - The Postman collection (39 requests, some for removed routes) is now generated from the route tables by `npm run postman:generate`, covering 119 requests. A unit test fails when the collection is stale or carries a credential. It was checked for secrets and holds none. HPE's own New Central (MRT) collection, once copied to `docs/`, was removed on 2026-10-20 (it is HPE's content); get it from the HPE Aruba Networking developer hub (https://developer.arubanetworks.com).
    - The Git mirror's SSH host key now lives on the data volume (`BACKUP_GIT_KNOWN_HOSTS`, default `git-known_hosts` next to the repo), so recreating the container no longer re-trusts the remote.
- ✅ History purge (2026-10-19): `git filter-repo` removed `backend/.env`, `backend/node_modules/`, `backend/logs/` and the `CLAUDE.md` files from every commit, and GitHub `master` was force-pushed (every commit ID changed). The real values in that `.env` were the database password and the Aruba Central client ID/secret; the JWT and SMTP entries were placeholders.
- ⏸ Deferred to the going-public review: rotating the secrets that were in the tracked `.env`. Optional: ask GitHub Support to purge cached views of the old commits.
- ✅ Pre-release audit (2026-10-20): every tracked file and the full history checked for credentials, keys, personal data and environment-specific values. No keys or secrets found. Scrubbed from the current files: a real SSID and real switch MACs/serial left in fixtures and tests (OUIs kept). Removed HPE's MRT Postman collection and two pre-beta debug scripts (`test-login.js` printed passwords). Production dependency advisories fixed, except `uuid` inside `bull` (moderate; needs a breaking bull major and bull doesn't pass the affected buffer argument). Remaining dev-only advisories (jest, vitest, eslint chains) need breaking majors and never reach the images. Added `docs/GETTING_STARTED.md`, `SECURITY.md`, the device-account table and a TLS recipe in `deploy/README.md`.
- [ ] **Before making the repo public** (the beta stays private):
  - Publish with a fresh, squashed history, or `git filter-repo` with a mailmap. The current history carries two author addresses (a work address and a local hostname) and older fixture versions with the real SSID and switch MACs.
  - Rotate the deferred secrets (above).
  - Re-run the audit: secret patterns over files and history, personal data, private addresses in fixtures, third-party content.
  - Confirm the license (AGPL-3.0-or-later is provisional).
  - Make the GHCR packages (`nethelper-backend`, `nethelper-frontend`) public, so pulls no longer need `docker login ghcr.io`, and drop that step from `deploy/README.md`.
  - Enable GitHub private vulnerability reporting (`SECURITY.md` points to it). CI (`npm run ci` in both tiers, `.github/workflows/ci.yml`) and Dependabot added 2026-10-21; at going-public time also consider CodeQL and secret scanning (free on public repos).
- ⏳ Post-beta hardening (from the audit):
  - Tokens are kept in `localStorage`, so an XSS would expose them; the CSP is the guard. Consider an httpOnly, SameSite refresh-token cookie.
  - After a password change or an admin reset, access tokens already issued keep working until they expire (`JWT_EXPIRES_IN`, 1 h); only the refresh token is revoked. Role changes and deletions already apply on the next request (`authenticate` reloads the user). Add a `tokenVersion` claim that `authenticate` checks.
  - Upgrade the test toolchain majors (jest 30, vitest 5, the eslint config) to clear the dev-only advisories.
- ✅ Simpler install (2026-10-21, branch `feat/easy-install`):
  - `deploy/install.sh`: one-step Compose install and upgrade. It generates the secrets, pulls or builds the images, waits for health, and creates the first admin through `create-admin --if-no-users`.
  - `.github/workflows/release.yml`: on a `v<VERSION>` tag, GHCR images plus a release tarball with a prebuilt `frontend/dist`. A manual run is a dry run.
  - `deploy/systemd/nethelper-admin`: bare-metal `init-env` / `users` / `rotate-key`.
  - Version consistency test (`release-version.test.js`) and a shellcheck CI job.
  - Deliberately not automated: installing Docker or Node, Postgres/Redis/nginx/certificates on bare metal, TLS, and backups.
  - ⏳ Not yet run on a Docker host: tested with a fake `docker` (`deploy-scripts.test.js`), and the release workflow hasn't run yet.
  - ⏳ Deferred: arm64 images.
  - Considered and not done: a browser first-run setup (a one-time token from the log), which would add new auth surface. Revisit if the installer isn't enough.

---

## 🐞 Beta feedback

**Status**: started 2026-10-20. Bugs found in beta testing are GitHub Issues in the private repo, labeled `beta` (`gh issue list -l beta`). A fix closes its issue from the commit (`Fixes #N`) and adds a line under `[Unreleased]` in `CHANGELOG.md`. Released fixes: everything up to #23 shipped in `v0.9.0-beta.2` (2026-10-21, the first tag published by `.github/workflows/release.yml`: GHCR images and a release tarball); #45, #47, #48, #49 and most of #46 shipped in `v0.9.0-beta.3` (2026-10-22); #46 (the rest), #50, #52, #51, #28, #27, #26 and #25 fixed 2026-10-23 for beta.4. New fixes go under `[Unreleased]` until the next tag.

- ✅ #1 (2026-10-20): dead buttons on the device page; header consolidated, edit dialog shared (`components/devices/DeviceEditDialog.vue`).
- ✅ #2, #5, #6, #7, #24 (2026-10-21): Devices table server pagination/sorting (`GET /devices` `limit`/`page`/`sortBy`/`sortOrder`, fleet-wide `summary`; store `ensureAllDevices()` for pickers), Remove row action (admin), buttons hidden from roles the API refuses, per-section Settings errors.
- ✅ #4, #8, #9, #10, #11, #12, #18 (2026-10-21): Automations list reactivity; clickable status cards (Dashboard links to a filtered Devices page, Devices page cards filter in place); CSV export (`utils/csv.js`); search clear; device type labels from `models/Device.js` `deviceTypeInfo()`; per-device connection test result (`Device.api*`, migration `20261021120000_device_api_test_status`).
- ✅ #17, #3 (2026-10-21): device page polls system info on load only when it can work (`utils/transport-router.js` `localPollAvailability()`, returned as `systemPoll` by `GET /devices/:id`); the type-specific card (no real data) replaced by Platform & Access.
- ✅ #13, #14 (2026-10-21): IP (cloud devices on edit) and location optional in the device forms; device create/update routes write only `device.service.js` `editableFields()`.
- ✅ #19, #20 (2026-10-21): manual connection test takes a platform and routes through `connection-test.service` (`manualTestPlatforms()`/`manualTestDevice()`, served by `GET /device-api/supported-types`); Details dialog shows the existing result and handles `cloudOnly`; `GET /device-api/:id/info` and `/firmware` removed.
- ✅ #21, #22, #23 (2026-10-21): automation builder. New node ids skip ids already on the canvas (`WorkflowCanvas.vue` `generateNodeId`); the status chip follows `active`; the hidden `enabled` checkbox is gone (builder saves send `enabled: true`); Workflow Settings edits a copy; the node dialog's no-op Test button is removed; Deploy stops after a failed save.
- ✅ #45, #46, #47, #48, #49 (2026-10-22, for `v0.9.0-beta.3`): integrations that can't be loaded raise `sync.failed` (`CloudProviderFactory.activeIntegrations()` returns `{ providers, skipped }`; the scheduled sync no longer skips itself when all are unloadable); address lookup operator+, cloud answers cached 60 s per (integration, IP) with single-flight, Central's client paging stops at the first connected holder; the event prune keeps each device's newest `ping.*`/`cloud.*` event; `device:status:update` carries `pingLastSeen`/`cloudLastSeen`/`cloudCheckedAt` through to the page; an API credential's mask (`***`) never overwrites the stored secret. Still open from that review: #50 (bulk `cloudCheckedAt` writes; also the stamp isn't emitted, the rest of #46), #51, #52.
- ✅ #50, #46 (rest), #52 (2026-10-23, branch `fix/status-freshness`): the status refresh stamps one `CloudStatusCheck` row per integration (migration `20261023120000_cloud_status_check`; a column on `CloudIntegration` would bump its `updatedAt`, which the event stream fingerprints) instead of `cloudCheckedAt` on every device row, and broadcasts `cloud:status:checked`; `device.service.js` `withCloudChecks()` derives `cloudCheckedAt` on reads. The History tab and address lookup drop superseded replies, and History reloads every 5 min while visible. The device page retries after a 429 instead of failing.
- ✅ #51, #28, #27 (2026-10-23, branch `fix/ui-cleanup`): the dashboard reads `GET /devices?limit=1` `summary` (store `fetchStatusSummary()`), refetched 3 s after `device:status:update`/sync and every 5 min while visible; the API credential test dialog reads the credential's own devices (now with `ipAddress`). Removed the device `configuration`/`backup`/`command`/`stats` routes and their provider stubs, the unused socket rooms and emit helpers, the frontend's `device:update`/`device:api:status` listeners (the first PUT the device back), dead service methods and two empty files. Vuetify 2 `left`/`dismissible` props replaced.
- ✅ #26, #25 (2026-10-23, branch `feat/device-groups-ui`): device groups UI (store `stores/groups.js`, `DeviceGroupsDialog.vue` from the Devices header, table Group filter `group=none|<id>` and bulk action `DeviceGroupMembershipDialog.vue` over new `POST /devices/groups/:groupId/members` `{ add, remove }`; a duplicate name is a 409 naming it). Firmware Status linked from the Devices header and shows recorded `firmwareVersion` per device without polling; Settings' empty General/Advanced tabs replaced by Connection Test (operator+, the old `DeviceApiTestingView`; its route redirects). Unused `models/DeviceGroup.js` deleted.
- ✅ #15, #16 (2026-10-21): backups. Compare loads the device's or scope's successful history through the list routes (store `fetchDeviceBackupHistory`/`fetchScopeBackupHistory`, 200 newest); a `CapabilityError` backup is `unsupported` (`config-backup.service.js` `backupDeviceOutcome()`, `backup:failed` `unsupported: true`, `backup:run:completed` `unsupported` count) and stays out of the status bar.

---

## 🔮 Future Enhancements

### 1. Real-time Updates from Cloud Providers (webhooks / event streams)

**Priority**: Medium
**Status**: Mist shipped 2026-10-19 (event stream); Central deferred (webhooks only, needs a public endpoint)

- ✅ Polling baseline (2026-10-19, branch `feature/cloud-status`): until now cloud sync ran only when someone clicked it, so cloud status and the cloud-offline alert went stale in between. Sync now also runs hourly (`CLOUD_SYNC_INTERVAL`), and a status refresh runs every 5 minutes (`CLOUD_STATUS_INTERVAL`, `services/cloud-status.service.js`, provider `listStatuses()`). It updates status, IP, firmware, connection and config state for devices sync already created, pushes `device:status:update`, and drives the cloud alerts. Mist costs one call per 1,000 devices, Central one per 100. Run live against both clouds.
- ✅ Mist event stream (2026-10-19, branch `feature/cloud-events`; `docs/MULTI_VENDOR_ROADMAP.md` §8f): one outbound WebSocket per Mist org (`services/cloud/`), subscribed to every site's device stats; no public URL needed. Checked live first (`probe-cloud.js --stream`): the stream carries no device status and a disconnecting device just goes quiet, so it triggers the status refresh (a device held offline starts reporting, or an online one's report expires) instead of deciding status itself. Every (re)connect resyncs. Port link changes and restarts from the stream, and every cloud status change (both clouds), are recorded as `DeviceEvent` rows with source `cloud` and shown on the device page's Live tab. Settings → Cloud Integrations shows the stream's state. `CLOUD_STREAM_ENABLED`.
- ✅ Mist on hardware (2026-10-20): unplugged JNAP-01 showed offline after about 3 minutes, and both alerts closed themselves when it came back.
- ✅ Mist port events on hardware (2026-10-20): unplugging JNAP-01's uplink (JNEX-01 `mge-0/0/0`) recorded `port.link.down` within about 45 s; replugging recorded `port.link.up`, and JNAP-01's alerts closed themselves about 25 s later.
- [ ] **Central webhooks (deferred).** New Central has no stream NetHelper can open; it delivers alerts (e.g. "AP Rebooted", with `operation` Add/Update and `state` Active/Cleared) by HTTP POST to a URL it calls, set up under Alert Management, or through the GreenLake event framework (CloudEvents, `/events/v1beta1/subscriptions`). That needs a public HTTPS endpoint, which an in-house install usually doesn't have. Classic Central's protobuf streaming API is not available on New Central. Until then Central stays on the 5-minute refresh. When it is built: `POST /api/v1/webhooks/<integration>` with a per-integration secret (verify GreenLake's signature), map alerts onto the same status-refresh trigger, and show the last delivery in Settings. Meraki is in the same position (webhooks only).

#### Related Documentation
- [Mist WebSocket API overview](https://www.juniper.net/documentation/us/en/software/mist/automation-integration/topics/concept/websocket-api-overview.html)
- [New Central alert webhooks](https://developer.arubanetworks.com/new-central/docs/alert-with-webhooks), [GreenLake webhooks guide](https://developer.greenlake.hpe.com/docs/greenlake/services/event/public/guide)
- Backend: `backend/src/services/cloud/` (stream), `backend/src/services/cloud-status.service.js` (status refresh)

#### Notes
- This complements the ICMP ping monitoring (Item 1) rather than replaces it
- Webhooks from Aruba Central show their view of device status
- ICMP ping provides our on-prem view of reachability
- Having both sources creates a comprehensive status picture

---

## 📋 Additional Future Items

### 2. Device Alerting
**Priority**: Medium
**Status**: 🔨 v1 shipped 2026-10-16 (branch `feature/alerts`): stateful, in-app alerts; email/webhook notification channels 2026-10-23

Shipped (`services/alert.service.js`, rules in `constants/alert-rules.js`, page `/alerts`):
- ✅ Stateful alerts: one unresolved alert per condition and subject (`Alert.openKey` unique), occurrences counted, auto-resolve when the condition clears, acknowledge/resolve by operators. Resolved alerts pruned after `ALERT_RETENTION_DAYS` (90).
- ✅ Built-in rules: device offline (ping), device offline (cloud, at sync and, since 2026-10-19, on the 5-minute status refresh), config out of sync (cloud, 2026-10-19: Central's "Out of sync" on an online device, 10-minute settle; Mist's `config_status` has no known out-of-sync value yet), PoE fault and live monitor lost (Always-monitor devices only), config/scope backup failed, cloud sync failed. Admins toggle each and set severity and settle time (Settings → Alerts). Settle time drops conditions that clear quickly (PoE boot bounce).
- ✅ UI: Alerts page (status tabs, severity/rule/search filters, bulk actions), app-bar bell with the open critical+warning count, `alert:new` in the status bar (critical alerts also pop up), dashboard "View Alerts" count. Replaced the client-only alert list in `stores/notifications.js`, which nothing on the backend fed.
- ✅ Fixed on the way: a PoE port leaving a fault for a state other than delivering emitted no event; it now emits `port.poe.down`.
- ✅ Automations and alerts (2026-10-16): an Alert trigger (opened/resolved, rule filter, minimum severity, optional device group) starts automations; Raise/Clear/Acknowledge Alert steps. Automation alerts use rule `automation.raised` with a key shared across automations (one raises on "opened", another clears on "resolved"); an automation never clears a built-in alert and never triggers on `automation.raised`. See item 3a below for the engine.

- ✅ **Notification channels** (2026-10-23, branch `feat/alert-notify`): email and webhook delivery of alerts, Settings → Notifications (admin only).
  - Model `NotificationChannel` (`type` email|webhook, `config`, `minSeverity`, `rules` (empty = every built-in rule; `automation.raised` only when named), `enabled`, last delivery status/error; migration `20261023150000_notification_channels`; in `OWNED_MODELS`). Webhook URL and header values field-encrypted; the API returns `***` and a URL hint (scheme + host), and a blank or `***` value on update keeps the stored secret.
  - Delivery: `services/notification-channel.service.js` listens to the alert service's `opened`/`resolved` events (never a bump) and queues one `deliver` job per matching channel on the existing Bull `notification` queue (`jobs/notification.job.js`; 3 attempts, exponential backoff from 10 s). The channel records success, or the failure on the last attempt; a failed delivery is logged, never an alert. Channels are cached in memory (60 s, dropped on every write).
  - Email: `services/notification.service.js` (rewritten; the old uncalled helpers that swallowed errors and logged webhook URLs are gone): nodemailer from `SMTP_HOST`/`PORT`/`SECURE`/`USER`/`PASS`/`FROM`, only `SMTP_HOST` required. Webhook: JSON POST (`event` `alert.opened|resolved|test`, `text` for Slack/Teams, `alert{…}` with a link built from `APP_BASE_URL`, else the first `CORS_ORIGINS`), 5 s timeout, no redirects, http(s) only (http flagged in the UI). Errors never carry the URL.
  - API (admin only): `GET`/`POST /settings/notification-channels`, `PUT`/`DELETE /:id`, `POST /:id/test` (sends a sample now; not retried or recorded). UI `components/settings/NotificationChannels.vue` (store `stores/notificationChannels.js`): list with last delivery, add/edit, enable switch, Test, and a warning when email channels exist but SMTP isn't set.
  - Docker Compose passes the SMTP vars and `APP_BASE_URL` from `deploy/.env`; the bare-metal env template lists them.
  - ⏳ Live check (the user, 2026-10-23): a test send to a real mailbox and a Slack/Teams webhook, then a `device.offline` alert notifying once on open and once on resolve. Checked so far against a local HTTP listener only.
- ⏳ Later: SMS/PagerDuty, per-user subscriptions, digests/quiet hours.

Also open from the cloud plan (2026-10-19), to check on hardware:
- ✅ Mist stream: JNAP-01 unplug/replug confirmed on 2026-10-20 (phase 7). JNEX-01 port events confirmed too (above).
- ✅ "Config out of sync" alerts opened for Sw-CoreA/Sw-CoreB (confirmed 2026-10-20).
- ✅ `/map` viewed in a browser with the cloud links (Mist and Central), 2026-10-20.
- ✅ CX credentials for Sw-CoreA, Sw-CoreB and Sw-Studio fixed; connection tests, polls, LLDP and backups pass (2026-10-20).

Deferred:
- ⏳ Rule scoping (per device, group, site) and custom thresholds; maintenance windows / snooze.
- ⏳ Port-flap detection from `port.link.*` events; API/transport failure alerts beyond backups.
- ⏳ Open-alerts banner on the device page.
- ⏳ Multi-instance: settle timers are in memory (same single-instance assumption as the live monitor).

---

### 2a. Cloud alarms (read-only mirror of Mist / Central active alarms)
**Priority**: Medium
**Status**: ✅ Feed-first version merged to `master` 2026-10-23 (`6925242`), not yet released. The active-alarm dashboard card, the History tab row and local silences below are still deferred; the open questions below still apply to them.

**What was built (2026-10-23)**, a smaller first step than the design below, chosen because the Activity feed (item 14) asks only "what happened, when", which fits what both clouds return:
- `CloudAlarm` table (migration `cloud_alarms`), not `DeviceEvent`: a Central alert names no device in a field, and `DeviceEvent` needs one. `deviceId` is optional (`SetNull` on delete, re-pointed on merge); `integrationId` is a plain column.
- Provider capability `alarms`, `listAlarms({ since })` → `{ alarms, activeIds }`. **Mist**: org alarm search, groups `infrastructure` and `marvis`, point events (`status: 'event'`) unless the alarm carries `status`; display names from `/const/alarm_defs`. **Central**: the active/deferred list (authoritative active set, so a stored alert missing from it clears with no reason) plus a newest-first sweep back to `since`.
- Left out because NetHelper records them itself: Mist `device_/switch_/gateway_` down/reconnected and `device_/switch_restarted`; Central System alerts named "… Offline". Central "Switch Reboot" is kept.
- `services/cloud-alarm.service.js`, polled by `pollCloudAlarms` on the cloud queue (`CLOUD_ALARMS_ENABLED`, `CLOUD_ALARM_INTERVAL` 5 min, `CLOUD_ALARM_RETENTION_DAYS` 30; a restart backfills from the newest stored alarm, at most 7 days). Device link only on a unique match: serial (also as a word in Central's summary, e.g. "Switch Reboot"), MAC, hostname, then device name as a whole word in the summary (not names that are IPs or under 3 characters). Otherwise the alarm is about its site. Socket `cloud:alarms`.
- Activity feed category `cloud-alarm` (on by default): raised items, cleared items for stateful alarms with the reason (a Central timer clear says the problem may not be fixed), repeats of one alarm on one device/site within 10 minutes folded.
- First live poll (2026-10-23): Central "Home Network" stored its active "IPsec SA Down" site-level (its summary names two gateways). Mist "Buck Home" still returns nothing until alarm rules are enabled in its template.

**Goal.** Show the alarms the clouds already raise, without creating NetHelper `Alert` rows (that would duplicate actionable items owned in the vendor cloud):
- When each alarm appeared and cleared, on the device History tab.
- The active alarms from every cloud on the dashboard, gone when the cloud clears them.
- A local silence that hides one alarm occurrence, so a recurrence of the same alarm type shows again.

Never write acks or clears back to the cloud.

**Design so far** (full draft: `~/.claude/plans/nested-chasing-lerdorf.md`, local):
- **Provider capability `alarms`**: `listActiveAlarms()` returns a normalized alarm: `externalId`, type/name, a common severity scale, raised/last-seen times, summary, site, device serials/MACs.
- **Polling job**: 5 min, with its own env vars, diffing the active set per integration.
  - A new id records a `DeviceEvent` `alarm.raised`; a gone id records `alarm.cleared`.
  - Use the `alarm.` prefix, **never `cloud.`**: the cloud status lane and `recordStateIfChanged` treat every `cloud.*` event as a status state.
  - A failed read clears nothing.
  - At startup, rebuild the active set from `alarm.raised` events with no matching clear.
  - Retention and device merge come free with `DeviceEvent`.
- **Silences** (the user's choices, 2026-10-22): team-wide (operator+, records who and why); one row per `(integrationId, externalId)`, deleted once that occurrence clears. Mirror device-related alarms only (Mist infrastructure/marvis groups, Central System/LAN/WLAN/WAN/Routing/Cluster), widened later through one per-provider constant.
- **Views**: a "Cloud alarms" interval row on the History tab (like the Config row), a dashboard card, and `GET /api/v1/cloud-alarms`.

**Findings log** (newest last; add dated entries):
- 2026-10-22, API docs:
  - Mist `GET /api/v1/orgs/{org}/alarms/search`: time window (`duration`, default `1d`) plus `acked`/`group`/`severity`/`type`; no status filter; `next` paging. Alarm fields: `id` (UUID), `type`, `group`, `severity`, `timestamp`, `last_seen`, `count` (incidents in one alarm window), `status` open\|resolved + `resolved_time`, `switches`/`aps`/`gateways` (MACs), `hostnames`, `acked`. Rate limit 5000 calls/h per token.
  - New Central `GET /network-notifications/v1/alerts`: OData `filter` on `status` (Active\|Deferred\|Cleared), `siteId`, `category`, `deviceType`; cursor `next`, `limit` ≤ 100.
  - Central webhook and stream payloads carry `alertId` (same id through Add → Update/Cleared, so a recurrence is a new id), `impactedEntities.deviceSerial` and `additionalDetails[].deviceSerial`. The stream is `wss://<host>/network-notifications/v1/alert-events`: protobuf inside CloudEvents, same OAuth token, **Advance tier only**.
- 2026-10-22, live, Central ("Home Network"):
  - The list works, and `filter=status eq 'Active'` / `status in ('Active','Deferred')` work (one transient 502). 2 active, 15 cleared.
  - Item fields: `id` (UUID; the docs' `"22071893000:…"` example is wrong), `key` (UUIDv3, distinct per subject, e.g. per OSPF peer; whether it survives a recurrence is unconfirmed, as no subject repeated), `name`, `category`, `deviceType`, `severity`, `priority`, `status`, `summary`, `createdAt`, `updatedAt` (`""` while active), `clearedReason`, `siteName`, `deferredUntil`, `notes`, `rootCause`, `action`.
  - **No serial, siteId or MAC.** The device appears only in `summary` text ("…stopped receiving data from gateway AVGW.").
  - `alerts/classification?type=impacted_devices` returns counts per alert type only, no serials.
  - **7 of 15 cleared alerts were cleared by timer** (`clearedReason: "Due to clear alert timer configuration"`) and one by "Device went offline", so a Central clear does not always mean the problem is gone.
- 2026-10-22, live, Mist ("Buck Home"):
  - `alarms/search?duration=30d`: 0 results.
  - The org's alarm template "Default" has `rules: {}`, and its sites set no template of their own, so Mist generates nothing until rules are enabled in Mist.
  - `GET /api/v1/const/alarm_defs` (248 types): only the marvis group's examples carry `status`, and marvis needs a VNA license. The 157 infrastructure types are point events that come in pairs (`switch_down`/`switch_reconnected`, `sw_alarm_chassis_*`/`*_clear`, `*_down`/`*_up`), and most of the clear/up/reconnected types are `default_enabled: false`.
- 2026-10-22, tooling: `probe-cloud.js`'s anonymiser does not scrub identifiers inside free text. Central `summary` kept hostnames, a serial and a public IP, so scrub by hand (or fix the anonymiser) before committing alarm fixtures.

**Open questions** (answer these before planning code):
- [ ] **Mist**: with alarm rules enabled (including the clear/up/reconnected types), capture real infrastructure alarms. Is there really no `status`? Does a pair share anything besides device MAC + type (port or peer in `reasons`)? Is a recurrence a new `id`? Does the org WebSocket serve an alarms channel (`probe-cloud.js --stream '/orgs/<org>/alarms'`)?
- [ ] **Mist**: is there any VNA/Marvis licence in reach (status-based alarms)?
- [ ] **Central**: have recent API releases added device serial/siteId to the alerts list, or an alert detail endpoint? Is the Advance tier (alert stream) an option?
- [ ] **Central**: when a subject recurs, does `key` stay the same while `id` changes? Does `Deferred` show up when an alert is deferred in the UI?
- [ ] **Central device mapping** if REST stays serial-less: link only when exactly one of the integration's device names in the alert's site appears as a whole word in `summary`, else show the alert site-level (dashboard only)? Or dashboard-only for Central?
- [ ] **Central timer clears**: show `clearedReason` on the timeline so a timer clear isn't read as recovery? Cross-check against our own cloud/ping status?
- [ ] **Mist active state** without `status`: treat known down/up pairs as one open interval until the pair arrives, point markers for the rest, and also clear device-offline alarms when Mist reports the device online?

**Re-probe commands** (from `backend/`, `--out` outside the repo):
```
node scripts/probe-cloud.js --integration "Buck Home" --out <dir> --no-builtin \
  --get '/api/v1/orgs/<org>/alarms/search?duration=7d&limit=100' --get /api/v1/orgs/<org>/alarmtemplates
node scripts/probe-cloud.js --integration "Home Network" --out <dir> \
  --get "/network-notifications/v1/alerts?limit=100&filter=status in ('Active','Deferred')"
```
Two `--get`s with the same path but different queries write to the same file, so use a separate `--out` for each.

#### Related Documentation
- [Mist Orgs Alarms API (OpenAPI)](https://raw.githubusercontent.com/api-evangelist/mist/refs/heads/main/openapi/mist-orgs-alarms-api-openapi.yml)
- [New Central: List all alerts](https://developer.arubanetworks.com/new-central/reference/getalertlistv1), [alert stream](https://developer.arubanetworks.com/new-central/docs/alerts), [alert webhooks](https://developer.arubanetworks.com/new-central/docs/alert-with-webhooks), [streaming getting started](https://developer.arubanetworks.com/new-central/docs/streaming-api-getting-started)
- Related: item 1 (Central webhooks, deferred) and item 2 (our own alerts).

---

### 3. Live Device State & Performance Dashboards
**Priority**: Medium
**Status**: 🔨 Started 2026-10-15 (branch `feat/live-state`): live port/PoE state for AOS-CX

Shipped on the branch (design: `MULTI_VENDOR_ROADMAP.md` §8c):
- ✅ Always-on, opt-in event monitoring (`Device.liveMonitoring`, `DeviceEvent` table, `device:event`), pushed by AOS-CX REST notifications. Works on Central-managed switches (read-only local access). Validated on a 6200F (ML.10.16.1010), including a PoE cut pushed from Central.
- ✅ Device page **Live** tab: port grid (link, speed, PoE status and draw), per-port throughput from counter deltas, CPU/memory, recent events. Polled only while open.
- ✅ Fixed on the way (found on hardware): AOS-CX config backups and firmware/system polls over local REST used HTTP Basic auth, which AOS-CX refuses; they now use cookie sessions.

- ✅ Device **History** tab (2026-10-22): ping and cloud status lanes plus a combined "do they agree" lane, from `ping.*` (new, source `ping`) and `cloud.*` `DeviceEvent`s (`services/device-history.service.js`, `GET /devices/:id/history`), with config-backup and restart markers; a backup with `hasChanges` brackets the change between it and the previous success. Per-source seen times on `Device` (`pingLastSeen`, `cloudCheckedAt`, `cloudLastSeen`, migration `20261022120000_device_seen_sources`; since 2026-10-23 the refresh's time is per integration, `CloudStatusCheck`) drive the Last Seen card (`frontend/src/models/device-seen.js`).

Deferred:
- ✅ "Who has this address?" (2026-10-22): device page banner button, `services/address-lookup.service.js`. Clouds answer through the providers' `findByAddress(ip)` (Mist and Central, 2026-10-22): their devices and the clients seen with the IP, with the switch port or AP; a client's MAC stands in for the neighbor table's when the address is off the host's segment.
- ⏳ Undecided (2026-10-22): when the cloud reports a device offline and another online device in NetHelper has its IP (`sameIpDevices`), that device most likely answers the ping, so this one could show as plain `offline` instead of `warning`. Changes `effectiveStatus()`/`statusWhere` in both tiers (parity-tested) and so the list filter, groups and automations.
- ✅ The device page no longer shows "Failed to Load Device" on a 429: it keeps the page and retries after `Retry-After`, as the Devices table does (2026-10-23).
- ⏳ Mist wireless client search (`/orgs/:id/clients/search`) is mapped from the spec; no wireless client was seen in the live org to check the field names.
- ⏳ Probing the address itself (nmap on one host: reverse DNS, SSH/HTTPS banners and certificate subject) was left out as too heavy; the lookup above covers what NetHelper already holds.
- ⏳ Who changed a device's config, and exactly when: Mist org audit logs (`/orgs/:id/logs`) and the Central audit trail name the admin; AOS-CX and Junos log commits locally (`show accounting`/`show system commit`). Today the History tab only brackets a change between two backups.
- ⏳ History lanes for the live monitor's session (connected/lost) and the cloud connection state (`cloudConnectionStatus`), and a ping latency series (needs metric history storage, below).
- ✅ Automation event triggers (2026-10-16): done through alerts rather than raw `DeviceEvent`. An Alert trigger fires after the rule's settle time, so a PoE boot bounce never starts a run. A raw `DeviceEvent` trigger is still open if a case needs events no rule covers.
- ⏳ Live state for Junos (NETCONF), AOS-S and IOS-XE (SSH), via the existing poll mode; needs hardware to validate parsers.
- ⏳ Optional syslog receiver as a push source for non-CX switches (one line of switch config; needs an inbound UDP port).
- ⏳ Multi-instance leader lock (Redis) so several backend replicas don't watch the same devices.
- ⏳ Metric history storage (time-series), for the items below.

Enhanced visualization for device performance metrics:
- Historical ping response times (graphs/charts)
- API communication success rate trends
- Device uptime percentage (SLA tracking)
- Comparative performance across device groups

---

### 3b. Automation engine (minimal)
**Priority**: Medium
**Status**: 🔨 v1 shipped 2026-10-16: the builder's graph runs for a small set of nodes

Before this, nothing ran a saved automation: Run Now wrote `pending` Execution rows only, and the old step engine (`automation.service.js`, deleted) read a `workflow.steps` field the schema no longer had.

Shipped (`services/automation/`: `graph.js`, `nodes.js` registry, `engine.js`, `trigger.service.js`; job `jobs/automation.job.js`):
- ✅ Runnable nodes: Manual, Schedule and Alert triggers; Device Property (real fields only) and Alert Severity conditions (true/false outputs); Create Backup, Raise/Clear/Acknowledge Alert actions. Per-step "continue on error"; disabled steps pass through. One Execution per run with per-node results.
- ✅ Every other palette node is marked "not runnable yet"; the API refuses to run or activate a workflow that uses one (400 with the reasons). The frontend list (`models/automation-nodes.js`) has a parity test against the backend registry.
- ✅ Fixed on the way: `/automations/builder/:id` had no route (editing a saved automation was broken); Execution rows now cascade with their automation (deleting one with run history failed).
- ✅ Schedule trigger (2026-10-16): cron expression + timezone on the trigger node (presets and a next-runs preview in the builder). `services/automation/schedule.service.js` derives the automation's single `Schedule` row and one Bull repeatable job from it on every save/toggle, and reconciles at startup; `/schedules` is read-only. Manual and Schedule triggers carry their targets (devices and device groups); a scheduled run with no devices for a device step is recorded as failed, not skipped.
- ✅ Run History (2026-10-16): `/automations/executions` (filters by automation, status, started-by; per-step results; live via `automation:started`/`completed`). Cancel works: a queued run never starts, a running one stops before its next step. `Execution.trigger` records manual | schedule | alert:opened | alert:resolved (| config-change since 2026-10-22). Finished runs pruned after `EXECUTION_RETENTION_DAYS` (90). Unattended runs reach the status bar only on failure.
- ✅ Configuration Change trigger (2026-10-22): fires when a device config backup finds a change against an earlier successful backup (a device's first backup never fires it). Optional filters: artifact kind (CLI / structured) and device group; the run gets the device, and the trigger step's output names the backup, the previous backup and the changed kinds. `Execution.trigger` = `config-change`. Detection follows the backup schedule: nothing is pushed from devices yet (see §5, near-real-time config change detection). Cloud-scope backups don't fire it.
- ✅ Builder "Run now" (was a placeholder "Test" button) saves and queues a run. Automation jobs run at most once (`attempts: 1`; the queue default of 3 could repeat steps). Fixed the builder counting vue-flow edges as nodes, which broke its own validation.

Deferred:
- ⏳ Per-device run history on the device page; a run-history retention setting in the UI.
- ⏳ The remaining actions (reboot, configure, command, firmware, HTTP request) and notification nodes; config writes are out of scope until the restore direction (`MULTI_VENDOR_ROADMAP.md` §8b).
- ⏳ Alert-trigger runs are capped only by alert dedup; no per-automation rate limit yet.

---

### 3a. Network Map (topology from LLDP/CDP)
**Priority**: Medium
**Status**: 🔨 Built 2026-10-16 (branch `worktree-network-map`; design: `MULTI_VENDOR_ROADMAP.md` §8d)

A `/map` page to explore the managed network visually, built from each device's neighbor table plus Discovery hosts.
- ✅ Neighbor collection over existing transports: AOS-CX REST (validated on the 6200F test switch, including under Central management), Junos NETCONF/CLI, AOS-S and IOS-XE SSH (spec-derived parsers, not yet run on hardware). Scheduled (`TOPOLOGY_INTERVAL`, default 6 h) and on demand.
- ✅ Models `DeviceLink`, `DeviceTopologyState`, `TopologyChange`, `MapLayout`; `DiscoveredDevice.subnet` (Discovery now records the swept subnet).
- ✅ Map (vue-flow + dagre): layered auto-layout; nodes draggable by operators, with positions saved per site and shared. Status colors update from `device:status:update`. Neighbors not in inventory are dashed "ghost" nodes, importable when Discovery saw them. Discovery hosts not on the map are grouped by subnet. There is a link-change history drawer.
- ✅ Device page **Neighbors** tab (`GET /devices/:id/neighbors`, "Read now").
- ✅ Cloud neighbor sources (2026-10-19, branch `feature/cloud-neighbors`): a cloud-managed device no direct transport reaches gets its neighbors from Mist (AP LLDP from device stats, switch ports from `/stats/ports/search`) or Central (`/network-monitoring/v1/topology/{site-id}`), one bulk read per integration per collection run (`listNeighbors()`). Run live against both clouds: four Central APs and the cloud-only AOS-S switch, and the Mist AP, now sit on their uplink ports; links seen from a switch's own LLDP and from the cloud merge. Offline devices are skipped, keeping their last links. Captures in `tests/fixtures/mist-live/neighbors-*.json` and `tests/fixtures/central-live/`.
- ✅ API: `GET /topology/graph`, `GET /topology/changes`, `POST /topology/collect` (operator+), `GET`/`PUT /topology/layouts/:scope` (PUT operator+). Socket: `topology:progress`, `topology:updated`.
- ✅ **VLAN overlay** (2026-10-24, branch `feat/vlan-overlay`; `MULTI_VENDOR_ROADMAP.md` §8d): VLAN membership is read in the same topology pass as the links (AOS-CX REST `system/vlans` + interface `vlan_mode`/`vlan_tag`/`vlan_trunks`, LAG members inherit the LAG; Mist `vlan_ids`/`port_mode` from the port stats the neighbor read already fetches, irb from `if_stat`; a Mist-managed EX read over NETCONF still gets Mist's VLANs) and stored as `DeviceTopologyState.vlans`. The map's VLAN picker (`?vlan=`) lights the links that carry a VLAN, dashes the ones where both switches have it but one side doesn't allow it, badges devices that route it, and outlines islands (devices carrying it with no L2 path to a routing device; never claimed across a link we can't see). A "VLAN mismatches" toggle marks every link with a pruned VLAN or differing untagged VLANs; clicking a link opens its details. The CX reads are spec-derived (AOS-CX 10.10 schema): **⏳ check on the 6200F** and capture `aos-cx-live/interfaces-vlans.json`; also confirm Mist lists every allowed VLAN on a trunk port, not only active ones.

Deferred:
- ⏳ VLANs over Junos (`get-ethernet-switching-interface-information`, an operational RPC that may avoid the `vlans` ACCESS-DENIED config reads hit) and AOS-S (`show vlans ports … detail`), after first contact with the lab EX and 2930F.
- ⏳ VLAN overlay: the AP check (an SSID's VLAN not allowed on the AP's switch port), Central/scope-derived VLANs for devices nothing reads directly, config-backup parsing as a fallback, a device-page Ports tab (port, mode/native/tagged, neighbor, mismatch notes), VLAN changes in the Activity feed.
- ⏳ Run the Junos, AOS-S and IOS-XE parsers against real output and replace the spec-derived test strings with captures.
- ⏳ Endpoint attachment from switch MAC tables (AOS-CX `system/vlans/*/macs`), so Discovery hosts hang off their switch port, plus a "where is this MAC/IP?" search.
- ⏳ Live link-state edges (color an edge from `device:event` port changes for live-monitored devices).
- ⏳ Manual links and annotations for things LLDP can't see (ISP handoff, unmanaged switches).

---

### 4. Automated Device Discovery
**Priority**: Medium
**Status**: ✅ Completed (2026-07-06)

Automatically discover devices on the local network:
- ✅ Network scanning for Aruba devices (nmap ping/ARP sweep of configured or auto-detected subnets)
- ✅ Auto-detection of device types (Aruba/HPE MAC OUI match + TCP port fingerprint; Central inventory match is authoritative)
- ✅ Suggestion to add discovered devices (import into inventory with pre-filled name/type/serial)
- ✅ Conflict resolution with existing devices (IP/MAC/serial conflict detection; "merge into existing" option)
- ✅ Cross-check against Aruba Central inventory by MAC (gracefully degrades when Central is unreachable)

**Implementation:**
- Backend: `src/services/discovery.service.js`, `src/jobs/discovery.job.js`, `src/controllers/discovery.controller.js`, `src/routes/discovery.routes.js` (`/api/v1/discovery/*`), Bull `discovery` queue, models `DiscoveryScan` + `DiscoveredDevice`
- Frontend: `src/views/devices/DeviceDiscoveryView.vue` (route `/devices/discovery`), `src/stores/discovery.js`, `src/services/discovery.service.js`
- Real-time: WebSocket events `discovery:progress` / `discovery:completed` / `discovery:failed`
- Requires `nmap` on the backend host (installed). Env: `DISCOVERY_SCAN_TIMEOUT`

**Multi-vendor follow-up:** ✅ done 2026-10-19 for Juniper: Juniper and Mist OUIs, the cross-check covers every active cloud integration and keeps each match's vendor/platform/provider, imports keep them, and `DiscoveredDevice.isArubaVendor` → `matchedVendor Vendor?` (`DiscoveryScan.arubaHosts` → `vendorHosts`). Also fixed: a cloud match never suggested a device type. Cisco OUIs wait for Cisco support.

---

### 5. Configuration Backup Scheduling
**Priority**: Medium
**Status**: ✅ Completed (2026-07-06)

Scheduled configuration backups with:
- ✅ Automated backup on cron schedule (Bull repeatable jobs per schedule, timezone-aware; device selection by all/type/specific)
- ✅ Configuration diff detection (SHA-256 change detection per device; unified-diff comparison between any two versions)
- ✅ Rollback capability — first iteration is **view / diff / download** (browse versions, compare, download to apply manually). Automated push-to-device restore is intentionally deferred (see note below).
- ✅ Pasteable backups (2026-10-16) — AOS-CX backups now hold the **CLI text** (`GET /configs/running-config`, `Accept: text/plain`, verified on the 6200F) next to the REST JSON, as `ConfigBackupArtifact` rows (kind `cli`/`structured`). The UI shows a tab per artifact with Copy/Download and a hint for applying it by hand (SSH, Central, Junos `load set terminal`). The Compare dialog toggles between kinds. The migration backfilled one artifact per existing backup.
- ✅ Cloud-scope backups (2026-10-16) — `ScopeBackup` + `scope-backup.service.js`: read-only backups of a cloud's org/site configuration, which is where AP config lives. **Mist implemented** (fixture-validated only; no live tenant yet). **Central implemented 2026-10-16** and verified live (global scope, site collections, sites, device groups; assignments + scope-local objects + the profile library; `MULTI_VENDOR_ROADMAP.md` §8b). Secrets in scope bundles (Central RADIUS shared secrets come back in plaintext, Mist PSKs) are replaced by keyed HMAC fingerprints (`utils/config-redact.js`). "Cloud Scopes" tab on the backups page; `POST /api/v1/backups/scopes/run`; schedules opt in with `includeScopes`.
- ✅ SSH shell fix (2026-10-16): `ssh-device.service.js` typed `no page` 600 ms after opening the shell, before the device's first prompt. The 6200F shows its prompt about 3.6 s in, so that late prompt was taken as the end of `no page` and every output shifted by one: `show running-config` came back as the `no page` echo, and `show version` was wrong the same way. `driveShell` now waits for the first prompt (it answers AOS-S "Press any key" and sends one newline as a nudge) and ends each command on that exact prompt. The AOS-CX `Current configuration:` header is dropped. Verified live: SSH and REST CLI text match line for line (191 lines). `tests/unit/ssh-shell.test.js` reproduces the timing.
- ✅ Backup retention policies (per-schedule retentionDays + retentionMaxCount, 0 = unlimited; pruned after each run)
- ✅ Export to external storage — **Git mirror shipped 2026-09-14** (opt-in; commits every captured config, optional `git push` to a remote for off-box replication). S3/NFS export still deferred.

**Implementation:**
- Backend: `src/services/config-backup.service.js`, `src/jobs/config-backup.job.js`, `src/controllers/backup.controller.js`, `src/routes/backup.routes.js` (`/api/v1/backups/*`), Bull `config-backup` queue, models `BackupSchedule` + `ConfigBackup`, schedule sync on server startup
- Frontend: `src/views/devices/ConfigBackupsView.vue` (route `/devices/backups`), `src/stores/backups.js`, `src/services/backup.service.js`, `src/components/backups/ConfigDiffViewer.vue` (hand-rolled colored unified-diff viewer)
- Config source: routed per device by management mode (see "Direct-managed device support" below) — Central API, AOS-CX REST, or SSH; stored to local disk under `BACKUP_STORAGE_PATH`
- Git mirror (2026-09-14): `src/services/git-backup.service.js`, model `GitBackupConfig`, admin routes `/api/v1/settings/git-backup`, UI `frontend/src/components/settings/GitBackupSettings.vue`. Shells out to the system `git` binary — no library dependency. One repo, one directory per device serial holding the config plus a `meta.json` sidecar; the filename follows the captured `format` (`.cfg` / `.set` / `.json`), which is now persisted on `ConfigBackup.format` instead of being discarded. Commits only when the config actually changed (the dedup the flat-file store cannot do), pushes once per batch. **Additive and best-effort**: the flat file remains authoritative, and neither a commit nor a push failure can fail a backup. **Retention deliberately does not prune Git history** — rows and flat files are pruned as before, so the repo is the long-term archive under a bounded working index.
- Real-time: WebSocket events `backup:completed` / `backup:failed` / `backup:run:completed`

**Deferred follow-ups (next iteration):**
- Automated restore/rollback. Direction set 2026-10-16 (`MULTI_VENDOR_ROADMAP.md` §8b): a `restore` transport operation, **only** where the apply is atomic with rollback (Junos NETCONF `commit confirmed`; direct AOS-CX REST `PUT /fullconfigs/running-config` from the JSON artifact after a checkpoint). Hard refusal for `managementMode === 'cloud'` or `cloudManaged`. No SSH-paste restore. Admin-only, with a preview diff, an audit entry, and a pre-restore backup.
- Cloud configuration writes (edit Central profiles / Mist templates through the API). A separate feature from device restore, not started.
- Central scope backups: per-device effective config (`view-type=EFFECTIVE` returns 400 on 2026-10-16) and device-level scopes are not captured. Revisit if Central documents an effective-config read.
- S3-compatible and NFS export targets
- Near-real-time config change detection (added 2026-10-22). Today a change is noticed only when a backup runs, so the automation Configuration Change trigger (§3b) fires on the backup schedule. Candidates: an AOS-CX REST notification subscription for config changes (the live monitor already holds the socket), Junos commit notifications (syslog `UI_COMMIT` or NETCONF notifications), the Mist audit-log stream, and Central webhooks. The detected change would queue a backup, which then fires the trigger as now. Not started.
- Git mirror follow-ups: browse/restore from a commit in the UI (`GET /api/v1/backups/:backupId/history` already returns the device's commit log), and `git gc`/shallow-clone tuning if a large fleet makes the repo unwieldy
- ✅ ~~SSH-based config pull for non-cloud-managed devices~~ — completed (2026-07-06), see below

---

### 5a. Direct-managed (non-Central) device support
**Priority**: Medium
**Status**: ✅ Completed (2026-07-06)

Support devices managed directly on the local network rather than through Aruba Central, and pull their configs over the right transport.

- ✅ `Device.managementMode` enum (`central` | `direct`). Central-synced devices are `central`; manually-added and discovery-imported devices default to `direct`.
- ✅ Config-backup transport routing: `central` → Aruba Central API; `direct` + AOS-CX → device REST API (reuses the existing `backupPoller`); `direct` + other (AOS-S, CLI-only) → **SSH `show running-config`**.
- ✅ New `ssh-device.service.js` (ssh2): interactive shell, disables paging, handles legacy KEX/cipher algorithms common on network gear, per-platform command profiles (AOS-S / AOS-CX / generic).
- ✅ Direct polling parity: firmware/system pollers fall back to SSH `show version` for non-CX direct devices.
- ✅ Connection test routes to SSH for direct non-CX devices (existing `POST /api/v1/device-api/test/:deviceId`).
- ✅ Frontend: Central/Direct chip on device list + detail; "Test Direct Connection" action on directly-managed devices; management-mode + credential selectors in the add/edit device dialogs.

**Implementation:**
- Backend: `src/services/ssh-device.service.js`; routing in `config-backup.service.js` (`pullConfig`/`isCxSwitch`), `device-poller.service.js` (`isCxRestCapable` + SSH fallbacks), `device-api-test.controller.js` (`useSshTransport`); `managementMode` on Device schema + validation + discovery import
- Frontend: `DeviceTable.vue` (Managed column), `DeviceDetailView.vue` (chip + test action), `DevicesView.vue` (add/edit selectors)
- Dependency: `ssh2`. Env: `SSH_PORT`, `SSH_CONNECT_TIMEOUT`, `SSH_COMMAND_TIMEOUT`
- Note: AOS-CX config pull returns both the CLI text and the JSON running-config over REST (since 2026-10-16; JSON-only before). AOS-S/CLI devices return raw CLI text. Every artifact is checksummed and diffed the same way.

**Deferred:** SSH enable/privileged-mode escalation prompts, SSH key auth (currently password auth), and richer `show version` parsing into structured fields.

---

### 5b. Central-managed detection & config-write guardrails
**Priority**: High
**Status**: 🔨 Core implemented (2026-07-08) — switch-side probe, schema fields, backup
routing, and UI shipped and verified against live hardware. Remaining: Central-side
group/monitor-only enrichment and restore guardrails (restore itself still deferred). The
OAuth blocker found by the 2026-07-08 endpoint triage was the token request itself: it
posted `client_credentials` to the API gateway instead of HPE GreenLake SSO. Fixed 2026-10-16
(GreenLake API clients, cluster picker) and verified live the same day; first contact also
fixed the inventory field mapping (serial/status/last-seen). A full live sync is still to run.

`Device.managementMode` records record provenance, not the switch's own view of config
ownership. A CX switch connected to Central in **managed** mode rejects local config writes
(and with `configuration-lockout central managed`, blocks them outright), which affects
config backup/restore. Plan: probe the switch's `GET /rest/v10.xx/system/aruba_central`
resource (authoritative), optionally enrich from Central group properties
(`monitor_only_cx`), persist as new `centralManaged*` fields, prefer CX REST for config
reads, and block direct config writes to Central-managed switches. Also triage the
classic-vs-New-Central endpoint mix in `aruba-central.service.js` (the `central` backup
path via `getDeviceConfiguration` is likely broken on a New Central tenant).

Switch-side probe facts: `docs/hardware/AOS_CX_NOTES.md` ("Central management probe").

---

### 5c. Multi-Vendor Support (Juniper + Cisco)
**Priority**: High
**Status**: 🔨 Phases 0–2 complete (2026-07-12) — vendor abstraction + multi-cloud
groundwork shipped (Aruba behavior unchanged), Juniper Mist live as the second cloud
platform, and Junos devices reachable directly over NETCONF. Phases 3–4 (Meraki,
Catalyst direct) not started.

Extend device support beyond Aruba to Juniper (Mist cloud + Junos direct SSH) and Cisco
(Meraki Dashboard API + Catalyst direct SSH). MVP bar per vendor: inventory sync + status,
config backup, connection testing.

**Phase 0 (done):** explicit `vendor`/`platform` fields on Device; `CloudIntegration` table +
`BaseCloudProvider`/`CloudProviderFactory` abstraction with Aruba Central as the first
implementation; declarative transport-routing matrix generalizing `pullConfig()`;
`/settings/cloud-integrations` multi-row CRUD API + `CloudIntegrations.vue`; junos/cisco-ios
SSH profiles staged. **Multiple cloud environments are supported simultaneously** — including
several tenants of the same platform (e.g. two Central accounts + a Mist org) — with each
inventoried device attributed to its owning integration. The old `aruba-central.service.js`
is gone; its unverified classic endpoints are quarantined behind typed `CapabilityError`s.

**Phase 1 (done):** Juniper Mist provider — token auth, org-scope validation, paginated
inventory, live stats enrichment, and config backup of Mist-managed EX/SRX devices as
canonical-JSON snapshots of their Mist config object (Mist is intent-based; it has no
running-config — that comes over SSH in Phase 2). Regional-cloud picker in the UI.

**Phase 2 (done):** Junos direct over **NETCONF** (not SSH — the roadmap's original call was
reversed; see the doc). Hand-rolled RFC 6241/6242 client over the ssh2 `netconf` subsystem,
zero new dependencies, because CLI screen-scraping is fragile in a way framed NETCONF
messages are not. Config is pulled as committed set-format. **NETCONF is not enabled by
default on Junos**, so a device that refuses the subsystem is detected and falls back to the
SSH CLI automatically.

**Implementation:**
- Backend: `src/constants/vendors.js`, `src/utils/transport-router.js`, `src/services/cloud-providers/` (base + factory + aruba-central + mist providers), `src/services/device-api/netconf-client.js` + `junos-api.js`, migration `20260712000000_multi_vendor_phase0`
- Frontend: `src/models/vendors.js`, `src/components/settings/CloudIntegrations.vue`, vendor/platform/integration selectors in `DevicesView.vue`

**Full design & phased roadmap:** `docs/MULTI_VENDOR_ROADMAP.md`

---

### 6. Multi-tenancy Support
**Priority**: Low
**Status**: Not Started

Support for multiple organizations/customers:
- Tenant isolation
- Per-tenant API credentials
- Role-based access control per tenant
- Tenant-specific dashboards and reports

---

### 7. Mobile Application
**Priority**: Low
**Status**: Not Started

Native mobile apps for iOS/Android:
- Real-time device monitoring
- Push notifications for alerts
- Quick actions (reboot, test connectivity)
- Offline mode with cached data

---

### 8. API Rate Limiting & Throttling Dashboard
**Priority**: Low
**Status**: Not Started

Visual dashboard showing:
- Current API usage against Aruba Central limits
- Rate limit warnings
- Request queuing status
- Optimization suggestions

---

### 9. Device Grouping & Tagging Enhancements
**Priority**: Medium
**Status**: Not Started (flat device groups with a UI shipped 2026-10-23, #26; the items below go beyond them)

Advanced device organization:
- Custom tags and labels
- Hierarchical grouping (region > site > building > floor)
- Bulk operations on groups
- Group-based access control

---

### 10. Audit Log & Compliance Reporting
**Priority**: Low
**Status**: Not Started

Comprehensive audit trail:
- User action logging
- Device configuration change history
- API credential access logs
- Exportable compliance reports
- Retention policies

---

### 11. Built-in UI Themes
**Priority**: Low
**Status**: ✅ Shipped in `release/beta` (spike 2026-10-15; leftovers done 2026-10-19): Light, Dark and Classic (circa-2010 admin portal) themes, a theme menu, and the choice saved per browser

Built-in themes only. Users can't define their own. See "Themes" in `CLAUDE.md` for how it works.
- Done: theme tokens instead of hardcoded colors across the automations builder; vue-flow CSS imported and themed; Dark primary changed to `#2D6A00`.
- Done (2026-10-19):
  - The last hardcoded colors are gone. The login and 404 backgrounds are primary gradients, the dashboard status chart reads the current theme's colors (Chart.js can't use CSS variables), and the device raw-data block uses theme tokens. The unused `src/style.css` was deleted.
  - Dark's green was too dark to read as a foreground (`#2D6A00` is 2.8:1 on `#121212`). A new `primary-text` theme color fixes this. It is Dark `#5CAB2A` (6.5:1), and the same as primary in Light and Classic. `.text-primary` (text, icons, text/outlined/tonal buttons and chips) and the primary borders and outlines use it, while fills keep primary, which is 6.6:1 against white text.
- Open questions:
  - Light's orange `#FF8300` is 2.5:1 on white, both as text and behind white button labels. That is below WCAG AA; fixing it means changing the brand color.
  - Per-user (server-side) theme preference only if testers ask.

---

### 12. Scale-out (larger fleets, multiple backend instances)
**Priority**: High
**Status**: Not Started (planned 2026-10-22)
**Estimated effort**: Large (phased; each work item below ships on its own)

**Targets**: thousands of switches and APs, 10,000s of connected network clients (end-user devices on the managed network), and at most 100–200 signed-in NetHelper users, usually far fewer. NetHelper stores no network clients; only the on-demand address lookup reads them.

**Architecture decision**: keep nginx (or a load balancer/ingress) in front of Express. Express could serve the SPA (hashed, immutable-cached assets are not a load problem), but nginx does TLS and slow-client buffering, and becomes the load balancer once there is more than one backend (WebSocket upgrade, sticky sessions).

**Work items**, in priority order:
1. **Multi-instance readiness** (the blocker). Several parts hold single-instance state in memory: the live monitor (`live/state-monitor.service.js`), alert settle timers (`alert.service.js`), cloud event streams (`cloud/cloud-stream.service.js`), the API rate-limit store (`middleware/rate-limit.js`, express-rate-limit's default MemoryStore), the System Status sampler (`system-status.service.js`, item 13: each instance would report only itself), and Socket.io (no adapter, so an emit reaches only that instance's clients). Needs `@socket.io/redis-adapter`, a Redis rate-limit store, leader election or sharding (a Redis lock) for the monitor, streams and alert timers, and sticky sessions in nginx.
2. **Ping monitor throughput** (`ping-monitor.service.js`): lockstep batches of 20, a 5 s timeout, a 500 ms pause between batches, and one `ping` process per check. One offline device holds its whole batch for the timeout. Options: a bounded concurrency pool instead of lockstep batches, a shorter timeout for devices already known offline, skipping a cycle while the previous one still runs, or a raw-ICMP/fping-style sweep.
3. **API / worker split**: Bull processors run in the API process, on the event loop that answers HTTP. Add a worker entrypoint (e.g. `WORKER_ROLE=api|worker|all`, default `all`) so jobs scale separately; the queues are already shared through Redis.
4. **Per-device job distribution**: a config backup run handles one device at a time (the run loop in `config-backup.service.js`); give it a concurrency setting like `TOPOLOGY_CONCURRENCY`. Live monitoring is capped at `LIVE_MAX_CONNECTIONS` (200) per process; spread it across workers once item 1 exists.
5. **Socket fan-out** (Low at ≤200 sessions): `device:status:update` and `device:event` are global broadcasts. Scope them to subscribed clients only if large fleets make them noisy.

#### Current limits (estimated from code defaults, not load-tested)
Replace an estimate with a measured value when one exists.

| Area | Practical limit today | Why | Tunable |
|---|---|---|---|
| Backend instances | **1** | In-memory state (item 1) | — |
| Ping monitoring (60 s cycle) | **~500 devices** dependable; ~2,000 if all answer, ~220 if every batch holds an offline device | Batches of 20; an offline device costs the 5 s timeout; 500 ms between batches | `PING_MONITOR_BATCH_SIZE`, `PING_MONITOR_TIMEOUT`, `PING_MONITOR_INTERVAL` |
| Config backup run | **~1,000–2,000 devices** in a 6 h window, at ~10–20 s per device | One device at a time | none yet (item 4) |
| Live monitoring | **200 devices** | Hard cap; one WebSocket per device, one process | `LIVE_MAX_CONNECTIONS` |
| Topology collection | thousands per 6 h cycle | 4 devices in parallel; cloud neighbors read in bulk per integration | `TOPOLOGY_CONCURRENCY` (max 32), `TOPOLOGY_INTERVAL` |
| Central address lookup | **20,000 clients** | Walks the whole client list sequentially, 20 pages × 1000; clients past the cap are missed without a warning | code constant (`aruba-central.provider.js` `findByAddress`) |
| Mist address lookup | no client-count limit | IP-filtered searches (`limit: 20`) | — |
| Mist API budget | 5,000 requests/hour per org | The status refresh is one paged read (1000 per page) every 5 min; per-device calls (config backups) count against the budget | `CLOUD_STATUS_INTERVAL`, `CLOUD_SYNC_INTERVAL` |
| Mist list pagination | 100,000 items per list | 100 pages × 1000, then a logged warning | code constant (`mist.provider.js`) |
| Discovery sweep | /16 accepted, but a /16 likely exceeds the nmap timeout; ~/20 is practical | nmap `-sn -T4`, one scan at a time | `DISCOVERY_SCAN_TIMEOUT` |
| Network Map | a few hundred nodes per view | vue-flow + dagre render every node | the map's site filter |
| Full-inventory pickers | ~5,000 devices | `devicesStore.ensureAllDevices()` loads every row; the device table itself is server-paginated | — |
| Signed-in users | 100–200 is fine | Stateless JWTs; 1000 requests per 15 min per user | `RATE_LIMIT_MAX_REQUESTS` |
| Database connections | Prisma's default pool (CPUs × 2 + 1) | Can contend under heavy job load | `connection_limit` in `DATABASE_URL` |

---

## 🎯 How to Use This File

### Adding New Items
When adding new long-term TODO items, include:
- Clear title and description
- Priority (Low, Medium, High, Critical)
- Status (Not Started, In Progress, On Hold, Completed)
- Estimated effort
- Benefits and use cases
- Technical requirements (if known)
- Prerequisites
- Related files/documentation

### Moving Items to Active Development
When an item is ready to be worked on:
1. Update status to "In Progress"
2. Create detailed implementation plan
3. Break down into smaller tasks
4. Add to sprint/project board
5. Assign owner

### Archiving Completed Items
When an item is completed:
1. Update status to "Completed"
2. Add completion date
3. Move to "Completed" section at bottom of file
4. Link to relevant PRs/commits

---

### 13. System Status page
**Priority**: Medium
**Status**: ✅ Shipped 2026-10-22 in `v0.9.0-beta.3`

Admin-only page at `/system`, opened from the version indicator at the right of the status bar (and the Admin nav). `services/system-status.service.js` samples every `SYSTEM_SAMPLE_INTERVAL_MS` (5 s) and keeps the last hour in memory: process CPU/memory, event-loop lag, API requests per interval (`middleware/request-metrics.js`: counts by status class, p50/p95 latency), sockets and signed-in users, and every Bull queue's waiting/active/delayed/failed counts plus jobs finished per interval. At most once a minute, and only while someone watches: Postgres size, connections and largest tables, Redis INFO, free disk for the backup and log directories, backup storage totals, usage counts (devices by status and vendor, users by role, alerts, last 24 h runs/backups/events), repeatable-job next runs, and the live monitor / live view / cloud stream / alert-settle state. Live over the `system:status` socket room; HTTP polling when the socket is down. A failing source shows its error and the others still report.

**Deferred**:
- Persisted history (survive restarts, longer than an hour).
- Per-route latency and slowest endpoints.
- Alert rules on the same signals (queue backlog, failed jobs, memory, disk free, event-loop lag).
- Aggregation across instances (item 12).
- Cloud API budget use per integration (overlaps item 8).

---

### 14. Activity feed (fleet-wide device activity)
**Priority**: Medium
**Status**: ✅ Merged to `master` 2026-10-23 (`eef1049`), not yet released. Cloud alarms joined it as a category on 2026-10-23 (item 2a).

A rolling feed of what happened to the managed devices, at `/activity` (nav item) and in the dashboard's Recent Activity card (which used to be just the loaded table page sorted by `lastSeen`). Separate from the status bar, which is about NetHelper itself. `GET /api/v1/activity` (`services/activity.service.js`, any signed-in role, read-only) merges rows other services already write: `DeviceEvent` status changes (ping/cloud) and restarts, `ConfigBackup` successes that found a change, and device alerts opened/resolved. Noise control: a device's first ping/cloud state (no `data.previous`) is a History starting point, not news; a device's first successful backup is a capture, not a change; the ping/cloud offline alert rules are left out (their status events say it) and so are resolutions by merge; port link/PoE/live-monitor events are a separate `port` category, off by default; repeats of one kind on one device/port within 10 minutes fold into one "flapping" item with a count. Filters: categories, vendor, device (kept in the URL); paging by `before`. The page refetches its newest items a few seconds after a relevant `device:event`, `backup:completed` (with changes) or `alert:*`.

**Deferred**:
- Device-group and free-text filters; a link from the device page to its filtered feed.
- Sync results (devices adopted, possible duplicates, devices that left a cloud) and discovery imports as feed items: they aren't stored per device today.
- Folding spans one page only: a flap split across a page boundary shows as two items.
- Per-port noise rules (e.g. show uplink ports only) once ports carry a role.

---

## ✅ Completed Items

Recently shipped (details in the sections above): Automated Device Discovery (item 4), Configuration Backup Scheduling (item 5), Direct-managed device support / SSH config pull (5a), Central-managed detection core (5b), Multi-Vendor Phases 0–2 (5c).

---

## 🗂️ Historical backlog note

The old per-tier backlogs (`backend_todo.txt` / `frontend_todo.txt`, dated March 2025) were reviewed during the 2026-07 doc consolidation and found **obsolete** — every concrete item sampled (execution status transitions, `auth/register`, `auth/me` GET/PUT, nested schedule/execution routes) is already implemented, and they still reference the deleted `aruba-central.service.js`. They were archived, then deleted on 2026-10-19 (git history has them). No open items were carried forward from them.

---

**Last Updated**: 2026-10-19 (Mist first contact and parity)
**Maintained By**: Development Team
