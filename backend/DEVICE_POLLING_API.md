# Device Polling API

On-demand reads straight from devices, outside any cloud provider. The service is `src/services/device-poller.service.js`. The frontend uses it through `frontend/src/services/device.service.js`, for example on the Firmware Status page.

## Endpoints

| Method | Path | Role | |
|---|---|---|---|
| `GET` | `/api/v1/devices/poll/pollers` | viewer+ | `{ success, pollers: ['firmware', 'system', 'backup', 'login-sessions', 'central-status'] }` |
| `POST` | `/api/v1/devices/poll` | operator+ | Body `{ poller, deviceIds: [uuid, ...] }` |

`POST /devices/poll` polls every device in parallel and always answers 200 once the poller exists. Each device succeeds or fails on its own:

```json
{
  "success": true,
  "poller": "firmware",
  "summary": { "total": 2, "successful": 1, "failed": 1 },
  "results": [
    { "deviceId": "…", "success": true, "data": { "primary_version": "ML.10.16.1010" }, "timestamp": "…" },
    { "deviceId": "…", "success": false, "error": "No credentials found for device sw2", "timestamp": "…" }
  ]
}
```

A device fails before its poller runs if it has no IP address or no linked device credential (`ApiCredential`). A missing `poller` or an empty `deviceIds` returns 400, and an unknown poller name returns an error that lists the available ones.

## Pollers

| Poller | Platforms | Transport |
|---|---|---|
| `firmware` | Any device with a local transport | `resolveTransport(device, 'poll')`: AOS-CX REST, Junos NETCONF, else SSH `show version` where the matrix lists SSH |
| `system` | Same as firmware | Same as firmware |
| `backup` | AOS-CX switches only | AOS-CX REST |
| `login-sessions` | AOS-CX switches only | AOS-CX REST (`/system/users`) |
| `central-status` | AOS-CX switches only | AOS-CX REST (`system/aruba_central`, then `hpe_anw_central` on 10.15+) |

- A cloud-managed device is never SSHed. If neither CX REST nor NETCONF can reach it, `firmware` and `system` fail with "No local transport can poll …", and its versions come from cloud sync instead.
- Every AOS-CX read runs in one cookie session (`withCxSession`: login, read, logout), because AOS-CX REST refuses HTTP Basic auth and allows only a few sessions per user. See `docs/hardware/AOS_CX_NOTES.md`.
- The CX-only pollers refuse other platforms rather than try a CX login on them. Config backups for every platform go through `config-backup.service.js` `pullConfig()`, not this poller.

### Result fields

- **`firmware`**
  - AOS-CX: `booted_image`, `current_image`, `default_image`, `primary_version`, `secondary_version`.
  - Junos: `transport: 'netconf'`, `primary_version`, `model`, `hostname`.
  - SSH: `transport: 'ssh'`, `raw_version` (the `show version` text), and `primary_version` parsed best-effort from it.
- **`system`**: `hostname`, `platform`, `software_version` and related fields. The transport is reported the same way as for `firmware`.
- **`backup`**:
  - `running_config` and `startup_config`: REST JSON.
  - `running_config_cli`: `show running-config` text. It is best-effort; when it can't be read, `running_config_cli_error` says why.
  - `backed_up_at`.
- **`login-sessions`**: `users`, `session_count`, `polled_at`. Firmware without that resource fails with a hint to use `show users`.
- **`central-status`**: `enabled`, `connectionStatus`, `mode`, `centralManaged` (`true`/`false`/`null` = can't tell), `location`, `source`, `raw`. Connection tests and config backups also run this probe best-effort (`refreshCentralStatus`), and it stores the result on the device as `cloudManagedSource: 'switch-rest'`.

## Adding a poller

Register it in the constructor (`this.registerPoller('name', fn)`). `fn(device, credentials)` receives the device row and the decrypted credential. Route its transport through `resolveTransport`, or refuse platforms it can't serve, as the CX-only pollers do.
