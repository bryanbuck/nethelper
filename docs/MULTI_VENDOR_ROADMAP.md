# Multi-Vendor Support Roadmap — Juniper & Cisco

**Status**: Planning (2026-07-12)
**Scope**: Extend NetHelper beyond Aruba to Juniper (Mist cloud + Junos direct) and Cisco (Meraki Dashboard + Catalyst direct via SSH, RESTCONF optional).
**MVP bar per new vendor**: inventory sync + status, config backup, connection testing. Polling and automation come later.

---

## 1. Where we are today

NetHelper is Aruba-only, and the vendor coupling is uneven — some layers are already generic, others are hardcoded:

| Layer | State |
|---|---|
| `BaseDeviceAPI` (`backend/src/services/device-api/base-device-api.js`) | Vendor-neutral interface (login/testConnection/getDeviceInfo/getConfiguration/...) — good |
| `DeviceAPIFactory` | Switch only handles `cx_switch`; `determineDeviceAPIType()` infers platform from hardcoded Aruba model regexes, defaults to CX |
| `utils/device-platform.js` | The transport-decision choke point (`detectPlatform`, `isCxRestCapable`, `useSshTransport`) — knows only `aos-cx`/`aos-s`, classifies via Aruba model-number regexes |
| Cloud plane | `aruba-central.service.js` singleton + bespoke `ArubaCentralConfig` table, imported **directly** by device sync, config backup, automation, discovery. Several methods are dead (unset `this.baseURL`); tenant OAuth currently 401s (2026-07-08 endpoint triage) |
| Data model | **No `vendor` field anywhere.** `DeviceType` is category-only (access_point/switch/gateway). Platform is regex-inferred from `Device.model`. `managementMode` enum is `central \| direct`; `centralManaged*` columns are Aruba-shaped |
| Config backup | `pullConfig()` in `config-backup.service.js` has the cleanest transport dispatch in the app (CX REST → Central → SSH) — the pattern to generalize |
| SSH | `ssh-device.service.js` `PLATFORM_PROFILES` keyed `aos-s`/`aos-cx`/`generic`; the `generic` profile is already IOS-style |
| Frontend | ~70–80% vendor-generic (branches only on switch/AP/gateway kind). Aruba coupling concentrates in `ArubaCentralCredentials.vue`, the Add/Edit modals in `DevicesView.vue`, hardcoded API-type lists in `DeviceConnectionTest.vue`/`DeviceApiTestingView.vue`, and the "Central Status" column/chips in `DeviceTable.vue` |

## 2. Strategy

Introduce explicit `vendor`/`platform` fields and **two thin abstractions, deliberately not merged**:

- **CloudProvider** — talks to a management plane about *many* devices (inventory, status, cloud-side config). Central, Mist, and Meraki are peers behind one interface. Cloud-managed devices do **not** get a DeviceAPI client; they route through their provider. (No `MistDeviceAPI` — that would conflate the two planes.)
- **DeviceAPI** — talks to *one* device directly (CX REST today; Junos/Catalyst RESTCONF later, optional). SSH remains a third transport, selected by the router.

Every transport decision then flows through a single declarative per-vendor routing matrix modeled on `pullConfig()`.

### Target module layout

```
backend/src/services/
├── cloud-providers/                     # NEW — cloud management planes
│   ├── base-cloud-provider.js
│   ├── cloud-provider-factory.js        # registry keyed by provider slug
│   ├── aruba-central.provider.js        # absorbs aruba-central.service.js
│   ├── mist.provider.js                 # Phase 1
│   └── meraki.provider.js               # Phase 3
├── device-api/                          # EXISTING — direct device REST access
│   ├── junos-api.js                     # Phase 2 (optional; SSH suffices for MVP)
│   └── catalyst-api.js                  # Phase 4 (optional; RESTCONF)
├── ssh-device.service.js                # PLATFORM_PROFILES gains 'junos', 'cisco-ios'
└── config-backup.service.js             # pullConfig() → transport-router lookup

backend/src/constants/vendors.js         # NEW — single source of truth: vendors,
                                         #   platforms, providers, capability matrix
backend/src/utils/transport-router.js    # NEW — resolveTransport(device, operation)
frontend/src/models/vendors.js           # NEW — mirror of backend constants
```

## 3. Data model changes

### 3a. Vendor + platform on Device

```prisma
enum Vendor {
  aruba
  juniper
  cisco
  other
}

model Device {
  // ... existing fields ...
  vendor    Vendor  @default(aruba)   // explicit, user-visible
  platform  String?                   // 'aos-cx' | 'aos-s' | 'junos' | 'ios-xe' | 'meraki' | null
}
```

- `platform` is a **string, not an enum**: OS families churn faster than vendors, and `unknown` stays representable as `null`. Validated against `constants/vendors.js`.
- **Backfill**: `@default(aruba)` handles vendor for existing rows for free. A one-time script runs the existing `detectPlatform()` heuristics over all rows to populate `platform` (its regex logic becomes a write-once classifier instead of a per-request heuristic). Rows classifying `unknown` keep `platform = null` and retain today's default behavior.
- `DeviceType` gains `controller` and `other` values (additive enum migration, safe). Mist/Central surface gateways/controllers; `other` absorbs Meraki cameras/sensors without future migrations.

### 3b. Generalize managementMode + the Central columns

Keep the concept two-valued (cloud vs direct) but rename and add a provider reference:

```prisma
enum ManagementMode {
  cloud    // renamed from 'central'
  direct
}

model Device {
  managementMode     ManagementMode    @default(direct)
  cloudIntegration   CloudIntegration? @relation(fields: [cloudIntegrationId], references: [id])
  cloudIntegrationId String?           // which cloud plane manages this device (null when direct)

  // Generalized from centralManaged / centralConnectionStatus / centralManagedSource /
  // centralManagedCheckedAt / centralStatus:
  cloudManaged          Boolean?
  cloudConnectionStatus String?        // connected | not_reachable | connection_failure | disabled | unknown
  cloudManagedSource    String?        // device-rest | cloud-inventory | manual
  cloudManagedCheckedAt DateTime?
  cloudStatus           DeviceStatus   @default(offline)
}
```

- Prisma can't rename enum values; use raw SQL (`ALTER TYPE ... RENAME VALUE 'central' TO 'cloud'`) plus `ALTER TABLE ... RENAME COLUMN` so no data is lost. This is the riskiest single migration — **rehearse on a DB copy**. Fallback if it goes badly: keep DB names, generalize only at the service layer with `@map`.
- Do the real rename in **Phase 0** while there's one vendor; it gets strictly more expensive later. Usages of `centralManaged`/`managementMode === 'central'` concentrate in ~6 backend files.

### 3c. CloudIntegration table (replaces ArubaCentralConfig)

**One table with a provider discriminator**, not per-provider tables — per-provider tables would triple every settings CRUD route/store/component for near-identical shapes.

