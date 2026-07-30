# Central-Managed vs. Locally-Managed Detection — Evaluation & Plan

**Status**: Core implemented (2026-07-08) — see §5 Implementation status
**Date**: 2026-07-08
**Related**: `LONG_TERM_TODOS.md` item 5b, `backend/docs/ARUBA_CENTRAL_API_PHASE_2_3_TODO.md`,
`docs/CENTRAL_ENDPOINT_TRIAGE.md` (tenant endpoint triage — currently blocked on credentials)

---

## 1. Problem statement

`Device.managementMode` (`central` | `direct`) records **how the device record entered our
inventory** (Central sync vs. manual add / discovery import), not the **switch's own view** of
who owns its configuration. The two can disagree:

- A CX switch added manually (or via discovery) gets `direct`, but if that switch is connected
  to Aruba Central in **managed** mode, Central is the single source of configuration. Local
  REST/CLI config writes are rejected or overwritten at next sync — and with
  `configuration-lockout central managed` set on the switch, they are blocked outright.
- Conversely, a Central-synced switch may sit in a **monitoring-only** group
  (`monitor_only_cx`), in which case Central does *not* own its config and local changes are
  legitimate.

This matters most for the config backup/restore capability: restore (planned) must never push
config directly to a Central-managed switch, and backup should use the transport that actually
returns a complete config.

## 2. What the APIs offer (verified 2026-07)

### 2.1 Switch-side (authoritative)

AOS-CX exposes its Central relationship through the same data behind `show aruba-central`:

- **CLI** `show aruba-central` fields: `Central admin state` (enabled/disabled),
  `Central location`, `VRF for connection`, `Central connection status`
  (`connected` / `not-reachable` / `connection_failure`), `Central source`
  (activate/dhcp/manual), `Central source connection status`.
- **REST**: system subresource `aruba_central` (AOS-CX 10.04–10.14 URI family, e.g.
  `GET /rest/v10.10/system/aruba_central`). AOS-CX 10.15+ adds an equivalent
  `hpe_anw_central` resource at a new URI; the legacy `aruba_central` URI continues to work.
  ✅ **Verified against real hardware (2026-07-08)** — a 10.10-era 6100-class switch returned:

  ```json
  {
    "activate_server": "devices-v2.arubanetworks.com",
    "central_instantiation": "public",
    "central_source": "activate",
    "disable": false,
    "location": "device-uswest4-d2.central.arubanetworks.com",
    "location_override_location": null,
    "source_ip": "...",
    "status": {
      "central_connection": "connected",
      "centralsource_connection": "connected",
      "centralsource_last_connection_time": 1783488334,
      "time_sync_with_activate": true
    }
  }
  ```

  Note the **inverted `disable` flag** (not `enable`) and connection state nested under
  `status.central_connection` on this firmware; newer firmware may differ, so the
  normalizer probes several candidate attribute names. Also verified: this switch rejects
  HTTP basic auth for REST (401) — the cookie login flow (`/rest/vX/login`) is required,
  so the probe falls back to it.
- **Management mode**: a CX switch connects to Central in **monitor** or **managed** mode. In
  Central-managed mode, Central is the single source of configuration and the switch cannot be
  configured from other interfaces. `configuration-lockout central managed` additionally makes
  Central the *only* agent permitted to write config (its `no` form is only available while
  disconnected from Central).
- Central's own connection to the switch is independent of the switch's local
  `https-server rest access-mode` setting — setting the local REST API to read-only does not
  affect Central, and vice versa. Local REST **reads** keep working when Central-managed.

**Practical detection rule (conservative):** if `aruba_central` is enabled **and**
`connection_status == connected`, treat the switch as Central-managed for config-*write*
purposes, unless Central-side data says its group is monitoring-only.

### 2.2 Central-side

