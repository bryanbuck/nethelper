# AOS-CX: behavior observed on hardware

Facts about AOS-CX that the code depends on and that the API docs don't make
obvious. Each was observed on real switches; the live-state design that came
out of them is in `docs/MULTI_VENDOR_ROADMAP.md` §8c. Trimmed captures are the
fixtures in `backend/tests/fixtures/aos-cx-live/`.

**Reference switches:** Aruba 6200F 12G Class4 PoE, ML.10.16.1010, managed by
Aruba Central (local configuration locked), dedicated read-write REST account
(2026-10-15/16). The Central probe was first verified on a 10.10-era 6100-class
switch (2026-07-08).

## Enabling the REST API

On the switch (any user with `administrators` works; prefer a dedicated
account, since each user gets only 6 sessions):

```
configure terminal
user nethelper group administrators password plaintext <password>
https-server rest access-mode read-write
https-server vrf mgmt        # and/or: https-server vrf default
```

Check with `show https-server`. The reference switch used a read-write
account; NetHelper only reads, but `read-only` hasn't been tried. Central's connection is
independent of `access-mode`: changing it doesn't affect Central, and local
REST reads keep working on a Central-managed switch.
## REST

- `GET /rest` (no auth) lists v10.04 through v10.16. The shapes used here are
  identical at v10.10 and v10.16; NetHelper pins **v10.10** for every call.
- **HTTP Basic auth is refused (401).** Only cookie sessions work. The CX
  pollers in `device-poller.service.js` sent Basic auth, so firmware/system
  polls and **config backups over local REST failed on this hardware**; they
  now use `CXSwitchAPI` sessions (`withCxSession`). Login credentials moved
  from the query string to a form body.
- Session limits (`show https-server`): **6 sessions per user, 20-minute idle
  timeout, 480-minute absolute timeout.**
- Physical ports have `type: "system"`; `lag`, `vlan`, `ubt` are excluded.
- `admin_state` follows the link: it read `down` while a cable was unplugged
  on a port nobody had shut. Configured enable/disable is `user_config.admin`.
- The wildcard `GET /system/interfaces/*/poe_interface` nests each port's
  resource under an empty-string key: `{ "1/1/4": { "": { ... } } }`.
- PoE: `status.port.powering_status` (`delivering` / `searching` / `disabled`
  / faults), `pd_type`, `power_mgmt.port.pse_assigned_class`,
  `measurements.power_drawn` (W).
- Counters (`statistics`): `rx_bytes`, `tx_bytes`, `rx_packets`, `tx_packets`
  are cumulative. Error keys are sparse (only present once non-zero).
  `fe_if_in_discard_packets` was ~500k on a healthy trunk port while
  `show interface` reported 0 errors and 0 drops; it is not counted as errors.
  The switch also computes its own `rate_statistics`, averaged over a
  300-second `rate_interval`; too smooth for a live view, so NetHelper
  computes rates from counter deltas.
- CPU/memory: `system/subsystems/management_module,1%2F1` →
  `resource_utilization.cpu` / `.memory` (percent).

## Notification WebSocket

`wss://<ip>/rest/v10.10/notification` with the session cookie and CSRF
token; send `{"type":"subscribe","topics":[{"name": "<REST URI>"}]}`.

- The `success` ack lists every matching resource. **Per-port topics and the
  PoE wildcard topic include current values; a collection topic
  (`/system/interfaces?attributes=…`) does not** (empty `values`). Change
  notifications on the collection topic are likewise empty: they say which
  resource changed, not to what. NetHelper subscribes one topic per physical
  port (link, `description`, VLAN attributes), one per LAG (VLAN attributes
  and `interfaces`), plus the PoE wildcard.
