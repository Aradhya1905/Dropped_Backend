# Deployment & Server Operations

How the Dropped backend is deployed, where it lives, and how to operate it.

---

## TL;DR

- **Public API:** https://droppeddev.duckdns.org
- **Interactive docs:** https://droppeddev.duckdns.org/docs (Scalar)
- **OpenAPI spec:** https://droppeddev.duckdns.org/openapi.json
- **Redeploy:** say `/deployInServer`, or run `./scripts/deploy.ps1 -Push` locally.

---

## The server

| | |
| --- | --- |
| Host | Oracle Cloud compute instance (`instance-20260427-1225`) |
| Public IP | `140.245.194.161` |
| OS | Ubuntu 24.04 LTS, x86_64 |
| SSH user | `ubuntu` |
| App directory | `~/Dropped_Backend` |
| Node | 20.x (via NodeSource) · Yarn 4.10.3 (Corepack) |
| Process manager | PM2 (auto-starts on boot) |
| Reverse proxy / TLS | Caddy (auto Let's Encrypt, auto-renew) |
| Database | Neon Postgres (cloud) — unchanged from local; `DATABASE_URL` in `~/.../.env` |

### Connect from this machine

The SSH key is already configured, so this just works (no password):

```bash
ssh ubuntu@140.245.194.161
```

Copy a file up (example — how `.env` got there):

```bash
scp ./.env ubuntu@140.245.194.161:~/Dropped_Backend/.env
```

> `.env` is **gitignored**, so it is NOT in the repo and does not arrive via `git pull`.
> If env vars change, `scp` the new `.env` up (or edit it on the server) and redeploy.

---

## Architecture / request path

```
Phone / browser
      │  HTTPS (port 443)
      ▼
droppeddev.duckdns.org ──DNS──► 140.245.194.161
      │
      ▼
Caddy  (systemd service, terminates TLS, auto-renews cert)
      │  reverse_proxy -> localhost:3000
      ▼
Node app  (PM2 process "dropped-api", entry dist/src/server.js)
      │  postgres.js over TCP
      ▼
Neon Postgres + PostGIS
```

- **No inbound app port is exposed directly** — only 80/443 (Caddy). The app listens on
  `localhost:3000`.
- **Two firewalls** had to be opened for 80/443: the OS `iptables` (done, persisted via
  `iptables-persistent`) **and** the Oracle Cloud **Security List** in the OCI web console
  (ingress rules for TCP 80 and 443 from `0.0.0.0/0`). The cloud one can only be changed
  in the OCI console, not over SSH.

---

## Deploying changes

The server always deploys from **`origin/main`**. So the flow is: commit locally → push →
the server pulls and rebuilds. Uncommitted local work will NOT ship.

### Option A — the slash command (preferred)

```
/deployInServer
```

It checks local git, pushes committed changes on `main`, runs the server deploy script,
and verifies the public health endpoint.

### Option B — local script

```powershell
./scripts/deploy.ps1          # deploy what's already on origin/main
./scripts/deploy.ps1 -Push    # push local commits first, then deploy
```

### Option C — manual

```bash
git push origin main
ssh ubuntu@140.245.194.161 "cd ~/Dropped_Backend && bash scripts/deploy.sh"
```

### What `scripts/deploy.sh` does (on the server)

1. `git fetch` + `git reset --hard origin/main` (match remote exactly)
2. `yarn install`
3. `yarn build`  → output goes to **`dist/src/server.js`** (tsconfig `rootDir` is the
   project root, so structure is preserved under `dist/`)
4. `yarn db:migrate` (idempotent — safe even though Neon is already migrated)
5. `pm2 restart dropped-api` (or start it if missing) + `pm2 save`
6. health check on `http://localhost:3000/health`

---

## Operating the server

```bash
# status of everything PM2 manages
ssh ubuntu@140.245.194.161 "pm2 list"

# app logs (live: drop --nostream)
ssh ubuntu@140.245.194.161 "pm2 logs dropped-api --lines 50 --nostream"

# restart just the app
ssh ubuntu@140.245.194.161 "pm2 restart dropped-api"

# Caddy (TLS / reverse proxy)
ssh ubuntu@140.245.194.161 "sudo systemctl status caddy"
ssh ubuntu@140.245.194.161 "sudo journalctl -u caddy --no-pager -n 50"

# Caddy config
ssh ubuntu@140.245.194.161 "cat /etc/caddy/Caddyfile"
```

The Caddyfile is simply:

```
droppeddev.duckdns.org {
    reverse_proxy localhost:3000
}
```

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `https://...` times out from the internet | Oracle **Security List** ingress for 80/443 missing (OCI console). The OS iptables is already open. |
| Cert errors / "challenge failed ... firewall problem" in Caddy logs | Same as above — Let's Encrypt can't reach 80/443. Open the cloud firewall, then `sudo systemctl restart caddy` to force a retry. |
| Health works locally on server but not publicly | Caddy down, or cloud firewall. Check `systemctl status caddy`. |
| `pm2 start` says "Script not found: dist/server.js" | Entry is **`dist/src/server.js`**, not `dist/server.js`. |
| App returns `{"message":"Missing or invalid X-Device-Id header"}` | Expected for every route except `/health` and `/docs`. Send `X-Device-Id: <uuid v4>`. |
| DuckDNS name points to wrong IP | Set the "current ip" at duckdns.org to `140.245.194.161` (not your laptop's IP). |

---

## DuckDNS note

The free subdomain `droppeddev.duckdns.org` points at the server's public IP. If Oracle
ever changes the instance's public IP, update the IP at https://www.duckdns.org (or set up
the DuckDNS auto-update cron on the server — not yet configured).

---

## Session log — initial setup (2026-06-14)

What was done to stand this up, in order:

1. **Local repo → GitHub.** `git init`, added remote
   `https://github.com/Aradhya1905/Dropped_Backend.git`, committed, pushed `main`.
   (Added `.yarn/install-state.gz` to `.gitignore`; `.env` stays gitignored.)
2. **Scalar API docs.** Added `@fastify/swagger` + `@scalar/fastify-api-reference`; serve
   OpenAPI (generated from the Zod route schemas) at `/openapi.json` and the Scalar UI at
   `/docs`, with `X-Device-Id` as a security scheme. Made the device-id plugin's
   `publicPaths` prefix-aware so `/docs` assets load. Exported
   `Documentation/openapi.json` + a human-readable `Documentation/API.md` for the frontend.
3. **Provisioned the Oracle server.** Installed Node 20 + Corepack/Yarn, cloned the repo,
   `scp`'d `.env` up, `yarn install && yarn build && yarn db:migrate`.
4. **Process management.** Installed PM2, started `dropped-api` from `dist/src/server.js`,
   `pm2 save` + `pm2 startup` (survives crash and reboot).
5. **Permanent HTTPS URL (free).** Created the DuckDNS subdomain
   `droppeddev.duckdns.org` → `140.245.194.161`. Opened ports 80/443 in the OS `iptables`
   (persisted) **and** in the Oracle Cloud Security List (OCI console). Installed Caddy,
   pointed it at the domain → `localhost:3000`; Caddy obtained a Let's Encrypt cert
   (valid, auto-renewing).
6. **Deployed the docs build.** Pushed the Scalar changes, pulled + rebuilt + restarted on
   the server. Verified `/health`, `/docs`, and `/openapi.json` over public HTTPS.
7. **Cleanup.** Removed the earlier `cf-tunnel` PM2 process (a temporary Cloudflare
   quick-tunnel used before the DuckDNS + Caddy setup). PM2 now manages only `dropped-api`.
