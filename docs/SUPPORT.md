# NetHelper 0.9 beta: what's supported

NetHelper inventories network devices, tracks whether they're up, and backs up their configurations with change history. It works across vendors and across management planes: cloud-managed (Aruba Central, Juniper Mist) and direct (SSH, REST, NETCONF).

This page lists what works, what has been tested on real equipment, what isn't supported yet, and how to report a problem. Install NetHelper from [`deploy/README.md`](../deploy/README.md), then follow [`GETTING_STARTED.md`](GETTING_STARTED.md) for the first steps. Every setting is listed in [`CONFIGURATION.md`](CONFIGURATION.md).

## What's supported

| Platform | How NetHelper reaches it | Inventory | Status | Config backup | Connection test |
|---|---|---|---|---|---|
| Aruba Central (cloud) | New Central API (GreenLake API client), per integration | ✅ | ✅ | ⛔ see below | ✅ |
| Juniper Mist (cloud) | Mist API token, per org/region | ✅ | ✅ | ✅ switches/gateways (JSON snapshot, plus the Junos config over NETCONF when the switch has an IP and a credential); ⛔ APs | ✅ |
| AOS-CX switch (direct) | Device REST API | manual/discovery | ping | ✅ | ✅ |
| AOS-S switch (direct) | SSH CLI | manual/discovery | ping | ✅ | ✅ |
| Junos (direct) | NETCONF, falling back to SSH CLI | manual/discovery | ping | ✅ (`set` format) | ✅ |

Notes:

- **New Central only.** Create the API client in HPE GreenLake and pick your cluster (e.g. US-West-4 → `us4.api.central.arubanetworks.com`), or **Custom…** to type the API base URL of an unlisted (private) instance. Classic Central API gateway apps (`apigw-*` hosts) don't work.
- **Central config backup is not supported.** Central's classic configuration endpoints don't work on New Central tenants, so NetHelper reports "not supported" instead of faking it. An AOS-CX switch managed by Central is still backed up directly over its REST API, when it has an IP address and linked credentials.
- **Mist is intent-based.** Its "backup" is the device's configuration object, stored as sorted JSON so diffs are meaningful. It isn't a CLI running-config. Mist configures APs through templates, so there's no per-AP config to back up, and NetHelper says so. Link a device credential to a Mist-managed EX switch and its backup also holds the Junos `set` config, read over NETCONF (never SSH: Mist owns the switch). If NETCONF fails, the backup still succeeds from Mist and says why.
- **A Mist org token with read access is enough.** NetHelper never writes to Mist.
- **AOS-CX needs its REST API on.** On the switch: `https-server rest access-mode read-write` and `https-server vrf mgmt` (or `default`, whichever VRF NetHelper reaches it on), plus a dedicated account. Details and other switch-side facts: `docs/hardware/AOS_CX_NOTES.md`.
- **Junos NETCONF is off by default.** To use it, enable it with `set system services netconf ssh`. If you don't, NetHelper uses the SSH CLI automatically. (Mist enables it on switches it manages.)
- **The Junos account must be able to read the configuration.** A login class without `view-configuration` passes the connection test, but a config read returns `/* ACCESS-DENIED */` for every section. NetHelper treats that as a failed read: a direct switch's backup fails and names the denied sections, and a Mist-managed switch is backed up from Mist alone, with a warning on the backup. A good read-only class is `set system login class nethelper-ro permissions [ view view-configuration ]` (on a Mist-managed switch, add it through Mist's Additional CLI Commands). Even then Junos withholds a few hierarchies (on an EX4000: scripts, event-options, secret, extension-service); the backup keeps the rest and its warning names what's missing.
- **Status** comes from ICMP ping first, then from the device's cloud. A cloud-managed device that its cloud reports online but that doesn't answer NetHelper's ping shows **warning** (hover the status for why): it's up, but NetHelper has no route to it or ICMP is filtered. Its ping alert says the same ("is not answering ping"). The reverse also shows **warning**: a device its cloud reports offline whose address still answers ping. A cloud can keep an offline device's old IP after another device took it, so the ping may be answering for someone else. When NetHelper knows that other device (it holds the same address and can be answering), it stops pinging the offline one, which then shows **offline**, and its page names the device that has the address.
- **Cloud devices stay current on their own.** Devices sync from every cloud integration hourly, and their cloud status, IP, firmware and config state refresh every 5 minutes in between, so cloud-offline alerts open and clear without a manual **Sync**. A device Central reports **Out of sync** (not running the config Central intends) for more than 10 minutes gets a "Config out of sync" alert; turn the rule off under Settings → Alerts if you manage those switches outside Central on purpose. Intervals: `CLOUD_SYNC_INTERVAL`, `CLOUD_STATUS_INTERVAL` (see `docs/CONFIGURATION.md`).
- **Mist changes arrive within a minute or two.** NetHelper keeps a WebSocket open to each Mist org (outbound only, no public URL). A device coming back is seen at its next report, about a minute, and one that goes quiet is checked within a few minutes. Port link changes and restarts of Mist devices, and every cloud status change, are listed under the device's **Live** tab. Settings → Cloud Integrations shows whether the stream is connected. Central has no equivalent NetHelper can use without a public webhook endpoint, so Central devices stay on the 5-minute refresh.
- **Live port/PoE state (AOS-CX only).** The device page's **Live** tab shows each port's link, speed, PoE status and draw, throughput, and CPU/memory while it's open. Turn on **Always monitor** to record link and PoE changes as events even when nobody is watching. The switch pushes changes, so nothing needs configuring on it, and it works on Central-managed switches too (read-only, using the device's linked credentials and IP). Other platforms show "not available yet". Use a dedicated switch account for NetHelper: AOS-CX allows 6 REST sessions per user, and each monitored switch keeps one open.