- **VLAN and description attributes on a topic** (6300F, FL.10.16, 2026-11-09,
  Central-managed): a per-port or LAG topic with
  `attributes=description,applied_vlan_*,vlan_*,routing,interfaces` is accepted,
  and the ack carries their current values
  (`tests/fixtures/aos-cx-live/notifications-vlan-ack.json`). A LAG's member
  ports report null VLAN attributes; only the `lag*` interface has them. On a
  trunk the native VLAN is also listed in `vlan_trunks` (native 20, allowed
  18,20, as `show running-config` writes it).
- **Changes to them are pushed** (checked 2026-11-09 by the maintainer, Live
  tab open, changes made from Central on a Central-managed switch): a port
  description, an access VLAN, access → trunk (native + allowed), a change to
  the allowed list only, and a LAG's VLAN (every member row updated) each
  arrived within seconds as a notification, not at the 10-minute resync.
- Notifications carry **only the changed attributes** (`pd_type` and `status`
  arrive in separate frames), with `operation: "modified"` and the resource URI.
- `sequence_number` is **per topic**, starting at 1 in the ack, used for gap
  detection.
- **An open notification socket does not keep the REST session alive.** A
  35-minute idle subscription stayed open, but the session behind it had
  expired (logout returned 401). Hence the periodic resync
  (`LIVE_RESYNC_INTERVAL`, default 10 min, under the 20-minute idle timeout)
  and the planned recycle (`LIVE_SESSION_MAX_AGE`, default 6 h, under the
  480-minute absolute timeout).
- Works on a Central-managed switch: local reads and notifications are
  unaffected by Central's configuration lock. CLI `shutdown` is refused
  ("Invalid input") while Central manages the switch.

## Observed sequences (port 1/1/4, PoE desk phone, Class 2)

Cable pulled at the switch, then replugged (raw notification timing):

| t (s) | change |
|---|---|
| 222.9 | PoE `pd_type → null`, then `powering_status → disabled` |
| 223.7 | link down |
| 318.3 | PoE `searching` |
| 318.8 | PoE `pd_type Type1`, `delivering` |
| 326.4 | link up, 1G |
| 347.8 | link down (phone boot) |
| 350.9 | link up |

`no power-over-ethernet` then re-enabled, pushed from Central, observed
through the full NetHelper stack (DeviceEvent rows, `device:event`):
`port.poe.down`, `port.link.down` (+0.9 s), `port.poe.up` (+87 s),
`port.link.up` (+7 s), then the same boot bounce (down/up 3 s apart).

Two consequences for automation triggers (a later phase): PoE delivers
several seconds before the link comes up, so "PD came online" should key on
`port.poe.up`; and PoE devices bounce their link while booting, so triggers
need a settle time. Events are recorded raw.

## Central management probe

`device-poller.service.js` (`central-status`) reads the switch's own view of
its Central relationship, the data behind `show aruba-central`:

- `GET /rest/v10.10/system/aruba_central`. AOS-CX 10.15+ adds an equivalent
  `hpe_anw_central` resource; the legacy URI still works.
- The flag is **inverted**: `disable: false` means Central is enabled. Connection
  state is nested: `status.central_connection` (`connected` / `not-reachable` /
  `connection_failure`), alongside `central_source` (activate/dhcp/manual) and
  `location`. Newer firmware may rename attributes, so the normalizer tries
  several candidates.
- A switch connects to Central in **monitor** or **managed** mode. Managed means
  Central is the only source of configuration; `configuration-lockout central
  managed` additionally blocks every other writer (its `no` form only works while
  disconnected). `normalizeCentralStatus` sets `cloudManaged` (source
  `switch-rest`): true when connected and not in monitor mode, false when
  disabled or monitor-only, null (unknown) when enabled but not connected.

## VLAN membership and VXLAN (6300F, FL.10.16.1060, 2026-11-04)

Two 6300Fs (Lab-Edge0/Edge1, Central-managed, read-only REST reads) joined by a
static VXLAN. Captures: `aos-cx-live/interfaces-vlans.json`,
`aos-cx-live/vxlan-edge0.json`, `vxlan-edge1.json`.

