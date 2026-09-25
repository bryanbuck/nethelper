# NetHelper 0.9 beta: tester notes

NetHelper inventories network devices, tracks whether they're up, and backs up their configurations with change history. It works across vendors and across management planes: cloud-managed (Aruba Central, Juniper Mist) and direct (SSH, REST, NETCONF).

This is a **private, in-house beta**. Install it from [`deploy/README.md`](../deploy/README.md). Every setting is listed in [`CONFIGURATION.md`](CONFIGURATION.md).

## What's supported

| Platform | How NetHelper reaches it | Inventory | Status | Config backup | Connection test |
|---|---|---|---|---|---|
| Aruba Central (cloud) | Central API (OAuth), per integration | ✅ | ✅ | ⛔ see below | ✅ |
| Juniper Mist (cloud) | Mist API token, per org/region | ✅ | ✅ | ✅ switches/gateways (JSON snapshot); ⛔ APs | ✅ |
| AOS-CX switch (direct) | Device REST API | manual/discovery | ping | ✅ | ✅ |
| AOS-S switch (direct) | SSH CLI | manual/discovery | ping | ✅ | ✅ |
| Junos (direct) | NETCONF, falling back to SSH CLI | manual/discovery | ping | ✅ (`set` format) | ✅ |

Notes:

- **Central config backup is not supported.** Central's classic configuration endpoints don't work on New Central tenants, so NetHelper reports "not supported" instead of faking it. An AOS-CX switch managed by Central is still backed up directly over its REST API, when it has an IP address and linked credentials.
- **Mist is intent-based.** Its "backup" is the device's configuration object, stored as sorted JSON so diffs are meaningful. It isn't a CLI running-config. Mist configures APs through templates, so there's no per-AP config to back up, and NetHelper says so.
- **Junos NETCONF is off by default.** To use it, enable it with `set system services netconf ssh`. If you don't, NetHelper uses the SSH CLI automatically.
- **Status** for directly managed devices comes from ICMP ping. For cloud devices it comes from the provider.

### How much has been tested on real equipment

| Area | Evidence so far |
|---|---|
| AOS-CX REST (backup, Central-management detection) | Run against live hardware during development |
| Central inventory sync | Built against the live New Central API; two tenants tested side by side |
| Mist | Only against a mock built from Mist's API documentation |
| Junos NETCONF / SSH | Only against a mock SSH/NETCONF server |
| AOS-S SSH | No recorded hardware run |
| Docker Compose / bare-metal packaging | Not yet run on a clean host |

A mock follows the spec, but real equipment is where response-shape surprises show up. **Reports from real Mist orgs, Junos boxes, and AOS-S switches are the most useful thing you can send.**

## Not supported in this beta

- **Cisco Meraki and Catalyst.** They appear as "coming soon" and can't be configured. A Meraki device marked "direct" reports "no transport".
- **Pushing configuration, restore, or rollback.** Backups are read-only.
- **SSH key authentication to devices.** Only passwords, and no enable/privileged-mode escalation. (The Git mirror *can* use an SSH key.)
- **Automations are experimental.** The builder and runs exist, but schedules and execution history pages don't yet.
- **Status history.** The dashboard shows current status only.
- **Self-service account recovery.** There's no "forgot password". An admin resets it from the Users page, or on the server with `npm run user:manage`.

## Accounts and roles

There's no self-signup. The first admin is created on the server (see `deploy/README.md`), and admins add everyone else on the **Users** page. Everyone can change their own password from the account menu (top right). Passwords are at least 12 characters.

| Role | Can |
|---|---|
| Viewer | See inventory, status, discovery results, and backup history (not backup contents) |
| Operator | Everything a viewer can, plus: add and edit devices and their credentials, run discovery, backups, and connection tests, view and diff backup contents |
| Admin | Everything an operator can, plus: manage users, cloud integrations, and the Git mirror; delete devices, backups, and scans; run device commands |

Deleting a user keeps everything they set up (integrations, credentials, the Git mirror config, automations). Ownership moves to the admin who deleted them.

## Reporting a problem

Send reports to the NetHelper admin who invited you. Include:

1. **What you did and what happened**, including the exact error text or a screenshot.
2. **The version.** It's in the page footer (for example `NetHelper 0.9.0-beta.1`), and `GET /health` returns it too.
3. **Which platform and management plane**: for example "AOS-S 2930F, direct over SSH" or "Mist switch EX4100".
4. **Backend logs from around that time**:
   - Docker: `docker compose logs --since 30m backend`
   - Bare metal: `journalctl -u nethelper-backend --since "30 min ago"`

   Logs mask values under password, token, secret, and similar keys. Still skim them before sending, and **never send backup contents**: device configs contain secrets.
5. For device problems, the result of **Test connection** on the device's page.

For a problem with a real device's response format, a copy of the raw response with secrets removed is the fastest way to a fix.
