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
| Cloud plane | `aruba-central.service.js` singleton + bespoke `ArubaCentralConfig` table, imported **directly** by device sync, config backup, automation, discovery. Several methods are dead (unset `this.baseURL`); tenant OAuth currently 401s (`docs/archive/CENTRAL_ENDPOINT_TRIAGE.md`) |
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
                                   //   aruba_central: { clientId, clientSecret, customerId }
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
  - Upserts are **serial-keyed and idempotent**, with ownership following the most recent sync that saw the device. A device that moves between tenants is re-attributed rather than duplicated.
  - Credentials and OAuth token caches are **per integration** (Redis key `cloud:{integrationId}:access_token`), so two Central accounts never share a token.
  - Sync can be scoped to one integration (`POST /devices/sync { integrationId }`, or the per-integration "Sync devices" button in Settings) or run across all active ones.
  - `Device.cloudIntegrationId` is `SetNull` on delete: removing an integration keeps its device rows but drops their cloud attribution.
- `ApiCredential` stays as-is for direct-device creds — `apiKey`/`apiSecret` already cover token-style auth.
- `DiscoveredDevice.isArubaVendor` → generalize to `matchedVendor Vendor?` (low stakes; can lag to post-MVP).

## 4. Cloud provider abstraction

`base-cloud-provider.js`, mirroring `BaseDeviceAPI`'s style (methods throw NotImplemented by default):

```js
class BaseCloudProvider {
  constructor(integration) { ... }      // CloudIntegration row (decrypted creds)
  async testConnection()                // → { success, message, details }
  async listInventory()                 // → NormalizedCloudDevice[]        (MVP)
  async getDeviceStatus(serial)         // → { status, lastSeen, raw }      (MVP)
  async getDeviceConfiguration(serial)  // → { text, format, source } or throws CapabilityError (MVP)
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
- `getSupportedDeviceTypes()` is generated from `constants/vendors.js` — this also fixes the frontend's hardcoded type lists.
- Cloud-managed devices never reach the factory; the router short-circuits them to their CloudProvider.

### Transport router (`utils/transport-router.js`)

Generalizes `pullConfig()`'s three-way branch and `useSshTransport()` into one declarative matrix:

```js
// resolveTransport(device, operation) → ordered transports: 'cloud' | 'device-rest' | 'ssh' | 'unsupported'
const TRANSPORT_MATRIX = {
  'aruba/aos-cx':  { config: ['device-rest', 'ssh'], status: ['device-rest'], test: ['device-rest', 'ssh'] },
  'aruba/aos-s':   { config: ['ssh'],                status: ['ssh'],         test: ['ssh'] },
  'juniper/junos': { config: ['ssh'],                status: ['ssh'],         test: ['ssh'] },  // Phase 2
  'cisco/ios-xe':  { config: ['ssh'],                status: ['ssh'],         test: ['ssh'] },  // Phase 4 (+ device-rest if RESTCONF)
};
// managementMode === 'cloud' overrides everything → ['cloud'], gated by provider.supports(capability)
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
5. **Connection testing**: `DeviceConnectionTest.vue` + `DeviceApiTestingView.vue` hardcoded type lists → fetch from the (now constants-driven) `/device-api/supported-types` endpoint.

## 8. Phased roadmap

Ordering rationale: Mist is the *easiest possible* second implementation of both new abstractions (token auth, clean REST, real config API) — it validates the CloudProvider interface with minimal incidental complexity. Junos-direct next exercises the SSH/transport-router path while Juniper context is fresh. Meraki before Catalyst because it's a third cloud provider (pattern proven twice) whose only novelty is the config-semantics question; Catalyst-direct is nearly free by then.

### Phase 0 — Vendor groundwork ✅ **COMPLETE** (2026-07-12)

Shipped, no behavior change for Aruba:

