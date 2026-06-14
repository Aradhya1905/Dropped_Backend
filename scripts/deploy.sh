#!/usr/bin/env bash
#
# deploy.sh — runs ON the Oracle server. Pulls latest main, installs deps,
# rebuilds, restarts the PM2 process, and verifies health.
#
# Normally you don't run this directly — use scripts/deploy.ps1 from your
# local machine (or the /deployInServer command), which SSHes in and runs this.
#
# Manual use on the server:
#   cd ~/Dropped_Backend && bash scripts/deploy.sh
#
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/Dropped_Backend}"
PM2_NAME="${PM2_NAME:-dropped-api}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3000}"

cd "$APP_DIR"

echo "=== 1/5 git pull (origin/$BRANCH) ==="
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"   # match remote exactly; no local drift

echo "=== 2/5 yarn install ==="
yarn install --immutable 2>&1 | tail -3 || yarn install 2>&1 | tail -3

echo "=== 3/5 build ==="
yarn build

echo "=== 4/5 db:migrate (idempotent) ==="
yarn db:migrate 2>&1 | tail -3

echo "=== 5/5 restart pm2 ($PM2_NAME) ==="
# Entry point is dist/src/server.js (tsconfig rootDir is the project root).
if pm2 describe "$PM2_NAME" > /dev/null 2>&1; then
  pm2 restart "$PM2_NAME"
else
  pm2 start dist/src/server.js --name "$PM2_NAME"
fi
pm2 save

echo "=== verify health ==="
sleep 3
if curl -fsS "http://localhost:$PORT/health" > /dev/null; then
  echo "OK: http://localhost:$PORT/health -> $(curl -s http://localhost:$PORT/health)"
  echo "DEPLOY SUCCEEDED"
else
  echo "ERROR: health check failed. Recent logs:"
  pm2 logs "$PM2_NAME" --lines 30 --nostream
  exit 1
fi
