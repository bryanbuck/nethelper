# Configuration reference

Most of NetHelper is configured in the app:

- **Cloud integrations**: Settings → Cloud Integrations
- **Device credentials**: Settings → Credentials
- **Backup schedules**: Config Backups → Schedules
- **The Git mirror**: Settings, admin only
- **Users**: the Users page

The backend's environment covers only what has to be known at startup: secrets, connections, and limits.

Where environment settings live:

- **Docker Compose**: `deploy/.env`, passed through `deploy/docker-compose.yml`. Compose sets the connection settings itself.
- **Bare metal**: `/etc/nethelper/backend.env`. Start from `backend/.env.example`; the systemd unit sets the paths and bind address.
- **Development**: `backend/.env` and `frontend/.env`.

`backend/src/config/env.js` validates the environment at startup. A missing required value always stops the server. A weak or placeholder secret stops it in production and prints a warning in development.

## Backend

### Required

| Variable | Notes |
|---|---|
| `DATABASE_URL` | `postgresql://user:password@host:5432/db?schema=public`. Use a URL-safe (hex) password. |
| `JWT_SECRET` | Signs access tokens. At least 32 characters. |
| `JWT_REFRESH_SECRET` | Signs refresh tokens. At least 32 characters, and different from `JWT_SECRET`. |
| `ENCRYPTION_KEY` | Encrypts stored device, cloud, and Git credentials. At least 32 characters. **Back it up separately from the database**: without it the stored credentials can't be decrypted. To change it, see "Rotating the encryption key" in `deploy/README.md`. |

Generate secrets with `openssl rand -hex 32`.

### Server

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `production` for any real install. It enforces strong secrets, hides 5xx details, and logs JSON. |
| `PORT` | `3000` | |
| `BIND_ADDRESS` | `0.0.0.0` | `127.0.0.1` when nginx runs on the same host. |
| `API_PREFIX` | `/api/v1` | The SPA and nginx assume the default. |
| `TRUST_PROXY` | *(off)* | Number of proxy hops in front of the backend, `true`, or an Express value like `loopback`. Set it behind nginx so rate limits and logs see real client IPs. |
| `CORS_ORIGINS` | *(empty)* | Comma-separated browser origins allowed to call the API. Not needed when nginx serves the UI on the same origin. Development also allows localhost, private-LAN, and `.local` origins. |
| `FRONTEND_URL` | *(empty)* | Legacy; treated as one more allowed origin. |
| `BODY_LIMIT` | `2mb` | Maximum request body. |

### Redis

| Variable | Default |
|---|---|
| `REDIS_HOST` | `localhost` |
| `REDIS_PORT` | `6379` |
| `REDIS_PASSWORD` | *(none)* |

### Sessions and rate limits

| Variable | Default | Notes |
|---|---|---|
| `JWT_EXPIRES_IN` | `1h` | Access token lifetime. |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Refresh token lifetime. Logout and password changes revoke it earlier. |
| `RATE_LIMIT_WINDOW` | `15` | Minutes. |
| `RATE_LIMIT_MAX_REQUESTS` | `1000` | Requests per window across `/api`, counted per signed-in user (per client IP for requests without a valid token). It catches a runaway client, not attackers (failed logins have their own limit below): one person's busiest 15 minutes measured about 150 requests, and every tab a user has open counts toward the same total. A limited request gets a JSON 429 with `Retry-After`. |
| `AUTH_RATE_LIMIT_MAX` | `10` | **Failed** login, refresh, and change-password attempts per IP per window. |

### Logging

| Variable | Default | Notes |
|---|---|---|
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, `http`, `verbose`, `debug`, or `silly`. |
| `LOG_FILES` | `true` | `false` sends logs to stdout only. The Docker image sets `false`. |
| `LOG_DIR` | `logs` | Holds `error.log`, `combined.log`, and `services-*.log`. Each rotates at 10 MB, keeping 5. |
| `SERVICE_LOG_LEVELS` | *(empty)* | Per-area levels, e.g. `ARUBA_CENTRAL:debug,AUTH:warn`. |
| `DEBUG_SERVICES` | *(all)* | Comma-separated areas to log. |