```prisma
enum CloudProviderType {
  aruba_central
  juniper_mist
  cisco_meraki
}

model CloudIntegration {
  id             String            @id @default(uuid())
  provider       CloudProviderType
  name           String            // user label, e.g. "Prod Mist Org"
  baseUrl        String            // Central base URL / api.mist.com / api.meraki.com/api/v1
  credentials    Json              // shape per provider (secrets field-encrypted):
                                   //   aruba_central: { clientId, clientSecret, workspaceId? }  (customerId pre-2026-10-16)
                                   //   juniper_mist:  { apiToken, orgId }
                                   //   cisco_meraki:  { apiKey, orgId }
  isActive       Boolean           @default(true)
  lastTested     DateTime?
  lastTestStatus TestStatus?
  notes          String?
  userId         String
  createdBy      User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt

  devices        Device[]

  @@index([provider, isActive])
}
```

- **Encryption**: reuse the existing field-encryption util (used for `ApiCredential.password` / `ArubaCentralConfig.clientSecret`), applied to secret values inside the JSON individually so non-secret keys stay displayable.
- **Migration**: copy `ArubaCentralConfig` rows → `CloudIntegration(provider: aruba_central)`; keep the old `/settings/aruba-central` routes as aliases for one release.
- **Multiple active integrations** are a first-class case, not an edge case: a user can configure, say, two Aruba Central accounts and a Mist org simultaneously. Every inventoried device is attributed to the specific tenant that owns it via `cloudIntegrationId`. Consequences, all implemented in Phase 0:
  - `activeProviders()` returns one provider instance per active integration; sync iterates all of them, and one integration failing (bad credentials, unreachable) does not abort the others — errors are reported per-integration.
  - Upserts are **serial-keyed and idempotent**, with ownership following the most recent sync that saw the device. A device that moves between tenants is re-attributed rather than duplicated. When no row has the serial, sync adopts the one serial-less row with the same MAC (a device added by hand before it was synced); weaker matches are left as possible duplicates for a person to merge (`services/device-merge.service.js`, 2026-10-16).
  - Credentials and OAuth token caches are **per integration** (Redis key `cloud:{integrationId}:access_token`), so two Central accounts never share a token.
  - Sync can be scoped to one integration (`POST /devices/sync { integrationId }`, or the per-integration "Sync devices" button in Settings) or run across all active ones.
  - `Device.cloudIntegrationId` is `SetNull` on delete: removing an integration keeps its device rows but drops their cloud attribution.
- `ApiCredential` stays as-is for direct-device creds — `apiKey`/`apiSecret` already cover token-style auth.
- ~~`DiscoveredDevice.isArubaVendor` → generalize to `matchedVendor Vendor?`~~ Done 2026-10-19 (`20261019190000_discovery_matched_vendor`; `DiscoveryScan.arubaHosts` → `vendorHosts`). Juniper and Mist OUIs added; the cloud cross-check keeps each match's vendor/platform.

## 4. Cloud provider abstraction

`base-cloud-provider.js`, mirroring `BaseDeviceAPI`'s style (methods throw NotImplemented by default):

```js
class BaseCloudProvider {
  constructor(integration) { ... }      // CloudIntegration row (decrypted creds)
  async testConnection()                // → { success, message, details }
  async listInventory()                 // → NormalizedCloudDevice[]        (MVP)
  async getDeviceStatus(serial)         // → { status, lastSeen, raw }      (MVP)
  async getDeviceConfiguration(serial)  // → { text, format, source } or throws CapabilityError (MVP)
  async findByAddress(ip)               // → AddressHolder[] (its devices + clients with this IP), 'address-lookup'
  async listAlarms({ since })           // → { alarms: NormalizedAlarm[], activeIds|null }, 'alarms' (read-only mirror)
  supports(capability)                  // 'config-backup' | 'status' | 'inventory' | ...
  // later: getFirmwareInfo, subscribeEvents (Mist WS), executeAction
}
```

**NormalizedCloudDevice** — the contract that lets `syncDevicesFromAruba()` become provider-agnostic:

```js
{ serial, name, model, macAddress, ipAddress,
  type /* DeviceType */, vendor, platform,
  status /* DeviceStatus */, firmwareVersion, site, raw }
```

Each provider owns the mapping from its inventory shape into this (Mist gives `type: ap|switch|gateway` directly; Meraki infers from model prefix MR/MS/MX; Central's logic already exists in `device.service.js#mapDeviceType`).

**Factory** (`cloud-provider-factory.js`):

```js
CloudProviderFactory.forIntegration(row)   // → provider instance
CloudProviderFactory.forDevice(device)     // device.cloudIntegrationId → row → instance
CloudProviderFactory.activeProviders()     // all isActive integrations, instantiated
```

**Consumer migration** (everything that currently does `require('./aruba-central.service')`):

| Consumer | Change |
|---|---|
| `device.service.js#syncDevicesFromAruba()` | → `syncDevicesFromCloud(integrationId?)`; loops `activeProviders()`, upserts NormalizedCloudDevices, stamps `vendor`/`platform`/`cloudIntegrationId`. Keep the old name as a thin alias one release. |
| `config-backup.service.js#pullConfig()` | `managementMode === 'cloud'` branch → `forDevice(device).getDeviceConfiguration(serial)`; catch `CapabilityError` → fall through to SSH if reachable, else record "not supported". |
| `automation.service.js` (backup/config/command actions) | Mechanical swap to `forDevice(device)`. |
| `discovery.service.js` (Central inventory cross-check) | Swap to `activeProviders()` cross-check; can lag to a later phase. |
| `device-poller.service.js` central-status poller | Becomes cloud-status poller iterating devices grouped by `cloudIntegrationId`. |

`aruba-central.service.js` becomes the guts of `aruba-central.provider.js`. **Precondition (Phase 0)**: fix or quarantine the broken parts first — the dead `this.baseURL` methods and the 401-ing OAuth/classic endpoints. The interface must be modeled only on methods with at least one *proven* implementation.

## 5. Device API layer + transport routing

### DeviceAPIFactory

- `determineDeviceAPIType(device)` becomes **vendor-field driven**: `(vendor, platform, type)` → api type via the capability matrix in `constants/vendors.js`. The Aruba model regexes survive only in the Phase 0 backfill script and as a last-ditch fallback for `vendor: aruba, platform: null`.
- The switch grows over phases: `cx_switch` → `junos` (Phase 2, only if a structured client is built) → `catalyst_restconf` (Phase 4, optional).
- The manual connection test's platform list (`connection-test.service.js` `manualTestPlatforms()`, `GET /device-api/supported-types`) is generated from `constants/vendors.js` and the transport matrix, and manual tests route through `testDeviceConnection` like stored ones (2026-10-21, #19).
- Cloud-managed devices normally don't reach the factory; the router sends them to their CloudProvider. **Exception: read-only local reads of AOS-CX** (config backup, live state in §8c, LLDP topology in §8d), which keep working under Central management and are ranked ahead of the cloud plane when the device has an IP and a linked credential.

### Transport router (`utils/transport-router.js`)

Generalizes `pullConfig()`'s three-way branch and `useSshTransport()` into one declarative matrix:

```js
// resolveTransport(device, operation) → ordered transports: 'cloud' | 'device-rest' | 'ssh'
// (an empty list means unsupported). As built, in constants/vendors.js (2026-10-16):
const TRANSPORT_MATRIX = {
  'aruba/aos-cx':  { config: ['device-rest'], test: ['device-rest'], poll: ['device-rest'], live: ['device-rest'], topology: ['device-rest'] },
  'aruba/aos-s':   { config: ['ssh'], test: ['ssh'], poll: ['ssh'], live: [], topology: ['ssh'] },
  'juniper/junos': { config: ['device-rest', 'ssh'], test: ['device-rest', 'ssh'], poll: ['device-rest', 'ssh'], live: [], topology: ['device-rest', 'ssh'] },  // device-rest = NETCONF
  'cisco/ios-xe':  { config: ['ssh'], test: ['ssh'], poll: ['ssh'], live: [], topology: ['ssh'] },
  'cisco/meraki':  { config: [], test: [], poll: [], live: [], topology: [] },
};
// managementMode === 'cloud': device-rest (when listed) then 'cloud', never ssh.
// live: device-rest only, and only with an IP. topology: device-rest with an IP, then 'cloud'.
```

`device-platform.js` is rewritten **field-first**: `detectPlatform()` returns `device.platform` when set, falling back to today's regexes only for legacy/unclassified rows. `isCxRestCapable()` / `useSshTransport()` keep their signatures (so `config-backup`, `device-poller`, and `device-api-test.controller` don't all change at once) but delegate to the router. `pullConfig()` becomes an ordered-fallback loop over `resolveTransport(device, 'config')`.

