# Aruba Central API Endpoint Triage

**Date**: 2026-07-08
**Tenant base URL (hostname only)**: `us4.api.central.arubanetworks.com`
**Config source used**: environment variables (`backend/.env`) — no active row exists in the
`ArubaCentralConfig` table (`SELECT ... WHERE isActive = true` returned zero rows).
**Script**: `backend/scripts/triage-central-endpoints.js` (read-only, GET-only; see the file
header for the safety rules it enforces — no write/config/command endpoints are ever called,
and tokens/secrets/customer IDs are redacted before anything is printed or written).

## Environment status

| Component | Status |
|---|---|
| Postgres | Reachable (`pg_isready` OK), `Device` table currently empty of a usable test switch — confirmed via Prisma query (zero `ArubaCentralConfig` rows and no serial resolved from DB) |
| Redis | Reachable (`PONG`), no cached `aruba:access_token` key present |
| Aruba Central OAuth2 (`POST /oauth2/token`) | **Fails with HTTP 401** for the credentials currently in `backend/.env` |

## Blocking finding: OAuth2 token request itself fails (401)

Before any of the requested endpoint probes could run, `ArubaCentralService.getAccessToken()`
failed. Reproduced directly against `POST https://us4.api.central.arubanetworks.com/oauth2/token`
with the `client_credentials` grant (client id/secret from `.env`, sent as form-encoded body
fields, per the current implementation):

- **HTTP status**: `401`
- **Body**: `{"errorCode":"HPE_GL_NETWORKING_ERROR_UNAUTHORIZED","httpStatusCode":401,"message":"Missing authorization"}`
- **Response header**: `www-authenticate: Bearer realm=api, error=invalid_token`

The `HPE_GL_NETWORKING_ERROR_UNAUTHORIZED` error code and the `www-authenticate: Bearer ...`
challenge on the *token* endpoint (not just on API calls) are consistent with this tenant
being served by the **HPE GreenLake unified platform / "New Central" API gateway**, which is
known to front `api.central.arubanetworks.com`-style hostnames. That gateway's token endpoint
does not necessarily accept the classic Aruba Central "client id + secret in a form-encoded
POST body" shape that `getAccessToken()` sends — this looks like an authentication-flow/
credential mismatch, separate from (and blocking) the endpoint-family question this triage was
meant to answer.

This is either:
1. A credentials problem (the `ARUBA_CENTRAL_CLIENT_ID` / `ARUBA_CENTRAL_CLIENT_SECRET` in
   `.env` are stale, revoked, or belong to a different app registration than this base URL), or
