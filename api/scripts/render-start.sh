#!/bin/sh
# Render free plan has no preDeployCommand, so the start command runs: migrations → seed-if-empty → server.
# `exec` hands PID 1 to node so Render's SIGTERM reaches the server's graceful shutdown.
set -eu
cd "$(dirname "$0")/.."
echo "[render-start] prisma migrate deploy"
npx --no-install prisma migrate deploy
echo "[render-start] seed if empty"
node dist/scripts/seed-if-empty.js
echo "[render-start] starting API"
exec node dist/src/server.js
