# Dropped — Backend

The server for **Dropped**: anonymous secret confessions pinned to real GPS
coordinates. You can only read a secret after physically walking **within 50 m**
of where it was dropped. The loop is **drop → walk → reveal**, and the server is
the source of truth for the 50 m rule — clients can't spoof a reveal.

Stack: **Node + TypeScript + Fastify + Postgres/PostGIS + Drizzle + Zod**, talking
to Postgres over the standard TCP driver (`postgres.js`). Hosted on **Neon** for
now, but host-agnostic: switching to a self-hosted Postgres is a one-line
`DATABASE_URL` change.

See [`Documentation/2026-06-14-backend.md`](Documentation/2026-06-14-backend.md)
for the full design — data model, every endpoint, the reveal flow, moderation,
privacy posture, and how the client wires up.

## Run locally (no Docker)

You only need Node 20+, Yarn, and a Postgres connection string. We point at Neon
out of the box (PostGIS is already enabled by the migration).

```bash
yarn install          # install deps (node-modules linker; see .yarnrc.yml)
cp .env.example .env  # then set DATABASE_URL (a Neon string is already in .env)
yarn db:migrate       # creates the PostGIS extension, tables, GiST index
yarn db:seed          # optional: a few sample drops near MG Road, Bengaluru
yarn dev              # http://localhost:3000
```

Check it's alive:

```bash
curl http://localhost:3000/health        # -> {"ok":true}
```

### Want a local Postgres instead of Neon?

Install Postgres + PostGIS however you like (native installer, Homebrew, etc.),
create a database, and set `DATABASE_URL` to it (drop `?sslmode=require` if your
server doesn't use SSL). `yarn db:migrate` runs `CREATE EXTENSION IF NOT EXISTS
postgis;` itself, so nothing else changes.

## Scripts

| Script             | What it does                                            |
| ------------------ | ------------------------------------------------------- |
| `yarn dev`         | Run the server with reload (`tsx watch`).               |
| `yarn build`       | Compile TypeScript to `dist/`.                          |
| `yarn start`       | Run the compiled server.                                |
| `yarn db:migrate`  | Apply `drizzle/*.sql` in order (idempotent).            |
| `yarn db:seed`     | Insert sample drops for manual testing.                 |
| `yarn test`        | Run the Vitest suite (geo, moderation, live reveal).    |
| `yarn typecheck`   | Type-check without emitting.                            |

> Tests touch the database in `DATABASE_URL` (the reveal suite exercises real
> PostGIS — that's the point) and clean up their own rows.

## Auth & conventions (matches the client exactly)

- **Identity:** every request carries `X-Device-Id: <uuid v4>`. No accounts; the
  device id _is_ the identity, registered lazily on first request. `/health` is
  the only public route.
- **Errors:** always `{ "message": string }` (plus extra fields where useful,
  e.g. `distanceMeters` on a failed reveal). The client's axios layer reads
  `.message`.
- **Timestamps:** ms epoch numbers. **Coordinates:** `{ lat, lng }` (WGS-84).
- **Rate limits:** a coarse per-device burst throttle, plus a per-device daily
  drop quota (`DROP_DAILY_LIMIT`, default 5).

## Endpoints (summary)

| Method     | Path                   | Purpose                                       |
| ---------- | ---------------------- | --------------------------------------------- |
| GET        | `/health`              | Liveness + DB ping.                           |
| GET        | `/devices/me`          | Device summary + remaining daily drop quota.  |
| POST       | `/drops`               | Create a drop (screened on ingest).           |
| GET        | `/drops/nearby`        | Sealed drops near a point (`ST_DWithin`).     |
| POST       | `/drops/:id/reveal`    | Server-verified 50 m reveal; returns the body. |
| POST/DELETE| `/drops/:id/save`      | Save / unsave (bookmark).                      |
| POST/DELETE| `/drops/:id/heart`     | Heart / unheart.                               |
| POST       | `/drops/:id/report`    | Report; N reports shadow-removes the drop.    |
| GET        | `/drops/trail/found`   | Drops this device has revealed.               |
| GET        | `/drops/trail/saved`   | Drops this device has saved.                   |
| GET        | `/drops/trail/dropped` | Drops this device created.                     |

Full request/response shapes are in the design doc.

## Layout

```
src/
  config/        env (single DATABASE_URL, validated with Zod)
  db/            schema, postgres.js client, migrate runner
  domain/        copies of the client's types + geo math (source of truth noted)
  plugins/       device-id auth, rate limit, error normalisation
  schemas/       Zod request/response schemas
  repositories/  the only place that writes SQL (incl. PostGIS)
  services/      business logic — no SQL, no Fastify
  controllers/   thin request handlers
  routes/        path → controller, with schemas attached
  app.ts         builds the Fastify instance
  server.ts      listens
drizzle/         SQL migrations (0000_init.sql creates PostGIS + tables)
tests/           geo parity, moderation filter, live reveal spoof-resistance
```
