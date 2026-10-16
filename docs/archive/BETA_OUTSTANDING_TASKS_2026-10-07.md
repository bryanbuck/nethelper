# NetHelper beta release: outstanding tasks

Oct 7, 2026 · @Bryan

## Where things stand

Phases 1–6 of the beta plan are done and committed on branch `release/beta`. Phase 7 (hardware validation, clean-VM install, release) has not started. Nothing is merged to `master` yet, there is no remote, and the working tree is clean.

| Phase | Commit | What it delivered |
| --- | --- | --- |
| 6. First run and docs | `a6913b3` | `create-admin` CLI, Users page and `/api/v1/users`, change password, README, CHANGELOG, VERSION, BETA\_NOTES, CONFIGURATION. Fixed user deletion wiping integrations and credentials. |
| 5. Packaging | `fbb322e` | Dockerfiles, Compose (plus host-network override), systemd unit, TLS nginx site, `deploy/README.md` runbook, `/health/ready` |
| 4. Tests | `2ac9fb7` | 300 backend Jest tests, 22 frontend Vitest tests, `npm run ci` per tier. Fixed the unreachable `GET /devices/groups`. |
| 3. Demo removal | `bdb6a7a` | Mock data and placeholder pages removed, automations marked experimental, optional device serial |
| 2. Security | `73754a6` | Env validation, no fallback encryption key, `key:rotate`, CORS from config, rate limits, log redaction |
| 1. Hygiene | `19c2d6f` | `.env` untracked, admin-only registration, AGPL license, lockfiles |

The full plan is in `~/.claude/plans/i-d-like-to-take-scalable-cake.md` on the dev host. Status lines are in `docs/ROADMAP_AND_TODO.md` under "Beta Release Readiness".

## Phase 7: hardware validation and clean-VM install

Next up. You confirmed you can provide every platform plus a clean VM; these are the details to have ready when you resume.

**Inputs from you**

- [ ] VM access from the dev host: `user@host` with SSH key login and passwordless sudo, plus its OS (the docs target Debian 12 / Ubuntu 24.04)
- [ ] Whether the VM has outbound internet (Docker images, npm, Central and Mist APIs) or needs a proxy
- [ ] Whether the VM reaches the devices on SSH 22, HTTPS 443, and NETCONF 830, and whether it shares an L2 segment with any of them (for the MAC discovery test)
- [ ] A second fresh VM (same OS and access as the first) for the bare-metal install, so it starts from a true new-user state
- [ ] Which subnets are OK to sweep with nmap, and any device or tenant to treat with care
- [ ] Someone to make a harmless config change (description or banner) on one or two devices mid-run, for the diff test
- [ ] Where to report results: the session only, or a shared doc

The test equipment: a Central tenant, a Mist org, and direct AOS-CX, AOS-S, and Junos devices. You enter all cloud and device credentials yourself in the NetHelper UI on the VM, so no secret passes through chat.

**Test run**

1. Docker Compose install following only `deploy/README.md`, using the host-network override. Log every doc gap or error.
2. Create the first admin with `create-admin`, then you add the integrations and credentials in the UI.
3. For each platform: inventory sync, status, connection test, config backup, config change, second backup, diff.
4. Also: discovery (with MAC addresses), the Git mirror, a restart, and an upgrade (`docker compose up -d --build` over a running stack).
5. Click through the Users page and the change-password dialog in a browser.
6. Bare-metal install (after provisioning a second fresh VM, not reusing the Docker one) following `deploy/README.md`: systemd unit, nginx with TLS, `nginx -t`.
7. Record results in `docs/BETA_NOTES.md` ("How much has been tested on real equipment" table). Mark anything not tested as unverified, and fix what breaks.

## Release steps

Release happens only after phase 7 passes; until then `release/beta` stays unmerged.

