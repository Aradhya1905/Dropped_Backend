# Production hardening & infrastructure plan

_2026-07-30_

Decisions and concrete work needed before Dropped goes to production, based on a
review of the running setup (one Oracle micro, Neon free-tier Postgres) against
the actual query patterns in this repo.

**Status: planning only.** Nothing here is implemented yet. Each workstream below
is sized to become its own plan.

---

## Where we are today

| | |
| --- | --- |
| App server | Oracle micro `140.245.194.161` (Ubuntu 24.04, 1 core / 1 GB) — see [DEPLOYMENT.md](./DEPLOYMENT.md) |
| Second server | A second Oracle micro, same config. Currently unused. |
| Process manager | PM2 (`dropped-api`, entry `dist/src/server.js`) |
| TLS / proxy | Caddy → `localhost:3000`, DuckDNS subdomain |
| Database | Neon free tier, region `ap-southeast-1` (Singapore) |

---

## The three questions that started this

### 1. Should we put a load balancer across the two servers?

**No.** Fastify serving stateless JSON on one core handles thousands of req/s.
The bottleneck is the database round trip, not the Node process. Adding an LB
doubles DB connections, breaks the in-memory rate limiter, and adds a new single
point of failure wherever the LB itself runs — for roughly zero throughput gain.

The second server is better spent as a **dedicated database host** (see W2).
That specializes the two boxes instead of duplicating them, and it settles the
LB question permanently.

