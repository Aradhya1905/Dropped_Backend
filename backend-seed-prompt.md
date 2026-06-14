# Dropped — Backend seed prompt

_Paste this as the first message to a fresh agent in the backend repo/workspace.
It seeds the whole backend build. Stack and DB are already decided below — the
agent should not re-litigate them._

---

```
You are building the backend for **Dropped**, an existing React Native app. The
mobile client is complete (UI + navigation + local services); there is no server
yet. Your job: design and build the backend that makes the app's core loop real.

## Stack (decided — don't re-litigate)
Node + TypeScript + **Fastify** + **Postgres/PostGIS** + **Drizzle ORM** + **Zod**.
- TypeScript so the server shares the client's domain types and geo math.
- Fastify for typed routes + schema validation (Zod).
- Postgres + PostGIS: the core query ("drops within 50 m of a point") uses
  `ST_DWithin` on a geography column with a GiST index — the server is the source
  of truth for the reveal rule.
- Drizzle for typed SQL, dropping to raw SQL for the PostGIS bits.

## Hosting & portability (important)
- Host Postgres on **Neon** for now (free, PostGIS-capable, fast cold start).
- BUT stay **host-agnostic** so moving to a self-hosted Postgres later is just a
  connection-string change, not a rewrite:
  - Connect with the **standard TCP driver `postgres.js`** (or `node-postgres`).
    **Do NOT use `@neondatabase/serverless`** or any Neon-specific HTTP/WebSocket
    driver — that locks you in. Neon accepts standard TCP, so you lose nothing.
  - Read the connection from a single **`DATABASE_URL`** env var. Switching host =
    swap that one value.
  - Use only **standard PostGIS** (`ST_DWithin`, `geography`); the migration must
    `CREATE EXTENSION IF NOT EXISTS postgis;`.
  - Don't build app logic on Neon branching / scale-to-zero / its pooler quirks.
- Local dev: **Dockerized Postgres + PostGIS** (e.g. `postgis/postgis` image),
  same `DATABASE_URL` shape. Migrations (Drizzle, plain SQL files) replay on any
  Postgres.

## First, study the client
The RN app lives at `C:\My_Projects\Dropped` (read it, don't modify it). Read in
this order, then stop and confirm your understanding before writing code:
1. `CLAUDE.md` — product premise, stack, conventions.
2. `Documentation/2026-05-31-architecture.md`
3. `Documentation/2026-06-12-screens-and-navigation.md`
4. `Documentation/2026-06-13-remaining-work.md` — §2 is the backend gap list.
5. `Documentation/2026-06-14-location-and-address.md` — how location/address work.
6. `src/types/` — the shared domain shapes (`Coordinate {lat,lng}`, `Drop`,
   `Secret`, `RevealState`, `REVEAL_RADIUS_M = 50`). The API MUST speak these
   exact shapes.
7. `src/services/api/`, `src/services/location/`, `src/utils/geo.ts` — the client
   contract you must match (axios base, device-id auth header, haversine/isWithin).
8. `src/features/*/api/` and `src/features/*/types.ts` — each screen's data needs.

## What Dropped is (so you build the right thing)
Anonymous, no-login app. People pin secret confessions to a real GPS coordinate.
Others can only **read** a secret after physically walking **within 50 m** of the
drop — then the app "reveals" it. Loop: **drop → walk → reveal**. No accounts —
users are an anonymous device id. **Moderation is the hard problem, not the
engineering** (per the brief: "cruelty gets erased").

## Build these (MVP, in order)
1. **Anonymous identity** — register/recognize a device id (sent as a header).
   Rate-limit drops per device/day. No PII, no accounts.
2. **Drops** — create a drop (body ≤ ~280 chars, mood/emotion tag, coordinate).
   Persist the coordinate as a PostGIS `geography` column, GiST-indexed.
3. **Nearby query** — given a point, `ST_DWithin` to return sealed drops near it,
   **locked**: body withheld until revealed.
4. **Reveal** — server-side 50 m verification using a one-shot position the client
   sends. Clients must NOT be able to spoof a reveal; the server re-checks
   distance (PostGIS / the same haversine as `utils/geo`). On success, return the
   body and increment counters (reveals, "stood here").
5. **Save / heart** — keyed by device id.
6. **Trail lists** — found / saved / dropped, per device.
7. **Moderation pipeline** (don't skip — the product's hard problem): text
   filtering on ingest (profanity/PII/threats), a report endpoint, a review queue,
   and shadow-removal via a `status` field (visible/hidden/pending). If the full
   queue is too big for v1, build ingest filter + report + status and document the
   review-queue design.

## Privacy posture (non-negotiable — it's a product promise)
- The user's *own* location never persists server-side. Only **drops** store
  coordinates. A reveal's one-shot position is used only to verify distance, then
  discarded. Consider snapping/fuzzing stored drop coordinates.

## Type sharing
Reuse the client's domain types (`Coordinate`, `Drop`, `Secret`,
`REVEAL_RADIUS_M`) rather than redefining. Propose the mechanism (shared workspace
package vs. copied-with-a-note) and pick one — the API's request/response shapes
must match what `src/features/*/api/` and `src/services/api/` expect.

## Constraints & taste
- **Simple and elegant over clever.** Boring, readable, fully typed.
- Server is the source of truth for the 50 m rule — never trust the client.
- Migrations, seed data, `.env.example` (with `DATABASE_URL`), Dockerized Postgres
  for local dev.
- Tests for: the reveal/geo verification (spoof-resistance is the part that must
  not break) and the moderation ingest filter.

## Deliverables
1. A dated design doc in `Documentation/` (e.g.
   `Documentation/<today>-backend.md`), in the same voice/format as the existing
   docs: data model, every endpoint with request/response shapes (matching client
   types), the reveal verification flow, the moderation pipeline, the privacy
   posture, and the host-portability note.
2. The backend: schema + migrations, endpoints, device-id auth, rate limiting,
   moderation ingest, tests, seed, README to run locally.
3. A short note on how `src/services/api/` should call each endpoint, so wiring
   the app later is mechanical.

Start by reading the files above and the shared types, then present the design doc
for approval BEFORE implementing. Ask me anything ambiguous (expected scale,
launch moderation aggressiveness) rather than guessing.
```
