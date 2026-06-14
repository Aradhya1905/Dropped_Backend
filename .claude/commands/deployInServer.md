---
description: Push committed changes and deploy to the Oracle server (pull, build, restart, verify)
allowed-tools: Bash(ssh:*), Bash(scp:*), Bash(git status:*), Bash(git push:*), Bash(git rev-parse:*), Bash(git log:*), Bash(curl:*)
---

Deploy the backend to the Oracle server and verify it is live.

Server: `ubuntu@140.245.194.161` (SSH key already configured — connects without a password).
Public URL: `https://droppeddev.duckdns.org` · Docs: `/docs` · App dir on server: `~/Dropped_Backend`.
The app runs under PM2 as `dropped-api` (entry point `dist/src/server.js`); Caddy terminates TLS in front of it.

Steps:
1. Check local git: `git status --short` and `git rev-parse --abbrev-ref HEAD`.
   - If there are **uncommitted** changes, tell the user and ask whether to commit them first (use /sync or commit manually) — the server deploys from `origin/main`, so uncommitted work won't ship. Do not auto-commit unless they say so.
2. If there are committed-but-unpushed changes on `main`, push them: `git push origin main`.
3. Run the server deploy script over SSH:
   `ssh -o ConnectTimeout=20 ubuntu@140.245.194.161 "cd ~/Dropped_Backend && bash scripts/deploy.sh"`
   This does: `git reset --hard origin/main` → `yarn install` → `yarn build` → `yarn db:migrate` → `pm2 restart dropped-api` → local health check.
4. Verify the public endpoint: `curl -s https://droppeddev.duckdns.org/health` (expect `{"ok":true}`).
5. Report: the commit deployed, the health result, and the URLs (API + /docs).

If the health check fails, show the PM2 logs the script prints and stop — do not loop retries. See `Documentation/DEPLOYMENT.md` for the full server setup and troubleshooting.