- **Classic Central** (`apigw-*.central.arubanetworks.com`):
  - `GET /configuration/v1/devices/{serial}/group` — which group a device belongs to.
  - `GET /configuration/v1/groups/properties` (≤20 groups/request) — includes
    `monitor_only_cx` ("Monitor only ArubaOS-CX switches, applies to UI group only"),
    `monitor_only_sw` (same for AOS-S), `allowed_types`, template-vs-UI info
    (`/configuration/v2/groups/template_info`).
  - Monitoring-only groups: Central monitors/reports/troubleshoots but the group-level config
    UI is disabled — Central does **not** own config for those switches.
- **New Central / HPE GreenLake** (`network-monitoring/v1alpha1/...`, which is what
  `aruba-central.service.js` already uses for device listing):
  - The devices response (`deviceName`, `serialNumber`, `status`, `deviceType`, `siteId`,
    `deployment`, `persona`, `role`, firmware fields, …) has **no documented flag for config
    ownership / monitor-only**.
  - Configuration lives in a separate service family (`network-config/v1alpha1/*`, e.g.
    device-groups endpoints). Whether a per-device "managed vs monitor" indicator is exposed
    there needs to be verified against our tenant.

**Conclusion:** the switch itself is the most reliable, always-available source. Central-side
group properties are a useful *secondary* signal (and the only signal when we have no direct
IP/credentials for the switch), but the classic endpoints may not apply if the tenant is New
Central only.

### 2.3 ⚠️ Existing risk: mixed classic/new Central endpoints

`aruba-central.service.js` mixes API families:

| Method | Endpoint | Family |
|---|---|---|
| `getAllDevices`, `getSwitchDetails`, `getAccessPointDetails` | `/network-monitoring/v1alpha1/...` | New Central |
| `getDeviceConfiguration`, `updateDeviceConfiguration`, `backupConfiguration` | `/configuration/v2/devices/{serial}/...` | Classic-style (unverified) |
| `executeCommand` | `/troubleshooting/v1/commands` | Classic |
| `getDeviceStats`, `getNetworkHealth` | `/monitoring/v2/...` | Classic |
| `getFirmwareVersions`, `upgradeFirmware` | `/firmware/v1/...` | Classic |

The device listing (New Central) demonstrably works; the classic-style config/monitoring/
firmware methods are unverified and likely 404 on a New Central tenant. **`pullConfig()` for
`managementMode === 'central'` depends on `getDeviceConfiguration` — this path is probably
broken today** and is masked because most tested devices are `direct`. Action: test each
classic endpoint against the tenant; replace or remove dead ones.

## 3. Proposed changes

### 3.1 Schema (Prisma `Device`)

Keep `managementMode` as the *transport/provenance* field it already is, and add
switch-reported truth alongside it:

```prisma
// Switch-reported Central state (null = never checked)
centralManaged            Boolean?   // config owned by Central (managed mode)?
centralConnectionStatus   String?    // connected | not_reachable | connection_failure | disabled
centralManagedSource      String?    // switch-rest | central-group | manual
centralManagedCheckedAt   DateTime?
```

`centralManaged` answers "may we write config directly to this device?" — independent of how
the record was created.

### 3.2 Detection & sync

1. **CX REST probe (primary)** — extend the CX device API (`cx-switch-api.js`) with
   `getCentralStatus()` → `GET /system/aruba_central` (fall back across supported REST
   versions; on 10.15+ optionally try `hpe_anw_central`). Persist results into the new fields.
   Run it:
   - during `testConnection` / device-api test endpoint,
   - in the existing device poller cycle for CX devices with linked credentials,
   - immediately before any config backup/restore of a CX device.
2. **Central group check (secondary)** — during `syncDevicesFromAruba`, if classic
   configuration endpoints are available on the tenant, fetch the device's group +
   `monitor_only_cx` and set `centralManaged = !monitorOnly` for connected switches. If the
   tenant is New Central only, investigate `network-config/v1alpha1` device-groups for an
   equivalent flag; otherwise rely on the switch-side probe.
3. **Reconciliation** — switch-reported state wins over Central-side inference; Central-side
   wins over provenance-based `managementMode`; most recent check wins. Never silently flip
   `managementMode` (it drives transport); instead surface disagreement in the UI
   ("added as Direct but switch reports Central-managed").

