# Documentation Archive — Historical / Non-Authoritative

These files are **point-in-time artifacts** kept for historical reference: task prompts handed to earlier sessions, plans/evaluations, implementation summaries, test plans, and dev scratch notes. **They were written before the multi-vendor migration and describe an Aruba-Central-only architecture that no longer exists** (e.g. `managementMode: central|direct`, `aruba-central.service.js`, `ArubaCentralConfig`).

**Do not treat anything here as current.** Authoritative sources:

- Architecture & roadmap → [`../MULTI_VENDOR_ROADMAP.md`](../MULTI_VENDOR_ROADMAP.md)
- Project guide / conventions → [`../../CLAUDE.md`](../../CLAUDE.md)
- Open work items → [`../ROADMAP_AND_TODO.md`](../ROADMAP_AND_TODO.md)

## Contents

| File | What it was | Superseded by |
|---|---|---|
| `LIVE_STATE_CX_PROTOCOL_CHECK_2026-10-15.md` | AOS-CX REST/notification behavior observed on hardware before building live state | `services/live/`; `MULTI_VENDOR_ROADMAP.md` §8c |
| `BACKEND_PROMPT_API_STATUS_TRACKING.md` | Task prompt: API-communication status tracking | Implemented; see device status columns in schema |
| `BACKEND_PROMPT_ICMP_MONITORING.md` | Task prompt: ICMP ping monitoring | Implemented as `ping-monitor.service.js` |
| `CENTRAL_ENDPOINT_TRIAGE.md` | Triage of broken Aruba Central endpoints | `aruba-central.provider.js` + `CapabilityError` (roadmap Phase 0) |
| `CENTRAL_MANAGEMENT_MODE_PLAN.md` | Plan: central-vs-local detection | `managementMode` (now `cloud`/`direct`) + transport router |
| `CX_API_INTEGRATION_SUMMARY.md` | Summary: AOS-CX REST integration | `device-api/cx-switch-api.js`; roadmap |
| `CX_API_TEST_PLAN.md` | Manual test plan for CX API | — (historical) |
| `FRONTEND_TESTING_REQUIREMENTS.md` | Frontend testing UI requirements spec | Implemented in device-api testing views |
| `FRONTEND_QUICK_REFERENCE.md` | "What we built" quick ref for device-API testing | Implemented; see `DeviceApiTestingView.vue` |
| `ARUBA_CENTRAL_API_PHASE_2_3_TODO.md` | Aruba Central API phase 2/3 TODO | Multi-vendor roadmap |
| `LOGIN_TESTING.md` | Login/auth manual testing guide | — (historical) |
| `FRONTEND_REALTIME_UPDATE_ANALYSIS.md` | Analysis of real-time device updates | Implemented (Socket.io events; see root CLAUDE.md) |
| `FRONTEND_REALTIME_UPDATES_SUMMARY.md` | Summary of real-time updates work | as above |
| `FRONTEND_SETTINGS_BACKEND_REQUIREMENTS.md` | Settings feature backend requirements | Implemented (`/settings/*`) |
| `FRONTEND_SETTINGS_UI_FIXES.md` | Settings page UI fix notes | Historical |
| `FRONTEND_SETTINGS_TROUBLESHOOTING.md` | Settings error-handling notes | Historical |
| `BACKEND_LOGGING.txt` / `FRONTEND_DEBUG.txt` | Debug-logging feature notes | Historical dev notes |
| `FRONTEND_TODO_Login.txt` / `FRONTEND_UI_URLs.txt` | Login-flow notes / UI URL test cases | Historical dev notes |
