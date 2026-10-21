# Changelog

All notable changes to NetHelper. Versions follow [Semantic Versioning](https://semver.org/); pre-1.0 releases may change behavior between minor versions.

## [Unreleased]

### Fixed
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
