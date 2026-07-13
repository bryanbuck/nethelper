# NetHelper Platform - Long Term TODOs

This document tracks features and improvements that are planned for future implementation but are not currently prioritized for immediate development.

---

## 🔮 Future Enhancements

### 1. WebSocket Real-time Updates from Aruba Central

**Priority**: Medium
**Status**: Not Started
**Estimated Effort**: 2-3 weeks

#### Description
Integrate with Aruba Central's webhook/event notification system to receive real-time device status updates directly from Aruba Central, rather than relying solely on periodic sync operations.

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

### 2. Advanced Device Alerting System
**Priority**: Low
**Status**: Not Started

Create a flexible alerting system that can trigger notifications based on:
- Device status changes (online → offline transitions)
- Consecutive ping failures exceeding threshold
- API communication failures
- Custom alert rules (e.g., specific devices, locations, times)

**Notification Channels**: Email, SMS, Slack, Microsoft Teams, PagerDuty

---

### 3. Device Performance Dashboards
**Priority**: Low
**Status**: Not Started

Enhanced visualization for device performance metrics:
- Historical ping response times (graphs/charts)
- API communication success rate trends
- Device uptime percentage (SLA tracking)
- Comparative performance across device groups

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

---

### 5. Configuration Backup Scheduling
**Priority**: Medium
**Status**: ✅ Completed (2026-07-06)

Scheduled configuration backups with:
- ✅ Automated backup on cron schedule (Bull repeatable jobs per schedule, timezone-aware; device selection by all/type/specific)
- ✅ Configuration diff detection (SHA-256 change detection per device; unified-diff comparison between any two versions)
- ✅ Rollback capability — first iteration is **view / diff / download** (browse versions, compare, download to apply manually). Automated push-to-device restore is intentionally deferred (see note below).
- ✅ Backup retention policies (per-schedule retentionDays + retentionMaxCount, 0 = unlimited; pruned after each run)
- ⏳ Export to external storage — local disk storage implemented with versioning; S3/NFS export deferred (config pulled via Aruba Central API)

**Implementation:**
- Backend: `src/services/config-backup.service.js`, `src/jobs/config-backup.job.js`, `src/controllers/backup.controller.js`, `src/routes/backup.routes.js` (`/api/v1/backups/*`), Bull `config-backup` queue, models `BackupSchedule` + `ConfigBackup`, schedule sync on server startup
- Frontend: `src/views/devices/ConfigBackupsView.vue` (route `/devices/backups`), `src/stores/backups.js`, `src/services/backup.service.js`, `src/components/backups/ConfigDiffViewer.vue` (hand-rolled colored unified-diff viewer)
- Config source: routed per device by management mode (see "Direct-managed device support" below) — Central API, AOS-CX REST, or SSH; stored to local disk under `BACKUP_STORAGE_PATH`
- Real-time: WebSocket events `backup:completed` / `backup:failed` / `backup:run:completed`

**Deferred follow-ups (next iteration):**
- Automated restore/rollback (push a selected version back via Central API or SSH — riskier, needs per-platform apply logic)
- S3-compatible and NFS export targets
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
- Note: AOS-CX config pull returns the device's JSON running-config (REST); AOS-S/CLI devices return raw CLI text. Both are checksummed and diffed the same way.

**Deferred:** SSH enable/privileged-mode escalation prompts, SSH key auth (currently password auth), and richer `show version` parsing into structured fields.

---

### 5b. Central-managed detection & config-write guardrails
**Priority**: High
**Status**: 🔨 Core implemented (2026-07-08) — switch-side probe, schema fields, backup
routing, and UI shipped and verified against live hardware. Remaining: Central-side
group/monitor-only enrichment (blocked on tenant API credentials — OAuth 401, see
`docs/CENTRAL_ENDPOINT_TRIAGE.md`) and restore guardrails (restore itself still deferred).

`Device.managementMode` records record provenance, not the switch's own view of config
ownership. A CX switch connected to Central in **managed** mode rejects local config writes
(and with `configuration-lockout central managed`, blocks them outright), which affects
config backup/restore. Plan: probe the switch's `GET /rest/v10.xx/system/aruba_central`
resource (authoritative), optionally enrich from Central group properties
(`monitor_only_cx`), persist as new `centralManaged*` fields, prefer CX REST for config
reads, and block direct config writes to Central-managed switches. Also triage the
classic-vs-New-Central endpoint mix in `aruba-central.service.js` (the `central` backup
path via `getDeviceConfiguration` is likely broken on a New Central tenant).

**Full evaluation & design:** `docs/CENTRAL_MANAGEMENT_MODE_PLAN.md`

---

### 5c. Multi-Vendor Support (Juniper + Cisco)
**Priority**: High
**Status**: 🔨 Phase 0 complete (2026-07-12) — vendor abstraction + multi-cloud groundwork
shipped, Aruba behavior unchanged. Phases 1–4 (Mist, Junos, Meraki, Catalyst) not started.

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

**Implementation:**
- Backend: `src/constants/vendors.js`, `src/utils/transport-router.js`, `src/services/cloud-providers/` (base + factory + aruba-central provider), migration `20260712000000_multi_vendor_phase0`
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

_(Items will be moved here once completed)_

---

**Last Updated**: 2026-07-12
**Maintained By**: Development Team