### How much has been tested on real equipment

| Area | Evidence so far |
|---|---|
| AOS-CX REST (backup, Central-management detection, live state) | Run against a Central-managed 6200F on ML.10.16 (2026-10-15), including PoE and link changes. Backups over REST needed a fix found there: the switch refuses HTTP Basic auth. On 2026-10-20, a clean install backed up two 6300Fs (FL.10.16) and the 6200F, polled them, read their LLDP neighbors, and showed a one-line VLAN change in the backup diff |
| Central inventory sync | Inventory read verified against a live New Central tenant (2026-10-16, 14 devices); the first contact found the field mapping wrong (serial, status, last-seen) and it was fixed. Full syncs, the 5-minute status refresh, the "config out of sync" alert and 7 scope backups ran on clean installs (2026-10-20) |
| Cloud neighbors (Network Map) | Run against both live clouds (2026-10-19): Central's site topology placed four APs and a cloud-only AOS-S switch on their uplink ports, and Mist placed its AP on the EX's port; where a switch's own LLDP saw the same link, the two merged |
| Mist | Run against a live org (2026-10-19, an AP33 and an EX4000-12MP), powered off and then on: inventory sync (status flips to online, IP/firmware/last seen/config status filled, the cloud-offline alert auto-resolves), org and site scope backups (byte-stable across runs), a switch config-object backup, and the connection test reporting Mist's view when the switch can't be reached. First contact fixed the field mapping (site names, last seen, config status) and found a presigned S3 URL in WLANs that changed every read (now stripped). NETCONF to the Mist-managed EX also ran (same day): connection test, firmware/system polls, and LLDP neighbors (the AP and the core switch) all worked first time |
| Junos NETCONF / SSH | NETCONF run against an EX4000-12MP on 24.4R2.25 (Mist-managed, 2026-10-19): test, polls and LLDP worked; the config read showed that an account without `view-configuration` gets placeholders instead of an error (now detected, see below), and that the chassis MAC is in `fpc-mac-base` (fixed). With `view-configuration` added, a full backup ran (Junos `set` config + Mist's object, byte-stable on a repeat run), with four hierarchies Junos still withholds named in the backup's warning. On 2026-10-20 a change made in Mist showed up in both copies' diff. The SSH CLI fallback hasn't run on hardware yet |
| AOS-S SSH | Run against a 2930F on WC.16.11 (2026-10-20): connection test, firmware/system polls, LLDP neighbors, backup, and a diff of a removed VLAN. First contact found the CLI draws a VT100 screen (prompt and echo between cursor moves, so every command timed out) and that an operator login's `show running-config` error was stored as a backup; both are fixed. **The account needs manager rights** to read the configuration |
| Docker Compose / bare-metal packaging | Both installed from `deploy/README.md` on clean Debian 13 VMs (2026-10-20): Compose with the host-network override (discovery with MACs), an in-place upgrade, the Git mirror pushing to a private GitHub repo; bare metal with systemd, nginx and TLS, surviving a reboot. The run found and fixed several runbook bugs (see `CHANGELOG.md`). `deploy/install.sh`, the GHCR images and `nethelper-admin` (2026-10-21) are tested in CI against a stand-in for Docker, and have not yet been run on a real host |
| Cloud status and events (Mist) | An AP unplugged on 2026-10-20 showed offline about 3 minutes later (ping alert, then Mist's), and both alerts closed by themselves when it came back |

A mock follows the spec, but real equipment is where response-shape surprises show up. **Reports from real Mist orgs, Junos boxes, and AOS-S switches are the most useful thing you can send.**

- **Alerts can reach you outside the app.** An admin adds email recipients or a webhook (Slack, Teams, or any JSON receiver) under Settings → Notifications, with a minimum severity and optionally only some rules. Each channel gets one message when an alert opens and one when it resolves; **Test** sends a sample. A channel can also send the alarms Central and Mist raise themselves (**Also send cloud alarms**, optionally only named ones such as Port Flap); acknowledge and clear those in the cloud. Email needs `SMTP_HOST` on the server (`docs/CONFIGURATION.md`).
- **Device groups** are managed on the Devices page (**Groups**, and **Group** on a table selection). Automation triggers use them to pick devices.
- **Status history** is on each device page's **History** tab (ping and cloud status over the last day, week or month, with config backups and restarts marked). The dashboard shows current status.

## Not supported yet

- **Cisco Meraki and Catalyst.** They appear as "coming soon" and can't be configured. A Meraki device marked "direct" reports "no transport".
- **Pushing configuration, restore, or rollback.** Backups are read-only.
- **SSH key authentication to devices.** Only passwords, and no enable/privileged-mode escalation. (The Git mirror *can* use an SSH key.)
- **Automations are experimental.** Only some builder nodes run: Manual, Schedule and Alert triggers, Device Property and Alert Severity conditions, and Create Backup and Raise/Clear/Acknowledge Alert actions. Other nodes are marked "not runnable yet", and a workflow that uses them can be saved but not run or activated. Every run is listed under Automations → Run History.
- **Self-service account recovery.** There's no "forgot password". An admin resets it from the Users page, or on the server with `npm run user:manage`.
- **More than one backend instance per database.** The live monitor, alert settle timers and cloud event streams run in memory.
- **arm64 images.** The published images are amd64; on arm64, `install.sh --build` builds them on the host.

## Accounts and roles

There's no self-signup. The first admin is created on the server (see `deploy/README.md`), and admins add everyone else on the **Users** page. Everyone can change their own password from the account menu (top right). Passwords are at least 12 characters.

| Role | Can |
|---|---|
| Viewer | See inventory, status, discovery results, and backup history (not backup contents) |
| Operator | Everything a viewer can, plus: add and edit devices and their credentials, run discovery, backups, and connection tests, view and diff backup contents |
| Admin | Everything an operator can, plus: manage users, cloud integrations, and the Git mirror; delete devices, backups, and scans |

Deleting a user keeps everything they set up (integrations, credentials, the Git mirror config, automations). Ownership moves to the admin who deleted them.

## Reporting a problem

Open an issue at [github.com/bryanbuck/nethelper/issues](https://github.com/bryanbuck/nethelper/issues). For a security problem, don't open an issue: see [`SECURITY.md`](../SECURITY.md). Include:

1. **What you did and what happened**, including the exact error text or a screenshot.
2. **The version.** It's in the page footer (for example `NetHelper 0.9.0-beta.6`), and `GET /health` returns it too.
3. **Which platform and management plane**: for example "AOS-S 2930F, direct over SSH" or "Mist switch EX4100".
4. **Backend logs from around that time**:
   - Docker: `docker compose logs --since 30m backend`
   - Bare metal: `journalctl -u nethelper-backend --since "30 min ago"`

   Logs mask values under password, token, secret, and similar keys. Still skim them before sending, and **never send backup contents**: device configs contain secrets.
5. For device problems, the result of **Test connection** on the device's page.

For a problem with a real device's response format, a copy of the raw response with secrets removed is the fastest way to a fix. Issues are public: remove hostnames, addresses and serials you don't want to share.