2. An auth-flow problem (this tenant expects a different token request shape than classic
   Central's `client_credentials` grant), or both.

No cached token existed in Redis to fall back on, and no other authentication code path exists
in the codebase (`getAccessToken()` in `backend/src/services/aruba-central.service.js` is the
only place a token is obtained). As a result, **every endpoint probe below — including the
baseline `/network-monitoring/v1alpha1/devices` call that this task described as "known to
work" — could not be exercised in this session**, because the run never got past acquiring a
bearer token.

No secrets were printed: the client ID/secret/customer ID were read from `.env` only in-memory,
used to make the single diagnostic OAuth POST above, and are not reproduced anywhere in this
document, the script, or console output beyond the generic error body/headers shown (which
contain no credential material).

## Endpoint results table

Because authentication failed at the OAuth2 step, no downstream endpoint could be reached.
Every planned probe is recorded as blocked rather than tested:

| Endpoint | Status | Verdict |
|---|---|---|
| `/network-monitoring/v1alpha1/devices?limit=5` (baseline) | N/A | not tested — blocked by OAuth2 401 |
| `/network-monitoring/v1alpha1/switch/{serial}` | N/A | not tested — blocked by OAuth2 401 |
| `/configuration/v2/devices/{serial}/configuration` (`getDeviceConfiguration`) | N/A | not tested — blocked by OAuth2 401 |
| `/configuration/v1/devices/{serial}/configuration` | N/A | not tested — blocked by OAuth2 401 |
| `/configuration/v1/devices/{serial}/group` | N/A | not tested — blocked by OAuth2 401 |
| `/configuration/v2/groups?limit=20&offset=0` | N/A | not tested — blocked by OAuth2 401 |
| `/configuration/v1/groups/properties?groups=...` | N/A | not tested — blocked by OAuth2 401 (also depends on the groups call above) |
| `/monitoring/v1/switches?limit=5` | N/A | not tested — blocked by OAuth2 401 |
| `/monitoring/v2/networks/health` | N/A | not tested — blocked by OAuth2 401 |
| `/firmware/v1/versions/HP` | N/A | not tested — blocked by OAuth2 401 |

Additionally, no `Device` row of type `switch` (with or without `managementMode = 'central'`)
exists in the current database, so a live test serial would have had to come from the
`/network-monitoring/v1alpha1/devices` baseline call — which itself was unreachable. The serial
selection logic in the script is in place and ready to run once authentication is restored.

## Other notes surfaced during setup (informational, not part of the endpoint results)

- `backend/src/config/database.js` / `redis.js` expose `getPrisma()` / `getRedis()` as
  singletons that throw `"...not initialized. Call connect...() first."` unless
  `connectDatabase()` / `connectRedis()` have been called first. The triage script calls both
  before touching `aruba-central.service.js`.
- `ArubaCentralService.getAccessToken()` calls `this.getRedis().setex(...)` — the
  `redis` npm package in use (v4.7.1) exposes this method as `setEx` (camelCase), not `setex`.
  This would throw if a token request ever succeeded and tried to cache the result. The triage
  script applies a local, script-only runtime shim (`redis.setex = redis.setEx`) so it wouldn't
  be blocked by this if auth had succeeded; **this file/behavior in `src/` was not modified**,
  per instructions, but it is worth a follow-up fix since it would otherwise crash a real
  successful token fetch.

## Conclusions

1. **Which API family the tenant serves**: undetermined this session. The 401 with
   `HPE_GL_NETWORKING_ERROR_UNAUTHORIZED` / `www-authenticate: Bearer ... error=invalid_token`
   on the token endpoint itself suggests a GreenLake/New-Central-style gateway in front of
   `us4.api.central.arubanetworks.com`, which is circumstantial evidence for "New Central only"
   (consistent with the plan doc's working assumption), but this could not be confirmed against
   the classic `configuration/v1|v2`, `monitoring/v1|v2`, or `firmware/v1` endpoints because no
   bearer token could be obtained at all.
2. **Does `getDeviceConfiguration` work?** Unknown/unverified — blocked upstream of the actual
   endpoint call. It cannot be confirmed working, and per the plan document's existing
   suspicion (section 2.3), it should still be treated as **not proven to work** until
   authentication is fixed and this triage is re-run.
3. **What this means for the config-backup `'central'` path**: no change to the plan's existing
   risk assessment — if anything, this raises the risk one level. Not only is
   `getDeviceConfiguration` (`/configuration/v2/devices/{serial}/configuration`) unverified
   against the endpoint-family question, but the *entire* Central API integration is currently
   non-functional end-to-end in this environment because token acquisition fails. The
   config-backup `'central'` path (`Device.managementMode === 'central'` -> `pullConfig` ->
   `getDeviceConfiguration`) should be assumed **broken today** in this environment, and the
   plan's §3.3 preference for CX REST reads over the Central config API (when a device's IP and
   credentials are available) is reinforced as the safer near-term default regardless of which
   Central endpoint family turns out to be correct.

## Recommended next step (not performed here — outside this task's scope)

Before re-running this triage, someone with access to the Aruba Central / HPE GreenLake account
portal for this tenant needs to either: (a) issue a fresh API client ID/secret and confirm the
expected OAuth2 flow for `us4.api.central.arubanetworks.com` (classic client-credentials body
POST vs. GreenLake platform token flow), or (b) point `ARUBA_CENTRAL_BASE_URL` at the correct
token/API host for the credentials on hand. Once `getAccessToken()` succeeds, re-run
`node backend/scripts/triage-central-endpoints.js` to get the actual per-endpoint verdicts this
task was scoped to produce.