If an LB is ever genuinely needed, the notes are preserved in
[Appendix A](#appendix-a--if-a-load-balancer-is-ever-needed).

### 2. Can we get a bigger free box?

Oracle Always Free includes 4 OCPU / 24 GB Ampere A1, which would dwarf both
micros — but **A1 capacity is unavailable in `ap-hyderabad-1`** and has been for
a long time. Capacity-polling scripts are low-yield there.

The one thing that reliably unlocks it is upgrading the tenancy to **Pay As You
Go**: Always Free resources stay free, but PAYG tenancies get capacity priority.
That requires a card on file and real billing exposure beyond the free limits.

**Decision: not pursuing.** Two micros are sufficient. Revisit only if traffic
actually demands it.

### 3. Should we self-host Postgres instead of Neon?

**Yes** — but for latency, not for the free-tier caps. See W2.

---

## Findings

### F1 — Every request pays a Singapore round trip

`src/plugins/deviceId.ts:66` calls `deviceRepo.ensure(value)` on an `onRequest`
hook, so **every authenticated request** makes a DB round trip before the handler
runs. On top of that, handlers make their own.

Hyderabad → Neon `ap-southeast-1` is ~50–70 ms RTT.

| Endpoint | Round trips | Neon (Singapore) | Local Postgres |
| --- | --- | --- | --- |
| `GET /drops/nearby` | 2 | ~120 ms | ~2 ms |
| `POST /drops` | 3 (`ensure` → quota → insert) | ~180 ms | ~3 ms |
| `POST /drops/:id/reveal` | 3+ | ~180 ms | ~3 ms |

The `POST /drops` chain is visible in `src/services/drop.service.ts:31` →
`:45` — `deviceRepo.dropsCreatedSince` then `dropRepo.create`, sequential.

This is the single largest performance item on the list. Nothing else comes close.

### F2 — `/health` pings the database

`src/routes/index.ts:26`:

```ts
async (_request, reply) => {
  await sqlClient`SELECT 1`;
  return reply.send({ ok: true });
},
```

Point any uptime monitor (or an LB health check) at `/health` on a 5-minute
interval and Neon's compute never autosuspends. A month is 720 hours; the free
plan allows roughly 191 compute-hours. Compute would suspend in about 8 days.

The trap is that this fires by *accident* — simply adding monitoring causes it.

Related: this is also why we should **not** add a keep-alive ping to avoid Neon
cold starts. The cold start (~0.5–3 s after 5 min idle) is the cheaper problem.

Becomes moot once the DB is self-hosted, but the liveness/readiness split is
correct regardless, and matters while Neon remains the fallback.

### F3 — Trail queries do sequential scans

`reveals`, `saves`, and `hearts` are each keyed `PRIMARY KEY (drop_id, device_id)`
(`drizzle/0000_init.sql`). But the Trail queries filter on **`device_id` alone**:

- `src/repositories/device.repo.ts:84` — `SELECT created_at FROM reveals WHERE device_id = $1`
- `src/repositories/drop.repo.ts:204` — `JOIN reveals j ON … AND j.device_id = $1`
- `src/repositories/drop.repo.ts:206` — same for `saves`

`device_id` is the trailing column, so the PK index can't serve these. They are
sequential scans. Harmless at a thousand rows, brutal at a million on a small
compute.

### F4 — `route_cache` grows forever

`src/repositories/route.repo.ts:52` enforces `ROUTE_CACHE_TTL_DAYS` **in the
WHERE clause only**. Expired rows stop being *read*; they are never *deleted*.

`geometry` is a GeoJSON `LineString` stored as `jsonb` — roughly 2–10 KB per row,
by far the largest row in the schema.

Rough fill rate at 1k DAU × 5 route requests/day × ~3 KB ≈ **15 MB/day**, so
Neon's 0.5 GB fills in about five weeks. Self-hosting removes the deadline but
not the unbounded growth.

Per-row storage for context:

| Table | ~bytes/row incl. indexes |
| --- | --- |
| `drops` | ~700 B |
| `reveals` / `saves` / `hearts` | ~120 B |
| `device_steps` | ~90 B |
| **`route_cache`** | **~2–10 KB** |

### F5 — Building on the server risks OOM

`scripts/deploy.sh` step 3 runs `yarn build` on the box. `tsc` peaks around
300–500 MB. On a 1 GB instance already running Node, PM2, and Caddy, with **no
swap configured**, that is close to the edge — and an OOM kill during deploy
takes the API down with it.

### F6 — Live database credentials are committed

`tables.md` contains the Neon host, user, and password in plaintext, including a
full connection string. It is tracked in git and was committed in `5e82014`.

### F7 — Two multi-node landmines (only relevant if an LB ever happens)

- `src/plugins/rateLimit.ts:15` — `@fastify/rate-limit` uses an in-process store.
  Two nodes means the effective limit is 240/min, not 120.
- `src/repositories/route.repo.ts:88` — `usageThisMonth` then `incrementUsage` is
  check-then-increment. Already racy; a second node widens the window for
  overshooting `ORS_MONTHLY_LIMIT`.

---

## Target architecture

```
                    Phone / browser
                          │ HTTPS
                          ▼
              Caddy (TLS, DuckDNS)  ── micro A ── 140.245.194.161
                          │             Node + Fastify + PM2
                          │             1 GB, dedicated
                          │
                          │ private VCN (~0.3 ms, free)
                          ▼
                    micro B ── Postgres 16 + PostGIS
                               1 GB, dedicated, ~100 GB volume
                               not reachable from the internet
```

Neon stays provisioned as a fallback. `DATABASE_URL` is a one-line switch — which
is exactly what `src/config/env.ts` was designed for.

**Prerequisite to confirm before planning W2:** both micros must be in the same
Oracle tenancy and VCN. If the second server is in a different tenancy or region,
private networking is unavailable and Postgres would have to cross the public
internet — which changes the security model substantially and probably makes the
whole move not worth doing.

---

## Workstreams

Ordered by priority. Each is a candidate for its own plan.

| # | Workstream | Priority | Effort | Risk |
| --- | --- | --- | --- | --- |
| W1 | Rotate leaked DB credentials | Critical | S | Low |
| W2 | Self-host Postgres on micro B | High | L | Medium |
| W3 | Backups for the self-hosted DB | High | M | Low |
| W4 | `device_id` indexes | High | S | Low |
| W5 | Split `/health` and `/ready` | Medium | S | Low |
| W6 | Prune `route_cache` | Medium | S | Low |
| W7 | Micro A memory hardening | Medium | M | Low |
| W8 | Real domain + Cloudflare (optional) | Low | M | Low |

W4–W6 are worth doing **regardless** of whether W2 happens — self-hosting removes
the caps, not the sequential scans or the unbounded cache growth.

---

### W1 — Rotate leaked DB credentials

Addresses F6.

1. Rotate the `neondb_owner` password in the Neon console. Treat the current one
   as compromised.
2. Update `.env` on micro A (`scp`, per DEPLOYMENT.md) and locally.
3. Replace the credential block in `tables.md` with placeholders, or gitignore
   the file and keep a local copy.
4. Note that a later commit does **not** remove it from history — `5e82014` still
   exposes it. Rotation is the part that matters. `git filter-repo` is optional
   cleanup; if the repo is public it is worth doing.

Do this first and independently of everything else.

---

### W2 — Self-host Postgres on micro B

Addresses F1. Removes the Neon compute-hour cap, the 0.5 GB storage cap, and
autosuspend cold starts as side effects.

**Trade being accepted:**

| Gain | Give up |
| --- | --- |
| 100–170 ms off every request | Backups become ours (W3) |
| No compute-hour cap | No PITR, no branching |
| ~100 GB storage vs 0.5 GB | Patching, vacuum tuning, disk monitoring |
| No autosuspend cold starts | Box dies → data dies without offsite dumps |
| Prepared statements usable again | Postgres OOM takes the DB host down |

**Install (micro B):**

```bash
sudo apt install -y postgresql-16 postgresql-16-postgis-3
```

`postgresql.conf` for a dedicated 1 GB host:

```
shared_buffers = 256MB
effective_cache_size = 768MB
work_mem = 8MB
maintenance_work_mem = 64MB
max_connections = 25
random_page_cost = 1.1          # SSD-backed block volume
checkpoint_completion_target = 0.9
wal_compression = on
```

Allocate micro B a ~100 GB boot volume. Always Free permits 200 GB block storage
total across instances.

**Security — all three layers required.** Postgres must never be reachable from
the internet:

1. `postgresql.conf`: `listen_addresses` set to micro B's **private VCN IP only**,
   never `0.0.0.0`.
2. `pg_hba.conf`: a single `host dropped dropped <microA-private-ip>/32 scram-sha-256`
   entry. No `0.0.0.0/0` line.
3. OCI Security List: allow TCP 5432 **only** from micro A's private IP. Do not
   add 5432 to public ingress. (Per DEPLOYMENT.md, OS `iptables` and the OCI
   Security List are separate — both need to agree.)

Create a dedicated `dropped` role owning only that database. The app must not
connect as `postgres` superuser.

**Code change —** `src/db/client.ts:15` hardcodes `ssl: 'require'`, which fails
against a local Postgres. Derive it from the URL so the one-env-var design holds:

```ts
const sslMode = new URL(env.DATABASE_URL).searchParams.get('sslmode');

export const sqlClient = postgres(env.DATABASE_URL, {
  ssl: sslMode && sslMode !== 'disable' ? 'require' : false,
  max: 10,
});
```

**Migration procedure.** Do *not* `pg_dump` the whole Neon database — PostGIS's
`spatial_ref_sys` table conflicts on restore. Run our own migrations first, then
copy data only:

1. `DATABASE_URL=<local> yarn db:migrate` — creates schema and extensions
   (`drizzle/0000_init.sql` already does `CREATE EXTENSION postgis` / `pgcrypto`)
2. `pg_dump --data-only --exclude-table=spatial_ref_sys -Fc "<neon-url>" -f data.dump`
3. `pg_restore --data-only -d "<local-url>" data.dump`
4. Compare row counts per table against Neon
5. Flip `DATABASE_URL` in micro A's `.env`, `pm2 restart dropped-api`, verify

**Rollback:** point `DATABASE_URL` back at Neon. Keep the Neon project alive and
do not delete it after cutover — it costs nothing and it is the fallback.

**Note:** the earlier idea of switching to Neon's `-pooler` endpoint with
`prepare: false` is **superseded** by this workstream. That was a PgBouncer
workaround; a direct local connection supports prepared statements, which is
faster. Only revisit if we stay on Neon.

---

### W3 — Backups for the self-hosted DB

Blocks W2 cutover. This is what Neon was silently doing for us.

Nightly cron on micro B:

```bash
pg_dump -Fc "$DATABASE_URL" | gzip > /var/backups/dropped-$(date +%F).dump.gz
find /var/backups -name 'dropped-*.dump.gz' -mtime +14 -delete
```

Push dumps **off the box** — Oracle Always Free includes ~20 GB Object Storage,
and our dumps will be a few MB. A backup that lives only on the machine that can
die is not a backup.

Test one restore into a scratch database before trusting it. An untested backup
is a guess.

Also add: disk-usage alerting on micro B. A full DB volume is a hard outage.

---

### W4 — `device_id` indexes

Addresses F3. Do this whether or not W2 happens.

New migration, e.g. `drizzle/0004_device_indexes.sql`:

```sql
CREATE INDEX IF NOT EXISTS reveals_device_idx ON reveals (device_id);
CREATE INDEX IF NOT EXISTS saves_device_idx   ON saves   (device_id);
CREATE INDEX IF NOT EXISTS hearts_device_idx  ON hearts  (device_id);
```

Mirror them in `src/db/schema.ts` so drizzle-kit stays aware, matching how
`drops_device_idx` is already declared.

Verify with `EXPLAIN ANALYZE` on the `device.repo.ts:84` query before and after.

---

### W5 — Split `/health` and `/ready`

Addresses F2.

- `/health` — liveness only, no DB. Safe for uptime monitors and LB health checks.
- `/ready` — includes the `SELECT 1`. Called manually and post-deploy.

```ts
// Liveness: process is up. No DB — safe to poll.
app.get('/health', { schema: { response: { 200: healthResponse } } },
  async (_req, reply) => reply.send({ ok: true }));

// Readiness: includes the DB ping. Deploy verification / manual use.
r.get('/ready', { schema: { response: { 200: healthResponse } } },
  async (_req, reply) => {
    await sqlClient`SELECT 1`;
    return reply.send({ ok: true });
  });
```

Add `/ready` to `publicPaths` in `src/app.ts:69`.

Then update `scripts/deploy.sh` step 6 to check `/ready` (it wants the real
dependency check), and document that any monitoring must use `/health`.

---

### W6 — Prune `route_cache`

Addresses F4.

Supporting index — new migration, e.g. `drizzle/0005_route_cache_prune.sql`:

```sql
CREATE INDEX IF NOT EXISTS route_cache_created_idx ON route_cache (created_at);
```

Nightly job (cron on the app server, or `pg_cron` once self-hosted):

```sql
DELETE FROM route_cache WHERE created_at < now() - interval '21 days';
```

Keep the interval in sync with `ROUTE_CACHE_TTL_DAYS` (`src/config/env.ts`) —
ideally read it from env rather than hardcoding 21 in two places.

Autovacuum reclaims the space for reuse. Consider also a hard row cap (keep the
newest N) so a traffic spike can't outrun the TTL.

---

### W7 — Micro A memory hardening

Addresses F5.

**Add swap** (Oracle images ship with none). This is what stops the OOM killer:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Cap the V8 heap** so Node GCs instead of getting killed. Under PM2:

```bash
pm2 delete dropped-api
pm2 start dist/src/server.js --name dropped-api --node-args="--max-old-space-size=512"
pm2 save
```

(Entry is `dist/src/server.js`, not `dist/server.js` — see DEPLOYMENT.md.)

**Consider building off-box.** Options, either acceptable:

- Keep `yarn build` on the server, relying on swap to absorb the `tsc` peak. Simplest, no pipeline change.
- Build locally or in CI and ship `dist/` (rsync/scp). The server then only ever runs `node`. Cleaner, but `scripts/deploy.sh` and the `/deployInServer` flow both need reworking, and `dist/` is currently gitignored.

Recommend swap first, and revisit shipping `dist/` only if deploys still wobble.

**Do not** use PM2 cluster mode. One core means N workers only multiply memory
and DB connections for no gain. Single process is correct here.

---

### W8 — Real domain + Cloudflare (optional)

Putting Cloudflare in front would give free edge TLS, DDoS filtering, and caching
for `/docs`, and would let us drop Caddy (~30–50 MB RSS back).

**Blocker:** we're on `droppeddev.duckdns.org`. We don't control the
`duckdns.org` zone, so it cannot be onboarded to Cloudflare. This requires buying
a domain first (~₹800/yr).

Until then, **keep Caddy**. It works, it auto-renews, and it costs no money.

Secondary benefit of a real domain: DuckDNS is a free service with no uptime
guarantee, and DEPLOYMENT.md already notes the IP must be updated manually if
Oracle changes it.

Lowest priority. Purely a cost/benefit call, no correctness issue.

---

## Appendix A — if a load balancer is ever needed

Not planned. Recorded so the analysis isn't repeated.

Caddy on one box, both nodes upstream:

```
api.yourdomain.com {
	reverse_proxy 10.0.0.1:3000 10.0.0.2:3000 {
		lb_policy round_robin
		health_uri /health
		health_interval 10s
	}
}
```

Cloudflare's free tier is DNS proxy only — **no health checks**; their Load
Balancing product is paid. Plain round-robin A records fail badly, since a dead
node keeps receiving half the traffic.

Two things in this codebase break at two nodes — both are F7:

- `src/plugins/rateLimit.ts:15` needs a shared (Redis) store, or `max` halved to 60.
- `src/repositories/route.repo.ts:88` check-then-increment races harder.

Everything else is DB-backed and safe to scale horizontally. There are no
sessions and no websockets, so the app is otherwise stateless.

---

## Open questions

1. Are both micros in the same Oracle tenancy and VCN? Blocks W2 (see
   [Target architecture](#target-architecture)).
2. What is micro B's OCID / private IP? Not yet recorded in DEPLOYMENT.md.
3. Is the GitHub repo public or private? Determines whether W1 needs a history
   rewrite or just rotation.
4. Buy a domain for W8, or stay on DuckDNS + Caddy indefinitely?
