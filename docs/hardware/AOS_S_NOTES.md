# AOS-S (ArubaOS-Switch) over SSH: facts from real hardware

Observed on an Aruba 2930F (JL258A), firmware WC.16.11.0015, directly managed (not under Central), 2026-10-20. NetHelper reaches AOS-S only over the SSH CLI (`services/ssh-device.service.js`, profile `aos-s`). A replay of a real session is in `backend/tests/fixtures/aos-s-live/ssh-session.json`.

## The CLI draws a screen

- After login the switch shows the banner, then `Press any key to continue`; NetHelper sends a newline.
- The CLI is a VT100 screen, not a line stream. The prompt (`Lab-Core> ` or `Lab-Core# `) and the echo of each typed command arrive between cursor-position sequences (`ESC[24;1H`, `ESC[24;11H`, …), with **no newline before the prompt**. Stripping the escapes alone glues the echo to the prompt (`no pageLab-Core>`), and a driver waiting for a prompt on its own line never sees one.
- A long command's echo is wrapped into 10-character pieces, each placed by a cursor move: `show lldp ` / `info remot` / `e-device d` / `etail`.
- The screen also repositions after ordinary line breaks when it scrolls (24 lines). Turning those moves into newlines would scatter blank lines through a config, at places that differ between runs.
- `cleanTerminal()` therefore treats a cursor move as a line break only when the text isn't already at the start of a line, and ignores a move at the very end (it just parks the cursor). `stripEcho()` joins a wrapped echo. With that, two backups of an unchanged switch are byte-identical.
- It also asks the terminal for its cursor position (`ESC[6n`). NetHelper doesn't answer, and the switch carries on.

## Accounts

- **An operator login can't read the configuration.** `show running-config` answers `Invalid input: running-config`. Use an account with manager rights. NetHelper refuses an error-only read instead of storing it as a backup (`assertCliConfigReadable`).
- `show version`, `show lldp info …` and `no page` work as an operator.

## Output formats

- `show version` puts the firmware on its own line after the image stamp, and then prints `Boot ROM Version: WC.16.01.0010`. The version parser skips Boot ROM lines and prefers the `XX.nn.nn.nnnn` pattern.
- LLDP chassis IDs and MACs print as `e4de40-aabc80`, not the spaced form the management guide shows. `normalizeMac` handles both.
- `show lldp info remote-device detail` matches the guide's block layout (`Local Port :`, `ChassisId :`, `PortId :`, `SysName :`, …), and the parser reads it unchanged. It lists LLDP neighbors of every vendor: AOS-CX (`1/1/4`), and Junos (`ge-0/0/11`, with a MAC as its management address).
