# Database — Tables & Connection Guide

## What kind of database is this?

This backend uses **PostgreSQL** (with the **PostGIS** extension for geo queries),
hosted on **Neon** (a cloud Postgres provider). The ORM is **Drizzle**, with the
`postgres.js` driver.

> ⚠️ **SSMS will NOT work.** SQL Server Management Studio only connects to Microsoft
> SQL Server. This is PostgreSQL — a different engine. Use a Postgres client instead
> (see [Connecting](#connecting-to-the-database) below).

The app reads a single `DATABASE_URL` from `.env`, so switching hosts is a one-line change.

---

## Connecting to the database

### Connection details (from `.env`)

| Field    | Value |
|----------|-------|
| Host     | `ep-purple-sunset-ao75u44p.c-2.ap-southeast-1.aws.neon.tech` |
| Port     | `5432` (default) |
| Database | `neondb` |
| User     | `neondb_owner` |
| Password | `npg_faF6lqUixZr8` |
| SSL      | **Required** (`sslmode=require`) |

Full connection string:

```
postgresql://neondb_owner:npg_faF6lqUixZr8@ep-purple-sunset-ao75u44p.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
```

### Recommended clients (instead of SSMS)

1. **DBeaver** (free, recommended) — https://dbeaver.io
   - New Connection → **PostgreSQL**
   - Fill in Host / Port / Database / User / Password from the table above
   - In **SSL** tab: enable SSL (mode = `require`)
   - Connect, then expand `neondb` → `Schemas` → `public` → `Tables`

2. **pgAdmin** (official Postgres GUI) — https://www.pgadmin.org
   - Register → Server → enter the same connection details, SSL mode = Require

3. **Neon web console** (no install) — https://console.neon.tech
   - Open your project → **Tables** to browse data, or **SQL Editor** to run queries

4. **psql** (command line), if installed:
   ```bash
   psql "postgresql://neondb_owner:npg_faF6lqUixZr8@ep-purple-sunset-ao75u44p.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
   ```

---

## Tables

There are **8 tables**, all in the `public` schema.

### `devices`
Anonymous identity. One row per device. `id` is the `X-Device-Id` UUID the client generates.

| Column      | Type                       | Notes |
|-------------|----------------------------|-------|
| id          | text                       | **PK**. The client-generated device UUID |
| created_at  | timestamptz                | NOT NULL, defaults to `now()` |

### `drops`
The core content — a "drop" left at a geographic location.

| Column        | Type                     | Notes |
|---------------|--------------------------|-------|
| id            | uuid                     | **PK**, defaults to random UUID |
| device_id     | text                     | NOT NULL, **FK → devices.id** |
| body          | text                     | NOT NULL. The message text |
| mood          | text                     | NOT NULL |
| place_label   | text                     | Nullable. Human-readable place name |
| city          | text                     | Nullable |
| geog          | geography(Point, 4326)   | NOT NULL. PostGIS point; read/written via raw SQL |
| status        | text                     | NOT NULL, default `'visible'`. One of `visible` / `hidden` / `pending` |
| reveal_count  | integer                  | NOT NULL, default `0` |
| stood_here    | integer                  | NOT NULL, default `0` |
| heart_count   | integer                  | NOT NULL, default `0` |
| reply_count   | integer                  | NOT NULL, default `0`. Count of **visible** replies |
| expires_at    | timestamptz              | Nullable. When the drop fades. **NULL = forever** |
| shareable     | boolean                  | NOT NULL, default `true`. May a share link resolve here? |
| reveal_condition | text                  | Nullable. `'night'` / `'day'`. **NULL = no condition** |
| created_at    | timestamptz              | NOT NULL, default `now()` |

Indexes: `drops_geog_gix` (GiST on `geog`, for nearby/`ST_DWithin`), `drops_device_idx` (device_id), `drops_status_idx` (status), `drops_expires_idx` (partial, on `expires_at` where it is NOT NULL — most rows are forever).

Constraint: `drops_reveal_condition_chk` — `reveal_condition IS NULL OR reveal_condition IN ('night','day')`.

**Expiry rules** (decided once; don't re-litigate them per query):

- The author picks 7 days / 30 days / forever at compose time. The API takes a
  *duration* (`expiresInDays`), never a timestamp — the server computes
  `expires_at` from its own clock.
- Filtering is done **on read**, in SQL, against `now()`: `nearby` and the
  reveal gate (`revealGate`) both carry
  `(expires_at IS NULL OR expires_at > now())`. Both must have it — filtering
  only `nearby` would leave an expired drop revealable by anyone holding its id.
- The trail queries and `findForDevice` deliberately **do not** filter. An
  author keeps seeing their own expired drops (rendered faded), and a drop you
  already saved or revealed stays readable — otherwise the save button is a lie.
- **Nothing is ever hard-deleted on expiry.** `reports` and moderation history
  reference the row. No cron; revisit only if the table grows.

**Reveal-condition rules** (also decided once):

- **Max one condition per drop.** The API takes a single `revealCondition`, not
  an array, and the check constraint allows exactly two values. 50 m is already
  a hard ask; 50 m *and* midnight *and* rain means nobody ever reads it.
- Sunrise/sunset are computed at reveal time from the drop's **own coordinate**
  and the server clock — see [src/domain/solar.ts](src/domain/solar.ts). Nothing
  solar is stored, and **no timezone is ever consulted**: everything is UTC plus
  a longitude, so DST cannot shift when a drop opens.
- Enforced in `reveal.service`, immediately **after** the distance check. Order
  matters: someone 500 m away at midnight is told they are too far, not that
  they are too early. It is also why a stranger cannot probe a drop's condition
  from across town.
- `revealCondition` **is** returned on sealed `nearby` rows, on purpose. The pin
  says *when* it opens, never *what* it says, so a walk can be planned instead
  of wasted.
- Weather gating ("when it's raining") needs an external API keyed by
  coordinate, a cache, and a cost model. Deliberately out of scope — that is
  why the check constraint is narrow rather than open-ended.

### `reveals`
One row per (drop, device) reveal. Drives `reveal_count` and the "Found" trail.

| Column     | Type        | Notes |
|------------|-------------|-------|
| drop_id    | uuid        | NOT NULL, **FK → drops.id** (ON DELETE CASCADE) |
| device_id  | text        | NOT NULL, **FK → devices.id** |
| created_at | timestamptz | NOT NULL, default `now()` |

Primary key: composite (`drop_id`, `device_id`).

### `saves`
Saves / bookmarks, keyed by device. Drives the "Saved" trail and the `saved` flag.

| Column     | Type        | Notes |
|------------|-------------|-------|
| drop_id    | uuid        | NOT NULL, **FK → drops.id** (ON DELETE CASCADE) |
| device_id  | text        | NOT NULL, **FK → devices.id** |
| created_at | timestamptz | NOT NULL, default `now()` |

Primary key: composite (`drop_id`, `device_id`).

### `hearts`
Hearts ("I feel this"), keyed by device. Drives `heart_count` and the `hearted` flag.

| Column     | Type        | Notes |
|------------|-------------|-------|
| drop_id    | uuid        | NOT NULL, **FK → drops.id** (ON DELETE CASCADE) |
| device_id  | text        | NOT NULL, **FK → devices.id** |
| created_at | timestamptz | NOT NULL, default `now()` |

Primary key: composite (`drop_id`, `device_id`).

### `device_steps`
Per-device, per-day step counts. Backs the Trail "steps" stat. Updated via raw SQL upsert.

| Column     | Type        | Notes |
|------------|-------------|-------|
| device_id  | text        | NOT NULL, **FK → devices.id** |
| day        | date        | NOT NULL |
| steps      | integer     | NOT NULL, default `0` |
| updated_at | timestamptz | NOT NULL, default `now()` |

Primary key: composite (`device_id`, `day`).

### `replies`
Replies in place — one short line pinned under a drop. Writable **and** readable only
by a device that has a `reveals` row for that drop, i.e. one the server verified within
50 m. `device_id` exists purely for the one-per-device rule, the daily quota, and
author-only delete: **it is never serialized to the client.**

| Column     | Type        | Notes |
|------------|-------------|-------|
| id         | uuid        | **PK**, defaults to random UUID |
| drop_id    | uuid        | NOT NULL, **FK → drops.id** (ON DELETE CASCADE) |
| device_id  | text        | NOT NULL, **FK → devices.id** |
| body       | text        | NOT NULL. 1–140 chars (`replies_body_len`) |
| status     | text        | NOT NULL, default `'visible'`. One of `visible` / `hidden` / `pending` |
| created_at | timestamptz | NOT NULL, default `now()` |

Indexes: `replies_drop_idx` (drop_id), `replies_device_idx` (device_id),
`replies_drop_device_uniq` (**unique** on drop_id + device_id — one reply per device
per drop, enforced in the DB rather than only in the UI).

`drops.reply_count` is a denormalised count of `visible` replies, recomputed inside the
same transaction as every insert / delete / status change, so `nearby` can show
"3 voices here" without an N+1.

### `reports`
Moderation reports. Once N reports accumulate (`REPORT_HIDE_THRESHOLD`, default 3),
the reported target flips to `pending` (shadow-removed).

A report targets **exactly one** of a drop or a reply. Both foreign keys are nullable
and `reports_target_chk` enforces the XOR — that keeps both FKs real (versus a
`target_type`/`target_id` pair) and lets one count query work per-target.

| Column     | Type        | Notes |
|------------|-------------|-------|
| id         | uuid        | **PK**, defaults to random UUID |
| drop_id    | uuid        | Nullable, **FK → drops.id** (ON DELETE CASCADE) |
| reply_id   | uuid        | Nullable, **FK → replies.id** (ON DELETE CASCADE) |
| device_id  | text        | NOT NULL, **FK → devices.id** |
| reason     | text        | NOT NULL |
| created_at | timestamptz | NOT NULL, default `now()` |

Constraint: `reports_target_chk` — `(drop_id IS NOT NULL) <> (reply_id IS NOT NULL)`.
Indexes: `reports_drop_idx` (drop_id), `reports_reply_idx` (reply_id).

---

## Relationships at a glance

```
devices ──< drops ──< reveals
   │          │   └──< saves
   │          │   └──< hearts
   │          │   └──< replies ──< reports (reply_id)
   │          │   └──< reports (drop_id)
   │          └──(referenced by all above)
   └──< device_steps
   └──(device_id referenced by drops, reveals, saves, hearts, replies, reports, device_steps)
```

All child tables of `drops` (reveals, saves, hearts, replies, reports) cascade-delete
when a drop is deleted, and reports cascade from `replies` too. `device_id` foreign keys
do **not** cascade.

---

## Quick query to list tables yourself

Once connected with any Postgres client:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

Source of truth for the schema: [src/db/schema.ts](src/db/schema.ts) and the migration [drizzle/0000_init.sql](drizzle/0000_init.sql).
