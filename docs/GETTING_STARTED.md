# Getting started

Your first hour with NetHelper, after it's installed ([`deploy/README.md`](../deploy/README.md)) and the first admin exists. What each platform supports, and known limits: [`BETA_NOTES.md`](BETA_NOTES.md).

## Before you start

Have these ready:

- **Cloud API access**, if your devices are cloud-managed:
  - **Aruba Central** (New Central only): an API client from HPE GreenLake (client ID and secret; a Workspace ID for a GreenLake-platform client), and your cluster (e.g. US-West-4).
  - **Juniper Mist**: an org API token with read access, and the org's region.
- **A device account for NetHelper** on each directly reached device, with the rights in the table below. Give NetHelper its own account rather than reusing a person's.
- **Network reach** from the NetHelper host to the devices' management addresses: ICMP for status; HTTPS (AOS-CX REST) or SSH port 22 (AOS-S, Junos NETCONF/CLI) for backups and tests.

| Platform | Account needs | Also on the device |
|---|---|---|
| AOS-CX | A dedicated local user. Read-only has not been confirmed for every feature yet; an administrator account is known to work | `https-server rest access-mode read-write`, `https-server vrf <vrf>` on the VRF NetHelper reaches |
| AOS-S | **Manager** level. An operator login can't read `running-config` | SSH enabled |
| Junos | A login class with `view` and `view-configuration`, e.g. `set system login class nethelper-ro permissions [ view view-configuration ]` | `set system services netconf ssh` (otherwise NetHelper falls back to the SSH CLI). On a Mist-managed switch, add the class through Mist's Additional CLI Commands |
| Central / Mist | Nothing on the device: NetHelper asks the cloud | |

Switch-side details found on real hardware: [`hardware/AOS_CX_NOTES.md`](hardware/AOS_CX_NOTES.md), [`hardware/AOS_S_NOTES.md`](hardware/AOS_S_NOTES.md).

## 1. Sign in and secure your account

Sign in with the admin the install created, then change its password from the account menu (top right). Passwords are at least 12 characters.

## 2. Connect your clouds

**Settings → API Credentials → Cloud Integrations → Add Integration.** Pick the provider, enter the credentials, then **Test**. A failed test shows the provider's own error on the card.

Then go to **Devices** and click **Sync**. Every device the cloud knows appears with its vendor, model, IP, firmware and cloud status. After that, NetHelper syncs hourly and refreshes cloud status every 5 minutes by itself.

## 3. Add directly managed devices

Either:

- **Devices → Add Device**: name, IP, vendor and platform; or
- **Discovery**: scan a subnet you're allowed to scan, then **Import** the hosts you want. Only scan networks you're responsible for.

A cloud-managed AOS-CX or Mist-managed EX switch can be read directly too (config backups, LLDP neighbors, and on AOS-CX the Live tab). Give it a device credential as in the next step.

## 4. Add device credentials and test them

1. **Settings → API Credentials → Add Credential**: the account from the table above. Credentials are encrypted at rest and never shown again.
2. On **Devices**, select the devices that use it and choose **Credential** in the bar above the table. The preview says which devices it skips (for example cloud-only APs, which NetHelper never reaches directly) and why.
3. Run the connection test from the same dialog, or **Test Direct Connection** on a device's page. A pass means NetHelper logged in to the device itself. A cloud-only device shows its cloud's view instead.

When a test fails with "rejected the username or password", check the account on the device. When it times out, check reachability and the service (REST, SSH, NETCONF).

## 5. Back up configurations

On a device's page, **Backup Config**, or **Config Backups → Run Backup Now** for many at once. Run it again later: an unchanged config is recorded as unchanged, and a changed one gets a diff you can view on **Config Backups**. Schedules are on the same page's **Schedules** tab.

Backups contain secrets, so only admins and operators can see their contents.

Optional: **Settings → API Credentials → Git mirror** commits every backup to a Git repository. Use a **private** repository and a deploy key made for it, never your personal key (setup in [`deploy/README.md`](../deploy/README.md)).

## 6. Status and alerts

The status column comes from ping first, then the cloud:

| Status | Meaning |
|---|---|
| online | Answers ping, or isn't pinged (no IP) and its cloud reports it online |
| offline | Doesn't answer ping and its cloud (if any) agrees, or hasn't been checked yet |
| warning | The cloud and ping disagree: the cloud says online but ping fails (no route or ICMP filtered), or the cloud says offline but its address answers (possibly another device now has that IP). Hover the status for the reason |

**Alerts** lists open problems: devices offline, configs out of sync with Central, failed backups or syncs. They close by themselves when the condition clears. Admins can tune or turn off each rule under **Settings → Alerts**.

## 7. Add your team

**Users → Add user** (admins only). Roles:

- **viewer**: sees inventory, status and backup history.
- **operator**: also adds devices and credentials, and runs discovery, backups and tests.
- **admin**: also manages users, cloud integrations and the Git mirror.

There's no self-signup and no "forgot password": an admin resets passwords on the **Users** page.

## When something doesn't work

[`BETA_NOTES.md` → Reporting a problem](BETA_NOTES.md#reporting-a-problem) lists what to send. Every setting is in [`CONFIGURATION.md`](CONFIGURATION.md).
