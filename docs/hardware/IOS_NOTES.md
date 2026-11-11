# Cisco IOS over SSH: facts from real hardware

Observed on a Catalyst WS-C3560E-24PD-S, IOS 15.0(1)SE2 (`C3560E-UNIVERSALK9-M`), directly managed, 2026-11-11. NetHelper reaches IOS and IOS-XE only over the SSH CLI (`services/ssh-device.service.js`, profile `ios-xe`, which serves both: the commands are the same from IOS 12.2 to IOS-XE 17). Captures are in `backend/tests/fixtures/ios-live/`, including a replay of a real session (`ssh-session.json`).

Not yet seen on hardware: IOS-XE, a login below privilege 15, `enable`, CDP neighbors, a stack. Those parts follow Cisco's command reference.

## SSH

- The switch identifies as `SSH-1.99-Cisco-1.25` (SSH v1 and v2 both on) and offers only old algorithms: key exchange `diffie-hellman-group-exchange-sha1`, `diffie-hellman-group14-sha1`, `diffie-hellman-group1-sha1`; host key `ssh-rsa`; ciphers `aes128-cbc`, `3des-cbc`, `aes192-cbc`, `aes256-cbc`; MACs `hmac-sha1`, `hmac-md5`. NetHelper's list already had what it needs: the session negotiated `diffie-hellman-group14-sha1`, `ssh-rsa`, `aes128-cbc`, `hmac-sha1`.
- A 1024-bit RSA host key is accepted by Node 22. A current OpenSSH client refuses this switch without `-o KexAlgorithms=+diffie-hellman-group14-sha1 -o HostKeyAlgorithms=+ssh-rsa -o Ciphers=+aes128-cbc`, which is worth knowing when checking a login by hand.
- SSH needs a crypto image (`K9` in the image name), an RSA key (`crypto key generate rsa`) and `login local` or AAA on the vty lines. An image without crypto has only Telnet, which NetHelper doesn't speak.

## The CLI

- The first prompt arrives as `\r\nSwitch1#` with no banner. The echo of each typed command comes back one character per chunk; output and the next prompt follow in one piece. The prompt-driven shell handles it unchanged.
- `terminal length 0` turns paging off for the session and prints nothing.
- A privilege-15 login lands at `Switch1#` (`show privilege`: `Current privilege level is 15`).

## Accounts

- **The login must reach privilege 15 to read the configuration.** Either create it there (`username nethelper privilege 15 secret …`, or the AAA equivalent), or give NetHelper the enable secret on the device credential: when the login lands at `>`, NetHelper types `enable`, answers `Password:`, and carries on at `#`. The secret is only ever typed at that prompt.
- A login at `>` without an enable secret gets `% Invalid input detected at '^' marker.` for `show running-config`; NetHelper refuses to store that as a backup and says what to change (`assertCliConfigReadable`).
- A login at privilege 2–14 that is allowed to run `show running-config` gets no error, only the commands its level may set, which is close to nothing. NetHelper refuses a config with neither a `hostname` nor an `interface` line (`assertIosConfigReadable`).
- `show version`, `show cdp …` and `show lldp …` work at `>`, so a connection test can pass for a login that can't back up.

## `show running-config`

The output starts with lines that are not configuration, and holds lines that change by themselves:

```
Building configuration...

Current configuration : 9219 bytes
!
! Last configuration change at 19:07:04 CST Sun Feb 28 1993 by admin
!
version 15.0
```

- `Building configuration...`, `Current configuration : N bytes`, `! Last configuration change at …`, `! NVRAM config last updated at …` (after a `write memory`), `! No configuration change since last restart`, and `ntp clock-period N` (older IOS adjusts it without anyone touching the config) are dropped by `cleanIosConfig()` (`utils/ios-cli.js`) before the text is stored and hashed. Without that every backup would count as a change. Two reads of the unchanged 3560E are byte-identical.
- The stored text starts at `version 15.0` and ends at `end`, and can be pasted back.
- The config carries secrets (type 5/7 passwords, SNMP communities), like every other platform's; backup contents stay operator/admin only.

## `show version`

- First line: `Cisco IOS Software, C3560E Software (C3560E-UNIVERSALK9-M), Version 15.0(1)SE2, RELEASE SOFTWARE (fc3)`. The version has parentheses, which the generic parser cut at (`15.0`); `parseShowVersion()` reads `15.0(1)SE2`.
- Identity lines: `Model number : WS-C3560E-24PD-S`, `System serial number : FDO…`, `Base ethernet MAC Address : A8:B1:D4:…`, and `Switch1 uptime is …` for the hostname. A firmware or system poll fills model, serial and MAC on the device row where they are empty.
- The `BOOTLDR:` line also has a `Version` (12.2(44r)SE3); the parser takes the first `Cisco IOS … Version`.

## Neighbors

- **`show lldp neighbors detail` has no `Local Intf:` line on this release.** Each block starts at `Chassis id:`. The local port only appears in the summary table (`show lldp neighbors`: `Device ID`, `Local Intf`, `Hold-time`, `Capability`, `Port ID`), so NetHelper reads both in one session and matches a block to its row by remote port and device name. The summary cuts a Device ID at 20 characters, so it is read by column position.
- LLDP is off by default on IOS (`lldp run` turns it on); CDP is on. With CDP on and no CDP neighbor, `show cdp neighbors detail` prints nothing at all.
- LLDP chassis ids print as `e4de.4000.2280`, port ids as the neighbor sends them (`1/1/25` from an AOS-CX switch).

## For later features

Captured for the live-state and port-identity work, not used yet: `show interfaces status` (fixed-width; `Vlan` is a number, `trunk` or `routed`), `show power inline` (per-port admin/oper/watts/class and the budget line), `show mac address-table` and `show ip arp`.

## What IOS does not have

Classic IOS (this switch, and the 2960/3560/3750 families) has no NETCONF-YANG, RESTCONF or gNMI: those start with IOS-XE 16.x on Catalyst 3650/3850/9000 and are off until configured. SSH is the one transport every release shares.
