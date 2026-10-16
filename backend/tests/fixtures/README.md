# Test fixtures

`central-devices.json` follows the shape of a **live** New Central
`network-monitoring/v1alpha1/devices` response (captured 2026-10-16, values
anonymised). It replaced a spec-derived fixture that turned out to be wrong:
the live API sends `serialNumber`, `status` `ONLINE`/`OFFLINE`, `lastSeenAt`
(ISO, null while online) and `uptimeInMillis`, and rejects filters on `serial`.

`mist-*.json` follow the documented response shapes of the Mist org inventory
and device-stats endpoints. They were written from the API specs, not captured
from a live tenant. When real captures are available (phase 7 of the beta
plan), replace them with redacted recordings. That is where response-shape
surprises will show up.

`mist-scope.json` is spec-derived too: the org/site objects behind
`MistProvider.getScopeConfiguration()` (scope backups).

`central-scope.json` follows **live** New Central `network-config/v1alpha1`
responses (captured 2026-10-16, values anonymised). `scopeMapsText` is kept as
raw text because Central sends `scope-id` as a JSON number above 2^53; the
test parses it the way the provider does.

`aos-cx-live/` is different: trimmed **real captures** from an Aruba 6200F on
ML.10.16.1010 (2026-10-15), with port descriptions anonymised. They are the
REST responses behind `CXSwitchAPI.getPortState()` / `getInterfaceCounters()`
and the notification frames of a PoE phone being unplugged and replugged. See
`docs/archive/LIVE_STATE_CX_PROTOCOL_CHECK_2026-10-15.md`.
