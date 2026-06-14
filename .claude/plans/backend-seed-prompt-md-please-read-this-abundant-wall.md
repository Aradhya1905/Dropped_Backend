# Dropped — Backend Build Plan

## Context

The **Dropped** React Native app (`C:\My_Projects\Dropped`, read-only) is UI-complete but has **no server**. Its core loop — *drop a secret at a GPS point → another user physically walks within 50 m → the secret reveals* — is not real yet because nothing enforces the 50 m rule or stores drops. The feature `src/features/*/api/` folders are still empty; the only hard contract today is `src/types/index.ts` (`Coordinate`, `Drop`, `Secret`, `RevealState`, `REVEAL_RADIUS_M = 50`) and the client's axios setup (`X-Device-Id` header, `{ message }` error bodies, ms-epoch timestamps).

This plan builds the backend **in place** inside `C:\My_Projects\Dropped_Backend` (no nested project folder), neatly layered: routes → controllers → services (logic) → repositories (DB) → schema. Stack is decided and not re-litigated: **Node + TypeScript + Fastify + Postgres/PostGIS + Drizzle + Zod**, on **Neon** via the standard `postgres.js` TCP driver (host-agnostic, single `DATABASE_URL`).

### Decisions locked with the user
- **Type contract:** Responses are **supersets** of the client's `Secret`/`Drop` — identical field names, casing, and ms-epoch `createdAt` — with additive fields (`mood`, `hearts`, `stoodHere`, `sealed`, `saved`, `hearted`). Existing client types still parse.
- **Type sharing:** **Copied with a note.** The backend gets its own `src/domain/clientTypes.ts` mirroring `src/types/index.ts`, with a header comment naming the client file as source of truth. No restructuring of the client repo.
- **Moderation v1:** Ingest filter + report endpoint + `status` field (visible/hidden/pending) with shadow-removal. Review-queue is **designed in the doc**, not built as UI.
- **Filter strictness:** **Block hard, flag soft.** Hard-block clear threats / PII (phone, email, exact street addresses) and slurs at ingest; flag borderline as `pending` rather than rejecting.
- **No Docker.** Local dev connects straight to the Neon `DATABASE_URL`. (A future self-hosted Postgres is just a connection-string swap — the host-agnostic posture is preserved.)

---

## Conventions confirmed from the client (must match exactly)

- Auth header: **`X-Device-Id`** (UUID v4) on every request. No accounts.
- Error body shape: `{ message: string }` (axios reads `.message`). Use this for all error responses.
- Timestamps: **ms epoch numbers** (not ISO strings, not seconds).
- Coordinate shape: `{ lat, lng }` (WGS-84, lat first). PostGIS stores `geography(Point,4326)` as `(lng, lat)` — convert at the DB boundary only.
- Reveal radius: `REVEAL_RADIUS_M = 50`; haversine uses Earth radius `6_371_000` m, inclusive `<=`. Server is the source of truth; `ST_DWithin` is primary, the copied haversine is the test oracle.
- Client request timeout is 15 s; GETs retry on 5xx/network — keep handlers fast and GETs idempotent.

---

## Folder structure (created directly in `Dropped_Backend`)

```
Dropped_Backend/
  package.json            # yarn, type:module, scripts
  tsconfig.json
  drizzle.config.ts
  .env                    # already has the Neon string (see note below)
  .env.example            # DATABASE_URL + tunables, no secrets
  README.md               # run locally (no Docker)
  Documentation/
    2026-06-14-backend.md # the dated design doc (client voice)
  drizzle/                # generated SQL migrations
    0000_init.sql         # hand-authored first: CREATE EXTENSION postgis; + tables/indexes
  src/
    config/env.ts         # zod-validated env (DATABASE_URL, PORT, rate limits, radii)
    db/
      client.ts           # postgres.js + drizzle instance (single pool)
      schema.ts           # drizzle tables: devices, drops, reveals, saves, hearts, reports
    domain/
      clientTypes.ts      # COPY of client src/types/index.ts (source-of-truth note)
      geo.ts              # COPY of client utils/geo.ts (haversineMeters, isWithin)
    plugins/
      deviceId.ts         # Fastify plugin: parse/validate X-Device-Id -> request.deviceId
      rateLimit.ts        # per-device/day drop quota
      errorHandler.ts     # normalize all errors to { message }
    schemas/              # Zod request/response schemas per resource
      drop.schema.ts
      nearby.schema.ts
      reveal.schema.ts
      engagement.schema.ts
      report.schema.ts
    repositories/         # DB layer — only place that writes SQL/Drizzle
      device.repo.ts
      drop.repo.ts        # incl. raw ST_DWithin nearby + reveal verify queries
      engagement.repo.ts  # saves, hearts, stood-here, reveal records
      report.repo.ts
    services/             # business logic — no Fastify, no raw SQL
      device.service.ts
      drop.service.ts
      reveal.service.ts   # the 50 m verification flow
      trail.service.ts    # found / saved / dropped lists
      moderation.service.ts # ingest filter (profanity/PII/threats), status decisions
      mappers.ts          # row -> client-shaped Secret/Drop superset
    controllers/          # thin: validate -> call service -> shape response
      drop.controller.ts
      nearby.controller.ts
      reveal.controller.ts
      engagement.controller.ts
      trail.controller.ts
      report.controller.ts
    routes/               # bind paths -> controllers, attach Zod schemas
      index.ts
      drops.routes.ts
      secrets.routes.ts
      devices.routes.ts
    app.ts                # build Fastify instance, register plugins+routes
    server.ts             # listen()
    seed.ts               # insert sample drops near a known coord for manual testing
  tests/
    geo.spec.ts           # haversine parity + 50 m boundary
    reveal.spec.ts        # spoof resistance: outside-50m rejected, inside accepted
    moderation.spec.ts    # ingest filter: block vs flag vs allow
```