- **`vlan_mode` is null on a port configured with only `vlan access <n>`.** The
  configured `vlan_tag` still names the VLAN, but a port left in the default
  VLAN has `vlan_tag: null` too. `applied_vlan_mode` / `applied_vlan_tag` /
  `applied_vlan_trunks` always say what is in effect, so the VLAN parser reads
  those first. A routed port has `applied_vlan_mode: null` and `routing: true`.
- References at `depth=2` are id maps: `vlan_tag: { "110": "/rest/v10.10/system/vlans/110" }`.
- VXLAN lives in three places:
  - `system/interfaces/vxlan1` (`type: vxlan`): `options.local_ip` is the VTEP
    source (here loopback0's /32, not the management IP), `admin`.
  - `system/virtual_network_ids`, keyed `vxlan_vni,<vni>`: `id`, `vlan` (id
    map), `vrf` (null for an L2 VNI), `state: operational`.
  - `system/interfaces/vxlan1/tunnel_endpoints`, keyed `<vrf>,<origin>,<ip>`
    (`default,static,10.15.20.25`): `destination`, `origin: static`,
    `state: operational`, `network_id` (the VNIs flooded to that peer).
- `system?depth=1` also lists `evpn`, `evpn_instances` and `evpn_mac_ips`; with
  no EVPN configured, `evpn` is 404 and `evpn_instances` is `{}`.
- `filter=type:<t>` works on `system/interfaces` here. The reader filters
  client-side anyway, in case older firmware rejects it.

## MAC and ARP tables (Port Identity, 2026-11-10)

GET-only reads of Sw-CoreA (6300F), Sw-Studio (6200F) and Lab-Edge0/1 (6300F).
Scrubbed captures: `tests/fixtures/aos-cx-live/port-clients/`. The reader is
`CXSwitchAPI.getClientTables()` (three GETs on one session), parsed by
`services/ports/parsers/aos-cx-clients.js`.

- `GET system/vlans/*/macs?depth=2` returns
  `{ <vlan>: { "<from>,<mac>": { mac_addr, from, port: { "<port>": ref }, inactivity_timeout: 300, network_infra_mac, ... } } }`,
  in 30–330 ms per switch.
- The same MAC appears once per VLAN it was learned in (73 entries, 59 MACs on
  Sw-Studio), so de-duplicate per (port, MAC).
- `network_infra_mac` is true for every MAC learned on AP ports and switch
  links, and false on edge ports (including a phone): the switch's own uplink
  hint.
- MACs are also learned on non-physical ports (`vxlan1` on a VTEP, `lag3`). A
  LAG is stored as its own port; tunnel ports are skipped.
- `GET system/vrfs/*/neighbors?depth=2` (ARP) returns
  `{ <vrf>: { "<ip>,<l3 port>": { ip_address, mac, port: { vlan10: ref }, phy_port: { "1/1/13": ref }, state } } }`.
  `phy_port` names the physical port behind the VLAN interface. Only the
  routing switch has most entries (Sw-CoreA 65, the access switch 7), so IP
  enrichment is fleet-wide. A switch that routes nothing answers with an empty
  table; an ARP failure leaves the IPs empty rather than failing the read.
- A quiet MAC leaves the table after `inactivity_timeout` (300 s), so one read
  that misses a MAC proves nothing.
- Ports seen: uplinks to inventory switches had 56 MACs; AP ports (LLDP `WLAN`)
  8–13 (wireless clients bridged); a non-inventory gateway (LLDP
  `Bridge, Router`) 19 and a small switch (LLDP `Bridge`) 3; a hypervisor trunk
  (LLDP neighbor with no name or capabilities) 13; two ports with 3–4 MACs and
  no LLDP. **Phone + PC** pairs (LLDP `Bridge, Telephone` plus a second MAC on
  the data VLAN) are on both access switches.
- Port descriptions are already meaningful on real switches ("IP Phone + USB-C
  dock", "Trunk to Core"); the Ports tab shows them next to the user's label.