- **Schema** (`migrations/20260712000000_multi_vendor_phase0`): `Vendor` enum + `Device.vendor`/`platform`; `DeviceType` +`controller`/+`other`; `ManagementMode` `central`→`cloud`; `central*`→`cloud*` column renames; `CloudProviderType` enum + `CloudIntegration` table + `Device.cloudIntegrationId`. Hand-written SQL (Prisma's diff would have dropped/recreated for the renames). Data migrations copy `ArubaCentralConfig` rows into `CloudIntegration`, attribute existing cloud devices to the active Central integration, and backfill `platform` by mirroring `detectPlatform()`'s detection order.
- **Central cleanup**: `aruba-central.service.js` **deleted**. Its working parts (OAuth, `network-monitoring/v1alpha1` inventory) live in `cloud-providers/aruba-central.provider.js`; the dead `this.baseURL` methods and unverified classic endpoints (`/configuration/v2`, `/troubleshooting/v1`, `/monitoring/v2`, `/firmware/v1`) now throw typed `CapabilityError` rather than failing opaquely. Token cache is keyed per integration, so tenants never share a token.
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

### Phase 3 — Cisco Meraki (cloud)

- `meraki.provider.js`: API-key auth (`X-Cisco-Meraki-API-Key`), testConnection via `GET /organizations`, org devices + statuses, rate-limit throttle (~10 req/s/org).
- **Config backup = settings snapshot** — Meraki exposes no running-config. Serialize a defined set of API-readable settings (start minimal: device attributes, switch ports, wireless SSIDs, L3 firewall rules) to stable canonical JSON, stored through the same backup pipeline (`format: 'meraki-settings-json'`), labeled honestly in the UI ("settings snapshot, not running-config").
- **Verify**: inventory/status sync; snapshot backups diff meaningfully when a dashboard setting changes; UI labels the backup type correctly.

### Phase 4 — Cisco Catalyst direct (SSH; RESTCONF optional)

- `cisco-ios` SSH profile; `cisco/ios-xe` matrix row; manual add + test + backup. Optional: `catalyst-api.js` RESTCONF for structured status where enabled.
- **Verify**: same as Phase 2 against a Catalyst; enable-mode edge case documented or handled.

### Post-MVP (explicitly out of scope above)

Per-vendor pollers (generalize `device-poller.service.js`), automation actions for new vendors, Juniper/Cisco discovery OUI tables, Mist WebSocket streaming, NETCONF, restore/rollback.

## 8b. Config-backup storage (2026-09-14)

Backups are stored twice, on purpose:

1. **Flat files** under `BACKUP_STORAGE_PATH` — one immutable timestamped file per run, pointed at by `ConfigBackup.filePath`. **Authoritative.** Every read path (content, download, diff, delete) goes through it.
2. **An optional Git mirror** (`services/git-backup.service.js`, configured by the single-row `GitBackupConfig`) — one repo, one directory per device serial holding the config plus a `meta.json` sidecar, committed only when the config actually changed, pushed once per batch.

Two consequences matter for the vendor work:

- **`format` is now persisted, not discarded.** `pullConfig()` returns `{ text, source, format }` and the value lands on `ConfigBackup.format`. This closes the gap flagged in §9.1: an intent-based settings snapshot (Mist today, Meraki later) is recorded as `mist-config-json` / `meraki-settings-json` and committed as `settings.json`, while a real running-config is `cli-text` → `running-config.cfg` and Junos set-format is `junos-set` → `running-config.set`. The repo is self-describing, so "settings snapshot ≠ running-config" is visible on disk rather than only in the UI.
- **Retention and history are deliberately asymmetric.** `pruneRetention()` drops rows and flat files; Git history is never rewritten (that would require a force-push that breaks clones). The repo is the long-term archive beneath a bounded working index.

The mirror is additive and best-effort throughout: a commit or push failure is logged and the backup still succeeds, because the authoritative bytes are already on disk. A `CapabilityError` still produces no commit at all — an honest "not supported" must not leave a phantom version in history.

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
