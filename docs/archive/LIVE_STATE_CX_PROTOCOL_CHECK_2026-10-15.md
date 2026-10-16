# AOS-CX live state: protocol check on hardware (2026-10-15)

Point-in-time record of "Step 0" for the live port/PoE state work: what an
AOS-CX switch actually does, observed before and while building
`services/live/`. The design that came out of it is in
`docs/MULTI_VENDOR_ROADMAP.md` §8c. Trimmed captures are the fixtures in
`backend/tests/fixtures/aos-cx-live/`.

**Reference switch:** Aruba 6200F 12G Class4 PoE, ML.10.16.1010, managed by
Aruba Central (local configuration locked), dedicated read-write REST account.

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
  port plus the PoE wildcard.
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