---

## Data model (PostGIS)

`0000_init.sql` runs `CREATE EXTENSION IF NOT EXISTS postgis;` then:

- **devices** — `id text pk` (the X-Device-Id UUID), `created_at timestamptz default now()`. Lazily upserted on first request.
- **drops** — `id uuid pk default gen_random_uuid()`, `device_id text fk`, `body text` (≤280, validated), `mood text` (enum: `joy|ache|trouble|wonder`), `place_label text null`, `geog geography(Point,4326) not null` (GiST-indexed), `status text default 'visible'` (`visible|hidden|pending`), `reveal_count int default 0`, `stood_here int default 0`, `heart_count int default 0`, `created_at timestamptz default now()`. Stored coordinate is **snapped ~ to 5 dp (~1 m) / optional small fuzz** per privacy posture; exact author position is never kept beyond the snapped drop point.
  - Index: `CREATE INDEX drops_geog_gix ON drops USING gist (geog);`
- **reveals** — `(drop_id, device_id)` unique, `created_at`. Drives `reveal_count`, "found" trail, idempotent reveals.
- **saves** — `(drop_id, device_id)` unique. Drives "saved" trail and `saved` flag.
- **hearts** — `(drop_id, device_id)` unique. Drives `heart_count` and `hearted` flag.
- **reports** — `id`, `drop_id`, `device_id`, `reason text`, `created_at`. A drop crossing a report threshold flips `status` to `pending` (shadow-removal: excluded from nearby immediately).

**Privacy:** the user's own/live location is never stored. The reveal's one-shot position is used in a single `ST_DWithin` check, then discarded (never written to any table).

---

