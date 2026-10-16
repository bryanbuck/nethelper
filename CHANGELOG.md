# Changelog

All notable changes to NetHelper. Versions follow [Semantic Versioning](https://semver.org/); pre-1.0 releases may change behavior between minor versions.

## [0.9.0-beta.1] — unreleased

First packaged release, for a private in-house beta. Covers everything built so far, hardened and packaged for deployment. See [`docs/BETA_NOTES.md`](docs/BETA_NOTES.md) for scope and known limitations.

### Features
- Multi-vendor inventory and status across cloud planes (Aruba Central, Juniper Mist; several integrations at once, including several tenants of one provider) and directly managed devices (AOS-CX REST, AOS-S SSH, Junos NETCONF with SSH fallback).
- Configuration backups: scheduled and on-demand, SHA-256 change detection, unified diffs, retention, and an optional Git mirror.
- Network discovery (nmap sweep, MAC OUI and port fingerprinting, cross-check against cloud inventory).
- ICMP status monitoring for directly managed devices.
- Users page for admins (create, change role, reset password, delete), and self-service password change.
- Automation builder (**experimental**).

### Security
- No self-signup: `POST /auth/register` is admin-only and issues no tokens. First admin: `npm run user:manage -- create-admin`.
- Passwords at least 12 characters; failed login/refresh/change-password attempts are rate-limited; login timing no longer reveals whether an account exists; logout and password changes revoke refresh tokens.
- Startup configuration validation; no fallback encryption key; `npm run key:rotate` to re-encrypt stored secrets.
- CORS from configuration, not hardcoded hosts; `TRUST_PROXY`; smaller body limit; 5xx details hidden in production.
- Backup contents (full device configs) restricted to admins and operators; log redaction of secret-looking fields; Git mirror settings validated against command injection.
- Deleting a user no longer cascade-deletes the cloud integrations, credentials, and Git mirror config they created; ownership moves to another admin.

### Deployment
- Docker images for backend and frontend, Docker Compose stack (with a host-network option for L2 discovery), and a sandboxed systemd unit plus TLS nginx site for bare metal. Runbook: [`deploy/README.md`](deploy/README.md).
- `GET /health/ready` (database and Redis), migrations applied automatically on start, JSON logs to stdout in production, size-rotated log files.

### Fixed
- Aruba Central authentication: tokens now come from HPE GreenLake (Central-scoped API clients, or GreenLake-platform clients with a Workspace ID) instead of a request no Central endpoint accepted. The base URL is a New Central cluster picker; Classic `apigw-*` hosts are rejected with an explanation. The Customer ID field is gone.
- The device Add/Edit forms no longer drop the linked device credential when a device is cloud-managed. Central-managed AOS-CX switches need it for read-only local config backup and live state.
- The real-time connection no longer piles up duplicate sockets after a backend restart or network blip. One stale socket could leave the app thinking it was connected with no socket at all, so the Live tab reported "Real-time connection is not available". Reconnects also send the current login token.
- Aruba Central inventory: devices are read with the field names the live API actually uses. Before, every device came back offline with no serial, so cloud status was always "offline" and sync couldn't match devices. Switch platform is also taken from the firmware version.
- Cloud sync no longer clears a device's last-seen time when Central doesn't report one, and skips (rather than crashes on) an item without a serial.
- Cloud integration tests show the provider's own error (request, HTTP status, error code and message, suggested fixes) on the integration card, not just a toast.

### Removed
- Demo and mock data (fake devices, simulated WebSocket events, random dashboard series), placeholder pages, and the non-functional forgot-password flow.

### Fixed
- `GET /devices/groups` was unreachable (shadowed by `GET /devices/:deviceId`).
- The API-credential "Test" button reported success without contacting the device.
- Device serial numbers are optional; several devices without one can coexist.
