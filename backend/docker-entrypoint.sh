#!/bin/sh
# Apply pending migrations, then start the API. With arguments, run those
# instead (e.g. `docker compose run --rm backend npm run user:manage`).
set -e

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  npx --no-install prisma migrate deploy
fi

exec node server.js