## Endpoints (all errors → `{ message }`, all `createdAt` → ms epoch)

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| POST | `/drops` | `{ body, mood, coordinate:{lat,lng}, placeLabel? }` | created `Secret` superset (`sealed:false` for author) |
| GET | `/drops/nearby` | `?lat&lng&radiusMeters?` (default discovery radius) | `{ secrets: SealedSecret[] }` — **body withheld**, `sealed:true`, `distanceMeters`, counters; excludes `hidden`/`pending` |
| POST | `/drops/:id/reveal` | `{ coordinate:{lat,lng} }` (one-shot) | on success unsealed `Secret` superset (`body`, `sealed:false`, `saved`, `hearted`, incremented counters); on fail **403** `{ message, distanceMeters }` |
| POST | `/drops/:id/save` / DELETE same | — | `{ saved: boolean }` |
| POST | `/drops/:id/heart` / DELETE same | — | `{ hearted: boolean, hearts: number }` |
| POST | `/drops/:id/report` | `{ reason }` | `{ reported: true }` |
| GET | `/drops/trail/found` | `?limit&offset` | `{ secrets: Secret[], total }` (device's reveals, bodies included) |
| GET | `/drops/trail/saved` | `?limit&offset` | `{ secrets: Secret[], total }` |
| GET | `/drops/trail/dropped` | `?limit&offset` | `{ secrets: Secret[], total }` |
| GET | `/devices/me` | — (header) | `{ deviceId, createdAt, dropsQuotaRemaining }` |
| GET | `/health` | — | `{ ok: true }` (DB ping) |

`SealedSecret` = `Secret` superset minus `body`, with `sealed:true`. Paths are namespaced under `/drops` for consistency; the integration note will map each to the empty client `features/*/api/` slots.

---

## Reveal verification flow (the part that must not break)

1. Controller validates `{ coordinate }` with Zod; `request.deviceId` from the plugin.
2. `reveal.service` calls `drop.repo.verifyWithin(dropId, coord, REVEAL_RADIUS_M)` which runs `ST_DWithin(geog, ST_MakePoint(lng,lat)::geography, 50)` — **server recomputes distance; client's claim is ignored.**
3. If false → 403 `{ message: 'Too far to reveal', distanceMeters }` (distance from `ST_Distance`).
4. If true → upsert `reveals` (idempotent), increment `reveal_count` + `stood_here` only on first reveal for that device, return the unsealed superset.
5. The one-shot `coordinate` is never persisted.
6. `tests/reveal.spec.ts` proves: a point 51 m away is rejected, 49 m accepted, boundary matches the copied haversine oracle — the anti-spoof guarantee.

## Moderation pipeline (v1)

- `moderation.service.screen(body)` runs on **ingest** (POST /drops): hard-block lists (slurs, explicit threats, PII regexes: phone, email, street address) → reject 422 `{ message }`; soft-flag borderline → store with `status:'pending'` (created but hidden from nearby).
- `nearby` and reveal exclude `status != 'visible'`.
- `/drops/:id/report` records a report; N reports flips `status` to `pending` (shadow-removal).
- The design doc documents the **human review queue** schema and the visible/hidden/pending state machine (not built as UI in v1).
- `tests/moderation.spec.ts` covers block / flag / allow paths.

---

## Type sharing & integration note

- `src/domain/clientTypes.ts` and `src/domain/geo.ts` are verbatim copies of the client's `src/types/index.ts` and `src/utils/geo.ts`, each with a top comment: *"Source of truth: C:\My_Projects\Dropped\src\... — keep in sync."* `mappers.ts` builds responses from these types so drift is caught by the compiler.
- The design doc's final section is the **integration note**: for each empty `features/*/api/` module, the exact `api.get/post(...)` call, request body, and the response type to expect — so wiring the client later is mechanical.

---

## Tooling & scripts (yarn, no Docker)

- `package.json` (ESM, TS) deps: `fastify`, `@fastify/rate-limit`, `drizzle-orm`, `postgres`, `zod`, `fastify-type-provider-zod` (or `@fastify/type-provider-zod`); dev: `typescript`, `tsx`, `drizzle-kit`, `vitest`, `@types/node`.
- Scripts: `dev` (`tsx watch src/server.ts`), `build` (`tsc`), `start`, `db:generate`/`db:migrate` (drizzle-kit), `db:seed` (`tsx src/seed.ts`), `test` (`vitest`).
- `.env` already holds the Neon string but under key `POSTGRES_NEON_CONNECTION_STRING`. **The brief mandates a single `DATABASE_URL`** — I'll add `DATABASE_URL=` (same value) and have `config/env.ts` read `DATABASE_URL` (the host-portable contract). I'll point this out rather than silently renaming.
- `postgres.js` connects with `{ ssl: 'require' }` (Neon needs SSL) — that flag is harmless for self-hosted later.

---

## Build order (phases)

1. **Phase 0 — Scaffold:** `package.json`, `tsconfig`, `config/env.ts`, `.env.example`, folder skeleton; `yarn install`.
2. **Phase 1 — DB foundation:** `schema.ts`, `0000_init.sql` (PostGIS extension, tables, GiST index), `db/client.ts`, `db:migrate` against Neon; `/health` proves connectivity.
3. **Phase 2 — Identity + plugins:** `deviceId` plugin, `errorHandler` (→ `{ message }`), `rateLimit`; `GET /devices/me`.
4. **Phase 3 — Drops + nearby:** create drop (with moderation ingest), `ST_DWithin` nearby returning sealed secrets; `domain/` copies + `mappers.ts`.
5. **Phase 4 — Reveal:** server-side 50 m verify, counters, idempotency; `tests/reveal.spec.ts` + `tests/geo.spec.ts`.
6. **Phase 5 — Engagement + trails:** save/heart endpoints, found/saved/dropped lists.
7. **Phase 6 — Moderation:** report endpoint, status state machine, shadow-removal; `tests/moderation.spec.ts`.
8. **Phase 7 — Deliverables:** `seed.ts`, `README.md`, and `Documentation/2026-06-14-backend.md` (data model, every endpoint, reveal flow, moderation, privacy, host-portability note, client integration note).

---

## Verification (end-to-end, no Docker)

- `yarn db:migrate` then `yarn db:seed` against Neon; confirm PostGIS extension + GiST index exist.
- `yarn dev`, then `GET /health` → `{ ok: true }`.
- Manual flow with `curl`/REST client using an `X-Device-Id`:
  1. `POST /drops` near a seeded coord → returns created secret.
  2. `GET /drops/nearby?lat&lng` → seeded drops appear **sealed** (no `body`).
  3. `POST /drops/:id/reveal` with a coord **>50 m away** → 403; with a coord **<50 m** → unsealed body + incremented counters.
  4. save / heart / report toggle correctly; trails list found/saved/dropped for that device.
  5. `POST /drops` with a phone number / slur → blocked (422) or stored `pending` and absent from nearby.
- `yarn test` green: geo parity, reveal spoof-resistance (49 m vs 51 m boundary), moderation block/flag/allow.
