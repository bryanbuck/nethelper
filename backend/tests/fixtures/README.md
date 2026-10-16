# Test fixtures

`central-devices.json` and `mist-*.json` follow the documented response shapes
of the Aruba Central `network-monitoring/v1alpha1/devices` endpoint and the Mist
org inventory and device-stats endpoints. They were written from the API specs,
not captured from a live tenant. When real captures are available (phase 7 of
the beta plan), replace them with redacted recordings. That is where
response-shape surprises will show up.

`aos-cx-live/` is different: trimmed **real captures** from an Aruba 6200F on
ML.10.16.1010 (2026-10-15), with port descriptions anonymised. They are the
REST responses behind `CXSwitchAPI.getPortState()` / `getInterfaceCounters()`
and the notification frames of a PoE phone being unplugged and replugged. See
`docs/archive/LIVE_STATE_CX_PROTOCOL_CHECK_2026-10-15.md`.
