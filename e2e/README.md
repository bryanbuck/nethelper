# Browser smoke test

One Playwright test that walks the main path of a running NetHelper:

1. sign in;
2. add a device from the Devices page, creating its credential from the
   device form ("Add credential");
3. test the connection;
4. back it up from the device page, change its config, back it up again;
5. open the History tab's Compare and check the diff shows exactly that change;
6. take an application backup (Settings → App Backup → Run now).

The device is a stand-in Cisco IOS switch (`fake-switch.js`): an SSH server
that answers like the lab's Catalyst 3560E. The test starts it itself, and
removes what it created at the end (device, credential, archive).

It never starts NetHelper. CI (`.github/workflows/e2e.yml`) builds the images
and starts the stack with `deploy/install.sh -y`; locally, point it at any
stack you run.

## Running it

```sh
cd e2e
npm ci
npx playwright install chromium     # once
E2E_BASE_URL=http://localhost:5173 \
E2E_ADMIN_EMAIL=you@example.com E2E_ADMIN_PASSWORD='…' \
npx playwright test
```

| Variable | Default | Meaning |
|---|---|---|
| `E2E_BASE_URL` | `http://localhost:8080` | The UI (the API is behind it, same origin) |
| `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD` | (required) | An admin of that NetHelper |
| `E2E_SWITCH_PORT` | `2222` | Where the stand-in switch listens. **The backend's `SSH_PORT` must be the same**: NetHelper uses one SSH port for every device |
| `E2E_SWITCH_HOST` | `127.0.0.1` | The address the backend reaches this machine at (in Docker, the Compose network's gateway) |
| `E2E_SWITCH_BIND` | `0.0.0.0` | The address the stand-in listens on |

The application backup step needs `pg_dump` and `tar` on the backend host;
the backend image has both.