### Junos/Catalyst direct — pragmatic MVP call

~~**SSH is the MVP transport for both.**~~ **Superseded by what Phase 2 actually built.** The original call was: SSH-only, defer NETCONF because the npm libraries are stale. That was reconsidered and reversed — see Phase 2 below. In short: we don't need a library (NETCONF is an XML RPC over an ssh2 subsystem, and ssh2 is already a dependency), and CLI screen-scraping is fragile in a way NETCONF's explicit message framing simply isn't. **Junos now uses NETCONF as its primary transport, with the SSH CLI as an automatic fallback** for devices that haven't enabled it.

Cisco Catalyst (Phase 4) is still planned as SSH-first: RESTCONF needs YANG handling and is commonly disabled in the field, and unlike NETCONF-on-Junos there is no equally clean structured alternative. Revisit if Catalyst devices in practice have it enabled.

## 6. SSH profiles

Additive in `ssh-device.service.js` `PLATFORM_PROFILES` (the `generic` profile is already IOS-style, so `cisco-ios` mostly formalizes it):

```js
junos: {
  setup:   ['set cli screen-length 0'],
  config:  'show configuration | display set',
  version: 'show version',
},
'cisco-ios': {
  setup:   ['terminal length 0'],
  config:  'show running-config',
  version: 'show version',
},
```

`resolveProfile()` already checks `metadata.sshProfile` override then `detectPlatform()` — once `detectPlatform` returns `junos`/`ios-xe` from the platform field, map `ios-xe → 'cisco-ios'` and this is done. Watch item: Catalyst `enable` handling if creds aren't priv-15 — defer until it bites, then add optional `enableSecret` to `ApiCredential.metadata`.

## 7. Frontend

1. **Shared constants first**: `frontend/src/models/vendors.js` (vendors, platforms, provider types, labels/icons/colors) mirroring the backend, and make the `DevicesView.vue` Add/Edit dropdowns derive from it **and** from the existing `Device.js` DeviceType constants (kills the display-cased-string drift).
2. **Add/Edit modals**: Vendor select (default Aruba), Platform select filtered by vendor, and replace the hardcoded `'Aruba Central'` management-mode option with "Cloud-managed" + a Cloud Integration select populated from the integrations store.
3. **Settings → Cloud Integrations**: replace `ArubaCentralCredentials.vue` with a generic `CloudIntegrations.vue` list (provider badge, name, baseUrl, test button, active toggle) + per-provider form sections (Central: clientId/secret/customerId; Mist: token/orgId/region; Meraki: apiKey/orgId). `stores/settings.js` `arubaCentralConfigs` actions → `cloudIntegrations` actions. Stays in the existing credentials tab alongside `ApiCredentials.vue`.
4. **DeviceTable**: "Central Status" → "Cloud Status"; Central-managed chip → provider-branded chip ("Central" / "Mist" / "Meraki" from the device's integration). Fix `stores/devices.js:362` `=== 'cx'` check to use the platform field.
5. **Connection testing**: `DeviceConnectionTest.vue` + `DeviceApiTestingView.vue` hardcoded type lists → fetch from the (now constants-driven) `/device-api/supported-types` endpoint. Done 2026-10-21 (#19): the endpoint lists platforms and their test transports.

## 8. Phased roadmap

Ordering rationale: Mist is the *easiest possible* second implementation of both new abstractions (token auth, clean REST, real config API) — it validates the CloudProvider interface with minimal incidental complexity. Junos-direct next exercises the SSH/transport-router path while Juniper context is fresh. Meraki before Catalyst because it's a third cloud provider (pattern proven twice) whose only novelty is the config-semantics question; Catalyst-direct is nearly free by then.

### Phase 0 — Vendor groundwork ✅ **COMPLETE** (2026-07-12)

Shipped, no behavior change for Aruba:

- **Schema** (`migrations/20260712000000_multi_vendor_phase0`): `Vendor` enum + `Device.vendor`/`platform`; `DeviceType` +`controller`/+`other`; `ManagementMode` `central`→`cloud`; `central*`→`cloud*` column renames; `CloudProviderType` enum + `CloudIntegration` table + `Device.cloudIntegrationId`. Hand-written SQL (Prisma's diff would have dropped/recreated for the renames). Data migrations copy `ArubaCentralConfig` rows into `CloudIntegration`, attribute existing cloud devices to the active Central integration, and backfill `platform` by mirroring `detectPlatform()`'s detection order.
- **Central cleanup**: `aruba-central.service.js` **deleted**. Its working parts (OAuth, `network-monitoring/v1alpha1` inventory) live in `cloud-providers/aruba-central.provider.js`; the dead `this.baseURL` methods and unverified classic endpoints (`/configuration/v2`, `/troubleshooting/v1`, `/monitoring/v2`, `/firmware/v1`) now throw typed `CapabilityError` rather than failing opaquely. Token cache is keyed per integration, so tenants never share a token.
- **Central auth (2026-10-16)**: tokens come from HPE GreenLake, not `<baseUrl>/oauth2/token` (which nothing accepts for `client_credentials`). A Central-scoped GreenLake API client uses `sso.common.cloud.hpe.com/as/token.oauth2`; a GreenLake-platform client sets `workspaceId` and uses its workspace token URL. Both are New-Central-only, so the base URL is a cluster picker (`*.api.central.arubanetworks.com`) and a Classic `apigw-*` host fails the test with that explanation. `customerId` is gone (New Central doesn't take it). `testConnection()` also makes one inventory call, since a token proves the client but not the cluster.
- **Central response shape (2026-10-16, first live contact)**: the inventory items carry `serialNumber` (not `serial`), `status` `ONLINE`/`OFFLINE`, `lastSeenAt` (ISO, null while online), `uptimeInMillis`, `siteName`; filters must use `serialNumber`. Normalization was rewritten to match and the fixture replaced with the live shape. Switch platform is taken from the firmware version (`XX.10.*` = AOS-CX, `XX.15/16.*` = AOS-S) before the model regex, since Central reports some CX models as a bare `6200`.
- **Abstractions**: `constants/vendors.js` (vendors, platforms, providers, transport matrix), `utils/transport-router.js`, field-first `device-platform.js`, `BaseCloudProvider` + `CloudProviderFactory` (`forIntegration` / `forDevice` / `activeProviders`).
- **Consumers migrated**: `syncDevicesFromCloud()` (loops every active integration, stamps `cloudIntegrationId`), `pullConfig()` (ordered-fallback over the router), automation actions, discovery cross-check, device controller, sync job. Zero `require('.../aruba-central.service')` remain.
- **Settings**: `/settings/cloud-integrations` CRUD + test (multi-row, multi-provider); deprecated `/settings/aruba-central` routes still work against the `aruba_central` rows.
- **SSH profiles**: `junos` and `ios-xe` (planned as `cisco-ios`; shipped keyed by platform id) added ahead of Phases 2/4.
- **Frontend**: `models/vendors.js`, `CloudIntegrations.vue` (replaces `ArubaCentralCredentials.vue`), vendor/platform/cloud-integration selectors in the device modals, Central→Cloud column and chip renames with provider-branded labels, device-type dropdowns now use enum values (killed the display-cased-string round-trip).

**Verified** against the live dev DB: two Central tenants configured simultaneously and both returned by `activeProviders()`; a device attributed to the second tenant resolved through `forDevice()` to exactly that tenant; secrets stored as ciphertext and masked over the API; a Juniper switch with an Aruba-looking model (`6300F`) correctly routed to SSH instead of CX REST (proving the vendor field, not the model regex, now drives transport); quarantined Central config endpoint threw `CapabilityError`; transport routing reproduces all prior Aruba behavior including the legacy unclassified-switch quirk. Frontend builds clean.

### Phase 1 — Juniper Mist (cloud) ✅ **COMPLETE** (2026-07-12)

`mist.provider.js`, built against the official OpenAPI spec (github.com/mistsys/mist_openapi) rather than from memory — which caught several things worth knowing:

- **Auth** is a plain org API token (`Authorization: Token <key>`), so unlike Central there is no OAuth dance and nothing to cache in Redis. `testConnection()` hits `GET /api/v1/self` and additionally checks the token actually has privileges on the configured org — a valid token pointed at the wrong org (or the wrong regional cloud) is the most likely misconfiguration, and it now reports that specifically.
- **Regional clouds matter.** A Mist org lives in exactly one of 12 regional clouds; the wrong host 401s. The region list lives in `constants/vendors.js` and the settings UI renders a picker (generic: any provider that declares `regions` gets one).
- **Inventory is paginated** (default 100, max 1000 as of early 2026), so `listInventory()` follows `page`/`limit` to completion — a single unpaginated call would silently truncate large orgs.
- **`/stats/devices` defaults to `type=ap`.** Without `type=all` the sync would silently enrich only access points and lose IP/firmware for switches and gateways. Inventory (not stats) is the source of truth for what exists; stats failures degrade gracefully.
- **Config-backup semantics**: Mist is intent-based, so a "config" is the device's **Mist configuration object**, snapshotted as canonical (sorted-key) JSON so diffs show real changes rather than key reordering. The `config_cmd` endpoint is *not* the device's config — it returns only the CLI Mist *would* generate when adopting a brownfield switch. For a true Junos running-config, reach the device over SSH (Phase 2). APs have no per-device config at all (they are configured by site/WLAN templates), so they return a typed `CapabilityError` rather than a misleading near-empty "backup".

Also fixed a latent Phase 0 bug this exercised: `pullConfig()`'s cloud branch was `JSON.stringify`-ing the provider's whole `{text, format, source}` wrapper instead of storing `text`. It never fired because Central's config path is quarantined, but Mist hit it immediately.

**Live contact (2026-10-19)**, against a real org (`api.ac2.mist.com`, read-only org token; one site, an AP33 and an EX4000-12MP, both powered off), with `scripts/probe-cloud.js` (GET only) and anonymised captures in `tests/fixtures/mist-live/`. What it changed:
- **Site names.** Inventory names a site only by `site_id`, and sync stored the UUID as `Device.location` (and so in the location filter and the map's site scopes). `listInventory()` now reads `/orgs/:id/sites` once and stores the name; the id stays in `metadata.siteId`.
- **Fields that don't exist.** Inventory has no `last_disconnected` or `adopted`; last-seen comes from stats `last_seen` (epoch seconds, kept while offline). Inventory does carry `version`, now the firmware fallback when stats fail.
- **`config_status` needs `fields`.** `/stats/devices` leaves it out by default; `fields=*` returns kilobytes per device (interface tables, LLDP clients). A list (`fields=mac,ip,version,last_seen,status,uptime,config_status`) returns exactly those.
- **Who owns the config.** A switch's device object has `mist_configured`; a config backup records it as `cloudManaged` (source `cloud-config`). APs assigned to a site are Mist-configured (source `cloud-inventory`). Mist rows used to stay "unverified" forever.
- **A credential in WLANs.** Each WLAN's `portal_template_url` is an S3 link presigned with a temporary AWS session token, newly signed on every read: a secret, and the reason site scope backups changed on every run. `utils/config-redact.js` strips signed queries from any URL.
- `/self` for an org token has a `name` and `privileges[].role`, no email; the test now reports the access level.
- Scope backups (org and site) and a switch config-object backup ran live and are byte-stable across runs.

With the devices powered on (same day): inventory `connected: true`, stats `status: connected` with fresh `last_seen`; sync flipped both to online and auto-resolved their `device.cloud-offline` alerts; scope backups kept the same checksums. NETCONF to the Mist-managed EX was then run once a firewall rule was fixed (see Phase 2's first hardware contact). Inputs for later work are captured: AP `lldp_stat` and switch `clients` (stats `fields=*`), `/stats/ports/search` with `neighbor_*` LLDP fields (cloud neighbors, §8d), and `/devices/events/search` (`SW_CONNECTED`, `AP_RESTARTED`, ...; cloud events).

**Verified** end-to-end against a local mock of the Mist API built from the spec's response shapes: integration created with the token encrypted at rest and masked over the API; `testConnection` authenticated and validated org scope; sync produced `vendor=juniper` devices with correct type mapping (`ap`/`switch`/`gateway`), `platform=junos` on the switch and gateway but not the AP, and live IP/firmware from stats; config backup of a Mist-managed EX4400 stored and checksummed, and after mutating a port description in Mist the second backup's diff showed exactly that one line; an AP backup recorded an honest "not supported" reason instead of failing opaquely; a Mist org and a Central account were active simultaneously in `activeProviders()`.

### Phase 2 — Junos direct ✅ **COMPLETE** (2026-07-12) — NETCONF, not SSH

**This phase deliberately departs from the original plan.** The roadmap said "SSH is the MVP transport, defer NETCONF" on the grounds that the npm NETCONF libraries are stale. That reasoning was half right — the `netconf` package's last release was 2022 — but it led to the wrong conclusion, because we don't need a library: NETCONF is an XML RPC over an SSH subsystem, and `ssh2` (already a dependency) exposes `subsys()` directly. Hand-rolling it added **zero dependencies**.

The deciding argument was correctness, not elegance. Screen-scraping an interactive CLI means prompt-matching, echo-stripping, and pager-disabling — machinery that is fragile by construction. NETCONF messages are explicitly framed, so the transport itself tells you where a response ends. There is nothing to guess.

- **`netconf-client.js`** — RFC 6241/6242 over `ssh2.subsys('netconf')`, port 830. Handles both framings and the trap that sits between them: the `<hello>` exchange is *always* `]]>]]>`-terminated, because neither peer yet knows the other's capabilities; only afterwards do messages switch to chunked framing, and only if both advertised `base:1.1`. (I got this wrong on the first pass — the buffer check used `trimStart()`, which strips the very `\n` that begins a chunk header, so chunked reads never fired and every RPC hung. The mock caught it immediately.)
- **`junos-api.js`** — `BaseDeviceAPI` implementation: `<get-software-information>` for hostname/model/version, `<get-configuration format="set" database="committed"/>` for config. Two details that matter: `database="committed"` (the default is `candidate`, which on a device someone is mid-edit on would back up uncommitted changes that aren't running), and a fallback to `format="text"` because `format="set"` requires Junos 15.1+.
- **SSH CLI is kept as an automatic fallback**, which is the crux of the design. NETCONF is *not* enabled by default on Junos: a device without `set system services netconf ssh` authenticates and then refuses the subsystem. That surfaces as a typed `NETCONF_UNAVAILABLE`, distinct from "unreachable", and the transport matrix (`juniper/junos: [device-rest, ssh]`) retries over the CLI rather than failing. Both the config-backup path and the connection-test controller honor this.
- Generalized `pullConfig()`'s `device-rest` branch, which was hardcoded to Aruba CX, to dispatch by platform — and fixed the connection-test controller, which routed on `useSshTransport()` and so would have sent Junos straight to SSH, never trying NETCONF.

**Verified** (no hardware — a mock Junos device: a real `ssh2` SSH server serving both a NETCONF subsystem and a PTY-echoing Junos CLI shell, driven over actual SSH connections). 15 checks, all passing: transport routing and factory dispatch; NETCONF over chunked framing *and* legacy end-of-message framing; device info/firmware parsing; a pre-15.1 device rejecting `format="set"` and falling back to text; config backup storing set-format output, with change detection and a diff isolating exactly the one line changed; **the fallback path — NETCONF refused → detected → SSH CLI → identical config**; the CLI pager being disabled correctly; and Aruba routing unchanged.

**Caveat worth stating**: a mock is faithful to the RFC and to Junos's documented RPCs, but it is still a mock. The first run against real hardware is where response-shape surprises would appear.

**First hardware contact (2026-10-19)**, an EX4000-12MP on 24.4R2.25 managed by Mist, read over NETCONF with the device credential (captures in `tests/fixtures/junos-live/`). The framing, `<get-software-information/>` parsing and the LLDP parser all worked unchanged. Two surprises: an account whose login class lacks `view-configuration` gets a committed config made of `/* ACCESS-DENIED */` placeholders, not an RPC error, so a "successful" backup held nothing (now refused by `assertJunosConfigReadable`; a Mist-managed switch falls back to Mist's copy with a `ConfigBackup.warning`); and the chassis MAC is `fpc-mac-base` per FPC, not `public-base-address`. With `view-configuration` granted, the full pull ran (5.5 KB `set` config plus Mist's object; stable on a repeat run). Junos still withholds `scripts`, `event-options`, `secret` and `extension-service` from such an account, so a partly withheld read is kept and the withheld hierarchies go in the backup's warning; only a read with nothing readable is refused (the maintainer's call, 2026-10-19). Still not run on hardware: the SSH CLI fallback.

### Phase 3 — Cisco Meraki (cloud)

- `meraki.provider.js`: API-key auth (`X-Cisco-Meraki-API-Key`), testConnection via `GET /organizations`, org devices + statuses, rate-limit throttle (~10 req/s/org).
- **Config backup = settings snapshot** — Meraki exposes no running-config. Serialize a defined set of API-readable settings (start minimal: device attributes, switch ports, wireless SSIDs, L3 firewall rules) to stable canonical JSON, stored through the same backup pipeline (`format: 'meraki-settings-json'`), labeled honestly in the UI ("settings snapshot, not running-config").
- **Verify**: inventory/status sync; snapshot backups diff meaningfully when a dashboard setting changes; UI labels the backup type correctly.

### Phase 4 — Cisco Catalyst direct (SSH; RESTCONF optional)

- `cisco-ios` SSH profile; `cisco/ios-xe` matrix row; manual add + test + backup. Optional: `catalyst-api.js` RESTCONF for structured status where enabled.
- **Verify**: same as Phase 2 against a Catalyst; enable-mode edge case documented or handled.

### Post-MVP (explicitly out of scope above)

Per-vendor pollers (generalize `device-poller.service.js`), automation actions for new vendors, Juniper/Cisco discovery OUI tables, Mist WebSocket streaming, NETCONF, restore/rollback (direction in §8b: a future `restore` transport operation, direct and atomic platforms only; cloud writes are a separate feature).

## 8b. Config-backup storage (2026-09-14)

Backups are stored twice, on purpose:

1. **Flat files** under `BACKUP_STORAGE_PATH` — one immutable timestamped file per run, pointed at by `ConfigBackup.filePath`. **Authoritative.** Every read path (content, download, diff, delete) goes through it.
2. **An optional Git mirror** (`services/git-backup.service.js`, configured by the single-row `GitBackupConfig`) — one repo, one directory per device serial holding the config plus a `meta.json` sidecar, committed only when the config actually changed, pushed once per batch.

Two consequences matter for the vendor work:

- **`format` is now persisted, not discarded.** `pullConfig()` returns `{ artifacts: [{ kind, format, text }], source }` (artifacts since 2026-10-16, below) and each format lands on a `ConfigBackupArtifact` row (the primary's also on `ConfigBackup.format`). This closes the gap flagged in §9.1: an intent-based settings snapshot (Mist today, Meraki later) is recorded as `mist-config-json` / `meraki-settings-json` and committed as `settings.json`, while a real running-config is `cli-text` → `running-config.cfg` and Junos set-format is `junos-set` → `running-config.set`. The repo is self-describing, so "settings snapshot ≠ running-config" is visible on disk rather than only in the UI.
- **Retention and history are deliberately asymmetric.** `pruneRetention()` drops rows and flat files; Git history is never rewritten (that would require a force-push that breaks clones). The repo is the long-term archive beneath a bounded working index.

The mirror is additive and best-effort throughout: a commit or push failure is logged and the backup still succeeds, because the authoritative bytes are already on disk. A `CapabilityError` still produces no commit at all — an honest "not supported" must not leave a phantom version in history.

### Artifacts: pasteable text and structured config (2026-10-16)

A backup can hold more than one representation, one `ConfigBackupArtifact` per **kind** (`utils/config-format.js`):

- `cli`: text a person can paste back (`cli-text`, `junos-set`).
- `structured`: a JSON document (`aoscx-json`, `mist-config-json`, ...). Machine-readable, not pasteable.

AOS-CX yields both from one REST session: `GET /configs/running-config` with `Accept: text/plain` returns the CLI rendering (what `show running-config` prints; verified on a 6200F, ML.10.16), and `/fullconfigs/running-config` the REST config database. The CLI read is best-effort, so a backup still succeeds JSON-only. `ConfigBackup.filePath/format/checksum` mirror the **primary** artifact (CLI when present), so pre-artifact readers keep working; the migration backfilled one artifact per existing backup. Change detection compares each kind with the same kind last time. Content, download and diff take `?kind=cli|structured`; diff defaults to a kind both backups hold, CLI first. The Git mirror writes `running-config.cfg` and `settings.json` side by side.

### Cloud scopes (2026-10-16)

Cloud planes configure APs (and much else) **above the device**: Mist org/site objects (WLANs, RF templates, device profiles, switch templates), Central scopes and library profiles. There is no per-AP config to back up, so `ScopeBackup` captures the scope instead. It's read-only.

- Provider contract (`BaseCloudProvider`): `listConfigScopes()` → `[{ scopeType: 'org'|'site-collection'|'site'|'device-group', scopeId, name }]` and `getScopeConfiguration(scope)` → `{ text, format, source }`, behind `supports('scope-backup')`. The defaults throw `CapabilityError`.
- **Mist**: implemented (`mist-scope-json`; canonical JSON, lists sorted by id; a 404 section is recorded as null). Verified live 2026-10-19 (org + one site, byte-stable across runs once presigned URLs are stripped, see Phase 1).
- **Central** (implemented and verified live 2026-10-16, `central-scope-json`): New Central's config model is a **profile library** plus **config-assignments** that bind a profile to a scope for a device function (persona), and **scope-maps** that index every object in effect at each scope (`resource: "<type>/<name>"`). Scopes: Global (`org`, `scopeId: 'global'`; the tenant's numeric id is learned from its `GLOBAL` assignments and recorded as `centralScopeId`), then `site-collections`, `sites` and `device-groups` (paged with `limit`/`offset`; the reply's `offset` field is unreliable). Device scopes are left to device backups. Each bundle holds the scope's `assignments` and its `objects`: the `view-type=LOCAL&scope-id=<id>` read of every profile type its scope map lists. Global also holds the `library`: the default (library) read of every type assigned or mapped anywhere. `view-type=EFFECTIVE` returns 400, so resolved per-device config isn't available here. A type Central won't list (400/404) is recorded as null. **Gotcha**: `scope-maps` and `config-assignments` send `scope-id` as a JSON number above 2^53, which `JSON.parse` rounds (`68797217769316352` → `…350`); those reads use a lossless parse (`exactScopeIds`). Against the home tenant: 7 scopes, Global ≈ 425 KB (28 library types) in ≈ 30 s, bundles byte-stable across runs.
- **Secrets in scope bundles are redacted** (`utils/config-redact.js`, both providers). Presigned URLs (S3/Azure/GCS signature in the query) lose their query too: Mist's WLAN `portal_template_url` carries a temporary AWS token. Central returns RADIUS shared secrets as `shared-secret-config.plaintext-value` (`secret-type: PLAIN_TEXT`) and a vSphere `endpoint.password` in clear; Mist WLANs carry `psk`. A secret leaf becomes `[REDACTED hmac:<16 hex>]`, an HMAC keyed with `ENCRYPTION_KEY`, so a rotated secret still shows in a diff while a leaked backup or Git mirror can't be brute-forced. The cost: a scope backup can't recreate those secrets, and rotating `ENCRYPTION_KEY` changes every fingerprint once. Device backups are not redacted (AOS-CX stores its secrets as ciphertext in both artifacts).
- `services/scope-backup.service.js` mirrors the device path: flat files under `BACKUP_STORAGE_PATH/_scopes/` are authoritative, and the Git mirror commits to `_scopes/<integration>/<type>-<id>/`. `integrationId` is a plain column with denormalized names, so history outlives the integration. Runs are manual (`POST /backups/scopes/run`) or ride along on a schedule with `includeScopes`.

### Restore (not built; direction)

Nothing writes config today. When it comes, it is a `restore` operation in the transport matrix, **only** where the apply is atomic with rollback: Junos NETCONF (`load-configuration` + `commit confirmed`), and direct-managed AOS-CX REST (`PUT /fullconfigs/running-config` from the `structured` artifact, after a checkpoint). It is refused outright for `managementMode === 'cloud'` or `cloudManaged === true`. SSH paste stays a human action (not atomic; a half-applied config can lock us out). Cloud writes are a separate feature that edits provider profiles/templates, not "restore a device backup".

## 8c. Live port/PoE state (2026-10-15)

Near-real-time switch state, for people watching a device and as the event
source for future automation triggers (e.g. "PoE device came online"). The
hardware findings behind these choices are in
`hardware/AOS_CX_NOTES.md`.

**Why not streaming telemetry.** gNMI / Junos JTI / IOS-XE model-driven
telemetry were considered and rejected for now: each needs per-switch setup
(enable the service, TLS certificates, sometimes an extra package, and for
dial-out an inbound listener). NetHelper should work with the access it
already has. Change-driven state over the existing REST session needs nothing
configured on the switch.

**Two layers, sized differently:**

1. **Event layer** — `services/live/state-monitor.service.js`. Always on for
   devices with `Device.liveMonitoring` (opt-in, `PATCH
   /devices/:id/live-monitoring`), and on demand while someone has the Live
   tab open. Each port change becomes a `DeviceEvent` row
   (`port.link.up|down`, `port.admin.up|down`, `port.poe.up|down|fault`,
   `monitor.connected|disconnected`) and a global `device:event`. Cost per
   device is one idle socket; traffic only on change. Events are raw
   transitions, not debounced; consumers apply their own settle time.
2. **Live view** — `services/live/live-view.service.js`. While at least one
   browser watches a device, poll counters every `LIVE_VIEW_POLL_INTERVAL`
   and emit rates, PoE draw, and CPU/memory to `device:live:<id>`. Nothing is
   stored; there is no metrics history yet.

**Delivery per platform** (`PLATFORMS[*].liveState`, mirrored in the
frontend; matrix operation `live`):

| Platform | liveState | How |
|---|---|---|
| AOS-CX | `push` | REST notification WebSocket, one topic per physical port + PoE wildcard |
| Junos, AOS-S, IOS-XE, Meraki | `null` | Not yet. The monitor already supports `poll` (re-read + diff every `LIVE_STATE_POLL_INTERVAL`); a platform needs only a `getPortState()` reader. |

`live` is read-only and never uses the cloud plane: a cloud-managed device is
watched over its local API when it has an IP and a device credential
(`resolveTransport(device, 'live')`).

**Correctness rules:** every (re)connect takes a full snapshot and diffs it
against the last, so changes made while disconnected still become events
(`source: resync`); a skipped per-topic sequence number forces the same
resync; a periodic resync (`LIVE_RESYNC_INTERVAL`) is the backstop and also
keeps the REST session from idling out, which an open notification socket
does not do. Sessions and streams are recycled every `LIVE_SESSION_MAX_AGE`
(AOS-CX ends sessions after 480 minutes) and immediately when a resync had to
log in again. One `CXSwitchAPI` instance (one REST session) per device is
shared by the stream, resyncs, and live-view counter polls; AOS-CX allows 6
sessions per user.

**Known limits:** single backend instance (replicas would each watch every
device and record duplicate events; a Redis leader lock is a roadmap item);
`LIVE_MAX_CONNECTIONS` caps watched devices per process.

## 8d. Network topology / Network Map (2026-10-16)

A `/map` page that draws the managed network from each device's own LLDP/CDP
neighbor table, plus Discovery hosts. No switch-side setup: LLDP (and CDP on
Cisco) is on by default, and the reads use the access NetHelper already has.

**Collection** (`services/topology/topology.service.js`), via
`resolveTransport(device, 'topology')`, read-only:

| Platform | Transport | Read |
|---|---|---|
| AOS-CX | device REST (also under Central) | `GET system/interfaces/*/lldp_neighbors?depth=2`, identity from `GET system?attributes=hostname,system_mac` |
| Junos | NETCONF, SSH fallback | `<get-lldp-neighbors-information/>` + `<get-lldp-local-info/>`; CLI `show lldp neighbors` |
| AOS-S | SSH | `show lldp info remote-device detail`, `show lldp info local-device` |
| IOS-XE | SSH | `show cdp neighbors detail` + `show lldp neighbors detail` |
| Cloud (Mist) | provider `listNeighbors()`, once per run | `/orgs/:id/stats/devices?type=all&fields=…,lldp_stat,lldp_stats` (AP uplinks) + `/orgs/:id/stats/ports/search?neighbor_mac=*` (switch ports) |
| Cloud (Central) | provider `listNeighbors()`, once per run | `/network-monitoring/v1/topology/{site-id}` per site (v1 only; v1alpha1 is 404) |

Every collector returns the normalized neighbor in `services/topology/neighbor.js`.
Parsers live in `services/topology/parsers/`. Checked against real output: AOS-CX
(6200F ML.10.16, `tests/fixtures/aos-cx-live/lldp-neighbors.json`), Junos NETCONF
(EX4000, `junos-live/`), Mist (`mist-live/neighbors-*.json`) and Central
(`central-live/`), the last three on 2026-10-19. The Junos CLI, AOS-S and IOS
parsers are spec-derived. A scheduled Bull job
(`TOPOLOGY_INTERVAL`, default 6 h) and an on-demand "Refresh topology" both run
`collectAll`, which reads at most `TOPOLOGY_CONCURRENCY` devices at once and
opens one session per device.

**Storage:**
- `DeviceLink`: one row per local port and remote chassis/port.
- `DeviceTopologyState`: status `ok | skipped | unsupported | failed`, with a
  reason and the device's own chassis id/sysName, plus the device's VLAN
  snapshot (`vlans`, `vlanSource`, `vlanCollectedAt`, `vlanError`; below).
- `TopologyChange`: `link.added | removed | changed`.
- `MapLayout`: shared node positions per `all` / `site:<location>`.

`link-diff.js` reconciles a fresh table against the stored rows:
- A failed or skipped read never deactivates links.
- A device's first collection records no changes.
- A removal plus an addition on the same port is one `link.changed`.

**Resolution happens when the graph is built (`graph.js`), not when links are
stored.** A far end matches a Device by MAC (its own advertised chassis id
first, then `Device.macAddress`), then by management IP, then by an unambiguous
name. Anything left over is a ghost node, matched to a `DiscoveredDevice` by
MAC or IP so the map can import it. AOS-CX endpoints such as phones may
advertise an IP as their chassis id; their MAC then comes from `mac_addr`.
Links reported from both ends merge into one edge. Edges are oriented
gateway → switch → AP → endpoint for layered layout.

**VLAN overlay (2026-10-24).** The topology pass also reads each device's VLAN
membership, so links and VLANs always come from the same moment (config
backups can be days older):
- AOS-CX REST: `GET system/vlans?depth=2&attributes=id,name` and
  `system/interfaces?…&attributes=name,type,vlan_mode,vlan_tag,vlan_trunks,interfaces,routing,ip4_address`
  (`parsers/aos-cx-vlans.js`; a LAG's members inherit its membership; SVIs
  with an address are "routed"). Spec-derived until checked on the 6200F.
- Mist: `port_mode`/`vlan_ids` from the same `/stats/ports/search` rows (the
  effective membership, already resolved from templates) and irb from device
  stats `if_stat`. A trunk's native VLAN is unknown. A Mist-managed EX read over
  NETCONF still takes Mist's VLANs from the run's shared read.
- Other transports: none yet (`vlans` cleared). A failed VLAN read keeps the
  last snapshot and records `vlanError`; it never fails the link collection.

The snapshot (`vlan-membership.js`) holds the VLAN table, ports keyed by
normalized name, and routed VLANs. `vlan-analysis.js` adds `edge.vlans` to the
graph (`carried`, `pruned` = both switches have the VLAN but one port drops it,
`native` mismatch, `known` ends) and `graph.vlans` (per VLAN: devices, routing
devices, islands). Unknown is never guessed: an end without data never makes a
VLAN pruned, and a group touching such a link is never an island. The
frontend mirrors `edgeStatus` in `models/topology-vlans.js` (parity-tested).

**Cloud planes (2026-10-19):** a cloud-managed device that no direct transport
reaches (no IP or credential, or not a platform NetHelper reads locally: APs,
AOS-S under Central) gets its neighbors from its cloud. `listNeighbors()` reads
the whole org/tenant in a few calls and returns a table by serial;
`collectAll` reads it once per run and per integration and every device on that
integration looks itself up. A device the cloud reports offline, or that its
cloud has no data for, is *skipped*, so its last links stay as they were.
- **Mist** relays the devices' own LLDP tables (protocol `lldp`): an AP's
  `lldp_stats` (keyed by AP port, `""` on a single-port AP, which is `eth0`) or
  `lldp_stat`, and a switch's per-port `neighbor_mac` / `neighbor_system_name` /
  `neighbor_port_desc` (no remote port id; the description stands in). An AP's
  chassis id is its switch's inventory MAC, and the switch's `neighbor_mac` is
  the AP's, so both ends resolve and merge into one confirmed edge. Search
  endpoints page by a `next` path (`search_after`), not `page`; only a same-API
  path is followed.
- **Central** serves a computed site topology (protocol `cloud`): each link is
  listed once, by serial, with both ends' ports, and becomes a neighbor on both
  ends. Unmanaged LLDP neighbors appear as `Unmanaged` under a synthetic serial
  (`tpd_<mac>`), often named by their MAC (kept as chassis id, not name). A
  gateway's WAN uplinks are links to `Internet`/`LTE` pseudo-devices with no
  ports and are dropped. Offline devices keep their last links in the reply.
- A link one end reads directly and the other end's cloud reports merges like
  any two-ended link (e.g. an AOS-CX switch's own LLDP + Central's view of the
  AP on that port).

## 8e. Cloud sync and status refresh (2026-10-19)

Two Bull repeatables on the `device-sync` queue (`jobs/device-sync.job.js`),
both single-attempt (the next run is the retry):
- **`syncDevices`** every `CLOUD_SYNC_INTERVAL` (1 h): the full
  `syncDevicesFromCloud()` that the Sync button runs. It creates, adopts and
  updates rows, and is skipped when no integration is active. Its socket
  events carry `trigger: 'scheduled'`, and the UI reports only failures.
- **`refreshStatuses`** every `CLOUD_STATUS_INTERVAL` (5 min):
  `cloud-status.service.js` asks each provider for `listStatuses()`. That is a
  Map by serial of status, last seen, IP, firmware, connection state and
  config state, and it updates only the cloud rows owned by that integration.
  It never creates rows, never clears a known IP or firmware, and never
  overrides a `switch-rest` connection state. It writes only changed columns.
  An online device's last-seen time alone is not a change, because Central
  reports "now". It emits `device:status:update` (`status` is
  `effectiveStatus`, plus `cloudStatus`) and raises or clears
  `device.cloud-offline` / `device.cloud-config` on a change. Mist overrides
  the base read (full inventory) with one paged org stats call.

**Config state** (`configInSync` on the NormalizedCloudDevice): Central
`Synchronized` → true, `Out of sync` → false, null → null; Mist `NO_CHANGE` →
true, anything else → null (no failure value seen live yet). The
`device.cloud-config` rule opens only for an online device that is out of sync
(10-minute settle, since a push briefly reads out of sync) and clears when it
is back in sync.

## 8f. Cloud event streams (2026-10-19)

A provider that supports `'events'` offers `listEventChannels()` and
`openEventStream(channels)`: an unopened, read-only EventEmitter (`open`,
`data`, `close`). `services/cloud/cloud-stream.service.js` holds one
connection per such integration. It starts with the server, reconciles every
5 minutes and after any integration edit (open new, close removed, reconnect
edited, subscribe new sites), and reconnects with backoff (5 s doubling to
5 min). It is in-memory and single-instance, like the live monitor.
`CLOUD_STREAM_ENABLED` turns it off.

**Mist** (`services/cloud/mist-stream.js`): `wss://api-ws.<region>.mist.com/api-ws/v1/stream`
(the API host with `api-ws.` for `api.`), the REST token in the upgrade
request, one `/sites/:id/stats/devices` subscription per site. Checked live on
2026-10-19 (`probe-cloud.js --stream`, `tests/fixtures/mist-live/stream-stats-devices.json`):
- `channel_subscribed` acks each subscription; an unknown channel gets no
  reply (`/sites/:id/devices/events` is not one). `/sites/:id/devices` sent
  nothing in two minutes with no config change.
- `data` is a JSON string of **partial** stats, about once a minute per
  connected device: a switch sends one message (serial, uptime, `if_stat`),
  an AP sends two (`port_stat`, then uptime/version) keyed by MAC with no
  serial. Each says how long it stays valid (`_ttl`, 190 s).
- **No message carries a status**, and a disconnecting device just goes quiet.

So the stream is a trigger, and REST stays the source of truth: a device the
database holds as not online that reports, an online device whose last report
expired (`_ttl` + 30 s, swept every 30 s, re-asked each window while the cloud
still says online), and every (re)connect all run the §8e status refresh for
that integration, one at a time and at most every 30 s. Status, alerts and
`device:status:update` therefore come from one place. The refresh writes a
status change only if the status is still the one it read, so overlapping
refreshes report a change once.

**Events** (`DeviceEvent`, source `cloud`, `services/device-events.service.js`,
which also records the live monitor's): `port.link.up`/`down` when a port's
state differs between two messages (switch ports from their logical units,
skipping irb/vme/me0/lo0), `device.restarted` when uptime goes backwards by
more than a minute, and `cloud.<status>` for every status change the refresh
or sync writes (both clouds), plus once per device per process start, so a
steady device's history has a starting state (`recordStateIfChanged` /
`recordStateOnce`: nothing is recorded when the latest `cloud.*` event already
says the same). The ping monitor records `ping.online`/`ping.offline` the same
way (source `ping`). These two prefixes are the status lanes of the device
page's History tab (`services/device-history.service.js`). The first message
after start is a baseline. Events stay raw. The device page's Live tab lists them for devices
without live state; Settings → Cloud Integrations shows each stream's state
(`eventStream` on `GET /settings/cloud-integrations`).

**Central: none.** New Central delivers alerts only by HTTP POST to a URL it
calls (webhooks under Alert Management, or the GreenLake event framework).
That needs a public HTTPS endpoint, so it is deferred
(`ROADMAP_AND_TODO.md` item 1). Classic Central's protobuf streaming API does
not apply to New Central. Central stays on the 5-minute refresh.

## 9. Risks & open questions

1. **Meraki backup semantics** — biggest product-level risk: settings snapshot ≠ running-config. Needs UI honesty and a decision on which settings objects constitute the snapshot. (Partly addressed 2026-09-14: `format` is now persisted per backup and drives the filename in the Git mirror — see §8b — so the distinction is recorded. The UI labelling decision remains open.)
2. **Mist regional clouds** — confirm the regional hostname list at implementation time; offer a region picker in the UI.
3. **central→cloud rename migration** — riskiest single migration; rehearse on a DB copy; `@map` fallback exists.
4. **Central's broken endpoints** — if Phase 0 cleanup shows classic-Central config retrieval never worked, scope Aruba cloud backup down rather than letting the abstraction inherit fictional capabilities. (Related: item 5b in `docs/ROADMAP_AND_TODO.md`, OAuth 401 blocker.)
5. **DeviceType classification** — Meraki MX → gateway; cameras/sensors → `other`, excluded from backup.
6. **Credential model split** — direct creds in `ApiCredential`, cloud creds in `CloudIntegration.credentials` JSON; accept the mild inconsistency for MVP.
7. ~~**NETCONF dependency** — deferred~~ — **Resolved in Phase 2.** Hand-rolled over `ssh2.subsys('netconf')` exactly as this note anticipated; no npm dependency added. The npm `netconf` package was confirmed stale (last release 2022).
8. **NETCONF is off by default on Junos** — `set system services netconf ssh` is required. Handled by falling back to the SSH CLI, but it means a fleet that has never enabled NETCONF gets the CLI path silently. The connection-test result reports which transport was used, so this is visible rather than hidden.

## 10. Critical files

| File | Role in this plan |
|---|---|
| `backend/prisma/schema.prisma` | vendor/platform fields, ManagementMode + `central*` renames, `CloudIntegration` |
| `backend/src/utils/device-platform.js` | rewrite field-first; source of the backfill classifier |
| `backend/src/services/aruba-central.service.js` | cleanup → `cloud-providers/aruba-central.provider.js`; template for `BaseCloudProvider` |
| `backend/src/services/config-backup.service.js` | `pullConfig()` — the dispatch pattern to generalize; every vendor's backup path |
| `backend/src/services/device-api/device-api-factory.js` | vendor-driven `determineDeviceAPIType`, constants-driven supported types |
| `backend/src/services/ssh-device.service.js` | `PLATFORM_PROFILES` additions for junos / ios-xe |
| `frontend/src/views/devices/DevicesView.vue` | vendor/platform/cloud-integration selectors in Add/Edit |
| `frontend/src/components/settings/ArubaCentralCredentials.vue` | → generic `CloudIntegrations.vue` |
