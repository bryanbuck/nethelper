## What and why

<!-- What changed, and the problem it solves. Link the issue: "Fixes #123". -->

## Checklist

- [ ] `npm run ci` passes in `backend/` and `frontend/` (CI runs both)
- [ ] Tests added or updated for the change
- [ ] Route added/removed/renamed: `authorize(...)` guard on mutating routes, `npm run postman:generate` run
- [ ] Vendor/platform/provider change: `backend/src/constants/vendors.js` and `frontend/src/models/vendors.js` kept in sync
- [ ] Docs updated as described in "Keeping docs current" in `CONTRIBUTING.md`
- [ ] No secrets, real device configs, or unanonymised captures in code or fixtures
- [ ] Tested on real hardware? If so, which device/firmware:
