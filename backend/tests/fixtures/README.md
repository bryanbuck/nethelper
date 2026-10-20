# Test fixtures

`central-devices.json` follows the shape of a **live** New Central
`network-monitoring/v1alpha1/devices` response (captured 2026-10-16, values
anonymised). It replaced a spec-derived fixture that turned out to be wrong:
the live API sends `serialNumber`, `status` `ONLINE`/`OFFLINE`, `lastSeenAt`
(ISO, null while online) and `uptimeInMillis`, and rejects filters on `serial`.

`mist-live/` holds **live** captures from a Mist org (2026-10-19, `api.ac2.mist.com`),
anonymised by `scripts/probe-cloud.js` (serials, MACs, ids, org name, claim
codes, public IPs, locations; secrets were already fingerprinted). The org has
one site, an AP33 and an EX4000-12MP, both powered off, so the stats show the
last-known state (`status: disconnected`, stale `ip`/`uptime`). What first
contact taught: inventory has `connected` and `version` but no last-seen time
(stats have `last_seen`); `config_status` only comes back when `fields` asks
for it; an org token's `/self` has a `name`, not an email; switches carry
`mist_configured` on their device object; WLANs carry a presigned S3
`portal_template_url` that changes on every read. `stats-devices-allfields.json`
(`fields=*`) keeps the AP's `lldp_stat` and the switch's LLDP `clients` for the
cloud-neighbor work. The `*-online.json` files are the same org minutes after
both devices were powered on: `inventory-online.json` (`connected: true`),
`stats-devices-allfields-online.json` (`status: connected`, fresh `last_seen`),
`stats-ports-search-online.json` (`/stats/ports/search`: per-port state, with
`neighbor_mac`/`neighbor_system_name`/`neighbor_port_desc` from LLDP) and
`device-events-online.json` (`/devices/events/search`: `SW_RESTARTED`,
`SW_CONNECTED`, `AP_RESTARTED` with `reason: power_cycle`, ...), the inputs for
cloud neighbors and cloud events. The `neighbors-*.json` files come from one
later run (so their anonymised ids line up with each other, not with the files
above): inventory, `/stats/devices` with the neighbor `fields` list, and
`/stats/ports/search`, with the AP on the EX's `mge-0/0/0`; an AP33's
`lldp_stats` is keyed by `""` (its only port). `stream-stats-devices.json` is
75 seconds of the org's WebSocket stream (`probe-cloud.js --stream
'/sites/{site}/stats/devices'`, both devices online): the subscribe ack, then
partial stats as Mist sends them (`data` was a JSON string, parsed here):
one switch message (serial, uptime, `if_stat`), two AP messages keyed by MAC
with no serial (`port_stat`; uptime/version), each with `_ttl: 190` and none
with a `status`.

`central-live/` holds **live** New Central captures from one run (2026-10-19,
anonymised the same way): the `network-monitoring/v1alpha1/devices` list and
`network-monitoring/v1/topology/{site-id}` for three sites (`topology-hq.json`:
VSX core pair, APs, an AOS-S switch, unmanaged LLDP neighbors under `tpd_<mac>`
serials; `topology-branch.json`: a gateway whose WAN uplinks are port-less
links to `Internet`/`LTE` pseudo-devices, and an offline switch still listing
its last link; `topology-teleworker.json`: empty, the site's only AP offline).
Topology is served only on `v1`; `v1alpha1` returns 404.

`junos-live/` holds **real** NETCONF replies from the same EX4000-12MP (Junos
24.4R2.25, Mist-managed, 2026-10-19), with MACs, serials and CLEI codes
anonymised: `<get-software-information/>`, `<get-lldp-neighbors-information/>`
(brief style: the far end's port arrives as `lldp-remote-port-description`
only), `<get-lldp-local-info/>`, `<get-chassis-inventory/>`,
`<get-chassis-mac-addresses/>` (the base MAC is `fpc-mac-base`, not the spec's
`public-base-address`) and a committed set-format config read by an account
without `view-configuration`, which Junos answers with `/* ACCESS-DENIED */`
placeholders rather than an error. `tests/unit/junos-live.test.js` runs
`JunosAPI` over them.

`mist-inventory.json`, `mist-stats.json` and `mist-scope.json` are older
spec-derived fixtures, kept for cases the live org doesn't have (a connected
switch, an unassigned gateway, several sites). Their field names were checked
against the live captures.

`central-scope.json` follows **live** New Central `network-config/v1alpha1`
responses (captured 2026-10-16, values anonymised). `scopeMapsText` is kept as
raw text because Central sends `scope-id` as a JSON number above 2^53; the
test parses it the way the provider does.

`aos-cx-live/` is different: trimmed **real captures** from an Aruba 6200F on
ML.10.16.1010 (2026-10-15), with port descriptions anonymised. They are the
REST responses behind `CXSwitchAPI.getPortState()` / `getInterfaceCounters()`
and the notification frames of a PoE phone being unplugged and replugged. See
`docs/archive/LIVE_STATE_CX_PROTOCOL_CHECK_2026-10-15.md`.
`aos-cx-live/lldp-neighbors.json` is a trimmed real capture from the same switch
on 2026-10-16: `GET system/interfaces/*/lldp_neighbors?depth=2` (organizational
TLVs dropped, domain name anonymised) plus `GET system?attributes=hostname,system_mac`.
It holds a switch neighbor (chassis id = system MAC) and a Cisco phone that
advertises an IP as its chassis id. The Junos, AOS-S and IOS neighbor outputs in
`tests/unit/topology-parsers.test.js` are spec-derived, not captures.
