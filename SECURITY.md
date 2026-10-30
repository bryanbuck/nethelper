# Security

## Reporting a vulnerability

Please don't open a public issue for a security problem.

Use GitHub's private vulnerability reporting on this repository (**Security → Report a vulnerability**).

Include the version (page footer, or `GET /health`), what an attacker can do, and the steps to reproduce. Leave out real device configs and credentials: describe them, or send a redacted copy.

## Supported versions

Only the latest release gets fixes while NetHelper is at 0.x.

## Security model

What NetHelper protects, so you can judge a report or a deployment:

- **Secrets at rest**: device credentials, cloud API secrets and Git mirror credentials are encrypted in the database with `ENCRYPTION_KEY` (AES-256-GCM), and the API never returns them unmasked. There is no default key; changing it requires `npm run key:rotate`.
- **Config backups contain secrets** (device configs hold password hashes, SNMP communities, RADIUS keys). Their contents are visible only to admins and operators. The flat backup files and the Git mirror are not encrypted, so protect the data volume and keep the mirror's repository private. Cloud-scope backups replace secrets with keyed fingerprints.
- **Accounts**: no self-signup; admins create users. Passwords are bcrypt-hashed, at least 12 characters, and login, refresh and password-change attempts are rate-limited. Logging out revokes the refresh token; an access token already issued stays valid until it expires (`JWT_EXPIRES_IN`, default 1 hour). Changing a password or an admin reset ends every session at once: the refresh token is revoked, and access tokens already issued and open real-time connections are refused, because each token carries the user's session version.
- **Read-only toward devices and clouds**: NetHelper never writes configuration to a device or a cloud. Use device accounts with only the rights listed in [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md).
- **Transport**: the Docker install serves plain HTTP; put TLS in front of it anywhere but a trusted management network ([`deploy/README.md`](deploy/README.md) → TLS). The bare-metal nginx site is TLS-only.
- **Logs** mask values under secret-looking keys. Still review logs before sharing them.
- **One instance per database**: the live monitor and alert settle timers are in memory.

Out of scope: attacks that need an admin account, or shell access to the NetHelper host.
