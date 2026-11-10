# Port Identity (work in progress)

> **Status: experimental, on branch `wip/port-identity` only.** Not in any
> release. This document folds into `CLAUDE.md`, `docs/ROADMAP_AND_TODO.md` and
> `docs/MULTI_VENDOR_ROADMAP.md` when the feature ships, and is then deleted.

Port Identity answers "what is plugged into this switch port?" and gives users
a place to record what they know about the port ("Room 214 printer").

## Ports and clients are different things

- **Port notes** (`PortNote`) belong to the *port*: a short label (64
  characters or less, the future port description), location, owner, free
  notes, a kind override, and an optional pinned "expected device" MAC. Every
  save or clear is a `PortNoteRevision` (who, when, the values after it), keyed
  by device and port so the history survives a clear.
- **Client sightings** (`PortClient`) are what reads see on the port right now
  or recently: MAC, vendor, IP, hostname, VLAN, LLDP identity, and which
  sources saw it. They come and go on their own.
- **Read state** (`PortReadState`, per device and source) says when the ports
  were last read and whether that worked, and keeps per-port MAC counts.

Only **wired clients on switch ports** are stored. Wireless clients stay on
demand (the address lookup). This reverses "NetHelper stores no network
clients" in ROADMAP item 12 for wired clients only; the row count is bounded by
ports, because uplinks and AP ports keep a count, not their clients.

## How sightings age (`backend/src/services/ports/client-aging.js`)

Each successful read is a full snapshot of one device's ports from one source.

| Situation | Result |
|---|---|
| Listed | `present`, `lastSeen` = the read |
| Left out, port link down | `gone` (`link-down`) at once |
| Left out, a static port now has another MAC | `gone` (`port-reassigned`) |
| Left out, port still up | one more miss; `unconfirmed` at `PORT_CLIENT_MISS_LIMIT` (2), `gone` (`omitted`) at twice that |
| Same MAC listed on another non-uplink port anywhere | old sighting `gone` (`moved`, pointing at the new port) |
| Read failed, device offline, not read | nothing changes; shown as **stale** once the last good read is older than twice the interval |

A switch ages a quiet MAC out of its table after about 5 minutes, so one miss
proves nothing; a link-down or a move does. Between reads, a `port.link.down`
event ends the port's sightings.

Port kind, unless the note overrides it: `uplink` (link to a managed device,
LAG member, or more than 16 MACs), `ap`, `static` (one client for 7 days),
`dynamic` (3+ clients in 7 days), `new`, `idle`, `unused` (no client for 30
days, after being watched that long).

Retention: `gone` sightings are pruned after `PORT_CLIENT_RETENTION_DAYS` (30),
except each port's newest one.

## Device merges

A source device's port notes move to the kept device. When the kept device
already has a note for the port, its empty fields are filled from the other
note and differing values are appended to its notes under
`[merged from <name>]` (`services/ports/port-note-merge.js`). Revisions move;
sightings and read states cascade away and are rebuilt by the next read.

## What the live captures showed (2026-11-10)

All reads were GET-only. Raw captures stay on the dev host, outside the repo. Fixtures were made with an allow-list scrubber: it keeps one MAC mapping across all sources (each MAC keeps its vendor prefix, the OUI, and gets a new device half), replaces hostnames, 802.1X user names, SSIDs, port descriptions and LLDP names, and makes wireless clients' profiles generic.

**AOS-CX REST** (Sw-CoreA 6300F, Sw-Studio 6200F, Lab-Edge0/1 6300F; `tests/fixtures/aos-cx-live/port-clients/`):
- `GET system/vlans/*/macs?depth=2` returns `{ <vlan>: { "<from>,<mac>": { mac_addr, from, port: { "<port>": ref }, inactivity_timeout: 300, network_infra_mac, ... } } }`. It took 30–330 ms per switch.
- The same MAC appears once per VLAN it was learned in (73 entries, 59 MACs on Sw-Studio), so de-duplicate per (port, MAC).
- `network_infra_mac` is true for every MAC learned on AP ports and switch links, and false on edge ports (including a phone). It is the switch's own uplink hint.
- MACs are also learned on non-physical ports (`vxlan1` on a VTEP, `lag3`). Store a LAG as its own port; skip tunnel ports.
- `GET system/vrfs/*/neighbors?depth=2` (ARP) returns `{ <vrf>: { "<ip>,<l3 port>": { ip_address, mac, port: { vlan10: ref }, phy_port: { "1/1/13": ref }, state } } }`.
  - `phy_port` names the physical port behind the VLAN interface.
  - Only the routing switch has most of the ARP entries: Sw-CoreA has 65, the access switch 7.
  - So IP enrichment has to be **fleet-wide**: a MAC seen on Sw-Studio gets its IP from Sw-CoreA's ARP.