1. Run `npm run ci` in `backend/` and `frontend/` one last time.
2. Set the release date in `CHANGELOG.md` (currently "unreleased").
3. Merge `release/beta` into `master`.
4. Tag `v0.9.0-beta.1` on `master`.
5. Delete the `release/beta` branch (your standing rule: clean up merged branches right away).
6. Update `docs/ROADMAP_AND_TODO.md`: mark the beta section shipped with its date, and move deferred items to a post-beta list.

## Built but not yet verified

Phase 7 is meant to close each of these. Anything it can't close goes into `docs/BETA_NOTES.md` as unverified.

| Item | Why it's unverified | Risk to watch for |
| --- | --- | --- |
| Docker images and Compose stack | The dev host has no Docker | `ping` as non-root in the container; the `!reset` override needs Compose 2.24+ |
| nginx configs (container and bare metal) | The dev host has no nginx | Syntax (`nginx -t`); CSP blocking something Vuetify needs |
| systemd unit sandboxing | Only checked with `systemd-analyze` | Prisma migrate under `ProtectSystem=strict` |
| Users page and change-password dialog | Tested through the API only | Layout or validation in the browser |
| Visual regressions from the Vuetify upgrade (3.9 beta to 3.13.5) | No click-through done since phase 2 | Broken layouts on less-used pages |
| Mist and Junos | Only against mock servers built from the specs | Real response shapes differing from the docs |
| AOS-S over SSH | No recorded hardware run | CLI prompt and pager handling |
| Central and Mist test fixtures | Written from API docs, not recorded | Replace with redacted live captures in phase 7 |
| Browser end-to-end test (login, add device, backup, diff) | Deferred; Cypress was never installed | Best run against the Compose stack |

## Deferred to the going-public review

These wait until you ask for a review specific to going public; the repo stays private until then.

- [ ] Rotate every secret that was in the formerly tracked `backend/.env`: both JWT secrets, `ENCRYPTION_KEY` (via `npm run key:rotate`), database and Redis passwords, the Aruba Central client secret, and SMTP. The dev JWT secrets are still placeholders and warn at startup.
- [ ] Purge the old `.env` from git history with `git filter-repo` before the repo is pushed anywhere shared.
- [ ] Confirm the license (AGPL-3.0-or-later is provisional).
- [ ] Review the docs for a public audience.

## Post-beta backlog and small leftovers

None of these block the beta.

**Product (scope was frozen for the beta)**

- Cisco Meraki (cloud) and Catalyst (direct), phases 3–4 of `docs/MULTI_VENDOR_ROADMAP.md`
- Automation schedules and execution history pages (automations are experimental)
- Config restore / rollback push
- SSH key auth to devices, and enable-mode escalation
- Device status history (the dashboard shows current status only)
- Optional support bundle (logs, version, redacted config)

**Housekeeping**

- The commit trailer in your local `CLAUDE.md` still says "Claude Opus 4.8"; the model is now Opus 5.5
- `backend/ARCHITECTURE.md` and `DEVICE_POLLING_API.md` carry "partially superseded" banners and could be refreshed or archived
- The Postman collection in `backend/` may lag the routes
- Accepted moderate `uuid` advisory via `bull` (the only fix is a downgrade)
- Git mirror over SSH in Docker re-accepts the remote's host key whenever the container is recreated

## How to resume

Start a session in `~/nethelper` on the dev host, on branch `release/beta`, and send the phase 7 inputs above.

| What | Where or how |
| --- | --- |
| Install, first admin, backup/restore, upgrades | `deploy/README.md` |
| Supported platforms, limitations, bug reports | `docs/BETA_NOTES.md` |
| Every setting | `docs/CONFIGURATION.md` |
| Beta plan (all 7 phases) | `~/.claude/plans/i-d-like-to-take-scalable-cake.md` |
| Status log | `docs/ROADMAP_AND_TODO.md`, "Beta Release Readiness" |
| Dev services | `systemctl --user restart nethelper-backend` (or `nethelper-frontend`); logs with `journalctl --user -u nethelper-backend -f` |
| Checks | `npm run ci` in `backend/` and in `frontend/` |
| First admin on a new install | `npm run user:manage -- create-admin --email … --name …` |