### 3.3 Config backup/restore routing (update to `pullConfig` and future restore)

| Operation | Central-managed | Monitor-only / local | Rationale |
|---|---|---|---|
| Config **read** (backup) | Prefer CX REST (`/fullconfigs/running-config`) when IP + creds exist; else Central config API | CX REST; SSH for AOS-S | Local REST reads work even when Central-managed and return the complete JSON config; Central config APIs are group/template-oriented and unverified on our tenant |
| Config **write** (restore — future) | **Blocked** (must go through Central) | Allowed via CX REST / SSH | Central-managed switches reject/overwrite local writes |
| Monitoring reads (status, firmware info) | Central API (no per-device creds, rate-limit friendly) | CX REST / SSH | Existing poller behavior |

This also resolves the duplicate-function question (Central vs CX APIs both expose device
info, firmware, interfaces, VLANs): **monitoring reads → Central for Central-connected
devices, device API for direct; config reads → device API preferred; config writes → owner
only.**

### 3.4 UI

- Device chip becomes three-state: `Central-managed` (switch-confirmed), `Locally managed`,
  `Unknown` (never probed) — plus a mismatch warning when provenance and switch report
  disagree.
- Backups view: show config source used per backup (already stored as `source`) and disable
  future restore actions for `centralManaged === true` devices with an explanatory tooltip.

### 3.5 Suggested implementation order

1. Test/triage the classic-style Central endpoints against the tenant (fixes the possibly
   broken `central` backup path; informs step 4).
2. Schema migration + `getCentralStatus()` probe + persistence (poller, test-connection,
   pre-backup).
3. Backup routing change (prefer CX REST reads when reachable).
4. Central-side group/monitor-only enrichment during sync (classic or New Central, per step 1).
5. UI three-state chip + restore guardrails.

## 4. MCP server evaluation: `nowireless4u/hpe-networking-mcp`

**What it is**: a community (MIT, not HPE-endorsed) Python 3.12 / FastMCP server, distributed
as a Docker image, that exposes ~4,100 tools across 9 platforms (Aruba Central incl. New
Central/GreenLake: ~659 tools, GreenLake, ClearPass, AOS8 Mobility Conductor, Mist, Apstra,
UXI, EdgeConnect, Axis) over Streamable HTTP MCP. Write tools are off by default and gated by
per-platform env flags + elicitation. Actively maintained (v3.5.2.0, 2026-07).

**Fit for NetHelper:**

- ❌ **Not a runtime dependency for the backend.** NetHelper's backend is a direct REST client
  of Central; it is not an MCP client. Wiring it in would add a Python/Docker hop, duplicate
  credential storage (Docker secrets), and buy nothing the service layer doesn't already do.
- ❌ **Does not solve the switch-side detection.** It has no AOS-CX direct REST support (AOS8
  tooling targets legacy Mobility Conductor), so the authoritative `aruba_central` probe in
  §2.1 is out of its scope.
- ✅ **Valuable as a development/ops companion.** Registered with Claude Code
  (`claude mcp add hpe-networking --transport http http://localhost:8000/mcp`), it lets the
  assistant query the live Central tenant while we build this: verify which classic vs. New
  Central endpoints the tenant actually serves (§2.3 triage), inspect real device payloads,
  check group properties / monitor-only flags, and cross-check our sync results. Its Central
  guided prompts (health, troubleshooting) are also useful operationally.

**Recommendation**: adopt it as dev tooling only — run via docker compose, loopback-only
(default), Central read-only credentials, write tools left disabled. Do not integrate it into
the application runtime.

## 5. Implementation status (2026-07-08)

Steps 2 and 3 of §3.5 are implemented and verified end-to-end against live hardware; step 1
was attempted and is blocked; steps 4–5 remain.

**Done:**
- Schema migration `20260708230137_add_central_managed_state`: `centralManaged`,
  `centralConnectionStatus`, `centralManagedSource`, `centralManagedCheckedAt` on `Device`.