- Ports seen:
  - Uplinks to inventory switches had 56 MACs.
  - AP ports (LLDP `WLAN`) had 8–13 MACs each: wireless clients bridged.
  - A non-inventory gateway (LLDP `Bridge, Router`) had 19 MACs, and a small switch (LLDP `Bridge`) had 3. A port whose LLDP neighbor bridges and isn't a phone is a downstream switch, so treat it as an uplink, whatever its MAC count.
  - A port with 13 MACs had an LLDP neighbor with no name and no capabilities, and two ports had 3–4 MACs and no LLDP (hypervisor trunks or unmanaged switches).
  - **Phone + PC** pairs (LLDP `Bridge, Telephone` plus a second MAC on the data VLAN) are on both test switches.
- Port descriptions are already meaningful on real switches ("IP Phone + USB-C dock", "Trunk to Core"). Show them next to the user's label, offer "use the device's description", and compare the two in phase 2.

**Aruba Central** (`GET /network-monitoring/v1alpha1/clients`, one page of 1000; `central-live/clients.json`):
- Each client carries `type` Wired|Wireless, `status`, `connectedTo` + `connectedDeviceSerial` + `port` (in the switch's own format: `2` on AOS-S, `1/1/4` on CX), `vlanId`, `connectedSince`, and `lastSeenAt` (`"0"` while connected).
- It also carries Central's **own client profiling**: `category` (e.g. "Computers & Servers"), `function` ("Remote Management"), `modelOs` ("HP iLO", "Cisco IP Phone", "Synology NAS"), `vendor`, `manufacturer`, `tags`, `hostName`, and `userName` (the 802.1X identity, often a person). This is the strongest identity evidence available.
- Central lists only edge clients: 34 of the 89 MACs in Sw-CoreA's table; the rest sit behind uplinks and AP ports.
- Every client Central called connected was in the switch's MAC table **on the same port** (34/34, 3/3).
- **Central's "Disconnected" is not absence:** 19 of 20 clients it called disconnected were still in the switch's MAC table, which only keeps MACs active in the last 5 minutes. Where the switch's own MAC table can be read, it decides presence, and Central adds identity. For a switch only Central can see (AOS-S under Central), Central's status is all there is.
- A hostname can be NUL-padded (`"Watch\u0000\u0000…"`); strip it.

**Juniper Mist** (`wired_clients/search`, `stats/devices` `clients`; `mist-live/wired-clients-search.json`, `mist-live/stats-devices-switch-clients.json`):
- `device_mac_port[]` carries the switch MAC, `port_id`, `vlan`, `ip`, `source` (lldp), and **`start`/`when`** (first and last seen on that port). The record also has `manufacture`, `random_mac`, `hostname[]` and `last_*`.
- The only lab EX was offline: a 7-day search still returned its last client, last seen 6 days earlier. **A cloud listing is not "present now"**. Take the sighting time from `when`, and search with a window of about two collection intervals.
- Mist lists infrastructure as wired clients too (the neighbor switch, via LLDP). Drop clients whose MAC is an inventory device's.

**Design changes these call for** (in addition to the sections above):
- `PortClient` gets `username` and a `profile` JSON (`{ category, function, os, vendor, source }`) in an additive migration, along with the collector.
- Source precedence:
  - Presence comes from the switch's own MAC table, then Mist (by `when`), then Central (by status).
  - Identity (hostname, profile, user) comes from the clouds, and IP from fleet-wide ARP, then clouds, then the host's `ip neigh`.
- Uplink rule: also a non-telephone bridging LLDP neighbor, and `network_infra_mac` from CX.
- The kept VLAN is the client's untagged/data VLAN when it was learned in several.

## The collector (`backend/src/services/ports/`)

One run (Bull queue `port-clients`, job `collect`, every `PORT_CLIENT_INTERVAL`, default 30 minutes):

1. **Read** every switch. `resolveTransport(device, 'clients')` routes like topology: local REST when the device has an IP, then the cloud, never SSH to a cloud-managed device.
   - AOS-CX REST: `CXSwitchAPI.getClientTables()` makes three GETs on one session (interfaces, MAC table, ARP), parsed by `parsers/aos-cx-clients.js`.
   - Each cloud's wired-client list is read **once per integration per run** and shared by its switches: `listWiredClients()`, capability `wired-clients`, parsed by `parsers/cloud-clients.js`.
     - Central walks `clientPages()`, the generator the address lookup now shares; it is capped at 20 pages of 1000 with a warning.
     - Mist searches `wired_clients/search` over the last two intervals.
   - Junos, AOS-S and IOS direct reads are empty rows in the transport matrix for now.
2. **Fleet-wide MAC to IP** from every switch's ARP table, then the clouds' client IPs.
3. **Per switch** (`client-merge.js`, then `client-aging.js`):
   - classify ports (uplink, AP, edge);
   - take presence from the switch's own MAC table when it was read, otherwise from the cloud;
   - enrich: cloud identity (hostname, 802.1X user, Central's profile, and Central's "connected since" when it is the same port), ARP IP, the LLDP identity of the client itself, and OUI vendor (never for a random MAC);
   - age the stored sightings, and write one transaction plus the `PortReadState` row.
4. **Moves**: a MAC present on exactly one edge port in this run ends its live sightings elsewhere.
5. **Retention**: gone sightings are pruned after `PORT_CLIENT_RETENTION_DAYS`, keeping each port's newest.

**Failures:**
- A failed switch read changes no sighting. It records `PortReadState(source: device-rest).error`.
- A cloud-managed switch whose REST read fails falls back to its cloud. That cloud then decides presence for the switch.

**Between runs:** `device-events.service.js` now has an in-process `events` emitter (`'recorded'`). A `port.link.down` event from the live monitor or the Mist stream ends that port's sightings at once.

**Writing JSON columns:** nullable JSON columns are written as SQL NULL (`Prisma.DbNull`), never JSON `null`.

**Socket events:**
- `ports:updated` (`{ deviceId }`) when a switch's sightings changed.
- `ports:collected` (the run summary) at the end of a run.

**Settings:** `PORT_CLIENTS_ENABLED` (default `true`), `PORT_CLIENT_INTERVAL` (`1800000`), `PORT_CLIENT_CONCURRENCY` (`4`), `PORT_CLIENT_MISS_LIMIT` (`2`), `PORT_CLIENT_RETENTION_DAYS` (`30`).

**First live runs (2026-11-10, dev DB copy):**
- 12 switches: 11 read and 1 failed (Agg1, offline), in about 2 seconds.
- 40 clients stored.
- The second run changed nothing: all 40 present, no misses.
- On Sw-CoreA, the AP ports hold only their AP, and the uplinks to Sw-Studio, Sw-Mgmt, Lab-Core, a small switch and a gateway hold only counts.
- Of the 40 clients, 35 have an IP (the core switch's ARP covers the access switch's clients), 35 have a Central profile (cameras, UPS, NAS, printer, IP phone, and so on), and 4 have their own LLDP identity.
- Sw-Mgmt (AOS-S, Central only) has Central's 4 connected clients.
- A hypervisor trunk (an LLDP neighbor with no name or capabilities) keeps its 12 VMs as clients.

## Progress

- [x] Data model: migration `20261110120000_port_identity` (additive: four new tables).
- [x] Aging rules, port kinds and freshness, with unit tests.
- [x] Device merge handles port notes.
- [x] Live captures (2026-11-10): AOS-CX MAC table and ARP on four switches, Central client list (two tenants), Mist wired clients; scrubbed fixtures committed (see "What the live captures showed").
- [x] Collection (2026-11-10): `clients` transport operation, AOS-CX REST tables, Central and Mist wired clients, fleet-wide ARP, port classes, moves, link-down hook, Bull job `port-clients`, migration `20261110130000_port_client_identity` (`username`, `profile`). Run live against the dev DB copy.
- [ ] Vendor names for MACs outside the ~55 curated Aruba/Juniper prefixes: a bundled IEEE OUI table (`scripts/update-oui.js`), shared with discovery.
- [ ] Watch the aging run for a few days on real data: misses for quiet clients, link-down, and a client moved by hand.
- [ ] API: `GET /devices/:id/ports`, note `PUT`/`DELETE`, `POST /devices/:id/ports/read`, `GET /ports/search`.
- [ ] UI: device page Ports tab, note dialog with evidence, labels on the Live/Neighbors tabs and the map, search.
- [ ] Phase 1b: Junos NETCONF, AOS-S and IOS SSH MAC/ARP parsers (spec-derived until hardware).
- [ ] Phase 1.5: alert rules for an unexpected or missing pinned client; Activity category.
- [ ] Phase 2 (design first): push a note's label to the port description (AOS-CX REST, Mist, Junos/AOS-S/IOS direct); NetHelper's first write to devices.