Production writes JSON logs to stdout. Values under secret-looking keys (password, token, secret, apiKey, ...) are masked.

### Monitoring, discovery, device access

| Variable | Default | Notes |
|---|---|---|
| `PING_MONITOR_ENABLED` | `true` | ICMP status checks for directly managed devices. |
| `PING_MONITOR_INTERVAL` | `60000` | Milliseconds between sweeps. |
| `PING_MONITOR_TIMEOUT` | `5` | Seconds per ping. |
| `PING_MONITOR_BATCH_SIZE` | `20` | Devices pinged concurrently. |
| `PING_MONITOR_FAILURE_THRESHOLD` | `3` | Consecutive failures before a device is marked offline. |
| `DISCOVERY_SCAN_TIMEOUT` | `300000` | Milliseconds allowed per nmap run. |
| `SSH_PORT` | `22` | SSH CLI transport (AOS-S, Junos fallback, IOS-XE). |
| `NETCONF_PORT` | `830` | Junos NETCONF. |
| `SSH_CONNECT_TIMEOUT` | `15000` | Milliseconds; SSH and NETCONF. |
| `SSH_COMMAND_TIMEOUT` | `45000` | Milliseconds; SSH and NETCONF. |

### Live port/PoE state

| Variable | Default | Notes |
|---|---|---|
| `LIVE_MONITOR_ENABLED` | `true` | Always-on monitoring of devices with live monitoring turned on. The Live tab works either way. |
| `LIVE_STATE_POLL_INTERVAL` | `60000` | Milliseconds between state reads for platforms without push. |
| `LIVE_RESYNC_INTERVAL` | `600000` | Milliseconds between full re-reads of push devices. Also keeps the switch's REST session alive; keep it below the switch's session idle timeout (AOS-CX default 20 minutes). |
| `LIVE_SESSION_MAX_AGE` | `21600000` | Milliseconds before a device's session and stream are replaced. AOS-CX ends sessions after 480 minutes. |
| `LIVE_VIEW_POLL_INTERVAL` | `15000` | Milliseconds between counter samples while a Live tab is open (minimum 5000). |
| `LIVE_MAX_CONNECTIONS` | `200` | Devices watched at once per backend process. |
| `DEVICE_EVENT_RETENTION_DAYS` | `30` | Live-state events older than this are deleted daily. |

### Alerts and automations

| Variable | Default | Purpose |
|---|---|---|
| `ALERT_RETENTION_DAYS` | `90` | Resolved alerts older than this are deleted daily. |
| `EXECUTION_RETENTION_DAYS` | `90` | Finished automation runs (Run History) older than this are deleted daily. |

### Cloud sync and status

| Variable | Default | Notes |
|---|---|---|
| `CLOUD_SYNC_ENABLED` | `true` | Scheduled full device sync from every active cloud integration. **Sync** on the Devices page works either way. |
| `CLOUD_SYNC_INTERVAL` | `3600000` | Milliseconds between scheduled syncs (1 hour; minimum 300000). Only failures reach the status bar. |
| `CLOUD_STATUS_ENABLED` | `true` | Status refresh between syncs: status, IP, firmware, connection and config state for devices sync already created. Never adds devices. |
| `CLOUD_STATUS_INTERVAL` | `300000` | Milliseconds between refreshes (5 minutes; minimum 60000). Mist: one API call per 1,000 devices; Central: one per 100. |
| `CLOUD_STREAM_ENABLED` | `true` | Juniper Mist event stream: one outbound WebSocket per Mist org. A device starting or stopping reporting triggers the status refresh at once (at most every 30 s per org), and port link changes and restarts are recorded as device events. Needs outbound HTTPS to `api-ws.<region>.mist.com`. |

### Network Map (topology)

| Variable | Default | Notes |
|---|---|---|
| `TOPOLOGY_ENABLED` | `true` | Scheduled LLDP/CDP neighbor collection. "Refresh topology" on the map works either way. |
| `TOPOLOGY_INTERVAL` | `21600000` | Milliseconds between scheduled collections (6 hours; minimum 300000). |
| `TOPOLOGY_CONCURRENCY` | `4` | Devices read at once. Each holds one session on its device while it is read. |
| `TOPOLOGY_CHANGE_RETENTION_DAYS` | `90` | Link changes older than this, and links not seen for this long, are deleted after each collection. |

