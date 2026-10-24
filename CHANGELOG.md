# Changelog

All notable changes to NetHelper. Versions follow [Semantic Versioning](https://semver.org/); pre-1.0 releases may change behavior between minor versions.

## [Unreleased]

### Added
- **Activity** page (`/activity`, in the menu): a rolling feed of what happened to your devices lately, newest first, grouped by day. It shows ping and cloud status changes, restarts, config changes found by backups, and device alerts opening and clearing. Port link and PoE changes are available as a filter but off by default, and repeated changes on the same device or port within ten minutes are folded into one "flapping" line. Filter by kind, vendor or device; it updates live. `GET /api/v1/activity`.
- **Cloud alarms in the Activity feed**: the alarms Juniper Mist and Aruba Central raise (optics, PoE, fans and power, OSPF/BGP peers, IPsec and uplinks, loops, DHCP/DNS failures, and more) appear in the feed, with when Central cleared them and why. When Central cleared an alert on its timer, the feed says the problem may not be fixed. Read-only: nothing is acknowledged or cleared in the cloud. Alarms are tied to a device when NetHelper can tell which one; otherwise they show their site. Types that repeat what NetHelper already shows (device offline/online, restarts) are left out. Mist raises only the alarm types enabled in its org alarm template. New settings `CLOUD_ALARMS_ENABLED`, `CLOUD_ALARM_INTERVAL` (5 minutes) and `CLOUD_ALARM_RETENTION_DAYS` (30).

- **Alert notifications by email and webhook** (Settings → Notifications, admins): send alerts to email recipients or a webhook (Slack, Teams, or any JSON receiver) with a minimum severity and, optionally, only some rules. Each channel gets one message when an alert opens and one when it resolves, never for repeats; failed deliveries are retried and shown on the channel, and **Test** sends a sample. Webhook URLs and headers are stored encrypted and never shown again. Email needs `SMTP_HOST` (and `SMTP_USER`/`SMTP_PASS` if your server wants a login); `APP_BASE_URL` sets the link in messages.
- **Device groups** on the Devices page: **Groups** lists them with their device and automation counts, creates and renames them (operators), deletes them (admins), and "Show devices" filters the table to one. Select devices in the table and choose **Group** to add them to a group (type a new name to create one) or take them out. The table has a Group filter, including "No group". Automations' Manual and Schedule targets and their Alert and Configuration Change filters use these groups; until now they could only be made through the API. `POST /devices/groups/:id/members`, `GET /devices?group=`. (#26)
- **Firmware Status** shows the firmware version every device last reported (from cloud sync, status refreshes and polls) without polling anything, with a count per version. (#25)

### Changed
- **Firmware Status** is linked from the Devices page header; until now it could only be opened by typing its address. Settings drops its two empty tabs (General, Advanced) and gains **Connection Test** (operators and admins): the manual device connection test that used to live at an unlinked address, which now opens this tab. The test was marked "Admin Only" but has always been open to operators. (#25)
- The dashboard's **Recent Activity** card shows the newest items of the Activity feed. It used to list devices by when they were last seen, and only those on the Devices table page that was loaded.

### Fixed
- The cloud status refresh no longer rewrites every cloud-managed device row each time it runs (every 5 minutes, and as often as every 30 seconds with the Mist event stream). It records one time per integration instead, so a large Mist org no longer churns the device table, and a device's `updatedAt` again means its record changed. (#50)
- The device page's **Last Seen** card keeps "Confirmed by <cloud> N minutes ago" current while the page is open: each status refresh now tells open pages when it read the cloud. (#46)
- The **History** tab no longer draws a slower reply for an older range under the newer range's toggle (switching 30 days → 24 hours quickly), and it reloads every 5 minutes while visible so the window keeps reaching "now". (#52)
- "Who has this address?" no longer shows a lookup that finished after you moved to another device on that device's banner. (#52)
- The dashboard no longer reloads the whole device inventory every 30 seconds. Its cards read the server's status counts, refreshed a few seconds after status changes arrive and every 5 minutes otherwise (paused while the tab is hidden). Settings → API Credentials no longer loads every device on each visit; the credential test dialog reads only that credential's devices when it opens. (#51)
- Firmware Status's error message can be closed again, and button and title icons have their usual gap before the label. (#27)
- The device page no longer shows "Failed to Load Device" when the API rate limit is hit; it waits and loads again on its own, as the Devices table does.

### Removed
- Four device API routes that could never succeed, because no cloud provider implements them: `PUT /devices/:id/configuration`, `POST /devices/:id/backup`, `POST /devices/:id/command` and `GET /devices/:id/stats`. Backups run through `POST /backups/run`, and NetHelper never writes configuration to devices. Also removed: frontend service methods for routes that don't exist, two empty files, and socket listeners for events the server never sends. One of those listeners would have written a device back to the API from every open browser if the event had ever been sent. (#28)

### Upgrading from 0.9.0-beta.3
- Take a database backup first: migrations are forward-only. **Docker Compose**: run `deploy/install.sh` from the new tree (it keeps your `.env` values). **Bare metal**: follow "Upgrading" in [`deploy/README.md`](deploy/README.md).
- Two migrations: `20261023120000_cloud_status_check` adds the `CloudStatusCheck` table (one row per cloud integration), and `20261023150000_notification_channels` adds `NotificationChannel`.
- Email notifications read `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` and `APP_BASE_URL`. Docker Compose now passes them from `deploy/.env` (see `deploy/.env.example`); on bare metal add them to `/etc/nethelper/backend.env`. `SLACK_WEBHOOK_URL` was never used and is gone from the examples: use a webhook channel instead.

## [0.9.0-beta.3] — 2026-10-22

A device History tab and "who has this address?" lookup, a System Status page for admins, a Configuration Change automation trigger, a per-user API rate limit, and fixes from a review of the changes since beta.2. Scope and limitations are unchanged: see [`docs/BETA_NOTES.md`](docs/BETA_NOTES.md).

### Added
- **Device History tab**: a timeline per point of view (ping from NetHelper, the device's cloud) and a combined lane that shows when they disagreed (answers ping while the cloud says offline, or the reverse), over 24 hours, 7 days or 30 days. Config backups are marked across all lanes; a backup that found a change shades the window the change happened in. Cloud-reported restarts are marked too. Ping states are recorded from this release on, so earlier time shows as no data. `GET /devices/:id/history`.
- The device page's **Last Seen** card says when the device was last confirmed alive and by whom (ping, its cloud, or a connection test). A ping reply while the cloud reports the device offline doesn't count as a confirmation, because the address may belong to another device. When ping and the cloud disagree, the card's corner shows ping's own last reply, linked to the History tab.
- Ping-vs-cloud disagreement on the device page is a warning banner instead of a grey caption. When the cloud reports the device offline but its address answers ping, and another device in NetHelper with the same IP is online, the banner names and links that device as what answers. When no such device explains the ping, a "Who has this address?" button in that banner looks the address up: each cloud's devices and clients seen with that IP (Mist and Central; with the switch port or AP a client is on), the host's neighbor table (the answering MAC and its vendor), LLDP/CDP neighbors and the latest discovery scan. The MAC holding the address, from the neighbor table or else from a cloud's client record, is compared with the device's own. It sends nothing to the address, and each cloud costs a few filtered queries, not an inventory read.
- **Configuration Change automation trigger**: an automation can run when a device's config backup differs from its previous successful one (never on a device's first backup), optionally only for some artifact kinds (CLI, structured) or device groups. The run gets the device, and its trigger step reports both backups and which kinds changed. Run history shows these runs as "config-change". Detection follows the backup schedule, so a change is noticed at the next backup, not when it is made.
- **System Status page** (admins, `/system`): click the version at the right of the status bar, or System Status in the menu. It shows how the NetHelper server is doing, updating live: CPU, memory and event-loop lag of the backend process; API requests per minute with error counts and latency; connected sockets and users; every job queue's waiting, active, delayed and failed jobs and how many finish per minute; PostgreSQL size, connections and largest tables; Redis memory and clients; free disk for backups and logs; usage counts (devices by status and vendor, users, alerts, the last 24 hours of automation runs, backups and device events); and the state of live monitoring and cloud event streams. Charts cover the last hour, kept in the server's memory (lost on a restart). A source that can't be read shows its error and the rest still report. New optional setting `SYSTEM_SAMPLE_INTERVAL_MS` (default 5000).

### Changed
- Dependency upgrades, including major versions of helmet (8), express-rate-limit (8) and dotenv (18) in the backend, and vitest (5) and jsdom (30) for frontend tests, plus grouped minor and patch updates in both tiers and newer GitHub Actions.
- "Who has this address?" is now for operators and admins only: it spends the cloud's API quota and shows cloud client records (hostnames, MACs, ports) that viewers don't otherwise see.

### Fixed
- Editing an API credential and saving without retyping its API key replaced the stored key with the literal text `***`. A secret left blank, or sent back as its mask, now keeps its stored value, and the API Key field is masked like Password and Secret.
- A cloud integration whose credentials could no longer be decrypted (for example after `ENCRYPTION_KEY` changed without `npm run key:rotate`) was skipped by sync without a word, and the next full sync even resolved its "Cloud sync failed" alert as if it had recovered. Sync now raises that alert for it, saying why, and when no integration can be loaded the scheduled sync runs anyway and says so instead of skipping itself quietly.
- The History tab showed "No data" for a device whose ping and cloud states hadn't changed for longer than `DEVICE_EVENT_RETENTION_DAYS` (30 days), because the daily prune deleted its only state event. The prune now keeps each device's newest ping and cloud state event regardless of age.
- The device page's Last Seen card didn't update on an open page: live status updates dropped the cloud's last-seen and checked times, and the ping monitor never sent its last reply time. Both reach the page now.
- "Who has this address?" on Aruba Central read the whole client list (up to 21 API calls) on every click. It now stops at the first connected client holding the address, and a cloud's answer for an address is reused for a minute and shared by lookups running at the same time.
- In development, a long-running `npm run dev` kept showing the version it started with after a release bump; the dev server now restarts when `frontend/package.json` changes. Builds were never affected.
- The API rate limit counted requests per client IP, and behind nginx or the dev proxy (without `TRUST_PROXY`) every user shares one IP, so one busy browser could make the whole Devices list fail for everyone with "Too many requests". It now counts per signed-in user (per IP only for requests without a valid token), and a 429 is JSON with `Retry-After`. When it does happen, the Devices table keeps the rows it already shows, says when the API takes requests again, and retries on its own. The default `RATE_LIMIT_MAX_REQUESTS` goes from 300 to 1000 per 15 minutes: one person's busy session measured about 150, and all of a user's tabs now share one count.
- A "Cloud sync failed" alert for a cloud integration that stopped syncing stayed open forever, because only that integration's next successful sync cleared it. This covers an integration that was deleted or deactivated, and the `ARUBA_CENTRAL_*` environment fallback once a Central integration exists in Settings. Deleting or deactivating an integration now resolves its alert, and every scheduled sync resolves the alerts of integrations it no longer runs.

### Upgrading from 0.9.0-beta.2
- Take a database backup first: migrations are forward-only. **Docker Compose**: run `deploy/install.sh` from the new tree (it keeps your `.env` values). **Bare metal**: follow "Upgrading" in [`deploy/README.md`](deploy/README.md).
- Viewers lose the "Who has this address?" button (`GET /devices/:id/address-lookup` is now operator+).
- An install that sets `RATE_LIMIT_MAX_REQUESTS` keeps its value; remove it (or raise it) to get the new default of 1000. Older `.env` files copied from `.env.example` before 0.9.0-beta.1 may still say 100.
- One migration, `20261022120000_device_seen_sources`, adds three columns to `Device` (`pingLastSeen`, `cloudCheckedAt`, `cloudLastSeen`).

## [0.9.0-beta.2] — 2026-10-21

Fixes from the first round of beta feedback, a one-step Docker Compose installer, and the first release with prebuilt images and a release tarball. Scope and limitations are unchanged from 0.9.0-beta.1: see [`docs/BETA_NOTES.md`](docs/BETA_NOTES.md).

### Upgrading from 0.9.0-beta.1
- Take a database backup first: migrations are forward-only. One migration, `20261021120000_device_api_test_status`, adds four columns to `Device` and runs on start.
- **Docker Compose**: if `deploy/.env` sets `NETHELPER_VERSION` (the 0.9.0-beta.1 `.env.example` did), delete that line, or the old version stays pinned. Then run `deploy/install.sh` from the new tree; it keeps your `.env` values. To pull the prebuilt images while the repository is private, first run `docker login ghcr.io` with a GitHub token that has `read:packages`; without it, the installer builds the images on the host.
- **Bare metal**: follow "Upgrading" in [`deploy/README.md`](deploy/README.md). The release tarball includes the built UI, so the frontend build step can be skipped. The new `nethelper-admin` helper is optional.
- **API**: `GET /device-api/:id/info` and `GET /device-api/:id/firmware` are removed (use `POST /device-api/test/:deviceId` and the device pollers). `POST` and `PUT /devices` ignore fields other than the editable ones, listed under Fixed below.

### Deployment
- **One-step Docker Compose install**: `deploy/install.sh` checks Docker and Compose, creates `deploy/.env` with generated secrets (it fills in only empty required ones and never changes a set value), pulls the release images or builds them locally, starts the stack, waits until it is healthy, and creates the first admin. Run it again to upgrade. `--host-network` sets up the L2-discovery override, `-y` runs it unattended, and `--env-only` only writes `deploy/.env`. It doesn't install Docker, set up TLS, or take backups.
- **Release artifacts**: pushing a `v<version>` tag publishes the backend and frontend images to GHCR (`ghcr.io/bryanbuck/nethelper-*`) and a GitHub release with `nethelper-<version>.tar.gz`, which includes a prebuilt UI so bare-metal installs skip the frontend build (`.github/workflows/release.yml`). Pulling needs `docker login ghcr.io` while the repository is private; without it the installer builds locally.
- **Bare metal**: `deploy/systemd/nethelper-admin` writes `/etc/nethelper/backend.env` with generated secrets (`init-env`), and runs the user CLI (`users`) and key rotation (`rotate-key`) as the service user. It replaces the long `sudo -u nethelper sh -c 'set -a; …'` commands.
- `npm run user:manage -- create-admin --if-no-users` does nothing when users already exist, and `count-users` prints how many there are.
- Compose images are now named `${NETHELPER_REGISTRY:-ghcr.io/bryanbuck}/nethelper-backend|frontend`, for local builds too.

### Fixed
- `deploy/.env.example` set `NETHELPER_VERSION`, so after an upgrade a copied `.env` kept the old version: the UI showed it, and pulls would fetch the old images. It is now unset by default and follows the tree; `install.sh` warns when an old pin differs from the tree.
- Device page: **Configure**, **Check Firmware** and **Backup Config** did nothing ([#1](https://github.com/bryanbuck/nethelper/issues/1)). The header now has **Test Connection** (a Details link opens the full test), **Refresh System Info**, **Back Up Now** and **Edit**, which opens the same edit dialog as the Devices table. The duplicate Quick Actions card is gone. Back Up Now and Edit are for admins and operators.
- Devices table: pagination and column sorting did nothing ([#5](https://github.com/bryanbuck/nethelper/issues/5)). `GET /devices` now returns one page when given `limit` (with `page`, `sortBy`, `sortOrder`), the matching-row count and a fleet-wide status summary for the page's cards. Search also matches model, location and MAC. Pickers elsewhere (backups, credentials, automations, firmware) load the whole inventory instead of the Devices page's filtered page ([#24](https://github.com/bryanbuck/nethelper/issues/24)).
- Devices table: the row menu's **Reboot**, **Device Info** and **Remove** did nothing ([#2](https://github.com/bryanbuck/nethelper/issues/2)). **Remove** deletes the device (admins, with a confirmation); Reboot, Device Info and the bulk **Reboot Selected** are gone, since NetHelper doesn't write to devices.
- Buttons were shown to roles the API refuses ([#6](https://github.com/bryanbuck/nethelper/issues/6)): adding, syncing, editing, testing and polling devices, discovery scans and imports, and credential actions are hidden from viewers; cloud integration add/edit/test/delete and the Git mirror are admin-only.
- Settings: one error appeared in all three sections, and non-admins always saw a 403 ([#7](https://github.com/bryanbuck/nethelper/issues/7)). Each section keeps its own error.
- Devices table: **Export CSV** and **Export Selected** did nothing ([#10](https://github.com/bryanbuck/nethelper/issues/10)). Export CSV writes every device matching the search and filters; Export Selected writes the selection, across pages.
- Devices table: clearing the search with its X left the table filtered ([#11](https://github.com/bryanbuck/nethelper/issues/11)).
- Device type shown or matched by display name ([#12](https://github.com/bryanbuck/nethelper/issues/12)): the Recent Activity icons and its stray `"` separator, the device page's Device Type card, and the Devices table's Performance column (removed: none of its fields exist).
- Devices table: API Status showed the shared credential's last test on every device using it ([#18](https://github.com/bryanbuck/nethelper/issues/18)). Each device now records its own last test (`Device.apiTestStatus`, `apiLastTested`, `apiResponseTime`, `apiError`; migration `20261021120000_device_api_test_status`), cleared when its credential changes.
- Automations page: the list, stats and loading state never updated ([#4](https://github.com/bryanbuck/nethelper/issues/4)).
- Dashboard: the status cards weren't clickable and their links were ignored ([#8](https://github.com/bryanbuck/nethelper/issues/8)); **Create Automation** opened the 404 page ([#9](https://github.com/bryanbuck/nethelper/issues/9)). A Dashboard card opens the Devices page filtered by that status; on the Devices page the cards filter the table in place (click again, or Total, to clear).
- Device page: system info was polled on every visit, showing a warning for devices nothing can poll and opening a device session each time ([#17](https://github.com/bryanbuck/nethelper/issues/17)). It now polls on load only when a local reader, an IP address and a linked credential exist (`GET /devices/:id` returns `systemPoll`); otherwise the System Information card says why (cloud-only device, no direct transport, no IP, no credential), and **Refresh System Info** is hidden.
- Device page: the type-specific card read fields that don't exist and printed the raw type, e.g. "access_point Information" ([#3](https://github.com/bryanbuck/nethelper/issues/3)). It is replaced by **Platform & Access**: vendor, platform, linked credential, the device's last connection test, groups, and the hardware details its cloud reports (part number or SKU, hardware revision, persona, role, deployment).
- Add and Edit device forms required an IP address and a location, so cloud-synced devices without one couldn't be edited at all ([#13](https://github.com/bryanbuck/nethelper/issues/13)). Location is optional in both; the IP is required when adding a device and when editing a directly managed one. A blank field is stored as empty.
- `PUT /devices/:id` wrote any field in the request body, so a `status` field gave a 500 and an operator could set system-owned columns such as cloud ownership, ping state or metadata ([#14](https://github.com/bryanbuck/nethelper/issues/14)). `POST` and `PUT /devices` now write only the fields a person edits (name, type, vendor, platform, model, IP, MAC, location, serial, management mode, cloud integration, credential). Cloud sync also keeps a new device's last-seen time and cloud ownership, which it used to drop until the next sync.
- Device API Testing: the manual test offered AOS Switch, Instant AP and Aruba Controller, which always failed, and didn't offer Junos ([#19](https://github.com/bryanbuck/nethelper/issues/19)). It now takes a platform (AOS-CX, AOS-S, Junos, IOS / IOS-XE) from `GET /device-api/supported-types` and is routed like a stored device of that platform: REST, NETCONF then SSH, or SSH. The Supported Platforms list shows which transports each is tested over, and Recent Tests records failed tests too.
- Device page: the connection test **Details** dialog re-ran the test, showed a cloud-only result as a failure, and failed silently loading device info for SSH devices ([#20](https://github.com/bryanbuck/nethelper/issues/20)). It shows the result beside the button (**Test Again** runs a new one), a cloud-only result is shown as information, and the device and firmware details come from the test itself. `GET /device-api/:id/info` and `/firmware`, which skipped the transport routing, are removed; the device page's System Information uses the poller.
- Automation builder: a node added to (or duplicated in) a saved automation reused an existing node's id, so it merged into that node or took over its connections ([#21](https://github.com/bryanbuck/nethelper/issues/21)). New nodes now get an id the workflow doesn't use yet.
- Automation builder: the status chip said **Active** for every valid workflow, including drafts that will never run; it now follows the automation's active state ([#22](https://github.com/bryanbuck/nethelper/issues/22)). Workflow Settings dropped its **Enable workflow** checkbox, which set a hidden flag that made Run Now fail and schedules and alert triggers skip the automation; saving from the builder turns that flag back on. The dialog's **Cancel** now discards its edits, and **Save** applies them to the workflow (the workflow's own Save stores them) instead of saying "Settings saved".
- Automation builder: the node dialog's **Test** button did nothing and is gone; Run Now and Deploy check every node ([#23](https://github.com/bryanbuck/nethelper/issues/23)). **Deploy** after a failed save no longer activates the previously saved version and reports success.
- Config Backups: **Compare** offered only the backups that happened to be on the table's current page, often just the one clicked ([#15](https://github.com/bryanbuck/nethelper/issues/15)). It now loads the device's (or cloud scope's) last 200 successful backups when it opens.
- Every "All devices" backup run put one error in the status bar per Mist AP, burying real failures ([#16](https://github.com/bryanbuck/nethelper/issues/16)). A device whose platform has no per-device config (its config lives in the cloud scope backups) is still recorded on its backup row, but it is left out of the status bar and counted apart: "Backup run finished: 12/12 device(s) backed up, 80 skipped (no per-device config; see Cloud Scopes)". `backup:failed` carries `unsupported: true` for such a device, and `backup:run:completed` an `unsupported` count.

### Known issues
- The Firmware Status and Device API Testing pages aren't in the navigation, and two Settings tabs are empty ([#25](https://github.com/bryanbuck/nethelper/issues/25)).
- There is no UI to manage device groups, which automation triggers and targets use ([#26](https://github.com/bryanbuck/nethelper/issues/26)).
- The Firmware Status page's error can't be dismissed, and some buttons lack their icon spacing ([#27](https://github.com/bryanbuck/nethelper/issues/27)).

## [0.9.0-beta.1] — 2026-10-20

First packaged release, for a private in-house beta. Covers everything built so far, hardened and packaged for deployment. See [`docs/BETA_NOTES.md`](docs/BETA_NOTES.md) for scope and known limitations.

### Features
- Multi-vendor inventory and status across cloud planes (Aruba Central, Juniper Mist; several integrations at once, including several tenants of one provider) and directly managed devices (AOS-CX REST, AOS-S SSH, Junos NETCONF with SSH fallback).
- Configuration backups: scheduled and on-demand, SHA-256 change detection, unified diffs, retention, and an optional Git mirror.
- Network discovery (nmap sweep, MAC OUI and port fingerprinting, cross-check against cloud inventory).
- ICMP status monitoring for directly managed devices.
- Users page for admins (create, change role, reset password, delete), and self-service password change.
- Automation builder (**experimental**).

### Security
- No self-signup: `POST /auth/register` is admin-only and issues no tokens. First admin: `npm run user:manage -- create-admin`.
- Passwords at least 12 characters; failed login/refresh/change-password attempts are rate-limited; login timing no longer reveals whether an account exists; logout and password changes revoke refresh tokens.
- Startup configuration validation; no fallback encryption key; `npm run key:rotate` to re-encrypt stored secrets.
- CORS from configuration, not hardcoded hosts; `TRUST_PROXY`; smaller body limit; 5xx details hidden in production.
- Backup contents (full device configs) restricted to admins and operators; log redaction of secret-looking fields; Git mirror settings validated against command injection.
- Deleting a user no longer cascade-deletes the cloud integrations, credentials, and Git mirror config they created; ownership moves to another admin.
- Dependency updates for advisories in production packages: `proxy-addr` (client IP spoofing behind a trusted proxy, which the login rate limit relies on), `compression` (denial of service), `follow-redirects` (credential headers kept across redirects), and `vue`.
- Removed `scripts/test-login.js` (printed the password it tested and part of the stored hash) and the obsolete `scripts/test-cx-api.js`; `npm run user:manage` covers account problems and **Test Direct Connection** covers switches.
- `SECURITY.md`: how to report a vulnerability, and the security model.

### Documentation
- `docs/GETTING_STARTED.md`: the first hour after an install (clouds, devices, credentials, backups, status, users), with the account rights each platform needs.
- `deploy/README.md`: a per-platform device-account table and a same-host TLS recipe for the Docker install.

### Deployment
- Docker images for backend and frontend, Docker Compose stack (with a host-network option for L2 discovery), and a sandboxed systemd unit plus TLS nginx site for bare metal. Runbook: [`deploy/README.md`](deploy/README.md).
- `GET /health/ready` (database and Redis), migrations applied automatically on start, JSON logs to stdout in production, size-rotated log files. The probes also answer through the bundled nginx (`:8080/health`) and the bare-metal site.
- Node.js 22+ is required (Node 20 is end-of-life, and the `ping` package needs 22). Bare metal: NodeSource's Node 22.
- Bare metal has its own settings template, `deploy/systemd/backend.env.example`. Copying `backend/.env.example` as the runbook used to say overrode the unit's production settings and crash-looped the service.
- The host-network override is turned on with `COMPOSE_FILE` in `deploy/.env`; with `-f` flags only, a `docker compose run` recreated Postgres and Redis without the ports the backend needs. The runbook now covers installing Docker, getting the code, the Git mirror key, and the `SSL_ERROR_RX_RECORD_TOO_LONG` a browser shows when it tries HTTPS on the plain-HTTP port.
- No Prisma or npm update notices on start (`CHECKPOINT_DISABLE`, `NPM_CONFIG_UPDATE_NOTIFIER`); on bare metal Prisma's check also left a process behind.
- The Git mirror remembers an SSH remote's host key on the data volume (`BACKUP_GIT_KNOWN_HOSTS`), so recreating the container no longer trusts it anew.

### Fixed
- Aruba Central authentication: tokens now come from HPE GreenLake (Central-scoped API clients, or GreenLake-platform clients with a Workspace ID) instead of a request no Central endpoint accepted. The base URL is a New Central cluster picker; Classic `apigw-*` hosts are rejected with an explanation. The Customer ID field is gone.
- The device Add/Edit forms no longer drop the linked device credential when a device is cloud-managed. Central-managed AOS-CX switches need it for read-only local config backup and live state.
- The real-time connection no longer piles up duplicate sockets after a backend restart or network blip. One stale socket could leave the app thinking it was connected with no socket at all, so the Live tab reported "Real-time connection is not available". Reconnects also send the current login token.
- Aruba Central inventory: devices are read with the field names the live API actually uses. Before, every device came back offline with no serial, so cloud status was always "offline" and sync couldn't match devices. Switch platform is also taken from the firmware version.
- Cloud sync no longer clears a device's last-seen time when Central doesn't report one, and skips (rather than crashes on) an item without a serial.
- Cloud integration tests show the provider's own error (request, HTTP status, error code and message, suggested fixes) on the integration card, not just a toast.

### Removed
- Demo and mock data (fake devices, simulated WebSocket events, random dashboard series), placeholder pages, and the non-functional forgot-password flow.

### Fixed
- `GET /devices/groups` was unreachable (shadowed by `GET /devices/:deviceId`).
- The API-credential "Test" button reported success without contacting the device.
- Device serial numbers are optional; several devices without one can coexist.

Found on real equipment and clean installs (2026-10-20):
- AOS-S over SSH timed out after login: the CLI draws a VT100 screen, with its prompt and command echo between cursor moves and no newline. Commands now run on a 2930F (WC.16.11).
- A config read that returns only a CLI error (an AOS-S operator login's `show running-config`) was stored as a successful backup. It now fails, and says the account needs manager rights.
- The firmware version read over SSH could be the Boot ROM's.
- Settings → API Credentials: the test dialog said "Connection Successful" for every test that ran, pass or fail.
- Cloud integrations were visible only to the admin who added them; every admin now sees and manages all of them.
- A user created with the CLI using a `+tag` (or dotted Gmail) address could never sign in; email addresses are now only trimmed and lowercased everywhere.
- Failed device logins say the device rejected the username or password, and keep the switch's own reply.
- A connection test on a cloud-only AP asked for credentials no AP can use; it now shows the cloud's view.
- Discovery: importing a host with no known serial stored its MAC as the serial (a later cloud sync then added a duplicate); routed hosts without a MAC are matched to cloud inventory by IP.
- `POST /devices` without a model returned a 500.
- A cloud-managed device its cloud reports offline, but whose address answers ping, showed `online`; it is now `warning`, with the reason on hover. A cloud can keep an offline device's old IP after another device took it.
