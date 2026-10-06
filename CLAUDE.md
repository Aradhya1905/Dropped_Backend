# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Yarn 4 (`nodeLinker: node-modules`), Node 20+.

```bash
yarn dev            # tsx watch src/server.ts -> http://localhost:3000
yarn build          # tsc -> dist/
yarn typecheck      # tsc --noEmit
yarn test           # vitest run (hits the real DATABASE_URL)
yarn test:watch
yarn db:migrate     # apply drizzle/*.sql in filename order (idempotent)
yarn db:seed        # sample drops near MG Road, Bengaluru
```

Run one test file / one case:

```bash
yarn vitest run tests/reveal.spec.ts
yarn vitest run tests/reveal.spec.ts -t 'rejects a reveal from outside'
```

Deploy: `/deployInServer` (or `./scripts/deploy.ps1 -Push`). Deploys `origin/main` to
`ubuntu@140.245.194.161`, PM2 app `dropped-api`, public at https://droppeddev.duckdns.org.
See `Documentation/DEPLOYMENT.md`.

## Architecture

Fastify 5 + Zod (via `fastify-type-provider-zod`) + Postgres/PostGIS on Neon, driven by
`postgres.js` with Drizzle for schema typing. Strict one-way layering:

```
routes/ -> controllers/ -> services/ -> repositories/ -> db/
```

- **repositories/** are the *only* place SQL lives, PostGIS included. They return flat
  rows (`DropRow`, `DropRowForDevice`) with `geog` already split into `lat`/`lng`.
- **services/** hold business logic — no SQL, no Fastify types.
- **services/mappers.ts** is the single owner of the wire shape (ms-epoch timestamps,
  `{lat,lng}`, sealed vs unsealed secret).
- `buildApp()` in `src/app.ts` is exported separately from `server.ts` so tests can
  `inject()` without listening.

### Non-negotiable invariants

- **The 50 m reveal is server-side.** `reveal.service.ts` recomputes distance with
  PostGIS `ST_DWithin`/`ST_Distance` from the client's one-shot position; the client's
  claim is never trusted and that position is never persisted. Outside 50 m → 403 with
  `distanceMeters`. Do not move this check client-ward or into the haversine helper.
- **`src/domain/clientTypes.ts` and `src/domain/geo.ts` are COPIES** of the mobile
  client's files (`C:\My_Projects\Dropped\src\types\index.ts` and `src/utils/geo.ts`).
  Keep them in sync; API responses must stay *supersets* of these shapes. The haversine
  in `geo.ts` is the test oracle proving PostGIS and the client agree at the boundary —
  not the production check.
- **Every error response is `{ message: string }`** (plus extras like `distanceMeters`).
  The client's axios layer reads `.message`. Throw the helpers from
  `plugins/errorHandler.ts` (`badRequest`, `forbidden`, `unprocessable`, …), never raw
  Errors with ad-hoc shapes.
- **Auth is the `X-Device-Id` UUID header** (`plugins/deviceId.ts`) — no accounts. The
  device row is lazily upserted on first request. Only `/health`, `/docs`, and
  `/openapi.json` are public.
- Drop coordinates are snapped to 5 dp (~1 m) on write so the author's exact GPS fix is
  never stored.

### Migrations — read before adding one

`src/db/migrate.ts` runs hand-authored `drizzle/*.sql` in filename order and records the
**filename** in `_migrations`. A reused number is silently skipped.

`0004`–`0009` are already recorded in the live Neon DB by abandoned work whose files are
**not on `main`**. `0010_starter_drops` is the first one after the gap. **Number the next
migration `0011` or higher.** The live schema is a
superset of what `main` uses; see `tables.md` for the diff. `src/db/schema.ts` is the
typed mirror — the PostGIS `geography(Point,4326)` column is a `customType` opaque to
Drizzle and touched only through raw SQL in `drop.repo.ts`.

### Routing proxy

`GET /route/foot` (`services/routing.service.ts`) is walking *guidance only* — ORS first,
Mapbox fallback, quantized cache + monthly quota counters. With no keys set it returns
`{ available: false }` and the client draws no path. It must never influence the reveal.

## Tests

`tests/reveal.spec.ts` and `tests/streak.spec.ts` run against the real database in
`DATABASE_URL` (that's the point — they prove PostGIS behaviour) and clean up their own
rows by device id. `vitest.config.ts` excludes `.claude/worktrees/**`; keep that exclusion
or parallel worktree checkouts will race and delete each other's fixtures.

## Gotchas

- `tsconfig.json` sets `rootDir: "."`, so build output is `dist/src/server.js`. The
  `yarn start` script (`node dist/server.js`) is wrong; the server deploy runs
  `dist/src/server.js` under PM2.
- TypeScript is `NodeNext` ESM — **all relative imports need the `.js` extension**.
- `strict` + `noUncheckedIndexedAccess` are on; indexed access yields `T | undefined`.
- Docs live in `Documentation/`: `2026-06-14-backend.md` (full design), `API.md`,
  `DEPLOYMENT.md`, `openapi.json`. `/docs` serves Scalar off the Zod-generated spec.