### Config backups

| Variable | Default | Notes |
|---|---|---|
| `BACKUP_STORAGE_PATH` | `backend/storage/config-backups` | Flat config files (authoritative). Docker: `/data/config-backups`. Bare metal: `/var/lib/nethelper/config-backups`. |
| `BACKUP_GIT_REPO_PATH` | `backend/storage/config-repo` | Default Git mirror repository, used when the in-app setting is blank. |
| `BACKUP_GIT_TIMEOUT_MS` | `60000` | Per git command. |
| `BACKUP_GIT_KNOWN_HOSTS` | `git-known_hosts` next to `BACKUP_GIT_REPO_PATH` | Where the Git mirror's ssh remembers an SSH remote's host key (accepted on first use; pre-fill it to pin the key). `~/.ssh/known_hosts` is still read. Docker: `/data/git-known_hosts`. |

### Optional integrations

| Variable | Notes |
|---|---|
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Email notifications; turned on when `SMTP_HOST` and `SMTP_USER` are set. |
| `SLACK_WEBHOOK_URL` | Slack notifications. |
| `ARUBA_CENTRAL_BASE_URL`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_WORKSPACE_ID` | **Legacy.** When no cloud integration exists and the first two are set, a single Central integration is built from these (a New Central cluster URL and a GreenLake API client; `_WORKSPACE_ID` only for a GreenLake-platform client). `_CUSTOMER_ID` is no longer used. Prefer Settings → Cloud Integrations. |

### Scripts and containers only

| Variable | Used by |
|---|---|
| `RUN_MIGRATIONS` | Docker entrypoint. Default `true`; `false` skips `prisma migrate deploy` on start. |
| `NETHELPER_ADMIN_PASSWORD` | `npm run user:manage -- create-admin`, and the first admin that `deploy/install.sh` or `nethelper-admin users create-admin` creates (read from your shell's environment). If unset, a password is generated and printed once. |
| `OLD_ENCRYPTION_KEY` | `npm run key:rotate` and `nethelper-admin rotate-key`. |

## Docker Compose (`deploy/.env`)

| Variable | Default | Notes |
|---|---|---|
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` | *(required)* | Compose refuses to start if any is empty. `install.sh` generates any that are empty. |
| `POSTGRES_DB`, `POSTGRES_USER` | `nethelper` | |
| `NETHELPER_VERSION` | *(unset)* | Pins the image tag and the version shown in the UI. Unset, it follows the tree: `docker-compose.yml`'s default is the tree's `VERSION`. |
| `NETHELPER_REGISTRY` | `ghcr.io/bryanbuck` | Where the release images are pulled from. Local builds get the same name. |
| `COMPOSE_FILE` | *(unset)* | Compose's own variable: set to include `docker-compose.host-network.yml` for L2 discovery (`install.sh --host-network` does it). |
| `HTTP_BIND`, `HTTP_PORT` | `0.0.0.0`, `8080` | Where the UI is published. |
| `TRUST_PROXY` | `1` | `2` behind an extra TLS proxy. |
| `CORS_ORIGINS`, `LOG_LEVEL`, `PING_MONITOR_ENABLED` | | Passed through to the backend. |

## Frontend

The SPA is configured at build time, and the defaults suit every supported deployment: it calls the API and WebSocket on its own origin.

| Variable | Default | Notes |
|---|---|---|
| `VITE_API_URL` | `/api/v1` | Only change it if the API is on a different origin (then set `CORS_ORIGINS`). |
| `VITE_WS_URL` | page origin | |
| `VITE_APP_VERSION` | `package.json` version | Set it in the build environment to override. |
| `VITE_DEBUG_LOGGING` | `false` | Verbose browser console logging in a production build. |
| `DEV_PROXY_TARGET`, `DEV_ALLOWED_HOSTS` | | Vite dev server only (`frontend/.env`). They never reach the bundle. |
