# NetHelper Platform — Roadmap & TODO

The single forward-looking backlog for NetHelper: features and improvements planned but not yet prioritized, plus the status of recently-shipped work.

- **Architecture & the multi-vendor phased plan** live in [`MULTI_VENDOR_ROADMAP.md`](MULTI_VENDOR_ROADMAP.md) (authoritative).
- **Project conventions** live in [`../CLAUDE.md`](../CLAUDE.md).
- **Historical/superseded docs** are in [`archive/`](archive/) — do not treat them as current.

> Context: NetHelper is now **multi-vendor** (Aruba/Juniper/Cisco) with a `cloud`/`direct` management model. Some items below were written in the earlier Aruba-Central-only era; where they still apply, read "Aruba Central" as "any cloud provider" and "central/direct" as "cloud/direct." Corrected inline where it matters.

---

## 🚀 Beta Release Readiness

**Status**: 🔨 In progress (started 2026-09-25, branch `release/beta`)

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
- ⏳ Deferred: a browser E2E smoke test (login → add device → backup → diff). Cypress was never installed; better run against the Compose stack once packaging exists.
- ✅ Packaging (2026-09-25): `backend/Dockerfile` + `frontend/Dockerfile` (unprivileged nginx, same-origin `/api` + `/socket.io` proxy, CSP/security headers), `deploy/docker-compose.yml` (+ host-network override for L2 discovery), bare-metal `deploy/systemd/nethelper-backend.service` (sandboxed, `CAP_NET_RAW` only) and `deploy/nginx/nethelper.conf` (TLS), operator runbook `deploy/README.md` (install, first admin, backup/restore, upgrade, key rotation). Backend: `GET /health/ready` (DB + Redis), `npm run db:deploy`, `BIND_ADDRESS`, JSON stdout logging in production, size-rotated log files (`LOG_FILES`/`LOG_DIR`), `BACKUP_GIT_REPO_PATH`. Packages renamed `nethelper-backend`/`nethelper-frontend` at `0.9.0-beta.1`; removed `db:seed` (no seed script existed) and two loose dev scripts (one hardcoded a test password). **Not yet built or run**: the dev host has no Docker or nginx; first `docker compose up` and `nginx -t` happen on the target host.
- ✅ First run & docs (2026-09-25): `npm run user:manage -- create-admin` (non-interactive bootstrap); admin **Users** page and `/api/v1/users` (list, edit name/role, reset password, delete; no self-demote/self-delete); `POST /auth/change-password` + account-menu dialog. Fixed a data-loss hazard: deleting a user cascade-deleted the cloud integrations, credentials, and Git mirror config they created (and failed outright for automation owners); deletion now transfers them to an admin (`services/user-lifecycle.js`, used by the API and the CLI). Docs: root `README.md`, `CHANGELOG.md`, `VERSION`, `docs/BETA_NOTES.md` (support matrix with honest verification status, limitations, bug-report checklist), `docs/CONFIGURATION.md` (every env var); frontend and backend READMEs rewritten or corrected. UI shows the version and a Beta chip; dead bell button and placeholder account text removed; favicon and page title. Placeholder `ARUBA_CENTRAL_*`/SMTP values in `backend/.env.example` are now commented out: copied as-is they would have created a bogus Central integration.
- ✅ Bulk device credentials (2026-10-16): the device credential could only be set one device at a time in the edit dialog. The Devices page bulk bar now has **Credential** (operator+): pick a credential (or Remove), see per-device what will be linked, replaced, or skipped, apply, and optionally run connection tests (two at a time). `POST /devices/credential` + `/credential/preview` (`services/device-credential.service.js`). Devices reached only through a cloud (Central/Mist APs, AOS-S under Central, Meraki) are skipped; Central-managed AOS-CX switches are linked (local REST reads). New table filters: Platform and Credential (none/any/specific), so "AOS-CX + no credential + select all" links a fleet in one pass.
- ✅ Duplicate devices (2026-10-16): cloud sync matched only by serial, so a device added by hand without one was added a second time. Sync now adopts a serial-less device when exactly one has the same MAC (keeps its name, credential, groups, live monitoring). Weaker matches (same IP) are reported by `GET /devices/duplicates`, prompted on the Devices page and the device page, and merged with `POST /devices/merge` (operator+; also a bulk "Merge" action). A merge keeps one row, fills its missing fields, takes over the cloud link, and moves events, executions, config backups, discovery links, groups, and backup-schedule selections to it (`services/device-merge.service.js`). Sync now reports its outcome over `device:sync:completed`/`device:sync:failed` (it runs as a Bull job; the store used to overwrite the device list with the queue response).
- ✅ Fixed (2026-10-16): the device page cached the store's device object, which went stale whenever any view refetched the list, and ignored device-to-device navigation, so the Live tab's "Always monitor" switch showed another or an outdated row's state.
- ✅ Status bar (2026-10-16): background-activity toasts (sync, discovery, backups, automations, alerts, socket state) stacked over the page, covered clickable areas, and were gone once they timed out. They now go to a status bar at the bottom (`components/common/StatusBar.vue`): the newest message on the left, a history pop-up of the session's messages (All/Problems filter, unseen badge), and the version plus a real-time connection dot on the right. Only critical alerts still pop up (bottom-right, above the bar). Persistent messages (lost connection, critical alerts, failed automation runs) stay in the bar until dismissed. The log (`stores/notifications.js`) keeps 200 entries in `sessionStorage` per tab, so a reload keeps it; signing in or out clears it. The socket's lost/restored/failed messages share one entry instead of stacking ("Connection Lost" used to stay up forever).
- ✅ Mist first contact (2026-10-19, branch `feature/mist-parity`): a live Mist org was read for the first time (GET-only probe `backend/scripts/probe-cloud.js`, anonymised captures in `backend/tests/fixtures/mist-live/`). Fixed: site UUIDs stored as Location (now site names), last-seen and config status never populated, Mist devices stuck "unverified" (cloud ownership now from `mist_configured` / site assignment), and a presigned S3 URL in WLANs that made every site scope backup look changed (stripped by `utils/config-redact.js`). Parity with Central: a Mist-managed EX with an IP and a credential backs up the NETCONF `set` config plus Mist's object, falls back to Mist when NETCONF fails, is polled over NETCONF (pollers now follow the router; a cloud-managed device is never SSHed), and a direct connection test that can't reach a cloud device shows what the cloud reports. Also: sync merges `Device.metadata` and keeps a known IP/firmware; the device list now includes its cloud integration (table chips said "Cloud" for every provider); provider-neutral UI text; per-integration scope backup button; scope backups filter by cloud; the Central probe no longer tries CX REST on Junos/IOS switches; a Juniper device without an integration no longer falls back to Central; Mist test failures carry actions. Discovery is multi-vendor (Juniper/Mist OUIs, `matchedVendor`). Validated online the same day (devices powered on): status flips, enrichment, cloud-offline alerts auto-resolve, scope backups stable. Also (2026-10-19, the user's choice): a cloud-managed device whose cloud reports it online but that fails NetHelper's ping now shows `warning`, not `offline` (`utils/device-status.js`, mirrored in the frontend), and its ping alert reads "is not answering ping". NETCONF to the Mist EX ran once a firewall was opened (2026-10-19): connection test, NETCONF polls and LLDP neighbors worked first time. It found that a Junos account without `view-configuration` gets `/* ACCESS-DENIED */` placeholders instead of an error, which had been stored as a successful backup; such reads are now refused, and a Mist-managed switch is backed up from Mist with a warning on the backup (new `ConfigBackup.warning`, migration `20261019200000_config_backup_warning`). Also fixed: the Junos chassis MAC is `fpc-mac-base` on real hardware. With `view-configuration` granted, the full backup ran: Junos `set` config plus Mist's object. Junos still withholds four hierarchies (scripts, event-options, secret, extension-service); per the user's choice such a read is kept and the backup's warning names them, and only an all-placeholder read is refused. Not yet run on hardware: the Junos SSH CLI fallback. Plan for the rest (cloud neighbors, scheduled sync + cloud status poller, cloud event streams, alert notifications): `~/.claude/plans/at-this-point-i-reactive-blanket.md` (local).
- ⏳ Remaining: a hardware validation pass and a clean-host install dry run (phase 7). Full plan: `~/.claude/plans/i-d-like-to-take-scalable-cake.md` (local).
- ⏸ Deferred to the going-public review: rotating the secrets that were in the tracked `.env`, and a `git filter-repo` history purge.

---

## 🔮 Future Enhancements

### 1. Real-time Updates from Cloud Providers (webhooks / event streams)

**Priority**: Medium
**Status**: Not Started
**Estimated Effort**: 2-3 weeks

> **Multi-vendor note:** originally scoped to Aruba Central webhooks; now applies per cloud provider. Aruba Central and Meraki offer webhooks; **Mist offers a WebSocket event stream** (already noted as post-MVP in the multi-vendor roadmap). Implement as a capability on `BaseCloudProvider` (e.g. `subscribeEvents`) so each provider supplies its own mechanism, feeding the same internal device-update path.

#### Description
Integrate with each cloud provider's webhook/event notification system to receive real-time device status updates directly, rather than relying solely on periodic sync operations.

#### Benefits
- **Real-time visibility**: Instant notification when devices go online/offline in Aruba Central
- **Reduced polling**: Less need for frequent API calls to check device status
- **Better accuracy**: Central Status would reflect changes immediately
- **Event-driven architecture**: More efficient use of resources

#### Technical Requirements

##### Backend Changes
1. **Webhook Endpoint**: Create endpoint to receive Aruba Central webhook events
   - `POST /api/webhooks/aruba-central`
   - Handle authentication/verification from Aruba Central
   - Process event types: device status changes, alerts, configuration changes

2. **Webhook Registration**: Automate webhook registration with Aruba Central
   - Register webhook URL during initial setup
   - Handle webhook lifecycle (create, update, delete, verify)
   - Store webhook IDs and secrets

3. **Event Processing Service**:
   - Parse Aruba Central event payloads
   - Map events to internal device updates
   - Update database with new device status
   - Emit WebSocket events to connected frontend clients

4. **Security**:
   - Validate webhook signatures from Aruba Central
   - Implement IP whitelist for Aruba Central webhook sources
   - Rate limiting on webhook endpoint

##### Frontend Changes
1. **Real-time Status Display**:
   - Already handled via existing WebSocket infrastructure
   - No additional changes needed (events flow through existing `device:update` handlers)

2. **Connection Indicator**:
   - Show webhook connection status in UI
   - Display last received webhook event timestamp

#### Prerequisites
- [ ] Aruba Central account must support webhooks (check subscription tier)
- [ ] Public-facing webhook endpoint (requires proper domain/SSL)
- [ ] Understand Aruba Central webhook payload formats
- [ ] Test webhook reliability and rate limits

#### Implementation Steps
1. Research Aruba Central webhook documentation
2. Set up test environment with ngrok or similar for webhook testing
3. Implement webhook endpoint and event processing
4. Add webhook management UI in Settings page
5. Test with various device event types
6. Deploy to production with proper SSL and domain
7. Monitor webhook reliability and performance

#### Related Documentation
- [Aruba Central API Webhooks Documentation](https://developer.arubanetworks.com/aruba-central/)
- WebSocket service: `frontend/src/services/websocket.service.js`
- Device service: `backend/src/services/device.service.js`

#### Notes
- This complements the ICMP ping monitoring (Item 1) rather than replaces it
- Webhooks from Aruba Central show their view of device status
- ICMP ping provides our on-prem view of reachability
- Having both sources creates a comprehensive status picture

---

## 📋 Additional Future Items

### 2. Device Alerting
**Priority**: Medium
**Status**: 🔨 v1 shipped 2026-10-16 (branch `feature/alerts`): stateful, in-app alerts

Shipped (`services/alert.service.js`, rules in `constants/alert-rules.js`, page `/alerts`):
- ✅ Stateful alerts: one unresolved alert per condition and subject (`Alert.openKey` unique), occurrences counted, auto-resolve when the condition clears, acknowledge/resolve by operators. Resolved alerts pruned after `ALERT_RETENTION_DAYS` (90).
- ✅ Built-in rules: device offline (ping), device offline (cloud, at sync), PoE fault and live monitor lost (Always-monitor devices only), config/scope backup failed, cloud sync failed. Admins toggle each and set severity and settle time (Settings → Alerts). Settle time drops conditions that clear quickly (PoE boot bounce).
- ✅ UI: Alerts page (status tabs, severity/rule/search filters, bulk actions), app-bar bell with the open critical+warning count, `alert:new` in the status bar (critical alerts also pop up), dashboard "View Alerts" count. Replaced the client-only alert list in `stores/notifications.js`, which nothing on the backend fed.
- ✅ Fixed on the way: a PoE port leaving a fault for a state other than delivering emitted no event; it now emits `port.poe.down`.
- ✅ Automations and alerts (2026-10-16): an Alert trigger (opened/resolved, rule filter, minimum severity, optional device group) starts automations; Raise/Clear/Acknowledge Alert steps. Automation alerts use rule `automation.raised` with a key shared across automations (one raises on "opened", another clears on "resolved"); an automation never clears a built-in alert and never triggers on `automation.raised`. See item 3a below for the engine.

Deferred:
- ⏳ Notification channels: email (nodemailer is wired in `notification.service.js` but unused), webhooks (Slack/Teams incoming webhooks), later SMS/PagerDuty. Per-user subscription preferences.
- ⏳ Rule scoping (per device, group, site) and custom thresholds; maintenance windows / snooze.
- ⏳ Port-flap detection from `port.link.*` events; API/transport failure alerts beyond backups.
- ⏳ Open-alerts banner on the device page.
- ⏳ Multi-instance: settle timers are in memory (same single-instance assumption as the live monitor).

---

### 3. Live Device State & Performance Dashboards
**Priority**: Medium
**Status**: 🔨 Started 2026-10-15 (branch `feat/live-state`): live port/PoE state for AOS-CX

Shipped on the branch (design: `MULTI_VENDOR_ROADMAP.md` §8c):
- ✅ Always-on, opt-in event monitoring (`Device.liveMonitoring`, `DeviceEvent` table, `device:event`), pushed by AOS-CX REST notifications. Works on Central-managed switches (read-only local access). Validated on a 6200F (ML.10.16.1010), including a PoE cut pushed from Central.
- ✅ Device page **Live** tab: port grid (link, speed, PoE status and draw), per-port throughput from counter deltas, CPU/memory, recent events. Polled only while open.
- ✅ Fixed on the way (found on hardware): AOS-CX config backups and firmware/system polls over local REST used HTTP Basic auth, which AOS-CX refuses; they now use cookie sessions.

Deferred:
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
- ✅ Run History (2026-10-16): `/automations/executions` (filters by automation, status, started-by; per-step results; live via `automation:started`/`completed`). Cancel works: a queued run never starts, a running one stops before its next step. `Execution.trigger` records manual | schedule | alert:opened | alert:resolved. Finished runs pruned after `EXECUTION_RETENTION_DAYS` (90). Unattended runs reach the status bar only on failure.
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

Deferred:
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
OAuth blocker (`docs/archive/CENTRAL_ENDPOINT_TRIAGE.md`) was the token request itself: it
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

**Full evaluation & design:** `docs/archive/CENTRAL_MANAGEMENT_MODE_PLAN.md` (historical)

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
**Status**: Not Started

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
**Status**: 🔨 Spike done (2026-10-15, branch `spike/classic-theme`): Light, Dark and Classic (circa-2010 admin portal) themes, a theme menu, and the choice saved per browser

Built-in themes only. Users can't define their own. See "Themes" in `CLAUDE.md` for how it works.
- Done: theme tokens instead of hardcoded colors across the automations builder; vue-flow CSS imported and themed; Dark primary changed to `#2D6A00`.
- Remaining: `LoginView.vue` (orange gradient), `DeviceStatusChart.vue` (literal chart colors), `DeviceInfoDisplay.vue`, `NotFound.vue` still hardcode colors; delete the unused `src/style.css`.
- Open questions: `#2D6A00` is about 2.8:1 against Dark's background, so green text and outlines may need a lighter variant. Per-user (server-side) theme preference only if testers ask.

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

## ✅ Completed Items

Recently shipped (details in the sections above): Automated Device Discovery (item 4), Configuration Backup Scheduling (item 5), Direct-managed device support / SSH config pull (5a), Central-managed detection core (5b), Multi-Vendor Phases 0–2 (5c).

---

## 🗂️ Historical backlog note

The old per-tier backlogs (`backend_todo.txt` / `frontend_todo.txt`, dated March 2025) were reviewed during the 2026-07 doc consolidation and found **obsolete** — every concrete item sampled (execution status transitions, `auth/register`, `auth/me` GET/PUT, nested schedule/execution routes) is already implemented, and they still reference the deleted `aruba-central.service.js`. They were archived rather than merged; see `archive/BACKEND_TODO_2025-03.txt` and `archive/FRONTEND_TODO_2025-03.txt`. No open items were carried forward from them.

---

**Last Updated**: 2026-10-19 (Mist first contact and parity)
**Maintained By**: Development Team