- `device-poller.service.js`: new `central-status` poller (exposed via
  `POST /api/v1/devices/poll` like the others), `normalizeCentralStatus()` (handles the
  verified 10.10 schema, flat newer-firmware names, monitor mode, and unknowns), and
  `refreshCentralStatus()` (best-effort probe + persist; an inconclusive probe never erases
  a previously determined `centralManaged`). Probing is allowed for AOS-CX and
  *unclassified* switches (kept on REST elsewhere in the codebase), never AOS-S/APs.
- `cx-switch-api.js`: `getCentralStatus()` (cookie auth, `aruba_central` →
  `hpe_anw_central` fallback). The poller tries basic auth first and falls back to the
  cookie client on 401.
- `config-backup.service.js` `pullConfig()`: CX switches with IP + credentials now always
  back up via the device's own REST API (works even when Central-managed) and refresh
  Central status on the way; the Central API path remains only for central-managed devices
  without direct access.
- `device-api-test.controller.js`: successful REST connection tests refresh Central status
  and include `centralStatus` in the response.
- Frontend (`DeviceTable.vue`, `DeviceDetailView.vue`): three-state chip
  (Central-managed / Locally managed / unverified fallback to `managementMode`), mismatch
  warning banner + table tooltip, "Verified <time>" caption, test-connection result line.
- Bug fix: `aruba-central.service.js` token caching called `redis.setex()`, which does not
  exist on node-redis v4 (`setEx`) — would have thrown after every successful OAuth token
  fetch.

**Verified:** live probe against a real CX switch (basic-auth 401 → cookie fallback →
resource read → persisted). It immediately surfaced a genuine mismatch: a switch recorded
as `direct` reported `central_connection: connected` → `centralManaged: true`. Frontend
`npm run build` passes.

**Blocked / remaining:**
- §2.3 endpoint triage: OAuth2 client-credentials against the configured tenant returns
  401 (`HPE_GL_NETWORKING_ERROR_UNAUTHORIZED`) — credentials in `backend/.env` are invalid
  or expired and there is no active `ArubaCentralConfig` row in the DB. Re-run
  `node backend/scripts/triage-central-endpoints.js` once credentials are fixed; report
  template at `docs/CENTRAL_ENDPOINT_TRIAGE.md`.
- Step 4 (Central-side group / monitor-only enrichment during sync) — depends on triage.
- Step 5 restore guardrails — restore feature itself is still deferred; the guardrail rule
  is specified in §3.3.
- Devices with an empty `model` (e.g. discovery-imported) can't be platform-classified;
  consider backfilling `model`/`metadata.operatingSystem` from the `/system` poller so
  `isCxRestCapable` recognizes them.

## 6. References

- Monitoring-only mode for AOS-CX in Central: https://arubanetworking.hpe.com/techdocs/central/2.5.7/content/nms/aos-cx/get-started/cx-mon-mode.htm
- `configuration-lockout central managed`: https://arubanetworking.hpe.com/techdocs/AOS-CX/10.07/HTML/5200-7835/Content/Chp_Cent/Cent_cmds/src-tru-ctrl.htm
- `show aruba-central` / `show hpe-anw-central`: https://arubanetworking.hpe.com/techdocs/AOS-CX/AOSCX-CLI-Bank/cli_8360/Content/Chp_Cent/Cent_cmds/sho-aru-cen-10.htm
- AOS-CX 10.15 REST reference (aruba_central vs hpe_anw_central URIs): https://arubanetworking.hpe.com/techdocs/AOS-CX/10.15/HTML/rest_v10-0x/Content/Chp_REST_ref/aos-cx-res-api-ref-bas-res-v10-10.htm
- Classic Central group properties (`monitor_only_cx`) via cencli docs: https://central-api-cli.readthedocs.io/en/latest/centralcli.html
- New Central API basics: https://developer.arubanetworks.com/new-central/docs/getting-started-with-rest-apis
- hpe-networking-mcp: https://github.com/nowireless4u/hpe-networking-mcp
