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

## Progress

- [x] Data model: migration `20261110120000_port_identity` (additive: four new tables).
- [x] Aging rules, port kinds and freshness, with unit tests.
- [x] Device merge handles port notes.
- [ ] Live captures: AOS-CX MAC table (`system/vlans/*/macs`) and ARP (`system/vrfs/*/neighbors`) on the 6200F/6300F; Mist `wired_clients/search`; Central wired clients.
- [ ] Collection: `clients` operation in the transport matrix, AOS-CX REST, Mist and Central readers, Bull job `port-clients`, enrichment (IEEE OUI table), link-down hook.
- [ ] API: `GET /devices/:id/ports`, note `PUT`/`DELETE`, `POST /devices/:id/ports/read`, `GET /ports/search`.
- [ ] UI: device page Ports tab, note dialog with evidence, labels on the Live/Neighbors tabs and the map, search.
- [ ] Phase 1b: Junos NETCONF, AOS-S and IOS SSH MAC/ARP parsers (spec-derived until hardware).
- [ ] Phase 1.5: alert rules for an unexpected or missing pinned client; Activity category.
- [ ] Phase 2 (design first): push a note's label to the port description (AOS-CX REST, Mist, Junos/AOS-S/IOS direct); NetHelper's first write to devices.
