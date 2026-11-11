# Cisco Meraki integration (preview)

**Status (2026-11-10): built from Cisco's API documentation, never run against a real Meraki organization.**
It lives on the `wip/meraki` branch and is not part of any release. Tests use
reply shapes taken from Cisco's OpenAPI spec (v1.76), and the same code was
exercised against a local mock server; neither proves it against real gear.
This page says what it does, how to try it, and what a tester can send back.

The integration **only reads**. NetHelper never changes anything in Meraki.

## What it does

| Feature | Meraki source | Notes |
|---|---|---|
| Connection test | `/organizations`, `/administered/identities/me` | Checks the key can see the organization and that API access is on |
| Device sync | `/organizations/{id}/inventory/devices`, `/devices`, `/devices/availabilities`, `/networks` | Every claimed device. A Meraki *network* is NetHelper's *site*. APs, switches, appliances get their type; cameras, sensors and the rest sync as "other" |
| Status refresh (5 min) | `/devices/availabilities`, `/devices` | `alerting` counts as online, `dormant` as offline. Meraki itself refreshes this list every 5 minutes |
| Config backup, per device | `/devices/{serial}` plus management interface, switch ports and L3 interfaces, AP radio settings, appliance uplinks | A **settings snapshot** (JSON), not a running-config: Meraki has none |
| Config backup, cloud scopes | organization, each network, each configuration template | Where most Meraki configuration lives: SSIDs, RF profiles, switch settings and ACLs, appliance VLANs, firewall and VPN rules. Secrets (PSKs, SNMP strings, passphrases) are replaced by fingerprints |
| Network Map | `/switch/ports/topology/discovery/byDevice`, `/switch/ports/bySwitch`, `/networks/{id}/topology/linkLayer` | LLDP/CDP neighbors, and switch port VLANs for the VLAN overlay |
| Cloud alarms | `/organizations/{id}/assurance/alerts` | Active and recently resolved health alerts. "Unreachable device" is left out (NetHelper records offline itself) |
| "Who has this address?" | `/devices`, `/networks/{id}/clients?ip=` | Clients are listed per network, so at most 20 networks are asked, nearest first |

Not available: live port state, an event stream (Meraki only offers webhooks,
which need a public endpoint), a config-in-sync indicator, device credentials
or SSH (Meraki devices have no local management NetHelper can use).

Rate limit: Meraki allows 10 requests a second per organization, shared by
every API client. NetHelper sends at most 5 a second, one at a time, and waits
out a 429's `Retry-After`. A scope backup of a network with all three product
types is about 50 requests, so a large organization's scope backups take a
few minutes.

## Trying it (testers)

You need a Meraki dashboard administrator account with **read-only** access to
the organization, and Docker on the host.

1. Get the branch and build it. `install.sh` builds locally because the
   checkout is not a release:

   ```sh
   git clone -b wip/meraki https://github.com/bryanbuck/nethelper.git
   cd nethelper/deploy && ./install.sh
   ```

   On an existing checkout: `git fetch && git switch wip/meraki && cd deploy && ./install.sh`.
   The branch has no database changes, so going back is
   `git switch master && ./install.sh`.
2. In the Meraki dashboard: enable API access (Organization → API & Webhooks),
   create an API key (your profile → API access), and note the organization ID
   (Organization → Settings, bottom of the page).
3. In NetHelper: Settings → Cloud Integrations → Add → **Cisco Meraki (preview)**.
   Pick the region, paste the key and the organization ID, Save, then **Test**.
4. Sync devices (Devices page), then try: Config Backups (a device, and Cloud
   scopes → Run), the Network Map (Refresh), Activity, and a device page.

### What to check

- Does the test pass, and does it name the right organization?
- Are all devices there, with the right type, network name, IP, firmware and
  online/offline status? Do offline or spare devices look sensible?
- Do backups succeed? Change one harmless setting in the dashboard (a port
  name), run the backup again: does the diff show exactly that change? Run it
  twice with no change: is it reported as unchanged?
- Does the map draw the links you expect?
- Do Meraki health alerts appear in Activity?

### What to send back

The most useful thing is a capture of the real API replies. This sends GET
requests only and writes files to a folder outside the app:

```sh
docker compose exec backend node scripts/probe-cloud.js --integration "<integration name>" --out /tmp/meraki-probe
docker compose cp backend:/tmp/meraki-probe ./meraki-probe
```

Each reply is saved twice: `<name>.json` (secrets already replaced) and
`<name>.anon.json` (serials, MACs, names, addresses and public IPs replaced
too). Please send the **`.anon.json`** files and `_summary.json` **privately**
(email, not a public GitHub issue), and look through them first: the
anonymiser was written for other vendors and may miss something Meraki-specific
(network IDs and client usernames are the likely ones).

## What first contact has to confirm

Guesses the code makes because the spec does not say:

1. **Status**: `availabilities` has no last-seen time, so an online device is
   stamped "seen now" and an offline one keeps its previous time. Is `alerting`
   really "up"? What does a never-connected spare report?
2. **Firmware strings** (`wireless-25-14`, `switch-15-21-1`): shown as Meraki
   sends them.
3. **LLDP/CDP TLV names** in the switch discovery read (`System name`,
   `Chassis ID`, `Port ID`, `Management address`, `Device ID`, ...): matched
   loosely, but the real names are unknown. This decides whether the map works.
4. **Link-layer topology** shape (`nodes`/`links`/`ends`): the spec example is
   thin. Used only for APs and appliances.
5. **Snapshot stability**: do any sections change between two reads with no
   config change (timestamps, counters, reordered lists)? Those fields must be
   dropped. Lists whose items all have an `id` are sorted; others (firewall
   rules, ACLs) keep Meraki's order.
6. **Which sections answer 400/404** on real networks (recorded as `null`), and
   whether configuration templates answer the network endpoints at all.
7. **Secrets**: does anything secret come back under a key the redaction
   misses? (`utils/config-redact.js` matches password, passphrase, psk, secret,
   community string, private key, API key, token.)
8. **Alerts**: do the `active` / `resolved` / `tsStart` filters behave as
   assumed, what severities exist beyond critical/warning/informational, and
   which types duplicate NetHelper's own offline detection?
9. **Client search by IP**: `ip` is a partial match and `lastSeen` may be epoch
   seconds or ISO; both are handled, neither is confirmed.
10. **Redirects and regions**: whether `api.meraki.com` redirects to a shard
    (`nNNN.meraki.com`) for this organization; the key is only ever sent to
    hosts on the same domain as the configured API host.
11. **Unassigned inventory**: spare devices sync as offline devices with no
    site. Is that useful or noise?

## Design notes

- Provider: `backend/src/services/cloud-providers/meraki.provider.js`
  (capabilities `inventory`, `status`, `test`, `config-backup`, `scope-backup`,
  `topology`, `address-lookup`, `alarms`). Topology parser:
  `services/topology/parsers/meraki.js`.
- Devices are `vendor: cisco`, `platform: meraki`, `managementMode: cloud`. The
  `cisco/meraki` transport row has no direct transports, so nothing ever tries
  SSH or a device credential.
- Formats: `meraki-settings-json` (device), `meraki-scope-json` (scope types
  `org`, `network`, `config-template`).
- `CLOUD_PROVIDERS.cisco_meraki.implemented` (`backend/src/constants/vendors.js`)
  is the one switch that offers Meraki in Settings; `preview: true` adds the
  label and the notice in the dialog. No database migration.
- Branch rules: `wip/meraki` is long-lived and pushed for testers. Merge
  `master` into it, never rebase; no PR, tag or merge to `master` until first
  contact has gone well.
